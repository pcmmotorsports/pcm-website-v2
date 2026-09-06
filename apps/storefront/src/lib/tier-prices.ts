import 'server-only';

import type { MemberTier } from '@pcm/domain';
import { getVerifiedUser } from '@/lib/auth/verified-user';

/**
 * ⟦auth-DEALERTIERPRICING⟧ M-2-08 B2a —— 拿【呼叫者自己那個 tier】的有效價。
 *
 * 🔴🔴 **它【只在 tier === 'store' 時被叫】—— 而那是本片的安全邊界, 不是效能考量。**
 *   RPC 貼板(68)之前, 正式庫裡**沒有** `get_effective_prices` ⇒ 叫它會炸。
 *   ⇒ 若每個人的結帳都叫它, **貼板之前全站結不了帳** —— 不只經銷商, 是每一個客人。
 *   ✅ 而 `resolveAuthenticatedTier()` **不需要 RPC 就查得到 tier**(它直接查 `customers`)
 *   ⇒ 📌 **general / 未登入根本不叫** ⇒ fail-closed 的射程收窄到【經銷商】,
 *     而他們正是「拿到錯價會被多收/少收」的那群人。
 *
 * 🛑 **fail-closed:RPC 不在或壞掉 ⇒ throw, 不靜默退回 general。**
 *   ⛔ 退回 general 會讓經銷商**用一般價結帳而畫面上完全正常** —— 那是錢錯, 而它不會紅。
 *   ⇒ 呼叫端要讓它往上炸(結帳擋下 + error log), 不要 catch 成空。
 *
 * ⚠️ **它答不出什麼**
 *   · 它**不算稅** —— 稅由付款方式決定(Sean Q24), 那是 `computeTax` 與 B2b。
 *   · 它**不管 premiumStore** —— RPC 內部把非 `store` 的 tier 一律降成 general。
 *   · 🔴 **今天正式庫零判別力**:25,769 件商品 + 59,841 個變體**全無差價**
 *     ⇒ 它上線後【**在 RPC 已貼且叫得動的前提下**】畫面零改動。那是 fail-safe 的方向。
 *     ⛔ ~~而我原本只寫「全無差價 ⇒ 上線後畫面零改動」~~ —— **少了那個前提**(codex R1 nit ⑤):
 *     🛑 **RPC 還沒貼的世界裡, 經銷商看到的不是「一樣的價」而是【整頁錯誤】**
 *     ⇒ 📌 **這一片與貼板 68 必須同一批** —— 那不是流程潔癖, 是那個前提本身。
 */

/** RPC 回的一列。`kind` 分辨這個 id 是商品還是變體。 */
export type EffectivePriceRow = {
  readonly kind: 'product' | 'variant';
  readonly id: string;
  readonly amount: number | null;
  readonly currency: string;
  readonly tier: string;
};

/**
 * 🔴 **key 是 `kind:id` 而不是 `id`**(codex R2 指出)——
 *   同一個 uuid 可以**同時**出現在兩個陣列裡(理論上), 而**單用 `id` 建 Map 會互相覆蓋**
 *   ⇒ 📌 那會讓一行拿到另一行的價, 而兩邊都是合法的整數 ⇒ **看不出來。**
 */
export function priceKey(kind: 'product' | 'variant', id: string): string {
  return `${kind}:${id}`;
}

export type FetchEffectivePricesArgs = {
  readonly tier: MemberTier;
  readonly productIds: readonly string[];
  readonly variantIds: readonly string[];
};

/**
 * 回 `Map<'product:<id>' | 'variant:<id>', amount>`;`tier !== 'store'` ⇒ 回**空 Map**(不叫 RPC)。
 * @throws RPC 失敗時往上拋 —— 見檔頭 fail-closed。
 */
export async function fetchEffectivePrices(
  args: FetchEffectivePricesArgs,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  // 🔴 這一行就是上面那個安全邊界。general / premiumStore / 未登入 ⇒ 一律不叫。
  if (args.tier !== 'store') return out;
  if (args.productIds.length === 0 && args.variantIds.length === 0) return out;

  const { supabase } = await getVerifiedUser();
  const { data, error } = await supabase.rpc('get_effective_prices', {
    p_product_ids: args.productIds.length > 0 ? [...args.productIds] : null,
    p_variant_ids: args.variantIds.length > 0 ? [...args.variantIds] : null,
  });
  if (error) {
    // 🛑 **不 catch 成空** —— 見檔頭:靜默退 general 是錢錯而它不會紅。
    console.error('[tier-prices] get_effective_prices 失敗 ⇒ 往上拋(經銷價拿不到不得靜默降級)', {
      code: (error as { code?: unknown } | null)?.code,
    });
    throw new Error('get_effective_prices failed');
  }
  for (const row of (data ?? []) as EffectivePriceRow[]) {
    // 🔴 **R3 nit ④:RPC 自己回了 `tier`, 而我原本把它丟掉。**
    //   那支 migration 自己寫著「有 EXECUTE 卻拿不到 `auth.uid()` = 接線壞了」, 而它的處置是
    //   `RAISE WARNING` —— **那只進 PG log, 沒有人在看**。回傳裡就有答案, 一行就關掉:
    //   「我以為他是經銷商而 RPC 認定他是一般會員」⇒ 那是**身分沒傳到 DB**, 不是價的問題。
    //   🛑 而它與上面那三種「拿不到」同一個處置 —— 不一致才是漏洞。
    if (row.tier !== 'store') {
      throw new Error(`tier price: RPC 回的 tier 是 ${row.tier} 而我送的是 store ⇒ 身分沒傳到 DB`);
    }
    // 🔵 `amount` 為 null = RPC 那端連 general 都取不到(它自己會 RAISE WARNING)⇒ 這裡**不放進 Map**。
    //   ⛔ ~~原本這句寫「讓呼叫端保留它原本算出來的 general 價」~~ —— **那句已經過期**:
    //     codex R1 must-fix ② 之後, 呼叫端對「Map 裡沒有這一列」的處置是 **throw**, 不是保留。
    //     📌 留刪除線, 讓下一個照這句去讀呼叫端的人當場撞到訂正。
    if (typeof row.amount === 'number') out.set(priceKey(row.kind, row.id), row.amount);
  }
  return out;
}

// ⛔ ~~本檔原本自己實作一份 `resolveAuthenticatedTierStrict()`~~ ——
//    🔴 codex R2 兩條 must-fix:①它只看得到 `getVerifiedUser()`, `customers` 那一段的失敗漏掉
//    ②未登入的正常形狀是 `user:null + AuthSessionMissingError` ⇒ **每一個訪客都被判成故障、購物車必拋**。
//    ✅ 判準搬回查詢住的地方 `@/lib/tier`(那裡的註解本來就寫著坑 ②)⇒ 從那裡 import。
