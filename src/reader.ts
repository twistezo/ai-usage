import type { ExtraUsage, ProviderState, UsageWindow } from "./usage";

export type ReadResult =
  | {
      kind: "ok";
      plan: string | null;
      fiveHour: UsageWindow;
      sevenDay: UsageWindow;
      extra: ExtraUsage | null;
    }
  | { kind: "login_required" }
  | { kind: "error"; message: string };

const STATUS_ERRORS: Record<string, string> = {
  network_error: "No connection or the request timed out.",
  unexpected_response: "Unexpected server response format.",
};

const UNEXPECTED_OUTPUT = "Unexpected reader output.";
export const LOGIN_REQUIRED_MESSAGE = "Session expired or needs verification.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// A missing window means it has not started yet; anything malformed returns null.
const parseWindow = (value: unknown): UsageWindow | null => {
  if (value === null || value === undefined) {
    return { utilization: 0, resetsAt: null };
  }
  if (!isRecord(value)) {
    return null;
  }

  const utilization = value.utilization ?? 0;
  if (typeof utilization !== "number" || !Number.isFinite(utilization)) {
    return null;
  }

  if (value.resets_at === null || value.resets_at === undefined) {
    return { utilization, resetsAt: null };
  }
  if (typeof value.resets_at !== "string") {
    return null;
  }

  const resetsAt = new Date(value.resets_at);
  if (Number.isNaN(resetsAt.getTime())) {
    return null;
  }

  return { utilization, resetsAt };
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

// Extra usage is optional: a missing or malformed value hides it without failing the reading.
const parseExtra = (value: unknown): ExtraUsage | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (value.kind === "spend") {
    const { enabled, used_minor, limit_minor, decimal_places, currency } = value;
    if (
      typeof enabled !== "boolean" ||
      !isFiniteNumber(used_minor) ||
      !isFiniteNumber(limit_minor) ||
      !isFiniteNumber(decimal_places) ||
      typeof currency !== "string"
    ) {
      return null;
    }
    const scale = 10 ** decimal_places;

    return { kind: "spend", enabled, used: used_minor / scale, limit: limit_minor / scale, currency };
  }

  if (value.kind === "credits") {
    const { has_credits, unlimited } = value;
    const balance = Number(value.balance ?? 0);
    if (typeof has_credits !== "boolean" || typeof unlimited !== "boolean" || !Number.isFinite(balance)) {
      return null;
    }

    return { kind: "credits", hasCredits: has_credits, unlimited, balance };
  }

  return null;
};

const parseHttpError = (httpStatus: unknown): ReadResult => {
  // 403 also covers a Cloudflare check, which the login window resolves.
  if (httpStatus === 401 || httpStatus === 403) {
    return { kind: "login_required" };
  }
  if (httpStatus === 429) {
    return { kind: "error", message: "The server is rate limiting requests. Try again later." };
  }

  return { kind: "error", message: `The server returned HTTP ${String(httpStatus)}.` };
};

export const parseReaderOutput = (output: string): ReadResult => {
  const data = parseJson(output);
  if (!isRecord(data) || typeof data.status !== "string") {
    return { kind: "error", message: UNEXPECTED_OUTPUT };
  }

  if (data.status === "ok") {
    const fiveHour = parseWindow(data.five_hour);
    const sevenDay = parseWindow(data.seven_day);
    if (!fiveHour || !sevenDay) {
      return { kind: "error", message: STATUS_ERRORS.unexpected_response };
    }

    const plan = typeof data.plan === "string" && data.plan !== "" ? data.plan : null;

    return { kind: "ok", plan, fiveHour, sevenDay, extra: parseExtra(data.extra) };
  }

  if (data.status === "http_error") {
    return parseHttpError(data.http_status);
  }

  return { kind: "error", message: STATUS_ERRORS[data.status] ?? UNEXPECTED_OUTPUT };
};

export const applyReadResult = (
  state: ProviderState,
  result: ReadResult,
  readAt: Date,
): ProviderState => {
  if (result.kind === "ok") {
    return {
      usage: {
        plan: result.plan,
        fiveHour: result.fiveHour,
        sevenDay: result.sevenDay,
        extra: result.extra,
        readAt,
      },
      error: null,
      needsLogin: false,
    };
  }
  if (result.kind === "login_required") {
    return { usage: state.usage, error: LOGIN_REQUIRED_MESSAGE, needsLogin: true };
  }

  return { usage: state.usage, error: result.message, needsLogin: false };
};
