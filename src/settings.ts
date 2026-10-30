import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

import { readEnabledProviders, saveEnabledProviders, toggleProvider } from "./providers";
import { togglePersisted } from "./refresh";
import { PROVIDER_INFO, PROVIDERS, type ProviderId } from "./usage";
import { fitWindowToContent } from "./window-size";

// Must match the info window width in src-tauri/src/lib.rs.
const SETTINGS_WINDOW_WIDTH = 440;

const page = document.querySelector<HTMLElement>(".settings");
const list = document.querySelector<HTMLElement>("#providers");
const general = document.querySelector<HTMLElement>("#general");

const fit = (): void => {
  if (page) {
    void fitWindowToContent(page, SETTINGS_WINDOW_WIDTH);
  }
};

// The switch shows the system's state; a failed change leaves it as it was and says so.
const renderOpenAtLogin = (on: boolean, error: string | null): void => {
  if (!general) {
    return;
  }

  const row = document.createElement("label");
  row.className = "setting-row";
  const name = document.createElement("span");
  name.textContent = "Open at login";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.className = "switch";
  toggle.checked = on;
  toggle.addEventListener("change", () => {
    toggle.disabled = true;
    void togglePersisted(on, (value) => (value ? enable() : disable()), () => {})
      .then((next) => renderOpenAtLogin(next, null))
      .catch(() => renderOpenAtLogin(on, "Could not change opening at login."));
  });
  row.append(name, toggle);

  const rows: HTMLElement[] = [row];
  if (error) {
    const message = document.createElement("p");
    message.className = "error";
    message.textContent = error;
    rows.push(message);
  }
  general.replaceChildren(...rows);
  fit();
};

// One switch per provider; the last enabled one cannot be turned off.
const render = (enabled: readonly ProviderId[]): void => {
  if (!list) {
    return;
  }

  list.replaceChildren(
    ...PROVIDERS.map((provider) => {
      const info = PROVIDER_INFO[provider];
      const row = document.createElement("label");
      row.className = `setting-row provider-${provider}`;

      const name = document.createElement("span");
      name.className = "setting-name";
      name.textContent = info.name;
      const account = document.createElement("span");
      account.className = "muted";
      account.textContent = `${info.account} account`;
      const text = document.createElement("span");
      text.append(name, " ", account);

      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.className = "switch";
      toggle.checked = enabled.includes(provider);
      toggle.disabled = toggle.checked && enabled.length === 1;
      toggle.addEventListener("change", () => void choose(toggleProvider(enabled, provider)));

      row.append(text, toggle);

      return row;
    }),
  );
};

const choose = async (enabled: ProviderId[]): Promise<void> => {
  saveEnabledProviders(localStorage, enabled);
  render(enabled);
  await invoke("set_providers", { providers: enabled });
};

render(readEnabledProviders(localStorage));
fit();
void isEnabled()
  .then((on) => renderOpenAtLogin(on, null))
  .catch(() => renderOpenAtLogin(false, "Could not read whether the app opens at login."));
