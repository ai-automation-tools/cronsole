import { ExternalLink, GitPullRequest } from 'lucide-react';
import { sourcesGuide } from '../../data/docs';

/**
 * The honest answer to "can I add my own scheduler?".
 *
 * A source is a `PlatformConnector` compiled into the backend — there is no
 * plugin folder, and saying otherwise would advertise an extension point that
 * does not exist. So this panel points at the guide and at a pull request, and
 * says up front that the answer may be *no*, because a connector for a platform
 * with no scheduled-task API renders as a row of refusals that says less than a
 * bookmark does.
 *
 * Lives at the foot of **Available**: it is the last thing on the list of
 * sources you could have, which is exactly what it is.
 */
export const AddCustomSourcePanel = () => (
  <div className="bg-surface border border-border border-dashed rounded-2xl p-5 space-y-3">
    <div className="flex items-center gap-2.5">
      <span className="h-9 w-9 rounded-lg bg-muted text-muted-foreground shrink-0 grid place-items-center">
        <GitPullRequest size={16} />
      </span>
      <h4 className="font-bold text-[15px]">A source is a connector, so it arrives as a pull request</h4>
    </div>

    <p className="text-xs text-subtle-foreground leading-relaxed">
      Sources are compiled into Cronsole rather than loaded at runtime — a connector holds
      credentials, issues commands to your machine and decides what a sync may retire, which is not
      something to load off disk unreviewed. Adding one means opening a PR against the repository,
      and you will get a straight answer about whether it fits: a platform with no public
      scheduled-task API is better served by a quick link, which says more than a row of refusals
      would.
    </p>

    <p className="text-xs text-subtle-foreground leading-relaxed">
      A connector that only <span className="font-bold text-foreground">reads</span> is a finished
      thing, not a stalled one — GitHub Actions ships that way on purpose.
    </p>

    <a
      href={sourcesGuide('adding-a-source')}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 text-xs font-bold text-foreground hover:text-primary transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
    >
      Sources Guide › Adding a source <ExternalLink size={12} />
    </a>
  </div>
);

/**
 * What the screen shows while the matrix is in flight.
 *
 * A skeleton rather than a spinner: the card's shape is known before its content
 * is, so drawing it means the page does not jump when the answer lands. A
 * spinner in the middle of the content area throws that away and re-lays out
 * everything below it.
 */
export const SourceCardSkeleton = () => (
  <div className="bg-surface border border-border rounded-2xl p-5 space-y-5" aria-hidden>
    <div className="flex items-start gap-3.5">
      <div className="h-11 w-11 rounded-xl bg-muted animate-pulse shrink-0" />
      <div className="flex-1 space-y-2 pt-1">
        <div className="h-3.5 w-44 rounded bg-muted animate-pulse" />
        <div className="h-2.5 w-full max-w-md rounded bg-muted/60 animate-pulse" />
      </div>
      <div className="h-6 w-20 rounded-lg bg-muted animate-pulse shrink-0" />
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-border">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="space-y-2">
          <div className="h-2 w-16 rounded bg-muted/60 animate-pulse" />
          <div className="h-3 w-10 rounded bg-muted animate-pulse" />
        </div>
      ))}
    </div>
  </div>
);
