using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Microsoft.Win32.TaskScheduler;

namespace TaskHub.Agent
{
    public class Win32TaskScheduler : ITaskScheduler
    {
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
                TaskFolder? folder = null;
                try { folder = ts.GetFolder("TaskHub"); } catch { /* not found */ }
                folder ??= ts.RootFolder.CreateFolder("TaskHub");

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
