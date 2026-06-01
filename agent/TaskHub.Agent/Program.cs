using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
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
client.On("task:list", async ctx =>
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

            // Emit the full list as a named event
            await client.EmitAsync("task:full_list", new[] { new { tasks = tasks } });
            Console.WriteLine($"Synced {tasks.Count} tasks to server.");
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Error during sync: {ex.Message}");
    }
});

// Event: task:run (Server commanded us to run a task)
client.On("task:run", async ctx =>
{
    var taskPath = ctx.GetValue<string>(0);
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
            else
            {
                Console.WriteLine($"Task {taskPath} not found.");
                await client.EmitAsync("task:executed", new[] { new {
                    taskExternalId = taskPath,
                    success = false,
                    output = "Task not found"
                }});
            }
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Error running task: {ex.Message}");
        await client.EmitAsync("task:executed", new[] { new {
            taskExternalId = taskPath,
            success = false,
            output = ex.Message
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
