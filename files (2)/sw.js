/* 跟读笔记 —— Service Worker
   策略：能联网时永远拿最新的，断网时用上次缓存的。
   录音和笔记存在 IndexedDB 里，跟这里的缓存无关，清缓存不会丢数据。 */

const VERSION = "v1";
const CACHE = "readalong-" + VERSION;

/* 应用外壳：这几个文件缓存下来，断网也能打开 */
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./favicon-32.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .catch(() => {})          // 某个文件缺失也不要卡住安装
  );
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(n => n !== CACHE ? caches.delete(n) : null));
    await self.clients.claim();
  })());
});

/* 收到页面的指令后立刻接管，用于「有新版本 → 刷新」 */
self.addEventListener("message", e => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  /* 只管自己这个站的文件。YouTube 的脚本和视频一律直连，不缓存 */
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      /* 拿到新的就顺手更新缓存 */
      if (fresh && fresh.ok) {
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
      }
      return fresh;
    } catch (_) {
      /* 断网了 */
      const hit = await caches.match(req);
      if (hit) return hit;
      /* 页面导航请求兜底到首页 */
      if (req.mode === "navigate") {
        const home = await caches.match("./index.html");
        if (home) return home;
      }
      return new Response("离线，且没有缓存这个文件", {
        status: 503,
        headers: { "Content-Type": "text/plain;charset=utf-8" }
      });
    }
  })());
});
