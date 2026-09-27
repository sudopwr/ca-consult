import type { FastifyInstance } from 'fastify';
import type { GetHealth } from '../../../application/use-cases/get-health.js';

export interface HealthRoutesDeps {
  getHealth: GetHealth;
}

/**
 * Routes are thin: parse, call one use case, map the result to a status.
 * No business logic lives here, which is why the route file stays this short
 * even in slice 6.
 */
export async function registerHealthRoutes(
  app: FastifyInstance,
  deps: HealthRoutesDeps,
): Promise<void> {
  // Liveness — is the process up at all. Never touches a dependency, so an
  // orchestrator never restarts a healthy pod because the database blinked.
  app.get('/health/live', async () => ({ status: 'ok' as const }));

  // Readiness — is it fit to serve traffic. Degraded dependencies surface as
  // 503 so a load balancer can act on it, but the body is always the full report.
  app.get('/health', async (_request, reply) => {
    const report = await deps.getHealth.execute();
    return reply.code(report.status === 'ok' ? 200 : 503).send(report);
  });
}
