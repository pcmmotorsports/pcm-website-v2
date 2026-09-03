import 'server-only';
import type { OrderItemReceiptRow } from '../../lib/orders/receipt-repository';
import type { OrderShipmentGroup } from '../../lib/shipping/order-shipments';
import { receiptDeletability } from '../../lib/orders/receipt-deletable';
import { ReceiptDeleteButton } from './receipt-delete-button';

// receipt-history-list.tsx — 一個品項的**逐筆到貨紀錄**, 每一筆各自可撤(backlog `#450`)。
//
// 🔵 Sean 2026-08-12 的原始需求逐字:「原本以為這個商品要給這個訂單, 其實要先給另外一個訂單」。
//
// 🔴🔴 **形狀是【每個品項一句話】, 不是【每列一顆會失敗的鈕】** —— 而那是量出來的:
//    DB 那道刪除守門比對的是 `si.order_item_id`(**品項**), 不是那一筆 receipt
//    ⇒ 一個品項底下的每一筆到貨, **要嘛全部撤得掉, 要嘛全部撤不掉**
//    ⇒ 📌 「逐列去試」永遠是全中或全不中 ⇒ **員工會按 N 次得到 N 個一模一樣的失敗。**
//    (判準與它的 8 格測試在 `lib/orders/receipt-deletable.ts`。)
//
// 🛑 **稿上沒有這一區**(線 `-auth` 查過:`orders-admin-v2.html`「撤銷」⇒ 0 命中,
//    🟢 正對照「登錄」⇒ 4 命中 ⇒ 尺是活的)⇒ **net-new, 拿不到稿的背書** ⇒ 視覺等 Sean 定稿。

export function ReceiptHistoryList({
  orderItemId,
  orderId,
  returnTo,
  receipts,
  shipmentGroups,
}: {
  orderItemId: string;
  orderId: string;
  returnTo: string;
  /**
   * 這張單全部的到貨紀錄。**`null` = 讀不到 / 被截斷**(不是「沒有到貨」)。
   * 🔴 兩者分開:後者靜靜少列幾筆, 而那正是這一片要修的病的另一個版本。
   */
  receipts: readonly OrderItemReceiptRow[] | null;
  /** 本單的包裹分組。**`null` = 讀不到** ⇒ 判準會回「擋」(量不到 ≠ 沒有包裹)。 */
  shipmentGroups: readonly OrderShipmentGroup[] | null;
}) {
  if (receipts === null) {
    return (
      <p className='text-destructive mt-2 text-xs'>
        目前讀不到這個品項的到貨紀錄(或筆數超過一次能列的上限),所以這裡不列 ——
        請重新整理;持續如此請通知系統維護。
      </p>
    );
  }
  const mine = receipts.filter((r) => r.orderItemId === orderItemId);
  if (mine.length === 0) return null;

  const deletability = receiptDeletability(shipmentGroups, orderItemId);

  return (
    <div className='mt-2'>
      <p className='text-muted-foreground mb-1 text-xs font-medium'>到貨紀錄({mine.length} 筆)</p>
      {/* 🔴🔴 **那句話印【一次】, 不是每列一句** —— 它是品項級的事實。
        * ⇒ 而它印在**清單上方**, 因為員工要先知道「這一組能不能動」再去看細節。
        * 🔵 字面是 **Sean 2026-09-03 親筆**(見 `receipt-deletable.ts` 的 `messageFor`),
        *    我只在後面加了包裹編號 —— 「那個包裹」沒說是哪一箱, 而他要去作廢得知道去哪一箱。 */}
      {deletability.blocked && (
        <p
          role='alert'
          className='border-destructive/40 bg-destructive/10 text-destructive mb-2 rounded-md border px-2 py-1.5 text-xs'
        >
          {deletability.message}
        </p>
      )}
      <ul className='space-y-1'>
        {mine.map((r) => (
          <li key={r.id} className='flex items-start gap-2 text-xs'>
            <span className='tabular-nums'>{r.receivedAt.slice(0, 10)}</span>
            <span className='tabular-nums'>
              {r.quantity} 件{r.surplusQuantity > 0 ? `(另有 ${r.surplusQuantity} 件進店內)` : ''}
            </span>
            <span className='text-muted-foreground'>{r.receivedBy}</span>
            {r.note !== null && r.note !== '' && (
              <span className='text-muted-foreground max-w-[12rem] truncate'>{r.note}</span>
            )}
            {/* 🔴🔴 **每一列都給鈕 —— 即使上面那句提醒亮著。**
              * ⛔ ~~我第一版在 blocked 時不給鈕~~ ⇒ 而那是拿一個**算不準的預測**
              *    去關掉一條**真的可能走得通**的路:DB 的第二層守門與【那一筆的數量】有關
              *    (刪掉之後重算 instock, 見 lib/orders/receipt-deletable.ts 檔頭), 前端算不出來,
              *    而那支 RPC 的註解**明文拒絕**在前面複製那個規則(逐字「自己算 = 第二真相」)。
              * ⇒ 📌 **撤不掉時多按一次很便宜;撤得掉而畫面不給按, 那件事就沒有人做得到。**
              * ⚠️ 上面那行原本有一段被 zsh 的反引號吃掉了(命令替換)—— 已補回。 */}
            <ReceiptDeleteButton
                receiptId={r.id}
                orderId={orderId}
                orderItemId={orderItemId}
                returnTo={returnTo}
                receivedAt={r.receivedAt}
                quantity={r.quantity}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
