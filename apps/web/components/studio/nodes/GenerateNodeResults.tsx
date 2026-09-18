'use client';

import { AssetImage } from '../../asset-image';

/** 生成节点结果缩略图：一行图，点击在新标签页打开大图（预签名 URL）。 */
export function GenerateNodeResults(props: {
  workspaceId: string | null;
  versionIds: string[];
  size?: number;
}) {
  const { workspaceId, versionIds, size = 40 } = props;
  if (versionIds.length === 0) return null;

  const openLarge = (versionId: string) => {
    if (!workspaceId) return;
    void fetch(
      `/api/workspaces/${workspaceId}/asset-versions/${versionId}/download-url?kind=NORMALIZED_PNG`,
      { credentials: 'include' },
    )
      .then(async (res) => {
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        if (json?.url) window.open(json.url as string, '_blank', 'noopener');
      })
      .catch(() => undefined);
  };

  return (
    <div
      className="studio-node-results nodrag"
      style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}
      onClick={(e) => e.stopPropagation()}
    >
      {versionIds.map((id) => (
        <button
          key={id}
          type="button"
          title="点击看大图"
          style={{ border: 'none', background: 'none', padding: 0, cursor: 'zoom-in' }}
          onClick={() => openLarge(id)}
        >
          <AssetImage workspaceId={workspaceId} versionId={id} size={size} alt="生成结果" />
        </button>
      ))}
    </div>
  );
}
