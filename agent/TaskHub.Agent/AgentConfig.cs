using System;
using System.IO;
using System.Text.Json;

namespace TaskHub.Agent
{
    // Agent configuration resolved from (in precedence order):
    //   1. environment variables  — TASKHUB_SERVER_URL / TASKHUB_PAIRING_SECRET / TASKHUB_AGENT_ID
    //   2. an appsettings.json file next to the executable or in the working dir
    //   3. built-in defaults
    // Env vars win so a deployment can override the file without editing it; the
    // file is the local-dev convenience so the secret needn't be exported each run.
    public class AgentConfig
    {
        public string ServerUrl { get; init; } = "http://localhost:3000";
        public string? PairingSecret { get; init; }
        public string AgentId { get; init; } = Environment.MachineName;

        // First non-blank value: env → file → fallback. Pure + unit-tested.
        public static string? Pick(string? env, string? file, string? fallback) =>
            !string.IsNullOrWhiteSpace(env) ? env
            : !string.IsNullOrWhiteSpace(file) ? file
            : fallback;

        public static AgentConfig Load()
        {
            var file = LoadFile();
            return new AgentConfig
            {
                ServerUrl = Pick(
                    Environment.GetEnvironmentVariable("TASKHUB_SERVER_URL"),
                    file?.ServerUrl, "http://localhost:3000")!,
                PairingSecret = Pick(
                    Environment.GetEnvironmentVariable("TASKHUB_PAIRING_SECRET"),
                    file?.PairingSecret, null),
                AgentId = Pick(
                    Environment.GetEnvironmentVariable("TASKHUB_AGENT_ID"),
                    file?.AgentId, Environment.MachineName)!,
            };
        }

        // Look beside the exe first (published/installed), then the working dir
        // (`dotnet run`). appsettings.Local.json overrides appsettings.json.
        private static FileConfig? LoadFile()
        {
            foreach (var dir in new[] { AppContext.BaseDirectory, Directory.GetCurrentDirectory() })
            {
                foreach (var name in new[] { "appsettings.Local.json", "appsettings.json" })
                {
                    var path = Path.Combine(dir, name);
                    if (!File.Exists(path)) continue;
                    try
                    {
                        var parsed = JsonSerializer.Deserialize<FileConfig>(
                            File.ReadAllText(path),
                            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                        if (parsed != null) return parsed;
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine($"WARN: could not read {path}: {ex.Message}");
                    }
                }
            }
            return null;
        }

        private class FileConfig
        {
            public string? ServerUrl { get; set; }
            public string? PairingSecret { get; set; }
            public string? AgentId { get; set; }
        }
    }
}
