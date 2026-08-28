import { headers } from 'next/headers';
// 相對 import(非 @/):#606 前的歷史遺留,見 session/actor.ts 註解(#612 更新:#606 起可用 @/,既有不回改)。
import { generateRequestId, REQUEST_ID_HEADER } from '../request-id';
import { getSessionActor } from '../session/actor';
import type { AuditLogRepository } from './repository';
import type { AuditContext, AuditEntry, AuditSourceApp } from './types';

// M-4a M0-S2 稽核情境組裝(server-only:import next/headers)。
// correlation id 貫穿(PRD §6.7)+ 具名 actor(PRD §6.1)在此匯流成 AuditContext。

const SOURCE_APP: AuditSourceApp = 'admin';

/**
 * 取當前請求 correlation id:middleware 已戳 x-request-id;
 * 缺失(理論上不該發生)則即時產一個,保證稽核 request_id 永不為空。
 */
export async function getRequestId(): Promise<string> {
  const store = await headers();
  return store.get(REQUEST_ID_HEADER) ?? generateRequestId();
}

/**
 * 組稽核情境:actor 取自 session、requestId 取自 header、sourceApp='admin'。
 * 🔴 actor 未選(null)→ 拋錯(fail-closed:不以未知身分寫稽核,PRD §6.1)。
 */
export async function buildAuditContext(): Promise<AuditContext> {
  const actor = await getSessionActor();
  if (!actor) {
    throw new Error(
      // 🔴 2026-08-29 訂正(線F 量到, `-c8` 複驗 `getSessionActorWithSource`):
      //    ~~原句「尚未選具名身分(…真實身分驗證待個人帳號接上)」~~ **兩半都不準**:
      //    ① 「尚未選」只是【五個成因裡的一個】, 而且只在旗標【關著】時才可能;
      //    ② 「待個人帳號接上」是一句沒有限定詞的平述 —— 那道閘的機制【已經在碼上】,
      //       它的效力綁在執行期旗標 `ADMIN_REQUIRE_REAL_IDENTITY` 上,
      //       而**線上那個值從 repo 讀不到** ⇒ 不可以斷言「還沒接上」。
      //    ⚠️ 本次【只改這句訊息】, 不改呼叫端(改成讀 `source` 會動到身分路徑, 那是另一片)。
      '稽核情境缺 actor —— 五種成因都會走到這裡:共用密碼備援登入 / 首次建置票 / ' +
        '票上的身分變體不認得 / 旗標開著而票上沒身分 / 旗標關著而未選具名身分。' +
        '要分辨是哪一種, 讀 getSessionActorWithSource() 回的 source。',
    );
  }
  return {
    actor: actor.id,
    requestId: await getRequestId(),
    sourceApp: SOURCE_APP,
  };
}

/**
 * 便捷:組情境 + 寫一筆稽核。repository 由呼叫端注入(第一個寫稽核的 slice 接上真 repo,
 * 見 audit/supabase-repository.ts;本 slice 無正式呼叫端,單測以 InMemory 驗)。
 */
export async function recordAdminAudit(
  repository: AuditLogRepository,
  entry: AuditEntry,
): Promise<void> {
  const context = await buildAuditContext();
  await repository.record(entry, context);
}
