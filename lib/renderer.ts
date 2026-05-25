// Pixel-art hex map renderer.
// - Pre-renders the entire terrain to one offscreen canvas (sharp at native res).
// - Displays via CSS transform (pan + scale) with image-rendering: pixelated.
// - Branch icons live in a separate sprite atlas and are drawn each frame on an overlay canvas.

import { BIOMES } from "./mapgen";
import type { World } from "./types";

const HEX_SIZE = 14;
const HEX_W = Math.round(HEX_SIZE * Math.sqrt(3)); // ≈ 24
const HEX_H = HEX_SIZE * 2; // = 28
const HEX_PITCH_X = HEX_W; // 24
const HEX_PITCH_Y = Math.round(HEX_SIZE * 1.5); // = 21
const HEX_OFFSET_X = HEX_W / 2; // 12

export const HEX = { HEX_SIZE, HEX_W, HEX_H, HEX_PITCH_X, HEX_PITCH_Y, HEX_OFFSET_X };

// --- Biome palettes (pixel-art friendly, slightly muted) ---
export const PAL: Record<
  number,
  { fill: string; shade: string; deco: string; outline: string }
> = {
  [BIOMES.DEEP_WATER]: { fill: "#2a5d9f", shade: "#1c4475", deco: "#3d75bd", outline: "#1a3a66" },
  [BIOMES.WATER]:      { fill: "#3a82c4", shade: "#2a6da8", deco: "#5aa0db", outline: "#235487" },
  [BIOMES.SHORE]:      { fill: "#5fa4d8", shade: "#4990c4", deco: "#7fc0e9", outline: "#3a78ad" },
  [BIOMES.BEACH]:      { fill: "#e6d49a", shade: "#cdb87c", deco: "#f2e3b3", outline: "#a89460" },
  [BIOMES.PLAINS]:     { fill: "#8fc967", shade: "#7bb554", deco: "#a3d878", outline: "#5e9237" },
  [BIOMES.FOREST]:     { fill: "#5fa040", shade: "#487f30", deco: "#74b455", outline: "#2f5d1c" },
  [BIOMES.DEEP_FOREST]:{ fill: "#3d7a2a", shade: "#2c5d1e", deco: "#508f38", outline: "#1f4413" },
  [BIOMES.SWAMP]:      { fill: "#5d8a6d", shade: "#456a52", deco: "#789f86", outline: "#2c4434" },
  [BIOMES.DESERT]:     { fill: "#e8c876", shade: "#cfae5b", deco: "#f1d68f", outline: "#a47f3a" },
  [BIOMES.MOUNTAIN]:   { fill: "#9a9286", shade: "#7d7569", deco: "#b2aa9e", outline: "#5a5246" },
  [BIOMES.PEAK]:       { fill: "#bfb8ac", shade: "#a39c90", deco: "#dcd6cb", outline: "#807a6e" },
  [BIOMES.VOLCANIC]:   { fill: "#5d4a44", shade: "#473630", deco: "#75605a", outline: "#2e211c" },
  [BIOMES.LAVA]:       { fill: "#e6532a", shade: "#b53d1c", deco: "#f78a4a", outline: "#7a2510" },
  [BIOMES.FOG]:        { fill: "#7a8090", shade: "#5e6470", deco: "#8e94a0", outline: "#4a5060" },
};

// --- Hex mask: per-row [xLeft, xRight] for clean pixel-aligned hex shape ---
const HEX_MASK: [number, number][] = (() => {
  const m: [number, number][] = [];
  const topRows: [number, number][] = [
    [11, 12], [10, 13], [8, 15], [6, 17], [4, 19], [2, 21], [1, 22],
  ];
  topRows.forEach((r, y) => (m[y] = r));
  for (let y = 7; y <= 20; y++) m[y] = [0, 23];
  for (let y = 21; y <= 27; y++) m[y] = topRows[27 - y];
  return m;
})();

// Convert (col, row) → pixel (cx, cy) of hex center
export function hexCenter(col: number, row: number): [number, number] {
  const cx = col * HEX_PITCH_X + (row % 2 ? HEX_OFFSET_X : 0) + HEX_W / 2;
  const cy = row * HEX_PITCH_Y + HEX_H / 2;
  return [cx, cy];
}

// Convert pixel (px, py) → (col, row). Approximate, snaps to nearest hex.
export function pixelToHex(px: number, py: number, worldW: number, worldH: number): [number, number] {
  let bestCol = 0, bestRow = 0, bestD = Infinity;
  const approxRow = Math.round((py - HEX_H / 2) / HEX_PITCH_Y);
  for (let dr = -1; dr <= 1; dr++) {
    const r = approxRow + dr;
    if (r < 0 || r >= worldH) continue;
    const offset = r % 2 ? HEX_OFFSET_X : 0;
    const approxCol = Math.round((px - offset - HEX_W / 2) / HEX_PITCH_X);
    for (let dc = -1; dc <= 1; dc++) {
      const c = approxCol + dc;
      if (c < 0 || c >= worldW) continue;
      const [cx, cy] = hexCenter(c, r);
      const d = (cx - px) ** 2 + (cy - py) ** 2;
      if (d < bestD) { bestD = d; bestCol = c; bestRow = r; }
    }
  }
  return [bestCol, bestRow];
}

export function worldPixelSize(world: { w: number; h: number }): { w: number; h: number } {
  return {
    w: world.w * HEX_PITCH_X + HEX_OFFSET_X,
    h: world.h * HEX_PITCH_Y + HEX_H - HEX_PITCH_Y,
  };
}

// === Drawing primitives ===

function fillHexAt(ctx: CanvasRenderingContext2D, left: number, top: number, color: string) {
  ctx.fillStyle = color;
  for (let y = 0; y < HEX_H; y++) {
    const [x0, x1] = HEX_MASK[y];
    ctx.fillRect(left + x0, top + y, x1 - x0 + 1, 1);
  }
}

function strokeHexAt(ctx: CanvasRenderingContext2D, left: number, top: number, color: string) {
  ctx.fillStyle = color;
  for (let y = 0; y < HEX_H; y++) {
    const [x0, x1] = HEX_MASK[y];
    const prev = HEX_MASK[y - 1] || ([Infinity, -Infinity] as unknown as [number, number]);
    const [px0, px1] = prev;
    for (let x = x0; x <= x1; x++) {
      const inAbove = x >= px0 && x <= px1;
      if (!inAbove && (y === 0 || x < px0 || x > px1)) {
        ctx.fillRect(left + x, top + y, 1, 1);
      }
    }
    ctx.fillRect(left + x0, top + y, 1, 1);
    ctx.fillRect(left + x1, top + y, 1, 1);
  }
  const [bx0, bx1] = HEX_MASK[HEX_H - 1];
  ctx.fillRect(left + bx0, top + HEX_H - 1, bx1 - bx0 + 1, 1);
}

function tileRand(col: number, row: number, salt = 0): number {
  let h = col * 73856093 ^ row * 19349663 ^ salt * 83492791;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function drawDeco(ctx: CanvasRenderingContext2D, left: number, top: number, biome: number, col: number, row: number) {
  const pal = PAL[biome];
  const r1 = tileRand(col, row, 1);
  const r2 = tileRand(col, row, 2);
  const r3 = tileRand(col, row, 3);

  switch (biome) {
    case BIOMES.FOREST:
    case BIOMES.DEEP_FOREST: {
      const n = biome === BIOMES.DEEP_FOREST ? 3 : 2;
      const spots: [number, number][] = [[8, 10], [14, 8], [11, 14], [6, 14], [16, 13], [9, 17]];
      for (let i = 0; i < n; i++) {
        const s = spots[(Math.floor(r1 * 7) + i) % spots.length];
        const tx = left + s[0], ty = top + s[1];
        ctx.fillStyle = biome === BIOMES.DEEP_FOREST ? "#1f4413" : "#2f5d1c";
        ctx.fillRect(tx, ty, 3, 3);
        ctx.fillRect(tx - 1, ty + 1, 1, 1);
        ctx.fillRect(tx + 3, ty + 1, 1, 1);
        ctx.fillStyle = "#5a3a1d";
        ctx.fillRect(tx + 1, ty + 3, 1, 1);
      }
      break;
    }
    case BIOMES.PLAINS: {
      if (r1 > 0.6) {
        ctx.fillStyle = pal.shade;
        ctx.fillRect(left + 8 + Math.floor(r2 * 8), top + 10 + Math.floor(r3 * 6), 1, 1);
        ctx.fillRect(left + 6 + Math.floor(r3 * 10), top + 14 + Math.floor(r2 * 4), 1, 1);
      }
      if (r2 > 0.85) {
        ctx.fillStyle = r3 > 0.5 ? "#f2d55a" : "#e87aa1";
        ctx.fillRect(left + 10 + Math.floor(r1 * 4), top + 12 + Math.floor(r3 * 3), 1, 1);
      }
      break;
    }
    case BIOMES.WATER:
    case BIOMES.SHORE:
    case BIOMES.DEEP_WATER: {
      ctx.fillStyle = pal.deco;
      const wy = top + 10 + Math.floor(r1 * 6);
      const wx = left + 5 + Math.floor(r2 * 4);
      ctx.fillRect(wx, wy, 3, 1);
      ctx.fillRect(wx + 5, wy + 3, 2, 1);
      if (r3 > 0.6) ctx.fillRect(left + 13 + Math.floor(r1 * 3), top + 16, 3, 1);
      break;
    }
    case BIOMES.MOUNTAIN: {
      const mx = left + 8 + Math.floor(r1 * 3);
      const my = top + 8;
      ctx.fillStyle = pal.shade;
      for (let i = 0; i < 6; i++) ctx.fillRect(mx + 5 - i, my + i, 2 * i + 1, 1);
      ctx.fillStyle = pal.deco;
      ctx.fillRect(mx + 5, my, 1, 1);
      ctx.fillRect(mx + 4, my + 1, 1, 1);
      break;
    }
    case BIOMES.PEAK: {
      const mx = left + 7;
      const my = top + 6;
      ctx.fillStyle = pal.shade;
      for (let i = 0; i < 8; i++) ctx.fillRect(mx + 7 - i, my + i, 2 * i + 1, 1);
      ctx.fillStyle = "#f4f1ea";
      ctx.fillRect(mx + 7, my, 1, 1);
      ctx.fillRect(mx + 6, my + 1, 3, 1);
      ctx.fillRect(mx + 5, my + 2, 2, 1);
      ctx.fillRect(mx + 8, my + 2, 2, 1);
      break;
    }
    case BIOMES.VOLCANIC: {
      ctx.fillStyle = pal.shade;
      ctx.fillRect(left + 8, top + 12, 4, 4);
      ctx.fillRect(left + 13, top + 14, 3, 3);
      ctx.fillStyle = pal.deco;
      ctx.fillRect(left + 9, top + 12, 1, 1);
      break;
    }
    case BIOMES.LAVA: {
      ctx.fillStyle = "#ffb24a";
      ctx.fillRect(left + 7, top + 12, 4, 1);
      ctx.fillRect(left + 11, top + 13, 3, 1);
      ctx.fillRect(left + 14, top + 15, 3, 1);
      ctx.fillStyle = "#fff080";
      ctx.fillRect(left + 9, top + 12, 1, 1);
      ctx.fillRect(left + 13, top + 13, 1, 1);
      break;
    }
    case BIOMES.SWAMP: {
      ctx.fillStyle = pal.shade;
      ctx.fillRect(left + 8, top + 13, 3, 2);
      ctx.fillRect(left + 14, top + 11, 2, 2);
      ctx.fillStyle = pal.deco;
      ctx.fillRect(left + 9, top + 13, 1, 1);
      ctx.fillStyle = "#3a2a1a";
      ctx.fillRect(left + 12, top + 9, 1, 4);
      ctx.fillRect(left + 13, top + 8, 1, 1);
      break;
    }
    case BIOMES.DESERT: {
      ctx.fillStyle = pal.shade;
      ctx.fillRect(left + 6, top + 13, 5, 1);
      ctx.fillRect(left + 13, top + 16, 5, 1);
      if (r1 > 0.85) {
        ctx.fillStyle = "#5fa040";
        ctx.fillRect(left + 11, top + 9, 1, 5);
        ctx.fillRect(left + 10, top + 11, 1, 1);
      }
      break;
    }
    case BIOMES.BEACH: {
      if (r1 > 0.6) {
        ctx.fillStyle = pal.shade;
        ctx.fillRect(left + 9, top + 13, 2, 1);
        ctx.fillRect(left + 14, top + 15, 1, 1);
      }
      break;
    }
  }
}

// Render the entire world to a single canvas (called once on load).
export function renderWorldTerrain(world: World): HTMLCanvasElement {
  const sz = worldPixelSize(world);
  const canvas = document.createElement("canvas");
  canvas.width = sz.w;
  canvas.height = sz.h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  // Pass 1: solid biome fills (skip FOG — rendered as empty void)
  for (let row = 0; row < world.h; row++) {
    for (let col = 0; col < world.w; col++) {
      const t = world.tiles[row * world.w + col];
      if (t === BIOMES.FOG) continue;
      const pal = PAL[t];
      const [cx, cy] = hexCenter(col, row);
      const left = cx - HEX_W / 2;
      const top = cy - HEX_H / 2;
      fillHexAt(ctx, left, top, pal.fill);
    }
  }

  // Pass 2: hex grid outlines (skip FOG)
  for (let row = 0; row < world.h; row++) {
    for (let col = 0; col < world.w; col++) {
      const t = world.tiles[row * world.w + col];
      if (t === BIOMES.FOG) continue;
      const pal = PAL[t];
      const [cx, cy] = hexCenter(col, row);
      const left = cx - HEX_W / 2;
      const top = cy - HEX_H / 2;
      const outlineCol = mixHex(pal.fill, "#ffffff", 0.18);
      strokeHexAt(ctx, left, top, outlineCol);
    }
  }

  // Pass 3: fog edge fade — darken land tiles adjacent to fog for a soft transition
  for (let row = 0; row < world.h; row++) {
    for (let col = 0; col < world.w; col++) {
      const t = world.tiles[row * world.w + col];
      if (t === BIOMES.FOG) continue;
      // Check if any neighbor is fog
      let fogDist = 3; // how many rings of fade (0 = adjacent to fog)
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = col + dx, ny = row + dy;
          if (nx < 0 || nx >= world.w || ny < 0 || ny >= world.h) continue;
          if (world.tiles[ny * world.w + nx] === BIOMES.FOG) {
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < fogDist) fogDist = d;
          }
        }
      }
      if (fogDist < 3) {
        const alpha = (1 - fogDist / 3) * 0.55;
        const [cx, cy] = hexCenter(col, row);
        const left = cx - HEX_W / 2;
        const top = cy - HEX_H / 2;
        ctx.fillStyle = `rgba(30, 32, 38, ${alpha})`;
        for (let y = 0; y < HEX_H; y++) {
          const [x0, x1] = HEX_MASK[y];
          ctx.fillRect(left + x0, top + y, x1 - x0 + 1, 1);
        }
      }
    }
  }

  return canvas;
}

// Desaturate tiles around merged branches to give them a "ruin" appearance.
// Draws gray-tinted hexes over the terrain canvas at positions near merged branches.
export function applyMergedOverlay(
  canvas: HTMLCanvasElement,
  world: World,
): void {
  const ctx = canvas.getContext("2d")!;
  const RADIUS = 6; // hex radius around each merged branch to desaturate

  // Collect merged and active branch positions
  const mergedPositions: Array<{ hx: number; hy: number }> = [];
  const activePositions: Array<{ hx: number; hy: number }> = [];
  for (const p of world.placements) {
    if (p.branch.status === "merged") {
      mergedPositions.push({ hx: p.hx, hy: p.hy });
    } else {
      activePositions.push({ hx: p.hx, hy: p.hy });
    }
  }
  if (mergedPositions.length === 0) return;

  // For each land tile, determine if it's closer to a merged branch than to any active branch.
  // If so, mark it for desaturation.
  const marked = new Uint8Array(world.w * world.h);
  for (const { hx, hy } of mergedPositions) {
    const x0 = Math.max(0, hx - RADIUS), x1 = Math.min(world.w - 1, hx + RADIUS);
    const y0 = Math.max(0, hy - RADIUS), y1 = Math.min(world.h - 1, hy + RADIUS);
    for (let row = y0; row <= y1; row++) {
      for (let col = x0; col <= x1; col++) {
        const dx = col - hx, dy = row - hy;
        const distToMerged = Math.sqrt(dx * dx + dy * dy);
        if (distToMerged > RADIUS) continue;

        // Only mark if this tile is closer to this merged branch than any active branch
        let closerToActive = false;
        for (const a of activePositions) {
          const adx = col - a.hx, ady = row - a.hy;
          if (Math.sqrt(adx * adx + ady * ady) < distToMerged) {
            closerToActive = true;
            break;
          }
        }
        if (!closerToActive) {
          marked[row * world.w + col] = 1;
        }
      }
    }
  }

  // Overlay desaturated hexes
  for (let row = 0; row < world.h; row++) {
    for (let col = 0; col < world.w; col++) {
      if (!marked[row * world.w + col]) continue;
      const [cx, cy] = hexCenter(col, row);
      const left = cx - HEX_W / 2;
      const top = cy - HEX_H / 2;
      // Semi-transparent gray wash
      ctx.fillStyle = "rgba(140, 135, 125, 0.5)";
      for (let y = 0; y < HEX_H; y++) {
        const [x0, x1] = HEX_MASK[y];
        ctx.fillRect(left + x0, top + y, x1 - x0 + 1, 1);
      }
    }
  }
}

function mixHex(a: string, b: string, t: number): string {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const r = Math.round(pa[0] * (1 - t) + pb[0] * t);
  const g = Math.round(pa[1] * (1 - t) + pb[1] * t);
  const bl = Math.round(pa[2] * (1 - t) + pb[2] * t);
  return "#" + [r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join("");
}

// Draw a simple branch marker centered at (cx, cy)
export function drawBranchMarker(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string,
  ringColor?: string
) {
  const px = Math.round(cx);
  const py = Math.round(cy);
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.fillRect(px - 2, py + 1, 5, 1);
  ctx.fillRect(px - 1, py + 2, 3, 1);
  ctx.fillStyle = ringColor || "#ffffff";
  ctx.fillRect(px - 2, py - 2, 5, 1);
  ctx.fillRect(px - 2, py + 2, 5, 1);
  ctx.fillRect(px - 2, py - 1, 1, 3);
  ctx.fillRect(px + 2, py - 1, 1, 3);
  ctx.fillStyle = color;
  ctx.fillRect(px - 1, py - 1, 3, 3);
  const hl = mixHex(color, "#ffffff", 0.35);
  ctx.fillStyle = hl;
  ctx.fillRect(px - 1, py - 1, 1, 1);
}

// Highlight ring around a hex (used for hover/selection)
export function drawHexRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string,
  thickness = 1
) {
  const left = Math.round(cx - HEX_W / 2);
  const top = Math.round(cy - HEX_H / 2);
  ctx.fillStyle = color;
  for (let y = 0; y < HEX_H; y++) {
    const [x0, x1] = HEX_MASK[y];
    for (let t = 0; t < thickness; t++) ctx.fillRect(left + x0 + t, top + y, 1, 1);
    for (let t = 0; t < thickness; t++) ctx.fillRect(left + x1 - t, top + y, 1, 1);
  }
  for (let y = 0; y < HEX_H; y++) {
    const [x0, x1] = HEX_MASK[y];
    const prev = HEX_MASK[y - 1];
    const next = HEX_MASK[y + 1];
    if (!prev || x0 < prev[0]) {
      const start = !prev ? x0 : Math.max(x0, 0);
      const end = !prev ? x1 : prev[0] - 1;
      for (let x = start; x <= end; x++) ctx.fillRect(left + x, top + y, 1, 1);
    }
    if (!prev || x1 > prev[1]) {
      const start = !prev ? x0 : prev[1] + 1;
      const end = x1;
      for (let x = start; x <= end; x++) ctx.fillRect(left + x, top + y, 1, 1);
    }
    if (!next || x0 < next[0]) {
      const start = x0;
      const end = !next ? x1 : next[0] - 1;
      for (let x = start; x <= end; x++) ctx.fillRect(left + x, top + y, 1, 1);
    }
    if (!next || x1 > next[1]) {
      const start = !next ? x0 : next[1] + 1;
      const end = x1;
      for (let x = start; x <= end; x++) ctx.fillRect(left + x, top + y, 1, 1);
    }
  }
}
