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
        private readonly AgentAuthenticator _auth;

        public AgentService(ISocketClient socket, ITaskScheduler scheduler, AgentAuthenticator auth)
        {
            _socket = socket ?? throw new ArgumentNullException(nameof(socket));
            _scheduler = scheduler ?? throw new ArgumentNullException(nameof(scheduler));
            _auth = auth ?? throw new ArgumentNullException(nameof(auth));

            SetupSocketEvents();
        }

        // Pull the shared { ts, sig } off a signed command payload. Returns false
        // if either is absent/ill-typed so the caller can reject the command.
        private static bool TryReadSignature(JsonElement data, out long ts, out string sig)
        {
            ts = 0;
            sig = string.Empty;
            if (data.ValueKind != JsonValueKind.Object) return false;
            if (!data.TryGetProperty("ts", out var tsEl) || !tsEl.TryGetInt64(out ts)) return false;
            if (!data.TryGetProperty("sig", out var sigEl) || sigEl.ValueKind != JsonValueKind.String)
                return false;
            sig = sigEl.GetString() ?? string.Empty;
            return sig.Length > 0;
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

        // Emit the trigger with camelCase keys matching the backend's
        // WindowsTrigger shape (convertWindowsTriggerToCron). The wire serializer
        // preserves member names, so we can't hand it the PascalCase TriggerSpec.
        private static object? SerializeTrigger(TriggerSpec? spec)
        {
            if (spec == null) return null;
            return new
            {
                type = spec.Type,
                startBoundary = spec.StartBoundary,
                daysInterval = spec.DaysInterval,
                daysOfWeek = spec.DaysOfWeek,
                repetition = spec.Repetition == null ? null : (object)new
                {
                    interval = spec.Repetition.Interval,
                    duration = spec.Repetition.Duration
                }
            };
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
                            enabled = t.Enabled,
                            lastRunTime = t.LastRunTime,
                            nextRunTime = t.NextRunTime,
                            description = t.Description,
                            author = t.Author,
                            userId = t.UserId,
                            runLevel = t.RunLevel,
                            logonType = t.LogonType,
                            trigger = SerializeTrigger(t.Trigger),
                            actions = t.Actions?.Select(a => new
                            {
                                type = a.Type,
                                path = a.Path,
                                arguments = a.Arguments,
                                workingDirectory = a.WorkingDirectory
                            })
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
                    var data = response.GetValue<JsonElement>(0);
                    var taskPath = data.GetProperty("taskPath").GetString() ?? "";
                    var enabled = data.GetProperty("enabled").GetBoolean();

                    if (!TryReadSignature(data, out var ts, out var sig) ||
                        !_auth.VerifyCommand(AgentAuthenticator.SetStatusMessage(taskPath, enabled, ts), ts, sig))
                    {
                        Console.WriteLine($"REJECTED unsigned/invalid task:set_status for {taskPath}");
                        return;
                    }

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
                // Parse inside the try: this is an async-void handler, so an
                // exception on a malformed frame would otherwise tear down the process.
                try
                {
                    var data = response.GetValue<JsonElement>(0);
                    var taskPath = data.TryGetProperty("taskPath", out var tp) ? tp.GetString() ?? "" : "";

                    if (!TryReadSignature(data, out var ts, out var sig) ||
                        !_auth.VerifyCommand(AgentAuthenticator.RunMessage(taskPath, ts), ts, sig))
                    {
                        Console.WriteLine($"REJECTED unsigned/invalid task:run for {taskPath}");
                        return;
                    }

                    Console.WriteLine($"Server command: task:run -> {taskPath}");

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

                    if (!TryReadSignature(data, out var ts, out var sig) ||
                        !_auth.VerifyCommand(AgentAuthenticator.CreateMessage(name, schedule, command, ts), ts, sig))
                    {
                        Console.WriteLine($"REJECTED unsigned/invalid task:create for {name}");
                        return;
                    }

                    TriggerSpec? trigger = null;
                    if (data.TryGetProperty("trigger", out var triggerElement) &&
                        triggerElement.ValueKind == JsonValueKind.Object)
                    {
                        trigger = JsonSerializer.Deserialize<TriggerSpec>(
                            triggerElement.GetRawText(),
                            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    }

                    Console.WriteLine($"Server command: task:create -> {name} (schedule={schedule}, trigger={(trigger?.Type ?? "none")})");

                    var result = _scheduler.CreateTask(name, schedule, command, trigger);

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
