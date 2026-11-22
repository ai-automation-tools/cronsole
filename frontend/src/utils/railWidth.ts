/**
 * The source rail's width, when expanded on a desktop.
 *
 * **A fact about the device, so it stays in the browser** (AGENTS.md §9: a
 * preference follows the account; only a fact about the device stays local).
 * A width in pixels is an answer to *how big is this screen*: 420px is a
 * comfortable rail on a 4K monitor and most of a laptop's dashboard, so syncing
 * it would let one machine squeeze another. `railCollapsed` is the opposite
 * kind of setting — *do I want the tree at all* — and does sync.
 *
 * Only the expanded width is adjustable. Collapsed is an icon column with a
 * fixed size, and the phone drawer has its own width.
 */
export const RAIL_WIDTH_KEY = 'cronsole.railWidth';

/** `w-72` — the width the rail had before it was resizable. */
export const RAIL_WIDTH_DEFAULT = 288;
/** Below this the folder names truncate to nothing and the counts collide. */
export const RAIL_WIDTH_MIN = 208;
/**
 * A ceiling, not the only limit: the panel also carries `max-w-[50vw]`, so a
 * width chosen on a wide window cannot crowd the task list off a narrow one.
 */
export const RAIL_WIDTH_MAX = 560;

/** One arrow-key step, and the Shift+arrow step. */
export const RAIL_WIDTH_STEP = 16;
export const RAIL_WIDTH_STEP_LARGE = 64;

export const clampRailWidth = (px: number): number =>
  Math.round(Math.min(RAIL_WIDTH_MAX, Math.max(RAIL_WIDTH_MIN, px)));

/**
 * The stored width, or the default. Anything unreadable — no storage, a
 * blocked store, a hand-edited value — falls back to the default rather than
 * throwing or rendering a zero-width rail.
 */
export function readRailWidth(): number {
  try {
    const raw = window.localStorage.getItem(RAIL_WIDTH_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? clampRailWidth(n) : RAIL_WIDTH_DEFAULT;
  } catch {
    return RAIL_WIDTH_DEFAULT;
  }
}

/** Persist a width; the default is stored as an absence, so reset is a removal. */
export function writeRailWidth(px: number): void {
  try {
    const w = clampRailWidth(px);
    if (w === RAIL_WIDTH_DEFAULT) window.localStorage.removeItem(RAIL_WIDTH_KEY);
    else window.localStorage.setItem(RAIL_WIDTH_KEY, String(w));
  } catch {
    // A blocked store costs only persistence; the drag itself still works.
  }
}
