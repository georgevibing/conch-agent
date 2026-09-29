import react from '@vitejs/plugin-react';
import { nacreCssModules } from '@conch/nacre/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  css: { modules: nacreCssModules },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:4317',
      '/ws': { target: 'ws://127.0.0.1:4317', ws: true },
    },
  },
});
