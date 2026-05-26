// Hex map terrain generator.
// Generates a procedural pixel-art map keyed to region centers so that
// each cluster of branches sits in an appropriate biome.

import type { CodemapData, World, Placement } from "./types";

// --- seeded RNG (mulberry32) ---
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- simplex-ish noise: value noise with bilinear interp (good enough, no deps) ---
export function makeNoise(seed: number): (x: number, y: number, octaves?: number) => number {
  const rng = makeRng(seed);
  const SZ = 256;
  const grid = new Float32Array(SZ * SZ);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();

  function val(x: number, y: number): number {
    const xi = ((x % SZ) + SZ) % SZ;
    const yi = ((y % SZ) + SZ) % SZ;
    const x0 = Math.floor(xi),
      y0 = Math.floor(yi);
    const x1 = (x0 + 1) % SZ,
      y1 = (y0 + 1) % SZ;
    const fx = xi - x0,
      fy = yi - y0;
    const a = grid[y0 * SZ + x0];
    const b = grid[y0 * SZ + x1];
    const c = grid[y1 * SZ + x0];
    const d = grid[y1 * SZ + x1];
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    return (
      a * (1 - sx) * (1 - sy) +
      b * sx * (1 - sy) +
      c * (1 - sx) * sy +
      d * sx * sy
    );
  }

  return function fbm(x: number, y: number, octaves = 4): number {
    let amp = 1,
      freq = 1,
      sum = 0,
      norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * val(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };
}

// --- World sizing constants ---
export const HEX_DENSITY = 10; // hexes per position unit
const MIN_WORLD_W = 60;
const MIN_WORLD_H = 45;
const MARGIN = 0.30; // padding fraction on each side of bbox
const LAND_RADIUS = 10;
const MAX_FILLED_FOG_HOLE = 96;

// Biome ids
export const BIOMES = {
  DEEP_WATER: 0,
  WATER: 1,
  SHORE: 2,
  BEACH: 3,
  PLAINS: 4,
  FOREST: 5,
  DEEP_FOREST: 6,
  SWAMP: 7,
  DESERT: 8,
  MOUNTAIN: 9,
  PEAK: 10,
  VOLCANIC: 11,
  LAVA: 12,
} as const;

export type BiomesType = typeof BIOMES;

function computeWorldDimensions(positions: [number, number][]): { w: number; h: number; originHx: number; originHy: number } {
  if (positions.length === 0) {
    return { w: MIN_WORLD_W, h: MIN_WORLD_H, originHx: Math.round(MIN_WORLD_W / 2), originHy: Math.round(MIN_WORLD_H / 2) };
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [px, py] of positions) {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }

  // Use minimum span of 2 if collapsed
  let spanX = maxX - minX;
  let spanY = maxY - minY;
  if (spanX < 2) { const mid = (minX + maxX) / 2; minX = mid - 1; maxX = mid + 1; spanX = 2; }
  if (spanY < 2) { const mid = (minY + maxY) / 2; minY = mid - 1; maxY = mid + 1; spanY = 2; }

  // Add margin on each side
  const padX = spanX * MARGIN;
  const padY = spanY * MARGIN;
  const paddedMinX = minX - padX;
  const paddedMinY = minY - padY;
  const paddedSpanX = spanX + padX * 2;
  const paddedSpanY = spanY + padY * 2;

  const w = Math.max(MIN_WORLD_W, Math.round(paddedSpanX * HEX_DENSITY));
  const h = Math.max(MIN_WORLD_H, Math.round(paddedSpanY * HEX_DENSITY));

  // Origin: where position [0,0] maps in hex coords
  const originHx = Math.round((0 - paddedMinX) / paddedSpanX * w);
  const originHy = Math.round((0 - paddedMinY) / paddedSpanY * h);

  return { w, h, originHx, originHy };
}

function positionToHex(pos: [number, number], originHx: number, originHy: number, w: number, h: number): [number, number] {
  const hx = Math.max(1, Math.min(w - 2, Math.round(originHx + pos[0] * HEX_DENSITY)));
  const hy = Math.max(1, Math.min(h - 2, Math.round(originHy + pos[1] * HEX_DENSITY)));
  return [hx, hy];
}

export function generateWorld(codemap: CodemapData): World {
  const seed = ((codemap.seed ?? 0) | 0) || 1337;
  const branches = codemap.branches || [];
  const regions = codemap.regions || {};
  const noise = makeNoise(seed);
  const noise2 = makeNoise(seed + 7);

  // ── 1. Collect all positions to determine world size ──
  const allPositions: [number, number][] = [];
  for (const branch of branches) {
    if (branch.position) {
      allPositions.push(branch.position);
    } else {
      const region = regions[branch.region];
      if (region?.center) allPositions.push(region.center);
    }
  }

  const { w, h, originHx, originHy } = computeWorldDimensions(allPositions);
  const tiles = new Uint8Array(w * h);

  // ── 2. Resolve branch hex positions ──
  const branchHex: Array<{ branch: typeof branches[0]; hx: number; hy: number; biome: string }> = [];

  const regionRngs: Record<string, () => number> = {};

  for (const branch of branches) {
    const region = regions[branch.region];
    const biome = region?.biome ?? "plains";

    if (branch.position) {
      const [hx, hy] = positionToHex(branch.position, originHx, originHy, w, h);
      branchHex.push({ branch, hx, hy, biome });
    } else if (region?.center) {
      // Fallback: jitter around region center
      if (!regionRngs[branch.region]) {
        regionRngs[branch.region] = makeRng(seed + hashStr(branch.region));
      }
      const rng = regionRngs[branch.region];
      const spread = (region.spread ?? 0.5) * HEX_DENSITY * 0.5;
      const [cx, cy] = positionToHex(region.center, originHx, originHy, w, h);
      const ang = rng() * Math.PI * 2;
      const rad = Math.sqrt(rng()) * spread;
      const hx = Math.max(1, Math.min(w - 2, Math.round(cx + Math.cos(ang) * rad)));
      const hy = Math.max(1, Math.min(h - 2, Math.round(cy + Math.sin(ang) * rad)));
      branchHex.push({ branch, hx, hy, biome });
    }
  }

  // ── 3. Build land from branch positions ──
  const landScore = new Float32Array(w * h);

  for (const { hx: bx, hy: by, biome } of branchHex) {
    if (biome === "water") continue;
    const r = LAND_RADIUS;
    const x0 = Math.max(0, bx - r), x1 = Math.min(w - 1, bx + r);
    const y0 = Math.max(0, by - r), y1 = Math.min(h - 1, by + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - bx, dy = y - by;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < r) {
          const t = 1 - d / r;
          landScore[y * w + x] += t * t;
        }
      }
    }
  }

  // ── 4. Threshold with noise for organic coastlines (no edge falloff) ──
  const isLand = new Uint8Array(w * h);
  const THRESHOLD = 0.10;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      let s = landScore[idx];
      s += (noise(x * 0.1, y * 0.1, 3) - 0.5) * 0.2;
      landScore[idx] = s;
      isLand[idx] = s > THRESHOLD ? 1 : 0;
    }
  }

  // ── 4b. Convert exterior water to land ──
  // Flood-fill from map edges through water tiles. Exterior water becomes land
  // so the perimeter is always land→fog, never water→fog.
  // Only enclosed interior water (lakes between clusters) is preserved.
  const exterior = new Uint8Array(w * h);
  const queue: number[] = [];
  // Seed with all non-land edge tiles
  for (let x = 0; x < w; x++) {
    if (!isLand[x]) { exterior[x] = 1; queue.push(x); }
    const bot = (h - 1) * w + x;
    if (!isLand[bot]) { exterior[bot] = 1; queue.push(bot); }
  }
  for (let y = 1; y < h - 1; y++) {
    const left = y * w;
    if (!isLand[left]) { exterior[left] = 1; queue.push(left); }
    const right = y * w + w - 1;
    if (!isLand[right]) { exterior[right] = 1; queue.push(right); }
  }
  // BFS through water tiles
  let qi = 0;
  while (qi < queue.length) {
    const idx = queue[qi++];
    const x = idx % w, y = (idx - x) / w;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const ni = ny * w + nx;
      if (exterior[ni] || isLand[ni]) continue;
      exterior[ni] = 1;
      queue.push(ni);
    }
  }
  // Convert exterior water to land
  for (let i = 0; i < w * h; i++) {
    if (exterior[i]) isLand[i] = 1;
  }

  // ── 5. Assign biome tiles ──
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;

      if (!isLand[idx]) {
        let closeLand = false, nearLand = false;
        outer: for (let dy = -4; dy <= 4; dy++) {
          for (let dx = -4; dx <= 4; dx++) {
            const nx2 = x + dx, ny2 = y + dy;
            if (nx2 < 0 || nx2 >= w || ny2 < 0 || ny2 >= h) continue;
            if (!isLand[ny2 * w + nx2]) continue;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d <= 1.5) { closeLand = true; break outer; }
            else if (d <= 3.5) nearLand = true;
          }
        }
        tiles[idx] = closeLand ? BIOMES.SHORE : nearLand ? BIOMES.WATER : BIOMES.DEEP_WATER;
        continue;
      }

      // Beach if adjacent to water
      let coastal = false;
      for (let dy = -1; dy <= 1 && !coastal; dy++) {
        for (let dx = -1; dx <= 1 && !coastal; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx2 = x + dx, ny2 = y + dy;
          if (nx2 < 0 || nx2 >= w || ny2 < 0 || ny2 >= h) { coastal = true; continue; }
          if (!isLand[ny2 * w + nx2]) coastal = true;
        }
      }
      if (coastal) { tiles[idx] = BIOMES.BEACH; continue; }

      // Inland: find nearest branch, use its biome
      let bestDist = Infinity, bestBiome = "plains";
      for (const { hx: bx, hy: by, biome } of branchHex) {
        const dx = x - bx, dy = y - by;
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; bestBiome = biome; }
      }

      const m = noise2(x * 0.12 + 100, y * 0.12 + 100, 3);
      const hv = noise(x * 0.06, y * 0.06, 3);

      switch (bestBiome) {
        case "mountain":
          tiles[idx] = hv > 0.68 ? BIOMES.PEAK : hv > 0.42 ? BIOMES.MOUNTAIN : BIOMES.PLAINS;
          break;
        case "volcanic":
          tiles[idx] = hv > 0.73 ? BIOMES.LAVA : hv > 0.42 ? BIOMES.VOLCANIC : BIOMES.MOUNTAIN;
          break;
        case "forest":
          tiles[idx] = m > 0.58 ? BIOMES.DEEP_FOREST : m > 0.32 ? BIOMES.FOREST : BIOMES.PLAINS;
          break;
        case "swamp":
          tiles[idx] = m > 0.42 ? BIOMES.SWAMP : BIOMES.PLAINS;
          break;
        case "desert":
          tiles[idx] = m < 0.55 ? BIOMES.DESERT : BIOMES.PLAINS;
          break;
        case "water":
          tiles[idx] = BIOMES.BEACH;
          break;
        default:
          tiles[idx] = m > 0.62 ? BIOMES.FOREST : BIOMES.PLAINS;
          break;
      }
    }
  }

  // ── 6. Visibility pass: any tile far from all branches is covered by fog ──
  // Fog is rendered as a frontend overlay, so terrain remains terrain-only.
  const visibility = new Uint8Array(w * h);
  visibility.fill(1);
  const FOG_THRESHOLD = LAND_RADIUS * 1.5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      // Check distance to nearest branch
      let minDist = Infinity;
      for (const { hx: bx, hy: by } of branchHex) {
        const dx = x - bx, dy = y - by;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < minDist) minDist = d;
      }
      if (minDist > FOG_THRESHOLD) {
        visibility[idx] = 0;
      }
    }
  }
  fillSmallFogHoles(visibility, w, h, MAX_FILLED_FOG_HOLE);

  // ── 7. Placements: branches go at their resolved positions ──
  const placements: Placement[] = [];
  const regionFirstSeen = new Set<string>();

  for (const { branch, hx, hy } of branchHex) {
    const isFirstInRegion = !regionFirstSeen.has(branch.region);
    regionFirstSeen.add(branch.region);
    placements.push({ branch, hx, hy, isFirstInRegion });
  }

  return { tiles, visibility, w, h, placements, originHx, originHy };
}

function fillSmallFogHoles(visibility: Uint8Array, w: number, h: number, maxSize: number): void {
  const seen = new Uint8Array(w * h);
  const queue: number[] = [];
  const component: number[] = [];

  for (let start = 0; start < w * h; start++) {
    if (seen[start] || visibility[start]) continue;

    queue.length = 0;
    component.length = 0;
    queue.push(start);
    seen[start] = 1;
    let touchesEdge = false;

    for (let qi = 0; qi < queue.length; qi++) {
      const idx = queue[qi];
      component.push(idx);
      const x = idx % w;
      const y = (idx - x) / w;
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) touchesEdge = true;

      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = ny * w + nx;
        if (seen[ni] || visibility[ni]) continue;
        seen[ni] = 1;
        queue.push(ni);
      }
    }

    if (!touchesEdge && component.length <= maxSize) {
      for (const idx of component) visibility[idx] = 1;
    }
  }
}

export function biomeMatches(t: number, want: string): boolean {
  switch (want) {
    case "plains":
      return t === BIOMES.PLAINS || t === BIOMES.BEACH;
    case "forest":
      return t === BIOMES.FOREST || t === BIOMES.DEEP_FOREST || t === BIOMES.PLAINS;
    case "mountain":
      return t === BIOMES.MOUNTAIN || t === BIOMES.PEAK;
    case "water":
      return t === BIOMES.SHORE || t === BIOMES.BEACH;
    case "swamp":
      return t === BIOMES.SWAMP || t === BIOMES.PLAINS;
    case "desert":
      return t === BIOMES.DESERT || t === BIOMES.BEACH;
    case "volcanic":
      return t === BIOMES.VOLCANIC || t === BIOMES.LAVA || t === BIOMES.PEAK;
  }
  return true;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
