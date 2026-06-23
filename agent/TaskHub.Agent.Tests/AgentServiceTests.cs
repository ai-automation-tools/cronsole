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
        private readonly AgentService _agentService;

        // Captured events from SetupSocketEvents
        private Action? _onConnectedHandler;
        private Action? _onDisconnectedHandler;
        private readonly Dictionary<string, Action<ISocketResponse>> _socketHandlers = new();

        public AgentServiceTests()
        {
            _mockSocket = new Mock<ISocketClient>();
            _mockScheduler = new Mock<ITaskScheduler>();

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

            _agentService = new AgentService(_mockSocket.Object, _mockScheduler.Object);
        }

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

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<string>(0)).Returns(taskPath);
            mockResponse.Setup(r => r.GetValue<bool>(1)).Returns(enabled);

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

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<string>(0)).Returns(taskPath);

            _mockScheduler.Setup(s => s.RunTask(taskPath)).Returns(true);

            // Act
            _socketHandlers["task:run"].Invoke(mockResponse.Object);

            // Assert
            _mockScheduler.Verify(s => s.RunTask(taskPath), Times.Once);
            _mockSocket.Verify(s => s.EmitAsync("task:executed", It.IsAny<object>()), Times.Once);
        }

        [Fact]
        public void TaskCreate_Event_CreatesTaskAndEmitsResult()
        {
            // Arrange
            var dataJson = "{\"name\":\"MyTestTask\",\"schedule\":\"0 * * * *\",\"command\":\"dir\"}";
            var jsonDocument = JsonDocument.Parse(dataJson);
            var element = jsonDocument.RootElement;

            var mockResponse = new Mock<ISocketResponse>();
            mockResponse.Setup(r => r.GetValue<JsonElement>(0)).Returns(element);

            _mockScheduler.Setup(s => s.CreateTask("MyTestTask", "0 * * * *", "dir"))
                .Returns(new AgentTaskResult { Success = true, Path = "\\MyTestTask", Name = "MyTestTask" });

            // Act
            _socketHandlers["task:create"].Invoke(mockResponse.Object);

            // Assert
            _mockScheduler.Verify(s => s.CreateTask("MyTestTask", "0 * * * *", "dir"), Times.Once);
            _mockSocket.Verify(s => s.EmitAsync("task:created", It.Is<object>(obj => obj != null)), Times.Once);
        }
    }
}
