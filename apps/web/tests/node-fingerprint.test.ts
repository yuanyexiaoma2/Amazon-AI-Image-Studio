import { describe, expect, it } from 'vitest';
import type { WorkflowGraph } from '@studio/domain';
import { computeDraftNodeFingerprints, type FingerprintDb } from '../lib/node-fingerprint';

function graphWith(promptText: string, assetVersionId?: string): WorkflowGraph {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: 'n-prompt',
        type: 'prompt',
        position: { x: 0, y: 0 },
        config: { schemaVersion: 1, text: promptText },
      },
      ...(assetVersionId
        ? [
            {
              id: 'n-src',
              type: 'source_image',
              position: { x: 0, y: 200 },
              config: { schemaVersion: 1, assetVersionId },
            },
          ]
        : []),
      {
        id: 'n-gen',
        type: 'generate',
        position: { x: 400, y: 0 },
        config: { schemaVersion: 1, modelKey: 'primary-image-edit' },
      },
    ],
    edges: [
      { id: 'e1', source: 'n-prompt', target: 'n-gen', sourceHandle: 'prompt', targetHandle: 'prompt' },
      ...(assetVersionId
        ? [
            {
              id: 'e2',
              source: 'n-src',
              target: 'n-gen',
              sourceHandle: 'image',
              targetHandle: 'references',
            },
          ]
        : []),
    ],
  };
}

function fakeDb(shaById: Record<string, string>): FingerprintDb {
  return {
    assetVersion: {
      findMany: async (args) =>
        args.where.id.in
          .filter((id) => id in shaById)
          .map((id) => ({ id, sha256: shaById[id] as string })),
    },
    mask: { findMany: async () => [] },
  };
}

describe('computeDraftNodeFingerprints（stale 判定用指纹重算）', () => {
  it('图为空 → 空表；有节点 → 每个节点一条 sha256', async () => {
    const fps = await computeDraftNodeFingerprints(fakeDb({}), 'ws1', graphWith('白底图'));
    expect(Object.keys(fps).sort()).toEqual(['n-gen', 'n-prompt']);
    for (const fp of Object.values(fps)) {
      expect(fp).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('输入变化（提示词/参考图 sha）→ 下游 generate 指纹变化', async () => {
    const g1 = graphWith('白底图');
    const g2 = graphWith('场景图');
    const [f1, f2] = await Promise.all([
      computeDraftNodeFingerprints(fakeDb({}), 'ws1', g1),
      computeDraftNodeFingerprints(fakeDb({}), 'ws1', g2),
    ]);
    expect(f1['n-gen']).not.toBe(f2['n-gen']);

    const g3 = graphWith('白底图', 'av-1');
    const [f3a, f3b] = await Promise.all([
      computeDraftNodeFingerprints(fakeDb({ 'av-1': 'sha-a' }), 'ws1', g3),
      computeDraftNodeFingerprints(fakeDb({ 'av-1': 'sha-b' }), 'ws1', g3),
    ]);
    expect(f3a['n-gen']).not.toBe(f3b['n-gen']);
  });

  it('同一图同一素材 → 指纹稳定（幂等）', async () => {
    const g = graphWith('白底图', 'av-1');
    const db = fakeDb({ 'av-1': 'sha-a' });
    const [a, b] = await Promise.all([
      computeDraftNodeFingerprints(db, 'ws1', g),
      computeDraftNodeFingerprints(db, 'ws1', g),
    ]);
    expect(a).toEqual(b);
  });
});
