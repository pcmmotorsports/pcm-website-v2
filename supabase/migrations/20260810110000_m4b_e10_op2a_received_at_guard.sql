-- ══════════════════════════════════════════════════════════════════════════
-- OP2a(T 片)· `order_payments.received_at` 不得晚於現在(A8 閘)
-- ══════════════════════════════════════════════════════════════════════════
-- 塊規格 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:655`。
-- 本片交付 = OP1 檔頭 **A8** 那條具名交付物,只做這一道。
--
-- ── 片界(主視窗 2026-08-10 裁定)────────────────────────────────────────
-- 🔴 **本片不碰 dormant gate。** `DROP` gate 綁在 **OP2b**、與 A9 同 migration 同交易。
--    理由:gate 是 A9 上線前唯一擋「沖銷列亂寫」的東西 —— gate 先 DROP 而 A9 未上 = 裸奔窗口。
--    這與 OP1 檔頭那條發布序硬約束是同一個形狀(我原本只說「A9 留最後」,漏了 gate,主視窗修正)。
--
-- ── 為什麼是 trigger 不是 CHECK ─────────────────────────────────────────
-- OP1 檔頭寫死:CHECK 的表達式在文件上要求 IMMUTABLE、`now()` 不是(PG 17.10 實測「接受」,
-- 但那是「現在能用」不是「保證能用」)⇒ 閘放在 trigger 裡,那裡用時間函式名正言順。
--
-- ── 🔴 為什麼比 `clock_timestamp()` 不是 `now()`(理由改寫過兩次,這是查證後的版本)───
-- · **事實**:現行 writer `confirm_order_payment` 用 `pg_catalog.now()`
--   (`20260611120000_m3_s2c_confirm_payment_rpc.sql`,函式體內 `paid_at = pg_catalog.now()`,實查)。
--   `now()` = **交易開始時刻**,恆 <= `clock_timestamp()`。
--   ⚠️ **收窄(關卡2 R2)**:`confirm_order_payment` 目前只寫 `orders.paid_at`、**還沒有寫
--      `order_payments.received_at`**(那是 OP3 的事)⇒ 「現行 writer 在兩種閘下都會過」是
--      **對 OP3 會沿用同款寫法的推論**,不是已發生的事實。寫成推論,不寫成事實。
--   ⚠️ plan v1 曾寫「writer 用 clock_timestamp 會被 now() 誤擋」—— **那句與事實相反,是我推測的**,
--      關卡1 R1 打回。留這行是為了讓下一個人知道這個理由被查過、不要再發明一次。
-- · **仍選 `clock_timestamp()` 的真正理由**:`now()` 比較**嚴**。落在 `(now(), clock_timestamp()]`
--   之間的值,是「交易開始之後、寫入之前」**真的已經發生**的時刻;用 `now()` 當閘會把它判成未來
--   而**誤殺一筆真的錢**。閘的用途是擋「還沒發生的事」⇒ 寧鬆勿誤殺。
--   代價 = 接受最多「交易已經跑掉的那段時間」的寬容,那是毫秒到秒級,對帳意義上不可見。
-- · **零容差**:不加寬限秒數 —— 加了就要回答「幾秒才對」,而沒有人答得出來。
--
-- 🔴🔴 **OP-A11(新增的具名交付物,丟給 OP3)**:`received_at` 若來自**外部系統的時鐘**
--    (TapPay 回呼帶回的授權時點),就存在**時鐘偏差**,而本閘比的是 **DB 自己的時鐘**
--    ⇒ **擋不到那個面**。card 軌 `received_at` 的時間來源與時鐘偏差政策 = OP3 的具名交付物,
--    不在 M/T 片自行發明。不要把本閘當成「時間一定對」的證明。
-- 🔴 OP4 歷史回填寫的是**過去**的值 ⇒ 本閘不擋它,這是正確的、不是漏洞。
--
-- ── 🔴 承重前提:PG 的求值序(**實測過,不是查文件就算**)──────────────────
-- 本片的探針能在**空庫**跑起來,整個靠這條:**BEFORE trigger → CHECK/NOT NULL → 寫入 → FK**。
-- 三段消融實測(PG 17.10,拋棄式庫;每段拆掉一層就露出下一層):
--   T1  trigger + CHECK(false) + 假 FK 三者都會擋 ⇒ 紅在 **trigger**(`probe_trigger`)
--   T2  拿掉 trigger                              ⇒ 紅在 **CHECK**(23514 `probe_check`)
--   T3  再拿掉 CHECK                              ⇒ 紅在 **FK**(23503)= 證明 T1/T2 的紅不是 FK 給的
--   T4  savepoint 內的 CREATE TABLE / DROP CONSTRAINT,ROLLBACK TO 後確實消失/復原
-- ⇒ 拿**假** `order_id` / `actor` 打真表時:未來值紅在本片的閘、當下值紅在 dormant gate,
--   **兩者都在 FK 之前** ⇒ 探針零業務資料依賴。
-- ⚠️ plan v2 曾改用 `pg_temp` 鏡像表跑全部探針 —— 那是多繞的,而且對「函式裡按 `TG_RELID` /
--    `TG_TABLE_NAME` 分支」的壞實作**全盲**(關卡1 R2 打回)。鏡像表現在只留給 UPDATE 兩格,理由見下。
--
-- ── 🔴 兩個**不同**的 SQLSTATE(關卡1 R2 must-fix)──────────────────────
--   守門碼 = `P2B31`(trigger 擋下來時用)/ 哨兵碼 = `P2B20`(檔尾驗收自己的 RAISE,沿用本 repo 慣例)
-- 兩者**必須不同**:若哨兵重拋的碼與守門碼相同,`WHEN SQLSTATE <哨兵碼> THEN RAISE` 會把每一個
-- **預期中的**負向都當成哨兵重拋 ⇒ 整片 migration 炸掉。
--
-- ── 名稱序契約(現在還沒有,但要寫下來)──────────────────────────────────
-- 本表目前**只有這一支** trigger ⇒ 同表同事件的發火序還不構成契約。
-- 🔴 **OP2b 加第二支(A9)時必須補名稱序契約**,對齊 A4a `20260803140000` 與
--    S1a-2 `20260805170100` 的先例。寫在這裡免得下一個人以為本表沒有這回事。
--
-- ── 審查紀錄(鐵則 12 高風險片;本片命中 ①錢 ②權限 ③DB 結構)────────────────
-- 關卡1(plan)  codex R1 FAIL 9 must-fix + 2 nit → plan v2;R2 FAIL 8 must-fix → plan v3。全折。
-- 雙審(凍結樹) 主視窗代跑 code-reviewer(opus)+ R3(Fable 換模型換角度)並行。
--               🔴 兩者**獨立撞出同一條 critical**:`aclexplode(NULL)` 回零列 ⇒ 只靠它的 ACL 斷言恆真。
--               合計 1 MF + 2 important + 3 consider + 3 nit,全折(F3 由主視窗裁 OP- 前綴與登記處)。
-- 關卡2(diff)  codex R1 FAIL 3 must-fix + 3 nit → 全折;R2 FAIL 2 must-fix + 3 nit → 全折。
--               🔴 R2 那條「零容差證不到」改變了本片的宣稱形狀,見上方比較式逐字那道的誠實邊界。
-- 判別力       突變 20 發(含 4 發消融)PASS=20 FAIL=0,每發附「靶套上」的固定字串證據。
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 🔴 `CREATE TRIGGER` 對 `order_payments` 取 **SHARE ROW EXCLUSIVE 且持到頂層 COMMIT**。
--    ⚠️ 誠實邊界(照抄 OP1):`lock_timeout` 只保護「**我**等不到鎖時放棄」,
--       **不保護「別人在等我放鎖」**;整筆交易的持鎖上限要靠 `transaction_timeout`(PG17)。
-- 🔴 **apply 前置**:先 `SHOW server_version;`。PG<17 要拿掉 `transaction_timeout`
--    (本片沒有用到 PG17-only 的 `MAINTAIN`,所以只有這一處;OP1 那片是兩處)。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

-- ── 閘本體 ────────────────────────────────────────────────────────────────
-- 🔴 `SECURITY INVOKER`(預設,不寫 DEFINER):它不讀任何別人的表,不需要提權。
-- 🔴 `search_path` 釘死:本 repo 既有紀律,避免被呼叫端的 search_path 牽著走。
-- 🔴🔴 **恰一個 `RETURN`,而且是 `RETURN NEW;`**:BEGIN trigger 回 `NULL` 會讓該列的寫入
--    **被靜默取消** —— S1a-2(`20260805170100`)實測:`UPDATE 0`、零錯誤、事後查值仍是舊值。
--    一支「看似只是不擋」的守門可以把合法寫入整個吞掉而不留痕跡。下方驗收釘死這個形狀。
CREATE FUNCTION public.pcm_op2_received_at_not_future()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $fn$
BEGIN
  IF NEW.received_at > pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION '收款時點不得晚於現在(received_at=%,現在=%)',
                    NEW.received_at, pg_catalog.clock_timestamp()
      USING ERRCODE = 'P2B31', CONSTRAINT = 'pcm_op2_received_at_future';
  END IF;
  RETURN NEW;
END
$fn$;

-- 🔴 新函式的 EXECUTE 預設會漏給 PUBLIC(memory
--    `reference_supabase-service-role-execute-default-grant`)⇒ 顯式收乾淨,並在檔尾斷言。
REVOKE ALL ON FUNCTION public.pcm_op2_received_at_not_future()
  FROM PUBLIC, anon, authenticated, service_role, authenticator;

-- 🔴 `BEFORE INSERT OR UPDATE`:只守 INSERT 的話,`UPDATE ... SET received_at = 未來`
--    直接繞過整條閘。兩個事件都守,成本為零。
CREATE TRIGGER order_payments_received_at_not_future_biu
  BEFORE INSERT OR UPDATE ON public.order_payments
  FOR EACH ROW EXECUTE FUNCTION public.pcm_op2_received_at_not_future();

COMMENT ON FUNCTION public.pcm_op2_received_at_not_future() IS
  'OP2a / A8:order_payments.received_at 不得晚於現在。比較基準是 clock_timestamp() 不是 now()'
  '(now() 是交易開始時刻、比較嚴,會誤殺「交易開始後、寫入前」真的已經發生的時刻)。'
  '🔴 比的是 DB 自己的時鐘 ⇒ 擋不到外部系統(TapPay 回呼)的時鐘偏差,那是 OP3 的 OP-A11。';

-- ── 檔尾 fail-closed 驗收 ─────────────────────────────────────────────────
DO $op2a_asserts$
DECLARE
  v_n integer; v_rows integer; v_bad text; v_src text; v_rail text; v_fn_oid oid;
BEGIN
  v_fn_oid := 'public.pcm_op2_received_at_not_future()'::regprocedure::oid;

  -- ① 綁定面:逐項釘死。名字對不代表綁對地方、綁對事件、還活著。
  --    🔴 `tgtype` 釘**逐字 23**(= ROW 1 + BEFORE 2 + INSERT 4 + UPDATE 16),不是「必要 bit 都在」
  --       —— 那樣多一個 DELETE(31)照樣過(關卡1 R2 抓到)。
  SELECT t.tgtype::integer, t.tgenabled::text INTO v_n, v_bad
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.order_payments'::regclass
     AND t.tgname = 'order_payments_received_at_not_future_biu'
     AND t.tgfoid = v_fn_oid
     AND NOT t.tgisinternal;
  IF v_n IS DISTINCT FROM 23 OR v_bad IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'A8 trigger 的 tgtype=%(期望逐字 23 = ROW+BEFORE+INSERT+UPDATE)、tgenabled=%(期望 O)'
                    '⇒ 綁錯表/綁錯函式/改成 AFTER/多綁 DELETE/被 disable 都紅在這裡',
                    coalesce(v_n::text, '(查無此 trigger 或它指向別的函式)'), coalesce(v_bad, '-')
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_trigger_binding';
  END IF;
  -- 禁 WHEN 子句:`WHEN (NEW.rail='card')` 會讓另外兩軌整個不受守門,而上面六項全綠。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
              WHERE t.tgrelid = 'public.order_payments'::regclass
                AND t.tgname = 'order_payments_received_at_not_future_biu'
                AND t.tgqual IS NOT NULL) THEN
    RAISE EXCEPTION 'A8 trigger 帶了 WHEN 子句 ⇒ 有一部分的列不受守門'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_trigger_has_when';
  END IF;
  -- 🔴 關卡1 R2:只驗「同名恰一支」證明不了什麼 —— **另一支不同名**的 trigger 可以改 NEW
  --    或 RETURN NULL,而上面每一道都全綠。⇒ 凍結本表非 internal trigger 的**完整集合**。
  SELECT pg_catalog.string_agg(t.tgname, ',' ORDER BY t.tgname) INTO v_bad
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.order_payments'::regclass AND NOT t.tgisinternal;
  IF v_bad IS DISTINCT FROM 'order_payments_received_at_not_future_biu' THEN
    RAISE EXCEPTION '本表的 trigger 集合是 [%],期望逐字 [order_payments_received_at_not_future_biu]'
                    '⇒ 多一支不同名的 trigger 也要紅(它可以改 NEW 或 RETURN NULL 而其餘斷言全綠)',
                    coalesce(v_bad, '(無)')
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_trigger_set';
  END IF;

  -- 🔴🔴 **零容差:行為格證不到,只能釘文字面(關卡2 R2 must-fix)。**
  --    N5 用 +2 秒 ⇒ 它只證得了「容差 < 2 秒」。一個「容許 1 秒」的實作**照樣全綠**。
  --    這是**原理上的界線**不是靶不夠密:任何 ε 秒的探針都會被 >= ε 的容差穿過,而 ε 不能小到
  --    接近執行抖動(毫秒),否則正向格自己會偶發紅。
  -- ⇒ 「零」這件事只能由**比較式本身**保證 ⇒ 把它釘成逐字。
  --    ⚠️ 誠實邊界:這是文字比對,擋得住 `+ interval '…'` 這類加寬限,擋不住語意等價的改寫
  --    (例如換成 `>= clock_timestamp() + 1 microsecond`)。N5 與這道各守一半,合起來才是「零容差」。
  IF (SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = v_fn_oid)
       !~ 'NEW\.received_at > pg_catalog\.clock_timestamp\(\)\s+THEN' THEN
    RAISE EXCEPTION '閘的比較式不是逐字的 `NEW.received_at > pg_catalog.clock_timestamp() THEN`'
                    '⇒ 可能被加了寬限期(N5 只證得到「容差 < 2 秒」,零容差要靠這一道)'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_expression_drifted';
  END IF;

  -- ② 函式形狀:恰一個 RETURN,而且是 RETURN NEW。
  --    🔴 不用「有沒有出現 RETURN NULL」這種 grep —— 那對 `RETURN OLD` 與 `NEW := OLD` 全盲
  --       (S1a-2 的教訓)。改成**釘死唯一允許的形狀**。
  --    ⚠️ **誠實邊界(雙審 nit)**:「恰一個 `RETURN NEW;`」擋得住 `RETURN NULL` / `RETURN OLD`,
  --       但**擋不住 `NEW := OLD;` 之後再 `RETURN NEW;`** —— 那支函式形狀完全合法、卻把整列改回舊值。
  --       文字比對到此為止;真正擋它的是下方鏡像表的**欄值後驗**(P4 驗 note 真的改到、
  --       P6 驗 received_at 真的變成過去值)。兩者是不同的面,不要以為文字那道涵蓋了行為。
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_fn_oid;
  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM pg_catalog.regexp_matches(v_src, '\mRETURN\M', 'gi') m;
  IF v_n <> 1 OR v_src !~* '\mRETURN\s+NEW\s*;' THEN
    RAISE EXCEPTION '函式體的 RETURN 有 % 個(期望恰 1)且必須是 RETURN NEW;'
                    '⇒ RETURN NULL 會讓 BEFORE trigger 靜默取消寫入(零錯誤、UPDATE 0)', v_n
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_function_shape';
  END IF;

  -- ③ SECDEF 與 search_path:proconfig 要**精確相等**,不是「含有」。
  IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_fn_oid) THEN
    RAISE EXCEPTION '本函式不該是 SECURITY DEFINER(它不需要提權)'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_unexpected_secdef';
  END IF;
  SELECT pg_catalog.array_to_string(p.proconfig, '|') INTO v_bad
    FROM pg_catalog.pg_proc p WHERE p.oid = v_fn_oid;
  IF v_bad IS DISTINCT FROM 'search_path=pg_catalog, public' THEN
    RAISE EXCEPTION 'proconfig 是 [%],期望逐字 [search_path=pg_catalog, public]'
                    '⇒ 多一項設定、少一項、或 search_path 被換掉都紅在這裡', coalesce(v_bad, '(無)')
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_proconfig';
  END IF;

  -- ④ 零 EXECUTE —— **三道並用**,因為單獨任何一道都有洞。
  -- 🔴🔴 **雙審(code-reviewer + Fable R3)獨立撞出的 critical**:上一版只有 `aclexplode` 那一道,
  --    而 **`aclexplode(NULL)` 回零列**(本機實測 `SELECT count(*) FROM aclexplode(NULL::aclitem[])` = 0)
  --    ⇒ `proacl IS NULL` 時 `v_bad` 為 NULL、斷言不 RAISE = **恆真**,
  --      而 `proacl IS NULL` 正是「沒有任何 GRANT/REVOKE 紀錄」的預設態,**PG 對函式的預設就是
  --      `EXECUTE TO PUBLIC`** ⇒ 上面的 REVOKE 若被刪掉或重建函式時漏抄,PUBLIC 拿得到 EXECUTE
  --      而檔尾照樣印「通過」。OP1 是 `has_table_privilege` 矩陣 + `relacl` 掃兩道並用,
  --      本片上一版只抄了會恆真的那一半。
  -- ⚠️ **重現差異據實寫**:審查者回報「活體實測 proacl IS NULL」;我在拋棄式 harness 上重現時
  --    `proacl` 是 **NOT NULL**,因為這台庫的 `pg_default_acl` 有 `f:` 那一組(shim 把
  --    EXECUTE 預設授給 anon/authenticated/service_role)⇒ ACL 被物化了。
  --    **結論不變**:`aclexplode(NULL)` 零列是確定的,而 `proacl` 是不是 NULL 取決於環境的
  --    default privileges —— 那不是本 migration 控制得了的東西,所以不能靠它。
  -- ⚠️ **這一道沒有可構造的負測,不宣稱它被證明過**:突變「拿掉 REVOKE」時,本機 harness 的
  --    `pg_default_acl` 仍會把 ACL **物化**(proacl 變成 NOT NULL 且列著 PUBLIC/anon/…)
  --    ⇒ 實際紅在下面那道 `pcm_op2a_execute_not_zero`,這一道摸不到。
  --    它擋的是「default privileges 不存在」的環境 —— 那個狀態在這台庫上造不出來。
  --    留著的理由是它 fail-closed 且只有一行;**它的效力是推論(aclexplode(NULL)=0 列已實測),
  --    不是觀測**。
  IF (SELECT p.proacl IS NULL FROM pg_catalog.pg_proc p WHERE p.oid = v_fn_oid) THEN
    RAISE EXCEPTION '本函式的 proacl 是 NULL(= 沒有任何 GRANT/REVOKE 紀錄)⇒ PG 對函式的預設是 EXECUTE TO PUBLIC'
                    '。上面的 REVOKE 沒生效或被刪掉了 —— 這一道存在的唯一理由是:aclexplode(NULL) 回零列,'
                    '光靠下面那道會恆真'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_proacl_null';
  END IF;
  -- 🔴 用 `aclexplode` 全稱掃,不是查五個具名角色 —— 第六個具名 role 有 EXECUTE 時那種查法全綠
  --    (關卡1 R2 抓到;OP1 的 relacl 是同一形狀)。
  SELECT pg_catalog.string_agg(DISTINCT
           CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE g.grantee::regrole::text END, ', ') INTO v_bad
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) g
   WHERE p.oid = v_fn_oid AND g.grantee <> p.proowner;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '本函式對 owner 以外的角色有權限(%)⇒ 零 EXECUTE 這句話是假的', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_execute_not_zero';
  END IF;
  -- 🔴 第三道 = repo 慣例的 `has_function_privilege` 矩陣
  --    (`20260611120000_m3_s2c_confirm_payment_rpc.sql` 的 EXECUTE 權限矩陣同形狀)。
  --    它與上面兩道的面不同:它問的是「**有效**權限」,涵蓋 role 繼承那條 relacl/proacl 看不到的路。
  SELECT pg_catalog.string_agg(r, ', ' ORDER BY r) INTO v_bad
    FROM unnest(ARRAY['anon','authenticated','service_role','authenticator']) r
   WHERE pg_catalog.has_function_privilege(r, v_fn_oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '這些角色**有效**拿得到 EXECUTE(%)⇒ 可能經由 role 繼承,proacl 看不到那條路', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_execute_effective';
  END IF;

  -- ⑤ 行為探針 —— 真表,零業務資料依賴(承重前提見檔頭三段消融)。
  --    N 格:未來時點 ⇒ 必須紅在**守門** conname。
  --    P 格:當下時點 ⇒ 閘放行 ⇒ 接著紅在 **dormant gate** conname。
  --    🔴 P 格紅在 gate **就是**「A8 放行了」的可觀測證據;若 A8 誤擋,紅的會是守門 conname。
  FOREACH v_rail IN ARRAY ARRAY['card','bank_transfer','cash'] LOOP
    DECLARE v_con text;
    BEGIN
      INSERT INTO public.order_payments (order_id, rail, amount, received_at,
                                         rec_trade_id, bank_reference, request_id, actor)
      VALUES ('00000000-0000-0000-0000-000000000000', v_rail, 1,
              pg_catalog.clock_timestamp() + interval '1 minute',
              CASE WHEN v_rail = 'card' THEN 'probe' END,
              CASE WHEN v_rail = 'bank_transfer' THEN 'probe' END,
              CASE WHEN v_rail <> 'card' THEN '00000000-0000-0000-0000-000000000001'::uuid END,
              'probe');
      RAISE EXCEPTION 'N-% 未來時點沒被擋 ⇒ A8 閘沒生效', v_rail
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_vacuous';
    EXCEPTION
      WHEN SQLSTATE 'P2B20' THEN RAISE;
      WHEN SQLSTATE 'P2B31' THEN
        GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
        IF v_con IS DISTINCT FROM 'pcm_op2_received_at_future' THEN
          RAISE EXCEPTION 'N-% 紅了但 conname 是 %', v_rail, coalesce(v_con, '(NULL)')
            USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_wrong_conname';
        END IF;
      WHEN check_violation THEN
        GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
        IF v_con = 'order_payments_dormant_until_triggers' THEN
          RAISE EXCEPTION 'N-% 的未來值是被 dormant gate 擋下的,不是本片的閘 ⇒ A8 閘對這一軌沒生效', v_rail
            USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_vacuous';
        END IF;
        RAISE EXCEPTION 'N-% 被 CHECK % 擋住', v_rail, coalesce(v_con, '(NULL)')
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_wrong_blocker';
      WHEN others THEN
        GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
        RAISE EXCEPTION 'N-% 被別的東西擋住(%)⇒ 證不到 A8 閘',
                        v_rail, coalesce(v_con, '(未提供 conname)')
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_wrong_blocker';
    END;

    DECLARE v_con text;
    BEGIN
      INSERT INTO public.order_payments (order_id, rail, amount, received_at,
                                         rec_trade_id, bank_reference, request_id, actor)
      VALUES ('00000000-0000-0000-0000-000000000000', v_rail, 1, pg_catalog.now(),
              CASE WHEN v_rail = 'card' THEN 'probe' END,
              CASE WHEN v_rail = 'bank_transfer' THEN 'probe' END,
              CASE WHEN v_rail <> 'card' THEN '00000000-0000-0000-0000-000000000001'::uuid END,
              'probe');
      -- 🔴 **走到這裡有兩種完全不同的原因,不能都喊「gate 不見了」**(突變消融 M-c2 抓到:
      --    `RETURN NULL` 時 INSERT 被**靜默吞掉**、零錯誤,而我原本的哨兵會說 gate 不見了
      --    ⇒ fail-closed 有,但診斷是錯的,會把下一個人送去查錯方向)。
      --    `ROW_COUNT` 分得出來:被吞掉 = 0、真的寫進去 = 1。
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 0 THEN
        RAISE EXCEPTION 'P-% 的 INSERT 被函式靜默吞掉(ROW_COUNT=0、零錯誤)⇒ RETURN NULL 形狀', v_rail
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_insert_swallowed';
      END IF;
      RAISE EXCEPTION 'P-% 真的寫進去了(ROW_COUNT=%)⇒ dormant gate 不見了,這片不該讓它發生', v_rail, v_rows
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_gate_missing';
    EXCEPTION
      WHEN SQLSTATE 'P2B20' THEN RAISE;
      WHEN SQLSTATE 'P2B31' THEN
        RAISE EXCEPTION 'P-% 的當下時點被 A8 誤擋 ⇒ 閘太嚴', v_rail
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_too_strict';
      WHEN check_violation THEN
        GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
        IF v_con IS DISTINCT FROM 'order_payments_dormant_until_triggers' THEN
          RAISE EXCEPTION 'P-% 過了 A8 之後紅在 %,期望 dormant gate', v_rail, coalesce(v_con, '(NULL)')
            USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_gate_wrong_conname';
        END IF;
      WHEN others THEN
        GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
        RAISE EXCEPTION 'P-% 被非 CHECK 的東西擋住(%)', v_rail, coalesce(v_con, '(未提供)')
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_gate_wrong_blocker';
    END;
  END LOOP;

  -- 🔴🔴 **N5(關卡2 must-fix):零容差要有格子守。** 上面 N1-N3 的未來值是 **+1 分鐘** ——
  --    一個「容許 30 秒未來值」的實作(`> clock_timestamp() + interval '30 seconds'`)
  --    會讓 N/N4 照樣紅、P/P5 照樣過 ⇒ **全綠**,而檔頭寫死的「零容差」當場破功。
  --    ⇒ 補一格**剛好越線**的:+2 秒。它遠大於這段程式的執行抖動(毫秒級)、又小於任何
  --      合理的寬限值 ⇒ 只有真正零容差的實作才擋得住它。
  DECLARE v_con text;
  BEGIN
    INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
    VALUES ('00000000-0000-0000-0000-000000000000', 'card', 1,
            pg_catalog.clock_timestamp() + interval '2 seconds', 'probe', 'probe');
    RAISE EXCEPTION 'N5:+2 秒的未來值沒被擋 ⇒ 閘有寬限期,不是零容差'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_has_tolerance';
  EXCEPTION
    WHEN SQLSTATE 'P2B20' THEN RAISE;
    WHEN SQLSTATE 'P2B31' THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con IS DISTINCT FROM 'pcm_op2_received_at_future' THEN
        RAISE EXCEPTION 'N5 紅了但 conname 是 %', coalesce(v_con, '(NULL)')
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_wrong_conname';
      END IF;
      -- 🔴🔴 **N 格的「被 dormant gate 擋住」= 閘自己沒擋**,不是「被別的東西擋住」。
      --    閘是 BEFORE trigger、排在 CHECK 之前 ⇒ 它一旦放行,接手的一定是 dormant gate。
      --    上一版把這條丟給 `WHEN others` 說「被別的東西擋住」—— 有紅(fail-closed 成立)但診斷沒用,
      --    下一個人看不出是閘漏了。實測:30 秒寬限與「只守收款列」兩發突變都落在這條路上。
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con = 'order_payments_dormant_until_triggers' THEN
        RAISE EXCEPTION 'N5:+2 秒的未來值是被 dormant gate 擋下的,不是本片的閘 ⇒ 閘有寬限期,不是零容差'
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_has_tolerance';
      END IF;
      RAISE EXCEPTION 'N5 被 CHECK % 擋住', coalesce(v_con, '(NULL)')
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_wrong_blocker';
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      RAISE EXCEPTION 'N5 被別的東西擋住(%)', coalesce(v_con, '(未提供)')
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_wrong_blocker';
  END;

  -- 🔴🔴 **N6(關卡2 must-fix):沖銷列形狀也要探。** 上面每一發探針的 `reverses_payment_id`
  --    都是 NULL ⇒ 一個寫成 `IF NEW.reverses_payment_id IS NULL AND NEW.received_at > …`
  --    的實作**全綠**,而 OP2b 拆掉 dormant gate 之後,**未來日期的沖銷列就直接寫得進錢帳**。
  --    這是「探針形狀不夠寬」而不是「守門沒寫」——同一個形狀 OP1 也被抓過一次。
  DECLARE v_con text;
  BEGIN
    INSERT INTO public.order_payments (order_id, rail, amount, received_at,
                                       reverses_payment_id, reversal_reason, actor)
    VALUES ('00000000-0000-0000-0000-000000000000', 'card', -1,
            pg_catalog.clock_timestamp() + interval '1 minute',
            '00000000-0000-0000-0000-000000000002', 'probe', 'probe');
    RAISE EXCEPTION 'N6:沖銷列的未來值沒被擋 ⇒ 閘只守收款列'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_skips_reversal';
  EXCEPTION
    WHEN SQLSTATE 'P2B20' THEN RAISE;
    WHEN SQLSTATE 'P2B31' THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con IS DISTINCT FROM 'pcm_op2_received_at_future' THEN
        RAISE EXCEPTION 'N6 紅了但 conname 是 %', coalesce(v_con, '(NULL)')
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_wrong_conname';
      END IF;
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con = 'order_payments_dormant_until_triggers' THEN
        RAISE EXCEPTION 'N6:沖銷列的未來值是被 dormant gate 擋下的,不是本片的閘 ⇒ 閘只守收款列'
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_skips_reversal';
      END IF;
      RAISE EXCEPTION 'N6 被 CHECK % 擋住', coalesce(v_con, '(NULL)')
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_wrong_blocker';
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      RAISE EXCEPTION 'N6 被別的東西擋住(%)⇒ 證不到閘對沖銷列有效', coalesce(v_con, '(未提供)')
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_wrong_blocker';
  END;

  -- ⑥ P5:值落在 `(now(), clock_timestamp()]` —— 這一格是 `now()` 與 `clock_timestamp()`
  --    **唯一分得出來**的觀察點。閘若被改回 `now()`,只有這格會紅。
  --    ⚠️ 50 毫秒的 sleep 有它的用途:少了它 now() 與 clock_timestamp() 的差
  --       小到寫入值多半仍 <= now(),這格就失去判別力。日後看到它想刪的人,請先讀這段。
  DECLARE v_con text; v_ts timestamptz;
  BEGIN
    PERFORM pg_catalog.pg_sleep(0.05);
    v_ts := pg_catalog.clock_timestamp();
    INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
    VALUES ('00000000-0000-0000-0000-000000000000', 'card', 1, v_ts, 'probe', 'probe');
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RAISE EXCEPTION 'P5 的 INSERT 被函式靜默吞掉(ROW_COUNT=0)⇒ RETURN NULL 形狀'
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_insert_swallowed';
    END IF;
    RAISE EXCEPTION 'P5 真的寫進去了(ROW_COUNT=%)⇒ dormant gate 不見了', v_rows
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_gate_missing';
  EXCEPTION
    WHEN SQLSTATE 'P2B20' THEN RAISE;
    WHEN SQLSTATE 'P2B31' THEN
      RAISE EXCEPTION 'P5 被 A8 擋掉 ⇒ 閘的基準是 now() 不是 clock_timestamp(),會誤殺'
                      '「交易開始後、寫入前」真的已經發生的時刻'
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_uses_now';
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con IS DISTINCT FROM 'order_payments_dormant_until_triggers' THEN
        RAISE EXCEPTION 'P5 過了 A8 之後紅在 %,期望 dormant gate', coalesce(v_con, '(NULL)')
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_gate_wrong_conname';
      END IF;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      RAISE EXCEPTION 'P5 被非 CHECK 的東西擋住(%)', coalesce(v_con, '(未提供)')
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_gate_wrong_blocker';
  END;

  -- ⑦ UPDATE 面 —— 🔴 這是**唯一**還需要鏡像表的地方,理由具體:
  --    真表恆空(dormant gate 全擋)⇒ **沒有列可以 UPDATE**,而把 gate 拿掉來造列是 OP2b 的事。
  --    ⇒ 在 pg_temp 鏡像表上造列跑 UPDATE 兩格。誠實邊界寫死:
  --      **這兩格證的是「函式」,不是「trigger 綁在真表的 UPDATE 事件上」**;
  --      後者由上面 ① 的 `tgtype = 23` 逐字釘住(少了 UPDATE 那個 bit 就不是 23)。
  --    🔴🔴 **這條邊界有實證,不是我自己講的**:突變消融 M-b2(把真表 trigger 改成只
  --       `BEFORE INSERT`,同時把 tgtype 期望值放寬成 7 讓結構那道放行)⇒ **整片仍然全綠**。
  --       因為 UPDATE 行為格跑在鏡像表上,鏡像表的 trigger 沒被動到。
  --       ⇒ **真表 UPDATE 綁定的唯一守門就是 `tgtype = 23`**,行為格對它零判別力。
  --       日後有人想把 `tgtype` 那道放寬成「必要 bit 都在」,這段就是為什麼不行。
  --    🔴 鏡像表用 `INCLUDING DEFAULTS` **不含 CONSTRAINTS** ⇒ 沒有 gate、沒有 FK、沒有值域 CHECK,
  --       紅的只可能是我們的 trigger;但 `LIKE` 仍會複製 **NOT NULL** ⇒ 每格逐欄寫死合法值,
  --       否則紅的會是 23502 而不是守門(關卡1 R2 抓到)。
  CREATE TABLE pg_temp.op2a_probe (LIKE public.order_payments INCLUDING DEFAULTS);
  CREATE TRIGGER op2a_probe_biu
    BEFORE INSERT OR UPDATE ON pg_temp.op2a_probe
    FOR EACH ROW EXECUTE FUNCTION public.pcm_op2_received_at_not_future();

  INSERT INTO pg_temp.op2a_probe (order_id, rail, amount, received_at, rec_trade_id, actor)
  VALUES ('00000000-0000-0000-0000-000000000000', 'card', 500, pg_catalog.now(), 'probe', 'probe');
  -- 🔴 後驗:`RETURN NULL` 是**零錯誤**吞寫 ⇒ 只看「沒報錯」證不到任何事,要數列。
  SELECT pg_catalog.count(*)::integer INTO v_n FROM pg_temp.op2a_probe;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '鏡像表 INSERT 後有 % 列(期望 1)⇒ 函式把合法寫入吞掉了(RETURN NULL 形狀)', v_n
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_insert_swallowed';
  END IF;
  -- 🔴🔴 **關卡2 must-fix:欄值要逐欄比,不能只數列。** `NEW.amount := 999; RETURN NEW;`
  --    完全通過「恰一個 RETURN NEW」的正規式(那是文字面),而列數也還是 1 ⇒ 兩道都全綠,
  --    卻把金額改掉了。**這支函式的契約是「只擋、不改」** ⇒ 把它寫成可觀測的斷言。
  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM pg_temp.op2a_probe
   WHERE order_id = '00000000-0000-0000-0000-000000000000'
     AND rail = 'card' AND amount = 500 AND rec_trade_id = 'probe' AND actor = 'probe'
     AND reverses_payment_id IS NULL AND note IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '鏡像表那一列的欄值被改過(逐欄比對命中 % 列,期望 1)'
                    '⇒ 這支函式應該只擋、不改任何欄(`NEW.x := …; RETURN NEW;` 通得過文字面的守門)', v_n
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_function_mutates_row';
  END IF;

  -- P4:UPDATE 別的欄 ⇒ 必須真的改到值(不是「沒報錯」)。
  UPDATE pg_temp.op2a_probe SET note = 'p4';
  SELECT pg_catalog.count(*)::integer INTO v_n FROM pg_temp.op2a_probe WHERE note = 'p4';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'P4 的 UPDATE 沒改到值(命中 % 列)⇒ 函式在 UPDATE 面吞寫', v_n
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_update_swallowed';
  END IF;

  -- 🔴 P6(R3 Fable consider F2 補的一格):**UPDATE `received_at` 成合法的「過去」值必須放行。**
  --    少了這格,一個**過嚴**的實作(例如「UPDATE 時一律禁止改 received_at」)會讓
  --    原本 11 發突變**全綠**,而合法的更正被擋掉 —— 負向測得再密也照不到「太嚴」這個方向。
  --    這格是在 v2→v3 換做法時掉的,不是沒想到。
  -- 🔴 要包自己的 EXCEPTION:過嚴的實作會**直接拋守門碼**,若不接住,紅的會是突變自己的訊息
  --    (實測:一個「UPDATE 一律禁止改 received_at」的突變紅在 `P2B31 received_at 不得修改`)——
  --    有紅但診斷沒用,下一個人看不出是「太嚴」。與 P 格那個 ROW_COUNT 誤診是同一類毛病。
  DECLARE v_con text;
  BEGIN
    UPDATE pg_temp.op2a_probe SET received_at = pg_catalog.now() - interval '1 day';
  EXCEPTION
    WHEN SQLSTATE 'P2B31' THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      RAISE EXCEPTION 'P6:把 received_at 改成**合法的過去值**被守門擋掉了(conname=%)⇒ 閘太嚴,'
                      '合法的更正做不到。負向測得再密也照不到這個方向', coalesce(v_con, '(NULL)')
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_past_update_rejected';
  END;
  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM pg_temp.op2a_probe WHERE received_at < pg_catalog.now() - interval '23 hours';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'P6:把 received_at 改成合法的過去值沒有生效(命中 % 列)⇒ UPDATE 被吞掉了', v_n
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_past_update_rejected';
  END IF;
  -- 🔴🔴 **UPDATE 之後也要逐欄比(關卡2 R2 must-fix)**:上一版的逐欄後驗只跑在 INSERT 之後
  --    ⇒ 一支「只在 `TG_OP = 'UPDATE'` 時偷改 `NEW.amount`」的函式**十六發靶全綠**。
  --    P4/P6 只驗了 note 與 received_at,其餘欄位沒人看。
  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM pg_temp.op2a_probe
   WHERE order_id = '00000000-0000-0000-0000-000000000000'
     AND rail = 'card' AND amount = 500 AND rec_trade_id = 'probe' AND actor = 'probe'
     AND reverses_payment_id IS NULL AND note = 'p4';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'UPDATE 之後那一列的欄值被改過(逐欄比對命中 % 列,期望 1)'
                    '⇒ 函式在 UPDATE 面偷改欄位;只擋不改的契約兩個事件都要守', v_n
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_function_mutates_row';
  END IF;

  -- N4:UPDATE received_at 成未來 ⇒ 必須紅在守門 conname。
  DECLARE v_con text;
  BEGIN
    UPDATE pg_temp.op2a_probe
       SET received_at = pg_catalog.clock_timestamp() + interval '1 minute';
    RAISE EXCEPTION 'N4:UPDATE 成未來時點沒被擋 ⇒ 閘只守 INSERT'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_update_not_guarded';
  EXCEPTION
    WHEN SQLSTATE 'P2B20' THEN RAISE;
    WHEN SQLSTATE 'P2B31' THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con IS DISTINCT FROM 'pcm_op2_received_at_future' THEN
        RAISE EXCEPTION 'N4 紅了但 conname 是 %', coalesce(v_con, '(NULL)')
          USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_wrong_conname';
      END IF;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      RAISE EXCEPTION 'N4 被別的東西擋住(%)', coalesce(v_con, '(未提供)')
        USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_guard_wrong_blocker';
  END;

  DROP TABLE pg_temp.op2a_probe;

  -- ⑧ 收尾:真表零列、dormant gate 仍在。
  --    ⚠️ 誠實邊界:探針全部沒寫進真表(每發都被擋),所以「零列」是**沒發生過寫入**,
  --       不是「寫了再回滾」。回滾類的宣稱一律只能講「零可見業務列」,WAL / dead tuple /
  --       server log 都還在 —— 本片沒有那類宣稱,寫在這裡是免得下一個人抄錯口徑。
  SELECT pg_catalog.count(*)::integer INTO v_n FROM public.order_payments;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '真表有 % 列 ⇒ 探針留下了東西', v_n
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_probe_residue';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conname = 'order_payments_dormant_until_triggers'
                    AND conrelid = 'public.order_payments'::regclass) THEN
    RAISE EXCEPTION 'dormant gate 不見了 ⇒ 本片不該碰它(DROP 是 OP2b 的事)'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op2a_gate_missing';
  END IF;

  -- 🔴 關卡2 nit:NOTICE 的「零 EXECUTE」原本是全稱口氣,但三道 ACL 斷言看的都是**直接授權**
  --    與四個具名角色 —— 經由 role 繼承、owner 身分、或 superuser 拿到 EXECUTE 的路,表層斷言看不到。
  --    ⇒ 措辭收窄成它真正證到的東西。
  RAISE NOTICE 'OP2a 驗收通過:trigger 綁定 tgtype=23 逐字、本表 trigger 集合凍結、函式恰一個 RETURN NEW、非 SECDEF、proconfig 逐字、proacl 非 NULL 且直接 ACL 中 owner 以外零 grantee、四個具名角色的有效 EXECUTE 皆為假(has_function_privilege 已含它們經 role 繼承取得的;**未涵蓋**=清單外的角色、owner 身分與 superuser)、三軌未來值(+1 分)與 +2 秒邊界值與沖銷列未來值皆紅在守門、三軌當下值過閘後紅在 dormant gate、P5 證基準是 clock_timestamp() 非 now()、鏡像表 INSERT/UPDATE 四格(列數 + 逐欄值後驗 + 合法過去值放行)、真表零列、dormant gate 仍在';
END
$op2a_asserts$;

COMMIT;
