import Foundation

/// Snapshot persisted across launches. Holds just enough to restore the
/// user's last session: the video they were playing, where they were in
/// it, the volume, and the sidebar tab. Everything else (queue, track
/// metadata, account) is rebuilt fresh from the bridge on launch.
///
/// Stored at `~/Library/Application Support/VibeYTM/state.json`. Writes
/// are coalesced via a 500 ms debounce so per-cycle position updates
/// don't hammer disk; a final save runs on `applicationWillTerminate`.
struct PersistedState: Codable, Equatable {
    var videoId: String?
    var positionSecs: Double
    var volume: Double
    var sidebarSelection: String

    static let `default` = PersistedState(
        videoId: nil,
        positionSecs: 0,
        volume: 1.0,
        sidebarSelection: "home"
    )
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
    func saveDebounced(_ state: PersistedState) {
        let now = Date()
        guard now.timeIntervalSince(lastWriteAt) >= throttleInterval else { return }
        lastWriteAt = now
        saveImmediate(state)
    }

    /// Synchronous save — used at app exit so the final position lands
    /// on disk even if the throttle says we're in cooldown.
    func saveImmediate(_ state: PersistedState) {
        guard let data = try? JSONEncoder().encode(state) else { return }
        try? data.write(to: url, options: [.atomic])
        lastWriteAt = Date()
    }
}
