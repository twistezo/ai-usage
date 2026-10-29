const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

const fullDateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "full",
  timeStyle: "short",
});

// en-US so that USD shows as "$1.18"; other currencies keep their own symbol.
export const formatMoney = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
};

export const formatPercent = (utilization: number): string => `${Math.round(utilization)}%`;

// Two largest units only: "2d 5h", "4h 22m", "45m".
const formatDuration = (durationMs: number): string => {
  const totalMinutes = Math.ceil(durationMs / MINUTE_MS);
  const days = Math.floor(totalMinutes / MINUTES_PER_DAY);
  const hours = Math.floor((totalMinutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;

  if (days > 0) {
    return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
};

export const formatReset = (resetsAt: Date | null, now: Date): string => {
  if (!resetsAt) {
    return "Window not started";
  }

  const remainingMs = resetsAt.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return "Already reset";
  }

  return `Resets in ${formatDuration(remainingMs)}`;
};

export const formatFullDate = (date: Date): string => fullDateTimeFormat.format(date);
