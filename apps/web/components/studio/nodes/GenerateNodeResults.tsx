'use client';

import { AssetImage } from '../../asset-image';

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || '生成结果';
}

/** 生成节点结果缩略图：点击在新标签页打开大图；hover 右上角「下载」直接存图。 */
export function GenerateNodeResults(props: {
  workspaceId: string | null;
  versionIds: string[];
  size?: number;
  /** 下载文件名前缀（节点标题），默认「生成结果」。 */
  nameBase?: string;
}) {
  const { workspaceId, versionIds, size = 40, nameBase = '生成结果' } = props;
  if (versionIds.length === 0) return null;

  const fetchUrl = async (versionId: string): Promise<string | null> => {
    if (!workspaceId) return null;
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/asset-versions/${versionId}/download-url?kind=NORMALIZED_PNG`,
        { credentials: 'include' },
      );
      if (!res.ok) return null;
      const json = await res.json().catch(() => null);
      return typeof json?.url === 'string' ? (json.url as string) : null;
    } catch {
      return null;
    }
  };

  const openLarge = (versionId: string) => {
    void fetchUrl(versionId).then((url) => {
      if (url) window.open(url, '_blank', 'noopener');
    });
  };

  const download = (versionId: string, index: number) => {
    void fetchUrl(versionId).then((url) => {
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sanitizeFilename(nameBase)}-${index + 1}.png`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  };

  return (
    <div
      className="studio-node-results nodrag"
      style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}
      onClick={(e) => e.stopPropagation()}
    >
      {versionIds.map((id, i) => (
        <span key={id} className="studio-result-thumb">
          <button
            type="button"
            title="点击看大图"
            style={{ border: 'none', background: 'none', padding: 0, cursor: 'zoom-in' }}
            onClick={() => openLarge(id)}
          >
            <AssetImage workspaceId={workspaceId} versionId={id} size={size} alt="生成结果" />
          </button>
          <button
            type="button"
            className="studio-result-download"
            title={`下载 ${nameBase}-${i + 1}.png`}
            aria-label="下载图片"
            onClick={(e) => {
              e.stopPropagation();
              download(id, i);
            }}
          >
            ⤓
          </button>
        </span>
      ))}
    </div>
  );
}
