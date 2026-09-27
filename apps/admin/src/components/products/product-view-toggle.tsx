'use client';

// product-view-toggle.tsx —— 商品列表「清單 / 卡片」切換(商品頁乙 E1)。
// 選擇存在 cookie(不放網址):換篩選、翻頁的連結只帶篩選與每頁筆數, 放網址的話每換一次篩選就會跳回清單。
// cookie 只是這台瀏覽器的顯示偏好, 不影響資料;伺服器讀到認不得的值就當清單。

import { useRouter } from 'next/navigation';
import { PRODUCTS_VIEW_COOKIE, type ProductsViewMode } from '../../lib/products/product-view-mode';

const BTN = 'h-8 px-3 text-sm first:rounded-l-md last:rounded-r-md border-input border aria-pressed:bg-primary aria-pressed:text-primary-foreground';

export function ProductViewToggle({ mode }: { mode: ProductsViewMode }) {
  const router = useRouter();
  const pick = (next: ProductsViewMode) => {
    if (next === mode) return;
    document.cookie = `${PRODUCTS_VIEW_COOKIE}=${next}; path=/products; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  return (
    <div data-view-toggle role='group' aria-label='商品顯示方式' className='inline-flex'>
      <button type='button' aria-pressed={mode === 'table'} onClick={() => pick('table')} className={BTN}>
        清單
      </button>
      <button type='button' aria-pressed={mode === 'cards'} onClick={() => pick('cards')} className={BTN}>
        卡片
      </button>
    </div>
  );
}
