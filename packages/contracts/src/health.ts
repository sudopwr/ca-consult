import { z } from 'zod';

/**
 * The health payload is small on purpose, but it is a real contract: the web
 * app parses it with this schema, so a shape change breaks the build on both
 * sides rather than at runtime in a browser.
 */
export const healthStatusSchema = z.enum(['ok', 'degraded']);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

export const dependencyHealthSchema = z.object({
  name: z.string(),
  status: healthStatusSchema,
  detail: z.string().optional(),
});
export type DependencyHealth = z.infer<typeof dependencyHealthSchema>;

export const healthResponseSchema = z.object({
  status: healthStatusSchema,
  service: z.string(),
  version: z.string(),
  environment: z.string(),
  /** ISO-8601, always from the injected clock — never `new Date()` in a use case. */
  time: z.iso.datetime({ offset: true }),
  uptimeSeconds: z.number().nonnegative(),
  dependencies: z.array(dependencyHealthSchema),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
