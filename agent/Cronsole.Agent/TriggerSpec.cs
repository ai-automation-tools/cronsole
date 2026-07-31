using System;
using System.Collections.Generic;

namespace Cronsole.Agent
{
    /// <summary>
    /// Structured trigger sent by the server in the task:create payload.
    /// Mirrors the WindowsTrigger interface in backend/src/utils/scheduler-conversion.ts.
    /// Times are UTC ("HH:mm"); durations/intervals are ISO-8601 (e.g. PT30M, P1D).
    /// </summary>
    public class TriggerSpec
    {
        public string Type { get; set; } = "Daily"; // Daily | Weekly | Time
        public string StartBoundary { get; set; } = "00:00";
        public int? DaysInterval { get; set; }
        public List<string>? DaysOfWeek { get; set; }
        public RepetitionSpec? Repetition { get; set; }
    }

    public class RepetitionSpec
    {
        public string Interval { get; set; } = string.Empty;
        public string? Duration { get; set; }
    }
}
