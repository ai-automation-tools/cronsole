using System;
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
        private const string ExpectedStatusSig = "9a01e71e17bba19ffadfa229be77c04d85ec4b92f2493cff9b1b107f13075133";
        private const string ExpectedCreateSig = "39a370b5efc02f6ca0b854e96bce9413ce56b14f13e96ece0ce19592bec315fc";

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
            AgentAuthenticator.Hmac(ExpectedSessionKey, AgentAuthenticator.SetStatusMessage("MyTask", false, Ts))
                .Should().Be(ExpectedStatusSig);
            AgentAuthenticator.Hmac(ExpectedSessionKey, AgentAuthenticator.CreateMessage("Job", "0 3 * * *", "dir", Ts))
                .Should().Be(ExpectedCreateSig);
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
