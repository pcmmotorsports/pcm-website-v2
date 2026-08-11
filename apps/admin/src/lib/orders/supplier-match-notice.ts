// supplier-match-notice.ts — #338:供應商單號搜尋的「這是哪一家」提示(純函式,無 IO)。
//
// 🔴 **為什麼要這個東西**:`supplier_order_no` 在 DB 層**沒有跨供應商唯一性**
//    (A2 `20260729020000:70` 的業務鍵是 `(order_item_id, supplier_canonical_key)`)
//    ⇒ 兩家用同一組單號時,搜尋結果會把兩家的訂單一起列出。
//    而員工**正是因為不知道是哪一家才來搜**(供應商寄來一張單號、他回後台找單)
//    ⇒ 舊做法那句常駐警語「請先點進訂單核對供應商」等於**把唯一能回答問題的資料藏起來**。
//
// 🔴 **不假裝知道**:認不出供應商時(一列都認不出 / 有任何一家沒有名字)一律退回原本那句警語。
//    少報一家的傷害正是本條 backlog 要修的東西 —— 員工看到「只有 A 家」就放心登錄,而實際上還有 B 家。

/** 提示的四種形狀;`none` = 不顯示任何東西。 */
export type SupplierMatchNotice =
  | { kind: 'none' }
  /** 恰一家、而且叫得出名字 ⇒ 直接回答問題,不必點進去。 */
  | { kind: 'single'; label: string }
  /** 兩家以上、而且全部叫得出名字 ⇒ 示警並列名(這才是真的會出事的情況)。 */
  | { kind: 'multiple'; labels: string[] }
  /** 認不出來 ⇒ 退回「此搜尋不區分供應商」那句常駐警語。 */
  | { kind: 'unknown' };

/**
 * @param suppliers adapter 回的命中供應商;`null` = **這次不是供應商單號搜尋**
 *                  (與 `[]` = 查過了但一家都認不出來 **不可互換**,見 domain docstring)。
 * @param hasResults 畫面上有沒有列出訂單。零筆時不顯示任何提示 —— 那時該說話的是「查無此單」那條路徑。
 */
export function describeSupplierMatch(
  suppliers: { id: string; label: string | null }[] | null,
  hasResults: boolean,
): SupplierMatchNotice {
  if (suppliers === null || !hasResults) return { kind: 'none' };
  // 🔴 有**任何一家**沒有名字就整組退成 unknown ——「A 家與另一家(未知)」這種半吊子顯示
  //    比警語更糟:它看起來像資訊,卻沒告訴員工那個未知的是誰。
  if (suppliers.length === 0 || suppliers.some((s) => s.label === null)) return { kind: 'unknown' };
  const labels = suppliers.map((s) => s.label as string);
  return labels.length === 1 ? { kind: 'single', label: labels[0]! } : { kind: 'multiple', labels };
}
