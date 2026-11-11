// BCPレーダー「知識」タブ（2026-11-13。遠藤先生「全然知識が足りない。知識、というタブを作って、いろんな知識や場合を想定して情報を格納してよ」
// 「簡単にまとめるのではなく、できるだけ詳しく」）。電波の無い所（山・地下・災害時）で使う前提：記事一式は sw.js が画面と一緒に保存し、
// 検索も端末の中だけで行う（外へは何も送らない）。記事の正本は Log/ の各フォルダの articles/*.json、束は mac/build_knowledge.py が作る。
// 読み込むときにも検査する：review.status が reviewed でない記事・id の重複は入れない。uses_items の接頭辞（supply-）はそろえる。
// 束を足すときは web/knowledge/index.json に載せるだけ（mac/build_knowledge.py の PACKS）。棚は kind で決まり、知らない kind は束の名前の棚に入る。
"use strict";
(() => {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
  const store = {
    get(k, d) { try { const v = localStorage.getItem("bcp.know." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("bcp.know." + k, JSON.stringify(v)); } catch (e) { /* 保存できない端末でも動く */ } },
  };
  const arr = (x) => (Array.isArray(x) ? x : []);

  // ---------- 棚（kind と id の頭で決める。上から順に当てはめる） ----------
  const SHELVES = [
    { id: "think", icon: "🧠", name: "想定外への考え方", test: (a) => a.kind === "think" || a.id.startsWith("defense-think-") },
    { id: "mountain", icon: "⛰", name: "山", test: (a) => /^scene-(mountain|bear|lightning)/.test(a.id) },
    { id: "car", icon: "🚗", name: "車", test: (a) => /^scene-car-/.test(a.id) },
    { id: "rail", icon: "🚇", name: "鉄道・地下・建物", test: (a) => /^scene-(train|underground|station|elevator|highrise|building|stranded)/.test(a.id) },
    { id: "incident", icon: "⚠️", name: "事件・国民保護", test: (a) => /^scene-(attack|chemical|radiation|explosion|missile)/.test(a.id) },
    { id: "nature", icon: "🌋", name: "自然災害・暮らし", test: (a) => a.kind === "scene" },
    { id: "firstaid", icon: "🩹", name: "応急手当", test: (a) => a.kind === "firstaid" },
    { id: "symptom", icon: "🤒", name: "症状から調べる", test: (a) => a.kind === "symptom" },
    { id: "medicine", icon: "💊", name: "薬（市販薬・常備薬）", test: (a) => a.kind === "medicine" },
    { id: "supply", icon: "🎒", name: "救急用品・手元の物", test: (a) => a.kind === "supply" },
    { id: "hint", icon: "💡", name: "経験者の知恵", test: (a) => a.kind === "hint" },
    { id: "plants", icon: "🌿", name: "野草（食べられる・毒）", test: (a) => a.kind === "plant" },
    { id: "law", icon: "⚖️", name: "法律", test: (a) => a.kind === "law" },
    { id: "library", icon: "📚", name: "資料", test: (a) => a.kind === "library" },
  ];
  // 「いま困っている」の近道（記事が無ければ出さない）
  const URGENT = [
    ["firstaid-cpr", "倒れている・息をしていない"], ["firstaid-bleed", "血が止まらない"], ["firstaid-choke", "のどに物が詰まった"],
    ["firstaid-stroke", "顔・腕・言葉がおかしい"], ["firstaid-chest", "胸が痛い・締めつけられる"], ["firstaid-smoke", "火事・煙を吸った"],
    ["scene-quake-first-steps", "大きな地震"], ["scene-tsunami", "津波のおそれ"], ["scene-landslide", "土砂・がけ崩れのおそれ"],
    ["scene-river-flood", "川があふれそう"], ["scene-mountain-lost", "山で道に迷った"], ["scene-car-quake-driving", "運転中に地震"],
    ["scene-elevator-trapped", "エレベーターに閉じ込められた"], ["scene-underground-fire-blackout", "地下で火事・停電"],
    ["scene-missile-alert", "ミサイルの警報"], ["scene-comms-down", "電話・ネットがつながらない"],
  ];
  const THINK = "think-unexpected-stop-ooda";   // どれにも当てはまらないときの入口

  // ---------- 言い換え（検索で拾う。ひらがな・カタカナ・全角半角の違いは norm がそろえる） ----------
  const SYN = [
    "けが 怪我 負傷 傷 切り傷 すり傷", "しけつ 止血 出血 血が止まらない", "やけど 火傷 熱傷", "こっせつ 骨折 ねんざ 捻挫 打撲 打ち身 脱臼",
    "ねっちゅうしょう 熱中症 熱射病 暑さ", "ていたいおん 低体温 低体温症 寒さ 凍える", "しんぱいそせい 心肺蘇生 胸骨圧迫 心臓マッサージ aed 心停止 倒れている",
    "ちっそく 窒息 のどに詰まった 喉に詰まった 誤嚥 異物", "じしん 地震 揺れ 震度 余震", "つなみ 津波", "かじ 火事 火災 煙 けむり",
    "こうずい 洪水 浸水 冠水 氾濫 水害 大雨", "どしゃ 土砂 土砂崩れ がけ崩れ 崖崩れ 土石流 地すべり", "ふんか 噴火 火山 降灰 火山灰",
    "くま 熊 ツキノワグマ", "はち 蜂 スズメバチ", "へび 蛇 マムシ ヤマカガシ", "まだに マダニ ダニ", "かみなり 雷 落雷",
    "ていでん 停電 ブレーカー 電気が止まった", "だんすい 断水 水道", "けんがい 圏外 電波 つながらない 通信障害 輻輳",
    "ちかてつ 地下鉄 メトロ 地下 地下街", "でんしゃ 電車 列車 鉄道 駅", "くるま 車 自動車 運転 クルマ", "えれべーたー エレベーター エレベータ 閉じ込め",
    "やま 山 登山 山岳 遭難 道迷い 道に迷った", "こんたくと コンタクト コンタクトレンズ", "くすり 薬 市販薬 常備薬 医薬品 処方薬",
    "いたみどめ 痛み止め 鎮痛薬 解熱鎮痛薬 熱さまし ロキソプロフェン ロキソニン イブプロフェン アセトアミノフェン カロナール",
    "ねつ 熱 発熱", "げり 下痢 腹痛 おなか", "ずつう 頭痛", "かぜ 風邪 せき 咳 のどの痛み", "あれるぎー アレルギー アナフィラキシー じんましん 蕁麻疹 エピペン",
    "のうそっちゅう 脳卒中 脳梗塞 脳出血 ろれつ", "むねのいたみ 胸の痛み 胸痛 胸が痛い 心筋梗塞 心臓発作", "いっさんかたんそ 一酸化炭素 発電機 練炭",
    "かんでん 感電 電線", "ひなん 避難 避難所 逃げる", "きたくこんなん 帰宅困難 帰れない 帰宅", "みさいる ミサイル jアラート 弾道ミサイル 国民保護",
    "ばくはつ 爆発 テロ", "かがくぶっしつ 化学物質 薬品 異臭 有毒ガス", "ほうしゃせん 放射線 放射能 原発 原子力", "こども 子ども 子供 乳児 赤ちゃん 幼児",
    "こうれいしゃ 高齢者 お年寄り", "ぺっと ペット 犬 猫", "といれ トイレ 携帯トイレ 簡易トイレ", "みず 水 飲み水 飲料水",
    "しょくりょう 食料 食べ物 非常食 行動食", "でんち 電池 バッテリー モバイルバッテリー 充電", "らいと ライト 懐中電灯 ヘッドライト 明かり",
    "ほうかん 防寒 毛布 保温シート アルミブランケット", "ほうりつ 法律 違法 正当防衛 刃物 銃刀法", "ふあん 不安 パニック 落ち着く 心の罠",
    "ごいん 誤飲 誤って飲んだ 中毒", "しっしん 失神 気を失う 気絶 めまい", "けいれん 痙攣 ひきつけ", "ていけっとう 低血糖 糖尿病",
    "ぜんそく 喘息", "はなぢ 鼻血", "めぐすり 目薬", "かまれた 噛まれた 咬まれた 動物", "おぼれた 溺れた 溺水 水難",
    "えこのみーくらす エコノミークラス症候群 血栓 車中泊", "ゆき 雪 大雪 雪道 立ち往生", "とんねる トンネル", "こうそくどうろ 高速道路 高速",
    "こうそう 高層ビル 高層 マンション", "ふしんしゃ 不審者 暴漢 襲われた 防犯 刃物", "ばんそうこう 絆創膏 キズパワーパッド", "ほうたい 包帯 三角巾",
    "やそう 野草 山菜 草 毒草 野の草 食べられる草", "どくそう 毒草 有毒植物 毒", "きのめ 木の芽 若芽 新芽",
    "えすおーえす sos 助けを呼ぶ 救助 通報", "いちいちきゅう 119 救急車 消防", "ひゃくとおばん 110 警察",
  ].map((g) => g.split(" "));

  const kata2hira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const norm = (s) => kata2hira(String(s == null ? "" : s).normalize("NFKC").toLowerCase()).replace(/[\s・、。,.\-ー－―‐〜~（）()「」『』【】［］\[\]!?！？:：/／"'“”]/g, "");
  const SYNN = SYN.map((g) => g.map(norm).filter(Boolean));

  // ---------- 状態 ----------
  const K = { ready: false, loading: null, err: "", arts: [], byId: {}, packs: [], items: {}, back: {}, media: { figs: [], photos: [], photo_bytes: 0 }, stats: { total: 0, packs: {}, dropped: [], dupes: [] } };
  let st = store.get("st", { v: "home" });
  let hist = [];
  let el = null;
  let dec = null;   // 分かれ道 { id, path:[{q, label}], cur: 問いの id、res: 結論の key、stop: STOP を出すか }

  // ---------- 読み込みと検査 ----------
  function accept(a, pack) {
    if (!a || typeof a !== "object" || !a.id || !a.title) { K.stats.dropped.push(String((a && a.id) || "?") + "（形が違う）"); return false; }
    if (!a.review || a.review.status !== "reviewed") { K.stats.dropped.push(a.id + "（" + ((a.review && a.review.status) || "確認の印なし") + "）"); return false; }
    if (K.byId[a.id]) { K.stats.dupes.push(a.id + "（" + K.byId[a.id]._pack + " と " + pack + "）"); return false; }
    return true;
  }
  function tidy(a, pack, label) {
    a._pack = pack; a._packLabel = label;
    ["category", "tags", "first3", "dont", "qa", "advanced", "related", "sources"].forEach((k) => { a[k] = arr(a[k]); });
    a.uses_items = [...new Set(arr(a.uses_items).map((u) => String(u).replace(/^supply-/, "")))];
    a.body = String(a.body || ""); a.call = String(a.call || "");
    a.media = arr(a.media).filter((m) => m && /^knowledge\/(img|fig)\//.test(String(m.src || "")) && (m.t !== "photo" || (m.credit && m.lic)));   // 写真は帰属表示のある物だけ
    const pn = (a.plant && a.plant.names) || {};
    a._plantNames = [pn.ja, pn.kana, pn.sci, pn.family, ...arr(pn.aliases)].filter(Boolean).join(" ");
    const sh = SHELVES.find((s) => s.test(a));
    a._shelf = sh ? sh.id : "pack-" + pack;
    a._n = {
      t: norm(a.title + " " + a._plantNames), g: norm(a.tags.join(" ")), c: norm(a.category.join(" ")), f: norm(a.first3.join(" ")),
      q: norm(a.qa.map((x) => x && x.q).join(" ")),
      b: norm([a.body, a.dont.join(" "), a.call, a.qa.map((x) => x && x.a).join(" "), a.advanced.map((x) => x && [x.point, x.condition, x.differs].join(" ")).join(" ")].join(" ")),
    };
    return a;
  }
  async function getJSON(u) {
    const r = await fetch(u, { cache: "no-cache" });
    if (!r.ok) throw new Error(u + " HTTP " + r.status);
    return r.json();
  }
  function load() {
    if (K.ready) return Promise.resolve();
    if (K.loading) return K.loading;
    K.loading = (async () => {
      try {
        const idx = await getJSON("knowledge/index.json");
        K.items = idx.items || {};
        if (idx.media) K.media = { figs: arr(idx.media.figs), photos: arr(idx.media.photos), photo_bytes: +idx.media.photo_bytes || 0 };
        const packs = await Promise.all(arr(idx.packs).map((p) => getJSON("knowledge/" + p.file).then((d) => ({ p, d })).catch((e) => ({ p, d: null, e }))));
        const missing = [];
        packs.forEach(({ p, d }) => {
          if (!d) { missing.push(p.label); return; }
          let n = 0;
          arr(d.articles).forEach((a) => { if (accept(a, p.id)) { K.byId[a.id] = tidy(a, p.id, p.label); K.arts.push(a); n++; } });
          K.packs.push({ id: p.id, label: p.label, n });
          K.stats.packs[p.id] = n;
        });
        K.stats.total = K.arts.length;
        K.arts.forEach((a) => a.related.forEach((r) => { if (K.byId[r] && r !== a.id) (K.back[r] = K.back[r] || []).push(a.id); }));
        if (missing.length) K.err = "読み込めなかった束：" + missing.join("、") + "（通信のある所で一度開くと、圏外でも読めるようになります）";
        K.ready = true;
      } catch (e) {
        K.err = "記事を読み込めませんでした。通信のある所で一度「知識」を開くと、圏外でも読めるようになります。";
      }
      K.loading = null;
    })();
    return K.loading;
  }

  // ---------- 検索（端末の中だけ） ----------
  function alts(term) {
    const out = new Set([term]);
    SYNN.forEach((g) => { if (g.some((m) => m === term || (term.length >= 2 && m.length > term.length && m.startsWith(term)))) g.forEach((m) => out.add(m)); });
    return [...out];
  }
  function search(q) {
    const terms = String(q || "").normalize("NFKC").split(/[\s　]+/).map(norm).filter(Boolean);
    if (!terms.length) return [];
    const ex = terms.map(alts);
    const W = { t: 12, g: 8, c: 5, f: 4, q: 3, b: 1 };
    const out = [];
    K.arts.forEach((a) => {
      let sc = 0;
      for (const al of ex) {
        let best = 0;
        for (const w of al) for (const k in W) if (W[k] > best && a._n[k].includes(w)) best = W[k];
        if (!best) return;
        sc += best;
      }
      out.push([sc + (URGENT.some((u) => u[0] === a.id) ? 0.5 : 0), a]);
    });
    return out.sort((x, y) => y[0] - x[0] || x[1].title.localeCompare(y[1].title, "ja")).map((x) => x[1]);
  }

  // ---------- 文の描き方（すべて esc してから、決まった形だけを飾る） ----------
  // （確かめ中）は目立たない注記に。［S1・S3］は出典の小さな印に
  function tx(s) {
    return esc(s).replace(/（確かめ中）/g, '<span class="kk">（確かめ中）</span>').replace(/［(S\d+(?:[・,、]S?\d+)*)］/g, '<span class="kcite">［$1］</span>');
  }
  function inline(s) {
    s = String(s == null ? "" : s);
    const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s）)」、。]+))/g;
    let out = "", last = 0, m;
    while ((m = re.exec(s))) {
      out += tx(s.slice(last, m.index));
      if (m[2] !== undefined) out += "<b>" + tx(m[2]) + "</b>";
      else if (m[3] !== undefined) out += "<code>" + esc(m[3]) + "</code>";
      else if (m[4] !== undefined) out += safeUrl(m[5]) ? `<a href="${esc(m[5])}" target="_blank" rel="noopener">${tx(m[4])}</a>` : tx(m[4]);
      else if (m[6]) out += `<a href="${esc(m[6])}" target="_blank" rel="noopener">${esc(m[6])}</a>`;
      last = re.lastIndex;
    }
    return out + tx(s.slice(last));
  }
  function md(src) {
    const L = String(src || "").replace(/\r/g, "").split("\n");
    let h = "", i = 0, para = [];
    const flush = () => { if (para.length) { h += "<p>" + para.map(inline).join("<br>") + "</p>"; para = []; } };
    const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    while (i < L.length) {
      const line = L[i];
      if (/^```/.test(line)) {
        flush(); const lang = line.slice(3).trim(); const buf = []; i++;
        while (i < L.length && !/^```/.test(L[i])) buf.push(L[i++]);
        i++;
        if (lang !== "mermaid") h += `<pre class="kpre">${esc(buf.join("\n"))}</pre>`;   // 図の文（Mermaid）は出さない
        continue;
      }
      let m = line.match(/^(#{1,6})\s+(.*)$/);
      if (m) { flush(); const lv = Math.min(5, m[1].length + 1); h += `<h${lv} class="kh">${inline(m[2])}</h${lv}>`; i++; continue; }
      if (/^\s*\|/.test(line) && i + 1 < L.length && /^\s*\|?\s*:?-{2,}/.test(L[i + 1])) {
        flush(); const head = cells(line); i += 2; const rows = [];
        while (i < L.length && /^\s*\|/.test(L[i])) rows.push(cells(L[i++]));
        if (head.length > 3) h += `<div class="kscroll">表は横に動かせます →</div>`;
        h += `<div class="ktable"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
        continue;
      }
      if (/^\s*>\s?/.test(line)) {
        flush(); const buf = [];
        while (i < L.length && /^\s*>\s?/.test(L[i])) buf.push(L[i++].replace(/^\s*>\s?/, ""));
        h += `<blockquote>${buf.map(inline).join("<br>")}</blockquote>`;
        continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        flush();
        const stack = [];   // [{ind, tag}]
        while (i < L.length && (/^\s*([-*+]|\d+[.)])\s+/.test(L[i]) || (/^\s{2,}\S/.test(L[i]) && stack.length))) {
          const lm = L[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (!lm) { h += "<br>" + inline(L[i].trim()); i++; continue; }   // 続きの行
          const ind = lm[1].replace(/\t/g, "  ").length, tag = /\d/.test(lm[2]) ? "ol" : "ul";
          while (stack.length && stack[stack.length - 1].ind > ind) h += `</li></${stack.pop().tag}>`;
          if (!stack.length || stack[stack.length - 1].ind < ind) { h += `<${tag} class="kl">`; stack.push({ ind, tag }); }
          else h += "</li>";
          h += "<li>" + inline(lm[3]);
          i++;
        }
        while (stack.length) h += `</li></${stack.pop().tag}>`;
        continue;
      }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flush(); h += "<hr>"; i++; continue; }
      if (!line.trim()) { flush(); i++; continue; }
      para.push(line.trim()); i++;
    }
    flush();
    return h;
  }
  // 電話番号を押せるように（119番・110番の目安の欄だけ）
  function telify(s) {
    return tx(s).replace(/(#\d{4}|0\d{1,4}-\d{2,6}(?:-\d{3,4})?(?![\d\-])|(?<![\d\-])1(?:10|19|71|18)(?![\d\-]))/g, (n) => `<a class="ktel" href="tel:${esc(n.replace(/-/g, ""))}">${n}</a>`);
  }

  // ---------- 画面 ----------
  const shelfOf = (id) => SHELVES.find((s) => s.id === id) || (id.startsWith("pack-") ? { id, icon: "📘", name: (K.packs.find((p) => "pack-" + p.id === id) || {}).label || "その他" } : null);
  const fsBar = () => { const f = store.get("fs", 2); return `<div class="kfs" role="group" aria-label="文字の大きさ"><span class="muted">文字</span>${["小", "中", "大", "特大"].map((n, i) => `<button data-knfs="${i + 1}" class="${f === i + 1 ? "on" : ""}" aria-label="文字の大きさ ${n}">${n}</button>`).join("")}</div>`; };
  const artRow = (a) => `<button class="krow" data-knart="${esc(a.id)}"><span class="kt">${tx(a.title)}</span>${a.first3[0] ? `<span class="ks">${tx(a.first3[0])}</span>` : ""}</button>`;
  const link = (id) => (K.byId[id] ? `<button class="klink" data-knart="${esc(id)}">${tx(K.byId[id].title)}</button>` : "");

  function nav(next) { hist.push(st); if (hist.length > 50) hist.shift(); st = next; store.set("st", st); draw(); window.scrollTo(0, 0); }
  function back() { st = hist.pop() || { v: "home" }; store.set("st", st); draw(); window.scrollTo(0, 0); }

  function homeView() {
    let h = `<div class="khead"><h1>知識</h1>${fsBar()}</div>`;
    h += `<p class="muted">圏外でも読めます（${K.stats.total}本・端末に保存済み）。調べた言葉は外へ送りません。</p>`;
    h += `<section class="kurgent"><h2>🆘 いま困っている</h2>`;
    if (K.byId[THINK]) h += `<button class="kthink" data-knthink="1"><b>どれにも当てはまらない・分からない</b><span>その場で考える（問いに答えるだけで次の一手が出る）</span></button>`;
    h += `<div class="kugrid">${URGENT.filter((u) => K.byId[u[0]]).map(([id, n]) => `<button class="kubtn" data-knart="${esc(id)}">${esc(n)}</button>`).join("")}</div>`;
    h += `<p class="muted">命に関わるときは、読むより先に <a class="ktel" href="tel:119">119</a>・<a class="ktel" href="tel:110">110</a>。迷ったら救急相談 <a class="ktel" href="tel:%237119">#7119</a>。</p></section>`;
    h += `<div class="ksearch"><input id="knq" type="search" placeholder="🔍 調べる（例：止血・コンタクト）" autocomplete="off" enterkeyhint="search" value="${esc(st.q || "")}"></div><div id="knres"></div>`;
    const counts = {};
    K.arts.forEach((a) => { counts[a._shelf] = (counts[a._shelf] || 0) + 1; });
    const ids = [...SHELVES.map((s) => s.id), ...Object.keys(counts).filter((k) => k.startsWith("pack-"))].filter((k) => counts[k]);
    h += `<h2>棚から選ぶ</h2><div class="kshelves">${ids.map((k) => { const s = shelfOf(k); return `<button class="kshelf" data-knshelf="${esc(k)}"><span class="ki">${s.icon}</span><span>${esc(s.name)}</span><span class="kn">${counts[k]}</span></button>`; }).join("")}</div>`;
    if (K.media.photos.length && !window.__BCP_IOS && "caches" in window) h += `<div class="ksave"><button id="knsave" data-knsave="1">📷 写真を端末に保存（${K.media.photos.length}枚・約${(K.media.photo_bytes / 1e6).toFixed(0)}MB）</button><span id="knsaveinfo" class="muted">野草の写真は、開いた記事の分だけ端末に残ります。圏外でも全部見られるようにするには、通信のある所で一度保存してください。</span></div>`;
    h += `<p class="muted">入っている物：${K.packs.map((p) => `${esc(p.label)} ${p.n}本`).join("・")}。どれも独立の確認に合格した記事だけです。「（確かめ中）」は、公的な資料でまだ確かめきれていない所の印です。</p>`;
    if (K.err) h += `<p class="kerr">${esc(K.err)}</p>`;
    return h;
  }
  function resultsHtml(q) {
    if (!String(q || "").trim()) return "";
    const r = search(q);
    if (!r.length) return `<p class="muted">「${esc(q)}」に合う記事はありませんでした。別の言い方や、短い言葉で試してください。どれにも当てはまらないときは上の「その場で考える」。</p>`;
    return `<p class="muted">${r.length}件</p><div class="klist">${r.slice(0, 80).map(artRow).join("")}</div>`;
  }
  function shelfView() {
    const s = shelfOf(st.shelf) || { icon: "", name: "" };
    const list = K.arts.filter((a) => a._shelf === st.shelf).sort((x, y) => x.title.localeCompare(y.title, "ja"));
    return `${topBar()}<h1>${s.icon} ${esc(s.name)}</h1><p class="muted">${list.length}本</p><div class="klist">${list.map(artRow).join("")}</div>`;
  }
  function topBar() { return `<div class="kbar"><button class="kback" data-knback="1">‹ 戻る</button><button class="kback" data-knhome="1">知識の入口</button>${fsBar()}</div>`; }
  function callBox(a) {
    if (!a.call.trim()) return "";
    return `<section class="kcall"><h2>📞 119番・110番の目安</h2><p>${telify(a.call)}</p><div class="kcallbtn"><a href="tel:119">📞 119</a><a href="tel:110">📞 110</a></div></section>`;
  }
  function figs(a) {
    const F = (window.BCP_AID_FIGURES || {})[a.aid] || [];
    if (!F.length || !F.every((f) => f.src)) return "";   // 絵がまだ無い図は出さない（応急手当の絵が使える記事だけ）
    return `<section><h2>絵で見る手順</h2><div class="aidgrid">${F.map((f, i) => `<figure class="aidfig"><img src="${esc(f.src)}" alt="${esc(f.label)}" width="640" height="480" loading="lazy" decoding="async"><figcaption><b>${i + 1}</b> ${esc(f.label)}</figcaption></figure>`).join("")}</div></section>`;
  }
  // 記事の写真と絵（2026-11-13）：写真は作者・ライセンス（リンク）を必ず下に。絵は Fable の確認に合格した物だけ（mac/build_knowledge.py が合格一覧から入れる）
  function mediaHtml(a) {
    if (!a.media.length) return "";
    const ph = a.media.filter((m) => m.t === "photo"), fg = a.media.filter((m) => m.t === "fig");
    const h2 = ph.length && fg.length ? "写真と図" : ph.length ? "写真" : "図";
    // 写真は細部が要るので幅いっぱい。絵は応急手当の絵と同じ2列（縦に長くなりすぎないように）
    const phH = ph.map((m) => `<figure class="kphoto"><img src="${esc(m.src)}" alt="${esc(m.cap || "写真")}" loading="lazy" decoding="async"><figcaption>${tx(m.cap || "")}<small class="kcredit">写真：${esc(m.credit)}・ライセンス ${safeUrl(m.lic_url) ? `<a href="${esc(m.lic_url)}" target="_blank" rel="noopener">${esc(m.lic)}</a>` : esc(m.lic)}${safeUrl(m.url) ? `・<a href="${esc(m.url)}" target="_blank" rel="noopener">元の写真</a>` : ""}</small></figcaption></figure>`).join("");
    const fgH = fg.length ? `<div class="kfiggrid">${fg.map((m) => `<figure class="kfig"><img src="${esc(m.src)}" alt="${esc(m.label || m.cap || "図")}" width="640" height="480" loading="lazy" decoding="async"><figcaption>${tx(m.label || "")}${m.cap && m.cap !== m.label ? `<small>${tx(m.cap)}</small>` : ""}</figcaption></figure>`).join("")}</div>` : "";
    return `<section class="kmedia"><h2>${h2}</h2>${phH}${fgH}</section>`;
  }
  const PGROUP = { cooked: "加熱すれば食べられる", raw: "生でも食べられる（洗えば）", poison: "食べられない・毒", lookalike: "似ている毒草の見分け", overview: "総論" };
  function plantHtml(a) {
    const p = a.plant; if (!p || typeof p !== "object") return "";
    const n = p.names || {}, se = p.season || {};
    const row = (k, v) => (v && String(v).trim() ? `<tr><th>${k}</th><td>${tx(v)}</td></tr>` : "");
    const seas = [["芽", se.sprout], ["花", se.flower], ["実", se.fruit], ["食べごろ", se.eat]].filter((x) => x[1]).map((x) => `${x[0]} ${x[1]}`).join("・");
    const look = arr(p.lookalikes).filter((x) => K.byId[x] && x !== a.id);
    return `<section class="kplant"><h2>🌿 ${esc(PGROUP[p.group] || "野草")}</h2><table class="kptab">` +
      row("名前", [n.ja, n.kana && n.kana !== n.ja ? `（${n.kana}）` : ""].join("")) + row("学名・科", [n.sci, n.family].filter(Boolean).join("・")) + row("別名", arr(n.aliases).join("・")) +
      row(p.group === "poison" || p.group === "lookalike" ? "毒のある所" : "食べる所", p.parts) + row("季節", seas) + row("生える所", p.where) + row("西多摩では", p.nishitama) +
      row("毒", p.toxin) + row("毒の強さ", p.toxicity) + `</table>` +
      (p.photo_note ? `<p class="muted kpnote">📷 ${tx(p.photo_note)}</p>` : "") +
      (look.length ? `<p class="muted">似ている物・見分け</p><div class="klinks">${look.map(link).join("")}</div>` : "") + `</section>`;
  }
  function artView() {
    const a = K.byId[st.id];
    if (!a) return `${topBar()}<p class="kerr">この記事は見つかりませんでした。</p>`;
    const s = shelfOf(a._shelf) || { icon: "", name: "" };
    let h = `${topBar()}<div class="kmeta">${s.icon} ${esc(s.name)}${s.name === a._packLabel ? "" : "・" + esc(a._packLabel)}</div><h1 class="ktitle">${tx(a.title)}</h1>`;
    if (a.first3.length) h += `<section class="kfirst"><h2>まずこの${a.first3.length === 3 ? "3つ" : a.first3.length + "つ"}</h2><ol>${a.first3.map((x) => `<li>${tx(x)}</li>`).join("")}</ol></section>`;
    if (a.dont.length) h += `<section class="kdont"><h2>✕ してはいけない</h2><ul>${a.dont.map((x) => `<li>${tx(x)}</li>`).join("")}</ul></section>`;
    h += callBox(a);
    const dq = a.decision && arr(a.decision.questions);
    if (dq && dq.length) h += `<button class="kdecbtn" data-kndec="${esc(a.id)}">🔀 問いに答えて、やることを決める<span>${dq.length}問まで・「分からない」も選べます</span></button>`;
    h += mediaHtml(a);
    h += plantHtml(a);
    h += figs(a);
    if (a.uses_items.length) h += `<section><h2>手元の物で使える物</h2><div class="kitems">${a.uses_items.map((u) => { const nm = String(K.items[u] || (K.byId["supply-" + u] && K.byId["supply-" + u].title) || u).split("：")[0]; return K.byId["supply-" + u] ? `<button class="kitem link" data-knart="supply-${esc(u)}">${esc(nm)} ›</button>` : `<span class="kitem">${esc(nm)}</span>`; }).join("")}</div></section>`;
    if (a.body.trim()) h += `<section class="kbody"><h2>詳しく</h2><div class="kmd">${md(a.body)}</div></section>`;
    if (a.qa.length) h += `<section><h2>よくある困りごと（Q&amp;A）</h2>${a.qa.map((x) => `<details class="kqa"><summary>${tx(x.q)}</summary><div class="body">${md(x.a)}${arr(x.src).length ? `<p class="muted">出典 ${esc(arr(x.src).join("・"))}</p>` : ""}</div></details>`).join("")}</section>`;
    if (a.advanced.length) h += `<section><details class="kadv"><summary>上級者向け（${a.advanced.length}）</summary><div class="body"><p class="kadvnote">公的な指針と違う所・条件付きの知恵です。条件に当てはまらないとき、迷うときは上の「まず」と公的な指針に従ってください。</p>${a.advanced.map((x) => `<div class="kadvi"><p><b>${tx(x.point)}</b></p>${x.condition ? `<p><span class="klabel">条件</span>${tx(x.condition)}</p>` : ""}${x.differs ? `<p class="kdiff"><span class="klabel">公的な指針との違い</span>${tx(x.differs)}</p>` : ""}${arr(x.src).length ? `<p class="muted">出典 ${esc(arr(x.src).join("・"))}</p>` : ""}</div>`).join("")}</div></details></section>`;
    if (a.sources.length) h += `<section><details class="ksrc"><summary>出典（${a.sources.length}）</summary><div class="body"><ul class="ksrcl">${a.sources.map((x) => `<li><span class="kcite">${esc(x.id || "")}</span> ${safeUrl(x.url) ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || x.url)}</a>` : esc(x.title || "")}${x.publisher ? `（${esc(x.publisher)}）` : ""}${x.date ? ` ${esc(x.date)}` : ""}${x.checked ? ` <span class="muted">確認 ${esc(x.checked)}</span>` : ""}</li>`).join("")}</ul></div></details></section>`;
    const rel = a.related.filter((r) => K.byId[r] && r !== a.id);
    const bk = (K.back[a.id] || []).filter((r) => !rel.includes(r));
    if (rel.length || bk.length) h += `<section><h2>関連する記事</h2><div class="klinks">${rel.map(link).join("")}</div>${bk.length ? `<p class="muted">この記事を挙げている記事</p><div class="klinks">${bk.map(link).join("")}</div>` : ""}</section>`;
    h += `<p class="muted kfoot">独立の確認に合格（${esc((a.review && a.review.last) || "")}）・更新 ${esc(a.updated || "")}。医療・救助の判断の代わりにはなりません。迷ったら 119・#7119。</p>`;
    return h;
  }
  // ---------- 分かれ道（問いに答えて進む。図ではなくボタン） ----------
  function decStart(id) { dec = { id, path: [], cur: null, res: null, stop: id === THINK }; const a = K.byId[id]; dec.cur = (arr(a.decision.questions)[0] || {}).id; }
  function decView() {
    const a = K.byId[st.id];
    if (!a || !a.decision) return `${topBar()}<p class="kerr">分かれ道が見つかりません。</p>`;
    if (!dec || dec.id !== a.id) decStart(a.id);
    const qs = arr(a.decision.questions), res = a.decision.results || {};
    let h = `${topBar()}<div class="kmeta">分かれ道</div><h1 class="ktitle">${tx(a.title)}</h1>`;
    if (dec.stop) {
      return h + `<section class="kstop"><div class="kstopw">STOP</div><p>止まる。息を吐く。「落ち着け」と声に出す。</p><p class="muted">そのあと、問いに1つずつ答えます。</p><button class="kopt" data-knstop="1">落ち着いた → 問いへ</button></section>`;
    }
    if (dec.path.length) h += `<ol class="kpath">${dec.path.map((p) => `<li>${tx(p.q)} → <b>${tx(p.label)}</b></li>`).join("")}</ol>`;
    if (dec.res) {
      const r = res[dec.res];
      h += `<section class="kres"><h2>やること</h2>`;
      if (typeof r === "string") h += `<p class="kresbig">${tx(r)}</p>`;
      else if (r && typeof r === "object") {
        if (r.title) h += `<p class="kresbig"><b>${tx(r.title)}</b></p>`;
        if (arr(r.do).length) h += `<ol class="kdo">${r.do.map((x) => `<li>${tx(x)}</li>`).join("")}</ol>`;
        const rl = arr(r.related).filter((x) => K.byId[x]);
        if (rl.length) h += `<p class="muted">関係する記事</p><div class="klinks">${rl.map(link).join("")}</div>`;
      } else h += `<p class="kerr">結論が見つかりません（${esc(dec.res)}）。</p>`;
      h += `<div class="kcallbtn"><a href="tel:119">📞 119</a><a href="tel:110">📞 110</a></div></section>`;
    } else {
      const q = qs.find((x) => x.id === dec.cur);
      if (!q) h += `<p class="kerr">問いが見つかりません。</p>`;
      else {
        h += `<section class="kq"><div class="kqn">問い ${dec.path.length + 1}</div><p class="kqt">${tx(q.text)}</p>`;
        if (arr(q.items).length) h += `<ul class="kqitems">${q.items.map((x) => `<li>${tx(x)}</li>`).join("")}</ul>`;
        h += `<div class="kopts">${arr(q.options).map((o, i) => `<button class="kopt" data-knopt="${i}">${tx(o.label)}</button>`).join("")}</div></section>`;
      }
    }
    h += `<div class="kdecnav">${dec.path.length || dec.res ? `<button data-kndback="1">‹ 一つ戻る</button><button data-kndreset="1">最初から</button>` : ""}<button data-knart="${esc(a.id)}">記事を読む</button></div>`;
    return h;
  }
  function decPick(i) {
    const a = K.byId[st.id], qs = arr(a.decision.questions), res = a.decision.results || {};
    const q = qs.find((x) => x.id === dec.cur); if (!q) return;
    const o = arr(q.options)[i]; if (!o) return;
    dec.path.push({ q: q.text, label: o.label, from: q.id });
    if (qs.some((x) => x.id === o.next)) dec.cur = o.next;
    else dec.res = o.next in res ? o.next : String(o.next || "?");
    draw(); window.scrollTo(0, 0);
  }
  function decBack() {
    if (!dec.path.length) return;
    const p = dec.path.pop(); dec.res = null; dec.cur = p.from; draw();
  }

  function draw() {
    if (!el) return;
    el.style.setProperty("--kfs", [15, 17, 19, 22][store.get("fs", 2) - 1] + "px");
    if (!K.ready) {
      el.innerHTML = `<div class="khead"><h1>知識</h1></div>` + (K.err ? `<p class="kerr">${esc(K.err)}</p>` : `<p class="empty">読み込んでいます…</p>`);
      load().then(() => { if (K.ready || K.err) draw(); });
      return;
    }
    const v = st.v;
    el.innerHTML = v === "art" ? artView() : v === "shelf" ? shelfView() : v === "dec" ? decView() : homeView();
    if (v === "home" && st.q) $res().innerHTML = resultsHtml(st.q);
  }
  const $res = () => el.querySelector("#knres");
  let qT;
  function bind(root) {
    root.addEventListener("click", (ev) => {
      const t = ev.target.closest("button");
      if (!t || !root.contains(t)) return;
      const d = t.dataset;
      if (d.knart) { if (st.v === "home") st = Object.assign({}, st, { q: (el.querySelector("#knq") || {}).value || "" }); return nav({ v: "art", id: d.knart }); }
      if (d.knshelf) return nav({ v: "shelf", shelf: d.knshelf });
      if (d.knback) return back();
      if (d.knhome) { hist = []; st = { v: "home", q: "" }; store.set("st", st); draw(); window.scrollTo(0, 0); return; }
      if (d.knfs) { store.set("fs", +d.knfs); return draw(); }
      if (d.kndec) { dec = null; return nav({ v: "dec", id: d.kndec }); }
      if (d.knthink) { dec = null; return nav({ v: "dec", id: THINK }); }
      if (d.knstop) { dec.stop = false; return draw(); }
      if (d.knopt !== undefined) return decPick(+d.knopt);
      if (d.kndback) return decBack();
      if (d.kndreset) { decStart(st.id); dec.stop = false; return draw(); }
      if (d.knsave) return savePhotos(t);
    });
    root.addEventListener("input", (ev) => {
      if (ev.target.id !== "knq") return;
      clearTimeout(qT);
      qT = setTimeout(() => { st = Object.assign({}, st, { q: ev.target.value }); store.set("st", st); const r = $res(); if (r) r.innerHTML = resultsHtml(ev.target.value); }, 120);
    });
    root.addEventListener("keydown", (ev) => { if (ev.target.id === "knq" && ev.key === "Enter") { ev.target.blur(); } });
  }

  // 写真を端末に保存（sw.js が knowledge/img/ を bcp-know-img に残す。1枚ずつ取り、取れた数を出す）
  async function savePhotos(btn) {
    const info = el.querySelector("#knsaveinfo"), L = K.media.photos;
    if (!navigator.onLine) { if (info) info.textContent = "圏外です。通信のある所で保存してください。"; return; }
    btn.disabled = true;
    let ok = 0;
    for (let i = 0; i < L.length; i++) {
      try { const r = await fetch(L[i]); if (r.ok) { await r.blob(); ok++; } } catch (e) { /* 次へ */ }
      if (info && (i % 5 === 4 || i === L.length - 1)) info.textContent = `保存しています… ${i + 1}/${L.length}`;
    }
    btn.disabled = false;
    if (info) info.textContent = ok === L.length ? `保存しました（${ok}枚）。圏外でも写真が出ます。` : `${ok}/${L.length}枚を保存しました。残りは通信のよい所でもう一度。`;
  }

  window.BCP_KNOW = {
    render(root) { if (el !== root) { el = root; bind(root); } if (st.v === "dec" && !dec) st = { v: "art", id: st.id }; draw(); },
    load,
    // 試験・ほかの画面から使う
    stats: () => JSON.parse(JSON.stringify(K.stats)),
    search: (q) => search(q).map((a) => a.id),
    open(id) { nav({ v: "art", id }); },
    ids: () => K.arts.map((a) => a.id),
    media: () => JSON.parse(JSON.stringify(K.media)),
    art: (id) => (K.byId[id] ? { media: K.byId[id].media.length, shelf: K.byId[id]._shelf } : null),
    norm,
  };
})();
