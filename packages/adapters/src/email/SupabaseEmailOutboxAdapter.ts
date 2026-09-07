/**
 * @module @pcm/adapters/email/SupabaseEmailOutboxAdapter — email_outbox 狀態機 adapter(M-4a E1b)
 *
 * 實作 `IEmailOutbox`(寫入/認領/標記/假信箱 gate)對表 `public.email_outbox`
 * (migration `20260717020000`、已 apply;ACL=GRANT INSERT/SELECT/UPDATE service_role、plan §4.3)。
 * client 注入 **service_role**(anon/authenticated 對本表零權限);本 class 不持金鑰、不做 authorization,
 * 只能由 server-side 受控模組組裝(export 走 @pcm/adapters/server subpath、composition 於 E2a/E3)。
 *
 * 🔴 REQUIRED-E1b 落表邊界(codex 關卡2 R1 must-fix 後收緊):
 * - enqueue 只收事件來源欄位;payload(`buildOrderCreatedPayload` runtime allowlist)/subject
 *   (固定模板)/dedup_key(=orderId)全在本檔內部重組 → 呼叫端無法偷渡任意物件/字串落表。
 * - markFailed 的 errorCode 落表前過 **runtime allowlist**(TS union 只是編譯期;`as` 硬轉/JS 呼叫
 *   端仍可能塞過 DB regex 的 PII 字串)→ 非 allowlist 一律改寫 `provider_error`。
 * - 🔴 mark* 三出口皆帶 `claimedAttempts` 世代柵欄:lease 回收 + 他人再認領後(attempts 已 +1),
 *   舊持有者延遲到達的標記 `.eq('attempts', 舊世代)` 必 0 列 → 不覆寫別人的在途列(ABA 擋掉)。
 * - 🔴 **離開 sending 的第四條路 = `reclaimStaleLeases`(E2a-a)**:回收器**不是持有者、不帶世代
 *   柵欄**(帶不了),以 `claimed_at < staleBefore` 述詞判定所有權 —— 故「mark* 三出口皆帶柵欄」
 *   **不等於**「所有離開 sending 的路都有柵欄」。兩條路的共同義務只有 `claimed_at = NULL`。
 *
 * ✅ **2026-08-11 #415:窄 cast 已拆** —— `EmailOutboxClient` 現在直接是 `SupabaseClient<Database>`,
 * composition 端不再 `as unknown as`。`email_outbox` 的**表名、欄名、回傳列形狀**由生成型別把關
 * (該表在 `database.types.ts`;突變證:把 `.from('email_outbox')` 或任一欄名加 `_TYPO` ⇒ tsc 當場紅)。
 * ⚠️ **型別放寬與否與世代柵欄無關**:mark* 三出口的 `.eq('attempts', claimedAttempts)` 是**執行期述詞**,
 * 型別層從來沒有在守它(守它的是本檔的單元測試);拆 cast 沒有動到那一層,也沒有讓它變弱。
 *
 * 🔴 PostgREST 限制與對策(語意仍守 REQUIRED-E2a):
 * - 不支援欄對欄比較(`attempts < max_attempts`)→ due 掃描取 `DUE_SCAN_CAP` 大窗、app 層過濾後
 *   才裁 limit(🔴 不可先 limit 再過濾:死列 next_retry_at 恆最老、恆佔滿窗口 → dead letter 積到
 *   limit 件時活信永久餓死;code-reviewer R1 Critical);CAS 用讀到的 `attempts`/`max_attempts`
 *   **字面值**進 WHERE(`eq(attempts, 讀值)` 樂觀鎖 + `lt(attempts, max)`)—— 讀後被任何人動過
 *   該列 → CAS 0 列 = 輸,語意同「guard 在 CAS 內原子生效」(TOCTOU 擋住)。
 * - 不支援 SQL 表達式賦值 → `attempts+1` 由 app 算、配上述樂觀鎖不會丟失更新。
 * - `claimed_at`/`sent_at` 與 due 比較的 `next_retry_at <= now` 皆用 app 時鐘 ISO(DB 只強制
 *   「非 NULL ⟺ sending」、「是 now()」本就是 app 合約;app 鐘落後 DB 鐘時 claimById 可能 miss
 *   剛 insert 的列=僅延遲至 sweeper 補、無正確性破口;偏差遠小於 lease ≥1h 的比較粒度)。
 *
 * 🔴 假信箱 gate(plan §3.4):**規則不複製一份**、由 composition 注入 `@pcm/schemas` 的 `isSyntheticEmailDomain`
 *    (`#858` 片0-a 起;~~注入 `LINE_SYNTHETIC_EMAIL_DOMAIN` 字串~~ 已不是這個形狀)
 * (單一來源 = apps/storefront/src/lib/auth/line.ts:38;packages 不可反向 import app 層檔案,故走
 * 建構參數、必填無預設)。比對前雙邊正規化(trim+lowercase);否決 MX 即時查詢(網路依賴進寫入路徑)。
 */
import 'server-only';

import type {
  IEmailOutbox,
  EnqueueEmailInput,
  EnqueueEmailResult,
  ClaimedEmailJob,
  EmailOutboxEventType,
  EmailSendErrorCode,
  OrderCreatedEmailPayload,
  OrderShippedEmailPayload,
  ShipmentTrackingCorrectedEmailPayload,
} from '@pcm/ports';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../supabase/database.types';

import {
  buildOrderCreatedPayload,
  buildOrderShippedPayload,
  orderCreatedSubject,
  buildOrderCancelledPayload,
  buildOrderUnpaidCancelledPayload,
  buildShipmentTrackingCorrectedPayload,
  orderShippedSubject,
  trackingCorrectedSubject,
  orderCancelledSubject,
  orderUnpaidCancelledSubject,
  bankOrderCreatedSubject,
  bankOrderCreatedDedupKey,
  buildBankOrderCreatedPayload,
} from './order-email-assembly';

/** PostgREST unique_violation(需再查核同事件才可回 duplicate,見 enqueue)。 */
const PG_UNIQUE_VIOLATION = '23505';

/** 可被認領的狀態(migration §⑦:failed 是可重試態、非終態)。 */
const CLAIMABLE_STATUSES = ['pending', 'failed'] as const;

/**
 * due 掃描單次取列上限(恆 ≥ caller limit)。死列(attempts>=max)無法在 PostgREST 端過濾
 * (欄對欄限制)且 next_retry_at 恆最老 → 必須取大窗、app 層過濾後才裁 limit,否則死列佔滿
 * 窗口 = 活信餓死。死列數 > 本上限的世界裡,dead-man 訊號 2(dead letter count)早已連續告警,
 * 正解是清理 job(backlog #281),不是再放大窗口;量級對照:PCM 每日數十封。
 */
const DUE_SCAN_CAP = 200;

/**
 * 🔴 **它在數什麼**(2026-09-07;主視窗訂正的那條:寫死的數旁邊要有一句【它在數什麼】,
 *    而不只是「怎麼數出來的」—— 📌 **「過期」重量一次就有解;「單位不同」重量一百次都不會發現**):
 *    `DUE_SCAN_CAP` 數的是**這一發 SQL 撈回來的列數上限**(`.limit()` 的參數),
 *    **不是**「有多少封信到期」、**也不是**「這一輪會寄幾封」(那是 `limit`)。
 *
 * 🔬 **今天為什麼不咬人**:正式庫 `email_outbox` 總列數是**個位數**(2026-09-07 唯讀量到 5 列)
 *    ⇒ 200 遠大於分母。⚠️ **而「今天不咬人」不是「不會咬」** —— 到期日**不在它自己身上**:
 *    它取決於 outbox 長多大, 而那由清理 job(backlog #281)與流量決定。
 * 🛑 **咬到的時候會怎樣**:撈滿 200 列 ⇒ 排序是 `next_retry_at` 最舊優先
 *    ⇒ **恆最老的那批(含被 `exclude` 濾掉、與 `attempts >= max_attempts` 的死列)會佔滿整個窗**
 *    ⇒ ⇒ **活信排在它們後面, 一輪都認領不到 —— 而每一輪都印全綠、沒有任何錯誤。**
 * ✅ **所以下面那一發撈滿時要出聲** —— 見 `claimDue` 裡的 `DUE_SCAN_CAP` 警告。
 */

/**
 * 🔴 runtime 錯誤碼 allowlist(與 @pcm/ports EmailSendErrorCode union **窮舉**同步:
 * `Record<union, true>` 逼出每一個成員,union 新增碼漏改這裡 typecheck 必紅——codex R2 nit:
 * `satisfies T[]` 只驗「列的都合法」、驗不了完整性,漏列會讓新合法碼被靜默降級)。
 * markFailed 落表前查此表,非成員一律改寫 provider_error(TS union 擋不住 `as`/JS 呼叫端)。
 */
const EMAIL_SEND_ERROR_CODE_FLAGS: Record<EmailSendErrorCode, true> = {
  http_400: true,
  http_401: true,
  http_403: true,
  http_404: true,
  http_408: true,
  http_409: true,
  http_422: true,
  http_429: true,
  http_500: true,
  http_502: true,
  http_503: true,
  http_504: true,
  // E1c(Sean Q6=A):429 三分;退避政策見 @pcm/ports EmailSendErrorCode 逐碼 JSDoc。
  rate_limited: true,
  quota_daily_exceeded: true,
  quota_monthly_exceeded: true,
  network_error: true,
  provider_error: true,
  // ⟦b4-RESEND409⟧ 2026-09-07:Resend 第三種 409(重試永遠不會成功)。
  // 🔵 它落表安全 —— DB 那道 CHECK 是【格式】不是白名單(`20260717020000:343` 逐字
  //    `^[a-z0-9_]{1,64}$`), 而這個字面 28 字元、全小寫底線 ⇒ 過。**不需要 migration。**
  idempotency_payload_mismatch: true,
};
const EMAIL_SEND_ERROR_CODE_ALLOWLIST = new Set<string>(Object.keys(EMAIL_SEND_ERROR_CODE_FLAGS));

/**
 * ⟦b4-EMAILTRIAGE⟧ 甲-7 的稽核碼。**刻意不是 `EmailSendErrorCode` 成員** ——
 * 它描述的是「這封信在【送出之前】就準備不起來」(context 讀不到 / deps 缺 / 單號對不上),
 * 不是「Resend 寄送失敗」。走 `markFailed` 會被上面那個 allowlist 改寫成 `provider_error`
 * ⇒ 🛑 稽核碼被靜默吃掉, 而**告警與統計都是按那個值域切的**。
 * 🔵 與 `order_ineligible` / lease 回收碼(`:131` 起那段)同一個做法, 不是新發明。
 */
const PREPARE_FAILED_ERROR_CODE = 'prepare_failed';

/**
 * lease 回收的稽核碼(Sean Q2=A)。**刻意不是 `EmailSendErrorCode` 成員**:它描述的是「本地程序
 * 死掉」、不是「Resend 寄送失敗」——若走 markFailed 會被上面的 allowlist 改寫成 provider_error
 * (稽核碼被靜默吃掉)。故比照 `order_ineligible` 在本檔內部寫死;過 DB CHECK `^[a-z0-9_]{1,64}$`。
 */
const LEASE_RECLAIMED_ERROR_CODE = 'lease_reclaimed';

/** 表投射(對齊 migration 16 欄中寄送所需子集;不取 created_at/sent_at/last_error_code)。 */
const JOB_SELECT =
  'id, event_type, order_id, dedup_key, recipient_email, subject, payload, attempts, max_attempts, request_id';

type OutboxJobRow = {
  id: string;
  event_type: string;
  order_id: string;
  dedup_key: string;
  recipient_email: string;
  subject: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
  request_id: string | null;
};

type OutboxResponse = {
  data: OutboxJobRow[] | null;
  error: { code?: string; message: string } | null;
};

/**
 * email_outbox 查詢鏈最小呼叫面 —— **2026-08-11 #415 後只剩測試替身在用**
 * (`SupabaseEmailOutboxAdapter.test.ts` 拿它當假 builder 的形狀;production 端已改用真 client 型別)。
 * thenable = PostgREST builder 本身可 await。
 * ⚠️ 它不再是 production 路徑的型別來源 ⇒ 它與生成型別漂了也不會讓 production 型別紅;
 *    這是**刻意的**:測試替身要的是「能被 await 的鏈」,不是整份 PostgREST 泛型。
 */
export type EmailOutboxQueryBuilder = PromiseLike<OutboxResponse> & {
  insert(row: Record<string, unknown>): EmailOutboxQueryBuilder;
  select(columns: string): EmailOutboxQueryBuilder;
  update(values: Record<string, unknown>): EmailOutboxQueryBuilder;
  eq(column: string, value: string | number): EmailOutboxQueryBuilder;
  in(column: string, values: readonly string[]): EmailOutboxQueryBuilder;
  lt(column: string, value: string | number): EmailOutboxQueryBuilder;
  lte(column: string, value: string | number): EmailOutboxQueryBuilder;
  order(column: string, opts: { ascending: boolean }): EmailOutboxQueryBuilder;
  limit(count: number): EmailOutboxQueryBuilder;
};

export type EmailOutboxClient = SupabaseClient<Database>;

export type SupabaseEmailOutboxAdapterConfig = {
  /**
   * 假信箱判斷式(必填、無預設)。composition 必須傳 `@pcm/schemas` 的 `isSyntheticEmailDomain`;
   * 測試才允許傳自訂的假判斷式。
   *
   * 🔴🔴 **這裡刻意收【判斷式】而不是【網域字串】(`#858` 片0-a)。**
   * 原本收的是字串、本檔自己做「域名等值比對」⇒ 同一條規則在兩個地方各寫一份,而它們**已經分岔了**:
   *
   * ⚠️ **更正(codex R1 MF2)**:我原本寫「這個 package **不能** import `@pcm/schemas`」——
   *    **那句是錯的**。實測到的是「**現在沒有宣告這個依賴**」(`packages/adapters/package.json`
   *    的 dependencies = `@pcm/domain` / `@pcm/ports` / `@supabase/supabase-js` / `pg` / `server-only`),
   *    而「沒宣告」與「不能」是兩件事 —— 加一行依賴就能 import。
   *    ⇒ 誠實的說法是:**我選擇不加那個依賴**,理由 = 動 package 依賴圖是架構決定、
   *      該有自己的片與自己的審查,不該夾在一個修守門的片裡順手做掉。
   *    ⇒ **代價寫在下面「fail-open」那段,不藏。**
   *   `@pcm/schemas` 認子網域 / 本檔只認完全相等
   *   ⇒ `xxx@manual.line.pcmmotorsports.local` 一邊擋一邊放
   *      (2026-08-23 修閘前實測,`~/pcm-mailbox/線C-858-片0a-修閘前量測-20260823.md` 第 4 列)。
   * ⇒ **收判斷式 = 這個 package 不再擁有那條規則** ⇒ **「兩份規則各自演化」那種分岔消失了。**
   * ⚠️ **但不要讀成「再也不會錯」**(codex R3:原句與下面那段自相矛盾):
   *    規則只有一份,**而「有沒有接到那一份」是另一回事** —— 見下面 fail-open 那段。
   *    ⇒ 分岔的風險**換了形狀**,不是歸零:從「兩份規則不一樣」變成「接錯了沒人叫」。
   *
   * 🔴🔴 **而它換來一個新的失敗面:注入錯的東西 = fail-open**(codex R1 MF2)。
   *    `isSyntheticEmail: () => false` 是**完全合法的注入** ⇒ 假信箱照樣落 `pending` ⇒ 照樣寄出去。
   *    · 沒傳 config / 傳 `undefined` ⇒ **fail-closed**(TypeError,停在 insert 之前)—— 測試釘住。
   *    · 傳一個「永遠說不是」的判斷式 ⇒ **fail-open**,型別層擋不住。
   *    ⇒ 唯一的防線是 `apps/storefront/src/lib/email/composition.test.ts` 那一格:
   *      它用 `toBe` 釘住注入的**必須是 `@pcm/schemas` 那一份函式本人**。
   *      **誰把注入換成本地實作,那一格當場紅。**
   * ⚠️ 誰要把它改回收字串,請先讀那份量測:分岔的代價是**假信箱被送去 Resend**
   *    (`20260717020000_m4a_email_outbox.sql:28-31` 逐字:bounce rate 要求 <4%、
   *     傷害已驗證網域 `pcmmotorsports.com` 的寄件信譽 = 全站共用資產)。
   */
  isSyntheticEmail: (email: string) => boolean;
};

function mapRowToJob(row: OutboxJobRow): ClaimedEmailJob {
  return {
    id: row.id,
    eventType: row.event_type as EmailOutboxEventType,
    orderId: row.order_id,
    dedupKey: row.dedup_key,
    recipientEmail: row.recipient_email,
    subject: row.subject,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    requestId: row.request_id,
  };
}

/**
 * 依事件型別組出落表的三樣東西:`payload` / `subject` / `dedup_key`。
 *
 * 🔴 **這支是「事件⇔形狀」的單一分派點。** 拆出來的理由不是好看:
 * `enqueue` 與 `resolveUniqueViolation` **都要算 dedup_key**,而兩邊各寫一份的話,
 * 漂掉的症狀是「撞鍵之後回查查不到 ⇒ 每輪 throw ⇒ 那封信永遠排不進去」,**而型別不會紅**。
 *
 * 🔴 `order_shipped` 的 dedup_key = `{shipment_id}:{order_id}`。
 *    唯一鍵是 `(event_type, dedup_key)` 且**不含 order_id**(`20260717020000:377`),
 *    `:350` 明文要求同 event_type 內**全域唯一** ⇒ 只用 order_id 會讓
 *    **同一張單的第二箱被當成 duplicate 吞掉 = 漏一封信**。
 *    ⚠️ **SQL 側有第二份實作**:`public.pcm_shipped_email_dedup_key(uuid, uuid)`
 *    (`supabase/migrations/20260822010000_m4b_e4a_shipped_email_scan_view.sql` §4),
 *    掃描 view 的 anti-join 用的是那一支。**兩份漂掉 ⇒ 同一封信重複排入、重複寄出。**
 *    ⇒ `order-email-assembly.test.ts` 有一格釘住這裡的字面形狀;改任一邊之前先看另一邊。
 *
 * ⚠️ 沒有 `default` 分支是刻意的:`satisfies never` 讓「將來新增事件卻忘了在這裡分派」
 *    在 **typecheck 當場紅**,而不是等到執行時把新事件寄成舊模板。
 */
function composeEvent(input: EnqueueEmailInput): {
  payload:
    | OrderCreatedEmailPayload
    | OrderShippedEmailPayload
    | ShipmentTrackingCorrectedEmailPayload
    | ReturnType<typeof buildOrderCancelledPayload>
    | ReturnType<typeof buildOrderUnpaidCancelledPayload>
    | ReturnType<typeof buildBankOrderCreatedPayload>;
  subject: string;
  dedupKey: string;
} {
  switch (input.eventType) {
    case 'bank_order_created': {
      // 🔴 ⟦b4-BANKNOEMAIL⟧:一單一封 ⇒ dedup_key = orderId。
      //    🛑 **與 order_created 同一個 key 值, 而【不同 event_type】** ——
      //    唯一鍵是 (event_type, dedup_key) ⇒ 兩封各自有自己的一封, 不會互相擋掉。
      //    📌 那正是本片開新 event_type 而不是共用 order_created 的理由。
      const payload = buildBankOrderCreatedPayload({
        displayId: input.displayId,
        createdAt: input.createdAt,
        total: input.total,
        balanceDue: input.balanceDue,
      });
      return {
        payload,
        subject: bankOrderCreatedSubject(payload.display_id),
        // 🔴 **不是單純的 orderId**(codex R1-#4 / 45f):快照過期被標終態之後,
        //    45f 讓那張單重新進得了掃描面 —— 而 `UNIQUE (event_type, dedup_key)`
        //    會讓第二次 INSERT 撞唯一鍵 ⇒ 📌 **那張單永遠停在那裡。**
        //    ⇒ 指紋涵蓋【會讓那封信變得不一樣】的三個值, 與寄送前重驗比對的那三個**同一組**。
        dedupKey: bankOrderCreatedDedupKey({
          orderId: input.orderId,
          total: input.total,
          balanceDue: input.balanceDue,
          recipientEmail: input.recipientEmail,
        }),
      };
    }
    case 'order_created': {
      const payload = buildOrderCreatedPayload({ displayId: input.displayId, paidAt: input.paidAt });
      // migration §①:order_created 一單一封 ⇒ dedup_key = orderId。
      return { payload, subject: orderCreatedSubject(payload.display_id), dedupKey: input.orderId };
    }
    case 'order_shipped': {
      const payload = buildOrderShippedPayload({
        displayId: input.displayId,
        // 🔴 進 payload:寄送時要拿它去主表撈品項與追蹤碼(`IShippedEmailContext`)。
        //    ~~原本只進 dedup_key~~ —— 那會逼 sweeper 去解析一個沒有 DB 格式保證的字串。
        shipmentId: input.shipmentId,
        shipmentReference: input.shipmentReference,
        shippedAt: input.shippedAt,
      });
      return {
        payload,
        subject: orderShippedSubject(payload.display_id, payload.shipment_reference),
        dedupKey: `${input.shipmentId}:${input.orderId}`,
      };
    }
    case 'shipment_tracking_corrected': {
      const payload = buildShipmentTrackingCorrectedPayload({
        displayId: input.displayId,
        shipmentId: input.shipmentId,
        shipmentReference: input.shipmentReference,
        trackingNumber: input.trackingNumber,
        trackingCorrectedKey: input.trackingCorrectedKey,
      });
      return {
        payload,
        subject: trackingCorrectedSubject(payload.display_id, payload.shipment_reference),
        // 🔴🔴 **dedup_key = 箱 + 【這一次更正的時點】。**
        //    ⛔ ~~原本是 箱 + 【單號】(主視窗 2026-09-04 先拍的【乙】)~~
        //    ⇒ **同日 codex 對抗審查抓到它的漏, 主視窗改拍【Q1 甲】**:
        //      A→B(寄過)、B→C(寄過)、**再改回 B** ⇒ 舊的 B 鍵還在
        //      ⇒ 最新那封永遠不寄, 而客人手上那封說的是 C。
        //    📌 原理由「客人要的是【哪一個號碼是對的】, 不是【你改過幾次】」
        //      在 A→B→C 完全成立 —— **它沒涵蓋【改回去】。**
        //    🔵 而「連改多次不會變成一串信」由**寄送當下比對即時值**那道閘收斂
        //      (不符 ⇒ `markSkippedTrackingSuperseded`), 不靠鍵去收斂。
        //    🛑 **`trackingCorrectedKey` 原樣接上, 這裡不碰時間** —— 兩邊各格式化一次會漂,
        //      而漂掉的症狀是同一封信寄兩次(見該欄的 JSDoc)。
        // 🔴 **`orderId` 在鍵裡**(codex R2 must-fix #2):一箱可以裝多張訂單,
        //    而拍板是「一箱兩單就寄兩封, 一封講一張訂單」⇒ 少了它, 第二張單那封
        //    會撞到第一張的鍵 ⇒ `enqueue` 回 `duplicate` ⇒ **安靜地不寄**。
        dedupKey: `${input.shipmentId}:${input.orderId}:${input.trackingCorrectedKey}`,
      };
    }
    case 'order_cancelled': {
      const payload = buildOrderCancelledPayload({
        displayId: input.displayId,
        cancelledAt: input.cancelledAt,
        cancelledReason: input.cancelledReason,
        refundedAmount: input.refundedAmount,
        refundKind: input.refundKind,
      });
      return {
        payload,
        subject: orderCancelledSubject(payload.display_id),
        // 🔴 **dedup 用 orderId** —— 與 `order_unpaid_cancelled` 同一個理由:
        //    一張單只會被取消一次 ⇒ 不用 cancelledAt(時刻會變 ⇒ 同一張單重排兩封)。
        dedupKey: input.orderId,
      };
    }
    case 'order_unpaid_cancelled': {
      const payload = buildOrderUnpaidCancelledPayload({
        displayId: input.displayId,
        cancelledAt: input.cancelledAt,
        cancelledReason: input.cancelledReason,
      });
      return {
        payload,
        subject: orderUnpaidCancelledSubject(payload.display_id),
        // 🔴 **dedup 用 orderId** —— 一張單只會被取消一次(a8a1 有已取消守門)⇒ 與 order_created 同形。
        //    🛑 而**不用 cancelledAt**:時刻會變, 而那會讓同一張單重排兩封。
        //    (出貨信用 shipmentId 是因為一張單真的會分批出貨;取消不會。)
        dedupKey: input.orderId,
      };
    }
    default:
      // 🔴🔴 **這一行【就是】那條「模板不可後行」規矩的機制**(2026-08-30 線D 量到並突變驗過)。
      //    `20260822010000_..._shipped_email_scan_view.sql:260` 那段註解寫著
      //    「這一條【沒有機制在守】—— 它是一句規矩」⇒ **那句話錯了一半。**
      //    ✅ 加了新的 eventType 而沒加 case ⇒ 這一行編不過(突變實測:拿掉
      //       `case 'order_shipped'` ⇒ typecheck rc=2,TS2739 + TS1360)。
      //    ⇒ **所以「模板不存在」那一半不需要規矩,它已經是一個編譯錯誤。**
      //
      // 🔴 **而那條註解【對的那一半】在別的地方**:模板【存在】而在執行期 throw
      //    (`order-email-assembly.ts:89-95` 的 `requireNonEmptyString`:
      //     `shipment_reference` / `shipped_at` 為空 ⇒ throw)——
      //    型別看不到它(空字串也是 string),而後果是**永久的**:
      //    燒完 attempts ⇒ `status='failed'` ⇒ 而那個 view 的 anti-join 不分 status
      //    ⇒ 那一封信再也不會被排進來。
      //    ⚠️ 那一半**還沒有機制**,已登記上板(修法在 view 的 WHERE,要 migration ⇒ 另一片)。
      //
      // ⚠️ **而那段註解為什麼不就地更正**:那支 migration 已 apply,
      //    而 `APPLIED.tsv` 記的是**它的內容 hash**(當場比對 ⇒ 相同)
      //    ⇒ **改一個字都會讓帳本分岔** ⇒ 所以更正寫在這裡,不寫在那裡。
      return input satisfies never;
  }
}

/**
 * `countNewEvents` 一次最多接幾筆(硬上限, 超過 throw)。
 * 🔵 真實呼叫端一輪最多送 `ENQUEUE_LIMIT = 50` 筆(`apps/storefront/src/app/api/cron/email-sweep/route.ts:168`),
 *    這個 200 是**四倍餘裕**, 不是預期值 —— 它擋的是「有人日後把 limit 調大而沒想到這裡」。
 * ⚠️ **改走 RPC 之後, 它擋的東西換了**:⛔ ~~原本擋的是 URL 長度~~(RPC 走 POST body, 那個問題沒了)
 *    ⇒ ✅ 現在擋的是**單發送出去的量**與 DB 那一發 `= ANY` 的大小。舊字面留刪除線, 讓搜「URL 長度」的人撞到訂正。
 */
const COUNT_NEW_EVENTS_MAX_INPUTS = 200;

export class SupabaseEmailOutboxAdapter implements IEmailOutbox {
  constructor(
    private readonly client: EmailOutboxClient,
    private readonly cfg: SupabaseEmailOutboxAdapterConfig,
  ) {}

  /**
   * ⟦b4-EMAILTRIAGE⟧ 甲-3:這一批候選裡有幾個是【真的排得進去的新事件】。合約全文在 port。
   *
   * 🔴🔴 **鍵一定要走 `composeEvent`** —— 那是 `enqueue()` 用的同一支。
   *    在這裡自己重算一份 ⇒ 兩份會漂, 而漂掉的那一半**不會紅**:
   *    這把尺說「新的」而 `enqueue` 說「duplicate」, 症狀是**閘的分母錯了**,
   *    而閘的分母錯了在任何測試上都不是紅色的。
   * 🔵 一發批次(`.in()` = SQL 的 `= ANY`), 不逐封問 —— 逐封問等於把 N 次往返加進每一輪。
   * 🛑 空陣列 ⇒ 直接回 0, **不發查詢**(`.in('dedup_key', [])` 在 PostgREST 上是合法而無意義的一發)。
   * 🛑 混了兩種 event_type ⇒ throw。本方法用**單一** `event_type` 加一組鍵去查,
   *    混型別會讓那個等式悄悄變成「任一型別命中就算」⇒ 少報新事件 ⇒ 閘放行太多。
   */
  async countNewEvents(inputs: readonly EnqueueEmailInput[]): Promise<number> {
    if (inputs.length === 0) return 0;

    // 🔵 `noUncheckedIndexedAccess` 之下 `inputs[0]` 是 `T | undefined` —— 上面剛擋掉空陣列,
    //    而型別系統看不到那個因果。用第一筆的解構代替下標, 不用非空斷言。
    const [first, ...rest] = inputs;
    if (first === undefined) return 0;
    const eventType = first.eventType;
    for (const input of rest) {
      if (input.eventType !== eventType) {
        // 🔴 訊息零 PII:只有兩個型別名。
        throw new Error(
          `countNewEvents 只接受單一 event_type(拿到 ${eventType} 與 ${input.eventType})`,
        );
      }
    }

    // 🔴🔴 **硬上限**:RPC 走 POST body ⇒ URL 長度不再是問題, 而**送出去的量仍要有上界**。
    //    真實呼叫端一輪最多 `ENQUEUE_LIMIT = 50` 筆
    //    (`apps/storefront/src/app/api/cron/email-sweep/route.ts:168`), 200 是四倍餘裕
    //    ⇒ 它擋的是「有人日後把 limit 調大而沒想到這裡」。
    if (inputs.length > COUNT_NEW_EVENTS_MAX_INPUTS) {
      throw new Error(
        `countNewEvents 一次最多 ${COUNT_NEW_EVENTS_MAX_INPUTS} 筆(拿到 ${inputs.length})`,
      );
    }

    // 🔴🔴 **合成假信箱先剔掉**(codex `gpt-6-astra` 2026-09-07 12⑤ must-fix):
    //    這個數是排信閘的分母, 而閘擋的是「**一次寄太多信**」。
    //    合成信箱那些列落的是 `skipped_no_real_email` ⇒ **它們一封都不會寄出去**
    //    ⇒ 📌 把它們算進分母, 20 個 LINE 客 + 1 個真信箱 = 21 ⇒ 整批被擋
    //      ⇒ 而**被擋就連那 20 列 skip 紀錄也沒落** ⇒ 下一輪還是同樣 21 筆
    //      ⇒ 🛑 **那一封真的該寄的信永遠排不進去**(新增的漏信路徑)。
    // 🔵 判斷式**不在這裡重寫** —— 用 `enqueue()` 用的同一個 `this.cfg.isSyntheticEmail`
    //    (`:479` 那一行)。重寫一份就會有兩套 LINE 判準。
    // ⚠️ **代價明寫**:一批 500 個合成信箱 + 1 個真的, 會**過閘**並落 501 列。
    //    那是**寫入量**不是**寄送量**, 而這道閘管的是寄送量。要管寫入量是另一件事。
    const sendable = inputs.filter((input) => !this.cfg.isSyntheticEmail(input.recipientEmail));
    if (sendable.length === 0) return 0;

    // 🔴 鍵一定走 `composeEvent` —— 那是 `enqueue()` 用的同一支。在這裡自己重算一份
    //    ⇒ 兩份會漂, 而漂掉的那一半**不會紅**:這把尺說「新的」而 `enqueue` 說「duplicate」,
    //    症狀是**閘的分母錯了**, 而閘的分母錯了在任何測試上都不是紅色的。
    // 🔵 去重交給 DB 那支函式(`SELECT DISTINCT`)—— 一份去重, 不是兩份。
    // 🔴🔴 **組裝失敗的那一筆【跳過, 不要整批倒】**(主視窗 B 2026-09-07 裁, 這是今晚第三次
    //    撞到「永久少寄」那個形狀):`composeEvent` 會做 runtime 驗證(uuid 形狀 / 空字串…),
    //    而**資料是人打的**。若在這裡讓它往外 throw ⇒ **同一批其他信每一輪都排不進去**。
    // ✅ 跳過那一筆 ⇒ 它不進分母(它本來也變不成一列), 而第三段仍會對它呼叫 `enqueue()`
    //    ⇒ 在那裡 throw ⇒ 呼叫端 `errors += 1`、其餘照排 = **改版前逐筆的行為**。
    // 🛑 這裡**刻意不記 log** —— 真正的錯誤訊息會在 `enqueue()` 那一發出現, 記兩次會讓
    //    同一筆壞資料在 log 上看起來像兩件事。
    const keys: string[] = [];
    for (const input of sendable) {
      try {
        keys.push(composeEvent(input).dedupKey);
      } catch {
        // 這一筆組不出鍵 ⇒ 它不可能變成新的一列 ⇒ 不進分母。
      }
    }

    // 🔴🔴 **為什麼是 RPC 而不是 `.select().in()`**(codex `gpt-6-astra` 2026-09-07 12⑤ R1+R2 兩輪):
    //    「這些鍵哪些存在」的答案是**一堆列**, 而列數會被 PostgREST 的 `db-max-rows` 截斷 ——
    //    `.limit(n)` **跨不過那個伺服器端上限**。截斷 ⇒ 少讀到已存在的鍵 ⇒ **多報新事件**
    //    ⇒ 排信閘擋太多。而那個值我沒有一個有判別力的量法讀得到。
    //    ✅ 改問一個**整數** ⇒ 📌 一列回來, `db-max-rows` 與 URL 長度**兩個問題同時消失**。
    // 🛑 **型別是手寫的**:`pcm_count_new_email_events` 還沒進產生的 `Database` 型別
    //    ⇒ 這一行的 `as` **不是型別安全的**, 它只是讓編譯過。
    //    ⚠️ **而那代表 typecheck 對「這支函式在不在正式庫上」零判別力** ——
    //      它要等貼板那一支 migration 貼完才叫得動。部署順序由 `deploy-order-gate` 守。
    const { data, error } = await (
      this.client as unknown as {
        rpc(
          fn: string,
          args: Record<string, unknown>,
        ): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
      }
    ).rpc('pcm_count_new_email_events', {
      p_event_type: eventType,
      p_keys: keys,
    });
    if (error) {
      // 🔴 只帶 code, 不帶 message —— DB 訊息可能含 PII。
      throw new Error(`email_outbox countNewEvents 失敗(${error.code ?? 'unknown'})`);
    }
    // 🛑 **`null` 不得靜默當 0** —— 0 的意思是「一封都排不進去」⇒ 閘會放行(不擋),
    //    而「函式不存在 / 回了個怪東西」與「真的是 0」在那個分支上長得一樣。
    if (typeof data !== 'number' || !Number.isInteger(data) || data < 0) {
      throw new Error('email_outbox countNewEvents 回傳不是非負整數(函式沒貼上去?)');
    }
    return data;
  }

  async enqueue(input: EnqueueEmailInput): Promise<EnqueueEmailResult> {
    // 🔴 落表三欄全在本邊界內部重組(REQUIRED-E1b):payload 過 runtime allowlist、subject 走
    // 固定模板、dedup_key 依事件分派。呼叫端無寫入口。
    const composed = composeEvent(input);
    const dedupKey = composed.dedupKey;
    const skipped = this.cfg.isSyntheticEmail(input.recipientEmail);
    const { data, error } = await this.client
      .from('email_outbox')
      .insert({
        event_type: input.eventType,
        order_id: input.orderId,
        dedup_key: dedupKey,
        recipient_email: input.recipientEmail,
        subject: composed.subject,
        payload: composed.payload,
        status: skipped ? 'skipped_no_real_email' : 'pending',
        request_id: input.requestId ?? null,
      })
      .select('id');
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        return this.resolveUniqueViolation(input);
      }
      throw new Error(`email_outbox enqueue 失敗(${error.code ?? 'unknown'})`);
    }
    const id = data?.[0]?.id;
    if (!id) {
      throw new Error('email_outbox enqueue 失敗(insert 未回列)');
    }
    return skipped ? { kind: 'skipped_no_real_email', id } : { kind: 'enqueued', id };
  }

  /**
   * 23505 查核(codex 關卡2 R1 must-fix:盲目回 duplicate 會把「PK 撞鍵/未來新唯一約束/
   * 跨訂單 dedup 碰撞」全吞成成功 = 永久漏信):撞鍵後回查 (event_type, dedup_key),
   * **存在且 order_id 相同**才是同事件 → duplicate;否則 throw(訊息零 PII)。
   */
  private async resolveUniqueViolation(input: EnqueueEmailInput): Promise<EnqueueEmailResult> {
    // 🔴 **2026-08-22 E4-a 修**:原本寫死 `.eq('dedup_key', input.orderId)`。
    //    那在「dedup_key === orderId」的世界裡是對的,而 `order_shipped` 的鍵是
    //    `{shipment_id}:{order_id}` ⇒ 撞鍵之後回查會**查不到那一列**
    //    ⇒ 走進下面那個 `throw`(「撞唯一鍵但查無同事件列」)
    //    ⇒ 呼叫端記成 `errors`、下一輪再撈到、再撞、再 throw —— **一封信永遠排不進去,而且每輪都吵**。
    //    ⚠️ 這條**不是型別擋得住的**:兩邊都是 string。要靠這裡與 `composeEvent` 用同一支算式。
    const { data, error } = await this.client
      .from('email_outbox')
      .select('id, order_id')
      .eq('event_type', input.eventType)
      .eq('dedup_key', composeEvent(input).dedupKey)
      .limit(1);
    if (error) {
      throw new Error(`email_outbox 唯一鍵查核失敗(${error.code ?? 'unknown'})`);
    }
    const existing = data?.[0];
    if (!existing) {
      throw new Error('email_outbox enqueue 撞唯一鍵但查無同事件列(23505 非 dedup 鍵)');
    }
    if (existing.order_id !== input.orderId) {
      throw new Error('email_outbox dedup_key 跨訂單碰撞(拒回 duplicate、須人工查核)');
    }
    return { kind: 'duplicate' };
  }

  async claimDue(
    limit: number,
    opts?: { readonly excludeEventTypes?: readonly EmailOutboxEventType[] },
  ): Promise<ClaimedEmailJob[]> {
    const nowIso = new Date().toISOString();
    /**
     * ⟦b4-SHIPGATE1⟧ 2026-09-01:**不要認領被上層閘擋掉的那些事件型別。**
     * 理由全文在 port(`IEmailOutbox.ts` 的 `claimDue`)—— 一句話:那道閘擋在認領【之後】,
     * 而認領當下 `attempts` 就 +1、狀態落 `sending`,而 `sending` 不可再認領
     * ⇒ 每燒一次要等一輪租約回收(route 端 3600 秒)。
     *
     * 🛑 **空陣列 / 未給 ⇒ 一個字都不加** —— 而那不是最佳化,是**驗收條件**:
     *    既有呼叫端零改 ⇒ 送出的查詢必須與改動前**逐位元相同**。
     *    ⚠️ ⛔ ~~送一個空的 `not in ()` 給 PostgREST 是語法錯,而它會在【所有既有路徑】上炸~~
     *       **那句誇大了**(codex R2 nit;而 R3 F7 抓到我【只改了測試檔那一份, 沒改這一份】)——
     *       既有呼叫端傳的是 `undefined`, 而空陣列只出現在專屬測試裡。
     *       🔴 而 2026-09-01 R3 F2 之後**連 `not in` 都不用了**(改 `.neq`)⇒ 這句連對象都沒了。
     *    📌 **⇒ 而這一格本身是第三次同款:改了一處而同款還在另一支檔, 而 diff 上看起來很完整。**
     */
    const exclude = opts?.excludeEventTypes ?? [];
    let q = this.client
      .from('email_outbox')
      .select(JOB_SELECT)
      .in('status', CLAIMABLE_STATUSES)
      .lte('next_retry_at', nowIso);
    /**
     * 🔴🔴 **2026-09-01 R3(adversarial-reviewer, 換模型)must-fix F2 —— 而兩輪 codex 都沒看到。**
     *
     * ⛔ ~~`q.not('event_type','in', \`(${exclude.join(',')})\`)`~~ **那個形狀在本 repo 零前例**:
     *    全 repo 非測試的 `.not(` 只有兩處,另一處(`SupabaseProductAdapter.ts:302`)用的是
     *    `'eq'` / `'like'` **純量** ⇒ `'in'` + 括號字串**沒有任何一次被證明過 PostgREST 收**。
     * 🛑 **而它壞掉的後果不是「出貨信沒排除」,是【全部的信都停】**:
     *    PostgREST 拒收 ⇒ `claimDue` throw ⇒ `sweep-email-outbox.ts:626` `catch { errors++ }`
     *    ⇒ `jobs = []` ⇒ **這一輪連 `order_created` 都不寄**,每 5 分鐘一次。
     * 🔴🔴 **而旗標【今天就是關的】**(env 未設)⇒ **這條路第一次部署就會走到,不是邊角。**
     * ⚠️ 而唯一釘它的測試斷言的是**實作自己寫出來的同一個字面** ⇒ 對「PostgREST 收不收」**零判別力**
     *    ⇒ **兩邊一起錯會印綠。**
     *
     * ✅ **改用已證形狀 `.neq`** —— 而它為什麼夠:
     *    `20260717020000_m4a_email_outbox.sql:315` 的 CHECK 逐字
     *    `event_type IN ('order_created','order_shipped')` ⇒ **值域只有兩個**,
     *    而唯一呼叫端(`sweep-email-outbox.ts:624`)只傳**一個**元素。
     * 🔴 **而 ≥2 個【直接 throw】,不猜一個沒驗過的文法** ——
     *    值域只有兩個 ⇒ 排除兩個 = 排除全部 = 沒有意義的呼叫;
     *    而日後真的加第三個事件型別時,**要先照
     *    `docs/runbooks/throwaway-postgres-for-migration-verification.md` 跑一發真的 PostgREST
     *    驗那個 `in` 文法**,再回來改這裡。
     * 📌 **⇒ 根因是【為了一個只有一個元素的呼叫端做了陣列泛化】,而那個泛化正是逼出無前例
     *    filter 字串的原因。這裡不撤回那個泛化(port 已上線),而讓它【在沒驗過的區間拒絕動作】。**
     */
    // 🔴🔴 **2026-09-04(⟦5b-TRACKNUMGAP1⟧ 片 C, codex R2 must-fix #1)—— 而它差點上線。**
    //    ⛔ ~~`else if (exclude.length > 1) throw`~~ **那道拒絕在片 C 變成一顆炸彈**:
    //      片 C 把 `shipment_tracking_corrected` 加進同一份清單 ⇒ 截止開關關著時 **exclude 有 2 個**
    //      ⇒ `claimDue` throw ⇒ `sweep-email-outbox.ts` 的 `catch { errors++ }` 吃掉
    //      ⇒ `jobs = []` ⇒ 🛑 **連 `order_created` 都不寄, 每 5 分鐘一次。**
    //    🔴 **而我的兩支測試各自全綠**:use-case 那側的假 outbox **忽略**這個參數,
    //      adapter 那側**斷言它會 throw** ⇒ 兩邊都對, 而**組合起來必壞**。
    //      📌 **每支測試的分母是它自己那支檔** —— 跨檔的假設沒有任何一支守得住。
    //
    // ✅ **修法刻意【不引進新的查詢文法】**(那道拒絕當初就是為了擋無前例的 `in` 字串):
    //    · 查詢層:只在**恰好 1 個**時下 `.neq` ⇒ 既有呼叫端送出的查詢**逐位元不變**
    //    · ≥2 個:**不動查詢**, 改在下面既有的 `candidates` 那一發 filter 裡濾掉
    //      ⇒ 🎯 而那道閘的目的是「**不要認領**」(認領當下 attempts 就 +1), 而認領發生在 filter【之後】
    //      ⇒ **在 app 層濾掉一樣達成目的**, 且零新文法。
    //    ⚠️ **代價寫出來**:被排除的列仍會佔用掃描窗(`DUE_SCAN_CAP`)。
    //      那與「這道閘不存在」時的形狀相同 ⇒ **不是新增的風險**, 而它值得有人知道。
    if (exclude.length === 1) {
      q = q.neq('event_type', exclude[0] as string);
    }
    const { data, error } = await q
      .order('next_retry_at', { ascending: true })
      // 🔴 取大窗(見 DUE_SCAN_CAP):先 limit 再過濾會被恆最老的死列餓死活信(R1 Critical)。
      .limit(Math.max(limit, DUE_SCAN_CAP));
    if (error) {
      throw new Error(`email_outbox due 掃描失敗(${error.code ?? 'unknown'})`);
    }
    // 🔴 **撈滿了就出聲** —— `DUE_SCAN_CAP` 的到期日不在它自己身上(見該常數的說明)。
    //    📌 **少了這一行, 它咬到的那天長什麼樣**:活信一輪都認領不到, 而每一輪都印全綠、
    //      沒有任何錯誤碼 ⇒ **「被最老的死列餓死」與「今天沒有信要寄」印同一個結果。**
    //    🔵 `console.warn` 不是 `error`:它不改任何寄信行為、不改回傳、不進 rc
    //      —— 照本 repo 既有那格的裁定(`api/cron/email-sweep/route.ts:810` 逐字
    //      「『正常』與『該吵』是兩件事」)。🛑 **零 PII**:只印我們自己寫死的數與列數。
    if ((data ?? []).length >= DUE_SCAN_CAP) {
      console.warn(
        `[SupabaseEmailOutboxAdapter] ⚠️ due 掃描窗撈滿了(${DUE_SCAN_CAP} 列)—— ` +
          '最老的那批可能把活信擠出窗外, 而它不會有錯誤碼。正解是清理 job(backlog #281), 不是放大窗口。',
      );
    }
    // 欄對欄 guard 的 app 層半段(死列 attempts>=max 不進 CAS;原子性由 CAS 內字面值 guard 收口)。
    const excludeSet = new Set<string>(exclude);
    const candidates = (data ?? []).filter(
      // 🔴 `excludeSet` 這一半是上面那段註解講的「≥2 個時在 app 層濾」——
      //    而它對 1 個的情況**也會跑**(查詢那邊已經濾掉了 ⇒ 這裡是零成本的第二道)。
      (row) => row.attempts < row.max_attempts && !excludeSet.has(row.event_type),
    );
    const claimed: ClaimedEmailJob[] = [];
    for (const row of candidates) {
      if (claimed.length >= limit) {
        break;
      }
      const winner = await this.tryClaim(row);
      if (winner) {
        claimed.push(winner);
      }
    }
    return claimed;
  }

  async claimById(id: string): Promise<ClaimedEmailJob | null> {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.client
      .from('email_outbox')
      .select(JOB_SELECT)
      .eq('id', id)
      .in('status', CLAIMABLE_STATUSES)
      .lte('next_retry_at', nowIso)
      .limit(1);
    if (error) {
      throw new Error(`email_outbox claimById 讀取失敗(${error.code ?? 'unknown'})`);
    }
    const row = data?.[0];
    if (!row || row.attempts >= row.max_attempts) {
      return null;
    }
    return this.tryClaim(row);
  }

  /**
   * 逐列 CAS 認領(REQUIRED-E2a 原子決策點):
   * `SET status='sending', claimed_at=now, attempts=讀值+1
   *  WHERE id=? AND status IN (pending,failed) AND attempts = 讀值 AND attempts < max(讀值)`
   * 0 列 = 搶輸/已被動過(TOCTOU:他人先推進 attempts → eq 失配 → 不會突破上限)。
   */
  private async tryClaim(row: OutboxJobRow): Promise<ClaimedEmailJob | null> {
    const { data, error } = await this.client
      .from('email_outbox')
      .update({
        status: 'sending',
        claimed_at: new Date().toISOString(),
        attempts: row.attempts + 1,
      })
      .eq('id', row.id)
      .in('status', CLAIMABLE_STATUSES)
      .eq('attempts', row.attempts)
      .lt('attempts', row.max_attempts)
      .select(JOB_SELECT);
    if (error) {
      throw new Error(`email_outbox 認領失敗(${error.code ?? 'unknown'})`);
    }
    const winner = data?.[0];
    return winner ? mapRowToJob(winner) : null;
  }

  /**
   * 🔴🔴🔴 **部署順序:`20260905200000` 【與】 `20260906200000` 兩支都必須先貼進正式庫,
   *    這支碼才能上線。**(codex R1 must-fix 1;`20260906200000` 由 codex R1-#10 補上)
   * 🛑 **原本這裡只寫了前者** —— 而 ⟦b4-NOSENTBODY⟧ 之後這一發 update 多寫一個
   *    `provider_message_id`(45g 那一欄)⇒ **少貼 45g 的症狀與少貼 45e 一模一樣**:
   *    同一個 `PGRST204`、同一發 update 整發不落表。📌 **一個只列了一半的前置清單,
   *    在缺另一半的時候會印出「照著做了」。**
   *
   * 欄位不存在時 PostgREST 回 **`PGRST204`** ⇒ **整發 update 不落表** ⇒ 連 `sent_at` 都寫不下
   * ⇒ 那一列留在 `sending` ⇒ **每一封寄成功的信都標不成 sent**。
   * · 立刻重寄嗎:**不會** —— Resend 那把 24 小時冪等鍵會擋住重送;
   *   ⇒ 🛑 **停超過 24 小時才會真的寄出第二封**(codex 補的射程, 我複核收下)。
   * · 而 PostgREST 有 schema cache ⇒ 貼完之後**還要等它看見那一欄**, 不是貼完那一秒就好。
   *
   * 🛑 **而【沒有機制在擋這件事】** —— 2026-09-05 實跑 `scripts/deploy-order-gate.sh`
   *    餵 `agent/line-ship-5b-sentnum` ⇒ 逐字 `gate: 0 blocked / 41 pending`。
   *    成因不是它壞了:那道閘照 Sean 2026-08-11 `Q2=B` **只比對函式名與 view 名**,
   *    **table / column / index 名一律不比**(刻意的漏擋, 理由=撞常見字會誤擋)。
   *    ⇒ 🎯 **而本片依賴的正是一個【新欄位】** ⇒ 它落在那個漏擋的正中央。
   *    ⇒ 📌 **今天擋住這件事的只有「人記得順序」。**要不要把 column 納進那道閘是 Sean 的板。
   */
  async markSent(
    id: string,
    claimedAttempts: number,
    sentTrackingNumber: string | null,
    providerMessageId: string | null,
  ): Promise<boolean> {
    return this.leaveSending(id, claimedAttempts, {
      status: 'sent',
      sent_at: new Date().toISOString(),
      // 🔴🔴 **與 `sent_at` 同一發 update** —— ⟦5b-SHIPPEDNUMNOTRECORDED1⟧ 片 B-1。
      //    📌 分兩發寫會有一個窗:`sent_at` 已落表而號碼還沒 ⇒ 掃描面那一刻讀到的是
      //    「寄過了而不知道寄了什麼」—— **那正是本片要修的病, 而分兩發會把它再造一次。**
      // 🔵 這裡放的是**值不是 expression** —— 它是 sweeper 手上那個字串,
      //    所以 PostgREST 的 update 帶得動(`nextval()` 那種帶不動)。
      sent_tracking_number: sentTrackingNumber,
      // 🔴🔴 **出處旗標 —— 它與號碼【一定成對】, 連號碼是 null 的時候也要寫。**
      //    它答的是「**這一列是片 B 寫的**」, 而號碼答的是「寄了什麼」。
      //    ⛔ ~~掃描面原本用 `sent_seq IS NOT NULL` 分代~~ ⇒ 那一欄由 DB 的 trigger 蓋,
      //      而 trigger 對**舊 writer 寫的列也會蓋** ⇒ 🛑 在【先貼 migration、後上這支碼】
      //      那段窗口裡, 舊 writer 寄出的信會被當成「片 B 寫的而沒告訴過客人號碼」
      //      ⇒ **多寄一封更正信給號碼本來就正確的客人**(codex 2026-09-05 R2 抓到)。
      //    ⇒ 📌 **「什麼時候進 DB」與「誰寫的」是兩個問題, 不能共用一欄。**
      sent_tracking_recorded: true,
      // 🔴 ⟦b4-NOSENTBODY⟧(2026-09-06, Sean 拍乙「只存 id、不留全文」):
      //    與 `sent_at` **同一發 update** —— 分兩發會有一個窗:寄過了而 id 還沒落表,
      //    而那個窗裡的列與「舊 writer 寫的」長得一樣(上面那一格記過同族的病)。
      //    🛑 `null` 的意思是**我們沒拿到**(provider 沒回 / 超過大小上限 / 型別不是 string),
      //    **不是**「provider 沒給」—— 三者在這一欄上分不出來, 而那寫在 port 上。
      provider_message_id: providerMessageId,
    });
  }

  async markFailed(
    id: string,
    claimedAttempts: number,
    errorCode: EmailSendErrorCode,
    nextRetryAt: Date,
  ): Promise<boolean> {
    // 🔴 runtime allowlist(TS union 只是編譯期;過 DB regex 的 PII 字串在此被改寫)。
    const safeCode: EmailSendErrorCode = EMAIL_SEND_ERROR_CODE_ALLOWLIST.has(errorCode)
      ? errorCode
      : 'provider_error';
    return this.leaveSending(id, claimedAttempts, {
      status: 'failed',
      last_error_code: safeCode,
      next_retry_at: nextRetryAt.toISOString(),
    });
  }

  async markSkippedOrderIneligible(id: string, claimedAttempts: number): Promise<boolean> {
    // 🔴 S3=A 不可翻轉終態:零訊號零對帳補救 → 必寫稽核碼(migration §⑧)。
    return this.leaveSending(id, claimedAttempts, {
      status: 'skipped_order_ineligible',
      last_error_code: 'order_ineligible',
    });
  }

  // 🔴🔴 **與上面那支【只差 `last_error_code` 一個字面】—— 而那個差是承重的。**
  //    態相同是刻意的(沿用既有白名單 ⇒ 零 migration;`IPaidEmailContext.ts:208-211` 逐字),
  //    而**碼必須不同**:兩層落同一個碼 ⇒ 上游那道閘變成看不見的
  //    (主視窗 2026-08-24 拍【乙】,全文在 `IEmailOutbox` 這支的 docstring)。
  //    ⇒ 📌 一個「順手把這兩支合併」的重構,會讓 port 要的那個比值永遠算不出來 ——
  //      而**三綠不會紅、diff 上兩支長得幾乎一樣**。守它的是下面那支測試。
  async markSkippedOrderCancelled(id: string, claimedAttempts: number): Promise<boolean> {
    return this.leaveSending(id, claimedAttempts, {
      status: 'skipped_order_ineligible',
      last_error_code: 'order_ineligible_at_send',
    });
  }

  /**
   * ⟦b4-BANKNOEMAIL⟧:寄送當下這張單已經不該收到匯款成立信 ⇒ 跳過。
   * 🔵 `status` 借 `skipped_order_ineligible` 這個桶(形同上面兩支), **真相在 `last_error_code`**
   *    —— 它沒有值域白名單, 只有格式 CHECK(`^[a-z0-9_]{1,64}$`)。
   * 🔴 **自己一個碼** —— 沿用 `order_ineligible` 會讓上游那道閘變成看不見的
   *    (主視窗 2026-08-24 對同族那一裁的理由), 而這一格要答得出「**寄送當下才擋下幾封**」。
   */
  async markSkippedBankOrderNotMailable(id: string, claimedAttempts: number): Promise<boolean> {
    return this.leaveSending(id, claimedAttempts, {
      status: 'skipped_order_ineligible',
      last_error_code: 'bank_order_not_mailable_at_send',
    });
  }

  /** ⟦b4-BANKNOEMAIL⟧:寄送當下快照與現況不一致 ⇒ 跳過。**自己一個碼**, 理由見 port。 */
  async markSkippedBankOrderSnapshotStale(id: string, claimedAttempts: number): Promise<boolean> {
    return this.leaveSending(id, claimedAttempts, {
      status: 'skipped_order_ineligible',
      last_error_code: 'bank_order_snapshot_stale',
    });
  }

  /**
   * ⟦b4-EMAILTRIAGE⟧ 甲-1+甲-2:這張單成立於 cutoff 之前 ⇒ 跳過。
   * 🔵 `status` 借用 `skipped_order_ineligible` 這個桶(同上面幾支)⇒ **零 migration**;
   *    真相在 `last_error_code` —— 它沒有值域白名單, 只有格式 CHECK(`20260717020000:343`)。
   * 🛑 **而借桶的代價要知道**:後台若只看 `status`, 這一封與「那張單不該寄了」長得一樣
   *    ⇒ 要分辨得看 `last_error_code`。
   */
  async markSkippedBeforeCutoff(id: string, claimedAttempts: number): Promise<boolean> {
    return this.leaveSending(id, claimedAttempts, {
      status: 'skipped_order_ineligible',
      last_error_code: 'before_send_cutoff',
    });
  }

  /**
   * ⟦b4-EMAILTRIAGE⟧ 甲-1+甲-2(codex 2026-09-07 MF4):cutoff 來源讀不到 ⇒ **放回 due, 還回 attempts**。
   * 🔴 `attempts: claimedAttempts - 1` = **把本次認領消耗的那一次還回去** ——
   *    否則讀取端抖動幾次就把一封從未寄出的信推進死信。
   * 🛑 `next_retry_at: null` = 下一輪就可以再認領(不另外壓退避:這不是「這封信失敗了」)。
   * ⚠️ **代價**:讀取端持續壞掉 ⇒ 這幾封**永遠不進死信、也永遠沒人叫**(port 檔頭寫明)。
   */
  /**
   * ⟦b4-EMAILTRIAGE⟧ 甲-7:送信【之前】就失敗的那一列, 從 `sending` 放回 `failed`。合約全文在 port。
   *
   * 🔴🔴 **碼寫死在這裡, 不經 `EmailSendErrorCode` 的 allowlist** —— 照本檔 `:131` 起那段 為
   *    lease 回收碼立過的同一條前例:走 `markFailed` 會被改寫成 `provider_error`,
   *    而那會讓一個「本地程序失敗」混進「Resend 寄送失敗」的值域, **告警與統計都按那個值域切**。
   * 🔵 過 DB 的 `email_outbox_last_error_code_format` CHECK(`^[a-z0-9_]{1,64}$`)⇒ 不需要 migration。
   * 🔵 `attempts` **不退回** —— 那一次認領是真的花掉了, 退回會讓同一列無限重試。
   *    (與 `releaseClaimForCutoffUnknown` 刻意不同:那一支是「連判斷都做不到」⇒ 不算一次嘗試。)
   */
  async releaseClaimAfterPrepareFailure(
    id: string,
    claimedAttempts: number,
    nextRetryAtIso: string,
  ): Promise<boolean> {
    return this.leaveSending(id, claimedAttempts, {
      status: 'failed',
      last_error_code: PREPARE_FAILED_ERROR_CODE,
      next_retry_at: nextRetryAtIso,
    });
  }

  async releaseClaimForCutoffUnknown(
    id: string,
    claimedAttempts: number,
    nextRetryAtIso: string,
  ): Promise<boolean> {
    return this.leaveSending(id, claimedAttempts, {
      status: 'pending',
      attempts: claimedAttempts - 1,
      /**
       * 🔴🔴 **[codex R2]** ⛔ ~~`next_retry_at` 刻意不動~~ —— **那會堵住整條佇列**:
       * 那個值本來就已經過期 ⇒ 被釋放的 50 封下一輪又把名額佔滿
       * ⇒ 📌 **後面的取消信 / 出貨信永遠排不進來**, 而它們與這個讀取失敗一點關係都沒有。
       * ✅ 往後推一段, 讓它們**讓開名額**。
       * ⚠️ 而 `attempts` 仍然還回去 ⇒ 讀取端持續壞掉時它們**永遠不進死信、也沒有東西叫**
       *    —— 那個代價照舊(port 檔頭寫明)。
       */
      next_retry_at: nextRetryAtIso,
    });
  }

  /**
   * ⟦5b-TRACKNUMGAP1⟧ 片 C:寄送當下那個單號已被更新 ⇒ 跳過 + 退休鍵。
   * 🔵 `status` 借用 `skipped_order_ineligible` 這個桶(形同 `markSkippedOrderCancelled`),
   *    **真相在 `last_error_code`** —— 它沒有值域白名單, 只有格式 CHECK。
   * 🔴 而 `:superseded:` 這個中綴讓那一列**在 DB 裡自己說得出為什麼**(而不是靠有人記得)。
   */
  async markSkippedTrackingSuperseded(
    id: string,
    claimedAttempts: number,
    currentDedupKey: string,
  ): Promise<boolean> {
    return this.leaveSending(id, claimedAttempts, {
      status: 'skipped_order_ineligible',
      last_error_code: 'tracking_superseded',
      dedup_key: `${currentDedupKey}:superseded:${id}`,
    });
  }

  /**
   * ⟦mail-RECIPIENTNOTRECHECKED⟧:寄送當下收件地址已與排信快照不同 ⇒ 跳過 + 退休鍵。
   * 🔵 形狀**逐字照抄上面那支** —— `status` 借 `skipped_order_ineligible` 這個桶,
   *    真相住在 `last_error_code`(只有格式 CHECK, 沒有值域白名單)⇒ **不必多開一支 migration**。
   * 🔴 `:recipientstale:` 這個中綴讓那一列**在 DB 裡自己說得出為什麼**, 而不是靠有人記得。
   * 🛑 **退休鍵不是可選的** —— 五族的 `dedup_key` 一個都不含收件地址(見 port 檔頭那一段),
   *    不退休 ⇒ 下一輪重排算出**同一把鍵** ⇒ 每輪撞唯一鍵、永遠插不進去。
   */
  async markSkippedRecipientStale(
    id: string,
    claimedAttempts: number,
    currentDedupKey: string,
  ): Promise<boolean> {
    return this.leaveSending(id, claimedAttempts, {
      status: 'skipped_order_ineligible',
      last_error_code: 'recipient_stale_at_send',
      dedup_key: `${currentDedupKey}:recipientstale:${id}`,
    });
  }

  async markSkippedShipmentVoided(
    id: string,
    claimedAttempts: number,
    currentDedupKey: string,
  ): Promise<boolean> {
    // ══════════════════════════════════════════════════════════════════════════
    // 🔴🔴 **部署順序:先 apply `20260830060000`,再部署會走到這裡的碼。**
    //    (2026-08-30 搬到這裡;搬的理由在本段最後。)
    // ══════════════════════════════════════════════════════════════════════════
    // ⛔ **那支 migration 的檔頭寫著一句【已經為假】的話,而它不能改**(見下方「為什麼搬」):
    //    ~~「今天沒有任何正式碼呼叫 `markSkippedShipmentVoided` ⇒ 今天反序部署不會立刻壞」~~
    // 🔴 **那一天到了 —— 它已經被接上去了**:
    //    `packages/use-cases/src/sweep-email-outbox.ts:546` 呼叫本方法,
    //    由 `apps/storefront/src/app/api/cron/email-sweep/route.ts` 走到;接線那顆是 `44ccc0bc`。
    //    ⚠️ **而「現在就會走到」要帶前提,不要讀成無條件立即可達**:還需要同時滿足
    //      ① `allowOrderShipped=true`(由 env 導出的 cutoff 決定,該 route `:453`)
    //      ② 有一列 due 的 `order_shipped` 被認領 ③ 那一箱撈回來的脈絡是 `voided`
    //    ⇒ 正確說法:**那條路【已經接上了】**,會不會今天走到取決於那個 env 有沒有上膛。
    //      而重點不變:**「還沒有人接」這個理由已經沒有了。**
    //
    // 🔴 **它是怎麼被發現的,比那個事實本身更值得留**(可複製的那一步):
    //    上午量的時候在 `9002092d`,而 `44ccc0bc` 不在它的祖先裡
    //    (`git merge-base --is-ancestor 44ccc0bc 9002092d` ⇒ 否)⇒ 接線在後來 merge 進來的 19 顆裡。
    //    抓到它的是:**被指派去做別件事時,回頭把同一個 grep 重跑了一次。**
    //    ⇒ 📌 **merge 之後,先前寫下的每一句「今天還沒有 X」都可能已經不成立 —— 而它們不會自己出聲。**
    //    ⇒ 🔴 **而這一次是往【更嚴重】的方向過期**:當時寫的是「今天不急」。
    //      往好的方向過期**容易**沒有人回頭查(讀起來像好消息);
    //      **而往壞的方向過期也一樣容易 —— 因為它讀起來像一句已經查證過的安心話。**
    //
    // 🛑 **為什麼這一段住在這裡,而不是住在那支 migration 的檔頭**(2026-08-30,Sean 裁【甲】):
    //    那一段**曾經**寫在 migration 檔頭(commit `87f86194`),而**那支 migration 已經 apply 了**
    //    ⇒ 改它(即使只改註解)會讓 `supabase/APPLIED.tsv` 記的 sha256 對不上。
    //    CLAUDE.md 路由表逐字:「**已 apply 的 migration 連註解都不能動**」。
    //    ⇒ migration 本體已還原成帳本那一版;**更正搬來這裡 —— 會走到第七態的碼就是這一支。**
    //    ⚠️ **代價明寫,不掩蓋**:那支 migration 的檔頭現在**仍然留著那句已為假的話**,
    //       而它**不能**改。⇒ 只讀那支檔的人會讀到舊的。這是【甲】這個選項的已知代價。
    //
    // 🔴 M-4b E4 片3a。**可翻轉態(與 skipped_no_real_email 同類), 不是不可翻轉終態**
    //    —— 箱可被 admin_unvoid_shipment 用同一個 id 復原, 而掃描 view 的 anti-join 不分 status
    //    ⇒ 這一列會永久擋住重新 enqueue(合約全文與反例在 port)。稽核碼由本層寫死、不經
    //    `EmailSendErrorCode` union —— 它不是一次「寄送失敗」,而是一個【正常業務動作】。
    // ⚠️ **與 `order_ineligible` 分開是承重的**:那一態是「訂單已退款/取消」,
    //    本態是「這一箱被作廢,而訂單好好的」。合併之後稽核會得到一個錯的答案,
    //    而那個答案讀起來完全合理。
    // 🔴🔴 **⟦b4-SHIPUNVOID1⟧ 2026-08-31**:退休這把鍵,**與 status 在同一發 UPDATE 裡**。
    //    上面那段寫的是這個病的【結果】—— 而它漏了一件事:**有兩個交錯順序**。
    //      順序A 先 skip 後 unvoid ⇒ 退休在 skip 當下就發生 ⇒ unvoid 後 view 自然排新的
    //      順序B 先 unvoid 後 skip ⇒ **實測可達**(probe W4;負對照 W4b 印不同的值):
    //        sweeper 讀到 voided → **這中間 unvoid 進來** → 才寫下 skip
    //        ⇒ 任何「在 unvoid 那一側清掉那一列」的修法都會**撲空**,而洞原封不動。
    //    ⇒ 📌 **所以退休必須發生在【寫下 skip 的那一刻】,不是發生在 unvoid 那一側。**
    //
    // 🔴 後綴用**本列自己的 `id`**(uuid,全域唯一):
    //    · 同一列被 skip 兩次 ⇒ 算出來的鍵**相同** ⇒ 不互撞(冪等)
    //    · 兩個不同的 outbox 列 ⇒ 兩把不同的鍵
    //    · 而 `dedup_key` 是 `text` **無長度上限**(`20260717020000:301`,只有 `<> ''` 的 CHECK)
    //      ⇒ 加後綴不會被截斷。**截斷才是真正危險的那一種**:兩列會撞成同一個鍵。
    // ⚠️ **這一句我原本寫「箱還作廢時不會誤寄」—— codex 2026-08-31 指出它【不成立】,原句作廢**:
    //    掃描 view 的 `s.deleted_at IS NULL` 只守**排信那個時點**,守不到**寄送那個時點**。
    //    sweeper 讀到 live 之後、到 `sender.send` 之間箱仍可被作廢,而它不重查
    //    ⇒ 那條路**本來就在**(不是本片造成的),而本片也沒有關掉它。
    //    📌 **⇒ 正確的說法是:本片不讓「作廢過的箱」永久佔住鍵;它不保證寄送時點的正確性。**
    // ✅ **Sean 2026-08-31 拍甲,原話逐字「依照推薦」。而推薦的內容逐字是:**
    //    「極少數情況客人會收到**兩封不一樣的**出貨通知 —— 例如兩個不同的追蹤號,
    //      而他不知道該信哪一封」+「五個條件同時成立」+
    //      「**我用一個常態的病換一個極少數的病 —— 不是零代價,你要知道**」+
    //      推薦理由:**漏信是無聲的,矛盾信是有聲的**(客人會打電話,救得回來)。
    // 🔴 **已知接受的是什麼**:極少數情況客人收到**兩封內容不同**的出貨通知。
    // 🔴 **發現路徑 = 客服接到客人的電話,不是任何一支監控。**
    //    ⚠️ 而附註要一起讀:**就算客人打了電話,我們也回頭查不出當時發生了什麼** ——
    //       那兩列的形狀(一列退休的 skip + 一列 sent)**與正常修好的情況一模一樣**。
    //    📌 **⇒ 這一格要寫到【客服看得到的地方】,不是只寫在這裡。**(2026-08-31 記,明天處理。)
    // 🛑 **而 Sean 拍板時【沒有看到】這兩格,寫出來讓引用這個甲的人知道它涵蓋到哪裡為止**:
    //      ① 「兩封不一樣的機率偏高」那個推論(端出去時標了是從動機推的,但沒展開)
    //      ② 「就算客人打了電話,我們也回頭查不出當時發生了什麼」
    //    ⇒ **不是要重問他** —— 是明天有人引用這個甲時,要知道分母。
    //
    // 🛑🛑 **本片開了一條【重複寄送】的可能,寫下來不掩蓋**:
    //    Resend 的冪等鍵是 `${eventType}/${outboxId}`(`ResendEmailSenderAdapter.ts:207`)= **逐列**。
    //    ⇒ 序列:信已被 Resend 收下 → **「寄出去了」這件事沒有寫回我們的資料庫** → 該列被回收重試 → 期間箱被作廢
    //      → 本片退休舊鍵 → 箱被復原 → view 排出**新的一列(新 uuid)** → **新的冪等鍵** ⇒ 再寄一次。
    //    🔴 在本片之前,那把鍵永遠被佔住 ⇒ 不會有新列 ⇒ 不會重寄。**這一條是本片帶來的。**
    //    🔴 **而「沒有寫回」不只 `markSent` 寫 DB 失敗一種**(codex R2:我原本只寫了那一種,把範圍寫窄了):
    //      · `markSent` 的 CAS 回 `false`(lease 已被回收 ⇒ 不是它的了)
    //      · Resend 收下之後、`markSent` 之前**程序被 kill**(部署、OOM、逾時)
    //      ⇒ 三種都留下「已寄出而我們不知道」的那一列 ⇒ 都走得到下面這條路。
    //    ⇒ 要**降低**它:把冪等鍵改成 per-(shipment, order) 而不是 per-row ⇒ 另一支檔、另一片。
    //      🔴 **而那【不是根治】**:`ResendEmailSenderAdapter.ts:7` 逐字「官方保留 **24h**、只是第一道網」
    //      ⇒ 兩次寄送相隔超過 24 小時仍會重複 —— 而本片這兩次之間隔著「作廢→復原」**一個人的操作**,
    //         那很容易超過一天。⇒ 📌 **所以那一片是【降低】不是【關掉】,不要寫成根治。**
    // ✅ 不影響 `resolveUniqueViolation` 那發等值查:退休過的列本來就**不該**被當成
    //    「同事件的既有列」,而新列用正規鍵 ⇒ 兩者不會撞。
    return this.leaveSending(id, claimedAttempts, {
      status: 'skipped_shipment_voided',
      last_error_code: 'shipment_voided',
      dedup_key: `${currentDedupKey}:voided:${id}`,
    });
  }

  /**
   * lease 回收(port JSDoc 為合約全文)。**不能走 `leaveSending`**:那支硬帶
   * `.eq('attempts', claimedAttempts)` 世代柵欄,而回收器不是持有者、無此值。
   *
   * 🔴 述詞本身即所有權判定:`status='sending' AND claimed_at < staleBefore`(吃
   * `email_outbox_lease_idx`=partial on status='sending')。原持有者若在本句之前標記完成 →
   * status 已離開 sending → 0 列;兩個回收器並發 → PG 列鎖序列化,後者看到的已是 failed → 0 列。
   * 🔴 `attempts` 不動(認領時已 +1);`claimed_at = NULL` 是雙向 CHECK 的 app 義務。
   * 🔴 無 `attempts < max_attempts` guard = **刻意**:達上限的列也必須離開 sending,否則永久卡
   * sending → 訊號 3 永久告警;落 failed@max 後由訊號 2(dead letter)接手 = 正確歸屬。
   *
   * ⚠️ **無 `limit` = 無界批次(關卡2 codex nit;量級假設寫死於此)**:單句 UPDATE 會翻掉**所有**
   * 符合 stale 述詞的列。現況可接受(只有「先前被認領過」的列可能 stale;PCM 每日數十封,
   * 且 stale 列數受 `claimDue` 的 limit 上界約束)。🔴 **但本 port 無物理批次上限** → caller 傳錯
   * `staleBefore`(例如取值過小)會**一次翻掉所有在途列** = 系統性重複寄信。故安全下界是 caller
   * 責任(見 port JSDoc);E2a-b 應評估是否加明確 batch limit / `maxAffected`。
   */
  async reclaimStaleLeases(staleBefore: Date, nextRetryAt: Date): Promise<number> {
    const { data, error } = await this.client
      .from('email_outbox')
      .update({
        status: 'failed',
        claimed_at: null,
        last_error_code: LEASE_RECLAIMED_ERROR_CODE,
        next_retry_at: nextRetryAt.toISOString(),
      })
      .eq('status', 'sending')
      .lt('claimed_at', staleBefore.toISOString())
      .select('id');
    if (error) {
      throw new Error(`email_outbox lease 回收失敗(${error.code ?? 'unknown'})`);
    }
    return data?.length ?? 0;
  }

  /**
   * **持有者路徑**離開 sending 的唯一出口(⚠️ E2a-a 起**不是全域唯一** —— `reclaimStaleLeases`
   * 是回收器路徑的第二個出口,不經本 helper;前版「離開 sending 的唯一出口」字面已於本片更正)。
   * 一律連帶 `claimed_at = NULL`(雙向 CHECK 的 app 義務;漏清 →
   * 每次標記都 check_violation → 列卡 sending → lease 回收重認領 = 系統性重複寄信)。
   * 述詞鎖 `status='sending'` **+ `attempts = claimedAttempts` 世代柵欄**(codex 關卡2 R1
   * must-fix:lease 回收→他人再認領後 attempts 已 +1,舊持有者延遲標記必 0 列、不覆寫
   * 別人的在途列 = ABA 擋掉)。false 讓 caller 知道所有權已失、不得重試覆寫。
   */
  private async leaveSending(
    id: string,
    claimedAttempts: number,
    // 🔴 #415 code-reviewer MF4:原本是 `Record<string, unknown>` ⇒ index signature 把欄名檢查整個吃掉,
    //    mark* 五出口(2026-08-30 由三變四:加了 markSkippedShipmentVoided;
    //    2026-09-02 由四變五:加了 markSkippedOrderCancelled —— codex R2 nit 抓到這個數字舊了)寫的
    //    `status` / `sent_at` / `last_error_code` / `next_retry_at` **打錯完全不紅**
    //    (實測 `sent_at_TYPO` tsc 0 error)。改用生成型別的 Update 形狀 ⇒ 欄名這一層才真的有人守。
    //
    // 🔴🔴 **⟦b4-NOSENTBODY⟧(2026-09-06):那個交集型別是【暫時的】, 而它要被拿掉。**
    //    `provider_message_id` 由 `20260906200000`(貼板 45g)新增, 而**產生型 `Database` 是從
    //    正式庫產的** ⇒ 45g 貼之前它不在裡面 ⇒ 直接寫會 `TS2353`。
    //    ⛔ **不用 `as never` / `Record<string, unknown>` 繞過** —— 那會把上面那道
    //      「欄名打錯要紅」整個關掉, 而那正是它當初存在的理由。
    //    ✅ 改成**只把那一個已知的新欄加進來** ⇒ 其餘每一個欄名照舊被守著。
    //    🛑 **拿掉的條件寫死在這裡**:45g 貼完 + 重新產型別之後, **把 `& { … }` 那一段刪掉**;
    //      刪不掉(還是紅)⇒ 代表型別沒重產, 那才是要查的事。
    values: Database['public']['Tables']['email_outbox']['Update'] & {
      provider_message_id?: string | null;
    },
  ): Promise<boolean> {
    // 🔴🔴 **先讓最終物件過一次型別, 再在【最末端】cast**(codex R1-#9)——
    //    ⛔ ~~`.update({ ...values, claimed_at: null } as never)`~~
    //    🛑 那個寫法把**整個最終 payload** 的檢查關掉 ⇒ 這裡硬寫的 `claimed_at` 打成
    //      `claimed_att` **不會型別紅**, 而 PostgREST 會拒整發標記(= 那一列留在 sending)。
    //    ✅ `satisfies` 讓最終物件仍然被那個(生成型別 + 一個已知新欄)守著;
    //      `as never` 只用在**交給 client 的那一刻**, 它關掉的是 client 對「多餘屬性」的拒絕。
    //    🛑 **拿掉的條件同上**:45g 貼完 + 重新產型別 ⇒ 把 `& { … }` 與 `as never` 一起刪。
    const patch = { ...values, claimed_at: null } satisfies Database['public']['Tables']['email_outbox']['Update'] & {
      provider_message_id?: string | null;
    };
    const { data, error } = await this.client
      .from('email_outbox')
      // 🔴🔴 **這個 cast 是【暫時的】, 而它比看起來窄** —— ⟦b4-NOSENTBODY⟧ 2026-09-06:
      //    產生型 `Database` 是從**正式庫**產的 ⇒ 45g(`20260906200000`)貼之前
      //    `provider_message_id` 不在它裡面, 而 client 的 `update()` **拒絕多餘屬性**。
      // 🔵 **它關掉的只有【client 這一次呼叫】的檢查, 不是欄名保護**:
      //    `values` 的型別在**函式簽章那一層**仍然是生成型別(+ 那一個已知新欄)
      //    ⇒ 📌 **五個 mark* 出口打錯欄名照樣紅** —— 那正是那道守門當初存在的理由, 它還在。
      // 🛑 **拿掉的條件**:45g 貼完 + 重新產型別 ⇒ **把 `as never` 刪掉**;
      //    刪了還紅 ⇒ 型別沒重產, 那才是要查的事。
      .update(patch as never)
      .eq('id', id)
      .eq('status', 'sending')
      .eq('attempts', claimedAttempts)
      .select('id');
    if (error) {
      throw new Error(`email_outbox 標記失敗(${error.code ?? 'unknown'})`);
    }
    return (data?.length ?? 0) === 1;
  }
}
