'use client';

/**
 * V2 PR-2 — extracted properties panel. UUID text inputs are replaced
 * by plain <select> dropdowns fed by useConfigOptions; executable nodes get
 * a "运行此节点" button that dispatches a scoped `run` command.
 * V2 PR-1 — styling moved to globals.css token classes (`.btn` / `.input`).
 */
import { useMemo } from 'react';
import { MaskEditor } from './MaskEditor';
import {
  CONFIG_FIELD_META,
  OPTION_LABEL_ZH,
  RUNNABLE_NODE_TYPES,
  buildAssetOptions,
  buildBriefOptions,
  buildMaskOptions,
  buildModelOptions,
  buildTruthOptions,
  withCurrentOption,
  type ConfigFieldMeta,
  type SelectOption,
} from './config-options';
import type { ConfigOptionsData } from './use-config-options';

export type SelectedNodeInfo = {
  id: string;
  nodeType: string;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
};

export type MaskEditorState = {
  imageUrl: string;
  versionId: string;
  width: number;
  height: number;
} | null;

function hintFor(
  field: ConfigFieldMeta,
  options: ConfigOptionsData,
  sourceAssetVersionId: string | null,
): string | null {
  switch (field.source) {
    case 'assets':
      if (options.assets === null) return '素材加载中…';
      if (options.assets.length === 0)
        return '该项目还没有可用素材版本 — 请先在项目页上传素材。';
      return null;
    case 'truthRevision':
      if (options.truthRevision === undefined) return 'Truth Pack 加载中…';
      if (options.truthRevision === null)
        return '尚无 Truth Pack 修订 — 请先在项目页抽取。';
      return null;
    case 'shotBriefs':
      if (options.briefs === null) return 'Shot Plan 加载中…';
      if (options.briefs.length === 0)
        return '该项目尚无 Shot Plan — 请先在项目页生成 7 镜计划。';
      return null;
    case 'masks':
      if (!sourceAssetVersionId)
        return '请先在 source_image 节点选择素材版本，蒙版列表随其联动。';
      if (options.masks === null) return '蒙版加载中…';
      if (options.masks.length === 0)
        return '该素材版本还没有蒙版 — 请用蒙版编辑器创建。';
      return null;
    case 'models':
      if (options.models === null) return '模型注册表加载中…';
      if (options.models.length === 0) return '模型注册表为空。';
      return null;
    default:
      return null;
  }
}

export function PropertiesPanel(props: {
  workspaceId: string;
  selected: SelectedNodeInfo | null;
  options: ConfigOptionsData;
  sourceAssetVersionId: string | null;
  draftRevision: number | null;
  runBusy: boolean;
  onConfigChange: (key: string, raw: string) => void;
  onRunNode: (nodeId: string) => void;
  onOpenMaskEditor: () => void;
  maskEditor: MaskEditorState;
  maskEditorMaskId: string | null;
  onMaskSaved: (maskId: string) => void;
  onMaskClose: () => void;
}) {
  const {
    workspaceId,
    selected,
    options,
    sourceAssetVersionId,
    draftRevision,
    runBusy,
    onConfigChange,
    onRunNode,
    onOpenMaskEditor,
    maskEditor,
    maskEditorMaskId,
    onMaskSaved,
    onMaskClose,
  } = props;

  const optionLists = useMemo(() => {
    return {
      assets: buildAssetOptions(options.assets ?? []),
      truthRevision: buildTruthOptions(options.truthRevision ?? null),
      shotBriefs: buildBriefOptions(options.briefs ?? []),
      masks: buildMaskOptions(options.masks ?? []),
      models: options.models ?? [],
    };
  }, [options.assets, options.truthRevision, options.briefs, options.masks, options.models]);

  function asyncOptions(field: ConfigFieldMeta): SelectOption[] {
    if (field.source === 'models') {
      return buildModelOptions(optionLists.models, field.modelOperation);
    }
    if (!field.source) return [];
    return optionLists[field.source];
  }

  const fields = selected ? (CONFIG_FIELD_META[selected.nodeType] ?? []) : [];
  const runnable = selected ? RUNNABLE_NODE_TYPES.has(selected.nodeType) : false;

  return (
    <>
      <div style={{ fontWeight: 700, marginBottom: 'var(--space-2)' }}>节点属性</div>
      {!selected ? (
        <p className="faint" style={{ fontSize: 'var(--font-size-md)' }}>
          选择节点以编辑其 Zod 配置外壳（仅 Fake — 不调用 Provider）。
        </p>
      ) : (
        <div style={{ fontSize: 'var(--font-size-md)' }}>
          <div>
            <strong>{selected.label}</strong>
          </div>
          <div className="muted">类型：{selected.nodeType}</div>
          <div className="muted">
            位置：{Math.round(selected.position.x)}, {Math.round(selected.position.y)}
          </div>
          {runnable && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn"
                disabled={runBusy}
                onClick={() => onRunNode(selected.id)}
              >
                {runBusy ? '启动中…' : '运行此节点（Fake · 预算 $5）'}
              </button>
            </div>
          )}
          <div className="stack" style={{ marginTop: 'var(--space-3)', gap: 'var(--space-2)' }}>
            {fields.map((f) => {
              const current =
                selected.config[f.key] === null || selected.config[f.key] === undefined
                  ? ''
                  : String(selected.config[f.key]);
              if (f.kind === 'async') {
                const opts = withCurrentOption(asyncOptions(f), current);
                const hint = hintFor(f, options, sourceAssetVersionId);
                const disabled = f.source === 'masks' && !sourceAssetVersionId;
                return (
                  <label key={f.key} className="stack" style={{ gap: 'var(--space-1)', fontSize: 'var(--font-size-sm)' }}>
                    <span className="muted">{f.label}</span>
                    <select
                      className="input"
                      value={current}
                      disabled={disabled}
                      onChange={(e) => onConfigChange(f.key, e.target.value)}
                    >
                      <option value="">（未选择）</option>
                      {opts.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {hint && <span className="faint" style={{ fontSize: 'var(--font-size-xs)' }}>{hint}</span>}
                  </label>
                );
              }
              return (
                <label key={f.key} className="stack" style={{ gap: 'var(--space-1)', fontSize: 'var(--font-size-sm)' }}>
                  <span className="muted">{f.label}</span>
                  {f.kind === 'select' ? (
                    <select
                      className="input"
                      value={current}
                      onChange={(e) => onConfigChange(f.key, e.target.value)}
                    >
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {OPTION_LABEL_ZH[o] ?? o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="input"
                      type={f.kind === 'number' ? 'number' : 'text'}
                      value={current}
                      onChange={(e) => onConfigChange(f.key, e.target.value)}
                    />
                  )}
                </label>
              );
            })}
          </div>
          <pre className="code-block" style={{ opacity: 0.8, marginTop: 'var(--space-3)' }}>
            {JSON.stringify(selected.config, null, 2)}
          </pre>
          {(selected.nodeType === 'source_image' ||
            selected.nodeType === 'replace_background' ||
            selected.nodeType === 'inpaint') && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <button type="button" className="btn" onClick={onOpenMaskEditor}>
                打开蒙版编辑器
              </button>
              <div className="faint" style={{ fontSize: 'var(--font-size-xs)', marginTop: 'var(--space-1)' }}>
                蒙版基于 source_image 的素材版本；保存后可在 replace_background / inpaint 的蒙版下拉中选择。
              </div>
            </div>
          )}
        </div>
      )}
      {maskEditor ? (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <MaskEditor
            workspaceId={workspaceId}
            assetVersionId={maskEditor.versionId}
            imageUrl={maskEditor.imageUrl}
            sourceWidth={maskEditor.width}
            sourceHeight={maskEditor.height}
            maskId={maskEditorMaskId}
            onSaved={onMaskSaved}
            onClose={onMaskClose}
          />
        </div>
      ) : null}
      <div className="faint" style={{ marginTop: 'var(--space-6)', fontSize: 'var(--font-size-xs)' }}>
        草稿修订：{draftRevision ?? '—'}
        <br />
        变更经命令 API 同步 · 撤销/重做为服务端批次 · isValidConnection 预览
      </div>
    </>
  );
}
