-- ═══ M-4b ⟦b9-REFUNDNUM1⟧:退款畫面那個數字的【後半句】═══════════════════
-- Sean 2026-09-07 `Q75` = **不扣**(主數字維持現行行為)· `Q77` = **好**(加後半句)。
-- 主視窗 A 2026-09-07 批【甲】:**新開一支唯讀函式**, 不動 `pcm_order_refundable_remaining`。
--
-- 🎯 **他為什麼不選我們給的那兩個選項**(逐字:「但是這個給我的選項 感覺應該有更好的解法」):
--    **那兩個選項都在讓【同一個數字】說謊** —— 先扣 ⇒ 對客人說謊(其實還沒判定);
--    不扣 ⇒ 對員工說謊(照畫面填會被系統當場擋)。
--    📌 **我們把一個【有兩個受眾】的欄位, 當成一個數字在問。** 問題出在選項的形狀, 不在他選不出來。
--    ✅ 第三案:主數字**維持不扣**, 而畫面顯示成
--       「**還能退 8,000,另有 2,000 待人工判斷**」⇒ 兩邊都不用猜。
--
-- ══ 🔴🔴 為什麼是【新開一支】而不是改那一支 ═══════════════════════════════
--    2026-09-07 唯讀量到:`pcm_order_refundable_remaining` 在**正式庫**是 `SET search_path TO ''`,
--    而 repo 第 5 代(`20260820010000` 之後的 `20260820100000:229`)宣告的是
--    `SET search_path = public, pg_temp` ⇒ 🛑 **正式庫跑的不是 repo 那一版的逐字。**
--    ⇒ 從 repo 抄一份 `CREATE OR REPLACE` 貼下去 = **把一次安全強化靜靜回捲**
--      (`CREATE OR REPLACE` 會把**整組 `SET` 換掉** —— 貼板 84 R3 F3 記過同一件事),
--      而它**三綠不紅、審查看不出來、diff 上長得像一次正常的重貼**。
--    ✅ ⇒ 本支**一個字都不碰那支函式**;`Q75 = 不扣` 之下,
--      「**主數字結構上不可能被改到**」是**硬需求不是偏好**(A 逐字)。
--
-- ══ 這支答的是什麼 ═══════════════════════════════════════════════════════
--    「這張單上, **被標成要人工判斷而【還沒有人去判】**的退款, 合計多少錢。」
--    🔬 **「還沒有人去判」的定義是量出來的, 不是我定的**:
--      `public.order_refund_effective_verdict` 的定義(2026-09-07 唯讀讀正式庫)是
--      `SELECT DISTINCT ON (refund_id) … FROM order_refund_manual_corrections ORDER BY refund_id, seq DESC`
--      ⇒ **一筆退款只要被判過(不論判成哪一種), 它在那張 view 裡就【有一列】。**
--      ⇒ 所以「還沒判」= **在那張 view 裡沒有列** = `v.refund_id IS NULL`。
--    🛑 **判過 `no_money_moved` 的【不算】待判定** —— 它已經有結論了(結論是「錢沒動」)。
--      而主數字對它的處理也是「不扣」⇒ 兩邊一致, 這不是巧合, 是同一個事實的兩個面。
--
-- ══ 🔬 今天的曝險 = 0 列(而那個 0 帶著時點) ═════════════════════════════
--    2026-09-07 唯讀量(`pcm_readonly` + `bypassrls`):
--      `manual_failed` 總列數 **0** · 其中未判定 **0** · 判 `money_moved` **0** · 判 `no_money_moved` **0**
--      🟢 正對照:同一發 `order_refunds` 全表 **1** 列 ⇒ **那些 0 不是連線壞掉或權限擋住。**
--    ⇒ 📌 **今天貼下去, 每一張單的後半句都會是「沒有」。**
--    ⛔ ~~⇒ rollback 成本是 0~~ 🔴 **推太遠**(codex nit):零列只說明**沒有資料要救**;
--       **呼叫端一旦上線, `DROP` 之後那些呼叫照樣失敗** ⇒ 仍要協調退版順序(前端先退、這支後退)。
--       ✅ 正確說法:**資料面的 rollback 成本是 0;呼叫端那面不是。**(還原檔自己也寫著這一句。)
--    🛑 **而那個 0 有時效** —— 第一筆 `manual_failed` 出現時, 這一段要重量。
--
-- ══ 🔴 兩道 REVOKE, 少一道都是開的 ═══════════════════════════════════════
--    依據 `docs/patterns/revoking-function-execute-in-supabase.md`(標題逐字)。
--    **新物件出生就自帶 `anon` 權限** ⇒ 只寫 `GRANT` 的話 `anon` 照樣叫得到,
--    而那會讓「顧客站結構上叫不到它」變成一個**看起來更硬的錯結論**。
--    🔬 該檔 PG 17.10 實測:只 `FROM anon, authenticated` ⇒ **仍叫得到**;
--       只 `FROM PUBLIC` ⇒ **仍叫得到**;**兩道都下** ⇒ 直接路徑才關上。
--    🛑 **而「兩道都下」仍不等於「一定執行不到」** —— 還有 owner 與 `SET ROLE` 兩條繞路
--       (該檔 §3.5)⇒ 本檔只宣稱**直接路徑關上**, 不宣稱執行不到。
--    🔵 分兩行寫是**可讀性選擇不是能力限制**(該檔 `:64-65`:「『不能寫在一起』是假的」)——
--       分開的理由:兩者收的是**兩種不同的授權**, 擠在一行會讓下一個人以為前者涵蓋後者。
--
-- ⚠️ ⛔ ~~本檔唯讀:零 DML、零 schema 變更~~ 🔴 **那句超出實作**(codex nit):
--    本檔有 `CREATE FUNCTION` 與授權變更 ⇒ **它改 schema**。
--    ✅ 正確說法:**零 DML**(不寫任何資料列)· **不動任何既有函式**(那支只被讀不被改)。
--    而**函式本身**是 `STABLE` 唯讀。
-- ⚠️ **還原**:`supabase/rollbacks/20260907200000_down.sql`(一行 `DROP FUNCTION` 具名簽章)。
--    🔵 新函式**有回頭路** ⇒ 附還原檔不是硬要求(A 的條件① 針對的是不可逆的), 而它一行的事。
-- ⚠️ **未貼**。2026-09-07 Sean 逐字授權 A「**自己貼, 不要再問我**」⇒ 流程 = 我給 sha → A 乾跑 → A 貼 → **我自己複驗**(不靠他回報綠)。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ── 前置閘 ①:那支【不能被碰到】的函式, 現在長什麼樣 ────────────────────
--    本檔不改它, 而若它已經不是我量到的那一版, 那代表有人動過 ⇒ 停下來看一眼。
DO $g1$
DECLARE v_cfg text; v_cfgarr text[]; v_secdef boolean; v_n integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_order_refundable_remaining';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '前置閘①:pcm_order_refundable_remaining 應為 1 支, 實際 %(多載會讓下游的斷言指錯支)', v_n;
  END IF;
  SELECT pg_catalog.array_to_string(p.proconfig, '|'), p.proconfig, p.prosecdef
    INTO v_cfg, v_cfgarr, v_secdef
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_order_refundable_remaining';
  -- 🔴 **只釘我在乎的那一個元素, 不鎖整組**(codex 2026-09-07 must-fix):
  --    ⛔ ~~`v_cfg IS DISTINCT FROM 'search_path=""'`(整組字串全等)~~
  --    失敗情境:有人替它加一個**與本片完全無關**的 `SET work_mem` ⇒ 空 search_path、SECDEF、算法全沒變,
  --    而本片**拒絕部署**。📌 **那是把「無關設定」鎖成當日值。**
  --    ✅ 改成**元素層級的全等**:`'search_path=""' = ANY(proconfig)` ——
  --    🛑 **仍然是全等不是「含有」**(貼板 84 R4 打過我一次:`strpos` 會讓 `search_path=pg_catalog, pg_temp` 過關),
  --    只是全等的對象從【整組】收窄成【那一個元素】。
  IF NOT ('search_path=""' = ANY(COALESCE(v_cfgarr, ARRAY[]::text[]))) OR v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION '前置閘①:那支函式的 search_path/SECDEF 不是我量到的樣子(SET=[%] secdef=%)⇒ 有人動過它, 停下來看一眼', v_cfg, v_secdef;
  END IF;
END
$g1$;

-- ── 前置閘 ②:本檔要建的名字還沒被別人用掉 ──────────────────────────────
DO $g2$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_order_pending_manual_verdict_amount';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '前置閘②:pcm_order_pending_manual_verdict_amount 已存在 %支 ⇒ 本檔貼過了, 或有人先建過, 停下人工對齊', v_n;
  END IF;
END
$g2$;

-- ── 本體 ────────────────────────────────────────────────────────────────
--    形狀逐字對齊 `pcm_order_refundable_remaining` 在【正式庫】的樣子:
--    `LANGUAGE sql` · `STABLE` · `SECURITY DEFINER` · `SET search_path TO ''` · 全部 schema 限定。
CREATE FUNCTION public.pcm_order_pending_manual_verdict_amount(p_order_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $fn$
  SELECT COALESCE(
           (SELECT SUM(r.refund_amount)
              FROM public.order_refunds r
              LEFT JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
             WHERE r.order_id = p_order_id
               AND r.status = 'failed'
               AND r.failed_reason = 'manual_failed'
               AND v.refund_id IS NULL), 0)::bigint;
$fn$;

-- ── 🔴 兩道 REVOKE + 一道 GRANT(少一道都是開的)──────────────────────────
REVOKE ALL ON FUNCTION public.pcm_order_pending_manual_verdict_amount(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_order_pending_manual_verdict_amount(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_order_pending_manual_verdict_amount(uuid) TO service_role;

COMMENT ON FUNCTION public.pcm_order_pending_manual_verdict_amount(uuid) IS
  '⟦b9-REFUNDNUM1⟧ 這張單上「被標成要人工判斷而【還沒有人去判】」的退款合計金額。'
  '判準:order_refunds.status=failed AND failed_reason=manual_failed AND 在 order_refund_effective_verdict 裡沒有列。'
  '判過 no_money_moved 的不算(它已經有結論)。'
  '它【預定】給後台畫面的後半句用(「還能退 N,另有 M 待人工判斷」)。'
  '它確實在 SUM 金額,而本函式無法禁止呼叫端拿它去算錢 —— 這裡寫的是【用途】不是【保證】。'
  '它不影響 pcm_order_refundable_remaining 的回傳值 —— 那一支本檔一個字都沒碰。';

-- ── 事後斷言(每一格都要能在【沒做到】那個世界印紅)────────────────────
DO $a1$
DECLARE
  -- 🔴 **收權斷言清單** —— 靜態守門③ 的判準:可授權物件數 vs 這張清單的長度。
  --    它防的是「忘記收權」, **不防「忘記列」** ⇒ 新增可授權物件時這裡要跟著長。
  v_functions text[] := ARRAY[
    'public.pcm_order_pending_manual_verdict_amount(uuid)'
  ]::text[];
  v_fn text;
  v_cfg text; v_secdef boolean; v_anon boolean; v_auth boolean; v_svc boolean;
BEGIN
  -- 逐支跑, 而本檔只有一支 —— 迴圈是為了「下一個人加第二支時不必改結構」。
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF pg_catalog.to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION '斷言0:清單上的 % 不存在 ⇒ 清單與本檔建的東西對不上', v_fn;
    END IF;
  END LOOP;
  SELECT pg_catalog.array_to_string(p.proconfig, '|'), p.prosecdef INTO v_cfg, v_secdef
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_order_pending_manual_verdict_amount';
  IF v_cfg IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION '斷言A:新函式的 SET 子句不是 search_path=""(實際 [%])', v_cfg;
  END IF;
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION '斷言B:新函式不是 SECURITY DEFINER';
  END IF;

  -- 🔴 判準用 has_function_privilege(有效權限, 含繼承路徑), **不用 proacl 字面** ——
  --    該 pattern 檔逐字:兩者會不一致, 而會咬人的是有效權限。
  v_anon := pg_catalog.has_function_privilege('anon',
              'public.pcm_order_pending_manual_verdict_amount(uuid)', 'EXECUTE');
  v_auth := pg_catalog.has_function_privilege('authenticated',
              'public.pcm_order_pending_manual_verdict_amount(uuid)', 'EXECUTE');
  v_svc  := pg_catalog.has_function_privilege('service_role',
              'public.pcm_order_pending_manual_verdict_amount(uuid)', 'EXECUTE');

  -- 🎯 這三格是本檔唯一能在【沒收掉】那個世界印紅的東西 —— 少了它們, 上面兩道 REVOKE 只是宣稱。
  IF v_anon THEN
    RAISE EXCEPTION '斷言C:anon 仍執行得到 ⇒ 兩道 REVOKE 沒關上(新物件出生自帶 anon 權限)';
  END IF;
  IF v_auth THEN
    RAISE EXCEPTION '斷言D:authenticated 仍執行得到 ⇒ 同上';
  END IF;
  IF NOT v_svc THEN
    RAISE EXCEPTION '斷言E:service_role 執行不到 ⇒ 後台會叫不動它(這一格是正對照:它證明上面那把尺不是恆假)';
  END IF;
  RAISE NOTICE '⟦b9-REFUNDNUM1⟧ 過:anon=f / authenticated=f / service_role=t · SET=% · SECDEF=%', v_cfg, v_secdef;
END
$a1$;

-- ── 🔵 那支【不能被碰到】的函式:貼完再驗一次它的 search_path 沒變 ────────
--    ⚠️ **收窄(codex nit)**:這一格**證不到「它沒被碰到」** —— 本體、`SECURITY DEFINER`、ACL
--    被改而只留住 `search_path`, 它照樣印綠。**它只答一個問題:那一個元素還在不在。**
DO $a2$
DECLARE v_cfg text;
BEGIN
  SELECT pg_catalog.array_to_string(p.proconfig, '|') INTO v_cfg
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_order_refundable_remaining';
  IF v_cfg IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION '斷言F:pcm_order_refundable_remaining 的 search_path 在本檔跑完之後變了(實際 [%])—— 本檔不該碰它', v_cfg;
  END IF;
END
$a2$;

COMMIT;

-- ══ 🛑 本檔【證不到】什麼 ════════════════════════════════════════════════
--  ① **不證「顧客站執行不到」** —— 只證**直接路徑關上**(`anon`/`authenticated` 的 EXECUTE 是 false)。
--     owner 與 `SET ROLE` 兩條繞路不在本檔的射程裡(見該 pattern 檔 §3.5)。
--  ② **不證這支函式算得對** —— 上面每一格量的都是**屬性與權限**, 一格都沒有餵資料進去。
--     行為驗收在前端片的 `V1`-`V5` 與突變, **不在這裡**。
--  ③ ⛔ ~~`has_*_privilege` 對欄級授權少報;ACL 欄 NULL 時 PUBLIC 看不見~~
--     🔴 **那兩句我套錯對象了**(codex 2026-09-07 訂正, 附 PG 原始碼):
--     · `proacl = NULL` 時 `has_function_privilege` **仍會計入預設的 PUBLIC EXECUTE** ——
--       會漏報的是**直接讀 `aclexplode(proacl)`**, 不是 `has_function_privilege`。
--     · **欄級授權**根本不是函式 `EXECUTE` 的盲區(那是表/欄的事)。
--     ✅ ⇒ 斷言 C/D **比我原本以為的更可信**;而它們仍**不涵蓋** owner 與 `SET ROLE` 兩條繞路(見①)。
--  ④ **今天曝險 0 列那個讀數帶時點**(2026-09-07)—— 第一筆 `manual_failed` 出現時要重量。
