/**
 * @module @pcm/adapters/email/SupabaseShippedOrderScannerAdapter — 出貨線的窄讀 adapter(M-4b E4-a)
 *
 * 讀 `public.pcm_shipped_email_pending`(view;`20260822010000_m4b_e4a_shipped_email_scan_view.sql`)。
 * **一列 = 一個 `(箱, 單)` 配對 = 一封要寄的信。**
 *
 * 🔴 **差集(「還沒排過信」)寫在 SQL 裡,不在這裡。** 理由在那支 migration §0:
 * 出貨線的差集鍵是 `(箱, 單)` 這個配對、要跨四張表,在 PostgREST 上拼複合 anti-join
 * 會把兄弟檔 `SupabasePaidOrderScannerAdapter` 檔頭記的那個坑
 * (`email_outbox.order_id=is.null` **回全部的列而且回 200**)放大四倍。
 *
 * 🔴 **本 adapter 回 PII(兩個 email 欄)** ⇒ server-only + service_role;
 *    呼叫端只准把值交給 `outbox.enqueue`,不得進 log / result / 錯誤訊息。
 *
 * 🔴 **view 只回【有收件信箱可用的】** —— 兩個候選都空的配對在 `pcm_shipped_email_unsendable`。
 *    ⚠️ **「有信箱」不等於「寄得出去」**(codex R2 nit:原本寫「寄得出去的」,不精確):
 *    LINE 合成假信箱(`@line.pcmmotorsports.local`)**非空** ⇒ 它會進 pending,
 *    然後由 outbox adapter 落一列 `skipped_no_real_email`。**那是正確的位置** ——
 *    放進 unsendable 的話,那些單會**永遠沒有 outbox 痕跡**,查不到「這封信為什麼沒寄」。
 *    分開的理由是 codex 2026-08-22 R1 抓到的形狀:本查詢固定取**最舊的 limit 筆**,
 *    而「沒有信箱」**永遠不會消失** ⇒ 累積到 limit 筆就**永久擋住後面每一封有效的信**,
 *    症狀是「有些信永遠沒寄出,而系統一切正常」。
 *    ⚠️ 排除 ≠ 消失:那些列在另一支 view 裡逐列看得到(**而它不會自己叫**,要有人去查)。
 *
 * ⚠️ **起始線(`cutoff`)由呼叫端給,本檔不代填、不設預設值。**
 *    view 本身**沒有**起始線,它回的是歷史上全部還沒排過信的配對
 *    ⇒ 少了 cutoff 條件 = 客人收到一封講十天前那批貨的通知,而信收不回來。
 */
import type {
  IShippedOrderScanner,
  ListShippedWithoutShippedEmailInput,
  ListShippedWithoutShippedEmailResult,
  ShippedOrderWithoutShippedEmail,
} from '@pcm/ports';

/**
 * 🔴 **為什麼是結構型別,不是 `SupabaseClient<Database>`**(兄弟檔用的是後者):
 * `database.types.ts` 是從**已 apply 的 schema** 生出來的,而本片的 view **還沒 apply**
 * (apply 是 Sean 的事)⇒ 生成型別裡沒有它 ⇒ 用 `SupabaseClient<Database>` 會 typecheck 紅。
 *
 * ⚠️ **代價照實寫**:這麼做**失去了欄名與回傳形狀的編譯期把關**。補償有兩層,都不是註解:
 *   ① migration §6 的權限驗證在 **apply 當下**會紅(view 不存在 / service_role 查不動都過不了);
 *      ⚠️ 不寫數量 —— 數量會隨補洞而變,而**寫死的數量過期時零機械訊號**(codex R2 nit)。
 *   ② 下方 `toRow()` 對每一列做 **runtime 形狀檢查**,欄名漂掉會在第一列就 throw,
 *      **不會退化成「撈到 0 列」那種安靜的壞法**。
 * 📌 view apply 之後重生 `database.types.ts`,這個結構型別就該換掉 —— 那是一格 backlog,不是永久設計。
 */
/** 可鏈式 `.order()` 的中繼形狀(排序要帶唯一鍵 ⇒ 至少三段)。 */
type ShippedScanOrderable = {
  order(column: string, opts: { ascending: boolean }): ShippedScanOrderable;
  limit(count: number): PromiseLike<{ data: unknown[] | null; error: { code?: string } | null }>;
};

export type ShippedOrderScannerClient = {
  from(table: string): {
    select(columns: string): {
      gt(
        column: string,
        value: string,
      ): ShippedScanOrderable;
    };
  };
};

/** view 的名字。**單一字面來源**,測試也引它 —— 兩處各寫一份會漂,而漂掉時撈到 0 列、不報錯。 */
export const SHIPPED_EMAIL_PENDING_VIEW = 'pcm_shipped_email_pending';

const SELECT_COLUMNS =
  'shipment_id, shipment_reference, shipped_at, order_id, display_id, notification_email, customer_email, order_source';

/**
 * 單輪上限的硬天花板。`limit + 1`(探針)必須遠小於 `db-max-rows`(2026-08-18 量到 = 2000),
 * 否則探針會被伺服器**靜默截掉** ⇒ `truncated` 假陰性(= 後面還有,而我們回報「掃完了」)。
 */
const MAX_LIMIT = 200;

/**
 * 🔴 只帶固定 `code`、不帶任何 DB 訊息(鏡像兄弟檔 `ScanQueryError`)。
 * DB 層的錯誤訊息裡裝著出事那一行的內容 = **收件信箱**。
 */
export class ShippedScanQueryError extends Error {
  constructor(readonly code: string) {
    super(`出貨信掃描失敗(code=${code})`);
    this.name = 'ShippedScanQueryError';
  }
}

/**
 * 逐列 runtime 形狀檢查。
 *
 * 🔴 **這支存在的理由是「欄名漂掉的症狀」**:PostgREST 對不存在的欄會回錯(那還好),
 * 而**型別漂掉**(例如某欄從 text 變成 null)只會讓值變成 `undefined`
 * ⇒ 沒有這道檢查的話,它會一路流到 `enqueue`,再被 `requireNonEmptyString` 擋下,
 *   而那時的錯誤訊息講的是「組裝失敗」—— **指向錯的那一層**。
 */
function toRow(raw: unknown): ShippedOrderWithoutShippedEmail {
  const r = raw as Record<string, unknown>;
  const str = (key: string): string => {
    const v = r[key];
    if (typeof v !== 'string' || v === '') {
      // 🔴 只講欄名,不講值(值可能是 email)。
      throw new ShippedScanQueryError(`bad_row_shape:${key}`);
    }
    return v;
  };
  const nullableStr = (key: string): string | null => {
    const v = r[key];
    // 🔴 三種情況要分成三條路,**不可以合併成「不是字串就當 null」**(codex 2026-08-22 R1):
    //    `undefined` = 欄根本沒回來(我們讀壞了)
    //    `null`      = 欄回來了、值是空的(這張單真的沒有信箱)—— 唯一合法的 null
    //    其他型別    = 形狀壞了(number / object / boolean)
    // ⚠️ 原版把第三種**靜默轉成 null** ⇒ 呼叫端會記成 `noRecipient`
    //    ⇒ **維運看到的是「這位客人沒有信箱」,而真相是「我們的查詢回了奇怪的東西」**
    //    —— 兩個完全不同的處置,被寫成同一個數字。
    if (v === undefined) throw new ShippedScanQueryError(`missing_column:${key}`);
    if (v === null) return null;
    if (typeof v !== 'string') throw new ShippedScanQueryError(`bad_row_shape:${key}`);
    // 空字串 / 全空白 = 「沒有信箱」這個合法狀態(與 orders.notification_email 的既有慣例一致)。
    return v.trim() === '' ? null : v;
  };
  return {
    shipmentId: str('shipment_id'),
    shipmentReference: str('shipment_reference'),
    shippedAt: str('shipped_at'),
    orderId: str('order_id'),
    displayId: str('display_id'),
    notificationEmail: nullableStr('notification_email'),
    customerEmail: nullableStr('customer_email'),
    // 🔴 片 B:只接出來, 沒有人在用它(分流在片 C)
    orderSource: nullableStr('order_source'),
  };
}

export class SupabaseShippedOrderScannerAdapter implements IShippedOrderScanner {
  constructor(private readonly client: ShippedOrderScannerClient) {}

  async listShippedWithoutShippedEmail(
    input: ListShippedWithoutShippedEmailInput,
  ): Promise<ListShippedWithoutShippedEmailResult> {
    // 🔴 契約在這裡**強制**,不是靠註解(鏡像兄弟檔 codex 關卡2 的那條):
    //    adapter 自己不 clamp 的話,caller 沒驗時 PII 量與探針正確性一起爆掉。
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_LIMIT) {
      throw new Error(`出貨信掃描 limit 必須是 1..${MAX_LIMIT} 的整數(拿到 ${String(input.limit)})`);
    }
    if (typeof input.cutoff !== 'string' || input.cutoff.trim() === '') {
      // 🔴 **fail-closed,不是「沒給就撈全部」**:沒有起始線 = 把歷史上每一張都寄出去。
      throw new Error('出貨信掃描必須帶 cutoff(起始線;缺了會把歷史上每一箱都排進去)');
    }

    let outcome: { data: unknown[] | null; error: { code?: string } | null };
    try {
      outcome = await this.client
        .from(SHIPPED_EMAIL_PENDING_VIEW)
        .select(SELECT_COLUMNS)
        // 🔴 嚴格大於:cutoff 那一刻本身**不含**。等於的那一發是上一次上線的邊界,重複納入沒有意義。
        .gt('shipped_at', input.cutoff)
        // 🔴 **排序帶唯一鍵**:只用 shipped_at 排的話,同一毫秒的兩箱在兩次查詢間順序可能不同
        //    ⇒ 翻頁會漏(docs/patterns/pagination-loop-review.md 第五條)。
        //    本片單輪不翻頁,但 `truncated` 之後下一輪會再查一次 —— 順序不穩一樣會漏。
        .order('shipped_at', { ascending: true })
        // 🔴 tie-breaker(codex 2026-08-22 R1 nit:原本只排 `shipped_at`,而註解已經宣稱「帶唯一鍵」
        //    —— **宣稱強於實作**)。同一毫秒出貨的兩箱,只靠時戳排序時兩次查詢的順序可能不同
        //    ⇒ `truncated` 之後下一輪再查,**邊界那一列可能被跳過**(pagination-loop-review.md 第五條)。
        //    `(shipped_at, shipment_id, order_id)` 是本 view 的唯一組合 ⇒ 全序、可重現。
        .order('shipment_id', { ascending: true })
        .order('order_id', { ascending: true })
        // 多要一列當探針:拿得到 limit + 1 就代表後面還有。
        .limit(input.limit + 1);
    } catch {
      // 🔴 連 error 物件都不接住 —— 接住了就會有人「順手」把它 log 出來(裡面有信箱)。
      throw new ShippedScanQueryError('rejected');
    }
    if (outcome.error) {
      throw new ShippedScanQueryError(outcome.error.code || 'unknown');
    }

    const raw = outcome.data ?? [];
    const truncated = raw.length > input.limit;
    return { rows: raw.slice(0, input.limit).map(toRow), truncated };
  }
}
