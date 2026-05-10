import { type FC, type ReactNode, memo } from 'react';
import { useAccountInfo } from '../../hooks/useAccountInfo';
import { useLoginState } from '../../hooks/useLoginState';
import { useOverlayState } from '../../lib/overlayState';
import { CachedImage } from '../CachedImage';
import {
  AlbumsIcon,
  ArtistsIcon,
  ExploreIcon,
  HistoryIcon,
  HomeIcon,
  PlaylistsIcon,
  PodcastsIcon,
  SearchIcon,
  SettingsIcon,
} from '../icons';

interface NavItemProps {
  label: string;
  icon: ReactNode;
  isActive: boolean;
  onClick: () => void;
}

/**
 * Apple-Music-style sidebar row. Active state is a subtle accent-tinted
 * background + accent-colored icon and label. Hover gently brightens
 * the row's background and bumps text to primary.
 */
const NavItem: FC<NavItemProps> = ({ label, icon, isActive, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-current={isActive ? 'page' : undefined}
    style={{
      // `position: relative` so the absolutely-positioned active
      // accent bar (the <span> below) anchors to the row, not the
      // viewport. The bar has `pointer-events: none` so it never
      // intercepts clicks meant for the button itself.
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      width: '100%',
      padding: 'var(--space-2) var(--space-3)',
      border: 'none',
      borderRadius: 'var(--radius-md)',
      // Active row reads as a discrete Liquid-Glass tile via the
      // `--glass-tile-*` recipe (rim highlight + thickness shadow +
      // outer lift) — see tokens.css. Replaces the legacy flat 0.10
      // white tint so the active row has visible depth instead of
      // looking like a hover highlight.
      background: isActive ? 'var(--glass-tile-bg-active)' : 'transparent',
      boxShadow: isActive ? 'var(--glass-tile-shadow)' : undefined,
      color: isActive
        ? 'var(--color-accent)'
        : 'var(--color-text-secondary)',
      fontSize: 'var(--text-sm)',
      fontWeight: isActive ? 600 : 500,
      transition:
        'background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out)',
      cursor: 'pointer',
      textAlign: 'left',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
    }}
    onMouseEnter={(e) => {
      if (!isActive) {
        // Bumped from 0.04 → 0.07 so the hover affordance reads
        // distinctly against the sidebar's glass background — the
        // older tint was so faint it could be mistaken for a paint
        // glitch.
        e.currentTarget.style.background = 'oklch(100% 0 0 / 0.07)';
        e.currentTarget.style.color = 'var(--color-text-primary)';
      }
    }}
    onMouseLeave={(e) => {
      if (!isActive) {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--color-text-secondary)';
      }
    }}
  >
    {/* Active-row left accent bar — Apple-Music signature. Hidden when
        inactive but kept mounted so the show/hide is a pure opacity +
        transform-X transition (compositor-only). */}
    <span
      aria-hidden
      style={{
        position: 'absolute',
        left: 4,
        top: 8,
        bottom: 8,
        width: 3,
        borderRadius: 2,
        background: 'var(--color-accent)',
        opacity: isActive ? 1 : 0,
        transform: isActive ? 'translateX(0)' : 'translateX(-4px)',
        transition:
          'opacity var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out)',
        pointerEvents: 'none',
      }}
    />
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '18px',
        flexShrink: 0,
      }}
    >
      {icon}
    </span>
    {label}
  </button>
);

interface SidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

const NAV_ITEMS: { path: string; label: string; icon: ReactNode }[] = [
  { path: 'home', label: 'Home', icon: <HomeIcon size={16} /> },
  { path: 'search', label: 'Search', icon: <SearchIcon size={16} /> },
  { path: 'explore', label: 'Explore', icon: <ExploreIcon size={16} /> },
];

// Issue #93 — History moved from the top nav into the Library group
// (sits below Podcasts, above any future "Saved" item). Apple Music
// puts "Recently Played" in the same section as the user's library.
const LIBRARY_ITEMS: { path: string; label: string; icon: ReactNode }[] = [
  { path: 'library/playlists', label: 'Playlists', icon: <PlaylistsIcon size={16} /> },
  { path: 'library/albums', label: 'Albums', icon: <AlbumsIcon size={16} /> },
  { path: 'library/artists', label: 'Artists', icon: <ArtistsIcon size={16} /> },
  { path: 'library/podcasts', label: 'Podcasts', icon: <PodcastsIcon size={16} /> },
  { path: 'history', label: 'History', icon: <HistoryIcon size={16} /> },
];

const SectionLabel: FC<{ children: ReactNode }> = ({ children }) => (
  <div
    style={{
      padding: '0 var(--space-3)',
      // Tighter rhythm with the row that follows + a bit of breathing
      // room above so the label reads as a deliberate group divider,
      // not an accidental gap.
      marginBottom: 'var(--space-2)',
      marginTop: 'var(--space-2)',
      fontSize: 'var(--text-xs)',
      fontWeight: 700,
      // Bumped from tertiary → secondary so the header's contrast is
      // closer to the row labels it groups; with the previous tertiary
      // tone the header was so faint it disappeared into the chrome.
      color: 'var(--color-text-secondary)',
      textTransform: 'uppercase',
      // Wider letter-spacing matches Apple Music's `LIBRARY` header
      // treatment and gives the all-caps label more presence at small
      // sizes.
      letterSpacing: '0.12em',
    }}
  >
    {children}
  </div>
);

export const Sidebar: FC<SidebarProps> = ({ currentPath, onNavigate }) => {
  const account = useAccountInfo();
  const loggedIn = useLoginState();
  // When NowPlaying is open, swap the sidebar's chrome glass for a
  // background that visually continues the NowPlaying surface — no
  // dark wash, lighter blur recipe matching NowPlaying's
  // `blur(40px) saturate(180%)`. Together with the dimmed right rim
  // they read as one continuous Liquid-Glass plate spanning the full
  // window instead of two separate panes meeting at a hard edge.
  const { nowPlayingOpen } = useOverlayState();

  return (
    <aside
      style={{
        position: 'relative',
        zIndex: 50,
        width: 'var(--sidebar-width)',
        height: '100%',
        paddingTop: 'var(--title-bar-height)',
        background: nowPlayingOpen ? 'transparent' : 'var(--glass-bg-chrome)',
        backdropFilter: nowPlayingOpen
          ? 'blur(40px) saturate(180%)'
          : 'blur(var(--glass-blur))',
        WebkitBackdropFilter: nowPlayingOpen
          ? 'blur(40px) saturate(180%)'
          : 'blur(var(--glass-blur))',
        borderRight: nowPlayingOpen
          ? '1px solid var(--glass-rim-dim)'
          : '1px solid var(--glass-rim-mid)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition:
          'background var(--duration-slow) var(--ease-out), border-color var(--duration-slow) var(--ease-out)',
      }}
    >
      <nav
        style={{
          padding: 'var(--space-3)',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
        }}
      >
        {NAV_ITEMS.map((item) => (
          <NavItem
            key={item.path}
            label={item.label}
            icon={item.icon}
            isActive={currentPath === item.path}
            onClick={() => onNavigate(item.path)}
          />
        ))}
      </nav>

      <div
        style={{
          padding: '0 var(--space-3) var(--space-3)',
          marginTop: 'var(--space-3)',
        }}
      >
        <SectionLabel>Library</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {LIBRARY_ITEMS.map((item, idx) => (
            <NavItem
              key={item.path}
              label={item.label}
              icon={item.icon}
              isActive={
                currentPath === item.path ||
                (currentPath === 'library' && idx === 0)
              }
              onClick={() => onNavigate(item.path)}
            />
          ))}
        </div>
      </div>

      {/* Spacer pushes the Settings + Account block to the bottom while
       *  carrying a thin top-rim divider so the chrome reads as two
       *  intentional groups (nav above, system controls below) instead
       *  of one block ending in a void. The 1 px line uses
       *  `--glass-rim-dim` so it's visible but never demands attention. */}
      <div
        style={{
          marginTop: 'auto',
          padding: 'var(--space-3)',
          borderTop: '1px solid var(--glass-rim-dim)',
        }}
      >
        <NavItem
          label="Settings"
          icon={<SettingsIcon size={16} />}
          isActive={currentPath === 'settings'}
          onClick={() => onNavigate('settings')}
        />
      </div>

      {/* Account — locked to the very bottom of the sidebar */}
      <div style={{ padding: '0 var(--space-3) var(--space-3)' }}>
        <AccountCard account={account} loggedIn={loggedIn} />
      </div>
    </aside>
  );
};

interface AccountCardProps {
  account: { name: string; avatarUrl: string } | null;
  /** Tri-state: true signed in, false signed out, null undetermined. */
  loggedIn: boolean | null;
}

// Memo keeps the avatar image stable across parent re-renders triggered by
// track/position/status events. Without this the <CachedImage> inside would
// tear down and re-probe on every player event, causing a visible flicker
// of the profile picture whenever a new song started (issue #38).
const AccountCard = memo(
  AccountCardInner,
  (prev, next) =>
    prev.loggedIn === next.loggedIn &&
    prev.account?.name === next.account?.name &&
    prev.account?.avatarUrl === next.account?.avatarUrl,
);

function AccountCardInner({ account, loggedIn }: AccountCardProps) {
  // Never render the cached avatar or "Signed in" label from a prior session
  // when the user has signed out (issue #50). Show a neutral placeholder
  // instead so the sidebar honestly reflects the auth state.
  const isSignedOut = loggedIn === false;
  const showAccount = !isSignedOut && account !== null;
  const label = showAccount
    ? account.name || 'Signed in'
    : isSignedOut
      ? 'Not signed in'
      : 'Signing in…';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-3)',
        // No tile background here — the glass-tile recipe is reserved
        // for selectable / interactive surfaces (active nav row, mood
        // pills, refresh button). The account card is informational, so
        // styling it as a tile reads as "currently selected" and
        // competes visually with the actual active nav item.
        padding: 'var(--space-2) var(--space-3)',
        borderRadius: 'var(--radius-md)',
        minWidth: 0,
      }}
      title={label}
    >
      <div
        style={{
          // Bumped 32 → 36 for stronger presence at the bottom of a tall
          // sidebar; small enough to keep the row height under 48 px so
          // it doesn't crowd the Settings row above.
          width: '36px',
          height: '36px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--color-surface-3)',
          // Inset rim mirrors the album-cover treatment so the avatar
          // reads as a discrete glass disc, not a flat photograph.
          boxShadow: 'inset 0 1px 0 var(--glass-rim-mid)',
          overflow: 'hidden',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-secondary)',
        }}
      >
        {showAccount && account.avatarUrl ? (
          <CachedImage
            src={account.avatarUrl}
            alt={account.name || 'Account avatar'}
            width={36}
            height={36}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          '○'
        )}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: isSignedOut
              ? 'var(--color-text-tertiary)'
              : 'var(--color-text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}
