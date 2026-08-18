/**
 * Opening a task detail, and landing back where you opened it from.
 *
 * The dashboard's slice — filters, the saved view, and every source-rail
 * dimension (source, folder, favorites, **collection**) — lives in the URL
 * query, not in component state. So `navigate('/tasks/:id')` does not merely
 * cover the list with a modal: it drops the query, which resets the list
 * *underneath* to a bare URL's opening filters, and closing back to `/` drops
 * it a second time. You opened a task from inside a collection and closed it
 * onto All sources, having touched no filter.
 *
 * The fix is that a task detail carries where it came from, in two forms:
 *
 * - **The query rides along on the detail URL.** That keeps the list behind the
 *   modal on the slice you were reading, and it survives a reload or a pasted
 *   link — history state does not.
 * - **The origin path rides in history state.** The dashboard is not the only
 *   screen that opens a task (Tools › Task health and Execution analytics both
 *   do), and "back to where you were" from those means Tools, not the
 *   dashboard. State is enough for that: it is a within-session gesture, and a
 *   reloaded detail URL falls back to the dashboard on the query it carries.
 *
 * One definition rather than a `navigate` per call site — the open and the
 * close are two halves of the same contract, and they drift apart the moment
 * one screen writes its own half.
 */

export interface TaskRouteState {
  /** Path + query of the screen the detail was opened from. */
  from?: string;
}

export interface RouteOrigin {
  pathname: string;
  search: string;
}

/** Where the task-detail route lives, and what it remembers. */
export function taskDetailRoute(taskId: string, from: RouteOrigin) {
  return {
    to: { pathname: `/tasks/${taskId}`, search: from.search },
    options: { state: { from: `${from.pathname}${from.search}` } as TaskRouteState }
  };
}

/**
 * Where closing a task detail goes.
 *
 * The remembered origin when there is one; otherwise the dashboard, on the
 * query the detail URL is carrying — which is the slice the list behind it has
 * been showing all along.
 */
export function taskDetailReturn(location: { search: string; state?: unknown }) {
  const from = (location.state as TaskRouteState | null | undefined)?.from;
  if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')) return from;
  return { pathname: '/', search: location.search };
}
