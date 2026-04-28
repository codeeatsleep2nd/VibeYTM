import Testing
@testable import YTMBridge

/// Pin the deterministic-hash invariant — see SWIFTUI_CHECKLIST.md
/// "Hash filenames with SHA256, NOT Hasher". Swift's `Hasher` is
/// salted per process and would invalidate the entire on-disk cache
/// across relaunches. A regression that reintroduced `Hasher` (or
/// changed the input encoding) would silently re-download every
/// image on every launch with no compile error and no test failure
/// — until this test, which fails immediately.
@Suite("ImageCache.hash determinism")
struct ImageCacheHashTests {
    @Test("Hash of a known input is the SHA-256 hex of its UTF-8 bytes")
    func knownInputHash() {
        // `echo -n "https://lh3.googleusercontent.com/test" | shasum -a 256`
        // = a8e10d4d8baf7d8b4e54d6e0dba6c0fb44df5a8a18a2dd8d1c7818d62d769d63
        let input = "https://lh3.googleusercontent.com/test"
        let expected = "a8e10d4d8baf7d8b4e54d6e0dba6c0fb44df5a8a18a2dd8d1c7818d62d769d63"
        #expect(ImageCache.hash(input) == expected)
    }

    @Test("Hash output is always 64 lowercase hex characters")
    func outputShape() {
        for input in ["", "a", "abc", "https://example.com/some/very/long/path?with=query"] {
            let h = ImageCache.hash(input)
            #expect(h.count == 64)
            #expect(h.allSatisfy { $0.isHexDigit && (!$0.isLetter || $0.isLowercase) })
        }
    }

    @Test("Same input produces same hash within a single process — but the real invariant is across launches")
    func deterministic() {
        let input = "https://music.youtube.com/api/whatever"
        let a = ImageCache.hash(input)
        let b = ImageCache.hash(input)
        #expect(a == b)
        // The cross-launch invariant is what `knownInputHash` above
        // pins — if SHA-256 ever gets swapped for Hasher, that test
        // breaks even though this within-process equality test still
        // passes (Hasher is salted per process, not per call).
    }

    @Test("Different inputs produce different hashes")
    func collisionResistance() {
        let urls = [
            "https://a.com/1",
            "https://a.com/2",
            "https://b.com/1",
            "https://a.com/1?v=2",
        ]
        let hashes = urls.map { ImageCache.hash($0) }
        #expect(Set(hashes).count == urls.count)
    }
}
