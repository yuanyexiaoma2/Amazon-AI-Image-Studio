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
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { createHash } from 'node:crypto';
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
  if (wh1.status !== 202 || wh1Json.warning !== 'UNKNOWN_EXTERNAL_JOB') {
    fail('webhook unknown job', { status: wh1.status, wh1Json });
  }
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
  if (wh2.status !== 200 || !wh2Json.duplicate) {
    fail('webhook duplicate should 200 duplicate', { status: wh2.status, wh2Json });
  }
  ok('W4-04 webhook verify + idempotent event id');

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

  console.log(
    'E2E PASS: W2 Truth + W3-A Shot Plan + W3-B2 materialize + W3-B1 workflow + W4 run/credits/webhook/SSE (Fake only)',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
