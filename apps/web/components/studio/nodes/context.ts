'use client';

import { createContext } from 'react';
import type { ModelOptionItem } from '../config-options';

export const PORT_LABEL_ZH: Record<string, string> = {
  image: '图片',
  images: '图片',
  mask: '蒙版',
  prompt: '提示词',
  truth: '产品图',
  references: '参考图',
  shotBrief: '分镜说明',
  report: '质检报告',
  candidates: '候选图',
  approvedAssets: '已选定图',
  assets: '已选定图',
};

/** 卡片节点可用的画布操作，由 StudioCanvasInner 提供。 */
export type NodeActionContextValue = {
  uploadIntoNode: (nodeId: string) => void;
  missingPorts: (nodeId: string) => string[];
  updateConfig: (nodeId: string, key: string, raw: string) => void;
  models: ModelOptionItem[] | null;
  /** nodeId → 已生成图片的 assetVersionIds（当前快照修订的 SUCCEEDED 结果）。 */
  resultImages: (nodeId: string) => string[];
  /** 单节点运行（scope: NODES）。 */
  runNode: (nodeId: string) => void;
  runBusy: boolean;
  /** 生图卡顶部摘要：连入 prompt 端口的文本卡内容（无连线返回 null）。 */
  connectedPromptText: (nodeId: string) => string | null;
  /** assetVersionId → 素材文件名（用于图片卡底部小字）。 */
  assetLabel: (versionId: string) => string | null;
};

export const NodeActionContext = createContext<NodeActionContextValue>({
  uploadIntoNode: () => {},
  missingPorts: () => [],
  updateConfig: () => {},
  models: null,
  resultImages: () => [],
  runNode: () => {},
  runBusy: false,
  connectedPromptText: () => null,
  assetLabel: () => null,
});
