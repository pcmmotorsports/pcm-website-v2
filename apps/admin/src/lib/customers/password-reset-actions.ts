'use server';

// 替客人寄重設密碼信(B2B 計畫 §9.9 片 D4b)。在職員工都可以按(authorizeAdminMutation:員工身分 + Origin)。
// 順序:查收件人(由 customer ID 查, 不收表單的 Email)→ 資料庫搶這一格(鎖住客人, 60 秒內或兩人同時按只有一個 OK)
//      → 寄信 → 寫一筆結果稽核(accepted / failed / unknown;只記結果不記連結)。
import { redirect } from 'next/navigation';
import { authorizeAdminMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { getAdminAuditLogRepository } from '../orders/order-repository';
import {
  AUDIT_TIMEOUT_MS,
  claimPasswordReset,
  readAuthEmail,
  readPasswordResetTarget,
  sendPasswordResetEmail,
  withTimeout,
} from './password-reset-repository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Code =
  | 'sent' | 'sent_audit_failed' | 'too_soon' | 'failed' | 'unknown' | 'unknown_audit_failed'
  | 'not_eligible' | 'mismatch' | 'stale' | 'not_found' | 'denied' | 'invalid' | 'error';

function back(customerId: string, code: Code): never {
  redirect(`/customers/${customerId}?r=customer_pwreset_${code}`);
}

export async function sendPasswordResetAction(formData: FormData): Promise<void> {
  const customerId = String(formData.get('customer_id') ?? '');
  const auth = await authorizeAdminMutation();
  if (!UUID_RE.test(customerId)) redirect('/customers?r=customer_pwreset_invalid');
  if (!auth) back(customerId, 'denied');

  const requestId = await getRequestId();
  const t = await readPasswordResetTarget(customerId);
  if (t.kind === 'failed') back(customerId, 'error');
  if (t.kind !== 'ok') back(customerId, t.kind);
  // 員工在確認視窗上看到的那個 Email(開頁當時的值)⇒ 跟現在的不同就不寄, 叫他重新整理(Codex D4b R2 nit)
  const shown = String(formData.get('shown_email') ?? '');
  if (shown.toLowerCase() !== t.email.toLowerCase()) back(customerId, 'stale');

  let claimed: string;
  try {
    claimed = await claimPasswordReset({ customerId, actor: auth.actorId, requestId });
  } catch (err) {
    console.error('[password-reset] 搶格失敗(沒有寄信)', { request_id: requestId, code: (err as { code?: unknown })?.code });
    back(customerId, 'error');
  }
  if (claimed === 'TOO_SOON') back(customerId, 'too_soon');
  if (claimed !== 'OK') back(customerId, 'not_found');

  let outcome = await sendPasswordResetEmail(t.email);
  // 🔴 寄送期間登入 Email 被別的員工改掉 ⇒ 不能確定寄到的是這位客人 ⇒ 結果不明(Codex D4b R1)
  //    讀不到 / 逾時也一樣算不明:只有重讀到【同一個】Email 才保留 accepted(R2)
  if (outcome === 'accepted') {
    const now = await readAuthEmail(customerId);
    if (now === null || now.toLowerCase() !== t.email.toLowerCase()) {
      console.error('[password-reset] 寄完無法確認登入 Email 沒被改過, 結果改記為不明', { request_id: requestId, customer_id: customerId });
      outcome = 'unknown';
    }
  }
  // 🔴 稽核寫入失敗或逾時(R3)⇒ 結果至少留在 server log(不含 Email), 畫面也要講「操作紀錄沒有確認寫入」;不重寄。
  const audited = await withTimeout(
    getAdminAuditLogRepository()
      .record(
        { action: 'customer.password_reset.sent', target: `customer:${customerId}`, after: { outcome } },
        { actor: auth.actorId, requestId, sourceApp: 'admin' },
      )
      .then(
        () => true,
        () => false,
      ),
    AUDIT_TIMEOUT_MS,
    false,
  );
  if (!audited) {
    console.error('[password-reset] 結果稽核沒有確認寫入', { request_id: requestId, customer_id: customerId, outcome });
  }
  if (outcome === 'accepted') back(customerId, audited ? 'sent' : 'sent_audit_failed');
  if (outcome === 'unknown') back(customerId, audited ? 'unknown' : 'unknown_audit_failed');
  back(customerId, 'failed');
}
