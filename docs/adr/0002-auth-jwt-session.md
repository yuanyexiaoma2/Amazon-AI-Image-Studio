# ADR-0002: Auth.js Credentials with JWT Session + sessionVersion

- Status: Accepted
- Date: 2026-09-11
- Deciders: Project owner (approved architecture change) + implementing agent

## Context

Spec v1.1 preferred **database sessions** for Auth.js. Auth.js does **not** create
database sessions when using the **Credentials** provider (email/password MVP).
A pure DB-session strategy would leave Credentials logins without a session row.

We still need:
- Bounded session lifetime
- Server-side revocation on password change / reset / account disable
- Active/enabled checks on protected requests

## Decision

1. Use Auth.js **JWT session strategy** for MVP Credentials auth.
2. Set JWT `maxAge` = **24 hours**.
3. Add `User.sessionVersion` (Int, default `0`) to Prisma.
4. Embed `sessionVersion` in the JWT at login; protected handlers call
   `requireActiveSession()` which loads the user and rejects if:
   - user missing / soft-deleted
   - `status !== ACTIVE`
   - JWT `sessionVersion` ≠ DB `sessionVersion`
5. Increment `sessionVersion` on password change, password reset, and account disable
   (stub endpoints: `/api/account/change-password`, `/api/account/disable`).
6. Keep Prisma `sessions` / `accounts` tables for future OAuth and optional migration
   back to DB sessions.

This intentionally **deviates** from the v1.1 DB-session preference; documented in
`docs/architecture.md` and Change Request `docs/change-requests/CR-0001-jwt-session.md`.

## Consequences

### Positive
- Credentials login works with Auth.js.
- Revocation without storing every JWT server-side.
- Clear 24h lifetime.

### Risks
- Stolen JWT remains valid until expiry **or** `sessionVersion` bump / disable.
- Clock skew / multi-instance consistency depends on shared Postgres as source of truth.
- Silent drift if living docs are not updated (mitigated by ADR + architecture.md).

### Rollback
1. Introduce an OAuth (or magic-link) provider that supports DB sessions, **or**
   implement a custom session store that Auth.js Credentials can write to.
2. Switch `session.strategy` to `database`.
3. Stop embedding `sessionVersion` in JWT; optionally keep the column for audit.
4. Revert protected-route checks to session-row lookup.

## Alternatives considered

1. **DB sessions only** — rejected for Credentials (Auth.js limitation).
2. **JWT without sessionVersion** — rejected (no password-change revocation).
3. **Redis session blacklist** — deferred; `sessionVersion` is simpler for MVP.
