/**
 * @module @pcm/adapters/email/SupabaseIneligibleOrderEmailScannerAdapter — 寄送前 ineligible gate 的窄讀 adapter
 * (M-4a E2a-2、W3-G 拆出)
 *
 * 實作 `IIneligibleOrderEmailScanner`。client 注入 **service_role**;本 class 不持金鑰、不做
 * authorization,只能由 server-side 受控模組組裝(export 走 `@pcm/adapters/server`)。
 *
 * 🔴 **兩查詢、不做 anti-join**(對照 `SupabasePaidOrderScannerAdapter` 的單查詢 anti-join):
 * `attempts < max_attempts` 是欄對欄比較、PostgREST 不支援,due 掃描本來就得先取大窗、app 層
 * 過濾(鏡像 `SupabaseEmailOutboxAdapter.claimDue` 的 `DUE_SCAN_CAP` 手法)。第二查詢(orders
 * 合格性)沒有理由再疊進同一次 PostgREST 呼叫換取不確定的 embed-filter 語意。
 *
 * 🔴 述詞照 plan 拍板原文(`docs/specs/2026-07-16-m4a-email-notify-plan.md:362`),不自己判:
 * `payment_status='refunded' OR cancelled_at IS NOT NULL`。**不含 `partiallyRefunded`**。
 *
 * ⚠️ **效度限定(引用本段請一起帶走)**:單元測試只驗**查詢字面**(mock 不執行 PostgREST 過濾
 * 語意,見 `SupabasePaidOrderScannerAdapter.ts` 檔頭同款限定)。`.or('payment_status.eq.refunded,
 * cancelled_at.not.is.null')` 的實際過濾結果**未在正式站或拋棄式 PostgREST 上實測過** ——
 * 上線前應比照 `docs/specs/2026-08-15-1-p0-postgrest-or-semantics.md` 的方法,造幾張不同狀態的
 * 訂單逐筆核對它們各自落在哪一邊。
 *
 * @see docs/specs/2026-07-16-m4a-email-notify-plan.md §4.1(:329)/ E2a-2 表列(:362)
 * @see packages/adapters/src/email/SupabaseEmailOutboxAdapter.ts(DUE_SCAN_CAP 手法出處)
 */
import type { EmailOutboxEventType } from '@pcm/ports';
import { SUPPRESS_WHEN_ORDER_INELIGIBLE } from '@pcm/ports';
import 'server-only';

import type { IIneligibleOrderEmailScanner, DueIneligibleEmailJob } from '@pcm/ports';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../supabase/database.types';

export type IneligibleOrderEmailScannerClient = SupabaseClient<Database>;

/** 可被認領的狀態(鏡像 `SupabaseEmailOutboxAdapter` 的 `CLAIMABLE_STATUSES`,同一張表、同一個合約)。 */
const CLAIMABLE_STATUSES = ['pending', 'failed'] as const;

/**
 * due 掃描單次取列上限(理由與 `SupabaseEmailOutboxAdapter.DUE_SCAN_CAP` 相同:
 * `attempts < max_attempts` 欄對欄比較 PostgREST 做不到、需大窗 + app 層過濾)。
 *
 * 🔴 **已知殘餘風險(codex 關卡2 must-fix,已知悉未收斂,鏡像 `SupabaseEmailOutboxAdapter` 對同一
 * 天花板的既有立場)**:若死列(`attempts>=max_attempts`)佔滿整個 200 列窗口,窗口外的
 * 活躍不合格候選那一輪掃不到。取 `.order('next_retry_at', { ascending: true })`
 * 讓最舊(=最可能死透)的列先進窗口,理由與 `claimDue` 相同。
 * **PCM 現行量級**(每日數十封)下死列數遠低於 200,且死列早已被 dead-man 訊號 2 告警
 * (`status IN (pending,failed) AND attempts >= max_attempts`);正解是清理 job(backlog #281),
 * 不是放大窗口。若量級成長使天花板不再安全,要重新評估的是這裡,不是靜默接受。
 */
const DUE_SCAN_CAP = 200;

/** orders 合格性查詢的 `.or()` 述詞(PostgREST filter 語法;不含使用者輸入,靜態字面安全)。 */
const INELIGIBLE_ORDER_FILTER = 'payment_status.eq.refunded,cancelled_at.not.is.null';

type DueOutboxRow = {
  id: string;
  order_id: string;
  attempts: number;
  max_attempts: number;
  /** 🔴 2026-09-03 加:這條路要問「這一種信該不該被擋」(Q10 前置;見 port 那一欄的註解)。 */
  event_type: EmailOutboxEventType;
};

export class SupabaseIneligibleOrderEmailScannerAdapter implements IIneligibleOrderEmailScanner {
  constructor(private readonly client: IneligibleOrderEmailScannerClient) {}

  async listDueIneligible(limit: number): Promise<DueIneligibleEmailJob[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`listDueIneligible limit 必須是 ≥1 的整數(收到 ${String(limit)})`);
    }

    const nowIso = new Date().toISOString();
    const { data: dueRows, error: dueError } = await this.client
      .from('email_outbox')
      .select('id, order_id, attempts, max_attempts, event_type')
      .in('status', CLAIMABLE_STATUSES)
      .lte('next_retry_at', nowIso)
      .order('next_retry_at', { ascending: true }) // 🔴 最舊(最可能死透)的列先進窗口,見 DUE_SCAN_CAP 檔頭
      .limit(Math.max(limit, DUE_SCAN_CAP));
    if (dueError) {
      throw new Error(`ineligible gate:email_outbox due 掃描失敗(${dueError.code ?? 'unknown'})`);
    }

    const candidates = ((dueRows ?? []) as DueOutboxRow[]).filter((row) => row.attempts < row.max_attempts);
    if (candidates.length === 0) {
      return [];
    }

    const orderIds = [...new Set(candidates.map((row) => row.order_id))];
    const ineligibleOrderIds = new Set(await this.listIneligibleAmong(orderIds));
    // 🔴🔴 **取消信在 `.slice()` 【之前】就濾掉 —— 而位置就是這一格的全部**
    //    (code-reviewer N5 + codex must-fix 1/2,兩把尺從不同角度指到同一行)。
    //    ⛔ 我第一版把這道 filter 放在 **use-case**(`.slice()` 之後)⇒ **starvation**:
    //      前 50 筆若都是取消信 ⇒ 它們先吃掉 `limit` 的名額、再被全部濾掉
    //      ⇒ `scanned: 0 / errors: 0 / ok: true` ⇒ 心跳綠、route 200
    //      ⇒ 🛑 **而第 51 筆的 `order_created` 永遠進不來** —— 既有兩封信【被餓死】。
    //    🎯 **⇒ 那正是我宣稱「既有行為逐字不變」的那一格,而我把它弄壞了。**
    //    ⇒ 📌 **而它的失敗形狀與本片要修的那個病一模一樣:安靜地成功、儀表全綠。**
    //    ⚠️ 判斷用**與兩條路同一份來源** `SUPPRESS_WHEN_ORDER_INELIGIBLE`,不在這裡另寫一份。
    //    🛑 **未知 event_type ⇒ 當成【該擋】**(`!== false`)—— fail-closed:
    //      DB 先加值而 code 還沒跟上是本 repo 明文預期的順序,而那時**不該讓它悄悄溜過這道閘**。
    const result = candidates
      .filter((row) => ineligibleOrderIds.has(row.order_id))
      .filter((row) => SUPPRESS_WHEN_ORDER_INELIGIBLE[row.event_type] !== false)
      .slice(0, limit)
      .map((row) => ({ id: row.id, orderId: row.order_id, eventType: row.event_type }));
    return result;
  }

  /**
   * 🔴 述詞只有這一份 —— `listDueIneligible` 現在也是呼叫它,不是自己再寫一次 `.or()`。
   *    兩份述詞會分岔,而分岔時沒有任何一格會紅(2026-08-30 Sean 拍「甲 搬」時一併收的)。
   */
  async listIneligibleAmong(orderIds: readonly string[]): Promise<string[]> {
    // 空進空出、不打 DB。🔴 而它不是效能優化:PostgREST 的 `.in('id', [])` 會生出
    //    `id=in.()`,那條路的行為不是我們該去賭的,而「賭錯」在這裡等於【放行一封不該寄的信】。
    if (orderIds.length === 0) {
      return [];
    }
    const { data, error } = await this.client
      .from('orders')
      .select('id')
      .in('id', [...orderIds])
      .or(INELIGIBLE_ORDER_FILTER);
    if (error) {
      // fail-loud:呼叫端(sweeper)必須把這一輪判成錯誤而不是「都合格」。
      throw new Error(`ineligible gate:orders 合格性查詢失敗(${error.code ?? 'unknown'})`);
    }
    return (data ?? []).map((row) => (row as { id: string }).id);
  }
}
