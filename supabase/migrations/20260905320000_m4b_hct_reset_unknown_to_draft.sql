-- M-4b · 卡在 `unknown` 的箱子放回 `draft` —— 而它【不自己判】, 它收一句人證
-- ⟦ship-HCTUNKNOWNSTUCK⟧ 片 A · 2026-09-05 · 線【後台·列印與出貨文件】`-ship`
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 **本支【不做】自動判斷 —— 而那是整個設計的核心, 不是偷懶**
-- ══════════════════════════════════════════════════════════════════════════
--    佔位是在 HTTP **發出去之前**寫的(`shipment-actions.ts:599-605`, 逐字
--    `raw: { placeholder: true, at: … }` 與 `requestId: null`)。
--    ⇒ 所以「有 placeholder 而沒有回應」有**兩個世界**:
--      ① 那一發**從來沒送出去**   ⇒ 新竹沒收到 ⇒ 放回 draft 是對的
--      ② 送出去了而**回應掉了**   ⇒ 新竹收到了 ⇒ 放回 draft ⇒ 有人再按一次
--                                    ⇒ 🔴 **客人收到兩箱, 而運費付兩次。**
--    🛑 **我們這一端沒有任何量具分得出這兩個世界。**
--    ⇒ 📌 **所以本函式不可以自己判。它收一句【操作者的證詞】並把它寫進稽核。**
--
--    🎯 **它把一個【機器答不出來的問題】換成一個【有人負責的答案】** ——
--      而稽核讓那個負責**可查**。
--    ⚠️ **而這不是把責任丟給人**:人本來就是唯一能打電話問新竹的那個;
--      本函式做的是**讓那通電話留下痕跡** —— 而**今天手動改 DB 是零痕跡的**。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴 **只處理【甲型】—— 而這一刀不是為了少做事**
-- ══════════════════════════════════════════════════════════════════════════
--    甲型 佔位卡住  `hct_raw_response ->> 'placeholder' = 'true'` 且 `hct_request_id IS NULL`
--                   ⇒ ✅ **完全不依賴新竹的回應格式** —— 那個標記是**我們自己寫的**
--    乙型 新竹回了而我們讀不懂(raw 是真實回應, 沒有 placeholder 鍵)
--                   ⇒ 🔴 **要看得懂那份回應才知道「查到了沒」** ⇒ 依賴 `Q-新竹傳輸方式`
--    ⇒ 📌 **而 migration 是不可變歷史 ⇒ 現在把乙型的判準寫進來, 等於猜一個改不回來的東西。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🛑 **本支【證不到】什麼(貼進正式庫之前先讀這一段)**
-- ══════════════════════════════════════════════════════════════════════════
--    · 後置閘的**收權那幾格在本機拋棄式 Postgres 上零判別力** ——
--      本機的預設授權與 Supabase 不同 ⇒ 🔴 **那幾格要 Sean 貼進正式庫之後才算數。**
--      (`docs/runbooks/throwaway-postgres-for-migration-verification.md` 逐字:
--       「apply 成功 ≠ 斷言通過」·「本機對 Supabase 預設授權零判別力」)
--    · 本支**沒有辦法在一個真的卡住的箱上演練** —— 今天暴露 = 0
--      (`HCT_SUBMIT_ENABLED` 沒設 ⇒ 那顆鈕連 `runHctSubmit` 都不呼叫)
--      ⇒ 📌 **它是【讀起來對】, 不是【跑過對】。**
--    · `admin_audit_log.actor` 今天是**首頁 picker 自己選的、零驗證** ——
--      稽核記得下「誰按的」, 而**那個「誰」本身沒有被驗過**。既有缺口, 本支不修, 而要知道。

BEGIN;

-- ── 1. 前置閘 ────────────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_def text;
BEGIN
  -- ① 值域必須已經有 unknown ——【本支要把它【改離】unknown, 所以那個值必須存在】。
  -- 🔴 **存在性要排在最前面** —— 下面那個 `'public.shipments'::regclass` 會在表不存在時
  --    直接拋 generic relation error ⇒ 原本寫在第四格的「找不到 shipments」**永遠到不了**
  --    (codex nit;而那個錯訊息說不出「這不是我以為的那個世界」)。
  IF pg_catalog.to_regclass('public.shipments') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:找不到 public.shipments ⇒ 這不是我以為的那個世界';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conname = 'shipments_hct_status_domain'
     AND conrelid = 'public.shipments'::regclass;
  IF v_def IS NULL OR pg_catalog.strpos(v_def, 'unknown') = 0 THEN
    RAISE EXCEPTION
      '前置閘①:hct_status 值域裡沒有 unknown ⇒ 20260904140000 還沒貼。本支處理的就是 unknown 那個狀態。現況 = %',
      COALESCE(v_def, '(找不到那條 CHECK)');
  END IF;

  -- ② forward-only:拒重跑。
  IF pg_catalog.to_regprocedure(
       'public.admin_hct_reset_unknown_to_draft(text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘②:admin_hct_reset_unknown_to_draft 已經存在 ⇒ 本檔已套用過, forward-only 拒重跑';
  END IF;

  -- ③ 🔴 稽核表必須在 —— **本支的每一次成功都要寫它**。
  --    少了這一格, 一個沒有稽核表的世界會讓函式建起來而**每一次呼叫都炸在執行時**。
  IF pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '前置閘③:找不到 public.admin_audit_log ⇒ 本支的證詞沒有地方可寫';
  END IF;

  IF pg_catalog.to_regclass('public.shipments') IS NULL THEN
    RAISE EXCEPTION '前置閘④:找不到 public.shipments ⇒ 這不是我以為的那個世界';
  END IF;
END
$pre$;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. 那支函式
-- ══════════════════════════════════════════════════════════════════════════
CREATE FUNCTION public.admin_hct_reset_unknown_to_draft(
  p_shipment_reference text,
  p_actor              text,
  p_request_id         text,
  p_attestation        text   -- 🔴 那句證詞。**它不是備註, 它是這個動作的授權依據。**
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
-- 🔴 `SET search_path = ''` 是**必要的**:DEFINER + 可變 search_path = 提權面。
--    ⚠️ 而 repo 零處 `REVOKE CREATE ON SCHEMA public` ⇒ **任何人都建得出同名函式**
--    ⇒ 📌 所以 body 裡每一個物件都寫全名。
--    🔵 而這一格是 `definer-search-path-gate` **當場抓到的** ——
--      我第一版寫 `pg_catalog, public`, 而那正是 codex 那條 must-fix 的原場景。
SET search_path = ''
AS $fn$
DECLARE
  v_before pg_catalog.jsonb;
  v_stale  pg_catalog.interval := interval '15 minutes';
  -- 🔴 空白的完整字元集:半形空格 · tab · 換行 · 歸位 · **全形空格 U+3000**
  v_blank  text := E' \t\n\r\u3000';
BEGIN
  -- 🔴 證詞不得為空 —— 而 CHECK 在參數上做不到, 所以做在這裡。
  --    📌 一句空白的證詞 = 沒有人負責, 而那正是本函式存在的理由被繞過的樣子。
  -- 🔴 `btrim()` **預設只消 ASCII 空格** ⇒ tab / 換行 / 全形空格冒充得了「非空」
  --    (codex must-fix ①b;稽核表的 `CHECK (<> '')` 同樣擋不住)
  --    ⇒ 三處都用同一個字元集, 而它寫成一個具名的東西, 不要在三個地方各打一份。
  IF p_attestation IS NULL OR pg_catalog.btrim(p_attestation, v_blank) = '' THEN
    RAISE EXCEPTION
      'admin_hct_reset_unknown_to_draft:證詞不得為空。'
      ' 這一格要寫【你向新竹確認的結果】(例:「2026-09-05 14:30 電話向新竹陳小姐確認, 查無此單」)。'
      ' 🔴 沒有那通電話就【不要】呼叫本函式 —— 放回 draft 之後有人重送, 代價是客人收到兩箱。'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, v_blank) = '' THEN
    RAISE EXCEPTION 'admin_hct_reset_unknown_to_draft:actor 不得為空 ⇒ 稽核會記不下是誰做的'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id, v_blank) = '' THEN
    RAISE EXCEPTION 'admin_hct_reset_unknown_to_draft:request_id 不得為空 ⇒ 跨層追不回來'
      USING ERRCODE = 'P0001';
  END IF;

  -- 🔴🔴 五道閘寫在 UPDATE 的 WHERE 裡 —— **不寫在呼叫端**。
  --    呼叫端可以被繞過(有人直接呼叫 RPC), 而這一層是**每一條路都會經過的地方**。
  UPDATE public.shipments s
     SET hct_status       = 'draft',
         -- 🔴🔴 **這裡【不放】人名與證詞** —— codex must-fix ③, 我開檔複驗成立:
         --    `20260902060000` 逐字 `GRANT SELECT ON TABLE public.shipments TO authenticated`
         --    ⇒ **整張表、每一欄, 客人自己讀得到** ⇒ 把 `p_actor` / `p_attestation` 寫在這裡
         --      = **把內部員工姓名與那通電話的內容, 直接給客人看。**
         --    ⇒ 📌 **它們的落點是 `admin_audit_log`(零 client 權限 + RLS zero-policy), 只放那裡。**
         --    ⚠️ 而這裡仍要留一個**不含身分的標記** —— 否則「被人放回去過」這件事在這一列上消失,
         --      而 rollback 與事後追查都要它。
         hct_raw_response = pg_catalog.jsonb_build_object(
           'manual_reset_to_draft', true,
           'at',          pg_catalog.now(),
           'audit_ref',   p_request_id,           -- 🔵 只留 correlation id ⇒ 去稽核表查得到是誰、說了什麼
           'previous',    s.hct_raw_response      -- 🔵 舊的整個留著 ⇒ 這就是 rollback 的依據
         )
   WHERE s.shipment_reference = p_shipment_reference
     AND s.hct_status = 'unknown'                                   -- 閘①現在確實卡住
     -- 🔴 **用 `->` 比 jsonb, 不用 `->>` 比字串** —— codex must-fix ①⑥:
     --    `->>` 會把 JSON boolean `true` 與 JSON 字串 `"true"` **都轉成文字 `true`**
     --    ⇒ 一筆【乙型】的真實回應若剛好帶 `"placeholder":"true"`(字串), 就會被誤當甲型
     --    ⇒ 而甲型的標記是**我們自己寫的 boolean**(`shipment-actions.ts:603` 逐字 `placeholder: true`)
     --    ⇒ 📌 **型別本身就是判準的一部分, 而 `->>` 把它丟掉了。**
     AND (s.hct_raw_response -> 'placeholder') = 'true'::pg_catalog.jsonb   -- 閘②確實是甲型
     AND s.hct_request_id IS NULL                                    -- 閘③沒拿到貨號
     AND s.deleted_at IS NULL                                        -- 閘④沒作廢
     -- 🔵 先用形狀擋一次再 cast —— 否則一個壞掉的 `at` 會在 cast 直接拋 22007,
     --    而**那個錯訊息不會提到五道閘**, 讀的人會以為是別的問題(codex nit)。
     AND (s.hct_raw_response ->> 'at') ~ '^\d{4}-\d{2}-\d{2}[T ]'
     AND (s.hct_raw_response ->> 'at')::pg_catalog.timestamptz < pg_catalog.now() - v_stale -- 閘⑤不是剛按下去
  RETURNING pg_catalog.jsonb_build_object('hct_status', 'unknown',
                               'hct_request_id', s.hct_request_id,
                               'hct_raw_response', s.hct_raw_response -> 'previous')
       INTO v_before;

  -- 🔴🔴 **改 0 列要炸, 不可以安靜地回成功。**
  --    「條件不成立」與「做完了」在呼叫端**必須是兩個不同的東西** ——
  --    而 `RETURNS void` 的預設行為讓它們印同一個。
  IF v_before IS NULL THEN
    RAISE EXCEPTION
      'admin_hct_reset_unknown_to_draft:改了 0 列(%)。五道閘有一道不成立:'
      ' ①現在不是 unknown ②不是佔位型(raw 沒有 placeholder:true)③已經有新竹貨號'
      ' ④這張單已作廢 ⑤佔位寫下不到 15 分鐘。'
      ' 🛑 **不要調條件讓它變成 1** —— 先用唯讀查出是哪一道, 那五種要做的事不一樣。'
      ' 🔴 尤其③:有貨號 = 新竹【回過話】⇒ 那是乙型, 本函式不處理。',
      p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  -- 🔴 同一個交易寫稽核 —— **不是「緊接著寫」**。
  --    分開寫會有一個「改了而沒記」的世界, 而那個世界沒有任何東西會叫。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    p_actor,
    'shipment.hct.reset_unknown_to_draft',
    'shipment:' || p_shipment_reference,
    v_before,
    pg_catalog.jsonb_build_object('hct_status', 'draft'),
    p_attestation,                       -- 🔴 證詞住這裡 —— `reason` 欄的定義逐字是「內部原因」
    p_request_id,
    'admin'
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_hct_reset_unknown_to_draft(text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_hct_reset_unknown_to_draft(text,text,text,text)
  TO service_role;

COMMENT ON FUNCTION public.admin_hct_reset_unknown_to_draft(text,text,text,text) IS
  '把【佔位卡住】的箱子放回 draft。🔴 它不自己判「新竹到底收到沒」—— 那件事我們這端沒有量具,'
  ' 所以它收一句操作者的證詞(p_attestation, 不得為空)並與 actor 一起寫進 admin_audit_log。'
  ' 只處理甲型(raw 有 placeholder:true 且 hct_request_id IS NULL);乙型(新竹回過話)不處理。'
  ' 改 0 列會 RAISE —— 條件不成立與做完了必須是兩個不同的結果。';

-- ── 3. 後置閘 ────────────────────────────────────────────────────────────
DO $post$
DECLARE
  -- 🔴 **本支建的【每一個可授權物件】都要列在這裡, 一個都不能少。**
  --    📌 收權斷言**只檢查你列出來的物件** ⇒ 它防「忘記收權」, **不防「忘記列」**
  --    ⇒ 而漏列的症狀是**這一段安靜地通過** ——
  --      `scripts/migration-static-checks.sh` 那道靜態閘正是為了這個而數兩邊,
  --      🔵 **而它今天當場抓到我列了 0 個**(我第一版用純量而不是陣列 ⇒ 它數不到)。
  v_functions text[] := ARRAY[
    'public.admin_hct_reset_unknown_to_draft(text,text,text,text)'
  ]::text[];
  v_sig   text;
  v_owner text;
BEGIN
  FOREACH v_sig IN ARRAY v_functions LOOP
  IF pg_catalog.to_regprocedure(v_sig) IS NULL THEN
    RAISE EXCEPTION '後置閘①:% 沒有建起來 ⇒ 這一支沒有做到它宣稱的事', v_sig;
  END IF;

  -- 🔴 後置閘②:收權真的生效了。
  --    ⚠️ **而這一格在本機拋棄式 Postgres 上零判別力**(本機預設授權與 Supabase 不同)
  --    ⇒ 它要 Sean 貼進正式庫之後才算數。**留著, 因為那時候它才會叫。**
  IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘②a:anon 叫得動 % ⇒ 匿名連線可以把箱子放回 draft', v_sig;
  END IF;
  IF has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘②b:authenticated 叫得動 % ⇒ 任何登入的【客人】可以把箱子放回 draft', v_sig;
  END IF;

  -- 🔵 **負對照:上面兩個 false 要有判別力。**
  --    少了這一格, 一個「簽名打錯 ⇒ has_function_privilege 對誰都回 false」的世界
  --    會讓上面兩格**全部安靜通過** —— 那是「零命中」最常見的假綠形狀。
  IF NOT has_function_privilege('postgres', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘②d:連 owner 都叫不動 % ⇒ 上面兩個 false 沒有判別力(很可能簽名打錯了)', v_sig;
  END IF;

  -- 🔴🔴 後置閘②e:**owner 是誰** —— codex must-fix ⑤。
  --    `postgres` 那一格是**正對照**(證明尺會動), **它不是 owner 斷言**。
  --    ⇒ 換一個 DDL 執行者時, 上面每一格都可能通過, 而 runtime 才 permission denied。
  --    ⚠️ 而 `SET ROLE` 那一半本閘**擋不到** —— `has_function_privilege` 答的是「有沒有權」,
  --      答不出「誰可以切成誰」。📌 **寫在這裡, 因為它是本閘的天花板, 不是疏漏。**
  SELECT pg_catalog.pg_get_userbyid(proowner) INTO v_owner
    FROM pg_catalog.pg_proc WHERE oid = v_sig::pg_catalog.regprocedure;
  IF v_owner IS NULL OR v_owner = '' THEN
    RAISE EXCEPTION '後置閘②e:查不到 % 的 owner ⇒ definer 身分不明', v_sig;
  END IF;
  RAISE NOTICE '後置閘②e:% 的 owner = %(貼進正式庫時請確認它是預期的那一個)', v_sig, v_owner;

  -- 🔴 後置閘②f:**definer 對它要碰的兩張表真的有權** —— codex must-fix ⑤b。
  --    少了這一格, migration 可以全過而**第一次真的呼叫才 permission denied**。
  IF NOT has_table_privilege(v_owner, 'public.shipments', 'UPDATE') THEN
    RAISE EXCEPTION '後置閘②f:definer(%) 對 public.shipments 沒有 UPDATE ⇒ 這支跑起來會炸', v_owner;
  END IF;
  IF NOT has_table_privilege(v_owner, 'public.admin_audit_log', 'INSERT') THEN
    RAISE EXCEPTION '後置閘②g:definer(%) 對 public.admin_audit_log 沒有 INSERT ⇒ 稽核寫不進去', v_owner;
  END IF;

  -- 🔴 後置閘③:service_role 叫得動 —— 否則這支函式建了等於沒建。
  --    📌 收權斷言只證「誰叫不動」, 證不到「該叫得動的人叫得動」⇒ 兩個方向都要。
  IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘③:service_role 叫不動 % ⇒ 後台呼叫不到它, 這支等於沒建', v_sig;
  END IF;
  END LOOP;
END
$post$;

COMMIT;
