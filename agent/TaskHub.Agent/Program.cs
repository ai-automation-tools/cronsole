using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.Win32.TaskScheduler;
using SocketIOClient;

// Fix ambiguity between Microsoft.Win32.TaskScheduler.Task and System.Threading.Tasks.Task
using Task = System.Threading.Tasks.Task;

Console.WriteLine("TaskHub Windows Agent Spike Starting...");

// Configuration
var serverUrl = "http://localhost:3000";
var client = new SocketIO(new Uri(serverUrl));

client.OnConnected += (sender, e) =>
{
    Console.WriteLine("Connected to TaskHub server!");
};

client.OnDisconnected += (sender, e) =>
{
    Console.WriteLine("Disconnected from TaskHub server.");
};

// Event: task:list
client.On("task:list", async ctx =>
{
    Console.WriteLine("Processing task:list request...");
    try
    {
        using (TaskService ts = new TaskService())
        {
            // Limit to first 50 tasks for the spike to avoid context blowup
            var tasks = ts.AllTasks
                .Take(50)
                .Select(t => new
                {
                    path = t.Path,
                    name = t.Name,
                    state = t.State.ToString(),
                    lastRunTime = t.LastRunTime,
                    nextRunTime = t.NextRunTime
                }).ToList();

            await ctx.SendAckDataAsync(new object[] { tasks });
            Console.WriteLine($"Sent {tasks.Count} tasks to server.");
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Error listing tasks: {ex.Message}");
        await ctx.SendAckDataAsync(new object[] { new { error = ex.Message } });
    }
});

// Event: task:run
client.On("task:run", async ctx =>
{
    var taskPath = ctx.GetValue<string>(0);
    Console.WriteLine($"Processing task:run request for: {taskPath}");

    try
    {
        using (TaskService ts = new TaskService())
        {
            var task = ts.GetTask(taskPath);
            if (task != null)
            {
                task.Run();
                await ctx.SendAckDataAsync(new object[] { new { success = true, message = "Task started successfully." } });
                Console.WriteLine($"Task {taskPath} started.");
            }
            else
            {
                await ctx.SendAckDataAsync(new object[] { new { success = false, message = "Task not found." } });
                Console.WriteLine($"Task {taskPath} not found.");
            }
        }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"Error running task: {ex.Message}");
        await ctx.SendAckDataAsync(new object[] { new { success = false, message = ex.Message } });
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
