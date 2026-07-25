import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Catalyst Web Client Hosting serves the bundle under /app/, so built asset URLs must
  // carry that prefix. Without it index.html requests /assets/... at the origin root,
  // which 404s and leaves a blank page with no console error - the script simply never
  // loads. Dev keeps '/' so the vite server and its proxy work unchanged.
  base: command === 'build' ? '/app/' : '/',
  server: {
    port: 5173,
    proxy: {
      // dev: proxy API calls to the local mock backend
      '/api': { target: process.env.VITE_API_BASE || 'http://localhost:9000', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
}));
