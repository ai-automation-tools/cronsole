/**
 * What a hosted agent may use and reach, as a form builds it.
 *
 * Separate from the editor component because two different gestures submit this
 * shape — creating a trigger, and rotating the credential on one that already
 * exists — and because a pure function that decides *what gets sent* deserves a
 * test that does not have to mount a checkbox grid.
 */

/**
 * A tool as the form builds it.
 *
 * `headers` exists here and on **no** read-path type, deliberately: a bearer
 * token travels as far as the create call and no further. Cronsole never parses
 * one back, so a shape that could hold one on the way out would be describing
 * something that cannot happen.
 */
export interface AgentToolDraft {
  type: string;
  name?: string;
  url?: string;
  headers?: Record<string, string>;
  /**
   * A **saved MCP server** on the connection, by name.
   *
   * The row that carries this has no URL and no token of its own — the server
   * behind the name supplies both, on the backend, at the moment of the call. It
   * is why the same trigger can be rebuilt a dozen times without anyone typing a
   * credential again, and why a token rotation is one gesture instead of one per
   * task.
   */
  preset?: string;
}

/** A saved MCP server as the server describes it — never with its credential. */
export interface ToolPreset {
  name: string;
  url: string;
  /** Whether a credential is stored. Not a masked value; there is nothing to reveal. */
  hasHeaders: boolean;
  /** How many tracked triggers point at this server's URL. */
  usedBy: number;
}

/**
 * Drop the rows a user has started but not finished.
 *
 * An MCP server with no URL is **not a grant** — it is a row somebody is still
 * filling in. Sending it would have the connector refuse the entire create over
 * a field that was mid-keystroke, which reads as "the form is broken" rather
 * than "finish this line".
 *
 * Domains are trimmed and blanks dropped for the same reason: an empty row is
 * the *Add domain* button's output, not a request to allow the empty string.
 */
export function cleanReach(tools: AgentToolDraft[], allowlist: string[]) {
  return {
    agentTools: tools.filter(
      t =>
        t.type !== 'mcp_server' ||
        // A preset **is** a finished row: the name is the whole grant, and the
        // URL it stands for lives on the server. Judging it by the URL field it
        // deliberately leaves empty would drop every saved server on the way out.
        Boolean(t.preset) ||
        (t.url ?? '').trim().length > 0
    ),
    agentAllowlist: allowlist.map(d => d.trim()).filter(Boolean)
  };
}

/**
 * The reach fields as a request body fragment — **omitted entirely when empty**.
 *
 * Not `{ agentTools: [], agentAllowlist: [] }`. An empty `tools` array is a
 * different request from no `tools` key at all: the platform documents the field
 * as the way to *restrict* the default set, so sending `[]` could plausibly mean
 * "no tools" rather than "the defaults". A create that touched none of this must
 * be byte-identical to one made before the section existed.
 */
export function reachPayload(tools: AgentToolDraft[], allowlist: string[]) {
  const cleaned = cleanReach(tools, allowlist);
  return {
    ...(cleaned.agentTools.length ? { agentTools: cleaned.agentTools } : {}),
    ...(cleaned.agentAllowlist.length ? { agentAllowlist: cleaned.agentAllowlist } : {})
  };
}
