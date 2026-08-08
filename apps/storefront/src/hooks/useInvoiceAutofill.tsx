'use client';

// useInvoiceAutofill.tsx — 選中地址 → 發票自動帶入 effect + 發票草稿預設(自 CheckoutView 外移、鐵則 6)。
//   對齊 design L69/L72-76:未手動覆寫(invoiceOverride)時,切換收件地址即以該地址發票資料帶入;
//   走 diff 清錯(不一律清三個、理由見 clearInvoiceErrorsOnChange docstring)。發票 state 仍留 View。

import { useEffect, useRef } from 'react';
import type { CustomerAddress } from '@pcm/domain';
import type { InvoiceDraft } from '@/components/CheckoutStep2';
import { INVOICE_FIELDS_HIDDEN } from '@/lib/invoice-visibility';

/** 發票草稿預設(對齊 design defaultInvoice L69、CheckoutInput.invoice zod);模組層常數穩定參照。 */
export const DEFAULT_INVOICE: InvoiceDraft = {
  type: 'personal',
  carrier: '',
  title: '',
  taxId: '',
  donateCode: '',
};

export function useInvoiceAutofill(opts: {
  invoice: InvoiceDraft;
  setInvoice: (v: InvoiceDraft) => void;
  invoiceOverride: boolean;
  shippingAddrId: string | undefined;
  addresses: CustomerAddress[];
  clearInvoiceKeys: (prev: InvoiceDraft, next: InvoiceDraft) => void;
}): void {
  const { invoice, setInvoice, invoiceOverride, shippingAddrId, addresses, clearInvoiceKeys } = opts;
  // invoice 走 ref 取 effect 內 prev 值(進 deps 會自我觸發迴圈);setInvoice/clearInvoiceKeys 皆 stable。
  const invoiceRef = useRef(invoice);
  invoiceRef.current = invoice;
  useEffect(() => {
    // 🔴 發票欄位隱藏期間不帶入(Sean 2026-08-08 拍板;理由全文見 `@/lib/invoice-visibility`)。
    //    一句話版:帶入會把地址上的 company 發票搬進草稿,而 company 在 server 是 fail-closed
    //    驗證(統編 8 碼)⇒ 錯誤會落在一個**已經看不見**的欄位上,客人卡在付款鍵前面無路可走。
    //    停掉之後草稿一律停在 `DEFAULT_INVOICE`(個人),payload 照常送、地址資料一字未動。
    if (INVOICE_FIELDS_HIDDEN) return;
    if (invoiceOverride) return;
    const addr = addresses.find((a) => a.id === shippingAddrId);
    if (!addr?.invoice) return;
    const next = { ...DEFAULT_INVOICE, ...addr.invoice };
    // 🔴 走 diff、不可改成「一律清三個」(理由見 clearInvoiceErrorsOnChange docstring)。
    clearInvoiceKeys(invoiceRef.current, next);
    setInvoice(next);
  }, [shippingAddrId, addresses, invoiceOverride, clearInvoiceKeys, setInvoice]);
}
