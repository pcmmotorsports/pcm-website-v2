import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// receipt-repository.ts — M-4b E10 #352-b:`admin_record_item_receipt` 的唯一呼叫端。
//
// 🔴 稽核由 RPC **同交易**寫(`20260811010000` 步 10)⇒ 本層不碰 `admin_audit_log`。
//
// 🔴 **刪除那支(`admin_delete_item_receipt`)刻意不在本檔**(R1 nit 9、主視窗裁):
//    它在 DB 已經就緒,但本片沒有任何刪除入口 ⇒ 寫在這裡會是一段**從未執行過**的 code
//    進 commit。等刪除入口那片再一起寫、一起被測到。
//    ⚠️ 寫它的人注意:它有第三個 SQLSTATE **`P4A03`**(`a352a2_delete_below_shipped`),
//    那是**業務拒絕不是呼叫端 bug**,而且 DB 訊息已寫成白話、還逐箱列出未出貨的包裹編號與件數
//    (`20260810233000:429-433`)⇒ **原文帶給員工**,別在 app 層改寫成一句籠統的「刪不掉」。
//
// 🔴 **固定碼窮盡收斂**(同 `procurement-repository.ts` 的立場):未知碼 / null 一律當呼叫端 bug 拋,
//    不得靜默當成功 —— 「到貨沒記進去」長得跟成功一樣是本片最貴的失敗形狀
//    (instock 不動 ⇒ 出貨彈窗照樣說「未到貨」,而員工以為已經登錄了)。

/** `admin_record_item_receipt` 的固定碼(逐字取自 `20260811010000` 的 `RETURN '…'`,共 10 個)。 */
export const RECEIPT_RECORD_RESULT_CODES = [
  'RECORDED',
  'DUPLICATE_REQUEST',
  'EXCEEDS_ROOM_AFTER_CANCELLATION',
  'QUANTITY_EXCEEDS_ALLOCATED',
  'PROCUREMENT_NOT_FOUND',
  'INVALID_QUANTITY',
  'NOTE_TOO_LONG',
  'RECEIVED_AT_REQUIRED',
  'RECEIVED_AT_OUT_OF_RANGE',
  'RECEIVED_AT_IN_FUTURE',
] as const;

export type ReceiptRecordResultCode = (typeof RECEIPT_RECORD_RESULT_CODES)[number];

const RECORD_CODE_SET = new Set<string>(RECEIPT_RECORD_RESULT_CODES);

/** 呼叫端契約違反 —— 訊息要叫員工停手重新整理,不是「稍後再試」。 */
export class ReceiptCallerBugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptCallerBugError';
  }
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * 呼叫端 bug 型的 RAISE。
 *
 * 🔴 **兩支到貨 RPC 實查的 SQLSTATE 只有三個**(`grep ERRCODE` 兩檔 + 「無 USING 的 RAISE = P0001」):
 *   ① `P0001` = actor / request_id 形狀、常數自檢、不變式破損等防衛枝(兩支都有)
 *   ② `P2B02` = 隔離閘(非 read committed 拒收;`20260811010000:72`、`20260810233000:99`/`:320`)
 *   ③ `P4A03` = 只出現在刪除那支(本檔不呼叫;見檔頭)⇒ 不在本判別式。
 *
 * ⚠️ **誠實邊界**:只看 `code`、不看訊息;沒有逐一親驗過相關表的全部 trigger
 *    ⇒ 不宣稱「`P0001` 在這條路徑上唯一來源是本 RPC」,只宣稱當 bug 處理是 fail-closed 的。
 */
function isCallerBugRaise(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'P0001' || code === 'P2B02';
}

export interface RecordItemReceiptArgs {
  procurementId: string;
  /**
   * 到貨幾件。
   *
   * 🔴 **0 是合法值,不要在型別或表單上把它擋掉** —— `quantity=0 / surplus=N` 正是
   *    「這張單已經收滿/已取消,但供應商的貨還是到了」的登記方式
   *    (a1 `20260810230000:82` 逐字)。兩道額度守門
   *    (採購列層 `20260811010000:193`、品項層 `:245`)都**只看本欄、不看 surplus**
   *    ⇒ 到貨填 0 就通得過。把本欄設成必填正整數會讓那條路在 UI 上直接死掉。
   */
  quantity: number;
  /** 溢收幾件(Sean Q1=A 的「乙」)。不進 `received_quantity` / `instock`,只留紀錄。 */
  surplusQuantity: number;
  /**
   * 到貨時刻。🔴 **帶偏移的 ISO、由 server 端補 Asia/Taipei**(同 A5a `submittedAt` 的理由:
   * 用裝置時區換算會讓非台北機器靜默存錯時刻)。
   */
  receivedAt: string;
  note: string | null;
  actor: string;
  /**
   * 🔴 **這支的 `p_request_id` 是真的冪等鍵,不是稽核關聯 id** ——
   *    與 `admin_upsert_item_procurement` 相反(那支只寫進 audit log、零唯一性約束)。
   *    本支有 `order_item_receipt_requests` 冪等帳:同鍵同內容回 `DUPLICATE_REQUEST`、
   *    同鍵不同內容 RAISE。⇒ **必須由表單一次性產生並隨表單送出**,
   *    不可每次 render 重產、也不可拿每次的 HTTP request id ——
   *    那會讓重送變成新請求、冪等失效(plan §5.1 逐字)。
   *
   * 形狀限制(`20260811010000:101-103`):可列印 ASCII、無空白、**全小寫**、≤200。
   */
  requestId: string;
}

/**
 * 記一筆到貨。回 10 碼之一;RAISE → `ReceiptCallerBugError`。
 *
 * 🔴 逐欄具名送、不 spread(TS 多餘屬性檢查只作用在物件字面上)。
 */
export async function recordItemReceipt(
  args: RecordItemReceiptArgs,
): Promise<ReceiptRecordResultCode> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_record_item_receipt', {
    p_procurement_id: args.procurementId,
    p_quantity: args.quantity,
    p_surplus_quantity: args.surplusQuantity,
    p_received_at: args.receivedAt,
    p_note: args.note,
    p_actor: args.actor,
    p_request_id: args.requestId,
  });

  if (error) {
    if (isCallerBugRaise(error)) {
      throw new ReceiptCallerBugError(
        `admin_record_item_receipt 拒收本次呼叫(${String(errorCode(error))}):${String(
          error.message,
        ).slice(0, 200)}`,
      );
    }
    throw error;
  }

  if (typeof data === 'string' && RECORD_CODE_SET.has(data)) {
    return data as ReceiptRecordResultCode;
  }

  throw new ReceiptCallerBugError(
    `admin_record_item_receipt 回傳非預期碼:${JSON.stringify(data)}`,
  );
}

/**
 * `DUPLICATE_REQUEST` 之後,那次登錄的產物**現在還在不在**。
 *
 * 🔴 **為什麼需要多這一次讀**:RPC 兩個 `DUPLICATE_REQUEST` 出口
 * (`20260811010000:183` 快篩 / `:283` 併發 `unique_violation`)**回的是同一個裸字串**,
 * 完全沒帶「產物還在嗎」這個資訊 —— 而 plan §5.1 要求這兩種情況給**不同文案**:
 *   · 產物還在 ⇒「這筆到貨先前已經登錄過了」(純安心話)
 *   · 產物已被刪 ⇒「先前登錄過,而且後來被刪除了 —— **沒有**重新建立」
 *     (RPC `:181` 逐字:產物被刪一樣回 DUPLICATE、**不重新 INSERT**,復活路徑不存在)
 * ⇒ 只回一個綠色的成功會讓員工以為貨記在帳上了,而實際上帳面是空的。
 *
 * 冪等帳列**不可刪**(a1 `:197-199` 只 GRANT SELECT)⇒ 查得到鍵就查得到 `receipt_id`;
 * 查不到鍵 = 呼叫端拿了一個從沒送成功過的鍵來問 ⇒ `'unknown'`,文案退回保守說法。
 *
 * ⚠️ 兩次都是 PK 查、且只在 `DUPLICATE_REQUEST` 這條**罕見**路徑上跑,不進正常成功路徑。
 */
export type ReceiptDuplicateOutcome = 'alive' | 'deleted' | 'unknown';

export async function findDuplicateOutcome(requestId: string): Promise<ReceiptDuplicateOutcome> {
  const client = createSupabaseServiceClient();

  const ledger = await client
    .from('order_item_receipt_requests')
    .select('receipt_id')
    .eq('request_id', requestId)
    .maybeSingle();
  if (ledger.error) throw ledger.error;

  const receiptId = ledger.data?.receipt_id;
  if (typeof receiptId !== 'string') return 'unknown';

  const receipt = await client
    .from('order_item_procurement_receipts')
    .select('id')
    .eq('id', receiptId)
    .maybeSingle();
  if (receipt.error) throw receipt.error;

  return receipt.data ? 'alive' : 'deleted';
}

/**
 * 這筆採購還能再登錄幾件(= `allocated − received`)。查無 → null。
 *
 * 🔴 **只用來組錯誤訊息裡的拆分建議**(plan §5.1 / R3-nit1:「`QUANTITY_EXCEEDS_ALLOCATED`
 *    由 app 算出拆分建議」),**不是守門** —— 守門在 RPC 裡、且在鎖之內
 *    (`20260811010000:193`,同交易讀 `v_proc`)。本讀在鎖外、可能已經過期,
 *    拿它去判斷「這次送得出去嗎」會是第二真相。
 *    ⇒ 只在 RPC **已經拒絕之後**跑,用來把「超過了」變成「填 N 件、多的 M 件放溢收」。
 */
export async function findProcurementRemaining(procurementId: string): Promise<number | null> {
  const { data, error } = await createSupabaseServiceClient()
    .from('order_item_procurement')
    .select('allocated_quantity, received_quantity')
    .eq('id', procurementId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data.allocated_quantity - data.received_quantity;
}
