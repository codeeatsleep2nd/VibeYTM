import Foundation

/// Minimal Innertube response parser. Extracts the shelves YTM's home and
/// explore endpoints return — title + a few cards each. Just enough to
/// render meaningful UI without re-implementing the full Rust
/// `parse_home_shelves` logic. Bigger fidelity (continuations, navigation
/// endpoints, like-state, etc.) lands as we need each surface.
///
/// JSON shape is loose and version-fragile by design; YTM ships small
/// schema changes regularly. Every accessor goes through optional keypaths
/// — failures degrade silently to "no shelves" rather than throwing, so a
/// single field rename can't blank the whole home page.

public struct Shelf: Sendable, Equatable, Identifiable {
    public let id: String
    public let title: String
    public let items: [ShelfItem]

    public init(id: String, title: String, items: [ShelfItem]) {
        self.id = id
        self.title = title
        self.items = items
    }
}

public struct ShelfItem: Sendable, Equatable, Identifiable {
    public let id: String
    public let title: String
    public let subtitle: String
    public let artworkUrl: String?
    public let videoId: String?
    public let playlistId: String?
    public let browseId: String?

    public init(
        id: String,
        title: String,
        subtitle: String,
        artworkUrl: String?,
        videoId: String?,
        playlistId: String?,
        browseId: String?
    ) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.artworkUrl = artworkUrl
        self.videoId = videoId
        self.playlistId = playlistId
        self.browseId = browseId
    }
}

public enum Innertube {
    /// Parse a home/explore browse response into shelves. Returns an
    /// empty array if the response shape doesn't match — see the caller
    /// for "show empty state" behavior.
    /// Parse a search response — the shape differs from browse: results
    /// land under `contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.
    /// content.sectionListRenderer.contents[]`. Once the section list is
    /// found, the per-section shelf parsing is identical to the browse
    /// path so we share the inner walker.
    public static func parseSearchResults(from data: Data) -> [Shelf] {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return []
        }
        let topContents = root["contents"] as? [String: Any]
        let tabbed = topContents?["tabbedSearchResultsRenderer"] as? [String: Any]
        let tabs = tabbed?["tabs"] as? [[String: Any]]
        let tabRenderer = tabs?.first?["tabRenderer"] as? [String: Any]
        let tabContent = tabRenderer?["content"] as? [String: Any]
        let sections = tabContent?["sectionListRenderer"] as? [String: Any]
        let contents = sections?["contents"] as? [[String: Any]] ?? []

        var shelves: [Shelf] = []
        for (i, section) in contents.enumerated() {
            if let shelf = parseSection(section, index: i) {
                shelves.append(shelf)
            }
        }
        return shelves
    }

    public static func parseShelves(from data: Data) -> [Shelf] {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return []
        }
        let topContents = root["contents"] as? [String: Any]

        // Collect every `sectionListRenderer.contents[]` array we can find
        // anywhere in the response. YTM's browse endpoint serves three
        // distinct top-level shapes depending on the browseId category:
        //
        //   1. Home / Explore / library tabs:
        //      contents.singleColumnBrowseResultsRenderer.tabs[N].tabRenderer
        //       .content.sectionListRenderer.contents[]
        //   2. Albums (MPRE...) / Artists / "two column" pages:
        //      contents.twoColumnBrowseResultsRenderer.{secondaryContents
        //       OR tabs[N].tabRenderer.content}.sectionListRenderer.contents[]
        //   3. Playlists (VL...): same paths, but the section list often
        //      contains a single `musicPlaylistShelfRenderer` rather than
        //      a `musicShelfRenderer` — we add a parser for it below.
        //
        // Falling back to a deep walker keeps the parser resilient when YTM
        // ships small schema changes that move the section list under a
        // different wrapper.
        var sections: [[String: Any]] = []

        if let single = topContents?["singleColumnBrowseResultsRenderer"] as? [String: Any] {
            sections.append(contentsOf: collectSections(under: single))
        }
        if let two = topContents?["twoColumnBrowseResultsRenderer"] as? [String: Any] {
            sections.append(contentsOf: collectSections(under: two))
        }
        // Header may carry a top-tracks shelf for an artist page.
        if let header = root["header"] as? [String: Any] {
            sections.append(contentsOf: collectSections(under: header))
        }

        // Final fallback: deep-walk the entire tree to find any section list
        // we missed. Cheap because the parser short-circuits on the first
        // matching shape per section.
        if sections.isEmpty {
            sections = deepFindSectionLists(root)
        }

        var shelves: [Shelf] = []
        for (i, section) in sections.enumerated() {
            if let shelf = parseSection(section, index: i) {
                shelves.append(shelf)
            }
        }
        return shelves
    }

    /// Walk one or two layers under a top-level renderer to extract any
    /// `sectionListRenderer.contents[]` arrays. Handles both `tabs[N]
    /// .tabRenderer.content.sectionListRenderer` and `secondaryContents
    /// .sectionListRenderer` paths.
    private static func collectSections(under root: [String: Any]) -> [[String: Any]] {
        var out: [[String: Any]] = []
        if let tabs = root["tabs"] as? [[String: Any]] {
            for tab in tabs {
                let tabRenderer = tab["tabRenderer"] as? [String: Any]
                let tabContent = tabRenderer?["content"] as? [String: Any]
                if let list = tabContent?["sectionListRenderer"] as? [String: Any],
                   let contents = list["contents"] as? [[String: Any]] {
                    out.append(contentsOf: contents)
                }
            }
        }
        if let secondary = root["secondaryContents"] as? [String: Any],
           let list = secondary["sectionListRenderer"] as? [String: Any],
           let contents = list["contents"] as? [[String: Any]] {
            out.append(contentsOf: contents)
        }
        return out
    }

    /// Last-resort deep walker — descend the JSON tree, collecting every
    /// `sectionListRenderer.contents[]` array we encounter. Used when the
    /// shape is something the structured parsers above didn't anticipate.
    private static func deepFindSectionLists(_ node: Any) -> [[String: Any]] {
        var out: [[String: Any]] = []
        if let dict = node as? [String: Any] {
            if let list = dict["sectionListRenderer"] as? [String: Any],
               let contents = list["contents"] as? [[String: Any]] {
                out.append(contentsOf: contents)
            }
            for (_, v) in dict {
                out.append(contentsOf: deepFindSectionLists(v))
            }
        } else if let arr = node as? [Any] {
            for v in arr {
                out.append(contentsOf: deepFindSectionLists(v))
            }
        }
        return out
    }

    // MARK: - Private

    private static func parseSection(_ section: [String: Any], index: Int) -> Shelf? {
        if let carousel = section["musicCarouselShelfRenderer"] as? [String: Any] {
            return parseCarousel(carousel, fallbackId: "carousel-\(index)")
        }
        if let shelf = section["musicShelfRenderer"] as? [String: Any] {
            return parseMusicShelf(shelf, fallbackId: "shelf-\(index)")
        }
        if let playlistShelf = section["musicPlaylistShelfRenderer"] as? [String: Any] {
            return parsePlaylistShelf(playlistShelf, fallbackId: "playlist-\(index)")
        }
        return nil
    }

    /// Album / playlist track listing. Same item shape as `musicShelfRenderer`
    /// (responsive list items) but the renderer wraps the list with playlist-
    /// specific metadata (playlistId, trackCount, etc.) we don't surface yet.
    /// Title is usually absent, so we synthesize one. Returns nil if no
    /// playable items survive parsing.
    private static func parsePlaylistShelf(_ shelf: [String: Any], fallbackId: String) -> Shelf? {
        let rawContents = shelf["contents"] as? [[String: Any]] ?? []
        let items = rawContents.compactMap { parseMusicShelfItem($0) }
        guard !items.isEmpty else { return nil }
        // Use a generic title — the BrowseDetailView header already shows
        // the album/playlist title. A blank title prevents `parseMusicShelf`
        // from returning the shelf, but here we want it.
        return Shelf(id: fallbackId, title: "Tracks", items: items)
    }

    private static func parseCarousel(_ carousel: [String: Any], fallbackId: String) -> Shelf? {
        let header = carousel["header"] as? [String: Any]
        let basic = header?["musicCarouselShelfBasicHeaderRenderer"] as? [String: Any]
        let titleObj = basic?["title"] as? [String: Any]
        let runs = titleObj?["runs"] as? [[String: Any]] ?? []
        let title = runs.first?["text"] as? String ?? ""
        guard !title.isEmpty else { return nil }

        let rawContents = carousel["contents"] as? [[String: Any]] ?? []
        let items = rawContents.compactMap(parseCarouselItem)

        return Shelf(id: fallbackId, title: title, items: items)
    }

    private static func parseMusicShelf(_ shelf: [String: Any], fallbackId: String) -> Shelf? {
        let titleObj = shelf["title"] as? [String: Any]
        let runs = titleObj?["runs"] as? [[String: Any]] ?? []
        let title = runs.first?["text"] as? String ?? ""

        let rawContents = shelf["contents"] as? [[String: Any]] ?? []
        let items = rawContents.compactMap { parseMusicShelfItem($0) }
        // Album / playlist track listings come back as a `musicShelfRenderer`
        // with NO title field — the page header renders the title, the
        // shelf itself just holds rows. Synthesize "Tracks" so we don't
        // drop the entire content list. Untitled shelves with no items
        // are still skipped.
        guard !items.isEmpty else { return nil }
        let displayTitle = title.isEmpty ? "Tracks" : title
        return Shelf(id: fallbackId, title: displayTitle, items: items)
    }

    private static func parseCarouselItem(_ item: [String: Any]) -> ShelfItem? {
        // Two common renderers: musicTwoRowItemRenderer (album/playlist
        // cards), musicResponsiveListItemRenderer (song rows).
        if let two = item["musicTwoRowItemRenderer"] as? [String: Any] {
            return parseTwoRowItem(two)
        }
        if let resp = item["musicResponsiveListItemRenderer"] as? [String: Any] {
            return parseResponsiveListItem(resp)
        }
        return nil
    }

    private static func parseMusicShelfItem(_ item: [String: Any]) -> ShelfItem? {
        if let resp = item["musicResponsiveListItemRenderer"] as? [String: Any] {
            return parseResponsiveListItem(resp)
        }
        return nil
    }

    private static func parseTwoRowItem(_ item: [String: Any]) -> ShelfItem? {
        let titleObj = item["title"] as? [String: Any]
        let titleRuns = titleObj?["runs"] as? [[String: Any]] ?? []
        let title = titleRuns.first?["text"] as? String ?? ""
        guard !title.isEmpty else { return nil }

        let subObj = item["subtitle"] as? [String: Any]
        let subRuns = subObj?["runs"] as? [[String: Any]] ?? []
        let subtitle = textFromRuns(subRuns)

        let thumbWrapper = item["thumbnailRenderer"] as? [String: Any]
        let renderer = thumbWrapper?["musicThumbnailRenderer"] as? [String: Any]
        let artwork = firstThumbnail(in: renderer?["thumbnail"] as? [String: Any])

        let nav = item["navigationEndpoint"] as? [String: Any]
        let parsedNav = parseNavigation(nav)
        let id = parsedNav.video ?? parsedNav.playlist ?? parsedNav.browse ?? UUID().uuidString

        return ShelfItem(
            id: id,
            title: title,
            subtitle: subtitle,
            artworkUrl: artwork,
            videoId: parsedNav.video,
            playlistId: parsedNav.playlist,
            browseId: parsedNav.browse
        )
    }

    private static func parseResponsiveListItem(_ item: [String: Any]) -> ShelfItem? {
        guard let flex = item["flexColumns"] as? [[String: Any]],
              let firstColumn = flex.first,
              let firstFlex = firstColumn["musicResponsiveListItemFlexColumnRenderer"] as? [String: Any]
        else { return nil }

        let firstText = firstFlex["text"] as? [String: Any]
        let titleRuns = firstText?["runs"] as? [[String: Any]] ?? []
        let title = titleRuns.first?["text"] as? String ?? ""
        guard !title.isEmpty else { return nil }

        var subtitle = ""
        if flex.count > 1 {
            let secondColumn = flex[1]
            if let secondFlex = secondColumn["musicResponsiveListItemFlexColumnRenderer"] as? [String: Any],
               let secondText = secondFlex["text"] as? [String: Any],
               let runs = secondText["runs"] as? [[String: Any]]
            {
                subtitle = textFromRuns(runs)
            }
        }

        let thumbWrapper = item["thumbnail"] as? [String: Any]
        let renderer = thumbWrapper?["musicThumbnailRenderer"] as? [String: Any]
        let artwork = firstThumbnail(in: renderer?["thumbnail"] as? [String: Any])

        let nav = (titleRuns.first?["navigationEndpoint"] as? [String: Any])
            ?? (item["navigationEndpoint"] as? [String: Any])
        let parsedNav = parseNavigation(nav)
        let id = parsedNav.video ?? parsedNav.playlist ?? parsedNav.browse ?? UUID().uuidString

        return ShelfItem(
            id: id,
            title: title,
            subtitle: subtitle,
            artworkUrl: artwork,
            videoId: parsedNav.video,
            playlistId: parsedNav.playlist,
            browseId: parsedNav.browse
        )
    }

    private static func textFromRuns(_ runs: [[String: Any]]) -> String {
        runs.compactMap { $0["text"] as? String }.joined()
    }

    private static func firstThumbnail(in thumbnail: [String: Any]?) -> String? {
        let thumbs = thumbnail?["thumbnails"] as? [[String: Any]] ?? []
        // Pick the largest-resolution thumbnail (last in the array).
        guard let last = thumbs.last,
              let url = last["url"] as? String
        else { return nil }
        return url
    }

    private static func parseNavigation(_ endpoint: [String: Any]?) -> (video: String?, playlist: String?, browse: String?) {
        let watch = (endpoint?["watchEndpoint"] as? [String: Any])
        let video = watch?["videoId"] as? String
        let playlist = (watch?["playlistId"] as? String)
            ?? ((endpoint?["watchPlaylistEndpoint"] as? [String: Any])?["playlistId"] as? String)
        let browse = (endpoint?["browseEndpoint"] as? [String: Any])?["browseId"] as? String
        return (video, playlist, browse)
    }
}
