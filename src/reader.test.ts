import { describe, expect, it } from "vitest";

import { applyReadResult, parseReaderOutput, type ReadResult } from "./reader";
import type { ProviderState } from "./usage";

const report = (data: unknown): string => JSON.stringify(data);

const okReport = (fields: Record<string, unknown> = {}): string =>
  report({ status: "ok", five_hour: null, seven_day: null, ...fields });

describe("parseReaderOutput: successful readings", () => {
  it("reads plan, both windows and Claude extra spend", () => {
    const result = parseReaderOutput(
      okReport({
        plan: "team",
        five_hour: { utilization: 13, resets_at: "2026-10-29T20:49:59.852490+00:00" },
        seven_day: { utilization: 38, resets_at: "2026-11-01T13:59:59Z" },
        extra: {
          kind: "spend",
          enabled: true,
          used_minor: 118,
          limit_minor: 150,
          decimal_places: 2,
          currency: "EUR",
        },
      }),
    );

    expect(result).toEqual({
      kind: "ok",
      plan: "team",
      fiveHour: { utilization: 13, resetsAt: new Date("2026-10-29T20:49:59.852Z") },
      sevenDay: { utilization: 38, resetsAt: new Date("2026-11-01T13:59:59Z") },
      extra: { kind: "spend", enabled: true, used: 1.18, limit: 1.5, currency: "EUR", decimals: 2 },
    });
  });

  it("reads a Codex credit balance that the API sends as text", () => {
    const result = parseReaderOutput(okReport({ extra: { kind: "credits", unlimited: false, balance: "12.5" } }));

    expect(result.kind === "ok" && result.extra).toEqual({ kind: "credits", unlimited: false, balance: 12.5 });
  });

  it("treats a missing window as one that has not started", () => {
    const result = parseReaderOutput(okReport({ five_hour: null, seven_day: { utilization: null, resets_at: null } }));

    expect(result.kind === "ok" && [result.fiveHour, result.sevenDay]).toEqual([
      { utilization: 0, resetsAt: null },
      { utilization: 0, resetsAt: null },
    ]);
  });

  it("keeps utilization above 100% as reported", () => {
    const result = parseReaderOutput(okReport({ five_hour: { utilization: 120, resets_at: null } }));

    expect(result.kind === "ok" && result.fiveHour.utilization).toBe(120);
  });

  it("treats an empty or non-text plan as unknown", () => {
    const planOf = (plan: unknown): string | null | undefined => {
      const result = parseReaderOutput(okReport({ plan }));

      return result.kind === "ok" ? result.plan : undefined;
    };

    expect(planOf("")).toBeNull();
    expect(planOf(7)).toBeNull();
    expect(planOf(undefined)).toBeNull();
  });
});

describe("parseReaderOutput: malformed readings", () => {
  it.each([
    ["text utilization", { utilization: "41%", resets_at: null }],
    ["unparseable reset date", { utilization: 10, resets_at: "soon" }],
    ["numeric reset date", { utilization: 10, resets_at: 1793306946 }],
    ["window given as a list", [10]],
    ["no utilization field", { resets_at: "2026-10-29T20:00:00Z" }],
    ["an empty window", {}],
  ])("rejects a window with %s", (_, window) => {
    expect(parseReaderOutput(okReport({ five_hour: window }))).toEqual({
      kind: "error",
      message: "Unexpected server response format.",
    });
  });

  it("hides malformed extra usage but keeps the limits", () => {
    const result = parseReaderOutput(
      okReport({
        five_hour: { utilization: 10, resets_at: null },
        extra: { kind: "spend", enabled: true, used_minor: "a lot" },
      }),
    );

    expect(result.kind === "ok" && result.fiveHour.utilization).toBe(10);
    expect(result.kind === "ok" && result.extra).toBeNull();
  });

  // Out-of-range decimals would make toFixed throw while rendering the panel.
  it.each([-1, 2.5, 5, 100])("ignores extra spend with %s decimal places", (decimals) => {
    const result = parseReaderOutput(
      okReport({
        extra: {
          kind: "spend",
          enabled: true,
          used_minor: 1,
          limit_minor: 2,
          decimal_places: decimals,
          currency: "EUR",
        },
      }),
    );

    expect(result.kind === "ok" && result.extra).toBeNull();
  });

  // Regression: Number() threw on this object and the whole report was lost.
  it("survives a credit balance that cannot be converted to a number", () => {
    const output =
      '{"status":"ok","five_hour":{"utilization":10,"resets_at":null},"seven_day":null,' +
      '"extra":{"kind":"credits","unlimited":false,"balance":{"toString":null}}}';

    expect(() => parseReaderOutput(output)).not.toThrow();
    expect(parseReaderOutput(output)).toEqual({
      kind: "ok",
      plan: null,
      fiveHour: { utilization: 10, resetsAt: null },
      sevenDay: { utilization: 0, resetsAt: null },
      extra: null,
    });
  });

  it.each([
    ["a list", [5]],
    ["a boolean", true],
    ["empty text", ""],
    ["blank text", "  "],
    ["non-numeric text", "12 USD"],
    ["an object", { amount: 5 }],
  ])("ignores a credit balance given as %s", (_, balance) => {
    const result = parseReaderOutput(okReport({ extra: { kind: "credits", unlimited: false, balance } }));

    expect(result.kind === "ok" && result.extra).toBeNull();
  });

  it.each([
    ["a number", 3, 3],
    ["numeric text", "12.5", 12.5],
    ["a missing value", undefined, 0],
  ])("reads a credit balance given as %s", (_, balance, expected) => {
    const result = parseReaderOutput(okReport({ extra: { kind: "credits", unlimited: false, balance } }));

    expect(result.kind === "ok" && result.extra).toEqual({ kind: "credits", unlimited: false, balance: expected });
  });

  it("ignores an unknown extra kind", () => {
    const result = parseReaderOutput(okReport({ extra: { kind: "gift_card", balance: 5 } }));

    expect(result.kind === "ok" && result.extra).toBeNull();
  });
});

describe("parseReaderOutput: failures", () => {
  it.each([401, 403])("asks to log in again on HTTP %s", (httpStatus) => {
    expect(parseReaderOutput(report({ status: "http_error", http_status: httpStatus }))).toEqual({
      kind: "login_required",
    });
  });

  it("reports rate limiting without asking to log in", () => {
    expect(parseReaderOutput(report({ status: "http_error", http_status: 429 }))).toEqual({
      kind: "error",
      message: "The server is rate limiting requests. Try again later.",
    });
  });

  it("names the HTTP status of other server errors", () => {
    expect(parseReaderOutput(report({ status: "http_error", http_status: 502 }))).toEqual({
      kind: "error",
      message: "The server returned HTTP 502.",
    });
  });

  // The report comes from a remote page, so its text must not reach the panel verbatim.
  it("does not repeat a non-numeric HTTP status sent by the page", () => {
    const result = parseReaderOutput(report({ status: "http_error", http_status: "<b>pwned</b>" }));

    expect(result).toEqual({ kind: "error", message: "Unexpected reader output." });
  });

  it("explains network failures and changed response formats", () => {
    expect(parseReaderOutput(report({ status: "network_error" }))).toEqual({
      kind: "error",
      message: "No connection or the request timed out.",
    });
    expect(parseReaderOutput(report({ status: "unexpected_response" }))).toEqual({
      kind: "error",
      message: "Unexpected server response format.",
    });
  });

  it.each([
    ["text that is not JSON", "{broken"],
    ["a JSON list", "[1, 2]"],
    ["JSON null", "null"],
    ["a report without status", report({ five_hour: null })],
    ["an unknown status", report({ status: "something_new" })],
    ["a status inherited from Object", report({ status: "toString" })],
  ])("rejects %s", (_, output) => {
    expect(parseReaderOutput(output)).toEqual({ kind: "error", message: "Unexpected reader output." });
  });
});

describe("applyReadResult", () => {
  const readAt = new Date("2026-10-29T12:00:00Z");
  const previous: ProviderState = {
    usage: {
      plan: "plus",
      fiveHour: { utilization: 40, resetsAt: null },
      sevenDay: { utilization: 20, resetsAt: null },
      extra: null,
      readAt: new Date("2026-10-29T11:00:00Z"),
    },
    error: "Old error",
    needsLogin: true,
  };

  it("stores a new reading with its time and clears earlier problems", () => {
    const result: ReadResult = {
      kind: "ok",
      plan: "pro",
      fiveHour: { utilization: 55, resetsAt: null },
      sevenDay: { utilization: 25, resetsAt: null },
      extra: { kind: "credits", unlimited: false, balance: 0 },
    };

    expect(applyReadResult(previous, result, readAt)).toEqual({
      usage: { plan: "pro", fiveHour: result.fiveHour, sevenDay: result.sevenDay, extra: result.extra, readAt },
      error: null,
      needsLogin: false,
    });
  });

  it("keeps the last reading and offers login when the session expired", () => {
    expect(applyReadResult(previous, { kind: "login_required" }, readAt)).toEqual({
      usage: previous.usage,
      error: "Session expired or needs verification.",
      needsLogin: true,
    });
  });

  it("keeps the last reading on a temporary failure and drops the login offer", () => {
    expect(applyReadResult(previous, { kind: "error", message: "No connection." }, readAt)).toEqual({
      usage: previous.usage,
      error: "No connection.",
      needsLogin: false,
    });
  });

  it("has nothing to keep when the very first reading fails", () => {
    const empty: ProviderState = { usage: null, error: null, needsLogin: false };

    expect(applyReadResult(empty, { kind: "error", message: "No connection." }, readAt).usage).toBeNull();
  });
});
