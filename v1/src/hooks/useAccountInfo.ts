import { useEffect, useState } from 'react';
import { playerApi } from '../lib/ipc';
import type { AccountInfo } from '../lib/types';
import { useTauriEvent } from './useTauriEvent';

export function useAccountInfo(): AccountInfo | null {
  const [account, setAccount] = useState<AccountInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    playerApi
      .getAccountInfo()
      .then((info) => {
        if (!cancelled) setAccount(info);
      })
      .catch(() => {
        // Not fatal — the event listener will pick it up once scraped.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useTauriEvent<AccountInfo | null>('player:account-changed', (info) => {
    // Null payload means "signed out" — clear the sidebar avatar and name
    // so stale info doesn't linger after the user logs out (issue #37).
    setAccount(info);
  });

  return account;
}
