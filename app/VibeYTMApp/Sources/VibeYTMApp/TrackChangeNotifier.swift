import Foundation
import AppKit
import UserNotifications
import OSLog
import PlayerCore

private let notifLog = Logger(subsystem: "com.vibeytm.dev", category: "Notifier")

/// Fires a UNUserNotificationCenter banner on track change when the app
/// is in the background. Skips notifications when the app is active —
/// the user can already see the chrome + Now Playing widget in that
/// case, a notification would be redundant noise.
///
/// Permission flow: requests `[.alert, .sound]` authorization on first
/// run. If denied, silently no-ops on subsequent track changes. The user
/// can re-enable later via System Settings → Notifications → VibeYTM.
///
/// Driven from `AppBootstrap.handle(snapshot:)` — after `playerStore.apply()`,
/// the bootstrap calls `trackChangeNotifier.onTrackChange(newTrack:)`.
@MainActor
final class TrackChangeNotifier {
    private var lastVideoId: String?
    private var authorizationRequested = false

    init() {
        // Authorization request happens lazily on first track change so
        // first-launch flow doesn't immediately prompt before the user
        // has played anything.
    }

    /// Called from AppBootstrap whenever a new PlayerState lands. Diffs
    /// against the previous track and fires a notification only on a
    /// real track change (not metadata refinement, not status flip).
    func onTrackChange(newTrack: Track?) {
        let newId = newTrack?.videoId
        defer { lastVideoId = newId }
        guard let track = newTrack, let id = newId, id != lastVideoId else { return }
        // Don't notify on the very first track of a session — that's a
        // user-initiated play, they already know what they queued.
        guard lastVideoId != nil else { return }

        // Skip when the app is active — user can see the chrome update.
        if NSApplication.shared.isActive { return }

        Task {
            await self.requestAuthorizationIfNeeded()
            await self.deliver(track: track)
        }
    }

    private func requestAuthorizationIfNeeded() async {
        guard !authorizationRequested else { return }
        authorizationRequested = true
        let center = UNUserNotificationCenter.current()
        do {
            _ = try await center.requestAuthorization(options: [.alert, .sound])
        } catch {
            notifLog.notice("Notification authorization request failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func deliver(track: Track) async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
            return
        }

        let content = UNMutableNotificationContent()
        content.title = track.title
        content.subtitle = track.artist.isEmpty ? "VibeYTM" : track.artist
        if !track.album.isEmpty {
            content.body = track.album
        }
        content.sound = nil  // music app notification — no chime competing with the song

        // Trigger immediately. nil trigger = deliver on next runloop pass.
        let request = UNNotificationRequest(
            identifier: "vibeytm.trackChange.\(track.videoId)",
            content: content,
            trigger: nil
        )
        do {
            try await center.add(request)
        } catch {
            notifLog.notice("Notification delivery failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}
