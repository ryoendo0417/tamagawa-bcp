// BCPレーダー（多摩川行政書士事務所・ことぶき行政書士事務所）
// データは Mac mini の収集・分析が暗号化して data/bundle.json に置く。合言葉から作った鍵はこの端末だけに保存する。
"use strict";
(() => {
  const C = window.BCP_CONTENT;
  const HORIZONS = ["3日以内", "7日以内", "1か月以内", "3か月以内", "1年以内", "1年以降"];
  const TILE = {
    std: { name: "標準地図", url: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", max: 18 },
    pale: { name: "淡色地図", url: "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", max: 18 },
    // 2026-11-13 遠藤先生「地図ってこれしかないの？」→「2つを足して良いです」。見た所だけ残る（「地図を保存」の対象にはしない。OpenStreetMap はまとめて保存してはいけない決まり）
    photo: { name: "航空写真", url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", max: 18 },
    osm: { name: "OpenStreetMap", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", max: 18 },
    flood: { name: "洪水の浸水想定（想定最大）", url: "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png", max: 17, overlay: true },
    doseki: { name: "土砂災害警戒区域（土石流）", url: "https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png", max: 17, overlay: true },
    kyuke: { name: "土砂災害警戒区域（急傾斜地）", url: "https://disaportaldata.gsi.go.jp/raster/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png", max: 17, overlay: true },
    jisuberi: { name: "土砂災害警戒区域（地すべり）", url: "https://disaportaldata.gsi.go.jp/raster/05_jisuberikeikaikuiki/{z}/{x}/{y}.png", max: 17, overlay: true },
  };
  // iPhone 版（TestFlight）は、地図をアプリの裏方（/tile/…）から取る。裏方が端末に保存するので圏外でも見られる
  const NATIVE = !!window.__BCP_IOS;
  if (NATIVE) Object.keys(TILE).forEach((k) => { TILE[k].url = `/tile/${k}/{z}/{x}/{y}.png`; });
  // 保存する地図の範囲（2026-11-11 遠藤先生「東京と、東京に隣接する市町村までを地図データとして保持」）
  // WIDE＝東京都（島しょを除く）＋隣接の市町村＋その隣接の市町村（2026-11-12 遠藤先生「東京に隣接する市町村だけでなく、その市町村に隣接する市町村までいれてほしい」。mac/area.py）
  //   北は群馬県藤岡市・神川町、南は横須賀市、西は長野県川上村・群馬県上野村、東は柏市・船橋市・習志野市まで
  // WIDE1＝前の範囲（東京都＋隣接）。「詳しい地図」はこれと外側に分けて保存できる（外側だけで約1万枚・約0.5GB）
  const AREA_WIDE = { s: 35.13, w: 138.47, n: 36.32, e: 140.11 };
  const AREA_WIDE1 = { s: 35.31, w: 138.72, n: 36.10, e: 139.99 };
  const AREA_TOKYO = { s: 35.50, w: 138.94, n: 35.90, e: 139.92 };   // 洪水・土砂災害の重ね図は東京都の範囲
  const ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>・<a href="https://disaportal.gsi.go.jp/hazardmapportal/hazardmap/copyright/opendata.html" target="_blank" rel="noopener">重ねるハザードマップ</a>';

  // ---------- 端末に保存（読めない端末でも動く） ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("bcp." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("bcp." + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem("bcp." + k); } catch (e) { /* なし */ } },
  };
  // 現在地の控え（2026-11-13 遠藤先生「地図の現在地が間違っています」：一度取った位置をいつまでも使っていたため、
  // 移動しても「いま」の地図の点が前の場所のままだった）→ 取った時刻も覚え、古い位置は「現在地」として使わない
  function savePos(la, lo) { store.set("lastPos", [la, lo]); store.set("lastPosAt", Date.now()); }
  function freshPos(ms) { const p = store.get("lastPos", null); return p && Date.now() - store.get("lastPosAt", 0) < ms ? p : null; }
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
  const link = (u, t) => (safeUrl(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t || u)}</a>` : esc(t || ""));
  const ago = (iso) => {
    if (!iso) return "不明";
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return "いま"; if (m < 60) return m + "分前"; if (m < 1440) return Math.round(m / 60) + "時間前"; return Math.round(m / 1440) + "日前";
  };
  const hm = (iso) => { try { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; } catch (e) { return ""; } };
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);

  // 鍵の扱い（2026-11-11 遠藤先生「合言葉は不要」「4桁の暗証番号を登録できる仕組みに」）
  // ・最初の1回はミッションボードの「🛰 BCPレーダー」のリンク（#k=鍵）か TestFlight 版に入った鍵で開く。合言葉でも開ける（ボードを使えないとき）
  // ・鍵はこのスマホで決めた4桁の暗証番号で包んで保存（wkey）。端末には暗号化したままのデータ（env）だけを置き、中身は画面を開いている間だけ持つ
  let memKey = "";      // 鍵（この画面を開いている間だけ）
  let B = null;         // 復号したデータ（同上）
  let lockMode = "";    // "" | "pin"（暗証番号を聞く）| "setpin"（暗証番号を決める）| "none"（鍵が無い）
  store.del("bundle");  // 以前の版が平文で保存していたデータを消す
  (function migrate() { const k = store.get("key", ""); if (k && !store.get("rawkey", "") && !store.get("wkey", null)) store.set("rawkey", k); store.del("key"); })();
  let me = store.get("me", "");
  let view = store.get("tab", "now");
  let sosTab = "map";   // 緊急は最初に地図（2026-11-13 遠藤先生）
  let sosKit = "";
  let repKind = "", repOpen = "";
  let map = null;

  // ---------- 暗号（Mac の publish.py と同じ形） ----------
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const b64e = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));
  async function deriveKey(pass, env) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass.trim().toUpperCase()), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: b64d(env.salt), iterations: env.iter },
      base, { name: "AES-GCM", length: 256 }, true, ["decrypt"]);
    return b64e(await crypto.subtle.exportKey("raw", key));
  }
  async function decrypt(env, rawB64) {
    const key = await crypto.subtle.importKey("raw", b64d(rawB64), "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(env.iv), additionalData: new TextEncoder().encode(env.aad) }, key, b64d(env.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  async function fetchEnv() {
    const r = await fetch("data/bundle.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  async function refresh(manual) {
    if (!memKey) return;
    let env = null, fresh = false;
    try { env = await fetchEnv(); store.set("env", env); fresh = true; } catch (e) { env = store.get("env", null); }
    if (!env) { if (manual) toast("最新を取れませんでした（通信を確かめてください）"); return; }
    try {
      B = await decrypt(env, memKey);
      if (fresh) store.set("fetched", new Date().toISOString());
      render(true);
      if (manual) toast(fresh ? "最新にしました" : "通信できないので、保存した情報を表示しています");
    } catch (e) {
      toast("鍵が合いません。ミッションボードの「🛰 BCPレーダー」から開き直してください");
    }
  }
  // ---------- 暗証番号（4桁）で鍵を包む ----------
  const PIN_ITER = 300000;
  async function pinKey(pin, salt, iter) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode("bcp-pin:" + pin), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function wrapKey(pin, raw) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await pinKey(pin, salt, PIN_ITER), b64d(raw));
    return { salt: b64e(salt), iv: b64e(iv), ct: b64e(ct), iter: PIN_ITER };
  }
  async function unwrapKey(pin, w) {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(w.iv) }, await pinKey(pin, b64d(w.salt), w.iter), b64d(w.ct));
    return b64e(plain);
  }
  async function keyWorks(raw) {
    let env = null;
    try { env = await fetchEnv(); store.set("env", env); } catch (e) { env = store.get("env", null); }
    if (!env) throw new Error("offline");
    B = await decrypt(env, raw);
    return true;
  }
  function takeLinkKey() {
    let k = "";
    const m = location.hash.match(/[#&]k=([^&]+)/);
    if (m) { k = decodeURIComponent(m[1]); try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* なし */ } }
    if (!k && window.__BCP_KEY) k = String(window.__BCP_KEY);   // TestFlight 版（アプリが入れる）
    return k;
  }
  function renderLock(msg) {
    const el = $("#lock");
    const meSel = (id) => `<label>このスマホを使う人<select id="${id}"><option value="">選んでください</option>${["遠藤", "堀部"].map((n) => `<option ${n === me ? "selected" : ""}>${n}</option>`).join("")}</select></label>`;
    const sosBtn = `<button id="skiplock" class="ghost">暗証番号なしで「緊急」の情報だけ見る</button><button id="skipknow" class="ghost">暗証番号なしで「知識」を読む（応急手当・場面の手引き・薬）</button>`;
    let h = "";
    if (lockMode === "pin") {
      h = `<h1>暗証番号</h1><p>このスマホで決めた4桁の暗証番号を入れてください。</p>
        <input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" class="pin">
        <button id="pinopen" class="primary">開く</button><p id="lockmsg" class="muted">${esc(msg || "")}</p>
        <p class="muted">忘れたときは、ミッションボードの「🛰 BCPレーダー」から開き直すと、暗証番号を決め直せます。</p>${sosBtn}`;
    } else if (lockMode === "setpin") {
      h = `<h1>暗証番号を決める</h1><p>このスマホで使う4桁の暗証番号を決めてください。次からはこの番号だけで開きます（合言葉は要りません）。</p>
        ${me ? "" : meSel("me1")}
        <label>暗証番号（4桁）<input id="pin1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" class="pin"></label>
        <label>もう一度<input id="pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" class="pin"></label>
        <button id="pinset" class="primary">登録する</button><p id="lockmsg" class="muted">${esc(msg || "")}</p>
        <button id="pinskip" class="ghost">暗証番号なしで使う（このスマホを開ける人なら誰でも見られます）</button>`;
    } else {
      h = `<h1>BCPレーダー</h1><p>ミッションボードの上の「🛰 BCPレーダー」から開いてください。合言葉は要りません。開いたら、このスマホの4桁の暗証番号を決めます。</p>
        <details><summary>ボードを使えないとき（合言葉で開く）</summary><div class="body">
        <label>合言葉 <input id="pass" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX"></label>
        ${meSel("me0")}<button id="unlock" class="primary">開く</button></div></details>
        <p id="lockmsg" class="muted">${esc(msg || "")}</p>${sosBtn}`;
    }
    el.innerHTML = h;
    const f = $("#pin") || $("#pin1");
    if (f) setTimeout(() => f.focus(), 50);
  }
  async function unlock() {
    const pass = $("#pass").value;
    const who = $("#me0").value;
    $("#lockmsg").textContent = "確かめています…";
    try {
      const env = await fetchEnv();
      const key = await deriveKey(pass, env);
      B = await decrypt(env, key);
      store.set("env", env);
      if (who) { me = who; store.set("me", who); }
      memKey = key; lockMode = "setpin"; renderLock(); persist();
    } catch (e) {
      $("#lockmsg").textContent = navigator.onLine ? "合言葉が違うようです。もう一度入れてください。" : "初回は通信が必要です。電波のある所でもう一度。";
    }
  }
  async function pinOpen() {
    const pin = ($("#pin").value || "").trim();
    if (!/^\d{4}$/.test(pin)) { $("#lockmsg").textContent = "4桁の数字を入れてください"; return; }
    $("#lockmsg").textContent = "確かめています…";
    try {
      memKey = await unwrapKey(pin, store.get("wkey", null));
      store.set("pinFail", 0); lockMode = "";
      go(view); refresh(); pollChat();
    } catch (e) {
      const n = (store.get("pinFail", 0) || 0) + 1; store.set("pinFail", n);
      if (n >= 5) { store.del("wkey"); store.set("pinFail", 0); lockMode = "none"; renderLock("5回まちがえたので、このスマホの鍵を消しました。ミッションボードの「🛰 BCPレーダー」から開き直してください。"); return; }
      $("#pin").value = ""; $("#lockmsg").textContent = `暗証番号が違います（あと${5 - n}回）`;
    }
  }
  async function pinSet() {
    const p1 = ($("#pin1").value || "").trim(), p2 = ($("#pin2").value || "").trim();
    if ($("#me1") && $("#me1").value) { me = $("#me1").value; store.set("me", me); }
    if (!/^\d{4}$/.test(p1)) { $("#lockmsg").textContent = "4桁の数字にしてください"; return; }
    if (p1 !== p2) { $("#lockmsg").textContent = "2回の番号が合いません"; return; }
    store.set("wkey", await wrapKey(p1, memKey)); store.del("rawkey"); store.set("pinFail", 0);
    lockMode = ""; toast("暗証番号を登録しました"); go("now"); refresh(); pollChat();
  }
  async function persist() {
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* なし */ }
  }

  // ---------- 表示の切り替え ----------
  function go(v) {
    if (v !== "chat") posShown = false;   // 2人の位置は、連絡の画面を離れたら隠し直す
    if (v !== "sos" && mapFull) { mapFull = false; document.body.classList.remove("mapfull"); }
    view = v; store.set("tab", v);
    document.querySelectorAll(".view").forEach((s) => s.classList.remove("on"));
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    if ((!memKey || lockMode) && v !== "sos" && v !== "know") { if (!lockMode) lockMode = store.get("wkey", null) ? "pin" : "none"; $("#lock").classList.add("on"); renderLock(); return; }
    $("#v-" + v).classList.add("on");
    render();
    window.scrollTo(0, 0);
    if (v === "chat") pollChat();
  }
  function render(fromData) {
    netBadge();
    if (view === "now") renderNow();
    else if (view === "report") renderReport();
    else if (view === "chat") renderChat();
    else if (view === "sos" && fromData && sosTab === "map" && map) roadsUpdate();   // データの更新では地図を作り直さない（道案内・見ている所を保つ）
    else if (view === "sos") renderSos();
    else if (view === "set") renderSet();
    else if (view === "know" && window.BCP_KNOW) window.BCP_KNOW.render($("#v-know"));   // 知識（鍵なしで読める・圏外でも。web/knowledge.js）
  }
  function netBadge() {
    const el = $("#net");
    const on = navigator.onLine;
    el.textContent = on ? "通信あり" : "圏外・オフライン";
    el.classList.toggle("off", !on);
  }
  let toastT;
  function toast(t) {
    let el = $("#toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.style.cssText = "position:fixed;left:16px;right:16px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:2000;background:#14212b;color:#fff;padding:12px 14px;border-radius:12px;font-size:15px;text-align:center"; document.body.appendChild(el); }
    el.textContent = t; el.style.display = "block"; clearTimeout(toastT); toastT = setTimeout(() => (el.style.display = "none"), 3500);
  }

  // ---------- いま ----------
  const STATUS = [["disaster", "災害・気象", "🌧"], ["security", "安全保障", "🛡"], ["lifeline", "ライフライン", "💡"], ["fuel", "燃料", "⛽"],
    ["pandemic_medicine", "感染症・薬", "💊"], ["space_weather", "宇宙天気", "☀"], ["business_env", "業務環境", "📋"]];
  const LV = { "警戒": "lv-red", "注意": "lv-amber", "平常": "lv-green", "不明": "lv-gray" };
  function statusOf(st, k) {
    const v = (st || {})[k];
    if (v && typeof v === "object") return v;
    const t = String(v || "");
    return { level: "不明", short: t.split(/[。、]/)[0].slice(0, 22) || "—", detail: t };
  }
  function renderNow() {
    const el = $("#v-now");
    if (!B) { el.innerHTML = `<div class="empty">まだ情報がありません。通信のある所で開くと読み込みます。</div>`; return; }
    const rep = B.report || {};
    const items = rep.items || [];
    const recent = (B.alerts || []).filter((a) => Date.now() - new Date(a.at).getTime() < 72 * 3600e3).reverse();
    const stale = B.collector && B.collector.last_run && Date.now() - new Date(B.collector.last_run).getTime() > 90 * 60e3;
    // 全体の判定：自動のお知らせ（24時間）が最重要なら警戒
    let level = rep.level || "";
    if (recent.some((a) => a.level === "critical" && Date.now() - new Date(a.at).getTime() < 24 * 3600e3)) level = "警戒";
    else if (!level) level = recent.length ? "注意" : "平常";
    let h = `<div class="hero ${LV[level] || "lv-gray"}"><div class="hero-lv">いま：${esc(level)}</div><div class="hero-h">${esc(rep.headline || "レポートはまだありません")}</div>
      <div class="hero-t">${esc(ago(B.built_at))}の情報${stale ? "・Macの収集が止まっているかも" : ""}</div></div>`;
    h += `<div id="nowmap" class="nowmap" title="押すと大きな地図"></div>`;
    if (recent.length) h += recent.slice(0, 5).map((a) => `<details class="alert ${a.level === "critical" ? "critical" : ""}"><summary>${esc(a.title)}<span class="when">${esc(hm(a.at))}</span></summary><div>${esc(a.body)} ${a.link ? link(a.link, "詳しく") : ""}</div></details>`).join("");
    const reminders = [];
    medStatus().filter((m) => m.low).forEach((m) => reminders.push([`💊 ${m.name} あと約${m.days}日`, "sos:meds"]));
    const ka = kitAlerts();
    const bad = ka.filter((t) => t.includes("期限"));
    const notyet = ka.filter((t) => !t.includes("期限"));
    if (bad.length) reminders.push([`🎒 防災グッズの期限：${bad.length}か所で切れ・間近`, "sos:prep"]);
    if (notyet.length) reminders.push([`🎒 防災グッズ：点検の時期 ${notyet.length}か所`, "sos:prep"]);
    if (reminders.length) h += `<div class="list">${reminders.slice(0, 5).map(([t, g]) => `<a class="li warn" href="#" data-go="${g}"><span>${esc(t)}</span><span class="chev">›</span></a>`).join("")}</div>`;
    const today = rep.today && rep.today.length ? rep.today
      : items.filter((i) => i.horizon === "3日以内").slice(0, 5).map((i) => ({ who: (i.actions[0] || {}).who || "", what: i.title, why: i.situation }));
    // 今日やることは「なぜやるか」とレポートの該当項目・出典へつなぐ（2026-11-11 先生「なぜこの対策をやるのか分からない。レポートへのリンクを」）
    if (today.length) h += `<h2>今日やること</h2><div class="list">${today.map((t) => {
      const it = matchItem(t, items);
      const src = it && it.sources && it.sources.length ? `<div class="srcs">${it.sources.slice(0, 3).map((s) => link(s.url, "🔗 " + s.name)).join("")}</div>` : "";
      return `<details class="li"><summary><span class="who">${esc(t.who)}</span>${esc(t.what)}</summary><div><p class="why"><b>なぜ：</b>${esc(t.why)}</p>${it ? `<p class="why">${esc(it.situation)}</p>` : ""}${src}${it ? `<a href="#" class="toreport" data-focus="${esc(it.id)}">📄 レポートで詳しく見る</a>` : ""}</div></details>`;
    }).join("")}</div>`;
    if (rep.status) h += `<h2>分野ごと</h2><div class="list">${STATUS.map(([k, n, ic]) => { const v = statusOf(rep.status, k); return `<details class="li"><summary><span class="dot ${LV[v.level] || "lv-gray"}"></span><span class="sn">${ic} ${n}</span><span class="ss">${esc(v.short)}</span></summary><div class="muted">${esc(v.detail)}</div></details>`; }).join("")}</div>`;
    if (items.length) h += `<h2>やることの数（期限ごと）</h2><div class="hzrow">${HORIZONS.map((x) => { const r = items.filter((i) => i.horizon === x); const hot = r.filter((i) => i.priority >= 4).length; return `<a href="#" class="hz-c ${r.length ? "" : "zero"}" data-hz="${x}"><b>${r.length}</b><span>${HZ_LABEL[x]}</span>${hot ? `<small class="hot">要対応${hot}</small>` : ""}</a>`; }).join("")}</div>`;
    if (rep.summary) h += `<details class="card"><summary><b>今日のまとめ（詳しく）</b></summary><p>${esc(rep.summary)}</p><p class="muted">${esc(hm(rep.generated_at))} 作成${rep.urgent ? "（臨時）" : ""}</p></details>`;
    const heads = B.headlines || [];
    if (heads.length) {
      const cats = [...new Set(heads.map((x) => x.cat))];
      h += `<details class="card"><summary><b>集めた見出し（48時間・${heads.length}件）</b></summary>` + cats.map((c) => {
        const rows = heads.filter((x) => x.cat === c);
        return `<details><summary>${esc(c)}（${rows.length}）</summary><div class="body">${rows.slice(0, 25).map((x) => `<p>${link(x.link, x.title)} <span class="muted">${esc(x.source)}</span></p>`).join("")}</div></details>`;
      }).join("") + `</details>`;
    }
    el.innerHTML = h;
    setTimeout(drawNowMap, 0);
  }
  // 「いま」の周辺地図（2026-11-11 先生「簡単な周辺図。問題があったら地図に表示」）：現在地（無ければ事務所）の周り。
  // 印：事務所など（青）・警報が出ている市町村（⚠）・地震の震源・3日以内の自動のお知らせ（位置のあるもの）
  let nowMap = null;
  function drawNowMap() {
    const box = $("#nowmap");
    if (!box || !window.L) return;
    if (nowMap) { try { nowMap.remove(); } catch (e) { /* なし */ } nowMap = null; }
    const pos = freshPos(10 * 60e3);   // 10分より前の位置は使わない（取り直すまで事務所の周り）
    const office = ((B && B.places) || [])[0];
    const c = pos || (office ? [office.lat, office.lon] : [35.7879, 139.2758]);
    nowMap = L.map(box, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false, fadeAnimation: false, zoomAnimation: false }).setView(c, 11);
    L.tileLayer(TILE.pale.url, { maxZoom: 18 }).addTo(nowMap);
    const dot = (color, r) => ({ radius: r || 7, color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.95 });
    ((B && B.places) || []).forEach((p) => L.circleMarker([p.lat, p.lon], dot("#0b6bcb")).addTo(nowMap));
    const me = pos ? L.circleMarker(pos, dot("#e8590c", 8)).addTo(nowMap) : null;
    const warn = (B && B.cityWarn) || {};
    const CITY = { 青梅市: [35.7879, 139.2758], 檜原村: [35.72683, 139.1489], あきる野市: [35.72923, 139.29441], 日の出町: [35.74204, 139.25742], 奥多摩町: [35.80954, 139.09616], 羽村市: [35.76743, 139.31097] };
    let n = 0;
    Object.entries(warn).forEach(([city, kinds]) => {
      if (!kinds || !kinds.length || !CITY[city]) return;
      n++;
      L.marker(CITY[city], { icon: L.divIcon({ className: "nowwarn", html: "⚠", iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(nowMap).bindTooltip(`${city}：${kinds.join("・")}`, { permanent: true, direction: "top", className: "nowtip" });
    });
    ((B && B.alerts) || []).filter((a) => a.lat && a.lon && Date.now() - new Date(a.at).getTime() < 72 * 3600e3).forEach((a) => {
      n++;
      L.marker([a.lat, a.lon], { icon: L.divIcon({ className: "nowwarn " + (a.level === "critical" ? "crit" : ""), html: a.cat === "地震" ? "◎" : "⚠", iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(nowMap).bindTooltip(a.title, { direction: "top", className: "nowtip" });
    });
    const note = document.createElement("div"); note.className = "nowmap-note";
    note.textContent = n ? `地図に ${n} 件の注意（押すと大きな地図）` : "周りに警報・自動のお知らせはありません（押すと大きな地図）";
    box.appendChild(note);
    box.onclick = () => { sosTab = "map"; mapFullOnInit = true; go("sos"); };
    // 開くたびに（1分に1回まで）いまの位置を取り直し、点と地図の真ん中を動かす
    if (navigator.geolocation && Date.now() - (drawNowMap.at || 0) > 60e3) {
      drawNowMap.at = Date.now();
      const m0 = nowMap;
      navigator.geolocation.getCurrentPosition((p) => {
        const q = [p.coords.latitude, p.coords.longitude];
        savePos(q[0], q[1]);
        if (view !== "now" || nowMap !== m0 || !nowMap) return;
        if (me) me.setLatLng(q); else L.circleMarker(q, dot("#e8590c", 8)).addTo(nowMap);
        nowMap.setView(q, 11);
      }, () => { drawNowMap.at = 0; }, { timeout: 15000, maximumAge: 60000 });   // 取れなかったら次に開いたときにまた試す
    }
  }
  const HZ_LABEL = { "3日以内": "今日〜3日", "7日以内": "1週間以内", "1か月以内": "1か月以内", "3か月以内": "3か月以内", "1年以内": "1年以内", "1年以降": "1年より先" };
  function badge(i) { return i.priority >= 4 ? ["要対応", "b-red"] : i.priority === 3 ? ["確認", "b-amber"] : ["参考", "b-gray"]; }
  // 今日やること → レポートの項目（言葉の重なりで一番近いもの）
  function bigr(t) { const s = String(t || "").replace(/[\s　、。・：:（）()「」]/g, ""); const o = new Set(); for (let i = 0; i < s.length - 1; i++) o.add(s.slice(i, i + 2)); return o; }
  function matchItem(t, items) {
    const q = bigr(t.what + t.why);
    let best = null, bs = 0;
    (items || []).forEach((i) => { const b = bigr(i.title + (i.actions || []).map((a) => a.what).join("")); let n = 0; q.forEach((x) => { if (b.has(x)) n++; }); const sc = n / Math.max(1, Math.min(q.size, b.size)); if (sc > bs) { bs = sc; best = i; } });
    return bs >= 0.25 ? best : null;
  }
  let repFocus = "";
  function itemCard(i, open) {
    const k = i.kind === "機会" ? "chance" : "threat";
    const [bt, bc] = badge(i);
    const a0 = (i.actions || [])[0];
    return `<details class="todo ${k}" id="it-${esc(i.id || "")}" ${open || (repFocus && repFocus === i.id) ? "open" : ""}><summary>
        <div class="t1"><span class="bd ${bc}">${bt}</span><span class="kd ${k}">${i.kind === "機会" ? "チャンス" : "リスク"}</span><span class="tt">${esc(i.title)}</span></div>
        ${a0 ? `<div class="t2"><b>${esc(a0.who)}</b>：${esc(a0.what)}</div>` : ""}
      </summary><div class="body">
      <p>${esc(i.situation)}</p>
      ${(i.actions || []).length ? `<p class="lbl">やること</p><ul class="act">${i.actions.map((a) => `<li><b>${esc(a.who)}</b>：${esc(a.what)}${a.by ? `<span class="muted">（${esc(a.by)}まで）</span>` : ""}</li>`).join("")}</ul>` : ""}
      <p class="muted">${esc(HZ_LABEL[i.horizon] || i.horizon)}・${esc(i.category)}・${esc(i.confidence)}</p>
      <p class="muted">${(i.sources || []).map((s) => link(s.url, s.name)).join("　")}</p></div></details>`;
  }

  // ---------- レポート ----------
  function renderReport() {
    const el = $("#v-report");
    const items = (B && B.report && B.report.items) || [];
    if (!items.length) { el.innerHTML = `<div class="empty">レポートはまだありません（毎朝 Mac mini が作ります）。</div>`; return; }
    const rows = items.filter((i) => !repKind || i.kind === repKind);
    let h = `<div class="rep-head"><h1>やることリスト</h1><span class="muted">${esc(hm(B.report.generated_at))}</span></div>`;
    h += `<div class="seg">${[["", "すべて"], ["脅威", "リスク"], ["機会", "チャンス"]].map(([x, n]) => `<button class="${x === repKind ? "on" : ""}" data-k="${x}">${n} ${items.filter((i) => !x || i.kind === x).length}</button>`).join("")}</div>`;
    h += HORIZONS.map((x) => {
      const r = rows.filter((i) => i.horizon === x);
      if (!r.length) return "";
      return `<h2 id="h-${x}" class="hz-h">${HZ_LABEL[x]}<span>${r.length}件</span></h2><div class="todos">${r.map((i) => itemCard(i, repOpen === x && false)).join("")}</div>`;
    }).join("");
    el.innerHTML = h;
    if (repOpen) { const e = document.getElementById("h-" + repOpen); if (e) setTimeout(() => e.scrollIntoView(), 0); }
    if (repFocus) { const e = document.getElementById("it-" + repFocus); if (e) setTimeout(() => e.scrollIntoView({ block: "center" }), 0); }
    repOpen = ""; repFocus = "";
  }

  // ---------- 連絡（ntfy＋スプレッドシート） ----------
  // ntfy：相手のスマホへの知らせ・未読の繰り返しの知らせ（mac/remind.py）・半日で消える
  // スプレッドシート（ボードの GAS の bcpChat*。共有ドライブ「92.BCP・情報収集」）：LINE のような会話の記録・写真（2026-11-11 先生）
  // 送るときは両方へ。同じ書き込み（cid）は画面で1つにまとめる
  let polling = false;
  const newCid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  async function sheetCall(body) {
    const r = await fetch(B.chat2.url, { method: "POST", body: JSON.stringify(Object.assign({ key: B.chat2.key }, body)) });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || "error");
    return d;
  }
  async function pollChat() {
    if (!B || !B.chat || polling || !navigator.onLine) { if (view === "chat") renderChat(); return; }
    polling = true;
    try {
      pushReg();
      await flushOutbox();
      const r = await fetch(`${B.chat.server}/${encodeURIComponent(B.chat.topic)}/json?poll=1&since=all`, { cache: "no-store" });
      const text = await r.text();
      const msgs = text.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
        .filter((m) => m && m.event === "message").map((m) => ({ id: m.id, time: m.time, title: m.title || "", message: m.message || "" }));
      const all = new Map(store.get("msgs", []).map((m) => [m.id, m]));
      msgs.forEach((m) => all.set(m.id, m));
      store.set("msgs", [...all.values()].sort((a, b) => a.time - b.time).slice(-300));
    } catch (e) { /* 通信なし */ }
    // 取り消しの合図（既読の合図と同じ -r の置き場。{who, del: cid}）
    try {
      const r = await fetch(`${B.chat.server}/${encodeURIComponent(B.chat.topic + "-r")}/json?poll=1&since=all`, { cache: "no-store" });
      const dels = (await r.text()).split("\n").filter(Boolean).map((l) => { try { const m = JSON.parse(l); return m.event === "message" ? JSON.parse(m.message || "{}") : null; } catch (e) { return null; } })
        .filter((d) => d && d.del && (d.who === "遠藤" || d.who === "堀部")).map((d) => String(d.del));
      if (dels.length) addDel(dels);
    } catch (e) { /* 通信なし */ }
    if (B.chat2) {
      try {
        const d = await sheetCall({ action: "bcpChatList", since: store.get("rowsLast", 0) });
        if (d.rows && d.rows.length) {
          const rows = store.get("rows", []).concat(d.rows.map((r) => ({ row: r.row, cid: r.cid, time: r.time, from: r.from, text: r.text, imageId: r.imageId, thumb: r.thumb, lat: r.lat, lon: r.lon, deleted: r.deleted || 0 })));
          store.set("rows", rows.slice(-150));
        }
        if (d.del && d.del.length) addDel(d.del);
        if (d.last) store.set("rowsLast", d.last);
      } catch (e) { /* 次の確認で */ }
    }
    polling = false;
    const list = timeline();
    const seen = store.get("seenMsg", 0);
    const unread = list.filter((m) => m.t > seen && m.from !== me && m.from !== "自動" && !m.deleted).length;
    const tb = document.querySelector('#tabs button[data-v="chat"]');
    if (tb) tb.innerHTML = `<span class="i">✉</span>連絡${unread && view !== "chat" ? `（${unread}）` : ""}`;
    if (view === "chat") renderChat();
  }
  // 画面に出す並び（古い→新しい）。t は秒
  // 送信の取り消し（2026-11-12 遠藤先生「送ったメッセージは削除できるようにしてください」）：取り消した書き込みの cid（端末に覚える）
  function addDel(list) { const s = new Set(store.get("delCids", [])); let n = 0; list.forEach((c) => { if (c && !s.has(c)) { s.add(c); n++; } }); if (n) store.set("delCids", [...s].slice(-300)); }
  function timeline() {
    const rows = store.get("rows", []);
    const del = new Set(store.get("delCids", []));
    const cids = new Set(rows.map((r) => r.cid).filter(Boolean));
    const gone = (o) => Object.assign(o, { deleted: true, text: "", thumb: "", imageId: "" });
    const out = rows.map((r) => { const o = { k: "s" + r.row, t: Math.floor(Number(r.time) / 1000), from: r.from, text: r.text, thumb: r.thumb, imageId: r.imageId, cid: r.cid }; return r.deleted || del.has(r.cid) ? gone(o) : o; });
    store.get("msgs", []).forEach((m) => {
      const msg = String(m.message);
      const cm = msg.match(/#cid:([a-z0-9]+)/);
      if (cm && cids.has(cm[1])) return;
      if (cm) cids.add(cm[1]);   // 同じ書き込み（cid）は1つだけ出す
      if (/#BCPKIT /.test(msg) && !/防災グッズ点検/.test(m.title)) return;
      const who = (m.title.match(/^【(遠藤|堀部)】/) || [])[1] || (m.title.includes("自動のお知らせ") ? "自動" : "");
      const o = { k: "n" + m.id, t: m.time, from: who, text: who === "自動" ? m.title + "\n" + msg : msg.replace(/\n?#cid:[a-z0-9]+/, "").replace(/\n#BCPKIT [^\n]*/g, ""), title: m.title, cid: cm ? cm[1] : "" };
      out.push(cm && del.has(cm[1]) ? gone(o) : o);
    });
    return out.sort((a, b) => a.t - b.t).slice(-120);
  }
  function outbox() { return store.get("outbox", []); }
  // 取り消しを相手へ（-r の置き場に合図・スプレッドシートの行に印）。圏外なら貯めて、通信が戻ったら送る
  async function flushDel() {
    const q = store.get("delq", []);
    if (!q.length || !B || !B.chat) return;
    const left = [];
    for (const d of q) {
      if (!d.sig) { try { const r = await fetch(B.chat.server + "/", { method: "POST", body: JSON.stringify({ topic: B.chat.topic + "-r", message: JSON.stringify({ who: me, del: d.cid, at: d.at }) }) }); if (r.ok) d.sig = true; } catch (e) { /* 次に */ } }
      if (!d.sheet && !B.chat2) d.sheet = true;
      if (!d.sheet) { try { await sheetCall({ action: "bcpChatDelete", cid: d.cid, from: me }); d.sheet = true; } catch (e) { /* 次に */ } }
      if (!(d.sig && d.sheet)) left.push(d);
    }
    store.set("delq", left);
  }
  async function unsend(cid) {
    if (!cid || !me) return;
    const ok = confirm("このメッセージの送信を取り消しますか？\n\n・相手の画面には「メッセージの送信を取り消しました」と出ます\n・相手がまだ見ていなければ、相手の iPhone の BCP アプリの通知も「メッセージの送信を取り消しました」に置き換わります（ntfy アプリに届いた知らせは消せません）\n・記録は事務所のスプレッドシートに残ります（会話の一覧からは隠します）");
    if (!ok) return;
    const box = outbox(), i = box.findIndex((m) => m.cid === cid);
    let sentSomewhere = true;
    if (i >= 0) { sentSomewhere = !!(box[i].ntfy || box[i].sheet); box.splice(i, 1); store.set("outbox", box); }   // 送信待ちはその場で取り消す
    if (sentSomewhere) { addDel([cid]); const q = store.get("delq", []); q.push({ cid, at: Date.now() }); store.set("delq", q); }
    renderChat();
    if (sentSomewhere && navigator.onLine) await flushDel();
    toast(i >= 0 && !sentSomewhere ? "送信待ちのメッセージを取り消しました" : (store.get("delq", []).length ? "取り消しました（相手への合図は通信が戻ったら送ります）" : "送信を取り消しました"));
  }
  // 同時に2つ動くと同じ書き込みを二度送るので、動いている間は同じものを待つ（2026-11-12 試験で「圏外での試験」が2回届いていた）
  let flushing = null;
  function flushOutbox() {
    if (!flushing) flushing = flushOutbox1().finally(() => { flushing = null; });
    return flushing;
  }
  async function flushOutbox1() {
    if (!B || !B.chat) return;
    await flushDel();
    const box = outbox();
    const left = [];
    for (const m of box) {
      if (!m.ntfy) {
        try {
          const r = await fetch(B.chat.server + "/", { method: "POST", body: JSON.stringify({ topic: B.chat.topic, title: m.title, message: m.message + (m.cid ? "\n#cid:" + m.cid : ""), tags: m.tags || [] }) });
          if (r.ok) m.ntfy = true;
        } catch (e) { /* 次に */ }
      }
      if (!m.sheet && (!B.chat2 || m.ntfyOnly)) m.sheet = true;
      if (!m.sheet) {
        try { await sheetCall({ action: "bcpChatSend", cid: m.cid, from: me, text: m.text, image: m.image || "", thumb: m.thumb || "", lat: m.lat || "", lon: m.lon || "" }); m.sheet = true; }
        catch (e) { /* 次に */ }
      }
      if (!(m.ntfy && m.sheet)) left.push(m);
    }
    try { store.set("outbox", left); } catch (e) { /* 写真で端末の保存がいっぱい */ }
  }
  async function send(message, tags, opt) {
    if (!me) { toast("先に設定で「このスマホを使う人」を選んでください"); go("set"); return; }
    opt = opt || {};
    const m = { cid: newCid(), title: `【${me}】${(opt.image ? "📷 写真 " : "") + message.split("\n")[0].slice(0, 40)}`, message: (opt.image ? "📷 写真\n" : "") + message,
      text: message, tags: tags || [], queued: Date.now(), image: opt.image || "", thumb: opt.thumb || "", lat: opt.lat || "", lon: opt.lon || "", ntfyOnly: !!opt.ntfyOnly };
    const box = outbox(); box.push(m);
    if (!store.set("outbox", box)) { m.image = ""; store.set("outbox", box); toast("写真が大きく、端末に預けられませんでした（文字だけ送ります）"); }
    renderChat();
    if (navigator.onLine) { await flushOutbox(); await pollChat(); }
    toast(outbox().length ? "通信が戻ったら自動で送ります（このアプリを開いておく）" : "送りました");
  }
  // 写真は端末で縮めてから送る（長い辺1280px・JPEG 0.7）。一覧用に240pxの小さな画像も作る
  function shrink(file, max, q) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        res(c.toDataURL("image/jpeg", q));
      };
      img.onerror = rej; img.src = url;
    });
  }
  async function sendPhoto(file) {
    try {
      const full = await shrink(file, 1280, 0.7), thumb = await shrink(file, 240, 0.6);
      const loc = $("#withloc") && $("#withloc").checked ? await locate() : "";
      const text = (($("#msg") && $("#msg").value) || "").trim();
      if ($("#msg")) $("#msg").value = "";
      await send((text || "写真") + loc, ["camera"], { image: full.split(",")[1], thumb });
    } catch (e) { toast("写真を読めませんでした"); }
  }
  async function showImage(id, thumb) {
    let ov = $("#imgview");
    if (!ov) { ov = document.createElement("div"); ov.id = "imgview"; document.body.appendChild(ov); ov.addEventListener("click", () => ov.remove()); }
    ov.innerHTML = `<img src="${thumb || ""}" alt=""><p>${navigator.onLine ? "大きな写真を取っています…" : "圏外なので小さな写真だけです"}</p>`;
    if (!id || !navigator.onLine) return;
    try { const d = await sheetCall({ action: "bcpChatImage", imageId: id }); ov.innerHTML = `<img src="data:${d.type};base64,${d.data}" alt=""><p>押すと閉じます</p>`; }
    catch (e) { ov.querySelector("p").textContent = "大きな写真を取れませんでした"; }
  }
  function locate() {
    return new Promise((res) => {
      if (!navigator.geolocation) return res("");
      navigator.geolocation.getCurrentPosition((p) => {
        const { latitude: la, longitude: lo, accuracy: ac } = p.coords;
        res(`\n位置: ${la.toFixed(5)},${lo.toFixed(5)}（誤差約${Math.round(ac)}m） https://maps.gsi.go.jp/#16/${la.toFixed(5)}/${lo.toFixed(5)}/`);
      }, () => res(""), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    });
  }
  function peopleTel() {
    const local = store.get("tels", {});
    return ((B && B.people) || [{ name: "遠藤" }, { name: "堀部" }]).map((p) => ({ name: p.name, tel: local[p.name] || p.tel || "" }));
  }
  // 既読の合図：連絡の画面で見たら、別の場所（トピック名-r。ntfy アプリには出ない）へ「どこまで見たか」を送る。
  // Mac（mac/remind.py）がこれを見て、相手への繰り返しの知らせを止める（2026-11-11 先生「アプリを開いて確認するまで知らせる」）
  let lastReceipt = 0;
  // 2026-11-13 遠藤先生「直接通知してほしい」：iPhone のアプリ（ios/BCPRadar/Push.swift）が受け取った Apple の通知の宛先（端末の番号）を、
  // 「このスマホを使う人」と一緒に既読の合図と同じ場所（トピック名-r。ntfy アプリには出ない）へ送る。Mac（mac/remind.py）が覚え、
  // 相手から書き込みが来たらすぐこの iPhone へ直接知らせる。同じ人・同じ番号は6時間に1回だけ送り直す（ntfy の置き場は半日で消えるため）
  function pushReg() {
    const t = window.__BCP_PUSH_TOKEN;
    if (!t || !t.token || !me || !B || !B.chat || !navigator.onLine) return;
    const k = `${me}|${t.token}|${t.env}`, last = store.get("pushReg", {});
    if (last.k === k && Date.now() - (last.at || 0) < 6 * 3600e3) return;
    fetch(B.chat.server + "/", { method: "POST", body: JSON.stringify({ topic: B.chat.topic + "-r", message: JSON.stringify({ who: me, apns: t.token, env: t.env, app: "bcp" }) }) })
      .then((r) => { if (r.ok) store.set("pushReg", { k, at: Date.now() }); }).catch(() => { /* 次に */ });
  }
  window.__bcpPushToken = (t) => { window.__BCP_PUSH_TOKEN = t; pushReg(); };
  function sendReceipt(upTo) {
    if (!me || !B || !B.chat || !navigator.onLine || upTo <= lastReceipt) return;
    lastReceipt = upTo;
    fetch(B.chat.server + "/", { method: "POST", body: JSON.stringify({ topic: B.chat.topic + "-r", message: JSON.stringify({ who: me, upTo }) }) }).catch(() => { lastReceipt = 0; });
  }
  function bubbleText(t) {
    return esc(t).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${/maps\.gsi/.test(u) ? "📍地図で見る" : "リンク"}</a>`).replace(/\n/g, "<br>");
  }
  // ---------- 2人の直近の位置（2026-11-13 遠藤先生「堀部さんとの連絡欄に、直近のお互いのGPS位置（緯度経度）と住所と最寄りの施設を表示」
  // 同日「60分より古い位置には『古い』と出す必要はないので、時刻を表示してください」→ 古さの印は付けず、測った日時をはっきり出す
  // 同日「お互いの直近の位置は地図でだせるといいですね。」→ 欄の上に小さな地図（2人の印＝名前の1文字と日時・誤差の円。2人とも入る範囲に合わせる。
  //   ページの中では指で動かず、押すと画面いっぱいの地図で動かせる。地図は保存した標準地図なので圏外でも出る）。「地図」タブにも「2人の位置」の切り替え
  // 同日「最寄りの施設は不要です。」→ 最寄りの施設・場所マスタの名前は出さない（Mac の positions.py も取らない。古い束に残っていても出さない））
  // 位置は Mac（mac/positions.py）が GPS ログから取り、暗号化した束（B.pos）に入れる。Mac が止まると更新されないので、Mac がまとめた時刻も小さく添える
  let posFocus = null;
  // 2026-11-13 遠藤先生「この画面の位置情報は通常非表示で、位置を表示するボタンを押したら表示される設定で」
  // → 開いたときは隠しておき、「位置を表示する」を押した間だけ地図・住所・緯度経度を出す。ほかのタブへ移る・アプリを裏へ回すと隠し直す（覚えない）
  let posShown = false;
  function posWhen(iso) {
    const d = new Date(iso); if (isNaN(d)) return "";
    const n = new Date(), hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return d.toDateString() === n.toDateString() ? `今日 ${hhmm}` : `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`;
  }
  function posHtml() {
    const P = B && B.pos;
    if (!P || !Array.isArray(P.people) || !P.people.length) return "";
    const rows = P.people.map((p, i) => {
      if (!p.t || typeof p.lat !== "number") return `<div class="pos-p"><div class="pos-h"><b>${esc(p.name)}</b></div><div class="muted">位置の記録が見つかりません</div></div>`;
      const ll = `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`, min = Math.round((Date.now() - new Date(p.t).getTime()) / 60000);
      const ago = min >= 0 && min < 1440 ? `<small class="pos-ago">（${min < 1 ? "1分以内" : fmtDur(min * 60) + "前"}）</small>` : "";
      return `<div class="pos-p" data-pos="${i}"><div class="pos-h"><b>${esc(p.name)}</b> <span class="pos-t">${esc(posWhen(p.t))} の位置</span>${ago}</div>` +
        `<div class="pos-addr">${p.addr ? esc(p.addr) + (p.addr_src === "list" ? ' <small class="muted">（近くの町丁目）</small>' : "") : '<span class="muted">住所を取れませんでした</span>'}</div>` +
        `<div class="pos-ll"><code>${ll}</code>${p.acc != null ? ` <small class="muted">誤差 約${esc(p.acc)}m</small>` : ""}</div>` +
        `<div class="pos-btns"><button data-copyll="${esc(ll)}">緯度経度を写す</button><button data-posmap="${i}">アプリの地図</button>` +
        `<a class="chip" href="https://maps.apple.com/?ll=${p.lat},${p.lon}&q=${encodeURIComponent(p.name + "の位置")}" target="_blank" rel="noopener">iPhoneの地図</a></div></div>`;
    }).join("");
    if (!posShown) return `<div class="card pos-card pos-hidden" id="poscard"><div class="pos-top"><b>2人の直近の位置</b><button id="posshow" class="pos-toggle">📍 位置を表示する</button></div></div>`;
    const map = posPeople().length ? `<div id="posmap" class="posmap" role="img" aria-label="2人の直近の位置の地図（押すと大きな地図）"></div>` : "";
    return `<div class="card pos-card" id="poscard"><div class="pos-top"><b>2人の直近の位置</b><button id="poshide" class="pos-toggle">隠す</button></div><div class="body">${map}${rows}` +
      `<p class="muted pos-note">測った時刻は各人の欄の時刻です。この欄は Mac が ${esc(hm(P.built))} にまとめたもの（約10分ごとに更新${navigator.onLine ? "" : "・圏外のため最後に受け取った分"}）。</p></div></div>`;
  }
  function posShowOnMap(i) {
    const p = B && B.pos && B.pos.people[i]; if (!p || typeof p.lat !== "number") return;
    posFocus = { i, name: p.name };
    posLayerOn(); sosTab = "map"; mapFullOnInit = true; go("sos");
  }
  // 位置のある人だけ（並びは束のまま。色は 遠藤＝紫・堀部＝青緑 のように並びで決める）
  const posPeople = () => ((B && B.pos && Array.isArray(B.pos.people)) ? B.pos.people : []).map((p, i) => Object.assign({}, p, { _i: i }))
    .filter((p) => p.t && typeof p.lat === "number" && typeof p.lon === "number" && isFinite(p.lat) && isFinite(p.lon));
  const POSC = ["#7048e8", "#0c8599"];
  // 印（名前の1文字＋日時）と誤差の円を地図に足す。戻り値は印の一覧（地図の範囲を合わせるのに使う）
  function posMarks(m, layer, withPopup) {
    const out = [];
    posPeople().forEach((p) => {
      const c = POSC[p._i % 2], ll = [p.lat, p.lon];
      if (p.acc > 0 && p.acc <= 3000) L.circle(ll, { radius: p.acc, color: c, weight: 1.5, opacity: 0.8, fillColor: c, fillOpacity: 0.15, interactive: false, className: "pos-acc" }).addTo(layer);
      const mk = L.marker(ll, { icon: L.divIcon({ className: "pos-mark pos-c" + (p._i % 2), html: `<i>${esc(String(p.name || "?").slice(0, 1))}</i><span>${esc(posWhen(p.t))}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
        zIndexOffset: 900, keyboard: false, interactive: !!withPopup, title: `${p.name} ${posWhen(p.t)} の位置` });
      if (withPopup) mk.bindPopup(`<b>${esc(p.name)}</b><br>${esc(posWhen(p.t))} の位置${p.addr ? `<br>${esc(p.addr)}` : ""}${p.acc != null ? `<br><small>誤差 約${esc(p.acc)}m</small>` : ""}`);
      mk.addTo(layer); mk._posI = p._i; out.push(mk);
    });
    return out;
  }
  // 2人とも入る範囲に合わせる（1人だけならその人の周り）
  function posFit(m, marks, maxZoom) {
    if (!marks.length) return;
    if (marks.length === 1) return m.setView(marks[0].getLatLng(), Math.min(maxZoom, 15), { animate: false });
    m.fitBounds(L.latLngBounds(marks.map((x) => x.getLatLng())), { padding: [42, 42], maxZoom, animate: false });
  }
  function posLayerOn() { const l = store.get("poiOn", []); if (!l.includes("pos")) { l.push("pos"); store.set("poiOn", l); } }
  let posMap = null;
  function drawPosMap() {
    const box = $("#posmap");
    if (posMap) { try { posMap.remove(); } catch (e) { /* なし */ } posMap = null; }
    if (!box || !window.L) return;
    posMap = L.map(box, { zoomControl: false, attributionControl: false, rotate: false, rotateControl: false, touchRotate: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false, keyboard: false, tap: false, fadeAnimation: false, zoomAnimation: false, markerZoomAnimation: false }).setView([35.75, 139.3], 11);
    L.tileLayer(TILE.std.url, { maxZoom: 18, maxNativeZoom: TILE.std.max }).addTo(posMap);   // 標準地図＝「地図を保存」で端末に入る地図（圏外でも出る）
    posFit(posMap, posMarks(posMap, posMap, false), 16);
    const note = document.createElement("div"); note.className = "nowmap-note"; note.textContent = "押すと大きな地図（指で動かせます）";
    box.appendChild(note);
    box.onclick = () => { posFocus = { all: true }; posLayerOn(); sosTab = "map"; mapFullOnInit = true; go("sos"); };
  }
  function renderChat() {
    const el = $("#v-chat");
    if (!B || !B.chat) { el.innerHTML = `<div class="empty">合言葉を入れると使えます。</div>`; return; }
    const list = timeline();
    const lastT = Math.max(0, ...store.get("msgs", []).map((m) => m.time));
    if (view === "chat" && list.length) { store.set("seenMsg", list[list.length - 1].t); if (document.visibilityState === "visible" && lastT) sendReceipt(lastT); }
    const box = outbox();
    const others = peopleTel().filter((p) => p.name !== me);
    const smsSep = isIOS ? "&" : "?";
    const keep = $("#msg") ? $("#msg").value : "";
    let h = `<details class="card quick" ${list.length ? "" : "open"}><summary><b>すぐ送る（無事・集合など）</b></summary>
      <div class="row"><button class="big ok" data-safe="無事です">無事です</button><button class="big ng" data-safe="けががあります">けがあり</button></div>
      <div class="row"><button class="big ng" data-safe="助けが必要です">助けが必要</button><button class="big" data-safe="事務所に向かいます">事務所へ向かう</button></div>
      <div class="row"><button class="big" data-safe="自宅で待機します">自宅で待機</button><button class="big" data-safe="避難所にいます">避難所にいる</button></div>
      <div class="row"><button class="big" data-safe="ことぶきハウスで集合しましょう">ことぶきハウスで集合</button><button class="big" data-safe="青梅の団地に集合しましょう">青梅の団地に集合</button></div></details>`;
    h += posHtml();
    h += `<div class="talk" id="talk">` + (list.length ? list.map((m) => {
      const mine = me && m.from === me, auto = m.from === "自動";
      const tm = `<div class="tm">${esc(hm(new Date(m.t * 1000).toISOString()))}</div>`;
      if (m.deleted) return `<div class="b ${mine ? "me" : "you"} gone">${!mine ? `<div class="who">${esc(m.from || "")}</div>` : ""}<div class="bub del">${mine ? "あなたが" : ""}メッセージの送信を取り消しました</div>${tm}</div>`;
      const img = m.thumb ? `<img class="thumb" src="${esc(m.thumb)}" data-img="${esc(m.imageId || "")}" alt="写真">` : (m.imageId ? `<button class="mini" data-img="${esc(m.imageId)}">📷 写真を見る</button>` : "");
      const un = mine && m.cid ? `<button class="unsend" data-unsend="${esc(m.cid)}">↩ 送信を取り消す</button>` : "";
      return `<div class="b ${mine ? "me" : auto ? "auto" : "you"}${un ? " can-unsend" : ""}">${!mine && !auto ? `<div class="who">${esc(m.from || "")}</div>` : ""}<div class="bub">${img}${m.text ? `<div>${bubbleText(m.text)}</div>` : ""}</div>${un}${tm}</div>`;
    }).join("") : `<div class="empty">まだやりとりはありません。</div>`) +
      box.map((m) => `<div class="b me pending can-unsend"><div class="bub">${m.thumb ? `<img class="thumb" src="${esc(m.thumb)}" alt="写真">` : ""}<div>${bubbleText(m.text)}</div></div><button class="unsend" data-unsend="${esc(m.cid)}">↩ 取り消す</button><div class="tm">送信待ち</div></div>`).join("") + `</div>`;
    h += `<div class="inputbar"><label class="photo">📷<input type="file" accept="image/*" id="photo" hidden></label><textarea id="msg" rows="1" placeholder="メッセージ"></textarea><button class="primary" id="sendmsg">送る</button></div>
      <label class="muted" style="margin:4px 0"><input type="checkbox" id="withloc" style="display:inline;width:auto" ${store.get("withloc", true) ? "checked" : ""}> 位置を付ける（GPS。圏外でも測れることがある）</label>
      <p class="muted">${me ? `あなた：<b>${esc(me)}</b>。` : `<a href="#" data-go="set">使う人を選ぶ</a>。`}LINE と別の仕組みです（会話はスプレッドシート、知らせは ntfy）。相手がアプリで見るまで、相手のスマホに知らせが繰り返し届きます。自分のメッセージを押すと「送信を取り消す」が出ます。</p>`;
    h += `<details class="card"><summary><b>ほかの連絡の手段</b></summary>`;
    h += others.map((p) => p.tel ? `<div style="margin:6px 0"><b>${esc(p.name)}</b><div class="row" style="margin-top:6px"><a class="chip" style="text-align:center;text-decoration:none" href="tel:${esc(p.tel)}">電話</a><a class="chip" style="text-align:center;text-decoration:none" href="sms:${esc(p.tel)}${smsSep}body=${encodeURIComponent(`【${me || ""}】無事です。`)}">SMS</a></div></div>` : `<p class="muted">${esc(p.name)}の電話番号が未登録です（<a href="#" data-go="set">設定</a>で入れると SMS・電話のボタンが出ます）。</p>`).join("");
    h += C.channels.map((c) => `<p><b>${esc(c.name)}</b>：${esc(c.how)}</p>`).join("");
    h += `<p class="muted">ntfy アプリでも受け取るには、ntfy アプリで「購読」→ サーバー ntfy.sh・トピック名：<br><code style="user-select:all">${esc(B.chat.topic)}</code> <button id="copytopic" style="min-height:36px;padding:4px 10px">写す</button></p></details>`;
    el.innerHTML = h;
    setTimeout(drawPosMap, 0);
    if (keep) $("#msg").value = keep;
    const talk = $("#talk"); if (talk) talk.scrollTop = talk.scrollHeight;
  }

  // ---------- 緊急 ----------
  function renderSos() {
    const el = $("#v-sos");
    const subs = [["map", "地図"], ["tel", "連絡先"], ["aid", "応急手当"], ["water", "水"], ["steps", "初動"], ["prep", "備え・点検"], ["meds", "薬・医療"]];
    let h = `<button id="sosbtn" class="sosbtn">🆘 SOS（光と音で知らせる）</button><div class="subtabs">${subs.map(([k, n]) => `<button data-sub="${k}" class="${k === sosTab ? "on" : ""}">${n}</button>`).join("")}</div><div id="sosbody"></div>`;
    if (map) { navStop(true); stopFollow(); try { map.stop(); map.remove(); } catch (e) { /* 動きの途中でも片付ける */ } map = null; routeLayer = null; }   // 描き直す前に前の地図を必ず片付ける
    el.innerHTML = h;
    const body = $("#sosbody");
    if (sosTab === "tel") body.innerHTML = telView();
    else if (sosTab === "aid") {
      // 慌てていても見て分かるよう、手順ごとの絵を大きく（2026-11-11 先生「緊急時に文字はほとんど読めない」）。文字の手順は畳んでおく
      const F = window.BCP_AID_FIGURES || {};
      body.innerHTML = `<a class="call119" href="tel:119">📞 119 に電話</a>` +
        C.firstAid.map((a, n) => `<details class="aid ${a.urgent ? "urgent" : ""}" ${n === 0 ? "open" : ""}><summary>${esc(a.title)}</summary><div class="body">` +
          ((F[a.id] || []).length ? `<div class="aidgrid">${F[a.id].map((f, i) => `<figure class="aidfig">${f.src ? `<img src="${esc(f.src)}" alt="${esc(f.label)}" width="640" height="480" loading="lazy" decoding="async">` : (f.svg || "")}<figcaption><b>${i + 1}</b> ${esc(f.label)}</figcaption></figure>`).join("")}</div>` : "") +
          `<details class="aidtext"><summary>文字で読む</summary><ol class="steps">${a.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>${a.note ? `<p class="muted">${esc(a.note)}</p>` : ""}</details></div></details>`).join("") +
        `<p class="muted">迷ったら 119（救急相談は #7119）。救急蘇生法の指針2025（市民用）などで確かめた内容です。</p>`;
    }
    else if (sosTab === "steps") body.innerHTML = `<h2>大きな地震・災害のとき</h2>` + C.firstSteps.map((s) => `<div class="card"><h3>${esc(s.when)}</h3><ol class="steps">${s.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></div>`).join("") +
      (B && B.rules && B.rules.length ? `<h2>事務所の決めごと</h2><div class="card"><ul class="act">${B.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></div>` : "");
    else if (sosTab === "prep") body.innerHTML = prepView();
    else if (sosTab === "water") body.innerHTML = waterView();
    else if (sosTab === "meds") body.innerHTML = medsView();
    else if (sosTab === "map") { body.innerHTML = mapShell(); setTimeout(initMap, 30); }
  }
  function telView() {
    const groups = {};
    const people = peopleTel().filter((p) => p.tel).map((p) => ({ group: "事務所の二人", name: p.name, tel: p.tel }));
    const extra = store.get("mycontacts", []).map((c) => ({ group: "自分で足した連絡先", name: c.name, tel: c.tel, note: c.note }));
    [...people, ...((B && B.contacts) || []), ...extra].forEach((c) => (groups[c.group] = groups[c.group] || []).push(c));
    if (!B) groups["緊急"] = [{ name: "消防・救急", tel: "119" }, { name: "警察", tel: "110" }, { name: "救急相談センター", tel: "#7119" }, { name: "災害用伝言ダイヤル", tel: "171", note: "録音 171→1→番号／再生 171→2→番号" }];
    let h = Object.entries(groups).map(([g, rows]) => `<h2>${esc(g)}</h2><div class="card">${rows.map((c) => `<div class="tel"><div><b>${esc(c.name)}</b><div class="muted">${esc(c.tel)} ${esc(c.note || "")} ${c.url ? link(c.url, "ページ") : ""}</div></div><a class="call" href="tel:${esc(String(c.tel).replace(/[^0-9#*+]/g, ""))}">発信</a></div>`).join("")}</div>`).join("");
    if (B && B.links) h += `<h2>伝言板・防災ページ</h2><div class="card">${B.links.map((l) => `<p>${link(l.url, l.name)}</p>`).join("")}</div>`;
    h += `<h2>連絡先を足す（このスマホだけ）</h2><div class="card"><label>名前<input id="cname"></label><label>電話<input id="ctel" inputmode="tel"></label><label>メモ<input id="cnote"></label><button class="primary" id="addcontact">足す</button></div>`;
    return h;
  }
  function waterView() {
    const notes = (B && B.water_note) || ["断水したら、給水所や避難所で給水。容器を持参。1人1日3Lが目安。", "川・沢・井戸の水はそのまま飲まない（煮沸等）。"];
    const row = (p) => `<div class="tel"><div><b>${esc(p.name)}</b><div class="muted">${esc(p.addr || "")} ${esc(p.note || "")}</div></div>${p.lat ? `<a class="call" href="https://maps.gsi.go.jp/#16/${p.lat}/${p.lon}/" target="_blank" rel="noopener">地図</a>` : ""}</div>`;
    let h = `<h2>断水したとき</h2><div class="card"><ul class="act">${notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
    const w = (B && B.water) || [];
    if (w.length) h += `<h2>給水ステーション（近い所）</h2><div class="card">${w.map(row).join("")}</div><p class="muted">地図では水色の点。出典：東京都水道局（令和7年11月1日現在）・青梅市・檜原村地域防災計画。</p>`;
    const sp = (B && B.springs) || [];
    if (sp.length) h += `<h2>湧水（近い所）</h2><div class="card">${sp.map(row).join("")}</div><p class="muted">地図では紫の点。${esc((B && B.springs_source) || "")}</p>`;
    const rv = (B && B.rivers) || [];
    if (rv.length) h += `<h2>近くの川</h2><div class="card">${rv.map(row).join("")}</div>`;
    const nn = (B && B.natural_water_note) || [];
    if (nn.length) h += `<h2>川・湧水・沢の水を使うとき</h2><div class="card"><ul class="act">${nn.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
    const lv = (B && B.river_level_links) || [];
    if (lv.length) h += `<h2>川の水位（通信があるとき）</h2><div class="card">${lv.map((l) => `<p>${link(l.url, l.name)}${l.note ? ` <span class="muted">${esc(l.note)}</span>` : ""}</p>`).join("")}</div>`;
    return h;
  }
  // ---------- 防災グッズの点検（場所ごと） ----------
  // 端末の日付（日本時間）。toISOString は UTC の日付になり、0時〜9時は前日になる（2026-11-12 直した：薬の残り日数が1日少なく出ていた）
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const daysTo = (d) => Math.floor((new Date(d + "T00:00:00").getTime() - new Date(today() + "T00:00:00").getTime()) / 864e5);
  function kitKey(k) { return k.perPerson ? `${k.id}:${me || "未設定"}` : k.id; }
  function kitName(k) { return k.perPerson && me ? `${k.name}（${me}）` : k.name; }
  function kitState(k) { const all = store.get("kits", {}); return all[kitKey(k)] || { items: {}, checkedAt: "" }; }
  function saveKitState(k, st) { const all = store.get("kits", {}); all[kitKey(k)] = st; store.set("kits", all); }
  function kitSummary(k) {
    const st = kitState(k);
    const r = { total: k.items.length, have: 0, missing: [], expired: [], soon: [], checkedAt: st.checkedAt };
    k.items.forEach((it) => {
      const v = st.items[it.id] || {};
      if (v.have) r.have++; else r.missing.push(it.name);
      if (v.have && it.exp && v.exp) { const d = daysTo(v.exp); if (d < 0) r.expired.push(it.name); else if (d <= 30) r.soon.push(`${it.name}（${v.exp}）`); }
    });
    r.overdue = !st.checkedAt || daysTo(st.checkedAt) < -90;
    return r;
  }
  function mineKits() { return C.kits.filter((k) => !k.owner || !me || k.owner === me); }
  function prepView() {
    let h = `<p class="muted">場所ごとに、ある物に印を付け、期限のある物は期限を入れます。終わったら「点検を終える」で相手にも結果が届きます（中身はこのスマホに残ります）。3か月に1回の点検がおすすめ（毎月1日・15日は171の体験日）。</p>`;
    h += `<div class="grid">${C.kits.map((k) => { const r = kitSummary(k); return `<a class="stat" href="#kit-${k.id}" style="text-decoration:none;color:inherit"><div class="k">${esc(kitName(k))}</div><b>${r.have}/${r.total}</b> そろい${r.expired.length ? ` <span class="med-low">期限切れ${r.expired.length}</span>` : ""}${r.soon.length ? ` <span style="color:var(--warn)">間近${r.soon.length}</span>` : ""}<div class="muted">${r.checkedAt ? "点検 " + esc(r.checkedAt) : "未点検"}</div></a>`; }).join("")}</div>`;
    h += C.kits.map((k) => {
      const st = kitState(k), r = kitSummary(k);
      const open = sosKit === k.id;
      return `<details id="kit-${k.id}" ${open ? "open" : ""} data-kit="${k.id}"><summary>${esc(kitName(k))}　${r.have}/${r.total}</summary><div class="body">${k.note ? `<p class="muted">${esc(k.note)}</p>` : ""}` +
        k.items.map((it) => {
          const v = st.items[it.id] || {};
          const d = it.exp && v.exp ? daysTo(v.exp) : null;
          const flag = d == null ? "" : d < 0 ? `<span class="med-low">期限切れ</span>` : d <= 30 ? `<span style="color:var(--warn);font-weight:700">あと${d}日</span>` : "";
          return `<div class="check"><input type="checkbox" data-kititem="${k.id}|${it.id}" ${v.have ? "checked" : ""}><div style="flex:1"><span>${esc(it.name)}</span>${it.qty ? ` <span class="muted">${esc(it.qty)}</span>` : ""} ${flag}${it.exp ? `<label class="kexp">期限<input type="date" data-kitexp="${k.id}|${it.id}" value="${esc(v.exp || "")}"></label>` : ""}</div></div>`;
        }).join("") +
        `<button class="primary" data-kitdone="${k.id}" style="margin-top:10px">点検を終える（結果を相手に送る）</button>${k.src ? `<p class="muted">出典：${esc(k.src)}</p>` : ""}</div></details>`;
    }).join("");
    const others = ((B && B.inspections) || []).filter((x) => x.person !== me);
    if (others.length) h += `<h2>相手の点検結果</h2><div class="card">${others.map((x) => `<p><b>${esc(x.person)}・${esc(x.kit)}</b> ${x.have}/${x.total}（${esc(String(x.at).slice(0, 10))}）${x.missing && x.missing.length ? `<br><span class="muted">足りない：${esc(x.missing.join("、"))}</span>` : ""}${x.expired && x.expired.length ? `<br><span class="med-low">期限切れ：${esc(x.expired.join("、"))}</span>` : ""}</p>`).join("")}</div>`;
    return h;
  }
  function kitAlerts() {
    const out = [];
    C.kits.forEach((k) => {
      if (k.owner && me && k.owner !== me) return;
      const r = kitSummary(k);
      if (r.expired.length) out.push(`${kitName(k)}：期限切れ ${r.expired.join("、")}`);
      if (r.soon.length) out.push(`${kitName(k)}：期限が近い ${r.soon.join("、")}`);
      if (r.overdue) out.push(`${kitName(k)}：${r.checkedAt ? "点検から3か月たちました" : "まだ点検していません"}`);
    });
    return out;
  }

  // ---------- 薬（端末の中だけ） ----------
  function medStatus() {
    const th = store.get("medDays", 14);
    return store.get("meds", []).map((m) => {
      const days0 = (Date.now() - new Date(m.date + "T00:00:00").getTime()) / 864e5;
      const left = Math.max(0, m.count - m.perDay * Math.max(0, Math.floor(days0)));
      const days = m.perDay > 0 ? Math.floor(left / m.perDay) : 999;
      return Object.assign({}, m, { left, days, low: days <= th });
    });
  }
  function medsView() {
    const list = medStatus();
    const card = store.get("medcard", {});
    const th = store.get("medDays", 14);
    let h = `<p class="muted">薬と医療の情報は、このスマホの中だけに置きます（事務所にも共有されません）。災害や感染症の流行の兆しがあるときは、早めに処方を受け取りましょう。</p>`;
    h += `<h2>薬の残り</h2>` + (list.length ? list.map((m, i) => `<div class="card"><b>${esc(m.name)}</b> <span class="${m.low ? "med-low" : ""}">あと約${m.days}日（${m.left}錠など）</span><div class="muted">1日 ${m.perDay}・${esc(m.date)} に ${m.count} 数えた ${esc(m.note || "")}</div><div class="row" style="margin-top:8px"><button data-medcount="${i}">数え直す</button><button data-meddel="${i}">消す</button></div></div>`).join("") : `<p class="muted">まだありません。</p>`);
    h += `<div class="card"><h3>薬を足す</h3><label>薬の名前<input id="mname"></label><div class="row"><label>1日の数<input id="mper" type="number" inputmode="decimal" step="0.5" min="0" value="1"></label><label>いまの残り<input id="mcount" type="number" inputmode="numeric" min="0"></label></div><label>メモ（薬局・処方の病院など）<input id="mnote"></label><button class="primary" id="addmed">足す</button></div>`;
    h += `<label>何日を切ったら知らせるか<input id="medth" type="number" min="1" value="${th}"></label>`;
    h += `<h2>医療の情報（救急のときに見せる）</h2><div class="card">${[["blood", "血液型"], ["allergy", "アレルギー"], ["disease", "持病"], ["doctor", "かかりつけ（病院・電話）"], ["family", "家族の連絡先"], ["other", "そのほか"]].map(([k, n]) => `<label>${n}<input data-medcard="${k}" value="${esc(card[k] || "")}"></label>`).join("")}</div>`;
    return h;
  }

  // ボタンの下の「保存済み」の文（実数があれば「○/○枚」、取れなかった分があれば「不足○枚」）
  function tileSavedLabel(v) {
    if (!v) return "未保存";
    if (v.of) return `${v.failed ? "一部保存" : "保存済み"} ${hm(v.at)}・${v.n}/${v.of}枚${v.failed ? `・不足${v.failed}枚` : ""}`;
    return `保存済み ${hm(v.at)}`;
  }

  // ---------- 地図 ----------
  function mapShell() {
    const sv = store.get("tilesSaved2", {});
    const st = (k) => (sv[k] ? esc(tileSavedLabel(sv[k])) : "未保存");
    const on = store.get("poiOn", []);
    const rb = routeBox().split('<div class="card" id="routebox2">');   // 上＝行き先の検索、下＝保存したルート・登録した場所
    return `${rb[0]}<div id="map"></div>
      <p class="muted" style="margin:6px 0 0">地図に出すもの（押すと出る・もう一度押すと消える。広げた地図の「表示するもの」と同じ）</p>
      <div class="poibar">${showList().map(([k, ic, n, pk]) => `<button data-poi="${k}" class="${on.includes(k) ? "on" : ""}">${showIcon(ic, pk)}<small>${esc(n)}</small></button>`).join("")}</div>
      ${OPENONLY_BTN}
      <p class="muted" id="poinote" style="margin:2px 0"></p>
      <div class="row"><button id="here">現在地</button><button id="follow">追いかける</button></div>
      <div class="row" style="margin-top:6px"><button id="savetiles">地図を保存<br><small class="muted">範囲の全体（${st("base")}）</small></button><button id="savetiles2">詳しい地図<br><small class="muted">東京都＋隣接（${st("detail")}）</small></button><button id="savetiles3">詳しい地図<br><small class="muted">その外側（${st("detail2")}）</small></button></div>
      <button id="tilestop" style="display:none;width:100%;margin-top:6px">保存を止める</button>
      <div class="bar" id="tbar" style="display:none;margin-top:8px"><i></i></div><p class="muted" id="tmsg">保存した地図は圏外でも見られます。範囲は東京都（島しょを除く）と、隣接の市町村、その隣接の市町村（埼玉・神奈川・山梨・千葉・群馬・長野）。「地図を保存」は範囲の全体の町名と主な道路まで（約1.5万枚・約0.6GB）。細い道までの「詳しい地図」は、東京都＋隣接と、その外側に分けて保存できます（それぞれ約1万枚・約0.5GB。Wi‑Fi で）。事務所・自宅付近・ことぶき事務所の周りと、保存したルートの沿線は一番細かく保存します。</p>
      <p class="muted">地図は押すと画面いっぱいに広がり、指で動かす・拡大縮小・長押しで場所の登録ができます（ページの中の地図は、指でなぞるとページが流れます）。最初は事務所など・事務所の近くの避難所（確認済み）・登録した場所・通行止めだけを出します。避難所・避難場所（国土地理院）・給水・湧水・ガソリンスタンド・ホームセンター（DIY）などの施設は、上のボタンか、広げた地図の「表示するもの」で選んだときだけ出します（選んだものはこのスマホが覚えます）。地図の印：事（青）＝事務所など　避（緑・金の縁）＝事務所の近くの避難所（確認済み）　所（緑）＝指定避難所　場（黄緑の四角）＝指定緊急避難場所　数字＝避難所・避難場所のまとまり　給（水色）＝給水　湧（紫）＝湧水　★（橙）＝登録した場所（地図の左下の「印の見方」を押すと、今出している印の見方が開きます）。右上の重ねボタンで、地図の種類・洪水・土砂災害の区域などを重ねられます。</p>
      ${shelterBox()}
      <div id="roadinfo">${roadInfoHtml()}</div>${rb[1] ? '<div class="card" id="routebox2">' + rb[1] : ""}`;   // 行き先の検索（ルート）は地図の上へ
  }

  // ---------- ルート（徒歩・車・電車） ----------
  // 徒歩・車は OpenStreetMap の経路検索（FOSSGIS の routing.openstreetmap.de）で出し、線と曲がる所をこのスマホに保存（圏外でも出せる）。
  // 電車は時刻と乗り換えが要るので、通信のあるときに iPhone の「マップ」で開く。音声の道案内も「マップで案内」から
  let routeLayer = null, followOn = false, followMark = null, rmode = store.get("rmode", "foot");
  const RMODE = { foot: "徒歩", car: "車", train: "電車" };
  // 車のルートの選び方（2026-11-12 遠藤先生「有料道路を使わないパターンと使うパターン、災害時に通行止めになる道を回避するパターンを選べるように」）
  // toll＝今までどおり（OSRM。有料道路も使う）／free・safe＝FOSSGIS の Valhalla（有料道路を避ける指定と、避けたい道の除外ができる）
  const ROPT = {
    toll: ["有料道路を使う", "いちばん早い道。高速道路など有料の道も使う", "有料道路も使う"],
    free: ["有料道路を使わない", "高速道路・有料道路を通らない", "有料道路なし"],
    safe: ["災害時に通行止めになる道を避ける", "大地震のとき一般の車が通れなくなる道（警視庁の第一次交通規制の7路線：国道4・17・20・246号、目白通り・新目白通り・外堀通り、高速道路・首都高）と、今の通行止めを避ける。高速・首都高を通らないので有料道路も使わない", "災害時の規制路を避ける"],
  };
  let ropt = ROPT[store.get("ropt", "toll")] ? store.get("ropt", "toll") : "toll";
  const modeName = (r) => (r.mode === "car" && r.opt && ROPT[r.opt] ? `車（${ROPT[r.opt][2]}）` : RMODE[r.mode]);
  function dests() {
    const a = ((B && B.places) || []).map((p) => ({ id: "p:" + p.name, name: p.name, lat: p.lat, lon: p.lon }));
    const sd = store.get("searchDest", null);   // 検索で指定した行き先（登録しなければ1つだけ残る）
    return a.concat(store.get("dests", []), sd ? [sd] : []);
  }
  // 行き先を文字で指定（2026-11-11 遠藤先生「選択ではなく指定できるように」）
  // 住所・地名は国土地理院の住所検索、施設・駅・お店の名前は Photon（OpenStreetMap）。東京都と隣接・その隣接の市町村を優先
  let searchHits = [];
  // 緊急時に要る施設（2026-11-11 先生）：種類 → [絵, 名前]
  const POI = { konbini: ["🏪", "コンビニ"], drug: ["💊", "ドラッグストア・薬局"], fuel: ["⛽", "ガソリンスタンド"], super: ["🛒", "スーパー"],
    hospital: ["🏥", "病院・診療所"], toilet: ["🚻", "公衆トイレ"], cityhall: ["🏛", "役所"], police: ["👮", "警察"], fire: ["🚒", "消防"],
    diy: ["🔨", "ホームセンター（DIY）"] };   // 2026-11-12 遠藤先生「地図に DIY も入れてください。カインズとか」（poi_extra.json）
  // 地図に出すもの（2026-11-12 遠藤先生「見にくい。拡大表示したときに、ガソリンスタンドなどを選択表示できるように」）
  // 最初は事務所など・確認済みの避難所・登録した場所・通行止めだけ。ここに並ぶものは選んだときだけ出す（災害時に役立つ順。store の poiOn に覚える）
  const SHOW = [["shel", "所", "避難所", "sh"], ["wt", "給", "給水", "wt"], ["hospital", "🏥", "病院"], ["fuel", "⛽", "ガソリン"], ["drug", "💊", "薬局"], ["diy", "🔨", "DIY"], ["toilet", "🚻", "トイレ"],
    ["konbini", "🏪", "コンビニ"], ["super", "🛒", "スーパー"], ["cityhall", "🏛", "役所"], ["police", "👮", "警察"], ["fire", "🚒", "消防"], ["sp", "湧", "湧水", "sp"]];
  // 2026-11-13 遠藤先生「避難所は消せないんですか？」→ 確認済みの避難所（避）も「表示するもの」で出し入れできる（最初は出す・端末に覚える）
  const showList = () => (((B && B.shelters) || []).length ? [["sv", "避", "確認済みの避難所", "sv"]] : []).concat(posPeople().length ? [["pos", "👥", "2人の位置"]] : []).concat(SHOW);
  try { if (!store.get("svInit", false)) { const l = store.get("poiOn", []); if (!l.includes("sv")) l.push("sv"); store.set("poiOn", l); store.set("svInit", true); } } catch (e) { /* 端末に保存できない */ }   // 2026-11-13 遠藤先生「お互いの直近の位置は地図でだせるといいですね。」
  const showIcon = (ic, pk) => (pk ? `<i class="shico ${pk}" style="background:${PIN[pk][0]}">${ic}</i>` : ic);
  const showOn = (k) => store.get("poiOn", []).includes(k);
  const OPENONLY_BTN = `<button type="button" data-openonly="1" class="openonly">🕘 営業中だけ表示</button>`;
  const OPENONLY_NOTE = "施設は地図を近づけると出ます。営業時間は OpenStreetMap の登録で、災害時や臨時の休みは反映されません（行く前に電話で）。「営業中だけ表示」は時間外の店を隠します。営業時間が分からない店は「?」を付けて出したまま、警察・消防はいつも出します。時間外の印は淡く出ます";
  let wtLayer = null, spLayer = null, posLayer = null, svLayer = null, legendBox = null;
  function toggleShow(k) {
    const l = store.get("poiOn", []); const i = l.indexOf(k);
    if (i < 0) l.push(k); else l.splice(i, 1);
    store.set("poiOn", l);
    applyShow();
  }
  // 選んだ状態を地図・ボタン・凡例にそろえる
  function applyShow() {
    const on = store.get("poiOn", []);
    document.querySelectorAll("[data-poi]").forEach((b) => b.classList.toggle("on", on.includes(b.dataset.poi)));
    document.querySelectorAll("[data-openonly]").forEach((b) => b.classList.toggle("on", !!store.get("openOnly", false)));
    const n = on.filter((k) => k !== "sv" && showList().some((x) => x[0] === k)).length;   // 数は足して出したものだけ（最初から出ている確認済みの避難所は数えない）
    document.querySelectorAll(".mapsel-open").forEach((b) => { b.textContent = `🗂 表示するもの${n ? `（${n}）` : ""}`; });
    if (map) {
      [[svLayer, "sv"], [shelLayer, "shel"], [wtLayer, "wt"], [spLayer, "sp"], [posLayer, "pos"]].forEach(([lg, k]) => { if (!lg) return; if (on.includes(k) && !map.hasLayer(lg)) lg.addTo(map); if (!on.includes(k) && map.hasLayer(lg)) map.removeLayer(lg); });
      drawShelters(); drawPois();
    }
    fillLegend();
  }
  // 凡例：今出している印の種類だけ（既定は畳んで「印の見方」だけ）
  function fillLegend() {
    if (!legendBox) return;
    const on = store.get("poiOn", []);
    const ks = [];
    if (((B && B.places) || []).length) ks.push("pl");
    if (((B && B.shelters) || []).length && on.includes("sv")) ks.push("sv");
    if (on.includes("shel")) ks.push("sh", "se", "cl");
    if (on.includes("wt")) ks.push("wt");
    if (on.includes("sp")) ks.push("sp");
    if (store.get("dests", []).length) ks.push("my");
    const LEG = { sv: "確認済みの避難所", sh: "指定避難所", se: "緊急避難場所", cl: "まとまり（数）" };
    const pp = on.includes("pos") ? posPeople() : [];
    legendBox.innerHTML = `<b>印の見方</b>` + ks.map((k) => `<span class="li"><i class="${PIN[k][3] || ""}" style="background:${PIN[k][0]}">${PIN[k][1]}</i>${LEG[k] || PIN[k][2]}</span>`).join("") +
      pp.map((p) => `<span class="li pos-li"><i style="background:${POSC[p._i % 2]}">${esc(String(p.name).slice(0, 1))}</i>${esc(p.name)}（${esc(posWhen(p.t))}）</span>`).join("") +
      (pp.some((p) => p.acc > 0) ? `<span class="li pos-li"><i class="pos-acc-ic"></i>円＝位置の誤差</span>` : "") +
      on.filter((k) => POI[k]).map((k) => `<span class="li"><i class="poiic">${POI[k][0]}</i>${esc(POI[k][1])}</span>`).join("") +
      (roadLayer && map && map.hasLayer(roadLayer) && roadsD() ? `<span class="li"><i class="rdic rd-block">止</i>通行止め（赤の線）</span><span class="li"><i class="rdic rd-caution">規</i>車線規制・<b>交</b>＝片側交互通行（橙の点線）</span>` +
        (jamState().use && ((jamD() || {}).items || []).length ? `<span class="li"><i class="rdic rd-jam">渋</i>渋滞の先頭（赤紫の太線が渋滞）</span>` : "") : "") +
      (on.some((k) => POI[k]) ? `<span class="li"><i class="poiic oh-open-mark">●</i>緑の縁＝営業中</span><span class="li"><i class="poiic" style="opacity:.45">🏪</i>淡い＝時間外</span><span class="li"><i class="poiic">?</i>営業時間不明</span>` : "");
  }
  let poiLayer = null;
  async function drawPois() {
    if (!map) return;
    const on = store.get("poiOn", []).filter((k) => POI[k]);
    const note = $("#poinote");
    if (!poiLayer) poiLayer = L.layerGroup().addTo(map);
    if (popOpen(poiLayer)) return;   // 説明を開いている間は描き直さない（説明が地図を動かすと消えてしまうため）
    poiLayer.clearLayers();
    if (!on.length) { if (note) note.textContent = ""; return; }
    if (map.getZoom() < 14) { if (note) note.textContent = "地図を近づけると、選んだ施設が出ます。"; return; }
    const list = await loadPlaces();
    const HR = await loadHours();
    if (!map || !poiLayer) return;
    const b = map.getBounds(), now = new Date(), openOnly = store.get("openOnly", false);
    const cnt = { open: 0, closed: 0, unknown: 0, hid: 0 };
    const hits = [];
    for (const p of list) {
      if (!on.includes(p[3]) || !b.contains([p[1], p[2]])) continue;
      const st = poiStatus(p, HR, now);
      if (openOnly && st.s === "closed") { cnt.hid++; continue; }
      cnt[st.s === "closed" ? "closed" : st.s === "unknown" ? "unknown" : st.s === "na" ? "unknown" : "open"]++;
      hits.push([p, st]);
      if (hits.length >= 400) break;
    }
    hits.forEach(([p, st]) => { const ps = p[3] === "police" ? policeKind(p[0]) : null, sz = ps ? ps[2] : 26;
      L.marker([p[1], p[2]], { icon: L.divIcon({ className: "poi oh-" + st.s + (ps ? " " + ps[1] : ""), html: POI[p[3]][0], iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2] }), zIndexOffset: st.s === "closed" ? -100 : ps && ps[1] === "pol-hq" ? 50 : 0 })
      .bindPopup(() => `<b>${esc(p[0])}</b><br>${esc(ps ? ps[0] : POI[p[3]][1])}<br>${hoursHtml(p, HR)}<br><button class="mini" onclick="window.__bcpRouteTo(${p[1]},${p[2]},${esc(JSON.stringify(p[0]))})">ここへのルート</button>`).addTo(poiLayer); });
    if (note) note.textContent = hits.length >= 400 ? "多いので400件まで出しています。もっと近づくと全部出ます。"
      : `${hits.length}件（営業中・24時間 ${cnt.open}・時間外 ${cnt.closed}${cnt.hid ? `（${cnt.hid}件は隠しています）` : ""}・時間不明 ${cnt.unknown}）。OpenStreetMap のデータで、災害時や臨時の休みは反映されません`;
  }
  // ---------- 営業時間（2026-11-12 遠藤先生「マップはそれぞれ営業時間も反映させてほしい。営業してるものだけを表示するかどうか」） ----------
  // poi_hours.json（Mac の build_place_index.py。OpenStreetMap の opening_hours）を、施設の名前・緯度・経度で結び付けて、hours.js で日本時間の今に読む。
  // 警察・消防は営業時間の対象外（いつも出す）。営業時間が分からない施設は「?」を付けて出したまま（隠すと近くの店がほとんど消えるため）
  const HOURS_NA = { police: 1, fire: 1 };
  // 警察の種類（2026-11-12 遠藤先生「警察については交番や駐在所も含めてくださいね」）：名前から 警察署／交番／駐在所 を見分ける。署は大きめ、交番・駐在所は小さめの印
  function policeKind(name) {
    const n = String(name || "");
    if (/駐在/.test(n)) return ["駐在所（警察）", "pol-small", 22];
    if (/交番|派出所|ポリスボックス|\bPB\b|koban/i.test(n)) return ["交番（警察）", "pol-small", 22];
    if (/警察署|警察本部|分庁舎/.test(n)) return ["警察署", "pol-hq", 32];
    return ["警察の施設（地域安全センター・本部など）", "pol-small", 22];
  }
  let HOURS = null, hoursLoading = null;
  function loadHours() {
    if (HOURS) return Promise.resolve(HOURS);
    if (!hoursLoading) hoursLoading = fetch("poi_hours.json").then((r) => r.json()).then((d) => { const m = new Map(); (d.a || []).forEach((x) => m.set(`${x[0]},${x[1]}|${x[2]}`, x[3])); HOURS = m; return m; })
      .catch(() => new Map()).finally(() => { hoursLoading = null; });
    return hoursLoading;
  }
  const ohOf = (p, HR) => (HR && HR.get(`${p[1]},${p[2]}|${p[0]}`)) || "";
  function poiStatus(p, HR, now) {
    if (HOURS_NA[p[3]]) return { s: "na" };
    const oh = ohOf(p, HR);
    if (!oh || !window.BCP_OH) return { s: "unknown" };
    return window.BCP_OH.status(oh, now);
  }
  function hoursHtml(p, HR) {
    if (HOURS_NA[p[3]]) return `<small class="muted">営業時間の対象外（交番・駐在所は不在のことがあります）</small>`;
    const oh = ohOf(p, HR), st = poiStatus(p, HR, new Date());
    const line = st.s === "open" ? `<span class="ohs open">● 営業中（${esc(st.until)}まで）</span>` : st.s === "24h" ? `<span class="ohs open">● 24時間営業</span>`
      : st.s === "closed" ? `<span class="ohs closed">● 時間外${st.next ? `（次は ${esc(st.next)}から）` : ""}</span>` : `<span class="ohs unk">営業時間は分かりません</span>`;
    return line + (oh ? `<br><small>営業時間：${esc(window.BCP_OH ? window.BCP_OH.toJa(oh) : oh)}</small>` : "") +
      `<br><small class="muted">営業時間は OpenStreetMap の登録です。災害時や臨時の休みは反映されません。行く前に電話で確かめてください</small>`;
  }

  // ---------- 避難場所・避難所（2026-11-12 遠藤先生「bcp に避難所の位置も入れてください」） ----------
  // 国土地理院の「指定緊急避難場所・指定避難所データ」（市町村が指定・登録したもの）。Mac の build_shelters.py が毎週作る shelters.json（公開の公のデータ。暗号化しない）
  // 行：[名前, 住所, 緯度, 経度, 災害の種類のビット, 区分のビット（1 緊急避難場所・2 避難所・4 福祉）, 市区町村]
  const DIS = ["洪水", "崖崩れ・土石流・地滑り", "高潮", "地震", "津波", "大規模な火事", "内水氾濫", "火山"];
  const SHF = [["all", "すべて"], ["stay", "指定避難所（しばらく過ごす所）"]].concat(DIS.map((d, i) => ["d" + i, d + "のとき逃げる場所"]));
  const SHEL_SRC = "https://www.gsi.go.jp/bousaichiri/hinanbasho.html";
  let SHEL = null, shelMeta = null, shelLayer = null, shelLoading = null;
  const popOpen = (lg) => !!lg && lg.getLayers().some((m) => m.isPopupOpen && m.isPopupOpen());
  function loadShelters() {
    if (SHEL) return Promise.resolve(SHEL);
    if (!shelLoading) shelLoading = fetch("shelters.json").then((r) => r.json()).then((d) => { shelMeta = { at: d.src_modified || d.built, built: d.built, n: d.n }; SHEL = d.a || []; return SHEL; })
      .catch(() => []).finally(() => { shelLoading = null; });
    return shelLoading;
  }
  const shelF = () => (SHF.some((x) => x[0] === store.get("shelF", "all")) ? store.get("shelF", "all") : "all");
  function shelMatch(r, f) {
    if (f === "all") return true;
    if (f === "stay") return !!(r[5] & 2);
    return !!(r[5] & 1) && !!(r[4] & (1 << +f.slice(1)));
  }
  const shelPinKey = (r) => (r[5] & 2 ? "sh" : "se");
  const shelKind = (r) => [r[5] & 2 ? (r[5] & 4 ? "指定避難所（福祉避難所）" : "指定避難所") : "", r[5] & 1 ? "指定緊急避難場所" : ""].filter(Boolean).join("・");
  const shelDis = (r) => DIS.filter((_, i) => r[4] & (1 << i));
  function distM(la1, lo1, la2, lo2) {
    const R = 6371000, p = Math.PI / 180, a = Math.sin((la2 - la1) * p / 2) ** 2 + Math.cos(la1 * p) * Math.cos(la2 * p) * Math.sin((lo2 - lo1) * p / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function dir8(la1, lo1, la2, lo2) {
    const b = (Math.atan2((lo2 - lo1) * Math.cos(la1 * Math.PI / 180), la2 - la1) * 180 / Math.PI + 360) % 360;
    return ["北", "北東", "東", "南東", "南", "南西", "西", "北西"][Math.round(b / 45) % 8];
  }
  const shelWhen = () => (shelMeta && shelMeta.at ? `${new Date(shelMeta.at).getFullYear()}/${new Date(shelMeta.at).getMonth() + 1}/${new Date(shelMeta.at).getDate()}` : "");
  // 事務所の近くの、手で選んで確かめた避難所（private.json の shelters）と同じ所か
  const shelVip = (r) => ((B && B.shelters) || []).some((p) => distM(p.lat, p.lon, r[2], r[3]) < 150);
  function shelPopup(r) {
    const d = shelDis(r), pos = freshPos(30 * 60e3);
    return `<b>${esc(r[0])}</b><br><small>${esc(shelKind(r))}${shelVip(r) ? "・事務所の近く（確認済み）" : ""}</small><br>${esc(r[1])}` +
      (r[5] & 1 ? `<br>逃げてよい災害：${d.length ? esc(d.join("・")) : "（登録なし）"}` + (d.length < 8 ? `<br><small class="muted">それ以外の災害（${esc(DIS.filter((x) => !d.includes(x)).join("・"))}）のときは、この場所へ逃げない</small>` : "") : "") +
      (r[5] & 2 && !(r[5] & 1) ? `<br><small class="muted">災害の危険が去るまで過ごす所。まず逃げる先は指定緊急避難場所</small>` : "") +
      (pos ? `<br>現在地から約${fmtDist(distM(pos[0], pos[1], r[2], r[3]))}（${dir8(pos[0], pos[1], r[2], r[3])}）` : "") +
      `<br><button class="mini" onclick="window.__bcpRouteTo(${Number(r[2])},${Number(r[3])},${esc(JSON.stringify(r[0]))})">ここへのルート</button>` +
      `<br><small class="muted">国土地理院のデータ（${esc(shelWhen())}更新）。最新でないことがあります。市区町村で確かめてください</small>`;
  }
  // 地図の印：近づくと1つずつ（ズーム14以上か、見えている数が少ないとき）、遠いときは数でまとめる（スマホで重くしない）
  async function drawShelters() {
    if (!map || !shelLayer) return;
    const m0 = map;
    const list = await loadShelters();
    if (m0 !== map || !shelLayer) return;
    if (popOpen(shelLayer) && map.hasLayer(shelLayer)) return;   // 説明を開いている間は描き直さない（閉じたら描き直す）
    shelLayer.clearLayers();
    if (!map.hasLayer(shelLayer) || !list.length) return;
    const f = shelF(), z = map.getZoom(), b = map.getBounds().pad(0.15);
    const vis = [];
    for (let i = 0; i < list.length; i++) { const r = list[i]; if (b.contains([r[2], r[3]]) && shelMatch(r, f)) vis.push(i); }
    if (z >= 14 || vis.length <= 120) {
      vis.slice(0, 500).forEach((i) => { const r = list[i]; L.marker([r[2], r[3]], Object.assign(pin(shelPinKey(r)), { zIndexOffset: -200 })).bindPopup(() => shelPopup(r), { maxWidth: 260 }).addTo(shelLayer); });
      return;
    }
    const cell = 80, g = new Map();
    vis.forEach((i) => {
      const r = list[i], p = map.project([r[2], r[3]], z), k = Math.floor(p.x / cell) + ":" + Math.floor(p.y / cell);
      const c = g.get(k) || { n: 0, la: 0, lo: 0 }; c.n++; c.la += r[2]; c.lo += r[3]; g.set(k, c);
    });
    g.forEach((c) => {
      const s = c.n >= 100 ? 28 : c.n >= 10 ? 24 : 20, at = [c.la / c.n, c.lo / c.n];
      L.marker(at, { icon: L.divIcon({ className: "shcl", html: `<span>${c.n}</span>`, iconSize: [s, s], iconAnchor: [s / 2, s / 2] }), title: `避難場所・避難所 ${c.n}か所（押すと近づく）`, zIndexOffset: -1000 })
        .on("click", () => { if (!mapFull) setMapFull(true); map.setView(at, Math.min(z + 2, 16)); }).addTo(shelLayer);
    });
  }
  // 「近くの避難所・避難場所」：現在地（取れなければ事務所）から近い順に5か所。災害の種類で絞れる（地図の印も同じ絞り込み）
  function shelterBox() {
    const f = shelF();
    return `<div class="card" id="shelbox"><h3>近くの避難所・避難場所</h3>
      <div class="row"><label style="flex:2">どんなときの<select id="shelf">${SHF.map(([k, n]) => `<option value="${k}" ${k === f ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label><button id="shelhere" style="flex:1">現在地から探す</button></div>
      <div id="shellist"><p class="muted">読み込んでいます…</p></div>
      <p class="muted" id="shelnote">指定緊急避難場所＝命を守るためにまず逃げる所（災害の種類ごとに指定。その災害に対応していない場所へは逃げない）。指定避難所＝家に戻れないとき、危険が去るまで過ごす所。どちらも市区町村が指定したもので、このデータは最新でない・載っていないことがあります。最新・詳しい状況は市区町村のハザードマップ・お知らせで確かめてください。<br>出典：${link(SHEL_SRC, "国土地理院「指定緊急避難場所・指定避難所データ」")}（東京都〈島しょを除く〉と隣接の市町村・その隣接の市町村を取り出し、地図の印・一覧に加工）</p></div>`;
  }
  async function fillShelters() {
    const out = $("#shellist"); if (!out) return;
    const list = await loadShelters();
    if (!$("#shellist")) return;
    if (!list.length) { out.innerHTML = `<p class="muted">避難所の一覧を読み込めませんでした（初めて開くときは通信が要ります。一度開けば圏外でも見られます）。</p>`; return; }
    const pos = freshPos(30 * 60e3), office = ((B && B.places) || [])[0];
    const o = pos ? { la: pos[0], lo: pos[1], n: "現在地" } : office ? { la: office.lat, lo: office.lon, n: office.name } : { la: 35.7879, lo: 139.2758, n: "青梅市役所の辺り" };
    const f = shelF();
    const near = [];
    list.forEach((r, i) => { if (shelMatch(r, f)) near.push([distM(o.la, o.lo, r[2], r[3]), i]); });
    near.sort((a, b) => a[0] - b[0]);
    const top = near.slice(0, 5);
    out.innerHTML = `<p class="muted">${esc(o.n)}から近い順（まっすぐの距離）${shelMeta ? `・全${shelMeta.n.toLocaleString()}か所・${esc(shelWhen())}更新` : ""}</p>` +
      (top.length ? `<div class="list">${top.map(([d, i]) => { const r = list[i], k = shelPinKey(r), ds = shelDis(r);
        return `<div class="li shelli"><span class="shk ${k}">${k === "sh" ? "所" : "場"}</span><span style="flex:1"><b>${esc(r[0])}</b>${shelVip(r) ? ` <small class="vip">事務所の近く（確認済み）</small>` : ""}<br><small class="muted">${esc(shelKind(r))}・${fmtDist(d)}（${dir8(o.la, o.lo, r[2], r[3])}）<br>${esc(r[1])}${r[5] & 1 ? `<br>逃げてよい災害：${esc(ds.join("・") || "登録なし")}` : ""}</small></span>
          <span class="shbtns"><button data-shelmap="${i}">地図</button><button data-shelroute="${i}">ルート</button></span></div>`; }).join("")}</div>` : `<p class="muted">この種類の避難場所は近くに見つかりませんでした。</p>`);
  }
  function shelterShow(i) {
    const r = SHEL && SHEL[i]; if (!r || !map) return;
    if (!mapFull) setMapFull(true);
    setTimeout(() => { map.setView([r[2], r[3]], Math.max(map.getZoom(), 16)); L.popup({ maxWidth: 260 }).setLatLng([r[2], r[3]]).setContent(shelPopup(r)).openOn(map); }, 120);
  }

  // ---------- 地図を画面いっぱいに（2026-11-12 遠藤先生「下を表示しようとスクロールすると地図がスクロールする。地図タップで拡大表示し、そこで地図を動かせるように」） ----------
  // ページの中の地図は指で動かない（ページが流れる）。押すと画面いっぱいの地図になり、指で動かす・拡大縮小・印を押す・長押しで登録ができる。道案内中も地図を動かせる
  let mapFull = false, mapFullOnInit = false, lastMapView = null;
  function mapHandlers(on) {
    if (!map) return;
    ["dragging", "touchZoom", "doubleClickZoom", "scrollWheelZoom", "boxZoom", "keyboard"].forEach((h) => { if (map[h]) { if (on) map[h].enable(); else map[h].disable(); } });
    if (!on && map.touchGestures) map.touchGestures.disable();   // 回転の部品が2本指のページの拡大を止めないように
    const c = map.getContainer(); c.classList.toggle("map-live", on); c.classList.toggle("map-still", !on);
  }
  function setMapFull(on) {
    mapFull = !!on;
    document.body.classList.toggle("mapfull", mapFull);
    mapHandlers(mapFull || !!nav);
    if (map) { if (!mapFull) map.closePopup(); setTimeout(() => map && map.invalidateSize({ animate: false }), 60); }
  }
  // 圏外でも探せる場所の一覧（data/places.json。住所＝町名・丁目、施設＝駅・役所・病院・学校・店など。Mac の build_place_index.py が作る）
  let PLACES = null;
  const KJ = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  function kanjiNum(n) { n = +n; if (n < 10) return KJ[n]; if (n < 20) return "十" + (n % 10 ? KJ[n % 10] : ""); if (n < 100) return KJ[Math.floor(n / 10)] + "十" + (n % 10 ? KJ[n % 10] : ""); return String(n); }
  function normName(t) { return String(t).normalize("NFKC").replace(/[\s　]/g, "").replace(/([\u4e00-\u9fff])[ケヵ]([\u4e00-\u9fff])/g, "$1ヶ$2"); }
  function normQuery(q) {
    let t = normName(q).replace(/(\d+)丁目/g, (m, n) => kanjiNum(n) + "丁目");
    // 「勝沼3-182-1」「東青梅1丁目11番」→「勝沼三丁目」（丁目までで探し、細かい所は地図の長押しで）
    t = t.replace(/^(.*?[^\d\-])(\d+)(?:[-－ー]\d+){0,2}(?:番地?|号)?$/, (m, a, n) => a + kanjiNum(n) + "丁目");
    return t;
  }
  async function loadPlaces() {
    if (PLACES) return PLACES;
    // places.json（iPhone 版はアプリ同梱）＋ poi_extra.json（あとから足した種類＝ホームセンター。公開先から届く）
    const ex = fetch("poi_extra.json").then((r) => r.json()).then((d) => d.a || []).catch(() => []);
    try { const d = await (await fetch("data/places.json")).json(); PLACES = d.a.concat(await ex).map((x) => [x[0], x[1], x[2], x[3], normName(x[0])]); }
    catch (e) { PLACES = []; }
    return PLACES;
  }
  async function localSearch(q) {
    const list = await loadPlaces();
    const raw = normName(q), nq = normQuery(q);
    const tries = [nq, raw, raw.replace(/\d.*$/, "")].filter((x, i, a) => x && a.indexOf(x) === i);
    for (const t of tries) {
      const hits = list.filter((p) => p[4].includes(t));
      if (hits.length) {
        const isAddr = (p) => p[3] === "addr" || p[3] === 0;
        hits.sort((a, b) => (a[4].endsWith(t) ? 0 : 1) - (b[4].endsWith(t) ? 0 : 1) || (/\d/.test(q) ? (isAddr(a) ? 0 : 1) - (isAddr(b) ? 0 : 1) : 0) || a[4].length - b[4].length);
        return hits.slice(0, 10).map((p) => ({ name: p[0], addr: isAddr(p) ? "住所（丁目まで）・端末内" : (POI[p[3]] ? POI[p[3]][1] + "・端末内" : "端末内の一覧"), lat: p[1], lon: p[2], src: "端末内" }));
      }
    }
    return [];
  }
  async function placeSearch() {
    const q = ($("#rq").value || "").trim();
    const out = $("#rres");
    if (!q) return;
    out.innerHTML = `<p class="muted">探しています…</p>`;
    const nq0 = normName(q);
    // 自分たちの登録済みの場所（事務所・自宅付近・ことぶき事務所・登録した所）を一番上に
    const own = dests().filter((d) => d.id !== "s:last" && (normName(d.name).includes(nq0) || nq0.includes(normName(d.name).replace(/（.*$/, ""))))
      .map((d) => ({ name: d.name, addr: "登録済みの場所", lat: d.lat, lon: d.lon, src: "登録" }));
    const local = own.concat(await localSearch(q));
    if (!navigator.onLine) {
      searchHits = local;
      out.innerHTML = local.length ? `<p class="muted">圏外なので、端末内の一覧（住所は丁目まで・施設）から探しました。</p><div class="list">${local.map((h, i) => `<a class="li" href="#" data-pick="${i}"><span><b>${esc(h.name)}</b><br><small class="muted">${esc(h.addr)}</small></span><span class="chev">›</span></a>`).join("")}</div>`
        : `<p class="muted">端末内の一覧に見つかりませんでした。町名（例「勝沼三丁目」）や施設の名前の一部で試すか、地図の長押しで指定してください。</p>`;
      return;
    }
    const W = AREA_WIDE, inW = (la, lo) => la >= W.s && la <= W.n && lo >= W.w && lo <= W.e;
    const hits = [];
    const ph = fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lat=35.75&lon=139.3&bbox=${W.w},${W.s},${W.e},${W.n}`)
      .then((r) => r.json()).then((d) => (d.features || []).forEach((f) => {
        const p = f.properties || {}, [lo, la] = f.geometry.coordinates;
        const addr = [p.state, p.city || p.county, p.district, p.street, p.housenumber].filter(Boolean).join(" ");
        hits.push({ name: p.name || addr || q, addr, lat: la, lon: lo, src: "OSM" });
      })).catch(() => {});
    const gs = fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`)
      .then((r) => r.json()).then((d) => (d || []).slice(0, 10).forEach((f) => {
        const [lo, la] = f.geometry.coordinates;
        if (inW(la, lo)) hits.push({ name: f.properties.title, addr: "住所", lat: la, lon: lo, src: "地理院" });
      })).catch(() => {});
    await Promise.all([ph, gs]);
    local.forEach((h) => hits.push(h));   // 通信があっても端末内の一覧も合わせる
    // 並べ方：登録済み → 入れた言葉をそのまま含む → 似ているだけ（「似た名前」と書く）。ネットの検索は似た名前も返すため
    const nqq = normQuery(q);
    const rank = (h) => (h.src === "登録" ? 0 : (normName(h.name).includes(nq0) || normName(h.name).includes(nqq) || h.src === "地理院") ? 1 : 2);
    hits.forEach((h) => { if (rank(h) === 2 && !/似た名前/.test(h.addr)) h.addr = "似た名前・" + h.addr; });
    hits.sort((a, b) => rank(a) - rank(b));
    // 近すぎる重なりをまとめる
    searchHits = hits.filter((h, i) => !hits.slice(0, i).some((x) => Math.abs(x.lat - h.lat) < 0.0005 && Math.abs(x.lon - h.lon) < 0.0005)).slice(0, 10);
    out.innerHTML = searchHits.length ? `<div class="list">${searchHits.map((h, i) => `<a class="li" href="#" data-pick="${i}"><span><b>${esc(h.name)}</b><br><small class="muted">${esc(h.addr)}</small></span><span class="chev">›</span></a>`).join("")}</div><p class="muted">検索：国土地理院・Photon・端末内の一覧（住所：位置参照情報〈Geolonia〉／施設：© OpenStreetMap の協力者）</p>`
      : `<p class="muted">見つかりませんでした。住所（例「青梅市東青梅1-11-1」）や、駅・施設の名前で試してください。地図の長押しでも指定できます。</p>`;
  }
  function pickHit(i) {
    const h = searchHits[i]; if (!h) return;
    const d = { id: "s:last", name: h.name, lat: Math.round(h.lat * 1e5) / 1e5, lon: Math.round(h.lon * 1e5) / 1e5 };
    store.set("searchDest", d); store.set("rto", d.id);
    const sel = $("#rto");
    if (sel) sel.innerHTML = dests().map((x) => `<option value="${esc(x.id)}" ${x.id === d.id ? "selected" : ""}>${esc(x.id === "s:last" ? "🔍 " + x.name : x.name)}</option>`).join("");
    $("#rres").innerHTML = `<div class="alert" style="background:var(--card);color:var(--text)"><b>行き先：${esc(h.name)}</b>${esc(h.addr)}<div class="row" style="margin-top:8px"><button id="rgo2" class="primary">この行き先でルートを出す</button><button data-savedest="1" style="flex:none">登録</button></div></div>`;
    if (map) { if (window.__pickMark) window.__pickMark.remove(); window.__pickMark = L.circleMarker([d.lat, d.lon], { radius: 10, color: "#fff", weight: 3, fillColor: "#e8590c", fillOpacity: 1 }).addTo(map).bindPopup(esc(h.name)); map.setView([d.lat, d.lon], 15, { animate: false }); }
  }
  function routeBox() {
    const ds = dests();
    const opt = (sel) => ds.map((d) => `<option value="${esc(d.id)}" ${d.id === sel ? "selected" : ""}>${esc(d.name)}</option>`).join("");
    const saved = store.get("routes", []);
    // 2026-11-13 遠藤先生「地図画面の下の方にある目的地検索を上の方に表示してほしい」：地図の上に置くので、詰めて地図がすぐ見えるようにする
    return `<div class="card rcompact" id="routebox">
      <div class="row"><input id="rq" placeholder="🔍 行き先を検索（例：河辺駅、青梅警察署、住所。圏外でも）" autocomplete="off"><button id="rsearch" style="flex:none">検索</button></div>
      <div id="rres"></div>
      <div class="row rsel"><label>出発<select id="rfrom"><option value="here">現在地（GPS）</option>${opt(store.get("rfrom", ""))}</select></label>
      <label>行き先<select id="rto">${ds.map((d) => `<option value="${esc(d.id)}" ${d.id === store.get("rto", ds[0] ? ds[0].id : "") ? "selected" : ""}>${esc(d.id === "s:last" ? "🔍 " + d.name : d.name)}</option>`).join("")}</select></label></div>
      <div class="seg">${Object.entries(RMODE).map(([k, n]) => `<button data-rmode="${k}" class="${k === rmode ? "on" : ""}">${n}</button>`).join("")}</div>
      <div class="ropts" id="ropts" style="${rmode === "car" ? "" : "display:none"}"><small class="muted">車のルートの選び方</small>${Object.entries(ROPT).map(([k, v]) => `<button data-ropt="${k}" class="${k === ropt ? "on" : ""}"><b>${esc(v[0])}</b><small>${esc(v[1])}</small></button>`).join("")}</div>
      <button id="rgo" class="primary">${rmode === "train" ? "iPhoneのマップで電車のルートを開く" : "ルートを出す"}</button>
      <div id="rinfo"></div></div><div class="card" id="routebox2">
      <div class="row"><button id="addhere">現在地を行き先に登録</button></div>
      <p class="muted">地図を長押しすると、その場所を行き先に登録できます。避難所などの印を押すと「ここへのルート」が出ます。</p>
      ${saved.length ? `<h3 style="margin-top:12px">保存したルート</h3>${saved.map((r, i) => `<div class="tel"><div><b>${esc(r.name)}</b><div class="muted">${esc(modeName(r))}・${fmtDist(r.dist)}・約${fmtDur(r.dur)}・${esc(String(r.at).slice(5, 16).replace("T", " "))}</div></div><div class="row" style="flex:none;gap:4px"><button data-rshow="${i}" style="min-height:40px;padding:6px 10px">出す</button><button data-rdel="${i}" style="min-height:40px;padding:6px 10px">消す</button></div></div>`).join("")}` : ""}
      ${dests().length > ((B && B.places) || []).length ? `<details><summary>登録した場所</summary><div class="body">${store.get("dests", []).map((d, i) => `<div class="tel"><div>${esc(d.name)}</div><button data-ddel="${i}" style="min-height:36px;padding:4px 10px">消す</button></div>`).join("")}</div></details>` : ""}
      <p class="muted">経路：© ${link("https://www.openstreetmap.org/copyright", "OpenStreetMap")} の協力者（ODbL）・FOSSGIS の経路検索（OSRM・Valhalla）。${link("https://www.openstreetmap.org/fixthemap", "地図の誤りを知らせる")}。電車は時刻・運行が変わるので、災害時は止まる前提で徒歩のルートも保存しておく。</p></div>`;
  }
  // 時間：1時間以上は「○時間○分」（2026-11-11 先生）
  const fmtDur = (sec) => { const m = Math.max(1, Math.round(sec / 60)); return m < 60 ? `${m}分` : `${Math.floor(m / 60)}時間${m % 60 ? (m % 60) + "分" : ""}`; };
  const fmtDist = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + "km" : Math.round(m) + "m");
  function here() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error("位置が使えません"));
      navigator.geolocation.getCurrentPosition((p) => res({ name: "現在地", lat: p.coords.latitude, lon: p.coords.longitude }),
        () => rej(new Error("現在地を取れませんでした（位置の許可を確認）")), { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
    });
  }
  const MOD = { left: "左", right: "右", "slight left": "斜め左", "slight right": "斜め右", "sharp left": "大きく左", "sharp right": "大きく右", straight: "まっすぐ", uturn: "Uターン" };
  function stepText(st) {
    const m = st.maneuver || {}, mod = MOD[m.modifier] || "";
    const road = st.name ? `（${st.name}）` : "";
    if (m.type === "depart") return `出発${road}`;
    if (m.type === "arrive") return "到着";
    if (m.type === "roundabout" || m.type === "rotary") return `ロータリーを進む${road}`;
    return `${mod ? mod + "へ" : "進む"}${road}`;
  }
  async function routeGo() {
    const ds = dests(), to = ds.find((d) => d.id === $("#rto").value);
    if (!to) return toast("行き先を選んでください");
    store.set("rto", to.id); store.set("rfrom", $("#rfrom").value);
    let from;
    try { from = $("#rfrom").value === "here" ? await here() : ds.find((d) => d.id === $("#rfrom").value); } catch (e) { return toast(e.message); }
    if (!from) return toast("出発を選んでください");
    const apple = (flg) => `https://maps.apple.com/?saddr=${from.lat},${from.lon}&daddr=${to.lat},${to.lon}&dirflg=${flg}`;
    if (rmode === "train") { window.open(apple("r"), "_blank"); return; }
    if (!navigator.onLine) return toast("ルートを出すには通信が要ります（保存したルートは圏外でも出せます）");
    $("#rinfo").innerHTML = `<p class="muted">ルートを調べています…</p>`;
    try {
      // 通行止めに掛からないルートを選ぶ（2026-11-11 先生「回避ルートも表示できるように」）
      const f = await findRoute(from, to, rmode, rmode === "car" ? ropt : "");
      const rec = Object.assign({ name: `${from.name} → ${to.name}${rmode === "car" && ropt !== "toll" ? `（${ROPT[ropt][2]}）` : ""}`, from, to, at: new Date().toISOString(), apple: apple(rmode === "foot" ? "w" : "d") }, f.rt);
      if (f.avoided) rec.avoid = 1;
      if (f.fallback) rec.fb = 1;
      const list = store.get("routes", []).filter((x) => !(x.name === rec.name && x.mode === rec.mode && (x.opt || "") === (rec.opt || "")));
      list.unshift(rec); store.set("routes", list.slice(0, 20));
      showRoute(rec, f);
    } catch (e) {
      $("#rinfo").innerHTML = `<p class="muted">ルートを出せませんでした（${esc(String(e.message || e))}）。iPhoneのマップで開けます：${link(apple(rmode === "foot" ? "w" : "d"), "マップで開く")}</p>`;
    }
  }
  function showRoute(rec, ex, keepView) {
    if (!map) return;
    if (routeLayer) routeLayer.remove();
    routeLayer = L.featureGroup().addTo(map);
    if (ex && ex.skipped) L.polyline(ex.skipped, { color: "#7a7a7a", weight: 5, opacity: 0.7, dashArray: "8 8", className: "route-skipped" }).addTo(routeLayer);
    // 経路の形は経路検索の全部の点（OSRM overview=full・Valhalla の shape）。白い縁取りで道の上でも見やすく（2026-11-12 先生「道が分かりづらい」）
    L.polyline(rec.coords, { color: "#ffffff", weight: 11, opacity: 0.9, interactive: false, className: "route-casing" }).addTo(routeLayer);
    L.polyline(rec.coords, { color: "#e8590c", weight: 7, opacity: 0.95 }).addTo(routeLayer);
    if (nav) nav.doneLine = L.polyline([], { color: "#868e96", weight: 7, opacity: 0.9, interactive: false, className: "route-done" }).addTo(routeLayer);   // 通った所は灰色
    if (rec.to) L.marker([rec.to.lat, rec.to.lon], { icon: L.divIcon({ className: "route-dest", html: "🏁", iconSize: [28, 28], iconAnchor: [6, 26] }), interactive: false, zIndexOffset: 800 }).addTo(routeLayer);   // 行き先（案内中も出す）
    if (!keepView) map.fitBounds(routeLayer.getBounds(), { padding: [30, 30], animate: false });   // 引き直しでは位置・ズーム・向きを変えない
    curRoute = rec;
    if (needER(rec) && !ER) loadER().then(() => { if (curRoute === rec && $("#rwarn")) { const c = roadCheck(rec); $("#rwarn").outerHTML = roadWarnHtml(rec, c, ex); const o = $("#ropt"); if (o) o.outerHTML = optHtml(rec, c, ex); } });
    const box = $("#rinfo"), chk = roadCheck(rec);
    if (box) box.innerHTML = `${roadWarnHtml(rec, chk, ex)}<div class="alert" style="background:var(--card);color:var(--text)"><b>${esc(rec.name)}</b>${esc(modeName(rec))}・${fmtDist(rec.dist)}・約${fmtDur(rec.dur)}
      <div id="rjam"></div>
      ${optHtml(rec, chk, ex)}
      ${rec.steps[0] && rec.steps[0][2] ? `<button id="navstart" data-rname="${esc(rec.name)}" class="primary" style="margin-top:8px">▶ 道案内を始める（GPS・圏外でも）</button>` : ""}
      ${extNavHtml(rec)}
      <div class="row" style="margin-top:8px"><button id="rtiles" data-rname="${esc(rec.name)}" style="min-height:40px">ルート沿いの地図も保存</button></div>
      <details><summary>曲がる所（${rec.steps.length}）</summary><ol class="steps">${rec.steps.map(([t, m]) => `<li>${esc(t)} <span class="muted">${fmtDist(m)}</span></li>`).join("")}</ol></details></div>`;
    jamLine = null;
    setTimeout(() => jamFill(rec), 0);   // 渋滞は経路を出した後に書き足す（待たせない・失敗してもルートは出たまま）
  }
  // ほかのアプリで案内（2026-11-12 夕 先生）：行き先と、ルートの形を保つ経由地（Google 3・Yahoo!カーナビ 3・Apple 5）、有料道路を避ける指定（受け付けるものだけ）
  function extNavHtml(rec) {
    const NG = window.BCPNavGuide; if (!NG || !rec.from || !rec.to) return `<div class="row" style="margin-top:8px"><a class="chip" href="${esc(rec.apple)}" target="_blank" rel="noopener">iPhoneのマップで案内</a></div>`;
    const L = NG.extLinks(rec, rec.from, rec.to), car = rec.mode === "car";
    return `<div class="extnav"><div class="muted" style="margin:8px 0 4px">ほかのアプリで案内（このルートの形を経由地で渡します${car && rec.opt && rec.opt !== "toll" ? "・有料道路を避ける指定つき" : ""}）</div>
      <div class="extbtns"><a class="chip" data-ext="google" href="${esc(L.google)}" target="_blank" rel="noopener">Google マップ</a>${L.yahoo ? `<a class="chip" data-ext="yahoo" href="${esc(L.yahoo)}">Yahoo!カーナビ</a>` : ""}<a class="chip" data-ext="apple" href="${esc(L.apple)}" target="_blank" rel="noopener">Apple マップ</a></div>
      ${car && rec.opt === "safe" ? `<p class="muted" style="margin:4px 0">「災害時に通行止めになる道を避ける」は、ほかのアプリには伝わりません（経由地でルートの形をなるべく保ちます。高速・有料道路を避ける指定は Google・Apple に渡します）。</p>` : ""}
      ${car && rec.opt === "free" ? `<p class="muted" style="margin:4px 0">Yahoo!カーナビには有料道路を避ける指定を渡せません（Yahoo!カーナビの設定で選んでください）。</p>` : ""}
      <p class="muted" style="margin:4px 0">Apple マップの経由地・避ける指定は iOS 18.4 以降。Yahoo!カーナビは入っていないと開きません（そのときは App Store を案内します）。</p></div>`;
  }
  function routeTileUrls(rec) {
    const set = new Set();
    const add = (z, x, y) => ["std", "flood", "doseki", "kyuke"].forEach((k) => { if (k === "std" || z <= 16) set.add(TILE[k].url.replace("{z}", z).replace("{x}", x).replace("{y}", y)); });
    rec.coords.forEach(([la, lo]) => {
      for (let z = 15; z <= 17; z++) {
        const n = 2 ** z, x = Math.floor((lo + 180) / 360 * n), y = Math.floor((1 - Math.asinh(Math.tan(la * Math.PI / 180)) / Math.PI) / 2 * n);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (z < 17 || (dx === 0 && dy === 0)) add(z, x + dx, y + dy);
      }
    });
    return [...set];
  }
  // ---------- 道案内（GPS。保存したルートを使うので圏外でも動く） ----------
  // 2026-11-11 遠藤先生「GPSで道案内ができるようにしてもらいたい」
  let nav = null;   // { rec, cum[], stepAt[], spoken{}, off, watch, lock, lastReroute, follow }
  let mapBase = null;
  // 案内中の見た目：地図を画面いっぱい・淡い地図（ルートが目立つ）。指で動かしたら追いかけを止め、「現在地に戻る」で戻す（2026-11-11 先生「スクロールすると勝手に出発点に戻る」「見にくい」）
  function navLook(on) {
    document.body.classList.toggle("navmode", on);
    if (!on) document.body.classList.remove("navpins");
    mapHandlers(on || mapFull);
    if (map && mapBase) {   // 案内中は淡色地図。終わったら選んでいた地図に戻す
      const keep = mapBase[baseKey()] || mapBase.plain;
      baseSwap = true;
      if (on && !map.hasLayer(mapBase.pale)) { ["plain", "std", "osm", "photo"].forEach((k) => map.hasLayer(mapBase[k]) && map.removeLayer(mapBase[k])); mapBase.pale.addTo(map); }
      if (!on && map.hasLayer(mapBase.pale) && keep !== mapBase.pale) { map.removeLayer(mapBase.pale); keep.addTo(map); }
      baseSwap = false;
    }
    setTimeout(() => map && map.invalidateSize(), 50);
  }
  function navFollow(on) {
    if (!nav) return;
    nav.follow = on;
    const b = $("#navrecenter"); if (b) b.style.display = on ? "none" : "inline-block";
    if (on && nav.lastPos && map) { const m = followMark ? [followMark.getLatLng().lat, followMark.getLatLng().lng] : nav.lastPos; navView(m, null, false); }   // 速さに合った拡大で、自分の位置を下寄りに
  }
  const R_EARTH = 6371000;
  function xy(lat, lon, lat0) { return [lon * Math.PI / 180 * R_EARTH * Math.cos(lat0 * Math.PI / 180), lat * Math.PI / 180 * R_EARTH]; }
  function project(rec, cum, lat, lon, s0, s1) {
    // ルートの線の上で一番近い点：{ d: 線からの距離m, s: 出発からの道のりm, lat, lon: 線の上の点, brg: その所の線の向き（度） }
    // s0〜s1 を渡すと、その道のりの間だけで探す（進んだ位置の窓。往復・立体交差・つづら折りで位置が飛ばないように）
    const lat0 = rec.coords[0][0], p = xy(lat, lon, lat0);
    const lo0 = s0 == null ? -Infinity : s0, hi0 = s1 == null ? Infinity : s1;
    let best = { d: Infinity, s: 0, x: 0, y: 0, brg: 0 };
    for (let i = 0; i < rec.coords.length - 1; i++) {
      if (cum[i + 1] < lo0 || cum[i] > hi0) continue;
      const a = xy(rec.coords[i][0], rec.coords[i][1], lat0), b = xy(rec.coords[i + 1][0], rec.coords[i + 1][1], lat0);
      const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
      const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2)) : 0;
      const qx = a[0] + t * vx, qy = a[1] + t * vy, d = Math.hypot(p[0] - qx, p[1] - qy);
      if (d < best.d) best = { d, s: cum[i] + t * Math.sqrt(L2), x: qx, y: qy, brg: L2 ? (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360 : best.brg };
    }
    if (best.d === Infinity) return project(rec, cum, lat, lon);
    const q = unxy(best.x, best.y, lat0);
    return { d: best.d, s: best.s, lat: q[0], lon: q[1], brg: best.brg };
  }
  const cumOf = (rec) => { const lat0 = rec.coords[0][0], c = [0]; for (let i = 1; i < rec.coords.length; i++) { const a = xy(rec.coords[i - 1][0], rec.coords[i - 1][1], lat0), b = xy(rec.coords[i][0], rec.coords[i][1], lat0); c.push(c[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])); } return c; };
  const dm = (a, b) => { const p = xy(a[0], a[1], a[0]), q = xy(b[0], b[1], a[0]); return Math.hypot(q[0] - p[0], q[1] - p[1]); };
  const brgOf = (a, b) => { const p = xy(a[0], a[1], a[0]), q = xy(b[0], b[1], a[0]); return (Math.atan2(q[0] - p[0], q[1] - p[1]) * 180 / Math.PI + 360) % 360; };
  const angDiff = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
  function aheadOf(p, h, m) { const r = h * Math.PI / 180, v = xy(p[0], p[1], p[0]); return unxy(v[0] + Math.sin(r) * m, v[1] + Math.cos(r) * m, p[0]); }
  // 声の案内（2026-11-11 先生「棒読みで怖い」）：いちばん自然な日本語の声（プレミアム＞拡張＞標準）を選び、カーナビのような言い回しで。
  // iPhone アプリでは本体の読み上げ（AVSpeechSynthesizer。App.swift）で話す＝音楽などを少し下げて割り込む
  let jaVoice = null;
  function pickVoice() {
    try {
      const score = (v) => (/premium|プレミアム/i.test(v.name) ? 4 : /enhanced|拡張/i.test(v.name) ? 3 : /siri/i.test(v.name) ? 2 : /o-?ren|kyoko|hattori/i.test(v.name) ? 1 : 0);
      jaVoice = speechSynthesis.getVoices().filter((v) => /^ja/i.test(v.lang)).sort((a, b) => score(b) - score(a))[0] || null;
    } catch (e) { jaVoice = null; }
  }
  try { if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; } } catch (e) { /* なし */ }
  // 声は1本だけ（2026-11-12 先生「表示と音声がずれ、ひたすら喋りつづける」）：優先度つき。話している間に来た同じか低い優先度の声は1つだけ待たせ、
  // 高い優先度（曲がる直前など）だけが割り込む。同じ文は20秒言わない。引き直したら、待っている古いルートの声は捨てる（sayFlush）
  // 優先度：4＝曲がる直前、3＝予告・外れた・引き直し・通行止め、1＝開始・その他
  const voiceQ = { busyTill: 0, pri: 0, pend: null, last: {}, tm: 0 };
  window.__bcpVoiceQ = voiceQ;   // 試験用
  function say(t, pri) {
    if (!t) return;
    if (document.visibilityState === "hidden") return;   // 裏に回っている・画面が消えている間は声を積まない（2026-11-12 先生「アプリを起動すると溜まったのがずっと流れる」）
    pri = pri || 1;
    const now = Date.now();
    if (voiceQ.quietTill && now < voiceQ.quietTill) return;
    if (voiceQ.last[t] && now - voiceQ.last[t] < 20000) return;
    if (now < voiceQ.busyTill && pri <= voiceQ.pri) { if (!voiceQ.pend || pri >= voiceQ.pend.pri) voiceQ.pend = { t, pri, at: now }; return; }
    speakNow(t, pri);
  }
  function speakNow(t, pri) {
    const now = Date.now();
    voiceQ.last[t] = now; voiceQ.pri = pri; voiceQ.busyTill = now + 400 + t.length * 140;   // 話し終わりの見込み（iPhone は終わりの知らせが無いので文字数から）
    clearTimeout(voiceQ.tm); voiceQ.tm = setTimeout(sayNext, voiceQ.busyTill - now + 60);
    try {
      if (window.__BCP_IOS && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bcp) { window.webkit.messageHandlers.bcp.postMessage({ speak: t, at: now }); return; }   // at：作った時刻（古い声は iPhone 側で捨てる）
      if (!window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(t); u.lang = "ja-JP"; u.rate = 1.0; u.pitch = 1.0; if (jaVoice) u.voice = jaVoice;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) { /* 声が出せない端末 */ }
  }
  function sayNext() { const q = voiceQ.pend; voiceQ.pend = null; voiceQ.pri = 0; voiceQ.busyTill = 0; if (q && Date.now() - q.at < 8000) speakNow(q.t, q.pri); }
  function sayFlush() { voiceQ.pend = null; }   // 待っている声を捨てる（話している最中の1文は最後まで）
  function sayStopAll() {   // 話している声も待っている声も全部消す（裏に回ったとき・前面に戻ったとき）
    voiceQ.pend = null; voiceQ.busyTill = 0; voiceQ.pri = 0; clearTimeout(voiceQ.tm);
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* なし */ }
    try { window.__BCP_IOS && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bcp && window.webkit.messageHandlers.bcp.postMessage({ speakStop: true }); } catch (e) { /* なし */ }
  }
  // 前面に戻ったとき：今の位置で計算し直し、今まさに必要な案内（次の曲がる所が近ければその1つ）だけを言う。過ぎた予告・古い引き直しの声は言わない
  function navResume() {
    if (!nav || nav.offDeclared || document.visibilityState === "hidden") return;
    const k = nextReal(nav.lastS + 3);
    if (k < 0) return;
    const d = nav.stepAt[k] - nav.lastS, ph = navPhases(stepG(nav.rec.steps[k]), nav.rec.mode === "foot");
    ph.forEach(([n, m]) => { if (d <= m * 1.3) nav.spoken[k + ":" + n] = 1; });   // この曲がる所の、もう過ぎた段は言わない
    if (d <= ph[0][1]) speakNow(stepPhrase(k, d, d <= ph[ph.length - 1][1] ? "near" : "far"), 4);
  }
  // 読み上げ用の言い方：距離は「およそ300メートル」「およそ1.2キロ」、曲がる所は「左です」「斜め右方向です」（道の名前があれば添える）
  function sayDist(m) { return m >= 1000 ? `およそ${(Math.round(m / 100) / 10).toString()}キロ` : `およそ${Math.max(10, Math.round(m / 10) * 10)}メートル`; }
  function sayTurn(text) {
    const mm = String(text).match(/^(.*?)(?:へ)?(?:（(.+)）)?$/);
    const dir = (mm && mm[1]) || text, road = mm && mm[2];
    if (dir === "到着") return "目的地です";
    if (dir === "進む" || dir === "まっすぐ") return road ? `${road}を、道なりです` : "道なりです";
    if (/ロータリー/.test(dir)) return "ロータリーを進みます";
    const d = /^(斜め|大きく)/.test(dir) ? `${dir}方向です` : `${dir}です`;
    return road ? `${road}へ、${d}` : d;
  }
  // ---------- 道案内の判定（2026-11-12 遠藤先生「道の反対側を走っているのに戻ろうとして、ルートから外れて再検索を繰り返している」「地図が進行方向を向かない」） ----------
  // 失敗の場面の一覧（README「道案内の失敗の場面と振る舞い」）に沿って作る：
  // ・外れたかは「距離（GPSの誤差を見込む）・進み具合（線の上で戻っていないか）・向き・速さ・続いた時間」で決める（1〜2点の飛びでは決めない）
  // ・時速5km未満（止まっている・ゆっくり）では外れた判定・引き直しをしない（信号待ち・寄り道）
  // ・引き直しは今の進む向きを経路検索に渡し（Valhalla heading・OSRM bearings）、答えを検算してから使う（Uターン始まりは使わない・待つ間に元の道へ戻っていたら捨てる・同時に1本だけ）
  // ・引き直しの間隔は 8→15→30 秒。3回続けて失敗したら自動をやめ、手で引き直すボタン
  const NAV = { offCar: 40, offFoot: 25, accMaxCar: 60, accMaxFoot: 40, offPts: 3, offMs: 5000, badAcc: 100, slow: 1.4, gpsHdSpeed: 3, moveHd: 20,
    backM: 30, wrongDeg: 120, wrongMs: 15000, wrongM: 100, nearDest: 150, startFree: 150, jumpCar: 60, jumpFoot: 10,
    rrGaps: [8000, 15000, 30000], rrSlowMs: 45000, stopRrMs: 3000, rrMoveCar: 50, rrMoveFoot: 20, rrMaxFail: 3, settleMs: 60000, fetchMs: 12000, lead: 3, accept: 30, winBack: 50, winAhead: 300 };
  window.__bcpNavCfg = NAV;   // 試験で経路検索の待ち時間だけ縮める
  const headUp = () => store.get("headUp2", true);   // 進行方向が上（既定）。2026-11-12 先生「地図が進行方向を向かない」→ 前の設定（headUp）は使わず既定に戻す
  function navUse(rec) {   // 案内するルートを入れ替える（始めるとき・引き直したとき）
    const cum = cumOf(rec);
    let s0 = 0;
    const stepAt = rec.steps.map((st) => { if (!st[2]) return s0; const q = project(rec, cum, st[2][0], st[2][1], s0 - 5, Infinity); s0 = q.s; return q.s; });
    Object.assign(nav, { rec, cum, stepAt, total: cum[cum.length - 1], R: prepRoute(rec.coords), lastS: 0, sPeak: 0, spoken: {}, offN: 0, offT: 0, offDeclared: false, wrongT: 0, wrongP: null, gen: (nav.gen || 0) + 1, swapAt: Date.now() });
    { const c0 = roadCheck(rec, nav.R); nav.known = new Set([...c0.block, ...c0.quake].map(hid)); }   // 今わかっている通行止めは、もう知らせた扱い
    curRoute = rec;
    navJam();   // 案内の欄の渋滞（声にはしない）
  }
  async function navStart(rec, note) {
    if (!map) return;
    navStop(true);
    voiceQ.last = {}; voiceQ.pend = null;   // 新しい案内では「同じ文は20秒言わない」の記録を空にする
    if (window.BCPNavGuide && window.BCPNavGuide.fixRamps && rec && rec.steps) window.BCPNavGuide.fixRamps(rec.steps.map((x) => x[3]));   // 前に保存したルートも高速の入口を直して案内する（2026-11-13）
    nav = { t0: Date.now(), follow: true, lastPos: null, hist: [], pend: null, rot: null, heading: null, roadAt: Date.now(), touched: false, start: null, zt: null,
      rr: { n: 0, at: 0, pos: null, fail: 0, manual: false } };
    if (needER(rec)) await loadER();
    navUse(rec);
    navLook(true);
    showRoute(rec);
    bgPost({ navStart: bgPayload() });
    // 指で地図を動かしたら追いかけを止める（勝手に戻さない）
    map.off("dragstart", navDragged); map.on("dragstart", navDragged);
    try { window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bcp && window.webkit.messageHandlers.bcp.postMessage({ keepAwake: true }); } catch (e) { /* なし */ }
    let box = $("#navbox");
    if (!box) { box = document.createElement("div"); box.id = "navbox"; $("#map").appendChild(box); }
    box.innerHTML = `${note ? `<div class="nav-road" id="navroad">${esc(note)}</div>` : `<div class="nav-road" id="navroad" hidden></div>`}<div class="nav-main"><div class="nav-arrow"></div><div class="nav-txt"><div class="nav-next">位置を調べています…</div><div class="nav-name"></div><div class="nav-to"></div></div></div><div class="nav-then" hidden></div><div class="nav-sub"></div><div class="nav-jam" id="navjam" hidden></div><div class="nav-btns"><button id="navrecenter" style="display:none">📍 現在地に戻る</button><button id="navreroute" style="display:none">↻ ルートを引き直す</button><button id="navheading">${headUp() ? "🧭 進行方向が上" : "⬆ 北が上"}</button><button id="navpins" title="避難所・施設などの印を出す／隠す">📍 印</button><button id="navstop">案内を終える</button></div><div class="nav-hint">${window.__BCP_BG_NAV ? "画面を消しても、案内の声は続きます（画面の上に青い表示が出ます）。道を外れたときの引き直しは、アプリを開いたときに行います" : "画面を消したり、ほかのアプリに切り替えたりすると、案内（声）が止まります"}</div>`;
    L.DomEvent.disableClickPropagation(box);
    try { if (navigator.wakeLock) nav.lock = await navigator.wakeLock.request("screen"); } catch (e) { /* 画面を点けたままにできない端末 */ }
    navJam();
    // 渋滞は案内の開始の声に1回だけ短く足す（引き直しでは言わない）
    say(`案内を開始します。${rec.to.name}まで、${sayDist(rec.dist)}、${RMODE[rec.mode]}で約${fmtDur(rec.dur)}です。${rec.mode === "car" && rec.opt && rec.opt !== "toll" ? (rec.opt === "safe" ? "災害時に通行止めになる道を避けるルートです。" : "有料道路を使わないルートです。") : ""}${jamSay(rec)}`);
    if (!navigator.geolocation) { box.querySelector(".nav-next").textContent = "このスマホでは位置が使えません"; return; }
    nav.watch = navigator.geolocation.watchPosition(navTick, () => { const n = $("#navbox .nav-next"); if (n) n.textContent = "現在地を取れません（位置の許可・屋内を確認）"; },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }
  function navDragged() { navFollow(false); }
  function navNote(t) { const a = $("#navroad"); if (!a) return; a.hidden = !t; a.textContent = t || ""; }
  // 速さと進む向き：GPS の向き（秒速3m以上）、無ければ直近の20m以上の移動から。止まっている間は向きを変えない
  function navEst(c, now) {
    const foot = nav.rec.mode === "foot", hs = nav.hist, last = hs[hs.length - 1];
    let v = (c.speed != null && !isNaN(c.speed) && c.speed >= 0) ? c.speed : null, h = null;
    if (last) for (let i = hs.length - 2; i >= 0; i--) {
      const q = hs[i]; if (now - q.t > 30000) break;
      const d = dm([q.la, q.lo], [last.la, last.lo]);
      if (d >= NAV.moveHd) { h = brgOf([q.la, q.lo], [last.la, last.lo]); if (v == null) v = d / Math.max(1, (last.t - q.t) / 1000); break; }
    }
    if (c.heading != null && !isNaN(c.heading) && v != null && v >= (foot ? 1 : NAV.gpsHdSpeed)) h = c.heading;
    // 直近3秒ほどの動きが6m未満なら止まっている（信号待ち。GPSのふらつきで向き・速さを作らない）
    if (last && (c.speed == null || isNaN(c.speed))) {
      const r = hs.slice().reverse().find((q) => last.t - q.t >= 2500);
      if (r && last.t - r.t <= 6000 && dm([r.la, r.lo], [last.la, last.lo]) < 6) { v = 0; h = null; }
    }
    return { v: v == null ? 0 : v, h };
  }
  // 地図の向き（進行方向が上）：ふらつかないよう滑らかに回す。自分の位置は画面の下寄り（前が広く見える）
  function navView(mark, pr, onRoute) {
    let h = nav.heading;
    if (h == null && onRoute && pr) h = pr.brg;   // 走り出す前はルートの向き
    if (h != null) { if (nav.rot == null) nav.rot = h; else { const d = ((h - nav.rot) % 360 + 540) % 360 - 180; if (Math.abs(d) > 2) nav.rot = (nav.rot + d * 0.5 + 360) % 360; } }
    if (map.setBearing) map.setBearing(headUp() && nav.rot != null ? (360 - nav.rot) % 360 : 0);
    meDir(followMark, nav.rot, nav.rec.mode === "foot");   // 現在地の印の向き（動いている向き。走り出す前はルートの向き）。地図を回した後に合わせる
    if (!nav.follow) return;
    const z = nav.zt || map.getZoom();
    let c = mark;
    if (headUp() && nav.rot != null) { const mpp = 156543.03392 * Math.cos(mark[0] * Math.PI / 180) / Math.pow(2, z); c = aheadOf(mark, nav.rot, map.getSize().y * 0.22 * mpp); }
    map.setView(c, z, { animate: false });
  }
  function navZoom(v) {   // 速さで拡大を決める（徒歩17・一般道16・速いとき15）。地理院の地図を引き伸ばしすぎない
    const z = nav.rec.mode === "foot" ? 17 : (v > 16.7 ? 15 : 16), now = Date.now();
    if (nav.zt == null) { nav.zt = z; return; }
    if (z !== nav.zt) { if (!nav.zCand || nav.zCand.z !== z) nav.zCand = { z, t: now }; else if (now - nav.zCand.t > 8000) { nav.zt = z; nav.zCand = null; } }
    else nav.zCand = null;
  }
  function navStop(silent) {
    navLook(false);   // 到着で案内が終わった後でも、必ず元の表示に戻す
    if (map && map.setBearing) map.setBearing(0);
    if (map) map.off("dragstart", navDragged);
    if (!nav) { const b = $("#navbox"); if (b) b.remove(); return; }
    bgPost({ navStop: true });
    if (nav.watch != null) navigator.geolocation.clearWatch(nav.watch);
    try { nav.lock && nav.lock.release(); } catch (e) { /* なし */ }
    try { window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bcp && window.webkit.messageHandlers.bcp.postMessage({ keepAwake: false }); } catch (e) { /* なし */ }
    nav = null;
    const b = $("#navbox"); if (b) b.remove();
    sayFlush();
    if (!silent) say("案内を終了します。", 4);
  }
  const onHighway = () => { if (!nav) return false; const v = (nav.est || {}).v || 0; const i = nav.stepAt.reduce((k, sv, j) => (sv <= (nav.lastS || 0) ? j : k), 0); return v > 22 || isTollName(String((nav.rec.steps[i] || [""])[0]), ""); };
  async function navTick(pos) {
    if (!nav || !map) return;
    const now = Date.now(), c = pos.coords, la = c.latitude, lo = c.longitude, acc = c.accuracy || 0, cur = [la, lo];
    const rec = nav.rec, foot = rec.mode === "foot";
    // ありえない位置の飛び（トンネル・ビルの谷間）：1点だけなら捨てる。2点続けばそこへ移ったとみる
    const prev = nav.hist[nav.hist.length - 1];
    const jump = (q) => { const d = dm([q.la, q.lo], cur); return d > 50 && d / Math.max(0.5, (now - q.t) / 1000) > (foot ? NAV.jumpFoot : NAV.jumpCar); };
    if (prev && jump(prev) && !(nav.pend && !jump(nav.pend))) { nav.pend = { t: now, la, lo }; return; }
    let reloc = false;
    if (prev && jump(prev)) { reloc = true; nav.hist = []; nav.sPeak = 0; nav.wrongT = 0; nav.offN = 0; nav.offT = 0; }   // 2点続いたので、そこへ移ったとみる
    nav.pend = null;
    if (acc <= NAV.badAcc) { nav.hist.push({ t: now, la, lo }); if (nav.hist.length > 20) nav.hist.shift(); }
    nav.lastPos = cur; nav.lastFix = now; nav.lastAcc = acc;
    if (acc <= NAV.badAcc && now - (nav.savedAt || 0) > 30e3) { nav.savedAt = now; savePos(la, lo); }
    if (!nav.start) nav.start = cur;
    const est = navEst(c, now); nav.est = est;
    if (est.h != null && est.v >= NAV.slow) nav.heading = est.h;   // 止まっている間は向きを変えない
    navZoom(est.v);
    let limit = (foot ? NAV.offFoot : NAV.offCar) + Math.min(acc, foot ? NAV.accMaxFoot : NAV.accMaxCar);
    if (nav.stepAt.some((sv, i) => i > 0 && Math.abs(sv - nav.lastS) < 40)) limit += 20;   // 曲がり角の付近は、線の角と実際の曲がり方の差を見込んでゆるめる
    // 線の上の位置は、進んだ位置の窓（手前50m〜先300m＋進んだ分）で探す。外れた後・最初は全体から
    let pr;
    if (nav.touched && !nav.offDeclared && !reloc) {
      const extra = est.v * Math.max(1, (now - (nav.lastTickT || now)) / 1000);
      pr = project(rec, nav.cum, la, lo, nav.lastS - NAV.winBack, nav.lastS + NAV.winAhead + extra);
      if (pr.d > limit) { const g = project(rec, nav.cum, la, lo); if (g.d <= limit && g.s >= nav.lastS - NAV.winBack) pr = g; }
    } else pr = project(rec, nav.cum, la, lo);
    nav.lastTickT = now;
    const toDest = dm(cur, [rec.to.lat, rec.to.lon]);
    if (!nav.touched && pr.d <= limit) nav.touched = true;
    if (reloc && pr.d <= limit) { nav.lastS = pr.s; nav.sPeak = pr.s; }
    // 反対の向き（車だけ）：線の近くなのに進み具合が30m以上戻った／向きが120度以上違うまま15秒・100m
    let wrong = false;
    if (!foot && pr.d <= limit && est.v >= NAV.slow) {
      if (pr.s > nav.sPeak) nav.sPeak = pr.s;
      if (nav.sPeak - pr.s >= NAV.backM + acc / 2) wrong = true;
      if (nav.heading != null && angDiff(nav.heading, pr.brg) > NAV.wrongDeg) {
        if (!nav.wrongT) { nav.wrongT = now; nav.wrongP = cur; }
        if (now - nav.wrongT >= NAV.wrongMs && dm(nav.wrongP, cur) >= NAV.wrongM) wrong = true;
      } else { nav.wrongT = 0; nav.wrongP = null; }
    }
    if (!wrong && pr.d <= limit) nav.lastS = pr.s;
    // 外れた：誤差の大きい点・止まっている・目的地の近く・出発してすぐ（駐車場など）では決めない。3点・5秒続いたときだけ
    const judge = acc <= NAV.badAcc && est.v >= NAV.slow && toDest >= NAV.nearDest && (nav.touched || dm(nav.start, cur) >= NAV.startFree);
    if (judge && (pr.d > limit || wrong)) { nav.offN++; if (!nav.offT) nav.offT = now; }
    else if (pr.d <= limit && !wrong) { nav.offN = 0; nav.offT = 0; }
    // 1点ごとの判定の記録（端末の中だけ。直すときの手がかり・走行の再生に使う。位置は外へ送らない）
    nav.log = nav.log || []; nav.log.push([now, r5(la), r5(lo), Math.round(acc), Math.round(pr.d), Math.round(pr.s), Math.round(limit), +est.v.toFixed(1), nav.heading == null ? null : Math.round(nav.heading), wrong ? 1 : 0, nav.offN, nav.touched ? 1 : 0]);
    if (nav.log.length > 120) nav.log.shift();
    if (nav.offN >= NAV.offPts && now - nav.offT >= NAV.offMs) {
      if (!nav.offDeclared && nav.swapAt && now - nav.swapAt < 30000 && nav.rr.n > 0) rrBump();   // 引き直してすぐまた外れた
      nav.offDeclared = true; nav.wrong = wrong;
    } else if (pr.d <= limit && !wrong) nav.offDeclared = false;
    if (!nav.offDeclared && pr.d <= limit && nav.rr.n && now - nav.swapAt > NAV.settleMs) { nav.rr.n = 0; nav.rr.fail = 0; }   // 新しいルートに乗れた
    // 自分の位置：ルートの上にいる間は線の上に点を置き、外れたときだけ実際の位置
    const onRoute = !nav.offDeclared && pr.d <= limit;
    const mark = onRoute ? [pr.lat, pr.lon] : cur;
    if (!followMark) followMark = L.marker(mark, { icon: meIcon(foot), interactive: false, keyboard: false, zIndexOffset: 900 }).addTo(map);
    else followMark.setLatLng(mark);
    if (followMark._foot !== foot) { followMark.setIcon(meIcon(foot)); followMark._foot = foot; }   // 徒歩と車で印を替える
    if (nav.doneLine && onRoute) { const k = nav.cum.findIndex((v) => v > pr.s); nav.doneLine.setLatLngs(rec.coords.slice(0, k < 0 ? rec.coords.length : k).concat([mark])); }
    navView(mark, pr, onRoute);
    if (Date.now() - (nav.roadAt || 0) > 30000) navRoadCheck();
    if (!nav) return;
    const box = $("#navbox"); if (!box) return;
    const nx = box.querySelector(".nav-next"), sub = box.querySelector(".nav-sub");
    const left = Math.max(0, nav.total - nav.lastS);
    const arriveR = foot ? 25 : 40;
    if ((toDest < arriveR && left < 100) || (onRoute && left < 30)) {
      // 2026-11-13 遠藤先生「到着した時の案内も謎。他のマップアプリを参考にしてほしい」：ほかの地図アプリと同じく、到着の札（🏁・行き先・到着時刻・かかった時間）と
      // 「閉じる」だけにし、20秒で自動で閉じる（前は白い枠に白い文字で読めず、使えないボタンが残っていた）
      const tm = new Date(), took = nav.t0 ? Math.max(1, Math.round((Date.now() - nav.t0) / 60000)) : 0;
      box.innerHTML = `<div class="nav-arrived"><div class="na-flag">🏁</div><div class="nav-txt"><div class="nav-next">目的地に到着しました</div><div class="na-name">${esc(rec.to.name || "")}</div>` +
        `<div class="na-meta">${String(tm.getHours()).padStart(2, "0")}:${String(tm.getMinutes()).padStart(2, "0")} 到着${took ? `・${fmtDur(took * 60)}` : ""}</div></div></div><div class="nav-btns"><button id="navstop" class="na-close">閉じる</button></div>`;
      setTimeout(() => { if (!nav && $("#navbox .nav-arrived")) navStop(true); }, 20000);
      sayFlush(); say(`目的地に到着しました。${rec.to.name ? String(rec.to.name).replace(/[（(][^）)]*[）)]/g, "") + "です。" : ""}案内を終了します。`, 4);
      bgPost({ navStop: true });
      const r = nav; nav = null; if (r.watch != null) navigator.geolocation.clearWatch(r.watch); try { r.lock && r.lock.release(); } catch (e) { /* なし */ }
      try { window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bcp && window.webkit.messageHandlers.bcp.postMessage({ keepAwake: false }); } catch (e) { /* なし */ }
      return;
    }
    const rb = $("#navreroute"); if (rb) rb.style.display = nav.offDeclared || nav.rr.slow ? "inline-block" : "none";
    if (acc > NAV.badAcc && !nav.offDeclared) { navMsg("GPSの信号が弱くなっています"); sub.textContent = `GPSの誤差が大きいため（約${Math.round(acc)}m）、ルートから外れたかは判定していません`; return; }
    if (!nav.touched && pr.d > limit && toDest >= NAV.nearDest) { navMsg(`ルートの道まで進んでください（約${Math.round(pr.d)}m）`); sub.textContent = `${rec.to.name}まで ${fmtDist(nav.total)}`; return; }
    if (nav.offDeclared) {
      const w = nav.wrong;
      navMsg(w ? "ルートと反対の方向に進んでいます" : "ルートから外れています");
      if (!navigator.onLine) sub.textContent = `圏外のため引き直せません。オレンジの線に戻ってください（約${Math.round(pr.d)}m）`;
      else if (nav.rr.slow) sub.textContent = "引き直しがうまくいかないため、間をあけて探し直しています。「ルートを引き直す」ですぐ探せます";
      // 2026-11-13 遠藤先生「止まってる間も引き直そうよ」：止まって3秒たったら、向きを決めずに今いる所から引き直す（動き出して向きが合わなければ、もう一度引き直す）
      else if (est.v < NAV.slow) sub.textContent = nav.rr.n ? "止まっている所からのルートです。動き出して向きが違えば、もう一度探します" : "止まっている所から、新しいルートを探します…";
      else sub.textContent = "今の進む向きで、新しいルートを探します…";
      if (!nav.spoken.off) {
        nav.spoken.off = 1;
        sayFlush();   // 古いルートの予告は捨てる
        say(!navigator.onLine ? "ルートを外れました。圏外のため、オレンジの線に戻ってください。" : w ? "ルートと反対の方向に進んでいます。進む向きで、新しいルートを探します。" : (nav.rr.n ? "ルートを外れました。" : "ルートを外れました。新しいルートを探します。"), 3);
      }
      if (est.v < NAV.slow) { if (!nav.slowAt) nav.slowAt = Date.now(); } else { nav.slowAt = 0; nav.stopRr = false; }
      if (navigator.onLine && !nav.rr.manual) {
        if (est.v >= NAV.slow) { if (rrReady(cur)) reroute(la, lo, "", "off"); }
        // 止まって3秒たったら、止まっている間に1回だけ、向きを決めずに今いる所から引き直す（動いた距離は問わない。前の引き直しから3秒はあける）
        else if (!nav.stopRr && !nav.rerouting && nav.slowAt && Date.now() - nav.slowAt >= NAV.stopRrMs && Date.now() - (nav.rr.at || 0) >= NAV.stopRrMs) { nav.stopRr = true; reroute(la, lo, "", "off"); }
      }
      return;
    }
    nav.spoken.off = 0;
    const next = nextReal(nav.lastS + 3);
    const dist = next >= 0 ? Math.max(0, nav.stepAt[next] - nav.lastS) : left;
    navPanel(next, dist, left);
    // 下の帯：行き先・残りの距離・残りの時間・到着予定（ルートの所要時間を残りの割合で）
    const remSec = rec.dur * (left / Math.max(1, nav.total));
    if (acc <= NAV.badAcc) sub.textContent = `${rec.to.name}まで ${fmtDist(left)}・約${fmtDur(remSec)}・到着 ${hhmm(Date.now() + remSec * 1000)}ごろ　（GPSの誤差 約${Math.round(acc)}m）`;
    if (next < 0) return;
    // 声：予告は速さで決めた距離（一般道 約30秒・12秒・4秒前、高速 2km・1km・500m、徒歩 50m・15m）。言う距離は実際の距離を丸めた値
    const g = stepG(rec.steps[next]), ph = navPhases(g, foot);
    let hit = null;
    for (let i = ph.length - 1; i >= 0; i--) { if (dist <= ph[i][1]) { hit = i; break; } }   // いちばん近い段（距離がそれ以下になった中で一番小さい段）
    if (hit != null && !nav.spoken[next + ":" + ph[hit][0]] && est.v >= (foot ? 0.5 : NAV.slow)) {
      for (let i = 0; i <= hit; i++) nav.spoken[next + ":" + ph[i][0]] = 1;   // 遠い段は言ったことにする（言い直さない）
      say(stepPhrase(next, dist, ph[hit][0]), ph[hit][0] === "near" ? 4 : 3);
    } else if (hit == null && !nav.spoken["calm:" + next] && est.v >= NAV.slow && dist > (foot ? 800 : 2000) && nav.lastSaidK !== next) {
      // 次の曲がる所が遠い：しばらく道なり
      nav.spoken["calm:" + next] = 1;
      say(`この先、${window.BCPNavGuide ? window.BCPNavGuide.distSay(dist) : sayDist(dist)}ほど、道なりです。`, 1);
    }
    nav.lastSaidK = next;
  }
  // ---- 案内の文・矢印（navguide.js。2026-11-12 夕 先生「声が機械的・案内が雑」「矢印を使うとか視覚的分かりやすさ」） ----
  const TXT_D = { "左": "left", "右": "right", "斜め左": "slight-left", "斜め右": "slight-right", "大きく左": "sharp-left", "大きく右": "sharp-right" };
  function stepG(st) {   // 段の動作（古く保存したルートは文から見当を付ける）
    if (st && st[3]) return st[3];
    const t = String((st && st[0]) || ""), mm = t.match(/^(.*?)(?:へ)?(?:（(.+)）)?$/), dir = (mm && mm[1]) || t, road = (mm && mm[2]) || "";
    if (/到着/.test(dir)) return { a: "arrive" };
    if (/Uターン/.test(dir)) return { a: "uturn" };
    if (/ロータリー/.test(dir)) return { a: "round", road };
    if (/合流/.test(dir)) return { a: "merge", road };
    if (TXT_D[dir]) return { a: "turn", d: TXT_D[dir], road };
    return { a: "straight", d: "straight", road, quiet: /^進む/.test(dir) ? 1 : 0 };
  }
  const realStep = (rec, i) => i > 0 && !stepG(rec.steps[i]).quiet;
  function nextReal(after) { return nav.stepAt.findIndex((sv, i) => realStep(nav.rec, i) && sv > after); }
  // 今いる道の名前（直前の曲がる所で入った道）
  function curRoadAt(k) { for (let i = k - 1; i >= 0; i--) { const g = stepG(nav.rec.steps[i]); if (g.road) return g.road; } return ""; }
  // 声の文：k 番目の曲がる所まで d m、段 phase
  function stepPhrase(k, d, phase) {
    const NG = window.BCPNavGuide, rec = nav.rec, foot = rec.mode === "foot", g = stepG(rec.steps[k]);
    const k2 = nav.stepAt.findIndex((sv, i) => i > k && realStep(rec, i));
    const g2 = k2 >= 0 ? stepG(rec.steps[k2]) : (g.a === "arrive" ? null : { a: "arrive" });
    const gap = k2 >= 0 ? nav.stepAt[k2] - nav.stepAt[k] : nav.total - nav.stepAt[k];
    if (!NG) return d < 40 ? `まもなく、${sayTurn(rec.steps[k][0])}` : `${sayDist(d)}先を、${sayTurn(rec.steps[k][0])}`;
    return NG.phrase(g, d, phase, g2, gap, curRoadAt(k), foot);
  }
  function navPhases(g, foot) { const NG = window.BCPNavGuide, v = (nav.est && nav.est.v) || (foot ? 1.25 : nav.rec.dist / Math.max(1, nav.rec.dur)); return NG ? NG.marks(v, !!g.hw || onHighway(), foot) : (foot ? [["far", 50], ["near", 15]] : [["far", 300], ["mid", 100], ["near", 30]]); }
  // 画面の案内の欄（矢印・距離・交差点名/道路名・方面・その先・到着予定）
  function navPanel(k, d, left) {
    const NG = window.BCPNavGuide, box = $("#navbox"); if (!box || !NG) return;
    const rec = nav.rec, foot = rec.mode === "foot", g = k >= 0 ? stepG(rec.steps[k]) : { a: "arrive" };
    const k2 = k >= 0 ? nav.stepAt.findIndex((sv, i) => i > k && realStep(rec, i)) : -1;
    const g2 = k2 >= 0 ? stepG(rec.steps[k2]) : (k >= 0 && g.a !== "arrive" ? { a: "arrive" } : null);
    const gap = k2 >= 0 ? nav.stepAt[k2] - nav.stepAt[k] : (k >= 0 ? nav.total - nav.stepAt[k] : null);
    const near = d <= (foot ? 30 : 100);
    const main = box.querySelector(".nav-main"); if (main) { main.classList.toggle("near", near); main.classList.remove("nmsg"); }
    const ar = box.querySelector(".nav-arrow"); if (ar) { const sv = NG.arrowSvg(g, 64); if (ar.dataset.k !== sv) { ar.innerHTML = sv; ar.dataset.k = sv; } }
    box.querySelector(".nav-next").innerHTML = `<span class="nav-d">${esc(fmtDist(d < 1000 ? Math.round(d / 10) * 10 : d))}</span><span class="nav-sen">先</span><span class="nav-act">${esc(NG.actText(g))}</span>`;
    const nm = box.querySelector(".nav-name"); if (nm) nm.textContent = [g.jn, g.road && g.road !== curRoadAt(k) ? "→ " + g.road : g.road].filter(Boolean).join(" ");
    const to = box.querySelector(".nav-to"); if (to) to.textContent = g.to ? `${g.to}方面` : "";
    const th = box.querySelector(".nav-then");
    if (th) { const show = g2 && gap != null && gap <= (foot ? 60 : 300); th.hidden = !show; if (show) th.innerHTML = `その先 ${NG.arrowSvg(g2, 22)} ${esc(NG.actText(g2))}${gap > 30 ? `（${esc(fmtDist(Math.round(gap / 10) * 10))}）` : ""}`; }
    // 地図の上の曲がる所を強調（曲がる前後の線を青で）
    if (nav.turnK !== k && routeLayer) {
      nav.turnK = k; if (nav.turnLine) { try { routeLayer.removeLayer(nav.turnLine); } catch (e) { /* なし */ } nav.turnLine = null; }
      if (k >= 0 && g.a !== "arrive") {
        const s0 = nav.stepAt[k] - 35, s1 = nav.stepAt[k] + 45, seg = [];
        for (let i = 0; i < rec.coords.length; i++) if (nav.cum[i] >= s0 && nav.cum[i] <= s1) seg.push(rec.coords[i]);
        if (seg.length >= 2) nav.turnLine = L.polyline(seg, { color: "#1864ab", weight: 9, opacity: 0.95, interactive: false, className: "route-turn" }).addTo(routeLayer);
      }
    }
  }
  function navMsg(t) {   // 案内の欄を知らせの文にする（外れた・GPS が弱い・ルートの道まで など）
    const box = $("#navbox"); if (!box) return;
    box.querySelector(".nav-next").textContent = t;
    const main = box.querySelector(".nav-main"); if (main) { main.classList.add("nmsg"); main.classList.remove("near"); }
    const ar = box.querySelector(".nav-arrow"); if (ar) { ar.innerHTML = '<span class="nav-warn">!</span>'; ar.dataset.k = ""; }
    ["nav-name", "nav-to"].forEach((c) => { const e = box.querySelector("." + c); if (e) e.textContent = ""; });
    const th = box.querySelector(".nav-then"); if (th) th.hidden = true;
  }
  // 裏でも続く道案内（2026-11-12 夕）：iPhone アプリへルートと案内の文（距離の前置きなし）を渡す。裏にいる間は Swift が同じ決まりで判定して話す
  function bgPost(m) { try { if (window.__BCP_BG_NAV && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bcp) window.webkit.messageHandlers.bcp.postMessage(m); } catch (e) { /* なし */ } }
  function bgPayload() {
    const rec = nav.rec, foot = rec.mode === "foot", steps = [];
    nav.stepAt.forEach((sv, i) => {
      if (!realStep(rec, i)) return;
      const ph = stepPhrase(i, 500, "far");   // 「500メートル先、…。」から前置きと句点を外す
      const g = stepG(rec.steps[i]);
      steps.push({ s: Math.round(sv * 10) / 10, b: ph.replace(/^[^、]*、/, "").replace(/。$/, ""), hw: !!g.hw, a: g.a === "arrive" });
    });
    return { coords: rec.coords, to: [rec.to.lat, rec.to.lon], foot, dur: rec.dur || 0, steps };
  }
  const hhmm = (ms) => { const d = new Date(ms); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };
  // 引き直してよいか：同時に1本だけ・間隔 8→15→30 秒・前回から少しは動いた
  function rrReady(cur) {
    const r = nav.rr; if (nav.rerouting || r.manual) return false;
    if (r.at && Date.now() - r.at < (r.slow ? NAV.rrSlowMs : NAV.rrGaps[Math.min(Math.max(0, r.n - 1), NAV.rrGaps.length - 1)])) return false;
    if (r.pos && dm(r.pos, cur) < (nav.rec.mode === "foot" ? NAV.rrMoveFoot : NAV.rrMoveCar)) return false;
    return true;
  }
  // 引いたルートの始まりの検算：最初の60mの向きが進む向きと100度以上違う、または300m以内に Uターン → 使わない
  function rrStartOk(rt, hd) {
    if (hd == null) return { ok: true };
    const cum = cumOf(rt);
    let k = cum.findIndex((v) => v >= 50); if (k < 1) k = rt.coords.length - 1;
    if (k > 0 && angDiff(hd, brgOf(rt.coords[0], rt.coords[k])) > 100) return { ok: false, why: "back" };
    let sAcc = 0;
    for (const st of rt.steps) { if (sAcc > 300) break; if (/Uターン/.test(st[0])) return { ok: false, why: "uturn" }; sAcc += st[1] || 0; }
    return { ok: true };
  }
  // うまくいかなかった回数を数え、3回で自動の引き直しをやめる（手で「ルートを引き直す」）
  // 2026-11-13 遠藤先生「使い勝手悪すぎる」：3回うまくいかなくても自動の引き直しはやめない。間を45秒にあけ、向きの縛りを外して探し続ける。
  // 「ルートを引き直す」は外れている間いつも出す（押せばすぐ探す）
  function rrBump() {
    nav.rr.fail++;
    if (nav.rr.fail >= NAV.rrMaxFail && !nav.rr.slow) { nav.rr.slow = true; navNote("引き直しがうまくいかないため、間をあけて探し直しています（「ルートを引き直す」ですぐ探せます）"); }
    return false;
  }
  function rrFail(msg) {
    if (!nav) return;
    nav.rerouting = false;
    if (rrBump()) return;
    navNote(msg);
    if (!nav.spoken["rrfail:" + msg]) { nav.spoken["rrfail:" + msg] = 1; say(msg, 3); }
  }
  async function reroute(la, lo, msg, why) {
    if (!nav || nav.rerouting) return;
    const rec = nav.rec, foot = rec.mode === "foot", gen = nav.gen, est = nav.est || { v: 0 };
    const hd = !foot && nav.heading != null && est.v >= NAV.slow && (nav.rr.fail || 0) < 2 ? Math.round(nav.heading) : null;   // 2回うまくいかなければ向きを決めずに探す
    nav.rerouting = true; nav.rr.at = Date.now(); nav.rr.pos = [la, lo]; nav.rr.n++;
    try {
      // 出発点：検索の間に進む分を見込み、進む向きに 速さ×3秒 先（最大60m）
      const lead0 = hd == null ? 0 : Math.min(60, est.v * NAV.lead);
      const from = (lead, tol) => { if (hd == null) return { name: "現在地", lat: la, lon: lo }; const q = aheadOf([la, lo], hd, lead0 + lead); return { name: "現在地", lat: q[0], lon: q[1], hd, hdTol: tol }; };
      let f = await findRoute(from(0, 45), rec.to, rec.mode, rec.opt || "");
      let ok = rrStartOk(f.rt, hd), uturn = false, leadUsed = lead0;
      if (!ok.ok) {   // Uターン始まり：進む向きに60m先から、向きの幅を狭めてもう一度
        const f2 = await findRoute(from(60, 30), rec.to, rec.mode, rec.opt || "");
        const ok2 = rrStartOk(f2.rt, hd);
        if (ok2.ok) { f = f2; ok = ok2; leadUsed = lead0 + 60; }
        else if (!onHighway()) { f = f2; uturn = true; leadUsed = 0; }   // 2回とも Uターンしか無い（行き止まり・長い一本道）：引き返す案内にする。高速の上では使わない
        else { rrFail("この先の出口・分岐まで、このまま進んでください"); return; }
      }
      if (!nav || nav.gen !== gen) { if (nav) nav.rerouting = false; return; }
      // 答えを待つ間に元の道（同じ向き）に戻っていたら、新しいルートは捨てる
      if (why === "off" && !nav.offDeclared) { nav.rerouting = false; nav.rr.n = Math.max(0, nav.rr.n - 1); return; }
      // 今の位置が新しいルートの最初の200mの線から30m（＋誤差）以内で、向きも合うときだけ使う
      const cp = nav.lastPos || [la, lo];
      let rt = f.rt;
      if (leadUsed > 15) {   // 先へずらして引いた：今の位置から新しいルートの始まりまでを（進む向きの道として）つなぐ
        const add = dm(cp, rt.coords[0]);
        rt = Object.assign({}, rt, { coords: [[r5(cp[0]), r5(cp[1])]].concat(rt.coords), dist: rt.dist + add });
      }
      const nc = cumOf(rt), q = project(rt, nc, cp[0], cp[1], 0, 200);
      if (q.d > NAV.accept + Math.min(30, (nav.lastAcc || 0)) || (!uturn && hd != null && nav.heading != null && angDiff(nav.heading, q.brg) > 100)) { rrFail("新しいルートが今いる所と合いません。このまま進んでください"); return; }
      const nr = Object.assign({}, rec, { from: { name: "現在地", lat: la, lon: lo }, fb: f.fallback ? 1 : 0 }, rt);
      nav.rerouting = false;
      navUse(nr);
      showRoute(nr, null, true);   // 地図の位置・ズーム・向きはそのまま
      bgPost({ navRoute: bgPayload() });
      nav.touched = true; nav.lastS = Math.max(0, q.s);
      navNote(f.none ? "⛔ 通行止めを避けるルートが見つかりませんでした。現地の案内に従ってください" : (f.avoided ? "✅ 通行止めを避けたルートに切り替えました" : (uturn ? "↩ この先、安全な所で引き返してください" : "")));
      // 声：開始の口上は言わない。「ルートを変更しました」＋次の指示だけ
      const k = nextReal(nav.lastS + 3), d = k >= 0 ? nav.stepAt[k] - nav.lastS : 0;
      const nextSay = uturn ? "この先、安全な所で、引き返してください。" : k >= 0 ? stepPhrase(k, d, d < 40 ? "near" : "far") : "";
      if (k >= 0 && !uturn) navPhases(stepG(nr.steps[k]), foot).forEach(([n, m]) => { if (d <= m * 1.3) nav.spoken[k + ":" + n] = 1; });
      sayFlush();
      // 引き直しでは所要時間・行き先を言わない（2026-11-12 先生「再検索の度にかかる時間や目的地の案内をする必要はない」）。2回目以降は次の指示だけ
      say(f.none ? "通行止めを避けるルートが見つかりません。現地の案内に従ってください。" : `${msg || (nav.rr.n > 1 && nextSay ? "" : "ルートを変更しました。")}${nextSay}`, 3);
    } catch (e) {
      rrFail(navigator.onLine ? "経路検索につながりません。このまま進むか、オレンジの線に戻ってください" : "圏外のため引き直せません。オレンジの線に戻ってください");
    }
  }

  // ---------- 通行止め・交通規制（2026-11-11 遠藤先生「道の途中に通行止めや交通規制があるならその情報が欲しいし、回避ルートも表示できるように」） ----------
  // データは Mac の roads.py が集めて bundle.json（暗号化）に入れる。原文は載せず、区分・路線名・区間・原因だけを持ち、出典はトップページへのリンク。
  // 圏外のときは、端末に保存した最後のデータ（○時点）で判定する
  const ROAD_NEAR = 50;   // 経路からこの距離（m）以内で、向きが経路に沿うものを「経路の上」とみる（交わるだけの道は数えない）
  const ROAD_SRC = {
    mlit: ["国土交通省 道路情報提供システム", "https://www.road-info-prvs.mlit.go.jp/roadinfo/"],
    nexco: ["NEXCO（iHighway）", "https://ihighway.jp/"],
    tokyo: ["東京都建設局", "https://www.kensetsu-road.metro.tokyo.lg.jp/latest_traffic_restrictions.pdf"],
    city: ["市町村のお知らせ", ""],
  };
  const POLICE = "https://www.keishicho.metro.tokyo.lg.jp/kurashi/saigai/shinsai_kisei/kisei/kisei_1.html";
  let ER = null;   // 大地震のときの緊急自動車専用路の線（emergency_roads.json。警視庁の路線を OSM の道の形で）
  async function loadER() { if (ER) return ER; try { const r = await fetch("emergency_roads.json"); if (!r.ok) throw new Error(r.status); ER = await r.json(); } catch (e) { return { lines: [] }; } return ER; }   // 取れなかったときは覚えない（次に取り直す）
  function roadsD() { return (B && B.roads) || null; }
  function quakeOn() { const r = roadsD(); return !!(r && r.quake); }
  function roadLabel(it) { return [it.road, it.sec].filter(Boolean).join("　") || it.kind; }
  function roadWhen() {
    const r = roadsD();
    if (!r) return "通行止めの情報はまだありません";
    return `${hm(r.at)}時点の情報${navigator.onLine ? "" : "（圏外のため、最後に取った情報）"}`;
  }
  function roadPop(it) {
    const s = ROAD_SRC[it.src] || ["", ""];
    return `<b>${esc(it.kind)}</b>${it.road || it.sec ? `<br>${esc(roadLabel(it))}` : ""}${it.dir ? `<br>${esc(it.dir)}` : ""}${it.cause ? `<br>原因：${esc(it.cause)}` : ""}${it.since ? `<br>開始：${esc(String(it.since).replace("T", " "))}` : ""}${it.hours ? `<br>時間：${esc(it.hours)}` : ""}` +
      `<br><small>${esc(roadWhen())}。出典：${link(it.link || s[1], s[0])}をもとに作成</small>`;
  }
  // 経路の形を平面に直して、近さ・向き・出発からの道のりを測る
  function prepRoute(coords) {
    const lat0 = coords[0][0], P = coords.map(([la, lo]) => xy(la, lo, lat0)), cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    let s = 90, w = 180, n = -90, e = -180;
    coords.forEach(([la, lo]) => { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); });
    return { lat0, P, cum, box: [s - 0.001, w - 0.0013, n + 0.001, e + 0.0013] };
  }
  const inBox = (b, la, lo) => la >= b[0] && la <= b[2] && lo >= b[1] && lo <= b[3];
  function nearRoute(R, p) {
    let best = { d: Infinity, s: 0, ang: 0 };
    for (let i = 0; i < R.P.length - 1; i++) {
      const a = R.P[i], b = R.P[i + 1], vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
      const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2)) : 0;
      const d = Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
      if (d < best.d) best = { d, s: R.cum[i] + t * Math.sqrt(L2), ang: Math.atan2(vy, vx) };
    }
    return best;
  }
  // 線（通行止めの区間）が経路に沿って重なるか。20mごとに調べ、50m以内で向きがそろう所が2つ以上（短い線は1つ）なら重なる。戻り値は出発からの道のり（m）、重ならなければ -1
  function lineOnRoute(R, line) { const o = lineOverlap(R, line); return o ? o.s0 : -1; }
  // 重なりの詳しい形：s0＝出発からの道のり、len＝重なる長さ、mid＝出発・到着の近く（END_NEAR）を除いた長さ、pts＝除外に使う線の上の点（出発・到着の近くは除く）
  const END_NEAR = 400;
  function lineOverlap(R, line) {
    if (!line.some(([la, lo]) => inBox(R.box, la, lo))) return null;
    const pts = line.map(([la, lo]) => xy(la, lo, R.lat0)), tot = R.cum[R.cum.length - 1];
    let hits = 0, samples = 0, s0 = Infinity, len = 0, mid = 0;
    const out = [], ss = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 20)), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, xq = a[0] + t * (b[0] - a[0]), yq = a[1] + t * (b[1] - a[1]), q = nearRoute(R, [xq, yq]);
        samples++;
        if (q.d > ROAD_NEAR) continue;
        let da = Math.abs(ang - q.ang) % Math.PI; da = Math.min(da, Math.PI - da);
        if (da < 0.6) {
          hits++; s0 = Math.min(s0, q.s); len += L / n; ss.push(q.s);
          if (q.s > END_NEAR && q.s < tot - END_NEAR) { mid += L / n; out.push([q.s, unxy(xq, yq, R.lat0)]); }
        }
      }
    }
    return hits >= Math.min(2, samples) ? { s0, len, mid, pts: out, ss } : null;
  }
  const unxy = (x, y, lat0) => [r5(y / R_EARTH * 180 / Math.PI), r5(x / (R_EARTH * Math.cos(lat0 * Math.PI / 180)) * 180 / Math.PI)];
  // 経路の判定：block＝経路の上の通行止め／caution＝経路の近くの規制／text＝通る高速道路の通行止め（区間は文字だけ）／quake＝大地震の緊急自動車専用路
  function roadCheck(rec, R) {
    const out = { block: [], caution: [], text: [], quake: [] };
    if (!rec || !rec.coords || rec.coords.length < 2) return out;
    R = R || prepRoute(rec.coords);
    const car = rec.mode === "car", r = roadsD();
    ((r && r.items) || []).forEach((it) => {
      const lines = it.lines || [];
      if (lines.length || it.pt) {
        let s = -1, pts = [];
        if (lines.length) lines.forEach((ln) => { const o = lineOverlap(R, ln); if (o && (s < 0 || o.s0 < s)) s = o.s0; if (o) pts = pts.concat(o.pts); });
        else if (inBox(R.box, it.pt[0], it.pt[1])) { const q = nearRoute(R, xy(it.pt[0], it.pt[1], R.lat0)); if (q.d <= ROAD_NEAR) { s = q.s; pts = [[q.s, it.pt]]; } }
        if (s < 0) return;
        (it.block ? out.block : out.caution).push({ it, s, pts });
      } else if (car && it.osm && (rec.roads || []).some((n) => String(n).includes(it.osm))) out.text.push({ it, s: 0 });
    });
    if (car && (quakeOn() || rec.opt === "safe") && ER) {
      const seen = {};
      ER.lines.forEach((l) => {
        if (rec.hw === false && l.g === ER_HW) return;
        const o = lineOverlap(R, l.c); if (!o) return;
        const h = seen[l.g] || (seen[l.g] = { g: l.g, s: o.s0, len: 0, mid: 0, pts: [], ss: [] });
        h.s = Math.min(h.s, o.s0); h.pts = h.pts.concat(o.pts); h.ss = h.ss.concat(o.ss);
      });
      // 長さは経路の道のりの位置（20mごと）で数える（上り・下りの車線が別の線でも二重に数えない）
      const span = (a) => new Set(a.map((v) => Math.floor(v / 20))).size * 20;
      Object.values(seen).forEach((h) => { h.len = span(h.ss); h.mid = span(h.pts.map((x) => x[0])); delete h.ss; out.quake.push(h); });
    }
    ["block", "caution", "quake"].forEach((k) => out[k].sort((a, b) => a.s - b.s));
    return out;
  }
  const blocked = (c) => c.block.length > 0 || c.quake.length > 0;
  const ER_HW = "高速道路・首都高速";
  const needER = (rec) => quakeOn() || (rec && rec.mode === "car" && rec.opt === "safe");
  const hid = (h) => (h.it ? h.it.id : "q:" + h.g);
  window.__bcpRoads = { check: (rec) => roadCheck(rec), quakeOn: () => quakeOn() };   // 試験用
  window.__bcpMapPt = (la, lo) => { const q = map.latLngToContainerPoint([la, lo]); return [q.x, q.y]; };   // 試験用
  window.__bcpNav = () => (nav ? { on: 1, rr: nav.rr, off: !!nav.offDeclared, wrong: !!nav.wrong, s: nav.lastS, gen: nav.gen, log: (nav.log || []).slice(-14), first: nav.rec.coords[0], c1: nav.rec.coords[Math.min(3, nav.rec.coords.length - 1)], manual: nav.rr.manual, note: ($("#navroad") || {}).textContent || "", heading: nav.heading, rot: nav.rot, zt: nav.zt,
    bearing: map && map.getBearing ? map.getBearing() : 0, mark: followMark ? [followMark.getLatLng().lat, followMark.getLatLng().lng] : null, zoom: map ? map.getZoom() : 0 } : { on: 0 });   // 試験用
  // 経路検索（OSRM）。alternatives は2点のときだけ使える
  // FOSSGIS の経路検索の決まり：1秒に1回まで（OSRM・Valhalla とも。https://www.fossgis.de/arbeitsgruppen/osm-server/nutzungsbedingungen/ ）
  let fossAt = 0;
  function fossWait() { const t = Math.max(Date.now(), fossAt + 1100); fossAt = t; return new Promise((r) => setTimeout(r, t - Date.now())); }
  // 出発点に進む向き（hd）があれば bearings（向き,幅）・radiuses（出発点は40m以内の道）・continue_straight を付ける（引き直しで Uターンのルートを引かない）
  const osrmUrl = (mode, pts, alt) => `https://routing.openstreetmap.de/routed-${mode}/route/v1/driving/${pts.map((p) => `${p.lon},${p.lat}`).join(";")}?overview=full&geometries=geojson&steps=true${alt ? "&alternatives=3" : ""}` +
    (pts[0] && pts[0].hd != null ? `&bearings=${pts.map((p, i) => (i === 0 ? `${p.hd},${p.hdTol || 45}` : "")).join(";")}&radiuses=${pts.map((p, i) => (i === 0 ? "40" : "unlimited")).join(";")}&continue_straight=true` : "");
  // 経路検索は1回12秒で打ち切る（つながらない・遅いときに道案内を待たせない）
  async function fetchT(url) {
    const ac = window.AbortController ? new AbortController() : null, tm = ac ? setTimeout(() => ac.abort(), NAV.fetchMs) : 0;
    try { return await fetch(url, ac ? { signal: ac.signal } : undefined); } finally { clearTimeout(tm); }
  }
  const r5 = (v) => Math.round(v * 1e5) / 1e5;
  function toRoute(r0, mode) {
    const legs = r0.legs || [], steps = [], NG = window.BCPNavGuide;
    let pg = null;
    legs.forEach((lg, li) => (lg.steps || []).forEach((st) => {
      const ty = (st.maneuver || {}).type;
      if (ty === "arrive" && li < legs.length - 1) return;                      // 途中の経由地は「到着」にしない
      const text = ty === "depart" && li > 0 ? `進む${st.name ? `（${st.name}）` : ""}` : stepText(st);
      // 動作（案内の矢印・文の元。2026-11-12 夕）：交差点名・道路名・方面・目的地の左右など
      let g = NG ? NG.fromOsrm(st, pg, ty === "arrive" && li === legs.length - 1) : null;
      if (g && ty === "depart" && li > 0) g = Object.assign(g, { a: "straight", quiet: 1 });
      steps.push([text, Math.round(st.distance), [r5(st.maneuver.location[1]), r5(st.maneuver.location[0])], g]);
      if (g) pg = g;
    }));
    if (NG && NG.fixRamps) NG.fixRamps(steps.map((x) => x[3]));   // 高速の入口・出口・乗り継ぎを前後の道で決め直す（navguide.js）
    const roads = [...new Set(legs.flatMap((lg) => (lg.steps || []).flatMap((st) => [st.name, st.ref])).filter(Boolean))].slice(0, 80);
    const rt = { mode, dist: r0.distance, dur: r0.duration, coords: r0.geometry.coordinates.map(([lo, la]) => [r5(la), r5(lo)]), steps, roads };
    if (mode === "car") {   // FOSSGIS の OSRM は有料の印（classes）を返さないので、道の名前・番号から見当を付ける
      const tl = {};
      legs.forEach((lg) => (lg.steps || []).forEach((st) => { if (isTollName(st.name, st.ref)) { const n = st.name || st.ref; tl[n] = (tl[n] || 0) + st.distance; } }));
      rt.tolls = Object.entries(tl).map(([n, m]) => [n, Math.round(m)]).filter((x) => x[1] >= 100);
      rt.toll = rt.tolls.length > 0; rt.tollGuess = 1;
      if (!rt.toll) rt.hw = false;   // 高速道路の名前が無い経路では、高架の下の一般道を「高速道路・首都高速」と数えない
    }
    return rt;
  }
  const TOLL_RE = /自動車道|高速|首都|圏央|外環|有料|ハイウェイ|スカイライン|アクアライン|ベイブリッジ|湾岸線|横羽線|狩場線|ターンパイク/;
  const isTollName = (n, ref) => TOLL_RE.test(n || "") || /^(E\d|C[1-4]$|CA$)/.test(ref || "");

  // ---------- Valhalla（FOSSGIS。有料道路を使わない・災害時の規制路を避ける） ----------
  const VALHALLA = "https://valhalla1.openstreetmap.de/route";
  const VTURN = { 8: "まっすぐ", 9: "斜め右", 10: "右", 11: "大きく右", 12: "Uターン", 13: "Uターン", 14: "大きく左", 15: "左", 16: "斜め左", 17: "まっすぐ", 18: "右", 19: "左", 20: "右", 21: "左", 22: "まっすぐ", 23: "右", 24: "左", 37: "右", 38: "左" };
  function decode6(str) {
    const out = []; let i = 0, la = 0, lo = 0;
    while (i < str.length) {
      for (let k = 0; k < 2; k++) {
        let sh = 0, r = 0, b;
        do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32 && i < str.length);
        const d = r & 1 ? ~(r >> 1) : r >> 1;
        if (k) lo += d; else la += d;
      }
      out.push([r5(la / 1e6), r5(lo / 1e6)]);
    }
    return out;
  }
  const vName = (m) => ((m.street_names || []).find((n) => /[\u3040-\u30ff\u4e00-\u9fff]/.test(n)) || "");
  function vStep(m, last) {
    const ty = m.type, nm = vName(m), road = nm ? `（${nm}）` : "";
    if (ty >= 1 && ty <= 3) return `出発${road}`;
    if (ty >= 4 && ty <= 6) return last ? "到着" : `進む${road}`;
    if (ty === 26 || ty === 27) return `ロータリーを進む${road}`;
    if (ty === 25) return `合流${road}`;
    if (ty === 28 || ty === 29) return `フェリー${road}`;
    const d = VTURN[ty];
    return d && d !== "まっすぐ" ? `${d}へ${road}` : `進む${road}`;
  }
  function toRouteV(trip, opt) {
    const coords = [], steps = [], names = new Set(), tl = {};
    let vPrev = null;
    const legs = trip.legs || [];
    legs.forEach((lg, li) => {
      const sh = decode6(lg.shape || ""), off = coords.length ? coords.length - 1 : 0;
      sh.forEach((c, k) => { if (!(k === 0 && coords.length)) coords.push(c); });
      (lg.maneuvers || []).forEach((m, mi) => {
        const isArr = m.type >= 4 && m.type <= 6, last = li === legs.length - 1;
        if (isArr && !last) return;
        const at = coords[Math.min(coords.length - 1, off + (m.begin_shape_index || 0))];
        const g = window.BCPNavGuide ? window.BCPNavGuide.fromValhalla(m, vPrev, isArr && last) : null;
        if (g) vPrev = g;
        steps.push([vStep(m, last), Math.round((m.length || 0) * 1000), at, g]);
        (m.street_names || []).forEach((n) => names.add(n));
        if (m.toll) { const n = vName(m) || "有料道路"; tl[n] = (tl[n] || 0) + (m.length || 0) * 1000; }
      });
    });
    if (window.BCPNavGuide && window.BCPNavGuide.fixRamps) window.BCPNavGuide.fixRamps(steps.map((x) => x[3]));
    const sm = trip.summary || {};
    return { mode: "car", opt, eng: "valhalla", dist: (sm.length || 0) * 1000, dur: sm.time || 0, coords, steps, roads: [...names].slice(0, 80),
      toll: !!sm.has_toll, hw: !!sm.has_highway, tolls: Object.entries(tl).map(([n, m]) => [n, Math.round(m)]) };
  }
  async function valhalla(pts, opt, excl, alt) {
    const q = { locations: pts.map((p) => Object.assign({ lat: r5(p.lat), lon: r5(p.lon) }, p.hd != null ? { heading: p.hd, heading_tolerance: p.hdTol || 45, radius: 40 } : {})), costing: "auto",
      costing_options: { auto: opt === "safe" ? { use_tolls: 0, use_highways: 0 } : { use_tolls: 0 } },
      directions_options: { language: "ja-JP", units: "kilometers" } };
    if (alt) q.alternates = 2;
    if (excl && excl.length) q.exclude_locations = excl;
    await fossWait();
    const r = await fetchT(`${VALHALLA}?json=${encodeURIComponent(JSON.stringify(q))}`);
    const d = await r.json();
    if (!d.trip) throw new Error(d.error || ("経路検索 " + r.status));
    return [d.trip].concat((d.alternates || []).map((a) => a.trip)).map((t) => toRouteV(t, opt));
  }
  // 避けたい道に掛かる度合い：通行止めは必ず避ける（1件100km分の重み）、規制路は出発・到着の近くを除いた長さ
  const vScore = (c) => c.block.length * 1e5 + c.quake.reduce((a, h) => a + (h.mid || 0), 0);
  // 除外する点（線の上の点を約120mごとに。1回の問い合わせで50か所まで＝FOSSGIS の Valhalla の上限）
  const VEXCL_MAX = 50;
  function exclFor(chk, have) {
    const near = (a, b) => Math.abs(a[0] - b[0]) < 0.0004 && Math.abs(a[1] - b[1]) < 0.0004;
    const pick = (pts, gap) => { const o = []; let last = -1e9; pts.slice().sort((a, b) => a[0] - b[0]).forEach(([sv, p]) => { if (sv - last >= gap) { o.push(p); last = sv; } }); return o; };
    const cls = (g) => (g === ER_HW ? "motorway" : /^国道/.test(g) ? "trunk" : "tertiary");
    let add = [];
    chk.block.forEach((h) => pick(h.pts, 60).forEach((p) => add.push({ lat: p[0], lon: p[1] })));
    chk.quake.forEach((h) => pick(h.pts, 120).forEach((p) => add.push({ lat: p[0], lon: p[1], search_filter: { min_road_class: cls(h.g) } })));
    add = add.filter((x) => !have.some((y) => near([x.lat, x.lon], [y.lat, y.lon])));
    const room = VEXCL_MAX - have.length;
    if (add.length > room) { const st = add.length / room; add = Array.from({ length: room }, (_, i) => add[Math.floor(i * st)]); }
    return add;
  }
  // 有料道路を使わない／災害時の規制路を避ける：①Valhalla（別ルート2つも）②掛かる道の上に除外の点を置いて引き直す（2回まで）③いちばん掛からないものを選ぶ。避けきれなければ、そう返す
  async function findValhalla(from, to, opt) {
    if (needER({ mode: "car", opt })) await loadER();
    const all = (await valhalla([from, to], opt, null, true)).map((rt) => ({ rt, chk: roadCheck(rt) }));
    const best = () => all.slice().sort((a, b) => vScore(a.chk) - vScore(b.chk) || a.rt.dur - b.rt.dur)[0];
    const excl = [];
    let last = best();
    for (let k = 0; k < 2 && vScore(best().chk) > 0 && excl.length < VEXCL_MAX; k++) {
      const add = exclFor(last.chk, excl);
      if (!add.length) break;
      excl.push(...add);
      try { const rt = (await valhalla([from, to], opt, excl, false))[0]; last = { rt, chk: roadCheck(rt), ex: excl.length }; all.push(last); } catch (e) { break; }
    }
    const b = best(), first = all[0], sc = vScore(b.chk);
    const f = { rt: b.rt, chk: b.chk, v: 1, opt, excl: b.ex || 0 };
    if (b !== first && vScore(first.chk) > 0) Object.assign(f, { avoided: first.chk, skipped: first.rt.coords, via: !!b.ex });
    if (sc > 0) f.none = true;
    return f;
  }
  async function osrm(mode, pts, alt) {
    await fossWait();
    const d = await (await fetchT(osrmUrl(mode, pts, alt))).json();
    if (d.code === "NoSegment" && pts[0] && pts[0].hd != null) return osrm(mode, [Object.assign({}, pts[0], { hd: null })].concat(pts.slice(1)), alt);   // 向きに合う道が無い：向きなしで1回だけ
    if (d.code !== "Ok" || !d.routes || !d.routes[0]) throw new Error(d.message || d.code);
    return d.routes.map((r) => toRoute(r, mode));
  }
  // 通行止めの手前の所で、経路の左右へずらした経由地（車 1.5km・3.5km／徒歩 0.4km・1km）
  function detourVias(rt, s, mode) {
    const R = prepRoute(rt.coords);
    let i = R.cum.findIndex((c) => c >= s); if (i < 1) i = 1;
    const a = R.P[i - 1], b = R.P[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, t = Math.max(0, Math.min(1, (s - R.cum[i - 1]) / L));
    const p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
    const back = (x, y) => ({ lat: y / R_EARTH * 180 / Math.PI, lon: x / (R_EARTH * Math.cos(R.lat0 * Math.PI / 180)) * 180 / Math.PI });
    return (mode === "car" ? [1500, -1500, 3500, -3500] : [400, -400, 1000, -1000]).map((o) => back(p[0] + nx * o, p[1] + ny * o));
  }
  // 通行止めに掛からないルートを探す：①いちばん早いルート ②別ルート（alternatives）③経由地を置いて引き直す（最大4回）④見つからなければ、そう返す
  async function findRoute(from, to, mode, opt) {
    if (mode === "car" && (opt === "free" || opt === "safe")) {
      try { return await findValhalla(from, to, opt); }
      catch (e) { const f = await findOsrm(from, to, mode); f.rt.opt = opt; f.rt.eng = "osrm"; f.fallback = String(e.message || e); return f; }   // Valhalla につながらないときは、ふつうの経路検索で（そう書く）
    }
    const f = await findOsrm(from, to, mode);
    if (mode === "car") f.rt.opt = "toll";
    return f;
  }
  async function findOsrm(from, to, mode) {
    if (quakeOn()) await loadER();
    const cands = await osrm(mode, [from, to], true);
    const chks = cands.map((c) => roadCheck(c));
    if (!blocked(chks[0])) return { rt: cands[0], chk: chks[0] };
    const i = chks.findIndex((c) => !blocked(c));
    if (i > 0) return { rt: cands[i], chk: chks[i], avoided: chks[0], skipped: cands[0].coords };
    const first = chks[0].block[0] || chks[0].quake[0];
    let best = null;
    for (const v of detourVias(cands[0], Math.max(0, first.s - 200), mode)) {
      try {
        const c = (await osrm(mode, [from, v, to], false))[0], k = roadCheck(c);
        if (!blocked(k) && (!best || c.dur < best.rt.dur)) best = { rt: c, chk: k };
      } catch (e) { /* 次の経由地へ */ }
    }
    if (best) return Object.assign(best, { avoided: chks[0], skipped: cands[0].coords, via: true });
    return { rt: cands[0], chk: chks[0], none: true };
  }
  function hitText(h) { return h.it ? `${esc(roadLabel(h.it))}（${esc(h.it.kind)}${h.it.cause ? "・" + esc(h.it.cause) : ""}）` : esc(h.g); }
  function roadWarnHtml(rec, chk, ex) {
    let h = "";
    const names = (c) => [...new Set([...c.block.map((x) => x.it.road || x.it.kind), ...c.quake.map((x) => x.g)])].slice(0, 3).map(esc).join("・");
    if (ex && ex.avoided && ex.v) h += `<div class="rw rw-ok">✅ ${ex.opt === "safe" ? "災害時に通行止めになる道・今の通行止めを" : "今の通行止めを"}避けたルートです。いちばん早いルートは ${names(ex.avoided)} を通るため${ex.via ? "、その道を除いて引き直しました" : "、別ルートを選びました"}（灰色の点線が避けたルート）。</div>`;
    else if (ex && ex.avoided) h += `<div class="rw rw-ok">✅ 通行止めを避けたルートです。いちばん早いルートは ${names(ex.avoided)} の通行止めに掛かるため${ex.via ? "、手前で迂回する経由地を置いて引き直しました" : "、別ルートを選びました"}（灰色の点線が避けたルート）。</div>`;
    if (ex && ex.none && !(ex.v && !ex.chk.block.length)) h += `<div class="rw rw-bad">❗ 通行止めに掛からないルートは見つかりませんでした。現地の案内・う回路の表示に従ってください。</div>`;
    if (chk.quake.length && quakeOn()) h += `<div class="rw rw-bad">🚨 大地震（東京都で震度6弱以上）の交通規制：この経路は ${chk.quake.map((x) => esc(x.g)).join("・")} を通ります。緊急自動車専用路で、一般の車は通れないおそれ（${link(POLICE, "警視庁")}）。</div>`;
    if (chk.block.length) h += `<div class="rw rw-bad">⛔ この経路の上に通行止め ${chk.block.length}件<ul>${chk.block.slice(0, 6).map((x) => `<li>${hitText(x)}・出発から約${fmtDist(x.s)}</li>`).join("")}</ul></div>`;
    if (chk.caution.length) h += `<div class="rw rw-warn">⚠ 経路の上・近く（${ROAD_NEAR}m以内）に交通規制 ${chk.caution.length}件<ul>${chk.caution.slice(0, 5).map((x) => `<li>${hitText(x)}・出発から約${fmtDist(x.s)}</li>`).join("")}${chk.caution.length > 5 ? `<li>ほか${chk.caution.length - 5}件（地図の橙の線）</li>` : ""}</ul></div>`;
    if (chk.text.length) h += `<div class="rw rw-warn">⚠ 通る高速道路で通行止めの情報（区間が経路に掛かるかは地図では確かめられません）<ul>${chk.text.slice(0, 5).map((x) => `<li>${hitText(x)} ${esc(x.it.dir || "")}</li>`).join("")}</ul></div>`;
    if (!h && roadsD()) h = `<div class="rw rw-ok">✅ 経路の上に通行止め・規制の情報はありません。</div>`;
    return `<div id="rwarn">${h}<p class="muted" style="margin:4px 0 0">通行止め・規制：${esc(roadWhen())}。現地の状況と違うことがあります。</p></div>`;
  }
  // 第二次交通規制で緊急交通路に指定されることがある道（警視庁「第二次交通規制」36路線のうち、名前で見分けられるもの。2026-05-22 更新のページ）
  const SECOND = ["第二京浜", "水戸街道", "京葉道路", "第一京浜", "新大宮バイパス", "北本通り", "川越街道", "湾岸道路", "中原街道", "青梅街道", "新青梅街道", "井の頭通り", "五日市街道", "睦橋通り",
    "目黒通り", "蔵前橋通り", "東京環状", "日野バイパス", "大和厚木バイパス", "稲城大橋通り", "東八道路", "小金井街道", "府中街道", "志木街道", "鎌倉街道", "川崎街道", "新奥多摩街道",
    "芋窪街道", "町田街道", "町田厚木線", "八王子武蔵村山線", "三鷹通り", "中央南北線", "多摩ニュータウン通り", "新滝山街道", "滝山街道", "吉野街道", "北野街道", "新小金井街道", "環二通り"];
  const POLICE2 = "https://www.keishicho.metro.tokyo.lg.jp/kurashi/saigai/shinsai_kisei/kisei/kisei_2.html";
  const POLICE_ASK = "https://www.keishicho.metro.tokyo.lg.jp/kurashi/saigai/shinsai_kisei/kisei/index.html";
  // 環状7号線の内側を通る長さ（m）。環七の囲みは emergency_roads.json の kan7（OSM の道の点の凸包）
  function inPoly(poly, la, lo) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [ya, xa] = poly[i], [yb, xb] = poly[j]; if ((ya > la) !== (yb > la) && lo < (xb - xa) * (la - ya) / (yb - ya) + xa) c = !c; } return c; }
  function inKan7(rec) {
    const k = ER && ER.kan7; if (!k || !rec.coords) return 0;
    let m = 0;
    for (let i = 1; i < rec.coords.length; i++) {
      const [a0, b0] = rec.coords[i - 1], [a1, b1] = rec.coords[i];
      if (inPoly(k, (a0 + a1) / 2, (b0 + b1) / 2)) { const p = xy(a0, b0, a0), q = xy(a1, b1, a0); m += Math.hypot(q[0] - p[0], q[1] - p[1]); }
    }
    return m;
  }
  function optHtml(rec, chk, ex) {
    if (rec.mode !== "car") return "";
    const o = rec.opt || "toll", h = [];
    h.push(`<div class="ropt-say"><b>選び方：${esc(ROPT[o] ? ROPT[o][0] : ROPT.toll[0])}</b>${rec.eng === "valhalla" ? "（経路検索：Valhalla）" : "（経路検索：OSRM）"}</div>`);
    if (rec.fb) h.push(`<div class="rw rw-bad">❗ 有料道路を除ける経路検索（Valhalla）につながらなかったため、ふつうの経路検索で出しました。有料道路${o === "safe" ? "や災害時に通行止めになる道" : ""}を通ることがあります。</div>`);
    const tl = (rec.tolls || []).map((x) => `${esc(x[0])} 約${fmtDist(x[1])}`).join("・");
    if (o === "toll" || rec.fb) h.push(rec.toll ? `<div class="rw rw-warn">💴 有料道路を通ります${rec.tollGuess ? "（道の名前から判断）" : ""}：${tl}</div>` : `<div class="rw rw-ok">💴 有料道路は通らない見込みです${rec.tollGuess ? "（道の名前から判断）" : ""}。</div>`);
    else h.push(rec.toll ? `<div class="rw rw-bad">❗ 有料道路を避けきれませんでした：${tl || "区間は分かりません"}</div>` : `<div class="rw rw-ok">💴 有料道路は通りません。</div>`);
    if (o === "safe") {
      const left = chk.quake.filter((x) => x.mid > 0), ends = chk.quake.filter((x) => !(x.mid > 0));
      if (!ER) h.push(`<div class="rw rw-warn">災害時に通行止めになる道の線を読み込めていません（通信が戻ると判定します）。</div>`);
      else if (left.length) h.push(`<div class="rw rw-bad">❗ 災害時に通行止めになる道を避けきれませんでした：${left.map((x) => `${esc(x.g)} 約${fmtDist(x.mid)}`).join("・")}（大地震のときは一般の車は通れません。手前で別の道へ）</div>`);
      else h.push(`<div class="rw rw-ok">🚧 災害時に通行止めになる道（第一次交通規制の7路線）を避けています${ends.length ? "" : "。"}${ends.length ? `。ただし出発地・行き先の近く（${END_NEAR}m以内）で ${ends.map((x) => esc(x.g)).join("・")} に掛かります（その道沿いの場所のため）。` : ""}</div>`);
      if (chk.block.length) h.push(`<div class="rw rw-bad">❗ 今の通行止めを避けきれませんでした（上の一覧）。</div>`);
    }
    if (o === "safe" || quakeOn()) {
      const k7 = inKan7(rec);
      if (k7 > 50) h.push(`<div class="rw rw-warn">⚠ 環状7号線の内側を約${fmtDist(k7)}通ります。大震災のときは、環七から都心方向への車の通行が禁止されます（環七は迂回路として通れます。環八から都心方向も抑制）。</div>`);
      const sec = SECOND.filter((n) => (rec.roads || []).includes(n));
      if (sec.length) h.push(`<div class="rw rw-warn">ℹ 第二次交通規制で緊急交通路に指定されることがある道を通ります：${sec.slice(0, 6).map(esc).join("・")}（道の名前から判断。被害に応じて警視庁が36路線から指定し、指定されると災害応急対策の車両しか通れません。${link(POLICE2, "警視庁")}）</div>`);
      if (o === "safe") h.push(`<p class="muted" style="margin:4px 0">警視庁は「大震災の後は新たに車を使わない」ようお願いしています（${link(POLICE_ASK, "警視庁の案内")}）。このルートは、平常時の下見や、地震の前に動くときの備えとして使ってください。</p>`);
    }
    return `<div id="ropt">${h.join("")}</div>`;
  }
  // 地図に通行止め・規制を描く（赤＝通行止め、橙の点線＝車線規制など、紫＝大地震のときの緊急自動車専用路）
  let roadLayer = null, erLayer = null, curRoute = null;
  function drawRoads() {
    if (!map) return;
    if (!roadLayer) roadLayer = L.layerGroup().addTo(map);
    roadLayer.clearLayers();
    const r = roadsD();
    ((r && r.items) || []).forEach((it) => {
      const lines = it.lines || [];
      if (!lines.length && !it.pt) return;
      const col = it.block ? "#d0021b" : "#f08c00";
      lines.forEach((ln) => L.polyline(ln, { color: col, weight: it.block ? 7 : 4, opacity: 0.9, dashArray: it.block ? null : "6 6", className: it.block ? "road-block" : "road-caution" }).bindPopup(roadPop(it)).addTo(roadLayer));
      // 2026-11-13 遠藤先生「車マークとビックリマークだけど、どこが渋滞、事故してるのかごちゃごちゃしててわかりづらくない？」
      // → 絵文字をやめ、種類が字で分かる小さな印（止＝通行止め・規＝車線規制・交＝片側交互通行）。線そのものが場所
      const p = it.pt || lines[0][Math.floor(lines[0].length / 2)];
      const ch = it.block ? "止" : /交互/.test(it.kind || "") ? "交" : "規";
      L.marker(p, { icon: L.divIcon({ className: "rdmark " + (it.block ? "rd-block" : "rd-caution"), html: ch, iconSize: [18, 18], iconAnchor: [9, 9] }), zIndexOffset: it.block ? 500 : 0, title: it.kind || "" }).bindPopup(roadPop(it)).addTo(roadLayer);
    });
    if (jamState().use) ((jamD() || {}).items || []).forEach((it) => {   // 高速道路の渋滞：道に沿った赤紫の太線（Mac が引いた渋滞の分の形 ln）＋先頭に「渋」
      const p = (it.ln && it.ln.length >= 2 && it.ln[it.ln.length - 1]) || it.h || it.b; if (!p) return;
      if (it.ln && it.ln.length >= 2) {
        L.polyline(it.ln, { color: "#fff", weight: 10, opacity: 0.9, interactive: false, className: "jam-casing" }).addTo(roadLayer);
        L.polyline(it.ln, { color: "#c2255c", weight: 6, opacity: 0.95, className: "road-jam" }).bindPopup(jamPop(it)).addTo(roadLayer);
      }
      L.marker(p, { icon: L.divIcon({ className: "rdmark rd-jam", html: "渋", iconSize: [18, 18], iconAnchor: [9, 9] }), title: "渋滞の先頭" }).bindPopup(jamPop(it)).addTo(roadLayer);
    });
    if (quakeOn() && erLayer) { if (!map.hasLayer(erLayer)) erLayer.addTo(map); drawER(); }   // 大地震の印が後から届いたときも紫の線を出す
    fillLegend();   // 印の見方に 止・規・渋 を合わせる（道の情報が届いた・変わったとき）
  }
  let erDrawn = null;
  function drawER() {
    if (!erLayer || erDrawn === erLayer) return;   // 1つの地図に1回だけ描く（取り込みを待つ間に2回呼ばれても重ねない）
    erDrawn = erLayer;
    const lay = erLayer;
    loadER().then((er) => { if (!er.lines.length) erDrawn = null; return er; }).then((er) => er.lines.forEach((l) => L.polyline(l.c, { color: "#7b2cbf", weight: 5, opacity: 0.75, dashArray: "10 6", className: "road-quake" })
      .bindPopup(`<b>${esc(l.g)}</b><br>大地震（震度6弱以上）のとき、警視庁の第一次交通規制で緊急自動車専用路になり、一般の車は通れません。<br><small>出典：${link(er.url || POLICE, "警視庁")}（道の形は OpenStreetMap）</small>`).addTo(lay)));
  }
  function roadInfoHtml() {
    const r = roadsD();
    if (!r) return `<p class="muted">通行止め・規制の情報はまだありません（データが届くと地図に出ます）。</p>`;
    const textOnly = (r.items || []).filter((it) => !(it.lines && it.lines.length) && !it.pt);
    const nb = (r.items || []).filter((it) => it.block && ((it.lines && it.lines.length) || it.pt)).length;
    const bad = (r.sources || []).filter((s) => !s.ok);
    let h = "";
    if (r.quake) h += `<div class="alert"><b>🚨 東京都で震度6弱以上（${esc(r.quake.title || "")}）</b>警視庁の第一次交通規制で、緊急自動車専用路（国道4・17・20・246号、目白通り・新目白通り・外堀通り、高速道路・首都高速）は一般の車は通れないおそれ。環状7号線から都心方向へも通行禁止。地図の紫の点線。${link(r.quake.link || POLICE, "警視庁の案内")}</div>`;
    h += `<p class="muted" id="roadlegend">「止」赤の線＝通行止め（${nb}件）　「規」橙の点線＝車線規制（「交」＝片側交互通行）　「渋」赤紫の太線＝高速の渋滞（渋が先頭）　${r.quake ? "紫の点線＝緊急自動車専用路" : "（大地震のときの緊急自動車専用路は右上の重ねボタンで表示）"}<br>${esc(roadWhen())}。出典：${Object.values(ROAD_SRC).filter((s) => s[1]).map((s) => link(s[1], s[0])).join("・")}・市町村のお知らせ をもとに作成（詳しくは各サイトで）。${bad.length ? `<br>取れなかった情報：${bad.map((s) => esc(s.name) + (s.at ? `（${esc(hm(s.at))}の分を表示）` : "")).join("、")}` : ""}</p>`;
    const js = jamState(), jd = jamD();
    if (jd && !js.use) h += `<p class="muted" id="jaminfo">🚗 ${esc(js.msg)}</p>`;
    else if (jd) h += `<details id="jaminfo"><summary>🚗 高速道路の渋滞（NEXCO・関東）${(jd.items || []).length}件・${esc(hmj(jd.at))}時点</summary><div class="body">${(jd.items || []).length ? (jd.items || []).map((it) => `<p>${esc(jamLabel(it))}${it.sec ? ` <span class="muted">（${esc(it.sec)}）</span>` : ""}</p>`).join("") : "<p>渋滞の情報はありません。</p>"}<p class="muted">首都高は含みません。地図の 🚗 が先頭の目安。出典：${link(jd.url || "https://ihighway.jp/", "NEXCO（iHighway）")}をもとに作成</p></div></details>`;
    if (textOnly.length) h += `<details><summary>地図に出ない通行止め・お知らせ（高速道路・都道・市町村）${textOnly.length}件</summary><div class="body">${textOnly.map((it) => `<p><b>${esc(it.kind)}</b> ${esc(roadLabel(it))} ${esc(it.dir || "")} ${it.cause ? `（${esc(it.cause)}）` : ""} <span class="muted">${link(it.link || (ROAD_SRC[it.src] || [])[1], (ROAD_SRC[it.src] || ["出典"])[0])}</span></p>`).join("")}</div></details>`;
    return h;
  }
  // データが新しくなったとき（5分ごとの更新・通信が戻ったとき）。地図は作り直さず、線と警告だけ描き直す（道案内を止めない）
  function roadsUpdate() {
    const box = $("#roadinfo"); if (box) box.innerHTML = roadInfoHtml();
    drawRoads();
    if (nav) navRoadCheck();
    else if (curRoute && $("#rwarn")) $("#rwarn").outerHTML = roadWarnHtml(curRoute, roadCheck(curRoute), null);
    if (nav) navJam();
    if (curRoute) jamFill(curRoute);
  }
  // 道案内中：この先のルートに新しい通行止めが入ったら、知らせて引き直す（圏外なら知らせるだけ）
  function navRoadCheck() {
    if (!nav) return;
    nav.roadAt = Date.now();
    const c = roadCheck(nav.rec, nav.R);
    const fresh = [...c.block, ...c.quake].filter((h) => h.s > (nav.lastS || 0) - 30 && !nav.known.has(hid(h)));
    if (!fresh.length) return;
    fresh.forEach((h) => nav.known.add(hid(h)));
    const h0 = fresh[0], ahead = Math.max(0, h0.s - (nav.lastS || 0));
    let al = $("#navroad");
    if (!al) { al = document.createElement("div"); al.id = "navroad"; al.className = "nav-road"; const nb = $("#navbox"); if (nb) nb.insertBefore(al, nb.firstChild); }
    al.hidden = false;
    al.innerHTML = `⛔ この先 約${fmtDist(ahead)}に通行止め：${hitText(h0)}<br>${navigator.onLine ? "通行止めを避けるルートを引き直します…" : "圏外のため引き直せません。手前で別の道へ"}`;
    if (navigator.onLine && nav.lastPos && !nav.rerouting) reroute(nav.lastPos[0], nav.lastPos[1], "この先のルートに通行止めの情報が入ったため、通行止めを避けたルートに変更しました。", "road");
    else say(`この先のルートに、通行止めの情報が入りました。${navigator.onLine ? "" : "圏外のため引き直せません。手前で別の道へ進んでください。"}`, 3);
  }

  // ---------- 高速道路の渋滞（2026-11-13。遠藤先生「高速の渋滞も反映させる。ただし災害などで機能しない場合は取得せずに動くように」） ----------
  // データは Mac の roads.py が NEXCO（iHighway）から事実（路線・方向・先頭・長さ・通過区間・通過時間）だけを取り、暗号化した束の roads.jam に入れる。
  // IC・SA の位置は Mac が OSM の表（hw_points.json）で引いて a（区間の始め）・b（終わり）・h（先頭）に付ける。首都高は入っていない。
  // 使わないとき：大きな地震（大地震の72時間・見張る都県で震度5弱以上の後）／30分より古い（圏外で古い束を見ているときも）／取れていない。
  // 経路を先に出し、渋滞は後から書き足す（失敗してもルートの表示・道案内は止めない）
  const JAM_NEAR = 250, JAM_STALE = 30 * 60000, JAM_V = 80;   // IC の点が経路からこの距離（m）以内なら通る／古さの限度／遅れの見込みの速さ（km/h）
  function jamD() { const r = roadsD(); return (r && r.jam) || null; }
  const hmj = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : `${d.getHours()}時${String(d.getMinutes()).padStart(2, "0")}分`; };
  function jamState() {   // { use: 使える, msg: 使えないときの一言 }
    const j = jamD();
    if (!j) return { use: false, msg: "" };
    if (quakeOn() || j.state === "quake") return { use: false, msg: "大きな地震のため、高速道路の渋滞の情報は使っていません（通行止め・規制の情報を見てください）" };
    if (j.state === "fail" || j.state === "wait") return { use: false, msg: `高速道路の渋滞の情報を取れていません${j.state === "wait" ? "（1時間おきに試しています）" : ""}` };
    if (j.state === "stale" || !j.at || Date.now() - new Date(j.at).getTime() > JAM_STALE) return { use: false, msg: j.at ? `渋滞情報なし（${hmj(j.at)}時点・古いため使っていません）` : "渋滞情報なし" };
    return { use: true, msg: "" };
  }
  const jamDir = (d) => String(d || "").replace(/：/, "（").replace(/^(.+（.+)$/, "$1）");
  const jamDirShort = (d) => String(d || "").split(/[：（(]/)[0];
  function jamLabel(it) { return [it.road, jamDir(it.dir), it.head, it.km != null ? `${it.km}km` : "", it.min != null ? `通過${fmtDur(it.min * 60)}` : ""].filter(Boolean).join(" "); }
  // 経路の上の渋滞：on＝通る（出発からの道のり s〜e・遅れの見込み delay 分・線 pts・通る割合 cover）／before＝渋滞の区間に入るが先頭より手前で降りる（遅れは足さない）
  // ／maybe＝通る高速道路の渋滞だが区間が掛かるか確かめられない
  // 遅れの按分（2026-11-13）：途中の IC から乗るときは、渋滞（先頭から後ろへ長さ km）のうち経路が通る長さの割合で遅れを按分する。乗った所は案内の曲がる所（その高速道路の名前の付いた区間の始め）から
  function jamEntry(rec, R, osm, sEnd) {   // その高速道路に乗った所（出発からの道のり）。分からなければ null
    if (!osm || !rec.steps) return null;
    const st = rec.steps.filter((x) => x[2]).map((x) => ({ s: nearRoute(R, xy(x[2][0], x[2][1], R.lat0)).s, on: String(x[0] || "").includes(osm) })).sort((a, b) => a.s - b.s);
    let k = -1;
    st.forEach((x, i) => { if (x.s <= sEnd + 1) k = i; });
    if (k < 0 || !st[k].on) return null;
    while (k > 0 && st[k - 1].on) k--;
    return st[k].s;
  }
  const angOk = (R, q, p0, p1) => { const p = xy(p0[0], p0[1], R.lat0), r = xy(p1[0], p1[1], R.lat0); let da = Math.abs(Math.atan2(r[1] - p[1], r[0] - p[0]) - q.ang) % (2 * Math.PI); da = Math.min(da, 2 * Math.PI - da); return da < Math.PI / 2; };
  function jamHits(rec, R) {
    const out = { on: [], maybe: [], before: [] }, j = jamD();
    if (!rec || rec.mode !== "car" || !rec.coords || rec.coords.length < 2 || !j || rec.hw === false || !jamState().use) return out;
    R = R || prepRoute(rec.coords);
    const names = rec.roads || [];
    const at = (p) => { if (!p) return null; const q = nearRoute(R, xy(p[0], p[1], R.lat0)); return q.d <= JAM_NEAR ? q : null; };
    (j.items || []).forEach((it) => {
      if (!(it.osm ? names.some((n) => String(n).includes(it.osm)) : (rec.hw || rec.toll))) return;   // その高速道路を通らない
      const qa = at(it.a), qb = at(it.b), qh = at(it.h);
      let sEnd = null;
      if (qh) {
        // 先頭を通る：向きが渋滞の向き（区間の始め→先頭→終わり）と同じか。反対の車線（上り・下り）は数えない
        const pairs = [[it.a, it.h], [it.h, it.b], [it.a, it.b]].filter(([p, q]) => p && q && dm(p, q) > 300);
        if (!pairs.length) { out.maybe.push({ it }); return; }
        if (angOk(R, qh, pairs[0][0], pairs[0][1])) sEnd = qh.s;
      } else if (qa && qb) { if (qa.s < qb.s) sEnd = qb.s; }
      else if (qa && it.h && dm(it.a, it.h) > 300) {   // 区間の始めから入るが、先頭は通らない＝先頭より手前で降りる（遅れは足さない）
        if (angOk(R, qa, it.a, it.h)) out.before.push({ it, s: qa.s });
        return;
      }
      else if (!it.h && (qa || qb)) { out.maybe.push({ it }); return; }
      else if (!it.a && !it.b && !it.h) { out.maybe.push({ it }); return; }
      if (sEnd == null) return;
      const L = (it.km || 0) * 1000, entry = jamEntry(rec, R, it.osm, sEnd);
      const s = Math.max(0, sEnd - L, entry == null ? 0 : entry);
      const cover = L > 0 ? Math.max(0, Math.min(1, (sEnd - s) / L)) : 1;
      const secKm = qa && qb && qa.s < qb.s ? (qb.s - qa.s) / 1000 : (it.slen || it.km || 0);
      const full = it.min != null ? Math.max(0, it.min - secKm / JAM_V * 60) : 0;
      out.on.push({ it, s, e: sEnd, delay: Math.round(full * cover), cover, part: cover < 0.95, pts: routeSlice(rec, R, s, sEnd) });
    });
    out.on.sort((a, b) => a.s - b.s);
    return out;
  }
  function routeSlice(rec, R, s0, s1) {   // 経路の線の、出発からの道のり s0〜s1 の部分
    const c = rec.coords, cum = R.cum, out = [];
    const pt = (i, s) => { const L = cum[i + 1] - cum[i] || 1, t = Math.max(0, Math.min(1, (s - cum[i]) / L)); return [r5(c[i][0] + t * (c[i + 1][0] - c[i][0])), r5(c[i][1] + t * (c[i + 1][1] - c[i][1]))]; };
    for (let i = 0; i < c.length - 1; i++) {
      if (cum[i + 1] < s0 || cum[i] > s1) continue;
      if (!out.length) out.push(pt(i, Math.max(s0, cum[i])));
      out.push(cum[i + 1] <= s1 ? c[i + 1] : pt(i, s1));
    }
    return out;
  }
  function jamHtml(rec) {
    if (!rec || rec.mode !== "car" || rec.hw === false || !(rec.hw || rec.toll)) return "";   // 高速道路を通らない車のルートでは出さない
    const j = jamD(), st = jamState();
    if (!j) return "";
    if (!st.use) return `<div class="rw rw-jam-off">🚗 ${esc(st.msg)}</div>`;
    const h = jamHits(rec), when = `${hmj(j.at)}時点`;
    if (!h.on.length && !h.maybe.length && !h.before.length) return `<div class="rw rw-ok rw-jam-none">🚗 通る高速道路に渋滞の情報はありません（${when}・NEXCO。首都高は含みません）</div>`;
    let s = "";
    if (h.on.length) {
      const tot = h.on.reduce((a, x) => a + x.delay, 0);
      s += `<div class="rw rw-jam">🚗 通る高速道路に渋滞 ${h.on.length}件（${when}・${link((j.url || "https://ihighway.jp/"), "NEXCO")}）<ul>${h.on.slice(0, 5).map((x) => `<li><b class="jam-what">${esc(jamLabel(x.it))}</b><small class="jam-sub">${esc(x.it.sec || "")}${x.it.cause ? "・" + esc(x.it.cause) : ""}・出発から約${fmtDist(x.s)}${x.part ? `・渋滞${x.it.km}kmのうち約${fmtDist(x.e - x.s)}を通る` : ""}${x.delay ? `・遅れの見込み 約${fmtDur(x.delay * 60)}${x.part ? "（通る長さで按分）" : ""}` : ""}</small></li>`).join("")}</ul>` +
        (tot ? `<div class="jam-total">所要時間 約${fmtDur(rec.dur)} → 渋滞を入れると 約${fmtDur(rec.dur + tot * 60)}</div>` : "") +
        `<small class="jam-note">遅れの見込みは「通過時間 − 区間の長さ ÷ 時速80km」の近似です${h.on.some((x) => x.part) ? "。渋滞の一部だけを通るときは、通る長さの割合で按分しています（これも近似）" : ""}。地図の赤紫の線が渋滞の所。</small></div>`;
    }
    if (h.before.length) s += `<div class="rw rw-jam-off">🚗 渋滞の区間に入りますが、渋滞の先頭より手前で高速を降ります（遅れの見込みは足していません。${when}）<ul>${h.before.slice(0, 4).map((x) => `<li>${esc(jamLabel(x.it))}${x.it.sec ? `<br><small>${esc(x.it.sec)}</small>` : ""}</li>`).join("")}</ul></div>`;
    if (h.maybe.length) s += `<div class="rw rw-warn">⚠ 通る高速道路の渋滞（区間が経路に掛かるかは確かめられません。${when}）<ul>${h.maybe.slice(0, 4).map((x) => `<li>${esc(jamLabel(x.it))}${x.it.sec ? `<br><small>${esc(x.it.sec)}</small>` : ""}</li>`).join("")}</ul></div>`;
    return s;
  }
  let jamLine = null;
  function jamFill(rec) {   // ルートの欄と地図に、通る渋滞を後から書き足す
    try {
      const el = $("#rjam");
      if (el && curRoute === rec) el.innerHTML = jamHtml(rec);
      if (jamLine) { jamLine.remove(); jamLine = null; }
      if (!map || !routeLayer) return;
      const h = jamHits(rec);
      if (!h.on.length) return;
      jamLine = L.layerGroup().addTo(routeLayer);
      h.on.forEach((x) => { if (x.pts.length >= 2) L.polyline(x.pts, { color: "#c2255c", weight: 9, opacity: 0.9, className: "route-jam" }).bindPopup(jamPop(x.it, x)).addTo(jamLine); });
    } catch (e) { /* 渋滞の表示に失敗しても、ルート・道案内は止めない */ }
  }
  function jamPop(it, x) {
    const j = jamD() || {};
    return `<b>渋滞 ${esc(it.road)} ${esc(jamDir(it.dir))}</b><br>${esc(it.head || "")}${it.km != null ? ` ${it.km}km` : ""}${it.min != null ? `・通過${esc(fmtDur(it.min * 60))}` : ""}${it.sec ? `<br>${esc(it.sec)}` : ""}${it.cause ? `<br>原因：${esc(it.cause)}` : ""}` +
      `${x && x.delay ? `<br>遅れの見込み 約${fmtDur(x.delay * 60)}（近似）` : ""}${!x && !it.h ? "<br><small>「渋」の印は区間の終わりの位置（先頭の目安）</small>" : ""}${!x && it.ln ? "<br><small>赤紫の太線が渋滞の所（長さから描いた目安）</small>" : ""}<br><small>${esc(hmj(j.at))}時点。出典：${link(j.url || "https://ihighway.jp/", "NEXCO（iHighway）")}をもとに作成</small>`;
  }
  // 道案内の欄：この先の渋滞（声は案内の開始のときだけ。引き直しでは言わない＝2026-11-12 先生「ルート再検索の度にかかる時間や目的地の案内をする必要はない」）
  function navJam() {
    try {
      const el = $("#navjam"); if (!el || !nav) return;
      const h = jamHits(nav.rec, nav.R), ahead = h.on.filter((x) => x.e > (nav.lastS || 0));
      el.hidden = !ahead.length;
      el.textContent = ahead.length ? `🚗 この先 渋滞：${jamLabel(ahead[0].it)}${ahead.length > 1 ? ` ほか${ahead.length - 1}件` : ""}（${hmj((jamD() || {}).at)}時点）` : "";
    } catch (e) { /* 表示だけ */ }
  }
  function jamSay(rec) {
    try {
      const h = jamHits(rec);
      if (!h.on.length) return "";
      const it = h.on[0].it, km = it.km != null ? `渋滞${it.km}キロ` : "渋滞", mn = it.min != null ? `、通過およそ${fmtDur(it.min * 60)}` : "";
      return `この先、${it.road}${jamDirShort(it.dir)}で、${km}${mn}です。${h.on.length > 1 ? `ほかに${h.on.length - 1}か所の渋滞があります。` : ""}`;
    } catch (e) { return ""; }
  }
  window.__bcpJam = { hits: (rec) => { const h = jamHits(rec); return { on: h.on.map((x) => ({ id: x.it.id, s: x.s, e: x.e, delay: x.delay, cover: x.cover, n: x.pts.length })), maybe: h.maybe.map((x) => x.it.id), before: h.before.map((x) => x.it.id) }; }, state: () => jamState(), say: (rec) => jamSay(rec) };   // 試験用

  window.__bcpRouteTo = (lat, lon, name) => {
    const l = store.get("dests", []);
    if (!l.some((d) => d.lat === lat && d.lon === lon)) { l.push({ id: "d:" + Date.now(), name, lat, lon }); store.set("dests", l); }
    store.set("rto", (store.get("dests", []).find((d) => d.lat === lat && d.lon === lon) || {}).id);
    mapFull = false; document.body.classList.remove("mapfull");   // ルートの欄を見せるため、広げた地図を閉じる
    renderSos(); setTimeout(() => { const b = $("#routebox"); if (b) b.scrollIntoView(); }, 300);
  };
  // 印は色だけでなく、丸の中の1文字で種類が分かるようにする（2026-11-12 遠藤先生「青、緑、紫の丸が何なのか分からない」）
  // 避難所は3つに分ける（2026-11-12）：避＝事務所の近くの確認済み（金の縁）・所＝指定避難所（丸）・場＝指定緊急避難場所（四角）
  const PIN = { pl: ["#0b6bcb", "事", "事務所など"], sv: ["#1f8a4c", "避", "事務所の近くの避難所（確認済み）", "vip"], sh: ["#2b8a3e", "所", "指定避難所（過ごす所）"],
    se: ["#5c940d", "場", "指定緊急避難場所（逃げる所）", "sq"], cl: ["#2b8a3e", "12", "避難場所・避難所のまとまり（数）", "cl"],
    wt: ["#0aa3c2", "給", "給水"], sp: ["#7b4fd6", "湧", "湧水"], my: ["#e8590c", "★", "登録した場所"] };
  const pin = (k) => ({ icon: L.divIcon({ className: "bcp-pin k-" + k + (PIN[k][3] ? " " + PIN[k][3] : ""), html: `<span style="background:${PIN[k][0]}">${PIN[k][1]}</span>`, iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12] }), title: PIN[k][2] });
  // 2026-11-13 遠藤先生「この地図だけど、ごちゃごちゃしていて、等高線のない地図はないの？」
  // → 標準地図の絵から等高線の色（#c8a03c と白の混ざり＝各色の薄まり方がそろう点）だけを白に戻した「等高線なし」を足し、最初の地図にする。
  //   元は保存した標準地図なので圏外でも出る（地図を保存し直す必要はない）。道路の黄・建物の橙・地名などは色の薄まり方がそろわないので残る
  const CONTOUR = [200, 160, 60];
  function noContour(d) {
    for (let i = 0; i < d.length; i += 4) {
      const ar = (255 - d[i]) / (255 - CONTOUR[0]), ag = (255 - d[i + 1]) / (255 - CONTOUR[1]), ab = (255 - d[i + 2]) / (255 - CONTOUR[2]);
      const lo = Math.min(ar, ag, ab), hi = Math.max(ar, ag, ab);
      if (lo > 0.03 && hi - lo < 0.25 * hi + 0.02 && hi < 1.15) { d[i] = d[i + 1] = d[i + 2] = 255; }   // 薄い灰色（校庭・河川敷・駅の構内など）は薄まり方がそろわないので残す
    }
    return d;
  }
  window.__bcpNoContour = noContour;   // 試験用
  let PlainLayer = null;   // Leaflet を読んでから作る
  const plainLayer = (o) => new (PlainLayer = PlainLayer || L.GridLayer.extend({
    createTile(c, done) {
      const cv = document.createElement("canvas"); cv.width = cv.height = 256;
      const img = new Image(); if (!NATIVE) img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, 256, 256);
          const im = g.getImageData(0, 0, 256, 256); noContour(im.data); g.putImageData(im, 0, 0);
        } catch (e) { /* 絵を読めないときは元の絵のまま */ }
        done(null, cv);
      };
      img.onerror = () => done(new Error("tile"), cv);
      img.src = TILE.std.url.replace("{z}", c.z).replace("{x}", c.x).replace("{y}", c.y);
      return cv;
    },
  }))(o);
  // 前の版は、案内の終わりにアプリが地図を戻したときも「選んだ地図」と覚えていた → 一度だけ自動に戻す（2026-11-13）
  try { if (!store.get("mapBaseV2", false)) { store.set("mapBase", "auto"); store.set("mapBaseV2", true); } } catch (e) { /* 端末に保存できない */ }
  let osmBad = 0, baseSwap = false;   // baseSwap：アプリが地図を替えている間（Leaflet はこのときも baselayerchange を出すので、人が選んだと覚えない）   // OpenStreetMap が取れなかった時刻（10分は等高線なしのまま）
  function baseKey() {   // いま出す地図：選んだ地図、または自動（通信があれば OpenStreetMap）
    const k = store.get("mapBase", "auto");
    if (["plain", "std", "pale", "osm", "photo"].includes(k)) return k;
    return navigator.onLine && Date.now() - osmBad > 600000 ? "osm" : "plain";
  }
  function baseAuto() {   // 通信が切れた・戻ったとき、自動なら地図を替える
    if (!map || !mapBase || store.get("mapBase", "auto") !== "auto" || document.body.classList.contains("navmode")) return;
    const want = mapBase[baseKey()];
    if (map.hasLayer(want)) return;
    baseSwap = true;
    ["plain", "std", "osm", "photo"].forEach((k) => map.hasLayer(mapBase[k]) && map.removeLayer(mapBase[k]));
    want.addTo(map);
    baseSwap = false;
  }
  window.addEventListener("online", () => { osmBad = 0; baseAuto(); }); window.addEventListener("offline", baseAuto);   // 通信が戻ったら OpenStreetMap をもう一度試す
  window.__bcpBase = () => ({ key: baseKey(), osmBad, on: mapBase ? Object.keys(mapBase).filter((k) => map && map.hasLayer(mapBase[k])) : [] });   // 試験用
  function initMap() {
    if (!window.L || !$("#map")) return;
    if ($("#map")._leaflet_id) return;   // 同じ地図の枠に2回作らない（緊急を最初に地図にしたら、描き直しが重なって「Map container is already initialized」が出た。2026-11-13）
    map = L.map("map", { zoomControl: false, fadeAnimation: false, zoomAnimation: false, markerZoomAnimation: false, rotate: true, touchRotate: false, rotateControl: false, shiftKeyRotate: false }).setView([35.775, 139.24], 12);
    const base = { plain: plainLayer({ attribution: ATTR, maxZoom: 18, maxNativeZoom: TILE.std.max, className: "base-plain" }),
      std: L.tileLayer(TILE.std.url, { attribution: ATTR, maxZoom: 18, maxNativeZoom: TILE.std.max }), pale: L.tileLayer(TILE.pale.url, { attribution: ATTR, maxZoom: 18 }),
      osm: L.tileLayer(TILE.osm.url, { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors', maxZoom: 18, maxNativeZoom: TILE.osm.max }),
      photo: L.tileLayer(TILE.photo.url, { attribution: ATTR, maxZoom: 18, maxNativeZoom: TILE.photo.max }) };
    // 2026-11-13 遠藤先生「このマップはオープンストリートマップは使われないの？」→ 最初は「自動」：通信があれば OpenStreetMap、
    // 圏外・地図が取れないときは等高線なし（保存した地図）。右上で選ぶと、その地図を端末に覚える
    base[baseKey()].addTo(map);
    mapBase = base;
    map.on("baselayerchange", (e) => { if (baseSwap) return; const k = Object.keys(base).find((x) => base[x] === e.layer); if (k && !document.body.classList.contains("navmode")) store.set("mapBase", k); });   // 人が右上で選んだときだけ覚える
    let osmErr = [];
    base.osm.on("tileerror", () => {   // 電波が弱くて OpenStreetMap が取れないときは、自動のときだけ等高線なしへ
      if (!navigator.onLine || !map.hasLayer(base.osm)) return;   // 圏外へ切り替えて読みかけが止まった分は数えない
      const now = Date.now(); osmErr = osmErr.filter((t) => now - t < 15000).concat(now);
      if (store.get("mapBase", "auto") === "auto" && osmErr.length >= 4 && map.hasLayer(base.osm)) { osmBad = now; baseSwap = true; map.removeLayer(base.osm); base.plain.addTo(map); baseSwap = false; }
    });
    const ov = {};
    ["flood", "doseki", "kyuke", "jisuberi"].forEach((k) => (ov[TILE[k].name] = L.tileLayer(TILE[k].url, { opacity: 0.6, maxNativeZoom: TILE[k].max, maxZoom: 18 })));
    const rbtn = (p) => `<br><button class="mini" onclick="window.__bcpRouteTo(${Number(p.lat)},${Number(p.lon)},${esc(JSON.stringify(p.name))})">ここへのルート</button>`;
    const pl = L.layerGroup(), sh = L.layerGroup(), wt = L.layerGroup(), sp = L.layerGroup();
    ((B && B.places) || []).forEach((p) => L.marker([p.lat, p.lon], pin("pl")).bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.note || "")}`).addTo(pl));
    ((B && B.shelters) || []).forEach((p) => L.marker([p.lat, p.lon], Object.assign(pin("sv"), { zIndexOffset: 300 })).bindPopup(`<b>${esc(p.name)}</b><br><small>事務所の近くの避難所（確認済み）</small><br>${esc(p.addr)}<br>${esc(p.kinds)}${rbtn(p)}`).addTo(sh));
    ((B && B.water) || []).forEach((p) => L.marker([p.lat, p.lon], pin("wt")).bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.addr || "")}<br>${esc(p.note || "")}${rbtn(p)}`).addTo(wt));
    ((B && B.springs) || []).filter((p) => p.lat).forEach((p) => L.marker([p.lat, p.lon], pin("sp")).bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.addr || "")}<br>${esc(p.note || "")}<br>そのまま飲まない（煮沸など）${rbtn(p)}`).addTo(sp));
    const my = L.layerGroup();
    store.get("dests", []).forEach((p) => L.marker([p.lat, p.lon], pin("my")).bindPopup(`<b>${esc(p.name)}</b>`).addTo(my));
    pl.addTo(map); my.addTo(map);
    svLayer = sh; if (showOn("sv")) sh.addTo(map);   // 確認済みの避難所は「表示するもの」で出し入れ
    wtLayer = wt; spLayer = sp;   // 給水・湧水は「表示するもの」で選んだときだけ（applyShow）
    posLayer = L.layerGroup(); const posMk = posMarks(map, posLayer, true);   // 2人の位置も「表示するもの」で選んだときだけ
    // 国土地理院の避難場所・避難所（出し入れを端末に覚える）
    shelLayer = L.layerGroup();   // 「表示するもの」で選んだときだけ出す（applyShow）
    ov["事務所など"] = pl; ov["事務所の近くの避難所（確認済み）"] = sh; ov["登録した場所"] = my;
    roadLayer = null; erLayer = L.layerGroup(); curRoute = null;
    drawRoads();
    ov["通行止め・規制"] = roadLayer; ov["大地震のときの緊急自動車専用路"] = erLayer;
    map.on("overlayadd", (e) => { if (e.layer === erLayer) drawER(); });
    if (quakeOn()) { erLayer.addTo(map); drawER(); }
    else setTimeout(() => loadER(), 1500);   // 先に取っておく（圏外になっても大地震の判定ができるように。iPhone 版は裏方が保存）
    // 長押しで行き先に登録
    map.on("contextmenu", (e) => {
      if (!mapFull && !nav) return setMapFull(true);   // ページの中の小さな地図では、まず広げる
      const name = prompt("この場所の名前（例：実家、集合場所、駐車場）", "");
      if (!name) return;
      const l = store.get("dests", []); l.push({ id: "d:" + Date.now(), name: name.slice(0, 30), lat: Math.round(e.latlng.lat * 1e5) / 1e5, lon: Math.round(e.latlng.lng * 1e5) / 1e5 }); store.set("dests", l);
      renderSos();
    });
    // 広げた地図を閉じるボタン（左上。iPhone の切り欠きに掛からない位置）→ 拡大縮小のボタンはその下
    const fc = L.control({ position: "topleft" });
    fc.onAdd = () => {
      const d = L.DomUtil.create("div", "mapclose");
      d.innerHTML = `<button type="button" id="mapclose">✕ 閉じる</button><button type="button" class="mapsel-open">🗂 表示するもの</button>`;
      L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
      d.firstChild.addEventListener("click", () => setMapFull(false));
      d.querySelector(".mapsel-open").addEventListener("click", () => { const p = $("#mapsel"); if (p) p.classList.toggle("on"); });
      return d;
    };
    fc.addTo(map);
    // 「表示するもの」の選ぶ欄（広げた地図の上に開く。押しやすいボタンを3列で）
    const ps = document.createElement("div"); ps.id = "mapsel"; ps.className = "mapsel";
    ps.innerHTML = `<div class="mapsel-h"><b>地図に表示するもの</b><button type="button" class="mapsel-x">閉じる</button></div><div class="mapsel-g">${showList().map(([k, ic, n, pk]) => `<button type="button" data-poi="${k}">${showIcon(ic, pk)} ${esc(n)}</button>`).join("")}</div>${OPENONLY_BTN}<p>${OPENONLY_NOTE}</p>`;
    L.DomEvent.disableClickPropagation(ps); L.DomEvent.disableScrollPropagation(ps);
    // ボタンの押した処理は document の振り分け（data-poi）で行う（Leaflet 1.9 の disableClickPropagation は click を止めないので、ここで足すと2回切り替わる）
    ps.querySelector(".mapsel-x").addEventListener("click", () => ps.classList.remove("on"));
    map.getContainer().appendChild(ps);
    L.control.zoom({ position: "topleft", zoomInTitle: "近づける", zoomOutTitle: "遠ざける" }).addTo(map);
    // 広げた地図の中の操作（現在地・追いかける）
    const tc = L.control({ position: "bottomright" });
    tc.onAdd = () => {
      const d = L.DomUtil.create("div", "maptools");
      d.innerHTML = `<button type="button" data-mapbtn="here">📍 現在地</button><button type="button" data-mapbtn="follow">${followOn ? "追いかけを止める" : "追いかける"}</button>`;
      L.DomEvent.disableClickPropagation(d);
      d.querySelector('[data-mapbtn="here"]').addEventListener("click", hereLocate);
      d.querySelector('[data-mapbtn="follow"]').addEventListener("click", toggleFollow);
      return d;
    };
    tc.addTo(map);
    L.control.layers({ "等高線なし（標準地図から）": base.plain, "標準地図": base.std, "淡色地図": base.pale, "OpenStreetMap（通信が要る）": base.osm, "航空写真（通信が要る）": base.photo }, ov, { collapsed: true }).addTo(map);
    // 地図の上の凡例（押すと畳む・広げる。状態は端末に覚える）
    const lg = L.control({ position: "bottomleft" });
    lg.onAdd = () => {
      const d = L.DomUtil.create("div", "bcp-legend" + (store.get("legendClosed2", true) ? " closed" : ""));   // 既定は畳む（2026-11-12 遠藤先生「見にくい」）
      legendBox = d; fillLegend();
      L.DomEvent.disableClickPropagation(d);
      d.addEventListener("click", () => {
        if (!mapFull && !nav) { d.classList.remove("closed"); store.set("legendClosed2", false); return setMapFull(true); }   // ページの中の地図では畳んだ形で出し、押すと広げて開く
        d.classList.toggle("closed"); store.set("legendClosed2", d.classList.contains("closed"));
      });
      return d;
    };
    lg.addTo(map);
    const pts = [...((B && B.places) || [])].map((p) => [p.lat, p.lon]);
    if (pts.length) map.fitBounds(pts, { padding: [30, 30] });
    // ページの中の地図：「押すと広がる」の案内。押す（印・まとまりを含む）と画面いっぱいに
    const hint = document.createElement("div"); hint.className = "map-hint"; hint.textContent = "👆 押すと地図が広がります（指で動かす・拡大は広げてから）";
    map.getContainer().appendChild(hint);
    map.on("click", () => { if (!mapFull && !nav) setMapFull(true); });
    map.on("popupopen", () => { if (!mapFull && !nav) setMapFull(true); });
    map.on("moveend", () => { lastMapView = [map.getCenter(), map.getZoom()]; });
    if (mapFullOnInit) { mapFullOnInit = false; mapFull = true; }
    if (mapFull && lastMapView) map.setView(lastMapView[0], lastMapView[1], { animate: false });   // 広げた地図で場所を登録した後も、見ていた所のまま
    setMapFull(mapFull);
    if (followOn) startFollow();
    if (posFocus) {   // 連絡の「2人の直近の位置」から：小さな地図を押した＝2人とも入る範囲、「アプリの地図」＝その人を真ん中に
      const f = posFocus; posFocus = null;
      posLayer.addTo(map);
      if (f.all) posFit(map, posMk, 16);
      else { const mk = posMk.find((x) => x._posI === f.i); if (mk) { map.setView(mk.getLatLng(), 16, { animate: false }); setTimeout(() => mk.openPopup(), 0); } }
    }
    poiLayer = null;
    map.on("moveend", drawPois);
    drawPois();
    map.on("moveend", drawShelters);
    map.on("popupclose", () => setTimeout(() => { drawShelters(); drawPois(); }, 0));
    applyShow();
    fillShelters();
  }
  function hereLocate() {
    if (!map) return;
    map.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true });
    map.once("locationfound", (e) => { savePos(e.latlng.lat, e.latlng.lng); L.circleMarker(e.latlng, { radius: 8, color: "#fff", weight: 3, fillColor: "#e8590c", fillOpacity: 1 }).addTo(map).bindPopup("現在地").openPopup(); fillShelters(); });
    map.once("locationerror", () => toast("現在地を取れませんでした（位置の許可を確認）"));
  }
  function toggleFollow() {
    followOn = !followOn;
    document.querySelectorAll('#follow, [data-mapbtn="follow"]').forEach((b) => { b.textContent = followOn ? "追いかけを止める" : "追いかける"; });
    if (followOn) startFollow(); else stopFollow();
  }
  function shelHere() {
    const b = $("#shelhere");
    if (!navigator.geolocation) return toast("このスマホでは位置が使えません");
    if (b) b.textContent = "調べています…";
    navigator.geolocation.getCurrentPosition((p) => { savePos(p.coords.latitude, p.coords.longitude); if (b) b.textContent = "現在地から探す"; fillShelters(); },
      () => { if (b) b.textContent = "現在地から探す"; toast("現在地を取れませんでした。事務所から近い順に出します"); fillShelters(); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }
  // 現在地の印に進む向きを出す（2026-11-13 遠藤先生「ナビについては、車や徒歩の進行方向を示してください」）
  // 車＝矢印、徒歩＝丸に向きの三角。向きが分からない間（止まっている・走り出す前）は丸だけ。地図を回しているときは、その分も足して画面の向きにする
  function meIcon(foot) {
    return L.divIcon({ className: "me-mark" + (foot ? " me-foot" : " me-car"), iconSize: [40, 40], iconAnchor: [20, 20],
      html: `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><g class="me-dir" style="display:none">${foot
        ? '<path d="M20 3l7 10H13z" fill="#e8590c" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>'
        : '<path d="M20 4l12 30-12-7-12 7z" fill="#e8590c" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>'}</g>` +
        `<circle class="me-dot" cx="20" cy="20" r="${foot ? 8 : 9}" fill="#e8590c" stroke="#fff" stroke-width="3"/></svg>` });
  }
  function meDir(mk, h, foot) {   // h：北から時計回りの向き（度）。null なら向きを隠す
    const el = mk && mk.getElement && mk.getElement(); if (!el) return;
    const dir = el.querySelector(".me-dir"), dot = el.querySelector(".me-dot"), svg = el.querySelector("svg");
    if (h == null || isNaN(h)) { if (dir) dir.style.display = "none"; if (dot) dot.style.display = ""; if (svg) svg.style.transform = ""; el.dataset.h = ""; return; }
    const b = map && map.getBearing ? map.getBearing() : 0, a = ((h + b) % 360 + 360) % 360;
    if (dir) dir.style.display = ""; if (dot) dot.style.display = foot ? "" : "none";
    if (svg) svg.style.transform = `rotate(${a.toFixed(0)}deg)`;
    el.dataset.h = String(Math.round(h));
  }
  function startFollow() {
    if (!map) return;
    map.off("locationfound"); map.off("locationerror");
    map.on("locationfound", (e) => {
      const foot = rmode !== "car";
      if (!followMark) followMark = L.marker(e.latlng, { icon: meIcon(foot), interactive: false, keyboard: false, zIndexOffset: 900 }).addTo(map);
      else followMark.setLatLng(e.latlng);
      if (followMark._foot !== foot) { followMark.setIcon(meIcon(foot)); followMark._foot = foot; }
      // 向き：動いている間の GPS の向き（止まると向きが乱れるので、遅いときは前の向きのまま・しばらく止まれば隠す）
      const mv = e.speed != null && !isNaN(e.speed) && e.speed >= (foot ? 0.6 : 1.5);
      if (mv && e.heading != null && !isNaN(e.heading)) { followMark._h = e.heading; followMark._ht = Date.now(); }
      meDir(followMark, followMark._h != null && Date.now() - (followMark._ht || 0) < 60000 ? followMark._h : null, foot);
    });
    map.on("locationerror", () => toast("現在地を取れませんでした（位置の許可を確認）"));
    map.locate({ watch: true, setView: true, maxZoom: 17, enableHighAccuracy: true });
  }
  function stopFollow() { if (map) map.stopLocate(); followMark = null; }
  function tilesFor(bounds, z) {
    const n = 2 ** z, out = [];
    const x0 = Math.floor((bounds.w + 180) / 360 * n), x1 = Math.floor((bounds.e + 180) / 360 * n);
    const ty = (lat) => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n);
    const y0 = ty(bounds.n), y1 = ty(bounds.s);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
    return out;
  }
  function around(p, km) { const dl = km / 111, dn = km / (111 * Math.cos(p.lat * Math.PI / 180)); return { s: p.lat - dl, n: p.lat + dl, w: p.lon - dn, e: p.lon + dn }; }
  function tilePlan(level) {
    const urls = new Set();
    const add = (layer, b, z) => tilesFor(b, z).forEach(([z1, x, y]) => urls.add(TILE[layer].url.replace("{z}", z1).replace("{x}", x).replace("{y}", y)));
    if (level === "detail") { add("std", AREA_WIDE1, 15); return [...urls]; }   // 細い道まで・東京都＋隣接（約1万枚）
    if (level === "detail2") {                                                 // 細い道まで・その外側（隣接の隣接。約1万枚）
      const inner = new Set(tilesFor(AREA_WIDE1, 15).map((t) => t.join("/")));
      tilesFor(AREA_WIDE, 15).filter((t) => !inner.has(t.join("/"))).forEach(([z1, x, y]) => urls.add(TILE.std.url.replace("{z}", z1).replace("{x}", x).replace("{y}", y)));
      return [...urls];
    }
    for (let z = 8; z <= 14; z++) add("std", AREA_WIDE, z);                    // 町名と主な道路まで（範囲の全体。約7,000枚）
    for (let z = 12; z <= 14; z++) ["flood", "doseki", "kyuke", "jisuberi"].forEach((k) => add(k, AREA_TOKYO, z));
    ((B && B.places) || []).forEach((p) => {                                  // 3か所の周りは一番細かく
      for (let z = 15; z <= 16; z++) { add("std", around(p, 2.5), z); ["flood", "doseki", "kyuke", "jisuberi"].forEach((k) => add(k, around(p, 2.5), z)); }
      add("std", around(p, 1), 17);
    });
    store.get("routes", []).forEach((r) => routeTileUrls(r).forEach((u) => urls.add(u)));   // 保存したルートの沿線
    return [...urls];
  }
  let tileStop = false;
  // iPhone アプリでは、地図の保存を iPhone 本体のバックグラウンド転送に任せる（アプリを裏に回しても・画面を消しても続く）
  let tilePoll = null;
  // 保存の結果の文（2026-11-12 遠藤先生「表示は出るけど保存されたのか分からない」。前は今回取った枚数だけで、全部保存済みでも0枚と出た）
  function tileResultText(s) {
    if (s.requested === undefined) return `保存しました（${s.ok}枚）。`;   // 古いアプリ（数を返さない）
    const have = (s.skipped || 0) + (s.ok || 0), failed = s.failed || 0;
    return `${have >= s.requested ? "✅ 保存できています" : "⚠ 一部だけ保存できています"}：${s.requested}枚のうち ${have}枚（もとから保存済み ${s.skipped || 0}枚・今回 ${s.ok || 0}枚）。` +
      (failed ? `取れなかった ${failed}枚は、通信の良いところでもう一度押すと取り直します。` : "圏外でもこの範囲の地図が見られます。");
  }
  function nativeTileProgress(level) {
    clearInterval(tilePoll);
    tilePoll = setInterval(async () => {
      try {
        const s = await (await fetch("/tile-status", { cache: "no-store" })).json();
        const bar = $("#tbar"), msg = $("#tmsg"), stopBtn = $("#tilestop");
        if (!bar || !msg) return;
        bar.style.display = "block";
        if (s.total > 0) bar.firstElementChild.style.width = (s.done / s.total * 100).toFixed(1) + "%";
        if (!s.running && s.requested !== undefined && s.requested > 0) bar.firstElementChild.style.width = (((s.skipped || 0) + (s.ok || 0)) / s.requested * 100).toFixed(1) + "%";
        msg.textContent = s.running ? `保存中 ${s.done}/${s.total}（もとから保存済み ${s.skipped || 0}枚は飛ばしています。アプリを裏に回しても、画面を消しても続きます）` : tileResultText(s);
        if (stopBtn) stopBtn.style.display = s.running ? "block" : "none";
        if (!s.running) {
          clearInterval(tilePoll);
          // 「保存済み」の印は、終わったときに実際の数で付ける（押した瞬間には付けない）
          if (level && s.requested !== undefined && s.requested > 0) {
            const sv = store.get("tilesSaved2", {}); sv[level] = { at: new Date().toISOString(), n: (s.skipped || 0) + (s.ok || 0), of: s.requested, failed: s.failed || 0 }; store.set("tilesSaved2", sv);
            const btn = $(level === "detail2" ? "#savetiles3 small" : level === "detail" ? "#savetiles2 small" : "#savetiles small");
            if (btn) btn.textContent = (level === "detail2" ? "その外側" : level === "detail" ? "東京都＋隣接" : "範囲の全体") + `（${tileSavedLabel(sv[level])}）`;
          }
        }
      } catch (e) { /* 次の確認で */ }
    }, 1500);
  }
  async function saveTiles(only, level) {
    const urls = only || tilePlan(level);
    if (window.__BCP_BG_TILES && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bcp) {
      const what = level === "detail2" ? "東京都＋隣接の外側（隣接の隣接の市町村）の詳しい地図（細い道まで）" : level === "detail" ? "東京都と隣接の市町村の詳しい地図（細い道まで）" : only ? "ルート沿いの地図" : "東京都・隣接・その隣接の市町村の地図と、3か所の周りの詳しい地図";
      if (!confirm(`${what}を、最大${urls.length}枚このスマホに保存します。保存済みの分は飛ばします。アプリを裏に回しても、画面を消しても続きます（Wi‑Fi がおすすめ）。始めますか？`)) return;
      window.webkit.messageHandlers.bcp.postMessage({ tiles: urls });
      // 古いアプリ（数を返さない）は今まで通り押したときに印を付ける。新しいアプリは終わったときに実数で付ける
      if (!only && !window.__BCP_TILE_COUNTS) { const sv = store.get("tilesSaved2", {}); sv[level || "base"] = { at: new Date().toISOString(), n: urls.length }; store.set("tilesSaved2", sv); }
      nativeTileProgress(only ? null : (level || "base"));
      return;
    }
    const what = level === "detail2" ? "東京都＋隣接の外側（隣接の隣接の市町村）の詳しい地図（細い道まで）" : level === "detail" ? "東京都と隣接の市町村の詳しい地図（細い道まで）" : only ? "ルート沿いの地図" : "東京都・隣接・その隣接の市町村の地図（町名・主な道路まで）と、3か所の周りの詳しい地図";
    if (!confirm(`${what}を、最大${urls.length}枚（多くて約${Math.round(urls.length * (/^detail/.test(level || "") ? 0.05 : 0.04))}MB）このスマホに保存します。Wi‑Fi のときがおすすめです。保存済みの分は飛ばすので、途中で止めても続きから保存できます。始めますか？`)) return;
    tileStop = false;
    const stopBtn = $("#tilestop"); if (stopBtn) stopBtn.style.display = "block";
    const cache = NATIVE ? null : await caches.open("bcp-tiles-v1");
    let done = 0, ok = 0;
    const bar = $("#tbar"), msg = $("#tmsg");
    bar.style.display = "block";
    const queue = urls.slice();
    async function worker() {
      while (queue.length && !tileStop) {
        const u = queue.shift();
        try {
          if (NATIVE) { const r = await fetch(u); if (r.ok) ok++; }   // 裏方が端末に保存する
          else if (!(await cache.match(u))) { const r = await fetch(u, { mode: "cors" }); if (r.ok) { await cache.put(u, r); ok++; } } else ok++;
        } catch (e) { /* 空の区域（404）や一時的な失敗は飛ばす */ }
        done++;
        if (done % 20 === 0 || done === urls.length) { bar.firstElementChild.style.width = (done / urls.length * 100).toFixed(1) + "%"; msg.textContent = `保存中 ${done}/${urls.length}`; }
      }
    }
    await Promise.all([1, 2, 3, 4].map(worker));
    if (stopBtn) stopBtn.style.display = "none";
    if (tileStop) { msg.textContent = `止めました（${done}/${urls.length}）。もう一度押すと続きから保存します。`; return; }
    if (!only) { const sv = store.get("tilesSaved2", {}); sv[level || "base"] = { at: new Date().toISOString(), n: ok }; store.set("tilesSaved2", sv); store.set("tilesSaved", { at: new Date().toISOString(), n: ok }); }
    msg.textContent = `保存しました（${ok}枚。区域の無い所の重ね図は元から無いので数に入りません）。`;
    persist();
  }

  // ---------- SOS（光と音。2026-11-11 先生） ----------
  // モールス信号の SOS（・・・－－－・・・）で、画面を白く点滅させ、高い音（笛の音に近い 3,000Hz）を鳴らす。iPhone アプリでは背面のライトも同じ拍子で点滅
  let sosRun = null;
  function sosStart() {
    if (sosRun) return;
    const ov = document.createElement("div"); ov.id = "sosov"; ov.innerHTML = `<div class="soslbl">SOS<br><small>押すと止まります</small></div><div class="sosvol" hidden>🔈 音量が小さいです<br>本体の音量ボタン（＋）で上げてください</div>`; document.body.appendChild(ov);
    // 2026-11-12 夕 先生「光るけど音がでない」：iPhone アプリ（新しい版）は音と光を Swift で鳴らす（マナーモードでも鳴る。SosPlayer）。
    // 画面は「始める」を送るだけで、ライトの点滅も Swift に任せる。本体の音量が小さければ __bcpSosVol で知らせが来る
    const swiftSos = !!window.__BCP_SOS_NATIVE;
    window.__bcpSosVol = (v) => { const w = ov.querySelector(".sosvol"); if (w) w.hidden = !(v < 0.5); };
    let ac = null, osc = null, gain = null;
    if (!swiftSos) {
      // ブラウザ版・古いアプリ：Web Audio で鳴らす。対応する Safari では音の扱いを「再生」にしてから作る（消音スイッチで消えにくくする）。押した操作の中で resume する
      try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) { /* 対応していない */ }
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); osc = ac.createOscillator(); gain = ac.createGain(); osc.type = "square"; osc.frequency.value = 3000; gain.gain.value = 0; osc.connect(gain); gain.connect(ac.destination); osc.start(); if (ac.resume) ac.resume(); } catch (e) { ac = null; }
    }
    const native = (on) => { if (swiftSos) return; try { window.webkit.messageHandlers.bcp.postMessage({ torch: on }); } catch (e) { /* ブラウザ版はライトを使えない */ } };
    sayStopAll();   // 道案内の声を止める
    try { window.webkit.messageHandlers.bcp.postMessage({ sos: true }); } catch (e) { /* なし */ }
    const U = 200;   // 1単位（ミリ秒）
    const seq = []; const mark = (n) => { seq.push([true, n]); seq.push([false, 1]); };
    [1, 1, 1].forEach(() => mark(1)); seq[seq.length - 1][1] = 3; [3, 3, 3].forEach(() => mark(3)); seq[seq.length - 1][1] = 3; [1, 1, 1].forEach(() => mark(1)); seq[seq.length - 1][1] = 7;
    let i = 0;
    const step = () => {
      if (!sosRun) return;
      const [on, n] = seq[i % seq.length]; i++;
      ov.classList.toggle("on", on); native(on);
      if (gain) gain.gain.setTargetAtTime(on ? 0.9 : 0, ac.currentTime, 0.005);
      sosRun.t = setTimeout(step, n * U);
    };
    sosRun = { ov, ac, t: null };
    ov.addEventListener("click", sosStop);
    try { if (navigator.wakeLock) navigator.wakeLock.request("screen").then((l) => { if (sosRun) sosRun.lock = l; }).catch(() => { /* 点けたままにできない端末 */ }); } catch (e) { /* なし */ }
    step();
  }
  function sosStop() {
    if (!sosRun) return;
    clearTimeout(sosRun.t);
    try { sosRun.ac && sosRun.ac.close(); } catch (e) { /* なし */ }
    try { sosRun.lock && sosRun.lock.release(); } catch (e) { /* なし */ }
    try { window.webkit.messageHandlers.bcp.postMessage({ torch: false, sos: false }); } catch (e) { /* なし */ }
    sosRun.ov.remove(); sosRun = null;
  }

  // ---------- 設定 ----------
  // 声の質：iPhone アプリは Swift が知らせる（__BCP_VOICE）。ブラウザ版は入っている声の名前から。質の高い声が無ければ入れ方を案内（ダウンロードは先生の操作）
  function voiceHintHtml() {
    const how = "iPhone の「設定」→「アクセシビリティ」→「読み上げコンテンツ」→「声」→「日本語」で、「拡張」または「プレミアム」の声（例：Kyoko（拡張）・O-ren（拡張））をダウンロードすると、道案内の声が自然で聞きやすくなります。";
    let q = "", name = "";
    if (NATIVE) { const v = window.__BCP_VOICE || {}; q = v.quality || ""; name = v.name || ""; }
    else { try { const vs = speechSynthesis.getVoices().filter((v) => /^ja/i.test(v.lang)); const b = vs.find((v) => /premium|プレミアム/i.test(v.name)) || vs.find((v) => /enhanced|拡張/i.test(v.name)); q = b ? (/premium|プレミアム/i.test(b.name) ? "premium" : "enhanced") : (vs.length ? "default" : "none"); name = b ? b.name : (vs[0] ? vs[0].name : ""); } catch (e) { q = ""; } }
    if (q === "premium" || q === "enhanced") return `<p class="muted">質の高い声（${q === "premium" ? "プレミアム" : "拡張"}${name ? "：" + esc(name) : ""}）で話します。</p>`;
    if (!q || q === "unknown") return `<p class="muted">声を調べています…（${esc(how)}）</p>`;
    return `<div class="alert" style="background:var(--warn-bg);color:var(--warn)"><b>声を聞きやすくできます</b>${esc(how)}${name ? `<br><small>今の声：${esc(name)}</small>` : ""}</div>`;
  }
  // 声を選ぶ（2026-11-13 遠藤先生「道案内の声がかわってないよ、怖いよ。もっとオシャレな声がいい」）：iPhone に入っている日本語の声から選び、試しに聞ける
  const VQ = { premium: "プレミアム", enhanced: "拡張", default: "標準" };
  function voicePickHtml() {
    const vs = window.__BCP_VOICES;
    if (!NATIVE || !Array.isArray(vs) || !vs.length) return "";
    const cur = (window.__BCP_VOICE || {}).picked || "";
    return `<label>声を選ぶ<select id="voicepick"><option value="">自動（いちばん質の高い声）</option>${vs.map((v) => `<option value="${esc(v.id)}" ${v.id === cur ? "selected" : ""}>${esc(v.name)}（${esc(VQ[v.quality] || "標準")}${v.gender ? "・" + esc(v.gender) : ""}）</option>`).join("")}</select></label>` +
      `<button id="voicetry">▶ 選んだ声を試しに聞く</button><p class="muted" style="margin-top:4px">「拡張」「プレミアム」の声ほど自然です。一覧に無い声は、下の案内でダウンロードすると出てきます（入れたらこの画面を開き直す）。</p>`;
  }
  window.__bcpVoiceInfo = () => { if (view === "set") renderSet(); };   // iPhone アプリが声の質を知らせてきたら設定を描き直す
  function renderSet() {
    const el = $("#v-set");
    const tels = store.get("tels", {});
    const saved = store.get("tilesSaved", null);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    let h = `<h1>設定</h1>`;
    if (!standalone && !NATIVE) h += `<div class="alert"><b>ホーム画面に追加してください</b>${isIOS ? "Safari の共有ボタン（□↑）→「ホーム画面に追加」。" : "ブラウザのメニュー →「ホーム画面に追加」または「アプリをインストール」。"}追加すると圏外でも開けます。</div>`;
    h += `<label>このスマホを使う人<select id="me"><option value="">選んでください</option>${["遠藤", "堀部"].map((n) => `<option ${n === me ? "selected" : ""}>${n}</option>`).join("")}</select></label>`;
    h += `<h2>人の連絡先（このスマホだけ）</h2>` + ["遠藤", "堀部"].map((n) => `<label>${n}の携帯電話<input data-tel="${n}" inputmode="tel" value="${esc(tels[n] || "")}"></label>`).join("");
    const sv2 = store.get("tilesSaved2", {});
    h += `<h2>地図</h2><p class="muted">範囲の全体：${sv2.base ? `${esc(hm(sv2.base.at))} に ${sv2.base.n}枚` : (saved ? `${esc(hm(saved.at))} に ${saved.n}枚（前の範囲）` : "未保存")}／詳しい地図（東京都＋隣接）：${sv2.detail ? `${esc(hm(sv2.detail.at))} に ${sv2.detail.n}枚` : "未保存"}／詳しい地図（その外側）：${sv2.detail2 ? `${esc(hm(sv2.detail2.at))} に ${sv2.detail2.n}枚` : "未保存"}（緊急→地図で保存。範囲を広げた 2026-11-12 より前に保存した分は、もう一度押すと足りない所だけ取ります）</p>`;
    h += `<h2>道案内の声</h2>${voiceHintHtml()}${voicePickHtml()}<button id="voicetest">🔊 声を試す</button>`;
    if (NATIVE && !window.__BCP_VOICES) { try { window.webkit.messageHandlers.bcp.postMessage({ voices: true }); } catch (e) { /* なし */ } }
    h += `<h2>表示</h2><label>色<select id="theme"><option value="light">明るい（既定）</option><option value="dark">暗い</option><option value="auto">端末に合わせる</option></select></label>`;
    h += `<h2>データ</h2><p class="muted">データ ${B ? esc(hm(B.built_at)) : "なし"}・端末で取得 ${esc(ago(store.get("fetched", "")))}</p><button id="reload" class="primary">最新にする</button>`;
    h += `<h2>暗証番号</h2>` + (store.get("wkey", null) ? `<p class="muted">4桁の暗証番号で守っています。</p><button id="pinchange">暗証番号を変える</button><button id="pinoff" class="ghost">暗証番号をやめる</button>` : `<p class="muted">暗証番号はまだありません。</p><button id="pinchange" class="primary">4桁の暗証番号を登録する</button>`);
    h += `<button id="forget" class="ghost">このスマホから鍵を消す</button>`;
    h += `<p class="muted" style="margin-top:20px">BCPレーダー。情報の収集とレポートは Mac mini が行い、共有ドライブ「92.BCP・情報収集」にも保存しています。地図は国土地理院の地理院タイル・重ねるハザードマップ。</p>`;
    el.innerHTML = h;
    $("#theme").value = store.get("theme", "light");
  }

  // ---------- 操作 ----------
  document.addEventListener("click", async (ev) => {
    const t = ev.target.closest("button, a");
    if (!t) return;
    if (t.dataset.v) return go(t.dataset.v);
    if (t.dataset.go) { ev.preventDefault(); const [v, s] = t.dataset.go.split(":"); if (s) sosTab = s; return go(v); }
    if (t.dataset.k !== undefined && t.closest(".seg")) { repKind = t.dataset.k; return renderReport(); }
    if (t.dataset.sub) { sosTab = t.dataset.sub; if (sosTab !== "map") { mapFull = false; document.body.classList.remove("mapfull"); } return renderSos(); }
    if (t.dataset.focus) { ev.preventDefault(); repFocus = t.dataset.focus; return go("report"); }
    if (t.dataset.hz) { ev.preventDefault(); repOpen = t.dataset.hz; return go("report"); }
    if (t.dataset.safe) { const loc = $("#withloc") && $("#withloc").checked ? await locate() : ""; return send(t.dataset.safe + loc, ["sos"]); }
    if (t.id === "sendmsg") { const v = $("#msg").value.trim(); if (!v) return; const loc = $("#withloc").checked ? await locate() : ""; $("#msg").value = ""; return send(v + loc); }
    if (t.dataset.img !== undefined && (t.tagName === "IMG" || t.tagName === "BUTTON")) { return showImage(t.dataset.img, t.tagName === "IMG" ? t.src : ""); }
    if (t.dataset.copyll) { try { await navigator.clipboard.writeText(t.dataset.copyll); toast("緯度経度を写しました"); } catch (e) { toast("長押しで選んで写してください"); } return; }
    if (t.dataset.posmap) { posShowOnMap(+t.dataset.posmap); return; }
    if (t.id === "posshow" || t.id === "poshide") { posShown = t.id === "posshow"; renderChat(); return; }
    if (t.id === "copytopic") { try { await navigator.clipboard.writeText(B.chat.topic); toast("写しました"); } catch (e) { toast("長押しで選んで写してください"); } return; }
    if (t.id === "unlock") return unlock();
    if (t.id === "pinopen") return pinOpen();
    if (t.id === "pinset") return pinSet();
    if (t.id === "pinskip") { store.set("rawkey", memKey); store.del("wkey"); lockMode = ""; go("now"); refresh(); pollChat(); return; }
    if (t.id === "skiplock") { sosTab = "tel"; return go("sos"); }
    if (t.id === "skipknow") return go("know");
    if (t.id === "pinchange") { lockMode = "setpin"; go("now"); return; }
    if (t.id === "pinoff") { if (confirm("暗証番号をやめますか？（このスマホを開ける人なら誰でも見られるようになります）")) { store.set("rawkey", memKey); store.del("wkey"); renderSet(); } return; }
    if (t.id === "here") return hereLocate();
    if (t.id === "shelhere") return shelHere();
    if (t.dataset.shelmap) return shelterShow(+t.dataset.shelmap);
    if (t.dataset.shelroute) { const r = SHEL && SHEL[+t.dataset.shelroute]; if (r) window.__bcpRouteTo(r[2], r[3], r[0]); return; }
    if (t.dataset.poi) return toggleShow(t.dataset.poi);
    if (t.dataset.unsend) return unsend(t.dataset.unsend);
    if (t.dataset.openonly) { store.set("openOnly", !store.get("openOnly", false)); return applyShow(); }
    if (t.id === "sosbtn") return sosStart();
    if (t.id === "savetiles") return saveTiles(null, "base");
    if (t.id === "savetiles2") return saveTiles(null, "detail");
    if (t.id === "savetiles3") return saveTiles(null, "detail2");
    if (t.id === "tilestop") { tileStop = true; try { window.webkit.messageHandlers.bcp.postMessage({ tilesCancel: true }); } catch (e) { /* なし */ } return; }
    if (t.dataset.ext === "yahoo") { setTimeout(() => { if (document.visibilityState === "visible") { const go2 = confirm("Yahoo!カーナビが開きませんでした（入っていないかもしれません）。App Store で Yahoo!カーナビ（無料）を開きますか？"); if (go2) window.open("https://apps.apple.com/jp/app/id890808217", "_blank"); } }, 2500); return; }
    if (t.id === "voicetry") { const sel = $("#voicepick"); try { window.webkit.messageHandlers.bcp.postMessage({ voiceTry: (sel && sel.value) || (window.__BCP_VOICE || {}).id || "", text: "500メートル先、河辺駅前の交差点を右方向です。青梅街道に入ります。" }); } catch (e) { /* なし */ } return; }
    if (t.id === "voicetest") { speakNow("300メートル先、長淵七丁目交差点を左です。国道411号に入ります。", 4); return; }
    if (t.dataset.rmode) { rmode = t.dataset.rmode; store.set("rmode", rmode); const b = $("#rgo"); if (b) b.textContent = rmode === "train" ? "iPhoneのマップで電車のルートを開く" : "ルートを出す"; document.querySelectorAll("[data-rmode]").forEach((x) => x.classList.toggle("on", x.dataset.rmode === rmode)); const ro = $("#ropts"); if (ro) ro.style.display = rmode === "car" ? "" : "none"; return; }
    if (t.dataset.ropt) { ropt = ROPT[t.dataset.ropt] ? t.dataset.ropt : "toll"; store.set("ropt", ropt); document.querySelectorAll("[data-ropt]").forEach((x) => x.classList.toggle("on", x.dataset.ropt === ropt)); return; }
    if (t.id === "rgo" || t.id === "rgo2") return routeGo();
    if (t.id === "rsearch") return placeSearch();
    if (t.dataset.pick) { ev.preventDefault(); return pickHit(+t.dataset.pick); }
    if (t.dataset.savedest) { const d = store.get("searchDest", null); if (!d) return; const l = store.get("dests", []); const nd = Object.assign({}, d, { id: "d:" + Date.now() }); l.push(nd); store.set("dests", l); store.del("searchDest"); store.set("rto", nd.id); toast("登録しました"); return renderSos(); }
    if (t.id === "navstart") { const r = store.get("routes", []).find((x) => x.name === t.dataset.rname); if (r) { window.scrollTo(0, 0); navStart(r); } return; }
    if (t.id === "navstop") return navStop();
    if (t.id === "navrecenter") return navFollow(true);
    if (t.id === "navpins") { const on = document.body.classList.toggle("navpins"); t.classList.toggle("on", on); return; }
    if (t.id === "navreroute") { if (nav && nav.lastPos) { nav.rr = { n: 0, at: 0, pos: null, fail: 0, manual: false, slow: false }; navNote(""); reroute(nav.lastPos[0], nav.lastPos[1], "", "manual"); } return; }
    if (t.id === "navheading") { const v = !headUp(); store.set("headUp2", v); t.textContent = v ? "🧭 進行方向が上" : "⬆ 北が上"; if (nav && nav.lastPos && map) { const m = followMark ? [followMark.getLatLng().lat, followMark.getLatLng().lng] : nav.lastPos; navView(m, null, false); } else if (map && map.setBearing) map.setBearing(0); return; }
    if (t.dataset.rshow) { const r = store.get("routes", [])[+t.dataset.rshow]; if (r) { showRoute(r); window.scrollTo(0, 0); } return; }
    if (t.dataset.rdel) { const l = store.get("routes", []); l.splice(+t.dataset.rdel, 1); store.set("routes", l); return renderSos(); }
    if (t.dataset.ddel) { const l = store.get("dests", []); l.splice(+t.dataset.ddel, 1); store.set("dests", l); return renderSos(); }
    if (t.id === "rtiles") { const r = store.get("routes", []).find((x) => x.name === t.dataset.rname); if (r) saveTiles(routeTileUrls(r)); return; }
    if (t.id === "follow") return toggleFollow();
    if (t.id === "addhere") { try { const p = await here(); const name = prompt("この場所の名前", "") || ""; if (!name) return; const l = store.get("dests", []); l.push({ id: "d:" + Date.now(), name: name.slice(0, 30), lat: Math.round(p.lat * 1e5) / 1e5, lon: Math.round(p.lon * 1e5) / 1e5 }); store.set("dests", l); renderSos(); } catch (e) { toast(e.message); } return; }
    if (t.id === "reload") return refresh(true);
    if (t.id === "forget") { if (confirm("このスマホから鍵と保存したデータを消しますか？（薬・チェックは残ります）。次はミッションボードのリンクから開きます")) { ["wkey", "rawkey", "env", "pinFail"].forEach((k) => store.del(k)); memKey = ""; B = null; lockMode = "none"; go("now"); } return; }
    if (t.id === "addcontact") { const n = $("#cname").value.trim(), tel = $("#ctel").value.trim(); if (!n || !tel) return; const l = store.get("mycontacts", []); l.push({ name: n, tel, note: $("#cnote").value.trim() }); store.set("mycontacts", l); return renderSos(); }
    if (t.id === "addmed") { const n = $("#mname").value.trim(); const per = parseFloat($("#mper").value), cnt = parseFloat($("#mcount").value); if (!n || !(per >= 0) || !(cnt >= 0)) return toast("名前・1日の数・残りを入れてください"); const l = store.get("meds", []); l.push({ name: n, perDay: per, count: cnt, date: today(), note: $("#mnote").value.trim() }); store.set("meds", l); return renderSos(); }
    if (t.dataset.medcount) { const l = store.get("meds", []); const m = l[+t.dataset.medcount]; const v = prompt(`${m.name} のいまの残りの数`, ""); if (v === null || !(parseFloat(v) >= 0)) return; m.count = parseFloat(v); m.date = today(); store.set("meds", l); return renderSos(); }
    if (t.dataset.kitdone) {
      const k = C.kits.find((x) => x.id === t.dataset.kitdone);
      const st = kitState(k); st.checkedAt = today(); saveKitState(k, st);
      const r = kitSummary(k);
      sosKit = k.id;
      const rec = { person: me || "未設定", kit: k.name, kitId: k.id, at: new Date().toISOString(), have: r.have, total: r.total, missing: r.missing, expired: r.expired, soon: r.soon };
      const msg = `${k.name}：${r.have}/${r.total} そろい` + (r.missing.length ? `\n足りない：${r.missing.join("、")}` : "") + (r.expired.length ? `\n期限切れ：${r.expired.join("、")}` : "") + (r.soon.length ? `\n期限が近い：${r.soon.join("、")}` : "") + `\n#BCPKIT ${JSON.stringify(rec)}`;
      renderSos();
      return send(`防災グッズ点検｜${msg}`, ["kit"], { ntfyOnly: true });
    }
    if (t.dataset.meddel) { const l = store.get("meds", []); if (!confirm(`${l[+t.dataset.meddel].name} を消しますか？`)) return; l.splice(+t.dataset.meddel, 1); store.set("meds", l); return renderSos(); }
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && mapFull) return setMapFull(false);
    if (ev.key !== "Enter") return;
    if (ev.target.id === "pin") pinOpen();
    else if (ev.target.id === "pin2") pinSet();
    else if (ev.target.id === "pass") unlock();
    else if (ev.target.id === "rq") { ev.preventDefault(); placeSearch(); }
  });
  // 会話の写真（小さな画像）を押したら大きく出す
  document.addEventListener("click", (ev) => { const im = ev.target.closest && ev.target.closest("img.thumb"); if (im) showImage(im.dataset.img, im.src); });
  // 自分の吹き出しを押すと「送信を取り消す」を出す（写真・リンク・ボタンを押したときは除く）
  document.addEventListener("click", (ev) => {
    const t = ev.target; if (!t.closest || t.closest("img, a, button")) return;
    const b = t.closest("#talk .b.can-unsend"); if (!b) return;
    const was = b.classList.contains("sel");
    document.querySelectorAll("#talk .b.sel").forEach((x) => x.classList.remove("sel"));
    if (!was) b.classList.add("sel");
  });
  document.addEventListener("change", (ev) => {
    if (ev.target && ev.target.id === "voicepick") { try { window.webkit.messageHandlers.bcp.postMessage({ voicePick: ev.target.value }); } catch (e) { /* なし */ } toast("声を替えました。次の案内からこの声で話します"); return; }
    const t = ev.target;
    if (t.dataset.kititem || t.dataset.kitexp) {
      const [kid, iid] = (t.dataset.kititem || t.dataset.kitexp).split("|");
      const k = C.kits.find((x) => x.id === kid); const st = kitState(k);
      const v = st.items[iid] || {};
      if (t.dataset.kititem) v.have = t.checked; else { v.exp = t.value; if (t.value) v.have = true; }
      st.items[iid] = v; saveKitState(k, st); sosKit = kid;
      const y = window.scrollY; renderSos(); window.scrollTo(0, y);
    }
    if (t.dataset.tel) { const st = store.get("tels", {}); st[t.dataset.tel] = t.value.trim(); store.set("tels", st); }
    if (t.dataset.medcard) { const st = store.get("medcard", {}); st[t.dataset.medcard] = t.value; store.set("medcard", st); }
    if (t.id === "me") { me = t.value; store.set("me", me); }
    if (t.id === "photo" && t.files && t.files[0]) { sendPhoto(t.files[0]); t.value = ""; }
    if (t.id === "withloc") store.set("withloc", t.checked);
    if (t.id === "medth") { store.set("medDays", Math.max(1, parseInt(t.value, 10) || 14)); }
    if (t.id === "theme") { store.set("theme", t.value); applyTheme(); }
    if (t.id === "shelf") { store.set("shelF", t.value); fillShelters(); drawShelters(); }
  });
  // 既定は明るい表示（2026-09-28 遠藤先生「見た目が暗い。クリアな感じが欲しい」）。暗い表示・端末に合わせるは設定で選ぶ
  function applyTheme() { const v = store.get("theme", "light"); if (v === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v; }

  window.addEventListener("online", () => { netBadge(); flushOutbox().then(pollChat); refresh(); });
  window.addEventListener("offline", () => { netBadge(); if (map && $("#roadinfo")) roadsUpdate(); });
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (nav) { sayStopAll(); if (document.visibilityState !== "hidden") { voiceQ.quietTill = Date.now() + 2500; setTimeout(navResume, 2600); } }
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); if (posShown) { posShown = false; if (view === "chat") renderChat(); } return; }   // 裏へ回したら位置を隠し直す
    if (store.get("wkey", null) && memKey && hiddenAt && Date.now() - hiddenAt > 5 * 60e3) { memKey = ""; B = null; lockMode = "pin"; go(view === "sos" ? "now" : view); return; }
    refresh(); pollChat();
  });
  setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 5 * 60e3);
  // 営業時間は時刻で変わるので、地図を開いている間は3分ごとに施設の印を判定し直す（説明を開いている間は描き直さない）
  setInterval(() => { if (document.visibilityState === "visible" && map && view === "sos" && store.get("poiOn", []).some((k) => POI[k])) drawPois(); }, 3 * 60e3);
  setInterval(() => { if (document.visibilityState === "visible") pollChat(); }, 30e3);

  if ("serviceWorker" in navigator && !NATIVE) navigator.serviceWorker.register("sw.js").catch(() => {});
  applyTheme();
  // 起動：リンク（#k=）・TestFlight 版の鍵 → 暗証番号が無ければ決めてもらう。暗証番号を決めてあれば聞く
  (async () => {
    const lk = takeLinkKey();
    if (lk) {
      try {
        await keyWorks(lk);
        memKey = lk;
        if (store.get("rawkey", "")) store.set("rawkey", lk);
        else if (!store.get("wkey", null)) lockMode = "setpin";
      } catch (e) { /* 鍵が合わない・初回で圏外 → いつもの開き方へ */ }
    } else if (store.get("rawkey", "")) {
      memKey = store.get("rawkey", "");
    }
    go(lockMode ? "now" : view);
    refresh();
    pollChat();
    if (NATIVE) setTimeout(() => { loadShelters(); loadHours(); fetch("poi_extra.json").catch(() => {}); }, 3000);
    // iPhone 版：応急手当の絵（全部）も先に取って裏方に残す（絵は開いたときしか読まないため、前の版のアプリでも一度開けば圏外で出るように。2026-11-12）
    // iPhone 版：知識の記事一式も先に取って裏方に残す（圏外で初めて「知識」を開いても読めるように。2026-11-13）
    if (NATIVE && window.BCP_KNOW) setTimeout(() => window.BCP_KNOW.load(), 8000);
    if (NATIVE) setTimeout(() => { const F = window.BCP_AID_FIGURES || {}; Object.keys(F).forEach((k) => F[k].forEach((f) => { if (f.src) fetch(f.src).catch(() => {}); })); }, 6000);   // iPhone 版：避難所の一覧を先に読んでおく（裏方がこの時に公開先から取って端末に残す＝圏外でも出る。PWA は sw.js が画面と一緒に保存）
  })();
})();
