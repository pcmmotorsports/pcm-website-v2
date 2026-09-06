/**
 * Currency: PCM 支援幣別。
 *
 * Phase 1 + Phase 2 PRD 範圍只支援 TWD;
 * 拍板 P1=改'TWD'單一(YAGNI、未來加幣別改一字、零成本、不需預留)。
 */
export type Currency = 'TWD';

/**
 * MoneyAmount: brand type 守門金額。
 *
 * 對齊 ADR-0004 Q4=A3 + docs/patterns/money-handling.md §1.1:
 * - number 子類、JSON 序列化直接出 int
 * - 必為整數(浮點誤差防呆)、必為非負
 * - 強制走 toMoneyAmount() helper 集中守門、不允許 `as MoneyAmount` 強轉
 */
export type MoneyAmount = number & { readonly __brand: 'MoneyAmount' };

/**
 * Money: 金額 value-object。
 *
 * 對齊 CLAUDE.md「Server 端鐵則」精神:整數運算、避免浮點誤差。
 * `amount` 為 brand type MoneyAmount(集中守門)、單位為最小貨幣單位:
 *   - TWD: 元位整數(例:NT$ 4,000 → amount: 4000 過 toMoneyAmount() guard)
 *
 * @see docs/patterns/money-handling.md(brand type 守門規範)
 * @see ADR-0004 Q4=A3(brand type 拍板)
 */
export type Money = {
  /** brand type、整數、最小貨幣單位 */
  amount: MoneyAmount;
  currency: Currency;
};

/**
 * 將 number 守門轉成 MoneyAmount。
 *
 * - 必為 integer(浮點誤差防呆)
 * - 必為 ≥ 0(非負)
 * - 不在 use-case 散寫 Number.isInteger guard、統一走 toMoneyAmount()
 *
 * 對齊 docs/patterns/money-handling.md §1.1 + ADR-0004 Q4=A3。
 */
export function toMoneyAmount(n: number): MoneyAmount {
  if (!Number.isInteger(n)) {
    throw new Error(`MoneyAmount must be integer, got ${n}`);
  }
  if (n < 0) {
    throw new Error(`MoneyAmount must be non-negative, got ${n}`);
  }
  return n as MoneyAmount;
}

/**
 * ShipmentReference: brand type 守門【箱號】—— ⟦ship-EPINOBRAND⟧(2026-09-06)。
 *
 * 🔴🔴 **為什麼這一欄非 brand 不可 —— 它不是為了型別整潔, 是因為【字串層分不出來】**:
 *    我們送給新竹的 `epino`(他們的「訂單編號」欄)吃的是**箱號** `shipment_reference`。
 *    而 `supabase/migrations/20260729010000_m4b_e10_d0_display_id_expand.sql:76-79`
 *    把**訂單**編號的 CHECK 放寬成也接受 `^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$`
 *    ⇒ 🛑 **訂單編號與箱號【同一個字母表、同一個長度】** ⇒ 任何執行期的格式檢查都分不出來。
 *    ⚠️ 而那**不是過渡**:同一支 migration `:81-82` 的 COMMENT 逐字
 *    「N3c 會在收窗後把本約束收緊成**新格式 only**」⇒ 收窗後訂單編號**只剩**這一種形狀
 *    ⇒ 📌 **碰撞是設計上的終局狀態 ⇒ 格式層【永遠】分不出來。**
 *
 * 🎯 **它擋的是一個【看起來像在修 bug】的改動**:有人看到 `buildHctTransData` 的參數
 *    而把它換成訂單的 `displayId`。而 `shipments` 表刻意沒有 `order_id`(一箱可含多張訂單)
 *    ⇒ **一張訂單兩箱是日常** ⇒ 同一天兩發同一個 `epino`
 *    ⇒ 撞新竹規格 P.8 `訂單編號 -> 同一個 ESDATE 不可重複`;更糟的分支是被當成「更正」
 *      ⇒ **第一箱的託運資料被第二箱蓋掉, 而我們畫面上兩箱都在。**
 *
 * ⇒ ✅ **紀律逐字照 `MoneyAmount`**(`:15`):**強制走 `toShipmentReference()` 集中守門、
 *    不允許 `as ShipmentReference` 強轉。**
 *    🔴 而**只有讀 `shipments` 那一列的 mapper 該叫它**
 *    (`apps/admin/src/lib/shipping/shipment-repository.ts` 那四個產出點)——
 *    **保護來自「誰叫得到這支函式」, 不是來自下面那個格式檢查。**
 *
 * ⚠️ **下面那個格式檢查只是防呆** —— 它擋畸形值, **擋不住一個合法的新式訂單編號**
 *    (那正是上面第一段講的事)。**不要把它讀成那道保護。**
 */
export type ShipmentReference = string & { readonly __brand: 'ShipmentReference' };

/**
 * 將 string 守門轉成 ShipmentReference。
 *
 * 🔵 格式與 DB 的 `shipments_reference_format` 同一份字面
 *    (`supabase/migrations/20260805170000_m4b_e10_b2_s1a1_shipments.sql:98-99`;
 *     字母表已排除 0/O/1/I/L/A/E/U —— 人眼易混與粗話規避)。
 *    ⚠️ 兩處各一份是刻意的(DB 擋寫進表 / 這裡擋進到我們的型別), 而**兩份要有一致性測試**
 *    才算刻意 —— 那一格在 `apps/admin/src/lib/shipping/hct-trans-data.test.ts`。
 */
export function toShipmentReference(v: string): ShipmentReference {
  if (!/^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$/.test(v)) {
    throw new Error(
      `ShipmentReference must be 6 chars from 23456789BCDFGHJKMNPQRSTVWXYZ, got ${JSON.stringify(v)}`,
    );
  }
  // 🔑 **這一行是那把鑰匙本身** —— 全 repo 唯一被授權的 `as ShipmentReference`。
  //    規則見 `eslint.config.js` 的 ⟦ship-EPINOBRAND⟧ 那一段:保護來自「誰構造得出這個值」,
  //    而這個函式就是那個「誰」。⇒ 📌 **這個 disable 是那道保護的【定義】, 不是它的例外。**
  // eslint-disable-next-line no-restricted-syntax
  return v as ShipmentReference;
}

/**
 * MemberTier: 三級會員等級。
 *
 * 對齊 ADR-0003 §4 #8 + PHASE-1-NORTHSTAR §3:
 * - design 字面無 UI 標示
 * - Medusa wire 是 customer_group(string)
 * - domain 用 enum 業務語意
 *
 * 業務含義:
 * - `general` 一般會員(註冊即開通、看零售價)
 * - `store` 經銷商(管理員手動審核、看經銷價)
 * - `premiumStore` 高級店家(累積儲值 ≥ NT$ 100,000、經銷價再 -3~5%)
 *
 * 跨 context 共用:catalog 用於 PriceByTier、identity 用於 Customer.tier;
 * 跨 context 共用 type 住 shared/、避免 catalog ↔ identity 雙向依賴。
 */
export type MemberTier = 'general' | 'store' | 'premiumStore';

/**
 * 分頁參數(對齊 backlog #20)
 *
 * 用於 list / search 類 method 限制單次返回 row 數、避免 5w SKU 規模 over-fetch。
 *
 * @property limit  單次返回上限(必填、典型 20-100)
 * @property offset offset-based 分頁(可選、跟 cursor 二擇一)
 * @property cursor cursor-based 分頁(可選、適用 timestamp / id 連續流)
 *
 * @see packages/ports/src/IProductRepository.ts:searchByKeyword
 * @see docs/phase-1-backlog.md #20
 */
export type PaginationParams = {
  limit: number;
  offset?: number;
  cursor?: string;
};

/**
 * 分頁結果包(對齊 backlog #20)
 *
 * 通用 generic、適用任何 entity list 結果。T 為 entity 型(例:Paginated<Product>)。
 *
 * @property items      本頁 entity 陣列
 * @property total      總筆數(可選、cursor 模式可省、提供時方便 UI 顯示「共 N 筆」)
 * @property nextCursor 下一頁 cursor(可選、cursor 模式 only;若無下一頁回 undefined)
 *
 * @see packages/ports/src/IProductRepository.ts:searchByKeyword
 * @see docs/phase-1-backlog.md #20
 */
export type Paginated<T> = {
  items: T[];
  total?: number;
  nextCursor?: string;
};
