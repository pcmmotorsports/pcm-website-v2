import type { OrderShipmentGroup } from '../shipping/order-shipments';

// refund-shipment-notice.ts — P0-1 片 5:退款前的出貨提醒。只顯示、不擋、不用多勾。
//
// 🔴 分類跟 `pcm_auto_cancel_on_full_card_refund` 第 2 代(`20260916010000`)同一套, 順序也一樣:
//    讀箱子之前先 skip ── 已取消(already_cancelled)→ 部分取消(partially_cancelled)→ 有沒作廢的人工退款(mixed_rail);
//    讀未作廢的箱子 ── 叫過車(`hct_dispatch_attempted_at`)而沒出貨 ⇒ 不自動取消;有出貨 ⇒ 不自動取消;
//                     只有沒叫車也沒出貨的箱 ⇒ 自動取消。
//    SQL 那邊改分類 ⇒ 這裡跟著改(`refund-shipment-notice.test.ts` 有一格逐字釘 SQL)。
// 🔴 叫過車 / 已出貨那兩句在任何世界都是真的(「不會自動取消」)⇒ 先印;其餘只在沒有它們時才說。
// 🔴 `groups === null` = 讀不到(可能被截斷), 不是沒有箱 ⇒ 印「讀不到」, 不靜靜不提醒。

export const REFUND_SHIPMENT_MESSAGE = {
  unreadable: '讀不到出貨狀態,退款前先到出貨區看一眼。',
  dispatched: (refs: string) => `退完這張單不會自動取消。請確認箱子 ${refs} 的貨有沒有交出。`,
  shipped: '已出貨,全額退款後不會變成已取消(當退貨),客人只收到退款信。剩下沒出的箱子和品項會被擋住,不能再出。',
  live: (refs: string) => `全額退完會自動取消。請把箱子 ${refs} 作廢;已經跟新竹要過託運單號的話要打給新竹攔。`,
  cancelledLive: (refs: string) => `這張單已取消。請確認箱子 ${refs} 已作廢;已經跟新竹要過託運單號的話要打給新竹攔。`,
  partiallyCancelled: '這張單有部分取消紀錄,全額退完不會自動取消;要取消整張單請自己按「申請取消整張單」。',
  cardPlusManual: '刷卡加人工合計退滿後,剩下沒出的會被擋住;單不會自動取消。',
} as const;

/** 刷卡全額退款前要給員工看的話。`[]` = 沒有要提醒的。 */
export function refundShipmentNotice(input: {
  groups: readonly OrderShipmentGroup[] | null;
  /** 整張單已取消(`cancelled_at`)。 */
  cancelled: boolean;
  /** 有部分取消紀錄。 */
  partiallyCancelled: boolean;
  /** 有沒作廢的人工退款;讀不到或被截斷時呼叫端傳 `true`(寧可少說「會自動取消」)。 */
  mixedRail: boolean;
}): string[] {
  const { groups } = input;
  if (groups === null) return [REFUND_SHIPMENT_MESSAGE.unreadable];
  const live = groups.filter((g) => g.shipment.voidedAt === null);
  const refs = (pick: (g: OrderShipmentGroup) => boolean) =>
    live.filter(pick).map((g) => g.shipment.shipmentReference).join('、');
  const dispatched = refs((g) => g.hctDispatchAttempted && g.shipment.shippedAt === null);
  const waiting = refs((g) => !g.hctDispatchAttempted && g.shipment.shippedAt === null);
  const out: string[] = [];
  if (dispatched !== '') out.push(REFUND_SHIPMENT_MESSAGE.dispatched(dispatched));
  if (live.some((g) => g.shipment.shippedAt !== null)) out.push(REFUND_SHIPMENT_MESSAGE.shipped);
  if (out.length > 0) return out;
  if (input.cancelled) return waiting === '' ? [] : [REFUND_SHIPMENT_MESSAGE.cancelledLive(waiting)];
  if (input.partiallyCancelled) return [REFUND_SHIPMENT_MESSAGE.partiallyCancelled];
  if (input.mixedRail) return [REFUND_SHIPMENT_MESSAGE.cardPlusManual];
  return waiting === '' ? [] : [REFUND_SHIPMENT_MESSAGE.live(waiting)];
}
