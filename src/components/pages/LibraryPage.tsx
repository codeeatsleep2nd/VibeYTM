import { type FC, useEffect, useState } from 'react';
import type { PlaylistSummary } from '../../lib/types';
import { browseApi } from '../../lib/ipc';

const TABS = ['Playlists', 'Songs', 'Albums', 'Artists'] as const;
type Tab = (typeof TABS)[number];

export const LibraryPage: FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('Playlists');
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (activeTab !== 'Playlists') return;

    let cancelled = false;
    setIsLoading(true);

    browseApi
      .getLibraryPlaylists()
      .then((data) => {
        if (!cancelled) {
          setPlaylists(data);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  return (
    <section
      style={{
        padding: 'var(--space-8) var(--space-6)',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      <h1
        style={{
          fontSize: 'var(--text-2xl)',
          fontWeight: 700,
          marginBottom: 'var(--space-6)',
          letterSpacing: '-0.02em',
          color: 'var(--color-text-primary)',
        }}
      >
        Library
      </h1>

      <div
        style={{
          display: 'flex',
          gap: 'var(--space-1)',
          marginBottom: 'var(--space-8)',
          borderBottom: '1px solid oklch(100% 0 0 / 0.08)',
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              fontSize: 'var(--text-sm)',
              fontWeight: activeTab === tab ? 600 : 400,
              color:
                activeTab === tab
                  ? 'var(--color-text-primary)'
                  : 'var(--color-text-secondary)',
              borderBottom:
                activeTab === tab
                  ? '2px solid var(--color-accent)'
                  : '2px solid transparent',
              transition: `color var(--duration-fast) var(--ease-out),
                           border-color var(--duration-fast) var(--ease-out)`,
              marginBottom: '-1px',
              background: 'none',
              border: 'none',
              borderBottomWidth: '2px',
              borderBottomStyle: 'solid',
              borderBottomColor:
                activeTab === tab ? 'var(--color-accent)' : 'transparent',
              cursor: 'pointer',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Playlists' && (
        <>
          {isLoading && (
            <p
              style={{
                fontSize: 'var(--text-base)',
                color: 'var(--color-text-tertiary)',
              }}
            >
              Loading...
            </p>
          )}
          {!isLoading && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {playlists.map((playlist) => (
                <PlaylistRow key={playlist.playlistId} playlist={playlist} />
              ))}
            </div>
          )}
        </>
      )}

      {activeTab !== 'Playlists' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '200px',
          }}
        >
          <p
            style={{
              fontSize: 'var(--text-base)',
              color: 'var(--color-text-tertiary)',
            }}
          >
            Coming soon
          </p>
        </div>
      )}
    </section>
  );
};

const PlaylistRow: FC<{ playlist: PlaylistSummary }> = ({ playlist }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: 'var(--space-3) var(--space-3)',
        background: isHovered ? 'var(--color-surface-2)' : 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        textAlign: 'left',
        transition: `background var(--duration-fast) var(--ease-out)`,
      }}
    >
      <span
        style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
          color: 'var(--color-text-primary)',
        }}
      >
        {playlist.title}
      </span>
      {playlist.trackCount !== undefined && (
        <span
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-tertiary)',
          }}
        >
          {playlist.trackCount} tracks
        </span>
      )}
    </button>
  );
};
