import { type FC } from 'react';
import { useAccountInfo } from '../../hooks/useAccountInfo';
import { CachedImage } from '../CachedImage';

interface NavItemProps {
  label: string;
  icon: string;
  isActive: boolean;
  onClick: () => void;
}

const NavItem: FC<NavItemProps> = ({ label, icon, isActive, onClick }) => (
  <button
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      width: '100%',
      padding: 'var(--space-2) var(--space-4)',
      border: 'none',
      borderRadius: 'var(--radius-md)',
      background: isActive ? 'var(--color-accent)' : 'transparent',
      color: isActive ? 'oklch(100% 0 0)' : 'var(--color-text-secondary)',
      fontSize: 'var(--text-sm)',
      fontWeight: isActive ? 600 : 400,
      transition: `background var(--duration-fast) var(--ease-out),
                   color var(--duration-fast) var(--ease-out)`,
      cursor: 'pointer',
      textAlign: 'left',
    }}
    onMouseEnter={(e) => {
      if (!isActive) {
        e.currentTarget.style.background = 'var(--color-surface-1)';
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
    <span style={{ fontSize: 'var(--text-lg)', width: '20px', textAlign: 'center' }}>
      {icon}
    </span>
    {label}
  </button>
);

interface SidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
}

const NAV_ITEMS = [
  { path: 'home', label: 'Home', icon: '⌂' },
  { path: 'search', label: 'Search', icon: '⌕' },
  { path: 'explore', label: 'Explore', icon: '✦' },
];

const LIBRARY_ITEMS = [
  { path: 'library/playlists', label: 'Playlists', icon: '♫' },
  { path: 'library/songs', label: 'Songs', icon: '♪' },
  { path: 'library/albums', label: 'Albums', icon: '◉' },
  { path: 'library/artists', label: 'Artists', icon: '☆' },
];

export const Sidebar: FC<SidebarProps> = ({ currentPath, onNavigate }) => {
  const account = useAccountInfo();

  return (
  <aside
    style={{
      width: 'var(--sidebar-width)',
      height: '100%',
      paddingTop: 'var(--title-bar-height)',
      background: 'var(--glass-bg)',
      backdropFilter: `blur(var(--glass-blur))`,
      WebkitBackdropFilter: `blur(var(--glass-blur))`,
      borderRight: '1px solid oklch(100% 0 0 / 0.06)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}
  >
    <nav style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
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
        height: '1px',
        margin: 'var(--space-2) var(--space-4)',
        background: 'oklch(100% 0 0 / 0.08)',
      }}
    />

    <div style={{ padding: 'var(--space-3)' }}>
      <span
        style={{
          display: 'block',
          padding: '0 var(--space-4)',
          marginBottom: 'var(--space-2)',
          fontSize: 'var(--text-xs)',
          fontWeight: 600,
          color: 'var(--color-text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        Library
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
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
        icon={'\u2699'}
        isActive={currentPath === 'settings'}
        onClick={() => onNavigate('settings')}
      />
    </div>

    {/* Account — locked to the very bottom of the sidebar */}
    <div style={{ padding: 'var(--space-3)' }}>
      <AccountCard account={account} />
    </div>
  </aside>
  );
};

interface AccountCardProps {
  account: { name: string; avatarUrl: string } | null;
}

const AccountCard: FC<AccountCardProps> = ({ account }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-3)',
      padding: 'var(--space-2) var(--space-4)',
      borderRadius: 'var(--radius-md)',
      minWidth: 0,
    }}
    title={account?.name || 'Signed in'}
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
      {account?.avatarUrl ? (
        <CachedImage
          src={account.avatarUrl}
          alt={account.name || 'Account avatar'}
          width={32}
          height={32}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        '\u25CB'
      )}
    </div>
    <div style={{ minWidth: 0, flex: 1 }}>
      <div
        style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
          color: 'var(--color-text-primary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {account?.name || 'Signed in'}
      </div>
    </div>
  </div>
);
