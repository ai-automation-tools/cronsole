using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Text.Json;
using Microsoft.Win32.TaskScheduler;
using SocketIOClient;

// Fix ambiguity between Microsoft.Win32.TaskScheduler.Task and System.Threading.Tasks.Task
using Task = System.Threading.Tasks.Task;

Console.WriteLine("TaskHub Windows Agent Starting...");

// Configuration
var serverUrl = "http://localhost:3000";
var client = new SocketIO(new Uri(serverUrl));

client.OnConnected += async (sender, e) =>
{
    Console.WriteLine("Connected to TaskHub server!");

    // Announce ourselves
    await client.EmitAsync("agent:hello", new[] { new {
        machineName = Environment.MachineName,
        agentVersion = "1.0.0",
        osVersion = Environment.OSVersion.ToString()
    }});
};

client.OnDisconnected += (sender, e) =>
{
    Console.WriteLine("Disconnected from TaskHub server.");
};

// Event: task:list (Server requested a full sync)
client.On("task:list", async response =>
{
    Console.WriteLine("Server requested task:list. Syncing...");
    try
    {
        using (TaskService ts = new TaskService())
        {
            var tasks = ts.AllTasks
                .Select(t => new
                {
                    path = t.Path,
                    name = t.Name,
                    state = t.State.ToString(),
                    lastRunTime = t.LastRunTime,
                    nextRunTime = t.NextRunTime
                }).ToList();

            await client.EmitAsync("task:full_list", new[] { new { tasks = tasks } });
            Console.WriteLine($"Synced {tasks.Count} tasks to server.");
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Error during sync: {ex.Message}");
    }
});

// Event: task:set_status (Server commanded us to enable/disable a task)
client.On("task:set_status", async response =>
{
    try
    {
        var taskPath = response.GetValue<string>(0);
        var enabled = response.GetValue<bool>(1);

        Console.WriteLine($"Server command: task:set_status -> {taskPath} (enabled={enabled})");

        using (TaskService ts = new TaskService())
        {
            var task = ts.GetTask(taskPath);
            if (task != null)
            {
                task.Enabled = enabled;
                Console.WriteLine($"Task {taskPath} is now {(enabled ? "enabled" : "disabled")}.");
            }
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Error setting status: {ex.Message}");
    }
});

// Event: task:run (Server commanded us to run a task)
client.On("task:run", async response =>
{
    var taskPath = response.GetValue<string>(0);
    Console.WriteLine($"Server command: task:run -> {taskPath}");

    try
    {
        using (TaskService ts = new TaskService())
        {
            var task = ts.GetTask(taskPath);
            if (task != null)
            {
                task.Run();
                Console.WriteLine($"Task {taskPath} started.");

                // Report execution result
                await client.EmitAsync("task:executed", new[] { new {
                    taskExternalId = taskPath,
                    success = true,
                    output = "Started successfully"
                }});
            }
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Error running task: {ex.Message}");
    }
});

// Event: task:create (Server commanded us to create a new task)
client.On("task:create", async response =>
{
    try
    {
        var data = response.GetValue<JsonElement>(0);
        string name = data.GetProperty("name").GetString() ?? "Unnamed Task";
        string schedule = data.GetProperty("schedule").GetString() ?? "0 3 * * *";
        string command = data.GetProperty("command").GetString() ?? "echo Hello";

        Console.WriteLine($"Server command: task:create -> {name} (schedule={schedule})");

        using (TaskService ts = new TaskService())
        {
            TaskDefinition td = ts.NewTask();
            td.RegistrationInfo.Description = "Created via TaskHub";

            // Basic schedule parsing for MVP
            if (schedule == "0 3 * * *") {
                td.Triggers.Add(new DailyTrigger { StartBoundary = DateTime.Today.AddHours(3) });
            } else if (schedule == "0 * * * *") {
                var tt = new TimeTrigger { StartBoundary = DateTime.Now };
                tt.Repetition.Interval = TimeSpan.FromHours(1);
                td.Triggers.Add(tt);
            } else {
                // Default fallback: Daily at current time + 1 hour
                td.Triggers.Add(new DailyTrigger { StartBoundary = DateTime.Now.AddHours(1) });
            }

            td.Actions.Add(new ExecAction("cmd.exe", $"/c {command}", null));

            var task = ts.RootFolder.RegisterTaskDefinition(name, td);
            Console.WriteLine($"Task {name} created successfully at {task.Path}.");

            await client.EmitAsync("task:created", new[] { new {
                success = true,
                path = task.Path,
                name = name,
                message = "Task created successfully"
            }});
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Error creating task: {ex.Message}");
        await client.EmitAsync("task:created", new[] { new {
            success = false,
            name = "unknown",
            message = ex.Message
        }});
    }
});

try
{
    Console.WriteLine($"Connecting to {serverUrl}...");
    await client.ConnectAsync();
}
catch (Exception ex)
{
    Console.WriteLine($"Connection failed: {ex.Message}");
}

Console.WriteLine("Agent is running. Press Ctrl+C to stop.");
await Task.Delay(-1); // Keep the app running
