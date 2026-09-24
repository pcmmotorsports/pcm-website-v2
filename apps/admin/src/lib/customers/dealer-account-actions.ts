'use server';

// 後台直接新增經銷帳號(B2B 計畫 §9.9 片 D4a)。只限管理者(authorizeManagerMutation:員工身分 + Origin + 管理者)。
// ① 寄邀請信建帳號(員工看不到也設不了密碼)→ ② handle_new_auth_user 自動建 customers → ③ admin_dealer_account_create
//    寫一筆已核准申請並改成 store(冪等)。
// 「用這個帳號完成經銷設定」(resume):不寄信, server 用 Email 查帳號, 只跑 ③。
//    用在 Email 已有帳號、邀請結果不明、③ 結果不明三種情況(Codex R1:原本結果不明時沒有接回 ③ 的路)。
import { revalidatePath } from 'next/cache';
import { authorizeManagerMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { getAdminAuditLogRepository } from '../orders/order-repository';
import { createStaffDealer, findCustomerIdByEmail, inviteDealerUser } from './dealer-application-repository';
import { parseDealerAccountForm, type DealerAccountState } from './dealer-account-form';

export async function createDealerAccountAction(_prev: DealerAccountState, formData: FormData): Promise<DealerAccountState> {
  const auth = await authorizeManagerMutation();
  if (!auth) return { kind: 'denied' };
  const parsed = parseDealerAccountForm(formData);
  if (!parsed.ok) return { kind: 'invalid', form: parsed.form, fieldErrors: parsed.fieldErrors };

  const requestId = await getRequestId();
  const form = { email: parsed.email, values: parsed.values, resume: parsed.resume };
  let userId: string;

  if (parsed.resume) {
    const found = await findCustomerIdByEmail(parsed.email);
    if (found.kind === 'none') return { kind: 'no_account', form };
    if (found.kind === 'failed') return { kind: 'lookup_failed', form };
    if (found.kind !== 'found') return { kind: found.kind, form };
    userId = found.userId;
  } else {
    const invited = await inviteDealerUser(parsed.email, parsed.values.contactName);
    const outcome = invited.kind === 'ok' ? 'accepted' : invited.kind;
    try {
      await getAdminAuditLogRepository().record(
        {
          action: 'dealer.account.invite',
          target: invited.kind === 'ok' ? `customer:${invited.userId}` : undefined,
          after: { outcome, email: parsed.email },
        },
        { actor: auth.actorId, requestId, sourceApp: 'admin' },
      );
    } catch (err) {
      console.error('[dealer-account] 邀請稽核寫入失敗(繼續)', { request_id: requestId, name: (err as Error)?.name });
    }
    if (invited.kind === 'exists') return { kind: 'email_exists', form };
    if (invited.kind === 'failed') return { kind: 'invite_failed', form };
    if (invited.kind === 'unknown') return { kind: 'invite_unknown', form };
    userId = invited.userId;
  }

  let result: string;
  try {
    result = await createStaffDealer({ userId, ...parsed.values, actor: auth.actorId, requestId });
  } catch (err) {
    // 交易可能已經提交、只是回應沒回來 ⇒ 結果不明(Codex R1 nit);重按會走冪等檢查, 不會重複寫入
    const e = err as { code?: unknown };
    console.error('[dealer-account] 設定經銷沒有確認成功', { request_id: requestId, code: typeof e.code === 'string' ? e.code : undefined });
    return { kind: 'setup_unknown', form };
  }
  revalidatePath('/customers');
  if (result === 'CREATED' || result === 'ALREADY_DONE') {
    return { kind: 'done', userId, email: parsed.email, invited: !parsed.resume, already: result === 'ALREADY_DONE' };
  }
  if (result === 'WOULD_DOWNGRADE') return { kind: 'would_downgrade', form };
  console.error('[dealer-account] 設定經銷回了預期外的結果', { request_id: requestId, result });
  return { kind: 'setup_unknown', form };
}
