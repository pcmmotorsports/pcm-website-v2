import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// manual-refund-read.ts — M-4b E10 D3:非卡退款帳本唯讀查詢(訂單頁登記列表)。
//
// 🔴 與 refund-read.ts(TapPay 帳本)刻意分檔,同 order_manual_refunds 建表 migration
//    (20260820010000)的紀律:「寫入 RPC 合約」與「純顯示投影」分檔,兩本帳的分界寫在
//    DB CHECK 裡,app 層的讀取路徑也不共用。
// 🔴 本表刻意沒有 status(D1 header 段:「記的是一件已經發生的事」)⇒ 投影裡沒有狀態欄,
//    也沒有 isRefundException 那類異常判定 —— 這張表沒有那個語意。

// 🔴 D3-c 加了三個作廢欄。**不加的話,作廢完畫面看起來一模一樣** ——
//    而 D3-b 的 UPDATE 只動這三欄,那一列的金額/理由/經手人全部原樣留著。
const ROW_COLUMNS =
  'id, rail, refund_amount, reason, actor, occurred_at, created_at, voided_at, void_reason, voided_by';

export type ManualRefundRow = {
  id: string;
  rail: string;
  refundAmount: number;
  reason: string;
  actor: string;
  /** 錢實際交回去的時刻(員工填)。 */
  occurredAt: string;
  /** 登記時刻(系統記)。 */
  createdAt: string;
  /** 🔴 非 null = 這筆登記已被作廢(D3-c)。作廢**不動錢**,它說的是「這筆登記本身記錯了」。 */
  voidedAt: string | null;
  voidReason: string | null;
  voidedBy: string | null;
};

type RawRow = {
  id: string;
  rail: string;
  refund_amount: number;
  reason: string;
  actor: string;
  occurred_at: string;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
  voided_by: string | null;
};

function toRow(raw: RawRow): ManualRefundRow {
  return {
    id: raw.id,
    rail: raw.rail,
    refundAmount: raw.refund_amount,
    reason: raw.reason,
    actor: raw.actor,
    occurredAt: raw.occurred_at,
    createdAt: raw.created_at,
    voidedAt: raw.voided_at,
    voidReason: raw.void_reason,
    voidedBy: raw.voided_by,
  };
}

/** 顯式上限 + truncated 旗標(同 refund-read.ts 的紀律:不帶 .limit 只是在平台的
 *  db-max-rows 被靜默截斷)。這張表每單筆數天生遠小於卡片退款帳本,先給一個保守值。 */
export const ORDER_MANUAL_REFUNDS_LIMIT = 100;

/** 某訂單的非卡退款登記列(新到舊;truncated=還有更舊的列沒顯示)。 */
export async function listOrderManualRefunds(
  orderId: string,
): Promise<{ rows: ManualRefundRow[]; truncated: boolean }> {
  const { data, error } = await createSupabaseServiceClient()
    .from('order_manual_refunds')
    .select(ROW_COLUMNS)
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(ORDER_MANUAL_REFUNDS_LIMIT + 1);
  if (error) throw error;
  const raw = data as RawRow[];
  return {
    rows: raw.slice(0, ORDER_MANUAL_REFUNDS_LIMIT).map(toRow),
    truncated: raw.length > ORDER_MANUAL_REFUNDS_LIMIT,
  };
}

/**
 * ⟦b4-PCM01RECORD⟧ 這張單在【現金 + 匯款】兩軌上還剩多少可退。
 *
 * 🔴🔴 **為什麼是問 DB, 而不是拿這一頁上已經有的數字自己算** ——
 *   訂單詳情頁**已經有** `payments` 與 `manualRefunds` 兩份資料 ⇒ 在 TS 這一側
 *   `sum(payments where rail in bank_transfer,cash) - sum(未作廢的 manualRefunds)` 是算得出來的。
 *   ⇒ 🛑 **而那樣做會錯, 兩個獨立的理由:**
 *   ① **`manualRefunds` 是【會被截斷】的**(`ORDER_MANUAL_REFUNDS_LIMIT = 100` + `truncated` 旗標)
 *      ⇒ 截斷之後那個減法【少扣了幾筆】⇒ 餘裕**看起來比實際多** ⇒ 而那正是「該標紅而沒標紅」。
 *      📌 **而它靜靜地錯** —— `truncated` 是另一個變數, 算價那一行不會去看它。
 *   ② **同一個公式會有兩份實作**(這裡一份、`pcm_manual_refund_rail_cap` 一份)
 *      ⇒ 而 DB 那一份才是 trigger 用來判「要不要出聲」的那一份
 *      ⇒ **兩份漂移的時候, 畫面會與那道閘不同意, 而沒有東西會紅。**
 *   ⇒ ⇒ **所以這裡呼叫【同一支函式】—— 兩邊用的是同一個公式, 不是兩份實作。**
 *   🛑 **而「從此不可能不一致」那句話我原本寫了, 它是假的**(codex R2⑥)——
 *      公式相同**不等於**答案相同。至少三條路會讓兩邊給出不同的結論:
 *        ① 兩次讀取是兩個快照(中間有人寫入)
 *        ② 這一趟傳輸失敗 ⇒ 本層 throw ⇒ 畫面收斂成「算不出上限」
 *        ③ 值超出 JS 安全整數 ⇒ 下面刻意回 `null`, 而 DB 端那個 bigint 是準的
 *      ⇒ 📌 而 ② ③ 就寫在本檔下面幾十行 —— **我在同一支檔裡先宣稱不可能, 再描述它怎麼發生。**
 *      ✅ 現行宣稱收窄成:**判準只有一份**(不會有人改了 DB 而畫面用舊公式)。
 *
 * 🔵 權限:`pcm_manual_refund_rail_cap` 只開給 `service_role`
 *   (`20260824010000:149-151` 先 `REVOKE` PUBLIC/anon/authenticated 再開)——
 *   而本檔用的正是 `createSupabaseServiceClient()`。
 *
 * ⚠️ **回 `null` 的意思是「算不出來」, 不是「0」** —— 呼叫端**不得**把它當 0:
 *   0 代表「一毛都不能再退」, 而 `null` 代表「我不知道」。**兩個世界要顯示不同的東西。**
 */
export async function readOrderManualRefundRailCap(orderId: string): Promise<number | null> {
  // 🔴🔴 **這個 `as never` 不是偷懶, 它指著一個【已經被記下來的缺口】** ——
  //   `packages/adapters/src/supabase/database.types.ts` 的檔頭逐字寫著:
  //   正式庫有而本檔沒有的具名區塊 **5 支**, 而 `pcm_manual_refund_rail_cap` **就是其中一支**;
  //   而它接著寫「🔴 **這些【都不是】手動校正** —— 生成器產得出它們, 它們只是**沒有人重 gen 過**」。
  //   ⇒ 📌 **所以正確的修法是【整支重 gen】, 而那已經是一片排著的工作 —— 不是在這裡手動補一段型別。**
  //   ⇒ ⇒ 手動補會讓那份「哪些是手工校正」的清單開始說謊, 而那個清單自己就在提醒這件事。
  // ⚠️ **而 `as never` 的代價要寫出來**:它把【函式名打錯】這一類錯誤從 typecheck 移到 runtime。
  //   ✅ 所以 `manual-refund-read.test.ts` 有一格專門釘那個字串與參數名(單元層補回那道守門)。
  const { data, error } = (await createSupabaseServiceClient().rpc(
    'pcm_manual_refund_rail_cap' as never,
    { p_order_id: orderId } as never,
  )) as { data: unknown; error: unknown };
  if (error) throw error;
  // 🔴 `bigint` 經 PostgREST 可能回字串 —— 而 `Number('')` 是 0、`Number(null)` 也是 0
  //    ⇒ 📌 **一個「算不出來」會靜靜變成「零元可退」, 而那是相反的意思。**
  //
  // 🔴🔴 **而「有限數字」這道尺【太寬】(codex 2026-09-02 must-fix ①,兩個實證輸入)**:
  //    ~~原本寫 `Number.isFinite(n) ? n : null`~~ **不夠**——
  //    · `'-1e-400'` ⇒ `Number()` 得 **`-0`** ⇒ `Number.isFinite(-0)` 是 true ⇒ 放行
  //      ⇒ 而畫面那一側判的是 `railCap < 0`, 而 **`-0 < 0` 是 `false`**
  //      ⇒ 🛑 **一個超額的世界完全不標紅, 而它一路全綠。**
  //    · `'-9223372036854775808'`(bigint 下界)⇒ 得 `-9223372036854775808` 但**已失真**
  //      ⇒ 畫面印出 `9,223,372,036,854,776,000` —— **那個數字不是任何人退的錢。**
  //    📌 **⇒ 這是 `number | null` 溜出來的第四態:是有限數字, 而不是可信的整數。**
  //
  // ✅ 現行判準:**字串只認純十進位整數字面**(bigint 經 PostgREST 一定長這樣),
  //    數字只認安全整數。⚠️ 而**超出安全整數 ⇒ 回 `null`(=算不出上限, 標紅找工程)**,
  //    **不是**回一個看起來很精確的近似值 —— 兩者的差別是有沒有人會去查。
  //
  // 🔵 **`+ 0` 那一下是在把 `-0` 正規化成 `0`**(不是裝飾):`Number('-0')` 得 `-0`,
  //    而 `Number.isSafeInteger(-0)` 是 `true` ⇒ 它會原樣流到畫面, 而 **`-0 < 0` 是 `false`**。
  //    ⇒ 這裡它其實**無害**(`-0` 與 `0` 是同一個金額, 兩者都該不標紅), 但留著會讓下一個
  //    寫 `railCap < 0` 以外判準的人踩到。⇒ 出口只給一種零。
  if (typeof data === 'number') return Number.isSafeInteger(data) ? data + 0 : null;
  if (typeof data === 'string') {
    const t = data.trim();
    // 🔴 這道正規式是**白名單**:`1e5` / `1.0` / `0x10` / `Infinity` / `-0.0` / `-1e-400`
    //    全部落在外面。黑名單(逐一排除已知壞形狀)會一直在跟下一個沒想到的形狀賽跑。
    if (!/^-?[0-9]+$/.test(t)) return null;
    const n = Number(t);
    return Number.isSafeInteger(n) ? n + 0 : null;
  }
  return null;
}
