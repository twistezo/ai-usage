mod session_reader;

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
// Must match WINDOW_LABEL in src/main.ts.
const WINDOW_LABEL: &str = "window";
// Logical pixels between the menu bar and the panel.
const PANEL_GAP: f64 = 6.0;
// Clicking the tray icon blurs the panel first; without this guard the click would reopen it.
const REOPEN_GUARD: Duration = Duration::from_millis(300);

#[derive(Default)]
struct PanelState {
    hidden_on_blur_at: Mutex<Option<Instant>>,
}

/// Centers the panel under the tray icon; `monitor` is its (left, width), which keeps
/// the panel on screen when the icon sits near the screen edge.
fn panel_x(tray_x: f64, tray_width: f64, panel_width: f64, monitor: Option<(f64, f64)>) -> f64 {
    let centered = tray_x + tray_width / 2.0 - panel_width / 2.0;

    match monitor {
        Some((left, width)) => centered.clamp(left, (left + width - panel_width).max(left)),
        None => centered,
    }
}

fn position_panel(panel: &WebviewWindow, tray_rect: Rect) -> tauri::Result<()> {
    let scale = panel.scale_factor()?;
    let tray_position = tray_rect.position.to_physical::<f64>(scale);
    let tray_size = tray_rect.size.to_physical::<f64>(scale);
    let panel_width = f64::from(panel.outer_size()?.width);
    let monitor = panel
        .monitor_from_point(tray_position.x, tray_position.y)?
        .map(|monitor| {
            (
                f64::from(monitor.position().x),
                f64::from(monitor.size().width),
            )
        });

    let x = panel_x(tray_position.x, tray_size.width, panel_width, monitor);
    let y = tray_position.y + tray_size.height + PANEL_GAP * scale;

    panel.set_position(PhysicalPosition::new(x, y))
}

fn recently_hidden(hidden_at: Option<Instant>, now: Instant) -> bool {
    hidden_at.is_some_and(|hidden_at| now.saturating_duration_since(hidden_at) < REOPEN_GUARD)
}

/// Runs every result to the end and keeps the first error, so one failure skips nothing.
fn first_error<E>(results: impl IntoIterator<Item = Result<(), E>>) -> Result<(), E> {
    results
        .into_iter()
        .fold(Ok(()), |first, result| first.and(result))
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
    let hidden_at = state
        .hidden_on_blur_at
        .lock()
        .ok()
        .and_then(|hidden_at| *hidden_at);
    if recently_hidden(hidden_at, Instant::now()) {
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
        // Width must match INFO_WINDOW_WIDTH in src/info-page.ts; the page fits the height.
        .inner_size(440.0, 420.0)
        .resizable(false)
        .minimizable(false)
        .center()
        .build()?;

    window.set_focus()
}

#[tauri::command]
fn open_help(app: AppHandle) -> tauri::Result<()> {
    open_info_window(&app, "help", "Help", "help.html")
}

// Every enabled provider is refreshed even when another fails; the first error is reported.
#[tauri::command]
fn refresh_usage(app: AppHandle) -> tauri::Result<()> {
    first_error(
        session_reader::enabled_providers(&app)
            .into_iter()
            .map(|provider| session_reader::refresh(&app, provider)),
    )
}

#[tauri::command]
fn set_providers(
    app: AppHandle,
    providers: Vec<session_reader::Provider>,
) -> Vec<session_reader::Provider> {
    session_reader::set_enabled_providers(&app, &providers)
}

#[tauri::command]
fn open_settings(app: AppHandle) -> tauri::Result<()> {
    open_info_window(&app, "settings", "Settings", "settings.html")
}

#[tauri::command]
fn open_login(app: AppHandle, provider: session_reader::Provider) -> tauri::Result<()> {
    if let Some(panel) = app.get_webview_window(PANEL_LABEL) {
        let _ = panel.hide();
    }

    session_reader::open_login(&app, provider)
}

// A development build is a bare executable, so macOS shows a generic icon once the app
// joins the Dock; the bundled app gets its icon from icon.icns instead.
#[cfg(target_os = "macos")]
fn set_dock_icon(app: &AppHandle) {
    let _ = app.run_on_main_thread(|| {
        use objc2::{AllocAnyThread, MainThreadMarker};
        use objc2_app_kit::{NSApplication, NSImage};
        use objc2_foundation::NSData;

        let Some(main_thread) = MainThreadMarker::new() else {
            return;
        };
        let data = NSData::with_bytes(include_bytes!("../icons/icon.png"));
        if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
            let application = NSApplication::sharedApplication(main_thread);
            unsafe { application.setApplicationIconImage(Some(&image)) };
        }
    });
}

// The standalone window shows the panel view in a regular macOS window.
// While it is open the app joins the Dock and the app switcher, so it cannot get lost.
#[tauri::command]
fn open_window(app: AppHandle) -> tauri::Result<()> {
    if let Some(panel) = app.get_webview_window(PANEL_LABEL) {
        let _ = panel.hide();
    }
    app.set_activation_policy(ActivationPolicy::Regular)?;
    #[cfg(target_os = "macos")]
    set_dock_icon(&app);

    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window.show()?;

        return window.set_focus();
    }

    // No title bar: the page provides the close button and the drag area.
    // Transparent, so the page can draw rounded corners (needs `macOSPrivateApi`).
    // The page fits the height to its content; the position is restored by the window-state plugin.
    let window =
        WebviewWindowBuilder::new(&app, WINDOW_LABEL, WebviewUrl::App("index.html".into()))
            .title("ai-usage")
            .decorations(false)
            .transparent(true)
            .inner_size(340.0, 480.0)
            .resizable(false)
            .build()?;

    window.set_focus()
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .with_filter(|label| label == WINDOW_LABEL)
                .build(),
        )
        // "Open at login" in Settings; a LaunchAgent in ~/Library/LaunchAgents starts the app.
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent)
                .build(),
        )
        .manage(PanelState::default())
        .manage(session_reader::EnabledProviders::default())
        .setup(|app| {
            // Menu bar only: no Dock icon, no app switcher entry.
            app.set_activation_policy(ActivationPolicy::Accessory);

            TrayIconBuilder::with_id("main")
                .icon(tauri::include_image!("icons/tray-template.png"))
                .icon_as_template(true)
                .tooltip("ai-usage")
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

            // The panel triggers the first refresh, which creates the hidden reader windows.
            session_reader::start_timer(app.handle().clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            if let Some(provider) = session_reader::Provider::from_login_label(window.label()) {
                if let WindowEvent::Destroyed = event {
                    let _ = session_reader::reload(window.app_handle(), provider);
                }

                return;
            }
            if window.label() == WINDOW_LABEL {
                if let WindowEvent::Destroyed = event {
                    let _ = window
                        .app_handle()
                        .set_activation_policy(ActivationPolicy::Accessory);
                }

                return;
            }
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
            refresh_usage,
            set_providers,
            open_settings,
            open_window,
            open_login,
            open_help,
            quit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONITOR: Option<(f64, f64)> = Some((0.0, 3024.0));

    #[test]
    fn panel_is_centered_under_the_tray_icon() {
        assert_eq!(panel_x(1500.0, 40.0, 680.0, MONITOR), 1180.0);
    }

    #[test]
    fn panel_stays_on_screen_near_the_right_edge() {
        assert_eq!(panel_x(2990.0, 40.0, 680.0, MONITOR), 3024.0 - 680.0);
    }

    #[test]
    fn panel_stays_on_screen_near_the_left_edge() {
        assert_eq!(panel_x(10.0, 40.0, 680.0, MONITOR), 0.0);
    }

    #[test]
    fn panel_respects_a_second_monitor_to_the_left() {
        assert_eq!(
            panel_x(-1920.0, 40.0, 680.0, Some((-1920.0, 1920.0))),
            -1920.0
        );
    }

    #[test]
    fn panel_wider_than_the_monitor_starts_at_its_left_edge() {
        assert_eq!(panel_x(100.0, 40.0, 680.0, Some((0.0, 500.0))), 0.0);
    }

    #[test]
    fn panel_is_centered_when_the_monitor_is_unknown() {
        assert_eq!(panel_x(1500.0, 40.0, 680.0, None), 1180.0);
    }

    #[test]
    fn tray_click_right_after_closing_the_panel_does_not_reopen_it() {
        let hidden_at = Instant::now();

        assert!(recently_hidden(
            Some(hidden_at),
            hidden_at + Duration::from_millis(100)
        ));
    }

    #[test]
    fn later_tray_click_reopens_the_panel() {
        let hidden_at = Instant::now();

        assert!(!recently_hidden(
            Some(hidden_at),
            hidden_at + Duration::from_secs(1)
        ));
        assert!(!recently_hidden(None, hidden_at));
    }

    #[test]
    fn first_error_runs_everything_and_keeps_the_first_failure() {
        let mut ran = Vec::new();
        let result = first_error(["codex", "claude", "third"].into_iter().map(|name| {
            ran.push(name);
            if name == "third" {
                Ok(())
            } else {
                Err(format!("{name} failed"))
            }
        }));

        assert_eq!(result, Err("codex failed".to_string()));
        assert_eq!(ran, ["codex", "claude", "third"]);
    }

    #[test]
    fn first_error_is_ok_when_everything_succeeds() {
        assert_eq!(first_error::<String>([Ok(()), Ok(())]), Ok(()));
        assert_eq!(first_error::<String>([]), Ok(()));
    }
}
