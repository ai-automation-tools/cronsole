using System;
using System.Collections.Generic;
using System.Diagnostics.Eventing.Reader;
using System.Runtime.Versioning;

namespace Cronsole.Agent
{
    /// <summary>
    /// **Why a Windows task failed, which is the one thing Cronsole could never say.**
    ///
    /// Every other source publishes an outcome Cronsole can read: Gemini has a
    /// transcript, GitHub has per-step conclusions, a native job's own stdout is
    /// captured by <c>executeJob</c>. Windows publishes an <b>exit code</b> and
    /// nothing else — <c>LastTaskResult</c>, an integer — so a task that has been
    /// failing nightly for a week shows a red badge and gives the user nowhere to
    /// go but Event Viewer.
    ///
    /// The detail does exist; it is just not on the task object. Task Scheduler
    /// writes an operational event log, and that log names the action that ran,
    /// the code it returned, and why a start was refused.
    ///
    /// <para><b>The distinction this class exists to preserve:</b> that log can be
    /// <b>switched off machine-wide</b>, and it is off by default on some Windows
    /// installs. A disabled log and a task that has never run are byte-identical
    /// from the reader's side — both are zero events — and reporting them the same
    /// way would tell a user their task never ran when it has run every night for a
    /// month. So <see cref="HistoryEnabled"/> is read from the log's own
    /// configuration and reported separately, and the backend renders two different
    /// sentences. This is the same rule the sync notes follow: "found nothing" and
    /// "looked at nothing" are different facts.</para>
    ///
    /// <para>Read-only, like <c>task:list</c> and <c>task:folders</c>: it changes
    /// nothing, so it carries no command signature.</para>
    /// </summary>
    // The event-log reader is Windows-only, and so is this whole agent - it is
    // built on Microsoft.Win32.TaskScheduler. Stating it here keeps the platform
    // analyzer quiet without a blanket NoWarn, which would also hide the next
    // genuinely misplaced call. The macOS agent is a separate project.
    [SupportedOSPlatform("windows")]
    public static class TaskHistoryReader
    {
        /// <summary>The operational log Task Scheduler writes per-task events to.</summary>
        private const string LogName = "Microsoft-Windows-TaskScheduler/Operational";

        /// <summary>
        /// Recent events for one task path, newest first.
        ///
        /// <paramref name="limit"/> is capped by the caller rather than here being
        /// generous: this crosses a WebSocket to a browser modal, and a task that
        /// runs every minute has tens of thousands of events behind it.
        /// </summary>
        public static AgentTaskHistory Read(string taskPath, int limit)
        {
            var result = new AgentTaskHistory();

            // Ask the log whether it is even collecting before reading it. A
            // disabled log yields zero events and no error, which is exactly the
            // shape of a healthy task that has never run.
            try
            {
                var config = new EventLogConfiguration(LogName);
                result.HistoryEnabled = config.IsEnabled;
            }
            catch (Exception ex)
            {
                // Could not ask. Distinct from "off": report the reason and leave
                // HistoryEnabled null so the backend does not claim either.
                result.Unavailable = $"Could not read the Task Scheduler event log configuration: {ex.Message}";
                return result;
            }

            if (result.HistoryEnabled == false)
            {
                // Not an error, and not an empty history. A statement of fact with
                // the fix attached, because it is a one-line fix the user owns.
                return result;
            }

            try
            {
                // XPath over the event's own TaskName field. Task Scheduler records
                // the FULL path (\Folder\Task), which is exactly Cronsole's
                // externalId, so no translation is needed in either direction.
                //
                // The apostrophe is doubled rather than backslash-escaped: this is
                // XPath, where a literal quote inside a single-quoted string is
                // written by doubling it. A task named "Bob's Backup" is ordinary
                // and would otherwise produce a malformed query — an exception on
                // a name, which is the kind of bug that only shows up on somebody
                // else's machine.
                var escaped = taskPath.Replace("'", "''");
                var query = new EventLogQuery(
                    LogName,
                    PathType.LogName,
                    $"*[EventData[Data[@Name='TaskName']='{escaped}']]")
                {
                    // Newest first. Reading forward would mean walking a year of
                    // events to reach the ones anybody wants.
                    ReverseDirection = true
                };

                using (var reader = new EventLogReader(query))
                {
                    EventRecord? record;
                    while (result.Events.Count < limit && (record = reader.ReadEvent()) != null)
                    {
                        using (record)
                        {
                            string message;
                            try
                            {
                                // Can throw or return null when the provider's
                                // message resources are unavailable. An event with
                                // no readable description is still evidence that
                                // something happened at that time, so it is kept
                                // with its id rather than dropped.
                                message = record.FormatDescription() ?? string.Empty;
                            }
                            catch
                            {
                                message = string.Empty;
                            }

                            result.Events.Add(new AgentTaskHistoryEvent
                            {
                                EventId = record.Id,
                                // The event's own named fields, which is where the
                                // facts actually live: event 201 publishes
                                // ResultCode and ActionName as data, and the
                                // rendered Message is merely those values pasted
                                // into an English sentence. Reading the sentence
                                // works until the machine is not English.
                                Data = ReadEventData(record),
                                // 2 = Error, 3 = Warning, 4 = Information in this
                                // log. Passed through as the number rather than
                                // mapped: the backend decides what to call it, and
                                // a level this agent has never seen must not be
                                // guessed at here.
                                Level = record.Level,
                                TimeCreated = record.TimeCreated,
                                Message = message
                            });
                        }
                    }
                }
            }
            catch (EventLogNotFoundException)
            {
                result.Unavailable = "The Task Scheduler operational log does not exist on this machine.";
            }
            catch (UnauthorizedAccessException)
            {
                // Worth its own message: the agent is normally elevated, so this
                // means something specific about how it was launched rather than a
                // general failure.
                result.Unavailable = "Access to the Task Scheduler event log was denied.";
            }
            catch (Exception ex)
            {
                result.Unavailable = $"Could not read the Task Scheduler event log: {ex.Message}";
            }

            return result;
        }

        /// <summary>
        /// The event's <c>EventData</c> as name/value pairs.
        ///
        /// **Read from the XML rather than from <c>record.Properties</c>**, which is
        /// a positional list: the index of <c>ResultCode</c> differs per event id,
        /// so position is a second thing to get wrong per event type. The names are
        /// stable and are what Task Scheduler's own schema publishes.
        /// </summary>
        private static Dictionary<string, string> ReadEventData(EventRecord record)
        {
            var data = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                var doc = new System.Xml.XmlDocument();
                doc.LoadXml(record.ToXml());
                var nodes = doc.GetElementsByTagName("Data");
                foreach (System.Xml.XmlNode node in nodes)
                {
                    var name = node.Attributes?["Name"]?.Value;
                    if (!string.IsNullOrEmpty(name)) data[name!] = node.InnerText ?? string.Empty;
                }
            }
            catch
            {
                // A malformed record still has its id, time and message, all of
                // which are worth keeping. Facts are an enrichment, not a
                // precondition.
            }
            return data;
        }
    }

    /// <summary>What the agent found, and whether it was able to look.</summary>
    public class AgentTaskHistory
    {
        /// <summary>
        /// Whether Task Scheduler is collecting history at all.
        ///
        /// Three states on purpose. <c>true</c>: the log is on and
        /// <see cref="Events"/> is a real answer. <c>false</c>: history is switched
        /// off machine-wide, so an empty list says nothing about this task.
        /// <c>null</c>: the agent could not determine it, which is a third fact and
        /// not a synonym for either.
        /// </summary>
        public bool? HistoryEnabled { get; set; }

        /// <summary>Why nothing could be read, when that is the answer. Null on success.</summary>
        public string? Unavailable { get; set; }

        public List<AgentTaskHistoryEvent> Events { get; set; } = new List<AgentTaskHistoryEvent>();
    }

    /// <summary>One Task Scheduler event, as the log recorded it.</summary>
    public class AgentTaskHistoryEvent
    {
        /// <summary>
        /// Task Scheduler's own event id — 201 is an action completing with a
        /// return code, 101 a start that was refused, 111 a termination. Passed
        /// through unmapped: the id is the platform's vocabulary and the backend
        /// is where it is turned into words.
        /// </summary>
        public int EventId { get; set; }

        /// <summary>2 = Error, 3 = Warning, 4 = Information. Unmapped, as above.</summary>
        public byte? Level { get; set; }

        public DateTime? TimeCreated { get; set; }

        /// <summary>The event's rendered description. Empty when the provider could not render it.</summary>
        public string Message { get; set; } = string.Empty;

        /// <summary>
        /// The event's own named data fields — <c>ResultCode</c>, <c>ActionName</c>,
        /// <c>TaskName</c> and whatever else that event id publishes.
        ///
        /// These are the values the rendered <see cref="Message"/> is built from,
        /// and they are **language-independent**: on a German or Japanese Windows
        /// the sentence is translated and any regex over it finds nothing, while
        /// <c>ResultCode</c> is still <c>ResultCode</c>.
        /// </summary>
        public Dictionary<string, string> Data { get; set; } = new Dictionary<string, string>();
    }
}
