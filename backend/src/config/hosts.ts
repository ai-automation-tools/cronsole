import { isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { parseAllowedOrigins } from './origins.js';

/**
 * Which `Host` headers this API answers to.
 *
 * A page on any website can point its own DNS name at 127.0.0.1 after it has
 * loaded (DNS rebinding). The browser then treats this API as that page's own
 * origin, so CORS never applies, and the loopback bind does not help because the
 * request really does come from this machine. The one thing the page cannot
 * forge is the name: the request still says `Host: attacker.example`.
 *
 * Allowed without configuration: loopback names, any IP literal (rebinding needs
 * a DNS name), `host.docker.internal`, and the host of every ALLOWED_ORIGINS
 * entry, so a remote address that already works keeps working. Anything else
 * goes in ALLOWED_HOSTS. Ports are ignored.
 */
const ALWAYS = ['localhost', 'host.docker.internal'];

export function allowedHostnames(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const names = new Set(ALWAYS);
  for (const origin of parseAllowedOrigins(env.ALLOWED_ORIGINS)) {
    try {
      names.add(new URL(origin).hostname.toLowerCase());
    } catch {
      // Not a URL: origins.ts already reports what it refuses.
    }
  }
  for (const host of (env.ALLOWED_HOSTS || '').split(',')) {
    const name = host.trim().toLowerCase();
    if (name) names.add(name);
  }
  return names;
}

/** `example.com:3000` -> `example.com`; `[::1]:3000` -> `::1`. Null when unusable. */
export function hostnameOf(header: string | undefined): string | null {
  if (!header) return null;
  const value = header.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) return bracketed[1];
  const plain = /^([^:/\s]+)(?::\d+)?$/.exec(value);
  return plain ? plain[1] : null;
}

export function hostAllowed(header: string | undefined, allowed: Set<string> = allowedHostnames()): boolean {
  const name = hostnameOf(header);
  if (!name) return false;
  return isIP(name) !== 0 || allowed.has(name);
}

const refusalMessage = (header: string | undefined) =>
  `Host "${String(header ?? '').replace(/[^\x20-\x7e]/g, '?').slice(0, 120)}" is not allowed. ` +
  'Add it to ALLOWED_HOSTS in backend/.env and restart the backend.';

/** One gate for REST (`hostGuard`) and the Socket.IO handshake (`hostAllowsRequest`). */
export function makeHostGate(allowed: Set<string> = allowedHostnames(), warn: (m: string) => void = console.warn) {
  const logged = new Set<string>();
  const check = (header: string | undefined): boolean => {
    if (hostAllowed(header, allowed)) return true;
    const message = refusalMessage(header);
    // Logged once per name, and only the first few: the header is the caller's to choose.
    if (logged.size < 20 && !logged.has(message)) {
      logged.add(message);
      warn(message);
    }
    return false;
  };
  return {
    hostGuard(req: Request, res: Response, next: NextFunction) {
      if (check(req.headers.host)) return next();
      res.status(403).json({ error: refusalMessage(req.headers.host) });
    },
    hostAllowsRequest(req: IncomingMessage, callback: (err: string | null, ok: boolean) => void) {
      callback(null, check(req.headers.host));
    }
  };
}

/**
 * True when the request came straight from this machine: a loopback socket and no
 * proxy in between. Read from the socket, never `req.ip`, so TRUST_PROXY cannot
 * turn a forwarded request into a local one.
 */
export function isDirectLoopback(req: Request): boolean {
  if (req.headers['x-forwarded-for'] || req.headers.forwarded) return false;
  const address = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return address === '127.0.0.1' || address === '::1';
}
