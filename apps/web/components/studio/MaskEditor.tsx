'use client';

/**
 * W5-03 Mask editor — Canvas brush/erase/size/zoom/undo/preview.
 * Strokes stored as normalized [0,1]×[0,1] (spec §10.4).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type MaskStrokePoint = { x: number; y: number };
export type MaskStroke = {
  tool: 'brush' | 'erase';
  size: number;
  points: MaskStrokePoint[];
  feather?: number;
};

type Props = {
  workspaceId: string;
  assetVersionId: string;
  /** Signed URL of source image (preview). */
  imageUrl: string;
  sourceWidth: number;
  sourceHeight: number;
  maskId?: string | null;
  onSaved?: (maskId: string) => void;
  onClose?: () => void;
};

const PREVIEW = 512;

export function MaskEditor(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<'brush' | 'erase'>('brush');
  const [brushPx, setBrushPx] = useState(24);
  const [zoom, setZoom] = useState(1);
  const [strokes, setStrokes] = useState<MaskStroke[]>([]);
  const [undoStack, setUndoStack] = useState<MaskStroke[][]>([]);
  const [maskId, setMaskId] = useState<string | null>(props.maskId ?? null);
  const [status, setStatus] = useState('就绪');
  const [previewMask, setPreviewMask] = useState(true);
  const drawing = useRef(false);
  const current = useRef<MaskStroke | null>(null);

  const normalizedSize = Math.min(1, Math.max(0.005, brushPx / PREVIEW));

  const redrawOverlay = useCallback(
    (list: MaskStroke[]) => {
      const c = overlayRef.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      if (!previewMask) return;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.globalCompositeOperation = 'destination-out';
      for (const s of list) {
        const r = (s.size * Math.min(c.width, c.height)) / 2;
        ctx.lineWidth = r * 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.beginPath();
        s.points.forEach((p, i) => {
          const x = p.x * c.width;
          const y = p.y * c.height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        if (s.points.length === 1) {
          const p = s.points[0]!;
          ctx.arc(p.x * c.width, p.y * c.height, r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.stroke();
        }
      }
      // Re-paint edit region in tint for visibility
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(80,180,255,0.35)';
      for (const s of list.filter((x) => x.tool === 'brush')) {
        const r = (s.size * Math.min(c.width, c.height)) / 2;
        ctx.lineWidth = r * 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(80,180,255,0.45)';
        ctx.beginPath();
        s.points.forEach((p, i) => {
          const x = p.x * c.width;
          const y = p.y * c.height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        if (s.points.length === 1) {
          const p = s.points[0]!;
          ctx.arc(p.x * c.width, p.y * c.height, r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.stroke();
        }
      }
    },
    [previewMask],
  );

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
    };
    img.src = props.imageUrl;
  }, [props.imageUrl]);

  useEffect(() => {
    redrawOverlay(strokes);
  }, [strokes, redrawOverlay]);

  useEffect(() => {
    // Load existing mask if any
    let canceled = false;
    (async () => {
      if (props.maskId) {
        const res = await fetch(`/api/workspaces/${props.workspaceId}/masks/${props.maskId}`);
        if (!res.ok || canceled) return;
        const json = await res.json();
        if (Array.isArray(json.strokes)) setStrokes(json.strokes);
        setMaskId(json.id);
        return;
      }
      const res = await fetch(
        `/api/workspaces/${props.workspaceId}/asset-versions/${props.assetVersionId}/masks`,
      );
      if (!res.ok || canceled) return;
      const json = await res.json();
      const first = json.items?.[0];
      if (first) {
        setMaskId(first.id);
        setStrokes(first.strokes ?? []);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [props.workspaceId, props.assetVersionId, props.maskId]);

  function pointerToNorm(ev: React.PointerEvent<HTMLCanvasElement>): MaskStrokePoint {
    const c = overlayRef.current!;
    const rect = c.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    const y = (ev.clientY - rect.top) / rect.height;
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    };
  }

  function onPointerDown(ev: React.PointerEvent<HTMLCanvasElement>) {
    ev.currentTarget.setPointerCapture(ev.pointerId);
    drawing.current = true;
    setUndoStack((u) => [...u, strokes]);
    const stroke: MaskStroke = {
      tool,
      size: normalizedSize,
      points: [pointerToNorm(ev)],
    };
    current.current = stroke;
    setStrokes((s) => [...s, stroke]);
  }

  function onPointerMove(ev: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !current.current) return;
    const p = pointerToNorm(ev);
    current.current.points.push(p);
    const cur = current.current;
    setStrokes((s) => {
      const next = s.slice(0, -1);
      next.push({ ...cur, points: [...cur.points] });
      return next;
    });
  }

  function onPointerUp() {
    drawing.current = false;
    current.current = null;
  }

  function undo() {
    setUndoStack((u) => {
      if (u.length === 0) return u;
      const prev = u[u.length - 1]!;
      setStrokes(prev);
      return u.slice(0, -1);
    });
  }

  async function save(andRender: boolean) {
    setStatus('保存中…');
    const body = {
      strokes,
      coordinateSpace: 'normalized_0_1' as const,
      metadata: {
        sourceWidth: props.sourceWidth,
        sourceHeight: props.sourceHeight,
        viewportVersion: 1,
        zoom,
        featherDefault: 0,
      },
    };
    let id = maskId;
    if (!id) {
      const res = await fetch(
        `/api/workspaces/${props.workspaceId}/asset-versions/${props.assetVersionId}/masks`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setStatus(`保存失败：${json?.error?.message ?? res.status}`);
        return;
      }
      id = json.id as string;
      setMaskId(id);
    } else {
      const res = await fetch(`/api/workspaces/${props.workspaceId}/masks/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setStatus(`保存失败：${json?.error?.message ?? res.status}`);
        return;
      }
    }
    if (andRender && id) {
      setStatus('正在渲染全分辨率蒙版…');
      const res = await fetch(`/api/workspaces/${props.workspaceId}/masks/${id}/render`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) {
        setStatus(`渲染失败：${json?.error?.message ?? res.status}`);
        return;
      }
      setStatus(`已保存并渲染 ${json.width}×${json.height}`);
    } else {
      setStatus(`已保存蒙版 ${id?.slice(0, 8)}…`);
    }
    if (id) props.onSaved?.(id);
  }

  const size = Math.round(PREVIEW * zoom);

  return (
    <div
      className="stack"
      style={{
        gap: 'var(--space-2)',
        padding: 'var(--space-3)',
        background: 'var(--panel)',
        border: '1px solid var(--border-strong)',
        borderRadius: 'var(--radius-lg)',
        color: 'var(--text)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>蒙版编辑器</strong>
        {props.onClose ? (
          <button type="button" className="btn" onClick={props.onClose}>
            关闭
          </button>
        ) : null}
      </div>
      <div className="row" style={{ fontSize: 'var(--font-size-sm)' }}>
        <button
          type="button"
          className="btn"
          onClick={() => setTool('brush')}
          style={{ outline: tool === 'brush' ? '2px solid var(--focus)' : undefined }}
        >
          画笔
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => setTool('erase')}
          style={{ outline: tool === 'erase' ? '2px solid var(--focus)' : undefined }}
        >
          擦除
        </button>
        <label>
          大小{' '}
          <input
            type="range"
            min={4}
            max={96}
            value={brushPx}
            onChange={(e) => setBrushPx(Number(e.target.value))}
          />
        </label>
        <label>
          缩放{' '}
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={previewMask}
            onChange={(e) => setPreviewMask(e.target.checked)}
          />{' '}
          预览
        </label>
        <button type="button" className="btn" onClick={undo}>
          撤销
        </button>
        <button type="button" className="btn" onClick={() => void save(false)}>
          保存
        </button>
        <button type="button" className="btn" onClick={() => void save(true)}>
          保存并渲染
        </button>
      </div>
      <div
        style={{
          width: size,
          height: size,
          position: 'relative',
          overflow: 'hidden',
          border: '1px solid var(--border-canvas)',
          cursor: tool === 'brush' ? 'crosshair' : 'cell',
        }}
      >
        <canvas
          ref={canvasRef}
          width={PREVIEW}
          height={PREVIEW}
          style={{ width: size, height: size, position: 'absolute', inset: 0 }}
        />
        <canvas
          ref={overlayRef}
          width={PREVIEW}
          height={PREVIEW}
          style={{ width: size, height: size, position: 'absolute', inset: 0 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
      <div className="muted" style={{ fontSize: 'var(--font-size-xs)' }}>
        参考图 {props.sourceWidth}×{props.sourceHeight} · 笔划 {strokes.length} ·{' '}
        {maskId ? `蒙版 ${maskId.slice(0, 8)}…` : '未保存'} · {status}
      </div>
    </div>
  );
}
