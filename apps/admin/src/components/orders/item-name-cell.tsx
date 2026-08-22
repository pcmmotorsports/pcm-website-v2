'use client';

import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

// item-name-cell.tsx — 品項名稱那一格。
//
// 🔴🔴 **2026-08-22 Sean 改了主意:品名【不再切字】,原地換行。**
//    他看了八張實體版本的圖之後挑「② 原地換行」(`~/pcm-mailbox/品名-②原地換行.png`)。
//    ~~2026-08-21 逐字拍板:「維持切字,我要用滑鼠 hover 過去後可以看到完整的字」~~
//    ⇒ **那道拍板的前提(字會被切掉)已經不成立了。** 原句保留,因為它解釋了 Tooltip 為什麼在這裡。
//
//    為什麼是 ②(四個版本的實量,全文見 `~/pcm-mailbox/E-024-品名四版本圖說-20260822.md`):
//    ```
//    品名軌 121px。而正式庫真的最長那兩個品名需要 441px 與 553px。
//    ① 品名獨佔一行(軌 522) ⇒ 441 進得去, 而 553 【仍然切】
//    ③ 料號改小字(軌 279)   ⇒ 兩個都切
//    ④ 面板加寬 825(軌 226) ⇒ 兩個都切, 而且左邊清單掉進卡片模式
//    ② 原地換行             ⇒ 🔴 【唯一】兩個都不丟字的
//    ```
//    代價 = 卡片變高(實量 77px → 最長那張 155px)。**那是 Sean 看著圖挑的,不是意外。**
//
// ⚠️ **Tooltip 現在是多餘的**(字全都看得見了, hover 顯示的是同一份字)。
//    刻意【沒有】順手拿掉:那是一個顯示行為的取捨, 而 Sean 昨天才為它拍過板 ⇒ 由他決定。
//    已列進交件單問他。**在他答之前不要自行移除。**
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
      {/* 🔴 `break-words` 而不是只拿掉 `truncate`:純拿掉的話, 一個【沒有空白的長字串】
          (例如 `Akrapovič` 那種洋名, 或料號那種連字號串)會撐破 121px 的軌而溢出到隔壁欄。
          `break-words` 只在【一個字自己就放不下】時才斷, 一般中文與英文詞不受影響。 */}
      <TooltipTrigger render={<div className='min-w-0 text-[13px] break-words' />}>
        {title}
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}
