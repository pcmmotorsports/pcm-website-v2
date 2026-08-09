'use client';

// shipment-launcher.tsx — 「開建箱彈窗」這件事的**單一實作**(D-373-A 任務 1-2)。
//
// 🔴 **為什麼抽成共用**:出貨現在有兩個入口 —— ①訂單總覽勾單 ②訂單詳情頁出貨卡。
//    兩者的差別只有「要出哪幾張單」;開窗流程(取候選 → 生冪等鍵 → 開窗 → 成功後收尾)
//    一模一樣。複製第二份的代價不是多幾行,是**冪等鍵那條紀律會變成兩份**,
//    而其中一份日後被改成「送出時生鍵」**不會有任何症狀**
//    (連按兩次真的建出兩個箱子、兩次都回報成功;見 `shipment-actions.ts` 檔頭)。
//    ⇒ `crypto.randomUUID()` 全線只出現在本檔的 `openDialog()` 這一個地方。
//
// 🔴 **客人身分會經過 client,但只當「開不開得了窗」的旗標用。**
//    `fetchShipmentCandidates` 回來的 `customerUserId` 確實進了本檔的 state
//    (`null` = 查不到、或這批單跨了兩位客人 ⇒ 不給開窗),但它**到此為止**:
//    不傳進彈窗、不隨送出回到 server。真正決定「箱子掛誰」的是 `submitShipment`,
//    它從送出的品項自己反查(`listCustomerUserIdsByOrderItemIds`)。
//    ⚠️ 這個區分是重點:早期偵測放 client 沒問題,**權威來源放 client 就是把門開著**。
//    (第一版這段寫成「完全不經過 client」—— 字面與事實不符,codex R2 打回。)
//
// 🔴 **props 只收訂單 id**(同 2b-1 紅線):`AdminOrderSummary` / `AdminOrderDetail`
//    帶成交價與會員等級,整包進 client props = 序列化進 RSC payload。

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ShipmentDialog } from './shipment-dialog';
import { toMessage } from '../../lib/shipping/error-message';
import { fetchShipmentCandidates } from '../../lib/shipping/shipment-actions';
import type { ShipmentCandidates } from '../../lib/shipping/shipment-candidates';

export type ShipmentLauncher = {
  loading: boolean;
  error: string | null;
  openDialog: () => Promise<void>;
  /** 要渲染的彈窗(沒開窗時是 `null`)。**放在深底容器外面**——見 shipping-selection.tsx 那段。 */
  dialog: ReactNode;
};

/**
 * 開建箱彈窗的共用邏輯。
 *
 * @param orderIds 要出的訂單。**請傳穩定參考**(`useMemo` 或 state),
 *                 每次 render 都新建陣列會讓 `openDialog` 的參考跟著換。
 * @param onDone   建箱成功後的收尾(勾單列用來清空勾選;詳情頁用來刷新)。
 */
export function useShipmentLauncher(
  orderIds: readonly string[],
  onDone?: () => void,
): ShipmentLauncher {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * 開著的彈窗。`key` 是**冪等鍵**,在**開窗時生成一次**、整段重試沿用。
   * 🔴 不要移到送出時生成 —— 那樣每次重試都是新鍵,冪等層完全失效**而且零症狀**。
   */
  const [open, setOpen] = useState<{ key: string; data: ShipmentCandidates } | null>(null);

  const openDialog = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await fetchShipmentCandidates(orderIds);
      if (data.items.length === 0) {
        setError('這些訂單沒有可出貨的品項(可能都已取消,或已經裝進其他箱子了)。');
        return;
      }
      if (data.customerUserId === null) {
        setError('查不到這批訂單共同的客人 ⇒ 不能裝同一箱(同一箱只能裝同一位客人的東西)。');
        return;
      }
      setOpen({ key: crypto.randomUUID(), data });
    } catch (e) {
      // 🔴 走共用的 `toMessage`,不要自己寫 `String(e)` —— Supabase 丟的 `PostgrestError`
      //    不是 `Error` 實例,`String(e)` 會印出 `[object Object]`(2026-08-09 正式站實測過的症狀)。
      setError(toMessage(e));
    } finally {
      setLoading(false);
    }
  }, [orderIds]);

  const dialog: ReactNode =
    open === null || open.data.customerUserId === null ? null : (
      <ShipmentDialog
        candidates={open.data.items}
        recipient={open.data.recipient ?? { name: null, phone: null, line: null }}
        idempotencyKey={open.key}
        onClose={() => setOpen(null)}
        onDone={() => {
          // 成功之後關窗;下一次開窗會生成**新的**冪等鍵(那是另一箱)。
          setOpen(null);
          onDone?.();
        }}
      />
    );

  return { loading, error, openDialog, dialog };
}

/**
 * 訂單詳情頁出貨卡上的「建立包裹」入口(2026-08-09 Sean 實測後追加)。
 *
 * 🔴 這等於**單張訂單版的勾單流程**:預選 = 本單全部還能出的品項。
 *    C 版的主要動線仍是總覽勾單(可跨單併箱);這個入口是「我人已經在這張單上了」的捷徑。
 *
 * ⚠️ 建箱成功後要 `router.refresh()`:server action 只 `revalidatePath('/orders')`,
 *    revalidate 的是列表那一頁,**不含本詳情頁** ⇒ 不刷的話新箱子不會出現在下面的清單裡,
 *    員工會以為沒建成功而再按一次(第二次是不同的冪等鍵 = 真的第二箱)。
 */
export function OrderShipButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  // 🔴 陣列要 memo:直接寫 `[orderId]` 每次 render 都是新參考 ⇒ `openDialog` 跟著重建。
  const orderIds = useMemo(() => [orderId], [orderId]);
  const { loading, error, openDialog, dialog } = useShipmentLauncher(orderIds, () =>
    router.refresh(),
  );

  return (
    <span className='flex flex-wrap items-center justify-end gap-2'>
      <button
        type='button'
        disabled={loading}
        onClick={() => void openDialog()}
        className='rounded border px-2 py-1 text-xs disabled:opacity-50'
      >
        {loading ? '載入中…' : '建立包裹'}
      </button>
      {error !== null && <span className='text-destructive w-full text-right text-xs'>{error}</span>}
      {dialog}
    </span>
  );
}
