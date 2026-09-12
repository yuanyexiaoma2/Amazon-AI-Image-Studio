import { describe, expect, it } from 'vitest';
import { canonicalizeJcs } from '../src/jcs.js';
import {
  computeInputFingerprint,
  isDeterministicNodeType,
  isGenerativeNodeType,
} from '../src/input-fingerprint.js';

describe('canonicalizeJcs (RFC 8785)', () => {
  it('sorts object keys lexicographically and omits whitespace', () => {
    expect(canonicalizeJcs({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('preserves array order', () => {
    expect(canonicalizeJcs([3, 1, 2])).toBe('[3,1,2]');
  });

  it('is stable for nested structures', () => {
    const a = canonicalizeJcs({ z: { y: 1, x: [2, 1] }, a: null });
    const b = canonicalizeJcs({ a: null, z: { x: [2, 1], y: 1 } });
    expect(a).toBe(b);
  });
});

describe('computeInputFingerprint', () => {
  it('hashes JCS canonical JSON with SHA-256', () => {
    const a = computeInputFingerprint({
      nodeType: 'generate',
      nodeConfig: { modelKey: 'primary-image-edit', count: 2, schemaVersion: 1 },
      prompt: 'hello',
      negativePrompt: '',
      truthRevisionId: '11111111-1111-7111-8111-111111111111',
      modelRegistryConfigVersion: 1,
      upstreamAssets: [
        {
          portId: 'references',
          order: 0,
          assetVersionId: '22222222-2222-7222-8222-222222222222',
          sha256: 'abc',
        },
      ],
    });
    const b = computeInputFingerprint({
      nodeType: 'generate',
      nodeConfig: { count: 2, modelKey: 'primary-image-edit', schemaVersion: 1 },
      prompt: 'hello',
      negativePrompt: '',
      truthRevisionId: '11111111-1111-7111-8111-111111111111',
      modelRegistryConfigVersion: 1,
      upstreamAssets: [
        {
          portId: 'references',
          order: 0,
          assetVersionId: '22222222-2222-7222-8222-222222222222',
          sha256: 'abc',
        },
      ],
    });
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(a.reproducible).toBe(true);
  });

  it('changes when prompt changes', () => {
    const base = {
      nodeType: 'generate' as const,
      nodeConfig: { schemaVersion: 1 },
      modelRegistryConfigVersion: 1,
      truthRevisionId: null,
    };
    const a = computeInputFingerprint({ ...base, prompt: 'a' });
    const b = computeInputFingerprint({ ...base, prompt: 'b' });
    expect(a.sha256).not.toBe(b.sha256);
  });

  it('classifies generative vs deterministic', () => {
    expect(isGenerativeNodeType('generate')).toBe(true);
    expect(isDeterministicNodeType('remove_background')).toBe(true);
    expect(isGenerativeNodeType('remove_background')).toBe(false);
  });
});

import { createHash } from 'node:crypto';
import { sha256Hex } from '../src/sha256.js';

describe('sha256Hex', () => {
  it('matches node:crypto for sample strings', () => {
    for (const s of ['', 'a', 'hello', '{"a":1}']) {
      const expectHex = createHash('sha256').update(s, 'utf8').digest('hex');
      expect(sha256Hex(s)).toBe(expectHex);
    }
  });
});
