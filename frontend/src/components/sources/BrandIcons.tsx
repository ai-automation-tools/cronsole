import type { LucideIcon } from 'lucide-react';

/**
 * Real brand marks for the sources that have one safe to reach for, wrapped
 * to the same call shape as a `LucideIcon` (`size`, `className` — no
 * `strokeWidth`: a brand mark is a solid shape, not a stroke) so each can
 * drop straight into `platform.ts`'s `SOURCE_ICON` map beside the lucide
 * glyphs used for the two sources that don't have one (Windows, ChatGPT —
 * Microsoft and OpenAI's marks are not offered by simple-icons, which reads
 * as a trademark-enforcement removal rather than an oversight; hand-drawing
 * either here would carry the same risk).
 *
 * Path data and hex values are simple-icons' (CC0 path data, MIT project) —
 * vendored as a handful of `d` strings and colours rather than pulled in as
 * a dependency, per that project's own guidance for using only a few of its
 * thousands of icons.
 *
 * **These render in the brand's real, fixed colour — deliberately not a
 * role token.** CLAUDE.md §9's rule against raw palette literals is about
 * *our own* product colours, which must stay theme-aware because they carry
 * no fixed meaning of their own (`bg-amber-500` says nothing about which
 * theme it is in). A brand mark is the opposite kind of colour: Anthropic's
 * coral is the same colour regardless of what mode Cronsole is in, exactly
 * because it identifies *their* product, not ours — hardcoding it is the
 * fidelity the request was for, not a lapse. The tile background behind
 * each icon (`platformAccent`) is untouched and still the app's own
 * role-token wash; only the glyph itself changed.
 *
 * **Apple's and Vercel's real colour is black, and both get `solidIcon`'s
 * exception instead of a literal `#000`.** Their own brand guidelines print
 * the mark white on a dark surface and black on a light one — so on
 * Cronsole's dark-by-default background a literal black fill would be the
 * least faithful choice available, not the most: it would be invisible.
 * `monoIcon` follows `--foreground` instead, the one token in this codebase
 * that already means exactly "black in light mode, white in dark mode".
 */
const solidIcon = (path: string, hex: string): LucideIcon =>
  (({ size = 24, className }: { size?: number; className?: string }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={hex} aria-hidden className={className}>
      <path d={path} />
    </svg>
  )) as unknown as LucideIcon;

const monoIcon = (path: string): LucideIcon =>
  (({ size = 24, className = '' }: { size?: number; className?: string }) => (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
      className={`text-foreground ${className}`}
    >
      <path d={path} />
    </svg>
  )) as unknown as LucideIcon;

export const AppleGlyph = monoIcon(
  'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701'
);

// Anthropic's real coral, #D97757 — nothing like the app's own violet
// --claude role token, which was chosen for internal palette cohesion, not
// brand fidelity.
export const ClaudeCodeGlyph = solidIcon(
  'M21 10.5h3v3h-3v3h-1.5v3H18v-3h-1.5v3H15v-3H9v3H7.5v-3H6v3H4.5v-3H3v-3H0v-3h3v-6h18Zm-15 0h1.5v-3H6Zm10.5 0H18v-3h-1.5z',
  '#D97757'
);

// GitHub Actions' own blue, #2088FF — distinct from generic GitHub's black,
// and from the app's own gray-blue --github role token.
export const GitHubActionsGlyph = solidIcon(
  'M10.984 13.836a.5.5 0 0 1-.353-.146l-.745-.743a.5.5 0 1 1 .706-.708l.392.391 1.181-1.18a.5.5 0 0 1 .708.707l-1.535 1.533a.504.504 0 0 1-.354.146zm9.353-.147l1.534-1.532a.5.5 0 0 0-.707-.707l-1.181 1.18-.392-.391a.5.5 0 1 0-.706.708l.746.743a.497.497 0 0 0 .706-.001zM4.527 7.452l2.557-1.585A1 1 0 0 0 7.09 4.17L4.533 2.56A1 1 0 0 0 3 3.406v3.196a1.001 1.001 0 0 0 1.527.85zm2.03-2.436L4 6.602V3.406l2.557 1.61zM24 12.5c0 1.93-1.57 3.5-3.5 3.5a3.503 3.503 0 0 1-3.46-3h-2.08a3.503 3.503 0 0 1-3.46 3 3.502 3.502 0 0 1-3.46-3h-.558c-.972 0-1.85-.399-2.482-1.042V17c0 1.654 1.346 3 3 3h.04c.244-1.693 1.7-3 3.46-3 1.93 0 3.5 1.57 3.5 3.5S13.43 24 11.5 24a3.502 3.502 0 0 1-3.46-3H8c-2.206 0-4-1.794-4-4V9.899A5.008 5.008 0 0 1 0 5c0-2.757 2.243-5 5-5s5 2.243 5 5a5.005 5.005 0 0 1-4.952 4.998A2.482 2.482 0 0 0 7.482 12h.558c.244-1.693 1.7-3 3.46-3a3.502 3.502 0 0 1 3.46 3h2.08a3.503 3.503 0 0 1 3.46-3c1.93 0 3.5 1.57 3.5 3.5zm-15 8c0 1.378 1.122 2.5 2.5 2.5s2.5-1.122 2.5-2.5-1.122-2.5-2.5-2.5S9 19.122 9 20.5zM5 9c2.206 0 4-1.794 4-4S7.206 1 5 1 1 2.794 1 5s1.794 4 4 4zm9 3.5c0-1.378-1.122-2.5-2.5-2.5S9 11.122 9 12.5s1.122 2.5 2.5 2.5 2.5-1.122 2.5-2.5zm9 0c0-1.378-1.122-2.5-2.5-2.5S18 11.122 18 12.5s1.122 2.5 2.5 2.5 2.5-1.122 2.5-2.5zm-13 8a.5.5 0 1 0 1 0 .5.5 0 0 0-1 0zm2 0a.5.5 0 1 0 1 0 .5.5 0 0 0-1 0zm12 0c0 1.93-1.57 3.5-3.5 3.5a3.503 3.503 0 0 1-3.46-3.002c-.007.001-.013.005-.021.005l-.506.017h-.017a.5.5 0 0 1-.016-.999l.506-.017c.018-.002.035.006.052.007A3.503 3.503 0 0 1 20.5 17c1.93 0 3.5 1.57 3.5 3.5zm-1 0c0-1.378-1.122-2.5-2.5-2.5S18 19.122 18 20.5s1.122 2.5 2.5 2.5 2.5-1.122 2.5-2.5z',
  '#2088FF'
);

export const VercelGlyph = monoIcon('m12 1.608 12 20.784H0Z');

// Google's own colour for Gemini, #8E75B2 — nothing close to the app's
// blue-leaning --gemini role token.
export const GoogleGeminiGlyph = solidIcon(
  'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
  '#8E75B2'
);
