import { PROVIDERS, type ProviderId } from "./usage";

export const PROVIDERS_KEY = "providers";

const isProviderId = (value: unknown): value is ProviderId =>
  PROVIDERS.some((provider) => provider === value);

// Keeps the app's own order and drops unknown or repeated entries.
const normalize = (providers: readonly unknown[]): ProviderId[] =>
  PROVIDERS.filter((provider) => providers.some((item) => item === provider && isProviderId(item)));

// At least one provider is always on; anything unreadable means all of them.
export const readEnabledProviders = (storage: Pick<Storage, "getItem">): ProviderId[] => {
  try {
    const stored: unknown = JSON.parse(storage.getItem(PROVIDERS_KEY) ?? "null");
    const providers = Array.isArray(stored) ? normalize(stored) : [];

    return providers.length > 0 ? providers : [...PROVIDERS];
  } catch {
    return [...PROVIDERS];
  }
};

export const saveEnabledProviders = (
  storage: Pick<Storage, "setItem">,
  providers: readonly ProviderId[],
): void => {
  try {
    storage.setItem(PROVIDERS_KEY, JSON.stringify(providers));
  } catch {
    // The choice then lasts until the app restarts.
  }
};

// Turning off the last enabled provider is refused, so the panel is never empty.
export const toggleProvider = (enabled: readonly ProviderId[], provider: ProviderId): ProviderId[] => {
  if (!enabled.includes(provider)) {
    return normalize([...enabled, provider]);
  }

  const next = enabled.filter((item) => item !== provider);

  return next.length > 0 ? next : [...enabled];
};
