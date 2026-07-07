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

            // Watchdog: the socket client auto-reconnects on drops, but a failed
            // *initial* connect (e.g. agent starts at boot before the backend)
            // never retries on its own. Re-attempt whenever we're disconnected.
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
