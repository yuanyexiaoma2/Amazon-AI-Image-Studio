'use client';

import { useContext } from 'react';
import { modelLabelZh } from '@/lib/zh-labels';
import { NodeActionContext } from './context';
import { RESOLUTION_ZH, generateOptionSets } from '../generate-options';

/** 生成节点卡片内联控件：模型 / 比例 / 清晰度（比例与清晰度跟随所选模型的能力）。 */
export function GenerateNodeControls(props: { nodeId: string; config?: Record<string, unknown> }) {
  const actions = useContext(NodeActionContext);
  const cfg = props.config ?? {};
  const modelKey = typeof cfg.modelKey === 'string' ? cfg.modelKey : '';
  const ratio = typeof cfg.ratio === 'string' && cfg.ratio ? cfg.ratio : '1:1';
  const resolution = typeof cfg.resolution === 'string' && cfg.resolution ? cfg.resolution : '2K';
  const { models, isAuto, current, ratioOptions, resolutionOptions } = generateOptionSets(
    actions.models,
    modelKey,
    ratio,
    resolution,
  );
  return (
    <div className="studio-node-controls nodrag" onClick={(e) => e.stopPropagation()}>
      <label className="studio-node-field">
        <span>模型</span>
        <select
          value={isAuto ? 'auto' : modelKey}
          onChange={(e) => actions.updateConfig(props.nodeId, 'modelKey', e.target.value)}
        >
          <option value="auto">智能匹配（自动）</option>
          {actions.models !== null && !isAuto && !current && modelKey ? (
            <option value={modelKey}>{modelLabelZh({ key: modelKey })}（不可用）</option>
          ) : null}
          {models.map((m) => (
            <option key={m.key} value={m.key}>
              {modelLabelZh(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="studio-node-field">
        <span>比例</span>
        <select
          value={ratio}
          onChange={(e) => actions.updateConfig(props.nodeId, 'ratio', e.target.value)}
        >
          {ratioOptions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="studio-node-field">
        <span>清晰度</span>
        <select
          value={resolution}
          onChange={(e) => actions.updateConfig(props.nodeId, 'resolution', e.target.value)}
        >
          {resolutionOptions.map((r) => (
            <option key={r} value={r}>
              {RESOLUTION_ZH[r] ?? r}
            </option>
          ))}
        </select>
      </label>
      {isAuto ? (
        <div className="studio-node-cost faint">只写提示词 → 文生图；连了参考图 → 图生图</div>
      ) : current?.pricing ? (
        <div className="studio-node-cost faint">
          约 ${current.pricing.estimatedUnitCost}/张
        </div>
      ) : null}
    </div>
  );
}
