import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { renderPanel, type PanelActions, type PanelView, type ViewMode } from "./panel";
import { applyReadResult, parseReaderOutput } from "./reader";
import {
  IDLE,
  markUnanswered,
  readFlag,
  receiveReport,
  saveFlag,
  startRefresh,
  togglePersisted,
  type RefreshState,
} from "./refresh";
import { createEmptyStates, PROVIDERS, PROVIDER_INFO, type ProviderId } from "./usage";
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

const NO_ANSWER = "No answer from the site yet. It retries every minute.";
const REFRESH_FAILED = "Could not start the refresh. It retries every minute.";
const READER_UNAVAILABLE = "Could not connect to the background reader. Restart the app.";

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
  notice: null,
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

  // Ends the refresh; providers still waiting get `message` instead of silence.
  const failPending = (message: string): void => {
    view.states = markUnanswered(view.states, refreshState.pending, message, new Date());
    setRefreshState(IDLE);
    render();
  };

  const refresh = async (): Promise<void> => {
    window.clearTimeout(refreshTimeout);
    setRefreshState(startRefresh());
    render();
    refreshTimeout = window.setTimeout(() => failPending(NO_ANSWER), REFRESH_TIMEOUT_MS);

    try {
      await invoke("refresh_usage");
    } catch {
      failPending(REFRESH_FAILED);
    }
  };

  // Runs a window action and explains a failure in the panel instead of doing nothing.
  const attempt = async (task: () => Promise<unknown>, failure: string): Promise<void> => {
    view.notice = null;
    try {
      await task();
    } catch {
      view.notice = failure;
      render();
    }
  };

  const toggleAlwaysOnTop = (): Promise<void> =>
    attempt(async () => {
      view.alwaysOnTop = await togglePersisted(
        view.alwaysOnTop,
        (value) => currentWindow.setAlwaysOnTop(value),
        (value) => saveFlag(localStorage, ALWAYS_ON_TOP_KEY, value),
      );
      render();
    }, "Could not change keeping the window on top.");

  const actions: PanelActions = {
    onRefresh: () => void refresh(),
    onOpenWindow: () => void attempt(() => invoke("open_window"), "Could not open the window."),
    onToggleAlwaysOnTop: () => void toggleAlwaysOnTop(),
    onClose: () => void attempt(() => currentWindow.close(), "Could not close the window."),
    onLogin: (provider) =>
      void attempt(
        () => invoke("open_login", { provider }),
        `Could not open the ${PROVIDER_INFO[provider].account} login window.`,
      ),
    onHelp: () => void attempt(() => invoke("open_help"), "Could not open Help & about."),
    onQuit: () => void attempt(() => invoke("quit"), "Could not quit. Try again."),
  };

  // Readings arrive from hidden windows: every minute and after each refresh.
  // The first refresh waits for the listener, so the startup reading is not lost.
  void listen<UsageReport>(REPORT_EVENT, ({ payload }) => {
    const result = parseReaderOutput(payload.output);
    view.states[payload.provider] = applyReadResult(view.states[payload.provider], result, new Date());
    setRefreshState(receiveReport(refreshState, payload.provider));
    render();
  })
    .then(() => refresh())
    .catch(() => {
      view.states = markUnanswered(view.states, new Set(PROVIDERS), READER_UNAVAILABLE, new Date());
      render();
    });

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
