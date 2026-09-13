// manual-order-field-classes.ts — 手動建單表單的【長相】常數(v20 稿), 三支元件共用。
//
// 🔬 真值來源:`scripts/tool-final-css.py` 抽 `orders-admin-v20-A-發票小抄.html` 的 `#modal` 那組(2026-09-13):
//   .f       grid 1fr 1fr · gap 6px 8px · margin 6px 0
//   label    12px · fg2 · flex-col · gap 2px
//   input/select  min-height 28px · border 1px line · radius 6px · padding 0 8px · bg card · fg
//   .sec     margin 10px 0 0 · border-top 1px line;summary 12.5px / 600 / fg2
//   .ib      border · radius 7px · padding 2px 8px · 12px · fg2(小鈕:找客人 / 同上 / 再加一樣)
//            ⚠️ 圓角走 token `rounded-md`(= 6px, `--radius` 階梯 sm4/md6/lg8/xl12):圓角守門禁裸值, 7 不在階梯上 ⇒ 取最近的 md。
//   .btn-p   bg primary · 白字 · min-h 30 · padding 0 12 · radius 8(主鈕)
//
// 🔴 **只有 className, 零行為** —— 主視窗硬線「只搬容器, 寫入路徑一個字不變」;
//    三支元件的欄位 / name / 驗證 / action 都沒動, 動的只有這幾串字。
// 🔴 `leading-[1.4]`:`globals.css` 稿 FIX-27 把 `text-xs`/`text-[13px]` 拉到 14px、`text-sm` 拉到 16px,
//    **除非元素帶 leading-*** —— 發票小抄那片量出來的, 少一個 leading 那一格就靜靜大一號。
// 🔵 稿的 `--line` / `--mut` 本站是 `--border` / `--muted-foreground`(比對表 :80-81 記過的全站差), fg2 逐字同。

export const MANUAL_FIELD_GRID = 'my-[6px] grid grid-cols-2 gap-x-2 gap-y-[6px]';
export const MANUAL_FIELD_LABEL = 'flex flex-col gap-[2px] text-xs leading-[1.4] text-(--fg-2)';
export const MANUAL_FIELD_INPUT =
  'border-border bg-card text-foreground min-h-[28px] w-full rounded-md border px-2 text-sm leading-[1.4]';
/** 稿用 `<details class="sec">`;我們是 `<fieldset>` + `<legend>` —— 形狀對齊, 元素不換(legend 是無障礙那一格)。 */
export const MANUAL_SECTION = 'border-border mt-[10px] space-y-2 border-t pt-2';
export const MANUAL_SECTION_LEGEND = 'px-1 text-[12.5px] leading-[1.4] font-semibold text-(--fg-2)';
export const MANUAL_SMALL_BUTTON =
  'border-border bg-card inline-flex shrink-0 items-center rounded-md border px-2 py-[2px] text-xs leading-[1.4] whitespace-nowrap text-(--fg-2) disabled:opacity-50';
