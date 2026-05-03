use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// Embedded notification sound (mixkit-happy-bells-notification-937.wav).
/// Bundled at compile time so the app is self-contained and the sound
/// is available regardless of the user's filesystem layout.
const FOCUS_TIMER_SOUND_BYTES: &[u8] =
    include_bytes!("../../sounds/focus-timer-complete.wav");

/// Lazily extracts the embedded sound to a temp path the first time
/// it's needed. `afplay` requires a real file path. Subsequent calls
/// reuse the same path.
fn focus_timer_sound_path() -> Option<PathBuf> {
    static PATH: OnceLock<Option<PathBuf>> = OnceLock::new();
    PATH.get_or_init(|| {
        let path = std::env::temp_dir().join("vibeytm-focus-timer-complete.wav");
        match std::fs::write(&path, FOCUS_TIMER_SOUND_BYTES) {
            Ok(()) => Some(path),
            Err(e) => {
                tracing::warn!(error = %e, "failed to extract bundled focus-timer sound");
                None
            }
        }
    })
    .clone()
}

/// Fire a macOS system notification on demand. Used by the focus timer
/// when the countdown hits 0.
///
/// **Why osascript on macOS in dev**: tauri-plugin-notification's dev-
/// mode path calls `notify_rust::set_application("com.apple.Terminal")`
/// (see desktop.rs:209). The notification then needs Terminal to have
/// notification permission in System Settings, which most devs never
/// grant — so the notification fires into the void. In release builds
/// the plugin uses the app's bundle id and works fine. We shell out to
/// `osascript` in dev so the notification reliably appears under
/// "Script Editor" / system attribution. Release builds use the
/// plugin path with the app's own bundle id.
#[tauri::command]
pub async fn show_notification(
    app: AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    tracing::info!(%title, %body, "show_notification");

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        // Audible cue independent of notification-banner permission.
        // Even if macOS suppresses the visual banner (Focus mode, Script
        // Editor permission missing, etc.), the user still hears the
        // timer fire. Detached so it doesn't block the IPC return.
        // Custom "happy bells" notification — embedded via include_bytes!
        // and extracted to a temp file the first time it's needed.
        // `afplay` requires a real path; the temp extraction is one-shot
        // (cached for subsequent calls via OnceLock).
        if let Some(path) = focus_timer_sound_path() {
            let _ = Command::new("afplay").arg(&path).spawn();
        } else {
            // Extraction failed — fall back to a system sound so the
            // user still gets an audible cue.
            let _ = Command::new("afplay")
                .arg("/System/Library/Sounds/Sosumi.aiff")
                .spawn();
        }
    }

    #[cfg(target_os = "macos")]
    if tauri::is_dev() {
        use std::process::Command;
        let escape = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
        let title_esc = escape(&title);
        let body_esc = escape(&body);

        // 1) `terminal-notifier` if installed (brew install terminal-notifier).
        //    Has its own bundle id, more likely to have notification
        //    permission granted out of the box.
        if Command::new("which")
            .arg("terminal-notifier")
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            match Command::new("terminal-notifier")
                .args(["-title", &title, "-message", &body])
                .status()
            {
                Ok(status) if status.success() => {
                    tracing::info!("terminal-notifier fired");
                    return Ok(());
                }
                other => tracing::warn!(?other, "terminal-notifier failed — trying next"),
            }
        }

        // 2) `tell application "Terminal" to display notification` —
        //    routes the notification through Terminal.app's permission
        //    rather than Script Editor's. tauri-plugin-notification's
        //    dev-mode path also targets Terminal, so this aligns the
        //    permission requirement.
        let terminal_script = format!(
            r#"tell application "Terminal" to display notification "{body}" with title "{title}""#,
            body = body_esc,
            title = title_esc,
        );
        match Command::new("osascript")
            .arg("-e")
            .arg(&terminal_script)
            .status()
        {
            Ok(status) if status.success() => {
                tracing::info!("osascript-via-Terminal notification fired");
                return Ok(());
            }
            other => tracing::warn!(?other, "osascript-via-Terminal failed — trying next"),
        }

        // 3) Plain `osascript display notification` (Script Editor attribution).
        let script = format!(
            r#"display notification "{body}" with title "{title}""#,
            body = body_esc,
            title = title_esc,
        );
        match Command::new("osascript").arg("-e").arg(&script).status() {
            Ok(status) if status.success() => {
                tracing::info!("osascript notification fired (Script Editor attribution)");
                return Ok(());
            }
            other => tracing::warn!(?other, "osascript notification failed — falling back to plugin"),
        }
    }

    let result = app
        .notification()
        .builder()
        .title(&title)
        .body(&body)
        .show();

    match result {
        Ok(_) => {
            tracing::info!("plugin notification fired");
            Ok(())
        }
        Err(e) => {
            tracing::warn!(error = %e, "failed to show notification");
            Err(e.to_string())
        }
    }
}
