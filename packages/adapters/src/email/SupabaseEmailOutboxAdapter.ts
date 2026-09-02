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
} from '@pcm/ports';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../supabase/database.types';

import {
  buildOrderCreatedPayload,
  buildOrderShippedPayload,
  orderCreatedSubject,
  orderShippedSubject,
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
};
const EMAIL_SEND_ERROR_CODE_ALLOWLIST = new Set<string>(Object.keys(EMAIL_SEND_ERROR_CODE_FLAGS));

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
  payload: OrderCreatedEmailPayload | OrderShippedEmailPayload;
  subject: string;
  dedupKey: string;
} {
  switch (input.eventType) {
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

export class SupabaseEmailOutboxAdapter implements IEmailOutbox {
  constructor(
    private readonly client: EmailOutboxClient,
    private readonly cfg: SupabaseEmailOutboxAdapterConfig,
  ) {}

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
    if (exclude.length === 1) {
      q = q.neq('event_type', exclude[0] as string);
    } else if (exclude.length > 1) {
      throw new Error(
        'claimDue:excludeEventTypes 一次只支援 1 個(≥2 的 PostgREST 文法本 repo 未驗證;見本行上方註解)',
      );
    }
    const { data, error } = await q
      .order('next_retry_at', { ascending: true })
      // 🔴 取大窗(見 DUE_SCAN_CAP):先 limit 再過濾會被恆最老的死列餓死活信(R1 Critical)。
      .limit(Math.max(limit, DUE_SCAN_CAP));
    if (error) {
      throw new Error(`email_outbox due 掃描失敗(${error.code ?? 'unknown'})`);
    }
    // 欄對欄 guard 的 app 層半段(死列 attempts>=max 不進 CAS;原子性由 CAS 內字面值 guard 收口)。
    const candidates = (data ?? []).filter((row) => row.attempts < row.max_attempts);
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

  async markSent(id: string, claimedAttempts: number): Promise<boolean> {
    return this.leaveSending(id, claimedAttempts, {
      status: 'sent',
      sent_at: new Date().toISOString(),
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
    //    mark* 四出口(2026-08-30 由三變四:加了 markSkippedShipmentVoided)寫的
    //    `status` / `sent_at` / `last_error_code` / `next_retry_at` **打錯完全不紅**
    //    (實測 `sent_at_TYPO` tsc 0 error)。改用生成型別的 Update 形狀 ⇒ 欄名這一層才真的有人守。
    values: Database['public']['Tables']['email_outbox']['Update'],
  ): Promise<boolean> {
    const { data, error } = await this.client
      .from('email_outbox')
      .update({ ...values, claimed_at: null })
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
