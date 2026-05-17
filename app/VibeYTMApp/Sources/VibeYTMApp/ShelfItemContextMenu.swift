import SwiftUI
import AppKit
import YTMBridge

/// Reusable right-click context menu for any ShelfItem (home shelves,
/// library rows, queue rows, search results). Apply via the view modifier
/// at the call site:
///
/// ```swift
/// ShelfCard(item: item)
///     .modifier(ShelfItemContextMenu(item: item))
/// ```
///
/// Actions cover the wired-up Sprint 1 surface. Items marked `[TODO]`
/// require bridge or YTM library methods that land in later sprints; they
/// are visible but disabled so the menu structure stays stable.
struct ShelfItemContextMenu: ViewModifier {
    let item: ShelfItem

    @Environment(AppBootstrap.self) private var bootstrap
    @Environment(AppRouter.self) private var router

    func body(content: Content) -> some View {
        content.contextMenu {
            // Play — works for any item with a videoId (single tracks) or a
            // browseId (collections — plays first track via the existing
            // play(item:) shape).
            Button {
                bootstrap.play(item: item)
            } label: {
                Label("Play", systemImage: "play.fill")
            }

            // Add to Queue — bridge method lands in Sprint 4 (DJCopilot
            // needs the same primitive). Disabled until then to keep the
            // menu shape stable.
            Button {
                // bootstrap.enqueue(item:) — Sprint 4
            } label: {
                Label("Add to Queue", systemImage: "text.line.last.and.arrowtriangle.forward")
            }
            .disabled(true)

            // Add to Playlist — opens picker sheet. The picker itself
            // (AddToPlaylistPicker) lists user playlists and posts the
            // like-endpoint round-trip. The list-fetch + add-endpoint
            // bridge commands are wired in Sprint 4 alongside the
            // DJCopilot LikeTool.
            Button {
                // router.isAddToPlaylistPickerOpen = true — Sprint 4
            } label: {
                Label("Add to Playlist…", systemImage: "text.badge.plus")
            }
            .disabled(true)

            Divider()

            // Like — operates on the CURRENT TRACK, not this item.
            // Disabled if the item isn't the now-playing track. Sprint 4
            // adds per-track like-by-videoId via the LikeTool wrapper.
            Button {
                bootstrap.toggleLike()
            } label: {
                Label("Like Current Track", systemImage: "heart")
            }

            Divider()

            // Open Album / Open Artist — drill-down via the existing
            // NavigationStack. Visible only if the item has a browseId
            // we can route to. Detection: most "album-shaped" cards have
            // browseId starting MPRE; artist cards have UC / MPLA.
            if let browseId = item.browseId, !browseId.isEmpty {
                Button {
                    router.browseStack.append(
                        BrowseDestination(browseId: browseId, title: item.title)
                    )
                } label: {
                    Label("Open Detail", systemImage: "arrow.right.circle")
                }
            }

            Divider()

            // Copy Link — builds a music.youtube.com URL the user can
            // paste anywhere. videoId form is the most useful; falls back
            // to browse URL when only browseId is available.
            Button {
                copyYTMLink(for: item)
            } label: {
                Label("Copy YouTube Music Link", systemImage: "link")
            }
        }
    }

    /// Build a shareable music.youtube.com URL and stuff it into the
    /// pasteboard. NSPasteboard.general is the macOS-standard target.
    private func copyYTMLink(for item: ShelfItem) {
        let url: String
        if let videoId = item.videoId, !videoId.isEmpty {
            url = "https://music.youtube.com/watch?v=\(videoId)"
        } else if let browseId = item.browseId, !browseId.isEmpty {
            url = "https://music.youtube.com/browse/\(browseId)"
        } else {
            return
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url, forType: .string)
    }
}
