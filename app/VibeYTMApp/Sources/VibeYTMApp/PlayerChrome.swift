import SwiftUI
import PlayerCore
import YTMBridge

/// Floating bottom player chrome — Liquid Glass pill matching the visual
/// language of Apple Music's macOS 26 chrome. Layout (left → right):
///
///   • Artwork thumb (40×40, rounded) | title + artist (one line each)
///   • Spacer
///   • Prev / Play-Pause / Next transport buttons
///   • Shuffle / Repeat toggles
///   • Volume slider with speaker icons
///
/// The pill is rendered with `.glassEffect()` so the macOS 26 backdrop
/// shows through; the parent injects it via `.safeAreaInset(edge: .bottom)`
/// so list scroll content reserves space underneath.
struct PlayerChrome: View {
    @Environment(PlayerStore.self) private var store
    @Environment(AppBootstrap.self) private var bootstrap
    @State private var showQueue = false
    @State private var showLyrics = false
    @State private var showExpanded = false

    var body: some View {
        let state = store.state
        HStack(spacing: 12) {
            Button { showExpanded.toggle() } label: {
                ArtworkThumb(track: state.track)
            }
            .buttonStyle(.plain)
            .disabled(state.track == nil)

            VStack(alignment: .leading, spacing: 4) {
                Text(state.track?.title.isEmpty == false ? state.track!.title : "Not Playing")
                    .font(.body.weight(.medium))
                    .lineLimit(1)
                if let artist = state.track?.artist, !artist.isEmpty {
                    Text(artist)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if state.track != nil {
                    PositionScrubber()
                }
            }
            // Flexible width so the column adapts to the available
            // detail-pane width without clipping the transport / volume
            // controls on narrower windows. minWidth keeps the title
            // legible; maxWidth caps it on wide screens.
            .frame(minWidth: 180, idealWidth: 260, maxWidth: 320, alignment: .leading)
            .layoutPriority(1)

            Spacer(minLength: 8)

            TransportRow()

            Spacer(minLength: 8)

            ToggleRow()

            Spacer(minLength: 8)

            Button { showLyrics.toggle() } label: {
                Image(systemName: "text.quote")
            }
            .buttonStyle(.borderless)

            Button { showQueue.toggle() } label: {
                Image(systemName: "list.bullet")
            }
            .buttonStyle(.borderless)

            VolumeRow()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .glassEffect(in: .capsule)
        // Suppress the focus ring across every chrome control. macOS
        // auto-focuses the first focusable button on launch (the
        // artwork tap-to-expand or the prev button), which draws a
        // distracting rounded-square selection halo. Users still get
        // hover and active feedback; only the keyboard focus ring is
        // hidden.
        .focusEffectDisabled()
        .sheet(isPresented: $showQueue) {
            QueuePanel()
        }
        .sheet(isPresented: $showLyrics) {
            LyricsPanel()
        }
        .sheet(isPresented: $showExpanded) {
            NowPlayingExpanded()
        }
    }
}

/// Position scrubber — thin slider with current/total time labels. While
/// the user is dragging, shows the dragged value (don't fight the user
/// with bridge state); on commit, calls `bootstrap.seek(secs:)` which
/// arms the SeekFilter so stale POSITION_UPDATED echoes get filtered.
private struct PositionScrubber: View {
    @Environment(PlayerStore.self) private var store
    @Environment(AppBootstrap.self) private var bootstrap
    @State private var draggingValue: Double?

    var body: some View {
        let state = store.state
        let duration = state.track?.durationSecs ?? 0
        let liveValue = state.positionSecs
        let displayValue = draggingValue ?? liveValue

        HStack(spacing: 6) {
            Text(format(displayValue))
                .font(.caption2.monospaced())
                .foregroundStyle(.secondary)
                .frame(width: 36, alignment: .trailing)

            Slider(
                value: Binding(
                    get: { displayValue },
                    set: { draggingValue = $0 }
                ),
                in: 0 ... max(duration, 1),
                onEditingChanged: { editing in
                    if !editing, let target = draggingValue {
                        bootstrap.seek(secs: target)
                        draggingValue = nil
                    }
                }
            )
            .controlSize(.mini)

            Text(format(duration))
                .font(.caption2.monospaced())
                .foregroundStyle(.secondary)
                .frame(width: 36, alignment: .leading)
        }
    }

    private func format(_ secs: Double) -> String {
        guard secs.isFinite, secs >= 0 else { return "—" }
        let total = Int(secs)
        let m = total / 60
        let s = total % 60
        return String(format: "%d:%02d", m, s)
    }
}

private struct ArtworkThumb: View {
    let track: Track?

    var body: some View {
        CachedAsyncImage(url: track?.artworkUrl.flatMap(URL.init(string:))) {
            Rectangle().fill(.secondary.opacity(0.15))
        }
        .frame(width: 40, height: 40)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

private struct TransportRow: View {
    @Environment(PlayerStore.self) private var store
    @Environment(AppBootstrap.self) private var bootstrap

    var body: some View {
        let isPlaying = store.state.status == .playing
        HStack(spacing: 14) {
            Button { bootstrap.previous() } label: {
                Image(systemName: "backward.fill")
            }
            Button { bootstrap.togglePlay() } label: {
                Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                    .font(.title3)
            }
            Button { bootstrap.next() } label: {
                Image(systemName: "forward.fill")
            }
        }
        .buttonStyle(.borderless)
    }
}

private struct ToggleRow: View {
    @Environment(PlayerStore.self) private var store
    @Environment(AppBootstrap.self) private var bootstrap

    var body: some View {
        let state = store.state
        HStack(spacing: 12) {
            Button { bootstrap.toggleShuffle() } label: {
                Image(systemName: "shuffle")
                    .foregroundStyle(state.isShuffled ? Color.accentColor : .primary)
            }
            Button { bootstrap.toggleRepeatMode() } label: {
                Image(systemName: state.repeatMode == .one ? "repeat.1" : "repeat")
                    .foregroundStyle(state.repeatMode == .none ? Color.primary : Color.accentColor)
            }
            Button { bootstrap.toggleLike() } label: {
                Image(systemName: state.isLiked ? "heart.fill" : "heart")
                    .foregroundStyle(state.isLiked ? Color.pink : .primary)
            }
        }
        .buttonStyle(.borderless)
    }
}

private struct VolumeRow: View {
    @Environment(PlayerStore.self) private var store
    @Environment(AppBootstrap.self) private var bootstrap

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "speaker.fill")
                .font(.caption)
                .foregroundStyle(.secondary)
            Slider(
                value: Binding(
                    get: { store.state.volume },
                    set: { bootstrap.setVolume(level: $0) }
                ),
                in: 0 ... 1
            )
            .frame(width: 100)
            Image(systemName: "speaker.wave.3.fill")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}
