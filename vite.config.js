import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // /api goes to the Express server (npm run server:dev), so the browser sees one origin, like on Render
  server: { port: 5174, proxy: { '/api': 'http://localhost:3000' } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
    css: false,
    // tests must not depend on a developer's local .env
    env: { VITE_PAYMENT_PROVIDER: 'demo', VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  },
})
