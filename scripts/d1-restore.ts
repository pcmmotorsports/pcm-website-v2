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

/**
 * 還原留痕(2026-08-29 線D)。**本片之前這支腳本零留痕** —— 跑完會有 26 張訂單 +
 * 2 個客戶出現在正式庫,而沒有任何一筆紀錄說是誰、什麼時候、為什麼。
 *
 * 🔴 **記的是 `session_user`,不是自填的 actor**:自填的那一格記的是「有人自稱做了這件事」,
 *    而 `session_user` 是 **DB 自己講的**,偽造不了(`SET ROLE` 改得動 `current_user`、
 *    改不動 `session_user` —— 所以兩個都記,兩者不一致本身就是證據)。
 *    ⚠️ `request_id` 是**關聯 id 不是防偽章**,不要讀成驗證。
 *
 * 🔴🔴 **`mode` 從【資料】判,不從 session 狀態判**(codex R4 must-fix):
 *    ~~原本:看 `pg_temp.d1r_remap` 這張 TEMP TABLE 在不在~~ **已作廢** ——
 *    TEMP TABLE 綁 session,而 **rehearsal 那條路沒有禁 transaction pooler**
 *    (`buildD1PgConfig` 只在 `target === 'production'` 時跑)
 *    ⇒ `COMMIT` 後換 backend ⇒ `to_regclass` 回 NULL ⇒ **安靜把 post 記成 pre**。
 *    📌 而「安靜判錯」比「報錯」難發現一個量級 —— 一般斷線會報錯,換 backend 不會。
 *    ✅ 改看【還原出來的那 26 張單有沒有 `legacy_display_id`】—— 那是 post 才會寫的,
 *       而它是**資料庫裡的事實**,換 backend、斷線重連都不受影響。
 *    ⚠️ 而它**只讀不寫**那一欄 ⇒ 「pre 版不改號」那條守門因此從
 *       「字串不出現」收窄成「不出現 `SET legacy_display_id`」(見 test 檔那段註解)。
 *
 * 🔴🔴 **它跑在 `COMMIT` 之【後】,而那是三輪對抗審查逼出來的**(R3 2026-08-29):
 *    ~~原設計:放在交易【內】,用 PL/pgSQL 的 `EXCEPTION` 區塊做 fail-open~~ **已作廢** ——
 *    R1 抓到 `WHEN OTHERS` 抓不到 `query_canceled`;R2 抓到具名去抓它會【吞掉操作者的 Ctrl-C】;
 *    R3 抓到為了避開逾時而 `SET LOCAL statement_timeout = 0` 開了一個【無限卡死】的窗
 *    (撞鎖時整個還原交易掛住)。
 *    📌 **三輪咬同一塊碼 ⇒ 那不是修得不夠仔細,是【那塊碼不該在那裡】。**
 *    ✅ 移出交易之後,上面三條**一起消失** —— 而消失的原因是**那塊碼不見了**,不是被修好。
 *
 *    **移出來為什麼不損失任何東西**:
 *    · 原子性 —— fail-open 本來就沒買到原子性 ⇒ post-COMMIT 沒有「有紀錄而無還原」的世界
 *      (還原先落地,留痕才跑)。
 *    · 可見度 —— `\set ON_ERROR_STOP on` 之下,這一段落敗會讓 psql `rc≠0`
 *      ⇒ **看得見**,比一行沒人看的 `WARNING` 好。
 *    ⚠️ **而 `rc≠0` 的代價要一起講**:還原【已經成功】而退出碼非零,災難當下容易被讀成
 *      「還原失敗」⇒ 想重跑。⇒ 呼叫端在它之前印一行 `\echo` 講清楚它在講哪一段。
 *      (重跑不會二次破壞:`INSERT INTO public.orders` 沒有 `ON CONFLICT` ⇒ 撞主鍵直接失敗。)
 *
 * ⚠️ `source_app='ops'` 需要 `20260829190000_*` 已 apply;沒 apply ⇒ CHECK 擋下
 *    ⇒ **這一段失敗,而還原早已 COMMIT ⇒ 資料是安全的,只是沒留痕**(psql 會 `rc≠0`)。
 *
 * 🔴🔴 **這段 SQL 在四個版本(pre/post × production/rehearsal)【逐字相同】—— 那是被守門釘住的**
 *    (`d1-restore.test.ts:142` 與 `:334`:兩版只能差守門那段與改號那塊)。
 *    ⚠️ **我第一版把 `mode` 與 `target` 寫成字面內插,那兩條測試當場紅** ——
 *       而它們紅得對:檔頭逐字寫著「兩版**唯一的差別是改號段落**…避免『演練過 pre、
 *       真正要用的是 post』這種只有災難當下才會發現的分歧」。
 *    ✅ **改法是根因不是繞過**:那兩個值改成**執行期由 DB 自己講**——
 *       · `cluster_id` = `pg_control_system()` ⇒ 比一個宣稱 'production' 的字面**更可信**
 *       · ~~`mode` = 看 `pg_temp.d1r_remap` 在不在~~ **已作廢兩次,不要再發明回來**:
 *         R4 指出它綁 session(pooler 換 backend 會安靜判錯),R5 指出改看資料之後
 *         `EXISTS` 仍然分不出「真 pre」與「post 被並行清空」⇒ **它一直是個【推論】。**
 *         ✅ 現在記的是 `sample_display_id` —— **一個抄下來的事實**,讀的人從單號格式
 *         自己看得出 pre 還是 post,而且看得到那張單現在的號。
 *         📌 **與其把推論做得更準,不如記下那個推論想指向的事實。**
 *         ⚠️ **而它是 NULL 的話,那本身是一個訊號**:代表 cohort 第一張單
 *            **不在 `public.orders` 裡** —— 而在一次成功的還原之後那是不可能的
 *            (還原自己有逐列逐欄比對與筆數斷言)。
 *            ⇒ 所以看到 NULL,要去查的是【還原】不是【留痕】。
 *            (2026-08-29 實測:拋棄式庫沒有那張單 ⇒ 它就印 NULL,而 INSERT 照樣成功。)
 *         ⚠️ **這一格與 `REMAP_SQL` 的表名耦合** —— 改名那張表,這裡會安靜地永遠回 'pre-n3c'
 *    📌 **⇒ 一個為了「記錄得更完整」而內插的字面,破壞了一個比它重要的不變式。**
 */
/** 操作人姓名 —— Sean 2026-08-29 拍甲(他在【知道它可以被填假的】之下選的)。
 *
 * 🔴 **`D1_OPERATOR` 是操作者自己打的字 —— 它是【線索】不是【憑據】。**
 *    偽造不了的那一格是 DB 自己記的 `session_user`,而 guard 強制它是 `postgres`
 *    ⇒ **所以那一欄對每一筆都一樣** ⇒ 這一欄是唯一能區分「這次是誰跑的」的東西,
 *    而它區分得出來的前提是【填的人誠實】。
 * ⚠️ 所以它**進 `after` 的 JSON**,**不覆蓋 `actor`** ——
 *    `actor` 的語意已經寫死成 `session_user`;兩個混在一起,
 *    下一個人會以為 `actor` 是驗證過的。
 */
function operatorFromEnv(): string {
  const raw = process.env.D1_OPERATOR ?? '';
  const v = raw.trim();
  // 🔴🔴 **判準是「有沒有【真的字】」,不是「有沒有不可見字元」**(codex R5 must-fix)。
  //    ⚠️ ~~上一版:拒 `\p{Cc}\p{Cf}` + 要求 `replace(/[\p{C}\p{Z}]/gu,'') !== ''`~~
  //       **那是黑名單偽裝成白名單,而它【兩個方向都錯】**:
  //       · 該擋沒擋:`U+034F`(combining grapheme joiner)、variation selector、
  //         `U+3164`(諺文填充)⇒ 它們不在 C/Z 類 ⇒ 過,而看起來是空白。
  //       · 該過擋了:波斯文等合法姓名可能需要 ZWNJ / ZWJ(`\p{Cf}`)⇒ 被我拒掉。
  //    ✅ 真白名單:**至少要有一個字母或數字**。其他東西(空白、標點、ZWNJ)
  //       可以在名字【裡面】,只要它不是整個名字。
  //    📌 **「不是不可見類」是黑名單;「是字母或數字」才是白名單。**
  // 🔴 而 `\p{L}` **不等於「畫得出來」** —— 諺文填充那一小塊(U+115F / U+1160 /
  //    U+3164 / U+FFA0)在 Unicode 裡是 **Lo(其他字母)**,而它們**渲染成空白**。
  //    ⇒ 實測:`/[\p{L}\p{N}]/u.test('\u3164')` ⇒ **true** ⇒ 光靠上面那條會過。
  //    ⇒ 所以這裡把那一小塊【具名剔除】再判。
  const visible = v.replace(/[\u115F\u1160\u3164\uFFA0]/g, '');
  if (!/[\p{L}\p{N}]/u.test(visible)) {
    throw new Error(
      'D1_OPERATOR 裡沒有任何字母或數字 —— 請填這次實際操作的人的名字' +
        '(只有空白 / 零寬字元 / 標點 / 填充字元不算)。',
    );
  }
  // 🛑🛑 **射程(明寫,而它不是疏漏)**:**沒有任何 Unicode 類別規則能表達「看得見」** ——
  //    「可見」是**渲染**的性質,不是字元的性質。上面那一小塊是**已知**的空白字母,
  //    而 Unicode 每個版本都可能加入新的。
  //    ⇒ **射程是【三分】不是二分**(codex 2026-08-29 R6 指正:我原本把中間那一塊歸錯邊):
  //      ① **誤填**(空白 / tab / 零寬 / 標點 / 那四個填充字母)⇒ **擋得住**。
  //      ② **誤貼**(合法姓名遇到缺字型;或不小心貼到希臘 / 西里爾 / 數學字母等易混字元)
  //         ⇒ 🔴 **擋不住,而它【不是惡意】** —— 它是意外,而這道閘看不到它。
  //         ⇒ 而後果是:稽核上那個名字看起來對,而它不是那個人的名字。
  //      ③ **惡意**(刻意找一個畫不出來的字母)⇒ 擋不住,而惡意的人本來就改得動這支腳本本身。
  //    📌 **⇒ 我原本寫「擋誤填不擋惡意」,而那句話把整個②吃掉了** ——
  //       二分法會讓中間那一塊【無處可歸】,而它是最可能真的發生的那一塊。
  if (!v) {
    // 🔴 這道閘的價值在【它在任何破壞性動作之前就停】—— 對稱於 wrapper 的 `D1_DB_URL`。
    //    而 wrapper 也擋一次:兩道都在,因為檔頭明寫「可以直接跑產生器」那條路。
    throw new Error(
      '缺 D1_OPERATOR:請設成【這次實際操作的人】的名字(export D1_OPERATOR=\'你的名字\')。' +
        '它會寫進稽核的 after 欄,而它是自填的線索不是憑據。',
    );
  }
  return v;
}

/** 留痕落地【之後】的一致性閘 —— 而它刻意排在 audit 的 COMMIT 後面。
 *
 * 🔴 為什麼(codex 確認輪 must-fix):上一版只把核對結果【存起來】,
 *    而「存起來」與「有人會看」是兩件事 —— 不一致時腳本照樣 COMMIT、rc=0、一聲不吭。
 * ✅ 而它排在 audit COMMIT 之後,所以【那筆紀錄先保住】——
 *    在最需要有紀錄的那一刻(狀態不對),我們不會因為要報警而把紀錄一起丟掉。
 * 📌 順序就是這一格的全部:先落地,再叫。
 *
 * ⚠️ psql 的 \gset + \if 對 boolean 的行為是【量過的】,不是假設的
 *    (2026-08-29 實測:false 走 else、true 走 if,而 RAISE 讓 psql rc=3)。
 */
const AUDIT_VERDICT_SQL = `\\if :d1_mismatch
\\echo 🔴🔴 留痕記到【要求的版本與資料對不上】—— 而還原本身已經 COMMIT,資料在。
\\echo    照 docs/runbooks/2026-07-29-d1-restore.md 的 4-a 那節排查,不要重跑。
DO $$
BEGIN
  RAISE EXCEPTION 'D1:requested_mode 與這批單的實際狀態不一致;還原【已經 COMMIT】,照 runbook 4-a 查,不要重跑';
END $$;
\\endif`;

const buildAuditSql = (operator: string) => `BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
INSERT INTO public.admin_audit_log
  (actor, action, target, after, reason, request_id, source_app)
VALUES (
  session_user,
  'ops.d1.restore',
  'restore:d1-cohort',
  jsonb_build_object(
    'db_session_user', session_user,
    'db_current_user', current_user,
    'operator_self_reported', '${operator.replace(/'/g, "''")}',
    -- 🔴🔴 **requested_mode 由【wrapper 在呼叫 psql 時給】,不是產生器內插的**
    --    (主視窗 2026-08-29 指出的第三條路,而它比我原本的兩難好):
    --    · 四個版本的 SQL 文字裡寫的都是同一個佔位符 ⇒ **「兩版逐字相同」那個不變式不破**。
    --    · 而值來自 d1-restore.sh -v d1_mode=… ⇒ **另一個來源**。
    --    📌 **⇒ 那才叫交叉核對**:requested_mode = wrapper 說它要跑什麼;
    --       sample_display_id = 資料上實際發生什麼。兩者【不同源】。
    --    🔴 而若把 mode 內插進 SQL(我原本以為的唯一做法)⇒ 值與版本來自【同一個產生器】
    --       ⇒ 它們永遠一致 ⇒ **那個「核對」是恆真的,證不了任何事。**
    --    ✅ 缺值 ⇒ psql 語法錯 ⇒ rc=3(2026-08-29 實測,**不是**安靜變空字串)。
    --    ⚠️ **它記的值是 pre / post(操作者在命令列打的那個字),不是 pre-n3c / post-n3c**
    --       —— wrapper 把同一個 $MODE 同時餵給產生器與 psql,而【轉換發生在產生器裡】。
    --       🔴 而這是刻意的:要在 wrapper 裡也轉一次的話,那份映射就有【兩份】,
    --          而它們漂掉的那天沒有任何東西會紅。
    --       ⇒ 對照表:pre ⇒ 舊格式單號(PCM-2026-0001)/ post ⇒ 六碼新號(例 A1B2C3)。
    'requested_mode', :'d1_mode',
    -- 🔴 **把交叉核對的【結果】也記進去**(codex R7 must-fix):
    --    原本只記兩個值,而「它們對不對得上」要人事後自己看 ⇒ 沒有任何訊號。
    --    這一欄把那個判斷【當場算完存下來】,讓事後查詢一眼看得到。
    --    ⚠️ 判準用【資料】不用單號格式:post ⇒ 那 26 張都該有 legacy_display_id;
    --       pre ⇒ 都不該有。(格式會改,而這個關係不會。)
    --    🔴🔴 **而它要【逐個模式明寫】,不能寫成「兩邊相等」**(codex 確認輪 must-fix):
    --       我第一版寫 (:'d1_mode' = 'post') = (改號數 = 26)
    --       ⇒ pre 模式遇到【部分改號或缺單】(例如 13/26)時,左邊 false、右邊也 false
    --       ⇒ 兩個 false 相等 ⇒ **它記成 true** —— 一個壞掉的世界被記成一致。
    --       📌 「兩個都不對」與「兩個都對」在等號底下長得一樣。
    --    ✅ 而總數也要驗(count(*) = 26)—— 少單時上面那個 FILTER 一樣會給出漂亮的數字。
    --    ✅ 而未知的 mode ⇒ false(不是「不知道所以算它過」)。
    'mode_matches_data', (
      SELECT CASE :'d1_mode'
               WHEN 'post' THEN count(*) = 26
                             AND count(*) FILTER (WHERE legacy_display_id IS NOT NULL) = 26
               WHEN 'pre'  THEN count(*) = 26
                             AND count(*) FILTER (WHERE legacy_display_id IS NOT NULL) = 0
               ELSE false
             END
        FROM public.orders WHERE id IN (${DELETE_IDS})
    ),
    'cluster_id', (SELECT system_identifier FROM pg_control_system())::text,
    'sample_display_id', (SELECT display_id FROM public.orders WHERE id = '${D1_DELETE_COHORT[0]!.id}'),
    'expected_rows', '${JSON.stringify(EXPECTED_ROWS).replace(/'/g, "''")}'::jsonb
  ),
  'D1 災難還原:cohort 26 張訂單與相依資料寫回',
  gen_random_uuid()::text,
  'ops'
)
RETURNING NOT (after->>'mode_matches_data')::boolean AS d1_mismatch \\gset
COMMIT;`;

/** 父表 = cohort 指向的東西,不是 cohort 的一部分;順序即 FK 家長優先。 */
const PARENT_TABLES = [
  'customers',
  'customer_addresses',
  'products',
  'product_variants',
  'legal_terms_versions',
] as const;

/**
 * 還原**完成之後**、在一個**全新連線**裡重數一次。
 *
 * 🔴 這不是重複勞動:腳本內的驗證跑在同一筆交易裡,證明的是「這筆交易看得到」;
 * 這一段跑在交易結束之後,證明的是「**真的 COMMIT 了、別人也看得到**」。
 * 兩者失效方式不同 —— 前者對「交易其實被 rollback 掉」完全沒有感覺。
 */
export function buildRestoredVerifySql(): string {
  const live = buildCohortSelectors(
    D1_DELETE_COHORT.map(({ id }) => id),
    (table) => `public.${table}`,
  );

  return `DO $$
DECLARE
  v_count integer;
BEGIN
${live
  .map(
    ([table, where]) => `  SELECT count(*) INTO v_count FROM public.${table} WHERE ${where};
  IF v_count <> ${EXPECTED_ROWS[table]} THEN
    RAISE EXCEPTION 'D1:還原後重數 ${table} = % 列(應 ${EXPECTED_ROWS[table]});拒繼續', v_count;
  END IF;`,
  )
  .join('\n\n')}

  RAISE NOTICE 'D1:十五張表在新連線下重數全部相符。';
END $$;`;
}

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

/**
 * 還原前的欄位【集合】比對 —— `HEADER MATCH` 的替身。
 *
 * 🔴 兩個方向要分開處置,理由相反:
 *   · CSV 有而表沒有 ⇒ **擋**。備份與 schema 不同源, 再往下走沒有意義。
 *   · 表有而 CSV 沒有 ⇒ **列出來給人看, 然後放行**。舊備份【必然】少欄, 那是正常的
 *     —— 自動擋掉它, 等於在災難當天把唯一的備份判死。
 *
 * 📌 判準:**災難當天, 那個人要看得見【他還原回來的東西少了什麼】。**
 *    這一格擋的不是「多欄少欄」, 是**「少了而沒有人知道」** ——
 *    少一個【可空】的欄不會違反任何 constraint, 它會安靜地整欄變 NULL,
 *    而還原「成功」了。那是「整排錯位靜默寫入」的近親。
 */
export function buildColumnSetCheckSql(table: string, csvCols: readonly string[]): string {
  const arr = csvCols.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ');

  return [
    'DO $d1cols$',
    'DECLARE extra text; missing text; shuffled text;',
    'BEGIN',
    `  SELECT string_agg(c, ', ' ORDER BY c) INTO extra FROM unnest(ARRAY[${arr}]) AS c`,
    '   WHERE c NOT IN (SELECT column_name FROM information_schema.columns',
    `                    WHERE table_schema = 'public' AND table_name = '${table}');`,
    '  IF extra IS NOT NULL THEN',
    `    RAISE EXCEPTION '🔴 ${table}: 備份有而目標表沒有的欄位: % —— 這包備份與現在的 schema 不同源, 拒繼續', extra;`,
    '  END IF;',
    "  SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO missing",
    '    FROM information_schema.columns',
    `   WHERE table_schema = 'public' AND table_name = '${table}'`,
    `     AND column_name <> ALL (ARRAY[${arr}]);`,
    // 🔴🔴 **保序檢查 —— 這一格是 2026-08-29 codex 抓的,而它抓的是我【拿掉的東西】。**
    //    我原本寫「顯式欄名之下順序不重要」,而**那句話只在【表頭與資料列一起重排】時成立**。
    //    危險的世界是**表頭單獨錯位**:欄名集合一模一樣、資料列不動 ⇒ 值寫進錯的欄。
    //    實測(同一份 CSV,只交換兩個表頭欄名):
    //      舊 HEADER MATCH ⇒ ERROR: column name mismatch in header line field 13
    //      我的集合比對    ⇒ COPY 1, 而且印「✅ 欄位集合與備份完全相同」← **假的安心訊號**
    //    📌 **我跑的那發突變, 從來沒有造出我宣稱排除掉的那個世界。**
    //    ✅ 而修法**不是**退回 `HEADER MATCH`(那樣舊備份還是還原不回來):
    //       要求 CSV 欄名依序是表欄位順序的**保序子序列** ——
    //       合法的舊備份是「後來的欄還沒出生」⇒ 相對順序不變 ⇒ 過;
    //       被重排過的表頭 ⇒ 相對順序被打亂 ⇒ 擋。
    "  SELECT string_agg(x.name, ' → ' ORDER BY x.ord) INTO shuffled",
    '    FROM (SELECT c.name, c.ord, ic.ordinal_position AS pos,',
    '                 lag(ic.ordinal_position) OVER (ORDER BY c.ord) AS prev',
    `            FROM unnest(ARRAY[${arr}]) WITH ORDINALITY AS c(name, ord)`,
    '            JOIN information_schema.columns ic',
    `              ON ic.table_schema = 'public' AND ic.table_name = '${table}'`,
    '             AND ic.column_name = c.name) x',
    '   WHERE x.prev IS NOT NULL AND x.pos < x.prev;',
    '  IF shuffled IS NOT NULL THEN',
    `    RAISE EXCEPTION '🔴 ${table}: 備份表頭的欄位【順序被打亂】(在這幾欄之後倒退: %) —— 合法的舊備份只會【少後來才有的欄】, 相對順序不會變。表頭單獨錯位會讓值寫進錯的欄, 拒繼續', shuffled;`,
    '  END IF;',
    '  IF missing IS NOT NULL THEN',
    // ⚠️ 訊息字面要準(codex 抓的):**不是每一個缺欄都「走 DEFAULT」** ——
    //    有 DEFAULT ⇒ 走 DEFAULT;可空而無 DEFAULT ⇒ 整欄 NULL;NOT NULL 而無 DEFAULT ⇒ `\copy` 直接失敗。
    `    RAISE NOTICE '⚠️ ${table}: 備份【沒有】這些欄(有 DEFAULT 的走 DEFAULT / 可空的整欄變 NULL / NOT NULL 的下一步會直接失敗): %', missing;`,
    '  ELSE',
    `    RAISE NOTICE '✅ ${table}: 欄位集合與備份完全相同, 沒有欄位走 DEFAULT';`,
    '  END IF;',
    'END',
    '$d1cols$;',
  ].join('\n');
}

/**
 * 讀每一份備份 CSV 的表頭。**讀不到就 throw** —— 不回 `undefined`。
 *
 * 🔴 理由:`buildRestoreScript` 收到 `undefined` 會**靜靜退回 `HEADER MATCH` 舊路徑**,
 *    而舊備份走那條會斷。**fail-open 的病不是「退回舊路」, 是【退回時沒有聲音】。**
 *    (同族:`.husky` 那道閘壞掉時自動放行。)
 */
export function readCsvHeaders(inDir: string, tables: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();

  for (const table of tables) {
    const path = `${inDir}/${table}.csv`;

    if (!existsSync(path)) throw new Error(`D1:讀不到備份表頭 —— ${path} 不存在;拒繼續`);

    const first = readFileSync(path, 'utf8').split('\n')[0]?.trim() ?? '';

    if (first === '') throw new Error(`D1:${path} 的第一行是空的(不是表頭);拒繼續`);

    const cols = splitCsvLine(first);

    if (cols.length === 0 || cols.some((c) => c === '')) {
      throw new Error(`D1:${path} 的表頭有空欄名(讀到 ${cols.length} 欄);拒繼續`);
    }

    out.set(table, cols);
  }

  return out;
}

export function buildRestoreScript(
  mode: RestoreMode,
  target: RestoreTarget,
  inDir: string,
  headers?: ReadonlyMap<string, string[]>,
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
  // 🔴 兩條路,而**災難當天的人必須看得出自己在哪一條**(2026-08-29,`#958`)。
  //    背景:B1(`20260828100000`)給 orders 加了兩欄 ⇒ 39 欄。而 180 天內的既有備份是 37 欄。
  //    `HEADER MATCH` 逐欄比對表頭 ⇒ **當場失敗**(實測逐字):
  //      ERROR: wrong number of fields in header line: got 37, expected 39
  //    負對照(同形同序的 39 欄 CSV)⇒ `COPY 1` ⇒ 兩個世界印不同的東西,那一發驗得到。
  //    ⚠️ 而 `HEADER MATCH` **是對的** —— 它擋的是「整排錯位靜默寫入」。它不是被弄壞的,
  //       是**照設計吵出來的**;缺的是【被觸發那天】的程序,不是那道閘。
  const load = (table: string) => {
    const cols = headers?.get(table);

    if (!cols) {
      // 舊路徑:保留給既有測試(`d1-restore.test.ts` 把 DIR 釘成一個空路徑 ⇒ 產腳本不得碰檔案系統)。
      // 🔴 而它**不是**「一樣安全的另一個選項」—— 舊備份走這條會斷。所以它要**自己說出來**:
      //    fail-open 的病不是「退回舊路」,是【退回時沒有聲音】。
      return [
        `\\echo -- ${table}`,
        `\\echo 🔴 ${table}: 走的是 HEADER MATCH 舊路徑(沒有拿到 CSV 表頭)—— 欄數不合會直接失敗`,
        `CREATE TEMP TABLE d1r_${table} (LIKE public.${table});`,
        `\\copy d1r_${table} FROM '${inDir}/${table}.csv' WITH (FORMAT csv, HEADER MATCH, NULL '\\N')`,
      ];
    }

    // 新路徑:顯式欄位清單。
    // 🔴 `INCLUDING DEFAULTS` 少不得 —— `LIKE` 帶 `NOT NULL` 而**不帶 `DEFAULT`**
    //    ⇒ 沒有它,`tax_total` 這種「NOT NULL DEFAULT 0」的新欄會變成【必填而沒人填】,
    //      實測逐字 `ERROR: null value in column "tax_total" … violates not-null constraint`。
    //    📌 這一格是我推的、不是量的,實跑才發現。
    // ⛔🔴🔴 ~~欄名帶著值走 ⇒ CSV 的欄位順序不重要;不要為此加一道「順序必須相同」的閘;
    //    保護不是「還要擋」, 是「不再需要擋」。~~ **2026-08-29 全部作廢(codex 對抗審查抓的)。**
    //    那句話**只在【表頭與資料列一起重排】時成立**。而危險的世界是**表頭單獨錯位**:
    //    欄名集合一模一樣、資料列不動 ⇒ 值寫進錯的欄。實測同一份 CSV 只換兩個表頭欄名:
    //      舊 `HEADER MATCH` ⇒ `ERROR: column name mismatch in header line field 13`
    //      我的集合比對      ⇒ `COPY 1`, 而且印「✅ 欄位集合與備份完全相同」← **假的安心訊號**
    //    🔴 **我當時跑的那發突變, 把表頭與資料一起換了 —— 它從來沒有造出我宣稱排除掉的那個世界。**
    //    ⇒ 保序檢查(見 `buildColumnSetCheckSql`)把那道保護補了回來, **而它不是退回 HEADER MATCH**:
    //      要求「保序子序列」⇒ 舊備份(只少後來才有的欄)過, 被重排過的表頭擋。
    //    ⚠️ 代價明寫:**表頭與資料【一起】重排的合法檔也會被擋** —— 我們分不出它與錯位檔。
    //       ⇒ 這是刻意選的:災難當天,「誤擋一個罕見的合法檔」比「安靜寫進錯的欄」便宜。
    const list = cols.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');

    return [
      `\\echo -- ${table}`,
      `CREATE TEMP TABLE d1r_${table} (LIKE public.${table} INCLUDING DEFAULTS);`,
      // 欄位集合比對。這才是 `HEADER MATCH` 的替身 —— 它比的是**集合**,不是位置。
      buildColumnSetCheckSql(table, cols),
      `\\copy d1r_${table} (${list}) FROM '${inDir}/${table}.csv' WITH (FORMAT csv, HEADER, NULL '\\N')`,
    ];
  };

  return [
    `\\echo D1${mode === 'pre-n3c' ? 'a4' : 'a5'} 還原(${mode}):26 張訂單 / ${tables.length} 張表`,
    // 錯誤即停。不靠操作者記得下 -v ON_ERROR_STOP=1 —— 忘了的話,交易中途出錯後
    // 後續語句照跑、最後那句 COMMIT 才變成 ROLLBACK,畫面上卻是一片「成功」。
    '\\set ON_ERROR_STOP on',
    // 🔴 **釘住它,不要依賴預設**(codex R4 must-fix):我原本的分析是
    //    「反斜線安全,因為 `standard_conforming_strings` 預設 on」——
    //    📌 **結論對,而理由是一個我沒有驗過的前提。**設成 `off` 時反斜線加引號
    //    破壞得了字串邊界,而我們把使用者自填的 `D1_OPERATOR` 寫進一個字串常數。
    "SET standard_conforming_strings = on;",
    'BEGIN;',
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL statement_timeout = '60s';",
    buildGuardSql(target),
    // 🔴🔴 **確認 public.orders 有 legacy_display_id**(線D 2026-08-29)。
    //    ⚠️ ~~原本的理由是「留痕靠它判 mode」~~ **那個理由已作廢**(R5 之後留痕改記
    //    `sample_display_id`,不再推論 mode)。**而這道斷言留著,因為它的真正理由更硬**:
    //    🔴 **post-n3c 模式的還原【自己】要寫那一欄**(`REMAP_SQL` 的
    //       `SET legacy_display_id = t.display_id`,再 `INSERT INTO public.orders`)
    //       ⇒ 沒有那一欄,post 模式的還原【本身】就跑不完。
    //    ✅ 而放在這裡(交易內、寫入之前)⇒ 訊息說得出缺的是哪一支 migration,
    //       而不是在中段拋一個 column 不存在的錯。
    //    📌 **⇒ 一道守門的理由變了,而它仍然該留 —— 那時要改的是【註解】不是【碼】。**
    //    ⚠️ 而它不是假設:那一欄由 `20260729010000_..._display_id_expand.sql` 加,
    //       而**那支在乾淨 PG 上會失敗**(`#907`)⇒ 一個「schema 看起來對」的演練環境
    //       可能就是缺這一欄的那種。
    `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.orders'::regclass
       AND attname = 'legacy_display_id'
       AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'D1:public.orders 缺 legacy_display_id ⇒ post 模式的還原寫不進去;拒繼續(缺的是 20260729010000 那支 migration)';
  END IF;
END $$;`,
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
    // 🔴🔴 **留痕在 COMMIT【之後】,而它是獨立語句**(R3 2026-08-29;這是 plan 層改法)。
    //    ⚠️ 前兩輪對抗審查(R1 MF1 / R2 MF1)都咬在同一塊碼上 —— 那塊碼是交易【之內】的
    //    fail-open handler。**三次咬同一處,代表那塊碼不該在那裡,不是我修得不夠好。**
    //    移出來之後,下面這些問題【一起消失】,不是被修好:
    //      · `WHEN OTHERS` 抓不到 `query_canceled` ⇒ 沒有 handler 了
    //      · 為了避開逾時而 `SET LOCAL statement_timeout = 0` ⇒ 沒有那個窗了
    //        (那一行本身開了一個【無限卡死】的可能:撞鎖時整個還原交易掛住)
    //      · WARNING 措辭要不要說「已完成」⇒ 此刻它【真的已經 COMMIT 了】
    //    🔴 而原子性【一格都沒損失】:fail-open 本來就沒買到原子性
    //       ⇒ post-COMMIT 沒有「有紀錄而無還原」那個世界(還原先落地)。
    //    ✅ 而落敗是 `rc≠0`(`ON_ERROR_STOP on`)⇒ **看得見**,比一行沒人看的 WARNING 好。
    //    ⚠️ **而 `rc≠0` 的代價要先講**:還原【已經成功】而退出碼非零 ⇒ 災難當下容易被讀成
    //       「還原失敗」⇒ 想重跑。所以下面那行 `\\echo` 先講清楚它在講哪一段。
    //       (重跑不會二次破壞:`INSERT INTO public.orders` 沒有 `ON CONFLICT` ⇒ 撞主鍵直接失敗。)
    '\\echo == 以下是留痕。還原【已經 COMMIT 完成】—— 這一段失敗不影響它,但請手動記錄。==',
    // 🔴🔴 **預設【當成不一致】,再讓那一筆 INSERT 的 RETURNING 覆蓋它**(codex R9 must-fix):
    //    ~~原本:留痕 COMMIT 之後再 SELECT 一次,ORDER BY created_at DESC LIMIT 1~~ **已作廢**,
    //    它有兩個洞:①同秒多筆 / 並行時可能撈到【別次】的紀錄
    //    🔴 ②查詢回【零列】時 psql 的 \\gset **不改變數** ⇒ 未定義值進 \\if
    //       ⇒ 它只印一句 warning 而當成 false ⇒ **rc=0 靜默放行** —— 那正是我要避開的 fail-open。
    //    ✅ 修法兩件一起:
    //       · 先 \\set 成 true ⇒ 任何「沒被覆蓋到」的世界都落在【會叫】那一邊
    //       · 而值改由那一筆 INSERT 自己的 RETURNING 給 ⇒ 拿的是【剛寫的那一列】,
    //         不是事後撈的某一列 ⇒ 並行與同秒多筆的問題一起消失。
    "\\set d1_mismatch true",
    // 🔴🔴 **留痕跑在【它自己的交易】裡** —— 而這是同一個病的第三次搬家
    //    (交易內 → 交易外 → 自己的交易),codex R4→R5 各推一步:
    //    · R4:COMMIT 會清掉交易內的 SET LOCAL ⇒ 移出去之後那筆留痕【沒有任何逾時】
    //      ⇒ 撞表鎖可無限等,而那時既沒有非零 rc 也沒有完成狀態。
    //    · R5:那我在交易外補兩個非 LOCAL 的 SET 呢? ⇒ **不行** —— 那是三個獨立的
    //      autocommit 語句,transaction pooler 下可以落到【三個不同的 backend】
    //      ⇒ SET 設在 A、INSERT 跑在 B ⇒ 它仍然沒有逾時。
    //    ✅ 正解:BEGIN…COMMIT 把它們綁成一個交易 ⇒ pooler 在交易期間綁住同一個 backend
    //       ⇒ **把「它會落在哪個 backend」從【運氣】變成【約束】**,而 SET LOCAL 的語意也回來了。
    buildAuditSql(operatorFromEnv()),
    AUDIT_VERDICT_SQL,
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
  if (mode === '--verify-restored') {
    console.log(buildRestoredVerifySql());
    process.exit(0);
  }

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

  // 🔴 表頭在**這裡**讀 —— `buildRestoreScript` 不碰檔案系統(既有測試把 DIR 釘成空路徑)。
  //    `readCsvHeaders` 讀不到就 throw ⇒ **不會安靜地退回 HEADER MATCH 舊路徑。**
  const headers = readCsvHeaders(
    inDir,
    buildCohortSelectors([], () => '').map(([table]) => table),
  );

  console.log(
    buildRestoreScript(mode === 'pre' ? 'pre-n3c' : 'post-n3c', target, inDir, headers),
  );
}
