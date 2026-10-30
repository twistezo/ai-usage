import { formatFullDate, formatPercent, formatPlan, formatReset, formatSpend } from "./format";
import { ICONS, type IconName } from "./icons";
import {
  PROVIDER_INFO,
  PROVIDERS,
  STALE_AFTER_MINUTES,
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

// `notice` reports a failed action, e.g. a window that did not open.
// `compact` shrinks the standalone window to one row per provider.
export type PanelView = {
  mode: ViewMode;
  providers: readonly ProviderId[];
  states: UsageStates;
  refreshing: boolean;
  alwaysOnTop: boolean;
  compact: boolean;
  notice: string | null;
};

export type PanelActions = {
  onRefresh: () => void;
  onOpenWindow: () => void;
  onToggleAlwaysOnTop: () => void;
  onToggleCompact: () => void;
  onClose: () => void;
  onLogin: (provider: ProviderId) => void;
  onSettings: () => void;
  onHelp: () => void;
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

const fillWidth = (utilization: number): string => `${Math.min(Math.max(utilization, 0), 100)}%`;

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
    fill.style.width = fillWidth(meter.percent);
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
    value: formatSpend(extra.used, extra.limit, extra.currency, extra.decimals),
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
      section.append(
        createElement(
          "div",
          "stale",
          `Outdated: no successful update for over ${STALE_AFTER_MINUTES} minutes`,
        ),
      );
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

const createIcon = (icon: IconName, hint: string): HTMLElement => {
  const element = createElement("span", "icon");
  element.title = hint;
  // Trusted markup bundled from @tabler/icons.
  element.innerHTML = ICONS[icon];

  return element;
};

// "5h 29%": the label first, the reset countdown on hover.
const renderCompactValue = (
  label: string,
  usageWindow: UsageWindow,
  now: Date,
  className: string,
): HTMLElement => {
  const value = createElement("span", `compact-value ${className}`);
  value.title = formatReset(usageWindow.resetsAt, now);
  value.append(
    createElement("span", "usage-label", label),
    createElement("span", "usage-percent", formatPercent(usageWindow.utilization)),
  );

  return value;
};

// One bar split by height: the top half is 5h, the bottom half the week.
const renderSplitBar = (fiveHour: UsageWindow, sevenDay: UsageWindow): HTMLElement => {
  const bar = createElement("div", "split-bar");
  const five = createElement("div", "split-fill five-hour");
  five.style.width = fillWidth(fiveHour.utilization);
  const week = createElement("div", "split-fill seven-day");
  week.style.width = fillWidth(sevenDay.utilization);
  bar.append(five, week);

  return bar;
};

// Name and values on one line, the split bar under them.
// Problems shrink to a warning icon whose tooltip explains them.
const renderCompactProvider = (
  provider: ProviderId,
  state: ProviderState,
  now: Date,
  actions: PanelActions,
): HTMLElement => {
  const row = createElement("section", `compact-row provider-${provider}`);
  const line = createElement("div", "compact-line");
  line.append(
    createElement("span", "provider-name", PROVIDER_INFO[provider].name),
    createElement("span", "spacer"),
  );
  row.append(line);

  if (state.needsLogin) {
    line.append(createButton("link-button", "Log in", () => actions.onLogin(provider)));
  } else if (state.usage) {
    line.append(
      renderCompactValue("5h", state.usage.fiveHour, now, "five-hour"),
      renderCompactValue("1w", state.usage.sevenDay, now, "seven-day"),
    );
  } else {
    line.append(createElement("span", "empty", state.error ? "No data" : "Waiting…"));
  }

  const problem =
    state.error ??
    (state.usage && isStale(state.usage, now)
      ? `Outdated: no successful update for over ${STALE_AFTER_MINUTES} minutes`
      : null);
  if (problem) {
    line.append(createIcon("alert", problem));
  }
  if (state.usage && !state.needsLogin) {
    row.append(renderSplitBar(state.usage.fiveHour, state.usage.sevenDay));
  }

  return row;
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
  // The window has no title bar, so its header closes it.
  if (view.mode === "window") {
    const toggleCompact = view.compact
      ? createIconButton("expand", "Expand", "Show full details", actions.onToggleCompact)
      : createIconButton("compact", "Compact", "Show one row per provider", actions.onToggleCompact);
    header.insertBefore(toggleCompact, refresh);
    header.append(createIconButton("close", "Close", "Close the window", actions.onClose));
  }
  const compact = view.mode === "window" && view.compact;
  root.classList.toggle("compact", compact);
  // The window's buttons show icons only; their hints still name them.
  root.classList.toggle("icon-only", view.mode === "window");
  // The whole window moves by dragging any spot that is not a button or link.
  if (view.mode === "window") {
    root.dataset.tauriDragRegion = "deep";
  } else {
    delete root.dataset.tauriDragRegion;
  }
  const renderSection = compact ? renderCompactProvider : renderProvider;

  // The standalone window has the app menu and the Dock for these, so it skips the footer.
  const footer = createElement("footer", "panel-footer");
  footer.append(
    createButton("menu-item", "Settings", actions.onSettings),
    createButton("menu-item", "Help", actions.onHelp),
    createButton("menu-item", "Quit", actions.onQuit),
  );

  root.replaceChildren(
    header,
    ...(view.notice ? [createElement("div", "error notice", view.notice)] : []),
    ...PROVIDERS.filter((provider) => view.providers.includes(provider)).map((provider) =>
      renderSection(provider, view.states[provider], now, actions),
    ),
    ...(view.mode === "panel" ? [footer] : []),
  );
};
