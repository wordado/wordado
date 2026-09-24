import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** The Worker of plan 5, which 6b's transport calls through this proxy: one origin, no CORS. */
const API = 'http://localhost:8787'

export default defineConfig({
  plugins: [react()],
  // wa-sqlite locates its .wasm next to its own module; pre-bundling would move the module away from it.
  optimizeDeps: { exclude: ['@journeyapps/wa-sqlite'] },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true, proxy: { '/api': API, '/v1': API } },
})
