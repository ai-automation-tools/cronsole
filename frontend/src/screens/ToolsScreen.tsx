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
 * Task health lives here rather than on the Dashboard for the same reason
 * everything else does: it reads across every task and acts on none. It was
 * briefly a panel above the task list and took over the main content area on
 * the one screen used for actual work — a cross-task *report* is not a header
 * for a per-task view.
 */
export const ToolsScreen = () => (
  // Centred, and the same `max-w-6xl` the Platforms tab uses. Both screens are a
  // single column of full-width panels, so they have to agree on where that
  // column ends — otherwise two tabs of the same app read as two layouts.
  <div className="space-y-5 animate-in fade-in duration-500 pb-20 max-w-6xl mx-auto">
    <div>
      <h2 className="text-2xl font-bold mb-1">Tools</h2>
      <p className="text-muted-foreground">Act on many tasks at once, check task health, diagnose the system itself, see what failed or stalled, try a schedule, back up, import and restore tasks, and connect AI tools.</p>
    </div>

    {/* One card per row. A two-column grid put every card in a forced
        equal-height pair, so the shorter of the two carried the taller one's
        slack as dead space — and the tools are different enough sizes that
        there was always a shorter one. A stack has no pairs to balance: each
        card is its own height. Padding and spacing live in `ToolCard`. */}
    <div className="space-y-4">
      {/* First: it is the only card here that *acts*. Everything below reports. */}
      <MassActionsTool />
      {/* Second, and above task health, because the questions nest: "is Cronsole
          working?" has to be answerable before "which of my tasks are failing?"
          means anything — a red health list over a wedged agent is describing the
          agent, not the tasks. */}
      <DiagnosticsTool />
      <TaskHealthTool />
      <ExecutionAnalyticsTool />
      <ScheduleTesterTool />
      <BulkExportTool />
      {/* Directly above Restore, and in that order on purpose: the two cards are
          the same gesture on the two halves of the export format — Cronsole JSON
          for a native task, Task Scheduler XML for a Windows one — and each names
          the other, so picking the wrong file lands you next to the right card. */}
      <ImportTaskTool />
      <RestoreTool />
      <RunHistoryTool />
      <ConnectPackTool />
    </div>
  </div>
);
