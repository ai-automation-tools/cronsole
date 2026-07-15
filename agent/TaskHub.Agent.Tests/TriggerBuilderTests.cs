using System;
using System.Collections.Generic;
using FluentAssertions;
using Microsoft.Win32.TaskScheduler;
using TaskHub.Agent;
using Xunit;

namespace TaskHub.Agent.Tests
{
    public class TriggerBuilderTests
    {
        private static DateTime ExpectedLocalToday(string utcHhMm)
        {
            var time = TimeSpan.Parse(utcHhMm);
            return DateTime.SpecifyKind(DateTime.UtcNow.Date.Add(time), DateTimeKind.Utc).ToLocalTime();
        }

        [Fact]
        public void Daily_BuildsDailyTriggerAtLocalTime()
        {
            var trigger = TriggerBuilder.Build(new TriggerSpec
            {
                Type = "Daily",
                StartBoundary = "03:00",
                DaysInterval = 1
            });

            var daily = trigger.Should().BeOfType<DailyTrigger>().Subject;
            daily.DaysInterval.Should().Be(1);
            daily.StartBoundary.TimeOfDay.Should().Be(ExpectedLocalToday("03:00").TimeOfDay);
        }

        [Fact]
        public void Weekly_BuildsWeeklyTriggerOnConvertedLocalDay()
        {
            var trigger = TriggerBuilder.Build(new TriggerSpec
            {
                Type = "Weekly",
                StartBoundary = "08:00",
                DaysOfWeek = new List<string> { "Monday" }
            });

            var weekly = trigger.Should().BeOfType<WeeklyTrigger>().Subject;
            // The trigger day must match the local day of the converted start
            // boundary (UTC Monday 08:00 can be Sunday or Monday locally).
            weekly.StartBoundary.DayOfWeek.ToString().Should().Be(weekly.DaysOfWeek.ToString());
            weekly.StartBoundary.Should().BeOnOrAfter(DateTime.Now.AddDays(-1));
        }

        [Fact]
        public void Weekly_WithSeveralDays_KeepsEveryDay()
        {
            // The server sends every day a weekly cron names ("0 9 * * 1-5" =>
            // Monday..Friday). Registering only the first would run a weekday task
            // on Mondays alone, while the dashboard still claims Mon-Fri.
            var trigger = TriggerBuilder.Build(new TriggerSpec
            {
                Type = "Weekly",
                StartBoundary = "08:00",
                DaysOfWeek = new List<string> { "Monday", "Wednesday", "Friday" }
            });

            var weekly = trigger.Should().BeOfType<WeeklyTrigger>().Subject;

            // Each UTC day converts to local independently, but they all shift by
            // the same amount, so exactly three distinct days must survive.
            var days = weekly.DaysOfWeek.ToString().Split(", ", StringSplitOptions.RemoveEmptyEntries);
            days.Should().HaveCount(3);

            // The start boundary must be one of the days in the mask, and upcoming.
            days.Should().Contain(weekly.StartBoundary.DayOfWeek.ToString());
            weekly.StartBoundary.Should().BeOnOrAfter(DateTime.Now.AddDays(-1));
        }

        [Fact]
        public void Weekly_WithDuplicateDays_DoesNotDoubleRegisterADay()
        {
            var trigger = TriggerBuilder.Build(new TriggerSpec
            {
                Type = "Weekly",
                StartBoundary = "08:00",
                DaysOfWeek = new List<string> { "Tuesday", "Tuesday" }
            });

            var weekly = trigger.Should().BeOfType<WeeklyTrigger>().Subject;
            weekly.DaysOfWeek.ToString().Split(", ", StringSplitOptions.RemoveEmptyEntries)
                .Should().HaveCount(1);
        }

        [Fact]
        public void Weekly_WithUnknownDay_ThrowsRatherThanSkippingIt()
        {
            var act = () => TriggerBuilder.Build(new TriggerSpec
            {
                Type = "Weekly",
                StartBoundary = "08:00",
                DaysOfWeek = new List<string> { "Monday", "Funday" }
            });
            act.Should().Throw<ArgumentException>();
        }

        [Fact]
        public void TimeWithRepetition_BuildsDailyTriggerSoRepetitionRecurs()
        {
            var trigger = TriggerBuilder.Build(new TriggerSpec
            {
                Type = "Time",
                StartBoundary = "00:00",
                Repetition = new RepetitionSpec { Interval = "PT30M", Duration = "P1D" }
            });

            // A one-shot TimeTrigger would stop repeating after the P1D window;
            // interval schedules must be registered as daily triggers.
            var daily = trigger.Should().BeOfType<DailyTrigger>().Subject;
            daily.Repetition.Interval.Should().Be(TimeSpan.FromMinutes(30));
            daily.Repetition.Duration.Should().Be(TimeSpan.FromDays(1));
        }

        [Fact]
        public void TimeWithHourlyRepetition_ParsesIsoInterval()
        {
            var trigger = TriggerBuilder.Build(new TriggerSpec
            {
                Type = "Time",
                StartBoundary = "00:15",
                Repetition = new RepetitionSpec { Interval = "PT6H", Duration = "P1D" }
            });

            trigger.Repetition.Interval.Should().Be(TimeSpan.FromHours(6));
        }

        [Fact]
        public void TimeWithoutRepetition_BuildsOneShotTimeTrigger()
        {
            var trigger = TriggerBuilder.Build(new TriggerSpec
            {
                Type = "Time",
                StartBoundary = "12:00"
            });

            trigger.Should().BeOfType<TimeTrigger>();
        }

        [Fact]
        public void Weekly_WithoutDays_Throws()
        {
            var act = () => TriggerBuilder.Build(new TriggerSpec { Type = "Weekly", StartBoundary = "08:00" });
            act.Should().Throw<ArgumentException>().WithMessage("*daysOfWeek*");
        }

        [Fact]
        public void UnknownType_Throws()
        {
            var act = () => TriggerBuilder.Build(new TriggerSpec { Type = "Monthly", StartBoundary = "08:00" });
            act.Should().Throw<ArgumentException>().WithMessage("*Unsupported trigger type*");
        }

        [Fact]
        public void InvalidStartBoundary_Throws()
        {
            var act = () => TriggerBuilder.Build(new TriggerSpec { Type = "Daily", StartBoundary = "8am" });
            act.Should().Throw<ArgumentException>().WithMessage("*startBoundary*");
        }
    }
}
