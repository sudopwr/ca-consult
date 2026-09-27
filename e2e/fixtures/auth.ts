import { SignJWT } from 'jose';
import type { Page } from '@playwright/test';

/**
 * Real Google OAuth cannot be scripted reliably — Google actively blocks
 * automated browsers, and a test that depends on it is a test that will fail
 * on a Tuesday for reasons nobody can reproduce.
 *
 * So the fixture mints a session against the local Supabase stack's shared
 * JWT secret and writes it into localStorage, exactly where supabase-js keeps
 * it. Everything downstream — the API's token verification, the guards, the
 * role lookup — runs for real.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long';

/** Matches the ids in supabase/seed.sql. */
export const SEEDED = {
  admin: {
    id: '00000000-0000-4000-a000-000000000001',
    email: 'admin@ca-consult.test',
    name: 'S. Mehta',
  },
  client: {
    id: '00000000-0000-4000-a000-000000000002',
    email: 'client@ca-consult.test',
    name: 'Ananya Rao',
  },
} as const;

export async function mintAccessToken(user: {
  id: string;
  email: string;
  name: string;
}): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);

  return new SignJWT({
    email: user.email,
    phone: '',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: user.name, email: user.email },
    role: 'authenticated',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(secret);
}

/** The key supabase-js uses, derived from the project ref in the URL. */
function storageKey(): string {
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0] ?? 'local';
  return `sb-${ref}-auth-token`;
}

export async function signInAs(
  page: Page,
  who: keyof typeof SEEDED,
  baseUrl: string,
): Promise<void> {
  const user = SEEDED[who];
  const accessToken = await mintAccessToken(user);

  const session = {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 7200,
    expires_at: Math.floor(Date.now() / 1000) + 7200,
    refresh_token: 'e2e-refresh-token',
    user: {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { full_name: user.name, email: user.email },
      created_at: new Date().toISOString(),
    },
  };

  // The session has to be in place before the app's first render, or the
  // AuthProvider will have already decided the visitor is anonymous.
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key as string, value as string);
    },
    [storageKey(), JSON.stringify(session)] as const,
  );

  await page.goto(baseUrl);
}
