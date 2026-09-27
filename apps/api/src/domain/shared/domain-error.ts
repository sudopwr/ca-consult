/**
 * A failure the domain knows about and the API can translate into a specific
 * HTTP status. The `code` is the contract; the message is for humans.
 *
 * Note the direction of the dependency: the domain does not know about HTTP.
 * The mapping from `code` to status lives in the interface layer.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly detail: string | undefined;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.detail = detail;
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}
