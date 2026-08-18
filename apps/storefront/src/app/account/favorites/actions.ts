'use server';

// app/account/favorites/actions.ts — 收藏 加入 / 取消 / 列出 server action(M-4b #191)
//
// plan:`docs/specs/2026-08-18-g3-favorites-plan.md`(Sean 2026-08-18 批)。
// migration:`20260818170000_m4b_g3_customer_favorites`(2026-08-18 已 apply)。
//
// 信任邊界(鏡像 g-5b addAddressAction,已過 codex 雙關卡):
// - ① server session `getUser()` 取 user.id 當 customerUserId,**絕不從 client 收**
// - ② client 只送 handle(URL 那個字串),uuid 由 server 自己查 —— 見下方「為什麼收 handle」
// - ③ RLS favorites_*_own(auth.uid() = customer_user_id)守自己 row
//
// 🔴 **為什麼收 handle 不收 product uuid**:卡片手上根本沒有 uuid ——
//   `lib/products.ts toUIProduct` 把 `products.id` 餵給 `hashIdToNumber()` 之後才進 `MockProduct.id`
//   (= 一個 number,**不可逆**)。要讓兩顆愛心拿到 uuid 得在四個掛載面一路 plumb 一個新欄位;
//   而 `handle` 是 UNIQUE、卡片與商品頁本來就有(`p.slug`)。
//   ⇒ 代價 = 每次切換多一趟 `handle → id` 查詢。
//   ponytail: 每次 toggle 多一趟 DB 往返;若日後量到它是瓶頸,再把 uuid plumb 進 MockProduct。
//
// 🔴 **codex 對抗審查 must-fix 6(2026-08-18)—— 我【沒有】照它的修法做,理由寫在這裡:**
//   它指出「可見性檢查」與「寫入」是兩個獨立查詢 ⇒ 商品在兩者之間被下架時,INSERT 仍會成功,
//   而清單之後 join 不到它 ⇒ 那一列客人自己移不掉。**這個描述是對的。**
//   ⚠️ 而**那個結束狀態,plan 已經明文裁定要接受**:
//   `docs/specs/2026-08-18-g3-favorites-plan.md` §1-c-2 陷阱二逐字「**判斷:不清理**」——
//   軟下架是可逆的,商品重新上架時客人的收藏**會自己回來**,而回來是好事。
//   ⇒ 這個競態產生的是**一個已經被拍板接受的狀態**,不是一個新的危害。
//   🔴 **而它確實留下一格,我明寫不修**:商品在客人開著頁面的期間被下架 ⇒ 他按取消會拿到
//   「收藏沒有存成功」(因為 handle 已經查不到)。**那句話對他來說是對的**(真的沒存成功),
//   只是理由他不知道。要做到「照自己的收藏關聯取消」得讓客人端拿得到 product uuid,
//   而本片刻意不 plumb 那個欄位(理由見上面「為什麼收 handle」)。
//   ⇒ **留給收藏線的下一片**;今天沒有任何一列收藏,這一格量不到。
//
// 🔴 **查不到 handle 就是失敗,不是「當作成功」**:客人看不到的商品(軟下架 ⇒
//   `products_select_public` 的 `USING (delisted_at IS NULL)` 把整列藏掉)本來就不該收藏得起來。
//   ⇒ 回 `{ error }`、讓愛心退回去。**不要靜靜地當作成功** —— 那正是本片要治的病。

import { getFavoritesRepo } from '@/lib/auth/composition';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type FavoriteActionResult = { ok: true } | { error: string };

/** 未登入 / 查無商品的共用文案(不洩 Supabase 原始 error)。 */
const ERR_AUTH = '請重新登入';
const ERR_SAVE = '收藏沒有存成功,請再試一次';
/**
 * 🔴 **換帳號中途才送到的那一發**(codex 對抗審查 R2 must-fix 2)。
 *
 * 客人按了愛心 ⇒ 那一發還在路上 ⇒ 他**換了帳號** ⇒ 這一發才抵達 server。
 * 這支 action 的 `customerUserId` 一律取自**當下的 session**(那是對的、也不能改),
 * ⇒ 少了下面那道比對,**A 按的收藏會寫進 B 的帳號裡**。
 *
 * ⚠️ **`expectedUserId` 是 client 送的、不可信** —— 所以它**只用來否決,不用來授權**:
 * 對不上就拒絕,對得上也不代表什麼(真正決定寫進誰名下的,還是 server 自己的 `getUser()`)。
 * ⇒ 這個參數**只會讓寫入變少、不會變多**,偽造它拿不到任何東西。
 * 🔴 client 端也有一道(送出前比對),但那道**擋不住已經在路上的**;這一道才是最後那格。
 */
const ERR_SWITCHED = '帳號已變更,請重新操作';

/**
 * 取本次 request 的登入者 id;未登入回 null。
 * `getUser()` 會向 auth server 驗 JWT(非可偽造的 getSession)。
 */
async function currentUserId(): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * handle → products.id。
 * 客人自己的 authenticated client + RLS ⇒ **看不到的商品在這裡查不到**(回 null)。
 */
async function resolveProductId(handle: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('products')
    .select('id')
    .eq('handle', handle)
    .maybeSingle();
  if (error || !data) return null;
  return data.id as string;
}

/**
 * 列出自己收藏的商品 handle(給兩顆愛心的單一資料源用)。
 * 未登入 → `[]`(不是錯:沒登入本來就沒有收藏)。讀取失敗 → `[]` + console.error、不炸畫面。
 */
export async function listFavoriteHandlesAction(): Promise<string[]> {
  const userId = await currentUserId();
  if (!userId) return [];
  try {
    const items = await (await getFavoritesRepo()).listByCustomer(userId);
    return items.map((i) => i.product.handle);
  } catch (e) {
    console.error('[favorites/actions] 讀取收藏失敗、退化空陣列:', e);
    return [];
  }
}

/**
 * 加入收藏(冪等 —— adapter 走 `ON CONFLICT DO NOTHING`,重複收藏同一件不算錯)。
 *
 * `expectedUserId` 見 `ERR_SWITCHED` 的說明。
 */
export async function addFavoriteAction(
  handle: string,
  expectedUserId?: string,
): Promise<FavoriteActionResult> {
  const userId = await currentUserId();
  if (!userId) return { error: ERR_AUTH };
  if (expectedUserId && expectedUserId !== userId) return { error: ERR_SWITCHED };
  const productId = await resolveProductId(handle);
  if (!productId) return { error: ERR_SAVE };
  try {
    await (await getFavoritesRepo()).add(userId, productId);
    return { ok: true };
  } catch (e) {
    console.error('[favorites/actions] 加入收藏失敗:', e);
    return { error: ERR_SAVE };
  }
}

/** 取消收藏(同樣冪等 —— 刪一個本來就不在的,PostgREST 回 204、不是錯)。 */
export async function removeFavoriteAction(
  handle: string,
  expectedUserId?: string,
): Promise<FavoriteActionResult> {
  const userId = await currentUserId();
  if (!userId) return { error: ERR_AUTH };
  if (expectedUserId && expectedUserId !== userId) return { error: ERR_SWITCHED };
  const productId = await resolveProductId(handle);
  if (!productId) return { error: ERR_SAVE };
  try {
    await (await getFavoritesRepo()).remove(userId, productId);
    return { ok: true };
  } catch (e) {
    console.error('[favorites/actions] 取消收藏失敗:', e);
    return { error: ERR_SAVE };
  }
}
