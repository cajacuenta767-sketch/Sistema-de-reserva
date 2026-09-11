import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        // Separa lo que casi nunca cambia de lo que cambia en cada despliegue:
        // así una corrección de un día no invalida 500 kB de caché del navegador.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          data: ['@tanstack/react-query', '@tanstack/react-table', 'zod'],
          ui: ['lucide-react', 'cmdk', 'date-fns'],
        },
      },
    },
  },
});
