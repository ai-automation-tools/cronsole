import { useState } from 'react';
import { Stethoscope } from 'lucide-react';
import { ToolCard } from './ToolCard';
import { HelpButton } from '../HelpButton';
import { DiagnosticsModal } from '../DiagnosticsModal';
import { useDiagnostics, statusMeta } from '../../hooks/useDiagnostics';

/**
 * The Tools-tab entry to the system report.
 *
 * Two entry points exist on purpose, and they answer different questions. The
 * **health strip's** *Diagnose* sits beside the verdict, for the moment the
 * question occurs to someone reading a status line. **This card** is the one you
 * can find when nothing has gone wrong yet — the strip renders nothing at all on
 * an install with no connections and no syncs, which is exactly the state a new
 * user is in when they most want to know what Cronsole can see.
 *
 * The card body is deliberately **not** a live summary. Rendering "3 problems"
 * here would mean running eight checks on every visit to the Tools tab to
 * populate a number nobody asked for — and worse, a *stale* one, since the panel
 * is not polled. The card says what the report is; opening it is what measures.
 */
export const DiagnosticsTool = () => {
  const [open, setOpen] = useState(false);
  // Only ever fetched while the modal is open (`enabled` is the modal's state),
  // so this reads whatever the last open run produced and nothing more.
  const { data } = useDiagnostics(false);

  return (
    <>
      <ToolCard
        id="diagnostics"
        icon={Stethoscope}
        title="System diagnostics"
        titleAdornment={<HelpButton topic="diagnostics" />}
        description="Check what Cronsole can see about itself — the agent, the database, the scheduler, the catalog — with the evidence behind each answer."
      >
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary text-primary-foreground
                       hover:opacity-90 px-3 py-1.5 text-xs font-bold transition"
          >
            <Stethoscope size={14} />
            Run checks
          </button>

          {/*
            Shown only when a run has actually happened this session. A summary
            of a report that was never run would be the panel asserting health it
            has not measured — the failure the report itself exists to prevent.
          */}
          {data && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`h-2 w-2 rounded-full ${statusMeta(data.worst).dot}`} />
              Last run: {statusMeta(data.worst).label.toLowerCase()}
            </span>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground leading-snug">
          Read-only — nothing here changes a task, a schedule, or anything on your machine.
        </p>
      </ToolCard>

      {open && <DiagnosticsModal onClose={() => setOpen(false)} />}
    </>
  );
};
