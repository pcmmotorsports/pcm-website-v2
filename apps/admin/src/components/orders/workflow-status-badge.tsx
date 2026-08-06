// workflow-status-badge.tsx — 訂單處理狀態帶色 UI 的字色常數(M-4a Slice A 遺留)。
//
// 🔴 **A11a-1(2026-08-06)**:本檔原本的 `WorkflowStatusBadge` 元件已隨列表九碼三群下架而零 consumer,
//    連同 `order-list-view.ts` 的 `WorkflowStatusBadgeView` / `workflowStatusBadge()` 一併移除。
//    **但整個檔不能刪** —— `BADGE_TEXT_COLOR` 仍被 writer 鏈的 `workflow-status-select.tsx` 使用,
//    而那條鏈歸 A9w4a / A9w4c 後半,不歸本片(plan §3.1 原本把本檔標成「整檔刪」是**錯的**,
//    實際 grep 到 `workflow-status-select.tsx:5` 這個 consumer;已回寫 plan)。
// ⇒ 本檔隨 `workflow-status-select.tsx` 一起在 **A9w4c 後半**收掉。

/** 深底淺字 / 淺底深字的實際字色(near-white / zinc-800;對齊 admin 明亮基調;帶色下拉在用)。 */
export const BADGE_TEXT_COLOR = { light: '#fafafa', dark: '#27272a' } as const;
