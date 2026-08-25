import { Plus, X, ShieldAlert } from 'lucide-react';
import type { AgentToolDraft } from '../utils/agentReach';

/**
 * **The tools a hosted agent gets, and the domains it may reach.**
 *
 * Its own component rather than more fields in the create modal, because it is
 * used from two places that are not the same gesture: creating a trigger, and
 * *rotating* the credential on one that already exists. The second exists at all
 * because Gemini's `PATCH` cannot edit an interaction — a token that expires
 * would otherwise strand the trigger permanently — and it has to offer the same
 * editing surface or a rotation would silently change what the agent can do.
 *
 * Three rules it enforces by shape rather than by validation message:
 *
 * **Nothing is on by default.** Every checkbox starts clear, so a trigger
 * created without touching this section gets the platform's plain environment —
 * the standing rule that Cronsole never guesses an agent's reach.
 *
 * **A credential is labelled as one, at the point of entry.** The header field
 * says where the token ends up, because it ends up somewhere Cronsole cannot
 * reach: the trigger lives on the platform, so the platform holds it. A field
 * that merely looked like a password box would imply the opposite.
 *
 * **The allowlist is visually separate and warning-coloured.** Granting a tool
 * widens what an agent can *do*; granting a domain widens what it can *talk to*,
 * which is the one that carries data off the machine.
 */

/**
 * The built-in types, in the order they are worth thinking about.
 *
 * Taken from the API's own refusal message rather than from the documentation,
 * which has disagreed with the wire five times on this platform. `mcp_server`
 * and `function` are excluded here: they need fields, not a checkbox, and MCP
 * gets its own section below.
 */
const BUILT_IN_TOOLS: { type: string; blurb: string }[] = [
  { type: 'google_search', blurb: 'Search the web' },
  { type: 'url_context', blurb: 'Fetch and read pages' },
  { type: 'code_execution', blurb: 'Run Python, Node, Bash in the sandbox' },
  { type: 'bash', blurb: 'A shell in the sandbox' },
  { type: 'filesystem', blurb: 'Read and write sandbox files' },
  { type: 'file_search', blurb: 'Search uploaded files' },
  { type: 'computer_use', blurb: 'Drive a virtual screen' },
  { type: 'google_maps', blurb: 'Places and directions' },
  { type: 'tool_search', blurb: 'Discover further tools' }
];

export function AgentReachEditor({
  tools,
  onToolsChange,
  allowlist,
  onAllowlistChange
}: {
  tools: AgentToolDraft[];
  onToolsChange: (tools: AgentToolDraft[]) => void;
  allowlist: string[];
  onAllowlistChange: (domains: string[]) => void;
}) {
  const builtInSelected = (type: string) => tools.some(t => t.type === type);

  const toggleBuiltIn = (type: string) => {
    onToolsChange(
      builtInSelected(type) ? tools.filter(t => t.type !== type) : [...tools, { type }]
    );
  };

  const servers = tools.filter(t => t.type === 'mcp_server');

  const updateServer = (index: number, patch: Partial<AgentToolDraft>) => {
    let seen = -1;
    onToolsChange(
      tools.map(tool => {
        if (tool.type !== 'mcp_server') return tool;
        seen += 1;
        return seen === index ? { ...tool, ...patch } : tool;
      })
    );
  };

  const removeServer = (index: number) => {
    let seen = -1;
    onToolsChange(
      tools.filter(tool => {
        if (tool.type !== 'mcp_server') return true;
        seen += 1;
        return seen !== index;
      })
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <span className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">
          Tools
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          {BUILT_IN_TOOLS.map(tool => (
            <label
              key={tool.type}
              className={`flex items-start gap-2 px-2.5 py-2 rounded-lg border cursor-pointer transition-colors ${
                builtInSelected(tool.type)
                  ? 'border-gemini/40 bg-gemini/5'
                  : 'border-border bg-background hover:border-border/80'
              }`}
            >
              <input
                type="checkbox"
                checked={builtInSelected(tool.type)}
                onChange={() => toggleBuiltIn(tool.type)}
                className="mt-0.5 accent-gemini"
              />
              <span className="min-w-0">
                <span className="block text-[11px] font-mono text-foreground truncate">{tool.type}</span>
                <span className="block text-[10px] text-subtle-foreground">{tool.blurb}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-[10px] text-subtle-foreground italic">
          Nothing selected means the platform&apos;s default toolset — which is what every trigger
          Cronsole has created so far gets.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">
            MCP servers
          </span>
          <button
            type="button"
            onClick={() => onToolsChange([...tools, { type: 'mcp_server' }])}
            className="text-[10px] font-bold text-gemini-text hover:underline flex items-center gap-1"
          >
            <Plus size={11} /> Add server
          </button>
        </div>

        {servers.length === 0 ? (
          <p className="text-[10px] text-subtle-foreground italic">None. The agent uses only the tools above.</p>
        ) : (
          servers.map((server, i) => (
            <div key={i} className="space-y-1.5 bg-background border border-border rounded-xl p-2.5">
              <div className="flex gap-1.5">
                <input
                  value={server.name ?? ''}
                  onChange={e => updateServer(i, { name: e.target.value })}
                  placeholder="name"
                  aria-label={`MCP server ${i + 1} name`}
                  className="w-1/3 bg-surface border border-border rounded-lg px-2 py-1.5 text-[11px] font-mono text-foreground outline-none focus:border-gemini"
                />
                <input
                  value={server.url ?? ''}
                  onChange={e => updateServer(i, { url: e.target.value })}
                  placeholder="https://example.com/mcp"
                  aria-label={`MCP server ${i + 1} URL`}
                  className="flex-1 bg-surface border border-border rounded-lg px-2 py-1.5 text-[11px] font-mono text-foreground outline-none focus:border-gemini"
                />
                <button
                  type="button"
                  onClick={() => removeServer(i)}
                  aria-label={`Remove MCP server ${i + 1}`}
                  className="px-2 text-subtle-foreground hover:text-danger-text"
                >
                  <X size={13} />
                </button>
              </div>
              <input
                type="password"
                value={server.headers?.Authorization ?? ''}
                onChange={e =>
                  updateServer(i, {
                    headers: e.target.value ? { Authorization: e.target.value } : undefined
                  })
                }
                placeholder="Authorization header (optional)"
                aria-label={`MCP server ${i + 1} authorization`}
                className="w-full bg-surface border border-border rounded-lg px-2 py-1.5 text-[11px] font-mono text-foreground outline-none focus:border-gemini"
              />
            </div>
          ))
        )}

        {servers.some(s => s.headers?.Authorization) && (
          // Said at the point of entry, not in a confirmation afterwards. The
          // trigger runs on Gemini, so Gemini holds this token from the moment
          // it is created — a password field that implied otherwise would be a
          // lie told by a UI convention.
          <p className="text-[10px] text-warning-text bg-warning/5 border border-warning/30 rounded-lg px-2.5 py-2">
            This token is sent to Gemini, which stores it with the trigger. Cronsole keeps no copy and
            cannot show it again — to change it later, use <b>Replace credentials</b> on the task.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <span className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
          <ShieldAlert size={11} className="text-warning-text" /> Network allowlist
        </span>
        {/*
          Separate from tools and warning-coloured on purpose. A tool widens what
          the agent can DO; a domain widens what it can TALK TO, and that is the
          one that carries data off the sandbox.
        */}
        <DomainList domains={allowlist} onChange={onAllowlistChange} />
        <p className="text-[10px] text-subtle-foreground italic">
          Empty means the sandbox reaches nothing outside itself. That is the default, and it is why a
          trigger asked to email a report will quietly write a file instead.
        </p>
      </div>
    </div>
  );
}

/** One domain per row. Deliberately not a comma-split box — a typo'd separator would widen reach silently. */
function DomainList({ domains, onChange }: { domains: string[]; onChange: (d: string[]) => void }) {
  return (
    <div className="space-y-1.5">
      {domains.map((domain, i) => (
        <div key={i} className="flex gap-1.5">
          <input
            value={domain}
            onChange={e => onChange(domains.map((d, j) => (j === i ? e.target.value : d)))}
            placeholder="api.example.com"
            aria-label={`Allowed domain ${i + 1}`}
            className="flex-1 bg-background border border-warning/30 rounded-lg px-2 py-1.5 text-[11px] font-mono text-foreground outline-none focus:border-warning"
          />
          <button
            type="button"
            onClick={() => onChange(domains.filter((_, j) => j !== i))}
            aria-label={`Remove domain ${i + 1}`}
            className="px-2 text-subtle-foreground hover:text-danger-text"
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...domains, ''])}
        className="text-[10px] font-bold text-warning-text hover:underline flex items-center gap-1"
      >
        <Plus size={11} /> Add domain
      </button>
    </div>
  );
}
