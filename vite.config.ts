import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Hot reload (HMR): `npm run dev`. Se i salvataggi non aggiornano il browser: VITE_USE_POLLING=1 in .env.local
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
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
