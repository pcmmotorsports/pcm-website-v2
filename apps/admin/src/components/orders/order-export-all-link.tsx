import { ORDER_EXPORT_ALL_CAP } from '../../lib/orders/order-export-all';

// order-export-all-link.tsx — 「匯出篩選結果」(M-4a-24 第一片)。
// 🔴 文字不用「全部」:工具列不得出現這兩個字(Sean 2026-09-16 拍甲, 他讀錯過;page.test.tsx 守)。
// 是一般連結不是按鈕:檔案由 `/orders/export` 在 server 端組, 瀏覽器不持有訂單資料;
// 讀不完整等情況那支會回一句純文字, 員工點下去看得到為什麼沒有檔。

export function OrderExportAllLink({ href, total }: { href: string; total: number }) {
  if (total > ORDER_EXPORT_ALL_CAP) {
    return (
      <span className='text-muted-foreground max-w-md text-xs' data-export-all-blocked>
        {`篩選結果共 ${total} 張單,超過一次匯出的上限 ${ORDER_EXPORT_ALL_CAP} 張,請縮小日期範圍後再匯出。`}
      </span>
    );
  }
  return (
    <a href={href} data-export-all className='inline-flex h-8 items-center rounded-md border px-3 text-sm'>
      {`匯出篩選結果(${total} 張單)`}
    </a>
  );
}
