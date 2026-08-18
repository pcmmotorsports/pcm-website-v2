import Link from 'next/link';
import type { ProductSetByFilter } from '../../lib/products/product-repository';
import {
  buildProductListHrefResetPage,
  type AdminProductFilter,
} from '../../lib/products/product-list-view';

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

export function ProductFilterChips({ filter }: { filter: AdminProductFilter }) {
  return (
    <div className='flex items-center gap-2'>
      {CHIPS.map((chip) => {
        const active = chip.value === filter.setBy;
        return (
          <Link
            key={chip.key}
            className='fchip'
            aria-current={active ? 'true' : undefined}
            data-active={active ? 'true' : undefined}
            /* 🔴 `#661`:網址一律由 `buildProductListHrefResetPage` 組,**不在這裡拼字串**。
               改的理由:原本這裡自己拼、而分頁那邊也自己拼,兩邊各拼各的 ⇒
               分頁那份漏了 `set_by`(`app/products/page.tsx:106` 舊字面),
               員工按「手動」再按「下一頁」就回到全部商品。
               ⇒ 現在**搜尋詞 `q` 也會被帶著走** —— 按 chip 不會把搜尋洗掉。 */
            href={buildProductListHrefResetPage({ ...filter, setBy: chip.value })}
          >
            {chip.label}
          </Link>
        );
      })}
    </div>
  );
}
