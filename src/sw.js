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

// 创建一个预缓存控制器
const precacheController = new PrecacheController({
  cacheName: 'workbox-precache-rop-ide' // 自定义你的预缓存空间名
});

// 核心：注册 Workbox 插件来拦截每一次缓存写入
precacheController.strategy.plugins.push({
  cacheWillUpdate: async ({ request, response }) => {
    // 只有当文件成功下载并准备写入缓存时触发
    if (response && response.status === 200) {
      loaded++;
      sendProgressToClients(request.url);
    }
    return response;
  }
});

// 将 Vite 自动抓取的资源清单塞给控制器
precacheController.addToCacheList(manifest);

// 监听原生的 install 事件，将其代理给控制器
self.addEventListener('install', (event) => {
  // 发送初始的 0/% 状态
  sendProgressToClients('');
  
  // 核心：让控制器开始串行/并行下载清单中的所有资源
  event.waitUntil(precacheController.install(event));
});

// 监听原生的 activate 事件，清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(precacheController.activate(event));
});

// 路由拦截：确保预缓存的文件能被正常匹配命中
registerRoute(
  ({ request }) => precacheController.match(request),
  async ({ request }) => {
    return (await precacheController.match(request)) || fetch(request);
  }
);

// --- 统一的进度推送函数 ---
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

// --- 你的其他自定义路由策略 ---

// 1. 版本号这类动态 API：网络优先
registerRoute(
  ({ url }) => url.pathname.endsWith('/version'),
  new NetworkFirst({ cacheName: 'rop-version' })
);

// 2. 页面/文档：网络优先
registerRoute(
  ({ request }) => request.destination === 'document',
  new NetworkFirst({ cacheName: 'rop-pages' })
);

// 3. 其他未被预缓存覆盖到的静态资源：缓存优先
registerRoute(
  ({ request }) => ['script', 'style', 'image', 'font'].includes(request.destination),
  new CacheFirst({ cacheName: 'rop-static' })
);