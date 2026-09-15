'use client';

/**
 * V2 PR-1 — asset version thumbnail / preview <img> on a signed URL.
 * Native <img> (MinIO hosts are dynamic, so next/image remotePatterns
 * would be brittle). Falls back to a gray well on load/error.
 */
import { useState } from 'react';
import { useAssetImage, type AssetImageKind } from '@/lib/use-asset-image';

export function AssetImage(props: {
  workspaceId: string | null;
  versionId: string | null;
  kind?: AssetImageKind;
  size?: number;
  alt?: string;
  className?: string;
}) {
  const { workspaceId, versionId, kind = 'THUMBNAIL_WEBP', size = 48, alt = '' } = props;
  const { url, loading, error } = useAssetImage(workspaceId, versionId, kind);
  const [broken, setBroken] = useState(false);

  const failed = Boolean(error) || broken;
  return (
    <span
      className={props.className ?? 'thumb'}
      style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
      title={failed ? (error ?? '图像加载失败') : alt}
    >
      {url && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          width={size}
          height={size}
          loading="lazy"
          style={{ objectFit: 'contain', width: '100%', height: '100%' }}
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="faint" style={{ fontSize: 'var(--font-size-xs)' }}>
          {loading ? '…' : failed ? '✕' : '—'}
        </span>
      )}
    </span>
  );
}
