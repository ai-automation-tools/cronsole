using System;
using System.Collections.Generic;
using System.Xml;
using Microsoft.Win32.TaskScheduler;

namespace Cronsole.Agent
{
    /// <summary>
    /// Reads a Task Scheduler trigger into a server-shaped <see cref="TriggerSpec"/>
    /// (UTC "HH:mm" start, ISO-8601 repetition). The inverse of <see cref="TriggerBuilder"/>.
    /// Returns null for trigger types the server can't express as a 5-field cron
    /// (boot, logon, monthly, event, …) — those stay honestly scheduleless.
    /// </summary>
    public static class TriggerReader
    {
        public static TriggerSpec? Read(Trigger trigger)
        {
            switch (trigger)
            {
                case null:
                    return null;

                case DailyTrigger daily:
                    return new TriggerSpec
                    {
                        Type = "Daily",
                        StartBoundary = ToUtcHhmm(daily.StartBoundary),
                        DaysInterval = daily.DaysInterval,
                        Repetition = ReadRepetition(daily.Repetition)
                    };

                case WeeklyTrigger weekly:
                    return new TriggerSpec
                    {
                        Type = "Weekly",
                        StartBoundary = ToUtcHhmm(weekly.StartBoundary),
                        // Roll the day by the same local->UTC shift as the time, so a
                        // late-evening trigger that crosses midnight in UTC reports the
                        // correct UTC day (e.g. Sun 23:45 PDT = Mon 06:45 UTC).
                        DaysOfWeek = ToDayNames(weekly.DaysOfWeek, UtcDayShift(weekly.StartBoundary)),
                        Repetition = ReadRepetition(weekly.Repetition)
                    };

                case MonthlyTrigger monthly:
                    // Only the exactly-expressible shape is read; everything else
                    // is null, which the server renders as "no direct schedule".
                    // A monthly trigger has three ways of meaning something a
                    // 5-field cron cannot say, and reporting any of them as
                    // "M H D * *" would put a schedule on the dashboard that the
                    // task does not have:
                    //   - restricted months (every January) - cron's month field
                    //     has no home in TriggerSpec, by design;
                    //   - the last day of the month - cron's 'L' is refused at
                    //     the other end of this converter;
                    //   - a local start that lands on a different UTC calendar
                    //     day, where no fixed day-of-month is right in every
                    //     month. See TriggerBuilder for why the week's trick of
                    //     rolling the day does not work here.
                    if (monthly.RunOnLastDayOfMonth) return null;
                    if (monthly.MonthsOfYear != MonthsOfTheYear.AllMonths) return null;
                    if (UtcDayShift(monthly.StartBoundary) != 0) return null;
                    if (monthly.DaysOfMonth == null || monthly.DaysOfMonth.Length == 0) return null;
                    return new TriggerSpec
                    {
                        Type = "Monthly",
                        StartBoundary = ToUtcHhmm(monthly.StartBoundary),
                        DaysOfMonth = new List<int>(monthly.DaysOfMonth),
                        Repetition = ReadRepetition(monthly.Repetition)
                    };

                case TimeTrigger time:
                    return new TriggerSpec
                    {
                        Type = "Time",
                        StartBoundary = ToUtcHhmm(time.StartBoundary),
                        Repetition = ReadRepetition(time.Repetition)
                    };

                default:
                    return null;
            }
        }

        /// <summary>
        /// Task Scheduler start boundaries are local; the server treats TriggerSpec
        /// times as UTC (schedules are stored in UTC), so convert before formatting.
        /// </summary>
        private static string ToUtcHhmm(DateTime startBoundary)
        {
            var kinded = startBoundary.Kind == DateTimeKind.Unspecified
                ? DateTime.SpecifyKind(startBoundary, DateTimeKind.Local)
                : startBoundary;
            return kinded.ToUniversalTime().ToString("HH:mm");
        }

        private static RepetitionSpec? ReadRepetition(RepetitionPattern rep)
        {
            if (rep == null || rep.Interval == TimeSpan.Zero) return null;
            return new RepetitionSpec
            {
                Interval = XmlConvert.ToString(rep.Interval),
                Duration = rep.Duration == TimeSpan.Zero ? null : XmlConvert.ToString(rep.Duration)
            };
        }

        /// <summary>
        /// Days a local start boundary moves when converted to UTC: -1, 0, or +1.
        /// The weekly day-of-week must roll by this same amount to stay aligned with
        /// the UTC time reported in StartBoundary.
        /// </summary>
        private static int UtcDayShift(DateTime startBoundary)
        {
            var kinded = startBoundary.Kind == DateTimeKind.Unspecified
                ? DateTime.SpecifyKind(startBoundary, DateTimeKind.Local)
                : startBoundary;
            return (int)(kinded.ToUniversalTime().Date - kinded.Date).TotalDays;
        }

        private static List<string> ToDayNames(DaysOfTheWeek days, int dayShift)
        {
            var result = new List<string>();
            foreach (var (flag, name) in SingleDays)
            {
                if ((days & flag) == flag) result.Add(ShiftDayName(name, dayShift));
            }
            return result;
        }

        /// <summary>
        /// Roll a weekday name by <paramref name="dayShift"/> days, wrapping around
        /// the week. Unknown names are returned unchanged.
        /// </summary>
        public static string ShiftDayName(string name, int dayShift)
        {
            int idx = Array.FindIndex(SingleDays, d => d.Name == name);
            if (idx < 0) return name;
            int rolled = ((idx + dayShift) % 7 + 7) % 7;
            return SingleDays[rolled].Name;
        }

        private static readonly (DaysOfTheWeek Flag, string Name)[] SingleDays =
        {
            (DaysOfTheWeek.Sunday, "Sunday"),
            (DaysOfTheWeek.Monday, "Monday"),
            (DaysOfTheWeek.Tuesday, "Tuesday"),
            (DaysOfTheWeek.Wednesday, "Wednesday"),
            (DaysOfTheWeek.Thursday, "Thursday"),
            (DaysOfTheWeek.Friday, "Friday"),
            (DaysOfTheWeek.Saturday, "Saturday"),
        };
    }
}
