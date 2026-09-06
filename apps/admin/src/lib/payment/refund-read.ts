import 'server-only';
import { cache } from 'react';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import {
  countDecidedExceptions,
  isStuckManualVerdict,
  REFUND_EXCEPTION_STALL_MS,
  STUCK_MANUAL_VERDICT_FAILED_REASON,
} from './refund-ledger-view';
import { findEffectiveVerdicts } from './refund-correction-read';

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
  /**
   * 非 NULL = 這一列是**補登**的(有人直接在 TapPay 後台退了款, 我們事後記進來)。
   * 🛑 **時態要對**(code-reviewer F5):**今天它零個非測試消費端** ——
   *   本片只把它**接到投影**, 讓畫面分得出來是 **B2** 那一片的事。
   *   ⚠️ 而本檔 `:22-24` 自己記著 opus R1 的規矩「留著零消費欄 = 下一片的既成事實」
   *   ⇒ 📌 **這一欄現在正是那種欄**, 而它的消費端是已排好的 B2, 不是「總有一天」。
   * 🔴 **B2 會讓它與一般退款在畫面上分得出來** —— 兩者的下一步不同:
   *   一般退款查得到我們送出去的紀錄;補登列**沒有**(那筆錢不是我們發起的)。
   * ⚠️ 只帶「是不是」不帶擔保人 —— 誰擔保的要看明細那一面, 清單這一格不需要。
   */
  backfilledSource: string | null;
};

// 🔴🔴 **讀的是 `order_refunds_readable`(A1 的遮罩 view), 不是底表** ——
//   ⛔ ~~`.from('order_refunds')`~~(三處, 2026-09-07 片 B1 改)
//   理由:那支 view 對**補登列**把 `bank_refund_id` 與 `record_refunded_before` 遮成 `NULL`
//   (前者是合成值、從未送過 TapPay;後者的 `0` 是「未知」不是「零」)。
//   ⇒ 📌 **plan v3 §4 逐字要求「讓下游【拿不到】那個值, 而不是拿到之後被期待去理解它」。**
//   🛑 **今天本檔的投影本來就沒選那兩欄** ⇒ 切過去**不改變任何一個現有欄位的值**;
//     切的意義在**結構**:遮罩由 view 保證, 不再靠「下一個加欄位的人記得別選它」。
// 🔬 **切之前量過那支 view 有沒有 WHERE** —— `20260907020000:267-276` 逐字 `FROM public.order_refunds r;`
//   **零過濾條件** ⇒ 列數與底表相同 ⇒ 不會靜默少列。
//   ⚠️ 那是本次唯一會**改變行為**的風險, 所以它是先量的那一格。
// ⚠️ view **不是權限邊界**(底表照樣在;它自己的 COMMENT 逐字這樣寫)—— 它防的是**誤導**, 不是存取。
const ROW_COLUMNS =
  'id, kind, status, refund_amount, reason, actor, created_at, failed_reason, failed_detail, provider_refund_id_evidence, backfilled_source';

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
  /** 非 NULL = 這一列是【補登】的(今天唯一的值是 `'tappay_console'`)。 */
  backfilled_source: string | null;
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
    backfilledSource: raw.backfilled_source,
  };
}

/**
 * 🔴 顯式上限+truncated 旗標(codex R1 MF1):Supabase 的 PostgREST 有 `db-max-rows`,
 * 不帶 .limit **不是**「無截斷」而是「在那個上限處被平台靜默截斷」—— 顯式上限讓截斷可見
 * 🔴 上限值 = **2000**(~~原寫 1000~~;V 窗 2026-08-18 對正式站實測 `products?select=id&limit=5000`
 * ⇒ HTTP 206、`content-range 0-1999/19777`。**本檔改動者未自驗,轉錄 V 窗**)。
 * ⚠️ **本段結論與那個數字是多少無關** —— 它講的是「不帶 .limit 會被靜默截斷」。
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
    .from('order_refunds_readable')
    .select(ROW_COLUMNS)
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(ORDER_REFUNDS_LIMIT + 1);
  if (error) throw error;
  // 🔴 **這個 `as` 現在 narrow 掉了什麼**(code-reviewer F2, 2026-09-07):
  //   `order_refunds_readable` 的 Row **每一欄都是 `| null`**(view 的常態;
  //   `database.types.ts:3499-3520`), 而 `RawRow` 宣告 `id: string` 那些非 null。
  //   ⇒ 📌 **typecheck 綠是這個 `as` 給的, 不是型別對上了。**
  //   🔬 今天不咬人的前提是**可證偽的**:那十一欄在底表都 NOT NULL,
  //     而**這支 view 對它們零 `CASE`**(它只對 `bank_refund_id` 與
  //     `record_refunded_before` 兩欄做遮罩, 而那兩欄本檔沒選)。
  //   🛑 **哪天有人在 view 裡對 `actor` / `reason` / `status` 補一顆遮罩 ⇒ TS 全綠,
  //     而 `OrderRefundRow.actor: string` 在執行期變成 `null`。這裡不會紅。**
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
 *
 * 🔴 W1-077:用 React `cache()` 包住 —— 這支現在有三個呼叫端(本頁 / `today-read.ts` 首頁對帳 /
 *    `sidebar-counts.ts` 側欄),而側欄在根 layout、每一頁都跑。首頁 `/` 原本同一次 render 內
 *    會打兩份完全相同的查詢(page.tsx 經 `loadTodaySummary()`、layout 經 `getSidebarCounts()`)
 *    ⇒ 包 `cache()` 讓它們在同一次 render pass 內共用同一發。
 *    ⚠️ **測試安全性已查證**(node -e 直接呼叫,無 React render/cache scope):`cache()` 在沒有
 *    作用中的 render 時**靜默不記憶**、每次呼叫都真的重跑 ——不會讓本檔既有的
 *    `describe('listRefundExceptions', …)` 那組測試(逐格換 mock 期待不同結果)互相污染。
 *    只有 Next.js RSC 真渲染才會建立 cache scope、記憶才會生效。
 */
async function listRefundExceptionsUncached(): Promise<{
  rows: RefundExceptionRow[];
  truncated: boolean;
  /**
   * 還沒有人判定的筆數(側欄/首頁那顆數字)。
   * ⚠️ `verdictsUnavailable === true` 時這個值 **= `rows.length`**(退化值,不是真的 pending 數)
   *    —— 顯示端必須把那個旗標一起帶走,否則會把一個退化值印成精確數字。
   */
  pendingCount: number;
  /** 已經有人判定過的筆數(清單頁灰字那一行)。讀不到時 = 0。 */
  decidedCount: number;
  /**
   * 卡住那幾列**現行有效的更正判定**;`null` = 讀不到(與 `verdictsUnavailable` 同源)。
   *
   * 🔴 **為什麼把它一起回出去**(R3 consider-2,2026-08-30):清單頁本來自己再打一發
   *    `findEffectiveVerdicts`,而我在上一片宣稱「包了 `cache()` ⇒ 同成同敗」——
   *    **那句是假的**:React `cache()` 以**引數的 reference** 當 key,兩個呼叫端各自
   *    `filter().map()` 出一個**新陣列** ⇒ 永遠 miss ⇒ 兩發獨立、仍然可能一成一敗。
   *    📌 **一個「快取會幫我去重」的假設,在引數是新造物件時永遠不成立** ——
   *       而它不會報錯,只會安靜地多打一發。
   *    ⇒ 真正的修法不是快取,是**只撈一次然後把東西傳下去**。
   */
  stuckVerdicts: ReadonlyMap<string, { correctedTo: string; seq: number }> | null;
  /**
   * 🔴 更正紀錄讀不到 ⇒ 上面兩個數字都是退化值。
   *
   * **為什麼不讓它 throw**:`refund-correction-read.ts` 檔頭「為什麼新開一支」那段逐字寫著它刻意不擴進本檔,
   * 理由是「擴它 = 把爆炸半徑放到那一頁的全部列上」。而本檔有**三個消費端**
   * (清單頁 / 首頁對帳 / 側欄,側欄在根 layout ⇒ **每一頁**)⇒ 讓它往上炸 = 一次更正查詢故障
   * 會讓**全站每一頁的側欄**掉一格。⇒ 這裡吞,並且**吞得有聲音**(本旗標 + console.error)。
   */
  verdictsUnavailable: boolean;
}> {
  const cutoffIso = new Date(Date.now() - REFUND_EXCEPTION_STALL_MS).toISOString();
  const supabase = createSupabaseServiceClient();
  const [actionable, stuck] = await Promise.all([
    supabase
      .from('order_refunds_readable')
      .select(EXCEPTION_SELECT)
      .eq('status', 'processing')
      .or(`created_at.lt.${cutoffIso},provider_refund_id_evidence.not.is.null`)
      .order('created_at', { ascending: true })
      .limit(REFUND_EXCEPTIONS_LIMIT + 1),
    supabase
      .from('order_refunds_readable')
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
  const rows = [
    ...actionableRaw.slice(0, REFUND_EXCEPTIONS_LIMIT).map(toExceptionRow),
    ...stuckRaw.slice(0, REFUND_STUCK_LIMIT).map(toExceptionRow),
  ];

  // 🔴 只問②類的 id:①類沒有「判定」這回事,問它們只是白花上限額度。
  //    ⚠️ 上限對得上:`REFUND_STUCK_LIMIT`(50)< `CORRECTION_READ_MAX_IDS`(500)
  //       ⇒ 這一發**構造不出**超限;守門在測試裡釘住,免得日後有人調大 50 而沒回訪這裡。
  const stuckIds = rows.filter(isStuckManualVerdict).map((row) => row.id);
  let decidedCount = 0;
  let verdictsUnavailable = false;
  let stuckVerdicts: ReadonlyMap<string, { correctedTo: string; seq: number }> | null = null;
  try {
    const verdicts = await findEffectiveVerdicts(stuckIds);
    // 型別漂移也算讀不到(同 `refund-exceptions/page.tsx` 的 `instanceof Map` 那一格的理由(錨在字面不在行號 —— 本片自己讓那支檔位移了):
    // 不是 Map 就別往下 `.has()`,那會炸掉三個消費端)。
    if (verdicts instanceof Map) {
      decidedCount = countDecidedExceptions(rows, verdicts);
      stuckVerdicts = verdicts;
    } else {
      verdictsUnavailable = true;
    }
  } catch (error) {
    console.error('[refund-read] 現行更正判定載入失敗 ⇒ 待處理筆數退化成總筆數', error);
    verdictsUnavailable = true;
  }

  return {
    rows,
    // 任一半被截斷都要讓橫幅出現(合成一個旗標 = 頁面不必知道有兩支查詢)。
    truncated:
      actionableRaw.length > REFUND_EXCEPTIONS_LIMIT || stuckRaw.length > REFUND_STUCK_LIMIT,
    // 🔴 讀不到 ⇒ 退化成總筆數,**不是 0**。往「多報」的方向退:
    //    多報只是讓人多看一眼那一頁;少報會讓那一頁沒有人去。
    pendingCount: verdictsUnavailable ? rows.length : rows.length - decidedCount,
    decidedCount,
    verdictsUnavailable,
    stuckVerdicts,
  };
}

export const listRefundExceptions = cache(listRefundExceptionsUncached);
