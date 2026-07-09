using System;
using System.Threading.Tasks;

// Fix ambiguity between Microsoft.Win32.TaskScheduler.Task and System.Threading.Tasks.Task
using Task = System.Threading.Tasks.Task;

namespace TaskHub.Agent
{
    class Program
    {
        static async Task Main(string[] args)
        {
            Console.WriteLine("TaskHub Windows Agent Starting...");

            // Configuration
            var serverUrl = "http://localhost:3000";
            var socket = new SocketIOWrapper(serverUrl);
            var scheduler = new Win32TaskScheduler();
            var agent = new AgentService(socket, scheduler);

            await agent.StartAsync();

            Console.WriteLine("Agent is running. Press Ctrl+C to stop.");

            // Watchdog: the sole owner of (re)connection. The library's internal
            // reconnect is disabled (see SocketIOWrapper) because it doesn't fire on
            // a server-initiated disconnect and can't reuse an aborted WebSocket.
            // Every 30s while disconnected we ConnectAsync(), which rebuilds a fresh
            // client — covering a failed initial connect (agent boots before the
            // backend) and any later drop (e.g. a backend restart) alike.
            while (true)
            {
                await Task.Delay(TimeSpan.FromSeconds(30));
                if (!socket.Connected)
                {
                    Console.WriteLine("Watchdog: not connected, attempting to connect...");
                    try
                    {
                        await socket.ConnectAsync();
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Watchdog: connect failed: {ex.Message}");
                    }
                }
            }
        }
    }
}
