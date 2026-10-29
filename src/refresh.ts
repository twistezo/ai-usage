import { PROVIDERS, type ProviderId } from "./usage";

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
