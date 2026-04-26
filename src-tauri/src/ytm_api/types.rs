use serde::{Deserialize, Serialize};

use crate::state::player::TrackInfo;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub songs: Vec<TrackInfo>,
    pub albums: Vec<AlbumSummary>,
    pub artists: Vec<ArtistSummary>,
    pub playlists: Vec<PlaylistSummary>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistSummary {
    pub playlist_id: String,
    pub title: String,
    pub artwork_url: String,
    pub track_count: Option<u32>,
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
