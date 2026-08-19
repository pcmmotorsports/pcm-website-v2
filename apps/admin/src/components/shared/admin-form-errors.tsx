'use client';

import { createContext, useContext, useId, type ReactNode } from 'react';

// admin-form-errors.tsx — 片4:**表單錯誤狀態資料流**(規格 §4-3 雙層錯誤的下半)。
//
// 🔴🔴 **本檔存在的理由,不是「加一個 context 比較方便」**:
//   `admin-form.tsx` 的 `ponytail:` 註解逐字寫著雙層錯誤「**等先有【錯誤狀態資料流】再獨立做**」
//   ⇒ 它不是漏做,是**有主人、有前置的**,而那個前置**在本檔之前不存在**。
//
// 🔴 **為什麼是 context,而不是讓 `AdminForm` 直接吃一個 `errors` prop(形狀 B)**
//   —— 這一格是 2026-08-19 的 4a 驗證裁掉的,證據在 `~/pcm-mailbox/W1-012-…plan-v2…md`:
//   `settings/supplier-create-form.tsx` 把**整包欄位委外**給 `SupplierLabelInput`,
//   `AdminForm` 只拿到一個 `children` ⇒ **它看不見那些欄位** ⇒ B 對它**結構上做不到**。
//   ⇒ 而 context 只要求**欄位那一端拿得到**,渲染在誰手上不重要;
//     `supplier-label-input.tsx` 第 1 行是 `'use client'` ⇒ **它拿得到**(決定性證據)。
//
// ⚠️ **已知邊界(寫在這裡,因為 plan 收工就沒人再讀)**:
//   日後若有人把欄位委外給一個 **server** 元件,**本機制對它也做不到**
//   —— server component 讀不到 client context。今天 14 個消費端裡**沒有那種情況**
//   (數法:`grep -rln "AdminForm" apps/admin/src --include='*.tsx' | grep -v '\.test\.' | grep -v 'shared/admin-form'`)。
//
// 🔴 **形狀照既有前例,不是本 repo 第一個 context**:
//   `orders/item-amount-row.tsx` 的 `ItemAmountRowGroup` —— **client provider 包住 server 算好的 children**
//   ⇒ 消費端**不必**變成 client(今天 14 支裡有 7 支是 server,它們不變)。

/** 欄位名 → 給員工看的那一句話。**沒有錯的欄位不在這個物件裡**(不是空字串)。 */
export type AdminFormFieldErrors = Readonly<Record<string, string>>;

type FieldErrorScope = {
  errors: AdminFormFieldErrors | null;
  /**
   * 這一張表單實例專屬的 DOM id 前綴。
   *
   * 🔴 **為什麼不能只用 `${name}-error`**(2026-08-19 codex K2 finding 3):
   *    `receipt-action-state.ts` 逐字「一個品項可能有多筆採購、各有一顆按鈕」
   *    ⇒ **同一頁真的會同時掛好幾張登錄到貨表單,每張都有 `name='quantity'`**
   *    ⇒ 固定字面的 id 會**重複**,而 `aria-describedby` 指向重複 id 時,
   *      螢幕報讀器讀到的可能是**別張表單的錯誤**。前綴由 provider 用 `useId()` 生。
   */
  idPrefix: string;
};

const FieldErrorContext = createContext<FieldErrorScope | null>(null);

/**
 * 把這一次送出的欄位級錯誤交給底下所有欄位。
 *
 * 🔴 **`errors` 為 `null` 與 `{}` 是兩件事,而本檔【刻意不區分】** ——
 *    兩者對欄位的意思都是「你沒有錯」。**若日後要區分「還沒送出」與「送出過且全對」,
 *    那是另一個需求,不要在這裡偷偷加語意。**
 */
export function AdminFormErrorProvider({
  errors,
  children,
}: {
  errors: AdminFormFieldErrors | null;
  children: ReactNode;
}) {
  const idPrefix = useId();
  return (
    <FieldErrorContext.Provider value={{ errors, idPrefix }}>
      {children}
    </FieldErrorContext.Provider>
  );
}

/**
 * 讀某一欄的錯誤;沒有就回 `null`。
 *
 * 🔴 **沒有 provider 時回 `null`(不是丟錯)** —— 那是刻意的:
 *    14 個消費端有 7 支是 server component,它們**今天還沒接上** provider,
 *    而「還沒接」不該讓畫面爆掉。
 *    ⚠️ **代價要講白**:忘了包 provider 的症狀是「**錯誤訊息不出現**」,而那**看起來完全正常**
 *    ⇒ 所以接線清單要在片4 的交件檔**當場列出來**,不能靠誰記得(見 plan §⑨)。
 */
export function useAdminFieldError(name: string): string | null {
  const scope = useContext(FieldErrorContext);
  return scope?.errors?.[name] ?? null;
}

/** 錯誤那一句話的 DOM id;沒有 provider(或沒給 name)時回 `undefined` —— 沒有東西可以指。 */
export function useAdminFieldErrorId(name: string): string | undefined {
  const scope = useContext(FieldErrorContext);
  return scope && name ? `${scope.idPrefix}-${name}-error` : undefined;
}

/**
 * **要展開到真正那個 `<input>` / `<select>` 上的 props。**
 *
 * 🔴🔴 **為什麼這個 hook 必須存在,而不是由 `AdminFormField` 代掛**
 *    (2026-08-19 codex K2 finding 2 —— 它擋下的是一個**假的無障礙宣稱**):
 *    `AdminFormField` 拿到的控制項是呼叫端傳進來的 `children`,**它碰不到那個 props**。
 *    片4 初版的做法是**包一層 `<div aria-invalid>`**,而那是壞的,兩個理由都硬:
 *    ① 報讀器讀到輸入框時**根本讀不到**掛在外層 div 的 `aria-describedby`;
 *       `aria-invalid` 掛在一個沒有 role、沒有名稱、不吃焦點的 div 上**什麼都不表示**。
 *    ② `<div>` 是 flow content,**放進 `<label>` 裡是不合法的 HTML**。
 *    ⇒ 改成 **呼叫端把這包 props 展開到自己的控制項上**。四行,而且是真的。
 *
 * ⚠️ 沒展開這包 props 的欄位,行為與片4 之前一模一樣 —— 那是 14 支不必同片全改的代價。
 */
export function useAdminFieldErrorProps(name: string) {
  const error = useAdminFieldError(name);
  const errorId = useAdminFieldErrorId(name);
  if (error === null) return {} as const;
  return { 'aria-invalid': true, 'aria-describedby': errorId } as const;
}
