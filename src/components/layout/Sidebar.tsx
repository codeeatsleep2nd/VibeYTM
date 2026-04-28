import { type FC, type ReactNode, memo } from 'react';
import { useAccountInfo } from '../../hooks/useAccountInfo';
import { useLoginState } from '../../hooks/useLoginState';
import { useSidebarCollapsed } from '../../hooks/useSidebarCollapsed';
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
  SongsIcon,
} from '../icons';

interface NavItemProps {
  label: string;
  icon: ReactNode;
  isActive: boolean;
  collapsed: boolean;
  onClick: () => void;
}

/**
 * Apple-Music-style sidebar row. Active state is a subtle accent-tinted
 * background + accent-colored icon and label. Hover gently brightens
 * the row's background and bumps text to primary.
 *
 * In collapsed mode (issue #82) the label hides and the row centers the
 * icon. We use `aria-label` instead so screen readers + the native
 * tooltip still surface the destination.
 */
const NavItem: FC<NavItemProps> = ({ label, icon, isActive, collapsed, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-current={isActive ? 'page' : undefined}
    aria-label={collapsed ? label : undefined}
    title={collapsed ? label : undefined}
    style={{
      // `position: relative` so the absolutely-positioned active
      // accent bar (the <span> below) anchors to the row, not the
      // viewport. The bar has `pointer-events: none` so it never
      // intercepts clicks meant for the button itself.
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: collapsed ? 'center' : 'flex-start',
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
    {/*
      Hide the label when collapsed, but keep the active accent bar
      and icon visible. Using `display: none` rather than removing
      the node keeps the markup stable for accessibility tooling.
    */}
    {!collapsed && label}
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
  { path: 'library/songs', label: 'Songs', icon: <SongsIcon size={16} /> },
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
  const { isCollapsed, toggle } = useSidebarCollapsed();

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
        // Width transition mirrors a system sidebar's resize feel — short
        // enough that motion never blocks interaction, long enough that the
        // change reads as deliberate. CSS-var driven, so the resize affects
        // every dependent layout (PlayerChrome.left, NowPlaying inset, etc.).
        transition: 'width var(--duration-normal) var(--ease-out)',
      }}
    >
      <CollapseToggle isCollapsed={isCollapsed} onToggle={toggle} />

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
            collapsed={isCollapsed}
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
        {!isCollapsed && <SectionLabel>Library</SectionLabel>}
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
              collapsed={isCollapsed}
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
          collapsed={isCollapsed}
          onClick={() => onNavigate('settings')}
        />
      </div>

      {/* Account — locked to the very bottom of the sidebar */}
      <div style={{ padding: 'var(--space-3)' }}>
        <AccountCard
          account={account}
          loggedIn={loggedIn}
          collapsed={isCollapsed}
        />
      </div>
    </aside>
  );
};

interface CollapseToggleProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

/**
 * Sidebar collapse / expand button. `position: fixed` with
 * `zIndex: 201` so it sits above the AppShell title-bar drag region
 * (`zIndex: 200`); also marked `WebkitAppRegion: 'no-drag'` so the
 * macOS title-bar drag handler doesn't swallow the click. `left`
 * tracks `--sidebar-width` so the toggle follows the panel edge as
 * it animates between expanded (240 px) and the icon-rail collapsed
 * width (64 px).
 */
const CollapseToggle: FC<CollapseToggleProps> = ({ isCollapsed, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    aria-pressed={isCollapsed}
    title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    style={{
      position: 'fixed',
      top: 'calc((var(--title-bar-height) - 22px) / 2)',
      left: 'calc(var(--sidebar-width) - 22px - var(--space-2))',
      width: '22px',
      height: '22px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 0,
      borderRadius: 'var(--radius-sm)',
      background: 'transparent',
      border: 'none',
      color: 'var(--color-text-tertiary)',
      cursor: 'pointer',
      transition:
        'background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out), left var(--duration-normal) var(--ease-out)',
      zIndex: 201,
      // @ts-expect-error -- non-standard WebKit property, opts the
      // button OUT of Tauri's window-drag region so clicks land here
      // instead of starting a drag.
      WebkitAppRegion: 'no-drag',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = 'oklch(100% 0 0 / 0.06)';
      e.currentTarget.style.color = 'var(--color-text-primary)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = 'transparent';
      e.currentTarget.style.color = 'var(--color-text-tertiary)';
    }}
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      style={{
        transform: isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform var(--duration-normal) var(--ease-out)',
      }}
    >
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <line x1="6" y1="3.5" x2="6" y2="12.5" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M9.5 6.5L11.5 8L9.5 9.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </button>
);

interface AccountCardProps {
  account: { name: string; avatarUrl: string } | null;
  /** Tri-state: true signed in, false signed out, null undetermined. */
  loggedIn: boolean | null;
  /** Sidebar collapsed (issue #82) — hides the name column, keeps avatar. */
  collapsed: boolean;
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
    prev.account?.avatarUrl === next.account?.avatarUrl &&
    prev.collapsed === next.collapsed,
);

function AccountCardInner({ account, loggedIn, collapsed }: AccountCardProps) {
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
        justifyContent: collapsed ? 'center' : 'flex-start',
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
      {!collapsed && (
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
      )}
    </div>
  );
}
