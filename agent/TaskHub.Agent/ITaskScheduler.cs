using System;
using System.Collections.Generic;

namespace TaskHub.Agent
{
    public interface ITaskScheduler
    {
        List<AgentTaskInfo> ListTasks();
        // Every Task Scheduler folder that exists, so the UI can offer real
        // folders instead of assuming \TaskHub. Read-only.
        List<AgentFolderInfo> ListFolders();
        bool SetTaskStatus(string path, bool enabled);
        bool RunTask(string path);
        // `folder` is the Task Scheduler folder to register into (defaults to
        // \TaskHub). It is validated HERE as well as server-side — this process
        // holds the elevation and calls RegisterTaskDefinition, which silently
        // overwrites a same-named task in the same folder, so it must not trust
        // its caller. See TaskFolderPath.
        AgentTaskResult CreateTask(string name, string schedule, AgentExecAction action, TriggerSpec? trigger = null, string? folder = null);
        // Returns false when no task exists at the path (treated as an
        // idempotent success by the caller — the end state already holds).
        bool DeleteTask(string path);
        // Replace an existing task's trigger with the given spec, preserving its
        // actions/principal/settings. Returns false when no task exists at the path.
        bool UpdateTaskSchedule(string path, TriggerSpec trigger);
        // Replace an existing task's exec action and set its description + run
        // level, preserving its triggers, principal identity, and other settings.
        // runLevel is "least" or "highest". Returns false when no task exists.
        bool UpdateTaskActions(string path, AgentExecAction action, string? description, string runLevel);
        // Return the task's native Task Scheduler XML (the exact format
        // Export-ScheduledTask / the Task Scheduler UI's Export produces), so it
        // round-trips into any Windows machine. Null when no task exists at the path.
        string? ExportTaskXml(string path);
    }

    // Structured action the agent registers as the task's ExecAction. The server
    // splits the resolved command into an executable + discrete argument strings
    // so no shell (cmd.exe) is ever invoked - see backend utils/commandParser.ts.
    public class AgentExecAction
    {
        public string Executable { get; set; } = string.Empty;
        public List<string> Args { get; set; } = new List<string>();
        public string? WorkingDirectory { get; set; }
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

    // A real Task Scheduler folder. Reported honestly, including ones TaskHub
    // will not write to: the UI shows WHY a folder is unavailable rather than
    // hiding it and letting the user wonder, or offering it and failing late.
    public class AgentFolderInfo
    {
        // Normalized path, e.g. "\", "\TaskHub", "\Microsoft\Windows".
        public string Path { get; set; } = string.Empty;
        // How many tasks live directly in this folder (not counting subfolders).
        public int TaskCount { get; set; }
        // False for \Microsoft\ and its descendants — Windows' own tasks live
        // there and a name collision would silently overwrite one.
        public bool Writable { get; set; }
    }

    public class AgentTaskResult
    {
        public bool Success { get; set; }
        public string Path { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
    }
}
