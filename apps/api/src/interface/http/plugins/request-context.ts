import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';

/**
 * Every request gets an id, echoed on the response and attached to every log
 * line and every error body. When a user reports "it failed at 3pm", this is
 * what turns that into a single log query.
 */
export const requestContextPlugin = fp(async (app) => {
  app.addHook('onRequest', async (request, reply) => {
    const incoming = request.headers['x-request-id'];
    const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
    request.traceId = id;
    void reply.header('x-request-id', id);
  });
});

declare module 'fastify' {
  interface FastifyRequest {
    traceId: string;
  }
}
