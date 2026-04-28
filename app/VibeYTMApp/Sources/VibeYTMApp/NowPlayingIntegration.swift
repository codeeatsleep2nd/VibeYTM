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

    init(bootstrap: AppBootstrap) {
        self.bootstrap = bootstrap
        wireRemoteCommands()
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

            // Artwork is intentionally NOT pushed via
            // `MPMediaItemArtwork(boundsSize:requestHandler:)` here.
            // The system invokes that closure on a background dispatch
            // queue, but the enclosing class is `@MainActor` — Swift 6
            // strict concurrency trips a libdispatch isolation
            // assertion the moment MediaPlayer calls back. Once we have
            // a Sendable-friendly artwork pipeline (probably via NSData
            // bytes captured non-isolated), this branch can return.
            // Title / artist / duration / position still surface to the
            // OS Now Playing widget — only the cover image is missing.
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = mapPlaybackState(state.status)
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
        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.bootstrap?.play() }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.bootstrap?.pause() }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.bootstrap?.togglePlay() }
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.bootstrap?.next() }
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.bootstrap?.previous() }
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let positionEvent = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            Task { @MainActor in self?.bootstrap?.seek(secs: positionEvent.positionTime) }
            return .success
        }
        // Enable each command — disabled commands hide their corresponding
        // button in the Now Playing widget.
        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.togglePlayPauseCommand.isEnabled = true
        center.nextTrackCommand.isEnabled = true
        center.previousTrackCommand.isEnabled = true
        center.changePlaybackPositionCommand.isEnabled = true
    }
}

