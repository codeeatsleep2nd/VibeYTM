import Foundation
import OSLog
import PlayerCore

private let snapshotLog = Logger(subsystem: "com.vibeytm.dev", category: "Snapshot")

/// Cross-process playback snapshot. Written to the App Group container
/// (`group.com.vibeytm.dev`) so widgets, Control Center, and AppIntents
/// extensions can read current track state without IPC into the host.
///
/// Write cadence (every poll cycle from `AppBootstrap.handle(snapshot:)`):
///   - Always rewrite the file (Codable JSON, atomic write).
///   - Post `com.vibeytm.dev.snapshot-updated` Darwin notification only on:
///     • videoId change (track change)
///     • status change (playing ↔ paused ↔ buffering ↔ idle)
///     • Every Nth poll cycle for position updates (N = 20 → ~3 s)
///
/// Widget extensions observe the Darwin notification and call
/// `WidgetCenter.shared.reloadAllTimelines()`, throttled by
/// `widgetReloadThrottleMs` to prevent OS rate-limiting after detecting
/// bursty reloads.
///
/// Sprint 0 lands the writer + the snapshot type; widgets that consume the
/// file land in Sprint 4. Until then, the file just sits in the App Group
/// container as a forward-looking artifact (a small Codable JSON).
struct SharedPlaybackSnapshot: Codable, Sendable, Equatable {
    let videoId: String?
    let title: String
    let artist: String
    let album: String
    let durationSecs: Double
    let positionSecs: Double
    /// String form of `PlaybackStatus` (`playing` / `paused` / `buffering` /
    /// `idle`). Encoded as a string so widget extensions don't need to
    /// import PlayerCore just to decode the snapshot.
    let status: String
    let artworkUrl: String?
    let timestamp: Date

    init(state: PlayerState) {
        self.videoId = state.track?.videoId
        self.title = state.track?.title ?? ""
        self.artist = state.track?.artist ?? ""
        self.album = state.track?.album ?? ""
        self.durationSecs = state.track?.durationSecs ?? 0
        self.positionSecs = state.positionSecs
        self.status = state.status.rawValue
        self.artworkUrl = state.track?.artworkUrl
        self.timestamp = Date()
    }
}

/// Constants shared between the host (writer) and widget extensions
/// (readers). Centralized so a misconfiguration only needs to change in
/// one place.
enum SharedPlaybackSnapshotConstants {
    /// App Group identifier — must match the entitlement file.
    static let appGroup = "group.com.vibeytm.dev"
    /// Snapshot filename inside the App Group container.
    static let filename = "snapshot.json"
    /// Darwin notification name posted by the writer on meaningful change.
    static let notificationName = "com.vibeytm.dev.snapshot-updated"
    /// Position-change throttling: notify only every Nth poll cycle when
    /// only `positionSecs` changed (videoId / status changes always notify).
    /// At a 150 ms poll cadence this means a position-only notification
    /// every ~3 s. Tunable.
    static let notifyEveryNPolls = 20
    /// Widget extension's reload throttle. Widgets coalesce notifications
    /// inside this window into a single `reloadAllTimelines()` call.
    static let widgetReloadThrottleMs = 2000
}

/// Writes `SharedPlaybackSnapshot` to the App Group container and posts
/// Darwin notifications when consumers should refresh. `@MainActor` because
/// it's driven from `AppBootstrap.handle(snapshot:)`, which is itself
/// `@MainActor`.
@MainActor
final class SharedPlaybackSnapshotWriter {
    private var lastVideoId: String?
    private var lastStatus: String?
    private var pollsSinceLastNotify = 0
    /// Latches true the first time `containerURL()` returns nil so we log
    /// the App Group entitlement-missing condition exactly ONCE per
    /// process lifetime. Without this, every poll cycle (~150 ms) would
    /// re-log the error — ~400 noisy entries/min in Console.app and
    /// wasted CPU. Cleared if the container ever becomes available
    /// (e.g. after a build with Developer ID signing).
    private var didLogContainerMissing = false

    init() {}

    /// Persist the snapshot to disk and decide whether to post a Darwin
    /// notification. Safe to call on every poll cycle — writes are atomic
    /// and the file is small (~300 bytes typical).
    func write(_ snapshot: SharedPlaybackSnapshot) {
        guard let url = Self.containerURL() else {
            // App Group entitlement missing — log once and skip. Widgets
            // will fall back to their placeholder until the entitlement is
            // provisioned. Don't crash, don't spam.
            if !didLogContainerMissing {
                snapshotLog.error(
                    "App Group container unavailable — entitlement missing for \(SharedPlaybackSnapshotConstants.appGroup, privacy: .public). Suppressing further log entries this session."
                )
                didLogContainerMissing = true
            }
            return
        }
        // Container is now available — reset the latch so we'd re-log
        // if it disappears (defensive; unlikely outside testing).
        didLogContainerMissing = false
        let fileURL = url.appendingPathComponent(SharedPlaybackSnapshotConstants.filename)
        do {
            let data = try JSONEncoder().encode(snapshot)
            try data.write(to: fileURL, options: .atomic)
        } catch {
            snapshotLog.error("Snapshot write failed: \(error.localizedDescription, privacy: .public)")
            return
        }

        if Self.shouldNotify(
            snapshot: snapshot,
            lastVideoId: lastVideoId,
            lastStatus: lastStatus,
            pollsSinceLastNotify: pollsSinceLastNotify
        ) {
            Self.postDarwinNotification()
            pollsSinceLastNotify = 0
        } else {
            pollsSinceLastNotify += 1
        }
        lastVideoId = snapshot.videoId
        lastStatus = snapshot.status
    }

    // MARK: - Decisions (pure, testable)

    /// Pure decision function — returns true if a Darwin notification
    /// should fire for this snapshot. Extracted as static so
    /// `SharedPlaybackSnapshotTests` can verify cadence rules without
    /// touching the file system or the notification center.
    static func shouldNotify(
        snapshot: SharedPlaybackSnapshot,
        lastVideoId: String?,
        lastStatus: String?,
        pollsSinceLastNotify: Int
    ) -> Bool {
        if snapshot.videoId != lastVideoId { return true }
        if snapshot.status != lastStatus { return true }
        if pollsSinceLastNotify >= SharedPlaybackSnapshotConstants.notifyEveryNPolls { return true }
        return false
    }

    // MARK: - Helpers

    static func containerURL() -> URL? {
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: SharedPlaybackSnapshotConstants.appGroup
        )
    }

    static func postDarwinNotification() {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(),
            CFNotificationName(SharedPlaybackSnapshotConstants.notificationName as CFString),
            nil,
            nil,
            true
        )
    }
}
