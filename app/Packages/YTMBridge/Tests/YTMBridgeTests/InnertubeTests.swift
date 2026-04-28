import Foundation
import Testing
@testable import YTMBridge

/// Tests for the Innertube response parser. The parser is deliberately
/// optional-chained throughout to tolerate YTM's regular schema
/// changes (see file header in `Innertube.swift`), so these tests
/// pin the SHAPES we have already encountered in production. A new
/// schema change would still silently degrade to "no shelves"; the
/// tests catch regressions in parsing the shapes we DO support.
@Suite("Innertube.parseShelves / parseBrowseResponse")
struct InnertubeTests {
    @Test("Single-column home/explore shape extracts shelves with title + items")
    func singleColumnHome() throws {
        let raw = #"""
        {
          "contents": {
            "singleColumnBrowseResultsRenderer": {
              "tabs": [
                {
                  "tabRenderer": {
                    "content": {
                      "sectionListRenderer": {
                        "contents": [
                          {
                            "musicCarouselShelfRenderer": {
                              "header": {
                                "musicCarouselShelfBasicHeaderRenderer": {
                                  "title": { "runs": [{ "text": "Listen Again" }] }
                                }
                              },
                              "contents": [
                                {
                                  "musicTwoRowItemRenderer": {
                                    "title": { "runs": [{ "text": "Album One" }] },
                                    "subtitle": { "runs": [{ "text": "Artist · 2024" }] },
                                    "navigationEndpoint": {
                                      "browseEndpoint": { "browseId": "MPREb_test1" }
                                    },
                                    "thumbnailRenderer": {
                                      "musicThumbnailRenderer": {
                                        "thumbnail": {
                                          "thumbnails": [
                                            { "url": "https://example.com/cover-large.jpg" }
                                          ]
                                        }
                                      }
                                    }
                                  }
                                }
                              ]
                            }
                          }
                        ]
                      }
                    }
                  }
                }
              ]
            }
          }
        }
        """#
        let shelves = Innertube.parseShelves(from: Data(raw.utf8))
        #expect(shelves.count == 1)
        #expect(shelves[0].title == "Listen Again")
        #expect(shelves[0].items.count == 1)
        #expect(shelves[0].items[0].title == "Album One")
        #expect(shelves[0].items[0].browseId == "MPREb_test1")
        #expect(shelves[0].items[0].artworkUrl == "https://example.com/cover-large.jpg")
    }

    @Test("Two-column album page: header from tabs[0], track shelf from secondaryContents")
    func twoColumnAlbum() throws {
        let raw = #"""
        {
          "contents": {
            "twoColumnBrowseResultsRenderer": {
              "tabs": [
                {
                  "tabRenderer": {
                    "content": {
                      "sectionListRenderer": {
                        "contents": [
                          {
                            "musicResponsiveHeaderRenderer": {
                              "title": { "runs": [{ "text": "Test Album" }] },
                              "subtitle": { "runs": [{ "text": "Album · " }, { "text": "Test Artist" }] },
                              "thumbnail": {
                                "musicThumbnailRenderer": {
                                  "thumbnail": {
                                    "thumbnails": [
                                      { "url": "https://example.com/album-art.jpg" }
                                    ]
                                  }
                                }
                              },
                              "buttons": [
                                {
                                  "musicPlayButtonRenderer": {
                                    "playNavigationEndpoint": {
                                      "watchEndpoint": {
                                        "videoId": "vid1",
                                        "playlistId": "OLAK5uy_test"
                                      }
                                    }
                                  }
                                }
                              ]
                            }
                          }
                        ]
                      }
                    }
                  }
                }
              ],
              "secondaryContents": {
                "sectionListRenderer": {
                  "contents": [
                    {
                      "musicShelfRenderer": {
                        "contents": [
                          {
                            "musicResponsiveListItemRenderer": {
                              "flexColumns": [
                                {
                                  "musicResponsiveListItemFlexColumnRenderer": {
                                    "text": {
                                      "runs": [
                                        {
                                          "text": "Track One",
                                          "navigationEndpoint": {
                                            "watchEndpoint": {
                                              "videoId": "vid1",
                                              "playlistId": "OLAK5uy_test"
                                            }
                                          }
                                        }
                                      ]
                                    }
                                  }
                                }
                              ]
                            }
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            }
          }
        }
        """#
        let response = Innertube.parseBrowseResponse(from: Data(raw.utf8))
        // Header
        #expect(response.header?.title == "Test Album")
        #expect(response.header?.artworkUrl == "https://example.com/album-art.jpg")
        #expect(response.header?.audioPlaylistId == "OLAK5uy_test")
        // Track shelf — `musicShelfRenderer` with no title field
        // should synthesize "Tracks" (verified by the round-1 fix).
        #expect(response.shelves.count == 1)
        #expect(response.shelves[0].title == "Tracks")
        #expect(response.shelves[0].items.count == 1)
        #expect(response.shelves[0].items[0].title == "Track One")
        #expect(response.shelves[0].items[0].videoId == "vid1")
    }

    @Test("Untitled musicShelfRenderer with items synthesizes 'Tracks' rather than dropping the shelf")
    func untitledShelf() throws {
        let raw = #"""
        {
          "contents": {
            "singleColumnBrowseResultsRenderer": {
              "tabs": [
                {
                  "tabRenderer": {
                    "content": {
                      "sectionListRenderer": {
                        "contents": [
                          {
                            "musicShelfRenderer": {
                              "contents": [
                                {
                                  "musicResponsiveListItemRenderer": {
                                    "flexColumns": [
                                      {
                                        "musicResponsiveListItemFlexColumnRenderer": {
                                          "text": { "runs": [{ "text": "Untitled track" }] }
                                        }
                                      }
                                    ]
                                  }
                                }
                              ]
                            }
                          }
                        ]
                      }
                    }
                  }
                }
              ]
            }
          }
        }
        """#
        let shelves = Innertube.parseShelves(from: Data(raw.utf8))
        #expect(shelves.count == 1)
        #expect(shelves[0].title == "Tracks")
        #expect(shelves[0].items.count == 1)
    }

    @Test("Empty/malformed JSON degrades to empty array without crashing")
    func emptyAndMalformed() {
        #expect(Innertube.parseShelves(from: Data()).isEmpty)
        #expect(Innertube.parseShelves(from: Data("not json".utf8)).isEmpty)
        #expect(Innertube.parseShelves(from: Data("{}".utf8)).isEmpty)
    }

    @Test("gridRenderer (library Albums tab) extracts items via two-row item parser")
    func gridRenderer() throws {
        let raw = #"""
        {
          "contents": {
            "singleColumnBrowseResultsRenderer": {
              "tabs": [
                {
                  "tabRenderer": {
                    "content": {
                      "sectionListRenderer": {
                        "contents": [
                          {
                            "gridRenderer": {
                              "header": {
                                "gridHeaderRenderer": {
                                  "title": { "runs": [{ "text": "Saved Albums" }] }
                                }
                              },
                              "items": [
                                {
                                  "musicTwoRowItemRenderer": {
                                    "title": { "runs": [{ "text": "Library Album" }] },
                                    "subtitle": { "runs": [{ "text": "Artist" }] },
                                    "navigationEndpoint": {
                                      "browseEndpoint": { "browseId": "MPREb_lib" }
                                    },
                                    "thumbnailRenderer": {
                                      "musicThumbnailRenderer": {
                                        "thumbnail": {
                                          "thumbnails": [{ "url": "https://example.com/lib.jpg" }]
                                        }
                                      }
                                    }
                                  }
                                }
                              ]
                            }
                          }
                        ]
                      }
                    }
                  }
                }
              ]
            }
          }
        }
        """#
        let shelves = Innertube.parseShelves(from: Data(raw.utf8))
        #expect(shelves.count == 1)
        #expect(shelves[0].title == "Saved Albums")
        #expect(shelves[0].items.count == 1)
        #expect(shelves[0].items[0].browseId == "MPREb_lib")
    }
}
