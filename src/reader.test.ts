import { describe, expect, it } from "vitest";

import {
  applyReadResult,
  LOGIN_REQUIRED_MESSAGE,
  parseReaderOutput,
  type ReadResult,
} from "./reader";
import type { ProviderState } from "./usage";

const output = (data: unknown): string => JSON.stringify(data);

describe("parseReaderOutput", () => {
  it("reads both limit windows with reset times", () => {
    const result = parseReaderOutput(
      output({
        status: "ok",
        plan: "team",
        five_hour: { utilization: 41, resets_at: "2026-10-29T12:39:59.642987+00:00" },
        seven_day: { utilization: 21, resets_at: "2026-11-01T13:59:59.643011+00:00" },
      }),
    );

    expect(result).toEqual({
      kind: "ok",
      plan: "team",
      fiveHour: { utilization: 41, resetsAt: new Date("2026-10-29T12:39:59.642Z") },
      sevenDay: { utilization: 21, resetsAt: new Date("2026-11-01T13:59:59.643Z") },
      extra: null,
    });
  });

  it("treats a window that has not started as unused", () => {
    const result = parseReaderOutput(
      output({
        status: "ok",
        five_hour: null,
        seven_day: { utilization: 3, resets_at: null },
      }),
    );

    expect(result).toEqual({
      kind: "ok",
      plan: null,
      fiveHour: { utilization: 0, resetsAt: null },
      sevenDay: { utilization: 3, resetsAt: null },
      extra: null,
    });
  });

  it("reads Claude extra usage spent this month in currency units", () => {
    const result = parseReaderOutput(
      output({
        status: "ok",
        five_hour: null,
        seven_day: null,
        extra: {
          kind: "spend",
          enabled: true,
          used_minor: 118,
          limit_minor: 150,
          decimal_places: 2,
          currency: "USD",
        },
      }),
    );

    expect(result.kind === "ok" && result.extra).toEqual({
      kind: "spend",
      enabled: true,
      used: 1.18,
      limit: 1.5,
      currency: "USD",
    });
  });

  it("reads the Codex credit balance sent as text", () => {
    const result = parseReaderOutput(
      output({
        status: "ok",
        five_hour: null,
        seven_day: null,
        extra: { kind: "credits", has_credits: true, unlimited: false, balance: "12.5" },
      }),
    );

    expect(result.kind === "ok" && result.extra).toEqual({
      kind: "credits",
      hasCredits: true,
      unlimited: false,
      balance: 12.5,
    });
  });

  it("hides malformed extra usage but keeps the limits", () => {
    const result = parseReaderOutput(
      output({
        status: "ok",
        five_hour: { utilization: 10, resets_at: null },
        seven_day: null,
        extra: { kind: "spend", enabled: true, used_minor: "a lot" },
      }),
    );

    expect(result).toEqual({
      kind: "ok",
      plan: null,
      fiveHour: { utilization: 10, resetsAt: null },
      sevenDay: { utilization: 0, resetsAt: null },
      extra: null,
    });
  });

  it("treats an empty or non-text plan as unknown", () => {
    const planOf = (plan: unknown): string | null | undefined => {
      const result = parseReaderOutput(output({ status: "ok", plan, five_hour: null, seven_day: null }));

      return result.kind === "ok" ? result.plan : undefined;
    };

    expect(planOf("")).toBeNull();
    expect(planOf(42)).toBeNull();
  });

  it("rejects a reading with an unparseable reset time", () => {
    const result = parseReaderOutput(
      output({
        status: "ok",
        five_hour: { utilization: 10, resets_at: "soon" },
        seven_day: null,
      }),
    );

    expect(result).toEqual({ kind: "error", message: "Unexpected server response format." });
  });

  it("rejects a reading without a numeric utilization", () => {
    const result = parseReaderOutput(
      output({ status: "ok", five_hour: { utilization: "41%" }, seven_day: null }),
    );

    expect(result.kind).toBe("error");
  });

  it("asks for login when the session expired", () => {
    expect(
      parseReaderOutput(output({ status: "http_error", step: "session", http_status: 401 })),
    ).toEqual({ kind: "login_required" });
  });

  it("asks for login when a verification check blocks the request", () => {
    expect(
      parseReaderOutput(output({ status: "http_error", step: "usage", http_status: 403 })),
    ).toEqual({ kind: "login_required" });
  });

  it("reports rate limiting without asking for login", () => {
    expect(parseReaderOutput(output({ status: "http_error", http_status: 429 }))).toEqual({
      kind: "error",
      message: "The server is rate limiting requests. Try again later.",
    });
  });

  it("reports other server errors with their status", () => {
    expect(parseReaderOutput(output({ status: "http_error", http_status: 502 }))).toEqual({
      kind: "error",
      message: "The server returned HTTP 502.",
    });
  });

  it("reports a network failure", () => {
    expect(parseReaderOutput(output({ status: "network_error" }))).toEqual({
      kind: "error",
      message: "No connection or the request timed out.",
    });
  });

  it("reports output that is not JSON", () => {
    expect(parseReaderOutput("{broken")).toEqual({
      kind: "error",
      message: "Unexpected reader output.",
    });
  });

  it("reports an unknown status", () => {
    expect(parseReaderOutput(output({ status: "something_new" })).kind).toBe("error");
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
    error: null,
    needsLogin: false,
  };

  it("replaces the reading and clears errors after a successful refresh", () => {
    const result: ReadResult = {
      kind: "ok",
      plan: "team",
      fiveHour: { utilization: 55, resetsAt: null },
      sevenDay: { utilization: 25, resetsAt: null },
      extra: { kind: "credits", hasCredits: false, unlimited: false, balance: 0 },
    };

    expect(
      applyReadResult({ ...previous, error: LOGIN_REQUIRED_MESSAGE, needsLogin: true }, result, readAt),
    ).toEqual({
      usage: {
        plan: "team",
        fiveHour: result.fiveHour,
        sevenDay: result.sevenDay,
        extra: result.extra,
        readAt,
      },
      error: null,
      needsLogin: false,
    });
  });

  it("keeps the last good reading and offers login when the session expired", () => {
    expect(applyReadResult(previous, { kind: "login_required" }, readAt)).toEqual({
      usage: previous.usage,
      error: LOGIN_REQUIRED_MESSAGE,
      needsLogin: true,
    });
  });

  it("keeps the last good reading on a temporary failure without offering login", () => {
    const next = applyReadResult(
      { ...previous, needsLogin: true },
      { kind: "error", message: "No connection." },
      readAt,
    );

    expect(next).toEqual({ usage: previous.usage, error: "No connection.", needsLogin: false });
  });
});
