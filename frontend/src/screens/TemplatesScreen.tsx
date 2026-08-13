import React, { useState, useRef, useEffect, useMemo, useCallback, type ChangeEvent } from 'react';
import {
  Sparkles,
  Library,
  Star,
  Grid,
  List,
  Columns,
  Search,
  X,
  Download,
  Upload,
  BookOpen,
  ChevronDown,
  ExternalLink,
  ArrowRight,
  Loader2,
  Clock,
  Tag
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router';
import { api } from '../api';
import type { Template, ImportResult } from '../types';
import { ApplyTemplateModal } from '../components/ApplyTemplateModal';
import { platformLabel } from '../platform';
import { usePlatformCreatability, type Creatability } from '../hooks/usePlatformMatrix';
import { useSettings, type TemplateView } from '../hooks/useSettings';
import { useScheduleZone } from '../hooks/useScheduleZone';
import { TEMPLATE_RESOURCES } from '../data/templateResources';
import { useToast } from '../hooks/useToast';
import { HelpButton } from '../components/HelpButton';

// Human labels for the enum-ish template facets (see backend/src/seed.ts).
const TEMPLATE_OS_LABELS: Record<string, string> = {
  WINDOWS: 'Windows',
  MACOS: 'macOS',
  LINUX: 'Linux',
  CROSS_PLATFORM: 'Cross-platform'
};
const TEMPLATE_CATEGORY_LABELS: Record<string, string> = {
  BACKUP: 'Backup',
  AI_AGENT: 'AI Agent',
  CLEANUP: 'Cleanup',
  DEV_WORKFLOW: 'Dev Workflow',
  MONITORING: 'Monitoring',
  REPORTING: 'Reporting',
  MAINTENANCE: 'Maintenance',
  OTHER: 'Other'
};
const titleCaseEnum = (raw: string) =>
  raw.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
const templateOsLabel = (os: string) => TEMPLATE_OS_LABELS[os] ?? titleCaseEnum(os);
const templateCategoryLabel = (c: string) => TEMPLATE_CATEGORY_LABELS[c] ?? titleCaseEnum(c);

type TemplateKind = 'all' | 'starters' | 'patterns';

const templateHaystack = (t: Template) =>
  [t.name, t.description, t.command, t.category, t.scriptType, t.os, ...(t.targetPlatforms ?? []), ...(t.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const matchesTemplateSearch = (t: Template, query: string) => {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = templateHaystack(t);
  return terms.every(term => hay.includes(term));
};

const byTemplateName = (a: Template, b: Template) => a.name.localeCompare(b.name);

// Favorites float to the top of a group, then alphabetical within each tier.
const byFavoriteThenName = (a: Template, b: Template) =>
  (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0) || byTemplateName(a, b);

// Count occurrences of a facet value across a list, pinning the selected value
// so it stays visible (as a 0-count chip) even after it's filtered everything out.
const buildTemplateFacet = (list: Template[], key: (t: Template) => string | undefined, pin: string) => {
  const counts = new Map<string, number>();
  for (const t of list) {
    const k = key(t);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (pin !== 'All' && !counts.has(pin)) counts.set(pin, 0);
  return counts;
};

// Tags are multi-valued per template, so count each tag across all templates
// (a template contributes to every tag it carries), pinning the selected tag.
const buildTemplateTagFacet = (list: Template[], pin: string) => {
  const counts = new Map<string, number>();
  for (const t of list) {
    for (const tag of t.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  if (pin !== 'All' && !counts.has(pin)) counts.set(pin, 0);
  return counts;
};

/**
 * Targets, counted the same way as tags — a template contributes to every
 * platform it declares.
 *
 * Added 2026-08-13 with the Cronsole-native and Claude-routine families. Until
 * then the catalog was Windows and a handful of macOS patterns, so "which
 * platform is this for?" was answered well enough by the OS chips. It is not any
 * more: `cross-platform` now covers a Cronsole-native script, a Claude routine
 * and a git command for the Windows agent, which are three different things to
 * anyone deciding what they can actually use.
 */
const buildTemplateTargetFacet = (list: Template[], pin: string) => {
  const counts = new Map<string, number>();
  for (const t of list) {
    for (const p of t.targetPlatforms ?? []) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  if (pin !== 'All' && !counts.has(pin)) counts.set(pin, 0);
  return counts;
};

const TemplateChip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
      active
        ? 'bg-primary border-primary text-primary-foreground shadow-lg shadow-primary/20'
        : 'bg-surface border-border text-muted-foreground hover:border-foreground/20'
    }`}
  >
    {children}
  </button>
);

// Per-user favorite toggle (a star) shown on template cards/rows. Optimistic —
// the click flips template.isFavorite via the ['templates'] cache immediately.
const FavoriteStar = ({ template, onToggle, size = 16 }: { template: Template; onToggle: (t: Template) => void; size?: number }) => (
  <button
    onClick={e => { e.stopPropagation(); onToggle(template); }}
    aria-pressed={!!template.isFavorite}
    title={template.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
    className={`shrink-0 transition-colors ${template.isFavorite ? 'text-warning-text hover:text-warning-text' : 'text-subtle-foreground hover:text-warning-text'}`}
  >
    <Star size={size} className={template.isFavorite ? 'fill-current' : ''} />
  </button>
);

/**
 * A template's schedule as the Apply modal will pre-fill it.
 *
 * Registry schedules are UTC, but Apply now reads them into the user's zone —
 * so printing the raw expression here meant the card said `0 8 * * *` and the
 * modal it opened said `0 1 * * *`, with nothing connecting the two. Showing one
 * reading in both places is the fix; the zone marker keeps it honest.
 */
const TemplateSchedule = ({ template, className }: { template: Template; className?: string }) => {
  const zone = useScheduleZone();
  const shifted = zone.toZone(template.scheduleExpression);
  return (
    <>
      <code className={className}>{shifted.cron}</code>
      {/* A refusal leaves the expression in UTC, so it must not be labelled otherwise. */}
      <span className="text-subtle-foreground italic ml-auto">
        {shifted.reason ? 'UTC' : zone.label}
      </span>
    </>
  );
};

/**
 * The "Compatible with" badges — one per declared target, styled by what
 * Cronsole can actually do with that target **on this install**.
 *
 * Three states, because the matrix has three answers. `unknown` (the matrix has
 * not landed) renders as a plain badge with no claim attached: a target marked
 * "can't create here" because a request is still in flight would be an assertion
 * made from an absence.
 */
const TargetBadges = ({ template, creatability }: { template: Template; creatability: (p: string) => Creatability }) => (
  <div className="flex items-center gap-2 flex-wrap mb-6">
    <span className="text-[10px] font-black uppercase tracking-widest text-subtle-foreground">Compatible with</span>
    {template.targetPlatforms.map(p => {
      const can = creatability(p);
      return (
        <span
          key={p}
          title={
            can === 'yes' ? 'Cronsole can create this task here'
              : can === 'no' ? 'Compatible pattern — Cronsole can’t create tasks here on this install'
                : 'Checking what Cronsole can do here…'
          }
          className={`text-[9px] uppercase font-black px-2 py-0.5 rounded-full border ${
            can === 'yes'
              ? 'bg-primary/15 text-foreground border-primary/30'
              : can === 'no'
                ? 'bg-muted text-subtle-foreground border-border opacity-70'
                : 'bg-muted text-subtle-foreground border-border'
          }`}
        >
          {platformLabel(p)}{can === 'no' && ' *'}
        </span>
      );
    })}
  </div>
);

const TemplateCard = ({ template, onApply, onToggleFavorite, creatability }: { template: Template; onApply: (t: Template) => void; onToggleFavorite: (t: Template) => void; creatability: (p: string) => Creatability }) => (
  <div className="bg-surface border border-border rounded-3xl overflow-hidden flex flex-col shadow-2xl transition-all hover:border-primary/30 group">
    <div className="p-6 flex-1">
      <div className="flex items-start justify-between gap-2 mb-4">
        <div className="flex flex-wrap gap-2">
          {template.isStarter && (
            <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded-full bg-primary/15 text-foreground border border-primary/30 flex items-center gap-1">
              <Sparkles size={9} /> Starter
            </span>
          )}
          {template.scriptType && (
            <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded-full bg-claude/10 text-claude-text border border-claude/20">
              {template.scriptType.replace(/_/g, ' ')}
            </span>
          )}
        </div>
        <FavoriteStar template={template} onToggle={onToggleFavorite} size={18} />
      </div>

      <h3 className="text-xl font-bold mb-2 group-hover:text-foreground transition-colors">{template.name}</h3>
      <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{template.description}</p>

      {/* "Compatible with" — honest framing: what Cronsole can create on THIS
          install is highlighted, the rest are compatibility labels only, so a
          badge never implies a one-click apply that silently fails. */}
      <TargetBadges template={template} creatability={creatability} />

      <div className="space-y-3">
        <div className="flex items-center gap-3 text-xs bg-background p-3 rounded-2xl border border-border/50">
          <Clock size={14} className="text-foreground" />
          <TemplateSchedule template={template} className="text-foreground font-mono" />
        </div>
        <div className="flex items-center gap-3 text-xs bg-background p-3 rounded-2xl border border-border/50">
          <ExternalLink size={14} className="text-claude-text" />
          <span className="truncate text-foreground italic">{template.command}</span>
        </div>
      </div>

      {template.tags && template.tags.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mt-4">
          {template.tags.map(tag => (
            <span key={tag} className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-background text-subtle-foreground border border-border/60 flex items-center gap-1">
              <Tag size={9} /> {tag}
            </span>
          ))}
        </div>
      )}
    </div>

    <button onClick={() => onApply(template)} className="w-full bg-muted hover:bg-primary-hover text-foreground hover:text-primary-foreground py-4 font-bold flex items-center justify-center gap-2 transition-all border-t border-border group-hover:border-primary/20">
      Apply Template <ArrowRight size={16} />
    </button>
  </div>
);

// Compact single-line row used by the List view.
const TemplateListRow = ({ template, onApply, onToggleFavorite }: { template: Template; onApply: (t: Template) => void; onToggleFavorite: (t: Template) => void }) => (
  <div className="bg-surface border border-border rounded-2xl px-4 py-3 flex items-center gap-4 hover:border-primary/30 transition-all">
    <FavoriteStar template={template} onToggle={onToggleFavorite} size={16} />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 flex-wrap mb-0.5">
        <h4 className="text-sm font-bold text-foreground truncate">{template.name}</h4>
        {template.isStarter && (
          <span className="text-[9px] uppercase font-black px-1.5 py-0.5 rounded-full bg-primary/15 text-foreground border border-primary/30">Starter</span>
        )}
        {template.scriptType && (
          <span className="text-[9px] uppercase font-black px-1.5 py-0.5 rounded-full bg-claude/10 text-claude-text border border-claude/20">{template.scriptType.replace(/_/g, ' ')}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground truncate">{template.description}</p>
    </div>
    <div className="hidden sm:flex items-center gap-1.5 text-[11px] shrink-0">
      <TemplateSchedule template={template} className="font-mono text-subtle-foreground" />
    </div>
    <button
      onClick={() => onApply(template)}
      className="shrink-0 bg-muted hover:bg-primary-hover text-foreground hover:text-primary-foreground px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all border border-border"
    >
      Apply <ArrowRight size={13} />
    </button>
  </div>
);

const TemplateGroup = ({ icon: Icon, title, subtitle, templates, onApply, onToggleFavorite, creatability, view = 'grid' }: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  templates: Template[];
  onApply: (t: Template) => void;
  onToggleFavorite: (t: Template) => void;
  creatability: (p: string) => Creatability;
  view?: 'grid' | 'list';
}) => {
  if (templates.length === 0) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-foreground uppercase tracking-wider">
          <Icon size={15} /> {title}
          <span className="text-xs font-bold text-subtle-foreground bg-muted px-2 py-0.5 rounded-full">{templates.length}</span>
        </h3>
        <span className="text-xs text-subtle-foreground">{subtitle}</span>
      </div>
      {view === 'list' ? (
        <div className="space-y-2">
          {templates.map(t => <TemplateListRow key={t.id} template={t} onApply={onApply} onToggleFavorite={onToggleFavorite} />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {templates.map(t => <TemplateCard key={t.id} template={t} onApply={onApply} onToggleFavorite={onToggleFavorite} creatability={creatability} />)}
        </div>
      )}
    </div>
  );
};

// Kanban lane card — compact vertical card stacked inside a category column.
const TemplateKanbanCard = ({ template, onApply, onToggleFavorite }: { template: Template; onApply: (t: Template) => void; onToggleFavorite: (t: Template) => void }) => (
  <div className="bg-background border border-border rounded-xl p-3 space-y-2 hover:border-primary/30 transition-all">
    <div className="flex items-start justify-between gap-2">
      <h4 className="text-sm font-bold text-foreground leading-tight">{template.name}</h4>
      <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
        {template.isStarter && <Sparkles size={12} className="text-foreground" />}
        <FavoriteStar template={template} onToggle={onToggleFavorite} size={13} />
      </div>
    </div>
    <p className="text-[11px] text-muted-foreground line-clamp-2 leading-snug">{template.description}</p>
    <div className="flex items-center justify-between gap-2 pt-1">
      <div className="flex items-center gap-1.5 text-[10px] min-w-0">
        <TemplateSchedule template={template} className="font-mono text-subtle-foreground truncate" />
      </div>
      <button onClick={() => onApply(template)} className="shrink-0 text-[11px] font-bold text-primary hover:text-primary-hover flex items-center gap-1">
        Apply <ArrowRight size={11} />
      </button>
    </div>
  </div>
);

// Kanban view: one lane per category (Tag), horizontally scrollable.
const TemplateKanban = ({ templates, onApply, onToggleFavorite }: { templates: Template[]; onApply: (t: Template) => void; onToggleFavorite: (t: Template) => void }) => {
  const lanes = useMemo(() => {
    const map = new Map<string, Template[]>();
    for (const t of templates) {
      const key = t.category ?? 'OTHER';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries())
      .map(([cat, items]) => ({ cat, items: [...items].sort(byFavoriteThenName) }))
      .sort((a, b) => templateCategoryLabel(a.cat).localeCompare(templateCategoryLabel(b.cat)));
  }, [templates]);

  return (
    <div className="flex gap-4 overflow-x-auto pb-20">
      {lanes.map(lane => (
        <div key={lane.cat} className="shrink-0 w-72 space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-black uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <Tag size={11} /> {templateCategoryLabel(lane.cat)}
            </h3>
            <span className="text-[10px] font-bold text-subtle-foreground bg-muted px-1.5 py-0.5 rounded-full">{lane.items.length}</span>
          </div>
          <div className="space-y-3">
            {lane.items.map(t => <TemplateKanbanCard key={t.id} template={t} onApply={onApply} onToggleFavorite={onToggleFavorite} />)}
          </div>
        </div>
      ))}
    </div>
  );
};

// Templates-tab view switcher (persisted to settings.templateView).
const TEMPLATE_VIEWS: { id: TemplateView; label: string; icon: LucideIcon }[] = [
  { id: 'grid', label: 'Grid', icon: Grid },
  { id: 'list', label: 'List', icon: List },
  { id: 'kanban', label: 'Kanban', icon: Columns }
];
const TemplateViewToggle = ({ view, onChange }: { view: TemplateView; onChange: (v: TemplateView) => void }) => (
  <div className="flex bg-surface border border-border p-1 rounded-xl items-center shadow-md shrink-0">
    {TEMPLATE_VIEWS.map(({ id, label, icon: Icon }) => (
      <button
        key={id}
        onClick={() => onChange(id)}
        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${view === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
      >
        <Icon size={12} /> {label}
      </button>
    ))}
  </div>
);

// Templates-tab "Resources" dropdown — curated external links (see data/templateResources.ts).
const TemplateResourcesMenu = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 bg-surface border border-border px-3 py-1.5 rounded-xl text-xs font-bold text-muted-foreground hover:text-foreground transition-all shadow-md"
      >
        <BookOpen size={13} /> Resources <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-[70vh] overflow-y-auto bg-surface border border-border rounded-2xl shadow-2xl z-50 p-2">
          {TEMPLATE_RESOURCES.map(section => (
            <div key={section.title} className="px-1 py-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-subtle-foreground px-2 mb-1">{section.title}</p>
              <div className="space-y-0.5">
                {section.links.map(link => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-2 py-1.5 rounded-lg hover:bg-background transition-colors group/link"
                  >
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                      {link.label}
                      <ExternalLink size={11} className="text-subtle-foreground opacity-0 group-hover/link:opacity-100 transition-opacity" />
                    </div>
                    {link.description && <p className="text-[11px] text-subtle-foreground leading-snug">{link.description}</p>}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Export the catalog to a JSON file / import a Registry v1 JSON file back in.
// Export goes through the api client (not a bare <a href>) so the auth header
// rides along; import posts the parsed file and reports a per-item summary.
const TemplateImportExport = () => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleExport = async () => {
    setBusy('export');
    try {
      const res = await api.get('/templates/export', { responseType: 'blob' });
      const cd = res.headers['content-disposition'] as string | undefined;
      const filename = cd?.match(/filename="?([^"]+)"?/)?.[1] ?? 'cronsole-catalog.json';
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Catalog exported.', 'success');
    } catch {
      toast('Export failed — is the backend running?', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setBusy('import');
    try {
      const json = JSON.parse(await file.text());
      const res = await api.post('/templates/import', json);
      summarizeImport(res.data, toast);
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    } catch (err) {
      const anyErr = err as { response?: { data?: ImportResult }; name?: string };
      if (anyErr.response?.data) {
        // 400 from the server (nothing imported / all invalid) — show why.
        summarizeImport(anyErr.response.data, toast);
        queryClient.invalidateQueries({ queryKey: ['templates'] });
      } else if (err instanceof SyntaxError) {
        toast('Import failed — that file is not valid JSON.', 'error');
      } else {
        toast('Import failed — is the backend running?', 'error');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleExport}
        disabled={busy !== null}
        className="flex items-center gap-1.5 bg-surface border border-border px-3 py-1.5 rounded-xl text-xs font-bold text-muted-foreground hover:text-foreground transition-all shadow-md disabled:opacity-50"
        title="Download the template catalog as JSON"
      >
        {busy === 'export' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export
      </button>
      <button
        onClick={() => fileRef.current?.click()}
        disabled={busy !== null}
        className="flex items-center gap-1.5 bg-surface border border-border px-3 py-1.5 rounded-xl text-xs font-bold text-muted-foreground hover:text-foreground transition-all shadow-md disabled:opacity-50"
        title="Import templates from a JSON file"
      >
        {busy === 'import' ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Import
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFile}
        className="hidden"
      />
    </div>
  );
};

/** Turn an /templates/import result into a single honest toast. */
function summarizeImport(
  result: ImportResult,
  toast: (message: string, type?: 'success' | 'error') => void
): void {
  const imported = result.created.length + result.updated.length;
  const parts: string[] = [];
  if (result.created.length) parts.push(`${result.created.length} added`);
  if (result.updated.length) parts.push(`${result.updated.length} updated`);
  if (result.errors.length) parts.push(`${result.errors.length} skipped`);
  const summary = parts.length ? parts.join(', ') : 'nothing to import';

  if (imported === 0) {
    const first = result.errors[0]?.error;
    toast(`Import failed: ${first ?? summary}.`, 'error');
    return;
  }
  const detail = result.errors.length ? ` (first issue: ${result.errors[0].error})` : '';
  toast(`Imported ${summary}.${detail}`, result.errors.length ? 'error' : 'success');
}

export const TemplatesScreen = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const openTemplate = (t: Template) => navigate(`/templates/${t.id}`);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<TemplateKind>('all');
  const [selectedOs, setSelectedOs] = useState('All');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedTag, setSelectedTag] = useState('All');
  const [selectedTarget, setSelectedTarget] = useState('All');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const { settings, update } = useSettings();
  const view = settings.templateView;
  // What Cronsole can create where, from the server's capability matrix — never
  // a constant in this bundle (see hooks/usePlatformMatrix.ts).
  const { creatability } = usePlatformCreatability();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ['templates'],
    queryFn: async () => {
      try {
        const response = await api.get('/templates');
        return response.data;
      } catch (err) {
        console.error('Failed to fetch templates:', err);
        return [];
      }
    }
  });

  // The Apply modal is driven by /templates/:id (bookmarkable, back/forward).
  const routeTemplateId = location.pathname.split('/')[2];
  const applyTarget = routeTemplateId
    ? (templates ?? []).find(t => t.id === routeTemplateId) ?? null
    : null;

  // Toggle a per-user favorite. Optimistic: flip isFavorite in the ['templates']
  // cache immediately (snappy star), roll back on error, then reconcile on settle.
  const favoriteMutation = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: boolean }) =>
      next ? api.post(`/templates/${id}/favorite`) : api.delete(`/templates/${id}/favorite`),
    onMutate: async ({ id, next }) => {
      await queryClient.cancelQueries({ queryKey: ['templates'] });
      const prev = queryClient.getQueryData<Template[]>(['templates']);
      queryClient.setQueryData<Template[]>(['templates'], old =>
        (old ?? []).map(t => (t.id === id ? { ...t, isFavorite: next } : t)));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['templates'], ctx.prev);
      toast('Could not update favorite — try again.', 'error');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['templates'] })
  });
  const toggleFavorite = (t: Template) => favoriteMutation.mutate({ id: t.id, next: !t.isFavorite });

  const all = useMemo(() => templates ?? [], [templates]);

  // Narrow by the "kind" toggle + search first; the OS/category facets and the
  // final grid all build off this so counts reflect the current constraints.
  const searchKindFiltered = useMemo(() => {
    let list = all;
    if (kind === 'starters') list = list.filter(t => t.isStarter);
    else if (kind === 'patterns') list = list.filter(t => !t.isStarter);
    if (favoritesOnly) list = list.filter(t => t.isFavorite);
    if (search.trim()) list = list.filter(t => matchesTemplateSearch(t, search));
    return list;
  }, [all, kind, favoritesOnly, search]);

  // Faceted OS / Category / Tag chips: each facet is counted over the list
  // narrowed by the *other two* selections, so an empty combination drops out
  // instead of showing a 0-count chip.
  const narrow = useCallback((
    list: Template[],
    opts: { os?: boolean; category?: boolean; tag?: boolean; target?: boolean }
  ) => {
    let out = list;
    if (opts.os && selectedOs !== 'All') out = out.filter(t => (t.os ?? '') === selectedOs);
    if (opts.category && selectedCategory !== 'All') out = out.filter(t => (t.category ?? '') === selectedCategory);
    if (opts.tag && selectedTag !== 'All') out = out.filter(t => (t.tags ?? []).includes(selectedTag));
    if (opts.target && selectedTarget !== 'All') out = out.filter(t => (t.targetPlatforms ?? []).includes(selectedTarget));
    return out;
  }, [selectedOs, selectedCategory, selectedTag, selectedTarget]);

  const osFacets = useMemo(
    () => buildTemplateFacet(narrow(searchKindFiltered, { category: true, tag: true, target: true }), t => t.os, selectedOs),
    [searchKindFiltered, narrow, selectedOs]
  );
  const categoryFacets = useMemo(
    () => buildTemplateFacet(narrow(searchKindFiltered, { os: true, tag: true, target: true }), t => t.category, selectedCategory),
    [searchKindFiltered, narrow, selectedCategory]
  );
  const tagFacets = useMemo(
    () => buildTemplateTagFacet(narrow(searchKindFiltered, { os: true, category: true, target: true }), selectedTag),
    [searchKindFiltered, narrow, selectedTag]
  );
  const targetFacets = useMemo(
    () => buildTemplateTargetFacet(narrow(searchKindFiltered, { os: true, category: true, tag: true }), selectedTarget),
    [searchKindFiltered, narrow, selectedTarget]
  );

  const filtered = useMemo(
    () => narrow(searchKindFiltered, { os: true, category: true, tag: true, target: true }),
    [searchKindFiltered, narrow]
  );

  const starters = useMemo(() => filtered.filter(t => t.isStarter).sort(byFavoriteThenName), [filtered]);
  const patterns = useMemo(() => filtered.filter(t => !t.isStarter).sort(byFavoriteThenName), [filtered]);

  const osValues = useMemo(() => Array.from(osFacets.keys()).sort((a, b) => templateOsLabel(a).localeCompare(templateOsLabel(b))), [osFacets]);
  const categoryValues = useMemo(() => Array.from(categoryFacets.keys()).sort((a, b) => templateCategoryLabel(a).localeCompare(templateCategoryLabel(b))), [categoryFacets]);
  const tagValues = useMemo(() => Array.from(tagFacets.keys()).sort((a, b) => a.localeCompare(b)), [tagFacets]);
  const targetValues = useMemo(
    () => Array.from(targetFacets.keys()).sort((a, b) => platformLabel(a).localeCompare(platformLabel(b))),
    [targetFacets]
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <Loader2 className="animate-spin text-foreground" size={48} />
        <p className="text-subtle-foreground font-medium">Loading templates...</p>
      </div>
    );
  }

  const hasTemplates = all.length > 0;
  const favoriteCount = all.filter(t => t.isFavorite).length;
  const hasActiveFilters = kind !== 'all' || selectedOs !== 'All' || selectedCategory !== 'All' || selectedTag !== 'All' || selectedTarget !== 'All' || favoritesOnly || !!search.trim();
  const clearFilters = () => { setSearch(''); setKind('all'); setSelectedOs('All'); setSelectedCategory('All'); setSelectedTag('All'); setSelectedTarget('All'); setFavoritesOnly(false); };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold mb-1 flex items-center gap-1.5">
            Schedule Template Library
            <HelpButton topic="templates" size="md" />
          </h2>
          <p className="text-muted-foreground">Prebuilt automation patterns for any platform.</p>
        </div>
        <div className="flex items-center gap-2">
          <TemplateImportExport />
          <TemplateResourcesMenu />
          {hasTemplates && <TemplateViewToggle view={view} onChange={v => update('templateView', v)} />}
        </div>
      </div>

      {/* Gallery pointer — the built-in set is a small curated sampler; the rest
          of the catalog lives in the public gallery and is imported on demand. */}
      <a
        href="https://mikesailab.com/cronsole-registry/"
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-4 bg-gradient-to-r from-primary/10 to-transparent border border-primary/20 rounded-2xl p-4 hover:border-primary/40 transition-colors"
      >
        <div className="w-10 h-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">
          <Sparkles size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground">Browse the full Template Gallery</p>
          <p className="text-sm text-muted-foreground">
            These are a few built-in starters. Explore the full catalog — filter, preview, and import the automations you want.
          </p>
        </div>
        <span className="hidden sm:flex items-center gap-1.5 text-sm font-semibold text-primary whitespace-nowrap">
          Open gallery <ExternalLink size={15} className="group-hover:translate-x-0.5 transition-transform" />
        </span>
      </a>

      {!hasTemplates ? (
        <div className="flex flex-col items-center justify-center h-[40vh] border-2 border-dashed border-border rounded-3xl p-10 text-center">
          <Library size={48} className="text-subtle-foreground mb-4" />
          <h3 className="text-xl font-bold text-foreground">No templates found</h3>
          <p className="text-subtle-foreground max-w-sm mt-2">
            The template library is currently empty. Run <code className="bg-surface px-2 py-1 rounded text-foreground">npm run seed</code> in backend.
          </p>
        </div>
      ) : (
        <>
          {/* Filter bar: search + Type / OS / Category facets */}
          <div className="bg-surface border border-border rounded-2xl p-4 space-y-4 shadow-md">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="relative flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Escape' && setSearch('')}
                  placeholder="Search templates by name, command, category…"
                  className="w-full bg-background border border-border rounded-xl pl-9 pr-9 py-2 text-sm outline-none focus:border-primary transition-colors"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle-foreground hover:text-foreground" title="Clear search">
                    <X size={15} />
                  </button>
                )}
              </div>
              <button
                onClick={() => setFavoritesOnly(v => !v)}
                title={favoritesOnly ? 'Show all templates' : 'Show favorites only'}
                aria-pressed={favoritesOnly}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${favoritesOnly ? 'bg-warning/15 text-warning-text border-warning/40' : 'bg-background text-muted-foreground border-border hover:text-foreground'}`}
              >
                <Star size={13} className={favoritesOnly ? 'fill-current' : ''} /> Favorites
                {favoriteCount > 0 && (
                  <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${favoritesOnly ? 'bg-warning/20' : 'bg-muted text-subtle-foreground'}`}>{favoriteCount}</span>
                )}
              </button>
              <div className="flex items-center gap-1.5 bg-background border border-border p-1 rounded-xl shrink-0">
                {(['all', 'starters', 'patterns'] as const).map(k => (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${kind === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {k}
                  </button>
                ))}
              </div>
              {hasActiveFilters && (
                <button onClick={clearFilters} className="text-xs font-bold text-subtle-foreground hover:text-foreground flex items-center gap-1 shrink-0" title="Clear all filters">
                  <X size={13} /> Clear
                </button>
              )}
            </div>

            {/* Target sits above OS on purpose: "what can I create this on"
                is the first question now that the catalog holds Windows tasks,
                Cronsole-native jobs and Claude routines side by side, and it is
                the one the OS chips cannot answer (three of those four families
                are `cross-platform`). Each chip carries a marker for what this
                install can actually create — the same server verdict the cards
                and the Apply modal use, so the tab cannot disagree with itself. */}
            {targetValues.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-subtle-foreground w-16 shrink-0">Target</span>
                <TemplateChip active={selectedTarget === 'All'} onClick={() => setSelectedTarget('All')}>All</TemplateChip>
                {targetValues.map(p => {
                  const can = creatability(p);
                  return (
                    <TemplateChip key={p} active={selectedTarget === p} onClick={() => setSelectedTarget(p)}>
                      <span title={can === 'no' ? 'Cronsole can’t create tasks here on this install' : undefined}>
                        {platformLabel(p)}{can === 'no' && ' *'}
                      </span>
                      <span className={`ml-2 px-1.5 py-0.5 rounded-md text-[10px] ${selectedTarget === p ? 'bg-primary text-primary-foreground' : 'bg-muted text-subtle-foreground'}`}>{targetFacets.get(p) ?? 0}</span>
                    </TemplateChip>
                  );
                })}
              </div>
            )}

            {osValues.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-subtle-foreground w-16 shrink-0">OS</span>
                <TemplateChip active={selectedOs === 'All'} onClick={() => setSelectedOs('All')}>All</TemplateChip>
                {osValues.map(os => (
                  <TemplateChip key={os} active={selectedOs === os} onClick={() => setSelectedOs(os)}>
                    {templateOsLabel(os)}
                    <span className={`ml-2 px-1.5 py-0.5 rounded-md text-[10px] ${selectedOs === os ? 'bg-primary text-primary-foreground' : 'bg-muted text-subtle-foreground'}`}>{osFacets.get(os) ?? 0}</span>
                  </TemplateChip>
                ))}
              </div>
            )}

            {categoryValues.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-subtle-foreground w-16 shrink-0">Category</span>
                <TemplateChip active={selectedCategory === 'All'} onClick={() => setSelectedCategory('All')}>All</TemplateChip>
                {categoryValues.map(cat => (
                  <TemplateChip key={cat} active={selectedCategory === cat} onClick={() => setSelectedCategory(cat)}>
                    {templateCategoryLabel(cat)}
                    <span className={`ml-2 px-1.5 py-0.5 rounded-md text-[10px] ${selectedCategory === cat ? 'bg-primary text-primary-foreground' : 'bg-muted text-subtle-foreground'}`}>{categoryFacets.get(cat) ?? 0}</span>
                  </TemplateChip>
                ))}
              </div>
            )}

            {tagValues.length > 1 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black uppercase tracking-widest text-subtle-foreground w-16 shrink-0 flex items-center gap-1"><Tag size={10} /> Tags</span>
                <TemplateChip active={selectedTag === 'All'} onClick={() => setSelectedTag('All')}>All</TemplateChip>
                {tagValues.map(tag => (
                  <TemplateChip key={tag} active={selectedTag === tag} onClick={() => setSelectedTag(tag)}>
                    {tag}
                    <span className={`ml-2 px-1.5 py-0.5 rounded-md text-[10px] ${selectedTag === tag ? 'bg-primary text-primary-foreground' : 'bg-muted text-subtle-foreground'}`}>{tagFacets.get(tag) ?? 0}</span>
                  </TemplateChip>
                ))}
              </div>
            )}
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[30vh] border-2 border-dashed border-border rounded-3xl p-10 text-center">
              <Search size={40} className="text-subtle-foreground mb-4" />
              <h3 className="text-lg font-bold text-foreground">No templates match your filters</h3>
              <p className="text-subtle-foreground max-w-sm mt-2 mb-4">Try a different search or clear the filters to see all {all.length} templates.</p>
              <button onClick={clearFilters} className="text-sm font-bold text-primary hover:text-primary-hover flex items-center gap-1.5">
                <X size={15} /> Clear filters
              </button>
            </div>
          ) : view === 'kanban' ? (
            <TemplateKanban templates={filtered} onApply={openTemplate} onToggleFavorite={toggleFavorite} />
          ) : (
            <div className="space-y-10 pb-20">
              <TemplateGroup view={view} icon={Sparkles} title="Starters" subtitle="Parameterized building blocks — fill in the blanks and apply." templates={starters} onApply={openTemplate} onToggleFavorite={toggleFavorite} creatability={creatability} />
              <TemplateGroup view={view} icon={Library} title="Use-case patterns" subtitle="Ready-made automations for common jobs." templates={patterns} onApply={openTemplate} onToggleFavorite={toggleFavorite} creatability={creatability} />
            </div>
          )}
        </>
      )}

      {applyTarget && (
        <ApplyTemplateModal template={applyTarget} onClose={() => navigate('/templates')} />
      )}
    </div>
  );
};
