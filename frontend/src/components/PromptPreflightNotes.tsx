import { AlertTriangle } from 'lucide-react';
import type { PromptWarning } from '../hooks/usePromptPreflight';

/**
 * The preflight panel that sits under a prompt box.
 *
 * One component so the create form and the recreate modal say the same thing in
 * the same place — the second is where a prompt is *edited*, which on Gemini is
 * the ordinary case, so a warning that only existed at create would miss most of
 * the prompts anyone writes.
 *
 * Styled as advice, not as an error: `warning` rather than `danger`, no icon on
 * the individual lines, and nothing anywhere disables the submit button. None of
 * these rules is certainly right, and the panel earns its place only as long as
 * a reader can dismiss one by simply not acting on it.
 */
export const PromptPreflightNotes = ({ warnings }: { warnings: PromptWarning[] }) => {
  if (warnings.length === 0) return null;

  return (
    <div
      role="status"
      className="text-[10px] text-warning-text bg-warning/5 border border-warning/30 rounded-xl px-3 py-2 space-y-1.5"
    >
      <p className="flex items-center gap-1.5 font-bold uppercase tracking-wider">
        <AlertTriangle size={11} className="shrink-0" />
        {warnings.length === 1 ? 'Worth checking' : `${warnings.length} things worth checking`}
      </p>
      <ul className="space-y-1">
        {warnings.map(w => (
          <li key={w.code} className="leading-relaxed">
            {w.message}
          </li>
        ))}
      </ul>
      {/* Said once, at the bottom, so the list above reads as advice rather than
          as a list of errors the form is about to reject. */}
      <p className="italic opacity-80">
        These are notes, not blockers — nothing here stops you creating the task.
      </p>
    </div>
  );
};
