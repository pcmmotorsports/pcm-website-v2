/**
 * @module @pcm/adapters/email/SupabasePaidOrderScannerAdapter — 「已付款但還沒排過通知信」的窄讀 adapter(M-4a B-5)
 *
 * 實作 `IPaidOrderScanner`。client 注入 **service_role**;本 class 不持金鑰、不做 authorization,
 * 只能由 server-side 受控模組組裝(export 走 `@pcm/adapters/server`,composition 在
 * `apps/storefront/src/lib/email/composition.ts`)。
 *
 * 🔴 **零 migration、零新 RPC**:一個 PostgREST 讀查詢(anti-join)+ 一個 fallback 讀查詢。
 *
 * 🔴 **`cutoff` 卡兩邊、不是一邊**(PRD §5 R3 明文):`paid_at >= cutoff` **且** `created_at >= cutoff`。
 *    只卡 `paid_at` 的話,cutoff **之前**建立、cutoff **之後**才晚翻 paid 的舊單會被誤納入
 *    ⇒ 客人收到一封關於幾個月前那張單的通知信。**那一半沒有任何症狀,只有客人會發現。**
 *
 * 🔴 **PII**:本 adapter 回兩個 email 欄。它們只准被交給 `outbox.enqueue`,
 *    **不得進 log / result / 錯誤訊息**(PRD §7)。本檔自己一行 log 都不寫。
 *    🔴 **錯誤訊息只帶 `stage` + PostgREST `code`,絕不內插 `error.message`** —— DB 的訊息會夾帶行內容,
 *    而行內容裡就是收件信箱。(我第一版就是內插 `message` 寫出去的,而那一格的測試
 *    ——標題寫著「不得夾帶任何 email」——只斷言了訊息開頭那幾個字 ⇒ **它會恆綠**。)
 *
 * ── 🔴🔴 差集在 DB 端做(2026-08-19 換掉 app 端差集 + keyset 翻頁)────────────────
 *
 * **舊版**:撈一頁 `orders` → 再查一次 `email_outbox` → app 端算差集 → 翻頁直到收滿。
 * **舊版有一個天花板**:已排過信的單會永遠留在結果集裡、排在待排的前面而且每天變長
 * ⇒ 前綴超過 `MAX_PAGES × PAGE_SIZE` 的那天,**後面的單永遠讀不到**,而 route 回 200、counts 全 0。
 * ⇒ **現在改成 PostgREST 的 anti-join,天花板整個消失**(結果集本身就只有待排的)⇒ 翻頁也不需要了。
 *
 * **字面(2026-08-19 實測,PostgREST 14.16 拋棄式環境)**:
 * ```
 * select=…,email_outbox!left(order_id)
 *   &email_outbox.event_type=eq.order_created   ← 先用 event_type 篩【子表】
 *   &email_outbox=is.null                       ← 再看【父列】有沒有剩下的子列
 * ```
 * 🔴🔴 **這個字面差一個欄名就會靜默壞掉,而兩個世界都回 200**:
 * ```
 * ✅ email_outbox=is.null            ⇒ 只回沒排過的            （對）
 * 🔴 email_outbox.order_id=is.null   ⇒ 回【全部的列】+ 空 embed（錯，而且看起來完全正常）
 * ```
 * 帶欄名的寫法把 filter 套在**內嵌資源**上、不當父列條件 ⇒ **前綴一列都沒短**。
 * ⇒ **`.test.ts` 有一格【字面斷言】盯這三個部件**(`argsOf(orders,'is')` 那格),含一條反向斷言。
 * 🔴 **而單元測試守得住的【只有查詢字面與 adapter 的傳遞行為】**(codex 關卡2 指出我原本這裡寫過頭):
 *    mock **不會執行 PostgREST 的過濾語意** ⇒ 那格「逐列比對」是**mock 預先造好答案**的
 *    —— 真查詢若錯誤納入了不該納入的列,只要 mock 照樣回三列,它還是綠。
 *    ⇒ **實際過濾語意只能由部署前的真實測打證明**(見下方效度限定),不是這裡。
 *
 * 🔴 **`event_type` 那道篩子不能省**:一張單可能有 `order_shipped` 而**沒有** `order_created`
 *    ⇒ 少了它,那種單會被當成「排過了」而**永久跳過** ⇒ 那批客人**永遠收不到通知信**。
 *    (這一格 2026-08-19 我自己補量:`O2` 只有 `order_shipped` ⇒ 正確答案必須包含它。)
 *
 * ⚠️ **效度限定(引用本段請一起帶走)**:上面那三發量在 **PostgREST 14.16** 的最小構造上
 *    (兩表一 FK、4 列、無 RLS、無分頁);**正式站(Supabase 託管)的版本未確認,而內嵌過濾語意在版本間改過**。
 *    🔴 **上線前的驗收(codex 關卡2 收緊:只看「互補」仍可能驗到錯誤分組)** ——
 *    要在**正式站**(preview 只有在版本 / schema / FK / RLS / API 設定都與正式站相同時才算數)
 *    造這四種訂單、逐筆核對它們各自落在哪一邊:
 *    ```
 *    有 order_created          ⇒ 只出現在 not.is.null
 *    只有 order_shipped        ⇒ 只出現在 is.null      ← 漏掉它 = 那批客人永遠收不到信
 *    完全沒有 outbox 列        ⇒ 只出現在 is.null
 *    多筆、混合事件且含 created ⇒ 只出現在 not.is.null
 *    ```
 *    這件事同時寫在 plan §4.3;**兩處都寫是刻意的** —— 改這支檔的人不一定會去讀 plan。
 *
 * 📌 索引已經有了、而且是**為這件事建的**:`email_outbox_order_idx (order_id, event_type)`
 *    (`20260717020000_m4a_email_outbox.sql:113` 逐字「正是為此 anti-join 而設」)。**那是效能面。**
 *
 * 🔴 **並行競態不是靠這個查詢擋的,是靠唯一鍵**(codex 關卡2 指出我原本只提了效能索引):
 *    掃描是單一 statement 的 snapshot ⇒ **掃描開始之後才寫入的 `order_created`,這一輪仍會納入那張單**;
 *    兩個 scanner 同時跑也可能拿到同一批。
 *    ⇒ 真正保證「一單一封」的是 `20260717020000_m4a_email_outbox.sql:377`:
 *      `CREATE UNIQUE INDEX email_outbox_event_uniq ON public.email_outbox (event_type, dedup_key)`
 *      而 `order_created` 的 `dedup_key = orderId`(`SupabaseEmailOutboxAdapter.ts:197`)
 *      ⇒ 第二次寫入撞唯一鍵 ⇒ `enqueue` 回 `duplicate`(不 throw)⇒ use-case 記進 `duplicate` 桶。
 *    ⚠️ **所以這支 adapter【不保證】不重複撈,它保證的是「撈到的都還沒排過(在那個 snapshot 上)」。**
 *      不重複**寄**由唯一鍵保證。**兩件事不要混。**
 *
 * ⚠️ **既有的終態列(`skipped_no_real_email` / `failed@max`)也會讓那張單被永久排除** ——
 *    因為這裡只看「有沒有 `order_created` 列」,不看它的狀態。
 *    **那是刻意的**(重排會把「至少寄一次」變成「可能寄很多次」),而它是一個**隱含依賴**:
 *    修那些列要靠終態對帳/dead-man,而那個機制**今天不存在**。已寫進 plan §7-⑩。
 *
 * @see docs/specs/2026-08-18-m4a-b5-enqueue-scan-plan.md §4 / §4.3
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

/** 掃描的三個階段。**固定字面、非 PII**,可以安全進 log 與回應。 */
/**
 * 單輪上限的硬天花板。`limit + 1`(探針)必須遠小於 `db-max-rows`(2026-08-18 量到 = 2000),
 * 否則探針會被伺服器截掉 ⇒ `truncated` 假陰性。同時也是 fallback 查詢一次撈多少 PII 的上界。
 */
const MAX_LIMIT = 200;

export type ScanStage = 'orders' | 'customers';

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
    // 🔴 `limit` 的契約在這裡**強制**,不是靠註解(codex 關卡2:adapter 本身沒 clamp,
    //    而「最多 50 筆」原本只是註解裡的假設 ⇒ 若 caller 沒驗,customers 查詢與 PII 量都可能爆掉)。
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_LIMIT) {
      throw new Error(`掃描 limit 必須是 1..${MAX_LIMIT} 的整數(拿到 ${String(input.limit)})`);
    }

    // 🔴 多要一列:拿得到 `limit + 1` 就代表**後面還有** ⇒ `truncated`。
    //    ⚠️ **它仍然依賴 `db-max-rows`**(codex 關卡2 更正我原本寫的「不依賴」):
    //    若伺服器上限 ≤ `input.limit`,探針那一列會被**伺服器**截掉 ⇒ `truncated` 假陰性。
    //    ⇒ 上面那道 `MAX_LIMIT` 就是為此:`limit + 1 ≤ 51` 遠小於 `db-max-rows`(2026-08-18 量到 = 2000)。
    //    🔴 而那個值是 dashboard 上改得回去、改了不會有任何東西紅的設定 ⇒ 餘裕要留大,不要貼著上限走。
    const probeLimit = input.limit + 1;

    const page = await safeQuery('orders', () =>
      this.client
        .from('orders')
        // 🔴 anti-join:`event_type` 篩【子表】、`email_outbox=is.null` 篩【父列】。
        //    **不要寫成 `email_outbox.order_id=is.null`** —— 那會回全部的列而且回 200(見檔頭)。
        .select('id, display_id, paid_at, notification_email, customer_user_id, email_outbox!left(order_id)')
        .eq('payment_status', 'paid')
        .gte('paid_at', input.cutoff)
        .gte('created_at', input.cutoff) // 🔴 PRD §5 R3:少了這一半,晚翻 paid 的舊單會被誤寄
        .eq('email_outbox.event_type', 'order_created')
        .is('email_outbox', null)
        .order('id', { ascending: true })
        .limit(probeLimit),
    );

    const scanned = page ?? [];
    const truncated = scanned.length >= probeLimit;
    const rows = (truncated ? scanned.slice(0, input.limit) : scanned) as unknown as OrderRow[];
    if (rows.length === 0) {
      return { rows: [], scannedPages: 1, truncated: false };
    }

    // 🔴 **無條件撈 fallback 信箱,不再「只在需要時才撈」**(GR nit 1)。
    //    舊版在這裡自己判了一次「有沒有值」,而 use-case 也判了一次 —— **兩個判準會漂**,
    //    而漂掉那天的症狀是「該收的信永遠不會被排進去」,測試全綠(codex R1 must-fix 2 就是這一格)。
    //    ⇒ 判斷只留一處(use-case 的 `firstNonEmpty`),這裡只負責**把值拿回來**。
    //    代價:`rows` 都有 `notification_email` 時多一個查詢。`rows` 上限 = `limit`(50)⇒ 代價固定且小,
    //    換掉的是一整類「兩處判準不一致」的 bug。
    const customers = await safeQuery('customers', () =>
      this.client
        .from('customers')
        // 🔴 `customers` 的主鍵欄是 `user_id`,不是 `id`(生成型別當場擋下我原本寫的 `id`)。
        .select('user_id, email')
        .in('user_id', [...new Set(rows.map((o) => o.customer_user_id))]),
    );
    const customerEmailById = new Map<string, string | null>();
    for (const c of customers ?? []) {
      customerEmailById.set(c.user_id, c.email);
    }

    return {
      rows: rows.map((o) => ({
        orderId: o.id,
        displayId: o.display_id,
        // `paid_at` 在型別上可為 null,而述詞是 `payment_status='paid' AND paid_at >= cutoff`
        // ⇒ 走到這裡不可能是 null。`?? ''` 是防腐:真的拿到空值就讓 `enqueue` 的組裝層 throw
        // (它會驗 paidAt 非空),由 use-case 記成 errors、下一輪再撈到,**不要靜默送一個假時戳**。
        paidAt: o.paid_at ?? '',
        notificationEmail: o.notification_email,
        customerEmail: customerEmailById.get(o.customer_user_id) ?? null,
      })),
      // 🔴 anti-join 之後**沒有翻頁了**(結果集本身就只有待排的)⇒ 這一欄恆為 1。
      //    保留它是因為 route 已經在回應裡印它;移除是 port 契約改動,不在本次範圍。
      scannedPages: 1,
      truncated,
    };
  }
}
