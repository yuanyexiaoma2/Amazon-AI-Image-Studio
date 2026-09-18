'use client';

import { useContext } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AssetImage } from '../../asset-image';
import { NodeActionContext } from './context';
import { CardTitle } from './CardTitle';

/** 图片卡：大图预览；未绑定素材时显示上传入口；底部小字显示文件名。 */
export function ImageCardNode(props: NodeProps) {
  const actions = useContext(NodeActionContext);
  const data = props.data as { workspaceId?: string; config?: Record<string, unknown> };
  const versionId =
    typeof data.config?.assetVersionId === 'string' ? data.config.assetVersionId : null;
  const title = typeof data.config?.title === 'string' ? data.config.title : '';
  const meta = versionId
    ? (actions.assetLabel(versionId) ?? `版本 ${versionId.slice(0, 8)}…`)
    : null;
  return (
    <div className={props.selected ? 'studio-card studio-card-selected' : 'studio-card'}>
      <div className="studio-card-head">
        <CardTitle nodeId={props.id} title={title} fallback="图片" />
      </div>
      {versionId ? (
        <div className="studio-card-preview nodrag">
          <AssetImage
            workspaceId={data.workspaceId ?? null}
            versionId={versionId}
            size={224}
            alt={meta ?? '图片'}
            className="studio-card-preview-img"
          />
        </div>
      ) : (
        <button
          type="button"
          className="studio-card-upload nodrag"
          onClick={(e) => {
            e.stopPropagation();
            actions.uploadIntoNode(props.id);
          }}
        >
          上传图片
          <span className="faint">或直接把图片文件拖进画布</span>
        </button>
      )}
      {meta ? <div className="studio-card-foot faint">{meta}</div> : null}
      <Handle
        id="image"
        type="source"
        position={Position.Right}
        className="studio-card-handle studio-card-handle-out"
        title="图片 · 拖出连线作为生图卡的参考图"
      />
    </div>
  );
}
