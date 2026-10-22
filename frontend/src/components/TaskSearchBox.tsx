import { useEffect, useState, type RefObject } from 'react';
import { Search, X } from 'lucide-react';

interface Props {
  /** The search as the URL holds it. */
  value: string;
  /** Write a new search to the URL. Called once typing pauses, or at once on clear. */
  onCommit: (next: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * The dashboard's search box. It types into its **own** state and the URL follows.
 *
 * Binding the input straight to the URL dropped keys and wiped the box:
 * BrowserRouter applies a location change inside `startTransition`, so the urgent
 * render after a keystroke still read the old URL and React put the old value
 * back in the field — type faster than a full dashboard re-filter commits and
 * whole words vanish. Holding the text here also means a keystroke re-renders
 * this box, not the dashboard. The URL's late echo of our own write is ignored;
 * only a change made elsewhere (a clear button, a saved view, Back) flows in.
 */
export const TaskSearchBox = ({ value, onCommit, inputRef }: Props) => {
  const [text, setText] = useState(value);
  const [written, setWritten] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== written) {
      setWritten(value);
      setText(value);
    }
  }

  const commit = (next: string) => {
    setWritten(next);
    onCommit(next);
  };

  useEffect(() => {
    if (text === value) return;
    const handle = setTimeout(() => commit(text), 150);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, value]);

  const clear = () => {
    setText('');
    commit('');
  };

  return (
    <div className="relative">
      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle-foreground pointer-events-none" />
      <input
        ref={inputRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            clear();
            e.currentTarget.blur();
          }
        }}
        placeholder="Search tasks…  /"
        className="w-44 focus:w-60 bg-surface border border-border rounded-xl pl-8 pr-7 py-1.5 text-xs font-medium text-foreground placeholder:text-subtle-foreground outline-none focus:border-primary transition-all shadow-md"
      />
      {text && (
        <button
          onClick={clear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-subtle-foreground hover:text-foreground transition-colors"
          title="Clear search (Esc)"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
};
