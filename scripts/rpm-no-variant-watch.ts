// rpm-no-variant-watch.ts — 供應商同步「寫到一半」的眼睛(⟦f3-HALFWRITE1⟧;Sean 2026-09-15 批 plan 76de8f6d2「先裝眼睛」)。
//
// 做的事:同步寫入之前 / 之後各數一次「這家供應商【上架中】而【沒有任何規格】的商品」, 跑後比跑前多 ⇒ 告警。
// 🔴 不改同步行為、不碰 schema、不碰寫入路徑 —— 出錯最多是誤報一次(plan §3 乙)。
//
// 🔴🔴 **一定要自己帶 `delisted_at IS NULL`**:同步用的是 service key, 不吃 RLS
//    ⇒ 不帶的話會把【下架品】也數進來。2026-09-12 根因調查就是這樣數錯的:
//    「10 件客人看得到而沒規格」實際是 10 件全下架、客人看得到的 0 件(`docs/evidence/2026-09-12-halfwrite1-根因調查.md`)。
//    而下架而沒規格正是 S4 對賬 + V1 孤兒硬刪的【設計行為】, 不是半寫入 ⇒ 數進來就是每天誤報。
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 這家供應商上架中、而 product_variants 一列都沒有的商品件數。
 * 用 PostgREST 反連接(`product_variants!left` + `is.null`)一發精確 count, 不取列。
 * 🔬 拋棄式 PostgREST 實測(2026-09-15):`products?select=id,product_variants!left(id)&delisted_at=is.null&product_variants=is.null` ⇒ 206、Content-Range 總數 12(星號斜線那個字面不能寫進區塊註解, 會把註解提早關掉),
 *    與 psql `NOT EXISTS` 數出來的 12 相同。
 * 讀不到 / count 缺席 ⇒ throw(不把「不知道」報成 0 —— 0 會讓比較恆為「沒增加」)。
 */
export async function countListedProductsWithoutVariants(client: SupabaseClient, supplierSlug: string): Promise<number> {
  const { count, error } = await client
    .from('products')
    .select('id, product_variants!left(id)', { count: 'exact', head: true })
    .eq('supplier_slug', supplierSlug)
    .is('delisted_at', null)
    .is('product_variants', null);
  if (error) throw new Error(`無規格上架商品計數失敗(${error.code ?? 'unknown'})`);
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new Error('無規格上架商品計數失敗(count_missing)');
  }
  return count;
}

/**
 * 跑前 / 跑後比一次。任一邊讀不到 ⇒ `unknown`(不告警也不說沒事 —— 呼叫端照印一行讓人看得到)。
 * 🛑 判準是「變多」不是「非零」:今天本來就可能有上架而沒規格的商品(來源本來就沒有), 那不是這次同步造成的。
 */
export function decideNoVariantAlert(before: number | null, after: number | null): 'alert' | 'ok' | 'unknown' {
  if (before === null || after === null) return 'unknown';
  return after > before ? 'alert' : 'ok';
}
