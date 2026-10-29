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
  onToggleCompact: vi.fn(),
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
    { mode: "panel", states: createEmptyStates(), refreshing: false, alwaysOnTop: false, compact: false, notice: null, ...view },
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

describe("renderPanel: failed actions", () => {
  it("explains an action that failed, right under the header", () => {
    render({ notice: "Could not open the window." });

    const notice = root.querySelector(".notice");
    expect(notice?.textContent).toBe("Could not open the window.");
    expect(notice?.previousElementSibling?.tagName).toBe("HEADER");
  });

  it("shows no notice when nothing failed", () => {
    render();

    expect(root.querySelector(".notice")).toBeNull();
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
    expect(root.dataset.tauriDragRegion).toBe("deep");
    expect(root.querySelector("footer")).toBeNull();
    expect(root.textContent).not.toContain("Window");
  });

  it("shows icon-only buttons in the window, in full and compact mode alike", () => {
    render({ mode: "window" });
    const full = root.classList.contains("icon-only");
    render({ mode: "window", compact: true });

    expect([full, root.classList.contains("icon-only")]).toEqual([true, true]);
    expect(buttonByText("Close").title).toBe("Close the window");
  });

  it("keeps labelled buttons in the menu bar panel", () => {
    render();

    expect(root.classList.contains("icon-only")).toBe(false);
  });

  it("lets the menu bar panel stay in place", () => {
    render({ mode: "window" });
    render({ mode: "panel" });

    expect(root.hasAttribute("data-tauri-drag-region")).toBe(false);
  });

  it("shows the pinned state in the window", () => {
    render({ mode: "window", alwaysOnTop: true });

    expect(buttonByText("Pinned").classList.contains("active")).toBe(true);
  });
});

describe("renderPanel: compact window", () => {
  const states = {
    codex: reading({ fiveHour: { utilization: 29, resetsAt: later(260) } }),
    claude: reading({ sevenDay: { utilization: 46, resetsAt: later(2 * 1440 + 15 * 60) } }),
  };

  it("shows one row per provider with percent, window label and bar", () => {
    render({ mode: "window", compact: true, states });

    const rows = [...root.querySelectorAll(".compact-row")];
    expect(rows.map((row) => row.querySelector(".provider-name")?.textContent)).toEqual(["Codex", "Claude"]);
    expect([...rows[0].querySelectorAll(".compact-meter")].map((meter) => meter.textContent)).toEqual([
      "29%5h",
      "38%1w",
    ]);
    expect(rows[0].querySelectorAll(".bar-fill")).toHaveLength(2);
  });

  it("leaves out resets, plan and extra usage, but keeps the reset in the tooltip", () => {
    render({
      mode: "window",
      compact: true,
      states: { ...states, claude: reading({ extra: { kind: "credits", unlimited: true, balance: 0 } }) },
    });

    expect(root.querySelector(".usage-reset")).toBeNull();
    expect(root.querySelector(".provider-plan")).toBeNull();
    expect(root.textContent).not.toContain("Extra");
    expect(root.querySelector<HTMLElement>(".compact-meter")?.title).toBe("↻ 4h 20m");
  });

  it("names the expand button in its hint", () => {
    render({ mode: "window", compact: true, states });

    expect(buttonByText("Expand").title).toBe("Show full details");
  });

  it("switches between compact and full with one button", () => {
    render({ mode: "window", states });
    buttonByText("Compact").click();

    expect(actions.onToggleCompact).toHaveBeenCalledOnce();
    expect(root.classList.contains("compact")).toBe(false);
    expect(root.querySelector(".compact-row")).toBeNull();
  });

  it("flags a failed refresh with a warning that explains it on hover", () => {
    render({ mode: "window", compact: true, states: { ...states, codex: { ...states.codex, error: "No connection." } } });

    expect(root.querySelector<HTMLElement>(".provider-codex .icon")?.title).toBe("No connection.");
    expect(root.querySelector(".provider-claude .icon")).toBeNull();
  });

  it("flags an outdated reading the same way", () => {
    render({ mode: "window", compact: true, states: { ...states, claude: reading({ readAt: later(-6) }) } });

    expect(root.querySelector<HTMLElement>(".provider-claude .icon")?.title).toBe(
      "Outdated: no successful update for over 5 minutes",
    );
  });

  it("offers login right in the row when the session expired", () => {
    render({
      mode: "window",
      compact: true,
      states: { ...states, claude: { usage: null, error: "Session expired or needs verification.", needsLogin: true } },
    });

    buttonByText("Log in").click();

    expect(actions.onLogin).toHaveBeenCalledWith("claude");
  });

  it("says when a provider has no data yet", () => {
    render({ mode: "window", compact: true });

    expect(root.querySelector(".provider-codex .empty")?.textContent).toBe("Waiting…");
  });

  it("never compacts the menu bar panel", () => {
    render({ mode: "panel", compact: true, states });

    expect(root.querySelector(".compact-row")).toBeNull();
    expect(root.textContent).not.toContain("Compact");
  });
});
