using System;
using System.Collections.Generic;
using System.Threading;
using Xunit;
using FluentAssertions;
using TaskHub.Agent;

namespace TaskHub.Agent.Tests
{
    public class AgentAuthenticatorTests
    {
        // Golden vector shared with backend/src/ws/__tests__/agentAuth.test.ts.
        // If these diverge, the agent and backend disagree on HMACs and every
        // handshake/command fails — both suites must stay in lockstep.
        private const string Secret = "test-pairing-secret-value";
        private const string AgentId = "test-agent";
        private const string Nonce = "abc123";
        private const long Ts = 1700000000;
        private const string ExpectedHandshake = "e8e72a611dac9a8f0b3fab109adea8871b61ca31980efcba7c3ed842d94c0434";
        private const string ExpectedSessionKey = "67d80428fd79e26dd92269f97474031860185d325df6c731cda179e22b53ff14";
        private const string ExpectedRunSig = "e76700fc1e7c6f8e6a9d85e76f17713c7e47c0b8b4b2e1b93b5866886ac02c48";
        private const string ExpectedDeleteSig = "ac32ed9af3b1904803cc54a7667e109e25e79c068f420c386c054374fd23d61f";
        private const string ExpectedStatusSig = "9a01e71e17bba19ffadfa229be77c04d85ec4b92f2493cff9b1b107f13075133";
        // task:update_schedule signs the trigger. Golden case: Daily 03:00,
        // daysInterval 1 -> canonical "trigger|Daily|03:00|1|||".
        private const string ExpectedUpdateScheduleSig = "65333bec21e6e67657195befd02cd7178309cbcb4404e0ce7ed99ff912ae686b";
        // task:update signs the structured action, working dir, description, and run
        // level. Golden case: action { executable: "powershell.exe", args: ["-File",
        // "C:\\x.ps1"] } -> canonical "powershell.exe-FileC:\\x.ps1",
        // working dir "C:\\scripts", description "Nightly job", runLevel "highest".
        private const string ExpectedUpdateSig = "a11ff9024b5a5b0e590f8a6b55824f289dd26abba53d0ecb2d594d18b320c91f";
        // task:create signs the structured action AND the trigger. Golden action is
        // { executable: "dir", args: [] } -> canonical "dir"; trigger null -> "none".
        private const string ExpectedCreateSig = "4e04ffa6a881215d70a94ef84984898398567f7218d57f6cc3d9fa9264f9e0ba";
        // Same command with a Weekly trigger -> canonical
        // "trigger|Weekly|09:30||Monday,Wednesday|PT30M|P1D".
        private const string ExpectedCreateSigWithTrigger = "e4bfa1a7b2c20bde20c72bf444b955dbad5c27c920af5fdddd5750191278643e";

        [Fact]
        public void Hmac_MatchesGoldenVector_HandshakeAndSession()
        {
            AgentAuthenticator.Hmac(Secret, $"{AgentId}|{Nonce}|{Ts}").Should().Be(ExpectedHandshake);
            AgentAuthenticator.Hmac(Secret, $"session:{Nonce}").Should().Be(ExpectedSessionKey);
        }

        [Fact]
        public void CommandMessages_SignToGoldenVector()
        {
            AgentAuthenticator.Hmac(ExpectedSessionKey, AgentAuthenticator.RunMessage("MyTask", Ts))
                .Should().Be(ExpectedRunSig);
            AgentAuthenticator.Hmac(ExpectedSessionKey, AgentAuthenticator.DeleteMessage("MyTask", Ts))
                .Should().Be(ExpectedDeleteSig);
            AgentAuthenticator.Hmac(ExpectedSessionKey, AgentAuthenticator.SetStatusMessage("MyTask", false, Ts))
                .Should().Be(ExpectedStatusSig);
            var dailyTrigger = new TriggerSpec { Type = "Daily", StartBoundary = "03:00", DaysInterval = 1 };
            AgentAuthenticator.Hmac(ExpectedSessionKey,
                AgentAuthenticator.UpdateScheduleMessage("MyTask", AgentAuthenticator.CanonicalizeTrigger(dailyTrigger), Ts))
                .Should().Be(ExpectedUpdateScheduleSig);
            var updateAction = AgentAuthenticator.CanonicalizeAction("powershell.exe", new[] { "-File", "C:\\x.ps1" });
            AgentAuthenticator.Hmac(ExpectedSessionKey,
                AgentAuthenticator.UpdateMessage("MyTask", updateAction, "C:\\scripts", "Nightly job", "highest", Ts))
                .Should().Be(ExpectedUpdateSig);

            var actionCanonical = AgentAuthenticator.CanonicalizeAction("dir", new string[0]);
            var nullTrigger = AgentAuthenticator.CanonicalizeTrigger(null);
            AgentAuthenticator.Hmac(ExpectedSessionKey, AgentAuthenticator.CreateMessage("Job", "0 3 * * *", "dir", actionCanonical, nullTrigger, Ts))
                .Should().Be(ExpectedCreateSig);

            var weekly = new TriggerSpec
            {
                Type = "Weekly",
                StartBoundary = "09:30",
                DaysOfWeek = new List<string> { "Monday", "Wednesday" },
                Repetition = new RepetitionSpec { Interval = "PT30M", Duration = "P1D" }
            };
            var weeklyCanonical = AgentAuthenticator.CanonicalizeTrigger(weekly);
            AgentAuthenticator.Hmac(ExpectedSessionKey, AgentAuthenticator.CreateMessage("Job", "0 3 * * *", "dir", actionCanonical, weeklyCanonical, Ts))
                .Should().Be(ExpectedCreateSigWithTrigger);
        }

        [Fact]
        public void CanonicalizeTrigger_MatchesBackendFormat()
        {
            AgentAuthenticator.CanonicalizeTrigger(null).Should().Be("none");
            AgentAuthenticator.CanonicalizeTrigger(new TriggerSpec
            {
                Type = "Daily",
                StartBoundary = "03:00",
                DaysInterval = 1
            }).Should().Be("trigger|Daily|03:00|1|||");
        }

        [Fact]
        public void CreateHandshakeAuth_ProducesVerifiableFieldsAndSessionKey()
        {
            var auth = new AgentAuthenticator(Secret, AgentId);
            auth.CreateHandshakeAuth();

            // The emitted hmac must recompute from the emitted fields...
            AgentAuthenticator.Hmac(Secret, $"{auth.AgentId}|{auth.Nonce}|{auth.HandshakeTimestamp}")
                .Should().Be(auth.HandshakeHmac);
            // ...and the session key must be derivable from the same nonce.
            auth.SessionKey.Should().Be(AgentAuthenticator.Hmac(Secret, $"session:{auth.Nonce}"));
        }

        [Fact]
        public void VerifyCommand_AcceptsAFreshValidSignature()
        {
            var auth = new AgentAuthenticator(Secret, AgentId);
            auth.CreateHandshakeAuth(); // establishes SessionKey

            var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var msg = AgentAuthenticator.RunMessage("MyTask", ts);
            var sig = AgentAuthenticator.Hmac(auth.SessionKey!, msg);

            auth.VerifyCommand(msg, ts, sig).Should().BeTrue();
        }

        [Fact]
        public void VerifyCommand_RejectsAReplayedSignature()
        {
            var auth = new AgentAuthenticator(Secret, AgentId);
            auth.CreateHandshakeAuth();

            var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var msg = AgentAuthenticator.RunMessage("MyTask", ts);
            var sig = AgentAuthenticator.Hmac(auth.SessionKey!, msg);

            // First use is accepted; the identical (ts, sig) frame is a replay.
            auth.VerifyCommand(msg, ts, sig).Should().BeTrue();
            auth.VerifyCommand(msg, ts, sig).Should().BeFalse();
        }

        [Fact]
        public void VerifyCommand_AcceptsACommandSignedWithThePriorSessionKeyAfterRekey()
        {
            // A reconnect derives a new session key, but a command signed under the
            // previous connection that's still in flight must not be false-rejected.
            var auth = new AgentAuthenticator(Secret, AgentId);
            auth.CreateHandshakeAuth();
            var oldKey = auth.SessionKey!;

            Thread.Sleep(1); // ensure a distinct nonce/key on the next handshake
            auth.CreateHandshakeAuth();
            auth.SessionKey.Should().NotBe(oldKey);

            var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var msg = AgentAuthenticator.RunMessage("MyTask", ts);
            var sigWithOldKey = AgentAuthenticator.Hmac(oldKey, msg);

            auth.VerifyCommand(msg, ts, sigWithOldKey).Should().BeTrue();
        }

        [Fact]
        public void VerifyCommand_RejectsTamperedSignature()
        {
            var auth = new AgentAuthenticator(Secret, AgentId);
            auth.CreateHandshakeAuth();

            var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var msg = AgentAuthenticator.RunMessage("MyTask", ts);

            auth.VerifyCommand(msg, ts, "deadbeef").Should().BeFalse();
        }

        [Fact]
        public void VerifyCommand_RejectsStaleTimestamp()
        {
            var auth = new AgentAuthenticator(Secret, AgentId);
            auth.CreateHandshakeAuth();

            var staleTs = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - 10_000;
            var msg = AgentAuthenticator.RunMessage("MyTask", staleTs);
            var sig = AgentAuthenticator.Hmac(auth.SessionKey!, msg);

            auth.VerifyCommand(msg, staleTs, sig).Should().BeFalse();
        }

        [Fact]
        public void VerifyCommand_RejectsBeforeAnyHandshake()
        {
            var auth = new AgentAuthenticator(Secret, AgentId);
            var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            auth.VerifyCommand(AgentAuthenticator.RunMessage("MyTask", ts), ts, "anything").Should().BeFalse();
        }

        [Fact]
        public void Constructor_RejectsWeakSecret()
        {
            Action tooShort = () => new AgentAuthenticator("short", AgentId);
            tooShort.Should().Throw<ArgumentException>();
        }

        [Fact]
        public void Constructor_DefaultsAgentIdToMachineName()
        {
            var auth = new AgentAuthenticator(Secret, "");
            auth.AgentId.Should().Be(Environment.MachineName);
        }
    }
}
