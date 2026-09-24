// 核准 / 婉拒的表單解析與結果訊息(片 D2)。純函式, 給 action 與頁面共用。

export type DealerDecisionCode =
  | 'approved' | 'rejected' | 'stale' | 'already_decided' | 'would_downgrade'
  | 'not_found' | 'invalid' | 'denied' | 'unknown';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 與資料庫同一組空白字元(含全形空白、零寬字元);只剝頭尾
const WS = ' \\t\\r\\n\\f\\v\\u0085\\u00A0\\u1680\\u180E\\u2000-\\u200D\\u2028\\u2029\\u202F\\u205F\\u2060\\u3000\\uFEFF';
const TRIM_RE = new RegExp(`^[${WS}]+|[${WS}]+$`, 'g');
export const DECIDE_NOTE_MAX = 500;

export type ParsedDecision =
  | {
      ok: true;
      applicationId: string;
      decision: 'approve' | 'reject';
      note: string;
      expectedTier: string;
      expectedUpdatedAt: string;
    }
  | { ok: false; reason: 'bad_id' | 'bad_form' };

export function parseDealerDecisionForm(fd: FormData): ParsedDecision {
  const id = String(fd.get('applicationId') ?? '');
  if (!UUID_RE.test(id)) return { ok: false, reason: 'bad_id' };
  const decision = fd.get('decision');
  const note = String(fd.get('note') ?? '').replace(TRIM_RE, '');
  const expectedTier = String(fd.get('expectedTier') ?? '');
  // 🔴 原樣保留(資料庫給的字串, 含微秒), 不轉 Date
  const expectedUpdatedAt = String(fd.get('expectedUpdatedAt') ?? '');
  if (decision !== 'approve' && decision !== 'reject') return { ok: false, reason: 'bad_form' };
  if (!['general', 'store', 'premiumStore'].includes(expectedTier) || Number.isNaN(Date.parse(expectedUpdatedAt))) {
    return { ok: false, reason: 'bad_form' };
  }
  if (decision === 'reject' && note === '') return { ok: false, reason: 'bad_form' };
  if ([...note].length > DECIDE_NOTE_MAX) return { ok: false, reason: 'bad_form' };
  return { ok: true, applicationId: id, decision, note, expectedTier, expectedUpdatedAt };
}

export function dealerDecisionCodeFor(db: string): DealerDecisionCode {
  switch (db) {
    case 'APPROVED': return 'approved';
    case 'REJECTED': return 'rejected';
    case 'STALE': return 'stale';
    case 'ALREADY_DECIDED': return 'already_decided';
    case 'WOULD_DOWNGRADE': return 'would_downgrade';
    case 'NOT_FOUND': return 'not_found';
    default:
      console.error('[admin/dealer-applications] 不認得的結果', { db });
      return 'unknown';
  }
}

/** 結果提示(說已經發生的事;不確定的明說不確定)。 */
export const DEALER_DECISION_MESSAGE: Record<DealerDecisionCode, { tone: 'ok' | 'warn' | 'error'; text: string }> = {
  approved: { tone: 'ok', text: '已核准。' },
  rejected: { tone: 'ok', text: '已婉拒。' },
  stale: { tone: 'warn', text: '這筆申請或帳號等級在你打開之後被改過，沒有儲存。畫面已更新，請確認後再操作一次。' },
  already_decided: { tone: 'warn', text: '這筆申請已經有人處理過了，畫面已更新。' },
  would_downgrade: { tone: 'warn', text: '這個帳號目前是「經銷」，核准會把等級改成「車行」，所以沒有核准。' },
  not_found: { tone: 'error', text: '找不到這筆申請或這個帳號，沒有儲存。' },
  invalid: { tone: 'error', text: '資料不完整，沒有儲存。婉拒要填寫原因，最多 500 字。' },
  denied: { tone: 'error', text: '請先登入員工帳號，再操作核准或婉拒。' },
  unknown: { tone: 'error', text: '無法確認是否已經儲存，請重新整理查看這筆申請目前的狀態。' },
};

/**
 * 網址上的結果只是提示, 不是事實(codex D2 R1 必修):成功兩種要跟申請現在的狀態對得上才顯示,
 * 否則有人帶著 ?r=approved 開一筆還在審核中的申請, 畫面會同時寫「審核中」與「已核准」。
 */
export function decisionBannerFor(code: DealerDecisionCode | null, status: 'pending' | 'approved' | 'rejected'): DealerDecisionCode | null {
  if (code === 'approved' && status !== 'approved') return null;
  if (code === 'rejected' && status !== 'rejected') return null;
  return code;
}

export function parseDecisionCode(v: string | string[] | undefined): DealerDecisionCode | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s !== undefined && Object.hasOwn(DEALER_DECISION_MESSAGE, s) ? (s as DealerDecisionCode) : null;
}
