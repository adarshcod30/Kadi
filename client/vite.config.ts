import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // dev: proxy API calls to the local mock backend
      '/api': { target: process.env.VITE_API_BASE || 'http://localhost:9000', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
});
