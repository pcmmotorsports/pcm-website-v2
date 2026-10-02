import 'server-only';

import { createSupabaseServiceClient } from '@pcm/adapters/server';
import type { MemberTier } from '@pcm/domain';

// order-tier-read.ts — 訂單明細紙(列印頁)要在螢幕上顯示的會員等級(2026-10-02 Sean;列印時隱藏)。
//
// 🔴 為什麼不加進 ADMIN_ORDER_DETAIL_SELECT:那條明細投影刻意不帶 tier_at_checkout(鐵則 12 紅線,
//    SupabaseOrderAdapter.test.ts 明細投影那一格釘著)—— 明細會被送到 client 元件, tier 與成交價同列 = 經銷價脈絡。
//    ⇒ 只在列印頁這一個 server component 另外讀一欄, 而且只回等級, 不帶任何金額。
// 讀不到(查無 / 錯誤 / 值不在三級裡)⇒ null ⇒ 畫面不印那一格, 不猜。

const TIERS: readonly MemberTier[] = ['general', 'store', 'premiumStore'];

export async function readOrderTierAtCheckout(orderId: string): Promise<MemberTier | null> {
  try {
    const { data, error } = await createSupabaseServiceClient()
      .from('orders')
      .select('tier_at_checkout')
      .eq('id', orderId)
      .maybeSingle();
    if (error || data === null) return null;
    const tier = (data as { tier_at_checkout: unknown }).tier_at_checkout;
    return TIERS.includes(tier as MemberTier) ? (tier as MemberTier) : null;
  } catch {
    return null;
  }
}
