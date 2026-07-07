// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // 当检测到新版本时自动更新 Service Worker
      manifest: {
        "short_name": "ROP IDE 2nd",
        "name": "ROP IDE 2nd Edition",
        "description": "2nd Edition ROP Web IDE with Offline Compiler Support",
        "icons": [
          {
            "src": "icon.png",
            "sizes": "192x192",
            "type": "image/png",
            "purpose": "any maskable"
          },
          {
            "src": "icon.png",
            "sizes": "512x512",
            "type": "image/png",
            "purpose": "any maskable"
          }
        ],
        "start_url": "/",
        "background_color": "#151515",
        "theme_color": "#1a1a1a",
        "display": "standalone",
        "orientation": "any"
      },
      workbox: {
        // 自动匹配并预缓存所有 Vite 编译出来的静态资源（HTML/JS/CSS/字体等）
        globPatterns: ['**/*.{ts,js,css,html,ico,png,svg,woff2,woff,ttf,wasm}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024
      }
    })
  ]
});