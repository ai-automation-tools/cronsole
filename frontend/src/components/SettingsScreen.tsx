import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { HelpButton } from './HelpButton';
import {
  Palette,
  LayoutDashboard,
  SlidersHorizontal,
  Bell,
  Database,
  Info,
  Grid,
  List,
  Columns,
  Calendar,
  Download,
  Upload,
  RotateCcw,
  Trash2,
  Code2,
  BookOpen,
  Globe,
  Activity,
  Plug,
  RefreshCw,
  Loader2,
  KeyRound,
  LogOut,
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import {
  useSettings,
  DEFAULT_SETTINGS,
  type Settings,
  type DashboardView,
  type SettingsSyncStatus
} from '../hooks/useSettings';
import { useToast } from '../hooks/useToast';
import { ApiTokensRow } from './settings/ApiTokensRow';
import { useAuth } from '../hooks/useAuth';
import { useConnections, healthMeta } from '../hooks/useConnections';
import { platformLabel } from '../platform';
import { formatDateTime } from '../utils/datetime';
import { errorMessage } from '../utils/errorMessage';
import { machineZone, zoneAbbrev } from '../utils/timezone';
import {
  API_ORIGIN,
  DEFAULT_API_ORIGIN,
  resetApiOrigin,
  setApiOrigin as setRuntimeApiOrigin,
  subscribeApiOrigin,
  subscribeBackendStatus,
  type BackendStatus
} from '../api';
import type { Task } from '../types';

const PLATFORM_LINKS_KEY = 'cronsole_platform_links';

/** Zones offered in the schedule-timezone picker, in rough west-to-east order. */
const COMMON_ZONES: { id: string; name: string }[] = [
  { id: 'America/Los_Angeles', name: 'Pacific' },
  { id: 'America/Denver', name: 'Mountain' },
  { id: 'America/Chicago', name: 'Central' },
  { id: 'America/New_York', name: 'Eastern' },
  { id: 'America/Sao_Paulo', name: 'São Paulo' },
  { id: 'Europe/London', name: 'London' },
  { id: 'Europe/Berlin', name: 'Central Europe' },
  { id: 'Asia/Kolkata', name: 'India' },
  { id: 'Asia/Singapore', name: 'Singapore' },
  { id: 'Asia/Tokyo', name: 'Tokyo' },
  { id: 'Australia/Sydney', name: 'Sydney' },
];

const VIEW_OPTIONS: { value: DashboardView; label: string; Icon: typeof Grid }[] = [
  { value: 'grid', label: 'Grid', Icon: Grid },
  { value: 'list', label: 'List', Icon: List },
  { value: 'kanban', label: 'Kanban', Icon: Columns },
  { value: 'schedule', label: 'Schedule', Icon: Calendar },
];

// ---- Layout primitives -----------------------------------------------------

const Section = ({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof Palette;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) => (
  <section className="bg-surface border border-border rounded-3xl shadow-xl overflow-hidden">
    <div className="flex items-start gap-3 p-6 border-b border-border/70">
      <div className="p-2.5 rounded-xl bg-primary/10 text-foreground shrink-0">
        <Icon size={18} />
      </div>
      <div>
        <h3 className="font-bold text-base text-foreground">{title}</h3>
        <p className="text-xs text-subtle-foreground mt-0.5">{subtitle}</p>
      </div>
    </div>
    <div className="divide-y divide-border/50">{children}</div>
  </section>
);

const Row = ({
  label,
  description,
  help,
  children,
}: {
  label: string;
  description?: string;
  /** An optional `?` beside the label, for a row with a rule behind it. */
  help?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4">
    <div className="min-w-0">
      <div className="text-sm font-semibold text-foreground flex items-center">{label}{help}</div>
      {description && <div className="text-xs text-subtle-foreground mt-0.5 max-w-md">{description}</div>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

/**
 * What preference sync is doing, in words — and each of the four says a
 * different thing on purpose.
 *
 * `local` is an absence, not a failure: nobody is logged in, so there is no
 * account to follow. `error` is a failure, and it names the consequence the user
 * would otherwise discover on the next device rather than reassuring them.
 * Collapsing the two into one "not syncing" would be the same lie in both
 * directions that the health tiers exist to avoid (CLAUDE.md §9).
 */
const SYNC_COPY: Record<SettingsSyncStatus, string> = {
  local:
    'Stored in this browser only. Preferences follow your account once you sign in — localStorage is scoped to one address, so a second URL gets its own copy.',
  syncing: 'Reading the copy stored on your account…',
  synced:
    'Your pins, saved views and preferences follow your account, so they are the same at every address this install answers on.',
  error:
    'Could not reach your account, so changes are being kept in this browser only and will not appear on your other devices yet. Retried on your next change.'
};

const SYNC_BADGE: Record<SettingsSyncStatus, { label: string; className: string }> = {
  local: { label: 'This browser', className: 'text-subtle-foreground border-border' },
  syncing: { label: 'Checking…', className: 'text-muted-foreground border-border' },
  synced: { label: 'Synced', className: 'text-success-text border-success/40' },
  error: { label: 'Not synced', className: 'text-warning-text border-warning/40' }
};

/**
 * A readout, not a control — there is no button to force a sync, for the same
 * reason the diagnostics panel has no "restart the agent": the failure this
 * would appear to fix is upstream of the browser, and a button that reports
 * success without changing anything is worse than no button.
 */
const SyncBadge = ({ status }: { status: SettingsSyncStatus }) => {
  const { label, className } = SYNC_BADGE[status];
  return (
    <span className={`inline-flex items-center px-3 py-1.5 rounded-xl border text-xs font-bold ${className}`}>
      {label}
    </span>
  );
};

const Toggle = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors active:scale-95 ${
      checked ? 'bg-primary' : 'bg-muted'
    }`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);

const Segmented = <T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; Icon?: typeof Grid }[];
  onChange: (v: T) => void;
}) => (
  <div className="flex flex-wrap bg-background border border-border p-1 rounded-xl items-center shadow-sm">
    {options.map(o => {
      const active = value === o.value;
      return (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
            active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.Icon && <o.Icon size={12} />}
          {o.label}
        </button>
      );
    })}
  </div>
);

/** An option whose stored value differs from its label (e.g. an IANA zone id). */
type SelectOption = string | { value: string; label: string };

const Select = ({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly SelectOption[];
  onChange: (v: string) => void;
}) => (
  <select
    value={value}
    onChange={e => onChange(e.target.value)}
    className="bg-background border border-border rounded-xl px-3 py-2 text-xs font-semibold text-foreground outline-none focus:border-primary shadow-sm min-w-[140px]"
  >
    {options.map(o => {
      const { value: v, label } = typeof o === 'string' ? { value: o, label: o } : o;
      return (
        <option key={v} value={v}>
          {label}
        </option>
      );
    })}
  </select>
);

// ---- Connections (live health from GET /api/tasks/health) ------------------

const ConnectionsSection = ({ timezone }: { timezone: Settings['timezone'] }) => {
  const { data: connections, isLoading, isFetching, refetch } = useConnections();
  const { toast } = useToast();

  const checkNow = async () => {
    const result = await refetch();
    if (result.error) {
      toast('Could not reach the backend to check connections.', 'error');
    } else {
      toast('Connection status refreshed.', 'success');
    }
  };

  return (
    <section className="bg-surface border border-border rounded-3xl shadow-xl overflow-hidden">
      <div className="flex items-start gap-3 p-6 border-b border-border/70">
        <div className="p-2.5 rounded-xl bg-primary/10 text-foreground shrink-0">
          <Plug size={18} />
        </div>
        <div className="flex-1">
          <h3 className="font-bold text-base text-foreground">Connections</h3>
          <p className="text-xs text-subtle-foreground mt-0.5">Live health of your platform connections.</p>
        </div>
        <button
          onClick={checkNow}
          disabled={isFetching}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold bg-background border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all active:scale-95 disabled:opacity-60"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          {isFetching ? 'Checking…' : 'Check now'}
        </button>
      </div>

      <div className="divide-y divide-border/50">
        {isLoading ? (
          <div className="flex items-center gap-2 px-6 py-8 text-sm text-subtle-foreground">
            <Loader2 size={16} className="animate-spin" /> Checking connections…
          </div>
        ) : !connections || connections.length === 0 ? (
          <div className="px-6 py-8 text-sm text-subtle-foreground italic">
            No platform connections found. Sync a platform to establish one.
          </div>
        ) : (
          connections.map(conn => {
            const meta = healthMeta(conn.state);
            return (
              <div key={conn.platform} className="flex items-center justify-between gap-3 px-6 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{platformLabel(conn.platform)}</span>
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${meta.text}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </span>
                  </div>
                  {conn.reason && <div className="text-xs text-subtle-foreground mt-0.5 truncate">{conn.reason}</div>}
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[10px] uppercase font-bold tracking-wider text-subtle-foreground">Last sync</div>
                  <div className="text-xs font-mono text-muted-foreground">
                    {conn.lastSync ? formatDateTime(conn.lastSync, timezone) : 'Never'}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};

// ---- Account (single-user local login) -------------------------------------

const AccountSection = () => {
  const { user, logout, changePassword } = useAuth();
  const { toast } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (next.length < 8) {
      toast('New password must be at least 8 characters.', 'error');
      return;
    }
    if (next !== confirm) {
      toast('New passwords do not match.', 'error');
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent(''); setNext(''); setConfirm('');
      toast('Password changed.', 'success');
    } catch (err) {
      toast(errorMessage(err, 'Could not change the password.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    'w-full sm:w-64 bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none focus:border-primary shadow-sm';

  return (
    <Section icon={KeyRound} title="Account" subtitle="The single owner account for this Cronsole instance.">
      <Row label="Signed in as">
        <span className="text-xs font-mono text-muted-foreground">{user?.email ?? 'this device'}</span>
      </Row>
      <Row label="Change password" description="Requires your current password. There's no email reset on a local install.">
        <div className="flex flex-col gap-2">
          <input type="password" autoComplete="current-password" placeholder="Current password"
            value={current} onChange={e => setCurrent(e.target.value)} className={inputClass} />
          <input type="password" autoComplete="new-password" placeholder="New password (min 8)"
            value={next} onChange={e => setNext(e.target.value)} className={inputClass} />
          <input type="password" autoComplete="new-password" placeholder="Confirm new password"
            value={confirm} onChange={e => setConfirm(e.target.value)} className={inputClass} />
          <button
            onClick={submit}
            disabled={busy || !current || !next || !confirm}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:bg-primary-hover transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
          >
            {busy && <Loader2 size={14} className="animate-spin" />} Update password
          </button>
        </div>
      </Row>
      <Row
        label="API tokens"
        description="Long-lived credentials for clients that can't log in — the MCP server above all. Separate from your browser session, and revocable here."
      >
        <ApiTokensRow />
      </Row>
      <Row label="Sign out" description="End this session on this device.">
        <button
          onClick={logout}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-background border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all active:scale-95"
        >
          <LogOut size={14} /> Sign out
        </button>
      </Row>
    </Section>
  );
};

// ---- Screen ----------------------------------------------------------------

export const SettingsScreen = ({ tasks }: { tasks?: Task[] }) => {
  const { settings, syncStatus, update, replaceAll, reset } = useSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('ok');
  const [apiOrigin, setApiOriginState] = useState(API_ORIGIN);
  const [apiOriginInput, setApiOriginInput] = useState(API_ORIGIN);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => subscribeBackendStatus(setBackendStatus), []);
  useEffect(() => subscribeApiOrigin(origin => {
    setApiOriginState(origin);
    setApiOriginInput(origin);
  }), []);

  const categoryOptions = useMemo(() => {
    const unique = Array.from(new Set((tasks ?? []).map(t => t.category || 'Uncategorized')));
    return ['All', ...unique.sort()];
  }, [tasks]);

  const platformOptions = useMemo(() => {
    const unique = Array.from(new Set((tasks ?? []).map(t => t.platform)));
    return ['All', ...unique.sort()];
  }, [tasks]);

  /**
   * A short curated zone list rather than all ~400 the browser knows — this is a
   * local-first app run by one person on one machine, and a 400-row select is a
   * worse answer than a 12-row one. The machine's own zone is appended when it
   * isn't already listed, so the list is never missing the one that matters.
   * Labels carry the live abbreviation (PDT vs PST), which is also what every
   * cron field is labelled with.
   */
  const timezoneOptions = useMemo(() => {
    const now = new Date();
    const named = COMMON_ZONES.map(z => ({
      value: z.id,
      label: `${z.name} — ${zoneAbbrev(z.id, now)}`
    }));
    const machine = machineZone();
    const options = [
      { value: 'local', label: `Machine local — ${zoneAbbrev(machine, now)}` },
      ...named,
      { value: 'utc', label: 'UTC — no conversion' }
    ];
    if (!COMMON_ZONES.some(z => z.id === machine)) {
      options.splice(1, 0, { value: machine, label: `${machine.split('/').pop()?.replace(/_/g, ' ')} — ${zoneAbbrev(machine, now)}` });
    }
    // A stored zone that isn't offered would render as a blank select.
    if (!options.some(o => o.value === settings.timezone)) {
      options.push({ value: settings.timezone, label: settings.timezone });
    }
    return options;
  }, [settings.timezone]);

  const exportSettings = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cronsole-settings.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('Settings exported.', 'success');
  };

  const importSettings = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<Settings>;
        replaceAll(parsed);
        toast('Settings imported.', 'success');
      } catch {
        toast('Could not parse that file — expected Cronsole settings JSON.', 'error');
      }
    };
    reader.readAsText(file);
  };

  const requestDesktopNotifications = async (enabled: boolean) => {
    if (!enabled) {
      update('desktopNotifyOnFailure', false);
      return;
    }
    if (!('Notification' in window)) {
      toast('This browser does not support desktop notifications.', 'error');
      return;
    }
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission === 'granted') {
      update('desktopNotifyOnFailure', true);
      toast('Desktop notifications enabled.', 'success');
    } else {
      toast('Notification permission was blocked in the browser.', 'error');
    }
  };

  const resetPlatformLinks = () => {
    localStorage.removeItem(PLATFORM_LINKS_KEY);
    toast('Platform links reset to defaults. Reload to see the change.', 'info');
  };

  const saveApiOrigin = async () => {
    try {
      const next = setRuntimeApiOrigin(apiOriginInput);
      toast(`Backend API origin set to ${next}.`, 'success');
      await queryClient.invalidateQueries();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not save API origin.', 'error');
    }
  };

  const restoreDefaultApiOrigin = async () => {
    const next = resetApiOrigin();
    toast(`Backend API origin reset to ${next}.`, 'info');
    await queryClient.invalidateQueries();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold mb-1">Settings</h2>
        <p className="text-muted-foreground">Preferences are saved in this browser.</p>
      </div>

      {/* Account */}
      <AccountSection />

      {/* Connections */}
      <ConnectionsSection timezone={settings.timezone} />

      {/* Appearance */}
      <Section icon={Palette} title="Appearance" subtitle="How Cronsole looks on this device.">
        <Row label="Theme" description="Dark is the default. System follows your OS setting.">
          <ThemeToggle />
        </Row>
      </Section>

      {/* Dashboard defaults */}
      <Section
        icon={LayoutDashboard}
        title="Dashboard defaults"
        subtitle="What the dashboard shows when it first loads."
      >
        <Row label="Default view" description="The layout used when you open the dashboard.">
          <Segmented value={settings.defaultView} options={VIEW_OPTIONS} onChange={v => update('defaultView', v)} />
        </Row>
        <Row label="Show disabled tasks" description="Off shows only active tasks by default.">
          <Toggle
            checked={settings.defaultShowDisabled}
            onChange={v => update('defaultShowDisabled', v)}
            label="Show disabled tasks by default"
          />
        </Row>
        <Row label="Default category filter">
          <Select value={settings.defaultCategory} options={categoryOptions} onChange={v => update('defaultCategory', v)} />
        </Row>
        <Row label="Default platform filter">
          <Select value={settings.defaultPlatform} options={platformOptions} onChange={v => update('defaultPlatform', v)} />
        </Row>
      </Section>

      {/* Behavior */}
      <Section icon={SlidersHorizontal} title="Behavior" subtitle="How Cronsole reacts to your actions.">
        <Row label="Confirm before running a task" description="Ask for confirmation before triggering a task run.">
          <Toggle
            checked={settings.confirmBeforeRun}
            onChange={v => update('confirmBeforeRun', v)}
            label="Confirm before running a task"
          />
        </Row>
        <Row
          label="Schedule timezone"
          description="The zone you read and write schedules in. Schedules are still stored — and sent to Windows, the API and the MCP tools — as UTC cron; this converts at the edge so you don't do the arithmetic yourself."
        >
          <Select value={settings.timezone} options={timezoneOptions} onChange={v => update('timezone', v)} />
        </Row>
      </Section>

      {/* Notifications */}
      <Section icon={Bell} title="Notifications" subtitle="How you're told about task activity.">
        <Row label="Toast on success" description="Show a toast when a task runs or syncs successfully.">
          <Toggle checked={settings.toastOnSuccess} onChange={v => update('toastOnSuccess', v)} label="Toast on success" />
        </Row>
        <Row label="Toast on failure" description="Show a toast when a task run or sync fails.">
          <Toggle checked={settings.toastOnFailure} onChange={v => update('toastOnFailure', v)} label="Toast on failure" />
        </Row>
        <Row label="Desktop notification on failure" description="Also raise an OS notification when a task fails.">
          <Toggle
            checked={settings.desktopNotifyOnFailure}
            onChange={requestDesktopNotifications}
            label="Desktop notification on failure"
          />
        </Row>
      </Section>

      {/* Data */}
      <Section icon={Database} title="Data & reset" subtitle="Preferences follow your account, not this browser.">
        <Row
          label="Preference sync"
          description={SYNC_COPY[syncStatus]}
          help={<HelpButton topic="preference-sync" />}
        >
          <SyncBadge status={syncStatus} />
        </Row>
        <Row label="Export settings" description="Download a snapshot of your preferences as a JSON file.">
          <button
            onClick={exportSettings}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-background border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all active:scale-95"
          >
            <Download size={14} /> Export
          </button>
        </Row>
        <Row label="Import settings" description="Load preferences from a previously exported file. This replaces the copy on your account too.">
          <button
            onClick={() => importInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-background border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all active:scale-95"
          >
            <Upload size={14} /> Import
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) importSettings(file);
              e.target.value = '';
            }}
          />
        </Row>
        <Row label="Reset platform links" description="Restore the default Platforms tab quick links.">
          <button
            onClick={resetPlatformLinks}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-background border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all active:scale-95"
          >
            <RotateCcw size={14} /> Reset links
          </button>
        </Row>
        <Row label="Reset all preferences" description="Restore every setting on this page to its default.">
          <button
            onClick={() => {
              reset();
              resetApiOrigin();
              toast('All preferences reset to defaults.', 'info');
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-danger/10 border border-danger/30 text-danger-text hover:bg-danger/20 transition-all active:scale-95"
          >
            <Trash2 size={14} /> Reset all
          </button>
        </Row>
      </Section>

      {/* About */}
      <Section icon={Info} title="About" subtitle="Environment and useful links.">
        <Row label="Version">
          <span className="text-xs font-mono font-bold text-muted-foreground">MVP preview</span>
        </Row>
        <Row label="Backend">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold">
            <span className={`h-1.5 w-1.5 rounded-full ${backendStatus === 'ok' ? 'bg-success' : 'bg-danger'}`} />
            {backendStatus === 'ok' ? 'Reachable' : 'Unreachable'}
          </span>
        </Row>
        <Row
          label="API origin"
          description={`Default from VITE_API_URL: ${DEFAULT_API_ORIGIN}. Override is saved in this browser.`}
        >
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative">
              <Globe size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground" />
              <input
                type="url"
                value={apiOriginInput}
                onChange={e => setApiOriginInput(e.target.value)}
                placeholder="http://localhost:3000"
                className="w-full sm:w-72 bg-background border border-border rounded-xl pl-8 pr-3 py-2 text-xs font-mono text-foreground outline-none focus:border-primary shadow-sm"
              />
            </div>
            <button
              onClick={saveApiOrigin}
              disabled={apiOriginInput.trim().replace(/\/+$/, '') === apiOrigin}
              className="inline-flex items-center justify-center px-3 py-2 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:bg-primary-hover transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
            >
              Save
            </button>
            <button
              onClick={restoreDefaultApiOrigin}
              disabled={apiOrigin === DEFAULT_API_ORIGIN}
              className="inline-flex items-center justify-center px-3 py-2 rounded-xl text-xs font-bold bg-background border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
            >
              Reset
            </button>
          </div>
        </Row>
        <Row label="Links">
          <div className="flex items-center gap-2">
            <a
              href="https://github.com/michaelschecht/cronsole"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-background border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all"
            >
              <Code2 size={14} /> GitHub
            </a>
            <a
              href="https://github.com/michaelschecht/cronsole/tree/main/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-background border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all"
            >
              <BookOpen size={14} /> Docs
            </a>
          </div>
        </Row>
      </Section>

      <p className="flex items-center gap-2 text-[11px] text-subtle-foreground px-1">
        <Activity size={11} className="text-success-text" />
        Changes save automatically. Defaults: {Object.keys(DEFAULT_SETTINGS).length} preferences.
      </p>
    </div>
  );
};
