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
    agentTools: tools.filter(t => t.type !== 'mcp_server' || (t.url ?? '').trim().length > 0),
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
