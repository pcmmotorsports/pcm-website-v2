'use client';

// 經銷商申請的核准 / 婉拒(B2B 計畫 §9.5,片 D2)。
// 確認掛在表單的 submit 事件上(按鈕與 Enter 走同一道);取消確認 ⇒ 不送出。
// expectedTier / expectedUpdatedAt 是員工這次看到的那一版, 資料庫比對不同就不存(STALE)。
import type { MemberTier } from '@pcm/domain';
import { useFormStatus } from 'react-dom';
import { decideDealerApplicationAction } from '../../lib/customers/dealer-application-actions';
import { DECIDE_NOTE_MAX } from '../../lib/customers/dealer-application-decision';
import { ADMIN_INPUT_CLASS } from '../shared/admin-form';

function SubmitButton({ label, disabled, danger }: { label: string; disabled?: boolean; danger?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type='submit'
      disabled={pending || disabled}
      className={`${danger ? 'border' : 'bg-primary text-primary-foreground'} h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50`}
    >
      {pending ? '處理中…' : label}
    </button>
  );
}

function confirmOrStop(e: React.FormEvent<HTMLFormElement>, message: string) {
  if (!e.currentTarget.reportValidity() || !window.confirm(message)) e.preventDefault();
}

export function DealerDecisionForms({
  applicationId,
  companyName,
  currentTier,
  updatedAt,
}: {
  applicationId: string;
  companyName: string;
  currentTier: MemberTier;
  updatedAt: string;
}) {
  const hidden = (decision: 'approve' | 'reject') => (
    <>
      <input type='hidden' name='applicationId' value={applicationId} />
      <input type='hidden' name='decision' value={decision} />
      <input type='hidden' name='expectedTier' value={currentTier} />
      <input type='hidden' name='expectedUpdatedAt' value={updatedAt} />
    </>
  );
  const approveHint =
    currentTier === 'premiumStore'
      ? '這個帳號目前是「經銷」，核准會把等級改成「車行」，所以不能核准。需要時請改用婉拒並寫明原因。'
      : currentTier === 'store'
        ? '這個帳號已經是「車行」，核准只會把申請標成已核准，等級不變。'
        : '核准後帳號等級會從「會員」改成「車行」，並寫入操作紀錄。';

  return (
    <section className='rounded-lg border bg-card p-4'>
      <h2 className='mb-2 text-sm font-medium'>審核</h2>
      <form
        action={decideDealerApplicationAction}
        onSubmit={(e) => confirmOrStop(e, `確定核准「${companyName}」的經銷商申請？`)}
        className='flex flex-wrap items-center gap-3 border-b pb-3'
      >
        {hidden('approve')}
        <SubmitButton label='核准申請' disabled={currentTier === 'premiumStore'} />
        <p className='text-muted-foreground text-xs'>{approveHint}</p>
      </form>
      <form
        action={decideDealerApplicationAction}
        onSubmit={(e) => confirmOrStop(e, `確定婉拒「${companyName}」的經銷商申請？原因只有員工看得到，客人只會看到「未通過」。`)}
        className='mt-3 flex flex-wrap items-end gap-3'
      >
        {hidden('reject')}
        <label className='flex min-w-64 flex-1 flex-col gap-1 text-sm'>
          婉拒原因（必填，僅供內部查看）
          <input
            type='text'
            name='note'
            required
            maxLength={DECIDE_NOTE_MAX}
            placeholder='例：統一編號查無此公司，請確認後重新填寫'
            className={ADMIN_INPUT_CLASS}
          />
        </label>
        <SubmitButton label='婉拒申請' danger />
      </form>
    </section>
  );
}
