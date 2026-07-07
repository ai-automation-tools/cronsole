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
                return ts.AllTasks
                    .Select(t => new AgentTaskInfo
                    {
                        Path = t.Path,
                        Name = t.Name,
                        State = t.State.ToString(),
                        LastRunTime = t.LastRunTime,
                        NextRunTime = t.NextRunTime
                    }).ToList();
            }
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

        public AgentTaskResult CreateTask(string name, string schedule, string command, TriggerSpec? trigger = null)
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

                td.Actions.Add(new ExecAction("cmd.exe", $"/c {command}", null));

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
