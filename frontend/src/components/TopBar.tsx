import { LayoutDashboard, Settings, Cpu, Library, LogOut, Wrench } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '../hooks/useAuth';

/**
 * The app's first-level navigation, across the top.
 *
 * It was a 256px left column holding five links, a theme toggle, the signed-in
 * identity and a "System Status" panel. Two problems with that, and the second
 * is the one that made the dashboard hard to read:
 *
 * **It spent a fixed quarter of the width on five links that never change.** The
 * dashboard needs that column for something that *does* change — the source and
 * folder tree, which is what you actually navigate by once there are 350 tasks.
 *
 * **It put health in the wrong place.** The System Status panel listed each
 * platform with a state dot, which is exactly what the source rail rows now show
 * beside the platform they describe, and what `HealthStrip` reports in more
 * detail. Three surfaces for one fact is two too many; the panel is gone and the
 * dot moved to the rail.
 *
 * There is **no mobile drawer here any more**, and that is a deletion rather than
 * a regression. The old sidebar needed one — an off-canvas panel, a backdrop, an
 * Escape handler, and an `inert` dance to keep a hidden menu out of the tab order.
 * Five icons fit across a 375px screen, so below `sm` the labels drop and the bar
 * stays exactly where it is. The drawer that remains belongs to the *source rail*,
 * which genuinely cannot fit — and it is opened from the dashboard's own header,
 * beside the list it re-scopes, rather than from up here. A control belongs next
 * to the thing it acts on, and this bar is not that thing.
 */

const NAV = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'templates', label: 'Templates', Icon: Library },
  { id: 'platforms', label: 'Platforms', Icon: Cpu },
  { id: 'tools', label: 'Tools', Icon: Wrench },
  { id: 'settings', label: 'Settings', Icon: Settings }
] as const;

interface TopBarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const TopBar = ({ activeTab, setActiveTab }: TopBarProps) => {
  const { user, logout } = useAuth();

  return (
    /*
      Chrome, and it should read as chrome: a translucent blurred plate sitting
      *above* the page rather than a strip of the same colour with a line under
      it. `bg-surface/80` + blur gives it a hairline of depth without a drop
      shadow, which at 56px tall would read as a bruise rather than elevation.
    */
    <header className="shrink-0 z-30 border-b border-border bg-surface/80 backdrop-blur-xl supports-[backdrop-filter]:bg-surface/70">
      <div className="flex items-center h-14 px-3 sm:px-4">
        {/* ── Brand ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/*
            The mark reads as an object rather than a floating PNG: a ring and a
            faint primary bloom give it an edge against the plate. `select-none`
            because a logo that highlights on a stray double-click looks broken.
          */}
          <span className="relative flex h-8 w-8 items-center justify-center rounded-[10px] bg-background ring-1 ring-border shadow-[0_0_0_3px_hsl(var(--primary)/0.06)] select-none">
            <img src="/favicon.svg" alt="" aria-hidden className="h-[18px] w-[18px]" />
          </span>
          {/* First thing to go when width is short — the mark still identifies
              the app, and the nav is what the width is for. */}
          <span className="hidden sm:inline text-[15px] font-bold tracking-[-0.01em] select-none">
            Cronsole
          </span>
        </div>

        {/* A hairline, not a gap. Three zones live in this bar and a gap alone
            let the wordmark and the first tab read as one run of text. */}
        <span aria-hidden className="hidden sm:block h-5 w-px bg-border mx-3 shrink-0" />

        {/* ── Sections ──────────────────────────────────────────────────── */}
        <nav aria-label="Sections" className="flex items-stretch h-full gap-0.5 min-w-0">
          {NAV.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                aria-current={active ? 'page' : undefined}
                // Named on every screen: below `sm` the label drops to fit five
                // items, and `title` + `aria-label` carry the name instead, so
                // the control is never an unlabelled glyph to a screen reader.
                aria-label={label}
                title={label}
                /*
                  A tab, anchored to the bar — not a floating pill.

                  The accent is a 2px rule on the bottom edge that sits *on* the
                  header's own border (`-bottom-px`), so the active section is
                  visually joined to the page under it. A rounded fill said "a
                  button here is highlighted"; this says "you are in here", which
                  is the actual question a nav answers.
                */
                className={`group relative flex items-center gap-2 px-2.5 sm:px-3 text-sm font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 rounded-t-lg ${
                  active
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                }`}
              >
                <Icon
                  size={16}
                  className={`shrink-0 transition-colors ${active ? 'text-primary' : ''}`}
                />
                <span className="hidden sm:inline">{label}</span>
                <span
                  aria-hidden
                  className={`pointer-events-none absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary transition-all duration-200 ${
                    active ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-50'
                  }`}
                />
              </button>
            );
          })}
        </nav>

        {/* ── Account ───────────────────────────────────────────────────── */}
        <div className="ml-auto flex items-center gap-1 shrink-0 pl-3">
          <ThemeToggle compact />
          <span aria-hidden className="hidden lg:block h-5 w-px bg-border mx-1.5" />
          <span
            className="hidden lg:block max-w-[18ch] truncate text-xs text-subtle-foreground"
            title={user?.email ?? undefined}
          >
            {user?.email ?? 'this device'}
          </span>
          <button
            onClick={logout}
            className="p-2 rounded-lg text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
};

export default TopBar;
