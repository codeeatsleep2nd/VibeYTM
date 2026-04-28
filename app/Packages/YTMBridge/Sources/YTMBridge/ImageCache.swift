import Foundation
import AppKit
import CryptoKit
import SwiftUI

/// On-disk artwork image cache. YTM artwork URLs change rarely and are
/// re-requested every time a card scrolls back into view; SwiftUI's stock
/// `AsyncImage` does no caching beyond the URLSession HTTP cache, which
/// `URLSession.shared` keeps under a tight in-memory budget. Result: any
/// scroll past ~30 cards re-downloads everything once it's offscreen.
///
/// This cache is keyed by URL (SHA-256 → hex), stores the bytes in
/// `~/Library/Caches/VibeYTM/artwork/`, and gates the working set with a
/// 1 GB byte budget plus a 7-day TTL. Reads are best-effort: if the disk
/// cache is corrupt or absent, we fall through to the network and
/// repopulate.
///
/// The actor isolation is for the in-flight dedup table — multiple cards
/// asking for the same URL at once share one network task. The disk
/// reads/writes themselves go through `Data(contentsOf:)` /
/// `data.write(to:)` which are safe across queues.
public actor ImageCache {
    public static let shared = ImageCache()

    private let directory: URL
    private let byteCeiling: Int64 = 1_024 * 1_024 * 1_024
    private let baseTTL: TimeInterval = 7 * 24 * 60 * 60
    private let ttlJitter: TimeInterval = 24 * 60 * 60
    private var inflight: [URL: Task<Data?, Never>] = [:]

    private init() {
        let caches = FileManager.default.urls(
            for: .cachesDirectory, in: .userDomainMask
        ).first ?? URL(fileURLWithPath: NSTemporaryDirectory())
        self.directory = caches
            .appending(path: "VibeYTM", directoryHint: .isDirectory)
            .appending(path: "artwork", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(
            at: directory, withIntermediateDirectories: true
        )
    }

    /// Returns the image bytes for `url`, fetching them if missing or
    /// stale. `nil` is returned for any error — callers should fall back
    /// to a placeholder, not retry.
    public func data(for url: URL) async -> Data? {
        if let task = inflight[url] {
            return await task.value
        }
        let task = Task<Data?, Never> { [self] in
            await self.fetchOrLoad(url)
        }
        inflight[url] = task
        let result = await task.value
        inflight[url] = nil
        return result
    }

    private func fetchOrLoad(_ url: URL) async -> Data? {
        let path = pathFor(url)
        if let cached = readIfFresh(path: path) {
            return cached
        }
        guard let data = await fetch(url) else {
            // Network failed — fall back to whatever is on disk, even if
            // stale. Better to show a yesterday cover than a placeholder.
            return try? Data(contentsOf: path)
        }
        try? data.write(to: path, options: .atomic)
        Task.detached(priority: .background) { [byteCeiling, directory] in
            ImageCache.trim(directory: directory, ceiling: byteCeiling)
        }
        return data
    }

    private func readIfFresh(path: URL) -> Data? {
        let attrs = try? FileManager.default.attributesOfItem(atPath: path.path)
        guard let modified = attrs?[.modificationDate] as? Date else { return nil }
        let jitter = TimeInterval.random(in: 0 ... ttlJitter)
        let ageLimit = baseTTL + jitter
        guard Date().timeIntervalSince(modified) < ageLimit else { return nil }
        return try? Data(contentsOf: path)
    }

    private func fetch(_ url: URL) async -> Data? {
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode)
        else { return nil }
        return data
    }

    private func pathFor(_ url: URL) -> URL {
        directory.appending(path: ImageCache.hash(url.absoluteString))
    }

    /// Deterministic hex digest. Swift's `Hasher` is salted per process and
    /// would re-key every launch, invalidating the entire on-disk cache —
    /// SHA-256 keeps filenames stable so images survive relaunch.
    /// `internal static` so the regression test in `YTMBridgeTests` can
    /// pin a known input → expected hex output and catch any future
    /// refactor that swaps to `Hasher` or changes input encoding.
    static func hash(_ s: String) -> String {
        let digest = SHA256.hash(data: Data(s.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// Trim oldest files when total bytes exceed the ceiling. The
    /// caller dispatches this onto a `Task.detached` background queue
    /// so it never blocks the actor; the only correctness assumption
    /// is that the directory's writers also use atomic writes (we
    /// do — see `data(for:)` above), which means a concurrent reader
    /// either sees the old content or the new — never a partial file.
    private static func trim(directory: URL, ceiling: Int64) {
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else { return }

        var entries: [(url: URL, size: Int64, modified: Date)] = []
        var total: Int64 = 0
        for item in items {
            let values = try? item.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
            let size = Int64(values?.fileSize ?? 0)
            let modified = values?.contentModificationDate ?? .distantPast
            entries.append((item, size, modified))
            total += size
        }

        guard total > ceiling else { return }
        entries.sort { $0.modified < $1.modified }
        for entry in entries {
            if total <= ceiling { break }
            try? fm.removeItem(at: entry.url)
            total -= entry.size
        }
    }
}

/// Drop-in replacement for `AsyncImage` that uses `ImageCache.shared`.
/// Renders a placeholder while loading; on failure renders the
/// placeholder permanently. Aspect ratio defaults to `.fill` because
/// every artwork surface in the app crops, never letterboxes.
public struct CachedAsyncImage<Placeholder: View>: View {
    private let url: URL?
    private let contentMode: ContentMode
    private let placeholder: () -> Placeholder

    public init(
        url: URL?,
        contentMode: ContentMode = .fill,
        @ViewBuilder placeholder: @escaping () -> Placeholder
    ) {
        self.url = url
        self.contentMode = contentMode
        self.placeholder = placeholder
    }

    @State private var image: NSImage?
    @State private var loading = false

    public var body: some View {
        Group {
            if let image {
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
            } else {
                placeholder()
            }
        }
        .task(id: url) { await load() }
    }

    private func load() async {
        guard let url else {
            image = nil
            return
        }
        loading = true
        defer { loading = false }
        guard let data = await ImageCache.shared.data(for: url) else {
            image = nil
            return
        }
        image = NSImage(data: data)
    }
}
