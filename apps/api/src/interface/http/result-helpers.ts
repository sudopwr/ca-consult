import type { Result } from '../../domain/shared/result.js';
import type { DomainError } from '../../domain/shared/domain-error.js';

/**
 * Use cases return `Result` because expected failures are values, not
 * exceptions. Routes want the happy path inline, and Fastify's error handler
 * already knows how to turn a DomainError into problem+json — so this is the
 * one place the two conventions meet.
 */
export function unwrapOrThrow<T>(result: Result<T, DomainError>): T {
  if (!result.ok) throw result.error;
  return result.value;
}
