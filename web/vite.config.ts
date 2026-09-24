import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { samplePack } from './vite/samplePack'

/** The Worker of plan 5, which 6b's transport calls through this proxy: one origin, no CORS. */
const API = 'http://localhost:8787'

const SAMPLE_DIR = fileURLToPath(new URL('../pipeline/samples/a1-bg/', import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    samplePack(SAMPLE_DIR),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: {
        name: 'Wordado',
        short_name: 'Wordado',
        description: 'Learn English words, a few minutes a day, online or off.',
        lang: 'bg',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f6f7fb',
        theme_color: '#1d2b53',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      injectManifest: {
        // A classic script, so every browser can register it.
        rollupFormat: 'iife',
        // Audio lives in one cache, AudioStore's (decision of plan 6b); the sample's clips are fetched into it on the first online visit.
        globPatterns: ['**/*.{js,css,html,wasm,woff2,svg,png,json,pack,webmanifest}'],
        // The asynchronous SQLite build is about 2.3 MB.
        maximumFileSizeToCacheInBytes: 4_000_000,
      },
    }),
  ],
  // wa-sqlite locates its .wasm next to its own module; pre-bundling would move the module away from it.
  optimizeDeps: { exclude: ['@journeyapps/wa-sqlite'] },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true, proxy: { '/api': API, '/v1': API } },
  preview: { port: 4173, strictPort: true, proxy: { '/api': API, '/v1': API } },
})
