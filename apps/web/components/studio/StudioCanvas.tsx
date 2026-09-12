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

function toFlowNodes(graph: WorkflowGraph): Node[] {
  return graph.nodes.map((n) => ({
    id: n.id,
    type: 'studio',
    position: n.position,
    data: { label: getNodeDefinition(n.type)?.label ?? n.type, nodeType: n.type, config: n.config ?? { schemaVersion: 1 } },
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

export function StudioCanvas(props: {
  workspaceId: string;
  projectId: string;
}) {
  const { workspaceId, projectId } = props;
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Loading…');
  const [conflict, setConflict] = useState<string | null>(null);
  const [edgeError, setEdgeError] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  const revisionRef = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  const palette = useMemo(() => listPaletteNodeTypes(), []);

  const applyDraft = useCallback(
    (d: DraftResponse) => {
      setDraft(d);
      revisionRef.current = d.revisionNumber;
      setNodes(toFlowNodes(d.graph));
      setEdges(toFlowEdges(d.graph));
      dirtyRef.current = false;
    },
    [setNodes, setEdges],
  );

  const loadOrCreate = useCallback(async () => {
    setStatus('Loading workflows…');
    setConflict(null);
    const listRes = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/workflows`);
    const listJson = await listRes.json();
    if (!listRes.ok) {
      setStatus(`Failed to list: ${listJson?.error?.message ?? listRes.status}`);
      return;
    }
    let workflowId: string | undefined = listJson.items?.[0]?.id;
    if (!workflowId) {
      const createRes = await fetch(`/api/workspaces/${workspaceId}/projects/${projectId}/workflows`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Studio workflow' }),
      });
      const created = await createRes.json();
      if (!createRes.ok) {
        setStatus(`Create failed: ${created?.error?.message ?? createRes.status}`);
        return;
      }
      applyDraft(created);
      setStatus(`Created empty workflow · rev ${created.revisionNumber}`);
      return;
    }
    const getRes = await fetch(`/api/workspaces/${workspaceId}/workflows/${workflowId}`);
    const got = await getRes.json();
    if (!getRes.ok) {
      setStatus(`Load failed: ${got?.error?.message ?? getRes.status}`);
      return;
    }
    applyDraft(got);
    setStatus(`Loaded · rev ${got.revisionNumber}`);
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
      setStatus('Saving…');
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
            'Concurrent edit conflict (409). Reload to keep the other session\'s changes, or discard local edits.',
        );
        setStatus('Conflict — not overwritten');
        return;
      }
      if (!res.ok) {
        setStatus(`Save failed: ${json?.error?.message ?? res.status}`);
        return;
      }
      revisionRef.current = json.revisionNumber;
      setDraft(json);
      dirtyRef.current = false;
      setStatus(`Saved · rev ${json.revisionNumber}`);
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
      const nextEdges = addEdge({ ...connection, id: candidate.id }, edges);
      setEdges(nextEdges);
      edgesRef.current = nextEdges;
      scheduleSave();
    },
    [nodes, edges, setEdges, scheduleSave],
  );

  const onNodesChangeWrapped = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
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
    [onNodesChange, scheduleSave],
  );

  const onEdgesChangeWrapped = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      onEdgesChange(changes);
      const meaningful = changes.some(
        (c) => c.type === 'remove' || c.type === 'add' || c.type === 'replace',
      );
      if (meaningful) scheduleSave();
    },
    [onEdgesChange, scheduleSave],
  );

  function addNode(type: string) {
    const id = `n-${type}-${Date.now()}`;
    const def = getNodeDefinition(type);
    const next: Node = {
      id,
      type: 'studio',
      position: { x: 80 + nodes.length * 24, y: 80 + nodes.length * 16 },
      data: { label: def?.label ?? type, nodeType: type, config: { schemaVersion: 1 } },
    };
    const nextNodes = [...nodes, next];
    setNodes(nextNodes);
    nodesRef.current = nextNodes;
    scheduleSave();
  }

  const selected = nodes.find((n) => n.id === selectedId);

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
      setStatus(`Snapshot failed: ${json?.error?.message ?? res.status}`);
      if (res.status === 409) setConflict(json?.error?.message ?? 'Conflict');
      return;
    }
    applyDraft(json.draft);
    setStatus(`Snapshot r${json.revision.revision} · draft rev ${json.draft.revisionNumber}`);
  }

  if (narrow) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Studio</h1>
        <p>Desktop-only canvas editor. Minimum width 1280px — full canvas editing is not supported on this viewport.</p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '220px 1fr 280px',
        gridTemplateRows: '1fr 120px',
        height: 'calc(100vh - 57px)',
        width: '100%',
        background: '#0b1020',
        color: '#e8eefc',
      }}
    >
      {/* Left: node library */}
      <aside style={{ borderRight: '1px solid #1e2a44', padding: 12, overflow: 'auto' }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Node library</div>
        <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 8 }}>
          Stubs for registry (W3-05 schemas later)
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
            {n.label}
          </button>
        ))}
        <div style={{ marginTop: 16, fontSize: 11, opacity: 0.7 }}>
          Project assets / templates — W3-B2
        </div>
      </aside>

      {/* Center: canvas */}
      <div style={{ position: 'relative', minWidth: 0 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChangeWrapped}
          onEdgesChange={onEdgesChangeWrapped}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          onSelectionChange={({ nodes: sel }) => setSelectedId(sel[0]?.id ?? null)}
          fitView
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
              }}
            >
              <span>{status}</span>
              <button type="button" onClick={() => void reload()}>
                Reload
              </button>
              <button type="button" onClick={() => void snapshot()}>
                Snapshot
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
            Illegal edge blocked: {edgeError}
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
            <strong>409 conflict</strong> — {conflict}
            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={() => void reload()}>
                Reload remote
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right: properties */}
      <aside style={{ borderLeft: '1px solid #1e2a44', padding: 12, overflow: 'auto' }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Node properties</div>
        {!selected ? (
          <p style={{ opacity: 0.65, fontSize: 13 }}>Select a node. Full config schemas arrive in W3-05.</p>
        ) : (
          <div style={{ fontSize: 13 }}>
            <div>
              <strong>{String((selected.data as { label?: string }).label)}</strong>
            </div>
            <div style={{ opacity: 0.7 }}>type: {String((selected.data as { nodeType?: string }).nodeType)}</div>
            <div style={{ opacity: 0.7 }}>
              pos: {Math.round(selected.position.x)}, {Math.round(selected.position.y)}
            </div>
            <pre style={{ fontSize: 11, opacity: 0.8, whiteSpace: 'pre-wrap' }}>
              {JSON.stringify((selected.data as { config?: unknown }).config ?? {}, null, 2)}
            </pre>
          </div>
        )}
        <div style={{ marginTop: 24, fontSize: 11, opacity: 0.65 }}>
          Draft rev: {draft?.revisionNumber ?? '—'}
          <br />
          Autosave: 500ms debounce · optimistic lock
        </div>
      </aside>

      {/* Bottom: task drawer stub */}
      <div
        style={{
          gridColumn: '1 / -1',
          borderTop: '1px solid #1e2a44',
          padding: 12,
          fontSize: 13,
          opacity: 0.8,
        }}
      >
        Task drawer (stub): queued / running / success / failed — W4+. Snapshot creates immutable revision for
        future runs.
      </div>
    </div>
  );
}
