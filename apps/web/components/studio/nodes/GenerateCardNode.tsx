'use client';

import { useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { NodeActionContext, PORT_LABEL_ZH } from './context';
import { CardTitle } from './CardTitle';
import { GenerateNodeControls } from './GenerateNodeControls';
import { GenerateNodeResults } from './GenerateNodeResults';
import { AssetImage } from '../../asset-image';

/** 生图卡：未选中时只显示标题栏 + 大图（图片优先）；点击选中后展开提示词/参数/结果列表。 */
export function GenerateCardNode(props: NodeProps) {
  const actions = useContext(NodeActionContext);
  const data = props.data as { workspaceId?: string; config?: Record<string, unknown> };
  const config = data.config ?? { schemaVersion: 1 };
  const configPrompt = typeof config.prompt === 'string' ? config.prompt : '';
  const title = typeof config.title === 'string' ? config.title : '';
  const connectedPrompt = actions.connectedPromptText(props.id);
  const results = actions.resultImages(props.id);
  const stale = actions.isStale(props.id);
  const expanded = props.selected;
  return (
    <div
      className={
        expanded
          ? 'studio-card studio-card-generate studio-card-selected'
          : 'studio-card studio-card-generate studio-card-collapsed'
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

      {/* 折叠态：大图优先；无结果时显示占位图井 */}
      {!expanded ? (
        <div className="studio-card-hero" title="点击卡片展开参数">
          {results.length > 0 ? (
            <>
              <AssetImage
                workspaceId={data.workspaceId ?? null}
                versionId={results[0]}
                size={256}
                alt={title.trim() || '生成结果'}
                className="studio-card-hero-img"
              />
              {results.length > 1 ? (
                <span className="studio-card-hero-more">+{results.length - 1}</span>
              ) : null}
            </>
          ) : (
            <svg
              viewBox="0 0 24 24"
              width="34"
              height="34"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="studio-card-hero-placeholder"
            >
              <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
              <circle cx="9" cy="10" r="1.6" />
              <path d="M4.5 17.5 10 12l3.5 3.5L17 12l3.5 3.5" />
            </svg>
          )}
        </div>
      ) : null}

      {/* 展开态（点击选中后）：提示词 + 参数 + 结果列表 */}
      {expanded ? (
        <>
          {connectedPrompt !== null ? (
            <>
              <div
                className="studio-card-prompt nodrag"
                title="提示词来自连线的文本卡；下方可为本卡追加后缀"
              >
                {connectedPrompt.length > 120 ? `${connectedPrompt.slice(0, 120)}…` : connectedPrompt}
                <span className="studio-card-prompt-src faint">来自文本卡</span>
              </div>
              <input
                className="studio-card-suffix nodrag"
                value={configPrompt}
                placeholder="追加后缀（可选，如：白底主图）"
                title="生成时拼在连线文本之后：「连线文本，后缀」"
                onChange={(e) => actions.updateConfig(props.id, 'prompt', e.target.value)}
              />
            </>
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
              nameBase={title.trim() || '生图'}
            />
          ) : null}
        </>
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
