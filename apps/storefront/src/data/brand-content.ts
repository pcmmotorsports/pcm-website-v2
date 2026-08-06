// brand-content.ts — 品牌介紹頁內容資料(20 家)【機器產生,不要手改】
//
// 🔴 本檔由設計側唯一資料來源**求值產生**,不是手抄的:
//    來源 = Open Design `pcm-home-redesign/brand-content-data.js`(1202 行、window.PCM_BRANDS;2026-08-04 materya video 回寫後行數)
//    鐵則 1 例外 = 2026-08-03 Sean 拍 Q1=B(本線真權威在 Open Design、不是 design-reference submodule)
//
// 重新產生(來源改動後):
//    OD=~/Library/Application\ Support/Open\ Design/namespaces/release-stable/data/projects/pcm-home-redesign
//    node -e 'const w={};new Function("window",require("fs").readFileSync(process.argv[1],"utf8"))(w);
//             console.log(JSON.stringify(w.PCM_BRANDS,null,2))' "$OD/brand-content-data.js"
//    …再把輸出貼回下方陣列(header 與兩個 export 保留)。
//    產生後**必跑** `brand-content.test.ts`:那支守的是 D2/D3 依賴的結構不變量。
//
// 🔶 **2026-08-06 標點遷移片(H1):本檔由 OD 來源重新產生**,不是手改標點。
//    Sean 2026-08-05 晚拍板 A = 全站標點遷移(落點:`STATUS.md` 已拍板區 + memory
//    `project_home-redesign-wire-decisions`),而 Sean 本人已先在 OD 端改完
//    (OD 解析後資料實測:CJK 後全形逗號 **501**、CJK 後半形逗號 **0**;
//     半形逗號總數 81 全部落在英數字之間或標記邊界)⇒ 正解是照上面那條指令重產。
//    ⚠️ 前一版這裡寫「全形 501 / 半形 69」——**69 是對原始 .js 檔文字 grep 出來的**
//    (含 JS 語法與註解),與 501 不同軸卻寫成一組,違反字面值三來源律。R1 抓到,已重量。
//    重產前逐欄比對過舊值 vs 新值(20 家 × 全欄):**除了下面 KINEO 那一格,差異 100% 是標點**,
//    零內容漂移。同時帶進 OD 新增的 `wallTagline` 欄(20 家、純字串)——
//    **消費端是 D5f 磚牆片**,在那之前無人讀。
//    ⚠️ 第三類差異(R1 補抓):materya 那筆的 `video` key **順序**由 `aside` 之後移到 `craft` 之後。
//    語意零影響(全 repo 無人對 brand 物件跑 Object.keys/entries/values),但「差異 100% 是標點」
//    這句嚴格說要加上這一條。
//    判準(handoff §七逐字):**前一個字是中文才全形;英數字後面維持半形**。
//    守門 = `brand-content.test.ts` 雙向兩條(中文後不得半形 / 英數後不得全形)。
//
// 🔴 文案內容逐字保留、不得順手「修正」:
//    · ~~標點規則是來源自訂的(「半形逗號 + 全形句號 + 全形頓號」)、不套全形逗號~~
//      **已於 2026-08-06 作廢**:那句寫於 08-03,被 Sean 08-05 晚的全站遷移拍板推翻。
//    · 文案欄位帶白名單標記(<strong> / <br> / &amp;),渲染端一律過
//      `@/lib/brand-rich-text` 的 parseBrandRichText,**絕不 dangerouslySetInnerHTML**。
//    · 事實只寫 `brand-content-sources.md` 列出的官方頁面有的;查不到的欄位整格拿掉,
//      不要填「官方未載明」(Sean 2026-08-02)。
//    · 🔴 Kineo 的齒盤說法**與官網相反是刻意的**:官網 FAQ 寫「原廠齒盤可沿用」,
//      Sean 2026-08-03 更正為「Kineo 隨輪組供應專用齒盤」。不要照官網改回去。
//
// 🔴🔴 **手改一處、OD 來源尚未回寫(D3c-4,2026-08-05)**:KINEO 的 `categories` 由
//    `輪框與傳動` 改成 **`懸吊與車架 · 輪圈`**,依 **Sean 2026-08-05 拍板 Q3=A / Q4=A**。
//    ⚠️ **照上面那條指令重新產生會把它改回去** —— OD `brand-content-data.js` 那一格仍是舊字面。
//    為什麼要改:`輪框與傳動` 在正式商品目錄的兩層 taxonomy **都查無**,而
//    `parseCategoryFromUrl` 比對不到時是**靜默退回不篩選**(客人按了看到該品牌全部商品、
//    零錯誤訊息;backlog #315)。新字面是「大類 · 子類」兩層形式,分隔符逐字是
//    ` · `(空格 + U+00B7 + 空格),與 `products-url-state.tsx` 的 `CATEGORY_URL_SEPARATOR` 同。
//    2026-08-05 真瀏覽器實測:該值篩到 **8 件**(= 輪圈子分類),對照只填大類是 202 件。
//    守門 = `lib/brand-products.test.ts` 有一條會紅(它同時釘新字面與「舊字面必須消失」),
//    所以重新產生**不會靜默**;但仍請**先回寫 OD** 再重新產生。回寫債 = backlog **#322**。
//    ⚠️ **2026-08-06 標點遷移片實際踩到了**:重產出來的 KINEO 又是 `輪框與傳動`(OD 仍未回寫),
//    重產時已**重新套回** `懸吊與車架 · 輪圈`。
//    ⚠️ 前一版這裡寫「並斷言 OD 端仍是舊值,#322 回寫後那句斷言會紅」——**那條斷言不存在**
//    (R1 抓到;測試讀不到 repo 外的 OD 檔,結構上也做不到)。實情是:重產腳本是一次性的,
//    #322 回寫之後請**人工**比對一次,再決定是否拿掉這段覆寫。
//    repo 內真正守得住的是 `brand-content.test.ts` 那條「KINEO 是拍板字面、舊字面必須消失」。
//
// ✅ **materya `video` 區塊已回寫 OD 來源、兩邊一致**(2026-08-04 主視窗執行,Sean 拍 #319 Q2=A):
//    D2f 當天這裡曾是「手改、與來源不同步」——重新產生會把 Sean 指定的影片(IG reel DVeM7gWDB3F)
//    整塊刪掉而零測試變紅。回寫後已實跑上面的產生指令驗證:輸出含 materya video、與本檔逐字同。
//    ⚠️ mp4/poster 實體檔只在本 repo(`public/brand-assets/…`),OD 專案側沒放檔案 ⇒
//      OD 預覽該格播不動是正常的;資料契約以 `brand-content-data.js` 為準。
//    守門 = `brand-content.test.ts` 的「materya 的 About 右欄影片還在」那條**保留當回歸**
//      (它擋的是「有人改 OD 來源把這筆刪了再重新產生」的路)。
//
// L2 內容分級(鐵則 9、backlog #271):四則事實與兩段介紹目前 hardcode、無後台 CRUD。

import type { BrandContent } from './brand-content-types';

export const BRAND_CONTENT: BrandContent[] = [
  {
    "slug": "akrapovic",
    "name": "AKRAPOVIČ",
    "country": "斯洛維尼亞",
    "origin": "斯洛維尼亞 · 自 1991",
    "lede": "斯洛維尼亞的排氣系統製造商，自設鈦合金鑄造廠，全段排氣與尾段消音器的鈦合金與碳纖維部件皆於自有產線完成。",
    "wallTagline": "排氣管、鈦合金消音器",
    "slogan": "聲浪只是結果，<br>材料才是原因。",
    "band": {
      "src": "assets/brands-hero/akrapovic.jpg",
      "alt": "Akrapovič 廠內馬力機上的測試車",
      "focus": "center 58%"
    },
    "bandLogo": "assets/brands-dark/akrapovic.png",
    "logoScale": 1,
    "facts": [
      [
        "Founded",
        "1991 年",
        "以賽車排氣系統起家"
      ],
      [
        "Made in",
        "斯洛維尼亞",
        "研發、鑄造與製造均於自有廠區"
      ],
      [
        "Material",
        "鈦合金 · 碳纖維",
        "自有合金配方與鑄造產線"
      ],
      [
        "Racing",
        "MotoGP · WorldSBK",
        "同時提供 MXGP 廠隊技術支援"
      ]
    ],
    "about": {
      "lead": "<strong>聲浪之前，先有賽道。</strong>1991 年 Akrapovič 自賽車排氣系統起步，1997 年於世界超級摩托車錦標賽奪下首勝，2002 年登上 MotoGP,至 2015 年累計一百座世界冠軍。<br><br>自 2009 年啟用自有鈦合金鑄造廠與冶金實驗室起，從熔煉、成形到最終焊道全程收攏在斯洛維尼亞的自有廠區。您聽見的每一道聲浪，都由這條產線親手決定。",
      "pull": "先有賽事需求，才有市售版本。",
      "tail": "<strong>選擇 Akrapovič,不只是選擇聲浪。</strong>鈦合金在高溫環境下的強度可達商用純鈦合金的三倍，重量較不鏽鋼輕上四成——排氣是全車溫度最高的段落，這兩項數據在此才有意義。<br><br><strong>性能與法規之間，由我們替您拿捏。</strong>段別與觸媒配置決定這套系統偏向街道或賽道，也牽動驗車；即便同款車型，不同年式的吊架位置仍有差異。歡迎提供您的車型與出廠年份，由我們為您規劃最合適的方案。"
    },
    "aside": {
      "src": "assets/brands-prod/akrapovic/muffler.jpg",
      "alt": "Akrapovič 排氣尾段出口特寫",
      "title": "鈦合金排氣尾段",
      "note": "雙出尾管的出口特寫。"
    },
    "video": {
      "youtube": "XxcrFUdhAZQ",
      "poster": "assets/brands-prod/akrapovic/company-film-poster.jpg",
      "title": "Akrapovič Company Film",
      "caption": "官方 Company Film"
    },
    "highlights": {
      "title": "為什麼是 Akrapovič",
      "lead": "排氣系統的差異不只在聲浪。Akrapovič 將冶金、材料實驗與賽事驗證整合於自有體系，每一段管路的材料在出廠前皆經內部驗證。",
      "cards": [
        {
          "t": "自熔煉起始的生產鏈",
          "d": "2009 年啟用自有鈦合金鑄造廠，並設置冶金實驗室。能從合金熔煉一路執行到成品的排氣品牌，全球屈指可數。"
        },
        {
          "t": "自有配方的鈦合金",
          "d": "Akrapovič 的鈦合金於<strong>高溫環境下</strong>的強度為商用純鈦合金的三倍，重量較不鏽鋼輕 40%。排氣系統是全車溫度最高的部位，這兩項數據才具實質意義。"
        },
        {
          "t": "以賽事作為驗證場域",
          "d": "1997 年取得 WorldSBK 首勝，2002 年進入 MotoGP,2015 年累計 100 座世界冠軍。技術支援橫跨 MotoGP、WorldSBK 與 MXGP。"
        },
        {
          "t": "逾 35 年的材質加工經驗",
          "d": "累積超過 35 年鈦合金、不鏽鋼、碳纖維與鋁合金的加工經驗。管件的焊道品質與收邊處理，差別即源於此。"
        }
      ]
    },
    "stats": {
      "items": [
        {
          "n": "1,800",
          "l": "員工人數",
          "s": "設計、製造、賽事支援",
          "plus": true
        },
        {
          "n": "80",
          "l": "銷售國家",
          "s": "自斯洛維尼亞供應全球市場",
          "plus": true
        },
        {
          "n": "2009",
          "l": "自有鈦合金鑄造廠",
          "s": "並設置冶金實驗室"
        },
        {
          "n": "100",
          "l": "座世界冠軍",
          "s": "2015 年累計達成"
        }
      ]
    },
    "timeline": {
      "title": "三十年，從排氣工坊到廠隊指定供應商",
      "items": [
        {
          "y": "1991",
          "key": true,
          "t": "公司成立",
          "d": "於斯洛維尼亞創立，以賽車排氣系統起家。"
        },
        {
          "y": "1993",
          "t": "進入國際賽事",
          "d": "產品開始應用於國際賽事場域。"
        },
        {
          "y": "1997",
          "t": "WorldSBK 首勝",
          "d": "首度於世界超級摩托車錦標賽奪下分站冠軍。"
        },
        {
          "y": "1999",
          "t": "新廠房啟用",
          "d": "產能與生產設備同步升級。"
        },
        {
          "y": "2000",
          "key": true,
          "t": "首座世界冠軍",
          "d": "由參賽者轉為奪冠者。"
        },
        {
          "y": "2002",
          "t": "進軍 MotoGP",
          "d": "跨入兩輪賽事的最高層級。"
        },
        {
          "y": "2007–2009",
          "t": "建置材料實驗室",
          "d": "材料驗證由外部委託轉為自主執行。"
        },
        {
          "y": "2009",
          "key": true,
          "t": "自有鈦合金鑄造廠啟用",
          "d": "自行熔煉合金，生產路徑自此與多數排氣品牌分道。"
        },
        {
          "y": "2012",
          "t": "二輪四輪同年奪冠",
          "d": "首度於兩輪與四輪的世界級賽事同年取得成績。"
        },
        {
          "y": "2014",
          "t": "第二座工廠 · Red Dot 設計獎",
          "d": "產能再度擴充，並以 Ducati 車型專用系統獲 Red Dot 肯定。"
        },
        {
          "y": "2015",
          "key": true,
          "t": "累計 100 座世界冠軍",
          "d": "同年推出新世代排氣系統。"
        },
        {
          "y": "2018",
          "t": "導入耐久測功機",
          "d": "耐久性驗證自路試經驗轉為可重複的實驗室數據。"
        },
        {
          "y": "2021",
          "t": "品牌三十週年",
          "d": "三十年累積出自材料至賽事的完整體系。"
        }
      ]
    },
    "craft": {
      "title": "兩項難以複製的能力",
      "rows": [
        {
          "step": "01 — Materials & Lab",
          "t": "材料實驗室",
          "img": "assets/brands-prod/akrapovic/story-materials.webp",
          "alt": "Akrapovič 材料實驗室與碳纖維部件檢測",
          "d": "累積逾 35 年的鈦合金、不鏽鋼、碳纖維與鋁合金加工經驗，並自建材料實驗室與耐久測功機。輕量與強度在此不是形容詞，而是需要實際量測的數據。"
        },
        {
          "step": "02 — Titanium Foundry",
          "t": "自有鈦合金鑄造廠",
          "img": "assets/brands-prod/akrapovic/story-foundry.webp",
          "alt": "Akrapovič 自有鈦合金鑄造廠澆鑄作業",
          "d": "2009 年起自行熔煉鈦合金。高溫下強度達商用純鈦合金三倍、重量較不鏽鋼輕 40%。排氣系統溫度最高的段落最能反映此一差異，而多數品牌僅能選用市售材料。"
        }
      ]
    },
    "categories": [
      [
        "排氣系統",
        10
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 0
    }
  },
  {
    "slug": "bonamici",
    "name": "BONAMICI RACING",
    "country": "義大利",
    "origin": "義大利 · Otricoli",
    "lede": "以航太級鋁合金製作腳踏後移、拉桿與防護件的義大利家族加工廠，產品自賽道需求往回設計。",
    "wallTagline": "腳踏後移、拉桿、油杯",
    "slogan": "先把金屬做好，<br>才談得上做零件。",
    "band": {
      "src": "assets/brands-hero/bonamici.jpg",
      "alt": "Triumph Speed Triple 1200 RS 裝上 Bonamici Racing 腳踏組",
      "focus": "center 55%"
    },
    "bandLogo": "assets/brands-dark/bonamici.png",
    "logoScale": 1,
    "facts": [
      [
        "Made in",
        "義大利 Otricoli",
        "家族金屬工藝的所在地"
      ],
      [
        "Material",
        "航太級鋁合金",
        "CNC 削切成形"
      ],
      [
        "Products",
        "腳踏後移 · 拉桿 · 防護",
        "型錄的三條主線"
      ]
    ],
    "about": {
      "lead": "<strong>先是一雙削金屬的手，才有這個品牌。</strong>故事自 Luciano Bonamici 寫起——一位精密加工的老師傅；兒子 Riccardo 與 Enrico 承接這套手藝，再把它接上賽事需求，家族經營至今逾二十年。<br><br>設計與製造全程留在義大利薩賓丘陵的自有廠區，採用最新世代 CNC 設備與航太級鋁合金。",
      "pull": "先是一間金屬加工廠，才成為一個機車品牌。",
      "tail": "<strong>腳踏後移，改變的是您與車的三個接觸點。</strong>研發流程直接起於賽道：與職業車隊及工程師的接觸，決定產品下一版的形狀與可調範圍。位置一經變更，煞車與打檔行程隨之改變，這正是可調範圍存在的理由。<br><br><strong>合身，才談得上操控。</strong>歡迎與我們聯繫、提供您的車型年份與慣用騎姿，由我們替您推算合適的落點。"
    },
    "aside": {
      "src": "assets/brands-prod/bonamici/rearset.jpg",
      "alt": "Bonamici Racing 腳踏後移組",
      "title": "腳踏後移組",
      "note": "航太級鋁削切，踏板與連桿位置可調。"
    },
    "highlights": {
      "title": "為什麼是 Bonamici Racing",
      "lead": "這個品牌的起點不是機車零件，是金屬加工。差別出現在削切精度與收邊，不在型錄照片上。",
      "cards": [
        {
          "t": "自父親的金屬工藝開始",
          "d": "故事的起點是 Luciano Bonamici,一位精密加工的老師傅。兒子 Riccardo 與 Enrico 承接這套手藝，再把它接上賽事需求。"
        },
        {
          "t": "逾二十年的家族經營",
          "d": "公司成立至今已逾二十年，設計與製造<strong>全程在義大利完成</strong>,廠址位於薩賓丘陵一帶。"
        },
        {
          "t": "航太鋁與新世代 CNC",
          "d": "採用最新世代 CNC 設備與<strong>航太級鋁合金</strong>,目標是精度、輕量與強度三者同時成立，而非只取其一。"
        },
        {
          "t": "研發自賽道往回走",
          "d": "研發流程直接起於賽道：與職業車隊及工程師的直接接觸，決定產品下一版的形狀與可調範圍。"
        }
      ]
    },
    "craft": {
      "title": "從家族工廠到 WorldSBK",
      "rows": [
        {
          "step": "01 — Heritage",
          "t": "家族的起點",
          "img": "assets/brands-prod/bonamici/craft-heritage.jpg",
          "alt": "Bonamici 家族早年的機車與人物老照片",
          "d": "故事的開篇不是公司，是人：父親 Luciano,精密金屬加工的老師傅。照片裡的年代早於這個品牌本身，對機車的興趣也是。"
        },
        {
          "step": "02 — WorldSBK",
          "t": "ROKiT BMW 廠隊的技術夥伴",
          "img": "assets/brands-prod/bonamici/rokit-bmw.jpg",
          "alt": "Bonamici Racing 與 ROKiT BMW Motorrad WorldSBK 車隊的合作標誌",
          "d": "2026 年宣布與 <strong>ROKiT BMW Motorrad WorldSBK 車隊續約至 2026–2027 賽季</strong>,並已為該隊供應完整的部品系列。他們的說法很直接：「We ride together. We win together.」"
        }
      ]
    },
    "video": {
      "youtube": "JBWv0RvSWXY",
      "poster": "assets/brands-prod/bonamici/film-poster.jpg",
      "title": "Bonamici Racing 官方影片",
      "caption": "官方影片"
    },
    "categories": [
      [
        "腳踏後移與傳動",
        9
      ],
      [
        "拉桿與把手",
        5
      ],
      [
        "車身防護與防摔",
        4
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 1
    }
  },
  {
    "slug": "cnc-racing",
    "name": "CNC RACING",
    "country": "義大利",
    "origin": "義大利 · 阿雷佐 · 自 1995",
    "lede": "以航太鋁與鈦合金為 Ducati、MV Agusta、Aprilia 車主製作拉桿、離合器蓋、油箱蓋與腳踏後移的義大利加工廠。",
    "wallTagline": "CNC 切削件、離合器蓋",
    "slogan": "削過金鍊的手，<br>收邊不會馬虎。",
    "band": {
      "src": "assets/brands-hero/cnc-racing.jpg",
      "alt": "CNC Racing 部品裝車情境",
      "focus": "center"
    },
    "bandLogo": "assets/brands-dark/cnc-racing.png",
    "logoScale": 1,
    "facts": [
      [
        "Founded",
        "1995 年",
        "Dario Secondini 與 Franco Fornaini 創立"
      ],
      [
        "Made in",
        "義大利 托斯卡尼 阿雷佐",
        "前身是金鍊機具加工廠"
      ],
      [
        "Material",
        "7075-T6 航太鋁 · 鈦合金",
        "陽極色澤均勻，倒角收邊細緻"
      ],
      [
        "Racing",
        "Pramac Racing · MotoGP 技術夥伴",
        "2011 年 Althea Racing 拿下 WSBK 冠軍"
      ]
    ],
    "about": {
      "lead": "<strong>1995 年，兩位工程師把車床轉了個方向。</strong>Dario Secondini 與 Franco Fornaini 於托斯卡尼的阿雷佐創立 SEFO,原本製造的是金鍊機具 —— 阿雷佐是義大利的黃金之都。2008 年金飾產業崩盤，他們把同一批車床轉向了自己真正投入的領域。<br><br>2011 年贊助的 Althea Racing 奪下世界超級摩托車冠軍，如今是 MotoGP 車隊 Pramac Racing 的技術夥伴。",
      "pull": "替金鍊機具削過的手，後來用來削離合器蓋。",
      "tail": "<strong>黃金之都的加工資歷，如今看得見。</strong>整塊 7075-T6 航太鋁削切成形、單體結構，拉桿的剛性與手感因此長期一致；而陽極色澤的均勻度與倒角收邊，是加工廠層級的差異，無法從設計圖上判讀。<br><br><strong>六個原廠車系，每一件都對應到年式。</strong>型錄裡沒有通用品項。歡迎告訴我們您的車型與出廠年份，由我們替您核對到正確的那一件。"
    },
    "aside": {
      "src": "assets/brands-prod/cnc-racing/front-detail.jpg",
      "alt": "裝上 CNC Racing 後視鏡與控制部品的車頭特寫",
      "title": "車頭部品全套",
      "note": "後視鏡、拉桿與油杯座，同一套陽極色系。"
    },
    "highlights": {
      "title": "為什麼是 CNC Racing",
      "lead": "同樣是鋁削切件，差異出現在收邊與陽極色澤上。這來自阿雷佐的精密加工背景，而非設計圖。",
      "cards": [
        {
          "t": "自金鍊機具轉向的加工廠",
          "d": "1995 年 Dario Secondini 與 Franco Fornaini 於阿雷佐創立 SEFO,原本製造金鍊機具。他們自己的說法是<strong>「比同業更早，把專業從金飾業轉向技術門檻更高的領域」</strong>。"
        },
        {
          "t": "整塊鋁材削切成形",
          "d": "產品一律採用 <strong>billet 整塊鋁材 CNC 削切</strong>與陽極處理；拉桿等件為單體結構，以取得剛性與長期一致的操作手感，而非組裝件。"
        },
        {
          "t": "六個原廠車系的專用件",
          "d": "型錄以 Aprilia、BMW、Ducati、KTM、Moto Guzzi、MV Agusta 六個車系作為入口，每一件對應到車型與年式，不設通用品項。"
        },
        {
          "t": "賽道先驗證，型錄後上架",
          "d": "與 Superbike、MotoGP 車隊的技術合作與實際比賽測試，是產品「後續才提供給一般市場」的前置程序，不是行銷詞。"
        }
      ]
    },
    "stats": {
      "items": [
        {
          "n": "37",
          "l": "個銷售國家",
          "s": "橫跨五大洲"
        },
        {
          "n": "30",
          "l": "年加工資歷",
          "s": "精密加工資歷"
        },
        {
          "n": "6",
          "l": "個原廠車系專用線",
          "s": "Aprilia · BMW · Ducati · KTM · Moto Guzzi · MV Agusta"
        }
      ]
    },
    "craft": {
      "title": "金飾業留下來的兩件事",
      "rows": [
        {
          "step": "01 — Measurement",
          "t": "量得出來的精度",
          "img": "assets/brands-prod/cnc-racing/craft-measure.jpg",
          "alt": "以游標卡尺量測 CNC Racing 削切鋁件的作業",
          "d": "金鍊機具的公差要求不比機車零件低。他們<strong>比同業更早把專業從金飾業轉出來</strong>;留下來的是量測與公差的習慣，那是拉桿裝上去手感一致的前提。"
        },
        {
          "step": "02 — Anodising",
          "t": "陽極色澤與收邊",
          "img": "assets/brands-prod/cnc-racing/craft-anodise.jpg",
          "alt": "CNC Racing 陽極紅齒盤座與鏈條特寫",
          "d": "同樣是紅色陽極，批次之間會不會有色差、倒角摸起來會不會刮手，是加工廠層級的差別。<strong>這一段在設計圖上看不出來</strong>,只有拿到實物才分得出。"
        }
      ]
    },
    "video": {
      "file": "assets/brand-video/cnc-racing-reel.mp4",
      "portrait": true,
      "poster": "assets/brands-prod/cnc-racing/reel-poster.jpg",
      "source": "https://www.instagram.com/reel/DbgUh-BIaI6/",
      "sourceLabel": "看官方 IG 原貼文",
      "title": "CNC Racing Clear Clutch Kit",
      "caption": "官方 IG · 透明離合器套件"
    },
    "categories": [
      [
        "拉桿與把手",
        5
      ],
      [
        "引擎與冷卻",
        7
      ],
      [
        "腳踏後移與傳動",
        9
      ],
      [
        "外觀與後視鏡",
        1
      ],
      [
        "精品螺絲與螺帽",
        6
      ],
      [
        "車身防護與防摔",
        4
      ],
      [
        "碳纖維部品",
        3
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 2
    }
  },
  {
    "slug": "dbk",
    "name": "DBK SPECIAL PARTS",
    "country": "義大利",
    "origin": "義大利 · 自 2009",
    "lede": "自 Ducabike 的改裝經驗延伸而來的義大利廠，產品涵蓋引擎、腳踏、防護與碳纖維件，服務對象不限於 Ducati 車主。",
    "wallTagline": "車身防護、腳踏、螺絲",
    "slogan": "不是只有 Ducati<br>值得被好好對待。",
    "band": {
      "src": "assets/brands-hero/dbk.jpg",
      "alt": "DBK 義大利自有工廠的團隊與 CNC 產線",
      "focus": "center 14%"
    },
    "bandLogo": "assets/brands-dark/dbk.png",
    "logoScale": 1,
    "facts": [
      [
        "Founded",
        "2009 年",
        "前身 Ducabike 創於 1999 年"
      ],
      [
        "Made in",
        "義大利",
        "設計與製造皆於義大利"
      ],
      [
        "Material",
        "碳纖維部品 · 鋁合金削切件",
        "三軸與五軸 CNC 產線"
      ],
      [
        "Products",
        "引擎 · 腳踏 · 防護",
        "型錄的三條主線"
      ]
    ],
    "about": {
      "lead": "<strong>從一個人的興趣，長成十二個車系的型錄。</strong>DBK 的前身只做 Ducati。做久了，騎其他車的人也上門問同樣的東西 —— 型錄就是這樣一個車系一個車系長出來的，不是先畫好版圖再往裡面填。<br><br>今天設計、製造與銷售都在自有總部完成。一件部品從 CAD 到出貨不經過別人的手，對得上車就是對得上車。",
      "pull": "手工的品質，以現代的方式重新整理過。",
      "tail": "<strong>三軸與五軸 CNC 並行，是能做什麼的差別。</strong>技術部門以最新 CAD／CAM 設計，量產前先做 3D 掃描與 3D 列印原型——碳纖維與鋁削切件的孔位因此對得上實車，不是只對得上圖面。<br><br><strong>外觀相近，不代表孔位相同。</strong>引擎、腳踏與防護件在不同車系之間差異甚大。歡迎提供您的車型與出廠年份，讓我們替您查到對應的那一款。"
    },
    "aside": {
      "src": "assets/brands-prod/dbk/chain-adjuster.jpg",
      "alt": "DBK 鋁合金鏈條調整片",
      "title": "鏈條調整片",
      "note": "CNC 削切、陽極上色，含防摔滑塊座。"
    },
    "highlights": {
      "title": "為什麼是 DBK",
      "lead": "從 Ducabike 的改裝經驗延伸出來，如今服務的車系遠不只 Ducati。",
      "cards": [
        {
          "t": "自 Ducabike 的經驗長出來",
          "d": "前身 Ducabike <strong>創於 1999 年</strong>,是 Claudio Gandolfi 把自幼的機車興趣做成事業。長年替 Ducati 車主開發部品後，其他車系的車主提出相同需求，於是擴充型錄，2009 年成為現在這個品牌。"
        },
        {
          "t": "十二個車系的專用件",
          "d": "型錄以車系為入口，涵蓋 Ducati、BMW、Honda、Yamaha、Kawasaki、KTM、Aprilia、MV Agusta、Triumph、Moto Guzzi、Moto Morini 與 Italjet。"
        },
        {
          "t": "三軸與五軸 CNC 並行",
          "d": "廠內配置<strong>三軸與五軸 CNC 設備</strong>,由專責人員操作；技術部門使用最新的 CAD／CAM 軟體，並以 <strong>3D 掃描與 3D 列印做原型</strong>,是研發的必要環節。"
        },
        {
          "t": "2014 年起自有總部",
          "d": "2014 年起設立自有總部，<strong>逾 22 名員工</strong>負責設計、製造與銷售。工法維持手工品質，但以現代的設計與生產方式重新整理過。"
        }
      ]
    },
    "stats": {
      "items": [
        {
          "n": "12",
          "l": "個對應車系",
          "s": "Ducati · BMW · Honda · Yamaha · KTM 等"
        },
        {
          "n": "22",
          "l": "名員工",
          "s": "2014 年起的自有總部規模",
          "plus": true
        },
        {
          "n": "1999",
          "l": "前身 Ducabike 創立",
          "s": "創辦人 Claudio Gandolfi"
        },
        {
          "n": "2",
          "l": "種 CNC 軸數",
          "s": "三軸與五軸設備並行"
        }
      ]
    },
    "video": {
      "youtube": "HmESGjFkVPw",
      "poster": "assets/brands-prod/dbk/film-poster.jpg",
      "title": "DBK Special Parts 官方形象影片",
      "caption": "官方首頁形象影片"
    },
    "craft": {
      "title": "看得見的與看不見的",
      "rows": [
        {
          "step": "01 — Signature",
          "t": "LED 透明離合器外蓋",
          "img": "assets/brands-prod/dbk/led-clutch.jpg",
          "alt": "DBK Clear Clutch Cover EVO LED 透明離合器外蓋",
          "d": "近期的主打品項。透明蓋讓乾式離合器的動作看得見，<strong>內建 LED 讓它在夜裡也成立</strong>;外環另有多種陽極色可選。這類外蓋要對到車型與排氣量，不是通用件。"
        },
        {
          "step": "02 — Engineering",
          "t": "CAD 設計室",
          "img": "assets/brands-prod/dbk/cad-room.jpg",
          "alt": "DBK 義大利廠內的 CAD 設計作業",
          "d": "技術部門以最新 CAD／CAM 軟體作業，並用 3D 掃描與列印做原型。<strong>引擎護件與腳踏的固定點在不同車系之間差異甚大</strong>,外觀相近不代表孔位相同；逐車系重畫，才是型錄能橫跨十二個車系的前提。"
        }
      ]
    },
    "categories": [
      [
        "引擎與冷卻",
        7
      ],
      [
        "腳踏後移與傳動",
        9
      ],
      [
        "車身防護與防摔",
        4
      ],
      [
        "碳纖維部品",
        3
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 3
    }
  },
  {
    "slug": "eazi-grip",
    "name": "EAZI-GRIP",
    "country": "英國",
    "origin": "英國",
    "lede": "製作車型專用油箱止滑貼與車身保護膜的英國品牌，以貼片位置讓大腿在煞車與過彎時取得支點。",
    "wallTagline": "油箱止滑貼、防滑膠條",
    "slogan": "大腿夾得住車，<br>手腕就不必吃車重。",
    "band": {
      "src": "assets/brands-hero/eazi-grip.jpg",
      "alt": "Eazi-Grip 贊助的 Ducati 賽事車隊",
      "focus": "center 40%"
    },
    "bandLogo": "assets/brands-dark/eazi-grip.png",
    "logoScale": 1.04,
    "facts": [
      [
        "Made in",
        "英國",
        ""
      ],
      [
        "Material",
        "止滑貼 · 車身保護膜",
        "車型專用剪裁，非通用片"
      ],
      [
        "Genuine",
        "官方經銷識別",
        "產品指南設有正品辨識章節"
      ]
    ],
    "about": {
      "lead": "<strong>止滑貼是少數看照片分不出好壞的東西——直到有人把它裝上賽車。</strong>指名選用它的隊伍：英國超級摩托車現役冠軍 Nitrous Competitions Racing、世界超級摩托車的 Superbike Advocates Racing、世界 Supersport 的 QJMotor Factory Racing。<br><br>同一份名單上，還有騎士訓練學校與特技車手。",
      "pull": "每天用大腿撐住整台車的人，挑的是同一款。",
      "tail": "<strong>賽車的油箱，是拿來夾的。</strong>重煞與入彎時大腿撐不住，手腕就得吃下整台車的重量。車型專用剪裁順著油箱線條走，不蓋掉轉折也不翹邊，大腿才有穩定的支點；通用片自行裁切，差的往往正是要撐住的那一段。<br><br><strong>貼對位置，才算數。</strong>歡迎提供您的車型與出廠年份，由我們替您核對對應片型與正品識別。"
    },
    "aside": {
      "src": "assets/brands-prod/eazi-grip/race-ducati.jpg",
      "alt": "裝上 Eazi-Grip 止滑貼的 Ducati 賽車油箱",
      "title": "賽車實裝",
      "note": "參賽車隊指名使用的同一款止滑貼。"
    },
    "highlights": {
      "title": "為什麼是 Eazi-Grip",
      "lead": "止滑貼從照片上看不出等級，但職業車隊會挑。從英國超級摩托車到世界超級摩托車，參賽隊伍指名使用是最實際的背書。",
      "cards": [
        {
          "t": "現役冠軍車隊指名使用",
          "d": "選用 Eazi-Grip 油箱止滑貼的隊伍：英國超級摩托車<strong>現役冠軍 Nitrous Competitions Racing</strong>、英國 Supersport 與道路賽的 Scars Racing、世界超級摩托車的 Superbike Advocates Racing,以及世界 Supersport 的 QJMotor Factory Racing。"
        },
        {
          "t": "從 BSB 到 MotoGP 都有",
          "d": "長期合作的車手名單：Kyle Ryde、Scott Redding、Leon Haslam、Storm Stacey、Max Cook 於英國超級摩托車；<strong>Cal Crutchlow 以 LCR Honda 出賽 MotoGP</strong>;David Salvador 將於 2027 年加入 Kawasaki 世界 Supersport 車隊。"
        },
        {
          "t": "車隊之外還有騎士學校",
          "d": "他們自己下的標題是「Leading teams, schools and stunt riders choose Eazi-Grip」——<strong>騎士訓練學校與特技車手</strong>也在名單裡。這三種人的共同點是每天都在用膝蓋與大腿夾車。"
        },
        {
          "t": "新車一出就備好",
          "d": "面對 2026 年的新車潮（BMW F 450 GS 到 Yamaha Tenere 700 World Raid）,他們同步備妥對應品項。<strong>車型專用剪裁的前提是先有那台車的資料</strong>,晚一步就等於沒有。"
        }
      ]
    },
    "stats": {
      "items": [
        {
          "n": "4",
          "l": "支公告指名的車隊",
          "s": "含 BSB 現役冠軍隊伍"
        },
        {
          "n": "3",
          "l": "個錦標賽層級",
          "s": "MotoGP · WorldSBK／WorldSSP · BSB"
        },
        {
          "n": "2027",
          "l": "年 WorldSSP 陣容",
          "s": "David Salvador 加入 Kawasaki 車隊"
        }
      ]
    },
    "craft": {
      "title": "在維修區看得到的東西",
      "rows": [
        {
          "step": "01 — WorldSSP",
          "t": "世界 Supersport 的維修區",
          "img": "assets/brands-prod/eazi-grip/worldssp.jpg",
          "alt": "世界 Supersport 車隊維修區內的 Kawasaki 賽車",
          "d": "這是 WorldSBK／WorldSSP 週末的維修區現場。<strong>賽車的油箱不是拿來看的，是拿來夾的</strong>;重煞與入彎時大腿撐不住，手腕就得吃掉整台車的重量。"
        },
        {
          "step": "02 — BSB",
          "t": "英國超級摩托車的冠軍爭奪",
          "img": "assets/brands-prod/eazi-grip/bsb-win.jpg",
          "alt": "英國超級摩托車錦標賽車手於賽道慶祝",
          "d": "BSB 冠軍戰的名單裡，Kyle Ryde、Scott Redding、Brad Ray 都在用。<strong>職業車手挑止滑貼看的是剪裁與定位</strong>,不是圖案；貼錯位置的專用片跟通用片沒有差別。"
        }
      ]
    },
    "categories": [
      [
        "止滑貼與保護膜",
        8
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 4
    }
  },
  {
    "slug": "ebc",
    "name": "EBC BRAKES",
    "country": "英國",
    "origin": "英國 · Northampton",
    "lede": "以自有英美工廠生產煞車皮與機車碟盤的英國廠，配方依街道、旅行、賽道與越野分別開發。",
    "wallTagline": "來令片、浮動碟盤、煞車油管",
    "slogan": "停得住，<br>才敢放心催下去。",
    "band": {
      "src": "assets/brands-hero/ebc.jpg",
      "alt": "EBC Brakes 官方形象橫幅｜速可達到大型旅行車共用同一套來令片體系",
      "focus": "center 50%"
    },
    "bandLogo": "assets/brands-dark/ebc.png",
    "logoScale": 1,
    "facts": [
      [
        "Made in",
        "英國／美國自有工廠",
        "機車碟盤於英國生產"
      ],
      [
        "Material",
        "有機 · 燒結配方",
        "依用途分配方，無通用規格"
      ],
      [
        "Products",
        "煞車皮 · 機車碟盤",
        "兩條主要產品線"
      ]
    ],
    "about": {
      "lead": "<strong>煞車，是您與路面之間唯一的談判籌碼。</strong>EBC 以六十年的煞車材料調配資歷為基礎，煞車皮於自有工廠製造，機車碟盤多數於英國生產，全球員工逾 400 人——這是製造商的規模，不是貼牌。<br><br>所以在這裡，配方的好壞不是形容詞，是量出來的數字。街道、旅行、賽道、越野各走各的配方，原因也在這裡 —— 有設備，才分得出這四件事的差別。",
      "pull": "配方的好壞由數據判定，不靠手感形容。",
      "tail": "<strong>沒有一種配方能同時做好四件事。</strong>通勤要冷車第一下就咬得住，跑山要承受連續重煞，賽道要求高溫下不衰退，越野又是另一回事——街道、旅行、賽道、越野因此各走各的配方。<br><br><strong>逾六萬個料號，冷門年式也查得到。</strong>不必被迫改用近似規格。歡迎告訴我們您的車型年份與用車習慣，由我們替您選定配方。"
    },
    "aside": {
      "src": "assets/brands-prod/ebc/disc.jpg",
      "alt": "EBC Brakes 碟盤與卡鉗",
      "title": "機車碟盤",
      "note": "英國生產，依車型與用途對應不同規格。"
    },
    "highlights": {
      "title": "為什麼是 EBC Brakes",
      "lead": "煞車件的差別在配方與驗證，兩者都需要設備。EBC 兩座自有工廠合計配置八套馬力機，配方由實測數據決定。",
      "cards": [
        {
          "t": "英美兩座自有工廠",
          "d": "煞車皮於自有工廠製造，<strong>機車碟盤多數於英國生產</strong>,全球員工逾 400 人。這是製造商的規模，不是貼牌。"
        },
        {
          "t": "八套馬力機的驗證設備",
          "d": "兩座工廠合計配置 <strong>8 套馬力機系統</strong>,研發投入逾 300 萬美元。配方好壞由數據判定，不靠手感形容。"
        },
        {
          "t": "六十年的配方資歷",
          "d": "六十年的煞車材料調配資歷，是配方的基礎。街道、旅行、賽道、越野各走各的配方，不用單一規格涵蓋全部。"
        },
        {
          "t": "逾六萬個料號",
          "d": "產品線涵蓋超過 <strong>60,000 個料號</strong>。對車主的實際意義是冷門年式與車型也查得到對應件，不必被迫改用近似規格。"
        }
      ]
    },
    "stats": {
      "items": [
        {
          "n": "400",
          "l": "名員工",
          "s": "全球規模",
          "plus": true
        },
        {
          "n": "60,000",
          "l": "個料號",
          "s": "涵蓋各類移動載具",
          "plus": true
        },
        {
          "n": "8",
          "l": "套馬力機系統",
          "s": "分置英美兩座工廠"
        },
        {
          "n": "300",
          "l": "萬美元研發投入",
          "s": "投入於驗證設備",
          "plus": true
        }
      ]
    },
    "craft": {
      "title": "配方與碟盤，兩件要分開想的事",
      "rows": [
        {
          "step": "01 — Compound",
          "t": "配方決定手感",
          "img": "assets/brands-prod/ebc/disc.jpg",
          "alt": "EBC 機車煞車碟盤",
          "d": "配方依用途分開開發：街道、旅行、賽道、越野各走各的，<strong>不用單一規格涵蓋全部</strong>。通勤要冷車第一下就咬得住，賽道要高溫下不衰退，這兩件事本來就不相容。"
        },
        {
          "step": "02 — Validation",
          "t": "八套馬力機說了算",
          "img": "assets/brands-prod/ebc/race.jpg",
          "alt": "配用 EBC 煞車系統的賽事用車",
          "d": "兩座工廠合計配置 <strong>8 套馬力機系統</strong>、研發投入逾 300 萬美元。配方好壞由數據判定，不靠手感形容；這也是六十年配方資歷能持續累積的原因。"
        }
      ]
    },
    "video": {
      "youtube": "xDidxn04Ess",
      "poster": "assets/brands-prod/ebc/film-poster.jpg",
      "title": "EBC Brakes 官方影片",
      "caption": "官方影片"
    },
    "categories": [
      [
        "煞車系統",
        0
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 5
    }
  },
  {
    "slug": "evotech",
    "name": "EVOTECH PERFORMANCE",
    "country": "英國",
    "origin": "英國 · Alford · 自 2003",
    "lede": "為特定車型開發水箱護網、短牌架與防倒球的英國廠，航太級鋁合金切削後施以粉體烤漆，不製作通用件。",
    "wallTagline": "防摔球、水箱護網、手機架",
    "slogan": "為你那台車做的，<br>不是為所有車做的。",
    "band": {
      "src": "assets/brands-hero/evotech.jpg",
      "alt": "Evotech Performance 英國 Alford 自有工廠",
      "focus": "center"
    },
    "bandLogo": "assets/brands-dark/evotech.png",
    "logoScale": 0.9,
    "facts": [
      [
        "Founded",
        "2003 年",
        "以短牌架起家，至今仍是代表系列"
      ],
      [
        "Made in",
        "英國 英格蘭 林肯郡 Alford",
        "自有工廠 CAD／CAM 一貫化生產"
      ],
      [
        "Material",
        "航太級鋁合金 · CNC + 粉體烤漆",
        "耐候處理，不易鏽蝕或褪色"
      ],
      [
        "Racing",
        "BSB · WSBK 車隊供應 · 曼島 TT",
        "賽事供應與市售件同一條產線"
      ]
    ],
    "about": {
      "lead": "<strong>買不到夠好的，就自己做。</strong>這是 Evotech 的開場白，也是 2003 年於英格蘭林肯郡 Alford 開始的理由。最早建立口碑的短牌架，至今仍是品牌的代表系列。<br><br>如今產品同時供應全球道路騎士，以及英國超級摩托車與世界超級摩托車錦標賽的參賽車隊——出自同一條產線。",
      "pull": "賽道上跑的，與您車上的，同一條產線。",
      "tail": "<strong>孔位來自實車量測，不是從圖面推算。</strong>以 3D 掃描與高階加工設備設計生產，航太級鋁合金 CNC 切削後施以粉體烤漆——這是要掛在車外的零件，耐候處理是基本規格，不是選配。<br><br><strong>選對型號，才保證精準貼合。</strong>歡迎提供您的車型與出廠年份，鎖上就是原廠孔位，不必另外鑽孔。"
    },
    "aside": {
      "src": "assets/brands-prod/evotech/radiator-guard.jpg",
      "alt": "Evotech Performance 水箱護網裝於車輛前方",
      "title": "水箱護網",
      "note": "航太級鋁切削後粉體烤漆，對應車型專用。"
    },
    "highlights": {
      "title": "為什麼是 Evotech Performance",
      "lead": "起點是買不到。創辦人找不到品質合格的改裝件，乾脆自己做——這件事決定了後面所有的做法。",
      "cards": [
        {
          "t": "因為買不到才自己做",
          "d": "創辦人想換的改裝配件在市面上找不到夠好的，於是<strong>決定自己製作</strong>。這個起點至今仍是團隊的共同標準。"
        },
        {
          "t": "3D 掃描起手",
          "d": "以<strong>3D 掃描與高階加工設備</strong>來設計、生產與供應。掃描的意義是孔位與間隙來自實車量測，不是從圖面推算。"
        },
        {
          "t": "賽事與道路同一條線",
          "d": "產品同時供應全球道路騎士與<strong>英國超級摩托車錦標賽、世界超級摩托車錦標賽</strong>的參賽車隊，兩者出自同一條產線。"
        },
        {
          "t": "耐候處理是基本規格",
          "d": "航太級鋁合金 CNC 切削後施以粉體烤漆。<strong>選對型號才保證精準貼合</strong>,下單前確認車型年式即可直上原廠孔位。"
        }
      ]
    },
    "craft": {
      "title": "買不到，所以自己量",
      "rows": [
        {
          "step": "01 — 3D Scanning",
          "t": "孔位來自實車量測",
          "img": "assets/brands-prod/evotech/radiator-guard.jpg",
          "alt": "Evotech Performance 水箱護網裝於賽車前方",
          "d": "以 <strong>3D 掃描</strong>與高階加工設備進行設計與生產。掃描的意義是孔位與間隙取自實車，不是從圖面推算；<strong>選對型號才保證精準貼合</strong>。"
        },
        {
          "step": "02 — Finish",
          "t": "耐候是基本規格",
          "img": "assets/brands-prod/evotech/triumph.jpg",
          "alt": "配掛 Evotech Performance 部品的 Triumph",
          "d": "航太級鋁合金 CNC 切削後施以粉體烤漆，日曬雨淋不易鏽蝕或褪色。<strong>賽事供應與市售件出自同一條產線</strong>,英國超級摩托車與世界超級摩托車錦標賽的車隊用的是同一批東西。"
        }
      ]
    },
    "video": {
      "youtube": "rUGAVbwaO3g",
      "poster": "assets/brands-prod/evotech/film-poster.jpg",
      "title": "Evotech Performance 官方影片",
      "caption": "官方影片"
    },
    "categories": [
      [
        "車身防護與防摔",
        4
      ],
      [
        "外觀與後視鏡",
        1
      ],
      [
        "引擎與冷卻",
        7
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 6
    }
  },
  {
    "slug": "extreme",
    "name": "EXTREME COMPONENTS",
    "country": "義大利",
    "origin": "義大利",
    "lede": "以賽道設定為前提的義大利廠，產品涵蓋腳踏後移、控制連桿與車身部品，可調範圍是重點而非配色。",
    "wallTagline": "碳纖維整流罩、賽道腳踏",
    "slogan": "踏板該在<br>你腳自然落下的位置。",
    "band": {
      "src": "assets/brands-hero/extreme.jpg",
      "alt": "Extreme Components 碳纖維賽道腳踏裝車特寫",
      "focus": "center 45%"
    },
    "bandLogo": "assets/brands-dark/extreme.png",
    "logoScale": 1.06,
    "facts": [
      [
        "Founded",
        "逾十年",
        "確切年份未公開"
      ],
      [
        "Made in",
        "義大利",
        ""
      ],
      [
        "Material",
        "Ergal 7075 T6 · 預浸布複材",
        "硬質陽極氧化，雷射刻印"
      ],
      [
        "Use",
        "賽道取向",
        "研發與參賽車隊共同進行"
      ]
    ],
    "about": {
      "lead": "<strong>這個品牌的起點，是一個很具體的目標。</strong>公司成立於十餘年前，創辦人要做的是能滿足國內與世界錦標賽車手特殊需求的部件，不是先鋪一條市售產品線。<br><br>因此型錄依賽道使用編排：分類邏輯是可調範圍與固定方式，不是造型。",
      "pull": "先有車手的要求，才有這一份型錄。",
      "tail": "<strong>材料的選擇，決定它能不能上場。</strong>削切件一律自整塊 Ergal 7075 T6 取出，施以硬質陽極氧化——硬陽極管的是耐磨，不是顏色；複合材料一律使用預浸布並於高壓爐內成型。<br><br><strong>連禁碳的賽事都備好了。</strong>Black Fiber 出自玻璃纖維家族，輕量特性幾乎等同碳纖維，專為規章禁用碳纖的場合而生。歡迎提供您的車型年份與使用場域，由我們替您配對纖維與織紋。"
    },
    "aside": {
      "src": "assets/brands-prod/extreme/race-fairing.jpg",
      "alt": "裝上 Extreme Components 碳纖維整流罩的賽事用車",
      "title": "賽事用碳纖整流罩",
      "note": "研發與參賽車隊共同進行，測試過才量產。"
    },
    "highlights": {
      "title": "為什麼是 Extreme Components",
      "lead": "賽道部件的差別在材料選擇。同一件整流罩，用哪一種纖維、哪一種織紋，決定它能不能上場、以及撞完還在不在。",
      "cards": [
        {
          "t": "為車隊的特殊需求而生",
          "d": "公司成立於十餘年前，創辦人的目標是<strong>做出能滿足國內與世界錦標賽車手特殊需求的部件</strong>,而非先鋪一條市售產品線。"
        },
        {
          "t": "Ergal 7075 T6 與硬陽極",
          "d": "削切件一律由整塊 <strong>Ergal 7075 T6</strong> 取出，最後施以<strong>硬質陽極氧化</strong>並以雷射刻印標識。硬陽極的意義是耐磨，不是顏色。"
        },
        {
          "t": "只用預浸布，高壓爐成型",
          "d": "複合材料<strong>一律使用預浸布並於高壓爐內成型</strong>,碳纖維與 Black Fiber 依產品類型選用不同克重。碳纖維主要採 Twill 斜紋，也提供 Plein 平紋可選。"
        },
        {
          "t": "為禁碳賽事準備的纖維",
          "d": "<strong>Black Fiber</strong> 出自玻璃纖維家族，超輕，輕量特性幾乎等同碳纖維，專門用於<strong>規章禁止使用碳纖維的賽事</strong>。另有 Epotex,以乾式玻纖 Twill 織布配特殊環氧樹脂，比一般玻纖整流罩更輕也更有彈性。"
        }
      ]
    },
    "stats": {
      "items": [
        {
          "n": "3",
          "l": "種複材可選",
          "s": "碳纖維 · Black Fiber · Epotex"
        },
        {
          "n": "2",
          "l": "種碳纖織紋",
          "s": "Twill 斜紋為主，另可選 Plein 平紋"
        },
        {
          "n": "7075",
          "l": "T6 航太鋁",
          "s": "整塊取出，硬質陽極氧化"
        }
      ]
    },
    "craft": {
      "title": "兩種材料，兩個問題",
      "rows": [
        {
          "step": "01 — Composites",
          "t": "纖維與織紋的選擇",
          "img": "assets/brands-prod/extreme/craft-carbon.jpg",
          "alt": "Extreme Components 碳纖維側整流罩裝於賽事用車",
          "d": "複合材料<strong>一律以預浸布在高壓爐內成型</strong>。若賽事規章禁用碳纖維，則改用 Black Fiber:同屬玻纖家族但超輕，輕量特性幾乎與碳纖維相同。選哪一種，先看規章而不是看預算。"
        },
        {
          "step": "02 — Billet",
          "t": "整塊取出的金屬件",
          "img": "assets/brands-prod/extreme/billet-batch.jpg",
          "alt": "Extreme Components 削切腳踏板件批次，件件可見雷射刻印",
          "d": "金屬件由整塊 <strong>Ergal 7075 T6</strong> 削出，最後走硬質陽極氧化與雷射刻印。硬陽極處理的是耐磨與抗腐蝕；摔車後護蓋還能不能繼續用，差別在這一道。"
        }
      ]
    },
    "categories": [
      [
        "腳踏後移與傳動",
        9
      ],
      [
        "拉桿與把手",
        5
      ],
      [
        "碳纖維部品",
        3
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 7
    }
  },
  {
    "slug": "front3d",
    "name": "FRONT 3D",
    "country": "西班牙",
    "origin": "西班牙",
    "lede": "設計工程背景出身的西班牙廠，以工業 3D 列印製作前擾流、側翼與車身外觀件，型錄按車系逐款對應。",
    "wallTagline": "3D 列印風鏡、擾流件",
    "slogan": "先問要用在哪，<br>再問好不好看。",
    "band": {
      "src": "assets/brands-hero/front3d.jpg",
      "alt": "FRONT 3D 部品裝車情境",
      "focus": "center 42%"
    },
    "bandLogo": "assets/brands-dark/front3d.png",
    "logoScale": 1,
    "facts": [
      [
        "Made in",
        "西班牙",
        ""
      ],
      [
        "Design",
        "工程設計出身",
        "自創辦人本身的車輛開始開發"
      ],
      [
        "Products",
        "擾流翼 · 側翼 · 車身件",
        "以工業 3D 列印製作"
      ]
    ],
    "about": {
      "lead": "<strong>第一批產品，是做給自己的車。</strong>FRONT 的開場白就是這句坦白話。創辦團隊出身工程設計，自草圖到成品一貫執行——先有使用情境，才有外觀，順序沒有顛倒。<br><br>型錄的重心很窄也很深：前擾流、側翼、大燈罩與尾部件，多數對應現行的 naked 車系。",
      "pull": "很窄的一條產品線，但每一件都做得夠深。",
      "tail": "<strong>改的是車頭那一段的線條。</strong>擾流翼與側翼裝上之後，整台車的視覺重量會往前移，比例隨之改變。這是外觀件，值得您先看清楚實裝的樣子——他們的 IG 大量轉貼車主自己拍的車，比棚拍更接近真實。<br><br><strong>工業 3D 列印的長處是複雜曲面與小批量。</strong>因此走的是車型專用而非廣度。歡迎提供您的車型與出廠年份，由我們替您確認對應款式。"
    },
    "aside": {
      "src": "assets/brands-prod/front3d/fitted-naked.jpg",
      "alt": "配掛 FRONT 3D 部品的街車實拍",
      "title": "車型專用外觀件",
      "note": "前擾流與側翼裝上後，車頭的線條整個往前收。"
    },
    "highlights": {
      "title": "為什麼是 FRONT 3D",
      "lead": "改的是車頭那一段的線條。擾流翼與側翼裝上去之後，整台車的視覺重量會往前移。",
      "cards": [
        {
          "t": "先做給自己的車",
          "d": "他們的開場白很坦白：產品最早是為創辦團隊自己的車輛開發的。<strong>自草圖到成品一貫執行</strong>,不是先求外觀再找用途。"
        },
        {
          "t": "主力是擾流翼與側翼",
          "d": "型錄的重心是車頭的空力外觀件：<strong>前擾流、側翼、大燈罩與尾部件</strong>,多數對應現行的 naked 車系。這是一條很窄但很深的產品線。"
        },
        {
          "t": "工業 3D 列印的小批量",
          "d": "外觀件以工業級 3D 列印製作。這道製程的長處是<strong>小批量與複雜曲面</strong>,適合車型專用件；代價是做不了大量鋪貨，所以型錄走的是精準對應而非廣度。"
        },
        {
          "t": "車主的車就是型錄",
          "d": "他們的 IG(@front_3d)約 8,450 名追蹤者、200 則貼文，<strong>內容大量轉貼車主自己拍的車</strong>。要看實裝效果不必靠棚拍，看車主怎麼拍就知道裝上去是什麼樣子。"
        }
      ]
    },
    "craft": {
      "title": "車頭與車尾，兩段線條",
      "rows": [
        {
          "step": "01 — Winglets",
          "t": "側翼與前擾流",
          "img": "assets/brands-prod/front3d/winglets.jpg",
          "alt": "配掛 FRONT 3D 側翼與前擾流的 Yamaha MT-09 車頭",
          "d": "側翼是這個牌子最好認的品項。<strong>裝上去之後車頭的視覺重量整個往前壓</strong>,原本偏高瘦的 naked 車頭會變得有寬度；造型之外，曲面走向也決定它貼不貼合原廠外殼。"
        },
        {
          "step": "02 — Tail",
          "t": "尾部與短牌架",
          "img": "assets/brands-prod/front3d/tail.jpg",
          "alt": "配掛 FRONT 3D 尾部件與短牌架的街車尾段",
          "d": "車尾走的是相反的方向：把原廠的長牌架與尾殼收乾淨，讓後輪露出來。<strong>前面加寬、後面收窄</strong>,是這條產品線在整台車上的完整邏輯。"
        }
      ]
    },
    "video": {
      "file": "assets/brand-video/front3d-reel.mp4",
      "portrait": true,
      "poster": "assets/brands-prod/front3d/reel-poster.jpg",
      "source": "https://www.instagram.com/reel/DZUUD-jsx2i/",
      "sourceLabel": "看 IG 原貼文",
      "title": "FRONT 3D 擾流與側翼車主實裝",
      "caption": "車主實裝 · IG @mt_sblack"
    },
    "categories": [
      [
        "外觀與後視鏡",
        1
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 8
    }
  },
  {
    "slug": "gb-racing",
    "name": "GB RACING",
    "country": "英國",
    "origin": "英國 · 自 2007",
    "lede": "製作 FIM 核准二次引擎護蓋的英國廠，可直接鎖固於原廠外殼，MotoGP、WorldSBK 與 BSB 皆有使用。",
    "wallTagline": "引擎護蓋、防摔滑塊",
    "slogan": "最好的護蓋，<br>是你一輩子用不到的那一個。",
    "band": {
      "src": "assets/brands-hero/gb-racing.jpg",
      "alt": "GBRacing 防護件的旅行車使用情境",
      "focus": "center 62%"
    },
    "bandLogo": "assets/brands-dark/gb-racing.png",
    "logoScale": 1,
    "facts": [
      [
        "Founded",
        "2007 年",
        ""
      ],
      [
        "Made in",
        "英國",
        "自有射出成型廠，2021 年增設第二座"
      ],
      [
        "Approval",
        "FIM 核准 · 自 2009",
        "全球唯一取得 FIM 認證的防護產品線"
      ],
      [
        "Racing",
        "MotoGP · WorldSBK · BSB",
        ""
      ]
    ],
    "about": {
      "lead": "<strong>有一種零件，您會希望永遠用不到它。</strong>GB Racing 2007 年成立於英國，核心產品是二次引擎護蓋——鎖在原廠外殼外側的那一層防護；其設計能力源自母公司 Lewis Banks Ltd 累積近百年的工程資歷。<br><br>它在賽場上屬於必要裝備，原因不是好看，而是賽會規章認的就是這一類通過認證的護蓋。",
      "pull": "它的價值，在最不希望用到的那一天顯現。",
      "tail": "<strong>兩項獲證專利，寫在很具體的地方。</strong>2016 年的材料配方改良專利與 2017 年的反向磨耗指示專利，讓「磨到什麼程度該換」可以判讀，而不是靠猜。量產前先以 3D 列印逐件測試，2022 年一年開出 29 套新射出模具。<br><br><strong>引擎外殼的形狀會隨年式改版。</strong>同款車不同年份未必通用，歡迎提供您的車型與出廠年份，由我們替您核對覆蓋範圍。"
    },
    "aside": {
      "src": "assets/brands-prod/gb-racing/engine-cover-fitted.jpg",
      "alt": "GBRacing 二次引擎護蓋裝於賽車引擎外側的特寫",
      "title": "二次引擎護蓋",
      "note": "FIM 核准，鎖在原廠外殼外側，不必拆原廠殼。"
    },
    "highlights": {
      "title": "為什麼是 GBRacing",
      "lead": "防護件的價值只在倒車那一秒顯現，平常看不出差別。差別藏在材料配方、模具與認證裡。",
      "cards": [
        {
          "t": "承接近百年的工程資歷",
          "d": "設計與開發能力源自母公司 <strong>Lewis Banks Ltd</strong> 累積的工程經驗；二次引擎護蓋以 CAD 設計，並在自有射出成型廠生產。"
        },
        {
          "t": "全球唯一的 FIM 認證產品線",
          "d": "2009 年取得 FIM 認證，至今是<strong>全球唯一取得 FIM 產品認證的防護件製造商</strong>。2020 年再獲 FIM Quality Product 資格，2024 年續期。"
        },
        {
          "t": "兩項獲證專利",
          "d": "2016 年取得材料配方改良專利（#GB2479405）,2017 年取得反向磨耗指示專利（#GB2532535）。護蓋磨到什麼程度該換，由此可判讀而非靠猜。"
        },
        {
          "t": "以 3D 列印先行驗證",
          "d": "流程是以 3D 軟體與車隊共享模型，量產前<strong>先以 3D 列印逐件測試</strong>。2022 年一年內開出 29 套新射出模具。"
        }
      ]
    },
    "stats": {
      "items": [
        {
          "n": "29",
          "l": "套新射出模具",
          "s": "2022 年單年紀錄"
        },
        {
          "n": "2",
          "l": "項獲證專利",
          "s": "材料配方 · 反向磨耗指示"
        },
        {
          "n": "22",
          "l": "場歐洲賽事",
          "s": "2022 年參與場次"
        },
        {
          "n": "6",
          "l": "座 WorldSBK 冠軍",
          "s": "Jonathan Rea 與 Kawasaki 廠隊"
        }
      ]
    },
    "timeline": {
      "title": "從一片護蓋到賽會規章裡的必需品",
      "items": [
        {
          "y": "2007",
          "key": true,
          "t": "公司成立",
          "d": "以二次引擎護蓋為核心產品起步。"
        },
        {
          "y": "2009",
          "key": true,
          "t": "取得 FIM 認證",
          "d": "二次曲軸箱護蓋通過認證；同年 Leon Camier 與 Airwaves Yamaha 以其防護件奪下英國超級摩托車錦標賽冠軍。"
        },
        {
          "y": "2012",
          "t": "Moto2 世界冠軍",
          "d": "Marc Márquez 與 Caixa Repsol 車隊合作，以其產品奪下 Moto2 年度冠軍。"
        },
        {
          "y": "2013",
          "t": "導入 CNC · WorldSBK 奪冠",
          "d": "購入高階 CNC 設備，模具開發轉為自製；同年 Tom Sykes 與 Kawasaki 廠隊拿下 WorldSBK 冠軍。"
        },
        {
          "y": "2014",
          "t": "世界耐久賽冠軍",
          "d": "Yamaha GMT94 奪下 FIM 世界耐久錦標賽冠軍。"
        },
        {
          "y": "2015",
          "t": "Rea 六冠的第一冠",
          "d": "Jonathan Rea 與 Kawasaki 廠隊拿下 WorldSBK 冠軍，為其六連霸的起點。"
        },
        {
          "y": "2016",
          "key": true,
          "t": "材料配方專利",
          "d": "改良材料配方取得專利 #GB2479405。"
        },
        {
          "y": "2017",
          "t": "反向磨耗指示專利",
          "d": "取得專利 #GB2532535,護蓋的磨耗程度可直接判讀。"
        },
        {
          "y": "2020",
          "t": "FIM Quality Product",
          "d": "取得 2021–2023 年度的 FIM 品質產品資格。"
        },
        {
          "y": "2021",
          "key": true,
          "t": "第二座英國廠",
          "d": "增設廠房並導入五軸 CNC 設備，產能與開發速度同步提升。"
        },
        {
          "y": "2022",
          "t": "單年 29 套新模具",
          "d": "同年參與 22 場歐洲賽事，並再添四座世界冠軍。"
        },
        {
          "y": "2023",
          "t": "拉桿護弓與 ZERO-e",
          "d": "投入拉桿護弓開發，避免碰撞時誤觸拉桿；同年啟動 FIM 精神的 ZERO-e 永續支援車計畫。"
        },
        {
          "y": "2024",
          "t": "認證續期與賽事支援",
          "d": "FIM 品質產品計畫續期，並支援首屆 WorldWCR 與多項青年錦標賽。"
        }
      ]
    },
    "craft": {
      "title": "兩項寫在專利裡的差別",
      "rows": [
        {
          "step": "01 — Material",
          "t": "材料配方",
          "img": "assets/brands-prod/gb-racing/frame-slider.jpg",
          "alt": "GBRacing 車架防摔球裝於整流罩上的特寫",
          "d": "2016 年取得<strong>材料配方改良專利</strong>。防護件要在滑行時磨耗而不碎裂，靠的是配方而非厚度；搭配自有射出成型廠，配方與模具在同一個屋簷下調。"
        },
        {
          "step": "02 — Wear Indicator",
          "t": "反向磨耗指示",
          "img": "assets/brands-prod/gb-racing/lever-guard.jpg",
          "alt": "GBRacing 煞車與離合器拉桿護弓",
          "d": "2017 年取得<strong>反向磨耗指示專利</strong>。護蓋磨到什麼程度該換，可以直接看出來，不必憑感覺。這也是賽會檢錄時能快速判定的依據。"
        }
      ]
    },
    "video": {
      "vimeo": "749526386",
      "vimeoHash": "a596294d43",
      "poster": "assets/brands-prod/gb-racing/film-poster.jpg",
      "title": "We are GBRacing",
      "caption": "官方影片"
    },
    "categories": [
      [
        "引擎與冷卻",
        7
      ],
      [
        "車身防護與防摔",
        4
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 9
    }
  },
  {
    "slug": "gilles",
    "name": "GILLES TOOLING",
    "country": "盧森堡",
    "origin": "盧森堡 · Grevenmacher · 自 2000",
    "lede": "自賽車用可調腳踏起家的盧森堡廠，產品涵蓋腳踏後移、把手與拉桿，並取得 TÜV／KBA 認證。",
    "wallTagline": "腳踏後移、把手、拉桿",
    "slogan": "騎姿對了，<br>路就會變短。",
    "band": {
      "src": "assets/brands-hero/gilles.jpg",
      "alt": "裝上 Gilles Tooling 部品的 Yamaha R9",
      "focus": "center 62%"
    },
    "bandLogo": "assets/brands-dark/gilles.svg",
    "logoScale": 0.95,
    "facts": [
      [
        "Founded",
        "2000 年",
        "首組可調腳踏為自家賽車而製"
      ],
      [
        "Made in",
        "盧森堡 Grevenmacher",
        ""
      ],
      [
        "Material",
        "CNC 削切鋁件",
        "腳踏、把手、拉桿共用同一套加工"
      ],
      [
        "Approval",
        "TÜV · KBA · ISO 9001",
        ""
      ]
    ],
    "about": {
      "lead": "<strong>第一組可調腳踏，是為自家賽車做的。</strong>那組產品後來成為量產品 AS31GT,品牌才於 2000 年在盧森堡 Grevenmacher 正式成立——先有需求，才有產品。<br><br>GILLES 部品曾直接裝在現行 Yamaha 車款上；品牌同時是 Monster Energy Yamaha MotoGP 車隊的官方贊助商。",
      "pull": "先有需求，才有產品，順序不曾顛倒。",
      "tail": "<strong>腳踏、把手與拉桿，動到的是人車三角。</strong>騎姿一經調整，控制行程與重心隨之變動；六條產品線共用同一套 CNC 鋁件加工，為的就是讓這幾個接觸點彼此對得起來。"
    },
    "aside": {
      "src": "assets/brands-prod/gilles/panigale.jpg",
      "alt": "Gilles Tooling 對應 Ducati Panigale V4S 的產品頁形象照",
      "title": "車型對應開發",
      "note": "按車型與年式往下對，不是通用件。"
    },
    "highlights": {
      "title": "為什麼是 Gilles Tooling",
      "lead": "從自家賽車的一組腳踏開始，做到原廠車型直接配掛。中間的差別是認證與精度。",
      "cards": [
        {
          "t": "起點是自家賽車的需求",
          "d": "首組可調腳踏是為自家賽車製作，後來成為量產品 AS31GT,品牌才於 2000 年正式成立。<strong>先有需求，才有產品</strong>。"
        },
        {
          "t": "進得了原廠環境",
          "d": "GILLES 部品曾<strong>直接裝在現行 Yamaha 車款上</strong>,並以此呈現其在原廠（OEM）環境中的技術與精度配合。"
        },
        {
          "t": "MotoGP 官方贊助",
          "d": "Gilles Tooling 是 <strong>Monster Energy Yamaha MotoGP 車隊的官方贊助商</strong>。賽事層級的使用與市售件出自同一套加工。"
        },
        {
          "t": "掛得上驗車的認證",
          "d": "產品取得 <strong>TÜV、KBA 與 ISO 9001</strong> 認證。對在意驗車與保險理賠的車主，這是能不能合法上路的實際差別，不是行銷標籤。"
        }
      ]
    },
    "craft": {
      "title": "六條線與一台機台",
      "rows": [
        {
          "step": "01 — Range",
          "t": "六條產品線，同一台車",
          "img": "assets/pcm-social/ig-216.jpg",
          "focus": "center 50%",
          "alt": "Gilles Tooling CNC 腳踏組特寫，可見多段調節刻度與碳纖踏板",
          "d": "型錄分成六條線：把手、煞車與離合器拉桿、鏈條調整片、腳踏後移、防護件與外觀件。<strong>六條線動到的是同一組接觸點</strong>——手掌、腳掌與坐姿的相對位置。腳踏上那排調節孔就是這件事的縮影：位置能移，是因為底座本來就照這台車做。"
        },
        {
          "step": "02 — Machining",
          "t": "整塊鋁削出來的底座",
          "img": "assets/brands-prod/gilles/catalogue.jpg",
          "alt": "Gilles Tooling 產線上的 CNC 削切作業",
          "d": "六條線都建立在車型專用底座上，而底座是整塊鋁削出來的。幕後影片由總經理親自帶看機台與工法，<strong>底座對得上，位置微調才有意義</strong>;否則只是把誤差往後推。"
        }
      ]
    },
    "video": {
      "file": "assets/brand-video/gilles-hero.mp4",
      "poster": "assets/brands-prod/gilles/film-poster.jpg",
      "source": "https://www.gillestooling.com/en/",
      "sourceLabel": "看官網",
      "title": "Gilles Tooling 官網形象影片",
      "caption": "官網首頁影片"
    },
    "categories": [
      [
        "腳踏後移與傳動",
        9
      ],
      [
        "拉桿與把手",
        5
      ],
      [
        "車身防護與防摔",
        4
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 10
    }
  },
  {
    "slug": "k-speed",
    "name": "K-SPEED",
    "country": "泰國",
    "origin": "泰國 · Bangkok",
    "lede": "為 Honda、Royal Enfield、Triumph 等復古車系製作外觀套件、燈具、把手與後視鏡的泰國廠。",
    "wallTagline": "復古改裝件、全黑美學套件",
    "slogan": "先確定是哪台車，<br>再談要改成什麼樣子。",
    "band": {
      "src": "assets/brands-hero/k-speed.jpg",
      "alt": "K-SPEED 改裝的 Honda Rebel",
      "focus": "center 52%"
    },
    "bandLogo": "assets/brands-dark/k-speed.png",
    "logoScale": 1,
    "facts": [
      [
        "Founded",
        "2002 年",
        "自曼谷的機車零件零售店起家"
      ],
      [
        "Made in",
        "泰國 Bangkok",
        ""
      ],
      [
        "Models",
        "Honda · Royal Enfield · Triumph · BMW 等",
        "依車系開發，不做通用件"
      ],
      [
        "Service",
        "Full Custom",
        "除單品外亦承接整車客製"
      ]
    ],
    "about": {
      "lead": "<strong>曼谷的改裝車工房，零件是自己做的。</strong>創辦人 Mr. Eak 十二歲開始騎車，從 Honda Monkey、Dax 那些小車玩起來；2002 年開了第一間零件店，現在做到整車客製與自家零件系列 Diabolus。<br><br>他們的做法是<strong>先做成一台車，再把零件拆出來賣</strong>——新品先裝在自家的改裝車上跑過，確定裝得上、看得順，才進型錄。",
      "pull": "先做成一台車，再拆出來賣。",
      "tail": "<strong>Honda Rebel、CT125、Super Cub、Monkey、Royal Enfield 650——</strong>這些是他們吃得最深的車系。東南亞的小排量市場養出他們的強項：整流罩、輪蓋、把手、燈具都自己開模，一件只對一個車系，不做通用款。<br><br><strong>Bobber、Scrambler、Café Racer 三條路線。</strong>把一台 CT125 交給他們，他們會先問你想走哪一條，再從那條線的套件開始配。不是隨便湊，是有方向地改。"
    },
    "aside": {
      "src": "assets/brands-prod/k-speed/bmw-cafe.jpg",
      "alt": "K-SPEED 打造的 BMW 雙缸咖啡騎士",
      "title": "BMW 全車系客製",
      "note": "曼谷工房打造的 BMW 雙缸咖啡騎士。"
    },
    "highlights": {
      "title": "為什麼是 K-SPEED",
      "lead": "復古改裝的難處不在造型，而在同一車系不同年份的規格差異。K-SPEED 以車系為單位開發，設計與成型都在自己手上。",
      "cards": [
        {
          "t": "自零售店起步的二十餘年",
          "d": "2002 年於曼谷從一間機車零件零售店開始，如今自行設計整個系列，並供應多個國際車系。"
        },
        {
          "t": "以車系為單位開發",
          "d": "他們不做通用款。Honda、Royal Enfield、Triumph、BMW、Kawasaki 等各自有一整套專屬品項，一件只對一個車系，彼此不互換。"
        },
        {
          "t": "設計自鉛筆與紙開始",
          "d": "設計哲學是<strong>乾淨線條、低彩度</strong>,重色只保留給限量或特別訂製的案子；創辦人 Mr. Eak 至今仍以木鉛筆與紙起稿。"
        },
        {
          "t": "單品之外承接整車客製",
          "d": "Full Custom 是獨立的服務項目，至今已產出數千件零件與數百件整車客製設計。"
        }
      ]
    },
    "stats": {
      "items": [
        {
          "n": "數千",
          "l": "件零件產出",
          "s": "開業至今累積"
        },
        {
          "n": "數百",
          "l": "件整車客製設計",
          "s": "Full Custom 案例累積"
        },
        {
          "n": "9",
          "l": "個對應車系",
          "s": "Honda · Royal Enfield · Triumph · BMW · Kawasaki 等"
        },
        {
          "n": "12",
          "l": "歲開始騎車",
          "s": "創辦人 Mr. Eak"
        }
      ]
    },
    "craft": {
      "title": "從一支鉛筆到一台完整的車",
      "rows": [
        {
          "step": "01 — Drafting",
          "t": "鉛筆與紙的起稿",
          "img": "assets/brands-prod/k-speed/craft-sketch.jpg",
          "focus": "center 45%",
          "alt": "K-SPEED 創辦人以鉛筆在紙上繪製車身草圖",
          "d": "儘管做法持續更新，創辦人 Mr. Eak 起稿仍使用<strong>木鉛筆與紙</strong>。設計哲學也很清楚：乾淨線條、低彩度，重色只保留給限量或特別訂製的案子。"
        },
        {
          "step": "02 — Workshop",
          "t": "工房的手工成型",
          "img": "assets/brands-prod/k-speed/craft-metal.jpg",
          "alt": "K-SPEED 工房內手工打磨成型的金屬車身件",
          "d": "草圖之後在自有工房成型。工房與設計理念是品牌的兩個支柱：外觀件不是從型錄湊出來的，而是對著那一台車做出來的。"
        }
      ]
    },
    "categories": [
      [
        "外觀與後視鏡",
        1
      ],
      [
        "拉桿與把手",
        5
      ],
      [
        "燈具與電子",
        11
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 11
    }
  },
  {
    "slug": "kineo",
    "name": "KINEO",
    "country": "義大利",
    "origin": "義大利",
    "lede": "義大利的鋼絲框專門廠。經典的鋼絲輪外觀，配上現代車該有的煞車、ABS 與無內胎輪胎。",
    "wallTagline": "手工鍛造鋼絲輪框",
    "slogan": "輪組沒有「應該可以」,<br>只有對或不對。",
    "band": {
      "src": "assets/brands-hero/kineo.jpg",
      "alt": "Kineo 無內胎鋼絲框｜金色與綠色輪轂各一顆",
      "focus": "center 50%"
    },
    "craft": {
      "title": "經典的樣子，現在的規格",
      "rows": [
        {
          "step": "01 — Rim",
          "t": "輪框本體自己氣密",
          "img": "assets/brands-prod/kineo/rim-nipples.jpg",
          "alt": "Kineo 鋼絲框的框體與輻條頭",
          "d": "<strong>無內胎輪胎直接裝上去</strong> —— 省掉內胎，也省掉在輻條孔上補封條那套權宜作法。鋼絲輪的外觀留著，氣密由輪框本體負責。"
        },
        {
          "step": "02 — Set",
          "t": "輪框、輻條、輪轂當一組算",
          "img": "assets/brands-prod/kineo/hub-spokes.jpg",
          "alt": "Kineo 輪轂與輻條的收束結構",
          "d": "每一組輪組依<strong>車廠、確切車型、年式與輪徑</strong>逐項設定，三件當成一組設計。拿到就是一套能直接裝上的完整規格，不是自己配三樣東西。"
        },
        {
          "step": "03 — Fitment",
          "t": "碟盤與 ABS 留著，齒盤隨組附",
          "img": "assets/brands-prod/kineo/fitted-ohlins.jpg",
          "alt": "裝上 Kineo 輪組的車輛前輪，原廠碟盤與卡鉗沿用",
          "d": "在支援的車型上是<strong>原廠型式直接安裝</strong>:原廠碟盤與 ABS 相關部件多數可沿用，免加工。齒盤則<strong>由 Kineo 隨輪組供應</strong>,鏈條 520／525 與齒數可依需求指定。"
        },
        {
          "step": "04 — Range",
          "t": "對應範圍橫跨多個車系",
          "img": "assets/brands-prod/kineo/rim-workshop.jpg",
          "alt": "Kineo 鋼絲框於工作台上",
          "d": "實裝案例包含 <strong>Honda Africa Twin CRF1100</strong>、<strong>Triumph Bobber／Thruxton／Speedmaster</strong>,以及 BMW、Ducati、Yamaha 等車系。"
        }
      ]
    },
    "bandLogo": "assets/brands-dark/kineo.png",
    "logoScale": 0.88,
    "facts": [
      [
        "Made in",
        "義大利",
        ""
      ],
      [
        "Material",
        "鋼絲框 · 整組輪組",
        "整組供應，輪框、輻條與輪轂一起算"
      ],
      [
        "Fitment",
        "車型專用規格",
        "型錄按車型對應輪組規格"
      ]
    ],
    "about": {
      "lead": "<strong>有一種風格，是從鋼絲框開始延伸。</strong>Bobber、Scrambler、ADV —— 鋼絲框給的氣質，是鍛框達不到的效果。<br><br><strong>Kineo 把它接上了現代規格。</strong>輪框本體氣密，無內胎輪胎直接裝上；原廠的碟盤、齒盤與 ABS 相關部件多數可以留著繼續用。外觀是經典的，規格是現在的。",
      "pull": "輪組不是一個尺寸，是一整組規格。",
      "tail": "<strong>Kineo 出的是一整組輪組。</strong>輪框、輻條與輪轂當成一組設計，依車廠、確切車型、年式與輪徑逐項設定 —— 這幾件本來就得一起算。在支援的車型上是原廠型式直接安裝，免加工。<br><br><strong>輪組是全車最該問清楚的部件。</strong>歡迎提供您的車型、出廠年份與 ABS 設定，由我們一次替您核對到底。"
    },
    "aside": {
      "src": "assets/brands-prod/kineo/disc-hub.jpg",
      "alt": "Kineo 輪組隨附的專用齒盤",
      "title": "KINEO 專用齒盤",
      "note": "隨輪組出貨即附。鏈條 520／525 與齒數可依需求指定。"
    },
    "highlights": {
      "title": "為什麼是 Kineo",
      "lead": "尺寸只是開始，真正要對上的是一整組規格。",
      "cards": [
        {
          "t": "鋼絲框，直上無內胎",
          "d": "輪框本體<strong>自行維持氣密</strong>,無內胎輪胎直接裝上去 —— 省掉內胎，也省掉在輻條孔上補封條那套權宜作法。"
        },
        {
          "t": "一次配到齊",
          "d": "每一組輪組依<strong>車廠、確切車型、年式與輪徑</strong>逐項設定。輪框、輻條與輪轂當成一組設計，拿到就是一套能直接裝上的完整規格。"
        },
        {
          "t": "碟盤與 ABS 留著，齒盤隨組附",
          "d": "在支援的車型上是原廠型式直接安裝：<strong>原廠碟盤與 ABS 相關部件多數可沿用</strong>,免加工。齒盤不在沿用之列 —— <strong>Kineo 隨輪組供應專用齒盤</strong>,鏈條 520／525 與齒數可依需求指定。"
        },
        {
          "t": "對應範圍橫跨多個車系",
          "d": "實裝案例包含 Honda Africa Twin CRF1100、Triumph Bobber／Thruxton／Speedmaster,以及 BMW、Ducati、Yamaha 等車系。"
        }
      ]
    },
    "categories": [
      [
        "懸吊與車架 · 輪圈",
        0
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 12
    }
  },
  {
    "slug": "lightech",
    "name": "LIGHTECH",
    "country": "義大利",
    "origin": "義大利 · 特雷維索 · 自 1997",
    "lede": "為日系與歐系車主製作腳踏後移、油箱快拆蓋與車身防護的義大利 CNC 廠，鋁件之外亦生產鈦合金件。",
    "wallTagline": "CNC 螺絲、腳踏、油杯",
    "slogan": "選對年式，<br>鎖上去就是原廠孔位。",
    "band": {
      "src": "assets/brands-hero/lightech.jpg",
      "alt": "LighTech 塗裝的 Moto2 廠車與車手",
      "focus": "center 46%",
      "align": "start"
    },
    "bandLogo": "assets/brands-dark/lightech.png",
    "logoScale": 1,
    "facts": [
      [
        "Founded",
        "1997 年",
        "創辦人 Fabrizio Furlan,車手出身"
      ],
      [
        "Made in",
        "義大利 威尼托 特雷維索省 Santa Lucia di Piave",
        "廠區 2,500㎡,其中 1,400㎡ 是 CNC 產線"
      ],
      [
        "Material",
        "Ergal 航太鋁 · 鈦合金",
        "削切與陽極上色皆為自有製程"
      ],
      [
        "Racing",
        "WSBK · Moto2 技術支援（2026 SYNC SPEEDRS）",
        "長年提供賽事車隊技術支援"
      ]
    ],
    "about": {
      "lead": "<strong>一位車手，把家族的製造專業帶進了賽場。</strong>1997 年 Fabrizio Furlan 於特雷維索省的 Santa Lucia di Piave 創立 LighTech——順序是先有製造能力，才有這個品牌。<br><br>2,500 平方米的廠區，其中 1,400 平方米給了 CNC 產線。三十年的技術累積，合作層級涵蓋世界超級摩托車錦標賽、MotoGP 與 Moto2。",
      "pull": "廠區的坪數配置，說明了資源放在哪裡。",
      "tail": "<strong>7,000 件 Ergal 產品，400 件鈦合金產品。</strong>自削切到陽極上色皆由自有產線完成，ISO 9001 管製程一致性、ISO 50001 管產線能耗——型錄的規模與色澤的穩定，是同一件事的兩面。<br><br><strong>型錄按品牌、車型、年式逐層對應。</strong>孔位確認後才出廠。歡迎提供您的車型與出廠年份，選對年式就能直接安裝，不必自己量孔距。"
    },
    "aside": {
      "src": "assets/brands-prod/lightech/tankcap.jpg",
      "alt": "LighTech 快拆油箱蓋",
      "title": "快拆油箱蓋",
      "note": "整塊切削、PUSH &amp; PULL,義大利製。"
    },
    "highlights": {
      "title": "為什麼是 LighTech",
      "lead": "車手創立、家族做精密製造。廠區的坪數配置本身就說明了這家把資源放在哪裡。",
      "cards": [
        {
          "t": "車手把家族製造帶進賽場",
          "d": "1997 年 Fabrizio Furlan 創立 LighTech,<strong>目的是把家族的製造專業帶進賽車領域</strong>。順序是先有製造能力，才有這個品牌。"
        },
        {
          "t": "廠區八成給了產線",
          "d": "廠區 2,500 平方米，其中 <strong>1,400 平方米是 CNC 產線</strong>、600 平方米倉儲、50 平方米研發部門，研發使用 CAD 與 CAM。"
        },
        {
          "t": "三十年的技術累積",
          "d": "<strong>三十年的專業累積</strong>,合作層級涵蓋世界超級摩托車錦標賽、MotoGP、125 GP 與 Moto2。產品的驗證場域就是這些車隊的實際使用。"
        },
        {
          "t": "兩項國際標準認證",
          "d": "同時取得 <strong>ISO 9001</strong> 品質管理與 <strong>ISO 50001</strong> 能源管理認證。前者管製程一致性，後者管產線能耗。"
        }
      ]
    },
    "stats": {
      "items": [
        {
          "n": "7,000",
          "l": "件 Ergal 產品",
          "s": "型錄規模，共七種顏色",
          "plus": true
        },
        {
          "n": "400",
          "l": "件鈦合金產品",
          "s": "另有其他材質配件",
          "plus": true
        },
        {
          "n": "1,000",
          "l": "家義大利授權經銷",
          "s": "經銷網絡持續擴張",
          "plus": true
        },
        {
          "n": "50",
          "l": "國海外通路",
          "s": "義大利以外的市場"
        }
      ]
    },
    "craft": {
      "title": "七千件與七種顏色",
      "rows": [
        {
          "step": "01 — Catalogue",
          "t": "陽極七色的型錄規模",
          "img": "assets/brands-prod/lightech/tankcap-gold.jpg",
          "alt": "LighTech 金色陽極快拆油箱蓋裝於車輛油箱",
          "d": "型錄收有<strong>逾 7,000 件 Ergal 產品、共七種顏色</strong>,另有逾 400 件鈦合金產品。削切到陽極上色都在自家 1,400 平方米的產線完成，批次之間的色澤才對得起來。"
        },
        {
          "step": "02 — Fitment",
          "t": "按年式逐層對孔位",
          "img": "assets/brands-prod/lightech/rearset.jpg",
          "alt": "配掛 LighTech 腳踏後移組的 Ducati",
          "d": "型錄按品牌、車型、年式逐層往下對，孔位確認後才出廠。<strong>選對年式就是直上</strong>,不必自己拿卡尺量孔距，也不用墊片湊。"
        }
      ]
    },
    "video": {
      "file": "assets/brand-video/lightech-eicma.mp4",
      "portrait": true,
      "poster": "assets/brands-prod/lightech/eicma-poster.jpg",
      "source": "https://www.facebook.com/reel/1567951094389988",
      "sourceLabel": "看官方 FB 原貼文",
      "title": "Lightech at EICMA 2025",
      "caption": "官方 FB · EICMA 2025 展位"
    },
    "categories": [
      [
        "腳踏後移與傳動",
        9
      ],
      [
        "車身防護與防摔",
        4
      ],
      [
        "外觀與後視鏡",
        1
      ],
      [
        "引擎與冷卻",
        7
      ],
      [
        "碳纖維部品",
        3
      ],
      [
        "精品螺絲與螺帽",
        6
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 13
    }
  },
  {
    "slug": "materya",
    "name": "MATERYA",
    "country": "義大利",
    "origin": "義大利 · 米蘭",
    "lede": "由 Mirco Sapio 於米蘭創立的機車配件廠，產品涵蓋風鏡、儀表蓋與賽道牌照板，射出成型、碳纖維與 3D 列印並用。",
    "wallTagline": "風鏡、車身飾板",
    "slogan": "高度差兩公分，<br>一整趟都不一樣。",
    "band": {
      "src": "assets/brands-hero/materya.jpg",
      "alt": "MATERYA 碳纖維風鏡的裝車特寫",
      "focus": "center 46%"
    },
    "bandLogo": "assets/brands-dark/materya.png",
    "logoScale": 1.08,
    "facts": [
      [
        "Made in",
        "義大利 米蘭",
        "Piazza Villapizzone"
      ],
      [
        "Material",
        "射出成型 · 碳纖維 · 3D 列印",
        "三種製程並行使用"
      ],
      [
        "Products",
        "風鏡 · 儀表蓋 · 賽道牌照板",
        "型錄的三條主線"
      ]
    ],
    "about": {
      "lead": "<strong>從構思、繪圖、成型到成品，全程同一個人跟進。</strong>這是 MATERYA 的自述。創辦人 Mirco Sapio 長年與多間機車設計工作室密切合作，之後才把累積的能力收攏成自己的產品概念。<br><br>品牌的定位是回應具體需求，不是鋪一條廣泛的產品線。",
      "pull": "這個規模做不了大量，但細節不會在交接時被稀釋。",
      "tail": "<strong>射出成型、碳纖維與工業級 3D 列印，三種製程並行。</strong>風鏡、儀表蓋與賽道牌照板的需求本就不同，以單一製程涵蓋，必然犧牲其中一項。<br><br><strong>風鏡是少數同時影響外觀與體感的零件。</strong>高度差兩公分，長途的體感就不同：過低則風壓直接作用於胸口，過高則可能在安全帽的高度形成亂流。型錄把車型與年式分開編排。歡迎提供您的車型年份與常行駛的路段，由我們替您挑高度。"
    },
    "aside": {
      "src": "assets/brands-prod/materya/flyscreen.jpg",
      "alt": "MATERYA 車型專用風鏡",
      "title": "風鏡 Flyscreen",
      "note": "車型專用，型錄按車款與年式分開。"
    },
    "highlights": {
      "title": "為什麼是 MATERYA",
      "lead": "一個人從構思、繪圖、成型到成品全程負責。這個規模做不了大量，但細節不會在交接時被稀釋。",
      "cards": [
        {
          "t": "設計工作室出身",
          "d": "創辦人 Mirco Sapio 長年與多間<strong>機車設計工作室密切合作</strong>,之後才決定把累積的能力收攏成自己的產品概念。"
        },
        {
          "t": "端到端一個人完成",
          "d": "從<strong>構思、繪圖、成型到成品全程親自跟進</strong>。品牌的定位是回應具體需求，而非鋪一條廣泛的產品線。"
        },
        {
          "t": "三種製程並行",
          "d": "射出成型、碳纖維與工業級 3D 列印同時使用。風鏡、儀表蓋與賽道牌照板的需求本就不同，以單一製程涵蓋必然犧牲其中一項。"
        },
        {
          "t": "按車型與年式分開",
          "d": "型錄把車型「與年式」分開編排，MT-09 MY21 與 MY24 不是同一件。風鏡的固定點與導流角度會隨年式改版而變。"
        }
      ]
    },
    "craft": {
      "title": "從一個人到一件成品",
      "rows": [
        {
          "step": "01 — One Hand",
          "t": "構思到成型都同一個人",
          "img": "assets/brands-prod/materya/founder.jpg",
          "focus": "center 30%",
          "alt": "MATERYA 創辦人 Mirco Sapio",
          "d": "<strong>構思、繪圖、成型、成品，全程親自跟進</strong>。這種規模做不了大量鋪貨，但也沒有中間的交接損耗。"
        },
        {
          "step": "02 — Fitment",
          "t": "車型與年式分開對",
          "img": "assets/brands-prod/materya/fitted-ducati.jpg",
          "focus": "center 65%",
          "alt": "MATERYA 碳纖維風鏡裝於 Ducati 車頭",
          "d": "風鏡是少數同時影響外觀與體感的零件。<strong>高度相差兩公分，長途的體感就不一樣</strong>;型錄因此把年式拆開，不做通用件。"
        }
      ]
    },
    "video": {
      "file": "assets/brand-video/materya-reel.mp4",
      "portrait": true,
      "poster": "assets/brands-prod/materya/reel-poster.jpg",
      "source": "https://www.instagram.com/reel/DVeM7gWDB3F/",
      "sourceLabel": "看官方 IG 原貼文",
      "title": "MATERYA 碳纖維風鏡",
      "caption": "官方 IG · 碳纖維風鏡裝車"
    },
    "categories": [
      [
        "外觀與後視鏡",
        1
      ],
      [
        "碳纖維部品",
        3
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 14
    }
  },
  {
    "slug": "motogadget",
    "name": "MOTOGADGET",
    "country": "德國",
    "origin": "德國 · Berlin · 自 2000",
    "lede": "自車庫自製數位儀表起家的柏林廠，產品涵蓋儀表、方向燈、電系控制模組與無鏡片後視鏡。",
    "wallTagline": "儀表、方向燈、把手開關",
    "slogan": "改的是電系，<br>不是貼紙。",
    "band": {
      "src": "assets/brands-hero/motogadget.jpg",
      "alt": "motogadget 柏林工作室",
      "focus": "center 46%"
    },
    "bandLogo": "assets/brands-dark/motogadget.svg",
    "logoScale": 1,
    "facts": [
      [
        "Founded",
        "2000 年",
        "1999 年車庫原型在先，隔年成立品牌"
      ],
      [
        "Made in",
        "德國 Berlin",
        ""
      ],
      [
        "Tech",
        "mo.unit · mo.view",
        "電系控制模組與無鏡片後視鏡"
      ],
      [
        "Approval",
        "ECE 核准",
        "燈具取得 ECE 核准"
      ]
    ],
    "about": {
      "lead": "<strong>1999 年，一具買不到的儀表。</strong>Garrit Keller 為自己的 Moto Guzzi 賽車邊車製作速度表，原因是市面上的儀表達不到他要的技術規格；隔年他與兩位夥伴在柏林成立 motogadget。<br><br>從那一具儀表開始，他們把整套電系一路做到控制模組與無鏡片後視鏡 —— 動的始終是線路那一層，不是外觀。",
      "pull": "自車庫裡的一具速度表，發展成一整套電系。",
      "tail": "<strong>這個品牌動到的是電系，不是外觀。</strong>mo.unit 這類控制模組的目的，是讓非專業者也能配出一套精簡線束——改裝復古車最麻煩的電系整合，他們從源頭處理，不是事後補救。<br><br><strong>掛得上去，才談得上好看。</strong>類比速度表與轉速表取得德國 KBA 核准與 ABE 一般行車許可，燈具取得 ECE 核准。歡迎提供您的車型年份與現有線路配置，由我們替您規劃。"
    },
    "aside": {
      "src": "assets/brands-prod/motogadget/motoscope.jpg",
      "alt": "motogadget motoscope 數位儀表裝車情境",
      "title": "motoscope 數位儀表",
      "note": "把手上的圓形數位儀表，需接原車線束。"
    },
    "highlights": {
      "title": "為什麼是 motogadget",
      "lead": "這家動到的是電系，不是外觀。從一具車庫裡的速度表開始，做到整套線束控制模組。",
      "cards": [
        {
          "t": "起點是一具做不出來的儀表",
          "d": "1999 年 Garrit Keller 為自己的 Moto Guzzi 賽車邊車製作速度表，原因是<strong>市面上的儀表達不到他要的技術規格</strong>。隔年與兩位夥伴成立品牌。"
        },
        {
          "t": "手工原型到量產儀表",
          "d": "品牌初期推出的是手工製作的數位儀表。<strong>2004 年推出第一款正式量產的系列儀表</strong>,團隊隨後遷入柏林市中心的較大廠房。"
        },
        {
          "t": "燈具與儀表掛核准",
          "d": "類比速度表與轉速表皆取得德國聯邦汽車運輸管理局（<strong>KBA</strong>）核准與 <strong>ABE</strong> 一般行車許可。對要驗車的車主，這是能不能掛上去的前提。"
        },
        {
          "t": "把線束變簡單",
          "d": "mo.unit 這類控制模組的目的，是讓<strong>非專業者也能配出一套精簡線束</strong>。改裝復古車最麻煩的電系整合，這家是從源頭處理而非事後補救。"
        }
      ]
    },
    "stats": {
      "items": [
        {
          "n": "1999",
          "l": "車庫原型",
          "s": "品牌成立早一年的起點"
        },
        {
          "n": "2004",
          "l": "首款量產系列儀表",
          "s": "自手作轉為正式產品線"
        },
        {
          "n": "2",
          "l": "項德國核准",
          "s": "KBA 核准 · ABE 一般行車許可"
        }
      ]
    },
    "craft": {
      "title": "動到的是電系，不是外觀",
      "rows": [
        {
          "step": "01 — Small Series",
          "t": "柏林的小批量生產",
          "img": "assets/brands-prod/motogadget/hero-workshop.jpg",
          "alt": "motogadget 位於柏林的工作場域",
          "d": "至今仍是<strong>以小批量生產電子產品的團隊</strong>。1999 年車庫裡的那具速度表是起點，2004 年才推出第一款正式量產的系列儀表，之後才遷入柏林市中心的較大廠房。"
        },
        {
          "step": "02 — Wiring",
          "t": "把線束變簡單",
          "img": "assets/brands-prod/motogadget/hero-hardware.jpg",
          "alt": "motogadget 的電系控制模組與五金件",
          "d": "mo.unit 這類控制模組的目的，是讓<strong>非專業者也能配出一套精簡線束</strong>。改裝復古車最麻煩的電系整合，這家從源頭處理；燈具與儀表另有 KBA 核准與 ABE 一般行車許可。"
        }
      ]
    },
    "categories": [
      [
        "燈具與電子",
        11
      ],
      [
        "外觀與後視鏡",
        1
      ],
      [
        "拉桿與把手",
        5
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 15
    }
  },
  {
    "slug": "rizoma",
    "name": "RIZOMA",
    "country": "義大利",
    "origin": "義大利",
    "lede": "由設計與加工兩兄弟在米蘭近郊創立的義大利廠，從一支後視鏡起家，產品線已延伸到自行車。",
    "wallTagline": "後視鏡、拉桿、腳踏",
    "slogan": "好看是門檻，<br>合手才是理由。",
    "band": {
      "src": "assets/brands-hero/rizoma.jpg",
      "alt": "RIZOMA 部品裝於車上的特寫",
      "focus": "center 52%"
    },
    "bandLogo": "assets/brands-dark/rizoma.png",
    "logoScale": 1,
    "facts": [
      [
        "Founded",
        "2001 年",
        "Fabrizio 與 Fabio Rigolio 兄弟創立"
      ],
      [
        "Made in",
        "義大利 米蘭近郊 Ferno",
        ""
      ],
      [
        "Material",
        "金屬加工與表面處理",
        "陽極色調為系列量身開發"
      ],
      [
        "Fitment",
        "車型專用配件",
        "產品分類以車款為入口"
      ]
    ],
    "about": {
      "lead": "<strong>第一件產品，是一支後視鏡。</strong>2001 年 Fabrizio 與 Fabio Rigolio 兩兄弟於米蘭近郊的 Ferno 創立 RIZOMA——一個出身設計，一個出身機械加工。那副為車手做的鏡框後來拿下設計獎，也決定了品牌往後的走法。<br><br>創辦人描述設計目標的說法是 give shape to movement:給運動一個形狀。",
      "pull": "產品在公司裡誕生，品牌在人的心裡誕生。",
      "tail": "<strong>塗裝在這裡不是選配，是系列的一部分。</strong>Americana 的 Solar Titanium 是為該系列量身調出的整體金色調，他們形容它不是我們賣的一個顏色，是我們做出來的一種觀點。<br><br><strong>而它早已走出機車。</strong>R21 把後視鏡做進自行車——18 公克、Zeiss® 光學；Scrambler 專案更把車、安全帽與騎士裝當成同一件作品處理。歡迎提供您的車型與出廠年份，由我們替您對應。"
    },
    "aside": {
      "src": "assets/brands-prod/rizoma/tank-cap.jpg",
      "alt": "RIZOMA 油箱蓋",
      "title": "油箱蓋",
      "note": "金屬削切與表面處理，車型專用。"
    },
    "highlights": {
      "title": "為什麼是 RIZOMA",
      "lead": "這個品牌是從一支後視鏡開始的，而且第一件產品就拿了設計獎。二十多年來它的方法沒變：先決定形狀，再讓功能長進去。",
      "cards": [
        {
          "t": "設計與加工，兩兄弟各出一半",
          "d": "2001 年 Fabrizio 與 Fabio Rigolio 於米蘭近郊的 Ferno 創立。<strong>一個出身設計，一個出身機械加工</strong>——這個組合決定了 RIZOMA 的東西為什麼既做得出來、又長得不一樣。"
        },
        {
          "t": "給運動一個形狀",
          "d": "創辦人描述設計目標的說法是<strong>「give shape to movement」</strong>,並說「產品在公司裡誕生，品牌在人的心裡誕生」。品牌的重心從一開始就不在規格表上。"
        },
        {
          "t": "塗裝是系列的一部分",
          "d": "表面處理在這裡不是選配：Americana 系列的 <strong>Solar Titanium</strong> 是為該系列量身調出的整體金色調，他們形容它「不是我們賣的一個顏色，是我們做出來的一種觀點」;Scrambler 專案則另開 <strong>Metal Rose</strong> 陽極。"
        },
        {
          "t": "已經走出機車",
          "d": "產品線不再只有機車：<strong>R21 把後視鏡做進自行車</strong>,規格是 18 公克、Zeiss® 光學、防碎抗切割，並設有獨立的 cycle 產品站。Scrambler 專案更把車、安全帽、騎士裝與場景當成同一件作品處理。"
        }
      ]
    },
    "stats": {
      "items": [
        {
          "n": "1,500+",
          "l": "件型錄品項",
          "s": ""
        },
        {
          "n": "160",
          "l": "個銷售國家",
          "s": ""
        },
        {
          "n": "2001",
          "l": "年創立",
          "s": "Rigolio 兄弟，米蘭近郊 Ferno"
        },
        {
          "n": "2",
          "l": "條產品線",
          "s": "機車與自行車各有專屬產品站"
        }
      ]
    },
    "craft": {
      "title": "用兩支影片講同一個理念",
      "rows": [
        {
          "step": "01 — The Project",
          "t": "車不只是車",
          "img": "assets/brands-prod/rizoma/video-scrambler.jpg",
          "video": "assets/brand-video/rizoma-scrambler.mp4",
          "alt": "RIZOMA Scrambler 專案影片",
          "d": "這個專案<strong>把車、安全帽、騎士裝與環境併成同一個動態畫面</strong>。限量 500 台，在 Joshua Tree 取景；它要證明的不是某個零件好，而是整套設計語言可以一路貫穿到場景。"
        },
        {
          "step": "02 — The Look",
          "t": "塗裝也是設計語言",
          "img": "assets/brands-prod/rizoma/video-fashion.jpg",
          "video": "assets/brand-video/rizoma-fashion.mp4",
          "alt": "RIZOMA Scrambler 專案的時尚短片",
          "d": "同一個專案的另一支片子拍的是穿著與質感。<strong>Metal Rose 這種陽極色不是從色票裡挑的</strong>,是為這個案子開發的；Americana 的 Solar Titanium 也是同樣的做法——先定調，再讓產品長成那個樣子。"
        }
      ]
    },
    "categories": [
      [
        "外觀與後視鏡",
        1
      ],
      [
        "拉桿與把手",
        5
      ],
      [
        "腳踏後移與傳動",
        9
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 16
    }
  },
  {
    "slug": "rpm-carbon",
    "name": "RPM CARBON",
    "country": "泰國",
    "origin": "泰國 · 自 2018",
    "lede": "以 PrePreg DryCarbon 加 Autoclave 壓製生產車型專用碳纖維外觀件的泰國廠，原廠直上、無需修改。",
    "wallTagline": "真空碳纖維車身部品",
    "slogan": "原廠直上，<br>不用切割、不用打孔。",
    "band": {
      "src": "assets/brands-hero/rpm-carbon.jpg",
      "alt": "RPM Carbon 碳纖維部品裝車情境",
      "focus": "center 55%"
    },
    "bandLogo": "assets/brands-dark/rpm-carbon.png",
    "logoScale": 1,
    "facts": [
      [
        "Founded",
        "2018 年",
        ""
      ],
      [
        "Made in",
        "泰國",
        ""
      ],
      [
        "Material",
        "PrePreg DryCarbon · Autoclave 壓製",
        "預浸布搭配高壓爐成型"
      ],
      [
        "Fixing",
        "ABS／PC 注塑固定件",
        "底座另行注塑，不以碳纖維承擔孔位"
      ]
    ],
    "about": {
      "lead": "<strong>碳纖維的好壞，在成形之前就決定了。</strong>RPM Carbon 2018 年成立於泰國，材料僅使用 DryCarbon 預浸布，不使用濕式積層——樹脂比例在布料出廠時就已固定，成品的織紋才不會走位。<br><br>所有產品皆於 Autoclave 高壓爐內壓製，部分品項的重量可較原廠塑膠件輕上七成五。",
      "pull": "織紋走不走位，取決於布，不取決於手。",
      "tail": "<strong>孔位的受力，不讓碳纖維本體硬撐。</strong>固定座與夾扣採用重新設計的 ABS／PC 注塑件——這是碳纖維件長期不裂的關鍵，也是外觀件與結構件的分界。<br><br><strong>泛黃多半是面漆先失效，不是織布的問題。</strong>面漆的選用標準是平滑、耐久且抗紫外線，每件出貨前 100% 檢查。歡迎提供您的車型與出廠年份，由我們替您確認對應品項。"
    },
    "aside": {
      "src": "assets/brands-prod/rpm-carbon/carbon.jpg",
      "alt": "RPM Carbon 碳纖維車身部品",
      "title": "碳纖維車身件",
      "note": "PrePreg DryCarbon + Autoclave 壓製，原廠直上。"
    },
    "highlights": {
      "title": "為什麼是 RPM Carbon",
      "lead": "碳纖維件的差別在壓製方式與固定件設計，兩者都看不出來，但幾個月後會現形。",
      "cards": [
        {
          "t": "只用 DryCarbon 預浸布",
          "d": "材料<strong>僅使用 DryCarbon(即 PrePreg 預浸布)</strong>,不使用濕式積層。樹脂比例在布料出廠時就固定，成品的織紋才不會走位。"
        },
        {
          "t": "全數以高壓爐壓製",
          "d": "所有產品皆於 <strong>Autoclave 高壓爐</strong>內壓製，以取得最高強度與最輕重量。部分品項的重量可較原廠塑膠件輕上七成五。"
        },
        {
          "t": "固定件另外注塑",
          "d": "固定座與夾扣採用耐久的 <strong>ABS／PC 注塑件</strong>,並經重新設計。孔位的受力由塑件承擔，不讓碳纖維本體硬撐。"
        },
        {
          "t": "面漆管的是抗紫外線",
          "d": "面漆的選用標準是<strong>平滑、耐久且具備抗紫外線能力</strong>。碳纖維件泛黃多半是面漆先失效，不是織布的問題。"
        }
      ]
    },
    "stats": {
      "items": [
        {
          "n": "75",
          "l": "% 減重上限",
          "s": "部分品項相對原廠塑膠件",
          "plus": false
        },
        {
          "n": "100",
          "l": "% 出貨前檢查",
          "s": "每件皆檢視瑕疵"
        },
        {
          "n": "2",
          "l": "段式製程",
          "s": "預浸布成型 + 高壓爐壓製"
        }
      ]
    },
    "craft": {
      "title": "看不見的兩道工序",
      "rows": [
        {
          "step": "01 — Autoclave",
          "t": "高壓爐壓製",
          "img": "assets/brands-prod/rpm-carbon/aprilia.jpg",
          "alt": "RPM Carbon 碳纖維車身件的織紋與收邊",
          "d": "所有產品一律以 Autoclave 壓製。<strong>織紋對不對得齊、樹脂會不會積在轉角</strong>,在成品上一眼可辨；這一段是濕式積層做不出來的。"
        },
        {
          "step": "02 — Fitting",
          "t": "注塑固定件",
          "img": "assets/brands-prod/rpm-carbon/craft-fitted.jpg",
          "alt": "裝上 RPM Carbon 碳纖維部品的 BMW S1000RR",
          "d": "固定座採 ABS／PC 注塑件並重新設計過。實務上這就是<strong>原廠直上、無需切割或鑽孔</strong>;前提仍是選到自己那台車的專用件。"
        }
      ]
    },
    "categories": [
      [
        "碳纖維部品",
        3
      ],
      [
        "外觀與後視鏡",
        1
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 17
    }
  },
  {
    "slug": "samco",
    "name": "SAMCO SPORT",
    "country": "英國",
    "origin": "英國 · 南威爾斯 Pontyclun · 自 1990",
    "lede": "南威爾斯手工疊層成型的英國矽膠水管廠，從重機、越野到汽車都依車型開發整組替換套件；原廠橡膠管會熱老化龜裂，矽膠管則否。",
    "wallTagline": "矽膠強化水管",
    "slogan": "換過一次，<br>之後只需要挑顏色。",
    "band": {
      "src": "assets/brands-hero/samco.jpg",
      "alt": "Samco Sport 贊助的 WorldSBK 賽事，Phillip Island 站",
      "focus": "center 64%"
    },
    "bandLogo": "assets/brands/samco.png",
    "logoScale": 1,
    "facts": [
      [
        "Founded",
        "1990 年",
        "原創高性能矽膠水管品牌"
      ],
      [
        "Made in",
        "英國 威爾斯 Pontyclun",
        "自有工廠，師傅手工成型"
      ],
      [
        "Material",
        "高性能矽膠 · 多層補強手工疊層",
        "耐高溫、耐老化，不會如橡膠般硬化龜裂"
      ],
      [
        "Racing",
        "MXGP Monster Energy Kawasaki · WorldSBK",
        "賽事車隊與市售套件同一套規格"
      ]
    ],
    "about": {
      "lead": "<strong>1990 年，高性能矽膠水管的原創者。</strong>Samco Sport 的水管由師傅在英國威爾斯 Pontyclun 的自有工廠手工成型，多層補強逐層疊上——不是押出成型的通用管。<br><br>合作對象包含 Kawasaki KRT WorldSBK 車隊，用的是與市售套件同一套規格。",
      "pull": "保固不是三年五年，是終身。",
      "tail": "<strong>矽膠管的缺陷，多出現在接合處與彎角。</strong>那正是自動化最難抓的位置，所以每一條皆經 100% 目視檢驗。高性能矽膠耐高溫也耐老化，不會像橡膠那樣硬化龜裂。<br><br><strong>全系列終身保固。</strong>對耐久的宣示，沒有比這更直接的講法。水管走向與接頭尺寸隨車型年式而異，歡迎提供您的車型與出廠年份，由我們替您配到正確的那一套。"
    },
    "aside": {
      "src": "assets/brands-prod/samco/hose.jpg",
      "alt": "Samco Sport 全車矽膠水管套件",
      "title": "全車水管套件",
      "note": "按車型開發的整組替換件，多層補強、多色可選，免裁免改。"
    },
    "highlights": {
      "title": "為什麼是 Samco Sport",
      "lead": "矽膠水管的差別在疊層與剪裁，兩者都在英國自有工廠以手工完成，不外包。",
      "cards": [
        {
          "t": "自有工廠手工疊製",
          "d": "水管由專人<strong>手工製作並於自有英國工廠測試</strong>。多層補強逐層疊上，不是押出成型的通用管。"
        },
        {
          "t": "逐件百分之百目視檢驗",
          "d": "每一條水管皆經 100% 目視檢驗。矽膠管的缺陷多出現在接合處與彎角，那是自動化最難抓的位置。"
        },
        {
          "t": "全系列終身保固",
          "d": "保固不是三年或五年，而是<strong>終身</strong>。對耐老化的宣示沒有比這更直接的講法。"
        },
        {
          "t": "賽事與市售同一套規格",
          "d": "合作對象包含 Kawasaki KRT WorldSBK 車隊與 BTCC 車隊，兩者皆曾公開致謝；兩者用的是同一套產品規格。"
        }
      ]
    },
    "stats": {
      "items": [
        {
          "n": "100",
          "l": "% 逐件目視檢驗",
          "s": "出廠標準"
        },
        {
          "n": "終身",
          "l": "保固",
          "s": "全系列適用，無年限"
        },
        {
          "n": "7",
          "l": "類車種對應",
          "s": "道路 · 越野 · 速可達 · 越野試騎 · UTV／SXS · ATV,外加汽車"
        },
        {
          "n": "19",
          "l": "種顏色",
          "s": "標準 6 · 進階 7 · 迷彩 6"
        }
      ]
    },
    "craft": {
      "title": "手工才做得出來的兩件事",
      "rows": [
        {
          "step": "01 — Layup",
          "t": "多層補強疊層",
          "img": "assets/brands-prod/samco/craft-layup.jpg",
          "alt": "Samco Sport 不同顏色的矽膠片與內層補強織布",
          "d": "形象照裡看得到矽膠片與夾在中間的補強織布。<strong>耐壓與耐溫來自這幾層的疊法</strong>,不是外徑或厚度；押出成型的通用管沒有這一層。"
        },
        {
          "step": "02 — Tool Room",
          "t": "自有工模室",
          "img": "assets/brands-prod/samco/craft-toolroom.jpg",
          "alt": "Samco Sport 工模室內焊接成型治具的作業",
          "d": "車型專用套件要先有對應的成型芯模。自有工模室就是這一段：<strong>模具在自己手上</strong>,彎角走向才對得上原廠水路，而不是靠使用者硬凹。"
        }
      ]
    },
    "video": {
      "youtube": "-BfKc0B5ipQ",
      "poster": "assets/brands-prod/samco/film-poster.jpg",
      "title": "Samco Sport 手工製作過程",
      "caption": "官方影片 · 手工疊製"
    },
    "categories": [
      [
        "引擎與冷卻",
        7
      ],
      [
        "精品螺絲與螺帽",
        6
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 18
    }
  },
  {
    "slug": "wrs",
    "name": "WRS",
    "country": "義大利",
    "origin": "義大利 · Cattolica · 自 2008",
    "lede": "以 PMMA Plexiglas 製作道路、旅行與賽道風鏡的義大利廠，雷射切割與 3D 掃描皆於自有產線執行。",
    "wallTagline": "風鏡、擾流罩",
    "slogan": "風從哪裡繞過去，<br>是算出來的。",
    "band": {
      "src": "assets/brands-hero/wrs.jpg",
      "alt": "WRS 產線與測試車",
      "focus": "center 46%"
    },
    "bandLogo": "assets/brands-dark/wrs.png",
    "logoScale": 0.94,
    "facts": [
      [
        "Founded",
        "2008 年",
        "從小型手工風鏡部門開始"
      ],
      [
        "Made in",
        "義大利 Cattolica",
        ""
      ],
      [
        "Material",
        "PMMA Plexiglas",
        "品牌指定材料，非一般壓克力"
      ],
      [
        "Racing",
        "MotoGP · WorldSBK 廠隊供應",
        "十支合作車隊"
      ]
    ],
    "about": {
      "lead": "<strong>2008 年，一個只做風鏡的小型手工部門。</strong>WRS 自義大利 Cattolica 起步，一開始只服務旅行與運動車款。<br><br>十幾年後，它的風鏡出現在 MotoGP 與世界超級摩托車的廠車車頭上。中間差的不是規模，是他們把每一道工序都收回了自己手裡。",
      "pull": "曲面用軟體算，氣流進風洞驗。",
      "tail": "<strong>他們的形象照攝於 BMW 集團的聲學風洞，測試對象是 WorldSBK 廠車。</strong>合作車隊共十支，包含 Ducati Lenovo、KTM Factory Racing 與 ROKiT BMW Motorrad WorldSBK;材料是 PMMA Plexiglas,不是一般壓克力。<br><br><strong>風鏡改的是您耳邊的那一段風。</strong>高度與角度直接決定長途的疲勞程度。歡迎提供您的車型年份與常行駛的路段，由我們替您挑選。"
    },
    "aside": {
      "src": "assets/brands-prod/wrs/motogp-screen.jpg",
      "alt": "WRS MotoGP 賽用風鏡與 Ducati 廠車車頭",
      "title": "MotoGP 賽用風鏡",
      "note": "廠隊車頭上的這一片，與市售件出自同一條產線。"
    },
    "highlights": {
      "title": "為什麼是 WRS",
      "lead": "風鏡的差別在曲面與材料，兩者都不是外觀問題。WRS 自 2008 年的手工部門起步，如今設計、切型到驗證全部在自有產線完成。",
      "cards": [
        {
          "t": "自手工部門長成獨立產線",
          "d": "2008 年以一個小型手工部門開始，只做旅行與運動車款風鏡；需求成長後投入設備，建立完全獨立的生產部門。"
        },
        {
          "t": "從設計到成品一條線",
          "d": "生產部門<strong>自行掌握全部環節</strong>:設計、規劃到最終生產，不外包。設備包含雷射切割、3D 掃描、CNC 銑削與模擬軟體。"
        },
        {
          "t": "氣流以實測驗證",
          "d": "風鏡的曲面靠模擬軟體計算，再進風洞實測。形象照即攝於 BMW 集團聲學風洞，測試對象是 WorldSBK 廠車。"
        },
        {
          "t": "廠隊與市售件同一條產線",
          "d": "合作車隊包含 Ducati Lenovo、KTM Factory Racing、Prima Pramac Yamaha、ROKiT BMW Motorrad WorldSBK 等十支。"
        }
      ]
    },
    "stats": {
      "items": [
        {
          "n": "10",
          "l": "支合作車隊",
          "s": "MotoGP · WorldSBK · Moto2 廠隊"
        },
        {
          "n": "2021",
          "l": "取得新認證",
          "s": "以此擴展國際市場"
        },
        {
          "n": "4",
          "l": "項自有設備",
          "s": "雷射切割 · 3D 掃描 · CNC 銑削 · 氣流模擬"
        }
      ]
    },
    "craft": {
      "title": "兩件外包做不到的事",
      "rows": [
        {
          "step": "01 — Laser Cutting",
          "t": "自有產線切型",
          "img": "assets/brands-prod/wrs/craft-laser.jpg",
          "alt": "WRS 產線上以雷射切割 PMMA 板材",
          "d": "生產部門<strong>完全獨立</strong>,自設計、規劃至最終生產一貫執行。雷射切割決定邊緣的乾淨度與固定孔的精度，這一段外包就控制不了。"
        },
        {
          "step": "02 — Wind Tunnel",
          "t": "風洞裡的實測",
          "img": "assets/brands-prod/wrs/craft-windtunnel.jpg",
          "focus": "center 42%",
          "alt": "WorldSBK 廠車於 BMW 集團聲學風洞內進行氣流測試",
          "d": "曲面先以模擬軟體計算，再進風洞驗證。<strong>風鏡不是一片壓克力，是一片計算過又量測過的曲面</strong>;算得出來與吹得過，是兩件事。"
        }
      ]
    },
    "categories": [
      [
        "外觀與後視鏡",
        1
      ]
    ],
    "focus": {
      "enabled": true,
      "order": 19
    }
  }
];

/** slug → 品牌(D3 的 /brands/[slug] 路由查表;對應 `?pbrand=<slug>` 的同一個 slug 空間)。 */
export const BRAND_BY_SLUG: Record<string, BrandContent> = Object.fromEntries(
  BRAND_CONTENT.map((brand) => [brand.slug, brand]),
);
