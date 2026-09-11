/** Definitive file validation failure — mark REJECTED, do not retry as success path. */
export class InspectValidationError extends Error {
  readonly definitive = true as const;
  constructor(message: string) {
    super(message);
    this.name = 'InspectValidationError';
  }
}

/** Transient infra failure — throw for worker retry; do not mark REJECTED. */
export class InspectTransientError extends Error {
  readonly definitive = false as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'InspectTransientError';
  }
}

export function isInspectValidationError(err: unknown): err is InspectValidationError {
  return err instanceof InspectValidationError;
}

export function isInspectTransientError(err: unknown): err is InspectTransientError {
  return err instanceof InspectTransientError;
}
