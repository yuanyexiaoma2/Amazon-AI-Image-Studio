# Runbook — Backup / restore / app rollback (W8-05)

**Environment:** Local / Staging Fake. **No Production keys.**

## Postgres backup (logical)

```bash
# From compose network or host with DATABASE_URL
pg_dump "$DATABASE_URL" --format=custom --file="studio-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

## Postgres restore (drill)

```bash
# Prefer restore into a scratch DB first
createdb studio_restore_drill
pg_restore --clean --if-exists --dbname="$RESTORE_DATABASE_URL" studio-YYYYMMDD.dump
pnpm db:migrate:deploy   # ensure migrations match dump schema epoch
```

## Object storage (MinIO / S3)

```bash
# Example: mirror bucket to a dated prefix (aws cli compatible)
aws --endpoint-url "$S3_ENDPOINT" s3 sync "s3://$S3_BUCKET" "./backup-s3-$(date -u +%Y%m%d)/"
```

## Application rollback (≤30 minutes target)

1. Identify previous known-good image / git SHA on Staging.
2. Redeploy previous release artifact (container tag or `git checkout <sha> && pnpm build && restart`).
3. **Do not** rewind Postgres with incomplete dumps if newer migrations already applied — prefer forward-fix or restore drill DB.
4. Rule/model activation rollback is **activation switch only** (spec §32.13); historical runs keep snapshots.

## Evidence notes (Phase 1 Fake drill)

| Step | Result | Notes |
|---|---|---|
| `pg_dump` dry-run syntax | Documented | Script stub: `scripts/backup-restore-drill.sh` |
| Worker restart mid-batch | Covered by W4/W7 Fake billing tests + W8-03 unique jobIds | No double-settle when jobId stable |
| App version rollback | Documented | Staging procedure only |

Optional stub: `scripts/backup-restore-drill.sh`.
