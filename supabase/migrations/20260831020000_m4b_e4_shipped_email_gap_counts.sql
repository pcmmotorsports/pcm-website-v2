-- ============================================================
-- M-4b E4:出貨信「貨出了而通知信沒被建出來」的計數 RPC
--
-- 🔴 **這一片只讓數字讀得到 + 接進既有告警閘。它不寄任何客人的信。**
--
-- **它補的那個洞**:既有的 `get_email_outbox_deadman_counts` 六個數字
-- **全部 `FROM public.email_outbox`** ⇒ 只數【已經存在的列】
-- ⇒ 📌 **一個只數存在的東西的量具,對「東西沒被建出來」永遠印 0,而那個 0 看起來像正常。**
-- (那句是 `20260829010000` 檔頭自己寫的;它同時逐字寫著「訊號 4 不在本函式」。)
--
-- 🔵 **而出貨那半比它預想的便宜**:它預想「要拿 `orders` 當分母做 anti-join」,
-- 而出貨那半的 anti-join **早就是一支 view**(`pcm_shipped_email_pending`,`20260822010000`)。
--
-- ── Sean 2026-08-31 逐字拍板「2 甲」──
--   「只數【起始線之後、而且已經超過 15 分鐘還沒排進去】的,大於 0 就叫」
--   · 起始線 = 呼叫端傳進來的 `p_shipped_cutoff`(對應 env `SHIPPED_EMAIL_CUTOFF`)
--   · 15 分鐘 = 呼叫端傳進來的 `p_grace_seconds`(= 3 次掃描;寄信佇列排程是每 5 分鐘)
--   🔴 **兩個都不給 DEFAULT** —— 照 `20260829010000` 的成例:
--      **省略 = 找不到相符簽名**,而「預設值」會變成一個沒有人拍過板的權威。
--
-- 🔴 **為什麼要一支 SECDEF RPC 而不是直接查那支 view**:
--   告警那條路跑在 `payment_confirmer`,而那支 view 讀 `shipments` / `orders` / `customers`
--   ⇒ 直接查 ⇒ `42501`。唯一的路 = owner-defined SECDEF 受控窗(照 `20260701120000` 範式)。
--
-- 🔴 **零 PII**:本函式只回 `count(*)`。那兩支 view 的欄位含收件信箱與姓名,
--   而**本函式一個欄位都不回** —— 只回三個整數。
--
-- ⚠️ **它答不出什麼**(寫在這裡,不是寫在交件檔):
--   · 它答不出「**起始線以前**的出貨有沒有漏信」—— 那是刻意的:那些本來就不該寄。
--   · 它答不出「那封信寄出去了沒」—— 它只數「**有沒有被排進佇列**」。
--   · 🔴 那支 view 的 anti-join **不分 status** ⇒ 一列 `skipped_shipment_voided` 會讓那一格
--     **永久離開分子**(板上 `⟦b4-SHIPUNVOID1⟧`)⇒ **本量具在那個漏信面上恆印 0。**
--     ⇒ 那一格**不在本片**,而它是一個**已知的、具名的**盲區,不是被忽略的。
-- ============================================================

BEGIN;

-- ── 1. 函式 ──
-- 🛑 刻意【不用】`CREATE OR REPLACE` —— 這是新物件。
--    `OR REPLACE` 會把「撞名」從報錯變成靜靜跳過,
--    而跳過之後下面的 REVOKE 與斷言會對著【一個我沒看過的既有物件】跑。
--    (docs/patterns/revoking-function-execute-in-supabase.md §3.2)
CREATE FUNCTION public.get_shipped_email_gap_counts(
  p_shipped_cutoff timestamptz,
  p_grace_seconds integer
)
RETURNS jsonb
-- 🔴🔴 **`plpgsql` 而不是 `sql`, 而那不是風格** —— codex 2026-08-31 R1 must-fix:
--   純 SQL 函式**沒有辦法 RAISE** ⇒ 參數的 NULL / 0 / 負數只能被【安靜地吞掉】。
--   而那三條路各自壞在不同方向:
--     · `p_shipped_cutoff` 是 NULL ⇒ `shipped_at >= NULL` = UNKNOWN ⇒ **恆回 0 = 靜默漏報**
--       📌 而 0 正是「一切正常」的樣子 ⇒ **一個壞掉的呼叫與一個健康的系統印同一個數。**
--     · `p_grace_seconds` = 0 或負數 ⇒ 剛出貨那一批立刻算進來 ⇒ **每一輪都在叫一個正常狀態**
--       ⇒ 而噪音會讓人把整組告警關掉(板上 `⟦b4-EMAIL2ND⟧` 有前科)。
--   ⇒ **兩個方向的壞法都要 fail-closed:寧可 apply/呼叫當場炸, 不要回一個看起來正常的數字。**
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_result jsonb;
BEGIN
  IF p_shipped_cutoff IS NULL THEN
    RAISE EXCEPTION 'get_shipped_email_gap_counts:p_shipped_cutoff 不得為 NULL(NULL 比較 = UNKNOWN ⇒ 恆回 0 = 靜默漏報)';
  END IF;
  IF p_grace_seconds IS NULL OR p_grace_seconds <= 0 THEN
    RAISE EXCEPTION 'get_shipped_email_gap_counts:p_grace_seconds 必須是正整數(收到 %);<= 0 會把剛出貨那一批算進來 ⇒ 每一輪都在叫一個正常狀態', p_grace_seconds;
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    -- 🔴 **分子**:貨出了、有收件信箱、而通知信【還沒被排進佇列】,
    --    且它已經過了寬限期(= 該被撿走而沒被撿走)。
    -- ⚠️ `>= cutoff` 與 `< now() - grace` 兩個條件缺一不可:
    --    少了前者 ⇒ 上線前的舊出貨全部進來 ⇒ **第一天就叫、天天叫、永遠不停**
    --      ⇒ 📌 一個永遠在叫的告警比沒有告警更糟 —— 它會讓人把整組關掉。
    --    少了後者 ⇒ 剛出貨還沒輪到那一批也被算進來 ⇒ **每一輪都在叫一個正常狀態**。
    'shipped_never_enqueued_count',
      (SELECT pg_catalog.count(*)
         FROM public.pcm_shipped_email_pending v
        WHERE v.shipped_at >= p_shipped_cutoff
          AND v.shipped_at < (pg_catalog.now()
                              - (p_grace_seconds::text || ' seconds')::interval)),

    -- 🔵 **另一種壞法,而它與上面那個【不同】**:貨出了,而那張單**兩個信箱都是空的**
    --    ⇒ 它不會進佇列,而那不是系統壞掉,是**我們沒有那個客人的信箱**。
    --    ⇒ 分開數的理由與 5-a / 5-b 同一個:**併起來 = 用一種原因的文案報另一種原因。**
    'shipped_unsendable_count',
      (SELECT pg_catalog.count(*)
         FROM public.pcm_shipped_email_unsendable v
        WHERE v.shipped_at >= p_shipped_cutoff
          AND v.shipped_at < (pg_catalog.now()
                              - (p_grace_seconds::text || ' seconds')::interval)),

    -- 🔴🔴 **分母**(2026-08-31 加,而它是【上一片的教訓】直接套過來的):
    --    沒有它,上面兩個 0 在「一切正常」與「這裡根本沒有出貨資料 / 讀不到」之間**分不出來**。
    --    ⚠️ 它刻意數 `shipments` 而**不是**數那兩支 view —— 那兩支 view 是 anti-join,
    --       **它們回 0 正是健康的樣子** ⇒ 拿它們當分母等於沒有分母。
    -- ⚠️ **[codex R1 consider · 用途寫在它旁邊, 免得下一個人拿它去算比率]**
    --    它是**全域未刪 shipment 數** —— **含未出貨、也含起始線以前的**。
    --    ⇒ 它要答的問題是「**這裡到底有沒有出貨資料**」, **不是**「這個告警視窗裡有幾筆」。
    --    ⇒ 📌 **一個分母的用途要寫在它旁邊, 否則下一個人會拿它去算比率。**
    'shipments_total_count',
      (SELECT pg_catalog.count(*)
         FROM public.shipments s
        WHERE s.deleted_at IS NULL)
  )
  INTO v_result;
  RETURN v_result;
END
$fn$;

ALTER FUNCTION public.get_shipped_email_gap_counts(timestamptz, integer) OWNER TO postgres;

COMMENT ON FUNCTION public.get_shipped_email_gap_counts(timestamptz, integer) IS
  'M-4b E4 出貨信缺口計數(Sean 2026-08-31 拍板「2 甲」)。owner-defined SECDEF 受控窗,payment_confirmer cron 唯讀讀聚合計數(零 PII/零信箱/零 id)。回 jsonb{shipped_never_enqueued_count, shipped_unsendable_count, shipments_total_count}。'
  '分子 = pcm_shipped_email_pending 裡【起始線之後、且已過寬限】的列 = 該被排進佇列而沒有被排的。'
  '分母數的是 shipments 不是那兩支 view —— view 是 anti-join, 回 0 正是健康的樣子, 拿它當分母等於沒有分母。'
  '兩個參數都無 DEFAULT(省略 = 找不到相符簽名):起始線與寬限都是營運參數, 預設值會變成沒有人拍過板的權威。'
  '🔴 已知盲區:那支 view 的 anti-join 不分 status ⇒ 一列 skipped_shipment_voided 會讓那一格永久離開分子(板上 b4-SHIPUNVOID1)⇒ 本量具在那個漏信面上恆印 0。那一格不在本片, 而它是具名的, 不是被忽略的。'
  '不動 shipments / orders / customers 的任何 grant。';

-- ── 2. ACL(兩道 REVOKE 是物理擋,不是慣例)──
-- ⚠️ **[codex R1 consider · 收窄本段的宣稱]**:下面那段斷言驗的是 **direct grant**,
--    它**不驗「誰能 `SET ROLE payment_confirmer`」** ⇒ **那五個角色的 false 不是「不可達」的證明。**
--    ⇒ 那是**既有的角色成員缺口**, 不是本片新增的;寫在這裡是為了不讓下一個人把它讀成完整證明。
-- 🔴 新物件**出生就自帶 anon 權限**,而 repo 內零 `GRANT` 字面可掃、三綠不紅。
--    (docs/patterns/revoking-function-execute-in-supabase.md:「兩道 REVOKE,少一道都是開的」)
-- 🔴🔴 **[2026-08-31 實測 —— 而這一段是【給想刪掉 `anon` 的下一個人】看的]**
--   我在拋棄式 PG 上跑過一發突變:**把上面那行的 `anon` 拿掉** ⇒ **rc=0, 一聲不吭。**
--   ⇒ 而我沒有猜為什麼, 我量了:那個世界裡新函式對 `anon` 的 EXECUTE
--     是**經由 `PUBLIC` 來的**(實測:一支完全沒 REVOKE 的新函式,
--     `has_function_privilege('anon', …)` ⇒ **true**)
--     ⇒ 一道 `REVOKE ... FROM PUBLIC` 就已經拿掉那條路。
--   🛑 **⇒ 所以那一發【不是證明 `anon` 是多餘的】, 是證明【我的測試世界少了一層】** ——
--     `docs/patterns/revoking-function-execute-in-supabase.md` 那個四臂實測是在
--     **Supabase 的預設授權**之上做的(`anon` 在那裡有**直接的**授權), 而拋棄式 PG 沒有那一層。
--   🔴 **⇒ 不要因為「本機重跑它不炸」就刪掉 `anon`。**
--     那一發在拋棄式 PG 上殺不掉、在正式庫上殺得掉, **而那個差沒有別的地方記著。**
--   📌 **⇒ 一個在錯的世界裡跑的負對照, 會給你一個【看起來像好消息】的 rc=0。**
REVOKE ALL ON FUNCTION public.get_shipped_email_gap_counts(timestamptz, integer)
  FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.get_shipped_email_gap_counts(timestamptz, integer)
  TO payment_confirmer;

-- ── 3. fail-closed assert:收權斷言(清單驅動 + proacl 無條件掃描)──
-- 🔴 兩段【問的不是同一件事】:
--    上面那段問「**我點名的那幾個**有沒有被收乾淨」;
--    下面那段問「**還有誰**」—— 而只有後者擋得住「日後有人建 ops_reader 並授權」。
DO $newobj_guard$
DECLARE
  v_relations text[] := ARRAY[]::text[];
  v_functions text[] := ARRAY[
    'public.get_shipped_email_gap_counts(timestamptz,integer)'
  ]::text[];
  v_fn    oid;
  r       text;
  v_extra text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(r);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'M-4b E4 收權斷言失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;
    IF pg_catalog.has_function_privilege('public', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'M-4b E4 收權斷言失敗:% 對 PUBLIC/anon/authenticated/service_role 還開著 EXECUTE(REVOKE 少了一個角色?或 proacl 是 NULL = 套用預設)', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('payment_confirmer', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'M-4b E4 收權斷言失敗:% 對 payment_confirmer 沒有 EXECUTE ⇒ 告警讀不到出貨缺口計數', r;
    END IF;
  END LOOP;

  -- 🔴🔴 **鎖 `oid`,不比字串** —— 這一行是 `20260829010000` 用實測換來的:
  --    `pg_get_function_identity_arguments` 回的字串**含參數名**
  --    ⇒ 比對 `'timestamptz, integer'` 會**永遠不匹配** ⇒ 整段掃描恆綠。
  --    📌 **範式的【形狀】可以抄,它的【常數】不行。**
  SELECT pg_catalog.string_agg(g.grantee, ', ')
    INTO v_extra
    FROM (
      SELECT pg_catalog.pg_get_userbyid((aclexplode(p.proacl)).grantee) AS grantee
        FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.get_shipped_email_gap_counts(timestamptz,integer)')
    ) g
   -- `CURRENT_USER` 是關鍵字不是函式(寫成 `pg_catalog.current_user` 會被當成欄名)。
   WHERE g.grantee NOT IN ('payment_confirmer', CURRENT_USER);

  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'M-4b E4 出貨缺口計數:EXECUTE 授權清單多出非預期角色(%) — 只應有 payment_confirmer;拒繼續', v_extra;
  END IF;
END
$newobj_guard$;

-- ── 4. 形狀自檢:三個 key 都要在(缺鍵 ⇒ 呼叫端 fail-closed 才有東西可依據)──
-- ⚠️ **而它只驗形狀不驗值** —— 值對不對要靠呼叫端的測試與真實資料,
--    這裡擋的是「函式建成了而少回一個 key」那一種。
DO $shape$
DECLARE
  v jsonb;
BEGIN
  v := public.get_shipped_email_gap_counts('2000-01-01T00:00:00Z'::timestamptz, 900);
  IF v IS NULL
     OR NOT (v ? 'shipped_never_enqueued_count')
     OR NOT (v ? 'shipped_unsendable_count')
     OR NOT (v ? 'shipments_total_count') THEN
    RAISE EXCEPTION 'M-4b E4 形狀自檢失敗:回傳缺鍵或為 NULL ⇒ 拒繼續(收到 %)', v;
  END IF;
END
$shape$;

COMMIT;
