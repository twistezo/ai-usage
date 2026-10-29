import { describe, expect, it } from "vitest";

import { formatPercent, formatReadAt, formatReset } from "./format";

const now = new Date(2026, 9, 29, 12, 0);
const minutesLater = (minutes: number): Date => new Date(now.getTime() + minutes * 60_000);

describe("formatReset", () => {
  it("shows a countdown and clock time within a day", () => {
    expect(formatReset(minutesLater(130), now)).toBe("Reset za 2 h 10 min, o 14:10");
  });

  it("shows only minutes under an hour and only hours on full hours", () => {
    expect(formatReset(minutesLater(45), now)).toBe("Reset za 45 min, o 12:45");
    expect(formatReset(minutesLater(180), now)).toBe("Reset za 3 h, o 15:00");
  });

  it("rounds partial minutes up so the reset never looks earlier", () => {
    expect(formatReset(new Date(now.getTime() + 30_000), now)).toBe("Reset za 1 min, o 12:00");
  });

  it("shows the weekday for resets more than a day away", () => {
    expect(formatReset(new Date(2026, 10, 1, 14, 59), now)).toMatch(/^Reset: niedz\.?,? 14:59$/);
  });

  it("says the reset already happened for an old reading", () => {
    expect(formatReset(minutesLater(-5), now)).toBe("Reset już nastąpił");
  });

  it("explains a window that has not started", () => {
    expect(formatReset(null, now)).toBe("Okno jeszcze się nie rozpoczęło");
  });
});

describe("formatReadAt", () => {
  it("shows only the time for today's reading", () => {
    expect(formatReadAt(new Date(2026, 9, 29, 11, 52), now)).toBe("11:52");
  });

  it("adds the date for an older reading", () => {
    expect(formatReadAt(new Date(2026, 9, 28, 9, 5), now)).toContain("28");
  });
});

describe("formatPercent", () => {
  it("rounds to whole percent", () => {
    expect(formatPercent(41.6)).toBe("42%");
  });
});
