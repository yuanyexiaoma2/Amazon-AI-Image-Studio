#!/usr/bin/env node
/**
 * CI health probes for Postgres, Redis, and MinIO before migrate/tests.
 */
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

function parseRedis(url) {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 6379) };
}

function parsePg(url) {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 5432) };
}

async function tcpOk(host, port, label, retries = 30) {
  for (let i = 0; i < retries; i++) {
    const ok = await new Promise((resolve) => {
      const socket = net.connect({ host, port }, () => {
        socket.end();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
      socket.setTimeout(2000, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ok) {
      console.log(`HEALTH OK: ${label} ${host}:${port}`);
      return;
    }
    await sleep(1000);
  }
  console.error(`HEALTH FAIL: ${label} ${host}:${port}`);
  process.exit(1);
}

async function httpOk(url, label, retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log(`HEALTH OK: ${label} ${url} status=${res.status}`);
        return;
      }
    } catch {
      // retry
    }
    await sleep(1000);
  }
  console.error(`HEALTH FAIL: ${label} ${url}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://studio:studio@localhost:5432/studio';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const s3Endpoint = (process.env.S3_ENDPOINT ?? 'http://localhost:9000').replace(/\/$/, '');

const pg = parsePg(databaseUrl);
const redis = parseRedis(redisUrl);

await tcpOk(pg.host, pg.port, 'postgres');
await tcpOk(redis.host, redis.port, 'redis');
await httpOk(`${s3Endpoint}/minio/health/live`, 'minio');
console.log('All CI health checks passed');
