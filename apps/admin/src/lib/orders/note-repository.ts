import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import type { NoteChannel, NoteType } from './note-form';

// note-repository.ts — M-4b E10 A9d2-1:`admin_append_order_note` owner RPC 的唯一呼叫端。
//
// 🔴 稽核由 RPC **同交易**寫(`20260802150000:180` 步 13),本層不碰 `admin_audit_log`
//    ⇒ 沒有 staff 那種「主資料成功但稽核失敗」的窗口,不要照 staff 補一個 audit 呼叫回來。
//
// 🔴 **14 碼窮盡收斂**(母 plan v4 §5;memory `feedback_null-dispatch-rpc-silently-downgrades`):
//    未知碼 / null 一律當呼叫端 bug 拋出,不得靜默當成功 —— 靠參數分流的 RPC 一旦漂移,
//    「靜默降級」的症狀就是零錯誤而事情沒發生。

/**
 * RPC 回的 14 個固定碼(`database.types.ts` 檔頭逐字;
 * 數法=`grep -n "回 14 固定碼" packages/adapters/src/supabase/database.types.ts`,落筆當下 `:170`)。
 */
export const NOTE_RESULT_CODES = [
  'APPENDED',
  'DUPLICATE_REQUEST',
  'ORDER_NOT_FOUND',
  'INVALID_INPUT',
  'INVALID_TYPE',
  'INVALID_CHANNEL',
  'CONTACT_FIELDS_REQUIRED',
  'INTERNAL_FIELDS_FORBIDDEN',
  'OCCURRED_AT_OUT_OF_RANGE',
  'OCCURRED_AT_IN_FUTURE',
  'INVALID_BODY',
  'BODY_TOO_LONG',
  'CORRECTS_NOT_FOUND',
  'ALREADY_CORRECTED',
] as const;

export type NoteResultCode = (typeof NOTE_RESULT_CODES)[number];

const RESULT_CODE_SET = new Set<string>(NOTE_RESULT_CODES);

/**
 * 呼叫端契約違反 —— 員工看到的訊息會叫他**停手、不要再按**(不是「稍後再試」)。
 * 🔴 差別是實質的:`order_notes` append-only,再按一次可能就是第二筆永久紀錄。
 */
export class OrderNoteCallerBugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderNoteCallerBugError';
  }
}

/**
 * 🔴 **`P0001` = 本 RPC 的 RAISE,一律當呼叫端 bug**(關卡1 Fable F4)。
 *
 * RPC 的 RAISE 到 JS 層是**被拋出的 `PostgrestError`**(`code === 'P0001'`),不是回傳碼。
 * 而樣板 `supplier-actions.ts:86-100` 對「非 CallerBugError 的 throw」一律歸成 `error`
 * (=「稍後再試」)⇒ 照樣板寫,A6 的兩處 RAISE 會落進 `error`:
 *   ①步 1 的參數面(actor / request_id 非法,`:134-156`)= 真正的呼叫端 bug;
 *   ②步 11 的冪等面(`:172`:request_id 已用過但**內容不符**)—— 那條若被說成「稍後再試」,
 *     員工會重載換一把新 token 再送一次 = **真的多一筆刪不掉的備註**,正是該 RAISE 要防的事。
 * ⇒ 兩者都是 caller-bug 語意,收斂一致。
 * 🔴 前提(Fable 複核時加驗):`order_notes` 建表零 trigger、本 RPC 只對 orders 取 `FOR UPDATE`
 *    不 UPDATE ⇒ **本呼叫路徑上 `P0001` 的唯一來源就是本 RPC**,判別式安全。
 */
function isRpcRaise(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P0001'
  );
}

export interface AppendOrderNoteArgs {
  orderId: string;
  noteType: NoteType;
  body: string;
  channel: NoteChannel | null;
  occurredAt: string | null;
  correctsNoteId: string | null;
  actor: string;
  /** 🔴 冪等鍵 = 表單帶回的一次性 token(Sean 拍板 Q2=C),**不是** HTTP `x-request-id` */
  requestToken: string;
}

/**
 * 寫一筆訂單備註。回 14 碼之一;RPC 的 RAISE → `OrderNoteCallerBugError`。
 *
 * 🔴 **逐欄具名送、不 spread**:S2 的契約債①教訓 —— TS 的多餘屬性檢查只作用在物件字面上,
 *    spread 會把不該有的欄位靜默帶進去(`supplier-repository.ts:108-111` 有完整前例)。
 */
export async function appendOrderNote(
  args: AppendOrderNoteArgs,
): Promise<NoteResultCode> {
  const { data, error } = await createSupabaseServiceClient().rpc(
    'admin_append_order_note',
    {
      p_order_id: args.orderId,
      p_note_type: args.noteType,
      p_body: args.body,
      p_channel: args.channel,
      p_occurred_at: args.occurredAt,
      p_corrects_note_id: args.correctsNoteId,
      p_actor: args.actor,
      p_request_id: args.requestToken,
    },
  );

  if (error) {
    if (isRpcRaise(error)) {
      throw new OrderNoteCallerBugError(
        `admin_append_order_note 拒收本次呼叫(P0001):${String(error.message).slice(0, 200)}`,
      );
    }
    throw error;
  }

  if (typeof data === 'string' && RESULT_CODE_SET.has(data)) {
    return data as NoteResultCode;
  }

  // 🔴 未知碼 / null:RPC 漂移。**不得**靜默當成功 —— 那會讓「備註沒寫進去」長得跟成功一樣。
  throw new OrderNoteCallerBugError(
    `admin_append_order_note 回傳非預期碼:${JSON.stringify(data)}`,
  );
}
