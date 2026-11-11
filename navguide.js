// 道案内の案内文・矢印・外のアプリへの引き継ぎ（2026-11-12 夕 遠藤先生「声が機械的・案内が雑。Google マップや Yahoo 地図のような分かりやすい案内に」「矢印を使うとか視覚的分かりやすさ」）
// 経路検索の答え（OSRM の steps・Valhalla の maneuvers）から、曲がる所ごとの「動作」を作り、画面の矢印・文字と声の文を作る。外の部品なし・圏外でも動く。
// 動作（g）：{ a: 種類, d: 向き, jn: 交差点名, road: 入る道, to: 方面, exit: ロータリーの出口番号, side: 目的地の左右, hw: 高速の上か, quiet: 言わない（道なり） }
//   a：depart（出発）・turn（曲がる）・keep（分岐で左右の道へ）・ramp（入口）・exit（出口）・jct（高速から高速へ乗り継ぐ）・merge（合流）・round（ロータリー）・uturn（引き返す）・arrive（到着）・straight（道なり）
//   d：left・right・slight-left・slight-right・sharp-left・sharp-right・straight
(function (root) {
  "use strict";
  const JA = /[぀-ヿ一-鿿]/;
  const EXPRESS = /自動車道|高速|首都高|圏央道|外環|有料|ハイウェイ|スカイライン|バイパス.*有料|湾岸線|横羽線|狩場線|ターンパイク/;
  // 読み替え（声）：括弧は読点、ローマ字は落とす、IC→インター など
  function speakable(t) {
    return String(t || "").replace(/[（(]/g, "、").replace(/[）)]/g, "").replace(/\s*\/\s*[A-Za-z][^、。]*$/g, "")
      .replace(/\bIC\b|ＩＣ/g, "インター").replace(/\bJCT\b|ＪＣＴ/g, "ジャンクション").replace(/\bSA\b/g, "サービスエリア").replace(/\bPA\b/g, "パーキングエリア")
      .replace(/^R(\d+)$/, "国道$1号").replace(/\bE(\d+)\b/g, "イー$1");
  }
  // 道の名前：日本語の名前を優先。「国道411号」があればそれ。番号だけ・ローマ字は使わない
  function roadName(names, ref) {
    const a = (names || []).map((x) => String(x).trim()).filter(Boolean);
    const kokudo = a.find((x) => /^国道\d+号$/.test(x));
    const ja = a.find((x) => JA.test(x) && !/^国道\d+号$/.test(x));
    if (ja) return ja;
    if (kokudo) return kokudo;
    if (ref && /^\d+$/.test(ref)) return "";   // 都道・県道の番号だけでは国道か分からないので言わない
    return "";
  }
  const isExpress = (name, ref) => EXPRESS.test(name || "") || /^(E\d|C[1-4]$|CA$)/.test(ref || "");
  const MODD = { left: "left", right: "right", "slight left": "slight-left", "slight right": "slight-right", "sharp left": "sharp-left", "sharp right": "sharp-right", straight: "straight", uturn: "uturn" };
  // ---- OSRM の1つの段 → 動作 ----
  function fromOsrm(st, prev, last) {
    const m = st.maneuver || {}, ty = m.type, d = MODD[m.modifier] || "straight";
    const road = roadName([st.name], st.ref), hw = isExpress(st.name, st.ref), prevRoad = prev ? prev.road : "";
    const to = st.destinations ? String(st.destinations).split(/[,;:]/).map((x) => x.trim()).filter((x) => JA.test(x)).slice(0, 2).join("・") : "";   // 方面（番号だけ・ローマ字は使わない）
    const g = { a: "turn", d, road, to, hw };
    if (ty === "depart") g.a = "depart";
    else if (ty === "arrive") { g.a = "arrive"; g.side = m.modifier === "left" ? "left" : m.modifier === "right" ? "right" : ""; }
    else if (ty === "roundabout" || ty === "rotary" || ty === "roundabout turn") { g.a = "round"; g.exit = m.exit || 0; }
    else if (ty === "fork") g.a = "keep";
    else if (ty === "on ramp") g.a = "ramp";
    else if (ty === "off ramp") g.a = "exit";
    else if (ty === "merge") g.a = "merge";
    else if (d === "uturn") g.a = "uturn";
    else if (ty === "new name" || ty === "continue" || ty === "notification" || ty === "use lane") {
      // 名前が変わるだけ・ゆるいカーブは言わない（道なり）
      if (d === "straight" || d === "slight-left" || d === "slight-right") { g.a = "straight"; g.quiet = 1; }
    } else if (ty === "end of road") g.a = "turn";
    if (g.a === "turn" && d === "straight") { g.a = "straight"; g.quiet = road && road === prevRoad ? 1 : 0; }
    if (last && g.a !== "arrive") g.a = "arrive";
    return g;
  }
  // ---- Valhalla の1つの動作 → 動作 ----
  const VT = { 9: "slight-right", 10: "right", 11: "sharp-right", 14: "sharp-left", 15: "left", 16: "slight-left", 18: "right", 19: "left", 20: "right", 21: "left", 23: "right", 24: "left", 37: "right", 38: "left" };
  function jnOf(ins) {   // 「長淵七丁目/Nagabuchi 7を左方向です」→ 長淵七丁目
    const mm = String(ins || "").match(/^([^、。]+?)(?:\/[^を、。]*)?を(?:右|左|斜め|大きく|直進|道なり)/);
    if (!mm) return "";
    const j = mm[1].trim();
    return JA.test(j) && !/方向|^その先/.test(j) ? j : "";
  }
  function toOf(ins) {   // 「左方向、五日市/日の出町方面です」→ 五日市・日の出町
    const mm = String(ins || "").match(/、([^、。]+?)方面/);
    return mm ? mm[1].split("/").filter((x) => JA.test(x)).join("・") : "";
  }
  function fromValhalla(m, prev, last) {
    const ty = m.type, ins = m.instruction || "";
    const road = roadName(m.street_names, ""), hw = !!m.highway || (m.street_names || []).some((x) => isExpress(x, ""));
    const g = { a: "turn", d: VT[ty] || "straight", road, to: toOf(ins), jn: jnOf(ins), hw };
    if (ty >= 1 && ty <= 3) g.a = "depart";
    else if (ty >= 4 && ty <= 6) { g.a = "arrive"; g.side = ty === 5 ? "right" : ty === 6 ? "left" : ""; }
    else if (ty === 7 || ty === 8 || ty === 22) { g.a = "straight"; g.quiet = 1; }
    else if (ty === 12 || ty === 13) g.a = "uturn";
    else if (ty >= 17 && ty <= 19) g.a = "ramp";
    else if (ty === 20 || ty === 21) g.a = "exit";
    else if (ty === 23 || ty === 24) g.a = "keep";
    else if (ty === 25 || ty === 37 || ty === 38) g.a = "merge";
    else if (ty === 26) { g.a = "round"; g.exit = m.roundabout_exit_count || 0; }
    else if (ty === 27) { g.a = "straight"; g.quiet = 1; }
    else if (ty === 28 || ty === 29) { g.a = "straight"; g.quiet = 1; }
    if (last) g.a = "arrive";
    return g;
  }
  // ---- 高速の入口・出口・乗り継ぎを、前後の道で決め直す（2026-11-13 遠藤先生「高速道路に乗る時、普通なら入口の案内をするのですが、
  //      現状は出口を出ます、という案内になるので分かりづらい」）
  // 経路検索は「いま走っている道から斜路へ降りる」所をみな off ramp（Valhalla は exit）と呼ぶ。バイパスや国道から高速へ乗る所も出口になる。
  // そこで、斜路の前に走っていた道と、斜路のあとに入る道が高速かどうかで決める：
  //   一般道→高速＝入口（「圏央道の入口を右方向です」）・高速→高速＝乗り継ぎ（「中央道 河口湖・甲府方面へ、左側の道へ」）・高速→一般道＝出口
  const RAMPISH = /ETC|料金所|ランプ|連絡路|入口|出口|IC$|ＩＣ|インター|JCT|ジャンクション/;
  function fixRamps(gs) {
    const L = gs.length;
    gs.forEach((g) => { if (g && /^ETC専用$/.test(g.road || "")) g.road = "ETC専用レーン"; });
    for (let i = 0; i < L; i++) {
      const g = gs[i];
      if (!g || (g.a !== "exit" && g.a !== "ramp")) continue;
      let before = null;   // 斜路の前に走っていた道（名前のある直前の動作）
      for (let k = i - 1; k >= 0; k--) { const p = gs[k]; if (p && (p.road || p.hw)) { before = p; break; } if (p && (p.a === "depart")) break; }
      let after = null, afterName = "";    // 斜路のあとに入る道（分岐・道なり・合流を越えて、高速か・名前のある最初の動作）
      for (let k = i + 1; k < L; k++) {
        const n = gs[k]; if (!n) continue;
        if (n.a === "arrive") break;
        if (!n.hw && RAMPISH.test(n.road || "")) continue;   // 「ETC専用」「料金所」など、斜路の途中の名前は越えて見る
        if (!after && (n.road || n.hw)) after = n;
        if (n.road) { afterName = n.road; break; }
        if (n.a === "turn" || n.a === "round" || n.a === "uturn") break;   // 斜路の先で交差点を曲がる＝一般道へ降りた
      }
      const bHw = !!(before && before.hw), aHw = !!(after && after.hw);
      if (!bHw && aHw) { g.a = "ramp"; if (!g.road) g.road = afterName; }   // 名前のある斜路（バイパスなど）はその名前のまま
      else if (bHw && aHw && g.a === "exit") { g.a = "jct"; if (afterName && afterName !== (before && before.road)) g.road = afterName; }
      else if (bHw && !aHw && g.a === "ramp") g.a = "exit";
    }
    return gs;
  }
  // ---- 文字（画面の短い動作）と矢印 ----
  const DW = { left: "左", right: "右", "slight-left": "斜め左", "slight-right": "斜め右", "sharp-left": "大きく左", "sharp-right": "大きく右", straight: "直進" };
  function actText(g) {   // 画面の「その先 左」などの短い言い方
    switch (g.a) {
      case "arrive": return g.side ? `目的地（${DW[g.side]}側）` : "目的地";
      case "uturn": return "引き返す";
      case "round": return g.exit ? `ロータリー ${g.exit}番目の出口` : "ロータリー";
      case "keep": return `${DW[g.d] || ""}側の道へ`.replace(/^側/, "");
      case "exit": return `出口（${DW[g.d] || "直進"}）`;
      case "ramp": return `入口（${DW[g.d] || "直進"}）`;
      case "jct": return `${DW[g.d] || ""}側の道へ（乗り継ぎ）`.replace(/^側/, "");
      case "merge": return "合流";
      case "straight": return "道なり";
      case "depart": return "出発";
      default: return DW[g.d] || "直進";
    }
  }
  // 矢印の絵（SVG）。動作ごとに形を変え、曲がる角度を合わせる
  const ARROW_ANG = { left: -90, right: 90, "slight-left": -45, "slight-right": 45, "sharp-left": -135, "sharp-right": 135, straight: 0 };
  function arrowSvg(g, size) {
    const s = size || 64, c = "#fff";
    const wrap = (inner) => `<svg class="navarrow a-${g.a} d-${g.d || "straight"}" viewBox="0 0 64 64" width="${s}" height="${s}" aria-hidden="true">${inner}</svg>`;
    if (g.a === "arrive") return wrap(`<path d="M20 58V8" stroke="${c}" stroke-width="5" stroke-linecap="round"/><path d="M22 9h26l-6 9 6 9H22z" fill="${c}"/>`);
    if (g.a === "uturn") return wrap(`<path d="M42 58V26a12 12 0 0 0-24 0v8" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/><path d="M8 30l10 14 10-14z" fill="${c}"/>`);
    if (g.a === "round") return wrap(`<circle cx="32" cy="34" r="11" fill="none" stroke="${c}" stroke-width="6"/><path d="M32 60V45" stroke="${c}" stroke-width="7" stroke-linecap="round"/><path d="M43 30l13-12" stroke="${c}" stroke-width="7" stroke-linecap="round"/><path d="M46 12h12v12z" fill="${c}"/>${g.exit ? `<text x="32" y="39" font-size="13" font-weight="800" fill="${c}" text-anchor="middle">${g.exit}</text>` : ""}`);
    if (g.a === "merge") { const r = g.d === "left" || g.d === "slight-left" ? -1 : 1; return wrap(`<path d="M32 60V20" stroke="${c}" stroke-width="7" stroke-linecap="round"/><path d="M${32 + r * 20} 60 Q${32 + r * 20} 38 32 30" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" opacity=".75"/><path d="M22 22l10-14 10 14z" fill="${c}"/>`); }
    if (g.a === "keep" || g.a === "exit" || g.a === "ramp" || g.a === "jct") {   // 分岐：選ぶ側を太く、もう一方を細く
      const r = /left/.test(g.d) ? -1 : 1;
      return wrap(`<path d="M32 60V38" stroke="${c}" stroke-width="7" stroke-linecap="round"/><path d="M32 38L${32 - r * 16} 14" stroke="${c}" stroke-width="4" stroke-linecap="round" opacity=".45"/><path d="M32 38L${32 + r * 16} 14" stroke="${c}" stroke-width="7" stroke-linecap="round"/><path d="M${32 + r * 22} 6l${-r * 2} 16l${-r * 12}-8z" fill="${c}"/>`);
    }
    const ang = ARROW_ANG[g.d] == null ? 0 : ARROW_ANG[g.d];
    // 曲がる矢印：下から上がってきて、角で ang 度曲がる
    const rad = ang * Math.PI / 180, L = 20, ex = 32 + Math.sin(rad) * L, ey = 26 - Math.cos(rad) * L;
    const hx = ex + Math.sin(rad) * 6, hy = ey - Math.cos(rad) * 6, px = Math.cos(rad) * 9, py = Math.sin(rad) * 9;
    return wrap(`<path d="M32 60V26L${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><path d="M${(hx).toFixed(1)} ${(hy).toFixed(1)}L${(ex - px).toFixed(1)} ${(ey - py).toFixed(1)}L${(ex + px).toFixed(1)} ${(ey + py).toFixed(1)}z" fill="${c}"/>`);
  }
  // ---- 声の文 ----
  function distSay(m) {
    if (m < 100) return "";
    if (m < 1000) return `${Math.round(m / 50) * 50}メートル`;
    const k = Math.round(m / 100) / 10;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}キロ`;
  }
  const jnPart = (g) => (g.jn ? (/交差点$|インター$|IC$|ジャンクション$|JCT$|入口$|出口$/.test(g.jn) ? `${speakable(g.jn)}を` : `${speakable(g.jn)}交差点を`) : "");
  // 動作そのものの言い方（距離の前置きは付けない）
  function actSay(g, cur) {
    const road = g.road && g.road !== (cur || "") ? speakable(g.road) : "";
    const to = g.to ? `${speakable(g.to)}方面` : "";
    switch (g.a) {
      case "arrive": return `目的地です${g.side ? `。目的地は${DW[g.side]}側です` : ""}`;
      case "uturn": return "安全な所で、引き返してください";
      case "round": return `ロータリーを${g.exit ? `${g.exit}番目の出口へ` : "進み"}、${road ? road + "へ" : ""}進んでください`.replace(/、進んでください$/, "です");
      case "keep": return `${to ? to + "、" : ""}${DW[g.d] || ""}側の道へ進んでください`;
      case "exit": return `${g.jn ? speakable(g.jn) + "で" : ""}出口です。${DW[g.d] || ""}方向へ進んでください`.replace("出口です。方向へ進んでください", "出口です");
      case "ramp": return `${to ? to + "、" : ""}${road ? road + "の" : ""}入口を${DW[g.d] || "直進"}方向です`;
      case "jct": return `${g.jn ? speakable(g.jn) + "で、" : ""}${road ? road + "、" : ""}${to ? to + "、" : ""}${DW[g.d] || ""}側の道へ進んでください`.replace(/、側の道へ/, "、その道へ");
      case "merge": return `${road ? road + "に" : ""}合流します`;
      case "straight": return road ? `道なりに、${road}に入ります` : "道なりです";
      case "depart": return road ? `${road}を進みます` : "";
      default: {
        const dir = DW[g.d] || "直進";
        return `${jnPart(g)}${dir}${/^(斜め|大きく)/.test(dir) ? "方向" : ""}です${road ? `。${road}に入ります` : to ? `。${to}です` : ""}`;
      }
    }
  }
  // phase：far（予告）・mid（もう一度）・near（直前）。next：その次の動作（すぐ続くなら「その先、すぐ左です」）
  function phrase(g, dist, phase, next, nextGap, cur, foot) {
    const head = phase === "near" || dist < 100 ? "まもなく、" : `${distSay(dist)}先、`;
    let t = head + actSay(g, cur);
    if (next && !next.quiet && nextGap != null && nextGap <= (foot ? 40 : 150) && next.a !== "depart") t += `。その先、すぐ${next.a === "arrive" ? "目的地です" : actText(next) + "です"}`;
    return t + "。";
  }
  // 予告の距離（秒で決める）：一般道 約30秒・12秒前・直前（4秒、最低40m）、高速 2km・1km・500m、徒歩 50m・15m
  function marks(v, hw, foot) {
    if (foot) return [["far", 50], ["near", 15]];
    if (hw) return [["far", 2000], ["mid", 1000], ["near", 500]];
    const s = Math.max(8, v || 0);
    return [["far", Math.min(1000, Math.max(300, s * 30))], ["mid", Math.min(400, Math.max(120, s * 12))], ["near", Math.max(40, s * 4)]];
  }
  // ---- 外のアプリへの引き継ぎ ----
  // 経由地：ルートの形を保つため、ルートの線から等間隔に選ぶ（Google のスマホ3・Yahoo!カーナビ3・Apple 5）
  function pickVias(coords, n) {
    if (!coords || coords.length < 3 || n <= 0) return [];
    const out = [];
    for (let i = 1; i <= n; i++) { const k = Math.round(i * (coords.length - 1) / (n + 1)); out.push(coords[k]); }
    return out;
  }
  const ll = (p) => `${(+p[0]).toFixed(5)},${(+p[1]).toFixed(5)}`;
  function extLinks(rec, from, to) {
    const car = rec.mode === "car", noToll = car && (rec.opt === "free" || rec.opt === "safe");
    const vias = car ? pickVias(rec.coords, 3) : [];
    const g = `https://www.google.com/maps/dir/?api=1&origin=${ll([from.lat, from.lon])}&destination=${ll([to.lat, to.lon])}&travelmode=${car ? "driving" : "walking"}` +
      (vias.length ? `&waypoints=${encodeURIComponent(vias.map(ll).join("|"))}` : "") + (noToll ? `&avoid=${encodeURIComponent(rec.opt === "safe" ? "tolls,highways" : "tolls")}` : "") + "&dir_action=navigate";
    const av = car ? pickVias(rec.coords, 5) : [];
    const a = `https://maps.apple.com/directions?source=${ll([from.lat, from.lon])}&destination=${ll([to.lat, to.lon])}` + av.map((p) => `&waypoint=${ll(p)}`).join("") +
      `&mode=${car ? "driving" : "walking"}` + (noToll ? `&avoid=${rec.opt === "safe" ? "tolls,highways" : "tolls"}` : "");
    const y = car ? `yjcarnavi://navi/select?point=current&` + vias.map((p) => `point=${ll(p)},`).join("&") + (vias.length ? "&" : "") + `point=${ll([to.lat, to.lon])},${encodeURIComponent(String(to.name || "").replace(/,/g, " "))}` : "";
    return { google: g, apple: a, yahoo: y, yahooStore: "https://apps.apple.com/jp/app/id890808217", vias: vias.length };
  }
  const api = { fromOsrm, fromValhalla, fixRamps, actText, actSay, arrowSvg, phrase, distSay, marks, speakable, roadName, jnOf, toOf, extLinks, pickVias };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BCPNavGuide = api;
})(typeof window !== "undefined" ? window : globalThis);
