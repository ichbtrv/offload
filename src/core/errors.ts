export const exitCodes = {
  INVALID_REQUEST: 2,
  PATH_DENIED: 3,
  FILE_UNSUPPORTED: 4,
  BUDGET_EXCEEDED: 5,
  PROVIDER_UNAVAILABLE: 6,
  MODEL_UNAVAILABLE: 7,
  TIMEOUT: 8,
  OUTPUT_INVALID: 9,
  OUTPUT_TRUNCATED: 10,
  SOURCE_CHANGED: 11,
  TARGET_CONFLICT: 12,
  REMOTE_NOT_AUTHORIZED: 13,
  AUTH_REQUIRED: 14,
  CLI_UNSUPPORTED: 15,
  WORKER_POLICY_UNSUPPORTED: 16,
  NESTED_INVOCATION_UNSUPPORTED: 17,
  CANCELLED: 18,
  BUSY: 19,
  INTERNAL_ERROR: 20,
} as const;

export type ErrorCode = keyof typeof exitCodes;

export class OffloadError extends Error {
  constructor(public readonly code: ErrorCode, message: string) {
    super(message);
    this.name = 'OffloadError';
  }
}

export function fail(code: ErrorCode, message: string): never {
  throw new OffloadError(code, message);
}

export function safeError(error: unknown): OffloadError {
  return error instanceof OffloadError
    ? error
    : new OffloadError('INTERNAL_ERROR', 'Operation failed; raw diagnostics were withheld because they may contain secrets.');
}
