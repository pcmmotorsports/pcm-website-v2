'use client';

import { useEffect, useRef, type ReactNode } from 'react';

// danger-zone-details.tsx — 片12:面板最底那兩顆鈕的殼(設計稿區塊⑥)。
//
// 設計稿(區塊⑥「取消 / 退款」):
//   [退款]                                           [申請取消整張單(紅)]
// 🔴 **權威換過一次,而換的理由不是新舊**(2026-08-19,W1):
//    ~~原本引的是 `~/pcm-mailbox/MAIN-057-…md`~~ —— 那是**別人整理過的二手落檔**,
//    它抄的是 Aug-13 稿,鈕上寫「退貨 / 退款」。
//    真權威 = **Aug-17 18:39「720 側邊欄確認稿」**(`<title>` 逐字),
//    `:429` 標題「取消 / 退款」、`:431` 鈕「線上退款(TapPay)」、`:432` 逐字
//    「退貨 —— 整條功能後台沒有…不會叫你去走」⇒ **退貨線在本 repo 零落點,鈕上不得寫它。**
//    路徑與逐條理由見 `order-detail.tsx` 那段「危險操作沉底」註解。
// ⇒ 面板最底**只看得到兩顆鈕**,底下那三大塊(複核 / 退款帳本 / 退款入口)收起來。
//
// 🔴🔴 **為什麼要這一支 client 元件,而不是一個純 `<details>`**
//    —— 這一格是**量出來的**,不是為了保險:
//    列表那一欄有兩條 `#cancel` 深連結(`orders-table.tsx` 的兩個 `<Link>`),
//    而錨點 `id='cancel'` 住在 `OrderCancelBlock` 裡面 ⇒ 收進 `<details>` 之後,
//    「連過去卻是收起來的」= 員工看到一片空白,而**沒有任何測試會紅**
//    (`order-cancel-block.test.tsx` 檔頭自陳:jsdom 不做捲動,它守的是錨點存在、不是看得到)。
//
//    **量到的**(2026-08-19 W1,真瀏覽器 Playwright、雙向表演過):
//    ```
//    Chrome 151，靜態 HTML，錨點放在 <details> 裡面
//      帶 #cancel 進來  ⇒ details.open = true 、錨點高度 80 、scrollY 1231
//      不帶 fragment    ⇒ details.open = false、錨點高度  0 、scrollY    0   ← 負對照
//    ⇒ 瀏覽器【整頁載入】時會自己展開 details。
//    ```
//    ⚠️ **而射程到此為止,不放寬**:那兩條連結是 Next `<Link>`(**client-side 導航**),
//       **不是**整頁載入 ⇒ 上面那一發**證不到它**。Next router 自己處理 hash 捲動,
//       它會不會觸發瀏覽器那個自動展開 —— **未量**。
//    ⇒ 所以這裡**不靠**那個行為:掛載時與 `hashchange` 時自己讀 hash,命中就打開。
//      兩條路都蓋到,而且不必先知道 Next 的內部行為。

export function DangerZoneDetails({
  summary,
  anchorId,
  defaultOpen = false,
  className,
  children,
}: {
  /** 摘要列要顯示的那顆鈕。 */
  summary: ReactNode;
  /** 這一塊內含的錨點 id;網址 hash 命中它就自動展開。省略 = 不參與 hash。 */
  anchorId?: string;
  /**
   * 一進來就展開。
   * 🔴 用途**不是**「這塊比較重要」,而是「**收起來會藏住一個警告**」——
   *    呼叫端目前唯一的用法是對帳異常態(見 `order-detail.tsx` 那段)。
   */
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!anchorId) return;
    const openIfTargeted = () => {
      // 🔴 只**打開**、不關閉 —— 使用者自己展開的那一塊不該因為 hash 變了就被收起來。
      if (window.location.hash === `#${anchorId}` && ref.current) ref.current.open = true;
    };
    openIfTargeted();
    window.addEventListener('hashchange', openIfTargeted);
    return () => window.removeEventListener('hashchange', openIfTargeted);
  }, [anchorId]);

  return (
    <details ref={ref} className={className} open={defaultOpen || undefined}>
      <summary className='cursor-pointer list-none select-none'>{summary}</summary>
      <div className='mt-3 space-y-4'>{children}</div>
    </details>
  );
}
