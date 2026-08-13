import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PlatformType } from '@prisma/client';
import {
  CAPABILITY_VERBS,
  MATRIX_PLATFORMS,
  PLATFORM_DESCRIPTORS,
  capabilitySupport,
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
    // The distinction this mechanism exists for. `create` on Claude has a method
    // (the interface demands one) that can only ever return `{ success: false }`,
    // because Anthropic exposes no create endpoint. Reported as `declared` it
    // reads "reachable, just unproven" and invites the user to wait for evidence
    // that cannot arrive.
    const claude = connectorFor(PlatformType.CLAUDE_CODE)!;
    expect(typeof claude.createTask).toBe('function');
    expect(claude.unsupportedVerbs).toContain('create');
    expect(verbReachability(PlatformType.CLAUDE_CODE, 'create')).toBe(false);
    expect(capabilitySupport(false, null)).toBe('unsupported');

    // And `run` — the one verb Claude really has — stays reachable, so the
    // declaration cannot be read as "this connector does nothing".
    expect(verbReachability(PlatformType.CLAUDE_CODE, 'run')).toBe(true);
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

  // Windows and Claude have no route-level carve-outs, so for them the
  // connector object IS the authority and any disagreement is drift.
  for (const platform of [PlatformType.WINDOWS_TASK_SCHEDULER, PlatformType.CLAUDE_CODE]) {
    for (const { verb, method } of CONNECTOR_DERIVED) {
      it(`${platform}: ${verb} matches connector.${method}`, () => {
        const connector = connectorFor(platform) as unknown as Record<string, unknown>;
        expect(verbReachability(platform, verb)).toBe(typeof connector[method] === 'function');
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
});
