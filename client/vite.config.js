import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发模式下把 /api 请求代理到 Node 后端；生产构建由后端直接托管静态文件
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
