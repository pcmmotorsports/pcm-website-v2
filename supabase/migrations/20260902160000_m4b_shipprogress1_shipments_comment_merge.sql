-- ⟦f3-SHIPPROGRESS1⟧ 後續片:把 `20260902060000` 蓋掉的拍板紀錄併回去 + 把它的斷言補強。
--
-- ══ 🔴🔴 為什麼有這一支(它是一次事故的修法,不是一次擴充)═══════════════════════
--   `20260902060000` 在 `shipments.hct_raw_response` 上下了一句 `COMMENT ON COLUMN`,
--   而那一欄上**本來就有一句** —— 建表片 `20260805170000:215-217` 記著 Sean 2026-08-05 的
--   Q-b=A 拍板(重送覆蓋前一次 / 承接方案見 plan §5.1 備選②③)。
--   🔴 **`COMMENT ON` 是覆寫不是追加** ⇒ 那筆拍板紀錄從 catalog 裡消失了,而它已經生效在正式庫上。
--
--   🛑 **而最該記的是它的形狀**:`20260902060000` 那段話**自己主張**
--      「檔頭會被最後一代 CREATE OR REPLACE 蓋過去,而 COMMENT 跟著欄走」
--      ⇒ 它把 COMMENT 當成最耐久的落點,**然後用它抹掉了另一筆放在同一個位置的紀錄**。
--   🎯 **⇒ 我證明那個落點會被蓋掉的方式,就是自己蓋掉它。**
--   📌 **⇒ 教訓不是「COMMENT ON 是覆寫」** —— 是【一個被推薦為耐久的落點,
--      它的耐久性沒有任何機制保護】,而它失效時**零訊號**。
--
--   🔵 **掃過了,而分母是 2**(⚠️ **那個 2 是【不含本支】的分母**;本支落地之後同樣的
--      `grep -l` 會回 **3** —— 寫在這裡,免得下一個人照著跑而以為數字錯了):
--      `20260902060000` 總共下過 2 個 `COMMENT ON` ——
--        · `COLUMN … hct_raw_response`  ⇒ 建表片同一欄也有 ⇒ **這一個是覆寫**(本支修它)
--        · `POLICY shipments_select_own` ⇒ 那條 policy 由該片自己新建 ⇒ **在 repo 的歷史裡**沒有前一版
--          ⚠️ 而 codex 指出這句話不能講死:該片先 `DROP POLICY IF EXISTS` ——
--             **正式庫上若曾有人手建同名 policy, 它的 COMMENT 一樣會跟著消失, 而 repo 看不到那件事。**
--
-- ══ 這一支做四件 ═══════════════════════════════════════════════════════════════
--   ① 前置閘:先讀現值,**與 `20260902060000` 寫的那一版【逐字相等】** —— 不相等 ⇒ RAISE
--   ② 併回去:建表片原文【逐字】在前,`20260902060000` 的警語在後
--   ③ 重下 `COMMENT ON POLICY`:把那個寫錯的「5 個內部欄」改成 **6**
--   ④ 斷言補強:catalog 精確比對 + `shipment_items` ACL 正反斷言 + 欄級/可轉授 ACL + 角色繼承
--
-- ══ 🔴 審查(兩道獨立跑, 合計 10 條 must-fix, 本版全數收)═══════════════════════
--   A【兩邊都抓到】前置閘原本是 `position(…)>0`(**包含**)不是**相等** ⇒
--     世界X:有人照本支結尾那句「把新字接在後面」追加了一段 ⇒ **閘綠, 而我把那個人的字整段抹掉**
--     ⇒ **與這次事故完全同形、同樣零訊號。**本版改成整串相等比對。
--   B【兩邊都抓到】原本沒有交易 ⇒ `COMMENT` 落了而斷言紅 ⇒ 半套, 而重跑又被冪等閘擋住
--     ⇒ 操作者**分不出「併好了但斷言紅」與「什麼都沒發生」**。本版包 `BEGIN/COMMIT`。
--   C 原本 `IF NOT v_ok` —— 角色不存在 ⇒ 子查詢 NULL ⇒ 整條 NULL ⇒ **不進 RAISE**
--     ⇒ 一道只有在該紅時才有價值的斷言, 它最該紅的世界印綠。本版 `IS NOT TRUE`。
--   E service_role 那兩條原本只靠**名字**進白名單 ⇒ 被改成 `TO authenticated USING (true)` 也不紅。
--   F 🔴 若 `authenticated` **繼承** `service_role` ⇒ 那條 `USING (true)` 讓客人讀全表, 而原六道全過。
--     🔵 2026-09-02 對正式庫唯讀量過:`pg_has_role('authenticated','service_role','USAGE')` ⇒ **f**
--        (`anon` 亦 f;而 `authenticator` 繼承 service_role —— 那是 Supabase 的正常設計)
--     ⇒ **⇒ 今天不成立, 而本版把它變成【會叫的】。**
--   G `SELECT WITH GRANT OPTION` 原本沒擋 —— 「只有 SELECT」漏掉**可轉授**。
--   H 🔴 原本六道**完全沒驗 POLICY COMMENT** ⇒ 它仍寫「5 個」也會 PASS
--     ⇒ 🎯 **本支存在的目的之一就是改那個 5, 而我沒有寫一道會檢查它的斷言。**
--   D(落在 `scripts/shipments-exposed-columns.test.ts`, 不在本檔)其 parser 停在第一個 `;`
--     ⇒ 而建表片原文裡就有一個 ⇒ 本支併回去會讓**那支守門紅**。已修 parser + 三發突變驗過。
--
-- 🛑 **本支【不 apply】,走 Sean 手貼。** 命中鐵則 12 ②權限 ③schema。

BEGIN;

-- 🔵 `pg_get_expr()` 的輸出對 `search_path` 敏感(deparse 時 `public` 不在路徑上會渲染成
--    `public.shipments s`)⇒ 釘住它, 否則驗證①會出現**假紅**。
SET LOCAL search_path = public, pg_catalog;

-- ── 0. 前置閘 ────────────────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_now      text;
  v_expected text;
  v_attn     smallint;
BEGIN
  SELECT attnum INTO v_attn
    FROM pg_attribute
   WHERE attrelid = 'public.shipments'::regclass AND attname = 'hct_raw_response'
     AND attnum > 0 AND NOT attisdropped;
  IF v_attn IS NULL THEN
    RAISE EXCEPTION '前置閘:shipments.hct_raw_response 不在 ⇒ 本支無所依附';
  END IF;

  v_now := col_description('public.shipments'::regclass, v_attn);

  -- 🔴 **這一串必須與 `20260902060000:125-130` 的六段字面逐字相同。**
  v_expected :=
    '🔴🔴 **這一欄對【客人】可見。**(2026-09-02 起:shipments_select_own 讓 authenticated 讀得到自己那張單的整列。)'
    '它裝的是【第三方(新竹物流)回給我們的原始回應】。'
    '🛑 **在把任何東西寫進這一欄之前,先看這一句話** —— 那些內容會直接出現在客人拿得到的資料裡。'
    '📌 2026-09-02 開這扇門時它是空的(全表 2 列、本欄非 NULL 0 列)⇒ 而那正是它危險的地方:'
    '門今天乾淨,而它會在新竹 API 接起來那天自己變大,而那時沒有人會回來看它。'
    '✅ 而會叫的那道是 `scripts/shipments-exposed-columns.test.ts`(釘住開放欄位集合,表長新欄就紅)。';

  IF v_now IS NULL THEN
    RAISE EXCEPTION '前置閘:那一欄現在沒有任何 COMMENT ⇒ 現況不是我以為的那一版, 停';
  END IF;

  -- 🔵 冪等保護:已經併過了就不要再併一次(否則會併出兩份建表片原文)。
  IF position('Q-b=A' in v_now) > 0 AND position('這一欄對【客人】可見' in v_now) > 0 THEN
    RAISE EXCEPTION '前置閘:現值兩段俱在 ⇒ 已經併過了, 不重複執行';
  END IF;

  -- 🔵 把「前一支還沒貼」與「中間有人蓋過」分開 —— 原本兩個世界印同一句話, 而它們該做的事不一樣。
  IF position('Q-b=A' in v_now) > 0 AND position('這一欄對【客人】可見' in v_now) = 0 THEN
    RAISE EXCEPTION
      '前置閘:現值看起來是【建表片原文】⇒ 20260902060000 尚未 apply 到這顆庫。'
      ' ⇒ 先貼那一支, 不是這一支。';
  END IF;

  -- 🔴🔴 **相等, 不是包含**(A:兩位審查者各自獨立抓到的那一條)。
  --   包含只證「那句話在裡面」⇒ 而**有人照本支結尾那句教誨把新字接在後面**時,
  --   閘會綠, 而下面的 `COMMENT ON` 把那個人的字整段抹掉 —— 與這次事故完全同形。
  IF v_now IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION
      '前置閘:現值與 20260902060000 寫的那一版【不完全相同】⇒ 中間有人動過。'
      ' 本支會覆寫整欄 ⇒ 停下來人工看。現值長度 % / 預期 %。現值前 160 字:%',
      length(v_now), length(v_expected), left(v_now, 160);
  END IF;

  -- 🟢 量具自檢(負對照):現造的特徵字必須抓不到。
  IF position('zzq_no_such_marker_0902' in v_now) > 0 THEN
    RAISE EXCEPTION '前置閘自檢:負對照命中 ⇒ 量具可疑, 停';
  END IF;
END $pre$;

-- ── 1. 併回去 ────────────────────────────────────────────────────────────────
--   🔴 **上半段是建表片 `20260805170000:216-217` 的原文, 逐字複製、一個字都沒改。**
--      (不重打、不摘要 —— 摘要會讓下一個人以為那就是全部。)
COMMENT ON COLUMN public.shipments.hct_raw_response IS
  '新竹 API 原始回覆(UX §4 #17 要求留存)。🔴 Q-b=A:重送會**覆蓋**前一次,只保留最新一次;'
  '若未來要留歷次,承接方案見 plan §5.1 Q-b 的備選②③(本批不做)。'
  '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
  '🔴🔴 **這一欄對【客人】可見。**(2026-09-02 起:shipments_select_own 讓 authenticated 讀得到自己那張單的整列。)'
  '它裝的是【第三方(新竹物流)回給我們的原始回應】。'
  '🛑 **在把任何東西寫進這一欄之前,先看這一句話** —— 那些內容會直接出現在客人拿得到的資料裡。'
  '📌 2026-09-02 開這扇門時它是空的(全表 2 列、本欄非 NULL 0 列)⇒ 而那正是它危險的地方:'
  '門今天乾淨,而它會在新竹 API 接起來那天自己變大,而那時沒有人會回來看它。'
  '✅ 而會叫的那道是 `scripts/shipments-exposed-columns.test.ts`(釘住開放欄位集合,表長新欄就紅)。'
  '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
  '🔵 上下兩段的分隔線是刻意的:上段是 2026-08-05 的拍板紀錄, 下段是 2026-09-02 開門時的警語。'
  '而 20260902060000 曾經用下段【蓋掉】上段(COMMENT ON 是覆寫不是追加), 由 20260902160000 併回。'
  '📌 ⇒ 下一個要在這一欄下 COMMENT 的人:**先讀現值, 你的新字要接在後面, 不是取代它。**'
  '🛑 而那件事沒有機制擋你 —— 20260902160000 的前置閘只認得【它自己預期的那一版】,'
  '你追加之後它會紅, 而那個紅的意思是「請人來看」, 不是「你做錯了」。';

-- ── 2. 重下 POLICY 的 COMMENT:那個「5」改成「6」 ─────────────────────────────
--   🔴 為什麼這一格重要:那句話是【Sean 被告知了什麼】的唯一紀錄。
--   ✅ 而「他到底被告知幾個」是量到的:
--      `~/pcm-mailbox/給Sean-貼這兩支SQL-出貨可見-20260902.md:34` 逐字「其中 **6 欄**」, `:36-41` 逐欄列名。
--   🎯 ⇒ **那個 5 是我們寫錯字, 不是他少被告知一欄。沒有任何一欄是在他不知情下開出去的。**
COMMENT ON POLICY shipments_select_own ON public.shipments IS
  '⟦f3-SHIPPROGRESS1⟧ Sean 2026-09-02 拍 🅐(整列)—— 而那是【被告知那 6 個內部欄之後】的第二次確認。'
  '那 6 欄:carrier_note · deleted_at · void_reason · hct_request_id · hct_raw_response · hct_status。'
  '端題的一方偏 🅑(只回需要的欄),逐字記著,免得下一個人以為沒有人反對過。'
  '🔴 20260902060000 的檔內註解與本 COMMENT 前一版誤寫成「5 個」—— 已於 20260902160000 訂正為 6。'
  '(那支已 apply 的檔【不能再動】,所以錯字留在那裡;以本 COMMENT 為準。)';

-- ── 3. 斷言 ──────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  r      record;
  v_qual text;
  v_ok   boolean;
  v_cnt  int;
  v_txt  text;
BEGIN
  -- ⓪ 角色都在(C:少了這一格, 下面每一道 `pg_roles` 子查詢都會回 NULL 而**靜靜通過**)
  FOR r IN SELECT unnest(ARRAY['authenticated', 'anon', 'service_role']) AS rolname LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.rolname) THEN
      RAISE EXCEPTION '驗證⓪:角色 % 不存在 ⇒ 下面每一道斷言都會變成 NULL 而不叫', r.rolname;
    END IF;
  END LOOP;

  -- ① 兩條【客人】policy 的形狀逐項比對(qual 用正規化全文, 不是「有沒有那個字」)
  FOR r IN
    SELECT * FROM (VALUES
      ('shipments',      'shipments_select_own',
       '(customer_user_id = ( SELECT auth.uid() AS uid))'),
      ('shipment_items', 'shipment_items_select_own',
       '(EXISTS ( SELECT 1 FROM shipments s WHERE ((s.id = shipment_items.shipment_id) AND (s.customer_user_id = ( SELECT auth.uid() AS uid)))))')
    ) AS t(tbl, pol, want)
  LOOP
    SELECT regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\s+', ' ', 'g'),
           (p.polcmd = 'r' AND p.polpermissive
            AND p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'authenticated')])
      INTO v_qual, v_ok
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relname = r.tbl AND c.relnamespace = 'public'::regnamespace AND p.polname = r.pol;

    IF v_qual IS NULL THEN
      RAISE EXCEPTION '驗證①:policy %.% 不存在', r.tbl, r.pol;
    END IF;
    -- 🔴 `IS NOT TRUE` 而不是 `NOT` —— NULL 在 `IF NOT` 底下不進分支(C)。
    IF v_ok IS NOT TRUE THEN
      RAISE EXCEPTION
        '驗證①:policy %.% 的 cmd/permissive/roles 不是「SELECT + PERMISSIVE + 只給 authenticated」', r.tbl, r.pol;
    END IF;
    IF v_qual IS DISTINCT FROM regexp_replace(r.want, '\s+', ' ', 'g') THEN
      RAISE EXCEPTION '驗證①:policy %.% 的 USING 與預期不符。實得:%', r.tbl, r.pol, v_qual;
    END IF;
  END LOOP;

  -- ②-a 兩條 service_role policy 也要**驗定義, 不是驗名字**(E)。
  --     🔴 原本只把名字放進白名單 ⇒ 它被改成 `TO authenticated USING (true)` 也不會紅,
  --        而那正是「客人讀全表」那條路。
  FOR r IN
    SELECT * FROM (VALUES
      ('shipments', 'shipments_select_service_role'),
      ('shipment_items', 'shipment_items_select_service_role')
    ) AS t(tbl, pol)
  LOOP
    SELECT (p.polcmd = 'r' AND p.polpermissive
            AND p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname = 'service_role')]
            AND regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\s+', ' ', 'g') = 'true')
      INTO v_ok
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relname = r.tbl AND c.relnamespace = 'public'::regnamespace AND p.polname = r.pol;
    IF v_ok IS NOT TRUE THEN
      RAISE EXCEPTION
        '驗證②-a:policy %.% 不是「SELECT + PERMISSIVE + 只給 service_role + USING(true)」'
        '(不存在也會走到這裡)', r.tbl, r.pol;
    END IF;
  END LOOP;

  -- ②-b 沒有【預期外】的 policy 把門開更大
  SELECT count(*) INTO v_cnt
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('shipments', 'shipment_items')
     AND p.polname NOT IN ('shipments_select_own', 'shipment_items_select_own',
                           'shipments_select_service_role', 'shipment_items_select_service_role');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '驗證②-b:這兩張表上出現了 % 條預期外的 policy ⇒ 門可能被別人開大了', v_cnt;
  END IF;

  -- ②-c 🔴 **角色繼承**(F):`USING (true)` 那兩條只擋得住「不是 service_role 的人」——
  --     而如果 `authenticated` 繼承了 `service_role`, 客人就吃得到那條 ⇒ 讀全表。
  --     🔵 2026-09-02 對正式庫量過 ⇒ 今天是 f;本道讓它在變成 t 的那一天會叫。
  FOR r IN SELECT unnest(ARRAY['authenticated', 'anon']) AS rolname LOOP
    IF pg_has_role(r.rolname, 'service_role', 'USAGE') THEN
      RAISE EXCEPTION
        '驗證②-c:% 繼承了 service_role ⇒ service_role 那條 USING(true) 對它成立 ⇒ 客人讀得到全表',
        r.rolname;
    END IF;
  END LOOP;

  -- ③ 表級 ACL:兩張表都要「authenticated 只有 SELECT、anon 什麼都沒有」
  FOR r IN SELECT unnest(ARRAY['shipments', 'shipment_items']) AS tbl LOOP
    IF NOT has_table_privilege('authenticated', 'public.' || r.tbl, 'SELECT') THEN
      RAISE EXCEPTION '驗證③:authenticated 對 %.SELECT 沒有權限 ⇒ 這扇門根本沒開', r.tbl;
    END IF;
    -- 🟢 正對照(上一行)與 🔵 負對照(下面整組)成對 —— 只驗前者的話,
    --    一個 GRANT ALL 給 PUBLIC 的世界會印出一模一樣的綠。
    IF has_table_privilege('anon', 'public.' || r.tbl, 'SELECT') THEN
      RAISE EXCEPTION '驗證③:anon 讀得到 % ⇒ 門開太大', r.tbl;
    END IF;
    FOR v_txt IN SELECT unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) LOOP
      IF has_table_privilege('authenticated', 'public.' || r.tbl, v_txt) THEN
        RAISE EXCEPTION '驗證③:authenticated 對 % 有 % 權限 ⇒ 只該有 SELECT', r.tbl, v_txt;
      END IF;
      IF has_table_privilege('anon', 'public.' || r.tbl, v_txt) THEN
        RAISE EXCEPTION '驗證③:anon 對 % 有 % 權限', r.tbl, v_txt;
      END IF;
    END LOOP;
  END LOOP;

  -- ④-a 🔴 **可轉授**(G):`has_table_privilege` 答「有沒有」, 不答「能不能轉授給別人」。
  --     `SELECT WITH GRANT OPTION` 在上面那組裡是**看不見的**。
  --     🔵 `grantee = 0` 是 PUBLIC —— 而 `pg_roles` 裡沒有 0, INNER JOIN 會把它靜靜丟掉(既有教訓)
  --        ⇒ 這裡用 LEFT JOIN 並明文把 0 收進來。
  SELECT count(*) INTO v_cnt
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    LEFT JOIN pg_roles g ON g.oid = a.grantee
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('shipments', 'shipment_items')
     AND (a.grantee = 0 OR g.rolname IN ('authenticated', 'anon'))
     AND (a.privilege_type <> 'SELECT' OR a.is_grantable);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION
      '驗證④-a:authenticated/anon/PUBLIC 身上有 % 筆「非 SELECT 或可轉授」的授權 ⇒ 只該有不可轉授的 SELECT',
      v_cnt;
  END IF;

  -- ④-b 欄級 ACL:`has_table_privilege` 對欄級授權會少報(既有教訓)⇒ 直接看 catalog。
  SELECT count(*) INTO v_cnt
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('shipments', 'shipment_items')
     AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attacl IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '驗證④-b:這兩張表上有 % 個欄帶欄級 ACL ⇒ 表級斷言看不到它們, 停下來人工看', v_cnt;
  END IF;

  -- ⑤ RLS 真的開著(兩張都要)
  SELECT count(*) INTO v_cnt
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('shipments', 'shipment_items')
     AND c.relrowsecurity;
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION '驗證⑤:兩張表裡只有 % 張開著 RLS', v_cnt;
  END IF;

  -- ⑥ COMMENT 真的併回去了(兩段都要在 —— 只驗一段的話, 這一支等於沒做)
  SELECT col_description('public.shipments'::regclass, a.attnum) INTO v_txt
    FROM pg_attribute a
   WHERE a.attrelid = 'public.shipments'::regclass AND a.attname = 'hct_raw_response';
  IF position('Q-b=A' in v_txt) = 0 THEN
    RAISE EXCEPTION '驗證⑥:建表片那段拍板紀錄沒有併回去';
  END IF;
  IF position('這一欄對【客人】可見' in v_txt) = 0 THEN
    RAISE EXCEPTION '驗證⑥:客人可見那段警語不見了 ⇒ 我把另一半蓋掉了';
  END IF;
  IF position('zzq_no_such_marker_0902' in v_txt) > 0 THEN
    RAISE EXCEPTION '驗證⑥自檢:負對照命中 ⇒ 量具可疑';
  END IF;

  -- ⑦ 🔴 **POLICY 的 COMMENT 也要驗**(H)——
  --   原本六道一道都沒碰它 ⇒ **而「把 5 改成 6」正是本支存在的目的之一**
  --   ⇒ 它沒改成功而其餘 catalog 狀態正確時, 原版會 PASS。
  SELECT obj_description(p.oid, 'pg_policy') INTO v_txt
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'shipments' AND c.relnamespace = 'public'::regnamespace
     AND p.polname = 'shipments_select_own';
  IF v_txt IS NULL THEN
    RAISE EXCEPTION '驗證⑦:shipments_select_own 沒有 COMMENT';
  END IF;
  IF position('6 個內部欄' in v_txt) = 0 THEN
    RAISE EXCEPTION '驗證⑦:POLICY COMMENT 裡沒有「6 個內部欄」⇒ 訂正沒生效';
  END IF;
  IF position('被告知那 5 個內部欄' in v_txt) > 0 THEN
    RAISE EXCEPTION '驗證⑦:POLICY COMMENT 裡還留著誤寫的「5 個內部欄」';
  END IF;

  RAISE NOTICE '✅ 20260902160000:COMMENT 已併回(兩段俱在), policy/ACL/RLS/繼承/可轉授/POLICY-COMMENT 十道斷言全過';
END $verify$;

COMMIT;

-- ══ 🛑 這一支證不到什麼(寫在這裡, 不要讓人以為它涵蓋一切)═══════════════════
--   · 它驗的是**這一瞬間**的 catalog。migration 從不 replay ⇒ apply 之後沒有東西會再量。
--     ⇒ 🔵 而【會再量】的那個東西在另一支檔:`scripts/shipments-exposed-columns.test.ts`。
--   · 驗證②-b 只擋「多出一條 policy」, 擋不掉「有人改掉既有那條又改回來」。
--   · 欄級 ACL 那一格只答「有沒有人在欄層級動過」, 不答「動了什麼」—— 紅了要人工看。
--   · 🔴 它**不驗資料**:那一欄裡到底有沒有裝著不該給客人看的東西, 本支答不出來。
--     那一格由 COMMENT 那句話承擔, 而**那是一句話不是一道閘**。
--   · 🔴 **前置閘只認得它預期的那一版** ⇒ 任何人合法追加一段之後它就會紅。
--     那個紅的意思是「請人來看」, 不是「你做錯了」—— 已寫進 COMMENT 本文, 免得下一個人以為是壞掉。
