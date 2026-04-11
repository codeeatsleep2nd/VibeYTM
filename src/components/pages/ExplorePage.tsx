import { type FC, useState } from 'react';

interface GenreCard {
  name: string;
  color: string;
}

const GENRES: GenreCard[] = [
  { name: 'Pop', color: 'oklch(62% 0.22 330)' },
  { name: 'Rock', color: 'oklch(55% 0.18 30)' },
  { name: 'Hip-Hop', color: 'oklch(58% 0.20 280)' },
  { name: 'Electronic', color: 'oklch(65% 0.22 190)' },
  { name: 'R&B', color: 'oklch(50% 0.20 310)' },
  { name: 'Classical', color: 'oklch(55% 0.12 80)' },
  { name: 'Jazz', color: 'oklch(60% 0.16 60)' },
  { name: 'Country', color: 'oklch(58% 0.14 110)' },
];

export const ExplorePage: FC = () => (
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
      Explore
    </h1>

    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: 'var(--space-4)',
      }}
    >
      {GENRES.map((genre) => (
        <GenreCardItem key={genre.name} genre={genre} />
      ))}
    </div>
  </section>
);

const GenreCardItem: FC<{ genre: GenreCard }> = ({ genre }) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        height: '120px',
        background: genre.color,
        borderRadius: 'var(--radius-lg)',
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        filter: isHovered ? 'brightness(1.15)' : 'brightness(1)',
        transition: `filter var(--duration-fast) var(--ease-out)`,
      }}
    >
      <span
        style={{
          fontSize: 'var(--text-lg)',
          fontWeight: 700,
          color: 'oklch(100% 0 0)',
          textShadow: '0 1px 3px oklch(0% 0 0 / 0.3)',
        }}
      >
        {genre.name}
      </span>
    </button>
  );
};
