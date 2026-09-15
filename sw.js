/* 跟读笔记 —— Service Worker
   策略优化版：
   1. HTML 主程式：网络优先 (Network First)，但加入 3 秒超时机制，防备弱网环境 (Lie-Fi) 卡死。
   2. 图片/静态资源：缓存优先 (Cache First)，实现秒开。
   3. 录音和笔记存在 IndexedDB 里，跟这里的缓存无关。 */

const VERSION = "v8.1"; // 升級版本號以觸發更新
const CACHE = "readalong-" + VERSION;
const TIMEOUT_MS = 3000; // 网络请求超时设定为 3 秒

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
  // 强制立即进入 waiting 状态
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .catch(err => console.warn("SW Install 预缓存部分失败", err)) 
  );
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    // 清理旧版本快取
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

  // 【策略 A：缓存优先 (Cache First)】 针对图片和 Manifest
  if (req.destination === 'image' || url.pathname.endsWith('.png') || url.pathname.endsWith('.webmanifest')) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit; // 缓存有就直接给，秒开

      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const c = await caches.open(CACHE);
          c.put(req, fresh.clone());
        }
        return fresh;
      } catch (err) {
        return new Response("", { status: 404 });
      }
    })());
    return;
  }

  // 【策略 B：网络优先带超时 (Network First with Timeout)】 针对 HTML
  e.respondWith((async () => {
    try {
      // 设定超时控制器
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

      // 发起请求，如果 3 秒没完成就会抛出 AbortError
      const fresh = await fetch(req, { signal: controller.signal });
      clearTimeout(timeoutId); // 成功的话清除定时器

      /* 拿到新的就顺手更新缓存 */
      if (fresh && fresh.ok) {
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
      }
      return fresh;
    } catch (err) {
      /* 断网或超时 (AbortError) 时，立刻退回使用缓存 */
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
