const VERSION = '0.0.1';
const CACHE_NAME = 'rop-ide';
const ASSETS = [
  '/',
  '/index.html',
  '/favicon.ico',
  // 可继续添加更多资源
];

// 发送进度消息给所有受控的客户端
function postProgress(message) {
  self.clients.matchAll({ type: 'window' }).then(clients => {
    clients.forEach(client => client.postMessage(message));
  });
}

self.addEventListener('install', (event) => {
  console.log('// VFS_PWA: 开始预缓存离线资源...');
  postProgress({ type: 'SW_PROGRESS', loaded: 0, total: ASSETS.length, finished: false });
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const total = ASSETS.length;
      let loaded = 0;

      for (const asset of ASSETS) {
        try {
          await cache.add(asset);
          loaded++;
          postProgress({
            type: 'SW_PROGRESS',
            loaded,
            total,
            current: asset,
            finished: loaded === total
          });
        } catch (err) {
          console.warn(`// VFS_PWA: 预缓存失败 [${asset}]`, err);
          loaded++;
          postProgress({
            type: 'SW_PROGRESS',
            loaded,
            total,
            current: asset,
            finished: loaded === total,
            error: err.toString()
          });
        }
      }

      console.log('// VFS_PWA: 预缓存完成');
      return self.skipWaiting();
    })
  );
});

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

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  if (url.pathname.endsWith('/version')) {
    event.respondWith(
      fetch(event.request).catch(() => new Response('OFFLINE', { status: 200 }))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      if (event.request.mode === 'navigate') {
        return caches.match('/index.html');
      }

      return fetch(event.request).catch((err) => {
        console.error('// VFS_PWA: 离线且无缓存:', event.request.url, err);
      });
    })
  );
});