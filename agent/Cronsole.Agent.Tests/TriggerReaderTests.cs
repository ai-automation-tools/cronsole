using System;
using FluentAssertions;
using Microsoft.Win32.TaskScheduler;
using Cronsole.Agent;
using Xunit;

namespace Cronsole.Agent.Tests
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
        public void Monthly_ReadsDaysOfMonth()
        {
            var spec = TriggerReader.Read(new MonthlyTrigger
            {
                StartBoundary = Utc(9, 0),
                DaysOfMonth = new[] { 1, 15 },
                MonthsOfYear = MonthsOfTheYear.AllMonths
            });

            spec.Should().NotBeNull();
            spec!.Type.Should().Be("Monthly");
            spec.StartBoundary.Should().Be("09:00");
            spec.DaysOfMonth.Should().Equal(new[] { 1, 15 });
        }

        [Fact]
        public void Monthly_WithRestrictedMonthsIsUnreadable()
        {
            // "Every January the 1st" has no 5-field cron here — TriggerSpec
            // carries no month field — so it stays scheduleless rather than being
            // reported as "the 1st of every month", which runs 12x as often.
            var spec = TriggerReader.Read(new MonthlyTrigger
            {
                StartBoundary = Utc(9, 0),
                DaysOfMonth = new[] { 1 },
                MonthsOfYear = MonthsOfTheYear.January
            });

            spec.Should().BeNull();
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

        [Theory]
        // +1: a trigger whose UTC time crossed midnight forward (e.g. Sun 23:45
        // PDT -> Mon 06:45 UTC) must report the next day.
        [InlineData("Sunday", 1, "Monday")]
        [InlineData("Saturday", 1, "Sunday")]   // wraps around the week
        // -1: an early-morning trigger in a UTC+ zone falls on the previous UTC day.
        [InlineData("Monday", -1, "Sunday")]
        [InlineData("Sunday", -1, "Saturday")]  // wraps the other way
        [InlineData("Wednesday", 0, "Wednesday")]
        public void ShiftDayName_RollsWithWraparound(string input, int shift, string expected)
        {
            TriggerReader.ShiftDayName(input, shift).Should().Be(expected);
        }

        [Fact]
        public void Weekly_UtcKindBoundary_KeepsDayOfWeek()
        {
            // A UTC-kind boundary converts as identity, so no day roll happens.
            var spec = TriggerReader.Read(new WeeklyTrigger
            {
                StartBoundary = Utc(6, 45),
                DaysOfWeek = DaysOfTheWeek.Sunday
            });
            spec!.DaysOfWeek.Should().Equal("Sunday");
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
