import { problemDetailsSchema } from '@ca/contracts';
import type { ProblemDetails } from '@ca/contracts';
import { getAccessToken } from '../auth/supabase';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

/**
 * Every failure reaches the UI as an ApiError carrying the API's problem+json
 * body, so components branch on `error.code` — never on a string match against
 * a message. That is what lets the booking form turn SLOT_UNAVAILABLE into a
 * refetch and a helpful sentence, while everything else falls through to the
 * generic handler.
 */
export class ApiError extends Error {
  constructor(
    readonly problem: ProblemDetails,
    readonly httpStatus: number,
  ) {
    super(problem.title);
    this.name = 'ApiError';
  }

  get code(): string {
    return this.problem.code;
  }

  get detail(): string | undefined {
    return this.problem.detail;
  }

  /** Field-level messages from a zod failure, keyed by path. */
  get fieldErrors(): Record<string, string> {
    const output: Record<string, string> = {};
    for (const issue of this.problem.errors ?? []) output[issue.path] = issue.message;
    return output;
  }
}

function networkError(cause: unknown): ApiError {
  return new ApiError(
    {
      type: 'about:blank',
      title: 'Could not reach the server',
      status: 0,
      code: 'NETWORK_ERROR',
      detail: cause instanceof Error ? cause.message : undefined,
    },
    0,
  );
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Set on booking and registration so a retry cannot create a duplicate. */
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Public endpoints skip the token lookup entirely. */
  anonymous?: boolean;
}

export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  if (!options.anonymous) {
    const token = await getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (cause) {
    throw networkError(cause);
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = problemDetailsSchema.safeParse(payload);
    throw new ApiError(
      parsed.success
        ? parsed.data
        : {
            type: 'about:blank',
            title: response.statusText || 'Request failed',
            status: response.status,
            code: 'INTERNAL',
          },
      response.status,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
};
