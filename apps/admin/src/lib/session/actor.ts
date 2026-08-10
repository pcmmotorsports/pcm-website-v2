import { cookies } from 'next/headers';
// 相對 import(非 @/):root vitest.config 的 @ alias 指向 storefront,lib 內部用相對路徑才能被 admin 單測解析。
import { resolveStaff, type StaffActor } from '../staff';

// M-4a M0-S2 session 具名身分讀取層。
// 🔴 actor 以 cookie 承載、內容來自使用者自行選擇。這**不是**登入 / 授權邊界,
//    也沒有驗證「目前使用者是誰」;真實身分驗證待個人帳號接上後,此 cookie 版才退場。

/** actor cookie 名(讀寫共用;寫在 session/actor-actions.ts)。 */
export const ACTOR_COOKIE = 'pcm_admin_actor';

/**
 * 「選具名身分」表單的欄名(**wire 契約**:送出端 `app/page.tsx` 與讀取端
 * `actor-actions.ts` 必須是同一個字面)。
 *
 * 🔴 **#388:為什麼要有這顆常數** —— 這個欄名打錯字的症狀是
 * **讀不到 ⇒ 靜默不寫 cookie ⇒ 操作者身分沒換**,而 typecheck、lint、測試**全部看不到**
 * (兩邊各自都是合法字串)。而這顆值最終會成為 `admin_audit_log.actor` 的來源
 * (`20260726120000:26-27`)⇒ 打錯字 = 稽核歸屬靜默斷線。
 *
 * 🔴 **常數住在這裡、不在 `actor-actions.ts`**:那支是 `'use server'` 模組,
 * **只能 export async function** —— 在那裡放常數會讓 Next 把整個模組的 export 清空,
 * 而且 **只有 `next build` 抓得到**(`lib/orders/keyword-search-action.ts` 檔頭記過同一個坑:
 * typecheck、lint、全套測試當時全部沒抓到)。
 */
export const ACTOR_ID_FIELD = 'actorId';

/**
 * 讀 session 當前具名身分。
 * 回 null = 尚未選人(呼叫端須擋:不得以未知 actor 寫稽核)。
 */
export async function getSessionActor(): Promise<StaffActor | null> {
  const store = await cookies();
  return await resolveStaff(store.get(ACTOR_COOKIE)?.value);
}
