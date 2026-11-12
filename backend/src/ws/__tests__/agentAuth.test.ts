import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  protocolRefusal,
  PROTOCOL_VERSION,
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
// Regenerated 2026-11-11 for wire protocol 2: every message is length-prefixed
// fields (frameFields) instead of pipe-joined text. The generator first
// reproduced the committed v1 vectors from the v1 format, then both suites
// recomputed these independently.
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
  runSig: '40851ae88bea9f403056337d4140852cb6449a9e217533663ce5151949866412',
  deleteSig: '819ee6600758cf5f43fb3ab0be5a5c9f410367c85ee29c1adfb89e772414b87b',
  statusSig: '85f7ee5c3adc3a8d938bc5ddfee7eced0bcd07c695256523e645193e062510dd',
  // task:update_schedule signs the trigger. Golden case: Daily 03:00,
  // daysInterval 1 -> canonical '7:trigger5:Daily5:03:001:10:0:0:'.
  updateScheduleSig: '8aa21aaed0c3bf300265d1c2f8995f165bde73eb8b60ced46f961e8eb725b144',
  // task:update signs the structured action, working dir, description, and run
  // level. Golden case: action { executable: 'powershell.exe', args: ['-File',
  // 'C:\\x.ps1'] } -> canonical '14:powershell.exe5:-File8:C:\\x.ps1', working
  // dir 'C:\\scripts', description 'Nightly job', runLevel 'highest'.
  updateSig: '15e78eed13b6fb8b908070583439a5bcd8485ab564e2946c24f4fd20e7fb2c60',
  // task:create signs the structured action, the trigger, the destination
  // folder, AND the createFolder flag. Golden case: command 'dir', action
  // { executable: 'dir', args: [] } -> canonical '3:dir', trigger null ->
  // canonical 'none', folder '\Cronsole', createFolder false -> '0'.
  //
  // This constant has changed three times, each because the signed INPUT or
  // FORMAT changed: on 2026-07-31 the fixture's folder moved '\TaskHub' ->
  // '\Cronsole' with the rename, on 2026-08-04 the createFolder flag joined the
  // message after `folder`, and on 2026-11-11 wire protocol 2 framed every
  // field. **Those are the only circumstances in which it may be updated.** Both regenerations were validated by first reproducing the
  // PREVIOUS committed vectors from the previous format — a generator that
  // can't reproduce what's already in the repo emits new values that are
  // confidently wrong and then get pinned by both suites, i.e. a lie agreed on
  // twice. Both implementations then recomputed independently and produced the
  // same value; the disagreement was with the frozen constant, not between the
  // languages, which is exactly what this vector exists to distinguish. Never
  // "fix" a mismatch here by pasting in whatever one side currently emits — a
  // divergence between C# and TypeScript is the bug it is built to catch.
  createSig: '1f5126aec4472b685cb1cf520a1445ce1b255c71e3d3ef3475a5ced567b26f41',
  // Same command with a Weekly trigger -> canonical
  // '7:trigger6:Weekly5:09:300:16:Monday,Wednesday5:PT30M3:P1D'.
  createSigWithTrigger: '52ae01c77c1065ab16b46b1b745c681789ca13dca5c519bdd6162f43f369fcba',
  // Same command as createSig but with createFolder TRUE. Pinned separately and
  // deliberately: with only a false case, an implementation that hard-coded '0'
  // — or dropped the field entirely and happened to match — would pass. Two
  // cases differing in exactly one bit are what prove the bit is actually signed.
  createSigWithFolderCreate: '645ba49ac57da03312b45d3662c3d41bc594fc809faa3538ab533f504f30ea87',
  // task:import signs the XML BY HASH, plus both blast-radius flags. Golden
  // case: the XML below, overwrite false, createFolders true.
  importXml: '<Task><RegistrationInfo><URI>\\Work\\Job</URI></RegistrationInfo></Task>',
  importXmlSha256: 'dfd743c7a30868f6f2d62e3b9ceb16fb77c8a72c1509b1726dfc646072170281',
  importSig: '2b92301b29fd6eda71f48f9672bbbfea78918bc0a2f3c00bdb0608959524ef58',
};

/** Build a valid, fresh handshake auth payload for the given nonce. */
// A handshake nonce must be 32 lowercase hex, as the agent's Guid "N" is.
const hexNonce = (label: string) => crypto.createHash('sha256').update(label).digest('hex').slice(0, 32);

function freshHandshake(label = 'nonce-1', agentId = 'agent-1') {
  const nonce = hexNonce(label);
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
        data: { sessionKey: VEC.sessionKey, protocolVersion: PROTOCOL_VERSION },
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
    // Written out by hand, not through frameFields: length, colon, field.
    expect(String(ts)).toHaveLength(10);
    expect(hmac(VEC.sessionKey, `8:task:run6:MyTask32:${nonce}10:${ts}`)).toBe(sig);
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

  it('refuses to sign for an agent on another wire version, and names the fix', () => {
    // An agent on v1 rebuilds a pipe-joined message and rejects every command
    // in silence. A sentence now beats a timeout fifteen seconds later.
    for (const protocolVersion of [1, undefined]) {
      const emit = vi.fn();
      const socket = { data: { sessionKey: VEC.sessionKey, protocolVersion }, emit } as any;
      expect(protocolRefusal(socket)).toMatch(/Republish-Agent\.ps1/);
      expect(() => emitSignedCommand(socket, { event: 'task:run', taskPath: 'MyTask' })).toThrow(/wire protocol/);
      expect(emit).not.toHaveBeenCalled();
    }
    const newer = { data: { sessionKey: VEC.sessionKey, protocolVersion: PROTOCOL_VERSION + 1 }, emit: vi.fn() } as any;
    expect(protocolRefusal(newer)).toMatch(/cronsole\.ps1 update/);
    expect(protocolRefusal({ data: { protocolVersion: PROTOCOL_VERSION } } as any)).toBeNull();
  });
});

describe('field boundaries (wire protocol 2)', () => {
  const sign = (cmd: SignableCommand) => signCommand(VEC.sessionKey, cmd, VEC.ts, VEC.commandNonce).sig;

  it('gives two commands that differ only in where a field ends different signatures', () => {
    // Under v1 both of each pair were the same pipe-joined string, so one
    // signature covered two different commands.
    const update = { event: 'task:update' as const, taskPath: 'T', action: { executable: 'x', args: [] }, runLevel: 'least' as const };
    expect(sign({ ...update, workingDirectory: 'a|b', description: 'c' }))
      .not.toBe(sign({ ...update, workingDirectory: 'a', description: 'b|c' }));

    const create = { event: 'task:create' as const, command: 'dir', action: { executable: 'dir', args: [] }, trigger: null, folder: '\\Cronsole', createFolder: false };
    expect(sign({ ...create, name: 'a|b', schedule: 'c' })).not.toBe(sign({ ...create, name: 'a', schedule: 'b|c' }));

    // Inside the nested lists too: one argument is not two.
    const run = (args: string[]) => sign({ ...update, workingDirectory: '', description: '', action: { executable: 'x', args } });
    expect(run(['a', 'b'])).not.toBe(run(['a\x1fb']));
    expect(run(['1:a'])).not.toBe(run(['', 'a']));
  });
});

describe('verifyHandshake', () => {
  it('accepts a valid handshake and returns identity + session key', () => {
    const auth = freshHandshake('n-abc', 'agent-x');
    const identity = verifyHandshake(auth);
    expect(identity.userId).toBe('cli_user_placeholder');
    expect(identity.agentId).toBe('agent-x');
    expect(identity.sessionKey).toBe(hmac(SECRET, `session:${auth.nonce}`));
    // An agent built before the handshake carried a version says nothing.
    expect(identity.protocolVersion).toBeUndefined();
    expect(verifyHandshake({ ...freshHandshake('n-v2'), protocolVersion: 2 }).protocolVersion).toBe(2);
  });

  it('rejects a nonce that is not 32 lowercase hex, even correctly signed', () => {
    // The handshake message is still pipe-joined. With the nonce held to this
    // shape and a numeric timestamp it has one reading only: agentId 'a|b' with
    // nonce N cannot also be agentId 'a' with nonce 'b|N'.
    const ts = Math.floor(Date.now() / 1000);
    const nonce = `b|${hexNonce('x')}`;
    expect(() => verifyHandshake({ agentId: 'a', nonce, ts, hmac: hmac(SECRET, `a|${nonce}|${ts}`) }))
      .toThrow(/nonce/);
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
    const nonce = hexNonce('n');
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
    const nonce = hexNonce('n');
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
