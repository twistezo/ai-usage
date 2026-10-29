// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderPanel, type PanelActions, type PanelView } from "./panel";
import { createEmptyStates, type ProviderState } from "./usage";

const now = new Date("2026-10-29T12:00:00Z");
const later = (minutes: number): Date => new Date(now.getTime() + minutes * 60_000);

const reading = (fields: Partial<NonNullable<ProviderState["usage"]>> = {}): ProviderState => ({
  usage: {
    plan: "team",
    fiveHour: { utilization: 13, resetsAt: later(282) },
    sevenDay: { utilization: 38, resetsAt: later(3 * 1440 + 16 * 60) },
    extra: null,
    readAt: now,
    ...fields,
  },
  error: null,
  needsLogin: false,
});

const createActions = (): PanelActions => ({
  onRefresh: vi.fn(),
  onOpenWindow: vi.fn(),
  onToggleAlwaysOnTop: vi.fn(),
  onClose: vi.fn(),
  onLogin: vi.fn(),
  onHelp: vi.fn(),
  onQuit: vi.fn(),
});

let root: HTMLElement;
let actions: PanelActions;

const render = (view: Partial<PanelView> = {}): void => {
  renderPanel(
    root,
    { mode: "panel", states: createEmptyStates(), refreshing: false, alwaysOnTop: false, ...view },
    now,
    actions,
  );
};

const section = (provider: "codex" | "claude"): HTMLElement => {
  const element = root.querySelector<HTMLElement>(`.provider-${provider}`);
  if (!element) {
    throw new Error(`No ${provider} section`);
  }

  return element;
};

const buttonByText = (text: string): HTMLButtonElement => {
  const button = [...root.querySelectorAll("button")].find((item) => item.textContent?.includes(text));
  if (!button) {
    throw new Error(`No button "${text}"`);
  }

  return button;
};

beforeEach(() => {
  root = document.createElement("main");
  actions = createActions();
});

describe("renderPanel: readings", () => {
  it("shows plan, both limits with resets and their bars", () => {
    render({ states: { ...createEmptyStates(), claude: reading() } });
    const claude = section("claude");

    expect(claude.querySelector(".provider-plan")?.textContent).toBe("Team");
    expect([...claude.querySelectorAll(".usage-summary")].map((row) => row.textContent)).toEqual(["13%5h", "38%1w"]);
    expect([...claude.querySelectorAll(".usage-reset")].map((row) => row.textContent)).toEqual(["↻ 4h 42m", "↻ 3d 16h"]);
    expect([...claude.querySelectorAll<HTMLElement>(".bar-fill")].map((bar) => bar.style.width)).toEqual(["13%", "38%"]);
  });

  it("keeps bars inside the track for usage over 100%", () => {
    render({ states: { ...createEmptyStates(), codex: reading({ fiveHour: { utilization: 130, resetsAt: null } }) } });

    expect(section("codex").querySelector<HTMLElement>(".bar-fill")?.style.width).toBe("100%");
    expect(section("codex").querySelector(".usage-percent")?.textContent).toBe("130%");
  });

  it("shows Claude extra spend right-aligned and without a bar", () => {
    render({
      states: {
        ...createEmptyStates(),
        claude: reading({ extra: { kind: "spend", enabled: true, used: 1.18, limit: 1.5, currency: "EUR", decimals: 2 } }),
      },
    });
    const extra = section("claude").querySelector(".align-end");

    expect(extra?.textContent).toBe("1.18 / 1.50 EUR" + "Extra");
    expect(extra?.querySelector(".bar")).toBeNull();
  });

  it.each([
    [{ kind: "credits", unlimited: false, balance: 0 } as const, "Off"],
    [{ kind: "credits", unlimited: false, balance: 12.5 } as const, "12.5 left"],
    [{ kind: "credits", unlimited: true, balance: 0 } as const, "Unlimited"],
    [{ kind: "spend", enabled: false, used: 0, limit: 0, currency: "USD", decimals: 2 } as const, "Off"],
  ])("describes extra usage %o as %s", (extra, text) => {
    render({ states: { ...createEmptyStates(), codex: reading({ extra }) } });

    expect(section("codex").querySelector(".align-end .usage-percent")?.textContent).toBe(text);
  });

  it("waits for the first reading before showing a plan", () => {
    render();

    expect(section("codex").querySelector(".provider-plan")).toBeNull();
    expect(section("codex").querySelector(".empty")?.textContent).toBe("Waiting for the first reading…");
  });
});

describe("renderPanel: problems", () => {
  it("marks a reading older than 5 minutes as outdated", () => {
    render({ states: { ...createEmptyStates(), codex: reading({ readAt: later(-6) }) } });

    expect(section("codex").querySelector(".stale")?.textContent).toBe(
      "Outdated: no successful update for over 5 minutes",
    );
  });

  it("shows the error instead of the outdated note when a refresh failed", () => {
    render({
      states: { ...createEmptyStates(), codex: { ...reading({ readAt: later(-6) }), error: "No connection." } },
    });

    expect(section("codex").querySelector(".stale")).toBeNull();
    expect(section("codex").querySelector(".error")?.textContent).toBe("No connection.");
  });

  it("offers login for the expired provider", () => {
    render({
      states: {
        ...createEmptyStates(),
        claude: { usage: null, error: "Session expired or needs verification.", needsLogin: true },
      },
    });

    buttonByText("Log in to Claude").click();

    expect(actions.onLogin).toHaveBeenCalledWith("claude");
  });

  // Plan, currency and errors come from remote pages; they must stay text.
  it("renders text from the reading as text, never as HTML", () => {
    const injected = '<img src=x onerror="alert(1)">';
    render({
      states: {
        ...createEmptyStates(),
        claude: {
          ...reading({ plan: injected, extra: { kind: "spend", enabled: true, used: 1, limit: 2, currency: injected, decimals: 2 } }),
          error: injected,
        },
      },
    });

    expect(root.querySelector("img")).toBeNull();
    expect(section("claude").querySelector(".error")?.textContent).toBe(injected);
  });
});

describe("renderPanel: controls", () => {
  it("offers the window, refresh, help and quit in the menu bar panel", () => {
    render();

    buttonByText("Window").click();
    buttonByText("Refresh").click();
    buttonByText("Help & about").click();
    buttonByText("Quit").click();

    expect(actions.onOpenWindow).toHaveBeenCalledOnce();
    expect(actions.onRefresh).toHaveBeenCalledOnce();
    expect(actions.onHelp).toHaveBeenCalledOnce();
    expect(actions.onQuit).toHaveBeenCalledOnce();
  });

  it("disables refresh while a refresh is running", () => {
    render({ refreshing: true });

    expect(buttonByText("Refreshing").disabled).toBe(true);
  });

  it("gives the standalone window pin, close and a drag area instead of the footer", () => {
    render({ mode: "window" });

    buttonByText("Pin").click();
    buttonByText("Close").click();

    expect(actions.onToggleAlwaysOnTop).toHaveBeenCalledOnce();
    expect(actions.onClose).toHaveBeenCalledOnce();
    expect(root.querySelector("header")?.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(root.querySelector("footer")).toBeNull();
    expect(root.textContent).not.toContain("Window");
  });

  it("shows the pinned state in the window", () => {
    render({ mode: "window", alwaysOnTop: true });

    expect(buttonByText("Pinned").classList.contains("active")).toBe(true);
  });
});
