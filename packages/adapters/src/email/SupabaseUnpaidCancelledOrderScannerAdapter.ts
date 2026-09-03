import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IUnpaidCancelledOrderScanner,
  ListUnpaidCancelledWithoutEmailInput,
  ListUnpaidCancelledWithoutEmailResult,
} from '@pcm/ports';
import type { Database } from '../supabase/database.types';

/**
 * 「未付款被【員工】取消、而還沒排過通知信」的窄查詢實作。
 * **鏡像 `SupabasePaidOrderScannerAdapter`,刻意逐格對齊。**
 *
 * 🔴🔴 **本檔最重要的一格是 `.select()` 裡的 `order_cancellations!inner(order_id)`** ——
 *    射程靠**那一列存不存在**,不靠任何欄位的值。
 *    ⛔ ~~本段原本寫「最重要的一行是那道 `.neq('cancelled_reason','payment_expired')`」~~
 *    🔴 **判準換過,而描述它的字面沒跟著換**(code-reviewer must-fix 1)⇒ 照它去找那一行的人
 *      **找不到**,而真正的射程在下面的 `select`。
 *    📌 **⇒ 碼換了而描述它的字面沒換 —— 那正是本片自己在修的那個病。**
 * ⇒ 射程全文與來源座標在 port 檔頭(`IUnpaidCancelledOrderScanner`),**這裡不重寫一份**。
 */
/**
 * ⚠️⚠️ **效度限定 —— 而它是【鏡像時被我留下的那一半】**(code-reviewer must-fix 6)。
 *
 * `SupabasePaidOrderScannerAdapter` 檔頭有一整節「效度限定 + 上線前在正式站逐筆對照」,
 * 而我鏡像它的時候**只搬了做法、沒搬那個義務**。
 * 📌 **⇒ 那正是「搬規則不得把義務那半搬走」那條** —— 而這一次搬的人是我。
 *
 * 🔴 **今天【沒有任何一道檢查】證得到這個查詢會回對的列**:
 * ```
 * · 單元測試的 builder 是替身 ⇒ **它不執行 PostgREST 的 join 與過濾**
 *   ⇒ 測試證得到的只有「那些字面有沒有被送出去」, 不是「送出去之後撈到什麼」
 * · `as unknown as OrderRow[]`(見下面那一行)⇒ typecheck 也驗不到
 *   `order_cancellations` 這個 embed 名在正式站解不解得開
 * · 而本片是這一族**第一次用 to-many 的 `!inner`** ⇒ 沒有前例可以借
 * ```
 * 🛑 **而失敗方向是【安靜不寄】** —— embed 名解不開 / `!inner` 語意與我以為的不同
 *    ⇒ 撈到 0 列 ⇒ `scanned: 0` ⇒ 心跳綠、route 200 ⇒ **沒有人會知道。**
 *
 * ✅ **上線前必須在【正式站】造這四種單各一筆,逐筆核**(preview 不算 —— 版本 / RLS /
 *    FK / API 設定要與正式站相同才有效度):
 * ```
 * ① 員工按取消的未付款單            ⇒ **要撈到**
 * ② 逾時自動取消的未付款單          ⇒ **不得撈到**
 * ③ 員工取消而【已排過信】的單      ⇒ **不得撈到**(email_outbox!left + is null 那一半)
 * ④ 已付款的單                      ⇒ **不得撈到**
 * ```
 * 🔴 **而 ②③④ 三個「不得」要一起看** —— 只驗 ① 會過的實作,包含「什麼都撈」。
 */
export type UnpaidCancelledOrderScannerClient = SupabaseClient<Database>;

// 🔴🔴 **這裡原本有一個我自己新造的 `EXPIRED_CANCEL_REASON`,而它是【重複發明】** ——
//    `packages/domain/src/order/order-cancel-reason.ts:32` 早就有 `PAYMENT_EXPIRED_CANCEL_REASON`,
//    而且還有一支分類器 `orderCancelKindOf`。⇒ 我沒先 grep 就造了第二份。
//    (⛔ ~~我原本寫 `:25`~~ ⇒ 實際 `:32`;code-reviewer 逐個座標核出來的。)
// ✅ 已刪。而**本檔現在【不需要那個字面】** —— 判準改成問「`order_cancellations` 那一列在不在」。
//
// 🛑🛑 **而順手量到一件【不是本片造成、但要有人知道】的事**:
//    `orderCancelKindOf`(`order-cancel-reason.ts:82`)分辨兩種取消用的是
//      `cancelledReason === PAYMENT_EXPIRED_CANCEL_REASON ? 'expired' : 'cancelled'`
//    ⇒ 🔴 **那正是 codex 打穿我的那個形狀** —— 員工選 `other` 時那一欄**是他打的字**
//      ⇒ 他打 `payment_expired` ⇒ 他的取消被標成「逾時失效」。
//    ⇒ 🔴🔴 **而它落在【客人自己看得到的頁面】上, 不是後台**(⛔ ~~我原本寫「後台畫面上」~~):
//      · `mappers/order.ts:250` 在 `mapSupabaseOrderRowToListItem` ⇒ 回 `OrderListItem`(客人的訂單列表)
//      · `mappers/order.ts:1286` 在 `mapSupabaseMemberOrderDetailRow` ⇒ 回 `MemberOrderDetail`(客人的訂單詳情)
//      · 而 `cancel-view.ts:686` 那份**手寫的同款比較**才是後台(沒走那支函式 ⇒ 改函式修不到它)
//    📌 **⇒ 我當時用「影響的是顯示不是寄信」把它降了一級, 而那個顯示【就是客人看到的那一頁】。**
//    ⇒ 🔵 **本片仍然不改它**(不同線)—— 而**已回報主視窗, 並更正嚴重度。**

/**
 * 🔴🔴 **名字必須與 `SupabasePaidOrderScannerAdapter` 那支【不同】。**
 *    ⛔ 我第一版兩支都叫 `ScanQueryError` ⇒ route 那行 `err instanceof ScanQueryError`
 *      比的是**舊那支**(barrel 匯出的是它)⇒ **對我的錯誤永遠是 false**
 *      ⇒ 我的 log 永遠不帶 stage/code, **而我的註解說它帶**(codex nit 1)。
 *    📌 **兩個同名的東西, 而 `instanceof` 比的是身分不是名字。**
 */
export class UnpaidCancelledScanQueryError extends Error {
  constructor(public readonly stage: 'orders' | 'customers', public readonly code: string) {
    // 🔴 訊息只帶【我們自己寫的】stage 與 provider 碼 —— 零 PII、零 provider 原文
    super(`unpaid-cancelled scan 失敗(${stage}/${code})`);
    this.name = 'UnpaidCancelledScanQueryError';
  }
}

async function safeQuery<T>(
  stage: 'orders' | 'customers',
  run: () => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>,
): Promise<T | null> {
  let outcome: { data: T | null; error: { code?: string; message: string } | null };
  try {
    // 🔴 連 error 物件都不接住 —— 接住了就會有人「順手」把它 log 出去,而那裡有 PII
    outcome = await run();
  } catch {
    // 🔴 碼字面用 'rejected' —— **與 Paid scanner 同一個字**(code-reviewer nit 9)。
    //    ⛔ 我原本寫 'throw' ⇒ 同一族兩套字面 ⇒ **凌晨三點 grep 會少撈一半。**
    throw new UnpaidCancelledScanQueryError(stage, 'rejected');
  }
  if (outcome.error !== null) {
    throw new UnpaidCancelledScanQueryError(stage, outcome.error.code || 'unknown');
  }
  return outcome.data;
}

/**
 * 單輪上限。**與 `SupabasePaidOrderScannerAdapter:111` 同值同理由**:
 * `probeLimit` 必須遠小於 `db-max-rows`(2000),否則那一頁被 PostgREST 截斷而
 * `truncated` 判成 false ⇒ **假陰性**。
 */
const MAX_LIMIT = 200;

type OrderRow = {
  id: string;
  display_id: string;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  notification_email: string | null;
  customer_user_id: string;
};

export class SupabaseUnpaidCancelledOrderScannerAdapter implements IUnpaidCancelledOrderScanner {
  constructor(private readonly client: UnpaidCancelledOrderScannerClient) {}

  async listUnpaidCancelledWithoutEmail(
    input: ListUnpaidCancelledWithoutEmailInput,
  ): Promise<ListUnpaidCancelledWithoutEmailResult> {
    // 🔴 多撈一筆當【截斷偵測】—— 與另外兩支同形:`>= probeLimit` 才知道還有沒有下一頁
    // 🔴 `limit` 守門(照 Paid scanner 同形)—— 今天 route 固定傳 50 不會出事,
    //    而 0 / 負數 / 小數會讓 `truncated` 的判定與回傳**一起失真**(codex nit 2)。
    // ⛔ ~~我第一版只有下界, 而註解說「照 Paid scanner 同形」~~ ⇒ **不同形**(code-reviewer nit 5):
    //    🔴 少了上界 ⇒ `probeLimit` 可能逼近 `db-max-rows`(2000)⇒ **`truncated` 假陰性**
    //      ⇒ 那一頁被截斷而我們以為撈完了 ⇒ **剩下的單再也不會被掃到**(anti-join 只問「排過沒」)。
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAX_LIMIT) {
      throw new UnpaidCancelledScanQueryError('orders', 'bad_limit');
    }
    const probeLimit = input.limit + 1;

    const page = await safeQuery('orders', () =>
      this.client
        .from('orders')
        .select(
          'id, display_id, cancelled_at, cancelled_reason, notification_email, customer_user_id, order_cancellations!inner(order_id), email_outbox!left(order_id)',
        )
        .eq('payment_status', 'unpaid')
        .not('cancelled_at', 'is', null)
        // ⛔ ~~「**這一行**是射程本身 —— 逾時自動取消那批不寄(Sean **未拍板**)」~~
        //    🔴 **兩處都錯**(code-reviewer nit 8 + must-fix 2):
        //      ① 射程不在這一行, 在**上面的 `.select()`**(那個 `!inner`)
        //      ② 而逾時不寄是 **Sean 2026-09-03 拍過的乙**, 不是未拍板 —— 見 port 檔頭全文
        // 🔴🔴 **射程靠【那一列存不存在】, 不靠任何欄位的值。**
        //    ⛔ ~~第一版用 `.neq('cancelled_reason', 'payment_expired')`~~ ——
        //      **codex 對抗審查打穿它**:員工選 `other` 時, `cancelled_reason` **就是他打的字**
        //      (a8a1 `:129-136` `v_reason_txt := v_detail`)⇒ 他打 `payment_expired`
        //      ⇒ 他的取消被判成逾時 ⇒ **那封信安靜地不寄**。
        //    📌 **⇒ 病灶不是「不太可能」, 是【判準的種類錯了】—— 我拿【內容】當【身分】。**
        //    ✅ **判別句(下一個人照這句挑)**:
        //      **「這個值有沒有任何一條路徑是【人】填得到的?」有 ⇒ 不能當身分。**
        //
        //    🎯 **而 `order_cancellations` 那一列通過那句話**:
        //      · 員工取消(a8a1)⇒ `INSERT INTO public.order_cancellations`(該檔 3 處)
        //      · 逾時自動取消(`20260828060000`)⇒ 該表命中 **0**
        //      ⇒ 🔵 **我不讀它任何欄位, 只問【存不存在】** —— 而它存不存在,
        //        由**哪一支函式跑過**決定, 不由任何人填。
        //    🔵 而它**不需要 migration**:那張表 `20260730130000` 就在,
        //      `GRANT SELECT … TO service_role`(`:203`)、FK 指向 `orders(id)`(`:72`)
        //      ⇒ embed 得到,而形狀與下面判「還沒排過信」那一組**完全相同**。
        //    🛑 **而過濾是 `!inner` 那個 join 自己做的**(見上面的 `.select`)——
        //      我一度在這裡再加一道 `.not('order_cancellations','is',null)`,
        //      而**那道是多餘的**:`!inner` 已經只回有那一列的單。
        //      ⇒ 📌 **一道不做事的過濾比沒有更糟 —— 它看起來像保護。** 拿掉了。
        .gte('cancelled_at', input.cutoff)
        // ⛔ ~~「與付款信同一個理由:少了它, 一張很舊的單今天才被取消 ⇒ 會被當成新單寄出去」~~
        // 🔴 **那個理由是從付款信整段搬來的, 而它對取消信不成立**(code-reviewer nit 4)——
        //    這封信不是「新單」信。⇒ 而這道閘**實際上會漏掉**
        //    「cutoff 之前建立、cutoff 之後被員工取消」的單 ⇒ **那些人收不到信**。
        // 🔵 今天無害:未付款單 1 天就被 expire(`20260828060000:214`)⇒ 窗口 ≤ 1 天,
        //    而共用的 `B4_DEPLOY_CUTOFF` 早已過去 ⇒ **實際 no-op**。
        // 🛑🛑 **而它會在【Sean 給這條線一顆新 cutoff 的那一天】開始靜靜漏信** ——
        //    那顆 env 正在等他決定(見 route 那一段)⇒ **給了新 cutoff 就要回來刪掉這一行。**
        .gte('created_at', input.cutoff)
        .eq('email_outbox.event_type', 'order_unpaid_cancelled')
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

    const customers = await safeQuery('customers', () =>
      this.client
        .from('customers')
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
        // 🔴 `?? ''` 而不是 `!`:述詞已經保證非 null,而**斷言會在述詞哪天被改時安靜地爆**
        cancelledAt: o.cancelled_at ?? '',
        cancelledReason: o.cancelled_reason,
        notificationEmail: o.notification_email,
        customerEmail: customerEmailById.get(o.customer_user_id) ?? null,
      })),
      scannedPages: 1,
      truncated,
    };
  }
}
