const VERSION = '0.0.1'
const CACHE_NAME = 'rop-ide';
const ASSETS = [
  '/',
  '/index.html',
  '/favicon.ico',
];

// 1. 安装阶段：强行预缓存核心静态资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('// VFS_PWA: 正在预缓存离线静态资源...');
      return Promise.all(
        ASSETS.map(asset => {
          return cache.add(asset).catch(err => {
            console.warn(`// VFS_PWA: 静态资产 [${asset}] 预缓存失败，已跳过:`, err);
          });
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// 2. 激活阶段：清理旧版本缓存，夺权
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
    }).then(() => self.clients.claim()) // 配合前端实现免刷新初次就绪
  );
});

// 3. 拦截请求
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (url.pathname.endsWith('/version')) {
    // 强制走网络通道，绝不查 PWA 本地缓存
    event.respondWith(
      fetch(event.request).catch((err) => {
        console.warn('// VFS_PWA: 获取线上 version 失败（可能处于完全离线状态）');
        return new Response('OFFLINE', { status: 200 }); // 离线时兜底返回，防止前端 fetch 崩溃
      })
    );
    return;
  }

  // 正常的静态资源和页面策略
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      // 如果是导航请求（比如刷新了子路由 /settings），且缓存未命中，回退到 index.html
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html');
      }

      // 尝试走网络请求
      return fetch(event.request).catch((err) => {
        console.error('// VFS_PWA: 处于完全离线状态且无该资源缓存:', event.request.url, err);
        // 如果想要对图片或核心组件返回兜底文件，可以在这里控制
      });
    })
  );
});