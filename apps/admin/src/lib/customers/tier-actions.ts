'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
// 相對 import(非 @/):見 session/actor.ts 註解(vitest @ alias 指 storefront)。
import { authorizeAdminMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { setCustomerTier } from './customer-repository';
import { parseTierEditForm } from './tier-form';

// M-4a tier 編輯 server action(🔴 高風險件#3;plan 關卡1 R1 PASS+Sean Q1=A/Q2=A 拍板後實作、
// 鏡像 wallet-actions 全套紀律)。
//
// 🔴 安全縱深(同客戶線儲值金片):
//   ① authorizeAdminMutation(session 自驗/Origin fail-closed/具名 actor;Q1=A=本片不 step-up、
//      不查 amr/auth_time,step-up 全套另片〔前置=報價單側不變 auth_time〕);
//   ② 形狀層 parseTierEditForm(UUID/tier 三檔白名單/原因必填;語意權威在 RPC);
//   ③ 寫入走 admin_set_customer_tier owner RPC(UPDATE 單欄+audit 同交易、同值 NO_CHANGE 零寫入、
//      EXECUTE 僅 service_role;稽核在 RPC、action 不另接);
//   ④ PRG:結果碼 → revalidate + redirect 帶固定 query(?r=saved/noop/not_found/invalid/denied/error);
//      DB error 不外洩瀏覽器、server log 只留識別欄位(原因備註不進 log=verdict N3)。

type ResultCode = 'saved' | 'noop' | 'not_found' | 'invalid' | 'denied' | 'error';

/** 結果碼 → returnTo?r=<code>(PRG;returnTo 已由 parse 限定站內 /customers 路徑)。 */
function redirectWith(returnTo: string, code: ResultCode): never {
  const sep = returnTo.includes('?') ? '&' : '?';
  redirect(`${returnTo}${sep}r=${code}`);
}

export async function setTierAction(formData: FormData): Promise<void> {
  // ① 授權閘(session/Origin/actor;Q1=A 原樣沿用、零擴充)。
  const auth = await authorizeAdminMutation();
  if (!auth) {
    redirectWith('/customers', 'denied');
  }

  // ② 表單 → RPC 參數(形狀層)。
  const parsed = parseTierEditForm(formData);
  if (!parsed.ok) {
    redirectWith('/customers', 'invalid');
  }

  const requestId = await getRequestId();

  // attempt log:僅識別欄位+目標 tier(非敏感 enum 值;原因備註不進 log,稽核真相在 admin_audit_log)。
  console.info('[admin/customers] customer.tier.change.attempt', {
    request_id: requestId, sid: auth.sid, actor: auth.actorId,
    customer_id: parsed.customerId, tier: parsed.tier,
  });

  let code: ResultCode;
  try {
    const result = await setCustomerTier({
      customerId: parsed.customerId,
      tier: parsed.tier,
      note: parsed.note,
      actor: auth.actorId,
      requestId,
    });
    code = result === 'UPDATED' ? 'saved' : result === 'NO_CHANGE' ? 'noop' : 'not_found';
  } catch (err) {
    // DB error / RPC 輸入 RAISE(非法 tier/原因非法等)→ 固定碼、不外洩;server log 只留摘要
    // (不印整個 err 物件:訊息可能回顯輸入值;同客戶線紀律)。
    const e = err as { code?: unknown; message?: unknown };
    console.error('[admin/customers] tier 變更失敗', {
      request_id: requestId,
      code: typeof e.code === 'string' ? e.code : undefined,
      message: String(e.message ?? '').slice(0, 200),
    });
    redirectWith(parsed.returnTo, 'error');
  }

  // 成功路徑 revalidate(明細=標籤+基本資料;列表 tier 欄一併刷);redirect 在 catch 外(不被吞)。
  revalidatePath('/customers');
  revalidatePath(`/customers/${parsed.customerId}`);
  redirectWith(parsed.returnTo, code);
}
