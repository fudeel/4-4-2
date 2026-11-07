import { defineConfig } from 'vite';

const SERVER_PORT = Number(process.env.GAME_PORT ?? 3001);

const wsProxy = {
  '/ws': { target: `ws://localhost:${SERVER_PORT}`, ws: true },
  '/api': { target: `http://localhost:${SERVER_PORT}` },
};

export default defineConfig({
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: true, // reachable from phones on the same Wi-Fi
    port: 5173,
    strictPort: true,
    proxy: wsProxy,
  },
  preview: {
    host: true,
    port: 4173,
    proxy: wsProxy,
  },
});
