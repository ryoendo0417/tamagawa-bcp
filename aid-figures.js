// 応急手当の図（慌てていても見て分かるように。文字は図に入れず label に）
// 内容は content.js の firstAid（救急蘇生法の指針2025 市民用 等で確認済み）に合わせた絵。独立の確認（Fable）に合格した絵（枚数は order.tsv のとおり）。
// 画像は img/aid/（640×480 の WebP）。sw.js の SHELL にも同じ絵を全部入れて、圏外でも出るようにしている。
// 2026-11-12 棒人間の SVG から入れ替え（前の SVG は Log/repairs/bcp-aid-img-20261112/aid-figures-svg-20261111.js）。
// 作り方: Log/repairs/bcp-aid-img-20261112/gen_aid_figures.py（材料 Log/bcp-aid-figures-v2 の order.tsv・labels.tsv）
window.BCP_AID_FIGURES = {
  "cpr": [
    {
      "src": "img/aid/cpr-00.webp",
      "label": "周りの安全を確かめる"
    },
    {
      "src": "img/aid/cpr-01.webp",
      "label": "肩をたたく 119番とAED"
    },
    {
      "src": "img/aid/cpr-02.webp",
      "label": "呼吸を見る 10秒以内"
    },
    {
      "src": "img/aid/cpr-03.webp",
      "label": "胸の真ん中 手の付け根"
    },
    {
      "src": "img/aid/cpr-04.webp",
      "label": "約5cm・1分100〜120回"
    },
    {
      "src": "img/aid/cpr-05.webp",
      "label": "30回押して2回息"
    },
    {
      "src": "img/aid/cpr-06.webp",
      "label": "AED 音声に従う"
    },
    {
      "src": "img/aid/cpr-07.webp",
      "label": "救急隊まで続ける 疲れたら交代"
    }
  ],
  "recovery": [
    {
      "src": "img/aid/recovery-00.webp",
      "label": "119番"
    },
    {
      "src": "img/aid/recovery-01.webp",
      "label": "横向き 上の膝を曲げる"
    },
    {
      "src": "img/aid/recovery-03.webp",
      "label": "離れず 見守る"
    }
  ],
  "bleed": [
    {
      "src": "img/aid/bleed-01.webp",
      "label": "手袋か袋をはめる"
    },
    {
      "src": "img/aid/bleed-02.webp",
      "label": "布を当て 強く押さえる"
    },
    {
      "src": "img/aid/bleed-03.webp",
      "label": "にじむ→当て直し 強く押さえる"
    },
    {
      "src": "img/aid/bleed-04.webp",
      "label": "止まらない 119番"
    }
  ],
  "burn": [
    {
      "src": "img/aid/burn-01.webp",
      "label": "10〜20分 流水で冷やす"
    },
    {
      "src": "img/aid/burn-02.webp",
      "label": "氷を当てない・破らない"
    },
    {
      "src": "img/aid/burn-03.webp",
      "label": "広いやけど 119番"
    }
  ],
  "bone": [
    {
      "src": "img/aid/bone-01.webp",
      "label": "動かさない 戻さない"
    },
    {
      "src": "img/aid/bone-02.webp",
      "label": "添え木 上下の関節まで"
    },
    {
      "src": "img/aid/bone-03.webp",
      "label": "冷やして 高くする"
    }
  ],
  "crush": [
    {
      "src": "img/aid/crush-03.webp",
      "label": "自分の安全 優先"
    },
    {
      "src": "img/aid/crush-01.webp",
      "label": "一人で むやみに引き出さない"
    },
    {
      "src": "img/aid/crush-02.webp",
      "label": "声をかけ 119番"
    },
    {
      "src": "img/aid/crush-04.webp",
      "label": "危険・救助が来ない 複数人で救出"
    },
    {
      "src": "img/aid/crush-05.webp",
      "label": "助け出したら 必ず医療へ"
    }
  ],
  "heat": [
    {
      "src": "img/aid/heat-01.webp",
      "label": "涼しい所へ 服をゆるめる"
    },
    {
      "src": "img/aid/heat-05.webp",
      "label": "体を濡らし 風を当てる"
    },
    {
      "src": "img/aid/heat-02.webp",
      "label": "首・脇・足の付け根 冷やす"
    },
    {
      "src": "img/aid/heat-03.webp",
      "label": "飲めたら 少しずつ"
    },
    {
      "src": "img/aid/heat-04.webp",
      "label": "反応が変なら 119番"
    }
  ],
  "cold": [
    {
      "src": "img/aid/cold-01.webp",
      "label": "毛布で包む"
    },
    {
      "src": "img/aid/cold-02.webp",
      "label": "温かく甘い 飲み物"
    },
    {
      "src": "img/aid/cold-03.webp",
      "label": "にぶい→119番 こすらない"
    }
  ],
  "choke": [
    {
      "src": "img/aid/choke-01.webp",
      "label": "咳をさせる"
    },
    {
      "src": "img/aid/choke-02.webp",
      "label": "人を呼ぶ 背中を強く5回"
    },
    {
      "src": "img/aid/choke-04.webp",
      "label": "取れない→ 腹部突き上げ"
    },
    {
      "src": "img/aid/choke-05.webp",
      "label": "妊婦・乳児は 背中をたたく"
    },
    {
      "src": "img/aid/choke-03.webp",
      "label": "反応なし→ 心肺蘇生"
    },
    {
      "src": "img/aid/choke-06.webp",
      "label": "突き上げたら 必ず受診"
    }
  ]
};
