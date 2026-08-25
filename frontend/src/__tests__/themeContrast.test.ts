import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * **The palette, measured.**
 *
 * Colour is the one part of this app that breaks silently: a role that fails
 * WCAG renders perfectly, ships, and is only found by someone squinting at a
 * label. The 2026-08-12 pass tokenised every role for exactly that reason and
 * then checked the new values **against white**, which is not where most of
 * them are read. `muted` is the darkest fill in light mode and the binding
 * constraint, and two roles cleared the page while failing it.
 *
 * So this file measures every pair rather than trusting a review. It is what
 * made the 2026-08-24 pass possible at all: without it, "fixed the light theme"
 * is an opinion.
 *
 * Bars are WCAG 2.1 AA: **4.5** for body text, **3.0** for non-text UI. Every
 * `-text` role is small text somewhere (the 10px uppercase field labels), so
 * none of them gets the large-text exemption.
 */

/*
 * Read as a file rather than imported. `index.css?raw` returns what Vite's CSS
 * pipeline produced, not what is written here — the `@theme inline` block is
 * expanded and the `.dark` / `.light` selectors this file needs are gone. The
 * stylesheet is still the single source: it is parsed, never re-typed, because
 * a second copy of the palette would pass this suite while the app rendered
 * something else.
 */
const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8').replace(/\r\n/g, '\n');

type Hsl = [number, number, number];

function tokens(selector: string): Record<string, Hsl> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in index.css`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const out: Record<string, Hsl> = {};
  for (const raw of css.slice(open + 1, close).split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('--')) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(2, colon).trim();
    const parts = line
      .slice(colon + 1)
      .replace(';', '')
      .trim()
      .split(/\s+/);
    if (parts.length !== 3 || !parts[1]!.endsWith('%') || !parts[2]!.endsWith('%')) continue;
    const hsl: Hsl = [Number(parts[0]), Number(parts[1]!.slice(0, -1)), Number(parts[2]!.slice(0, -1))];
    if (hsl.some(Number.isNaN)) continue;
    out[name] = hsl;
  }
  return out;
}

function relativeLuminance([h, s, l]: Hsl): number {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const channels = [f(0), f(8), f(4)].map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: Hsl, b: Hsl): number {
  const pair = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (pair[0]! + 0.05) / (pair[1]! + 0.05);
}

const dark = tokens('.dark');
const light = tokens('.light');
const root = tokens(':root');

const SURFACES = ['background', 'surface', 'raised', 'muted'] as const;

/** Every role rendered as text or an icon on a page or panel fill. */
const TEXT_ROLES = [
  'foreground',
  'muted-foreground',
  'subtle-foreground',
  'success-text',
  'warning-text',
  'danger-text',
  'isolate-text',
  'info-text',
  'system-text',
  'neutral-text',
  'native-text',
  'claude-text',
  'chatgpt-text',
  'github-text',
  'vercel-text',
  'gemini-text'
] as const;

/** `-foreground` is text ON a solid fill of that role — a different job to `-text`. */
const ON_FILL: [string, string][] = [
  ['primary-foreground', 'primary'],
  ['primary-foreground', 'primary-hover'],
  ['success-foreground', 'success'],
  ['success-foreground', 'success-hover'],
  ['danger-foreground', 'danger'],
  ['danger-surface-text', 'danger-surface']
];

/** Roles drawn as a bare dot or chip, which must be findable on the page. */
const INDICATORS = [
  'success',
  'warning',
  'danger',
  'isolate',
  'info',
  'system',
  'native',
  'claude',
  'chatgpt',
  'github',
  'vercel',
  'gemini'
] as const;

const THEMES: [string, Record<string, Hsl>][] = [
  ['dark', dark],
  ['light', light]
];

describe(':root mirrors .dark exactly', () => {
  // `:root` is what paints before hydration decides a theme. If it drifts from
  // `.dark`, the default theme flashes a different palette on every cold load —
  // and nothing fails, because both are perfectly valid CSS.
  it('defines the same tokens with the same values', () => {
    for (const [name, value] of Object.entries(dark)) {
      expect(root[name], `:root is missing --${name}`).toBeDefined();
      expect(root[name], `:root --${name} has drifted from .dark`).toEqual(value);
    }
  });
});

describe('elevation is ordered away from the page background', () => {
  // The rule that has to survive both themes: a panel meant to sit *above*
  // another must be further from the page than the one below it. Light cannot
  // express that as "lighter" — the page is white — so it steps darker, but it
  // still steps, and in the same order. Until 2026-08-24 light ran 100/95/98,
  // putting `raised` at 1.04 against the page: flatter than `surface`, and very
  // nearly invisible.
  for (const [name, theme] of THEMES) {
    it(`${name}: background < surface < raised`, () => {
      const surface = contrast(theme.surface!, theme.background!);
      const raised = contrast(theme.raised!, theme.background!);
      expect(surface, `${name} surface is invisible against the page`).toBeGreaterThan(1.04);
      expect(raised, `${name} raised is flatter than surface`).toBeGreaterThan(surface);
    });
  }
});

describe('text roles clear AA on every surface they can land on', () => {
  for (const [name, theme] of THEMES) {
    for (const role of TEXT_ROLES) {
      it(`${name}: --${role}`, () => {
        for (const surface of SURFACES) {
          const ratio = contrast(theme[role]!, theme[surface]!);
          expect(
            ratio,
            `--${role} on --${surface} in ${name} is ${ratio.toFixed(2)}:1, below the 4.5 bar`
          ).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }
});

describe('text on a solid fill of its own role clears AA', () => {
  // The buttons this covers are not decorative: white-on-green is **Run now**,
  // and white-on-red is the destructive confirm. They measured 2.59 and 3.78
  // until 2026-08-24.
  for (const [name, theme] of THEMES) {
    for (const [fg, fill] of ON_FILL) {
      it(`${name}: --${fg} on --${fill}`, () => {
        const ratio = contrast(theme[fg]!, theme[fill]!);
        expect(ratio, `${fg} on ${fill} in ${name} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe('indicator roles are findable on the page', () => {
  // A status dot carries meaning with no text beside it, so it is non-text UI:
  // 3.0 against the surface it sits on. This is the constraint that stops a fix
  // for white-on-fill from darkening a role until its dot disappears.
  for (const [name, theme] of THEMES) {
    for (const role of INDICATORS) {
      it(`${name}: --${role}`, () => {
        const ratio = contrast(theme[role]!, theme.background!);
        expect(
          ratio,
          `--${role} in ${name} is ${ratio.toFixed(2)}:1 against the page`
        ).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

describe('--border: a known, pinned gap', () => {
  /*
   * `--border` does NOT meet WCAG 1.4.11 (3.0 for non-text UI), and this pins
   * how far short it is rather than asserting a pass it has not earned.
   *
   * It is one token doing two jobs: separating cards (decorative, exempt) and
   * drawing the boundary of a text input (in scope, not exempt). Reaching 3.0
   * needs L=37% in dark and L=58% in light, against 22% and 80% today, which
   * would turn every hairline in the app into a heavy rule at all 313 call
   * sites — including the ones where the rule does not apply.
   *
   * The real fix is a second token (`--border` decorative, `--border-strong`
   * for control boundaries) plus a sweep of the inputs: a component change
   * rather than a palette one, so it is on the roadmap instead of here. Until
   * then this asserts the floor it was raised to on 2026-08-24, so the gap
   * cannot quietly widen and closing it has to be deliberate.
   */
  for (const [name, theme] of THEMES) {
    it(`${name}: holds the floor it was raised to`, () => {
      const ratio = contrast(theme.border!, theme.background!);
      expect(ratio, `--border in ${name} regressed below its 2026-08-24 floor`).toBeGreaterThanOrEqual(1.55);
      expect(
        ratio,
        `--border in ${name} now clears 3.0 — close the roadmap item and delete this pin`
      ).toBeLessThan(3);
    });
  }
});
