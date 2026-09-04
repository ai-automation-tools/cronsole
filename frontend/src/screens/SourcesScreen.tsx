import { useLocation, useNavigate } from 'react-router';
import { AlertTriangle, Compass, Link2, Plug } from 'lucide-react';
import { usePlatformMatrix } from '../hooks/usePlatformMatrix';
import { useSettings } from '../hooks/useSettings';
import { sourceVisibility, toggleShownSource } from '../utils/sourceVisibility';
import { SourceTabs, type SourceTabDef } from '../components/sources/SourceTabs';
import { ConnectedSourceCard } from '../components/sources/ConnectedSourceCard';
import { OfferSourceCard, PendingSourceCard } from '../components/sources/UnconnectedSourceCards';
import { QuickLinksPanel } from '../components/sources/QuickLinksPanel';
import { AddCustomSourcePanel, SourceCardSkeleton } from '../components/sources/AddCustomSourcePanel';
import { HelpButton } from '../components/HelpButton';

/**
 * Everything about **where tasks come from**: what Cronsole can do with each
 * source it has, what else it could be watching, and what it can only bookmark.
 *
 * This was the *Platforms* tab, which named the code rather than the question.
 *
 * ---------------------------------------------------------------------------
 * THE AXIS  (redesigned 2026-08-24)
 * ---------------------------------------------------------------------------
 *
 * **Three views, split on whether a source is connected**, because that is the
 * question someone opens this screen with. It used to split on
 * `sourceVisibility` alone — *Your sources* versus *Available* — and the seam
 * was in the wrong place: "yours" meant *listed in your sidebar*, so a source
 * with nothing behind it sat among the working ones wearing a full capability
 * matrix and the words "Not connected". The half-finished state was the one the
 * screen described worst, and it is the only one with anything to do.
 *
 *   1. **Connected** — `configured`. The matrix cards, with evidence.
 *   2. **Available** — everything not connected, in two groups: sources you
 *      have already added to your sidebar (which get the setup panel), then
 *      sources you have not. Ends with *Add a custom source*.
 *   3. **Quick links** — bookmarks to schedulers with no connector.
 *
 * **`sourceVisibility` is untouched, and still owns the sidebar.** Shown and
 * connected are two different facts and this screen now renders both: the tabs
 * read `configured`, the eye switch on each card reads `shown`. Collapsing them
 * would break the union rule that makes opting in additive — a platform added
 * to Cronsole later is absent from every existing `shownSources` list, so it
 * arrives opt-in without a migration.
 *
 * **The tabs are real navigation, not a scroll.** `?focus=` used to smooth-scroll
 * to an anchor; it now selects a view, so the rail's *Explore* / *Manage*
 * buttons, a reload and a shared link all land in the same place. The legacy
 * `yours` spelling still resolves, because it is in the wild.
 *
 * ---------------------------------------------------------------------------
 *
 * The rule the matrix is built on: **a cell is evidence, not a spec.** Three
 * states, and the middle one is the point — *verified* has succeeded here and
 * carries the timestamp that earned it, *declared* would be accepted but has
 * never been observed to work, *unsupported* would be refused. Nothing here is
 * derived in the browser; the server sends the verdict and the evidence behind
 * it, including `access`, which is a judgement and therefore the server's
 * (troubleshooting #20a).
 *
 * **Sidebar layout, centered, zoomed 1.25x** (2026-09-05) — the same shell as
 * `ToolsScreen`/`SettingsScreen`: `max-w-6xl mx-auto`, a `flex` row with the
 * nav on the left. `SourceTabs` itself became a vertical sidebar at `md:` and
 * up (still the same tablist it always was) rather than being replaced by
 * `CategoryNav` — the count-in-the-label and roving-tabindex arrow-key nav
 * are real tablist semantics that component doesn't carry.
 */

type Focus = 'connected' | 'available' | 'links';

export const SourcesScreen = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { settings, update } = useSettings();
  const { data, isLoading, isError } = usePlatformMatrix();

  const rows = data?.platforms ?? [];
  const connected = rows.filter(r => r.configured);
  const unconnected = rows.filter(r => !r.configured);
  // Within *Available*, the ones already in your sidebar come first: you asked
  // for them, so they are further along than a source you have never named.
  const pending = unconnected.filter(r => sourceVisibility(r, settings.shownSources).shown);
  const offers = unconnected.filter(r => !sourceVisibility(r, settings.shownSources).shown);

  const toggleShown = (platform: string) =>
    update('shownSources', toggleShownSource(settings.shownSources, platform));

  const focus = readFocus(location.search);
  const selectTab = (next: Focus) =>
    // `replace` so flipping between three views does not fill the back stack —
    // the button that got you here should still be one Back away.
    navigate({ pathname: '/sources', search: `?focus=${next}` }, { replace: true });

  const tabs: SourceTabDef<Focus>[] = [
    {
      id: 'connected',
      label: 'Connected',
      count: connected.length,
      Icon: Plug,
      hint: 'Sources with a working connection — what each can do, and the evidence behind it'
    },
    {
      id: 'available',
      label: 'Available',
      count: unconnected.length,
      Icon: Compass,
      hint: 'Everything Cronsole can connect to that is not connected yet'
    },
    {
      id: 'links',
      label: 'Quick links',
      count: settings.quickLinks.length,
      Icon: Link2,
      hint: 'Bookmarks to schedulers Cronsole has no connector for'
    }
  ];

  return (
    // Same shell as ToolsScreen/SettingsScreen: centered column, zoomed 1.25x,
    // a flex row with the nav on the left — the three tabbed screens end
    // their column in the same place and read as one pattern.
    <div className="animate-in fade-in duration-300 pb-20 max-w-6xl mx-auto" style={{ zoom: 1.25 }}>
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-1 flex items-center gap-1.5">
          Sources
          <HelpButton topic="platforms" size="md" />
        </h2>
        <p className="text-muted-foreground">
          Where your tasks come from — what Cronsole can do with each one, and what else it could watch.
        </p>
      </div>

      {isError && (
        <div className="mb-6 bg-surface border border-danger/30 rounded-2xl p-5 flex items-start gap-3 text-sm text-danger-text">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold">Could not load the capability matrix</p>
            <p className="text-xs opacity-90">
              The backend is not answering. Nothing has changed — this screen only reads.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-6">
        <SourceTabs tabs={tabs} active={focus} onSelect={selectTab} />

        <div
          role="tabpanel"
          id={`source-panel-${focus}`}
          aria-labelledby={`source-tab-${focus}`}
          tabIndex={-1}
          className="flex-1 min-w-0 outline-none"
        >
          {focus === 'connected' && (
            <div className="space-y-4">
              {isLoading && !isError && <><SourceCardSkeleton /><SourceCardSkeleton /></>}

              {connected.map(row => (
                <ConnectedSourceCard
                  key={row.platform}
                  row={row}
                  shownSources={settings.shownSources}
                  onToggleShown={toggleShown}
                />
              ))}

              {!isLoading && !isError && connected.length === 0 && (
                <EmptyState
                  Icon={Plug}
                  title="Nothing is connected yet"
                  body="A source connects when the Cronsole agent dials in, when the backend comes up, or when you fill in its panel. Available lists every source and what each one needs."
                  action={{ label: 'See what is available', onClick: () => selectTab('available') }}
                />
              )}
            </div>
          )}

          {focus === 'available' && (
            <div className="space-y-8">
              {isLoading && !isError && <SourceCardSkeleton />}

              {pending.length > 0 && (
                <section className="space-y-3">
                  <SectionHeading
                    title="Added to your sidebar"
                    blurb="Listed in the sidebar, but nothing is connected behind them yet."
                    count={pending.length}
                  />
                  <div className="space-y-3">
                    {pending.map(row => (
                      <PendingSourceCard
                        key={row.platform}
                        row={row}
                        shownSources={settings.shownSources}
                        onToggleShown={toggleShown}
                      />
                    ))}
                  </div>
                </section>
              )}

              {offers.length > 0 && (
                <section className="space-y-3">
                  <SectionHeading
                    title="Not added"
                    blurb="Adding one lists it in the sidebar so it has somewhere to be set up from. It stays empty until you connect it."
                    count={offers.length}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {offers.map(row => (
                      <OfferSourceCard key={row.platform} row={row} onAdd={() => toggleShown(row.platform)} />
                    ))}
                  </div>
                </section>
              )}

              {!isLoading && !isError && unconnected.length === 0 && (
                <EmptyState
                  Icon={Compass}
                  title="Every source is connected"
                  body="There is nothing left to add. A scheduler Cronsole has no connector for can still live under Quick links."
                  action={{ label: 'Open quick links', onClick: () => selectTab('links') }}
                />
              )}

              <section className="space-y-3">
                <SectionHeading title="Add a custom source" />
                <AddCustomSourcePanel />
              </section>
            </div>
          )}

          {focus === 'links' && <QuickLinksPanel />}
        </div>
      </div>
    </div>
  );
};

/**
 * `?focus=` from a rail button, or the default view.
 *
 * `yours` is the pre-2026-08-24 spelling for what is now *Connected*. It is
 * still accepted because it is in the wild — a bookmark, a link in a doc, an
 * older build of the rail — and a stale link that lands on the wrong tab is
 * indistinguishable from a broken one. Anything unrecognised falls back rather
 * than rendering an empty panel.
 */
function readFocus(search: string): Focus {
  const value = new URLSearchParams(search).get('focus');
  if (value === 'available' || value === 'links' || value === 'connected') return value;
  if (value === 'yours') return 'connected';
  return 'connected';
}

const SectionHeading = ({ title, blurb, count }: {
  title: string;
  blurb?: string;
  count?: number;
}) => (
  <div className="space-y-1">
    <div className="flex items-center gap-2">
      <h3 className="text-[10px] font-black text-subtle-foreground uppercase tracking-[0.2em]">{title}</h3>
      {count !== undefined && (
        <span className="text-[10px] font-black tabular-nums text-subtle-foreground">{count}</span>
      )}
    </div>
    {blurb && <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">{blurb}</p>}
  </div>
);

/**
 * An empty state that teaches the screen rather than announcing a void.
 *
 * Every one here has somewhere to go, because every empty view on this tab has
 * a next step — which is the difference between "nothing is connected" as a
 * fact and as a dead end.
 */
const EmptyState = ({ Icon, title, body, action }: {
  Icon: typeof Plug;
  title: string;
  body: string;
  action: { label: string; onClick: () => void };
}) => (
  <div className="bg-surface border border-border border-dashed rounded-2xl p-10 text-center space-y-3">
    <Icon size={22} className="mx-auto text-subtle-foreground" />
    <div className="space-y-1.5">
      <p className="font-bold">{title}</p>
      <p className="text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">{body}</p>
    </div>
    <button
      type="button"
      onClick={action.onClick}
      className="bg-muted hover:bg-primary hover:text-primary-foreground px-4 py-2 rounded-lg text-[13px] font-bold transition-all duration-150 active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      {action.label}
    </button>
  </div>
);

