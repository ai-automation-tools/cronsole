using System.Collections.Generic;
using System.Text;

namespace Cronsole.Agent
{
    // Join arguments into a single ExecAction argument string using Windows
    // CommandLineToArgvW quoting rules, so a value containing spaces or quotes
    // stays exactly one argument to the target program. No shell (cmd.exe) is
    // involved, so a malicious value can't inject a second command - the worst it
    // can do is become a malformed argument to the intended executable.
    public static class ArgumentQuoting
    {
        private static readonly char[] NeedsQuoting = { ' ', '\t', '\n', '\v', '"' };

        public static string Join(IEnumerable<string> args)
        {
            var sb = new StringBuilder();
            foreach (var arg in args)
            {
                if (sb.Length > 0) sb.Append(' ');
                AppendQuoted(sb, arg ?? string.Empty);
            }
            return sb.ToString();
        }

        private static void AppendQuoted(StringBuilder sb, string arg)
        {
            // Non-empty args without whitespace or quotes pass through verbatim.
            if (arg.Length > 0 && arg.IndexOfAny(NeedsQuoting) < 0)
            {
                sb.Append(arg);
                return;
            }

            sb.Append('"');
            int backslashes = 0;
            foreach (char c in arg)
            {
                if (c == '\\')
                {
                    backslashes++;
                }
                else if (c == '"')
                {
                    // Escape the run of backslashes (they precede a quote) and the quote.
                    sb.Append('\\', backslashes * 2 + 1);
                    sb.Append('"');
                    backslashes = 0;
                }
                else
                {
                    if (backslashes > 0) { sb.Append('\\', backslashes); backslashes = 0; }
                    sb.Append(c);
                }
            }
            // Trailing backslashes precede the closing quote, so double them.
            sb.Append('\\', backslashes * 2);
            sb.Append('"');
        }
    }
}
