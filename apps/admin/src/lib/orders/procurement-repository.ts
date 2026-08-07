import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import type { ProcurementReplyStatus } from './procurement-form';

// procurement-repository.ts — M-4b E10 A10b:`admin_upsert_item_procurement` owner RPC 的唯一呼叫端。
//
// 🔴 稽核由 RPC **同交易**寫(`20260803160000:426`-`:450` 步 12),本層不碰 `admin_audit_log`
//    ⇒ 沒有「主資料成功但稽核失敗」的窗口,不要照 staff 補一個 audit 呼叫回來。
//
// 🔴 **17 碼窮盡收斂**(memory `feedback_null-dispatch-rpc-silently-downgrades`):
//    未知碼 / null 一律當呼叫端 bug 拋出,不得靜默當成功。這條在本片特別重要 ——
//    A5a 的 create/update 分流靠**列存在性**、不靠參數 NULL,所以它沒有 S2 那種
//    「弄丟 id 的改名靜默降級成新增」的形狀;但**回傳碼漂移**仍會讓「採購沒寫進去」長得跟成功一樣。

/** RPC 回的 17 個固定碼(`20260803160000:27-31` 檔頭逐字)。 */
export const PROCUREMENT_RESULT_CODES = [
  'CREATED',
  'UPDATED',
  'NO_CHANGE',
  'ORDER_ITEM_NOT_FOUND',
  'SUPPLIER_NOT_FOUND',
  'SUPPLIER_INACTIVE',
  'OVER_ALLOCATION',
  'ALLOCATED_BELOW_RECEIVED',
  'INVALID_INPUT',
  'INVALID_ALLOCATED',
  'INVALID_REPLY_STATUS',
  'INVALID_CONTACT_CHANNEL',
  'INVALID_SUPPLIER_ORDER_NO',
  'INVALID_EXCEPTION_REASON',
  'SUBMITTED_AT_OUT_OF_RANGE',
  'SUBMITTED_AT_IN_FUTURE',
  'EXPECTED_ARRIVAL_OUT_OF_RANGE',
] as const;

export type ProcurementResultCode = (typeof PROCUREMENT_RESULT_CODES)[number];

const RESULT_CODE_SET = new Set<string>(PROCUREMENT_RESULT_CODES);

/**
 * 呼叫端契約違反 —— 員工看到的訊息叫他停手、先重新整理確認,不是「稍後再試」。
 */
export class ProcurementCallerBugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProcurementCallerBugError';
  }
}

/**
 * 🔴 **RPC 的 RAISE 面有兩個 SQLSTATE,兩個都當呼叫端 bug**(逐條對照 migration `:32`):
 *   ① `P0001` = actor(`:189-197`)/ request_id(`:200-208`)缺失或非法 + 常數自檢 + 兩圈未收斂的防衛枝
 *      **+ preserve 的三道閘**(A9h-M `20260806200000`):步 1n 旗標本身是 null(三值邏輯會靜默降級成
 *      不保留)、步 1p 矛盾意圖(`preserveOptionalFields: true` 卻同時送了 submittedAt /
 *      supplierOrderNo / exceptionReason / expectedArrivalDate 任一非 null)、
 *      步 5p 保留模式下 contactChannel 留空(正規化後為空亦算)。
 *      🔴 新增這個來源**不需要改下面的判別式**(它只看 `code`)—— 但這行枚舉必須跟上,
 *      否則它會從「誠實邊界」退化成「過期的宣稱」。
 *   ② `P2B02` = 隔離閘(`:170-175`:非 read committed 拒收)。
 *
 * 🔴 **`P2B01` 刻意不列**:那是 A2b1 的總量守門,A5a 自己 catch 起來翻成 `OVER_ALLOCATION`
 *    固定碼(`:368-377` / `:398-403`)⇒ 走到 JS 層的 P2B01 代表**它沒被翻譯**,
 *    那才是真的異常、應該落進通用 `error`(而不是被我在這裡認領成「已知的呼叫端 bug」)。
 *
 * ⚠️ **誠實邊界**:判別式只看 `code`,不看訊息。`P0001` 在這條呼叫路徑上的來源理論上只有本 RPC
 *    (`order_item_procurement` 的 trigger 用的是 P2B01/P2B02 具名 SQLSTATE),但本片**沒有**
 *    像 A9d2-1 那樣去逐一親驗全部 trigger ⇒ 不宣稱「唯一來源」,只宣稱「當 bug 處理是 fail-closed 的」。
 */
function isRpcRaise(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'P0001' || code === 'P2B02';
}

/**
 * 查這個品項屬於哪一張訂單。查無 → null。
 *
 * 🔴 **為什麼要多這一次往返**(關卡2 codex R2 MF4):表單的 `order_id` 是 hidden 欄、
 *    RPC 只認 `order_item_id` ⇒ 兩者不一致時會「**從 A 單的表單寫進 B 單的品項**」,
 *    而畫面跳回 A 單、A 單還不 revalidate。動手的人雖然本來就有權改任一張單,
 *    但「以為在改這張、其實改到那張」是靜默的資料錯置,不是權限問題。
 *    ⇒ 寫入前用 PK 查一次(單列、有索引),不一致就當呼叫端 bug 擋掉。
 */
export async function findOrderIdForItem(orderItemId: string): Promise<string | null> {
  const { data, error } = await createSupabaseServiceClient()
    .from('order_items')
    .select('order_id')
    .eq('id', orderItemId)
    .maybeSingle();
  if (error) throw error;
  return data?.order_id ?? null;
}

export interface UpsertItemProcurementArgs {
  orderItemId: string;
  supplierId: string;
  allocatedQuantity: number;
  replyStatus: ProcurementReplyStatus;
  contactChannel: string | null;
  /**
   * 🔴 **帶 `+08:00` 偏移的 ISO,由 server 端補**(A5a 契約 `20260803160000:475-476`:
   * 「submitted_at 的 offset 由 server 補 Asia/Taipei」)。呼叫端收到的是無偏移的台北牆上時間,
   * 換算在 `procurement-actions.ts`,不在瀏覽器 —— 用裝置時區換算會讓非台北機器靜默存錯時刻。
   */
  submittedAt: string | null;
  supplierOrderNo: string | null;
  exceptionReason: string | null;
  /** `YYYY-MM-DD`(date 欄,無時區) */
  expectedArrivalDate: string | null;
  actor: string;
  /**
   * 🔴 **稽核關聯 id、不是冪等鍵**(親驗 migration 全檔:只寫進 `admin_audit_log.request_id`,
   *    零唯一性約束、零「同 id 不同內容」比對)。冪等來自業務鍵 upsert 與同值 no-op
   *    ⇒ 每次送出用新的 HTTP `x-request-id` 是對的,不要照 A6 搬表單 token 過來。
   */
  requestId: string;
  /**
   * 🔴 **保留模式**(A9h-M `20260806200000`)。**必填、無預設** —— 每個呼叫端都必須自己表態,
   *    漏帶是型別紅而不是靜默走 DB 的 `DEFAULT false`。
   *
   * `false` = 全量 payload(明細頁單列表單):四個選填欄送什麼就寫什麼、**送 null 就是清空**。
   * `true`  = 批次(A9h)沒有那四欄的入口 ⇒ 保留該列現值。
   *    🔴 此時那四欄**必須全部送 null**,否則 RPC 判定矛盾意圖並 RAISE(→ `ProcurementCallerBugError`)。
   *    🔴 **且 `contactChannel` 必須非空**(Sean 2026-08-06 拍板;migration 步 5p):
   *       它**不在**保留集合裡(批次共用欄、員工會選)⇒ 送 null 會**清掉各列既有管道**,
   *       與那四欄是同一種病 ⇒ 由 DB 層 RAISE,不靠批次 UI 自律。
   *       正規化後為空(例:`'   '`)一樣算沒送。
   */
  preserveOptionalFields: boolean;
}

/**
 * 寫一筆採購(upsert;鍵 = `(order_item_id, supplier_id)`)。回 17 碼之一;RAISE → CallerBugError。
 *
 * 🔴 **逐欄具名送、不 spread**:TS 的多餘屬性檢查只作用在物件字面上,spread 會把不該有的欄位
 *    靜默帶進去(`supplier-repository.ts:108-111` 有完整前例)。
 * 🔴 **全量 payload**:每個選填欄都要送(null 也要送),漏送一欄不是「不動它」而是型別紅 ——
 *    這正是 `database.types.ts` 那些 `| null` 手動校正要保護的東西。
 * 🔴 **`preserveOptionalFields: true` 時語意不同**(A9h-M):那四欄的 null **不是清空、是保留**。
 *    「送 null = 清空」只在 `false` 下成立 —— 這行以前是無條件寫的,現在不是。
 *    ⚠️ `true` 另有一條**必填**約束(`contactChannel` 不得為空)—— 逐字見
 *    `UpsertItemProcurementArgs.preserveOptionalFields` 的 JSDoc,此處不重述免兩份漂移。
 */
export async function upsertItemProcurement(
  args: UpsertItemProcurementArgs,
): Promise<ProcurementResultCode> {
  const { data, error } = await createSupabaseServiceClient().rpc(
    'admin_upsert_item_procurement',
    {
      p_order_item_id: args.orderItemId,
      p_supplier_id: args.supplierId,
      p_allocated_quantity: args.allocatedQuantity,
      p_reply_status: args.replyStatus,
      p_contact_channel: args.contactChannel,
      p_submitted_at: args.submittedAt,
      p_supplier_order_no: args.supplierOrderNo,
      p_exception_reason: args.exceptionReason,
      p_expected_arrival_date: args.expectedArrivalDate,
      p_actor: args.actor,
      p_request_id: args.requestId,
      p_preserve_optional_fields: args.preserveOptionalFields,
    },
  );

  if (error) {
    if (isRpcRaise(error)) {
      throw new ProcurementCallerBugError(
        `admin_upsert_item_procurement 拒收本次呼叫(${String(
          (error as { code?: unknown }).code,
        )}):${String(error.message).slice(0, 200)}`,
      );
    }
    throw error;
  }

  if (typeof data === 'string' && RESULT_CODE_SET.has(data)) {
    return data as ProcurementResultCode;
  }

  // 🔴 未知碼 / null:RPC 漂移。**不得**靜默當成功 —— 那會讓「採購沒寫進去」長得跟成功一樣。
  throw new ProcurementCallerBugError(
    `admin_upsert_item_procurement 回傳非預期碼:${JSON.stringify(data)}`,
  );
}
