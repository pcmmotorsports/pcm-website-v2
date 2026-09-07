/**
 * 經銷價接線的【停法】—— 三個值,不是三段散在各處的 prose。
 *
 * 🔴 **為什麼是一個 enum 而不是幾句註解**(2026-09-07 `-auth`,主視窗 B 裁「換載體」):
 *   這件事的規則在 plan 裡改了七輪,而 R6 / R7 兩輪連續抓到的都是**同一層**的問題 ——
 *   「一段寫著 abort、另一段寫著不得 abort」。📌 **prose 不會因為互斥而紅。**
 *   ⇒ 把停法寫成**一個封閉集合**,每個觸發條件配一格測試 ⇒ **互斥在測試上直接紅**,
 *     而且下一個人**不可能在別的地方再發明第四種停法**。
 *
 * 🛑 **B 型(停整支 job)刻意【不在這個集合裡】** —— 經銷價的任何情況都不得停掉共用管線
 *   (會連 `price_general`、新品、下架對賬一起停;而告警只有寄給上次改本檔者的預設 email)。
 *   ⇒ 想加第四個值之前:那正是本檔存在要擋的事。
 */

/** 這一家這一輪,經銷價那一半怎麼處理。 */
export type DealerPriceGateAction =
  /** 上游有問題,而**本站舊值讀得到** ⇒ 那一家全部帶舊值(每列都把 `price_store` 鍵帶上、值 = 本站現值)。
   *  🔵 與「不在 allowlist 名單的家」走同一條路 —— 少一個概念、少一個實作分歧點。
   *  其餘同步(price_general / 新品 / 下架對賬)照常完成。 */
  | 'A1_carry_old'
  /** **本站舊值讀不到、或本站鍵不可信** ⇒ 那一家這一輪整個變體同步跳過(不呼叫變體同步 RPC)。
   *  🔴 這一種**不能帶舊值** —— 我們手上根本沒有那些舊值;而送不出鍵 = NULL = 清價。
   *  🛑 代價要講全:整家變體同步跳過 ⇒ **該家當天的新品變體也不建、孤兒也不處理**,順延隔天。
   *     比另一個選項(送 NULL 清價)小得多,而**不是零代價**。 */
  | 'A2_skip_family'
  /** 資料長得怪,而不是我們算錯 ⇒ 照常寫,只把可疑的列印出來。 */
  | 'report_only';

/** 觸發條件。**一個條件只能對到一個動作** —— 這就是互斥被釘住的地方。 */
export type DealerPriceGateReason =
  | 'upstream_key_not_unique' // 上游 dealer_price_v 的 (supplier_slug, sku) 不唯一
  | 'illegal_key' // 空字串 / 純空白 / 前後空白 / supplier_slug 不符
  | 'missing_over_threshold' // 既有而來源整列消失 > 該家本站變體數 5%
  | 'checksum_mismatch' // 核准的那批與這次讀到的不同
  | 'old_values_read_short' // 本站現值讀取筆數 ≠ 該家本站變體數
  | 'local_key_not_unique' // 本站 (supplier_slug, sku) 不唯一
  | 'missing_upstream_url' // 在 allowlist 而缺 DEALER_PRICE_DATABASE_URL
  | 'value_out_of_range'; // price_store > price_general / 折數落在 0.76-0.90 之外 / <= 0

/**
 * 觸發條件 → 動作。
 *
 * 🔴 **判準只有一句**:**這時候我們手上還有沒有本站舊值可以送?**
 *   有 ⇒ `A1_carry_old`(帶舊值,其餘照常)
 *   沒有 ⇒ `A2_skip_family`(整家變體同步跳過)
 *   而值域類根本不影響「送什麼」⇒ `report_only`
 */
export const DEALER_PRICE_GATE: Readonly<Record<DealerPriceGateReason, DealerPriceGateAction>> = {
  upstream_key_not_unique: 'A1_carry_old',
  illegal_key: 'A1_carry_old',
  missing_over_threshold: 'A1_carry_old',
  checksum_mismatch: 'A1_carry_old',
  old_values_read_short: 'A2_skip_family',
  local_key_not_unique: 'A2_skip_family',
  missing_upstream_url: 'A2_skip_family',
  value_out_of_range: 'report_only',
};

/**
 * 多個條件同時命中時的收斂:取**最保守**的那一個。
 * 🔴 `A2_skip_family` > `A1_carry_old` > `report_only` —— 順序寫死在這裡,不散在呼叫端。
 */
export function resolveGate(reasons: readonly DealerPriceGateReason[]): DealerPriceGateAction | null {
  if (reasons.length === 0) return null; // 沒有任何條件命中 = 正常寫入
  const actions = new Set(reasons.map((r) => DEALER_PRICE_GATE[r]));
  if (actions.has('A2_skip_family')) return 'A2_skip_family';
  if (actions.has('A1_carry_old')) return 'A1_carry_old';
  return 'report_only';
}

/** 這一輪的結果標籤 —— `A2_skip_family` 命中過就不得報「成功」。 */
export function runOutcome(action: DealerPriceGateAction | null): 'success' | 'degraded' {
  return action === 'A2_skip_family' ? 'degraded' : 'success';
}
