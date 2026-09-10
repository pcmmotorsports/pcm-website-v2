-- 20260910130000_m4b_hct_dispatch_recorded.sql
-- ⟦ship-DISPATCHORDER⟧ 片三:記下「這一箱叫過車了」。
--
-- ══ 🔴🔴 為什麼需要這一支 —— 而它是 plan 的一個洞 ═══════════════════════
-- plan §3-a 定案逐字:「**擋住** —— 已派遣過的箱**不給再按**」,
-- 理由是「已經派遣過的箱再派遣一次會怎樣」V15 §8 **沒寫、沒問、沒試**。
-- 🛑 **而我寫那份 plan 的時候沒有問:那個「已派遣過」記在哪裡?**
--    ⇒ 📌 `shipments` 十六欄逐欄看過(2026-09-10 唯讀正式庫)——
--      **沒有任何一欄記得住這件事**。
-- ⇒ ⇒ 🎯 **一個「擋住」的決定, 沒有可以拿來擋的東西 ⇒ 它只是一句話。**
--
-- ⛔ ~~拿 `shipped_at` 當代理~~ —— **兩個理由, 各自足夠**:
--   ① 主視窗明令「`shipped_at` 你不碰」。
--   ② 🔴 **它接不住那個殘餘**:plan §3-a 自己寫的最壞情況是
--      「API 回成功 ⇒ 而 DB 標出貨之前掛掉」⇒ **車叫了而 `shipped_at` 仍是空**
--      ⇒ 拿它當判準, 那一箱**還按得下去** —— 而那正是要擋的那一箱。
--
-- ══ 🔴🔴 而【一個時間戳不夠】—— codex R1 must-fix 一, 而它打中要害 ═════════
-- ⛔ ~~第一版:只有 `hct_dispatched_at`, 在新竹回成功【之後】才寫~~
--    ⇒ 出事時序(codex 舉的):新竹已接受派遣 ⇒ 行程在 writer 提交前掛掉
--      ⇒ 那一欄仍是 NULL ⇒ **按得下去 ⇒ 叫第二台車。**
--    ⇒ 而**那正是 plan §3-a 自己寫下來的那個殘餘** —— 📌 **我建了一根柱子去擋它,**
--      **而柱子立在它後面。**
--    ⚠️ 併發那條路更快:兩個請求同時讀到 NULL ⇒ 各自送出 HTTP ⇒ writer 才擋掉第二筆
--      ⇒ **兩發派遣早就出去了。**
-- ✅ **兩欄, 而它們是兩件事**:
--    · `hct_dispatch_attempted_at` = **開始叫車了, 不准再按**(送 HTTP 【之前】原子佔位)
--    · `hct_dispatched_at`         = **新竹確認叫到車了**(回成功之後補記)
--    🔵 **這個形狀不是我發明的** —— `hct-submit-flow.ts` 檔頭逐字記著同一件事:
--      「呼叫端在送出【之前】先寫一列 `unknown` 佔位(擋重送)」。⇒ 同族同解。
--
-- ══ 🔴 順序:先佔位, 再叫車, 最後標出貨 ═════════════════════════════════
-- 三個寫入的順序決定了掛在任何一點會留下哪一種殘骸:
--   佔位 ⇒ HTTP ⇒ 補記 ⇒ 標出貨
--   掛在 HTTP 前後任一點 ⇒ 有佔位而沒補記 ⇒ **按不下去, 要人看一眼** ✅
--   掛在補記之後、標出貨之前 ⇒ 有紀錄而沒標出貨 ⇒ **按不下去, 要人看一眼** ✅
-- ⇒ 🎯 **每一種掛法留下的都是【可補】的那一邊** —— 而理由與 plan §3-a 同一條:
--    「要人看一眼」可補,「多叫一台車」不可補。
--
-- ══ 🛑 GRANT —— 而這一條是今天早上用一次失敗的第一箱換來的 ═════════════
-- `20260904170000` 建 `admin_record_hct_submit` 時**只寫了 REVOKE, 沒寫 GRANT**
-- ⇒ 後台按下去當場 42501 ⇒ 📌 **第一箱送不出去, 而錯誤訊息長得像新竹拒絕。**
-- ⇒ 那個洞今天靠 `20260909120000` 補。**本檔在同一支 migration 裡就把 GRANT 寫上。**

BEGIN;

-- ── 前置閘 ────────────────────────────────────────────────────────────────
DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.shipments') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.shipments ⇒ 這不是我以為的那個世界';
  END IF;

  -- 🔴 forward-only:欄或函式已存在 ⇒ 本檔套過了, 拒重跑。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
              WHERE a.attrelid = pg_catalog.to_regclass('public.shipments')
                AND a.attname IN ('hct_dispatched_at', 'hct_dispatch_attempted_at')
                AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '前置閘②:那兩欄之一已經存在 ⇒ 本檔已套用過';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_record_hct_dispatch(text,text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.admin_claim_hct_dispatch(text,text)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③:那兩支之一已經存在 ⇒ 本檔已套用過';
  END IF;

  -- 🔴 本檔依賴那支 writer 的存在(同一族、同一張表)⇒ 它不在就是我認錯了世界。
  IF pg_catalog.to_regprocedure('public.admin_record_hct_submit(text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION '前置閘④:找不到 admin_record_hct_submit ⇒ 新竹那一族還沒貼, 本檔不該先貼';
  END IF;

  -- ⚪ 負對照:這把尺不是恆真。
  IF pg_catalog.to_regprocedure('public.zzz_never_a_function(text)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘(負對照):現造函式名竟然命中 ⇒ 這把尺壞了';
  END IF;
END
$pre$;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. 欄位
-- ══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.shipments ADD COLUMN hct_dispatch_attempted_at timestamptz;
ALTER TABLE public.shipments ADD COLUMN hct_dispatched_at timestamptz;

COMMENT ON COLUMN public.shipments.hct_dispatch_attempted_at IS
  '我們【開始】向新竹叫這一箱的車的時間 —— 在送出 HTTP 之【前】原子寫入。'
  ' 🔴 它是「不准再按」的判準, 而 hct_dispatched_at 是「新竹確認了」的判準 ——'
  ' 兩者刻意分開:掛在中間時前者有值而後者空, 那一箱按不下去而要人看一眼。'
  ' 合成一欄會讓「叫車途中掛掉」長得跟「還沒叫」一樣, 而那會叫出第二台車。';

COMMENT ON COLUMN public.shipments.hct_dispatched_at IS
  '新竹【確認】叫到車的時間(TransDispatchOrder_Json 回 success=Y)。'
  ' 🔴 它【不是】出貨時間 —— shipped_at 才是;也【不是】「不准再按」的判準 ——'
  ' hct_dispatch_attempted_at 才是。'
  ' write-once:它代表一個不可回收的對外動作, 改掉它等於把那次叫車從紀錄裡抹掉,'
  ' 而那台車還是會來。';

-- ══════════════════════════════════════════════════════════════════════════
-- 2. write-once 守門 —— 抄 `pcm_b2_shipments_hct_request_id_write_once` 的形狀
-- ══════════════════════════════════════════════════════════════════════════
-- 🛑 **不擋從 NULL 變成有值**(那正是本支 writer 要做的事),
--    只擋「把一個已經發生的事實改掉或清空」。
CREATE FUNCTION public.pcm_b2_shipments_hct_dispatched_at_write_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  -- 🔴 **兩欄都要守** —— 佔位那一欄尤其:清掉它就等於把「不准再按」解掉。
  IF OLD.hct_dispatch_attempted_at IS NOT NULL
     AND NEW.hct_dispatch_attempted_at IS DISTINCT FROM OLD.hct_dispatch_attempted_at THEN
    RAISE EXCEPTION
      '新竹派遣佔位 write-once,不可改也不可清空(shipment=%)。'
      ' 清掉它等於把「不准再按」解掉, 而那台車可能已經在路上。',
      OLD.shipment_reference
      USING ERRCODE = 'P0001', CONSTRAINT = 'shipments_hct_dispatch_attempted_at_write_once';
  END IF;
  IF OLD.hct_dispatched_at IS NOT NULL
     AND NEW.hct_dispatched_at IS DISTINCT FROM OLD.hct_dispatched_at THEN
    RAISE EXCEPTION
      '新竹派遣時間 write-once,不可改也不可清空(shipment=%)。'
      ' 它代表「我們叫過一台車來收這一箱」—— 改掉它等於把那次叫車從紀錄裡抹掉,'
      ' 而那台車還是會來。',
      OLD.shipment_reference
      USING ERRCODE = 'P0001', CONSTRAINT = 'shipments_hct_dispatched_at_write_once';
  END IF;
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.pcm_b2_shipments_hct_dispatched_at_write_once()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER shipments_hct_dispatched_at_write_once_bu
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_b2_shipments_hct_dispatched_at_write_once();

-- ══════════════════════════════════════════════════════════════════════════
-- 3. writer
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴 **「不給再按」寫在這一層, 不寫在 TS** —— 同 `admin_record_hct_submit` 的理由逐字:
--    TS 那一層可以被繞過, 而這一層是每一條路都會經過的地方。
-- ── 3-a. claim:送 HTTP 【之前】原子佔位 ───────────────────────────────────
-- 🔴🔴 **原子性住在 `UPDATE … WHERE … IS NULL` 這一句裡, 不住在先讀再寫。**
--    ⛔ ~~`SELECT … FOR UPDATE` 看一眼再 `UPDATE`~~ 也可以, 而**一句寫完更難寫錯**:
--      沒有「中間那一段」可以讓人插進來。
--    ⇒ 📌 **兩個同時按下去的請求, 只有一個的 ROW_COUNT 會是 1。**
CREATE FUNCTION public.admin_claim_hct_dispatch(
  p_shipment_reference text,
  /** 🔴 送出去的那個新竹貨號 —— 拿來確認「我們要叫的是這一箱」。 */
  p_edelno             text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_status     text;
  v_deleted    timestamptz;
  v_attempted  timestamptz;
  v_edelno     text;
  v_n          int;
BEGIN
  SELECT hct_status, deleted_at, hct_dispatch_attempted_at, hct_request_id
    INTO v_status, v_deleted, v_attempted, v_edelno
    FROM public.shipments
   WHERE shipment_reference = p_shipment_reference;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_claim_hct_dispatch:查無這張出貨單(%)', p_shipment_reference;
  END IF;

  -- 🔴 **已作廢的箱不准【開始】叫車** —— 這一格屬於 claim, 不屬於 record(codex R1 must-fix 三)。
  IF v_deleted IS NOT NULL THEN
    RAISE EXCEPTION
      'admin_claim_hct_dispatch:這張出貨單已作廢(%), 不得叫車', p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  IF v_status IS DISTINCT FROM 'submitted' THEN
    RAISE EXCEPTION
      'admin_claim_hct_dispatch:這張單的新竹狀態是 %(要 submitted 才叫得動車), shipment=%',
      COALESCE(v_status, '(空)'), p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  IF v_edelno IS DISTINCT FROM p_edelno THEN
    RAISE EXCEPTION
      'admin_claim_hct_dispatch:貨號對不上(這一箱是 %, 而送來的是 %), shipment=%',
      COALESCE(v_edelno, '(空)'), COALESCE(p_edelno, '(空)'), p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  -- 🔴🔴 **佔位:資格條件【全部】住在這一句的 WHERE 裡**(codex R2 must-fix)。
  --    ⛔ ~~上面那幾個 IF 擋完就 `UPDATE … WHERE 箱號 AND 佔位 IS NULL`~~
  --    ⇒ 出事時序:B 寫了 `deleted_at` **還沒提交** ⇒ A 的 `SELECT` 讀到舊版「未作廢」而過關
  --      ⇒ A 的 UPDATE 卡在 B 的列鎖 ⇒ B 提交 ⇒ 📌 **PostgreSQL 在 READ COMMITTED 下**
  --      **只重驗【這一句的 WHERE】, 不會重跑上面那幾個 IF** ⇒ WHERE 仍成立 ⇒ 放行
  --      ⇒ 🛑 **一個已作廢的箱叫到了車。**
  --    ✅ ⇒ **上面那幾個 IF 從此只負責【講一句人看得懂的話】, 判準在這一句。**
  --      📌 兩者不一致時以這一句為準 —— 它是唯一在鎖之後還會被重新檢查的東西。
  UPDATE public.shipments
     SET hct_dispatch_attempted_at = pg_catalog.now()
   WHERE shipment_reference = p_shipment_reference
     AND hct_dispatch_attempted_at IS NULL
     AND deleted_at IS NULL
     AND hct_status = 'submitted'
     AND hct_request_id IS NOT DISTINCT FROM p_edelno;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n <> 1 THEN
    -- 🛑 這裡的訊息要說得出【兩個世界】:上一次叫成功了、或上一次叫到一半掛了。
    --    兩者都不准自動再打一發 —— 重複派遣的行為 V15 §8 沒寫, 我們也沒問過。
    -- ⚠️ 而它也可能是**剛剛才被別人作廢 / 改狀態**(上面的 IF 過了而這一句沒過)
    --    ⇒ 訊息把兩種都講出來, 不要只說一種讓人找錯方向。
    RAISE EXCEPTION
      'admin_claim_hct_dispatch:這一箱 % 佔不到位。兩種可能:'
      ' ①它已經在 % 開始叫車了(可能叫到車, 也可能叫到一半掛掉)'
      ' ②它剛剛被別人作廢或改了狀態。'
      ' 兩種都不准自動再打一發 —— 再叫一次會怎樣新竹沒有寫、我們沒問過 ⇒ 請人看一眼。',
      p_shipment_reference, COALESCE(v_attempted, pg_catalog.now())
      USING ERRCODE = 'P0001';
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_claim_hct_dispatch(text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_claim_hct_dispatch(text,text) TO service_role;

COMMENT ON FUNCTION public.admin_claim_hct_dispatch(text,text) IS
  '在送出 TransDispatchOrder 之【前】原子佔位。兩個同時按下去的請求只有一個拿得到。'
  ' 已作廢 / 非 submitted / 貨號對不上 ⇒ 拒絕【開始】。';

-- ── 3-b. record:新竹回成功之後補記 ───────────────────────────────────────
-- 🔴🔴 **它【不看 deleted_at】** —— codex R1 must-fix 三:
--    出事時序:A 送出派遣 ⇒ B 把同一箱作廢並提交 ⇒ 新竹回成功 ⇒ A 來補記
--    ⇒ 被 `deleted_at` 擋住 ⇒ 📌 **車會來, 而派遣紀錄是空白的。**
-- ⇒ ✅ **「允許開始」與「保存已發生的事實」是兩件事**:
--    前者可以拒(在 claim 那一支拒), 而**後者不准拒** —— 一個已經發生的對外動作
--    必須有地方寫下來, 否則它就從紀錄裡消失了, 而現實不會跟著消失。
-- 🛑 而「作廢的箱不准接著標出貨」由 `mark_shipped` 那一層擋, 不由本支擋 —— 各守各的。
CREATE FUNCTION public.admin_record_hct_dispatch(
  p_shipment_reference text,
  p_edelno             text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_attempted  timestamptz;
  v_dispatched timestamptz;
  v_edelno     text;
BEGIN
  SELECT hct_dispatch_attempted_at, hct_dispatched_at, hct_request_id
    INTO v_attempted, v_dispatched, v_edelno
    FROM public.shipments
   WHERE shipment_reference = p_shipment_reference
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_record_hct_dispatch:查無這張出貨單(%)', p_shipment_reference;
  END IF;

  -- 🔴 **沒有佔位就沒有成功可記** —— 有的話代表有人繞過了 claim, 而那條路我們不認。
  IF v_attempted IS NULL THEN
    RAISE EXCEPTION
      'admin_record_hct_dispatch:這一箱 % 沒有派遣佔位, 卻要記成功 ⇒ 有人繞過了 claim',
      p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  IF v_edelno IS DISTINCT FROM p_edelno THEN
    RAISE EXCEPTION
      'admin_record_hct_dispatch:貨號對不上(這一箱是 %, 而送來的是 %), shipment=%',
      COALESCE(v_edelno, '(空)'), COALESCE(p_edelno, '(空)'), p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  -- 🔵 **已經記過 ⇒ 什麼都不做, 不報錯**(冪等)——
  --    重試同一發補記是**安全**的, 而報錯會讓呼叫端以為出了事。
  IF v_dispatched IS NOT NULL THEN
    RETURN;
  END IF;

  UPDATE public.shipments
     SET hct_dispatched_at = pg_catalog.now()
   WHERE shipment_reference = p_shipment_reference;
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_record_hct_dispatch(text,text)
  FROM PUBLIC, anon, authenticated;

-- 🔴🔴 **GRANT 寫在這裡 —— 今天早上用一次送不出去的第一箱換來的。**
--    `20260904170000` 建同族那支時只寫 REVOKE 沒寫 GRANT ⇒ 後台按下去 42501。
GRANT EXECUTE ON FUNCTION public.admin_record_hct_dispatch(text,text) TO service_role;

COMMENT ON FUNCTION public.admin_record_hct_dispatch(text,text) IS
  '記下「這一箱向新竹叫過車了」。「不給再按」寫在這一層不在 TS ——'
  ' TS 可以被繞過, 而這一層是每一條路都會經過的地方。'
  ' 貨號要對得上:對不上代表呼叫端把箱子配錯了。';

-- ── 收權斷言 ──────────────────────────────────────────────────────────────
-- 🔴 **本檔的兩個可授權物件【都要列進來】** —— 靜態閘③ 的理由逐字:
--    「收權斷言只檢查你列出來的物件:它防【忘記收權】, 不防【忘記列】。」
--    ⇒ 📌 所以清單漏一個, 那一個就完全沒有守門, 而畫面上兩者長得一樣。
DO $assert$
DECLARE
  -- 每一列:函式簽章 · 唯一該有 EXECUTE 的角色(空字串 = 誰都不該有)
  -- 🛑 **變數名必須逐字是 `v_functions`** —— 靜態閘③ 用變數名找這張清單
  --    (`scripts/migration-static-checks.sh:683` 的 awk 只認 `v_relations|v_functions`)。
  --    ⇒ 📌 我第一版叫它 `v_fns` ⇒ **閘數到 0 個, 而清單就在它眼前。**
  v_functions   text[] := ARRAY[
    'public.admin_claim_hct_dispatch(text,text)',
    'public.admin_record_hct_dispatch(text,text)',
    'public.pcm_b2_shipments_hct_dispatched_at_write_once()'
  ]::text[];
  v_want  text[] := ARRAY['service_role', 'service_role', '']::text[];
  i       int;
  v_oid   oid;
  v_extra text;
BEGIN
  FOR i IN 1 .. pg_catalog.array_length(v_functions, 1) LOOP
    v_oid := pg_catalog.to_regprocedure(v_functions[i]);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '收權斷言:找不到函式 % ⇒ 拒繼續', v_functions[i];
    END IF;
    -- 🔴 多出來的角色 —— 而 `CURRENT_USER`(擁有者)本來就有, 不算多。
    SELECT pg_catalog.string_agg(g.grantee, ', ')
      INTO v_extra
      FROM (
        SELECT pg_catalog.pg_get_userbyid((aclexplode(p.proacl)).grantee) AS grantee
          FROM pg_catalog.pg_proc p WHERE p.oid = v_oid
      ) g
     WHERE g.grantee NOT IN (CURRENT_USER)
       AND (v_want[i] = '' OR g.grantee <> v_want[i]);
    IF v_extra IS NOT NULL THEN
      RAISE EXCEPTION '收權斷言:% 的 EXECUTE 多出非預期角色(%)⇒ 拒繼續', v_functions[i], v_extra;
    END IF;
    -- 🔴 而【該有的那一個要真的有】—— 少了它就是今天早上那個 42501。
    IF v_want[i] <> ''
       AND NOT pg_catalog.has_function_privilege(v_want[i], v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言:% 對 % 沒有 EXECUTE ⇒ 按下去會 42501', v_functions[i], v_want[i];
    END IF;
    -- ⚪ 負對照:`anon` 永遠不該有(兩支都是)。
    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言(負對照):anon 對 % 竟然有 EXECUTE ⇒ 收權沒生效', v_functions[i];
    END IF;
  END LOOP;
END
$assert$;

-- ── 後置閘 ────────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_n int;
BEGIN
  -- ① 欄在
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = pg_catalog.to_regclass('public.shipments')
                    AND a.attname = 'hct_dispatched_at' AND NOT a.attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                     WHERE a.attrelid = pg_catalog.to_regclass('public.shipments')
                       AND a.attname = 'hct_dispatch_attempted_at' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '後置閘①:兩欄沒有都建起來';
  END IF;

  -- ② trigger 在, 而且掛在 shipments 上
  SELECT count(*) INTO v_n FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = pg_catalog.to_regclass('public.shipments')
     AND t.tgname = 'shipments_hct_dispatched_at_write_once_bu'
     AND NOT t.tgisinternal;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '後置閘②:write-once trigger 落 % 個(期望 1)', v_n;
  END IF;

  -- ③ 🔴 **service_role 真的執行得動** —— 而這一格是今天那個 42501 的直接對策。
  --    ⛔ ~~只看 proacl 字串裡有沒有那個名字~~ ⇒ 那答不出「繼承來的權限算不算」。
  IF NOT pg_catalog.has_function_privilege(
       'service_role', 'public.admin_record_hct_dispatch(text,text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'service_role', 'public.admin_claim_hct_dispatch(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘③:service_role 沒有 EXECUTE ⇒ 後台按下去會 42501, 而它長得像新竹拒絕';
  END IF;

  -- ④ ⚪ 負對照:anon 不准執行得動(否則上面那格可能是「大家都能跑」)
  IF pg_catalog.has_function_privilege(
       'anon', 'public.admin_record_hct_dispatch(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘④(負對照):anon 竟然執行得動 ⇒ 收權沒生效';
  END IF;

  -- ⑤ 🔴 既有資料一列都不准被動到 —— 新欄一律 NULL。
  SELECT count(*) INTO v_n FROM public.shipments
   WHERE hct_dispatched_at IS NOT NULL OR hct_dispatch_attempted_at IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '後置閘⑤:新欄竟然有 % 列非空 ⇒ 本檔不該寫任何一列', v_n;
  END IF;

  RAISE NOTICE '完成:hct_dispatched_at 建好, write-once 上鎖, service_role 執行得動, 既有資料零改動。';
END
$post$;

COMMIT;
