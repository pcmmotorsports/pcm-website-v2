-- ============================================================
-- A7b-T + A7b-M · rollback(plan v7 §10「rollback 順序寫死」六步)
-- ============================================================
-- 🔴 **只允許在第一個 writer 出現之前使用**;之後只能 forward repair
--    (plan §10:列為第 3 批 worker 片的 DoD 硬前置)。
-- 🔴 本檔**自帶 BEGIN / COMMIT**(與 repo 既有 migration 同慣例,D0-1 = Sean 拍 A 維持現狀)。
-- 🔴🔴 **「整包包在外層交易裡跑就能模擬」是錯的**(關卡2 #17 更正本檔原本的說法):
--    檔內那個 `COMMIT;` 會把**外層交易一起提交** —— 這正是 A7 那次
--    「BEGIN → migration 全文 → RAISE 的模擬**會真的提交**」的事故形狀。
--    ⇒ 唯一正確的模擬方式 = **把檔內的 COMMIT 換成 ROLLBACK 再跑**
--      (`scripts/a7bt-acl-rollback-lock.sh` 第 2 段做的就是這件事,並在跑之前
--       斷言換過了、且檔內已無 `^COMMIT;$`)。
-- 🔴 步序不可調換:先 DROP parent 會被 child FK 擋
--    (`scripts/a7bt-acl-rollback-lock.sh` 第 2 段有**反向案例**:先 DROP parent 必須紅在 `2BP01`
--     —— 沒有那一格的話,「步序正確」只是「這個順序會成功」,不是「別的順序會失敗」)。
-- 🔴🔴 **ledger 已搬進本檔第 ⑦ 步**(關卡2 #23 推翻原本「留給人手動做」的設計):
--    本檔用 `psql -f` 直接灌、繞過 `supabase_migrations.schema_migrations`
--    ⇒ 不刪 ledger 的話那兩筆版本號仍記為「已套用」,`supabase db push` 不會重放、
--      表回不來,而且**沒有任何錯誤訊息**。這種漏做法太安靜,不能靠人記得。
--    ⇒ 第 ⑦ 步在同一筆交易內刪掉兩列;拋棄式 cluster 沒有 ledger 表時自動略過。
-- 🔴 用法(**兩把鑰匙**):
--    psql "$URL" -v i_know=DROP_A7B_M_AND_T -v db=<庫名> -v hostport=<host:port> \
--         [-v skip_text_scan=YES_I_CHECKED] [-v skip_ledger_count=YES_I_CHECKED] -f scripts/a7bt-rollback.sql
--    (ON_ERROR_STOP 由本檔自己 \set,不靠呼叫端記得)
-- 🔴 **本檔同時支援「M+T 都已套用」與「只有 M 套用」兩種狀態**(Fable R3 F6;正式站現況是後者)。
--    第 ③b 步自己判定,呼叫端不必也不應該指定 —— 判錯的方向一律 abort,不猜。
-- ============================================================

-- ══ ⓪ 身分閘(**這支檔案本身就是毀滅性 DDL,不能只靠呼叫端的閘**)════════════
-- 🔴 code-reviewer M6:第 ③ 步只驗「兩表為空」,而**上線前正式站兩表就是空的**
--    ⇒ 誤貼到 production 連線會安靜成功、DROP 掉兩張表。
--    ⇒ 必須顯式帶確認字串才跑:`psql … -v i_know=DROP_A7B_M_AND_T -f scripts/a7bt-rollback.sql`
-- 🔴 psql 變數**不會**在 dollar-quoted 區塊裡被展開 ⇒ 閘門必須寫在 `DO $$` 外面
--    (第一版寫在 DO 裡,實測 `syntax error at or near ":"`)。
-- 🔴🔴 **關卡2 #18:單一固定字串不是身分閘。** 那個字串會跟著 runbook 一起被複製貼上,
--    貼到哪個連線上它都成立 ⇒ 誤連 production 照樣放行。
--    ⇒ 第二把鑰匙 = **呼叫者必須自己講出目標資料庫名**,由本檔對 `current_database()` 核對。
--    兩把鑰匙的差別:第一把證明「我知道這會刪東西」,第二把證明「我知道我連在哪」。
--    ⇒ 另外把連線身分整組印出來(host / port / db / user),讓誤連在**日誌裡看得見**。
-- ⚠️ **這兩把鑰匙實際擋得住什麼(Fable R3 F9,誠實標註)**:第二把的錯誤訊息會**把正確答案
--    原樣印出來**(實際 database / host:port)⇒ 對一個已經連上 production 而不自知的人來說,
--    它只多花一次重跑。它是**防手滑的減速丘,不是授權控制** —— 真正的授權層是「誰拿得到
--    production 的連線字串」。刻意不改成不印:診斷價值高於那一次重跑的嚇阻價值,
--    但**不得**在任何地方把它記成「擋得住誤連 production」。
-- 🔴🔴 **關卡2 R2:沒有這一行,下面兩把鑰匙全部形同虛設。**
--    psql 預設遇到 SQL 錯誤會**繼續執行下一句** —— 實測輸出逐字:
--      不帶 ON_ERROR_STOP:「ERROR: 身分閘:擋下!」之後**下一句照樣執行**。
--    而下一句就是 DROP。⇒ 由本檔自己開啟,不依賴呼叫端記得加旗標
--    (呼叫端仍建議加,但那是縱深,不是唯一防線)。
\set ON_ERROR_STOP on

-- 🔴🔴 **BEGIN 必須在兩把鑰匙之前(Fable R3 F8)**:身分閘讀的是 `current_database()` /
--    `inet_server_addr()` / `inet_server_port()`,而正式站走 **Supavisor transaction pooling**
--    ⇒ 交易外的每一個 statement 都可能落在**不同的 backend**
--    ⇒ 「我驗過的那條連線」與「等一下跑 DROP 的那條連線」不保證是同一條 = 閘門可以被繞過而無人察覺。
--    ⇒ 把 BEGIN 提到最前面,兩把鑰匙與後面所有 DDL 綁在**同一筆交易 = 同一個 backend**。
--    驗法(正式站要用時):`SELECT pg_backend_pid()` 在檔頭與檔尾各印一次,兩者必須相同。
BEGIN;

\if :{?i_know}
\else
\set i_know '(未提供)'
\endif
\if :{?db}
\else
\set db '(未提供)'
\endif
SELECT (:'i_know' = 'DROP_A7B_M_AND_T') AS a7b_confirmed \gset
\if :a7b_confirmed
\else
DO $g$
BEGIN
  RAISE EXCEPTION
    'A7b rollback ⓪ 身分閘 — 未帶確認字串。本檔會 DROP order_refund_jobs / '
    'order_refund_job_items 兩張表與七支函式。確定要跑請加 '
    '-v i_know=DROP_A7B_M_AND_T -v db=<目標資料庫名>。';
END
$g$;
\endif

-- 🔴 **關卡2 R2 續**:只比資料庫名不夠 —— 測試庫與正式庫都可能叫 `postgres`。
--    ⇒ 第二把鑰匙改成「db 名 **且** host:port」都要對得上呼叫者自己宣告的值。
\if :{?hostport}
\else
\set hostport '(未提供)'
\endif
SELECT (:'db' = current_database())
       AND (:'hostport' = coalesce(host(inet_server_addr()), 'local') || ':' || coalesce(inet_server_port()::text, '?'))
       AS a7b_db_ok,
       coalesce(host(inet_server_addr()), 'local') || ':' || coalesce(inet_server_port()::text, '?') AS a7b_hp \gset
\if :a7b_db_ok
\else
DO $g$
BEGIN
  RAISE EXCEPTION
    'A7b rollback ⓪ 身分閘(第二把)— 你宣告的目標與實際連線不符。'
    '實際 database = %,實際 host:port = %。'
    '請確認你不是誤連 production,再以 -v db=<庫名> -v hostport=<host:port> 重跑。',
    current_database(),
    coalesce(host(inet_server_addr()), 'local') || ':' || coalesce(inet_server_port()::text, '?');
END
$g$;
\endif

DO $g$
BEGIN
  RAISE NOTICE 'A7B-RB|0|identity host=% port=% db=% user=%',
    coalesce(host(inet_server_addr()), '(local socket)'),
    coalesce(inet_server_port()::text, '(unknown)'),
    current_database(), current_user;
END
$g$;

-- 🔴 文字層掃描的明文 escape:psql 變數在 dollar-quote 內不會展開
--    ⇒ 先落成 GUC,DO block 內用 current_setting 讀(與 ⓪ 的閘門同一個限制)。
--    escape 存在的理由 = 記憶裡那條教訓「回滾守門會在唯一需要它的那天擋死自己」。
\if :{?skip_text_scan}
\else
\set skip_text_scan 'NO'
\endif


SELECT set_config('a7b.skip_text_scan', :'skip_text_scan', true) AS a7b_cfg \gset

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ══ ① pg_depend preflight(**在任何 DROP 之前**)════════════════════════════
-- 🔴 **必須給 filter,不能「非空即 abort」**(plan §10 F10):空表本來就有一大堆
--    **internal** 依賴 —— PK/UNIQUE 的 index、CHECK、FK、trigger、composite type、DEFAULT。
--    不 filter 會**永遠 abort**,那就等於沒有 preflight。
--    判定 = `deptype = 'n'`(normal)且**依賴方不屬於本片自己的物件集合**。
DO $$
DECLARE
  v_ext text;
  v_n   integer := 0;
BEGIN
  FOR v_ext IN
    SELECT format('%s#%s', d.classid::regclass::text, d.objid)
      FROM pg_depend d
     WHERE d.deptype = 'n'
       -- 🔴 refobjid 必須配 refclassid:OID 在不同目錄之間會重複(code-reviewer N4)
       AND ((d.refclassid = 'pg_class'::regclass AND d.refobjid IN (
               SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                  AND c.relname IN ('order_refund_jobs', 'order_refund_job_items')))
         OR (d.refclassid = 'pg_proc'::regclass AND d.refobjid IN (
               SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname LIKE 'pcm\_a7bt\_%'))
         -- 🔴🔴 **關卡2 #19:少了這一支 refclassid**。外部函式若以 `order_refund_jobs`
         --    這個**複合型別**當參數或回傳型別(`f(public.order_refund_jobs)`),
         --    pg_depend 記的是 refclassid=**pg_type**、refobjid=該 composite type 的 oid
         --    —— 完全不經過 pg_class 那一支 ⇒ 原本的 preflight 一路放行、DROP 之後那支函式壞掉。
         --    (下方的排除清單本來就有 pg_type,但那是排除「本片自己的 composite type 作為依賴方」,
         --     與這裡「composite type 作為**被依賴方**」是兩件事,不能互相取代。)
         OR (d.refclassid = 'pg_type'::regclass AND d.refobjid IN (
               SELECT t.oid FROM pg_type t JOIN pg_class c ON c.oid = t.typrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                  AND c.relname IN ('order_refund_jobs', 'order_refund_job_items'))))
       -- ↓↓ 本片自己的物件(= 允許的 internal 依賴),逐類列名 ↓↓
       AND NOT (d.classid = 'pg_constraint'::regclass AND EXISTS (
                  SELECT 1 FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
                   JOIN pg_namespace n2 ON n2.oid = c.relnamespace
                   WHERE k.oid = d.objid AND n2.nspname = 'public'
                     AND c.relname IN ('order_refund_jobs', 'order_refund_job_items')))
       AND NOT (d.classid = 'pg_class'::regclass AND EXISTS (
                  SELECT 1 FROM pg_class c JOIN pg_namespace n2 ON n2.oid = c.relnamespace
                   WHERE c.oid = d.objid AND n2.nspname = 'public'
                     AND (c.relname IN ('order_refund_jobs', 'order_refund_job_items')
                          OR EXISTS (SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid
                                      JOIN pg_namespace n3 ON n3.oid = t.relnamespace
                                      WHERE i.indexrelid = c.oid AND n3.nspname = 'public'
                                        AND t.relname IN ('order_refund_jobs', 'order_refund_job_items')))))
       AND NOT (d.classid = 'pg_type'::regclass AND EXISTS (
                  SELECT 1 FROM pg_type t JOIN pg_class c ON c.oid = t.typrelid
                   JOIN pg_namespace n2 ON n2.oid = c.relnamespace
                   WHERE t.oid = d.objid AND n2.nspname = 'public'
                     AND c.relname IN ('order_refund_jobs', 'order_refund_job_items')))
       AND NOT (d.classid = 'pg_attrdef'::regclass AND EXISTS (
                  SELECT 1 FROM pg_attrdef a JOIN pg_class c ON c.oid = a.adrelid
                   JOIN pg_namespace n2 ON n2.oid = c.relnamespace
                   WHERE a.oid = d.objid AND n2.nspname = 'public'
                     AND c.relname IN ('order_refund_jobs', 'order_refund_job_items')))
       AND NOT (d.classid = 'pg_trigger'::regclass AND EXISTS (
                  SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
                   JOIN pg_namespace n2 ON n2.oid = c.relnamespace
                   WHERE g.oid = d.objid AND n2.nspname = 'public'
                     AND (c.relname IN ('order_refund_jobs', 'order_refund_job_items')
                          -- 🔴 本片的第 11 支掛在 A7-t 的取消明細表上（關卡2 R2 #5）。
                          --    它依賴 pcm_a7bt_assert_job_consistent ⇒ 不列進來的話
                          --    preflight 會把**本片自己的 trigger** 當成外部依賴而永遠 abort
                          --    （實測:首跑就是「有 1 個外部物件依賴本片」）。
                          --    範圍鎖死在 a7bt_ 前綴 + 那一張表，不放寬到整個 schema。
                          OR (c.relname = 'order_cancellation_items'
                              AND g.tgname LIKE 'a7bt\_%'))))
       AND NOT (d.classid = 'pg_proc'::regclass AND EXISTS (
                  SELECT 1 FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
                   WHERE p.oid = d.objid AND n2.nspname = 'public'
                     AND p.proname LIKE 'pcm\_a7bt\_%'))
  LOOP
    v_n := v_n + 1;
    RAISE WARNING 'A7b rollback preflight — 外部依賴:%', v_ext;
  END LOOP;

  IF v_n > 0 THEN
    RAISE EXCEPTION
      'A7b rollback ① preflight 失敗 — 有 % 個**外部**物件依賴本片(見上方 WARNING);'
      '硬 DROP 會連帶破壞它們。停下、交人判斷,不得靜默續行。', v_n;
  END IF;

  -- 🔴🔴 **關卡2 #20 — 這道 preflight 擋不住什麼(必須寫在這裡,不能只寫在 plan)**:
  --    `pg_depend` 只記**編譯期**的相依。PL/pgSQL 函式體、`EXECUTE` 動態 SQL、
  --    以及任何以字串組出來的查詢,對這兩張表的參照**不會登記在 pg_depend 裡**
  --    ⇒ 上面全綠**不等於**「沒有東西會壞」。原本的檔頭寫「外部依賴全攔」是過頭的。
  --    ⇒ 補一道**文字層**的 best-effort 掃描:只發 WARNING、不 abort
  --      (它會誤報 —— 註解裡提到表名也算 —— 所以不該擋人;但漏報的代價是正式站留下壞函式,
  --       所以也不能不掃)。判讀責任明確地交回給人。
  v_n := 0;   -- 🔴 重置:上面的 pg_depend 計數已判定完畢,文字層是**另一個**計數
  FOR v_ext IN
    SELECT format('%s.%s', n.nspname, p.proname)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND p.proname NOT LIKE 'pcm\_a7bt\_%'
       AND p.prosrc ~ 'order_refund_job'
     ORDER BY 1
  LOOP
    v_n := v_n + 1;
    RAISE WARNING 'A7b rollback preflight(文字層)— 函式 % 的本體提到 order_refund_job*', v_ext;
  END LOOP;
  -- 🔴 **關卡2 R2:改成 abort,不是 WARNING。** 原本只警告不擋 ——
  --    「明知存在 catalog 保護不到的引用,還是照 DROP」是最糟的組合:
  --    出事時日誌裡有一行我們自己印的警告,而東西已經壞了。
  --    誤報(註解裡提到表名)用 escape 明文放行,**不是**用「反正只警告」放行。
  IF v_n > 0 AND coalesce(current_setting('a7b.skip_text_scan', true), 'NO') = 'YES_I_CHECKED' THEN
    RAISE WARNING 'A7b rollback ①(文字層)— 有 % 支函式命中,但呼叫者已帶 skip_text_scan=YES_I_CHECKED 明文放行', v_n;
  ELSIF v_n > 0 THEN
    RAISE EXCEPTION
      'A7b rollback ① preflight(文字層)失敗 — 有 % 支函式的本體提到 order_refund_job*'
      '(見上方 WARNING)。pg_depend 看不到這種參照 ⇒ 硬 DROP 會留下壞掉的函式。'
      '逐一確認過確定無害,再帶 -v skip_text_scan=YES_I_CHECKED 重跑。', v_n;
  END IF;

  RAISE NOTICE 'A7B-RB|1|preflight-ok';
END
$$;

-- ══ ② 停 writer ═══════════════════════════════════════════════════════════
-- 🔴🔴 **關卡2 R2 更正**:舊字面「第 3 批之前沒有 writer(T2 已證直寫必 42501)」**是錯的**。
--    實測(`scripts/a7bt-verify.sh` 探針 ③):service_role **建得出一整筆 gen1 退款工單**
--    (header + 明細 + DEFERRED 全過)—— A7b-M `:504-506` 明文 GRANT 了 INSERT。
--    42501 只發生在 UPDATE 與鎖列那一半。
--    ⇒ 「沒有 writer」是**營運慣例,不是資料庫強制的事實**。本步的第 ③ 步(空表 + 排他鎖)
--      才是真正的保護;收回那兩個 INSERT GRANT 是第 3 批前置。
-- 🔴 這一步在**有 worker 之後**必須是「真的把 worker 停掉」,不是一句註解。
DO $$
BEGIN
  RAISE NOTICE 'A7B-RB|2|no-writer-yet';
END
$$;

-- ══ ③ 驗兩表為空(非空則停下,不得靜默續行)═══════════════════════════════
-- 🔴🔴 **關卡2 #22:先鎖表再計數。** 原本是「先數、後 DROP」,中間沒有任何互斥 ——
--    並行的 gen1 INSERT(service_role **現在就做得到**,見 `a7bt-verify.sh` 探針 ③)
--    可以在計數之後、DROP 之前提交;DROP 會等它結束然後把那筆新退款工單一起刪掉。
--    ⇒ ACCESS EXCLUSIVE 一次鎖住兩張表,計數與 DROP 之間不再有窗。
--    ⇒ 鎖不到就照 `lock_timeout = 5s` 當場失敗 = fail-closed(那表示真的有 writer 在動)。
--    鎖序固定 child → parent,與第 ④⑤ 步的 DROP 同序,避免與其他交易互鎖。
-- 🔴 `order_cancellation_items` 也要在**同一句**裡鎖(Fable R3 F10):第 ④ 步第一句要對它取
--    ACCESS EXCLUSIVE(拆第 11 支 trigger)。晚一步才鎖 = 鎖序不固定 ⇒ 與「先動取消明細、
--    再動退款表」的交易可能互鎖。同一句取得的鎖沒有先後,把三張表一次鎖起來就沒有這個窗。
--    (T 未套用時它並非必要,但多鎖一張表對一支毀滅性回滾沒有代價,不值得再開一條分支。)
LOCK TABLE public.order_refund_job_items, public.order_refund_jobs,
           public.order_cancellation_items IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE v_j bigint; v_i bigint;
BEGIN
  SELECT count(*) INTO v_j FROM public.order_refund_jobs;
  SELECT count(*) INTO v_i FROM public.order_refund_job_items;
  IF v_j <> 0 OR v_i <> 0 THEN
    RAISE EXCEPTION
      'A7b rollback ③ 失敗 — 兩表非空(jobs=% / items=%)。**先備份、再交 Sean 判斷**,'
      '不得靜默 DROP:那是退款工作歷史,清掉之後五道唯一索引再也擋不住重退。', v_j, v_i;
  END IF;
  RAISE NOTICE 'A7B-RB|3|both-empty';
END
$$;

-- ══ ③b A7b-T 到底有沒有套用過?(Fable R3 F6)═══════════════════════════════
-- 🔴🔴 **本檔原本假設「M 與 T 一定同時在」,而正式站的真實狀態是「M 已 apply、T 未 apply」**
--    ⇒ 第 ④ 步第一句(刻意不帶 `IF EXISTS` 的 `DROP TRIGGER … ON order_cancellation_items`)
--      會死在 42704,而整包是同一筆交易 ⇒ **連 A7b-M 都退不掉**。
--      = 這道回滾在唯一需要它的那天擋死自己(與 ⓪/① 的 escape 同一族教訓,Fable 實跑驗證)。
-- 🔴 **修法不是加 `IF EXISTS`**:那會讓「trigger 名打錯」永遠沒人發現(code-reviewer N2 的原意)。
--    改成先判斷 T 這一片**整體**在不在,再決定要不要跑 T 的那些 DROP;
--    判定為「在」時,每一句仍然不帶 IF EXISTS ⇒ 打錯名字照樣當場 42704。
-- 🔴 判定依據 = `pcm_a7bt_*` 函式支數(T 建 7 支、M 一支都沒有)。
--    **7 或 0 以外的值一律 abort**:T 是單一交易套用的,出現半套 = 有人手動動過 catalog,
--    那種狀態不該由一支自動回滾腳本繼續往下 DROP。
SELECT count(*) AS a7b_t_fn
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE 'pcm\_a7bt\_%' \gset
SELECT (:a7b_t_fn = 7) AS a7b_t_applied, (:a7b_t_fn NOT IN (0, 7)) AS a7b_t_partial \gset
\if :a7b_t_partial
DO $g$
BEGIN
  RAISE EXCEPTION
    'A7b rollback ③b — pcm_a7bt_* 函式有 % 支(既不是 7 = 已套用、也不是 0 = 未套用)。'
    '這表示 catalog 被手動動過,自動回滾不處理半套狀態,停下交人判斷。', :a7b_t_fn;
END
$g$;
\endif
SELECT set_config('a7b.t_applied', CASE WHEN :'a7b_t_applied' = 't' THEN 'YES' ELSE 'NO' END, true)
  AS a7b_cfg2 \gset
DO $$
BEGIN
  RAISE NOTICE 'A7B-RB|3b|t-applied=%', current_setting('a7b.t_applied', true);
END
$$;

-- ══ ④ 子表:先 trigger 後表(RESTRICT 明寫,不靠預設)═══════════════════════
-- 🔴 **刻意不用 `IF EXISTS`**(code-reviewer N2):用了的話,trigger 名打錯或漏列一支
--    會**永遠沒有人發現**(表 DROP 掉時 trigger 跟著消失,「重套成功」也驗不到它)。
--    不用 IF EXISTS ⇒ 名字錯就當場 42704。
-- 🔴🔴 **先拆掉掛在別片表上的那一支**(關卡2 R2 #5 新增的第 11 支)。
--    它掛在 A7-t 的 `order_cancellation_items` 上 —— DROP 兩張退款表**不會**帶走它,
--    留著的話 A7-t 的表從此每次寫入都會呼叫一支不存在的函式而炸掉
--    (= rollback 把一條與退款無關的線一起弄壞)。
\if :a7b_t_applied
DROP TRIGGER a7bt_cancel_items_after_change_consistency ON public.order_cancellation_items;
DROP TRIGGER a7bt_items_block_update            ON public.order_refund_job_items;
DROP TRIGGER a7bt_items_block_delete_guard      ON public.order_refund_job_items;
DROP TRIGGER a7bt_items_block_truncate          ON public.order_refund_job_items;
DROP TRIGGER a7bt_items_after_insdel_consistency ON public.order_refund_job_items;
\endif
DROP TABLE public.order_refund_job_items RESTRICT;
DO $$ BEGIN RAISE NOTICE 'A7B-RB|4|items-dropped'; END $$;

-- ══ ⑤ 主表:先 trigger 後表 ═══════════════════════════════════════════════
\if :a7b_t_applied
DROP TRIGGER a7bt_jobs_before_insert        ON public.order_refund_jobs;
DROP TRIGGER a7bt_jobs_before_update        ON public.order_refund_jobs;
DROP TRIGGER a7bt_jobs_block_delete         ON public.order_refund_jobs;
DROP TRIGGER a7bt_jobs_block_truncate       ON public.order_refund_jobs;
DROP TRIGGER a7bt_jobs_after_ins_consistency ON public.order_refund_jobs;
DROP TRIGGER a7bt_jobs_after_insupd_ledger  ON public.order_refund_jobs;
\endif
DROP TABLE public.order_refund_jobs RESTRICT;
DO $$ BEGIN RAISE NOTICE 'A7B-RB|5|jobs-dropped'; END $$;

-- ══ ⑥ 函式:**本片建立的所有函式**,逐一具名(6 支 trigger 函式 + 1 支 helper)══
-- 🔴 plan §10 二次更正:依據是「本片建立的所有函式」,**不是 trigger manifest**
--    —— `pcm_a7bt_allowed_delta(text)` 不在 manifest 裡,照 manifest 列會漏掉它,
--    重建時會撞「已有同名函式」而失敗。
\if :a7b_t_applied
DROP FUNCTION public.pcm_a7bt_jobs_before_insert();
DROP FUNCTION public.pcm_a7bt_jobs_before_update();
DROP FUNCTION public.pcm_a7bt_block_write();
DROP FUNCTION public.pcm_a7bt_block_truncate();
DROP FUNCTION public.pcm_a7bt_assert_job_consistent();
DROP FUNCTION public.pcm_a7bt_assert_job_ledger_equal();
DROP FUNCTION public.pcm_a7bt_allowed_delta(text);
\endif

-- 收尾自檢:零殘留(**不採信上面每一句都成功**,直接查 catalog)
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname IN ('order_refund_jobs', 'order_refund_job_items');
  IF v_n <> 0 THEN RAISE EXCEPTION 'A7b rollback ⑥ — 兩表沒有全部消失(剩 %)', v_n; END IF;

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'pcm\_a7bt\_%';
  IF v_n <> 0 THEN RAISE EXCEPTION 'A7b rollback ⑥ — 還剩 % 支 pcm_a7bt_* 函式沒 DROP', v_n; END IF;

  RAISE NOTICE 'A7B-RB|6|functions-dropped-and-clean';
END
$$;

-- ══ ⑦ migration ledger(**同一筆交易內**,不留給人記得)═══════════════════════
-- 🔴🔴 **關卡2 #23:原本這一步只寫在檔頭註解裡,靠人記得手動 DELETE。**
--    漏做的症狀最惡劣:`supabase db push` 認為那兩筆版本號已套用 ⇒ **不會重放** ⇒
--    兩張表回不來,而且沒有任何錯誤訊息 —— 直到下一個人發現退款線整個不見。
--    ⇒ 搬進本檔、與 DROP 同一筆交易(要嘛一起成功、要嘛一起回滾)。
--    ⇒ `to_regclass` 判存在:拋棄式 cluster 沒有 ledger,那裡本來就不該做這件事。
-- 🔴🔴 **期望值是動態的(Fable R3 F6 連動)**:T 未套用時 ledger 只會有 A7b-M 那一列
--    ⇒ 期望 1 列;硬釘 2 會讓「只退 M」這條路徑必然 abort。
-- 🔴🔴 **明文 escape(Fable R3 F7)**:本步原本是全檔**唯一沒有 escape** 的一步
--    (⓪ 有兩把鑰匙、① 有 `skip_text_scan`)⇒ 半夜真的要退、而 ledger 因為任何理由
--    對不上兩列時,只能當場改檔案 —— 那正是「回滾守門在唯一需要它的那天擋死自己」。
--    ⇒ 補 `-v skip_ledger_count=YES_I_CHECKED`:**降級成 WARNING、但照樣印出實際刪掉幾列**,
--      而且刪除本身仍然發生(不是跳過)⇒ 放行是明文動作,不是預設行為。
\if :{?skip_ledger_count}
\else
\set skip_ledger_count 'NO'
\endif
SELECT set_config('a7b.skip_ledger_count', :'skip_ledger_count', true) AS a7b_cfg3 \gset

DO $$
DECLARE v_n integer := 0; v_want integer;
BEGIN
  v_want := CASE WHEN coalesce(current_setting('a7b.t_applied', true), 'NO') = 'YES' THEN 2 ELSE 1 END;
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE NOTICE 'A7B-RB|7|no-ledger(本庫沒有 supabase_migrations.schema_migrations,略過)';
  ELSE
    DELETE FROM supabase_migrations.schema_migrations
     WHERE version IN ('20260731120000', '20260731120100');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE NOTICE 'A7B-RB|7|ledger-deleted=%|want=%', v_n, v_want;
    -- 🔴 **關卡2 R2:`DELETE 0` 必須 abort。** 原本放行的理由是「重跑本檔會是 0」,
    --    但那是想像的情境;真實情境是**版本號打錯**或**只刪到一筆** ——
    --    兩者都會讓 `db push` 與實際 schema 從此分裂,而且完全沒有訊號。
    --    ledger 表存在卻刪不到預期列數 = 前提不成立,停下來讓人看。
    IF v_n <> v_want AND coalesce(current_setting('a7b.skip_ledger_count', true), 'NO') = 'YES_I_CHECKED' THEN
      RAISE WARNING
        'A7b rollback ⑦ — ledger 實際刪掉 % 列、預期 % 列,但呼叫者已帶 '
        'skip_ledger_count=YES_I_CHECKED 明文放行。**請自行確認 supabase_migrations 與實際 schema 一致**。',
        v_n, v_want;
    ELSIF v_n <> v_want THEN
      RAISE EXCEPTION
        'A7b rollback ⑦ — ledger 應刪掉 % 列(A7b-T %),實際刪掉 % 列。'
        '版本號打錯或本來就沒登記都會長這樣 ⇒ 停下、人工確認,不得靜默 commit。'
        '確認過確實無害,再帶 -v skip_ledger_count=YES_I_CHECKED 重跑。',
        v_want,
        CASE WHEN v_want = 2 THEN '已套用 ⇒ 20260731120000 + 20260731120100'
             ELSE '未套用 ⇒ 只有 20260731120000' END,
        v_n;
    END IF;
  END IF;
END
$$;

COMMIT;
