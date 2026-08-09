'use client';

// shipping-selection.tsx — 訂單總覽「勾單成箱」的 client island(片 2b-1;Sean 拍 S1=A C 版)。
//
// 🔴🔴 **這是 `orders-table.tsx` 這條線上的第一個 client 邊界,而且刻意做成 island。**
//    那支表原本明文宣告「零 client 邊界」(它自己的檔頭註解),理由是鐵則 12:
//    金額 + 會員等級同列 = 經銷價脈絡,**敏感值不序列化進 client bundle**。
//    ⇒ 本檔的存在不能破壞那個理由,所以:
//
//    **本檔的元件只收純量 `orderId` / `customerUserId`,絕不收 `AdminOrderSummary`。**
//
//    整包 summary 帶著 `total`(金額)與 `tierAtCheckout`(會員等級)——
//    把它當 prop 傳進 client 元件 = 那兩個值會被序列化進 RSC payload、進 client bundle,
//    也就是把鐵則 12 的護欄從「server-only」降級成「反正使用者看不到」。
//    ⚠️ **看不到 ≠ 沒送出去**:RSC payload 在瀏覽器的 network 面板裡是純文字。
//    這條由 `shipping-selection.test.tsx` 的守門釘住(突變「把整包 summary 傳進來」要紅),
//    不是只寫在這段註解裡。
//
// 🔴 **同一箱只能裝同一位客人**:DB 的 `pcm_b2_w3b2_item_not_customers` 會擋。
//    畫面把它表達成「勾了某客人的單 ⇒ 其他客人的 checkbox 變灰」,讓員工在**按下去之前**就知道,
//    而不是送出後才被退件。這是體驗層,正確性仍在 DB。
//
// 🔴 **沒有全選框**(C 版線框上那句話):全選必然跨客人,而跨客人裝同一箱一定被退件。
//    畫面上不提供一個「按了一定失敗」的按鈕。
//
// 🔴 **冪等鍵在這裡生成(開窗時一次),不在 action 裡生成。**
//    `crypto.randomUUID()` 只出現在「開窗」那一個地方;送出與重試都沿用同一把。
//    守門釘住:`shipment-actions.ts` 不得出現任何鍵產生器。

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ShipmentDialog } from './shipment-dialog';
import { fetchShipmentCandidates } from '../../lib/shipping/shipment-actions';
import type { ShipmentCandidates } from '../../lib/shipping/shipment-candidates';

type SelectionState = {
  /** 目前這批勾選屬於哪位客人;`null` = 還沒勾任何單。 */
  customerUserId: string | null;
  /** 已勾的訂單 id。 */
  orderIds: readonly string[];
};

type SelectionApi = SelectionState & {
  toggle: (orderId: string, customerUserId: string) => void;
  clear: () => void;
  /** 這張單現在可不可以勾(false = 別的客人、要變灰)。 */
  canSelect: (customerUserId: string) => boolean;
  isSelected: (orderId: string) => boolean;
};

const Ctx = createContext<SelectionApi | null>(null);

/**
 * 勾選的狀態轉移(純函式,**刻意 export 出來讓測試直接打**)。
 *
 * 🔴 **為什麼要抽出來**:第一版把這段寫在 `setState` 裡,測試只能透過畫面觸發。
 * 但「別的客人的框」是 `disabled` 的,對 disabled 的 input 發事件**根本進不到 handler**
 * ⇒ 那條「狀態層是第二道閘」的測試**綠得毫無意義**:把本段的客人比對整個刪掉,測試照樣全綠
 * (突變 M5 當場證明)。抽成純函式之後,測試打得到真正的轉移邏輯。
 *
 * 🔴 這道閘為什麼需要存在(UI 已經 disabled 了還要再擋一次):
 * `disabled` 只擋滑鼠。鍵盤、輔助技術、瀏覽器擴充、以及任何程式化路徑都繞得過去,
 * 而繞過去的後果是送出一箱裝了兩位客人的東西、被 DB `pcm_b2_w3b2_item_not_customers` 退件。
 */
export function nextSelection(
  prev: SelectionState,
  orderId: string,
  customerUserId: string,
): SelectionState {
  const on = prev.orderIds.includes(orderId);
  if (on) {
    const orderIds = prev.orderIds.filter((id) => id !== orderId);
    // 🔴 取消最後一張 ⇒ 客人歸零,否則其他客人會被永久鎖住(勾光又取消光之後全站變灰)。
    return { orderIds, customerUserId: orderIds.length === 0 ? null : prev.customerUserId };
  }
  // 🔴 不同客人一律不收 —— UI 的 disabled 是第一道,這裡是第二道。
  if (prev.customerUserId !== null && prev.customerUserId !== customerUserId) return prev;
  return { customerUserId, orderIds: [...prev.orderIds, orderId] };
}

export function ShippingSelectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SelectionState>({ customerUserId: null, orderIds: [] });

  const toggle = useCallback((orderId: string, customerUserId: string) => {
    setState((prev) => nextSelection(prev, orderId, customerUserId));
  }, []);

  const clear = useCallback(() => setState({ customerUserId: null, orderIds: [] }), []);

  const api = useMemo<SelectionApi>(
    () => ({
      ...state,
      toggle,
      clear,
      canSelect: (customerUserId: string) =>
        state.customerUserId === null || state.customerUserId === customerUserId,
      isSelected: (orderId: string) => state.orderIds.includes(orderId),
    }),
    [state, toggle, clear],
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
 * 單張訂單的勾選框(訂單層 —— 桌機放 rowSpan 合併格、手機放卡頭)。
 *
 * 🔴 props **只有兩個純量**,見檔頭紅線。要顯示的東西(單號/金額/客戶名)一律留在 server 端。
 */
export function OrderShipCheckbox({
  orderId,
  customerUserId,
}: {
  orderId: string;
  customerUserId: string;
}) {
  const s = useSelection();
  const allowed = s.canSelect(customerUserId);
  const checked = s.isSelected(orderId);
  return (
    <input
      type='checkbox'
      className='size-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40'
      checked={checked}
      disabled={!allowed}
      onChange={() => s.toggle(orderId, customerUserId)}
      aria-label={
        allowed ? '選取這張訂單一起出貨' : '這張訂單是別的客人的,不能和目前選取的裝同一箱'
      }
      title={allowed ? undefined : '同一箱只能裝同一位客人的東西'}
    />
  );
}

/** 勾選後浮出的動作列。沒勾任何單時整條不渲染(不佔位、不留一個 disabled 的鈕在那裡)。 */
export function ShippingSelectionBar() {
  const s = useSelection();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * 開著的彈窗。`key` 是**冪等鍵**,在**開窗時生成一次**、整段重試沿用。
   * 🔴 不要移到送出時生成 —— 那樣每次重試都是新鍵,冪等層完全失效**而且零症狀**
   *    (連按兩次真的建出兩個箱子,兩次都回報成功)。
   */
  const [open, setOpen] = useState<{ key: string; data: ShipmentCandidates } | null>(null);

  const openDialog = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await fetchShipmentCandidates(s.orderIds);
      if (data.items.length === 0) {
        setError('這些訂單沒有可出貨的品項(可能都已取消,或已經裝進其他箱子了)。');
        return;
      }
      setOpen({ key: crypto.randomUUID(), data });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [s.orderIds]);

  if (s.orderIds.length === 0) return null;
  return (
    <>
    <div className='bg-foreground text-background mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-4 py-2.5'>
      <span className='text-sm'>
        已勾 <b>{s.orderIds.length}</b> 張訂單
      </span>
      <span className='flex items-center gap-2'>
        <button
          type='button'
          disabled={loading || s.customerUserId === null}
          onClick={() => void openDialog()}
          className='bg-background text-foreground rounded px-3 py-1.5 text-sm font-semibold disabled:opacity-50'
        >
          {loading ? '載入中…' : `出貨(${s.orderIds.length} 單)`}
        </button>
        <button
          type='button'
          onClick={s.clear}
          className='border-background/40 rounded border px-3 py-1.5 text-sm'
        >
          取消勾選
        </button>
      </span>
      {error !== null && <span className='w-full text-xs'>{error}</span>}
    </div>
    {/* 🔴 彈窗**刻意放在動作列 `<div>` 外面**。2026-08-09 Sean 正式站實測白字白底,
        根因就是它原本是那個 `bg-foreground text-background`(深底白字)容器的子節點、
        整個彈窗繼承到白字。搬出來 + 面板自己設 `text-foreground`(見 shipment-dialog.tsx)= 兩道。
        ⚠️ 它是 `fixed inset-0` 的覆蓋層,本來就不該是某個列的子節點 —— 搬出來也比較正確。 */}
    {open !== null && s.customerUserId !== null && (
      <ShipmentDialog
        customerUserId={s.customerUserId}
        candidates={open.data.items}
        recipient={open.data.recipient ?? { name: null, phone: null, line: null }}
        idempotencyKey={open.key}
        onClose={() => setOpen(null)}
        onDone={() => {
          // 成功之後清空勾選並關窗;下一次開窗會生成**新的**冪等鍵(那是另一箱)。
          setOpen(null);
          s.clear();
        }}
      />
    )}
    </>
  );
}
