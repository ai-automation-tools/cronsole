using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Cronsole.Agent
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

        // Session keys currently valid for command verification. The current key
        // (Expiry == null) never expires — a connection reuses it for its whole
        // lifetime. A reconnect derives a new current key and gives the outgoing
        // one a grace expiry (unix seconds), so a command signed under the old
        // connection that's still in flight when the socket rekeys isn't
        // false-rejected. Superseded keys drop after MaxSkewSeconds (a command
        // older than that fails the freshness check anyway), so the set stays tiny.
        private readonly object _keyLock = new();
        private readonly List<(string Key, long? Expiry)> _sessionKeys = new();

        // Seen (ts|sig) command signatures -> expiry (unix seconds): a valid
        // command is accepted at most once within its freshness window, so a
        // captured command frame can't be replayed on a plaintext connection.
        //
        // This guard assumes every distinct command has a distinct signature.
        // That assumption was FALSE until the per-command nonce landed: `ts` is
        // second-granular, so two legitimate identical commands within one second
        // hashed to the same sig and the second was dropped as a "replay" —
        // silently, leaving the server to time out and blame the transport
        // (troubleshooting #16). The nonce inside every *Message restores the
        // assumption, which is why this cache needs no key change: a legitimate
        // re-send now differs, a replayed frame is still byte-identical.
        private readonly object _replayLock = new();
        private readonly Dictionary<string, long> _seenCommands = new();

        public string AgentId { get; }

        // The most recent session key (from the last CreateHandshakeAuth); null
        // until the first connect attempt. VerifyCommand accepts this AND any
        // other still-valid key (see _sessionKeys).
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

            // Make the new key the current (non-expiring) one; give the outgoing
            // current key a grace expiry so in-flight commands under it still
            // verify through the reconnect overlap, and drop any already past it.
            lock (_keyLock)
            {
                var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                _sessionKeys.RemoveAll(k => k.Expiry.HasValue && k.Expiry.Value <= now);
                for (var i = 0; i < _sessionKeys.Count; i++)
                {
                    if (_sessionKeys[i].Expiry == null)
                    {
                        _sessionKeys[i] = (_sessionKeys[i].Key, now + MaxSkewSeconds);
                    }
                }
                _sessionKeys.Add((SessionKey, null));
            }

            // Lowercase keys => socket.handshake.auth.{agentId,nonce,ts,hmac} server-side.
            return new { agentId = AgentId, nonce, ts, hmac };
        }

        // Verify a command's HMAC against any currently-valid session key and the
        // freshness window, then guard against replay. `message` must be built
        // with the *Message helpers below. Returns false for a stale timestamp,
        // an unverifiable signature, or a signature already seen in-window.
        public bool VerifyCommand(string message, long ts, string sig)
        {
            if (string.IsNullOrEmpty(sig)) return false;

            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            if (Math.Abs(now - ts) > MaxSkewSeconds) return false;

            string[] keys;
            lock (_keyLock)
            {
                // Only superseded keys carry an expiry; the current key (null) stays.
                _sessionKeys.RemoveAll(k => k.Expiry.HasValue && k.Expiry.Value <= now);
                keys = _sessionKeys.Select(k => k.Key).ToArray();
            }
            if (keys.Length == 0) return false;

            var verified = false;
            foreach (var key in keys)
            {
                // No early break: check every key so timing doesn't reveal which
                // (if any) matched.
                if (FixedTimeEquals(Hmac(key, message), sig)) verified = true;
            }
            if (!verified) return false;

            // Only consume the replay slot after the signature checks out, so a
            // forged (ts, sig) can't pre-poison the cache to block a real command.
            return RegisterCommandUse(ts, sig, now);
        }

        // Record a verified command's signature; returns false if it was already
        // used within its freshness window (a replay). Bounded: entries expire
        // after MaxSkewSeconds and are pruned on each call.
        private bool RegisterCommandUse(long ts, string sig, long now)
        {
            lock (_replayLock)
            {
                var expired = _seenCommands.Where(kv => kv.Value <= now).Select(kv => kv.Key).ToList();
                foreach (var k in expired) _seenCommands.Remove(k);

                var key = $"{ts}|{sig}";
                if (_seenCommands.ContainsKey(key)) return false;
                _seenCommands[key] = now + MaxSkewSeconds;
                return true;
            }
        }

        // Canonical command messages — must match commandMessage() in agentAuth.ts.
        //
        // `nonce` sits immediately before `ts` in every message and is REQUIRED:
        // it is what makes each command instance unique. Without it, `ts` is
        // second-granular, so two legitimate identical commands inside one second
        // signed to the SAME signature — indistinguishable from a replayed frame,
        // so RegisterCommandUse silently dropped the second and the server timed
        // out blaming the transport (troubleshooting #16). Taking it as a required
        // parameter is the enforcement point: you cannot build a signed message
        // without one.
        public static string RunMessage(string taskPath, string nonce, long ts) =>
            $"task:run|{taskPath}|{nonce}|{ts}";

        public static string DeleteMessage(string taskPath, string nonce, long ts) =>
            $"task:delete|{taskPath}|{nonce}|{ts}";

        public static string SetStatusMessage(string taskPath, bool enabled, string nonce, long ts) =>
            $"task:set_status|{taskPath}|{(enabled ? 1 : 0)}|{nonce}|{ts}";

        // The trigger IS the change, so it's part of the signed message (mirrors
        // the task:create trigger coverage).
        public static string UpdateScheduleMessage(string taskPath, string triggerCanonical, string nonce, long ts) =>
            $"task:update_schedule|{taskPath}|{triggerCanonical}|{nonce}|{ts}";

        // The action (executable + args), working dir, description, and run level
        // ARE the change here, so all are part of the signed message. Fields are
        // pre-normalized (empty string for unset) — must match commandMessage()'s
        // 'task:update' case in agentAuth.ts byte-for-byte.
        public static string UpdateMessage(string taskPath, string actionCanonical, string workingDirectory, string description, string runLevel, string nonce, long ts) =>
            $"task:update|{taskPath}|{actionCanonical}|{workingDirectory}|{description}|{runLevel}|{nonce}|{ts}";

        // Matches the 'task:import' case in agentAuth.ts byte-for-byte.
        //
        // The XML enters as a HASH rather than by value. It is not a size
        // optimization: the XML IS the task — its action, its trigger, and its
        // principal (including RunLevel Highest and the account it runs as) — so
        // leaving it out of the signature would make the signature decorative,
        // and embedding it raw would put arbitrary '|' bytes inside a
        // pipe-delimited message. A fixed-width digest is unambiguous on both
        // sides of the language boundary, the same reason CanonicalizeAction and
        // CanonicalizeTrigger exist.
        //
        // `overwrite` and `createFolders` are signed because each one widens what
        // the command is allowed to destroy or create: flipping overwrite turns a
        // refusal into an overwrite of a task the user still has, which is
        // exactly the redirection `folder` is signed to prevent.
        public static string ImportMessage(string taskPath, string xmlSha256, bool overwrite, bool createFolders, string nonce, long ts) =>
            $"task:import|{taskPath}|{xmlSha256}|{(overwrite ? 1 : 0)}|{(createFolders ? 1 : 0)}|{nonce}|{ts}";

        /// <summary>
        /// Lowercase-hex SHA-256 over the UTF-8 bytes of <paramref name="value"/>.
        /// Must match the backend's sha256Hex — same bytes in, same string out.
        /// </summary>
        public static string Sha256Hex(string value)
        {
            var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value ?? string.Empty));
            return Convert.ToHexString(hash).ToLowerInvariant();
        }

        // Matches the 'task:create' case in agentAuth.ts byte-for-byte. `folder`
        // is signed and sits last among the payload fields: it decides WHERE the
        // task is registered, and RegisterTaskDefinition silently overwrites a
        // same-named task in the same folder — so an unsigned folder would let
        // an on-path attacker redirect a create onto an existing task.
        public static string CreateMessage(string name, string schedule, string command, string actionCanonical, string triggerCanonical, string folder, string nonce, long ts) =>
            $"task:create|{name}|{schedule}|{command}|{actionCanonical}|{triggerCanonical}|{folder}|{nonce}|{ts}";

        // Canonical action string the create signature covers. MUST match the
        // backend's canonicalizeAction (utils/commandParser.ts): the executable and
        // each argument joined by the ASCII unit separator (0x1F).
        public static string CanonicalizeAction(string executable, IEnumerable<string> args)
        {
            var parts = new List<string> { executable };
            parts.AddRange(args);
            return string.Join('\u001f', parts);
        }

        // Canonical trigger string the create signature covers. MUST match the
        // backend's canonicalizeTrigger (utils/scheduler-conversion.ts): a null
        // trigger is the literal "none"; otherwise a fixed-order, pipe-joined
        // form with optional fields collapsed to empty.
        public static string CanonicalizeTrigger(TriggerSpec? trigger)
        {
            if (trigger == null) return "none";
            var daysInterval = trigger.DaysInterval?.ToString(CultureInfo.InvariantCulture) ?? "";
            var daysOfWeek = trigger.DaysOfWeek != null ? string.Join(",", trigger.DaysOfWeek) : "";
            var repInterval = trigger.Repetition?.Interval ?? "";
            var repDuration = trigger.Repetition?.Duration ?? "";
            return string.Join("|", new[]
            {
                "trigger",
                trigger.Type,
                trigger.StartBoundary,
                daysInterval,
                daysOfWeek,
                repInterval,
                repDuration
            });
        }

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
