'use client';

import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

// item-name-cell.tsx — 品項名稱那一格的 hover 完整字(Sean 2026-08-21 逐字拍板:
// 「維持切字,我要用滑鼠 hover 過去後可以看到完整的字」)。
//
// 🔴 為什麼不是繼續用原生 `title`(這格原本的做法):
//    title tooltip 由 OS/瀏覽器 chrome 畫,**不進頁面的 paint tree** ⇒ 截圖與 DOM
//    都抓不到(W4 2026-08-21 用真瀏覽器量過;本片動手前用 Playwright 對同款
//    truncate+title 結構重複驗證過一次:hover 2 秒後截圖,畫面上什麼都沒有——
//    不是它沒用,是我們的工具鏈結構上看不到它)。
//    ⇒ 這代表【零守門可能】:title 被拿掉,沒有任何測試會紅、畫面上也看不出差別。
//    改用 app 內既有的 Tooltip 元件(`../ui/tooltip.tsx`,base-ui,`ui/sidebar.tsx`
//    已在用同一支)——內容真的進 DOM,可測、可截圖,才寫得出雙向表演的守門。
//
// 🔴🔴 本檔是**第二個** client 島(第一個是 `item-amount-row.tsx`)——base-ui Tooltip
//    需要 hover 狀態與 portal,`order-detail-items-table.tsx` 本身維持 server component。
//
// 🔴 codex 對抗審查 M1(2026-08-21 折入,W4 審):**這個限定沒有消失,舊實作有的限制
//    新實作繼承了一部分**——刪掉舊 `title=` 那兩行時,描述限制的註解也一起被刪掉、沒補回。
//    ⚠️ 兩件事分開講,因為一個是量到的、一個是推的:
//      ①**鍵盤打不開**(W4 實測):trigger 沒有 `tabIndex`(值為 -1,即不在 tab 序列)、
//        `focus()` 之後它不是 `activeElement`,focus 前後 tooltip 內容數皆 0——
//        跟原生 `title` 一樣,滑鼠是唯一的觸發方式。
//      ②**觸控裝置**(W4 推的,沒有在真觸控裝置上測過):hover 觸發的機制通常在觸控上
//        不會開啟,跟原生 `title` 同款限制大機率延續,但這一句是推論不是實測,標成未確認。
//    Sean 08 月初「A2:員工用電腦」拍板是這格能被接受的前提;若日後要支援平板/觸控,
//    這一格要重做(鍵盤那半有實測支持,觸控那半還沒有)。
export function ItemNameCell({ title }: { title: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<div className='min-w-0 truncate text-[13px]' />}>
        {title}
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}
