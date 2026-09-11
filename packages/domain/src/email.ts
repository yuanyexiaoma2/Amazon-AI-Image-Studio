/**
 * Canonical email normalization for register, lookup, and login.
 *
 * Steps (documented):
 * 1. trim whitespace
 * 2. Unicode normalize NFKC
 * 3. case-fold via toLowerCase()
 */
export function normalizeEmail(email: string): string {
  return email.trim().normalize('NFKC').toLowerCase();
}
