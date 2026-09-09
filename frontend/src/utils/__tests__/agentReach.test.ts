import { describe, it, expect } from 'vitest';
import { cleanReach, reachPayload } from '../agentReach';

/**
 * The two decisions this module makes are both about **what gets sent**, and
 * both are security-adjacent: one decides whether a half-typed grant reaches the
 * platform, the other whether an empty form silently changes what an agent can
 * do.
 */
describe('cleanReach', () => {
  it('drops an MCP server that has no URL yet', () => {
    // A row somebody is still filling in is not a grant. Sending it would have
    // the connector refuse the whole create over a field mid-keystroke, which
    // reads as "the form is broken" rather than "finish this line".
    const { agentTools } = cleanReach(
      [{ type: 'bash' }, { type: 'mcp_server', name: 'weather' }],
      []
    );
    expect(agentTools).toEqual([{ type: 'bash' }]);
  });

  it('keeps an MCP server once it has a URL', () => {
    const { agentTools } = cleanReach([{ type: 'mcp_server', url: 'https://e.com/mcp' }], []);
    expect(agentTools).toHaveLength(1);
  });

  it('trims domains and drops the empty rows the Add button creates', () => {
    expect(cleanReach([], ['  api.example.com  ', '', '   ']).agentAllowlist).toEqual(['api.example.com']);
  });

  it('carries a credential through untouched — cleaning is not filtering', () => {
    // This function's job is to drop unfinished rows, not to strip tokens. The
    // token has to reach the create call; what must never happen is Cronsole
    // *storing* it, which happens nowhere on this path.
    const { agentTools } = cleanReach(
      [{ type: 'mcp_server', url: 'https://e.com/mcp', headers: { Authorization: 'Bearer x' } }],
      []
    );
    expect(agentTools[0]!.headers).toEqual({ Authorization: 'Bearer x' });
  });
});

describe('reachPayload', () => {
  it('omits both keys entirely when nothing was granted', () => {
    // **Not `{ agentTools: [], agentAllowlist: [] }`.** An empty tools array is a
    // different request from no tools key: the platform documents the field as
    // the way to RESTRICT the default set, so `[]` could plausibly mean "no
    // tools at all". A create that ignored this section must be byte-identical
    // to one made before the section existed.
    expect(reachPayload([], [])).toEqual({});
  });

  it('omits the allowlist alone when only tools were granted', () => {
    expect(reachPayload([{ type: 'bash' }], [])).toEqual({ agentTools: [{ type: 'bash' }] });
  });

  it('omits tools alone when only domains were granted', () => {
    expect(reachPayload([], ['e.com'])).toEqual({ agentAllowlist: ['e.com'] });
  });

  it('omits a key whose only entries were unfinished', () => {
    // One half-typed MCP row and nothing else is still "nothing was granted".
    expect(reachPayload([{ type: 'mcp_server', name: 'half' }], [])).toEqual({});
  });
});

/**
 * **A preset row is finished; a half-typed one is not.**
 *
 * The distinction matters because the two look identical to the old check: both
 * are `mcp_server` rows with no URL. One is a complete grant whose URL lives on
 * the server, the other is a line somebody is still filling in.
 */
describe('cleanReach with saved servers', () => {
  it('keeps a preset row even though it has no URL of its own', () => {
    // Judging it by the URL field it deliberately leaves empty would drop every
    // saved server on the way out — the create would silently lose the reach the
    // form showed as granted.
    const { agentTools } = cleanReach([{ type: 'mcp_server', preset: 'resend' }], []);
    expect(agentTools).toEqual([{ type: 'mcp_server', preset: 'resend' }]);
  });

  it('still drops a hand-typed row with neither a URL nor a preset', () => {
    const { agentTools } = cleanReach(
      [{ type: 'mcp_server', preset: 'resend' }, { type: 'mcp_server', name: 'half' }],
      []
    );
    expect(agentTools).toEqual([{ type: 'mcp_server', preset: 'resend' }]);
  });

  it('sends a preset reference and no credential', () => {
    // The whole point: what leaves the browser is a name. There is nothing here
    // that could carry a token, because the token is on the connection.
    const payload = reachPayload([{ type: 'mcp_server', preset: 'resend' }], []);
    expect(JSON.stringify(payload)).not.toContain('Authorization');
    expect(payload.agentTools).toEqual([{ type: 'mcp_server', preset: 'resend' }]);
  });

  it('still omits both keys when only an unfinished row was typed', () => {
    expect(reachPayload([{ type: 'mcp_server', name: 'half' }], [])).toEqual({});
  });
});
