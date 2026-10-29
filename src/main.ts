import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { renderPanel, type PanelActions, type PanelView } from "./panel";
import { applyReadResult, readUsage, type ChromeRequirement } from "./reader";
import { createEmptyStates, PROVIDER_INFO, PROVIDERS, type ProviderId } from "./usage";

const PANEL_WIDTH = 340;

const app = document.querySelector<HTMLElement>("#app");
const view: PanelView = {
  states: createEmptyStates(),
  refreshing: false,
  chromePrompt: null,
};

// Panel height follows its content.
const fitWindowToContent = async (root: HTMLElement): Promise<void> => {
  const height = Math.ceil(root.getBoundingClientRect().height);
  await getCurrentWindow().setSize(new LogicalSize(PANEL_WIDTH, height));
};

if (app) {
  const render = (): void => {
    renderPanel(app, view, new Date(), actions);
    void fitWindowToContent(app);
  };

  // Each provider is read independently; one failure never blocks the other.
  const refresh = async (providers: readonly ProviderId[], openIfMissing: boolean): Promise<void> => {
    view.refreshing = true;
    view.chromePrompt = null;
    render();

    const results = await Promise.all(
      providers.map(async (provider) => ({ provider, result: await readUsage(provider, openIfMissing) })),
    );

    const readAt = new Date();
    const needChrome: ProviderId[] = [];
    let requirement: ChromeRequirement = "tab_missing";
    for (const { provider, result } of results) {
      if (result.kind === "needs_chrome") {
        needChrome.push(provider);
        requirement = result.requirement;
        continue;
      }
      view.states[provider] = applyReadResult(view.states[provider], result, readAt);
    }

    view.refreshing = false;
    view.chromePrompt = needChrome.length > 0 ? { providers: needChrome, requirement } : null;
    render();
  };

  const cancelChrome = (): void => {
    for (const provider of view.chromePrompt?.providers ?? []) {
      view.states[provider] = {
        ...view.states[provider],
        error: `Pominięto: brak otwartej karty ${PROVIDER_INFO[provider].domain} w Chrome.`,
      };
    }
    view.chromePrompt = null;
    render();
  };

  const actions: PanelActions = {
    onRefresh: () => void refresh(PROVIDERS, false),
    onConfirmChrome: () => void refresh(view.chromePrompt?.providers ?? [], true),
    onCancelChrome: cancelChrome,
    onHelp: () => void invoke("open_help"),
    onAbout: () => void invoke("open_about"),
    onQuit: () => void invoke("quit"),
  };

  render();

  // Relative reset times go stale while the panel is hidden.
  window.addEventListener("focus", render);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      void getCurrentWindow().hide();
    }
  });
}
