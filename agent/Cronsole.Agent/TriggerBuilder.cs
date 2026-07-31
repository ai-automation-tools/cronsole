using System;
using System.Collections.Generic;
using System.Globalization;
using System.Xml;
using Microsoft.Win32.TaskScheduler;

namespace Cronsole.Agent
{
    /// <summary>
    /// Translates a server TriggerSpec (UTC times, ISO-8601 intervals) into a
    /// Task Scheduler trigger in local time.
    /// </summary>
    public static class TriggerBuilder
    {
        public static Trigger Build(TriggerSpec spec)
        {
            if (spec == null) throw new ArgumentNullException(nameof(spec));

            var utcTime = ParseTimeOfDay(spec.StartBoundary);

            switch (spec.Type)
            {
                case "Daily":
                {
                    var trigger = new DailyTrigger
                    {
                        StartBoundary = UtcTimeToLocalToday(utcTime),
                        DaysInterval = (short)(spec.DaysInterval ?? 1)
                    };
                    ApplyRepetition(trigger, spec.Repetition);
                    return trigger;
                }

                case "Weekly":
                {
                    if (spec.DaysOfWeek == null || spec.DaysOfWeek.Count == 0)
                        throw new ArgumentException("Weekly trigger requires daysOfWeek.");

                    // The UTC day/time pair can land on a different local day
                    // (e.g. Sunday 00:30 UTC is Saturday evening in the US), so
                    // resolve the next UTC occurrence and convert the whole
                    // datetime, day included — for *every* day the server sent.
                    // A weekly cron routinely names several ("0 9 * * 1-5"), and
                    // keeping only the first would run a weekday task on Mondays
                    // alone while the server still reported Mon-Fri.
                    var localStarts = new List<DateTime>();
                    foreach (var dayName in spec.DaysOfWeek)
                    {
                        localStarts.Add(NextUtcOccurrenceAsLocal(dayName, utcTime));
                    }

                    // OR the flags together; a day named twice collapses to one.
                    DaysOfTheWeek days = 0;
                    var earliest = localStarts[0];
                    foreach (var localStart in localStarts)
                    {
                        days |= ToDaysOfTheWeek(localStart.DayOfWeek);
                        if (localStart < earliest) earliest = localStart;
                    }

                    // All the occurrences share a local time-of-day, so the
                    // earliest one anchors the boundary and the mask carries the rest.
                    var trigger = new WeeklyTrigger
                    {
                        StartBoundary = earliest,
                        DaysOfWeek = days
                    };
                    ApplyRepetition(trigger, spec.Repetition);
                    return trigger;
                }

                case "Time":
                {
                    // Interval schedules (e.g. */30 * * * *) arrive as Time
                    // triggers with a P1D repetition window. A one-shot
                    // TimeTrigger would stop repeating after that window, so
                    // register a daily trigger that restarts the repetition
                    // pattern every day.
                    if (spec.Repetition != null)
                    {
                        var trigger = new DailyTrigger
                        {
                            StartBoundary = UtcTimeToLocalToday(utcTime),
                            DaysInterval = 1
                        };
                        ApplyRepetition(trigger, spec.Repetition);
                        return trigger;
                    }
                    return new TimeTrigger { StartBoundary = UtcTimeToLocalToday(utcTime) };
                }

                default:
                    throw new ArgumentException($"Unsupported trigger type '{spec.Type}'.");
            }
        }

        private static void ApplyRepetition(Trigger trigger, RepetitionSpec? repetition)
        {
            if (repetition == null || string.IsNullOrWhiteSpace(repetition.Interval)) return;

            trigger.Repetition.Interval = XmlConvert.ToTimeSpan(repetition.Interval);
            if (!string.IsNullOrWhiteSpace(repetition.Duration))
            {
                trigger.Repetition.Duration = XmlConvert.ToTimeSpan(repetition.Duration);
            }
        }

        private static TimeSpan ParseTimeOfDay(string startBoundary)
        {
            if (TimeSpan.TryParseExact(startBoundary, @"hh\:mm", CultureInfo.InvariantCulture, out var time))
            {
                return time;
            }
            throw new ArgumentException($"Invalid startBoundary '{startBoundary}' (expected HH:mm).");
        }

        private static DateTime UtcTimeToLocalToday(TimeSpan utcTime)
        {
            var utc = DateTime.SpecifyKind(DateTime.UtcNow.Date.Add(utcTime), DateTimeKind.Utc);
            return utc.ToLocalTime();
        }

        private static DateTime NextUtcOccurrenceAsLocal(string dayName, TimeSpan utcTime)
        {
            if (!Enum.TryParse<DayOfWeek>(dayName, true, out var targetDay))
                throw new ArgumentException($"Invalid day of week '{dayName}'.");

            var candidate = DateTime.SpecifyKind(DateTime.UtcNow.Date.Add(utcTime), DateTimeKind.Utc);
            while (candidate.DayOfWeek != targetDay || candidate < DateTime.UtcNow)
            {
                candidate = candidate.AddDays(1);
            }
            return candidate.ToLocalTime();
        }

        private static DaysOfTheWeek ToDaysOfTheWeek(DayOfWeek day) => day switch
        {
            DayOfWeek.Sunday => DaysOfTheWeek.Sunday,
            DayOfWeek.Monday => DaysOfTheWeek.Monday,
            DayOfWeek.Tuesday => DaysOfTheWeek.Tuesday,
            DayOfWeek.Wednesday => DaysOfTheWeek.Wednesday,
            DayOfWeek.Thursday => DaysOfTheWeek.Thursday,
            DayOfWeek.Friday => DaysOfTheWeek.Friday,
            DayOfWeek.Saturday => DaysOfTheWeek.Saturday,
            _ => throw new ArgumentOutOfRangeException(nameof(day))
        };
    }
}
