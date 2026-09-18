'use client';

/**
 * 底部浮动提示词条：选中唯一生图卡时绑定它；否则提交时先在视图中心建一张生图卡。
 * 提交 = configure + 单节点 run（由 StudioCanvas 命令层完成）。
 */
import { useEffect, useRef, useState } from 'react';
import { modelLabelZh } from '@/lib/zh-labels';
import type { ModelOptionItem } from './config-options';
import { RESOLUTION_ZH, generateOptionSets, modelDisabledReason } from './generate-options';

export type PromptBarValues = {
  prompt: string;
  modelKey: string;
  ratio: string;
  resolution: string;
  count: string;
};

const COUNT_OPTIONS = ['1', '2', '3', '4'];

export function PromptBar(props: {
  /** 当前绑定的生图卡（选中且唯一）；null = 提交时新建。 */
  bound: { id: string; config: Record<string, unknown> } | null;
  /** 绑定的生图卡是否已连参考图（驱动模型 t2i/i2i 置灰）。 */
  boundHasReferences: boolean;
  models: ModelOptionItem[] | null;
  busy: boolean;
  onSubmit: (values: PromptBarValues, boundId: string | null) => void;
}) {
  const { bound, boundHasReferences, models, busy, onSubmit } = props;
  const [prompt, setPrompt] = useState('');
  const [modelKey, setModelKey] = useState('auto');
  const [ratio, setRatio] = useState('1:1');
  const [resolution, setResolution] = useState('2K');
  const [count, setCount] = useState('2');
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

  const boundId = bound?.id ?? null;
  useEffect(() => {
    if (!bound) {
      setPrompt('');
      setModelKey('auto');
      setRatio('1:1');
      setResolution('2K');
      setCount('2');
      return;
    }
    const cfg = bound.config;
    setPrompt(typeof cfg.prompt === 'string' ? cfg.prompt : '');
    setModelKey(typeof cfg.modelKey === 'string' && cfg.modelKey ? cfg.modelKey : 'auto');
    setRatio(typeof cfg.ratio === 'string' && cfg.ratio ? cfg.ratio : '1:1');
    setResolution(
      typeof cfg.resolution === 'string' && cfg.resolution ? cfg.resolution : '2K',
    );
    setCount(typeof cfg.count === 'number' ? String(cfg.count) : '2');
    // 仅在绑定目标切换时回填，避免打字过程中被外部更新覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundId]);

  const { models: modelOptions, isAuto, current, ratioOptions, resolutionOptions } =
    generateOptionSets(models, modelKey, ratio, resolution);
  const canSubmit = !busy && (boundId !== null || prompt.trim().length > 0);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({ prompt: prompt.trim(), modelKey, ratio, resolution, count }, boundId);
  };

  return (
    <div className="prompt-bar nodrag" onClick={(e) => e.stopPropagation()}>
      <div className="prompt-bar-main">
        <span className="prompt-bar-icon" aria-hidden>
          ✦
        </span>
        <input
          className="prompt-bar-input"
          value={prompt}
          placeholder="描述任何你想要生成的内容"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="button"
          className="prompt-bar-submit"
          disabled={!canSubmit}
          onClick={submit}
          title={boundId ? '生成到选中的生图卡' : '新建一张生图卡并生成'}
        >
          ↑
        </button>
      </div>
      <div className="prompt-bar-row">
        <select
          className="prompt-bar-select"
          value={isAuto ? 'auto' : modelKey}
          onChange={(e) => {
            const key = e.target.value;
            setModelKey(key);
            // 换模型时把不支持的比例/清晰度切到第一可用档
            const m = modelOptions.find((x) => x.key === key);
            if (m?.ratios && m.ratios.length > 0 && !m.ratios.includes(ratio)) {
              setRatio(m.ratios[0] as string);
              flash(`该模型不支持 ${ratio}，已切换到 ${m.ratios[0]}`);
            }
            if (
              m?.resolutionTiers &&
              m.resolutionTiers.length > 0 &&
              !m.resolutionTiers.includes(resolution)
            ) {
              setResolution(m.resolutionTiers[0] as string);
              flash(
                `该模型不支持 ${RESOLUTION_ZH[resolution] ?? resolution}，已切换到 ${m.resolutionTiers[0]}`,
              );
            }
          }}
          title="模型"
        >
          <option value="auto">智能匹配（自动）</option>
          {models !== null && !isAuto && !current && modelKey ? (
            <option value={modelKey}>{modelLabelZh({ key: modelKey })}（不可用）</option>
          ) : null}
          {modelOptions.map((m) => {
            const reason = modelDisabledReason(m, boundHasReferences);
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
        <select
          className="prompt-bar-select"
          value={ratio}
          onChange={(e) => setRatio(e.target.value)}
          title="比例"
        >
          {ratioOptions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <select
          className="prompt-bar-select"
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          title="清晰度"
        >
          {resolutionOptions.map((r) => (
            <option key={r} value={r}>
              {RESOLUTION_ZH[r] ?? r}
            </option>
          ))}
        </select>
        <select
          className="prompt-bar-select"
          value={count}
          onChange={(e) => setCount(e.target.value)}
          title="数量"
        >
          {COUNT_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c} 张
            </option>
          ))}
        </select>
        {boundId ? <span className="prompt-bar-bound faint">已绑定选中的生图卡</span> : null}
      </div>
      {note ? <div className="prompt-bar-note">{note}</div> : null}
    </div>
  );
}
