import { Socket } from 'socket.io';

/**
 * What the agent said about itself in `agent:hello`.
 *
 * The agent has emitted this since it was written and **nothing listened** — so
 * the backend could not name the machine its own agent was running on, which is
 * the first question anyone asks when a task fires somewhere unexpected.
 *
 * `agentVersion` is captured because the agent sends it, and is deliberately
 * **not rendered** by the diagnostics report: the agent hardcodes the string
 * `"1.0.0"`, so it is identical on a build from today and one published in June.
 * Showing it beside "Agent" would read as a freshness claim while carrying no
 * information at all — the confident lie in miniature. Render it the day the
 * agent stamps a real build id; until then `connectedAt` is the honest fact
 * about how old the running process is (troubleshooting #7).
 */
export interface AgentIdentity {
  machineName?: string;
  agentVersion?: string;
  osVersion?: string;
  /** When the hello arrived — distinct from `connectedAt` only in odd cases. */
  at: Date;
}

/**
 * What we actually know about an agent, as opposed to what we assume.
 *
 * A registered socket proves the agent authenticated and completed the HMAC
 * handshake — that is real evidence, but it is evidence about a moment, not a
 * standing guarantee. Socket.IO's engine-level heartbeat is answered by the
 * transport, so a wedged agent whose command loop has stopped keeps a perfectly
 * healthy-looking socket while answering nothing (troubleshooting #40).
 *
 * So liveness is tracked from the traffic that already happens: any inbound
 * event is evidence the agent is answering, and any request that times out is
 * evidence it is not. Whichever is more recent wins.
 */
export interface AgentLiveness {
  /** When this agent completed its handshake. Evidence it was alive then. */
  connectedAt: Date;
  /** Last inbound event from the agent, if any has ever arrived. */
  lastResponseAt?: Date;
  /** Last request that timed out waiting on this agent, if any. */
  lastFailureAt?: Date;
  /** The verb that timed out, so the reason can name it rather than generalize. */
  lastFailureVerb?: string;
  /** Self-reported identity from `agent:hello`, if it has arrived. */
  identity?: AgentIdentity;
}

class AgentManager {
  // Map of userId -> Socket
  // In a real system, a user might have multiple agents (multiple machines)
  // For MVP, we assume one agent per user.
  private agentSockets: Map<string, Socket> = new Map();
  private liveness: Map<string, AgentLiveness> = new Map();

  registerAgent(userId: string, socket: Socket) {
    this.agentSockets.set(userId, socket);
    // A reconnect starts a fresh evidence record. Carrying the previous
    // socket's timeout forward would leave a healthy new agent marked degraded
    // by a failure that belonged to a connection that no longer exists.
    this.liveness.set(userId, { connectedAt: new Date() });
    console.log(`Agent registered for user ${userId}`);
  }

  unregisterAgent(userId: string) {
    this.agentSockets.delete(userId);
    this.liveness.delete(userId);
    console.log(`Agent unregistered for user ${userId}`);
  }

  getSocket(userId: string): Socket | undefined {
    return this.agentSockets.get(userId);
  }

  /** The agent sent us something. Called for every inbound event. */
  markResponsive(userId: string): void {
    const record = this.liveness.get(userId);
    if (record) record.lastResponseAt = new Date();
  }

  /**
   * Record what the agent said it is. Everything here is **self-reported by the
   * agent**, so it identifies a machine — it never proves one.
   *
   * Tolerant of a malformed payload by design: this is an observer of a socket
   * event, and an observer may not fail the connection it observes (the same
   * rule `recordCapability` follows). A bad hello costs the identity fields, not
   * the agent.
   */
  recordHello(userId: string, payload: unknown): void {
    const record = this.liveness.get(userId);
    if (!record) return;

    const raw = (Array.isArray(payload) ? payload[0] : payload) as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') return;

    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined);
    record.identity = {
      machineName: str(raw.machineName),
      agentVersion: str(raw.agentVersion),
      osVersion: str(raw.osVersion),
      at: new Date()
    };
  }

  /** A request to this agent timed out. `verb` names it for the health reason. */
  markUnresponsive(userId: string, verb: string): void {
    const record = this.liveness.get(userId);
    if (!record) return;
    record.lastFailureAt = new Date();
    record.lastFailureVerb = verb;
  }

  getLiveness(userId: string): AgentLiveness | undefined {
    return this.liveness.get(userId);
  }
}

export const agentManager = new AgentManager();
