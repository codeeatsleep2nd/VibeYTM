import { type FC } from 'react';

/**
 * Centered tertiary-color text used for the queue's empty/loading
 * states ("Loading queue…", "No upcoming tracks", etc.). Centered so it
 * sits as a single visual anchor in an otherwise empty list.
 */
export const QueuePlaceholder: FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      padding: 'var(--space-4) var(--space-3)',
      fontSize: 'var(--text-sm)',
      color: 'var(--color-text-tertiary)',
      textAlign: 'center',
    }}
  >
    {text}
  </div>
);
