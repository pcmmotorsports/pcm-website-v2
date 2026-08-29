import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// manual-order-catalog.ts — M12-A3-a:手動建單表單的品項選擇器**唯一讀取端**。
//
// ── 🔴 為什麼只讀 `price_general`,一個字都不碰 `price_store` ───────────────────
//   **這不是技術取捨,是一道 Sean 拍過的凍結。**
//
// 🔴🔴 **2026-08-28 更新:那道凍結【仍然在】,而它現在有一個【解凍條件】了。**
//   ⛔ ~~原本這段讀起來像永久規則(下面那句「不是本片可以拍的板」)~~
//   兩次拍板的時間軸,兩個日期都要留著,因為**答案相反而兩次都算數**:
//     · **2026-08-24 Sean 拍甲** = 照網站一般價,要打折員工自己改那一格
//       (`memory/project_0824-sean-manual-order-price-general-only.md`;代價寫在題目裡,他知道)
//     · **2026-08-28 Sean 拍乙** = 系統自動帶經銷價 ⇒ **推翻 08-24 那一板**
//       🔴 而這一次的題目裡**逐字附了前提**:「你 08-24 被問過同一題,你答甲」
//       「乙要先做 `#215`,否則後台建單會變成全站唯一一條經銷定價路徑」「選乙 = 片C 今天做不完」
//       ⇒ **他是在知道自己拍過甲、也知道代價之下推翻的** ⇒ 這一板算數。
//   ⚠️ **而「拍板推翻了」不等於「現在可以改這支檔」。**
//
//   🔴🔴 **而【解凍條件不是 `#215`】—— 我第一版就是這樣寫的,而它是錯的,同一小時內自己抓到。**
//     `#215` **早就做完了**:落點 `218ae7a4`(2026-08-23,`git merge-base --is-ancestor` 驗過
//     它是 `origin/dev` 的祖先;負對照 編造的 hash ⇒ unknown revision)。
//     ⇒ 上面那句「`#215` 排在它前面」是 **2026-08-24 寫的,而它在寫下的當天就已經過期**
//       —— `#215` 前一天就落地了。
//     📌 **形狀:一個【當時正確】的前置條件, 在它被寫進註解之後就完成了, 而註解不會知道。**
//        我照著它寫下「解凍條件 = `#215`」⇒ **等於把一個已經滿足的條件寫成還沒滿足。**
//
//   ✅ **真正還沒發生的那件事是這個**(2026-08-28 12:3x 量):
//     **經銷價從來沒有在任何地方生效過。**
//       · `apps/admin/src/components/customers/tier-edit-form.tsx` 逐字:
//         `footerHint='變更會寫入稽核紀錄;價格生效待經銷價上線。'`
//       · `price_store` 在全 repo 的**非測試生產碼**裡零個「拿它定價」的呼叫端
//         (命中全是防洩漏守門與測試;唯一的非測試生產碼是 `mappers/product.ts` 的**寫入**那一側)
//     ⇒ 所以做乙 = **讓後台建單成為全站第一條、也是唯一一條讓經銷價生效的路。**
//     ⇒ **那不是本檔可以自己決定的範圍** —— 而它現在缺的是一個【經銷價上線】的決定與設計,
//       不是一個編號。**在那之前本檔一個欄位都不動。**
//
//   ⚠️ 🔴 **同日量到、而 `#215` 一定會撞到的一格**:
//     ⛔ ~~**全 repo 沒有任何一處說過經銷價是含稅還是未稅。**~~
//     ✅ **2026-08-29 訂正:那句【自此不成立】。答案 = `general` 含稅 / `store` 未稅。**
//        **落點 = `packages/domain/src/catalog/types.ts` 的 `PriceByTier` 上方(含完整論證與時態)。**
//        來源 = memory `project_0829-pricing-tax-convention`,Sean 2026-08-29 逐字
//        「網站售價都含稅沒問題,但是經銷價都是未稅。」
//     🔴 **原句與下面那份量測【刻意保留, 不刪】—— 兩個理由:**
//        ① 那份量測**量於 2026-08-28 12:37,而它當時是【對的】** ⇒ 這不是「有人量錯」,
//           是**一個正確的量測, 活得比它的世界久**。
//        ② repo 現在仍然可能撈不到那個字面 ⇒ **下一個人重量會再得到一次 0** ——
//           保留原句才擋得住他把那個 0 讀成「所以還沒有人說過」。
//     🔴🔴 **而這是一種【新的過期方式】, 值得認得**(主視窗 `-06` 2026-08-29 裁定寫進來):
//        一般的過期 = 東西被【修】掉了, 而註解還說它壞著 ⇒ **修改會出現在 diff 裡**。
//        這一次 = 缺口是被【回答】掉的 —— Sean 在對話裡講了一句話,
//        而本檔【沒有任何機制知道那件事發生過】⇒ **在 repo 裡那是零事件。**
//        📌 **⇒ 所以「拍板落檔」不是行政流程, 它是【唯一會讓那句話變成可偵測事件的動作】。**
//     ⚠️ **而下面那三個漂亮的數字(0 / 0 / 0 + 負對照)正是它最危險的地方** ——
//        它們寫得比周圍任何一句都有說服力 ⇒ **讀到的人會因此停止查證。**
//     量法(2026-08-28 12:37 實跑,分母 = `apps/*/src` `packages/*/src` `docs`
//     `supabase/migrations` `design-reference`,排除 `node_modules` 與 `.next`):
//       `經銷價.*含稅` ⇒ 0 · `經銷價.*未稅` ⇒ 0 · `price_store.*稅` ⇒ 0
//       負對照(同分母)`含稅` ⇒ 21 · `price_store` ⇒ 522 · 編造的字 ⇒ 0 ⇒ **尺是活的**
//     🔴 而**一般價是含稅的**(顧客站 `ProductInfo.tsx` 逐字「含稅 · 滿 NT$ 5,000 免運」)
//        ⇒ **不得把那個結論沿用到經銷價** —— 那一頁自己的註解逐字
//          「詳情頁釘 general、tier 經銷分支 general 不觸發」⇒ **經銷價沒有顯示在那一頁上。**
//        📌 形狀:**一個正確的證據,被套在它沒有涵蓋的對象上。**兩個都對的東西放在一起,
//           會產生一個沒有人寫過的第三個宣稱。
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
