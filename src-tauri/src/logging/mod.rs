use std::fs::OpenOptions;
use std::sync::Mutex;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Initialize tracing for both stdout AND (optionally) an on-disk file.
///
/// Two env vars:
///   - `RUST_LOG=…`        — standard `tracing` filter, applies to all
///                            sinks. Defaults to `vibeytm=debug,info`.
///   - `VIBEYTM_LOG_FILE=<path>`
///                          — append tracing output to this file too.
///                            Lets a user diagnose a release-only bug
///                            without rebuilding with custom logging.
///                            Use e.g. `VIBEYTM_LOG_FILE=~/vibeytm.log`
///                            then read the file after reproducing.
///
/// The file sink is ANSI-stripped and locked behind a `Mutex<File>` so
/// concurrent writes from background tasks interleave cleanly.
pub fn init_logging() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("vibeytm=debug,info"));

    // Optional file sink — opens lazily, silently skipped if the path
    // isn't writable so a typo'd env var doesn't crash startup.
    let file_layer = std::env::var("VIBEYTM_LOG_FILE").ok().and_then(|path| {
        let expanded = shellexpand_tilde(&path);
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&expanded)
            .ok()
            .map(|file| {
                fmt::layer()
                    .with_writer(Mutex::new(file))
                    .with_ansi(false)
            })
    });

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer())
        .with(file_layer)
        .init();
}

/// Expand a leading `~` to `$HOME`. We avoid the `shellexpand` crate
/// just to keep the dependency surface small — only `~/` prefix is
/// handled, which is the realistic VIBEYTM_LOG_FILE usage.
fn shellexpand_tilde(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    path.to_string()
}
