// 經銷商申請表單的欄位規則(B2B 計畫 §9.7「八個欄位的輸入規則」)。
// 🔴 規則要與資料庫 CHECK 一致(supabase/migrations/20260925010000_m4b_dealer_applications.sql):
//   前台逐格先擋、server action 再擋一次、資料庫是最後一道。改這裡要一起看那支 migration。
// 純函式:client 表單與 server action 共用同一份, 不各寫一份。

/** 22 個縣市, 照內政部名稱用「臺」(資料庫 CHECK 同一份清單)。 */
export const TAIWAN_REGIONS = [
  '臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '基隆市', '新竹市', '嘉義市',
  '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣',
  '臺東縣', '澎湖縣', '金門縣', '連江縣',
] as const;

export type DealerApplyField =
  | 'companyName' | 'taxId' | 'storeName' | 'region'
  | 'contactName' | 'contactPhone' | 'contactEmail' | 'note';

export type DealerApplyValues = Record<DealerApplyField, string>;
export type DealerApplyFieldErrors = Partial<Record<DealerApplyField, string>>;

export const EMPTY_DEALER_APPLY: DealerApplyValues = {
  companyName: '', taxId: '', storeName: '', region: '',
  contactName: '', contactPhone: '', contactEmail: '', note: '',
};

export const NOTE_MAX = 500;

// 與資料庫那支函式同一組空白字元(含全形空白、零寬字元), 只剝頭尾。
const WS = ' \\t\\r\\n\\f\\v\\u0085\\u00A0\\u1680\\u180E\\u2000-\\u200D\\u2028\\u2029\\u202F\\u205F\\u2060\\u3000\\uFEFF';
const TRIM_RE = new RegExp(`^[${WS}]+|[${WS}]+$`, 'g');
const trim = (s: string) => s.replace(TRIM_RE, '');
/** 照字元(code point)算長度, 與資料庫 char_length 一致;擴充區漢字、emoji 不會被算成 2 個字。 */
const len = (s: string) => [...s].length;

export function normalizeDealerApply(v: DealerApplyValues): DealerApplyValues {
  return {
    companyName: trim(v.companyName),
    taxId: v.taxId.replace(new RegExp(`[${WS}]`, 'g'), ''),
    storeName: trim(v.storeName),
    region: trim(v.region),
    contactName: trim(v.contactName),
    contactPhone: trim(v.contactPhone),
    contactEmail: trim(v.contactEmail),
    note: trim(v.note),
  };
}

export type ValidateResult =
  | { ok: true; values: DealerApplyValues }
  | { ok: false; fieldErrors: DealerApplyFieldErrors; values: DealerApplyValues };

export function validateDealerApply(raw: DealerApplyValues): ValidateResult {
  const v = normalizeDealerApply(raw);
  const e: DealerApplyFieldErrors = {};
  if (v.companyName === '') e.companyName = '請填寫公司或商號名稱。';
  else if (len(v.companyName) > 100) e.companyName = '公司或商號名稱最多 100 字。';
  if (!/^[0-9]{8}$/.test(v.taxId)) e.taxId = '統一編號是 8 位數字，請再確認一次。';
  if (len(v.storeName) > 100) e.storeName = '店名最多 100 字。';
  if (!(TAIWAN_REGIONS as readonly string[]).includes(v.region)) e.region = '請選擇營業地區。';
  if (v.contactName === '') e.contactName = '請填寫聯絡人姓名。';
  else if (len(v.contactName) > 50) e.contactName = '聯絡人姓名最多 50 字。';
  const digits = v.contactPhone.replace(/[^0-9]/g, '').length;
  if (v.contactPhone.length > 30 || !/^[0-9 ()+-]+$/.test(v.contactPhone) || digits < 8 || digits > 10) {
    e.contactPhone = '請填寫可以聯絡到您的電話號碼。';
  }
  if (v.contactEmail.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.contactEmail)) {
    e.contactEmail = 'Email 格式不正確，請再確認一次。';
  }
  if (len(v.note) > NOTE_MAX) e.note = `需求說明最多 ${NOTE_MAX} 字，目前 ${len(v.note)} 字。`;
  return Object.keys(e).length === 0 ? { ok: true, values: v } : { ok: false, fieldErrors: e, values: v };
}

export type SubmitErrorKind = 'already_pending' | 'session_expired' | 'account_incomplete' | 'invalid' | 'failed';

/** 資料庫錯誤碼 ⇒ 給客人看的訊息(§9.7「送出時」)。原因不明的一律給可重試的通用訊息。 */
export function mapSubmitError(err: { code?: string | null } | null | undefined): { kind: SubmitErrorKind; message: string } {
  switch (err?.code) {
    case '23505':
      return { kind: 'already_pending', message: '您已經有一筆申請在審核中，不需要重新送出。' };
    case '28000':
      return { kind: 'session_expired', message: '登入已過期，請重新登入後再送出。您填的資料不會保存。' };
    case '23503':
      return { kind: 'account_incomplete', message: '您的會員資料不完整，暫時無法送出申請。請聯絡 PCM 業務協助處理。' };
    case '23514':
      return { kind: 'invalid', message: '有欄位的格式不正確，請檢查後再送出。' };
    default:
      return { kind: 'failed', message: '申請送出失敗，請稍後再試一次。若仍無法送出，請直接聯絡 PCM 業務。' };
  }
}
