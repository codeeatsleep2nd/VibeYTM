import AppKit
import SwiftUI

/// AppKit delegate hosted via `@NSApplicationDelegateAdaptor` so we can
/// intercept lifecycle events SwiftUI's `App` protocol doesn't expose.
///
/// Handles:
///   • Dock-icon reopen (#13) — bring the window back when the user
///     clicks the dock icon after closing.
///   • Close-to-tray vs quit-on-close (#43) — depending on the user's
///     preference, the last window closing either keeps the app alive
///     (tray mode) or terminates it.
///
/// `applicationWillTerminate` (final persistence flush) is wired in
/// `AppBootstrap.installShutdownHook()` separately.
/// `applicationShouldTerminateAfterLastWindowClosed` reads the flag
/// dynamically — the user can toggle the preference at any time and
/// the next close honours the new value.
final class VibeYTMAppDelegate: NSObject, NSApplicationDelegate {
    /// Late-bound reference set from the SwiftUI `App` once the
    /// bootstrap is constructed. Accessed via a global proxy so the
    /// delegate can observe user preferences without a circular
    /// init dependency.
    weak var bootstrap: AppBootstrap?

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            for window in sender.windows where window.canBecomeMain && window.contentView != nil {
                window.makeKeyAndOrderFront(nil)
            }
        }
        sender.activate(ignoringOtherApps: true)
        return true
    }

    /// `false` when close-to-tray is ON (#43): keep the app alive and
    /// available via dock-icon reopen. `true` when close-to-tray is
    /// OFF: red traffic-light = quit. Defaults to ON if the bootstrap
    /// hasn't been wired yet (matches PersistedState.default).
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        !(bootstrap?.closeToTray ?? true)
    }
}
