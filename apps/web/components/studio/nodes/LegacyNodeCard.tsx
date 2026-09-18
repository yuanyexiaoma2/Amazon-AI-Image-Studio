'use client';

/**
 * 旧类型节点（无 cardKind 的算子节点）的紧凑回退渲染 — 保持旧画布可用。
 * 渲染逻辑与重构前的 StudioNodeView 一致。
 */
import { useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getNodeDefinition } from '@studio/domain';
import { AssetImage } from '../../asset-image';
import { NodeActionContext, PORT_LABEL_ZH } from './context';
import { GenerateNodeControls } from './GenerateNodeControls';
import { GenerateNodeResults } from './GenerateNodeResults';

export function LegacyNodeCard(props: NodeProps) {
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
  const truthRevisionId =
    nodeType === 'product_truth' && typeof data.config?.truthRevisionId === 'string'
      ? (data.config.truthRevisionId as string)
      : null;
  const promptText =
    nodeType === 'prompt' && typeof data.config?.text === 'string'
      ? data.config.text.trim()
      : '';
  const missing = actions.missingPorts(props.id);
  return (
    <div className={props.selected ? 'studio-node studio-node-selected' : 'studio-node'}>
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
      {nodeType === 'product_truth' ? (
        truthRevisionId ? (
          <div className="studio-node-preview">
            已绑定产品图资料 ✓{' '}
            <button
              type="button"
              className="studio-node-relink nodrag"
              onClick={(e) => {
                e.stopPropagation();
                actions.uploadIntoNode(props.id);
              }}
            >
              换一张
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn studio-node-upload nodrag"
            onClick={(e) => {
              e.stopPropagation();
              actions.uploadIntoNode(props.id);
            }}
          >
            上传产品图
          </button>
        )
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
      {nodeType === 'generate' ? (
        <>
          <GenerateNodeControls nodeId={props.id} config={data.config} />
          <GenerateNodeResults
            workspaceId={data.workspaceId ?? null}
            versionIds={actions.resultImages(props.id)}
          />
        </>
      ) : null}
      {def && def.inputPorts.length > 0 ? (
        <div className="studio-node-ports">
          {def.inputPorts.map((p) => (
            <div
              key={`in-${p.id}`}
              className={p.required ? 'studio-node-port' : 'studio-node-port faint'}
            >
              <Handle
                id={p.id}
                type="target"
                position={Position.Left}
                className="studio-handle studio-handle-in"
                title={`输入 · ${PORT_LABEL_ZH[p.id] ?? p.id}`}
              />
              {PORT_LABEL_ZH[p.id] ?? p.id}
              {p.required ? '' : '（可选）'}
            </div>
          ))}
        </div>
      ) : null}
      {def && def.outputPorts.length > 0 ? (
        <div className="studio-node-ports">
          {def.outputPorts.map((p) => (
            <div key={`out-${p.id}`} className="studio-node-port studio-node-port-out">
              <Handle
                id={p.id}
                type="source"
                position={Position.Right}
                className="studio-handle studio-handle-out"
                title={`输出 · ${PORT_LABEL_ZH[p.id] ?? p.id}`}
              />
              {PORT_LABEL_ZH[p.id] ?? p.id}
            </div>
          ))}
        </div>
      ) : null}
      {missing.length > 0 ? (
        <div className="studio-node-missing">缺连线：{missing.join(' / ')}</div>
      ) : null}
    </div>
  );
}
