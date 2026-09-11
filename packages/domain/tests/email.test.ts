import { describe, expect, it } from 'vitest';
import { normalizeEmail } from '../src/email.js';

describe('normalizeEmail', () => {
  it('trims leading and trailing spaces', () => {
    expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
  });

  it('case-folds ASCII email', () => {
    expect(normalizeEmail('User@Example.COM')).toBe('user@example.com');
  });

  it('applies NFKC unicode normalize then lowercases', () => {
    // Fullwidth Latin 'Ａ' (U+FF21) → 'A' under NFKC, then lowercased
    expect(normalizeEmail('\uFF21BC@Example.com')).toBe('abc@example.com');
  });

  it('combines trim + case-fold', () => {
    expect(normalizeEmail('  Foo.Bar+tag@Example.COM\t')).toBe('foo.bar+tag@example.com');
  });
});
