export const PROVIDERS = ["codex", "claude"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

// `account` is the service the user logs in to.
export const PROVIDER_INFO: Record<ProviderId, { name: string; account: string }> = {
  codex: { name: "Codex", account: "ChatGPT" },
  claude: { name: "Claude", account: "Claude" },
};

// `resetsAt` is null when the window has not started, e.g. no usage yet.
export type UsageWindow = {
  utilization: number;
  resetsAt: Date | null;
};

// Paid usage beyond the plan. Claude reports money spent this month,
// Codex only the balance of purchased credits.
// `decimals` is how many digits the currency uses after the point.
export type ExtraUsage =
  | {
      kind: "spend";
      enabled: boolean;
      used: number;
      limit: number;
      currency: string;
      decimals: number;
    }
  | { kind: "credits"; unlimited: boolean; balance: number };

// `plan` is the subscription as the service names it, e.g. "plus" or "team".
export type ProviderUsage = {
  plan: string | null;
  fiveHour: UsageWindow;
  sevenDay: UsageWindow;
  extra: ExtraUsage | null;
  readAt: Date;
};

// Last successful reading is kept when a later refresh fails.
export type ProviderState = {
  usage: ProviderUsage | null;
  error: string | null;
  needsLogin: boolean;
};

export type UsageStates = Record<ProviderId, ProviderState>;

export const createEmptyStates = (): UsageStates => ({
  codex: { usage: null, error: null, needsLogin: false },
  claude: { usage: null, error: null, needsLogin: false },
});

// Background refresh runs every minute, so a few missed readings mean trouble.
export const STALE_AFTER_MINUTES = 5;
const STALE_AFTER_MS = STALE_AFTER_MINUTES * 60_000;

export const isStale = (usage: ProviderUsage, now: Date): boolean =>
  now.getTime() - usage.readAt.getTime() > STALE_AFTER_MS;
