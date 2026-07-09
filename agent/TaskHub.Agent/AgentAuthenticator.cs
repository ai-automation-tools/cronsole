using System;
using System.Security.Cryptography;
using System.Text;

namespace TaskHub.Agent
{
    // Agent side of the WebSocket authentication contract. Mirrors
    // backend/src/ws/agentAuth.ts — the HMAC message strings and the SHA-256
    // hex output MUST be byte-for-byte identical on both sides or the handshake
    // and command verification fail.
    //
    //  - CreateHandshakeAuth() builds the { agentId, nonce, ts, hmac } payload
    //    sent as the Socket.IO handshake `auth`, and (re)derives the per-session
    //    key used to verify commands.
    //  - VerifyCommand() checks the per-command HMAC + freshness before the agent
    //    executes any state-changing command (task:run / task:create / set_status).
    public class AgentAuthenticator
    {
        // Clock-skew / replay tolerance, seconds. Must match MAX_SKEW_SEC server-side.
        private const int MaxSkewSeconds = 120;
        private const int MinSecretLength = 16;

        private readonly string _secret;

        public string AgentId { get; }

        // Set on each CreateHandshakeAuth(); null until the first connect attempt.
        public string? SessionKey { get; private set; }

        // Fields from the most recent handshake, exposed for inspection/testing
        // (they're the same values embedded in the returned Auth payload).
        public string? Nonce { get; private set; }
        public long HandshakeTimestamp { get; private set; }
        public string? HandshakeHmac { get; private set; }

        public AgentAuthenticator(string secret, string agentId)
        {
            if (string.IsNullOrWhiteSpace(secret) || secret.Length < MinSecretLength)
            {
                throw new ArgumentException(
                    $"Pairing secret must be at least {MinSecretLength} characters", nameof(secret));
            }
            _secret = secret;
            AgentId = string.IsNullOrWhiteSpace(agentId) ? Environment.MachineName : agentId;
        }

        // Fresh nonce + timestamp per connection attempt; also (re)derives the
        // session key the server will use to sign commands back to us.
        public object CreateHandshakeAuth()
        {
            var nonce = Guid.NewGuid().ToString("N");
            var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var hmac = Hmac(_secret, $"{AgentId}|{nonce}|{ts}");

            Nonce = nonce;
            HandshakeTimestamp = ts;
            HandshakeHmac = hmac;
            SessionKey = Hmac(_secret, $"session:{nonce}");

            // Lowercase keys => socket.handshake.auth.{agentId,nonce,ts,hmac} server-side.
            return new { agentId = AgentId, nonce, ts, hmac };
        }

        // Verify a command's HMAC against the current session key and freshness
        // window. `message` must be built with the *Message helpers below.
        public bool VerifyCommand(string message, long ts, string sig)
        {
            if (SessionKey == null || string.IsNullOrEmpty(sig)) return false;

            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            if (Math.Abs(now - ts) > MaxSkewSeconds) return false;

            var expected = Hmac(SessionKey, message);
            return FixedTimeEquals(expected, sig);
        }

        // Canonical command messages — must match commandMessage() in agentAuth.ts.
        public static string RunMessage(string taskPath, long ts) =>
            $"task:run|{taskPath}|{ts}";

        public static string SetStatusMessage(string taskPath, bool enabled, long ts) =>
            $"task:set_status|{taskPath}|{(enabled ? 1 : 0)}|{ts}";

        public static string CreateMessage(string name, string schedule, string command, long ts) =>
            $"task:create|{name}|{schedule}|{command}|{ts}";

        public static string Hmac(string key, string message)
        {
            using var h = new HMACSHA256(Encoding.UTF8.GetBytes(key));
            var hash = h.ComputeHash(Encoding.UTF8.GetBytes(message));
            // Lowercase hex to match Node's crypto digest('hex').
            return Convert.ToHexString(hash).ToLowerInvariant();
        }

        private static bool FixedTimeEquals(string a, string b)
        {
            var ba = Encoding.UTF8.GetBytes(a);
            var bb = Encoding.UTF8.GetBytes(b);
            return CryptographicOperations.FixedTimeEquals(ba, bb);
        }
    }
}
