/**
 * Expected failures are values, not exceptions. A use case that can fail in a
 * way the caller must handle returns `Result`; only genuinely unexpected
 * conditions throw.
 */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok(): Result<void, never>;
export function ok<T>(value: T): Result<T, never>;
export function ok<T>(value?: T): Result<T | void, never> {
  return { ok: true, value: value as T };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return !r.ok;
}

/** Narrowing helper for the places where a failure really is impossible. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (!r.ok) {
    throw new Error(`unwrap() on an error result: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}
