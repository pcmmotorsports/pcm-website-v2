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
  // 🔴 2026-09-02 `-15`:`pfes_provenance_valid` 的 NULL 短路面是【開的】,
  //    關著它的是這三個欄位的 NOT NULL(實測見 PROBED_OR_CHECKS 裡那條的註解)。
  //    ⇒ 少了這三列, 未來有人 DROP NOT NULL 時本檔不會紅(codex 抓, 我原本只寫在註解裡)。
  ['product_fitments_effective_staging', 'match_source'],
  ['product_fitments_effective_staging', 'model_code'],
  ['product_fitments_effective_staging', 'source_model_code'],
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
  // 🔴 2026-09-02 線 `-15` 實測補進(⟦b4-PFEDDL2⟧ 把兩張既有表補進版控)。
  //    形狀:`(ms='direct' AND smc = mc) OR (ms='inherited' AND smc <> mc)`
  //    🛑 **NULL 短路面是【開的】** —— `=` 與 `<>` 對 NULL 都求值成 NULL ⇒ 兩個分支都 NULL
  //       ⇒ 整條 CHECK 求值成 NULL ⇒ **PG 的 CHECK 求值成 NULL 就放行。**
  //    🎯 **⇒ 擋住它的不是這條 CHECK, 是 `match_source`/`model_code`/`source_model_code` 的 `NOT NULL`。**
  //       ⛔ ~~原本寫 `moto_brand`~~ **作廢**(codex 抓)—— `moto_brand` **根本不在這條 CHECK 裡**
  //         ⇒ 📌 **一個正確的機制描述, 配了一組錯的欄位名 —— 而句子讀起來完全通順,**
  //           **因為那三個名字都真的存在、也都真的是 NOT NULL。**
  //       ⇒ 📌 **承重的是那三個 `NOT NULL`** —— 有人把 `source_model_code` 改成可空,
  //         **這條 CHECK 會對 NULL 靜靜放行, 而它自己一個字都沒變。**
  //    ✅ **兩個世界實跑(不是推的)**:拋棄式 PG 17.10,同一條 CHECK 兩張表 ——
  //       `t_real`(smc NOT NULL)⇒ `('direct','A',NULL)` **被擋**;
  //       `t_weak`(smc 可空)⇒ **同一發進得去** ⇒ 承重的確實是 NOT NULL。
  //       可複跑:`bash scripts/pfeddl2-verify.sh` 的 ②b 兩格(harness 20 格全綠)。
  //    🔵 **而那個 `NOT NULL` 有被釘住**:該 migration 的事後閘① 逐字比對 staging 每一欄的
  //       `column_name:is_nullable`(配了突變「run_id 改可空 ⇒ 閘① 要叫」)⇒ 改可空會當場紅。
  'product_fitments_effective_staging.pfes_provenance_valid',
  'auth_callback_events.auth_callback_events_outcome_reason_pair',
  'coupons.coupons_percent_range',
  'product_image_trim.bbox_complete',
  'product_image_trim.bbox_null_unless_ok',
  'order_notes.order_notes_contact_fields_required',
  'order_notes.order_notes_internal_fields_absent',
  'order_refunds.order_refunds_failed_detail_only_failed',
  'orders.orders_tappay_rec_channel_check',
  'payment_charge_attempts.payment_charge_attempts_capture_read_pair_chk',
  'payment_charge_attempts.payment_charge_attempts_released_closed_status_chk',
  'shipments.shipments_hct_evidence_carrier',
  'shipments.shipments_hct_status_carrier',
  'shipments.shipments_hct_submitted_evidence',
  'shipments.shipments_shipped_needs_tracking',
  'customer_wallet_ledger.wallet_amount_sign',
  // 🔴 2026-09-04 線【帳號】`-account` 實測補進(⟦b4-INVOICE5PCT⟧ Q3, migration `20260904224500`)。
  //    形狀:invoice_requested OR (invoice_status <> 'issued' AND invoice_number IS NULL AND invoice_amount IS NULL)
  //
  //    🔬 **方法同 08-21:同一條 CHECK 建 real / weak 兩張表, 真的塞一發壞形狀進去看誰擋**
  //       (拋棄式 PG 17.10;壞形狀 = `invoice_requested = NULL` + `invoice_status = 'issued'` + 有號碼)。
  //    **量到的**:
  //      · `weak_t`(**沒有** NOT NULL)⇒ 🔴 **`INSERT 0 1` —— 那一列進去了。**
  //      · `real_t`(**有** NOT NULL)⇒ 被 **`violates not-null constraint`** 擋下 —— **不是被 CHECK 擋的。**
  //      · 🟢 正對照(`false` 而非 NULL + `issued`)⇒ **兩張表都印 `violates check constraint "c"`** ⇒ CHECK 本身是活的。
  //      · 🔵 負對照(`true` + `issued`)⇒ **放行** ⇒ 它不是恆擋。
  //
  //    🔴 **⇒ 所以:這條 CHECK 的【NULL 短路面是開的】, 撐住它的是 `orders.invoice_requested` 的 NOT NULL。**
  //    🛑 **⇒ 而那句話的可執行版本是:有人哪天把那一欄改成可為 NULL, 這道 CHECK 會【安靜地】失效**
  //       —— 因為 PostgreSQL 的 CHECK 求值成 NULL 時**放行**, 而那不會有任何訊息。
  //    ⚠️ **本列證的是【NULL 那一面】, 不是值域** —— `invoice_status` 的其他值(如 `voided`)通得過,
  //       那是**刻意的**(本片沒有拍板說作廢該不該擋), 見 `20260904224500` 那道 CHECK 上方的註解。
  'orders.orders_no_invoice_when_not_requested',
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
  'order_pending_refunds.order_pending_refunds_void_needs_reason',
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
  'order_item_procurement.order_item_procurement_contact_channel_nonempty',
  'order_item_procurement.order_item_procurement_exception_reason_nonempty',
  'order_refunds.order_refunds_deferred_clean',
  'order_refunds.order_refunds_processing_clean',
  'orders.orders_invoice_number_len',
  'orders.orders_notification_email_valid',
  'order_refund_jobs.orj_correction_triple_paired',
  'order_refund_jobs.orj_shape_completed',
  'order_refund_jobs.orj_shape_dead',
  'order_refund_jobs.orj_shape_failed',
  'order_refund_jobs.orj_shape_processing',
  'order_refund_jobs.orj_shape_queued',
  'order_refund_jobs.orj_shape_reconciling',
  'order_refund_jobs.orj_shape_submitted',
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
  'product_fitments_effective.pfe_provenance_valid',
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

/**
 * 把【不是生效 SQL】的區段換成空白:行註解 · 區塊註解 · 單引號字串 · dollar-quoted 區塊。
 *
 * ⛔ ~~原本叫 `stripComments`, 只剝註解~~ ⇒ **2026-09-02 `-15` 改**(板 `⟦15-SQLSTRSCAN⟧`)。
 *
 * ══ 🔴 為什麼要連字串一起剝(而這不是潔癖, 是量到的)═══════════════════
 *   全 repo `CHECK (` 命中數:**只剝註解 421 ⇒ 連字串一起剝 340**
 *   ⇒ **81 個(19%)是【住在 SQL 字串裡的幽靈】, 分佈在 27 支 migration。**
 *   🛑 **而它至今沒有紅過, 原因不是它沒錯** —— 那些幽靈大多不是 OR 串形狀
 *      ⇒ 被下一層 `isNullShortCircuitShape()` 濾掉了。
 *   ⇒ 📌 **它靠的是【第二道濾網剛好擋住第一道的錯】—— 那不是設計, 是運氣。**
 *   ⇒ ⇒ 🎯 **而顯形機率取決於【下一個人碰巧寫了什麼】**:2026-09-02 有人把一條
 *      正本 CHECK 的字面當【期待值字串】寫進 migration(`20260902210000`)
 *      ⇒ 那個字串**剛好是 OR 串形狀** ⇒ 它當場被讀成一條真的、而且沒有名字的 CHECK。
 *
 * ══ 🔴🔴 為什麼是【一次掃描】而不是兩個 pass ═══════════════════════
 *   註解與字串會互相咬, 而**兩個方向各有一個反例**:
 *     `'a -- b'`    ⇒ 先剝註解 ⇒ **字串被切一半**
 *     `-- it's ok`  ⇒ 先剝字串 ⇒ 那個 `'` 開啟一個假字串, **吃掉後面整段**
 *   ⇒ 🎯 **兩個反例、兩個方向 ⇒ 「先剝哪個都一樣」是假的。**
 *
 * ══ 🔴🔴 為什麼【長度保持】(換成空白而不是刪掉)═════════════════════
 *   `checkBodies()` 回傳的 `at`, 被 `constraintNameBefore(sql, at)` 與
 *   `enclosingTable(sql, at)` 拿去**切原字串**。
 *   舊版會改變長度 ⇒ 三支函式之所以對得上, 是因為**它們都各自再剝一次**、
 *   活在同一個「剝過的座標系」裡 ⇒ 🛑 **只要有一支多剝或少剝一層, 座標系就分岔,**
 *   **而表名歸屬會【安靜地】錯。**
 *   ✅ 換成空白之後座標與**原始字串**一比一
 *   ⇒ 📌 **那是把一個【要靠三個人記得】的約束, 換成一個結構上不可能違反的性質。**
 *   🔵 換行**保留** —— 否則行註解會吃掉換行, 下一行被併進註解。
 *
 * ══ 🛑 它剝不掉什麼(兩個方向分開寫 —— 合成一句「有盲區」會讓人以為兩邊一樣安全)══
 *   🔴 **【剝過頭】⇒ 漏報(真的 CHECK 被吃掉)—— 這一邊嚴重一個量級, 因為沒有人會看到:**
 *     · `E'…\'…'`(backslash 轉義字串):本版照 `''` 規則走 ⇒ `\'` 會被讀成字串結束
 *       ⇒ 後面那段仍在字串裡, 而本函式以為出來了 ⇒ **反而是【剝不夠】**;
 *       但若 `\'` 出現在偶數次之後, 也可能提早結束而**把真碼當字串吃掉**。
 *     · dollar tag 不成對(`$a$ … $b$`)⇒ **吃到檔尾** ⇒ 那一支檔之後的 CHECK 全部消失。
 *   🔵 **【剝不夠】⇒ 誤報(幽靈留著)—— 有人會看到紅, 而它有出路:**
 *     · `U&'…'` / 帶 `UESCAPE` 的字串
 *     · 巢狀同名 dollar tag(`$$ … $$ … $$`)
 *   ⚠️ **本 repo 現況:`E'` 0 支 · `U&'` 0 支** —— 那是 2026-09-02 量的, 不是永遠。
 */
// 🔴🔴 **這一段是【我連續猜錯兩次】的紀錄, 留著 —— 它比修法本身有用:**
//   症狀:改完之後這道守門 **逾時而紅**(54.9s / 上限 15s)。
//   猜① 「正規化太慢」⇒ 加一個 memo ⇒ **94.5s(更慢)**
//   猜② 「memo 自己是負擔」⇒ 拿掉 memo ⇒ **54.0s(還是紅)**
//   🔬 而**分開量**才找到:單獨跑正規化, 全 273 支兩種形式合計 **298ms** ⇒ **它從來就不慢。**
//   ✅ 真因在 `dropNotNullTargets`:它那條 regex 有一個 `([^;]*?)` ——
//      而我把**字串也抹白之後, 字串裡的 `;` 一起消失了** ⇒ 那個 lazy quantifier
//      失去了原本讓它早早停下的邊界 ⇒ **回溯爆炸。**
//   ⇒ ✅ 修法一個參數:那支改用【只抹註解、字串留著】的形式(它找的是 SQL 語法, 不是字面值)。
//   ⇒ 📌 **而兩次猜錯的共同點:`Test timed out` 只說「整體太久」, 它【不指向任何一段】**
//      **—— 而人會直覺往「重複計算」那個方向猜, 因為那是最常見的原因。**
//   ⇒ ⇒ 🎯 **一個不指向任何位置的症狀, 會讓人用【最常見的成因】去填那個空格。**

export function normalizeSqlForTest(sql: string, opts?: { strings: boolean }): string {
  return normalizeSql(sql, opts);
}

function normalizeSql(sql: string, opts: { strings: boolean } = { strings: true }): string {
  const chunks: string[] = [];
  let keep = 0;
  let i = 0;
  const wipe = (from: number, to: number) => {
    chunks.push(sql.slice(keep, from));
    chunks.push(sql.slice(from, to).replace(/[^\n]/g, ' '));
    keep = to;
  };
  // 🔴 **遞迴進 dollar-quote 本體(只在 `strings:false`)—— 2026-09-03 R2 對抗審查逼出來的第三條路。**
  //   `--` 在**單引號字串**裡不是註解, 而在 **`$$…$$` 本體裡它【是】—— 當那個本體是【碼】的時候**
  //   (函式體 / `DO` 區塊)。⚠️ `$$` 也能當**純資料字面**(`INSERT … VALUES ($$a -- b$$)`),
  //   那時 `-- b` 是資料而本版會抹白它 ⇒ **過剝確實會發生**(2026-09-03 構造 4/4 全中)。
  //   🛑🛑 **而「方向是假綠」那半【我驗過了, 它是錯的】—— 那句話我從 R3 抄下來就寫進檔案,**
  //     **沒有構造一發。這是我同一夜第三次犯同型的錯, 所以連錯法一起留著。**
  //     🔬 **怎麼驗的**:對兩個消費者各餵四格,**每格附【真值】**(真值由人判 ——
  //       `$$…$$` 裡的是**資料**不是邏輯), 比「只跳過版」與「遞迴版」誰答對:
  //       ```
  //       isNullShortCircuitShape:  假綠 只跳過 1 格 / 遞迴 0 格
  //       dropNotNullTargets:       假綠 遞迴 0 格(而它下游是 LOAD_BEARING_NOT_NULL = 金流表)
  //       ```
  //     🎯 **成因**:過剝拿掉的只可能是【資料】, 而這兩支尺讀的四個訊號(`OR` / `= '字面'` /
  //       `COALESCE` / `CASE`)全是【邏輯】—— 邏輯住在 dollar 本體**外面**, 遞迴碰不到它。
  //       ⇒ **拿掉資料只會讓誤報變少** ⇒ 方向是**假紅**(有人會看到), **不是假綠**。
  //       實例:`CHECK (body <> $$q -- OR body = 'z'$$)` —— 只跳過版把資料裡的 `OR` 讀成邏輯 ⇒ 誤報;
  //             遞迴版答對。`INSERT … VALUES ($$ALTER TABLE … DROP NOT NULL$$)` ⇒ **兩版都誤報**
  //             (資料被當成真 DDL)—— 那是**既有**的假紅, 不是本次造成的, 方向安全。
  //     ✅ **正對照(照 `scripts/two-controls.sh` 的紀律:先證明尺在該有時會說有)**:
  //       拿一把「連真邏輯也抹白」的壞尺餵 `CHECK (kind = 'a' OR kind = 'b')`(真值=壞形狀)
  //       ⇒ 它印 `false` 而遞迴版印 `true` ⇒ **harness 造得出假綠也看得見** ⇒ 上面那兩個 0 有判別力。
  //       負對照(現造字面 `ZZQPRB<timestamp>`, 無 `OR`)⇒ `false`。
  //     🛑 **為什麼不為此加一格測試**:要釘的那個方向(真 DDL 藏在 `$$` 本體、同行前面有 `--`)
  //       **已經有一格了** —— 就是下面 `DO $$ … -- note; here` 那格。而 `$$` 當資料被誤報那一格
  //       **不加**:釘它等於把一個【我認為錯但今天無害】的行為凍住。⇒ 明寫在這裡,不寫成綠燈。
  //   ⇒ 只跳過不遞迴 ⇒ 本體裡的 `--` 留著 ⇒ **兩個方向同時壞**:
  //     漏報 `DO $$ … ALTER … -- note; here ⏎ DROP NOT NULL; …$$`(註解裡的 `;` 卡死 `[^;]*?`)
  //     誤報 `DO $$ -- ALTER TABLE t … DROP NOT NULL; $$`(**被註解掉的 DDL 被讀成真的**)
  //   🛑 **我 R2 曾在這裡寫「這個 trade-off 不可避免」—— 那是【推出來的】, 而它是假的。**
  //     三版對六種形狀:舊版 4/6 · 只跳過 5/6 · **遞迴版 6/6**(見函式旁的表)。
  //   ✅ **長度仍然保持**(遞迴出來的子字串等長)⇒ `checkBodies` 那兩把座標尺不受影響。
  const recurse = (from: number, to: number) => {
    chunks.push(sql.slice(keep, from));
    chunks.push(normalizeSql(sql.slice(from, to), opts));
    keep = to;
  };
  // 🔴🔴 **`opts.strings` 只決定【要不要抹掉】, 【不決定要不要解析】——**
  //    **這是 codex 2026-09-02 抓到的洞, 而它是這一片最毒的一個:**
  //    第一版在 `strings:false` 時**完全不進字串分支** ⇒ 一個字串裡的 `--` 會被當成行註解
  //    ⇒ `CHECK (kind = 'a -- b' OR kind = 'c')` 的 body **從 `--` 被抹到行尾**
  //    ⇒ 🛑 **那個 `OR` 消失了 ⇒ 形狀判斷失效 ⇒ 安靜漏報**, 而兩把尺長度仍然相等。
  //    ⇒ 📌 **「長度相等」這個自檢對它完全失明 —— 它只驗座標, 不驗內容。**
  //    ✅ 而修好它同時解掉了效能:解析字串會讓 `i` 一次跳過整段, 而不解析就得逐字爬。
  const isIdentChar = (c: string | undefined) =>
    c !== undefined && /[A-Za-z0-9_$]/.test(c);
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const j = sql.indexOf('\n', i);
      const end = j < 0 ? sql.length : j;
      wipe(i, end);
      i = end;
    } else if (sql.startsWith('/*', i)) {
      // 🔴 PostgreSQL 的區塊註解**可以巢狀** ⇒ 用深度計數, 不要找第一個 `*/`(codex 抓)。
      //    `/* a /* b */ ' */` —— 在內層就離開的話, 那個 `'` 會開啟一個假字串。
      let depth = 0;
      let j = i;
      while (j < sql.length) {
        if (sql.startsWith('/*', j)) { depth += 1; j += 2; continue; }
        if (sql.startsWith('*/', j)) { depth -= 1; j += 2; if (depth === 0) break; continue; }
        j += 1;
      }
      wipe(i, j);
      i = j;
    } else if (sql[i] === '"') {
      // 🔴 雙引號識別字(`"it's"`)**不是字串, 而它裡面的 `'` 不得開啟字串**(codex 抓)。
      //    ⇒ 只【跳過】不抹白 —— 它是識別字, 後面的 `enclosingTable` 還要讀它。
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') { j += 2; continue; }
          j += 1;
          break;
        }
        j += 1;
      }
      i = j;
    } else if (sql[i] === "'" || ((sql[i] === 'E' || sql[i] === 'e') && sql[i + 1] === "'" && !isIdentChar(sql[i - 1]))) {
      // 🔴 `E'…'` 用 **backslash** 轉義(`\'`), 一般字串用 `''` —— 兩種規則不同(codex 抓)。
      const isE = sql[i] !== "'";
      const open = isE ? i + 1 : i;
      let j = open + 1;
      while (j < sql.length) {
        if (isE && sql[j] === '\\') { j += 2; continue; }
        if (sql[j] === "'") {
          if (!isE && sql[j + 1] === "'") { j += 2; continue; }
          j += 1;
          break;
        }
        j += 1;
      }
      if (opts.strings) wipe(i, j);
      i = j;
    } else if (sql[i] === '$' && !isIdentChar(sql[i - 1])) {
      // 🔴 `foo$tag$bar` 是一個**合法識別字** —— 前一個字元是識別字字元時, 這個 `$` 不是開頭(codex 抓)。
      // 🔴 **視窗要吃得下【最長的合法 tag】** —— PG 的 tag 跟未加引號識別字同規則,
      //    上限 `NAMEDATALEN-1` = **63 bytes** ⇒ `$` + 63 + `$` = **65 字元**。
      //    ⛔ 舊值 ~~`i + 64`~~ **吃不下** ⇒ 2026-09-03 實測邊界**恰好落在 63**:
      //      tag 1/10/60/61/62 字 ⇒ 認得;**63/64/70 字 ⇒ 不認得**(走成頂層行註解)。
      //    ⇒ 而 63 正是**合法上限本身** ⇒ 我們漏掉的剛好是那一格。
      //    🔵 語料現況:最長 tag **22** 字(`20260810160000…:op3_gate_release_order`)、
      //      >=63 字的 **0** 個 ⇒ **今天零影響**;而 `66` 留了餘裕, 且它不吃更長的東西。
      const m = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i, i + 66));
      if (m) {
        const tag = m[0];
        const j = sql.indexOf(tag, i + tag.length);
        const end = j < 0 ? sql.length : j + tag.length;
        if (opts.strings) wipe(i, end);
        // 🔵 `j < 0` = tag 不成對 ⇒ 照舊整段跳到檔尾, 不遞迴(那一段本來就不是合法本體)。
        else if (j >= 0) recurse(i + tag.length, j);
        i = end;
      } else {
        i += 1;
      }
    } else {
      i += 1;
    }
  }
  chunks.push(sql.slice(keep));
  return chunks.join('');
}

/** 抓出每一段 `CHECK ( … )` 的括號配對主體(正規式數不了括號,只能自己走)。 */
export function checkBodies(sql: string): { at: number; body: string }[] {
  // 🔴🔴 **兩把座標尺, 而它們必須長度相同 —— 這一段是本片最容易寫錯的地方:**
  //   `scan`(註解+字串都抹白)⇒ 用來【找 CHECK 在哪】與【配對括號】
  //     ⇒ 字串裡的 `CHECK (` 不會被找到, 字串裡的 `(` `)` 也不會干擾配對。
  //   `text`(只抹註解, **字串留著**)⇒ 用來【取 body 的內容】
  //     ⇒ 🛑 **因為下一層 `isNullShortCircuitShape()` 判的正是 `= '字面值'` 這個形狀**
  //       —— 把字串抹白會把它要找的東西一起抹掉。
  //   ⇒ 🎯 **第一版我只用了 `scan` 一把 ⇒ 全 repo 掃到 0 支, 而那道「掃到 0 就是尺壞了」**
  //     **的自檢當場紅 —— 它是這一片唯一擋下那個錯的東西。**
  //   ✅ 兩把都**長度保持** ⇒ 同一個 index 在 `scan` / `text` / **原字串**上指同一個位置。
  const scan = normalizeSql(sql);
  const text = normalizeSql(sql, { strings: false });
  const out: { at: number; body: string }[] = [];
  for (const m of scan.matchAll(/\bCHECK\s*\(/gi)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let j = open; j < scan.length; j += 1) {
      if (scan[j] === '(') depth += 1;
      else if (scan[j] === ')') {
        depth -= 1;
        if (depth === 0) {
          out.push({ at: m.index, body: text.slice(open, j + 1) });
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
  const seg = normalizeSql(sql).slice(Math.max(0, at - 200), at);
  const m = seg.match(/CONSTRAINT\s+"?([A-Za-z0-9_]+)"?\s*$/i);
  return m?.[1] ?? null;
}

/**
 * 往前找最近的 `CREATE TABLE <t>` / `ALTER TABLE <t>`,回傳表名(去 schema、去引號、小寫)。
 *
 * 🔴 **為什麼需要它**:白名單原本只用【約束名】當鍵,而約束名在 PG 裡只在【同一張表內】唯一。
 *    ⇒ 另一張表新增一條**同名、而 NULL 短路面是開的** CHECK ⇒ 借用既有白名單 ⇒ **直接通過, 零訊號。**
 * 📌 **而這不是白名單設計不良, 是【一次沒做完的修改】**:同一支檔裡的
 *    `LOAD_BEARING_NOT_NULL` 早就用 `(表, 欄)` 當鍵了 —— **一半的地方修好了而另一半沒跟上。**
 *
 * 🛑 **它答不出什麼**(照著用之前先讀):
 *   ① 動態 SQL(`EXECUTE format('… CHECK …')`)裡的約束 —— 那段字面上沒有 CREATE/ALTER TABLE 在前面
 *      ⇒ 它會歸給【更前面那一張表】⇒ **歸錯**。
 *   ② 一支檔完全沒有 CREATE/ALTER TABLE 而有 CHECK(例如只有 DO 區塊)⇒ 回 `null`。
 *   🔵 **而兩種失效的方向都是【誤報】不是【漏報】**:歸錯或歸不到 ⇒ 那條白名單對不上 ⇒ **下次掃到它會紅**。
 *      ⇒ 那是選這個修法的理由之一, 不是事後安慰。
 */
export function enclosingTable(sql: string, at: number): string | null {
  const src = normalizeSql(sql).slice(0, at);
  const ms = [...src.matchAll(/\b(?:CREATE|ALTER)\s+TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:ONLY\s+)?("?[A-Za-z0-9_]+"?(?:\s*\.\s*"?[A-Za-z0-9_]+"?)?)/gi)];
  const raw = ms.at(-1)?.[1];
  if (!raw) return null;
  return raw.replace(/"/g, '').replace(/\s+/g, '').split('.').pop()!.toLowerCase();
}

/**
 * 抓出「拆掉 NOT NULL」的敘述,回傳 (表, 欄)。
 * 正規化掉識別字引號、schema 前綴與多餘空白,讓等價寫法收斂成同一形狀。
 */
export function dropNotNullTargets(sql: string): { table: string; column: string }[] {
  // ✅ **洞已收(2026-09-03)。而【收它的過程】比修法本身有用, 所以整段留著。**
  //
  //   🔴 **洞(codex 2026-09-02 抓)**:
  //     `SELECT 'x -- y'; ALTER TABLE t ALTER COLUMN c DROP NOT NULL;`
  //     ⇒ 舊的刪除式剝註解會從**字串裡**的 `--` 抹到行尾
  //     ⇒ **承重的 NOT NULL 真的被拆掉了, 而這一格全綠。**
  //     ✅ 現在走 `normalizeSql(sql,{strings:false})` —— 它**解析**字串(所以字串裡的 `--`
  //       不再是註解)而**不抹白**(所以動態 SQL 字串裡的 `ALTER … DROP NOT NULL` 仍抓得到)。
  //       🛑 兩半成對:改成 `strings:true` 會關掉後半 ⇒ 那是【漏報】方向, 不要順手改。
  //
  //   🛑🛑 **而 2026-09-02 那一晚寫在這裡的診斷【是錯的】—— 舊字面留著加刪除線,**
  //     **讓搜舊句的人同一發撞到這裡:**
  //     ~~「慢的不是正規化, 是【這條 regex】的回溯 ⇒ 下一個人的第一件事是把這條 regex 改成
  //       不會回溯的形狀」~~
  //     🔬 2026-09-03 **逐段量**(275 支 migration, 合計 **6,620,924 bytes**
  //       —— 是 `wc -c` 的位元組數, 不是 `du -sh` 的 6.9M 區塊數):
  //       `normalizeSql(strings:false)` **64ms** · 再加 `"` 剝除 **52ms**
  //         (⚠️ 加一步而變快 19% ⇒ **這個尺度已被雜訊主導**, 兩個數只當「50-70ms 量級」讀,
  //          不要拿它們做逐段歸因 —— 真正有判別力的是下一行那個量級差);
  //       再加 `.replace(/\s*\.\s*/g,'.')` ⇒ **11,167ms** ← 🎯 **11 秒整個住在這一行**
  //     📌 **成因**:`normalizeSql` 是**長度保持**的(註解換成【空白】不是刪掉)⇒ 一段 5000 字的
  //       註解變成 5000 個空白;而 `\s*\.\s*` 的前導 `\s*` 會在每一個位置貪婪吃完那 5000 格、
  //       找不到 `.`、再逐格回溯 ⇒ **O(n²)**。舊寫法快, 只是因為它把註解【刪掉】了。
  //     ✅ **修法就一件事:把 `\s+`→`' '` 挪到 `\s*\.\s*` 【前面】。**
  //       **11,167ms ⇒ ~250ms**。`\s+` 先把空白收成單格 ⇒ `\s*` 再也沒有 5000 格可以回溯。
  //       **基準要跟著數字走**:改之前那一版的 `flat` sha1 是 `82e5d496…`,
  //       本版是 `0ea6e224…` ⇒ 🔴 **兩者【不同】, 那正是修好的證據**(不是「輸出沒變」)。
  //
  //   ⚠️⚠️⚠️ **這一格是我今晚在同一個地方連錯【兩次】的紀錄, 兩次方向相反 —— 留著全文:**
  //     🔴 **錯 ①(R1 抓)**:我一度把 `\s*\.\s*` 換成更窄的 `/ ?\. ?/`(只吃 0-1 格空白),
  //       並寫下「這樣順序就不是不變式了」。**那是推出來的** —— 我只比了 275 支語料的 sha1。
  //       R1 造出我沒造的形狀打穿它:窄化之後**順序【是】不變式**, 而失效方向是靜默的:
  //         `ALTER TABLE public.\tshipments`     正序 `public.shipments` / 反序 `public. shipments`
  //         `ALTER TABLE public\n  .shipments`   正序 `public.shipments` / 反序 `public .shipments`
  //       ⇒ **表名錯 ⇒ 對不上 `LOAD_BEARING_NOT_NULL` ⇒ 不紅。**
  //     🔴 **錯 ②(R3 抓, 而它把 ① 的修法整個推翻)**:我照 R1 的處方去**寫測試釘住順序**,
  //       而 R3 問了一個前兩輪都沒問的問題 —— **那個窄化到底買到了什麼?**
  //       實測(暖機後各 5 發, 275 支語料):`/ ?\. ?/` **203-449ms** vs `/\s*\.\s*/` **201-361ms**
  //       ⇒ 📌 **區間重疊, 買到 ~0** —— 而它是那個靜默失效模式的**唯一來源**。
  //     ✅ **⇒ 改回 `/\s*\.\s*/`(順序保持)⇒ 那個不變式【連同它要防的東西一起消失】:**
  //       ```
  //                        順序寫錯時 →   耗時        結果        誰會看到
  //         / ?\. ?/                     82ms       ❌ 錯       沒有人
  //         /\s*\.\s*/(現行)            11,280ms   ✅ 正確     慢 → 可能 Test timed out(紅)
  //       ```
  //       ⇒ 🎯 **選的是【失敗方式】不是【速度】** —— 兩者速度一樣, 而一個壞成假綠、一個壞成紅。
  //         本檔上面自己寫過「假紅可以排隊, 假綠不能」⇒ 這一格就是那句話的價目表。
  //     ⇒ 🎯 **兩次的共同教訓不是「我猜錯了」, 是【我沒問那一步買到什麼就先接受了它的代價】** ——
  //       錯 ① 是沒造一發就下斷言;錯 ② 是**照著審查的處方去補防護, 而沒有回頭問那個東西該不該在**。
  //       📌 **一道補得很漂亮的防護, 防的是一個本來可以不存在的風險。**
  //     🔴 另一條死路也照實留著:把那條 `ALTER TABLE` regex 改成不回溯的形狀
  //       (錨點 + `indexOf(';')`)實測 **11,244ms** ⇒ **零效果**
  //       ⇒ 📌 **照著那句錯診斷做的人, 會花一整晚重寫一條不是瓶頸的 regex。**
  //     🔬 **前一班的另外兩條死路數字一併留著**(它逐字寫「數字全部留著給下一個人」, 我差點刪掉):
  //       ② 先照 `;` 切句 + 把 `[^;]*?` 放寬成 `(.*?)` ⇒ **87.4s**  ③ 切句 + `[^;]*?` + 字串抹白 ⇒ **53.1s**
  //       (①「換 `normalizeSql` ⇒ 12.1s」被本次量測取代, 所以只有它被改寫。)
  //
  //   🛑🛑 **R2 對抗審查打穿我第二條, 而這一條我改了【碼】不只改字面:**
  //     我 R2 版寫:「`strings:false` 會把 dollar-quote 本體跳過 ⇒ 內部的 `--` 不再被剝
  //     ⇒ 這個 trade-off **不可避免**(`--` 在 SQL 字串裡不是註解)」。
  //     🔴 **「不可避免」是假的** —— 它把兩件事合成一件:`--` 在**單引號字串**裡確實不是註解,
  //       而在 **`$$…$$` 本體裡它【是】**(PL/pgSQL 本體就是程式碼)⇒ **第三條路存在**,
  //       就是上面 `recurse()` 那三行。而「不可避免」四個字的作用是**讓下一個人不去試那三行**。
  //     🔬 **六種形狀 × 三版**(可重跑, 見下面測試那三格):
  //       ```
  //                                        舊版   只跳過   遞迴版
  //       ① 字串裡的 `--` 吃掉真碼           ❌漏     ✅      ✅
  //       ② `DO $$ … -- note; here` ⏎ DDL   ✅      ❌漏     ✅
  //       ③ `DO $$ -- <被註解掉的 DDL>`      ✅      ❌誤報   ✅
  //       ④⑤⑥ EXECUTE / $q$ / 一般寫法      ✅      ✅      ✅
  //                                        4/6    5/6     6/6
  //       ```
  //     🛑 **而 ③ 是【誤報】方向 —— 那是我 R2 版【新造】的, 舊版沒有。**
  //       我當時逐字寫「兩邊都是漏報方向」⇒ 也是假的。**代價**:有人看到紅會往
  //       「真的有人拆 NOT NULL」查, 而不是往「一段被註解掉的碼被讀成真的」查。
  //     ✅ 全 275 支語料:遞迴版與只跳過版**結果差異 0 檔**, 全跑 **~240ms**。
  //       🔴 **而這個 0 要帶分母, 否則會被讀成「遞迴幾乎不觸發」**:同一組語料裡
  //         `normalizeSql(strings:false)` 的**中間輸出在 223 / 275 支上不同**(R3 量)。
  //         ⇒ 📌 **爆炸半徑 223 檔, 而兩個消費者的結果 0 檔改變** —— 那比一個裸的 0 強。
  //   ⚠️⚠️ **而這一輪我還被打穿第三條, 它是這一片最該記的:**
  //     我在這裡寫過「審查者先量、**我再用自己的腳本獨立重量一次, 四個數逐一相同**」。
  //     🔴 **那句話是真的做了, 而它【不算數】** —— 我的腳本用的是我自己寫的 `$tag$` 掃描器,
  //       **不是這支檔真正在用的 `normalizeSql`** ⇒ 我量的是另一個東西。
  //       改用真的 `normalizeSql` 重量 ⇒ **四個數有兩個不一樣**;而我第一次改對尺之前,
  //       還印出過一組 `275/275/266/65` —— **因為我的判別式把「被抹的註解」也算成字串。**
  //     📌 **⇒ 三把尺三組答案, 只有中間兩個數(223 / 185)三把都同意。**
  //       ⇒ 🎯 **所以那四個數【一個都不寫進來】** —— 照本 repo 的規矩:兩把尺不一致要回
  //         「說不清楚」, 不要挑一個看起來對的。而遞迴版讓那段材料統計**不再需要存在**。
  //     ⇒ 🎯 **真正的教訓:「我獨立重量過」這句話的作用是【關掉下一個人的重量動作】** ——
  //       而它只在**用同一把尺**時才成立。用另一把尺得到相同答案, 是巧合不是複驗。
  //   ⇒ 🎯 **母題:`Test timed out` 不指向任何一段, 而【上一個人留下的診斷】看起來就是那個指向**
  //     **—— 它比沒有診斷更容易讓人停止量測。逐段量一次要 3 分鐘。**
  const flat = normalizeSql(sql, { strings: false })
    .replace(/"/g, '')
    // 🔵 **順序關乎【效能】, 不關乎【正確性】—— 而那是刻意選的, 見上面 R3 那一段。**
    //    對調 ⇒ 11,280ms(正確但慢, 失敗方式是 `Test timed out` = 紅);不對調 ⇒ ~250ms。
    .replace(/\s+/g, ' ')
    .replace(/\s*\.\s*/g, '.');
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

/**
 * 掃一批 SQL, 回傳【白名單以外】的 OR 串 CHECK 鍵(`表.約束名`)與匿名的那些。
 *
 * 🔴 **抽成具名函式的理由不是整潔, 是【讓 fixture 與正式掃描走同一條程式碼路徑】。**
 *    ⇒ 📌 若 fixture 自己重打一份判斷邏輯, 那麼**改壞生產碼時 fixture 照樣綠**
 *      —— 殺不掉突變的 fixture 與寫對的碼印同一個綠。
 */
export function unlistedOrCheckKeys(
  migrations: { file: string; sql: string }[],
  whitelist: readonly string[],
): { unlisted: string[]; anonymous: string[]; allKeys: string[] } {
  const found = new Set<string>();
  const anonymous: string[] = [];
  for (const { file, sql } of migrations) {
    for (const { at, body } of checkBodies(sql)) {
      if (!isNullShortCircuitShape(body)) continue;
      const name = constraintNameBefore(sql, at);
      // 🔴 鍵是 `<表>.<約束名>` 不是裸的約束名 —— 約束名在 PG 裡只在【同一張表內】唯一,
      //    而裸名當鍵時, 另一張表的同名 CHECK 會借用既有白名單**直接通過, 零訊號**。
      //    ⚠️ 歸不到表 ⇒ 用 `(歸不到表)` 佔位, **不要 fallback 成裸名** ——
      //      那會把這道修法在最需要它的那一種檔(動態 SQL)上原地還原。
      if (name) found.add(`${enclosingTable(sql, at) ?? '(歸不到表)'}.${name}`);
      else anonymous.push(`${file}: ${body.replace(/\s+/g, ' ').slice(0, 80)}`);
    }
  }
  return {
    unlisted: [...found].filter((k) => !whitelist.includes(k)).sort(),
    anonymous,
    allKeys: [...found].sort(),
  };
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
    const { unlisted, anonymous, allKeys } = unlistedOrCheckKeys(migrations, KNOWN_OR_CHECKS);
    // 判別力前提:真的掃到東西。掃到 0 就是正規式/括號配對壞了,而空集合比空集合會綠。
    expect(allKeys.length, '掃到 0 支 ⇒ 掃描器本身壞了,不是「repo 很乾淨」').toBeGreaterThan(0);
    // 🔴 而「歸不到表」要自己成為一格 —— 它會安靜地變成一條永遠對不上的鍵,
    //    而那條鍵的紅看起來像「有人新增了 CHECK」, 不像「enclosingTable 沒歸到」。
    expect(
      allKeys.filter((k) => k.startsWith('(歸不到表).')),
      'enclosingTable 歸不到表 ⇒ 去補它(動態 SQL / 沒有 CREATE|ALTER TABLE 在前), 不要把表名亂填一個',
    ).toEqual([]);
    expect(
      unlisted,
      '新的 OR 串 CHECK。先跑一發壞形狀確認它真的擋得住(方法見 H2-12支CHECK 那份交件),'
        + '再加進白名單 —— 🔴 **格式是 `表.約束名`**(2026-09-02 改鍵;裸名會讓另一張表的同名 CHECK 借用)。'
        + '而印出 `(歸不到表).xxx` ⇒ 那是 enclosingTable 歸不到, 去補它、不要把表名亂填一個。',
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

    // 🔴🔴 **這一格是【先證明洞是真的】那一發** —— 它在改鍵之前就寫好了, 而當時它是紅的。
    //    ⇒ 📌 **一個「我覺得會有問題」與一個【現在的版本真的放行了】是兩個宣稱**,
    //      而只有後者能讓下一個人相信這一片不是空跑。
    it('🔴 同名而不同表:借用既有白名單那條路要被堵死(改鍵前它是【通的】)', () => {
      const sql = [
        "CREATE TABLE a_tbl (s text NOT NULL, x text NOT NULL,",
        "  CONSTRAINT dup_name CHECK ((s = 'p' AND x = '1') OR (s = 'q' AND x <> '1')));",
        "CREATE TABLE b_tbl (s text NOT NULL, x text,",
        "  CONSTRAINT dup_name CHECK ((s = 'p' AND x = '1') OR (s = 'q' AND x <> '1')));",
      ].join('\n');
      // ⚠️ 走的是【正式掃描那條路】—— 餵字串給同一組函式, 不另外寫一份判斷邏輯。
      //    否則殺不掉突變的 fixture 與寫對的碼會印同一個綠。
      const keys = checkBodies(sql)
        .filter(({ body }) => isNullShortCircuitShape(body))
        .map(({ at }) => `${enclosingTable(sql, at)}.${constraintNameBefore(sql, at)}`);
      expect(keys).toEqual(['a_tbl.dup_name', 'b_tbl.dup_name']);
      // 🎯 改鍵【前】這兩條都收斂成 `dup_name` 一個字串 ⇒ 白名單放行 a 就等於放行 b。
      //    而 b_tbl 的 `x` 是**可空**的 ⇒ 它的 NULL 短路面是【開的】⇒ 那正是本守門要抓的東西。
      expect(new Set(keys).size, '兩張表的同名約束必須是兩個不同的鍵').toBe(2);
      // 🔵 負對照:兩條的【約束名】確實相同 ⇒ 證明上面那個 2 是表名帶來的, 不是名字本來就不同。
      expect(new Set(checkBodies(sql).map(({ at }) => constraintNameBefore(sql, at))).size).toBe(1);
    });

    it('🔴 而【白名單過濾那條路】也要真的堵住 —— 走 unlistedOrCheckKeys 本尊, 不重打邏輯', () => {
      const sql = [
        "CREATE TABLE a_tbl (s text NOT NULL, x text NOT NULL,",
        "  CONSTRAINT dup_name CHECK ((s = 'p' AND x = '1') OR (s = 'q' AND x <> '1')));",
        "CREATE TABLE b_tbl (s text NOT NULL, x text,",
        "  CONSTRAINT dup_name CHECK ((s = 'p' AND x = '1') OR (s = 'q' AND x <> '1')));",
      ].join('\n');
      const mig = [{ file: 'fixture.sql', sql }];
      // 🔴 白名單只放了 a_tbl 那一條 ⇒ b_tbl 的必須被報出來。
      expect(unlistedOrCheckKeys(mig, ['a_tbl.dup_name']).unlisted).toEqual(['b_tbl.dup_name']);
      // ⛔ **改鍵【前】的行為**:白名單是裸名 ⇒ 放行 a 就等於放行 b ⇒ **零報告**。
      //    這一行是把舊行為寫成證人:它證明上面那個 `['b_tbl.dup_name']` 不是本來就會有的。
      expect(unlistedOrCheckKeys(mig, ['dup_name']).unlisted).toEqual(['a_tbl.dup_name', 'b_tbl.dup_name']);
      // 🔵 負對照:兩條都在白名單 ⇒ 空 ⇒ 證明它不是變成恆紅。
      expect(unlistedOrCheckKeys(mig, ['a_tbl.dup_name', 'b_tbl.dup_name']).unlisted).toEqual([]);
    });

    it('🔴 字串裡的 CHECK 不算, 而【真的】CHECK 仍然算得到(這兩格缺一不可)', () => {
      // ① 一段【在描述 CHECK 的字串】—— 這正是 2026-09-02 咬 `20260902210000` 那一次的形狀
      const ghost = "v_want := 'x ' || 'CHECK ((a = ''p'' AND b) OR (c <> ''q''))';";
      expect(checkBodies(ghost), '字串裡的 CHECK 不是一條 CHECK').toEqual([]);
      // ② 🔵 **負對照 —— 這一格擋的是「把剝離器寫成把所有東西都剝掉」**
      //    那種寫法在 ① 表現完美, 而它會讓整道守門變成恆綠。
      const real = "CREATE TABLE t (s text NOT NULL, x text NOT NULL,\n"
        + "  CONSTRAINT c1 CHECK ((s = 'p' AND x = '1') OR (s = 'q' AND x <> '1')));";
      const got = checkBodies(real);
      expect(got.length, '真的 CHECK 必須抓得到').toBe(1);
      expect(isNullShortCircuitShape(got[0]!.body), 'body 裡的字面值要留著 —— 形狀判斷靠的就是它').toBe(true);
      expect(constraintNameBefore(real, got[0]!.at)).toBe('c1');
      expect(enclosingTable(real, got[0]!.at)).toBe('t');
    });

    it('🔴 註解與字串會互相咬 —— 兩個方向各一個反例(所以不能做成兩個 pass)', () => {
      // 先剝註解 ⇒ 字串被切一半
      expect(checkBodies("INSERT INTO t VALUES ('a -- b'); -- 尾註解\n")).toEqual([]);
      // 先剝字串 ⇒ 那個 `'` 開啟假字串, 吃掉後面整段 ⇒ 真的 CHECK 會消失
      const s2 = "-- it's ok\nCREATE TABLE t (a text NOT NULL, CONSTRAINT c CHECK ((a = 'x' AND a) OR (a <> 'y')));";
      expect(checkBodies(s2).length, "註解裡的單引號不得吃掉後面的真 CHECK").toBe(1);
      // dollar-quoted 區塊裡的 CHECK 不算
      expect(checkBodies("DO $$ BEGIN RAISE NOTICE 'CHECK ((a = ''1'') OR (b <> ''2''))'; END $$;")).toEqual([]);
      // '' 轉義:字串沒有在中間結束
      expect(checkBodies("SELECT 'it''s CHECK ((a = ''1'') OR (b <> ''2''))';")).toEqual([]);
    });

    it('🔴 位移保持:剝完的長度必須與原字串【逐字相同】(否則三支函式的座標系會分岔)', () => {
      for (const { file, sql } of migrations) {
        expect(normalizeSqlForTest(sql).length, file).toBe(sql.length);
        expect(normalizeSqlForTest(sql, { strings: false }).length, file).toBe(sql.length);
      }
    });

    it('enclosingTable 的四種寫法都歸得到表, 而歸不到時回 null(不是猜一個)', () => {
      const cases: [string, string | null][] = [
        ["CREATE TABLE foo (x text CHECK (x = 'a' OR x = 'b'));", 'foo'],
        ['CREATE TABLE IF NOT EXISTS public.foo (', 'foo'],
        ['ALTER TABLE ONLY "public" . "foo" ADD CONSTRAINT c CHECK (true);', 'foo'],
        ['SELECT 1;', null],
      ];
      for (const [sql, want] of cases) {
        expect(enclosingTable(sql, sql.length), sql).toBe(want);
      }
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

    it('🔴 字串裡的 `--` 不得吃掉後面的真碼(codex 2026-09-02 抓的洞, 2026-09-03 收)', () => {
      // 舊的刪除式剝註解會從字串裡的 `--` 抹到行尾 ⇒ 後面那句 ALTER 整句消失 ⇒ 回 `[]` 而全綠。
      // 🔴 這一格的判別力在於它是【漏報】方向:錯的時候沒有人會看到紅。
      expect(
        dropNotNullTargets("SELECT 'x -- y'; ALTER TABLE shipments ALTER COLUMN carrier_code DROP NOT NULL;"),
      ).toEqual([{ table: 'shipments', column: 'carrier_code' }]);
      // 🔵 而反方向也要釘住:`strings:false` 是刻意的 —— 動態 SQL【字串裡】的那一句仍要抓得到。
      //    有人把它改成 `strings:true`(字串抹白)⇒ 這一格會紅, 而那正是我們要的訊號。
      expect(
        dropNotNullTargets("EXECUTE 'ALTER TABLE shipments ALTER COLUMN carrier_code DROP NOT NULL';"),
      ).toEqual([{ table: 'shipments', column: 'carrier_code' }]);
      // 🔴 R3 抓:上面那格是**頂層** `EXECUTE`, 它**走不到** dollar-quote 的遞迴分支
      //    —— 而動態 DDL 的真實住所就是 PL/pgSQL 本體。把同一句包進去再釘一次。
      //    (突變 `recurse(…, { strings: true })` ⇒ 只有這一格會紅。)
      expect(
        dropNotNullTargets("DO $$ BEGIN EXECUTE 'ALTER TABLE shipments ALTER COLUMN carrier_code DROP NOT NULL'; END $$;"),
      ).toEqual([{ table: 'shipments', column: 'carrier_code' }]);
    });

    it('🔴 dollar 資料裡的 OR / COALESCE 不得被讀成【邏輯】(2026-09-03 過剝方向的實測結果)', () => {
      // 🛑 我一度在檔頭寫「`$$` 當純資料字面會過剝 ⇒ 方向是假綠」—— **抄來的, 沒構造。**
      //   構造之後方向是**反的**:過剝拿掉的只可能是【資料】, 而這支尺讀的四個訊號全是【邏輯】,
      //   邏輯住在 dollar 本體【外面】⇒ 拿掉資料只會讓**誤報**變少。
      // ✅ 這兩格是那次構造的常駐版(用真的 `checkBodies` + `isNullShortCircuitShape`,
      //   不是我當時那支會過期的一次性腳本)。真值由人判, 寫在每一格旁邊。
      const judge = (sql: string) => checkBodies(sql).map(({ body }) => isNullShortCircuitShape(body));

      // 真值 = false:邏輯只有一個 `<>` 比較, 那個 `OR` 在【資料】裡。
      //   🔴 沒有遞迴的話這格會是 true(誤報)—— 方向是假紅, 有人看得到。
      expect(judge("ALTER TABLE t ADD CONSTRAINT c CHECK (body <> $$q -- OR body = 'z'$$);")).toEqual([false]);

      // 真值 = true:那個 COALESCE 在【資料】裡, 不是真兜底 ⇒ 這條 CHECK 仍是壞形狀。
      //   🔴 沒有遞迴的話這格會是 false —— **那一格才是真的假綠**, 而它在舊版就存在。
      expect(
        judge("ALTER TABLE t ADD CONSTRAINT c CHECK (kind = 'a' OR kind = 'b' AND note <> $$z -- COALESCE$$);"),
      ).toEqual([true]);

      // ✅ 正對照(照 `scripts/two-controls.sh`:先證明尺在該有時會說有)——
      //    一條貨真價實的壞形狀, 這支尺必須說 true。它印 false ⇒ 上面兩個斷言全部失去判別力。
      expect(judge("ALTER TABLE t ADD CONSTRAINT c CHECK (kind = 'a' OR kind = 'b');")).toEqual([true]);
      // 🔵 負對照:沒有 OR ⇒ 必須 false(擋「這支尺恆真」)。
      expect(judge("ALTER TABLE t ADD CONSTRAINT c CHECK (kind = 'a');")).toEqual([false]);
    });

    it('🔴 dollar-quote 的 tag 文法 —— 對照 PG 官方 §4.1.2.4 親讀的七條', () => {
      // 🔴🔴 **這一格是 ⟦b4-DOLLARGRAMMAR1⟧ 的落點**:我們手寫的狀態機 vs PG 定義的文法,
      //   差多少【沒有人查過】。2026-09-03 查官方文件逐條餵, 而**三個紙上分歧只有一個是真的**。
      //
      // 🛑 **第一發我的尺是壞的, 照實留**:我拿「輸出有沒有變」當「有沒有被當成 dollar-quote」的代理
      //   ⇒ 而 `-- y` 被當**頂層行註解**剝掉也會讓輸出變 ⇒ **兩個世界印同一件事**, 17 格裡有 2 格假分歧。
      //   ✅ 換成【在構造後面放一句真 DDL, 問它還在不在】才分得開。
      //   📌 **⇒ 又一次:代理指標量的是另一件事, 而它給的數字看起來完全合理。**
      const DDL = 'ALTER TABLE shipments ALTER COLUMN carrier_code DROP NOT NULL;';
      const swallowed = (prefix: string) => dropNotNullTargets(prefix + DDL).length === 0;

      // 🟢 正對照:裸 DDL 必須抓得到, 否則下面每一格都零判別力。
      expect(swallowed(''), '裸 DDL 都抓不到 ⇒ 這一格整個沒接上').toBe(false);

      // ② 官方:tag 跟未加引號識別字同規則 ⇒ **不得以數字開頭** ⇒ `$1$` 不是 tag(`$1` 是位置參數)。
      //    ⛔ 我原本在板上推測 ~~「我們接受 `$1$` ⇒ 會把後面的真 DDL 吞掉(漏報方向)」~~
      //    🔴 **實測:不會。** 我們雖然認得 `$1$`, 而它成對閉合 ⇒ 後面那句 DDL 仍在外面。
      //    ⇒ **紙上的分歧不等於行為上的分歧** —— 這一格就是釘住那個「不會吞」。
      expect(swallowed('SELECT $1$ a $1$; ')).toBe(false);
      expect(swallowed('SELECT $12$ a $12$; ')).toBe(false);
      expect(swallowed('SELECT $1 + 1; ')).toBe(false);
      // ⑥ 官方:dollar-quote 緊接在識別字後面時, 那個 `$` 屬於前一個識別字 ⇒ 不開字串。
      expect(swallowed('SELECT foo$$ a $$; ')).toBe(false);
      // ③ 官方:tag 大小寫敏感 ⇒ `$TAG$…$tag$` 不成對 ⇒ PG 會讀成未閉合(整段吃到檔尾)。
      //    🔵 而我們**不吞** ⇒ 那句 DDL 仍被報出來 ⇒ **誤報方向(有人看得到), 不是漏報。**
      //    🛑 這是刻意記下來的**已知分歧**, 不是宣稱我們與 PG 一致。
      expect(swallowed('SELECT $TAG$ a $tag$; ')).toBe(false);
      expect(swallowed('SELECT $$ a ; ')).toBe(false);

      // ⑦ 官方:tag 上限 = `NAMEDATALEN-1` = 63 bytes。
      //    🔴 **而這一格抓到一個真的 bug**:視窗原本是 `i + 64`, 而 `$`+63+`$` = 65
      //    ⇒ 實測邊界恰好落在 63 —— **合法上限本身那一格認不得**。已改成 `i + 66`。
      //    🧬 突變:把 66 改回 64 ⇒ 下面「63 字」那一發必須紅。
      const tagged = (n: number) => {
        const tag = '$' + 'a'.repeat(n) + '$';
        const out = normalizeSqlForTest('SELECT ' + tag + ' q -- ' + tag + '\nZZEND;', {
          strings: false,
        });
        return out.split(tag).length - 1 === 2;   // 開與閉都還在 = 被當成 dollar 本體
      };
      expect(tagged(1), 'tag 1 字認不得 ⇒ 這把尺沒接上').toBe(true);   // 🟢 正對照
      expect(tagged(62)).toBe(true);
      expect(tagged(63), 'PG 的合法上限就是 63 —— 認不得它等於漏掉最長的合法 tag').toBe(true);
      // 🔵 負對照:64 以上在 PG 已經不是合法識別字 ⇒ 不認得它是對的, 而這一格證明尺會分。
      expect(tagged(70)).toBe(false);
    });

    it('🔵 schema 限定寫法跨行/帶 tab 也要收斂成同一形狀', () => {
      // 🛑 這兩個形狀是 R1 對抗審查造出來的, 而它們當時打穿的是一個【我後來整個拿掉的修法】
      //    (窄化成 `/ ?\. ?/`)。現行 `/\s*\.\s*/` 兩種順序都對 ⇒ **這一格不再守順序**。
      //    ✅ 那它守什麼:守「跨行/tab 的 schema 前綴收斂」本身 —— 語料今天 0 支這樣寫,
      //       ⇒ 📌 **它是一發【今天沒有分母】的正對照, 而那正是它該存在的理由。**
      for (const sql of [
        'ALTER TABLE public.\tshipments ALTER COLUMN carrier_code DROP NOT NULL;',
        'ALTER TABLE public\n  .shipments ALTER COLUMN carrier_code DROP NOT NULL;',
        'ALTER TABLE "public" . "shipments" ALTER COLUMN carrier_code DROP NOT NULL;',
      ]) {
        expect(dropNotNullTargets(sql), sql).toEqual([{ table: 'shipments', column: 'carrier_code' }]);
      }
    });

    it('🔴 dollar-quote 本體【裡面】的註解也要剝(R2 審查逼出來的第三條路, 兩個方向各一格)', () => {
      // ② 漏報方向:註解裡的 `;` 會卡死那條 regex 的 `[^;]*?` ⇒ 承重的 NOT NULL 被拆掉而不紅。
      expect(
        dropNotNullTargets('DO $$ BEGIN ALTER TABLE t ALTER COLUMN c -- note; here\n DROP NOT NULL; END $$;'),
      ).toEqual([{ table: 't', column: 'c' }]);
      // ③ 誤報方向:**被註解掉的** DDL 不得被讀成真的。
      //    🔴 這一格是我 2026-09-03 中途版本【新造】的錯,舊版沒有 —— 留著,不要拿掉。
      expect(
        dropNotNullTargets('DO $$ BEGIN\n  -- ALTER TABLE t ALTER COLUMN c DROP NOT NULL;\nEND $$;'),
      ).toEqual([]);
      // 🔵 而遞迴不得破壞【長度保持】—— `checkBodies` 的兩把座標尺全靠它。
      //    🛑 **這一格是【定位提示】, 不是覆蓋** —— R3 實測:區塊註解 / `E'` 分支的加字突變
      //      只被下面那格(對全 275 支跑同樣兩個宣稱)殺得死, **沒有任何突變是這一格獨力殺得死的**。
      //      ⇒ 留著的理由只有一個:它紅的時候會把人指向 `recurse()` 而不是 `checkBodies()`。
      const sql = "DO $$ BEGIN -- x\n  PERFORM 'a -- b'; END $$; SELECT 1;";
      expect(normalizeSqlForTest(sql, { strings: false })).toHaveLength(sql.length);
      expect(normalizeSqlForTest(sql, { strings: true })).toHaveLength(sql.length);
    });
  });
});
