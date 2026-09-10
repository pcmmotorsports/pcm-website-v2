'use client';

import { useEffect, useState } from 'react';

import {
  readInvoiceRequestedFromForm,
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
  // ⛔ ~~🔴 同名多個(那顆勾選有一個同名 hidden 墊底)⇒ `namedItem` 回 RadioNodeList,
  //    而它的 `.value` 就是**最後一個有效值** —— 與解析端「取最後一個值」逐字同一個規則。~~
  //
  // 🔴🔴🔴 **[2026-09-10] 上面那句話【是假的】,而它是那個 bug 活到今天的原因。**
  //    🔬 jsdom 實跑(hidden `off` + checkbox `on` 同名, **一個 radio 都沒有**):
  //    ```
  //    checked=false │ namedItem.value = ""  判 false │ 解析端 getAll 取最後 "off" 判 false  ✅ 碰巧一致
  //    checked=true  │ namedItem.value = ""  判 false │ 解析端 getAll 取最後 "on"  判 true   🔴 相反
  //    ```
  //    🎯 `RadioNodeList.value` 是「**第一個【被勾選的 radio】的值,否則空字串**」——
  //      這裡一個 radio 都沒有 ⇒ **它恆回 `""`**。**它從來不是「最後一個有效值」。**
  //    📌 **⇒ 「兩個實作用同一條規則」是被【寫下來】的,不是被【驗過】的。**
  //      而它們在**一半的世界裡相反** —— 沒勾的時候碰巧一致,那正是它活了一天的原因。
  //    🛑 **這句話不刪掉、用刪除線留著** —— 它比一句「被劃掉而仍被當現行」的話更毒:
  //      **那些看得出被劃掉,而這一句沒有被劃掉、讀起來很有道理、還叫下一個人不要往這裡看。**
  //    ⚠️ **而根因不是這一行,是這支檔【一支測試都沒有】** —— 見 `manual-order-total-preview.test.tsx`。
  //
  // 🛑 **所以那顆勾選【不走這一支】** —— 它走 `readInvoiceRequestedFromForm`(見 `readPreview`)。
  //    本支只給**單值欄位**用(運費 / 稅基 select),那些欄位沒有同名墊底。
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

/** 🔵 `unknown_invoice` 是**本元件自己的狀態**, 不進 `ManualOrderPreview` ——
 *    那個型別是**算式的結果**, 而「讀不到那顆勾選」是**讀的問題**, 兩件事不要混。 */
type PreviewState = ManualOrderPreview | { readonly kind: 'unknown_invoice' };

function readPreview(form: HTMLFormElement): PreviewState | null {
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

  const invoiceRequested = readInvoiceRequestedFromForm(form);
  // 🔴🔴 **判不出那顆勾選 ⇒ 不編一個總額出來,而【要說出是哪一種不知道】。**
  //    ⛔ ~~回 `null`~~ ⇒ 那會與「還沒填品項」共用同一句話
  //      (「填了品項的數量與單價之後,這裡會算給你看」)
  //      ⇒ 📌 **那句話在這個世界裡是【誤導】** —— 他把品項填好了, 而它還是不會算,
  //        因為壞掉的是別的東西。而他會一直去改品項。
  //    🎯 **「算不出來」與「還沒開始算」是兩件事** —— 那正是這一整片在講的形狀。
  if (invoiceRequested === null) return { kind: 'unknown_invoice' } as const;
  const shippingFee = readNonNegInt(form, MANUAL_ORDER_SHIPPING_FEE_FIELD) ?? 0;
  const shippingFeeTaxBasis = readField(form, MANUAL_ORDER_SHIPPING_FEE_TAX_BASIS_FIELD) ?? '';
  return manualOrderPreview({
    lines,
    shippingFee,
    shippingFeeTaxBasis,
    // 🔴🔴 **[2026-09-10] 改叫【解析端與逐列比價共用的那一支】。**
    //    ⛔ ~~`readField(form, MANUAL_ORDER_INVOICE_REQUESTED_FIELD) === 'on'`~~
    //      ⇒ 那條路走 `RadioNodeList.value`, 而它**恆回 `""`** ⇒ 📌 **恆假 ⇒ 這個預覽
    //        從落地那天起【一律印沒勾的答案】, 而那正是它存在的唯一理由。**
    //    ✅ 現在與 `manual-order-form.ts:825`(server 送出)、逐列比價**同一把尺**。
    //    🔵 而 `null`(那一格壞掉了)⇒ **不說話**, 不是當成 `false` ——
    //      照逐列比價那支的立場:在一個判不出來的前提上算出來的數字, 比沒有數字糟。
    //      🎯 **而「把讀不到讀成沒勾」正是今天這個 bug 的形狀。**
    invoiceRequested,
  });
}

const money = (n: number) => `NT$ ${n.toLocaleString()}`;

export function ManualOrderTotalPreview() {
  const [state, setState] = useState<PreviewState | null>(null);
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
      ) : state.kind === 'unknown_invoice' ? (
        /* 🔴 **判不出那顆勾選** —— 不編一個總額, 而且**不要說「填了品項就會算」**:
           他已經填了, 而壞掉的是別的東西。⇒ 說出來, 並告訴他下一步。 */
        <p className='text-amber-700' role='status'>
          讀不到「這張單要不要開發票」那一格,所以算不出總額。請重新整理這一頁;還是一樣請找工程師。
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
