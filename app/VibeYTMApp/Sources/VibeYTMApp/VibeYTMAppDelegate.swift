import AppKit
import SwiftUI

/// AppKit delegate hosted via `@NSApplicationDelegateAdaptor` so we can
/// intercept lifecycle events SwiftUI's `App` protocol doesn't expose.
///
/// Currently handles:
///   • Dock-icon reopen (#13) — when the user closes the main window
///     (red traffic-light) and later clicks the dock icon, the system
///     sends `applicationShouldHandleReopen`. SwiftUI's default response
///     is to NOT reopen the window. We override and explicitly bring an
///     existing window forward, or instruct SwiftUI to materialise a
///     fresh one if none exist.
///   • macOS app lifecycle (`applicationWillTerminate`) is wired
///     elsewhere in `AppBootstrap.installShutdownHook()`.
final class VibeYTMAppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        // Only reopen when there's no visible main window. If a window
        // already exists (on another Space, minimised, etc.) AppKit
        // brings it forward automatically.
        if !flag {
            for window in sender.windows where window.canBecomeMain {
                window.makeKeyAndOrderFront(nil)
            }
        }
        sender.activate(ignoringOtherApps: true)
        // Returning true tells AppKit to also fire its default handling
        // (which materialises a WindowGroup window if none exist).
        return true
    }

    /// When the last window is closed, keep the app alive so the audio
    /// engine and bridge keep running. Quit only on explicit Cmd-Q or
    /// menubar Quit. This matches Apple Music's behaviour and is the
    /// other half of issue #13's fix — without it, closing the window
    /// also kills the app and dock-icon reopens become impossible.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
}
