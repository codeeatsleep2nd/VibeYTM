pub mod types;

use reqwest::Client;
use std::collections::HashMap;

use crate::state::player::TrackInfo;
use self::types::*;

pub struct YtmApi {
    client: Client,
    headers: HashMap<String, String>,
}

impl YtmApi {
    pub fn new() -> Self {
        Self {
            client: Client::new(),
            headers: HashMap::new(),
        }
    }

    /// Search for songs, albums, artists, and playlists.
    /// Returns mock data for now; real API integration comes later.
    pub async fn search(&self, _query: &str) -> anyhow::Result<SearchResults> {
        Ok(SearchResults {
            songs: vec![
                create_mock_track(
                    "dQw4w9WgXcQ",
                    "Never Gonna Give You Up",
                    "Rick Astley",
                    "Whenever You Need Somebody",
                ),
                create_mock_track("kJQP7kiw5Fk", "Despacito", "Luis Fonsi", "Vida"),
                create_mock_track("JGwWNGJdvx8", "Shape of You", "Ed Sheeran", "\u{f7}"),
            ],
            albums: vec![AlbumSummary {
                browse_id: "MPREb_abc".into(),
                title: "Whenever You Need Somebody".into(),
                artist: "Rick Astley".into(),
                artwork_url: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg".into(),
                year: Some("1987".into()),
            }],
            artists: vec![ArtistSummary {
                channel_id: "UC_abc".into(),
                name: "Rick Astley".into(),
                avatar_url: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg".into(),
                subscriber_count: Some("5.2M".into()),
            }],
            playlists: vec![],
        })
    }

    /// Fetch home page shelves with recommended content.
    /// Returns mock data for now; real API integration comes later.
    pub async fn get_home(&self) -> anyhow::Result<Vec<Shelf>> {
        Ok(vec![
            Shelf {
                title: "Quick picks".into(),
                items: ShelfContent::Songs(vec![
                    create_mock_track(
                        "dQw4w9WgXcQ",
                        "Never Gonna Give You Up",
                        "Rick Astley",
                        "Whenever You Need Somebody",
                    ),
                    create_mock_track("kJQP7kiw5Fk", "Despacito", "Luis Fonsi", "Vida"),
                    create_mock_track("JGwWNGJdvx8", "Shape of You", "Ed Sheeran", "\u{f7}"),
                    create_mock_track(
                        "9bZkp7q19f0",
                        "Gangnam Style",
                        "PSY",
                        "PSY 6\u{ac11} Part 1",
                    ),
                ]),
            },
            Shelf {
                title: "Recommended albums".into(),
                items: ShelfContent::Albums(vec![
                    AlbumSummary {
                        browse_id: "MPREb_1".into(),
                        title: "Whenever You Need Somebody".into(),
                        artist: "Rick Astley".into(),
                        artwork_url: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg".into(),
                        year: Some("1987".into()),
                    },
                    AlbumSummary {
                        browse_id: "MPREb_2".into(),
                        title: "\u{f7} (Divide)".into(),
                        artist: "Ed Sheeran".into(),
                        artwork_url: "https://img.youtube.com/vi/JGwWNGJdvx8/hqdefault.jpg".into(),
                        year: Some("2017".into()),
                    },
                    AlbumSummary {
                        browse_id: "MPREb_3".into(),
                        title: "Vida".into(),
                        artist: "Luis Fonsi".into(),
                        artwork_url: "https://img.youtube.com/vi/kJQP7kiw5Fk/hqdefault.jpg".into(),
                        year: Some("2019".into()),
                    },
                    AlbumSummary {
                        browse_id: "MPREb_4".into(),
                        title: "Future Nostalgia".into(),
                        artist: "Dua Lipa".into(),
                        artwork_url: "https://img.youtube.com/vi/OPf0YbXqDm0/hqdefault.jpg".into(),
                        year: Some("2020".into()),
                    },
                ]),
            },
            Shelf {
                title: "Recently played".into(),
                items: ShelfContent::Songs(vec![
                    create_mock_track(
                        "fJ9rUzIMcZQ",
                        "Bohemian Rhapsody",
                        "Queen",
                        "A Night at the Opera",
                    ),
                    create_mock_track(
                        "hTWKbfoikeg",
                        "Smells Like Teen Spirit",
                        "Nirvana",
                        "Nevermind",
                    ),
                ]),
            },
        ])
    }

    /// Fetch user's library playlists.
    /// Returns mock data for now; real API integration comes later.
    pub async fn get_library_playlists(&self) -> anyhow::Result<Vec<PlaylistSummary>> {
        Ok(vec![
            PlaylistSummary {
                playlist_id: "LM".into(),
                title: "Liked Music".into(),
                artwork_url: "".into(),
                track_count: Some(142),
            },
            PlaylistSummary {
                playlist_id: "PL_chill".into(),
                title: "Chill Vibes".into(),
                artwork_url: "".into(),
                track_count: Some(28),
            },
            PlaylistSummary {
                playlist_id: "PL_workout".into(),
                title: "Workout Mix".into(),
                artwork_url: "".into(),
                track_count: Some(45),
            },
        ])
    }
}

fn create_mock_track(video_id: &str, title: &str, artist: &str, album: &str) -> TrackInfo {
    TrackInfo {
        video_id: video_id.into(),
        title: title.into(),
        artist: artist.into(),
        artist_id: None,
        album: album.into(),
        album_id: None,
        artwork_url: Some(format!(
            "https://img.youtube.com/vi/{}/hqdefault.jpg",
            video_id
        )),
        duration_secs: 210.0,
    }
}
