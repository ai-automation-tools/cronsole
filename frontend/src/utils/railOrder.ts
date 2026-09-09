/**
 * **Rail order** — where a row sits inside its band, once the user has said.
 *
 * Three bands reorder (Collections, Pinned, Sources) and each already had a
 * place to keep the answer, so this file holds the *move*, never the storage. A
 * pin's order is the `railPins` array, a collection's is the `position` column
 * the schema has carried since collections shipped, and a source's is a new
 * `sourceOrder` preference. Three stores, because a fourth record holding "the
 * rail's order" would be a second definition of the collection order the server
 * already serves — free to disagree with it, and the disagreement would surface
 * only as a rail that reshuffles itself on reload.
 *
 * What *is* shared is the gesture, and it is one function: dropping A onto B
 * means **A takes B's index**, everything between shifting by one. Alt+Arrow is
 * the same move over one step, so the pointer and the keyboard cannot come to
 * different conclusions about what a move is.
 */

/**
 * Move `from` to `to`'s index, keeping every other key's relative order.
 *
 * Returns the **same array reference** when nothing moves — either key absent,
 * or the two the same. A drop on yourself and a drop on a row that has since
 * disappeared are both "nothing happened", and identity is how a caller can
 * tell without comparing element by element.
 */
export function moveKey(keys: string[], from: string, to: string): string[] {
  const i = keys.indexOf(from);
  const j = keys.indexOf(to);
  if (i < 0 || j < 0 || i === j) return keys;
  const next = keys.slice();
  next.splice(i, 1);
  next.splice(j, 0, from);
  return next;
}

/**
 * Re-sort records to match a list of keys.
 *
 * Anything the key list does not name is **dropped rather than appended**, and
 * anything it names that no longer exists is skipped: the caller hands in the
 * band's own rows, so a key with no record is a row that vanished between the
 * drag and the drop — not a record to invent.
 */
export function orderBy<T>(items: T[], keyOf: (item: T) => string, keys: string[]): T[] {
  const byKey = new Map(items.map(i => [keyOf(i), i]));
  return keys.map(k => byKey.get(k)).filter((i): i is T => i !== undefined);
}

/**
 * Comparator that honours a stored key order and leaves the rest alone.
 *
 * Unknown keys sort **after** every named one, keeping whatever order the
 * caller already had among themselves (`Infinity - Infinity` is `NaN`, which is
 * falsy, so a `||` chain falls through to the next comparator). That is what
 * lets a stored order survive a new platform shipping: it arrives at the bottom
 * rather than reshuffling the list or dropping out of it.
 */
export function byStoredOrder(order: string[]): (a: string, b: string) => number {
  const index = new Map(order.map((k, i) => [k, i]));
  return (a, b) => (index.get(a) ?? Infinity) - (index.get(b) ?? Infinity);
}
