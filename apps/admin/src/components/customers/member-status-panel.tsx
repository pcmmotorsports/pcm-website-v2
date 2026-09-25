'use client';

// 客戶詳情頁的「會員狀態」:顯示是否停用, 老闆可以停用 / 恢復 / 刪除(20260926100000;計畫第九節)。
// 🔴 props 只收純量(同 payment-reverse-button.tsx):客戶讀模型帶 PII, 整包不進 client。
// 🔴 按鈕只對老闆顯示, 但那只是畫面乾淨;真正的擋在伺服器動作(authorizeManagerMutation)與資料庫函式。
// 確認方式照 payment-reverse-button.tsx:內嵌面板、原因必填、確認鈕危險色、送出中不能再按;
// 呼叫本身失敗(斷線、沒收到回應)一律顯示「無法確認」, 不說「沒有完成」。

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  deleteCustomerAction,
  disableCustomerAction,
  enableCustomerAction,
} from '../../lib/customers/member-status-actions';
import {
  MEMBER_CONFIRM_BUTTON,
  MEMBER_CONFIRM_COPY,
  MEMBER_REASON_MAX,
  deleteBlockedText,
  memberActionResult,
  type MemberAction,
} from '../../lib/customers/member-status-copy';
import { formatCustomerDate } from '../../lib/customers/customer-list-view';
import { UNKNOWN_PERMISSION_TEXT, type ManagePermission } from '../../lib/session/manage-permission';

const ACTIONS = { disable: disableCustomerAction, enable: enableCustomerAction, delete: deleteCustomerAction };
const BUTTON_LABEL: Record<MemberAction, string> = { disable: '停用會員', enable: '恢復會員', delete: '刪除會員' };

export function MemberStatusPanel({
  customerId,
  disabledAt,
  disabledBy,
  disabledReason,
  version,
  deletable,
  blockers,
  permission,
}: {
  customerId: string;
  disabledAt: string | null;
  disabledBy: string | null;
  disabledReason: string | null;
  version: number;
  /** null = 讀不到可否刪除 ⇒ 不給刪除鈕 */
  deletable: boolean | null;
  blockers: readonly string[];
  /** 三態(沿用 settings/staff 的寫法):unknown ⇒ 不給按鈕但說明原因, 不讓按鈕靜靜消失 */
  permission: ManagePermission;
}) {
  const canManage = permission === 'yes';
  const router = useRouter();
  const [open, setOpen] = useState<MemberAction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const disabled = disabledAt !== null;

  async function submit(action: MemberAction) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await ACTIONS[action]({ customerId, reason: reason.trim(), expectedVersion: version });
      setMessage({ ok: r.ok, text: r.message });
      if (r.ok) {
        setOpen(null);
        setReason('');
        if (action === 'delete' && r.code === 'DELETED') router.push('/customers?r=customer_deleted');
        else router.refresh();
      }
    } catch {
      // 伺服器動作的呼叫本身失敗:資料庫可能已經做完, 只是回應沒回來
      setMessage({ ok: false, text: memberActionResult(action, 'unknown').message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label='會員狀態' className='space-y-2 rounded-lg border bg-card p-4 text-sm text-card-foreground'>
      {disabled ? (
        <div className='text-destructive space-y-1'>
          <p className='font-medium'>
            已停用（{formatCustomerDate(disabledAt)}
            {disabledBy ? `，由 ${disabledBy} 停用` : ''}）
          </p>
          {disabledReason ? <p className='text-xs'>原因：{disabledReason}</p> : null}
        </div>
      ) : (
        <p className='text-muted-foreground'>會員狀態：正常</p>
      )}

      {permission === 'unknown' ? <p className='text-muted-foreground text-xs'>{UNKNOWN_PERMISSION_TEXT}</p> : null}

      {canManage && open === null ? (
        <div className='flex flex-wrap items-center gap-2'>
          <button
            type='button'
            onClick={() => {
              setMessage(null);
              setOpen(disabled ? 'enable' : 'disable');
            }}
            className='rounded-md border border-input px-2 py-1 text-xs'
          >
            {BUTTON_LABEL[disabled ? 'enable' : 'disable']}
          </button>
          {deletable === true ? (
            <button
              type='button'
              onClick={() => {
                setMessage(null);
                setOpen('delete');
              }}
              className='text-destructive border-destructive/40 rounded-md border px-2 py-1 text-xs'
            >
              刪除會員
            </button>
          ) : deletable === false ? (
            <span className='text-muted-foreground text-xs'>{deleteBlockedText(blockers)}</span>
          ) : (
            <span className='text-muted-foreground text-xs'>暫時無法確認這位會員能不能刪除，請重新整理頁面。</span>
          )}
        </div>
      ) : null}

      {canManage && open !== null ? (
        <div className='space-y-2'>
          <p className='text-foreground text-xs'>{MEMBER_CONFIRM_COPY[open]}</p>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={MEMBER_REASON_MAX}
            placeholder='原因（必填）'
            aria-label={`${BUTTON_LABEL[open]}原因`}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
            className='w-full rounded-md border border-input px-2 py-1 text-xs'
          />
          <div className='flex flex-wrap items-center gap-2'>
            <button
              type='button'
              disabled={busy || reason.trim() === ''}
              onClick={() => void submit(open)}
              className={`rounded-md px-2 py-1 text-xs disabled:opacity-50 ${open === 'enable' ? 'bg-primary text-primary-foreground' : 'bg-destructive text-white'}`}
            >
              {MEMBER_CONFIRM_BUTTON[open]}
            </button>
            <button
              type='button'
              disabled={busy}
              onClick={() => {
                setOpen(null);
                setReason('');
                setMessage(null);
              }}
              className='rounded-md border border-input px-2 py-1 text-xs'
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {message !== null ? (
        <p role='status' className={message.ok ? 'text-foreground text-xs' : 'text-destructive text-xs'}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
