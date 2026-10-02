'use server';

import { authorizeAdminMutation } from '../session/authorize';
import { lookupAuthMail, type AuthMailLookupResult } from './auth-mail-lookup';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 客戶頁「查最近寄信紀錄」。只收客戶編號;收件信箱由伺服器自己查(不接受畫面傳信箱)。
 * 🔴 授權在最前面:沒登入後台的人連「這個客戶存不存在」都量不到。
 */
export async function lookupAuthMailAction(customerId: string): Promise<AuthMailLookupResult | { kind: 'denied' }> {
  const auth = await authorizeAdminMutation();
  if (!auth) return { kind: 'denied' };
  if (!UUID_RE.test(customerId)) return { kind: 'error' };
  return lookupAuthMail(customerId, {
    apiKey: process.env.RESEND_AUDIT_API_KEY,
    fetchImpl: fetch,
    now: Date.now(),
  });
}
