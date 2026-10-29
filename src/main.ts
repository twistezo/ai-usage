import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { renderPanel, type PanelActions, type PanelView, type ViewMode } from "./panel";
import { applyReadResult, parseReaderOutput } from "./reader";
import {
  IDLE,
  readFlag,
  receiveReport,
  saveFlag,
  startRefresh,
  type RefreshState,
} from "./refresh";
import { createEmptyStates, type ProviderId } from "./usage";
import { fitWindowToContent } from "./window-size";

const PANEL_WIDTH = 340;
// Manual refresh stops showing progress if a hidden page never reports back.
const REFRESH_TIMEOUT_MS = 20_000;
// Countdowns and the "Outdated" note move on even when no reading arrives.
const RERENDER_INTERVAL_MS = 60_000;
// Must match REPORT_EVENT in src-tauri/src/session_reader.rs.
const REPORT_EVENT = "usage-report";

// Must match WINDOW_LABEL in src-tauri/src/lib.rs.
const WINDOW_LABEL = "window";
const ALWAYS_ON_TOP_KEY = "always-on-top";

type UsageReport = {
  provider: ProviderId;
  output: string;
};

const currentWindow = getCurrentWindow();
const mode: ViewMode = currentWindow.label === WINDOW_LABEL ? "window" : "panel";
// Lets the stylesheet draw the panel and the window as a rounded card.
document.documentElement.dataset.mode = mode;
const app = document.querySelector<HTMLElement>("#app");
const view: PanelView = {
  mode,
  states: createEmptyStates(),
  refreshing: false,
  alwaysOnTop: mode === "window" && readFlag(localStorage, ALWAYS_ON_TOP_KEY),
};

if (app) {
  let refreshState = IDLE;
  let refreshTimeout: number | undefined;

  const render = (): void => {
    renderPanel(app, view, new Date(), actions);
    void fitWindowToContent(app, PANEL_WIDTH);
  };

  const setRefreshState = (next: RefreshState): void => {
    refreshState = next;
    view.refreshing = next.refreshing;
    if (!next.refreshing) {
      window.clearTimeout(refreshTimeout);
    }
  };

  const finishRefresh = (): void => setRefreshState(IDLE);

  const refresh = async (): Promise<void> => {
    setRefreshState(startRefresh());
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

  const toggleAlwaysOnTop = async (): Promise<void> => {
    view.alwaysOnTop = !view.alwaysOnTop;
    saveFlag(localStorage, ALWAYS_ON_TOP_KEY, view.alwaysOnTop);
    render();
    await currentWindow.setAlwaysOnTop(view.alwaysOnTop);
  };

  const actions: PanelActions = {
    onRefresh: () => void refresh(),
    onOpenWindow: () => void invoke("open_window"),
    onToggleAlwaysOnTop: () => void toggleAlwaysOnTop(),
    onClose: () => void currentWindow.close(),
    onLogin: (provider) => void invoke("open_login", { provider }),
    onHelp: () => void invoke("open_help"),
    onQuit: () => void invoke("quit"),
  };

  // Readings arrive from hidden windows: every minute and after each refresh.
  // The first refresh waits for the listener, so the startup reading is not lost.
  void listen<UsageReport>(REPORT_EVENT, ({ payload }) => {
    const result = parseReaderOutput(payload.output);
    view.states[payload.provider] = applyReadResult(view.states[payload.provider], result, new Date());
    setRefreshState(receiveReport(refreshState, payload.provider));
    render();
  }).then(() => invoke("refresh_usage"));

  render();
  if (view.alwaysOnTop) {
    void currentWindow.setAlwaysOnTop(true);
  }

  // Relative reset times go stale while the panel is hidden.
  window.addEventListener("focus", render);
  window.setInterval(render, RERENDER_INTERVAL_MS);
  if (mode === "panel") {
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        void currentWindow.hide();
      }
    });
  }
}
