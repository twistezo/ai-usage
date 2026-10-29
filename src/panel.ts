import { formatPercent, formatReadAt, formatReset } from "./format";
import type { ChromeRequirement } from "./reader";
import {
  PROVIDER_INFO,
  PROVIDERS,
  isStale,
  usageLevel,
  type ProviderId,
  type ProviderState,
  type UsageStates,
  type UsageWindow,
} from "./usage";

export type ChromePrompt = {
  providers: ProviderId[];
  requirement: ChromeRequirement;
};

export type PanelView = {
  states: UsageStates;
  refreshing: boolean;
  chromePrompt: ChromePrompt | null;
};

export type PanelActions = {
  onRefresh: () => void;
  onConfirmChrome: () => void;
  onCancelChrome: () => void;
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

const renderWindow = (label: string, usageWindow: UsageWindow, now: Date): HTMLElement => {
  const row = createElement("div", "usage-window");

  const heading = createElement("div", "usage-heading");
  heading.append(
    createElement("span", "usage-label", label),
    createElement("span", "usage-percent", formatPercent(usageWindow.utilization)),
  );

  const bar = createElement("div", "bar");
  const fill = createElement("div", `bar-fill level-${usageLevel(usageWindow.utilization)}`);
  fill.style.width = `${Math.min(Math.max(usageWindow.utilization, 0), 100)}%`;
  bar.append(fill);

  const reset = createElement("div", "usage-reset", formatReset(usageWindow.resetsAt, now));
  if (usageWindow.resetsAt) {
    reset.title = usageWindow.resetsAt.toLocaleString("pl-PL");
  }

  row.append(heading, bar, reset);

  return row;
};

const renderProvider = (provider: ProviderId, state: ProviderState, now: Date): HTMLElement => {
  const section = createElement("section", "provider");
  const info = PROVIDER_INFO[provider];

  const header = createElement("div", "provider-header");
  header.append(
    createElement("h2", "provider-name", info.name),
    createElement("span", "provider-plan", info.plan),
  );
  section.append(header);

  if (state.usage) {
    const stale = isStale(state.usage, now) || state.error !== null;
    const readAt = createElement(
      "div",
      stale ? "read-at stale" : "read-at",
      `Odczyt: ${formatReadAt(state.usage.readAt, now)}${stale ? " (nieaktualne)" : ""}`,
    );
    section.append(
      renderWindow("5 godzin", state.usage.fiveHour, now),
      renderWindow("Tydzień", state.usage.sevenDay, now),
      readAt,
    );
  } else if (!state.error) {
    section.append(createElement("div", "empty", "Brak odczytu. Kliknij „Odśwież”."));
  }

  if (state.error) {
    section.append(createElement("div", "error", state.error));
  }

  return section;
};

const renderChromePrompt = (prompt: ChromePrompt, actions: PanelActions): HTMLElement => {
  const domains = prompt.providers.map((provider) => PROVIDER_INFO[provider].domain).join(", ");
  const [title, body] =
    prompt.requirement === "chrome_not_running"
      ? ["Otworzyć Google Chrome?", `Aby odczytać limity, aplikacja uruchomi Chrome i otworzy: ${domains}.`]
      : ["Otworzyć brakujące karty?", `Aby odczytać limity, aplikacja otworzy w Chrome: ${domains}.`];

  const box = createElement("div", "prompt");
  const buttons = createElement("div", "prompt-buttons");
  buttons.append(
    createButton("secondary", "Anuluj", actions.onCancelChrome),
    createButton("primary", "Otwórz Chrome", actions.onConfirmChrome),
  );
  box.append(createElement("div", "prompt-title", title), createElement("p", "prompt-body", body), buttons);

  return box;
};

export const renderPanel = (
  root: HTMLElement,
  view: PanelView,
  now: Date,
  actions: PanelActions,
): void => {
  const refresh = createButton(
    "refresh primary",
    view.refreshing ? "Odświeżanie…" : "Odśwież",
    actions.onRefresh,
  );
  refresh.disabled = view.refreshing || view.chromePrompt !== null;

  const footer = createElement("footer", "panel-footer");
  const secondary = createElement("div", "menu-row");
  secondary.append(
    createButton("menu-item", "O aplikacji…", actions.onAbout),
    createButton("menu-item", "Zakończ", actions.onQuit),
  );
  if (view.chromePrompt) {
    footer.append(renderChromePrompt(view.chromePrompt, actions));
  }
  footer.append(refresh, createButton("menu-item", "Pomoc i konfiguracja…", actions.onHelp), secondary);

  root.replaceChildren(
    createElement("header", "panel-title", "AI Usage"),
    ...PROVIDERS.map((provider) => renderProvider(provider, view.states[provider], now)),
    footer,
  );
};
