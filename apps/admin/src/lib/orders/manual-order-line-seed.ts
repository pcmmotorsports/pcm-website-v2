// manual-order-line-seed.ts — 「查商品 ⇒ 點一下加成一列」的**事件契約**(⟦b4-建單加成一列⟧ 2026-09-06)
//
// ══ 🔴 為什麼是「事件」而不是直接寫進表單 ═══════════════════════════════════
// plan 比較過三種載體, 兩種會**把員工已經打的東西清掉**:
//   ⛔ 甲 server action + PRG 重渲染 ⇒ 導頁 = 已填的客人 / 運費 / 收件**全清**
//   ⛔ 丙 `useActionState` / `formAction` 在主表單裡 ⇒ React 19 action 完成會 **reset 整張表單**
//      (`manual-order-lines.tsx:41` 與 picker 檔頭都各自記著這條血)
//   ⛔ 乙 lookup 自己 append 一段含 `name=` 的 DOM ⇒ 解析器要求 `_0.._n` **連號**
//      (`manual-order-form.ts:339-347`)⇒ 兩支元件各自算 index **必撞** ⇒ 整張表單被拒
// ✅ **選:列的那一側持有 seed, 查詢那一側只丟事件。** index 只有一個持有者。
//
// 🛑 **而 `ManualOrderLines` 有一條不變式**(三道原始碼層守門在守它,
//    `manual-order-lines.test.tsx:105-121`):**送出的值不由 client state 產生或回寫**。
//    ⇒ 📌 seed 只准走 `defaultValue=`(瀏覽器自己拿, 之後員工改什麼就是什麼),
//      **不得**出現 `value=` / `onChange` / `.value =` —— 那會讓「畫面上的值」與
//      「送出去的值」變成兩個真相, 而它們哪一個進 DB 由 React 決定。

/** 事件名。🔵 用 `CustomEvent` 而不是 context/prop:兩支元件在版面上是兄弟, 沒有共同的父層可掛。 */
export const MANUAL_ORDER_LINE_SEED_EVENT = 'pcm:manual-order-line-seed';

/**
 * 一列的種子值。**每一個欄位都是字串**(表單的世界), 而不是數字 ——
 * 🔴 轉型交給既有的解析器 `manual-order-form.ts`, 這裡多做一次會生出第二套規則。
 */
export type ManualOrderLineSeed = {
  sku: string;
  title: string;
  /** 恆為 `'1'` —— 員工要幾個自己改。🔵 種 `''` 的話他得多打一個字, 而 1 是絕大多數。 */
  qty: string;
  /**
   * 🔴 種的是**經銷未稅價**(`dealerPriceUntaxed`), 不是 `unitPrice`(含稅)——
   * 畫面那句橘字逐字是「單價這一格請填**未稅**」, 而建單 RPC 已經是第 6 代、自己算稅。
   * 🛑 `null`(沒有經銷價)⇒ 種 `''`, 並在那一筆旁邊說一句, **不得靜默種 0**:
   *    0 是一個合法的價格, 它會安靜地變成一張零元的單。
   */
  unitPrice: string;
  /** 商品編號(型錄品項才有;代購留白)。 */
  variantId: string;
};

/** 從查詢結果丟出去。🔵 `window` 上派發 —— 兩支元件是兄弟, 沒有共同父層。 */
export function emitManualOrderLineSeed(seed: ManualOrderLineSeed): void {
  window.dispatchEvent(
    new CustomEvent<ManualOrderLineSeed>(MANUAL_ORDER_LINE_SEED_EVENT, { detail: seed }),
  );
}
