'use client';

import { useEffect, useRef, useState } from 'react';
import { InvoiceTitleLookupButton } from './invoice-title-lookup-button';
import {
  MANUAL_ORDER_INVOICE_CARRIER_FIELD,
  MANUAL_ORDER_INVOICE_DONATE_CODE_FIELD,
  MANUAL_ORDER_INVOICE_REQUESTED_FIELD,
  MANUAL_ORDER_INVOICE_TAX_ID_FIELD,
  MANUAL_ORDER_INVOICE_TITLE_FIELD,
  MANUAL_ORDER_INVOICE_TYPE_FIELD,
} from '@/lib/orders/manual-order-form';
import { MANUAL_FIELD_INPUT, MANUAL_SECTION, MANUAL_SECTION_LEGEND } from './manual-order-field-classes';

// manual-order-invoice-fields.tsx — 手動建單的「發票」那一組(2026-10-01 從 manual-order-form-body.tsx 搬出來;
//   Sean 2026-10-01 建單簡化 Q3 甲:勾了「這張單要開發票」才展開, 而且依發票類型只出現對應的格子)。
//   計畫:~/pcm-mailbox/計畫-建單畫面簡化-20261001.md 第 5、6 節(S1)。
//
// 🔴🔴 **收起 = 只是看不到, 每一格都還在、都照樣送出**:
//    解析端(`parseManualOrderForm`)把 `invoice_requested`、`invoice_type` 的【缺欄】當錯 ⇒ 不能條件渲染,
//    也不能用 disabled(disabled 的欄位不進 FormData)。⇒ 用 `hidden` 屬性。送出的資料與改版前逐字相同。
// 🔴🔴 **有字的格子一律看得到**:四格明細(載具 / 抬頭 / 統編 / 愛心碼)不論發票類型都會送出,
//    員工在「公司」打了抬頭再改成「個人」⇒ 抬頭若被收起, 那段字照樣送出去而他看不到。
//    ⇒ 不由程式清掉他打的字(送出值不由程式回寫), 而是讓有字的格子留在畫面上。
// 🔴 `invoice_requested` 那一對(hidden off + checkbox)的順序與預設不勾一個字都沒動 —— 理由全文在
//    `manual-order-form-body.tsx` 搬家前那段(2026-09-04 ⟦b4-INVOICE5PCT⟧、Sean 2026-09-05 第 23 題「預設不開發票」)與 git log。
//    ⚠️ hidden 要在 checkbox **前面**:解析端取的是最後一個值。
// 🔴 本檔只從 DOM 讀(勾了沒、選哪一類、哪幾格有字), 不寫任何一格的值。

type View = { requested: boolean; type: string; filled: ReadonlySet<string> };

const DETAIL_FIELDS = [
  MANUAL_ORDER_INVOICE_CARRIER_FIELD,
  MANUAL_ORDER_INVOICE_TITLE_FIELD,
  MANUAL_ORDER_INVOICE_TAX_ID_FIELD,
  MANUAL_ORDER_INVOICE_DONATE_CODE_FIELD,
] as const;

/** 每一類發票要填的格子(Sean Q3 甲):個人 → 載具;公司 → 抬頭、統編(含查抬頭);捐贈 → 愛心碼。 */
const FIELDS_BY_TYPE: Record<string, readonly string[]> = {
  personal: [MANUAL_ORDER_INVOICE_CARRIER_FIELD],
  company: [MANUAL_ORDER_INVOICE_TITLE_FIELD, MANUAL_ORDER_INVOICE_TAX_ID_FIELD],
  donate: [MANUAL_ORDER_INVOICE_DONATE_CODE_FIELD],
};

function readView(root: HTMLElement): View {
  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel);
  const box = q<HTMLInputElement>(`input[type='checkbox'][name='${MANUAL_ORDER_INVOICE_REQUESTED_FIELD}']`);
  const type = q<HTMLSelectElement>(`select[name='${MANUAL_ORDER_INVOICE_TYPE_FIELD}']`);
  const filled = new Set(
    DETAIL_FIELDS.filter((n) => (q<HTMLInputElement>(`input[name='${n}']`)?.value ?? '').trim() !== ''),
  );
  return { requested: box?.checked ?? false, type: type?.value ?? 'personal', filled };
}

export function ManualOrderInvoiceFields() {
  const rootRef = useRef<HTMLFieldSetElement>(null);
  const [view, setView] = useState<View>({ requested: false, type: 'personal', filled: new Set() });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sync = () => setView(readView(root));
    sync();
    // 勾選 / 換類型發 change;打字發 input;「查抬頭」帶入抬頭時自己派 input(invoice-title-lookup-button.tsx)
    root.addEventListener('change', sync);
    root.addEventListener('input', sync);
    return () => {
      root.removeEventListener('change', sync);
      root.removeEventListener('input', sync);
    };
  }, []);

  const shown = (name: string) =>
    view.filled.has(name) || (view.requested && (FIELDS_BY_TYPE[view.type] ?? []).includes(name));

  return (
    <fieldset ref={rootRef} className={MANUAL_SECTION} data-testid='manual-order-invoice'>
      <legend className={MANUAL_SECTION_LEGEND}>發票</legend>
      <label className='flex items-center gap-2 text-sm'>
        <input type='hidden' name={MANUAL_ORDER_INVOICE_REQUESTED_FIELD} value='off' />
        <input type='checkbox' autoComplete='off' name={MANUAL_ORDER_INVOICE_REQUESTED_FIELD} />
        <span>這張單要開發票</span>
      </label>
      <select
        autoComplete='off'
        name={MANUAL_ORDER_INVOICE_TYPE_FIELD}
        aria-label='發票類型'
        // 有任何一格明細有字 ⇒ 類型也看得到(員工才看得出類型停在哪一類, Fable S1 R1 建議)
        hidden={!view.requested && view.filled.size === 0}
        className={MANUAL_FIELD_INPUT}
      >
        <option value='personal'>個人</option>
        <option value='company'>公司</option>
        <option value='donate'>捐贈</option>
      </select>
      <input
        autoComplete='off'
        name={MANUAL_ORDER_INVOICE_CARRIER_FIELD}
        placeholder='載具(選填)'
        hidden={!shown(MANUAL_ORDER_INVOICE_CARRIER_FIELD)}
        className={MANUAL_FIELD_INPUT}
      />
      <input
        autoComplete='off'
        name={MANUAL_ORDER_INVOICE_TITLE_FIELD}
        placeholder='抬頭'
        hidden={!shown(MANUAL_ORDER_INVOICE_TITLE_FIELD)}
        className={MANUAL_FIELD_INPUT}
      />
      <div hidden={!shown(MANUAL_ORDER_INVOICE_TAX_ID_FIELD)} className='space-y-2'>
        <input
          autoComplete='off'
          name={MANUAL_ORDER_INVOICE_TAX_ID_FIELD}
          placeholder='統編'
          className={MANUAL_FIELD_INPUT}
        />
        {/* 🔵 ⟦b4-INVOICE5PCT⟧三:Sean 2026-09-10 拍乙 —— 真的自動帶入抬頭(理由在該元件檔頭)。跟著統編一起收起 / 出現。 */}
        <InvoiceTitleLookupButton />
      </div>
      <input
        autoComplete='off'
        name={MANUAL_ORDER_INVOICE_DONATE_CODE_FIELD}
        placeholder='愛心碼'
        hidden={!shown(MANUAL_ORDER_INVOICE_DONATE_CODE_FIELD)}
        className={MANUAL_FIELD_INPUT}
      />
    </fieldset>
  );
}
