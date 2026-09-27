import { createClient } from '@supabase/supabase-js';
import type { Session } from '@supabase/supabase-js';

/**
 * supabase-js is used for exactly one thing: the session.
 *
 * Sign in, refresh, sign out. Every piece of data in this app comes from the
 * Fastify API with the access token attached — the browser never queries the
 * database directly, so there is no second set of authorisation rules to keep
 * in step with the first.
 */
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  },
);

export async function signInWithGoogle(redirectTo = `${window.location.origin}/auth/callback`) {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  });
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export type { Session };
