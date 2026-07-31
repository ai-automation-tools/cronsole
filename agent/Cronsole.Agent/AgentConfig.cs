using System;
using System.IO;
using System.Text.Json;

namespace Cronsole.Agent
{
    // Agent configuration resolved from (in precedence order):
    //   1. environment variables  — CRONSOLE_SERVER_URL / CRONSOLE_PAIRING_SECRET / CRONSOLE_AGENT_ID
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

        // The variable prefix used before the 2026-07-31 rename. Built from
        // parts deliberately: a literal here is exactly what a rename pass
        // rewrites, which would collapse the fallback below into
        // CRONSOLE_x ?? CRONSOLE_x — still compiling, still reading correctly,
        // and silently dropping the compatibility it exists to provide. That
        // happened once already during this rename.
        private static readonly string LegacyPrefix = string.Concat("TASK", "HUB");

        // Read CRONSOLE_<name>, accepting the pre-rename name. The agent's config
        // lives on the operator's machine, not in this repo, so renaming the
        // variable in code alone would leave an already-configured agent unable
        // to find its pairing secret — and an agent that can't authenticate is
        // indistinguishable from one that's simply offline.
        public static string? Env(string name) =>
            Environment.GetEnvironmentVariable($"CRONSOLE_{name}")
                is string current && !string.IsNullOrWhiteSpace(current)
                    ? current
                    : Environment.GetEnvironmentVariable($"{LegacyPrefix}_{name}");

        public static AgentConfig Load()
        {
            var file = LoadFile();
            return new AgentConfig
            {
                ServerUrl = Pick(Env("SERVER_URL"), file?.ServerUrl, "http://localhost:3000")!,
                PairingSecret = Pick(Env("PAIRING_SECRET"), file?.PairingSecret, null),
                AgentId = Pick(Env("AGENT_ID"), file?.AgentId, Environment.MachineName)!,
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
