import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';

// Must be set before the module reads it (getPairingSecret is lazy, so setting
// it here is enough — but keep it at the top for clarity).
const SECRET = 'test-pairing-secret-value';
process.env.AGENT_PAIRING_SECRET = SECRET;

import {
  verifyHandshake,
  signCommand,
  getPairingSecret,
  _resetNonceCache,
  type SignableCommand,
} from '../agentAuth.js';

beforeEach(() => _resetNonceCache());

const hmac = (key: string, msg: string) =>
  crypto.createHmac('sha256', key).update(msg, 'utf8').digest('hex');

// Cross-language golden vector — the C# AgentAuthenticatorTests asserts these
// exact hex strings. If either side changes the HMAC message format, BOTH test
// suites break, which is the point.
const VEC = {
  secret: 'test-pairing-secret-value',
  agentId: 'test-agent',
  nonce: 'abc123',
  ts: 1700000000,
  sessionKey: '67d80428fd79e26dd92269f97474031860185d325df6c731cda179e22b53ff14',
  runSig: 'e76700fc1e7c6f8e6a9d85e76f17713c7e47c0b8b4b2e1b93b5866886ac02c48',
  deleteSig: 'ac32ed9af3b1904803cc54a7667e109e25e79c068f420c386c054374fd23d61f',
  statusSig: '9a01e71e17bba19ffadfa229be77c04d85ec4b92f2493cff9b1b107f13075133',
  // task:create signs the structured action AND the trigger. Golden case:
  // command 'dir', action { executable: 'dir', args: [] } -> canonical 'dir',
  // trigger null -> canonical 'none'.
  createSig: '4e04ffa6a881215d70a94ef84984898398567f7218d57f6cc3d9fa9264f9e0ba',
  // Same command with a Weekly trigger -> canonical
  // 'trigger|Weekly|09:30||Monday,Wednesday|PT30M|P1D'.
  createSigWithTrigger: 'e4bfa1a7b2c20bde20c72bf444b955dbad5c27c920af5fdddd5750191278643e',
};

/** Build a valid, fresh handshake auth payload for the given nonce. */
function freshHandshake(nonce = 'nonce-1', agentId = 'agent-1') {
  const ts = Math.floor(Date.now() / 1000);
  return { agentId, nonce, ts, hmac: hmac(SECRET, `${agentId}|${nonce}|${ts}`) };
}

describe('agentAuth cross-language vector', () => {
  it('derives the session key from the nonce', () => {
    expect(hmac(VEC.secret, `session:${VEC.nonce}`)).toBe(VEC.sessionKey);
  });

  it('signs each command to the golden signature', () => {
    const cases: Array<[SignableCommand, string]> = [
      [{ event: 'task:run', taskPath: 'MyTask' }, VEC.runSig],
      [{ event: 'task:delete', taskPath: 'MyTask' }, VEC.deleteSig],
      [{ event: 'task:set_status', taskPath: 'MyTask', enabled: false }, VEC.statusSig],
      [
        {
          event: 'task:create',
          name: 'Job',
          schedule: '0 3 * * *',
          command: 'dir',
          action: { executable: 'dir', args: [] },
          trigger: null,
        },
        VEC.createSig,
      ],
      [
        {
          event: 'task:create',
          name: 'Job',
          schedule: '0 3 * * *',
          command: 'dir',
          action: { executable: 'dir', args: [] },
          trigger: {
            type: 'Weekly',
            startBoundary: '09:30',
            daysOfWeek: ['Monday', 'Wednesday'],
            repetition: { interval: 'PT30M', duration: 'P1D' },
          },
        },
        VEC.createSigWithTrigger,
      ],
    ];
    for (const [cmd, expected] of cases) {
      expect(signCommand(VEC.sessionKey, cmd, VEC.ts).sig).toBe(expected);
    }
  });
});

describe('verifyHandshake', () => {
  it('accepts a valid handshake and returns identity + session key', () => {
    const identity = verifyHandshake(freshHandshake('n-abc', 'agent-x'));
    expect(identity.userId).toBe('cli_user_placeholder');
    expect(identity.agentId).toBe('agent-x');
    expect(identity.sessionKey).toBe(hmac(SECRET, 'session:n-abc'));
  });

  it('rejects a bad signature', () => {
    const auth = { ...freshHandshake(), hmac: 'deadbeef' };
    expect(() => verifyHandshake(auth)).toThrow(/signature/);
  });

  it('rejects a replayed handshake (same nonce twice)', () => {
    const auth = freshHandshake('replay-nonce', 'agent-r');
    expect(() => verifyHandshake(auth)).not.toThrow();
    expect(() => verifyHandshake(auth)).toThrow(/replay/);
  });

  it('rejects a stale timestamp', () => {
    const agentId = 'a';
    const nonce = 'n';
    const ts = Math.floor(Date.now() / 1000) - 10_000;
    expect(() =>
      verifyHandshake({ agentId, nonce, ts, hmac: hmac(SECRET, `${agentId}|${nonce}|${ts}`) })
    ).toThrow(/stale/);
  });

  it('rejects malformed / missing fields', () => {
    expect(() => verifyHandshake(null)).toThrow();
    expect(() => verifyHandshake({})).toThrow();
    expect(() => verifyHandshake({ agentId: 'a', nonce: 'n', ts: 'x', hmac: 'y' })).toThrow();
  });

  it('accepts a string timestamp equal to a number one', () => {
    const agentId = 'a';
    const nonce = 'n';
    const ts = Math.floor(Date.now() / 1000);
    const sig = hmac(SECRET, `${agentId}|${nonce}|${ts}`);
    expect(() => verifyHandshake({ agentId, nonce, ts: String(ts), hmac: sig })).not.toThrow();
  });
});

describe('getPairingSecret', () => {
  it('returns the configured secret', () => {
    expect(getPairingSecret()).toBe(SECRET);
  });

  it('throws when unset or too short', () => {
    const prev = process.env.AGENT_PAIRING_SECRET;
    try {
      process.env.AGENT_PAIRING_SECRET = 'short';
      expect(() => getPairingSecret()).toThrow(/AGENT_PAIRING_SECRET/);
      delete process.env.AGENT_PAIRING_SECRET;
      expect(() => getPairingSecret()).toThrow(/AGENT_PAIRING_SECRET/);
    } finally {
      process.env.AGENT_PAIRING_SECRET = prev;
    }
  });
});
