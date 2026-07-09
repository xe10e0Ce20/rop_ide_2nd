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
  sendProgressToClients(''); // 发送初始 0/% 状态
  event.waitUntil(precacheController.install(event));
});

// 监听原生的 activate 阶段，自动清理旧版本的废弃缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(precacheController.activate(event));
});

// 4. 拦截全局请求，安全地交由 precache 匹配
self.addEventListener('fetch', (event) => {
  const responsePromise = precacheController.match(event.request);
  if (responsePromise) {
    // 只要是在自动抓取清单（__WB_MANIFEST）里的静态资源，100% 走本地离线缓存
    event.respondWith(responsePromise);
  }
  // 如果清单里没有，就会自动滑落到下方的自定义 registerRoute 规则中
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
// 6. 你的其他自定义路由策略 (滑落请求走这里)
// ==========================================

// 版本号等动态 API：网络优先
registerRoute(
  ({ url }) => url.pathname.endsWith('/version'),
  new NetworkFirst({ cacheName: 'rop-version' })
);

// 页面入口 HTML：网络优先（防卡死，能在有网时及时加载最新的 main.js 入口）
registerRoute(
  ({ request }) => request.destination === 'document',
  new NetworkFirst({ cacheName: 'rop-pages' })
);

// 其它没有被 vite-plugin-pwa 预抓取覆盖到的静态资源：缓存优先
registerRoute(
  ({ request }) => ['script', 'style', 'image', 'font'].includes(request.destination),
  new CacheFirst({ cacheName: 'rop-static' })
);