import { type FC, type ReactNode, memo } from 'react';
import { useAccountInfo } from '../../hooks/useAccountInfo';
import { useLoginState } from '../../hooks/useLoginState';
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
      // Selection style unified across the app: same white-wash glass
      // tint used by the QueuePanel highlighted row
      // (`QueueRow.tsx` baseStyle.background). Replaces the previous
      // accent-tinted red so every "selected" surface in the UI reads
      // the same visual weight against the liquid-glass plates.
      background: isActive ? 'oklch(100% 0 0 / 0.10)' : 'transparent',
      color: isActive
        ? 'var(--color-accent)'
        : 'var(--color-text-secondary)',
      fontSize: 'var(--text-sm)',
      fontWeight: isActive ? 600 : 500,
      transition:
        'background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out)',
      cursor: 'pointer',
      textAlign: 'left',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
    }}
    onMouseEnter={(e) => {
      if (!isActive) {
        e.currentTarget.style.background = 'oklch(100% 0 0 / 0.04)';
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
      marginBottom: 'var(--space-1)',
      fontSize: 'var(--text-xs)',
      fontWeight: 600,
      color: 'var(--color-text-tertiary)',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
    }}
  >
    {children}
  </div>
);

export const Sidebar: FC<SidebarProps> = ({ currentPath, onNavigate }) => {
  const account = useAccountInfo();
  const loggedIn = useLoginState();

  return (
    <aside
      style={{
        position: 'relative',
        zIndex: 50,
        width: 'var(--sidebar-width)',
        height: '100%',
        paddingTop: 'var(--title-bar-height)',
        background: 'var(--glass-bg-chrome)',
        backdropFilter: 'blur(var(--glass-blur))',
        WebkitBackdropFilter: 'blur(var(--glass-blur))',
        borderRight: '1px solid var(--glass-rim-mid)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
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

      {/* Settings — pushed to bottom */}
      <div style={{ marginTop: 'auto', padding: 'var(--space-3)' }}>
        <NavItem
          label="Settings"
          icon={<SettingsIcon size={16} />}
          isActive={currentPath === 'settings'}
          onClick={() => onNavigate('settings')}
        />
      </div>

      {/* Account — locked to the very bottom of the sidebar */}
      <div style={{ padding: 'var(--space-3)' }}>
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
        padding: 'var(--space-2) var(--space-3)',
        borderRadius: 'var(--radius-md)',
        minWidth: 0,
      }}
      title={label}
    >
      <div
        style={{
          width: '32px',
          height: '32px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--color-surface-3)',
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
            width={32}
            height={32}
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
