import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DetailPageHero } from './DetailPageHero';

// Pure presentational shell — every callback the playlist / artist
// detail pages care about must be wired through. The colors prop is
// the only thing that drives the gradient; everything else (data,
// state, business logic) stays in the consumer page.
//
// Each test pins one invariant the consumer pages depend on. A
// regression here breaks save / play / shuffle / back across both
// PlaylistDetailPage and ArtistPage.

const baseColors = {
  primary: 'rgb(200, 50, 50)',
  secondary: 'rgb(50, 50, 200)',
};

function noop() {}

describe('DetailPageHero', () => {
  it('renders title and kind label', () => {
    render(
      <DetailPageHero
        title="Demo Album"
        kind="Album"
        coverUrl=""
        colors={baseColors}
        onBack={noop}
        onPlay={noop}
      />,
    );
    expect(screen.getByText('Demo Album')).toBeInTheDocument();
    expect(screen.getByText('Album')).toBeInTheDocument();
  });

  it('Back button fires onBack', async () => {
    const onBack = vi.fn();
    render(
      <DetailPageHero
        title="X"
        kind="Album"
        coverUrl=""
        colors={baseColors}
        onBack={onBack}
        onPlay={noop}
      />,
    );
    await userEvent.click(screen.getByLabelText('Back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('Play button fires onPlay', async () => {
    const onPlay = vi.fn();
    render(
      <DetailPageHero
        title="X"
        kind="Album"
        coverUrl=""
        colors={baseColors}
        onBack={noop}
        onPlay={onPlay}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Play/ }));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('Shuffle button fires onShuffle when provided', async () => {
    const onShuffle = vi.fn();
    render(
      <DetailPageHero
        title="X"
        kind="Album"
        coverUrl=""
        colors={baseColors}
        onBack={noop}
        onPlay={noop}
        onShuffle={onShuffle}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Shuffle/ }));
    expect(onShuffle).toHaveBeenCalledTimes(1);
  });

  it('Shuffle button is hidden when onShuffle is undefined', () => {
    render(
      <DetailPageHero
        title="X"
        kind="Album"
        coverUrl=""
        colors={baseColors}
        onBack={noop}
        onPlay={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: /Shuffle/ })).not.toBeInTheDocument();
  });

  it('Save button shows "+ Save to Playlists" when isSaved=false and isAlbum=false', () => {
    render(
      <DetailPageHero
        title="X"
        kind="Playlist"
        coverUrl=""
        colors={baseColors}
        onBack={noop}
        onPlay={noop}
        save={{ isSaved: false, isAlbum: false, isSaving: false, onToggle: noop }}
      />,
    );
    expect(screen.getByText('+ Save to Playlists')).toBeInTheDocument();
  });

  it('Save button shows "+ Save to Albums" when isAlbum=true', () => {
    render(
      <DetailPageHero
        title="X"
        kind="Album"
        coverUrl=""
        colors={baseColors}
        onBack={noop}
        onPlay={noop}
        save={{ isSaved: false, isAlbum: true, isSaving: false, onToggle: noop }}
      />,
    );
    expect(screen.getByText('+ Save to Albums')).toBeInTheDocument();
  });

  it('Save button shows "✓ Remove from Library" when isSaved=true', () => {
    render(
      <DetailPageHero
        title="X"
        kind="Album"
        coverUrl=""
        colors={baseColors}
        onBack={noop}
        onPlay={noop}
        save={{ isSaved: true, isAlbum: true, isSaving: false, onToggle: noop }}
      />,
    );
    expect(screen.getByText('✓ Remove from Library')).toBeInTheDocument();
  });

  it('Save button fires onToggle and aria-pressed reflects state', async () => {
    const onToggle = vi.fn();
    render(
      <DetailPageHero
        title="X"
        kind="Album"
        coverUrl=""
        colors={baseColors}
        onBack={noop}
        onPlay={noop}
        save={{ isSaved: true, isAlbum: true, isSaving: false, onToggle }}
      />,
    );
    const btn = screen.getByRole('button', { name: /Remove from library/i });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('Save button hidden entirely when no `save` prop', () => {
    render(
      <DetailPageHero
        title="X"
        kind="Artist"
        coverUrl=""
        colors={baseColors}
        onBack={noop}
        onPlay={noop}
      />,
    );
    expect(screen.queryByText(/Save to/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Remove from Library/)).not.toBeInTheDocument();
  });

  it('renders meta line when provided', () => {
    render(
      <DetailPageHero
        title="X"
        kind="Album"
        coverUrl=""
        colors={baseColors}
        onBack={noop}
        onPlay={noop}
        meta="12 songs · 42 min"
      />,
    );
    expect(screen.getByText('12 songs · 42 min')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(
      <DetailPageHero
        title="X"
        kind="Playlist"
        coverUrl=""
        colors={baseColors}
        onBack={noop}
        onPlay={noop}
        description="A great mix of songs."
      />,
    );
    expect(screen.getByText('A great mix of songs.')).toBeInTheDocument();
  });

  it('renders saveError text when provided', () => {
    render(
      <DetailPageHero
        title="X"
        kind="Album"
        coverUrl=""
        colors={baseColors}
        onBack={noop}
        onPlay={noop}
        save={{
          isSaved: false,
          isAlbum: true,
          isSaving: false,
          onToggle: noop,
          error: 'Could not save to Albums',
        }}
      />,
    );
    expect(screen.getByText('Could not save to Albums')).toBeInTheDocument();
  });

  it('NEVER applies transform: scale on the wrapper (WKWebView hit-test rule)', () => {
    const { container } = render(
      <DetailPageHero
        title="X"
        kind="Album"
        coverUrl=""
        colors={baseColors}
        onBack={noop}
        onPlay={noop}
      />,
    );
    expect(container.innerHTML).not.toMatch(/scale\(/);
  });

  it('gradient uses both palette colors from the colors prop', () => {
    const { container } = render(
      <DetailPageHero
        title="X"
        kind="Album"
        coverUrl=""
        colors={{ primary: 'rgb(11, 22, 33)', secondary: 'rgb(99, 88, 77)' }}
        onBack={noop}
        onPlay={noop}
      />,
    );
    // Both the primary and secondary RGB strings must appear somewhere
    // in the rendered style — proves the gradient is data-driven, not
    // a hardcoded fallback.
    expect(container.innerHTML).toContain('11, 22, 33');
    expect(container.innerHTML).toContain('99, 88, 77');
  });
});
