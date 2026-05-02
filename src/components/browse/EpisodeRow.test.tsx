import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TrackInfo } from '../../lib/types';

vi.mock('../../lib/ipc', () => ({
  playerApi: { playTrack: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../CachedImage', () => ({
  CachedImage: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

vi.mock('../contextMenu/ContextMenu', () => ({
  ContextMenuTarget: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../contextMenu/trackActions', () => ({
  buildTrackContextMenu: () => [],
}));

const { EpisodeRow } = await import('./EpisodeRow');

const episode = (overrides: Partial<TrackInfo> = {}): TrackInfo => ({
  videoId: 'ep1',
  title: 'Some Episode Title',
  artist: 'The Show',
  album: '',
  durationSecs: 36 * 60,
  publishedAt: 'Mar 1, 2026',
  description: 'A blurb about the episode.',
  ...overrides,
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('EpisodeRow', () => {
  it('renders title, formatted duration, publish date, and description', () => {
    render(<EpisodeRow track={episode()} />);
    expect(screen.getByText('Some Episode Title')).toBeInTheDocument();
    // Meta line concatenates publish-date and long-form duration.
    expect(screen.getByText(/Mar 1, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/36 min/)).toBeInTheDocument();
    expect(screen.getByText('A blurb about the episode.')).toBeInTheDocument();
  });

  it('formats hour-plus durations as "X hr Y min"', () => {
    render(
      <EpisodeRow track={episode({ durationSecs: 90 * 60, publishedAt: undefined })} />,
    );
    expect(screen.getByText(/1 hr 30 min/)).toBeInTheDocument();
  });

  it('drops "0 min" suffix for whole-hour durations', () => {
    render(
      <EpisodeRow track={episode({ durationSecs: 60 * 60, publishedAt: undefined })} />,
    );
    const meta = screen.getByText(/1 hr/);
    expect(meta.textContent).not.toMatch(/0 min/);
  });

  it('omits the meta line entirely when no publish date and no duration', () => {
    render(
      <EpisodeRow
        track={episode({ durationSecs: 0, publishedAt: undefined, description: undefined })}
      />,
    );
    // Title still renders; meta paragraph (uppercase eyebrow) does not.
    expect(screen.getByText('Some Episode Title')).toBeInTheDocument();
    expect(screen.queryByText(/Mar 1, 2026/)).toBeNull();
  });

  it('omits the description paragraph when description is missing', () => {
    render(<EpisodeRow track={episode({ description: undefined })} />);
    expect(screen.queryByText('A blurb about the episode.')).toBeNull();
  });
});
