export const PROVIDERS = ["codex", "claude"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const PROVIDER_INFO: Record<ProviderId, { name: string; plan: string; domain: string }> = {
  codex: { name: "Codex", plan: "Plus", domain: "chatgpt.com" },
  claude: { name: "Claude", plan: "Pro", domain: "claude.ai" },
};

// `resetsAt` is null when the window has not started, e.g. no usage yet.
export type UsageWindow = {
  utilization: number;
  resetsAt: Date | null;
};

export type ProviderUsage = {
  fiveHour: UsageWindow;
  sevenDay: UsageWindow;
  readAt: Date;
};

// Last successful reading is kept when a later refresh fails.
export type ProviderState = {
  usage: ProviderUsage | null;
  error: string | null;
};

export type UsageStates = Record<ProviderId, ProviderState>;

export const createEmptyStates = (): UsageStates => ({
  codex: { usage: null, error: null },
  claude: { usage: null, error: null },
});

const STALE_AFTER_MS = 15 * 60_000;

export const isStale = (usage: ProviderUsage, now: Date): boolean =>
  now.getTime() - usage.readAt.getTime() > STALE_AFTER_MS;

const USAGE_LEVELS = ["normal", "high", "critical"] as const;
export type UsageLevel = (typeof USAGE_LEVELS)[number];

export const usageLevel = (utilization: number): UsageLevel => {
  if (utilization >= 90) {
    return "critical";
  }
  if (utilization >= 70) {
    return "high";
  }

  return "normal";
};
