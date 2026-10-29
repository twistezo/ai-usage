import { applyReadResult } from "./reader";
import { PROVIDERS, type ProviderId, type UsageStates } from "./usage";

// A manual refresh lasts until every provider has reported back.
// Readings also arrive on their own every minute; those never start or end a refresh.
export type RefreshState = {
  refreshing: boolean;
  pending: ReadonlySet<ProviderId>;
};

export const IDLE: RefreshState = { refreshing: false, pending: new Set() };

export const startRefresh = (): RefreshState => ({ refreshing: true, pending: new Set(PROVIDERS) });

export const receiveReport = (state: RefreshState, provider: ProviderId): RefreshState => {
  if (!state.refreshing) {
    return state;
  }

  const pending = new Set(state.pending);
  pending.delete(provider);

  return pending.size === 0 ? IDLE : { refreshing: true, pending };
};

// Providers that never answered get a visible error; their last reading stays.
export const markUnanswered = (
  states: UsageStates,
  providers: ReadonlySet<ProviderId>,
  message: string,
  now: Date,
): UsageStates => {
  const next = { ...states };
  for (const provider of providers) {
    next[provider] = applyReadResult(states[provider], { kind: "error", message }, now);
  }

  return next;
};

// Applies the new value first and stores it only once that worked, so a failure
// leaves both the window and the stored preference unchanged.
export const togglePersisted = async (
  current: boolean,
  apply: (value: boolean) => Promise<void>,
  save: (value: boolean) => void,
): Promise<boolean> => {
  const next = !current;
  await apply(next);
  save(next);

  return next;
};

// A per-viewer convenience, so a storage failure only loses the preference.
export const readFlag = (storage: Pick<Storage, "getItem">, key: string): boolean => {
  try {
    return storage.getItem(key) === "true";
  } catch {
    return false;
  }
};

export const saveFlag = (storage: Pick<Storage, "setItem">, key: string, value: boolean): void => {
  try {
    storage.setItem(key, String(value));
  } catch {
    // The preference is optional.
  }
};
