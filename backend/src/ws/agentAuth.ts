import crypto from 'crypto';
import type { Socket } from 'socket.io';
import { canonicalizeAction, type StructuredAction } from '../utils/commandParser.js';
import { canonicalizeTrigger, type WindowsTrigger } from '../utils/scheduler-conversion.js';

/**
 * Agent WebSocket authentication.
 *
 * Threat model: the .NET agent connects OUTBOUND to the backend over Socket.IO
 * and, on command, creates and runs Windows scheduled tasks from a command
 * string — i.e. arbitrary code execution on the user's machine. Before this
 * module the socket was unauthenticated: any process reaching the port was
 * auto-trusted as the agent. Two defenses close that:
 *
 *  1. Handshake — the agent proves it holds the shared pairing secret via an
 *     HMAC over (agentId, nonce, ts). The middleware rejects any socket that
 *     can't, so an unauthenticated peer never reaches the connection handler.
 *  2. Per-command HMAC — state-changing commands (task:run / task:create /
 *     task:set_status / task:update_schedule / task:delete) are signed with a
 *     per-session key derived from the
 *     handshake nonce, with a freshness window to bound replay. The agent
 *     refuses to execute anything it can't verify.
 *
 * The C# counterpart is agent/Cronsole.Agent/AgentAuthenticator.cs — the HMAC
 * message strings below MUST stay byte-for-byte identical on both sides.
 */

// Clock-skew / replay tolerance, seconds. Handshake and commands share it.
const MAX_SKEW_SEC = 120;

// Minimum pairing-secret length we'll accept (defense against a trivial secret).
const MIN_SECRET_LEN = 16;

// MVP: a single shared pairing secret, and every authenticated agent maps to
// the placeholder user. When per-user pairing lands, resolve the userId from
// the agentId here instead (look it up against a stored per-user secret).
const MVP_USER_ID = 'cli_user_placeholder';

/** Read the pairing secret, throwing if unset/weak. Lazy so tests can set env. */
export function getPairingSecret(): string {
  const secret = process.env.AGENT_PAIRING_SECRET;
  if (!secret || secret.length < MIN_SECRET_LEN) {
    throw new Error(
      `AGENT_PAIRING_SECRET must be set (>= ${MIN_SECRET_LEN} chars) for agent WebSocket auth`
    );
  }
  return secret;
}

/** Fail-fast at startup so a misconfigured server never boots trusting nobody. */
export function assertAgentAuthConfig(): void {
  getPairingSecret();
}

function hmacHex(key: string, message: string): string {
  return crypto.createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

/**
 * Lowercase-hex SHA-256 over a string's UTF-8 bytes. Must match the agent's
 * AgentAuthenticator.Sha256Hex — same bytes in, same string out.
 *
 * Used to fold a task's whole XML definition into a signed command without
 * putting arbitrary bytes inside a pipe-delimited message. Exported so tests can
 * pin the cross-language agreement directly rather than only through a signature.
 */
export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Seen handshake nonces -> expiry (unix seconds). A valid handshake blob is only
// accepted once within its freshness window, so a captured handshake can't be
// replayed to displace the live agent. Bounded: entries live at most MAX_SKEW_SEC
// and are pruned on each use (handshakes are infrequent, so this stays tiny).
const usedNonces = new Map<string, number>();

function consumeNonce(agentId: string, nonce: string, nowSec: number): boolean {
  // Prune expired entries.
  for (const [key, expiry] of usedNonces) {
    if (expiry <= nowSec) usedNonces.delete(key);
  }
  // NUL separator, not a space: it cannot occur in either field, so two
  // different (agentId, nonce) pairs can never collide into one key — a space
  // would let ("a b", "c") and ("a", "b c") collide and false-reject a
  // handshake. Written as the \x00 ESCAPE rather than a literal NUL byte: the
  // runtime string is identical, but a literal makes git classify this file as
  // binary, so every diff of it — including security-relevant ones — becomes
  // unreviewable.
  const key = `${agentId}\x00${nonce}`;
  if (usedNonces.has(key)) return false; // replay
  usedNonces.set(key, nowSec + MAX_SKEW_SEC);
  return true;
}

/** Test-only: clear the replay cache between cases. */
export function _resetNonceCache(): void {
  usedNonces.clear();
}

export interface AgentIdentity {
  userId: string;
  agentId: string;
  /** Per-session HMAC key used to sign commands back to this socket. */
  sessionKey: string;
}

/**
 * Verify a Socket.IO handshake `auth` payload. Returns the resolved identity
 * (incl. the derived session key) or throws with a non-leaky reason.
 */
export function verifyHandshake(auth: unknown): AgentIdentity {
  if (!auth || typeof auth !== 'object') {
    throw new Error('missing handshake auth');
  }
  const { agentId, nonce, ts, hmac } = auth as Record<string, unknown>;

  if (
    typeof agentId !== 'string' ||
    typeof nonce !== 'string' ||
    typeof hmac !== 'string' ||
    (typeof ts !== 'number' && typeof ts !== 'string')
  ) {
    throw new Error('malformed handshake auth');
  }

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) {
    throw new Error('invalid handshake timestamp');
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > MAX_SKEW_SEC) {
    throw new Error('stale handshake');
  }

  const secret = getPairingSecret();
  const expected = hmacHex(secret, `${agentId}|${nonce}|${tsNum}`);
  if (!timingSafeEqualHex(expected, hmac)) {
    throw new Error('bad handshake signature');
  }

  // Reject replays only after the signature checks out, so an attacker can't
  // pre-poison the cache with guessed (agentId, nonce) pairs to lock out the agent.
  if (!consumeNonce(agentId, nonce, now)) {
    throw new Error('handshake replay');
  }

  const sessionKey = hmacHex(secret, `session:${nonce}`);
  return { userId: MVP_USER_ID, agentId, sessionKey };
}

/**
 * Express/Socket.IO middleware: authenticate the agent handshake before the
 * connection handler runs. Rejected sockets never connect.
 */
export function agentAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void
): void {
  try {
    const identity = verifyHandshake(socket.handshake.auth);
    socket.data.userId = identity.userId;
    socket.data.agentId = identity.agentId;
    socket.data.sessionKey = identity.sessionKey;
    next();
  } catch (err) {
    // Log the reason server-side; hand the client an opaque error.
    console.warn(
      `[agentAuth] rejected socket ${socket.id}: ${(err as Error).message}`
    );
    next(new Error('unauthorized'));
  }
}

// --- Per-command signing (server -> agent) ---------------------------------

export type SignableCommand =
  | { event: 'task:run'; taskPath: string }
  | { event: 'task:delete'; taskPath: string }
  | { event: 'task:set_status'; taskPath: string; enabled: boolean }
  | { event: 'task:update_schedule'; taskPath: string; trigger: WindowsTrigger }
  | {
      event: 'task:import';
      taskPath: string;
      /** The task's full native Task Scheduler XML — signed by hash, see below. */
      xml: string;
      /** Replace a task that already exists at `taskPath` instead of refusing. */
      overwrite: boolean;
      /** Recreate a missing folder chain instead of refusing. */
      createFolders: boolean;
    }
  | {
      event: 'task:update';
      taskPath: string;
      action: StructuredAction;
      // Normalized before signing: empty string when the field is unset, so the
      // canonical form is unambiguous and matches the C# UpdateMessage.
      workingDirectory: string;
      description: string;
      runLevel: 'least' | 'highest';
    }
  | {
      event: 'task:create';
      name: string;
      schedule: string;
      command: string;
      action: StructuredAction;
      trigger: WindowsTrigger | null;
      /**
       * Normalized Task Scheduler folder the task is registered in (e.g.
       * \Cronsole). Signed: it decides WHERE the task lands, and Windows
       * silently overwrites a same-named task in the same folder — so an
       * unsigned folder would let an on-path attacker redirect a create onto
       * an existing task and destroy it. Always a normalized string (never
       * undefined) so the canonical form is unambiguous.
       */
      folder: string;
      /**
       * Create `folder` if its chain is missing, instead of refusing. The second
       * and last carve-out to "Cronsole creates only \Cronsole" (the first is
       * task:import's `createFolders`). Signed for the same reason as `folder`
       * itself: it widens what one command may bring into existence, and the
       * agent is elevated, so a folder it creates needs administrator rights to
       * remove. Always a boolean (never undefined) so it canonicalizes to a
       * stable 1/0 on both sides.
       */
      createFolder: boolean;
    };

/**
 * Canonical message a command's HMAC is computed over. Must match
 * AgentAuthenticator.*Message on the C# side exactly.
 *
 * `task:create` signs the structured `action` (executable + args) the agent
 * actually registers as the task's ExecAction — so a tampered command/action
 * can't pass verification. The legacy `command` string is signed too (display /
 * back-compat), and the structured `trigger` (the schedule the task runs on) is
 * now covered as well via canonicalizeTrigger — so an on-path attacker on a
 * plaintext connection can't rewrite a task's schedule in flight either.
 *
 * `nonce` sits immediately before `ts` in every message and makes each command
 * instance unique — see signCommand for why that's a correctness fix, not just
 * hygiene.
 */
function commandMessage(cmd: SignableCommand, nonce: string, ts: number): string {
  switch (cmd.event) {
    case 'task:run':
      return `task:run|${cmd.taskPath}|${nonce}|${ts}`;
    case 'task:delete':
      return `task:delete|${cmd.taskPath}|${nonce}|${ts}`;
    case 'task:set_status':
      return `task:set_status|${cmd.taskPath}|${cmd.enabled ? 1 : 0}|${nonce}|${ts}`;
    case 'task:update_schedule':
      // The trigger IS the change here, so it's signed — an on-path attacker on
      // a plaintext link mustn't be able to rewrite the schedule in flight.
      return `task:update_schedule|${cmd.taskPath}|${canonicalizeTrigger(cmd.trigger)}|${nonce}|${ts}`;
    case 'task:update':
      // The action (executable + args), working dir, description, and run level
      // are all the change here, so all are signed — an on-path attacker on a
      // plaintext link mustn't be able to rewrite what the task runs (or with
      // what privileges) in flight. Fields are pre-normalized (empty string for
      // unset) so this matches AgentAuthenticator.UpdateMessage byte-for-byte.
      return `task:update|${cmd.taskPath}|${canonicalizeAction(cmd.action)}|${cmd.workingDirectory}|${cmd.description}|${cmd.runLevel}|${nonce}|${ts}`;
    case 'task:import':
      // The XML enters as a HASH, not by value. It is not a size optimization:
      // the XML IS the task — its action, its trigger, and its principal
      // (including RunLevel Highest and the account it runs as) — so leaving it
      // unsigned would make this signature decorative, while embedding it raw
      // would put arbitrary '|' bytes inside a pipe-delimited message. A
      // fixed-width digest is unambiguous on both sides of the language
      // boundary, the same reason canonicalizeAction/canonicalizeTrigger exist.
      //
      // `overwrite` and `createFolders` are signed because each widens what the
      // command may destroy or create: flipping overwrite turns a refusal into
      // the replacement of a task the user still has.
      return `task:import|${cmd.taskPath}|${sha256Hex(cmd.xml)}|${cmd.overwrite ? 1 : 0}|${cmd.createFolders ? 1 : 0}|${nonce}|${ts}`;
    case 'task:create':
      // `folder` is signed and sits last among the payload fields: it decides
      // WHERE the task is registered, and RegisterTaskDefinition silently
      // overwrites a same-named task in the same folder — so an unsigned folder
      // would let an on-path attacker redirect a create onto an existing task
      // and destroy it. `createFolder` follows it immediately and is signed for
      // the matching reason: it decides whether that folder may be brought into
      // existence, and an unsigned flag could turn an honest refusal into a
      // folder the user never asked for and cannot remove without elevation.
      return `task:create|${cmd.name}|${cmd.schedule}|${cmd.command}|${canonicalizeAction(cmd.action)}|${canonicalizeTrigger(cmd.trigger)}|${cmd.folder}|${cmd.createFolder ? 1 : 0}|${nonce}|${ts}`;
  }
}

/** A fresh per-command nonce. 16 bytes: collision-free in any real command rate. */
function newCommandNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Compute `{ nonce, ts, sig }` for a command using a known session key. The
 * nonce and ts are parameters rather than generated here so the cross-language
 * golden vectors stay deterministic (see __tests__/agentAuth.test.ts).
 *
 * WHY THE NONCE EXISTS — it fixes a real bug, it isn't belt-and-braces:
 * `ts` is second-granular, so two legitimate identical commands inside the same
 * second (a double-clicked Run Now, a script firing twice) produced a
 * BYTE-IDENTICAL message and therefore an identical signature. The agent's
 * replay guard keys on (ts, sig) and cannot distinguish that from a captured
 * frame being replayed, so it silently dropped the second one — and the backend,
 * having no reply, timed out after 15s and blamed the transport
 * ("Agent trigger timeout"). See docs/troubleshooting/README.md #16.
 *
 * The nonce restores the property the guard assumes: a legitimate re-send is
 * never byte-identical, while a replayed frame still is. It is INSIDE the signed
 * message (not merely alongside it) so an on-path attacker can't strip or
 * rewrite it — the same reason `folder` and `trigger` are signed. The agent's
 * replay cache needs no change: the signature is now unique per instance, so its
 * existing (ts, sig) key stops colliding on its own.
 */
export function signCommand(
  sessionKey: string,
  cmd: SignableCommand,
  ts: number,
  nonce: string
): { nonce: string; ts: number; sig: string } {
  return { nonce, ts, sig: hmacHex(sessionKey, commandMessage(cmd, nonce, ts)) };
}

/**
 * Emit a signed command to an authenticated agent socket. Every field the agent
 * acts on is part of the SignableCommand (and thus covered by the signature),
 * so the whole command minus `event` goes on the wire alongside
 * `{ nonce, ts, sig }`.
 */
export function emitSignedCommand(socket: Socket, cmd: SignableCommand): void {
  const sessionKey = socket.data?.sessionKey as string | undefined;
  if (!sessionKey) {
    throw new Error('cannot sign command: socket not authenticated');
  }
  const ts = Math.floor(Date.now() / 1000);
  const nonce = newCommandNonce();
  const { sig } = signCommand(sessionKey, cmd, ts, nonce);
  const { event, ...fields } = cmd;
  socket.emit(event, { ...fields, nonce, ts, sig });
}
