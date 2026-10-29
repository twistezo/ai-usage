mod usage_reader;

use std::{
    sync::Mutex,
    time::{Duration, Instant},
};

use tauri::{
    ActivationPolicy, AppHandle, Manager, PhysicalPosition, Rect, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

const PANEL_LABEL: &str = "panel";
// Logical pixels between the menu bar and the panel.
const PANEL_GAP: f64 = 6.0;
// Clicking the tray icon blurs the panel first; without this guard the click would reopen it.
const REOPEN_GUARD: Duration = Duration::from_millis(300);

#[derive(Default)]
struct PanelState {
    hidden_on_blur_at: Mutex<Option<Instant>>,
}

fn position_panel(panel: &WebviewWindow, tray_rect: Rect) -> tauri::Result<()> {
    let scale = panel.scale_factor()?;
    let tray_position = tray_rect.position.to_physical::<f64>(scale);
    let tray_size = tray_rect.size.to_physical::<f64>(scale);
    let panel_width = f64::from(panel.outer_size()?.width);

    let mut x = tray_position.x + tray_size.width / 2.0 - panel_width / 2.0;
    let y = tray_position.y + tray_size.height + PANEL_GAP * scale;

    // Keep the panel on screen when the icon sits near the screen edge.
    if let Some(monitor) = panel.monitor_from_point(tray_position.x, tray_position.y)? {
        let left = f64::from(monitor.position().x);
        let right = left + f64::from(monitor.size().width) - panel_width;
        x = x.clamp(left, right.max(left));
    }

    panel.set_position(PhysicalPosition::new(x, y))
}

fn toggle_panel(app: &AppHandle, tray_rect: Rect) {
    let Some(panel) = app.get_webview_window(PANEL_LABEL) else {
        return;
    };

    if panel.is_visible().unwrap_or(false) {
        let _ = panel.hide();

        return;
    }

    let state = app.state::<PanelState>();
    let just_hidden = state
        .hidden_on_blur_at
        .lock()
        .ok()
        .and_then(|hidden_at| *hidden_at)
        .is_some_and(|hidden_at| hidden_at.elapsed() < REOPEN_GUARD);
    if just_hidden {
        return;
    }

    let _ = position_panel(&panel, tray_rect);
    let _ = panel.show();
    let _ = panel.set_focus();
}

fn open_info_window(app: &AppHandle, label: &str, title: &str, page: &str) -> tauri::Result<()> {
    if let Some(panel) = app.get_webview_window(PANEL_LABEL) {
        let _ = panel.hide();
    }

    if let Some(window) = app.get_webview_window(label) {
        window.show()?;

        return window.set_focus();
    }

    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App(page.into()))
        .title(title)
        .inner_size(440.0, 420.0)
        .resizable(false)
        .minimizable(false)
        .center()
        .build()?;

    window.set_focus()
}

#[tauri::command]
fn open_help(app: AppHandle) -> tauri::Result<()> {
    open_info_window(&app, "help", "Pomoc i konfiguracja", "help.html")
}

#[tauri::command]
fn open_about(app: AppHandle) -> tauri::Result<()> {
    open_info_window(&app, "about", "O aplikacji", "about.html")
}

#[tauri::command]
async fn read_usage(
    provider: usage_reader::Provider,
    open_if_missing: bool,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || usage_reader::read(provider, open_if_missing))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PanelState::default())
        .setup(|app| {
            // Menu bar only: no Dock icon, no app switcher entry.
            app.set_activation_policy(ActivationPolicy::Accessory);

            TrayIconBuilder::with_id("main")
                .icon(tauri::include_image!("icons/tray-template.png"))
                .icon_as_template(true)
                .tooltip("AI Usage")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        rect,
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_panel(tray.app_handle(), rect);
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != PANEL_LABEL {
                return;
            }

            if let WindowEvent::Focused(false) = event {
                let _ = window.hide();
                if let Ok(mut hidden_at) = window.state::<PanelState>().hidden_on_blur_at.lock() {
                    *hidden_at = Some(Instant::now());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_usage, open_help, open_about, quit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
