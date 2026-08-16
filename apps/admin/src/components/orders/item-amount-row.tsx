'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { ItemAmountForm, type ItemAmountFormProps } from './item-amount-form';

// item-amount-row.tsx — 品項列 + 「改金額」展開列(M-4b E10 #13 片1c-2 版面片)。
//
// 🔴 **為什麼要這一支**:1c-2 第一版把表單塞進「單價」那格,而那格是
//    `text-right tabular-nums whitespace-nowrap`、實測寬 **155px**(主視窗 2026-08-16 量;
//    品項表是該頁第 [1] 張、6 欄、表寬 1150)。
//    表單裡有 label、輸入框、checkbox 與「我確認這個品項要改成 0 元」——
//    `nowrap` 會讓它一行到底,**要嘛擠爆別欄、要嘛整張表出現橫向捲軸**。
//
// 🔴🔴 **本檔是【唯一】的 client 島 —— `ItemsTable` 與 `order-detail.tsx` 仍是 server component。**
//    (`grep -c "use client" order-detail.tsx` ⇒ **0**,那個 0 要維持。)
//    ⚠️ 作法:**那六格的內容仍由 server 算好、當 `ReactNode` 傳進來**(`before` / `priceText` / `after`),
//    本檔只負責「**展開誰**」這個狀態與那一列的殼。
//    ⇒ 不要為了方便把 `ItemsTable` 標成 `'use client'` —— 那會把整張表(含金額格式化、三軸彙總)
//    整包送進 client bundle。
//
// 🔴 **收合時不多一列**:trigger 就放在單價格裡(一個小連結),
//    **展開才多出那一列** ⇒ 品項多的訂單不會平白變兩倍長。

/**
 * 🔴 **「只展開正在編輯的那一項」需要【共用】狀態**(codex 版面片 R1 must-fix 1)。
 *
 * 第一版每一列各自 `useState(open)` ⇒ **點 A 再點 B,兩列會同時展開** —— 不符合那條約束。
 * ⇒ 改成一個 client provider 握 `openId`,每一列讀它。
 * ⚠️ **provider 包住的 children 仍是 server 算好的** ⇒ `ItemsTable` 與 `order-detail.tsx`
 * **維持 server component**(那個 `grep -c "use client" ⇒ 0` 要保持)。
 */
const OpenRowContext = createContext<{
  openId: string | null;
  setOpenId: (id: string | null) => void;
} | null>(null);

export function ItemAmountRowGroup({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <OpenRowContext.Provider value={{ openId, setOpenId }}>{children}</OpenRowContext.Provider>
  );
}

export type ItemAmountRowProps = {
  /** 單價格之前的那幾格(品項 / SKU / 數量)—— server 算好傳進來 */
  before: ReactNode;
  /** 單價格要顯示的字(已格式化)—— server 算好傳進來 */
  priceText: ReactNode;
  /** 單價格之後的那幾格(小計 / 三軸)—— server 算好傳進來 */
  after: ReactNode;
  /** 展開列要跨幾欄(= 表格欄數) */
  colSpan: number;
  /** 單價格的 class(沿用表格既有的對齊與字體) */
  priceCellClassName: string;
  rowClassName: string;
} & ItemAmountFormProps;

export function ItemAmountRow({
  before,
  priceText,
  after,
  colSpan,
  priceCellClassName,
  rowClassName,
  blockedReason = null,
  ...formProps
}: ItemAmountRowProps) {
  const ctx = useContext(OpenRowContext);
  // 🔴 沒有 provider 就 fail-closed 成「永遠收合」——**不要退回各自為政的 local state**,
  //    那正是這條 must-fix 要修掉的行為。少包 provider 的症狀是「按了沒反應」,查得出來;
  //    退回 local state 的症狀是「兩列同時開」,而那**看起來像正常運作**。
  const open = ctx?.openId === formProps.orderItemId;

  return (
    <>
      <tr className={rowClassName}>
        {before}
        <td className={priceCellClassName}>
          <div>{priceText}</div>
          {/* 🔴 **不能改時也要看得見那顆入口的位置** —— 直接不畫會讓員工找不到而懷疑自己。 */}
          <button
            type='button'
            onClick={() => ctx?.setOpenId(open ? null : formProps.orderItemId)}
            className='mt-0.5 text-xs underline'
            aria-expanded={open}
          >
            {/* 🔴 **不能改時,入口的字要先講出來**(codex must-fix 2)。
                第一版註解寫「改成一個停用的按鈕」而 code **根本沒有 disabled** ——
                那是我自己的字面 vs 事實。
                ⚠️ 而**真的 disabled 也不對**:原因就寫在展開列裡,停用等於把原因鎖住看不到。
                ⇒ 折衷:**入口先說「無法改金額」,點開才看原因**。 */}
            {blockedReason ? (open ? '收起' : '無法改金額(看原因)') : open ? '收起' : '改金額'}
          </button>
        </td>
        {after}
      </tr>
      {open ? (
        <tr className={rowClassName}>
          {/* 🔴 展開列**跨滿整張表** ⇒ 表單有自己的橫向空間,
              確認句、原因欄、之後的錯誤提示都放得下,不必再為每個新欄位打一次版面仗。 */}
          <td colSpan={colSpan} className='bg-muted/30 px-3 py-2'>
            <ItemAmountForm {...formProps} blockedReason={blockedReason} />
          </td>
        </tr>
      ) : null}
    </>
  );
}
