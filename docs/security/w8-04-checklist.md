# W8-04 — Security checklist (Fake / Staging Phase 1)

**Date:** 2026-09-12 (Asia/Shanghai)  
**No Production keys.** Fake Provider only (ADR-0003).

| # | Control | Automated | Evidence |
|---|---|---|---|
| 1 | **Authz / tenant isolation** | YES | Domain role matrix `packages/domain/tests/security-authz.test.ts`; existing integration role tests (`truth-pack-roles`, `shot-plan-roles`); APIs use `requireWorkspaceMember` / `requireWorkspaceRoles` → 403 cross-workspace |
| 2 | **Signed URLs finite TTL** | YES | `packages/storage/tests/signed-url.test.ts`; domain `PRESIGN_TTL_SECONDS` = 15m; download-url routes pass `expiresInSeconds` |
| 3 | **Upload SSRF refusal** | YES | `packages/domain/tests/ssrf.test.ts` + complete route rejects `sourceUrl`/`fetchUrl`/`url`/`remoteUrl` via `refuseExternalFetchUrl` (presign path is PUT-only, never server-fetches) |
| 4 | **Webhook signature fail** | YES | `packages/providers/tests/webhook-sig-security.test.ts` (+ prior `fake-adapter` tests) — missing/bad HMAC → `ProviderAdapterError` |
| 5 | **Log redaction** | YES | `packages/config` pino `redact` paths + `redactSensitiveFields`; `packages/config/tests/logger-redact.test.ts` |

## Manual / Staging notes (no secrets in repo)

- [ ] Confirm Staging `AUTH_SECRET` ≥32 chars from secret store (not `.env` in git).
- [ ] Confirm webhook secret only in env / secret manager.
- [ ] Spot-check that application logs never print raw JWT / passwords.
- [ ] Cross-tenant curl: member of WS-A cannot read WS-B project (expect 403).

## Non-goals this milestone

- Penetration test report, WAF rules, Production KMS — deferred to release hardening with ops.
