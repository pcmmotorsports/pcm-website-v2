// lib/display-tier.ts —— 顯示價格的頁面解析等級用這支(B2B 計畫第四版 C 節 4c,Codex R3 必修 3)。
//
// 經銷站上「帶登入 cookie 卻查不到等級」(`ok:false`)不可以照 0908 拍板退成牌價 —— 那句拍板只適用一般站;
// 經銷商會看到一般價,之後結帳卻收經銷價。⇒ 經銷站導到登入頁說明;一般站照舊回 general。
//
// - 導向放在 `resolveAuthenticatedTierStrict()` **回傳之後**、它的 try/catch 之外(放進 lib/tier.ts 裡會被 catch-all 吃掉,
//   Fable R4 consider 2)。獨立一支檔,不動 lib/tier.ts 的進料口白名單。
// - 🔴 只擋「帶登入 cookie」的人(Codex 4c R1 必修 1):`ok:false` 也會出現在訪客身上(例如建 client 或驗使用者整段拋例外),
//   訪客照常看牌價。cookie 判斷與 proxy(L3)同一套。
// - 不刪 cookie(server component 不能寫 cookie);/login 不檢查站別,不會迴圈,下一次換頁由 proxy 重查。
//   計畫原寫「可重試回 503」,頁面元件回不了狀態碼,統一導到登入頁說明。
// - next 帶完整網址(含篩選、排序、頁碼、重複參數),登入後回到原本的畫面(Codex 4c R1 必修 2)。
// - 購物車 server action(`app/cart/actions.ts`)不走這支:action 被導向會壞,它自己拿到 ok:false 就 throw。
// - 首頁目前不走這支:首頁的等級只寫進 data-tier,精選商品固定牌價(片 5 才換價)。
// server-only 由 @/lib/tier 保證(它第一行就是),這裡不重複,讓頁面測試 mock 掉 @/lib/tier 就能載入。
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveAuthenticatedTierStrict, type StrictTier } from '@/lib/tier';
import { resolveSiteMode } from '@/lib/site-mode';
import { authCookieBase, isAuthCookieName } from '@/lib/site-access';

type Query = Record<string, string | string[] | undefined>;

/** 路徑加上原本的查詢參數(重複參數照順序保留)。 */
export function pathWithQuery(path: string, query: Query = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    for (const x of [v].flat()) if (x !== undefined) qs.append(k, x);
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * @param path  目前這一頁的路徑
 * @param query 目前這一頁的查詢參數;導到登入頁時一起帶著,重新登入後回到同一個畫面
 */
export async function resolveDisplayTierStrict(path: string, query?: Query): Promise<StrictTier> {
  const t = await resolveAuthenticatedTierStrict();
  if (t.ok || resolveSiteMode() !== 'b2b' || !(await hasAuthCookie())) return t;
  redirect(`/login?error=site-unknown&next=${encodeURIComponent(pathWithQuery(path, query))}`);
}

/** 推不出 cookie 名字(環境變數壞掉)時當成「有」:經銷站寧可導到說明頁,也不退成牌價。 */
async function hasAuthCookie(): Promise<boolean> {
  const base = authCookieBase();
  if (!base) return true;
  return (await cookies()).getAll().some((c) => isAuthCookieName(c.name, base));
}
