import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// pending-refund-repository.ts — `pcm_pending_refund_amounts(uuid)` 的唯一呼叫端(讀)。
//
// RPC 本體:`supabase/migrations/20260902030000_m4b_crossrail_pending_refund_net.sql:64`
//   簽名 `RETURNS TABLE (rail text, amount bigint)`;ACL 同檔 `:197-200`
//   (三道 REVOKE + 只 GRANT `service_role`)⇒ **只能從 server 走 service client**。
//
// 🔴 **回傳【不含】淨額 ≤ 0 的軌**(同檔 `:89` `WHERE n.net > 0`)⇒
//    **空陣列 = 這一單沒有待退款**, 不是「讀失敗」。兩者的分別在下面那個 throw。
//
// 🔴 **不列舉 rail 的值域**:SQL 那半自己在 `:87` 逐字承認那份 `('bank_transfer'),('cash')`
//    是 `order_payments.rail` 的**手抄副本**, 而它已經有兩份不同步的風險。
//    ⇒ 這裡再抄第三份 = 新增一個「加第 4 條軌時會忘記改」的地方,
//      而它的失敗形狀是**整頁拋錯**。所以只驗「是非空字串」, 不驗它是哪一條。
//
// 🔴 **UI 那半刻意不做**:等 Sean 答 `⟦0a-CANCELGATEASKSWRONG⟧` 的乙。

export class PendingRefundShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PendingRefundShapeError';
  }
}

export type PendingRefundRail = { rail: string; amount: number };

/**
 * 🔴 **fail-closed**:形狀不對就拋, 不補預設值。
 *    這是錢的帳 —— 靜默補 0 會讓「讀錯」與「真的沒有待退款」長得一模一樣。
 */
function parseRow(raw: unknown, index: number): PendingRefundRail {
  if (typeof raw !== 'object' || raw === null) {
    throw new PendingRefundShapeError(`pcm_pending_refund_amounts:第 ${index} 列不是物件`);
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.rail !== 'string' || r.rail === '') {
    throw new PendingRefundShapeError(`pcm_pending_refund_amounts:第 ${index} 列的 rail 不是非空字串`);
  }
  // `bigint` 回到 JS 是 number;非整數代表管線壞了, 不是一個小一點的金額。
  if (typeof r.amount !== 'number' || !Number.isSafeInteger(r.amount)) {
    throw new PendingRefundShapeError(`pcm_pending_refund_amounts:第 ${index} 列的 amount 不是整數`);
  }
  return { rail: r.rail, amount: r.amount };
}

// 🔴 **型別縫, 只放寬 RPC 名字這一格**(不用 `any`、不 disable 任何檢查):
//    `database.types.ts` 是**生成**的, 而 `20260902030000` apply 之後**沒有人重生成過**
//    ⇒ 那份聯集裡查無這支函式(實測 `grep -c` 回 0)。
// 📌 **這個縫證明不了 RPC 存在, 它只是讓編譯器閉嘴** —— 所以名字另有一格測試釘著
//    (`pending-refund-repository.test.ts`「RPC 名字逐字對上 migration」)。
//    型別檔哪天重生成, 這一行與那個 cast 一起刪掉。
// 📌 **這筆債在板上有一列:`⟦0b-TYPESNOTREGEN⟧`**(`docs/launch-todo.md`)——
//    寫在那裡是因為【重生成型別檔的人不會打開這支檔】, 而他正是要刪掉這個 cast 的人。
export const PENDING_REFUND_RPC_NAME = 'pcm_pending_refund_amounts';

export async function listPendingRefundAmounts(orderId: string): Promise<PendingRefundRail[]> {
  const client = createSupabaseServiceClient();
  const { data, error } = await client.rpc(
    PENDING_REFUND_RPC_NAME as Parameters<ReturnType<typeof createSupabaseServiceClient>['rpc']>[0],
    { p_order_id: orderId } as never,
  );

  // 🔴 **錯誤不得收斂成空陣列** —— 那會把「讀不到」畫成「沒有待退款」,
  //    而那正是這個功能要防的那個方向。
  if (error) {
    throw new Error(
      `pcm_pending_refund_amounts 讀取失敗(${String(error.code ?? 'no-code')}):${String(
        error.message ?? '',
      ).slice(0, 200)}`,
    );
  }
  if (data === null || data === undefined) return [];
  if (!Array.isArray(data)) {
    throw new PendingRefundShapeError('pcm_pending_refund_amounts:回傳不是陣列');
  }
  return data.map(parseRow);
}
