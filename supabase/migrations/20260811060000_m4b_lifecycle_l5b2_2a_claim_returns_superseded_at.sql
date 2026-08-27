-- ============================================================
-- M-4b · L5b-2 片 2a:claim RPC `DROP`+重建 —— 回傳形狀加 `superseded_at`
-- 依據:docs/specs/2026-08-10-l5b-2-compensation-writer-plan.md(v8,commit 841b5e8d)§2 片表 2a、§2a、§2f-4
-- 鐵則 12:①錢(退款線的觸發來源)③DB 結構(動已上線 SECDEF RPC 的簽章)
--
-- ── 為什麼要加這一欄 ────────────────────────────────────────
-- 補償退款的**第一條**准退條件是 `superseded_at IS NOT NULL`(plan 核心點 2 條件 1):
-- 「durable 讓路標記」,**不能只看 `status='released'`」—— preflight release CAS 也產生 released
-- (母 plan §6 明列未涵蓋)。claim 是**原子 lease**,被 claim 的那一列在同一句 UPDATE 裡就決定了;
-- 若改成 claim 完再 SELECT 一次讀 `superseded_at`,那是**另一個時點的觀察**(TOCTOU),
-- 而這一欄正是用來決定「要不要送錢出去」的。⇒ 必須由 claim 自己回傳。
--
-- ── 為什麼是 `DROP`+重建,不是 `CREATE OR REPLACE` ──────────
-- PG **不允許** `CREATE OR REPLACE` 改變既有函式的回傳型別(`42P13`),加寬 `RETURNS TABLE` 也算。
-- 🔴 反證一直在手上:同一支函式的上一片(L5b-0-s)就是 `CREATE OR REPLACE` 且**刻意沒動回傳形狀**
--    (`20260810220000:210`)。⇒ 只能 DROP+重建。
-- 🔴 而 `DROP FUNCTION` 會一起帶走 **owner / ACL / COMMENT**,且**新建函式預設 `PUBLIC` 可 `EXECUTE`**
--    ⇒ 只「補回 payment_confirmer 的 GRANT」會留下一個**全世界可呼的金流 RPC**。
--    本片的同一支交易必須完成四件(plan §2f-4):①REVOKE PUBLIC(顯式)②GRANT 還原
--    ③owner 對齊 ④COMMENT 重寫 —— 缺一不可,四件都有斷言。
--
-- ── 替代案(另開專用 claimer)已駁回 ─────────────────────────
-- 兩個 claimer 會共用同一組 lease 欄位(`settle_attempt_count` + `next_settle_at`,
-- `20260810220000:246-247` 的 SET 本體)⇒ 兩條線各自 `++` 同一個計數,ceiling(`<8`)被一起吃掉、
-- 退避時間互相覆蓋,症狀是「有時候補償不跑」= 最難查的那種。(plan §2a)
--
-- ── pre-image 指紋:兩個環境都量過、值相同 ───────────────────
-- `md5(pg_get_functiondef('public.claim_stuck_unsettled_attempts(integer,integer)'::regprocedure))`
--   · 本機 Homebrew PG **17.10** 拋棄式叢集(2026-08-11,P 窗量):`98a064dabe40782b84a4450d959d3bd5`
--   · **正式庫** server_version **17.6**(2026-08-11,主視窗當場量):`98a064dabe40782b84a4450d959d3bd5`
-- ⚠️ `pg_get_functiondef` 由伺服器重組 ⇒ **輸出格式與版本相依**,這正是它要兩個環境對過才敢寫死的原因
--    (`20260810220000:100-101` 自己留的失效條件)。兩顆值**都記在這裡,不只留一顆**。
--    未來對不上:先 `SHOW server_version;` —— **格式差異可重算常數、行為差異一律停**。
--
-- ── apply 當下的併發行為:**實測過,不是推論** ────────────────
-- 🔴 我第一版在這裡寫「sweeper cron 若剛好撞上,那一輪會失敗(function does not exist / 鎖等待)」。
--    **那是錯的,而且方向是把風險講大。** 對抗審查點出它沒被證明,我去量了(本機 PG17.10):
--
--    A 連線:`BEGIN; DROP FUNCTION …;`(不 commit,持續持有)
--      證據 `pg_locks`:`object | AccessExclusiveLock | granted=t`,且 DROP 之後的 marker 已印出。
--    B 連線:在 A 持鎖期間呼叫同一支函式 ⇒ **成功,claim 到 1 列**,沒被擋、沒報錯。
--
--    原因:**執行**一支函式不對 `pg_proc` 取任何衝突鎖,而未提交的 DROP 對別的 session 的
--    catalog 快照不可見 ⇒ 併發呼叫看到的是**舊定義**,照常跑完。
-- ⇒ 正確的敘述:**apply 交易期間,sweeper 照舊用三欄版跑;commit 之後的下一次呼叫拿到四欄版。**
--    既有呼叫端是具名取三欄(`PgChargeAttemptAdapter.ts:171`)⇒ 兩版本都餵得動它。
-- ⚠️ 誠實邊界:①只在本機 17.10 量過,正式庫 17.6 未量 ②沒有構造「commit 那一瞬間正在執行」
--    的窗;若某個 session 帶著**已快取的計畫**(prepared statement / plpgsql 快取)撐過 commit,
--    理論上會拿到 `cache lookup failed for function` —— 本片**沒有證明它不會發生**,
--    只知道現行呼叫端每次重送 SQL 文字、不吃這條路徑。
-- ============================================================


BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';


-- ── 0. 前置閘(fail-closed):pre-image 沒漂移、依賴都在,才准 DROP ──────────
DO $l5b2_2a_preflight$
DECLARE
  v_md5 text;
  c_md5_claim constant text := '98a064dabe40782b84a4450d959d3bd5';  -- 20260810220000:206 的 post-image
BEGIN
  -- ① `superseded_at` 欄必須存在:它就是本片要回傳的東西,不在就是 L5a-M 未 apply
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.payment_charge_attempts'::regclass
       AND attname = 'superseded_at' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'L5b-2-2a 前置閘:payment_charge_attempts.superseded_at 不存在 ⇒ L5a-M 未 apply,停下';
  END IF;

  -- ② `payment_confirmer` 角色必須存在
  -- 🔴 為什麼要**先**查:本片是 DROP+重建。若角色不存在,DROP 與 CREATE 會成功、
  --    後面那句 `GRANT … TO payment_confirmer` 才炸 ⇒ 整支交易確實會回滾(所以資料是安全的),
  --    但錯誤訊息會指向 GRANT 那一行、看起來像「權限設定寫錯」,而真因是**環境根本沒有這個角色**。
  --    早停一句,錯誤就指對地方。
  IF pg_catalog.to_regrole('payment_confirmer') IS NULL THEN
    RAISE EXCEPTION 'L5b-2-2a 前置閘:角色 payment_confirmer 不存在(`20260611120000:62` 建立)⇒ '
                    '本片的 GRANT 無對象,停下人工確認這是哪個環境';
  END IF;

  -- ③ pre-image:live 定義必須逐字等於 L5b-0-s 留下的那版
  -- 🔴 這道閘在本片比在 CREATE OR REPLACE 的片**更重要**:那邊漂移只是「被靜默蓋掉」,
  --    這邊是 `DROP` —— 對不上就代表我要刪掉的**不是我以為的那支函式**,而 DROP 之後原本的定義就沒了。
  v_md5 := md5(pg_get_functiondef('public.claim_stuck_unsettled_attempts(integer,integer)'::regprocedure));
  IF v_md5 <> c_md5_claim THEN
    RAISE EXCEPTION 'L5b-2-2a 前置閘:claim_stuck_unsettled_attempts 的 live 定義與 pre-image 不符。'
                    '實際 md5=% / 期望=%(本機 17.10 與正式庫 17.6 兩邊量到同一顆,見檔頭)。'
                    '⚠️ 本片是 **DROP**+重建 ⇒ 對不上代表要刪的不是預期的那支,'
                    '**先 SHOW server_version;**:格式差異可重算常數、行為差異一律停', v_md5, c_md5_claim;
  END IF;
END
$l5b2_2a_preflight$;


-- ── 1. 捕捉 pre-image 的 owner(DROP 會帶走它)────────────────────────────
-- 🔴 為什麼捕捉而不是寫死 `OWNER TO postgres`:owner 名字**跨環境不同**,寫死等於在別的環境靜默改 owner。
--    這裡要的不變量是「**DROP+重建前後 owner 沒變**」,那就直接把它記下來、原樣還原、再斷言相等。
--    (`ON COMMIT DROP` ⇒ 交易結束自動消失,不留痕。)
CREATE TEMP TABLE l5b2_2a_preimage_owner ON COMMIT DROP AS
  SELECT pg_catalog.pg_get_userbyid(p.proowner) AS owner_name
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.claim_stuck_unsettled_attempts(integer,integer)'::regprocedure;


-- ── 2. DROP ────────────────────────────────────────────────────────────────
-- 🔴 **不加 `CASCADE`**:有任何相依物(view / 另一支函式 / 觸發器)時,讓它**紅在這裡**,
--    而不是安靜地把別人一起刪掉。fail-closed。
DROP FUNCTION public.claim_stuck_unsettled_attempts(integer, integer);


-- ── 3. 重建:述詞逐字沿用 L5b-0-s,只加第四個回傳欄 ────────────────────────
CREATE FUNCTION public.claim_stuck_unsettled_attempts(
  p_age_seconds integer,
  p_limit       integer
)
RETURNS TABLE(attempt_id uuid, order_id uuid, settle_attempt_count integer, superseded_at timestamptz)
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
  RETURNING a.id                  AS attempt_id,
            a.order_id            AS order_id,
            a.settle_attempt_count AS settle_attempt_count,
            -- 🔴 L5b-2-2a:讓路的 durable 標記,由 claim **在同一句原子 UPDATE 裡**回傳。
            --    補償退款的第一條准退條件讀它(plan 核心點 2 條件 1);
            --    分開再 SELECT 一次 = 另一個時點的觀察(TOCTOU),而這欄是用來決定要不要送錢的。
            --    ⚠️ 本欄**不參與述詞**(上面三支濾網逐字未動)⇒ 本片對 claim 的**選取行為零改變**。
            a.superseded_at       AS superseded_at;
$fn$;


-- ── 4. ACL 四件(plan §2f-4;`DROP` 帶走 owner/ACL/COMMENT,四件缺一不可)────
-- ④-1 owner 還原成 pre-image 捕捉到的那個(不寫死名字)
DO $l5b2_2a_owner$
DECLARE
  v_owner text;
BEGIN
  SELECT owner_name INTO v_owner FROM l5b2_2a_preimage_owner;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'L5b-2-2a:pre-image owner 沒被捕捉到 ⇒ 不知道要還原成誰,停下';
  END IF;
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION public.claim_stuck_unsettled_attempts(integer, integer) OWNER TO %I', v_owner);
END
$l5b2_2a_owner$;

-- ④-2 顯式 REVOKE
-- 🔴🔴 **`FROM PUBLIC` 一個人不夠 —— 這是本機實跑抓到的,不是預想的。**
--   我原本只寫 `FROM PUBLIC`(照 plan §2f-4 的字面「新建函式預設 PUBLIC 可 EXECUTE」),
--   在本機全量 migration 叢集上跑,下面 ⑤ 的 allowlist 斷言直接紅:
--     非 owner grantee 集合 = [anon:EXECUTE, authenticated:EXECUTE, payment_confirmer:EXECUTE, service_role:EXECUTE]
--   真因:本庫對 schema public 的函式有 **`ALTER DEFAULT PRIVILEGES`** ⇒ 新建函式會被**具名授權**
--   給 anon/authenticated/service_role。那是**具名 grantee,不是 PUBLIC** ⇒ `REVOKE … FROM PUBLIC` **完全碰不到它**。
--   ⇒ 「DROP+重建之後只剩 PUBLIC 要處理」這個心智模型是錯的;**新建 = 三個前台角色預設就有 EXECUTE**。
-- ⚠️ 對本線後面的片同樣成立:**2g 是全新函式**,一樣會吃到這組 default privileges。
--   形制取本 repo 佔多數的那式(44 支用四元組、17 支含 authenticator);此處取**較嚴的 17 支那式**。
REVOKE ALL ON FUNCTION public.claim_stuck_unsettled_attempts(integer, integer)
  FROM PUBLIC, anon, authenticated, authenticator, service_role;

-- ④-3 還原唯一的 grantee
GRANT EXECUTE ON FUNCTION public.claim_stuck_unsettled_attempts(integer, integer) TO payment_confirmer;

-- ④-4 COMMENT 重寫(DROP 帶走了原本那份)
COMMENT ON FUNCTION public.claim_stuck_unsettled_attempts(integer, integer) IS
  'M-3 3DS-4a-2 + R1c1 + M-4b L5b-0-s(甲)改① + M-4b L5b-2 片2a:原子 lease claim stuck unsettled attempt(FOR UPDATE OF a SKIP LOCKED + LIMIT)。settle_attempt_count++(claim token)+ 5min lease。'
  '濾 **三支**((status IN(pending,charged) AND 非 manual AND settle_attempt_count<8)〔基線 manual/ceiling 閘〕 OR (status=released AND superseded_at IS NULL)〔R1c1:**未讓路**的 released 繞 manual/ceiling、持續低頻對帳直到 terminal〕 OR (status=released AND superseded_at IS NOT NULL AND 非 manual AND settle_attempt_count<8)〔L5b-0-s:**被讓路**的 released 回到 manual/ceiling 閘〕) AND order unpaid(含 charged-unpaid 群1)AND lease 到期 AND created_at < now()-p_age_seconds(p_age_seconds<0/NULL→空、fail-closed)。'
  '⚠️ 權限的準確說法(不要簡寫成「只 payment_confirmer 可呼」):**直接 EXECUTE 只授予 payment_confirmer**,且本片斷言了 anon/authenticated/service_role 的**有效**權限為假(含角色繼承閉包)與成員白名單。**射程之外**:owner 持有的其他 SECDEF 函式若把本支包起來、或動態 SQL 轉呼,前台角色仍可**間接**觸發它 —— 那條路直接 ACL、三個負向與成員白名單**全部看不到**。本片不宣稱擋得住間接可達。'
  '🔴 L5b-2 片2a:回傳**四欄** attempt_id/order_id/settle_attempt_count/**superseded_at**(原本三欄)。第四欄是**讓路的 durable 標記**(不能只看 status=released —— preflight release CAS 也產生 released)。由 claim 在同一句原子 UPDATE 裡回傳,而不是事後另外 SELECT,因為那是另一個時點的觀察(TOCTOU)而這欄將用來決定要不要送錢。'
  '⚠️ **現況是「備好、尚無人讀」**:2a 落地當下**沒有任何呼叫端取這一欄**(`PgChargeAttemptAdapter.ts:171` 仍是具名取三欄)。讀它的是後面的片(2b 型別接線 → 2i 決策函式 → 2j 分派入口)。本註解不得被讀成「補償線已在用它」。'
  '⚠️ 加欄**沒有動任何述詞** ⇒ claim 的選取行為與 L5b-0-s 版逐字相同;既有呼叫端 `SELECT attempt_id, order_id, settle_attempt_count FROM …`(PgChargeAttemptAdapter.ts:171)是具名取欄、不受多一欄影響。'
  '🔴 本支是 `DROP`+重建(PG 不准 CREATE OR REPLACE 改回傳型別 42P13)⇒ owner/ACL/COMMENT 都是本片重新設定的,不是繼承來的。'
  '⚠️ 本述詞的 count<8 只管得住「從 0 起跑」的列;**既有 count>=8 的列由 expire_stuck_attempts_at_ceiling 收網**(20260810220000 改④),兩者合起來才沒有孤兒。';


-- ── 5. 斷言(post-image;每一道都對應一個可構造的失效) ──────────────────
DO $l5b2_2a_asserts$
DECLARE
  c_fn constant text := 'public.claim_stuck_unsettled_attempts(integer,integer)';
  v_acl        text;
  v_role       text;
  v_owner_now  text;
  v_owner_pre  text;
BEGIN
  -- ① 回傳形狀:本片**唯一的功能改動**就是它
  -- 🔴 這道不可省、也不被別道蘊含:下面的 `prosrc` 指紋只釘**函式本體字面**,
  --    簽章與回傳型別**不在 prosrc 裡** ⇒ 「本體對、回傳形狀錯」對指紋是全綠的。
  -- 用 catalog 陣列而不是 `pg_get_function_result()`:後者是伺服器重組字串、跨版本格式相依
  --    (檔頭那顆 functiondef 指紋就是為了這個才要兩環境對);catalog 的 oid 陣列沒有這個問題。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = c_fn::regprocedure
       AND p.proargnames[3:6] = ARRAY['attempt_id','order_id','settle_attempt_count','superseded_at']
       AND p.proallargtypes[3:6] = ARRAY['uuid','uuid','int4','timestamptz']::regtype[]::oid[]
  ) THEN
    RAISE EXCEPTION 'L5b-2-2a assert:回傳形狀不是 (attempt_id uuid, order_id uuid, settle_attempt_count int4, superseded_at timestamptz)。'
                    '實際 names=% / types=%',
                    (SELECT p.proargnames FROM pg_catalog.pg_proc p WHERE p.oid = c_fn::regprocedure),
                    (SELECT (SELECT pg_catalog.array_agg(t::regtype::text ORDER BY o)
                               FROM pg_catalog.unnest(p.proallargtypes) WITH ORDINALITY AS u(t, o))
                       FROM pg_catalog.pg_proc p WHERE p.oid = c_fn::regprocedure);
  END IF;

  -- ② 本體 post-image 指紋:防「述詞被順手加料 / 搬位置」
  -- prosrc = `$fn$…$fn$` 之間的**檔內字面**、跨環境穩定(不是 functiondef,兩者取捨不同、不要混用)。
  IF md5((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = c_fn::regprocedure))
     <> '8b90444daff704fb45046605bd8fe1bf' THEN
    RAISE EXCEPTION 'L5b-2-2a assert:post-image prosrc 指紋不符 ⇒ 本檔的函式本體被改過(述詞加料/搬位置/其他)。實際=%',
                    md5((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = c_fn::regprocedure));
  END IF;

  -- ③ 執行語境:指紋管本體、本道管語境,缺一不可
  -- 非 SECDEF ⇒ 以 payment_confirmer 身分執行、它對 attempts/orders **零表權** ⇒ sweeper 整條啞掉;
  -- search_path 不空 ⇒ 函式內未限定的名稱可被解析劫持。兩種對 prosrc 指紋都是全綠。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = c_fn::regprocedure
       AND ( NOT p.prosecdef
             OR p.proconfig IS NULL
             OR NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(p.proconfig) c
                             WHERE c IN ('search_path=""', 'search_path=')) )
  ) THEN
    RAISE EXCEPTION 'L5b-2-2a assert:已非 SECURITY DEFINER、或 search_path 不再釘空 ⇒ 本體指紋對得上但執行語境壞了';
  END IF;

  -- ④ owner 還原(ACL 四件之③)
  SELECT owner_name INTO v_owner_pre FROM l5b2_2a_preimage_owner;
  SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO v_owner_now
    FROM pg_catalog.pg_proc p WHERE p.oid = c_fn::regprocedure;
  IF v_owner_now IS DISTINCT FROM v_owner_pre THEN
    RAISE EXCEPTION 'L5b-2-2a assert:owner 沒還原 —— DROP 前=[%] / 現在=[%]。'
                    '⚠️ owner 換人會讓「owner 的隱含 EXECUTE」落到別的角色頭上,而 proacl 允許清單看不到那條路',
                    v_owner_pre, v_owner_now;
  END IF;

  -- ⑤ proacl 不得為 NULL
  -- 🔴 **本道在這個資料庫裡構造不出負測 —— 誠實寫在這裡,不假裝它有突變。**
  --    我 R1 折的時候把它移到 allowlist 之前,理由是「【REVOKE+GRANT 都拿掉】會讓 proacl 變 NULL、
  --    因此能單獨打紅本道」。**那個推論被實跑推翻**(R2 nit,成立):本庫有 ALTER DEFAULT PRIVILEGES
  --    ⇒ 重建出來的函式 proacl **從一開始就非 NULL**,拿掉 REVOKE+GRANT 之後是
  --    `[PUBLIC:EXECUTE, anon:EXECUTE, authenticated:EXECUTE, service_role:EXECUTE]` 全開,紅的是 ⑥ 不是本道。
  --    ⇒ **本道在本庫恆真**,它的價值是**縱深**:在沒有 default privileges 的環境(裸 PG),
  --      重建的預設就是 proacl IS NULL = PUBLIC 可 EXECUTE,那時 ⑥ 的 string_agg 會是空字串、
  --      與「有 acl 但只有 owner」同形而分不出來,本道才是唯一擋得住的。
  --    留著它、但**不宣稱它被驗過**。(memory `feedback_unconstructible-negative-test-means-noop-guard`)
  IF (SELECT p.proacl IS NULL FROM pg_catalog.pg_proc p WHERE p.oid = c_fn::regprocedure) THEN
    RAISE EXCEPTION 'L5b-2-2a assert:proacl 是 NULL(=PUBLIC 預設可 EXECUTE)⇒ 顯式 REVOKE 不見了。'
                    '這是 DROP+重建**最容易漏**的一件:GRANT 補了、REVOKE 忘了,而 GRANT 成功會讓人以為權限設好了';
  END IF;

  -- ⑥ ACL allowlist:非 owner 的 grantee 集合必須**恰好**是 payment_confirmer:EXECUTE
  --    (PUBLIC 顯名、GRANT OPTION 納入字面;形制沿用 20260810220000:497-519)
  SELECT COALESCE(string_agg(DISTINCT
           (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE g.rolname END)
           || ':' || a.privilege_type
           || (CASE WHEN a.is_grantable THEN ':GRANTABLE' ELSE '' END),
           ',' ORDER BY
           (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE g.rolname END)
           || ':' || a.privilege_type
           || (CASE WHEN a.is_grantable THEN ':GRANTABLE' ELSE '' END)), '')
    INTO v_acl
    FROM pg_catalog.pg_proc p
    LEFT JOIN LATERAL pg_catalog.aclexplode(p.proacl) a ON a.grantee <> p.proowner
    LEFT JOIN pg_catalog.pg_roles g ON g.oid = a.grantee
   WHERE p.oid = c_fn::regprocedure;
  IF v_acl <> 'payment_confirmer:EXECUTE' THEN
    RAISE EXCEPTION 'L5b-2-2a assert:非 owner grantee 集合=[%],期望恰 [payment_confirmer:EXECUTE]', v_acl;
  END IF;

  -- ⑦ 🔴 schema USAGE:**`has_function_privilege` 不含這一段**(對抗審查 R1 打中,我實測證實)
  --    實測(本機 17.10):`REVOKE USAGE ON SCHEMA public FROM PUBLIC, payment_confirmer` 之後 ⇒
  --      `has_schema_privilege(...,'USAGE')` = **f**,而 `has_function_privilege(...,'EXECUTE')` 仍 = **t**。
  --    ⇒ 只問 EXECUTE 的「正向」那道**證不到它真的呼得到** —— 角色會在 schema 那一關就 permission denied,
  --      而斷言全綠、sweeper 靜靜啞掉。兩道要一起問。
  -- ⚠️ 誠實邊界:USAGE 常常是**經由 PUBLIC** 拿到的(所以上面實測必須連 PUBLIC 一起 REVOKE 才構造得出來)。
  --    本道只問「有沒有」,不問來源。
  IF NOT pg_catalog.has_schema_privilege('payment_confirmer', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'L5b-2-2a assert:payment_confirmer 對 schema public 沒有 USAGE ⇒ '
                    '就算 EXECUTE 有效,呼叫仍會 permission denied、sweeper 整條啞掉(has_function_privilege 看不到這一關)';
  END IF;

  -- ⑧ 有效權限(正負向):allowlist 只讀**直接 proacl**、且排除了 owner
  --    ⇒ 角色繼承 / PUBLIC / owner 成員資格 三條路它全盲。`has_function_privilege` 把閉包算進去。
  --    正向那道防的是「REVOKE 過頭 ⇒ sweeper 整條啞掉」也被判成綠。
  IF NOT pg_catalog.has_function_privilege('payment_confirmer', c_fn::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'L5b-2-2a assert:payment_confirmer 對 % 沒有有效 EXECUTE ⇒ sweeper/告警 cron 會整條啞掉', c_fn;
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_function_privilege(v_role, c_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'L5b-2-2a assert:角色 % 對 % 有**有效** EXECUTE(直接 GRANT / 角色繼承 / PUBLIC / owner 成員資格 皆算)'
                      ' ⇒ SECURITY DEFINER 受控窗對前台可呼', v_role, c_fn;
    END IF;
  END LOOP;

  -- 🔴 ⑧b COMMENT 必須在,而且是**本片這一份**(對抗審查 R2 打中,成立)
  --    我 R1 折的時候寫「ACL 四件都有斷言」——**那句是假的**:COMMENT 那一件從頭到尾沒有任何斷言。
  --    可構造:把 `COMMENT ON FUNCTION …` 整句刪掉 ⇒ migration 照樣過、harness 照樣 24/24 全綠,
  --    而庫裡留下一支**沒有任何說明**的金流 RPC(下一個人看到它不知道第四欄是幹嘛的、
  --    也不知道權限的準確射程)。存在性不夠 —— 還要確認是**本片這一份**,否則
  --    「COMMENT 還在但停留在 L5b-0-s 那版」同樣全綠。
  IF pg_catalog.obj_description(c_fn::regprocedure, 'pg_proc') IS NULL
     OR pg_catalog.strpos(pg_catalog.obj_description(c_fn::regprocedure, 'pg_proc'),
                          'L5b-2 片2a:回傳**四欄**') = 0 THEN
    RAISE EXCEPTION 'L5b-2-2a assert:COMMENT 不見了、或不是本片這一份(ACL 四件之④)。'
                    '實際=[%]', COALESCE(pg_catalog.obj_description(c_fn::regprocedure, 'pg_proc'), '(NULL)');
  END IF;

  -- ⑨ payment_confirmer 的成員白名單
  -- 🔴 值與正當性**逐字沿用 `20260810220000:564` 修補後那版**,不是本片新發明的:
  --    正式庫有一筆我方 migration 從未種過的成員(`postgres`,grantor `supabase_admin`),
  --    它被接受的理由是 **owner 等價**(postgres 是本支的 owner、owner 恆有 grant option、
  --    可自行把 EXECUTE 授回來 ⇒ 拿掉這筆成員資格,它的可達性不會變 ⇒ 沒有擴大可達集合)。
  -- ⚠️ 這條**不是**「平台種的所以安全」——來源推不出安全性。漂移偵測見
  --    `docs/runbooks/db-role-membership-drift-check.md`(那份的更新紀律:期望值只有 Sean 拍板才准改)。
  --
  -- 🔴🔴 **白名單的承重前提必須自己站著**(對抗審查 R2 打中,成立):
  --    上面那段正當性**整個壓在「postgres 就是本支的 owner」上**。而本片的 ④ 只驗
  --    「owner 與 DROP 前相同」,**沒有驗它是不是 postgres** ⇒ 若某環境的 owner 是別人,
  --    `postgres@supabase_admin` 這筆成員**照樣被放行**,卻不再是「owner 等價、沒有擴大可達集合」,
  --    而是**實實在在多給了一個角色 EXECUTE**。白名單會在那個環境變成一張空白支票。
  --    ⇒ 白名單只有在 owner=postgres 時才成立;不成立就 fail-closed,不是默默放行。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members am WHERE am.roleid = 'payment_confirmer'::regrole)
     AND v_owner_now <> 'postgres' THEN
    RAISE EXCEPTION 'L5b-2-2a assert:payment_confirmer 有成員,但本函式的 owner 是 [%] 而不是 postgres ⇒ '
                    '「postgres 是 owner 所以那筆成員沒有擴大可達集合」這個承重論證**在本環境不成立**,'
                    '白名單失去正當性。停下人工判斷(不要改白名單值,先解釋 owner 為什麼不是 postgres)', v_owner_now;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members am
     WHERE am.roleid = 'payment_confirmer'::regrole
       AND NOT (pg_catalog.pg_get_userbyid(am.member)  = 'postgres'
            AND pg_catalog.pg_get_userbyid(am.grantor) = 'supabase_admin')
  ) THEN
    RAISE EXCEPTION 'L5b-2-2a assert:payment_confirmer 有白名單外的成員 [%] ⇒ 這些角色可繼承它、'
                    '直接呼得到本支 SECDEF RPC,而 proacl 與三個前台負測都看不出來。停下人工判斷',
                    (SELECT pg_catalog.string_agg(
                              pg_catalog.pg_get_userbyid(am.member) || '@' ||
                              pg_catalog.pg_get_userbyid(am.grantor), ',' ORDER BY 1)
                       FROM pg_catalog.pg_auth_members am
                      WHERE am.roleid = 'payment_confirmer'::regrole
                        AND NOT (pg_catalog.pg_get_userbyid(am.member)  = 'postgres'
                             AND pg_catalog.pg_get_userbyid(am.grantor) = 'supabase_admin'));
  END IF;
END
$l5b2_2a_asserts$;

COMMIT;


-- ============================================================
-- Rollback → **`scripts/l5b2-2a-rollback.sql`(獨立的、可直接執行的單一交易腳本)**
--
--   psql "$DSN" -v ON_ERROR_STOP=1 -f scripts/l5b2-2a-rollback.sql
--
-- 🔴 **為什麼不寫在這裡的註解裡**(對抗審查 R1 打中,成立):
--   我上一版在此處寫「下面這份是可執行腳本」,但內容其實是
--   「-- 本體回 20260810220000:206-251 逐字」這種**座標與省略號** ——
--   照著跑會在 DROP 之後直接失敗,還原不了。**宣稱是可執行、事實是清單。**
--   ⇒ 改成真的檔案。它整份是單一交易(BEGIN…COMMIT)、含 ACL 四件、含回退後自驗,
--     而且 **`scripts/l5b2-2a-verify.sh` 的每一次 reset 都跑它** ⇒ 每輪驗證被實際執行十幾次,
--     不會退化成沒人跑過的紙上回退。
--
-- 🔴 **回退不能只 `REVOKE … FROM PUBLIC`**(同輪 R1 第二條,成立):
--   本庫有 `ALTER DEFAULT PRIVILEGES` ⇒ 重建出來的函式一出生就被**具名授權**給
--   anon/authenticated/service_role,`FROM PUBLIC` 碰不到它們。回退腳本 ④-2 已含具名角色。
--
-- 🔴 回退先決條件與業務後果:見該腳本檔頭(下游若已在讀第四欄,回退會讓它們拿不到)。
-- ============================================================
