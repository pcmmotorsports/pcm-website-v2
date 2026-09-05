/**
 * SupabaseBankOrderCreatedScannerAdapter —— 匯款單成立信掃描面的 Supabase 實作。
 *
 * 🔵 它查 `public.pcm_bank_order_created_email_pending`(`20260906170000`, 2026-09-06 已貼)。
 *    **射程住在那支 view 裡, 不在這裡** —— 這一支只負責翻頁、cutoff 與解析。
 *    ⇒ 📌 八條述詞(管道 / unpaid / 未取消 / 來源兩條 / 餘額三條 / 收件人 / anti-join)
 *      **一條都不在本檔** —— 抄一份就會漂一份。
 *
 * ⚠️⚠️ **效度限定 —— 而這一節是【義務】不是說明**
 * (前例:`SupabaseCancelledOrderScannerAdapter` 檔頭逐字記著「我鏡像它的時候只搬了做法、沒搬那個義務」)。
 *
 * 🔴 **今天沒有任何一道檢查證得到這個查詢會回對的列**:
 * ```
 * · 單元測試的 builder 是替身 ⇒ 它不執行 PostgREST 的過濾
 *   ⇒ 測試證得到的只有「那些字面有沒有被送出去」, 不是「送出去之後撈到什麼」
 * · `as unknown as OrderRow[]` ⇒ typecheck 也驗不到欄名在正式站對不對得上
 * ```
 * 🛑 **而失敗方向是【安靜不寄】** —— 欄名錯 / view 名錯 ⇒ 撈到 0 列 ⇒ 心跳綠、route 200
 *    ⇒ **沒有人會知道**, 而這正是 `⟦b4-BANKNOEMAIL⟧` 這一列本身的病。
 *
 * ✅ **上線前必須在【正式站】造這五種單各一筆逐筆核**(preview 不算):
 * ```
 * ① 顧客站建的、選匯款、未付款、未取消、有餘額、有信箱   ⇒ **要撈到**
 * ② 刷卡單                                              ⇒ 不得撈到
 * ③ 已取消的匯款單                                      ⇒ 不得撈到
 * ④ 後台手動建的匯款單                                  ⇒ 不得撈到
 * ⑤ 已排過信的匯款單                                    ⇒ 不得撈到
 * ```
 * 🔴 **②–⑤ 四個「不得」要一起看** —— 只驗 ① 會過的實作, 包含「什麼都撈」。
 * ⚠️ 而 ① 要造得出來, **前提是 `BANK_TRANSFER_CHECKOUT_ENABLED` 已經翻開** ——
 *    在那之前**這條線的正對照恆空**, 而「0 列」與「view 名字打錯」印同一個 200(R3-C2)。
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IBankOrderCreatedScanner,
  ListBankOrderCreatedWithoutEmailInput,
  ListBankOrderCreatedWithoutEmailResult,
} from '@pcm/ports';
import type { Database } from '../supabase/database.types';

export type BankOrderCreatedScannerClient = SupabaseClient<Database>;

export class BankOrderScanQueryError extends Error {
  constructor(
    public readonly stage: 'orders',
    public readonly code: string,
  ) {
    // 🔴 訊息只帶【我們自己寫的】stage 與碼 —— 零 PII、零 provider 原文。
    super(`bank-order-created scan 失敗(${stage}/${code})`);
    this.name = 'BankOrderScanQueryError';
  }
}

async function safeQuery<T>(
  run: () => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>,
): Promise<T | null> {
  let outcome: { data: T | null; error: { code?: string; message: string } | null };
  try {
    // 🔴 連 error 物件都不接住 —— 接住了就會有人「順手」把它 log 出去, 而那裡有 PII。
    outcome = await run();
  } catch {
    // 🔴 碼字面用 'rejected' —— **與這一族另外幾支同一個字**(不同字面 ⇒ 凌晨三點 grep 會少撈一半)。
    throw new BankOrderScanQueryError('orders', 'rejected');
  }
  if (outcome.error !== null) {
    throw new BankOrderScanQueryError('orders', outcome.error.code || 'unknown');
  }
  return outcome.data;
}

const MAX_LIMIT = 200;

type OrderRow = {
  order_id: string;
  display_id: string;
  created_at: string | null;
  total: number | null;
  balance_due: number | null;
  notification_email: string | null;
  customer_email: string | null;
  order_source: string | null;
};

// 🔵 view 不在產生型 `Database` 裡(它是新建的)⇒ `.from()` 過不了多載 ⇒ 走 `as never`,
//    與這一族既有幾支同形。⚠️ 代價寫出來:**欄名打錯 typecheck 不會紅**, 只有上面那節的正式站對照抓得到。
const PENDING_VIEW = 'pcm_bank_order_created_email_pending';

export class SupabaseBankOrderCreatedScannerAdapter implements IBankOrderCreatedScanner {
  constructor(private readonly client: BankOrderCreatedScannerClient) {}

  async listBankOrderCreatedWithoutEmail(
    input: ListBankOrderCreatedWithoutEmailInput,
  ): Promise<ListBankOrderCreatedWithoutEmailResult> {
    // 🔴 `limit` 上下界都要 —— 少了上界, `probeLimit` 可能逼近 `db-max-rows`
    //    ⇒ **`truncated` 假陰性** ⇒ 那一頁被截斷而我們以為撈完了。
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAX_LIMIT) {
      throw new BankOrderScanQueryError('orders', 'bad_limit');
    }
    // 🔴 多撈一筆當【截斷偵測】——`>= probeLimit` 才知道還有沒有下一頁。
    const probeLimit = input.limit + 1;

    const page = await safeQuery(() =>
      this.client
        .from(PENDING_VIEW as never)
        .select(
          'order_id, display_id, created_at, total, balance_due, notification_email, customer_email, order_source',
        )
        // 🔴 **cutoff 留在這裡** —— 它是參數, 烤不進 view。
        // 🔵 而本線看 `created_at` 是【對的】(理由在 port 檔頭):期限也是從 `created_at` 起算
        //    ⇒ 收件範圍與期限用同一個時間欄 ⇒ **不會出現「他收到信時已經過期」那種單**。
        .gte('created_at', input.cutoff)
        // 🔴 排序鍵用唯一鍵 ⇒ 翻頁不跳列。
        .order('order_id', { ascending: true })
        .limit(probeLimit),
    );

    const scanned = page ?? [];
    const truncated = scanned.length >= probeLimit;
    const rows = (truncated ? scanned.slice(0, input.limit) : scanned) as unknown as OrderRow[];
    if (rows.length === 0) {
      return { rows: [], scannedPages: 1, truncated: false };
    }

    return {
      rows: rows.map((o) => {
        // 🔴🔴 **金額讀不出來 ⇒ 【炸】, 不是給一個預設值。**
        //    view 那一側已經保證 `total` / `balance_due` 非 NULL、`balance_due` 正數且 ≤ total
        //    ⇒ 走到這裡還讀不出安全整數 = **世界與我以為的不一樣**。
        //    ⛔ ~~`?? 0` 那種 fail-safe~~ 在這裡是**錯的方向**:0 會讓那一列安靜地不寄,
        //      而「安靜不寄」正是這一整片要修的病 ⇒ 📌 **它會把一個【壞掉的世界】偽裝成【今天沒信要寄】。**
        //    ✅ 炸掉 ⇒ route 計 error ⇒ 心跳紅 ⇒ **有人會知道。**
        //    ⚠️ 代價明寫:**一列壞掉會讓整輪停下**。而這是刻意的取捨 ——
        //      這封信印公司帳號與金額, 「少寄一輪」比「印一個算不出來的數字」便宜。
        if (!Number.isSafeInteger(o.total) || !Number.isSafeInteger(o.balance_due)) {
          throw new BankOrderScanQueryError('orders', 'bad_amount');
        }
        if (o.created_at === null || o.created_at === '') {
          // 🔴 同一個方向:沒有 `created_at` ⇒ 期限句算不出來 ⇒ 那封信會少掉客人唯一
          //    知道「什麼時候會被取消」的那一行。
          throw new BankOrderScanQueryError('orders', 'missing_created_at');
        }
        return {
          orderId: o.order_id,
          displayId: o.display_id,
          createdAt: o.created_at,
          total: o.total as number,
          balanceDue: o.balance_due as number,
          notificationEmail: o.notification_email,
          // 🔵 view 已經 LEFT JOIN 好了 ⇒ 這裡只是搬運, 沒有第二發查詢。
          customerEmail: o.customer_email,
          orderSource: o.order_source ?? null,
        };
      }),
      scannedPages: 1,
      truncated,
    };
  }
}
