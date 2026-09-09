import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
// Hot reload (HMR): `npm run dev`. Se i salvataggi non aggiornano il browser: VITE_USE_POLLING=1 in .env.local
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectRegister: false,
        registerType: 'prompt',
        includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
        manifest: {
          name: 'CryptoSignals Pro',
          short_name: 'CryptoSignals',
          description: 'Live crypto dashboard, backtesting e segnali di scalping BTC/USDT',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#1a1a2e',
          theme_color: '#1a1a2e',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    server: {
      port: 5173,
      strictPort: false,
      open: true,
      watch: {
        ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
        ...(env.VITE_USE_POLLING === '1' ? { usePolling: true, interval: 400 } : {}),
      },
    },
  }
})
