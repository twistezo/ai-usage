import { describe, expect, it } from "vitest";

import { isStale, type ProviderUsage } from "./usage";

describe("isStale", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  const readAt = (minutesAgo: number): ProviderUsage => ({
    plan: null,
    fiveHour: { utilization: 0, resetsAt: null },
    sevenDay: { utilization: 0, resetsAt: null },
    extra: null,
    readAt: new Date(now.getTime() - minutesAgo * 60_000),
  });

  it("treats a reading up to 5 minutes old as current", () => {
    expect(isStale(readAt(5), now)).toBe(false);
  });

  it("marks an older reading as stale", () => {
    expect(isStale(readAt(6), now)).toBe(true);
  });
});
