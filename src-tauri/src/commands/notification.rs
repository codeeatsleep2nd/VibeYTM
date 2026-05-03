use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// Embedded notification sound. Bundled at compile time so the app
/// is self-contained and the sound is available regardless of the
/// user's filesystem layout.
const FOCUS_TIMER_SOUND_BYTES: &[u8] =
    include_bytes!("../../sounds/focus-timer-complete.wav");

/// Escape a string for embedding inside an AppleScript double-quoted
/// literal. Backslashes must be escaped first, then double quotes —
/// reversing the order would double-escape the backslash inside an
/// already-escaped quote and either fail to parse or open an
/// injection vector. Newlines are stripped because `display
/// notification` rejects them silently and we'd lose the visual
/// banner without any error surfacing.
fn applescript_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', " ")
        .replace('\r', " ")
}

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
/// In dev mode `tauri-plugin-notification` attributes notifications to
/// Terminal.app (most users never grant Terminal notification
/// permission, so the banner fires into the void); we try
/// `terminal-notifier` first, then a Terminal-attributed osascript,
/// then a Script-Editor-attributed osascript, then the plugin path.
/// In release builds the plugin uses VibeYTM's own bundle id and works.
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
        // Even if macOS suppresses the visual banner (Focus mode, app
        // permission missing, etc.), the user still hears the timer
        // fire. Detached so it doesn't block the IPC return. The
        // bundled "happy bells" sound is extracted to temp once via
        // OnceLock; afplay requires a real path.
        if let Some(path) = focus_timer_sound_path() {
            let _ = Command::new("afplay").arg(&path).spawn();
        } else {
            let _ = Command::new("afplay")
                .arg("/System/Library/Sounds/Sosumi.aiff")
                .spawn();
        }
    }

    #[cfg(target_os = "macos")]
    if tauri::is_dev() {
        use std::process::Command;
        let title_esc = applescript_escape(&title);
        let body_esc = applescript_escape(&body);

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
        //    rather than Script Editor's.
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

#[cfg(test)]
mod tests {
    use super::applescript_escape;

    #[test]
    fn escapes_backslash_before_doublequote() {
        // Backslash → double-backslash.
        assert_eq!(applescript_escape("\\"), "\\\\");
        // Double-quote → escaped double-quote.
        assert_eq!(applescript_escape("\""), "\\\"");
        // Mixed: each character escaped independently. If the order
        // were swapped (quote first, then backslash), the freshly
        // inserted `\"` would have its `\` re-escaped to `\\\\"`.
        assert_eq!(applescript_escape("a\\b\"c"), "a\\\\b\\\"c");
    }

    #[test]
    fn strips_newlines_to_avoid_silent_dropped_notifications() {
        // `display notification` rejects literal newlines silently —
        // the AppleScript fails without any error reaching us.
        assert_eq!(applescript_escape("line1\nline2"), "line1 line2");
        assert_eq!(applescript_escape("a\rb"), "a b");
        assert_eq!(applescript_escape("a\r\nb"), "a  b");
    }

    #[test]
    fn passthrough_for_safe_input() {
        assert_eq!(
            applescript_escape("You made it, time to take a break."),
            "You made it, time to take a break."
        );
    }
}
