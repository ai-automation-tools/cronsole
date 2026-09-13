import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

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
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'demo' ? [spaFallback()] : [])],
  server: {
    host: true,
    // Deliberately NOT Vite's default 5173: every other Vite project on the machine
    // wants that port, and whichever starts first wins. A distinctive port means
    // "Cronsole's frontend" is unambiguous. strictPort so a collision fails loudly
    // instead of silently landing on 7374 and leaving CORS/ALLOWED_ORIGINS wrong.
    port: 7373,
    strictPort: true,
    watch: {
      usePolling: true,
    },
  },
}))
