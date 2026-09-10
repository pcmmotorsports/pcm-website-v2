'use client';

import { useEffect, useState } from 'react';

import {
  MANUAL_ORDER_INVOICE_REQUESTED_FIELD,
  MANUAL_ORDER_LINE_QTY_BASE,
  MANUAL_ORDER_LINE_TAX_BASIS_BASE,
  MANUAL_ORDER_LINE_UNIT_PRICE_BASE,
  MANUAL_ORDER_MAX_LINES,
  MANUAL_ORDER_SHIPPING_FEE_FIELD,
  MANUAL_ORDER_SHIPPING_FEE_TAX_BASIS_FIELD,
  manualOrderLineField,
  manualOrderPreview,
  type ManualOrderPreview,
  type ManualOrderPreviewLine,
} from '@/lib/orders/manual-order-form';

// manual-order-total-preview.tsx — ⟦b4-INVOICE5PCT⟧ ①+④(Sean 2026-09-10 拍 §4-c 丙)
//
// ══ 為什麼有這一片 ═══════════════════════════════════════════════════════
// Sean 2026-09-10 逐字:「我輸入單價,然後勾選開發票**自己幫我 +5% 上去計算**」
// ⇒ 而今天要**建完單、進訂單頁**才看得到那個數字。這一格讓他**勾下去當場看到**。
// 🎯 而它同時做掉第四件事(稅基下拉的預設):預設是「未稅」,而他有時心裡填的是含稅價
//    ⇒ 勾下去看到 1155 而不是他心裡的 1100 ⇒ **當場發現**。一份工,兩件事。
//
// ══ 🔴 為什麼它【不是】那句「畫面說 A、單子是 B」在警告的東西 ═══════════════
// `manual-order-lines.tsx:341` 逐字:「這裡沒有小計 —— 金額由 RPC 自己算,
//   它不信任何 client 送的合計。在畫面上算一份會生出【畫面說 A、單子是 B】的第二個真相。」
// ✅ **那句話擋的是「client 算的數字被送出去」** ⇒ 本片的輸出**一個位元都不會送出去**:
//    表單送的仍然只有「單價 + 稅基 + 那顆勾選」,總額仍然由 RPC 自己算。
// 🔴 **而它擔心的另一半(兩份算式遲早不一樣)是真的,而且【共用函式解決不了】** ——
//    RPC 那一份住在 SQL 裡(`admin_create_manual_order` 的 `v_tax := round(...)`)。
//    ⇒ ✅ 那一半靠**測試**守:同一組輸入餵 `manualOrderPreview` 與餵真的 RPC(拋棄式 PG),
//      兩邊總額必須相同。**沒有那一格,這一片就是在製造那句話警告的東西。**
//
// ══ 🔵 為什麼讀 DOM 而不是把 state 提上去 ═══════════════════════════════════
// 那三組值住在**三個不同的元件**:品項在 `manual-order-lines.tsx`(client),
// 運費與那顆勾選在 `manual-order-form-body.tsx`(**server component**)。
// ⇒ 要「提上去」就得把 form body 整支改成 client ⇒ 📌 **那是一個為了顯示一個數字而做的架構變更。**
// ✅ 改成**讀那張表單自己**:它是同一個 `<form>`,而瀏覽器本來就在維護那些值。
// 🛑 **代價寫出來**:欄名若被改掉,這裡會安靜地讀不到 ⇒ 所以欄名**一律用常數**,不打字面。
//
// ══ 🛑 Sean 拍了「直接換」(Q3 = 乙)—— 而那讓這一片更重要 ═══════════════════
// 他選了**不用**看見換算結果再按一次 ⇒ 「安靜地改掉金額」那半**留著**。
// ⇒ 📌 **而這一格正好是它的補償**:數字當場變,他看得到結果。
//    (那三題是咬在一起的:Q2′ 甲修掉算錯、Q3 乙拿掉一次確認、§4-c 丙讓他看得見。)

/** 讀那張表單裡某一個欄位的字串值;沒有那個欄位 ⇒ `null`(**不是空字串**)。 */
function readField(form: HTMLFormElement, name: string): string | null {
  const el = form.elements.namedItem(name);
  if (el === null) return null;
  // 🔴 同名多個(那顆勾選有一個同名 hidden 墊底)⇒ `namedItem` 回 RadioNodeList,
  //    而它的 `.value` 就是**最後一個有效值** —— 與解析端「取最後一個值」逐字同一個規則。
  if (el instanceof RadioNodeList) return el.value;
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) return el.value;
  return null;
}

/** 十進位非負整數才算數;其餘(空白 / 小數 / 負數 / 亂打)⇒ `null` ⇒ 那一列不進預覽。 */
function readNonNegInt(form: HTMLFormElement, name: string): number | null {
  const raw = readField(form, name);
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) ? n : null;
}

function readPreview(form: HTMLFormElement): ManualOrderPreview | null {
  const lines: ManualOrderPreviewLine[] = [];
  for (let i = 0; i < MANUAL_ORDER_MAX_LINES; i += 1) {
    const qty = readNonNegInt(form, manualOrderLineField(MANUAL_ORDER_LINE_QTY_BASE, i));
    const unitPrice = readNonNegInt(
      form,
      manualOrderLineField(MANUAL_ORDER_LINE_UNIT_PRICE_BASE, i),
    );
    const taxBasis = readField(form, manualOrderLineField(MANUAL_ORDER_LINE_TAX_BASIS_BASE, i));
    // 🔵 還沒填完的列**跳過**,不當成 0 —— 一張填到一半的單不該顯示一個假的總額。
    if (qty === null || unitPrice === null || taxBasis === null) continue;
    lines.push({ qty, unitPrice, taxBasis });
  }
  // 🔴 **一列都還沒填 ⇒ 不顯示**(而不是顯示 0)——「還沒開始」與「總共 0 元」是兩件事。
  if (lines.length === 0) return null;

  const shippingFee = readNonNegInt(form, MANUAL_ORDER_SHIPPING_FEE_FIELD) ?? 0;
  const shippingFeeTaxBasis = readField(form, MANUAL_ORDER_SHIPPING_FEE_TAX_BASIS_FIELD) ?? '';
  return manualOrderPreview({
    lines,
    shippingFee,
    shippingFeeTaxBasis,
    invoiceRequested: readField(form, MANUAL_ORDER_INVOICE_REQUESTED_FIELD) === 'on',
  });
}

const money = (n: number) => `NT$ ${n.toLocaleString()}`;

export function ManualOrderTotalPreview() {
  const [state, setState] = useState<ManualOrderPreview | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (host === null) return;
    const form = host.closest('form');
    if (form === null) return;
    const recompute = () => {
      setState(readPreview(form));
    };
    recompute();
    // 🔵 `input` 抓打字、`change` 抓下拉與勾選 —— 兩個都要,少一個就有一種操作不會更新。
    form.addEventListener('input', recompute);
    form.addEventListener('change', recompute);
    return () => {
      form.removeEventListener('input', recompute);
      form.removeEventListener('change', recompute);
    };
  }, [host]);

  return (
    <div ref={setHost} className='mt-3 rounded-md border p-3 text-sm' data-testid='manual-order-total-preview'>
      {/* 🔴 **這一行不可以拿掉** —— 它是本片與那句「畫面說 A、單子是 B」之間的分界:
          讀的人要知道**這個數字不會被送出去**,真正的金額由系統重算。 */}
      <p className='text-muted-foreground mb-2 text-xs'>
        預覽(不會送出去;實際金額由系統在建單時重算)
      </p>
      {state === null ? (
        <p className='text-muted-foreground' role='status'>
          填了品項的數量與單價之後,這裡會算給你看。
        </p>
      ) : state.kind === 'blocked' ? (
        /* 🔴 **除不盡時【不編一個數字出來】** —— 那筆單送出去會被擋,
            而這裡顯示一個總額會讓他以為填得對。訊息與送出時擋下來的那句是同一件事。 */
        <p className='text-destructive' role='status'>
          {state.at}的 {state.taxed.toLocaleString()} 標成含稅,換算回未稅不是整數 ⇒
          這張單送出去會被擋。請跟對方問到未稅金額。
        </p>
      ) : (
        <dl className='grid grid-cols-2 gap-x-4 gap-y-1' role='status'>
          <dt>小計</dt>
          <dd className='text-right'>{money(state.subtotal)}</dd>
          <dt>運費</dt>
          <dd className='text-right'>{money(state.shippingFee)}</dd>
          {/* 🔵 **稅那一行【沒勾就不出現】** —— 印一行「稅 NT$ 0」會讓人以為系統算了一個 0,
              而實際上那條路根本沒有算稅(RPC 第 7 代:沒勾就不加)。 */}
          {state.tax > 0 && (
            <>
              <dt>營業稅(5%)</dt>
              <dd className='text-right'>{money(state.tax)}</dd>
            </>
          )}
          <dt className='font-bold'>總計</dt>
          <dd className='text-right font-bold'>{money(state.total)}</dd>
        </dl>
      )}
    </div>
  );
}
