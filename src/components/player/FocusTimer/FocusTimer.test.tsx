import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const notificationApi = {
  show: vi.fn().mockResolvedValue(undefined),
};
vi.mock('../../../lib/ipc', () => ({ notificationApi }));

vi.mock('../../overlay/SafeOverlay', () => ({
  SafeOverlay: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) =>
    isOpen ? <div data-testid="safe-overlay">{children}</div> : null,
  useOverlayOpen: () => true,
}));

vi.mock('@liquidglass/react', () => ({
  LiquidGlass: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { FocusTimer } = await import('./index');

describe('FocusTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    notificationApi.show.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('idle: slider sets the readout, Start latches running', () => {
    render(<FocusTimer isOpen onClose={() => {}} />);

    fireEvent.change(screen.getByRole('slider'), {
      target: { value: String(5 * 60) },
    });
    expect(screen.getByText('05:00')).toBeTruthy();

    fireEvent.click(screen.getByText(/^start$/i));
    expect(screen.getByText(/^reset$/i)).toBeTruthy();
  });

  it('running: hits zero, fires notification, transitions to done', async () => {
    render(<FocusTimer isOpen onClose={() => {}} />);
    fireEvent.change(screen.getByRole('slider'), {
      target: { value: String(5 * 60) },
    });
    fireEvent.click(screen.getByText(/^start$/i));

    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });

    expect(notificationApi.show).toHaveBeenCalledTimes(1);
    expect(notificationApi.show).toHaveBeenCalledWith(
      'Focus session complete',
      'You made it, time to take a break.',
    );
    expect(screen.getByText(/^done$/i)).toBeTruthy();
    expect(screen.getByText('00:00')).toBeTruthy();
  });

  it('Reset button calls onClose — parent gates the confirmation', () => {
    const onClose = vi.fn();
    render(<FocusTimer isOpen onClose={onClose} />);
    fireEvent.click(screen.getByText(/^start$/i));

    fireEvent.click(screen.getByText(/^reset$/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('has no in-page close affordance — exit goes through the chrome toggle', () => {
    render(<FocusTimer isOpen onClose={() => {}} />);
    // No "Close focus timer" button exists on the page itself.
    expect(screen.queryByLabelText(/close focus timer/i)).toBeNull();
  });

  it('reports state transitions via onStateChange', async () => {
    const onStateChange = vi.fn();
    render(
      <FocusTimer isOpen onClose={() => {}} onStateChange={onStateChange} />,
    );
    // Initial idle on mount
    expect(onStateChange).toHaveBeenCalledWith('idle');

    fireEvent.change(screen.getByRole('slider'), {
      target: { value: String(5 * 60) },
    });
    fireEvent.click(screen.getByText(/^start$/i));
    expect(onStateChange).toHaveBeenCalledWith('running');

    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });
    expect(onStateChange).toHaveBeenCalledWith('done');
  });

  it('done view: Close calls onClose without any internal modal', async () => {
    const onClose = vi.fn();
    render(<FocusTimer isOpen onClose={onClose} />);
    fireEvent.change(screen.getByRole('slider'), {
      target: { value: String(5 * 60) },
    });
    fireEvent.click(screen.getByText(/^start$/i));
    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000);
    });
    fireEvent.click(screen.getByText(/^close$/i));
    expect(onClose).toHaveBeenCalledTimes(1);
    // No "Reset focus session?" copy should appear inside the component.
    expect(
      screen.queryByText(/closing this page will reset the countdown/i),
    ).toBeNull();
  });
});
