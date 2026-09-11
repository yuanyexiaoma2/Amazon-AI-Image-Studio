import { z } from 'zod';

/** Unified API error envelope (spec-aligned). */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export function makeApiError(
  code: string,
  message: string,
  requestId: string,
  details?: unknown,
): ApiError {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details !== undefined ? { details } : {}),
    },
  };
}
