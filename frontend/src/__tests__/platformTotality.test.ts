import { describe, it, expect } from 'vitest';
import {
  platformAccent,
  platformBadgeClass,
  platformLabel,
  platformSourceLabel,
  sourceDescription,
  sourceIcon,
  sourceLabel,
  sourcePlatform,
  sourceSubtypeLabel
} from '../platform';
import { sourceTopicId } from '../data/help';

/**
 * **Every lookup in `platform.ts` renders *something* rather than throwing.**
 *
 * Each of these functions already ends in a fallback — a globe, a muted swatch,
 * the raw platform label — and each says why in its own comment: *a source added
 * server-side before it is named here should still render as something, rather
 * than a raw enum.* That promise is only worth anything if the code path to the
 * fallback cannot throw on the way.
 *
 * It could. `sourcePlatform` did a bare `key.split(':')`, so a row that arrived
 * with no `platform` took down the whole Sources screen with *Cannot read
 * properties of undefined (reading 'split')* — a white page, from a helper whose
 * entire job is to degrade gracefully.
 *
 * The row was malformed because the backend was running new code against a
 * Prisma client generated before it, making `PlatformType.VERCEL_CRON` plain
 * `undefined` — and `JSON.stringify` drops an undefined value, so `platform`
 * vanished from the payload entirely. **That is fixed at the source**, where
 * `MATRIX_PLATFORMS` now refuses to boot on a value the enum does not have. This
 * file covers the second half: a presentation helper must not be the thing that
 * crashes when a surface upstream is wrong, because then the stack trace points
 * at the wrong layer and the real cause is minutes away instead of seconds.
 */

/** What a broken or unknown key can look like by the time it reaches here. */
const HOSTILE_KEYS: unknown[] = [
  undefined,
  null,
  '',
  'A_PLATFORM_ADDED_AFTER_THIS_BUNDLE_SHIPPED',
  'TASKHUB_NATIVE:SOME_NEW_JOB_TYPE',
  ':',
  ':LEADING_COLON'
];

/** Every string→string lookup, which must return a string and never throw. */
const TEXT_LOOKUPS: [string, (key: never) => string][] = [
  ['platformLabel', platformLabel as (k: never) => string],
  ['platformSourceLabel', platformSourceLabel as (k: never) => string],
  ['sourceLabel', sourceLabel as (k: never) => string],
  ['sourceSubtypeLabel', sourceSubtypeLabel as (k: never) => string],
  ['platformBadgeClass', platformBadgeClass as (k: never) => string],
  ['sourcePlatform', sourcePlatform as (k: never) => string]
];

describe('platform.ts lookups are total', () => {
  for (const [name, fn] of TEXT_LOOKUPS) {
    it.each(HOSTILE_KEYS.map(k => [String(k), k]))(`${name}(%s) returns a string`, (_label, key) => {
      const result = fn(key as never);
      expect(typeof result).toBe('string');
    });
  }

  it.each(HOSTILE_KEYS.map(k => [String(k), k]))('sourceIcon(%s) returns a component', (_label, key) => {
    // The crash site. `sourceIcon` calls `sourcePlatform` for its second-chance
    // lookup, so an unsplittable key reached `.split` before the `?? Globe`
    // fallback could ever run.
    expect(sourceIcon(key as never)).toBeTruthy();
  });

  it.each(HOSTILE_KEYS.map(k => [String(k), k]))('platformAccent(%s) returns both classes', (_label, key) => {
    const accent = platformAccent(key as never);
    expect(typeof accent.tile).toBe('string');
    expect(typeof accent.rule).toBe('string');
  });

  it.each(HOSTILE_KEYS.map(k => [String(k), k]))('sourceDescription(%s) returns a string or null', (_label, key) => {
    // Deliberately nullable — an unknown source renders no blurb rather than a
    // wrong one — so `null` is a pass here and an exception is not.
    const result = sourceDescription(key as never);
    expect(result === null || typeof result === 'string').toBe(true);
  });
});

describe('help lookups keyed on a source are total too', () => {
  // Found by this file the hard way: the first pass covered `platform.ts` only,
  // so the crash simply moved one module over to `sourceTopicId`, which does the
  // same bare split to pick a `?` topic. Any function keyed on a source key
  // belongs here, whichever file it lives in — the shared thing is the key, not
  // the module.
  it.each(HOSTILE_KEYS.map(k => [String(k), k]))('sourceTopicId(%s) returns a topic id', (_label, key) => {
    expect(typeof sourceTopicId(key as never)).toBe('string');
  });

  it('still falls back to the generic sources topic for an unknown source', () => {
    expect(sourceTopicId('SOMETHING_UNKNOWN')).toBe('sources');
  });
});

describe('the fallbacks are still the documented ones', () => {
  it('falls back to the platform label for an unknown subtype', () => {
    expect(sourceSubtypeLabel('TASKHUB_NATIVE:NOT_A_TYPE')).toBe('Cronsole (Native)');
  });

  it('reads the platform out of a subtype key', () => {
    expect(sourcePlatform('TASKHUB_NATIVE:CHECK')).toBe('TASKHUB_NATIVE');
  });

  it('renders an unnamed platform as something, not as a crash', () => {
    // The promise `platformSourceLabel` makes in its own comment.
    expect(platformSourceLabel('SOME_FUTURE_SOURCE')).toBe('SOME');
  });
});
