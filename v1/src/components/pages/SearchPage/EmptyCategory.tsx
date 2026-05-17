import { type FC } from 'react';

/**
 * "No <label> found" placeholder rendered when a category-specific
 * search returns zero results. Centered vertically inside the empty
 * results area so it doesn't anchor to the top edge.
 */
export const EmptyCategory: FC<{ label: string }> = ({ label }) => (
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
      No {label} found
    </p>
  </div>
);
