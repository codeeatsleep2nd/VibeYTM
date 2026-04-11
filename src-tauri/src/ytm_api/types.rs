use serde::{Deserialize, Serialize};

use crate::state::player::TrackInfo;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub songs: Vec<TrackInfo>,
    pub albums: Vec<AlbumSummary>,
    pub artists: Vec<ArtistSummary>,
    pub playlists: Vec<PlaylistSummary>,
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
#[serde(tag = "kind", content = "data")]
pub enum ShelfContent {
    Albums(Vec<AlbumSummary>),
    Playlists(Vec<PlaylistSummary>),
    Songs(Vec<TrackInfo>),
    Artists(Vec<ArtistSummary>),
}
