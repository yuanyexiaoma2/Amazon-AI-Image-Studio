'use client';

import { useContext, useEffect, useRef, useState } from 'react';
import { modelLabelZh } from '@/lib/zh-labels';
import { NodeActionContext } from './context';
import { RESOLUTION_ZH, generateOptionSets, modelDisabledReason } from '../generate-options';

/** 生成节点卡片内联控件：模型 / 比例 / 清晰度（选项跟随所选模型能力，参考图状态置灰不兼容模型）。 */
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
  const hasRefs = actions.hasReferences(props.nodeId);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (msg: string) => {
    setNote(msg);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 4000);
  };
  useEffect(() => () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
  }, []);

  // 选中模型不支持当前比例/清晰度时自动切到第一可用档并提示。
  useEffect(() => {
    if (isAuto || !current) return;
    if (current.ratios && current.ratios.length > 0 && !current.ratios.includes(ratio)) {
      actions.updateConfig(props.nodeId, 'ratio', current.ratios[0] as string);
      flash(`该模型不支持 ${ratio}，已切换到 ${current.ratios[0]}`);
      return;
    }
    if (
      current.resolutionTiers &&
      current.resolutionTiers.length > 0 &&
      !current.resolutionTiers.includes(resolution)
    ) {
      actions.updateConfig(props.nodeId, 'resolution', current.resolutionTiers[0] as string);
      flash(`该模型不支持 ${RESOLUTION_ZH[resolution] ?? resolution}，已切换到 ${current.resolutionTiers[0]}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuto, current?.key, ratio, resolution]);

  const currentReason = current ? modelDisabledReason(current, hasRefs) : null;

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
          {models.map((m) => {
            const reason = modelDisabledReason(m, hasRefs);
            return (
              <option
                key={m.key}
                value={m.key}
                disabled={reason !== null}
                title={reason ?? m.rules?.join('；') ?? undefined}
              >
                {modelLabelZh(m)}
              </option>
            );
          })}
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
      {note ? <div className="studio-node-cost studio-node-note">{note}</div> : null}
      {currentReason ? (
        <div className="studio-node-cost studio-node-note">{currentReason}，请更换模型</div>
      ) : null}
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
