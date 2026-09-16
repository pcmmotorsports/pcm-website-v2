// home-banner-rules.ts — 首頁新品大圖的版面規矩數字【唯一一份】(2026-09-16 設計窗)
//
// 誰讀:storefront `HomeHero`(動畫時間、標題分層)、admin 首頁大圖編輯面板(字數提示、預覽分層)。
//   之後每日讀信起草(PRD §4,片 10–12)與 pcm-banner skill 也讀這支 —— 不要在別處抄數字。
// 來源:~/pcm-mailbox/大圖設計流程提案-0916.md 第 4 節 R4–R7;
//   OD `pcm-home-redesign/banner-wrs-motion-v1.html` #m1(1280 / 390 實拍實量)。
// 🔴 放 packages/domain 而不是 admin:storefront 不能 import admin(同 FITMENT_STALE_DAYS 那條路)。

/**
 * 首頁輪播**同時**掛得住幾張(顧客站那支查詢的 `.limit()`)。
 *
 * 🔴🔴 **2026-09-16 從 `apps/storefront/src/lib/home-banners.ts` 搬過來,而搬的理由是它害人說謊過一次:**
 *    後台那兩句文案逐字寫著「**首頁只會顯示最近上架的那一張(多張輪播還沒做)**」——
 *    而多張輪播早就做完了。⇒ 📌 **後台在告訴員工一件只有 storefront 知道的事,而它抄不到那個數。**
 *    ⇒ 🎯 **要嘛後台不准講這個數,要嘛這個數住在兩邊都讀得到的地方。** 選後者。
 * 🛑 **所以後台【不准】自己寫一個 4** —— 那就是製造下一次說謊的來源。
 */
export const HOME_BANNER_MAX_SLIDES = 4;

/** 字數上限(以字元計;只當提示與起草目標,DB CHECK 的硬上限在 migration 20260916150000)。 */
export const HOME_BANNER_TEXT_MAX = {
  /** 中文大標每行:390 寬 26px 一行放 12 字(home.css `.b-hero-title--cjk` 的 clamp 下限就是照這個算的)。 */
  titleLine: 12,
  /** 英文車款小字層:390 寬 13px mono、字距 .14em ⇒ 一行約 36 字,留 4 字餘裕。 */
  modelLine: 32,
  /** 副標:390 寬 15px 一行約 23 字、桌機一行;超過在手機折第二行(CSS 最多兩行)。 */
  subtitle: 26,
  cta: 16,
} as const;

/** 動畫時間(ms)。storefront 以 CSS 變數吃進去(`HomeHero` 掛在 section 上),CSS 檔裡不寫數字。 */
export const HOME_BANNER_MOTION_MS = {
  /** 文字淡入一段的長度 */
  textFade: 700,
  /** 眉標 → 標題 → 副標 → 按鈕,每段往後錯開;三段 ⇒ 最後一段 240ms 起跑(不拖 LCP 的上限) */
  textStagger: 80,
  /** 展示台落定(14px → 0) */
  settle: 800,
  /** 商品慢推 scale 1 → 1.06 的單程(來回無限) */
  kenBurns: 16000,
  /** 光掃:等台面落定一半再掃、只掃一次 */
  sweepDelay: 550,
  sweep: 1500,
} as const;

/**
 * 標題分兩層(OD #m1:英文車款小字 + 中文大標)。
 * 第一行【全是 ASCII】而且有第二行 ⇒ 第一行是車款小字層、第二行是大標;其餘照舊兩行大標。
 * ponytail: 判斷只看「是不是純 ASCII」,不認車款字典 —— 英文促銷句(例 "NEW ARRIVAL")也會變小字;
 *   真的需要分開時再加一個欄位(schema ⇒ 鐵則 8)。
 */
export function splitHomeBannerTitle(line1: string, line2: string | null): { model: string | null; main: string[] } {
  const second = line2 && line2.trim() !== '' ? line2 : null;
  if (second && /^[\x20-\x7e]+$/.test(line1)) return { model: line1, main: [second] };
  return { model: null, main: second ? [line1, second] : [line1] };
}
