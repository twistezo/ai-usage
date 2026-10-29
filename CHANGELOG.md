# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions: [SemVer](https://semver.org/).

## [1.0.0] - 2026-10-29

Review and release.

### Added
- Subscription name read from the API (Codex `plan_type`, Claude `analytics_subscription_plan`) instead of being hard-coded.
- Login window title shows the app name and the host being displayed.
- Content security policy for the app's own pages (off in dev).
- Unit tests rewritten: parser, formatting, panel rendering, and the real page scripts against recorded responses.

### Changed
- Extra spend shows the API's currency and decimal places, e.g. `1.18 / 1.50 EUR`.
- Views re-render every minute, so countdowns and “Outdated” update without new readings.
- Refresh reads every provider even when one fails.
- Version set to 1.0.0; README rewritten and shortened.

### Fixed
- Codex shows an error instead of 0% when no known limit window is returned.
- Claude stops with an error when the organization has no id.
- Non-numeric HTTP statuses and statuses like `toString` from a page no longer reach the panel text.

## [0.5.0] - 2026-10-29

Standalone window and icons.

### Added
- “Window” opens the panel view as a separate window: frameless, rounded, draggable, with Pin (always on top) and Close; remembers its position.
- The app joins the Dock while the window is open; robot app icon (white tile, Alucard colors).
- Tabler icons (MIT) with labels on header buttons; robot icon in the menu bar.

### Changed
- Help and About merged into “Help & about”.
- Menu bar panel drawn as the same rounded card as the window.

## [0.4.0] - 2026-10-29

UI rework.

### Added
- Extra usage: Claude spend this month, Codex purchased credits.

### Changed
- UI in English; `ai-usage` naming.
- Dracula Pro (dark) and Alucard (light) theme; provider brand colors for names, percentages and bars.
- Compact rows: `34% 5h` with `↻ 4h 22m`; the reading time replaced by an “Outdated” note.
- Refresh moved to the header.

## [0.3.0] - 2026-10-29

Background refresh without Chrome.

### Added
- In-app logins for Claude and ChatGPT; hidden windows read usage with those sessions (proven first in a throwaway test app).
- Automatic refresh every minute; hourly reload of the hidden pages.
- “Log in to…” in the panel on HTTP 401 or 403.

### Removed
- Reading through Google Chrome with Apple Events, the Chrome prompt and its permissions.

## [0.2.0] - 2026-10-29

Real data and a built app.

### Added
- Reads Codex and Claude usage from logged-in Chrome tabs via Apple Events; the page fetches with its own session (Codex needs its Bearer token, fetched inside the page).
- Asks before starting Chrome or opening missing tabs; each provider fails independently and keeps its last reading.
- Error messages for missing macOS permission, disabled JavaScript from Apple Events, expired sessions and timeouts.
- Release build as `AI Usage.app`.

## [0.1.0] - 2026-10-29

Menu bar panel.

### Added
- Tauri 2 app that lives in the menu bar only, with a panel under the tray icon.
- Panel with 5h and weekly bars, resets, Help and About windows, on sample data.
