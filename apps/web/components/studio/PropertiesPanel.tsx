'use client';

/**
 * V2 PR-2 — extracted properties panel (no visual redesign; same inline
 * styles as the legacy aside in StudioCanvas). UUID text inputs are replaced
 * by plain <select> dropdowns fed by useConfigOptions; executable nodes get
 * a "运行此节点" button that dispatches a scoped `run` command.
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

const inputStyle = {
  background: '#0b1020',
  color: '#e8eefc',
  border: '1px solid #2a3a5a',
  borderRadius: 4,
  padding: 4,
} as const;

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
      <div style={{ fontWeight: 700, marginBottom: 8 }}>节点属性</div>
      {!selected ? (
        <p style={{ opacity: 0.65, fontSize: 13 }}>
          选择节点以编辑其 Zod 配置外壳（仅 Fake — 不调用 Provider）。
        </p>
      ) : (
        <div style={{ fontSize: 13 }}>
          <div>
            <strong>{selected.label}</strong>
          </div>
          <div style={{ opacity: 0.7 }}>类型：{selected.nodeType}</div>
          <div style={{ opacity: 0.7 }}>
            位置：{Math.round(selected.position.x)}, {Math.round(selected.position.y)}
          </div>
          {runnable && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                disabled={runBusy}
                onClick={() => onRunNode(selected.id)}
                style={{
                  background: '#121a2e',
                  border: '1px solid #2a3a5a',
                  color: '#e8eefc',
                  borderRadius: 6,
                  padding: '6px 10px',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                {runBusy ? '启动中…' : '运行此节点（Fake · 预算 $5）'}
              </button>
            </div>
          )}
          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
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
                  <label key={f.key} style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                    <span style={{ opacity: 0.8 }}>{f.label}</span>
                    <select
                      value={current}
                      disabled={disabled}
                      onChange={(e) => onConfigChange(f.key, e.target.value)}
                      style={inputStyle}
                    >
                      <option value="">（未选择）</option>
                      {opts.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {hint && <span style={{ fontSize: 11, opacity: 0.6 }}>{hint}</span>}
                  </label>
                );
              }
              return (
                <label key={f.key} style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                  <span style={{ opacity: 0.8 }}>{f.label}</span>
                  {f.kind === 'select' ? (
                    <select
                      value={current}
                      onChange={(e) => onConfigChange(f.key, e.target.value)}
                      style={inputStyle}
                    >
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {OPTION_LABEL_ZH[o] ?? o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={f.kind === 'number' ? 'number' : 'text'}
                      value={current}
                      onChange={(e) => onConfigChange(f.key, e.target.value)}
                      style={inputStyle}
                    />
                  )}
                </label>
              );
            })}
          </div>
          <pre style={{ fontSize: 11, opacity: 0.8, whiteSpace: 'pre-wrap', marginTop: 12 }}>
            {JSON.stringify(selected.config, null, 2)}
          </pre>
          {(selected.nodeType === 'source_image' ||
            selected.nodeType === 'replace_background' ||
            selected.nodeType === 'inpaint') && (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                onClick={onOpenMaskEditor}
                style={{
                  background: '#121a2e',
                  border: '1px solid #2a3a5a',
                  color: '#e8eefc',
                  borderRadius: 6,
                  padding: '6px 10px',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                打开蒙版编辑器
              </button>
              <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>
                蒙版基于 source_image 的素材版本；保存后可在 replace_background / inpaint 的蒙版下拉中选择。
              </div>
            </div>
          )}
        </div>
      )}
      {maskEditor ? (
        <div style={{ marginTop: 16 }}>
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
      <div style={{ marginTop: 24, fontSize: 11, opacity: 0.65 }}>
        草稿修订：{draftRevision ?? '—'}
        <br />
        变更经命令 API 同步 · 撤销/重做为服务端批次 · isValidConnection 预览
      </div>
    </>
  );
}
