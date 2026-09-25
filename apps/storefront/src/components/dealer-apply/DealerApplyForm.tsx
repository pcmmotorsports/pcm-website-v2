'use client';

// 經銷商申請表單(B2B 計畫 §9.2、§9.7)。外觀沿用會員中心個人資料表單(.acc-profile / .auth-*),
// design-reference/ 沒有這一頁的稿(2026-09-24 grep「申請」「dealer」零命中)⇒ 不另畫新樣式。
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { submitDealerApplicationAction, updateDealerApplicationAction } from '@/app/dealer-apply/actions';
import {
  NOTE_MAX,
  TAIWAN_REGIONS,
  validateDealerApply,
  type DealerApplyField,
  type DealerApplyFieldErrors,
  type DealerApplyValues,
} from '@/lib/dealer-apply/form';

const LOGIN_HREF = `/login?next=${encodeURIComponent('/dealer-apply')}`;

const ORDER: DealerApplyField[] = [
  'companyName', 'taxId', 'storeName', 'region', 'contactName', 'contactPhone', 'contactEmail', 'note',
];

/**
 * editId 有值 = 修改那一筆審核中的申請(片 B2);沒有 = 新送一筆。
 * accountEmail = 目前登入帳號的 Email。核准後升級的是這個帳號, 不是「聯絡 Email」那一格
 * (2026-09-25:Sean 用 A 帳號申請、聯絡信箱填 B, 核准後以為申請不見了)。LINE 登入可能沒有 Email ⇒ null。
 */
export function DealerApplyForm({
  initial,
  submitLabel,
  editId,
  accountEmail,
}: {
  initial: DealerApplyValues;
  submitLabel: string;
  editId?: string;
  accountEmail: string | null;
}) {
  const router = useRouter();
  const [values, setValues] = useState<DealerApplyValues>(initial);
  const [fieldErrors, setFieldErrors] = useState<DealerApplyFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const set = (k: DealerApplyField) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  const focusFirstError = (errs: DealerApplyFieldErrors) => {
    const first = ORDER.find((k) => errs[k]);
    if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSessionExpired(false);
    const checked = validateDealerApply(values);
    if (!checked.ok) {
      setFieldErrors(checked.fieldErrors);
      focusFirstError(checked.fieldErrors);
      return;
    }
    setFieldErrors({});
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof submitDealerApplicationAction>>;
      try {
        r = editId
          ? await updateDealerApplicationAction(editId, values)
          : await submitDealerApplicationAction(values);
      } catch {
        // 網路中斷等:不知道有沒有寫進去 ⇒ 請他重新整理確認, 不說失敗也不說成功(第 7 節「結果未確認」)
        setFormError('無法確認資料是否已送出，請重新整理頁面查看目前狀態。');
        return;
      }
      if (r.ok) {
        if (editId) router.push('/dealer-apply?updated=1');
        else router.refresh();
        return;
      }
      // 🔴 失敗時不清掉客人已經填的內容(§9.7)
      if (r.fieldErrors) {
        setFieldErrors(r.fieldErrors);
        focusFirstError(r.fieldErrors);
      }
      setFormError(r.message);
      if (r.kind === 'session_expired') setSessionExpired(true);
      if (r.kind === 'already_pending') router.refresh();
    });
  };

  const err = (k: DealerApplyField) =>
    fieldErrors[k] ? <span className="auth-field-err">{fieldErrors[k]}</span> : null;

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate>
      <p className="auth-note dap-account">
        這份申請會套用在目前登入的帳號
        {accountEmail && (
          <>
            ：<b>{accountEmail}</b>
          </>
        )}
        。核准後，這個帳號就能看到經銷價。
      </p>
      {formError && (
        <div className="auth-err" role="alert">
          {formError}
          {sessionExpired && (
            <>
              {' '}
              <a href={LOGIN_HREF}>重新登入</a>
            </>
          )}
        </div>
      )}
      <div className="acc-profile">
        <label>
          <span>公司或商號名稱（必填）</span>
          <input name="companyName" value={values.companyName} onChange={set('companyName')} maxLength={100} autoComplete="organization" />
          {err('companyName')}
        </label>
        <label>
          <span>統一編號（必填）</span>
          <input name="taxId" value={values.taxId} onChange={set('taxId')} inputMode="numeric" maxLength={12} />
          {err('taxId')}
        </label>
        <label>
          <span>店名（門市招牌名稱）</span>
          <input name="storeName" value={values.storeName} onChange={set('storeName')} maxLength={100} />
          {err('storeName')}
        </label>
        <label>
          <span>營業地區（必填）</span>
          <select name="region" value={values.region} onChange={set('region')}>
            <option value="">請選擇</option>
            {TAIWAN_REGIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          {err('region')}
        </label>
        <label>
          <span>聯絡人姓名（必填）</span>
          <input name="contactName" value={values.contactName} onChange={set('contactName')} maxLength={50} autoComplete="name" />
          {err('contactName')}
        </label>
        <label>
          <span>聯絡電話（必填）</span>
          <input name="contactPhone" type="tel" value={values.contactPhone} onChange={set('contactPhone')} maxLength={30} autoComplete="tel" />
          {err('contactPhone')}
        </label>
        <label>
          <span>聯絡 Email（必填）</span>
          <input name="contactEmail" type="email" value={values.contactEmail} onChange={set('contactEmail')} maxLength={254} autoComplete="email" />
          <span className="dap-field-hint">只用來聯絡您，不會改變申請的帳號。</span>
          {err('contactEmail')}
        </label>
        <label>
          <span>主要銷售品牌或需求說明</span>
          <textarea name="note" value={values.note} onChange={set('note')} rows={4} />
          <span className="dap-counter">
            {[...values.note].length} / {NOTE_MAX} 字
          </span>
          {err('note')}
        </label>
        <button type="submit" className="auth-submit" disabled={isPending}>
          {isPending ? (editId ? '儲存中…' : '送出中…') : submitLabel}
        </button>
      </div>
    </form>
  );
}
