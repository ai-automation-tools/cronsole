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

// ASCII unit separator (0x1F): the field delimiter for HMAC canonicalization. It
// can't appear in a normal command line, so field boundaries are unambiguous.
const UNIT_SEP = String.fromCharCode(0x1f);

export interface StructuredAction {
  executable: string;
  args: string[];
}

/** Split a command line into argv, honoring double-quote grouping. */
export function parseCommandLine(input: string): string[] {
  const args: string[] = [];
  let cur = '';
  let inQuotes = false;
  let hasToken = false; // lets an explicit empty token ("") survive
  for (const c of input) {
    if (c === '"') {
      inQuotes = !inQuotes;
      hasToken = true;
      continue;
    }
    if (!inQuotes && (c === ' ' || c === '\t' || c === '\n' || c === '\r')) {
      if (hasToken) {
        args.push(cur);
        cur = '';
        hasToken = false;
      }
      continue;
    }
    cur += c;
    hasToken = true;
  }
  if (hasToken) args.push(cur);
  return args;
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
  return [action.executable, ...action.args].join(UNIT_SEP);
}
