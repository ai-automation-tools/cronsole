import type { Server } from 'socket.io';
import { checkToken } from '../auth/auth.js';

/**
 * Browser live-update channel.
 *
 * Dashboards open a receive-only Socket.IO connection to the `/ui` namespace and
 * get a `task:updated` ping whenever their task list changes (a sync, a run, a
 * native scheduler fire, a create/delete in another tab). The client invalidates
 * its ['tasks'] query in response — replacing periodic polling with push, so the
 * dashboard stops lagging behind the agent.
 *
 * This namespace is intentionally SEPARATE from the agent channel (the default
 * namespace, guarded by the pairing-secret HMAC in agentAuth.ts): agents keep
 * their exact middleware, and browsers authenticate here with the user's JWT and
 * can only listen — no command handlers are registered. Events are scoped to a
 * per-user room so one user never receives another's updates.
 */

const NS = '/ui';
let ioRef: Server | null = null;

function room(userId: string): string {
  return `user:${userId}`;
}

/** Wire up the `/ui` namespace on the given server. Call once at startup. */
export function registerUiChannel(io: Server): void {
  ioRef = io;
  const ns = io.of(NS);

  // Authenticate on the handshake with the user's JWT (sent as auth.token).
  // Async on purpose: an API token's revocation lives in the database, and
  // `checkToken` is the one definition of "is this good right now" that the REST
  // middleware also uses. A revoked token that the API refuses but this handshake
  // accepts would keep streaming task updates over an open channel — revocation
  // has to cover every door or it is not revocation.
  ns.use(async (socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown })?.token;
    if (typeof token !== 'string') {
      return next(new Error('unauthorized'));
    }
    const result = await checkToken(token);
    if (!result.ok) {
      return next(new Error('unauthorized'));
    }
    socket.data.userId = result.user.id;
    next();
  });

  ns.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    socket.join(room(userId));
    // Receive-only: no inbound event handlers on purpose.
  });
}

/**
 * Ping a user's open dashboards that their task list changed. Safe no-op if the
 * channel isn't registered (e.g. in tests) so callers never have to guard.
 */
export function notifyTasksChanged(userId: string): void {
  if (!ioRef || !userId) return;
  ioRef.of(NS).to(room(userId)).emit('task:updated');
}
