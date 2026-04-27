import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContextMenu, type ContextMenuSection } from './ContextMenu';

describe('ContextMenu', () => {
  const buildSections = (handlers: { play?: () => void; remove?: () => void } = {}): ContextMenuSection[] => [
    {
      id: 'main',
      items: [
        { id: 'play', label: 'Play', onActivate: handlers.play ?? (() => {}) },
        {
          id: 'remove',
          label: 'Remove from queue',
          destructive: true,
          onActivate: handlers.remove ?? (() => {}),
        },
      ],
    },
  ];

  it('renders all items', () => {
    render(
      <ContextMenu
        position={{ x: 100, y: 100 }}
        sections={buildSections()}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Play')).toBeInTheDocument();
    expect(screen.getByText('Remove from queue')).toBeInTheDocument();
  });

  it('activates an item on click and closes', async () => {
    const onPlay = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        position={{ x: 100, y: 100 }}
        sections={buildSections({ play: onPlay })}
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByText('Play'));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <ContextMenu
        position={{ x: 100, y: 100 }}
        sections={buildSections()}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('arrow-down moves highlight + Enter activates', () => {
    const onPlay = vi.fn();
    const onRemove = vi.fn();
    render(
      <ContextMenu
        position={{ x: 100, y: 100 }}
        sections={buildSections({ play: onPlay, remove: onRemove })}
        onClose={() => {}}
      />,
    );
    // Initial highlight is item 0 (Play).
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('skips disabled items during arrow navigation', () => {
    const onActive = vi.fn();
    const sections: ContextMenuSection[] = [
      {
        id: 'main',
        items: [
          { id: 'a', label: 'A', onActivate: () => {} },
          { id: 'b', label: 'B', disabled: true, onActivate: () => {} },
          { id: 'c', label: 'C', onActivate: onActive },
        ],
      },
    ];
    render(
      <ContextMenu
        position={{ x: 100, y: 100 }}
        sections={sections}
        onClose={() => {}}
      />,
    );
    // From A, ArrowDown should skip B and land on C.
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onActive).toHaveBeenCalledTimes(1);
  });

  it('does not activate disabled items on click', async () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const sections: ContextMenuSection[] = [
      {
        id: 'main',
        items: [
          { id: 'd', label: 'Disabled', disabled: true, onActivate },
        ],
      },
    ];
    render(
      <ContextMenu
        position={{ x: 100, y: 100 }}
        sections={sections}
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByText('Disabled'));
    expect(onActivate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
