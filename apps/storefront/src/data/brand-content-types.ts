// brand-content-types.ts — 品牌介紹頁內容的型別(D1a;2026-08-04)
//
// 對應設計側唯一資料來源:Open Design `pcm-home-redesign` 的 `brand-content-data.js`
// (20 家 / 1188 行;鐵則 1 例外 = 2026-08-03 Sean 拍 Q1=B,真權威在 Open Design、
//  不是 design-reference submodule)。實際資料由 D1b 落進 `brand-content.ts`。
//
// 🔴 本檔的形狀**不是照設計文件抄的,是把 20 家資料求值後量出來的**
//    (2026-08-04;方法:node 跑一支 `new Function('window', src)` 的 shim 後統計鍵出現次數)。
//    必填 / 選填的依據是「20 家裡出現幾次」,不是「文件說它重要」:
//      band 20 · bandLogo 20 · logoScale 20 · facts 20 · about 20 · aside 20
//      highlights 20 · craft 20 · categories 20 · focus 20 · slogan 20
//      stats 14 · video 11 · timeline 2
//    ⚠️ 先前用 grep 數 `video:` 得到 13 是**錯的** —— craft.rows 裡也有 `video` 鍵。
//       這就是形狀要用求值取、不要用 grep 數的理由。
//
// 🔴 帶標記的欄位在型別上仍是 string(裡面可能有 `<strong>` / `<br>` / `&amp;`),
//    渲染端一律先過 `@/lib/brand-rich-text` 的 parseBrandRichText,
//    **絕不 dangerouslySetInnerHTML**(D 計畫 §5.1 的 c 案、Sean 2026-08-04 指定)。
//    下面用 `BrandRichString` 這個別名把「這欄可能有標記」標出來,讓漏轉的地方看得見。

/** 內容字串,可能含白名單標記(`<strong>` / `<br>`)與 `&amp;`。渲染前必過 parseBrandRichText。 */
export type BrandRichString = string;

/** 四則事實的一列:[標籤, 值, 小註]。實測 74 列全為長度 3。 */
export type BrandFact = readonly [label: string, value: string, note: string];

/**
 * 代表分類:[分類名, 首頁色碼編號]。實測 52 筆、12 種分類名,編號值域 0-11(缺 2)。
 * 🔴 編號**對應首頁 N°03 的 `--cat-N`**,綁的是分類 id 不是排序位置
 *    (README §8:名次會變、綁位置排名一變顏色就跳)。
 */
export type BrandCategoryRef = readonly [name: string, colorIndex: number];

/** 橫幅照。schema 註解寫「沒有官方授權檔就 null,版面自動退回純石墨底」⇒ 型別留選填。 */
export type BrandBand = {
  src: string;
  alt: string;
  /** CSS object-position 字面,如 `center 58%`。桌機的幕會吃掉照片左半,主體要中間偏右。 */
  focus: string;
  /** 實測只有一家用 `start`。 */
  align?: 'start';
};

/** About 右欄產品照小卡。schema 註解寫「沒有官方產品照就 null」⇒ 型別留選填。 */
export type BrandAside = {
  src: string;
  alt: string;
  title: string;
  note: BrandRichString;
};

/** 兩段介紹 + pull quote。schema 註解:pull 湊不出來就留空字串(不是省略)。 */
export type BrandAbout = {
  lead: BrandRichString;
  pull: BrandRichString;
  tail: BrandRichString;
};

/** 深度 ABOUT 的四張卡(實測 80 張,每張恆為 { t, d })。 */
export type BrandHighlightCard = { t: string; d: BrandRichString };

export type BrandHighlights = {
  title: string;
  lead: BrandRichString;
  cards: BrandHighlightCard[];
};

/** 數字牆的一格。`plus` = 值後面要不要加「+」(實測 50 格中 10 格有,其餘無)。 */
export type BrandStatItem = { n: string; l: string; s: string; plus?: boolean };

export type BrandStats = { items: BrandStatItem[] };

/** 年表的一列。`key` 只出現 true(= 這列要強調);實測 26 列中 8 列有。 */
export type BrandTimelineItem = { y: string; t: string; d: BrandRichString; key?: true };

export type BrandTimeline = { title: string; items: BrandTimelineItem[] };

/**
 * 製程步驟的一列。
 * 🔴 版面是 2 欄格線 ⇒ 步數要能被 2 整除,否則右下留一個看起來像沒做完的角
 *    (README:Kineo 用四步不是三步、Extreme 維持兩步不加到三步)。
 */
export type BrandCraftRow = {
  step: string;
  t: string;
  img: string;
  alt: string;
  d: BrandRichString;
  /** 圖片裁切焦點,同 band.focus 的 CSS object-position 字面。 */
  focus?: string;
  /** 這一格改放影片(實測只有 rizoma 兩格)。 */
  video?: string;
};

export type BrandCraft = { title: string; rows: BrandCraftRow[] };

/**
 * 品牌影片。來源三選一、互斥:`youtube`(6)/ `file`(4)/ `vimeo`(1)。
 * 🔴 型別刻意**不**做成 discriminated union:資料是設計側手寫的物件字面,
 *    做成 union 會讓 D1b 的搬運被迫改寫資料形狀,而改寫就有走樣的風險。
 *    「恰好一個來源」由 D1b 的 harness 斷言守(見該片測試),不是由型別守。
 */
export type BrandVideo = {
  youtube?: string;
  vimeo?: string;
  /** Vimeo 未公開影片的 hash(實測只有一家有)。 */
  vimeoHash?: string;
  file?: string;
  poster: string;
  title: string;
  caption: string;
  /** 直式影片,≤1180 會跨滿整列走滿版(BRAND-PAGE-HANDOFF §4.3)。 */
  portrait?: true;
  /** 原始出處連結 + 連結字面(實測 4 家有)。 */
  source?: string;
  sourceLabel?: string;
};

/** 首頁 N°05 本月聚焦的輪播設定。實測 20 家 enabled 全 true、order 恰為 0-19 無重複。 */
export type BrandFocus = { enabled: boolean; order: number };

/** 一家品牌一列。欄位對照版型見 `brand-content-data.js` 檔頭的「欄位對照版型」表。 */
export type BrandContent = {
  /** 網址用 slug,對應 `?pbrand=<slug>`(products-url-state.tsx:92-98 的讀取端)。 */
  slug: string;
  name: string;
  country: string;
  /** 橫幅眉標:國別 · 城市 · 自 YYYY。 */
  origin: string;
  /** 一句話定位,35-50 字。 */
  lede: BrandRichString;
  slogan: BrandRichString;
  band?: BrandBand;
  /** 深色場 logo(`assets/brands-dark/`);與磚牆用的 `brands-trim/` 是不同資料夾,不要拿錯。 */
  bandLogo: string;
  /** 品牌磚牆的逐家光學校正,預設 1;實測值域 0.88-1.08、7 家非 1。新增品牌要目視加一次,不是套公式。 */
  logoScale: number;
  facts: BrandFact[];
  about: BrandAbout;
  aside?: BrandAside;
  video?: BrandVideo;
  highlights: BrandHighlights;
  stats?: BrandStats;
  timeline?: BrandTimeline;
  craft: BrandCraft;
  categories: BrandCategoryRef[];
  focus: BrandFocus;
};
