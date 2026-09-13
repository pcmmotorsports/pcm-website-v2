'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

import { useShipmentLauncher } from './shipment-launcher';

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
// 🏁 **P-e-3(2026-09-13):接線 = 拿掉 `submit: nextStepStubSubmit`** ⇒ launcher 走預設 = 明細頁那支 `submitShipment`
//    (三支 RPC 串在同一支 action 裡,今天就是這樣串的)。
//
// ⚠️ 既有彈窗有比「快遞商 + 單號 + 確認」更多的東西(要出哪幾樣 / 收件人 / 新竹已取件那顆勾)——
//    那是明細頁出貨彈窗今天的樣子。把**共用**彈窗收斂成三樣會同時改到明細頁 ⇒ 另一題,規格 §3-f-4c 給 Sean。

export function NextStepShipmentBody({
  orderId,
  closeHref,
  doneHref,
}: {
  orderId: string;
  /** 沒建箱就關掉 ⇒ 回列表、**保留他原本展開的那張**(取消不該改變他在看什麼)。 */
  closeHref: string;
  /** 建了箱(不論之後成不成功)⇒ 回列表、**展開這一張**(結果歸屬跟著單走;codex R2 must-fix ②)。 */
  doneHref: string;
}) {
  const router = useRouter();
  // 🔴 codex R3 must-fix ②:這個名字**一定要在本地宣告** —— 下面「回列表」那顆 `onClick={close}`,少了本地的
  //    `close` 會靜靜落到 `window.close`(typecheck 不會叫),按了什麼都不發生。
  const close = () => router.replace(closeHref);
  const { loading, error, openDialog, dialog } = useShipmentLauncher([orderId], undefined, {
    onClose: (createdShipment) => router.replace(createdShipment ? doneHref : closeHref),
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
  // 稿樣式只包一層(`.next-step-body` 的 descendant 規則對 position:fixed 的子孫照樣生效),ShipmentDialog 本體不動。
  return <div className='next-step-body'>{dialog}</div>;
}
