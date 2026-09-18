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

/** 图片卡底部快捷操作预设：全部走生图卡 + i2i 模型智能匹配（不用 legacy 算子节点）。 */
export type ImageQuickAction = {
  key: string;
  label: string;
  prompt: string;
  count: number;
  title: string;
};

export const IMAGE_QUICK_ACTIONS: ImageQuickAction[] = [
  {
    key: 'variant',
    label: '生成变体',
    prompt: '保持主体完全一致，生成风格变体',
    count: 4,
    title: '风格变体',
  },
  {
    key: 'background',
    label: '换背景',
    prompt: '保持主体不变，替换为简洁高级的场景背景',
    count: 2,
    title: '换背景',
  },
  {
    key: 'cutout',
    label: '抠图',
    prompt: '抠出主体，输出干净纯色背景',
    count: 1,
    title: '抠图',
  },
];

/** 卡片节点可用的画布操作，由 StudioCanvasInner 提供。 */
export type NodeActionContextValue = {
  uploadIntoNode: (nodeId: string) => void;
  missingPorts: (nodeId: string) => string[];
  updateConfig: (nodeId: string, key: string, raw: string) => void;
  models: ModelOptionItem[] | null;
  /** nodeId → 已生成图片的 assetVersionIds（当前快照修订的 SUCCEEDED 结果）。 */
  resultImages: (nodeId: string) => string[];
  /** nodeId → 最近成功结果是否已过期（上游内容变更，建议重跑）。 */
  isStale: (nodeId: string) => boolean;
  /** 图片卡快捷操作：在右侧派生一张连好参考图的生图卡并选中。 */
  spawnGenerateFrom: (sourceNodeId: string, preset: ImageQuickAction) => void;
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
  isStale: () => false,
  spawnGenerateFrom: () => {},
  runNode: () => {},
  runBusy: false,
  connectedPromptText: () => null,
  assetLabel: () => null,
});
