using System;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Tasks;

namespace Cronsole.Agent
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

        // Windows' own error for running a task that is switched off. The COM
        // layer's text ("The task is disabled.") is already honest, so this is
        // only used to add the fix — which the raw error doesn't state.
        private const int SCHED_E_TASK_DISABLED = unchecked((int)0x80041326);

        /// <summary>
        /// Report that an ACCEPTED task:run could not be carried out.
        ///
        /// This exists because silence was a lie. task:run used to emit only on
        /// success: any failure (task missing, disabled, ACL) just wrote to the
        /// console, the server waited out its 15s window, and the user was told
        /// "Agent trigger timeout" — which names the TRANSPORT as the problem
        /// while the agent is sitting there healthy. That sends you to debug
        /// connectivity for a task you could have fixed with one click.
        ///
        /// The rule the other verbs already follow: a command we accepted always
        /// answers, and a failure answer carries the reason. Only an unverifiable
        /// command is met with silence.
        /// </summary>
        private async Task EmitRunFailedAsync(string taskPath, string message)
        {
            try
            {
                await _socket.EmitAsync("task:executed", new[] { new {
                    taskExternalId = taskPath,
                    success = false,
                    output = message
                }});
            }
            catch
            {
                // Socket gone — the server's timeout is the honest outcome now,
                // and there is nothing left to report it through.
            }
        }

        /// <summary>
        /// Turn a Task Scheduler failure into something the caller can act on.
        /// Windows' own message leads (it is accurate); we only prepend the fix
        /// for the disabled case, which is both the most common reason a run
        /// fails and the one the raw error doesn't tell you how to resolve.
        /// Anything unrecognized still surfaces its real message rather than a
        /// guess — an unhelpful truth beats a confident invention.
        /// </summary>
        private static string DescribeRunFailure(Exception ex)
        {
            if (ex is COMException com && com.HResult == SCHED_E_TASK_DISABLED)
            {
                return "The task is disabled, so Windows refused to run it. Enable the task first, then run it again.";
            }
            return $"Windows could not start the task: {ex.Message}";
        }

        // Pull the shared { nonce, ts, sig } off a signed command payload. Returns
        // false if any is absent/ill-typed so the caller can reject the command.
        //
        // `nonce` is REQUIRED, not optional-for-compat: it is part of every signed
        // message, so a payload without one cannot produce a verifiable signature
        // anyway. Failing here just makes the rejection honest and early. A
        // backend too old to send one is a version skew the project doesn't
        // support (backend and agent ship together) — it fails closed and loudly
        // rather than silently accepting a weaker message form.
        private static bool TryReadSignature(JsonElement data, out string nonce, out long ts, out string sig)
        {
            nonce = string.Empty;
            ts = 0;
            sig = string.Empty;
            if (data.ValueKind != JsonValueKind.Object) return false;
            if (!data.TryGetProperty("nonce", out var nonceEl) || nonceEl.ValueKind != JsonValueKind.String)
                return false;
            nonce = nonceEl.GetString() ?? string.Empty;
            if (nonce.Length == 0) return false;
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
                       "Delete it from an elevated Task Scheduler, or run the Cronsole agent elevated.";
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
                       "Modify it from an elevated Task Scheduler, or run the Cronsole agent elevated.";
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
                Console.WriteLine("Connected to Cronsole server!");

                // Announce ourselves
                await _socket.EmitAsync("agent:hello", new[] { new {
                    machineName = Environment.MachineName,
                    agentVersion = "1.0.0",
                    osVersion = Environment.OSVersion.ToString()
                }});
            };

            _socket.OnDisconnected += () =>
            {
                Console.WriteLine("Disconnected from Cronsole server.");
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
                            // camelCase, like every other field here: the socket
                            // serializer preserves member names, so a PascalCase
                            // property arrives as undefined on the backend and
                            // produces a well-formed payload of blanks (#9).
                            lastTaskResult = t.LastTaskResult,
                            numberOfMissedRuns = t.NumberOfMissedRuns,
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

            // Event: task:folders (Server requested the real Task Scheduler folder
            // list so the UI can offer actual folders instead of assuming \Cronsole.
            // Read-only, so no per-command signature, mirroring task:list.)
            _socket.On("task:folders", async _ =>
            {
                try
                {
                    // Project to an anonymous type with explicit lowercase names, the
                    // same way task:full_list does. The socket serializer does NOT
                    // camelCase automatically, so emitting AgentFolderInfo directly
                    // puts Path/TaskCount/Writable on the wire and the backend — which
                    // reads f.path — silently sees undefined for every field.
                    var folders = _scheduler.ListFolders()
                        .Select(f => new
                        {
                            path = f.Path,
                            taskCount = f.TaskCount,
                            writable = f.Writable
                        })
                        .ToList();
                    Console.WriteLine($"Server requested task:folders -> {folders.Count} folders");

                    await _socket.EmitAsync("task:folders_list", new[] { new {
                        success = true,
                        folders = folders,
                        message = "OK"
                    }});
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error listing folders: {ex.Message}");
                    try
                    {
                        await _socket.EmitAsync("task:folders_list", new[] { new {
                            success = false,
                            folders = Array.Empty<object>(),
                            message = ex.Message
                        }});
                    }
                    catch { /* socket gone — server's timeout covers it */ }
                }
            });

            // Event: task:history (Server requested WHY a task's runs went the way
            // they did. Read-only, so no per-command signature, mirroring task:list
            // and task:folders.)
            //
            // This is the only path by which a Windows task can say anything beyond
            // its exit code. Everything else on the dashboard publishes a real
            // outcome; Windows publishes an integer, and the detail lives in an
            // event log the task object knows nothing about.
            _socket.On("task:history", async response =>
            {
                var taskPath = "";
                try
                {
                    var data = response.GetValue<JsonElement>(0);
                    taskPath = data.TryGetProperty("taskPath", out var tp) ? tp.GetString() ?? "" : "";

                    // Clamped here as well as server-side. This process reads an
                    // event log that can hold hundreds of thousands of records for a
                    // task running every minute, and it must not trust a caller to
                    // have bounded that - the same reason folder paths are validated
                    // on both sides.
                    var limit = 20;
                    if (data.TryGetProperty("limit", out var lim) && lim.TryGetInt32(out var parsed))
                    {
                        limit = Math.Clamp(parsed, 1, 100);
                    }

                    var history = TaskHistoryReader.Read(taskPath, limit);
                    Console.WriteLine($"Server requested task:history -> {taskPath} ({history.Events.Count} events, enabled={history.HistoryEnabled})");

                    // Explicit lowercase names: the socket serializer does NOT
                    // camelCase, so emitting the objects directly would put
                    // EventId/TimeCreated on the wire and the backend would read
                    // undefined for every field.
                    await _socket.EmitAsync("task:history_list", new[] { new {
                        taskExternalId = taskPath,
                        success = history.Unavailable == null,
                        historyEnabled = history.HistoryEnabled,
                        events = history.Events.Select(e => new {
                            eventId = e.EventId,
                            level = e.Level,
                            timeCreated = e.TimeCreated,
                            message = e.Message
                        }).ToList(),
                        message = history.Unavailable ?? "OK"
                    }});
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error reading task history: {ex.Message}");
                    try
                    {
                        await _socket.EmitAsync("task:history_list", new[] { new {
                            taskExternalId = taskPath,
                            success = false,
                            historyEnabled = (bool?)null,
                            events = Array.Empty<object>(),
                            message = ex.Message
                        }});
                    }
                    catch { /* socket gone — server's timeout covers it */ }
                }
            });

            // Event: task:export (Server requested a task's native XML — read-only,
            // so no per-command signature, mirroring task:list).
            _socket.On("task:export", async response =>
            {
                var taskPath = "";
                try
                {
                    var data = response.GetValue<JsonElement>(0);
                    taskPath = data.TryGetProperty("taskPath", out var tp) ? tp.GetString() ?? "" : "";
                    Console.WriteLine($"Server requested task:export -> {taskPath}");

                    var xml = _scheduler.ExportTaskXml(taskPath);
                    await _socket.EmitAsync("task:exported", new[] { new {
                        taskExternalId = taskPath,
                        success = xml != null,
                        xml = xml,
                        message = xml != null ? "Exported" : "Task not found"
                    }});
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error exporting task: {ex.Message}");
                    try
                    {
                        await _socket.EmitAsync("task:exported", new[] { new {
                            taskExternalId = taskPath,
                            success = false,
                            xml = (string?)null,
                            message = ex.Message
                        }});
                    }
                    catch { /* socket gone — server's timeout covers it */ }
                }
            });

            // Event: task:import (Server commanded us to register a task from its
            // native XML — the restore half of task:export). Unlike task:export this
            // one WRITES, so it is signed like every other write verb, and the XML
            // itself is inside the signature (by hash) because the XML *is* the task.
            _socket.On("task:import", async response =>
            {
                var taskPath = "";
                try
                {
                    var data = response.GetValue<JsonElement>(0);
                    taskPath = data.TryGetProperty("taskPath", out var tp) ? tp.GetString() ?? "" : "";
                    string xml = data.TryGetProperty("xml", out var x) && x.ValueKind == JsonValueKind.String
                        ? x.GetString() ?? "" : "";
                    bool overwrite = data.TryGetProperty("overwrite", out var ow) && ow.ValueKind == JsonValueKind.True;
                    bool createFolders = data.TryGetProperty("createFolders", out var cf) && cf.ValueKind == JsonValueKind.True;

                    // Hash the XML we actually received and verify THAT — so a
                    // rewritten definition fails verification even though the path
                    // and flags still look right.
                    string xmlHash = AgentAuthenticator.Sha256Hex(xml);

                    if (!TryReadSignature(data, out var nonce, out var ts, out var sig) ||
                        !_auth.VerifyCommand(AgentAuthenticator.ImportMessage(taskPath, xmlHash, overwrite, createFolders, nonce, ts), ts, sig))
                    {
                        Console.WriteLine($"REJECTED unsigned/invalid task:import for {taskPath}");
                        return;
                    }

                    Console.WriteLine($"Server command: task:import -> {taskPath} (bytes={xml.Length}, overwrite={overwrite}, createFolders={createFolders})");

                    var result = _scheduler.ImportTaskXml(taskPath, xml, overwrite, createFolders);
                    Console.WriteLine($"Import {taskPath}: {result.Outcome} — {result.Message}");

                    await _socket.EmitAsync("task:imported", new[] { new {
                        taskExternalId = taskPath,
                        success = result.Success,
                        outcome = result.Outcome,
                        message = result.Message,
                        foldersCreated = result.FoldersCreated
                    }});
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error importing task: {ex.Message}");
                    try
                    {
                        await _socket.EmitAsync("task:imported", new[] { new {
                            taskExternalId = taskPath,
                            success = false,
                            outcome = "refused",
                            message = FriendlyStatusError(ex),
                            foldersCreated = new List<string>()
                        }});
                    }
                    catch { /* socket gone — server's 15s timeout covers it */ }
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

                    if (!TryReadSignature(data, out var nonce, out var ts, out var sig) ||
                        !_auth.VerifyCommand(AgentAuthenticator.SetStatusMessage(taskPath, enabled, nonce, ts), ts, sig))
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
                var taskPath = "";
                try
                {
                    var data = response.GetValue<JsonElement>(0);
                    taskPath = data.TryGetProperty("taskPath", out var tp) ? tp.GetString() ?? "" : "";

                    if (!TryReadSignature(data, out var nonce, out var ts, out var sig) ||
                        !_auth.VerifyCommand(AgentAuthenticator.RunMessage(taskPath, nonce, ts), ts, sig))
                    {
                        // Deliberately silent: an unverifiable command gets no
                        // reply at all, so a forger learns nothing (the server
                        // times out). Every path BELOW this point is a command we
                        // accepted, and an accepted command must always answer.
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
                        // RunTask returns false only when nothing exists at the path.
                        Console.WriteLine($"Task {taskPath} not found for running.");
                        await EmitRunFailedAsync(
                            taskPath,
                            "No task exists at this path on the machine. It may have been deleted or renamed " +
                            "outside Cronsole — run a sync to reconcile.");
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error running task: {ex.Message}");
                    await EmitRunFailedAsync(taskPath, DescribeRunFailure(ex));
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

                    if (!TryReadSignature(data, out var nonce, out var ts, out var sig) ||
                        !_auth.VerifyCommand(AgentAuthenticator.DeleteMessage(taskPath, nonce, ts), ts, sig))
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
                // Hoisted out of the try so the failure path can echo the REAL name.
                // The server matches task:created on payload.name; emitting "unknown"
                // means no failure ever matches, so every create error surfaced as a
                // 15s "Agent creation timeout" instead of the actual reason.
                var name = "unknown";
                try
                {
                    var data = response.GetValue<JsonElement>(0);
                    name = data.GetProperty("name").GetString() ?? "Unnamed Task";
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

                    // The destination folder is part of the signed message: it decides
                    // WHERE the task lands, and RegisterTaskDefinition silently
                    // overwrites a same-named task in the same folder. An older server
                    // that doesn't send it signs the old message shape, so verification
                    // fails and the create is refused — an honest failure rather than a
                    // task quietly landing somewhere it shouldn't.
                    string folder = data.TryGetProperty("folder", out var folderElement) &&
                                    folderElement.ValueKind == JsonValueKind.String
                        ? folderElement.GetString() ?? TaskFolderPath.Default
                        : TaskFolderPath.Default;

                    // Parsed BEFORE verifying, like folder and trigger, because it is
                    // part of the signed message. Absent or non-true degrades to
                    // false: the safe direction is refusing to create a folder, and
                    // an omitted flag signs as 0 on both sides so it stays honest.
                    bool createFolder = data.TryGetProperty("createFolder", out var cfElement) &&
                                        cfElement.ValueKind == JsonValueKind.True;

                    if (!TryReadSignature(data, out var nonce, out var ts, out var sig) ||
                        !_auth.VerifyCommand(AgentAuthenticator.CreateMessage(name, schedule, command, actionCanonical, triggerCanonical, folder, createFolder, nonce, ts), ts, sig))
                    {
                        Console.WriteLine($"REJECTED unsigned/invalid task:create for {name}");
                        return;
                    }

                    Console.WriteLine($"Server command: task:create -> {name} (exe={action.Executable}, args={action.Args.Count}, trigger={(trigger?.Type ?? "none")}, folder={folder}, createFolder={createFolder})");

                    var result = _scheduler.CreateTask(name, schedule, action, trigger, folder, createFolder);

                    if (result.Success)
                    {
                        Console.WriteLine($"Task {name} created successfully at {result.Path}." +
                            (result.FoldersCreated.Count > 0 ? $" Created folder(s): {string.Join(", ", result.FoldersCreated)}." : ""));

                        await _socket.EmitAsync("task:created", new[] { new {
                            success = true,
                            path = result.Path,
                            name = name,
                            message = "Task created successfully",
                            // Always present, even when empty: the server reports it
                            // verbatim, and "no folders were created" is an answer the
                            // caller needs as much as the list itself.
                            foldersCreated = result.FoldersCreated
                        }});
                    }
                    else
                    {
                        // Emitted here rather than thrown into the catch below: a
                        // refusal can still have created a folder (chain made, then
                        // RegisterTaskDefinition threw), and rethrowing as a bare
                        // Exception would drop that list on the floor — leaving a
                        // folder on the machine that nothing ever told the user about.
                        Console.WriteLine($"Task {name} refused: {result.Message}");

                        await _socket.EmitAsync("task:created", new[] { new {
                            success = false,
                            name = name,
                            message = result.Message,
                            foldersCreated = result.FoldersCreated
                        }});
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error creating task: {ex.Message}");
                    // Echo the requested name: the server's handler matches on it, so
                    // "unknown" here means the failure is dropped and the caller waits
                    // out the 15s timeout — turning an honest, actionable message
                    // ("that folder does not exist") into a misleading "Agent creation
                    // timeout" that points at the agent instead of the request.
                    await _socket.EmitAsync("task:created", new[] { new {
                        success = false,
                        name = name,
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

                    if (!TryReadSignature(data, out var nonce, out var ts, out var sig) ||
                        !_auth.VerifyCommand(AgentAuthenticator.UpdateScheduleMessage(taskPath, triggerCanonical, nonce, ts), ts, sig))
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

            // Event: task:update (Server commanded us to change a task's action + settings)
            _socket.On("task:update", async response =>
            {
                // Parse inside the try — async-void malformed-frame guard as elsewhere.
                var taskPath = "";
                try
                {
                    var data = response.GetValue<JsonElement>(0);
                    taskPath = data.TryGetProperty("taskPath", out var tp) ? tp.GetString() ?? "" : "";

                    // The action + settings ARE the change and are covered by the
                    // signature, so parse + canonicalize them BEFORE verifying
                    // (like task:create). The working dir rides as a top-level field
                    // (StructuredAction carries only executable + args).
                    AgentExecAction action = ReadAction(data);
                    string actionCanonical = AgentAuthenticator.CanonicalizeAction(action.Executable, action.Args);
                    string workingDir = data.TryGetProperty("workingDirectory", out var wd) && wd.ValueKind == JsonValueKind.String
                        ? wd.GetString() ?? "" : "";
                    string description = data.TryGetProperty("description", out var ds) && ds.ValueKind == JsonValueKind.String
                        ? ds.GetString() ?? "" : "";
                    string runLevel = data.TryGetProperty("runLevel", out var rl) && rl.ValueKind == JsonValueKind.String
                        ? rl.GetString() ?? "least" : "least";
                    action.WorkingDirectory = workingDir;

                    if (!TryReadSignature(data, out var nonce, out var ts, out var sig) ||
                        !_auth.VerifyCommand(AgentAuthenticator.UpdateMessage(taskPath, actionCanonical, workingDir, description, runLevel, nonce, ts), ts, sig))
                    {
                        Console.WriteLine($"REJECTED unsigned/invalid task:update for {taskPath}");
                        return;
                    }

                    // A signed command with no executable is malformed — refuse
                    // rather than registering an actionless task.
                    if (string.IsNullOrWhiteSpace(action.Executable))
                    {
                        await _socket.EmitAsync("task:updated", new[] { new {
                            taskExternalId = taskPath,
                            success = false,
                            message = "No executable supplied"
                        }});
                        return;
                    }

                    Console.WriteLine($"Server command: task:update -> {taskPath} (exe={action.Executable}, args={action.Args.Count}, runLevel={runLevel})");

                    bool success = _scheduler.UpdateTaskActions(taskPath, action, description, runLevel);
                    await _socket.EmitAsync("task:updated", new[] { new {
                        taskExternalId = taskPath,
                        success,
                        message = success ? "Task updated" : "Task not found"
                    }});
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Error updating task: {ex.Message}");
                    try
                    {
                        await _socket.EmitAsync("task:updated", new[] { new {
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
