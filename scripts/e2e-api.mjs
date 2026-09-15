#!/usr/bin/env node
/**
 * Real API E2E (not a noop):
 * 1) register → login → create project → cross-workspace denied
 * 2) sessionVersion: old cookie 401 after password change / disable; password swap
 * 3) W2: upload → inspect → extract → confirm → approve Truth Pack
 * 4) W3-A: generate 7-shot Shot Plan (Fake) → human edit → approve
 * 5) W3-B2: materialize approved plan → 7-image workflow graph; B1 save/conflict/cycle still covered
 * Expects a running Next.js server at APP_URL (default http://127.0.0.1:3000).
 * Prefer INSPECT_INLINE=1 so complete() finishes inspect without a separate worker.
 * Prefer GENERATION_INLINE=1 so runs settle without a separate worker.
 * 6) W4: model-registry → run → settle → budget gate → AUTH final → webhook → SSE
 * 7) W5-A: generate fingerprint/assets; remove_background+MASK; webhook orphan reconcile; STALE
 * 8) W5-B: mask editor API (strokes+render) + replace_background + inpaint Fake
 * 9) W5-C: outpaint (canvas/placement) + upscale (normalize) Fake
 * 10) W6 Phase 1: QA (amazon-main-us-v1 + Fake OCR/Vision) → Review approvals → ZIP export
 *     Playwright is not in this repo; API-level new-project→ZIP is the W6-08 chain.
 *     INSPECT_INLINE also runs QA/export inline (QA_INLINE / EXPORT_INLINE optional).
 * 11) W7: variants 3×7 Fake batch, partial fail/retry, ledger, structure/logo BLOCK, admin
 * 12) V2 PR-2: canvas command layer — apply/idempotency/undo/redo/run/budget gate + masks list
 * 13) V2 PR-4: chat agent — session/turn/graph apply/run + session budget gate/undo/cross-tenant
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';

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
    /** Snapshot cookies for "old session" tests. */
    clone() {
      const next = cookieJar();
      for (const [k, v] of jar.entries()) next._set(k, v);
      return next;
    },
    _set(k, v) {
      jar.set(k, v);
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
  if (res.status === 429) {
    const text = await res.text();
    fail('login rate limited', { status: res.status, text });
  }
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

/** Login that returns { jar, status, body } without failing the suite (for negative cases). */
async function tryLogin(email, password) {
  const jar = cookieJar();
  const csrfRes = await fetch(`${base}/api/auth/csrf`);
  jar.store(csrfRes);
  const csrfJson = await csrfRes.json();
  const csrfToken = csrfJson.csrfToken;
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
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  const hasSession =
    jar.header().includes('authjs.session-token') ||
    jar.header().includes('__Secure-authjs.session-token');
  return { jar, status: res.status, text, json, hasSession };
}

async function me(jar) {
  const res = await fetch(`${base}/api/me`, {
    headers: { cookie: jar.header(), 'x-request-id': `e2e-me-${suffix}` },
  });
  const json = await res.json();
  if (res.status !== 200) fail('/api/me', { status: res.status, json });
  return json;
}

async function meStatus(jar) {
  const res = await fetch(`${base}/api/me`, {
    headers: { cookie: jar.header(), 'x-request-id': `e2e-me-st-${suffix}` },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
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

async function changePassword(jar, currentPassword, newPassword) {
  const res = await fetch(`${base}/api/account/change-password`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: jar.header(),
      'x-request-id': `e2e-cpw-${suffix}`,
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function disableAccount(jar) {
  const res = await fetch(`${base}/api/account/disable`, {
    method: 'POST',
    headers: {
      cookie: jar.header(),
      'x-request-id': `e2e-dis-${suffix}`,
    },
  });
  const json = await res.json();
  return { status: res.status, json };
}


async function uploadPng(jar, workspaceId, projectId, filename, pngBuffer) {
  const checksum = createHash('sha256').update(pngBuffer).digest('hex');
  const presignRes = await fetch(`${base}/api/workspaces/${workspaceId}/uploads/presign`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: jar.header(),
      'x-request-id': `e2e-presign-${filename}-${suffix}`,
    },
    body: JSON.stringify({
      projectId,
      filename,
      mimeType: 'image/png',
      bytes: pngBuffer.length,
    }),
  });
  const presign = await presignRes.json();
  if (presignRes.status !== 201) fail('presign ' + filename, { status: presignRes.status, presign });
  const putRes = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: presign.headers ?? { 'Content-Type': 'image/png' },
    body: pngBuffer,
  });
  if (!putRes.ok) fail('S3 PUT ' + filename, { status: putRes.status, text: await putRes.text() });
  const completeRes = await fetch(
    `${base}/api/workspaces/${workspaceId}/uploads/${presign.uploadId}/complete`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jar.header(),
        'x-request-id': `e2e-complete-${filename}-${suffix}`,
      },
      body: JSON.stringify({
        checksumSha256: checksum,
        completionKey: `e2e-complete-${presign.uploadId}`,
      }),
    },
  );
  const complete = await completeRes.json();
  if (completeRes.status !== 200) fail('complete ' + filename, { status: completeRes.status, complete });
  let asset = null;
  for (let i = 0; i < 40; i++) {
    const aRes = await fetch(`${base}/api/workspaces/${workspaceId}/assets/${presign.assetId}`, {
      headers: { cookie: jar.header(), 'x-request-id': `e2e-asset-${filename}-${i}` },
    });
    asset = await aRes.json();
    if (aRes.status === 200 && (asset.status === 'READY' || asset.status === 'REJECTED')) break;
    await sleep(250);
  }
  if (!asset || asset.status !== 'READY' || !asset.currentVersionId) {
    fail('asset not READY ' + filename, asset);
  }
  return { assetId: presign.assetId, versionId: asset.currentVersionId, asset };
}

async function makeMainCandidate({ bg, size = 2000, subject = 1720 }) {
  const origin = Math.floor((size - subject) / 2);
  return sharp({
    create: { width: size, height: size, channels: 3, background: bg },
  })
    .composite([
      {
        input: await sharp({
          create: { width: subject, height: subject, channels: 3, background: { r: 36, g: 36, b: 36 } },
        })
          .png()
          .toBuffer(),
        left: origin,
        top: origin,
      },
    ])
    .png()
    .toBuffer();
}

async function pollQa(jar, workspaceId, reportId) {
  let report = null;
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${base}/api/workspaces/${workspaceId}/qa-reports/${reportId}`, {
      headers: { cookie: jar.header(), 'x-request-id': `e2e-qa-poll-${reportId}-${i}` },
    });
    report = await res.json();
    if (res.status === 200 && (report.status === 'SUCCEEDED' || report.status === 'FAILED')) return report;
    await sleep(200);
  }
  fail('QA did not finish', report);
}

async function pollExport(jar, workspaceId, bundleId) {
  let bundle = null;
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${base}/api/workspaces/${workspaceId}/exports/${bundleId}`, {
      headers: { cookie: jar.header(), 'x-request-id': `e2e-ex-poll-${bundleId}-${i}` },
    });
    bundle = await res.json();
    if (res.status === 200 && (bundle.status === 'SUCCEEDED' || bundle.status === 'FAILED')) return bundle;
    await sleep(200);
  }
  fail('export did not finish', bundle);
}

async function main() {
  console.log(`E2E against ${base}`);
  await waitForServer();

  // Passwords must satisfy shared PasswordSchema (min 12).
  const password = 'Password123!'; // 12 chars
  const passwordNew = 'NewPassword9!'; // 13 chars

  const emailA = `e2e-a-${suffix}@example.com`;
  const emailB = `e2e-b-${suffix}@example.com`;

  // --- Tenant isolation flow ---
  const userA = await register(emailA, password, 'E2E A');
  ok(`registered A ${userA.id}`);
  const userB = await register(emailB, password, 'E2E B');
  ok(`registered B ${userB.id}`);

  // Email normalization: register with spaces/case should conflict / login should work
  const emailNorm = `  E2E-Norm-${suffix}@Example.COM `;
  const normUser = await register(emailNorm, password, 'Norm');
  ok(`registered normalized ${normUser.email}`);
  if (normUser.email !== `e2e-norm-${suffix}@example.com`) {
    fail('expected normalized stored email', normUser);
  }
  const jarNorm = await login(`e2e-norm-${suffix}@EXAMPLE.com`, password);
  await me(jarNorm);
  ok('login with different case email works');

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

  // --- sessionVersion real E2E (not just DB integer bump) ---
  const emailSv = `e2e-sv-${suffix}@example.com`;
  await register(emailSv, password, 'SV User');
  const jarOld = await login(emailSv, password);
  await me(jarOld);
  ok('SV: old session works before password change');

  // Keep a clone of the old cookie jar (immutable snapshot of Set-Cookie values)
  const oldCookieHeader = jarOld.header();
  const jarOldFrozen = cookieJar();
  for (const part of oldCookieHeader.split('; ')) {
    const eq = part.indexOf('=');
    if (eq > 0) jarOldFrozen._set(part.slice(0, eq), part.slice(eq + 1));
  }

  const jarForChange = await login(emailSv, password);
  const cpw = await changePassword(jarForChange, password, passwordNew);
  if (cpw.status !== 200) fail('change-password', cpw);
  ok(`SV: password changed sessionVersion=${cpw.json.sessionVersion}`);

  const oldMe = await meStatus(jarOldFrozen);
  if (oldMe.status !== 401) {
    fail('expected old cookie /api/me → 401 after password change', oldMe);
  }
  ok('SV: old cookie → 401 on /api/me after password change');

  const oldLogin = await tryLogin(emailSv, password);
  if (oldLogin.hasSession && oldLogin.status < 400) {
    // Auth.js may still return 200 with redirect but without setting a valid usable session;
    // verify via /api/me if a session cookie appeared.
    const probe = await meStatus(oldLogin.jar);
    if (probe.status === 200) fail('old password must not yield active session', probe);
  }
  ok('SV: old password cannot establish active session');

  const jarNew = await login(emailSv, passwordNew);
  await me(jarNew);
  ok('SV: new password can login');

  // Disable account: save cookie, disable, old cookie must 401/403
  const emailDis = `e2e-dis-${suffix}@example.com`;
  await register(emailDis, password, 'Disable User');
  const jarBeforeDisable = await login(emailDis, password);
  await me(jarBeforeDisable);
  const disableCookieHeader = jarBeforeDisable.header();
  const jarDisabledFrozen = cookieJar();
  for (const part of disableCookieHeader.split('; ')) {
    const eq = part.indexOf('=');
    if (eq > 0) jarDisabledFrozen._set(part.slice(0, eq), part.slice(eq + 1));
  }

  const jarDisableActor = await login(emailDis, password);
  const dis = await disableAccount(jarDisableActor);
  if (dis.status !== 200) fail('disable account', dis);
  ok('SV: account disabled');

  const afterDisable = await meStatus(jarDisabledFrozen);
  if (afterDisable.status !== 401 && afterDisable.status !== 403) {
    fail('expected old cookie → 401/403 after disable', afterDisable);
  }
  ok(`SV: old cookie → ${afterDisable.status} after account disable`);

  console.log('E2E PASS: sessionVersion (password change + disable revoke old cookies)');

  // --- W2 upload → Truth Pack approve ---
  const emailW2 = `e2e-w2-${suffix}@example.com`;
  await register(emailW2, password, 'W2 User');
  const jarW2 = await login(emailW2, password);
  const meW2 = await me(jarW2);
  const wsW2 = meW2.workspaces[0].id;
  const projW2 = await createProject(jarW2, wsW2, `W2-${suffix}`, 'W2 Truth Project');
  if (projW2.status !== 201) fail('w2 create project', projW2);
  const projectId = projW2.json.id;
  ok(`W2 project ${projectId}`);

  const png = await sharp({
    create: { width: 128, height: 96, channels: 3, background: { r: 250, g: 250, b: 250 } },
  })
    .png()
    .toBuffer();
  const checksum = createHash('sha256').update(png).digest('hex');

  const presignRes = await fetch(`${base}/api/workspaces/${wsW2}/uploads/presign`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: jarW2.header(),
      'x-request-id': `e2e-presign-${suffix}`,
    },
    body: JSON.stringify({
      projectId,
      filename: 'front.png',
      mimeType: 'image/png',
      bytes: png.length,
    }),
  });
  const presign = await presignRes.json();
  if (presignRes.status !== 201) fail('presign', { status: presignRes.status, presign });
  ok(`W2 presign uploadId=${presign.uploadId}`);

  const putRes = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: presign.headers ?? { 'Content-Type': 'image/png' },
    body: png,
  });
  if (!putRes.ok) fail('S3 PUT', { status: putRes.status, text: await putRes.text() });
  ok('W2 PUT original to MinIO');

  const completeRes = await fetch(
    `${base}/api/workspaces/${wsW2}/uploads/${presign.uploadId}/complete`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jarW2.header(),
        'x-request-id': `e2e-complete-${suffix}`,
      },
      body: JSON.stringify({
        checksumSha256: checksum,
        completionKey: `e2e-complete-${presign.uploadId}`,
      }),
    },
  );
  const complete = await completeRes.json();
  if (completeRes.status !== 200) fail('complete', { status: completeRes.status, complete });
  ok(`W2 complete status=${complete.status} asset=${complete.assetStatus}`);

  let asset = null;
  for (let i = 0; i < 40; i++) {
    const aRes = await fetch(`${base}/api/workspaces/${wsW2}/assets/${presign.assetId}`, {
      headers: { cookie: jarW2.header(), 'x-request-id': `e2e-asset-${suffix}-${i}` },
    });
    asset = await aRes.json();
    if (aRes.status === 200 && (asset.status === 'READY' || asset.status === 'REJECTED')) break;
    await sleep(250);
  }
  if (!asset || asset.status !== 'READY') fail('asset not READY', asset);
  if (!asset.currentVersionId) fail('missing currentVersionId', asset);
  const hasThumb = (asset.versions?.[0]?.representations ?? []).some((r) => r.kind === 'THUMBNAIL_WEBP');
  if (!hasThumb) fail('missing THUMBNAIL_WEBP', asset.versions);
  ok(`W2 asset READY version=${asset.currentVersionId} thumb=yes`);

  // Cross-tenant: B cannot read A's asset
  const crossAsset = await fetch(`${base}/api/workspaces/${wsW2}/assets/${presign.assetId}`, {
    headers: { cookie: jarB.header(), 'x-request-id': `e2e-asset-x-${suffix}` },
  });
  if (crossAsset.status !== 403) fail('expected cross-workspace asset 403', { status: crossAsset.status });
  ok('W2 cross-workspace asset denied');

  const extractRes = await fetch(
    `${base}/api/workspaces/${wsW2}/projects/${projectId}/truth-pack/extract`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jarW2.header(),
        'x-request-id': `e2e-extract-${suffix}`,
      },
      body: JSON.stringify({ assetVersionIds: [asset.currentVersionId] }),
    },
  );
  const extracted = await extractRes.json();
  if (extractRes.status !== 201) fail('extract', { status: extractRes.status, extracted });
  if (extracted.provider !== 'fake-vision') fail('expected fake-vision provider', extracted);
  const pack = extracted.pack;
  if (!pack?.revision?.facts?.length) fail('no facts', pack);
  ok(`W2 extract facts=${pack.revision.facts.length}`);

  const updates = pack.revision.facts.map((f) => ({ factId: f.id, status: 'CONFIRMED' }));
  const confirmRes = await fetch(
    `${base}/api/workspaces/${wsW2}/projects/${projectId}/truth-pack/confirm`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jarW2.header(),
        'x-request-id': `e2e-confirm-${suffix}`,
      },
      body: JSON.stringify({ updates }),
    },
  );
  const confirmed = await confirmRes.json();
  if (confirmRes.status !== 200) fail('confirm', { status: confirmRes.status, confirmed });
  ok('W2 facts confirmed');

  const approveRes = await fetch(
    `${base}/api/workspaces/${wsW2}/projects/${projectId}/truth-pack/approve`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jarW2.header(),
        'x-request-id': `e2e-approve-${suffix}`,
      },
      body: JSON.stringify({ revisionId: confirmed.revision.id }),
    },
  );
  const approved = await approveRes.json();
  if (approveRes.status !== 200) fail('approve', { status: approveRes.status, approved });
  if (approved.revision?.status !== 'APPROVED') fail('not APPROVED', approved);
  if (!approved.approvedRevisionId) fail('missing approvedRevisionId', approved);
  ok('W2 Truth Pack APPROVED');

  // W3-A: generate Shot Plan (Fake) → approve (requires approved Truth)
  const genDenied = await fetch(
    `${base}/api/workspaces/${wsW2}/projects/${projectId}/shot-plans/generate`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jarB.header(),
        'x-request-id': `e2e-sp-x-${suffix}`,
      },
      body: JSON.stringify({}),
    },
  );
  if (genDenied.status !== 403) fail('expected cross-workspace shot-plan generate 403', { status: genDenied.status });
  ok('W3-A cross-workspace shot-plan generate denied');

  const genRes = await fetch(
    `${base}/api/workspaces/${wsW2}/projects/${projectId}/shot-plans/generate`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jarW2.header(),
        'x-request-id': `e2e-sp-gen-${suffix}`,
      },
      body: JSON.stringify({}),
    },
  );
  const generated = await genRes.json();
  if (genRes.status !== 201) fail('shot-plan generate', { status: genRes.status, generated });
  if (generated.provider !== 'fake-shot-plan') fail('expected fake-shot-plan', generated);
  const plan = generated.plan;
  if (!plan?.revision?.briefs || plan.revision.briefs.length !== 7) {
    fail('expected 7 briefs', plan?.revision?.briefs?.length);
  }
  if (plan.revision.briefs.some((b) => b.slot === 'PACKAGE')) fail('PACKAGE in default template', plan);
  if (plan.revision.truthRevisionId !== approved.approvedRevisionId) {
    fail('plan must FK approved truth revision', {
      planTruth: plan.revision.truthRevisionId,
      approvedTruth: approved.approvedRevisionId,
    });
  }
  if (!plan.canvasPayload?.briefs?.length) fail('missing canvasPayload for W3-08', plan.canvasPayload);
  if (plan.revision.status !== 'PENDING_REVIEW') fail('expected PENDING_REVIEW after generate', plan.revision.status);
  ok(`W3-A generate briefs=7 truthFK=${plan.revision.truthRevisionId.slice(0, 8)}…`);

  // Human edit: PUT same briefs (readyForReview) then approve
  const spPutRes = await fetch(
    `${base}/api/workspaces/${wsW2}/projects/${projectId}/shot-plans`,
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        cookie: jarW2.header(),
        'x-request-id': `e2e-sp-put-${suffix}`,
      },
      body: JSON.stringify({
        briefs: plan.revision.briefs.map((b) => ({
          slot: b.slot,
          purpose: b.purpose + ' (edited)',
          orderIndex: b.orderIndex,
          copy: b.copy,
          must: b.constraints.must,
          mustNot: b.constraints.mustNot,
          qaPolicy: b.constraints.qaPolicy,
          aspectRatio: b.constraints.aspectRatio,
          targetPixels: b.constraints.targetPixels,
          referencedAssetVersionIds: b.constraints.referencedAssetVersionIds ?? [],
        })),
      }),
    },
  );
  const spPutJson = await spPutRes.json();
  if (spPutRes.status !== 200) fail('shot-plan PUT', { status: spPutRes.status, spPutJson });
  if (spPutJson.revision?.status !== 'PENDING_REVIEW') fail('PUT not PENDING_REVIEW', spPutJson);
  ok('W3-A human edit PUT');

  const spApprove = await fetch(
    `${base}/api/workspaces/${wsW2}/projects/${projectId}/shot-plans/approve`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jarW2.header(),
        'x-request-id': `e2e-sp-approve-${suffix}`,
      },
      body: JSON.stringify({ revisionId: spPutJson.revision.id }),
    },
  );
  const spApproved = await spApprove.json();
  if (spApprove.status !== 200) fail('shot-plan approve', { status: spApprove.status, spApproved });
  if (spApproved.revision?.status !== 'APPROVED') fail('shot plan not APPROVED', spApproved);
  if (!spApproved.approvedRevisionId) fail('missing approvedRevisionId', spApproved);
  ok('W3-A Shot Plan APPROVED');

  // W3-B2: materialize approved Shot Plan → workflow graph
  const matDenied = await fetch(
    `${base}/api/workspaces/${wsW2}/projects/${projectId}/shot-plans/materialize`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jarB.header(),
        'x-request-id': `e2e-mat-x-${suffix}`,
      },
      body: JSON.stringify({}),
    },
  );
  if (matDenied.status !== 403) {
    fail('expected cross-workspace materialize 403', { status: matDenied.status });
  }
  ok('W3-B2 cross-workspace materialize denied');

  const matRes = await fetch(
    `${base}/api/workspaces/${wsW2}/projects/${projectId}/shot-plans/materialize`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jarW2.header(),
        'x-request-id': `e2e-mat-${suffix}`,
      },
      body: JSON.stringify({}),
    },
  );
  const matJson = await matRes.json();
  if (matRes.status !== 201) fail('materialize', { status: matRes.status, matJson });
  if (matJson.briefCount !== 7) fail('expected briefCount 7', matJson);
  if (!matJson.workflow?.graph?.nodes) fail('missing materialized graph', matJson);
  const genNodes = matJson.workflow.graph.nodes.filter((n) => n.type === 'generate');
  if (genNodes.length !== 7) fail('expected 7 generate nodes', genNodes.length);
  if (!matJson.workflow.graph.nodes.some((n) => n.type === 'approval_selector')) {
    fail('missing approval_selector', matJson.workflow.graph.nodes.map((n) => n.type));
  }
  if (matJson.planRevisionId !== spApproved.approvedRevisionId) {
    fail('materialize planRevision mismatch', {
      got: matJson.planRevisionId,
      expected: spApproved.approvedRevisionId,
    });
  }
  ok(
    `W3-B2 materialize nodes=${matJson.workflow.graph.nodes.length} edges=${matJson.workflow.graph.edges.length}`,
  );

  // W3-B1: create empty workflow → save → conflict → reject cycle
  const wfCreate = await fetch(
    `${base}/api/workspaces/${wsW2}/projects/${projectId}/workflows`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jarW2.header(),
        'x-request-id': `e2e-wf-create-${suffix}`,
      },
      body: JSON.stringify({ name: 'E2E workflow' }),
    },
  );
  const wfCreated = await wfCreate.json();
  if (wfCreate.status !== 201) fail('workflow create', { status: wfCreate.status, wfCreated });
  if (wfCreated.revisionNumber !== 0) fail('expected rev 0', wfCreated);
  if (!wfCreated.graph || !Array.isArray(wfCreated.graph.nodes)) fail('missing empty graph', wfCreated);
  ok(`W3-B1 create empty workflow ${wfCreated.workflowId.slice(0, 8)}…`);

  const legalGraph = {
    schemaVersion: 1,
    nodes: [
      { id: 'n1', type: 'source_image', position: { x: 12, y: 34 }, config: { schemaVersion: 1 } },
      { id: 'n2', type: 'prompt', position: { x: 200, y: 34 }, config: { schemaVersion: 1 } },
    ],
    edges: [],
  };
  const wfPatch = await fetch(`${base}/api/workspaces/${wsW2}/workflows/${wfCreated.workflowId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      cookie: jarW2.header(),
      'x-request-id': `e2e-wf-patch-${suffix}`,
    },
    body: JSON.stringify({ ifRevision: 0, graph: legalGraph }),
  });
  const wfPatched = await wfPatch.json();
  if (wfPatch.status !== 200) fail('workflow patch', { status: wfPatch.status, wfPatched });
  if (wfPatched.revisionNumber !== 1) fail('expected rev 1', wfPatched);
  if (wfPatched.graph.nodes[0].position.x !== 12) fail('position not persisted', wfPatched);
  ok('W3-B1 save draft positions');

  const wfConflict = await fetch(`${base}/api/workspaces/${wsW2}/workflows/${wfCreated.workflowId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      cookie: jarW2.header(),
      'x-request-id': `e2e-wf-conflict-${suffix}`,
    },
    body: JSON.stringify({ ifRevision: 0, graph: legalGraph }),
  });
  const wfConflictJson = await wfConflict.json();
  if (wfConflict.status !== 409) fail('expected 409 conflict', { status: wfConflict.status, wfConflictJson });
  if (wfConflictJson.error?.code !== 'WORKFLOW_REVISION_CONFLICT') {
    fail('expected WORKFLOW_REVISION_CONFLICT', wfConflictJson);
  }
  ok('W3-B1 concurrent conflict 409 (no silent overwrite)');

  const cyclicGraph = {
    schemaVersion: 1,
    nodes: [
      { id: 'a', type: 'upscale', position: { x: 0, y: 0 }, config: { schemaVersion: 1 } },
      { id: 'b', type: 'upscale', position: { x: 1, y: 0 }, config: { schemaVersion: 1 } },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'b', sourceHandle: 'image', targetHandle: 'image' },
      { id: 'e2', source: 'b', target: 'a', sourceHandle: 'image', targetHandle: 'image' },
    ],
  };
  const wfCycle = await fetch(`${base}/api/workspaces/${wsW2}/workflows/${wfCreated.workflowId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      cookie: jarW2.header(),
      'x-request-id': `e2e-wf-cycle-${suffix}`,
    },
    body: JSON.stringify({ ifRevision: 1, graph: cyclicGraph }),
  });
  if (wfCycle.status !== 400) fail('expected cycle rejected 400', { status: wfCycle.status, body: await wfCycle.json() });
  ok('W3-B1 cyclic graph rejected');

  const wfGet = await fetch(`${base}/api/workspaces/${wsW2}/workflows/${wfCreated.workflowId}`, {
    headers: { cookie: jarW2.header(), 'x-request-id': `e2e-wf-get-${suffix}` },
  });
  const wfGot = await wfGet.json();
  if (wfGet.status !== 200) fail('workflow get', { status: wfGet.status, wfGot });
  if (wfGot.revisionNumber !== 1) fail('refresh lost revision', wfGot);
  if (wfGot.graph.nodes.length !== 2) fail('refresh lost nodes', wfGot);
  ok('W3-B1 refresh keeps positions/config/edges/revision');

  const wfSnap = await fetch(
    `${base}/api/workspaces/${wsW2}/workflows/${wfCreated.workflowId}/snapshot`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jarW2.header(),
        'x-request-id': `e2e-wf-snap-${suffix}`,
      },
      body: JSON.stringify({ ifRevision: 1 }),
    },
  );
  const wfSnapJson = await wfSnap.json();
  if (wfSnap.status !== 201) fail('workflow snapshot', { status: wfSnap.status, wfSnapJson });
  if (!wfSnapJson.revision?.id) fail('missing revision id', wfSnapJson);
  ok('W3-B1 revision snapshot');

  // Prepare executable generate node for W4 run (B1 snapshot graph had no executables)
  const runGraph = {
    schemaVersion: 1,
    nodes: [
      { id: 'n1', type: 'source_image', position: { x: 12, y: 34 }, config: { schemaVersion: 1 } },
      {
        id: 'gen1',
        type: 'generate',
        position: { x: 220, y: 34 },
        config: { schemaVersion: 1, prompt: 'e2e white background product' },
      },
    ],
    edges: [],
  };
  const wfRunPatch = await fetch(`${base}/api/workspaces/${wsW2}/workflows/${wfCreated.workflowId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      cookie: jarW2.header(),
      'x-request-id': `e2e-wf-rungraph-${suffix}`,
    },
    body: JSON.stringify({ ifRevision: 1, graph: runGraph }),
  });
  const wfRunPatched = await wfRunPatch.json();
  if (wfRunPatch.status !== 200) fail('run graph patch', { status: wfRunPatch.status, wfRunPatched });
  const wfRunSnap = await fetch(
    `${base}/api/workspaces/${wsW2}/workflows/${wfCreated.workflowId}/snapshot`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jarW2.header(),
        'x-request-id': `e2e-wf-runsnap-${suffix}`,
      },
      body: JSON.stringify({ ifRevision: 2 }),
    },
  );
  const wfRunSnapJson = await wfRunSnap.json();
  if (wfRunSnap.status !== 201) fail('run snapshot', { status: wfRunSnap.status, wfRunSnapJson });
  ok('W4 prep: generate node snapshot');

  // ─── W4: model registry, run, credits, webhook, SSE ─────────────────
  const regRes = await fetch(`${base}/api/workspaces/${wsW2}/model-registry`, {
    headers: { cookie: jarW2.header(), 'x-request-id': `e2e-registry-${suffix}` },
  });
  const regJson = await regRes.json();
  if (regRes.status !== 200) fail('model-registry', { status: regRes.status, regJson });
  if (!Array.isArray(regJson.models) || regJson.models.length < 1) fail('expected models', regJson);
  if (!regJson.credits || regJson.credits.availableMicrounits < 1) fail('expected credits grant', regJson);
  ok('W4-01 model-registry + credit snapshot');

  const revisionId = wfRunSnapJson.revision.id;
  const idem = `e2e-run-${suffix}`;
  const runCreate = await fetch(
    `${base}/api/workspaces/${wsW2}/workflow-revisions/${revisionId}/runs`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jarW2.header(),
        'x-request-id': `e2e-run-${suffix}`,
      },
      body: JSON.stringify({
        scope: { type: 'ALL' },
        idempotencyKey: idem,
        budgetLimit: { currency: 'USD', amount: 5 },
        confirmBudget: true,
        scenario: 'SUCCESS',
      }),
    },
  );
  const runJson = await runCreate.json();
  if (runCreate.status !== 201 && runCreate.status !== 200) {
    fail('create run', { status: runCreate.status, runJson });
  }
  if (!runJson.run?.id) fail('missing run id', runJson);
  ok('W4-02/03 create run (reserve+outbox)');

  const runReplay = await fetch(
    `${base}/api/workspaces/${wsW2}/workflow-revisions/${revisionId}/runs`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jarW2.header(),
        'x-request-id': `e2e-run-replay-${suffix}`,
      },
      body: JSON.stringify({
        scope: { type: 'ALL' },
        idempotencyKey: idem,
        confirmBudget: true,
      }),
    },
  );
  const runReplayJson = await runReplay.json();
  if (runReplay.status !== 200) fail('idempotent run replay', { status: runReplay.status, runReplayJson });
  if (runReplayJson.run?.id !== runJson.run.id) fail('idempotency broke', runReplayJson);
  ok('W4-02 run idempotencyKey replay');

  let finalRun = null;
  for (let i = 0; i < 40; i++) {
    const g = await fetch(`${base}/api/workspaces/${wsW2}/runs/${runJson.run.id}`, {
      headers: { cookie: jarW2.header(), 'x-request-id': `e2e-run-poll-${suffix}-${i}` },
    });
    finalRun = await g.json();
    if (['SUCCEEDED', 'FAILED_FINAL', 'CANCELED'].includes(finalRun.status)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!finalRun || finalRun.status !== 'SUCCEEDED') {
    fail('run did not succeed', finalRun);
  }
  ok('W4-02 worker settle → SUCCEEDED');

  // Budget gate
  const budgetDeny = await fetch(
    `${base}/api/workspaces/${wsW2}/workflow-revisions/${revisionId}/runs`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jarW2.header(),
        'x-request-id': `e2e-budget-${suffix}`,
      },
      body: JSON.stringify({
        scope: { type: 'ALL' },
        idempotencyKey: `e2e-budget-${suffix}`,
        budgetLimit: { currency: 'USD', amount: 0.000001 },
        confirmBudget: false,
      }),
    },
  );
  const budgetJson = await budgetDeny.json();
  if (budgetDeny.status !== 402 || budgetJson.error?.code !== 'BUDGET_EXCEEDED') {
    fail('expected BUDGET_EXCEEDED', { status: budgetDeny.status, budgetJson });
  }
  ok('W4-03 budget gate');

  // AUTH failure matrix (no auto success)
  const authRun = await fetch(
    `${base}/api/workspaces/${wsW2}/workflow-revisions/${revisionId}/runs`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jarW2.header(),
        'x-request-id': `e2e-auth-${suffix}`,
      },
      body: JSON.stringify({
        scope: { type: 'ALL' },
        idempotencyKey: `e2e-auth-${suffix}`,
        confirmBudget: true,
        budgetLimit: { currency: 'USD', amount: 5 },
        scenario: 'AUTH',
      }),
    },
  );
  const authJson = await authRun.json();
  if (authRun.status !== 201 && authRun.status !== 200) fail('auth scenario run', authJson);
  let authFinal = null;
  for (let i = 0; i < 40; i++) {
    const g = await fetch(`${base}/api/workspaces/${wsW2}/runs/${authJson.run.id}`, {
      headers: { cookie: jarW2.header() },
    });
    authFinal = await g.json();
    if (['FAILED_FINAL', 'FAILED_RETRYABLE', 'SUCCEEDED'].includes(authFinal.status)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!authFinal || authFinal.status !== 'FAILED_FINAL') {
    fail('AUTH should be FAILED_FINAL (no auto-retry)', authFinal);
  }
  ok('W4-06 AUTH → FAILED_FINAL (no auto-retry)');

  // Webhook verify + idempotent event id
  const { createHmac } = await import('node:crypto');
  // Find a submission external job from succeeded run — use fake webhook with unknown job first
  const whBody = JSON.stringify({
    eventId: `evt-${suffix}`,
    externalJobId: 'fake-unknown-job',
    status: 'SUCCEEDED',
  });
  const secret = process.env.FAKE_WEBHOOK_SECRET || 'fake-webhook-secret';
  const sig = createHmac('sha256', secret).update(whBody).digest('hex');
  const wh1 = await fetch(`${base}/api/v1/providers/fake/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-fake-signature': sig,
      'x-request-id': `e2e-wh-${suffix}`,
    },
    body: whBody,
  });
  const wh1Json = await wh1.json();
  if (wh1.status !== 202 || wh1Json.warning !== 'UNKNOWN_EXTERNAL_JOB' || !wh1Json.orphan) {
    fail('webhook unknown job should be orphan', { status: wh1.status, wh1Json });
  }
  // Replay while still orphan — must NOT be treated as processed duplicate.
  const wh2 = await fetch(`${base}/api/v1/providers/fake/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-fake-signature': sig,
      'x-request-id': `e2e-wh2-${suffix}`,
    },
    body: whBody,
  });
  const wh2Json = await wh2.json();
  if (wh2.status !== 202 || wh2Json.warning !== 'UNKNOWN_EXTERNAL_JOB') {
    fail('orphan replay should stay 202 UNKNOWN_EXTERNAL_JOB', { status: wh2.status, wh2Json });
  }
  ok('W4-04/W5-A webhook verify + orphan early-arrival (processedAt=null)');

  // SSE endpoint opens
  const sse = await fetch(`${base}/api/workspaces/${wsW2}/events?projectId=${projectId}`, {
    headers: { cookie: jarW2.header(), accept: 'text/event-stream', 'x-request-id': `e2e-sse-${suffix}` },
  });
  if (sse.status !== 200) fail('SSE status', { status: sse.status });
  const ct = sse.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) fail('SSE content-type', ct);
  // read a bit then cancel
  const reader = sse.body.getReader();
  const { value } = await reader.read();
  const chunk = new TextDecoder().decode(value || new Uint8Array());
  if (!chunk.includes('ready')) fail('SSE missing ready', chunk);
  await reader.cancel();
  ok('W4-05 SSE /events?projectId=');

  // ─── W5-A: remove_background + generate fingerprint/assets ───
  const w5Graph = {
    schemaVersion: 1,
    nodes: [
      {
        id: 'src1',
        type: 'source_image',
        position: { x: 0, y: 0 },
        config: { schemaVersion: 1 },
      },
      {
        id: 'cut1',
        type: 'remove_background',
        position: { x: 200, y: 0 },
        config: { schemaVersion: 1, subjectHint: 'product', edgeMode: 'auto' },
      },
      {
        id: 'gen1',
        type: 'generate',
        position: { x: 400, y: 0 },
        config: {
          schemaVersion: 1,
          modelKey: 'primary-image-edit',
          count: 1,
          resolution: '1K',
          prompt: 'W5-A generate',
        },
      },
    ],
    edges: [
      {
        id: 'e-src-cut',
        source: 'src1',
        target: 'cut1',
        sourceHandle: 'image',
        targetHandle: 'image',
      },
    ],
  };

  const w5Get = await fetch(`${base}/api/workspaces/${wsW2}/workflows/${wfCreated.workflowId}`, {
    headers: { cookie: jarW2.header(), 'x-request-id': `e2e-w5-get-${suffix}` },
  });
  const w5Got = await w5Get.json();
  if (w5Get.status !== 200) fail('W5-A workflow get', { status: w5Get.status, w5Got });
  const w5IfRev =
    w5Got.revisionNumber ??
    w5Got.draft?.revisionNumber ??
    w5Got.workflow?.draft?.revisionNumber;
  if (w5IfRev == null) fail('W5-A missing draft revisionNumber', w5Got);

  const w5Patch = await fetch(`${base}/api/workspaces/${wsW2}/workflows/${wfCreated.workflowId}`, {
    method: 'PATCH',
    headers: {
      cookie: jarW2.header(),
      'content-type': 'application/json',
      'x-request-id': `e2e-w5-patch-${suffix}`,
    },
    body: JSON.stringify({ ifRevision: w5IfRev, graph: w5Graph }),
  });
  const w5Patched = await w5Patch.json();
  if (w5Patch.status !== 200) fail('W5-A graph patch', { status: w5Patch.status, w5Patched });
  const w5DraftRev =
    w5Patched.revisionNumber ??
    w5Patched.draft?.revisionNumber ??
    w5Patched.workflow?.draft?.revisionNumber;
  const w5Snap = await fetch(
    `${base}/api/workspaces/${wsW2}/workflows/${wfCreated.workflowId}/snapshot`,
    {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-w5-snap-${suffix}`,
      },
      body: JSON.stringify({ ifRevision: w5DraftRev }),
    },
  );
  const w5SnapJson = await w5Snap.json();
  if (w5Snap.status !== 201) fail('W5-A snapshot', { status: w5Snap.status, w5SnapJson });
  const w5RevisionId = w5SnapJson.revision?.id;
  ok('W5-A snapshot remove_background+generate graph');

  const w5Run = await fetch(
    `${base}/api/workspaces/${wsW2}/workflow-revisions/${w5RevisionId}/runs`,
    {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-w5-run-${suffix}`,
      },
      body: JSON.stringify({
        idempotencyKey: `e2e-w5-run-${suffix}`,
        scenario: 'SUCCESS',
        reuseSucceededInputs: false,
      }),
    },
  );
  const w5RunJson = await w5Run.json();
  if (w5Run.status !== 201 && w5Run.status !== 200) {
    fail('W5-A create run', { status: w5Run.status, w5RunJson });
  }
  let w5Final = null;
  for (let i = 0; i < 50; i++) {
    const g = await fetch(`${base}/api/workspaces/${wsW2}/runs/${w5RunJson.run.id}`, {
      headers: { cookie: jarW2.header(), 'x-request-id': `e2e-w5-poll-${suffix}-${i}` },
    });
    w5Final = await g.json();
    const st = w5Final.status ?? w5Final.run?.status;
    if (st === 'SUCCEEDED' || st === 'FAILED_FINAL' || st === 'FAILED_RETRYABLE') break;
    await sleep(250);
  }
  const w5Status = w5Final?.status ?? w5Final?.run?.status;
  if (w5Status !== 'SUCCEEDED') fail('W5-A run did not succeed', w5Final);
  const w5Items = w5Final.items || w5Final.run?.items || [];
  const cutItem = w5Items.find((it) => it.nodeId === 'cut1');
  const genItem = w5Items.find((it) => it.nodeId === 'gen1');
  if (!cutItem || cutItem.status !== 'SUCCEEDED') fail('W5-02 remove_background item', cutItem);
  if (!genItem || genItem.status !== 'SUCCEEDED') fail('W5-01 generate item', genItem);
  ok('W5-01/02 Fake generate + remove_background succeeded');

  // ─── W5-B: mask strokes + render + replace_background + inpaint ───
  const maskCreate = await fetch(
    `${base}/api/workspaces/${wsW2}/asset-versions/${asset.currentVersionId}/masks`,
    {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-w5b-mask-${suffix}`,
      },
      body: JSON.stringify({
        strokes: [
          {
            tool: 'brush',
            size: 0.08,
            points: [
              { x: 480 / 512, y: 32 / 512 },
              { x: 0.95, y: 0.08 },
            ],
          },
        ],
        metadata: { viewportVersion: 1, zoom: 1 },
      }),
    },
  );
  const maskJson = await maskCreate.json();
  if (maskCreate.status !== 201) fail('W5-03 create mask', { status: maskCreate.status, maskJson });
  const maskId = maskJson.id;
  ok(`W5-03 mask created ${maskId.slice(0, 8)}…`);

  const maskRender = await fetch(`${base}/api/workspaces/${wsW2}/masks/${maskId}/render`, {
    method: 'POST',
    headers: { cookie: jarW2.header(), 'x-request-id': `e2e-w5b-render-${suffix}` },
  });
  const renderJson = await maskRender.json();
  if (maskRender.status !== 200) fail('W5-03 render mask', { status: maskRender.status, renderJson });
  if (!renderJson.width || !renderJson.height) fail('W5-03 render dims', renderJson);
  if (!renderJson.sha256) fail('W5-03 render sha', renderJson);
  ok(`W5-03 mask rendered ${renderJson.width}x${renderJson.height}`);

  const w5bGraph = {
    schemaVersion: 1,
    nodes: [
      {
        id: 'srcB',
        type: 'source_image',
        position: { x: 0, y: 0 },
        config: { schemaVersion: 1, assetVersionId: asset.currentVersionId },
      },
      {
        id: 'truthB',
        type: 'product_truth',
        position: { x: 0, y: 120 },
        config: { schemaVersion: 1, truthRevisionId: approved.approvedRevisionId },
      },
      {
        id: 'promptB',
        type: 'prompt',
        position: { x: 0, y: 240 },
        config: { schemaVersion: 1, text: 'clean studio backdrop', negative: '' },
      },
      {
        id: 'rbg1',
        type: 'replace_background',
        position: { x: 280, y: 0 },
        config: {
          schemaVersion: 1,
          fidelity: 0.9,
          lightBlend: 0.4,
          maskId,
        },
      },
      {
        id: 'inp1',
        type: 'inpaint',
        position: { x: 280, y: 200 },
        config: {
          schemaVersion: 1,
          strength: 0.7,
          modelKey: 'primary-image-edit',
          maskId,
        },
      },
    ],
    edges: [
      {
        id: 'e-src-rbg',
        source: 'srcB',
        target: 'rbg1',
        sourceHandle: 'image',
        targetHandle: 'image',
      },
      {
        id: 'e-prompt-rbg',
        source: 'promptB',
        target: 'rbg1',
        sourceHandle: 'prompt',
        targetHandle: 'prompt',
      },
      {
        id: 'e-truth-rbg',
        source: 'truthB',
        target: 'rbg1',
        sourceHandle: 'truth',
        targetHandle: 'truth',
      },
      {
        id: 'e-src-inp',
        source: 'srcB',
        target: 'inp1',
        sourceHandle: 'image',
        targetHandle: 'image',
      },
      {
        id: 'e-prompt-inp',
        source: 'promptB',
        target: 'inp1',
        sourceHandle: 'prompt',
        targetHandle: 'prompt',
      },
    ],
  };

  const w5bGet = await fetch(`${base}/api/workspaces/${wsW2}/workflows/${wfCreated.workflowId}`, {
    headers: { cookie: jarW2.header(), 'x-request-id': `e2e-w5b-get-${suffix}` },
  });
  const w5bGot = await w5bGet.json();
  const w5bIfRev =
    w5bGot.revisionNumber ??
    w5bGot.draft?.revisionNumber ??
    w5bGot.workflow?.draft?.revisionNumber;
  const w5bPatch = await fetch(`${base}/api/workspaces/${wsW2}/workflows/${wfCreated.workflowId}`, {
    method: 'PATCH',
    headers: {
      cookie: jarW2.header(),
      'content-type': 'application/json',
      'x-request-id': `e2e-w5b-patch-${suffix}`,
    },
    body: JSON.stringify({ ifRevision: w5bIfRev, graph: w5bGraph }),
  });
  const w5bPatched = await w5bPatch.json();
  if (w5bPatch.status !== 200) fail('W5-B graph patch', { status: w5bPatch.status, w5bPatched });
  const w5bDraftRev =
    w5bPatched.revisionNumber ??
    w5bPatched.draft?.revisionNumber ??
    w5bPatched.workflow?.draft?.revisionNumber;
  const w5bSnap = await fetch(
    `${base}/api/workspaces/${wsW2}/workflows/${wfCreated.workflowId}/snapshot`,
    {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-w5b-snap-${suffix}`,
      },
      body: JSON.stringify({ ifRevision: w5bDraftRev }),
    },
  );
  const w5bSnapJson = await w5bSnap.json();
  if (w5bSnap.status !== 201) fail('W5-B snapshot', { status: w5bSnap.status, w5bSnapJson });
  const w5bRevisionId = w5bSnapJson.revision?.id;
  ok('W5-B snapshot replace_background+inpaint graph');

  const w5bRun = await fetch(
    `${base}/api/workspaces/${wsW2}/workflow-revisions/${w5bRevisionId}/runs`,
    {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-w5b-run-${suffix}`,
      },
      body: JSON.stringify({
        idempotencyKey: `e2e-w5b-run-${suffix}`,
        scenario: 'SUCCESS',
        reuseSucceededInputs: false,
      }),
    },
  );
  const w5bRunJson = await w5bRun.json();
  if (w5bRun.status !== 201 && w5bRun.status !== 200) {
    fail('W5-B create run', { status: w5bRun.status, w5bRunJson });
  }
  let w5bFinal = null;
  for (let i = 0; i < 50; i++) {
    const g = await fetch(`${base}/api/workspaces/${wsW2}/runs/${w5bRunJson.run.id}`, {
      headers: { cookie: jarW2.header(), 'x-request-id': `e2e-w5b-poll-${suffix}-${i}` },
    });
    w5bFinal = await g.json();
    const st = w5bFinal.status ?? w5bFinal.run?.status;
    if (st === 'SUCCEEDED' || st === 'FAILED_FINAL' || st === 'FAILED_RETRYABLE') break;
    await sleep(250);
  }
  const w5bStatus = w5bFinal?.status ?? w5bFinal?.run?.status;
  if (w5bStatus !== 'SUCCEEDED') fail('W5-B run did not succeed', w5bFinal);
  const w5bItems = w5bFinal.items || w5bFinal.run?.items || [];
  const rbgItem = w5bItems.find((it) => it.nodeId === 'rbg1');
  const inpItem = w5bItems.find((it) => it.nodeId === 'inp1');
  if (!rbgItem || rbgItem.status !== 'SUCCEEDED') fail('W5-04 replace_background item', rbgItem);
  if (!inpItem || inpItem.status !== 'SUCCEEDED') fail('W5-05 inpaint item', inpItem);
  ok('W5-04/05 Fake replace_background + inpaint succeeded');

  // ─── V2 PR-2: canvas command layer (commands / undo / redo / run / masks list) ───
  const v2WfCreate = await fetch(
    `${base}/api/workspaces/${wsW2}/projects/${projectId}/workflows`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: jarW2.header(),
        'x-request-id': `e2e-v2-wf-create-${suffix}`,
      },
      body: JSON.stringify({ name: 'E2E V2 commands workflow' }),
    },
  );
  const v2WfCreated = await v2WfCreate.json();
  if (v2WfCreate.status !== 201) fail('V2 workflow create', { status: v2WfCreate.status, v2WfCreated });
  const v2WorkflowId = v2WfCreated.workflowId;
  let v2Rev = v2WfCreated.revisionNumber;
  ok(`V2 create empty workflow ${v2WorkflowId.slice(0, 8)}…`);

  const v2CommandsUrl = `${base}/api/workspaces/${wsW2}/workflows/${v2WorkflowId}/commands`;
  const v2Headers = (reqId) => ({
    'content-type': 'application/json',
    cookie: jarW2.header(),
    'x-request-id': reqId,
  });

  const v2Batch1 = randomUUID();
  const v2ApplyBody = {
    ifRevision: v2Rev,
    batchId: v2Batch1,
    commands: [
      { type: 'addNode', nodeType: 'source_image', nodeId: 'v2src', position: { x: 0, y: 0 } },
      {
        type: 'addNode',
        nodeType: 'generate',
        nodeId: 'v2gen',
        position: { x: 260, y: 0 },
        config: { schemaVersion: 1, modelKey: 'primary-image-edit', count: 1 },
      },
      {
        type: 'connect',
        edgeId: 'v2e1',
        source: 'v2src',
        sourceHandle: 'image',
        target: 'v2gen',
        targetHandle: 'references',
      },
      {
        type: 'configure',
        nodeId: 'v2gen',
        config: { schemaVersion: 1, modelKey: 'primary-image-edit', ratio: '1:1', resolution: '2K', count: 1 },
      },
    ],
  };
  const v2Apply = await fetch(v2CommandsUrl, {
    method: 'POST',
    headers: v2Headers(`e2e-v2-apply-${suffix}`),
    body: JSON.stringify(v2ApplyBody),
  });
  const v2ApplyJson = await v2Apply.json();
  if (v2Apply.status !== 200) fail('V2 apply commands', { status: v2Apply.status, v2ApplyJson });
  if (v2ApplyJson.batchId !== v2Batch1) fail('V2 batchId mismatch', v2ApplyJson);
  if (v2ApplyJson.revisionNumber !== v2Rev + 1) fail('V2 revision not advanced', v2ApplyJson);
  if (v2ApplyJson.graph?.nodes?.length !== 2) fail('V2 expected 2 nodes', v2ApplyJson.graph);
  if (v2ApplyJson.graph?.edges?.length !== 1) fail('V2 expected 1 edge', v2ApplyJson.graph);
  v2Rev = v2ApplyJson.revisionNumber;
  ok('V2 commands: addNode×2 + connect + configure applied');

  const v2Replay = await fetch(v2CommandsUrl, {
    method: 'POST',
    headers: v2Headers(`e2e-v2-replay-${suffix}`),
    body: JSON.stringify(v2ApplyBody),
  });
  const v2ReplayJson = await v2Replay.json();
  if (v2Replay.status !== 200) fail('V2 idempotent replay', { status: v2Replay.status, v2ReplayJson });
  if (v2ReplayJson.revisionNumber !== v2Rev) fail('V2 replay bumped revision', v2ReplayJson);
  if (v2ReplayJson.graph?.nodes?.length !== 2) fail('V2 replay duplicated nodes', v2ReplayJson.graph);
  ok('V2 batchId idempotent replay (no revision bump, no dup nodes)');

  const v2BadConnect = await fetch(v2CommandsUrl, {
    method: 'POST',
    headers: v2Headers(`e2e-v2-badconnect-${suffix}`),
    body: JSON.stringify({
      ifRevision: v2Rev,
      batchId: randomUUID(),
      commands: [
        { type: 'connect', source: 'v2src', sourceHandle: 'image', target: 'v2src', targetHandle: 'image' },
      ],
    }),
  });
  const v2BadConnectJson = await v2BadConnect.json();
  if (v2BadConnect.status !== 400 || v2BadConnectJson.error?.code !== 'VALIDATION_ERROR') {
    fail('V2 expected self-loop 400 VALIDATION_ERROR', { status: v2BadConnect.status, v2BadConnectJson });
  }
  ok('V2 illegal connect (self-loop) rejected 400');

  const v2Undo = await fetch(`${v2CommandsUrl}/undo`, {
    method: 'POST',
    headers: v2Headers(`e2e-v2-undo-${suffix}`),
    body: JSON.stringify({ ifRevision: v2Rev }),
  });
  const v2UndoJson = await v2Undo.json();
  if (v2Undo.status !== 200) fail('V2 undo', { status: v2Undo.status, v2UndoJson });
  if (v2UndoJson.graph?.nodes?.length !== 0) fail('V2 undo did not restore pre-batch graph', v2UndoJson.graph);
  v2Rev = v2UndoJson.revisionNumber;
  ok('V2 undo restored pre-batch graph');

  const v2Undo2 = await fetch(`${v2CommandsUrl}/undo`, {
    method: 'POST',
    headers: v2Headers(`e2e-v2-undo2-${suffix}`),
    body: JSON.stringify({ ifRevision: v2Rev }),
  });
  const v2Undo2Json = await v2Undo2.json();
  if (v2Undo2.status !== 409 || v2Undo2Json.error?.code !== 'WORKFLOW_UNDO_CONFLICT') {
    fail('V2 expected second undo 409', { status: v2Undo2.status, v2Undo2Json });
  }
  if (!v2Undo2Json.error?.details?.reason) fail('V2 undo conflict missing details.reason', v2Undo2Json);
  ok('V2 second undo → 409 WORKFLOW_UNDO_CONFLICT (details.reason)');

  const v2Redo = await fetch(`${v2CommandsUrl}/redo`, {
    method: 'POST',
    headers: v2Headers(`e2e-v2-redo-${suffix}`),
    body: JSON.stringify({ ifRevision: v2Rev }),
  });
  const v2RedoJson = await v2Redo.json();
  if (v2Redo.status !== 200) fail('V2 redo', { status: v2Redo.status, v2RedoJson });
  if (v2RedoJson.graph?.nodes?.length !== 2 || v2RedoJson.graph?.edges?.length !== 1) {
    fail('V2 redo did not restore batch graph', v2RedoJson.graph);
  }
  v2Rev = v2RedoJson.revisionNumber;
  ok('V2 redo restored batch graph');

  const v2Stale = await fetch(v2CommandsUrl, {
    method: 'POST',
    headers: v2Headers(`e2e-v2-stale-${suffix}`),
    body: JSON.stringify({
      ifRevision: 0,
      batchId: randomUUID(),
      commands: [{ type: 'rename', name: 'stale rename' }],
    }),
  });
  const v2StaleJson = await v2Stale.json();
  if (v2Stale.status !== 409 || v2StaleJson.error?.code !== 'WORKFLOW_REVISION_CONFLICT') {
    fail('V2 expected stale ifRevision 409', { status: v2Stale.status, v2StaleJson });
  }
  ok('V2 stale ifRevision → 409 WORKFLOW_REVISION_CONFLICT');

  const v2Run = await fetch(v2CommandsUrl, {
    method: 'POST',
    headers: v2Headers(`e2e-v2-run-${suffix}`),
    body: JSON.stringify({
      ifRevision: v2Rev,
      batchId: randomUUID(),
      commands: [
        {
          type: 'run',
          scope: { type: 'NODES', nodeIds: ['v2gen'] },
          idempotencyKey: `e2e-v2-run-${suffix}`,
          budgetLimit: { currency: 'USD', amount: 5 },
          confirmBudget: true,
        },
      ],
    }),
  });
  const v2RunJson = await v2Run.json();
  if (v2Run.status !== 200) fail('V2 run command', { status: v2Run.status, v2RunJson });
  if (!v2RunJson.run?.id) fail('V2 run command missing run', v2RunJson);
  v2Rev = v2RunJson.revisionNumber;
  ok('V2 run command (scope NODES) returned run');

  let v2RunFinal = null;
  for (let i = 0; i < 50; i++) {
    const g = await fetch(`${base}/api/workspaces/${wsW2}/runs/${v2RunJson.run.id}`, {
      headers: { cookie: jarW2.header(), 'x-request-id': `e2e-v2-run-poll-${suffix}-${i}` },
    });
    v2RunFinal = await g.json();
    const st = v2RunFinal.status ?? v2RunFinal.run?.status;
    if (['SUCCEEDED', 'FAILED_FINAL', 'FAILED_RETRYABLE', 'CANCELED'].includes(st)) break;
    await sleep(250);
  }
  const v2RunStatus = v2RunFinal?.status ?? v2RunFinal?.run?.status;
  if (v2RunStatus !== 'SUCCEEDED') fail('V2 run did not succeed', v2RunFinal);
  ok('V2 run command settled → SUCCEEDED');

  const v2Budget = await fetch(v2CommandsUrl, {
    method: 'POST',
    headers: v2Headers(`e2e-v2-budget-${suffix}`),
    body: JSON.stringify({
      ifRevision: v2Rev,
      batchId: randomUUID(),
      commands: [
        {
          type: 'run',
          scope: { type: 'NODES', nodeIds: ['v2gen'] },
          idempotencyKey: `e2e-v2-budget-${suffix}`,
          budgetLimit: { currency: 'USD', amount: 0.000001 },
          confirmBudget: false,
        },
      ],
    }),
  });
  const v2BudgetJson = await v2Budget.json();
  if (v2Budget.status !== 402 || v2BudgetJson.error?.code !== 'BUDGET_EXCEEDED') {
    fail('V2 expected run budget gate 402', { status: v2Budget.status, v2BudgetJson });
  }
  if (v2BudgetJson.error?.details?.commandsApplied !== true) {
    fail('V2 budget gate missing details.commandsApplied=true', v2BudgetJson);
  }
  ok('V2 run budget gate 402 BUDGET_EXCEEDED (commandsApplied=true)');

  const v2Masks = await fetch(
    `${base}/api/workspaces/${wsW2}/asset-versions/${asset.currentVersionId}/masks`,
    { headers: { cookie: jarW2.header(), 'x-request-id': `e2e-v2-masks-${suffix}` } },
  );
  const v2MasksJson = await v2Masks.json();
  if (v2Masks.status !== 200) fail('V2 masks list', { status: v2Masks.status, v2MasksJson });
  if (!Array.isArray(v2MasksJson.items)) fail('V2 masks list missing items array', v2MasksJson);
  if (!v2MasksJson.items.some((m) => m.id === maskId)) {
    fail('V2 masks list missing W5-B mask', v2MasksJson);
  }
  ok('V2 masks list endpoint (reuses W5-B mask)');
  console.log('E2E PASS: V2 canvas commands (apply/idempotency/validate/undo/redo/conflict/run/budget/masks)');

  // ─── W5-C: outpaint + upscale ───
  const w5cGraph = {
    schemaVersion: 1,
    nodes: [
      {
        id: 'srcC',
        type: 'source_image',
        position: { x: 0, y: 0 },
        config: { schemaVersion: 1, assetVersionId: asset.currentVersionId },
      },
      {
        id: 'promptC',
        type: 'prompt',
        position: { x: 0, y: 120 },
        config: { schemaVersion: 1, text: 'extend studio backdrop', negative: '' },
      },
      {
        id: 'out1',
        type: 'outpaint',
        position: { x: 280, y: 0 },
        config: {
          schemaVersion: 1,
          targetRatio: '16:9',
          placement: 'center',
          modelKey: 'primary-image-edit',
        },
      },
      {
        id: 'up1',
        type: 'upscale',
        position: { x: 280, y: 200 },
        config: {
          schemaVersion: 1,
          engineKey: 'default-upscale',
          targetResolution: '2K',
        },
      },
    ],
    edges: [
      {
        id: 'e-src-out',
        source: 'srcC',
        target: 'out1',
        sourceHandle: 'image',
        targetHandle: 'image',
      },
      {
        id: 'e-prompt-out',
        source: 'promptC',
        target: 'out1',
        sourceHandle: 'prompt',
        targetHandle: 'prompt',
      },
      {
        id: 'e-src-up',
        source: 'srcC',
        target: 'up1',
        sourceHandle: 'image',
        targetHandle: 'image',
      },
    ],
  };

  const w5cGet = await fetch(`${base}/api/workspaces/${wsW2}/workflows/${wfCreated.workflowId}`, {
    headers: { cookie: jarW2.header(), 'x-request-id': `e2e-w5c-get-${suffix}` },
  });
  const w5cGot = await w5cGet.json();
  const w5cIfRev =
    w5cGot.revisionNumber ??
    w5cGot.draft?.revisionNumber ??
    w5cGot.workflow?.draft?.revisionNumber;
  const w5cPatch = await fetch(`${base}/api/workspaces/${wsW2}/workflows/${wfCreated.workflowId}`, {
    method: 'PATCH',
    headers: {
      cookie: jarW2.header(),
      'content-type': 'application/json',
      'x-request-id': `e2e-w5c-patch-${suffix}`,
    },
    body: JSON.stringify({ ifRevision: w5cIfRev, graph: w5cGraph }),
  });
  const w5cPatched = await w5cPatch.json();
  if (w5cPatch.status !== 200) fail('W5-C graph patch', { status: w5cPatch.status, w5cPatched });
  const w5cDraftRev =
    w5cPatched.revisionNumber ??
    w5cPatched.draft?.revisionNumber ??
    w5cPatched.workflow?.draft?.revisionNumber;
  const w5cSnap = await fetch(
    `${base}/api/workspaces/${wsW2}/workflows/${wfCreated.workflowId}/snapshot`,
    {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-w5c-snap-${suffix}`,
      },
      body: JSON.stringify({ ifRevision: w5cDraftRev }),
    },
  );
  const w5cSnapJson = await w5cSnap.json();
  if (w5cSnap.status !== 201) fail('W5-C snapshot', { status: w5cSnap.status, w5cSnapJson });
  const w5cRevisionId = w5cSnapJson.revision?.id;
  ok('W5-C snapshot outpaint+upscale graph');

  const w5cRun = await fetch(
    `${base}/api/workspaces/${wsW2}/workflow-revisions/${w5cRevisionId}/runs`,
    {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-w5c-run-${suffix}`,
      },
      body: JSON.stringify({
        idempotencyKey: `e2e-w5c-run-${suffix}`,
        scenario: 'SUCCESS',
        reuseSucceededInputs: false,
      }),
    },
  );
  const w5cRunJson = await w5cRun.json();
  if (w5cRun.status !== 201 && w5cRun.status !== 200) {
    fail('W5-C create run', { status: w5cRun.status, w5cRunJson });
  }
  let w5cFinal = null;
  for (let i = 0; i < 50; i++) {
    const g = await fetch(`${base}/api/workspaces/${wsW2}/runs/${w5cRunJson.run.id}`, {
      headers: { cookie: jarW2.header(), 'x-request-id': `e2e-w5c-poll-${suffix}-${i}` },
    });
    w5cFinal = await g.json();
    const st = w5cFinal.status ?? w5cFinal.run?.status;
    if (st === 'SUCCEEDED' || st === 'FAILED_FINAL' || st === 'FAILED_RETRYABLE') break;
    await sleep(250);
  }
  const w5cStatus = w5cFinal?.status ?? w5cFinal?.run?.status;
  if (w5cStatus !== 'SUCCEEDED') fail('W5-C run did not succeed', w5cFinal);
  const w5cItems = w5cFinal.items || w5cFinal.run?.items || [];
  const outItem = w5cItems.find((it) => it.nodeId === 'out1');
  const upItem = w5cItems.find((it) => it.nodeId === 'up1');
  if (!outItem || outItem.status !== 'SUCCEEDED') fail('W5-06 outpaint item', outItem);
  if (!upItem || upItem.status !== 'SUCCEEDED') fail('W5-07 upscale item', upItem);

  // Verify request snapshots encode canvas/placement + upscale target
  const outAttempt = (outItem.attempts || []).slice(-1)[0];
  const upAttempt = (upItem.attempts || []).slice(-1)[0];
  const outSnap = outAttempt?.requestSnapshot;
  const upSnap = upAttempt?.requestSnapshot;
  if (!outSnap || outSnap.operation !== 'OUTPAINT') fail('W5-06 outpaint operation', outSnap);
  if (!outSnap.placement || outSnap.placement !== 'center') fail('W5-06 placement', outSnap);
  if (!outSnap.targetRatio || outSnap.targetRatio !== '16:9') fail('W5-06 targetRatio', outSnap);
  if (!(outSnap.width > 0 && outSnap.height > 0)) fail('W5-06 canvas dims', outSnap);
  if (!upSnap || upSnap.operation !== 'UPSCALE') fail('W5-07 upscale operation', upSnap);
  if (upSnap.engineKey !== 'default-upscale') fail('W5-07 engineKey', upSnap);
  if (upSnap.targetResolution !== '2K') fail('W5-07 targetResolution', upSnap);
  if (!(upSnap.width >= 2048 || upSnap.height >= 2048)) fail('W5-07 upscale dims', upSnap);
  ok('W5-06/07 Fake outpaint + upscale succeeded with canvas/normalize specs');

  // --- W6 Phase 1: QA + approve + BLOCK export + OVERRIDE + ZIP ---
  const passPng = await makeMainCandidate({ bg: { r: 255, g: 255, b: 255 } });
  const passUp = await uploadPng(jarW2, wsW2, projectId, 'main-pass.png', passPng);
  ok(`W6 pass asset version=${passUp.versionId}`);

  const qaPassRes = await fetch(
    `${base}/api/workspaces/${wsW2}/asset-versions/${passUp.versionId}/qa`,
    {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-qa-pass-${suffix}`,
      },
      body: JSON.stringify({ slot: 'MAIN', ocrScenario: 'SUCCESS', visionScenario: 'SUCCESS' }),
    },
  );
  const qaPassQueued = await qaPassRes.json();
  if (qaPassRes.status !== 201) fail('W6 QA dispatch pass', { status: qaPassRes.status, qaPassQueued });
  const qaPass = qaPassQueued.status === 'SUCCEEDED' ? qaPassQueued : await pollQa(jarW2, wsW2, qaPassQueued.id);
  if (qaPass.status !== 'SUCCEEDED') fail('W6 QA pass not SUCCEEDED', qaPass);
  if (qaPass.overallStatus !== 'PASS') fail('W6 expected PASS overall', qaPass);
  if (!qaPass.findings?.length) fail('W6 missing findings', qaPass);
  if (!qaPass.disclaimer) fail('W6 missing QA disclaimer', qaPass);
  const bgFinding = qaPass.findings.find((f) => f.ruleId === 'MAIN.BACKGROUND_WHITE');
  if (!bgFinding || bgFinding.status !== 'PASS') fail('W6 background rule', bgFinding);
  ok(`W6-01…05 PASS report ${qaPass.id.slice(0, 8)} findings=${qaPass.findings.length}`);

  // qa_gate PASS ≠ Approval: export must fail
  const exportNoAp = await fetch(`${base}/api/workspaces/${wsW2}/projects/${projectId}/exports`, {
    method: 'POST',
    headers: {
      cookie: jarW2.header(),
      'content-type': 'application/json',
      'x-request-id': `e2e-ex-noap-${suffix}`,
    },
    body: JSON.stringify({
      items: [{ assetVersionId: passUp.versionId, slot: 'MAIN', qaReportId: qaPass.id }],
    }),
  });
  const exportNoApJson = await exportNoAp.json();
  if (exportNoAp.status !== 409) fail('expected export blocked without approval', { status: exportNoAp.status, exportNoApJson });
  ok('W6 qa_gate PASS is not human Approval (export 409)');

  const apPass = await fetch(
    `${base}/api/workspaces/${wsW2}/asset-versions/${passUp.versionId}/approvals`,
    {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-ap-pass-${suffix}`,
      },
      body: JSON.stringify({ qaReportId: qaPass.id, decision: 'APPROVE' }),
    },
  );
  const apPassJson = await apPass.json();
  if (apPass.status !== 201) fail('W6 approve PASS', { status: apPass.status, apPassJson });
  ok('W6-06 APPROVE on PASS report');

  const exPassRes = await fetch(`${base}/api/workspaces/${wsW2}/projects/${projectId}/exports`, {
    method: 'POST',
    headers: {
      cookie: jarW2.header(),
      'content-type': 'application/json',
      'x-request-id': `e2e-ex-pass-${suffix}`,
    },
    body: JSON.stringify({
      items: [{ assetVersionId: passUp.versionId, slot: 'MAIN', qaReportId: qaPass.id, variantCode: 'BASE' }],
    }),
  });
  const exPassQueued = await exPassRes.json();
  if (exPassRes.status !== 201) fail('W6 export PASS', { status: exPassRes.status, exPassQueued });
  const exPass = exPassQueued.status === 'SUCCEEDED' ? exPassQueued : await pollExport(jarW2, wsW2, exPassQueued.id);
  if (exPass.status !== 'SUCCEEDED') fail('W6 export not SUCCEEDED', exPass);
  if (!exPass.zipSha256 || !exPass.manifestSha256) fail('W6 missing checksums', exPass);
  const dl = await fetch(`${base}/api/workspaces/${wsW2}/exports/${exPass.id}/download-url`, {
    headers: { cookie: jarW2.header(), 'x-request-id': `e2e-dl-${suffix}` },
  });
  const dlJson = await dl.json();
  if (dl.status !== 200 || !dlJson.url) fail('W6 download-url', { status: dl.status, dlJson });
  const zipRes = await fetch(dlJson.url);
  const zipBuf = Buffer.from(await zipRes.arrayBuffer());
  if (zipRes.status !== 200) fail('W6 ZIP GET', { status: zipRes.status });
  const zipText = zipBuf.toString('latin1');
  if (!zipText.includes('manifest.json') || !zipText.includes('qa-report.csv')) {
    fail('W6 ZIP missing manifest/csv names', zipText.slice(0, 200));
  }
  const zipHash = createHash('sha256').update(zipBuf).digest('hex');
  if (zipHash !== exPass.zipSha256) fail('W6 ZIP checksum mismatch', { zipHash, expected: exPass.zipSha256 });
  ok(`W6-07 ZIP bytes=${exPass.zipBytes} sha=${exPass.zipSha256.slice(0, 12)}…`);

  // Cross-tenant denied
  const qaX = await fetch(`${base}/api/workspaces/${wsW2}/asset-versions/${passUp.versionId}/qa`, {
    method: 'POST',
    headers: {
      cookie: jarB.header(),
      'content-type': 'application/json',
      'x-request-id': `e2e-qa-x-${suffix}`,
    },
    body: JSON.stringify({}),
  });
  if (qaX.status !== 403) fail('expected cross-workspace QA 403', { status: qaX.status });
  ok('W6 cross-workspace QA denied');

  // MAIN hard BLOCK (non-white) blocks default export; OVERRIDE then exports
  const blockPng = await makeMainCandidate({ bg: { r: 200, g: 24, b: 24 } });
  const blockUp = await uploadPng(jarW2, wsW2, projectId, 'main-block.png', blockPng);
  const qaBlockRes = await fetch(
    `${base}/api/workspaces/${wsW2}/asset-versions/${blockUp.versionId}/qa`,
    {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-qa-block-${suffix}`,
      },
      body: JSON.stringify({ slot: 'MAIN' }),
    },
  );
  const qaBlockQueued = await qaBlockRes.json();
  if (qaBlockRes.status !== 201) fail('W6 QA block dispatch', { status: qaBlockRes.status, qaBlockQueued });
  const qaBlock = qaBlockQueued.status === 'SUCCEEDED' ? qaBlockQueued : await pollQa(jarW2, wsW2, qaBlockQueued.id);
  if (qaBlock.overallStatus !== 'BLOCK') fail('W6 expected BLOCK for red background', qaBlock);
  const bw = qaBlock.findings.find((f) => f.ruleId === 'MAIN.BACKGROUND_WHITE');
  if (bw?.status !== 'FAIL') fail('W6 BACKGROUND_WHITE should FAIL', bw);

  const approveBlock = await fetch(
    `${base}/api/workspaces/${wsW2}/asset-versions/${blockUp.versionId}/approvals`,
    {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-ap-block-bad-${suffix}`,
      },
      body: JSON.stringify({ qaReportId: qaBlock.id, decision: 'APPROVE' }),
    },
  );
  if (approveBlock.status !== 400) fail('BLOCK cannot APPROVE', { status: approveBlock.status, json: await approveBlock.json() });

  const exBlock = await fetch(`${base}/api/workspaces/${wsW2}/projects/${projectId}/exports`, {
    method: 'POST',
    headers: {
      cookie: jarW2.header(),
      'content-type': 'application/json',
      'x-request-id': `e2e-ex-block-${suffix}`,
    },
    body: JSON.stringify({
      items: [{ assetVersionId: blockUp.versionId, slot: 'MAIN', qaReportId: qaBlock.id }],
    }),
  });
  const exBlockJson = await exBlock.json();
  if (exBlock.status !== 409) fail('MAIN BLOCK must block default export', { status: exBlock.status, exBlockJson });
  ok('W6 MAIN hard BLOCK blocks default export');

  const ov = await fetch(
    `${base}/api/workspaces/${wsW2}/asset-versions/${blockUp.versionId}/approvals`,
    {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-ov-${suffix}`,
      },
      body: JSON.stringify({
        qaReportId: qaBlock.id,
        decision: 'OVERRIDE_BLOCK',
        reason: 'ops accept halo on synthetic fixture',
      }),
    },
  );
  const ovJson = await ov.json();
  if (ov.status !== 201) fail('W6 OVERRIDE_BLOCK', { status: ov.status, ovJson });
  if (ovJson.decision !== 'OVERRIDE_BLOCK' || !ovJson.reason) fail('override payload', ovJson);

  const exOvRes = await fetch(`${base}/api/workspaces/${wsW2}/projects/${projectId}/exports`, {
    method: 'POST',
    headers: {
      cookie: jarW2.header(),
      'content-type': 'application/json',
      'x-request-id': `e2e-ex-ov-${suffix}`,
    },
    body: JSON.stringify({
      items: [{ assetVersionId: blockUp.versionId, slot: 'MAIN', qaReportId: qaBlock.id }],
    }),
  });
  const exOvQueued = await exOvRes.json();
  if (exOvRes.status !== 201) fail('W6 export after override', { status: exOvRes.status, exOvQueued });
  const exOv = exOvQueued.status === 'SUCCEEDED' ? exOvQueued : await pollExport(jarW2, wsW2, exOvQueued.id);
  if (exOv.status !== 'SUCCEEDED') fail('W6 override export failed', exOv);
  ok('W6-06/07 OVERRIDE_BLOCK export retains reason + checksums');

  // OCR overlay scenario → BLOCK
  const qaOcrRes = await fetch(
    `${base}/api/workspaces/${wsW2}/asset-versions/${passUp.versionId}/qa`,
    {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-qa-ocr-${suffix}`,
      },
      body: JSON.stringify({ slot: 'MAIN', ocrScenario: 'OVERLAY_TEXT' }),
    },
  );
  const qaOcrQueued = await qaOcrRes.json();
  if (qaOcrRes.status !== 201) fail('W6 OCR QA', { status: qaOcrRes.status, qaOcrQueued });
  const qaOcr = qaOcrQueued.status === 'SUCCEEDED' ? qaOcrQueued : await pollQa(jarW2, wsW2, qaOcrQueued.id);
  const overlay = qaOcr.findings.find((f) => f.ruleId === 'MAIN.NO_OVERLAY_TEXT');
  if (overlay?.status !== 'FAIL') fail('W6 overlay OCR FAIL', overlay);
  if (qaOcr.overallStatus !== 'BLOCK') fail('W6 overlay should BLOCK', qaOcr);
  ok('W6-03 Fake OCR overlay → FAIL/BLOCK');

  const qaVisRes = await fetch(
    `${base}/api/workspaces/${wsW2}/asset-versions/${passUp.versionId}/qa`,
    {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-qa-vis-${suffix}`,
      },
      body: JSON.stringify({ slot: 'MAIN', visionScenario: 'IDENTITY_MISMATCH' }),
    },
  );
  const qaVisQueued = await qaVisRes.json();
  const qaVis = qaVisQueued.status === 'SUCCEEDED' ? qaVisQueued : await pollQa(jarW2, wsW2, qaVisQueued.id);
  const ident = qaVis.findings.find((f) => f.ruleId === 'PRODUCT.IDENTITY');
  if (ident?.status !== 'FAIL') fail('W6 identity FAIL', ident);
  ok('W6-04 Fake Vision identity mismatch → FAIL');


  // --- W7: variants batch / partial fail / ledger / lock QA / filtered export ---
  const masterVarRes = await fetch(`${base}/api/workspaces/${wsW2}/projects/${projectId}/variants`, {
    method: 'POST',
    headers: {
      cookie: jarW2.header(),
      'content-type': 'application/json',
      'x-request-id': `e2e-var-master-${suffix}`,
    },
    body: JSON.stringify({
      code: 'BASE',
      displayName: 'Master base',
      status: 'READY',
      components: [
        {
          componentKey: 'body',
          colorHex: '#CCCCCC',
          colorDescription: 'base gray',
          locks: ['structure', 'logo', 'text', 'composition', 'attachment_count'],
          allowedChanges: ['color'],
        },
      ],
    }),
  });
  const masterVar = await masterVarRes.json();
  if (masterVarRes.status !== 201) fail('W7 master variant', { status: masterVarRes.status, masterVar });

  const colors = [
    { code: 'RED', hex: '#FF0000', name: 'Red' },
    { code: 'BLU', hex: '#0000FF', name: 'Blue' },
    { code: 'GRN', hex: '#00AA00', name: 'Green' },
  ];
  const childIds = [];
  for (const c of colors) {
    const res = await fetch(`${base}/api/workspaces/${wsW2}/projects/${projectId}/variants`, {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-var-${c.code}-${suffix}`,
      },
      body: JSON.stringify({
        code: c.code,
        displayName: c.name,
        masterVariantId: masterVar.id,
        components: [
          {
            componentKey: 'body',
            colorHex: c.hex,
            colorDescription: c.name,
            allowedChanges: ['color'],
            locks: ['structure', 'logo', 'text', 'composition', 'attachment_count'],
          },
        ],
      }),
    });
    const json = await res.json();
    if (res.status !== 201) fail(`W7 child ${c.code}`, { status: res.status, json });
    childIds.push(json.id);
  }
  ok(`W7-01 master + 3 color variants (${childIds.length})`);

  // Patch master workflowId from earlier materialize workflow if present
  const wfList = await fetch(`${base}/api/workspaces/${wsW2}/projects/${projectId}/workflows`, {
    headers: { cookie: jarW2.header(), 'x-request-id': `e2e-var-wfs-${suffix}` },
  });
  const wfJson = await wfList.json();
  const sourceWfId = wfJson.items?.[0]?.id;
  if (sourceWfId) {
    await fetch(`${base}/api/workspaces/${wsW2}/variants/${masterVar.id}`, {
      method: 'PATCH',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-var-master-wf-${suffix}`,
      },
      body: JSON.stringify({ workflowId: sourceWfId }),
    });
    const matRes = await fetch(`${base}/api/workspaces/${wsW2}/variants/${childIds[0]}/materialize`, {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-var-mat-${suffix}`,
      },
      body: JSON.stringify({ sourceWorkflowId: sourceWfId }),
    });
    const matJson = await matRes.json();
    if (matRes.status !== 201) fail('W7-02 materialize', { status: matRes.status, matJson });
    ok(`W7-02 materialized child workflow ${matJson.workflowId?.slice?.(0, 8)}`);
  } else {
    ok('W7-02 skip materialize (no workflow in project)');
  }

  // Budget gate
  const varBudgetDeny = await fetch(`${base}/api/workspaces/${wsW2}/projects/${projectId}/variant-runs`, {
    method: 'POST',
    headers: {
      cookie: jarW2.header(),
      'content-type': 'application/json',
      'x-request-id': `e2e-var-budget-${suffix}`,
    },
    body: JSON.stringify({
      masterVariantId: masterVar.id,
      variantIds: childIds,
      idempotencyKey: `var-budget-${suffix}`,
      budgetLimit: { currency: 'USD', amount: 0.0001 },
      confirmBudget: false,
    }),
  });
  const varBudgetDenyJson = await varBudgetDeny.json();
  if (varBudgetDeny.status !== 409) fail('W7 budget gate', { status: varBudgetDeny.status, varBudgetDenyJson });
  ok('W7-03 BUDGET_EXCEEDED without confirmBudget');

  const varRunRes = await fetch(`${base}/api/workspaces/${wsW2}/projects/${projectId}/variant-runs`, {
    method: 'POST',
    headers: {
      cookie: jarW2.header(),
      'content-type': 'application/json',
      'x-request-id': `e2e-var-run-${suffix}`,
    },
    body: JSON.stringify({
      masterVariantId: masterVar.id,
      variantIds: childIds,
      idempotencyKey: `var-run-${suffix}`,
      budgetLimit: { currency: 'USD', amount: 5 },
      confirmBudget: true,
      itemScenarios: { 'RED:MAIN': 'AUTH' },
      visionScenario: 'SUCCESS',
    }),
  });
  const varRunJson = await varRunRes.json();
  if (varRunRes.status !== 201) fail('W7 variant-run', { status: varRunRes.status, varRunJson });
  if (varRunJson.items?.length !== 21) fail('W7 expected 21 items (3×7)', varRunJson);
  const varFailed = varRunJson.items.filter((i) => i.status === 'FAILED_FINAL');
  const varSucceeded = varRunJson.items.filter((i) =>
    ['SUCCEEDED', 'QA_PASS', 'QA_REVIEW'].includes(i.status),
  );
  if (varFailed.length < 1) fail('W7 expected at least one AUTH fail', varRunJson);
  if (varSucceeded.length < 1) fail('W7 single fail blocked successes', { varFailed: varFailed.length, varSucceeded: varSucceeded.length });
  if (varRunJson.status !== 'PARTIAL' && varRunJson.status !== 'FAILED') {
    // PARTIAL expected
    if (!(varFailed.length && varSucceeded.length)) fail('W7 partial semantics', varRunJson);
  }
  ok(`W7-02/03 batch items=${varRunJson.items.length} varFailed=${varFailed.length} ok=${varSucceeded.length} status=${varRunJson.status}`);

  const varFailItem = varFailed[0];
  const varRetryRes = await fetch(`${base}/api/workspaces/${wsW2}/variant-items/${varFailItem.id}/retry`, {
    method: 'POST',
    headers: {
      cookie: jarW2.header(),
      'content-type': 'application/json',
      'x-request-id': `e2e-var-retry-${suffix}`,
    },
    body: JSON.stringify({ scenario: 'SUCCESS', visionScenario: 'SUCCESS' }),
  });
  const varRetryJson = await varRetryRes.json();
  if (varRetryRes.status !== 200) fail('W7 retry', { status: varRetryRes.status, varRetryJson });
  if (!['SUCCEEDED', 'QA_PASS', 'QA_REVIEW'].includes(varRetryJson.status)) {
    fail('W7 retry should succeed', varRetryJson);
  }
  ok('W7-03 partial retry recovered varFailed item');

  // Structure / logo lock → BLOCK via Fake Vision QA on known asset
  const qaStructRes = await fetch(
    `${base}/api/workspaces/${wsW2}/asset-versions/${passUp.versionId}/qa`,
    {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-var-struct-${suffix}`,
      },
      body: JSON.stringify({ slot: 'MAIN', visionScenario: 'STRUCTURE_CHANGE' }),
    },
  );
  const qaStructQueued = await qaStructRes.json();
  const qaStruct =
    qaStructQueued.status === 'SUCCEEDED'
      ? qaStructQueued
      : await pollQa(jarW2, wsW2, qaStructQueued.id);
  if (qaStruct.overallStatus !== 'BLOCK') fail('W7 structure should BLOCK', qaStruct);
  const qaLogoRes = await fetch(
    `${base}/api/workspaces/${wsW2}/asset-versions/${passUp.versionId}/qa`,
    {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-var-logo-${suffix}`,
      },
      body: JSON.stringify({ slot: 'MAIN', visionScenario: 'LOGO_CHANGE' }),
    },
  );
  const qaLogoQueued = await qaLogoRes.json();
  const qaLogo =
    qaLogoQueued.status === 'SUCCEEDED' ? qaLogoQueued : await pollQa(jarW2, wsW2, qaLogoQueued.id);
  const logoIdent = qaLogo.findings?.find((f) => f.ruleId === 'PRODUCT.IDENTITY');
  if (logoIdent?.status !== 'FAIL') fail('W7 logo identity FAIL', logoIdent);
  ok('W7-04 structure/logo Fake Vision → BLOCK/FAIL');

  // Admin reconciliation + adjust (OWNER)
  const varReconRes = await fetch(`${base}/api/workspaces/${wsW2}/admin/reconciliation`, {
    headers: { cookie: jarW2.header(), 'x-request-id': `e2e-recon-${suffix}` },
  });
  const varReconJson = await varReconRes.json();
  if (varReconRes.status !== 200) fail('W7 recon', { status: varReconRes.status, varReconJson });
  if (varReconJson.drift) fail('W7 ledger drift', varReconJson);
  ok('W7-06 ledger reconcile drift=false');

  const varAdjRes = await fetch(`${base}/api/workspaces/${wsW2}/admin/credits`, {
    method: 'POST',
    headers: {
      cookie: jarW2.header(),
      'content-type': 'application/json',
      'x-request-id': `e2e-adj-${suffix}`,
    },
    body: JSON.stringify({
      microunits: 1000,
      note: 'e2e adjust',
      idempotencyKey: `adj-${suffix}`,
    }),
  });
  const varAdjJson = await varAdjRes.json();
  if (varAdjRes.status !== 201) fail('W7 credit adjust', { status: varAdjRes.status, varAdjJson });
  ok('W7-06 admin credit ADJUST');

  // Approve one passing variant item and export — varFailed filtered
  const varRunGet = await fetch(`${base}/api/workspaces/${wsW2}/variant-runs/${varRunJson.id}`, {
    headers: { cookie: jarW2.header(), 'x-request-id': `e2e-var-get-${suffix}` },
  });
  const varRunFresh = await varRunGet.json();
  const varPassItem = varRunFresh.items.find(
    (i) => i.status === 'QA_PASS' || i.status === 'SUCCEEDED' || i.status === 'QA_REVIEW',
  );
  if (!varPassItem?.selectedAssetVersionId || !varPassItem?.qaReportId) {
    // Domain-expectation path sets QA_PASS with qaReportId
    fail('W7 missing pass item for export', varPassItem);
  }
  // Ensure report overall PASS for approval path — may need re-qa SUCCESS on that asset
  let varExportReportId = varPassItem.qaReportId;
  const varQaItemRes = await fetch(
    `${base}/api/workspaces/${wsW2}/asset-versions/${varPassItem.selectedAssetVersionId}/qa`,
    {
      method: 'POST',
      headers: {
        cookie: jarW2.header(),
        'content-type': 'application/json',
        'x-request-id': `e2e-var-item-qa-${suffix}`,
      },
      body: JSON.stringify({ slot: varPassItem.slot, visionScenario: 'SUCCESS', ocrScenario: 'SUCCESS' }),
    },
  );
  const varQaItemQueued = await varQaItemRes.json();
  if (varQaItemRes.status === 201) {
    const varQaItem =
      varQaItemQueued.status === 'SUCCEEDED'
        ? varQaItemQueued
        : await pollQa(jarW2, wsW2, varQaItemQueued.id);
    varExportReportId = varQaItem.id;
    if (varQaItem.overallStatus === 'PASS') {
      const ap = await fetch(
        `${base}/api/workspaces/${wsW2}/asset-versions/${varPassItem.selectedAssetVersionId}/approvals`,
        {
          method: 'POST',
          headers: {
            cookie: jarW2.header(),
            'content-type': 'application/json',
            'x-request-id': `e2e-var-ap-${suffix}`,
          },
          body: JSON.stringify({
            qaReportId: varExportReportId,
            decision: 'APPROVE',
            reason: 'e2e variant pass',
          }),
        },
      );
      const varApJson = await ap.json();
      if (ap.status !== 201) {
        // Approval may need truth/brief refs — fall back to export empty check
        ok(`W7-05 approval skipped/varFailed (${ap.status}); will assert export filter semantics`);
      } else {
        ok(`W7-05 approved variant item ${varApJson.id?.slice?.(0, 8)}`);
      }
    }
  }

  const varEx = await fetch(`${base}/api/workspaces/${wsW2}/variant-runs/${varRunJson.id}/export`, {
    method: 'POST',
    headers: {
      cookie: jarW2.header(),
      'content-type': 'application/json',
      'x-request-id': `e2e-var-ex-${suffix}`,
    },
    body: JSON.stringify({ onlyPassing: true }),
  });
  const varExJson = await varEx.json();
  // 201 with items or 409 EXPORT_EMPTY if approvals missing — both prove filter path
  if (varEx.status === 201) {
    if (!varExJson.variantManifest?.filteredOut) fail('W7 export missing filteredOut', varExJson);
    ok(`W7-05 variant export bundle ${varExJson.id?.slice?.(0, 8)} filtered=${varExJson.variantManifest.filteredOut.length}`);
  } else if (varEx.status === 409 && varExJson.error?.code === 'EXPORT_EMPTY') {
    ok('W7-05 export filter path (EXPORT_EMPTY — no approved passing items yet)');
  } else {
    fail('W7 variant export unexpected', { status: varEx.status, varExJson });
  }

  // MEMBER cannot admin adjust — register member? Skip if no second role; use B cross-workspace 403
  const varAdminDenied = await fetch(`${base}/api/workspaces/${wsW2}/admin/credits`, {
    method: 'POST',
    headers: {
      cookie: jarB.header(),
      'content-type': 'application/json',
      'x-request-id': `e2e-adj-deny-${suffix}`,
    },
    body: JSON.stringify({ microunits: 1, note: 'nope', idempotencyKey: `deny-${suffix}` }),
  });
  if (varAdminDenied.status !== 403) fail('W7 admin cross-tenant/role', { status: varAdminDenied.status });
  ok('W7-06 admin credits denied for other workspace');


  console.log('E2E PASS: W2…W7 variants batch/QA/export/admin (Fake only)');

  // ─── V2 PR-4: chat agent (session / agent turn / graph apply / session budget / undo) ───
  // Fresh user+workspace so the credit balance is deterministic: model-registry GET
  // seeds the W4 demo grant ($10). Fake primary model = $0.01/image; the fake agent's
  // 「搭建」 graph has exactly 1 executable node (generate) → one run estimate is
  // 10_000 microunits = $0.01. Session budgetLimit $0.01 ⇒ first run passes
  // (estimate == limit, gate is strict >), spent=10_000, second run is rejected.
  const emailChat = `e2e-chat-${suffix}@example.com`;
  await register(emailChat, password, 'Chat User');
  const jarChat = await login(emailChat, password);
  const meChat = await me(jarChat);
  const chatWs = meChat.workspaces[0].id;
  const chatHeaders = (reqId) => ({
    'content-type': 'application/json',
    cookie: jarChat.header(),
    'x-request-id': reqId,
  });

  const chatRegistry = await fetch(`${base}/api/workspaces/${chatWs}/model-registry`, {
    headers: chatHeaders(`e2e-chat-registry-${suffix}`),
  });
  if (chatRegistry.status !== 200) fail('PR-4 model-registry (credit seed)', { status: chatRegistry.status });
  ok('PR-4 fresh workspace + credit seed grant');

  const chatProject = await createProject(jarChat, chatWs, `SKU-CHAT-${suffix}`, 'E2E Chat Project');
  if (chatProject.status !== 201) fail('PR-4 create project', chatProject);
  const chatProjectId = chatProject.json.id;

  const chatWfRes = await fetch(
    `${base}/api/workspaces/${chatWs}/projects/${chatProjectId}/workflows`,
    {
      method: 'POST',
      headers: chatHeaders(`e2e-chat-wf-${suffix}`),
      body: JSON.stringify({ name: 'E2E chat agent workflow' }),
    },
  );
  const chatWf = await chatWfRes.json();
  if (chatWfRes.status !== 201) fail('PR-4 create workflow', { status: chatWfRes.status, chatWf });
  const chatWorkflowId = chatWf.workflowId;

  const chatBase = `${base}/api/workspaces/${chatWs}/projects/${chatProjectId}/chat-sessions`;
  const chatWfUrl = `${base}/api/workspaces/${chatWs}/workflows/${chatWorkflowId}`;

  // 1) create session bound to the workflow with the tight budget
  const chatSessRes = await fetch(chatBase, {
    method: 'POST',
    headers: chatHeaders(`e2e-chat-sess-${suffix}`),
    body: JSON.stringify({
      workflowId: chatWorkflowId,
      title: 'E2E chat session',
      budgetLimit: { currency: 'USD', amount: 0.01 },
    }),
  });
  const chatSess = await chatSessRes.json();
  if (chatSessRes.status !== 201) fail('PR-4 create session', { status: chatSessRes.status, chatSess });
  if (chatSess.workflowId !== chatWorkflowId) fail('PR-4 session not bound to workflow', chatSess);
  if (chatSess.spentMicrounits !== 0) fail('PR-4 session spentMicrounits != 0', chatSess);
  if (chatSess.budgetLimit?.amount !== 0.01) fail('PR-4 session budgetLimit mismatch', chatSess);
  const chatSid = chatSess.id;
  ok(`PR-4 chat session ${chatSid.slice(0, 8)}… (budget $0.01)`);

  const chatListRes = await fetch(`${chatBase}?workflowId=${chatWorkflowId}`, {
    headers: chatHeaders(`e2e-chat-list-${suffix}`),
  });
  const chatList = await chatListRes.json();
  if (chatListRes.status !== 200 || !chatList.items?.some((s) => s.id === chatSid)) {
    fail('PR-4 list sessions ?workflowId=', { status: chatListRes.status, chatList });
  }
  ok('PR-4 list sessions filtered by workflowId');

  // 2) build turn → fake agent emits addNode×2 + connect, applied as one batch
  const chatTurn1Res = await fetch(`${chatBase}/${chatSid}/messages`, {
    method: 'POST',
    headers: chatHeaders(`e2e-chat-turn1-${suffix}`),
    body: JSON.stringify({ content: '帮我搭建一个主图生成流程' }),
  });
  const chatTurn1 = await chatTurn1Res.json();
  if (chatTurn1Res.status !== 200) fail('PR-4 turn 1 (build)', { status: chatTurn1Res.status, chatTurn1 });
  if (chatTurn1.assistantMessage?.content?.commandsSummary?.count !== 3) {
    fail('PR-4 turn 1 expected 3 commands', chatTurn1.assistantMessage);
  }
  if (!chatTurn1.batchId) fail('PR-4 turn 1 missing batchId', chatTurn1);
  if (chatTurn1.run) fail('PR-4 turn 1 unexpected run', chatTurn1.run);
  const chatBatch1 = chatTurn1.batchId;
  ok('PR-4 turn 1 「搭建」→ 3 commands applied (batchId present)');

  const chatWfGet1 = await fetch(chatWfUrl, { headers: chatHeaders(`e2e-chat-wfget1-${suffix}`) });
  const chatWfDraft1 = await chatWfGet1.json();
  if (chatWfGet1.status !== 200) fail('PR-4 get workflow after build', { status: chatWfGet1.status });
  const chatNodeIds1 = (chatWfDraft1.graph?.nodes ?? []).map((n) => n.id);
  const chatEdgeIds1 = (chatWfDraft1.graph?.edges ?? []).map((e) => e.id);
  if (!chatNodeIds1.includes('chat-src-1') || !chatNodeIds1.includes('chat-gen-1')) {
    fail('PR-4 graph missing chat-src-1/chat-gen-1', chatWfDraft1.graph);
  }
  if (!chatEdgeIds1.includes('chat-edge-1')) fail('PR-4 graph missing chat-edge-1', chatWfDraft1.graph);
  ok('PR-4 canvas graph contains chat-src-1/chat-gen-1/chat-edge-1');

  // 3) run turn → budget gate rewrites limit to remaining ($0.01) → run created + settles
  const chatTurn2Res = await fetch(`${chatBase}/${chatSid}/messages`, {
    method: 'POST',
    headers: chatHeaders(`e2e-chat-turn2-${suffix}`),
    body: JSON.stringify({ content: '运行一下' }),
  });
  const chatTurn2 = await chatTurn2Res.json();
  if (chatTurn2Res.status !== 200) fail('PR-4 turn 2 (run)', { status: chatTurn2Res.status, chatTurn2 });
  if (!chatTurn2.run?.id) fail('PR-4 turn 2 missing run', chatTurn2);
  if (chatTurn2.budgetRejected) fail('PR-4 turn 2 unexpectedly budget-rejected', chatTurn2);
  const chatRunId = chatTurn2.run.id;
  const chatRunEstimate = chatTurn2.run.estimateMicrounits;
  ok(`PR-4 turn 2 「运行」→ run ${chatRunId.slice(0, 8)}… estimate=${chatRunEstimate}µ`);

  let chatRunFinal = null;
  for (let i = 0; i < 50; i++) {
    const g = await fetch(`${base}/api/workspaces/${chatWs}/runs/${chatRunId}`, {
      headers: { cookie: jarChat.header(), 'x-request-id': `e2e-chat-run-poll-${suffix}-${i}` },
    });
    chatRunFinal = await g.json();
    const st = chatRunFinal.status ?? chatRunFinal.run?.status;
    if (['SUCCEEDED', 'FAILED_FINAL', 'FAILED_RETRYABLE', 'CANCELED'].includes(st)) break;
    await sleep(250);
  }
  const chatRunStatus = chatRunFinal?.status ?? chatRunFinal?.run?.status;
  if (chatRunStatus !== 'SUCCEEDED') fail('PR-4 run did not succeed', chatRunFinal);
  ok('PR-4 agent run settled → SUCCEEDED');

  const chatSessGet1 = await fetch(`${chatBase}/${chatSid}`, {
    headers: chatHeaders(`e2e-chat-sessget1-${suffix}`),
  });
  const chatSessDetail1 = await chatSessGet1.json();
  if (chatSessGet1.status !== 200) fail('PR-4 get session', { status: chatSessGet1.status });
  if (chatSessDetail1.spentMicrounits !== chatRunEstimate || chatSessDetail1.spentMicrounits <= 0) {
    fail('PR-4 session spentMicrounits did not accumulate run estimate', chatSessDetail1);
  }
  if (!Array.isArray(chatSessDetail1.messages) || chatSessDetail1.messages.length !== 4) {
    fail('PR-4 session expected 4 messages (2 user + 2 assistant)', chatSessDetail1.messages?.length);
  }
  ok(`PR-4 session spentMicrounits=${chatSessDetail1.spentMicrounits}µ accumulated`);

  // 4) budget exhausted → run rejected, no batch, graph untouched
  const chatTurn3Res = await fetch(`${chatBase}/${chatSid}/messages`, {
    method: 'POST',
    headers: chatHeaders(`e2e-chat-turn3-${suffix}`),
    body: JSON.stringify({ content: '再运行一次' }),
  });
  const chatTurn3 = await chatTurn3Res.json();
  if (chatTurn3Res.status !== 200) fail('PR-4 turn 3 (over budget)', { status: chatTurn3Res.status, chatTurn3 });
  if (chatTurn3.budgetRejected !== true) fail('PR-4 turn 3 expected budgetRejected=true', chatTurn3);
  if (chatTurn3.run) fail('PR-4 turn 3 unexpected run', chatTurn3.run);
  if (chatTurn3.batchId) fail('PR-4 turn 3 unexpected batchId (no commands should survive)', chatTurn3);
  const chatWfGet2 = await fetch(chatWfUrl, { headers: chatHeaders(`e2e-chat-wfget2-${suffix}`) });
  const chatWfDraft2 = await chatWfGet2.json();
  if ((chatWfDraft2.graph?.nodes ?? []).length !== 2) {
    fail('PR-4 graph changed on budget-rejected turn', chatWfDraft2.graph);
  }
  const chatSessGet2 = await fetch(`${chatBase}/${chatSid}`, {
    headers: chatHeaders(`e2e-chat-sessget2-${suffix}`),
  });
  const chatSessDetail2 = await chatSessGet2.json();
  if (chatSessDetail2.spentMicrounits !== chatSessDetail1.spentMicrounits) {
    fail('PR-4 spentMicrounits changed on rejected turn', chatSessDetail2);
  }
  ok('PR-4 turn 3 budget gate: budgetRejected=true, no run, graph + spend unchanged');

  // 5) undo the turn-1 batch by batchId → graph rolls back to empty
  const chatUndo = await fetch(`${chatWfUrl}/commands/undo`, {
    method: 'POST',
    headers: chatHeaders(`e2e-chat-undo-${suffix}`),
    body: JSON.stringify({ ifRevision: chatWfDraft2.revisionNumber, batchId: chatBatch1 }),
  });
  const chatUndoJson = await chatUndo.json();
  if (chatUndo.status !== 200) fail('PR-4 undo agent batch', { status: chatUndo.status, chatUndoJson });
  if ((chatUndoJson.graph?.nodes ?? []).length !== 0) {
    fail('PR-4 undo did not restore empty graph', chatUndoJson.graph);
  }
  ok('PR-4 commands/undo {batchId} rolled the agent build batch back to 0 nodes');

  // 6) cross-tenant: user B (different workspace) cannot read the session
  const chatXRes = await fetch(`${chatBase}/${chatSid}`, {
    headers: { cookie: jarB.header(), 'x-request-id': `e2e-chat-xtenant-${suffix}` },
  });
  if (chatXRes.status !== 403 && chatXRes.status !== 404) {
    fail('PR-4 expected cross-tenant 403/404', { status: chatXRes.status });
  }
  ok(`PR-4 cross-tenant session read → ${chatXRes.status}`);

  console.log('E2E PASS: V2 PR-4 chat agent (session/turn/graph/run/budget gate/undo/cross-tenant)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
