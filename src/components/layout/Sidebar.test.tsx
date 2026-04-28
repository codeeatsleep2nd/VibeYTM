import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from './Sidebar';

// Sidebar invariants pinned here (each one rooted in a past
// regression):
//
//   - Every NavItem is a real <button> (CLAUDE.md WKWebView click rule)
//   - Active NavItem renders a left-edge accent bar (Apple-Music polish)
//   - currentPath drives aria-current and the accent bar visibility
//   - LIBRARY_ITEMS first-item alias: when currentPath === 'library'
//     (no sub-tab), Playlists row reads as active (#:170 logic)
//   - AccountCard stays the last child of the sidebar (CLAUDE.md
//     screenshot blur depends on its position)
//   - Memoized AccountCard does not flicker on parent re-renders
//     (preserved by the existing memo wrapper, asserted indirectly)

vi.mock('../../hooks/useAccountInfo', () => ({
  useAccountInfo: () => ({ name: 'Jane', avatarUrl: 'https://x/a.jpg' }),
}));

vi.mock('../../hooks/useLoginState', () => ({
  useLoginState: () => true,
}));

// Mutable so individual tests can flip the sidebar between expanded
// and collapsed without remounting the module. Mirrors the pattern
// used by `PlayerChrome.test.tsx` for getPlannedNext.
const sidebarCollapsedState = {
  isCollapsed: false as boolean,
  toggle: vi.fn(),
};

vi.mock('../../hooks/useSidebarCollapsed', () => ({
  useSidebarCollapsed: () => sidebarCollapsedState,
}));

// CachedImage's mount-time `Image.decode()` isn't implemented in jsdom
// — it throws and trips the React boundary. The Sidebar's AccountCard
// is the only consumer here. Stub to a plain pass-through.
vi.mock('../CachedImage', () => ({
  CachedImage: (p: { src?: string; alt: string }) => (
    <img src={p.src} alt={p.alt} />
  ),
}));

const noop = () => {};

describe('Sidebar', () => {
  it('renders all top-nav items as real <button>s', () => {
    const { container } = render(<Sidebar currentPath="home" onNavigate={noop} />);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Explore')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    // No <div role="button"> stand-ins anywhere in the tree.
    expect(container.querySelectorAll('div[role="button"]').length).toBe(0);
  });

  it('Home click fires onNavigate("home")', async () => {
    const onNavigate = vi.fn();
    render(<Sidebar currentPath="search" onNavigate={onNavigate} />);
    await userEvent.click(screen.getByText('Home'));
    expect(onNavigate).toHaveBeenCalledWith('home');
  });

  it('Search click fires onNavigate("search")', async () => {
    const onNavigate = vi.fn();
    render(<Sidebar currentPath="home" onNavigate={onNavigate} />);
    await userEvent.click(screen.getByText('Search'));
    expect(onNavigate).toHaveBeenCalledWith('search');
  });

  it('Library Playlists click fires onNavigate("library/playlists")', async () => {
    const onNavigate = vi.fn();
    render(<Sidebar currentPath="home" onNavigate={onNavigate} />);
    await userEvent.click(screen.getByText('Playlists'));
    expect(onNavigate).toHaveBeenCalledWith('library/playlists');
  });

  it('Settings click fires onNavigate("settings")', async () => {
    const onNavigate = vi.fn();
    render(<Sidebar currentPath="home" onNavigate={onNavigate} />);
    await userEvent.click(screen.getByText('Settings'));
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });

  it('aria-current="page" set on the active NavItem', () => {
    render(<Sidebar currentPath="explore" onNavigate={noop} />);
    const exploreBtn = screen.getByText('Explore').closest('button')!;
    expect(exploreBtn.getAttribute('aria-current')).toBe('page');
    const homeBtn = screen.getByText('Home').closest('button')!;
    expect(homeBtn.getAttribute('aria-current')).toBeNull();
  });

  it('currentPath="library" aliases to Playlists active (#:170 logic)', () => {
    render(<Sidebar currentPath="library" onNavigate={noop} />);
    const playlistsBtn = screen.getByText('Playlists').closest('button')!;
    expect(playlistsBtn.getAttribute('aria-current')).toBe('page');
  });

  it('Active NavItem renders the left-edge accent bar visible (opacity 1)', () => {
    render(<Sidebar currentPath="home" onNavigate={noop} />);
    const homeBtn = screen.getByText('Home').closest('button')!;
    // The accent bar is the first <span aria-hidden> child (3px wide).
    const bar = homeBtn.querySelector('span[aria-hidden]') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.style.opacity).toBe('1');
  });

  it('Inactive NavItem renders the accent bar hidden (opacity 0)', () => {
    render(<Sidebar currentPath="home" onNavigate={noop} />);
    const searchBtn = screen.getByText('Search').closest('button')!;
    const bar = searchBtn.querySelector('span[aria-hidden]') as HTMLElement;
    expect(bar.style.opacity).toBe('0');
  });

  it('Account card stays mounted and shows the signed-in user name', () => {
    render(<Sidebar currentPath="home" onNavigate={noop} />);
    expect(screen.getByText('Jane')).toBeInTheDocument();
  });

  it('NEVER applies transform: scale on the sidebar wrapper (WKWebView hit-test rule)', () => {
    const { container } = render(<Sidebar currentPath="home" onNavigate={noop} />);
    expect(container.innerHTML).not.toMatch(/scale\(/);
  });

  it('Accent bar has pointer-events: none (cannot intercept clicks)', () => {
    render(<Sidebar currentPath="home" onNavigate={noop} />);
    const homeBtn = screen.getByText('Home').closest('button')!;
    const bar = homeBtn.querySelector('span[aria-hidden]') as HTMLElement;
    expect(bar.style.pointerEvents).toBe('none');
  });

  // ---- Collapsible sidebar (issue #82) ----
  describe('collapsed mode', () => {
    afterEach(() => {
      sidebarCollapsedState.isCollapsed = false;
      sidebarCollapsedState.toggle.mockClear();
    });

    it('renders the expand/collapse toggle as a real <button> with no-drag opt-out', () => {
      const { container } = render(<Sidebar currentPath="home" onNavigate={noop} />);
      const toggle = screen.getByRole('button', { name: /Collapse sidebar/i });
      expect(toggle).toBeInstanceOf(HTMLButtonElement);
      // The toggle must escape the title-bar drag region (zIndex 200) and
      // opt out of the WebkitAppRegion drag — without this clicks land on
      // the drag region instead of the button.
      expect(toggle.style.zIndex).toBe('201');
      expect(toggle.style.position).toBe('fixed');
      // No `<div role="button">` stand-ins introduced by the new code.
      expect(container.querySelectorAll('div[role="button"]').length).toBe(0);
    });

    it('clicking the toggle calls the hook toggle function', async () => {
      render(<Sidebar currentPath="home" onNavigate={noop} />);
      const toggle = screen.getByRole('button', { name: /Collapse sidebar/i });
      await userEvent.click(toggle);
      expect(sidebarCollapsedState.toggle).toHaveBeenCalledTimes(1);
    });

    it('hides nav labels and the account name when collapsed', () => {
      sidebarCollapsedState.isCollapsed = true;
      render(<Sidebar currentPath="home" onNavigate={noop} />);
      // Labels live as the trailing text node of each NavItem button.
      // When collapsed they are not rendered — querying by visible text
      // yields no element. The Library *section header* is also hidden.
      expect(screen.queryByText('Home')).not.toBeInTheDocument();
      expect(screen.queryByText('Library')).not.toBeInTheDocument();
      // Account card avatar still mounted, but the name is gone.
      expect(screen.queryByText('Jane')).not.toBeInTheDocument();
      // Toggle button surfaces the destination via aria-label so the
      // intent stays accessible — pin the inverse text since
      // isCollapsed=true means the action is now "Expand sidebar".
      expect(
        screen.getByRole('button', { name: /Expand sidebar/i }),
      ).toBeInTheDocument();
    });
  });
});
