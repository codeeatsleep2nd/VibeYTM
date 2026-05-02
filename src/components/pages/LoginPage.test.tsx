import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const ytmApi = {
  hideYtm: vi.fn().mockResolvedValue(undefined),
  showYtm: vi.fn().mockResolvedValue(undefined),
  injectBridge: vi.fn().mockResolvedValue(undefined),
  openSignIn: vi.fn().mockResolvedValue(undefined),
  navigateToHome: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../lib/ipc', () => ({ ytmApi }));
vi.mock('../../hooks/useTauriEvent', () => ({
  useTauriEvent: () => {},
}));

const { LoginPage } = await import('./LoginPage');

describe('LoginPage', () => {
  beforeEach(() => {
    Object.values(ytmApi).forEach((fn) => fn.mockClear());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('auto-opens the sign-in WebView on mount (kaset parity)', async () => {
    await act(async () => {
      render(<LoginPage onLoggedIn={() => {}} />);
    });

    expect(ytmApi.openSignIn).toHaveBeenCalledTimes(1);
    expect(ytmApi.showYtm).toHaveBeenCalledTimes(1);
    expect(ytmApi.injectBridge).toHaveBeenCalledTimes(1);

    // openSignIn must run before showYtm so the user never sees a flash of
    // music.youtube.com before Google takes over the auxiliary window.
    const openOrder = ytmApi.openSignIn.mock.invocationCallOrder[0];
    const showOrder = ytmApi.showYtm.mock.invocationCallOrder[0];
    expect(openOrder).toBeLessThan(showOrder);
  });

  it('"Reopen sign-in page" re-triggers the navigation', async () => {
    await act(async () => {
      render(<LoginPage onLoggedIn={() => {}} />);
    });
    ytmApi.openSignIn.mockClear();
    ytmApi.showYtm.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByText(/Reopen sign-in page/i));
    });

    expect(ytmApi.openSignIn).toHaveBeenCalledTimes(1);
    expect(ytmApi.showYtm).toHaveBeenCalledTimes(1);
  });

  it('"I\'m already signed in" hides the YTM window and notifies parent', async () => {
    const onLoggedIn = vi.fn();
    await act(async () => {
      render(<LoginPage onLoggedIn={onLoggedIn} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/I'm already signed in/i));
    });

    expect(ytmApi.hideYtm).toHaveBeenCalled();
    expect(onLoggedIn).toHaveBeenCalledTimes(1);
  });

  it('"Skip for now" navigates YTM to music home before transitioning', async () => {
    const onLoggedIn = vi.fn();
    await act(async () => {
      render(<LoginPage onLoggedIn={onLoggedIn} />);
    });
    ytmApi.hideYtm.mockClear();
    ytmApi.navigateToHome.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByText(/Skip for now/i));
    });

    // navigateToHome must run before onLoggedIn so AppShell fetches go
    // against a same-origin music.youtube.com bridge context.
    expect(ytmApi.navigateToHome).toHaveBeenCalledTimes(1);
    expect(ytmApi.hideYtm).toHaveBeenCalledTimes(1);
    expect(onLoggedIn).toHaveBeenCalledTimes(1);
  });

  it('renders the passkey hint copy', async () => {
    await act(async () => {
      render(<LoginPage onLoggedIn={() => {}} />);
    });

    expect(
      screen.getByText(/If passkeys don't work, use "Try another way"/i),
    ).toBeTruthy();
  });
});
