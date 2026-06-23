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
            await Task.Delay(-1); // Keep the app running
        }
    }
}
