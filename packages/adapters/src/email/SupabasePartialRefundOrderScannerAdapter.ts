/**
 * SupabasePartialRefundOrderScannerAdapter —— 部分退款通知信掃描面的 Supabase 實作。
 *
 * 🔵 它查 `public.pcm_partial_refund_email_pending`(`20260908080000`)。
 *    **射程住在那支 view 裡, 不在這裡** —— 這一支只負責翻頁與解析。
 * 🔴 **一列 = 一筆 `order_refunds`, 不是一張單** ⇒ 同一張單可以在同一頁出現多列。
 *    理由與依據全文在 port 檔頭(`IPartialRefundOrderScanner`), **這裡不重寫一份**。
 */

/**
 * ⚠️⚠️ **效度限定 —— 照抄姊妹那支的【義務】那一半, 不是只抄做法。**
 * (姊妹檔自己記著:「我鏡像它的時候只搬了做法、沒搬那個義務」⇒ 這次連義務一起搬。)
 *
 * 🔴 **今天【沒有任何一道檢查】證得到這個查詢在正式站會回對的列**:
 * ```
 * · 單元測試的 builder 是替身 ⇒ 它不執行 PostgREST 的過濾
 *   ⇒ 測試證得到的只有「那些字面有沒有被送出去」, 不是「送出去之後撈到什麼」
 * · `as unknown as RefundRow[]` ⇒ typecheck 也驗不到欄名在正式站對不對
 * ```
 * 🟢 **而 view 那一層【已經在拋棄式 PG 17.10 上實跑過】**(2026-09-08, 12 格行為 + 六發突變;
 *    證據 `~/pcm-mailbox/證據-QB16-DB層拋棄式PG實跑-auth-20260908.md`)
 *    ⇒ 🛑 **那證的是 SQL 的語意, 不是 PostgREST 這一層的接線。** 兩件事。
 * ⛔ ~~**失敗方向是【安靜不寄】** —— 欄名打錯 / view 沒貼 ⇒ 撈到 0 列 ⇒ `scanned: 0`
 *    ⇒ 心跳綠、route 200 ⇒ 沒有人會知道~~
 * 🔴 **2026-09-08 codex nit 2 訂正:那句與實作不符。** PostgREST 回 error 時
 *    `safeQuery` 會 **throw** ⇒ route 那個 catch 記 `partialRefundStatus='failed'`
 *    ⇒ 而**加上 must-fix 3 的修法之後**, 那一輪會回 **503**、心跳記失敗 ⇒ **會有人知道。**
 * 🛑 **而【真正】安靜的失敗方向是另一個**:view 貼了、欄名也對, 而**述詞比我以為的窄**
 *    (例:`backfilled_source IS NULL` 把一整群排掉)⇒ 合法地回 0 列
 *    ⇒ 📌 **那與「今天沒有款要通知」印同一個東西, 而沒有任何東西會叫。**
 *
 * ✅ **上線前必須在【正式站】造這五種各一筆,逐筆核**(preview 不算 —— 版本 / RLS / FK /
 *    API 設定要與正式站相同才有效度):
 * ```
 * ① tappay + partiallyRefunded + 一筆 confirmed 退款   ⇒ **要撈到**
 * ② 🔴 同一張單【第二筆】confirmed 退款                ⇒ **也要撈到**(這就是「每次都寄」)
 * ③ payment_status = 'refunded' 的單                   ⇒ **不得撈到**(那是取消信那條線的)
 * ④ 退款 status = 'processing'                         ⇒ **不得撈到**
 * ⑤ 已排過信的那一筆(outbox 有列)                     ⇒ **不得撈到**
 * ```
 * 🔴 **③④⑤ 三個「不得」要一起看** —— 只驗 ①② 會過的實作, 包含「什麼都撈」。
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IPartialRefundOrderScanner,
  ListPartialRefundsWithoutEmailInput,
  ListPartialRefundsWithoutEmailResult,
} from '@pcm/ports';
import type { Database } from '../supabase/database.types';

export type PartialRefundOrderScannerClient = SupabaseClient<Database>;

/**
 * 🔴🔴 **名字必須與同族那兩支【不同】。**
 *    姊妹檔記著:兩支都叫 `ScanQueryError` ⇒ route 那行 `err instanceof ScanQueryError`
 *    比的是 barrel 匯出的**那一支** ⇒ 對另一支永遠 false ⇒ log 永遠不帶 stage/code,
 *    **而註解說它帶**。📌 兩個同名的東西, 而 `instanceof` 比的是身分不是名字。
 */
export class PartialRefundScanQueryError extends Error {
  constructor(public readonly stage: 'refunds', public readonly code: string) {
    // 🔴 訊息只帶【我們自己寫的】stage 與 provider 碼 —— 零 PII、零 provider 原文
    super(`partial-refund scan 失敗(${stage}/${code})`);
    this.name = 'PartialRefundScanQueryError';
  }
}

async function safeQuery<T>(
  stage: 'refunds',
  run: () => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>,
): Promise<T | null> {
  let outcome: { data: T | null; error: { code?: string; message: string } | null };
  try {
    // 🔴 連 error 物件都不接住 —— 接住了就會有人「順手」把它 log 出去, 而那裡有 PII
    outcome = await run();
  } catch {
    // 🔴 碼字面用 'rejected' —— **與同族另外兩支同一個字**(凌晨三點 grep 才撈得齊)
    throw new PartialRefundScanQueryError(stage, 'rejected');
  }
  if (outcome.error !== null) {
    throw new PartialRefundScanQueryError(stage, outcome.error.code || 'unknown');
  }
  return outcome.data;
}

/**
 * 單輪上限。**與同族兩支同值同理由**:`probeLimit` 必須遠小於 `db-max-rows`(2000),
 * 否則那一頁被 PostgREST 截斷而 `truncated` 判成 false ⇒ **假陰性**
 * ⇒ 那一頁剩下的再也不會被掃到(anti-join 只問「排過沒」)。
 */
const MAX_LIMIT = 200;

// 🔴🔴 **`database.types.ts` 還不認得這支 view —— 而那是【時序】不是缺陷。**
//    那份型別是從**正式庫**產生的, 而 `20260908080000` **還沒貼**。
// ⇒ 🛑 所以 `.from(PENDING_VIEW)` 過不了 `SupabaseClient<Database>` 的多載。
// ✅ **窄轉型只包住那一個呼叫**, 不是把整個 client 放寬 ——
//    📌 放寬 client = 這支檔之後**所有**打錯的表名都不會紅。
// ⏰ **什麼時候拿掉**:Sean 貼了 `20260908080000` 並重新產生 types 之後。
const PENDING_VIEW = 'pcm_partial_refund_email_pending';

type RefundRow = {
  order_id: string;
  display_id: string;
  refund_id: string;
  refunded_amount: number | null;
  refunded_at: string | null;
  notification_email: string | null;
  customer_email: string | null;
  order_source: string | null;
  // 🔵 2026-09-12 view 新增的兩欄(`20260912020000`)。舊 view 沒有這兩欄 ⇒ 讀到 undefined ⇒ 下面轉成 null ⇒ use-case 不排。
  order_state: 'active' | 'fully_refunded' | 'cancelled' | null;
  refund_source: 'card' | 'manual' | null;
};

export class SupabasePartialRefundOrderScannerAdapter implements IPartialRefundOrderScanner {
  constructor(private readonly client: PartialRefundOrderScannerClient) {}

  async listPartialRefundsWithoutEmail(
    input: ListPartialRefundsWithoutEmailInput,
  ): Promise<ListPartialRefundsWithoutEmailResult> {
    // 🔴 `limit` 守門(上下界都要)—— 少了上界 ⇒ `probeLimit` 可能逼近 `db-max-rows`
    //    ⇒ **`truncated` 假陰性** ⇒ 那一頁被截斷而我們以為撈完了。
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAX_LIMIT) {
      throw new PartialRefundScanQueryError('refunds', 'bad_limit');
    }
    // 🔴 多撈一筆當【截斷偵測】—— `>= probeLimit` 才知道還有沒有下一頁
    const probeLimit = input.limit + 1;

    const page = await safeQuery('refunds', () =>
      this.client
        .from(PENDING_VIEW as never)
        // 🔵 射程五條(tappay / partiallyRefunded / confirmed / outbox anti-join / 收件人非空)
        //    **全部都在 view 裡**了 —— 這裡只挑欄位。
        .select(
          'order_id, display_id, refund_id, refunded_amount, refunded_at, notification_email, customer_email, order_source, order_state, refund_source',
        )
        // 🔴🔴 **cutoff 掛在 `refunded_at`, 不是 `orders.created_at`** —— 理由在 port 檔頭:
        //    上線前建立、上線後才退款的單, 用 created_at 當閘會讓那位客人**永遠**收不到信,
        //    而症狀與「今天沒有款要通知」印同一個東西。
        .gte('refunded_at', input.cutoff)
        // 🔴 排序鍵用 `refund_id` —— **它才是本掃描面的唯一鍵**(一列一筆退款)。
        //    ⛔ 用 `order_id` 會在同一張單有多筆退款時**不唯一** ⇒ 翻頁跳列/重複列。
        .order('refund_id', { ascending: true })
        .limit(probeLimit),
    );

    const scanned = page ?? [];
    const truncated = scanned.length >= probeLimit;
    const rows = (truncated ? scanned.slice(0, input.limit) : scanned) as unknown as RefundRow[];
    if (rows.length === 0) {
      return { rows: [], scannedPages: 1, truncated: false };
    }

    return {
      rows: rows.map((r) => ({
        orderId: r.order_id,
        displayId: r.display_id,
        refundId: r.refund_id,
        // 🔴 `?? 0` 是 **fail-safe 的方向**:讀不到金額就當 0,
        //    而 use-case 對 `<= 0` 是**不寄**(金額讀不到就不寄, A 2026-09-08 收)
        //    ⇒ 📌 讀不到時它【不寄】, 而不是寄一封說 0 元的信。
        refundedAmount: r.refunded_amount ?? 0,
        // 🔴 `?? ''` 而不是 `!`:述詞已保證非 null, 而**斷言會在述詞哪天被改時安靜地爆**;
        //    空字串會被 use-case 的「時點讀不到就不寄」接住。
        refundedAt: r.refunded_at ?? '',
        // 🔵 2026-09-12:`?? null` 而不是預設值 —— 舊 view / 欄位缺 ⇒ **不猜**, 由 use-case fail-closed 不排。
        orderState: r.order_state ?? null,
        refundSource: r.refund_source ?? null,
        notificationEmail: r.notification_email,
        customerEmail: r.customer_email,
        orderSource: r.order_source,
      })),
      scannedPages: 1,
      truncated,
    };
  }
}
