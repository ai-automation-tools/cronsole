using System;
using System.Collections.Generic;
using System.Xml;
using Microsoft.Win32.TaskScheduler;

namespace TaskHub.Agent
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
                        DaysOfWeek = ToDayNames(weekly.DaysOfWeek),
                        Repetition = ReadRepetition(weekly.Repetition)
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

        private static List<string> ToDayNames(DaysOfTheWeek days)
        {
            var result = new List<string>();
            foreach (var (flag, name) in SingleDays)
            {
                if ((days & flag) == flag) result.Add(name);
            }
            return result;
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
