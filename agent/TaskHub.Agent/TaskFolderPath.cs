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

        /// <summary>Path segments, separator-agnostic and empty-free.</summary>
        public static List<string> Split(string? folder)
        {
            if (string.IsNullOrWhiteSpace(folder)) return new List<string>();
            return folder
                .Split(new[] { '\\', '/' }, StringSplitOptions.RemoveEmptyEntries)
                .ToList();
        }
    }
}
