import fp from 'fastify-plugin';
import type { UserProfile } from '../../../domain/user/user-profile.js';
import type { UserRepository } from '../../../application/ports/user-repository.js';
import type { JwtVerifier } from '../../../infrastructure/auth/jwks-verifier.js';

export interface AuthPluginOptions {
  verifier: JwtVerifier;
  users: UserRepository;
}

/**
 * Attaches the caller's profile to every request that carries a valid token.
 *
 * This hook never rejects. A missing or bad token simply leaves `request.user`
 * null, and the guards decide whether that matters — which is what lets the
 * public routes and the authenticated ones share one pipeline.
 *
 * The profile is provisioned on first sight rather than by a signup webhook,
 * so there is no window in which a valid token has no row behind it.
 */
export const authPlugin = fp<AuthPluginOptions>(async (app, options) => {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;

    const token = header.slice('Bearer '.length).trim();
    if (!token) return;

    try {
      const identity = await options.verifier.verify(token);

      request.user = await options.users.findOrProvision({
        id: identity.sub,
        email: identity.email,
        fullName: identity.fullName,
        avatarUrl: identity.avatarUrl,
      });
    } catch (error) {
      // An expired or forged token is indistinguishable from none at all as
      // far as this hook is concerned. Logged at debug so a genuine
      // misconfiguration is still visible without filling the log with noise
      // from expired sessions.
      request.log.debug({ err: error }, 'token rejected');
    }
  });
});

declare module 'fastify' {
  interface FastifyRequest {
    user: UserProfile | null;
  }
}
