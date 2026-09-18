'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react';
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
  type OnConnectEnd,
  type OnConnectStart,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  validateEdge,
  arePortTypesCompatible,
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
import { buildSuiteCommands } from './suite-template';
import { IMAGE_FILE_RE, useAssetUpload } from '@/lib/use-asset-upload';
import { ChatPanel } from './ChatPanel';
import { applyConfigEdit } from './config-options';
import { zh, RUN_STATUS_ZH, NODE_TYPE_ZH, CONFIG_FIELD_ZH, formatCommandErrorZh } from '@/lib/zh-labels';
import { NodeActionContext, PORT_LABEL_ZH, type ImageQuickAction, type NodeActionContextValue } from './nodes/context';
import { studioNodeTypes } from './nodes';
import { PromptBar, type PromptBarValues } from './PromptBar';
import { LeftRail, type RailPanelKind } from './rail/LeftRail';
import { HistoryPanel, type RunAllOutcome } from './rail/HistoryPanel';

type CanvasSnapshot = { nodes: Node[]; edges: Edge[] };

function nodeLabelZh(type: string): string {
  return NODE_TYPE_ZH[type] ?? getNodeDefinition(type)?.label ?? type;
}

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

  const [conflict, setConflict] = useState<string | null>(null);
  const [edgeError, setEdgeError] = useState<string | null>(null);
  const [cmdError, setCmdError] = useState<string | null>(null);
  const [deleteHint, setDeleteHint] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [narrowDismissed, setNarrowDismissed] = useState(false);
  const [railPanel, setRailPanel] = useState<RailPanelKind | null>(null);
  const [starterDismissed, setStarterDismissed] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [runAllBusy, setRunAllBusy] = useState(false);
  const [runAllMsg, setRunAllMsg] = useState<RunAllOutcome | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [nodeResults, setNodeResults] = useState<Record<string, string[]>>({});
  const [nodeStale, setNodeStale] = useState<Record<string, boolean>>({});
  const [runsActive, setRunsActive] = useState(false);
  // 参谋面板：可折叠 + 拖拽调宽（localStorage 记忆）
  const [asideW, setAsideW] = useState<number>(() => {
    if (typeof window === 'undefined') return 320;
    const v = Number(window.localStorage.getItem('studio.asideW'));
    return Number.isFinite(v) && v >= 240 && v <= 640 ? v : 320;
  });
  const [asideCollapsed, setAsideCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('studio.asideCollapsed') === '1';
  });
  const asideDragRef = useRef<{ startX: number; startW: number } | null>(null);

  const onAsideDragStart = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    asideDragRef.current = { startX: e.clientX, startW: asideW };
    const onMove = (ev: MouseEvent) => {
      const start = asideDragRef.current;
      if (!start) return;
      // 右栏：向左拖变宽、向右拖变窄
      const next = Math.min(640, Math.max(240, start.startW + (start.startX - ev.clientX)));
      setAsideW(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setAsideW((w) => {
        try {
          window.localStorage.setItem('studio.asideW', String(w));
        } catch {
          /* 忽略 */
        }
        return w;
      });
      asideDragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [asideW]);

  const toggleAside = useCallback((collapsed: boolean) => {
    setAsideCollapsed(collapsed);
    try {
      window.localStorage.setItem('studio.asideCollapsed', collapsed ? '1' : '0');
    } catch {
      /* 忽略 */
    }
  }, []);
  const revisionRef = useRef(0);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const clipboardRef = useRef<CanvasSnapshot | null>(null);
  const draftRef = useRef<WorkflowDraftPayload | null>(null);
  const dragSnapshotRef = useRef<CanvasSnapshot | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const connectStartRef = useRef<{
    nodeId: string;
    handleId: string | null;
    handleType: string | null;
  } | null>(null);
  /** 双击空白处的三选一建点菜单：屏幕坐标（相对 wrap）+ 对应画布坐标。 */
  const [createMenu, setCreateMenu] = useState<{
    x: number;
    y: number;
    fx: number;
    fy: number;
  } | null>(null);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  draftRef.current = draft;

  // Re-offer starter templates whenever the canvas becomes empty again (e.g.
  // after undoing a template batch) — "dismissed" only sticks while the
  // canvas stays empty (空白画布 choice).
  useEffect(() => {
    if (nodes.length > 0 && starterDismissed) setStarterDismissed(false);
  }, [nodes.length, starterDismissed]);

  const { uploadAsset, uploading: railUploading } = useAssetUpload(workspaceId, projectId);

  const handleSelectionChange = useCallback(({ nodes: sel }: { nodes: Array<{ id: string }> }) => {
    setSelectedIds((prev) => {
      if (prev.length === sel.length && prev.every((id, i) => id === sel[i].id)) return prev;
      return sel.map((n) => n.id);
    });
  }, []);

  const getWorkflowId = useCallback(() => draftRef.current?.workflowId ?? null, []);

  // 拉取当前工作流的节点生成结果（nodeId → imageAssetVersionIds）。
  // 服务端默认取 currentRevisionId（最近一次 run 的快照修订），按修订天然隔离旧结果。
  const refreshNodeResults = useCallback(async () => {
    const wfId = draftRef.current?.workflowId;
    if (!wfId) return;
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/workflows/${wfId}/node-results`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const json = (await res.json().catch(() => null)) as {
        results?: Record<string, string[]>;
        stale?: Record<string, boolean>;
      } | null;
      if (json && typeof json === 'object' && json.results) {
        setNodeResults(json.results);
        setNodeStale(json.stale ?? {});
      }
    } catch {
      /* 轮询失败保持旧数据 */
    }
  }, [workspaceId]);

  const handleCommandResult = useCallback((result: CommandResult) => {
    if (result.ok) {
      const b = result.batch;
      setDraft((prev) => (prev ? { ...prev, name: b.name, revisionNumber: b.revisionNumber } : prev));
      setCmdError(null);
      setStatus(`已保存 · 修订 ${b.revisionNumber}`);
      // 任何落表的修订都可能改变节点指纹（config/连线变化）——重新拉取
      // node-results 让「需重跑」徽标即时刷新，不必等下一次 run。
      void refreshNodeResults();
      if (b.run) {
        // Run 已提交：拉结果兜底（inline 同步完成时历史面板可能来不及看到
        // 活跃态，轮询不启动；多次延时刷新覆盖结果落表的时点）。
        void refreshNodeResults();
        setTimeout(() => void refreshNodeResults(), 3000);
        setTimeout(() => void refreshNodeResults(), 8000);
      }
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
      const reason = formatCommandErrorZh(f.message);
      setCmdError(reason);
      setStatus(`运行失败：${reason}`);
      if (f.revisionNumber !== undefined) {
        const rev = f.revisionNumber;
        setDraft((prev) => (prev ? { ...prev, revisionNumber: rev } : prev));
      }
      return;
    }
    const reason = formatCommandErrorZh(f.message);
    setCmdError(reason);
    setStatus(`操作失败：${reason}`);
  }, [refreshNodeResults]);

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

  // 节点生成结果（缩略图）：挂载/切换工作流时拉一次；run 活跃期间 3 秒轮询；
  // run 全部结束后 effect 清理时再拉一次收尾。服务端默认取 currentRevisionId
  // （最近一次 run 的快照修订），按修订天然隔离旧结果。
  const resultsWorkflowId = draft?.workflowId ?? null;

  useEffect(() => {
    setNodeResults({});
    setNodeStale({});
    void refreshNodeResults();
  }, [resultsWorkflowId, refreshNodeResults]);

  useEffect(() => {
    if (!runsActive) return;
    const t = setInterval(() => void refreshNodeResults(), 3000);
    return () => {
      clearInterval(t);
      void refreshNodeResults();
    };
  }, [runsActive, refreshNodeResults]);

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
    activeNodeId: selected?.id ?? null,
  });

  // 模型注册表加载后，把节点上已不可用的模型（例如切换到 kie 后被禁用的
  // 演示模型）自动改成「智能匹配」，运行时按输入解析，保证「运行整图」开箱即用。
  const modelsForFix = configOptions.models;
  useEffect(() => {
    if (!modelsForFix || modelsForFix.length === 0) return;
    for (const n of nodesRef.current) {
      const nt = String((n.data as { nodeType?: string }).nodeType ?? '');
      if (nt !== 'generate' && nt !== 'inpaint' && nt !== 'outpaint') continue;
      const cfg = (n.data as { config?: Record<string, unknown> }).config ?? {};
      const mk = typeof cfg.modelKey === 'string' ? cfg.modelKey : '';
      if (mk === 'auto') continue; // 智能匹配：运行时按输入解析
      if (!modelsForFix.some((m) => m.key === mk)) {
        updateNodeConfig(n.id, 'modelKey', 'auto');
      }
    }
  }, [modelsForFix]);

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

  // 「+」拖线生下游：记录连线起点，松手落在空白 pane 时自动建下游/上游卡片并连线。
  const onConnectStart = useCallback<OnConnectStart>((_ev, params) => {
    connectStartRef.current = {
      nodeId: params.nodeId ?? '',
      handleId: params.handleId ?? null,
      handleType: params.handleType ?? null,
    };
  }, []);

  const spawnConnectedNode = useCallback(
    (start: { nodeId: string; handleId: string | null; handleType: string | null }, clientX: number, clientY: number) => {
      const anchor = nodesRef.current.find((n) => n.id === start.nodeId);
      if (!anchor) return;
      const anchorDef = getNodeDefinition(
        String((anchor.data as { nodeType?: string }).nodeType ?? ''),
      );
      if (!anchorDef) return;
      const drop = screenToFlowPosition({ x: clientX, y: clientY });

      let newType: string;
      let sourceNodeId: string;
      let sourceHandle: string;
      let targetNodeId: string;
      let targetHandle: string;
      if (start.handleType === 'target') {
        // 从输入端口反向拖出：按端口类型补一张上游卡片
        const port =
          anchorDef.inputPorts.find((p) => p.id === start.handleId) ??
          (anchorDef.inputPorts.length === 1 ? anchorDef.inputPorts[0] : undefined);
        if (!port) return;
        if (port.type === 'PROMPT') {
          newType = 'prompt';
          sourceHandle = 'prompt';
        } else if (port.type === 'IMAGE' || port.type === 'IMAGE_LIST') {
          newType = 'source_image';
          sourceHandle = 'image';
        } else {
          return;
        }
        targetNodeId = anchor.id;
        targetHandle = port.id;
        sourceNodeId = '';
      } else {
        const outPort =
          anchorDef.outputPorts.find((p) => p.id === start.handleId) ??
          anchorDef.outputPorts[0];
        if (!outPort) return;
        if (outPort.type !== 'PROMPT' && outPort.type !== 'IMAGE' && outPort.type !== 'IMAGE_LIST') {
          return;
        }
        newType = 'generate';
        sourceNodeId = anchor.id;
        sourceHandle = outPort.id;
        targetNodeId = '';
        targetHandle = outPort.type === 'PROMPT' ? 'prompt' : 'references';
      }

      const id = `n-${newType}-${Date.now()}`;
      if (sourceNodeId === '') sourceNodeId = id;
      else targetNodeId = id;
      const config = isWorkflowNodeConfigType(newType)
        ? (defaultNodeConfig(newType) as Record<string, unknown>)
        : { schemaVersion: 1 };
      const pos = { x: drop.x - 120, y: drop.y - 60 };
      const edgeId = `e-${sourceNodeId}-${sourceHandle}-${targetNodeId}-${targetHandle}-${Date.now()}`;
      const graphWithNew: WorkflowGraph = {
        schemaVersion: 1,
        nodes: [
          ...fromFlow(nodesRef.current, edgesRef.current).nodes,
          { id, type: newType, position: pos, config },
        ],
        edges: fromFlow(nodesRef.current, edgesRef.current).edges,
      };
      const candidate: GraphEdge = {
        id: edgeId,
        source: sourceNodeId,
        sourceHandle,
        target: targetNodeId,
        targetHandle,
      };
      const check = validateEdge(graphWithNew, candidate);
      if (!check.ok) {
        setEdgeError(check.issues.map((i) => i.message).join('; '));
        return;
      }
      setEdgeError(null);
      const snapshot = cloneGraph(nodesRef.current, edgesRef.current);
      const next: Node = {
        id,
        type: 'studio',
        position: pos,
        selected: true,
        data: { label: nodeLabelZh(newType), nodeType: newType, config, workspaceId },
      };
      const nextNodes = [...nodesRef.current.map((n) => ({ ...n, selected: false })), next];
      const nextEdges = [...edgesRef.current, { ...candidate } as Edge];
      setNodes(nextNodes);
      setEdges(nextEdges);
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setSelectedIds((prev) => (prev.length === 1 && prev[0] === id ? prev : [id]));
      void commands
        .applyNow(
          [
            { type: 'addNode', nodeType: newType, nodeId: id, position: pos, config },
            {
              type: 'connect',
              edgeId,
              source: sourceNodeId,
              sourceHandle,
              target: targetNodeId,
              targetHandle,
            },
          ],
          makeRollback(snapshot),
        )
        .then(handleCommandResult);
    },
    [screenToFlowPosition, setNodes, setEdges, commands, handleCommandResult, makeRollback, workspaceId],
  );

  const onConnectEnd = useCallback<OnConnectEnd>(
    (ev, connectionState) => {
      const start = connectStartRef.current;
      connectStartRef.current = null;
      if (!start || connectionState.toNode) return;
      // 只响应「拖线松手落在空白画布」；单击手柄不算（target 是手柄而非 pane）
      const t = ev.target as HTMLElement | null;
      if (!t || !t.classList.contains('react-flow__pane')) return;
      if (!(ev instanceof MouseEvent)) return;
      spawnConnectedNode(start, ev.clientX, ev.clientY);
    },
    [spawnConnectedNode],
  );

  // 双击空白画布：在点击位置弹出三选一建点菜单
  const onCanvasDoubleClick = useCallback(
    (ev: ReactMouseEvent<HTMLDivElement>) => {
      const t = ev.target as HTMLElement;
      if (!t.classList.contains('react-flow__pane')) return;
      const rect = wrapRef.current?.getBoundingClientRect();
      const flow = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      setCreateMenu({
        x: ev.clientX - (rect?.left ?? 0),
        y: ev.clientY - (rect?.top ?? 0),
        fx: flow.x,
        fy: flow.y,
      });
    },
    [screenToFlowPosition],
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
      // Auto-select: the new node becomes the only selection so the properties
      // panel is immediately editable.
      const previouslySelected = nodesRef.current.filter((n) => n.selected);
      const next: Node = {
        id,
        type: 'studio',
        position: pos,
        selected: true,
        data: { label: nodeLabelZh(type), nodeType: type, config, workspaceId },
      };
      const snapshot = cloneGraph(nodesRef.current, edgesRef.current);
      const nextNodes = [...nodesRef.current.map((n) => ({ ...n, selected: false })), next];
      // Auto-connect: when exactly one node was selected, wire its first
      // compatible output into the new node's first unconnected required input
      // (port metadata + domain validateEdge; silently skip when nothing fits).
      let autoEdge: Edge | null = null;
      let connectCmd: WorkflowCommand | null = null;
      const sourceNode = previouslySelected.length === 1 ? previouslySelected[0] : null;
      const sourceDef = sourceNode
        ? getNodeDefinition(String((sourceNode.data as { nodeType?: string }).nodeType ?? ''))
        : undefined;
      const targetDef = getNodeDefinition(type);
      if (sourceNode && sourceDef && targetDef) {
        const graph = fromFlow(nextNodes, edgesRef.current);
        for (const inPort of targetDef.inputPorts) {
          if (!inPort.required) continue;
          const occupied = edgesRef.current.some(
            (e) => e.target === id && (e.targetHandle ? e.targetHandle === inPort.id : true),
          );
          if (occupied) continue;
          const outPort = sourceDef.outputPorts.find((o) =>
            arePortTypesCompatible(o.type, inPort.type),
          );
          if (!outPort) continue;
          const edgeId = `e-${sourceNode.id}-${outPort.id}-${id}-${inPort.id}-${Date.now()}`;
          const candidate: GraphEdge = {
            id: edgeId,
            source: sourceNode.id,
            target: id,
            sourceHandle: outPort.id,
            targetHandle: inPort.id,
          };
          if (!validateEdge(graph, candidate).ok) continue;
          autoEdge = {
            id: edgeId,
            source: sourceNode.id,
            target: id,
            sourceHandle: outPort.id,
            targetHandle: inPort.id,
          };
          connectCmd = {
            type: 'connect',
            edgeId,
            source: sourceNode.id,
            sourceHandle: outPort.id,
            target: id,
            targetHandle: inPort.id,
          };
          break;
        }
      }
      setNodes(nextNodes);
      nodesRef.current = nextNodes;
      setSelectedIds((prev) => (prev.length === 1 && prev[0] === id ? prev : [id]));
      if (autoEdge) {
        const nextEdges = [...edgesRef.current, autoEdge];
        setEdges(nextEdges);
        edgesRef.current = nextEdges;
      }
      const batch: WorkflowCommand[] = [
        { type: 'addNode', nodeType: type, nodeId: id, position: pos, config },
        ...(connectCmd ? [connectCmd] : []),
      ];
      void commands
        .applyNow(batch, makeRollback(snapshot))
        .then(handleCommandResult);
    },
    [setNodes, setEdges, commands, handleCommandResult, makeRollback, workspaceId],
  );

  // 左栏「＋添加」：点击加到视图中心
  const addNodeAtCenter = useCallback(
    (type: string) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      const center = rect
        ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        : undefined;
      addNodeAt(type, center ? { x: center.x - 120, y: center.y - 60 } : undefined);
    },
    [addNodeAt, screenToFlowPosition],
  );

  function updateNodeConfig(id: string, key: string, raw: string) {
    const snapshot = cloneGraph(nodesRef.current, edgesRef.current);
    let nextConfig: Record<string, unknown> | null = null;
    const nextNodes = nodesRef.current.map((n) => {
      if (n.id !== id) return n;
      const nodeType = String((n.data as { nodeType?: string }).nodeType ?? '');
      const prev = {
        ...((n.data as { config?: Record<string, unknown> }).config ?? { schemaVersion: 1 }),
      };
      const validated = validateNodeConfig(nodeType, applyConfigEdit(prev, key, raw));
      if (!validated.ok) {
        // Still invalid after coercion: keep the node's last valid config and
        // do not schedule a dirty config to the server (avoids 400 popups).
        return n;
      }
      nextConfig = validated.config as Record<string, unknown>;
      return { ...n, data: { ...n.data, config: nextConfig } };
    });
    if (!nextConfig) {
      setStatus(`「${CONFIG_FIELD_ZH[key] ?? key}」的取值无效，已保留原值`);
      return;
    }
    const config = nextConfig;
    setNodes(nextNodes);
    nodesRef.current = nextNodes;
    commands.schedule(
      [{ type: 'configure', nodeId: id, config }],
      makeRollback(snapshot),
    );
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
    const node = nodesRef.current.find((n) => n.id === nodeId);
    const nodeType = String((node?.data as { nodeType?: string } | undefined)?.nodeType ?? '');
    setUploadNotice(`正在上传 ${file.name}…`);
    try {
      const asset = await uploadAsset(file, (m) => setUploadNotice(`${file.name} — ${m}`));
      if (asset.status === 'REJECTED') {
        setUploadNotice(`${file.name} 未通过检查 — 请更换图片`);
        return;
      }
      if (!asset.versionId) {
        setUploadNotice(`已上传 ${file.name}，还在处理中 — 请稍后重新点上传按钮绑定`);
        return;
      }
      if (nodeType === 'product_truth') {
        await bindTruthFromUpload(nodeId, asset.versionId, file.name);
        return;
      }
      updateNodeConfig(nodeId, 'assetVersionId', asset.versionId);
      setUploadNotice(
        asset.status === 'READY' ? `已上传 ${file.name}` : `已上传 ${file.name}，处理中…`,
      );
    } catch {
      setUploadNotice(`上传失败：${file.name}`);
    }
  }

  // 产品图节点一键绑定：上传 → 自动识别产品信息（演示识别）→ 确认 → 批准 → 绑定到节点。
  async function bindTruthFromUpload(nodeId: string, versionId: string, fileName: string) {
    const base = `/api/workspaces/${workspaceId}/projects/${projectId}/truth-pack`;
    const headers = { 'content-type': 'application/json' };
    setUploadNotice(`${fileName} 已上传，正在识别产品信息…`);
    const extract = await fetch(`${base}/extract`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ assetVersionIds: [versionId] }),
    });
    const eJson = await extract.json().catch(() => null);
    if (!extract.ok) throw new Error(eJson?.error?.message ?? '识别失败');
    const revision = eJson?.pack?.revision as
      | { id?: string; facts?: Array<{ id: string; status: string }> }
      | undefined;
    if (!revision?.id) throw new Error('识别失败');
    const updates = (revision.facts ?? [])
      .filter((f) => f.status === 'EXTRACTED')
      .map((f) => ({ factId: f.id, status: 'CONFIRMED' as const }));
    if (updates.length > 0) {
      const confirm = await fetch(`${base}/confirm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ updates }),
      });
      if (!confirm.ok) throw new Error('确认产品信息失败');
    }
    const approve = await fetch(`${base}/approve`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ revisionId: revision.id }),
    });
    const aJson = await approve.json().catch(() => null);
    if (!approve.ok) throw new Error(aJson?.error?.message ?? '生成产品图资料失败');
    updateNodeConfig(nodeId, 'truthRevisionId', revision.id);
    setUploadNotice('产品图资料已生成并绑定 ✓（可在项目页查看和修改内容）');
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

  // 生图卡的连线提示词摘要：prompt 端口 ← 文本卡
  const connectedPromptByNode = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of edges) {
      if (e.targetHandle !== 'prompt') continue;
      const src = nodes.find((n) => n.id === e.source);
      if (!src) continue;
      if (String((src.data as { nodeType?: string }).nodeType ?? '') !== 'prompt') continue;
      const text = (src.data as { config?: Record<string, unknown> }).config?.text;
      if (typeof text === 'string' && text.trim()) map.set(e.target, text.trim());
    }
    return map;
  }, [nodes, edges]);

  // references 端口已连参考图的节点集合（驱动模型 t2i/i2i 置灰）
  const nodesWithReferences = useMemo(() => {
    const set = new Set<string>();
    for (const e of edges) {
      if (e.targetHandle === 'references' || e.targetHandle === 'image') set.add(e.target);
    }
    return set;
  }, [edges]);

  // 图片卡底部小字：assetVersionId → 素材文件名
  const assetNameByVersion = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of configOptions.assets ?? []) {
      if (a.currentVersionId) map.set(a.currentVersionId, a.originalFilename ?? a.id);
    }
    return map;
  }, [configOptions.assets]);

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

  // 图片卡快捷操作：右侧派生一张生图卡（预填提示词/数量/标题），自动连参考图，一个批次。
  const spawnGenerateFrom = useCallback(
    (sourceId: string, preset: ImageQuickAction) => {
      const source = nodesRef.current.find((n) => n.id === sourceId);
      if (!source) return;
      const id = `n-generate-${Date.now()}`;
      const pos = { x: source.position.x + 300, y: source.position.y };
      const config: Record<string, unknown> = {
        ...(defaultNodeConfig('generate') as Record<string, unknown>),
        prompt: preset.prompt,
        count: preset.count,
        title: preset.title,
      };
      const edgeId = `e-${sourceId}-image-${id}-references-${Date.now()}`;
      const candidate: GraphEdge = {
        id: edgeId,
        source: sourceId,
        sourceHandle: 'image',
        target: id,
        targetHandle: 'references',
      };
      const graphWithNew: WorkflowGraph = {
        schemaVersion: 1,
        nodes: [
          ...fromFlow(nodesRef.current, edgesRef.current).nodes,
          { id, type: 'generate', position: pos, config },
        ],
        edges: fromFlow(nodesRef.current, edgesRef.current).edges,
      };
      const check = validateEdge(graphWithNew, candidate);
      if (!check.ok) {
        setEdgeError(check.issues.map((i) => i.message).join('; '));
        return;
      }
      setEdgeError(null);
      const snapshot = cloneGraph(nodesRef.current, edgesRef.current);
      const next: Node = {
        id,
        type: 'studio',
        position: pos,
        selected: true,
        data: { label: nodeLabelZh('generate'), nodeType: 'generate', config, workspaceId },
      };
      const nextNodes = [...nodesRef.current.map((n) => ({ ...n, selected: false })), next];
      const nextEdges = [...edgesRef.current, { ...candidate } as Edge];
      setNodes(nextNodes);
      setEdges(nextEdges);
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setSelectedIds((prev) => (prev.length === 1 && prev[0] === id ? prev : [id]));
      void commands
        .applyNow(
          [
            { type: 'addNode', nodeType: 'generate', nodeId: id, position: pos, config },
            {
              type: 'connect',
              edgeId,
              source: sourceId,
              sourceHandle: 'image',
              target: id,
              targetHandle: 'references',
            },
          ],
          makeRollback(snapshot),
        )
        .then(handleCommandResult);
    },
    [setNodes, setEdges, commands, handleCommandResult, makeRollback, workspaceId],
  );

  const nodeActions = useMemo<NodeActionContextValue>(
    () => ({
      uploadIntoNode,
      missingPorts: (nodeId) => missingPortsByNode.get(nodeId) ?? [],
      updateConfig: (nodeId, key, raw) => updateNodeConfig(nodeId, key, raw),
      models: configOptions.models,
      resultImages: (nodeId) => nodeResults[nodeId] ?? [],
      isStale: (nodeId) => nodeStale[nodeId] === true,
      spawnGenerateFrom,
      hasReferences: (nodeId) => nodesWithReferences.has(nodeId),
      runNode: (nodeId) => void runNode(nodeId),
      runBusy,
      connectedPromptText: (nodeId) => connectedPromptByNode.get(nodeId) ?? null,
      assetLabel: (versionId) => assetNameByVersion.get(versionId) ?? null,
    }),
    [
      uploadIntoNode,
      missingPortsByNode,
      configOptions.models,
      nodeResults,
      nodeStale,
      spawnGenerateFrom,
      nodesWithReferences,
      runNode,
      runBusy,
      connectedPromptByNode,
      assetNameByVersion,
    ],
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
      const reason = formatCommandErrorZh(result.message);
      setCmdError(reason);
      setStatus(`操作失败：${reason}`);
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
      if (ev.key === 'Escape') {
        setCreateMenu(null);
        return;
      }
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
        r.failure.kind === 'conflict'
          ? '冲突 — 请加载远端'
          : `运行失败：${formatCommandErrorZh(r.failure.message)}`,
      authRequired: false,
    };
  }, [commands, handleCommandResult]);

  // Shared whole-canvas run trigger (toolbar button; history flyout shows the outcome).
  const triggerRunAll = useCallback(async () => {
    setRunAllBusy(true);
    setRunAllMsg(null);
    setRailPanel('history');
    try {
      setRunAllMsg(await runAll());
    } finally {
      setRunAllBusy(false);
    }
  }, [runAll]);

  // 底部浮动提示词条：选中唯一生图卡时绑定它
  const boundGenerate = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    const n = nodes.find((x) => x.id === selectedIds[0]);
    if (!n) return null;
    if (String((n.data as { nodeType?: string }).nodeType ?? '') !== 'generate') return null;
    return {
      id: n.id,
      config:
        (n.data as { config?: Record<string, unknown> }).config ?? ({ schemaVersion: 1 } as Record<string, unknown>),
    };
  }, [selectedIds, nodes]);

  // 提示词条提交：configure + 单节点 run（同一批次，一次撤销单位）；
  // 未绑定时先在视图中心建一张生图卡。
  const promptBarSubmit = useCallback(
    (values: PromptBarValues, boundId: string | null) => {
      const count = Math.min(8, Math.max(1, Number(values.count) || 2));
      const runCmd: WorkflowCommand = {
        type: 'run',
        scope: { type: 'NODES', nodeIds: [boundId ?? ''] },
        idempotencyKey: crypto.randomUUID(),
        budgetLimit: { currency: 'USD', amount: 5 },
        confirmBudget: true,
      };
      setRunBusy(true);
      setStatus('正在启动生成…');
      if (boundId) {
        const node = nodesRef.current.find((n) => n.id === boundId);
        if (!node) {
          setRunBusy(false);
          return;
        }
        const config: Record<string, unknown> = {
          ...(defaultNodeConfig('generate') as Record<string, unknown>),
          ...((node.data as { config?: Record<string, unknown> }).config ?? {}),
          prompt: values.prompt,
          modelKey: values.modelKey,
          ratio: values.ratio,
          resolution: values.resolution,
          count,
        };
        const snapshot = cloneGraph(nodesRef.current, edgesRef.current);
        const nextNodes = nodesRef.current.map((n) =>
          n.id === boundId ? { ...n, data: { ...n.data, config } } : n,
        );
        setNodes(nextNodes);
        nodesRef.current = nextNodes;
        void commands
          .applyNow(
            [{ type: 'configure', nodeId: boundId, config }, { ...runCmd, scope: { type: 'NODES', nodeIds: [boundId] } }],
            makeRollback(snapshot),
          )
          .then((r) => {
            handleCommandResult(r);
            if (r.ok && r.batch.run) {
              setStatus(
                `运行${zh(RUN_STATUS_ZH, r.batch.run.status)}（${r.batch.run.id.slice(0, 8)}…）· 修订 ${r.batch.revisionNumber}`,
              );
            }
          })
          .finally(() => setRunBusy(false));
        return;
      }
      const rect = wrapRef.current?.getBoundingClientRect();
      const center = rect
        ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        : { x: 200, y: 200 };
      const pos = { x: center.x - 140, y: center.y - 110 };
      const id = `n-generate-${Date.now()}`;
      const config: Record<string, unknown> = {
        ...(defaultNodeConfig('generate') as Record<string, unknown>),
        prompt: values.prompt,
        modelKey: values.modelKey,
        ratio: values.ratio,
        resolution: values.resolution,
        count,
      };
      const snapshot = cloneGraph(nodesRef.current, edgesRef.current);
      const next: Node = {
        id,
        type: 'studio',
        position: pos,
        selected: true,
        data: { label: nodeLabelZh('generate'), nodeType: 'generate', config, workspaceId },
      };
      const nextNodes = [...nodesRef.current.map((n) => ({ ...n, selected: false })), next];
      setNodes(nextNodes);
      nodesRef.current = nextNodes;
      setSelectedIds((prev) => (prev.length === 1 && prev[0] === id ? prev : [id]));
      void commands
        .applyNow(
          [
            { type: 'addNode', nodeType: 'generate', nodeId: id, position: pos, config },
            { ...runCmd, scope: { type: 'NODES', nodeIds: [id] } },
          ],
          makeRollback(snapshot),
        )
        .then((r) => {
          handleCommandResult(r);
          if (r.ok && r.batch.run) {
            setStatus(
              `运行${zh(RUN_STATUS_ZH, r.batch.run.status)}（${r.batch.run.id.slice(0, 8)}…）· 修订 ${r.batch.revisionNumber}`,
            );
          }
        })
        .finally(() => setRunBusy(false));
    },
    [commands, handleCommandResult, makeRollback, screenToFlowPosition, setNodes, workspaceId],
  );

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
            // Select the key node: the batch's first 参考图 (source_image),
            // falling back to the first added node.
            const pick =
              r.batch.graph.nodes.find((n) => n.type === 'source_image') ??
              r.batch.graph.nodes[0];
            const flowNodes = toFlowNodes(r.batch.graph, workspaceId).map((n) => ({
              ...n,
              selected: n.id === pick?.id,
            }));
            applyLocalSnapshot({
              nodes: flowNodes,
              edges: toFlowEdges(r.batch.graph),
            });
            if (pick) {
              const pickId = pick.id;
              setSelectedIds((prev) =>
                prev.length === 1 && prev[0] === pickId ? prev : [pickId],
              );
            }
            setStatus(`已应用模板 · 修订 ${r.batch.revisionNumber}`);
            setTimeout(() => void fitView({ padding: 0.2, duration: 200 }), 50);
          } else {
            setStarterDismissed(false);
          }
        });
    },
    [commands, handleCommandResult, makeRollback, applyLocalSnapshot, workspaceId, fitView],
  );

  // 左栏「套装」：一句话 → 1 文本卡 + 3 生图卡（白底/场景/细节），一个批次，采纳权威图。
  const addSuite = useCallback(
    (description: string) => {
      const desc = description.trim();
      if (!desc) return;
      const rect = wrapRef.current?.getBoundingClientRect();
      const center = rect
        ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
        : { x: 400, y: 300 };
      const { commands: cmds, selectId } = buildSuiteCommands(desc, {
        x: center.x - 290,
        y: center.y - 190,
      });
      const snapshot = cloneGraph(nodesRef.current, edgesRef.current);
      setStatus('正在生成套装…');
      setRailPanel(null);
      void commands
        .applyNow(cmds, makeRollback(snapshot))
        .then((r) => {
          handleCommandResult(r);
          if (r.ok) {
            const flowNodes = toFlowNodes(r.batch.graph, workspaceId).map((n) => ({
              ...n,
              selected: n.id === selectId,
            }));
            applyLocalSnapshot({ nodes: flowNodes, edges: toFlowEdges(r.batch.graph) });
            setSelectedIds([selectId]);
            setStatus(`已生成套装（1 文本 + 3 生图）· 修订 ${r.batch.revisionNumber}`);
            setTimeout(() => void fitView({ padding: 0.2, duration: 200 }), 50);
          }
        });
    },
    [commands, handleCommandResult, makeRollback, applyLocalSnapshot, screenToFlowPosition, workspaceId, fitView],
  );

  const onCanvasDragOver = useCallback((ev: ReactDragEvent<HTMLDivElement>) => {
    const types = ev.dataTransfer.types;
    if (
      types.includes('application/studio-node') ||
      types.includes('application/studio-asset') ||
      types.includes('Files')
    ) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  // 素材库 / 历史面板拖入：在落点建图片卡并绑定该素材版本
  const dropAssetCard = useCallback(
    (assetVersionId: string, position: { x: number; y: number }) => {
      const id = `n-source_image-${Date.now()}`;
      const config = {
        ...(defaultNodeConfig('source_image') as Record<string, unknown>),
        assetVersionId,
      };
      const snapshot = cloneGraph(nodesRef.current, edgesRef.current);
      const next: Node = {
        id,
        type: 'studio',
        position,
        selected: true,
        data: {
          label: nodeLabelZh('source_image'),
          nodeType: 'source_image',
          config,
          workspaceId,
        },
      };
      const nextNodes = [...nodesRef.current.map((n) => ({ ...n, selected: false })), next];
      setNodes(nextNodes);
      nodesRef.current = nextNodes;
      setSelectedIds((prev) => (prev.length === 1 && prev[0] === id ? prev : [id]));
      void commands
        .applyNow(
          [{ type: 'addNode', nodeType: 'source_image', nodeId: id, position, config }],
          makeRollback(snapshot),
        )
        .then(handleCommandResult);
    },
    [commands, handleCommandResult, makeRollback, setNodes, workspaceId],
  );

  const onCanvasDrop = useCallback(
    (ev: ReactDragEvent<HTMLDivElement>) => {
      const position = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const nodeType = ev.dataTransfer.getData('application/studio-node');
      if (nodeType) {
        ev.preventDefault();
        if (getNodeDefinition(nodeType)?.palette) addNodeAt(nodeType, position);
        return;
      }
      const assetVersionId = ev.dataTransfer.getData('application/studio-asset');
      if (assetVersionId) {
        ev.preventDefault();
        dropAssetCard(assetVersionId, position);
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
      dropAssetCard,
      commands,
      handleCommandResult,
      makeRollback,
      setNodes,
      workspaceId,
    ],
  );

  const errorBar = edgeError
    ? `非法连线已阻止：${edgeError}`
    : cmdError
      ? `操作失败：${cmdError}`
      : null;

  // 素材库面板「上传」：走共享上传流程，完成后刷新素材列表
  function onRailUploadFile(file: File) {
    void (async () => {
      setUploadNotice(`正在上传 ${file.name}…`);
      try {
        const asset = await uploadAsset(file, (m) => setUploadNotice(`${file.name} — ${m}`));
        configOptions.reload();
        setUploadNotice(
          asset.status === 'REJECTED' ? `${file.name} 未通过检查 — 请更换图片` : `已上传 ${file.name}`,
        );
      } catch {
        setUploadNotice(`上传失败：${file.name}`);
      }
    })();
  }

  // 素材库面板「删除」：软删除（ARCHIVED）后刷新列表；画布上已引用它的卡片不受影响
  function onRailDeleteAsset(assetId: string, name: string) {
    void (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/assets/${assetId}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) throw new Error(String(res.status));
        configOptions.reload();
        setUploadNotice(`已删除素材 ${name}`);
      } catch {
        setUploadNotice(`删除失败：${name}`);
      }
    })();
  }

  // 创意参谋「用作提示词」：写入当前选中的生图卡
  function handleUsePrompt(text: string) {
    const target = nodesRef.current.find(
      (n) => n.selected && String((n.data as { nodeType?: string }).nodeType ?? '') === 'generate',
    );
    if (!target) {
      setStatus('先在画布上选中一张生图卡，再点「用作提示词」');
      return;
    }
    updateNodeConfig(target.id, 'prompt', text);
    setStatus('已写入提示词到选中的生图卡');
  }

  return (
    <div
      role="application"
      aria-label="工作流画布"
      className={
        belowStepper
          ? 'studio-dark studio-grid studio-grid-v2 studio-grid-below-stepper'
          : 'studio-dark studio-grid studio-grid-v2'
      }
      style={{
        gridTemplateColumns: asideCollapsed ? '52px 1fr 0px' : `52px 1fr ${asideW}px`,
      }}
    >
      <LeftRail
        panel={railPanel}
        onToggle={(kind) => setRailPanel((prev) => (prev === kind ? null : kind))}
        onAddNode={addNodeAtCenter}
        onAddSuite={addSuite}
        workspaceId={workspaceId}
        assets={configOptions.assets}
        uploading={railUploading}
        onUploadFile={onRailUploadFile}
        onDeleteAsset={onRailDeleteAsset}
        historyPanel={
          <HistoryPanel
            workspaceId={workspaceId}
            projectId={projectId}
            workflowId={draft?.workflowId ?? null}
            msg={runAllMsg}
            onActiveChange={setRunsActive}
          />
        }
      />

      <div
        ref={wrapRef}
        className="studio-canvas-wrap"
        onDragOver={onCanvasDragOver}
        onDrop={onCanvasDrop}
        onDoubleClick={onCanvasDoubleClick}
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
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onPaneClick={() => setCreateMenu(null)}
          isValidConnection={isValidConnection}
          nodeTypes={studioNodeTypes}
          onSelectionChange={handleSelectionChange}
          fitView
          colorMode="dark"
          zoomOnDoubleClick={false}
          deleteKeyCode={['Backspace', 'Delete']}
          multiSelectionKeyCode="Shift"
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} color="var(--canvas-dot)" />
          <MiniMap pannable zoomable style={{ background: 'var(--surface)' }} />
          <Controls />
          <Panel position="top-left">
            <div className="studio-toolbar">
              <span className="studio-toolbar-status" role="status" aria-live="polite">
                {status}
              </span>
              <button type="button" className="btn" onClick={() => undo()} title="Ctrl/Cmd+Z">
                撤销
              </button>
              <button type="button" className="btn" onClick={() => redo()} title="Ctrl/Cmd+Y">
                重做
              </button>
              <button type="button" className="btn" onClick={() => void snapshot()}>
                快照
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
              <span className="studio-toolbar-more">
                <button
                  type="button"
                  className="btn"
                  aria-label="更多操作"
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((v) => !v)}
                >
                  ⋯
                </button>
                {moreOpen ? (
                  <span className="studio-toolbar-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreOpen(false);
                        void reload();
                      }}
                    >
                      重新加载
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreOpen(false);
                        copySelected();
                      }}
                    >
                      复制所选
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreOpen(false);
                        pasteClipboard();
                      }}
                    >
                      粘贴
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMoreOpen(false);
                        void fitView({ padding: 0.2, duration: 200 });
                        setStatus('适应视图');
                      }}
                    >
                      适应视图
                    </button>
                  </span>
                ) : null}
              </span>
            </div>
          </Panel>
          <Panel position="bottom-center">
            <PromptBar
              bound={boundGenerate}
              boundHasReferences={boundGenerate ? nodesWithReferences.has(boundGenerate.id) : false}
              models={configOptions.models}
              busy={runBusy || runAllBusy}
              onSubmit={promptBarSubmit}
            />
          </Panel>
        </ReactFlow>
        </NodeActionContext.Provider>
        {createMenu && (
          <div
            className="studio-create-menu"
            role="menu"
            aria-label="新建卡片"
            style={{ left: createMenu.x, top: createMenu.y }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const m = createMenu;
                setCreateMenu(null);
                addNodeAt('prompt', { x: m.fx - 120, y: m.fy - 40 });
              }}
            >
              文本
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const m = createMenu;
                setCreateMenu(null);
                addNodeAt('source_image', { x: m.fx - 120, y: m.fy - 40 });
              }}
            >
              图片
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const m = createMenu;
                setCreateMenu(null);
                addNodeAt('generate', { x: m.fx - 120, y: m.fy - 40 });
              }}
            >
              生图
            </button>
          </div>
        )}
        {draft !== null && nodes.length === 0 && !starterDismissed && (
          <div className="starter-overlay">
            <div className="starter-panel" role="dialog" aria-label="画布起始模板">
              <div style={{ fontWeight: 700 }}>三步出图：选模板 → 在卡片上上传图片、写提示词 → ▶ 运行整图</div>
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
                也可以直接把图片文件拖进画布，或点左侧「＋」、双击画布空白处新建卡片。
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

      {!asideCollapsed ? (
        <aside
          className="studio-aside studio-aside-right studio-aside-flex"
          aria-label="创意参谋"
        >
          <div
            className="studio-aside-resizer"
            onMouseDown={onAsideDragStart}
            title="拖拽调整面板宽度"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整参谋面板宽度"
          />
          <div className="chat-panel">
            <ChatPanel
              workspaceId={workspaceId}
              projectId={projectId}
              workflowId={draft?.workflowId ?? null}
              getRevision={getRevision}
              onGraphChanged={handleGraphChanged}
              onUsePrompt={handleUsePrompt}
              onCollapse={() => toggleAside(true)}
            />
          </div>
        </aside>
      ) : (
        <button
          type="button"
          className="chat-reopen-btn"
          onClick={() => toggleAside(false)}
          title="展开创意参谋"
          aria-label="展开创意参谋"
        >
          ✦
        </button>
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
