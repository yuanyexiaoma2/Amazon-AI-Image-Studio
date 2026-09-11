#!/usr/bin/env node
/**
 * Real API E2E (not a noop): register → login → create project → cross-workspace denied.
 * Expects a running Next.js server at APP_URL (default http://127.0.0.1:3000).
 */
import { setTimeout as sleep } from 'node:timers/promises';

const base = (process.env.APP_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function fail(msg, detail) {
  console.error('E2E FAIL:', msg, detail ?? '');
  process.exit(1);
}

function ok(msg) {
  console.log('E2E OK:', msg);
}

async function waitForServer(retries = 60) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${base}/`);
      if (res.ok || res.status < 500) return;
    } catch {
      // retry
    }
    await sleep(1000);
  }
  fail(`Server not reachable at ${base}`);
}

function cookieJar() {
  /** @type {Map<string, string>} */
  const jar = new Map();
  return {
    store(res) {
      const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
      for (const line of raw) {
        const part = line.split(';')[0];
        const eq = part.indexOf('=');
        if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1));
      }
      const single = res.headers.get('set-cookie');
      if (single && raw.length === 0) {
        for (const line of single.split(/,(?=\s*[^;]+=)/)) {
          const part = line.split(';')[0].trim();
          const eq = part.indexOf('=');
          if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1));
        }
      }
    },
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

async function register(email, password, name) {
  const res = await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': `e2e-reg-${suffix}` },
    body: JSON.stringify({ email, password, name }),
  });
  const json = await res.json();
  if (res.status !== 201) fail('register', { status: res.status, json });
  return json;
}

async function login(email, password) {
  const jar = cookieJar();
  const csrfRes = await fetch(`${base}/api/auth/csrf`);
  jar.store(csrfRes);
  const csrfJson = await csrfRes.json();
  const csrfToken = csrfJson.csrfToken;
  if (!csrfToken) fail('csrf missing', csrfJson);

  const body = new URLSearchParams({
    csrfToken,
    email,
    password,
    callbackUrl: `${base}/`,
    json: 'true',
  });

  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: jar.header(),
    },
    body,
    redirect: 'manual',
  });
  jar.store(res);
  if (res.status >= 400) {
    const text = await res.text();
    fail('login', { status: res.status, text });
  }
  const cookie = jar.header();
  if (!cookie.includes('authjs.session-token') && !cookie.includes('__Secure-authjs.session-token')) {
    console.warn('E2E warn: session cookie name not detected; cookie=', cookie.slice(0, 120));
  }
  return jar;
}

async function me(jar) {
  const res = await fetch(`${base}/api/me`, {
    headers: { cookie: jar.header(), 'x-request-id': `e2e-me-${suffix}` },
  });
  const json = await res.json();
  if (res.status !== 200) fail('/api/me', { status: res.status, json });
  return json;
}

async function createProject(jar, workspaceId, sku, name) {
  const res = await fetch(`${base}/api/workspaces/${workspaceId}/projects`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: jar.header(),
      'x-request-id': `e2e-proj-${suffix}`,
    },
    body: JSON.stringify({ sku, name, marketplace: 'US' }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function getProject(jar, workspaceId, projectId) {
  const res = await fetch(`${base}/api/workspaces/${workspaceId}/projects/${projectId}`, {
    headers: { cookie: jar.header(), 'x-request-id': `e2e-get-${suffix}` },
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function main() {
  console.log(`E2E against ${base}`);
  await waitForServer();

  const emailA = `e2e-a-${suffix}@example.com`;
  const emailB = `e2e-b-${suffix}@example.com`;
  const password = 'Password123!';

  const userA = await register(emailA, password, 'E2E A');
  ok(`registered A ${userA.id}`);
  const userB = await register(emailB, password, 'E2E B');
  ok(`registered B ${userB.id}`);

  const jarA = await login(emailA, password);
  const meA = await me(jarA);
  if (!meA.workspaces?.length) fail('A has no workspace', meA);
  const workspaceA = meA.workspaces[0].id;
  ok(`logged in A workspace=${workspaceA}`);

  const jarB = await login(emailB, password);
  const meB = await me(jarB);
  const workspaceB = meB.workspaces[0].id;
  ok(`logged in B workspace=${workspaceB}`);

  const created = await createProject(jarA, workspaceA, `SKU-${suffix}`, 'E2E Project');
  if (created.status !== 201) fail('create project', created);
  ok(`created project ${created.json.id}`);

  const denied = await createProject(jarB, workspaceA, `SKU-X-${suffix}`, 'Should Fail');
  if (denied.status !== 403) fail('expected cross-workspace create deny 403', denied);
  ok('cross-workspace create denied');

  const getDenied = await getProject(jarB, workspaceA, created.json.id);
  if (getDenied.status !== 403) fail('expected cross-workspace get deny 403', getDenied);
  ok('cross-workspace get denied');

  const getOk = await getProject(jarA, workspaceA, created.json.id);
  if (getOk.status !== 200) fail('owner get project', getOk);
  ok('owner can get project');

  console.log('E2E PASS: register → login → create project → cross-workspace denied');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
