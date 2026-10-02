'use server';

import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { validateEmailCopyText, isEmailCopyKey, EMAIL_COPY_LOCKED } from '@pcm/domain';
import { authorizeAdminMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';

// 信件文字第 2 片(2c):存一句員工改的信件文字。畫面在第 3 片。
// 計畫 ~/pcm-mailbox/計畫-信件文字第2片-資料庫與寄信接線-20261002.md;Sean 10-02:所有員工可改、每次改動記操作紀錄、存檔即生效。
// · 檢查與寄信端同一套(validateEmailCopyText, @pcm/domain);資料庫 CHECK 是第二道保險。
// · 存檔函式 admin_save_email_copy 在同一個交易寫版本表與操作紀錄(migration 20261002200000)。
// · text = null ⇒ 還原成程式預設。

export type SaveEmailCopyResult =
  | { ok: true }
  | { ok: false; reason: 'denied' }
  | { ok: false; reason: 'invalid'; problems: string[] }
  | { ok: false; reason: 'error' };

export async function saveEmailCopyAction(key: string, text: string | null): Promise<SaveEmailCopyResult> {
  const auth = await authorizeAdminMutation();
  if (!auth) return { ok: false, reason: 'denied' };
  if (typeof key !== 'string' || !isEmailCopyKey(key)) return { ok: false, reason: 'invalid', problems: ['不認得這一句'] };
  if (text !== null && typeof text !== 'string') return { ok: false, reason: 'invalid', problems: ['文字格式不對'] };
  if (EMAIL_COPY_LOCKED.has(key)) return { ok: false, reason: 'invalid', problems: ['這一句不開放修改'] };
  if (text !== null) {
    const problems = validateEmailCopyText(key, text);
    if (problems.length > 0) return { ok: false, reason: 'invalid', problems };
  }
  const requestId = await getRequestId();
  try {
    const { error } = await createSupabaseServiceClient().rpc('admin_save_email_copy' as never, {
      p_key: key,
      p_text: text,
      p_actor: auth.actorId,
      p_request_id: requestId,
    } as never);
    if (error) {
      console.error('[email-copy] 存檔失敗', { request_id: requestId, code: (error as { code?: unknown }).code });
      return { ok: false, reason: 'error' };
    }
    return { ok: true };
  } catch (err) {
    console.error('[email-copy] 存檔失敗', { request_id: requestId, name: (err as { name?: unknown })?.name });
    return { ok: false, reason: 'error' };
  }
}
