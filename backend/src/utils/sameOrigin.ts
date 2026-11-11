/**
 * Do two URLs point at the same scheme, host and port?
 *
 * Used where a stored credential is kept across an edit that omits it: headers saved
 * for one endpoint must not ride along to a different one. Keeping them when only
 * the URL changed let anyone holding a session re-point a webhook at their own
 * server and collect the stored token on the next delivery - which defeats "no route
 * returns a stored value" without ever reading it back.
 *
 * Unparseable input is "not the same": the safe answer drops the credential.
 */
export function sameOrigin(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
