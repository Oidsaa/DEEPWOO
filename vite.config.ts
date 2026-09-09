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
    // .vs/ holds VS lock files (*.vsidx) that crash the watcher with EBUSY while VS is open.
    // wordpress/ holds the WP-side plugin; zipping it there locks the file (EBUSY) mid-write.
    watch: {
      ignored: ['**/release/**', '**/dist/**', '**/dist-electron/**', '**/.vs/**', '**/wordpress/**'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
