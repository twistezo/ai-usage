use std::{thread, time::Duration};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder,
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
// Must match the event name listened to in src/main.ts.
const REPORT_EVENT: &str = "usage-report";
// Views that show readings: the menu bar panel and the standalone window.
const VIEW_LABELS: [&str; 2] = ["panel", "window"];
const APP_NAME: &str = "ai-usage";

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Codex,
    Claude,
}

pub const PROVIDERS: [Provider; 2] = [Provider::Codex, Provider::Claude];

struct ProviderSite {
    id: &'static str,
    name: &'static str,
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
                home_url: "https://chatgpt.com/",
                login_url: "https://chatgpt.com/auth/login",
                script: CODEX_SCRIPT,
            },
            Provider::Claude => ProviderSite {
                id: "claude",
                name: "Claude",
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
    .on_page_load(move |window, payload| {
        if payload.event() == PageLoadEvent::Finished {
            let _ = window.eval(reader_script(provider));
        }
    })
    .on_document_title_changed(move |_, title| {
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
        Some(window) => window.eval(reader_script(provider)),
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

pub fn start_timer(app: AppHandle) {
    thread::spawn(move || {
        let mut tick: u32 = 0;
        loop {
            thread::sleep(REFRESH_INTERVAL);
            tick = tick.wrapping_add(1);
            for provider in PROVIDERS {
                let _ = if tick % RELOAD_EVERY_TICKS == 0 {
                    reload(&app, provider)
                } else {
                    refresh(&app, provider)
                };
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

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
