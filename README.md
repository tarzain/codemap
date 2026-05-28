# Codemap

Codemap is an interactive Next.js viewer for repository branch maps. It turns a `codemap.json` file into a pixel-art terrain map where branches, milestones, hotpatches, and suggested work appear as landmarks grouped by product or architecture region.

The app includes bundled samples, JSON upload, high-resolution fog-of-war rendering, branch popups with useful actions, and optional Claude-powered search for finding or proposing work on the map.

## Getting Started

Install dependencies and run the development server:

```bash
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

Build for production:

```bash
bun run build
bun run start
```

## Claude Search

Claude search is optional. Local search works without any API key.

To enable Enter-to-ask-Claude in the search bar, add:

```bash
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-6
```

`ANTHROPIC_MODEL` is optional. The app defaults to `claude-sonnet-4-6`.

Claude responses can link to existing entries, return multiple target chips, answer directly, or create a session-only `kind: "suggested"` branch. Claude-created suggestions are not included when downloading the codemap JSON.

## Using The App

- The default sample map loads behind the sample chooser modal.
- Close the chooser to inspect the default map.
- Use the top-left upload icon to reopen the chooser.
- Load a bundled sample, upload a `codemap.json`, or download `SKILL.md` from the chooser.
- Use `/` to focus search.
- Type to filter locally; press Enter to ask Claude when configured.
- Click a branch marker or search result to open its popup.
- Download the current codemap with the top-left download icon.

## Codemap JSON

The viewer consumes JSON with this shape:

```jsonc
{
  "$schema": "codemap@1",
  "name": "owner/repo",
  "repo": {
    "remoteUrl": "git@github.com:owner/repo.git",
    "webUrl": "https://github.com/owner/repo",
    "defaultBranch": "main"
  },
  "seed": 1337,
  "head": "main",
  "regions": {
    "frontend": {
      "label": "Frontend",
      "biome": "forest"
    }
  },
  "branches": [
    {
      "name": "feature/search",
      "kind": "branch",
      "region": "frontend",
      "position": [1.2, -0.4],
      "icon": "tower",
      "author": "zain",
      "commits": 8,
      "status": "open",
      "ahead": 8,
      "behind": 1,
      "lastCommit": "abc1234",
      "message": "Add search UX",
      "pr": "123",
      "reviewers": ["mira"]
    }
  ]
}
```

Entry kinds:

- `branch`: a real git branch or protected/release branch.
- `milestone`: a historical development epoch.
- `hotpatch`: notable direct-to-main work or emergency fixes.
- `suggested`: planned work that does not exist yet.

Branch statuses:

- `open`
- `draft`
- `merged`
- `stale`
- `protected`
- `release`

`kind: "suggested"` entries omit `status`.

Supported region biomes:

- `plains`
- `forest`
- `mountain`
- `water`
- `swamp`
- `desert`
- `volcanic`

## Generating Codemaps

The repository includes `SKILL.md`, a Codex skill for generating:

- `<project>-codetree.md`
- `<project>-codemap.json`

The app exposes the current skill at:

```text
/api/skill
```

The chooser modal also has a `Download SKILL.md` button so the skill can be copied into another repository workflow.

When updating an existing codemap, the skill is intended to preserve existing region geography and branch positions, then add new work near related clusters instead of recomputing the whole layout.

## Project Structure

```text
app/                  Next.js app routes and API routes
components/           Main React UI, map view, and tweak controls
lib/                  Codemap types, map generation, and terrain renderer
public/samples/       Bundled codemap JSON samples
SKILL.md              Codex skill for generating codetrees and codemaps
```

Important API routes:

- `GET /api/samples`: lists bundled sample metadata.
- `GET /api/skill`: downloads the repository `SKILL.md`.
- `POST /api/codemap/query`: asks Claude to search or extend the current codemap.

## Scripts

```bash
bun run dev      # Start the Next.js dev server
bun run build    # Type-check and build the app
bun run start    # Run the production server
```
