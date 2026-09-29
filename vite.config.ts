import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  root: path.resolve('client'),
  resolve: {
    alias: { '@shared': path.resolve('shared') },
  },
  build: {
    outDir: path.resolve('dist/client'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        admin: path.resolve('client/admin.html'),
        display: path.resolve('client/display.html'),
        setup: path.resolve('client/setup.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/media': 'http://127.0.0.1:8080',
    },
  },
})
