'use server';

// 核准 / 婉拒經銷商申請(B2B 計畫 §9.5,片 D2)。
// 資料庫函式 admin_dealer_application_decide 在同一個交易裡:鎖申請、比對員工看過的那一版與等級、
// 不降級、改等級(走 admin_set_customer_tier ⇒ 稽核與手動改等級同形)、標記申請、寫稽核。
// 權限:在職員工即可(與既有改等級 setTierAction 同一道 authorizeAdminMutation)。
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { authorizeAdminMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { decideDealerApplication } from './dealer-application-repository';
import { dealerDecisionCodeFor, parseDealerDecisionForm, type DealerDecisionCode } from './dealer-application-decision';

function detailHref(id: string, code: DealerDecisionCode): string {
  return `/customers/dealer-applications/${id}?r=${code}`;
}

export async function decideDealerApplicationAction(formData: FormData): Promise<void> {
  const rawId = String(formData.get('applicationId') ?? '');
  const auth = await authorizeAdminMutation();
  const parsed = parseDealerDecisionForm(formData);
  if (!parsed.ok && parsed.reason === 'bad_id') {
    redirect('/customers/dealer-applications?r=invalid');
  }
  if (!auth) redirect(detailHref(rawId, 'denied'));
  if (!parsed.ok) redirect(detailHref(rawId, 'invalid'));

  const requestId = await getRequestId();
  console.info('[admin/dealer-applications] decide.attempt', {
    request_id: requestId, sid: auth.sid, actor: auth.actorId, application_id: parsed.applicationId, decision: parsed.decision,
  });

  let code: DealerDecisionCode;
  try {
    const result = await decideDealerApplication({
      applicationId: parsed.applicationId,
      decision: parsed.decision,
      note: parsed.note,
      actor: auth.actorId,
      requestId,
      expectedTier: parsed.expectedTier,
      expectedUpdatedAt: parsed.expectedUpdatedAt,
    });
    code = dealerDecisionCodeFor(result);
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown };
    console.error('[admin/dealer-applications] decide 失敗(結果無法確認)', {
      request_id: requestId,
      code: typeof e.code === 'string' ? e.code : undefined,
      message: String(e.message ?? '').slice(0, 200),
    });
    code = 'unknown';
  }
  revalidatePath('/customers');
  revalidatePath('/customers/dealer-applications');
  revalidatePath(`/customers/dealer-applications/${parsed.applicationId}`);
  redirect(detailHref(parsed.applicationId, code));
}
