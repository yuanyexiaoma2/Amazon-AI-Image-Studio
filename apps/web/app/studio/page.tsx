'use client';

import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const initialNodes: Node[] = [
  { id: 'n1', position: { x: 0, y: 0 }, data: { label: 'source_image' } },
  { id: 'n2', position: { x: 220, y: 0 }, data: { label: 'generate (stub)' } },
];

const initialEdges: Edge[] = [{ id: 'e1', source: 'n1', target: 'n2' }];

/** Canvas stub — full studio comes in later weeks. */
export default function StudioPage() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  return (
    <div>
      <h1>Studio (stub)</h1>
      <p style={{ opacity: 0.75 }}>@xyflow/react dependency wired for later canvas work.</p>
      <div style={{ height: 420, border: '1px solid #1e2a44', borderRadius: 8 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <Background />
          <MiniMap />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
