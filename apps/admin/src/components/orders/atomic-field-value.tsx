'use client';

import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

// atomic-field-value.tsx — 摘要卡裡「**不可以被斷開**」那一類值的顯示殼。
//
// 🔴 它解的是一個【正確性】缺陷,不是版面品味(2026-08-21,W2 真瀏覽器量到):
//    下排三欄在 720 面板下每欄內寬只有 167.7px,而值那一格原本掛 `break-all`
//    (`word-break: break-all` = **允許在任何字元中間斷**)⇒ 實測斷出這種東西:
//      `probe@example.c` / `om`      ← email 斷在單字中間,抄下來寄信是錯的
//      `2026-08-19 0`  / `3:56`      ← 🔴 時間戳斷在數字中間
//    ⇒ 🔴 **「2026-08-19 0」自己是一個看起來合法的值** —— 員工不會覺得畫面壞了,
//      他會以為那就是值。**壞掉的那次和對的那次長得一樣。**
//
// 🔴 為什麼不是改成 `break-words`(量過才排除的,不是憑感覺):
//    `overflow-wrap: break-word` 只在「整個 token 放不下」時才斷 ⇒ email 那格改善了,
//    **而它改成溢出**:實測值的右緣超出所在列 **27.1px** ⇒ 只是把「斷錯地方」換成「跑出格子」。
//    ⇒ 兩個都不行 ⇒ 這一類值改走 **不換行 + 截斷 + tooltip**(實測:斷在 token 中間 = 0、零溢出)。
//
// 🔴 **只給「原子值」用,不要全面套用**:
//    · 用它 ⇒ email / 電話 / 時間戳 / 發票號碼 / 載具 / 金額(斷開會產生一個「讀得通而錯」的值)
//    · **不要用它** ⇒ 出貨狀態那種**本來就帶換行**的多行值(套上去會把換行吃掉)、
//      以及人名/狀態標籤這種斷開也不會被讀錯的。
//
// ⚠️ **繼承自 `item-name-cell.tsx` 的已知限制(同一顆 Tooltip 元件,限制跟著搬)**:
//    · **鍵盤打不開**(實測):trigger 不在 tab 序列、focus 後不是 activeElement。
//    · **觸控裝置**(推的,沒在真觸控裝置上測過):hover 機制在觸控上大機率不開啟。
//    ⇒ Sean 08 月初「A2:員工用電腦」拍板是這格成立的前提。
//    🔴 ⇒ **被截斷的值,滑鼠以外的方式讀不到全文。** 這是本修法的代價,寫在這裡不藏。
export function AtomicFieldValue({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className='min-w-0 truncate text-right whitespace-nowrap' />}
      >
        {text}
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}
