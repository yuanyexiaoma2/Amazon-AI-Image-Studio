'use client';

import { useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { NodeActionContext, PORT_LABEL_ZH } from './context';
import { CardTitle } from './CardTitle';
import { GenerateNodeControls } from './GenerateNodeControls';
import { GenerateNodeResults } from './GenerateNodeResults';

/** 生图卡：提示词摘要（连线优先，否则可编辑 config.prompt）+ 生成控件 + 生成按钮 + 结果画廊。 */
export function GenerateCardNode(props: NodeProps) {
  const actions = useContext(NodeActionContext);
  const data = props.data as { workspaceId?: string; config?: Record<string, unknown> };
  const config = data.config ?? { schemaVersion: 1 };
  const configPrompt = typeof config.prompt === 'string' ? config.prompt : '';
  const title = typeof config.title === 'string' ? config.title : '';
  const connectedPrompt = actions.connectedPromptText(props.id);
  const results = actions.resultImages(props.id);
  const stale = actions.isStale(props.id);
  return (
    <div
      className={
        props.selected ? 'studio-card studio-card-generate studio-card-selected' : 'studio-card studio-card-generate'
      }
    >
      <div className="studio-card-head">
        <CardTitle nodeId={props.id} title={title} fallback="生图" />
        {stale ? (
          <span className="studio-card-stale" title="上游内容已变更，建议重新生成">
            需重跑
          </span>
        ) : null}
        <button
          type="button"
          className="btn btn-primary studio-card-run nodrag"
          disabled={actions.runBusy}
          onClick={(e) => {
            e.stopPropagation();
            actions.runNode(props.id);
          }}
          title="只运行这张生图卡（演示模式 · 预算 $5）"
        >
          {actions.runBusy ? '启动中…' : '▶ 生成'}
        </button>
      </div>
      {connectedPrompt !== null ? (
        <div
          className="studio-card-prompt nodrag"
          title="提示词来自连线的文本卡；断开连线后可在卡片上直接编辑"
        >
          {connectedPrompt.length > 120 ? `${connectedPrompt.slice(0, 120)}…` : connectedPrompt}
          <span className="studio-card-prompt-src faint">来自文本卡</span>
        </div>
      ) : (
        <textarea
          className="studio-card-textarea nodrag nowheel"
          value={configPrompt}
          placeholder="描述任何你想要生成的内容"
          rows={3}
          onChange={(e) => actions.updateConfig(props.id, 'prompt', e.target.value)}
        />
      )}
      <GenerateNodeControls nodeId={props.id} config={config} />
      {results.length > 0 ? (
        <GenerateNodeResults
          workspaceId={data.workspaceId ?? null}
          versionIds={results}
          size={72}
        />
      ) : null}
      <Handle
        id="prompt"
        type="target"
        position={Position.Left}
        style={{ top: '30%' }}
        className="studio-card-handle studio-card-handle-in"
        title={`输入 · ${PORT_LABEL_ZH.prompt}`}
      />
      <Handle
        id="references"
        type="target"
        position={Position.Left}
        style={{ top: '70%' }}
        className="studio-card-handle studio-card-handle-in"
        title={`输入 · ${PORT_LABEL_ZH.references}（最多 8 张）`}
      />
      <Handle
        id="images"
        type="source"
        position={Position.Right}
        className="studio-card-handle studio-card-handle-out"
        title="生成结果 · 拖出连线作为下游生图卡的参考图"
      />
    </div>
  );
}
