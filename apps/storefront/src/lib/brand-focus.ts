// brand-focus.ts — 首頁 N°05「本月聚焦」的輪播決策(D5e-1;2026-08-05)
//
// 真權威 = Open Design `pcm-home-redesign/direction-b-layout-01-graphite-ember.html` 的
// `brand-focus` 那段 IIFE(逐字:`Math.floor(elapsedDays / 3) % focusBrands.length`)
// 與 `pcm-home-redesign/brand-focus-data.js` 的檔頭契約。
// 鐵則 1 例外 = 2026-08-03 Sean 拍 Q1=B(本線真權威在 Open Design)。
// ⚠️ 刻意不引 OD 行號:那份稿仍在被改(D5d R2 實錘:四處引用的行號同一天全部漂掉)。
//
// 🔴 這支**只做決策、不碰 React**:輪播是「今天是哪一天」的函式,而
//    「量時間的東西」最容易寫成測不動的樣子。所以 `now` 一律**由呼叫端傳入**,
//    本檔內部絕不呼叫 `new Date()` / `Date.now()` ⇒ 測試給定日期就有定值答案。

import type { BrandContent, BrandFact } from '@/data/brand-content-types';
import type { BrandFocusOverlay } from '@/data/brand-focus';
import { brandAsset } from '@/lib/brand-asset';

/** 輪播起算日(OD `TWEAK_DEFAULTS.focusStartDate` 逐字)。 */
export const FOCUS_ROTATION_START = '2026-08-03';
/** 幾天換一家(OD `TWEAK_DEFAULTS.rotationDays` 逐字)。 */
export const FOCUS_ROTATION_DAYS = 3;

/**
 * 把一個時間點換算成「台灣的第幾天」(自 Unix epoch 起算的整數日)。
 *
 * 🔴 **為什麼不照抄 OD 的 `new Date('2026-08-03T00:00:00')`**:那個字面沒有時區後綴 =
 *    **依執行環境的本地時區解讀**,同一份 code 在不同機器上換人的時刻不一樣。
 *    本函式改成算「絕對曆日」:顯式指定 `Asia/Taipei` 取曆日、起算日用 `T00:00:00Z` 解析
 *    ⇒ **對執行環境的時區完全免疫**,不論 server 設成什麼,換人一律落在台灣的午夜。
 *    (R3 F6 更正:第一版把理由寫成「正式站 server 跑 UTC」—— 那是我沒實測過的部署事實,
 *     而且會讓未來的人以為「把 server 設成 Asia/Taipei 就能改回照抄」。事實比那更強:
 *     這個實作根本不看執行環境。)客人在台灣,換人就該在台灣的午夜。這是同一族的坑:
 *    memory `project_m4b-a9d2-1-note-action-decisions`(`datetime-local` 無偏移 + server UTC
 *    ⇒ 時間差 8 小時靜默入庫)。
 * ⚠️ 這是**申報偏離設計稿**,不是疏漏 —— 已登記在 manifest 的 business_overrides。
 *
 * 作法沿用本 repo 既有慣例(`lib/orders/order-display.ts` 的 `formatOrderDate`):
 * `en-CA` locale 的日期格式恰為 `YYYY-MM-DD`,配 `timeZone: 'Asia/Taipei'` 取台灣曆日,
 * 再以 UTC 午夜解析成整數日 —— 兩邊都是純曆日,相減不受 DST/時區影響(台灣也無 DST)。
 */
export function taipeiDayNumber(at: Date): number {
  const ymd = at.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  return Math.floor(Date.parse(`${ymd}T00:00:00Z`) / 86_400_000);
}

/**
 * 當期輪到第幾個。OD 那段的形狀是 `Math.floor(elapsedDays / 3) % focusBrands.length`
 * (參數名不同、算式同構;不宣稱「逐字」—— R1 nit:標逐字就要對得上)。
 *
 * `count <= 0` 回 `0`(呼叫端已先擋空清單;這裡再擋一次是因為 `% 0` 會回 `NaN`,
 * 而 `NaN` 當索引取出 `undefined`、整個版位靜默消失)。
 * 起算日之前(elapsed 為負)夾到 `0`(OD `Math.max(0, ...)` 同款)。
 *
 * ⚠️ 起算日與週期**直接吃模組常數、不開參數**(R1 nit):第一版開了 `{start, days}` 選項,
 *    零呼叫端使用、測試也從不給值,而且 `days = 0` 會從 `% 0` 那道守衛底下鑽過去回 `NaN`
 *    —— 一個沒人用、又自己開了一個洞的旋鈕。要改週期就改上面的常數。
 */
export function focusRotationIndex(now: Date, count: number): number {
  if (count <= 0) return 0;
  const startDay = Math.floor(Date.parse(`${FOCUS_ROTATION_START}T00:00:00Z`) / 86_400_000);
  const elapsedDays = Math.max(0, taipeiDayNumber(now) - startDay);
  return Math.floor(elapsedDays / FOCUS_ROTATION_DAYS) % count;
}

/** 版位真正要渲染的東西。元件只認這個形狀,不認 `BrandContent` 也不認 overlay。 */
export type ResolvedBrandFocus = {
  slug: string;
  /** 品牌名(眉標與 CTA 都要用)。 */
  name: string;
  /** 鉤子標題。overlay 沒有這一家就退回品牌名(OD 逐字:「版位不會空」)。 */
  title: string;
  /** 敘述句。預設用品牌頁的 `lede`,overlay 有 `body` 才覆寫(OD 逐字:「同一句話不維護兩份」)。 */
  body: string;
  /** 圖說只給產地(OD 逐字:分類清單已在別處出現過,疊在照片上只是把照片遮掉)。 */
  caption: string;
  /** 三則 [標籤, 值]。overlay 沒有就取 `brand.facts` 前三則的前兩欄(小註留在品牌頁)。 */
  facts: readonly (readonly [string, string])[];
  /**
   * 這家的商品分類**名稱**(D5e-2b 動線列用)。
   *
   * 🔴 只取名字、丟掉件數:`brand.categories` 是 `[名稱, 件數]`,而動線列
   *    (`.ed-feature-jump`)照設計稿只顯示分類名、不報件數 —— 件數是品牌頁那邊的東西。
   * 🔴 **名稱就是網址參數本身**:`?category=` 的讀取端吃的是分類名稱(raw_path、人類可讀),
   *    見 `components/products-url-state.tsx` 的 `parseCategoryFromUrl`。
   *    ⚠️ 比對不到時是**靜默**的(那支 miss 就回 `null`)⇒ 客人會看到「該品牌全部商品」、
   *       和沒篩選長得一模一樣、零錯誤訊息。這批分類名在正式目錄裡撈不撈得到
   *       = **既有 backlog #315**(`lib/brand-url.ts` 的 `brandCatalogueUrl` 已記過同一件事),
   *       非本片新增,本片也沒有讓它變好或變壞。
   */
  categories: readonly string[];
  /**
   * 產品特寫的**可直接餵給 `src` 的網址**;沒有就是 `null`,由元件決定怎麼退。
   *
   * 🔴 這裡會補資產前綴,不要在元件端再補一次(R1 must-fix):OD `brand-focus-data.js`
   *    的 20 家 photo 都是 repo 相對路徑 `assets/brands-prod/<slug>/x.jpg`,而本 repo
   *    一律過 `lib/brand-asset.ts` 的 `brandAsset()` 補 `/brand-assets/`。D5e-1 的唯一那筆
   *    是絕對 URL(unsplash)⇒ **這個缺口在本片看不出來**,D5e-2 搬完 20 家會全部破圖。
   *    所以現在就在解析端收掉:非 `http(s)`/非 `/` 開頭者視為 repo 相對路徑、補前綴。
   */
  photo: string | null;
};

/**
 * 解出當期要顯示的品牌。
 *
 * @param override 指定 slug 就固定顯示它、跳過輪播(OD `PCM_BRAND_FOCUS_OVERRIDE` 同款機制)。
 *   🔴 **D5e-1 目前就是靠它把當期釘在 RIZOMA** —— 20 家文案(D5e-2)落地前,
 *   讓輪播真的轉起來會轉出 19 家只有 fallback 標題的版位。override 指到不存在的 slug
 *   時**退回輪播**、不是回 `null`(打錯字不該讓整個版位消失)。
 *
 * 回 `null` = 沒有任何可用品牌(呼叫端不渲染這一段)。
 */
export function resolveBrandFocus({
  brands,
  overlays,
  now,
  override,
}: {
  brands: readonly BrandContent[];
  overlays: Readonly<Record<string, BrandFocusOverlay>>;
  now: Date;
  override?: string;
}): ResolvedBrandFocus | null {
  // OD 逐字:`filter(b => b.focus && b.focus.enabled).sort((a,b) => a.focus.order - b.focus.order)`
  // 🔴 `sort` 是**就地**排序,而 `brands` 傳進來的是 `BRAND_CONTENT` 這個模組單例 ——
  //    直接 `brands.sort(...)` 會把全站共用的那份資料順序改掉(品牌頁、/brands 總覽都吃它)。
  //    這裡安全是因為 `filter` 已經回了一個新陣列,`sort` 動的是那份複本。
  //    ⚠️ 所以 `filter` 是**承重的**:哪天有人「優化」成不 filter 直接 sort,就會踩到。
  //    守門在 `brand-focus.test.ts` 的「不得就地排序」那條(對該改法實測會紅)。
  const pool = brands.filter((b) => b.focus?.enabled).sort((a, b) => a.focus.order - b.focus.order);
  if (pool.length === 0) return null;

  const pinned = override ? pool.find((b) => b.slug === override) : undefined;
  const brand = pinned ?? pool[focusRotationIndex(now, pool.length)]!;
  const overlay = overlays[brand.slug];

  return {
    slug: brand.slug,
    name: brand.name,
    title: overlay?.title ?? brand.name,
    body: overlay?.body ?? brand.lede,
    caption: brand.origin,
    facts: overlay?.facts ?? brand.facts.slice(0, 3).map(factToPair),
    // OD 逐字 `brand.categories.map(([name]) => name)`。順序照資料檔、不排序
    // —— 那個順序是品牌頁那邊維護的,兩處顯示同一批東西時不該各排各的。
    categories: brand.categories.map(([name]) => name),
    photo: overlay?.photo ? resolvePhotoSrc(overlay.photo) : null,
  };
}

/**
 * 把 overlay 的 `photo` 變成可直接餵 `src` 的網址。
 *
 * 絕對網址(`http://` / `https://`)與已經是站內絕對路徑(`/` 開頭)的原樣放行;
 * 其餘視為 OD 那份資料的 repo 相對路徑(`assets/…`)⇒ 補 `/brand-assets/` 前綴。
 */
function resolvePhotoSrc(photo: string): string {
  if (/^https?:\/\//.test(photo) || photo.startsWith('/')) return photo;
  return brandAsset(photo);
}

/** `BrandFact` 是 [標籤, 值, 小註] 三元組;版位只要前兩欄(OD 逐字:說明句留在品牌頁)。 */
function factToPair(fact: BrandFact): readonly [string, string] {
  return [fact[0], fact[1]] as const;
}
