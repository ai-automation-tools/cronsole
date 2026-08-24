import { BookOpen, ExternalLink, GitPullRequest } from 'lucide-react';
import { addingASourceDoc } from '../../data/docs';

/**
 * The honest answer to "can I add my own scheduler?".
 *
 * A source is a `PlatformConnector` compiled into the backend — there is no
 * plugin folder, and saying otherwise would advertise an extension point that
 * does not exist. So this panel points at the contributor doc and at a pull
 * request, and says up front that the answer may be *no*, because a connector
 * for a platform with no scheduled-task API renders as a row of refusals that
 * says less than a bookmark does.
 *
 * **It links to `docs/contributing/Adding_A_Source.md`, not to the Sources
 * Guide's section**, which is where it pointed until 2026-08-24. That guide is
 * for people *using* Cronsole, so a developer who clicked this landed two-thirds
 * of the way down a long page about something else and had to work out which
 * half applied to them.
 *
 * Lives at the foot of **Available**: it is the last thing on the list of
 * sources you could have, which is exactly what it is.
 */
export const AddCustomSourcePanel = () => (
  <div className="bg-surface border border-border border-dashed rounded-2xl p-5 flex flex-col items-start gap-3">
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
      thing, not a stalled one — GitHub Actions and Vercel Cron both ship that way on purpose. The
      guide starts with a five-minute proposal, so{' '}
      <span className="font-bold text-foreground">
        &ldquo;this should be a quick link&rdquo;
      </span>{' '}
      costs you a paragraph rather than a weekend.
    </p>

    {/*
      Styled as the card's primary action rather than as a line of body text.
      It is the only thing on this panel you can actually do, and it was
      previously a bold sentence sitting directly under two other bold
      sentences — findable if you already knew it was a link, and invisible
      otherwise.

      Still an `<a>`, not a `<button>`: it navigates. The leading glyph says
      *documentation* and the trailing one says *new tab*, which is the pair
      every other outbound link in the app uses. `title` carries the same fact
      for anyone who cannot see the arrow.
    */}
    <a
      href={addingASourceDoc()}
      target="_blank"
      rel="noopener noreferrer"
      title="Opens the Adding a source guide on GitHub in a new tab"
      className="self-start inline-flex items-center gap-2 bg-primary hover:bg-primary-hover text-primary-foreground px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-150 active:scale-[0.98] shadow-lg shadow-primary/20 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      <BookOpen size={15} className="shrink-0" />
      Read: Adding a source
      <ExternalLink size={13} className="shrink-0 opacity-70" />
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
