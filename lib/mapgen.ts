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

// World dimensions in hexes
export const WORLD_W = 96;
export const WORLD_H = 72;

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

export function generateWorld(codemap: CodemapData): World {
  const seed = ((codemap.seed ?? 0) | 0) || 1337;
  const branches = codemap.branches || [];
  const regions = codemap.regions || {};

  const noise = makeNoise(seed);
  const noise2 = makeNoise(seed + 7);
  const tiles = new Uint8Array(WORLD_W * WORLD_H);

  // Pre-compute "influence" maps for each region so branch clusters
  // get the right biome around them.
  const regionInfluence: Array<{
    key: string;
    biome: string;
    cx: number;
    cy: number;
    radius: number;
  }> = [];

  for (const [key, r] of Object.entries(regions)) {
    regionInfluence.push({
      key,
      biome: r.biome,
      cx: r.center[0] * WORLD_W,
      cy: r.center[1] * WORLD_H,
      radius: (r.spread ?? 0.07) * Math.max(WORLD_W, WORLD_H) * 2.2,
    });
  }

  function biomeBias(x: number, y: number) {
    const bias: Record<string, number> = {
      water: 0,
      mountain: 0,
      forest: 0,
      swamp: 0,
      desert: 0,
      volcanic: 0,
      plains: 0,
    };
    for (const r of regionInfluence) {
      const dx = x - r.cx,
        dy = y - r.cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const w = Math.max(0, 1 - d / r.radius);
      if (w <= 0) continue;
      const s = w * w;
      if (r.biome in bias) bias[r.biome] += s;
    }
    return bias;
  }

  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const nx = x / WORLD_W,
        ny = y / WORLD_H;
      let h = noise(x * 0.08, y * 0.08, 4);
      let m = noise2(x * 0.12 + 100, y * 0.12 + 100, 3);

      const bias = biomeBias(x, y);

      h += bias.mountain * 0.55;
      h += bias.volcanic * 0.5;
      h -= bias.water * 0.7;
      h -= bias.swamp * 0.25;
      h += bias.forest * 0.1;
      h += bias.plains * 0.08;
      h -= bias.desert * 0.05;
      m += bias.forest * 0.45;
      m += bias.swamp * 0.6;
      m -= bias.desert * 0.65;
      m -= bias.volcanic * 0.35;

      const edgeX = Math.min(nx, 1 - nx);
      const edgeY = Math.min(ny, 1 - ny);
      const edge = Math.min(edgeX, edgeY);
      h -= Math.max(0, 0.18 - edge) * 1.6;

      let t: number;
      if (h < 0.3) t = BIOMES.DEEP_WATER;
      else if (h < 0.4) t = BIOMES.WATER;
      else if (h < 0.44) t = BIOMES.SHORE;
      else if (h < 0.47) t = BIOMES.BEACH;
      else if (h > 0.78 && bias.volcanic > 0.05) t = BIOMES.LAVA;
      else if (h > 0.72) t = BIOMES.PEAK;
      else if (h > 0.62) t = bias.volcanic > 0.05 ? BIOMES.VOLCANIC : BIOMES.MOUNTAIN;
      else if (m < 0.32 && bias.swamp < 0.1) t = BIOMES.DESERT;
      else if (m > 0.62 && bias.swamp > 0.15) t = BIOMES.SWAMP;
      else if (m > 0.62) t = BIOMES.DEEP_FOREST;
      else if (m > 0.5) t = BIOMES.FOREST;
      else t = BIOMES.PLAINS;

      tiles[y * WORLD_W + x] = t;
    }
  }

  // Place branches: snap each branch's region center + jitter to nearest valid tile of correct biome
  const placements: Placement[] = [];
  const occupied = new Set<string>();
  const groupedByRegion: Record<string, typeof branches> = {};
  for (const b of branches) {
    (groupedByRegion[b.region] ||= []).push(b);
  }

  for (const [regionKey, list] of Object.entries(groupedByRegion)) {
    const r = regions[regionKey];
    if (!r) continue;
    const cx = r.center[0] * WORLD_W;
    const cy = r.center[1] * WORLD_H;
    const spreadHex = (r.spread ?? 0.07) * Math.max(WORLD_W, WORLD_H) * 1.6;
    const rng = makeRng(seed + hashStr(regionKey));
    let placedCountInRegion = 0;
    for (const branch of list) {
      let placed = false;
      const isFirstInRegion = placedCountInRegion === 0;
      for (let attempt = 0; attempt < 200 && !placed; attempt++) {
        const ang = rng() * Math.PI * 2;
        const rad = Math.sqrt(rng()) * spreadHex;
        const hx = Math.round(cx + Math.cos(ang) * rad);
        const hy = Math.round(cy + Math.sin(ang) * rad);
        if (hx < 1 || hx >= WORLD_W - 1 || hy < 1 || hy >= WORLD_H - 1) continue;
        const key = hx + "," + hy;
        if (occupied.has(key)) continue;
        let tooClose = false;
        for (const p of placements) {
          const dx = p.hx - hx,
            dy = p.hy - hy;
          if (dx * dx + dy * dy < 5) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        const t = tiles[hy * WORLD_W + hx];
        if (!biomeMatches(t, r.biome)) continue;
        placements.push({ branch, hx, hy, isFirstInRegion });
        occupied.add(key);
        placed = true;
        placedCountInRegion++;
      }
      if (!placed) {
        for (let dy = -8; dy <= 8 && !placed; dy++) {
          for (let dx = -8; dx <= 8 && !placed; dx++) {
            const hx = Math.round(cx) + dx;
            const hy = Math.round(cy) + dy;
            if (hx < 1 || hx >= WORLD_W - 1 || hy < 1 || hy >= WORLD_H - 1) continue;
            const key = hx + "," + hy;
            if (occupied.has(key)) continue;
            placements.push({ branch, hx, hy, isFirstInRegion });
            occupied.add(key);
            placed = true;
            placedCountInRegion++;
          }
        }
      }
    }
  }

  return { tiles, w: WORLD_W, h: WORLD_H, placements };
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
      return t === BIOMES.WATER || t === BIOMES.SHORE || t === BIOMES.BEACH;
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
