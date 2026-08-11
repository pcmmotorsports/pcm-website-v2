import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import type { OrderPaymentRow } from './payment-list-view';

// payment-repository.ts — M-4b E10 #15-B2-a:`admin_list_order_payments` 的唯一呼叫端(唯讀)。
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
