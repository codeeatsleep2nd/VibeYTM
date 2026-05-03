import SwiftUI
import PlayerCore
import YTMBridge

/// Lyrics panel — fetches lrclib lyrics for the current track and
/// displays them with the active line highlighted. Auto-scrolls so the
/// active line stays roughly centered as playback progresses.
struct LyricsPanel: View {
    @Environment(PlayerStore.self) private var store
    @Environment(AppBootstrap.self) private var bootstrap
    @Environment(\.dismiss) private var dismiss

    @State private var lyrics: Lyrics = .empty
    @State private var loading = false
    @State private var lastFetchedVideoId: String?

    var body: some View {
        let state = store.state
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(state.track?.title ?? "Lyrics")
                        .font(.title3.weight(.semibold))
                        .lineLimit(1)
                    if let artist = state.track?.artist, !artist.isEmpty {
                        Text(artist)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(.thinMaterial)

            Divider()

            content(positionSecs: state.positionSecs)
        }
        .frame(minWidth: 480, minHeight: 600)
        .task(id: state.track?.videoId) { await loadIfNeeded() }
    }

    @ViewBuilder
    private func content(positionSecs: Double) -> some View {
        if loading && lyrics.lines.isEmpty {
            VStack(spacing: 8) {
                ProgressView()
                Text("Looking up lyrics…")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if lyrics.lines.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "text.quote")
                    .font(.system(size: 36))
                    .foregroundStyle(.secondary)
                Text("No lyrics found")
                    .font(.headline)
                Text("lrclib doesn't have a match for this track. Other lyric sources will be added in a follow-up.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(lyrics.lines) { line in
                            Text(line.text.isEmpty ? " " : line.text)
                                .font(isActive(line, positionSecs: positionSecs)
                                      ? .title3.weight(.semibold)
                                      : .body)
                                .foregroundStyle(isActive(line, positionSecs: positionSecs)
                                                 ? Color.primary
                                                 : Color.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 24)
                                .padding(.vertical, 4)
                                .id(line.id)
                        }
                    }
                    .padding(.vertical, 24)
                }
                .onChange(of: activeLineId(positionSecs: positionSecs)) { _, newId in
                    guard lyrics.synced, let newId else { return }
                    withAnimation(.easeInOut(duration: 0.25)) {
                        proxy.scrollTo(newId, anchor: .center)
                    }
                }
            }
        }
    }

    private func isActive(_ line: LyricLine, positionSecs: Double) -> Bool {
        guard lyrics.synced else { return false }
        return line.id == activeLineId(positionSecs: positionSecs)
    }

    /// Index of the line whose `timeSecs` is the largest value <= the
    /// current position. Returns `nil` for unsynced lyrics or when the
    /// position is before the first line.
    private func activeLineId(positionSecs: Double) -> Int? {
        guard lyrics.synced else { return nil }
        var current: Int?
        for line in lyrics.lines {
            if line.timeSecs <= positionSecs {
                current = line.id
            } else {
                break
            }
        }
        return current
    }

    private func loadIfNeeded() async {
        guard let track = store.state.track,
              !track.videoId.isEmpty,
              track.videoId != lastFetchedVideoId
        else { return }
        lastFetchedVideoId = track.videoId
        loading = true
        let result = await bootstrap.getLyrics(for: track)
        if track.videoId == store.state.track?.videoId {
            lyrics = result
        }
        loading = false
    }
}
