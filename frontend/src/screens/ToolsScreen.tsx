import { BulkExportTool } from '../components/tools/BulkExportTool';
import { ConnectPackTool } from '../components/tools/ConnectPackTool';

/**
 * Utilities that act across tasks rather than on one — backup and AI-tool setup.
 *
 * The tab earns its name only while things genuinely belong here. If it starts
 * collecting miscellany, that is the signal to give it a sharper name, not to
 * keep adding.
 */
export const ToolsScreen = () => (
  <div className="space-y-8 animate-in fade-in duration-500 pb-20">
    <div>
      <h2 className="text-2xl font-bold mb-1">Tools</h2>
      <p className="text-muted-foreground">Backup, and setup for other AI tools.</p>
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
      <BulkExportTool />
      <ConnectPackTool />
    </div>
  </div>
);
