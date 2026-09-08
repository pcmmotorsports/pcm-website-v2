// brand-products.ts — 品牌介紹頁商品區的資料來源(D3b;2026-08-04)
//
// 為什麼抽成一支:route(`app/brands/[slug]/page.tsx`)與 dev-preview 兩個掛載點都要撈,
// 而「撈幾筆、怎麼排、用哪個 slug 當篩選鍵」必須是同一份答案 —— 兩邊各寫一次的話,
// 預覽看到的排序與正式站不同,而版面問題正是靠預覽發現的。
//
// 🔴 資料**不是 snapshot**:走與 `/products` 完全同一支 `fetchCatalogPage`
//    (`search_catalog_by_vehicle` RPC → `products_list_public` view)。
//    既有的 `dev-preview/brands/[slug]` 用的是 `BRAND_FIXTURES` 靜態快照(計畫 §5.3 註記),
//    那是舊 showcase 線的東西,本線不沿用。
//
// 🔴 `perPage: BRAND_PRODUCT_SLOTS`(2026-08-07 R-2 起 = **10**,原為 5)是白名單外的值,
//    但**不是特殊路徑**(信箱 C-26-A 特別要求確認):
//    `CATALOG_PER_PAGE_VALUES`([25,50,75,100])只在 `parseCatalogQuery` 把關**使用者輸入**;
//    本檔是自己組 `CatalogQuery` 物件,不經過那道。RPC 側對 `p_limit` 的處理是
//    `LIMIT LEAST(GREATEST(p_limit, 1), 100)`(migration `20260719150000_catalog_product_image_trim.sql:110,172`)
//    ⇒ **10(以及原本的 5)都落在 [1,100] 內**、被原值採用,與白名單值走的是同一條 SQL、無 clamp、無降級。
//    ⚠️ 這段的論證不綁死某個數字,但**改常數時要回來確認它仍在 [1,100]**。
//
// ⚠️ 每個品牌會多出一組 `unstable_cache` 鍵(key = `JSON.stringify(query)`,見 `lib/products.ts`)。
//    20 家 × 一組、每組 **10 筆**(R-2 起;原 5 筆)卡片 DTO,離單條 2MB 上限仍很遠
//    (memory `reference_next16-unstable-cache-force-dynamic-2mb`)。

import type { CatalogCardProduct } from '@/lib/catalog-page';
import type { MemberTier } from '@pcm/domain';

import { fetchCatalogPage, tryCatalogBrandTaxonomy } from '@/lib/products';
import { BRAND_PRODUCT_SLOTS } from '@/lib/brand-url';

/**
 * 「哪幾家有商品」的答案 + 「這個答案是不是讀不到」。
 *
 * 🔴 `loadFailed` 是顯示端判斷「要不要說話」的**唯一**依據,不准自己再組一次
 *    (形狀抄 `apps/admin/src/lib/dashboard/freshness-read.ts` 的 `unreadableReason`:
 *     文字層與顏色層各判一次同一件事 ⇒ 它們一定會漂開)。
 */
export type BrandAvailability = {
  /** 目錄裡真的有商品(`count > 0`)的品牌 slug。**失敗時是空集合**,見 `loadFailed`。 */
  slugs: ReadonlySet<string>;
  /** `true` = 撈失敗(≠ 真的零商品)。顯示端據此多印一句,而磚牆照樣泛白。 */
  loadFailed: boolean;
};


/** `fetchBrandTopProducts` 的回傳。形狀刻意抄本檔 `BrandAvailability`:**兩件事分兩個欄位。** */
export type BrandTopProducts = {
  /** 該品牌的前 N 筆商品(推薦序)。**撈失敗時是空陣列**, 見 `loadFailed`。 */
  products: CatalogCardProduct[];
  /** `true` = 撈失敗(≠ 這家真的 0 件)。顯示端據此印錯誤文案, 而不是整區消失。 */
  loadFailed: boolean;
};

/**
 * 該品牌的前 N 筆商品(推薦序)。
 *
 * 🔴 **0 筆與撈失敗是兩件事, 而它們曾經回同一個東西**(2026-09-08 codex must-fix, 詳下方 return 那段):
 *    · 0 筆    ⇒ `{ products: [], loadFailed: false }` ⇒ 呼叫端**整區不渲染**、不留空骨架
 *              (計畫 §7 R7:版面要容忍空槽、不得寫死假值)。
 *    · 撈失敗  ⇒ `{ products: [], loadFailed: true }`  ⇒ 呼叫端印錯誤文案(rail 的 `errorText`)。
 *    ⛔ ~~「撈不到或出錯**一律**回空陣列 —— 呼叫端據此整區不渲染」~~ 🔴 **那句 2026-09-08 起不成立。**
 *
 * 🔴 目前 20 家裡有 5 家在目錄中是 0 筆(dbk / gilles / kineo / rizoma / wrs,2026-08-04 實測),
 *    ⚠️ **2026-09-08 這份名單至少有一項已經過期**:`wrs` 的首灌當天跑完了
 *      (副手窗 B 的推前預告逐字「WRS 首灌已跑完 = 是(624 商品 / 1207 變體)」——
 *       🔴 **那是【轉述來的】, 我沒有自己查正式庫**)。**其餘四家未複量。**
 *    📌 名單帶著它的量測日期是對的, 而**帶日期不會讓它自己更新** —— 引用前先重數。
 *    ⇒ 這條路徑**真的會走到**,不是理論分支。那 5 家的品牌頁怎麼呈現待 Sean 拍(backlog #315)。
 */
export async function fetchBrandTopProducts(
  brandSlug: string,
  /**
   * ⟦front-CATALOGPRICEGENERALONLY⟧ 呼叫端解析好的會員身分。**必填, 同 `fetchCatalogPage`。**
   * 🔴 **不在這支裡自己解析** —— 本檔被兩個 route 換掉(正式 `/brands/[slug]` 與 dev-preview),
   *    而它們對「這一頁要不要看身分」的答案不同 ⇒ 選擇歸呼叫端。
   * 🛑 **而它是必填而不是 `= 'general'` 預設值**:預設值讓下一個新 route
   *    【什麼都不寫】就能編譯過 ⇒ 那正是 2026-09-08 品牌頁漏掉的那個形狀。
   */
  tier: MemberTier,
): Promise<BrandTopProducts> {
  const { products, error } = await fetchCatalogPage(
    {
      page: 1,
      perPage: BRAND_PRODUCT_SLOTS,
      sort: 'recommend',
      brandSlugs: [brandSlug],
      // ⟦M-4b 多顆分類膠囊⟧ 品牌頁不帶分類 ⇒ 空陣列(不是 undefined:那個欄位是必填, 讓漏掉的人被 typecheck 抓到)。
      categories: [],
    },
    // 品牌頁不吃車款篩選 ⇒ vehicle = null。
    null,
    tier,
  );
  // 🔴🔴 **[2026-09-08 codex must-fix:`error` 被壓成空陣列 ⇒ 經銷 RPC 掛掉會【無聲消失】]**
  //   ⛔ ~~`if (error) return [];`~~ —— 它讓「撈失敗」與「這家真的 0 件」回同一個東西,
  //     而 `BrandPageProducts` 對 0 筆的處置是**整區不 render** ⇒ 頁面 200、看起來一切正常。
  //   🛑 **而本片讓這條路【新增了一個會失敗的理由】**:經銷會員現在會走 `search_catalog_by_vehicle_dealer`,
  //     而 `lib/products.ts` 對那支的失敗**刻意選了吵**(逐字「⇒ 頁面走既有的錯誤狀態。**吵、看得見。**」)
  //     ⇒ 📌 **上游決定要吵, 而我在下游把它壓回安靜了。**
  //   ✅ 修法 = 照本檔 `BrandAvailability` 既有的形狀, 把「是哪一種」帶出去。
  //     🔵 **不是新發明**:`BrandPageProducts` 那顆 `ProductRail` **早就傳了 `errorText`**,
  //       而它旁邊逐字寫著「`errorText` 在本頁結構性不可達 … 哪天取數鏈改成會回報錯誤,
  //       這裡就立刻是對的」⇒ **本片就是那個「哪天」。**
  //     🔵 首頁與會員中心的 rail 本來就會印錯誤文案 ⇒ 這一改是**收斂**三區行為, 不是新增第四種。
  return { products: error ? [] : products, loadFailed: error };
}

/**
 * 目錄裡**真的有商品**的品牌 slug 集合。
 *
 * 用途 = Sean 2026-08-04 拍板(信箱 `C-31-A`,取代 #315 Q1 的三選項):20 家品牌頁全部上線,
 * 但**目錄零商品的那幾家,磚牆與總覽卡要泛白且不可點** —— 判斷「哪幾家」就靠這支。
 *
 * 🔴 **由真資料衍生、不寫死名單**(拍板備註逐字建議):商品一上架,那家的磚下次 render
 *    就自動恢復可點;寫死名單的話得有人記得回來改,而「記得」正是本專案一直在輸的東西。
 * 🔴 資料源 `catalog_brand_counts` 與 `/products` 側欄**同一支**(線E 起本檔走 `tryCatalogBrandTaxonomy`,
 *    而它與 `fetchCatalogBrandTaxonomy` **共用同一層 `unstable_cache`** ⇒ 實質仍是同一份資料)
 *    ⇒ 品牌頁的「可不可點」與目錄的「篩不篩得到」不會各自漂移。
 *    2026-08-04 實測回 16 家(含一個 `pcm` 測試品牌);20 家品牌頁裡有 5 家不在其中:
 *    `dbk` / `gilles` / `kineo` / `rizoma` / `wrs`。
 *
 * 🔴 **回傳帶 `loadFailed`**(線E,2026-08-27):`slugs` 空集合有**兩個原因** ——
 *    ①目錄真的每家都 0 件 ②`catalog_brand_counts` 撈失敗(fail-closed)。
 *    這兩件在畫面上都是「整面泛白」,而客人分不出來、我們也看不出哪一種發生了。
 *    ⇒ **泛白那半不動**(Sean 2026-08-04 拍板)、**fail-closed 方向不翻**(見下),
 *      只把「是哪一種」帶出去,讓顯示端多說一句話。
 *    (同一句判別句 `contexts/FavoritesContext.tsx:50` 逐字寫過,標 `MAIN-035 ①-1`【必修】:
 *     「『讀不到』與『沒有收藏』必須是兩個畫面」。)
 *
 * ⚠️ **失敗時回空集合 = 全部當成「沒有商品」**(fail-closed)。
 *    反過來(失敗時全部放行)會讓 DB 一抖就把 5 個**空入口**放出去,而那正是本次要修掉的東西;
 *    ⚠️ 用詞:那 5 磚指向的 `/brands/<slug>` **會正常渲染、不是 404**(關卡2 R1/R2 nit 更正
 *    ——「死連結」是錯的字);壞的是進去之後零商品、而頁上兩顆 CTA 再動一下篩選就滑成全站目錄。
 *    失敗時全部泛白雖然難看,但**不會把客人送到錯的頁面**。這是刻意的方向選擇,不是省事。
 */
export async function fetchBrandsWithProducts(): Promise<BrandAvailability> {
  const { brands, failed } = await tryCatalogBrandTaxonomy();
  // 🔴 這一行**一個字都沒動**:`count > 0` 才算有商品,是 Sean 2026-08-04 的拍板結果。
  //    失敗時 `brands` 是 `[]` ⇒ 集合仍是空的 ⇒ 全部泛白 ⇒ fail-closed 行為 byte 不變。
  return { slugs: new Set(brands.filter((b) => b.count > 0).map((b) => b.id)), loadFailed: failed };
}
