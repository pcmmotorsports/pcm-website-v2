/**
 * @module @pcm/adapters/payment/PgAnomalyAlertReaderAdapter — 雙扣 anomaly 告警聚合讀主軌(M-3 #250)
 *
 * **🔴 server-only + payment_confirmer 窄權**(同 PgReleaseSiblingAdapter:持 `PAYMENT_CONFIRMER_DB_URL`、
 * pg 不污染 root barrel;連線安全完全複用 `buildPgConfig`〔session pooler + 完整 CA 驗證 + host 釘死 +
 * 顯式 servername〕;per-request `new Client()` + `finally end()`)。
 *
 * 呼 owner-defined SECDEF 聚合 RPC `get_payment_anomaly_alert_summary(p_refunding_stuck_seconds,
 * p_pending_dc_window_seconds, p_pending_dc_stuck_seconds)`(#250 六計數 + #256 第 7 計數)
 * → 回 jsonb `{open_count,refunding_count,refunding_stuck_count,oldest_open_age_seconds,
 * attempt_manual_review_count,released_stuck_count,pending_double_charge_candidate_count}`
 * (計數;payment_confirmer 對 anomaly 兩表 / attempts / orders 零表權、只能經此 SECDEF 受控窗讀)
 * **以及** `get_payment_anomaly_alert_display_ids` 回的**五個訂單單號陣列**。
 * 🔴 **2026-08-24(F-004)起還有第三支** `get_order_refunds_stuck_summary()`(零參數)——
 *    退款卡住計數,分母是 `order_refunds`,與上面那支的 `refunding_stuck_count`【不同表】。
 * 🔴 ~~原句「零 PII 計數」~~ 2026-08-19 作廢:**本層現在會下放訂單單號**,
 *    那道閘是 Sean 本人拍板打開的(理由與代價見 `packages/use-cases/src/check-anomaly-alerts.ts` 檔頭)。
 * 本層把 DB snake_case 映射成 domain camelCase。
 *
 * 錯誤紀律(對齊 PgReleaseSiblingAdapter):不轉傳 pg 原始 message;throw 通用訊息 + 安全 SQLSTATE `code`
 * 屬性(零 PII/token)。本 RPC 唯讀不 RAISE 業務拒絕;throw 僅 transport/parse。
 *
 * @see supabase/migrations/20260701120000_m3_250_anomaly_alert_summary.sql
 * @see docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md §7
 */
import 'server-only';

import { Client } from 'pg';
import type { IAnomalyAlertReader } from '@pcm/ports';
import type { AnomalyAlertSummary } from '@pcm/domain';
// 🔴 **門檻與名單的唯一來源** —— DB 那一側刻意不知道任何門檻(見片2 migration 檔頭)。
//    ⇒ 這裡送出去的就是白名單全部;**不得在這裡過濾** ——
//      少送一支 = 那支排程死掉時心跳告警【永遠印健康】, 而 DB 證明不了它少了。
import { CRON_JOB_WHITELIST, FAILURE_COUNT_MEANINGLESS } from '@pcm/domain';
import { buildPgConfig, type PgClientLike } from './PaymentConfirmerAdapter';

/** 帶安全 SQLSTATE 的告警讀錯誤(message 通用、code 供分類;零 pg 原文/token)。 */
export type AnomalyAlertReaderError = Error & { code?: string };

/** 本層 RPC 回應解析錯誤(branded:sanitizeError 憑類別放行、不靠「無 code」啟發式)。 */
class AnomalyAlertReaderParseError extends Error {}

/**
 * PostgreSQL `undefined_function`。
 * 🔴 **這是唯一一個會被降級成「沒有單號」的錯誤碼**,理由見 `getAlertSummary` 內那段。
 *    值的來源 = PostgreSQL 官方 Appendix A「PostgreSQL Error Codes」Class 42。
 */
const UNDEFINED_FUNCTION = '42883';
/** ⟦b9-ENUMWATCH⟧ 片 2:單一來源的 RPC 名(錯誤訊息與探詢字面都從這裡來)。 */
const RPC_MANUAL_SEARCH = 'get_manual_customer_search_summary';
const RPC_SEARCH_LOG_HEALTH = 'get_search_log_health';
const RPC_STUCK_BANK_HEALTH = 'get_stuck_bank_orders_health';
const RPC_SYNC_STALE = 'get_supplier_sync_stale_counts';

function defaultClientFactory(connectionString: string): PgClientLike {
  return new Client(buildPgConfig(connectionString)) as unknown as PgClientLike;
}

export class PgAnomalyAlertReaderAdapter implements IAnomalyAlertReader {
  constructor(
    private readonly connectionString: string,
    private readonly clientFactory: (
      connectionString: string,
    ) => PgClientLike = defaultClientFactory,
  ) {}

  async getAlertSummary(
    refundingStuckSeconds: number,
    pendingDcWindowSeconds: number,
    pendingDcStuckSeconds: number,
    /**
     * 🔵 出貨信起始線(ISO 8601 UTC;對應 env `SHIPPED_EMAIL_CUTOFF`)。
     * 🛑 **`null` = 那一段【整段不查】** —— 而那不是失敗, 是「還沒上膛」。
     *   ⇒ 落 `shippedGapUnknown`, 而那個狀態由呼叫端印在 log 上(不進 `shouldAlert`)。
     */
    shippedCutoffIso: string | null,
    /** 🔵 出貨信寬限秒數(Sean `2 甲` = 15 分鐘 = 3 次掃描;route 常數注入)。 */
    shippedGraceSeconds: number,
    /**
     * 🔵 訊號 4 的起始線(ISO 8601 UTC;對應 env `B4_DEPLOY_CUTOFF`,**與寄信端同一顆**)。
     * 🛑 **`null` = 那一段【整段不查】** —— 而那不是失敗, 是「還沒上膛」或「值不合法」。
     *   ⇒ 落 `orderCreatedGapUnknown`, 而那個狀態由呼叫端印在 log 上(不進 `shouldAlert`)。
     * 🔴 **它與 `shippedCutoffIso` 是【兩顆不同的 env】** —— 寄信那兩條線是分別上線的,
     *   起始線不是同一刻(`email-sweep/route.ts` 檔頭逐字:「它們刻意**不共用** cutoff」)。
     */
    orderCreatedCutoffIso: string | null,
    orderCreatedStuckMinutes: number | null,
  ): Promise<AnomalyAlertSummary> {
    return this.run(async (client) => {
      const args = [refundingStuckSeconds, pendingDcWindowSeconds, pendingDcStuckSeconds];
      const counts = await client.query(
        'SELECT public.get_payment_anomaly_alert_summary($1::integer, $2::integer, $3::integer) AS result',
        args,
      );

      /**
       * 🔴 **單號走【另一支】函式,而不是併進上面那支** ——
       *    那支 summary RPC 有四代定義散在四支 migration 裡,重貼整支會安靜倒退兩代
       *    (成因與實錘寫在 `supabase/migrations/20260819130000_…display_ids.sql` 檔頭)。
       *
       * 🔴 **只有「函式不存在」(SQLSTATE `42883`)才降級成空陣列。**
       *    那是**部署窗口**:程式先上、migration 還沒 apply。此時 throw ⇒ 整支告警 503
       *    ⇒ **雙扣告警在那段時間完全停掉**,比「訊息裡少了單號」嚴重得多。
       *    ⚠️ **其餘錯誤一律上拋**,特別是 `42501`(權限被收走)——
       *       那不是部署窗口,那是有人把受控窗關掉了,**必須吵**。
       *       把它一起吞掉的話,「我們拿不到單號」會被讀成「今天沒有單號」。
       */
      let ids: Array<Record<string, unknown>> = [];
      try {
        const res = await client.query(
          'SELECT public.get_payment_anomaly_alert_display_ids($1::integer, $2::integer, $3::integer) AS result',
          args,
        );
        ids = res.rows;
      } catch (err) {
        if ((err as { code?: unknown } | null)?.code !== UNDEFINED_FUNCTION) throw err;
        // 🔴🔴 **`42883` 不等於「我們那支函式不存在」**(codex R2 must-fix):
        //    函式**存在**、而它的**函式體**裡少了某個 helper/operator,PG 回的是**同一個碼**。
        //    照碼降級 ⇒ 一支壞掉的函式會被安靜地讀成「今天沒有單號」,而它不會自己好。
        //    ⇒ 再問一次「它到底在不在」:`to_regprocedure` 回 NULL 才是真的不存在(=部署窗口)。
        //      回得出 oid ⇒ 那個 42883 來自**函式內部** ⇒ **原封上拋**。
        //    ⚠️ 這一發只在錯誤路徑跑,正常情況零成本。
        const probe = await client.query(
          "SELECT to_regprocedure('public.get_payment_anomaly_alert_display_ids(integer,integer,integer)') IS NULL AS missing",
          [],
        );
        if (probe.rows[0]?.missing !== true) throw err;
      }

      /**
       * 🔴 **F-004 第三支 RPC:退款卡住計數(分母 `order_refunds`)。**
       *
       * 為什麼是【另一支函式】而不是把 key 加進上面那支 summary:
       * 那支的定義散在四支 migration,而 `20260810220000` 檔內有**四顆 pre-image md5
       * fail-closed 閘 + 三道 post-image prosrc 指紋**在守它;同簽章重貼可能**安靜撤回**
       * `L5b-0-s` 的最新述詞,而新 key 照常出現、型別過、ACL 過、三綠過。
       * ⇒ 而走那條路要 live pre-image md5,施工窗零 DB access ⇒ **做不到那道驗證。**
       *    「我做不到那道驗證」本身就是選路的理由,不只是風險。
       *
       * 降級**逐字沿用上面 display_ids 那一條**(不是新發明的):
       *   `42883` → `to_regprocedure` 複查 → 真的不存在 ⇒ unknown(部署窗口)
       *   `42883` 而 oid 回得出來 ⇒ **原封上拋**(函式體壞了,必須吵)
       *   `42501`(權限被收走)⇒ **原封上拋**
       * 🔴 而 unknown **不寫成 0** —— `null` 與 `0` 在信上要印不同的字。
       */
      let refundRows: Array<Record<string, unknown>> = [];
      try {
        const res = await client.query(
          'SELECT public.get_order_refunds_stuck_summary() AS result',
          [],
        );
        refundRows = res.rows;
      } catch (err) {
        if ((err as { code?: unknown } | null)?.code !== UNDEFINED_FUNCTION) throw err;
        const probe = await client.query(
          "SELECT to_regprocedure('public.get_order_refunds_stuck_summary()') IS NULL AS missing",
          [],
        );
        if (probe.rows[0]?.missing !== true) throw err;
      }

      /**
       * 🔴 **M-4a 第四支 RPC:寄信死人開關的五個計數(分母 `email_outbox`)。**
       *
       * 為什麼是另一支函式:`email_outbox` 的 `SELECT` **只授權 `service_role`**
       * (`20260717020000` 的 GRANT),而本 adapter 跑在 `payment_confirmer`(對該表零表權)
       * ⇒ **直接查表 = 42501**。唯一的路 = owner-defined SECDEF 受控窗。
       *
       * ⚠️ **兩個秒數參數必須明確傳**(該簽章**無 `DEFAULT`**,省略 = 找不到相符簽章):
       *   · `p_stale_sending_seconds` = sweeper 的 lease。真值在 `sweep-email-outbox.ts`
       *     的 `MIN_LEASE_SECONDS`(3600)⇒ 🔴 **這裡不抄一份會漂,而 SQL 端 clamp 下限也是 3600**
       *     ⇒ 兩邊同時往下漂才會出事,而那需要有人同時改兩處。
       *   · `p_signal1_grace_seconds` = 訊號 1 的寬限。🔴 **它在 sweeper 那側【沒有真值】**
       *     (codex R2 抓到)⇒ 這裡用 3600,而**那是一個未決的營運參數,不是量出來的**。
       *     SQL 端 clamp 下限 300(= 一個 排程週期(五分鐘一輪)),擋掉「合法等下一輪」被誤報成排程死。
       *
       * 降級**逐字沿用上面兩條**(不是新發明的):`42883` → `to_regprocedure` 複查 →
       * 真的不存在 ⇒ unknown(部署窗口);oid 回得出來 ⇒ 原封上拋;`42501` ⇒ 原封上拋。
       * 🔴 而 unknown **不寫成 0** —— **「讀不到」與「一切正常」在一個裸數字上長得一模一樣。**
       */
      let emailRows: Array<Record<string, unknown>> = [];
      try {
        const res = await client.query(
          'SELECT public.get_email_outbox_deadman_counts($1::integer, $2::integer) AS result',
          [EMAIL_STALE_SENDING_SECONDS, EMAIL_SIGNAL1_GRACE_SECONDS],
        );
        emailRows = res.rows;
      } catch (err) {
        if ((err as { code?: unknown } | null)?.code !== UNDEFINED_FUNCTION) throw err;
        const probe = await client.query(
          "SELECT to_regprocedure('public.get_email_outbox_deadman_counts(integer,integer)') IS NULL AS missing",
          [],
        );
        if (probe.rows[0]?.missing !== true) throw err;
      }

      /**
       * 🔵 **出貨信缺口計數**(2026-08-31;Sean 逐字答 `2 甲`;RPC `get_shipped_email_gap_counts`)。
       *
       * 🛑 **只有【起始線有值】才呼叫** —— 那支 RPC 的兩個參數**無 DEFAULT**,
       *   而它自己的閘會對 `NULL` 直接 `RAISE`(那是刻意的:`NULL` 比較 = UNKNOWN ⇒ 恆回 0 = 靜默漏報)。
       *   ⇒ 沒有起始線 ⇒ **不呼叫**, 落 `shippedGapUnknown` ⇒ 而那個狀態由呼叫端印在 log 上。
       * 🔴 降級**逐字沿用寄信那條**:`42883` → `to_regprocedure` 複查 → 真的不存在 ⇒ unknown;
       *   oid 回得出來 ⇒ 原封上拋;`42501` ⇒ 原封上拋。
       *   **而 unknown 不寫成 0** —— 「讀不到」與「一切正常」在一個裸數字上長得一模一樣。
       */
      let shippedRows: Array<Record<string, unknown>> = [];
      if (shippedCutoffIso !== null) {
        try {
          const res = await client.query(
            'SELECT public.get_shipped_email_gap_counts($1::timestamptz, $2::integer) AS result',
            [shippedCutoffIso, shippedGraceSeconds],
          );
          shippedRows = res.rows;
        } catch (err) {
          const code = (err as { code?: unknown } | null)?.code;
          /**
           * 🔴🔴 **`P0001` = 那支函式【自己的參數閘】RAISE 了**(`-48` 2026-08-31 指名的驗收)。
           *
           * **我量過現在會怎樣, 沒有猜**:`P0001` 原封上拋 ⇒ `getAlertSummary` throw
           * ⇒ use-case throw ⇒ route 503 ⇒ **今晚一封告警都不寄**。
           * ⇒ 📌 **一個【設定問題】把整條告警帶走了** —— 而那正是告警最該在的那一晚。
           *
           * 🛑 **而它也不可以被吞成 0** —— 那會把片1 剛裝上的 fail-closed 在下游拆掉
           *   (那支函式的閘存在的理由就是「NULL ⇒ 恆回 0 = 靜默漏報」)。
           * ✅ **⇒ 兩個都不要:降級成 `unknown` + 一行 `console.error`。**
           *   `unknown` 不進 `shouldAlert`, 而 route 在【起始線有設】時據它回 503
           *   ⇒ **那一段變成「查不到」, 而不是「0」, 也不是「整條沒了」。**
           * ⚠️ **只降級 `P0001`** —— `42501`(權限)與其他碼**照舊原封上拋**:
           *   那些不是設定問題, 而把它們吞掉會讓一個真的壞掉被讀成「還沒上膛」。
           */
          /**
           * 🔴 **只認【那支函式自己的參數閘】,不是「凡 P0001 都降級」**(codex 2026-08-31 R1 nit)。
           * ⛔ ~~舊寫法 `if (code === RAISE_EXCEPTION)`~~ —— 那把**任何** `P0001` 都當成參數閘。
           * ⚠️ **今天踩不踩得到:踩不到。** 數法
           *   `grep -c 'RAISE EXCEPTION' <20260831020000_...sql>` ⇒ **7**,而其中**只有 2 條在函式體內**
           *   (`:65` / `:68`,兩條都是參數閘);其餘 5 條在 apply 期的 DO 斷言塊,呼叫時跑不到。
           * 🔴 **⇒ 所以這是【未來的洞】不是今天的**:哪天那支函式用 `RAISE EXCEPTION` 回報別的
           *   完整性錯誤,它會被**靜靜降級成「查不到」**,而那是一個真的壞掉被讀成「還沒上膛」。
           * ✅ 收窄成:`P0001` **且**訊息帶那支函式自己的前綴。
           * 🛑 而收窄的失敗方向是**安全的那一邊**:訊息哪天改了 ⇒ 認不出來 ⇒ **原封上拋**(現況行為),
           *   不會變成靜默降級。
           */
          if (code === RAISE_EXCEPTION) {
            /**
             * 🔵 **訊息前綴只用來【分類 log】,不用來改控制流**(codex 2026-08-31 R2 must-fix ×2)。
             *
             * ⛔ ~~我 R2 之前的修法:前綴不符 ⇒ `throw err`~~ —— **那是我 R1 剛被打過的同一個錯**:
             *   codex 逐字「migration 改動參數閘前綴或標點而應用程式尚未同步 ⇒ 真正可降級的參數錯誤
             *   改成整條上拋,**付款／退款等其他告警同輪無法送出**」。
             *   📌 **⇒ 我把「未來可能誤分類」換成了「訊息一漂就整條告警死掉」。那個交換是虧的。**
             * 🛑 而 codex 同時指出前綴**也擋不住**它原本要擋的:日後那支函式用**同一個前綴**
             *   拋非參數閘的 `P0001`,照樣被當成參數閘。**⇒ 前綴在兩個方向上都不是那道判準。**
             * ✅ **⇒ 控制流維持現況(`P0001` ⇒ 降級),前綴只決定 log 印哪一句** ——
             *   拿不到訊號的成本是 0,而拿錯控制流的成本是整條告警。
             * ⚠️ **今天踩不踩得到:踩不到。** 那支函式體內只有 2 條 `RAISE`,兩條都是參數閘
             *   (全檔 `grep -c 'RAISE EXCEPTION'` ⇒ 7,其餘 5 條在 apply 期 DO 塊、呼叫時跑不到)。
             */
            const looksLikeOwnGate =
              typeof (err as { message?: unknown }).message === 'string' &&
              (err as { message: string }).message.includes('get_shipped_email_gap_counts:');
            console.error(
              looksLikeOwnGate
                ? '[anomaly-alert] 🔴 get_shipped_email_gap_counts 自己 RAISE 了(參數閘)⇒ 出貨缺口那一段降級成【查不到】,而其他告警照常送'
                : '[anomaly-alert] 🔴 get_shipped_email_gap_counts 拋了 P0001 而【訊息不像它自己的參數閘】⇒ 仍降級成【查不到】(不改控制流),但這一格值得有人去看',
              {
                code: RAISE_EXCEPTION,
                reason: looksLikeOwnGate ? 'shipped_gap_rpc_raised' : 'shipped_gap_rpc_raised_unexpected_shape',
              },
            );
          } else {
            if (code !== UNDEFINED_FUNCTION) throw err;
            const probe = await client.query(
              "SELECT to_regprocedure('public.get_shipped_email_gap_counts(timestamptz,integer)') IS NULL AS missing",
              [],
            );
            if (probe.rows[0]?.missing !== true) throw err;
          }
        }
      }

      /**
       * 🔵 **訊號 4:訂單已付款而 `order_created` 那一列根本沒被建出來**
       * (2026-08-31;Sean 拍 5️⃣ 甲;RPC `get_order_created_gap_counts`)。
       *
       * 🛑 **形狀逐字沿用出貨那一段** —— 起始線 `null` ⇒ **不呼叫**(那支 RPC 的參數無 DEFAULT,
       *   它自己的閘會對 `NULL` 直接 `RAISE`)⇒ 落 `orderCreatedGapUnknown`。
       * 🔵 **狀態(2026-08-31 14:0x 更新)**:那支 RPC **已經 apply 到正式庫了**
       *   (Sean 本人貼;`supabase/APPLIED.tsv` 那一列有六格唯讀複驗)。
       *   ⛔ ~~我第一版寫「它現在還沒 apply ⇒ 42883 今天一定走得到」~~ —— **半小時後就過期了**
       *   (codex R1 nit 抓到:值班的人會被導向錯誤的部署原因,且與帳本衝突)。
       * 🔴 **而那條路仍然要留**:`42883` 是**部署窗口**那一種 —— 碼先上線而 migration 還沒到的世界。
       *   它今天不會走到,不代表它不會再發生。
       *   `to_regprocedure` 複查 → 真的不存在 ⇒ unknown(部署窗口);oid 回得出來 ⇒ 原封上拋。
       *   ⇒ 📌 **所以它一定要降級,不能讓整支告警死掉** —— 那正是本片 codex R1 打過我一次的地方。
       * ⚠️ `P0001` 的處置也逐字沿用:**控制流一律降級**,訊息前綴只決定 log 印哪一句。
       */
      let orderCreatedRows: Array<Record<string, unknown>> = [];
      if (orderCreatedCutoffIso !== null) {
        try {
          const res = await client.query(
            'SELECT public.get_order_created_gap_counts($1::timestamptz) AS result',
            [orderCreatedCutoffIso],
          );
          orderCreatedRows = res.rows;
        } catch (err) {
          const code = (err as { code?: unknown } | null)?.code;
          if (code === RAISE_EXCEPTION) {
            const looksLikeOwnGate =
              typeof (err as { message?: unknown }).message === 'string' &&
              (err as { message: string }).message.includes('get_order_created_gap_counts:');
            console.error(
              looksLikeOwnGate
                ? '[anomaly-alert] 🔴 get_order_created_gap_counts 自己 RAISE 了(參數閘)⇒ 訊號4 那一段降級成【查不到】,而其他告警照常送'
                : '[anomaly-alert] 🔴 get_order_created_gap_counts 拋了 P0001 而【訊息不像它自己的參數閘】⇒ 仍降級成【查不到】(不改控制流),但這一格值得有人去看',
              {
                code: RAISE_EXCEPTION,
                reason: looksLikeOwnGate
                  ? 'order_created_gap_rpc_raised'
                  : 'order_created_gap_rpc_raised_unexpected_shape',
              },
            );
          } else {
            if (code !== UNDEFINED_FUNCTION) throw err;
            const probe = await client.query(
              "SELECT to_regprocedure('public.get_order_created_gap_counts(timestamptz)') IS NULL AS missing",
              [],
            );
            if (probe.rows[0]?.missing !== true) throw err;
          }
        }
      }

      /**
       * 🔴🔴 **訊號4 的【持續失敗】那一格(板 `⟦b4-SIG4ERRORS⟧`)**。
       *   降級處置**逐字沿用上面訊號4 那一段** —— 函式不存在(部署窗口)⇒ 落 unknown;
       *   它自己 `RAISE`(參數閘)⇒ 一樣降級, **而其他告警照常送**。
       * 🛑 **兩顆 env 任一沒設就不查, 而那不是保守** ——
       *   `orderCreatedStuckMinutes` 沒設 = 那條線**還沒上膛**
       *   ⇒ 📌 **這一格就是「落地」與「Sean 去填那顆 env」脫鉤的地方。**
       */
      /**
       * 🔵 **未付款取消信線的同一支**(⟦b4-NORECIPIENTWINDOW⟧, 2026-09-03)。
       * 🔴 **共用 `orderCreatedCutoffIso`, 而那不是偷懶** —— 寄信端那三條線本來就共用
       *    同一顆 `B4_DEPLOY_CUTOFF`(`email-sweep/route.ts` 逐字「與 B-5 共用同一顆 cutoff」),
       *    兩邊問的是同一件事:「上線那一刻之後才算」。
       *    ⇒ 📌 **共用意味著:那顆沒設 ⇒ 這一段也不查** ⇒ 落 unknown、不叫。**那是刻意的。**
       * ⚠️ 降級處置**逐字沿用**姊妹那支:RAISE / 函式不存在 ⇒ 降級成【查不到】,
       *    **不讓整支告警死掉** —— 其他告警照常送。
       */
      let unpaidCancelledRows: Array<Record<string, unknown>> = [];
      if (orderCreatedCutoffIso !== null) {
        try {
          const res = await client.query(
            'SELECT public.get_order_unpaid_cancelled_gap_counts($1::timestamptz) AS result',
            [orderCreatedCutoffIso],
          );
          unpaidCancelledRows = res.rows;
        } catch (err) {
          const code = (err as { code?: unknown } | null)?.code;
          if (code === RAISE_EXCEPTION) {
            const looksLikeOwnGate =
              typeof (err as { message?: unknown }).message === 'string' &&
              (err as { message: string }).message.includes(`${UNPAID_CANCELLED_FN}:`);
            console.error(
              looksLikeOwnGate
                ? '[anomaly-alert] 🔴 get_order_unpaid_cancelled_gap_counts 自己 RAISE 了(參數閘)⇒ 取消信收件人那一段降級成【查不到】,而其他告警照常送'
                : '[anomaly-alert] 🔴 get_order_unpaid_cancelled_gap_counts 拋了 P0001 而【訊息不像它自己的參數閘】⇒ 仍降級成【查不到】(不改控制流),但這一格值得有人去看',
              {
                code: RAISE_EXCEPTION,
                reason: looksLikeOwnGate
                  ? 'unpaid_cancelled_gap_rpc_raised'
                  : 'unpaid_cancelled_gap_rpc_raised_unexpected_shape',
              },
            );
          } else {
            if (code !== UNDEFINED_FUNCTION) throw err;
            const probe = await client.query(
              "SELECT to_regprocedure('public.get_order_unpaid_cancelled_gap_counts(timestamptz)') IS NULL AS missing",
              [],
            );
            if (probe.rows[0]?.missing !== true) throw err;
          }
        }
      }

      /**
       * 🔵 **更正單號信線的同一支**(⟦b4-NORECIPIENTWINDOW⟧ 第四條線, 2026-09-04)。
       *
       * 🔴🔴 **它【沒有 cutoff 參數, 也沒有那個 `if (cutoff !== null)` 守門】—— 而那不是漏了。**
       *    姊妹那三條要 cutoff, 因為它們的母體(`orders` / 已出貨的箱)在功能上線前就存在
       *    ⇒ 不設起始線就會把歷史全部算進來。
       *    而本線的觸發欄 `shipments.tracking_corrected_at` 是 2026-09-04 片 C 才新增的
       *    ⇒ **歷史上每一箱都是 NULL** ⇒ 母體天生從空的開始長。
       *    ⇒ 📌 **所以本段【不論那顆 env 有沒有設都會查】** —— 這是與上面三段唯一的控制流差異,
       *      而它值得寫出來:讀的人看到別人都有守門而這裡沒有, 第一個念頭會是「是不是漏了」。**不是。**
       * ⚠️ 降級處置**逐字沿用**姊妹那支:RAISE / 函式不存在 ⇒ 降級成【查不到】, 不讓整支告警死掉。
       */
      let trackingCorrectedRows: Array<Record<string, unknown>> = [];
      try {
        const res = await client.query(
          'SELECT public.get_tracking_corrected_gap_counts() AS result',
          [],
        );
        trackingCorrectedRows = res.rows;
      } catch (err) {
        const code = (err as { code?: unknown } | null)?.code;
        if (code === RAISE_EXCEPTION) {
          const looksLikeOwnGate =
            typeof (err as { message?: unknown }).message === 'string' &&
            (err as { message: string }).message.includes(`${TRACKING_CORRECTED_FN}:`);
          console.error(
            looksLikeOwnGate
              ? '[anomaly-alert] 🔴 get_tracking_corrected_gap_counts 自己 RAISE 了 ⇒ 更正信收件人那一段降級成【查不到】,而其他告警照常送'
              : '[anomaly-alert] 🔴 get_tracking_corrected_gap_counts 拋了 P0001 而【訊息不像它自己的閘】⇒ 仍降級成【查不到】(不改控制流),但這一格值得有人去看',
            {
              code: RAISE_EXCEPTION,
              reason: looksLikeOwnGate
                ? 'tracking_corrected_gap_rpc_raised'
                : 'tracking_corrected_gap_rpc_raised_unexpected_shape',
            },
          );
        } else {
          if (code !== UNDEFINED_FUNCTION) throw err;
          const probe = await client.query(
            "SELECT to_regprocedure('public.get_tracking_corrected_gap_counts()') IS NULL AS missing",
            [],
          );
          if (probe.rows[0]?.missing !== true) throw err;
        }
      }

      let orderCreatedStuckRows: Array<Record<string, unknown>> = [];
      if (orderCreatedCutoffIso !== null && orderCreatedStuckMinutes !== null) {
        try {
          const res = await client.query(
            'SELECT public.get_order_created_stuck_count($1::timestamptz, $2::integer) AS result',
            [orderCreatedCutoffIso, orderCreatedStuckMinutes],
          );
          orderCreatedStuckRows = res.rows;
        } catch (err) {
          const code = (err as { code?: unknown } | null)?.code;
          if (code === RAISE_EXCEPTION) {
            const looksLikeOwnGate =
              typeof (err as { message?: unknown }).message === 'string' &&
              (err as { message: string }).message.includes('get_order_created_stuck_count:');
            console.error(
              looksLikeOwnGate
                ? '[anomaly-alert] 🔴 get_order_created_stuck_count 自己 RAISE 了(參數閘)⇒ 那一格本輪不查'
                : '[anomaly-alert] 🔴 get_order_created_stuck_count 拋了 P0001 而【訊息不像它自己的參數閘】',
              {
                code: RAISE_EXCEPTION,
                reason: looksLikeOwnGate
                  ? 'order_created_stuck_rpc_raised'
                  : 'order_created_stuck_rpc_raised_unexpected_shape',
              },
            );
          } else {
            if (code !== UNDEFINED_FUNCTION) throw err;
            const probe = await client.query(
              "SELECT to_regprocedure('public.get_order_created_stuck_count(timestamptz,integer)') IS NULL AS missing",
              [],
            );
            if (probe.rows[0]?.missing !== true) throw err;
          }
        }
      }

      /**
       * 🔵 **排程心跳(板 `⟦b4-SWEEPDEAD1⟧` 片3)** —— 降級處置逐字沿用上面訊號4 那一段:
       *   函式不存在(部署窗口)⇒ 落 `cronHeartbeatUnknown`;它自己 `RAISE`(參數閘)⇒ 一樣降級,
       *   **而其他告警照常送**。控制流不因為這一段而改變。
       * 🔴 **`jobsPayload` 直接 map 白名單全部, 這裡不篩不排除** ——
       *   片2 那支函式**證明不了我有沒有少送**, 所以這一行就是那個保護本身。
       */
      const jobsPayload = CRON_JOB_WHITELIST.map((w) => ({
        job_name: w.jobName,
        stale_minutes: w.staleMinutes,
        // 🔴 送出【明確的布林】而不是省略 —— 片2 那支函式對缺鍵會 RAISE,
        //    因為「缺鍵時預設 true」會與後台儀表板不一致(codex R1 F3)。
        failures_meaningful: !FAILURE_COUNT_MEANINGLESS.has(w.jobName),
      }));
      let heartbeatRows: Array<Record<string, unknown>> = [];
      try {
        const res = await client.query(
          'SELECT public.get_cron_heartbeat_stale_counts($1::jsonb) AS result',
          [JSON.stringify(jobsPayload)],
        );
        heartbeatRows = res.rows;
      } catch (err) {
        const code = (err as { code?: unknown } | null)?.code;
        if (code === RAISE_EXCEPTION) {
          const looksLikeOwnGate =
            typeof (err as { message?: unknown }).message === 'string' &&
            (err as { message: string }).message.includes('get_cron_heartbeat_stale_counts:');
          console.error(
            looksLikeOwnGate
              ? '[anomaly-alert] 🔴 get_cron_heartbeat_stale_counts 自己 RAISE 了(參數閘)⇒ 心跳那一段降級成【查不到】,而其他告警照常送'
              : '[anomaly-alert] 🔴 get_cron_heartbeat_stale_counts 拋了 P0001 而【訊息不像它自己的參數閘】⇒ 仍降級成【查不到】(不改控制流),但這一格值得有人去看',
            {
              code: RAISE_EXCEPTION,
              reason: looksLikeOwnGate ? 'cron_heartbeat_rpc_raised' : 'cron_heartbeat_rpc_raised_unexpected_shape',
            },
          );
        } else {
          if (code !== UNDEFINED_FUNCTION) throw err;
          const probe = await client.query(
            "SELECT to_regprocedure('public.get_cron_heartbeat_stale_counts(jsonb)') IS NULL AS missing",
            [],
          );
          if (probe.rows[0]?.missing !== true) throw err;
        }
      }

      /**
       * ⟦b9-RLSHARDEN⟧ 甲(片B):`service_role` 還帶不帶 `BYPASSRLS`。
       *
       * 🔴 **錯誤處理比心跳那支【簡單一格】, 而簡單的理由要寫出來**:
       *    本函式**零參數、零 `RAISE`** ⇒ 沒有「它自己的參數閘」那條分支要分辨
       *    ⇒ 只留 `42883`(函式不存在 ⇒ 部署窗口 ⇒ unknown), **其餘一律 throw**。
       * 🎯 **而「其餘一律 throw」是刻意的, 它就是 codex must-fix ④ 的落點**:
       *    真的讀不到 `pg_catalog.pg_roles` 時整支 SQL 會**報錯**, 不會回一個帶 0 的 JSON
       *    ⇒ 那個錯必須**往上冒**、由 route 記成【查不到】(log + 503),
       *    **不得在這裡被吞成 unknown** —— 吞了就與「函式還沒 apply」印同一個東西。
       */
      let bypassRlsRows: Array<Record<string, unknown>> = [];
      try {
        const res = await client.query(
          'SELECT public.get_privileged_role_bypassrls_state() AS result',
          [],
        );
        bypassRlsRows = res.rows;
      } catch (err) {
        const code = (err as { code?: unknown } | null)?.code;
        if (code === UNDEFINED_FUNCTION) {
          // 🔵 與心跳那支同款的二次確認:`42883` 也可能來自別的東西
          //    ⇒ 直接問 `to_regprocedure` 才算數, 不憑錯誤碼推。
          const probe = await client.query(
            "SELECT to_regprocedure('public.get_privileged_role_bypassrls_state()') IS NULL AS missing",
            [],
          );
          // 函式其實【在】⇒ 那個 42883 來自它內部 ⇒ 它真的壞了 ⇒ 上拋。
          if (probe.rows[0]?.missing !== true) throw err;
        } else {
          /**
           * 🔴🔴 **R3 consider 2 —— 而我當 must-fix 修, 因為它打的是【最壞的那一天】。**
           *
           * ⛔ ~~我第一版寫 `if (code !== UNDEFINED_FUNCTION) throw err;`~~ ⇒
           *   **任一非 42883 的錯誤會讓【整輪】告警 throw** ⇒ route catch ⇒ 503
           *   ⇒ ⇒ **那天的雙重扣款 / 退款卡住告警一封都不寄。**
           * 🎯 **而最現實的那個錯誤, 正好發生在這支探針最該說話的那一天**:
           *   有人做安全強化時順手 `REVOKE EXECUTE … FROM payment_confirmer` ⇒ **42501**
           *   ⇒ 📌 **一支用來偵測「權限被收緊」的探針, 會在權限被收緊那天把金流告警一起弄啞。**
           * 🛑 而它是**本片新增的一條路** —— 每加一支探針就多一條殺掉金流告警的路。
           * ✅ 這一發是**最後一發、後面沒有查詢** ⇒ 安全地 catch-all:落 Unknown(route 照樣 503),
           *   **而不把別人的告警拖下水**。
           * 🔵 log 分開印, 讓「函式沒 apply」與「我沒有權限叫它」在事後分得出來。
           */
          console.error(
            '[anomaly-alert] 🔴 get_privileged_role_bypassrls_state 讀失敗(非 42883)⇒ 權限那一格落【查不到】,而其他告警照常送',
            { code },
          );
        }
      }

        /**
         * ⟦b9-ACLDRIFT5⟧ 片二:讀 `public.pcm_acl_drift_status`(definer view)。
         * 🔴 **欄名在 SQL 裡是中文** ⇒ 這裡一律 `AS` 成英文別名 ——
         *    那條「SQL 產出的 key vs TS 讀取的 key」對帳閘比的是別名, 而中文欄名在
         *    序列化 / 大小寫折疊上多一個會出事的地方。**別名是契約, 不是美觀。**
         * 🔴 錯誤處理:**catch-all 落 Unknown 並 log** —— 與 bypassRls 那支同一個理由:
         *    這是最後一發查詢, 而**一支偵測權限的探針不該在權限被收緊那天,
         *    把金流告警一起殺掉**。view 還沒貼(42P01)也走這條。
         */
        let aclDriftRows: Array<Record<string, unknown>> = [];
        try {
          const res = await client.query(
            'SELECT "有漂移" AS drift, "最新這列已被批准" AS approved, "最新這列太舊" AS stale, ' +
              '"變了的族" AS families, "最新時刻" AS taken_at FROM public.pcm_acl_drift_status',
            [],
          );
          aclDriftRows = res.rows;
        } catch (err) {
          const code = (err as { code?: unknown } | null)?.code;
          console.error(
            '[anomaly-alert] 🔵 pcm_acl_drift_status 讀失敗 ⇒ 權限漂移那一格落【查不到】(不是「沒有漂移」)',
            { code },
          );
        }
        /**
         * ⟦b4-RETRYGAVEUPNOWATCHER⟧:被 settle-retry 放棄的匯款單。
         * 🔴 錯誤處理與上一支同款 **catch-all 落 Unknown 並 log** —— 這是最後一發查詢,
         *    而一支偵測「單修不好」的探針不該在函式沒 apply 的那幾天把金流告警一起殺掉。
         */
        let gaveUpRows: Array<Record<string, unknown>> = [];
        try {
          const res = await client.query(
            'SELECT public.get_settle_retry_gaveup_health() AS result',
            [],
          );
          gaveUpRows = res.rows;
        } catch (err) {
          const code = (err as { code?: unknown } | null)?.code;
          console.error(
            '[anomaly-alert] 🔵 get_settle_retry_gaveup_health 讀失敗 ⇒ 那一格落【查不到】(不是「零張」)',
            { code },
          );
        }

        /**
         * ⟦b4-PENDINGREFUNDSILENT⟧(2026-09-05, Sean 拍甲的下半:「小事故表 + **告警信多一列**」):
         * 被刻意吞掉的「開待退款失敗」留痕。
         * 🔴 錯誤處理與上兩支同款 **catch-all 落 Unknown 並 log** —— 這支 RPC 隨
         *    `20260905290000`(貼板 36)才會存在, 而在它貼進去之前這裡每天都會走 catch。
         *    ⇒ 📌 **一支還沒 apply 的探針不該把整封金流告警一起殺掉。**
         */
        let incidentRows: Array<Record<string, unknown>> = [];
        try {
          // 🔴🔴 **這一句【必須是字面字串】, 不可以用 `${INCIDENT_FN}` 樣板** ——
          //   codex 2026-09-05 must-fix ①:`anomaly-alert-key-contract.test.ts` 用正則從**這支檔**
          //   抽函式名, 再去比對 SQL 端與 TS 端的 key。樣板字面抽不到
          //   ⇒ 📌 **這一族的三個 key 會【完全沒有契約測試保護】, 而那支測試照樣全綠。**
          //   ⇒ 那正是「守門看不到你, 而它印綠」那一族。
          const res = await client.query(
            'SELECT public.get_pcm_incident_health() AS result',
            [],
          );
          incidentRows = res.rows;
        } catch (err) {
          const code = (err as { code?: unknown } | null)?.code;
          console.error(
            '[anomaly-alert] 🔵 get_pcm_incident_health 讀失敗 ⇒ 那一格落【查不到】(不是「沒有事故」)',
            { code },
          );
        }

      return parseAlertSummary(
        counts.rows, ids, refundRows, emailRows, shippedRows, orderCreatedRows,
        unpaidCancelledRows, orderCreatedStuckRows, heartbeatRows, bypassRlsRows,
        trackingCorrectedRows, aclDriftRows, gaveUpRows, incidentRows,
      );
    });
  }

  /**
   * ⟦b9-ENUMWATCH⟧ 片 2:客戶搜尋稽核計數。**回 `null` = 那支 RPC 還沒被 apply。**
   *
   * 🔴🔴 **這一段的核心只有一件事:`42883` 有【兩個意思】,而它們印同一個碼。**
   *
   * ```
   * 世界 A  函式在, 而它的函式體裡少了東西(有人 DROP 了它呼叫的 helper)
   * 世界 B  函式真的不存在(還沒 apply = 部署窗口)
   * ```
   * **2026-09-01 拋棄式 PG 17.10 實測(三行就造得出來, PG 不擋 —— 它不追蹤 函式→函式 相依)**:
   * ```
   * 世界 A  呼叫 ⇒ ERROR: 42883: function public.helper_x() does not exist
   *         to_regprocedure('public.outer_y()') IS NULL ⇒ **false**
   * 世界 B  呼叫 ⇒ ERROR: 42883: function public.zzq9_never() does not exist
   *         to_regprocedure(...) IS NULL ⇒ **true**
   * ```
   * 🔴 **兩個世界的 SQLSTATE 完全相同。而 `to_regprocedure` 那一發真的分得開。**
   * ⇒ **⇒ 所以那發二次探詢不是防禦深度 —— 它是【唯一】分得開這兩個世界的東西。**
   *
   * 🛑🛑 **而【錯誤訊息裡的名字,是最內層失敗的那個東西,不是你呼叫的那個】** ——
   *    世界 A 的訊息裡寫的是 `helper_x`,**不是我們那支函式的名字**。
   *    ⇒ 任何「訊息裡有沒有提到我們那支函式」的判斷,**在世界 A 會判成「不是我們的問題」而降級**
   *    ⇒ **而那正好是最糟的方向:一支壞掉的函式被讀成「今天沒有人搜尋客戶」,而它不會自己好。**
   *    📌 **⇒ 這一段寫下來是因為讀訊息比呼 `to_regprocedure` 直觀得多,而它會安靜地錯。**
   *
   * ⚠️ **本量測的射程**:macOS 的 PG 17.10、`LANGUAGE sql` 函式。
   *    Supabase 是 Linux、版本可能不同 ⇒ **SQLSTATE 是 SQL 標準碼、跨版本很穩,而我沒在正式庫驗過。**
   *    `plpgsql` 的解析時機不同 ⇒ **未驗**;而我們那支 RPC 正是 `LANGUAGE sql` ⇒ 對它成立。
   */
  async getManualCustomerSearchSummary(
    windowSeconds: number,
  ): Promise<{ readonly count: number; readonly actors: number; readonly windowSeconds: number } | null> {
    return this.run(async (client) => {
      try {
        const res = await client.query(
          'SELECT public.get_manual_customer_search_summary($1::integer) AS result',
          [windowSeconds],
        );
        const raw = res.rows[0]?.result;
        if (raw === null || typeof raw !== 'object') {
          // 🔴 回應形狀不符 ⇒ **throw, 不降級** —— 那不是部署窗口, 那是壞掉。
          throw new AnomalyAlertReaderParseError(`${RPC_MANUAL_SEARCH} 回應形狀不符`);
        }
        const bag = raw as Record<string, unknown>;
        /**
         * 🔴🔴 **2026-09-01 R2(換模型)must-fix F2 + nit F15:改用同檔既有的 `parseCount`。**
         *
         * ⛔ ~~我原本自己寫 `typeof` 檢查 + `throw new Error(...)`~~ —— **兩個問題**:
         *  ① **那個 `Error` 在出方法之前就被銷毀了**:`run()` 一律 `throw sanitizeError(err)`,
         *     而 `sanitizeError` **只放行 `AnomalyAlertReaderParseError`**,其餘重造成
         *     「anomaly 告警聚合讀失敗(transport)」
         *     ⇒ **RPC 回垃圾時,值班的人看到的字是「transport」⇒ 他去查網路。**
         *     📌 而那正是 `parseCount` 的 `fn` 參數當初被加進來要防的病:
         *        **紅在對的時候、指向錯的地方。**
         *  ② 我少掉了 repo 既有的「非負**整數**」契約 ⇒ `-1` / `1.5` 會通過我的檢查落進信裡。
         * ✅ `parseCount` 兩件都解:它丟 branded 錯(訊息活得下來)且驗非負整數。
         */
        /**
         * 🔴🔴 **先擋型別, 再交給 `parseCount` —— 而這一格是【我的測試抓到我的修法】。**
         *
         * `parseCount` 逐字 `typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN`
         * ⇒ 而 **`Number('') === 0`** ⇒ **空字串會通過它, 而回傳 0。**
         * 🛑 **⇒ 那正是 codex R1 F1 指的那個病(壞掉被讀成「今天沒有人搜尋」), 只是換一個入口。**
         * 📌 **⇒ 我為了拿 branded 錯(訊息活得過 `sanitizeError`)而改用 `parseCount`,
         *    而它把我剛修掉的洞帶了回來 —— 抓到它的是我自己那格 `it.each([null,'',false,undefined])`。**
         *
         * ⚠️ **而我【不改 `parseCount` 本身】** —— 它被同檔另外六支 RPC 共用,
         *    而「字串數字也收」對那幾支可能是刻意的。**動它 = 動一個我沒讀完的分母。**
         * ✅ ⇒ 在這一支的入口加一道 `typeof === 'number'`, 兩者的好處都拿到:
         *    嚴格型別 + branded 錯訊息。
         */
        const strictNumber = (v: unknown, field: string): number => {
          if (typeof v !== 'number') {
            throw new AnomalyAlertReaderParseError(`${RPC_MANUAL_SEARCH} 計數欄 ${field} 異常`);
          }
          return parseCount(v, field, RPC_MANUAL_SEARCH);
        };
        const count = strictNumber(bag.manual_customer_search_count, 'manual_customer_search_count');
        const actors = strictNumber(bag.manual_customer_search_actors, 'manual_customer_search_actors');
        /**
         * 🔴 **跨欄不變量**(R3 consider 4):`actors` 是相異操作者數,而每個操作者至少留一筆
         * ⇒ **`actors <= count` 恆成立**。而 `{count:0, actors:1}` 通得過逐欄檢查 ——
         * 📌 **⇒ 逐欄都合法而合起來不可能, 正是「壞掉的 RPC」最像正常的那一種形狀。**
         */
        if (actors > count) {
          throw new AnomalyAlertReaderParseError(
            `${RPC_MANUAL_SEARCH} 計數欄 manual_customer_search_actors 異常`,
          );
        }
        return {
          count,
          actors,
          // 🔴 回傳【我真的送出去的那個值】(R3 must-fix 2)⇒ 呼叫端無法配一個不同的窗口上去。
          windowSeconds,
        };
      } catch (err) {
        // 非 42883 ⇒ 原封上拋(連線 / 權限 42501 / 型別 … 都不是部署窗口)
        if ((err as { code?: unknown } | null)?.code !== UNDEFINED_FUNCTION) throw err;
        const probe = await client.query(
          "SELECT to_regprocedure('public.get_manual_customer_search_summary(integer)') IS NULL AS missing",
          [],
        );
        // 🔴 回得出 oid ⇒ 那個 42883 來自【函式內部】(世界 A)⇒ **原封上拋**
        if (probe.rows[0]?.missing !== true) throw err;
        // 只有真的不存在(世界 B)才降級
        return null;
      }
    });
  }

  /**
   * 搜尋日誌健康度 —— 形狀與 `getManualCustomerSearchSummary` 同一個模子:
   * 42883 要再 probe 一次才降級(函式【內部】丟的 42883 原封上拋)。
   *
   * 🔴 **三個欄位【原封回傳, 不在這裡判斷】** —— 要不要告警是 route 的事。
   *    理由:`anonCanExecute` 的 `null`(還沒貼)與 `false`(門被關了)在這裡若被
   *    合併成 boolean, **route 就再也分不出來了**, 而那兩個世界的下一步相反。
   */
  /**
   * ⟦b4-NEEDSHUMANNOWATCHER⟧ 卡住的匯款單(`overpaid` / `needs_human` 那兩種)。
   *
   * 🔴 **`42883` 的兩個世界照 `getPaymentAnomalyAlertDisplayIds` 那格處理**(codex R2 must-fix 的成例):
   *    函式**存在**而它的**函式體**裡少了某個 helper/operator, PG 回的是**同一個碼**。
   *    ⇒ 照碼降級 = 一支壞掉的函式會被安靜地讀成「今天沒有卡住的單」, 而它不會自己好。
   *    ⇒ ✅ 再問一次「它到底在不在」:`to_regprocedure` 回 NULL 才是真的沒貼 ⇒ 才回 `null`;
   *      回得出 oid ⇒ 那個 42883 來自**函式內部** ⇒ **原封上拋**。
   * 🔵 那一發 probe 只在錯誤路徑跑, 正常情況零成本。
   */
  /**
   * ⟦supply-SYNCTIMEOUTPARTIAL⟧ 同步卡住的讀數。形狀照本檔既有 RPC 的成例。
   *
   * 🛑 **RPC 不存在 ⇒ 回 `null`, 不是 throw** —— 那是「碼先上、DB 後貼」的安全帶:
   *    照本檔既有那兩支的走法, 用 `to_regprocedure`(**帶簽章**)確認它真的不在才吞。
   *    🔴 **不可以改用 `to_regproc`** —— 它對【多載】的名字回 NULL,
   *      ⇒ 那會讓「有兩支多載」與「一支都沒有」印同一個東西
   *      (2026-09-06 實測:`to_regproc('public.create_order')` 回 NULL 而它有 2 支)。
   */
  async getSupplierSyncStaleCounts(): Promise<{
    readonly staleOpen: number;
    readonly staleSuppliers: readonly string[];
    readonly openRecent: number;
    readonly failedLatest: number;
    readonly suppliersSeen: number;
    readonly staleHours: number;
  } | null> {
    return this.run(async (client) => {
      let raw: unknown;
      try {
        const res = await client.query(
          `SELECT public.${RPC_SYNC_STALE}() AS result`,
          [],
        );
        raw = res.rows[0]?.result;
      } catch (err) {
        if ((err as { code?: unknown } | null)?.code !== UNDEFINED_FUNCTION) throw err;
        const probe = await client.query(
          `SELECT to_regprocedure('public.${RPC_SYNC_STALE}(integer)') IS NULL AS missing`,
          [],
        );
        if (probe.rows[0]?.missing !== true) throw err;
        return null;
      }

      if (raw === null || typeof raw !== 'object') {
        throw new AnomalyAlertReaderParseError(`${RPC_SYNC_STALE} 回應形狀不符`);
      }
      const bag = raw as Record<string, unknown>;

      // 🔴 `stale_suppliers` 要逐個驗型別 —— 一個 `[1,2]` 會安靜地變成信裡的 "1, 2"
      const rawList = bag.stale_suppliers;
      if (!Array.isArray(rawList)) {
        throw new AnomalyAlertReaderParseError(`${RPC_SYNC_STALE} stale_suppliers 不是陣列`);
      }
      const staleSuppliers = rawList.map((x, i) => {
        if (typeof x !== 'string') {
          throw new AnomalyAlertReaderParseError(
            `${RPC_SYNC_STALE} stale_suppliers[${i}] 不是字串(實得 ${typeof x})`,
          );
        }
        return x;
      });

      const staleOpen = parseCount(bag.stale_open, 'stale_open', RPC_SYNC_STALE);
      // 🔴🔴 **兩個數要一致才敢用** —— `stale_open` 與那份名單是同一個 SQL 的兩個投影,
      //    而它們**在 DB 那邊是分開算的**(兩個子查詢)。不一致 ⇒ 有一邊的條件被改過
      //    ⇒ 📌 這時候寧可 throw, 也不要挑一個數字寄出去。
      if (staleSuppliers.length !== staleOpen) {
        throw new AnomalyAlertReaderParseError(
          `${RPC_SYNC_STALE} stale_open=${staleOpen} 而名單長度=${staleSuppliers.length} ⇒ 兩個投影對不上, 拒用`,
        );
      }

      return {
        staleOpen,
        staleSuppliers,
        openRecent: parseCount(bag.open_recent, 'open_recent', RPC_SYNC_STALE),
        failedLatest: parseCount(bag.failed_latest, 'failed_latest', RPC_SYNC_STALE),
        suppliersSeen: parseCount(bag.suppliers_seen, 'suppliers_seen', RPC_SYNC_STALE),
        staleHours: parseCount(bag.stale_hours, 'stale_hours', RPC_SYNC_STALE),
      };
    });
  }

  async getStuckBankOrdersHealth(): Promise<{
    readonly stuckCount: number;
    readonly oldestCreated: string | null;
    readonly overpaidCount: number;
    readonly overpaidOldest: string | null;
  } | null> {
    return this.run(async (client) => {
      let raw: unknown;
      try {
        const res = await client.query(
          'SELECT public.get_stuck_bank_orders_health() AS result',
          [],
        );
        raw = res.rows[0]?.result;
      } catch (err) {
        if ((err as { code?: unknown } | null)?.code !== UNDEFINED_FUNCTION) throw err;
        const probe = await client.query(
          "SELECT to_regprocedure('public.get_stuck_bank_orders_health()') IS NULL AS missing",
          [],
        );
        if (probe.rows[0]?.missing !== true) throw err;
        // 🔵 真的沒貼 ⇒ 回 null ⇒ 呼叫端走 *Unknown, 與其他訊號同款。
        return null;
      }

      // 🔴 以下每一格都 **fail-loud** —— 形狀不符就丟, 不要默默給一個看起來合理的數字。
      if (raw === null || typeof raw !== 'object') {
        throw new AnomalyAlertReaderParseError(`${RPC_STUCK_BANK_HEALTH} 回應形狀不符`);
      }
      const bag = raw as Record<string, unknown>;
      // 🔴🔴 **`measured` 要驗**(codex R2 must-fix ③)。
      //    SQL 那側**特別回這一鍵**, 就是為了防「沒量到卻被當成零張」——
      //    而我原本**完全不讀它** ⇒ 缺鍵 / `false` / `null` 都會被當成「量到了」。
      //    ⇒ 🎯 **⇒ 我加了一道守門, 而沒有接它。今晚同型第三次**
      //      (前兩次:`stuckBankUnknown` route 沒消費 · `stuckBankFailed` 補了沒接)。
      //      📌 **⇒ 「加了一個訊號」與「有人在讀它」是兩個宣稱, 而我一直只做前者。**
      if (bag.measured !== true) {
        throw new AnomalyAlertReaderParseError(
          `${RPC_STUCK_BANK_HEALTH} measured 不是 true(實得 ${String(bag.measured)})⇒ 那支 RPC 沒有真的量到`,
        );
      }
      /**
       * 🔵 **兩個世界共用同一組檢查** —— 抽成具名函式而不是複製第二份。
       *    🔬 理由是量出來的形狀:本 repo 記過「一格叫突變的測試若把判準重打一份,
       *      改生產碼它不會紅」⇒ 同一個道理反過來 —— **複製一份檢查, 兩份會各自漂**,
       *      而漂掉的那一半在 diff 上與「本來就這樣」長得一樣。
       * 🔴 世界 A = 仍 unpaid(`stuck_*`)· 世界 B = 已付款而多收(`overpaid_*`)。
       */
      const readPair = (countKey: string, oldestKey: string): { count: number; oldest: string | null } => {
        const c = bag[countKey];
        if (typeof c !== 'number' || !Number.isInteger(c) || c < 0) {
          throw new AnomalyAlertReaderParseError(`${RPC_STUCK_BANK_HEALTH} ${countKey} 異常`);
        }
        const o = bag[oldestKey] ?? null;
        if (o !== null && typeof o !== 'string') {
          throw new AnomalyAlertReaderParseError(`${RPC_STUCK_BANK_HEALTH} ${oldestKey} 異常`);
        }
        if (o !== null && Number.isNaN(new Date(o).getTime())) {
          throw new AnomalyAlertReaderParseError(`${RPC_STUCK_BANK_HEALTH} ${oldestKey} 不是合法時刻`);
        }
        // 🔴 **兩者要一致** —— count>0 而沒有最早時刻, 或 count=0 而有時刻, 都表示那支 RPC 壞了。
        //    ⇒ 📌 一份自己前後矛盾的資料, 比一份缺資料危險:它讀起來是完整的。
        if ((c > 0) !== (o !== null)) {
          throw new AnomalyAlertReaderParseError(
            `${RPC_STUCK_BANK_HEALTH} ${countKey} 與 ${oldestKey} 不一致(count=${c}, oldest=${String(o)})`,
          );
        }
        return { count: c, oldest: o };
      };
      const a = readPair('stuck_count', 'oldest_created');
      const b = readPair('overpaid_count', 'overpaid_oldest');
      return {
        stuckCount: a.count,
        oldestCreated: a.oldest,
        overpaidCount: b.count,
        overpaidOldest: b.oldest,
      };
    });
  }

  async getSearchLogHealth(): Promise<{
    readonly tableExists: boolean;
    readonly lastRowAt: string | null;
    readonly anonCanExecute: boolean | null;
  } | null> {
    return this.run(async (client) => {
      try {
        const res = await client.query(
          'SELECT public.get_search_log_health() AS result',
          [],
        );
        const raw = res.rows[0]?.result;
        if (raw === null || typeof raw !== 'object') {
          throw new AnomalyAlertReaderParseError(`${RPC_SEARCH_LOG_HEALTH} 回應形狀不符`);
        }
        const bag = raw as Record<string, unknown>;
        if (typeof bag.table_exists !== 'boolean') {
          throw new AnomalyAlertReaderParseError(`${RPC_SEARCH_LOG_HEALTH} table_exists 異常`);
        }
        const last = bag.last_row_at;
        if (last !== null && typeof last !== 'string') {
          throw new AnomalyAlertReaderParseError(`${RPC_SEARCH_LOG_HEALTH} last_row_at 異常`);
        }
        // 🔴🔴 **codex must-fix:只驗「是字串」不夠**(2026-09-04)——
        //    非法日期 ⇒ 上層 `new Date(x).getTime()` 是 `NaN` ⇒ `NaN > 86400000` 是 false
        //    ⇒ **stale 恆 false** ⇒ 📌 **一個壞掉的回應被讀成「健康」。**
        //    ⇒ 這裡 fail-loud:壞回應要走 `Unknown`(有人看), 不是靜靜地過。
        if (last !== null && Number.isNaN(new Date(last).getTime())) {
          throw new AnomalyAlertReaderParseError(
            `${RPC_SEARCH_LOG_HEALTH} last_row_at 不是合法時刻`,
          );
        }
        const anon = bag.anon_can_execute;
        if (anon !== null && typeof anon !== 'boolean') {
          throw new AnomalyAlertReaderParseError(`${RPC_SEARCH_LOG_HEALTH} anon_can_execute 異常`);
        }
        return {
          tableExists: bag.table_exists,
          lastRowAt: last ?? null,
          anonCanExecute: anon ?? null,
        };
      } catch (err) {
        if ((err as { code?: unknown } | null)?.code !== UNDEFINED_FUNCTION) throw err;
        const probe = await client.query(
          "SELECT to_regprocedure('public.get_search_log_health()') IS NULL AS missing",
          [],
        );
        if (probe.rows[0]?.missing !== true) throw err;
        return null;
      }
    });
  }

  /** per-request 連線生命週期(connect → op → finally end;end throw 吞掉不蓋主錯誤)。 */
  private async run<T>(op: (client: PgClientLike) => Promise<T>): Promise<T> {
    let client: PgClientLike | undefined;
    try {
      client = this.clientFactory(this.connectionString);
      await client.connect();
      return await op(client);
    } catch (err) {
      throw sanitizeError(err);
    } finally {
      if (client) {
        try {
          await client.end();
        } catch {
          /* swallow:連線已斷時 end 可能 throw、不蓋過主錯誤 */
        }
      }
    }
  }
}

/** F-004 那支 RPC 的名字(錯誤訊息要指對地方 —— 見 `parseCount` 的 `fn`)。 */
/**
 * 🔴 餵給寄信計數 RPC 的兩個秒數。**它們不是同一種東西,不要合併成一個常數。**
 * · lease:**有真值**,對齊 `sweep-email-outbox.ts` 的 `MIN_LEASE_SECONDS`(3600)
 * · grace:🔴 **沒有真值** —— sweeper 那側不存在這個參數(codex R2)。
 *   3600 是一個**未決的營運參數**,不是量出來的。要改它要有人先決定它該是多少。
 *
 * 🔴 **codex 2026-08-29 抓到兩件,兩件都寫進來**:
 * ① **明確傳 3600 ⇒ SQL 端那個 clamp 下限 300 【永遠不會贏】** ——
 *    那個 clamp 只在「呼叫端傳了更小的值」時有意義,而這裡沒有。
 *    ⇒ **不要把「SQL 端有 clamp」讀成一道對這條路生效的保護,它對這條路是死的。**
 * ② **grace 目前【等於】lease,而 plan 要的是 grace 大於 lease** ——
 *    🔴 這是一個**已知的偏離**,不是巧合:我沒有一個能決定 grace 的來源,
 *    而 3600 是抄 lease 抄來的。**它會不會誤報,取決於 sweeper 一輪的實際耗時,而我沒有量過。**
 *    ⇒ 這一格**明文留給下一個人**:要嘛量出 sweeper 單輪耗時上界、要嘛請 Sean 定一個。
 * 🔴 ③ 而檔內原本寫「兩邊同時往下漂才會出事」—— **也是假的**(codex nit):
 *    sweeper 的 lease **單獨升到 7200** 而這裡還是 3600 ⇒ 就會把**合法執行中**的工作報成卡死。
 *    ⇒ **單邊漂就夠。** 原句給了一種不存在的安全感。
 */
const EMAIL_STALE_SENDING_SECONDS = 3600;
const EMAIL_SIGNAL1_GRACE_SECONDS = 3600;

const REFUNDS_FN = 'get_order_refunds_stuck_summary';
const EMAIL_FN = 'get_email_outbox_deadman_counts';
const SHIPPED_FN = 'get_shipped_email_gap_counts';
const ORDER_CREATED_FN = 'get_order_created_gap_counts';
const UNPAID_CANCELLED_FN = 'get_order_unpaid_cancelled_gap_counts';
const TRACKING_CORRECTED_FN = 'get_tracking_corrected_gap_counts';
// 🔵 `get_pcm_incident_health` **刻意不做成常數** —— 呼叫那一句必須是字面字串,
//    否則 `anomaly-alert-key-contract.test.ts` 的正則抽不到函式名(codex must-fix ①)。
//    ⇒ 📌 一個為了 DRY 而抽出來的常數, 會讓一道守門看不見這一族。
/** PG `raise_exception` —— plpgsql 的 `RAISE EXCEPTION` 預設就是這個 SQLSTATE。 */
const RAISE_EXCEPTION = 'P0001';

/**
 * 非負整數解析(count 欄;非有限/負 → throw fail-closed)。
 *
 * 🔴 `fn` 必須帶,而它是 F-004 當場修的一個**指錯地方的錯誤訊息**:
 *    原本函式名寫死成 `get_payment_anomaly_alert_summary`,而退款那支 RPC 的欄位壞掉時
 *    訊息會說「**get_payment_anomaly_alert_summary** 計數欄 order_refunds_stuck_count 異常」
 *    ⇒ **值班的人會去查一支根本沒問題的函式。**
 *    📌 那不是假綠,是**紅在對的時候、指向錯的地方** —— 一樣會浪費掉那個晚上。
 */
function parseCount(v: unknown, field: string, fn = 'get_payment_anomaly_alert_summary'): number {
  // 🔴🔴 **空白字串要在轉型【之前】擋掉** —— ⟦b4-PARSECOUNTEMPTYZERO⟧(codex 2026-09-03 MF6)。
  //    🛑 `Number('') === 0`,而 `0` 通過下面那三關(finite / >= 0 / integer)⇒ **回一個健康的 0**。
  //      ⇒ 📌 **一個壞掉的回應被吞成「今天沒有異常」** —— 而那正是這支 adapter 在防的事。
  //    🔵 `null` / `undefined` / 物件**本來就 throw**(`typeof` 兩個分支都不中 ⇒ NaN)
  //      ⇒ **空白字串是唯一一種會被吞掉的形狀**,所以這一行只擋它、不動別的路徑。
  //    ⚠️ **而不是只擋 `''`**:`Number('   ') === 0`、`Number('\n') === 0` 也一樣
  //      ⇒ 判準是**去掉頭尾空白之後還剩不剩東西**,不是「等不等於空字串」。
  //    ✅ 而**帶空白的數字仍然放行**(`Number(' 5 ') === 5`)—— 我們擋的是「什麼都沒有」,
  //      不是「前後有空白」。(那一格有測試釘住。)
  if (typeof v === 'string' && v.trim() === '') {
    throw new AnomalyAlertReaderParseError(`${fn} 計數欄 ${field} 異常`);
  }
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new AnomalyAlertReaderParseError(`${fn} 計數欄 ${field} 異常`);
  }
  return n;
}

/**
 * 單號陣列解析(2026-08-19 片)。
 *
 * 🔴 **缺鍵 → 回 `[]`,不 throw** —— 刻意的,理由是**部署順序**:
 *    程式先上、migration 後 apply 的那個窗口裡,舊版 RPC 回不出這五個鍵。
 *    此時 throw ⇒ 整支告警 503 ⇒ **雙扣告警在那段時間完全停掉**,
 *    比「訊息裡少了單號」嚴重得多 ⇒ 缺鍵 = 降級回舊行為(只講筆數)。
 * 🔴 **而【有鍵但形狀錯】仍然 throw** —— 那不是部署窗口,那是 RPC 壞了。
 *    兩者在 `undefined` 與「非字串陣列」上分得開,**不要合併成一個 catch-all**。
 */
function parseDisplayIds(v: unknown, field: string): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    // 🔴 訊息要指向**真正出問題的那支** —— 單號來自 `…_display_ids`,寫成 summary 會讓
    //    接手的人去查錯的函式(關卡2 nit)。
    throw new AnomalyAlertReaderParseError(`get_payment_anomaly_alert_display_ids 單號欄 ${field} 異常`);
  }
  return v as string[];
}

/** 配對陣列解析(`[[單號A, 單號B], …]`);缺鍵/形狀規則同 `parseDisplayIds`。 */
function parseDisplayIdPairs(v: unknown, field: string): Array<[string, string]> {
  if (v === undefined || v === null) return [];
  if (
    !Array.isArray(v) ||
    v.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((x) => typeof x !== 'string'))
  ) {
    throw new AnomalyAlertReaderParseError(`get_payment_anomaly_alert_display_ids 配對欄 ${field} 異常`);
  }
  return v as Array<[string, string]>;
}

/**
 * 解析告警聚合 jsonb → domain camelCase;形狀不符 → throw(通用、fail-closed)。
 *
 * 🔴 **計數與單號來自【兩支不同的函式、兩次查詢】** ⇒ 兩次之間資料可能變動
 *    ⇒ `count` 與陣列長度**可以不一致,而那是預期不是故障**。
 *    ⇒ 這裡**不做兩者一致性的斷言** —— 那會把一個正常的競態變成半夜的 503。
 *      對得起不起來的檢查放在 **migration 的 apply 期斷言**(那一刻是靜態的、有判別力)。
 */
const HEARTBEAT_FN = 'get_cron_heartbeat_stale_counts';

/**
 * 從五個【不互斥】的原因陣列收集出「哪幾支不正常」, **去重**。
 * 🔴 `stale` / `failing` 的元素是物件(帶 `job_name`), 另外三個是裸字串 —— 兩種形狀都要吃。
 * 🛑 **這裡【不】重算數量** —— 數量只認 `abnormal_count`(見上面那段)。
 *    ⇒ 名單長度與 `abnormal_count` **可以不同**, 而那不是 bug:
 *      一支 job 同時 stale + failing 會在名單裡出現一次, 在計數裡也是一次;
 *      而若哪天真的對不上, 要查的是 SQL 那一側, 不是這裡。
 */
function collectHeartbeatJobNames(hb: Record<string, unknown>): readonly string[] {
  const out = new Set<string>();
  for (const key of ['never_beat', 'no_success_ts', 'stale', 'future', 'failing']) {
    const arr = hb[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (typeof item === 'string') out.add(item);
      else if (item !== null && typeof item === 'object' && typeof (item as { job_name?: unknown }).job_name === 'string') {
        out.add((item as { job_name: string }).job_name);
      }
    }
  }
  return [...out].sort();
}

function parseAlertSummary(
  rows: Array<Record<string, unknown>>,
  idRows: Array<Record<string, unknown>>,
  refundRows: Array<Record<string, unknown>>,
  emailRows: Array<Record<string, unknown>>,
  shippedRows: Array<Record<string, unknown>>,
  orderCreatedRows: Array<Record<string, unknown>>,
  unpaidCancelledRows: Array<Record<string, unknown>>,
  orderCreatedStuckRows: Array<Record<string, unknown>>,
  heartbeatRows: Array<Record<string, unknown>>,
  bypassRlsRows: Array<Record<string, unknown>>,
  // 🔵 第四條線(⟦b4-NORECIPIENTWINDOW⟧, 2026-09-04)。**排在最後, 不插進中間** ——
  //   這是一串**位置參數**, 插中間會讓所有既有呼叫端安靜地錯位一格
  //   (型別全是同一個 `Array<Record<string, unknown>>` ⇒ 🔴 **typecheck 不會紅**)。
  trackingCorrectedRows: Array<Record<string, unknown>>,
  // 🔵 ⟦b9-ACLDRIFT5⟧ 片二(2026-09-05)。**同樣排在最後** —— 理由見上面那段:
  //   位置參數插中間會安靜錯位, 而型別全一樣 ⇒ typecheck 不會紅。
  aclDriftRows: Array<Record<string, unknown>>,
  // 🔵 ⟦b4-RETRYGAVEUPNOWATCHER⟧(2026-09-05)。**同樣排在最後**(理由見上面)。
  gaveUpRows: Array<Record<string, unknown>>,
  // 🔵 ⟦b4-PENDINGREFUNDSILENT⟧(2026-09-05)。**同樣排在最後** —— 這是一串位置參數,
  //   插中間會讓所有既有呼叫端安靜地錯位一格, 而型別全一樣 ⇒ 🔴 typecheck 不會紅。
  incidentRows: Array<Record<string, unknown>>,
): AnomalyAlertSummary {
  const r = rows[0]?.result as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') {
    throw new AnomalyAlertReaderParseError('get_payment_anomaly_alert_summary 回應格式異常');
  }
  // 🔴 `idRows` 為空 = 上面那支函式還不存在(部署窗口)⇒ 五個欄位各自降級成 `[]`。
  const d = (idRows[0]?.result ?? {}) as Record<string, unknown>;
  // oldest_open_age_seconds:無 open → null(合法);有值 → 非負整數。
  const rawOldest = r.oldest_open_age_seconds;
  let oldestOpenAgeSeconds: number | null;
  if (rawOldest === null || rawOldest === undefined) {
    oldestOpenAgeSeconds = null;
  } else {
    const n = typeof rawOldest === 'number' ? rawOldest : Number(rawOldest);
    if (!Number.isFinite(n) || n < 0) {
      throw new AnomalyAlertReaderParseError('get_payment_anomaly_alert_summary oldest_open_age_seconds 異常');
    }
    oldestOpenAgeSeconds = Math.floor(n);
  }
  /**
   * F-004:`refundRows` 為空 = 那支 RPC 還不存在(部署窗口)⇒ unknown、兩個計數 `null`。
   * 🔴 **有回應但缺鍵、或型別不對 ⇒ 走 `parseCount` 的 fail-closed 上拋**,不當成 unknown ——
   *    「函式不在」與「函式回了垃圾」是兩件事,後者必須吵(codex R1 N9)。
   */
  /**
   * 🔴🔴 **`undefined` 與 `null` 是兩個世界,而我第一版把它們合成一個**(code-reviewer 抓的)。
   * ```
   * refundRows = []          ⇒ rf === undefined ⇒ 我們【根本沒拿到那一列】= 函式不存在(部署窗口)
   * { result: null }         ⇒ rf === null      ⇒ 函式【存在而且跑了】, 只是回了 SQL NULL
   * ```
   * 合成一個的後果:函式明明 apply 了、只是回 NULL ⇒ route 會印「**尚未 apply**」
   * ⇒ 🔴 **值班的人跑去查 migration 有沒有 apply, 而它 apply 了** —— 紅在對的時候、指向錯的地方,
   *    正是同檔 `parseCount` 的 `fn` 參數在防的那件事。
   * ⇒ `null` 走 fail-closed 上拋:「函式不在」與「函式回了垃圾」是兩件事,而 NULL 屬後者。
   */
  const rf = refundRows[0]?.result as Record<string, unknown> | null | undefined;
  const orderRefundsStuckUnknown = rf === undefined;
  if (!orderRefundsStuckUnknown && (rf === null || typeof rf !== 'object')) {
    throw new AnomalyAlertReaderParseError(`${REFUNDS_FN} 回應格式異常(函式存在但回了 NULL 或非物件)`);
  }

  /**
   * 🔴 **M-4a 寄信計數:形狀【逐字沿用】上面 F-004 那一組,包括那個 `undefined` vs `null` 的分別。**
   * ```
   * emailRows = []   ⇒ em === undefined ⇒ 根本沒拿到那一列 = 函式不存在（部署窗口）
   * { result: null } ⇒ em === null      ⇒ 函式【存在而且跑了】，只是回了 SQL NULL ⇒ 必須吵
   * ```
   * ⚠️ **那個分別不是我想到的** —— 是 F-004 那組被 code-reviewer 抓過一次才有的,
   * 而合成一個的後果逐字寫在上面:**紅在對的時候、指向錯的地方。**
   */
  const em = emailRows[0]?.result as Record<string, unknown> | null | undefined;
  const emailOutboxUnknown = em === undefined;
  if (!emailOutboxUnknown && (em === null || typeof em !== 'object')) {
    throw new AnomalyAlertReaderParseError(`${EMAIL_FN} 回應格式異常(函式存在但回了 NULL 或非物件)`);
  }
  const emailCount = (key: string): number | null =>
    emailOutboxUnknown ? null : parseCount(em![key], key, EMAIL_FN);

  const sp = shippedRows[0]?.result as Record<string, unknown> | undefined;
  const shippedGapUnknown = sp === undefined;
  if (!shippedGapUnknown && (sp === null || typeof sp !== 'object')) {
    throw new AnomalyAlertReaderParseError(`${SHIPPED_FN} 回應格式異常(函式存在但回了 NULL 或非物件)`);
  }
  const shippedCount = (key: string): number | null =>
    shippedGapUnknown ? null : parseCount(sp![key], key, SHIPPED_FN);

  /**
   * 🔵 排程心跳(片3)。與 `oc` 同族的三態:
   *   `heartbeatRows = []`  ⇒ hb === undefined ⇒ **函式不存在**(部署窗口)⇒ unknown
   *   `{ result: null }`    ⇒ hb === null      ⇒ 函式跑了而回了 SQL NULL ⇒ **那是壞掉, 要吵**
   *   正常物件              ⇒ 解析
   * 🛑 `abnormal_count` 是**唯一**能拿來數的欄位 —— 各原因陣列**不互斥**(片2 檔頭寫明),
   *    相加會重複計數。這裡只讀它, 名單另外從各陣列聯集起來【去重】。
   */
  const hb = heartbeatRows[0]?.result as Record<string, unknown> | undefined;
  const cronHeartbeatUnknown = hb === undefined;
  if (!cronHeartbeatUnknown && (hb === null || typeof hb !== 'object')) {
    throw new AnomalyAlertReaderParseError('get_cron_heartbeat_stale_counts 回應格式異常');
  }
  const cronHeartbeat = cronHeartbeatUnknown
    ? { cronHeartbeatAbnormalCount: null, cronHeartbeatAbnormalJobs: null, cronHeartbeatUnknown: true }
    : {
        cronHeartbeatAbnormalCount: parseCount(hb!.abnormal_count, 'abnormal_count', HEARTBEAT_FN),
        cronHeartbeatAbnormalJobs: collectHeartbeatJobNames(hb!),
        cronHeartbeatUnknown: false,
      };

  /**
   * ⟦b9-RLSHARDEN⟧ 甲(片B):`service_role` 還帶不帶 `BYPASSRLS`。
   *
   * 🔴 **三態,而它們的【下一步不同】** ——
   *   `rows = []`     ⇒ undefined ⇒ 函式不存在(部署窗口)⇒ `bypassRlsUnknown`
   *   `result` 非物件 ⇒ 函式跑了而回了怪東西 ⇒ **那是壞掉, throw**
   *   正常物件        ⇒ 讀 `service_role_bypassrls`
   *
   * 🛑 **而那一欄自己也是三態, 不要壓成 boolean**:
   *   `true`  ⇒ 屬性還在(今天的正常態)
   *   `false` ⇒ **被收掉了 ⇒ 這就是要叫的那一格**
   *   `null`  ⇒ `service_role` 這個角色不存在 ⇒ **【查不到】不是【沒事】**
   * 📌 ⇒ 所以 `bypassRlsRevoked` 只在**明確拿到 `false`** 時才是 `true`;
   *    拿到 `null` 走 `bypassRlsUnknown`, **不得 `?? false` 混進正常態**。
   */
  const br = bypassRlsRows[0]?.result as Record<string, unknown> | undefined;
  const brMissing = br === undefined;
  // 🔴 **`Array.isArray` 那一格是 codex R2 must-fix**:`typeof [] === 'object'` 且 `[] !== null`
  //    ⇒ 一個回 `[]` 的 RPC **通得過上面兩個條件** ⇒ 不 throw ⇒ 靜靜降級成 Unknown
  //    ⇒ 而 route 會把它印成「函式未 apply 或 service_role 不存在」—— **那是錯的成因**。
  // 📌 **⇒ 一個【壞掉的回應】被記成【還沒部署】, 而兩者的下一步完全不同。**
  if (!brMissing && (br === null || typeof br !== 'object' || Array.isArray(br))) {
    throw new AnomalyAlertReaderParseError('get_privileged_role_bypassrls_state 回應格式異常');
  }
  /**
   * 🔴 **codex 2026-09-02 must-fix ②:型別要驗, 否則 fail-open。**
   * 我第一版直接拿 `br!.service_role_bypassrls` 去比 `=== false` ——
   * ⇒ RPC 若回**字串** `"false"`(而 `total_role_count` 正常)⇒
   *   `Revoked = false` · `Unknown = false` ⇒ **被當成健康, 靜靜通過**。
   * 📌 **⇒ 一個「不是我預期的型別」的值, 在 `=== false` 底下與「屬性還在」印同一個答案。**
   * ✅ 只認 `boolean` 與 `null`;其餘一律當**量不到**(fail-closed)。
   */
  const brRaw = brMissing ? undefined : br!.service_role_bypassrls;
  const brWellTyped = typeof brRaw === 'boolean' || brRaw === null;
  const brValue = brWellTyped ? (brRaw as boolean | null) : undefined;
  /**
   * 🔴 **另外兩欄要【真的讀】, 不能只放在 SQL 裡**(`anomaly-alert-key-contract.test.ts` 逼出來的):
   *    那道對帳閘比對「SQL 產出的 key」vs「TS 讀取的 key」—— 而我第一版只讀了一欄
   *    ⇒ 另外兩欄是**回了而沒有人看**的東西。
   * 🎯 **而它們在這裡有一個真的工作**:`total_role_count` 是**合理性下界** ——
   *    一個健康的 PostgreSQL 至少存在【當下這個執行角色】⇒ 它必須是正整數。
   *    不是正整數 ⇒ 這次讀到的東西**不可信** ⇒ 走 `Unknown`(fail-closed), 不當成「屬性還在」。
   * 🛑 而它**不是** codex 打掉的那句 —— 那句是「`total_role_count = 0` 代表尺沒接上」,
   *    而真的讀不到 `pg_roles` 是**報錯**不是回 0。這裡守的是【回了一個怪值】那條路。
   */
  const brTotal = brMissing ? undefined : br!.total_role_count;
  const brPrivileged = brMissing ? undefined : br!.privileged_role_count;
  const brTotalSane = typeof brTotal === 'number' && Number.isInteger(brTotal) && brTotal > 0;
  const bypassRls = {
    // 🔴 只認 boolean `false`,**而且要在總數合理的前提下**。
    //    `null`(角色不存在)與 `undefined`(函式不存在)都不是「被收掉」。
    // 🔴🔴 **R3 must-fix 3:`brTotalSane` 不得掛在這一半。**
    //    ⛔ ~~我第一版寫 `brValue === false && brTotalSane`~~ ——
    //    ⇒ 一個 `{"service_role_bypassrls": false, "total_role_count": "35"}`(字串,
    //      或哪天有人把那個 count 改成 `::text` / 走另一條序列化)
    //      ⇒ `brTotalSane = false` ⇒ **Revoked 被降級成 Unknown ⇒ 只有 503, 信不寄**
    // 🎯 **⇒ 我把一道合理性檢查掛在【壓掉警報】的方向, 而 `false` 是本片唯一承重的訊號。**
    // ✅ 拿到明確的 `false` 就叫。合理性下界只留在 `Unknown` 那一半(它守的是「別把沒量到當成沒事」)。
    bypassRlsRevoked: brValue === false,
    // 🔵 三種都算【查不到】,成因不同 —— route 的 log 會把它們分開印。
    bypassRlsUnknown:
      brMissing || !brWellTyped || brValue === null || brValue === undefined || !brTotalSane,
    // 🔵 診斷用:讓 503 那條 log 印得出「我到底讀到什麼」,而不是只說「讀不到」。
    bypassRlsPrivilegedCount: typeof brPrivileged === 'number' ? brPrivileged : null,
    bypassRlsTotalRoleCount: typeof brTotal === 'number' ? brTotal : null,
  };
    /**
     * ⟦b9-ACLDRIFT5⟧ 片二:權限快照漂移。與 bypassRls 那塊【同一個形狀】:
     * 只認 boolean;其餘一律當「量不到」(fail-closed)。
     *
     * 🔴 **`已批准` 讓 Detected 回 false, 而那【不是消音】** ——
     *    批准是一個人簽下「那是我貼板造成的」(理由必填)。
     *    少了這一格, 貼板當天之後會每天寄一封一模一樣的信 ⇒ **那種信會被整批忽略,
     *    而下一封真的也一起。**
     * 🔴 **`太舊` 走 Unknown 不走 Detected**:快照太舊 ⇒ 我手上這兩列不足以比較
     *    ⇒ 那是「量不到」不是「沒有漂移」, 更不是「有漂移」。
     * 🛑 而它答不出「有沒有人偷改」—— 改掉又改回來, 兩次快照相同 ⇒ 它不會叫。
     */
    const ad = aclDriftRows[0];
    const adDrift = ad?.drift;
    const adApproved = ad?.approved;
    const adStale = ad?.stale;
    const adWellTyped =
      ad !== undefined && typeof adDrift === 'boolean' && typeof adApproved === 'boolean';
    const aclDrift = {
      // 只在【明確 true、明確沒被批准、而且那一列不算太舊】時才叫。
      aclDriftDetected: adWellTyped && adDrift === true && adApproved === false && adStale !== true,
      // 🔵 三種都算查不到:view 沒貼 / 讀失敗 / 回了怪型別;外加「太舊」。
      aclDriftUnknown: !adWellTyped || adStale === true,
      aclDriftFamilies: typeof ad?.families === 'string' ? (ad.families as string) : null,
      aclDriftTakenAt:
        ad?.taken_at instanceof Date
          ? (ad.taken_at as Date).toISOString()
          : typeof ad?.taken_at === 'string'
            ? (ad.taken_at as string)
            : null,
    };

    /**
     * ⟦b4-RETRYGAVEUPNOWATCHER⟧:與上面同一個形狀 —— 只認數字, 其餘一律當量不到。
     * 🔴 `count` 用 `null` 不用 `0`:**0 是「查得到而且沒有」, null 是「我沒量到」**,
     *    而 shouldAlert 那道閘只看 `> 0` ⇒ 兩者在那裡的行為相同, 而在 log 與信裡不同。
     */
    const gu = gaveUpRows[0]?.result as Record<string, unknown> | undefined;
    const guCount = gu?.gave_up_count;
    /**
     * 🔴 `tracked_total` 要【真的讀】, 不能只放在 SQL 裡(對帳閘逼出來的:
     *    它比對「SQL 產出的 key」vs「TS 讀取的 key」, 而我第一版只讀了一個
     *    ⇒ 另外三個是「回了而沒有人看」的東西)。
     * 🎯 **而它在這裡有一個真的工作**:`gave_up_count` 不可能大於 `tracked_total`
     *    (放棄的是被追蹤的一部分)⇒ 大於 ⇒ 這次讀到的東西**不可信** ⇒ 走 Unknown,
     *    而不是把一個荒謬的數字寫進信裡。
     */
    const guTotal = gu?.tracked_total;
    const guSane =
      typeof guTotal === 'number' && Number.isInteger(guTotal) && guTotal >= 0
      && typeof guCount === 'number' && guCount <= guTotal;
    const guWellTyped =
      gu !== undefined && typeof guCount === 'number' && Number.isInteger(guCount) && guSane;
    const gaveUp = {
      settleRetryGaveUpCount: guWellTyped ? (guCount as number) : null,
      settleRetryGaveUpUnknown: !guWellTyped,
      settleRetryGaveUpOldest:
        typeof gu?.oldest_gave_up === 'string' ? (gu.oldest_gave_up as string) : null,
      // 🔵 診斷用:讓 503 那條 log 印得出「我到底讀到什麼」, 而不是只說「讀不到」。
      settleRetryGaveUpTracked: typeof guTotal === 'number' ? guTotal : null,
      settleRetryGaveUpSampleIds: Array.isArray(gu?.sample_order_ids)
        ? (gu!.sample_order_ids as unknown[]).filter((x): x is string => typeof x === 'string')
        : [],
    };

    /**
     * ⟦b4-PENDINGREFUNDSILENT⟧:被吞掉的「開待退款失敗」留痕計數。
     *
     * 🔴🔴 **缺 key 走 fail-loud(`unknown = true`), 不走「沒有就當 0」** ——
     *   主視窗 `-f8` 2026-09-05 指名這一格。理由是這一族的病本身:
     *   📌 **這片存在的理由就是「失敗與成功印同一個東西」**;
     *      若這裡把「讀不到 key」降級成 0, 就是**在告警端把同一個病再犯一次** ——
     *      而這次它會長成一句「今天沒有事故」。
     *   ⇒ `open_total` 不是非負整數 ⇒ `unknown`, **不是 0**。
     *
     * 🔵 `count` 用 `null` 不用 `0`:0 是「查得到而且沒有」, null 是「我沒量到」。
     *    `shouldAlert` 只看 `> 0` ⇒ 兩者在那道閘的行為相同, 而在 log 與信裡不同。
     *
     * ⚠️ **射程**:這一格只答「事故表上有幾列沒被處理」。它答不出
     *    ①那些失敗各自是什麼(`detail` 刻意不回 —— 它是 SQLERRM, 會被印進信裡)
     *    ②**回滾掉的那些**(incident 那一列與被吞的例外在同一個交易裡, 外層整個回滾時
     *      那一列會跟著消失 ⇒ ⟦b4-NCPCANCELROLLBACK⟧ 那條路本格【零覆蓋】)。
     */
    /**
     * 🔴🔴 **kind 白名單 —— 而它是【偵測】用的, 不是【過濾】用的。**
     *   主視窗 `-f8` 2026-09-05 要求「TS 那半的 kind 白名單也要跟」。
     *   ⇒ 而我**刻意不拿它去丟掉不認識的 kind**:
     *     📌 **丟掉 = 一件真的事故從信裡消失, 而 `open_total` 仍然算它** ——
     *        那會變成「總數說有 3 件, 而種類欄只列得出 2 件」, 讀信的人分不出少的那件是什麼。
     *     🛑 **這一片存在的理由就是「有事發生而沒有人知道」** ⇒ 過濾等於在告警端再犯一次。
     *   ✅ 所以白名單的用途是:**認不得的 kind ⇒ 照樣進信, 而多印一行 `console.error`**
     *     —— 那一行是「SQL 端加了值而 TS 沒跟上」唯一分得出來的訊號。
     *   🔵 兩個值的出處:`pending_refund_open_failed`(20260905290000)·
     *     `refund_over_total`(20260905420000, 給線【帳務】片③ 的超退)。
     *   ⚠️ 這份清單與 DB 的 CHECK **是兩份** —— 它們對不上時沒有東西會自動叫。
     *   🛑🛑 **而那行 `console.error` 不是一個可靠的漂移告警, 這句要寫出來**(codex 2026-09-05 nit):
     *     ① **沒有任何證據顯示有人在監看它** —— 我沒有量到那條路上有人。
     *     ② 🔴 **新 kind 若還沒有任何 open 列, 它根本不會出現在 `open_by_kind`**
     *        ⇒ 📌 **清單漂移了而那行永遠不會印** —— 它只在「已經有事故發生」之後才叫。
     *     ⇒ 所以它是**事後的線索**, 不是**事前的守門**。真正的守門要有人做一支
     *       「SQL 的 CHECK vs 這份清單」的對帳測試, 而那不在本片射程。已請主視窗開列。
     */
    const KNOWN_INCIDENT_KINDS = new Set(['pending_refund_open_failed', 'refund_over_total']);

    const inc = incidentRows[0]?.result as Record<string, unknown> | undefined;
    const incTotal = inc?.open_total;
    /**
     * 🔴 codex must-fix ③:只驗 `open_total` 的型別**不夠** ——
     *   `{open_total: 0, open_by_kind: {pending_refund_open_failed: 3}}` 會通過,
     *   ⇒ 📌 **一個內部矛盾的回應被讀成「今天沒有事故」而不寄信、route 回 200。**
     *   ⇒ 照隔壁 `guSane` 那一格的做法:**兩個數對不上 ⇒ 走 Unknown**, 不寫一個荒謬的數字進信。
     * 🔵 判準用 `>=` 不用 `=`:`open_by_kind` 是逐 kind 的細目, 而 CHECK 只有一種 kind 時
     *   兩者相等;未來多一種 kind 而 SQL 端先上線時, 總數仍應 >= 細目和。
     */
    const incKindRaw = inc?.open_by_kind;
    const incKindObj =
      incKindRaw !== null && typeof incKindRaw === 'object' && !Array.isArray(incKindRaw)
        ? (incKindRaw as Record<string, unknown>)
        : undefined;
    const incKindSum =
      incKindObj === undefined
        ? 0
        : Object.values(incKindObj).reduce<number>(
            (a, v) => a + (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0),
            0,
          );
    const incWellTyped =
      inc !== undefined
      && typeof incTotal === 'number'
      && Number.isInteger(incTotal)
      && incTotal >= 0
      // 🔴 codex must-fix ④:`Array.isArray` —— 陣列也通過 `typeof === 'object'`,
      //    `[3]` 會變成 `{"0": 3}` ⇒ 信裡出現一個假的種類 `0=3`。
      && (incKindRaw === undefined || incKindRaw === null || incKindObj !== undefined)
      && incTotal >= incKindSum;
    if (inc !== undefined && !incWellTyped) {
      console.error(
        '[anomaly-alert] 🔴 get_pcm_incident_health 回了東西而 open_total 不是非負整數 ⇒ 落【查不到】',
        { got: typeof incTotal },
      );
    }
    if (incKindObj !== undefined) {
      const unknown = Object.keys(incKindObj).filter((k) => !KNOWN_INCIDENT_KINDS.has(k));
      if (unknown.length > 0) {
        console.error(
          '[anomaly-alert] 🔴 pcm_incident 回了 TS 不認識的 kind ⇒ SQL 端的 CHECK 加了值而這份清單沒跟上'
          + '(那幾件【照樣進信】—— 丟掉才會讓真事故消失)',
          { unknown },
        );
      }
    }

    const incident = {
      pcmIncidentOpenTotal: incWellTyped ? (incTotal as number) : null,
      pcmIncidentUnknown: !incWellTyped,
      pcmIncidentOldest:
        typeof inc?.oldest_open_at === 'string' ? (inc.oldest_open_at as string) : null,
      /**
       * 🔵 逐 kind 的計數:信裡要列得出「是哪一種事故」。
       * 🔴 只收 `{[string]: 非負整數}` 那個形狀, 其餘一律丟掉 —— 這一欄會被印進信裡。
       */
      pcmIncidentByKind:
        incKindObj === undefined
          ? {}
          : Object.fromEntries(
              Object.entries(incKindObj)
                .filter(
                  (e): e is [string, number] =>
                    typeof e[1] === 'number' && Number.isInteger(e[1]) && e[1] >= 0,
                )
                /**
                 * 🔵 codex 2026-09-05 nit:kind 的**原字串**會進 log 與信。
                 *   今天它受 DB 的 CHECK 控制 ⇒ 不可能有換行或超長,
                 *   而 📌 **「今天受控」與「永遠受控」是兩件事** —— 而信的排版壞掉時,
                 *   壞的是**一封在講錢的信**。⇒ 這裡把 key 收成一個安全形狀。
                 * 🛑 **只切形狀, 不丟東西** —— 認不得的 kind 照樣進信(見上面白名單那段)。
                 */
                .map(([k, n]): [string, number] => [
                  k.replace(/[\r\n\t]/g, ' ').slice(0, 64),
                  n,
                ]),
            ),
    };
  /**
   * 🔴🔴 **三道回應層對帳(codex 2026-08-31 片3 R1 #3/#4)** —— 全部 fail-loud,
   *   因為這一族的失敗形狀是**靜默地看起來健康**, 而那是本片要治的病本身。
   */
  if (!cronHeartbeatUnknown) {
    // ① `checked` 必須等於我送出去的支數 —— 這是片2 那個具名缺口在【回應側】的鏡像:
    //    片2 證明不了「呼叫端餵的是完整六支」, 而這裡至少證明得了「它跑的支數與白名單一樣多」。
    const checked = parseCount(hb!.checked, 'checked', HEARTBEAT_FN);
    if (checked !== CRON_JOB_WHITELIST.length) {
      throw new AnomalyAlertReaderParseError(
        `${HEARTBEAT_FN} 檢查了 ${checked} 支, 而白名單有 ${CRON_JOB_WHITELIST.length} 支 —— 少查的那幾支會靜靜地看起來健康`,
      );
    }
    const n = cronHeartbeat.cronHeartbeatAbnormalCount!;
    const names = cronHeartbeat.cronHeartbeatAbnormalJobs!;
    // ② 不正常的支數不可能超過檢查的支數。
    if (n > checked) {
      throw new AnomalyAlertReaderParseError(`${HEARTBEAT_FN} abnormal_count(${n})> checked(${checked})`);
    }
    // ③ 🔴 **數字與名單必須【逐一相等】。**
    //    ⛔ ~~我第一版只擋「有數字而零名字」, 註解寫「同一支可能因多個理由入列而只算一次,
    //       兩邊本來就不必相等」~~ —— **codex R2 打掉了那句, 而它是對的**:
    //       片2 那支 SQL 的 `flagged` 是**每支 job 一列**, `abnormal_count` 數的是【列】
    //       ⇒ 它就等於五個陣列去重之後的支數。**兩邊本來就該相等。**
    //    📌 ⇒ 我那句「不必相等」把一個**可以精確對帳**的地方寫成了模糊地帶,
    //       而 `count=2 / 名字=1` 會通過並寄出一份**少一支的名單**。
    if (n !== names.length) {
      throw new AnomalyAlertReaderParseError(
        `${HEARTBEAT_FN} 說有 ${n} 支不正常, 而五個原因陣列去重後有 ${names.length} 支(${names.join(',')})` +
          ' ⇒ 兩邊該相等;信裡會寄出一份對不上的名單',
      );
    }
  }
  const oc = orderCreatedRows[0]?.result as Record<string, unknown> | undefined;
  const orderCreatedGapUnknown = oc === undefined;
  if (!orderCreatedGapUnknown && (oc === null || typeof oc !== 'object')) {
    throw new AnomalyAlertReaderParseError(`${ORDER_CREATED_FN} 回應格式異常(函式存在但回了 NULL 或非物件)`);
  }
  const orderCreatedCount = (key: string): number | null =>
    orderCreatedGapUnknown ? null : parseCount(oc![key], key, ORDER_CREATED_FN);

  // 🔵 未付款取消信線的同一組。`undefined` = **沒查**(cutoff 沒設 / 函式尚未 apply)
  //   🔴 ⇒ 三格回 `null`, **不是 0** ——「讀不到」與「一切正常」在裸數字上長得一模一樣。
  const ucg = unpaidCancelledRows[0]?.result as Record<string, unknown> | undefined;
  const unpaidCancelledGapUnknown = ucg === undefined;
  if (!unpaidCancelledGapUnknown && (ucg === null || typeof ucg !== 'object')) {
    throw new AnomalyAlertReaderParseError(
      `${UNPAID_CANCELLED_FN} 回應格式異常(函式存在但回了 NULL 或非物件)`,
    );
  }
  const unpaidCancelledCount = (key: string): number | null =>
    unpaidCancelledGapUnknown ? null : parseCount(ucg![key], key, UNPAID_CANCELLED_FN);

  // 🔵 更正單號信線的同一組。`undefined` = **沒查**(函式尚未 apply)
  //   🔴 ⇒ 三格回 `null`, **不是 0** ——「讀不到」與「一切正常」在裸數字上長得一模一樣。
  const tcg = trackingCorrectedRows[0]?.result as Record<string, unknown> | undefined;
  const trackingCorrectedGapUnknown = tcg === undefined;
  if (!trackingCorrectedGapUnknown && (tcg === null || typeof tcg !== 'object')) {
    throw new AnomalyAlertReaderParseError(
      `${TRACKING_CORRECTED_FN} 回應格式異常(函式存在但回了 NULL 或非物件)`,
    );
  }
  const trackingCorrectedCount = (key: string): number | null =>
    trackingCorrectedGapUnknown ? null : parseCount(tcg![key], key, TRACKING_CORRECTED_FN);

  const ocs = orderCreatedStuckRows[0]?.result as Record<string, unknown> | undefined;
  // 🔴 `undefined` = **沒查**(兩顆 env 任一沒設 / 函式尚未 apply)⇒ 兩格都回 null, **不是 0**。
  const orderCreatedStuckUnknown = ocs === undefined;
  if (!orderCreatedStuckUnknown && (ocs === null || typeof ocs !== 'object')) {
    throw new AnomalyAlertReaderParseError(
      'get_order_created_stuck_count 回應格式異常(函式存在但回了 NULL 或非物件)',
    );
  }
  const stuckNum = (key: string): number | null => {
    if (orderCreatedStuckUnknown) return null;
    const raw = ocs![key];
    // 🛑 `oldest_stuck_minutes` 在【沒有卡住】時是 SQL NULL —— 那不是「讀不到」是「沒有」
    //   ⇒ 兩者都回 null, 而上游靠 stuckCount 分辨(0 = 沒有卡住 · null = 沒查)。
    if (raw === null) return null;
    return parseCount(raw, key, 'get_order_created_stuck_count');
  };

  return {
    emailOverdueCount: emailCount('signal1_overdue_count'),
    emailDeadLetterCount: emailCount('signal2_dead_letter_count'),
    emailStuckSendingCount: emailCount('signal3_stuck_sending_count'),
    emailQuotaConfirmedCount: emailCount('signal5_quota_confirmed_count'),
    emailQuotaSuspectedCount: emailCount('signal5_quota_suspected_count'),
    // 🔴 **分母**(2026-08-31;`⟦b4-EMAILTOTAL⟧`):SQL 那一側早就在回它
    //   (`20260829010000…sql` 的 `'total_count'`), 而**本層之前把它丟掉了**。
    //   ⇒ 沒有它, 上面五個 0 在「一切正常」與「這張表是空的」之間分不出來。
    emailOutboxTotalCount: emailCount('total_count'),
    emailOutboxUnknown,
    // 🔵 出貨缺口那三格(2026-08-31)。空陣列 = 沒呼叫(起始線沒設)或函式不存在 ⇒ unknown。
    //   🔴 **不寫成 0** —— 「讀不到」與「一切正常」在一個裸數字上長得一模一樣。
    shippedNeverEnqueuedCount: shippedCount('shipped_never_enqueued_count'),
    shippedUnsendableCount: shippedCount('shipped_unsendable_count'),
    shipmentsTotalCount: shippedCount('shipments_total_count'),
    shippedGapUnknown,
    // 🔵 訊號 4 那三格(2026-08-31)。空陣列 = 沒呼叫(起始線沒設/不合法)或函式尚未 apply ⇒ unknown。
    //   🔴 **不寫成 0** —— 而這一格今天【一定會走到】:那支 RPC 還沒 apply。
    orderCreatedPaidNoEmailCount: orderCreatedCount('paid_no_email_count'),
    orderCreatedNoRecipientCount: orderCreatedCount('no_recipient_count'),
    orderCreatedGapUnknown,
    // 🔵 未付款取消信線那三格(⟦b4-NORECIPIENTWINDOW⟧, 2026-09-03)。
    //   🔴 **不寫成 0** —— 而這一格今天【一定會走到】:那支 RPC 還沒 apply 到正式庫。
    unpaidCancelledPendingCount: unpaidCancelledCount('pending_count'),
    unpaidCancelledNoRecipientCount: unpaidCancelledCount('no_recipient_count'),
    unpaidCancelledGapUnknown,
    // 🔵 更正單號信線那三格(⟦b4-NORECIPIENTWINDOW⟧ 第四條線, 2026-09-04)。
    //   🔴 **不寫成 0** —— 而這一格今天【一定會走到】:那支 RPC 還沒 apply 到正式庫。
    trackingCorrectedPendingCount: trackingCorrectedCount('pending_count'),
    trackingCorrectedNoRecipientCount: trackingCorrectedCount('no_recipient_count'),
    trackingCorrectedGapUnknown,
    // 🔵 訊號4 持續失敗那兩格。null = 沒查(兩顆 env 任一沒設)或函式尚未 apply
    //   🔴 **不寫成 0** ——「還沒上膛」與「今天沒有卡住的單」在一個裸數字上長得一模一樣。
    orderCreatedStuckCount: stuckNum('stuck_count'),
    orderCreatedStuckOldestMinutes: stuckNum('oldest_stuck_minutes'),
    // 🔴 **它必須出得去** —— 沒有這一格, adapter 的 fail-closed 在下游就被 `?? 0` 拆掉了。
    orderCreatedStuckUnknown,
    ...cronHeartbeat,
    ...bypassRls,
      // ⟦b9-ACLDRIFT5⟧ 片二(2026-09-05)
      ...aclDrift,
      // ⟦b4-RETRYGAVEUPNOWATCHER⟧(2026-09-05)
      ...gaveUp,
      ...incident,
    openCount: parseCount(r.open_count, 'open_count'),
    refundingCount: parseCount(r.refunding_count, 'refunding_count'),
    refundingStuckCount: parseCount(r.refunding_stuck_count, 'refunding_stuck_count'),
    orderRefundsStuckCount: orderRefundsStuckUnknown
      ? null
      : parseCount(rf!.order_refunds_stuck_count, 'order_refunds_stuck_count', REFUNDS_FN),
    orderRefundsStuckOvernightCount: orderRefundsStuckUnknown
      ? null
      : parseCount(
          rf!.order_refunds_stuck_overnight_count,
          'order_refunds_stuck_overnight_count',
          REFUNDS_FN,
        ),
    orderRefundsManualFailedCount: orderRefundsStuckUnknown
      ? null
      : parseCount(rf!.order_refunds_manual_failed_count, 'order_refunds_manual_failed_count', REFUNDS_FN),
    orderRefundsStuckUnknown,
    oldestOpenAgeSeconds,
    attemptManualReviewCount: parseCount(r.attempt_manual_review_count, 'attempt_manual_review_count'),
    releasedStuckCount: parseCount(r.released_stuck_count, 'released_stuck_count'),
    pendingDoubleChargeCandidateCount: parseCount(
      r.pending_double_charge_candidate_count,
      'pending_double_charge_candidate_count',
    ),
    openDisplayIds: parseDisplayIds(d.open_display_ids, 'open_display_ids'),
    refundingStuckDisplayIds: parseDisplayIds(
      d.refunding_stuck_display_ids,
      'refunding_stuck_display_ids',
    ),
    attemptManualReviewDisplayIds: parseDisplayIds(
      d.attempt_manual_review_display_ids,
      'attempt_manual_review_display_ids',
    ),
    releasedStuckDisplayIds: parseDisplayIds(
      d.released_stuck_display_ids,
      'released_stuck_display_ids',
    ),
    pendingDoubleChargeDisplayIdPairs: parseDisplayIdPairs(
      d.pending_double_charge_display_id_pairs,
      'pending_double_charge_display_id_pairs',
    ),
  };
}

/** pg 錯誤淨化:本層 parse 錯誤原樣放行(已通用);其餘只回通用訊息 + 安全 SQLSTATE code。 */
function sanitizeError(err: unknown): AnomalyAlertReaderError {
  if (err instanceof AnomalyAlertReaderParseError) {
    return err; // 本層 throw(已通用、無 pg 原文/token)
  }
  const code = (err as { code?: unknown } | null)?.code;
  const e: AnomalyAlertReaderError = new Error(
    `anomaly 告警聚合讀失敗(${typeof code === 'string' ? code : 'transport'})`,
  );
  if (typeof code === 'string') {
    e.code = code;
  }
  return e;
}
