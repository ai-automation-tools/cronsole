using System;
using Xunit;
using FluentAssertions;
using Cronsole.Agent;

namespace Cronsole.Agent.Tests
{
    public class ConnectionLivenessTests
    {
        private long _now = 1_000_000;

        private ConnectionLiveness Create(int windowSeconds = 60) =>
            new(TimeSpan.FromSeconds(windowSeconds), () => _now);

        [Fact]
        public void FreshlyCreated_IsNotStale()
        {
            Create().IsStale.Should().BeFalse();
        }

        [Fact]
        public void NoPingWithinWindow_IsStale()
        {
            // The backend-restart case: the library never noticed the Close frame,
            // so no pings arrive and nothing else flips the flag.
            var liveness = Create();
            _now += 61_000;
            liveness.IsStale.Should().BeTrue();
        }

        [Fact]
        public void ExactlyAtWindow_IsNotStale()
        {
            var liveness = Create();
            _now += 60_000;
            liveness.IsStale.Should().BeFalse();
        }

        [Fact]
        public void RegularPings_KeepItLive()
        {
            // Socket.IO's default pingInterval is 25s.
            var liveness = Create();
            for (int i = 0; i < 10; i++)
            {
                _now += 25_000;
                liveness.Touch();
                liveness.IsStale.Should().BeFalse();
            }
        }

        [Fact]
        public void Touch_AfterGoingStale_RestoresLiveness()
        {
            var liveness = Create();
            _now += 120_000;
            liveness.IsStale.Should().BeTrue();

            liveness.Touch();
            liveness.IsStale.Should().BeFalse();
        }

        [Fact]
        public void DefaultWindow_ExceedsSocketIoPingIntervalPlusTimeout()
        {
            // Must outlast pingInterval (25s) + pingTimeout (20s), or a healthy
            // connection would be torn down between pings.
            ConnectionLiveness.DefaultWindow.Should().BeGreaterThan(TimeSpan.FromSeconds(45));
        }
    }
}
