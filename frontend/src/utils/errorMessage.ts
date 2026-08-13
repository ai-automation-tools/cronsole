/**
 * Pull the backend's own error message out of an axios rejection.
 *
 * The server puts the useful sentence in `response.data.error` — "Could not read
 * a routine id from that.", "A task with that name already exists in \Cronsole."
 * — and axios buries it under a generic `Request failed with status code 409`.
 * Showing the generic one throws away the only text written for this user.
 *
 * `unknown` in, `string` out: a catch binding is `unknown` under strict mode and
 * `any` is banned in `frontend/src`, so the shape is asserted here, once, rather
 * than at each call site.
 */
export function errorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: unknown } }; message?: string };
  const fromBody = e?.response?.data?.error;
  if (fromBody) return String(fromBody);
  return e?.message || fallback;
}
