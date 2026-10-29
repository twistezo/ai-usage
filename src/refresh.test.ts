import { describe, expect, it } from "vitest";

import {
  IDLE,
  markUnanswered,
  readFlag,
  receiveReport,
  saveFlag,
  startRefresh,
  togglePersisted,
} from "./refresh";
import { createEmptyStates, type ProviderState } from "./usage";

describe("manual refresh", () => {
  it("stays in progress until both providers have reported", () => {
    const afterCodex = receiveReport(startRefresh(), "codex");

    expect(afterCodex.refreshing).toBe(true);
    expect(receiveReport(afterCodex, "claude").refreshing).toBe(false);
  });

  it("finishes in whichever order the providers report", () => {
    const afterClaude = receiveReport(startRefresh(), "claude");

    expect(receiveReport(afterClaude, "codex").refreshing).toBe(false);
  });

  it("does not finish early when the same provider reports twice", () => {
    const twiceCodex = receiveReport(receiveReport(startRefresh(), "codex"), "codex");

    expect(twiceCodex.refreshing).toBe(true);
  });

  it("is not started by a background reading", () => {
    expect(receiveReport(IDLE, "codex").refreshing).toBe(false);
  });

  it("starts over when refreshed again before the first one ended", () => {
    const restarted = startRefresh();
    receiveReport(restarted, "codex");

    expect(receiveReport(restarted, "claude").refreshing).toBe(true);
  });
});

describe("providers that never answered", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  const lastReading: ProviderState = {
    usage: {
      plan: "plus",
      fiveHour: { utilization: 34, resetsAt: null },
      sevenDay: { utilization: 27, resetsAt: null },
      extra: null,
      readAt: new Date("2026-10-29T11:59:00Z"),
    },
    error: null,
    needsLogin: false,
  };

  it("get a visible error and keep their last reading", () => {
    const states = { ...createEmptyStates(), codex: lastReading };

    const next = markUnanswered(states, new Set(["codex"] as const), "No answer.", now);

    expect(next.codex).toEqual({ ...lastReading, error: "No answer." });
  });

  it("leave providers that answered untouched", () => {
    const states = { ...createEmptyStates(), claude: lastReading };

    const next = markUnanswered(states, new Set(["codex"] as const), "No answer.", now);

    expect(next.claude).toBe(lastReading);
    expect(next.codex.error).toBe("No answer.");
  });

  it("replace the endless wait for a first reading with the error", () => {
    const next = markUnanswered(createEmptyStates(), startRefresh().pending, "No answer.", now);

    expect([next.codex.error, next.claude.error]).toEqual(["No answer.", "No answer."]);
    expect(next.codex.usage).toBeNull();
  });

  it("change nothing when everyone answered", () => {
    const states = { ...createEmptyStates(), codex: lastReading };

    expect(markUnanswered(states, IDLE.pending, "No answer.", now)).toEqual(states);
  });
});

describe("toggling a stored window setting", () => {
  it("applies the new value and then stores it", async () => {
    const applied: boolean[] = [];
    const saved: boolean[] = [];

    const next = await togglePersisted(
      false,
      async (value) => void applied.push(value),
      (value) => void saved.push(value),
    );

    expect(next).toBe(true);
    expect(applied).toEqual([true]);
    expect(saved).toEqual([true]);
  });

  it("stores nothing when the window refuses the change", async () => {
    const saved: boolean[] = [];

    const toggle = togglePersisted(
      true,
      async () => {
        throw new Error("Window gone");
      },
      (value) => void saved.push(value),
    );

    await expect(toggle).rejects.toThrow("Window gone");
    expect(saved).toEqual([]);
  });
});

describe("stored flags", () => {
  const storage = (items: Record<string, string> = {}): Storage => {
    const map = new Map(Object.entries(items));

    return {
      length: 0,
      clear: () => map.clear(),
      key: () => null,
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
      removeItem: (key) => void map.delete(key),
    };
  };

  const failing: Storage = {
    length: 0,
    clear: () => undefined,
    key: () => null,
    getItem: () => {
      throw new Error("Storage disabled");
    },
    setItem: () => {
      throw new Error("Storage full");
    },
    removeItem: () => undefined,
  };

  it("remembers a flag between sessions", () => {
    const shared = storage();
    saveFlag(shared, "always-on-top", true);

    expect(readFlag(shared, "always-on-top")).toBe(true);
  });

  it("can turn a flag off again", () => {
    const shared = storage({ "always-on-top": "true" });
    saveFlag(shared, "always-on-top", false);

    expect(readFlag(shared, "always-on-top")).toBe(false);
  });

  it("is off when never set or set to anything other than true", () => {
    expect(readFlag(storage(), "always-on-top")).toBe(false);
    expect(readFlag(storage({ "always-on-top": "yes" }), "always-on-top")).toBe(false);
  });

  it("falls back to off when storage is unavailable, without throwing", () => {
    expect(() => saveFlag(failing, "always-on-top", true)).not.toThrow();
    expect(readFlag(failing, "always-on-top")).toBe(false);
  });
});
