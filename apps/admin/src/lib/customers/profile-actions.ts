'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
// 相對 import(非 @/):見 session/actor.ts 註解(vitest @ alias 指 storefront)。
import { authorizeAdminMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { getAdminCustomerRepository } from './customer-repository';
import { parseProfileEditForm } from './profile-form';

// M-4b `#25` 片 C1:客人基本資料(姓名/電話/生日)編輯 server action。
// 鏡像 `tier-actions.ts` 全套紀律(授權閘 → 形狀層 → 寫入 → PRG),差別只有寫入路徑。
//
// 🔴 **走 adapter,不走 use-case**(M4 我自裁、主視窗准、A 窗複驗背書):
//   `packages/use-cases/src/update-profile.ts` 全檔的函式本體就是一行 `customerRepo.update(...)`,
//   簽章與 `ICustomerRepository.update`(`ICustomerRepository.ts:26-29`)逐字同一組
//   ⇒ 那層零貢獻,只多一次轉呼 + 兩個 workspace dep。
//
// 🔴 **越權防線在這裡只有一道,而且就是下面那一行 `parsed.customerId`。**
//   admin 注 **service_role = BYPASSRLS** ⇒ storefront 那條「RLS 守 own row」的防線在 admin 路徑**不存在**。
//   真正決定「改到誰」的是表單送來的 `customer_id`(已驗 UUID 形狀)。
//   ⚠️ 這**不是權限外洩** —— 員工本來就能編輯任何客人;風險是**打錯客人**(手滑 / hidden 欄殘留)。
//
// ⚠️ **已知缺口(不擴張,寫在這裡不是忘了)**:本片**不寫 `admin_audit_log`**。
//   tier / 儲值金是 owner RPC 在同交易寫稽核,本片走 adapter ⇒ 沒有那條路;
//   要補得走 app 層 `getAdminAuditLogRepository().record(...)`(先例 `staff-actions.ts:61`,非交易性)。
//   plan 的 8 檔與驗收都沒有這一項 ⇒ **另立案**,不在本片自行擴張。

type ResultCode = 'saved' | 'not_found' | 'invalid' | 'denied' | 'error';

/** 結果碼 → returnTo?r=<code>(PRG;returnTo 已由 parse 限定站內 /customers 路徑)。 */
function redirectWith(returnTo: string, code: ResultCode): never {
  const sep = returnTo.includes('?') ? '&' : '?';
  redirect(`${returnTo}${sep}r=${code}`);
}

export async function updateCustomerProfileAction(formData: FormData): Promise<void> {
  // ① 授權閘(session 自驗 / Origin fail-closed / 具名 actor;原樣沿用、零擴充)。
  const auth = await authorizeAdminMutation();
  if (!auth) {
    redirectWith('/customers', 'denied');
  }

  // ② 形狀層 + 語意層(重複欄位、UUID、ProfileInput;birthday '' → null 也在那裡)。
  const parsed = parseProfileEditForm(formData);
  if (!parsed.ok) {
    redirectWith('/customers', 'invalid');
  }

  const requestId = await getRequestId();

  // attempt log:只留識別欄位。🔴 **姓名 / 電話 / 生日一律不進 log**(PII;同客戶線紀律
  //    —— tier 那支不記原因備註、儲值金那支不記金額)。
  console.info('[admin/customers] customer.profile.update.attempt', {
    request_id: requestId,
    sid: auth.sid,
    actor: auth.actorId,
    customer_id: parsed.customerId,
  });

  let code: ResultCode;
  try {
    await getAdminCustomerRepository().update(parsed.customerId, parsed.patch);
    code = 'saved';
  } catch (err) {
    // adapter 的 `.single()` 查無 row 會回 PGRST116 並被 throw ⇒ 收斂成 not_found;
    // 其餘 DB error → 固定碼、不外洩。server log 只留摘要(不印整個 err:訊息可能回顯輸入值)。
    const e = err as { code?: unknown; message?: unknown };
    const notFound = e.code === 'PGRST116';
    console.error('[admin/customers] 基本資料更新失敗', {
      request_id: requestId,
      code: typeof e.code === 'string' ? e.code : undefined,
      message: String(e.message ?? '').slice(0, 200),
    });
    redirectWith(parsed.returnTo, notFound ? 'not_found' : 'error');
  }

  // 成功路徑 revalidate(明細=基本資料卡;列表姓名欄一併刷);redirect 在 catch 外(不被吞)。
  revalidatePath('/customers');
  revalidatePath(`/customers/${parsed.customerId}`);
  redirectWith(parsed.returnTo, code);
}
