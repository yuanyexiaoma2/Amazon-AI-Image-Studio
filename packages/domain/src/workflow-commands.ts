/**
 * V2 PR-2 — canvas command layer: pure application of ordered workflow commands.
 * No Next.js / Prisma / BullMQ / Zod. Node-config validation is injected
 * (the API layer wires in @studio/contracts validateNodeConfig/defaultNodeConfig;
 * contracts already depends on domain, so domain must not import contracts).
 */

import {
  getNodeDefinition,
  validateEdge,
  type GraphEdge,
  type GraphIssueCode,
  type WorkflowGraph,
} from './workflow-graph.js';

export type WorkflowCommand =
  | {
      type: 'addNode';
      nodeType: string;
      nodeId?: string;
      position: { x: number; y: number };
      config?: Record<string, unknown>;
    }
  | { type: 'removeNode'; nodeId: string }
  | {
      type: 'connect';
      edgeId?: string;
      source: string;
      sourceHandle?: string | null;
      target: string;
      targetHandle?: string | null;
    }
  | { type: 'disconnect'; edgeId: string }
  | { type: 'configure'; nodeId: string; config: Record<string, unknown> }
  | { type: 'moveNode'; nodeId: string; position: { x: number; y: number } }
  | { type: 'rename'; name: string }
  | {
      /** Domain never executes runs; the API layer handles the trailing run command. */
      type: 'run';
      scope?: unknown;
      idempotencyKey?: string;
      budgetLimit?: unknown;
      confirmBudget?: boolean;
      modelKey?: string;
    };

export type WorkflowCommandErrorCode =
  | GraphIssueCode
  | 'NODE_NOT_FOUND'
  | 'EDGE_NOT_FOUND'
  | 'RUN_NOT_LAST'
  | 'DUPLICATE_NODE_ID'
  | 'DUPLICATE_EDGE_ID'
  | 'NODE_TYPE_NOT_IN_PALETTE'
  | 'INVALID_NODE_CONFIG';

export class WorkflowCommandError extends Error {
  constructor(
    public readonly code: WorkflowCommandErrorCode,
    message: string,
    public readonly commandIndex: number,
  ) {
    super(`command[${commandIndex}] (${code}): ${message}`);
    this.name = 'WorkflowCommandError';
  }
}

export type NodeConfigValidationResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; issues: string[] };

export type ApplyWorkflowCommandsOptions = {
  /**
   * Deterministic id factory for tests. `seed` is the nodeType for nodes and
   * `${source}-${target}` for edges. Default: `n-{type}-{Date.now()}-{seq}` /
   * `e-{source}-{target}-{seq}` with a per-call counter.
   */
  generateId?: (kind: 'node' | 'edge', seed: string) => string;
  /** Defaults to accepting any config and stamping schemaVersion. */
  validateNodeConfig?: (nodeType: string, config: unknown) => NodeConfigValidationResult;
  /** Defaults to `{ schemaVersion: 1 }`. */
  defaultNodeConfig?: (nodeType: string) => Record<string, unknown>;
};

export type ApplyWorkflowCommandsResult = {
  graph: WorkflowGraph;
  /** Set when the batch contained a rename command (last rename wins). */
  name?: string;
};

function defaultValidateNodeConfig(_nodeType: string, config: unknown): NodeConfigValidationResult {
  const base =
    typeof config === 'object' && config !== null && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};
  return { ok: true, config: { schemaVersion: 1, ...base } };
}

/**
 * Apply commands sequentially on a deep copy of `graph`; the input graph is
 * never mutated. Any failure throws WorkflowCommandError and discards the
 * copy, so callers get all-or-nothing semantics by persisting the result once.
 */
export function applyWorkflowCommands(
  graph: WorkflowGraph,
  commands: WorkflowCommand[],
  options?: ApplyWorkflowCommandsOptions,
): ApplyWorkflowCommandsResult {
  let seq = 0;
  const generateId =
    options?.generateId ??
    ((kind: 'node' | 'edge', seed: string): string =>
      kind === 'node' ? `n-${seed}-${Date.now()}-${seq++}` : `e-${seed}-${seq++}`);
  const validateConfig = options?.validateNodeConfig ?? defaultValidateNodeConfig;
  const defaultConfig = options?.defaultNodeConfig ?? (() => ({ schemaVersion: 1 }));

  commands.forEach((command, index) => {
    if (command.type === 'run' && index !== commands.length - 1) {
      throw new WorkflowCommandError(
        'RUN_NOT_LAST',
        'run command must be the last command in the batch (and may appear at most once)',
        index,
      );
    }
  });

  const draft: WorkflowGraph = {
    schemaVersion: graph.schemaVersion,
    nodes: graph.nodes.map((n) => ({
      ...n,
      position: { ...n.position },
      config: n.config ? { ...n.config } : n.config,
    })),
    edges: graph.edges.map((e) => ({ ...e })),
  };
  let name: string | undefined;

  commands.forEach((command, index) => {
    switch (command.type) {
      case 'addNode': {
        const def = getNodeDefinition(command.nodeType);
        if (!def) {
          throw new WorkflowCommandError(
            'UNKNOWN_NODE_TYPE',
            `Unknown node type: ${command.nodeType}`,
            index,
          );
        }
        if (!def.palette) {
          throw new WorkflowCommandError(
            'NODE_TYPE_NOT_IN_PALETTE',
            `Node type ${command.nodeType} is system-only and cannot be added manually`,
            index,
          );
        }
        const nodeId = command.nodeId ?? generateId('node', command.nodeType);
        if (draft.nodes.some((n) => n.id === nodeId)) {
          throw new WorkflowCommandError(
            'DUPLICATE_NODE_ID',
            `Node id already exists: ${nodeId}`,
            index,
          );
        }
        const validated =
          command.config !== undefined
            ? validateConfig(command.nodeType, command.config)
            : ({ ok: true, config: defaultConfig(command.nodeType) } as NodeConfigValidationResult);
        if (!validated.ok) {
          throw new WorkflowCommandError(
            'INVALID_NODE_CONFIG',
            `Invalid config for ${command.nodeType}: ${validated.issues.join('; ')}`,
            index,
          );
        }
        draft.nodes.push({
          id: nodeId,
          type: command.nodeType,
          position: { ...command.position },
          config: validated.config,
        });
        break;
      }
      case 'removeNode': {
        const nodeIndex = draft.nodes.findIndex((n) => n.id === command.nodeId);
        if (nodeIndex === -1) {
          throw new WorkflowCommandError(
            'NODE_NOT_FOUND',
            `Node not found: ${command.nodeId}`,
            index,
          );
        }
        draft.nodes.splice(nodeIndex, 1);
        draft.edges = draft.edges.filter(
          (e) => e.source !== command.nodeId && e.target !== command.nodeId,
        );
        break;
      }
      case 'connect': {
        const edgeId = command.edgeId ?? generateId('edge', `${command.source}-${command.target}`);
        if (draft.edges.some((e) => e.id === edgeId)) {
          throw new WorkflowCommandError(
            'DUPLICATE_EDGE_ID',
            `Edge id already exists: ${edgeId}`,
            index,
          );
        }
        const candidate: GraphEdge = {
          id: edgeId,
          source: command.source,
          target: command.target,
          sourceHandle: command.sourceHandle ?? null,
          targetHandle: command.targetHandle ?? null,
        };
        const result = validateEdge(draft, candidate);
        if (!result.ok) {
          const first = result.issues[0];
          throw new WorkflowCommandError(
            first?.code ?? 'UNKNOWN_NODE_TYPE',
            result.issues.map((i) => i.message).join('; ') || 'Invalid edge',
            index,
          );
        }
        draft.edges.push(candidate);
        break;
      }
      case 'disconnect': {
        const edgeIndex = draft.edges.findIndex((e) => e.id === command.edgeId);
        if (edgeIndex === -1) {
          throw new WorkflowCommandError(
            'EDGE_NOT_FOUND',
            `Edge not found: ${command.edgeId}`,
            index,
          );
        }
        draft.edges.splice(edgeIndex, 1);
        break;
      }
      case 'configure': {
        const node = draft.nodes.find((n) => n.id === command.nodeId);
        if (!node) {
          throw new WorkflowCommandError(
            'NODE_NOT_FOUND',
            `Node not found: ${command.nodeId}`,
            index,
          );
        }
        const validated = validateConfig(node.type, command.config);
        if (!validated.ok) {
          throw new WorkflowCommandError(
            'INVALID_NODE_CONFIG',
            `Invalid config for ${node.type}: ${validated.issues.join('; ')}`,
            index,
          );
        }
        node.config = validated.config;
        break;
      }
      case 'moveNode': {
        const node = draft.nodes.find((n) => n.id === command.nodeId);
        if (!node) {
          throw new WorkflowCommandError(
            'NODE_NOT_FOUND',
            `Node not found: ${command.nodeId}`,
            index,
          );
        }
        node.position = { ...command.position };
        break;
      }
      case 'rename': {
        name = command.name;
        break;
      }
      case 'run': {
        // Placement prechecked above; execution is the API layer's job.
        break;
      }
    }
  });

  return name !== undefined ? { graph: draft, name } : { graph: draft };
}
