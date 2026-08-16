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
import { toMessage } from './error-message';
import { loadShipmentCandidates, type ShipmentCandidates } from './shipment-candidates';
import {
  addShipmentItems,
  createShipment,
  listCustomerUserIdsByOrderItemIds,
  markShipmentShipped,
  unvoidShipment,
  voidShipment,
  type CarrierCode,
  type RecipientSnapshot,
  type ShipmentItemInput,
} from './shipment-repository';

export type SubmitShipmentInput = {
  /** 開彈窗時生成一次、重試沿用同一把。 */
  idempotencyKey: string;
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
  /**
   * 🔴 `shipmentId` 是 2026-08-16 加的,**只為了一件事:讓呼叫端組得出列印網址**。
   * 列印路由吃的是 uuid(`/print/orders/{訂單id}/shipping/{箱id}`,
   * 見 `components/orders/shipment-section.tsx` 那條 `Link`),而在此之前本型別
   * **只回箱號** ⇒ 建完箱**無法直接跳列印**,員工得回訂單頁再點一次。
   *
   * ⚠️ **刻意只加這一個欄位。** 回傳型別是 server↔client 邊界,每多一欄就多一份
   * 「可能被帶進瀏覽器」的東西;而**箱 uuid 本身不是機密**(它已經出現在列印網址上)。
   * ⇒ 想順手把 `carrierCode` / 收件人之類一起帶回來的人:**不要**,那會擴張審查面。
   *
   * ⚠️ **失敗分支刻意不加** —— 那條的 `shipmentReference` 是給員工看的「半成品箱號」
   * (讓他去作廢或重試),**不是拿來組網址的**;失敗時本來就不該跳列印。
   */
  | { ok: true; shipmentReference: string; shipmentId: string; shipped: boolean }
  /**
   * `shipmentReference` 有值 = 箱子已經建出來了(半成品),員工要嘛重試要嘛作廢。
   *
   * 🔴 **`code` 是 #351 ① 加的,而且它是必要的**:白話對照表靠 SQLSTATE 分辨拒因,
   * 而這裡是 server↔client 的邊界 —— 不把碼帶過去,client 手上就只剩一段字串,
   * 只能用正規式去訊息裡撈碼(那會把「說明裡提到某個碼」誤判成那個碼)。
   * `null` = 不是 DB 丟的、或沒有 code 欄(傳輸層失敗屬這類)。
   */
  | { ok: false; message: string; shipmentReference: string | null; code: string | null };

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
    // 🔴🔴 **箱子掛在誰身上,由 server 從「這批品項自己」推導,不收 client 送的客人 id。**
    //    第一版是把 `customerUserId` 當 input 收進來的 —— 那等於整條的唯一來源是瀏覽器裡的
    //    一個字串:改成另一位合法客人,`admin_create_shipment` 會**先替錯的人建出一個空箱**,
    //    要到 `admin_add_shipment_items` 才被 `pcm_b2_w3b2_item_not_customers` 擋下,
    //    而那時箱子已經在 DB 裡了(半成品,只能作廢)。
    //    ⇒ 現在改成從 `input.items` 反查:client 就算竄改品項清單,推出來的也是**那些品項真正的
    //      擁有者**,建箱與掛品項對得起來,構造不出跨客人的箱。
    const owners = await listCustomerUserIdsByOrderItemIds(input.items.map((i) => i.orderItemId));
    if (owners.size !== 1) {
      // fail-closed:0 位(查無品項)與 2 位以上(跨客人)都不建箱,**一個箱子都不留下**。
      return {
        // 這條是**本層自己的**拒絕(不是 DB 丟的)⇒ 沒有 SQLSTATE,白話層會退回吐這段訊息。
        // 而這段訊息本來就是寫給員工看的人話,不需要再翻譯一次。
        code: null,
        ok: false,
        message:
          owners.size === 0
            ? '找不到這些品項所屬的訂單,無法建立包裹(請重新整理後再試)。'
            : '這些品項不屬於同一位客人,不能裝同一箱。',
        shipmentReference: null,
      };
    }
    const customerUserId = [...owners][0]!;

    const created = await createShipment({
      idempotencyKey: input.idempotencyKey,
      customerUserId,
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
    return {
      ok: true,
      shipmentReference: created.shipmentReference,
      // 🔴 給呼叫端組列印網址用(理由見 `SubmitShipmentResult` 的 docstring)。
      shipmentId: created.shipmentId,
      shipped: input.markShipped,
    };
  } catch (e) {
    // 🔴 不吞錯、不改寫成自己的措辭 —— 見上方註解。
    const message = toMessage(e);
    // 🔴 只讀 `code` 欄、不解析訊息(理由見 `shipment-error-view.ts` 的 `parseShipmentError`)。
    const code =
      typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string'
        ? ((e as { code: string }).code)
        : null;
    return { ok: false, message, shipmentReference: reference, code };
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

/**
 * 已建箱、還沒出貨的那些箱:**填單號並標記出貨**。
 *
 * 🔴🔴 **這支不是「補單號」,是「標記出貨」。** 底下的 RPC
 * (`supabase/migrations/20260807190000_m4b_e10_b2_w3c3_mark_shipped.sql:181` 逐字
 * `SET shipped_at = now(), tracking_number = p_tracking_number`)
 * **一定會同時把 `shipped_at` 寫下去** —— 按下去等於宣告「貨已經交給貨運了」。
 * ⇒ **呼叫端的文案不得寫成「補單號」/「編輯」**,那會讓員工以為只是改一個欄位。
 *
 * 🔴 **能力不是本片新加的** —— RPC 與 repository 層早就有
 * (`shipment-repository.ts` 的 `markShipmentShipped()`),**缺的只有 action 層與 UI 入口**。
 * 本片是把既有能力接上來:**零 migration、零 GRANT、零新 RPC**。
 * ⚠️ 在此之前唯一的呼叫端是 `submitShipment()`(建箱時一併標出貨)⇒ 員工按了
 * 「只建箱、先不出貨」之後就沒有出口,只能作廢重開新箱(**而那會換箱號,已印的紙就白印了**)。
 *
 * 🔴 **只送單號,不送 `carrier_code`。** 凍結守門 X8
 * (`20260805170100_m4b_e10_b2_s1a2_shipments_guards.sql:94-96` 逐字)凍結集**恰 3 欄**:
 * `recipient_snapshot` / `carrier_code` / `carrier_note`;**只有 `tracking_number` 不凍結**
 * (同段註解「Q2=A 單號可改」)⇒ 想順手讓員工改貨運商的人:**改不了,而且那是刻意的。**
 *
 * ⚠️ **已出貨的箱【改】單號這支做不到**:RPC `:184` `AND shipped_at IS NULL` 是 write-once,
 * `:153` 會直接 RAISE「已經寄出了」。
 * 🔴 而 X8 明文不凍結 `tracking_number`、註解寫「單號可改」——
 * **DB 層允許改、RPC 層不給改,兩層意圖不一致。** 那個落差本片不修(要新 RPC ⇒ migration),
 * 已回報主視窗立 backlog。**不要以為這裡漏做。**
 */
export async function markShipmentShippedAction(args: {
  idempotencyKey: string;
  shipmentId: string;
  /** 貨運商是 `other`(自取/自送)時可省;其餘 DB CHECK 就會擋(見 `shipments_shipped_needs_tracking`)。 */
  trackingNumber?: string;
}): Promise<VoidResult> {
  try {
    await markShipmentShipped(args);
    revalidatePath('/orders');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: toMessage(e) };
  }
}
