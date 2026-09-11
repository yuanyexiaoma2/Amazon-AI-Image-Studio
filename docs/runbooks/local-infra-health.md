# Runbook: Local infrastructure health

## Start

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis minio
```

Optional mail catcher:

```bash
docker compose -f infra/docker-compose.yml --profile mail up -d mailcatcher
```

## Health checks

```bash
# Postgres
docker exec studio-postgres pg_isready -U studio -d studio

# Redis
docker exec studio-redis redis-cli ping
# expect: PONG

# MinIO console
# open http://localhost:9001 (minioadmin / minioadmin)
curl -s -o /dev/null -w "%{http_code}" http://localhost:9000/minio/health/live
```

## App env

Copy `.env.example` → `.env` and keep secrets out of git.
