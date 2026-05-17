import SwiftUI
import PlayerCore
import YTMBridge

/// Queue panel — displayed as a sheet from the chrome's queue button.
/// Shows the upcoming tracks (live from the bridge poller's queue read)
/// with the currently-playing track highlighted at the top.
struct QueuePanel: View {
    /// Closure-based dismissal (Sprint 0 AppRouter migration). Caller
    /// flips `router.isQueueOpen = false` via this closure. See LyricsPanel
    /// for the rationale.
    let onDismiss: () -> Void

    @Environment(PlayerStore.self) private var store
    @Environment(AppBootstrap.self) private var bootstrap

    var body: some View {
        let state = store.state
        VStack(spacing: 0) {
            HStack {
                Text("Queue")
                    .font(.title2.weight(.semibold))
                Spacer()
                Button("Done", action: onDismiss)
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.plain)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .glassEffect(in: .capsule)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(.thinMaterial)

            Divider()

            if state.queue.isEmpty {
                emptyState
            } else {
                ScrollView(.vertical) {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(state.queue.enumerated()), id: \.element.videoId) { index, track in
                            QueueRow(
                                track: track,
                                index: index,
                                isCurrent: track.videoId == state.track?.videoId
                            )
                            .onTapGesture {
                                bootstrap.play(item: ShelfItemFromTrack(track))
                            }
                            Divider()
                                .padding(.leading, 64)
                        }
                    }
                }
            }
        }
        .frame(minWidth: 480, minHeight: 540)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "list.bullet.rectangle.portrait")
                .font(.system(size: 36))
                .foregroundStyle(.secondary)
            Text("Queue is empty")
                .font(.headline)
            Text("Start playback or add a track to the queue.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.top, 60)
    }
}

private struct QueueRow: View {
    let track: Track
    let index: Int
    let isCurrent: Bool

    var body: some View {
        HStack(spacing: 12) {
            CachedAsyncImage(url: track.artworkUrl.flatMap(URL.init(string:))) {
                Rectangle().fill(.secondary.opacity(0.15))
            }
            .frame(width: 40, height: 40)
            .clipShape(RoundedRectangle(cornerRadius: 4))

            VStack(alignment: .leading, spacing: 2) {
                Text(track.title)
                    .font(.body.weight(isCurrent ? .semibold : .regular))
                    .foregroundStyle(isCurrent ? Color.accentColor : .primary)
                    .lineLimit(1)
                Text(track.artist)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            if isCurrent {
                Image(systemName: "speaker.wave.2.fill")
                    .foregroundStyle(Color.accentColor)
                    .font(.caption)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }
}

/// Small adapter so QueuePanel can call `bootstrap.play(item:)` with a
/// minimal payload for queue rows. The full ShelfItem fields aren't
/// needed for navigation; only `videoId` matters.
private func ShelfItemFromTrack(_ track: Track) -> ShelfItem {
    ShelfItem(
        id: track.videoId,
        title: track.title,
        subtitle: track.artist,
        artworkUrl: track.artworkUrl,
        videoId: track.videoId,
        playlistId: nil,
        browseId: nil
    )
}
