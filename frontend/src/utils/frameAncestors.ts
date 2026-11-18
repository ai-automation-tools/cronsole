/**
 * `VITE_FRAME_ANCESTORS`: the pages allowed to show Cronsole in a frame (a local
 * Project Hub, the suite shell), comma-separated. Read twice: by `vite.config.ts`
 * for the dev and preview servers' CSP `frame-ancestors` header, and by the app
 * (`utils/embed.ts`) as the only origins it talks to. Each entry is reduced to its
 * origin, and one that isn't an http(s) origin is dropped, so nothing else reaches
 * the header.
 *
 * No DOM types here: `vite.config.ts` imports this under the Node tsconfig.
 */
export function parseFrameAncestors(value: string | undefined): string[] {
  return (value ?? '').split(',').flatMap(entry => {
    try {
      const url = new URL(entry.trim());
      return /^https?:$/.test(url.protocol) ? [url.origin] : [];
    } catch {
      return [];
    }
  });
}
