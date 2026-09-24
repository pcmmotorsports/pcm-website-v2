// 經銷品牌折扣設定頁的讀寫(B2B 計畫 §10.4 片 E3)。service_role 讀表, 寫入只走資料庫函式。
import 'server-only';
import { createSupabaseServiceClient, SupabaseDealerApplicationAdapter, type DealerBrandDiscountRow } from '@pcm/adapters/server';
import type { DiscountChange, CurrentDiscount } from './brand-discount-form';
import { latestUnitCostByVariant, pickPreviewTrio, type CostRow, type PricedVariant } from './brand-discount-pricing';

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

// ── 片 E4:複製設定、預覽、低於成本 ─────────────────────────────────

type Loose = {
  from(t: string): {
    select(c: string, o?: { count?: 'exact'; head?: boolean }): LooseQuery;
  };
};
type LooseQuery = PromiseLike<{ data: unknown; error: unknown; count?: number | null }> & {
  eq(c: string, v: unknown): LooseQuery;
  neq(c: string, v: unknown): LooseQuery;
  is(c: string, v: null): LooseQuery;
  in(c: string, v: readonly string[]): LooseQuery;
  order(c: string, o: { ascending: boolean }): LooseQuery;
  range(a: number, b: number): LooseQuery;
};
function loose(): Loose {
  return createSupabaseServiceClient() as unknown as Loose;
}

/**
 * 分頁讀到底(Codex E4 R1):PostgREST 有伺服器端的單次上限(db-max-rows), `.limit()` 超過它會被靜靜截斷
 * ⇒ 一頁一頁讀, 直到某一頁不滿。build 必須帶穩定的排序, 否則換頁會重複或漏列。
 */
const PAGE = 1000;
async function fetchAll<T>(build: () => LooseQuery): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
    if (from > 200_000) throw new Error('分頁讀取超過安全上限');
  }
}

/** 複製來源:其他所有車行會員(有沒有設定折扣都列, 讓員工自己挑)。 */
export async function loadCopySources(excludeCustomerId: string): Promise<{ id: string; label: string }[] | null> {
  try {
    const rows = await fetchAll<{ user_id: string; name: string | null; email: string }>(() =>
      loose()
        .from('customers')
        .select('user_id, name, email')
        .eq('tier', 'store')
        .neq('user_id', excludeCustomerId)
        .order('email', { ascending: true })
        .order('user_id', { ascending: true }),
    );
    return rows.map((c) => ({ id: c.user_id, label: c.name ? `${c.name}（${c.email}）` : c.email }));
  } catch (err) {
    console.error('[brand-discounts] 複製來源載入失敗', { code: (err as { code?: unknown })?.code });
    return null;
  }
}

/** 某位會員的折扣(只讀 %, 不讀原因)。 */
export async function loadPercents(customerId: string): Promise<Record<string, number> | null> {
  const r = await new SupabaseDealerApplicationAdapter(createSupabaseServiceClient()).listBrandDiscounts(customerId, false);
  if (!r.ok) {
    console.error('[brand-discounts] 讀取複製來源的折扣失敗');
    return null;
  }
  return Object.fromEntries(r.rows.map((d) => [d.brand_id, d.percent]));
}

/**
 * 🔴 成本相關, 只給管理者:呼叫端(action)要先驗管理者。
 * 回:每個「有成本資料、而且上架中」的變體 ⇒ 品牌、經銷價、最近一次登記的單件台幣成本。
 * 經銷價 = 變體的 price_store, 沒有就用變體的一般價 —— 與結帳 create_order 收的同一個數(預覽也用這一個, Codex E4 R1)。
 * 讀取失敗回 null(畫面與儲存都要當成「查不到」, 不能當成「沒有低於成本」)。
 */
export async function loadCostedVariants(): Promise<{ variants: PricedVariant[]; unitCost: Map<string, number> } | null> {
  try {
    const raw = await fetchAll<{
      order_item_id: string; updated_at: string;
      cost_price: string; cost_shipping: string; cost_tax: string; fx_rate: string;
      order_items: { variant_id: string | null; quantity: number };
    }>(() =>
      loose()
        .from('order_item_costs')
        .select('order_item_id, updated_at, cost_price::text, cost_shipping::text, cost_tax::text, fx_rate::text, order_items!inner(variant_id, quantity)')
        .order('order_item_id', { ascending: true }),
    );
    const rows: CostRow[] = raw.map((r) => ({
      variantId: r.order_items.variant_id,
      quantity: r.order_items.quantity,
      recordedAt: r.updated_at,
      tieBreak: r.order_item_id,
      costPrice: r.cost_price,
      costShipping: r.cost_shipping,
      costTax: r.cost_tax,
      fxRate: r.fx_rate,
    }));
    const unitCost = latestUnitCostByVariant(rows);
    const ids = [...unitCost.keys()];
    const variants: PricedVariant[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const v = await loose()
        .from('product_variants')
        .select('id, price_store, price_general, products!inner(brand_id, delisted_at)')
        .in('id', ids.slice(i, i + 200))
        .is('products.delisted_at', null);
      if (v.error) throw v.error;
      for (const r of (v.data ?? []) as { id: string; price_store: number | null; price_general: number | null; products: { brand_id: string } }[]) {
        const dealerPrice = r.price_store ?? r.price_general;
        if (dealerPrice !== null) variants.push({ variantId: r.id, brandId: r.products.brand_id, dealerPrice });
      }
    }
    return { variants, unitCost };
  } catch (err) {
    console.error('[brand-discounts] 成本資料讀取失敗', { code: (err as { code?: unknown })?.code });
    return null;
  }
}

export type PreviewItem = { productId: string; title: string; generalPrice: number; dealerPrice: number; basisVariantId: string | null };

/**
 * 某品牌的預覽三件:上架商品中一般價最低、中間、最高。
 * 每件取基準款變體(一般價最低、同價 sku 最小, 與商品頁同一個規則);經銷價 = 基準款的 price_store, 沒有就基準款的一般價。
 */
export async function loadBrandPreview(brandId: string): Promise<PreviewItem[] | null> {
  try {
    const head = await loose().from('products').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).is('delisted_at', null);
    if (head.error) throw head.error;
    const n = head.count ?? 0;
    if (n === 0) return [];
    const picked: { id: string; title: string; price_general: number | null }[] = [];
    for (const i of new Set(pickPreviewTrio([...Array(n).keys()]))) {
      const r = await loose()
        .from('products')
        .select('id, title, price_general')
        .eq('brand_id', brandId)
        .is('delisted_at', null)
        .order('price_general', { ascending: true })
        .order('id', { ascending: true })
        .range(i, i);
      if (r.error) throw r.error;
      picked.push(...((r.data ?? []) as typeof picked));
    }
    const out: PreviewItem[] = [];
    for (const p of picked) {
      // 🔴 每件商品的變體讀完整再挑(Codex E4 R1:一次讀三件的全部變體可能被伺服器上限截斷, 挑錯基準款)
      const variants = await fetchAll<{ id: string; sku: string; price_general: number | null; price_store: number | null }>(() =>
        loose().from('product_variants').select('id, sku, price_general, price_store').eq('product_id', p.id).order('id', { ascending: true }),
      );
      const basis = variants.sort(
        (a, b) => (a.price_general ?? Infinity) - (b.price_general ?? Infinity) || (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0),
      )[0];
      const general = p.price_general ?? 0;
      out.push({
        productId: p.id,
        title: p.title,
        generalPrice: general,
        dealerPrice: basis ? (basis.price_store ?? basis.price_general ?? general) : general,
        basisVariantId: basis?.id ?? null,
      });
    }
    return out;
  } catch (err) {
    console.error('[brand-discounts] 預覽載入失敗', { code: (err as { code?: unknown })?.code });
    return null;
  }
}
