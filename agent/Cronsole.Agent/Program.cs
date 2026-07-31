using System;
using System.Threading.Tasks;

// Fix ambiguity between Microsoft.Win32.TaskScheduler.Task and System.Threading.Tasks.Task
using Task = System.Threading.Tasks.Task;

namespace Cronsole.Agent
{
    class Program
    {
        static async Task Main(string[] args)
        {
            Console.WriteLine("Cronsole Windows Agent Starting...");

            // Configuration: env vars override appsettings.json, which overrides
            // defaults (see AgentConfig). WSS-capable via the URL scheme.
            var config = AgentConfig.Load();

            if (string.IsNullOrWhiteSpace(config.PairingSecret))
            {
                Console.Error.WriteLine(
                    "FATAL: no pairing secret configured. The agent cannot authenticate to " +
                    "the backend without it. Set CRONSOLE_PAIRING_SECRET in the environment, or " +
                    "add \"pairingSecret\" to appsettings.json (copy appsettings.example.json). " +
                    "It must match the backend's AGENT_PAIRING_SECRET.");
                Environment.Exit(1);
                return;
            }

            AgentAuthenticator authenticator;
            try
            {
                authenticator = new AgentAuthenticator(config.PairingSecret, config.AgentId);
            }
            catch (ArgumentException ex)
            {
                Console.Error.WriteLine($"FATAL: {ex.Message}");
                Environment.Exit(1);
                return;
            }

            Console.WriteLine($"Connecting as agent '{config.AgentId}' to {config.ServerUrl}");
            var socket = new SocketIOWrapper(config.ServerUrl, authenticator);
            var scheduler = new Win32TaskScheduler();
            var agent = new AgentService(socket, scheduler, authenticator);

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
