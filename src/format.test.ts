import { describe, expect, it } from "vitest";

import { formatPercent, formatPlan, formatReset, formatSpend } from "./format";

const now = new Date(2026, 9, 29, 12, 0);
const minutesLater = (minutes: number): Date => new Date(now.getTime() + minutes * 60_000);

describe("formatReset", () => {
  it("shows hours and minutes within a day", () => {
    expect(formatReset(minutesLater(262), now)).toBe("Resets in 4h 22m");
  });

  it("shows only minutes under an hour and only hours on full hours", () => {
    expect(formatReset(minutesLater(45), now)).toBe("Resets in 45m");
    expect(formatReset(minutesLater(180), now)).toBe("Resets in 3h");
  });

  it("shows days and hours for the weekly window", () => {
    expect(formatReset(minutesLater(2 * 24 * 60 + 5 * 60 + 30), now)).toBe("Resets in 2d 5h");
    expect(formatReset(minutesLater(3 * 24 * 60), now)).toBe("Resets in 3d");
  });

  it("rounds partial minutes up so the reset never looks earlier", () => {
    expect(formatReset(new Date(now.getTime() + 30_000), now)).toBe("Resets in 1m");
  });

  it("says the window already reset for an old reading", () => {
    expect(formatReset(minutesLater(-5), now)).toBe("Already reset");
  });

  it("explains a window that has not started", () => {
    expect(formatReset(null, now)).toBe("Window not started");
  });
});

describe("formatPercent", () => {
  it("rounds to whole percent", () => {
    expect(formatPercent(41.6)).toBe("42%");
  });
});

describe("formatSpend", () => {
  it("shows spent and limit with the currency code once", () => {
    expect(formatSpend(1.18, 2.34, "EUR")).toBe("1.18 / 2.34 EUR");
  });

  it("keeps two decimals for round amounts", () => {
    expect(formatSpend(0, 5, "USD")).toBe("0.00 / 5.00 USD");
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
