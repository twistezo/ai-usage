import { describe, expect, it } from "vitest";

import { isStale, usageLevel, type ProviderUsage } from "./usage";

describe("usageLevel", () => {
  it("warns from 70% and alarms from 90%", () => {
    expect(usageLevel(69)).toBe("normal");
    expect(usageLevel(70)).toBe("high");
    expect(usageLevel(89)).toBe("high");
    expect(usageLevel(90)).toBe("critical");
    expect(usageLevel(100)).toBe("critical");
  });
});

describe("isStale", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  const readAt = (minutesAgo: number): ProviderUsage => ({
    fiveHour: { utilization: 0, resetsAt: null },
    sevenDay: { utilization: 0, resetsAt: null },
    readAt: new Date(now.getTime() - minutesAgo * 60_000),
  });

  it("treats a reading up to 15 minutes old as current", () => {
    expect(isStale(readAt(15), now)).toBe(false);
  });

  it("marks an older reading as stale", () => {
    expect(isStale(readAt(16), now)).toBe(true);
  });
});
