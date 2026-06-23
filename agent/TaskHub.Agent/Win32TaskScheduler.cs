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

        public AgentTaskResult CreateTask(string name, string schedule, string command)
        {
            using (TaskService ts = new TaskService())
            {
                TaskDefinition td = ts.NewTask();
                td.RegistrationInfo.Description = "Created via TaskHub";

                // Basic schedule parsing for MVP (same as original Program.cs)
                if (schedule == "0 3 * * *")
                {
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
                    // Default fallback: Daily at current time + 1 hour
                    td.Triggers.Add(new DailyTrigger { StartBoundary = DateTime.Now.AddHours(1) });
                }

                td.Actions.Add(new ExecAction("cmd.exe", $"/c {command}", null));

                var task = ts.RootFolder.RegisterTaskDefinition(name, td);

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
