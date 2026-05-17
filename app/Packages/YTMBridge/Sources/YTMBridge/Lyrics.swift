import Foundation
import OSLog

private let lyricsLog = Logger(subsystem: "com.vibeytm.dev", category: "Lyrics")

/// One synced lyric line. `timeSecs` is the offset from track start;
/// `text` is the line as displayed. Empty `text` is allowed (instrumental
/// breaks) and renders as a thin spacer in the panel.
public struct LyricLine: Sendable, Equatable, Identifiable {
    public let id: Int
    public let timeSecs: Double
    public let text: String

    public init(id: Int, timeSecs: Double, text: String) {
        self.id = id
        self.timeSecs = timeSecs
        self.text = text
    }
}

/// Result of a lyrics lookup. `synced` is `true` when we have time-coded
/// lines (the panel highlights the active line); `false` when only the
/// plain text is available (display-only, no scroll-sync).
public struct Lyrics: Sendable, Equatable {
    public let synced: Bool
    public let lines: [LyricLine]
    public let source: String

    public init(synced: Bool, lines: [LyricLine], source: String) {
        self.synced = synced
        self.lines = lines
        self.source = source
    }

    public static let empty = Lyrics(synced: false, lines: [], source: "")
}

public enum LyricsClient {
    /// Fetch lyrics from lrclib.net for the given track. Public API, no
    /// auth — the user's YTM session isn't involved. Best fit when both
    /// `artist` and `title` are present and the track has well-known
    /// metadata (covers a wide chunk of real catalogs).
    ///
    /// `duration` is the track length in seconds; lrclib uses it as a
    /// disambiguator for tracks with shared title/artist (live versions,
    /// remixes). 0 disables the duration filter.
    public static func fetchLrclib(
        artist: String,
        title: String,
        duration: Double = 0
    ) async -> Lyrics {
        let trimmedArtist = artist.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedArtist.isEmpty, !trimmedTitle.isEmpty else { return .empty }

        var components = URLComponents(string: "https://lrclib.net/api/get")!
        var items: [URLQueryItem] = [
            URLQueryItem(name: "artist_name", value: trimmedArtist),
            URLQueryItem(name: "track_name", value: trimmedTitle),
        ]
        if duration > 0 {
            items.append(URLQueryItem(name: "duration", value: String(Int(duration.rounded()))))
        }
        components.queryItems = items
        guard let url = components.url else { return .empty }

        do {
            var request = URLRequest(url: url)
            request.setValue("VibeYTM/2.0 (lrclib lookup)", forHTTPHeaderField: "User-Agent")
            request.timeoutInterval = 8
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                lyricsLog.debug("lrclib non-HTTP response")
                return .empty
            }
            // 404 is the common "no lyrics for this track" outcome —
            // demote to debug. Everything else (rate limit, server
            // error) is at least a warning so we can distinguish a
            // transient backend issue from "track has no lyrics" in
            // Console.app.
            guard http.statusCode == 200 else {
                if http.statusCode == 404 {
                    lyricsLog.debug("lrclib 404 — no lyrics for track")
                } else {
                    lyricsLog.warning("lrclib HTTP \(http.statusCode, privacy: .public)")
                }
                return .empty
            }
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                lyricsLog.warning("lrclib response was not JSON")
                return .empty
            }
            if let synced = json["syncedLyrics"] as? String, !synced.isEmpty {
                let lines = parseLRC(synced)
                if !lines.isEmpty {
                    return Lyrics(synced: true, lines: lines, source: "lrclib")
                }
            }
            if let plain = json["plainLyrics"] as? String, !plain.isEmpty {
                let lines = plain
                    .split(separator: "\n", omittingEmptySubsequences: false)
                    .enumerated()
                    .map { (i, str) in
                        LyricLine(id: i, timeSecs: 0, text: String(str))
                    }
                return Lyrics(synced: false, lines: lines, source: "lrclib (plain)")
            }
            return .empty
        } catch {
            lyricsLog.warning("lrclib fetch error: \((error as NSError).localizedDescription, privacy: .public)")
            return .empty
        }
    }

    /// Parse an LRC payload into time-coded lines. Tolerates multiple
    /// timestamps per line (`[00:01.00][00:05.00]Text` becomes two
    /// entries) and drops `[tag:value]` metadata headers without
    /// timestamps. Empty-text time markers (instrumental breaks) are
    /// preserved so the panel highlight tracks them correctly.
    public static func parseLRC(_ raw: String) -> [LyricLine] {
        let timeRegex = try? NSRegularExpression(
            pattern: #"\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]"#
        )
        guard let timeRegex else { return [] }

        var collected: [(Double, String)] = []
        for line in raw.split(separator: "\n", omittingEmptySubsequences: false) {
            let str = String(line)
            let nsstr = str as NSString
            let matches = timeRegex.matches(in: str, range: NSRange(location: 0, length: nsstr.length))
            guard !matches.isEmpty else { continue }
            // Text is everything after the last timestamp.
            let last = matches.last!
            let textStart = last.range.location + last.range.length
            let text: String
            if textStart < nsstr.length {
                text = nsstr.substring(from: textStart).trimmingCharacters(in: .whitespaces)
            } else {
                text = ""
            }
            for match in matches {
                let mins = Int(nsstr.substring(with: match.range(at: 1))) ?? 0
                let secs = Int(nsstr.substring(with: match.range(at: 2))) ?? 0
                let frac: Double
                if match.range(at: 3).location != NSNotFound {
                    let fracStr = nsstr.substring(with: match.range(at: 3))
                    let scale = pow(10.0, Double(fracStr.count))
                    frac = (Double(fracStr) ?? 0) / scale
                } else {
                    frac = 0
                }
                let t = Double(mins) * 60 + Double(secs) + frac
                collected.append((t, text))
            }
        }
        collected.sort { $0.0 < $1.0 }
        return collected.enumerated().map { (i, pair) in
            LyricLine(id: i, timeSecs: pair.0, text: pair.1)
        }
    }
}
