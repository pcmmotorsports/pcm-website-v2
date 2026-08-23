// member-tier.ts — `#879`:DB row 的 `tier` 在 adapter 邊界上做 **runtime** 收窄。
//
// 🔴 **這裡原本【不是裸 cast】,而那正是它難發現的原因。**
//    `row.tier` 的型別是 `Database['public']['Tables']['customers']['Row']['tier']`
//    = 生成型別的 enum union ⇒ **TypeScript 認為它已經是 `MemberTier`,一句話都不會說。**
//    ⇒ 真正的病是:**生成型別只新鮮到上一次 `supabase gen types` 為止**。
//      DB 的 enum 多一個值而沒有人重 gen ⇒ 執行期會出現一個型別上「不存在」的值,
//      而**編譯期、型別檢查、lint 全部安靜**。
//
// 🔴 **而它的失敗形態與 `#873` 不同,所以更難被發現**:
//    `#873`(storefront 結帳/會員中心)未知 tier ⇒ `TierBadge` **throw** ⇒ 客人結不了帳 ⇒ 有人會通報。
//    這裡(admin 列表)未知 tier ⇒ 流進 `Record<MemberTier, string>` 查表 ⇒ 得到 `undefined`
//    ⇒ **畫面上少一格字,不 throw,沒有人會通報。**
//    ⇒ 它不是「同一個病比較輕的版本」,是同一個病**沒有回饋路徑**的版本。
//
// ⚠️ **本檔刻意 `console.error`,而這兩支 mapper 在此之前【零 console】**(2026-08-24 實查)。
//    破例的理由:降級本身是對的(只准往下、不得回經銷 tier —— `apps/storefront/src/lib/tier.ts` 的既有拍板),
//    **但它不該安靜** —— 少了這一行,「DB 漂移」與「這位客人本來就是一般會員」
//    在畫面上、在資料上、在任何地方**都是同一個東西**。

import { toMemberTier } from '@pcm/domain';
import type { MemberTier } from '@pcm/domain';

/**
 * 把 DB row 的 tier 收窄成 `MemberTier`;認不得就退成 `'general'` 並留一行 log。
 *
 * @param raw DB 讀出來的值(型別上是 enum union,而**執行期不保證**)
 * @param where 呼叫點識別字,只進 log、不影響回傳值
 */
export function narrowMemberTier(raw: unknown, where: string): MemberTier {
  const parsed = toMemberTier(raw);
  if (parsed === null) {
    // 🔴 降級方向只准往下(不得回經銷 tier);而它不該安靜。
    console.error(`[${where}] tier 是本版不認得的值、退化 general:`, raw);
    return 'general';
  }
  return parsed;
}
