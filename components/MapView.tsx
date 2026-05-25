'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  HEX,
  hexCenter,
  worldPixelSize,
  renderWorldTerrain,
  drawBranchMarker,
  drawHexRing,
} from '@/lib/renderer';
import type { World, Placement } from '@/lib/types';

const { HEX_H } = HEX;

// Status → marker color
const STATUS_DOT: Record<string, string> = {
  open: '#3a82c4',
  draft: '#9a8a6a',
  merged: '#7aa648',
  stale: '#7d7569',
  protected: '#d4a23a',
  release: '#9a5ac4',
};

interface ViewState {
  x: number;
  y: number;
  scale: number;
}

interface ViewportSize {
  w: number;
  h: number;
}

interface RegionData {
  label?: string;
  center?: [number, number];
}

interface MapViewProps {
  world: World | null;
  selectedBranch: string | null;
  hoveredBranch: string | null;
  onSelect: (name: string | null) => void;
  onHover: (name: string | null) => void;
  showLabels: boolean;
  dimmedBranches: Set<string>;
  focusBranch: string | null;
  viewportSize: ViewportSize | null;
  currentCheckout: string | undefined;
  regions: Record<string, RegionData>;
}

export default function MapView({
  world,
  selectedBranch,
  hoveredBranch,
  onSelect,
  onHover,
  showLabels,
  dimmedBranches,
  focusBranch,
  viewportSize,
  currentCheckout,
  regions,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const [terrainCanvas, setTerrainCanvas] = useState<HTMLCanvasElement | null>(null);

  const [view, setView] = useState<ViewState>({ x: 0, y: 0, scale: 1.0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const dragRef = useRef<{ startX: number; startY: number; vx: number; vy: number; moved: boolean } | null>(null);

  const clampView = useCallback(
    (v: ViewState): ViewState => {
      if (!viewportSize) return v;
      const ws = worldPixelSize();
      const sw = ws.w * v.scale;
      const sh = ws.h * v.scale;
      let minX: number, maxX: number, minY: number, maxY: number;
      if (sw >= viewportSize.w) {
        minX = viewportSize.w - sw;
        maxX = 0;
      } else {
        minX = maxX = (viewportSize.w - sw) / 2;
      }
      if (sh >= viewportSize.h) {
        minY = viewportSize.h - sh;
        maxY = 0;
      } else {
        minY = maxY = (viewportSize.h - sh) / 2;
      }
      return {
        ...v,
        x: Math.max(minX, Math.min(maxX, v.x)),
        y: Math.max(minY, Math.min(maxY, v.y)),
      };
    },
    [viewportSize?.w, viewportSize?.h] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const setViewClamped = useCallback(
    (updater: ViewState | ((prev: ViewState) => ViewState)) => {
      setView((prev) =>
        clampView(typeof updater === 'function' ? updater(prev) : updater)
      );
    },
    [clampView]
  );

  // Pre-render terrain once
  useEffect(() => {
    if (!world) return;
    const t0 = performance.now();
    const c = renderWorldTerrain(world);
    setTerrainCanvas(c);
    console.log('terrain rendered in', (performance.now() - t0).toFixed(0), 'ms');
  }, [world]);

  // Initial view: fit the world to the viewport
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!world || !viewportSize || initialized) return;
    const ws = worldPixelSize();
    const fitScale = Math.min(viewportSize.w / ws.w, viewportSize.h / ws.h) * 0.95;
    const initScale = Math.max(0.5, fitScale);
    const sw = ws.w * initScale;
    const sh = ws.h * initScale;
    setViewClamped({
      x: (viewportSize.w - sw) / 2,
      y: (viewportSize.h - sh) / 2,
      scale: initScale,
    });
    setInitialized(true);
  }, [world, viewportSize?.w, viewportSize?.h, initialized]); // eslint-disable-line react-hooks/exhaustive-deps

  // Smooth fly-to when focusBranch changes
  useEffect(() => {
    if (!focusBranch || !world || !viewportSize) return;
    const placement = world.placements.find((p) => p.branch.name === focusBranch);
    if (!placement) return;
    const [cx, cy] = hexCenter(placement.hx, placement.hy);
    const targetScale = Math.max(2.5, viewRef.current.scale);
    const target = {
      x: viewportSize.w / 2 - cx * targetScale,
      y: viewportSize.h / 2 - cy * targetScale,
      scale: targetScale,
    };
    animateView(target, 600);
  }, [focusBranch, world, viewportSize?.w, viewportSize?.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const animRef = useRef<number | null>(null);
  function animateView(target: ViewState, duration: number) {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const start = { ...viewRef.current };
    const t0 = performance.now();
    function tick() {
      const t = Math.min(1, (performance.now() - t0) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      setViewClamped({
        x: start.x + (target.x - start.x) * ease,
        y: start.y + (target.y - start.y) * ease,
        scale: start.scale + (target.scale - start.scale) * ease,
      });
      if (t < 1) animRef.current = requestAnimationFrame(tick);
    }
    animRef.current = requestAnimationFrame(tick);
  }

  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (dragRef.current) {
      const drag = dragRef.current;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      setViewClamped((v) => ({ ...v, x: drag.vx + dx, y: drag.vy + dy }));
    } else {
      const rect = containerRef.current!.getBoundingClientRect();
      const px = (e.clientX - rect.left - view.x) / view.scale;
      const py = (e.clientY - rect.top - view.y) / view.scale;
      const hit = pickBranch(world, px, py);
      onHover(hit?.branch.name || null);
    }
  };
  const onMouseUp = (e: React.MouseEvent) => {
    const wasDrag = dragRef.current?.moved;
    dragRef.current = null;
    if (wasDrag) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const px = (e.clientX - rect.left - view.x) / view.scale;
    const py = (e.clientY - rect.top - view.y) / view.scale;
    const hit = pickBranch(world, px, py);
    onSelect(hit?.branch.name || null);
  };
  const onMouseLeave = () => {
    dragRef.current = null;
    onHover(null);
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    zoomAt(mx, my, -Math.sign(e.deltaY) * 0.15);
  };

  const scaleBounds = useMemo(() => {
    if (!viewportSize) return { min: 0.5, max: 8 };
    const ws = worldPixelSize();
    const fit = Math.min(viewportSize.w / ws.w, viewportSize.h / ws.h);
    return { min: Math.max(0.4, fit), max: 8 };
  }, [viewportSize?.w, viewportSize?.h]); // eslint-disable-line react-hooks/exhaustive-deps

  function zoomAt(mx: number, my: number, delta: number) {
    setViewClamped((v) => {
      const newScale = Math.max(scaleBounds.min, Math.min(scaleBounds.max, v.scale * (1 + delta)));
      const k = newScale / v.scale;
      return { x: mx - (mx - v.x) * k, y: my - (my - v.y) * k, scale: newScale };
    });
  }

  // Listen for zoom-control button events
  useEffect(() => {
    function onZoomEvt(e: Event) {
      if (!containerRef.current || !viewportSize) return;
      const rect = containerRef.current.getBoundingClientRect();
      const mx = rect.width / 2;
      const my = rect.height / 2;
      const factor = (e as CustomEvent).detail.factor;
      setViewClamped((v) => {
        const newScale = Math.max(scaleBounds.min, Math.min(scaleBounds.max, v.scale * factor));
        const k = newScale / v.scale;
        return { x: mx - (mx - v.x) * k, y: my - (my - v.y) * k, scale: newScale };
      });
    }
    window.addEventListener('codemap-zoom', onZoomEvt);
    return () => window.removeEventListener('codemap-zoom', onZoomEvt);
  }, [viewportSize?.w, viewportSize?.h, scaleBounds.min, scaleBounds.max]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render overlay (icons + selection ring) every frame the view changes
  useEffect(() => {
    if (!world || !overlayCanvasRef.current || !viewportSize) return;
    const cv = overlayCanvasRef.current;
    const ws = worldPixelSize();
    cv.width = ws.w;
    cv.height = ws.h;
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);

    for (const p of world.placements) {
      const [cx, cy] = hexCenter(p.hx, p.hy);
      const dim = dimmedBranches && dimmedBranches.has(p.branch.name);
      ctx.globalAlpha = dim ? 0.22 : 1.0;
      const color = STATUS_DOT[p.branch.status] || '#888';
      drawBranchMarker(ctx, cx, cy, color);
    }
    ctx.globalAlpha = 1;

    if (hoveredBranch && hoveredBranch !== selectedBranch) {
      const p = world.placements.find((x) => x.branch.name === hoveredBranch);
      if (p) {
        const [cx, cy] = hexCenter(p.hx, p.hy);
        drawHexRing(ctx, cx, cy, '#ffffff');
      }
    }

    if (currentCheckout) {
      const p = world.placements.find((x) => x.branch.name === currentCheckout);
      if (p && p.branch.name !== selectedBranch) {
        const [cx, cy] = hexCenter(p.hx, p.hy);
        const pinX = Math.round(cx);
        const pinY = Math.round(cy) - HEX_H / 2 - 4;
        ctx.fillStyle = '#b8442a';
        ctx.fillRect(pinX, pinY - 6, 1, 4);
        ctx.fillRect(pinX - 1, pinY - 8, 3, 2);
        ctx.fillRect(pinX, pinY - 9, 1, 1);
        drawHexRing(ctx, cx, cy, '#b8442a');
      }
    }

    if (selectedBranch) {
      const p = world.placements.find((x) => x.branch.name === selectedBranch);
      if (p) {
        const [cx, cy] = hexCenter(p.hx, p.hy);
        drawHexRing(ctx, cx, cy, '#ffe14a');
      }
    }
  }, [world, view, hoveredBranch, selectedBranch, showLabels, dimmedBranches, currentCheckout]); // eslint-disable-line react-hooks/exhaustive-deps

  // DOM labels
  const labels = useMemo(() => {
    if (!world || !showLabels) return [];
    const out: Array<{
      name: string;
      label: string;
      x: number;
      y: number;
      major: boolean;
      selected: boolean;
      hovered: boolean;
      dim: boolean;
    }> = [];
    for (const p of world.placements) {
      if (!shouldShowLabel(p, view.scale, selectedBranch, hoveredBranch, dimmedBranches, currentCheckout))
        continue;
      const [cx, cy] = hexCenter(p.hx, p.hy);
      const sx = cx * view.scale + view.x;
      const sy = cy * view.scale + view.y;
      const dim = dimmedBranches && dimmedBranches.has(p.branch.name);
      out.push({
        name: p.branch.name,
        label: shortLabel(p.branch.name),
        x: sx,
        y: sy + HEX_H * view.scale * 0.45,
        major:
          p.branch.status === 'protected' ||
          p.branch.status === 'release' ||
          p.branch.name === currentCheckout,
        selected: p.branch.name === selectedBranch,
        hovered: p.branch.name === hoveredBranch,
        dim,
      });
    }
    return out;
  }, [world, view, hoveredBranch, selectedBranch, showLabels, dimmedBranches, currentCheckout]);

  // High-level region labels — positioned at region center or centroid of placements
  const regionLabels = useMemo(() => {
    if (!regions || !viewportSize) return [];
    const ws = worldPixelSize();
    const out: Array<{ key: string; label: string; x: number; y: number }> = [];

    // Compute centroids from placements as fallback for missing centers
    const centroids: Record<string, { sx: number; sy: number; n: number }> = {};
    if (world) {
      for (const p of world.placements) {
        const rk = p.branch.region;
        if (!centroids[rk]) centroids[rk] = { sx: 0, sy: 0, n: 0 };
        const c = hexCenter(p.hx, p.hy);
        centroids[rk].sx += c[0];
        centroids[rk].sy += c[1];
        centroids[rk].n++;
      }
    }

    for (const [key, r] of Object.entries(regions)) {
      let wx: number, wy: number;
      if (r.center) {
        wx = r.center[0] * ws.w;
        wy = r.center[1] * ws.h;
      } else if (centroids[key] && centroids[key].n > 0) {
        wx = centroids[key].sx / centroids[key].n;
        wy = centroids[key].sy / centroids[key].n;
      } else {
        continue;
      }
      const sx = wx * view.scale + view.x;
      const sy = wy * view.scale + view.y;
      out.push({ key, label: r.label || key, x: sx, y: sy });
    }
    return out;
  }, [regions, world, view, viewportSize]);

  if (!world || !terrainCanvas) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#666',
          fontFamily: 'ui-monospace, monospace',
          fontSize: 12,
        }}
      >
        generating world…
      </div>
    );
  }

  const ws = worldPixelSize();
  const cursor = dragRef.current ? 'grabbing' : hoveredBranch ? 'pointer' : 'grab';

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: '#1a3a66',
        cursor,
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onWheel={onWheel}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: ws.w,
          height: ws.h,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transformOrigin: '0 0',
          imageRendering: 'pixelated',
          willChange: 'transform',
        }}
      >
        <CanvasMirror canvas={terrainCanvas} />
        <canvas
          ref={overlayCanvasRef}
          width={ws.w}
          height={ws.h}
          style={{ position: 'absolute', left: 0, top: 0, imageRendering: 'pixelated' }}
        />
      </div>

      {/* Region labels */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {regionLabels.map((rl) => (
          <div
            key={rl.key}
            className="cm-region-label"
            style={{
              left: rl.x,
              top: rl.y,
              fontSize: Math.max(11, Math.min(26, view.scale * 8)),
              opacity: Math.min(0.85, Math.max(0.2, 1.6 - view.scale * 0.35)),
            }}
          >
            {rl.label}
          </div>
        ))}
      </div>

      {/* Branch labels */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {labels.map((l) => (
          <div
            key={l.name}
            className={
              'cm-label' +
              (l.major ? ' cm-label--major' : '') +
              (l.selected ? ' cm-label--selected' : '') +
              (l.dim ? ' cm-label--dim' : '')
            }
            style={{ left: l.x, top: l.y }}
          >
            {l.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function pickBranch(world: World | null, px: number, py: number): Placement | null {
  if (!world) return null;
  let best: Placement | null = null;
  let bestD = Infinity;
  for (const p of world.placements) {
    const [cx, cy] = hexCenter(p.hx, p.hy);
    const dx = px - cx,
      dy = py - cy;
    const d = dx * dx + dy * dy;
    if (d < 100 && d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

function shortLabel(name: string): string {
  const idx = name.indexOf('/');
  if (idx < 0) return name;
  return name.slice(idx + 1);
}

function shouldShowLabel(
  placement: Placement,
  scale: number,
  selected: string | null,
  hovered: string | null,
  dimmed: Set<string>,
  currentCheckout: string | undefined
): boolean {
  if (placement.branch.status === 'protected' || placement.branch.status === 'release') return true;
  if (placement.branch.name === currentCheckout) return true;
  if (placement.branch.name === selected) return true;
  if (placement.branch.name === hovered) return true;
  if (dimmed && dimmed.size > 0 && !dimmed.has(placement.branch.name)) return true;
  if (scale >= 3.2) return true;
  if (scale >= 2.0) return placement.isFirstInRegion === true;
  return false;
}

function CanvasMirror({ canvas }: { canvas: HTMLCanvasElement }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current || !canvas) return;
    ref.current.width = canvas.width;
    ref.current.height = canvas.height;
    const ctx = ref.current.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0);
  }, [canvas]);
  return (
    <canvas
      ref={ref}
      style={{ position: 'absolute', left: 0, top: 0, imageRendering: 'pixelated' }}
    />
  );
}
