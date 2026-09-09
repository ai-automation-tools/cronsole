import { Sun, Moon, Monitor, Ghost, Snowflake, Sunset, MoonStar, type LucideIcon } from 'lucide-react';
import { useTheme, type ThemeMode } from '../hooks/useTheme';

const OPTIONS: { mode: ThemeMode; label: string; Icon: LucideIcon }[] = [
  { mode: 'light', label: 'Light', Icon: Sun },
  { mode: 'dark', label: 'Dark', Icon: Moon },
  { mode: 'system', label: 'System', Icon: Monitor },
  { mode: 'dracula', label: 'Dracula', Icon: Ghost },
  { mode: 'nord', label: 'Nord', Icon: Snowflake },
  { mode: 'solarized', label: 'Solarized', Icon: Sunset },
  { mode: 'tokyo-night', label: 'Tokyo Night', Icon: MoonStar },
];

/**
 * A native `<select>` rather than the button row this used to be: six modes
 * no longer fit as a segmented group without wrapping or shrinking below a
 * tappable size, and a `<select>` scales to a sixth (or tenth) option for
 * free. The current mode's icon sits beside it since an `<option>` can't
 * carry one of its own.
 *
 * `compact` (the top toolbar) tightens the padding and drops the border in
 * favour of `muted`, matching the old control's weight in that bar.
 */
export const ThemeToggle = ({ compact = false }: { compact?: boolean } = {}) => {
  const { theme, setTheme } = useTheme();
  const current = OPTIONS.find(o => o.mode === theme) ?? OPTIONS[1]!;

  return (
    <div
      className={`flex items-center gap-1.5 rounded-xl ${
        compact ? 'bg-muted/60 px-2 py-1' : 'border border-border bg-surface px-3 py-2'
      }`}
    >
      <current.Icon size={13} className="shrink-0 text-muted-foreground" aria-hidden />
      <select
        value={theme}
        onChange={e => setTheme(e.target.value as ThemeMode)}
        aria-label="Theme"
        title="Theme"
        className="bg-transparent text-[11px] font-bold text-foreground outline-none cursor-pointer"
      >
        {/*
          `color-scheme` on the theme classes (index.css) is not enough on its
          own: Chromium on Windows draws a <select>'s open list with the native
          combo-box popup, which several versions ignore `color-scheme` for and
          render with the OS's light chrome regardless of the page's theme —
          white popup, near-white --foreground text, invisible. Colouring each
          <option> directly works around it: Chromium does honour
          background-color/color set on the option itself.
        */}
        {OPTIONS.map(({ mode, label }) => (
          <option key={mode} value={mode} className="bg-background text-foreground">
            {label}
          </option>
        ))}
      </select>
    </div>
  );
};
