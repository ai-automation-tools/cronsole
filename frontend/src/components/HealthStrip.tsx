import { useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Stethoscope, Terminal } from 'lucide-react';
import { DiagnosticsModal } from './DiagnosticsModal';
import { useConnections, healthMeta } from '../hooks/useConnections';
import { usePlatformMatrix, newestOutcome } from '../hooks/usePlatformMatrix';
import { platformLabel } from '../platform';
import { timeAgo } from '../utils/datetime';

/**
 * "Is anything wrong, and what did Cronsole last do?" — answered in the header,
 * where the question is actually asked.
 *
 * The 2026-08-12 review's finding was that deciding what to do next meant
 * reading the sidebar: the dashboard's own header carried a task count and a
 * "synced N ago" chip, and nothing about whether the agent was reachable or
 * whether the last thing Cronsole asked of it worked.
 *
 * Three facts, and each one is bound by the same rule that fixed `getHealth`
 * (troubleshooting #40): **nothing here may be a value this component invented.**
 *
 *  - **Connection** — the server's `HealthState`, which is now derived from the
 *    newest inbound agent event against the newest request timeout. Not from a
 *    socket object existing.
 *  - **Last sync** — a real sync timestamp or the word *Never*. A health probe
 *    cannot stamp one, and neither can this strip. Cronsole-native reports none
 *    at all because this database is its source of truth.
 *  - **Last command** — the newest recorded verb outcome, success *or* failure,
 *    from the same capability evidence the Platforms tab renders. A status line
 *    that hid failures would go quiet exactly when something is wrong.
 *
 * When there is nothing to report it renders nothing rather than a row of
 * dashes: an empty strip is honest, and a strip full of placeholders looks like
 * a system reporting health it has not measured.
 */
export const HealthStrip = () => {
  const { data: connections } = useConnections();
  const { data: matrix } = usePlatformMatrix();
  const [diagnosing, setDiagnosing] = useState(false);

  const rows = matrix?.platforms ?? [];
  const outcome = newestOutcome(rows);

  // Only platforms with a real connection. An unconfigured one has never been
  // asked anything, so it has no health to report — and listing it as a grey dot
  // would put a permanent "problem" on a dashboard where nothing is wrong.
  const connected = (connections ?? []).filter(c => c.state);

  // The newest real sync across platforms — the same rule the old chip used, and
  // the reason one connector fabricating a timestamp would defeat every other.
  const lastSync = connected
    .map(c => c.lastSync)
    .filter((s): s is string => !!s)
    .sort()
    .at(-1) ?? null;

  // Name a platform only when something is wrong with it — or when we cannot
  // say that nothing is. When everything is healthy there is no "worst", and
  // picking whichever came back first named Cronsole-native — a platform that is
  // the server itself and so is online whenever anything is rendering this at
  // all. A status line that reports the one component that cannot fail is
  // decoration.
  //
  // UNKNOWN ranks last because the two above it are *observed* problems and it
  // is an absence of observation — but it must rank at all, or the green branch
  // below prints "All 3 platforms online" over a platform nothing has heard from
  // since yesterday. That sentence is the confident lie this strip exists to
  // avoid, and it is worse than the amber it replaces: amber over-warns, green
  // tells you to stop looking.
  const ailing = connected.find(c => c.state === 'OFFLINE')
    ?? connected.find(c => c.state === 'DEGRADED')
    ?? connected.find(c => c.state === 'UNKNOWN')
    ?? null;

  // When any platform last said anything. Newest across all of them, matching
  // how `lastSync` is taken — comparing one platform's contact against another's
  // sync would produce a difference that is about neither.
  const lastContact = connected
    .map(c => c.lastContactAt)
    .filter((s): s is string => !!s)
    .sort()
    .at(-1) ?? null;

  // Shown only when it is NEWER than the sync, because that is the only case
  // where it adds a fact: the platform is alive but the task list is older than
  // its liveness suggests — the exact situation that was hidden while one of
  // these was reported as the other (troubleshooting #41).
  const contactIsNewer = !!lastContact && (!lastSync || lastContact > lastSync);

  if (connected.length === 0 && !lastSync && !outcome) return null;

  return (
    <>
    <div
      // Every value here is a relative time, so the visual-regression suite
      // masks the whole strip rather than chasing each one.
      data-testid="health-strip"
      /*
        One line, always, and it scrolls rather than wraps.

        It used to be `flex-wrap`, which made its height depend on its own text —
        so when a segment appeared ("agent replied 2m ago") or a relative time
        grew a digit, the strip went from one row to two and shoved the entire
        dashboard down by ~22px. That is a layout shift on a 45-second poll,
        under the reader's cursor, with no interaction to explain it. Scrolling
        keeps the geometry fixed no matter what the text does.
      */
      className="flex items-center gap-x-4 whitespace-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden text-[11px] bg-raised border border-border rounded-xl px-3 py-2"
    >
      {ailing ? (
        <span className={`inline-flex shrink-0 items-center gap-1.5 font-bold ${healthMeta(ailing.state).text}`}>
          <span className={`h-2 w-2 rounded-full ${healthMeta(ailing.state).dot}`} />
          {platformLabel(ailing.platform)} {healthMeta(ailing.state).label.toLowerCase()}
          {ailing.reason && <span className="font-medium opacity-80">— {ailing.reason}</span>}
        </span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-1.5 font-bold text-success-text">
          <span className="h-2 w-2 rounded-full bg-success" />
          {connected.length === 1
            ? `${platformLabel(connected[0].platform)} online`
            : `All ${connected.length} platforms online`}
        </span>
      )}

      <span
        className="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground"
        title={
          contactIsNewer
            ? `The agent last responded ${timeAgo(lastContact!)}, but that was not a sync — the task list is as old as it says.`
            : undefined
        }
      >
        <RefreshCw size={11} />
        {/*
          "Never" and not "just now". The chip takes the newest real sync across
          platforms, so if none has happened the honest word is the empty one.
        */}
        {lastSync ? <>Synced {timeAgo(lastSync)}</> : <>Never synced</>}
        {contactIsNewer && (
          <span className="opacity-70">· agent replied {timeAgo(lastContact!)}</span>
        )}
      </span>

      {outcome ? (
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 ${outcome.ok ? 'text-muted-foreground' : 'text-danger-text font-bold'}`}
          title={outcome.reason ?? undefined}
        >
          {outcome.ok ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
          {outcome.verbLabel} {outcome.ok ? 'succeeded' : 'failed'} on {outcome.platformLabel} {timeAgo(outcome.at)}
        </span>
      ) : (
        // Not a failure and not a success — Cronsole has not asked a platform to
        // do anything yet. Saying so beats an empty space the reader has to
        // interpret, and beats a green tick it has not earned.
        <span className="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground">
          <Terminal size={11} />
          No commands run yet
        </span>
      )}

      {/*
        The way from a verdict to its reasons, put where the verdict is.

        A diagnostics panel reachable only from the Tools tab is found by someone
        who already knows to look for it; this line is where the reader is
        standing when the question occurs to them. It is rendered **always**, not
        only when something is ailing, because the strip's fixed geometry is
        load-bearing — a control that appears on a bad poll would shift the
        dashboard under the cursor, which is the layout shift this element was
        rebuilt to stop.

        `ml-auto` rather than a gap so it stays at the end of a strip that
        scrolls rather than wraps.
      */}
      <button
        onClick={() => setDiagnosing(true)}
        className="ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-md border border-border
                   hover:bg-surface px-2 py-0.5 font-medium text-muted-foreground hover:text-foreground transition"
      >
        <Stethoscope size={11} />
        Diagnose
      </button>
    </div>

    {diagnosing && <DiagnosticsModal onClose={() => setDiagnosing(false)} />}
    </>
  );
};
