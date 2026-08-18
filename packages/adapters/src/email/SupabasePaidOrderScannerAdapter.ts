/**
 * @module @pcm/adapters/email/SupabasePaidOrderScannerAdapter — 「已付款但還沒排過通知信」的窄讀 adapter(M-4a B-5)
 *
 * 實作 `IPaidOrderScanner`。client 注入 **service_role**(`orders` / `email_outbox` / `customers`
 * 對 anon/authenticated 的權限與這條路無關;本 class 不持金鑰、不做 authorization,
 * 只能由 server-side 受控模組組裝 —— export 走 `@pcm/adapters/server` subpath、composition 在
 * `apps/storefront/src/lib/email/composition.ts`)。
 *
 * 🔴 **零 migration、零新 RPC**:三個 PostgREST 讀查詢,差集在 app 層算。
 *    這是掃描式(Sean `Q-G4-1`=甲)最主要的好處 —— 它不需要任何新的權限面。
 *
 * 🔴 **`cutoff` 卡兩邊、不是一邊**(PRD §5 R3 明文):`paid_at >= cutoff` **且** `created_at >= cutoff`。
 *    只卡 `paid_at` 的話,cutoff **之前**建立、cutoff **之後**才晚翻 paid 的舊單會被誤納入
 *    ⇒ 客人收到一封關於幾個月前那張單的通知信。**那一半沒有任何症狀,只有客人會發現。**
 *
 * 🔴 **PII**:本 adapter 回兩個 email 欄。它們只准被交給 `outbox.enqueue`,
 *    **不得進 log / result / 錯誤訊息**(PRD §7)。本檔自己一行 log 都不寫。
 *    🔴 **錯誤訊息只帶 PostgREST 的 `code`,絕不內插 `error.message`** —— DB 的訊息會夾帶行內容,
 *    而行內容裡就是收件信箱。我第一版就是內插 `message` 寫出去的,而那一格的測試
 *    (標題寫著「不得夾帶任何 email」)只斷言了訊息開頭那幾個字 ⇒ **它會恆綠**。
 *
 * 🔴🔴 **為什麼要翻頁,而不是「一次 limit N 筆再算差集」**(codex 關卡2 R1 must-fix 1):
 *    `limit` 若在**算差集之前**就套到 `orders`,而最舊的那 N 筆剛好都已經排過信
 *    ⇒ **每一輪都只看到那 N 筆、差集恆空 ⇒ 後面的單永遠排不進去。**
 *    那不是「慢一點」,是**永久飢餓**,而且**沒有任何症狀**:route 回 200、counts 全 0、測試全綠。
 *    ⚠️ 這與 `SupabaseEmailOutboxAdapter` 檔頭記的是**同一個病**(「死列 next_retry_at 恆最老、
 *    恆佔滿窗口 → dead letter 積到 limit 件時活信永久餓死」)—— 我照樣走進去了一次。
 *    ⇒ **改成翻頁,一路翻到收滿 `limit` 筆【真正待排的】或翻完為止。**
 *
 * 🔴 **翻頁用 keyset(`.gt('id', 游標)`)、不用 `.range()`**(`docs/patterns/pagination-loop-review.md` 第 6 條):
 *    判別句是「**我要翻的那張表,在我翻的時候會不會被寫?**」——
 *    `orders` **會**(結帳一直在建單、`confirm_order_payment` 一直在把單翻成 paid)
 *    ⇒ OFFSET 位移之後會**跳過還沒讀到的列**,而 `Map` 去重救不了漏列。
 *    · 排序鍵 = `id`(uuid,**唯一**)⇒ 滿足第 5 條;**刻意不排 `paid_at`** —— 它不唯一,
 *      要處理頁界同值就得寫 `.or(paid_at.gt.X,and(paid_at.eq.X,id.gt.Y))`,把時戳字面拼進過濾字串。
 *      排信順序由 outbox 自己決定,這裡不需要「最舊的先」。
 *    · `PAGE_SIZE` **嚴格小於** `db-max-rows`(第 1 條)⇒ 「短頁 = 末頁」才有判別力。
 *      🔴 `db-max-rows` 是 dashboard 上點一下就能改的專案設定(2026-08-18 量到 = 2000),
 *      **它被改小,這裡就再次歸零而且不會有任何東西紅** ⇒ 餘裕留大(200 vs 2000)。
 *    · 任一頁失敗 **throw、不 break**(第 3 條):`break` 會把「第 3 頁掛了」變成「總共只有 3 頁」。
 *    ⚠️ **殘餘(照實寫)**:`id` 是 uuid、非遞增 ⇒ 翻頁中途新建、而 uuid 恰好排在游標之前的單,
 *      **這一輪讀不到**。下一輪會撈到(差集是即時算的、集合只會長大)⇒ 可接受,但不是「沒有縫」。
 *
 * 差集為什麼在 app 層算(而不是一句 `not.in`):`order_id in (...)` 的名單就是①的結果,
 * 兩邊都是同一批 id ⇒ 在 app 層做 `Set.has` 比較,**不需要**把①的 id 再塞回一個
 * PostgREST 過濾字串裡(那條路遇到含逗號/引號的值會靜默壞掉,而 uuid 今天不含它們——
 * 「今天不含」不是一個值得依賴的性質)。
 *
 * @see docs/specs/2026-08-18-m4a-b5-enqueue-scan-plan.md §4
 * @see docs/specs/2026-07-18-b0-order-notification-email-prd.md §3.2 / §5 R3 / §7
 */
import 'server-only';

import type {
  IPaidOrderScanner,
  ListPaidWithoutOrderCreatedEmailInput,
  ListPaidWithoutOrderCreatedEmailResult,
  PaidOrderWithoutOrderCreatedEmail,
} from '@pcm/ports';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../supabase/database.types';

/** 生成型別直接把關表名/欄名/回傳形狀(鏡像 `EmailOutboxClient` 2026-08-11 #415 拆窄 cast 之後的形狀)。 */
export type PaidOrderScannerClient = SupabaseClient<Database>;

/** 每頁筆數。🔴 **嚴格小於** `db-max-rows`(2026-08-18 量到 = 2000)⇒「短頁 = 末頁」才有判別力。 */
const PAGE_SIZE = 200;

/** 單輪翻頁上限(runaway 守門)。撞到就回 `truncated: true`,**不靜默截斷**。 */
const MAX_PAGES = 25;

/** 掃描的三個階段。**固定字面、非 PII**,可以安全進 log 與回應。 */
export type ScanStage = 'orders' | 'email_outbox' | 'customers';

/**
 * 🔴 **安全錯誤:只帶 `stage` 與 `code` 兩個固定欄**(codex 關卡2 R3 must-fix 2)。
 *
 * R2 那一輪把所有錯誤壓成一句話,PII 是保住了,**而運維診斷能力也一起被清空** ——
 * 「orders 權限壞了」「outbox schema 漂了」「customers 查詢失敗」「網路 reject」
 * 在 log 上長得一模一樣,凌晨三點的人**不知道下一步該查哪裡**。
 * ⇒ 兩個欄都是我們自己產的固定字面(階段名 + PostgREST code),**不含任何 DB 訊息**;
 *   `cause` 仍然刻意不掛、`message` 仍然不內插原文。
 */
export class ScanQueryError extends Error {
  constructor(
    readonly stage: ScanStage,
    readonly code: string,
  ) {
    super(`掃描失敗(stage=${stage}, code=${code})`);
    this.name = 'ScanQueryError';
  }
}

/**
 * 🔴 **每一個查詢都走這裡**(codex 關卡2 R2 must-fix 3)。
 *
 * 原本三處各自 `await query` 之後只看 `{ error }` —— 那**只擋住 PostgREST 把錯誤放進 `error` 的那條路**。
 * 若 query 本身 **直接 reject**(網路層、client 內部拋、fetch abort…),原始 `message` / `stack` / `cause`
 * 會**原封往上冒到 route**,而 DB 層的訊息裡就裝著出事那一行的內容 = 收件信箱。
 * ⇒ 本 helper 把兩條路收成一條:**不論哪一種,丟出去的都是一個只帶 `label` 與 PostgREST `code` 的新 Error**,
 *   `cause` 刻意不掛(掛了就等於把原物件遞出去)。
 */
async function safeQuery<T>(
  stage: ScanStage,
  run: () => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>,
): Promise<T | null> {
  let outcome: { data: T | null; error: { code?: string; message: string } | null };
  try {
    outcome = await run();
  } catch {
    // 🔴 連 error 物件都不接住 —— 接住了就會有人「順手」把它 log 出來。
    throw new ScanQueryError(stage, 'rejected');
  }
  if (outcome.error) {
    throw new ScanQueryError(stage, outcome.error.code || 'unknown');
  }
  return outcome.data;
}

type OrderRow = {
  id: string;
  display_id: string;
  paid_at: string | null;
  notification_email: string | null;
  customer_user_id: string;
};

export class SupabasePaidOrderScannerAdapter implements IPaidOrderScanner {
  constructor(private readonly client: PaidOrderScannerClient) {}

  async listPaidWithoutOrderCreatedEmail(
    input: ListPaidWithoutOrderCreatedEmailInput,
  ): Promise<ListPaidWithoutOrderCreatedEmailResult> {
    const pending: OrderRow[] = [];
    let cursor: string | null = null;
    let scannedPages = 0;
    /**
     * 🔴 **只有【親眼看到末頁】才算掃完**(codex 關卡2 R2 must-fix 2)。
     * 原本寫成 `pending.length > input.limit` ⇒ **剛好收滿 limit 時 `truncated` 會是 false**
     * (例:整頁 200 筆裡剛好 5 筆待排、limit 也是 5 ⇒ 迴圈條件不成立而結束,而後面其實還有)。
     * ⇒ 改成**預設沒掃完**,看到空頁或短頁才翻成掃完了。保守方向 = 寧可多說一次「還有」。
     */
    let exhausted = false;

    while (pending.length < input.limit) {
      if (scannedPages >= MAX_PAGES) {
        break; // 撞上限 ⇒ exhausted 維持 false ⇒ truncated=true(不得靜默截斷)
      }

      // ① 已付款、且【建立與付款】都在 cutoff 之後的單(keyset 翻頁)
      let query = this.client
        .from('orders')
        .select('id, display_id, paid_at, notification_email, customer_user_id')
        .eq('payment_status', 'paid')
        .gte('paid_at', input.cutoff)
        .gte('created_at', input.cutoff) // 🔴 PRD §5 R3:少了這一半,晚翻 paid 的舊單會被誤寄
        .order('id', { ascending: true })
        .limit(PAGE_SIZE);
      if (cursor !== null) {
        query = query.gt('id', cursor);
      }
      const page = await safeQuery('orders', () => query);
      scannedPages += 1;
      if (!page || page.length === 0) {
        exhausted = true;
        break; // 空頁 = 掃完了
      }
      cursor = page[page.length - 1]!.id;

      // ② 這一頁裡已經排過 order_created 的
      const existing = await safeQuery('email_outbox', () =>
        this.client
          .from('email_outbox')
          .select('order_id')
          .eq('event_type', 'order_created')
          .in(
            'order_id',
            page.map((o) => o.id),
          ),
      );
      const alreadyQueued = new Set((existing ?? []).map((r) => r.order_id));

      // ③ 差集(在【每一頁】上算,所以 limit 數的是「真正待排的」不是「掃過的」)
      pending.push(...page.filter((o) => !alreadyQueued.has(o.id)));

      if (page.length < PAGE_SIZE) {
        exhausted = true;
        break; // 短頁 = 末頁(成立的前提是 PAGE_SIZE 嚴格小於 db-max-rows,見檔頭)
      }
    }

    // 🔴 codex 關卡2 R3 must-fix 1:`!exhausted` **還有一種假陰性** ——
    //    末頁是短頁(⇒ exhausted=true)、但那一頁裡待排的筆數**超過 limit**
    //    (例:短末頁 10 筆全待排、limit=5 ⇒ 只回 5 筆,而 truncated 說「掃完了」)。
    //    值班的人看到 `enqTruncated=false` 會判斷沒有 backlog,實際還有 5 筆。
    const truncated = !exhausted || pending.length > input.limit;
    const rows = pending.slice(0, input.limit);
    if (rows.length === 0) {
      return { rows: [], scannedPages, truncated };
    }

    // ④ 只在【真的有人需要 fallback】時才去讀 customers —— 那張表的 email 是 PII,
    //    B-4 之後絕大多數單的 notification_email 都有值,沒必要每輪都撈一次。
    // 🔴 這裡的「有沒有值」必須與 use-case 的判準【逐字相同】(codex 關卡2 R1 must-fix 2):
    //    我第一版用 `!o.notification_email`(falsy),而 use-case 用 `trim() !== ''`
    //    ⇒ `'   '` 這種值在 adapter 眼裡「有值」、在 use-case 眼裡「沒有值」
    //    ⇒ adapter 不去撈 customers ⇒ 該收的信永遠不會被排進去,而測試全綠。
    const needsFallback = rows.filter((o) => !hasText(o.notification_email));
    const customerEmailById = new Map<string, string | null>();
    if (needsFallback.length > 0) {
      const customers = await safeQuery('customers', () =>
        this.client
          .from('customers')
          // 🔴 `customers` 的主鍵欄是 `user_id`,不是 `id`(生成型別當場擋下我原本寫的 `id`)。
          //    `email` 在 DB 是 NOT NULL ⇒ 有這一列就一定有值;查不到列才會是 null。
          .select('user_id, email')
          .in('user_id', [...new Set(needsFallback.map((o) => o.customer_user_id))]),
      );
      for (const c of customers ?? []) {
        customerEmailById.set(c.user_id, c.email);
      }
    }

    return {
      rows: rows.map((o) => ({
        orderId: o.id,
        displayId: o.display_id,
        // `paid_at` 在型別上可為 null,而 ① 的述詞是 `payment_status='paid' AND paid_at >= cutoff`
        // ⇒ 走到這裡不可能是 null。`?? ''` 是防腐:真的拿到空值就讓 `enqueue` 的組裝層 throw
        // (它會驗 paidAt 非空),由 use-case 記成 errors、下一輪再撈到,**不要靜默送一個假時戳**。
        paidAt: o.paid_at ?? '',
        notificationEmail: o.notification_email,
        customerEmail: customerEmailById.get(o.customer_user_id) ?? null,
      })),
      scannedPages,
      truncated,
    };
  }
}

/** 與 use-case 的 `firstNonEmpty` **同一個判準**(見上方註解:兩層不一致 = 信永遠排不進去)。 */
function hasText(value: string | null): boolean {
  return typeof value === 'string' && value.trim() !== '';
}
