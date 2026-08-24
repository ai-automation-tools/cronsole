import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { PlatformType } from '@prisma/client';

/**
 * **The Claude connector's boundaries depend on the machine, so they are pinned
 * to a stated one.**
 *
 * Since 2026-08-13 `ClaudeConnector.unsupportedVerbs` is a getter: with a Claude
 * Code session readable on this host, `create` / `setStatus` / `updateSchedule`
 * work; without one they are boundaries. That is the matrix behaving exactly as
 * designed — a cell is *"a claim about this install"* — but it means an
 * unmocked suite would report different capabilities on a developer's laptop
 * than in CI. Every case below therefore states which world it is in.
 */
vi.mock('../claudeOAuth.js', () => ({ getClaudeCredential: vi.fn() }));
import { getClaudeCredential } from '../claudeOAuth.js';

const credential = getClaudeCredential as unknown as ReturnType<typeof vi.fn>;
const noClaudeSession = () => credential.mockReturnValue({ credential: null, problem: 'no-file' });
const withClaudeSession = () =>
  credential.mockReturnValue({ credential: { token: 'sk-ant-oat01-account', source: 'file' } });

beforeEach(noClaudeSession);
import {
  CAPABILITY_VERBS,
  MATRIX_PLATFORMS,
  PLATFORM_DESCRIPTORS,
  capabilitySupport,
  runVerbSucceeded,
  connectorFor,
  verbReachability,
  verbDeclaredUnsupported,
  type CapabilityVerb
} from '../platformCapabilities.js';

/**
 * The matrix's whole value is that a cell is a fact rather than a claim, so the
 * two ways it could quietly become a spec table both get pinned here:
 *
 *  1. **Drift from the connectors** — a verb whose route defers to the connector
 *     must agree with the connector object, so adding `deleteTask` to a
 *     connector cannot leave the matrix reporting it unsupported (or vice versa).
 *  2. **Drift from the routes** — the three Cronsole-native carve-outs are the
 *     one place the table states something the connector cannot tell us, so they
 *     are checked against the route source that implements them. Delete the
 *     native export branch and this test fails, rather than the Platforms tab
 *     quietly promising something the API now 400s.
 */

const routesSource = readFileSync(new URL('../../routes/tasks.ts', import.meta.url), 'utf8');

/** Verbs whose reachability the route decides by looking at the connector. */
const CONNECTOR_DERIVED: Array<{ verb: CapabilityVerb; method: string }> = [
  { verb: 'updateSchedule', method: 'updateSchedule' },
  { verb: 'updateAction', method: 'updateActions' },
  { verb: 'export', method: 'exportTask' },
  { verb: 'restore', method: 'importTask' },
  { verb: 'delete', method: 'deleteTask' },
  { verb: 'listFolders', method: 'listFolders' }
];

/**
 * The verbs `PlatformConnector` makes mandatory, so every connector has them.
 *
 * Having the *method* is not the same as the platform having the *capability* —
 * a connector may declare one impossible via `unsupportedVerbs`, which is why
 * the assertion below compares against that list rather than to `true`.
 */
const ALWAYS_PRESENT: CapabilityVerb[] = ['sync', 'run', 'create', 'setStatus'];

describe('capability verb table', () => {
  it('lists each verb exactly once', () => {
    const verbs = CAPABILITY_VERBS.map(v => v.verb);
    expect(new Set(verbs).size).toBe(verbs.length);
  });

  it('gives every matrix platform a descriptor', () => {
    for (const platform of MATRIX_PLATFORMS) {
      expect(PLATFORM_DESCRIPTORS[platform]).toBeDefined();
    }
  });

  it('covers only platforms that have a connector', () => {
    // A link-only platform belongs in the custom-links section, not as ten
    // `unsupported` cells that say nothing.
    for (const platform of MATRIX_PLATFORMS) {
      expect(connectorFor(platform)).toBeDefined();
    }
  });
});

describe('verbReachability agrees with the connectors', () => {
  for (const platform of MATRIX_PLATFORMS) {
    it(`${platform}: mandatory verbs are reachable unless declared impossible`, () => {
      const declaredImpossible = connectorFor(platform)?.unsupportedVerbs ?? [];
      for (const verb of ALWAYS_PRESENT) {
        expect(verbReachability(platform, verb)).toBe(!declaredImpossible.includes(verb));
      }
    });
  }

  it('a declared-impossible verb is unsupported, not merely unproven', () => {
    // The distinction this mechanism exists for. With no Claude Code session on
    // the machine, `create` has a method (the interface demands one) that can
    // only ever return `{ success: false }`, because the documented API exposes
    // no create endpoint. Reported as `declared` it reads "reachable, just
    // unproven" and invites the user to wait for evidence that cannot arrive.
    const claude = connectorFor(PlatformType.CLAUDE_CODE)!;
    expect(typeof claude.createTask).toBe('function');
    expect(claude.unsupportedVerbs).toContain('create');
    expect(verbReachability(PlatformType.CLAUDE_CODE, 'create')).toBe(false);
    expect(capabilitySupport(false, null)).toBe('unsupported');

    // And `run` — the verb Claude has through either API — stays reachable, so
    // the declaration cannot be read as "this connector does nothing".
    expect(verbReachability(PlatformType.CLAUDE_CODE, 'run')).toBe(true);
  });

  it('re-reads the boundary per install, because that is what the cell claims', () => {
    // The same connector, the same code, a different machine. A fixed array
    // could only be right in one of these two worlds, and being wrong in the
    // permissive direction is the spec-table lie the matrix exists to prevent.
    const claude = connectorFor(PlatformType.CLAUDE_CODE)!;
    expect([...claude.unsupportedVerbs!]).toEqual(['create', 'setStatus', 'updateSchedule']);

    withClaudeSession();
    expect([...claude.unsupportedVerbs!]).toEqual([]);
    for (const verb of ['create', 'setStatus', 'updateSchedule'] as CapabilityVerb[]) {
      expect(verbReachability(PlatformType.CLAUDE_CODE, verb)).toBe(true);
      // No longer a boundary, so no longer a 400 — a failure here is now a real
      // platform failure and must be reported as one.
      expect(verbDeclaredUnsupported(PlatformType.CLAUDE_CODE, verb)).toBe(false);
    }

    // Delete stays unsupported in BOTH worlds: neither API exposes one.
    expect(verbReachability(PlatformType.CLAUDE_CODE, 'delete')).toBe(false);
  });

  it('declared-impossible verbs outrank every other reachability rule', () => {
    // Ordering guard. `unsupportedVerbs` is checked before the mandatory-verb
    // branch that would otherwise return true, and before the Cronsole-native
    // carve-outs. Moving the check below either one would silently restore the
    // exact `declared` cells this exists to remove.
    for (const platform of MATRIX_PLATFORMS) {
      for (const verb of connectorFor(platform)?.unsupportedVerbs ?? []) {
        expect(verbReachability(platform, verb)).toBe(false);
      }
    }
  });

  // Windows and Claude have no route-level carve-outs, so for them the connector
  // object IS the authority and any disagreement is drift.
  //
  // "The connector object" means the method *and* its declared boundaries, not
  // the method alone. Claude's `updateSchedule` is now always present and is a
  // boundary only when no Claude Code session is readable — so a check that read
  // `typeof connector.updateSchedule` by itself would demand the matrix report a
  // verb as reachable while the connector was declaring it impossible. That is
  // the ordering `unsupportedVerbs` exists to impose, tested one layer down.
  for (const platform of [PlatformType.WINDOWS_TASK_SCHEDULER, PlatformType.CLAUDE_CODE]) {
    for (const { verb, method } of CONNECTOR_DERIVED) {
      it(`${platform}: ${verb} matches connector.${method}`, () => {
        const connector = connectorFor(platform) as unknown as Record<string, unknown>;
        const declaredImpossible = (connectorFor(platform)?.unsupportedVerbs ?? []).includes(verb);
        expect(verbReachability(platform, verb)).toBe(
          typeof connector[method] === 'function' && !declaredImpossible
        );
      });
    }
  }

  it('tells the routes which refusals are boundaries, so they can pick 400 over 5xx', () => {
    // A verb with no API is not a gateway having a moment. Pinned because the
    // only visible difference is a status code, and a 502 tells the caller to
    // retry something that can never work.
    expect(verbDeclaredUnsupported(PlatformType.CLAUDE_CODE, 'setStatus')).toBe(true);
    expect(verbDeclaredUnsupported(PlatformType.CLAUDE_CODE, 'create')).toBe(true);
    // A verb that merely failed today stays a 5xx — the agent being offline is
    // exactly the retryable case 502 is for.
    expect(verbDeclaredUnsupported(PlatformType.WINDOWS_TASK_SCHEDULER, 'setStatus')).toBe(false);
    expect(verbDeclaredUnsupported(PlatformType.CLAUDE_CODE, 'run')).toBe(false);
    expect(verbDeclaredUnsupported(PlatformType.JULES, 'create')).toBe(false);
  });

  it('a platform with no connector is unsupported across the board', () => {
    for (const { verb } of CAPABILITY_VERBS) {
      expect(verbReachability(PlatformType.JULES, verb)).toBe(false);
    }
  });
});

describe('Cronsole-native route-level carve-outs', () => {
  const NATIVE = PlatformType.TASKHUB_NATIVE;

  it('reports reschedule, export and delete as reachable', () => {
    // The connector implements none of the three — the route does. A matrix
    // derived from the connector alone would report native as unable to do
    // things it does every day, which is the failure this module exists to stop.
    const connector = connectorFor(NATIVE) as unknown as Record<string, unknown>;
    expect(typeof connector.updateSchedule).toBe('undefined');
    expect(typeof connector.exportTask).toBe('undefined');
    expect(typeof connector.deleteTask).toBe('undefined');

    expect(verbReachability(NATIVE, 'updateSchedule')).toBe(true);
    expect(verbReachability(NATIVE, 'export')).toBe(true);
    expect(verbReachability(NATIVE, 'delete')).toBe(true);
    // Added 2026-08-12 with PATCH /tasks/:id/job. Native has no `updateActions`
    // connector method and never will — the row IS the task — so a
    // connector-derived answer would report the platform as unable to change
    // what it runs, which it does without an agent and while one is offline.
    expect(verbReachability(NATIVE, 'updateAction')).toBe(true);
  });

  it('the routes really do handle those three natively', () => {
    // Source-level, deliberately: the claim is about the route's branching, and
    // nothing else in the suite would notice a branch being removed.
    const nativeBranches = routesSource.match(/task\.platform === PlatformType\.TASKHUB_NATIVE/g) ?? [];
    expect(nativeBranches.length).toBeGreaterThanOrEqual(3);
    expect(routesSource).toContain("recordCapability(userId, task.platform, 'updateSchedule', true)");
    expect(routesSource).toContain("recordCapability(userId, task.platform, 'export', true)");
    expect(routesSource).toContain("recordCapability(userId, task.platform, 'delete', true)");
    // The job route branches on the platform the other way round — it refuses
    // anything that is NOT native — so it is asserted by its own writer instead.
    expect(routesSource).toContain(
      "recordCapability(userId, PlatformType.TASKHUB_NATIVE, 'updateAction', true)"
    );
  });

  it('does not claim the verbs the route has no native branch for', () => {
    // Restore has no native file format to restore from, and there is no folder
    // hierarchy to list. (`updateAction` used to be listed here, because the
    // /actions route defers wholly to the connector — until /job gave native its
    // own way to change what a task runs.)
    expect(verbReachability(NATIVE, 'restore')).toBe(false);
    expect(verbReachability(NATIVE, 'listFolders')).toBe(false);
  });
});

describe('capabilitySupport', () => {
  it('is unsupported when the route would refuse, regardless of evidence', () => {
    expect(capabilitySupport(false, null)).toBe('unsupported');
    // A stale success on a verb since removed must not outrank the refusal —
    // the user needs to know what will happen now, not what once did.
    expect(capabilitySupport(false, new Date())).toBe('unsupported');
  });

  it('is declared when reachable but never observed to work', () => {
    expect(capabilitySupport(true, null)).toBe('declared');
    expect(capabilitySupport(true, undefined)).toBe('declared');
  });

  it('is verified only with a real success behind it', () => {
    expect(capabilitySupport(true, new Date('2026-08-01T00:00:00Z'))).toBe('verified');
  });
});

describe("runVerbSucceeded — the run cell asks 'could Cronsole run it', not 'did it pass'", () => {
  // The four rows of `PlatformConnector.runTask`'s own table. Three of them are
  // the verb working; only the last is the verb failing.
  it('a dispatch the platform accepted is the verb working (Windows, Claude)', () => {
    expect(runVerbSucceeded({ success: true, ran: false })).toBe(true);
    expect(runVerbSucceeded({ success: true })).toBe(true);
  });

  it('a native job that ran and passed is the verb working', () => {
    expect(runVerbSucceeded({ success: true, ran: true })).toBe(true);
  });

  it('a native job that RAN AND FAILED is still the verb working', () => {
    // The regression this exists for. A CHECK that finds a missing file is the
    // check doing its job; recording it as a `run` failure put "1 verb failed
    // more recently than it succeeded" on the Sources tab of a healthy
    // platform, blaming Cronsole-native for a fact about the user's disk.
    expect(runVerbSucceeded({ success: false, ran: true })).toBe(true);
  });

  it('only "could not be started at all" fails the verb', () => {
    expect(runVerbSucceeded({ success: false, ran: false })).toBe(false);
    // An absent `ran` from a connector that never sets it means a dispatch, and
    // a failed dispatch is a real failure of the verb — so absence must not be
    // read as "it ran".
    expect(runVerbSucceeded({ success: false })).toBe(false);
  });
});


describe('every route that performs a verb records it', () => {
  const toolsSource = readFileSync(new URL('../../routes/tools.ts', import.meta.url), 'utf8');
  const combined = routesSource + toolsSource;

  // Not a proof that the call is on the right code path — only that no verb is
  // silently unrecorded, which is the drift that would make a working platform
  // read as permanently `declared` and the whole matrix decorative.
  for (const { verb } of CAPABILITY_VERBS) {
    it(`records '${verb}'`, () => {
      expect(combined).toContain(`'${verb}'`);
      expect(new RegExp(`recordCapability\\([^)]*'${verb}'`).test(combined)).toBe(true);
    });
  }

  it("records 'run' from `runVerbSucceeded`, never from `success` alone", () => {
    // A source assertion because the honest thing to pin is *which value reaches
    // the recorder*, and that lives on a route this suite does not boot.
    // `result.success` passed straight in is the bug: it reports a check that
    // correctly failed as the Run verb being broken.
    expect(combined).toContain('runVerbSucceeded(result)');
    expect(/recordCapability\([^)]*'run',\s*result\.success/.test(combined)).toBe(false);
  });
});

describe('access — controller or observer', () => {
  it('declares one for every platform in the matrix', () => {
    // A missing value would render as an empty badge rather than failing, on the
    // screen whose whole job is to say what a source can do.
    for (const platform of MATRIX_PLATFORMS) {
      expect(['controller', 'observer']).toContain(PLATFORM_DESCRIPTORS[platform]!.access);
    }
  });

  it('calls GitHub Actions an observer, and everything else a controller', () => {
    expect(PLATFORM_DESCRIPTORS[PlatformType.GITHUB_ACTIONS]!.access).toBe('observer');
    expect(PLATFORM_DESCRIPTORS[PlatformType.WINDOWS_TASK_SCHEDULER]!.access).toBe('controller');
    expect(PLATFORM_DESCRIPTORS[PlatformType.TASKHUB_NATIVE]!.access).toBe('controller');
  });

  it('calls Claude a controller in both of its modes', () => {
    // `unsupportedVerbs` is a getter there, so which verbs work depends on the
    // install — but "does this connector change anything" does not, and a field
    // that flipped with a readable session would be reporting the wrong fact.
    withClaudeSession();
    expect(PLATFORM_DESCRIPTORS[PlatformType.CLAUDE_CODE]!.access).toBe('controller');
    noClaudeSession();
    expect(PLATFORM_DESCRIPTORS[PlatformType.CLAUDE_CODE]!.access).toBe('controller');
  });

  it('is declared rather than counted from the cells', () => {
    // The distinction the field exists for: an observer and a controller whose
    // write verbs are merely unbuilt produce identical cells. If this ever
    // becomes `every mutating verb is unsupported`, the two collapse and
    // "read-only on purpose" stops being sayable.
    const mutating: CapabilityVerb[] = ['run', 'create', 'setStatus', 'updateSchedule', 'updateAction', 'delete'];
    const githubRefusesAll = mutating.every(
      verb => !verbReachability(PlatformType.GITHUB_ACTIONS, verb)
    );
    expect(githubRefusesAll).toBe(true);

    // …and Windows refuses none of them, so the two are not distinguishable by
    // this count alone only because Windows happens to implement them. The
    // declared field is what survives a connector that has not got there yet.
    expect(verbReachability(PlatformType.WINDOWS_TASK_SCHEDULER, 'run')).toBe(true);
  });
});
