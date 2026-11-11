// 施設の営業時間（OpenStreetMap の opening_hours）を日本時間で読む（2026-11-12 遠藤先生「マップはそれぞれ営業時間も反映させてほしい」）
// 圏外でも動くよう、外の部品を使わない小さな読み取り。よく使われる書き方だけを読み、読めない書き方は「不明」にする。
//   読めるもの：24/7、曜日（Mo-Fr・Sa,Su）、祝日（PH＝日本の祝日。振替休日・国民の休日を含む）、時間帯（複数・夜をまたぐ・24:00・00:00 まで）、
//               off / closed、「;」（後の決まりが前を上書き）、「時間の後の , 曜日」（足す決まり）
//   読めないもの（不明）：月日・年・週の指定、SH（学校の休み）、日の出など、「+」（閉店時刻なし）、「||」、注記（"..."）など
(function (root) {
  "use strict";
  const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const JA = { Mo: "月", Tu: "火", We: "水", Th: "木", Fr: "金", Sa: "土", Su: "日", PH: "祝" };

  // ---------- 日本の祝日（国民の祝日に関する法律。2026-11 時点） ----------
  const hcache = {};
  function nthMonday(y, m, n) { const w = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); return 1 + ((8 - w) % 7) + (n - 1) * 7; }
  function holidaysOf(y) {
    if (hcache[y]) return hcache[y];
    const base = new Set();
    const add = (m, d) => base.add(m * 100 + d);
    add(1, 1); add(1, nthMonday(y, 1, 2)); add(2, 11); add(2, 23);
    add(3, Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)));   // 春分の日（1980〜2099年の近似）
    add(4, 29); add(5, 3); add(5, 4); add(5, 5); add(7, nthMonday(y, 7, 3)); add(8, 11); add(9, nthMonday(y, 9, 3));
    add(9, Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)));   // 秋分の日
    add(10, nthMonday(y, 10, 2)); add(11, 3); add(11, 23);
    const all = new Set(base);
    const key = (dt) => (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate();
    // 振替休日：祝日が日曜なら、その後の最初の祝日でない日
    base.forEach((md) => {
      const dt = new Date(Date.UTC(y, Math.floor(md / 100) - 1, md % 100));
      if (dt.getUTCDay() !== 0) return;
      const n = new Date(dt);
      do { n.setUTCDate(n.getUTCDate() + 1); } while (all.has(key(n)) && n.getUTCFullYear() === y);
      if (n.getUTCFullYear() === y) all.add(key(n));
    });
    // 国民の休日：前日と翌日が祝日の平日
    for (let m = 1; m <= 12; m++) for (let d = 1; d <= 31; d++) {
      const dt = new Date(Date.UTC(y, m - 1, d)); if (dt.getUTCMonth() !== m - 1) continue;
      const p = new Date(dt); p.setUTCDate(d - 1); const q = new Date(dt); q.setUTCDate(d + 1);
      if (!all.has(m * 100 + d) && dt.getUTCDay() !== 0 && base.has(key(p)) && base.has(key(q)) && p.getUTCFullYear() === y && q.getUTCFullYear() === y) all.add(m * 100 + d);
    }
    hcache[y] = all;
    return all;
  }
  // jd＝日本時間の日付（UTC の値として持つ Date）
  const isHoliday = (jd) => holidaysOf(jd.getUTCFullYear()).has((jd.getUTCMonth() + 1) * 100 + jd.getUTCDate());

  // ---------- 読み取り ----------
  const pcache = new Map();
  const DAYTOK = "(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)";
  const DAYSEL = new RegExp(`^(${DAYTOK}(?:-${DAYTOK})?(?:\\s*,\\s*${DAYTOK}(?:-${DAYTOK})?)*)(?:\\s+|$)(.*)$`);
  const TIME = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;
  function parseDays(sel) {
    const set = new Set();
    for (const part of sel.split(/\s*,\s*/)) {
      const [a, b] = part.split("-");
      if (a === "PH") { if (b) return null; set.add("PH"); continue; }
      if (b === "PH") return null;
      const i = DAYS.indexOf(a), j = b ? DAYS.indexOf(b) : i;
      if (i < 0 || j < 0) return null;
      for (let k = i; ; k = (k + 1) % 7) { set.add(DAYS[k]); if (k === j) break; }
    }
    return set;
  }
  function parseTimes(t) {
    t = t.trim();
    if (/^(off|closed)$/i.test(t)) return [];
    if (t === "" || t === "24/7") return [[0, 1440]];
    const out = [];
    for (const r of t.split(/\s*,\s*/)) {
      const m = r.match(TIME); if (!m) return null;
      const s = +m[1] * 60 + +m[2]; let e = +m[3] * 60 + +m[4];
      if (+m[2] > 59 || +m[4] > 59 || s > 1440 || e > 1440 + 12 * 60) return null;
      if (e <= s) e += 1440;   // 夜をまたぐ（22:00-02:00）・00:00 まで（07:00-00:00）・00:00-00:00（一日中）
      out.push([s, e]);
    }
    return out;
  }
  function parse(oh) {
    if (pcache.has(oh)) return pcache.get(oh);
    let r = null;
    try {
      const t = String(oh || "").normalize("NFKC").replace(/[–—〜~]/g, "-").replace(/\s+/g, " ").replace(/(\d)\s*-\s*(\d)/g, "$1-$2").trim();
      if (!t || /\|\||"|\+|sunrise|sunset|dawn|dusk|SH|week|\[|\d{4}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|easter/i.test(t.replace(/\boff\b/gi, ""))) r = null;
      else {
        const rules = [];
        let ok = true;
        for (const part of t.split(/\s*;\s*/).filter(Boolean)) {
          // 「時間の後の , 曜日」は足す決まり（Mo-Fr 09:00-18:00, Sa 09:00-12:00）
          const subs = part.replace(/(\d\d|off|closed)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)\b)/gi, "$1\u0001").split("\u0001");
          subs.forEach((sub, i) => {
            if (!ok) return;
            const m = sub.trim().match(DAYSEL);
            let days = null, rest = sub.trim();
            if (m) { days = parseDays(m[1]); rest = m[2]; if (!days) ok = false; }
            const times = parseTimes(rest);
            if (!times) ok = false;
            rules.push({ days, times, add: i > 0 });
          });
        }
        r = ok && rules.length ? rules : null;
      }
    } catch (e) { r = null; }
    pcache.set(oh, r);
    return r;
  }
  // その日（日本時間の日付）の営業の時間帯（分。夜をまたぐものは 1440 を超える）
  function dayIntervals(rules, jd) {
    const wd = DAYS[jd.getUTCDay()], ph = isHoliday(jd);
    let iv = [];
    for (const r of rules) {
      const hit = !r.days || r.days.has(wd) || (ph && r.days.has("PH"));
      if (!hit) continue;
      iv = r.add ? iv.concat(r.times) : r.times.slice();
    }
    return iv;
  }
  const jstDate = (now, plusDays) => { const j = new Date(now.getTime() + 9 * 3600e3); return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + (plusDays || 0))); };
  const hm = (min) => `${Math.floor((min % 1440) / 60)}:${String(min % 60).padStart(2, "0")}`;
  // 今の状態：{ s: "open" | "closed" | "24h" | "unknown", until: "20:00", next: "明日 9:00" }
  function status(oh, now) {
    now = now || new Date();
    const rules = parse(oh);
    if (!rules) return { s: "unknown" };
    const j = new Date(now.getTime() + 9 * 3600e3), m = j.getUTCHours() * 60 + j.getUTCMinutes();
    // 7日すべて一日中なら「24時間」
    let always = true;
    for (let k = 0; k < 7 && always; k++) { const iv = dayIntervals(rules, jstDate(now, k)); always = iv.some(([s, e]) => s <= 0 && e >= 1440); }
    if (always) return { s: "24h" };
    const today = dayIntervals(rules, jstDate(now, 0)), yest = dayIntervals(rules, jstDate(now, -1));
    const cur = today.find(([s, e]) => s <= m && m < e) || yest.map(([s, e]) => [s - 1440, e - 1440]).find(([s, e]) => s <= m && m < e);
    if (cur) {
      // 次の日も0時から続くなら、閉まる時刻まで延ばす（Mo-Sa 00:00-24:00 の月曜は「土曜 24:00 まで」）
      let end = cur[1], k = 0;
      while (end >= 1440 && k < 7) { k++; const nx = dayIntervals(rules, jstDate(now, k)).find(([s]) => s <= end - 1440 * k); if (!nx) break; end = nx[1] + 1440 * k; }
      const wd = jstDate(now, Math.floor(end / 1440)).getUTCDay(), d = Math.floor(end / 1440);
      const until = end % 1440 === 0 ? (d <= 1 ? "24:00" : `${"日月火水木金土"[(wd + 6) % 7]}曜 24:00`) : (d === 0 ? "" : d === 1 ? "翌" : `${"日月火水木金土"[wd]}曜 `) + hm(end);
      return { s: "open", until };
    }
    for (let k = 0; k <= 7; k++) {
      const iv = dayIntervals(rules, jstDate(now, k)).filter(([s]) => k > 0 || s > m).sort((a, b) => a[0] - b[0]);
      if (iv.length) {
        const wd = jstDate(now, k).getUTCDay();
        const day = k === 0 ? "今日" : k === 1 ? "明日" : `${"日月火水木金土"[wd]}曜`;
        return { s: "closed", next: `${day} ${hm(iv[0][0])}` };
      }
    }
    return { s: "closed", next: "" };
  }
  // 画面に出す言い方（曜日・祝日・休みを日本語に）
  function toJa(oh) {
    return String(oh || "").replace(/24\/7/g, "24時間").replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (d) => JA[d]).replace(/\b(off|closed)\b/gi, "休み").replace(/;\s*/g, "／");
  }
  const api = { status, parse, toJa, isHoliday, holidaysOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.BCP_OH = api;
})(typeof self !== "undefined" ? self : this);
