import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { requestContextPlugin } from './plugins/request-context.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { authPlugin } from './plugins/auth.js';
import { registerHealthRoutes } from './routes/health.routes.js';
import { registerPublicRoutes } from './routes/public.routes.js';
import { registerMeRoutes } from './routes/me.routes.js';
import { registerBookingRoutes } from './routes/booking.routes.js';
import { registerAdminRoutes } from './routes/admin.routes.js';
import type { AppDeps } from './dependencies.js';
import type { JwtVerifier } from '../../infrastructure/auth/jwks-verifier.js';

export const API_PREFIX = '/api/v1';

export interface ServerOptions {
  deps: AppDeps;
  verifier: JwtVerifier;
  webOrigin: string;
  logLevel: string;
  isTest: boolean;
}

/**
 * `buildServer` returns a configured instance without listening on a port,
 * which is what lets every route test run through `app.inject()` — real
 * plugins, real error handler, real serialisation, no sockets.
 */
export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.isTest ? false : { level: options.logLevel },
    disableRequestLogging: options.isTest,
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  await app.register(requestContextPlugin);
  await app.register(errorHandlerPlugin);

  await app.register(cors, {
    origin: [options.webOrigin],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['x-request-id'],
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // The platform polls health; rate-limiting it would cause the outage the
    // probe exists to detect.
    allowList: (request) => request.url.startsWith(`${API_PREFIX}/health`),
  });

  await app.register(authPlugin, {
    verifier: options.verifier,
    users: options.deps.uow.repos.users,
  });

  await app.register(
    async (instance) => {
      await registerHealthRoutes(instance, { getHealth: options.deps.getHealth });
      await registerPublicRoutes(instance, options.deps);
      await registerMeRoutes(instance, options.deps);
      await registerBookingRoutes(instance, options.deps);

      // Admin routes are registered in their own encapsulated scope so the
      // prefix-wide requireAdmin hook cannot leak onto anything else.
      await instance.register(async (adminScope) => {
        await registerAdminRoutes(adminScope, options.deps);
      });
    },
    { prefix: API_PREFIX },
  );

  return app;
}
