/**
 * D1a4 / D1a5:cohort 還原腳本產生器。**D1c 刪掉之後,這是唯一把 26 張訂單救回來的路徑。**
 *
 * 與 D1a1 同構:本程式不連資料庫、不寫檔案,把 psql 指令印到 stdout。
 *
 * 🔴 **用法禁止用管線接 psql**(codex R1-P2):zsh 預設 `pipefail` 關閉 ⇒ 產生器若在吐出
 * SQL 前就失敗(例如 `d1-cohort.ts` 的 import 期守門拋錯),psql 讀到空輸入、照樣 exit 0,
 * 整條命令「成功」而其實一列都沒還原。改走 repo 既有的「產生新檔 → 驗證 → 才用」紀律:
 *   npx tsx scripts/d1-restore.ts pre production <備份解壓目錄> > /tmp/d1-restore.sql \
 *     && test -s /tmp/d1-restore.sql \
 *     && psql "$D1_DB_URL" -f /tmp/d1-restore.sql
 *
 * 兩個版本(規格 §8.4 步驟 4):
 * - `pre`  = `restore-pre-n3c.sql`:N3c 收窗**之前**還原。舊格式單號仍合法,原號直接寫回。
 * - `post` = `restore-post-n3c.sql`:N3c **之後**還原。`display_id` 的 CHECK 已收緊成新格式
 *   only,26 張舊號會被 CHECK 擋住 ⇒ `display_id ← D1a3 預產的新號`、
 *   `legacy_display_id ← 原舊號`(與留存 3 張同一模式)。
 *
 * 🔴 兩版**唯一的差別是改號段落**,其餘逐字相同 —— 刻意做成同一條路徑,
 *    避免「演練過 pre、真正要用的是 post」這種只有災難當下才會發現的分歧。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { SUPABASE_ROOT_CA_2021 } from '../packages/adapters/src/payment/supabase-ca';
import { D1_DELETE_COHORT, D1_RETAIN_COHORT } from './d1-cohort';
import { buildCohortSelectors } from './d1-export';
import { buildD1PgConfig, PRODUCTION_CLUSTER_ID, PRODUCTION_PROJECT_REF } from './d1-guard';

export type RestoreMode = 'pre-n3c' | 'post-n3c';

/** 還原目標。**兩個值都會被守門釘死**,不是註解、不是慣例。 */
export type RestoreTarget = 'production' | 'rehearsal';

const DELETE_IDS = D1_DELETE_COHORT.map(({ id }) => `'${id}'`).join(', ');


/**
 * D1a2 匯出當下對 production 實查的 **26 張口徑**筆數(規格步驟 9/10 逐字寫的
 * 24 / 36 / 2 與實查完全吻合 = 三來源律的兩個獨立來源)。
 *
 * 🔴 為什麼非要有絕對筆數不可(codex R1-P1):逐欄比對(下方 EXCEPT)在**備份檔被截斷成
 * 只剩表頭**時兩邊都空、完全通過 —— 那正是「還原成功的假象」最典型的長相。
 * 只有寫死的期望值抓得到「檔案本身不完整」。
 *
 * 🔴 過期條件:這批是已結案舊單、不會再變動;若 assert 紅了,代表備份與現網真的漂移過,
 * **那時該停下來查,不是改這裡的數字**。
 */
const EXPECTED_ROWS: Readonly<Record<string, number>> = {
  customers: 2,
  customer_addresses: 3,
  products: 9,
  product_variants: 9,
  legal_terms_versions: 2,
  orders: 26,
  order_items: 36,
  order_legal_consents: 2,
  payment_charge_attempts: 24,
  pending_invoices: 0,
  email_outbox: 0,
  order_refunds: 0,
  order_refund_items: 0,
  payment_double_charge_anomalies: 0,
  payment_double_charge_anomaly_events: 0,
};

/**
 * BEFORE INSERT trigger,**無條件覆寫** `shipping_method_at_checkout := shipping_method`。
 *
 * 🔴 它會讓還原不忠實:備份裡的快照值若與 `shipping_method` 不同(Sean 改過運送方式的單就是
 * 這種),寫回去會被改成當下的 `shipping_method`。trigger 自己的註解逐字預告了這件事 ——
 * 「未來若要匯入『歷史訂單』且其真實快照 != shipping_method,本 trigger 會覆蓋掉;屆時匯入
 * 流程必須改走專用路徑或**暫時停用本 trigger**,不要靠改這裡」。本腳本走的就是它指定的那條路:
 * 同一交易內停用 → 寫回 → 立刻復原,並在交易內 assert「已復原」與「快照值與備份逐列相同」。
 * (2026-07-29 對 production `pg_get_triggerdef` 實查;十張表只有這一個會改寫寫入值。)
 */
const SNAPSHOT_TRIGGER = 'orders_freeze_shipping_snapshot_bi';

/**
 * 三道守門:
 * ①身分:D1a0 的身分守門只在 D1c 那次交易內生效,保護不了日後獨立執行的還原(規格 R21)。
 * ②cohort **不存在**反向 assert:還原的前提是「已經刪了」。D1a0 的「29 張都在」在 D1c 之後
 *   恆為假、不能沿用;方向必須反過來 —— 26 張只要還有任何一張在,就代表還沒刪、或已經還原過
 *   一次,兩種情況都不該再插一次。
 * ③目標叢集:**兩個方向都釘死**。
 *
 * 🔴 ③原本被我整條拿掉,理由是「D1a6/D1a7 演練跑在隔離 DB,釘死 production 叢集會讓演練的
 * 腳本與真要用的腳本不是同一支」。codex R1-P1 指出那個取捨留下了更糟的洞:`$D1_DB_URL` 若
 * 還指著演練用的 clone,身分與「已刪」兩道**全部會通過**,clone 上 COMMIT、畫面印成功,
 * 而 production 依然是空的 —— 災難當下最不該發生的事。
 *
 * ⇒ 正解不是二選一:產生器吃 `target`,production 版 assert「必須是 production 叢集」、
 * 演練版 assert「**必須不是** production 叢集」。同一支腳本、同一條路徑,兩個方向都有閘;
 * 演練照跑,而且演練版本身也不可能誤傷 production。
 */
const buildGuardSql = (target: RestoreTarget) => `DO $$
DECLARE
  v_present integer;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'D1:還原必須以 postgres 執行(實 %);拒繼續', current_user;
  END IF;

  IF session_user <> 'postgres' THEN
    RAISE EXCEPTION 'D1:登入身分必須是 postgres(實 %);拒繼續', session_user;
  END IF;

${
  target === 'production'
    ? `  IF (SELECT system_identifier FROM pg_control_system()) <> ${PRODUCTION_CLUSTER_ID} THEN
    RAISE EXCEPTION 'D1:本腳本是 production 版,但連到的不是 production 叢集;拒繼續';
  END IF;`
    : `  IF (SELECT system_identifier FROM pg_control_system()) = ${PRODUCTION_CLUSTER_ID} THEN
    RAISE EXCEPTION 'D1:本腳本是演練版,不得對 production 執行;拒繼續';
  END IF;`
}

  SELECT count(*) INTO v_present FROM public.orders WHERE id IN (${DELETE_IDS});

  IF v_present <> 0 THEN
    RAISE EXCEPTION 'D1:26 張待還原訂單中已有 % 張存在於本庫;還原前提是「已刪」,拒繼續', v_present;
  END IF;
END $$;`;

/**
 * post-n3c 改號段。
 *
 * 🔴 **凍結的映射會過期**:D1a3 在第 1 批就把 26 組新號寫死,但 post-n3c 是 N3b 換產號器
 * **之後**才用得到 —— 那段期間現網會隨機長出 6 碼新單號,可能正好撞上凍結的值。
 * ⇒ 執行當下逐列重驗,撞到就依 §5.4a 重產(上限 5 次),用盡即整筆交易 RAISE、人工處理。
 *
 * 🔴 重產**呼叫 `public.pcm_generate_display_id()`,不在本檔自寫第二套產號器** ——
 * §5.4a 的取樣法(rejection sampling、禁 `% 28` 全範圍取模)寫錯不會有症狀,只會讓號碼
 * 分佈有偏差。同一個合約在 repo 裡有兩份實作 = 遲早只有一份是對的。
 * 該函式由 N3a 建立;post-n3c 依定義跑在 N3c 之後 ⇒ 必然存在,不存在就是環境不對、當場中止。
 */
const REMAP_SQL = `CREATE TEMP TABLE d1r_remap(old_display_id text PRIMARY KEY, new_display_id text NOT NULL UNIQUE);

INSERT INTO d1r_remap(old_display_id, new_display_id) VALUES
${D1_DELETE_COHORT.map(({ displayId, restoreDisplayId }) => `  ('${displayId}', '${restoreDisplayId}')`).join(',\n')};

DO $$
DECLARE
  r record;
  v_candidate text;
  v_try integer;
BEGIN
  IF to_regprocedure('public.pcm_generate_display_id()') IS NULL THEN
    RAISE EXCEPTION 'D1:找不到 public.pcm_generate_display_id()(N3a 建立)—— post-n3c 還原必須用 §5.4a 的同一個產號器;拒繼續';
  END IF;

  FOR r IN SELECT old_display_id, new_display_id FROM d1r_remap LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.orders o
       WHERE o.display_id = r.new_display_id OR o.legacy_display_id = r.new_display_id);

    v_candidate := NULL;

    FOR v_try IN 1..5 LOOP
      EXECUTE 'SELECT public.pcm_generate_display_id()' INTO v_candidate;

      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.orders o
                             WHERE o.display_id = v_candidate OR o.legacy_display_id = v_candidate)
            AND NOT EXISTS (SELECT 1 FROM d1r_remap m WHERE m.new_display_id = v_candidate);

      v_candidate := NULL;
    END LOOP;

    IF v_candidate IS NULL THEN
      RAISE EXCEPTION 'D1:% 的還原新號與現網碰撞,依 §5.4a 重產 5 次仍撞;拒繼續(需人工介入)', r.old_display_id;
    END IF;

    UPDATE d1r_remap SET new_display_id = v_candidate WHERE old_display_id = r.old_display_id;
    RAISE NOTICE 'D1:% 的還原新號由 % 改為 %', r.old_display_id, r.new_display_id, v_candidate;
  END LOOP;
END $$;

UPDATE d1r_orders t
   SET legacy_display_id = t.display_id,
       display_id = m.new_display_id
  FROM d1r_remap m
 WHERE t.display_id = m.old_display_id;

DO $$
DECLARE
  v_mapped integer;
BEGIN
  SELECT count(*) INTO v_mapped
    FROM d1r_orders t
    JOIN d1r_remap m ON t.legacy_display_id = m.old_display_id AND t.display_id = m.new_display_id;

  IF v_mapped <> 26 THEN
    RAISE EXCEPTION 'D1:改號後只有 % 張對得上映射(應 26);拒繼續', v_mapped;
  END IF;
END $$;`;

/**
 * trigger 停用這個動作的**負向檢查**:沒有它,「停用後忘了復原」會安靜留在庫裡,
 * 之後每一張新單的運送快照都不再被凍結,而且不會有任何症狀。
 *
 * 🔴 orders 的內容驗證改走與子表**同一套**逐列逐欄雙向比對(codex R2-P1):原本只驗
 * `shipping_method_at_checkout` 一欄 + 筆數,其他欄位被改寫不會發現,而且 `EXPECTED_ROWS.orders`
 * 定義了卻沒人用 —— 那本身就是「宣稱有驗、其實沒接上」。全欄比對把那一欄也一併蓋掉。
 */
const ORDERS_VERIFY_SQL = `DO $$
DECLARE
  v_state "char";
BEGIN
  SELECT tgenabled INTO v_state
    FROM pg_trigger
   WHERE tgrelid = 'public.orders'::regclass AND tgname = '${SNAPSHOT_TRIGGER}';

  IF v_state IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'D1:${SNAPSHOT_TRIGGER} 未回復啟用(實 %);拒繼續', v_state;
  END IF;
END $$;`;

/**
 * 相依表逐張驗:**筆數(絕對錨)+ 逐列逐欄雙向比對**。
 *
 * 🔴 codex R1-P1 抓到的原缺陷:原本只有 orders 有 assert。子表的 CSV 若被截斷、或 selector
 * 漏撈,`\copy` 與 `INSERT` 都會成功、COMMIT 也成功 —— 那 36 列品項、24 筆扣款紀錄就這樣
 * 安靜地沒回來,而畫面印的是「還原完成」。
 *
 * 兩道缺一不可:
 * - **筆數**抓「檔案不完整」(截斷成只剩表頭時,下面的比對兩邊都空、會全過)
 * - **雙向 EXCEPT ALL**抓「筆數對但內容錯」(欄位錯位、型別轉換弄髒值)。用 ALL 才是多重集
 *   相等;兩個方向都要,單向只證明「備份的都在」、證明不了「沒有多出不該有的列」。
 *
 * (實查確認十張表無 `json`/幾何等缺等號運算子的型別 ⇒ EXCEPT 對每張表都成立。)
 */
const buildChildVerifySql = (table: string, backupWhere: string, liveWhere: string) => `DO $$
DECLARE
  v_backup integer;
  v_live integer;
  v_diff integer;
BEGIN
  SELECT count(*) INTO v_backup FROM d1r_${table} WHERE ${backupWhere};

  IF v_backup <> ${EXPECTED_ROWS[table]} THEN
    RAISE EXCEPTION 'D1:${table} 備份只有 % 列(應 ${EXPECTED_ROWS[table]});備份檔可能不完整,拒繼續', v_backup;
  END IF;

  SELECT count(*) INTO v_live FROM public.${table} WHERE ${liveWhere};

  IF v_live <> ${EXPECTED_ROWS[table]} THEN
    RAISE EXCEPTION 'D1:${table} 還原後為 % 列(應 ${EXPECTED_ROWS[table]});拒繼續', v_live;
  END IF;

  SELECT count(*) INTO v_diff FROM (
    (SELECT * FROM d1r_${table} WHERE ${backupWhere}
     EXCEPT ALL
     SELECT * FROM public.${table} WHERE ${liveWhere})
    UNION ALL
    (SELECT * FROM public.${table} WHERE ${liveWhere}
     EXCEPT ALL
     SELECT * FROM d1r_${table} WHERE ${backupWhere})
  ) AS d;

  IF v_diff <> 0 THEN
    RAISE EXCEPTION 'D1:${table} 有 % 列與備份逐欄不符;拒繼續', v_diff;
  END IF;
END $$;`;

/**
 * 父表寫回:**只補缺的、不覆蓋現值**(`ON CONFLICT DO NOTHING`)。
 *
 * 🔴 為什麼不逐欄比對:父列若還在,現網的值是**當下的真相**(商品改過價、地址改過門牌),
 * 拿 180 天前的備份去比必然不同 —— 那不是缺陷。這裡要驗的只有一件事:
 * **26 張訂單指到的父列,還原後全都在**。少一列,orders 的 INSERT 就會違反 FK。
 *
 * 🔴 **兩側都用 d1r 版 selector**(Fable R3-F1,BLOCKER)。原本 live 側沿用子表的模板、
 * 查 `public.orders` —— 但父表補齊時 cohort 的 orders **還沒寫回、而且早被 D1c 刪光**,
 * 子查詢恆空 ⇒ `v_live = 0` ⇒ 第一張父表就 RAISE,四種組合全部跑不完。
 * 子表沒事是因為它們排在 orders 寫回**之後**;父表必須在之前(FK),模板的前提就不成立了。
 * 正確語意 = 「`d1r_orders` 指到的那些父列,`public` 側全都在」⇒ 外層表換 public、
 * 子查詢維持 d1r。
 * (codex 兩輪 + 32 條突變測試都沒抓到 —— 測試只讀腳本文字,這條藏在參數選擇裡。)
 */
const buildParentSql = (table: string, backupWhere: string, liveWhere: string) => [
  `INSERT INTO public.${table} SELECT * FROM d1r_${table} WHERE ${backupWhere} ON CONFLICT DO NOTHING;`,
  `DO $$
DECLARE
  v_backup integer;
  v_live integer;
BEGIN
  SELECT count(*) INTO v_backup FROM d1r_${table} WHERE ${backupWhere};

  IF v_backup <> ${EXPECTED_ROWS[table]} THEN
    RAISE EXCEPTION 'D1:${table} 備份只有 % 列(應 ${EXPECTED_ROWS[table]});備份檔可能不完整,拒繼續', v_backup;
  END IF;

  SELECT count(*) INTO v_live FROM public.${table} WHERE ${liveWhere};

  IF v_live <> ${EXPECTED_ROWS[table]} THEN
    RAISE EXCEPTION 'D1:${table} 補齊後為 % 列(應 ${EXPECTED_ROWS[table]});拒繼續', v_live;
  END IF;
END $$;`,
];

/** 父表 = cohort 指向的東西,不是 cohort 的一部分;順序即 FK 家長優先。 */
const PARENT_TABLES = [
  'customers',
  'customer_addresses',
  'products',
  'product_variants',
  'legal_terms_versions',
] as const;

/**
 * D1a6/D1a7 演練前置:在**演練庫**補上帳號替身。
 *
 * 為什麼需要:`customers.user_id → auth.users` 是 FK,而 `auth.users` **刻意不備份**
 * (Sean 2026-07-29 拍板 Q3=A:含密碼雜湊)。演練庫是全新的 branch、`auth.users` 空的,
 * 少了它連第一張父表都插不進去。
 *
 * 🔴 這正是那條殘餘風險在演練場上的具體長相 —— 演練需要替身,恰好也證明了
 * 「客人自刪帳號則該筆救不回」不是紙上推論。
 *
 * 🔴 **只塞 `id`,不塞任何個資**:`auth.users` 的 NOT NULL 欄只有 `id`
 * (`is_sso_user`/`is_anonymous` 皆有預設值,2026-07-29 實查)。
 * UUID 也**不寫死在 repo**,從備份的 `customers.csv` 當場讀 —— 少一個會漂移的清單。
 *
 * 🔴 守門沿用 `buildGuardSql('rehearsal')`:連到 production 就中止。
 */
export function buildRehearsalSeedScript(inDir: string): string {
  return [
    '\\echo D1a6 演練前置:補 auth.users 替身(只塞 id、無個資)',
    '\\set ON_ERROR_STOP on',
    'BEGIN;',
    buildGuardSql('rehearsal'),
    'CREATE TEMP TABLE d1s_customers (LIKE public.customers);',
    `\\copy d1s_customers FROM '${inDir}/customers.csv' WITH (FORMAT csv, HEADER MATCH, NULL '\\N')`,
    'INSERT INTO auth.users (id) SELECT user_id FROM d1s_customers ON CONFLICT DO NOTHING;',
    `DO $$
DECLARE
  v_seeded integer;
BEGIN
  SELECT count(*) INTO v_seeded
    FROM auth.users u
   WHERE u.id IN (SELECT user_id FROM d1s_customers);

  IF v_seeded <> ${EXPECTED_ROWS.customers} THEN
    RAISE EXCEPTION 'D1:替身帳號應有 ${EXPECTED_ROWS.customers} 筆,實際 % 筆;拒繼續', v_seeded;
  END IF;
END $$;`,
    'COMMIT;',
    '\\echo 替身帳號已就緒,可以跑還原演練。',
  ].join('\n');
}

export function buildRestoreScript(
  mode: RestoreMode,
  target: RestoreTarget,
  inDir: string,
): string {
  const cohortIds = D1_DELETE_COHORT.map(({ id }) => id);
  const tables = buildCohortSelectors(cohortIds, (table) => `d1r_${table}`);
  // 同一組 selector 的 public 版,只給還原後的比對用。
  const liveWhere = new Map(
    buildCohortSelectors(cohortIds, (table) => `public.${table}`).map(([table, where]) => [
      table,
      where,
    ]),
  );
  const where = new Map(tables);
  const children = tables
    .map(([table]) => table)
    .filter((table) => table !== 'orders' && !PARENT_TABLES.includes(table as never));

  // 🔴 **整道 \copy 必須擠在一行**(psql 的 \copy 是客戶端 meta-command、不跨行;
  //    2026-07-29 匯出首次實跑被這件事擋下)。
  // 🔴 `HEADER MATCH`(PG 16+;production 實查 17.6):逐欄比對 CSV 表頭與目標欄位名。
  //    備份要保存 180 天,期間 schema 極可能改;沒有它的話,中間插一欄會讓資料整排錯位
  //    **靜默寫入**——還原「成功」了,內容全錯。
  const load = (table: string) => [
    `\\echo -- ${table}`,
    `CREATE TEMP TABLE d1r_${table} (LIKE public.${table});`,
    `\\copy d1r_${table} FROM '${inDir}/${table}.csv' WITH (FORMAT csv, HEADER MATCH, NULL '\\N')`,
  ];

  return [
    `\\echo D1${mode === 'pre-n3c' ? 'a4' : 'a5'} 還原(${mode}):26 張訂單 / ${tables.length} 張表`,
    // 錯誤即停。不靠操作者記得下 -v ON_ERROR_STOP=1 —— 忘了的話,交易中途出錯後
    // 後續語句照跑、最後那句 COMMIT 才變成 ROLLBACK,畫面上卻是一片「成功」。
    '\\set ON_ERROR_STOP on',
    'BEGIN;',
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL statement_timeout = '60s';",
    buildGuardSql(target),
    // 🔴 **全部先載入,才開始寫回**。父表的 selector 要查 `d1r_orders` / `d1r_order_items`,
    //    而父表必須先於 orders 寫回(FK)⇒ 載入與寫回不能交錯,否則順序無解。
    '\\echo == 載入備份 ==',
    ...tables.flatMap(([table]) => load(table)),
    // 備份的 orders.csv 含 29 張(26 待刪 + 3 留存)。留存的 3 張還在庫裡,
    // 重插會撞主鍵、整批還原失敗 ⇒ 先修剪成 26 張。id 是主鍵、不可能為 NULL,NOT IN 安全。
    // 🔴 修剪必須在父表寫回**之前**:父表 selector 查的是 d1r_orders,沒修剪就會把
    //    留存 3 張的父列也算進去,筆數 assert 當場對不上。
    `DELETE FROM d1r_orders WHERE id NOT IN (${DELETE_IDS});`,
    '\\echo == 補齊父表(只補缺的,不覆蓋現值)==',
    // 🔴 live 側刻意也傳 d1r 版(見 buildParentSql 註解):父表補齊時 public.orders 還是空的。
    ...PARENT_TABLES.flatMap((table) => buildParentSql(table, where.get(table)!, where.get(table)!)),
    '\\echo == 寫回 orders ==',
    // 🔴 停 trigger 刻意排在改號**之前**(codex R1-P2):`ALTER TABLE` 取的是 ACCESS EXCLUSIVE,
    //    先取鎖等於把 orders 對外封住。否則改號段驗完碰撞、到 INSERT 之間還有窗口,
    //    現網(N3b 之後)新結帳的單可以搶走剛驗過的號 ⇒ 插入時噴 unique_violation,
    //    而規格承諾的是「碰撞就重產 5 次」,不是當場炸掉。
    `ALTER TABLE public.orders DISABLE TRIGGER ${SNAPSHOT_TRIGGER};`,
    ...(mode === 'post-n3c' ? [REMAP_SQL] : []),
    'INSERT INTO public.orders SELECT * FROM d1r_orders;',
    `ALTER TABLE public.orders ENABLE TRIGGER ${SNAPSHOT_TRIGGER};`,
    ORDERS_VERIFY_SQL,
    buildChildVerifySql('orders', where.get('orders')!, liveWhere.get('orders')!),
    '\\echo == 寫回相依資料 ==',
    ...children.flatMap((table) => [
      `INSERT INTO public.${table} SELECT * FROM d1r_${table} WHERE ${where.get(table)!};`,
      buildChildVerifySql(table, where.get(table)!, liveWhere.get(table)!),
    ]),
    'COMMIT;',
    '\\echo 還原完成:26 張訂單與相依資料已寫回。',
  ].join('\n');
}

/**
 * 執行前的兩道 preflight(codex R2-P1 ×2)。**這兩件事 SQL 端做不到,只能在這裡做。**
 *
 * ①**連線目標**:交易內的 `system_identifier` 擋不掉實體快照 —— `pg_basebackup` 或
 *   storage snapshot 複製出來的 clone 會**原樣保留同一個識別碼**(d1-guard.ts 早已寫下這件事)。
 *   真正能分辨的只有連線字串本身,而 psql 端的 SQL 看不到自己連去哪。
 * ②**備份檔身分**:`EXCEPT ALL` 是拿載入的暫存表跟「由它插入的資料」互比 —— **自我比對、恆真**。
 *   它證明 INSERT 沒漏,**證明不了這包備份就是那 26 張的那一份**。指錯目錄照樣全綠。
 *   ⇒ 必須核對 manifest 的 cohort 範圍與來源叢集(checksum 由 wrapper 的 `shasum -c` 驗)。
 *
 * 🔴 連線字串**從環境變數讀、不走 argv**:argv 會出現在 `ps` 的輸出裡,而它含密碼。
 */
/**
 * 🔴 裸 `split(',')` 會在任何一個欄位含半形逗號時整列位移(Fable R3-F9):
 * psql 匯出時會替那種值加上雙引號,而位移後的 cluster 檢查會誤殺 —— fail-closed,
 * 但當天會多出一個查不出原因的謎。八行的引號感知切法就沒有這個問題。
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (quoted && ch === '"' && line[i + 1] === '"') {
      field += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);

  return fields;
}

export function preflight(target: RestoreTarget, inDir: string): void {
  const url = process.env.D1_DB_URL;

  if (!url) throw new Error('D1:缺 D1_DB_URL(不要用命令列參數傳,密碼會出現在 ps)');

  // 🔴 Fable R3-F5:`buildD1PgConfig` 的離散欄位保護**只保護 pg 客戶端**,而真正動資料的是
  //    `psql "$D1_DB_URL"` —— libpq 會吃 `?host=` / `?hostaddr=` 把連線導去別處,驗過的
  //    那份 config 根本沒參與。既然 psql 路徑用不到離散欄位,就從源頭拒收帶參數的 URL。
  if (new URL(url).search !== '') {
    throw new Error('D1:連線字串不得帶 query string(psql 會讓 ?host=/?sslmode= 覆蓋掉守門);拒繼續');
  }

  if (target === 'production') {
    buildD1PgConfig(url); // 不符 production pooler / project ref 即拋錯,訊息不含密碼
  } else if (url.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error('D1:演練模式的連線字串指向 production 專案;拒繼續');
  }

  // 🔴 Fable R3-F3:現存的 07-29 早上那包只有十一份 CSV(父表是後來才加的)。
  //    preflight 若只讀 manifest,拿舊包會一路走到交易中段才炸 —— 而父列若已被刪就永久救不回。
  //    ⇒ 進交易之前先確認十五張表 + manifest 全部在場。
  const required = [
    ...buildCohortSelectors([], () => '').map(([table]) => `${table}.csv`),
    'cohort-manifest.csv',
  ];
  const missing = required.filter((file) => !existsSync(`${inDir}/${file}`));

  if (missing.length > 0) {
    throw new Error(
      `D1:備份缺 ${missing.length} 份檔案(${missing.join('、')});這包不是十五表版的完整備份,拒繼續`,
    );
  }

  const rows = readFileSync(`${inDir}/cohort-manifest.csv`, 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map(splitCsvLine);

  const pick = (membership: string) =>
    rows.filter((r) => r[2] === membership).map((r) => r[0]).sort();
  const expect = (list: readonly { displayId: string }[]) =>
    list.map(({ displayId }) => displayId).sort();

  if (pick('delete').join() !== expect(D1_DELETE_COHORT).join()) {
    throw new Error('D1:manifest 的待刪名單與 d1-cohort.ts 不符;這包備份不是那 26 張,拒繼續');
  }

  if (pick('retain').join() !== expect(D1_RETAIN_COHORT).join()) {
    throw new Error('D1:manifest 的留存名單與 d1-cohort.ts 不符;拒繼續');
  }

  const clusters = new Set(rows.map((r) => r[6]));

  if (clusters.size !== 1) {
    throw new Error('D1:manifest 內含多個來源叢集;這包備份被混過,拒繼續');
  }

  const [cluster] = clusters;

  if (target === 'production' && cluster !== PRODUCTION_CLUSTER_ID) {
    throw new Error(`D1:備份來源叢集不是 production(實 ${cluster});拒繼續`);
  }

  console.error(`preflight 通過:連線目標=${target}、備份 cohort 26+3 相符、來源叢集=${cluster}`);
}

if (process.argv[1]?.endsWith('d1-restore.ts')) {
  const [, , mode, target, inDir] = process.argv;

  if (mode === '--preflight' && (target === 'production' || target === 'rehearsal') && inDir) {
    preflight(target, inDir);
    process.exit(0);
  }

  // 🔴 Fable R3-F5:psql 走 libpq,拿不到 buildD1PgConfig 裡那個 ssl 物件;URL 又不准帶
  //    sslmode(preflight 已拒)⇒ libpq 預設 `prefer` = **完全不驗憑證**。
  //    D1a0 拍板的 verify-full 在真正動資料的那條路上必須也成立 ⇒ 把同一份 CA 寫成檔案,
  //    由 wrapper 以 PGSSLROOTCERT / PGSSLMODE 餵給 psql。
  if (mode === '--seed-rehearsal' && target) {
    console.log(buildRehearsalSeedScript(target));
    process.exit(0);
  }

  if (mode === '--write-ca' && target) {
    writeFileSync(target, SUPABASE_ROOT_CA_2021, { mode: 0o600 });
    process.exit(0);
  }

  if (
    (mode !== 'pre' && mode !== 'post') ||
    (target !== 'production' && target !== 'rehearsal') ||
    !inDir
  ) {
    console.error(
      '用法:npx tsx scripts/d1-restore.ts pre|post production|rehearsal <備份解壓目錄> > /tmp/d1-restore.sql',
    );
    console.error('🔴 產出後必須 `test -s` 驗非空,再 `psql -f`;不要用管線直接接 psql。');
    process.exit(1);
  }

  console.log(buildRestoreScript(mode === 'pre' ? 'pre-n3c' : 'post-n3c', target, inDir));
}
