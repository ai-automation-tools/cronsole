using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Microsoft.Win32.TaskScheduler;

namespace TaskHub.Agent
{
    public class Win32TaskScheduler : ITaskScheduler
    {
        // The Task Scheduler folder TaskHub-created Windows tasks live under. Note
        // this is distinct from the self-heal *infrastructure* folder "\Task-Hub\"
        // (hyphenated, owned by the PowerShell setup scripts) — we only ever create
        // or delete this one.
        private const string TaskHubFolder = "TaskHub";

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
                // \TaskHub\ (or anywhere else) resolve without string surgery.
                var folder = task.Folder;
                folder.DeleteTask(task.Name, exceptionOnNotExists: false);

                // If that emptied our \TaskHub\ folder, remove the folder too —
                // Task Scheduler doesn't auto-prune empty folders, so it would
                // otherwise linger. Guarded to *our* folder only (never the root
                // or the hyphenated infra folder), and best-effort: a failure here
                // must not turn a successful task delete into an error.
                TryPruneTaskHubFolder(ts, folder);
                return true;
            }
        }

        /// <summary>
        /// Delete the \TaskHub\ folder when it holds no tasks and no subfolders.
        /// No-op for any other folder. Swallows failures (e.g. a concurrent
        /// registration or an ACL) so the caller's delete still reports success.
        /// </summary>
        private static void TryPruneTaskHubFolder(TaskService ts, TaskFolder folder)
        {
            try
            {
                if (folder == null) return;
                // Only our own top-level folder: \TaskHub\ (name == "TaskHub",
                // parented directly on root). Never touch root or \Task-Hub\.
                if (!string.Equals(folder.Name, TaskHubFolder, StringComparison.OrdinalIgnoreCase)) return;
                if (folder.Tasks.Count != 0 || folder.SubFolders.Count != 0) return;

                ts.RootFolder.DeleteFolder(TaskHubFolder, exceptionOnNotExists: false);
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

        public bool UpdateTaskSchedule(string path, TriggerSpec trigger)
        {
            if (trigger == null) throw new ArgumentNullException(nameof(trigger));
            using (TaskService ts = new TaskService())
            {
                var task = ts.GetTask(path);
                if (task == null) return false;

                // Replace ONLY the first cron-expressible trigger — the one TaskHub
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

        public AgentTaskResult CreateTask(string name, string schedule, AgentExecAction action, TriggerSpec? trigger = null)
        {
            using (TaskService ts = new TaskService())
            {
                TaskDefinition td = ts.NewTask();
                td.RegistrationInfo.Description = "Created via TaskHub";

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

                // TaskHub-created tasks live under \TaskHub\ so they're identifiable
                // and cleanly removable (and category-extract as "TaskHub" on sync).
                // Created lazily — the folder only exists while it holds tasks.
                TaskFolder? folder = null;
                try { folder = ts.GetFolder(TaskHubFolder); } catch { /* not found */ }
                folder ??= ts.RootFolder.CreateFolder(TaskHubFolder);

                var task = folder.RegisterTaskDefinition(name, td);

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
