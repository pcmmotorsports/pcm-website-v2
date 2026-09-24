'use client';

// 後台「新增經銷帳號」表單(B2B 計畫 §9.9 片 D4a)。
// 🔴 沒有密碼欄:帳號建好後客人收到邀請信, 自己設定密碼(員工從頭到尾看不到)。
// 送出失敗時資料留在畫面上。Email 已有帳號、或結果不明時, 按鈕變成「用這個帳號完成經銷設定」:
// 不寄信, server 用 Email 查帳號後只做經銷設定(冪等)。
import Link from 'next/link';
import { useActionState } from 'react';
import { TAIWAN_REGIONS, EMPTY_DEALER_APPLY, NOTE_MAX, type DealerApplyField } from '@pcm/domain';
import { createDealerAccountAction } from '../../lib/customers/dealer-account-actions';
import { RESUME_KINDS, dealerAccountMessage, type DealerAccountState } from '../../lib/customers/dealer-account-form';
import { ADMIN_INPUT_CLASS } from '../shared/admin-form';

const TONE_CLASS = {
  ok: 'rounded-lg border p-3 text-sm',
  warn: 'rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900',
  error: 'border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm',
} as const;

const FIELDS: { name: DealerApplyField; label: string; type?: string; max: number }[] = [
  { name: 'companyName', label: '公司或商號名稱（必填）', max: 100 },
  { name: 'taxId', label: '統一編號（必填）', max: 12 },
  { name: 'storeName', label: '店名（門市招牌名稱）', max: 100 },
  { name: 'contactName', label: '聯絡人姓名（必填）', max: 50 },
  { name: 'contactPhone', label: '聯絡電話（必填）', type: 'tel', max: 30 },
  { name: 'contactEmail', label: '聯絡 Email（必填）', type: 'email', max: 254 },
];

export function DealerAccountCreateForm() {
  const [state, action, pending] = useActionState<DealerAccountState, FormData>(createDealerAccountAction, { kind: 'idle' });
  const msg = dealerAccountMessage(state);
  const form = 'form' in state ? state.form : null;
  const values = form?.values ?? EMPTY_DEALER_APPLY;
  const errors = state.kind === 'invalid' ? state.fieldErrors : {};
  // 補做模式:結果不明 / Email 已有帳號時進入;之後查詢失敗或欄位要修也維持(form.resume)
  const resume = (RESUME_KINDS as readonly string[]).includes(state.kind) || form?.resume === true;
  // 每次回來都重掛一次輸入框, defaultValue 才會換成這次的值(成功後清空)
  const formKey = JSON.stringify(state);
  const err = (k: string) =>
    (errors as Record<string, string | undefined>)[k] ? (
      <span className='text-destructive text-xs'>{(errors as Record<string, string>)[k]}</span>
    ) : null;

  return (
    <div className='space-y-3'>
      {msg && (
        <p role='status' className={TONE_CLASS[msg.tone]}>
          {msg.text}
          {state.kind === 'done' && (
            <>
              {' '}
              <Link href={`/customers/${state.userId}`} className='underline'>
                開啟客戶明細
              </Link>
            </>
          )}
        </p>
      )}
      <form key={formKey} action={action} className='rounded-lg border bg-card p-4 space-y-3'>
        <label className='flex flex-col gap-1 text-sm'>
          登入 Email（必填，邀請信會寄到這裡）
          <input
            name='email'
            type='email'
            required
            maxLength={254}
            defaultValue={form?.email ?? ''}
            readOnly={resume}
            className={ADMIN_INPUT_CLASS}
          />
          {err('email')}
        </label>
        <div className='grid gap-3 sm:grid-cols-2'>
          {FIELDS.map((f) => (
            <label key={f.name} className='flex flex-col gap-1 text-sm'>
              {f.label}
              <input name={f.name} type={f.type ?? 'text'} maxLength={f.max} defaultValue={values[f.name]} className={ADMIN_INPUT_CLASS} />
              {err(f.name)}
            </label>
          ))}
          <label className='flex flex-col gap-1 text-sm'>
            營業地區（必填）
            <select name='region' defaultValue={values.region} className={ADMIN_INPUT_CLASS}>
              <option value=''>請選擇</option>
              {TAIWAN_REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {err('region')}
          </label>
        </div>
        <label className='flex flex-col gap-1 text-sm'>
          主要銷售品牌或需求說明
          <textarea name='note' rows={3} maxLength={NOTE_MAX} defaultValue={values.note} className='border-input bg-background rounded-md border px-3 py-2 text-sm' />
          {err('note')}
        </label>
        <div className='flex flex-wrap items-center gap-3'>
          {/* 模式跟著按下的那顆鈕送出(name='resume');按 Enter 走第一顆 */}
          <button
            type='submit'
            name='resume'
            value={resume ? '1' : '0'}
            disabled={pending}
            className='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50'
          >
            {pending ? '處理中…' : !resume ? '建立經銷帳號並寄邀請信' : state.kind === 'no_account' ? '再查一次' : '用這個帳號完成經銷設定'}
          </button>
          {state.kind === 'no_account' && (
            <button type='submit' name='resume' value='0' disabled={pending} className='h-9 rounded-md border px-4 text-sm font-medium disabled:opacity-50'>
              建立經銷帳號並寄邀請信
            </button>
          )}
          <p className='text-muted-foreground text-xs'>
            建立後等級為「車行」，並寫入操作紀錄。客人收到邀請信後自己設定密碼，員工不會看到密碼。
          </p>
        </div>
      </form>
    </div>
  );
}
