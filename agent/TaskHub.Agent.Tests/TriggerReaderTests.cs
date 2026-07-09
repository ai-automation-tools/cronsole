using System;
using FluentAssertions;
using Microsoft.Win32.TaskScheduler;
using TaskHub.Agent;
using Xunit;

namespace TaskHub.Agent.Tests
{
    public class TriggerReaderTests
    {
        // Use UTC-kind boundaries so the local→UTC conversion is an identity and
        // the tests don't depend on the runner's timezone.
        private static DateTime Utc(int hour, int minute) =>
            DateTime.SpecifyKind(new DateTime(2026, 1, 1, hour, minute, 0), DateTimeKind.Utc);

        [Fact]
        public void Daily_ReadsTypeAndUtcStart()
        {
            var spec = TriggerReader.Read(new DailyTrigger
            {
                StartBoundary = Utc(3, 0),
                DaysInterval = 2
            });

            spec.Should().NotBeNull();
            spec!.Type.Should().Be("Daily");
            spec.StartBoundary.Should().Be("03:00");
            spec.DaysInterval.Should().Be(2);
            spec.Repetition.Should().BeNull();
        }

        [Fact]
        public void Weekly_ReadsDaysOfWeek()
        {
            var spec = TriggerReader.Read(new WeeklyTrigger
            {
                StartBoundary = Utc(8, 0),
                DaysOfWeek = DaysOfTheWeek.Monday | DaysOfTheWeek.Friday
            });

            spec.Should().NotBeNull();
            spec!.Type.Should().Be("Weekly");
            spec.StartBoundary.Should().Be("08:00");
            spec.DaysOfWeek.Should().Equal("Monday", "Friday");
        }

        [Fact]
        public void Time_WithRepetition_ReadsIso8601Interval()
        {
            var trigger = new TimeTrigger { StartBoundary = Utc(0, 0) };
            trigger.Repetition.Interval = TimeSpan.FromMinutes(30);

            var spec = TriggerReader.Read(trigger);

            spec.Should().NotBeNull();
            spec!.Type.Should().Be("Time");
            spec.Repetition.Should().NotBeNull();
            spec.Repetition!.Interval.Should().Be("PT30M");
        }

        [Fact]
        public void UnsupportedTrigger_ReturnsNull()
        {
            // Boot/logon/monthly/event triggers aren't expressible as 5-field cron.
            TriggerReader.Read(new BootTrigger()).Should().BeNull();
        }

        [Fact]
        public void RoundTrips_ThroughTriggerBuilder()
        {
            // A spec built into a Task Scheduler trigger should read back equal.
            var original = new TriggerSpec { Type = "Daily", StartBoundary = "06:30", DaysInterval = 1 };
            var built = TriggerBuilder.Build(original);

            var readBack = TriggerReader.Read(built);

            readBack.Should().NotBeNull();
            readBack!.Type.Should().Be("Daily");
            readBack.StartBoundary.Should().Be("06:30");
        }
    }
}
