-- 🔴 本檔是本片(片1)的【最後一步】。而理由**不是**那條通用的「新舊簽章不符」——
--    本片零 app code、簽章未變 ⇒ 那句話在這一支上是假的,前一版照抄了別片的模板(Fable R2 抓到)。
--    本檔真正的理由有兩條,都與時序有關:
--    ① **commit 之前不得 apply** —— apply 了而 commit 沒進去,正式庫就有一支 repo 裡不存在的函式,
--       下一支 migration 的前置指紋會對不上,而沒有人知道為什麼。
--    ② **preflight 未回傳之前不得 apply** —— 那道閘擋的是「正式庫已被改過」;
--       本檔用 CREATE OR REPLACE 覆寫整支函式,閘沒過就 apply 等於把別人的修正靜默蓋掉。
-- ════════════════════════════════════════════════════════════════════════════
-- M-4b 退款通知信 · 片1/4:把 G8 翻轉抽成共用函式(行為零改變)
--
-- plan: ~/pcm-mailbox/58-退款通知信-plan-v7-20260823.md §4-d 片1（v3-v6 已作廢)
-- 上游: Sean 2026-08-22「乙 三種都寄, 而順便把畫面也修好」+「但是不一次做好, 絕對出事」
--       ⇒ 四片切法 Sean 拍板 Q-C=甲。**片界是批准內容的一部分,不得合併、不得換序。**
-- 審查: codex R1 審 plan(v3)→ Fable R2 審 plan(v4)→ codex R1 審【本檔 diff】= FAIL 10 條,
--       本版逐條修完。Fable R2 審【本 diff】⇒ FAIL 2(F1 順序交換 / F2 檔頭假理由), 已修;
--       repo code-reviewer(SOP ⑥)⇒ FAIL 2 must-fix + 6 nit, 已修。
--       ⚠️ 前一版這裡寫「Fable R2 審 diff 尚未跑」—— 那是上一版的遺留字面, 已作廢。
--
-- ══ 1. 本片做什麼 ═══════════════════════════════════════════════════════════
-- `admin_finalize_order_refund` 的步 7(G8 翻轉)整段搬進新函式
-- `pcm_sync_order_refund_payment_status(uuid)`,原處改成呼叫它。
-- 為什麼要抽:退款有三條路(A 卡片 / B 非卡登記 / C money_moved 更正),而翻轉規則
-- 今天只寫在 A 身上。片2 會讓 B/C 也呼叫同一支 ⇒ 三條路共用同一條規則,不複製第二份。
--
-- ⚠️ 本片【有 schema 異動】:新增一支函式 + 重定義一支函式。
--    (前一版檔頭寫「零 schema 異動」是錯的 —— codex R1 抓到;真正零異動的是【資料】。)
--
-- ══ 2. 🔴 「行為零改變」的等價性證明 ═══════════════════════════════════════
-- 搬家後 helper 相對原 G8 多了【五樣】東西,逐樣證明它在 A 路徑上不改變可觀察行為
-- (⚠️ 前一版這裡寫「四樣」而底下列了五項 —— 讀的人會數到四就停, 而停掉的正好是最新加的第⑤樣):
--   ① 隔離級別斷言 —— 呼叫端步 3 已經驗過同一件事 ⇒ 對 A 恆真的重複檢查
--   ② 鎖 orders + 重讀 v_ps / v_total —— 呼叫端步 4 已對該列取 FOR NO KEY UPDATE,
--      而步 5/6 只寫 order_refunds(實查 20260803150000:701-763 該區間零 `UPDATE public.orders`)
--      ⇒ 同交易重讀必得相同值;同交易重複取同一把鎖是 no-op
--   ③ 「訂單不存在」的 NOT FOUND 守門 —— 呼叫端步 4 已經因為同一條件 RAISE 過 ⇒ A 路徑不可達
--   🔴 ⑤ **順序交換**:原文 allowlist 先跑(20260803150000:773)、SUM 後跑(:776);
--      本函式是 SUM + 早退先跑、allowlist 後跑。**這一樣前一版的清單裡沒有**(Fable R2 抓到)。
--      A 路徑等價證明:helper 只在該列剛被 CAS 成 'confirmed' 時被呼叫 ⇒ 該列必在 SUM 的集合裡,
--      而 refund_amount CHECK (> 0) ⇒ v_moved > 0 ⇒ **早退不可達 ⇒ allowlist 必達**
--      ⇒ 兩種順序在 A 路徑上抵達同一個分支、給同一個結果。
--      ⚠️ 而**在 B/C 路徑上兩種順序【不等價】**:v_moved=0 時新順序會靜默早退、不 RAISE
--        ⇒ 片2 的驗收矩陣因此要拆(plan §4-e g4)。
--   ④ 早退 `v_moved <= 0 ⇒ RETURN` —— **A 路徑證明不會觸發**:
--      helper 只在該列 status='confirmed' 時被呼叫,而
--      `order_refunds.refund_amount integer NOT NULL CHECK (refund_amount > 0)`
--      (20260725130100:94)⇒ SUM(confirmed) 恆 > 0。
--      🔴 而「那道 CHECK 現在還在、而且是 VALIDATED」不能只引歷史檔案 —— 本檔 §0 有 apply-time 斷言。
-- 其餘四項語意逐項對齊,無一改變:算式(只計 confirmed)/ 兩態 CASE / 單調不降級 /
-- 來源態 allowlist {paid, partiallyRefunded, refunded}。
-- 🔴 **RAISE 的訊息字面逐字保留**(含 `admin_finalize_order_refund:` 前綴與結尾「拒結案」)——
--    codex R1 抓到:改掉訊息 = 可觀察行為改變,而 A/B 對照的六個劇本剛好都沒走到那條路。
--    ⇒ 片2 讓 B/C 也呼叫本函式時,那個前綴會變得不精確 ⇒ **片2 必須回訪這一行**。
--
-- ══ 3. 為什麼 helper 自己也鎖、也驗隔離級別 ═══════════════════════════════════
-- 讓「呼叫前必須先鎖 orders」這個前提不必靠呼叫端記得(片2 有三個新呼叫端),並對 B/C fail-closed。
-- 🔴 而這【不代表呼叫端可以不管鎖序】(codex R1 抓到,前一版 COMMENT 講反了):
--    A 的鎖序是 orders → order_refunds;而 B/C 在自己的 DML 之後呼叫 ⇒ 它們已持子列鎖
--    ⇒ C 會形成 order_refunds → orders = **反向鎖序,可能 40P01**。
--    ⇒ **片2 的規格必須明訂:B/C 在呼叫本函式之前,先取 orders 的 FOR NO KEY UPDATE。**
--
-- ══ 4. 本檔【不】做什麼 ═══════════════════════════════════════════════════════
-- · 不換算式(processing / deferred / 未更正的 failed / 非卡登記 皆不計入)⇒ **B/C 仍然不會翻**
-- · 不動 order_refunds 狀態機(活的定義在 20260803150000:186/211;本片一個字不碰)
-- · 不動 packages/domain/src/order/state-machine.ts(片3 才動 ⇒ 片3 命中鐵則 12⑥)
-- · 不改 admin_finalize_order_refund 的 COMMENT 中「單調不降級」那句 —— 它現在仍為真
--
-- ══ 5. 回退 ════════════════════════════════════════════════════════════════
-- 零【資料】異動 ⇒ 回退 = 用 20260803150000:612-804 的原文 CREATE OR REPLACE 回去,
-- 再 DROP FUNCTION public.pcm_sync_order_refund_payment_status(uuid)。沒有資料要回填。
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ══ 0. 前置斷言 ═════════════════════════════════════════════════════════════
-- 🔴 codex R1 兩條 must-fix 的修法都在這一段:
--    ① 前一版只比對 G8 那一行,卻用 CREATE OR REPLACE 覆寫【整支】函式
--       ⇒ 正式庫若只改過步 1-6/8,閘會放行並把那次修正靜默蓋回舊版。
--       ⇒ 改成比對【整支函式的 prosrc 指紋】。
--    ② 前一版只用 proname 找函式 ⇒ 有 overload 時可能讀到別支。改用精確 regprocedure。
DO $pre$
DECLARE
  v_oid  oid;
  v_md5  text;
  -- 指紋 = 20260803150000:612-804 那支函式 body 的 md5。
  -- 產生法:python3 hashlib.md5(AS $fn$ 與 $fn$; 之間的文字)。
  -- 正對照(2026-08-23 拋棄式 PG 實跑):檔案算出的值 == pg_proc.prosrc 算出的值。
  c_expect constant text := '0bb79c5d5524ce8f898f71cd1545b0db';
BEGIN
  v_oid := to_regprocedure('public.admin_finalize_order_refund(uuid,text,text,bigint,text,text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '前置失敗 — 找不到那個精確簽章的 admin_finalize_order_refund;拒繼續。先查同名的有哪些:SELECT oid::regprocedure FROM pg_proc WHERE proname=''admin_finalize_order_refund''';
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_catalog.pg_proc WHERE oid = v_oid;
  -- ⚠️ 這道指紋只蓋 prosrc(函式本體),**不蓋 proconfig 與其他屬性**(Fable R2 揭露)。
  --    正式庫若曾 ALTER FUNCTION … SET(例如把 search_path 加嚴),指紋照樣過,
  --    而下面的 CREATE OR REPLACE 會把那次加嚴【靜默洗掉】。與 codex R1① 同族、小一號。
  IF v_md5 <> c_expect THEN
    RAISE EXCEPTION '前置失敗 — admin_finalize_order_refund 的整支指紋不符(現況 %,預期 %)。它已被改過 ⇒ 本檔的 CREATE OR REPLACE 會靜默蓋掉那次改動。停下來重讀最後一支改過它的 migration。🔴 **不得改本檔的 c_expect 去遷就現況** —— 那等於把這道閘關掉, 並讓 CREATE OR REPLACE 靜默覆蓋正式庫上那次改動',
      v_md5, c_expect;
  END IF;

  -- 🔴 早退的等價性證明依賴這道 CHECK 現在還在、而且已 VALIDATED。
  --    只引歷史檔案不夠(codex R1):正式庫若曾放寬它、且已有 refund_amount=0 的 confirmed 列,
  --    舊版會翻 partiallyRefunded 而新版會早退留在 paid = 行為【不】相同。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.order_refunds'::regclass
       AND contype  = 'c'
       AND convalidated
       AND pg_catalog.pg_get_constraintdef(oid) ILIKE '%refund_amount > 0%'
  ) THEN
    RAISE EXCEPTION '前置失敗 — order_refunds 上找不到【已驗證】的 refund_amount > 0 CHECK;本檔早退的等價性證明不成立,拒繼續';
  END IF;

  IF to_regprocedure('public.pcm_sync_order_refund_payment_status(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '前置失敗 — pcm_sync_order_refund_payment_status(uuid) 已存在;本檔是它的建立者 ⇒ 重複 apply 或有人先建了同名物件,停下來查';
  END IF;
END;
$pre$;

-- ══ 1. 共用函式:退款方向的 payment_status 寫入端 ═══════════════════════════
-- ⚠️ 本函式體內**刻意不寫長註解** —— prosrc 含註解,而前置指紋與事後自檢都比對 prosrc 字面;
--    在本體裡寫說明會讓那些斷言對「把 code 刪掉」恆真。說明寫在檔頭。
CREATE FUNCTION public.pcm_sync_order_refund_payment_status(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ps     text;
  v_total  integer;
  v_moved  bigint;
  v_target text;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 缺 order_id';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: 需在 READ COMMITTED 下執行(現為 %;RR 下 G8 的 SUM 讀不到並行提交)', current_setting('transaction_isolation');
  END IF;

  SELECT o.payment_status::text, o.total INTO v_ps, v_total
    FROM public.orders o WHERE o.id = p_order_id
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: 訂單 % 不存在(FK 應擋住;資料異常)', p_order_id;
  END IF;

  SELECT COALESCE(SUM(refund_amount), 0) INTO v_moved
    FROM public.order_refunds
   WHERE order_id = p_order_id AND status = 'confirmed';

  IF v_moved <= 0 THEN
    RETURN v_ps;
  END IF;

  IF v_ps NOT IN ('paid', 'partiallyRefunded', 'refunded') THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: 訂單 % 的 payment_status=% 不允許進入退款轉移(domain 轉移表);拒結案', p_order_id, v_ps;
  END IF;

  v_target := CASE WHEN v_moved >= v_total THEN 'refunded' ELSE 'partiallyRefunded' END;
  IF v_ps <> 'refunded' AND v_ps <> v_target THEN
    UPDATE public.orders SET payment_status = v_target::public.payment_status
     WHERE id = p_order_id;
    v_ps := v_target;
  END IF;

  RETURN v_ps;
END;
$fn$;

-- ── 3a. 🔴 建完【立刻】驗,不要排在依賴它的 COMMENT / REVOKE 後面 ──────────────
-- codex R1 抓到:前一版把 3a 排在最後,而「helper 沒建起來」的世界會先死在前面那些
-- 依賴它的 DDL ⇒ **3a 自己永遠沒有機會印紅** = 恆綠。
DO $c3a$
BEGIN
  IF to_regprocedure('public.pcm_sync_order_refund_payment_status(uuid)') IS NULL THEN
    RAISE EXCEPTION '自檢失敗 3a — pcm_sync_order_refund_payment_status(uuid) 不存在';
  END IF;
END;
$c3a$;

-- ── owner 對齊:🔴 codex R1 must-fix ─────────────────────────────────────────
-- 新函式歸【執行 apply 的身分】所有;而 admin_finalize_order_refund 是 SECURITY DEFINER,
-- 執行時的有效身分 = 它自己的 owner。兩者 owner 不同且舊 owner 不是 superuser
-- ⇒ A 路徑呼叫 helper 會 permission denied,而**本機兩者都是 postgres 所以測不出來**。
DO $own$
DECLARE v_owner name;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(proowner) INTO v_owner
    FROM pg_catalog.pg_proc
   WHERE oid = to_regprocedure('public.admin_finalize_order_refund(uuid,text,text,bigint,text,text,text)');
  EXECUTE format('ALTER FUNCTION public.pcm_sync_order_refund_payment_status(uuid) OWNER TO %I', v_owner);
END;
$own$;

COMMENT ON FUNCTION public.pcm_sync_order_refund_payment_status(uuid) IS
  'M-4b 退款通知信 片1/4:退款方向 orders.payment_status 的【唯一寫入端】。'
  '🔴 **內部 helper,不是對外 RPC** —— 零 GRANT、只有 owner 執行得到。'
  '它沒有 actor、不寫 audit ⇒ 開給 service_role 等於多開一條【沒有留痕的動錢入口】,'
  '可繞過 admin_finalize / admin_record_manual_refund / admin_correct_order_refund_verdict 三條正式入口。'
  '(codex R1 2026-08-23 must-fix;前一版曾 GRANT service_role,已撤。)'
  '內容取自 admin_finalize_order_refund 步 7(G8,20260803150000:769-785);'
  '相對原文多了【五樣】:隔離斷言 / 鎖+重讀 / 訂單不存在守門 / 早退 / '
  '🔴 **來源態 allowlist 與 SUM 的先後順序交換**(原文 allowlist 先、本函式 SUM 先)——'
  '五樣在 A 路徑上皆不改變可觀察行為(A 只在剛 confirmed 時呼叫 ⇒ v_moved 恆 > 0 ⇒ 早退不可達 ⇒ allowlist 必達),'
  '逐樣證明寫在本檔檔頭 §2。**RAISE 訊息字面逐字保留**(含 admin_finalize_order_refund 前綴),'
  '因為改掉訊息 = 可觀察行為改變 ⇒ 🔴 **片2 讓 B/C 也呼叫時必須回訪那個前綴**。'
  '🔴 現行語意仍是**片1 的舊語意**:只計 confirmed、兩態、單調不降級。'
  '片3 會換成「已確認動錢」三段聚合 + 三態(含回 paid)+ 依 Sean 2026-08-22 Q-B=甲 開放降級。'
  '🔴🔴 **片3 必須【移除】上面那道早退,而不是留著它** —— Fable R2 2026-08-23 抓到:'
  '留著它 ⇒ 全部退款被作廢時 v_moved=0 ⇒ 早退 ⇒ 永遠走不到三態的 paid 分支 ⇒ '
  'payment_status 卡死在 refunded ⇒ **Sean 拍板「作廢後照事實降回」的行為靜靜地不存在**,'
  '而 typecheck / lint / build 與片1 片2 的全部驗收都是綠的。'
  '⚠️ 這一行在片1 是【讓宣稱成真的那一行】,在片3 變成【讓宣稱成假的那一行】——'
  '同一個改動在兩片之間換了正負號,而片界文件裡沒有任何地方會記錄這件事 ⇒ 所以記在這裡。'
  '片3 的驗收必須含一格必紅測試:全部退款作廢 ⇒ 斷言 payment_status 回到 paid。'
  '🔴 鎖序:呼叫端必須在自己的 DML【完成之後】以獨立語句呼叫本函式。'
  '(理由是可見性與鎖序, 不是 volatility —— 本函式**沒有 volatility 子句且會 UPDATE ⇒ 它是 VOLATILE**;'
  '前一版這裡寫「本函式 STABLE」是錯的, 那是把它與 pcm_order_refundable_remaining〔那支才是 STABLE〕搞混。)'
  'A 的鎖序 orders → order_refunds;**B/C 已持子列鎖,呼叫前必須先取 orders 的 FOR NO KEY UPDATE,'
  '否則形成 order_refunds → orders 的反向鎖序、可能 40P01**(codex R1 must-fix,片2 規格必寫)。';

-- ── EXECUTE 權限:🔴 零 GRANT。兩道 REVOKE + service_role 也收 ────────────────
-- 依據 docs/patterns/revoking-function-execute-in-supabase.md §1/§2
-- （PUBLIC 那份與具名那份互為鏡像,收一道收不乾淨)
-- 🔴 而本檔比同族多收一個 service_role:同族那些是【對外 RPC】,本支是【內部 helper】。
--    SECURITY DEFINER 的 admin_finalize 以 owner 身分執行 ⇒ owner 天生執行得到,不需要任何 GRANT。
REVOKE ALL ON FUNCTION public.pcm_sync_order_refund_payment_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_sync_order_refund_payment_status(uuid)
  FROM anon, authenticated, authenticator, service_role;

-- ══ 2. 原函式:步 7 改成呼叫共用函式(其餘 191 行程式抽取、非手抄)══════════
-- 🔴 CREATE OR REPLACE 且參數型別未變 ⇒ **保留既有 OID / ACL / owner / COMMENT**
--    (DROP+CREATE 會把 ACL 洗回預設、COMMENT 消失)
-- 🔴 而【新】函式(§1)用裸 CREATE:scripts/migration-static-checks.sh ① 的規則是
--    「新物件撞名要當場紅」。⚠️ 該閘對「重定義既有函式」會誤報 —— 實測 20260820100000 與
--    20260810170000 兩支【已上線】的檔跑同一道閘同樣命中 ⇒ 下面這一處是已知誤報。
--    🔴 codex R1 認為「帶紅收工」不符 checkpoint ⇒ 已把「修閘或建立具判別力的既有物件豁免」
--       列為決策題上呈主視窗(改共用閘腳本不屬本片可自行拍板的範圍)。
CREATE OR REPLACE FUNCTION public.admin_finalize_order_refund(
  p_refund_id          uuid,
  p_outcome            text,
  p_tappay_refund_id   text,      -- accepted / recovered_confirmed 必填(其餘必 NULL)
  p_refund_amount_wire bigint,    -- accepted 必填(G7 比對;其餘必 NULL)
  p_failed_detail      text,      -- manual_failed 必填;rejected/not_sent 選填;其餘必 NULL
  p_actor              text,
  p_request_id         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor    text;
  v_req      text;
  v_order_id uuid;
  v_row      public.order_refunds%ROWTYPE;
  v_after    public.order_refunds%ROWTYPE;
  v_ps       text;
  v_result   text;
  v_audit_outcome text;
BEGIN
  -- 步 1. 輸入衛生(同 initiate)
  IF p_actor IS NULL OR btrim(p_actor) = '' OR btrim(p_actor) !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: actor 非法';
  END IF;
  v_actor := btrim(p_actor);
  IF p_request_id IS NULL
     OR p_request_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: request_id 非法(須為 UUID v4 小寫)';
  END IF;
  v_req := p_request_id;
  IF p_refund_id IS NULL THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: 缺 refund_id';
  END IF;

  -- 步 2. outcome allowlist + 逐 outcome 參數矩陣(G6;fail-closed 嚴格互斥)
  IF p_outcome IS NULL OR p_outcome NOT IN
     ('accepted', 'deferred_not_captured', 'rejected_out_of_range', 'not_sent',
      'recovered_confirmed', 'manual_failed') THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: outcome 非法(got %)', COALESCE(p_outcome, '<null>');
  END IF;
  IF p_outcome IN ('accepted', 'recovered_confirmed') THEN
    IF p_tappay_refund_id IS NULL OR p_tappay_refund_id !~ '^\S{1,64}$' THEN
      RAISE EXCEPTION 'admin_finalize_order_refund: % 必須帶合法 tappay_refund_id', p_outcome;
    END IF;
  ELSIF p_tappay_refund_id IS NOT NULL THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: % 不得帶 tappay_refund_id', p_outcome;
  END IF;
  IF p_outcome = 'accepted' THEN
    IF p_refund_amount_wire IS NULL OR p_refund_amount_wire < 0 THEN
      RAISE EXCEPTION 'admin_finalize_order_refund: accepted 必須帶 refund_amount_wire(G7 比對)';
    END IF;
  ELSIF p_refund_amount_wire IS NOT NULL THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: % 不得帶 refund_amount_wire', p_outcome;
  END IF;
  IF p_outcome = 'manual_failed' AND (p_failed_detail IS NULL OR btrim(p_failed_detail) = '') THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: manual_failed 必須帶 failed_detail(Record 證據數字)';
  END IF;
  IF p_outcome IN ('accepted', 'deferred_not_captured', 'recovered_confirmed')
     AND p_failed_detail IS NOT NULL THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: % 不得帶 failed_detail', p_outcome;
  END IF;
  IF p_failed_detail IS NOT NULL AND char_length(p_failed_detail) > 500 THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: failed_detail 超長(≤500)';
  END IF;

  -- 步 3. 隔離閘(G8;RR 下鎖後 SUM 看不到兄弟提交 —— P2B02 同型)
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: 需在 READ COMMITTED 下執行(現為 %;RR 下 G8 的 SUM 讀不到並行提交)', current_setting('transaction_isolation');
  END IF;

  -- 步 4. 取 order_id(無鎖預讀,只取路由鍵)→ 鎖 orders → **重讀退款列 FOR UPDATE**
  --   (鎖序 orders → order_refunds;鎖前預讀的列值一律不信 —— 關卡2 codex MF1 後半)
  SELECT order_id INTO v_order_id FROM public.order_refunds WHERE id = p_refund_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'REFUND_NOT_FOUND');
  END IF;
  SELECT o.payment_status::text INTO v_ps
    FROM public.orders o WHERE o.id = v_order_id
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: 帳本列 % 的訂單 % 不存在(FK 應擋住;資料異常)', p_refund_id, v_order_id;
  END IF;
  SELECT * INTO v_row FROM public.order_refunds WHERE id = p_refund_id FOR UPDATE;

  -- 步 5. 出口前置(關卡2 codex MF1/MF2 折入):
  -- 5a. hold 列(證據非空)不得走零動錢同步終態(P7C15 trigger 是權威、這裡給友善訊息)
  IF v_row.provider_refund_id_evidence IS NOT NULL
     AND p_outcome IN ('deferred_not_captured', 'rejected_out_of_range', 'not_sent') THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: 該列已保存 TapPay 受理證據(%)、不得標成零動錢終態;出口=RW4 的 recovered_confirmed / manual_failed', v_row.provider_refund_id_evidence;
  END IF;
  -- 5b. 恢復出口只對「異常列」開放(鏡像 RW4 異常清單入口條件:超時或已有證據;
  --     擋「憑空把剛建的 processing 列 confirm 掉」—— DB 驗不了 Record 差額,
  --     這道閘 + audit 全記錄 + P7C09 Portal 真碼 = 縱深,非零信任)
  IF p_outcome IN ('recovered_confirmed', 'manual_failed')
     AND v_row.provider_refund_id_evidence IS NULL
     AND clock_timestamp() - v_row.created_at < interval '30 minutes' THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: 恢復出口(%)只對異常列開放(processing 超 30 分或已有證據;該列建立於 %)', p_outcome, v_row.created_at;
  END IF;

  -- 步 6. 分支 + CAS(G5:WHERE status=processing;已持列鎖 ⇒ NOT FOUND=已被終結,
  --   訊息用**鎖後**現況;每支 UPDATE 緊接 RETURNING、不隔任何賦值 —— ROW_COUNT 陷阱)
  v_result := 'FINALIZED';
  v_audit_outcome := p_outcome;

  IF p_outcome = 'accepted' THEN
    IF p_refund_amount_wire = v_row.refund_amount THEN
      -- 同步 happy path:證據 + 對帳碼 + confirmed 一次寫(P7C13 一致性天然滿足)
      UPDATE public.order_refunds
         SET status = 'confirmed',
             tappay_refund_id = p_tappay_refund_id,
             provider_refund_id_evidence = p_tappay_refund_id
       WHERE id = p_refund_id AND status = 'processing'
       RETURNING * INTO v_after;
    ELSE
      -- G7 金額不符:只寫證據、留 processing、走 RW4(fail-closed;不 confirm 不翻轉)
      v_result := 'HELD_AMOUNT_MISMATCH';
      v_audit_outcome := 'accepted_amount_mismatch_hold';
      UPDATE public.order_refunds
         SET provider_refund_id_evidence = p_tappay_refund_id
       WHERE id = p_refund_id AND status = 'processing'
       RETURNING * INTO v_after;
    END IF;
  ELSIF p_outcome = 'deferred_not_captured' THEN
    UPDATE public.order_refunds SET status = 'deferred'
     WHERE id = p_refund_id AND status = 'processing'
     RETURNING * INTO v_after;
  ELSIF p_outcome IN ('rejected_out_of_range', 'not_sent') THEN
    UPDATE public.order_refunds
       SET status = 'failed', failed_reason = p_outcome, failed_detail = p_failed_detail
     WHERE id = p_refund_id AND status = 'processing'
     RETURNING * INTO v_after;
  ELSIF p_outcome = 'recovered_confirmed' THEN
    -- 恢復路徑(Sean Q3=A):Record 差額判定成立後、人工從 Portal 取回真 DR 碼。
    -- hold 列:S3 非空 ⇒ P7C13 要求 Portal 碼 == 證據碼(DR 碼同一識別空間;probe L 實證);
    -- 崩潰列:S3 為 NULL ⇒ P7C13 不觸發、P7C09 由 Portal 真碼滿足。
    UPDATE public.order_refunds
       SET status = 'confirmed', tappay_refund_id = p_tappay_refund_id
     WHERE id = p_refund_id AND status = 'processing'
     RETURNING * INTO v_after;
  ELSE  -- manual_failed(Record 差額=0 已由 RW4 流程驗過;detail 必填=證據數字)
    UPDATE public.order_refunds
       SET status = 'failed', failed_reason = 'manual_failed', failed_detail = p_failed_detail
     WHERE id = p_refund_id AND status = 'processing'
     RETURNING * INTO v_after;
  END IF;

  IF v_after.id IS NULL THEN
    RAISE EXCEPTION 'admin_finalize_order_refund: CAS 失敗 — 退款 % 現況 %(非 processing;已被終結)', p_refund_id, v_row.status;
  END IF;

  -- 步 7. G8 翻轉(片1 抽出:規則本體搬進 pcm_sync_order_refund_payment_status;
  --   本處只留「僅 confirmed 路徑」這個觸發條件。行為未改,等價性證明見本檔檔頭 §2)
  IF v_after.status = 'confirmed' THEN
    v_ps := public.pcm_sync_order_refund_payment_status(v_order_id);
  END IF;

  -- 步 8. 同交易稽核(G9;after 恰 6 鍵、**全部取自 CAS 後實際列值**(RETURNING)——
  --   audit=事實非參數(關卡2 codex MF3);不包 EXCEPTION handler)
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (v_actor, 'order_refund.finalize', 'order:' || v_order_id::text, NULL,
          jsonb_build_object(
            'refund_row_id', v_after.id,
            'outcome', v_audit_outcome,
            'tappay_refund_id', v_after.tappay_refund_id,
            'provider_refund_id_evidence', v_after.provider_refund_id_evidence,
            'refund_amount_wire', p_refund_amount_wire,
            'request_id', v_req),
          NULL, v_req, 'admin');

  RETURN jsonb_build_object('result', v_result,
    'status_after', v_after.status,
    'payment_status_after', v_ps);
END;
$fn$;
-- ══ 3. 事後自檢 ═════════════════════════════════════════════════════════════
-- 🔴 每一道都是 RAISE(不成立才出聲);只印 OK 的檢查沒有判別力。
--    3a 已在上面 CREATE 之後【立刻】跑過,不在此處重複(那正是它恆綠的成因)。
DO $post$
DECLARE
  -- 🔴 新物件收權斷言的【清單】(scripts/migration-static-checks.sh ③ 要它可被數)。
  --    它防的不是「忘記收權」,是「**忘記列**」—— 斷言只檢查你列出來的物件。
  --    本檔零新建 relation、一支新函式 ⇒ relations 空、functions 一筆。
  --    🔴 結尾的 ::text[] 不能拿掉(清單清空時 ARRAY[] 無法推斷型別)。
  --    ⚠️ 物件名在本區塊只寫這一次 —— 下面 3i/3h/3j 都從這裡取,不再各自手打。
  v_relations text[] := ARRAY[]::text[];
  v_functions text[] := ARRAY[
    'public.pcm_sync_order_refund_payment_status(uuid)'
  ]::text[];
  v_declares_nothing boolean := false;

  v_old text;
  v_new text;
  v_bad text;
  v_owner name;
  v_fn  oid;
  r     text;
BEGIN
  IF cardinality(v_relations) = 0 AND cardinality(v_functions) = 0 THEN
    IF NOT v_declares_nothing THEN
      RAISE EXCEPTION '新物件收權斷言:兩份清單都是空的。本檔若真的沒新建物件,請把 v_declares_nothing 設成 true(明示),不要留空。';
    END IF;
  END IF;
  FOREACH r IN ARRAY v_functions LOOP
    v_fn := to_regprocedure(r);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到函式 % —— 簽名打錯或沒建成。拒繼續。', r;
    END IF;
  END LOOP;
  SELECT prosrc INTO v_old FROM pg_catalog.pg_proc
   WHERE oid = to_regprocedure('public.admin_finalize_order_refund(uuid,text,text,bigint,text,text,text)');
  SELECT prosrc INTO v_new FROM pg_catalog.pg_proc WHERE oid = v_fn;

  -- 3b. 翻轉語句【搬進】新函式
  IF v_new NOT LIKE '%UPDATE public.orders SET payment_status = v_target::public.payment_status%' THEN
    RAISE EXCEPTION '自檢失敗 3b — 新函式內找不到翻轉語句(搬家沒搬到東西)';
  END IF;
  -- 3c. 翻轉語句【離開】舊函式 —— 「唯一寫入端」這個宣稱的憑據
  IF v_old LIKE '%UPDATE public.orders%' THEN
    RAISE EXCEPTION '自檢失敗 3c — admin_finalize_order_refund 內仍有直接寫 orders 的語句;兩個寫入端會對同一欄給出相反答案';
  END IF;
  -- 3d. 舊函式真的改成呼叫新函式(3c 單獨成立不足:整段被刪掉也會讓 3c 通過)
  IF v_old NOT LIKE '%pcm_sync_order_refund_payment_status(v_order_id)%' THEN
    RAISE EXCEPTION '自檢失敗 3d — admin_finalize_order_refund 沒有呼叫新函式;G8 可能被整段刪掉了';
  END IF;
  -- 3e. 觸發條件一字未改(僅 confirmed 路徑)
  IF v_old NOT LIKE '%IF v_after.status = ''confirmed'' THEN%' THEN
    RAISE EXCEPTION '自檢失敗 3e — 「僅 confirmed 路徑」的觸發條件不見了';
  END IF;
  -- 3f. 片1 不換算式:新函式的 SUM 仍只吃 confirmed(片3 才換,那時這一格會被刻意改紅)
  IF v_new NOT LIKE '%WHERE order_id = p_order_id AND status = ''confirmed'';%' THEN
    RAISE EXCEPTION '自檢失敗 3f — 新函式的算式不是「只計 confirmed」;片1 不得換算式';
  END IF;
  -- 3g. 早退存在(它是「片2 行為零改變」的憑據)
  IF v_new NOT LIKE '%IF v_moved <= 0 THEN%' THEN
    RAISE EXCEPTION '自檢失敗 3g — 早退不見了;沒有它,片2 會把 paid 訂單誤翻成 partiallyRefunded';
  END IF;
  -- 3i. 🔴 **極性已反轉**(codex R1):本支是內部 helper,service_role 必須執行【不到】。
  --     🔴 且【排在 3h 之前】—— 3h 的集合涵蓋 service_role,排在後面的話 3i 永遠沒機會紅
  --     (自己抓到的遮蔽,與 codex 對 3a 抓到的是同一族)。
  --     前一版斷言 service_role 執行得到,而那正是缺陷本身。
  IF has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '自檢失敗 3i — service_role 執行得到內部 helper;REVOKE 沒收乾淨';
  END IF;
  -- 3h. 🔴 **全角色**掃描,不是只看 anon/authenticated
  --     🔴🔴 **本格若在正式庫紅, 先查 owner 是不是 superuser, 不得放寬 3h。**
  --        本機 owner 與 superuser 都是 postgres ⇒ 它在正式庫掃的是【另一組角色】;
  --        若正式庫 owner 是 superuser, postgres 可能因繼承而 has_function_privilege 為真
  --        ⇒ apply 當場中止、訊息說「REVOKE 沒收乾淨」, 而**最省事的轉綠方式就是放寬這一格**。
  --        fail-closed 可回退, 所以停下來查比放寬便宜。
  --     codex R1 抓到:前一版註解說含 authenticator,實際只驗兩個角色 ⇒ 其餘角色恆綠。
  --     判準用 has_function_privilege(有效權限,含繼承),不用 ACL 字面。
  SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO v_bad
    FROM pg_catalog.pg_roles r
   WHERE r.rolname NOT LIKE 'pg\_%'
     AND r.oid <> (SELECT proowner FROM pg_catalog.pg_proc WHERE oid = v_fn)
     AND NOT r.rolsuper
     AND has_function_privilege(r.oid, v_fn, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '自檢失敗 3h — 除了 owner 與 superuser 之外還有角色執行得到這支動錢 helper:%。它沒有 actor、不寫 audit ⇒ 等於一條沒有留痕的動錢入口', v_bad;
  END IF;
  -- 3j. owner 對齊:SECURITY DEFINER 的 admin_finalize 以自己的 owner 身分呼叫 helper
  SELECT pg_catalog.pg_get_userbyid(proowner) INTO v_owner FROM pg_catalog.pg_proc
   WHERE oid = to_regprocedure('public.admin_finalize_order_refund(uuid,text,text,bigint,text,text,text)');
  IF v_owner <> (SELECT pg_catalog.pg_get_userbyid(proowner) FROM pg_catalog.pg_proc WHERE oid = v_fn) THEN
    RAISE EXCEPTION '自檢失敗 3j — 兩支函式 owner 不同;A 路徑呼叫 helper 會 permission denied(而本機兩者同為 postgres 時測不出來)';
  END IF;
  -- 3k. 錯誤訊息字面逐字保留(行為零改變的一部分;codex R1 抓到前一版改了它)
  -- 🔴 用 position 不用 LIKE:原訊息**自己含兩個 `%`**(RAISE 的格式佔位符),
  --    在 LIKE 語意下那兩個是**萬用字元** ⇒ 訊息中段實際沒被比對 = 判別力低於宣稱。
  IF position('admin_finalize_order_refund: 訂單 % 的 payment_status=% 不允許進入退款轉移(domain 轉移表);拒結案' in v_new) = 0 THEN
    RAISE EXCEPTION '自檢失敗 3k — 非法來源態的 RAISE 訊息字面被改過;那是可觀察行為,不是文案';
  END IF;
END;
$post$;

COMMIT;
