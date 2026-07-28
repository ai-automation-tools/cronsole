using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;
using Moq;
using FluentAssertions;
using TaskHub.Agent;

namespace TaskHub.Agent.Tests
{
    public class AgentServiceTests
    {
        private readonly Mock<ISocketClient> _mockSocket;
        private readonly Mock<ITaskScheduler> _mockScheduler;
        private readonly AgentAuthenticator _auth;
        private readonly AgentService _agentService;

        // Captured events from SetupSocketEvents
        private Action? _onConnectedHandler;
        private Action? _onDisconnectedHandler;
        private readonly Dictionary<string, Action<ISocketResponse>> _socketHandlers = new();

        public AgentServiceTests()
        {
            _mockSocket = new Mock<ISocketClient>();
            _mockScheduler = new Mock<ITaskScheduler>();

            // A real authenticator with an established session key — commands are
            // signed with it below so verification passes like a live connection.
            _auth = new AgentAuthenticator("test-pairing-secret-value", "test-agent");
            _auth.CreateHandshakeAuth();

            // Capture the handlers registered by the service
            _mockSocket.SetupAdd(s => s.OnConnected += It.IsAny<Action>())
                .Callback<Action>(handler => _onConnectedHandler = handler);

            _mockSocket.SetupAdd(s => s.OnDisconnected += It.IsAny<Action>())
                .Callback<Action>(handler => _onDisconnectedHandler = handler);

            _mockSocket.Setup(s => s.On(It.IsAny<string>(), It.IsAny<Action<ISocketResponse>>()))
                .Callback<string, Action<ISocketResponse>>((eventName, callback) =>
                {
                    _socketHandlers[eventName] = callback;
                });

            _agentService = new AgentService(_mockSocket.Object, _mockScheduler.Object, _auth);
        }

        private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        // A fresh per-command nonce, as the backend's emitSignedCommand generates.
        // Every signed command carries one: it is inside the signed message and
        // is what keeps two identical commands in the same second distinguishable
        // from a replay (troubleshooting #16). Unique per call so a test can never
        // pass by accidentally colliding.
        private static string TestNonce() => Guid.NewGuid().ToString("N");

        // Build a JsonElement command payload from an anonymous object, exactly as
        // it arrives over the wire from the backend.
        private static JsonElement Payload(object obj) =>
            JsonDocument.Parse(JsonSerializer.Serialize(obj)).RootElement;

        [Fact]
        public void Constructor_RegistersEventsAndHandlers()
        {
            // Assert
            _onConnectedHandler.Should().NotBeNull();
            _onDisconnectedHandler.Should().NotBeNull();
            _socketHandlers.Should().ContainKey("task:list");
            _socketHandlers.Should().ContainKey("task:export");
            _socketHandlers.Should().ContainKey("task:set_status");
            _socketHandlers.Should().ContainKey("task:run");
            _socketHandlers.Should().ContainKey("task:create");
            _socketHandlers.Should().ContainKey("task:delete");
            _socketHandlers.Should().ContainKey("task:update_schedule");
            _socketHandlers.Should().ContainKey("task:update");
            _socketHandlers.Should().ContainKey("task:import");
        }

        // --- task:import (restore) --------------------------------------------
        //
        // The XML is inside the signature by hash, so these cases are really about
        // one property: the agent registers exactly the definition that was signed,
        // and nothing else.

        private const string RestoreXml =
            "<Task><RegistrationInfo><URI>\\Work\\Job</URI></RegistrationInfo></Task>";

        private (Mock<ISocketResponse> Response, string Xml) SignedImport(
            string taskPath, bool overwrite = false, bool createFolders = false, string? xmlOnTheWire = null)
        {
            var signedXml = RestoreXml;
            var ts = Now();
            var nonce = TestNonce();
            var sig = AgentAuthenticator.Hmac(
                _auth.SessionKey!,
                AgentAuthenticator.ImportMessage(taskPath, AgentAuthenticator.Sha256Hex(signedXml), overwrite, createFolders, nonce, ts));

            // xmlOnTheWire lets a test send something OTHER than what was signed.
            var xml = xmlOnTheWire ?? signedXml;
            var response = new Mock<ISocketResponse>();
            response.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { taskPath, xml, overwrite, createFolders, nonce, ts, sig }));
            return (response, xml);
        }

        [Fact]
        public void TaskImport_Event_RegistersTheTaskAndAcks()
        {
            var taskPath = "\\Work\\Job";
            _mockScheduler.Setup(s => s.ImportTaskXml(taskPath, RestoreXml, false, true))
                .Returns(new AgentImportResult { Success = true, Outcome = "created", Path = taskPath, Message = "Task restored" });

            var (response, _) = SignedImport(taskPath, overwrite: false, createFolders: true);
            _socketHandlers["task:import"].Invoke(response.Object);

            _mockScheduler.Verify(s => s.ImportTaskXml(taskPath, RestoreXml, false, true), Times.Once);
            _mockSocket.Verify(s => s.EmitAsync("task:imported", It.IsAny<object>()), Times.Once);
        }

        [Fact]
        public void TaskImport_Event_PassesBothFlagsThroughExactly()
        {
            // Each flag decides what the command may destroy or create, so a handler
            // that dropped one would quietly widen or narrow the operation the user
            // authorized.
            var taskPath = "\\Work\\Job";
            _mockScheduler.Setup(s => s.ImportTaskXml(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<bool>()))
                .Returns(new AgentImportResult { Success = true, Outcome = "replaced" });

            var (response, _) = SignedImport(taskPath, overwrite: true, createFolders: false);
            _socketHandlers["task:import"].Invoke(response.Object);

            _mockScheduler.Verify(s => s.ImportTaskXml(taskPath, RestoreXml, true, false), Times.Once);
        }

        [Fact]
        public void TaskImport_Event_RejectsUnsignedCommandSilently()
        {
            // Deliberately silent, like every other write verb: a forger learns
            // nothing and the server's timeout is the honest outcome.
            var response = new Mock<ISocketResponse>();
            response.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { taskPath = "\\Work\\Job", xml = RestoreXml, overwrite = true, createFolders = true }));

            _socketHandlers["task:import"].Invoke(response.Object);

            _mockScheduler.Verify(s => s.ImportTaskXml(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<bool>()), Times.Never);
            _mockSocket.Verify(s => s.EmitAsync("task:imported", It.IsAny<object>()), Times.Never);
        }

        [Fact]
        public void TaskImport_Event_RejectsASwappedDefinition()
        {
            // The whole reason the XML is hashed into the signature: the path and
            // both flags are untouched here, and only the definition changed — an
            // action rewritten to run something else. It must not register.
            var taskPath = "\\Work\\Job";
            var tampered = "<Task><Actions><Exec><Command>evil.exe</Command></Exec></Actions></Task>";
            var (response, _) = SignedImport(taskPath, xmlOnTheWire: tampered);

            _socketHandlers["task:import"].Invoke(response.Object);

            _mockScheduler.Verify(s => s.ImportTaskXml(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<bool>()), Times.Never);
        }

        [Fact]
        public void TaskImport_Event_AcksAnAlreadyExistingTaskWithoutClaimingSuccess()
        {
            // The third state: nothing went wrong, and nothing was restored. Both
            // halves have to survive to the wire or the UI has to guess.
            var taskPath = "\\Work\\Job";
            _mockScheduler.Setup(s => s.ImportTaskXml(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<bool>()))
                .Returns(new AgentImportResult { Success = false, Outcome = "exists", Message = "A task already exists at this path." });

            var (response, _) = SignedImport(taskPath);
            _socketHandlers["task:import"].Invoke(response.Object);

            _mockSocket.Verify(s => s.EmitAsync("task:imported", It.IsAny<object>()), Times.Once);
        }

        [Fact]
        public void TaskImport_Event_SchedulerThrows_StillAcks()
        {
            // An accepted command always answers — silence would leave the caller
            // waiting out a 15s timeout and blaming the transport.
            _mockScheduler.Setup(s => s.ImportTaskXml(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<bool>()))
                .Throws(new UnauthorizedAccessException("denied"));

            var (response, _) = SignedImport("\\Work\\Job");
            _socketHandlers["task:import"].Invoke(response.Object);

            _mockSocket.Verify(s => s.EmitAsync("task:imported", It.IsAny<object>()), Times.Once);
        }

        [Fact]
        public async Task StartAsync_CallsConnectAsync()
        {
            // Act
            await _agentService.StartAsync();

            // Assert
            _mockSocket.Verify(s => s.ConnectAsync(), Times.Once);
        }

        [Fact]
        public void OnConnected_EmitsAgentHello()
        {
            // Act
            _onConnectedHandler!.Invoke();

            // Assert
            _mockSocket.Verify(s => s.EmitAsync("agent:hello", It.Is<object>(obj => obj != null)), Times.Once);
        }

        [Fact]
        public void TaskList_Event_SyncsTasksToSocket()
        {
            // Arrange
            var mockTasks = new List<AgentTaskInfo>
            {
                new AgentTaskInfo
                {
                    Path = "\\Mikes\\DailyCalibration",
                    Name = "DailyCalibration",
                    State = "ACTIVE",
                    LastRunTime = DateTime.Today.AddDays(-1),
                    NextRunTime = DateTime.Today.AddDays(1)
                }
            };
            _mockScheduler.Setup(s => s.ListTasks()).Returns(mockTasks);

            var mockResponse = new Mock<ISocketResponse>();

            // Act
            _socketHandlers["task:list"].Invoke(mockResponse.Object);

            // Assert
            _mockScheduler.Verify(s => s.ListTasks(), Times.Once);
            _mockSocket.Verify(s => s.EmitAsync("task:full_list", It.IsAny<object>()), Times.Once);
        }

        [Fact]
        public void TaskCreate_Event_Failure_EchoesTheRealNameSoTheServerCanMatchIt()
        {
            // Regression: the failure path emitted name = "unknown" (the real name was
            // scoped inside the try). The server matches task:created on payload.name,
            // so NO failure ever matched — every create error was dropped and surfaced
            // as a 15s "Agent creation timeout". That turned an honest, actionable
            // message ("that folder does not exist") into one pointing at the agent
            // instead of the request. Found by driving a real refusal end-to-end.
            var ts = Now();
            var nonce = TestNonce();
            var canonical = AgentAuthenticator.CanonicalizeAction("dir", new string[0]);
            var triggerCanonical = AgentAuthenticator.CanonicalizeTrigger(null);
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!,
                AgentAuthenticator.CreateMessage("MyTestTask", "0 * * * *", "dir", canonical, triggerCanonical, "\\TaskHub", nonce, ts));

            _mockScheduler
                .Setup(s => s.CreateTask("MyTestTask", "0 * * * *", It.IsAny<AgentExecAction>(), null, "\\TaskHub"))
                .Returns(new AgentTaskResult { Success = false, Name = "MyTestTask", Message = "Folder does not exist." });

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0)).Returns(Payload(new
            {
                name = "MyTestTask",
                schedule = "0 * * * *",
                command = "dir",
                action = new { executable = "dir", args = new string[0] },
                folder = "\\TaskHub",
                nonce,
                ts,
                sig
            }));

            _socketHandlers["task:create"].Invoke(mockResponse.Object);

            _mockSocket.Verify(s => s.EmitAsync("task:created", It.Is<object>(o =>
                // The real name, so the server's handler matches and the caller learns why...
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("MyTestTask") &&
                !JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("unknown") &&
                // ...and the actual reason survives, rather than a generic timeout.
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("Folder does not exist")
            )), Times.Once);
        }

        [Fact]
        public void TaskFolders_Event_EmitsCamelCaseKeysTheBackendCanRead()
        {
            // Regression: this shipped emitting List<AgentFolderInfo> directly, so the
            // wire carried PascalCase Path/TaskCount/Writable. The backend reads
            // f.path, so EVERY field came back undefined — 161 folders, all with an
            // empty path and writable:false. Nothing threw; it just quietly reported
            // that no folder on the machine was usable.
            //
            // The mocked-scheduler + mocked-socket tests could not catch it: neither
            // crosses the real JSON boundary. So assert the SERIALIZED shape, which is
            // what the backend actually parses.
            _mockScheduler.Setup(s => s.ListFolders()).Returns(new List<AgentFolderInfo>
            {
                new AgentFolderInfo { Path = "\\TaskHub", TaskCount = 2, Writable = true },
                new AgentFolderInfo { Path = "\\Microsoft\\Windows", TaskCount = 214, Writable = false }
            });

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0)).Returns(Payload(new { }));

            _socketHandlers["task:folders"].Invoke(mockResponse.Object);

            _mockSocket.Verify(s => s.EmitAsync("task:folders_list", It.Is<object>(o =>
                // The keys the backend reads must be present, lowercase...
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("\"path\"") &&
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("\"taskCount\"") &&
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("\"writable\"") &&
                // ...and the PascalCase form must NOT be what goes out.
                !JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("\"Path\"") &&
                !JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("\"TaskCount\"") &&
                !JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("\"Writable\"") &&
                // The values must survive too, not just the keys.
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("TaskHub") &&
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("214")
            )), Times.Once);
        }

        [Fact]
        public void TaskFolders_Event_IsReadOnly_NoSignatureRequired()
        {
            // Mirrors task:list / task:export: enumerating folders reveals nothing the
            // task list does not already, so it is unsigned — but it must still work.
            _mockScheduler.Setup(s => s.ListFolders()).Returns(new List<AgentFolderInfo>());

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0)).Returns(Payload(new { }));

            _socketHandlers["task:folders"].Invoke(mockResponse.Object);

            _mockScheduler.Verify(s => s.ListFolders(), Times.Once);
            _mockSocket.Verify(s => s.EmitAsync("task:folders_list", It.IsAny<object>()), Times.Once);
        }

        [Fact]
        public void TaskExport_Event_ReturnsNativeXml()
        {
            // Arrange — read-only, so no signature required (mirrors task:list).
            var taskPath = "\\TaskHub\\Nightly";
            _mockScheduler.Setup(s => s.ExportTaskXml(taskPath)).Returns("<Task><Settings/></Task>");

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0)).Returns(Payload(new { taskPath }));

            // Act
            _socketHandlers["task:export"].Invoke(mockResponse.Object);

            // Assert (default JSON serialization HTML-escapes '<', so match on the
            // success message + the escaped XML marker instead of a raw "<Task>").
            _mockScheduler.Verify(s => s.ExportTaskXml(taskPath), Times.Once);
            _mockSocket.Verify(s => s.EmitAsync("task:exported", It.Is<object>(o =>
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("Exported") &&
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("Task"))), Times.Once);
        }

        [Fact]
        public void TaskExport_Event_NotFound_EmitsFailure()
        {
            // Arrange
            var taskPath = "\\TaskHub\\Ghost";
            _mockScheduler.Setup(s => s.ExportTaskXml(taskPath)).Returns((string?)null);

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0)).Returns(Payload(new { taskPath }));

            // Act
            _socketHandlers["task:export"].Invoke(mockResponse.Object);

            // Assert
            _mockSocket.Verify(s => s.EmitAsync("task:exported", It.Is<object>(o =>
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("Task not found"))), Times.Once);
        }

        [Fact]
        public void TaskSetStatus_Event_UpdatesTaskStatusAndEmitsAck()
        {
            // Arrange
            var taskPath = "\\Mikes\\Backup";
            var enabled = false;
            var ts = Now();
            var nonce = TestNonce();
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.SetStatusMessage(taskPath, enabled, nonce, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { taskPath, enabled, nonce, ts, sig }));

            _mockScheduler.Setup(s => s.SetTaskStatus(taskPath, enabled)).Returns(true);

            // Act
            _socketHandlers["task:set_status"].Invoke(mockResponse.Object);

            // Assert
            _mockScheduler.Verify(s => s.SetTaskStatus(taskPath, enabled), Times.Once);
            _mockSocket.Verify(s => s.EmitAsync("task:status_set", It.IsAny<object>()), Times.Once);
        }

        [Fact]
        public void TaskSetStatus_Event_NotFound_EmitsFailureAck()
        {
            // Arrange
            var taskPath = "\\Mikes\\Backup";
            var enabled = false;
            var ts = Now();
            var nonce = TestNonce();
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.SetStatusMessage(taskPath, enabled, nonce, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { taskPath, enabled, nonce, ts, sig }));

            _mockScheduler.Setup(s => s.SetTaskStatus(taskPath, enabled)).Returns(false);

            // Act
            _socketHandlers["task:set_status"].Invoke(mockResponse.Object);

            // Assert
            _mockScheduler.Verify(s => s.SetTaskStatus(taskPath, enabled), Times.Once);
            _mockSocket.Verify(s => s.EmitAsync("task:status_set", It.Is<object>(o =>
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("Task not found"))), Times.Once);
        }

        [Fact]
        public void TaskSetStatus_Event_AccessDenied_EmitsFriendlyFailureAck()
        {
            // Arrange
            var taskPath = "\\Mikes\\Backup";
            var enabled = false;
            var ts = Now();
            var nonce = TestNonce();
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.SetStatusMessage(taskPath, enabled, nonce, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { taskPath, enabled, nonce, ts, sig }));

            _mockScheduler.Setup(s => s.SetTaskStatus(taskPath, enabled))
                .Throws(new UnauthorizedAccessException("Access is denied. (0x80070005 (E_ACCESSDENIED))"));

            // Act
            _socketHandlers["task:set_status"].Invoke(mockResponse.Object);

            // Assert
            _mockScheduler.Verify(s => s.SetTaskStatus(taskPath, enabled), Times.Once);
            _mockSocket.Verify(s => s.EmitAsync("task:status_set", It.Is<object>(o =>
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("administrator rights"))), Times.Once);
        }

        [Fact]
        public void TaskSetStatus_Event_RejectsInvalidSignature()
        {
            // Arrange
            var taskPath = "\\Mikes\\Backup";
            var enabled = false;
            var ts = Now();
            var nonce = TestNonce();

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { taskPath, enabled, nonce, ts, sig = "deadbeef" }));

            // Act
            _socketHandlers["task:set_status"].Invoke(mockResponse.Object);

            // Assert
            _mockScheduler.Verify(s => s.SetTaskStatus(It.IsAny<string>(), It.IsAny<bool>()), Times.Never);
            _mockSocket.Verify(s => s.EmitAsync("task:status_set", It.IsAny<object>()), Times.Never);
        }

        [Fact]
        public void TaskUpdateSchedule_Event_UpdatesTriggerAndEmitsAck()
        {
            // Arrange — payload as emitted by WindowsAgentConnector.updateSchedule.
            // The trigger is signed, so its canonical form is part of the message.
            var taskPath = "\\TaskHub\\Nightly";
            var ts = Now();
            var nonce = TestNonce();
            var trigger = new TriggerSpec { Type = "Daily", StartBoundary = "03:00", DaysInterval = 1 };
            var triggerCanonical = AgentAuthenticator.CanonicalizeTrigger(trigger);
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.UpdateScheduleMessage(taskPath, triggerCanonical, nonce, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new
                {
                    taskPath,
                    trigger = new { type = "Daily", startBoundary = "03:00", daysInterval = 1 },
                    nonce,
                    ts,
                    sig
                }));

            _mockScheduler.Setup(s => s.UpdateTaskSchedule(taskPath, It.IsAny<TriggerSpec>())).Returns(true);

            // Act
            _socketHandlers["task:update_schedule"].Invoke(mockResponse.Object);

            // Assert — the parsed trigger reaches the scheduler, and success is acked.
            _mockScheduler.Verify(s => s.UpdateTaskSchedule(taskPath,
                It.Is<TriggerSpec>(t => t.Type == "Daily" && t.StartBoundary == "03:00" && t.DaysInterval == 1)), Times.Once);
            _mockSocket.Verify(s => s.EmitAsync("task:schedule_updated", It.Is<object>(o =>
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("Schedule updated"))), Times.Once);
        }

        [Fact]
        public void TaskUpdateSchedule_Event_NotFound_EmitsFailureAck()
        {
            // Arrange
            var taskPath = "\\TaskHub\\Ghost";
            var ts = Now();
            var nonce = TestNonce();
            var trigger = new TriggerSpec { Type = "Daily", StartBoundary = "03:00", DaysInterval = 1 };
            var triggerCanonical = AgentAuthenticator.CanonicalizeTrigger(trigger);
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.UpdateScheduleMessage(taskPath, triggerCanonical, nonce, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new
                {
                    taskPath,
                    trigger = new { type = "Daily", startBoundary = "03:00", daysInterval = 1 },
                    nonce,
                    ts,
                    sig
                }));

            _mockScheduler.Setup(s => s.UpdateTaskSchedule(taskPath, It.IsAny<TriggerSpec>())).Returns(false);

            // Act
            _socketHandlers["task:update_schedule"].Invoke(mockResponse.Object);

            // Assert
            _mockSocket.Verify(s => s.EmitAsync("task:schedule_updated", It.Is<object>(o =>
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("Task not found"))), Times.Once);
        }

        [Fact]
        public void TaskUpdateSchedule_Event_RejectsInvalidSignature()
        {
            // Arrange — a forged schedule change must never touch the scheduler.
            var taskPath = "\\TaskHub\\Nightly";
            var ts = Now();
            var nonce = TestNonce();

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new
                {
                    taskPath,
                    trigger = new { type = "Daily", startBoundary = "03:00", daysInterval = 1 },
                    ts,
                    sig = "deadbeef"
                }));

            // Act
            _socketHandlers["task:update_schedule"].Invoke(mockResponse.Object);

            // Assert — scheduler untouched, no ack emitted.
            _mockScheduler.Verify(s => s.UpdateTaskSchedule(It.IsAny<string>(), It.IsAny<TriggerSpec>()), Times.Never);
            _mockSocket.Verify(s => s.EmitAsync("task:schedule_updated", It.IsAny<object>()), Times.Never);
        }

        [Fact]
        public void TaskUpdate_Event_UpdatesActionAndEmitsAck()
        {
            // Arrange — payload as emitted by WindowsAgentConnector.updateActions.
            // The action (executable + args), working dir, description, and run
            // level are all part of the signed message.
            var taskPath = "\\TaskHub\\Nightly";
            var ts = Now();
            var nonce = TestNonce();
            var actionCanonical = AgentAuthenticator.CanonicalizeAction("powershell.exe", new[] { "-File", "C:\\x.ps1" });
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!,
                AgentAuthenticator.UpdateMessage(taskPath, actionCanonical, "C:\\scripts", "Nightly job", "highest", nonce, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new
                {
                    taskPath,
                    action = new { executable = "powershell.exe", args = new[] { "-File", "C:\\x.ps1" } },
                    workingDirectory = "C:\\scripts",
                    description = "Nightly job",
                    runLevel = "highest",
                    nonce,
                    ts,
                    sig
                }));

            _mockScheduler.Setup(s => s.UpdateTaskActions(taskPath, It.IsAny<AgentExecAction>(), It.IsAny<string?>(), It.IsAny<string>())).Returns(true);

            // Act
            _socketHandlers["task:update"].Invoke(mockResponse.Object);

            // Assert — the parsed action (exe + args + working dir), description, and
            // run level reach the scheduler, and success is acked.
            _mockScheduler.Verify(s => s.UpdateTaskActions(taskPath,
                It.Is<AgentExecAction>(a => a.Executable == "powershell.exe" && a.Args.Count == 2 && a.WorkingDirectory == "C:\\scripts"),
                "Nightly job", "highest"), Times.Once);
            _mockSocket.Verify(s => s.EmitAsync("task:updated", It.Is<object>(o =>
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("Task updated"))), Times.Once);
        }

        [Fact]
        public void TaskUpdate_Event_NotFound_EmitsFailureAck()
        {
            // Arrange
            var taskPath = "\\TaskHub\\Ghost";
            var ts = Now();
            var nonce = TestNonce();
            var actionCanonical = AgentAuthenticator.CanonicalizeAction("cmd.exe", new string[0]);
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!,
                AgentAuthenticator.UpdateMessage(taskPath, actionCanonical, "", "", "least", nonce, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new
                {
                    taskPath,
                    action = new { executable = "cmd.exe", args = new string[0] },
                    workingDirectory = "",
                    description = "",
                    runLevel = "least",
                    nonce,
                    ts,
                    sig
                }));

            _mockScheduler.Setup(s => s.UpdateTaskActions(taskPath, It.IsAny<AgentExecAction>(), It.IsAny<string?>(), It.IsAny<string>())).Returns(false);

            // Act
            _socketHandlers["task:update"].Invoke(mockResponse.Object);

            // Assert
            _mockSocket.Verify(s => s.EmitAsync("task:updated", It.Is<object>(o =>
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("Task not found"))), Times.Once);
        }

        [Fact]
        public void TaskUpdate_Event_RejectsInvalidSignature()
        {
            // Arrange — a forged action change must never touch the scheduler.
            var taskPath = "\\TaskHub\\Nightly";
            var ts = Now();
            var nonce = TestNonce();

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new
                {
                    taskPath,
                    action = new { executable = "calc.exe", args = new string[0] },
                    workingDirectory = "",
                    description = "",
                    runLevel = "highest",
                    ts,
                    sig = "deadbeef"
                }));

            // Act
            _socketHandlers["task:update"].Invoke(mockResponse.Object);

            // Assert — scheduler untouched, no ack emitted.
            _mockScheduler.Verify(s => s.UpdateTaskActions(It.IsAny<string>(), It.IsAny<AgentExecAction>(), It.IsAny<string?>(), It.IsAny<string>()), Times.Never);
            _mockSocket.Verify(s => s.EmitAsync("task:updated", It.IsAny<object>()), Times.Never);
        }

        [Fact]
        public void TaskRun_Event_RunsTaskAndEmitsResult()
        {
            // Arrange
            var taskPath = "\\Mikes\\CleanTemp";
            var ts = Now();
            var nonce = TestNonce();
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.RunMessage(taskPath, nonce, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { taskPath, nonce, ts, sig }));

            _mockScheduler.Setup(s => s.RunTask(taskPath)).Returns(true);

            // Act
            _socketHandlers["task:run"].Invoke(mockResponse.Object);

            // Assert
            _mockScheduler.Verify(s => s.RunTask(taskPath), Times.Once);
            _mockSocket.Verify(s => s.EmitAsync("task:executed", It.IsAny<object>()), Times.Once);
        }

        [Fact]
        public void TaskRun_Event_RejectsInvalidSignature()
        {
            // Arrange — a forged/tampered command must never execute.
            var taskPath = "\\Mikes\\CleanTemp";
            var ts = Now();
            var nonce = TestNonce();

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { taskPath, nonce, ts, sig = "deadbeef" }));

            // Act
            _socketHandlers["task:run"].Invoke(mockResponse.Object);

            // Assert — scheduler untouched, no result emitted. The silence here is
            // deliberate and is the ONE case that stays silent: a forger learns
            // nothing. Every ACCEPTED command must answer (see the tests below).
            _mockScheduler.Verify(s => s.RunTask(It.IsAny<string>()), Times.Never);
            _mockSocket.Verify(s => s.EmitAsync("task:executed", It.IsAny<object>()), Times.Never);
        }

        // Regression: task:run emitted ONLY on success. Every failure — task
        // missing, disabled, ACL — wrote to the console and emitted nothing, so
        // the server waited out its 15s window and told the user "Agent trigger
        // timeout": a message that blames the transport while the agent is
        // healthy and the real cause (a disabled task) is one click away.
        // An accepted command must always answer, and the answer must carry why.

        [Fact]
        public void TaskRun_Event_Failure_EmitsFailureInsteadOfGoingSilent()
        {
            // Arrange — RunTask returns false: nothing exists at that path.
            var taskPath = "\\Mikes\\Gone";
            var ts = Now();
            var nonce = TestNonce();
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.RunMessage(taskPath, nonce, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { taskPath, nonce, ts, sig }));

            _mockScheduler.Setup(s => s.RunTask(taskPath)).Returns(false);

            // Act
            _socketHandlers["task:run"].Invoke(mockResponse.Object);

            // Assert — an answer, flagged as failure, naming the path so the
            // server's handler matches it rather than timing out.
            _mockSocket.Verify(s => s.EmitAsync("task:executed", It.Is<object>(o =>
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("\"success\":false") &&
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("\\\\Mikes\\\\Gone") &&
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("No task exists at this path")
            )), Times.Once);
        }

        [Fact]
        public void TaskRun_Event_WhenTheSchedulerThrows_EmitsTheRealReason()
        {
            // Arrange — task.Run() throws for a disabled task; that used to be
            // swallowed by the catch with no emit at all.
            var taskPath = "\\Mikes\\Disabled";
            var ts = Now();
            var nonce = TestNonce();
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.RunMessage(taskPath, nonce, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { taskPath, nonce, ts, sig }));

            _mockScheduler.Setup(s => s.RunTask(taskPath))
                .Throws(new InvalidOperationException("some COM failure"));

            // Act
            _socketHandlers["task:run"].Invoke(mockResponse.Object);

            // Assert — the real message survives rather than becoming a timeout.
            _mockSocket.Verify(s => s.EmitAsync("task:executed", It.Is<object>(o =>
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("\"success\":false") &&
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("some COM failure")
            )), Times.Once);
        }

        [Fact]
        public void TaskRun_Event_DisabledTask_SaysHowToFixIt()
        {
            // The most common reason a run fails, and the one Windows' own error
            // ("The task is disabled.") does not tell you how to resolve. The
            // HRESULT is what Windows actually returns: SCHED_E_TASK_DISABLED.
            var taskPath = "\\Mikes\\Disabled";
            var ts = Now();
            var nonce = TestNonce();
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.RunMessage(taskPath, nonce, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { taskPath, nonce, ts, sig }));

            _mockScheduler.Setup(s => s.RunTask(taskPath))
                .Throws(new COMException("The task is disabled. (0x80041326)", unchecked((int)0x80041326)));

            // Act
            _socketHandlers["task:run"].Invoke(mockResponse.Object);

            // Assert — names the cause AND the fix.
            _mockSocket.Verify(s => s.EmitAsync("task:executed", It.Is<object>(o =>
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("\"success\":false") &&
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("disabled") &&
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("Enable the task first")
            )), Times.Once);
        }

        [Fact]
        public void TaskDelete_Event_DeletesTaskAndEmitsResult()
        {
            // Arrange
            var taskPath = "\\TaskHub\\OldJob";
            var ts = Now();
            var nonce = TestNonce();
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.DeleteMessage(taskPath, nonce, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { taskPath, nonce, ts, sig }));

            _mockScheduler.Setup(s => s.DeleteTask(taskPath)).Returns(true);

            // Act
            _socketHandlers["task:delete"].Invoke(mockResponse.Object);

            // Assert
            _mockScheduler.Verify(s => s.DeleteTask(taskPath), Times.Once);
            _mockSocket.Verify(s => s.EmitAsync("task:deleted", It.IsAny<object>()), Times.Once);
        }

        [Fact]
        public void TaskDelete_Event_NotFound_ReportsIdempotentSuccess()
        {
            // Arrange — a task already gone must still ack success (the desired
            // end state holds), so a stale DB row can be cleaned up server-side.
            var taskPath = "\\TaskHub\\Ghost";
            var ts = Now();
            var nonce = TestNonce();
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.DeleteMessage(taskPath, nonce, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { taskPath, nonce, ts, sig }));

            _mockScheduler.Setup(s => s.DeleteTask(taskPath)).Returns(false);

            // Act
            _socketHandlers["task:delete"].Invoke(mockResponse.Object);

            // Assert — still emits task:deleted (success carried in the payload).
            _mockScheduler.Verify(s => s.DeleteTask(taskPath), Times.Once);
            _mockSocket.Verify(s => s.EmitAsync("task:deleted", It.IsAny<object>()), Times.Once);
        }

        [Fact]
        public void TaskDelete_Event_AccessDenied_EmitsFriendlyFailure()
        {
            // Arrange — tasks registered by an elevated process give the user
            // read-only ACLs; the unelevated agent gets E_ACCESSDENIED. The ack
            // must carry an actionable message, not the raw HRESULT.
            var taskPath = "\\AI-Automation-Library\\LockedTask";
            var ts = Now();
            var nonce = TestNonce();
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.DeleteMessage(taskPath, nonce, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { taskPath, nonce, ts, sig }));

            _mockScheduler.Setup(s => s.DeleteTask(taskPath))
                .Throws(new UnauthorizedAccessException("Access is denied. (0x80070005 (E_ACCESSDENIED))"));

            // Act
            _socketHandlers["task:delete"].Invoke(mockResponse.Object);

            // Assert — failure ack with the friendly explanation (and the path).
            _mockSocket.Verify(s => s.EmitAsync("task:deleted", It.Is<object>(o =>
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("administrator rights") &&
                JsonSerializer.Serialize(o, (JsonSerializerOptions?)null).Contains("LockedTask"))), Times.Once);
        }

        [Fact]
        public void TaskDelete_Event_RejectsInvalidSignature()
        {
            // Arrange — a forged delete must never touch the scheduler (an
            // attacker could otherwise remove backups/monitoring jobs).
            var taskPath = "\\Mikes\\NightlyBackup";
            var ts = Now();
            var nonce = TestNonce();

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { taskPath, nonce, ts, sig = "deadbeef" }));

            // Act
            _socketHandlers["task:delete"].Invoke(mockResponse.Object);

            // Assert — scheduler untouched, no ack emitted.
            _mockScheduler.Verify(s => s.DeleteTask(It.IsAny<string>()), Times.Never);
            _mockSocket.Verify(s => s.EmitAsync("task:deleted", It.IsAny<object>()), Times.Never);
        }

        [Fact]
        public void TaskCreate_Event_RejectsInvalidSignature()
        {
            // Arrange — RCE-relevant path: an unsigned create must be dropped.
            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new
                {
                    name = "Evil",
                    schedule = "0 * * * *",
                    command = "calc.exe",
                    action = new { executable = "calc.exe", args = new string[0] },
                    ts = Now(),
                    sig = "bad"
                }));

            // Act
            _socketHandlers["task:create"].Invoke(mockResponse.Object);

            // Assert
            _mockScheduler.Verify(s => s.CreateTask(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<AgentExecAction>(), It.IsAny<TriggerSpec?>(), It.IsAny<string?>()), Times.Never);
        }

        [Fact]
        public void TaskCreate_Event_CreatesTaskAndEmitsResult()
        {
            // Arrange — no trigger field => trigger canonicalizes to "none"
            var ts = Now();
            var nonce = TestNonce();
            var canonical = AgentAuthenticator.CanonicalizeAction("dir", new string[0]);
            var triggerCanonical = AgentAuthenticator.CanonicalizeTrigger(null);
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.CreateMessage("MyTestTask", "0 * * * *", "dir", canonical, triggerCanonical, "\\TaskHub", nonce, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new
                {
                    name = "MyTestTask",
                    schedule = "0 * * * *",
                    command = "dir",
                    action = new { executable = "dir", args = new string[0] },
                    nonce,
                    ts,
                    sig
                }));

            _mockScheduler.Setup(s => s.CreateTask("MyTestTask", "0 * * * *", It.IsAny<AgentExecAction>(), null, It.IsAny<string?>()))
                .Returns(new AgentTaskResult { Success = true, Path = "\\MyTestTask", Name = "MyTestTask" });

            // Act
            _socketHandlers["task:create"].Invoke(mockResponse.Object);

            // Assert — the structured action (not a cmd.exe string) reaches the
            // scheduler, and a payload with no folder still lands in \TaskHub
            // (the default every existing task depends on).
            _mockScheduler.Verify(s => s.CreateTask(
                "MyTestTask", "0 * * * *",
                It.Is<AgentExecAction>(a => a.Executable == "dir" && a.Args.Count == 0),
                null, "\\TaskHub"), Times.Once);
            _mockSocket.Verify(s => s.EmitAsync("task:created", It.Is<object>(obj => obj != null)), Times.Once);
        }

        [Fact]
        public void TaskCreate_Event_ParsesStructuredTrigger()
        {
            // Arrange — payload as emitted by WindowsAgentConnector.createTask.
            // The signed trigger canonical must match what the agent derives from
            // the deserialized payload trigger.
            var ts = Now();
            var nonce = TestNonce();
            var canonical = AgentAuthenticator.CanonicalizeAction("dir", new string[0]);
            var triggerCanonical = AgentAuthenticator.CanonicalizeTrigger(new TriggerSpec
            {
                Type = "Weekly",
                StartBoundary = "08:00",
                DaysOfWeek = new List<string> { "Monday" }
            });
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.CreateMessage("MyTestTask", "0 8 * * 1", "dir", canonical, triggerCanonical, "\\TaskHub", nonce, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new
                {
                    name = "MyTestTask",
                    schedule = "0 8 * * 1",
                    command = "dir",
                    action = new { executable = "dir", args = new string[0] },
                    trigger = new { type = "Weekly", startBoundary = "08:00", daysOfWeek = new[] { "Monday" } },
                    nonce,
                    ts,
                    sig
                }));

            _mockScheduler.Setup(s => s.CreateTask(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<AgentExecAction>(), It.IsAny<TriggerSpec?>(), It.IsAny<string?>()))
                .Returns(new AgentTaskResult { Success = true, Path = "\\MyTestTask", Name = "MyTestTask" });

            // Act
            _socketHandlers["task:create"].Invoke(mockResponse.Object);

            // Assert — camelCase JSON must map onto TriggerSpec properties
            _mockScheduler.Verify(s => s.CreateTask(
                "MyTestTask",
                "0 8 * * 1",
                It.IsAny<AgentExecAction>(),
                It.Is<TriggerSpec>(t =>
                    t.Type == "Weekly" &&
                    t.StartBoundary == "08:00" &&
                    t.DaysOfWeek != null &&
                    t.DaysOfWeek.Count == 1 &&
                    t.DaysOfWeek[0] == "Monday"), "\\TaskHub"), Times.Once);
        }

        [Fact]
        public void TaskCreate_Event_NullTrigger_PassedAsNull()
        {
            // Arrange — server sends trigger: null when no conversion applies
            var ts = Now();
            var nonce = TestNonce();
            var canonical = AgentAuthenticator.CanonicalizeAction("dir", new string[0]);
            var triggerCanonical = AgentAuthenticator.CanonicalizeTrigger(null);
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.CreateMessage("MyTestTask", "0 * * * *", "dir", canonical, triggerCanonical, "\\TaskHub", nonce, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new
                {
                    name = "MyTestTask",
                    schedule = "0 * * * *",
                    command = "dir",
                    action = new { executable = "dir", args = new string[0] },
                    trigger = (object?)null,
                    nonce,
                    ts,
                    sig
                }));

            _mockScheduler.Setup(s => s.CreateTask(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<AgentExecAction>(), It.IsAny<TriggerSpec?>(), It.IsAny<string?>()))
                .Returns(new AgentTaskResult { Success = true, Path = "\\MyTestTask", Name = "MyTestTask" });

            // Act
            _socketHandlers["task:create"].Invoke(mockResponse.Object);

            // Assert
            _mockScheduler.Verify(s => s.CreateTask("MyTestTask", "0 * * * *", It.IsAny<AgentExecAction>(), null, "\\TaskHub"), Times.Once);
        }

        [Fact]
        public void TaskCreate_Event_TamperedTrigger_IsRejected()
        {
            // Arrange — sign the command as if there were NO trigger, but send a
            // real trigger on the wire (an on-path attacker rewriting the schedule).
            // The trigger is now part of the signed message, so verification fails.
            var ts = Now();
            var nonce = TestNonce();
            var canonical = AgentAuthenticator.CanonicalizeAction("dir", new string[0]);
            var sigWithoutTrigger = AgentAuthenticator.Hmac(
                _auth.SessionKey!,
                AgentAuthenticator.CreateMessage("MyTestTask", "0 * * * *", "dir", canonical, AgentAuthenticator.CanonicalizeTrigger(null), "\\TaskHub", nonce, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new
                {
                    name = "MyTestTask",
                    schedule = "0 * * * *",
                    command = "dir",
                    action = new { executable = "dir", args = new string[0] },
                    trigger = new { type = "Weekly", startBoundary = "03:00", daysOfWeek = new[] { "Sunday" } },
                    ts,
                    sig = sigWithoutTrigger
                }));

            // Act
            _socketHandlers["task:create"].Invoke(mockResponse.Object);

            // Assert — the tampered command never reaches the scheduler.
            _mockScheduler.Verify(
                s => s.CreateTask(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<AgentExecAction>(), It.IsAny<TriggerSpec?>()),
                Times.Never);
        }
    }
}
