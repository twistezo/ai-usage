use std::{sync::Mutex, thread, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    utils::config::BackgroundThrottlingPolicy, webview::PageLoadEvent,
};

const REPORT_SCRIPT: &str = include_str!("../scripts/report.js");
const CODEX_SCRIPT: &str = include_str!("../scripts/codex.js");
const CLAUDE_SCRIPT: &str = include_str!("../scripts/claude.js");

// Must match `prefix` in scripts/report.js.
const TITLE_PREFIX: &str = "__AIUSAGE__";
const REFRESH_INTERVAL: Duration = Duration::from_secs(60);
// Single-page apps grow when left open for days; a periodic reload keeps hidden pages small.
const RELOAD_EVERY_TICKS: u32 = 60;
// Background reads pause after this long without mouse, trackpad or keyboard input.
// A manual Refresh still reads right away.
const IDLE_PAUSE: Duration = Duration::from_secs(15 * 60);
// Must match the event name listened to in src/main.ts.
const REPORT_EVENT: &str = "usage-report";
// Views that show readings: the menu bar panel and the standalone window.
const VIEW_LABELS: [&str; 2] = ["panel", "window"];
const APP_NAME: &str = "ai-usage";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Codex,
    Claude,
}

pub const PROVIDERS: [Provider; 2] = [Provider::Codex, Provider::Claude];

// Must match PROVIDERS_EVENT in src/main.ts.
const PROVIDERS_EVENT: &str = "providers-changed";

/// Providers the user keeps on; only these are shown and read in the background.
pub struct EnabledProviders(Mutex<Vec<Provider>>);

impl Default for EnabledProviders {
    fn default() -> Self {
        Self(Mutex::new(PROVIDERS.to_vec()))
    }
}

/// The app's order without repeats; an empty choice means all providers.
fn enabled_or_all(chosen: &[Provider]) -> Vec<Provider> {
    let enabled: Vec<Provider> = PROVIDERS
        .into_iter()
        .filter(|provider| chosen.contains(provider))
        .collect();

    if enabled.is_empty() {
        PROVIDERS.to_vec()
    } else {
        enabled
    }
}

pub fn enabled_providers(app: &AppHandle) -> Vec<Provider> {
    app.state::<EnabledProviders>()
        .0
        .lock()
        .map(|enabled| enabled.clone())
        .unwrap_or_else(|_| PROVIDERS.to_vec())
}

/// Stores the choice, stops reading the providers turned off and tells the views.
pub fn set_enabled_providers(app: &AppHandle, chosen: &[Provider]) -> Vec<Provider> {
    let enabled = enabled_or_all(chosen);
    if let Ok(mut current) = app.state::<EnabledProviders>().0.lock() {
        *current = enabled.clone();
    }
    for provider in PROVIDERS {
        if !enabled.contains(&provider) {
            if let Some(window) = app.get_webview_window(&provider.reader_label()) {
                let _ = window.destroy();
            }
        }
    }
    for label in VIEW_LABELS {
        let _ = app.emit_to(label, PROVIDERS_EVENT, enabled.clone());
    }

    enabled
}

struct ProviderSite {
    id: &'static str,
    name: &'static str,
    host: &'static str,
    home_url: &'static str,
    login_url: &'static str,
    script: &'static str,
}

impl Provider {
    fn site(self) -> ProviderSite {
        match self {
            Provider::Codex => ProviderSite {
                id: "codex",
                name: "ChatGPT",
                host: "chatgpt.com",
                home_url: "https://chatgpt.com/",
                login_url: "https://chatgpt.com/auth/login",
                script: CODEX_SCRIPT,
            },
            Provider::Claude => ProviderSite {
                id: "claude",
                name: "Claude",
                host: "claude.ai",
                home_url: "https://claude.ai/",
                login_url: "https://claude.ai/login",
                script: CLAUDE_SCRIPT,
            },
        }
    }

    fn reader_label(self) -> String {
        format!("reader-{}", self.site().id)
    }

    fn login_label(self) -> String {
        format!("login-{}", self.site().id)
    }

    pub fn from_login_label(label: &str) -> Option<Provider> {
        PROVIDERS
            .into_iter()
            .find(|provider| provider.login_label() == label)
    }
}

#[derive(Clone, Serialize)]
struct Report {
    provider: Provider,
    output: String,
}

/// Only the provider's own site, over HTTPS on the default port, may run the reader
/// or send reports; a hidden window that ended up anywhere else is ignored.
fn is_site_url(provider: Provider, url: &Url) -> bool {
    url.scheme() == "https" && url.port().is_none() && url.host_str() == Some(provider.site().host)
}

fn shows_site(window: &WebviewWindow, provider: Provider) -> bool {
    window.url().is_ok_and(|url| is_site_url(provider, &url))
}

fn reader_script(provider: Provider) -> String {
    format!(
        "(() => {{\n{}\n{}\n}})()",
        provider.site().script,
        REPORT_SCRIPT
    )
}

fn parse_url(url: &str) -> tauri::Result<Url> {
    Url::parse(url).map_err(|error| tauri::Error::Anyhow(error.into()))
}

// The hidden window shares the app's cookie store with the login window.
// Background throttling is disabled so the page keeps running while hidden.
fn create_reader(app: &AppHandle, provider: Provider) -> tauri::Result<()> {
    let report_app = app.clone();
    WebviewWindowBuilder::new(
        app,
        provider.reader_label(),
        WebviewUrl::External(parse_url(provider.site().home_url)?),
    )
    .visible(false)
    .background_throttling(BackgroundThrottlingPolicy::Disabled)
    // Navigation is not restricted: the check would also block frames such as the
    // Cloudflare challenge. Instead the reader runs, and reports count, only on the site.
    .on_page_load(move |window, payload| {
        if payload.event() == PageLoadEvent::Finished && is_site_url(provider, payload.url()) {
            let _ = window.eval(reader_script(provider));
        }
    })
    .on_document_title_changed(move |window, title| {
        if !shows_site(&window, provider) {
            return;
        }
        if let Some(output) = title.strip_prefix(TITLE_PREFIX) {
            let report = Report {
                provider,
                output: output.to_string(),
            };
            // Only the app's own views; the remote reader pages never receive events.
            for label in VIEW_LABELS {
                let _ = report_app.emit_to(label, REPORT_EVENT, report.clone());
            }
        }
    })
    .build()?;

    Ok(())
}

/// Reads usage once; the result arrives on the panel as a `usage-report` event.
pub fn refresh(app: &AppHandle, provider: Provider) -> tauri::Result<()> {
    match app.get_webview_window(&provider.reader_label()) {
        Some(window) if shows_site(&window, provider) => window.eval(reader_script(provider)),
        // Back to the site; its page load runs the reader.
        Some(window) => window.navigate(parse_url(provider.site().home_url)?),
        // The first page load runs the script.
        None => create_reader(app, provider),
    }
}

/// Reloads the reader page, e.g. to pick up a session created in the login window.
pub fn reload(app: &AppHandle, provider: Provider) -> tauri::Result<()> {
    match app.get_webview_window(&provider.reader_label()) {
        Some(window) => window.eval("location.reload()"),
        None => create_reader(app, provider),
    }
}

pub fn open_login(app: &AppHandle, provider: Provider) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(&provider.login_label()) {
        window.show()?;

        return window.set_focus();
    }

    let site = provider.site();
    let login_url = parse_url(site.login_url)?;
    // The window has no address bar, so its title names the site actually shown.
    let name = site.name;
    let title = move |host: &str| format!("{APP_NAME} · Log in to {name} · {host}");
    let window = WebviewWindowBuilder::new(
        app,
        provider.login_label(),
        WebviewUrl::External(login_url.clone()),
    )
    .title(title(login_url.host_str().unwrap_or_default()))
    .on_page_load(move |window, payload| {
        if payload.event() == PageLoadEvent::Finished {
            let _ = window.set_title(&title(payload.url().host_str().unwrap_or_default()));
        }
    })
    .inner_size(900.0, 760.0)
    .center()
    .build()?;

    window.set_focus()
}

/// Time since the last mouse, trackpad or keyboard event in this login session.
#[cfg(target_os = "macos")]
fn user_idle_time() -> Duration {
    // CoreGraphics: combined session state, any input event type.
    const COMBINED_SESSION_STATE: i32 = 0;
    const ANY_INPUT_EVENT: u32 = u32::MAX;

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
    }

    let seconds =
        unsafe { CGEventSourceSecondsSinceLastEventType(COMBINED_SESSION_STATE, ANY_INPUT_EVENT) };

    Duration::try_from_secs_f64(seconds).unwrap_or(Duration::ZERO)
}

#[cfg(not(target_os = "macos"))]
fn user_idle_time() -> Duration {
    Duration::ZERO
}

fn is_user_away(idle: Duration) -> bool {
    idle >= IDLE_PAUSE
}

#[derive(Debug, PartialEq)]
enum TickAction {
    Skip,
    Refresh,
    Reload,
}

/// Decides one timer tick. Idle ticks are skipped and do not count towards the hourly reload.
fn next_tick(idle: Duration, tick: u32) -> (TickAction, u32) {
    if is_user_away(idle) {
        return (TickAction::Skip, tick);
    }

    let tick = tick.wrapping_add(1);
    let action = if tick % RELOAD_EVERY_TICKS == 0 {
        TickAction::Reload
    } else {
        TickAction::Refresh
    };

    (action, tick)
}

pub fn start_timer(app: AppHandle) {
    thread::spawn(move || {
        let mut tick: u32 = 0;
        loop {
            thread::sleep(REFRESH_INTERVAL);
            let (action, next) = next_tick(user_idle_time(), tick);
            tick = next;
            for provider in enabled_providers(&app) {
                let _ = match action {
                    TickAction::Skip => Ok(()),
                    TickAction::Refresh => refresh(&app, provider),
                    TickAction::Reload => reload(&app, provider),
                };
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_reads_continue_while_the_user_is_active() {
        assert!(!is_user_away(Duration::ZERO));
        assert!(!is_user_away(Duration::from_secs(14 * 60 + 59)));
    }

    #[test]
    fn background_reads_pause_after_15_minutes_without_input() {
        assert!(is_user_away(Duration::from_secs(15 * 60)));
        assert!(is_user_away(Duration::from_secs(3 * 60 * 60)));
    }

    const ACTIVE: Duration = Duration::from_secs(5);
    const AWAY: Duration = Duration::from_secs(20 * 60);

    #[test]
    fn an_active_user_gets_a_refresh_every_tick() {
        assert_eq!(next_tick(ACTIVE, 0), (TickAction::Refresh, 1));
        assert_eq!(next_tick(ACTIVE, 7), (TickAction::Refresh, 8));
    }

    #[test]
    fn every_60th_active_tick_reloads_the_pages_instead() {
        assert_eq!(next_tick(ACTIVE, 59), (TickAction::Reload, 60));
        assert_eq!(next_tick(ACTIVE, 60), (TickAction::Refresh, 61));
    }

    #[test]
    fn an_away_user_gets_no_reads_and_the_hourly_count_waits() {
        assert_eq!(next_tick(AWAY, 59), (TickAction::Skip, 59));
    }

    #[test]
    fn reads_resume_on_the_first_tick_after_coming_back() {
        let mut tick = 10;
        for _ in 0..30 {
            let (action, next) = next_tick(AWAY, tick);
            assert_eq!(action, TickAction::Skip);
            tick = next;
        }

        assert_eq!(next_tick(ACTIVE, tick), (TickAction::Refresh, 11));
    }

    #[test]
    fn enabled_providers_keep_the_app_order_without_repeats() {
        let chosen = [Provider::Claude, Provider::Codex, Provider::Claude];

        assert_eq!(
            enabled_or_all(&chosen),
            vec![Provider::Codex, Provider::Claude]
        );
        assert_eq!(enabled_or_all(&[Provider::Claude]), vec![Provider::Claude]);
    }

    #[test]
    fn an_empty_choice_enables_every_provider() {
        assert_eq!(enabled_or_all(&[]), PROVIDERS.to_vec());
    }

    #[test]
    fn providers_event_matches_the_panel() {
        assert!(MAIN_TS.contains(&format!("const PROVIDERS_EVENT = \"{PROVIDERS_EVENT}\";")));
    }

    #[test]
    fn idle_time_is_readable_from_the_system() {
        // Real call into CoreGraphics; any finite, non-negative value means the binding works.
        assert!(user_idle_time() < Duration::from_secs(365 * 24 * 60 * 60));
    }

    const MAIN_TS: &str = include_str!("../../src/main.ts");
    const CAPABILITIES: &str = include_str!("../capabilities/default.json");

    #[test]
    fn panel_requests_name_providers_in_lowercase() {
        let provider: Provider = serde_json::from_str("\"claude\"").unwrap();

        assert_eq!(provider.site().id, "claude");
        assert!(serde_json::from_str::<Provider>("\"Claude\"").is_err());
        assert!(serde_json::from_str::<Provider>("\"gemini\"").is_err());
    }

    #[test]
    fn closing_a_login_window_is_traced_back_to_its_provider() {
        for provider in PROVIDERS {
            let found = Provider::from_login_label(&provider.login_label()).map(|p| p.site().id);

            assert_eq!(found, Some(provider.site().id));
        }
    }

    #[test]
    fn other_windows_are_not_mistaken_for_login_windows() {
        for label in [
            "panel",
            "window",
            "help",
            "reader-codex",
            "login-gemini",
            "login-",
        ] {
            assert!(Provider::from_login_label(label).is_none(), "{label}");
        }
    }

    #[test]
    fn every_site_is_https_and_logs_in_on_the_host_it_reads_from() {
        for provider in PROVIDERS {
            let site = provider.site();
            let home = Url::parse(site.home_url).unwrap();
            let login = Url::parse(site.login_url).unwrap();

            assert_eq!(home.scheme(), "https");
            assert_eq!(login.host_str(), home.host_str());
        }
    }

    #[test]
    fn site_host_matches_its_home_page() {
        for provider in PROVIDERS {
            let home = Url::parse(provider.site().home_url).unwrap();

            assert!(is_site_url(provider, &home));
        }
    }

    #[test]
    fn reader_runs_on_any_page_of_the_providers_site() {
        let page = Url::parse("https://claude.ai/new?model=opus#top").unwrap();

        assert!(is_site_url(Provider::Claude, &page));
    }

    // Reports from any other page must be ignored, even when they look alike.
    #[test]
    fn reader_refuses_pages_outside_the_providers_site() {
        for url in [
            "https://evil.example/",
            "http://claude.ai/",
            "https://claude.ai:8443/",
            "https://claude.ai.evil.example/",
            "https://evil.claude.ai/",
            "https://claude.ai@evil.example/",
            "https://chatgpt.com/",
            "about:blank",
        ] {
            let url = Url::parse(url).unwrap();

            assert!(!is_site_url(Provider::Claude, &url), "{url}");
        }
    }

    #[test]
    fn reader_script_runs_the_providers_reader_and_the_shared_report() {
        let script = reader_script(Provider::Codex);

        assert!(script.starts_with("(() => {"));
        assert!(script.trim_end().ends_with("})()"));
        assert!(script.contains("/backend-api/wham/usage"));
        assert!(!script.contains("/api/organizations"));
        assert!(script.contains(REPORT_SCRIPT));
    }

    // Constants that must agree across Rust, the page scripts and the panel.
    #[test]
    fn report_prefix_matches_the_page_script() {
        assert!(REPORT_SCRIPT.contains(&format!("const prefix = '{TITLE_PREFIX}';")));
    }

    #[test]
    fn report_event_and_window_label_match_the_panel() {
        assert!(MAIN_TS.contains(&format!("const REPORT_EVENT = \"{REPORT_EVENT}\";")));
        assert!(MAIN_TS.contains(&format!("const WINDOW_LABEL = \"{}\";", VIEW_LABELS[1])));
    }

    // Remote pages run in reader and login windows; none of them may reach the app's commands.
    #[test]
    fn remote_windows_get_no_command_permissions() {
        let capabilities: serde_json::Value = serde_json::from_str(CAPABILITIES).unwrap();
        let windows: Vec<&str> = capabilities["windows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|window| window.as_str().unwrap())
            .collect();

        for label in VIEW_LABELS {
            assert!(windows.contains(&label), "{label} needs permissions");
        }
        for provider in PROVIDERS {
            assert!(!windows.contains(&provider.reader_label().as_str()));
            assert!(!windows.contains(&provider.login_label().as_str()));
        }
        assert!(windows.iter().all(|window| !window.contains('*')));
        assert!(capabilities.get("remote").is_none());
    }
}
