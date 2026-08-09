'use server';

// shipment-actions.ts — 建箱彈窗的 server actions(片 2b-2b-2)。
//
// 🔴 **一次送出 = 三支 RPC,而且共用同一把冪等鍵。**
//    建箱 → 掛品項 →(可選)標出貨。三支各自有冪等層,而冪等身分是
//    **(操作名, 鍵)** 這個組合(`pcm_b2_shipping_idem_claim('create_shipment', key, hash)`)
//    ⇒ 同一把鍵在三支之間**不會互相碰撞**,而重試時三支各自認出自己的重放。
//
// 🔴 **鍵由呼叫端(彈窗)在開窗時生成一次、重試不換。**
//    若在這裡每次 action 各生一把,重試就是三把新鍵 ⇒ **冪等層完全失效而且零症狀**:
//    使用者連按兩次會真的建出兩個箱子,而兩次都回報成功。
//    ⇒ 本檔**不得**出現任何鍵產生器,守門釘住。
//
// 🔴 **中途失敗會留下半成品,這是刻意的、不是漏做。**
//    三支 RPC **不在同一個交易裡**(它們各自是一次 PostgREST 呼叫)。
//    掛品項失敗時,箱子已經建出來了 —— 那個箱子是**草稿箱**(未出貨、未作廢),
//    員工可以重試(同鍵 ⇒ 建箱重放、不會再建一個)或作廢它。
//    ⚠️ 這裡**不做補償刪除**:`shipments` 有 `pcm_b2_shipments_block_delete` trigger,
//    刪除路徑本來就被 DB 封死;唯一的收拾方式就是作廢,而那該由員工看著辦、不是靜默替他決定。

import { revalidatePath } from 'next/cache';
import { loadShipmentCandidates, type ShipmentCandidates } from './shipment-candidates';
import {
  addShipmentItems,
  createShipment,
  markShipmentShipped,
  unvoidShipment,
  voidShipment,
  type CarrierCode,
  type RecipientSnapshot,
  type ShipmentItemInput,
} from './shipment-repository';

/**
 * 把丟出來的東西轉成**人看得懂的一行字**。
 *
 * 🔴 2026-08-09 Sean 正式站實測:錯誤區塊直接印出 `[object Object]`。
 *    根因:Supabase 丟的是 **`PostgrestError` 這種普通物件**(帶 message / code / details / hint),
 *    **不是 `Error` 實例** ⇒ 舊寫法的三元判斷會落到字串化分支 ⇒ `[object Object]`。
 *    而 DB `RAISE EXCEPTION` 寫的中文就在那個物件的 message 欄裡,
 *    等於**我們把唯一能給員工看的訊息丟掉了**。
 */
function toMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null) {
    const o = e as { message?: unknown; details?: unknown; hint?: unknown };
    if (typeof o.message === 'string' && o.message !== '') return o.message;
    if (typeof o.details === 'string' && o.details !== '') return o.details;
    if (typeof o.hint === 'string' && o.hint !== '') return o.hint;
    // 🔴 真的沒有可讀欄位時吐 JSON,**也不要吐那個沒有資訊量的字串** —— 對排查零幫助。
    try {
      return JSON.stringify(e);
    } catch {
      return '未知錯誤(無法序列化)';
    }
  }
  return String(e);
}

export type SubmitShipmentInput = {
  /** 開彈窗時生成一次、重試沿用同一把。 */
  idempotencyKey: string;
  customerUserId: string;
  recipient: RecipientSnapshot;
  carrierCode: CarrierCode;
  /** 只有 `carrierCode === 'other'` 時給(且必須給)。 */
  carrierNote?: string;
  items: ShipmentItemInput[];
  /** 只在 `markShipped` 時需要;`carrierCode === 'other'` 可免。 */
  trackingNumber?: string;
  /** false = 只建箱、先不出貨(單號晚點再補)。 */
  markShipped: boolean;
};

export type SubmitShipmentResult =
  | { ok: true; shipmentReference: string; shipped: boolean }
  /** `shipmentReference` 有值 = 箱子已經建出來了(半成品),員工要嘛重試要嘛作廢。 */
  | { ok: false; message: string; shipmentReference: string | null };

/**
 * 建箱 →(掛品項)→(可選)標出貨。
 *
 * 🔴 **錯誤訊息直接用 DB 的**:那些 RPC 的 `RAISE EXCEPTION` 寫的是給員工看的中文
 * (例:「包裹 X 已經寄出了(可能是別人剛按過)。不需要再出一次。」)。
 * 在這裡另寫一份對照表 = 第二個真相源,而且 DB 那邊改了字這裡不會知道。
 */
export async function submitShipment(input: SubmitShipmentInput): Promise<SubmitShipmentResult> {
  let reference: string | null = null;
  try {
    const created = await createShipment({
      idempotencyKey: input.idempotencyKey,
      customerUserId: input.customerUserId,
      recipient: input.recipient,
      carrierCode: input.carrierCode,
      ...(input.carrierNote === undefined ? {} : { carrierNote: input.carrierNote }),
    });
    reference = created.shipmentReference;

    await addShipmentItems({
      idempotencyKey: input.idempotencyKey,
      shipmentId: created.shipmentId,
      items: input.items,
    });

    if (input.markShipped) {
      await markShipmentShipped({
        idempotencyKey: input.idempotencyKey,
        shipmentId: created.shipmentId,
        ...(input.trackingNumber === undefined ? {} : { trackingNumber: input.trackingNumber }),
      });
    }

    // 出貨會觸發摘要重算 ⇒ 列表的「還能出多少」要跟著變。
    revalidatePath('/orders');
    return { ok: true, shipmentReference: created.shipmentReference, shipped: input.markShipped };
  } catch (e) {
    // 🔴 不吞錯、不改寫成自己的措辭 —— 見上方註解。
    const message = toMessage(e);
    return { ok: false, message, shipmentReference: reference };
  }
}

/**
 * 彈窗開啟時取候選品項。
 *
 * 🔴 這層存在的唯一理由是**跨 server/client 邊界**:`shipment-candidates.ts` 帶 `server-only`,
 * client 元件不能直接 import 它(那正是我們要的:訂單明細含成交價與 PII)。
 * 這支 action 只把**已經算好的最小 DTO** 送過去,不轉手任何原始明細。
 */
export async function fetchShipmentCandidates(
  orderIds: readonly string[],
): Promise<ShipmentCandidates> {
  return loadShipmentCandidates(orderIds);
}

export type VoidResult = { ok: true } | { ok: false; message: string };

/**
 * 作廢一箱(片 2c)。
 *
 * 🔴 **作廢不是刪除**:`shipments` 有 `block_delete` trigger,列會留著、只是 `deleted_at` 有值。
 * 效果是那些品項**回到可出貨池**(合約:「要重新出這批貨請開一張新的包裹」)。
 * ⇒ 畫面要把作廢的箱**繼續列出來**,否則員工會以為貨憑空消失。
 *
 * 🔴 冪等鍵由呼叫端給(同建箱那條紀律)。這裡不產。
 */
export async function voidShipmentAction(args: {
  idempotencyKey: string;
  shipmentId: string;
  voidReason: string;
}): Promise<VoidResult> {
  try {
    await voidShipment(args);
    revalidatePath('/orders');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}

/** 復原作廢(片 2c)。 */
export async function unvoidShipmentAction(args: {
  idempotencyKey: string;
  shipmentId: string;
}): Promise<VoidResult> {
  try {
    await unvoidShipment(args);
    revalidatePath('/orders');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}
