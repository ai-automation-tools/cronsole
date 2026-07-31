using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Microsoft.Win32.TaskScheduler;

namespace Cronsole.Agent
{
    public class Win32TaskScheduler : ITaskScheduler
    {
        // The Task Scheduler folder Cronsole-created Windows tasks live under. Note
        // this is distinct from the self-heal *infrastructure* folder "\Cronsole-Stack\"
        // (hyphenated, owned by the PowerShell setup scripts) — we only ever create
        // or delete this one.
        private const string CronsoleFolder = "Cronsole";

        public List<AgentTaskInfo> ListTasks()
        {
            using (TaskService ts = new TaskService())
            {
                var results = new List<AgentTaskInfo>();
                foreach (var t in ts.AllTasks)
                {
                    var info = new AgentTaskInfo
                    {
                        Path = t.Path,
                        Name = t.Name,
                        State = t.State.ToString(),
                        Enabled = t.Enabled,
                        LastRunTime = NullIfUnset(t.LastRunTime),
                        NextRunTime = NullIfUnset(t.NextRunTime)
                    };

                    // Windows' own verdict on the last run, read separately from
                    // the definition block below: these live on the registered
                    // Task rather than its TaskDefinition, so an ACL that hides
                    // the definition does not have to cost us the run result too.
                    //
                    // A task that has never run reports LastTaskResult = 267011
                    // (SCHED_S_TASK_HAS_NOT_RUN), which is emphatically not an
                    // exit code — surface it as null, because "never ran" and
                    // "ran and returned 267011" are different facts and only one
                    // of them is true.
                    try
                    {
                        info.LastTaskResult = info.LastRunTime == null ? (int?)null : t.LastTaskResult;
                        info.NumberOfMissedRuns = t.NumberOfMissedRuns;
                    }
                    catch
                    {
                        // Unreadable — stays null, which the scorer reads as
                        // "no evidence" rather than "healthy".
                    }

                    // Definition access can throw (access denied) for some system
                    // tasks — read every definition-derived field under one guard so
                    // a locked-down task still surfaces its basic status honestly.
                    try
                    {
                        var def = t.Definition;
                        info.Trigger = ReadFirstTrigger(def);
                        info.Actions = ReadActions(def);
                        info.Description = NullIfEmpty(def.RegistrationInfo.Description);
                        info.Author = NullIfEmpty(def.RegistrationInfo.Author);
                        info.UserId = NullIfEmpty(def.Principal.UserId);
                        info.RunLevel = def.Principal.RunLevel.ToString();
                        info.LogonType = def.Principal.LogonType.ToString();
                    }
                    catch
                    {
                        // Unreadable definition — enriched fields stay null (honest).
                    }

                    results.Add(info);
                }
                return results;
            }
        }

        // Task Scheduler reports unset run times as DateTime.MinValue (0001) or a
        // 1899/1999 sentinel; surface those as null rather than a bogus date.
        private static DateTime? NullIfUnset(DateTime dt) =>
            dt < new DateTime(2000, 1, 1) ? (DateTime?)null : dt;

        private static string? NullIfEmpty(string? s) =>
            string.IsNullOrWhiteSpace(s) ? null : s;

        // First trigger we can express as a 5-field cron; null for boot/logon/event.
        private static TriggerSpec? ReadFirstTrigger(TaskDefinition def)
        {
            foreach (Trigger trig in def.Triggers)
            {
                var spec = TriggerReader.Read(trig);
                if (spec != null) return spec;
            }
            return null;
        }

        // Every action the task runs; exec actions carry executable/args/working dir.
        private static List<AgentActionInfo> ReadActions(TaskDefinition def)
        {
            var list = new List<AgentActionInfo>();
            foreach (Microsoft.Win32.TaskScheduler.Action action in def.Actions)
            {
                if (action is ExecAction exec)
                {
                    list.Add(new AgentActionInfo
                    {
                        Type = "Exec",
                        Path = exec.Path,
                        Arguments = NullIfEmpty(exec.Arguments),
                        WorkingDirectory = NullIfEmpty(exec.WorkingDirectory)
                    });
                }
                else
                {
                    list.Add(new AgentActionInfo { Type = action.ActionType.ToString() });
                }
            }
            return list;
        }

        public bool SetTaskStatus(string path, bool enabled)
        {
            using (TaskService ts = new TaskService())
            {
                var task = ts.GetTask(path);
                if (task != null)
                {
                    task.Enabled = enabled;
                    return true;
                }
                return false;
            }
        }

        public bool RunTask(string path)
        {
            using (TaskService ts = new TaskService())
            {
                var task = ts.GetTask(path);
                if (task != null)
                {
                    task.Run();
                    return true;
                }
                return false;
            }
        }

        public bool DeleteTask(string path)
        {
            using (TaskService ts = new TaskService())
            {
                var task = ts.GetTask(path);
                if (task == null) return false;
                // Delete from the task's own containing folder so paths under
                // \Cronsole\ (or anywhere else) resolve without string surgery.
                var folder = task.Folder;
                folder.DeleteTask(task.Name, exceptionOnNotExists: false);

                // If that emptied our \Cronsole\ folder, remove the folder too —
                // Task Scheduler doesn't auto-prune empty folders, so it would
                // otherwise linger. Guarded to *our* folder only (never the root
                // or the hyphenated infra folder), and best-effort: a failure here
                // must not turn a successful task delete into an error.
                TryPruneCronsoleFolder(ts, folder);
                return true;
            }
        }

        /// <summary>
        /// Delete the \Cronsole\ folder when it holds no tasks and no subfolders.
        /// No-op for any other folder. Swallows failures (e.g. a concurrent
        /// registration or an ACL) so the caller's delete still reports success.
        /// </summary>
        private static void TryPruneCronsoleFolder(TaskService ts, TaskFolder folder)
        {
            try
            {
                if (folder == null) return;
                // Only our own top-level folder: \Cronsole\ (name == "Cronsole",
                // parented directly on root). Never touch root or \Cronsole-Stack\.
                if (!string.Equals(folder.Name, CronsoleFolder, StringComparison.OrdinalIgnoreCase)) return;
                if (folder.Tasks.Count != 0 || folder.SubFolders.Count != 0) return;

                ts.RootFolder.DeleteFolder(CronsoleFolder, exceptionOnNotExists: false);
            }
            catch
            {
                // Best-effort cleanup; the task delete already succeeded.
            }
        }

        public string? ExportTaskXml(string path)
        {
            using (TaskService ts = new TaskService())
            {
                // Task.Xml is the native definition — identical to what
                // Export-ScheduledTask and the Task Scheduler UI's Export emit.
                var task = ts.GetTask(path);
                return task?.Xml;
            }
        }

        /// <summary>
        /// Register a task from its native Task Scheduler XML — the inverse of
        /// ExportTaskXml, and the only write path that accepts a whole task
        /// definition authored outside Cronsole.
        ///
        /// Everything is re-validated here rather than trusted from the command.
        /// This process holds the elevation and calls RegisterTaskDefinition, which
        /// silently OVERWRITES a same-named task in the same folder — so a backend
        /// bug, or a signed command built from a bad path, must still be refused at
        /// the boundary that holds the privilege. Same reasoning as CreateTask.
        /// </summary>
        public AgentImportResult ImportTaskXml(string path, string xml, bool overwrite, bool createFolders)
        {
            var normalizedPath = TaskFolderPath.Normalize(path);
            var result = new AgentImportResult { Path = normalizedPath };

            if (string.IsNullOrWhiteSpace(xml))
            {
                result.Message = "No task XML supplied.";
                return result;
            }

            var name = TaskFolderPath.LeafOf(path);
            var nameProblem = TaskFolderPath.ValidateTaskName(name);
            if (nameProblem != null)
            {
                result.Message = nameProblem;
                return result;
            }

            var folder = TaskFolderPath.ParentOf(path);
            var folderProblem = TaskFolderPath.Validate(folder);
            if (folderProblem != null)
            {
                result.Message = folderProblem;
                return result;
            }

            using (TaskService ts = new TaskService())
            {
                // Parse BEFORE touching the machine: a malformed definition should
                // fail without having created a folder for it to land in.
                TaskDefinition td;
                try
                {
                    td = ts.NewTask();
                    td.XmlText = xml;
                }
                catch (Exception ex)
                {
                    result.Message = $"Windows could not read this task XML: {ex.Message}";
                    return result;
                }

                // An existing task is refused unless the caller asked for an
                // overwrite. Checked here so the message can say WHY; Windows
                // enforces it independently below via TaskCreation.Create, so a
                // task created between this check and the register still can't be
                // clobbered.
                Microsoft.Win32.TaskScheduler.Task? existing = null;
                try { existing = ts.GetTask(normalizedPath); } catch { /* treat as absent */ }
                if (existing != null && !overwrite)
                {
                    result.Outcome = "exists";
                    result.Message = "A task already exists at this path. It was left exactly as it is.";
                    return result;
                }

                TaskFolder? destination = ResolveFolder(ts, folder);
                if (destination == null)
                {
                    if (!createFolders)
                    {
                        result.Message = $"Task Scheduler folder '{folder}' does not exist. " +
                                         "Turn on \"Recreate missing folders\" to restore the folder tree, " +
                                         "or create the folder in Task Scheduler first.";
                        return result;
                    }

                    try
                    {
                        destination = CreateFolderChain(ts, folder, result.FoldersCreated);
                    }
                    catch (Exception ex)
                    {
                        result.Message = $"Could not create folder '{folder}': {ex.Message}";
                        return result;
                    }
                }

                // TaskLogonType.None means "do not override the definition" — the
                // principal in the XML (its run-as account and logon type) is the
                // one that gets registered. A task that was registered with a stored
                // password cannot be restored without that password, and Windows
                // says so; that error is surfaced verbatim rather than retried under
                // a different identity, which would silently change who the task
                // runs as.
                var createType = overwrite ? TaskCreation.CreateOrUpdate : TaskCreation.Create;
                destination.RegisterTaskDefinition(name, td, createType, null, null, TaskLogonType.None, null);

                result.Success = true;
                result.Outcome = existing != null ? "replaced" : "created";
                result.Message = existing != null ? "Task replaced" : "Task restored";
                return result;
            }
        }

        /// <summary>
        /// Create every missing folder along <paramref name="path"/>, recording each
        /// one it actually created into <paramref name="created"/>.
        ///
        /// This is the single carve-out to "Cronsole creates only its own \Cronsole":
        /// a restore is the user asking for their own folder tree back by name. The
        /// created list is not optional bookkeeping — folder deletion needs
        /// elevation, so a folder created here is a door only the user can close,
        /// and it must never be created silently.
        /// </summary>
        private static TaskFolder CreateFolderChain(TaskService ts, string path, List<string> created)
        {
            TaskFolder current = ts.RootFolder;
            var walked = "";

            foreach (var segment in TaskFolderPath.Split(path))
            {
                walked += "\\" + segment;

                TaskFolder? next = null;
                try { next = current.SubFolders[segment]; } catch { /* not found */ }

                if (next == null)
                {
                    // exceptionOnExists: false — another process (or a concurrent
                    // restore of a sibling task) may have created it between the
                    // lookup and here, which is not an error.
                    next = current.CreateFolder(segment, (string?)null, false);
                    created.Add(walked);
                }

                current = next;
            }

            return current;
        }

        public bool UpdateTaskSchedule(string path, TriggerSpec trigger)
        {
            if (trigger == null) throw new ArgumentNullException(nameof(trigger));
            using (TaskService ts = new TaskService())
            {
                var task = ts.GetTask(path);
                if (task == null) return false;

                // Replace ONLY the first cron-expressible trigger — the one Cronsole
                // surfaced as the schedule — and re-register under the same
                // name/folder. Reusing the live TaskDefinition preserves the task's
                // Actions, Principal, RegistrationInfo, and Settings; leaving the
                // other triggers alone preserves any boot/logon/event triggers a
                // multi-trigger task also carries (we're editing the schedule, not
                // wiping the task's other ways of firing). If the task has no
                // cron-expressible trigger (shouldn't happen — the UI only offers
                // editing when one exists), we add the new one without removing any.
                var def = task.Definition;
                int cronIndex = -1;
                for (int i = 0; i < def.Triggers.Count; i++)
                {
                    if (TriggerReader.Read(def.Triggers[i]) != null) { cronIndex = i; break; }
                }
                if (cronIndex >= 0) def.Triggers.RemoveAt(cronIndex);
                def.Triggers.Add(TriggerBuilder.Build(trigger));
                task.Folder.RegisterTaskDefinition(task.Name, def);
                return true;
            }
        }

        public bool UpdateTaskActions(string path, AgentExecAction action, string? description, string runLevel)
        {
            if (action == null) throw new ArgumentNullException(nameof(action));
            using (TaskService ts = new TaskService())
            {
                var task = ts.GetTask(path);
                if (task == null) return false;

                // Reuse the live TaskDefinition so triggers, principal identity
                // (logon type / run-as user), and untouched settings are preserved;
                // we only rewrite the exec action + description + run level.
                var def = task.Definition;

                // Register a DIRECT ExecAction from the structured action — never a
                // `cmd.exe /c` shell wrapper — with args quoted per Windows rules so
                // a value with spaces/quotes stays one argument (mirrors CreateTask).
                string argString = ArgumentQuoting.Join(action.Args);
                var exec = new ExecAction(
                    action.Executable,
                    string.IsNullOrEmpty(argString) ? null : argString,
                    string.IsNullOrWhiteSpace(action.WorkingDirectory) ? null : action.WorkingDirectory);

                // The editor only offers action editing for single-exec-action tasks,
                // so replacing the action set with the edited exec action is exact for
                // that case. (Multi-action tasks aren't editable in the UI yet.)
                def.Actions.Clear();
                def.Actions.Add(exec);

                def.RegistrationInfo.Description =
                    string.IsNullOrWhiteSpace(description) ? null : description;
                def.Principal.RunLevel =
                    string.Equals(runLevel, "highest", StringComparison.OrdinalIgnoreCase)
                        ? TaskRunLevel.Highest
                        : TaskRunLevel.LUA;

                task.Folder.RegisterTaskDefinition(task.Name, def);
                return true;
            }
        }

        /// <summary>
        /// Find the EXISTING folder at <paramref name="path"/>, or null if any
        /// segment is missing. Creates nothing.
        ///
        /// Cronsole deliberately does not create arbitrary folders: folder deletion
        /// requires elevation, so anything it created would be permanent litter the
        /// user has to remove by hand from Task Scheduler. The one exception is
        /// \Cronsole itself (see ResolveDestination) — the only folder it creates,
        /// and the only one it prunes. Never create what you cannot remove.
        ///
        /// Assumes the path already passed TaskFolderPath.Validate, so it cannot
        /// contain traversal segments or reach \Microsoft\. Walks segment by segment
        /// so a partially existing path (\Work exists, \Work\Backups does not)
        /// resolves to null rather than silently creating the tail.
        /// </summary>
        private static TaskFolder? ResolveFolder(TaskService ts, string path)
        {
            var segments = TaskFolderPath.Split(path);
            TaskFolder current = ts.RootFolder;

            foreach (var segment in segments)
            {
                TaskFolder? next = null;
                try { next = current.SubFolders[segment]; } catch { /* not found */ }
                if (next == null) return null;
                current = next;
            }

            return current;
        }

        /// <summary>
        /// Resolve the destination folder for a create. \Cronsole is created lazily
        /// (it is ours, and TryPruneCronsoleFolder removes it again when the last
        /// task goes); any other folder must already exist.
        /// </summary>
        private static TaskFolder? ResolveDestination(TaskService ts, string path)
        {
            var existing = ResolveFolder(ts, path);
            if (existing != null) return existing;

            if (TaskFolderPath.IsDefault(path))
            {
                // Our own folder: lazily created, and pruned again when emptied.
                return ts.RootFolder.CreateFolder(TaskFolderPath.Default.TrimStart('\\'));
            }

            return null;
        }

        /// <summary>
        /// Every Task Scheduler folder, depth-first from the root. Read-only.
        /// Reports unwritable folders (\Microsoft\…) rather than hiding them, so
        /// the UI can say WHY instead of failing late or silently omitting them.
        /// </summary>
        public List<AgentFolderInfo> ListFolders()
        {
            using (TaskService ts = new TaskService())
            {
                var results = new List<AgentFolderInfo>();
                Walk(ts.RootFolder, results);
                return results;
            }
        }

        private static void Walk(TaskFolder folder, List<AgentFolderInfo> into)
        {
            // A folder's own tasks/subfolders can throw on access-denied; report
            // what we can see and keep walking rather than failing the whole
            // enumeration because one system folder is locked down.
            int taskCount = 0;
            try { taskCount = folder.Tasks.Count; } catch { /* unreadable */ }

            var path = string.IsNullOrEmpty(folder.Path) ? "\\" : folder.Path;
            into.Add(new AgentFolderInfo
            {
                Path = path,
                TaskCount = taskCount,
                Writable = TaskFolderPath.Validate(path) == null
            });

            try
            {
                foreach (var sub in folder.SubFolders) Walk(sub, into);
            }
            catch { /* unreadable subfolder list */ }
        }

        public AgentTaskResult CreateTask(string name, string schedule, AgentExecAction action, TriggerSpec? trigger = null, string? folder = null)
        {
            using (TaskService ts = new TaskService())
            {
                TaskDefinition td = ts.NewTask();
                td.RegistrationInfo.Description = "Created via Cronsole";

                if (trigger != null)
                {
                    td.Triggers.Add(TriggerBuilder.Build(trigger));
                }
                else if (schedule == "0 3 * * *")
                {
                    // Legacy fallback for servers that don't send a structured trigger.
                    td.Triggers.Add(new DailyTrigger { StartBoundary = DateTime.Today.AddHours(3) });
                }
                else if (schedule == "0 * * * *")
                {
                    var tt = new TimeTrigger { StartBoundary = DateTime.Now };
                    tt.Repetition.Interval = TimeSpan.FromHours(1);
                    td.Triggers.Add(tt);
                }
                else
                {
                    Console.WriteLine($"Warning: no trigger spec for schedule '{schedule}'; falling back to daily at now+1h.");
                    td.Triggers.Add(new DailyTrigger { StartBoundary = DateTime.Now.AddHours(1) });
                }

                // Register a DIRECT ExecAction from the structured action - never a
                // `cmd.exe /c` shell wrapper. Args are quoted per Windows rules so a
                // value with spaces/quotes stays one argument; no value can inject a
                // second command because no shell parses the line.
                string argString = ArgumentQuoting.Join(action.Args);
                td.Actions.Add(new ExecAction(
                    action.Executable,
                    string.IsNullOrEmpty(argString) ? null : argString,
                    string.IsNullOrWhiteSpace(action.WorkingDirectory) ? null : action.WorkingDirectory));

                // Resolve the destination folder. Defaults to \Cronsole, which keeps
                // Cronsole-created tasks identifiable and cleanly removable (and
                // category-extracts as "Cronsole" on sync). Created lazily — a
                // folder only exists while it holds tasks.
                //
                // Re-validated HERE even though the backend validated and SIGNED
                // it: this process holds the elevation and is the one calling
                // RegisterTaskDefinition, which silently OVERWRITES a same-named
                // task in the same folder. A backend bug must not be able to
                // land a task under \Microsoft\Windows\ and destroy a real system
                // task. Refuse honestly rather than degrade.
                var targetFolder = string.IsNullOrWhiteSpace(folder)
                    ? TaskFolderPath.Default
                    : folder;

                var folderProblem = TaskFolderPath.Validate(targetFolder);
                if (folderProblem != null)
                {
                    return new AgentTaskResult
                    {
                        Success = false,
                        Name = name,
                        Message = folderProblem
                    };
                }

                TaskFolder? destination = ResolveDestination(ts, targetFolder);
                if (destination == null)
                {
                    // Refuse honestly rather than create it. Cronsole only creates
                    // \Cronsole (which it also prunes) — folder deletion needs
                    // elevation, so any other folder it created would be permanent
                    // litter only the user could clear.
                    return new AgentTaskResult
                    {
                        Success = false,
                        Name = name,
                        Message = $"Task Scheduler folder '{TaskFolderPath.Normalize(targetFolder)}' does not exist. " +
                                  "Cronsole only creates its own \\Cronsole folder — create the folder in Task Scheduler " +
                                  "first, or choose an existing one."
                    };
                }

                var task = destination.RegisterTaskDefinition(name, td);

                return new AgentTaskResult
                {
                    Success = true,
                    Path = task.Path,
                    Name = name,
                    Message = "Task created successfully"
                };
            }
        }
    }
}
