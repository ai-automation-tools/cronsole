import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, type ThemeMode } from '../hooks/useTheme';

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: 'light', label: 'Light', Icon: Sun },
  { mode: 'dark', label: 'Dark', Icon: Moon },
  { mode: 'system', label: 'System', Icon: Monitor },
];

/**
 * `compact` drops the written labels, leaving three icons.
 *
 * For the top toolbar, where a labelled three-way group is most of the space the
 * nav needs. The label survives as `title` **and** `aria-label` rather than being
 * dropped — an icon-only control still has to be named to a screen reader, and
 * "Light theme" is the name whether or not it is drawn.
 */
export const ThemeToggle = ({ compact = false }: { compact?: boolean } = {}) => {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="group"
      aria-label="Theme"
      /*
        The compact variant drops the border and sits on `muted` instead of a
        bordered `surface` panel. In the top toolbar the bordered box was the
        heaviest element in the bar — a three-way preference outweighing the
        navigation, which is backwards. Borderless keeps it at the same visual
        weight as a nav item, which is what it is.
      */
      className={`flex items-center gap-0.5 rounded-xl ${
        compact ? 'bg-muted/60 p-0.5' : 'border border-border bg-surface gap-1 p-1'
      }`}
    >
      {OPTIONS.map(({ mode, label, Icon }) => {
        const active = theme === mode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => setTheme(mode)}
            aria-pressed={active}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95 ${
              compact ? 'px-1.5 py-1' : 'px-2 py-1.5'
            } ${
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Icon size={13} />
            {!compact && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
};
