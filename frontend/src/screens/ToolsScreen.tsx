import { BulkExportTool } from '../components/tools/BulkExportTool';
import { ConnectPackTool } from '../components/tools/ConnectPackTool';
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
  <div className="space-y-8 animate-in fade-in duration-500 pb-20">
    <div>
      <h2 className="text-2xl font-bold mb-1">Tools</h2>
      <p className="text-muted-foreground">Check task health, try a schedule, back up and restore tasks, and connect AI tools.</p>
    </div>

    {/* No `items-start`: the default `stretch` plus `h-full` on every card is
        what makes each row line up instead of ending ragged. Cards carry a
        `min-h` floor so a short one doesn't look stubby next to a tall one, and
        anything that can grow (a restore plan, the health list) scrolls inside
        its own card rather than stretching the whole row. */}
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <TaskHealthTool />
      <ScheduleTesterTool />
      <BulkExportTool />
      <RestoreTool />
      <RunHistoryTool />
      <ConnectPackTool />
    </div>
  </div>
);
