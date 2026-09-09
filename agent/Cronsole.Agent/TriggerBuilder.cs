using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
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
        /// <param name="zone">
        /// The zone UTC boundaries are converted into. Defaults to the machine's,
        /// which is the only value production ever passes; it is a parameter so a
        /// test can pin a zone instead of asserting whatever the runner happens to
        /// be in. The Monthly arm below is the one that genuinely behaves
        /// differently by offset, so it needs a way to be tested at one.
        /// </param>
        public static Trigger Build(TriggerSpec spec, TimeZoneInfo? zone = null)
        {
            if (spec == null) throw new ArgumentNullException(nameof(spec));

            zone ??= TimeZoneInfo.Local;
            var utcTime = ParseTimeOfDay(spec.StartBoundary);

            switch (spec.Type)
            {
                case "Daily":
                {
                    var trigger = new DailyTrigger
                    {
                        StartBoundary = UtcTimeToLocalToday(utcTime, zone),
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
                        localStarts.Add(NextUtcOccurrenceAsLocal(dayName, utcTime, zone));
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

                case "Monthly":
                {
                    if (spec.DaysOfMonth == null || spec.DaysOfMonth.Count == 0)
                        throw new ArgumentException("Monthly trigger requires daysOfMonth.");

                    // A monthly day-of-month does NOT survive a UTC->local day
                    // roll the way a weekday does. Weekly can shift Sunday to
                    // Saturday because a week is always 7 days; a month is not
                    // always the same length, so "UTC day 1" is local day 31 in
                    // January, 28 in March, and 30 in May. There is no single
                    // DaysOfMonth value that means all three, and picking one
                    // would run the task on the wrong date for eleven months of
                    // the year while Cronsole reported the cron it was given.
                    //
                    // So the only exact case is the one with no day roll at all,
                    // and every other is refused by name rather than approximated.
                    // The user's fix is a local time that stays on the same date,
                    // which the message says.
                    var localStart = UtcTimeToLocalToday(utcTime, zone);
                    var utcToday = DateTime.SpecifyKind(DateTime.UtcNow.Date.Add(utcTime), DateTimeKind.Utc);
                    if (localStart.Date != utcToday.Date)
                    {
                        throw new ArgumentException(
                            $"A monthly schedule at {spec.StartBoundary} UTC falls on a different " +
                            "calendar day in this machine's local time, and a Windows monthly " +
                            "trigger fires on a fixed day of the month - which would be the wrong " +
                            "date in months of a different length. Pick a time of day that stays " +
                            "on the same local date.");
                    }

                    foreach (var day in spec.DaysOfMonth)
                    {
                        if (day < 1 || day > 31)
                            throw new ArgumentException($"Invalid day of month '{day}' (expected 1-31).");
                    }

                    var monthly = new MonthlyTrigger
                    {
                        StartBoundary = localStart,
                        DaysOfMonth = spec.DaysOfMonth.Distinct().OrderBy(d => d).ToArray(),
                        MonthsOfYear = MonthsOfTheYear.AllMonths
                    };
                    ApplyRepetition(monthly, spec.Repetition);
                    return monthly;
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
                            StartBoundary = UtcTimeToLocalToday(utcTime, zone),
                            DaysInterval = 1
                        };
                        ApplyRepetition(trigger, spec.Repetition);
                        return trigger;
                    }
                    return new TimeTrigger { StartBoundary = UtcTimeToLocalToday(utcTime, zone) };
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

        private static DateTime UtcTimeToLocalToday(TimeSpan utcTime, TimeZoneInfo zone)
        {
            var utc = DateTime.SpecifyKind(DateTime.UtcNow.Date.Add(utcTime), DateTimeKind.Utc);
            return TimeZoneInfo.ConvertTimeFromUtc(utc, zone);
        }

        private static DateTime NextUtcOccurrenceAsLocal(string dayName, TimeSpan utcTime, TimeZoneInfo zone)
        {
            if (!Enum.TryParse<DayOfWeek>(dayName, true, out var targetDay))
                throw new ArgumentException($"Invalid day of week '{dayName}'.");

            var candidate = DateTime.SpecifyKind(DateTime.UtcNow.Date.Add(utcTime), DateTimeKind.Utc);
            while (candidate.DayOfWeek != targetDay || candidate < DateTime.UtcNow)
            {
                candidate = candidate.AddDays(1);
            }
            return TimeZoneInfo.ConvertTimeFromUtc(candidate, zone);
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
