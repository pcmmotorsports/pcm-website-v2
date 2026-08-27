-- ============================================================
-- L5b-2 片 2a · **回退腳本**(可直接執行,不是座標清單)
-- ============================================================
-- 標的:supabase/migrations/20260811060000_m4b_lifecycle_l5b2_2a_claim_returns_superseded_at.sql
-- 作用:把 public.claim_stuck_unsettled_attempts 還原成 L5b-0-s 的**三欄**版(2a 的 pre-image)。
--
-- 用法(整份跑,不要只跑其中幾句):
--   psql "$DSN" -v ON_ERROR_STOP=1 -f scripts/l5b2-2a-rollback.sql
--
-- 🔴 **誰跑、用哪條 DSN**(Fable R3 nit:原本沒寫,值班半夜看到這檔會不知道要拿哪把鑰匙):
--   · **誰**  = 主視窗(施工窗碰不到正式 DSN);正式庫的回退**需 Sean 拍板**,與 apply 同一個停點層級。
--   · **DSN** = 與 apply 同一條(`supabase db push` 用的那條 service/postgres 連線)。
--               本檔要 `DROP`/`CREATE`/`ALTER … OWNER`/`GRANT` ⇒ **必須是函式 owner 或更高權**,
--               `payment_confirmer` 那條**跑不動**(它只有 EXECUTE)。
--   · **取法** = 照既有紀律 grep 單顆,**絕不 `source .env.local`**
--               (memory `reference_never-source-env-local-use-grep`)。
--   · 本機驗證叢集則走 `postgresql://postgres@127.0.0.1:<PORT>/postgres`(`scripts/l5b2-2a-verify.sh` 自動跑)。
--
-- 🔴🔴 **為什麼它必須是「一個檔、單一交易」而不是寫在 migration 檔尾的註解座標**
--   本片是 DROP+重建 ⇒ 回退也是 DROP+重建。逐句手跑(psql -f 逐句 autocommit、無 ON_ERROR_STOP)之下,
--   只要 CREATE 之後那幾句 ACL 有任何一句沒跑到(手滑、中途停手、貼漏),
--   庫裡就留下一支**前台角色可 EXECUTE 的金流 RPC**,而且外觀完全正常。
--   包成單一交易 ⇒ 任一句失敗,其餘句死於 `current transaction is aborted`,整份回滾。
--   (教訓:memory `feedback_guard-effect-depends-on-how-it-is-executed`)
--
-- 🔴 **它不是死檔:`scripts/l5b2-2a-verify.sh` 的每一次 reset 都跑這一支**
--   ⇒ 這份回退腳本在每輪驗證裡被實際執行十幾次,不會變成「寫了沒人跑過」的紙上回退。
--
-- 🔴 回退**先決條件**(執行前自己確認,本腳本擋不了):
--   加的第四欄若已有下游在用(L5b-2 的 2b 型別接線 / 2i 決策函式 / 2j 分派入口),
--   回退會讓那些呼叫端拿不到 superseded_at。2a 當下呼叫端是具名取三欄
--   (`packages/adapters/src/payment/PgChargeAttemptAdapter.ts:171`)⇒ 安全;2b 之後就不是了。
--
-- ⚠️ **還原回去的 COMMENT 裡有一句已知的過度宣稱**(對抗審查 R2 指出,這裡刻意保留):
--   L5b-0-s 那份 COMMENT 逐字寫「只 payment_confirmer 可呼」,而準確說法是
--   「**直接** EXECUTE 只授 payment_confirmer;owner 持有的 SECDEF wrapper / 動態 SQL 轉呼等
--   **間接可達**不在任何斷言的射程內」。2a 的 COMMENT 已改寫成準確版。
--   本檔**仍逐字還原舊版**——因為回退的定義就是「回到 pre-image 的那個狀態」,
--   把措辭偷偷改好會讓這份腳本不再是真的回退(functiondef 之外的東西也一樣)。
--   ⇒ 修 L5b-0-s 那份措辭是**另一片的事**,不在回退腳本裡順手做。
--
-- ⚠️ 回退後的業務後果:補償線的第一條准退條件讀不到 durable 標記
--   ⇒ 整條補償**不會誤退,只會不退**(fail-closed 方向正確),
--   但「被讓路那族的錢卡在外面」回到**沒有自動出口**的狀態,值班要靠人工佇列承接。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- 🔴 與 migration 三件對稱(Fable R3 nit):少了它,回退交易可以無限期掛著,
--    而回退最常發生在**已經出事、大家都在等**的時刻 —— 那正是最不該無界等待的時候。
SET LOCAL transaction_timeout = '90s';

-- ① 先捕捉現況 owner(DROP 會帶走它;owner 名字跨環境不同,不寫死)
-- 🔴 用 `to_regprocedure()` 不用 `::regprocedure`(Fable R3 nit,成立):
--    `::regprocedure` 對**不存在**的函式會當場丟 42883,下面那句「目標函式不存在」的友善訊息
--    **永遠執行不到 = 死碼**。`to_regprocedure()` 查無回 NULL ⇒ 溫和地讓 temp table 空著,
--    友善訊息才有機會說話。(同族:runbook 那條 `to_regrole` 不用 `::regrole` 的理由。)
CREATE TEMP TABLE l5b2_2a_rb_owner ON COMMIT DROP AS
  SELECT pg_catalog.pg_get_userbyid(p.proowner) AS owner_name
    FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.claim_stuck_unsettled_attempts(integer,integer)');

DO $rb_guard$
DECLARE
  c_fn   constant text := 'public.claim_stuck_unsettled_attempts(integer,integer)';
  c_post constant text := '8b90444daff704fb45046605bd8fe1bf';  -- 2a 的 post-image prosrc(要回退的那版)
  c_pre  constant text := 'dda1fdbd680632432a22a3f092c4b9ec';  -- L5b-0-s 三欄版 prosrc(回退目的地)
  v_now  text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM l5b2_2a_rb_owner) THEN
    RAISE EXCEPTION 'L5b-2-2a rollback:目標函式不存在 ⇒ 沒有東西可回退,停下人工確認';
  END IF;

  -- 🔴🔴 **回退前必須確認「我要回退的就是 2a」**(對抗審查 R2 打中,成立)
  --    上一版直接 DROP 現況、再貼上 L5b-0-s 的本體 —— 那是**盲目回退**:
  --    未來 L5b-2 的 2m 會再改同一支函式(排除已 result_confirmed 的 attempt);
  --    2m 上線之後有人誤跑本檔 ⇒ **2m 的述詞被整個抹掉、悄悄退回三欄**,而且看起來成功。
  --    ⇒ 只接受兩種現況:①正是 2a 的 post-image(正常回退)②已經是 pre-image(重複執行,冪等)。
  --      其餘一律停:別片動過它,回退的目的地就不再是這份腳本寫死的那個。
  -- 走到這裡函式一定在(上面那道已擋),但仍用 to_regprocedure 保持與上面同一種取法
  SELECT md5(prosrc) INTO v_now FROM pg_catalog.pg_proc WHERE oid = pg_catalog.to_regprocedure(c_fn);
  IF v_now NOT IN (c_post, c_pre) THEN
    RAISE EXCEPTION 'L5b-2-2a rollback:現況 prosrc md5=[%] 既不是 2a 的 post-image [%]、也不是 pre-image [%] '
                    '⇒ **這支函式已被別的片改過**(例如 L5b-2 的 2m),盲目回退會把那片的改動一起抹掉。'
                    '停下人工判斷:先確認要回退到哪一版,再決定用哪份腳本', v_now, c_post, c_pre;
  END IF;
  IF v_now = c_pre THEN
    RAISE NOTICE 'L5b-2-2a rollback:現況已是 pre-image(三欄版)⇒ 本次為冪等重跑,仍會重設 ACL 四件並自驗';
  END IF;
END
$rb_guard$;

-- ② DROP(不加 CASCADE:有相依物就讓它紅在這裡)
DROP FUNCTION public.claim_stuck_unsettled_attempts(integer, integer);

-- ③ 還原本體 + 簽章 = 20260810220000:206-251 **逐字**(下面這段由腳本從該檔抽出,非手抄)
CREATE OR REPLACE FUNCTION public.claim_stuck_unsettled_attempts(
  p_age_seconds integer,
  p_limit       integer
)
RETURNS TABLE(attempt_id uuid, order_id uuid, settle_attempt_count integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH claimed AS (
    SELECT a.id
      FROM public.payment_charge_attempts a
      JOIN public.orders o ON o.id = a.order_id
     WHERE (
             ( a.status IN ('pending', 'charged')
               AND a.needs_manual_review = false
               AND a.settle_attempt_count < 8 )       -- pending/charged 維持既有 manual/ceiling 閘
             -- 🔴 L5b-0-s 改①(甲):R1c1 讓 released 繞 manual/ceiling,理由是「持續低頻對帳直到 terminal」。
             --    L5b-0 把**被讓路那族的 terminal 拿掉了**(它永遠不會轉 charged)⇒ 對它而言
             --    「繞 ceiling」= 每 16 分鐘一發 TapPay Record API、永不停止。⇒ 這族回到閘內。
             -- ⚠️ **不可以只寫 `OR (released AND superseded_at IS NULL)`**:那樣被讓路那族的 status
             --    是 released、過不了上面 pending/charged 那支 ⇒ **整個落出 claim** ⇒ 永不再被 claim
             --    ⇒ mark_attempt_settle_retry 永不跑 ⇒ 連 12h 的 released_manual_review_at 都不會寫
             --    ⇒ 無聲消失。要的是「回到閘內」不是「排除掉」,所以是三支不是兩支。
             OR ( a.status = 'released'
                  AND a.superseded_at IS NULL )        -- 未讓路的 released:維持 R1c1 繞閘、行為不回歸
             OR ( a.status = 'released'
                  AND a.superseded_at IS NOT NULL      -- 讓路那族:回到 manual/ceiling 閘、8 輪後轉人工
                  AND a.needs_manual_review = false
                  AND a.settle_attempt_count < 8 )
           )
       AND o.payment_status = 'unpaid'::public.payment_status               -- 對所有狀態保留
       AND (a.next_settle_at IS NULL OR a.next_settle_at <= pg_catalog.now()) -- lease/throttle、對所有狀態保留
       AND p_age_seconds >= 0
       AND a.created_at < pg_catalog.now() - pg_catalog.make_interval(secs => p_age_seconds) -- age-gate、對所有狀態保留
     ORDER BY a.created_at
     FOR UPDATE OF a SKIP LOCKED
     LIMIT LEAST(GREATEST(p_limit, 1), 1000)
  )
  UPDATE public.payment_charge_attempts a
     SET settle_attempt_count = a.settle_attempt_count + 1,
         next_settle_at = pg_catalog.now() + interval '5 minutes'
    FROM claimed
   WHERE a.id = claimed.id
  RETURNING a.id AS attempt_id, a.order_id AS order_id, a.settle_attempt_count AS settle_attempt_count;
$fn$;

-- ④ ACL 四件(DROP 又把它們帶走了,一件都不能少)
-- ④-1 owner 還原成 ① 捕捉到的那個
DO $rb_owner$
DECLARE v_owner text;
BEGIN
  SELECT owner_name INTO v_owner FROM l5b2_2a_rb_owner;
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION public.claim_stuck_unsettled_attempts(integer, integer) OWNER TO %I', v_owner);
END
$rb_owner$;

-- ④-2 🔴 **不能只 REVOKE PUBLIC**:本庫對 schema public 的函式有 ALTER DEFAULT PRIVILEGES
--      ⇒ 新建函式一出生就被**具名授權**給 anon/authenticated/service_role,
--      而 `REVOKE … FROM PUBLIC` 對具名 grantee 完全無效(2026-08-11 本機實測撞到)。
REVOKE ALL ON FUNCTION public.claim_stuck_unsettled_attempts(integer, integer)
  FROM PUBLIC, anon, authenticated, authenticator, service_role;

-- ④-3 還原唯一的 grantee
GRANT EXECUTE ON FUNCTION public.claim_stuck_unsettled_attempts(integer, integer) TO payment_confirmer;

-- ④-4 COMMENT 還原 = 20260810220000:253-257 逐字(同樣由腳本抽出)
COMMENT ON FUNCTION public.claim_stuck_unsettled_attempts(integer, integer) IS
  'M-3 3DS-4a-2 + R1c1 + M-4b L5b-0-s(甲)改①:原子 lease claim stuck unsettled attempt(FOR UPDATE OF a SKIP LOCKED + LIMIT)。settle_attempt_count++(claim token)+ 5min lease。'
  '濾 **三支**((status IN(pending,charged) AND 非 manual AND settle_attempt_count<8)〔基線 manual/ceiling 閘〕 OR (status=released AND superseded_at IS NULL)〔R1c1:**未讓路**的 released 繞 manual/ceiling、持續低頻對帳直到 terminal〕 OR (status=released AND superseded_at IS NOT NULL AND 非 manual AND settle_attempt_count<8)〔L5b-0-s:**被讓路**的 released 回到 manual/ceiling 閘〕) AND order unpaid(含 charged-unpaid 群1)AND lease 到期 AND created_at < now()-p_age_seconds(p_age_seconds<0/NULL→空、fail-closed)。回 attempt_id/order_id/settle_attempt_count。只 payment_confirmer 可呼。'
  '🔴 為什麼讓路那族要回到閘內:R1c1 讓 released 繞閘的前提逐字是「持續低頻對帳直到 terminal」,而 L5b-0-m 把被讓路那族的 terminal 拿掉了(它永遠不會轉 charged)⇒ 繞閘等於每 16 分鐘一發 TapPay Record API、永不停止、也永遠沒有人被通知。⚠️ 不可以寫成「只排除讓路那族」——那樣它整個落出 claim、連 12h marker 都不會寫 = 無聲消失。'
  '⚠️ 本述詞的 count<8 只管得住「從 0 起跑」的列;**既有 count>=8 的列由 expire_stuck_attempts_at_ceiling 收網**(同片改④),兩者合起來才沒有孤兒。';

-- ⑤ 回退後自驗(fail-closed;沒有這段,「回退成功」只是「沒報錯」)
DO $rb_verify$
DECLARE
  c_fn constant text := 'public.claim_stuck_unsettled_attempts(integer,integer)';
  v_acl text;
  v_role text;
BEGIN
  -- 回傳形狀必須回到**三欄**
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = c_fn::regprocedure
       AND pg_catalog.array_length(p.proargnames, 1) = 5
       AND p.proargnames[3:5] = ARRAY['attempt_id','order_id','settle_attempt_count']
  ) THEN
    RAISE EXCEPTION 'L5b-2-2a rollback:回傳形狀沒回到三欄 ⇒ 回退沒成功';
  END IF;
  -- ACL 終態:非 owner grantee 恰為 payment_confirmer:EXECUTE
  SELECT COALESCE(string_agg(DISTINCT
           (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE g.rolname END) || ':' || a.privilege_type
           || (CASE WHEN a.is_grantable THEN ':GRANTABLE' ELSE '' END), ','), '')
    INTO v_acl
    FROM pg_catalog.pg_proc p
    LEFT JOIN LATERAL pg_catalog.aclexplode(p.proacl) a ON a.grantee <> p.proowner
    LEFT JOIN pg_catalog.pg_roles g ON g.oid = a.grantee
   WHERE p.oid = c_fn::regprocedure;
  IF v_acl <> 'payment_confirmer:EXECUTE' THEN
    RAISE EXCEPTION 'L5b-2-2a rollback:ACL 終態=[%],期望恰 [payment_confirmer:EXECUTE]', v_acl;
  END IF;
  IF (SELECT p.proacl IS NULL FROM pg_catalog.pg_proc p WHERE p.oid = c_fn::regprocedure) THEN
    RAISE EXCEPTION 'L5b-2-2a rollback:proacl 是 NULL ⇒ REVOKE 沒跑到,函式對 PUBLIC 敞開';
  END IF;
  -- 正向 + 三個前台角色負向
  IF NOT pg_catalog.has_function_privilege('payment_confirmer', c_fn::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'L5b-2-2a rollback:payment_confirmer 呼不到 ⇒ sweeper 會整條啞掉';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF pg_catalog.has_function_privilege(v_role, c_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'L5b-2-2a rollback:角色 % 有有效 EXECUTE ⇒ 回退把權限敞開了', v_role;
    END IF;
  END LOOP;
  -- 🔴 COMMENT 必須回到 L5b-0-s 那份(ACL 四件之④;R2 打中:原本一個字都沒驗)
  --    刪掉 COMMENT 這句、或留著 2a 那份,回退都會「看起來成功」。
  IF pg_catalog.obj_description(c_fn::regprocedure, 'pg_proc') IS NULL
     OR pg_catalog.strpos(pg_catalog.obj_description(c_fn::regprocedure, 'pg_proc'),
                          'L5b-0-s(甲)改①') = 0
     OR pg_catalog.strpos(pg_catalog.obj_description(c_fn::regprocedure, 'pg_proc'),
                          'L5b-2 片2a') > 0 THEN
    RAISE EXCEPTION 'L5b-2-2a rollback:COMMENT 沒回到 L5b-0-s 那份(不見/仍是 2a 那份)⇒ 回退不完整。實際=[%]',
                    COALESCE(pg_catalog.obj_description(c_fn::regprocedure, 'pg_proc'), '(NULL)');
  END IF;

  -- SECDEF / search_path 語境
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = c_fn::regprocedure
       AND ( NOT p.prosecdef OR p.proconfig IS NULL
             OR NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(p.proconfig) c
                             WHERE c IN ('search_path=""', 'search_path=')) ) ) THEN
    RAISE EXCEPTION 'L5b-2-2a rollback:還原後不是 SECDEF、或 search_path 沒釘空';
  END IF;
  RAISE NOTICE 'L5b-2-2a rollback 完成:已回到 L5b-0-s 三欄版,ACL 四件與執行語境自驗通過';
END
$rb_verify$;

COMMIT;
