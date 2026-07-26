import { cookies } from 'next/headers';
// 相對 import(非 @/):root vitest.config 的 @ alias 指向 storefront,lib 內部用相對路徑才能被 admin 單測解析。
import { resolveStaff, type StaffActor } from '../staff';

// M-4a M0-S2 session 具名身分讀取層。
// 🔴 actor 以 cookie 承載、內容來自使用者自行選擇。這**不是**登入 / 授權邊界,
//    也沒有驗證「目前使用者是誰」;真實身分驗證待個人帳號接上後,此 cookie 版才退場。

/** actor cookie 名(讀寫共用;寫在 session/actor-actions.ts)。 */
export const ACTOR_COOKIE = 'pcm_admin_actor';

/**
 * 讀 session 當前具名身分。
 * 回 null = 尚未選人(呼叫端須擋:不得以未知 actor 寫稽核)。
 */
export async function getSessionActor(): Promise<StaffActor | null> {
  const store = await cookies();
  return await resolveStaff(store.get(ACTOR_COOKIE)?.value);
}
