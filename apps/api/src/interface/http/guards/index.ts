import type { FastifyReply, FastifyRequest } from 'fastify';
import { Errors } from '../../../domain/shared/errors.js';
import type { UserProfile } from '../../../domain/user/user-profile.js';

/**
 * Four guards, composed in order of increasing demand:
 *
 *   requireAuth            → signed in at all
 *   requireCompleteProfile → has given name, phone and address
 *   requireEngagement      → holds a live booking or filing (messaging only)
 *   requireAdmin           → is the practitioner
 *
 * Each throws a DomainError, which the error handler maps to problem+json —
 * so a guard never has to know an HTTP status.
 */

export function requireAuth(request: FastifyRequest): UserProfile {
  if (!request.user) throw Errors.unauthenticated();
  if (request.user.status === 'BLOCKED') throw Errors.accountBlocked();
  return request.user;
}

export function requireCompleteProfile(request: FastifyRequest): UserProfile {
  const user = requireAuth(request);
  if (!user.profileCompletedAt) throw Errors.profileIncomplete();
  return user;
}

export function requireAdmin(request: FastifyRequest): UserProfile {
  const user = requireAuth(request);
  if (user.role !== 'ADMIN') throw Errors.forbidden();
  return user;
}

/** Fastify preHandler forms, for attaching to a route or a whole prefix. */
export async function authPreHandler(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  requireAuth(request);
}

export async function completeProfilePreHandler(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  requireCompleteProfile(request);
}

export async function adminPreHandler(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  requireAdmin(request);
}
