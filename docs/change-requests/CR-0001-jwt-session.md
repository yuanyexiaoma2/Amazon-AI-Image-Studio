# CR-0001: JWT Session + sessionVersion (deviation from v1.1 DB sessions)

- Status: Approved by product owner
- Date: 2026-09-11
- Related ADR: `docs/adr/0002-auth-jwt-session.md`

## Summary

MVP auth uses **Auth.js Credentials + JWT Session** instead of the v1.1 preferred
database session strategy, with compensating controls:

| Control | Implementation |
|---|---|
| Session lifetime | JWT `maxAge` = 24h |
| Revocation | `User.sessionVersion` bumped on password change/reset/disable |
| Active check | `requireActiveSession()` on protected APIs |
| Documentation | ADR-0002 + `docs/architecture.md` (no silent drift) |

## Why

Auth.js Credentials provider does not create DB sessions. Blocking W1 on OAuth-only
auth would delay tenant/project APIs.

## Rollback

See ADR-0002 Rollback section.
