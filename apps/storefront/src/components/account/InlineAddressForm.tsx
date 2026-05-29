'use client';

// InlineAddressForm.tsx — 收件地址新增/編輯表單(M-1-14e-g-5b 建、g-5c 編輯重用)
//
// 字面從 design-reference/components/AccountPages.jsx InlineAddressForm(L686-757)直接搬(鐵則 1):
// - .acc-inline-form-inner form + .acc-inline-head〔h4「新增地址/編輯地址」依 addr.id + .acc-inline-x 關閉鈕〕
// - 基本欄:收件人 name(required)/ 手機 phone / 地址 line(required)+ .acc-inline-check 勾「設為預設地址」
// - .acc-inline-divider「INVOICE · 此地址預設發票」+ .acc-inv-tabs 三 tab(個人 / 公司(三聯式)/ 捐贈)
// - personal→手機載具(選填)/ company→公司抬頭 + 統一編號(maxLength 8)/ donate→愛心碼;.acc-inline-actions 取消/儲存
//
// storefront 技術實作 adaptation(鐵則 1 例外類別 2、非視覺偏離):
// - design L706 onSave(form) localStorage mock → onSubmit prop(g-5b 傳 addAddressAction、g-5c 傳 updateAddressAction);
//   form 保持 generic、不 hardcode action → 可重用(addr.id 僅決定 heading 字面,id 綁定由 parent closure 處理)
// - controlled state + useTransition;成功 ok → router.refresh()〔g-4c pattern、重讀 page server component 即時刷新清單〕+ onClose()
//
// #181 雙通道(沿用 ProfileTab pattern、含巢狀 invoice):
// - fieldErrors 逐欄(.auth-field-err 顯各 input 下方);invoice 欄錯〔title/taxId/donateCode〕顯對應 tab 下的 input
// - formError 帳號層級(.auth-err 表單頂部;請重新登入 / 儲存失敗);兩通道並存、互不取代
// - 信任邊界全在 server(addAddressAction safeParse + superRefine);client 不重驗、收 server 逐欄回傳渲染

import { useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { AddressInput } from '@pcm/schemas';
import type { AddAddressActionResult, AddressFieldErrors } from '@/app/account/address/actions';

// 表單初值(新增:id 缺/null + isDefault 由 parent 依清單空否帶入;編輯〔g-5c〕:帶完整 CustomerAddress 值)。
export type InlineAddressInitial = {
  id?: string | null;
  isDefault?: boolean;
  name?: string;
  phone?: string;
  line?: string;
  invoice?: Partial<AddressInput['invoice']>;
};

export type InlineAddressFormProps = {
  addr: InlineAddressInitial;
  onClose: () => void;
  // g-5b 傳 addAddressAction;g-5c 編輯傳 (input) => updateAddressAction(addr.id!, input)(id 綁定在 parent closure)。
  onSubmit: (input: AddressInput) => Promise<AddAddressActionResult>;
};

export function InlineAddressForm({ addr, onClose, onSubmit }: InlineAddressFormProps) {
  const router = useRouter();
  const [isDefault, setIsDefault] = useState(!!addr.isDefault);
  const [name, setName] = useState(addr.name ?? '');
  const [phone, setPhone] = useState(addr.phone ?? '');
  const [line, setLine] = useState(addr.line ?? '');
  const [invType, setInvType] = useState<AddressInput['invoice']['type']>(addr.invoice?.type ?? 'personal');
  const [carrier, setCarrier] = useState(addr.invoice?.carrier ?? '');
  const [title, setTitle] = useState(addr.invoice?.title ?? '');
  const [taxId, setTaxId] = useState(addr.invoice?.taxId ?? '');
  const [donateCode, setDonateCode] = useState(addr.invoice?.donateCode ?? '');
  // #181 雙通道:fieldErrors 逐欄(含巢狀 invoice)/ formError 帳號層級;互不取代。
  const [fieldErrors, setFieldErrors] = useState<AddressFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const invTabs = [
    { id: 'personal', label: '個人' },
    { id: 'company', label: '公司(三聯式)' },
    { id: 'donate', label: '捐贈' },
  ] as const;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      // 信任邊界在 server(addAddressAction safeParse + superRefine);client 不重驗、收逐欄回傳渲染。
      const result = await onSubmit({
        isDefault,
        name,
        phone,
        line,
        invoice: { type: invType, carrier, title, taxId, donateCode },
      });
      if (result.fieldErrors) {
        setFieldErrors(result.fieldErrors);
        setFormError(null);
      } else if (result.formError) {
        setFormError(result.formError);
        setFieldErrors({});
      } else if (result.ok) {
        // g-4c pattern:重跑 page.tsx server component 重讀 addresses → 清單即時更新;再收合表單。
        router.refresh();
        onClose();
      }
    });
  };

  return (
    <form className="acc-inline-form-inner" onSubmit={submit}>
      <div className="acc-inline-head">
        <h4>{addr.id ? '編輯地址' : '新增地址'}</h4>
        <button type="button" onClick={onClose} className="acc-inline-x" aria-label="關閉">
          ×
        </button>
      </div>

      {/* 頂部:帳號層級錯(請重新登入 / 儲存失敗 = formError);逐欄錯顯各欄下方(#181 雙通道) */}
      {formError && <div className="auth-err">{formError}</div>}

      <label>
        <span>收件人</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="王小明" />
        {fieldErrors.name && <span className="auth-field-err">{fieldErrors.name}</span>}
      </label>
      <label>
        <span>手機</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0912 345 678" />
        {fieldErrors.phone && <span className="auth-field-err">{fieldErrors.phone}</span>}
      </label>
      <label>
        <span>地址</span>
        <input value={line} onChange={(e) => setLine(e.target.value)} required placeholder="縣市 / 區 / 路 / 號 / 樓" />
        {fieldErrors.line && <span className="auth-field-err">{fieldErrors.line}</span>}
      </label>
      <label className="acc-inline-check">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
        <span>設為預設地址</span>
      </label>

      <div className="acc-inline-divider">
        <span className="ap-mono">INVOICE · 此地址預設發票</span>
      </div>
      <div className="acc-inv-tabs">
        {invTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`acc-inv-tab ${invType === t.id ? 'is-on' : ''}`}
            onClick={() => setInvType(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {invType === 'personal' && (
        <label>
          <span>手機載具(選填)</span>
          <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="/ABCD123" />
          {fieldErrors.invoice?.carrier && (
            <span className="auth-field-err">{fieldErrors.invoice.carrier}</span>
          )}
        </label>
      )}
      {invType === 'company' && (
        <>
          <label>
            <span>公司抬頭</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例:賓士機車有限公司" />
            {fieldErrors.invoice?.title && (
              <span className="auth-field-err">{fieldErrors.invoice.title}</span>
            )}
          </label>
          <label>
            <span>統一編號</span>
            <input
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="8 碼數字"
              maxLength={8}
            />
            {fieldErrors.invoice?.taxId && (
              <span className="auth-field-err">{fieldErrors.invoice.taxId}</span>
            )}
          </label>
        </>
      )}
      {invType === 'donate' && (
        <label>
          <span>愛心碼</span>
          <input
            value={donateCode}
            onChange={(e) => setDonateCode(e.target.value)}
            placeholder="例:8585(罕病)、925(伊甸)"
          />
          {fieldErrors.invoice?.donateCode && (
            <span className="auth-field-err">{fieldErrors.invoice.donateCode}</span>
          )}
        </label>
      )}

      <div className="acc-inline-actions">
        <button type="button" className="acc-btn-ghost" onClick={onClose}>
          取消
        </button>
        <button type="submit" className="auth-submit" disabled={isPending}>
          儲存
        </button>
      </div>
    </form>
  );
}
