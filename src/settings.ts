import { invoke } from "@tauri-apps/api/core";

import { readEnabledProviders, saveEnabledProviders, toggleProvider } from "./providers";
import { PROVIDER_INFO, PROVIDERS, type ProviderId } from "./usage";
import { fitWindowToContent } from "./window-size";

// Must match the info window width in src-tauri/src/lib.rs.
const SETTINGS_WINDOW_WIDTH = 440;

const page = document.querySelector<HTMLElement>(".settings");
const list = document.querySelector<HTMLElement>("#providers");

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
if (page) {
  void fitWindowToContent(page, SETTINGS_WINDOW_WIDTH);
}
