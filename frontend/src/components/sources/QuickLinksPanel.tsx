import { useState } from 'react';
import { ArrowUpRight, Bot, Cpu, Globe, Link2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';
import { DEFAULT_QUICK_LINKS, normalizeLinkUrl } from '../../utils/quickLinks';
import type { PlatformLink } from '../../types';

/**
 * Bookmarks to schedulers Cronsole has no connector for.
 *
 * **Nothing here is read or written**, and that sentence ships beside them —
 * it is the whole reason quick links are their own view rather than a fourth
 * kind of row among the sources. A bookmark that looks like a connector reads
 * as a broken connector.
 *
 * Two fixes this redesign carried (2026-08-24):
 *
 *  - **The remove button is no longer hover-only.** It sat at `-right-3` at
 *    `opacity-0` until you hovered the row, which on a touch screen is a
 *    control that does not exist — and mobile is first-class here. It is now
 *    always rendered, quiet until you reach for it.
 *  - **Tiles show the host, not the whole URL.** A full URL in a monospace line
 *    truncated at the width these tiles have, so every link ended in an
 *    ellipsis and told you nothing. The host is the part that identifies it;
 *    the full URL stays in the `title`.
 */
export const QuickLinksPanel = () => {
  const { settings, update } = useSettings();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');

  const links = settings.quickLinks;
  const saveLinks = (next: PlatformLink[]) => update('quickLinks', next);

  const addLink = () => {
    if (!newName || !newUrl) return;
    saveLinks([...links, {
      // `Date.now()` is enough: these are per-account bookmarks, not a keyspace
      // anything joins on, and two links added in the same millisecond by one
      // person through one form is not a case worth a uuid dependency.
      id: Date.now().toString(),
      name: newName,
      url: normalizeLinkUrl(newUrl),
      iconType: 'custom'
    }]);
    setNewName('');
    setNewUrl('');
    setShowAdd(false);
  };

  const deleteLink = (id: string) => saveLinks(links.filter(l => l.id !== id));

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
          Schedulers Cronsole has no connector for. These are bookmarks —{' '}
          <span className="font-bold text-foreground">nothing is read or written</span>, no task from
          here appears in your dashboard, and removing one removes only the link.
        </p>
        <button
          type="button"
          onClick={() => setShowAdd(!showAdd)}
          aria-expanded={showAdd}
          className="bg-muted hover:bg-primary hover:text-primary-foreground px-3.5 py-2 rounded-lg text-[13px] font-bold flex items-center gap-1.5 transition-all duration-150 active:scale-[0.98] shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {showAdd ? <X size={14} /> : <Plus size={14} />} {showAdd ? 'Cancel' : 'Add link'}
        </button>
      </div>

      {/*
        Inline, not a modal. Adding a bookmark needs neither interruption nor
        protected focus, and the form is two fields — a dialog for it would be
        the heaviest possible container for the lightest possible task.
      */}
      {showAdd && (
        <div className="bg-surface border border-border p-5 rounded-2xl space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-subtle-foreground" htmlFor="platform-link-name">
                Platform name
              </label>
              <input
                id="platform-link-name"
                type="text"
                placeholder="e.g. n8n, OpenClaw"
                className="w-full bg-background border border-border rounded-xl px-3.5 py-2 text-sm outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring transition-colors duration-150"
                value={newName}
                onChange={e => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-subtle-foreground" htmlFor="platform-link-url">
                URL
              </label>
              <input
                id="platform-link-url"
                type="text"
                placeholder="https://…"
                className="w-full bg-background border border-border rounded-xl px-3.5 py-2 text-sm outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-ring transition-colors duration-150"
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground transition-colors duration-150 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={addLink}
              disabled={!newName || !newUrl}
              className="bg-primary hover:bg-primary-hover text-primary-foreground px-5 py-2 rounded-xl text-sm font-bold shadow-lg shadow-primary/20 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all duration-150 active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Save link
            </button>
          </div>
        </div>
      )}

      {links.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {links.map(link => <QuickLinkTile key={link.id} link={link} onDelete={deleteLink} />)}
        </div>
      ) : (
        <div className="bg-surface border border-border border-dashed rounded-2xl p-8 text-center space-y-3">
          <Link2 size={22} className="mx-auto text-subtle-foreground" />
          <div className="space-y-1">
            <p className="font-bold text-sm">No quick links</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
              Somewhere you schedule work that Cronsole cannot read — a web console, an internal
              runner. Add it here and it is one click away from the sidebar.
            </p>
          </div>
          <button
            type="button"
            onClick={() => saveLinks(DEFAULT_QUICK_LINKS)}
            className="text-xs font-bold text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            Restore the defaults
          </button>
          <p className="text-[11px] text-subtle-foreground">Claude, ChatGPT and Gemini.</p>
        </div>
      )}
    </div>
  );
};

/** The icon a link wears. Identity, so it lives with the link's own type. */
const LINK_STYLE: Record<string, { Icon: typeof Bot; tile: string }> = {
  claude: { Icon: Bot, tile: 'bg-claude/10 text-claude-text' },
  chatgpt: { Icon: Cpu, tile: 'bg-chatgpt/10 text-chatgpt-text' },
  gemini: { Icon: Sparkles, tile: 'bg-primary/10 text-foreground' }
};

const QuickLinkTile = ({ link, onDelete }: {
  link: PlatformLink;
  onDelete: (id: string) => void;
}) => {
  const style = LINK_STYLE[link.iconType] ?? { Icon: Globe, tile: 'bg-muted text-muted-foreground' };
  const { Icon } = style;

  return (
    <div className="relative bg-surface border border-border rounded-2xl transition-colors duration-150 hover:border-primary/40 focus-within:border-primary/40">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        title={link.url}
        className="flex items-center gap-3 p-4 pr-11 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring group"
      >
        <span className={`h-9 w-9 rounded-lg ${style.tile} shrink-0 grid place-items-center`}>
          <Icon size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-sm text-foreground truncate">{link.name}</span>
          <span className="block text-[11px] text-subtle-foreground truncate">{hostOf(link.url)}</span>
        </span>
        <ArrowUpRight
          size={15}
          className="shrink-0 text-subtle-foreground group-hover:text-foreground transition-colors duration-150"
        />
      </a>

      {/*
        Always rendered, quiet until reached for. It used to be `opacity-0` until
        the row was hovered, which on a touch screen is a control that does not
        exist at all.
      */}
      <button
        type="button"
        onClick={() => onDelete(link.id)}
        aria-label={`Remove the ${link.name} link`}
        title="Remove link"
        className="absolute top-2 right-2 p-1.5 rounded-lg text-subtle-foreground hover:text-danger-text hover:bg-danger/10 opacity-60 hover:opacity-100 focus-visible:opacity-100 transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
};

/** The identifying part of a URL. Falls back to the raw string if it will not parse. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
