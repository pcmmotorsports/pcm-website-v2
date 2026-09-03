import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// stuck-payment-read.ts — 首頁那一格「扣款重試已放棄:N 張」。
//
// 🔴🔴 **它為什麼存在**(2026-09-03 線 `-db` 盤點,主視窗派):
//    一張扣款重試被放棄的單,標記是 `payment_charge_attempts.needs_manual_review = true`。
//    ⚠️ **行為正本在 DB**:`20260615120001_m3_3ds_4a2_attempt_sweeper_rpc.sql:161-174`
//       (`flag_non_unpaid_active_attempts`)。`packages/use-cases/src/settle-charge.ts:198`
//       **是一行【註解】在轉述它, 不是碼** —— 兩者不要弄反。
//    🔬 **盤點當時的數字, 帶分母(2026-09-03 線 `-db` 量, 分母寫在數字旁邊)**:
//       · 讀那個欄位的檔 = **39**(`grep -rl`, 限 `*.ts` `*.tsx` `*.sql`,
//         範圍 `apps packages supabase scripts`, 排除 `.next/`)
//         ⚠️ 不限副檔名會是另一個數 —— **這個數字沒有分母就不成立。**
//       · **後台(`apps/admin/src`)非測試檔 = 2**(`cancel-view.ts` / `cancel-review-section.tsx`)
//         ⚠️ 那是**本檔出生之前**的值;本檔一加進去就是 3 ——
//         📌 **一把用來證明「後台看不到」的尺, 分母裡有它自己的補丁。**
//       · 兩支都在【取消】那條流程裡(`lib/orders/cancel-view.ts:125` /
//         `components/orders/cancel-review-section.tsx:159`)⇒ 它是**取消按鈕上的一道閘**,不是畫面。
//    ⇒ 🎯 而訂單列表的篩選軸(`app/orders/page.tsx:36`)是
//      【付款 / 出貨(單選)+ 來源/管道(多勾選)+ 單號搜尋(flag)】——
//      ⚠️ ~~「只有付款/出貨」~~ 那樣寫吃掉了兩軸,照原文寫。
//      ⇒ **而那幾軸裡沒有「重試被放棄」這一軸** ⇒ 員工要**已經點進那一張單**才看得到,
//        而他不會知道要點哪一張。
//
// 🔴🔴 **而它必須在【零張】的時候印 `0`,不是什麼都不印** —— 這是本片的驗收條件,不是風格:
//    同一天量到三個同形狀的東西(車款排程 / 兩顆 env / 雙扣告警),它們的共同病是
//    **「該叫才叫」⇒ 沉默有兩種意思,而收訊端分不出來**:
//      「今天沒事」與「它被關掉了 / 它壞了」印同一個空白。
//    ⇒ 📌 所以這一格是**儀表**:它每天都印一個值,而**印不出來時印「量不到」**。
//
// 🔴 **`unreadableReason` 不可以被兜成 `0`** —— `0` 是最漂亮的那一格,
//    而它正好是讀不到時最容易長出來的樣子。形狀抄隔壁
//    `lib/mail/dead-letter-count-read.ts` 的 `unreadableCount`,**不自創第二種寫法**。
//
// ✅ **授權查過了**:`GRANT SELECT ON TABLE public.payment_charge_attempts TO service_role`
//    (`supabase/migrations/20260612150000_m3_s2d_charge_attempts.sql:121`)。
//    ⚠️ 而**同一支檔 `:111` 的表註解逐字寫著「表零直接權限(RLS 零 policy)」**
//    ⇒ 🛑 那句話講的是**非 owner 角色直查**,而 `service_role` 的 GRANT 就在 8 行之後。
//      📌 **我差一點因為那句註解判定這一格做不出來** —— 註解與 DDL 相鄰而說的是兩件事,
//         **只有把 GRANT 那行 grep 出來才分得開。**
//
// 🛑 **這一格【不會】做到什麼**(照實寫,不得被讀成「卡單有人管了」):
//    · 它是**儀表不是警報** ⇒ 沒有人打開後台就沒有人看見(同 `freshness-read.ts` 那兩行灰字)。
//    · 它答的是「現在有幾張」,**不答「這張卡多久了」**,也不答「是誰的單」。
//    · 真正在**通知**的是另一條線(`packages/domain/src/payment/anomaly-alert.ts` + 那兩支
//      `m3_250` / `m3_256` migration,出口 Email + LINE)⇒ **而它掛在 `ANOMALY_ALERT_ENABLED`
//      後面,且它沒有心跳**(零卡單時它什麼都不印)。本片**沒有解那一格**,單獨立列。

/** 本支自己的逾時上限(毫秒)。 */
//
// 🔴🔴 **為什麼新增的查詢要自己包 timeout**:首頁那幾支跑在同一個 `Promise.allSettled`,
//    而 `allSettled` **隔離得了【失敗】,隔離不了【永遠不回】** ⇒ 任何一支卡住整頁跟著卡。
//    ⇒ 這是 codex 對 `loadFitmentFreshness` 的裁定,逐字:
//      「原五支也有問題不能免除新增第六個失效點,且可只替新查詢加 timeout」
//    ⇒ 📌 **「別人也有」不是「我可以再加一個」的理由** ⇒ 本支照那個裁定自己包。
// ⚠️ 而它**做不到**「首頁不卡」——其餘幾支仍然沒有 timeout;本支只做到**它自己不再是那個吊住整頁的人**。
// ⚠️ 逾時之後那個 fetch 仍在背景跑(這裡只是不再等它),我們沒有取消請求。
const STUCK_PAYMENT_QUERY_TIMEOUT_MS = 5_000;

export type StuckPaymentCount = {
  /**
   * 系統放棄自動重試、而**仍然鎖著那張單**的扣款嘗試筆數。
   *
   * 🔴 **`null` = 量不到**(查詢失敗 / 逾時 / 拿不到 count)。**絕不得在顯示端被兜成 `0`。**
   */
  readonly count: number | null;
  /** 量不到時的一句話理由(顯示端要印出來,不准留白)。量得到 ⇒ `null`。 */
  readonly unreadableReason: string | null;
};

export function unreadableStuckPayment(reason: string): StuckPaymentCount {
  return { count: null, unreadableReason: reason };
}

/**
 * 顯示端那一行字。
 *
 * 🔴🔴 **零張時印「0 張」,不是不印** —— 見檔頭。這一行在【有卡單】【零卡單】【量不到】
 *    三個世界印**三個不同的東西**,而**三個都會印**。
 */
export function stuckPaymentLabel(c: StuckPaymentCount): string {
  if (c.count === null) {
    return `扣款重試已放棄:量不到(${c.unreadableReason ?? '原因不明'})`;
  }
  return `扣款重試已放棄:${c.count} 張`;
}

/**
 * 系統放棄自動重試的扣款嘗試有幾筆。
 *
 * 🔴🔴 **謂詞是兩個條件**:
 * ```
 * needs_manual_review = true      自動重試已放棄
 * status IN ('pending','charged') 而它尚未終局
 * ```
 * · `failed` **不算**, 而理由不是「釋鎖」那麼鬆 —— 硬的那個是:
 *   `released_closed_at IS NOT NULL ⇒ status='failed'`
 *   (`20260624120000_m3_3ds_r1a1_released_status_columns.sql:87-88`)
 *   ⇒ **`failed` + 標記 = 人已經結案**, 不是「還要人處理」。
 * · **不加第三個條件**(例如 join orders 排除非 `unpaid`):那會殺掉
 *   `flag_non_unpaid_active_attempts`(`20260615120001_m3_3ds_4a2_attempt_sweeper_rpc.sql:161-166`)
 *   的**全部產出** —— refunded/partiallyPaid 殘留正是它存在的唯一理由, 那一族是真的要人處理。
 *
 * 🔴🔴 **而它【看不到】哪一族 —— 這一段是本函式最重要的射程聲明, 不要刪**:
 *    `status` 有**四**個值,第四個是 `released`
 *    (`20260624120000:46` `CHECK (status IN ('pending','charged','failed','released'))`)。
 *    而 released 那一族的人工佇列**走另一個欄**:`released_manual_review_at`(同檔 `:52`)——
 *    🛑 **`needs_manual_review` 對 released 設計上永不為 true**
 *      (`20260624120008_m3_3ds_r1c1_sweeper_released_policy.sql:148-150` 逐字
 *       「released 繞 ceiling、不誤標 needs_manual_review」)。
 *    ⇒ 🎯 **所以這個數字對 released 那一族【結構上】是零** —— 方向是**少報**。
 *    ⇒ ⇒ **少報比多報糟:東西掉在地上, 不會有東西叫。**
 *    📌 **⇒ 所以這一行字面刻意只說「扣款重試已放棄」, 不說「系統放棄的付款」** ——
 *       後者宣稱了它涵蓋全部卡住的付款, 而它沒有。**不要宣稱超過你量到的東西。**
 *    ⚠️ **而「released 今天到底有沒有在產生」我【沒有量】** —— 不得寫成「Phase 1 不可達」:
 *       release 的呼叫端**今天存在**(`apps/storefront/src/app/checkout/charge-actions.ts:239`
 *       → `composition.ts:150 getReleaseSibling`), 而 `TAPPAY_3DS_ENABLED` 的狀態
 *       在 `apps/storefront/src/lib/payment/three-ds-flag.ts:17-27` 有**兩個互相矛盾的說法並存**。
 *    ⇒ 收 released 那一族 = **另一片**(它要讀另一個欄、另一組語意), 本片不擴。
 *
 * 🛑 **另外兩個盲區**:
 *    · **已知的窄窗多報**:`20260615120001:43-46` 逐字記著殘餘 TOCTOU 會留下
 *      `paid + needs_manual_review=true` = 「cosmetic 假人工告警」⇒ 這個數字會多算那一種。
 *      本片**不加 `paid` 閘**(加了要 join orders, 是另一片的體積)。
 *    · 標記被清掉、或人處理完之後那一筆怎麼收尾,**我沒有量** ——
 *      **那要一次真實的人工處理才答得出來, 讀碼答不出來。**
 */
export async function loadStuckPaymentCount(): Promise<StuckPaymentCount> {
  // 🔴 `head: true` + `count: 'exact'` ⇒ 只回筆數、不搬列(首頁每次進站都跑)。
  //    形狀抄 `today-read.ts:253`,不自創第二種寫法。
  const query = createSupabaseServiceClient()
    .from('payment_charge_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('needs_manual_review', true)
    .in('status', ['pending', 'charged'])
    .then(
      (v) => v as { count: number | null; error: unknown },
      (error: unknown) => ({ count: null, error }),
    );

  // 🔴 逾時走哨兵值不走 reject —— 「逾時」與「查詢失敗」要印**不同的原因**,
  //    而讀的人看到哪一個,決定他下一步去查哪裡。形狀抄 `freshness-read.ts` 的 `loadFitmentFreshness`。
  const TIMEOUT = Symbol('stuck-payment-query-timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const res = await Promise.race([
    query,
    new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), STUCK_PAYMENT_QUERY_TIMEOUT_MS);
    }),
  ]).finally(() => {
    // 🔴 沒有這一行,測試環境會被那顆 timer 吊著不結束(而正常路徑上它永遠不會觸發)。
    if (timer !== undefined) clearTimeout(timer);
  });

  if (res === TIMEOUT) {
    console.error('[stuck-payment-read] 系統放棄的付款筆數查詢逾時', STUCK_PAYMENT_QUERY_TIMEOUT_MS);
    return unreadableStuckPayment(`查詢逾時(${STUCK_PAYMENT_QUERY_TIMEOUT_MS / 1000} 秒)`);
  }
  if (res.error) {
    console.error('[stuck-payment-read] 系統放棄的付款筆數讀取失敗', res.error);
    return unreadableStuckPayment('查詢失敗');
  }
  // 🔴 `count` 回 `null` 時**不當成 0** —— 那會把「我們沒拿到數字」印成「一張都沒有」。
  //    (同 `dead-letter-count-read.ts` 那條「拿不到總數」。)
  if (res.count === null) return unreadableStuckPayment('拿不到筆數');
  return { count: res.count, unreadableReason: null };
}
