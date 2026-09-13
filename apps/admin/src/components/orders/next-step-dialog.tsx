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

  /* 🎨 **長相照稿 v22**(Sean 2026-09-13 逐字「請務必記住要依照新版本的風格去改動」)。
     真值從 `orders-admin-v22-A-出貨彈窗收斂.html` 的 `<style>` 抽出來,不是憑印象:
       dialog        { border:0; border-radius:12px; padding:0; box-shadow:0 20px 60px rgba(16,24,40,.25) }
       dialog::backdrop { background:rgba(16,24,40,.45) }
       dialog .bd    { padding:18px 20px }
       dialog h3     { margin:0 0 6px; font-size:16px }
       .ft           { display:flex; gap:8px; justify-content:flex-end }
       .btn          { inline-flex; min-height:30px; padding:0 12px; border-radius:8px; 1px solid var(--line); bg var(--card); color var(--fg) }
       .btn-p        { bg var(--primary); border-color var(--primary); color #fff }
     稿的結構:<dialog><div class="bd"><h3>標題</h3>【表單】<div class="ft">[取消 .btn][確認 .btn-p]</div></div></dialog>
     🔴 **一格刻意偏離稿:沒有 `box-shadow`。** BMW M 那條「投影式陰影全站零殘留」是拍過的
        (`design-tokens.test.ts` 守著),而主視窗裁「拍過的優先於稿」⇒ 分層靠 `::backdrop` 那層遮罩。
     ⚠️ 「確認」那顆 `.btn-p` 住在 body 的表單裡(它是 submit),不在殼 ⇒ 稿上取消/確認同一列的形狀,
        由 body 端把自己的送出鈕排進 `.ft` 才會完整;殼只給「取消」與那一列的容器。
     ⚠️ token 對映:稿 `--line`→我方 `--border`、`--fg`→`--foreground`、`--card`/`--primary` 同名;
        圓角走 token(`rounded-xl` = `--radius-xl` = 12px、`rounded-lg` = 8px),**不寫死方括號** —— 圓角守門禁裸值。 */
  return (
    <dialog
      ref={ref}
      data-testid='next-step-dialog'
      aria-labelledby='next-step-title'
      // 🔴🔴 **`m-auto` 是承重的,不是排版**(A 窗 2026-09-13 在 3025 真瀏覽器量到):全域 reset 把 `dialog` 的
      //    margin 歸零,而原生 `<dialog>` 是靠 `margin:auto` 置中的 ⇒ 少了它彈窗**釘在左上角 x=0**,
      //    看起來像一個「左側抽屜」—— Sean 截圖看到的就是那個。
      //    computed 逐字:`position fixed · margin 0px · inset 0px · left 0 · top 0`。
      // 🔴 寬 520 = 稿 `#modal{width:520px}`(v20/v22 同值),不是 560。
      className='bg-card text-foreground m-auto w-[min(520px,calc(100vw-2rem))] rounded-xl border-0 p-0 backdrop:bg-[rgba(16,24,40,.45)]'
      // 點遮罩關:`<dialog>` 自己是 target 時才算點到遮罩(點到內容時 target 是子元素)。
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
    >
      <div className='px-5 py-[18px]'>
        {/* 🔴 `leading-[1.4]` 是承重的:FIX-27(`globals.css`)把沒帶 `leading-*` 的 `text-sm`/`text-xs`
            **拉大一號**(13→14、15→16),而畫面看起來完全正常。稿的標題 16px、鈕 13px ⇒ 帶 leading 才是真值。
            真瀏覽器量 computed fontSize,不看 class。 */}
        <h3 id='next-step-title' className='mb-1.5 text-base leading-[1.4] font-semibold'>
          {title}
        </h3>
        <div>{children}</div>
        {/* 🔴 `form method="dialog"` 的 submit = 原生關閉(觸發 `close` 事件)⇒ 不需要 onClick。
            這顆是 Tab 第一站(上面 effect 給焦點)。長相 = 稿的 `.btn`。 */}
        <form method='dialog' className='mt-3 flex justify-end gap-2'>
          <button
            ref={cancelRef}
            type='submit'
            className='border-border bg-card text-foreground inline-flex min-h-[30px] items-center rounded-lg border px-3 text-[13px] leading-[1.4]'
          >
            取消
          </button>
        </form>
      </div>
    </dialog>
  );
}
