import { useEffect, useMemo, useRef, useState } from 'react';
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
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { useSettings, DEFAULT_SETTINGS, type Settings, type DashboardView } from '../hooks/useSettings';
import { useToast } from '../hooks/useToast';
import { useConnections, healthMeta } from '../hooks/useConnections';
import { platformLabel } from '../platform';
import { formatDateTime } from '../utils/datetime';
import { API_ORIGIN, subscribeBackendStatus, type BackendStatus } from '../api';
import type { Task } from '../types';

const PLATFORM_LINKS_KEY = 'taskhub_platform_links';

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
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4">
    <div className="min-w-0">
      <div className="text-sm font-semibold text-foreground">{label}</div>
      {description && <div className="text-xs text-subtle-foreground mt-0.5 max-w-md">{description}</div>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

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

const Select = ({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) => (
  <select
    value={value}
    onChange={e => onChange(e.target.value)}
    className="bg-background border border-border rounded-xl px-3 py-2 text-xs font-semibold text-foreground outline-none focus:border-primary shadow-sm min-w-[140px]"
  >
    {options.map(o => (
      <option key={o} value={o}>
        {o}
      </option>
    ))}
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

// ---- Screen ----------------------------------------------------------------

export const SettingsScreen = ({ tasks }: { tasks?: Task[] }) => {
  const { settings, update, replaceAll, reset } = useSettings();
  const { toast } = useToast();
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('ok');
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => subscribeBackendStatus(setBackendStatus), []);

  const categoryOptions = useMemo(() => {
    const unique = Array.from(new Set((tasks ?? []).map(t => t.category || 'Uncategorized')));
    return ['All', ...unique.sort()];
  }, [tasks]);

  const platformOptions = useMemo(() => {
    const unique = Array.from(new Set((tasks ?? []).map(t => t.platform)));
    return ['All', ...unique.sort()];
  }, [tasks]);

  const exportSettings = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'taskhub-settings.json';
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
        toast('Could not parse that file — expected TaskHub settings JSON.', 'error');
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

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-20 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold mb-1">Settings</h2>
        <p className="text-muted-foreground">Preferences are saved in this browser.</p>
      </div>

      {/* Connections */}
      <ConnectionsSection timezone={settings.timezone} />

      {/* Appearance */}
      <Section icon={Palette} title="Appearance" subtitle="How TaskHub looks on this device.">
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
      <Section icon={SlidersHorizontal} title="Behavior" subtitle="How TaskHub reacts to your actions.">
        <Row label="Confirm before running a task" description="Ask for confirmation before triggering a task run.">
          <Toggle
            checked={settings.confirmBeforeRun}
            onChange={v => update('confirmBeforeRun', v)}
            label="Confirm before running a task"
          />
        </Row>
        <Row label="Schedule timezone" description="Schedules are stored in UTC; choose how times are displayed.">
          <Segmented
            value={settings.timezone}
            options={[
              { value: 'local', label: 'Local' },
              { value: 'utc', label: 'UTC' },
            ]}
            onChange={v => update('timezone', v)}
          />
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
      <Section icon={Database} title="Data & reset" subtitle="Manage locally stored preferences.">
        <Row label="Export settings" description="Download your preferences as a JSON file.">
          <button
            onClick={exportSettings}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-background border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all active:scale-95"
          >
            <Download size={14} /> Export
          </button>
        </Row>
        <Row label="Import settings" description="Load preferences from a previously exported file.">
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
              toast('All preferences reset to defaults.', 'info');
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all active:scale-95"
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
            <span className={`h-1.5 w-1.5 rounded-full ${backendStatus === 'ok' ? 'bg-green-500' : 'bg-red-500'}`} />
            {backendStatus === 'ok' ? 'Reachable' : 'Unreachable'}
          </span>
        </Row>
        <Row label="API origin">
          <span className="inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
            <Globe size={12} className="text-subtle-foreground" /> {API_ORIGIN}
          </span>
        </Row>
        <Row label="Links">
          <div className="flex items-center gap-2">
            <a
              href="https://github.com/michaelschecht/taskhub"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-background border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all"
            >
              <Code2 size={14} /> GitHub
            </a>
            <a
              href="https://github.com/michaelschecht/taskhub/tree/main/docs"
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
        <Activity size={11} className="text-green-500" />
        Changes save automatically. Defaults: {Object.keys(DEFAULT_SETTINGS).length} preferences.
      </p>
    </div>
  );
};
