import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // 切换到 injectManifest 模式，使用自定义 SW 模板
      strategies: 'injectManifest',
      srcDir: 'src',           // SW 模板所在目录（与 App.tsx 同级）
      filename: 'sw.js',       // 输出文件名
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
      injectManifest: {
        // 预缓存注入点：Workbox 会将自动抓取的文件清单插入此处
        injectionPoint: 'self.__WB_MANIFEST',
        // 自动抓取的文件类型（与之前的 globPatterns 一致）
        globPatterns: ['**/*.{ts,js,css,html,ico,png,svg,woff2,woff,ttf,wasm}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      }
    })
  ]
});