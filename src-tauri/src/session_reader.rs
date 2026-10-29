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
// Change AUTO_REFRESH_NOTE in src/panel.ts together with this.
const REFRESH_INTERVAL: Duration = Duration::from_secs(60);
// Single-page apps grow when left open for days; a periodic reload keeps hidden pages small.
const RELOAD_EVERY_TICKS: u32 = 60;
// Must match the event name listened to in src/main.ts.
const REPORT_EVENT: &str = "usage-report";
const PANEL_LABEL: &str = "panel";

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
    format!("(() => {{\n{}\n{}\n}})()", provider.site().script, REPORT_SCRIPT)
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
            let _ = report_app.emit_to(PANEL_LABEL, REPORT_EVENT, report);
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
    let window = WebviewWindowBuilder::new(
        app,
        provider.login_label(),
        WebviewUrl::External(parse_url(site.login_url)?),
    )
    .title(format!("Log in to {}", site.name))
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
