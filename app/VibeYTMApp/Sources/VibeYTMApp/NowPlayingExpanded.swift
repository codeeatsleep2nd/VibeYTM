import SwiftUI
import PlayerCore
import YTMBridge

/// Full-screen "expanded" Now Playing surface — large artwork on the
/// left, title + artist + scrubber + transport on the right. Modeled on
/// macOS Apple Music's "full screen player" treatment: a darkened glass
/// backdrop, oversized cover, and a spacious typographic block. The
/// chrome's artwork thumb opens this sheet; tapping outside or pressing
/// Escape dismisses it.
struct NowPlayingExpanded: View {
    @Environment(PlayerStore.self) private var store
    @Environment(AppBootstrap.self) private var bootstrap
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let state = store.state
        ZStack(alignment: .topLeading) {
            backdrop(track: state.track)

            // Header row with a real Done button + a chevron-down icon —
            // either dismisses the sheet. The previous corner X glyph at
            // 22 pt against a dark blurred backdrop was visually invisible
            // and `.cancelAction` keyboard shortcut didn't reach the
            // button when focus wasn't there. Apple Music's expanded
            // player uses a chevron-down on the left + Done on the right;
            // mirror both so users have an obvious path back.
            VStack(spacing: 0) {
                HStack(spacing: 12) {
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

                    Button("Done") { dismiss() }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.regular)
                        .keyboardShortcut(.defaultAction)
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)

                Spacer(minLength: 0)
            }

            HStack(alignment: .center, spacing: 36) {
                Cover(track: state.track)
                    .frame(width: 320, height: 320)
                    .shadow(color: .black.opacity(0.5), radius: 40, y: 20)

                VStack(alignment: .leading, spacing: 18) {
                    Spacer(minLength: 0)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(state.track?.title.isEmpty == false ? state.track!.title : "Not Playing")
                            .font(.system(size: 30, weight: .bold))
                            .foregroundStyle(.white)
                            .lineLimit(2)
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
                    Spacer(minLength: 0)
                }
                .frame(minWidth: 320, idealWidth: 420, maxWidth: 460, alignment: .leading)
            }
            .padding(.horizontal, 36)
            .padding(.top, 76)
            .padding(.bottom, 48)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        // Sheet sized to fit content with breathing room: cover (320) +
        // spacing (36) + text col (320 min) + horizontal padding (36×2) =
        // 748 minimum. Earlier layout (380 cover, 460 text, 64 padding)
        // demanded 1016 pt and clipped on the chrome's own minWidth=980
        // sheet — content at the right edge fell outside the visible
        // area. Smaller cover + tighter padding + flexible text column
        // keeps everything inside the frame.
        .frame(minWidth: 800, minHeight: 560)
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
            Rectangle().fill(.white.opacity(0.08))
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
                        draggingValue = nil
                    }
                }
            )
            .tint(.white)

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
        guard secs.isFinite, secs >= 0 else { return "—" }
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
        HStack(spacing: 24) {
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
                    .foregroundStyle(state.repeatMode == .none ? .white.opacity(0.85) : Color.accentColor)
            }
        }
        .buttonStyle(.borderless)
    }
}
