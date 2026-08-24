import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// manual-order-catalog.ts — M12-A3-a:手動建單表單的品項選擇器**唯一讀取端**。
//
// ── 🔴 為什麼只讀 `price_general`,一個字都不碰 `price_store` ───────────────────
//   **這不是技術取捨,是一道 Sean 拍過的凍結。**
//   `memory project_0815-evening-seven-rulings.md:16,26` 逐字:
//     「② Q-經銷價 **甲** = 先做 `#215`(經銷價 tier 改 server 端驗)」
//     「拍甲 ⇒ **原價欄那片維持凍結**,`#215` 排在它前面」
//   ⇒ 在這裡讀 `price_store`,會讓手動建單表單變成全站**唯一**一條經銷定價路徑
//     (量法:`git grep -n "price_store" -- apps/admin/src packages/domain/src | grep -v test`
//      ⇒ 命中全是**防洩漏註解與守門**,零個「拿它定價」的呼叫端;2026-08-24 當場量)
//   ⇒ 那等於繞過那道凍結去做被排在後面的工作。**不是本片可以拍的板。**
//
// ── 🔴 而「定價責任在誰身上」這件事,RPC 那側講得很清楚 ────────────────────────
//   `20260824020000_m4b_858_admin_create_manual_order.sql:362` 逐字:
//     `v_unit_price := NULLIF(v_line ->> 'unit_price', '')::integer;`
//   ⇒ RPC **不自己查價**。它的「server 自算金額」指的是自己算
//     `subtotal = Σ qty × unit_price`(`:429-431` 含溢位守),**不是**去 DB 查價。
//   ⇒ **單價從頭到尾是輸入。** 本函式給的是一個**建議值**,不是一個不能動的價 ——
//     表單上那一格員工可以改,而那正是手動單的用途(代購品項連 `variant_id` 都是
//     `NULL`,RPC `:368` 明文允許)。
//   ✅ **Sean 2026-08-24 拍板:甲 —— 照網站一般價,要打折員工自己改那一格。**
//     🔴 **而他是【知道代價】才選的,不是因為「照一般價比較安全」** ——
//     端給他的那一句裡逐字附著:
//       「⚠️ 甲的代價:員工打錯價 = 直接影響金額,**沒有第二道會擋**」
//     ⇒ 那個殘餘風險是**他認列的**,不是本檔自己吞掉的。
//     (落檔:`memory/project_0824-sean-manual-order-price-general-only.md`;
//      🔴 `#215` 落地之前**不要再拿這題去問他**。)
//
// ── ⚠️ 本片只做 SKU 比對,**不做商品名搜尋** ─────────────────────────────────
//   理由:名稱住在 `products`,對內嵌關聯下 filter 要 `!inner` 那一套機制,
//   而本片的用途是「員工手上有料號」。**名稱搜尋要做的話是另一片**,不在這裡偷偷長出來。
//   既有的 `buildProductKeywordOrFilter`(`products/product-repository.ts:223`)是給
//   `products` 表用的,直接搬過來會對到錯的表。

/**
 * 🔴 逐欄指名。**不得改成 `*`**,也不得加入 `price_store` / `price_by_tier` / `cost` /
 * `metadata` 任一欄。這串字面被 `manual-order-catalog.test.ts` **逐字**釘住 ——
 * 釘整串的用途是:任何人加欄都會撞紅,被迫回來想一次「這欄該不該進建單表單」。
 */
export const MANUAL_ORDER_CATALOG_COLUMNS = 'id, sku, price_general, products(title)' as const;

/**
 * 回傳筆數上限。
 * 🔴 **上限只設在這裡一處** —— 兩個地方各設一個,改一邊的那天不會有東西紅
 * (理由逐字同 `product-repository.ts:290-292` 的 `MAX_SKU_COUNT`)。
 */
export const MANUAL_ORDER_CATALOG_LIMIT = 20;

export type ManualOrderCatalogHit = {
  variantId: string;
  sku: string;
  /** 商品名。🔴 關聯讀不到時給 `''` 而不是丟掉這一列 —— 見 `unitPrice` 那段的同款理由。 */
  title: string;
  /**
   * 建議單價(元,整數)。
   * 🔴 **`null` = 這個變體存在,但沒有定價** —— **不得因此把它從結果裡拿掉**。
   *    靜默跳過會讓員工以為「這個料號不存在」,而它存在、只是沒定價
   *    ⇒ 兩個不同的世界不得印同一個畫面。表單那一側要為 `null` 出一句話。
   */
  unitPrice: number | null;
};

/** supabase 內嵌 to-one 在型別上可能是物件或 null;只取 `title`。 */
function readTitle(products: unknown): string {
  if (typeof products !== 'object' || products === null || Array.isArray(products)) return '';
  const raw = (products as { title?: unknown }).title;
  return typeof raw === 'string' ? raw : '';
}

/**
 * 依料號找變體。**回空陣列是一個合法答案**(= 這個料號一個都沒有)。
 *
 * 🔴 **出錯【不得】回空陣列** —— 那會把「查詢失敗」顯示成「查無此料號」,而兩者要分得開:
 *    前者他該找人,後者他該改關鍵字。往上丟,由頁面那層顯示載入失敗。
 *    (形狀逐字同 `product-repository.ts:299-300` 的 `resolveProductIdsBySkus`。)
 *
 * 🔴 空關鍵字**直接回空、不打 DB**:`ilike '%%'` 會掃全表,而那不是「查無」是「查全部」。
 */
export async function searchManualOrderCatalog(
  keyword: string,
): Promise<ManualOrderCatalogHit[]> {
  const needle = keyword.trim();
  if (needle === '') return [];

  const { data, error } = await createSupabaseServiceClient()
    .from('product_variants')
    .select(MANUAL_ORDER_CATALOG_COLUMNS)
    // 🔴 `%` 與 `_` 是 `ilike` 的萬用字元 ⇒ 員工打 `%` 會變成「全部」。逃脫掉。
    //    `\` 本身也要先逃脫,否則 `\%` 會被拆成兩件事。
    .ilike('sku', `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
    .order('sku', { ascending: true })
    .limit(MANUAL_ORDER_CATALOG_LIMIT);

  if (error) throw new Error(`searchManualOrderCatalog 失敗: ${error.message}`);

  return (data ?? []).map((row) => ({
    variantId: row.id,
    sku: row.sku,
    title: readTitle(row.products),
    unitPrice: row.price_general,
  }));
}
