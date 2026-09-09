// shipment-card-actions.tsx — 包裹卡那一排動作的版面(2026-09-09,Sean 看截圖說「版面好複雜」)。
//
// 🔵 **比稿已結束:Sean 挑【摺疊版】。** 分層版與 `?shipui=` 那個切換開關已於本片刪除
//    (它們在 `1f6de948a` 的歷史裡,要看形狀去那顆)。
//    ⇒ 📌 **這支現在只做一件事**,沒有分岔、沒有讀網址、不是 client component。
//
// 🔴 **一個按鈕的行為都沒動** —— 本檔只收 `ReactNode` 再排位置。
//    作廢還是作廢、送新竹還是送新竹,判準全留在原本那幾支元件裡。
//    ⇒ 這是 Sean 拍的射程(他要的是「更容易辨識」,不是改功能)。
//
// 🔵 **稿的位置**(鐵則 1,查過再寫):OD `pcm-524f` 的 `HANDOFF-orders-ui.md`
//    **沒有畫過這一格的動作排法** —— 它自己 `:3951` 逐字說出貨卡是「快照裡有的東西我全都保住了」,
//    列的是 `復原作廢 / 作廢這一箱 / 列印出貨明細單` 等**既有元素**,不是一份新版面;
//    而「送新竹」是 2026-09-05 才有的鈕,那份稿裡不存在。
//    ⇒ **稿沒有答案 ⇒ 才輪到這裡排。** 而顏色照它 `:301` 的拍板走:
//      「藍是唯一互動色,紅只留給破壞性動作與未付款」⇒ **作廢維持紅**,本片不改顏色,只改位置與權重。

import type { ReactNode } from 'react';

export type ShipmentCardActionsProps = {
  /** 這一箱現在最可能要做的那一件(今天 = 送新竹)。沒有就給 `null`。 */
  primary: ReactNode;
  /** 日常動作:列印出貨明細單 / 列印託運標籤 / 更正單號 / 標記出貨。 */
  secondary: ReactNode;
  /** 🔴 破壞性動作,只有作廢。**收起來不等於拿掉** —— 展開一下就摸得到。 */
  danger: ReactNode;
  /** 「送出結果未知」那一類的警示。它不是動作,永遠貼著卡片頂端、不收進摺疊裡。 */
  notice: ReactNode;
};

/**
 * **摺疊**:預設只露警示 + 主要動作,其餘收進「其他操作」。
 *
 * 🔴 解的是 Sean 看截圖講的那三件:
 *   ① 四顆鈕平排、權重一樣 ⇒ 最危險的(作廢)與最常按的長得一樣重
 *   ② 說明擠在鈕底下、斷行卡住(那一格在 `shipment-hct-submit-button.tsx` 修的)
 *   ③ 一格裡同時裝狀態／四個動作／品項／單號,沒有分層
 *
 * ⚠️ **代價照實寫,他是知道這一條才選的**:員工要列印或作廢時**多按一下**。
 *    常按列印的人會覺得變慢。
 *
 * 🛑 **`<details>` 不是權限,也不是守門** —— 收起來的東西**仍然在 DOM 裡**,
 *    鍵盤與螢幕閱讀器都到得了,網址／書籤那幾條路更是完全繞過它。
 *    ⇒ 真正擋作廢的是 `ShipmentVoidButton` 自己與它底下那支 RPC,不是這一層。
 *
 * 🔵 `notice` **刻意留在摺疊外面**:它講的是「這一箱送出結果未知」——
 *    那是一件**要員工立刻看到**的事,收起來等於把警示藏起來。
 */
export function ShipmentCardActions({
  primary,
  secondary,
  danger,
  notice,
}: ShipmentCardActionsProps) {
  return (
    <div className='flex flex-col gap-2 px-3 py-2'>
      {notice}
      {primary === null ? null : <div>{primary}</div>}
      <details>
        <summary className='text-muted-foreground hover:text-foreground w-fit cursor-pointer text-xs'>
          其他操作
        </summary>
        <div className='mt-2 flex flex-col gap-2'>
          <div className='flex flex-wrap items-center gap-2'>{secondary}</div>
          {/* 🔴 分隔線 + 靠右 = 「這一格與上面不是同一類」。展開之後作廢仍然離日常動作最遠。 */}
          <div className='flex justify-end border-t pt-2'>{danger}</div>
        </div>
      </details>
    </div>
  );
}
