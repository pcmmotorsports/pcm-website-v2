'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  MANUAL_ORDER_INVOICE_TAX_ID_FIELD,
  MANUAL_ORDER_INVOICE_TITLE_FIELD,
} from '@/lib/orders/manual-order-form';
import { lookupInvoiceTitleAction } from '@/lib/orders/invoice-title-lookup-action';

// invoice-title-lookup-button.tsx — 統編旁邊那顆「查抬頭」(⟦b4-INVOICE5PCT⟧三 片三)。
//
// ══ 🔴🔴 它【真的把字寫進抬頭欄】—— 而那件事有一段歷史, 下一個人要看得出它不是矛盾 ═══
// `manual-order-lines.tsx:17-20` 有一道不變式逐字:
//   「送出值一律**不由 client state 產生或回寫;原生控制項才是送出來源**」
//   —— 那是 `E-011-STOP` 四輪修不穩 + 一次**誤送整單取消**換來的, **不是風格**。
// ⇒ 而 Sean 2026-08-31 為了它, 把「打料號自動帶入品名」改拍成**丙:顯示在旁邊, 自己抄**
//   (見 `manual-order-catalog-lookup.tsx` 檔頭整段)。
//
// 🎯 **而 2026-09-10 他為【這一格】拍了乙:真的自動帶入。而那不是他改變主意。**
//    📌 **兩次的受詞不同**:
//      · 那一次的受詞是**品項與金額** ⇒ 回寫錯 = **錢錯**, 而那道不變式就長在品項列那支檔上
//      · 這一次的受詞是**發票抬頭** ⇒ 一段文字, 而發票欄在 `manual-order-form-body.tsx`
//        (一支 **server component**), **那六道原始碼守門一道都沒有釘它**
//    ⇒ ✅ **那條不變式的射程是【品項列】, 不是整張表單** —— 本檔沒有踩到它。
//
// 🛑 **而寫法仍然照它的精神走**:直接寫那個 `<input>` 的 `.value`,
//    **不引入受控元件、不把值提上來、不從 state 產生送出值**。
//    ⇒ 那一格仍然是**原生控制項**, 而員工按完照樣可以自己改。
//    📌 **差別在「誰打了第一個字」, 不在「送出去的是誰」。**

function findInput(host: HTMLElement | null, name: string): HTMLInputElement | null {
  const form = host?.closest('form') ?? null;
  if (form === null) return null;
  const el = form.elements.namedItem(name);
  return el instanceof HTMLInputElement ? el : null;
}

export function InvoiceTitleLookupButton() {
  const [host, setHost] = useState<HTMLSpanElement | null>(null);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  // 🔵 統編那一格改了 ⇒ 把上一次的話清掉。**一句停在畫面上的舊訊息會被當成這一次的答案。**
  useEffect(() => {
    const el = findInput(host, MANUAL_ORDER_INVOICE_TAX_ID_FIELD);
    if (el === null) return;
    const clear = () => {
      setNote(null);
    };
    el.addEventListener('input', clear);
    return () => {
      el.removeEventListener('input', clear);
    };
  }, [host]);

  return (
    <span ref={setHost} className='inline-flex flex-col items-start gap-0.5'>
      <button
        type='button'
        disabled={pending}
        className='border px-2 py-0.5 text-xs disabled:opacity-50'
        onClick={() => {
          const taxIdEl = findInput(host, MANUAL_ORDER_INVOICE_TAX_ID_FIELD);
          const titleEl = findInput(host, MANUAL_ORDER_INVOICE_TITLE_FIELD);
          if (taxIdEl === null || titleEl === null) {
            setNote('找不到統編或抬頭那一格 —— 請自己打');
            return;
          }
          const taxId = taxIdEl.value.trim();
          start(async () => {
            const r = await lookupInvoiceTitleAction({ taxId });
            if (r.ok) {
              // 🔴 **直接寫原生控制項的值** —— 見檔頭。而它寫完就不再管那一格。
              titleEl.value = r.title;
              // 🔵 `input` 事件要自己派 —— 程式改 `.value` **不會**觸發它,
              //    而同一張表單上還有別的東西在聽(總額預覽)。
              titleEl.dispatchEvent(new Event('input', { bubbles: true }));
              setNote(`帶入「${r.title}」—— 不對的話直接改那一格`);
              return;
            }
            // 🔴 **三種話, 而它們給的指示不一樣**:
            //    invalid ⇒ 你打錯了 · not_wired ⇒ 不是你的錯 · 其餘 ⇒ 查不到
            setNote(
              r.reason === 'invalid'
                ? '統編要 8 碼數字'
                : r.reason === 'denied'
                  ? '你的登入沒有這個權限 —— 請自己打抬頭'
                  : r.reason === 'not_wired'
                    ? '查抬頭還沒接上來源 —— 請自己打抬頭(這不是你打錯)'
                    : '查不到 —— 請自己打抬頭',
            );
          });
        }}
      >
        {pending ? '查詢中…' : '查抬頭'}
      </button>
      {note !== null && <span className='text-muted-foreground text-xs'>{note}</span>}
    </span>
  );
}
