---
name: codemap
description: Generate a codetree (comprehensive codebase map as nested markdown) and a codemap.json (visual branch terrain map) for any project. Use when the user asks to map a codebase, generate a codemap, create a codetree, understand a project's branch landscape, or produce a visual overview of a repository's architecture and work-in-progress.
tools: Read, Glob, Grep, Bash
---

# Codemap Skill

Produce two artifacts for a repository:

1. **`<project>-codetree.md`** — a deep nested-list document covering every file, system, branch, and possible task in the codebase
2. **`<project>-codemap.json`** — a terrain map JSON consumed by the Codemap viewer, placing branches as landmarks across a procedurally-generated world

Both files are written to the project's root directory.

---

## Phase 1 — Explore the Codebase

Explore thoroughly before writing anything. The codetree's quality depends entirely on how well the codebase is understood.

### What to gather

**Repository structure**
```bash
ls <project-root>/
# Read README.md, package.json / pyproject.toml / Cargo.toml / go.mod
# Read the main config files: vite.config.*, next.config.*, vercel.json, etc.
```

**Source files** — read every meaningful file in `src/`, `lib/`, `app/`, `api/`, `backend/`, etc. For large files (>500 lines), read enough to understand:
- What the file does
- Its key exports, functions, or components
- Dependencies on other files
- Architectural patterns it establishes

**Git branches and history**
```bash
git -C <project-root> branch -a
git -C <project-root> log --oneline --all --graph -80

# Full dated commit log for timeline reconstruction
git -C <project-root> log --format="%h %ad %s" --date=short -120

# If the log is long, page through it
git -C <project-root> log --format="%h %ad %s" --date=short -120 --skip=120

# PR merges only (useful for epoch boundaries)
git -C <project-root> log --oneline --merges
```

**What to extract from the history:**
- First commit date and message (the "epoch 0" anchor)
- HEAD commit hash, date, and message
- Total commit count on main: `git rev-list --count HEAD`
- List of merge commits (identifies PRs and branch landings)
- Any large direct-to-main bursts (multiple commits same day, no merge parent)
- Gaps between activity clusters (quiet periods between epochs)
- Author names from commit log

**Related projects** — if sibling directories look related (e.g. `project-ios`, `project-map`), do a quick `ls` and README read.

### What to capture per file
- Purpose in one sentence
- Key functions / components / exports
- Notable patterns or technical decisions
- Dependencies on other files

---

## Phase 2 — Write the Codetree

Write `<project>-codetree.md` in the project root. The codetree is a comprehensive nested markdown document. Use `##` for top-level sections and nested `-` lists for everything else.

### Required sections

#### 1. Project Overview & Architecture
- What the product does (one paragraph)
- High-level data flow (request → processing → response)
- Interaction modes or user flows
- Repository layout (top-level dirs and what they contain)

#### 2. Frontend — `src/` (or equivalent)
One subsection per significant file or component group. For each:
- What it does
- Key sub-topics a developer might ask about (e.g. "Explain the generation state machine")
- Refactor targets if the file is large (note with "**Refactor targets (see §6):**")
- Delete candidates if stale code exists (note with "**Delete candidates (see §7):**")

#### 3. Backend / API — `api/` or `backend/` (or equivalent)
Same treatment as Frontend. Break into subsections per route file, handler, or service. For large library files, enumerate their major sections:
- Configuration
- Data models / error types
- Core logic functions (list each with a one-line description)
- Utilities

#### 4. Configuration & Deployment
- Build tooling (Vite, webpack, etc.) — multi-entry points, output config
- Deployment config (Vercel, Netlify, Dockerfile, etc.)
- Environment variables — group by purpose (model keys, infra, runtime, feature flags)

#### 5. Active Branches & Directions of Work
One subsection per branch (or logical group of related branches). For each:
- Branch name(s)
- What the work is (description from recent commit messages)
- Direction — what it's trying to achieve
- Status — in progress / merged / stale / experimental

Group related branches together: e.g. all `zain/scaling-*` variants under one heading.

#### 6. Refactoring Opportunities
Specific, actionable extraction targets. Name the current file, the proposed new file/module, and what moves there. Format:
```
### 6.1 `src/App.jsx` decomposition (~N lines)
- **Extract WaitRoom** → `src/components/WaitRoom.jsx`
- **Extract generation SSE logic** → `src/lib/useGeneration.js`
```

#### 7. Deletion Candidates
Things that appear safe to remove: legacy keys, dead endpoints, unused model paths, stale branches. Note why each is safe to delete.

#### 8. Features That Could Be Requested
Group by horizon:
- **In-progress / near-term** — features visible in branches, almost ready
- **Product surface expansions** — natural next steps from existing patterns
- **Model / generation improvements** — if AI/ML is involved
- **Backend / infrastructure improvements**
- **Developer / operator features**

#### 9. Related Projects
Any sibling repos, native apps, or companion tools. Brief description and status.

#### 10. Testing & Observability
Current state of tests and monitoring. List what's missing and what would be valuable to add.

#### 11. Repository History
This section turns the raw git log into a narrative that a new contributor can read in 5 minutes. It answers: *What has been built? In what order? What was the hardest sprint? What changed most recently?*

Structure it as:

**§11.1 Velocity overview** — one-line facts:
- First commit date + hash + message
- HEAD date + hash + message
- Total commit count on main
- Number of merged PRs
- Contributors (from git log `--format="%an"`)
- Currently active branch(es)

**§11.2 Milestone timeline** — one subsection per epoch. An epoch is a natural cluster of related work that shipped together. Identify epochs by:
- Quiet gaps between bursts of commits
- "Merge pull request" commit clusters
- A clear theme shift (e.g., "everything in this week is about the wait room")

For each epoch include:
- Date range and duration
- A table of the most important commits (hash, change description)
- **State at epoch end** — what was true about the product/system when this epoch finished

**§11.3 Notable direct-to-main commits** — a table of commits that bypassed branch review. Columns: date, hash, change, why-direct (urgency fix, solo addition, breaking API change, etc.)

**§11.4 Full PR log** — a table: PR number | branch | merge date | one-line description. Sorted chronologically.

---

## Phase 3 — Write the Codemap JSON

Write `<project>-codemap.json` to `~/workspace/codemap/public/samples/` (the Codemap viewer's samples directory) OR to the project root if that path doesn't exist.

The JSON is consumed by the Codemap viewer app. Every branch in the repo becomes a landmark on a procedurally-generated terrain map. Semantically-related branches cluster in the same region; the biome signals the nature of the work.

### Schema

```jsonc
{
  "$schema": "codemap@1",
  "name": "owner/repo",          // repo name for display
  "seed": 1337,                  // integer — controls terrain noise; pick any number
  "head": "main",               // currently checked-out branch
  "regions": {
    "<region-id>": {
      "label": "Human Label",   // shown in UI filters and popups
      "biome": "<biome-key>"    // see Biomes below — determines terrain appearance
    }
  },
  "branches": [
    {
      "name": "feature/foo",    // branch name (or conceptual name for planned work)
      "region": "<region-id>",  // must match a key in regions — determines biome/terrain
      "position": [0.35, 0.22], // [x, y] in [0,1] — REQUIRED — where this branch sits on the map
      "icon": "<icon-key>",     // see Icons below
      "author": "username",     // git author or "—" for planned
      "commits": 12,            // commit count (0 for planned)
      "status": "<status>",     // see Statuses below
      "ahead": 5,               // commits ahead of main
      "behind": 3,              // commits behind main
      "lastCommit": "2d ago",   // relative time string or "—"
      "message": "Description of what this branch/item does",
      "pr": "#123",             // PR number string or null
      "ci": "passing",          // "passing" | "failing" | "skipped"
      "reviewers": ["alice"]    // array of reviewer usernames
    }
  ]
}
```

**Important:** The `position` field is the primary layout mechanism. The renderer builds terrain (landmasses, coastlines, water) directly around branch positions. Regions only control biome appearance (what the terrain looks like), not where things go.

### Biomes

Choose the biome that matches the nature of the work in each region:

| Biome | Use for |
|-------|---------|
| `plains` | Mainline, stable, merged production code |
| `forest` | Active feature development, growing systems |
| `mountain` | Infrastructure, scaling, hard problems |
| `water` | Streaming, real-time, experimental/fluid work |
| `swamp` | Legacy, cleanup, technical debt, stale branches |
| `desert` | Analytics, observability, config, arid utilities |
| `volcanic` | Hotfixes, urgent patches, production incidents |

### Icons

| Icon | Use for |
|------|---------|
| `castle` | Main branch, primary trunk |
| `fortress` | Develop / staging protected branches |
| `tower` | Release branches |
| `keep` | Long-lived protected branches |
| `fort` | Infrastructure / security branches |
| `house` | Active feature branches (primary work) |
| `hut` | Smaller feature branches, fixes |
| `tent` | Experimental, in-progress, planned work |
| `pickaxe` | Refactoring, tooling, build changes |
| `rock` | Stale or abandoned branches |
| `ruin` | Legacy branches, frozen code |
| `ship` | Streaming, real-time, transport layer work |
| `obelisk` | Design system, tokens, visual identity |
| `volcano` | Hotfixes, incidents |

### Statuses

| Status | Meaning | Color |
|--------|---------|-------|
| `protected` | main, staging — cannot be deleted | gold |
| `release` | release/* branches | purple |
| `open` | active open PR or in-progress local work | blue |
| `draft` | draft PR or planned-but-not-started work | tan |
| `merged` | merged into main, still listed for history | green |
| `stale` | not updated in weeks, likely abandoned | grey |

### Designing branch positions

Position is the most important field in the codemap. It encodes **magnitude and direction of change** relative to main and to other branches. The renderer builds terrain around whatever positions you specify — you have full control.

**Core principles:**

1. **Main at center.** Place `main` (or equivalent trunk) near `[0.50, 0.48]`.

2. **Distance from main = divergence magnitude.** Branches with small changes (1-5 commits, nearly merged) should be close to main. Branches with large divergence (50+ commits ahead, experimental rewrites) should be far away. Use the `ahead` count as a primary signal.

3. **Direction from main = area of change.** Branches that modify the same subsystem or files should radiate in the same direction. For example:
   - Auth/security work → upper-left
   - Frontend/UI work → north
   - Backend/infra work → right
   - Data/storage → lower-right
   - Docs/config → near center (small changes)

4. **Branches with file overlap cluster together.** If two branches touch the same files, they should be near each other regardless of region. This is more important than region grouping.

5. **Clusters form landmasses.** The renderer builds land under every branch position (radius ~7 hexes). Branches within ~10 hexes of each other merge into a single landmass. Use this to control continent shapes — tight clusters become islands, nearby clusters merge into continents.

**Position assignment process:**

```
1. Place main at [0.50, 0.48]
2. For each branch, compute:
   - divergence = ahead / max_ahead_in_repo (normalized 0–1)
   - angle = based on which subsystem/area of code is being changed
3. Position = main + (divergence * 0.4) in the chosen direction
4. Adjust to avoid exact overlaps (min ~0.02 apart)
5. Verify clusters are separated by at least 0.15 from unrelated clusters
```

**Typical layout for a full-stack web app:**
```
                    [0.50, 0.14] milestones (top)

  [0.16, 0.18] fuzz        [0.78, 0.18] docs

  [0.28, 0.24] auth        [0.70, 0.36] query/features

  [0.18, 0.40] bugs    [0.48-0.54, 0.46-0.52] MAIN    [0.84, 0.54] infra

  [0.30, 0.65] onboarding              [0.86, 0.65] networking

  [0.10, 0.85] legacy   [0.56, 0.78] perf   [0.74, 0.76] design

                    [0.60, 0.90] hotfixes (bottom)
```

**Key constraints:**
- No two branches at the exact same position
- Branches within the same region should be within ~0.05 of each other
- Unrelated clusters should be at least ~0.15 apart (creates water between them)
- Keep all positions within [0.05, 0.95] to avoid edge clipping

### Including repository history as branches

The codemap needs two additional regions derived from the git history:

#### `milestones` region — development epochs
Add one branch per epoch. Epochs are natural clusters of thematically related work identified from the commit log. A new contributor should be able to read these 6–10 entries top-to-bottom and understand the full development arc.

- **biome:** `plains` (stable, completed history)
- **positions:** cluster near top-center of the map, around `[0.45–0.55, 0.10–0.18]` — above main
- **status:** `merged` for all
- **name:** `milestone/<N>-<slug>` e.g. `milestone/1-foundation`, `milestone/6-waitroom-launch`
- **icon:** use `castle`→`fortress`→`tower`→`keep`→`fort`→`house`→`hut` in sequence (oldest=grandest)
- **commits:** total commit count for that epoch
- **behind:** how many commits behind HEAD the epoch's last commit is
- **lastCommit:** the ISO date of the epoch's last commit (`"2026-04-09"`)
- **message:** one sentence: "Epoch N — [theme]: [key things shipped]"

#### `hotpatches` region — direct-to-main commits
Add one branch per notable cluster of direct-to-main commits (bypassed branch/PR workflow). These are important for new contributors to know: they show what the team considers urgent enough to skip review.

- **biome:** `volcanic`
- **positions:** cluster near bottom of the map, around `[0.55–0.65, 0.85–0.92]` — below main
- **status:** `merged` for all
- **name:** `hotpatch/<slug>` e.g. `hotpatch/admission-cap-crisis`, `hotpatch/gemini-migration`
- **icon:** `volcano` for emergencies, `rock` for solo additions
- **message:** describe what was changed and why it bypassed review (capacity emergency, breaking API change, solo addition, etc.)

How to identify direct-to-main commits from the log:
- A cluster of commits with no merge parents on the same day or short window
- Subject lines like "Hotfix:", "Raise X cap", "Fix X format", "Update X" without a corresponding PR merge above them
- Run `git log --no-merges --format="%h %ad %s" --date=short` and look for same-day clusters

### Including planned work as branches

The codemap is not just a git branch viewer — it is a map of the entire work landscape, including work that hasn't started yet.

For every refactoring opportunity, deletion candidate, and expected feature from the codetree, add a corresponding entry in the codemap with:
- A descriptive `name` that follows existing naming conventions (e.g. `refactor/split-lib`, `feat/graph-view`, `cleanup/legacy-keys`)
- `status: "draft"`
- `commits: 0`, `ahead: 0`, `behind: 0`
- `author: "—"`, `lastCommit: "—"`
- `ci: "skipped"`
- A `message` that is the one-line summary of the task from the codetree

This makes the codemap a complete picture of the current state AND the future roadmap.

### Branch count and coverage

Aim for 40–70 branches total. Include:
- All real local branches
- All significant remote branches (skip trivial one-commit remote branches)
- One entry per major refactoring opportunity from the codetree
- One entry per near-term planned feature from the codetree
- One entry per deletion / cleanup candidate from the codetree

---

## Output checklist

Before finishing, verify:

- [ ] `<project>-codetree.md` written to project root with all 11 sections
- [ ] Every significant source file is mentioned in the codetree with a description
- [ ] All git branches appear in §5 of the codetree
- [ ] All refactor opportunities in §6 have a corresponding `draft` branch in the codemap
- [ ] All planned features in §8 have a corresponding `draft` branch in the codemap
- [ ] All deletion candidates in §7 have a corresponding `draft` branch in the codemap
- [ ] §11 history section covers: velocity stats, epoch timeline with state-at-end, direct-to-main table, full PR log
- [ ] `<project>-codemap.json` written with valid JSON (no trailing commas)
- [ ] Every branch's `region` value matches a key in `regions`
- [ ] Every branch has a `position: [x, y]` field with values in [0.05, 0.95]
- [ ] `main` is positioned near center [0.50, 0.48]
- [ ] Branch positions reflect divergence: high-ahead branches are farther from main
- [ ] Branch positions reflect affinity: branches touching similar files are near each other
- [ ] Clusters of related branches are within ~0.05 of each other
- [ ] Unrelated clusters are at least ~0.15 apart (creates water between them)
- [ ] No two branches at the exact same position (min ~0.02 apart)
- [ ] `milestones` region present with one entry per epoch, positioned top-center area
- [ ] `hotpatches` region present with entries for notable direct-to-main commit clusters, positioned bottom area
- [ ] All merged branch `lastCommit` values are real ISO dates or accurate relative strings — not estimates
- [ ] All merged branch `behind` values are non-zero (they're behind HEAD by definition)
- [ ] `head` matches the actual current branch from `git branch`
- [ ] `seed` is an arbitrary integer (use the project name's char codes or any memorable number)
