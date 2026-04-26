//! Custom URI scheme protocols.
//!
//! `vibeytm-cache://` lets the webview fetch cached images natively
//! (`<img src="vibeytm-cache://localhost/?u=…">`) instead of going
//! through the `cache_fetch_image` IPC + `convertFileSrc` round trip.
//! Eliminates the 100+ IPC burst when the home page mounts after a
//! cache wipe — the webview's own image loader handles concurrency
//! natively, no `acquireFetchSlot` queue needed on the frontend.

pub mod cache_image;
