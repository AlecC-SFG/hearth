import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const base = process.env.BASE_PATH ?? '/'

function appVersion() {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
  let sha = process.env.GITHUB_SHA?.slice(0, 7)
  if (!sha) {
    try {
      sha = execSync('git rev-parse --short HEAD').toString().trim()
    } catch {
      sha = 'local'
    }
  }
  return `${pkg.version}+${sha}`
}

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Hearth: family tasks',
        short_name: 'Hearth',
        description: 'A calm, ADHD-friendly task tracker for the whole family. One thing at a time.',
        theme_color: '#d9622b',
        background_color: '#fbf8f3',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        id: base,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'] },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
})
