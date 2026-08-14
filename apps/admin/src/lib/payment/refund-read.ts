import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import {
  REFUND_EXCEPTION_STALL_MS,
  STUCK_MANUAL_VERDICT_FAILED_REASON,
} from './refund-ledger-view';

// refund-read.ts — M-3 A7c RW3:退款帳本唯讀查詢(訂單頁帳本區塊 + 異常清單頁)。
//
// 🔴 與 refund-repository.ts(寫入 RPC 合約)刻意分檔:那支的回傳碼窮盡收斂是動錢合約,
//    本檔是純顯示投影 —— 揉在一起會讓「改顯示」踩到已審過的錢面。
// 🔴 投影**零 rec_trade_id**(RW2b 顯示層慣例:`SupabaseOrderAdapter.ts:90` 同紀律);
//    RW4 人工對帳要 rec 時再開專用讀,不順手擴本投影。
// 🔴 「帳本未登記額」走 DB 函式 `pcm_order_refundable_remaining`(SECDEF、service_role
//    EXECUTE,`20260801120000` §7)—— 不在 app 端重算 SUM:S6 的 allowlist(哪些狀態佔額)
//    單一真相在函式本體,app 端複製一份就是下一次「新增狀態忘了回訪」的漂移點。

/** 單筆帳本列的顯示投影(欄序=畫面欄序;不含 rec_trade_id / request_id / bank_refund_id;
 *  也不含 tappay_refund_id / confirmed_at —— 畫面沒用到就不進投影,RW4 要對帳時開專用讀
 *  (opus R1:留著零消費欄=下一片的既成事實)。 */
export type OrderRefundRow = {
  id: string;
  kind: string;
  status: string;
  refundAmount: number;
  reason: string;
  actor: string;
  createdAt: string;
  failedReason: string | null;
  failedDetail: string | null;
  /** 有值 = TapPay 已受理過(G7-hold 證據);清單/警示只看有無,不顯示內容。 */
  providerEvidence: string | null;
};

const ROW_COLUMNS =
  'id, kind, status, refund_amount, reason, actor, created_at, failed_reason, failed_detail, provider_refund_id_evidence';

type RawRow = {
  id: string;
  kind: string;
  status: string;
  refund_amount: number;
  reason: string;
  actor: string;
  created_at: string;
  failed_reason: string | null;
  failed_detail: string | null;
  provider_refund_id_evidence: string | null;
};

function toRow(raw: RawRow): OrderRefundRow {
  return {
    id: raw.id,
    kind: raw.kind,
    status: raw.status,
    refundAmount: raw.refund_amount,
    reason: raw.reason,
    actor: raw.actor,
    createdAt: raw.created_at,
    failedReason: raw.failed_reason,
    failedDetail: raw.failed_detail,
    providerEvidence: raw.provider_refund_id_evidence,
  };
}

/**
 * 🔴 顯式上限+truncated 旗標(codex R1 MF1):Supabase 的 PostgREST 有 `max-rows=1000`,
 * 不帶 .limit **不是**「無截斷」而是「1000 筆處被平台靜默截斷」—— 顯式上限讓截斷可見
 * (house 慣例=AdminOrderDetail.notesTruncated)。取 N+1 判斷、回 N。
 */
export const ORDER_REFUNDS_LIMIT = 100;
export const REFUND_EXCEPTIONS_LIMIT = 200;
/**
 * 「卡住」那半的獨立上限(`#473b-2`)。刻意小於 ①類:它是**人判錯**才會產生的列,
 * 正常量應該接近 0;真的堆到這個數,truncated 橫幅本身就是要人去看的訊號。
 */
export const REFUND_STUCK_LIMIT = 50;

/** 某訂單的退款帳本列(新到舊;truncated=還有更舊的列沒顯示)。 */
export async function listOrderRefunds(
  orderId: string,
): Promise<{ rows: OrderRefundRow[]; truncated: boolean }> {
  const { data, error } = await createSupabaseServiceClient()
    .from('order_refunds')
    .select(ROW_COLUMNS)
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(ORDER_REFUNDS_LIMIT + 1);
  if (error) throw error;
  const raw = data as RawRow[];
  return {
    rows: raw.slice(0, ORDER_REFUNDS_LIMIT).map(toRow),
    truncated: raw.length > ORDER_REFUNDS_LIMIT,
  };
}

/**
 * 帳本未登記額(bigint 元)。🔴 這**不是**「還能退多少」—— 命名/顯示鐵律見
 * refund-ledger-view.ts 檔頭;查無訂單回 null(函式語意)。
 */
export async function getLedgerUnregisteredAmount(orderId: string): Promise<number | null> {
  const { data, error } = await createSupabaseServiceClient().rpc(
    'pcm_order_refundable_remaining',
    { p_order_id: orderId },
  );
  if (error) throw error;
  return data ?? null;
}

/** 異常清單列(跨訂單;帶 display_id 供連回訂單頁)。 */
export type RefundExceptionRow = OrderRefundRow & {
  orderId: string;
  orderDisplayId: string;
};

type RawException = RawRow & { order_id: string; orders: { display_id: string } | null };

/** 共用投影:embed 無空格 = house 字面(SupabaseOrderAdapter 八處同款)。 */
const EXCEPTION_SELECT = `${ROW_COLUMNS}, order_id, orders(display_id)`;

function toExceptionRow(row: RawException): RefundExceptionRow {
  return {
    ...toRow(row),
    orderId: row.order_id,
    // FK 保證有母單;防禦性 fallback 只為了不讓顯示層炸(顯示 id 前 8 碼可辨認)。
    orderDisplayId: row.orders?.display_id ?? row.order_id.slice(0, 8),
  };
}

/**
 * 異常清單。**兩類列,兩支獨立查詢**(`#473b-2` 起):
 *  ① 可處理(plan §4-1 逐字):`processing AND (created_at < now()-30min OR 證據非空)`
 *  ② 🆕 **卡住**(backlog `#473`):`failed AND failed_reason='manual_failed'` ——
 *     這類列**沒有任何動作可按**,但不列出來就等於沒人知道那張訂單上有一筆改不了的判定。
 *
 * 🔴 **為什麼是兩支查詢、不是一支加寬的 `.or()`**(關卡2 codex must-fix,第一版就是那樣寫的):
 *    合成一支的話兩類列**共用同一個 limit 與同一條排序** ⇒ 只要累積 201 筆較舊的②類,
 *    **所有較新的①類就全部拿不到**,而①類正是唯一有動作可做的那半。
 *    ②類在 `#473(b)` 出口做出來之前**永遠不會離開清單** ⇒ 那不是假設情境,是設計上的必然累積。
 *    ⇒ **各自一支、各自一個上限、各自一個截斷旗標**,一邊爆量不會餓死另一邊。
 * 🔴 附帶好處:①類那支的 `.or()` **字面與改動前完全相同** ——
 *    改動前的形狀(embed / `or` 的 `not.is.null` / ISO cutoff parse)在 local 真 PostgREST 14.16
 *    實跑過(handoff §3h 真機段);合成一支會把 `not.is.null` 推進巢狀深度 2,
 *    那是**沒有先例也沒實跑過**的形狀。拆開之後這個賭注不存在。
 * 🔴 30 分閾與訂單頁列級警示共用 REFUND_EXCEPTION_STALL_MS;`manual_failed` 字面走
 *    STUCK_MANUAL_VERDICT_FAILED_REASON —— 兩處各寫一份就會漂。
 * ⚠️ cutoff 用 app 時鐘(DB 打不了 app、`.or()` 塞不進 `now()`):與 DB now() 的秒級漂移
 *    對 30 分保守閾無害;列級 isRefundException 同用 app 時鐘,兩處同源。
 * ⚠️ 回傳順序 = ①類在前、②類在後(①類才有動作可做);兩類內部各自舊的排前。
 */
export async function listRefundExceptions(): Promise<{
  rows: RefundExceptionRow[];
  truncated: boolean;
}> {
  const cutoffIso = new Date(Date.now() - REFUND_EXCEPTION_STALL_MS).toISOString();
  const supabase = createSupabaseServiceClient();
  const [actionable, stuck] = await Promise.all([
    supabase
      .from('order_refunds')
      .select(EXCEPTION_SELECT)
      .eq('status', 'processing')
      .or(`created_at.lt.${cutoffIso},provider_refund_id_evidence.not.is.null`)
      .order('created_at', { ascending: true })
      .limit(REFUND_EXCEPTIONS_LIMIT + 1),
    supabase
      .from('order_refunds')
      .select(EXCEPTION_SELECT)
      // 🔴 兩個 `.eq()` 缺一不可:少了 status 會撈到不存在但形狀上可能的列;
      //    少了 failed_reason 會把 rejected_out_of_range / not_sent 一起撈進來 ——
      //    那兩個是**正常的失敗結果**,不是卡住。測試對這兩顆各有一發突變。
      .eq('status', 'failed')
      .eq('failed_reason', STUCK_MANUAL_VERDICT_FAILED_REASON)
      .order('created_at', { ascending: true })
      .limit(REFUND_STUCK_LIMIT + 1),
  ]);
  if (actionable.error) throw actionable.error;
  if (stuck.error) throw stuck.error;
  const actionableRaw = actionable.data as RawException[];
  const stuckRaw = stuck.data as RawException[];
  return {
    rows: [
      ...actionableRaw.slice(0, REFUND_EXCEPTIONS_LIMIT).map(toExceptionRow),
      ...stuckRaw.slice(0, REFUND_STUCK_LIMIT).map(toExceptionRow),
    ],
    // 任一半被截斷都要讓橫幅出現(合成一個旗標 = 頁面不必知道有兩支查詢)。
    truncated:
      actionableRaw.length > REFUND_EXCEPTIONS_LIMIT || stuckRaw.length > REFUND_STUCK_LIMIT,
  };
}
