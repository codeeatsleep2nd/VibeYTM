import { type FC, useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { aboutApi, cacheApi, settingsApi, ytmApi, type AboutInfo, type AppSettings, type CacheStats } from '../../lib/ipc';
import { debug } from '../../lib/debug';

declare const __APP_VERSION__: string;
// Fallback only — the real version is fetched at runtime via Tauri's getVersion()
// which returns the Cargo package version (what's actually bundled in the DMG).
// Keeps Settings > About from showing a stale figure when package.json and
// tauri.conf.json/Cargo.toml drift (issue #45).
const FALLBACK_VERSION = __APP_VERSION__;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

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

// Mirrors the chords registered in
// src-tauri/src/integrations/global_shortcuts.rs. Keep in sync — otherwise
// the Settings page advertises bindings that aren't wired up.
const SHORTCUTS = [
  { action: 'Play / Pause', keys: '\u2318 \u21E7 Space' },
  { action: 'Next Track', keys: '\u2318 \u2325 \u2192' },
  { action: 'Previous Track', keys: '\u2318 \u2325 \u2190' },
] as const;

export const SettingsPage: FC = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [appVersion, setAppVersion] = useState<string>(FALLBACK_VERSION);
  const [aboutInfo, setAboutInfo] = useState<AboutInfo | null>(null);
  // Suppress the first save: we receive the persisted state from the
  // backend and would otherwise immediately round-trip it right back.
  const hydratedRef = useRef(false);

  const loadCacheStats = () => {
    cacheApi
      .stats()
      .then(setCacheStats)
      .catch((e) => debug.error('SettingsPage', 'cache stats failed', e));
  };

  useEffect(() => {
    loadCacheStats();
    settingsApi
      .get()
      .then(setSettings)
      .catch((e) => debug.error('SettingsPage', 'settings load failed', e));
    // Fetch the authoritative version from the Tauri runtime (Cargo/tauri.conf).
    // This is the version actually bundled in the running app, so About can't
    // drift from the real build (issue #45).
    getVersion()
      .then(setAppVersion)
      .catch((e) => debug.error('SettingsPage', 'getVersion failed', e));
    aboutApi
      .get()
      .then(setAboutInfo)
      .catch((e) => debug.error('SettingsPage', 'about info load failed', e));
  }, []);

  useEffect(() => {
    if (!settings) return;
    if (!hydratedRef.current) {
      // The first settings value came from disk — skip the save so we
      // don't immediately round-trip the same bytes back.
      hydratedRef.current = true;
      return;
    }
    settingsApi.set(settings).catch((e) =>
      debug.error('SettingsPage', 'settings save failed', e),
    );
  }, [settings]);

  const updateGeneral = (patch: Partial<AppSettings['general']>) => {
    setSettings((prev) =>
      prev ? { ...prev, general: { ...prev.general, ...patch } } : prev,
    );
  };
  const updateIntegrations = (patch: Partial<AppSettings['integrations']>) => {
    setSettings((prev) =>
      prev ? { ...prev, integrations: { ...prev.integrations, ...patch } } : prev,
    );
  };

  const closeToTray = settings?.general.closeToTray ?? true;
  const backgroundPlayback = settings?.general.backgroundPlayback ?? true;
  const desktopNotifications = settings?.integrations.notificationsEnabled ?? true;

  const handleClearCache = async () => {
    setIsClearingCache(true);
    try {
      await cacheApi.clear();
      loadCacheStats();
    } finally {
      setIsClearingCache(false);
    }
  };

  return (
    <section
      style={{
        padding: '0 var(--space-6) var(--space-8)',
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
          // Clear the drag region (AppShell main no longer pads at
          // top). Title text appears below the drag region with the
          // same `var(--space-3)` gap as before.
          paddingTop: 'calc(var(--title-bar-height) + var(--space-3))',
          marginBottom: 'var(--space-2)',
        }}
      >
        Settings
      </h1>

      {/* General */}
      <SectionHeading title="General" />
      <Divider />
      <SettingRow label="Close to tray" description="Keep VibeYTM running in the menu bar when the window is closed">
        <ToggleSwitch
          checked={closeToTray}
          disabled={!settings}
          onChange={(v) => updateGeneral({ closeToTray: v })}
        />
      </SettingRow>
      <Divider />
      <SettingRow label="Background playback" description="Continue playing audio when the app is in the background">
        <ToggleSwitch
          checked={backgroundPlayback}
          disabled={!settings}
          onChange={(v) => updateGeneral({ backgroundPlayback: v })}
        />
      </SettingRow>
      <Divider />

      {/* Integrations */}
      <SectionHeading title="Integrations" />
      <Divider />
      <SettingRow label="Desktop notifications" description="Show notifications when the track changes">
        <ToggleSwitch
          checked={desktopNotifications}
          disabled={!settings}
          onChange={(v) => updateIntegrations({ notificationsEnabled: v })}
        />
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

      {/* Cache */}
      <SectionHeading title="Cache" />
      <Divider />
      <SettingRow
        label="Disk cache"
        description={
          cacheStats
            ? `${formatBytes(cacheStats.total_bytes)} / ${formatBytes(cacheStats.max_bytes)} — ` +
              `${cacheStats.image_count} images, ${cacheStats.track_count} tracks, ${cacheStats.lyric_count} lyrics`
            : 'Loading…'
        }
      >
        <OutlinedButton
          label={isClearingCache ? 'Clearing…' : 'Clear cache'}
          onClick={handleClearCache}
        />
      </SettingRow>
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
          VibeYTM v{appVersion}
        </div>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-secondary)',
            marginBottom: 'var(--space-1)',
          }}
        >
          {aboutInfo?.built_with ?? 'Built with Tauri + React'}
        </div>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-tertiary)',
            marginBottom: 'var(--space-1)',
          }}
        >
          {aboutInfo?.tagline ?? 'A YouTube Music desktop client'}
        </div>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-tertiary)',
          }}
        >
          {(aboutInfo?.visit_prefix ?? 'Visit') + ' '}
          <a
            href={aboutInfo?.website_url ?? 'https://ytm.gleevibe.ai'}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'var(--color-accent)',
              textDecoration: 'none',
            }}
          >
            {aboutInfo?.website_label ?? 'ytm.gleevibe.ai'}
          </a>{' '}
          {aboutInfo?.visit_suffix ?? 'for more information'}
        </div>
      </div>
    </section>
  );
};
