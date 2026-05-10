import type { FC, ReactNode } from 'react';

interface ShelfRowProps {
  title: string;
  children: ReactNode;
}

export const ShelfRow: FC<ShelfRowProps> = ({ title, children }) => (
  <section style={{ marginBottom: 'var(--space-10)' }}>
    <h2
      style={{
        fontSize: 'var(--text-display-sm)',
        fontWeight: 700,
        color: 'var(--color-text-primary)',
        marginBottom: 'var(--space-4)',
        letterSpacing: '-0.02em',
      }}
    >
      {title}
    </h2>
    {children}
  </section>
);
