import SwiftUI
import AppKit
import PlayerCore
import YTMBridge

/// Full-screen "expanded" Now Playing surface — large artwork on the
/// left, title + artist + scrubber + transport on the right.
///
/// **DISMISSAL CONTRACT (regression-prevention).** This sheet has been
/// dismiss-trapped FOUR times. The current contract has FIVE redundant
/// paths and three forbidden anti-patterns:
///
///   1. Caller passes an explicit `onDismiss` closure that flips its
///      own presentation state. We do NOT use `@Environment(\.dismiss)`
///      — it has been observed to fail silently inside sheets that
///      mix keyboardShortcut bindings with focus-effect modifiers.
///   2. Visible chevron-down button (top-leading) — calls onDismiss
///      directly. Bound to `.keyboardShortcut(.cancelAction)`.
///   3. Visible "Done" button (top-trailing) — calls onDismiss
///      directly. Bound to `.keyboardShortcut(.defaultAction)`.
///   4. Full-frame click-catcher Button beneath the content layer:
///      a transparent Button with `Rectangle().fill(opacity 0.001)`
///      as its label. SwiftUI's Button hit-testing makes inner
///      Buttons consume their own clicks first; clicks on empty
///      backdrop area fall through to the catcher. This is the
///      mouse-only-dismiss path. Implemented as a Button (NOT an
///      `.onTapGesture`) because tap-gestures on a parent block
///      child Button taps in some macOS 26 builds.
///   5. Local NSEvent monitor watches for the Esc key while the sheet
///      is on screen and calls onDismiss directly. Returns `nil` from
///      the monitor to consume the event.
///
/// FORBIDDEN PATTERNS (each one previously re-opened this regression):
///   • `@Environment(\.dismiss)` — failed silently in earlier rounds.
///   • `.contentShape(Rectangle()).onTapGesture` on the content
///     VStack as a "swallow" — hijacked chevron + Done button clicks.
///     Use a real Button as the click-catcher (path 4) instead.
///   • Nested `.sheet(isPresented:)` — only the most-recent .sheet
///     modifier on a subtree wins, and nested presentations consume
///     the parent's keyboard shortcuts.
struct NowPlayingExpanded: View {
    let onDismiss: () -> Void

    @Environment(PlayerStore.self) private var store
    @Environment(AppBootstrap.self) private var bootstrap
    @State private var escMonitor: Any?

    var body: some View {
        let state = store.state
        ZStack(alignment: .top) {
            // Layer 1 — backdrop visual.
            backdrop(track: state.track)

            // Layer 2 — full-frame transparent button that calls
            // onDismiss. Sits BENEATH the content layer. SwiftUI's
            // Button hit-testing means inner Buttons (chevron, Done,
            // transport controls, etc.) receive clicks first; only
            // taps on empty backdrop regions fall through to this
            // catcher. The previous swallow-gesture approach blocked
            // inner button taps too — using a real Button instead of
            // an `.onTapGesture` is the reliable form.
            Button(action: onDismiss) {
                Rectangle().fill(Color.black.opacity(0.001))
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            // Layer 3 — actual player content. No swallow gestures
            // here; each interactive child (chevron, Done, slider,
            // transport buttons) consumes its own click events.
            VStack(spacing: 0) {
                header
                Spacer(minLength: 24)
                content(state: state)
                    .padding(.horizontal, 40)
                Spacer(minLength: 24)
            }
        }
        .frame(minWidth: 880, minHeight: 600, idealHeight: 700)
        // Path 5 — install a local NSEvent monitor for Esc. The
        // SwiftUI .cancelAction shortcut is unreliable here; a local
        // monitor gives us a guaranteed Esc-handler regardless of
        // focus chain or other modifiers in scope.
        //
        // SwiftUI may fire `.onAppear` more than once before
        // `.onDisappear` (e.g. when a sheet is presented during a
        // rapid presentation transition). Guarding on `escMonitor ==
        // nil` prevents leaking a duplicate registration; double
        // monitors would each consume the Esc keyDown and call
        // onDismiss twice, but more importantly the first registration
        // would leak forever because the @State only tracks the most
        // recent token.
        .onAppear {
            guard escMonitor == nil else { return }
            escMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
                if event.keyCode == 53 {  // 53 = kVK_Escape
                    onDismiss()
                    return nil  // consume the event
                }
                return event
            }
        }
        .onDisappear {
            if let m = escMonitor {
                NSEvent.removeMonitor(m)
                escMonitor = nil
            }
        }
    }

    @ViewBuilder
    private var header: some View {
        HStack(spacing: 12) {
            // Path 2 — chevron-down. Direct closure call.
            Button(action: onDismiss) {
                Image(systemName: "chevron.down")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(.white.opacity(0.18), in: Circle())
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.cancelAction)

            Spacer()

            // Path 3 — Done. Direct closure call.
            Button("Done", action: onDismiss)
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
