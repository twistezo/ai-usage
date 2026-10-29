import { describe, expect, it } from "vitest";

import { formatPercent, formatPlan, formatReset, formatSpend } from "./format";
import { isStale, type ProviderUsage } from "./usage";

const now = new Date("2026-10-29T12:00:00Z");
const later = (minutes: number, seconds = 0): Date =>
  new Date(now.getTime() + minutes * 60_000 + seconds * 1000);

describe("formatReset", () => {
  it("shows hours and minutes for the 5h window", () => {
    expect(formatReset(later(262), now)).toBe("↻ 4h 22m");
  });

  it("shows days and hours for the weekly window", () => {
    expect(formatReset(later(2 * 1440 + 5 * 60 + 30), now)).toBe("↻ 2d 5h");
  });

  it("drops a zero second unit", () => {
    expect(formatReset(later(180), now)).toBe("↻ 3h");
    expect(formatReset(later(3 * 1440), now)).toBe("↻ 3d");
    expect(formatReset(later(1440 + 30), now)).toBe("↻ 1d");
  });

  it("rounds up so the reset never looks earlier than it is", () => {
    expect(formatReset(later(0, 30), now)).toBe("↻ 1m");
    expect(formatReset(later(59, 1), now)).toBe("↻ 1h");
  });

  it("says the window reset already when the reading is older than the reset", () => {
    expect(formatReset(now, now)).toBe("↻ now");
    expect(formatReset(later(-5), now)).toBe("↻ now");
  });

  it("explains a window that has not started", () => {
    expect(formatReset(null, now)).toBe("Not started");
  });
});

describe("formatPercent", () => {
  it("rounds to whole percent", () => {
    expect(formatPercent(41.5)).toBe("42%");
    expect(formatPercent(0.4)).toBe("0%");
  });

  it("shows usage over the limit as reported", () => {
    expect(formatPercent(120)).toBe("120%");
  });
});

describe("formatPlan", () => {
  it("capitalizes the plan name from the API", () => {
    expect(formatPlan("team")).toBe("Team");
    expect(formatPlan("plus")).toBe("Plus");
  });

  it("turns underscores into spaces", () => {
    expect(formatPlan("pro_lite")).toBe("Pro lite");
  });
});

describe("formatSpend", () => {
  it("shows spent and limit with the currency code once", () => {
    expect(formatSpend(1.18, 1.5, "EUR", 2)).toBe("1.18 / 1.50 EUR");
  });

  it("follows the currency's decimal places", () => {
    expect(formatSpend(150, 1000, "JPY", 0)).toBe("150 / 1000 JPY");
  });
});

describe("isStale", () => {
  const readAt = (minutesAgo: number): ProviderUsage => ({
    plan: null,
    fiveHour: { utilization: 0, resetsAt: null },
    sevenDay: { utilization: 0, resetsAt: null },
    extra: null,
    readAt: later(-minutesAgo),
  });

  it("treats a reading up to 5 minutes old as current", () => {
    expect(isStale(readAt(5), now)).toBe(false);
  });

  it("marks an older reading as outdated", () => {
    expect(isStale(readAt(5.1), now)).toBe(true);
  });

  it("does not mark a reading from the future as outdated", () => {
    expect(isStale(readAt(-1), now)).toBe(false);
  });
});
