import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { ErrorCode } from '@ca/contracts';
import type { ProblemDetails } from '@ca/contracts';
import { isDomainError } from '../../../domain/shared/domain-error.js';

const PROBLEM_BASE = 'https://errors.ca-consult.app';

/**
 * Maps a domain error code to an HTTP status. This table is the one place
 * where the domain meets HTTP — which is why the domain layer itself never
 * imports a status code.
 */
const STATUS_BY_CODE: Record<string, number> = {
  [ErrorCode.VALIDATION_FAILED]: 400,
  [ErrorCode.UNAUTHENTICATED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.ACCOUNT_BLOCKED]: 403,
  [ErrorCode.PROFILE_INCOMPLETE]: 403,
  [ErrorCode.NO_ENGAGEMENT]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.SLOT_UNAVAILABLE]: 409,
  [ErrorCode.CANCEL_WINDOW_CLOSED]: 409,
  [ErrorCode.DUPLICATE_ENGAGEMENT]: 409,
  [ErrorCode.ENGAGEMENT_NOT_MODIFIABLE]: 409,
  [ErrorCode.BOOKING_LIMIT_REACHED]: 429,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.INTERNAL]: 500,
};

function slug(code: string): string {
  return `${PROBLEM_BASE}/${code.toLowerCase().replace(/_/g, '-')}`;
}

export const errorHandlerPlugin = fp(async (app) => {
  app.setNotFoundHandler((request, reply) => {
    const problem: ProblemDetails = {
      type: slug(ErrorCode.NOT_FOUND),
      title: 'Not found',
      status: 404,
      code: ErrorCode.NOT_FOUND,
      detail: `No route for ${request.method} ${request.url}`,
      traceId: request.traceId,
    };
    void reply.code(404).type('application/problem+json').send(problem);
  });

  app.setErrorHandler((error, request, reply) => {
    // 1. Request validation — report every bad field at once, not the first.
    if (error instanceof ZodError) {
      const problem: ProblemDetails = {
        type: slug(ErrorCode.VALIDATION_FAILED),
        title: 'The request could not be validated',
        status: 400,
        code: ErrorCode.VALIDATION_FAILED,
        traceId: request.traceId,
        errors: error.issues.map((i) => ({
          path: i.path.join('.') || '(root)',
          message: i.message,
        })),
      };
      return reply.code(400).type('application/problem+json').send(problem);
    }

    // 2. Expected domain failures.
    if (isDomainError(error)) {
      const status = STATUS_BY_CODE[error.code] ?? 400;
      const problem: ProblemDetails = {
        type: slug(error.code),
        title: error.message,
        status,
        code: error.code,
        traceId: request.traceId,
        ...(error.detail ? { detail: error.detail } : {}),
      };
      return reply.code(status).type('application/problem+json').send(problem);
    }

    // 3. Fastify's own errors (rate limit, malformed JSON, …).
    const fastifyStatus = typeof error.statusCode === 'number' ? error.statusCode : undefined;
    if (fastifyStatus && fastifyStatus < 500) {
      const code = fastifyStatus === 429 ? ErrorCode.RATE_LIMITED : ErrorCode.VALIDATION_FAILED;
      const problem: ProblemDetails = {
        type: slug(code),
        title: error.message,
        status: fastifyStatus,
        code,
        traceId: request.traceId,
      };
      return reply.code(fastifyStatus).type('application/problem+json').send(problem);
    }

    // 4. Anything else is a bug. Log it in full, tell the client nothing —
    //    an internal message can leak a table name, a query, or a key.
    request.log.error({ err: error, traceId: request.traceId }, 'unhandled error');
    const problem: ProblemDetails = {
      type: slug(ErrorCode.INTERNAL),
      title: 'Something went wrong on our side',
      status: 500,
      code: ErrorCode.INTERNAL,
      traceId: request.traceId,
    };
    return reply.code(500).type('application/problem+json').send(problem);
  });
});
