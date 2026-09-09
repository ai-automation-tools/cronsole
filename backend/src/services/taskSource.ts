import { PlatformType } from '@prisma/client';

/**
 * **Which source a task belongs to on the dashboard.**
 *
 * A *platform* is what Cronsole talks to — one connector, one capability row,
 * one row in `PlatformConnection`. A **source** is the finer thing a user
 * actually navigates by, and for Cronsole-native the two stopped matching the
 * moment native gained a second job type: "call a URL every 15 minutes" and "run
 * this PowerShell script nightly" are not the same kind of thing, and folding
 * them into one bucket makes the source bar's most granular entry its least
 * informative one.
 *
 * So the key is `PLATFORM` or `PLATFORM:SUBTYPE`, and the two ideas stay
 * separate where it matters:
 *  - **Platform** still drives the connector registry, the capability matrix and
 *    sync. Native HTTP and native EXEC have *identical* capabilities, because
 *    they are the same connector — so the Platforms tab stays three rows and does
 *    not split.
 *  - **Source** drives the dashboard's first-level axis, and nothing else.
 *
 * Derived on the **server**, and sent on each task like `isSystem`, for the same
 * reason: it reads `metadata.job.jobType`, and a browser-side copy of "how do you
 * tell what kind of native task this is" is a second definition of a judgement —
 * the shape that silently took a folder out of every sync (troubleshooting #20a).
 */

/** Separator between a platform and its subtype. Never appears in a PlatformType. */
export const SOURCE_SEP = ':';

/**
 * The native job types that get their own source key.
 *
 * Kept as an explicit list rather than "whatever `jobType` says", so a row
 * carrying a `jobType` this build does not know about — a task created by a newer
 * Cronsole, or a hand-edited row — falls back to the bare platform key instead of
 * inventing a source the rail cannot render and no filter can reach.
 */
export const NATIVE_SUBTYPES = ['HTTP', 'EXEC', 'SCRIPT', 'CHECK'] as const;

/**
 * The source key for a task.
 *
 * Only Cronsole-native subdivides today. A native task whose job spec is missing
 * or unreadable gets the **bare** platform key rather than being guessed into
 * `:HTTP` — every native task written by this app has always carried an explicit
 * `jobType`, so a missing one means something is wrong with the row, and quietly
 * filing it under a job type it may not have would hide that.
 */
export function taskSourceKey(platform: PlatformType, metadata: unknown): string {
  if (platform !== PlatformType.TASKHUB_NATIVE) return platform;

  const job = (metadata as { job?: { jobType?: unknown } } | null)?.job;
  const jobType = typeof job?.jobType === 'string' ? job.jobType : null;
  if (jobType && (NATIVE_SUBTYPES as readonly string[]).includes(jobType)) {
    return `${platform}${SOURCE_SEP}${jobType}`;
  }
  return platform;
}

/**
 * Does a task's source key fall under the selected source?
 *
 * Prefix-aware on purpose: selecting the bare `TASKHUB_NATIVE` matches both its
 * subtypes, so a saved view or a persisted default naming a *platform* keeps
 * working unchanged now that sources are finer than platforms. Exported so the
 * frontend predicate and any server-side consumer share one rule rather than two
 * that agree until they don't.
 */
export function sourceMatches(taskSourceKeyValue: string, selected: string): boolean {
  if (selected === 'All') return true;
  return (
    taskSourceKeyValue === selected ||
    taskSourceKeyValue.startsWith(`${selected}${SOURCE_SEP}`)
  );
}
