import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  Layers,
  Stethoscope,
  Activity,
  TrendingUp,
  CalendarClock,
  FolderDown,
  FileJson,
  History,
  FileSpreadsheet,
  Bot,
} from 'lucide-react';
import { CategoryNav, type CategoryNavItem } from '../components/CategoryNav';
import { BulkExportTool } from '../components/tools/BulkExportTool';
import { ConnectPackTool } from '../components/tools/ConnectPackTool';
import { DiagnosticsTool } from '../components/tools/DiagnosticsTool';
import { ExecutionAnalyticsTool } from '../components/tools/ExecutionAnalyticsTool';
import { ImportTaskTool } from '../components/tools/ImportTaskTool';
import { MassActionsTool } from '../components/tools/MassActionsTool';
import { RestoreTool } from '../components/tools/RestoreTool';
import { RunHistoryTool } from '../components/tools/RunHistoryTool';
import { ScheduleTesterTool } from '../components/tools/ScheduleTesterTool';
import { TaskHealthTool } from '../components/tools/TaskHealthTool';

/**
 * Utilities that act across tasks rather than on one — health, backup, restore,
 * reporting, and AI-tool setup.
 *
 * The tab earns its name only while things genuinely belong here. If it starts
 * collecting miscellany, that is the signal to give it a sharper name, not to
 * keep adding.
 *
 * **A category sidebar, the `SettingsScreen` shape, with `?tool=` real
 * navigation (the `SourcesScreen` `?focus=` contract) — not ten cards on one
 * long scroll.** That replaced a per-card Show/Hide disclosure
 * (`Settings.openTools`), and the reason that existed still has to be
 * satisfied here: **nine of the ten tools fire a query the moment they
 * mount** (tasks, task health twice, analytics, folders, downloads, archives,
 * history, a schedule preview), so a tool nobody has selected yet must not be
 * in the DOM at all, and a tool you switch away from must not lose what you
 * were doing in it.
 *
 * `visited` is exactly that: a tool's component mounts the first time its id
 * is selected and then stays mounted, hidden (not unmounted) whenever it
 * isn't the active one — a half-built mass action or a loaded restore plan
 * survives switching to another tool and back, the same property the old
 * per-card disclosure had, achieved by "which one tool is showing" instead of
 * "which several cards are open".
 */

type ToolId =
  | 'mass-actions'
  | 'diagnostics'
  | 'task-health'
  | 'analytics'
  | 'schedule-tester'
  | 'backup'
  | 'import-task'
  | 'restore'
  | 'run-history'
  | 'connect-pack';

const TOOLS_NAV: CategoryNavItem<ToolId>[] = [
  { id: 'mass-actions', label: 'Mass actions', Icon: Layers },
  { id: 'diagnostics', label: 'System diagnostics', Icon: Stethoscope },
  { id: 'task-health', label: 'Task health', Icon: Activity },
  { id: 'analytics', label: 'Execution analytics', Icon: TrendingUp },
  { id: 'schedule-tester', label: 'Schedule tester', Icon: CalendarClock },
  { id: 'backup', label: 'Back up tasks', Icon: FolderDown },
  { id: 'import-task', label: 'Import a task', Icon: FileJson },
  { id: 'restore', label: 'Restore from backup', Icon: History },
  { id: 'run-history', label: 'Export run history', Icon: FileSpreadsheet },
  { id: 'connect-pack', label: 'Connect an AI tool', Icon: Bot },
];

/** Same contract as `SettingsScreen`'s `?section=`: an unknown or missing
 *  value falls back to the first tool rather than rendering nothing. */
function readTool(search: string): ToolId {
  const value = new URLSearchParams(search).get('tool');
  return TOOLS_NAV.some(item => item.id === value) ? (value as ToolId) : TOOLS_NAV[0].id;
}

export const ToolsScreen = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const activeTool = readTool(location.search);
  // `replace` so paging through tools does not fill the back stack — the
  // button that got you into Tools should still be one Back away.
  const selectTool = (next: ToolId) =>
    navigate({ pathname: '/tools', search: `?tool=${next}` }, { replace: true });

  const [visited, setVisited] = useState<Set<ToolId>>(() => new Set([activeTool]));
  useEffect(() => {
    setVisited(prev => (prev.has(activeTool) ? prev : new Set(prev).add(activeTool)));
  }, [activeTool]);

  return (
    // The same `max-w-6xl` the Sources tab uses. Both screens are a single
    // column of full-width content, so they have to agree on where that
    // column ends — otherwise two tabs of the same app read as two layouts.
    <div className="animate-in fade-in duration-500 pb-20 max-w-6xl mx-auto" style={{ zoom: 1.25 }}>
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1">Tools</h2>
        <p className="text-muted-foreground">Act on many tasks at once, check task health, diagnose the system itself, see what failed or stalled, try a schedule, back up, import and restore tasks, and connect AI tools.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <CategoryNav items={TOOLS_NAV} active={activeTool} onSelect={selectTool} ariaLabel="Tools" />

        <div className="flex-1 min-w-0 space-y-4">
          {visited.has('mass-actions') && (
            <div hidden={activeTool !== 'mass-actions'}><MassActionsTool /></div>
          )}
          {visited.has('diagnostics') && (
            <div hidden={activeTool !== 'diagnostics'}><DiagnosticsTool /></div>
          )}
          {visited.has('task-health') && (
            <div hidden={activeTool !== 'task-health'}><TaskHealthTool /></div>
          )}
          {visited.has('analytics') && (
            <div hidden={activeTool !== 'analytics'}><ExecutionAnalyticsTool /></div>
          )}
          {visited.has('schedule-tester') && (
            <div hidden={activeTool !== 'schedule-tester'}><ScheduleTesterTool /></div>
          )}
          {visited.has('backup') && (
            <div hidden={activeTool !== 'backup'}><BulkExportTool /></div>
          )}
          {/* Directly above Restore, and in that order on purpose: the two
              tools are the same gesture on the two halves of the export
              format — Cronsole JSON for a native task, Task Scheduler XML for
              a Windows one — and each names the other. */}
          {visited.has('import-task') && (
            <div hidden={activeTool !== 'import-task'}><ImportTaskTool /></div>
          )}
          {visited.has('restore') && (
            <div hidden={activeTool !== 'restore'}><RestoreTool /></div>
          )}
          {visited.has('run-history') && (
            <div hidden={activeTool !== 'run-history'}><RunHistoryTool /></div>
          )}
          {visited.has('connect-pack') && (
            <div hidden={activeTool !== 'connect-pack'}><ConnectPackTool /></div>
          )}
        </div>
      </div>
    </div>
  );
};
