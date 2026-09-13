'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

import { useShipmentLauncher } from './shipment-launcher';
import { nextStepStubSubmit } from '../../lib/orders/next-step-stub-action';

// next-step-shipment-body.tsx — 列表「下一步 = 出貨」的【內容】(P-e-2b,2026-09-13)。
//
// 🔴🔴 **`?next=<單號>&do=ship` 打開的是【表單】,不是動作。** 貼一個網址不會寫進任何東西;
//    寫入只發生在他按下「確認」那一刻。(`docs/plans/2026-09-13-next-step-button-write-plan.md` §0)
//
// ── 這一支與另外兩支長得不一樣,理由寫在這裡 ──────────────────────────────────
// 下訂 / 到貨是 **form action**(server component 包一份既有表單就好)。
// 出貨那份既有彈窗 `ShipmentDialog` 是 **client 端直接呼叫 `submitShipment(input)`**,而且**它自己就是
// 一整片 `fixed inset-0 z-50` 的遮罩 + `role='dialog'`**。
// ⇒ 🔴 **它不能被塞進另一個 `showModal()` 的 `<dialog>` 裡** —— top layer 會蓋住它。
// ⇒ 📌 所以 `do=ship` 這一條,**殼不要包**:page 直接渲染本元件,本元件自己就是那個彈窗(已對過施工窗)。
//
// 🔴 **走 `useShipmentLauncher`,不自己 fetch、不自己渲染 `<ShipmentDialog>`**:
//    `shipping-selection.test.tsx` 釘住「`<ShipmentDialog` 全資料夾只被一個檔渲染、`fetchShipmentCandidates`
//    只有一個呼叫點」。**第一版我自己 fetch + 自己渲染,那道守門當場紅** —— 它防的是「開窗時生冪等鍵」
//    那條紀律被複製成兩份,而其中一份改成送出時生鍵不會有任何症狀(連按兩次建出兩箱)。
//    ⇒ 改成給 launcher 兩個選填鉤子(`submit` / `onClose`),第三個入口共用同一份彈窗與同一把鍵。
// 🔴 **零寫入(P-e-2)**:`submit: nextStepStubSubmit`,守門 `next-step-bodies.test.ts`。
//
// ⚠️ 既有彈窗有比「快遞商 + 單號 + 確認」更多的東西(要出哪幾樣 / 收件人 / 新竹已取件那顆勾)——
//    那是明細頁出貨彈窗今天的樣子。把**共用**彈窗收斂成三樣會同時改到明細頁 ⇒ 另一題,規格 §3-f-4c 給 Sean。

export function NextStepShipmentBody({
  orderId,
  returnTo,
}: {
  orderId: string;
  /** 關掉 / 做完回哪裡 = 列表自己(不帶 `next`/`do`)。 */
  returnTo: string;
}) {
  const router = useRouter();
  const close = () => router.replace(returnTo);
  const { loading, error, openDialog, dialog } = useShipmentLauncher([orderId], undefined, {
    submit: nextStepStubSubmit,
    onClose: close,
  });

  // 網址說要開 ⇒ 掛上來就開一次。`useRef` 擋 StrictMode 的雙重 effect:開兩次 = 生兩把冪等鍵。
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    void openDialog();
  }, [openDialog]);

  if (loading) {
    return (
      <p className='text-muted-foreground p-4 text-sm' data-testid='next-step-shipment-loading'>
        讀取可出貨的品項…
      </p>
    );
  }
  if (error !== null) {
    return (
      <div className='p-4 text-sm' data-testid='next-step-shipment-error'>
        <p className='text-destructive'>{error}</p>
        <button type='button' className='mt-2 underline' onClick={close}>
          回列表
        </button>
      </div>
    );
  }
  return <>{dialog}</>;
}
