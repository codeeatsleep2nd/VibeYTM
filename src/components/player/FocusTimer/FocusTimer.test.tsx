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

// The 2026-05-09 redesign replaced the duration slider with five
// preset chips (15 / 25 / 45 / 60 / 90 minutes) and added a circular
// progress ring around the time. These tests drive duration changes
// via the chip aria-labels instead of the old slider, and pick 15 min
// as the test duration since it's the smallest preset.
describe('FocusTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    notificationApi.show.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('idle: clicking the 15-minute chip sets the readout, Start latches running', () => {
    render(<FocusTimer isOpen onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: '15 minutes' }));
    expect(screen.getByText('15:00')).toBeTruthy();

    fireEvent.click(screen.getByText(/^start$/i));
    expect(screen.getByText(/^reset$/i)).toBeTruthy();
  });

  it('running: hits zero, fires notification, transitions to done', async () => {
    render(<FocusTimer isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '15 minutes' }));
    fireEvent.click(screen.getByText(/^start$/i));

    await act(async () => {
      vi.advanceTimersByTime(15 * 60 * 1000);
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

    fireEvent.click(screen.getByRole('button', { name: '15 minutes' }));
    fireEvent.click(screen.getByText(/^start$/i));
    expect(onStateChange).toHaveBeenCalledWith('running');

    await act(async () => {
      vi.advanceTimersByTime(15 * 60 * 1000);
    });
    expect(onStateChange).toHaveBeenCalledWith('done');
  });

  it('done view: Close calls onClose without any internal modal', async () => {
    const onClose = vi.fn();
    render(<FocusTimer isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '15 minutes' }));
    fireEvent.click(screen.getByText(/^start$/i));
    await act(async () => {
      vi.advanceTimersByTime(15 * 60 * 1000);
    });
    fireEvent.click(screen.getByText(/^close$/i));
    expect(onClose).toHaveBeenCalledTimes(1);
    // No "Reset focus session?" copy should appear inside the component.
    expect(
      screen.queryByText(/closing this page will reset the countdown/i),
    ).toBeNull();
  });

  it('active chip is announced via aria-pressed; running disables chips', () => {
    render(<FocusTimer isOpen onClose={() => {}} />);
    // Default duration is 25 min — that chip should be pressed at mount.
    expect(
      screen.getByRole('button', { name: '25 minutes' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: '15 minutes' }).getAttribute('aria-pressed'),
    ).toBe('false');

    // Switch to 45.
    fireEvent.click(screen.getByRole('button', { name: '45 minutes' }));
    expect(
      screen.getByRole('button', { name: '45 minutes' }).getAttribute('aria-pressed'),
    ).toBe('true');

    // Start running — chips should disable.
    fireEvent.click(screen.getByText(/^start$/i));
    expect(
      (screen.getByRole('button', { name: '15 minutes' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: '90 minutes' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
