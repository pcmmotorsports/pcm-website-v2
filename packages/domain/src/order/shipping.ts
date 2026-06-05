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

import type { Money } from '../shared/types';
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
 * 依小計 + 配送方式算運費(Money 整數、TWD)。
 *
 * @param subtotal 商品小計(Money、整數元位)
 * @param method   配送方式(home / store)
 * @returns 運費 Money(與 subtotal 同幣別、整數)
 * @throws 配送方式非白名單(runtime fail-closed、不默默當宅配;鏡像 RPC §3 白名單擋)
 */
export function calculateShippingFee(subtotal: Money, method: ShippingMethod): Money {
  if (method !== 'home' && method !== 'store') {
    throw new Error(`calculateShippingFee: 未知配送方式(${method as string});僅 home/store`);
  }
  const fee =
    method === 'store'
      ? 0
      : subtotal.amount >= FREE_SHIPPING_THRESHOLD
        ? 0
        : HOME_SHIPPING_FEE;
  return { amount: toMoneyAmount(fee), currency: subtotal.currency };
}
