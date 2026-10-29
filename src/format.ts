const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const LOCALE = "pl-PL";
const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit" });
const weekdayTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatPercent = (utilization: number): string => `${Math.round(utilization)}%`;

const formatDuration = (durationMs: number): string => {
  const totalMinutes = Math.ceil(durationMs / MINUTE_MS);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }
  if (minutes === 0) {
    return `${hours} h`;
  }

  return `${hours} h ${minutes} min`;
};

export const formatReset = (resetsAt: Date | null, now: Date): string => {
  if (!resetsAt) {
    return "Okno jeszcze się nie rozpoczęło";
  }

  const remainingMs = resetsAt.getTime() - now.getTime();

  if (remainingMs <= 0) {
    return "Reset już nastąpił";
  }
  if (remainingMs < DAY_MS) {
    return `Reset za ${formatDuration(remainingMs)}, o ${timeFormat.format(resetsAt)}`;
  }

  return `Reset: ${weekdayTimeFormat.format(resetsAt)}`;
};

const isSameDay = (first: Date, second: Date): boolean =>
  first.toDateString() === second.toDateString();

export const formatReadAt = (readAt: Date, now: Date): string =>
  isSameDay(readAt, now) ? timeFormat.format(readAt) : dateTimeFormat.format(readAt);
