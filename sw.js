// 圏外でも開けるようにする（画面一式は先に保存、データは新しい方を優先して保存、地図は保存したものを優先）
const VERSION = "bcp-shell-20261113zg";
// 知識の記事の版（mac/build_knowledge.py が束の指紋を書く。記事が変わると SW が入れ直され、圏外用の保存も新しくなる）
const KNOW = "26e3979a7e44";
const SHELL = ["./", "index.html", "style.css", "app.js", "content.js", "manifest.webmanifest", "vendor/leaflet.js", "vendor/leaflet-rotate.js", "vendor/leaflet.css",
  "vendor/images/layers.png", "vendor/images/layers-2x.png", "vendor/images/marker-icon.png", "vendor/images/marker-shadow.png",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "data/places.json", "aid-figures.js", "navguide.js", "emergency_roads.json", "shelters.json", "hours.js", "poi_hours.json", "poi_extra.json", "knowledge.js", "knowledge/index.json",
  // 応急手当の絵40枚（圏外でも救急の図が出ることが一番大事。aid-figures.js と同じ一覧）
  "img/aid/cpr-00.webp", "img/aid/cpr-01.webp", "img/aid/cpr-02.webp", "img/aid/cpr-03.webp", "img/aid/cpr-04.webp", "img/aid/cpr-05.webp", "img/aid/cpr-06.webp", "img/aid/cpr-07.webp", "img/aid/recovery-00.webp", "img/aid/recovery-01.webp", "img/aid/recovery-03.webp", "img/aid/bleed-01.webp", "img/aid/bleed-02.webp", "img/aid/bleed-03.webp", "img/aid/bleed-04.webp", "img/aid/burn-01.webp", "img/aid/burn-02.webp", "img/aid/burn-03.webp", "img/aid/bone-01.webp", "img/aid/bone-02.webp", "img/aid/bone-03.webp", "img/aid/crush-03.webp", "img/aid/crush-01.webp", "img/aid/crush-02.webp", "img/aid/crush-04.webp", "img/aid/crush-05.webp", "img/aid/heat-01.webp", "img/aid/heat-05.webp", "img/aid/heat-02.webp", "img/aid/heat-03.webp", "img/aid/heat-04.webp", "img/aid/cold-01.webp", "img/aid/cold-02.webp", "img/aid/cold-03.webp", "img/aid/choke-01.webp", "img/aid/choke-02.webp", "img/aid/choke-04.webp", "img/aid/choke-05.webp", "img/aid/choke-03.webp", "img/aid/choke-06.webp"];
const TILES = "bcp-tiles-v1";
const DATA = "bcp-data-v1";
// 野草の写真など（数が多いので最初の保存には入れない）。見たら残す・知識の入口の「写真を端末に保存」で全部取る。版が変わっても消さない
const KIMG = "bcp-know-img-v1";

self.addEventListener("install", (e) => {
  // 知識の記事の束（knowledge/index.json に載っている物を全部。束を足しても sw.js の一覧を直さなくてよい）も一緒に保存する
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)
    .then(() => fetch("knowledge/index.json", { cache: "no-store" }).then((r) => r.json()))
    .then((idx) => c.addAll((idx.packs || []).map((p) => "knowledge/" + p.file).concat((idx.media && idx.media.figs) || []))))   // 合格した記事の絵も（小さいので最初に）
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("bcp-shell-") && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // 地図: 保存したものを先に。無ければ取りに行き、取れたら保存（見た所は次から圏外でも見られる）
  if (url.hostname === "cyberjapandata.gsi.go.jp" || url.hostname === "disaportaldata.gsi.go.jp") {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(req.url);
      if (hit) return hit;
      try { const r = await fetch(req.url, { mode: "cors" }); if (r.ok) c.put(req.url, r.clone()); return r; }
      catch (err) { return new Response("", { status: 504 }); }
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;   // 連絡網（ntfy）などはそのまま
  // 知識の写真: 保存したものを先に。無ければ取りに行き、取れたら保存
  if (url.pathname.includes("/knowledge/img/")) {
    e.respondWith(caches.open(KIMG).then(async (c) => {
      const hit = await c.match(url.pathname);
      if (hit) return hit;
      try { const r = await fetch(req); if (r.ok) c.put(url.pathname, r.clone()); return r; }
      catch (err) { return new Response("", { status: 504 }); }
    }));
    return;
  }
  // データ: 通信できれば最新、できなければ保存した最後のもの
  if (url.pathname.endsWith("/data/bundle.json") || url.pathname.endsWith("/data/version.json")) {
    const key = url.pathname;
    e.respondWith(caches.open(DATA).then(async (c) => {
      try { const r = await fetch(req, { cache: "no-store" }); if (r.ok) c.put(key, r.clone()); return r; }
      catch (err) { return (await c.match(key)) || new Response("{}", { status: 504 }); }
    }));
    return;
  }
  // 画面: 保存したものを先に出し、裏で新しくする
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || (await c.match("index.html")) || new Response("オフラインです", { status: 503 });
  }));
});
