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
  center?: [number, number];
  spread?: number;
}

export type EntryKind = "branch" | "milestone" | "hotpatch" | "suggested";
export type BranchStatus = "open" | "draft" | "merged" | "stale" | "protected" | "release";

export interface Branch {
  name: string;
  region: string;
  kind: EntryKind;
  position?: [number, number];
  icon?: string;
  author?: string;
  commits?: number;
  status?: BranchStatus;
  ahead?: number;
  behind?: number;
  lastCommit?: string;
  message?: string;
  pr?: string | null;
  reviewers?: string[];
}

export interface SuggestedBranchPayload {
  name: string;
  region: string;
  position: [number, number];
  icon: string;
  author: string;
  commits: number;
  ahead: number;
  behind: number;
  lastCommit: string;
  message: string;
  reviewers: string[];
}

export interface CodemapAssistantResult {
  action: "link_existing" | "create_suggested" | "answer";
  message: string;
  targetName: string;
  targetNames: string[];
  suggestedBranch: SuggestedBranchPayload;
}

export function entryKind(branch: Branch): EntryKind {
  return branch.kind;
}

export function entryStatus(branch: Branch): BranchStatus | undefined {
  return branch.status;
}

export interface CodemapData {
  $schema?: string;
  name: string;
  repo?: {
    remoteUrl?: string;
    webUrl?: string;
    defaultBranch?: string;
  };
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
  visibility: Uint8Array;
  w: number;
  h: number;
  placements: Placement[];
  originHx: number;
  originHy: number;
}

export interface ViewState {
  x: number;
  y: number;
  scale: number;
}
