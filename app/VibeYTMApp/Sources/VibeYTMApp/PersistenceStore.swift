import Foundation
import OSLog

private let persistenceLog = Logger(subsystem: "com.vibeytm.dev", category: "Persistence")

/// Snapshot persisted across launches. Holds just enough to restore the
/// user's last session: the video they were playing, where they were in
/// it, the volume, the sidebar tab, and the user-toggled preferences.
/// Everything else (queue, track metadata, account) is rebuilt fresh
/// from the bridge on launch.
///
/// Stored at `~/Library/Application Support/VibeYTM/state.json`. Writes
/// are throttled (2 s); a final synchronous save runs on
/// `applicationWillTerminate`.
struct PersistedState: Codable, Equatable {
    var videoId: String?
    var positionSecs: Double
    var volume: Double
    /// Sidebar tab to restore on launch. Stored as the typed enum
    /// instead of a raw `String` so an unknown on-disk value
    /// (mismatched build) decodes to `.home` rather than producing
    /// silent navigation to a nonexistent section. The on-disk
    /// representation remains the same `rawValue` string.
    var sidebarSelection: SidebarSection
    /// When true, closing the main window hides it instead of quitting
    /// (#43). When false, red-traffic-light closes the app outright.
    /// Defaults to true — matches Apple Music's behavior.
    var closeToTray: Bool = true
    /// When true, audio continues playing after the user closes the
    /// main window (#47). When false, playback pauses on window close.
    /// Defaults to true — most users expect audio to keep playing.
    var backgroundPlayback: Bool = true

    static let `default` = PersistedState(
        videoId: nil,
        positionSecs: 0,
        volume: 1.0,
        sidebarSelection: .home,
        closeToTray: true,
        backgroundPlayback: true
    )

    private enum CodingKeys: String, CodingKey {
        case videoId, positionSecs, volume, sidebarSelection
        case closeToTray, backgroundPlayback
    }

    /// Decoding-tolerant — fields added in newer versions default
    /// gracefully when the on-disk file predates them. The sidebar
    /// section decode also tolerates an unknown raw value (build
    /// mismatch, removed section) by falling back to `.home`.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.videoId = try? c.decode(String?.self, forKey: .videoId)
        self.positionSecs = (try? c.decode(Double.self, forKey: .positionSecs)) ?? 0
        self.volume = (try? c.decode(Double.self, forKey: .volume)) ?? 1.0
        let sidebarRaw = (try? c.decode(String.self, forKey: .sidebarSelection)) ?? "home"
        self.sidebarSelection = SidebarSection(rawValue: sidebarRaw) ?? .home
        self.closeToTray = (try? c.decode(Bool.self, forKey: .closeToTray)) ?? true
        self.backgroundPlayback = (try? c.decode(Bool.self, forKey: .backgroundPlayback)) ?? true
    }

    init(
        videoId: String?,
        positionSecs: Double,
        volume: Double,
        sidebarSelection: SidebarSection,
        closeToTray: Bool = true,
        backgroundPlayback: Bool = true
    ) {
        self.videoId = videoId
        self.positionSecs = positionSecs
        self.volume = volume
        self.sidebarSelection = sidebarSelection
        self.closeToTray = closeToTray
        self.backgroundPlayback = backgroundPlayback
    }
}

@MainActor
final class PersistenceStore {
    private let url: URL
    /// Wall-clock time of the last successful disk write. Drives the
    /// throttle in `saveDebounced` — the bridge fires position updates
    /// every 150 ms, which would starve a debounce-style writer (each
    /// call cancels the previous timer before it fires). Throttle is
    /// re-arming-free: write immediately if the cooldown has passed,
    /// drop otherwise.
    private var lastWriteAt: Date = .distantPast
    /// Minimum interval between writes (seconds).
    private let throttleInterval: TimeInterval = 2.0

    init() {
        let fm = FileManager.default
        let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fm.temporaryDirectory
        let dir = support.appendingPathComponent("VibeYTM", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        self.url = dir.appendingPathComponent("state.json")
    }

    func load() -> PersistedState {
        guard let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(PersistedState.self, from: data)
        else {
            return .default
        }
        return decoded
    }

    /// Throttled save — writes at most once per `throttleInterval`. If
    /// called more often the extra calls drop. The 2-second cadence is
    /// enough to capture the user's last position within a few seconds
    /// of any meaningful interaction without thrashing the disk.
    ///
    /// Importantly, `lastWriteAt` is NOT advanced here. `saveImmediate`
    /// is the sole writer of that timestamp, and it only advances on a
    /// successful disk write. If we pre-advanced here, a write failure
    /// would still close the throttle window for 2 s and drop the next
    /// legitimate save — defeating the round-1 fix.
    func saveDebounced(_ state: PersistedState) {
        let now = Date()
        guard now.timeIntervalSince(lastWriteAt) >= throttleInterval else { return }
        saveImmediate(state)
    }

    /// Synchronous save — used at app exit so the final position lands
    /// on disk even if the throttle says we're in cooldown. Only
    /// updates `lastWriteAt` on a successful write so a transient I/O
    /// failure (disk full, permission revoked) doesn't close the
    /// throttle window for the next 2 s and silently drop another
    /// legitimate save.
    func saveImmediate(_ state: PersistedState) {
        do {
            let data = try JSONEncoder().encode(state)
            try data.write(to: url, options: [.atomic])
            lastWriteAt = Date()
        } catch {
            persistenceLog.error("Persistence save failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}
