using System;
using System.Collections.Generic;
using System.Threading;
using Xunit;
using FluentAssertions;
using Cronsole.Agent;

namespace Cronsole.Agent.Tests
{
    public class AgentAuthenticatorTests
    {
        // Golden vector shared with backend/src/ws/__tests__/agentAuth.test.ts.
        // If these diverge, the agent and backend disagree on HMACs and every
        // handshake/command fails — both suites must stay in lockstep.
        private const string Secret = "test-pairing-secret-value";
        private const string AgentId = "test-agent";
        private const string Nonce = "abc123";
        // The PER-COMMAND nonce (distinct job from the handshake Nonce above):
        // it is what makes two otherwise-identical commands in the same second
        // sign differently. Fixed here for determinism; random in production.
        private const string CommandNonce = "d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6";
        private const long Ts = 1700000000;
        private const string ExpectedHandshake = "e8e72a611dac9a8f0b3fab109adea8871b61ca31980efcba7c3ed842d94c0434";
        private const string ExpectedSessionKey = "67d80428fd79e26dd92269f97474031860185d325df6c731cda179e22b53ff14";
        private const string ExpectedRunSig = "40851ae88bea9f403056337d4140852cb6449a9e217533663ce5151949866412";
        private const string ExpectedDeleteSig = "819ee6600758cf5f43fb3ab0be5a5c9f410367c85ee29c1adfb89e772414b87b";
        private const string ExpectedStatusSig = "85f7ee5c3adc3a8d938bc5ddfee7eced0bcd07c695256523e645193e062510dd";
        // task:update_schedule signs the trigger. Golden case: Daily 03:00,
        // daysInterval 1 -> canonical "7:trigger5:Daily5:03:001:10:0:0:".
        private const string ExpectedUpdateScheduleSig = "8aa21aaed0c3bf300265d1c2f8995f165bde73eb8b60ced46f961e8eb725b144";
        // task:update signs the structured action, working dir, description, and run
        // level. Golden case: action { executable: "powershell.exe", args: ["-File",
        // "C:\\x.ps1"] } -> canonical "14:powershell.exe5:-File8:C:\\x.ps1",
        // working dir "C:\\scripts", description "Nightly job", runLevel "highest".
        private const string ExpectedUpdateSig = "15e78eed13b6fb8b908070583439a5bcd8485ab564e2946c24f4fd20e7fb2c60";
        // task:create signs the structured action, the trigger, the folder AND the
        // createFolder flag. Golden action is { executable: "dir", args: [] } ->
        // canonical "3:dir"; trigger null -> "none"; folder "\Cronsole";
        // createFolder false -> "0".
        private const string ExpectedCreateSig = "1f5126aec4472b685cb1cf520a1445ce1b255c71e3d3ef3475a5ced567b26f41";
        // Same command with a Weekly trigger -> canonical
        // "7:trigger6:Weekly5:09:300:16:Monday,Wednesday5:PT30M3:P1D".
        private const string ExpectedCreateSigWithTrigger = "52ae01c77c1065ab16b46b1b745c681789ca13dca5c519bdd6162f43f369fcba";
        // Identical to ExpectedCreateSig except createFolder is TRUE. Pinned as its
        // own case on purpose: with only a false case, an implementation that
        // hard-coded "0" would pass. Two vectors differing in exactly one bit are
        // what prove the bit is genuinely inside the signature.
        private const string ExpectedCreateSigWithFolderCreate = "645ba49ac57da03312b45d3662c3d41bc594fc809faa3538ab533f504f30ea87";
        // task:import signs the task's whole XML BY HASH, plus both blast-radius
        // flags. Golden case: the XML below, overwrite false, createFolders true.
        private const string ImportXml = "<Task><RegistrationInfo><URI>\\Work\\Job</URI></RegistrationInfo></Task>";
        private const string ExpectedImportXmlSha256 = "dfd743c7a30868f6f2d62e3b9ceb16fb77c8a72c1509b1726dfc646072170281";
        private const string ExpectedImportSig = "2b92301b29fd6eda71f48f9672bbbfea78918bc0a2f3c00bdb0608959524ef58";

        [Fact]
        public void Hmac_MatchesGoldenVector_HandshakeAndSession()
        {
            AgentAuthenticator.Hmac(Secret, $"{AgentId}|{Nonce}|{Ts}").Should().Be(ExpectedHandshake);
            AgentAuthenticator.Hmac(Secret, $"session:{Nonce}").Should().Be(ExpectedSessionKey);
        }

        [Fact]
        public void CommandMessages_SignToGoldenVector()
        {
            AgentAuthenticator.Hmac(ExpectedSessionKey, AgentAuthenticator.RunMessage("MyTask", CommandNonce, Ts))
                .Should().Be(ExpectedRunSig);
            AgentAuthenticator.Hmac(ExpectedSessionKey, AgentAuthenticator.DeleteMessage("MyTask", CommandNonce, Ts))
                .Should().Be(ExpectedDeleteSig);
            AgentAuthenticator.Hmac(ExpectedSessionKey, AgentAuthenticator.SetStatusMessage("MyTask", false, CommandNonce, Ts))
                .Should().Be(ExpectedStatusSig);
            var dailyTrigger = new TriggerSpec { Type = "Daily", StartBoundary = "03:00", DaysInterval = 1 };
            AgentAuthenticator.Hmac(ExpectedSessionKey,
                AgentAuthenticator.UpdateScheduleMessage("MyTask", AgentAuthenticator.CanonicalizeTrigger(dailyTrigger), CommandNonce, Ts))
                .Should().Be(ExpectedUpdateScheduleSig);
            var updateAction = AgentAuthenticator.CanonicalizeAction("powershell.exe", new[] { "-File", "C:\\x.ps1" });
            AgentAuthenticator.Hmac(ExpectedSessionKey,
                AgentAuthenticator.UpdateMessage("MyTask", updateAction, "C:\\scripts", "Nightly job", "highest", CommandNonce, Ts))
                .Should().Be(ExpectedUpdateSig);

            var actionCanonical = AgentAuthenticator.CanonicalizeAction("dir", new string[0]);
            var nullTrigger = AgentAuthenticator.CanonicalizeTrigger(null);
            AgentAuthenticator.Hmac(ExpectedSessionKey, AgentAuthenticator.CreateMessage("Job", "0 3 * * *", "dir", actionCanonical, nullTrigger, "\\Cronsole", false, CommandNonce, Ts))
                .Should().Be(ExpectedCreateSig);

            // Same inputs, createFolder flipped — proves the flag is signed.
            AgentAuthenticator.Hmac(ExpectedSessionKey, AgentAuthenticator.CreateMessage("Job", "0 3 * * *", "dir", actionCanonical, nullTrigger, "\\Cronsole", true, CommandNonce, Ts))
                .Should().Be(ExpectedCreateSigWithFolderCreate);

            var weekly = new TriggerSpec
            {
                Type = "Weekly",
                StartBoundary = "09:30",
                DaysOfWeek = new List<string> { "Monday", "Wednesday" },
                Repetition = new RepetitionSpec { Interval = "PT30M", Duration = "P1D" }
            };
            var weeklyCanonical = AgentAuthenticator.CanonicalizeTrigger(weekly);
            AgentAuthenticator.Hmac(ExpectedSessionKey, AgentAuthenticator.CreateMessage("Job", "0 3 * * *", "dir", actionCanonical, weeklyCanonical, "\\Cronsole", false, CommandNonce, Ts))
                .Should().Be(ExpectedCreateSigWithTrigger);

            AgentAuthenticator.Hmac(ExpectedSessionKey,
                AgentAuthenticator.ImportMessage("MyTask", AgentAuthenticator.Sha256Hex(ImportXml), false, true, CommandNonce, Ts))
                .Should().Be(ExpectedImportSig);
        }

        // Pinned separately from the signature so a mismatch says WHICH half moved:
        // the digest agreement between .NET and Node, or the message format around it.
        [Fact]
        public void Sha256Hex_MatchesBackendDigest()
        {
            AgentAuthenticator.Sha256Hex(ImportXml).Should().Be(ExpectedImportXmlSha256);
            // Lowercase hex, like Node's digest('hex') — an uppercase digest would
            // verify against nothing while looking correct in a log.
            AgentAuthenticator.Sha256Hex("").Should()
                .Be("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        }

        // The XML is the task: its action, its trigger, and the account it runs as.
        // If any of these three were outside the signed message, an on-path attacker
        // could keep the path intact and change what actually gets registered.
        [Fact]
        public void ImportMessage_CoversTheXmlAndBothFlags()
        {
            var hash = AgentAuthenticator.Sha256Hex(ImportXml);
            var baseline = AgentAuthenticator.ImportMessage("MyTask", hash, false, true, CommandNonce, Ts);

            AgentAuthenticator.ImportMessage("MyTask", AgentAuthenticator.Sha256Hex(ImportXml + " "), false, true, CommandNonce, Ts)
                .Should().NotBe(baseline);
            AgentAuthenticator.ImportMessage("MyTask", hash, true, true, CommandNonce, Ts).Should().NotBe(baseline);
            AgentAuthenticator.ImportMessage("MyTask", hash, false, false, CommandNonce, Ts).Should().NotBe(baseline);
            AgentAuthenticator.ImportMessage("Other", hash, false, true, CommandNonce, Ts).Should().NotBe(baseline);
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
            }).Should().Be("7:trigger5:Daily5:03:001:10:0:0:");

            // Monthly appends an eighth field; every other type must NOT, or a
            // create signed by one side of this change fails against the other.
            AgentAuthenticator.CanonicalizeTrigger(new TriggerSpec
            {
                Type = "Monthly",
                StartBoundary = "09:00",
                DaysOfMonth = new List<int> { 1, 15 }
            }).Should().Be("7:trigger7:Monthly5:09:000:0:0:0:4:1,15");
        }

        [Fact]
        public void Frame_KeepsFieldBoundaries_WhereAPipeJoinCouldNot()
        {
            // The literal the backend's frameFields produces for the same fields.
            AgentAuthenticator.RunMessage("MyTask", CommandNonce, Ts)
                .Should().Be("8:task:run6:MyTask32:d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a610:1700000000");

            // Under wire protocol 1 each pair below was one pipe-joined string,
            // so one signature covered two different commands.
            AgentAuthenticator.UpdateMessage("T", "x", "a|b", "c", "least", CommandNonce, Ts)
                .Should().NotBe(AgentAuthenticator.UpdateMessage("T", "x", "a", "b|c", "least", CommandNonce, Ts));
            AgentAuthenticator.CanonicalizeAction("x", new[] { "a", "b" })
                .Should().NotBe(AgentAuthenticator.CanonicalizeAction("x", new[] { "a\u001fb" }));
            AgentAuthenticator.CanonicalizeAction("x", new[] { "1:a" })
                .Should().NotBe(AgentAuthenticator.CanonicalizeAction("x", new[] { "", "a" }));
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
        public void CreateHandshakeAuth_AnnouncesTheWireVersion()
        {
            // The backend reads this before it signs anything, and refuses to
            // sign for an agent that does not say the version it speaks.
            var payload = new AgentAuthenticator(Secret, AgentId).CreateHandshakeAuth();
            System.Text.Json.JsonSerializer.SerializeToElement(payload)
                .GetProperty("protocolVersion").GetInt32().Should().Be(AgentService.ProtocolVersion);
        }

        [Fact]
        public void VerifyCommand_AcceptsAFreshValidSignature()
        {
            var auth = new AgentAuthenticator(Secret, AgentId);
            auth.CreateHandshakeAuth(); // establishes SessionKey

            var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var msg = AgentAuthenticator.RunMessage("MyTask", CommandNonce, ts);
            var sig = AgentAuthenticator.Hmac(auth.SessionKey!, msg);

            auth.VerifyCommand(msg, ts, sig).Should().BeTrue();
        }

        [Fact]
        public void VerifyCommand_RejectsAReplayedSignature()
        {
            var auth = new AgentAuthenticator(Secret, AgentId);
            auth.CreateHandshakeAuth();

            var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var msg = AgentAuthenticator.RunMessage("MyTask", CommandNonce, ts);
            var sig = AgentAuthenticator.Hmac(auth.SessionKey!, msg);

            // First use is accepted; the identical (ts, sig) frame is a replay.
            auth.VerifyCommand(msg, ts, sig).Should().BeTrue();
            auth.VerifyCommand(msg, ts, sig).Should().BeFalse();
        }

        // Regression for troubleshooting #16. `ts` is second-granular, so before
        // the per-command nonce two legitimate identical commands inside one
        // second built the SAME message and therefore the SAME signature — the
        // replay guard could not tell them from a captured frame and silently
        // dropped the second. The server then timed out and reported "Agent
        // trigger timeout", blaming the transport. Symptom: double-clicking Run
        // Now hangs 15s; a second later the same click works.
        [Fact]
        public void VerifyCommand_AcceptsTwoDistinctCommandsWithinTheSameSecond()
        {
            var auth = new AgentAuthenticator(Secret, AgentId);
            auth.CreateHandshakeAuth();

            // Same task, same second — only the nonce differs, exactly as two
            // real back-to-back runs would.
            var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var first = AgentAuthenticator.RunMessage("MyTask", new string('a', 32), ts);
            var second = AgentAuthenticator.RunMessage("MyTask", new string('b', 32), ts);

            auth.VerifyCommand(first, ts, AgentAuthenticator.Hmac(auth.SessionKey!, first))
                .Should().BeTrue();
            auth.VerifyCommand(second, ts, AgentAuthenticator.Hmac(auth.SessionKey!, second))
                .Should().BeTrue("a legitimate second command in the same second is not a replay");
        }

        [Fact]
        public void RunMessage_WithDifferentNonces_ProducesDifferentMessages()
        {
            // The property the replay guard depends on. If this ever collapses,
            // #16 is back and the guard silently starts eating real commands.
            var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            AgentAuthenticator.RunMessage("MyTask", new string('a', 32), ts)
                .Should().NotBe(AgentAuthenticator.RunMessage("MyTask", new string('b', 32), ts));
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
            var msg = AgentAuthenticator.RunMessage("MyTask", CommandNonce, ts);
            var sigWithOldKey = AgentAuthenticator.Hmac(oldKey, msg);

            auth.VerifyCommand(msg, ts, sigWithOldKey).Should().BeTrue();
        }

        [Fact]
        public void VerifyCommand_RejectsTamperedSignature()
        {
            var auth = new AgentAuthenticator(Secret, AgentId);
            auth.CreateHandshakeAuth();

            var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var msg = AgentAuthenticator.RunMessage("MyTask", CommandNonce, ts);

            auth.VerifyCommand(msg, ts, "deadbeef").Should().BeFalse();
        }

        [Fact]
        public void VerifyCommand_RejectsStaleTimestamp()
        {
            var auth = new AgentAuthenticator(Secret, AgentId);
            auth.CreateHandshakeAuth();

            var staleTs = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - 10_000;
            var msg = AgentAuthenticator.RunMessage("MyTask", CommandNonce, staleTs);
            var sig = AgentAuthenticator.Hmac(auth.SessionKey!, msg);

            auth.VerifyCommand(msg, staleTs, sig).Should().BeFalse();
        }

        [Fact]
        public void VerifyCommand_RejectsBeforeAnyHandshake()
        {
            var auth = new AgentAuthenticator(Secret, AgentId);
            var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            auth.VerifyCommand(AgentAuthenticator.RunMessage("MyTask", CommandNonce, ts), ts, "anything").Should().BeFalse();
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
