import { describe, expect, it } from 'vitest';
import {
  ChangePasswordRequestSchema,
  PasswordSchema,
  RegisterRequestSchema,
  normalizeEmail,
} from '../src/auth.js';

describe('PasswordSchema (shared register + change-password)', () => {
  it('rejects 11 characters', () => {
    const r = PasswordSchema.safeParse('abcdefghijk'); // 11
    expect(r.success).toBe(false);
  });

  it('accepts 12 characters', () => {
    const r = PasswordSchema.safeParse('abcdefghijkl'); // 12
    expect(r.success).toBe(true);
  });

  it('rejects over 128 characters', () => {
    const r = PasswordSchema.safeParse('a'.repeat(129));
    expect(r.success).toBe(false);
  });

  it('accepts 128 characters', () => {
    const r = PasswordSchema.safeParse('a'.repeat(128));
    expect(r.success).toBe(true);
  });
});

describe('RegisterRequestSchema uses PasswordSchema + normalizeEmail', () => {
  it('rejects password of 11 chars', () => {
    const r = RegisterRequestSchema.safeParse({
      email: 'a@b.co',
      password: '12345678901', // 11
    });
    expect(r.success).toBe(false);
  });

  it('accepts password of 12 chars and normalizes email', () => {
    const r = RegisterRequestSchema.safeParse({
      email: '  Admin@Example.COM ',
      password: '123456789012', // 12
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe('admin@example.com');
      expect(r.data.password).toBe('123456789012');
    }
  });
});

describe('ChangePasswordRequestSchema shares PasswordSchema', () => {
  it('rejects newPassword of 11 chars', () => {
    const r = ChangePasswordRequestSchema.safeParse({
      currentPassword: 'old-password-here',
      newPassword: 'shortpass11', // 11
    });
    expect(r.success).toBe(false);
  });

  it('accepts newPassword of 12 chars', () => {
    const r = ChangePasswordRequestSchema.safeParse({
      currentPassword: 'old-password-here',
      newPassword: 'newpassword1', // 12
    });
    expect(r.success).toBe(true);
  });
});

describe('normalizeEmail re-export', () => {
  it('case and spaces', () => {
    expect(normalizeEmail('  X@Y.COM ')).toBe('x@y.com');
  });
});
