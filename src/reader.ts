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

const UNEXPECTED_RESPONSE = "Unexpected server response format.";
// A Map, so statuses like "toString" never hit Object's built-in members.
const STATUS_ERRORS = new Map<string, string>([
  ["network_error", "No connection or the request timed out."],
  ["unexpected_response", UNEXPECTED_RESPONSE],
]);

const UNEXPECTED_OUTPUT = "Unexpected reader output.";
const LOGIN_REQUIRED_MESSAGE = "Session expired or needs verification.";

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
// A window must state its utilization: null counts as unused, a missing field as malformed.
const parseWindow = (value: unknown): UsageWindow | null => {
  if (value === null || value === undefined) {
    return { utilization: 0, resetsAt: null };
  }
  if (!isRecord(value) || !("utilization" in value)) {
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

// Codex sends the balance as text, e.g. "0". Only a number or numeric text counts;
// Number() alone would accept lists and booleans and throws on some objects.
const parseAmount = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const amount = Number(value);

  return Number.isFinite(amount) ? amount : null;
};

// Currencies use 0 to 4 decimal places; anything else is not a real currency format.
const MAX_DECIMAL_PLACES = 4;

const isDecimalPlaces = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_DECIMAL_PLACES;

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
      !isDecimalPlaces(decimal_places) ||
      typeof currency !== "string"
    ) {
      return null;
    }
    const scale = 10 ** decimal_places;

    return {
      kind: "spend",
      enabled,
      used: used_minor / scale,
      limit: limit_minor / scale,
      currency,
      decimals: decimal_places,
    };
  }

  if (value.kind === "credits") {
    const { unlimited } = value;
    const balance = parseAmount(value.balance);
    if (typeof unlimited !== "boolean" || balance === null) {
      return null;
    }

    return { kind: "credits", unlimited, balance };
  }

  return null;
};

const parseHttpError = (httpStatus: unknown): ReadResult => {
  // The report comes from a remote page; only a real status code is worth showing.
  if (typeof httpStatus !== "number" || !Number.isInteger(httpStatus)) {
    return { kind: "error", message: UNEXPECTED_OUTPUT };
  }
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
      return { kind: "error", message: UNEXPECTED_RESPONSE };
    }

    const plan = typeof data.plan === "string" && data.plan !== "" ? data.plan : null;

    return { kind: "ok", plan, fiveHour, sevenDay, extra: parseExtra(data.extra) };
  }

  if (data.status === "http_error") {
    return parseHttpError(data.http_status);
  }

  return { kind: "error", message: STATUS_ERRORS.get(data.status) ?? UNEXPECTED_OUTPUT };
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
