import Link from 'next/link';
import type { ProductSetByFilter } from '../../lib/products/product-repository';
import {
  buildProductListHrefResetPage,
  DEFAULT_PAGE_SIZE,
  filterHiddenFields,
  PRODUCT_ATTENTION_KEYS,
  PRODUCT_ATTENTION_LABEL,
  PRODUCT_SORT_KEYS,
  PRODUCT_SORT_LABEL,
  SIZE_PARAM,
  SORT_PARAM,
  type AdminProductFilter,
  type ProductAttention,
} from '../../lib/products/product-list-view';
import { AutoApplySubmit } from '../shared/auto-apply-submit';

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

export function ProductFilterChips({
  filter,
  size,
}: {
  filter: AdminProductFilter;
  /** 目前的每頁筆數 —— 🔴 **必須帶著走**:按 chip 不該把員工選的「每頁 500」洗回預設。 */
  size: number;
}) {
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
            href={buildProductListHrefResetPage({ ...filter, setBy: chip.value }, size)}
          >
            {chip.label}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * 商品頁乙 A2:「要處理」五顆(Sean 2026-09-28 Q2 甲),可複選、每顆帶件數。
 * 按一下 = 加進或拿掉這個條件;幾顆之間是「或」。件數讀不到(`null`)就只顯示名稱。
 */
export function ProductAttentionChips({
  filter,
  size,
  counts,
}: {
  filter: AdminProductFilter;
  size: number;
  counts: Readonly<Record<ProductAttention, number | null>> | null;
}) {
  const selected = new Set(filter.attention ?? []);
  const toggle = (key: ProductAttention): AdminProductFilter => {
    const next = PRODUCT_ATTENTION_KEYS.filter((k) => (k === key ? !selected.has(k) : selected.has(k)));
    return { ...filter, attention: next.length > 0 ? next : undefined };
  };
  return (
    <div className='flex flex-col items-start gap-1.5' data-product-attention>
      <span className='text-muted-foreground text-xs font-medium'>要處理</span>
      {PRODUCT_ATTENTION_KEYS.map((key) => {
        const active = selected.has(key);
        const count = counts?.[key];
        return (
          <Link
            key={key}
            className='fchip'
            aria-current={active ? 'true' : undefined}
            data-active={active ? 'true' : undefined}
            data-attention={key}
            href={buildProductListHrefResetPage(toggle(key), size)}
          >
            {PRODUCT_ATTENTION_LABEL[key]}
            {count !== null && count !== undefined && ` ${count.toLocaleString('zh-TW')}`}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * 商品頁乙 A5:排序。一般 GET 表單 + 下拉,選了就送出(AutoApplySubmit;沒有 JS 時按「套用排序」)。
 * 其他篩選與每頁筆數以 hidden 欄位帶著走,換排序回到第 1 頁。
 */
export function ProductSortSelect({ filter, size }: { filter: AdminProductFilter; size: number }) {
  const hidden = Object.entries(filterHiddenFields({ ...filter, sort: undefined }));
  return (
    <form method='get' action='/products' className='flex items-center gap-1.5' data-product-sort>
      {hidden.map(([name, value]) => value !== undefined && <input key={name} type='hidden' name={name} value={value} />)}
      {size !== DEFAULT_PAGE_SIZE && <input type='hidden' name={SIZE_PARAM} value={String(size)} />}
      <label htmlFor='product-sort' className='text-muted-foreground text-xs'>
        排序
      </label>
      <select
        id='product-sort'
        name={SORT_PARAM}
        defaultValue={filter.sort ?? ''}
        className='border-input bg-background h-8 rounded-md border px-2 text-sm'
      >
        <option value=''>{PRODUCT_SORT_LABEL.default}</option>
        {PRODUCT_SORT_KEYS.map((k) => (
          <option key={k} value={k}>
            {PRODUCT_SORT_LABEL[k]}
          </option>
        ))}
      </select>
      <AutoApplySubmit label='套用排序' className='border-input hover:bg-accent h-8 rounded-md border px-2 text-sm' />
    </form>
  );
}
