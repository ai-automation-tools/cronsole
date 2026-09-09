import { useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  RefreshCw,
  Server,
  Stethoscope,
  X
} from 'lucide-react';
import { Modal } from './ui/Modal';
import { HelpButton } from './HelpButton';
import { DOCS_BASE } from '../data/docs';
import {
  useDiagnostics,
  statusMeta,
  type DiagnosticCheck,
  type DiagnosticsReport
} from '../hooks/useDiagnostics';

/**
 * **"Why isn't this working?"** — the system report, one click from the status
 * line that raised the question.
 *
 * The gap this closes is small and specific. The health strip renders a verdict —
 * *"Windows offline — agent not connected"* — and throws its reasons away. Four
 * genuinely different situations produce that one sentence, and the difference
 * decides what you do next. The reasons have existed in `AgentLiveness` since
 * troubleshooting #40; nothing showed them to anyone.
 *
 * Three rules the layout serves, none of them cosmetic:
 *
 *  - **A verdict is never alone on screen.** Every check renders its facts, and
 *    the facts are the point — `Last request timeout: 09:03 (9h ago) — task:list`
 *    is what turns "degraded" into a decision. Anything that fits stays expanded;
 *    a report you have to click eight times to read is a report nobody reads
 *    during an outage.
 *  - **The machine is named at the top, not per check.** A backend in a container
 *    measures the container's clock and disk. That qualifies every row, so it
 *    goes above all of them (`runtimeContext`, troubleshooting #23a).
 *  - **What this cannot cover is stated, not implied.** The panel is served *by*
 *    the backend, so it can say nothing about a backend that is down — and that
 *    is precisely the case someone will open it for. Saying so points at the
 *    watchdog instead of leaving them to conclude "diagnostics says nothing is
 *    wrong".
 *
 * There is deliberately **no repair button here.** Three of the four agent-health
 * entries in the troubleshooting log were the readout lying rather than the agent
 * failing — #62 recorded a timeout fifteen seconds after every *successful*
 * request — so a "restart it" control would have been acting on a diagnosis
 * nobody could yet check, and looking like it worked. Diagnosis first; the repair
 * verbs come after this has earned trust.
 */
export const DiagnosticsModal = ({ onClose }: { onClose: () => void }) => {
  const { data, isLoading, error, refetch, isFetching } = useDiagnostics(true);

  return (
    <Modal
      onClose={onClose}
      labelledBy="diagnostics-title"
      panelClassName="bg-surface border border-border rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
    >
      <header className="flex items-start gap-3 p-5 border-b border-border shrink-0">
        <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Stethoscope size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="diagnostics-title" className="font-bold flex items-center gap-1.5">
            System diagnostics <HelpButton topic="diagnostics" />
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            What Cronsole can see about itself right now, and where each answer came from.
          </p>
        </div>
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="shrink-0 inline-flex items-center gap-1.5 text-xs rounded-lg border border-border
                     hover:bg-raised px-2.5 py-1.5 transition disabled:opacity-60"
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
          {isFetching ? 'Checking…' : 'Re-run'}
        </button>
        <button
          onClick={onClose}
          aria-label="Close diagnostics"
          className="shrink-0 rounded-lg p-1.5 hover:bg-raised text-muted-foreground transition"
        >
          <X size={16} />
        </button>
      </header>

      <div className="overflow-y-auto p-5 space-y-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 size={16} className="animate-spin" />
            Running checks…
          </div>
        )}

        {error && (
          // The honest failure. If this request could not complete, the backend is
          // the thing that is wrong — and saying "no problems found" here would be
          // the worst possible lie, since the panel would be reporting health it
          // was structurally unable to measure.
          <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm">
            <p className="font-bold text-danger-text flex items-center gap-2">
              <AlertTriangle size={15} /> The checks could not run
            </p>
            <p className="text-muted-foreground mt-1.5 leading-snug">
              This panel is served by the Cronsole backend, so if it cannot answer, the backend
              itself is unreachable or unhealthy. Nothing below has been measured — treat this as
              a result, not as an absence of problems.
            </p>
          </div>
        )}

        {data && (
          <>
            <Summary report={data} />
            <div className="space-y-2.5">
              {data.checks.map(check => (
                /*
                  Keyed on id **and status**, so a re-run that changes a verdict
                  remounts the row and re-applies the default below.

                  Without the status in the key, a check that was passing when
                  the panel opened stays collapsed after Re-run turns it red — so
                  the one row whose evidence just became worth reading is the one
                  hiding it. A status change is a new fact; the row should present
                  itself as if seen for the first time.
                */
                <CheckRow key={`${check.id}:${check.status}`} check={check} />
              ))}
            </div>
            <Caveat />
          </>
        )}
      </div>
    </Modal>
  );
};

const Summary = ({ report }: { report: DiagnosticsReport }) => {
  const meta = statusMeta(report.worst);
  const { counts } = report;

  // Only non-zero buckets. A row of "0 problems · 0 warnings · 0 not measured"
  // is four numbers to read to learn one thing.
  const parts = [
    counts.fail > 0 && `${counts.fail} problem${counts.fail === 1 ? '' : 's'}`,
    counts.warn > 0 && `${counts.warn} worth checking`,
    counts.unknown > 0 && `${counts.unknown} not measured`,
    counts.pass > 0 && `${counts.pass} OK`
  ].filter(Boolean) as string[];

  return (
    <div className={`rounded-xl border ${meta.border} bg-raised p-3.5 space-y-2`}>
      <p className={`text-sm font-bold flex items-center gap-2 ${meta.text}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
        {report.worst === 'pass'
          ? 'Nothing looks wrong.'
          : report.worst === 'unknown'
            ? 'No problems found, but some checks could not be measured.'
            : report.worst === 'warn'
              ? 'A few things are worth a look.'
              : 'Something is wrong.'}
      </p>
      <p className="text-xs text-muted-foreground">{parts.join(' · ')}</p>

      {/*
        Which machine these checks describe. Above every row rather than inside
        one, because it qualifies all of them: on a Dockerized stack the backend
        measures the container's filesystem and clock, not the user's.
      */}
      <p className="text-[11px] text-muted-foreground flex items-start gap-1.5 pt-1 border-t border-border">
        <Server size={12} className="mt-0.5 shrink-0" />
        <span>
          Measured on <span className="font-mono text-foreground">{report.measuredOn.hostname}</span>{' '}
          ({report.measuredOn.kind === 'container' ? 'inside the backend container' : 'your machine'})
          {report.measuredOn.kind === 'container' && ` — ${report.measuredOn.summary}`}
        </span>
      </p>
    </div>
  );
};

const CheckRow = ({ check }: { check: DiagnosticCheck }) => {
  const meta = statusMeta(check.status);
  // Facts are shown by default for anything that is not plainly fine. A healthy
  // check's evidence is real but nobody came here to read it, and eight expanded
  // healthy rows bury the one that matters.
  const [open, setOpen] = useState(check.status !== 'pass');

  return (
    <div className={`rounded-xl border ${meta.border} bg-raised overflow-hidden`}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full text-left p-3 flex items-start gap-2.5 hover:bg-surface/50 transition"
      >
        <span className={`h-2 w-2 rounded-full ${meta.dot} mt-1.5 shrink-0`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2 flex-wrap">
            <span className="font-bold text-sm">{check.title}</span>
            <span className={`text-[10px] font-bold uppercase tracking-wide ${meta.text}`}>
              {meta.label}
            </span>
          </span>
          <span className="block text-xs text-muted-foreground leading-snug mt-0.5">
            {check.summary}
          </span>
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2.5">
          <dl className="text-[11px] rounded-lg bg-surface border border-border divide-y divide-border">
            {check.facts.map((fact, i) => (
              <div key={i} className="flex gap-3 px-2.5 py-1.5">
                <dt className="text-muted-foreground shrink-0 w-40">{fact.label}</dt>
                {/* `break-all` because these are timestamps, paths and origins —
                    values that have no spaces to wrap at on a phone. */}
                <dd className="font-mono text-foreground min-w-0 break-all">{fact.value}</dd>
              </div>
            ))}
          </dl>

          {check.remedy && (
            <p className="text-xs text-foreground leading-snug">{check.remedy}</p>
          )}

          {check.doc && (
            <a
              href={`${DOCS_BASE}/${check.doc}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              Read more <ExternalLink size={11} />
            </a>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * The limit of the whole feature, stated plainly.
 *
 * Everything above runs *inside* the stack, so it can only report on a stack that
 * is up enough to answer. The case someone most wants a diagnostic for — nothing
 * loads at all — is the one case this cannot reach, and the answer for it lives
 * outside the stack by design.
 */
const Caveat = () => (
  <p className="text-[11px] text-muted-foreground leading-snug border-t border-border pt-3">
    These checks run inside the Cronsole backend, so they cannot tell you anything about a
    backend, database or Docker engine that is not running — if the dashboard will not load at
    all, nothing here can answer. That case is what the <span className="font-mono">Cronsole-Stack</span>{' '}
    startup tasks are for: they run from Windows Task Scheduler, outside the stack, and restart
    it without needing any of it to be working.
  </p>
);
