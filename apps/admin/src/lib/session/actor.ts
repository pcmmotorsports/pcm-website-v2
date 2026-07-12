import { cookies } from 'next/headers';
// 相對 import(非 @/):root vitest.config 的 @ alias 指向 storefront,lib 內部用相對路徑才能被 admin 單測解析。
import { resolveStaff, type StaffActor } from '../staff';

// M-4a M0-S2 session 具名身分讀取層。
// 🔴 臨時解:actor 以 cookie 承載(SSO 收端上線前的最小具名身分,PRD §6.1)。
//    這**不是**登入 / 授權邊界——真正的驗證是 SSO 收端 slice 的事;此 cookie 只標「我是誰」。
//    SSO 上線後,getSessionActor 改由真實登入 session 提供、cookie 版退場。

/** actor cookie 名(讀寫共用;寫在 session/actor-actions.ts)。 */
export const ACTOR_COOKIE = 'pcm_admin_actor';

/**
 * 讀 session 當前具名身分。
 * 回 null = 尚未選人(呼叫端須擋:不得以未知 actor 寫稽核)。
 */
export async function getSessionActor(): Promise<StaffActor | null> {
  const store = await cookies();
  return resolveStaff(store.get(ACTOR_COOKIE)?.value);
}
