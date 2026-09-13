/**
 * SupabaseBankOrderAmountChangedScannerAdapter —— 部分取消補寄信掃描面的 Supabase 實作。
 *
 * 🔵 它查 `public.pcm_bank_order_amount_changed_email_pending`
 *    (`20260913010000`,**2026-09-13 已貼正式庫**)。
 *    **射程住在那支 view 裡, 不在這裡** —— 這一支只負責翻頁與解析。
 *    ⇒ 📌 合格性那七條 + 時間地板 + anti-join **一條都不在本檔** —— 抄一份就會漂一份。
 *
 * 🔴🔴 **一列 = 一次取消, 不是一列一張單。**
 *    排序鍵因此是 `cancellation_id`(view 那一側它是 `order_cancellations.id`, uuid PK)
 *    而**不是** `order_id` —— 同一張單可以有多列, 拿 `order_id` 當排序鍵**翻頁會跳列**。
 *
 * ⚠️⚠️ **效度限定 —— 而這一節是【義務】不是說明**
 * (前例:`SupabaseBankOrderCreatedScannerAdapter` 與 `SupabaseCancelledOrderScannerAdapter`
 *  檔頭都帶著同一節,而後者逐字記著「我鏡像它的時候只搬了做法、沒搬那個義務」)。
 *
 * 🔴 **今天沒有任何一道檢查證得到這個查詢會回對的列**:
 * ```
 * · 單元測試的 builder 是替身 ⇒ 它不執行 PostgREST 的過濾
 *   ⇒ 測試證得到的只有「那些字面有沒有被送出去」, 不是「送出去之後撈到什麼」
 * · `as unknown as CancellationRow[]` ⇒ typecheck 也驗不到欄名在正式站對不對得上
 * ```
 * 🛑 **而失敗方向是【安靜不寄】** —— 欄名錯 / view 名錯 ⇒ 撈到 0 列 ⇒ 心跳綠、route 200
 *    ⇒ **沒有人會知道**, 而「客人手上那封是錯的金額」正是這一整片要修的病。
 *
 * ✅ **上線前必須在【正式站】造這六種各一筆逐筆核**(preview 不算):
 * ```
 * ① 顧客站建的匯款單、未付款、未整單取消、**被部分取消過一次**、有餘額、有信箱  ⇒ **要撈到**
 * ② 同一張單**再被部分取消一次**                                              ⇒ **要撈到第二列**(不是覆蓋第一列)
 * ③ 刷卡單 / 整單取消的單 / 後台手動建的單                                    ⇒ 不得撈到
 * ④ 沒有任何取消件的匯款單                                                    ⇒ 不得撈到
 * ⑤ 已經補寄過那一次取消的單                                                  ⇒ 不得撈到(anti-join)
 * ⑥ 時間地板**之前**發生的取消                                                ⇒ 不得撈到
 * ```
 * 🔴 **②** 是這一族獨有、而且最容易做錯的一格:它證的是「粒度真的是一次取消」。
 * 🔴 **③–⑥ 四個「不得」要一起看** —— 只驗 ① 會過的實作, 包含「什麼都撈」。
 */
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IBankOrderAmountChangedScanner,
  ListBankOrderAmountChangedWithoutEmailInput,
  ListBankOrderAmountChangedWithoutEmailResult,
} from '@pcm/ports';
import type { Database } from '../supabase/database.types';

export type BankOrderAmountChangedScannerClient = SupabaseClient<Database>;

export class BankAmountChangedScanQueryError extends Error {
  constructor(
    public readonly stage: 'cancellations',
    public readonly code: string,
  ) {
    // 🔴 訊息只帶【我們自己寫的】stage 與碼 —— 零 PII、零 provider 原文。
    super(`bank-order-amount-changed scan 失敗(${stage}/${code})`);
    this.name = 'BankAmountChangedScanQueryError';
  }
}

async function safeQuery<T>(
  run: () => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>,
): Promise<T | null> {
  let outcome: { data: T | null; error: { code?: string; message: string } | null };
  try {
    // 🔴 連 error 物件都不接住 —— 接住了就會有人「順手」把它 log 出去,而那裡有 PII。
    outcome = await run();
  } catch {
    // 🔴 碼字面用 'rejected' —— **與這一族另外幾支同一個字**(不同字面 ⇒ 凌晨三點 grep 會少撈一半)。
    throw new BankAmountChangedScanQueryError('cancellations', 'rejected');
  }
  if (outcome.error !== null) {
    throw new BankAmountChangedScanQueryError('cancellations', outcome.error.code || 'unknown');
  }
  return outcome.data;
}

const MAX_LIMIT = 200;

type CancellationRow = {
  order_id: string;
  cancellation_id: string;
  display_id: string;
  created_at: string | null;
  total: number | null;
  balance_due: number | null;
  notification_email: string | null;
  customer_email: string | null;
  order_source: string | null;
};

// 🔵 view 不在產生型 `Database` 裡(它是新建的)⇒ `.from()` 過不了多載 ⇒ 走 `as never`,
//    與這一族既有幾支同形。⚠️ 代價寫出來:**欄名打錯 typecheck 不會紅**,只有上面那節的正式站對照抓得到。
const PENDING_VIEW = 'pcm_bank_order_amount_changed_email_pending';

export class SupabaseBankOrderAmountChangedScannerAdapter
  implements IBankOrderAmountChangedScanner
{
  constructor(private readonly client: BankOrderAmountChangedScannerClient) {}

  async listBankOrderAmountChangedWithoutEmail(
    input: ListBankOrderAmountChangedWithoutEmailInput,
  ): Promise<ListBankOrderAmountChangedWithoutEmailResult> {
    // 🔴 `limit` 上下界都要 —— 少了上界,`probeLimit` 可能逼近 `db-max-rows`
    //    ⇒ **`truncated` 假陰性** ⇒ 那一頁被截斷而我們以為撈完了。
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAX_LIMIT) {
      throw new BankAmountChangedScanQueryError('cancellations', 'bad_limit');
    }
    // 🔴 多撈一筆當【截斷偵測】——`>= probeLimit` 才知道還有沒有下一頁。
    const probeLimit = input.limit + 1;

    const page = await safeQuery(() =>
      this.client
        .from(PENDING_VIEW as never)
        .select(
          'order_id, cancellation_id, display_id, created_at, total, balance_due, notification_email, customer_email, order_source',
        )
        // 🔴🔴 **這裡【刻意沒有 cutoff 過濾】, 而那不是漏寫** ——
        //    姊妹那支下 `.gte('created_at', cutoff)`, 而本 view 的 `created_at` 是**訂單的**
        //    下單時刻(繼承自 `pcm_bank_order_still_mailable`), **不是取消時間**。
        //    ⇒ 📌 對它下 cutoff ⇒ **一張很久以前下單、今天才被部分取消的單會被濾掉**
        //      ⇒ 客人手上那封舊信永遠是錯的金額, 而**沒有任何東西會叫**。
        //    ✅ 那個保護在本型別由 view 自己的時間地板做
        //      (`oc.created_at >= pcm_bank_amount_changed_email_floor()` 烤在述詞裡)
        //      ⇒ **它是不變式, 不是參數** —— 沒有人可以在呼叫端把它調寬。
        //    🔴 要可調的 cutoff ⇒ 必須吃【取消時間】, 而那要先讓 view 多吐 `oc.created_at`
        //      —— 那是一支新 migration(貼板 138 起), 不是在這裡加一個 `.gte`。
        // 🔴 排序鍵用 `cancellation_id`(uuid PK)**不是 order_id** ——
        //    一列 = 一次取消 ⇒ 同一張單可以有多列 ⇒ 拿 order_id 當排序鍵**翻頁會跳列**。
        .order('cancellation_id', { ascending: true })
        .limit(probeLimit),
    );

    const scanned = page ?? [];
    const truncated = scanned.length >= probeLimit;
    const rows = (truncated ? scanned.slice(0, input.limit) : scanned) as unknown as CancellationRow[];
    if (rows.length === 0) {
      return { rows: [], scannedPages: 1, truncated: false };
    }

    return {
      rows: rows.map((o) => {
        // 🔴🔴 **金額讀不出來 ⇒ 【炸】, 不是給一個預設值。**
        //    view 那一側已經保證 `total` / `balance_due` 非 NULL、`balance_due` 正數且 ≤ total
        //    ⇒ 走到這裡還讀不出安全整數 = **世界與我以為的不一樣**。
        //    ⛔ ~~`?? 0` 那種 fail-safe~~ 在這裡是**錯的方向**:0 會讓那一列安靜地不寄,
        //      而「安靜不寄」正是這一整片要修的病
        //      ⇒ 📌 **它會把一個【壞掉的世界】偽裝成【今天沒信要寄】。**
        //    ✅ 炸掉 ⇒ route 計 error ⇒ 心跳紅 ⇒ **有人會知道。**
        //    ⚠️ 代價明寫:**一列壞掉會讓整輪停下**。而這是刻意的取捨 ——
        //      這封信印公司帳號與一個新金額, 「少寄一輪」比「印一個算不出來的數字」便宜。
        if (!Number.isSafeInteger(o.total) || !Number.isSafeInteger(o.balance_due)) {
          throw new BankAmountChangedScanQueryError('cancellations', 'bad_amount');
        }
        if (o.created_at === null || o.created_at === '') {
          // 🔴 同一個方向:沒有 `created_at` ⇒ 期限句算不出來 ⇒ 那封信會少掉客人唯一
          //    知道「什麼時候會被取消」的那一行。
          throw new BankAmountChangedScanQueryError('cancellations', 'missing_created_at');
        }
        if (o.cancellation_id === null || o.cancellation_id === '') {
          // 🔴🔴 **這一格是本族獨有的, 而它比上面兩格更安靜**:
          //    少了它, `dedup_key` 會變成 `:{orderId}`
          //    ⇒ **同一張單的每一次取消撞同一把鍵** ⇒ 只寄得出第一封,
          //    而那正是 Sean 2026-09-13 A1 甲禁止的事 —— 且**三綠與測試都不會紅**。
          //    🔬 ⛔ ~~我原本寫「兩道不重複:那一道守繞過本 scanner 的人, 這一道守 view 吐空的」~~
          //      🔴 **那個說法不成立**(Fable 2026-09-13 F5):落表層那道
          //      (`buildBankOrderAmountChangedPayload` 的 `requireNonEmptyString`)對
          //      「view 吐空」**也會**擋 ⇒ 兩道**射程重疊**。
          //    ✅ 真正的差別是**爆炸半徑**:
          //      · 本格炸 ⇒ **整輪停下**、心跳紅(吵, 有人會知道)
          //      · 落表層炸 ⇒ 那一列 `errors+1`、其餘照排、每輪重試(安靜, 而它會一直重試)
          //    ⚠️ 而**本格今天 by construction 不可達**:`cancellation_id` 來自 INNER JOIN 的
          //      `order_cancellations.id`(uuid PK、NOT NULL)⇒ 它是死閘。留著無害, 而不要
          //      把它讀成一道在守什麼的閘。
          throw new BankAmountChangedScanQueryError('cancellations', 'missing_cancellation_id');
        }
        return {
          orderId: o.order_id,
          cancellationId: o.cancellation_id,
          displayId: o.display_id,
          createdAt: o.created_at,
          total: o.total as number,
          balanceDue: o.balance_due as number,
          notificationEmail: o.notification_email,
          // 🔵 view 已經 LEFT JOIN 好了 ⇒ 這裡只是搬運,沒有第二發查詢。
          customerEmail: o.customer_email,
          orderSource: o.order_source ?? null,
        };
      }),
      scannedPages: 1,
      truncated,
    };
  }
}
