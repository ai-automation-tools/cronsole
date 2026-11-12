import { describe, it, expect } from 'vitest';
import { allowedHostnames, hostAllowed, hostnameOf, makeHostGate } from '../hosts.js';

describe('Host allowlist', () => {
  const allowed = allowedHostnames({
    ALLOWED_ORIGINS: 'http://localhost:7373, https://box.tailnet.ts.net',
    ALLOWED_HOSTS: 'cronsole.example.com'
  });

  it('reads the hostname and ignores the port', () => {
    expect(hostnameOf('LocalHost:3000')).toBe('localhost');
    expect(hostnameOf('[::1]:3000')).toBe('::1');
    expect(hostnameOf('a b')).toBeNull();
    expect(hostnameOf(undefined)).toBeNull();
  });

  it('allows loopback, IP literals, origin hosts and ALLOWED_HOSTS', () => {
    for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', '192.168.1.20:8080',
      'host.docker.internal:3000', 'box.tailnet.ts.net', 'cronsole.example.com:443']) {
      expect(hostAllowed(host, allowed), host).toBe(true);
    }
  });

  it('refuses a name nobody listed, which is what a rebinding page sends', () => {
    for (const host of ['attacker.example:3000', 'localhost.attacker.example', '', undefined]) {
      expect(hostAllowed(host, allowed), String(host)).toBe(false);
    }
  });

  it('logs a refused name once', () => {
    const warned: string[] = [];
    const gate = makeHostGate(allowed, m => warned.push(m));
    const refused: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      gate.hostAllowsRequest({ headers: { host: 'attacker.example' } } as never, (_e, ok) => refused.push(ok));
    }
    expect(refused).toEqual([false, false, false]);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('ALLOWED_HOSTS');
  });
});
