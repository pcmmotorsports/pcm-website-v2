// 經銷商申請表單的前台部分(B2B 計畫 §9.7)。
// 欄位規則搬到 @pcm/domain(identity/dealer-apply-rules.ts), 後台「新增經銷帳號」用同一份(§9.9 片 D4a)。
export {
  TAIWAN_REGIONS,
  EMPTY_DEALER_APPLY,
  NOTE_MAX,
  normalizeDealerApply,
  validateDealerApply,
} from '@pcm/domain';
export type {
  DealerApplyField,
  DealerApplyValues,
  DealerApplyFieldErrors,
  ValidateResult,
} from '@pcm/domain';

export type SubmitErrorKind =
  | 'already_pending' | 'already_decided' | 'session_expired' | 'account_incomplete' | 'invalid' | 'failed';

export const ALREADY_DECIDED_MESSAGE = '這筆申請已經審核完成，無法再修改。請重新整理查看結果。';

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
