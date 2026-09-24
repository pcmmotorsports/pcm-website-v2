'use server';

// 送出經銷商申請(B2B 計畫 §9.7「送出時」)。
// 身分由資料庫函式自己取 auth.uid(), 這裡不傳任何 user id(20260925010000:dealer_application_submit)。
// 🔴 寫入前先 getVerifiedUser():沒有登入就直接回「登入已過期」, 不送到資料庫 ——
//    等資料庫報錯再判斷會落到「其他失敗」而叫客人重試, 而重試永遠不會成功(計畫 R4)。
import { revalidatePath } from 'next/cache';
import { getVerifiedUser } from '@/lib/auth/verified-user';
import {
  ALREADY_DECIDED_MESSAGE,
  mapSubmitError,
  validateDealerApply,
  type DealerApplyFieldErrors,
  type DealerApplyValues,
  type SubmitErrorKind,
} from '@/lib/dealer-apply/form';

export type SubmitDealerApplicationResult =
  | { ok: true }
  | { ok: false; kind: SubmitErrorKind; message: string; fieldErrors?: DealerApplyFieldErrors };

const FIELDS = ['companyName', 'taxId', 'storeName', 'region', 'contactName', 'contactPhone', 'contactEmail', 'note'] as const;

function isValues(v: unknown): v is DealerApplyValues {
  return typeof v === 'object' && v !== null && FIELDS.every((k) => typeof (v as Record<string, unknown>)[k] === 'string');
}

export async function submitDealerApplicationAction(input: DealerApplyValues): Promise<SubmitDealerApplicationResult> {
  if (!isValues(input)) {
    return { ok: false, kind: 'invalid', message: '有欄位的格式不正確，請檢查後再送出。' };
  }
  const { supabase, user } = await getVerifiedUser();
  if (!user) {
    const m = mapSubmitError({ code: '28000' });
    return { ok: false, kind: m.kind, message: m.message };
  }
  const checked = validateDealerApply(input);
  if (!checked.ok) {
    return { ok: false, kind: 'invalid', message: '有欄位需要修正，請看各欄下方的說明。', fieldErrors: checked.fieldErrors };
  }
  const v = checked.values;
  const { error } = await supabase.rpc('dealer_application_submit', {
    p_company_name: v.companyName,
    p_tax_id: v.taxId,
    p_store_name: v.storeName,
    p_region: v.region,
    p_contact_name: v.contactName,
    p_contact_phone: v.contactPhone,
    p_contact_email: v.contactEmail,
    p_note: v.note,
  });
  if (error) {
    const m = mapSubmitError(error);
    if (m.kind === 'failed') console.error('[dealer-apply] 送出失敗', { code: error.code, message: error.message });
    return { ok: false, kind: m.kind, message: m.message };
  }
  revalidatePath('/dealer-apply');
  return { ok: true };
}

const UPDATE_FAILED_MESSAGE = '修改沒有儲存成功，請稍後再試一次。若仍無法儲存，請直接聯絡 PCM 業務。';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 修改自己【審核中】的申請(片 B2)。
 * 資料庫函式只改「本人 + 審核中」那一筆, 回 true / false;false = 沒這一筆、不是他的、或員工剛審完。
 * 🔴 false 一定要顯示「已經審核完成」, 不能說「已更新」(§9.7「修改申請資料」)。
 */
export async function updateDealerApplicationAction(
  id: string,
  input: DealerApplyValues,
): Promise<SubmitDealerApplicationResult> {
  if (typeof id !== 'string' || !UUID_RE.test(id) || !isValues(input)) {
    return { ok: false, kind: 'invalid', message: '有欄位的格式不正確，請檢查後再送出。' };
  }
  const { supabase, user } = await getVerifiedUser();
  if (!user) {
    const m = mapSubmitError({ code: '28000' });
    return { ok: false, kind: m.kind, message: m.message };
  }
  const checked = validateDealerApply(input);
  if (!checked.ok) {
    return { ok: false, kind: 'invalid', message: '有欄位需要修正，請看各欄下方的說明。', fieldErrors: checked.fieldErrors };
  }
  const v = checked.values;
  const { data, error } = await supabase.rpc('dealer_application_update_mine', {
    p_id: id,
    p_company_name: v.companyName,
    p_tax_id: v.taxId,
    p_store_name: v.storeName,
    p_region: v.region,
    p_contact_name: v.contactName,
    p_contact_phone: v.contactPhone,
    p_contact_email: v.contactEmail,
    p_note: v.note,
  });
  if (error) {
    const m = mapSubmitError(error);
    if (m.kind === 'failed') {
      console.error('[dealer-apply] 修改失敗', { code: error.code, message: error.message });
      return { ok: false, kind: 'failed', message: UPDATE_FAILED_MESSAGE };
    }
    return { ok: false, kind: m.kind, message: m.message };
  }
  if (data === false) return { ok: false, kind: 'already_decided', message: ALREADY_DECIDED_MESSAGE };
  if (data !== true) {
    console.error('[dealer-apply] 修改回傳值不是 true / false', { data });
    return { ok: false, kind: 'failed', message: UPDATE_FAILED_MESSAGE };
  }
  revalidatePath('/dealer-apply');
  return { ok: true };
}
