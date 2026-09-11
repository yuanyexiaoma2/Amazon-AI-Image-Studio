import { z } from 'zod';
import { normalizeEmail } from '@studio/domain';

export { normalizeEmail };

/** Shared password rule for register AND change-password (min 12, max 128). */
export const PasswordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password must be at most 128 characters');

/** Normalize first (trim/NFKC/lower), then validate email — avoids rejecting spaced input. */
const NormalizedEmailSchema = z
  .string()
  .transform((v) => normalizeEmail(v))
  .pipe(z.string().email());

export const RegisterRequestSchema = z.object({
  email: NormalizedEmailSchema,
  password: PasswordSchema,
  name: z.string().min(1).max(120).optional(),
});

export const LoginRequestSchema = z.object({
  email: NormalizedEmailSchema,
  password: z.string().min(1),
});

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: PasswordSchema,
});

export const UserResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;
