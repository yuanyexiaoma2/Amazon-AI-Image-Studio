'use client';

import type { NodeProps, NodeTypes } from '@xyflow/react';
import { getNodeDefinition } from '@studio/domain';
import { TextCardNode } from './TextCardNode';
import { ImageCardNode } from './ImageCardNode';
import { GenerateCardNode } from './GenerateCardNode';
import { LegacyNodeCard } from './LegacyNodeCard';

/** 按 registry 的 cardKind 分发到内容卡片；无 cardKind 的旧类型走紧凑回退渲染。 */
function StudioNodeDispatcher(props: NodeProps) {
  const nodeType = String((props.data as { nodeType?: string }).nodeType ?? '');
  switch (getNodeDefinition(nodeType)?.cardKind) {
    case 'text':
      return <TextCardNode {...props} />;
    case 'image':
      return <ImageCardNode {...props} />;
    case 'generate':
      return <GenerateCardNode {...props} />;
    default:
      return <LegacyNodeCard {...props} />;
  }
}

export const studioNodeTypes: NodeTypes = { studio: StudioNodeDispatcher };
