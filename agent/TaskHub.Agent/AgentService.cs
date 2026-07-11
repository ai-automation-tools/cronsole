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

        // Map a delete failure to a message the dashboard can show as-is. The
        // common real-world case is E_ACCESSDENIED: tasks registered by an
        // elevated process grant the interactive user read-only ACLs, so the
        // unelevated agent can't remove them — say that instead of the raw HRESULT.
        private static string FriendlyDeleteError(Exception ex)
        {
            const int E_ACCESSDENIED = unchecked((int)0x80070005);
            if (ex is UnauthorizedAccessException || ex.HResult == E_ACCESSDENIED)
            {
                return "Windows denied the delete — this task requires administrator rights to remove. " +
                       "Delete it from an elevated Task Scheduler, or run the TaskHub agent elevated.";
            }
            return ex.Message;
        }

        // Map a status-change failure to a message the dashboard can show as-is.
        // The common case is E_ACCESSDENIED.
        private static string FriendlyStatusError(Exception ex)
        {
            const int E_ACCESSDENIED = unchecked((int)0x80070005);
            if (ex is UnauthorizedAccessException || ex.HResult == E_ACCESSDENIED)
            {
                return "Windows denied the update — this task requires administrator rights to modify. " +
                       "Modify it from an elevated Task Scheduler, or run the TaskHub agent elevated.";
            }
            return ex.Message;
        }

        // Read the structured { executable, args[], workingDirectory? } action from
        // a task:create payload. Missing/ill-typed fields degrade to empty rather
        // than throwing (the signature check is what actually gates execution).
        private static AgentExecAction ReadAction(JsonElement data)
        {
            var action = new AgentExecAction();
            if (data.TryGetProperty("action", out var el) && el.ValueKind == JsonValueKind.Object)
            {
                if (el.TryGetProperty("executable", out var exe) && exe.ValueKind == JsonValueKind.String)
                    action.Executable = exe.GetString() ?? string.Empty;
                if (el.TryGetProperty("args", out var args) && args.ValueKind == JsonValueKind.Array)
                {
                    foreach (var a in args.EnumerateArray())
                        action.Args.Add(a.ValueKind == JsonValueKind.String ? a.GetString() ?? string.Empty : string.Empty);
                }
                if (el.TryGetProperty("workingDirectory", out var wd) && wd.ValueKind == JsonValueKind.String)
                    action.WorkingDirectory = wd.GetString();
            }
            return action;
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
            _socket.On("task:set_status", async response =>
            {
                var taskPath = "";
                var enabled = false;
                try
                {
                    var data = response.GetValue<JsonElement>(0);
                    taskPath = data.GetProperty("taskPath").GetString() ?? "";
                    enabled = data.GetProperty("enabled").GetBoolean();

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
                        await _socket.EmitAsync("task:status_set", new[] { new {
                            taskExternalId = taskPath,
                            success = true,
                            message = $"Task is now {(enabled ? "enabled" : "disabled")}."
                        }});
                    }
                    else
                    {
                        Console.WriteLine($"Task {taskPath} not found for status update.");
                        await _socket.EmitAsync("task:status_set", new[] { new {
                            taskExternalId = taskPath,
                            success = false,
                            message = "Task not found"
                        }});
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error setting status: {ex.Message}");
                    try
                    {
                        await _socket.EmitAsync("task:status_set", new[] { new {
                            taskExternalId = taskPath,
                            success = false,
                            message = FriendlyStatusError(ex)
                        }});
                    }
                    catch { /* socket gone */ }
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

            // Event: task:delete (Server commanded us to remove a task)
            _socket.On("task:delete", async response =>
            {
                // Parse inside the try — same async-void malformed-frame guard as task:run.
                var taskPath = "";
                try
                {
                    var data = response.GetValue<JsonElement>(0);
                    taskPath = data.TryGetProperty("taskPath", out var tp) ? tp.GetString() ?? "" : "";

                    if (!TryReadSignature(data, out var ts, out var sig) ||
                        !_auth.VerifyCommand(AgentAuthenticator.DeleteMessage(taskPath, ts), ts, sig))
                    {
                        Console.WriteLine($"REJECTED unsigned/invalid task:delete for {taskPath}");
                        return;
                    }

                    Console.WriteLine($"Server command: task:delete -> {taskPath}");

                    // Idempotent: a task already gone is a success — the end
                    // state the server asked for holds either way.
                    bool found = _scheduler.DeleteTask(taskPath);
                    Console.WriteLine(found
                        ? $"Task {taskPath} deleted."
                        : $"Task {taskPath} not found (already removed).");

                    await _socket.EmitAsync("task:deleted", new[] { new {
                        taskExternalId = taskPath,
                        success = true,
                        message = found ? "Task deleted" : "Task not found (already removed)"
                    }});
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error deleting task: {ex.Message}");
                    try
                    {
                        await _socket.EmitAsync("task:deleted", new[] { new {
                            taskExternalId = taskPath,
                            success = false,
                            message = FriendlyDeleteError(ex)
                        }});
                    }
                    catch { /* socket gone — server's 15s timeout covers it */ }
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

                    // The structured action (executable + args) and the trigger are
                    // both covered by the signature, so parse the trigger BEFORE
                    // verifying — its canonical form is part of the signed message.
                    AgentExecAction action = ReadAction(data);
                    string actionCanonical = AgentAuthenticator.CanonicalizeAction(action.Executable, action.Args);

                    TriggerSpec? trigger = null;
                    if (data.TryGetProperty("trigger", out var triggerElement) &&
                        triggerElement.ValueKind == JsonValueKind.Object)
                    {
                        trigger = JsonSerializer.Deserialize<TriggerSpec>(
                            triggerElement.GetRawText(),
                            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    }
                    string triggerCanonical = AgentAuthenticator.CanonicalizeTrigger(trigger);

                    if (!TryReadSignature(data, out var ts, out var sig) ||
                        !_auth.VerifyCommand(AgentAuthenticator.CreateMessage(name, schedule, command, actionCanonical, triggerCanonical, ts), ts, sig))
                    {
                        Console.WriteLine($"REJECTED unsigned/invalid task:create for {name}");
                        return;
                    }

                    Console.WriteLine($"Server command: task:create -> {name} (exe={action.Executable}, args={action.Args.Count}, trigger={(trigger?.Type ?? "none")})");

                    var result = _scheduler.CreateTask(name, schedule, action, trigger);

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

            // Event: task:update_schedule (Server commanded us to change a task's trigger)
            _socket.On("task:update_schedule", async response =>
            {
                // Parse inside the try — async-void malformed-frame guard as elsewhere.
                var taskPath = "";
                try
                {
                    var data = response.GetValue<JsonElement>(0);
                    taskPath = data.TryGetProperty("taskPath", out var tp) ? tp.GetString() ?? "" : "";

                    // The trigger IS the change and is covered by the signature, so
                    // parse + canonicalize it BEFORE verifying (like task:create).
                    TriggerSpec? trigger = null;
                    if (data.TryGetProperty("trigger", out var triggerElement) &&
                        triggerElement.ValueKind == JsonValueKind.Object)
                    {
                        trigger = JsonSerializer.Deserialize<TriggerSpec>(
                            triggerElement.GetRawText(),
                            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                    }
                    string triggerCanonical = AgentAuthenticator.CanonicalizeTrigger(trigger);

                    if (!TryReadSignature(data, out var ts, out var sig) ||
                        !_auth.VerifyCommand(AgentAuthenticator.UpdateScheduleMessage(taskPath, triggerCanonical, ts), ts, sig))
                    {
                        Console.WriteLine($"REJECTED unsigned/invalid task:update_schedule for {taskPath}");
                        return;
                    }

                    // A signed command with no usable trigger is malformed — refuse
                    // rather than clearing the task's triggers and leaving it unscheduled.
                    if (trigger == null)
                    {
                        await _socket.EmitAsync("task:schedule_updated", new[] { new {
                            taskExternalId = taskPath,
                            success = false,
                            message = "No trigger supplied"
                        }});
                        return;
                    }

                    Console.WriteLine($"Server command: task:update_schedule -> {taskPath} (trigger={trigger.Type})");

                    bool success = _scheduler.UpdateTaskSchedule(taskPath, trigger);
                    await _socket.EmitAsync("task:schedule_updated", new[] { new {
                        taskExternalId = taskPath,
                        success,
                        message = success ? "Schedule updated" : "Task not found"
                    }});
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error updating schedule: {ex.Message}");
                    try
                    {
                        await _socket.EmitAsync("task:schedule_updated", new[] { new {
                            taskExternalId = taskPath,
                            success = false,
                            message = FriendlyStatusError(ex)
                        }});
                    }
                    catch { /* socket gone — server's 15s timeout covers it */ }
                }
            });
        }
    }
}
