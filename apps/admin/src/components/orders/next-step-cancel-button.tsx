// next-step-cancel-button.tsx — 彈窗裡「與確認同一排」的那顆取消。
//
// 🔴 稿(v20-v22 `#modal .ft{display:flex;gap:8px;justify-content:flex-end}`)是 [取消][確認] **同一排**,
//    而「確認」住在各 body 自己的 `<form>` 裡、「取消」原本住在殼的 footer ⇒ 兩排。
// 🔴 **怎麼跨 form 關窗:HTML 的 `form=` 屬性。** 這顆 `<button type='submit' form=NEXT_STEP_CLOSE_FORM_ID>`
//    可以放在 body 的 `<form>` 裡面,按下去送的是殼那支 `<form method='dialog'>`(原生關窗 ⇒ `close` 事件 ⇒
//    殼 `router.replace(closeHref)`),**不是** body 的表單 —— 巢狀 `<form>` 不合法,`form=` 正是為這件事存在的。
// 🔴 本檔**零 client**:純 `<button>`,server body 直接渲染;殼那支 `next-step-dialog.tsx` 是 'use client'。
// ⚠️ **只給「一張表單」的 body 用**(收款 / 發票 / 手動建單)。下訂 / 到貨是**每個品項一張表單**,
//    每張旁邊各放一顆取消 = 一個彈窗好幾顆取消 ⇒ 那兩支照舊用殼的 footer(`inlineCancel` 不傳)。

/** 殼裡那支隱形 `<form method='dialog'>` 的 id;body 端的取消鈕用 `form=` 指向它。 */
export const NEXT_STEP_CLOSE_FORM_ID = 'next-step-close';

/** 長相 = 稿的 `.btn`(min-height 30 / padding 0 12 / radius 8 / 1px line / card 底 / fg 字),與殼 footer 那顆逐字同款。 */
export const NEXT_STEP_CANCEL_CLASS =
  'border-border bg-card text-foreground inline-flex min-h-[30px] items-center rounded-lg border px-3 text-[13px] leading-[1.4]';

export function NextStepCancelButton() {
  return (
    <button type='submit' form={NEXT_STEP_CLOSE_FORM_ID} className={NEXT_STEP_CANCEL_CLASS} data-next-step-cancel=''>
      取消
    </button>
  );
}
