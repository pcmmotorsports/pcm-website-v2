'use server';

// 商品文字「我們的版本」的 server action(商品編輯丙方案片 2;商品頁改版乙 B3 改成三欄一次儲存)。
// 授權 → 解析三欄 → 逐欄呼叫 RPC(每欄各自同交易寫稽核, 逐欄留紀錄)→ revalidate → 回傳逐欄結果。
// 🔴 Sean 2026-09-27 C4 甲:所有員工都能改 ⇒ authorizeAdminMutation(不是主管閘);變更紀錄由 RPC 寫。
// 🔴 B3(計畫 ~/pcm-mailbox/計畫-後台商品頁乙-20260928.md 第五節):
//    · 登入與 Origin 由 authorizeAdminMutation 檢查;操作人取自 session, 不收前端傳來的;request id 由 server 產生。
//    · 不 redirect:存完停在原位(useActionState 拿回結果), 大標題靠 revalidatePath 換成客人看到的標題。
//    · 三欄共用同一個 request id:稽核紀錄查得到「這三筆是同一次儲存」(admin_audit_log.request_id 不是唯一鍵)。
//    · 有一欄出錯, 其他欄照送;結果逐欄回報, 畫面講清楚是哪一欄(文字在 product-overrides-form.ts 的 describeTextSave)。
//    · 找不到商品 ⇒ 停下, 不送後面的欄。
//    · 畫面上沒動過的欄位不送:存標題時不會用舊內容蓋掉別人剛改的副標(三欄同一個表單之後才有的風險)。
// 原本一欄一個表單的 setProductOverrideAction 在 B3 移除(畫面上已沒有入口)。

import { revalidatePath } from 'next/cache';
import { authorizeAdminMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { setProductOverride } from './product-repository';
import {
  OVERRIDE_FIELDS,
  OVERRIDE_FIELD_LABEL,
  parseOverrideTextForm,
  type OverrideField,
  type OverrideFieldOutcome,
  type TextSaveState,
} from './product-overrides-form';

export async function saveProductTextAction(_prev: TextSaveState, formData: FormData): Promise<TextSaveState> {
  const auth = await authorizeAdminMutation();
  if (!auth) {
    return {
      kind: 'failed',
      message: '沒有儲存：登入已過期，或這個帳號目前不能修改商品。請重新登入後再試；仍無法儲存時請聯絡系統管理員。',
    };
  }

  const parsed = parseOverrideTextForm(formData);
  if (!parsed.ok) {
    return {
      kind: 'failed',
      message:
        parsed.badField === null
          ? '沒有儲存：表單資料不完整，請重新整理頁面後再試。'
          : `沒有儲存：${OVERRIDE_FIELD_LABEL[parsed.badField]}字數超過上限，或含有不能使用的字元。請修改後再儲存。`,
    };
  }

  const requestId = await getRequestId();
  const results: { field: OverrideField; outcome: OverrideFieldOutcome }[] = [];
  for (const field of OVERRIDE_FIELDS) {
    // 畫面上沒動過的欄位不送(見 OVERRIDE_UNCHANGED_FIELD):不用舊內容蓋掉別人剛改的。
    if (parsed.unchanged.includes(field)) {
      results.push({ field, outcome: 'noop' });
      continue;
    }
    const value = parsed.values[field];
    console.info('[admin/products] product.override.change.attempt', {
      request_id: requestId,
      sid: auth.sid,
      actor: auth.actorId,
      product_id: parsed.productId,
      field,
      restore: value === null,
    });
    try {
      const r = await setProductOverride({ productId: parsed.productId, field, value, actor: auth.actorId, requestId });
      if (r === 'NOT_FOUND') {
        // Codex R1 nit:第一欄之後才查無商品(存到一半被刪)時, 前面的欄位可能已處理, 不能說「本次未儲存」。
        return {
          kind: 'failed',
          message:
            // 前面只有「沒動過(沒送)」的欄位時, 其實什麼都沒寫(Fable R2 nit)。
            !results.some((x) => x.outcome === 'saved' || x.outcome === 'restored' || x.outcome === 'error')
              ? '找不到這件商品，可能已被刪除。本次未儲存，請回商品列表重新查詢。'
              : `找不到這件商品，可能剛被刪除。${OVERRIDE_FIELD_LABEL[field]}和後面的欄位沒有儲存，請回商品列表重新查詢。`,
        };
      }
      results.push({ field, outcome: r === 'NO_CHANGE' ? 'noop' : value === null ? 'restored' : 'saved' });
    } catch (err) {
      const e = err as { code?: unknown; message?: unknown };
      const message = String(e.message ?? '');
      console.error('[admin/products] 商品文字儲存失敗', {
        request_id: requestId,
        field,
        code: typeof e.code === 'string' ? e.code : undefined,
        message: message.slice(0, 200),
      });
      // RPC 自己 RAISE 的(內容不合規則)開頭都是函式名;停用員工被擋是「無權執行此操作」(同 20260927020000 的字面);
      // 其餘(連線、RPC 不存在)一律當「無法確認」。
      results.push({
        field,
        outcome:
          message === '無權執行此操作' ? 'denied' : message.startsWith('admin_set_product_override:') ? 'invalid' : 'error',
      });
    }
  }

  // 有一欄可能已寫入(存了、還原了、或結果無法確認)就重新整理頁面資料;都沒寫入就不必。
  if (results.some((r) => r.outcome === 'saved' || r.outcome === 'restored' || r.outcome === 'error')) {
    revalidatePath(`/products/${parsed.productId}`);
    // 列表顯示的是客人看到的標題(商品頁改版乙 A1)⇒ 列表也重新取得(同 product-listing-actions.ts)。
    revalidatePath('/products');
  }
  return { kind: 'done', results };
}
