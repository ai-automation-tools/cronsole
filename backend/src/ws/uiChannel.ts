import type { Server } from 'socket.io';
import { verifyToken } from '../auth/auth.js';

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
  ns.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown })?.token;
    const user = typeof token === 'string' ? verifyToken(token) : null;
    if (!user) {
      return next(new Error('unauthorized'));
    }
    socket.data.userId = user.id;
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
