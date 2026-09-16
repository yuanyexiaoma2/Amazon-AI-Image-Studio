'use client';

/**
 * V2 PR-6 — shared asset upload flow (extracted from the project page).
 * presign → PUT to object storage → complete → poll asset status until
 * READY/REJECTED. Used by the project page and the Studio canvas drop zone.
 */
import { useCallback, useState } from 'react';

export type UploadedAsset = {
  assetId: string;
  /** currentVersionId once inspection assigns one; null while still processing. */
  versionId: string | null;
  /** Last observed asset status (UPLOADING / PROCESSING / READY / REJECTED). */
  status: string;
};

const ACCEPTED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

export const IMAGE_FILE_RE = /\.(png|jpe?g|webp)$/i;

export function useAssetUpload(workspaceId: string | null, projectId: string | null) {
  const [uploading, setUploading] = useState(false);

  const uploadAsset = useCallback(
    async (file: File, onProgress?: (message: string) => void): Promise<UploadedAsset> => {
      if (!workspaceId || !projectId) throw new Error('工作空间尚未就绪');
      setUploading(true);
      try {
        onProgress?.('正在预签名…');
        const mimeType = ACCEPTED_MIME.has(file.type) ? file.type : 'image/png';
        const presign = await fetch(`/api/workspaces/${workspaceId}/uploads/presign`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            projectId,
            filename: file.name,
            mimeType,
            bytes: file.size,
          }),
        });
        const pJson = await presign.json();
        if (!presign.ok) throw new Error(pJson?.error?.message ?? '预签名失败');

        onProgress?.('正在上传到对象存储…');
        const put = await fetch(pJson.uploadUrl, {
          method: 'PUT',
          headers: pJson.headers ?? { 'Content-Type': mimeType },
          body: file,
        });
        if (!put.ok) throw new Error(`S3 PUT 失败：${put.status}`);

        onProgress?.('正在完成并检查…');
        const complete = await fetch(
          `/api/workspaces/${workspaceId}/uploads/${pJson.uploadId}/complete`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ completionKey: `ui-${pJson.uploadId}` }),
          },
        );
        const cJson = await complete.json();
        if (!complete.ok) throw new Error(cJson?.error?.message ?? '完成失败');

        let versionId: string | null = null;
        let status = 'PROCESSING';
        for (let i = 0; i < 30; i++) {
          const res = await fetch(`/api/workspaces/${workspaceId}/assets/${pJson.assetId}`);
          const asset = await res.json();
          if (typeof asset?.status === 'string') status = asset.status;
          if (typeof asset?.currentVersionId === 'string') versionId = asset.currentVersionId;
          if (asset?.status === 'READY' || asset?.status === 'REJECTED') {
            onProgress?.(`素材 ${asset.status}`);
            break;
          }
          await new Promise((r) => setTimeout(r, 500));
        }
        return { assetId: pJson.assetId as string, versionId, status };
      } finally {
        setUploading(false);
      }
    },
    [workspaceId, projectId],
  );

  return { uploadAsset, uploading };
}
