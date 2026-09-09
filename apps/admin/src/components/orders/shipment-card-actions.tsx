'use client';

// shipment-card-actions.tsx — 包裹卡那一排動作的**版面**(2026-09-09,Sean 看截圖說「版面好複雜」)。
//
// 🔴🔴 **這支是【品味題的兩個實體版本】,不是一個做完的決定。**
//    Sean 的規矩是「給他實體版本看,不要用文字讓他想像」⇒ 兩版都做在真的畫面上,
//    他挑完之後 **輸的那一版連同這支的分岔一起刪掉**,只留贏的那個排法。
//    ⇒ 📌 所以這裡刻意**沒有**做成可設定的通用元件:它是一次性的比稿架子。
//
// 🔴 **一個按鈕的行為都沒動** —— 本檔只收 `ReactNode` 再排位置。
//    作廢還是作廢、送新竹還是送新竹,判準全留在原本那幾支元件裡。
//    ⇒ 這是 Sean 拍的射程(他要的是「更容易辨識」,不是改功能)。
//
// 🔴 **切換靠網址 `?shipui=`,不靠 env、不靠 prop 鏈** ——
//    ⇒ 同一台鑽機、同一張單,改網址就換版,他可以左右分頁對著看。
//    ⚠️ 而這是**刻意的拋棄式接法**:走 prop 鏈要動 `order-detail.tsx` 與 `ShipmentSection` 兩層,
//       而那兩層在他挑完之後還要再改回來 —— **兩次改動去換一次比稿,不划算。**
//    🔵 `useSearchParams()` 在這裡安全:訂單頁是 `ƒ (Dynamic)`(build 輸出逐字),不是靜態預算頁。
//
// 🔵 **稿的位置**(鐵則 1,查過再寫):OD `pcm-524f` 的 `HANDOFF-orders-ui.md`
//    **沒有畫過這一格的動作排法** —— 它自己 `:3951` 逐字說出貨卡是「快照裡有的東西我全都保住了」,
//    列的是 `復原作廢 / 作廢這一箱 / 列印出貨明細單` 等**既有元素**,不是一份新版面;
//    而「送新竹」是 2026-09-05 才有的鈕,那份稿裡不存在。
//    ⇒ **稿沒有答案 ⇒ 才輪到這裡排。** 而顏色照它 `:301` 的拍板走:
//      「藍是唯一互動色,紅只留給破壞性動作與未付款」⇒ **作廢維持紅**,本片不改顏色,只改位置與權重。

import type { ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

export type ShipmentCardActionsProps = {
  /** 這一箱現在最可能要做的那一件(今天 = 送新竹)。沒有就給 `null`。 */
  primary: ReactNode;
  /** 日常動作:列印出貨明細單 / 列印託運標籤 / 更正單號 / 標記出貨。 */
  secondary: ReactNode;
  /** 🔴 破壞性動作,只有作廢。**永遠不會被藏到看不到**,兩版都摸得到。 */
  danger: ReactNode;
  /** 「送出結果未知」那一類的警示。它不是動作,兩版都貼著卡片頂端。 */
  notice: ReactNode;
};

/**
 * 版一 · **分層** —— 主要動作自成一列,日常動作縮成一排,破壞性動作用一條分隔線隔到最下面。
 *
 * 🔴 解的是「四顆鈕平排、權重一樣」:掃視時最危險的那顆與最常按的那顆長得一樣重。
 * 🔵 作廢**沒有被縮小也沒有被藏**,只是不再與日常動作並排 —— 縮小它會變成另一種病
 *    (誤按率下降,但「我找不到作廢在哪」上升,而後者員工會來問人)。
 */
function LayeredActions({ primary, secondary, danger, notice }: ShipmentCardActionsProps) {
  return (
    <div className='flex flex-col gap-2 px-3 py-2'>
      {notice}
      {primary === null ? null : <div>{primary}</div>}
      <div className='flex flex-wrap items-center gap-2'>{secondary}</div>
      {/* 🔴 分隔線 + 靠右 = 「這一格與上面不是同一類」。留 `pt-2` 讓它不貼著上一排。 */}
      <div className='flex justify-end border-t pt-2'>{danger}</div>
    </div>
  );
}

/**
 * 版二 · **摺疊** —— 預設只露主要動作,其餘收進「其他操作」。
 *
 * 🔴 解的是「一格裡塞了狀態 / 四個動作 / 品項 / 單號,沒有分層」:把動作那一團縮成一行。
 * ⚠️ **代價照實寫**:員工要列印或作廢時**多按一下**。常按列印的人會覺得變慢 ——
 *    這正是要 Sean 用眼睛決定的那一半,不是我能替他算的。
 * 🛑 `<details>` 不是權限:收起來的東西**仍然在 DOM 裡**、鍵盤與螢幕閱讀器都到得了。
 */
function FoldedActions({ primary, secondary, danger, notice }: ShipmentCardActionsProps) {
  return (
    <div className='flex flex-col gap-2 px-3 py-2'>
      {notice}
      {primary === null ? null : <div>{primary}</div>}
      <details className='group'>
        <summary className='text-muted-foreground hover:text-foreground w-fit cursor-pointer text-xs'>
          其他操作
        </summary>
        <div className='mt-2 flex flex-col gap-2'>
          <div className='flex flex-wrap items-center gap-2'>{secondary}</div>
          <div className='flex justify-end border-t pt-2'>{danger}</div>
        </div>
      </details>
    </div>
  );
}

/**
 * 🔵 **預設走版一** —— 沒帶 `?shipui=` 的人(包含所有既有連結)看到的是分層版。
 *    ⚠️ 那是一個選擇,不是中立:比稿期間**大多數人只會看到版一**。
 *    ⇒ 要他真的比較,兩個網址都要給他,別只丟一個。
 */
export function ShipmentCardActions(props: ShipmentCardActionsProps) {
  // 🔴 **`?.` 不是防禦性裝飾** —— `useSearchParams()` 在沒有 router context 的地方**真的回 null**
  //    (元件測試逐字撞到:`TypeError: Cannot read properties of null (reading 'get')`,19 格紅)。
  //    ⇒ 沒有網址可讀時退回版一,而**那與「他沒帶 shipui」是同一個結果** —— 不會有人看到半個畫面。
  const variant = useSearchParams()?.get('shipui');
  return variant === '2' ? <FoldedActions {...props} /> : <LayeredActions {...props} />;
}
