/**
 * Turn a resolved command line into a structured { executable, args[] } action.
 *
 * Why this exists (P0 security): the agent used to register every task as
 * `cmd.exe /c "<command>"`, running the whole command through a shell. A template
 * parameter substituted into that string (e.g. `foo & calc.exe`) was interpreted
 * by cmd -> command injection / RCE. By splitting the command into an executable
 * plus discrete argument strings here (server-side) and having the agent register
 * a direct ExecAction with no shell, a parameter can at worst become a malformed
 * argument to the *intended* program - it can never launch a second process.
 *
 * Tokenization mirrors Windows command-line semantics closely enough for the
 * template catalog: double quotes group a token (and are stripped); single quotes
 * and backslashes are literal (so paths like C:\x.ps1 and embedded PowerShell like
 * -Command "... 'x' ..." tokenize the way an author expects). Commands that
 * genuinely need shell features (pipes, redirection, cmd builtins) must name the
 * shell explicitly - e.g. `cmd.exe /c "del /q %TEMP%\\*"` - which keeps the whole
 * shell command as a single argument to cmd rather than an implicit wrapper.
 */

/**
 * Join fields for an HMAC so that no two different field lists produce the same
 * string: each field is written as `<length>:<field>`, where length is the
 * field's UTF-16 code-unit count (`String.length` here, `string.Length` in C#).
 *
 * A separator cannot do this. Until wire protocol 2 the fields were joined with
 * `|`, and a task name, description or working directory may contain one, so
 * `a|b` + `c` and `a` + `b|c` signed identically: one signature, two meanings.
 * MUST match `AgentAuthenticator.Frame` byte-for-byte.
 */
export function frameFields(fields: Array<string | number>): string {
  return fields.map(f => `${String(f).length}:${f}`).join('');
}

export interface StructuredAction {
  executable: string;
  args: string[];
}

export interface CommandToken {
  text: string;
  /**
   * True if any part of the token was double-quoted in the source. Template
   * substitution uses this as the author's "this is exactly one argument"
   * signal: a quoted {{placeholder}} never expands into multiple args.
   */
  quoted: boolean;
}

/** Split a command line into tokens, honoring double-quote grouping. */
export function parseCommandTokens(input: string): CommandToken[] {
  const tokens: CommandToken[] = [];
  let cur = '';
  let inQuotes = false;
  let quoted = false;
  let hasToken = false; // lets an explicit empty token ("") survive
  for (const c of input) {
    if (c === '"') {
      inQuotes = !inQuotes;
      quoted = true;
      hasToken = true;
      continue;
    }
    if (!inQuotes && (c === ' ' || c === '\t' || c === '\n' || c === '\r')) {
      if (hasToken) {
        tokens.push({ text: cur, quoted });
        cur = '';
        quoted = false;
        hasToken = false;
      }
      continue;
    }
    cur += c;
    hasToken = true;
  }
  if (hasToken) tokens.push({ text: cur, quoted });
  return tokens;
}

/** Split a command line into argv, honoring double-quote grouping. */
export function parseCommandLine(input: string): string[] {
  return parseCommandTokens(input).map(t => t.text);
}

/** Derive { executable, args[] } from a resolved command string. */
export function toStructuredAction(command: string): StructuredAction {
  const argv = parseCommandLine(command);
  if (argv.length === 0) {
    return { executable: '', args: [] };
  }
  return { executable: argv[0], args: argv.slice(1) };
}

/**
 * Canonical string an action's HMAC is computed over. MUST match the C#
 * `AgentAuthenticator.CanonicalizeAction` byte-for-byte.
 */
export function canonicalizeAction(action: StructuredAction): string {
  return frameFields([action.executable, ...action.args]);
}
