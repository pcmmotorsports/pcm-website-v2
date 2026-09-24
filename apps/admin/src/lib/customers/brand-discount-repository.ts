// 經銷品牌折扣設定頁的讀寫(B2B 計畫 §10.4 片 E3)。service_role 讀表, 寫入只走資料庫函式。
import 'server-only';
import { createSupabaseServiceClient, SupabaseDealerApplicationAdapter, type DealerBrandDiscountRow } from '@pcm/adapters/server';
import type { DiscountChange, CurrentDiscount } from './brand-discount-form';

export type BrandDiscountPage = {
  customer: { tier: string; name: string | null; email: string };
  brands: { id: string; name: string }[];
  discounts: DealerBrandDiscountRow[];
};

/**
 * withReason = 是不是管理者:🔴 低於成本的原因是成本相關, 非管理者在 server 端就不讀(計畫 §10.4)。
 * 讀取失敗 ⇒ ok:false(畫面顯示載入失敗, 不是「沒有設定」);查無客人 ⇒ page:null。
 */
export async function loadBrandDiscountPage(
  customerId: string,
  withReason: boolean,
): Promise<{ ok: true; page: BrandDiscountPage | null } | { ok: false }> {
  try {
    const client = createSupabaseServiceClient();
    const [c, b, d] = await Promise.all([
      client.from('customers').select('tier, name, email').eq('user_id', customerId).maybeSingle(),
      client.from('brands').select('id, name').order('name', { ascending: true }),
      new SupabaseDealerApplicationAdapter(client).listBrandDiscounts(customerId, withReason),
    ]);
    if (c.error) throw c.error;
    if (b.error) throw b.error;
    if (!d.ok) throw d.error;
    if (!c.data) return { ok: true, page: null };
    return { ok: true, page: { customer: c.data, brands: b.data ?? [], discounts: d.rows } };
  } catch (err) {
    console.error('[brand-discounts] 載入失敗', { code: (err as { code?: unknown })?.code });
    return { ok: false };
  }
}

export async function saveBrandDiscounts(p: {
  customerId: string;
  changes: DiscountChange[];
  expected: Record<string, CurrentDiscount | null>;
  actor: string;
  requestId: string;
}): Promise<string> {
  return new SupabaseDealerApplicationAdapter(createSupabaseServiceClient()).saveBrandDiscounts(p);
}
