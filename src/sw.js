import { PrecacheController } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { clientsClaim } from 'workbox-core';

// 立即接管页面
self.skipWaiting();
clientsClaim();

const manifest = self.__WB_MANIFEST || [];
const total = manifest.length;
let loaded = 0;

// 1. 创建预缓存控制器
const precacheController = new PrecacheController({
  cacheName: 'rop-ide-precache'
});

// 2. 挂载核心插件：高频捕获每个文件的写入，精准计算进度
precacheController.strategy.plugins.push({
  cacheWillUpdate: async ({ request, response }) => {
    if (response && response.status === 200) {
      loaded++;
      sendProgressToClients(request.url);
    }
    return response;
  }
});

// 3. 将 vite-plugin-pwa 自动抓取的文件清单注入控制器
precacheController.addToCacheList(manifest);

// 监听原生的 install 阶段
self.addEventListener('install', (event) => {
  sendProgressToClients(''); // 发送初始 0 进度状态
  event.waitUntil(precacheController.install(event));
});

// 监听原生的 activate 阶段，自动清理旧版本的废弃缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(precacheController.activate(event));
});

// 4. 【完美修复】：严格过滤跨域资源，只对同源静态资源做 match 匹配
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 核心防御线：如果是跨域请求（例如 cloudflare.com 或外部 API），直接放行走网络，绝不让 precacheController 碰它
  if (url.origin !== self.location.origin) {
    return; // 放弃对 fetch 事件的 respondWith 拦截，让浏览器走正常网络通道或外层路由
  }

  // 只有本站同源请求，才进入预缓存匹配
  event.respondWith(
    (async () => {
      try {
        const cachedResponse = await precacheController.match(event.request);
        if (cachedResponse) {
          return cachedResponse; // 命中打包产物清单，直接离线返回
        }
      } catch (err) {
        console.error('Precache match error:', err);
      }
      
      // 未命中预缓存的本站请求（如页面路由等），直接发起网络请求
      return fetch(event.request);
    })()
  );
});

// 5. 统一的推送通知函数
function sendProgressToClients(currentUrl) {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    clients.forEach(client => {
      client.postMessage({
        type: 'SW_PROGRESS',
        loaded,
        total,
        current: currentUrl,
        finished: loaded >= total && total > 0
      });
    });
  });
}

// ==========================================
// 6. 你的其他自定义路由策略
// ==========================================

// 版本号等动态 API：网络优先
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.endsWith('/version'),
  new NetworkFirst({ cacheName: 'rop-version' })
);

// 页面入口 HTML：网络优先
registerRoute(
  ({ request, url }) => url.origin === self.location.origin && request.destination === 'document',
  new NetworkFirst({ cacheName: 'rop-pages' })
);

// 其它没有被预抓取完全覆盖到的本站静态资源：缓存优先
registerRoute(
  ({ request, url }) => url.origin === self.location.origin && ['script', 'style', 'image', 'font'].includes(request.destination),
  new CacheFirst({ cacheName: 'rop-static' })
);