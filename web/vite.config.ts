import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://api:3000',
        changeOrigin: true,
      },
      '/admin': {
        target: 'http://api:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'http://api:3000',
        ws: true,
      },
    },
  },
});
