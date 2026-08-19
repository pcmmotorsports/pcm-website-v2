'use client';

import type { ReactNode } from 'react';

import { useAdminFieldError, useAdminFieldErrorId } from './admin-form-errors';

// admin-form-field-inner.tsx — 片4:`AdminFormField` 的 client 內層。
//
// 🔴 **為什麼要拆出這一支,而不是把 `admin-form.tsx` 標成 `'use client'`**:
//    那支檔同時匯出 `AdminForm`(它收 server action 當 `action` prop)。
//    整支標 client ⇒ **14 個消費端裡那 7 支 server component 會被拉進 client bundle**,
//    而 plan §② 明寫「**7 個 server 消費端不變**」——那是本片的代價上限,不能自己突破。
//    ⇒ 只有**真的需要讀 context 的那一層**是 client,其餘照舊。
//    (同一個形狀的前例:`orders/item-amount-row.tsx` 逐字「provider 包住的 children 仍是 server 算好的」。)
//
// 🔴🔴 **這一層【不碰控制項的 DOM】**(2026-08-19 codex K2 finding 2+6 折後的形狀):
//    初版在 `{children}` 外面包了一層 `<div aria-invalid>`,兩個問題:
//    ① 那個 aria 是**假的** —— 報讀器讀輸入框時讀不到它(真解在 `useAdminFieldErrorProps`);
//    ② 那一層 div **會出現在 14 個消費端全部的 DOM 裡**,而本片沒有要改它們的版面。
//    ⇒ 現在:**沒有錯誤時,這一層產出的 DOM 與片4 之前逐字相同**;有錯誤才多一個 `<span>`。

export function AdminFormFieldInner({
  label,
  name,
  children,
}: {
  label: string;
  name?: string;
  children: ReactNode;
}) {
  // 🔴 `name` 沒給 ⇒ 這一欄完全不參與錯誤機制(行為與片4 之前一模一樣)。
  const error = useAdminFieldError(name ?? '');
  const errorId = useAdminFieldErrorId(name ?? '');
  return (
    <label className='flex flex-col gap-1 text-sm'>
      <span className='text-muted-foreground text-xs font-medium'>{label}</span>
      {children}
      {/* 🔴 `role='alert'`:錯誤出現的當下要被念出來,不必等使用者移到那一欄。 */}
      {error !== null && (
        <span id={errorId} role='alert' className='text-destructive text-xs'>
          {error}
        </span>
      )}
    </label>
  );
}
