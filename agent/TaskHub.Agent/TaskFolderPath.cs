using System;
using System.Collections.Generic;
using System.Linq;

namespace TaskHub.Agent
{
    /// <summary>
    /// Validation + normalization for Windows Task Scheduler folder paths.
    ///
    /// This intentionally DUPLICATES the backend's utils/windowsTaskFolder.ts.
    /// The agent runs elevated and is the process that actually calls
    /// RegisterTaskDefinition — which silently OVERWRITES a same-named task in
    /// the same folder. It therefore must not trust its caller: a backend bug, a
    /// compromised backend, or a signed command crafted with a bad folder must
    /// still be refused here. Defense in depth, at the boundary that holds the
    /// privilege.
    ///
    /// Keep the rules in sync with the backend; the C# side is the last word.
    /// </summary>
    public static class TaskFolderPath
    {
        /// <summary>Where TaskHub puts created tasks unless told otherwise.</summary>
        public const string Default = "\\TaskHub";

        /// <summary>
        /// Refused root. Windows' own scheduled tasks live under
        /// \Microsoft\Windows\, and overwriting one is silent and elevated.
        /// Compared case-insensitively against the FIRST segment only, so
        /// \MicrosoftEdgeBackups (a different folder) and \Work\Microsoft (the
        /// user's own) stay allowed.
        /// </summary>
        private const string ReservedRoot = "Microsoft";

        private const int MaxSegmentLength = 200;
        private const int MaxDepth = 8;

        // Characters Windows rejects in a path segment. Separators are split on
        // first, so they are not listed here.
        private static readonly char[] InvalidSegmentChars = { ':', '*', '?', '"', '<', '>', '|' };

        /// <summary>
        /// Returns a problem description, or null when the folder is usable.
        /// </summary>
        public static string? Validate(string? folder)
        {
            if (string.IsNullOrWhiteSpace(folder)) return "Folder is required.";

            var segments = Split(folder);

            // The root folder itself is legitimate — third-party tasks live there.
            if (segments.Count == 0) return null;

            if (segments.Count > MaxDepth) return $"Folder can be at most {MaxDepth} levels deep.";

            foreach (var segment in segments)
            {
                // Task Scheduler has no relative paths, so these are never
                // legitimate — only an attempt to escape the target folder.
                if (segment == "." || segment == "..") return "Folder cannot contain . or .. segments.";
                if (segment.Length > MaxSegmentLength) return $"Each folder name must be {MaxSegmentLength} characters or fewer.";
                if (segment.IndexOfAny(InvalidSegmentChars) >= 0 || segment.Any(char.IsControl))
                    return "Folder names cannot contain : * ? \" < > | or control characters.";
                // Windows strips trailing dots/spaces from directory names, so
                // "Work." would silently collapse onto "Work" on disk.
                if (segment.EndsWith(".") || segment.EndsWith(" "))
                    return "Folder names cannot end with a dot or a space.";
            }

            if (string.Equals(segments[0], ReservedRoot, StringComparison.OrdinalIgnoreCase))
                return "Refusing to create a task under \\Microsoft\\ — Windows keeps its own scheduled tasks there, and a name collision would silently overwrite one.";

            return null;
        }

        /// <summary>
        /// Canonical form: leading backslash, backslash separators, no trailing
        /// separator. The root normalizes to "\". Assumes Validate passed.
        /// </summary>
        public static string Normalize(string? folder)
        {
            var segments = Split(folder);
            return segments.Count == 0 ? "\\" : "\\" + string.Join('\\', segments);
        }

        /// <summary>True when the folder is the root folder.</summary>
        public static bool IsRoot(string? folder) => Split(folder).Count == 0;

        /// <summary>
        /// True when this is TaskHub's own folder (\TaskHub) — the ONLY folder the
        /// agent creates, because it is also the only one it prunes. Every other
        /// folder must already exist: TaskHub must never create something it cannot
        /// remove, since folder deletion needs elevation the user would have to
        /// perform by hand.
        /// </summary>
        public static bool IsDefault(string? folder) =>
            string.Equals(Normalize(folder), Default, StringComparison.OrdinalIgnoreCase);

        /// <summary>Path segments, separator-agnostic and empty-free.</summary>
        public static List<string> Split(string? folder)
        {
            if (string.IsNullOrWhiteSpace(folder)) return new List<string>();
            return folder
                .Split(new[] { '\\', '/' }, StringSplitOptions.RemoveEmptyEntries)
                .ToList();
        }

        /// <summary>
        /// The containing folder of a full task path. <c>\A\B\Task</c> → <c>\A\B</c>;
        /// <c>\Task</c> → <c>\</c>. Feed the result to <see cref="Validate"/>: a task
        /// path is only as safe as the folder it lands in.
        /// </summary>
        public static string ParentOf(string? taskPath)
        {
            var segments = Split(taskPath);
            if (segments.Count <= 1) return "\\";
            return "\\" + string.Join('\\', segments.Take(segments.Count - 1));
        }

        /// <summary>The task's own name — the last segment of its path.</summary>
        public static string LeafOf(string? taskPath)
        {
            var segments = Split(taskPath);
            return segments.Count == 0 ? string.Empty : segments[^1];
        }

        /// <summary>
        /// Returns a problem description, or null when the task name is usable.
        ///
        /// Separate from <see cref="Validate"/> because a restore supplies a whole
        /// task PATH rather than a folder plus a name — and the leaf half has its own
        /// rules. RegisterTaskDefinition throws ArgumentOutOfRangeException for these,
        /// which surfaces as an opaque failure; refusing here says what is wrong.
        /// </summary>
        public static string? ValidateTaskName(string? name)
        {
            if (string.IsNullOrWhiteSpace(name)) return "Task name is required.";
            if (name.Length > MaxSegmentLength) return $"Task name must be {MaxSegmentLength} characters or fewer.";
            if (name == "." || name == "..") return "Task name cannot be . or ..";
            if (name.IndexOfAny(InvalidSegmentChars) >= 0 || name.Any(char.IsControl))
                return "Task names cannot contain : * ? \" < > | or control characters.";
            // Task Scheduler stores tasks as files, and Windows silently strips a
            // trailing dot or space from a filename — so the name you asked for is
            // not the name you would get back.
            if (name.StartsWith(" ") || name.EndsWith(" "))
                return "Task names cannot start or end with a space.";
            if (name.EndsWith("."))
                return "Task names cannot end with a dot.";
            return null;
        }
    }
}
