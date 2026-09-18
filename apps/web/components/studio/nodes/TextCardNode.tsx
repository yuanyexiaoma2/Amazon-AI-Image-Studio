'use client';

import { useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { NodeActionContext } from './context';

/** 文本卡：可直接编辑的多行提示词，右侧「+」为提示词输出端口。 */
export function TextCardNode(props: NodeProps) {
  const actions = useContext(NodeActionContext);
  const data = props.data as { config?: Record<string, unknown> };
  const text = typeof data.config?.text === 'string' ? data.config.text : '';
  return (
    <div className={props.selected ? 'studio-card studio-card-selected' : 'studio-card'}>
      <div className="studio-card-head">
        <span className="studio-card-title">文本</span>
      </div>
      <textarea
        className="studio-card-textarea nodrag nowheel"
        value={text}
        placeholder="写下提示词，拖到生图卡上使用…"
        rows={5}
        onChange={(e) => actions.updateConfig(props.id, 'text', e.target.value)}
      />
      <Handle
        id="prompt"
        type="source"
        position={Position.Right}
        className="studio-card-handle studio-card-handle-out"
        title="提示词 · 拖出连线生成下游生图卡"
      />
    </div>
  );
}
