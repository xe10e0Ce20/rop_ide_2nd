// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // 当检测到新版本时自动更新 Service Worker
      manifest: false,            // 如果只是纯粹要离线运行代码，不需要 PWA 的“添加至桌面”图标，可以设为 false
      workbox: {
        // 自动匹配并预缓存所有 Vite 编译出来的静态资源（HTML/JS/CSS/字体等）
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,woff,ttf,wasm}']
      }
    })
  ]
});