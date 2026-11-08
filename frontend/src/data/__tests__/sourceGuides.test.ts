import { describe, it, expect } from 'vitest';

/**
 * **Every source guide opens the same way** (2026-11-07).
 *
 * A reader comparing two sources should find the same three sections in the
 * same place, and the capabilities table should ask every source the same
 * questions in the same order. This is the standard
 * `docs/contributing/Adding_A_Source.md` › *The source's guide* describes.
 *
 * Globbed rather than listed, so a new guide is held to it the day it lands.
 * It checks the shape, not the claims: whether a ✅ is still true is the
 * connector's business, and updating the table is a §11a mirror-surface step.
 */
const guides = import.meta.glob('../../../../docs/user-guides/sources/*.md', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>;

const OPENING_SECTIONS = [
  '## 🎯 Best for',
  '## 🧰 Capabilities at a glance',
  '## 🚫 When to use something else'
];

/** The rows every capabilities table asks, in this order. A source may add rows after them. */
const CAPABILITY_ROWS = [
  'Where it runs',
  'Runs while Cronsole is off',
  'Setup',
  'Schedules',
  'Sync',
  'Run now',
  'Create',
  'Enable / disable',
  'Edit schedule',
  'Edit what it runs',
  'Delete',
  'Run history',
  'Health',
  'Credentials'
];

const sources = Object.entries(guides).filter(([path]) => !path.endsWith('/README.md'));

/** The body of one `## ` section: from its heading to the next one. */
function section(doc: string, heading: string): string {
  const start = doc.indexOf(`\n${heading}`);
  if (start < 0) return '';
  const next = doc.indexOf('\n## ', start + 1);
  return doc.slice(start, next < 0 ? undefined : next);
}

describe('source guides follow one layout', () => {
  it('finds the guides', () => {
    expect(sources.length).toBeGreaterThanOrEqual(7);
  });

  for (const [path, raw] of sources) {
    const name = path.split('/').pop();
    const doc = raw.replace(/\r\n/g, '\n');

    describe(name!, () => {
      it('opens with Best for, Capabilities at a glance and When to use something else', () => {
        const headings = doc.split('\n').filter(l => l.startsWith('## '));
        expect(headings.slice(0, 3)).toEqual(OPENING_SECTIONS);
      });

      it('lists automations in its Best for table', () => {
        const best = section(doc, OPENING_SECTIONS[0]);
        expect(best).toContain('| Automation | Why it belongs here |');
        const rows = best.split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| Automation'));
        expect(rows.length).toBeGreaterThanOrEqual(2);
      });

      it('asks the standard capability questions, in order, before any of its own', () => {
        const caps = section(doc, OPENING_SECTIONS[1]);
        expect(caps).toContain('| | Can it? | Details |');
        const asked = [...caps.matchAll(/^\| \*\*(.+?)\*\* \| (.+?) \|/gm)];
        expect(asked.slice(0, CAPABILITY_ROWS.length).map(m => m[1])).toEqual(CAPABILITY_ROWS);
        for (const [, row, mark] of asked) {
          expect(['✅', '⚠️', '❌', '—'], `${row}: "${mark}"`).toContain(mark.trim());
        }
        expect(asked.map(m => m[1])).toContain('Templates');
      });
    });
  }
});
