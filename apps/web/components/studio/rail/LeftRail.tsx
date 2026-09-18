'use client';

/**
 * 左侧窄竖排图标栏（Phase 3 chrome）：＋添加 / 🖼 素材库 / 🕘 生成历史 / ❓帮助。
 * 点击图标展开/收起对应的飞出面板；添加与素材均支持拖入画布。
 */
import { useRef, useState, type ReactNode } from 'react';
import { IMAGE_FILE_RE } from '@/lib/use-asset-upload';
import type { AssetOptionItem } from '../config-options';
import { AssetImage } from '../../asset-image';

export type RailPanelKind = 'add' | 'assets' | 'history' | 'help';

const ADD_ITEMS: Array<{ type: string; label: string; desc: string }> = [
  { type: 'prompt', label: '文本', desc: '提示词卡片，可直接编辑' },
  { type: 'source_image', label: '图片', desc: '上传或绑定素材作为参考图' },
  { type: 'generate', label: '生图', desc: '提示词 + 参考图生成新图' },
];

function AssetsFlyout(props: {
  workspaceId: string;
  assets: AssetOptionItem[] | null;
  uploading: boolean;
  onUploadFile: (file: File) => void;
}) {
  const { workspaceId, assets, uploading, onUploadFile } = props;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const ready = (assets ?? []).filter((a) => a.currentVersionId && a.status !== 'ARCHIVED');
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>素材库</strong>
        <button
          type="button"
          className="btn"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? '上传中…' : '上传'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f && IMAGE_FILE_RE.test(f.name)) onUploadFile(f);
          }}
        />
      </div>
      {assets === null ? (
        <div className="faint">正在加载素材…</div>
      ) : ready.length === 0 ? (
        <div className="faint">还没有素材 — 点「上传」或直接把图片文件拖进画布。</div>
      ) : (
        <div className="studio-asset-grid">
          {ready.map((a) => (
            <button
              key={a.id}
              type="button"
              className="studio-asset-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/studio-asset', a.currentVersionId as string);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              title={`${a.originalFilename ?? a.id} — 拖到画布建成图片卡`}
            >
              <AssetImage
                workspaceId={workspaceId}
                versionId={a.currentVersionId}
                size={72}
                alt={a.originalFilename ?? '素材'}
              />
              <span className="studio-asset-name faint">{a.originalFilename ?? a.id.slice(0, 8)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HelpFlyout() {
  return (
    <div className="stack" style={{ fontSize: 'var(--font-size-sm)' }}>
      <strong>帮助</strong>
      <div>· 双击画布空白：在点击处新建文本 / 图片 / 生图卡</div>
      <div>· 卡片边缘「＋」拖出连线，松手在空白处自动生成下游生图卡</div>
      <div>· 底部提示词条：选中一张生图卡后绑定它，否则提交时新建</div>
      <div>· 素材库 / 历史里的图片可以直接拖进画布</div>
      <div>· Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Y 重做，Ctrl/Cmd+C/V 复制粘贴</div>
      <div>· 右侧「画布助手」可以用自然语言让它帮你搭画布</div>
    </div>
  );
}

export function LeftRail(props: {
  panel: RailPanelKind | null;
  onToggle: (kind: RailPanelKind) => void;
  onAddNode: (type: string) => void;
  onAddSuite: (description: string) => void;
  workspaceId: string;
  assets: AssetOptionItem[] | null;
  uploading: boolean;
  onUploadFile: (file: File) => void;
  historyPanel: ReactNode;
}) {
  const { panel, onToggle, onAddNode, onAddSuite, workspaceId, assets, uploading, onUploadFile, historyPanel } =
    props;
  const [suiteText, setSuiteText] = useState('');
  const btn = (kind: RailPanelKind, icon: string, label: string) => (
    <button
      key={kind}
      type="button"
      className={panel === kind ? 'studio-rail-btn studio-rail-btn-active' : 'studio-rail-btn'}
      onClick={() => onToggle(kind)}
      title={label}
      aria-label={label}
      aria-pressed={panel === kind}
    >
      <span aria-hidden>{icon}</span>
    </button>
  );
  return (
    <>
      <nav className="studio-rail" aria-label="画布工具栏">
        {btn('add', '＋', '添加卡片')}
        {btn('assets', '🖼', '素材库')}
        {btn('history', '🕘', '生成历史')}
        {btn('help', '❓', '帮助')}
      </nav>
      {panel ? (
        <div className="studio-flyout" role="dialog" aria-label="左栏面板">
          {panel === 'add' ? (
            <div className="stack">
              <strong>添加卡片</strong>
              {ADD_ITEMS.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  className="studio-flyout-item"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/studio-node', item.type);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onAddNode(item.type)}
                  title="点击加到视图中心，或拖到画布指定位置"
                >
                  <span className="studio-flyout-item-title">{item.label}</span>
                  <span className="studio-flyout-item-desc faint">{item.desc}</span>
                </button>
              ))}
              <div className="studio-suite">
                <span className="studio-flyout-item-title">套装</span>
                <span className="studio-flyout-item-desc faint">
                  一句话描述 → 文本卡 + 白底/场景/细节三张生图卡
                </span>
                <input
                  className="studio-suite-input"
                  value={suiteText}
                  placeholder="例：便携不锈钢保温杯 500ml"
                  maxLength={200}
                  onChange={(e) => setSuiteText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing && suiteText.trim()) {
                      e.preventDefault();
                      onAddSuite(suiteText.trim());
                      setSuiteText('');
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!suiteText.trim()}
                  onClick={() => {
                    onAddSuite(suiteText.trim());
                    setSuiteText('');
                  }}
                >
                  生成套装
                </button>
              </div>
              <div className="faint" style={{ fontSize: 'var(--font-size-xs)' }}>
                也可以双击画布空白处直接创建。
              </div>
            </div>
          ) : null}
          {panel === 'assets' ? (
            <AssetsFlyout
              workspaceId={workspaceId}
              assets={assets}
              uploading={uploading}
              onUploadFile={onUploadFile}
            />
          ) : null}
          {panel === 'history' ? historyPanel : null}
          {panel === 'help' ? <HelpFlyout /> : null}
        </div>
      ) : null}
    </>
  );
}
