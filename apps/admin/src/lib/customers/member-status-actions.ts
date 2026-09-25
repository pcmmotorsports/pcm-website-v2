'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { authorizeManagerMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import {
  codeFromRpc,
  codeFromRpcError,
  memberActionResult,
  parseMemberReason,
  type MemberAction,
  type MemberActionResult,
} from './member-status-copy';

// 後台停用 / 恢復 / 刪除會員(20260926100000;計畫第四～六節)。
// ① authorizeManagerMutation:只有在職老闆(資料庫函式裡再查一次 staff)
// ② 原因必填;停用與恢復帶畫面上的版本號(不同 ⇒ STALE, 不改資料)
// ③ 稽核在資料庫函式的同一筆交易裡寫, 這裡不另寫
// ④ 沒收到資料庫回應 ⇒ unknown:可能已經做完, 叫員工重新整理確認, 不叫他重按

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Input = { customerId: string; reason: string; expectedVersion?: number };

async function run(action: MemberAction, input: Input): Promise<MemberActionResult> {
  const auth = await authorizeManagerMutation();
  if (!auth) return memberActionResult(action, 'denied');
  const reason = parseMemberReason(input?.reason);
  const needsVersion = action !== 'delete';
  if (
    typeof input?.customerId !== 'string' ||
    !UUID_RE.test(input.customerId) ||
    reason === null ||
    (needsVersion && !Number.isInteger(input.expectedVersion))
  ) {
    return memberActionResult(action, 'invalid');
  }

  const requestId = await getRequestId();
  // 原因不進 log(內部營運資料);稽核真相在 admin_audit_log
  console.info(`[admin/customers] customer.${action}.attempt`, {
    request_id: requestId,
    sid: auth.sid,
    actor: auth.actorId,
    customer_id: input.customerId,
  });

  const client = createSupabaseServiceClient();
  let res: { data: unknown; error: { code?: string; message?: string } | null };
  try {
    res =
      action === 'delete'
        ? await client.rpc('admin_delete_customer', {
            p_actor: auth.actorId,
            p_customer_user_id: input.customerId,
            p_reason: reason,
            p_request_id: requestId,
          })
        : await client.rpc(action === 'disable' ? 'admin_disable_customer' : 'admin_enable_customer', {
            p_actor: auth.actorId,
            p_customer_user_id: input.customerId,
            p_expected_version: input.expectedVersion as number,
            p_reason: reason,
            p_request_id: requestId,
          });
  } catch (err) {
    res = { data: null, error: { message: String((err as { message?: unknown })?.message ?? err) } };
  }

  const code = res.error ? codeFromRpcError(action, res.error) : codeFromRpc(action, res.data);
  if (res.error) {
    console.error(`[admin/customers] customer.${action}.failed`, {
      request_id: requestId,
      customer_id: input.customerId,
      result: code,
      sqlstate: res.error.code ?? null,
      message: String(res.error.message ?? '').slice(0, 200),
    });
  } else {
    console.info(`[admin/customers] customer.${action}.done`, { request_id: requestId, customer_id: input.customerId, result: code });
  }
  // 失敗與結果不明也重取:結果不明時資料庫可能已經改了, 畫面要能看到新狀態
  revalidatePath('/customers');
  revalidatePath(`/customers/${input.customerId}`);
  return memberActionResult(action, code);
}

export async function disableCustomerAction(input: Input): Promise<MemberActionResult> {
  return run('disable', input);
}

export async function enableCustomerAction(input: Input): Promise<MemberActionResult> {
  return run('enable', input);
}

export async function deleteCustomerAction(input: Input): Promise<MemberActionResult> {
  return run('delete', input);
}
