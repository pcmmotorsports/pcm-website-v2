/**
 * @module @pcm/domain/order/shipping — 運費規則(純函式、前台顯示鏡像)
 *
 * 🔴 權威來源是 `create_order` RPC(supabase/migrations/20260604130000_m3_s2b1_create_order_rpc.sql §7):
 *   結帳當下運費由 server(RPC)自算、client 送的任何運費一律忽略(plan v6 §5 紅線 3 server 權威)。
 *   本函式為「前台結帳填寫時的運費預估顯示鏡像」、**非結帳權威值**;兩處算法逐分支對齊、
 *   任一改動須同步(避免顯示與實際成交運費漂移)。
 *
 * 內容分級 L2(plan v6 §6:運費門檻 hardcode + backlog):門檻 / 金額為 hardcode、季度可能調整;
 * 與 RPM 商品價(動態同步)不同、不接後台 CRUD,改動同步 RPC §7 + 本檔常數。
 *
 * 算法(Sean 拍 B、偏離 design「自取免運/宅配滿額免運」與「flat 100」的調和、plan v6 §3.1):
 * - `store`(自取)→ 0(免運)。
 * - `home`(宅配)→ subtotal >= NT$5,000 ? 0 : NT$100。
 * - discount_total Phase 1 = 0(本函式不含折扣、訂單總額組裝見 create_order RPC §7)。
 */

import type { Money, MoneyAmount } from '../shared/types';
import { toMoneyAmount } from '../shared/types';
import type { ShippingMethod } from './types';

/**
 * 宅配免運門檻(NT$、元位整數)。
 * 🔴 與 create_order RPC §7 `v_subtotal >= 5000` 同步(改一處須改兩處)。
 */
export const FREE_SHIPPING_THRESHOLD = 5000;

/**
 * 宅配未滿門檻運費(NT$、元位整數)。
 * 🔴 與 create_order RPC §7 `ELSE 100` 同步(改一處須改兩處)。
 */
export const HOME_SHIPPING_FEE = 100;

/**
 * 運費規則(門檻 / 費率)value-object。
 *
 * 🔴 **為何需要「規則」而不是直接用上面兩個常數**(M-3 退刷線 Q6=B、Sean 2026-07-25 拍板):
 *   退款要對「剩餘保留品項」重算運費,而重算必須用**該訂單下單當時**的門檻/費率、
 *   不是今天的常數 —— 否則日後調整免運門檻,舊單退款會用新規則算,退款金額與客人當初
 *   付的邏輯不一致。凍結值來源 = `orders.shipping_free_threshold` / `orders.shipping_home_fee`
 *   (RF2a-0 片新增、`NOT NULL DEFAULT` 對齊當前規則)。
 *
 * @see docs/specs/2026-07-24-refund-automation-line-prd.md §0c(Q6=B 拍板)
 */
export interface ShippingRule {
  /** 宅配免運門檻(達到即免運;元位整數) */
  freeThreshold: MoneyAmount;
  /** 宅配未達門檻運費(元位整數) */
  homeFee: MoneyAmount;
}

/**
 * 現行運費規則(= 本檔兩個常數)。🔴 **模組私有(不 export)+ `Object.freeze`**。
 *
 * 🔴 **為何完全不 export**(codex 關卡2 R1 + R2 must-fix,分兩步收斂):
 *   退刷線 Q6=B 要求退款重算**只能**用訂單凍結規則(`orders.shipping_free_threshold` /
 *   `orders.shipping_home_fee`)。若本常數可被取得,RF5 極易寫成 `?? DEFAULT_SHIPPING_RULE`
 *   的 fallback = 悄悄退回「用當下運費表」語意、拍板失效。
 *   - R1 的修法只從 `@pcm/domain` barrel 移除 → **不夠**:`packages/domain/package.json` 無 `exports`
 *     封鎖,深層路徑 `@pcm/domain/src/order/shipping` 仍可 import 後寫 fallback(R2 抓出)。
 *   - ⇒ **改為模組私有 `const`**,取得管道從此只有 `calculateShippingFee` 的預設參數。
 *   **註解攔不住誤用,拿掉可取得性才攔得住**(機制優先於規則文字)。
 * `Object.freeze` 另擋 module 內部誤改;外部已無參照,故此為縱深防禦。
 * ⚠️ 驗證方式因此改為**行為驗證**(呼 `calculateShippingFee` 對照門檻常數),不再直接斷言物件欄位。
 *
 * 🔴 **必須逐欄由 `FREE_SHIPPING_THRESHOLD` / `HOME_SHIPPING_FEE` 建立、不得另寫字面值**
 *   (codex 關卡1 R2-F1):若此處另寫數字,它可獨立漂走,而「兩參呼叫 vs 三參傳 DEFAULT」
 *   的等價測試會**同源假綠**(兩邊都用同一個錯的 default → 永遠相等)。
 *   #216 drift gate 已擴充為三方斷言(TS 常數 ↔ 本常數 ↔ create_order RPC §7 CASE)。
 */
const DEFAULT_SHIPPING_RULE: Readonly<ShippingRule> = Object.freeze({
  freeThreshold: toMoneyAmount(FREE_SHIPPING_THRESHOLD),
  homeFee: toMoneyAmount(HOME_SHIPPING_FEE),
});

/**
 * 依小計 + 配送方式算運費(Money 整數、TWD)。
 *
 * @param subtotal 商品小計(Money、整數元位)
 * @param method   配送方式(home / store)
 * @param rule     運費規則;**選填**,預設 = `DEFAULT_SHIPPING_RULE`(現行常數)
 *                 → 既有兩參呼叫端(`apps/storefront/src/hooks/useResolvedCart.tsx`)行為零變更。
 *                 退款重算須傳訂單**凍結**規則(Q6=B),見 `ShippingRule` 說明。
 * @returns 運費 Money(與 subtotal 同幣別、整數)
 * @throws 配送方式非白名單(runtime fail-closed、不默默當宅配;鏡像 RPC §3 白名單擋)
 */
export function calculateShippingFee(
  subtotal: Money,
  method: ShippingMethod,
  rule: ShippingRule = DEFAULT_SHIPPING_RULE,
): Money {
  if (method !== 'home' && method !== 'store') {
    throw new Error(`calculateShippingFee: 未知配送方式(${method as string});僅 home/store`);
  }
  const fee = method === 'store' ? 0 : subtotal.amount >= rule.freeThreshold ? 0 : rule.homeFee;
  return { amount: toMoneyAmount(fee), currency: subtotal.currency };
}
