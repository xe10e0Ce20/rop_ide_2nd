// public/sw.js
const CACHE_NAME = 'rop-studio-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/src/main.tsx',            // 如果是纯静态无打包（如轻量开发环境），缓存入口
  '/favicon.ico',
  // 注意：如果是生产环境打包，这里需要动态填入构建后的 assets 列表（如 dist/index.css, dist/index.js 等）
];

// 1. 安装阶段：强行预缓存核心静态资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('// VFS_PWA: 正在预缓存离线静态资源...');
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// 2. 激活阶段：清理旧版本缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('// VFS_PWA: 清理过期缓存:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. 拦截请求：Cache-First (缓存优先) 策略，并处理 SPA 路由回退
self.addEventListener('fetch', (event) => {
  // 仅处理 GET 请求（忽略 POST 这种发往云端的操作）
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      // 如果是导航请求（用户刷新了其他子路由如 /settings），且缓存未命中
      // 需要强行回退到 index.html（SPA 单页应用的离线路由关键）
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html');
      }

      // 尝试走网络请求
      return fetch(event.request).catch(() => {
        // 网络失败且无缓存，返回一个自定义的离线错误界面（可选）
        console.error('// VFS_PWA: 处于完全离线状态且无该资源缓存:', event.request.url);
      });
    })
  );
});