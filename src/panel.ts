import { formatFullDate, formatPercent, formatPlan, formatReset, formatSpend } from "./format";
import { ICONS, type IconName } from "./icons";
import {
  PROVIDER_INFO,
  PROVIDERS,
  isStale,
  type ExtraUsage,
  type ProviderId,
  type ProviderState,
  type UsageStates,
  type UsageWindow,
} from "./usage";

// The same view renders in the menu bar panel and in the standalone window.
const VIEW_MODES = ["panel", "window"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

export type PanelView = {
  mode: ViewMode;
  states: UsageStates;
  refreshing: boolean;
  alwaysOnTop: boolean;
};

export type PanelActions = {
  onRefresh: () => void;
  onOpenWindow: () => void;
  onToggleAlwaysOnTop: () => void;
  onLogin: (provider: ProviderId) => void;
  onHelp: () => void;
  onAbout: () => void;
  onQuit: () => void;
};

const createElement = <Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[Tag] => {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }

  return element;
};

const createButton = (className: string, label: string, onClick: () => void): HTMLButtonElement => {
  const button = createElement("button", className, label);
  button.type = "button";
  button.addEventListener("click", onClick);

  return button;
};

type Meter = {
  value: string;
  label: string;
  // Omitted when there is nothing to measure against, e.g. a credit balance.
  percent?: number;
  description?: string;
  descriptionTitle?: string;
  // Right-aligns the value, setting extra usage apart from the plan limits.
  alignEnd?: boolean;
};

const createIconButton = (
  icon: IconName,
  label: string,
  hint: string,
  onClick: () => void,
): HTMLButtonElement => {
  const button = createElement("button", "icon-button");
  button.type = "button";
  button.title = hint;
  // Trusted markup bundled from @tabler/icons.
  button.innerHTML = ICONS[icon];
  button.append(createElement("span", "icon-button-label", label));
  button.addEventListener("click", onClick);

  return button;
};

const renderMeter = (meter: Meter): HTMLElement => {
  const row = createElement("div", meter.alignEnd ? "usage-window align-end" : "usage-window");

  // Value and label on the left, description on the right, bar below.
  const heading = createElement("div", "usage-heading");
  const summary = createElement("div", "usage-summary");
  summary.append(
    createElement("span", "usage-percent", meter.value),
    createElement("span", "usage-label", meter.label),
  );
  heading.append(summary);

  if (meter.description) {
    const description = createElement("span", "usage-reset", meter.description);
    if (meter.descriptionTitle) {
      description.title = meter.descriptionTitle;
    }
    heading.append(description);
  }
  row.append(heading);

  if (meter.percent !== undefined) {
    const bar = createElement("div", "bar");
    const fill = createElement("div", "bar-fill");
    fill.style.width = `${Math.min(Math.max(meter.percent, 0), 100)}%`;
    bar.append(fill);
    row.append(bar);
  }

  return row;
};

const windowMeter = (label: string, usageWindow: UsageWindow, now: Date): Meter => ({
  value: formatPercent(usageWindow.utilization),
  label,
  percent: usageWindow.utilization,
  description: formatReset(usageWindow.resetsAt, now),
  descriptionTitle: usageWindow.resetsAt ? formatFullDate(usageWindow.resetsAt) : undefined,
});

const extraMeter = (extra: ExtraUsage): Meter => {
  if (extra.kind === "credits") {
    const value = extra.unlimited
      ? "Unlimited"
      : extra.balance > 0
        ? `${extra.balance} left`
        : "Off";

    return { value, label: "Extra", alignEnd: true };
  }

  if (!extra.enabled) {
    return { value: "Off", label: "Extra", alignEnd: true };
  }

  return {
    value: formatSpend(extra.used, extra.limit, extra.currency),
    label: "Extra",
    alignEnd: true,
  };
};

const renderProvider = (
  provider: ProviderId,
  state: ProviderState,
  now: Date,
  actions: PanelActions,
): HTMLElement => {
  // The class sets the provider's brand color.
  const section = createElement("section", `provider provider-${provider}`);
  const info = PROVIDER_INFO[provider];

  const header = createElement("div", "provider-header");
  header.append(createElement("h2", "provider-name", info.name));
  // The plan comes with each reading, so it appears after the first one.
  if (state.usage?.plan) {
    header.append(createElement("span", "provider-plan", formatPlan(state.usage.plan)));
  }
  section.append(header);

  if (state.usage) {
    section.append(
      renderMeter(windowMeter("5h", state.usage.fiveHour, now)),
      renderMeter(windowMeter("1w", state.usage.sevenDay, now)),
    );
    if (state.usage.extra) {
      section.append(renderMeter(extraMeter(state.usage.extra)));
    }
    // A failed refresh already explains itself in the error below.
    if (isStale(state.usage, now) && !state.error) {
      section.append(createElement("div", "stale", "Outdated: no successful update for over 5 minutes"));
    }
  } else if (!state.error) {
    section.append(createElement("div", "empty", "Waiting for the first reading…"));
  }

  if (state.error) {
    section.append(createElement("div", "error", state.error));
  }
  if (state.needsLogin) {
    section.append(
      createButton("secondary login", `Log in to ${info.account}`, () => actions.onLogin(provider)),
    );
  }

  return section;
};

export const renderPanel = (
  root: HTMLElement,
  view: PanelView,
  now: Date,
  actions: PanelActions,
): void => {
  const refresh = createIconButton(
    "refresh",
    view.refreshing ? "Refreshing" : "Refresh",
    "Refresh now",
    actions.onRefresh,
  );
  refresh.disabled = view.refreshing;
  refresh.classList.toggle("spinning", view.refreshing);

  // The panel offers the standalone window; the window offers pinning on top instead.
  const secondary =
    view.mode === "panel"
      ? createIconButton("appWindow", "Window", "Open in a separate window", actions.onOpenWindow)
      : createIconButton(
          view.alwaysOnTop ? "pinned" : "pin",
          view.alwaysOnTop ? "Pinned" : "Pin",
          view.alwaysOnTop ? "Stop keeping on top" : "Keep on top of other windows",
          actions.onToggleAlwaysOnTop,
        );
  secondary.classList.toggle("active", view.mode === "window" && view.alwaysOnTop);

  const header = createElement("header", "panel-header");
  header.append(secondary, refresh);

  // The standalone window has the app menu and the Dock for these, so it skips the footer.
  const footer = createElement("footer", "panel-footer");
  footer.append(
    createButton("menu-item", "Help & setup…", actions.onHelp),
    createButton("menu-item", "About…", actions.onAbout),
    createButton("menu-item", "Quit", actions.onQuit),
  );

  root.replaceChildren(
    header,
    ...PROVIDERS.map((provider) => renderProvider(provider, view.states[provider], now, actions)),
    ...(view.mode === "panel" ? [footer] : []),
  );
};
