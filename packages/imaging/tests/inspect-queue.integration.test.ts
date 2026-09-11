/**
 * Real queue-path inspect tests — MUST NOT set INSPECT_INLINE.
 * Covers outbox recovery, worker idempotency, failure-injection retries,
 * tenant completionKey isolation, validation rejects, EXIF strip.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Queue, Worker } from 'bullmq';
import sharp from 'sharp';
import {
  prisma,
  AssetRepository,
  OutboxRepository,
  UploadRepository,
  UserRepository,
  ProjectRepository,
  inspectJobId,
  newId,
  type PrismaClient,
} from '@studio/db';
import { MemoryObjectStorage } from '@studio/storage';
import {
  buildAssetObjectKey,
  isAnimatedOrDynamicWebp,
} from '@studio/domain';
import { inspectUploadedAsset, type InspectInput, type InspectHooks } from '../src/inspect.js';
import { sha256Hex } from '../src/hash.js';

const run = process.env.RUN_INTEGRATION === '1' || process.env.CI === 'true';

function redisConn() {
  const u = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return { host: u.hostname, port: Number(u.port || 6379), maxRetriesPerRequest: null as null };
}

async function makePng(opts?: {
  width?: number;
  height?: number;
  withExif?: boolean;
}): Promise<Buffer> {
  let img = sharp({
    create: {
      width: opts?.width ?? 32,
      height: opts?.height ?? 24,
      channels: 3,
      background: { r: 200, g: 100, b: 50 },
    },
  }).png();
  if (opts?.withExif) {
    img = img.withExif({
      IFD0: { Copyright: 'SECRET-EXIF', Artist: 'test' },
    });
  }
  return img.toBuffer();
}

/** Minimal animated WebP (VP8X + ANIM) — enough for isAnimatedOrDynamicWebp. */
function makeAnimatedWebpStub(): Buffer {
  // RIFF....WEBP + VP8X + ANIM markers
  const buf = Buffer.alloc(40);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(32, 4);
  buf.write('WEBP', 8);
  buf.write('VP8X', 12);
  buf.writeUInt32LE(10, 16);
  buf[20] = 0x02; // animation flag
  buf.write('ANIM', 30);
  buf.writeUInt32LE(6, 34);
  return buf;
}

describe.skipIf(!run)('inspect queue path (NO INSPECT_INLINE)', () => {
  const db = prisma;
  const users = new UserRepository(db);
  const projects = new ProjectRepository(db);
  const uploads = new UploadRepository(db);
  const assets = new AssetRepository(db);
  const outboxRepo = new OutboxRepository(db);
  const storage = new MemoryObjectStorage();

  // Ensure these tests never use inline mode
  const prevInline = process.env.INSPECT_INLINE;
  beforeAll(() => {
    delete process.env.INSPECT_INLINE;
    expect(process.env.INSPECT_INLINE).toBeUndefined();
  });
  afterAll(async () => {
    if (prevInline !== undefined) process.env.INSPECT_INLINE = prevInline;
    else delete process.env.INSPECT_INLINE;
  });

  async function seedUpload(label: string, body: Buffer, mime = 'image/png') {
    const suffix = `${Date.now()}-${newId().slice(0, 8)}-${label}`;
    const { user, workspace } = await users.createWithDefaultWorkspace({
      email: `q-${suffix}@example.com`,
      passwordHash: 'hash',
      workspaceName: `WS-${suffix}`,
    });
    const project = await projects.create({
      workspaceId: workspace.id,
      sku: `SKU-${suffix}`,
      name: 'Queue Project',
    });
    const versionId = newId();
    const assetId = newId(); // will be replaced by createPresignSession
    const { session, asset } = await uploads.createPresignSession({
      workspaceId: workspace.id,
      projectId: project.id,
      createdByUserId: user.id,
      expectedKey: '', // set below
      expectedMime: mime,
      expectedBytes: body.length,
      originalFilename: 'shot.png',
      expiresAt: new Date(Date.now() + 900_000),
    });
    // Rebuild key with real asset id + predetermined version fragment
    const key = buildAssetObjectKey({
      workspaceId: workspace.id,
      projectId: project.id,
      assetId: asset.id,
      kind: 'original',
      versionId,
      ext: mime === 'image/webp' ? 'webp' : 'png',
    });
    await db.uploadSession.updateMany({
      where: { id: session.id, workspaceId: workspace.id },
      data: { expectedKey: key },
    });
    await storage.putObject({ key, body, contentType: mime });
    const refreshed = await uploads.findSession(workspace.id, session.id);
    return {
      user,
      workspace,
      project,
      session: refreshed!,
      asset,
      versionId,
      body,
      key,
    };
  }

  async function publishOutboxLikeProduction(outbox: {
    id: string;
    workspaceId: string;
    jobId: string;
    payload: unknown;
  }) {
    const queueName = `asset-inspect-test-${newId().slice(0, 8)}`;
    const connection = redisConn();
    const queue = new Queue<InspectInput>(queueName, { connection });
    const results: unknown[] = [];
    const worker = new Worker<InspectInput>(
      queueName,
      async (job) => {
        const r = await inspectUploadedAsset({
          db,
          storage,
          input: job.data,
        });
        results.push(r);
        return r;
      },
      { connection },
    );
    await queue.add('inspect', outbox.payload as InspectInput, {
      jobId: outbox.jobId,
      attempts: 5,
      backoff: { type: 'fixed', delay: 50 },
    });
    await outboxRepo.markPublished(outbox.workspaceId, outbox.id);
    // wait for job
    for (let i = 0; i < 80; i++) {
      if (results.length > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    return results[0] as Awaited<ReturnType<typeof inspectUploadedAsset>>;
  }

  it('enqueue failure then recovery: DB INSPECTING + PENDING outbox, relay publishes with stable jobId', async () => {
    const png = await makePng();
    const ctx = await seedUpload('recover', png);
    const { outbox } = await uploads.markInspectingWithOutbox({
      workspaceId: ctx.workspace.id,
      uploadId: ctx.session.id,
      assetId: ctx.asset.id,
      projectId: ctx.project.id,
      expectedKey: ctx.key,
      expectedMime: 'image/png',
      expectedBytes: png.length,
      completionKey: `ck-recover-${ctx.session.id}`,
    });
    expect(outbox.status).toBe('PENDING');
    expect(outbox.jobId).toBe(inspectJobId(ctx.session.id));

    const session = await uploads.findSession(ctx.workspace.id, ctx.session.id);
    expect(session?.status).toBe('INSPECTING');

    // Simulate publish failure: leave PENDING, then recovery relay
    const pending = await outboxRepo.listPending(100);
    expect(pending.some((p) => p.jobId === outbox.jobId)).toBe(true);

    const result = await publishOutboxLikeProduction(outbox);
    expect(result.ok).toBe(true);

    const after = await outboxRepo.findByJobId(outbox.jobId);
    expect(after?.status).toBe('PUBLISHED');
    const ready = await uploads.findSession(ctx.workspace.id, ctx.session.id);
    expect(ready?.status).toBe('READY');
  });

  it('worker double execution is idempotent: one Asset Version and one Representation per kind', async () => {
    const png = await makePng();
    const ctx = await seedUpload('idem', png);
    const input: InspectInput = {
      workspaceId: ctx.workspace.id,
      uploadId: ctx.session.id,
      assetId: ctx.asset.id,
      projectId: ctx.project.id,
      expectedKey: ctx.key,
      expectedMime: 'image/png',
      expectedBytes: png.length,
    };
    await db.uploadSession.updateMany({
      where: { id: ctx.session.id, workspaceId: ctx.workspace.id },
      data: { status: 'INSPECTING' },
    });

    const r1 = await inspectUploadedAsset({ db, storage, input });
    const r2 = await inspectUploadedAsset({ db, storage, input });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r1.versionId).toBe(r2.versionId);

    const versions = await assets.listVersions(ctx.workspace.id, ctx.asset.id);
    expect(versions).toHaveLength(1);
    const kinds = versions[0]!.representations.map((r) => r.kind).sort();
    expect(kinds).toEqual(['NORMALIZED_PNG', 'ORIGINAL_UPLOAD', 'THUMBNAIL_WEBP']);
    // exactly one of each
    expect(versions[0]!.representations).toHaveLength(3);
  });

  it('inject failure after create version / write object / write representation — retry succeeds cleanly', async () => {
    for (const phase of ['version', 'object', 'representation'] as const) {
      const png = await makePng();
      const ctx = await seedUpload(`fail-${phase}`, png);
      const input: InspectInput = {
        workspaceId: ctx.workspace.id,
        uploadId: ctx.session.id,
        assetId: ctx.asset.id,
        projectId: ctx.project.id,
        expectedKey: ctx.key,
        expectedMime: 'image/png',
        expectedBytes: png.length,
      };
      await db.uploadSession.updateMany({
        where: { id: ctx.session.id, workspaceId: ctx.workspace.id },
        data: { status: 'INSPECTING' },
      });

      let trips = 0;
      const hooks: InspectHooks = {
        afterCreateVersion:
          phase === 'version'
            ? async () => {
                trips += 1;
                if (trips === 1) throw new Error('injected after create version');
              }
            : undefined,
        afterWriteObject:
          phase === 'object'
            ? async () => {
                trips += 1;
                if (trips === 1) throw new Error('injected after write object');
              }
            : undefined,
        afterWriteRepresentation:
          phase === 'representation'
            ? async (kind) => {
                if (kind !== 'ORIGINAL_UPLOAD') return;
                trips += 1;
                if (trips === 1) throw new Error('injected after write representation');
              }
            : undefined,
      };

      await expect(inspectUploadedAsset({ db, storage, input, hooks })).rejects.toThrow(/injected/);
      // Must NOT be REJECTED after transient injection
      const mid = await uploads.findSession(ctx.workspace.id, ctx.session.id);
      expect(mid?.status).not.toBe('REJECTED');

      // Retry without failing hook
      const ok = await inspectUploadedAsset({ db, storage, input });
      expect(ok.ok).toBe(true);
      const versions = await assets.listVersions(ctx.workspace.id, ctx.asset.id);
      expect(versions).toHaveLength(1);
      expect(versions[0]!.representations).toHaveLength(3);
      const ready = await uploads.findSession(ctx.workspace.id, ctx.session.id);
      expect(ready?.status).toBe('READY');
    }
  });

  it('two workspaces same completionKey do not conflict', async () => {
    const png = await makePng();
    const sharedKey = `shared-completion-${newId()}`;
    const a = await seedUpload('cka', png);
    const b = await seedUpload('ckb', png);

    await uploads.markInspectingWithOutbox({
      workspaceId: a.workspace.id,
      uploadId: a.session.id,
      assetId: a.asset.id,
      projectId: a.project.id,
      expectedKey: a.key,
      expectedMime: 'image/png',
      expectedBytes: png.length,
      completionKey: sharedKey,
    });
    await uploads.markInspectingWithOutbox({
      workspaceId: b.workspace.id,
      uploadId: b.session.id,
      assetId: b.asset.id,
      projectId: b.project.id,
      expectedKey: b.key,
      expectedMime: 'image/png',
      expectedBytes: png.length,
      completionKey: sharedKey,
    });

    const foundA = await uploads.findByCompletionKey(a.workspace.id, sharedKey);
    const foundB = await uploads.findByCompletionKey(b.workspace.id, sharedKey);
    expect(foundA?.id).toBe(a.session.id);
    expect(foundB?.id).toBe(b.session.id);
    expect(foundA?.id).not.toBe(foundB?.id);
  });

  it('MIME mismatch, corrupt file, over-limit pixels, oversized file, animated WebP → REJECTED', async () => {
    // MIME mismatch
    {
      const png = await makePng();
      const ctx = await seedUpload('mime', png, 'image/jpeg'); // declared jpeg, bytes are png
      await db.uploadSession.updateMany({
        where: { id: ctx.session.id, workspaceId: ctx.workspace.id },
        data: { status: 'INSPECTING', expectedMime: 'image/jpeg' },
      });
      const r = await inspectUploadedAsset({
        db,
        storage,
        input: {
          workspaceId: ctx.workspace.id,
          uploadId: ctx.session.id,
          assetId: ctx.asset.id,
          projectId: ctx.project.id,
          expectedKey: ctx.key,
          expectedMime: 'image/jpeg',
          expectedBytes: png.length,
        },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/MIME mismatch/);
      expect((await uploads.findSession(ctx.workspace.id, ctx.session.id))?.status).toBe('REJECTED');
    }

    // Corrupt file
    {
      const junk = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]);
      const ctx = await seedUpload('corrupt', junk, 'image/png');
      await storage.putObject({ key: ctx.key, body: junk, contentType: 'image/png' });
      await db.uploadSession.updateMany({
        where: { id: ctx.session.id, workspaceId: ctx.workspace.id },
        data: { status: 'INSPECTING' },
      });
      const r = await inspectUploadedAsset({
        db,
        storage,
        input: {
          workspaceId: ctx.workspace.id,
          uploadId: ctx.session.id,
          assetId: ctx.asset.id,
          projectId: ctx.project.id,
          expectedKey: ctx.key,
          expectedMime: 'image/png',
          expectedBytes: junk.length,
        },
      });
      expect(r.ok).toBe(false);
      expect((await uploads.findSession(ctx.workspace.id, ctx.session.id))?.status).toBe('REJECTED');
    }

    // Over-limit pixels — craft small PNG whose IHDR claims 10000x10000
    {
      const { deflateSync } = await import('node:zlib');
      // Minimal invalid/empty IDAT; sharp still reads IHDR dimensions
      function crc32(buf: Buffer): number {
        let c = ~0;
        for (let i = 0; i < buf.length; i++) {
          c ^= buf[i]!;
          for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
        }
        return ~c >>> 0;
      }
      function chunk(type: string, data: Buffer): Buffer {
        const typeBuf = Buffer.from(type);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const crcBuf = Buffer.alloc(4);
        crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
        return Buffer.concat([len, typeBuf, data, crcBuf]);
      }
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(10000, 0);
      ihdr.writeUInt32BE(10000, 4);
      ihdr[8] = 8; // bit depth
      ihdr[9] = 2; // color type RGB
      const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const idat = chunk('IDAT', deflateSync(Buffer.alloc(100)));
      const huge = Buffer.concat([sig, chunk('IHDR', ihdr), idat, chunk('IEND', Buffer.alloc(0))]);
      const ctx = await seedUpload('pixels', huge);
      await storage.putObject({ key: ctx.key, body: huge, contentType: 'image/png' });
      await db.uploadSession.updateMany({
        where: { id: ctx.session.id, workspaceId: ctx.workspace.id },
        data: { status: 'INSPECTING', expectedBytes: huge.length },
      });
      const r = await inspectUploadedAsset({
        db,
        storage,
        input: {
          workspaceId: ctx.workspace.id,
          uploadId: ctx.session.id,
          assetId: ctx.asset.id,
          projectId: ctx.project.id,
          expectedKey: ctx.key,
          expectedMime: 'image/png',
          expectedBytes: huge.length,
        },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/Pixel|Corrupt|Limit|pixels/i);
    }

    // Oversized vs declared size (inspect guard: contentLength > expected*1.05+1024)
    {
      const png = await makePng({ width: 640, height: 640 });
      expect(png.length).toBeGreaterThan(1100);
      const ctx = await seedUpload('oversize', png);
      await db.uploadSession.updateMany({
        where: { id: ctx.session.id, workspaceId: ctx.workspace.id },
        data: { status: 'INSPECTING', expectedBytes: 10 },
      });
      const r = await inspectUploadedAsset({
        db,
        storage,
        input: {
          workspaceId: ctx.workspace.id,
          uploadId: ctx.session.id,
          assetId: ctx.asset.id,
          projectId: ctx.project.id,
          expectedKey: ctx.key,
          expectedMime: 'image/png',
          expectedBytes: 10,
        },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/larger than declared|size/i);
    }

    // Animated WebP
    {
      const anim = makeAnimatedWebpStub();
      expect(isAnimatedOrDynamicWebp(anim)).toBe(true);
      const ctx = await seedUpload('anim', anim, 'image/webp');
      await storage.putObject({ key: ctx.key, body: anim, contentType: 'image/webp' });
      await db.uploadSession.updateMany({
        where: { id: ctx.session.id, workspaceId: ctx.workspace.id },
        data: { status: 'INSPECTING', expectedMime: 'image/webp', expectedBytes: anim.length },
      });
      const r = await inspectUploadedAsset({
        db,
        storage,
        input: {
          workspaceId: ctx.workspace.id,
          uploadId: ctx.session.id,
          assetId: ctx.asset.id,
          projectId: ctx.project.id,
          expectedKey: ctx.key,
          expectedMime: 'image/webp',
          expectedBytes: anim.length,
        },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/Animated|dynamic|Multi-frame/i);
    }
  });

  it('EXIF stripped and original not overwritten', async () => {
    const png = await makePng({ withExif: true });
    const originalSha = sha256Hex(png);
    const ctx = await seedUpload('exif', png);
    await db.uploadSession.updateMany({
      where: { id: ctx.session.id, workspaceId: ctx.workspace.id },
      data: { status: 'INSPECTING' },
    });
    const r = await inspectUploadedAsset({
      db,
      storage,
      input: {
        workspaceId: ctx.workspace.id,
        uploadId: ctx.session.id,
        assetId: ctx.asset.id,
        projectId: ctx.project.id,
        expectedKey: ctx.key,
        expectedMime: 'image/png',
        expectedBytes: png.length,
      },
    });
    expect(r.ok).toBe(true);

    // Original object bytes unchanged
    const original = await storage.getObject(ctx.key);
    expect(sha256Hex(original.body)).toBe(originalSha);

    const versions = await assets.listVersions(ctx.workspace.id, ctx.asset.id);
    const norm = versions[0]!.representations.find((x) => x.kind === 'NORMALIZED_PNG');
    expect(norm).toBeTruthy();
    const normalized = await storage.getObject(norm!.storageKey);
    const meta = await sharp(normalized.body).metadata();
    // PNG from sharp without withExif — no EXIF blob expected
    expect(meta.exif).toBeUndefined();
    expect((versions[0]!.metadataJson as { exifStripped?: boolean }).exifStripped).toBe(true);
  });
});
