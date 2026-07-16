import 'server-only';
import { cookies, headers } from 'next/headers';
// 相對 import(非 @/):見 session/actor.ts 註解(vitest @ alias 指 storefront)。
import { ADMIN_SESS_COOKIE, verifySession } from './session';
import { getSessionActor } from './actor';
import { isAllowedOrigin } from '../orders/workflow-form';

// authorize.ts — admin mutation 共用授權閘(M-4a 儲值金編輯片自 order-actions.ts 抽出;
// 原「D-2 抽出、order/item 兩 action 共用」的 authorizeAdminMutation 原封搬移,行為零變更,
// 供 orders / customers 兩域 server action 共用;不放 'use server' 檔內=避免 helper 被當 action 匯出)。
//
// 🔴 安全縱深(不只靠 proxy 登入閘;Slice C verdict must-fix 2/3):
//   ① verifySession(cookie) 自驗——admin session 票證無效 → 拒;
//   ② Origin fail-closed——缺 Origin 即拒 + 精確等值(dev 走 ADMIN_DEV_BYPASS localhost allowlist);
//   ③ actor 具名身分——picker cookie 解析(缺=拒;actor 只標「我是誰」、非授權,授權在 ①)。

const DEV_BYPASS =
  process.env.NODE_ENV !== 'production' && process.env.ADMIN_DEV_BYPASS === '1';

/**
 * 共用授權閘(①session 自驗 ②Origin fail-closed ③具名 actor)。
 * 任一失敗 → null(caller redirect denied;不以未知身分寫稽核)。
 */
export async function authorizeAdminMutation(): Promise<{
  sid: string;
  actorId: string;
} | null> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const session = await verifySession(cookieStore.get(ADMIN_SESS_COOKIE)?.value);
  if (!session) return null;
  if (!isAllowedOrigin(headerStore.get('origin'), { devBypass: DEV_BYPASS })) return null;
  const actor = await getSessionActor();
  if (!actor) return null;
  return { sid: session.sid, actorId: actor.id };
}
