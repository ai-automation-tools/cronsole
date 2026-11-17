import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { parseFrameAncestors } from './src/utils/frameAncestors.ts'

/**
 * Write `404.html` as a byte copy of `index.html`.
 *
 * The app uses `BrowserRouter`, so `/templates` is a CLIENT-side route with no file
 * behind it. A static host asked for that path directly -- a deep link, a bookmark,
 * or just a refresh on any tab but the first -- answers 404 and the app never boots.
 * GitHub Pages serves `404.html` for an unknown path, and because that copy is the
 * app, it boots and routes correctly.
 *
 * Demo builds only: every other consumer of `dist/` is the reverse proxy, which has
 * its own SPA fallback in the Caddyfile. Found by opening the built demo at
 * `/templates` rather than by clicking through from the root, which is exactly the
 * path a visitor arrives on when someone shares a link.
 */
function spaFallback(): Plugin {
  let outDir = 'dist'
  return {
    name: 'cronsole-spa-fallback',
    apply: 'build',
    configResolved(config) {
      // Read from the resolved config rather than a plugin-context property, so
      // `--outDir dist-demo` is honoured and nothing depends on a Vite internal.
      outDir = config.build.outDir
    },
    closeBundle() {
      const index = join(outDir, 'index.html')
      if (!existsSync(index)) {
        this.error('spa-fallback: no index.html in ' + outDir)
        return
      }
      copyFileSync(index, join(outDir, '404.html'))
    }
  }
}

// https://vite.dev/config/
const APP_VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

export default defineConfig(({ mode }) => {
  // Pages allowed to show Cronsole in a frame (a local Project Hub, the suite shell).
  // Unset, no frame header is sent, as before; set, CSP frame-ancestors limits framing
  // to them. The app reads the same list as the only origins it talks to (utils/embed.ts).
  const ancestors = parseFrameAncestors(loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_').VITE_FRAME_ANCESTORS)
  const frameHeaders = ancestors.length
    ? { 'Content-Security-Policy': `frame-ancestors 'self' ${ancestors.join(' ')}` }
    : undefined
  return {
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [react(), ...(mode === 'demo' ? [spaFallback()] : [])],
  server: {
    // Loopback only: the dev server is not offered to the LAN. The container image
    // passes --host itself (frontend/Dockerfile), which overrides this.
    host: '127.0.0.1',
    // Deliberately NOT Vite's default 5173: every other Vite project on the machine
    // wants that port, and whichever starts first wins. A distinctive port means
    // "Cronsole's frontend" is unambiguous. strictPort so a collision fails loudly
    // instead of silently landing on 7374 and leaving CORS/ALLOWED_ORIGINS wrong.
    port: 7373,
    strictPort: true,
    headers: frameHeaders,
    watch: {
      usePolling: true,
    },
    // Pre-transform the whole import graph when the dev server starts, so the
    // first page load after a `cronsole restart` is not the one paying for ~160
    // cold module transforms (that load sat on a blank screen for seconds).
    warmup: {
      clientFiles: ['./src/main.tsx'],
    },
  },
  // `vite preview` serves the built bundle for `cronsole mode built`. A build calls
  // the API same-origin, so this forwards the two API paths to the backend, the same
  // two the Caddy proxy forwards (proxy/Caddyfile).
  preview: {
    host: '127.0.0.1',
    port: 7373,
    strictPort: true,
    headers: frameHeaders,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/socket.io': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
}
})
