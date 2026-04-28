import { useEffect, useRef, useState } from 'react';
import { useTauriEvent } from './useTauriEvent';
import { EVENTS } from '../lib/events';
import type { TrackInfo } from '../lib/types';
import {
  type HistoryEntry,
  loadHistory,
  pushHistoryEntry,
  saveHistory,
} from '../lib/playbackHistory';

// Issue #83 — observe TRACK_CHANGED, push every distinct videoId into
// the persisted recents log, and expose the current list to consumers.
// The recorder hook is mounted once at the app root (App.tsx) so the
// log keeps growing even when the History page itself isn't rendered.
//
// Two separate hooks intentionally:
//   * `usePlaybackHistoryRecorder` — write side, lives forever at the
//     app root. Returns nothing.
//   * `usePlaybackHistory` — read side, used by HistoryPage. Pulls the
//     current list from localStorage on mount and listens for the
//     same TRACK_CHANGED event so the page updates live as new tracks
//     play through the recorder.
//
// Splitting them keeps the History page a pure consumer; nothing in
// the page can corrupt the log.

export function usePlaybackHistoryRecorder(): void {
  // Last videoId we recorded — guards against the bridge re-emitting
  // TRACK_CHANGED on metadata refinement (duration / artwork landing
  // late), which is documented in `webview_bridge/poller.rs` and the
  // CLAUDE.md track-changed-fires-on-metadata-refinement note.
  const lastRecordedRef = useRef<string | null>(null);

  useTauriEvent<TrackInfo>(EVENTS.TRACK_CHANGED, (track) => {
    if (!track?.videoId) return;
    if (track.videoId === lastRecordedRef.current) return;
    // Skip "Loading..." placeholders that play_track seeds before the
    // bridge has real metadata — would pin a placeholder entry at the
    // top of the History page until the next track plays.
    if (track.title === 'Loading...' || !track.title.trim()) return;
    lastRecordedRef.current = track.videoId;
    const prev = loadHistory();
    const next = pushHistoryEntry(prev, { track, playedAt: Date.now() });
    saveHistory(next);
  });
}

export function usePlaybackHistory(): HistoryEntry[] {
  const [entries, setEntries] = useState<HistoryEntry[]>(() => loadHistory());

  // Re-read from localStorage when a new track-change happens so the
  // History page updates while it's open. Reading is cheap (a single
  // JSON parse from a capped 100-entry array).
  useTauriEvent<TrackInfo>(EVENTS.TRACK_CHANGED, () => {
    setEntries(loadHistory());
  });

  // Also re-read on mount in case the recorder has logged an entry
  // that was written between the initial render and a remount.
  useEffect(() => {
    setEntries(loadHistory());
  }, []);

  return entries;
}
