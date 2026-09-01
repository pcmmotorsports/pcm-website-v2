import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * `#641` ④ 的機制版:**OR 串 CHECK 的 NULL 短路面守門**。
 *
 * 🔴 為什麼需要一道守門而不是一句規則:2026-08-21 對正式庫實測 52 發
 * (拋棄式 PG,CHECK 逐字取自 `pg_get_constraintdef()`、欄位旗標逐字取自 `pg_attribute`)——
 * 那一批 OR 串 CHECK **今天全部擋得住,活的洞 0 個**;
 * 🔴 **而其中絕大多數的「擋得住」完全由欄位的 `NOT NULL` 撐著,不是由 CHECK 本身撐著。**
 * 量法是同一條 CHECK 建兩張表:`real`(正式庫的 NOT NULL 旗標)與 `weak`(欄位全改可 NULL)。
 * 同一發壞形狀進 `real` 被 23514 擋下、進 `weak` **直接寫進去** ⇒ 擋住它的是柱子,不是門。
 *
 * ⇒ 有人日後跑 `ALTER TABLE … ALTER COLUMN … DROP NOT NULL`,那些 CHECK 會**當場失效**,
 *   而 `pg_constraint` 不變、三綠不紅、`\d` 看起來一模一樣 —— **零機械訊號**。本檔就是那個訊號。
 *
 * 🔴 而它不是假想:D 窗 2026-08-21 上午釘的那份「12 支」清單,**當天下午就已經過期** ——
 * `20260820040000` 的 `payment_charge_attempts_capture_read_pair_chk` 是同一個形狀的第 13 支
 * (`capture_state` NOT NULL 撐著,而它在 TapPay 請款那條路上),D 的清單裡沒有它。
 * ⇒ **人工釘的清單會靜靜地少算一個**,所以第二條斷言用「掃描 vs 白名單」而不是一個數字。
 *
 * ⚠️ **本檔攔不住什麼**(先寫清楚,免得被當成比它實際更強的防線):
 * - **不經 migration 的改動**:Supabase dashboard 手動 `ALTER`、SQL Editor 直下 —— 檔案裡看不到。
 *   (而那條路在本 repo 是**常態**:Sean 會在 SQL Editor 貼 migration。)
 * - **NOT NULL 從沒被宣告過的欄位**:本檔只抓「把它拆掉」,抓不到「它本來就沒有」。
 * - 本檔是**文字層**比對,不連 DB。要真的 read-back 正式庫的 `attnotnull`,得換層。
 *
 * 🔴🔴 **要換到 DB 層的人先讀這一段(不然你會掃出一張假的清白帳單)**
 * 這條線與真登入線 2026-08-21 **各自獨立撞了同一個坑**,而 memory 主索引早就記過它
 * (逐字:「`has_*_privilege` 對欄級授權少報」)—— 記過而擋不住,所以寫在這裡:
 * ```
 *                                       完全不能寫   只能寫某一欄
 * has_table_privilege(…, 'UPDATE')         false       false   ← 兩個世界同值 ⇒ 這把尺是瞎的
 * has_column_privilege(…, col, 'UPDATE')   false       true    ← 分得出來
 * ```
 * 真登入線第一發就撞上:`admin_user_staff_map` 表級三個寫入權全 false,**差一點報成 must-fix**;
 * 補上 column 那把才看見 `attacl = {service_role=w/postgres}` —— 那是刻意的最小權限,不是洞。
 * ⇒ **UPDATE 一律用 `has_column_privilege`,而且逐欄比對程式實際寫哪幾欄。**
 * ⇒ RPC 那一半別漏:`has_function_privilege(role, oid, 'EXECUTE')` + `prosecdef`。
 *
 * 🔴 **要【突變測試】本檔的人:突變檔丟 scratchpad,不要丟 `supabase/migrations/`。**
 * 2026-08-21 我就是丟進那個目錄的。事後 `git status -- supabase/migrations/` 回零行,
 * 而**那只證明「事後沒留下」,不證明「過程中沒被看到」** —— 那幾秒鐘裡任何一個窗跑
 * `git status` 都會看到一支不是它的 `DELETE_ME` 檔,而當天真的有窗看到並回報。
 * ⇒ 正確做法:把掃描目錄做成可注入的參數,對著 scratchpad 的複本突變。
 * (母題:memory `feedback_shared-names-across-windows` —— 多窗共用一台機器,任何名字都是共用變數。)
 *
 * ── 📌 給【下一支守門】的一段(不是本檔的事,放這裡是因為那支還沒出生)──────────
 * 下一支要做的是 **GRANT read-back**:問「正式庫裡活著的授權,repo 記不記得它為什麼活著」。
 * (來源:2026-08-21 正式站登入無限迴圈,根因是一句只存在於正式庫、repo 一個字都沒記的 GRANT。)
 * 🔴 **它的分母要兩個一起用,因為兩者的盲點方向【相反】:**
 * ```
 * grep 原始碼         看得到寫在檔案裡的路徑(含從沒被跑過的)
 *                     🔴 看不到動態組出來的欄名
 * pg_stat_statements  看得到真的跑過的一切(含動態的)
 *                     🔴 看不到還沒被跑過的路徑 —— 而「還沒跑過」正好是
 *                        「拿 repo 重建環境後第一次跑」那個時刻的定義
 *                     🔴 也看不到被 reset / 被額度擠掉的
 *                        (2026-08-21 實查 4907 筆,那是【目前留著的】不是歷史全部)
 * ⇒ 單用任何一個都會產生一張假的清白帳單,而兩張的假法不一樣
 * ⇒ 聯集當工作清單,差集當最可疑的那一格
 * ```
 * ⚠️ 而 `pg_stat_statements.userid` 是**執行者**不是**授權面**:「沒跑過」同時相容於
 * 「沒權」與「這條路還沒被走到」⇒ **那一格只有 `has_column_privilege` 答得出來。**
 * ⇒ `pg_stat_statements` 是幫它把分母補上動態那半,**不是取代它**。
 */

/**
 * 掃描目錄。**預設是 repo 的 `supabase/migrations/`,而它可被 env 覆寫。**
 *
 * 🔴 覆寫這格存在的唯一理由是【突變測試】:要證明本檔會紅,得餵它一支壞的 migration,
 * 而把那支壞檔丟進 `supabase/migrations/` = 丟進**九窗共用的目錄**。
 * 2026-08-21 我第一版就是那樣做的 —— 事後 `git status` 回零行,
 * **而那只證明「事後沒留下」,不證明「過程中沒被看到」**(當天真的有窗看到並回報)。
 * ⇒ 用法:`NULL_SHORTCIRCUIT_GUARD_MIGRATIONS_DIR=<scratchpad 的複本> npx vitest run <本檔>`
 */
const MIGRATIONS_DIR = process.env.NULL_SHORTCIRCUIT_GUARD_MIGRATIONS_DIR
  ? new URL(`file://${process.env.NULL_SHORTCIRCUIT_GUARD_MIGRATIONS_DIR.replace(/\/?$/, '/')}`)
  : new URL('../supabase/migrations/', import.meta.url);

/**
 * 承重欄位:2026-08-21 實測「這一欄一旦可為 NULL,對應那條 CHECK 當場放行壞形狀」的 (表, 欄)。
 * 🔴 這不是「所有 NOT NULL 欄位」的清單,是**量到過的承重牆**清單 ——
 *    每一列都對應一發 weak 表 INSERT 成功的實測,不是看 schema 推的。
 */
const LOAD_BEARING_NOT_NULL: readonly (readonly [string, string])[] = [
  ['product_image_trim', 'status'],
  ['payment_charge_attempts', 'status'],
  ['payment_charge_attempts', 'capture_state'],
  ['orders', 'payment_channel'],
  ['order_notes', 'note_type'],
  ['customer_addresses', 'invoice_type'],
  ['customer_addresses', 'invoice_title'],
  ['customer_addresses', 'invoice_tax_id'],
  ['customer_addresses', 'invoice_donate_code'],
  ['shipments', 'carrier_code'],
  ['shipments', 'hct_status'],
  ['order_refunds', 'status'],
  ['customer_wallet_ledger', 'entry_type'],
  // 🔴 2026-08-29 線A `-e9` 實測加入(拋棄式 PG 17.10,real/weak 兩張表、CHECK 一字未改):
  //    `coupons_percent_range` = `discount_type <> 'percent' OR discount_value BETWEEN 1 AND 100`
  //    real(NOT NULL 在):`percent,101` 擋住 · `NULL,999` 擋住 · 正對照 `percent,100` / `fixed,5000` 進得去
  //    weak(只拿掉兩個 NOT NULL):`percent,101` **仍然擋住** ⇒ 值域那半是 CHECK 自己在守;
  //      🔴 而 `(NULL, 999)` 與 `('percent', NULL)` **兩發都進去了** ⇒ **兩欄都在承重**。
  ['coupons', 'discount_type'],
  ['coupons', 'discount_value'],
] as const;

/**
 * 已被【逐支實測過】的 OR 串 CHECK。掃到白名單以外的 ⇒ 紅,而不是「不認得就放過」。
 * 新增一列的門檻:**跑過壞形狀那一發**,不是讀過覺得沒問題。
 * 方法見 `~/pcm-mailbox/H2-12支CHECK逐支業務意圖核查-20260821.md`。
 */
/**
 * 🔴 **兩份清單,因為它們的證據等級不同 —— 併成一份會讓 18 支未驗的借到 10 支的可信度。**
 * (母題:memory `feedback_format-overrides-content` —— 並列的表在說「這些是同一級」。)
 */

/**
 * 一 · **已逐支實測過**:2026-08-21 拋棄式 PG,同一條 CHECK 建 real/weak 兩張表,
 * 真的塞一發業務壞形狀進去看誰擋。清單見 `~/pcm-mailbox/H2-12支CHECK逐支業務意圖核查-20260821.md`。
 * 結論:**全部擋得住,而幾乎全部靠 NOT NULL 撐著。**
 */
const PROBED_OR_CHECKS: readonly string[] = [
  // 🔴 2026-08-29 線A `-e9` 補測(方法同 08-21:同一條 CHECK 建 real/weak 兩張表,真的塞一發進去看誰擋)。
  //    ⚠️ **本條的值域那半 `-1c` 已在券片1 驗過(percent=101 紅 / 100 綠 / 1 綠)**,
  //       而那份證據住在已收攤的拋棄式 PG + 它的 scratchpad ⇒ **我複跑不了** ⇒ 我自己重跑了一發。
  //    🔴 而它驗的是【值域】,本守門問的是【NULL 短路】—— **那不是同一個問題**(`-1c` 自己指出的)。
  //       NULL 那一側的實測結果寫在 `LOAD_BEARING_NOT_NULL` 那兩列旁邊。
  // 🔴 2026-08-30 線【權限與登入】`-15` 實測補進(板 :395 的新表)。
  //    形狀:(outcome='success' AND reason_code IS NULL) OR (outcome='failure' AND reason_code IS NOT NULL)
  //    🔴 **NULL 短路面為什麼是關的**:`outcome` 是 `text NOT NULL CHECK (outcome IN ('success','failure'))`
  //       ⇒ 它永遠不是 NULL、且只有兩個值 ⇒ **兩個分支都不可能求值成 NULL**
  //       ⇒ 沒有「CHECK 求值成 NULL 就放行」那條路。
  //       ⚠️ **承重的是那個 `NOT NULL`** —— 哪天有人把它拿掉,這條 CHECK 會對 NULL outcome 靜靜放行。
  //    ✅ **實跑(不是推的)**:拋棄式 PG 17.10,同一張表兩個世界 ——
  //       有 CHECK:`success+reason_code` 與 `failure+NULL` **兩發都被擋**(check constraint 違反);
  //       DROP 掉那條 CHECK 後:**同樣兩發都進得去**(壞形狀 2 列 / 總 4 列)
  //       ⇒ 擋它們的確實是這條 CHECK,不是別的約束。收攤後叢集已刪、工作樹 dirty=0。
  'auth_callback_events_outcome_reason_pair',
  'coupons_percent_range',
  'bbox_complete',
  'bbox_null_unless_ok',
  'order_notes_contact_fields_required',
  'order_notes_internal_fields_absent',
  'order_refunds_failed_detail_only_failed',
  'orders_tappay_rec_channel_check',
  'payment_charge_attempts_capture_read_pair_chk',
  'payment_charge_attempts_released_closed_status_chk',
  'shipments_hct_evidence_carrier',
  'shipments_hct_status_carrier',
  'shipments_hct_submitted_evidence',
  'shipments_shipped_needs_tracking',
  'wallet_amount_sign',
  // 🔴 2026-09-02 線 `-c7` 實測補進(它自己寫的 `20260901080000_m4b_autorefund_pending_refunds.sql:246-249`)。
  //    形狀:`(voided_at IS NULL) = (void_reason IS NULL)
  //           AND (void_reason IS NULL OR btrim(void_reason, <字集>) <> '')`
  //    🔴 **NULL 短路面為什麼是關的(而這一格是實測不是推的)**:
  //       ①`(x IS NULL) = (y IS NULL)` 兩側都是 `IS NULL` 述詞 ⇒ **永遠不是 NULL**
  //       ②OR 的第一個分支 `void_reason IS NULL` 把 NULL 那條路自己吃掉 ⇒ 走不到會回 NULL 的比較
  //    ✅ **實跑(拋棄式 PG 17.10)—— 直接對這條運算式求值,五個 NULL 組合逐格印 `IS NULL`**:
  //       兩欄皆 NULL / 只有 voided_at NULL / 只有 void_reason NULL / 皆非 NULL(空白) / 皆非 NULL(真理由)
  //       ⇒ **五格的「求值成 NULL」全部是 `f`**(結果分別 t / f / f / f / t)。
  //       🟢 而同一發帶對照:一條真的有短路面的形狀 `(s='a' OR s='b')` 餵 `s = NULL`
  //          ⇒ **印 `求值成 NULL = t`** ⇒ 📌 **那證明這把尺分得出兩個世界,不是它對誰都印 f。**
  //    ✅ **而【擋不擋得住】也真的塞過(real / weak 兩張表,同一批六個世界)**:
  //       有這條 CHECK ⇒ 作廢無理由 / 沒作廢有理由 / 理由只有半形空白 / 理由只有全形空白 **四發全擋**,
  //       兩發正常的進得去(2 列);DROP 掉這條之後 ⇒ **同樣六發全部進得去**(6 列)
  //       ⇒ 📌 **擋它們的確實是這條 CHECK,不是別的約束。**收攤後叢集已刪。
  //    ⚠️ **它【沒有】承重的 NOT NULL**:`voided_at` 與 `void_reason` 兩欄都是 nullable(`attnotnull=false`)
  //       ⇒ 所以本檔 `LOAD_BEARING_NOT_NULL` 不必為它加列 —— **沒有可以被拆掉而讓它失效的東西**。
  //    🎯 **⇒ 所以它是【自身安全】不是【條件安全】**(`-0e` 2026-09-02 複審給的區分,而那個區分承重):
  //       理由要寫成「**這條運算式構造不出 NULL**」,**不是「我試過了它擋得住」** ——
  //       後者只涵蓋我試過的那幾發,前者涵蓋所有輸入。⇒ 而上面那五格 NULL 組合就是在證前者。
  'order_pending_refunds_void_needs_reason',
] as const;

/**
 * 二 · 🔴 **形狀命中而【沒有】被實測過**。這一欄不是「已經沒事」,是**待驗清單**。
 *
 * 它們是本檔的掃描器比 D 窗 2026-08-21 上午那份人工清單**更寬**才浮出來的
 * (D 的篩選只收 `= '字面'`,本檔連 `<> '字面'` 一起收 —— 而 `status <> 'completed' OR …`
 *  是同一個病:`status` 為 NULL 時整條算出 NULL、CHECK 放行)。
 * ⇒ 🔴 **這正是「掃描字集比宣稱窄」那一坑**(`docs/patterns/guard-and-instrument-traps.md`):
 *   前一輪回報「12 支」是**在那個篩選之下**的 12 支,不是這個病的全部。
 *
 * 移一列到上面那張清單的門檻:**跑過一發壞形狀**,不是讀過覺得沒問題。
 */
const SHAPE_MATCHED_NOT_YET_PROBED: readonly string[] = [
  'order_item_procurement_contact_channel_nonempty',
  'order_item_procurement_exception_reason_nonempty',
  'order_refunds_deferred_clean',
  'order_refunds_processing_clean',
  'orders_invoice_number_len',
  'orders_notification_email_valid',
  'orj_correction_triple_paired',
  'orj_shape_completed',
  'orj_shape_dead',
  'orj_shape_failed',
  'orj_shape_processing',
  'orj_shape_queued',
  'orj_shape_reconciling',
  'orj_shape_submitted',
  // 🔴🔴 `pfe_provenance_valid` —— **它留在【待驗】這一欄是刻意的,而它與上面那些不同族**。
  //    出處 `20260901170000_m4b_pfe_ddl_into_version_control.sql`(commit `4356010f`;
  //    ⚠️ 作者欄全窗共用 probe ⇒ **查不出是誰寫的**)。**不是 `-c7` 寫的。**
  //
  //    🔴 **它形狀上【真的有】那個洞**(`-0e` 2026-09-02 複審):
  //       `source_model_code` 是 NULL 時 ⇒ `(true AND NULL) OR (false AND NULL)` = **NULL**
  //       ⇒ 而 CHECK 只擋 FALSE ⇒ **NULL 放行**。
  //    ✅ **而它今天不咬人的理由是【別人的 NOT NULL】,不是它自己**:
  //       `match_source` / `model_code` / `source_model_code` 三欄皆 `is_nullable = NO`
  //       ⇒ 量測:**`-0e` 2026-09-02 唯讀正式庫 `information_schema.columns`**;
  //         🟢 正對照 `year_start` / `year_end` ⇒ `YES` ⇒ **那把尺會動**。
  //    🛑 **⇒ 所以它是【條件安全】不是【自身安全】** —— 而這就是它不能上 `PROBED_OR_CHECKS` 的理由:
  //       **那一發壞形狀【跑不出來】,因為 NOT NULL 會先擋。**⇒ 本欄的門檻(跑過一發壞形狀)它達不到。
  //    🔴🔴 **觸發條件(寫給未來的人,不是寫給今天的)**:
  //       **哪天有人把那三欄任一欄改成 nullable ⇒ 這條 CHECK 當場靜靜放行,而沒有任何東西會叫。**
  //       ⇒ 那一次要叫 codex —— 它動的是**可達性**,不是樣式。
  //    📌 **⇒ 而理由寫在這裡而不是寫「已確認」,是因為【白名單本身會變成關掉下一個人查證動作的東西】。**
  'pfe_provenance_valid',
] as const;

/**
 * 三 · 匿名 CHECK(migration 裡沒寫 `CONSTRAINT <名字>`,由 Postgres 自動命名)。
 * 🔴 **不能要求它變成 0** —— 這幾支住在**已經 apply 的** migration 裡,
 * 而改已 apply 的檔會讓 `supabase/APPLIED.tsv` 的 sha256 對不上(那道閘是真的)。
 * ⇒ 一道**今天做不完**的閘只會訓練人略過它(memory `feedback_a-guard-you-cant-finish-today-becomes-noise`)。
 * ⇒ 改成:**釘住現有這幾支,新的匿名 OR 串 CHECK 才紅。**
 * (`payment_charge_attempts_check`:`status` NOT NULL 撐著,同屬待驗那一族。)
 */
const KNOWN_ANONYMOUS_OR_CHECKS: readonly string[] = [
  "20260612150000_m3_s2d_charge_attempts.sql: (status <> 'charged' OR rec_trade_id IS NOT NULL)",
] as const;

const KNOWN_OR_CHECKS: readonly string[] = [
  ...PROBED_OR_CHECKS,
  ...SHAPE_MATCHED_NOT_YET_PROBED,
] as const;

/** 去掉行註解與區塊註解 —— 註解裡的舊寫法不是生效敘述,掃到會變誤報。 */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** 抓出每一段 `CHECK ( … )` 的括號配對主體(正規式數不了括號,只能自己走)。 */
export function checkBodies(sql: string): { at: number; body: string }[] {
  const src = stripComments(sql);
  const out: { at: number; body: string }[] = [];
  for (const m of src.matchAll(/\bCHECK\s*\(/gi)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let j = open; j < src.length; j += 1) {
      if (src[j] === '(') depth += 1;
      else if (src[j] === ')') {
        depth -= 1;
        if (depth === 0) {
          out.push({ at: m.index, body: src.slice(open, j + 1) });
          break;
        }
      }
    }
  }
  return out;
}

/**
 * 「OR 串 + 對字面值做等值比較 + 沒有 COALESCE / CASE 兜底」= NULL 會讓整條算出 NULL,
 * 而 CHECK **只有算出 false 才擋** ⇒ 壞形狀靜靜寫得進去。
 * (母題:memory `reference_pg-check-passes-on-null-use-coalesce-false`。)
 */
export function isNullShortCircuitShape(body: string): boolean {
  if (!/\bOR\b/i.test(body)) return false;
  if (!/[\w)]\s*(?:=|<>)\s*'/.test(body)) return false;
  if (/\bCOALESCE\b/i.test(body)) return false;
  if (/\bCASE\b/i.test(body)) return false;
  return true;
}

/** 往前找最近的 `CONSTRAINT <名字>`;找不到回 `null`(匿名 CHECK)。 */
export function constraintNameBefore(sql: string, at: number): string | null {
  const seg = stripComments(sql).slice(Math.max(0, at - 200), at);
  const m = seg.match(/CONSTRAINT\s+"?([A-Za-z0-9_]+)"?\s*$/i);
  return m?.[1] ?? null;
}

/**
 * 抓出「拆掉 NOT NULL」的敘述,回傳 (表, 欄)。
 * 正規化掉識別字引號、schema 前綴與多餘空白,讓等價寫法收斂成同一形狀。
 */
export function dropNotNullTargets(sql: string): { table: string; column: string }[] {
  const flat = stripComments(sql)
    .replace(/"/g, '')
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s+/g, ' ');
  const out: { table: string; column: string }[] = [];
  const re =
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([A-Za-z0-9_.]+)([^;]*?)DROP\s+NOT\s+NULL/gi;
  for (const m of flat.matchAll(re)) {
    const table = (m[1] ?? '').split('.').pop()?.toLowerCase() ?? '';
    // 同一段 ALTER TABLE 可以串多個 ALTER COLUMN,取最靠近 DROP NOT NULL 的那個欄名
    const cols = [...(m[2] ?? '').matchAll(/ALTER\s+(?:COLUMN\s+)?([A-Za-z0-9_]+)/gi)];
    const column = cols.at(-1)?.[1]?.toLowerCase() ?? '';
    out.push({ table, column });
  }
  return out;
}

function readMigrations(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8') }));
}

describe('OR 串 CHECK 的 NULL 短路面守門(#641 ④ 的機制版)', () => {
  const migrations = readMigrations();

  it('前提:掃得到 migration 檔(否則以下每一條都是恆真的空守門)', () => {
    expect(migrations.length).toBeGreaterThan(50);
  });

  it('🔴 不得拆掉承重的 NOT NULL —— 拆了,對應那條 CHECK 當場失效而沒有任何訊號', () => {
    const guarded = new Set(LOAD_BEARING_NOT_NULL.map(([t, c]) => `${t}.${c}`));
    const offenders: string[] = [];
    for (const { file, sql } of migrations) {
      for (const { table, column } of dropNotNullTargets(sql)) {
        if (guarded.has(`${table}.${column}`)) offenders.push(`${file}: ${table}.${column}`);
      }
    }
    expect(
      offenders,
      '這一欄是某條 OR 串 CHECK 唯一的支撐點(2026-08-21 實測)。' +
        '真的要拆,先把那條 CHECK 改成 CASE + ELSE false(或全程 COALESCE),再從本檔白名單移除。',
    ).toEqual([]);
  });

  it('🔴 掃到白名單以外的 OR 串 CHECK ⇒ 紅(人工釘的清單會靜靜少算一個,所以用掃描比對)', () => {
    const found = new Set<string>();
    const anonymous: string[] = [];
    for (const { file, sql } of migrations) {
      for (const { at, body } of checkBodies(sql)) {
        if (!isNullShortCircuitShape(body)) continue;
        const name = constraintNameBefore(sql, at);
        if (name) found.add(name);
        else anonymous.push(`${file}: ${body.replace(/\s+/g, ' ').slice(0, 80)}`);
      }
    }
    // 判別力前提:真的掃到東西。掃到 0 就是正規式/括號配對壞了,而空集合比空集合會綠。
    expect(found.size, '掃到 0 支 ⇒ 掃描器本身壞了,不是「repo 很乾淨」').toBeGreaterThan(0);
    expect(
      [...found].filter((n) => !KNOWN_OR_CHECKS.includes(n)).sort(),
      '新的 OR 串 CHECK。先跑一發壞形狀確認它真的擋得住(方法見 H2-12支CHECK 那份交件),再加進白名單。',
    ).toEqual([]);
    expect(
      anonymous.filter((a) => !KNOWN_ANONYMOUS_OR_CHECKS.includes(a)).sort(),
      '新的匿名 OR 串 CHECK。**新檔**請補 `CONSTRAINT <名字>` 讓它釘得住;'
        + '若它住在已 apply 的 migration 裡就加進 KNOWN_ANONYMOUS_OR_CHECKS(不要去改那支檔)。',
    ).toEqual([]);
  });

  // 🔴 以下三條是**這把尺自己的自檢**:沒有它們,上面的綠同時相容於「乾淨」與「掃描器壞了」。
  describe('自檢:量具在【該紅的世界】要真的紅', () => {
    it('壞形狀 CHECK 認得出來,而 COALESCE / CASE 兜底過的不誤報', () => {
      expect(isNullShortCircuitShape("(kind = 'a' OR kind = 'b')")).toBe(true);
      expect(isNullShortCircuitShape("(kind <> 'a' OR other IS NULL)")).toBe(true);
      expect(isNullShortCircuitShape("(COALESCE(kind,'') = 'a' OR x IS NULL)")).toBe(false);
      expect(isNullShortCircuitShape("(CASE WHEN kind = 'a' THEN true ELSE false END)")).toBe(false);
      expect(isNullShortCircuitShape("(kind = 'a' AND x > 0)")).toBe(false); // 沒有 OR
    });

    it('註解裡的舊寫法不會被誤報(B5 草稿那次就是這樣誤中的)', () => {
      const sql = "-- 舊版寫成 CHECK (kind = 'a' OR kind = 'b'),已作廢\nSELECT 1;";
      expect(checkBodies(sql)).toEqual([]);
    });

    it('DROP NOT NULL 的四種等價寫法都抓得到,而無關的 ALTER 不誤報', () => {
      const variants = [
        'ALTER TABLE shipments ALTER COLUMN carrier_code DROP NOT NULL;',
        'ALTER TABLE public.shipments ALTER carrier_code DROP NOT NULL;',
        'ALTER TABLE IF EXISTS "public" . "shipments" ALTER COLUMN "carrier_code" DROP NOT NULL;',
        'ALTER TABLE ONLY shipments\n  ALTER COLUMN carrier_code\n  DROP NOT NULL;',
      ];
      for (const v of variants) {
        expect(dropNotNullTargets(v), v).toEqual([{ table: 'shipments', column: 'carrier_code' }]);
      }
      expect(dropNotNullTargets('ALTER TABLE shipments ADD COLUMN foo text;')).toEqual([]);
      expect(dropNotNullTargets("ALTER TABLE shipments ALTER COLUMN carrier_code SET DEFAULT 'hct';")).toEqual([]);
    });
  });
});
