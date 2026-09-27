import pg from 'pg';
import type { Querier } from './querier.js';

/**
 * Postgres returns `timestamptz` as a string by default in some
 * configurations; node-postgres parses it into a Date, which is what the
 * repositories expect. `bigint` (int8) is a different matter: node-postgres
 * returns it as a string to avoid silent precision loss, and every bigint in
 * this schema is either money in paise or a count — both comfortably inside
 * Number.MAX_SAFE_INTEGER — so parsing them to numbers is safe and saves a
 * conversion in every mapper.
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number.parseInt(value, 10));

export interface PoolConfig {
  connectionString: string;
  max?: number;
  ssl?: boolean;
}

export function createPool(config: PoolConfig): pg.Pool {
  return new pg.Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Supabase's pooler terminates TLS with its own certificate chain.
    ...(config.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
}

export type { Querier };
export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
