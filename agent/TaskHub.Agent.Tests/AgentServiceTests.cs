using System;
using System.Collections.Generic;
using System.Linq;
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
            _socketHandlers.Should().ContainKey("task:set_status");
            _socketHandlers.Should().ContainKey("task:run");
            _socketHandlers.Should().ContainKey("task:create");
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
        public void TaskSetStatus_Event_UpdatesTaskStatus()
        {
            // Arrange
            var taskPath = "\\Mikes\\Backup";
            var enabled = false;
            var ts = Now();
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.SetStatusMessage(taskPath, enabled, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { taskPath, enabled, ts, sig }));

            _mockScheduler.Setup(s => s.SetTaskStatus(taskPath, enabled)).Returns(true);

            // Act
            _socketHandlers["task:set_status"].Invoke(mockResponse.Object);

            // Assert
            _mockScheduler.Verify(s => s.SetTaskStatus(taskPath, enabled), Times.Once);
        }

        [Fact]
        public void TaskRun_Event_RunsTaskAndEmitsResult()
        {
            // Arrange
            var taskPath = "\\Mikes\\CleanTemp";
            var ts = Now();
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.RunMessage(taskPath, ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { taskPath, ts, sig }));

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

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { taskPath, ts, sig = "deadbeef" }));

            // Act
            _socketHandlers["task:run"].Invoke(mockResponse.Object);

            // Assert — scheduler untouched, no result emitted.
            _mockScheduler.Verify(s => s.RunTask(It.IsAny<string>()), Times.Never);
            _mockSocket.Verify(s => s.EmitAsync("task:executed", It.IsAny<object>()), Times.Never);
        }

        [Fact]
        public void TaskCreate_Event_RejectsInvalidSignature()
        {
            // Arrange — RCE-relevant path: an unsigned create must be dropped.
            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { name = "Evil", schedule = "0 * * * *", command = "calc.exe", ts = Now(), sig = "bad" }));

            // Act
            _socketHandlers["task:create"].Invoke(mockResponse.Object);

            // Assert
            _mockScheduler.Verify(s => s.CreateTask(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<TriggerSpec?>()), Times.Never);
        }

        [Fact]
        public void TaskCreate_Event_CreatesTaskAndEmitsResult()
        {
            // Arrange
            var ts = Now();
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.CreateMessage("MyTestTask", "0 * * * *", "dir", ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { name = "MyTestTask", schedule = "0 * * * *", command = "dir", ts, sig }));

            _mockScheduler.Setup(s => s.CreateTask("MyTestTask", "0 * * * *", "dir", null))
                .Returns(new AgentTaskResult { Success = true, Path = "\\MyTestTask", Name = "MyTestTask" });

            // Act
            _socketHandlers["task:create"].Invoke(mockResponse.Object);

            // Assert
            _mockScheduler.Verify(s => s.CreateTask("MyTestTask", "0 * * * *", "dir", null), Times.Once);
            _mockSocket.Verify(s => s.EmitAsync("task:created", It.Is<object>(obj => obj != null)), Times.Once);
        }

        [Fact]
        public void TaskCreate_Event_ParsesStructuredTrigger()
        {
            // Arrange — payload as emitted by WindowsAgentConnector.createTask
            var ts = Now();
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.CreateMessage("MyTestTask", "0 8 * * 1", "dir", ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new
                {
                    name = "MyTestTask",
                    schedule = "0 8 * * 1",
                    command = "dir",
                    trigger = new { type = "Weekly", startBoundary = "08:00", daysOfWeek = new[] { "Monday" } },
                    ts,
                    sig
                }));

            _mockScheduler.Setup(s => s.CreateTask(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<TriggerSpec?>()))
                .Returns(new AgentTaskResult { Success = true, Path = "\\MyTestTask", Name = "MyTestTask" });

            // Act
            _socketHandlers["task:create"].Invoke(mockResponse.Object);

            // Assert — camelCase JSON must map onto TriggerSpec properties
            _mockScheduler.Verify(s => s.CreateTask(
                "MyTestTask",
                "0 8 * * 1",
                "dir",
                It.Is<TriggerSpec>(t =>
                    t.Type == "Weekly" &&
                    t.StartBoundary == "08:00" &&
                    t.DaysOfWeek != null &&
                    t.DaysOfWeek.Count == 1 &&
                    t.DaysOfWeek[0] == "Monday")), Times.Once);
        }

        [Fact]
        public void TaskCreate_Event_NullTrigger_PassedAsNull()
        {
            // Arrange — server sends trigger: null when no conversion applies
            var ts = Now();
            var sig = AgentAuthenticator.Hmac(_auth.SessionKey!, AgentAuthenticator.CreateMessage("MyTestTask", "0 * * * *", "dir", ts));

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0))
                .Returns(Payload(new { name = "MyTestTask", schedule = "0 * * * *", command = "dir", trigger = (object?)null, ts, sig }));

            _mockScheduler.Setup(s => s.CreateTask(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<TriggerSpec?>()))
                .Returns(new AgentTaskResult { Success = true, Path = "\\MyTestTask", Name = "MyTestTask" });

            // Act
            _socketHandlers["task:create"].Invoke(mockResponse.Object);

            // Assert
            _mockScheduler.Verify(s => s.CreateTask("MyTestTask", "0 * * * *", "dir", null), Times.Once);
        }
    }
}
