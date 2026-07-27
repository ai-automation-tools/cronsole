import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // Deliberately NOT Vite's default 5173: every other Vite project on the machine
    // wants that port, and whichever starts first wins. A distinctive port means
    // "TaskHub's frontend" is unambiguous. strictPort so a collision fails loudly
    // instead of silently landing on 7374 and leaving CORS/ALLOWED_ORIGINS wrong.
    port: 7373,
    strictPort: true,
    watch: {
      usePolling: true,
    },
  },
})
