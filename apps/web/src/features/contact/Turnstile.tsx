import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

declare global {
  interface Window {
    turnstile?: {
      render(element: HTMLElement, options: Record<string, unknown>): string;
      remove(widgetId: string): void;
    };
  }
}

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
  if (existing) {
    return new Promise((resolve) => existing.addEventListener('load', () => resolve()));
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Turnstile failed to load'));
    document.head.appendChild(script);
  });
}

/**
 * Cloudflare Turnstile, loaded lazily and rendered explicitly.
 *
 * If the site key is unset — local development, or a deployment that has not
 * set up Cloudflare — this renders nothing and the form still works. The
 * server treats a missing token the same way: the honeypot, dwell time and IP
 * rate limit are still in force, so the form degrades rather than breaking.
 */
export function Turnstile({ onToken }: { onToken: (token: string) => void }): React.ReactElement | null {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY || !containerRef.current) return;

    let cancelled = false;

    void loadScript()
      .then(() => {
        if (cancelled || !window.turnstile || !containerRef.current) return;

        widgetId.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (token: string) => onToken(token),
          'error-callback': () => onToken(''),
          'expired-callback': () => onToken(''),
          theme: 'light',
        });
      })
      .catch(() => {
        // Cloudflare unreachable. The other three defences still apply.
        onToken('');
      });

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
    };
  }, [onToken]);

  if (!SITE_KEY) return null;

  return <Box ref={containerRef} sx={{ minHeight: 65 }} />;
}
