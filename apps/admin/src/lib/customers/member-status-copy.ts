// 後台停用 / 恢復 / 刪除會員的文案與結果對照(計畫 ~/pcm-mailbox/計畫-後台刪除停用會員-20260926.md 第九節)。
// 不放 server-only:伺服器動作與詳情頁面板共用;這裡只有純函式,沒有資料庫。
import { isConnectionClass } from '../orders/payment-reverse-state';

export type MemberAction = 'disable' | 'enable' | 'delete';

/**
 * 資料庫回的結果碼(20260926100000 四支函式的 RETURN 值),加上伺服器動作自己的三種失敗:
 * denied(不是老闆)、invalid(原因沒填或太長)、error(資料庫明確回錯誤)、unknown(沒收到回應, 不知道有沒有做完)。
 */
export type MemberActionCode =
  | 'OK'
  | 'DELETED'
  | 'NO_CHANGE'
  | 'STALE'
  | 'NOT_FOUND'
  | 'HAS_RECORDS'
  | 'denied'
  | 'invalid'
  | 'error'
  | 'unknown';

export type MemberActionResult = { ok: boolean; code: MemberActionCode; message: string };

export const MEMBER_REASON_MAX = 200;

export const MEMBER_CONFIRM_COPY: Record<MemberAction, string> = {
  disable: '停用後，這位會員無法登入，也不會出現在會員列表。訂單與儲值金紀錄都會保留，之後可以恢復。',
  enable: '恢復後，這位會員可以重新登入，也會回到會員列表。',
  delete: '刪除後無法復原。會一併刪除這位會員的登入帳號、地址、車款與收藏。',
};

export const MEMBER_CONFIRM_BUTTON: Record<MemberAction, string> = {
  disable: '確定停用會員',
  enable: '確定恢復會員',
  delete: '確定刪除會員',
};

/** 不能刪除的原因(代碼 = pcm_customer_delete_blockers 的回傳)。認不得的代碼原樣顯示, 不藏。 */
const DELETE_BLOCKER_LABEL: Record<string, string> = {
  orders: '訂單',
  shipments: '出貨紀錄',
  coupon_redemptions: '優惠券使用紀錄',
  wallet_ledger: '儲值金紀錄',
  wallet_balance: '儲值金餘額',
  payment_charge_attempts: '刷卡紀錄',
  payment_double_charge_anomalies: '重複扣款紀錄',
  dealer_applications: '經銷申請',
  dealer_brand_discounts: '品牌折扣',
  dealer_tier: '會員等級是車行或經銷',
};

export function deleteBlockedText(reasons: readonly string[]): string {
  return `這位會員有下列紀錄，只能停用：${reasons.map((r) => DELETE_BLOCKER_LABEL[r] ?? r).join('、')}。`;
}

const UNKNOWN = '無法確認這次操作是否完成，請重新整理頁面確認會員狀態，再決定要不要重新操作。';
const STALE = '這位會員的狀態在你打開頁面之後已經改過（可能是你剛才的操作已經完成，或其他人改過），請重新整理，確認目前狀態後再決定。';

const MESSAGES: Record<MemberAction, Partial<Record<MemberActionCode, string>>> = {
  disable: {
    OK: '已停用會員。',
    NO_CHANGE: '這位會員已經是停用狀態。',
    error: '停用沒有完成，請重新整理後再試一次。如果仍然失敗，請聯絡系統管理員。',
  },
  enable: {
    OK: '已恢復會員。',
    NO_CHANGE: '這位會員已經是正常狀態。',
    error: '恢復沒有完成，請重新整理後再試一次。如果仍然失敗，請聯絡系統管理員。',
  },
  delete: {
    DELETED: '已刪除會員。',
    HAS_RECORDS: '刪除沒有完成：這位會員剛好有新的紀錄。請重新整理查看原因，改用停用。',
    unknown: '無法確認這次刪除是否完成，請重新整理頁面。若頁面顯示找不到這位客戶，代表已經刪除；若會員還在，再決定要不要重新操作。',
    error: '刪除沒有完成，請重新整理後再試一次。如果仍然失敗，請聯絡系統管理員。',
  },
};

const COMMON: Partial<Record<MemberActionCode, string>> = {
  STALE,
  NOT_FOUND: '找不到這位會員，可能已經被刪除。請回到客戶列表確認。',
  denied: '請先登入員工帳號；只有管理者可以停用、恢復或刪除會員。',
  invalid: `請填寫原因（${MEMBER_REASON_MAX} 字以內）。`,
  unknown: UNKNOWN,
};

const SUCCESS: ReadonlySet<MemberActionCode> = new Set(['OK', 'DELETED', 'NO_CHANGE']);

export function memberActionResult(action: MemberAction, code: MemberActionCode): MemberActionResult {
  const message = MESSAGES[action][code] ?? COMMON[code] ?? MESSAGES[action].error ?? UNKNOWN;
  return { ok: SUCCESS.has(code), code, message };
}

/** 資料庫回的字串 ⇒ 結果碼;認不得的值當成 error(資料庫有回應, 但不是我們認得的答案)。 */
export function codeFromRpc(action: MemberAction, value: unknown): MemberActionCode {
  const allowed: readonly MemberActionCode[] =
    action === 'delete' ? ['DELETED', 'HAS_RECORDS', 'NOT_FOUND'] : ['OK', 'NO_CHANGE', 'STALE', 'NOT_FOUND'];
  return allowed.includes(value as MemberActionCode) ? (value as MemberActionCode) : 'error';
}

/**
 * 資料庫回錯誤時的分類(順序照 payment-reverse-state.ts 的 reverseFailureCodeFor;Fable 第 4 片 R1 必修 1):
 *   沒有碼(連線斷掉、逾時, 沒收到回應)⇒ unknown:資料庫可能已經做完, 不能說「沒有完成」
 *   刪除遇到外鍵擋下(23503)⇒ HAS_RECORDS
 *   連線類(08*、57P0*、PGRST000-003, 可能在 COMMIT 之後才斷)⇒ unknown
 *   其他(資料庫明確拒絕、PGRST202 函式不存在等)⇒ error:確定沒有執行
 */
export function codeFromRpcError(action: MemberAction, error: { code?: unknown } | null | undefined): MemberActionCode {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === '') return 'unknown';
  if (action === 'delete' && code === '23503') return 'HAS_RECORDS';
  if (isConnectionClass(code)) return 'unknown';
  return 'error';
}

/** 原因:去掉前後空白後 1–200 字、不含控制字元(與資料庫的檢查同一把尺)。 */
export function parseMemberReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const reason = raw.trim();
  if (reason === '' || reason.length > MEMBER_REASON_MAX || /[\u0000-\u001f\u007f]/.test(reason)) return null;
  return reason;
}
