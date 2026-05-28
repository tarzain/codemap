'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { generateWorld } from '@/lib/mapgen';
import MapView from './MapView';
import { useTweaks, TweaksPanel, TweakSection, TweakNumber, TweakToggle } from './TweaksPanel';
import {
  entryKind,
  entryStatus,
  type BranchStatus,
  type CodemapAssistantResult,
  type CodemapData,
  type Branch,
  type EntryKind,
  type SuggestedBranchPayload,
  type World,
} from '@/lib/types';

const STATUS_COLOR: Record<BranchStatus, string> = {
  open: '#3a82c4',
  draft: '#9a8a6a',
  merged: '#7aa648',
  stale: '#7d7569',
  protected: '#d4a23a',
  release: '#9a5ac4',
};

const KIND_COLOR: Record<Exclude<EntryKind, 'branch'>, string> = {
  suggested: '#b088d0',
  milestone: '#9a5ac4',
  hotpatch: '#d4583a',
};

type AssistantState =
  | { status: 'idle' }
  | { status: 'loading'; command: string }
  | { status: 'result'; command: string; result: CodemapAssistantResult }
  | { status: 'error'; command: string; error: string };

const FALLBACK_CODEMAP: CodemapData = {
  $schema: 'codemap@1',
  name: 'demo',
  seed: 1337,
  head: 'main',
  regions: {
    capital: { label: 'Mainline', biome: 'plains', center: [0, 0], spread: 0.5 },
  },
  branches: [
    {
      name: 'main',
      region: 'capital',
      kind: 'branch',
      icon: 'castle',
      author: 'team',
      commits: 0,
      status: 'protected',
      ahead: 0,
      behind: 0,
      lastCommit: '—',
      message: '—',
      pr: null,
      reviewers: [],
    },
  ],
};

export default function CodemapApp() {
  const [t, setTweak] = useTweaks({ seed: null as number | null, showLabels: true });

  const [codemap, setCodemap] = useState<CodemapData | null>(null);
  const [transientBranches, setTransientBranches] = useState<Branch[]>([]);
  const [assistantState, setAssistantState] = useState<AssistantState>({ status: 'idle' });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<{ type: string; text: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    fetch('/samples/acme-codemap.json')
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then((json) => {
        setCodemap(json as CodemapData);
        setLoadError(null);
      })
      .catch((err) => {
        console.warn('Could not load default codemap, using fallback:', err);
        setCodemap(FALLBACK_CODEMAP);
        setLoadError('Default codemap couldn\'t load. Using fallback. Upload a JSON to view another codebase.');
      });
  }, []);

  const effectiveCodemap = useMemo<CodemapData | null>(() => {
    if (!codemap) return null;
    if (transientBranches.length === 0) return codemap;
    return {
      ...codemap,
      branches: [...codemap.branches, ...transientBranches],
    };
  }, [codemap, transientBranches]);

  const effectiveSeed = ((t.seed ?? effectiveCodemap?.seed ?? 1337) | 0) as number;
  const world = useMemo<World | null>(() => {
    if (!effectiveCodemap) return null;
    return generateWorld({ ...effectiveCodemap, seed: effectiveSeed });
  }, [effectiveCodemap, effectiveSeed]);

  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusBranch, setFocusBranch] = useState<{ name: string; ts: number } | null>(null);
  const [query, setQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState(new Set<string>());
  const [statusFilter, setStatusFilter] = useState<BranchStatus | null>(null);
  const [kindFilter, setKindFilter] = useState<Exclude<EntryKind, 'branch'> | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentCheckout = effectiveCodemap?.head;
  const branches = effectiveCodemap?.branches || [];
  const regions = effectiveCodemap?.regions || {};

  useEffect(() => {
    function onResize() {
      if (rootRef.current) {
        const r = rootRef.current.getBoundingClientRect();
        setViewportSize({ w: r.width, h: r.height });
      }
    }
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setSelected(null);
    setQuery('');
    setActiveFilters(new Set());
    setStatusFilter(null);
    setKindFilter(null);
    setTransientBranches([]);
    setAssistantState({ status: 'idle' });
  }, [codemap]);

  const dimmedSet = useMemo(() => {
    const hasQuery = query.trim().length > 0;
    const hasFilter = activeFilters.size > 0;
    const hasStatus = !!statusFilter;
    const hasKind = !!kindFilter;
    if (!hasQuery && !hasFilter && !hasStatus && !hasKind) return new Set<string>();
    const dim = new Set<string>();
    for (const b of branches) {
      let visible = true;
      if (hasQuery) {
        const q = query.toLowerCase();
        visible =
          b.name.toLowerCase().includes(q) ||
          (b.author || '').toLowerCase().includes(q) ||
          (b.message || '').toLowerCase().includes(q) ||
          (b.pr || '').toLowerCase().includes(q) ||
          (regions[b.region]?.label || '').toLowerCase().includes(q);
      }
      if (visible && hasFilter) visible = activeFilters.has(b.region);
      if (visible && hasStatus) visible = entryStatus(b) === statusFilter;
      if (visible && hasKind) visible = entryKind(b) === kindFilter;
      if (!visible) dim.add(b.name);
    }
    return dim;
  }, [query, activeFilters, statusFilter, kindFilter, branches, regions]);

  const matchingBranches = useMemo(
    () => branches.filter((b) => !dimmedSet.has(b.name)),
    [dimmedSet, branches]
  );

  const selectedBranchObj = selected ? branches.find((b) => b.name === selected) : null;

  const handleSelect = (name: string | null) => {
    setSelected(name);
    if (name) setFocusBranch({ name, ts: Date.now() });
  };

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (assistantState.status !== 'idle') setAssistantState({ status: 'idle' });
  };

  // Drag-and-drop JSON
  useEffect(() => {
    function onDragOver(e: DragEvent) {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
        document.body.classList.add('cm-drop-active');
      }
    }
    function onDragLeave(e: DragEvent) {
      if (e.target === document || e.relatedTarget === null) {
        document.body.classList.remove('cm-drop-active');
      }
    }
    function onDrop(e: DragEvent) {
      e.preventDefault();
      document.body.classList.remove('cm-drop-active');
      const file = e.dataTransfer?.files?.[0];
      if (file) loadFile(file);
    }
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function loadFile(file: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target!.result as string) as CodemapData;
        const valid = validateCodemap(json);
        if (valid.ok) {
          setCodemap(json);
          setTweak('seed', null);
          setImportMessage({
            type: 'success',
            text: `Loaded "${json.name || file.name}" — ${json.branches.length} branches.`,
          });
        } else {
          setImportMessage({ type: 'error', text: valid.error! });
        }
      } catch (err) {
        setImportMessage({ type: 'error', text: `Invalid JSON: ${(err as Error).message}` });
      }
      setTimeout(() => setImportMessage(null), 4500);
    };
    reader.readAsText(file);
  }

  function loadSample(path: string) {
    fetch('/' + path)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((json: CodemapData) => {
        const valid = validateCodemap(json);
        if (!valid.ok) throw new Error(valid.error);
        setCodemap(json);
        setTweak('seed', null);
        setHelpOpen(false);
        setImportMessage({ type: 'success', text: `Loaded "${json.name}" — ${json.branches.length} branches.` });
        setTimeout(() => setImportMessage(null), 4500);
      })
      .catch((err: Error) => {
        setImportMessage({ type: 'error', text: `Couldn't load sample: ${err.message}` });
        setTimeout(() => setImportMessage(null), 4500);
      });
  }

  function downloadJSON() {
    if (!codemap) return;
    const json = JSON.stringify(codemap, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(codemap.name || 'codemap').replace(/[\/\\]/g, '-')}.codemap.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function showToast(type: string, text: string) {
    setImportMessage({ type, text });
    setTimeout(() => setImportMessage(null), 3000);
  }

  async function copyCheckoutCommand(branch: Branch) {
    const command = checkoutCommandForBranch(branch.name);
    try {
      await copyText(command);
      showToast('success', `Copied: ${command}`);
    } catch {
      showToast('error', 'Could not copy checkout command.');
    }
  }

  async function copyClaudeCodePrompt(branch: Branch) {
    const prompt = claudeCodePromptForSuggestedBranch(branch);
    try {
      await copyText(prompt);
      showToast('success', 'Copied Claude Code prompt.');
    } catch {
      showToast('error', 'Could not copy Claude Code prompt.');
    }
  }

  function openPullRequest(branch: Branch) {
    if (!codemap) return;
    const url = pullRequestUrl(codemap, branch);
    if (!url) {
      showToast('info', 'No GitHub remote URL is configured for this codemap.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function submitAssistantQuery() {
    const command = query.trim();
    if (!command || !effectiveCodemap || assistantState.status === 'loading') return;

    setAssistantState({ status: 'loading', command });
    try {
      const response = await fetch('/api/codemap/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ command, codemap: effectiveCodemap }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Claude request failed.');

      const result = normalizeAssistantResult(payload as CodemapAssistantResult, branches, regions);
      if (result.action === 'link_existing') {
        setAssistantState({ status: 'result', command, result });
        return;
      }

      if (result.action === 'create_suggested') {
        const existing = branches.find((branch) => branch.name === result.targetName);
        if (existing) {
          const linkResult: CodemapAssistantResult = {
            action: 'link_existing',
            message: result.message,
            targetName: existing.name,
            suggestedBranch: emptySuggestedBranch(),
          };
          setAssistantState({ status: 'result', command, result: linkResult });
          handleSelect(existing.name);
          return;
        }

        const branch = suggestedPayloadToBranch(result.suggestedBranch);
        setTransientBranches((prev) => [...prev, branch]);
        setAssistantState({ status: 'result', command, result });
        handleSelect(branch.name);
        return;
      }

      setAssistantState({ status: 'result', command, result });
    } catch (error) {
      setAssistantState({
        status: 'error',
        command,
        error: (error as Error).message || 'Claude request failed.',
      });
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '/' && (document.activeElement as HTMLElement)?.tagName !== 'INPUT') {
        e.preventDefault();
        document.getElementById('codemap-search')?.focus();
      }
      if (e.key === 'Escape') {
        setSelected(null);
        setQuery('');
        setHelpOpen(false);
        (document.activeElement as HTMLElement)?.blur();
      }
      if (e.key === '?' && (document.activeElement as HTMLElement)?.tagName !== 'INPUT') {
        e.preventDefault();
        setHelpOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!codemap) {
    return (
      <div ref={rootRef} className="cm-root cm-loading">
        <div className="cm-spinner" />
        <div style={{ marginTop: 12, color: '#a8a89c', fontFamily: 'var(--mono)', fontSize: 12 }}>
          loading codemap…
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="cm-root">
      <MapView
        world={world}
        selectedBranch={selected}
        hoveredBranch={hovered}
        onSelect={handleSelect}
        onHover={setHovered}
        showLabels={t.showLabels}
        dimmedBranches={dimmedSet}
        focusBranch={focusBranch?.name || null}
        viewportSize={viewportSize}
        currentCheckout={currentCheckout}
        regions={regions}
      />

      <SearchPanel
        codemap={effectiveCodemap || codemap}
        regions={regions}
        query={query}
        setQuery={handleQueryChange}
        assistantState={assistantState}
        onSubmitQuery={submitAssistantQuery}
        focused={searchFocused}
        setFocused={setSearchFocused}
        matchingBranches={matchingBranches}
        totalBranches={branches.length}
        onPickBranch={handleSelect}
        activeFilters={activeFilters}
        setActiveFilters={setActiveFilters}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        kindFilter={kindFilter}
        setKindFilter={setKindFilter}
        onUploadClick={() => fileInputRef.current?.click()}
        onDownload={downloadJSON}
        onHelp={() => setHelpOpen(true)}
      />

      {selectedBranchObj && (
        <BranchPopup
          branch={selectedBranchObj}
          regionLabel={regions[selectedBranchObj.region]?.label || selectedBranchObj.region}
          branches={branches}
          pullRequestUrl={pullRequestUrl(codemap, selectedBranchObj)}
          onClose={() => setSelected(null)}
          onJumpRelated={(name) => handleSelect(name)}
          onCopyCheckout={() => copyCheckoutCommand(selectedBranchObj)}
          onCopyClaudeCode={() => copyClaudeCodePrompt(selectedBranchObj)}
          onOpenPullRequest={() => openPullRequest(selectedBranchObj)}
        />
      )}

      <ZoomControls
        onZoomIn={() => zoomBy(1.25)}
        onZoomOut={() => zoomBy(1 / 1.25)}
        onRecenter={() => {
          const target = currentCheckout || branches[0]?.name;
          if (target) setFocusBranch({ name: target, ts: Date.now() });
        }}
      />

      <StatusBar
        hovered={hovered ? branches.find((b) => b.name === hovered) || null : null}
        matchCount={matchingBranches.length}
        totalCount={branches.length}
        hasFilters={query.length > 0 || activeFilters.size > 0 || !!statusFilter || !!kindFilter}
        currentCheckout={currentCheckout}
        repoName={codemap.name}
        onJumpToCheckout={() =>
          currentCheckout && setFocusBranch({ name: currentCheckout, ts: Date.now() })
        }
      />

      {importMessage && (
        <div className={`cm-toast cm-toast--${importMessage.type}`}>{importMessage.text}</div>
      )}

      {loadError && !importMessage && (
        <div className="cm-toast cm-toast--info">{loadError}</div>
      )}

      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} onLoadSample={loadSample} />}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadFile(f);
          e.target.value = '';
        }}
      />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Map">
          <TweakNumber
            label="Seed"
            value={effectiveSeed}
            onChange={(v) => setTweak('seed', v)}
            min={0}
            max={9999}
            step={1}
          />
          <TweakToggle
            label="Show branch labels"
            value={t.showLabels}
            onChange={(v) => setTweak('showLabels', v)}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );

  function zoomBy(factor: number) {
    window.dispatchEvent(new CustomEvent('codemap-zoom', { detail: { factor } }));
  }
}

// === Codemap JSON validation ===
const VALID_KINDS: EntryKind[] = ['branch', 'milestone', 'hotpatch', 'suggested'];
const VALID_STATUSES: BranchStatus[] = ['open', 'draft', 'merged', 'stale', 'protected', 'release'];

function validateCodemap(json: unknown): { ok: boolean; error?: string } {
  if (!json || typeof json !== 'object') return { ok: false, error: 'Not an object.' };
  const j = json as Record<string, unknown>;
  if (!Array.isArray(j.branches)) return { ok: false, error: "Missing 'branches' array." };
  if (!j.regions || typeof j.regions !== 'object')
    return { ok: false, error: "Missing 'regions' object." };
  for (const [k, r] of Object.entries(j.regions as Record<string, unknown>)) {
    const region = r as Record<string, unknown>;
    if (!region.biome) return { ok: false, error: `Region "${k}" missing biome.` };
  }
  for (const b of j.branches as Array<Record<string, unknown>>) {
    if (!b.name) return { ok: false, error: "Branch missing 'name'." };
    if (!b.region) return { ok: false, error: `Branch "${b.name}" missing 'region'.` };
    if (!(j.regions as Record<string, unknown>)[b.region as string])
      return { ok: false, error: `Branch "${b.name}" references unknown region "${b.region}".` };
    if (!b.kind) return { ok: false, error: `Branch "${b.name}" missing 'kind'.` };
    const kind = b.kind as EntryKind;
    if (!VALID_KINDS.includes(kind))
      return { ok: false, error: `Branch "${b.name}" has invalid kind "${String(b.kind)}".` };
    if (b.status !== undefined && !VALID_STATUSES.includes(b.status as BranchStatus))
      return { ok: false, error: `Branch "${b.name}" has invalid status "${String(b.status)}".` };
    if (kind === 'branch' && !b.status)
      return { ok: false, error: `Branch "${b.name}" missing 'status'.` };
  }
  return { ok: true };
}

function entryDisplayColor(branch: Branch): string {
  const kind = entryKind(branch);
  if (kind !== 'branch') return KIND_COLOR[kind];
  const status = entryStatus(branch);
  return status ? STATUS_COLOR[status] : '#888';
}

function entryDisplayLabel(branch: Branch): string {
  const kind = entryKind(branch);
  if (kind !== 'branch') return capitalize(kind);
  const status = entryStatus(branch);
  return status ? capitalize(status) : 'Branch';
}

function normalizeAssistantResult(
  result: CodemapAssistantResult,
  branches: Branch[],
  regions: CodemapData['regions']
): CodemapAssistantResult {
  if (result.action === 'link_existing') {
    if (!branches.some((branch) => branch.name === result.targetName)) {
      return {
        action: 'answer',
        message: `Claude referenced "${result.targetName}", but that entry is not on this map.`,
        targetName: '',
        suggestedBranch: emptySuggestedBranch(),
      };
    }
    return { ...result, suggestedBranch: emptySuggestedBranch() };
  }

  if (result.action === 'create_suggested') {
    const branch = normalizeSuggestedPayload(result.suggestedBranch);
    if (!branch.name) throw new Error('Claude returned a suggested branch without a name.');
    if (!regions[branch.region]) {
      return {
        action: 'answer',
        message: `Claude suggested region "${branch.region}", but that region is not on this map.`,
        targetName: '',
        suggestedBranch: emptySuggestedBranch(),
      };
    }
    return {
      action: 'create_suggested',
      message: result.message || `Created suggested branch "${branch.name}".`,
      targetName: branch.name,
      suggestedBranch: branch,
    };
  }

  return {
    action: 'answer',
    message: result.message || 'Claude returned an answer.',
    targetName: '',
    suggestedBranch: emptySuggestedBranch(),
  };
}

function normalizeSuggestedPayload(branch: SuggestedBranchPayload): SuggestedBranchPayload {
  const position = Array.isArray(branch.position) && branch.position.length >= 2
    ? [Number(branch.position[0]) || 0, Number(branch.position[1]) || 0]
    : [0, 0];

  return {
    name: String(branch.name || '').trim(),
    region: String(branch.region || '').trim(),
    position: position as [number, number],
    icon: String(branch.icon || 'tent').trim() || 'tent',
    author: String(branch.author || '—').trim() || '—',
    commits: Number.isFinite(branch.commits) ? branch.commits : 0,
    ahead: Number.isFinite(branch.ahead) ? branch.ahead : 0,
    behind: Number.isFinite(branch.behind) ? branch.behind : 0,
    lastCommit: String(branch.lastCommit || '—').trim() || '—',
    message: String(branch.message || branch.name || '').trim(),
    reviewers: Array.isArray(branch.reviewers) ? branch.reviewers.map(String) : [],
  };
}

function suggestedPayloadToBranch(branch: SuggestedBranchPayload): Branch {
  return {
    ...normalizeSuggestedPayload(branch),
    kind: 'suggested',
    pr: null,
  };
}

function emptySuggestedBranch(): SuggestedBranchPayload {
  return {
    name: '',
    region: '',
    position: [0, 0],
    icon: 'tent',
    author: '—',
    commits: 0,
    ahead: 0,
    behind: 0,
    lastCommit: '—',
    message: '',
    reviewers: [],
  };
}

// === Search panel ===
interface SearchPanelProps {
  codemap: CodemapData;
  regions: CodemapData['regions'];
  query: string;
  setQuery: (q: string) => void;
  assistantState: AssistantState;
  onSubmitQuery: () => void;
  focused: boolean;
  setFocused: (f: boolean) => void;
  matchingBranches: Branch[];
  totalBranches: number;
  onPickBranch: (name: string) => void;
  activeFilters: Set<string>;
  setActiveFilters: (f: Set<string>) => void;
  statusFilter: BranchStatus | null;
  setStatusFilter: (s: BranchStatus | null) => void;
  kindFilter: Exclude<EntryKind, 'branch'> | null;
  setKindFilter: (k: Exclude<EntryKind, 'branch'> | null) => void;
  onUploadClick: () => void;
  onDownload: () => void;
  onHelp: () => void;
}

function SearchPanel({
  codemap,
  regions,
  query,
  setQuery,
  assistantState,
  onSubmitQuery,
  focused,
  setFocused,
  matchingBranches,
  totalBranches,
  onPickBranch,
  activeFilters,
  setActiveFilters,
  statusFilter,
  setStatusFilter,
  kindFilter,
  setKindFilter,
  onUploadClick,
  onDownload,
  onHelp,
}: SearchPanelProps) {
  const regionFilters = Object.entries(regions).map(([key, r]) => ({
    key,
    label: r.label || key,
  }));

  const STATUSES = [
    { key: 'open', label: 'Open', color: STATUS_COLOR.open },
    { key: 'draft', label: 'Draft PR', color: STATUS_COLOR.draft },
    { key: 'merged', label: 'Merged', color: STATUS_COLOR.merged },
    { key: 'protected', label: 'Protected', color: STATUS_COLOR.protected },
    { key: 'release', label: 'Release', color: STATUS_COLOR.release },
    { key: 'stale', label: 'Stale', color: STATUS_COLOR.stale },
  ] satisfies Array<{ key: BranchStatus; label: string; color: string }>;

  const KINDS = [
    { key: 'milestone', label: 'Milestone', color: KIND_COLOR.milestone },
    { key: 'hotpatch', label: 'Hotpatch', color: KIND_COLOR.hotpatch },
    { key: 'suggested', label: 'Suggested', color: KIND_COLOR.suggested },
  ] satisfies Array<{ key: Exclude<EntryKind, 'branch'>; label: string; color: string }>;

  function toggleFilter(key: string) {
    const next = new Set(activeFilters);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setActiveFilters(next);
  }

  const hasAssistantResult = assistantState.status !== 'idle';
  const hasFilters = activeFilters.size > 0 || statusFilter || kindFilter || query.length > 0 || hasAssistantResult;

  const suggestions = useMemo(() => {
    const arr = [...matchingBranches];
    arr.sort((a, b) => {
      const order: Record<string, number> = {
        protected: 0,
        release: 1,
        open: 2,
        draft: 3,
        milestone: 4,
        hotpatch: 5,
        suggested: 6,
        merged: 7,
        stale: 8,
      };
      const oa = order[entryKind(a) === 'branch' ? entryStatus(a) || 'branch' : entryKind(a)] ?? 9;
      const ob = order[entryKind(b) === 'branch' ? entryStatus(b) || 'branch' : entryKind(b)] ?? 9;
      if (oa !== ob) return oa - ob;
      return 0;
    });
    return arr.slice(0, 8);
  }, [matchingBranches]);

  return (
    <div className="cm-search-panel">
      <div className="cm-repo-bar">
        <span className="cm-repo-icon" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 1.5h6.5a1 1 0 0 1 1 1V10a.5.5 0 0 1-.5.5H3a1 1 0 0 1-1-1V1.5z" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M2 8.5h7.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M4 4h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </span>
        <span className="cm-repo-name">{codemap.name || 'codemap'}</span>
        <span className="cm-repo-meta">{totalBranches} branches</span>
        <div className="cm-repo-actions">
          <button className="cm-icon-btn" onClick={onUploadClick} title="Upload .json codemap">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 8.5V1.5M3.5 4.5l3-3 3 3M2 10.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button className="cm-icon-btn" onClick={onDownload} title="Download current codemap">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 1.5v7M3.5 5.5l3 3 3-3M2 11.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button className="cm-icon-btn" onClick={onHelp} title="Schema reference">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M4.8 5c0-.9.8-1.5 1.7-1.5s1.7.6 1.7 1.4c0 .7-.6 1.1-1.2 1.4-.5.2-.5.5-.5.8M6.5 9.2v.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="cm-search-header">
        <div className="cm-search-row">
          <span className="cm-search-icon" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="4.25" stroke="currentColor" strokeWidth="1.4"/>
              <path d="M9.4 9.4l3.1 3.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </span>
          <input
            id="codemap-search"
            className="cm-search-input"
            placeholder="Search branches, authors, PRs…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && query.trim()) {
                e.preventDefault();
                onSubmitQuery();
              }
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cm-kbd">/</kbd>
        </div>

        <div className="cm-filter-row">
          {regionFilters.map((f) => (
            <button
              key={f.key}
              className={'cm-chip' + (activeFilters.has(f.key) ? ' is-active' : '')}
              onClick={() => toggleFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="cm-filter-row cm-filter-row--status">
          {STATUSES.map((s) => (
            <button
              key={s.key}
              className={'cm-status-chip' + (statusFilter === s.key ? ' is-active' : '')}
              onClick={() => setStatusFilter(statusFilter === s.key ? null : s.key)}
            >
              <span className="cm-status-dot" style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
          {KINDS.map((k) => (
            <button
              key={k.key}
              className={'cm-status-chip' + (kindFilter === k.key ? ' is-active' : '')}
              onClick={() => setKindFilter(kindFilter === k.key ? null : k.key)}
            >
              <span className="cm-status-dot" style={{ background: k.color }} />
              {k.label}
            </button>
          ))}
        </div>
      </div>

      {(focused || hasFilters) && (
        <div className="cm-suggest">
          <div className="cm-suggest-head">
            <span>
              {query
                ? `Matches for "${query}"`
                : activeFilters.size || statusFilter || kindFilter
                ? 'Filtered'
                : 'Recent activity'}
            </span>
            <span className="cm-suggest-count">
              {matchingBranches.length} / {totalBranches}
            </span>
          </div>
          <div className="cm-suggest-list">
            {assistantState.status === 'loading' && (
              <div className="cm-assistant-row cm-assistant-row--pending">
                <span className="cm-assistant-dot" />
                <span className="cm-assistant-text">Asking Claude about "{assistantState.command}"...</span>
              </div>
            )}
            {assistantState.status === 'error' && (
              <div className="cm-assistant-row cm-assistant-row--error">
                <span className="cm-assistant-dot" />
                <span className="cm-assistant-text">{assistantState.error}</span>
              </div>
            )}
            {assistantState.status === 'result' && (
              assistantState.result.action === 'link_existing' || assistantState.result.action === 'create_suggested' ? (
                <button
                  className="cm-assistant-row cm-assistant-row--button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onPickBranch(assistantState.result.targetName);
                  }}
                >
                  <span className="cm-assistant-dot" />
                  <span className="cm-assistant-text">{assistantState.result.message}</span>
                  <span className="cm-assistant-target">{shortLabel(assistantState.result.targetName)}</span>
                </button>
              ) : (
                <div className="cm-assistant-row">
                  <span className="cm-assistant-dot" />
                  <span className="cm-assistant-text">{assistantState.result.message}</span>
                </div>
              )
            )}
            {suggestions.length === 0 && (
              <div className="cm-suggest-empty">No branches match. Try a different query.</div>
            )}
            {suggestions.map((b) => (
              <button
                key={b.name}
                className="cm-suggest-row"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPickBranch(b.name);
                }}
              >
                <span
                  className="cm-suggest-dot"
                  style={{ background: entryDisplayColor(b) }}
                />
                <span className="cm-suggest-name">{b.name}</span>
                <span className="cm-suggest-meta">
                  <span className="cm-suggest-author">{b.author}</span>
                  <span className="cm-suggest-time">· {b.lastCommit}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="cm-suggest-footer">
            <kbd className="cm-kbd cm-kbd--sm">↵</kbd>
            <span>ask Claude</span>
            <span className="cm-suggest-spacer" />
            <kbd className="cm-kbd cm-kbd--sm">esc</kbd>
            <span>close</span>
          </div>
        </div>
      )}
    </div>
  );
}

// === Branch popup ===
interface BranchPopupProps {
  branch: Branch;
  regionLabel: string;
  branches: Branch[];
  pullRequestUrl: string | null;
  onClose: () => void;
  onJumpRelated: (name: string) => void;
  onCopyCheckout: () => void;
  onCopyClaudeCode: () => void;
  onOpenPullRequest: () => void;
}

function BranchPopup({
  branch,
  regionLabel,
  branches,
  pullRequestUrl,
  onClose,
  onJumpRelated,
  onCopyCheckout,
  onCopyClaudeCode,
  onOpenPullRequest,
}: BranchPopupProps) {
  const kind = entryKind(branch);
  const status = entryStatus(branch);
  const isRealBranch = kind === 'branch';
  const isSuggested = kind === 'suggested';
  const markerColor = entryDisplayColor(branch);
  const related = useMemo(
    () =>
      branches.filter((b) => b.name !== branch.name && b.region === branch.region).slice(0, 4),
    [branch, branches]
  );

  return (
    <div className="cm-popup">
      <div
        className="cm-popup-header"
        style={{ borderLeftColor: markerColor }}
      >
        <div className="cm-popup-region">{regionLabel}</div>
        <h2 className="cm-popup-name" title={branch.name}>
          {branch.name}
        </h2>
        <button className="cm-popup-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="cm-popup-stats">
        {!isRealBranch && (
          <div className="cm-stat">
            <span className="cm-stat-label">Kind</span>
            <span className="cm-stat-value">
              <span className="cm-status-dot" style={{ background: markerColor }} />
              {entryDisplayLabel(branch)}
            </span>
          </div>
        )}
        {status && (
          <div className="cm-stat">
            <span className="cm-stat-label">Status</span>
            <span className="cm-stat-value">
              <span className="cm-status-dot" style={{ background: markerColor }} />
              {capitalize(status)}
            </span>
          </div>
        )}
        {branch.pr && (
          <div className="cm-stat">
            <span className="cm-stat-label">PR</span>
            <span className="cm-stat-value cm-mono">{branch.pr}</span>
          </div>
        )}
        <div className="cm-stat">
          <span className="cm-stat-label">Author</span>
          <span className="cm-stat-value cm-mono">{branch.author}</span>
        </div>
      </div>

      <div className="cm-popup-divergence">
        <div className="cm-div-bar">
          <span className="cm-div-ahead">↑ {branch.ahead}</span>
          <span className="cm-div-sep">ahead</span>
          <span className="cm-div-spacer" />
          <span className="cm-div-behind">↓ {branch.behind}</span>
          <span className="cm-div-sep">behind</span>
        </div>
        <DivergenceBar ahead={branch.ahead || 0} behind={branch.behind || 0} />
      </div>

      <div className="cm-popup-commit">
        <div className="cm-popup-section-label">
          {isRealBranch ? `Latest commit · ${branch.lastCommit || '—'}` : 'Summary'}
        </div>
        <div className="cm-popup-message">{branch.message}</div>
      </div>

      {branch.reviewers && branch.reviewers.length > 0 && (
        <div className="cm-popup-reviewers">
          <div className="cm-popup-section-label">Reviewers</div>
          <div className="cm-popup-avatars">
            {branch.reviewers.map((r) => (
              <span key={r} className="cm-avatar" title={r}>
                {r
                  .split('.')
                  .map((p) => p[0])
                  .join('')
                  .toUpperCase()}
              </span>
            ))}
          </div>
        </div>
      )}

      {related.length > 0 && (
        <div className="cm-popup-related">
          <div className="cm-popup-section-label">Nearby in {regionLabel}</div>
          {related.map((r) => (
            <button key={r.name} className="cm-related-row" onClick={() => onJumpRelated(r.name)}>
              <span
                className="cm-status-dot"
                style={{ background: entryDisplayColor(r) }}
              />
              <span className="cm-related-name">{shortLabel(r.name)}</span>
              <span className="cm-related-arrow">→</span>
            </button>
          ))}
        </div>
      )}

      {isRealBranch && (
        <div className="cm-popup-actions">
          <button className="cm-action cm-action--primary" onClick={onCopyCheckout}>
            <span className="cm-action-icon">⎘</span>
            <span>Copy checkout</span>
          </button>
          {pullRequestUrl && (
            <button className="cm-action" onClick={onOpenPullRequest}>
              <span className="cm-action-icon">↗</span>
              <span>{branch.pr ? 'Open PR' : 'Create PR'}</span>
            </button>
          )}
        </div>
      )}
      {isSuggested && (
        <div className="cm-popup-actions">
          <button className="cm-action cm-action--primary" onClick={onCopyClaudeCode}>
            <span className="cm-action-icon">⎘</span>
            <span>Copy to Claude Code</span>
          </button>
        </div>
      )}
    </div>
  );
}

function DivergenceBar({ ahead, behind }: { ahead: number; behind: number }) {
  const total = ahead + behind || 1;
  const ap = (ahead / total) * 100;
  const bp = (behind / total) * 100;
  return (
    <div className="cm-divbar">
      <div className="cm-divbar-ahead" style={{ width: `${ap}%` }} />
      <div className="cm-divbar-behind" style={{ width: `${bp}%` }} />
    </div>
  );
}

function checkoutCommandForBranch(branchName: string): string {
  const remotePrefix = 'remotes/origin/';
  if (branchName.startsWith(remotePrefix)) {
    return `git checkout --track ${shellArg('origin/' + branchName.slice(remotePrefix.length))}`;
  }
  return `git checkout ${shellArg(branchName)}`;
}

function claudeCodePromptForSuggestedBranch(branch: Branch): string {
  const summary = branch.message || branch.name;
  return [
    `Create a new branch called \`${branch.name}\` for this repository.`,
    '',
    'Then use plan mode to come up with an implementation plan for this suggested work:',
    '',
    summary,
  ].join('\n');
}

function pullRequestUrl(codemap: CodemapData, branch: Branch): string | null {
  if (entryKind(branch) !== 'branch') return null;
  const repoUrl = githubRepoUrl(codemap.repo?.webUrl || codemap.repo?.remoteUrl || null);
  if (!repoUrl) return null;

  const prNumber = parsePullRequestNumber(branch.pr);
  if (prNumber) return `${repoUrl}/pull/${prNumber}`;

  const base = codemap.repo?.defaultBranch || 'main';
  const head = branch.name.startsWith('remotes/origin/')
    ? branch.name.slice('remotes/origin/'.length)
    : branch.name;
  if (!head || head === base || entryStatus(branch) === 'protected') return null;

  return `${repoUrl}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?expand=1`;
}

function githubRepoUrl(remote: string | null): string | null {
  if (!remote) return null;
  const clean = remote.trim().replace(/\/$/, '').replace(/\.git$/, '');
  const https = clean.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);
  if (https) return `https://github.com/${https[1]}/${https[2]}`;

  const ssh = clean.match(/^git@github\.com:([^/]+)\/([^/]+)$/);
  if (ssh) return `https://github.com/${ssh[1]}/${ssh[2]}`;

  const sshUrl = clean.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+)$/);
  if (sshUrl) return `https://github.com/${sshUrl[1]}/${sshUrl[2]}`;

  return null;
}

function parsePullRequestNumber(pr: string | null | undefined): string | null {
  if (!pr) return null;
  const match = pr.match(/\d+/);
  return match ? match[0] : null;
}

function shellArg(value: string): string {
  return /^[A-Za-z0-9._/@:-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the selection API below.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) throw new Error('Copy failed');
}

function ZoomControls({
  onZoomIn,
  onZoomOut,
  onRecenter,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRecenter: () => void;
}) {
  return (
    <div className="cm-zoom">
      <button className="cm-zoom-btn" onClick={onRecenter} title="Recenter on main">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="2" fill="currentColor"/>
          <path d="M7 1v2M7 11v2M1 7h2M11 7h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
      <div className="cm-zoom-divider" />
      <button className="cm-zoom-btn" onClick={onZoomIn} title="Zoom in">
        +
      </button>
      <button className="cm-zoom-btn" onClick={onZoomOut} title="Zoom out">
        −
      </button>
    </div>
  );
}

function StatusBar({
  hovered,
  matchCount,
  totalCount,
  hasFilters,
  currentCheckout,
  repoName,
  onJumpToCheckout,
}: {
  hovered: Branch | null;
  matchCount: number;
  totalCount: number;
  hasFilters: boolean;
  currentCheckout: string | undefined;
  repoName: string;
  onJumpToCheckout: () => void;
}) {
  return (
    <div className="cm-statusbar">
      {currentCheckout ? (
        <button
          className="cm-status-checkout"
          onClick={onJumpToCheckout}
          title="Jump to current branch"
        >
          <span className="cm-checkout-pin" />
          <span className="cm-status-key">HEAD</span>
          <span className="cm-mono">{currentCheckout}</span>
        </button>
      ) : (
        <span className="cm-status-section">
          <span className="cm-status-key">repo</span>
          <span className="cm-mono">{repoName}</span>
        </span>
      )}
      <span className="cm-status-sep">·</span>
      <span className="cm-status-section">
        <span className="cm-status-key">branches</span>
        <span className="cm-mono">{hasFilters ? `${matchCount}/${totalCount}` : totalCount}</span>
      </span>
      <span className="cm-status-sep">·</span>
      <span className="cm-status-section">
        <span className="cm-status-key">tile</span>
        <span className="cm-mono">{hovered ? hovered.name : '—'}</span>
      </span>
    </div>
  );
}

function HelpOverlay({
  onClose,
  onLoadSample,
}: {
  onClose: () => void;
  onLoadSample: (path: string) => void;
}) {
  const [samples, setSamples] = useState<Array<{ path: string; name: string; branches: number }>>([]);
  useEffect(() => {
    fetch('/api/samples')
      .then((r) => r.json())
      .then(setSamples)
      .catch(() => {});
  }, []);
  return (
    <div className="cm-help-overlay" onClick={onClose}>
      <div className="cm-help-card" onClick={(e) => e.stopPropagation()}>
        <div className="cm-help-header">
          <h2>Codemap JSON format</h2>
          <button className="cm-popup-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="cm-help-body">
          <p>
            Upload a <code>.json</code> file with this shape. Drop it anywhere on the page, or use
            the ↑ icon in the top bar.
          </p>

          <div className="cm-help-section-title">Try a sample</div>
          <div className="cm-help-samples">
            {samples.map((s) => (
              <button key={s.path} className="cm-sample-btn" onClick={() => onLoadSample(s.path)}>
                <span className="cm-sample-name">{s.name}</span>
                <span className="cm-sample-meta">
                  {s.branches} branches · {s.path}
                </span>
              </button>
            ))}
          </div>

          <div className="cm-help-section-title">Schema</div>
          <pre className="cm-help-pre">{`{
  "$schema": "codemap@1",
  "name": "owner/repo",
  "repo": {
    "remoteUrl": "git@github.com:owner/repo.git",
    "webUrl": "https://github.com/owner/repo",
    "defaultBranch": "main"
  },
  "seed": 1337,
  "head": "feature/auth-passkeys",
  "regions": {
    "feat-auth": {
      "label": "Auth",
      "biome": "forest",
      "center": [-2.0, -2.0],
      "spread": 0.7
    },
    ...
  },
  "branches": [
    {
      "name": "feature/auth-passkeys",
      "region": "feat-auth",
      "kind": "branch",
      "position": [-2.2, -2.4],
      "icon": "house",
      "author": "mira.k",
      "status": "open",
      "ahead": 31, "behind": 4,
      "lastCommit": "2h ago",
      "message": "auth: WebAuthn ���",
      "pr": "#2847",
      "reviewers": ["ana.r"]
    }
  ]
}`}</pre>
          <div className="cm-help-grid">
            <div>
              <div className="cm-help-label">Biomes</div>
              <code>plains · forest · mountain · water · swamp · desert · volcanic</code>
            </div>
            <div>
              <div className="cm-help-label">Icons</div>
              <code>
                castle · fortress · tower · keep · house · hut · tent · pickaxe · rock · fort ·
                ship · volcano · ruin · obelisk
              </code>
            </div>
            <div>
              <div className="cm-help-label">Kinds</div>
              <code>branch · milestone · hotpatch · suggested</code>
            </div>
            <div>
              <div className="cm-help-label">Status</div>
              <code>protected · release · open · draft · merged · stale</code>
            </div>
            <div>
              <div className="cm-help-label">Region center</div>
              <code>
                [x, y] origin-centered — main at [0,0]. Branches cluster around this
                point. Typical range [-5, 5]. Expand outward for new areas.
              </code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function shortLabel(name: string): string {
  const idx = name.indexOf('/');
  if (idx < 0) return name;
  return name.slice(idx + 1);
}
