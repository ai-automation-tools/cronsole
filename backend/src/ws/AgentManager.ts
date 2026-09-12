import { Socket } from 'socket.io';

/**
 * What the agent said about itself in `agent:hello`.
 *
 * The agent has emitted this since it was written and **nothing listened** — so
 * the backend could not name the machine its own agent was running on, which is
 * the first question anyone asks when a task fires somewhere unexpected.
 *
 * `agentVersion` used to be captured and deliberately **not rendered**: the
 * agent hardcoded the string `"1.0.0"`, so it was identical on a build from
 * today and one published in June, and showing it beside "Agent" would have read
 * as a freshness claim carrying no information — the confident lie in miniature.
 * That comment said to render it the day the agent stamped a real build id;
 * since 2026-09-11 it does, read off its own assembly, so diagnostics prints it.
 * `connectedAt` remains the fact about how old the running *process* is, which
 * is a different question (troubleshooting #7).
 *
 * `protocolVersion` is the wire contract, and it moves independently of the
 * build — see `docs/contributing/Versioning.md`. Nothing refuses on it yet
 * because only one value has ever existed.
 *
 * `elevated` is `undefined` for exactly the same reason `protocolVersion` is:
 * an agent published before this field existed says nothing, and that absence
 * must read as "unknown" rather than as either boolean — see
 * troubleshooting #74, where a confidently-wrong answer here is what let 86
 * real tasks get reported as deleted.
 */
export interface AgentIdentity {
  machineName?: string;
  agentVersion?: string;
  protocolVersion?: number;
  osVersion?: string;
  elevated?: boolean;
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
      // Absent from every agent published before 2026-09-11, and that absence is
      // the useful reading: an agent that does not say which wire it speaks
      // predates the field, which is older than any version it could name.
      protocolVersion: typeof raw.protocolVersion === 'number' ? raw.protocolVersion : undefined,
      osVersion: str(raw.osVersion),
      elevated: typeof raw.elevated === 'boolean' ? raw.elevated : undefined,
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
