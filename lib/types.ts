// Domain types for Codemap

export const BIOME = {
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

export type BiomeId = typeof BIOME[keyof typeof BIOME];
export type BiomeKey = "plains" | "forest" | "mountain" | "water" | "swamp" | "desert" | "volcanic";

export interface Region {
  label?: string;
  biome: BiomeKey;
  center: [number, number];
  spread?: number;
}

export interface Branch {
  name: string;
  region: string;
  icon?: string;
  author?: string;
  commits?: number;
  status: "open" | "draft" | "merged" | "stale" | "protected" | "release";
  ahead?: number;
  behind?: number;
  lastCommit?: string;
  message?: string;
  pr?: string | null;
  ci?: "passing" | "failing" | "skipped";
  reviewers?: string[];
}

export interface CodemapData {
  $schema?: string;
  name: string;
  seed?: number;
  head?: string;
  regions: Record<string, Region>;
  branches: Branch[];
}

export interface Placement {
  branch: Branch;
  hx: number;
  hy: number;
  isFirstInRegion: boolean;
}

export interface World {
  tiles: Uint8Array;
  w: number;
  h: number;
  placements: Placement[];
}

export interface ViewState {
  x: number;
  y: number;
  scale: number;
}
