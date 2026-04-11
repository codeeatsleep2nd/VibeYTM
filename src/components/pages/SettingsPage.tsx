import { type FC, useState } from 'react';
import { ytmApi } from '../../lib/ipc';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

const ToggleSwitch: FC<ToggleSwitchProps> = ({ checked, onChange, disabled = false }) => (
  <button
    role="switch"
    aria-checked={checked}
    onClick={() => {
      if (!disabled) {
        onChange(!checked);
      }
    }}
    style={{
      position: 'relative',
      width: '44px',
      height: '24px',
      borderRadius: 'var(--radius-full)',
      background: checked ? 'var(--color-accent)' : 'var(--color-surface-3)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      transition: `background var(--duration-normal) var(--ease-out)`,
      flexShrink: 0,
    }}
  >
    <div
      style={{
        position: 'absolute',
        top: '2px',
        left: checked ? '22px' : '2px',
        width: '20px',
        height: '20px',
        borderRadius: 'var(--radius-full)',
        background: 'var(--color-text-primary)',
        transition: `left var(--duration-normal) var(--ease-out)`,
      }}
    />
  </button>
);

interface SettingRowProps {
  label: string;
  description?: string;
  badge?: string;
  children: React.ReactNode;
}

const SettingRow: FC<SettingRowProps> = ({ label, description, badge, children }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: 'var(--space-3) 0',
    }}
  >
    <div style={{ minWidth: 0, flex: 1, marginRight: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span
          style={{
            fontSize: 'var(--text-base)',
            color: 'var(--color-text-primary)',
            fontWeight: 500,
          }}
        >
          {label}
        </span>
        {badge && (
          <span
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-tertiary)',
              background: 'var(--color-surface-3)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
              fontWeight: 500,
            }}
          >
            {badge}
          </span>
        )}
      </div>
      {description && (
        <div
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-tertiary)',
            marginTop: 'var(--space-1)',
          }}
        >
          {description}
        </div>
      )}
    </div>
    {children}
  </div>
);

const SectionHeading: FC<{ title: string }> = ({ title }) => (
  <h2
    style={{
      fontSize: 'var(--text-lg)',
      fontWeight: 600,
      color: 'var(--color-text-primary)',
      marginTop: 'var(--space-8)',
      marginBottom: 'var(--space-3)',
    }}
  >
    {title}
  </h2>
);

const Divider: FC = () => (
  <div
    style={{
      height: '1px',
      background: 'oklch(100% 0 0 / 0.06)',
      margin: 'var(--space-1) 0',
    }}
  />
);

const ShortcutBadge: FC<{ keys: string }> = ({ keys }) => (
  <span
    style={{
      fontSize: 'var(--text-xs)',
      fontFamily: 'var(--font-sans)',
      color: 'var(--color-text-secondary)',
      background: 'var(--color-surface-3)',
      padding: '4px 10px',
      borderRadius: 'var(--radius-sm)',
      fontWeight: 500,
      letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
    }}
  >
    {keys}
  </span>
);

const OutlinedButton: FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <button
    onClick={onClick}
    style={{
      fontSize: 'var(--text-sm)',
      fontWeight: 500,
      color: 'var(--color-text-primary)',
      border: '1px solid oklch(100% 0 0 / 0.12)',
      borderRadius: 'var(--radius-sm)',
      padding: 'var(--space-2) var(--space-4)',
      background: 'transparent',
      cursor: 'pointer',
      transition: `background var(--duration-fast) var(--ease-out)`,
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = 'oklch(100% 0 0 / 0.04)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = 'transparent';
    }}
  >
    {label}
  </button>
);

const SHORTCUTS = [
  { action: 'Play / Pause', keys: 'Space' },
  { action: 'Next Track', keys: 'Cmd + Right' },
  { action: 'Previous Track', keys: 'Cmd + Left' },
] as const;

export const SettingsPage: FC = () => {
  const [closeToTray, setCloseToTray] = useState(false);
  const [backgroundPlayback, setBackgroundPlayback] = useState(true);
  const [desktopNotifications, setDesktopNotifications] = useState(true);

  return (
    <section
      style={{
        padding: 'var(--space-8) var(--space-6)',
        overflowY: 'auto',
        height: '100%',
        maxWidth: '640px',
      }}
    >
      <h1
        style={{
          fontSize: 'var(--text-2xl)',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: 'var(--color-text-primary)',
          marginBottom: 'var(--space-2)',
        }}
      >
        Settings
      </h1>

      {/* General */}
      <SectionHeading title="General" />
      <Divider />
      <SettingRow label="Close to tray" description="Keep VibeYTM running in the menu bar when the window is closed">
        <ToggleSwitch checked={closeToTray} onChange={setCloseToTray} />
      </SettingRow>
      <Divider />
      <SettingRow label="Background playback" description="Continue playing audio when the app is in the background">
        <ToggleSwitch checked={backgroundPlayback} onChange={setBackgroundPlayback} />
      </SettingRow>
      <Divider />

      {/* Integrations */}
      <SectionHeading title="Integrations" />
      <Divider />
      <SettingRow label="Desktop notifications" description="Show notifications when the track changes">
        <ToggleSwitch checked={desktopNotifications} onChange={setDesktopNotifications} />
      </SettingRow>
      <Divider />

      {/* Keyboard Shortcuts */}
      <SectionHeading title="Keyboard Shortcuts" />
      <Divider />
      {SHORTCUTS.map((shortcut) => (
        <div key={shortcut.action}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 'var(--space-3) 0',
            }}
          >
            <span
              style={{
                fontSize: 'var(--text-base)',
                color: 'var(--color-text-primary)',
              }}
            >
              {shortcut.action}
            </span>
            <ShortcutBadge keys={shortcut.keys} />
          </div>
          <Divider />
        </div>
      ))}

      {/* YouTube Music */}
      <SectionHeading title="YouTube Music" />
      <Divider />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
          padding: 'var(--space-3) 0',
        }}
      >
        <OutlinedButton label="Sign in to YouTube Music" onClick={() => ytmApi.showYtm()} />
        <OutlinedButton label="Hide YouTube Music window" onClick={() => ytmApi.hideYtm()} />
        <OutlinedButton label="Re-inject player bridge" onClick={() => ytmApi.injectBridge()} />
      </div>
      <Divider />

      {/* About */}
      <SectionHeading title="About" />
      <Divider />
      <div style={{ padding: 'var(--space-4) 0' }}>
        <div
          style={{
            fontSize: 'var(--text-base)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            marginBottom: 'var(--space-2)',
          }}
        >
          VibeYTM v0.1.0
        </div>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-secondary)',
            marginBottom: 'var(--space-1)',
          }}
        >
          Built with Tauri + React
        </div>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-tertiary)',
          }}
        >
          An Apple Music-style YouTube Music client
        </div>
      </div>
    </section>
  );
};
