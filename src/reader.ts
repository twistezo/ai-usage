import { invoke } from "@tauri-apps/api/core";

import { PROVIDER_INFO, type ProviderId, type ProviderState, type UsageWindow } from "./usage";

const CHROME_REQUIREMENTS = ["chrome_not_running", "tab_missing"] as const;
export type ChromeRequirement = (typeof CHROME_REQUIREMENTS)[number];

export type ReadResult =
  | { kind: "ok"; fiveHour: UsageWindow; sevenDay: UsageWindow }
  | { kind: "needs_chrome"; requirement: ChromeRequirement }
  | { kind: "error"; message: string };

const SETUP_HINT = "Zobacz „Pomoc i konfiguracja”.";

const APPLE_EVENT_ERRORS: Record<number, string> = {
  [-1743]: `Brak zgody macOS na sterowanie Chrome. ${SETUP_HINT}`,
  [-600]: "Chrome nie odpowiada. Uruchom go ponownie.",
  12: `Chrome nie zezwala na kod JavaScript z Apple Events. ${SETUP_HINT}`,
};

const STATUS_ERRORS: Record<string, string> = {
  network_error: "Brak połączenia lub przekroczony czas odpowiedzi.",
  unexpected_response: "Nieoczekiwany format odpowiedzi serwera.",
  timeout: "Przekroczono czas oczekiwania na odczyt.",
  load_timeout: "Karta nie załadowała się na czas.",
  busy: "Poprzedni odczyt nadal trwa.",
  page_reloaded: "Karta została przeładowana w trakcie odczytu.",
};

const UNEXPECTED_OUTPUT = "Nieoczekiwana odpowiedź skryptu odczytu.";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const isChromeRequirement = (value: unknown): value is ChromeRequirement =>
  CHROME_REQUIREMENTS.some((requirement) => requirement === value);

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

const httpErrorMessage = (provider: ProviderId, httpStatus: unknown): string => {
  if (httpStatus === 401 || httpStatus === 403) {
    return `Sesja wygasła lub wymaga weryfikacji. Otwórz ${PROVIDER_INFO[provider].domain} w Chrome i zaloguj się.`;
  }
  if (httpStatus === 429) {
    return "Serwer ogranicza liczbę zapytań. Spróbuj później.";
  }

  return `Serwer zwrócił błąd HTTP ${String(httpStatus)}.`;
};

export const parseReaderOutput = (output: string, provider: ProviderId): ReadResult => {
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

    return { kind: "ok", fiveHour, sevenDay };
  }

  if (isChromeRequirement(data.status)) {
    return { kind: "needs_chrome", requirement: data.status };
  }
  if (data.status === "http_error") {
    return { kind: "error", message: httpErrorMessage(provider, data.http_status) };
  }
  if (data.status === "apple_event_error" && typeof data.code === "number") {
    return {
      kind: "error",
      message: APPLE_EVENT_ERRORS[data.code] ?? `Błąd Apple Events (${data.code}).`,
    };
  }

  return { kind: "error", message: STATUS_ERRORS[data.status] ?? UNEXPECTED_OUTPUT };
};

// Chrome requirements are resolved by asking the user, so they leave the state unchanged.
export const applyReadResult = (
  state: ProviderState,
  result: ReadResult,
  readAt: Date,
): ProviderState => {
  if (result.kind === "ok") {
    return { usage: { fiveHour: result.fiveHour, sevenDay: result.sevenDay, readAt }, error: null };
  }
  if (result.kind === "error") {
    return { usage: state.usage, error: result.message };
  }

  return state;
};

export const readUsage = async (
  provider: ProviderId,
  openIfMissing: boolean,
): Promise<ReadResult> => {
  try {
    const output = await invoke<string>("read_usage", { provider, openIfMissing });

    return parseReaderOutput(output, provider);
  } catch (error) {
    return { kind: "error", message: `Nie udało się uruchomić odczytu: ${String(error)}` };
  }
};
