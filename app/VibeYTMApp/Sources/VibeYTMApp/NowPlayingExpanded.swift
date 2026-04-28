import SwiftUI
import PlayerCore
import YTMBridge

/// Full-screen "expanded" Now Playing surface — large artwork on the
/// left, title + artist + scrubber + transport on the right.
///
/// **DISMISSAL CONTRACT (regression-prevention):**
/// This sheet has been broken twice now where it was opened and the
/// user couldn't close it. Going forward there must always be at
/// least THREE redundant dismissal paths, each tested independently:
///
///   1. Visible "chevron-down" button at top-leading, bound to the
///      `.cancelAction` keyboard shortcut (Escape).
///   2. Visible "Done" button at top-trailing, bound to the
///      `.defaultAction` keyboard shortcut (Return / Enter).
///   3. Tap the backdrop area outside the player content to dismiss.
///
/// DO NOT attach nested `.sheet(isPresented:)` modifiers to this view.
/// Doing so causes SwiftUI to consume the parent sheet's keyboard
/// shortcuts (only the most-recent .sheet modifier wins), silently
/// breaking Esc / Return dismissal. If you need to open lyrics or
/// queue from here, dismiss this sheet first and re-open from
/// PlayerChrome — or use a separate inspector pattern, not nested
/// sheets.
struct NowPlayingExpanded: View {
    @Environment(PlayerStore.self) private var store
    @Environment(AppBootstrap.self) private var bootstrap
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let state = store.state
        ZStack(alignment: .top) {
            backdrop(track: state.track)
                // Path 3 — tap backdrop to dismiss. Sits on its own
                // layer below the content so taps only register when
                // the user clicks empty space, not on buttons /
                // sliders / cover art.
                .contentShape(Rectangle())
                .onTapGesture { dismiss() }

            VStack(spacing: 0) {
                header
                Spacer(minLength: 24)
                content(state: state)
                    .padding(.horizontal, 40)
                Spacer(minLength: 24)
            }
            // Block backdrop tap-to-dismiss when the click lands on
            // actual interactive content. The backdrop tapGesture is
            // the OUTER layer; this VStack's contentShape makes it
            // hit-test as a unit so its onTapGesture (a no-op) wins
            // over the backdrop's. Without this, every click on a
            // button or slider would also trigger dismissal.
            .contentShape(Rectangle())
            .onTapGesture { /* swallow */ }
        }
        .frame(minWidth: 880, minHeight: 600, idealHeight: 700)
    }

    @ViewBuilder
    private var header: some View {
        HStack(spacing: 12) {
            // Path 1 — chevron-down + Esc.
            Button { dismiss() } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(.white.opacity(0.18), in: Circle())
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.cancelAction)

            Spacer()

            // Path 2 — Done + Return.
            Button("Done") { dismiss() }
                .buttonStyle(.borderedProminent)
                .controlSize(.regular)
                .keyboardShortcut(.defaultAction)
        }
        .padding(.horizontal, 24)
        .padding(.top, 16)
    }

    @ViewBuilder
    private func content(state: PlayerState) -> some View {
        HStack(alignment: .center, spacing: 44) {
            Cover(track: state.track)
                .frame(width: 380, height: 380)
                .shadow(color: .black.opacity(0.5), radius: 36, y: 18)

            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(state.track?.title.isEmpty == false ? state.track!.title : "Not Playing")
                        .font(.system(size: 30, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    if let artist = state.track?.artist, !artist.isEmpty {
                        Text(artist)
                            .font(.title3)
                            .foregroundStyle(.white.opacity(0.8))
                            .lineLimit(1)
                    }
                    if let album = state.track?.album, !album.isEmpty {
                        Text(album)
                            .font(.callout)
                            .foregroundStyle(.white.opacity(0.55))
                            .lineLimit(1)
                    }
                }

                BigScrubber()
                BigTransport()
            }
            .frame(minWidth: 320, idealWidth: 440, maxWidth: 480, alignment: .leading)
        }
        .frame(maxWidth: 1100, alignment: .center)
    }

    @ViewBuilder
    private func backdrop(track: Track?) -> some View {
        ZStack {
            CachedAsyncImage(url: track?.artworkUrl.flatMap(URL.init(string:))) {
                Color.black
            }
            .blur(radius: 80)
            .saturation(1.4)
            Color.black.opacity(0.55)
        }
        .ignoresSafeArea()
    }
}

private struct Cover: View {
    let track: Track?

    var body: some View {
        CachedAsyncImage(url: track?.artworkUrl.flatMap(URL.init(string:))) {
            Rectangle()
                .fill(.white.opacity(0.08))
                .overlay {
                    Image(systemName: "music.note")
                        .font(.system(size: 64))
                        .foregroundStyle(.white.opacity(0.3))
                }
        }
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }
}

private struct BigScrubber: View {
    @Environment(PlayerStore.self) private var store
    @Environment(AppBootstrap.self) private var bootstrap
    @State private var draggingValue: Double?

    var body: some View {
        let state = store.state
        let duration = state.track?.durationSecs ?? 0
        let hasTrack = state.track != nil && duration > 0
        let displayValue = draggingValue ?? state.positionSecs

        VStack(spacing: 6) {
            Slider(
                value: Binding(
                    get: { displayValue },
                    set: { draggingValue = $0 }
                ),
                in: 0 ... max(duration, 1),
                onEditingChanged: { editing in
                    if !editing, let target = draggingValue {
                        bootstrap.seek(secs: target)
                        if state.status != .playing {
                            bootstrap.play()
                        }
                        draggingValue = nil
                    }
                }
            )
            .tint(.white)
            .disabled(!hasTrack)

            HStack {
                Text(format(displayValue))
                Spacer()
                Text(format(duration))
            }
            .font(.caption.monospaced())
            .foregroundStyle(.white.opacity(0.7))
        }
    }

    private func format(_ secs: Double) -> String {
        guard secs.isFinite, secs >= 0 else { return "—:—" }
        let total = Int(secs)
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

private struct BigTransport: View {
    @Environment(PlayerStore.self) private var store
    @Environment(AppBootstrap.self) private var bootstrap

    var body: some View {
        let state = store.state
        let isPlaying = state.status == .playing
        let repeatActive = state.repeatMode != .none

        HStack(spacing: 28) {
            Button { bootstrap.toggleShuffle() } label: {
                Image(systemName: "shuffle")
                    .font(.title3)
                    .foregroundStyle(state.isShuffled ? Color.accentColor : .white.opacity(0.85))
            }
            Button { bootstrap.previous() } label: {
                Image(systemName: "backward.fill")
                    .font(.title2)
                    .foregroundStyle(.white)
            }
            Button { bootstrap.togglePlay() } label: {
                Image(systemName: isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(.white)
            }
            Button { bootstrap.next() } label: {
                Image(systemName: "forward.fill")
                    .font(.title2)
                    .foregroundStyle(.white)
            }
            Button { bootstrap.toggleRepeatMode() } label: {
                Image(systemName: state.repeatMode == .one ? "repeat.1" : "repeat")
                    .font(.title3)
                    .foregroundStyle(repeatActive ? Color.accentColor : .white.opacity(0.85))
            }
            Button { bootstrap.toggleLike() } label: {
                Image(systemName: state.isLiked ? "heart.fill" : "heart")
                    .font(.title3)
                    .foregroundStyle(state.isLiked ? Color.pink : .white.opacity(0.85))
            }
        }
        .buttonStyle(.borderless)
    }
}
