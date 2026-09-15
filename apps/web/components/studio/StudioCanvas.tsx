'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeTypes,
  Handle,
  Position,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  listPaletteNodeTypes,
  validateEdge,
  getNodeDefinition,
  type WorkflowGraph,
  type GraphEdge,
  type GraphNode,
} from '@studio/domain';
import {
  defaultNodeConfig,
  isWorkflowNodeConfigType,
  validateNodeConfig,
  type WorkflowCommand,
} from '@studio/contracts';
import {
  useWorkflowCommands,
  type CommandResult,
  type WorkflowDraftPayload,
} from './use-workflow-commands';
import { useConfigOptions } from './use-config-options';
import {
  PropertiesPanel,
  type MaskEditorState,
  type SelectedNodeInfo,
} from './PropertiesPanel';
import { NUMERIC_CONFIG_KEYS } from './config-options';

type CanvasSnapshot = { nodes: Node[]; edges: Edge[] };

const NODE_LABEL_ZH: Record<string, string> = {
  source_image: '源图（Source Image）',
  product_truth: '产品真相（Product Truth）',
  prompt: '提示词（Prompt）',
  remove_background: '抠图（Remove Background）',
  generate: '生成（Generate）',
  replace_background: '换背景（Replace Background）',
  inpaint: '局部重绘（Inpaint）',
  outpaint: '外扩（Outpaint）',
  upscale: '超分（Upscale）',
  qa_gate: 'QA 门禁（QA Gate）',
  approval_selector: '审批选择器（Approval）',
  export: '导出（Export）',
};

function nodeLabelZh(type: string): string {
  return NODE_LABEL_ZH[type] ?? getNodeDefinition(type)?.label ?? type;
}

function toFlowNodes(graph: WorkflowGraph): Node[] {
  return graph.nodes.map((n) => ({
    id: n.id,
    type: 'studio',
    position: n.position,
    data: {
      label: nodeLabelZh(n.type),
      nodeType: n.type,
      config: n.config ?? { schemaVersion: 1 },
    },
  }));
}

function toFlowEdges(graph: WorkflowGraph): Edge[] {
  return graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
  }));
}

function fromFlow(nodes: Node[], edges: Edge[]): WorkflowGraph {
  return {
    schemaVersion: 1,
    nodes: nodes.map(
      (n): GraphNode => ({
        id: n.id,
        type: String((n.data as { nodeType?: string }).nodeType ?? 'source_image'),
        position: { x: n.position.x, y: n.position.y },
        config: ((n.data as { config?: Record<string, unknown> }).config ?? {
          schemaVersion: 1,
        }) as Record<string, unknown>,
      }),
    ),
    edges: edges.map(
      (e): GraphEdge => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
      }),
    ),
  };
}

function cloneGraph(nodes: Node[], edges: Edge[]): CanvasSnapshot {
  return {
    nodes: nodes.map((n) => ({ ...n, position: { ...n.position }, data: { ...(n.data as object) } })),
    edges: edges.map((e) => ({ ...e })),
  };
}

function StudioNodeView(props: NodeProps) {
  const nodeType = String((props.data as { nodeType?: string }).nodeType ?? '');
  const def = getNodeDefinition(nodeType);
  const label = String((props.data as { label?: string }).label ?? nodeType);
  return (
    <div className={props.selected ? 'studio-node studio-node-selected' : 'studio-node'}>
      {def?.inputPorts.map((p, i) => (
        <Handle
          key={`in-${p.id}`}
          id={p.id}
          type="target"
          position={Position.Left}
          style={{ top: 16 + i * 14, background: 'var(--accent-strong)', width: 8, height: 8 }}
          title={`${p.id}: ${p.type}`}
        />
      ))}
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div className="faint" style={{ fontSize: 10 }}>{nodeType}</div>
      {def?.outputPorts.map((p, i) => (
        <Handle
          key={`out-${p.id}`}
          id={p.id}
          type="source"
          position={Position.Right}
          style={{ top: 16 + i * 14, background: 'var(--ok-soft)', width: 8, height: 8 }}
          title={`${p.id}: ${p.type}`}
        />
      ))}
    </div>
  );
}

const nodeTypes: NodeTypes = { studio: StudioNodeView };

function StudioCanvasInner(props: {
  workspaceId: string;
  projectId: string;
  workflowId?: string | null;
  belowStepper?: boolean;
}) {
  const { workspaceId, projectId, workflowId: requestedWorkflowId, belowStepper } = props;
  const { fitView } = useReactFlow();
  const [draft, setDraft] = useState<WorkflowDraftPayload | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [status, setStatus] = useState<string>('加载中…');

  const [maskEditor, setMaskEditor] = useState<MaskEditorState>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [edgeError, setEdgeError] = useState<string | null>(null);
  const [cmdError, setCmdError] = useState<string | null>(null);
  const [deleteHint, setDeleteHint] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const revisionRef = useRef(0);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const clipboardRef = useRef<CanvasSnapshot | null>(null);
  const draftRef = useRef<WorkflowDraftPayload | null>(null);
  const dragSnapshotRef = useRef<CanvasSnapshot | null>(null);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  draftRef.current = draft;

  const palette = useMemo(() => listPaletteNodeTypes(), []);

  const getWorkflowId = useCallback(() => draftRef.current?.workflowId ?? null, []);

  const handleCommandResult = useCallback((result: CommandResult) => {
    if (result.ok) {
      const b = result.batch;
      setDraft((prev) => (prev ? { ...prev, name: b.name, revisionNumber: b.revisionNumber } : prev));
      setCmdError(null);
      setStatus(`已保存 · 修订 ${b.revisionNumber}`);
      return;
    }
    const f = result.failure;
    if (f.kind === 'conflict') {
      setConflict(
        f.message ||
          '并发编辑冲突（409）。请重新加载以保留另一会话的更改，或放弃本地编辑。',
      );
      setStatus('冲突 — 未覆盖');
      return;
    }
    if (f.kind === 'run-failed') {
      // Graph commands were persisted server-side; only the run failed (e.g. 402).
      setCmdError(f.message);
      setStatus(`运行失败：${f.message}`);
      if (f.revisionNumber !== undefined) {
        const rev = f.revisionNumber;
        setDraft((prev) => (prev ? { ...prev, revisionNumber: rev } : prev));
      }
      return;
    }
    setCmdError(f.message);
    setStatus(`命令失败：${f.message}`);
  }, []);

  const commands = useWorkflowCommands({
    workspaceId,
    getWorkflowId,
    revisionRef,
    onSettled: handleCommandResult,
  });

  const applyLocalSnapshot = useCallback(
    (snap: CanvasSnapshot) => {
      setNodes(snap.nodes);
      setEdges(snap.edges);
      nodesRef.current = snap.nodes;
      edgesRef.current = snap.edges;
      setSelectedIds((prev) => prev.filter((id) => snap.nodes.some((n) => n.id === id)));
    },
    [setNodes, setEdges],
  );

  const makeRollback = useCallback(
    (snap: CanvasSnapshot) => () => applyLocalSnapshot(snap),
    [applyLocalSnapshot],
  );

  const applyDraft = useCallback(
    (d: WorkflowDraftPayload) => {
      setDraft(d);
      revisionRef.current = d.revisionNumber;
      applyLocalSnapshot({ nodes: toFlowNodes(d.graph), edges: toFlowEdges(d.graph) });
    },
    [applyLocalSnapshot],
  );

  const loadOrCreate = useCallback(async () => {
    setStatus('正在加载工作流…');
    setConflict(null);
    setCmdError(null);
    if (requestedWorkflowId) {
      const getRes = await fetch(
        `/api/workspaces/${workspaceId}/workflows/${requestedWorkflowId}`,
      );
      const got = await getRes.json().catch(() => null);
      if (!getRes.ok) {
        setStatus(`加载失败：${got?.error?.message ?? getRes.status}`);
        return;
      }
      applyDraft(got);
      setStatus(`已加载 · 修订 ${got.revisionNumber}`);
      return;
    }
    const listRes = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/workflows`);
    const listJson = await listRes.json().catch(() => null);
    if (!listRes.ok) {
      setStatus(`列表失败：${listJson?.error?.message ?? listRes.status}`);
      return;
    }
    const workflowId: string | undefined = listJson?.items?.[0]?.id;
    if (!workflowId) {
      const createRes = await fetch(
        `/api/workspaces/${workspaceId}/projects/${projectId}/workflows`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Studio 工作流' }),
        },
      );
      const created = await createRes.json().catch(() => null);
      if (!createRes.ok) {
        setStatus(`创建失败：${created?.error?.message ?? createRes.status}`);
        return;
      }
      applyDraft(created);
      setStatus(`已创建空工作流 · 修订 ${created.revisionNumber}`);
      return;
    }
    const getRes = await fetch(`/api/workspaces/${workspaceId}/workflows/${workflowId}`);
    const got = await getRes.json().catch(() => null);
    if (!getRes.ok) {
      setStatus(`加载失败：${got?.error?.message ?? getRes.status}`);
      return;
    }
    applyDraft(got);
    setStatus(`已加载 · 修订 ${got.revisionNumber}`);
  }, [workspaceId, projectId, requestedWorkflowId, applyDraft]);

  useEffect(() => {
    void loadOrCreate();
  }, [loadOrCreate]);

  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < 1280);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const selected = nodes.find((n) => n.id === selectedIds[0]) ?? null;
  const selectedInfo: SelectedNodeInfo | null = useMemo(() => {
    if (!selected) return null;
    const data = selected.data as {
      nodeType?: string;
      label?: string;
      config?: Record<string, unknown>;
    };
    return {
      id: selected.id,
      nodeType: String(data.nodeType ?? ''),
      label: String(data.label ?? data.nodeType ?? ''),
      position: { x: selected.position.x, y: selected.position.y },
      config: data.config ?? { schemaVersion: 1 },
    };
  }, [selected]);
  const selectedConfig = selectedInfo?.config ?? { schemaVersion: 1 };

  const sourceAssetVersionId = useMemo(() => {
    const src = nodes.find(
      (n) => String((n.data as { nodeType?: string }).nodeType) === 'source_image',
    );
    const value = src
      ? (src.data as { config?: Record<string, unknown> }).config?.assetVersionId
      : null;
    return typeof value === 'string' && value ? value : null;
  }, [nodes]);

  const configOptions = useConfigOptions({
    workspaceId,
    projectId,
    sourceAssetVersionId,
    activeNodeId: selectedInfo?.id ?? null,
  });

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    if (!connection.source || !connection.target) return false;
    const graph = fromFlow(nodesRef.current, edgesRef.current);
    const candidate: GraphEdge = {
      id: `preview-${connection.source}-${connection.target}`,
      source: connection.source,
      target: connection.target,
      sourceHandle: connection.sourceHandle ?? null,
      targetHandle: connection.targetHandle ?? null,
    };
    return validateEdge(graph, candidate).ok;
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const graph = fromFlow(nodesRef.current, edgesRef.current);
      const candidate: GraphEdge = {
        id: `e-${connection.source}-${connection.sourceHandle ?? ''}-${connection.target}-${connection.targetHandle ?? ''}-${Date.now()}`,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? null,
        targetHandle: connection.targetHandle ?? null,
      };
      const result = validateEdge(graph, candidate);
      if (!result.ok) {
        setEdgeError(result.issues.map((i) => i.message).join('; '));
        return;
      }
      setEdgeError(null);
      const snapshot = cloneGraph(nodesRef.current, edgesRef.current);
      const nextEdges = addEdge({ ...connection, id: candidate.id }, edgesRef.current);
      setEdges(nextEdges);
      edgesRef.current = nextEdges;
      void commands
        .applyNow(
          [
            {
              type: 'connect',
              edgeId: candidate.id,
              source: candidate.source,
              sourceHandle: candidate.sourceHandle,
              target: candidate.target,
              targetHandle: candidate.targetHandle,
            },
          ],
          makeRollback(snapshot),
        )
        .then(handleCommandResult);
    },
    [setEdges, commands, handleCommandResult, makeRollback],
  );

  const onNodesChangeWrapped = useCallback(
    (changes: NodeChange<Node>[]) => {
      const removes = changes.filter(
        (c): c is Extract<NodeChange<Node>, { type: 'remove' }> => c.type === 'remove',
      );
      if (removes.length > 0) {
        const ids = removes.map((c) => c.id);
        const idSet = new Set(ids);
        const impacted = edgesRef.current.filter(
          (e) => idSet.has(e.source) || idSet.has(e.target),
        );
        setDeleteHint(`删除 ${ids.length} 个节点也会移除 ${impacted.length} 条相连的边。`);
        const snapshot = cloneGraph(nodesRef.current, edgesRef.current);
        const nextNodes = nodesRef.current.filter((n) => !idSet.has(n.id));
        const nextEdges = edgesRef.current.filter(
          (e) => !idSet.has(e.source) && !idSet.has(e.target),
        );
        setNodes(nextNodes);
        setEdges(nextEdges);
        nodesRef.current = nextNodes;
        edgesRef.current = nextEdges;
        setSelectedIds((prev) => prev.filter((id) => !idSet.has(id)));
        // removeNode deletes connected edges server-side; the follow-up
        // onEdgesChange removals for those edges are ignored (already gone).
        void commands
          .applyNow(
            ids.map((id): WorkflowCommand => ({ type: 'removeNode', nodeId: id })),
            makeRollback(snapshot),
          )
          .then(handleCommandResult);
        return;
      }
      if (
        !dragSnapshotRef.current &&
        changes.some((c) => c.type === 'position' && c.dragging === true)
      ) {
        dragSnapshotRef.current = cloneGraph(nodesRef.current, edgesRef.current);
      }
      onNodesChange(changes);
      const stops = changes.filter(
        (
          c,
        ): c is Extract<NodeChange<Node>, { type: 'position' }> & {
          position: { x: number; y: number };
        } => c.type === 'position' && c.dragging === false && c.position !== undefined,
      );
      if (stops.length > 0) {
        const snapshot = dragSnapshotRef.current ?? cloneGraph(nodesRef.current, edgesRef.current);
        dragSnapshotRef.current = null;
        commands.schedule(
          stops.map(
            (c): WorkflowCommand => ({
              type: 'moveNode',
              nodeId: c.id,
              position: { x: c.position.x, y: c.position.y },
            }),
          ),
          makeRollback(snapshot),
        );
      }
    },
    [onNodesChange, setNodes, setEdges, commands, handleCommandResult, makeRollback],
  );

  const onEdgesChangeWrapped = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      const removes = changes.filter(
        (c): c is Extract<EdgeChange<Edge>, { type: 'remove' }> => c.type === 'remove',
      );
      const live = removes.filter((c) => edgesRef.current.some((e) => e.id === c.id));
      const snapshot = live.length > 0 ? cloneGraph(nodesRef.current, edgesRef.current) : null;
      onEdgesChange(changes);
      if (snapshot) {
        void commands
          .applyNow(
            live.map((c): WorkflowCommand => ({ type: 'disconnect', edgeId: c.id })),
            makeRollback(snapshot),
          )
          .then(handleCommandResult);
      }
    },
    [onEdgesChange, commands, handleCommandResult, makeRollback],
  );

  function addNode(type: string) {
    const id = `n-${type}-${Date.now()}`;
    const config = isWorkflowNodeConfigType(type)
      ? (defaultNodeConfig(type) as Record<string, unknown>)
      : { schemaVersion: 1 };
    const position = {
      x: 80 + nodesRef.current.length * 24,
      y: 80 + nodesRef.current.length * 16,
    };
    const next: Node = {
      id,
      type: 'studio',
      position,
      data: { label: nodeLabelZh(type), nodeType: type, config },
    };
    const snapshot = cloneGraph(nodesRef.current, edgesRef.current);
    const nextNodes = [...nodesRef.current, next];
    setNodes(nextNodes);
    nodesRef.current = nextNodes;
    void commands
      .applyNow(
        [{ type: 'addNode', nodeType: type, nodeId: id, position, config }],
        makeRollback(snapshot),
      )
      .then(handleCommandResult);
  }

  function updateSelectedConfig(key: string, raw: string) {
    const id = selectedIds[0];
    if (!id) return;
    const snapshot = cloneGraph(nodesRef.current, edgesRef.current);
    let nextConfig: Record<string, unknown> = { schemaVersion: 1 };
    const nextNodes = nodesRef.current.map((n) => {
      if (n.id !== id) return n;
      const nodeType = String((n.data as { nodeType?: string }).nodeType ?? '');
      const prev = {
        ...((n.data as { config?: Record<string, unknown> }).config ?? { schemaVersion: 1 }),
      };
      let value: unknown = raw;
      if (raw === '') value = null;
      else if (NUMERIC_CONFIG_KEYS.has(key)) value = Number(raw);
      prev[key] = value;
      const validated = validateNodeConfig(nodeType, prev);
      nextConfig = (validated.ok ? validated.config : prev) as Record<string, unknown>;
      return { ...n, data: { ...n.data, config: nextConfig } };
    });
    setNodes(nextNodes);
    nodesRef.current = nextNodes;
    commands.schedule(
      [{ type: 'configure', nodeId: id, config: nextConfig }],
      makeRollback(snapshot),
    );
  }

  const handleUndoRedo = useCallback(
    async (direction: 'undo' | 'redo') => {
      const result = direction === 'undo' ? await commands.undo() : await commands.redo();
      if (result.ok) {
        applyDraft(result.draft);
        setCmdError(null);
        setStatus(
          `${direction === 'undo' ? '已撤销' : '已重做'} · 修订 ${result.draft.revisionNumber}`,
        );
        return;
      }
      if (result.kind === 'nothing') {
        setStatus(result.message);
        return;
      }
      if (result.kind === 'conflict') {
        setConflict(result.message);
        setStatus('冲突 — 未覆盖');
        return;
      }
      setCmdError(result.message);
      setStatus(`操作失败：${result.message}`);
    },
    [commands, applyDraft],
  );

  const undo = useCallback(() => {
    void handleUndoRedo('undo');
  }, [handleUndoRedo]);

  const redo = useCallback(() => {
    void handleUndoRedo('redo');
  }, [handleUndoRedo]);

  const copySelected = useCallback(() => {
    const ids = new Set(selectedIds);
    if (ids.size === 0) return;
    const ns = nodesRef.current.filter((n) => ids.has(n.id));
    const es = edgesRef.current.filter((e) => ids.has(e.source) && ids.has(e.target));
    clipboardRef.current = cloneGraph(ns, es);
    setStatus(`已复制 ${ns.length} 个节点`);
  }, [selectedIds]);

  const pasteClipboard = useCallback(() => {
    const clip = clipboardRef.current;
    if (!clip || clip.nodes.length === 0) return;
    const snapshot = cloneGraph(nodesRef.current, edgesRef.current);
    const idMap = new Map<string, string>();
    const stamp = Date.now();
    const pastedNodes = clip.nodes.map((n, i) => {
      const newId = `${n.id}-copy-${stamp}-${i}`;
      idMap.set(n.id, newId);
      return {
        ...n,
        id: newId,
        position: { x: n.position.x + 40, y: n.position.y + 40 },
        selected: true,
      };
    });
    const pastedEdges = clip.edges.map((e, i) => ({
      ...e,
      id: `${e.id}-copy-${stamp}-${i}`,
      source: idMap.get(e.source) ?? e.source,
      target: idMap.get(e.target) ?? e.target,
    }));
    const nextNodes = [
      ...nodesRef.current.map((n) => ({ ...n, selected: false })),
      ...pastedNodes,
    ];
    const nextEdges = [...edgesRef.current, ...pastedEdges];
    setNodes(nextNodes);
    setEdges(nextEdges);
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setSelectedIds(pastedNodes.map((n) => n.id));
    const cmds: WorkflowCommand[] = [
      ...pastedNodes.map(
        (n): WorkflowCommand => ({
          type: 'addNode',
          nodeType: String((n.data as { nodeType?: string }).nodeType ?? 'source_image'),
          nodeId: n.id,
          position: { x: n.position.x, y: n.position.y },
          config: (n.data as { config?: Record<string, unknown> }).config ?? {
            schemaVersion: 1,
          },
        }),
      ),
      ...pastedEdges.map(
        (e): WorkflowCommand => ({
          type: 'connect',
          edgeId: e.id,
          source: e.source,
          sourceHandle: e.sourceHandle ?? null,
          target: e.target,
          targetHandle: e.targetHandle ?? null,
        }),
      ),
    ];
    void commands.applyNow(cmds, makeRollback(snapshot)).then((r) => {
      handleCommandResult(r);
      if (r.ok) setStatus(`已粘贴 ${pastedNodes.length} 个节点 · 修订 ${r.batch.revisionNumber}`);
    });
  }, [setNodes, setEdges, commands, handleCommandResult, makeRollback]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      const meta = ev.metaKey || ev.ctrlKey;
      if (meta && ev.key.toLowerCase() === 'z' && !ev.shiftKey) {
        ev.preventDefault();
        undo();
      } else if (meta && (ev.key.toLowerCase() === 'y' || (ev.key.toLowerCase() === 'z' && ev.shiftKey))) {
        ev.preventDefault();
        redo();
      } else if (meta && ev.key.toLowerCase() === 'c') {
        // allow native copy in inputs
        const t = ev.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        ev.preventDefault();
        copySelected();
      } else if (meta && ev.key.toLowerCase() === 'v') {
        const t = ev.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        ev.preventDefault();
        pasteClipboard();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, copySelected, pasteClipboard]);

  async function reload() {
    commands.reset();
    dragSnapshotRef.current = null;
    await loadOrCreate();
  }

  async function snapshot() {
    if (!draft) return;
    const flushed = commands.flush();
    if (flushed) {
      const r = await flushed;
      handleCommandResult(r);
      if (!r.ok) return;
    }
    const res = await fetch(`/api/workspaces/${workspaceId}/workflows/${draft.workflowId}/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ifRevision: revisionRef.current }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setStatus(`快照失败：${json?.error?.message ?? res.status}`);
      if (res.status === 409) setConflict(json?.error?.message ?? '冲突');
      return;
    }
    applyDraft(json.draft);
    setStatus(`快照 r${json.revision.revision} · 草稿修订 ${json.draft.revisionNumber}`);
  }

  const runNode = useCallback(
    async (nodeId: string) => {
      setRunBusy(true);
      setStatus('正在启动节点运行…');
      try {
        const r = await commands.applyNow([
          {
            type: 'run',
            scope: { type: 'NODES', nodeIds: [nodeId] },
            idempotencyKey: crypto.randomUUID(),
            budgetLimit: { currency: 'USD', amount: 5 },
            confirmBudget: true,
          },
        ]);
        handleCommandResult(r);
        if (r.ok && r.batch.run) {
          setStatus(
            `运行 ${r.batch.run.status}（${r.batch.run.id.slice(0, 8)}…）· 修订 ${r.batch.revisionNumber}`,
          );
        }
      } finally {
        setRunBusy(false);
      }
    },
    [commands, handleCommandResult],
  );

  const runAll = useCallback(async (): Promise<string> => {
    const r = await commands.applyNow([
      {
        type: 'run',
        scope: { type: 'ALL' },
        idempotencyKey: crypto.randomUUID(),
        budgetLimit: { currency: 'USD', amount: 5 },
        confirmBudget: true,
      },
    ]);
    handleCommandResult(r);
    if (r.ok) {
      return r.batch.run ? `运行 ${r.batch.run.status}（${r.batch.run.id.slice(0, 8)}…）` : '运行已提交';
    }
    return r.failure.kind === 'conflict' ? '冲突 — 请加载远端' : `运行失败：${r.failure.message}`;
  }, [commands, handleCommandResult]);

  async function openMaskEditor() {
    const fromSelected =
      typeof selectedConfig.assetVersionId === 'string' && selectedConfig.assetVersionId
        ? selectedConfig.assetVersionId
        : null;
    const versionId = fromSelected ?? sourceAssetVersionId;
    if (!versionId) {
      setStatus('请先为 source_image 选择素材版本以编辑蒙版');
      return;
    }
    const res = await fetch(
      `/api/workspaces/${workspaceId}/asset-versions/${versionId}/download-url?kind=NORMALIZED_PNG`,
    );
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setStatus(`蒙版编辑器：${json?.error?.message ?? res.status}`);
      return;
    }
    setMaskEditor({ imageUrl: json.url, versionId, width: 1024, height: 1024 });
  }

  function onMaskSaved(id: string) {
    if (selectedInfo?.nodeType === 'replace_background' || selectedInfo?.nodeType === 'inpaint') {
      updateSelectedConfig('maskId', id);
    }
    configOptions.reloadMasks();
    setStatus(`蒙版已保存 ${id.slice(0, 8)}…`);
  }

  if (narrow) {
    return (
      <main className="container" role="main" aria-labelledby="studio-narrow-title">
        <h1 id="studio-narrow-title">Studio（画布）</h1>
        <p role="alert" className="banner-warn">
          仅桌面端画布编辑器。最小宽度 1280px — 当前视口不支持完整画布编辑。请旋转设备或加宽浏览器窗口。
        </p>
      </main>
    );
  }

  const errorBar = edgeError
    ? `非法连线已阻止：${edgeError}`
    : cmdError
      ? `命令错误：${cmdError}`
      : null;

  return (
    <div
      role="application"
      aria-label="Studio 工作流画布"
      className={belowStepper ? 'studio-grid studio-grid-below-stepper' : 'studio-grid'}
    >
      <aside aria-label="节点库" className="studio-aside studio-aside-left">
        <div style={{ fontWeight: 700, marginBottom: 'var(--space-2)' }} id="node-library-heading">
          节点库
        </div>
        <div className="faint" style={{ fontSize: 'var(--font-size-xs)', marginBottom: 'var(--space-2)' }}>
          11 种 MVP 节点 · Zod 配置（W3-05）
        </div>
        {palette.map((n) => (
          <button
            key={n.type}
            type="button"
            onClick={() => addNode(n.type)}
            className="palette-btn"
          >
            {nodeLabelZh(n.type)}
          </button>
        ))}
      </aside>

      <div className="studio-canvas-wrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChangeWrapped}
          onEdgesChange={onEdgesChangeWrapped}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          nodeTypes={nodeTypes}
          onSelectionChange={({ nodes: sel }) => setSelectedIds(sel.map((n) => n.id))}
          fitView
          deleteKeyCode={['Backspace', 'Delete']}
          multiSelectionKeyCode="Shift"
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} color="var(--border)" />
          <MiniMap pannable zoomable style={{ background: 'var(--surface)' }} />
          <Controls />
          <Panel position="top-left">
            <div className="studio-toolbar">
              <span role="status" aria-live="polite">{status}</span>
              <button type="button" className="btn" onClick={() => void reload()}>
                重新加载
              </button>
              <button type="button" className="btn" onClick={() => void snapshot()}>
                快照
              </button>
              <button type="button" className="btn" onClick={() => undo()} title="Ctrl/Cmd+Z">
                撤销
              </button>
              <button type="button" className="btn" onClick={() => redo()} title="Ctrl/Cmd+Y">
                重做
              </button>
              <button type="button" className="btn" onClick={() => copySelected()} title="Ctrl/Cmd+C">
                复制
              </button>
              <button type="button" className="btn" onClick={() => pasteClipboard()} title="Ctrl/Cmd+V">
                粘贴
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void fitView({ padding: 0.2, duration: 200 });
                  setStatus('适应视图');
                }}
              >
                适应视图
              </button>
            </div>
          </Panel>
        </ReactFlow>
        {errorBar && (
          <div className="banner-error canvas-overlay" style={{ bottom: 12 }}>
            {errorBar}
          </div>
        )}
        {deleteHint && (
          <div
            className="banner-info canvas-overlay"
            style={{ bottom: errorBar ? 56 : 12, display: 'flex', justifyContent: 'space-between' }}
          >
            <span>{deleteHint}</span>
            <button type="button" className="btn" onClick={() => setDeleteHint(null)}>
              关闭
            </button>
          </div>
        )}
        {conflict && (
          <div className="banner-warn canvas-overlay" style={{ top: 48 }}>
            <strong>409 冲突</strong> — {conflict}
            <div style={{ marginTop: 'var(--space-2)' }}>
              <button type="button" className="btn" onClick={() => void reload()}>
                加载远端
              </button>
            </div>
          </div>
        )}
      </div>

      <aside className="studio-aside studio-aside-right">
        <PropertiesPanel
          workspaceId={workspaceId}
          selected={selectedInfo}
          options={configOptions}
          sourceAssetVersionId={sourceAssetVersionId}
          draftRevision={draft?.revisionNumber ?? null}
          runBusy={runBusy}
          onConfigChange={updateSelectedConfig}
          onRunNode={(id) => void runNode(id)}
          onOpenMaskEditor={() => void openMaskEditor()}
          maskEditor={maskEditor}
          maskEditorMaskId={
            typeof selectedConfig.maskId === 'string' ? selectedConfig.maskId : null
          }
          onMaskSaved={onMaskSaved}
          onMaskClose={() => setMaskEditor(null)}
        />
      </aside>

      <TaskDrawer workspaceId={workspaceId} projectId={projectId} ready={draft !== null} onRunAll={runAll} />
    </div>
  );
}


function TaskDrawer(props: {
  workspaceId: string;
  projectId: string;
  ready: boolean;
  onRunAll: () => Promise<string>;
}) {
  const { workspaceId, projectId, ready, onRunAll } = props;
  const [runs, setRuns] = useState<
    Array<{
      id: string;
      status: string;
      estimateMicrounits: number;
      items: Array<{
        id: string;
        nodeId: string;
        status: string;
        attempts: Array<{
          id: string;
          attemptNo: number;
          status: string;
          progress: number;
          errorClass?: string | null;
          errorMessage?: string | null;
        }>;
      }>;
    }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const res = await fetch(
      `/api/workspaces/${workspaceId}/projects/${projectId}/runs`,
      { credentials: 'include' },
    );
    if (res.ok) {
      const data = await res.json();
      setRuns(data.runs ?? []);
    }
  }, [workspaceId, projectId]);

  useEffect(() => {
    void refresh();
    const es = new EventSource(
      `/api/workspaces/${workspaceId}/events?projectId=${projectId}`,
      // cookies included same-origin
    );
    const push = (type: string, ev: MessageEvent) => {
      setEvents((prev) => [`${type}: ${ev.data}`.slice(0, 180), ...prev].slice(0, 8));
      void refresh();
    };
    es.addEventListener('attempt.running', (e) => push('running', e as MessageEvent));
    es.addEventListener('attempt.progress', (e) => push('progress', e as MessageEvent));
    es.addEventListener('attempt.succeeded', (e) => push('ok', e as MessageEvent));
    es.addEventListener('attempt.failed', (e) => push('fail', e as MessageEvent));
    es.onerror = () => {
      /* browser auto-reconnects */
    };
    const t = setInterval(() => void refresh(), 3000);
    return () => {
      es.close();
      clearInterval(t);
    };
  }, [workspaceId, projectId, refresh]);

  async function runAll() {
    setBusy(true);
    setMsg(null);
    try {
      const message = await onRunAll();
      setMsg(message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function cancelRun(runId: string) {
    await fetch(`/api/workspaces/${workspaceId}/runs/${runId}/cancel`, {
      method: 'POST',
      credentials: 'include',
    });
    await refresh();
  }

  async function retryAttempt(attemptId: string) {
    await fetch(`/api/workspaces/${workspaceId}/attempts/${attemptId}/retry`, {
      method: 'POST',
      credentials: 'include',
    });
    await refresh();
  }

  return (
    <div className="studio-drawer">
      <div className="row">
        <strong>任务抽屉</strong>
        <button type="button" className="btn" disabled={busy || !ready} onClick={() => void runAll()}>
          {busy ? '启动中…' : '运行整图（Fake · 预算 $5）'}
        </button>
        <button type="button" className="btn" onClick={() => void refresh()}>
          刷新
        </button>
        {msg && <span style={{ opacity: 0.85 }}>{msg}</span>}
      </div>
      <div className="stack" style={{ gap: 6, maxHeight: 160, overflow: 'auto' }}>
        {runs.length === 0 && (
          <div role="status" className="faint">暂无运行 — 排队 / 运行中 / 成功 / 失败会显示在这里。</div>
        )}
        {runs.map((r) => (
          <div key={r.id} className="run-card">
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'space-between' }}>
              <span>
                <code>{r.id.slice(0, 8)}</code> · <strong>{r.status}</strong> · 预估{' '}
                {(r.estimateMicrounits / 1_000_000).toFixed(3)} USD
              </span>
              {(r.status === 'QUEUED' || r.status === 'RUNNING') && (
                <button type="button" className="btn" onClick={() => void cancelRun(r.id)}>
                  取消
                </button>
              )}
            </div>
            {r.items.map((it) => {
              const latest = it.attempts[it.attempts.length - 1];
              return (
                <div key={it.id} style={{ fontSize: 'var(--font-size-sm)', opacity: 0.9, paddingLeft: 8 }}>
                  节点 <code>{it.nodeId}</code> · {it.status}
                  {latest && (
                    <>
                      {' '}
                      · 尝试 #{latest.attemptNo} {latest.status}（{latest.progress}%）
                      {latest.errorClass && (
                        <span style={{ color: 'var(--danger-text)' }}>
                          {' '}
                          {latest.errorClass}: {latest.errorMessage}
                        </span>
                      )}
                      {(latest.status === 'FAILED_FINAL' || latest.status === 'FAILED_RETRYABLE') && (
                        <button type="button" className="btn" style={{ marginLeft: 8 }} onClick={() => void retryAttempt(latest.id)}>
                          重试
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {events.length > 0 && (
        <div className="faint" style={{ fontSize: 'var(--font-size-xs)' }}>
          SSE: {events[0]}
        </div>
      )}
    </div>
  );
}

export function StudioCanvas(props: {
  workspaceId: string;
  projectId: string;
  workflowId?: string | null;
  belowStepper?: boolean;
}) {
  return (
    <ReactFlowProvider>
      <StudioCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
