'use strict';

// 매달리기 타이머 PWA service worker — 앱 셸 캐시(오프라인 동작)
const CACHE_VERSION = 'hang-timer-v4';
// 2026-06-21 fix: './index.html' 제거. tailscale serve가 /index.html → / 로 301
// 정규화해서 cache.addAll 이 실패 → install 실패 → PWA가 설치돼도 실행 안 되던 원인.
// './' 가 곧 index.html 이므로 기능 손실 없음.
const APP_SHELL = [
  './',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((resp) => {
          // 동일 출처 GET 응답만 캐시에 추가
          if (resp && resp.ok && new URL(event.request.url).origin === self.location.origin) {
            const copy = resp.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
          }
          return resp;
        })
        .catch(() => cached);
    })
  );
});
