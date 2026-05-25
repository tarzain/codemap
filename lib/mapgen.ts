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

  // ── 1. Resolve branch hex positions ──
  // Branches with explicit positions use them directly.
  // Branches without positions fall back to region center + seeded jitter.
  const branchHex: Array<{ branch: typeof branches[0]; hx: number; hy: number; biome: string }> = [];

  const regionRngs: Record<string, () => number> = {};
  const regionCounters: Record<string, number> = {};

  for (const branch of branches) {
    const region = regions[branch.region];
    const biome = region?.biome ?? "plains";

    if (branch.position) {
      const hx = Math.round(branch.position[0] * (WORLD_W - 2)) + 1;
      const hy = Math.round(branch.position[1] * (WORLD_H - 2)) + 1;
      branchHex.push({ branch, hx, hy, biome });
    } else if (region?.center) {
      // Fallback: jitter around region center
      if (!regionRngs[branch.region]) {
        regionRngs[branch.region] = makeRng(seed + hashStr(branch.region));
        regionCounters[branch.region] = 0;
      }
      const rng = regionRngs[branch.region];
      const spread = (region.spread ?? 0.07) * Math.max(WORLD_W, WORLD_H) * 0.5;
      const cx = region.center[0] * WORLD_W;
      const cy = region.center[1] * WORLD_H;
      const ang = rng() * Math.PI * 2;
      const rad = Math.sqrt(rng()) * spread;
      const hx = Math.max(1, Math.min(WORLD_W - 2, Math.round(cx + Math.cos(ang) * rad)));
      const hy = Math.max(1, Math.min(WORLD_H - 2, Math.round(cy + Math.sin(ang) * rad)));
      branchHex.push({ branch, hx, hy, biome });
    }
  }

  // ── 2. Build land from branch positions ──
  // Each branch creates a land blob. Nearby branches merge into landmasses.
  const LAND_RADIUS = 7;
  const landScore = new Float32Array(WORLD_W * WORLD_H);

  for (const { hx: bx, hy: by, biome } of branchHex) {
    if (biome === "water") continue;
    const r = LAND_RADIUS;
    const x0 = Math.max(0, bx - r), x1 = Math.min(WORLD_W - 1, bx + r);
    const y0 = Math.max(0, by - r), y1 = Math.min(WORLD_H - 1, by + r);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - bx, dy = y - by;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < r) {
          const t = 1 - d / r;
          landScore[y * WORLD_W + x] += t * t;
        }
      }
    }
  }

  // ── 3. Threshold with noise for organic coastlines ──
  const isLand = new Uint8Array(WORLD_W * WORLD_H);
  const THRESHOLD = 0.15;

  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const idx = y * WORLD_W + x;
      let s = landScore[idx];
      s += (noise(x * 0.1, y * 0.1, 3) - 0.5) * 0.2;
      const nx = x / WORLD_W, ny = y / WORLD_H;
      const edge = Math.min(Math.min(nx, 1 - nx), Math.min(ny, 1 - ny));
      s -= Math.max(0, 0.08 - edge) * 3;
      landScore[idx] = s;
      isLand[idx] = s > THRESHOLD ? 1 : 0;
    }
  }

  // ── 4. Assign biome tiles ──
  for (let y = 0; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const idx = y * WORLD_W + x;

      if (!isLand[idx]) {
        let closeLand = false, nearLand = false;
        outer: for (let dy = -4; dy <= 4; dy++) {
          for (let dx = -4; dx <= 4; dx++) {
            const nx2 = x + dx, ny2 = y + dy;
            if (nx2 < 0 || nx2 >= WORLD_W || ny2 < 0 || ny2 >= WORLD_H) continue;
            if (!isLand[ny2 * WORLD_W + nx2]) continue;
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
          if (nx2 < 0 || nx2 >= WORLD_W || ny2 < 0 || ny2 >= WORLD_H) { coastal = true; continue; }
          if (!isLand[ny2 * WORLD_W + nx2]) coastal = true;
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

  // ── 5. Placements: branches go at their resolved positions ──
  const placements: Placement[] = [];
  const regionFirstSeen = new Set<string>();

  for (const { branch, hx, hy } of branchHex) {
    const isFirstInRegion = !regionFirstSeen.has(branch.region);
    regionFirstSeen.add(branch.region);
    placements.push({ branch, hx, hy, isFirstInRegion });
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
