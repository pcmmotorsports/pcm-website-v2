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
      '稽核情境缺 actor — 尚未選具名身分(M0-S2 自選身分;真實身分驗證待個人帳號接上)',
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
