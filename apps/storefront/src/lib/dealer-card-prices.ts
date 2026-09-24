// lib/dealer-card-prices.ts —— 經銷站列表卡片換成經銷價(B2B 計畫第四版 C 節片 5,F 節 Q4 已定:經銷商看經銷價、其他人看一般價)。
//
// 用在不走經銷目錄 RPC 的列表:/search 搜尋結果(含品牌俗名替代結果)、首頁與會員中心「最新商品」、商品頁「相關商品」。
// - 不是 store ⇒ 原樣回傳(一般站在片 9 起一律 general,不會進來)。
// - 卡片顯示的方式與經銷目錄那條路一致:price 直接是經銷價,不劃原價、不標特價、不掛等級標籤。
// - 🔴 取不到經銷價 ⇒ price = null(卡片顯示「—」,5d 會改成「價格暫時無法取得」),**不退回一般價**:
//   結帳收的是經銷價,畫面印一般價就是「看到的與被收的不同」(cac121efb 同一條規矩)。整段失敗也一樣全部 null。
// - 快取的物件不能就地改(會把經銷價留在共用快取裡給下一個人):一律回新物件。
import type { MemberTier } from '@pcm/domain';
import type { CatalogCardProduct } from '@/lib/catalog-page';
import { fetchProductIdsByHandles } from '@/lib/products';
import { fetchEffectivePrices, priceKey, type EffectivePriceRow } from '@/lib/tier-prices';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// get_effective_prices 一次最多收的 id 數(同商品頁 app/products/[slug]/page.tsx 的 RPC_MAX_IDS)。
const RPC_MAX_IDS = 200;

/**
 * 商品 uuid ⇒ 商品級經銷價(只回取得到的;取不到的不在 Map 裡)。失敗往上拋,由呼叫端決定「不印金額」。
 * 會員中心收藏清單直接用它(收藏的資料型別刻意不放任何經銷價,價格另外傳)。
 */
export async function dealerPricesFor(productIds: readonly string[]): Promise<Map<string, number>> {
  const ids = [...new Set(productIds.filter(Boolean))];
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += RPC_MAX_IDS) {
    const chunk = ids.slice(i, i + RPC_MAX_IDS);
    const part = await fetchEffectivePrices({ tier: 'store', productIds: chunk, variantIds: [] });
    for (const id of chunk) {
      const amount = part.get(priceKey('product', id));
      if (amount !== undefined) out.set(id, amount);
    }
  }
  return out;
}

export async function withDealerCardPrices(items: readonly CatalogCardProduct[], tier: MemberTier): Promise<CatalogCardProduct[]> {
  if (tier !== 'store' || items.length === 0) return [...items];
  let priced = new Map<string, number>(); // product uuid ⇒ 經銷價
  let idOf = new Map<string, string>(); // slug ⇒ product uuid
  try {
    const missing = items.filter((p) => !p.productId).map((p) => p.slug);
    const looked = missing.length > 0 ? await fetchProductIdsByHandles([...new Set(missing)]) : new Map<string, string>();
    idOf = new Map(items.map((p) => [p.slug, p.productId ?? looked.get(p.slug) ?? '']));
    priced = await dealerPricesFor([...idOf.values()]);
  } catch (err) {
    console.error('[dealer-card-prices] 取經銷價失敗 ⇒ 這批卡片不印金額(不退回一般價)', {
      count: items.length,
      message: err instanceof Error ? err.message : String(err),
    });
    priced = new Map();
  }
  return items.map((p) => {
    const id = idOf.get(p.slug);
    const amount = id ? priced.get(id) : undefined;
    return { ...p, price: amount ?? null, origPrice: null, originalPrice: null, isSale: false, tierLabel: null };
  });
}

/**
 * 搜尋疊層用(片 5b,計畫 F 節 Q4):不先查等級,直接呼叫一次 get_effective_prices,由資料庫自己驗身分。
 * 🔴 Codex 5b R1 必修:先查等級再取價是每次打字多四次循序往返(驗使用者、查等級、再驗使用者、取價)。
 * - 回的列 tier 是 store ⇒ 換經銷價(取不到的那件不印金額)。
 * - 回的列不是 store(不是經銷商)或沒有商品編號 ⇒ 原樣。
 * - 呼叫失敗 ⇒ 全部不印金額:分不出這個人是不是經銷商,不能退回一般價。
 * 呼叫端只在「經銷站 + 帶登入 cookie」時呼叫。
 */
export async function withDealerCardPricesViaRpc(items: readonly CatalogCardProduct[]): Promise<CatalogCardProduct[]> {
  const ids = [...new Set(items.map((p) => p.productId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return [...items];
  let rows: EffectivePriceRow[];
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc('get_effective_prices', {
      p_product_ids: ids.slice(0, RPC_MAX_IDS),
      p_variant_ids: null,
    });
    if (error) throw new Error(`get_effective_prices: ${(error as { code?: string }).code ?? 'error'}`);
    rows = (data ?? []) as EffectivePriceRow[];
  } catch (err) {
    console.error('[dealer-card-prices] 疊層取經銷價失敗 ⇒ 不印金額(不退回一般價)', err instanceof Error ? err.message : String(err));
    return items.map((p) => ({ ...p, price: null }));
  }
  if (!rows.some((r) => r.tier === 'store')) return [...items];
  const byId = new Map(rows.filter((r) => r.kind === 'product' && typeof r.amount === 'number').map((r) => [r.id, r.amount as number]));
  return items.map((p) => ({
    ...p,
    price: p.productId ? (byId.get(p.productId) ?? null) : null,
    origPrice: null,
    originalPrice: null,
    isSale: false,
    tierLabel: null,
  }));
}
