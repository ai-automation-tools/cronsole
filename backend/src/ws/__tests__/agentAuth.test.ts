import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';

// Must be set before the module reads it (getPairingSecret is lazy, so setting
// it here is enough — but keep it at the top for clarity).
const SECRET = 'test-pairing-secret-value';
process.env.AGENT_PAIRING_SECRET = SECRET;

import {
  verifyHandshake,
  signCommand,
  emitSignedCommand,
  getPairingSecret,
  sha256Hex,
  _resetNonceCache,
  type SignableCommand,
} from '../agentAuth.js';

beforeEach(() => _resetNonceCache());

const hmac = (key: string, msg: string) =>
  crypto.createHmac('sha256', key).update(msg, 'utf8').digest('hex');

// Cross-language golden vector — the C# AgentAuthenticatorTests asserts these
// exact hex strings. If either side changes the HMAC message format, BOTH test
// suites break, which is the point.
//
// Regenerated 2026-07-15 for the per-command nonce, which sits immediately
// before `ts` in every message. The regeneration was validated by first
// reproducing the PREVIOUS committed vectors from the old format — a generator
// that can't reproduce what's already in the repo would emit new values that are
// confidently wrong and then get pinned by both suites, i.e. a lie agreed on
// twice.
const VEC = {
  secret: 'test-pairing-secret-value',
  agentId: 'test-agent',
  // The HANDSHAKE nonce (derives the session key). Distinct from commandNonce
  // below — they do different jobs and are deliberately not shared.
  nonce: 'abc123',
  // The PER-COMMAND nonce: what makes two otherwise-identical commands in the
  // same second sign differently (troubleshooting #16). Fixed here so the
  // vectors stay deterministic; random in production.
  commandNonce: 'd1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6',
  ts: 1700000000,
  sessionKey: '67d80428fd79e26dd92269f97474031860185d325df6c731cda179e22b53ff14',
  runSig: '1b05698c29c1761cccca0831edea73ee4de990024294056f39a037819f2fbc92',
  deleteSig: '895b3da37ada2786afc47a0aa16404a395fd1ac9404b28f1597f451b2e76b36f',
  statusSig: '0ed95b89b34854fa0e99f2813d5049a542b883332a5f572e033820081ede0d2b',
  // task:update_schedule signs the trigger. Golden case: Daily 03:00,
  // daysInterval 1 -> canonical 'trigger|Daily|03:00|1|||'.
  updateScheduleSig: 'f2d3877a970941645fc82da9d1bf1e829593a7b9b73e7cc1cd3739c89859ac83',
  // task:update signs the structured action, working dir, description, and run
  // level. Golden case: action { executable: 'powershell.exe', args: ['-File',
  // 'C:\\x.ps1'] } -> canonical 'powershell.exe\x1f-File\x1fC:\\x.ps1', working
  // dir 'C:\\scripts', description 'Nightly job', runLevel 'highest'.
  updateSig: '1032132b7efe16c1f45773d628783f4a0ea82f1a73f03f891ee91359f5a7e135',
  // task:create signs the structured action, the trigger, the destination
  // folder, AND the createFolder flag. Golden case: command 'dir', action
  // { executable: 'dir', args: [] } -> canonical 'dir', trigger null ->
  // canonical 'none', folder '\Cronsole', createFolder false -> '0'.
  //
  // This constant has changed exactly twice, both times because the signed INPUT
  // changed: on 2026-07-31 the fixture's folder moved '\TaskHub' -> '\Cronsole'
  // with the rename, and on 2026-08-04 the createFolder flag joined the message
  // after `folder`. **Those are the only circumstances in which it may be
  // updated.** Both regenerations were validated by first reproducing the
  // PREVIOUS committed vectors from the previous format — a generator that
  // can't reproduce what's already in the repo emits new values that are
  // confidently wrong and then get pinned by both suites, i.e. a lie agreed on
  // twice. Both implementations then recomputed independently and produced the
  // same value; the disagreement was with the frozen constant, not between the
  // languages, which is exactly what this vector exists to distinguish. Never
  // "fix" a mismatch here by pasting in whatever one side currently emits — a
  // divergence between C# and TypeScript is the bug it is built to catch.
  createSig: 'e3c75a695f47bd2c3324cff295543b5b2b846efeb6f27e1b53939017a44ddb8c',
  // Same command with a Weekly trigger -> canonical
  // 'trigger|Weekly|09:30||Monday,Wednesday|PT30M|P1D'.
  createSigWithTrigger: '0071cff5171a0dacafaf07673b372867e7ab2e5ebaebbf66af24139b762295a9',
  // Same command as createSig but with createFolder TRUE. Pinned separately and
  // deliberately: with only a false case, an implementation that hard-coded '0'
  // — or dropped the field entirely and happened to match — would pass. Two
  // cases differing in exactly one bit are what prove the bit is actually signed.
  createSigWithFolderCreate: 'd525bcc9f125bb4c77db4c53f6110946fb71884f949f5ffa7636582dfb2337fe',
  // task:import signs the XML BY HASH, plus both blast-radius flags. Golden
  // case: the XML below, overwrite false, createFolders true.
  importXml: '<Task><RegistrationInfo><URI>\\Work\\Job</URI></RegistrationInfo></Task>',
  importXmlSha256: 'dfd743c7a30868f6f2d62e3b9ceb16fb77c8a72c1509b1726dfc646072170281',
  importSig: 'c6a8e92c11599c98dac759094220d8d6826c9a457e4f3ce9f83172b3144130a4',
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
          event: 'task:update_schedule',
          taskPath: 'MyTask',
          trigger: { type: 'Daily', startBoundary: '03:00', daysInterval: 1 },
        },
        VEC.updateScheduleSig,
      ],
      [
        {
          event: 'task:update',
          taskPath: 'MyTask',
          action: { executable: 'powershell.exe', args: ['-File', 'C:\\x.ps1'] },
          workingDirectory: 'C:\\scripts',
          description: 'Nightly job',
          runLevel: 'highest',
        },
        VEC.updateSig,
      ],
      [
        {
          event: 'task:create',
          name: 'Job',
          schedule: '0 3 * * *',
          command: 'dir',
          action: { executable: 'dir', args: [] },
          trigger: null,
          folder: '\\Cronsole',
          createFolder: false,
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
          folder: '\\Cronsole',
          createFolder: false,
        },
        VEC.createSigWithTrigger,
      ],
      // Identical to the createSig case above except createFolder — so the pair
      // proves the flag reaches the signature, not merely that the message is
      // stable.
      [
        {
          event: 'task:create',
          name: 'Job',
          schedule: '0 3 * * *',
          command: 'dir',
          action: { executable: 'dir', args: [] },
          trigger: null,
          folder: '\\Cronsole',
          createFolder: true,
        },
        VEC.createSigWithFolderCreate,
      ],
      [
        {
          event: 'task:import',
          taskPath: 'MyTask',
          xml: VEC.importXml,
          overwrite: false,
          createFolders: true,
        },
        VEC.importSig,
      ],
    ];
    for (const [cmd, expected] of cases) {
      expect(signCommand(VEC.sessionKey, cmd, VEC.ts, VEC.commandNonce).sig).toBe(expected);
    }
  });

  it('hashes the import XML to the golden digest', () => {
    // Pinned separately from the signature so a mismatch says WHICH half moved:
    // the digest agreement between Node and .NET, or the message format around it.
    expect(sha256Hex(VEC.importXml)).toBe(VEC.importXmlSha256);
  });

  // The XML *is* the task — its action, its trigger, and the account it runs as.
  // If it were outside the signed message, an on-path attacker could leave the
  // path and flags intact and swap the definition, and the signature would still
  // verify. Same for the two flags: each one widens what the command may destroy
  // or create.
  it('signs the XML and both blast-radius flags, so tampering with any of them breaks the signature', () => {
    const base = {
      event: 'task:import' as const,
      taskPath: 'MyTask',
      xml: VEC.importXml,
      overwrite: false,
      createFolders: true,
    };
    const sign = (cmd: SignableCommand) => signCommand(VEC.sessionKey, cmd, VEC.ts, VEC.commandNonce).sig;

    // Compared against a FRESHLY signed baseline, not the golden constant: if a
    // field were dropped from the message entirely, every mutation would still
    // differ from the stale golden value and this test would pass while proving
    // nothing. Against a live baseline, a dropped field makes the pair collide.
    const baseline = sign(base);
    expect(sign({ ...base, xml: VEC.importXml + ' ' })).not.toBe(baseline);
    expect(sign({ ...base, overwrite: true })).not.toBe(baseline);
    expect(sign({ ...base, createFolders: false })).not.toBe(baseline);
    expect(sign({ ...base, taskPath: 'OtherTask' })).not.toBe(baseline);
  });

  // The bug the nonce exists for (troubleshooting #16). `ts` is second-granular,
  // so before this, two legitimate identical commands inside one second produced
  // a byte-identical signature — indistinguishable from a replayed frame, so the
  // agent's replay guard silently dropped the second one and the backend timed
  // out blaming the transport. These pin BOTH halves of the property: distinct
  // instances differ, and a genuine replay still collides.
  it('signs two identical commands in the SAME second differently', () => {
    const cmd: SignableCommand = { event: 'task:run', taskPath: 'MyTask' };
    const a = signCommand(VEC.sessionKey, cmd, VEC.ts, 'a'.repeat(32));
    const b = signCommand(VEC.sessionKey, cmd, VEC.ts, 'b'.repeat(32));
    expect(a.sig).not.toBe(b.sig);
  });

  it('still signs a replayed frame (same nonce, same ts) identically', () => {
    // The replay guard keys on (ts, sig), so this MUST stay stable — otherwise
    // the nonce would have fixed the false-reject by breaking replay detection.
    const cmd: SignableCommand = { event: 'task:run', taskPath: 'MyTask' };
    const a = signCommand(VEC.sessionKey, cmd, VEC.ts, VEC.commandNonce);
    const b = signCommand(VEC.sessionKey, cmd, VEC.ts, VEC.commandNonce);
    expect(a.sig).toBe(b.sig);
  });

  it('covers the nonce with the signature, so it cannot be swapped in flight', () => {
    // The nonce is INSIDE the signed message, not merely alongside it. If it
    // were unsigned, an on-path attacker could rewrite it and turn a replayed
    // frame into a "fresh" command — the same reasoning that puts `folder` and
    // `trigger` inside the signature.
    const cmd: SignableCommand = { event: 'task:run', taskPath: 'MyTask' };
    const signed = signCommand(VEC.sessionKey, cmd, VEC.ts, VEC.commandNonce);
    const tampered = signCommand(VEC.sessionKey, cmd, VEC.ts, 'f'.repeat(32));
    expect(tampered.sig).not.toBe(signed.sig);
  });
});

describe('emitSignedCommand', () => {
  // A fake authenticated socket that records what went on the wire.
  function fakeSocket() {
    const sent: Array<{ event: string; payload: any }> = [];
    return {
      sent,
      socket: {
        data: { sessionKey: VEC.sessionKey },
        emit: (event: string, payload: any) => sent.push({ event, payload }),
      } as any,
    };
  }

  it('puts the nonce ON THE WIRE, not only in the signature', () => {
    // Load-bearing: the agent rebuilds the signed message locally, so it needs
    // the exact nonce. Signing with a nonce and forgetting to emit it would make
    // EVERY command unverifiable — and the agent's rejection is silent, so it
    // would surface as the same 15s "Agent trigger timeout" this change exists
    // to eliminate (#16), only permanently.
    const { socket, sent } = fakeSocket();
    emitSignedCommand(socket, { event: 'task:run', taskPath: 'MyTask' });
    expect(sent).toHaveLength(1);
    expect(sent[0].event).toBe('task:run');
    expect(typeof sent[0].payload.nonce).toBe('string');
    expect(sent[0].payload.nonce.length).toBeGreaterThan(0);
    expect(sent[0].payload).toMatchObject({ taskPath: 'MyTask' });
    expect(typeof sent[0].payload.ts).toBe('number');
    expect(typeof sent[0].payload.sig).toBe('string');
  });

  it('emits a nonce the emitted signature actually verifies against', () => {
    // Ties the two halves together: the nonce on the wire must be the one that
    // was signed. A mismatch (e.g. generating it twice) passes the shape check
    // above and still rejects every command on the agent.
    const { socket, sent } = fakeSocket();
    emitSignedCommand(socket, { event: 'task:run', taskPath: 'MyTask' });
    const { nonce, ts, sig } = sent[0].payload;
    expect(hmac(VEC.sessionKey, `task:run|MyTask|${nonce}|${ts}`)).toBe(sig);
  });

  it('uses a DIFFERENT nonce for each emit, even within the same second', () => {
    // The actual fix for #16, at the layer that ships it.
    const { socket, sent } = fakeSocket();
    emitSignedCommand(socket, { event: 'task:run', taskPath: 'MyTask' });
    emitSignedCommand(socket, { event: 'task:run', taskPath: 'MyTask' });
    expect(sent[0].payload.ts).toBe(sent[1].payload.ts); // same second — the trap
    expect(sent[0].payload.nonce).not.toBe(sent[1].payload.nonce);
    expect(sent[0].payload.sig).not.toBe(sent[1].payload.sig); // ...but distinct
  });

  it('refuses to sign for an unauthenticated socket', () => {
    expect(() =>
      emitSignedCommand({ data: {}, emit: () => {} } as any, {
        event: 'task:run',
        taskPath: 'MyTask',
      })
    ).toThrow(/not authenticated/);
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
