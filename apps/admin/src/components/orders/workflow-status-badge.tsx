import type { WorkflowStatusBadgeView } from '../../lib/orders/order-list-view';

// workflow-status-badge.tsx — 訂單處理狀態彩色 badge(M-4a Slice A;server-render)。
// 顏色來自 order_status_options(Sean 策展、DB CHECK 保證 hex 格式)→ 動態值無法用 Tailwind class
// → known=true 走 inline style;NULL/未知 code(known=false)走中性灰 Tailwind(不編造顏色)。

/** 深底淺字 / 淺底深字的實際字色(near-white / zinc-800;對齊 admin 明亮基調)。 */
const BADGE_TEXT_COLOR = { light: '#fafafa', dark: '#27272a' } as const;

export function WorkflowStatusBadge({ badge }: { badge: WorkflowStatusBadgeView }) {
  if (!badge.known) {
    return (
      <span className='bg-muted text-muted-foreground inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium'>
        {badge.label}
      </span>
    );
  }
  return (
    <span
      className='inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium'
      style={{ backgroundColor: badge.color, color: BADGE_TEXT_COLOR[badge.textColor] }}
    >
      {badge.label}
    </span>
  );
}
