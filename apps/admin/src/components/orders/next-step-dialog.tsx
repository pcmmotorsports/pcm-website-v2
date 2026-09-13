'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

// next-step-dialog.tsx — 「下一步」那顆鈕開的彈窗【殼】（P-e-1，2026-09-13，Sean 批 P-e 甲）。
//
// 🔴🔴 **殼不知道裡面是什麼。** 內容由 `orders/page.tsx`（server）依 `?do=` 挑好、當 `children` 塞進來
//    （設計窗做的三支 body 是帶 server action 的表單，可以是 server component ⇒ 不需要進這支 client 檔）。
//    ⇒ 本檔只管四件事：開、關、焦點、網址。**零資料、零寫入。**
//
// 🔴 **開關由【網址】決定，不是 state**（規格 §3-f-4：`?next=` 與 `?open=` 同族）：
//    有 `?next=<id>&do=<x>` ⇒ page 渲染本元件 ⇒ mount 時 `showModal()`；
//    Esc / 取消 / 點遮罩 ⇒ `router.replace(closeHref)`（= 同一頁、不帶 next/do）⇒ page 不再渲染本元件。
//    📌 這樣「關掉」與「重新整理」是同一件事 —— 不會出現「畫面上關了、網址上還開著」的分岔。
//    ⚠️ **貼這條網址不會寫進任何東西**（plan §0 頂端硬線）：殼裡沒有任何 action。
//
// 🔴 **Tab 第一站在「取消」**（規格 §3-f-3；plan §7-3）：`showModal()` 之後手動 `focus()` 取消鈕。
//    理由：這批彈窗裡有一顆是對外的（出貨 ⇒ 5 分鐘內寄出的信收不回）⇒ 預設焦點放在**不會造成損害**的那一顆。
//    ⚠️ 「Esc 與焦點拿得回來」是規格 §3-f-3 的更正版 —— 原本以為是代價，實查是 `<dialog>` 原生行為。
//
// 🔴 `<dialog>` 掛在**列表外層**（page.tsx），不在 `orders-table.tsx` 裡 ⇒ 那支的零 client 守門不動。

export function NextStepDialog({
  title,
  closeHref,
  children,
}: {
  /** 標題 = 那顆鈕的字面（跟供應商下訂 / 到貨登記 / 出貨），從 `ORDER_NEXT_STEP_LABEL` 來，不在這裡抄。 */
  title: string;
  /** 關掉之後去哪 = 同一頁、同一組篩選與頁碼、不帶 `next` / `do`。由 page 用 `buildOrderListHref` 算。 */
  closeHref: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 🔴 `showModal()` 不是 `show()`：前者才有遮罩、才把焦點困在裡面、Esc 才會關（原生行為）。
    // ⚠️ `typeof … === 'function'` 那一段是給 **jsdom** 的（它沒有 `showModal`，page 測試 render 整頁會炸）；
    //    真瀏覽器一定有。這不是「某些瀏覽器不支援」的防禦 —— `<dialog>` 早就全綠了。
    if (typeof el.showModal === 'function' && !el.open) el.showModal();
    cancelRef.current?.focus();
    const onClose = () => router.replace(closeHref);
    // `close` 事件蓋得住 Esc 與 `form method="dialog"` 兩種關法 ⇒ 關的路只有一條。
    el.addEventListener('close', onClose);
    return () => el.removeEventListener('close', onClose);
  }, [closeHref, router]);

  return (
    <dialog
      ref={ref}
      data-testid='next-step-dialog'
      aria-labelledby='next-step-title'
      // 🔴 沒有 `shadow-*`:BMW M 用 1px 描邊分層、不用投影(`design-tokens.test.ts` 全站零殘留那格守著)。
      //    彈窗與底下的分層靠 `backdrop:bg-black/40` 那層遮罩,不靠陰影。
      className='bg-card text-foreground border-border w-[min(560px,calc(100vw-2rem))] rounded-lg border p-0 backdrop:bg-black/40'
      // 點遮罩關：`<dialog>` 自己是 target 時才算點到遮罩（點到內容時 target 是子元素）。
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
    >
      <div className='border-border flex items-center justify-between border-b px-4 py-3'>
        <h2 id='next-step-title' className='text-base font-semibold'>
          {title}
        </h2>
        {/* 🔴 `form method="dialog"` 的 submit = 原生關閉（觸發 `close` 事件）⇒ 不需要 onClick。
            這顆是 Tab 第一站（上面 effect 給焦點）。 */}
        <form method='dialog'>
          <button
            ref={cancelRef}
            type='submit'
            className='border-input text-muted-foreground hover:text-foreground rounded-md border px-3 py-1 text-sm'
          >
            取消
          </button>
        </form>
      </div>
      <div className='px-4 py-3'>{children}</div>
    </dialog>
  );
}
