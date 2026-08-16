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
import { authorizeAdminMutation } from '../session/authorize';
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
 * 出貨線的稽核用應用層 log(不是 `admin_audit_log`,DB 層那一列是 A2 的事)。
 *
 * 🔴 **一定要有 outcome 那一半**(codex 2026-08-16 must-fix):只記 attempt 的話,
 *    RPC 失敗或冪等重放時**分不出「誰做成了」與「誰試了沒成」** ——
 *    而稽核要回答的正是前者。attempt 單獨存在時,宣稱強於能力。
 *
 * 🔴 **欄位白名單在這裡,不在呼叫端。** 呼叫端只能送這幾個 key,
 *    收件人姓名/電話/地址、備註內容、追蹤碼一律不進來(PII;log 是一份不受 service_role
 *    邊界保護的副本)。要加欄位請先問「這一欄外洩了會怎樣」。
 */
const LOG_FIELDS = ['shipment_id', 'item_count', 'carrier_code', 'mark_shipped', 'has_tracking_number'] as const;
type LogField = (typeof LOG_FIELDS)[number];

function auditLog(
  event: string,
  auth: { sid: string; actorId: string },
  outcome: 'attempt' | 'ok' | 'fail',
  extra: Partial<Record<LogField, string | number | boolean | null>> = {},
): void {
  console.info(`[admin/shipping] ${event}.${outcome}`, { sid: auth.sid, actor: auth.actorId, ...extra });
}

/**
 * 建箱 →(掛品項)→(可選)標出貨。
 *
 * 🔴 **錯誤訊息直接用 DB 的**:那些 RPC 的 `RAISE EXCEPTION` 寫的是給員工看的中文
 * (例:「包裹 X 已經寄出了(可能是別人剛按過)。不需要再出一次。」)。
 * 在這裡另寫一份對照表 = 第二個真相源,而且 DB 那邊改了字這裡不會知道。
 */
export async function submitShipment(input: SubmitShipmentInput): Promise<SubmitShipmentResult> {
  // 🔴 閘在 try 之外、在任何 RPC 之前。
  //    ⚠️ 原註解寫「放進 try 會被 catch 吞成一般錯誤訊息」—— **那句宣稱強於機制**
  //    (code-reviewer nit):閘回 `null` **不 throw**,除非 `cookies()` 自己炸,否則沒東西可吞。
  //    真正的理由比較樸素:**擋下的東西不該混進「DB 拒絕」那個出口**,
  //    因為那個出口的措辭是「直接用 DB 的錯誤訊息」,而這裡沒有 DB 錯誤。
  const auth = await authorizeAdminMutation();
  if (auth === null) {
    return { ok: false, message: NO_ACTOR_MESSAGE, shipmentReference: null, code: null };
  }
  // 🔴 **閘的回傳值要被【消費】,不是丟掉。** 原版寫成 `(await …) === null`,
  //    `actorId` 一次都沒用 ⇒ 加了閘之後**仍然沒有任何地方記下是誰做的**,
  //    而我還在訊息裡跟員工說「會記在稽核紀錄上」。code-reviewer 判那是鐵則 11 違反。
  //    ⇒ 比照兄弟檔(`orders/payment-actions.ts:94-97`、`orders/note-actions.ts:135`)
  //      的 structured log。**這是【應用層 log】,不是 `admin_audit_log`** ——
  //      DB 層那一列是 A2 的事,不要拿這行當它的替代品。

  let reference: string | null = null;
  try {
    // 🔴 attempt log 放在 try **裡面**(codex must-fix):原本在 try 外直接讀 `input.items.length`,
    //    舊版或竄改過的 client 沒送 `items` 時,**還沒進錯誤處理就 throw ⇒ 整支變 500**。
    //    移進來之後同一個 throw 會走下面的 catch,員工看到的是訊息不是白畫面。
    auditLog('shipment.submit', auth, 'attempt', {
      item_count: Array.isArray(input.items) ? input.items.length : -1,
      carrier_code: input.carrierCode ?? null,
      mark_shipped: input.markShipped === true,
      has_tracking_number: input.trackingNumber !== undefined,
    });
    // 🔴🔴 **箱子掛在誰身上,由 server 從「這批品項自己」推導,不收 client 送的客人 id。**
    //    第一版是把 `customerUserId` 當 input 收進來的 —— 那等於整條的唯一來源是瀏覽器裡的
    //    一個字串:改成另一位合法客人,`admin_create_shipment` 會**先替錯的人建出一個空箱**,
    //    要到 `admin_add_shipment_items` 才被 `pcm_b2_w3b2_item_not_customers` 擋下,
    //    而那時箱子已經在 DB 裡了(半成品,只能作廢)。
    //    ⇒ 現在改成從 `input.items` 反查:client 就算竄改品項清單,推出來的也是**那些品項真正的
    //      擁有者**,建箱與掛品項對得起來,構造不出跨客人的箱。
    // 🔴🔴 **跨檔依賴,寫下來是唯一讓下一個人知道的方法**(2026-08-16 與 C 窗對過檔名時查出來的)。
  //    下面「恰好一位客人才建箱」的擋法,正確性**依賴 `shipment-repository` 的 fail-closed**:
  //    `listCustomerUserIdsByOrderItemIds` 在有任何品項查不到(含 PostgREST 1000 列靜默截斷)時
  //    **回空 Set**,於是走到「查無擁有者 → 拒絕」那條。
  //    ⚠️ 那裡若哪天改成 fail-open(拿查得到的那幾筆「湊」一位客人),
  //       **本處會靜默退化成放行** —— 而這裡的 code 一個字都不用改、測試也不會紅。
  //    ⇒ 測試檔有一格釘住那個性質(見「跨檔依賴」那格),改動那支 repository 時它會紅。
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

    auditLog('shipment.submit', auth, 'ok', { shipment_id: created.shipmentId });
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
    auditLog('shipment.submit', auth, 'fail', { shipment_id: reference });
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

// ═══════════════════════════════════════════════════════════════════════════
//  🔴 授權閘(Q-AUDIT-1 A1,Sean 2026-08-16 批 `Q-AUDIT-1a`=甲「被擋是對的」)
//
//  為什麼本檔需要:本檔是 §3.2 矩陣裡**唯一**沒有 `authorizeAdminMutation` 的業務檔,
//  而它呼叫的五支 RPC 也是**唯一**零 `admin_audit_log` 的一組
//  ⇒ 出貨線是全站**唯一兩層都沒有留痕**的路徑
//  (`docs/security/2026-08-16-security-audit-run1-phase2-hunt.md` §6.2)。
//
//  🔴 **這不是權限修補** —— 存取控制沒有失守(`proxy.ts` 仍擋未登入、外部呼不到)。
//     它補的是**事後查得出來**:「誰把那筆出貨作廢的」現在才有地方答。
//
//  ⚠️ **而「答得出誰」還沒到** —— `authorizeAdminMutation` 的 `actorId` 來自
//     `getSessionActor()`,那是**使用者自己從下拉挑的、系統不驗證**
//     (`session/actor.ts` 自陳「這不是登入 / 授權邊界」)。
//     ⇒ **本片讓出貨線與其他七條線【一致】,不是讓它變成可信。**
//     真登入線(E8-B)上線後,**本檔不用改一行**,`actorId` 自動變成真的。
//     🔴 **驗收文案不得寫「現在可以查出是誰做的」**,只能寫
//        「現在有紀錄了;記的是誰,取決於真登入線」。
//
//  ── 形狀:回傳失敗物件(**這【不是】偏離慣例,我原本寫錯了**)──────────────
//  🔴 原註解寫「其他 15 支用 `redirect(...)`,本檔刻意偏離」——**那句是假的**,
//     code-reviewer 2026-08-16 抓到。當場重量(看閘失敗那一行做什麼):
//       redirect  keyword-search ×2 / wallet / tier / profile / order / amount …
//       return    refund / refund-recovery / receipt / procurement / note …
//     ⇒ **兩種形狀本來就並存**,回傳失敗物件是既有做法之一,不需要「刻意偏離」的辯護。
//     量法(自己重跑,不要抄結論):
//       for f in $(git grep -ln "await authorizeAdminMutation" -- 'apps/admin/src/lib/**/*.ts' | grep -v test); do
//         printf "%-8s %s\n" "$(grep -A2 "await authorizeAdminMutation" "$f" | grep -oE 'redirect|return' | head -1)" "$f"; done
//  📎 **這個錯的形狀值得記**:我為一個「不需要辯護的選擇」寫了一段辯護,
//     而那段辯護裡有一個**沒量過的數字**。**辯護本身就是它需要被檢查的訊號。**
//
//  **選回傳而不是 redirect 的實際理由(這個仍然成立)**:
//  它們是**彈窗**的 action,`redirect` 會**把員工剛打的收件人/單號整批丟掉**。
//  **擋的效果兩者相同** —— 都在做任何事之前就 return。
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 沒有具名 actor 時給員工看的話。
 *
 * 🔴 **不寫「這個動作會記在稽核紀錄上」** —— 原版那樣寫,而**那是給使用者看的假字面**:
 *    本片(A1)只加閘,**一列 `admin_audit_log` 都沒有寫**;DB 層的稽核列是 A2 的事。
 *    ⇒ 承諾一個還不存在的東西,而員工沒有任何辦法發現它不存在。
 *
 * ⚠️ **也不寫「權限不足」** —— `authorizeAdminMutation` 三條路都回 `null`
 *    (`session/authorize.ts:30-33`:session 無效 / Origin 被拒 / 無 actor),
 *    而只有第三條是「選一下就好」。前兩條選了也沒用。
 *    ⇒ 訊息**同時給出兩條出路**,不要讓員工在唯一一條上鬼打牆。
 */
const NO_ACTOR_MESSAGE =
  '請先在右上角選擇操作人員,再送出一次。' +
  '(若已經選過還是看到這則訊息,請重新整理頁面或重新登入 —— 那表示這次的連線沒被認出來。)';

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
  const auth = await authorizeAdminMutation();
  if (auth === null) return { ok: false, message: NO_ACTOR_MESSAGE };
  auditLog('shipment.void', auth, 'attempt', { shipment_id: args.shipmentId });
  try {
    await voidShipment(args);
    revalidatePath('/orders');
    auditLog('shipment.void', auth, 'ok', { shipment_id: args.shipmentId });
    return { ok: true };
  } catch (e) {
    auditLog('shipment.void', auth, 'fail', { shipment_id: args.shipmentId });
    return { ok: false, message: toMessage(e) };
  }
}

/** 復原作廢(片 2c)。 */
export async function unvoidShipmentAction(args: {
  idempotencyKey: string;
  shipmentId: string;
}): Promise<VoidResult> {
  const auth = await authorizeAdminMutation();
  if (auth === null) return { ok: false, message: NO_ACTOR_MESSAGE };
  auditLog('shipment.unvoid', auth, 'attempt', { shipment_id: args.shipmentId });
  try {
    await unvoidShipment(args);
    revalidatePath('/orders');
    auditLog('shipment.unvoid', auth, 'ok', { shipment_id: args.shipmentId });
    return { ok: true };
  } catch (e) {
    auditLog('shipment.unvoid', auth, 'fail', { shipment_id: args.shipmentId });
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
  const auth = await authorizeAdminMutation();
  if (auth === null) return { ok: false, message: NO_ACTOR_MESSAGE };
  auditLog('shipment.mark_shipped', auth, 'attempt', { shipment_id: args.shipmentId });
  try {
    await markShipmentShipped(args);
    revalidatePath('/orders');
    auditLog('shipment.mark_shipped', auth, 'ok', { shipment_id: args.shipmentId });
    return { ok: true };
  } catch (e) {
    auditLog('shipment.mark_shipped', auth, 'fail', { shipment_id: args.shipmentId });
    return { ok: false, message: toMessage(e) };
  }
}
