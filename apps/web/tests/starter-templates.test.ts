import { describe, expect, it } from 'vitest';
import {
  getNodeDefinition,
  validateWorkflowGraph,
  type GraphEdge,
  type GraphNode,
  type WorkflowGraph,
} from '@studio/domain';
import { validateNodeConfig, type WorkflowCommand } from '@studio/contracts';
import {
  STARTER_TEMPLATES,
  buildStarterTemplateCommands,
  type StarterTemplateId,
} from '../components/studio/starter-templates';

function graphFromCommands(commands: WorkflowCommand[]): WorkflowGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const c of commands) {
    if (c.type === 'addNode') {
      nodes.push({
        id: c.nodeId as string,
        type: c.nodeType,
        position: c.position,
        config: c.config,
      });
    } else if (c.type === 'connect') {
      edges.push({
        id: c.edgeId as string,
        source: c.source,
        target: c.target,
        sourceHandle: c.sourceHandle ?? null,
        targetHandle: c.targetHandle ?? null,
      });
    }
  }
  return { schemaVersion: 1, nodes, edges };
}

const BUILDABLE: StarterTemplateId[] = ['hero', 'background', 'trio'];

describe('starter templates (V2 PR-6)', () => {
  it('exposes 4 cards including the blank dismiss option', () => {
    expect(STARTER_TEMPLATES.map((t) => t.id)).toEqual(['hero', 'background', 'trio', 'blank']);
  });

  it('blank template produces no commands', () => {
    expect(buildStarterTemplateCommands('blank', 'test')).toEqual([]);
  });

  for (const id of BUILDABLE) {
    describe(`template ${id}`, () => {
      const commands = buildStarterTemplateCommands(id, 'test');
      const graph = graphFromCommands(commands);

      it('uses unique node ids and edge ids', () => {
        const nodeIds = graph.nodes.map((n) => n.id);
        expect(new Set(nodeIds).size).toBe(nodeIds.length);
        const edgeIds = graph.edges.map((e) => e.id);
        expect(new Set(edgeIds).size).toBe(edgeIds.length);
      });

      it('orders addNode before connect and references existing nodes', () => {
        const lastAdd = commands.reduce((acc, c, i) => (c.type === 'addNode' ? i : acc), -1);
        const firstConnect = commands.findIndex((c) => c.type === 'connect');
        expect(lastAdd).toBeGreaterThanOrEqual(0);
        expect(firstConnect).toBeGreaterThan(lastAdd);
        const nodeIds = new Set(graph.nodes.map((n) => n.id));
        for (const e of graph.edges) {
          expect(nodeIds.has(e.source)).toBe(true);
          expect(nodeIds.has(e.target)).toBe(true);
        }
      });

      it('produces a graph that passes domain validation', () => {
        const result = validateWorkflowGraph(graph);
        expect(result.ok ? [] : result.issues).toEqual([]);
      });

      it('satisfies every required input port per NODE_REGISTRY', () => {
        for (const node of graph.nodes) {
          const def = getNodeDefinition(node.type);
          expect(def, `unknown node type ${node.type}`).toBeDefined();
          for (const port of def?.inputPorts ?? []) {
            if (!port.required) continue;
            const wired = graph.edges.some(
              (e) => e.target === node.id && (e.targetHandle ?? '') === port.id,
            );
            expect(wired, `${node.type}.${port.id} must be wired`).toBe(true);
          }
        }
      });

      it('passes node config validation (prefills included)', () => {
        for (const node of graph.nodes) {
          const result = validateNodeConfig(node.type, node.config);
          expect(result.ok ? [] : result.issues).toEqual([]);
        }
      });

      it('stays within the 50-command batch limit', () => {
        expect(commands.length).toBeLessThanOrEqual(50);
      });
    });
  }

  it('trio template wires three prompt→generate lanes', () => {
    const graph = graphFromCommands(buildStarterTemplateCommands('trio', 'test'));
    expect(graph.nodes.filter((n) => n.type === 'generate')).toHaveLength(3);
    expect(graph.nodes.filter((n) => n.type === 'prompt')).toHaveLength(3);
    expect(graph.edges).toHaveLength(9);
  });
});
