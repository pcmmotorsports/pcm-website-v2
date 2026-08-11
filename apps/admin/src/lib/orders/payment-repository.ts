import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import type { OrderPaymentRow } from './payment-list-view';

// payment-repository.ts — M-4b E10 #15:收款兩支 RPC 的唯一呼叫端。
//   · B2-a(讀):`admin_list_order_payments`
//   · B2-b(寫):`admin_record_manual_payment`(`20260810200000`,OP5)
//
// ✅ **型別縫已拆**(2026-08-11 晚):B1(`20260811090000`)apply 後重 gen,
//    `admin_list_order_payments` 進了 `database.types.ts` ⇒ 這裡改回**具名 `.rpc()`**,
//    區域型別與 cast 一併刪除(原本那個縫只是讓編譯器閉嘴,證明不了回傳形狀)。
// 🔴 **`parseRow` 刻意留著,不因為「現在有型別了」就拿掉**:
//    生成型別說的是「schema 長這樣」,不是「這次回來的真的長這樣」
//    (它連 null 都常常標錯 —— 同檔頭記著 22 處手動校正)。
//    這支 RPC 的 `Returns` 是 `Json`,型別層對每一列的形狀**零保證**,
//    唯一的把關就是下面的執行期 fail-closed。
//
// 🔴 **授權誠實話**:讀路徑上**沒有管理員檢查**可以靠。
//    `session/actor.ts:5-7` 與 `components/orders/order-detail-route.tsx:110-111` 兩處**逐字自陳**
//    actor cookie「不是登入/授權邊界」;`authorizeAdminMutation` 只服務 action(寫)。
//    讀路徑真正唯一的閘 = `apps/admin/src/proxy.ts:38-49` 的**全域登入閘,無角色檢查**。
//    ⇒ **任何登入後台的人都讀得到任何一單的收款明細**。這是現況、不是本片造成的,
//      但本片第一次把它變成畫面上的資料。

export class PaymentListShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentListShapeError';
  }
}

function str(v: unknown, field: string): string {
  if (typeof v !== 'string') {
    throw new PaymentListShapeError(`admin_list_order_payments:${field} 不是字串`);
  }
  return v;
}

function nullableStr(v: unknown, field: string): string | null {
  // 🔴 `null`(SQL NULL,欄位在、真的沒值)與 `undefined`(**鍵根本不存在**)是兩件事:
  //    後者代表欄位被改名/沒回來 ⇒ 與 `str` 同樣拋,才對得上 :57「缺欄 ⇒ 拋」那句。
  //    收斂成 null 的話,B1 哪天改鍵名,每一筆都會靜默畫成「無備註」而**全綠**。
  if (v === null) return null;
  if (typeof v !== 'string') {
    throw new PaymentListShapeError(`admin_list_order_payments:${field} 不是字串或 null`);
  }
  return v;
}

/**
 * 逐欄驗形狀。
 *
 * 🔴 **不得寬容**:這是錢的帳。少一個欄位、型別不對 ⇒ 拋,由呼叫端顯示「讀取失敗」。
 *    靜默補預設值會讓「讀錯」長得跟「真的是這樣」一模一樣 —— 那是 #352 學過最貴的失敗形狀。
 * 🔴 `amount` 要 `Number.isSafeInteger`:欄位是 int4 **整數元**,浮點或非整數代表管線壞了。
 * 🔴 `isReversal` 只收真 boolean:收到別的東西就是契約變了,**不要**用 truthy 判斷矇混過去
 *    (它正是「不准看金額正負」那條規則的唯一依據)。
 */
function parseRow(raw: unknown, index: number): OrderPaymentRow {
  if (typeof raw !== 'object' || raw === null) {
    throw new PaymentListShapeError(`admin_list_order_payments:第 ${index} 列不是物件`);
  }
  const r = raw as Record<string, unknown>;
  const amount = r.amount;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) {
    throw new PaymentListShapeError(`admin_list_order_payments:第 ${index} 列的 amount 不是整數`);
  }
  const isReversal = r.is_reversal;
  if (typeof isReversal !== 'boolean') {
    throw new PaymentListShapeError(
      `admin_list_order_payments:第 ${index} 列的 is_reversal 不是 boolean`,
    );
  }
  return {
    id: str(r.id, `第 ${index} 列的 id`),
    rail: str(r.rail, `第 ${index} 列的 rail`),
    amount,
    receivedAt: str(r.received_at, `第 ${index} 列的 received_at`),
    createdAt: str(r.created_at, `第 ${index} 列的 created_at`),
    actor: str(r.actor, `第 ${index} 列的 actor`),
    bankReference: nullableStr(r.bank_reference, `第 ${index} 列的 bank_reference`),
    recTradeId: nullableStr(r.rec_trade_id, `第 ${index} 列的 rec_trade_id`),
    payerNote: nullableStr(r.payer_note, `第 ${index} 列的 payer_note`),
    reversesPaymentId: nullableStr(r.reverses_payment_id, `第 ${index} 列的 reverses_payment_id`),
    reversalReason: nullableStr(r.reversal_reason, `第 ${index} 列的 reversal_reason`),
    isReversal,
  };
}

/**
 * 列出一張單的收款列(新的在上,排序由 RPC 保證)。
 *
 * 🔴 **三個回傳意義不同,呼叫端必須分開處理**(RPC 檔頭同款):
 *   · `null`  = **這張訂單不存在**;
 *   · `[]`    = 訂單在、但還沒有任何收款列;
 *   · `throw` = **沒讀到**(權限/連線/形狀不符)—— 這**不是**「沒有收款」。
 *
 * 三者若被畫成同一個「尚無收款」,員工會照著再登一次 ⇒ **重複入帳**。
 * (同 #328 的形狀:「讀取失敗」與「真的沒有」輸入長得一模一樣,只能靠這裡分。)
 */
export async function listOrderPayments(orderId: string): Promise<OrderPaymentRow[] | null> {
  const client = createSupabaseServiceClient();
  const { data, error } = await client.rpc('admin_list_order_payments', { p_order_id: orderId });

  if (error) {
    throw new Error(
      `admin_list_order_payments 讀取失敗(${String(error.code ?? 'no-code')}):${String(
        error.message ?? '',
      ).slice(0, 200)}`,
    );
  }
  // SQL NULL → 訂單不存在。**不可**收斂成 `[]`。
  if (data === null || data === undefined) return null;
  if (!Array.isArray(data)) {
    throw new PaymentListShapeError('admin_list_order_payments:回傳既不是陣列也不是 null');
  }
  return data.map((row, i) => parseRow(row, i));
}

// ────────────────────────────────────────────────────────────────────────────
// B2-b:寫入(`admin_record_manual_payment`)
// ────────────────────────────────────────────────────────────────────────────

/**
 * RPC 拒收本次呼叫。**帶著 SQLSTATE 上去**,由 `paymentFailureCodeFor` 逐碼映射成給員工的話。
 *
 * 🔴 **不在這裡翻譯成人話**:翻譯表住在 `payment-action-state.ts`(client 也 import 得到),
 *    這裡只負責「把碼誠實帶出去」。碼掉了就再也回不來 —— 具名碼一旦被收斂成 `Error`,
 *    下游只剩「稍後再試」可以說,而那正是 #371 的症狀。
 */
export class PaymentWriteError extends Error {
  readonly sqlstate: string | null;
  constructor(sqlstate: string | null, message: string) {
    super(message);
    this.name = 'PaymentWriteError';
    this.sqlstate = sqlstate;
  }
}

/**
 * 🔴🔴 **這筆錢已經寫進去了,只是我讀不懂 RPC 回什麼**(opus R2 MF2)。
 *
 * 為什麼**不可以**沿用讀路徑的 `PaymentListShapeError`:那個類別的語意是「沒讀到」,
 * 下游看到它會給「沒有寫入」那句話 —— 而本類別發生的時點是 **RPC 已經 COMMIT 之後**
 * (`parseRecordResult` 只在 `error == null` 的路徑上跑)⇒ 錢在帳上、畫面卻說沒寫,
 * 員工會再登一次:**新的一次送出會帶新的 request_id ⇒ G8 擋不到 ⇒ 重複入帳**。
 *
 * ⇒ 呼叫端(B2-b2 / B2-c)接到本類別**只准**給 `'error'` 那句文案
 *   (「可能已經寫進去了,先重新整理確認」),不得給 `'bug'`(那句逐字說「沒有寫入」)。
 */
export class PaymentWroteButUnreadableError extends Error {
  /** 給呼叫端做分派用的明確旗標(比 `instanceof` 跨模組邊界更耐得住)。 */
  readonly wrote = true;
  constructor(message: string) {
    super(message);
    this.name = 'PaymentWroteButUnreadableError';
  }
}

export type ManualPaymentOutcome = {
  paymentId: string;
  /** 同鍵同內容的冪等重放(RPC G8)⇒ 那筆收款**已經在帳上**,不是這次寫的。 */
  idempotent: boolean;
};

/**
 * 登錄一筆手動收款。
 *
 * 🔴 **兩條軌各自組一份具名 args**(不是一份大物件塞可有可無的鍵):
 *    `p_bank_reference` / `p_payer_note` 在 `20260810200000:113-114` 是 **`DEFAULT NULL`**
 *    (座標被點名兩輪才改對 —— opus R2 nit4 我只改了另一處同族字面、漏了這一處,Fable R4 再抓一次),
 *    生成型別對應 `p_xxx?: string`(選填、**不是** `| null`)
 *    ⇒ 值為 null 時**把那個鍵整個省掉**(下面的條件式 spread 就是在做這件事),
 *    語意等於 DEFAULT NULL。⇒ **不需要**為這兩個參數新增生成型別的 `| null` 手動校正。
 *    ⚠️ 現金軌連 `p_bank_reference` 這個鍵都不存在 —— 型別上就送不出「現金軌帶單號」。
 * 🔴 **`received_at` 由呼叫端算好送進來**(`buildReceivedAt`):兩軌構造方式不同、且都不碰裝置時區。
 */
export async function recordManualPayment(args: {
  orderId: string;
  requestId: string;
  actor: string;
  amount: number;
  receivedAt: string;
  payerNote: string | null;
} & (
    // 🔴 匯款軌的單號**型別上就是必填**(關卡2 codex MF2):RPC `20260810200000:181-183`
    //    對「匯款軌沒單號」是無 ERRCODE 的通用 RAISE ⇒ 讓它編譯不過,比讓它換一句含糊的錯誤好。
    | { rail: 'bank_transfer'; bankReference: string }
    | { rail: 'cash' }
  )): Promise<ManualPaymentOutcome> {
  const client = createSupabaseServiceClient();
  const base = {
    p_order_id: args.orderId,
    p_request_id: args.requestId,
    p_actor: args.actor,
    p_amount: args.amount,
    p_received_at: args.receivedAt,
  };
  const { data, error } =
    args.rail === 'cash'
      ? await client.rpc('admin_record_manual_payment', {
          ...base,
          p_rail: 'cash',
          ...(args.payerNote === null ? {} : { p_payer_note: args.payerNote }),
        })
      : await client.rpc('admin_record_manual_payment', {
          ...base,
          p_rail: 'bank_transfer',
          p_bank_reference: args.bankReference,
          ...(args.payerNote === null ? {} : { p_payer_note: args.payerNote }),
        });

  if (error) {
    const code = typeof error.code === 'string' ? error.code : null;
    throw new PaymentWriteError(
      code,
      `admin_record_manual_payment 拒收(${code ?? 'no-code'}):${String(error.message ?? '').slice(
        0,
        200,
      )}`,
    );
  }

  return parseRecordResult(data);
}

/**
 * 成功 payload 的形狀驗證。
 *
 * 🔴 **形狀不完整 ⇒ 拋 `PaymentWroteButUnreadableError`**(plan §3.2、codex must-fix #10;
 *    類別的選擇是 opus R2 MF2:**本函式只在已 COMMIT 之後跑**,拋的東西必須把這件事帶出去)。
 * 🔴 **不得因為 `error == null` 就宣告成功**。
 *    RPC 只有兩個 RETURN 出口(`20260810200000:281-282` 冪等 / `:310-311` 首次),
 *    兩個都給 `{recorded, idempotent, payment_id}` 三鍵 ⇒ 收到別的形狀代表契約變了或有人改了函式。
 * 🔴 **`recorded` 必須逐字是 `true`**:那是 RPC 對「這筆真的落帳了」的唯一宣稱;
 *    收到 `false` 卻當成功,就是「錢沒記進去但畫面說記了」——#352 學過最貴的形狀。
 * ⚠️ 這裡**不驗 `payment_id` 是不是 uuid 字面**:它由 `RETURNING id` 來、型別是 uuid,
 *    再寫一份格式規則會變第二真相;只驗「是非空字串」= 拿得到就能拿去查。
 */
function parseRecordResult(raw: unknown): ManualPaymentOutcome {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PaymentWroteButUnreadableError('admin_record_manual_payment:回傳不是物件');
  }
  const r = raw as Record<string, unknown>;
  if (r.recorded !== true) {
    throw new PaymentWroteButUnreadableError(
      `admin_record_manual_payment:recorded 不是 true(拿到 ${JSON.stringify(r.recorded)})`,
    );
  }
  if (typeof r.idempotent !== 'boolean') {
    throw new PaymentWroteButUnreadableError('admin_record_manual_payment:idempotent 不是 boolean');
  }
  if (typeof r.payment_id !== 'string' || r.payment_id === '') {
    throw new PaymentWroteButUnreadableError('admin_record_manual_payment:payment_id 不是非空字串');
  }
  return { paymentId: r.payment_id, idempotent: r.idempotent };
}
