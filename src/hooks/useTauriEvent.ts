import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export function useTauriEvent<T>(
  eventName: string,
  handler: (payload: T) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    listen<T>(eventName, (event) => {
      handlerRef.current(event.payload);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    }).catch(() => {
      // Not running inside Tauri — ignore
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [eventName]);
}
