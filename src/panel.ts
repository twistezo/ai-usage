import { formatFullDate, formatMoney, formatPercent, formatReset } from "./format";
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

// Must match REFRESH_INTERVAL in src-tauri/src/session_reader.rs.
const AUTO_REFRESH_NOTE = "auto: 1 min";

export type PanelView = {
  states: UsageStates;
  refreshing: boolean;
};

export type PanelActions = {
  onRefresh: () => void;
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
};

const renderMeter = (meter: Meter): HTMLElement => {
  const row = createElement("div", "usage-window");

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

    return { value, label: "Extra" };
  }

  if (!extra.enabled) {
    return { value: "Off", label: "Extra" };
  }

  return {
    value: `${formatMoney(extra.used, extra.currency)} / ${formatMoney(extra.limit, extra.currency)}`,
    label: "Extra",
    percent: extra.limit > 0 ? (extra.used / extra.limit) * 100 : 0,
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
  header.append(
    createElement("h2", "provider-name", info.name),
    createElement("span", "provider-plan", info.plan),
  );
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
  const refresh = createButton(
    "refresh primary",
    view.refreshing ? "Refreshing…" : "Refresh",
    actions.onRefresh,
  );
  refresh.disabled = view.refreshing;

  const header = createElement("header", "panel-header");
  const refreshGroup = createElement("div", "refresh-group");
  refreshGroup.append(refresh, createElement("div", "refresh-note", AUTO_REFRESH_NOTE));
  header.append(createElement("span", "panel-title", "ai-usage"), refreshGroup);

  const footer = createElement("footer", "panel-footer");
  footer.append(
    createButton("menu-item", "Help & setup…", actions.onHelp),
    createButton("menu-item", "About…", actions.onAbout),
    createButton("menu-item", "Quit", actions.onQuit),
  );

  root.replaceChildren(
    header,
    ...PROVIDERS.map((provider) => renderProvider(provider, view.states[provider], now, actions)),
    footer,
  );
};
