import type { FC, ReactNode } from 'react';

interface ShelfRowProps {
  title: string;
  children: ReactNode;
}

export const ShelfRow: FC<ShelfRowProps> = ({ title, children }) => (
  <section style={{ marginBottom: 'var(--space-8)' }}>
    <h2
      style={{
        fontSize: 'var(--text-lg)',
        fontWeight: 600,
        color: 'var(--color-text-primary)',
        marginBottom: 'var(--space-4)',
        letterSpacing: '-0.01em',
      }}
    >
      {title}
    </h2>
    {children}
  </section>
);
