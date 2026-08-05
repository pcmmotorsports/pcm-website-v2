// brand-focus.ts — 首頁 N°05「本月聚焦」的覆蓋層資料(D5e-1;2026-08-05)
//
// 🔴 **這份檔只服務首頁 N°05 一個版位**,不是品牌頁的資料(Open Design
//    `pcm-home-redesign/brand-focus-data.js` 檔頭逐字)。品牌頁的唯一資料來源仍是
//    `brand-content.ts`。這裡放的是「首頁要多講的那一點點」,其餘一律從 `BRAND_CONTENT` 取。
//
// 🔴 **D5e-2 開工前一定要讀 OD `N05-FOCUS-HANDOFF.md`**(D5e-1 的 R2 才發現有這份、我第一輪漏了)。
//    它比 `brand-focus-data.js` 檔頭多講了:全形標點新規則(§七)、N°06 磚牆版型改由 JS 產生(§五)、
//    輪播規格(§八),以及「換掉時順便清掉」的舊內容清單。本檔下方的紅字都對得上那份。
//    ⚠️ 型別名對照:handoff 那邊叫 `BrandFocusCopy`,本檔叫 `BrandFocusOverlay`(同一個東西)。
//
// 欄位契約(逐字照 OD `brand-focus-data.js` 檔頭,D5e-2 搬 20 家時零改形):
//   title → 一句鉤子。品牌名由版位另外顯示,標題**不重複寫品牌名**
//   photo → 產品／工藝特寫。刻意**不用** `brand.band`(那張是品牌頁的 hero),
//           首頁與品牌頁看到不同的照片,點進去才有「還有別的」的感覺
//   facts → 三則 [標籤, 值]。值一律取自 `BRAND_CONTENT` 該品牌的 facts,
//           不自行增列標籤、不改寫值。**沒有說明句** —— 說明句留在品牌頁
//           🔴 **唯一那筆 RIZOMA 不遵守這條,而且是刻意的**(R1 must-fix:契約句與資料相反)——
//              見下方 `BRAND_FOCUS.rizoma` 的紅字說明。D5e-2 搬 OD 20 家時全部遵守。
//   body  → 選填。不填就用 `BRAND_CONTENT` 的 `lede`,同一句話不維護兩份
//
// 🔴 **標點 = 全形**(2026-08-05 Sean 拍板,**推翻**舊規則;權威 = OD `N05-FOCUS-HANDOFF.md` §七)。
//    `brand-content-data.js` 檔頭原本寫的「半形逗號 + 全形句號、頓號」**已作廢**。
//    新規則:中文文案的逗號、冒號、分號、括號一律全形 —— `，：；（）。、`
//    判準:**前一個字是中文才全形**;英數字後面維持半形(`Pontyclun, South Wales` 這種
//    是英文語境,全形會很怪)。資產路徑、HTML 標籤與實體、規格數字一律不動。
//    ⚠️ OD 端已全面套用(handoff 逐字:628 處)⇒ **搬過去時不要「順手修正」回半形。**
//    (R2 must-fix:本檔第一版照抄了那條作廢的舊規則 —— D5e-2 讀這裡就會把 20 家全改錯。)
// ⚠️ `body` 與 `title` 走 `BrandRichString`(白名單 `<strong>` / `<br>` / `&amp;`),
//    渲染端一律過 `BrandRichText`,**絕不 dangerouslySetInnerHTML**。
//
// ══════════════════════════════════════════════════════════════════════════
// 🔴🔴 **D5e-1 目前只有 RIZOMA 一家,而且不是 OD 的那一版** —— 這是刻意的,不是做一半:
//    主視窗 C-88-A 逐字「你先做資料驅動殼+每 3 天輪播機制那半,**當期先固定 RIZOMA 現內容**,
//    D5e-2 搬資料時零改形」。所以這一筆 = 把**現行首頁上那段硬編的 RIZOMA 文案**原封搬進
//    資料層、一個字沒改,證明殼吃得動資料;**OD 的 20 家版本(含 RIZOMA 那句
//    「第一件產品，是幫一位車友做的後視鏡。」——**逗號是全形**,見上面 §標點)是 D5e-2 的事。**
//
// **D5e-2 開工前必讀的兩個實查結果**(現在就記,免得下一棒重踩):
//   ① **20 家裡有 9 家的 photo 檔在本 repo 不存在**(R1 實查,不是只有 rizoma):
//      cnc-racing / eazi-grip / extreme / gb-racing / gilles / k-speed / rizoma / rpm-carbon / samco。
//      例:OD 的 rizoma 指 `assets/brands-prod/rizoma/stealth-mirror.jpg`,而該目錄實際只有
//      `tank-cap.jpg` / `video-fashion.jpg` / `video-scrambler.jpg`。
//      ⇒ 搬 20 家時**逐家驗檔案真的在**,不要照抄路徑就當有(同 `data/brand-assets.test.ts` 那一族)。
//   ② 資產前綴**已在解析端收掉**、不用在資料層動手:OD 的路徑是 repo 相對的 `assets/…`,
//      `lib/brand-focus.ts` 的 `resolvePhotoSrc()` 會補 `/brand-assets/`(絕對 URL 原樣放行)。
//      D5e-1 這筆是 unsplash 絕對網址,所以這個缺口在本片看不出來 —— R1 抓到的,先收了。
//   ③ 現行這張 RIZOMA 圖是 **unsplash 外部網址**(既有債、非本片引入)。
//      D5e-2 換成 repo 內資產時一併收掉。
// ══════════════════════════════════════════════════════════════════════════
//
// 🔴 **內容分級 L2**(鐵則 9):首頁文案、季 1-3 次的變動頻率,hardcode 可但要有 backlog。
//    對照 `data/brand-content.ts` 同款標記;後台 CRUD 屬 backlog #271(信任狀/文案後台化)。

import type { BrandRichString } from './brand-content-types';

/** 一則事實:[標籤, 值]。刻意比 `BrandFact` 少一欄 —— 說明句留在品牌頁。 */
export type BrandFocusFact = readonly [label: string, value: string];

/** 首頁版位的覆蓋層。沒有的欄位由 `resolveBrandFocus` 從 `BRAND_CONTENT` 退。 */
export type BrandFocusOverlay = {
  title: BrandRichString;
  photo: string;
  /**
   * 恰好三則。**寫成定長三元組而不是陣列**(R2 nit;OD handoff 指定的也是三元組):
   * D5e-2 要一次貼 20 家,漏填一則的話陣列型別在編譯期完全看不出來,
   * 而 runtime 只有「被 PIN 住的那一家」會被 `toHaveLength(3)` 驗到 —— 其餘 19 家漏了沒人知道。
   */
  facts: readonly [BrandFocusFact, BrandFocusFact, BrandFocusFact];
  /** 選填。不填就用 `BRAND_CONTENT` 的 `lede`。 */
  body?: BrandRichString;
};

/**
 * 當期釘住的品牌 slug。
 *
 * 🔴 **D5e-2 落地時把這一行改成 `undefined`**,輪播就自己轉起來(其餘零改動)。
 *    在 20 家文案齊之前讓它轉,會轉出 19 家只有 fallback 標題的版位。
 *    機制本身沿用 OD 的 `PCM_BRAND_FOCUS_OVERRIDE`,不是本片自創的臨時開關。
 */
export const BRAND_FOCUS_PIN: string | undefined = 'rizoma';

export const BRAND_FOCUS: Readonly<Record<string, BrandFocusOverlay>> = {
  // 🔴 逐字搬自改動前的 `FeatureEditorial.tsx` 硬編內容(D5e-1 只搬家、不改字)。
  //    `<br>` 是原本 JSX 裡的 `<br />`,轉成白名單標記由 `BrandRichText` 還原。
  //
  // 🔴🔴 **這一筆有兩處與檔頭契約、與 `BRAND_CONTENT` 相牴觸,兩處都是「先固定現內容」的代價**
  //      (R1 must-fix 抓出來的,現在標紅、不默默留著;D5e-2 搬 OD 版時兩處自然消失):
  //   ① `facts` 的三個標籤 `ORIGIN / SINCE / CRAFT` 與三個值,在 `BRAND_CONTENT` 的
  //      rizoma facts 裡**一個都不存在**(那家實際是 Founded / Made in / Material / Fitment)
  //      ⇒ 違反檔頭「值一律取自 BRAND_CONTENT、不自行增列標籤」。這是舊硬編留下來的自創欄位。
  //   ② 🔴 **這一筆有兩顆對客可見的錯內容,兩顆都被原地搬進來、一個字沒改**
  //      —— OD `N05-FOCUS-HANDOFF.md` 的「換掉時順便清掉,不要原樣搬」清單上就有它們:
  //        · **`SINCE 2000` 年份錯**:`BRAND_CONTENT` 的 rizoma 是「Founded / **2001 年**」,
  //          OD `brand-focus-data.js` 也寫 2001。
  //        · **敘述裡的「三十年如一日」也錯**:2001 年創立、2026 年是 **25 年**。
  //          (R2 must-fix:第一版只標了年份那顆、漏了這顆,同一份清單上的東西處置不一致。)
  //      兩顆**現在就在正式站首頁上**(舊硬編就是這樣),本片只是把它們原地搬進資料層
  //      —— Sean 指示「先固定現內容」,所以不改字。
  //      ⇒ **兩顆都列 Sean 肉眼驗、且 D5e-2 必改**。要現在就改也只是改這兩行。
  //      同一份 handoff 還記了第三顆:這張 unsplash 圖是 placeholder CDN(見上方 §D5e-2 必讀 ③)。
  rizoma: {
    title: '工藝之鏡',
    photo: 'https://images.unsplash.com/photo-1558981852-426c6c22a060?w=1600&q=85&auto=format&fit=crop',
    body:
      '自米蘭的金屬實驗室,三十年如一日。<br>'
      + 'RIZOMA 以鏡面後視鏡、CNC 削切的剎車把手,<br>'
      + '重新定義了重車配件的工藝高度。',
    facts: [
      ['ORIGIN', 'Milano, Italy'],
      ['SINCE', '2000'],
      ['CRAFT', 'CNC · Anodized'],
    ],
  },
};
