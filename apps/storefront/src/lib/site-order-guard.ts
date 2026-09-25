// lib/site-order-guard.ts —— 金額的最後一道:依站別決定這個帳號能不能在這裡算價、下單(B2B 計畫第四版 C 節 L4)。
//
// 經銷站只接受 store、一般站拒絕 store;兩站查不到等級都拒絕(Fable R1 must-fix 3:擋在建單那條路,不只購物車)。
// 為什麼 L2(登入)與 L3(proxy)之外還要這一道:proxy 對「暫時查不到」的 server action 放行、對 /login/reset 的 action 不查;
// 而錯的站若照原等級算價,一般站的經銷帳號會以經銷價下單、經銷站的一般會員會在經銷站成交。
//
// 用在:建單 `app/checkout/charge-actions.ts`(placeOrder 之前)、購物車算價 `app/cart/actions.ts`(訪客照常可用)。
// 文案只有建單會顯示給客人;購物車只看 reason,throw 的原文會被 useResolvedCart 吞掉、畫面是「暫時讀不到你的購物車」(5d 再改)。
import type { MemberTier } from '@pcm/domain';
import { resolveSiteMode } from '@/lib/site-mode';
import { decideSiteAccess, resolveRawTier, tierReaderFrom } from '@/lib/site-access';

export const ORDER_BLOCK_COPY = {
  'member-on-b2b': '這是經銷商專用網站，您的帳號無法在這裡下單。請到一般網站購買。',
  'dealer-on-retail': '您的帳號是經銷商帳號，請到經銷商網站下單。',
  unknown: '目前無法確認您的帳號資格，暫時不能下單，請稍後再試。',
  disabled: '此帳號已停用，無法下單。如有疑問，請聯絡 PCM 客服。',
} as const;

type Client = Parameters<typeof tierReaderFrom>[0];
export type OrderTier =
  | { readonly ok: true; readonly tier: MemberTier }
  | { readonly ok: false; readonly reason: 'wrong-site' | 'unknown' | 'disabled'; readonly message: string };

/**
 * 查一次等級,同時決定「能不能在這個站算價/下單」與「用哪個等級算價」。
 * 🔴 兩件事要用同一次查詢的結果(Codex L4 R1 必修 1):分開查的話,中間等級被改,會用錯站的價。
 * @param allowGuest 購物車給訪客用(訪客算牌價、結帳前要登入);建單時沒登入一律擋。
 */
export async function resolveOrderTier(client: Client, { allowGuest }: { allowGuest: boolean }): Promise<OrderTier> {
  const access = decideSiteAccess(resolveSiteMode(), await resolveRawTier(tierReaderFrom(client)));
  if (access.kind === 'allowed') return { ok: true, tier: access.tier };
  if (access.kind === 'guest' && allowGuest) return { ok: true, tier: 'general' };
  if (access.kind === 'wrong-site') return { ok: false, reason: 'wrong-site', message: ORDER_BLOCK_COPY[access.reason] };
  if (access.kind === 'disabled') return { ok: false, reason: 'disabled', message: ORDER_BLOCK_COPY.disabled };
  return { ok: false, reason: 'unknown', message: ORDER_BLOCK_COPY.unknown };
}

/** 建單用:能下單 ⇒ null;不能 ⇒ 給客人看的原因。 */
export async function siteOrderBlock(client: Client, opts: { allowGuest: boolean }): Promise<string | null> {
  const r = await resolveOrderTier(client, opts);
  return r.ok ? null : r.message;
}
