import { describe, expect, it } from 'vitest';
import type { WorkflowGraph } from '../src/workflow-graph.js';
import {
  collectDescendantsInclusive,
  propagateStaleFromGraphDiff,
  propagateStaleFromTruthChange,
} from '../src/stale-propagation.js';

function sampleGraph(): WorkflowGraph {
  return {
    schemaVersion: 1,
    nodes: [
      { id: 'truth', type: 'product_truth', position: { x: 0, y: 0 }, config: { truthRevisionId: 't1' } },
      { id: 'prompt', type: 'prompt', position: { x: 0, y: 0 }, config: { text: 'hi' } },
      { id: 'src', type: 'source_image', position: { x: 0, y: 0 }, config: { assetVersionId: 'av1' } },
      {
        id: 'gen',
        type: 'generate',
        position: { x: 0, y: 0 },
        config: { modelKey: 'primary-image-edit', schemaVersion: 1 },
      },
      { id: 'qa', type: 'qa_gate', position: { x: 0, y: 0 }, config: { schemaVersion: 1 } },
      { id: 'cut', type: 'remove_background', position: { x: 0, y: 0 }, config: { schemaVersion: 1 } },
    ],
    edges: [
      { id: 'e1', source: 'src', target: 'gen', sourceHandle: 'image', targetHandle: 'references' },
      { id: 'e2', source: 'truth', target: 'gen', sourceHandle: 'truth', targetHandle: 'truth' },
      { id: 'e3', source: 'prompt', target: 'gen', sourceHandle: 'prompt', targetHandle: 'prompt' },
      { id: 'e4', source: 'gen', target: 'qa', sourceHandle: 'images', targetHandle: 'images' },
      { id: 'e5', source: 'truth', target: 'qa', sourceHandle: 'truth', targetHandle: 'truth' },
      { id: 'e6', source: 'src', target: 'cut', sourceHandle: 'image', targetHandle: 'image' },
    ],
  };
}

describe('STALE propagation §32.2', () => {
  it('BFS includes seed and all descendants', () => {
    const g = sampleGraph();
    expect(collectDescendantsInclusive(g, ['gen'])).toEqual(['gen', 'qa']);
    expect(collectDescendantsInclusive(g, ['src']).sort()).toEqual(['cut', 'gen', 'qa', 'src'].sort());
  });

  it('Truth revision change marks truth readers + descendants', () => {
    const g = sampleGraph();
    const ev = propagateStaleFromTruthChange(g, { previous: 't1', next: 't2' });
    expect(ev.cause).toBe('TRUTH_REVISION');
    expect(ev.staleNodeIds.sort()).toEqual(['gen', 'qa', 'truth'].sort());
    expect(ev.staleNodeIds).not.toContain('cut');
  });

  it('config change marks node + descendants; does not delete concept (ids only)', () => {
    const prev = sampleGraph();
    const next: WorkflowGraph = {
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.id === 'gen' ? { ...n, config: { ...n.config, count: 4 } } : n,
      ),
    };
    const ev = propagateStaleFromGraphDiff(prev, next);
    expect(ev.staleNodeIds.sort()).toEqual(['gen', 'qa'].sort());
  });

  it('edge rewire marks affected endpoints + descendants', () => {
    const prev = sampleGraph();
    const next: WorkflowGraph = {
      ...prev,
      edges: prev.edges.filter((e) => e.id !== 'e4'),
    };
    const ev = propagateStaleFromGraphDiff(prev, next);
    expect(ev.staleNodeIds).toContain('gen');
    expect(ev.staleNodeIds).toContain('qa');
  });
});
