import Link from 'next/link';
import type { ProductSetByFilter } from '../../lib/products/product-repository';

// M-4b `#20` 片2c:商品列表工具列的快速篩選 chip(手動 / 自動)。
//
// 🔴 **不是重用 `components/orders/order-filter-chips.tsx` 這個「元件」,是照抄它的「做法」。**
//    那支綁死訂單領域(`AdminOrderFilter` / `OrderGoodsAxis` / `buildOrderListHref`),
//    抽共用元件要先長出一個通吃兩邊的參數形狀 —— 為了兩顆 chip 不值得(YAGNI)。
//    ⇒ 沿用的是三件:**`.fchip` 樣式類別**、**零 JS 的 `<Link>`**、**選中態靠網址不靠 state**。
//    ⚠️ 這句寫清楚是因為交辦寫的是「可重用 order-filter-chips.tsx」——
//       **我沒有真的 import 它**,不要讓下一個人以為兩邊已經共用了。
//
// 🔴 `page` 固定回 **1**:換篩選卻停在第 3 頁,常常直接看到空白頁
//    (同 `order-filter-chips.tsx` 的理由)。

type ChipSpec = {
  key: string;
  label: string;
  /** 這顆對應的 `listing_set_by` 值;`undefined` = 不篩(「全部」)。 */
  value: ProductSetByFilter | undefined;
};

/** 文案為 Sean 2026-08-15 拍板字面(「手動」/「自動」),**不得自行改寫**。 */
const CHIPS: readonly ChipSpec[] = [
  { key: 'all', label: '全部', value: undefined },
  { key: 'staff', label: '手動', value: 'staff' },
  { key: 'sync', label: '自動', value: 'sync' },
];

export function ProductFilterChips({ current }: { current: ProductSetByFilter | undefined }) {
  return (
    <div className='flex items-center gap-2'>
      {CHIPS.map((chip) => {
        const active = chip.value === current;
        return (
          <Link
            key={chip.key}
            className='fchip'
            aria-current={active ? 'true' : undefined}
            data-active={active ? 'true' : undefined}
            href={chip.value ? `/products?set_by=${chip.value}&page=1` : '/products?page=1'}
          >
            {chip.label}
          </Link>
        );
      })}
    </div>
  );
}
