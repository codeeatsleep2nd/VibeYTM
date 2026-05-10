use serde::{Deserialize, Serialize};

use crate::state::player::TrackInfo;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub songs: Vec<TrackInfo>,
    pub albums: Vec<AlbumSummary>,
    pub artists: Vec<ArtistSummary>,
    pub playlists: Vec<PlaylistSummary>,
    /// Podcast / show shelves from the search response. Populated only when
    /// the caller passes the podcasts filter param; absent in the unified
    /// (no-filter) search view since the user picks the surface explicitly.
    #[serde(default)]
    pub podcasts: Vec<PodcastSummary>,
    /// First real album surfaced from an unfiltered search response. Used by
    /// the unified search view to render the "Top result" album hero. None
    /// when no album was found or when the search was filtered.
    #[serde(default)]
    pub top_album: Option<AlbumSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumSummary {
    pub browse_id: String,
    pub title: String,
    pub artist: String,
    pub artwork_url: String,
    pub year: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistSummary {
    pub channel_id: String,
    pub name: String,
    pub avatar_url: String,
    pub subscriber_count: Option<String>,
}

/// Artist channel detail returned from `browse?browseId=UC...`. Issue
/// #79 — currently only carries the bio/description text so the
/// ArtistPage can render an introduction below the title plate. Future
/// expansions (top tracks, albums via the channel itself) can extend
/// this struct without forcing the FE consumer to refetch.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ArtistDetail {
    pub channel_id: String,
    pub name: String,
    /// Plain-text bio extracted from the YTM artist channel response.
    /// Empty when YTM did not expose a description (common for smaller
    /// artists / channels that haven't authored an "About" blurb).
    pub description: String,
    /// Optional banner / hero artwork lifted from the channel header.
    /// Falls back to empty when YTM doesn't surface one.
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSummary {
    pub playlist_id: String,
    pub title: String,
    pub artwork_url: String,
    pub track_count: Option<u32>,
}

/// One row in the user's "Subscribed podcasts" library section.
/// `browse_id` is an MPSP* identifier the existing get_playlist IPC
/// already routes correctly (the shows-support change taught it to
/// keep MPSP raw, no VL prefix). Author lands as the secondary text
/// the user sees under the show title in the card.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodcastSummary {
    pub browse_id: String,
    pub title: String,
    pub author: String,
    pub artwork_url: String,
}

/// Result of `get_podcast_last_episode` — the most recent episode's
/// publish-age text + a numeric seconds-since-now used purely for
/// client-side sorting. Returned as a thin envelope so the frontend
/// can fetch a flock of these in parallel without parsing each show's
/// full episode list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PodcastLastEpisode {
    pub display: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secs_ago: Option<i64>,
}

/// One date-grouped section of the FEmusic_history response. YTM groups
/// recently-played tracks under headers like "Today", "Yesterday",
/// "Last week", or specific calendar dates. Preserving the section
/// label lets the FE bucket entries into Today / Yesterday / This week
/// / Earlier without inventing its own date-grouping logic.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySection {
    pub label: String,
    pub tracks: Vec<TrackInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shelf {
    pub title: String,
    pub items: ShelfContent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDetail {
    pub playlist_id: String,
    pub title: String,
    pub description: Option<String>,
    pub artwork_url: String,
    pub track_count: Option<u32>,
    pub tracks: Vec<TrackInfo>,
    /// Whether this playlist/album is already saved in the user's library.
    /// Extracted from the header's toggle-button state when available so the
    /// Save/Remove label can render correctly on first paint (issue #55).
    #[serde(default)]
    pub is_in_library: bool,
    /// The `audioPlaylistId` (typically an OLAK* ID) that library operations
    /// should target. For user playlists this matches `playlist_id`; for
    /// albums (MPRE browseId) this is the underlying playable playlist used
    /// by YTM's save endpoint (issue #54).
    #[serde(default)]
    pub audio_playlist_id: Option<String>,
    /// Whether this detail represents an album (MPRE browseId), so the UI
    /// can pick the correct "saved to Albums / Playlists" label (issue #55).
    #[serde(default)]
    pub is_album: bool,
    /// Release year — extracted from the responsive-header subtitle runs
    /// (e.g., `Album • Artist • 2023`). Only the trailing 4-digit token is
    /// kept; absent for entries where YTM didn't include a year (most
    /// playlists, charts, mood mixes).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<String>,
    /// Artist / creator from the responsive-header subtitle. For albums
    /// this is the credited artist (frequently absent from per-track
    /// rows since the album header already carries it). Skipped for
    /// shows / podcasts and for playlists where the subtitle has no
    /// artist run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum ShelfContent {
    Albums(Vec<AlbumSummary>),
    Playlists(Vec<PlaylistSummary>),
    Songs(Vec<TrackInfo>),
    Artists(Vec<ArtistSummary>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    /// Lyrics text with line breaks preserved. Empty when YTM returned a
    /// lyrics tab but no content (e.g. "Lyrics not available" placeholder).
    pub text: String,
    /// Attribution line YTM renders below the lyrics ("Source: ...").
    #[serde(default)]
    pub source: Option<String>,
    /// Per-line timing when YTM ships synced lyrics for the track. `None`
    /// when only plain text was returned — the UI then falls back to a
    /// static, non-highlighting view.
    #[serde(default)]
    pub lines: Option<Vec<LyricLine>>,
    /// Artist the SOURCE believed these lyrics belonged to. Stored so a
    /// later read can sanity-check the cached entry against the playing
    /// track's artist — when a match function (e.g. NetEase's title-only
    /// substring search) returned a wrong song's lyrics, the saved
    /// `matched_artist` will diverge from the request's artist and the
    /// cache layer can invalidate + re-fetch instead of serving the lie.
    #[serde(default)]
    pub matched_artist: Option<String>,
    /// Title the SOURCE believed these lyrics belonged to. Companion to
    /// `matched_artist` — both fields together enable the cache-read
    /// sanity check.
    #[serde(default)]
    pub matched_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    pub start_ms: u64,
    #[serde(default)]
    pub end_ms: Option<u64>,
    pub text: String,
}

/// Privacy setting for a YTM playlist. Serializes to the EXACT strings YTM's
/// `playlist/create` endpoint expects (`PRIVATE`, `UNLISTED`, `PUBLIC`) —
/// any other casing is rejected. The frontend mirrors this as a string-
/// literal union in `src/lib/types.ts`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum PlaylistPrivacy {
    Private,
    Unlisted,
    Public,
}
