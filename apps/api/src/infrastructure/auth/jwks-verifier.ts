import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';

export interface VerifiedToken {
  readonly sub: string;
  readonly email: string;
  readonly fullName: string | null;
  readonly avatarUrl: string | null;
}

export interface JwtVerifier {
  verify(token: string): Promise<VerifiedToken>;
}

/**
 * Verifies Supabase access tokens offline.
 *
 * Supabase signs with asymmetric keys (ES256 by default), and publishes the
 * public half at /auth/v1/.well-known/jwks.json. `createRemoteJWKSet` fetches
 * and caches that set, so verification costs no network round trip per
 * request and the API never holds a signing secret.
 */
export class SupabaseJwtVerifier implements JwtVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;

  constructor(supabaseUrl: string) {
    const base = supabaseUrl.replace(/\/$/, '');
    this.issuer = `${base}/auth/v1`;
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`), {
      cacheMaxAge: 10 * 60 * 1000,
      cooldownDuration: 30_000,
    });
  }

  async verify(token: string): Promise<VerifiedToken> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.issuer,
      // Supabase sets aud to 'authenticated' for signed-in users.
      audience: 'authenticated',
    });

    return extractIdentity(payload);
  }
}

/**
 * Pulls the fields we care about out of the claims.
 *
 * Note what is NOT taken from here: the role. Putting `role: ADMIN` in the
 * token means revoking admin only takes effect on the next refresh, and makes
 * an SQL auth hook part of the authorisation path. We read the role from
 * `user_profiles` on each request instead — one indexed lookup we were doing
 * anyway, instantly revocable, and trivially fakeable in tests.
 */
export function extractIdentity(payload: JWTPayload): VerifiedToken {
  const metadata = (payload.user_metadata ?? {}) as Record<string, unknown>;

  const email =
    typeof payload.email === 'string'
      ? payload.email
      : typeof metadata.email === 'string'
        ? metadata.email
        : null;

  if (!payload.sub || !email) {
    throw new Error('token is missing sub or email');
  }

  const fullName =
    typeof metadata.full_name === 'string'
      ? metadata.full_name
      : typeof metadata.name === 'string'
        ? metadata.name
        : null;

  const avatarUrl =
    typeof metadata.avatar_url === 'string'
      ? metadata.avatar_url
      : typeof metadata.picture === 'string'
        ? metadata.picture
        : null;

  return { sub: payload.sub, email, fullName, avatarUrl };
}

/**
 * Local development and e2e: Supabase's local stack signs with a shared
 * secret rather than publishing a JWKS. Selected by the presence of
 * SUPABASE_JWT_SECRET, never in production.
 */
export class SharedSecretJwtVerifier implements JwtVerifier {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  async verify(token: string): Promise<VerifiedToken> {
    const { payload } = await jwtVerify(token, this.key);
    return extractIdentity(payload);
  }
}
