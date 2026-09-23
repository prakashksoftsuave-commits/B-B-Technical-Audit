import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// /api is proxied to the FastAPI process so the dev server and the built bundle
// use the exact same relative URLs. No environment switching in the client.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 8001, not 8000 — the sibling Purchase Division service (same B&B
    // Construction repo family) also defaults to 8000, and the two running
    // side by side on the same machine collided: this backend's :8000 won
    // the port and silently intercepted Purchase Division's frontend
    // traffic instead of its own real backend. Keep this on 8001 so the two
    // services can never fight over the same port again.
    proxy: { '/api': { target: 'http://127.0.0.1:8001', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: false },
})
