import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { renderPanel, type PanelActions, type PanelView } from "./panel";
import { applyReadResult, parseReaderOutput } from "./reader";
import { createEmptyStates, PROVIDERS, type ProviderId } from "./usage";
import { fitWindowToContent } from "./window-size";

const PANEL_WIDTH = 340;
// Manual refresh stops showing progress if a hidden page never reports back.
const REFRESH_TIMEOUT_MS = 20_000;
// Must match REPORT_EVENT in src-tauri/src/session_reader.rs.
const REPORT_EVENT = "usage-report";

type UsageReport = {
  provider: ProviderId;
  output: string;
};

const app = document.querySelector<HTMLElement>("#app");
const view: PanelView = {
  states: createEmptyStates(),
  refreshing: false,
};

if (app) {
  const pending = new Set<ProviderId>();
  let refreshTimeout: number | undefined;

  const render = (): void => {
    renderPanel(app, view, new Date(), actions);
    void fitWindowToContent(app, PANEL_WIDTH);
  };

  const finishRefresh = (): void => {
    pending.clear();
    window.clearTimeout(refreshTimeout);
    view.refreshing = false;
  };

  const refresh = async (): Promise<void> => {
    PROVIDERS.forEach((provider) => pending.add(provider));
    view.refreshing = true;
    render();
    refreshTimeout = window.setTimeout(() => {
      finishRefresh();
      render();
    }, REFRESH_TIMEOUT_MS);

    try {
      await invoke("refresh_usage");
    } catch {
      finishRefresh();
      render();
    }
  };

  const actions: PanelActions = {
    onRefresh: () => void refresh(),
    onLogin: (provider) => void invoke("open_login", { provider }),
    onHelp: () => void invoke("open_help"),
    onAbout: () => void invoke("open_about"),
    onQuit: () => void invoke("quit"),
  };

  // Readings arrive from hidden windows: every minute and after each refresh.
  // The first refresh waits for the listener, so the startup reading is not lost.
  void listen<UsageReport>(REPORT_EVENT, ({ payload }) => {
    const result = parseReaderOutput(payload.output);
    view.states[payload.provider] = applyReadResult(view.states[payload.provider], result, new Date());
    pending.delete(payload.provider);
    if (view.refreshing && pending.size === 0) {
      finishRefresh();
    }
    render();
  }).then(() => invoke("refresh_usage"));

  render();

  // Relative reset times go stale while the panel is hidden.
  window.addEventListener("focus", render);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      void getCurrentWindow().hide();
    }
  });
}
