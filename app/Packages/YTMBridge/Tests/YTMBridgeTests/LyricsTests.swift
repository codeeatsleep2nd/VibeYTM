import Testing
@testable import YTMBridge

/// Tests for the pure-function paths in `Lyrics.swift`. The network
/// path (`fetchLrclib`) is excluded — it requires a live HTTP round
/// trip and is covered by manual verification.
@Suite("LyricsClient.parseLRC")
struct LyricsParseLRCTests {
    @Test("Single timestamp line parses to one entry with the right time")
    func singleTimestamp() {
        let lines = LyricsClient.parseLRC("[00:30.50]Hello world")
        #expect(lines.count == 1)
        #expect(lines[0].timeSecs == 30.5)
        #expect(lines[0].text == "Hello world")
    }

    @Test("Multiple timestamps on one line expand to multiple entries with shared text")
    func multipleTimestamps() {
        let lines = LyricsClient.parseLRC("[00:01.00][00:05.00]Repeat me")
        #expect(lines.count == 2)
        #expect(lines.map(\.text) == ["Repeat me", "Repeat me"])
        // Output is sorted by time.
        #expect(lines.map(\.timeSecs) == [1.0, 5.0])
    }

    @Test("Three-digit fractional seconds parse with millisecond precision")
    func threeDigitFraction() {
        let lines = LyricsClient.parseLRC("[01:23.456]With ms")
        #expect(lines.count == 1)
        // 1*60 + 23 + 0.456 = 83.456
        #expect(abs(lines[0].timeSecs - 83.456) < 0.0001)
    }

    @Test("Colon-separator fractional seconds parse the same as dot-separator")
    func colonFraction() {
        let dot = LyricsClient.parseLRC("[01:23.45]")
        let colon = LyricsClient.parseLRC("[01:23:45]")
        // 1*60 + 23 + 0.45
        #expect(abs(dot[0].timeSecs - 83.45) < 0.0001)
        #expect(abs(colon[0].timeSecs - 83.45) < 0.0001)
    }

    @Test("Empty-text instrumental marker is preserved (not dropped)")
    func instrumentalMarker() {
        // Bracket plus nothing after — the panel uses these to highlight
        // the active line during instrumental breaks.
        let lines = LyricsClient.parseLRC("[02:00.00]")
        #expect(lines.count == 1)
        #expect(lines[0].text == "")
        #expect(lines[0].timeSecs == 120.0)
    }

    @Test("Metadata header lines without timestamps are dropped")
    func metadataHeader() {
        let raw = "[ar:Some Artist]\n[ti:Some Title]\n[00:10.00]Real lyric"
        let lines = LyricsClient.parseLRC(raw)
        #expect(lines.count == 1)
        #expect(lines[0].text == "Real lyric")
        #expect(lines[0].timeSecs == 10.0)
    }

    @Test("Lines arriving out of order get sorted by time in the output")
    func sortByTime() {
        let raw = "[00:30.00]Third\n[00:10.00]First\n[00:20.00]Second"
        let lines = LyricsClient.parseLRC(raw)
        #expect(lines.map(\.text) == ["First", "Second", "Third"])
        #expect(lines.map(\.timeSecs) == [10.0, 20.0, 30.0])
    }

    @Test("Empty input produces empty output without crashing")
    func emptyInput() {
        #expect(LyricsClient.parseLRC("").isEmpty)
        #expect(LyricsClient.parseLRC("\n\n\n").isEmpty)
    }

    @Test("Stable line IDs are unique within the parsed batch")
    func uniqueIDs() {
        let lines = LyricsClient.parseLRC("[00:01.00]A\n[00:02.00]B\n[00:03.00]C")
        let ids = Set(lines.map(\.id))
        #expect(ids.count == lines.count)
    }
}
