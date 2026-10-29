import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { applyReadResult, parseReaderOutput, type ReadResult } from "./reader";
import type { ProviderState } from "./usage";

const output = (data: unknown): string => JSON.stringify(data);

describe("parseReaderOutput", () => {
  it("reads both limit windows with reset times", () => {
    const result = parseReaderOutput(
      output({
        status: "ok",
        five_hour: { utilization: 41, resets_at: "2026-10-29T12:39:59.642987+00:00" },
        seven_day: { utilization: 21, resets_at: "2026-11-01T13:59:59.643011+00:00" },
      }),
      "claude",
    );

    expect(result).toEqual({
      kind: "ok",
      fiveHour: { utilization: 41, resetsAt: new Date("2026-10-29T12:39:59.642Z") },
      sevenDay: { utilization: 21, resetsAt: new Date("2026-11-01T13:59:59.643Z") },
    });
  });

  it("treats a window that has not started as unused", () => {
    const result = parseReaderOutput(
      output({
        status: "ok",
        five_hour: null,
        seven_day: { utilization: 3, resets_at: null },
      }),
      "codex",
    );

    expect(result).toEqual({
      kind: "ok",
      fiveHour: { utilization: 0, resetsAt: null },
      sevenDay: { utilization: 3, resetsAt: null },
    });
  });

  it("rejects a reading with an unparseable reset time", () => {
    const result = parseReaderOutput(
      output({
        status: "ok",
        five_hour: { utilization: 10, resets_at: "soon" },
        seven_day: null,
      }),
      "codex",
    );

    expect(result).toEqual({ kind: "error", message: "Nieoczekiwany format odpowiedzi serwera." });
  });

  it("rejects a reading without a numeric utilization", () => {
    const result = parseReaderOutput(
      output({ status: "ok", five_hour: { utilization: "41%" }, seven_day: null }),
      "claude",
    );

    expect(result.kind).toBe("error");
  });

  it("asks for Chrome when it is closed or the tab is missing", () => {
    expect(parseReaderOutput(output({ status: "chrome_not_running" }), "codex")).toEqual({
      kind: "needs_chrome",
      requirement: "chrome_not_running",
    });
    expect(parseReaderOutput(output({ status: "tab_missing" }), "claude")).toEqual({
      kind: "needs_chrome",
      requirement: "tab_missing",
    });
  });

  it("tells the user to log in again on an expired session", () => {
    const result = parseReaderOutput(
      output({ status: "http_error", step: "usage", http_status: 401 }),
      "codex",
    );

    expect(result).toEqual({
      kind: "error",
      message: "Sesja wygasła lub wymaga weryfikacji. Otwórz chatgpt.com w Chrome i zaloguj się.",
    });
  });

  it("points to setup when Chrome blocks JavaScript from Apple Events", () => {
    const result = parseReaderOutput(output({ status: "apple_event_error", code: 12 }), "claude");

    expect(result).toEqual({
      kind: "error",
      message: "Chrome nie zezwala na kod JavaScript z Apple Events. Zobacz „Pomoc i konfiguracja”.",
    });
  });

  it("points to setup when macOS denies automation", () => {
    const result = parseReaderOutput(output({ status: "apple_event_error", code: -1743 }), "claude");

    expect(result.kind === "error" && result.message).toContain("Brak zgody macOS");
  });

  it("reports an unknown Apple Events error with its code", () => {
    const result = parseReaderOutput(output({ status: "apple_event_error", code: -1708 }), "codex");

    expect(result).toEqual({ kind: "error", message: "Błąd Apple Events (-1708)." });
  });

  it("reports output that is not JSON", () => {
    expect(parseReaderOutput("execution error", "codex")).toEqual({
      kind: "error",
      message: "Nieoczekiwana odpowiedź skryptu odczytu.",
    });
  });

  it("reports an unknown status", () => {
    expect(parseReaderOutput(output({ status: "something_new" }), "codex").kind).toBe("error");
  });
});

describe("applyReadResult", () => {
  const readAt = new Date("2026-10-29T12:00:00Z");
  const previous: ProviderState = {
    usage: {
      fiveHour: { utilization: 40, resetsAt: null },
      sevenDay: { utilization: 20, resetsAt: null },
      readAt: new Date("2026-10-29T11:00:00Z"),
    },
    error: null,
  };

  it("replaces the reading and clears the error after a successful refresh", () => {
    const result: ReadResult = {
      kind: "ok",
      fiveHour: { utilization: 55, resetsAt: null },
      sevenDay: { utilization: 25, resetsAt: null },
    };

    expect(applyReadResult({ ...previous, error: "old" }, result, readAt)).toEqual({
      usage: { fiveHour: result.fiveHour, sevenDay: result.sevenDay, readAt },
      error: null,
    });
  });

  it("keeps the last good reading when a refresh fails", () => {
    const next = applyReadResult(previous, { kind: "error", message: "Brak połączenia." }, readAt);

    expect(next).toEqual({ usage: previous.usage, error: "Brak połączenia." });
  });

  it("leaves the state alone while waiting for the user to allow Chrome", () => {
    const next = applyReadResult(
      previous,
      { kind: "needs_chrome", requirement: "tab_missing" },
      readAt,
    );

    expect(next).toBe(previous);
  });
});
