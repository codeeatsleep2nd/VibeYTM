import Foundation
import AppKit
import MediaPlayer
import PlayerCore

/// Bridges PlayerState → macOS Now Playing widget + media key remote
/// commands. `@MainActor` because both `MPNowPlayingInfoCenter` and
/// `MPRemoteCommandCenter` callbacks need to land on the main thread to
/// touch SwiftUI state via `AppBootstrap`. This class is created at app
/// launch and lives for the lifetime of the process.
///
/// Update flow:
///   • `apply(_:)` is called from `AppBootstrap.handle(snapshot:)` right
///     after the player store gets a fresh state. It rebuilds the
///     `nowPlayingInfo` dictionary and pushes it to the system. Artwork
///     loading is async and out-of-band — the dictionary is published
///     immediately with metadata, then patched again once the image
///     decode completes.
///   • Remote commands fire on a system thread; handlers hop back to
///     `@MainActor` via `Task { @MainActor in ... }` to call the
///     bootstrap forwarders.
@MainActor
final class NowPlayingIntegration {
    private weak var bootstrap: AppBootstrap?
    /// Pairs of (command, opaque token) returned by
    /// `MPRemoteCommand.addTarget(_:)`, kept so `deinit` can call
    /// `removeTarget(_:)` for each registration. Without this,
    /// re-creating `NowPlayingIntegration` (or calling
    /// `wireRemoteCommands` more than once) would accumulate ghost
    /// handlers that fire callbacks against a stale `bootstrap`.
    /// Storage is a flat append-only array — pairing is positional,
    /// not keyed.
    private var commandTokens: [(command: MPRemoteCommand, token: Any)] = []

    /// videoId of the most recent track whose artwork load we kicked off.
    /// Used by the async artwork pipeline to bail out if the track
    /// changed during the URLSession fetch — we'd otherwise patch the
    /// Now Playing dictionary with stale cover art.
    private var pendingArtworkVideoId: String?

    /// In-flight artwork load, cancelled when a new track arrives.
    private var artworkTask: Task<Void, Never>?

    init(bootstrap: AppBootstrap) {
        self.bootstrap = bootstrap
        wireRemoteCommands()
    }

    deinit {
        // Remove every registered handler so subsequent
        // NowPlayingIntegration instances don't fire stale closures.
        // Captured commands must be touched on the main actor —
        // `MPRemoteCommand` is not Sendable. `MainActor.assumeIsolated`
        // is safe in `deinit` only when the type is `@MainActor`.
        MainActor.assumeIsolated {
            for (command, token) in commandTokens {
                command.removeTarget(token)
            }
        }
    }

    /// Push the current PlayerState to MPNowPlayingInfoCenter.
    func apply(_ state: PlayerState) {
        var info: [String: Any] = [:]

        if let track = state.track {
            info[MPMediaItemPropertyTitle] = track.title
            info[MPMediaItemPropertyArtist] = track.artist
            if !track.album.isEmpty {
                info[MPMediaItemPropertyAlbumTitle] = track.album
            }
            if track.durationSecs > 0 {
                info[MPMediaItemPropertyPlaybackDuration] = track.durationSecs
            }
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = state.positionSecs
            info[MPNowPlayingInfoPropertyPlaybackRate] = state.status == .playing ? 1.0 : 0.0

            // Artwork is published asynchronously below — the metadata
            // dict goes out immediately so the user sees title/artist as
            // soon as playback starts, then the cover patches in once the
            // image bytes finish downloading.
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = mapPlaybackState(state.status)

        // Async artwork pipeline. Sendable-clean: pre-fetch Data
        // off-actor, then build NSImage inside the requestHandler closure
        // capturing only the Sendable `data` (no captured `self`, no
        // captured NSImage). The closure may fire on a background queue;
        // because nothing in its captures is @MainActor-isolated, Swift 6
        // strict concurrency doesn't trip the libdispatch isolation
        // assertion that previously forced this branch to be commented out.
        if let track = state.track,
           let urlString = track.artworkUrl,
           let url = URL(string: urlString) {
            kickoffArtworkLoad(for: track.videoId, url: url, trackTitle: track.title)
        } else {
            // No artwork URL — cancel any pending load so it doesn't
            // race in and overwrite the next track's metadata.
            artworkTask?.cancel()
            pendingArtworkVideoId = nil
        }
    }

    /// Async artwork fetch + Now Playing dict patch. Cancellation-safe:
    /// a fresh `apply(_:)` call cancels the prior task before kicking off
    /// the new one. videoId comparison guards against stale completions
    /// (the in-flight task might resolve AFTER the next track started
    /// loading, in which case we drop its result).
    private func kickoffArtworkLoad(for videoId: String, url: URL, trackTitle: String) {
        // If the same artwork URL is already being loaded for the same
        // track, leave the in-flight task alone — re-kicking would just
        // double the network fetch.
        if pendingArtworkVideoId == videoId, artworkTask != nil, artworkTask?.isCancelled == false {
            return
        }
        artworkTask?.cancel()
        pendingArtworkVideoId = videoId

        artworkTask = Task { [weak self] in
            guard let data = await Self.fetchArtworkData(from: url) else { return }
            if Task.isCancelled { return }
            await MainActor.run {
                guard let self else { return }
                // The track may have changed during the fetch. Drop stale
                // results so we don't paint cover art from the previous
                // song onto the current Now Playing dict.
                guard self.pendingArtworkVideoId == videoId else { return }

                // Build the MPMediaItemArtwork with the SENDABLE `data`
                // captured in the closure. The `requestHandler` may run
                // on a background queue; capturing only `data` (no
                // `self`, no `NSImage`) keeps the closure Sendable-clean
                // under Swift 6 strict concurrency.
                let size = NSImage(data: data)?.size ?? CGSize(width: 600, height: 600)
                let artwork = MPMediaItemArtwork(boundsSize: size) { _ in
                    NSImage(data: data) ?? NSImage()
                }

                var updated = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                // Guard against the OS having cleared nowPlayingInfo
                // (e.g. due to a track-stop event) between our metadata
                // write and this artwork patch. If the title doesn't
                // match, drop the patch.
                if let title = updated[MPMediaItemPropertyTitle] as? String, title == trackTitle {
                    updated[MPMediaItemPropertyArtwork] = artwork
                    MPNowPlayingInfoCenter.default().nowPlayingInfo = updated
                }
            }
        }
    }

    /// Fetch raw artwork bytes off the main actor. `Data` is Sendable so
    /// it can cross the actor boundary safely back into the
    /// `requestHandler` closure capture.
    private static func fetchArtworkData(from url: URL) async -> Data? {
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            return data
        } catch {
            return nil
        }
    }

    // MARK: - Private

    private func mapPlaybackState(_ status: PlaybackStatus) -> MPNowPlayingPlaybackState {
        switch status {
        case .playing: .playing
        case .paused: .paused
        case .buffering: .playing  // OS treats buffering as "active"
        case .idle: .stopped
        }
    }

    private func wireRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        register(center.playCommand) { $0.play() }
        register(center.pauseCommand) { $0.pause() }
        register(center.togglePlayPauseCommand) { $0.togglePlay() }
        register(center.nextTrackCommand) { $0.next() }
        register(center.previousTrackCommand) { $0.previous() }
        // Seek is the one variant that needs the event payload; route
        // it through a dedicated overload that pulls the position out.
        registerSeek(center.changePlaybackPositionCommand)
    }

    /// Register a parameterless command. Stores the resulting token so
    /// `deinit` can clean up, and enables the command so its button
    /// appears in the OS Now Playing widget.
    private func register(
        _ command: MPRemoteCommand,
        action: @escaping @Sendable @MainActor (AppBootstrap) -> Void
    ) {
        let token = command.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let bootstrap = self?.bootstrap else { return }
                action(bootstrap)
            }
            return .success
        }
        commandTokens.append((command, token))
        command.isEnabled = true
    }

    /// Register the seek command — needs the typed event payload to
    /// extract `positionTime`, so it doesn't fit the parameterless
    /// shape of `register(_:action:)`.
    private func registerSeek(_ command: MPRemoteCommand) {
        let token = command.addTarget { [weak self] event in
            guard let positionEvent = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            Task { @MainActor in self?.bootstrap?.seek(secs: positionEvent.positionTime) }
            return .success
        }
        commandTokens.append((command, token))
        command.isEnabled = true
    }
}

