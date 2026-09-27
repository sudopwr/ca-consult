/**
 * The narrow slice of `pg` that repositories are allowed to see.
 *
 * Repositories are constructed with a Querier rather than a Pool, which is
 * what lets the unit of work hand them a transaction-bound client instead:
 * the repository code is identical inside and outside a transaction, and no
 * repository can accidentally reach for a fresh connection mid-transaction.
 */
export interface Querier {
  /**
   * `R` is constrained to `object` rather than `Record<string, unknown>` so
   * that repositories can declare precise row interfaces. A named interface
   * has no index signature, and requiring one would force every row type to be
   * loosened to `Record<string, unknown>` — losing exactly the checking the
   * mappers depend on.
   */
  query<R extends object = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

/** Postgres SQLSTATEs the repositories translate into domain-level errors. */
export const PG_ERROR = {
  UNIQUE_VIOLATION: '23505',
  EXCLUSION_VIOLATION: '23P01',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
} as const;

export interface PgError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
}

export function isPgError(error: unknown, code: string, constraint?: string): error is PgError {
  if (!error || typeof error !== 'object') return false;
  const pg = error as PgError;
  if (pg.code !== code) return false;
  return constraint ? pg.constraint === constraint : true;
}

/** Build a `WHERE` fragment and its parameters without hand-counting $n. */
export class SqlBuilder {
  private readonly clauses: string[] = [];
  readonly params: unknown[] = [];

  where(fragment: string, ...values: unknown[]): this {
    let index = 0;
    const rendered = fragment.replace(/\?/g, () => {
      this.params.push(values[index++]);
      return `$${this.params.length}`;
    });
    this.clauses.push(rendered);
    return this;
  }

  whereIf(condition: unknown, fragment: string, ...values: unknown[]): this {
    if (condition !== undefined && condition !== null && condition !== '') {
      this.where(fragment, ...values);
    }
    return this;
  }

  build(): string {
    return this.clauses.length > 0 ? `where ${this.clauses.join(' and ')}` : '';
  }

  /** Appends a value and returns its placeholder, for LIMIT/OFFSET. */
  param(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }
}
