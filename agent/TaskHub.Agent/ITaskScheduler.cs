using System;
using System.Collections.Generic;

namespace TaskHub.Agent
{
    public interface ITaskScheduler
    {
        List<AgentTaskInfo> ListTasks();
        bool SetTaskStatus(string path, bool enabled);
        bool RunTask(string path);
        AgentTaskResult CreateTask(string name, string schedule, string command, TriggerSpec? trigger = null);
    }

    public class AgentTaskInfo
    {
        public string Path { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string State { get; set; } = string.Empty;
        public bool Enabled { get; set; }
        // Nullable so unset run times (Task Scheduler's DateTime.MinValue / 1899
        // sentinels) are sent as null instead of "0001-01-01" — see TriggerReader.
        public DateTime? LastRunTime { get; set; }
        public DateTime? NextRunTime { get; set; }
        // First cron-expressible trigger, if any; null for boot/logon/event tasks.
        public TriggerSpec? Trigger { get; set; }
        // Registration/principal detail powering the task-detail view. Null when
        // the task's definition is unreadable (access denied) — see Win32TaskScheduler.
        public string? Description { get; set; }
        public string? Author { get; set; }
        public string? UserId { get; set; }
        public string? RunLevel { get; set; }
        public string? LogonType { get; set; }
        // All actions the task runs (exec = executable + args + working dir).
        public List<AgentActionInfo>? Actions { get; set; }
    }

    public class AgentActionInfo
    {
        public string Type { get; set; } = string.Empty;
        public string? Path { get; set; }
        public string? Arguments { get; set; }
        public string? WorkingDirectory { get; set; }
    }

    public class AgentTaskResult
    {
        public bool Success { get; set; }
        public string Path { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
    }
}
