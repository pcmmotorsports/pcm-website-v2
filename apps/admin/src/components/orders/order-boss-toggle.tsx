import Link from 'next/link';

// order-boss-toggle.tsx — 「老闆:成本」勾(A1, 2026-09-14)。
//
// 稿 v22(OD pcm-524f `orders-admin-v22-A-出貨彈窗收斂.html:101` `label.boss`,`tool-final-css.py` 抽):
//   inline-flex / gap 6 / 12px / 字 `--new-ink` #4c1d95 / 底 `--new-bg` #efe9fb / 圓角 9999 / padding 3×10。
//   稿裡是 `<input type=checkbox id=boss>` 勾了 `body.boss`(純 client 切 class)。
// 🔴 我方是 **URL 顯示軸**(`?boss=1`, `order-list-view.ts` `ORDER_BOSS_PARAM`)⇒ 這顆是一條連結, 不是 client 勾:
//    server 決定畫哪幾欄(成本資料只在 manager 的請求裡查、只進 manager 的 HTML),
//    勾選框只是視覺(`readOnly` + `tabIndex=-1`, 整顆連結才是控件, `role='switch'` + `aria-checked` 講狀態)。
// 🔴 **只有 `isActiveManager` 為真的請求會 render 它**(頁層閘, plan §1-d);本檔不做權限判斷 —— 它拿不到 actor。
// 📌 位置:B 窗 v22 工具列 `label.boss` 留在 ＋ 新增 左邊;那份工具列還沒進這棵樹, 本片先放在匯出鈕那一列,
//    合體後搬進工具列 = 換一個 import 位置, 本檔不動。

export function OrderBossToggle({ on, href }: { on: boolean; href: string }) {
  return (
    <Link
      href={href}
      role='switch'
      aria-checked={on}
      data-testid='order-boss-toggle'
      className='inline-flex items-center gap-[6px] rounded-full bg-(--boss-bg) px-[10px] py-[3px] text-[12px] leading-[1.4] text-(--boss-ink)'
    >
      <input type='checkbox' checked={on} readOnly tabIndex={-1} aria-hidden='true' className='pointer-events-none' />
      老闆:成本
    </Link>
  );
}
