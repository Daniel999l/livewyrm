import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Single service: the client builds into server/public, which Express serves.
// In dev, Vite serves the client on 5173 and proxies the API to the server on 3000.
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../server/public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
});
