'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { useShipmentLauncher } from './shipment-launcher';
import { NextStepDialog } from './next-step-dialog';

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
  moreRows = null,
  onlyItemIds,
}: {
  orderId: string;
  /** B9 批次列:只把勾到的品項放進候選(`?items=`);沒給 = 整張單。 */
  onlyItemIds?: readonly string[];
  /** 沒建箱就關掉 ⇒ 回列表、**保留他原本展開的那張**(取消不該改變他在看什麼)。 */
  closeHref: string;
  /** 建了箱(不論之後成不成功)⇒ 回列表、**展開這一張**(結果歸屬跟著單走;codex R2 must-fix ②)。 */
  doneHref: string;
  /** B13-b:稿「更多」六列(server 端渲染好的 `ShipmentMoreRows`),透傳給彈窗。 */
  moreRows?: ReactNode;
}) {
  const router = useRouter();
  // 🔴 codex R3 must-fix ②:這個名字**一定要在本地宣告** —— 下面「回列表」那顆 `onClick={close}`,少了本地的
  //    `close` 會靜靜落到 `window.close`(typecheck 不會叫),按了什麼都不發生。
  const close = () => router.replace(closeHref);
  const { loading, error, openDialog, dialog } = useShipmentLauncher([orderId], undefined, {
    onClose: (createdShipment) => router.replace(createdShipment ? doneHref : closeHref),
    moreRows,
    ...(onlyItemIds !== undefined ? { onlyItemIds } : {}),
  });

  // 網址說要開 ⇒ 掛上來就開一次。`useRef` 擋 StrictMode 的雙重 effect:開兩次 = 生兩把冪等鍵。
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    void openDialog();
  }, [openDialog]);

  // 🔴 讀取中 / 讀不到 / 沒品項 ⇒ **要有殼**(B13:「無品項的單 ?next=&do=ship 不開也不報」—— 原本這兩個狀態是裸 `<div>`
  //    掉在頁面流裡,員工按了「出貨」什麼都沒看到)。`ShipmentDialog` 自己是整片遮罩 ⇒ 開起來之後才不包殼。
  if (loading) {
    return (
      <NextStepDialog title='出貨' closeHref={closeHref}>
        <p className='text-muted-foreground text-[13px] leading-[1.4]' data-testid='next-step-shipment-loading'>
          讀取可出貨的品項…
        </p>
      </NextStepDialog>
    );
  }
  if (error !== null) {
    return (
      <NextStepDialog title='出貨' closeHref={closeHref}>
        <p className='text-destructive text-[13px] leading-[1.4]' data-testid='next-step-shipment-error'>
          {error}
        </p>
        {/* 🔴 B13-b:「都已裝進其他箱子」正是員工要找【那一箱】的時候 —— 稿「更多」六列(叫車 / 標已取件 / 列印 / 這張單的箱 /
            改單號 / 作廢)在這個狀態直接攤開,不再叫他「到那張訂單的出貨紀錄找」。鑽機實測 PCM-2026-1004 走到這裡。 */}
        {moreRows !== null && (
          <div className='mt-3 border-t pt-2' data-testid='next-step-shipment-more'>
            {moreRows}
          </div>
        )}
      </NextStepDialog>
    );
  }
  return <div className='next-step-body'>{dialog}</div>;
}
