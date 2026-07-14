'use server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
// 相對 import(非 @/):見 session/actor.ts 註解(vitest @ alias 指 storefront)。
import { ADMIN_SESS_COOKIE, verifySession } from '../session/session';
import { getSessionActor } from '../session/actor';
import { getRequestId } from '../audit/context';
import { getAdminOrderStatusOptionsRepository, getAdminAuditLogRepository } from './order-repository';
import {
  isAllowedOrigin,
  parseStatusOptionEditForm,
  parseStatusOptionCreateForm,
} from './status-option-form';

// M-4a Slice D-3 狀態選項設定 server action(編輯既有 order_status_options:label/color/text_color/sort_order/is_active)。
//
// 🔴 安全縱深(鏡像 Slice C 三閘;不只靠 proxy 登入閘):
//   ① verifySession(cookie) 自驗 —— 無效票證 → 拒;
//   ② Origin fail-closed —— 缺 Origin 即拒 + 精確等值(dev 走 ADMIN_DEV_BYPASS localhost);
//   ③ actor 具名身分 —— picker cookie(缺=拒);
//   ④ 寫入走 service_role UPDATE(order_status_options column-level grant 已收窄至 5 欄、code/created_at 凍結);
//   ⑤ PRG:結果碼 → revalidate + redirect(?r=saved/notfound/invalid/denied/error);DB error 不外洩、server log 留 request_id。
// 🔴 審計:成功變更寫 admin_audit_log(D-3b;透過 SupabaseAuditLogRepository.record() **直呼**、重用本 action
//   已驗的 actor/requestId〔避 buildAuditContext 重取 getSessionActor+null-throw、保證 audit actor==authz actor〕;
//   log-and-continue=稽核失敗不擋使用者);attempt log(console.info)記每次嘗試含失敗。
// 固定 redirect 回 /settings/order-statuses(單一設定頁、無 return_to → 零 open-redirect 面)。

const SETTINGS_PATH = '/settings/order-statuses';

const DEV_BYPASS =
  process.env.NODE_ENV !== 'production' && process.env.ADMIN_DEV_BYPASS === '1';

type ResultCode = 'saved' | 'created' | 'notfound' | 'duplicate' | 'invalid' | 'denied' | 'error';

/** 結果碼 → /settings/order-statuses?r=<code>(PRG;固定站內路徑、無 open-redirect 面)。 */
function redirectWith(code: ResultCode): never {
  redirect(`${SETTINGS_PATH}?r=${code}`);
}

export async function updateStatusOptionAction(formData: FormData): Promise<void> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);

  // ① session 自驗(fail-closed)。
  const session = await verifySession(cookieStore.get(ADMIN_SESS_COOKIE)?.value);
  if (!session) {
    redirectWith('denied');
  }

  // ② Origin fail-closed。
  if (!isAllowedOrigin(headerStore.get('origin'), { devBypass: DEV_BYPASS })) {
    redirectWith('denied');
  }

  // ③ 具名身分(picker;缺=拒)。
  const actor = await getSessionActor();
  if (!actor) {
    redirectWith('denied');
  }

  const parsed = parseStatusOptionEditForm(formData);
  if (!parsed.ok) {
    redirectWith('invalid');
  }

  const requestId = await getRequestId();

  // attempt log(每次嘗試、僅識別欄位;成功變更另寫 admin_audit_log,見下)。
  console.info('[admin/settings] order_status_option.update.attempt', {
    request_id: requestId,
    sid: session.sid,
    actor: actor.id,
    code: parsed.code,
  });

  let code: ResultCode;
  try {
    const result = await getAdminOrderStatusOptionsRepository().updateOrderStatusOption(
      parsed.code,
      parsed.update,
    );
    code = result === 'UPDATED' ? 'saved' : 'notfound';
  } catch (err) {
    // DB error / CHECK violation → 固定碼、不外洩;server log 只留摘要(不印整個 err:轉型錯誤可能回顯輸入值)。
    const e = err as { code?: unknown; message?: unknown };
    console.error('[admin/settings] 狀態選項更新失敗', {
      request_id: requestId,
      code: typeof e.code === 'string' ? e.code : undefined,
      message: String(e.message ?? '').slice(0, 200),
    });
    redirectWith('error');
  }

  // 🔴 成功變更寫 admin_audit_log(D-3b);log-and-continue:稽核失敗不擋使用者(變更已生效),只 server log。
  if (code === 'saved') {
    try {
      await getAdminAuditLogRepository().record(
        {
          action: 'order_status_option.update',
          target: `order_status_option:${parsed.code}`,
          after: parsed.update,
        },
        { actor: actor.id, requestId, sourceApp: 'admin' },
      );
    } catch (auditErr) {
      console.error('[admin/settings] 稽核寫入失敗(變更已生效、不擋使用者)', {
        request_id: requestId,
        message: String((auditErr as { message?: unknown }).message ?? '').slice(0, 200),
      });
    }
  }

  revalidatePath(SETTINGS_PATH);
  redirectWith(code);
}

/**
 * 新增狀態選項(M-4a Slice D-3c;鏡像 update 三閘 + 稽核;code 由使用者輸入=中性 slug)。
 * INSERT 成功='created';code 重複(PK 23505)='duplicate'(友善碼、非 error)。
 */
export async function createStatusOptionAction(formData: FormData): Promise<void> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);

  // ① session 自驗、② Origin fail-closed、③ 具名 actor(鏡像 update;缺任一 → denied)。
  const session = await verifySession(cookieStore.get(ADMIN_SESS_COOKIE)?.value);
  if (!session) {
    redirectWith('denied');
  }
  if (!isAllowedOrigin(headerStore.get('origin'), { devBypass: DEV_BYPASS })) {
    redirectWith('denied');
  }
  const actor = await getSessionActor();
  if (!actor) {
    redirectWith('denied');
  }

  const parsed = parseStatusOptionCreateForm(formData);
  if (!parsed.ok) {
    redirectWith('invalid');
  }

  const requestId = await getRequestId();
  console.info('[admin/settings] order_status_option.create.attempt', {
    request_id: requestId,
    sid: session.sid,
    actor: actor.id,
    code: parsed.input.code,
  });

  let code: ResultCode;
  try {
    const result = await getAdminOrderStatusOptionsRepository().createOrderStatusOption(parsed.input);
    code = result === 'CREATED' ? 'created' : 'duplicate';
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown };
    console.error('[admin/settings] 狀態選項新增失敗', {
      request_id: requestId,
      code: typeof e.code === 'string' ? e.code : undefined,
      message: String(e.message ?? '').slice(0, 200),
    });
    redirectWith('error');
  }

  // 🔴 成功新增寫 admin_audit_log(重用 D-3b 基建;log-and-continue)。
  if (code === 'created') {
    try {
      await getAdminAuditLogRepository().record(
        {
          action: 'order_status_option.create',
          target: `order_status_option:${parsed.input.code}`,
          after: parsed.input,
        },
        { actor: actor.id, requestId, sourceApp: 'admin' },
      );
    } catch (auditErr) {
      console.error('[admin/settings] 稽核寫入失敗(新增已生效、不擋使用者)', {
        request_id: requestId,
        message: String((auditErr as { message?: unknown }).message ?? '').slice(0, 200),
      });
    }
  }

  revalidatePath(SETTINGS_PATH);
  redirectWith(code);
}
