import { useQuery } from '@tanstack/react-query';
import { FolderTree, Loader2, AlertTriangle } from 'lucide-react';
import { api } from '../api';

/** Mirrors DEFAULT_TASK_FOLDER in backend/src/utils/windowsTaskFolder.ts. */
export const DEFAULT_FOLDER = '\\Cronsole';

/**
 * The "New folder…" row's value. Deliberately contains a colon, which
 * `windowsTaskFolderError` refuses in a path segment, so it can never collide
 * with a real folder the agent reports.
 */
const NEW_FOLDER_OPTION = '::new::';

interface AgentFolder {
  path: string;
  taskCount: number;
  writable: boolean;
}

export interface WindowsFolderChoice {
  folder: string;
  /**
   * The signed opt-in. `false` means "refuse if the folder is missing", which
   * is the default everywhere — Cronsole creating a folder is an exception to a
   * standing invariant, so it has to be an explicit gesture rather than a
   * fallback. Choosing "New folder…" IS that gesture, which is why there is no
   * second checkbox beside it.
   */
  createFolder: boolean;
}

interface WindowsFolderFieldProps {
  value: WindowsFolderChoice;
  onChange: (next: WindowsFolderChoice) => void;
  /** Passed to /tasks/folders. Windows is the only platform with a hierarchy. */
  platform?: string;
  enabled?: boolean;
}

/**
 * The Task Scheduler folder a Windows task lands in — picked from the machine's
 * real folders, or typed as a new one.
 *
 * One definition for the two forms that create a Windows task (New Task and
 * Apply Template), because they were already drifting: Apply had a picker and
 * New Task hard-coded \Cronsole, so the same act produced a task in a different
 * place depending on which button you pressed.
 *
 * No client-side validation of the typed path. `windowsTaskFolderError` is the
 * one definition (the agent re-validates independently because it holds the
 * elevation), and its refusals are already user-facing sentences — a second
 * copy here is how a form accepts a path the server refuses, or worse, refuses
 * one the server would have taken.
 */
export const WindowsFolderField = ({
  value,
  onChange,
  platform = 'WINDOWS_TASK_SCHEDULER',
  enabled = true
}: WindowsFolderFieldProps) => {
  // The machine's real folders. A failure is not fatal: the field falls back to
  // the default rather than blocking the create — the backend and the agent both
  // validate the folder anyway, so an out-of-date list can't cause a bad write.
  const { data, isLoading, isError } = useQuery<{
    folders: AgentFolder[];
    defaultFolder: string;
  } | null>({
    queryKey: ['task-folders', platform],
    queryFn: async () => (await api.get('/tasks/folders', { params: { platform } })).data,
    enabled,
    staleTime: 60_000,
    retry: false
  });

  // Writable folders that already exist, plus the default — which belongs here
  // even on a fresh machine, where it doesn't exist yet and Cronsole makes it
  // lazily. \Microsoft\ is excluded rather than shown-and-disabled: the reason
  // is given once below, which is honest without listing dozens of unusable
  // system folders.
  const writableFolders = (data?.folders ?? []).filter(f => f.writable);
  const folderOptions = Array.from(
    new Set<string>([DEFAULT_FOLDER, ...writableFolders.map(f => f.path)])
  ).sort((a, b) => (a === DEFAULT_FOLDER ? -1 : b === DEFAULT_FOLDER ? 1 : a.localeCompare(b)));

  const selectValue = value.createFolder ? NEW_FOLDER_OPTION : value.folder;

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
        <FolderTree size={11} /> Task Scheduler folder
      </label>

      {isLoading ? (
        <div className="flex items-center gap-2 text-[11px] text-subtle-foreground px-3 py-2.5">
          <Loader2 size={11} className="animate-spin" /> Reading folders from your machine…
        </div>
      ) : (
        <select
          aria-label="Task Scheduler folder"
          value={selectValue}
          onChange={e =>
            onChange(
              e.target.value === NEW_FOLDER_OPTION
                // Empty rather than prefilled: a suggested path is one the user
                // may not read before clicking, and this one gets created.
                ? { folder: '', createFolder: true }
                : { folder: e.target.value, createFolder: false }
            )
          }
          className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
        >
          {/*
            First, not last. The list is as long as the machine has folders —
            a real one runs to dozens — so at the bottom the one option that is
            not a folder is the one you have to scroll to find, and it reads as
            an afterthought rather than a choice.
          */}
          <option value={NEW_FOLDER_OPTION}>New folder…</option>
          {folderOptions.map(path => {
            const meta = writableFolders.find(f => f.path === path);
            const count = meta ? ` (${meta.taskCount} task${meta.taskCount === 1 ? '' : 's'})` : '';
            return (
              <option key={path} value={path}>
                {path}{path === DEFAULT_FOLDER ? ' — default' : count}
              </option>
            );
          })}
        </select>
      )}

      {value.createFolder && (
        <input
          aria-label="New folder path"
          value={value.folder}
          onChange={e => onChange({ folder: e.target.value, createFolder: true })}
          placeholder="\Work\Nightly"
          spellCheck={false}
          className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors font-mono"
        />
      )}

      {isError ? (
        <p className="text-[10px] text-warning-text flex items-start gap-1.5">
          <AlertTriangle size={11} className="shrink-0 mt-0.5" />
          Couldn’t read your folders (the agent may be offline). You can still create the task in {DEFAULT_FOLDER}.
        </p>
      ) : value.createFolder ? (
        // Said before the click, because it is the half that doesn't undo:
        // Cronsole prunes only its own \Cronsole, so anything else it makes here
        // stays until someone removes it in Task Scheduler.
        <p className="text-[10px] text-subtle-foreground italic">
          Cronsole will create this folder chain if it doesn’t exist, and names every folder it made in the
          confirmation. <span className="not-italic">It won’t remove them again — only its own {DEFAULT_FOLDER} is
          cleaned up when empty — so deleting one later means doing it in Task Scheduler.</span>
          {' '}<span className="not-italic">\Microsoft\ is refused: Windows keeps its own tasks there, and a name
          collision would silently overwrite one.</span>
        </p>
      ) : (
        <p className="text-[10px] text-subtle-foreground italic">
          Where the task lives in Windows Task Scheduler — this also becomes its category in Cronsole.
          {' '}<span className="not-italic">Pick <span className="font-bold">New folder…</span> to have Cronsole create
          one.</span>
          {' '}<span className="not-italic">\Microsoft\ isn’t offered: Windows keeps its own tasks there, and a name
          collision would silently overwrite one.</span>
        </p>
      )}
    </div>
  );
};
