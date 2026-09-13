'use client';

// shipping-selection.tsx — 訂單總覽「勾品項 → 批次列」的 client island(B9,2026-09-14;稿 v22 `#batch`)。
//
// 🏁 **B9 起勾的是【品項】不是訂單**(稿 `inv-draft-批次列.png`:每一列一個框,「已勾 N 樣 · 來自 M 張單」)。
//    2b-1 那版是「一訂單一框、同客人可跨單裝一箱」;稿把出貨改成**限同一張單**(生成器 `countSel`:
//    `sh.disabled=m>1; title='出貨要同一張單;跨單不能一起裝箱'`)⇒ 同客人閘整段拆掉(它唯一的理由是跨單裝箱)。
//    📌 同一位客人兩張單裝一箱**還做得到**:一次勾一張單出貨、第二張出貨時「更多」列裡挑既有的箱(B13-b)。
//
// 🔴🔴 **這是 `orders-table.tsx` 這條線上唯一的 client 邊界,而且刻意做成 island。**
//    那支表原本明文宣告「零 client 邊界」(它自己的檔頭註解),理由是鐵則 12:
//    金額 + 會員等級同列 = 經銷價脈絡,**敏感值不序列化進 client bundle**。
//    ⇒ 本檔的存在不能破壞那個理由,所以:
//
//    **本檔的元件只收純量 `orderId` / `itemId`,絕不收 `AdminOrderSummary` / `AdminOrderLine`。**
//
//    整包 summary 帶著 `total`(金額)與 `tierAtCheckout`(會員等級)——
//    把它當 prop 傳進 client 元件 = 那兩個值會被序列化進 RSC payload、進 client bundle,
//    也就是把鐵則 12 的護欄從「server-only」降級成「反正使用者看不到」。
//    ⚠️ **看不到 ≠ 沒送出去**:RSC payload 在瀏覽器的 network 面板裡是純文字。
//    這條由 `shipping-selection.test.tsx` 的守門釘住(突變「把整包 summary 傳進來」要紅),
//    不是只寫在這段註解裡。
//
// 🔴 **三顆動作 = 開既有 `?next=&do=` 彈窗的多單版,零新寫入路**:批次列只組網址(`<a href>`),
//    彈窗是 server 端依網址渲染的同一份表單(`page.tsx` 的 `nextStepUi`),一單一份、逐列。
//    貼這條網址不會寫進任何東西(`order-return-to.ts:64` 那條紅線)。
// 🔴 **沒有全選框**:稿上沒有;勾一頁 20 張單 × 品項開一個 60 份表單的彈窗沒有意義。
// 🔵 「改成本(勾選的列)」只在老闆模式(`?boss=1` + manager)出現 —— 本檔只認 `costItemsParam` 有沒有給;
//    給了才渲染。判身分與那顆參數名歸 A1/A2(設計窗),本檔不判。

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  NEXT_MULTI_MAX,
  ORDER_NEXT_DO_PARAM,
  ORDER_NEXT_ITEMS_PARAM,
  ORDER_NEXT_PARAM,
  type NextStepDo,
} from '../../lib/orders/order-return-to';

export type PickedItem = { orderId: string; itemId: string };

type SelectionApi = {
  /** 已勾的品項(勾的順序)。 */
  picked: readonly PickedItem[];
  /** 已勾品項所屬的訂單(去重、依第一次勾到的順序)。 */
  orderIds: readonly string[];
  toggle: (orderId: string, itemId: string) => void;
  clear: () => void;
  isSelected: (itemId: string) => boolean;
};

const Ctx = createContext<SelectionApi | null>(null);

/** 勾選的狀態轉移(純函式,export 給測試直接打)。同一顆再按 = 取消。 */
export function nextSelection(prev: readonly PickedItem[], orderId: string, itemId: string): readonly PickedItem[] {
  return prev.some((p) => p.itemId === itemId) ? prev.filter((p) => p.itemId !== itemId) : [...prev, { orderId, itemId }];
}

export function distinctOrderIds(picked: readonly PickedItem[]): string[] {
  return [...new Set(picked.map((p) => p.orderId))];
}

export function ShippingSelectionProvider({ children }: { children: ReactNode }) {
  const [picked, setPicked] = useState<readonly PickedItem[]>([]);
  const toggle = useCallback((orderId: string, itemId: string) => {
    setPicked((prev) => nextSelection(prev, orderId, itemId));
  }, []);
  const clear = useCallback(() => setPicked([]), []);
  const api = useMemo<SelectionApi>(
    () => ({
      picked,
      orderIds: distinctOrderIds(picked),
      toggle,
      clear,
      isSelected: (itemId: string) => picked.some((p) => p.itemId === itemId),
    }),
    [picked, toggle, clear],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

function useSelection(): SelectionApi {
  const v = useContext(Ctx);
  if (v === null) {
    // 🔴 明確炸掉、不靜默降級:少掛 provider 時勾選會整組失效,
    //    而「勾不動」看起來跟「這張單不能勾」一模一樣 ⇒ 沒有人會發現。
    throw new Error('ShippingSelection:元件必須包在 <ShippingSelectionProvider> 內');
  }
  return v;
}

/**
 * 一列品項的勾選框(每一列一個,稿 `td.ck > input.ick`)。
 * 🔴 props **只有兩個純量**,見檔頭紅線。要顯示的東西(單號/金額/品名)一律留在 server 端。
 */
export function OrderItemCheckbox({ orderId, itemId }: { orderId: string; itemId: string }) {
  const s = useSelection();
  return (
    <input
      type='checkbox'
      className='size-4 cursor-pointer'
      checked={s.isSelected(itemId)}
      onChange={() => s.toggle(orderId, itemId)}
      aria-label='勾選這一樣(一起下訂 / 到貨 / 出貨)'
    />
  );
}

/** 稿 `.bar .btn`:白底、深字、28 高、12px。disabled 淡 40%。 */
const BTN =
  'inline-flex min-h-7 items-center rounded-lg border border-white bg-white px-2 text-[12px] leading-[1.4] text-[#14171c] disabled:cursor-not-allowed disabled:opacity-40';

/**
 * 勾了才浮出的批次列(稿 `#batch`:底 `#14171c` 白字、固定在下方置中)。沒勾任何東西時整條不渲染。
 *
 * @param nextBase 列表自己的網址(帶當下篩選 / 頁碼 / open,**不帶** next / do / items);由 page 算好傳進來。
 * @param costItemsParam 老闆模式才給:給了就多一顆「改成本(勾選的列)」,連到 `nextBase?<costItemsParam>=<品項 id,…>`。
 */
export function BatchActionBar({ nextBase, costItemsParam }: { nextBase: string; costItemsParam?: string }) {
  const s = useSelection();
  if (s.picked.length === 0) return null;

  const n = s.picked.length;
  const m = s.orderIds.length;
  const sep = nextBase.includes('?') ? '&' : '?';
  const itemIds = s.picked.map((p) => p.itemId).join(',');
  const href = (action: NextStepDo) =>
    `${nextBase}${sep}${ORDER_NEXT_PARAM}=${s.orderIds.join(',')}&${ORDER_NEXT_DO_PARAM}=${action}&${ORDER_NEXT_ITEMS_PARAM}=${itemIds}`;
  // 🔴 稿:出貨限同一張單(跨單 disabled + 滑到說明)。多單版彈窗有上限(網址長度 / 一次開幾十份表單沒意義)。
  const tooMany = m > NEXT_MULTI_MAX;
  const shipTitle = m > 1 ? '出貨要同一張單;跨單不能一起裝箱' : undefined;

  return (
    <div
      role='region'
      aria-label='批次動作'
      data-testid='batch-bar'
      className='fixed bottom-[18px] left-1/2 z-40 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2.5 rounded-[10px] bg-[#14171c] px-3.5 py-[9px] text-[13px] leading-[1.4] text-white shadow-[0_10px_30px_rgba(16,24,40,.3)]'
    >
      <span>
        已勾 <b>{n}</b> 樣
        <span className='ml-0.5 text-[12px] opacity-75'>{m > 1 ? ` · 來自 ${m} 張單` : ' · 同一張單'}</span>
      </span>
      {tooMany ? (
        <span className='text-[12px] opacity-75'>一次最多 {NEXT_MULTI_MAX} 張單,先做一部分</span>
      ) : (
        <>
          <a className={BTN} href={href('order')}>
            一起跟供應商下訂
          </a>
          <a className={BTN} href={href('receipt')}>
            一起到貨登記
          </a>
          {m > 1 ? (
            <button type='button' className={BTN} disabled title={shipTitle} aria-label={`一起出貨(${shipTitle})`}>
              一起出貨
            </button>
          ) : (
            <a className={BTN} href={href('ship')}>
              一起出貨
            </a>
          )}
          {costItemsParam !== undefined && (
            <a className={BTN} href={`${nextBase}${sep}${costItemsParam}=${itemIds}`}>
              改成本(勾選的列)
            </a>
          )}
        </>
      )}
      <button
        type='button'
        onClick={s.clear}
        className='inline-flex min-h-7 items-center rounded-lg border border-white/35 bg-transparent px-2 text-[12px] leading-[1.4] text-white'
      >
        取消勾選
      </button>
    </div>
  );
}
