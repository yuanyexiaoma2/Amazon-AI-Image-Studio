'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent as ReactDragEvent } from 'react';
import Link from 'next/link';
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
  STARTER_TEMPLATES,
  buildStarterTemplateCommands,
  type StarterTemplateId,
} from './starter-templates';
import { IMAGE_FILE_RE, useAssetUpload } from '@/lib/use-asset-upload';
import {
  PropertiesPanel,
  type MaskEditorState,
  type SelectedNodeInfo,
} from './PropertiesPanel';
import { ChatPanel } from './ChatPanel';
import { AssetImage } from '../asset-image';
import { NUMERIC_CONFIG_KEYS } from './config-options';
import { zh, RUN_STATUS_ZH } from '@/lib/zh-labels';

type CanvasSnapshot = { nodes: Node[]; edges: Edge[] };

/** Result of a whole-canvas run, shared by the toolbar button and TaskDrawer. */
type RunAllOutcome = { message: string; authRequired: boolean };

const NODE_LABEL_ZH: Record<string, string> = {
  source_image: '参考图',
  product_truth: '产品图',
  prompt: '提示词',
  remove_background: '抠图',
  generate: '生成',
  replace_background: '换背景',
  inpaint: '局部重绘',
  outpaint: '扩图',
  upscale: '高清放大',
  qa_gate: '质检',
  approval_selector: '人工挑选',
  export: '导出',
};

function nodeLabelZh(type: string): string {
  return NODE_LABEL_ZH[type] ?? getNodeDefinition(type)?.label ?? type;
}

const PORT_LABEL_ZH: Record<string, string> = {
  image: '图片',
  images: '图片',
  mask: '蒙版',
  prompt: '提示词',
  truth: '产品图',
  references: '参考图',
  shotBrief: '分镜说明',
};

/** Node-card affordances provided by StudioCanvasInner (upload / hints). */
type NodeActionContextValue = {
  uploadIntoNode: (nodeId: string) => void;
  missingPorts: (nodeId: string) => string[];
};

const NodeActionContext = createContext<NodeActionContextValue>({
  uploadIntoNode: () => {},
  missingPorts: () => [],
});

function toFlowNodes(graph: WorkflowGraph, workspaceId: string): Node[] {
  return graph.nodes.map((n) => ({
    id: n.id,
    type: 'studio',
    position: n.position,
    data: {
      label: nodeLabelZh(n.type),
      nodeType: n.type,
      config: n.config ?? { schemaVersion: 1 },
      workspaceId,
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
  const actions = useContext(NodeActionContext);
  const data = props.data as {
    workspaceId?: string;
    config?: Record<string, unknown>;
  };
  const sourceVersionId =
    nodeType === 'source_image' && typeof data.config?.assetVersionId === 'string'
      ? (data.config.assetVersionId as string)
      : null;
  const promptText =
    nodeType === 'prompt' && typeof data.config?.text === 'string'
      ? data.config.text.trim()
      : '';
  const missing = actions.missingPorts(props.id);
  return (
    <div className={props.selected ? 'studio-node studio-node-selected' : 'studio-node'}>
      {def?.inputPorts.map((p, i) => (
        <Handle
          key={`in-${p.id}`}
          id={p.id}
          type="target"
          position={Position.Left}
          style={{ top: 16 + i * 14, background: 'var(--accent-strong)', width: 8, height: 8 }}
          title={PORT_LABEL_ZH[p.id] ?? p.id}
        />
      ))}
      <div style={{ fontWeight: 600 }}>{label}</div>
      {sourceVersionId ? (
        <div style={{ marginTop: 4 }}>
          <AssetImage
            workspaceId={data.workspaceId ?? null}
            versionId={sourceVersionId}
            size={36}
            alt={label}
          />
        </div>
      ) : null}
      {nodeType === 'source_image' && !sourceVersionId ? (
        <button
          type="button"
          className="btn studio-node-upload nodrag"
          onClick={(e) => {
            e.stopPropagation();
            actions.uploadIntoNode(props.id);
          }}
        >
          上传图片
        </button>
      ) : null}
      {nodeType === 'prompt' ? (
        <div className={promptText ? 'studio-node-preview' : 'studio-node-preview faint'}>
          {promptText
            ? promptText.length > 60
              ? `${promptText.slice(0, 60)}…`
              : promptText
            : '点选我，在右侧写提示词'}
        </div>
      ) : null}
      {missing.length > 0 ? (
        <div className="studio-node-missing">缺连线：{missing.join(' / ')}</div>
      ) : null}
      {def?.outputPorts.map((p, i) => (
        <Handle
          key={`out-${p.id}`}
          id={p.id}
          type="source"
          position={Position.Right}
          style={{ top: 16 + i * 14, background: 'var(--ok-soft)', width: 8, height: 8 }}
          title={PORT_LABEL_ZH[p.id] ?? p.id}
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
  const { fitView, screenToFlowPosition } = useReactFlow();
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
  const [narrowDismissed, setNarrowDismissed] = useState(false);
  const [rightTab, setRightTab] = useState<'properties' | 'chat'>('properties');
  const [starterDismissed, setStarterDismissed] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [runAllBusy, setRunAllBusy] = useState(false);
  const [runAllMsg, setRunAllMsg] = useState<RunAllOutcome | null>(null);
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  const revisionRef = useRef(0);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const clipboardRef = useRef<CanvasSnapshot | null>(null);
  const draftRef = useRef<WorkflowDraftPayload | null>(null);
  const dragSnapshotRef = useRef<CanvasSnapshot | null>(null);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  draftRef.current = draft;

  // Re-offer starter templates whenever the canvas becomes empty again (e.g.
  // after undoing a template batch) — "dismissed" only sticks while the
  // canvas stays empty (空白画布 choice).
  useEffect(() => {
    if (nodes.length > 0 && starterDismissed) setStarterDismissed(false);
  }, [nodes.length, starterDismissed]);

  const palette = useMemo(() => listPaletteNodeTypes(), []);

  const { uploadAsset } = useAssetUpload(workspaceId, projectId);

  const handleSelectionChange = useCallback(({ nodes: sel }: { nodes: Array<{ id: string }> }) => {
    setSelectedIds((prev) => {
      if (prev.length === sel.length && prev.every((id, i) => id === sel[i].id)) return prev;
      return sel.map((n) => n.id);
    });
  }, []);

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
          '并发编辑冲突 — 另一个窗口也改了这张画布。点「加载远端」以对方版本为准，或放弃本地修改。',
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

  const getRevision = useCallback(() => revisionRef.current, []);

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

  // Chat agent (or its undo) mutated the draft server-side: adopt the
  // authoritative graph + revision so later local batches do not 409.
  // applyExternal first flushes pending debounced edits (async) so they are
  // not silently dropped, then resyncs the optimistic-concurrency revision.
  const handleGraphChanged = useCallback(
    (graph: WorkflowGraph, revisionNumber: number) => {
      void commands.applyExternal(revisionNumber);
      setDraft((prev) => (prev ? { ...prev, revisionNumber } : prev));
      applyLocalSnapshot({ nodes: toFlowNodes(graph, workspaceId), edges: toFlowEdges(graph) });
      setCmdError(null);
      setStatus(`画布助手已更新画布 · 修订 ${revisionNumber}`);
    },
    [commands, applyLocalSnapshot, workspaceId],
  );

  const makeRollback = useCallback(
    (snap: CanvasSnapshot) => () => applyLocalSnapshot(snap),
    [applyLocalSnapshot],
  );

  const applyDraft = useCallback(
    (d: WorkflowDraftPayload) => {
      setDraft(d);
      revisionRef.current = d.revisionNumber;
      applyLocalSnapshot({ nodes: toFlowNodes(d.graph, workspaceId), edges: toFlowEdges(d.graph) });
    },
    [applyLocalSnapshot, workspaceId],
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
          body: JSON.stringify({ name: '新建工作流' }),
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

  const addNodeAt = useCallback(
    (type: string, position?: { x: number; y: number }) => {
      const id = `n-${type}-${Date.now()}`;
      const config = isWorkflowNodeConfigType(type)
        ? (defaultNodeConfig(type) as Record<string, unknown>)
        : { schemaVersion: 1 };
      const pos = position ?? {
        x: 80 + nodesRef.current.length * 24,
        y: 80 + nodesRef.current.length * 16,
      };
      const next: Node = {
        id,
        type: 'studio',
        position: pos,
        data: { label: nodeLabelZh(type), nodeType: type, config, workspaceId },
      };
      const snapshot = cloneGraph(nodesRef.current, edgesRef.current);
      const nextNodes = [...nodesRef.current, next];
      setNodes(nextNodes);
      nodesRef.current = nextNodes;
      void commands
        .applyNow(
          [{ type: 'addNode', nodeType: type, nodeId: id, position: pos, config }],
          makeRollback(snapshot),
        )
        .then(handleCommandResult);
    },
    [setNodes, commands, handleCommandResult, makeRollback, workspaceId],
  );

  function addNode(type: string) {
    addNodeAt(type);
  }

  function updateNodeConfig(id: string, key: string, raw: string) {
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

  function updateSelectedConfig(key: string, raw: string) {
    const id = selectedIds[0];
    if (!id) return;
    updateNodeConfig(id, key, raw);
  }

  // PR-6 node-card upload: 「上传图片」 button on an empty source_image node.
  const nodeFileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingUploadNodeRef = useRef<string | null>(null);
  const uploadIntoNode = useCallback((nodeId: string) => {
    pendingUploadNodeRef.current = nodeId;
    nodeFileInputRef.current?.click();
  }, []);

  async function onNodeFilePicked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const nodeId = pendingUploadNodeRef.current;
    pendingUploadNodeRef.current = null;
    if (!file || !nodeId) return;
    setUploadNotice(`正在上传 ${file.name}…`);
    try {
      const asset = await uploadAsset(file, (m) => setUploadNotice(`${file.name} — ${m}`));
      if (asset.status === 'REJECTED') {
        setUploadNotice(`${file.name} 未通过检查 — 请更换图片`);
        return;
      }
      if (asset.versionId) updateNodeConfig(nodeId, 'assetVersionId', asset.versionId);
      setUploadNotice(
        asset.status === 'READY' ? `已上传 ${file.name}` : `已上传 ${file.name}，处理中…`,
      );
    } catch {
      setUploadNotice(`上传失败：${file.name}`);
    }
  }

  // Required-but-unconnected input ports per node (drives 缺连线 hints).
  const missingPortsByNode = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const n of nodes) {
      const nodeType = String((n.data as { nodeType?: string }).nodeType ?? '');
      const def = getNodeDefinition(nodeType);
      if (!def) continue;
      const missing = def.inputPorts
        .filter((p) => p.required)
        .filter(
          (p) =>
            !edges.some(
              (e) =>
                e.target === n.id &&
                (e.targetHandle ? e.targetHandle === p.id : def.inputPorts.length === 1),
            ),
        )
        .map((p) => PORT_LABEL_ZH[p.id] ?? p.id);
      if (missing.length > 0) map.set(n.id, missing);
    }
    return map;
  }, [nodes, edges]);

  const nodeActions = useMemo<NodeActionContextValue>(
    () => ({
      uploadIntoNode,
      missingPorts: (nodeId) => missingPortsByNode.get(nodeId) ?? [],
    }),
    [uploadIntoNode, missingPortsByNode],
  );

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
            `运行${zh(RUN_STATUS_ZH, r.batch.run.status)}（${r.batch.run.id.slice(0, 8)}…）· 修订 ${r.batch.revisionNumber}`,
          );
        }
      } finally {
        setRunBusy(false);
      }
    },
    [commands, handleCommandResult],
  );

  const runAll = useCallback(async (): Promise<RunAllOutcome> => {
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
      return {
        message: r.batch.run
          ? `运行${zh(RUN_STATUS_ZH, r.batch.run.status)}（${r.batch.run.id.slice(0, 8)}…）`
          : '运行已提交',
        authRequired: false,
      };
    }
    if (r.failure.status === 401) {
      return { message: '生图需要登录账号', authRequired: true };
    }
    return {
      message:
        r.failure.kind === 'conflict' ? '冲突 — 请加载远端' : `运行失败：${r.failure.message}`,
      authRequired: false,
    };
  }, [commands, handleCommandResult]);

  // Shared whole-canvas run trigger (toolbar button + TaskDrawer button).
  const triggerRunAll = useCallback(async () => {
    setRunAllBusy(true);
    setRunAllMsg(null);
    setDrawerExpanded(true);
    try {
      setRunAllMsg(await runAll());
    } finally {
      setRunAllBusy(false);
    }
  }, [runAll]);

  // Starter templates: one applyNow batch (one undo step), then adopt the
  // authoritative graph from the response and fit the view.
  const applyTemplate = useCallback(
    (templateId: StarterTemplateId) => {
      if (templateId === 'blank') {
        setStarterDismissed(true);
        return;
      }
      setStarterDismissed(true);
      setStatus('正在应用模板…');
      const snapshot = cloneGraph(nodesRef.current, edgesRef.current);
      void commands
        .applyNow(buildStarterTemplateCommands(templateId), makeRollback(snapshot))
        .then((r) => {
          handleCommandResult(r);
          if (r.ok) {
            applyLocalSnapshot({
              nodes: toFlowNodes(r.batch.graph, workspaceId),
              edges: toFlowEdges(r.batch.graph),
            });
            setStatus(`已应用模板 · 修订 ${r.batch.revisionNumber}`);
            setTimeout(() => void fitView({ padding: 0.2, duration: 200 }), 50);
          } else {
            setStarterDismissed(false);
          }
        });
    },
    [commands, handleCommandResult, makeRollback, applyLocalSnapshot, workspaceId, fitView],
  );

  const onCanvasDragOver = useCallback((ev: ReactDragEvent<HTMLDivElement>) => {
    const types = ev.dataTransfer.types;
    if (types.includes('application/studio-node') || types.includes('Files')) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const onCanvasDrop = useCallback(
    (ev: ReactDragEvent<HTMLDivElement>) => {
      const position = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const nodeType = ev.dataTransfer.getData('application/studio-node');
      if (nodeType) {
        ev.preventDefault();
        if (getNodeDefinition(nodeType)?.palette) addNodeAt(nodeType, position);
        return;
      }
      const file = [...ev.dataTransfer.files].find((f) => IMAGE_FILE_RE.test(f.name));
      if (!file) return;
      ev.preventDefault();
      void (async () => {
        setUploadNotice(`正在上传 ${file.name}…`);
        try {
          const asset = await uploadAsset(file, (m) => setUploadNotice(`${file.name} — ${m}`));
          if (asset.status === 'REJECTED') {
            setUploadNotice(`${file.name} 未通过检查 — 请更换图片`);
            return;
          }
          const id = `n-source_image-${Date.now()}`;
          const config = {
            ...(defaultNodeConfig('source_image') as Record<string, unknown>),
            assetVersionId: asset.versionId,
          };
          const snapshot = cloneGraph(nodesRef.current, edgesRef.current);
          const next: Node = {
            id,
            type: 'studio',
            position,
            data: {
              label: nodeLabelZh('source_image'),
              nodeType: 'source_image',
              config,
              workspaceId,
            },
          };
          const nextNodes = [...nodesRef.current, next];
          setNodes(nextNodes);
          nodesRef.current = nextNodes;
          const r = await commands.applyNow(
            [{ type: 'addNode', nodeType: 'source_image', nodeId: id, position, config }],
            makeRollback(snapshot),
          );
          handleCommandResult(r);
          if (r.ok) {
            setUploadNotice(
              asset.versionId
                ? `${file.name} 已上传并绑定到参考图节点`
                : `${file.name} 已上传，素材仍在处理中 — 稍后可在属性面板选择素材版本`,
            );
          }
        } catch (e) {
          setUploadNotice(`上传失败：${e instanceof Error ? e.message : String(e)}`);
        }
      })();
    },
    [
      screenToFlowPosition,
      uploadAsset,
      addNodeAt,
      commands,
      handleCommandResult,
      makeRollback,
      setNodes,
      workspaceId,
    ],
  );

  async function openMaskEditor() {
    const fromSelected =
      typeof selectedConfig.assetVersionId === 'string' && selectedConfig.assetVersionId
        ? selectedConfig.assetVersionId
        : null;
    const versionId = fromSelected ?? sourceAssetVersionId;
    if (!versionId) {
      setStatus('请先在「参考图」节点选择素材版本，再编辑蒙版');
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

  const errorBar = edgeError
    ? `非法连线已阻止：${edgeError}`
    : cmdError
      ? `命令错误：${cmdError}`
      : null;

  return (
    <div
      role="application"
      aria-label="工作流画布"
      className={belowStepper ? 'studio-grid studio-grid-below-stepper' : 'studio-grid'}
    >
      <aside aria-label="节点库" className="studio-aside studio-aside-left">
        <div style={{ fontWeight: 700, marginBottom: 'var(--space-2)' }} id="node-library-heading">
          节点库
        </div>
        <div className="faint" style={{ fontSize: 'var(--font-size-xs)', marginBottom: 'var(--space-2)' }}>
          11 种节点 · 点击添加或拖到画布 · 也可直接拖入图片文件
        </div>
        {palette.map((n) => (
          <button
            key={n.type}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/studio-node', n.type);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => addNode(n.type)}
            className="palette-btn"
            title="点击添加，或拖拽到画布指定位置"
          >
            {nodeLabelZh(n.type)}
          </button>
        ))}
      </aside>

      <div
        className="studio-canvas-wrap"
        onDragOver={onCanvasDragOver}
        onDrop={onCanvasDrop}
      >
        <input
          ref={nodeFileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => void onNodeFilePicked(e)}
        />
        <NodeActionContext.Provider value={nodeActions}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChangeWrapped}
          onEdgesChange={onEdgesChangeWrapped}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          nodeTypes={nodeTypes}
          onSelectionChange={handleSelectionChange}
          fitView
          deleteKeyCode={['Backspace', 'Delete']}
          multiSelectionKeyCode="Shift"
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} color="var(--canvas-dot)" />
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
              <button
                type="button"
                className="btn btn-primary"
                disabled={runAllBusy || !draft}
                onClick={() => void triggerRunAll()}
                title="运行整张画布（演示模式 · 预算 $5）"
              >
                {runAllBusy ? '启动中…' : '▶ 运行整图'}
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
        </NodeActionContext.Provider>
        {draft !== null && nodes.length === 0 && !starterDismissed && (
          <div className="starter-overlay">
            <div className="starter-panel" role="dialog" aria-label="画布起始模板">
              <div style={{ fontWeight: 700 }}>三步出图：选模板 → 在节点上上传图片、写提示词 → ▶ 运行整图</div>
              <div className="starter-grid">
                {STARTER_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="starter-card"
                    onClick={() => applyTemplate(t.id)}
                  >
                    <span className="starter-card-title">{t.title}</span>
                    <span className="starter-card-desc">{t.description}</span>
                  </button>
                ))}
              </div>
              <div className="faint" style={{ fontSize: 'var(--font-size-sm)' }}>
                也可以直接把图片文件拖进画布，或从左侧节点库拖节点进来。
              </div>
            </div>
          </div>
        )}
        {narrow && !narrowDismissed && (
          <div
            className="banner-warn canvas-overlay"
            role="alert"
            style={{
              top: 12,
              left: 'auto',
              maxWidth: 380,
              display: 'flex',
              gap: 'var(--space-2)',
              justifyContent: 'space-between',
              zIndex: 11,
            }}
          >
            <span>视口宽度不足 1280px — 画布编辑可能显示不完整，建议加宽浏览器窗口。</span>
            <button type="button" className="btn" onClick={() => setNarrowDismissed(true)}>
              关闭
            </button>
          </div>
        )}
        {uploadNotice && (
          <div
            className="banner-info canvas-overlay"
            role="status"
            style={{ bottom: 12, display: 'flex', justifyContent: 'space-between', zIndex: 11 }}
          >
            <span>{uploadNotice}</span>
            <button type="button" className="btn" onClick={() => setUploadNotice(null)}>
              关闭
            </button>
          </div>
        )}
        {errorBar && (
          <div className="banner-error canvas-overlay" style={{ bottom: uploadNotice ? 56 : 12 }}>
            {errorBar}
          </div>
        )}
        {deleteHint && (
          <div
            className="banner-info canvas-overlay"
            style={{
              bottom: errorBar || uploadNotice ? 56 : 12,
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>{deleteHint}</span>
            <button type="button" className="btn" onClick={() => setDeleteHint(null)}>
              关闭
            </button>
          </div>
        )}
        {conflict && (
          <div className="banner-warn canvas-overlay" style={{ top: 48 }}>
            <strong>编辑冲突</strong> — {conflict}
            <div style={{ marginTop: 'var(--space-2)' }}>
              <button type="button" className="btn" onClick={() => void reload()}>
                加载远端
              </button>
            </div>
          </div>
        )}
      </div>

      <aside className="studio-aside studio-aside-right studio-aside-flex">
        <div className="studio-tabs" role="tablist" aria-label="右侧面板切换">
          <button
            type="button"
            role="tab"
            aria-selected={rightTab === 'properties'}
            className={rightTab === 'properties' ? 'btn btn-primary' : 'btn'}
            onClick={() => setRightTab('properties')}
          >
            属性
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rightTab === 'chat'}
            className={rightTab === 'chat' ? 'btn btn-primary' : 'btn'}
            onClick={() => setRightTab('chat')}
          >
            助手
          </button>
        </div>
        <div className={rightTab === 'properties' ? undefined : 'studio-tab-hidden'}>
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
        </div>
        <div className={rightTab === 'chat' ? 'chat-panel' : 'studio-tab-hidden'}>
          <ChatPanel
            workspaceId={workspaceId}
            projectId={projectId}
            workflowId={draft?.workflowId ?? null}
            getRevision={getRevision}
            onGraphChanged={handleGraphChanged}
          />
        </div>
      </aside>

      <TaskDrawer
        workspaceId={workspaceId}
        projectId={projectId}
        ready={draft !== null}
        expanded={drawerExpanded}
        onToggleExpanded={() => setDrawerExpanded((v) => !v)}
        onExpand={() => setDrawerExpanded(true)}
        busy={runAllBusy}
        msg={runAllMsg}
        onRunAll={triggerRunAll}
      />
    </div>
  );
}


function TaskDrawer(props: {
  workspaceId: string;
  projectId: string;
  ready: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onExpand: () => void;
  busy: boolean;
  msg: RunAllOutcome | null;
  onRunAll: () => Promise<void>;
}) {
  const { workspaceId, projectId, ready, expanded, onToggleExpanded, onExpand, busy, msg, onRunAll } =
    props;
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
    es.addEventListener('attempt.running', (e) => push('运行中', e as MessageEvent));
    es.addEventListener('attempt.progress', (e) => push('进度', e as MessageEvent));
    es.addEventListener('attempt.succeeded', (e) => push('成功', e as MessageEvent));
    es.addEventListener('attempt.failed', (e) => push('失败', e as MessageEvent));
    es.onerror = () => {
      /* browser auto-reconnects */
    };
    const t = setInterval(() => void refresh(), 3000);
    return () => {
      es.close();
      clearInterval(t);
    };
  }, [workspaceId, projectId, refresh]);

  // Auto-expand while anything is queued/running.
  useEffect(() => {
    if (runs.some((r) => r.status === 'RUNNING' || r.status === 'QUEUED')) onExpand();
  }, [runs, onExpand]);

  async function runAll() {
    await onRunAll();
    await refresh();
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
          {busy ? '启动中…' : '运行整图（演示模式 · 预算 $5）'}
        </button>
        <button type="button" className="btn" onClick={() => void refresh()}>
          刷新
        </button>
        {msg && (
          <span style={{ opacity: 0.85 }}>
            {msg.authRequired ? (
              <>
                生图需要登录账号 — <Link href="/login">去登录</Link>
              </>
            ) : (
              msg.message
            )}
          </span>
        )}
        <span style={{ marginLeft: 'auto' }}>
          <button type="button" className="btn" onClick={onToggleExpanded}>
            {expanded ? '收起 ▾' : `展开 ▴（${runs.length} 个运行）`}
          </button>
        </span>
      </div>
      {!expanded ? null : (
        <>
          <div className="stack" style={{ gap: 6, maxHeight: 160, overflow: 'auto' }}>
        {runs.length === 0 && (
          <div role="status" className="faint">暂无运行 — 排队 / 运行中 / 成功 / 失败会显示在这里。</div>
        )}
        {runs.map((r) => (
          <div key={r.id} className="run-card">
            <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'space-between' }}>
              <span>
                <code>{r.id.slice(0, 8)}</code> · <strong>{zh(RUN_STATUS_ZH, r.status)}</strong> · 预估{' '}
                {(r.estimateMicrounits / 1_000_000).toFixed(3)} 美元
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
                  节点 <code>{it.nodeId}</code> · {zh(RUN_STATUS_ZH, it.status)}
                  {latest && (
                    <>
                      {' '}
                      · 尝试 #{latest.attemptNo} {zh(RUN_STATUS_ZH, latest.status)}（{latest.progress}%）
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
              实时事件：{events[0]}
            </div>
          )}
        </>
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
