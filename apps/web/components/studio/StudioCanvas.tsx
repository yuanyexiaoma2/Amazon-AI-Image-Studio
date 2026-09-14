'use client';

import { MaskEditor } from './MaskEditor';
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
  type Node,
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
} from '@studio/contracts';

type DraftResponse = {
  workflowId: string;
  projectId: string;
  name: string;
  revisionNumber: number;
  currentRevisionId: string | null;
  graph: WorkflowGraph;
  updatedAt: string;
  updatedByUserId: string | null;
};

type HistoryEntry = { nodes: Node[]; edges: Edge[] };

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

const OPTION_LABEL_ZH: Record<string, string> = {
  auto: '自动',
  precise: '精细',
  soft: '柔和',
  center: '居中',
  top: '上',
  bottom: '下',
  left: '左',
  right: '右',
};

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

function cloneGraph(nodes: Node[], edges: Edge[]): HistoryEntry {
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
    <div
      style={{
        minWidth: 140,
        padding: '8px 10px',
        borderRadius: 8,
        border: props.selected ? '2px solid #7aa2ff' : '1px solid #3a4a6a',
        background: '#121a2e',
        color: '#e8eefc',
        fontSize: 12,
      }}
    >
      {def?.inputPorts.map((p, i) => (
        <Handle
          key={`in-${p.id}`}
          id={p.id}
          type="target"
          position={Position.Left}
          style={{ top: 16 + i * 14, background: '#7aa2ff', width: 8, height: 8 }}
          title={`${p.id}: ${p.type}`}
        />
      ))}
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div style={{ opacity: 0.6, fontSize: 10 }}>{nodeType}</div>
      {def?.outputPorts.map((p, i) => (
        <Handle
          key={`out-${p.id}`}
          id={p.id}
          type="source"
          position={Position.Right}
          style={{ top: 16 + i * 14, background: '#6bcf8e', width: 8, height: 8 }}
          title={`${p.id}: ${p.type}`}
        />
      ))}
    </div>
  );
}

const nodeTypes: NodeTypes = { studio: StudioNodeView };

const CONFIG_FIELD_META: Record<
  string,
  Array<{ key: string; label: string; kind: 'text' | 'number' | 'select'; options?: string[] }>
> = {
  source_image: [{ key: 'assetVersionId', label: '素材版本 ID', kind: 'text' }],
  product_truth: [{ key: 'truthRevisionId', label: 'Truth 修订 ID', kind: 'text' }],
  prompt: [
    { key: 'text', label: '提示词', kind: 'text' },
    { key: 'negative', label: '反向提示词', kind: 'text' },
    { key: 'locale', label: '语言地区', kind: 'text' },
    { key: 'shotBriefId', label: '镜头简报 ID', kind: 'text' },
    { key: 'slot', label: '槽位', kind: 'text' },
  ],
  remove_background: [
    { key: 'subjectHint', label: '主体提示', kind: 'text' },
    { key: 'edgeMode', label: '边缘模式', kind: 'select', options: ['auto', 'precise', 'soft'] },
  ],
  generate: [
    { key: 'modelKey', label: '模型键', kind: 'text' },
    { key: 'ratio', label: '比例', kind: 'text' },
    { key: 'resolution', label: '分辨率', kind: 'select', options: ['1K', '2K', '4K'] },
    { key: 'count', label: '数量', kind: 'number' },
    { key: 'seed', label: '种子', kind: 'number' },
  ],
  replace_background: [
    { key: 'fidelity', label: '保真度', kind: 'number' },
    { key: 'lightBlend', label: '光线融合', kind: 'number' },
    { key: 'maskId', label: '蒙版 ID', kind: 'text' },
  ],
  inpaint: [
    { key: 'strength', label: '强度', kind: 'number' },
    { key: 'modelKey', label: '模型键', kind: 'text' },
    { key: 'maskId', label: '蒙版 ID', kind: 'text' },
  ],
  outpaint: [
    { key: 'targetRatio', label: '目标比例', kind: 'text' },
    {
      key: 'placement',
      label: '放置',
      kind: 'select',
      options: ['center', 'top', 'bottom', 'left', 'right'],
    },
    { key: 'modelKey', label: '模型键', kind: 'text' },
  ],
  upscale: [
    { key: 'engineKey', label: '引擎键', kind: 'text' },
    { key: 'targetResolution', label: '目标分辨率', kind: 'select', options: ['2K', '4K'] },
  ],
  qa_gate: [{ key: 'policyKey', label: '策略键', kind: 'text' }],
  approval_selector: [
    {
      key: 'requiredRole',
      label: '所需角色',
      kind: 'select',
      options: ['OWNER', 'ADMIN', 'MEMBER', 'REVIEWER'],
    },
  ],
  export: [
    { key: 'namingPreset', label: '命名预设', kind: 'text' },
    { key: 'format', label: '格式', kind: 'select', options: ['png', 'jpeg', 'webp'] },
  ],
};

function StudioCanvasInner(props: { workspaceId: string; projectId: string }) {
  const { workspaceId, projectId } = props;
  const { fitView } = useReactFlow();
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [status, setStatus] = useState<string>('加载中…');

  const [maskEditorOpen, setMaskEditorOpen] = useState(false);
  const [maskImageUrl, setMaskImageUrl] = useState<string | null>(null);
  const [maskSourceDims, setMaskSourceDims] = useState<{ w: number; h: number; versionId: string } | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [edgeError, setEdgeError] = useState<string | null>(null);
  const [deleteHint, setDeleteHint] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  const revisionRef = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const historyRef = useRef<HistoryEntry[]>([]);
  const futureRef = useRef<HistoryEntry[]>([]);
  const applyingHistory = useRef(false);
  const clipboardRef = useRef<HistoryEntry | null>(null);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const palette = useMemo(() => listPaletteNodeTypes(), []);

  const pushHistory = useCallback(() => {
    if (applyingHistory.current) return;
    historyRef.current.push(cloneGraph(nodesRef.current, edgesRef.current));
    if (historyRef.current.length > 100) historyRef.current.shift();
    futureRef.current = [];
  }, []);

  const applyDraft = useCallback(
    (d: DraftResponse) => {
      setDraft(d);
      revisionRef.current = d.revisionNumber;
      const n = toFlowNodes(d.graph);
      const e = toFlowEdges(d.graph);
      setNodes(n);
      setEdges(e);
      nodesRef.current = n;
      edgesRef.current = e;
      dirtyRef.current = false;
      historyRef.current = [cloneGraph(n, e)];
      futureRef.current = [];
    },
    [setNodes, setEdges],
  );

  const loadOrCreate = useCallback(async () => {
    setStatus('正在加载工作流…');
    setConflict(null);
    const listRes = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/workflows`);
    const listJson = await listRes.json();
    if (!listRes.ok) {
      setStatus(`列表失败：${listJson?.error?.message ?? listRes.status}`);
      return;
    }
    let workflowId: string | undefined = listJson.items?.[0]?.id;
    if (!workflowId) {
      const createRes = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/workflows`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Studio 工作流' }),
      });
      const created = await createRes.json();
      if (!createRes.ok) {
        setStatus(`创建失败：${created?.error?.message ?? createRes.status}`);
        return;
      }
      applyDraft(created);
      setStatus(`已创建空工作流 · 修订 ${created.revisionNumber}`);
      return;
    }
    const getRes = await fetch(`/api/workspaces/${workspaceId}/workflows/${workflowId}`);
    const got = await getRes.json();
    if (!getRes.ok) {
      setStatus(`加载失败：${got?.error?.message ?? getRes.status}`);
      return;
    }
    applyDraft(got);
    setStatus(`已加载 · 修订 ${got.revisionNumber}`);
  }, [workspaceId, projectId, applyDraft]);

  useEffect(() => {
    void loadOrCreate();
  }, [loadOrCreate]);

  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < 1280);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const saveNow = useCallback(
    async (graph: WorkflowGraph) => {
      if (!draft) return;
      setStatus('保存中…');
      setConflict(null);
      const res = await fetch(`/api/workspaces/${workspaceId}/workflows/${draft.workflowId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ifRevision: revisionRef.current,
          graph,
        }),
      });
      const json = await res.json();
      if (res.status === 409) {
        setConflict(
          json?.error?.message ??
            '并发编辑冲突（409）。请重新加载以保留另一会话的更改，或放弃本地编辑。',
        );
        setStatus('冲突 — 未覆盖');
        return;
      }
      if (!res.ok) {
        setStatus(`保存失败：${json?.error?.message ?? res.status}`);
        return;
      }
      revisionRef.current = json.revisionNumber;
      setDraft(json);
      dirtyRef.current = false;
      setStatus(`已保存 · 修订 ${json.revisionNumber}`);
    },
    [draft, workspaceId],
  );

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveNow(fromFlow(nodesRef.current, edgesRef.current));
    }, 500);
  }, [saveNow]);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
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
    },
    [],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const graph = fromFlow(nodes, edges);
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
      pushHistory();
      const nextEdges = addEdge({ ...connection, id: candidate.id }, edges);
      setEdges(nextEdges);
      edgesRef.current = nextEdges;
      scheduleSave();
    },
    [nodes, edges, setEdges, scheduleSave, pushHistory],
  );

  const onNodesChangeWrapped = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      const removes = changes.filter((c) => c.type === 'remove');
      if (removes.length > 0) {
        const ids = new Set(removes.map((c) => ('id' in c ? c.id : '')).filter(Boolean));
        const impacted = edgesRef.current.filter((e) => ids.has(e.source) || ids.has(e.target));
        setDeleteHint(
          `删除 ${ids.size} 个节点也会移除 ${impacted.length} 条相连的边。`,
        );
        pushHistory();
      } else {
        const meaningful = changes.some(
          (c) => c.type === 'position' || c.type === 'add' || c.type === 'replace',
        );
        if (meaningful && changes.some((c) => c.type === 'position' && 'dragging' in c && c.dragging === false)) {
          pushHistory();
        }
      }
      onNodesChange(changes);
      const meaningful = changes.some(
        (c) =>
          c.type === 'position' ||
          c.type === 'remove' ||
          c.type === 'add' ||
          c.type === 'replace',
      );
      if (meaningful) scheduleSave();
    },
    [onNodesChange, scheduleSave, pushHistory],
  );

  const onEdgesChangeWrapped = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      if (changes.some((c) => c.type === 'remove')) pushHistory();
      onEdgesChange(changes);
      const meaningful = changes.some(
        (c) => c.type === 'remove' || c.type === 'add' || c.type === 'replace',
      );
      if (meaningful) scheduleSave();
    },
    [onEdgesChange, scheduleSave, pushHistory],
  );

  function addNode(type: string) {
    const id = `n-${type}-${Date.now()}`;
    const config = isWorkflowNodeConfigType(type)
      ? defaultNodeConfig(type)
      : { schemaVersion: 1 };
    const next: Node = {
      id,
      type: 'studio',
      position: { x: 80 + nodes.length * 24, y: 80 + nodes.length * 16 },
      data: { label: nodeLabelZh(type), nodeType: type, config },
    };
    pushHistory();
    const nextNodes = [...nodes, next];
    setNodes(nextNodes);
    nodesRef.current = nextNodes;
    scheduleSave();
  }

  function updateSelectedConfig(key: string, raw: string) {
    const id = selectedIds[0];
    if (!id) return;
    pushHistory();
    const nextNodes = nodes.map((n) => {
      if (n.id !== id) return n;
      const nodeType = String((n.data as { nodeType?: string }).nodeType ?? '');
      const prev = {
        ...((n.data as { config?: Record<string, unknown> }).config ?? { schemaVersion: 1 }),
      };
      let value: unknown = raw;
      if (raw === '') value = null;
      else if (key === 'count' || key === 'seed' || key === 'fidelity' || key === 'lightBlend' || key === 'strength') {
        value = Number(raw);
      }
      prev[key] = value;
      const validated = validateNodeConfig(nodeType, prev);
      return {
        ...n,
        data: {
          ...n.data,
          config: validated.ok ? validated.config : prev,
        },
      };
    });
    setNodes(nextNodes);
    nodesRef.current = nextNodes;
    scheduleSave();
  }

  const undo = useCallback(() => {
    if (historyRef.current.length <= 1) return;
    const current = historyRef.current.pop()!;
    futureRef.current.push(current);
    const prev = historyRef.current[historyRef.current.length - 1]!;
    applyingHistory.current = true;
    setNodes(prev.nodes);
    setEdges(prev.edges);
    nodesRef.current = prev.nodes;
    edgesRef.current = prev.edges;
    applyingHistory.current = false;
    scheduleSave();
    setStatus('已撤销');
  }, [setNodes, setEdges, scheduleSave]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    historyRef.current.push(next);
    applyingHistory.current = true;
    setNodes(next.nodes);
    setEdges(next.edges);
    nodesRef.current = next.nodes;
    edgesRef.current = next.edges;
    applyingHistory.current = false;
    scheduleSave();
    setStatus('已重做');
  }, [setNodes, setEdges, scheduleSave]);

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
    pushHistory();
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
    scheduleSave();
    setStatus(`已粘贴 ${pastedNodes.length} 个节点`);
  }, [pushHistory, setNodes, setEdges, scheduleSave]);

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

  const selected = nodes.find((n) => n.id === selectedIds[0]);
  const selectedType = selected
    ? String((selected.data as { nodeType?: string }).nodeType ?? '')
    : '';
  const selectedConfig = (selected?.data as { config?: Record<string, unknown> } | undefined)
    ?.config ?? { schemaVersion: 1 };
  const fields = CONFIG_FIELD_META[selectedType] ?? [];

  async function reload() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await loadOrCreate();
  }

  async function snapshot() {
    if (!draft) return;
    const res = await fetch(`/api/workspaces/${workspaceId}/workflows/${draft.workflowId}/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ifRevision: revisionRef.current }),
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus(`快照失败：${json?.error?.message ?? res.status}`);
      if (res.status === 409) setConflict(json?.error?.message ?? '冲突');
      return;
    }
    applyDraft(json.draft);
    setStatus(`快照 r${json.revision.revision} · 草稿修订 ${json.draft.revisionNumber}`);
  }


  async function openMaskEditor() {
    const versionId =
      typeof selectedConfig.assetVersionId === 'string'
        ? selectedConfig.assetVersionId
        : null;
    if (!versionId) {
      setStatus('请在 source_image 上填写 assetVersionId（或粘贴版本 ID）以编辑蒙版');
      return;
    }
    const res = await fetch(
      `/api/workspaces/${workspaceId}/asset-versions/${versionId}/download-url?kind=NORMALIZED_PNG`,
    );
    const json = await res.json();
    if (!res.ok) {
      setStatus(`蒙版编辑器：${json?.error?.message ?? res.status}`);
      return;
    }
    setMaskImageUrl(json.url);
    setMaskSourceDims({ w: 1024, h: 1024, versionId }); // dims refined after load; API metadata optional
    // Try to get real dims from assets list is heavy; use 1024 placeholder — render uses DB dims.
    setMaskEditorOpen(true);
  }

  if (narrow) {
    return (
      <main style={{ padding: 24 }} role="main" aria-labelledby="studio-narrow-title">
        <h1 id="studio-narrow-title">Studio（画布）</h1>
        <p role="alert">
          仅桌面端画布编辑器。最小宽度 1280px — 当前视口不支持完整画布编辑。请旋转设备或加宽浏览器窗口。
        </p>
      </main>
    );
  }

  return (
    <div
      role="application"
      aria-label="Studio 工作流画布"
      style={{
        display: 'grid',
        gridTemplateColumns: '220px 1fr 300px',
        gridTemplateRows: '1fr 120px',
        height: 'calc(100vh - 57px)',
        width: '100%',
        background: '#0b1020',
        color: '#e8eefc',
      }}
    >
      <aside
        aria-label="节点库"
        style={{ borderRight: '1px solid #1e2a44', padding: 12, overflow: 'auto' }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }} id="node-library-heading">
          节点库
        </div>
        <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 8 }}>
          11 种 MVP 节点 · Zod 配置（W3-05）
        </div>
        {palette.map((n) => (
          <button
            key={n.type}
            type="button"
            onClick={() => addNode(n.type)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              marginBottom: 6,
              padding: '6px 8px',
              background: '#121a2e',
              border: '1px solid #2a3a5a',
              color: '#e8eefc',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {nodeLabelZh(n.type)}
          </button>
        ))}
      </aside>

      <div style={{ position: 'relative', minWidth: 0 }}>
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
          <Background gap={18} color="#1e2a44" />
          <MiniMap pannable zoomable style={{ background: '#121a2e' }} />
          <Controls />
          <Panel position="top-left">
            <div
              style={{
                background: '#121a2e',
                border: '1px solid #2a3a5a',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <span role="status" aria-live="polite">{status}</span>
              <button type="button" onClick={() => void reload()}>
                重新加载
              </button>
              <button type="button" onClick={() => void snapshot()}>
                快照
              </button>
              <button type="button" onClick={() => undo()} title="Ctrl/Cmd+Z">
                撤销
              </button>
              <button type="button" onClick={() => redo()} title="Ctrl/Cmd+Y">
                重做
              </button>
              <button type="button" onClick={() => copySelected()} title="Ctrl/Cmd+C">
                复制
              </button>
              <button type="button" onClick={() => pasteClipboard()} title="Ctrl/Cmd+V">
                粘贴
              </button>
              <button
                type="button"
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
        {edgeError && (
          <div
            style={{
              position: 'absolute',
              bottom: 12,
              left: 12,
              right: 12,
              background: '#3a1520',
              border: '1px solid #c44',
              padding: 8,
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            非法连线已阻止：{edgeError}
          </div>
        )}
        {deleteHint && (
          <div
            style={{
              position: 'absolute',
              bottom: edgeError ? 56 : 12,
              left: 12,
              right: 12,
              background: '#1a2438',
              border: '1px solid #3a4a6a',
              padding: 8,
              borderRadius: 6,
              fontSize: 12,
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span>{deleteHint}</span>
            <button type="button" onClick={() => setDeleteHint(null)}>
              关闭
            </button>
          </div>
        )}
        {conflict && (
          <div
            style={{
              position: 'absolute',
              top: 48,
              left: 12,
              right: 12,
              background: '#3a3010',
              border: '1px solid #c90',
              padding: 10,
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            <strong>409 冲突</strong> — {conflict}
            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={() => void reload()}>
                加载远端
              </button>
            </div>
          </div>
        )}
      </div>

      <aside style={{ borderLeft: '1px solid #1e2a44', padding: 12, overflow: 'auto' }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>节点属性</div>
        {!selected ? (
          <p style={{ opacity: 0.65, fontSize: 13 }}>
            选择节点以编辑其 Zod 配置外壳（仅 Fake — 不调用 Provider）。
          </p>
        ) : (
          <div style={{ fontSize: 13 }}>
            <div>
              <strong>{String((selected.data as { label?: string }).label)}</strong>
            </div>
            <div style={{ opacity: 0.7 }}>类型：{selectedType}</div>
            <div style={{ opacity: 0.7 }}>
              位置：{Math.round(selected.position.x)}, {Math.round(selected.position.y)}
            </div>
            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              {fields.map((f) => (
                <label key={f.key} style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                  <span style={{ opacity: 0.8 }}>{f.label}</span>
                  {f.kind === 'select' ? (
                    <select
                      value={String(selectedConfig[f.key] ?? '')}
                      onChange={(e) => updateSelectedConfig(f.key, e.target.value)}
                      style={{
                        background: '#0b1020',
                        color: '#e8eefc',
                        border: '1px solid #2a3a5a',
                        borderRadius: 4,
                        padding: 4,
                      }}
                    >
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {OPTION_LABEL_ZH[o] ?? o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.kind === 'number' ? 'number' : 'text'}
                      value={
                        selectedConfig[f.key] === null || selectedConfig[f.key] === undefined
                          ? ''
                          : String(selectedConfig[f.key])
                      }
                      onChange={(e) => updateSelectedConfig(f.key, e.target.value)}
                      style={{
                        background: '#0b1020',
                        color: '#e8eefc',
                        border: '1px solid #2a3a5a',
                        borderRadius: 4,
                        padding: 4,
                      }}
                    />
                  )}
                </label>
              ))}
            </div>
            <pre style={{ fontSize: 11, opacity: 0.8, whiteSpace: 'pre-wrap', marginTop: 12 }}>
              {JSON.stringify(selectedConfig, null, 2)}
            </pre>
            {(selectedType === 'source_image' ||
              selectedType === 'replace_background' ||
              selectedType === 'inpaint') && (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => void openMaskEditor()}
                  style={{
                    background: '#121a2e',
                    border: '1px solid #2a3a5a',
                    color: '#e8eefc',
                    borderRadius: 6,
                    padding: '6px 10px',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  打开蒙版编辑器
                </button>
                <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>
                  需在 source_image 填写 assetVersionId；将得到的 maskId 粘贴到 replace_background / inpaint。
                </div>
              </div>
            )}
          </div>
        )}
        {maskEditorOpen && maskImageUrl && maskSourceDims ? (
          <div style={{ marginTop: 16 }}>
            <MaskEditor
              workspaceId={workspaceId}
              assetVersionId={maskSourceDims.versionId}
              imageUrl={maskImageUrl}
              sourceWidth={maskSourceDims.w}
              sourceHeight={maskSourceDims.h}
              maskId={
                typeof selectedConfig.maskId === 'string' ? selectedConfig.maskId : null
              }
              onSaved={(id) => {
                if (selectedType === 'replace_background' || selectedType === 'inpaint') {
                  updateSelectedConfig('maskId', id);
                }
                setStatus(`蒙版已保存 ${id.slice(0, 8)}…`);
              }}
              onClose={() => setMaskEditorOpen(false)}
            />
          </div>
        ) : null}
        <div style={{ marginTop: 24, fontSize: 11, opacity: 0.65 }}>
          草稿修订：{draft?.revisionNumber ?? '—'}
          <br />
          自动保存：500ms · 撤销/重做仅当前会话 · isValidConnection 预览
        </div>
      </aside>

      <TaskDrawer workspaceId={workspaceId} projectId={projectId} draft={draft} />
    </div>
  );
}


function TaskDrawer(props: {
  workspaceId: string;
  projectId: string;
  draft: DraftResponse | null;
}) {
  const { workspaceId, projectId, draft } = props;
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

  async function snapshotAndRun() {
    if (!draft) return;
    setBusy(true);
    setMsg(null);
    try {
      const snap = await fetch(`/api/workspaces/${workspaceId}/workflows/${draft.workflowId}/snapshot`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ifRevision: draft.revisionNumber }),
      });
      const snapJson = await snap.json();
      if (!snap.ok) {
        setMsg(snapJson.error?.message ?? '快照失败');
        return;
      }
      const revisionId = snapJson.revision?.id as string;
      const runRes = await fetch(
        `/api/workspaces/${workspaceId}/workflow-revisions/${revisionId}/runs`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            scope: { type: 'ALL' },
            idempotencyKey: crypto.randomUUID(),
            budgetLimit: { currency: 'USD', amount: 5 },
            confirmBudget: true,
          }),
        },
      );
      const runJson = await runRes.json();
      if (!runRes.ok) {
        setMsg(runJson.error?.message ?? '运行失败');
        return;
      }
      setMsg(`运行 ${runJson.run?.status}（${runJson.run?.id?.slice(0, 8)}…）`);
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
    <div
      style={{
        gridColumn: '1 / -1',
        borderTop: '1px solid #1e2a44',
        padding: 12,
        fontSize: 13,
        display: 'grid',
        gap: 8,
        background: '#0d1424',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>任务抽屉</strong>
        <button type="button" disabled={busy || !draft} onClick={() => void snapshotAndRun()}>
          {busy ? '启动中…' : '快照并运行（Fake）'}
        </button>
        <button type="button" onClick={() => void refresh()}>
          刷新
        </button>
        {msg && <span style={{ opacity: 0.85 }}>{msg}</span>}
      </div>
      <div style={{ display: 'grid', gap: 6, maxHeight: 160, overflow: 'auto' }}>
        {runs.length === 0 && (
          <div role="status" style={{ opacity: 0.65 }}>暂无运行 — 排队 / 运行中 / 成功 / 失败会显示在这里。</div>
        )}
        {runs.map((r) => (
          <div
            key={r.id}
            style={{
              border: '1px solid #2a3a5a',
              borderRadius: 6,
              padding: 8,
              display: 'grid',
              gap: 4,
            }}
          >
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <span>
                <code>{r.id.slice(0, 8)}</code> · <strong>{r.status}</strong> · 预估{' '}
                {(r.estimateMicrounits / 1_000_000).toFixed(3)} USD
              </span>
              {(r.status === 'QUEUED' || r.status === 'RUNNING') && (
                <button type="button" onClick={() => void cancelRun(r.id)}>
                  取消
                </button>
              )}
            </div>
            {r.items.map((it) => {
              const latest = it.attempts[it.attempts.length - 1];
              return (
                <div key={it.id} style={{ fontSize: 12, opacity: 0.9, paddingLeft: 8 }}>
                  节点 <code>{it.nodeId}</code> · {it.status}
                  {latest && (
                    <>
                      {' '}
                      · 尝试 #{latest.attemptNo} {latest.status}（{latest.progress}%）
                      {latest.errorClass && (
                        <span style={{ color: '#f88' }}>
                          {' '}
                          {latest.errorClass}: {latest.errorMessage}
                        </span>
                      )}
                      {(latest.status === 'FAILED_FINAL' || latest.status === 'FAILED_RETRYABLE') && (
                        <button type="button" style={{ marginLeft: 8 }} onClick={() => void retryAttempt(latest.id)}>
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
        <div style={{ fontSize: 11, opacity: 0.55 }}>
          SSE: {events[0]}
        </div>
      )}
    </div>
  );
}

export function StudioCanvas(props: { workspaceId: string; projectId: string }) {
  return (
    <ReactFlowProvider>
      <StudioCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
