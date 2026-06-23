using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;

namespace TaskHub.Agent
{
    public class AgentService
    {
        private readonly ISocketClient _socket;
        private readonly ITaskScheduler _scheduler;

        public AgentService(ISocketClient socket, ITaskScheduler scheduler)
        {
            _socket = socket ?? throw new ArgumentNullException(nameof(socket));
            _scheduler = scheduler ?? throw new ArgumentNullException(nameof(scheduler));

            SetupSocketEvents();
        }

        public async Task StartAsync()
        {
            Console.WriteLine("Connecting to server...");
            try
            {
                await _socket.ConnectAsync();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Connection failed: {ex.Message}");
            }
        }

        private void SetupSocketEvents()
        {
            _socket.OnConnected += async () =>
            {
                Console.WriteLine("Connected to TaskHub server!");

                // Announce ourselves
                await _socket.EmitAsync("agent:hello", new[] { new {
                    machineName = Environment.MachineName,
                    agentVersion = "1.0.0",
                    osVersion = Environment.OSVersion.ToString()
                }});
            };

            _socket.OnDisconnected += () =>
            {
                Console.WriteLine("Disconnected from TaskHub server.");
            };

            // Event: task:list (Server requested a full sync)
            _socket.On("task:list", async response =>
            {
                Console.WriteLine("Server requested task:list. Syncing...");
                try
                {
                    var tasks = _scheduler.ListTasks()
                        .Select(t => new
                        {
                            path = t.Path,
                            name = t.Name,
                            state = t.State,
                            lastRunTime = t.LastRunTime,
                            nextRunTime = t.NextRunTime
                        }).ToList();

                    await _socket.EmitAsync("task:full_list", new[] { new { tasks = tasks } });
                    Console.WriteLine($"Synced {tasks.Count} tasks to server.");
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error during sync: {ex.Message}");
                }
            });

            // Event: task:set_status (Server commanded us to enable/disable a task)
            _socket.On("task:set_status", response =>
            {
                try
                {
                    var taskPath = response.GetValue<string>(0);
                    var enabled = response.GetValue<bool>(1);

                    Console.WriteLine($"Server command: task:set_status -> {taskPath} (enabled={enabled})");

                    bool success = _scheduler.SetTaskStatus(taskPath, enabled);
                    if (success)
                    {
                        Console.WriteLine($"Task {taskPath} is now {(enabled ? "enabled" : "disabled")}.");
                    }
                    else
                    {
                        Console.WriteLine($"Task {taskPath} not found for status update.");
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error setting status: {ex.Message}");
                }
            });

            // Event: task:run (Server commanded us to run a task)
            _socket.On("task:run", async response =>
            {
                var taskPath = response.GetValue<string>(0);
                Console.WriteLine($"Server command: task:run -> {taskPath}");

                try
                {
                    bool success = _scheduler.RunTask(taskPath);
                    if (success)
                    {
                        Console.WriteLine($"Task {taskPath} started.");

                        // Report execution result
                        await _socket.EmitAsync("task:executed", new[] { new {
                            taskExternalId = taskPath,
                            success = true,
                            output = "Started successfully"
                        }});
                    }
                    else
                    {
                        Console.WriteLine($"Task {taskPath} not found for running.");
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error running task: {ex.Message}");
                }
            });

            // Event: task:create (Server commanded us to create a new task)
            _socket.On("task:create", async response =>
            {
                try
                {
                    var data = response.GetValue<JsonElement>(0);
                    string name = data.GetProperty("name").GetString() ?? "Unnamed Task";
                    string schedule = data.GetProperty("schedule").GetString() ?? "0 3 * * *";
                    string command = data.GetProperty("command").GetString() ?? "echo Hello";

                    Console.WriteLine($"Server command: task:create -> {name} (schedule={schedule})");

                    var result = _scheduler.CreateTask(name, schedule, command);

                    if (result.Success)
                    {
                        Console.WriteLine($"Task {name} created successfully at {result.Path}.");

                        await _socket.EmitAsync("task:created", new[] { new {
                            success = true,
                            path = result.Path,
                            name = name,
                            message = "Task created successfully"
                        }});
                    }
                    else
                    {
                        throw new Exception(result.Message);
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error creating task: {ex.Message}");
                    await _socket.EmitAsync("task:created", new[] { new {
                        success = false,
                        name = "unknown",
                        message = ex.Message
                    }});
                }
            });
        }
    }
}
