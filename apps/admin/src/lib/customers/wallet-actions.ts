'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
// 相對 import(非 @/):見 session/actor.ts 註解(vitest @ alias 指 storefront)。
import { authorizeAdminMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { adjustCustomerWallet } from './customer-repository';
import { parseWalletAdjustForm } from './wallet-form';

// M-4a 儲值金編輯 server action(🔴 高風險動錢;plan 關卡1 PASS 後實作、鏡像 order-actions 全套紀律)。
//
// 🔴 安全縱深(同 orders 線):
//   ① authorizeAdminMutation(session 自驗/Origin fail-closed/具名 actor;../session/authorize 共用閘);
//   ② 形狀層 parseWalletAdjustForm(UUID/direction 白名單/正整數/備註必填;語意權威在 RPC);
//   ③ 寫入走 admin_adjust_wallet owner RPC(ledger INSERT+audit 同交易、餘額只走 trigger、
//      EXECUTE 僅 service_role;稽核在 RPC、action 不另接);
//   ④ PRG:結果碼 → revalidate + redirect 帶固定 query(?r=saved/not_found/invalid/denied/error);
//      DB error 不外洩瀏覽器、server log 只留摘要(金額/備註不進 log=orders 線 Fable nit-2/7 紀律)。

type ResultCode = 'saved' | 'not_found' | 'invalid' | 'denied' | 'error';

/** 結果碼 → returnTo?r=<code>(PRG;returnTo 已由 parse 限定站內 /customers 路徑)。 */
function redirectWith(returnTo: string, code: ResultCode): never {
  const sep = returnTo.includes('?') ? '&' : '?';
  redirect(`${returnTo}${sep}r=${code}`);
}

export async function adjustWalletAction(formData: FormData): Promise<void> {
  // ① 授權閘(session/Origin/actor)。
  const auth = await authorizeAdminMutation();
  if (!auth) {
    redirectWith('/customers', 'denied');
  }

  // ② 表單 → RPC 參數(形狀層;deposit=+n / use=-n 轉號在此)。
  const parsed = parseWalletAdjustForm(formData);
  if (!parsed.ok) {
    redirectWith('/customers', 'invalid');
  }

  const requestId = await getRequestId();

  // attempt log:僅識別欄位、不記金額/備註(動錢欄位不進 server log;稽核真相在 admin_audit_log)。
  console.info('[admin/customers] customer.wallet.adjust.attempt', {
    request_id: requestId, sid: auth.sid, actor: auth.actorId, customer_id: parsed.customerId,
  });

  let code: ResultCode;
  try {
    const result = await adjustCustomerWallet({
      customerId: parsed.customerId,
      entryType: parsed.entryType,
      signedAmount: parsed.signedAmount,
      note: parsed.note,
      actor: auth.actorId,
      requestId,
    });
    code = result === 'ADJUSTED' ? 'saved' : 'not_found';
  } catch (err) {
    // DB error / RPC 輸入 RAISE(反號/超上界/備註非法等)→ 固定碼、不外洩;server log 只留摘要
    // (不印整個 err 物件:訊息可能回顯輸入值;同 orders 線紀律)。
    const e = err as { code?: unknown; message?: unknown };
    console.error('[admin/customers] 儲值金調整失敗', {
      request_id: requestId,
      code: typeof e.code === 'string' ? e.code : undefined,
      message: String(e.message ?? '').slice(0, 200),
    });
    redirectWith(parsed.returnTo, 'error');
  }

  // 成功路徑 revalidate(明細=餘額+流水;列表快取一併刷);redirect 在 catch 外(不被吞)。
  revalidatePath('/customers');
  revalidatePath(`/customers/${parsed.customerId}`);
  redirectWith(parsed.returnTo, code);
}
