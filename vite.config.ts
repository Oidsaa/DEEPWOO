import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative base is required so the built app works when loaded from file:// inside Electron.
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    // Don't watch build outputs (release/, dist/) — packaging churn crashed the watcher.
    watch: {
      ignored: ['**/release/**', '**/dist/**', '**/dist-electron/**'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
