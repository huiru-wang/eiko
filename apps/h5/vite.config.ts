import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0', port: Number(env.H5_PORT || 5174), strictPort: true,
      proxy: { '/api': { target: env.BACKEND_URL || 'http://127.0.0.1:3000', changeOrigin: true } },
    },
  };
});
