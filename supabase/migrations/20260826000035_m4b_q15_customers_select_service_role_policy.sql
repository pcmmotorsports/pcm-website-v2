-- ============================================================
-- Q15 · customers 補一條 FOR SELECT TO service_role 政策
--
-- 拍板:Sean 2026-08-25「甲 = 做」(鐵則 8 plan 已批;plan 全文
--        ~/pcm-mailbox/cc-Q15-複驗與落地plan-20260825.md)
-- 範圍:主視窗 2026-08-25 裁【乙】—— SQL 只補 customers 這一條,
--        同族 40 張表的清單與分級隨片落檔於
--        docs/specs/2026-08-25-q15-service-role-select-scope.md, 標成後續片。
-- 審查:codex 對抗審查 R1 => FAIL / 6 must-fix + 1 nit, 本檔是折完 findings 的版本。
--        逐條處置寫在檔尾 §R1。
--
-- 【病】後台以 service_role 讀 customers, 而 customers 的四條政策裡
--       SELECT 那條是 `TO authenticated`
--       (`20260523034911_init_customers_and_subtables.sql:146`, 逐字開檔核過)。
--       今天不爆, 靠的是 service_role 帶 BYPASSRLS —— 那是【平台角色屬性】,
--       repo 內零行宣告、零行檢查 ⇒ 標【未確認】。本片不去斷言它,
--       只把那個隱性依賴寫成顯性政策。
--
-- 🔴 觸發情境不是「Supabase 改掉 service_role」, 是【我們自己做一次安全強化】——
--    那是一個看起來更嚴格的改動, 而它會讓客戶後台整個空白,
--    而搜尋(SECURITY DEFINER 繞 RLS)照樣打得到人
--    ⇒ **系統看起來活著而資料看起來不見了。**
--
-- 🔴🔴 本片【不能】被讀成「Q15 關掉了」—— 同一個成因命中 40 張表(分母 47)。
--      只補這一張, 拿掉 BYPASSRLS 之後後台會從【全空白】變成
--      【客戶列表有、訂單全空】, 而後者更危險:「這位客戶 0 筆訂單」
--      看起來像正常資料, 沒有人會叫。清單見上面那份 docs。
--
-- 🔴 而 RLS 不是唯一的平台依賴 —— 它是兩個裡的一個:
--      RLS 那層塌(拿掉 BYPASSRLS)     ⇒ 查得到、回 0 列        ⇒ 像「沒有資料」
--      GRANT 那層塌(REVOKE table 權)  ⇒ 查不到、PostgREST 報錯 ⇒ 像「系統壞了」
--    **本檔只堵得住上面那一個。** repo 內 `GRANT`/`REVOKE ... ON customers` 共 5 處
--    (`20260523034911:229-231` / `20260717010000:174-175`), 其中
--    **零行 `GRANT SELECT ON customers TO service_role`**。
--    ⚠️ codex R2-F5:~~原本這裡寫「⇒ table 權也是平台預設來的」~~ **那個推論不成立** ——
--       零行 GRANT 推不出來源, 它可能來自線上手動 GRANT / default privileges / owner / 繼承。
--       ⇒ 正確寫法:**那道權限從哪來【未確認】**, 查法在 docs 那份的落地前必跑 ③。
--    ⇒ 補不補那道 GRANT 是【另一個範圍決定】, 本檔不擅自擴。已端給 Sean。
--
-- 形狀來源:全 repo 唯一一條同形先例
--   `20260817070000_m4b_231_3_sweeper_heartbeat.sql:127-129`
--   ⚠️ 而**同一支檔** `:112` 有一行**假的** `CREATE POLICY customers_insert_service_role ...`
--      住在 `--` 註解裡 ⇒ 天真 `grep -c 'CREATE POLICY'` 回 4 / 剝註解後回 3。
--      本檔抄的是 :127 那條真的(SELECT/USING), 不是 :112 那條假的(INSERT/WITH CHECK)。
--      📌 **假的命中比假的零難發現 —— 因為命中會關掉查證。**
--
-- 影響面(codex R1 F3 訂正後的寫法, 不寫「不會擴權」):
--   · service_role 本身:**今天已看得到全部 row(前提=它確有 BYPASSRLS, 未確認)**
--     ⇒ 對它而言本片不增加可見列。
--   · anon / authenticated:政策 role-scoped, 且 `20260523034911:229` 已 REVOKE ALL FROM anon。
--   · 🔴 **而任何【有效繼承】 service_role 權限的角色, 會一起套到這條 `USING (true)`。**
--     PG 的 RLS 角色比對走 `has_privs_of_role`(**尊重 INHERIT**), 不是忽略 INHERIT 的 MEMBER
--     ⇒ 直接 membership 的清單**看不到間接繼承那條路**。
--     ⇒ 本檔段 A 自己去枚舉並 fail-closed, 不靠人肉 preflight。
--
-- Rollback:
--   DROP POLICY IF EXISTS customers_select_service_role ON public.customers;
--   可逆、**零表 / 零欄位 / 零資料異動**(codex R1 nit:原寫「零新物件」可由本檔第一段直接推翻
--   —— CREATE POLICY 本身就是建一個新的 policy 物件)。
--   ⚠️ 回滾 = 退回「靠 BYPASSRLS」那個狀態, **不是退回更安全的狀態**。
--   🔴 不要改本檔再 apply —— 已 apply 的 migration 不會重跑, 只會讓檔案與 DB
--      不一致而**零訊號**。要改就新開一支新 timestamp。
-- ============================================================

BEGIN;

-- ── 段 A · fail-closed 前置閘(codex R1 F1/F2)────────────────────────
-- 🔴 F1 原病:那三發 preflight 查詢原本只是**檔頭註解**裡的 SQL ——
--    「查出異常就停」是寫給人看的, 而人看到了照樣可以把整支貼下去 ⇒ 政策仍然上線。
--    ⇒ 現在它是本檔第一個會 RAISE 的區塊, 擋不過就整筆回滾。
-- 🔴 F2 原病:原本用 `pg_has_role(..., 'MEMBER')` 的語意去想這件事, 那是錯的 ——
--    RLS 的角色比對用 `has_privs_of_role`(尊重 INHERIT)⇒ 這裡用 `'USAGE'`,
--    它就是 has_privs_of_role 的語意。用 'MEMBER' 會漏掉 NOINHERIT/INHERIT 的差別。
DO $$
DECLARE
  v_extra   text;
  v_posctl  boolean;
BEGIN
  -- 🔴 正對照先跑:這把尺對一個【我知道答案的輸入】要回 true。
  --    ⚠️ codex R2-nit 照收:**它對存在的角色是恆真的** ⇒ 它的射程只有
  --      「運算式被改成 false/NULL」與「IF/RAISE 有沒有接對線」。
  --      它**抓不到** USAGE/MEMBER 選錯、參數方向寫反、漏列角色、或錯誤的排除條件。
  --      不要把它讀成「段A 整段驗過了」。
  SELECT pg_catalog.pg_has_role('service_role', 'service_role', 'USAGE') INTO v_posctl;
  IF v_posctl IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Q15 段A 正對照失敗:pg_has_role 對 service_role 自己回 % ⇒ 這把尺不可信, 下面的枚舉作廢', v_posctl;
  END IF;

  -- 本體:還有誰【有效繼承】service_role 的權限?
  --   只排除 superuser —— 它們本來就繞 RLS, 不是本片新增的可見面。
  -- 🔴 codex R2-F1:~~原本這裡還排除了 `authenticator`~~ **那是漏擋不是誤擋。**
  --    🔴 codex R3 抓到我這裡自相矛盾, 訂正:~~「authenticator 若是 NOINHERIT,
  --       pg_has_role(...,'USAGE') 本來就回 false ⇒ 不會出現在枚舉裡」~~ **那句是錯的。**
  --       PG 16+ 的繼承由**每一筆 membership 自己的 `inherit_option`** 決定,
  --       不是看角色的 `rolinherit`(檔尾實測:rolinherit=f 而 inherit_option=t ⇒ USAGE=t)。
  --       ⇒ 所以它**可能**出現在枚舉裡, 而它出現時就是真的暴露(檔尾那張表量到 0->2)。
  --    而它若真的出現, 意思正好是「它變成 INHERIT 了」⇒ **RLS 會套用這條政策** ⇒
  --    那正是唯一該擋的那一發, 而舊版把它寫成豁免 ⇒ **恰好在該紅的世界放行。**
  --    ⇒ 豁免拿掉。誤擋的成本是 Sean 貼一次被擋;漏擋的成本是靜默擴權。
  SELECT coalesce(pg_catalog.string_agg(r.rolname, ', ' ORDER BY r.rolname), '')
    INTO v_extra
    FROM pg_catalog.pg_roles r
   WHERE r.rolname <> 'service_role'
     AND NOT r.rolsuper
     AND pg_catalog.pg_has_role(r.rolname, 'service_role', 'USAGE');

  IF v_extra <> '' THEN
    -- 🔴 codex R3-F3:錯誤訊息原本斷言「那是新的可見面」, 而本檔自己承認可能是假紅
    --    ⇒ **看到它的人是 Sean, 他不寫程式, 只會貼 SQL 看螢幕。**
    --    ⇒ 訊息不下結論, 改成【給他下一發可以貼的查詢】, 讓他自己分得開真暴露與假紅。
    RAISE EXCEPTION E'Q15 段A 擋下, 本片沒有 apply(整筆已回滾, 資料庫沒有任何改變)。
'
      '有這些角色【有效繼承】service_role 的權限:[%]
'
      '⇒ 本片的 USING (true) 會一起套到它們。這【可能】是真的新可見面, 也【可能】是假紅。
'
      '
'
      '把下面這一發貼進 SQL Editor, 它會替每個角色印出「真暴露 / 假紅」:
'
      '  SELECT r.rolname,
'
      '         r.rolbypassrls                    AS 本來就繞得過RLS,
'
      '         (r.oid = c.relowner)              AS 是customers的owner,
'
      '         CASE WHEN r.rolbypassrls OR r.oid = c.relowner
'
      '              THEN ''假紅:它本來就看得到, 本片沒有給它新東西''
'
      '              ELSE ''🔴 真暴露:本片會讓它從看不到變成全部看得到''
'
      '         END AS 判定
'
      '    FROM pg_catalog.pg_roles r, pg_catalog.pg_class c
'
      '   WHERE c.relname = ''customers'' AND NOT r.rolsuper
'
      '     AND r.rolname <> ''service_role''
'
      '     AND pg_catalog.pg_has_role(r.rolname, ''service_role'', ''USAGE'');
'
      '
'
      '全部印【假紅】⇒ 回報給窗, 由窗決定要不要放寬段A。
'
      '任何一列印【真暴露】⇒ 停下, 不要 apply, 那是要先處理的事。', v_extra;
  END IF;

  -- ⚠️ codex R2-nit(照收, 不辯):**這一格可能 false-red** ——
  --    一個非 superuser 但自己帶 BYPASSRLS 的角色、或未 FORCE RLS 的表 owner,
  --    若繼承了 service_role 會被報成「新的可見面」, 而它本來就繞得過 RLS。
  --    方向是 fail-closed ⇒ 保留。撞到時人工判, 不要加豁免清單
  --    (豁免清單正是上面那條 must-fix 的成因)。
  RAISE NOTICE 'Q15 段A 通過:正對照 true / 有效繼承 service_role 的非 superuser 角色 0 個';
END $$;

-- ── 段 B · 政策本體 ──────────────────────────────────────────────────
CREATE POLICY customers_select_service_role ON public.customers
  FOR SELECT TO service_role
  USING (true);

COMMENT ON POLICY customers_select_service_role ON public.customers IS
  'Q15(Sean 2026-08-25 拍甲):把後台對 customers 的讀取可見範圍寫成顯性政策。'
  '在此之前這條路徑【推測】靠 service_role 的 BYPASSRLS 成立 —— 那是平台角色屬性,'
  '本片從頭到尾【沒有斷言它】,也沒有在正式庫查過(codex R2-F4:不要把推測寫成事實)。'
  '影響面(不要寫成「不擴權」):對 service_role 本身不增加可見列(前提 = 它確有 BYPASSRLS,未確認);'
  '而任何【有效繼承】service_role 權限的角色會一起套到這條 USING (true) —— '
  'RLS 走 has_privs_of_role,尊重 INHERIT,不是忽略 INHERIT 的 MEMBER。'
  'apply 當下段 A 已枚舉非 superuser 角色並確認零個 —— 那是【apply 那一刻】的事實,不是永久保證:'
  '日後 GRANT service_role TO 一個 INHERIT 角色會靜默擴權,而本政策不會發出任何訊號。'
  '它沒有關掉同族問題 —— 截至 2026-08-26 的【靜態版控重播】:47 張 ENABLE RLS 的表裡 40 張'
  '缺 service_role 可用的 SELECT 政策,而 customers 是那 40 張之一 ⇒ 本片之後【剩 39 張】。'
  '這幾個數字會隨後續 migration 變假,引用前重跑 docs 裡的數法。'
  '清單見 docs/specs/2026-08-25-q15-service-role-select-scope.md。'
  '它也只堵 RLS 那一層 —— GRANT 那一層(table 權)本片沒碰,而它從哪來【未確認】。';

-- ── 段 C · 雙向斷言(codex R1 F4/F5 重寫)────────────────────────────
-- 🔴 F4 原病:原斷言①只驗【政策名稱存在】。而在完整 migration 裡,
--    能走到這裡就代表段 B 的裸 CREATE 已經成功 ⇒ **那一發是不可到達紅燈的恆真格**;
--    而且名稱對、定義被改壞(例如寫成 FOR ALL、或 TO authenticated)它照樣綠。
--    ⇒ 改成驗【定義】:cmd / roles / permissive / qual 四項逐項比。
--      這四項在「有人把段 B 改錯」的世界會真的紅, 而那正是本檔唯一擋得住的錯。
-- 🔴 F5 原病:原斷言③(查一個虛構政策名回 0)**證不到前兩發不是恆真** ——
--    在「本片完全沒生效」的世界它照樣回 0。⇒ 它的射程只有「這把尺不會亂報有」,
--    現在照這個射程寫, 不再宣稱它是本片的負對照。
DO $$
DECLARE
  v_cmd        text;
  v_permissive text;
  v_roles      name[];
  v_qual       text;
  v_old        int;
  v_negctl     int;
BEGIN
  SELECT p.cmd, p.permissive, p.roles, p.qual
    INTO v_cmd, v_permissive, v_roles, v_qual
    FROM pg_catalog.pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename = 'customers'
     AND p.policyname = 'customers_select_service_role';

  IF v_cmd IS NULL THEN
    RAISE EXCEPTION 'Q15 斷言①失敗:customers_select_service_role 不存在';
  END IF;
  -- 🔴 四項逐項比, 而且每項單獨報 —— 「哪一項不對」與「有一項不對」修法不同。
  IF v_cmd IS DISTINCT FROM 'SELECT' THEN
    RAISE EXCEPTION 'Q15 斷言①-cmd 失敗:應為 SELECT, 實為 %', v_cmd;
  END IF;
  IF v_permissive IS DISTINCT FROM 'PERMISSIVE' THEN
    RAISE EXCEPTION 'Q15 斷言①-permissive 失敗:應為 PERMISSIVE, 實為 %', v_permissive;
  END IF;
  IF NOT ('service_role' = ANY (v_roles)) OR pg_catalog.array_length(v_roles, 1) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'Q15 斷言①-roles 失敗:應恰為 {service_role}, 實為 %', v_roles;
  END IF;
  IF v_qual IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Q15 斷言①-qual 失敗:應為 true, 實為 %(若只是 PG 版本的渲染差異, 對照 pg_policies 上的其他 USING (true) 政策再判)', v_qual;
  END IF;

  -- 🔴 該綠的世界(正對照):既有四條政策一條都不能少。
  --    少了這一格, 一個「把舊政策刪掉再建新的」的錯誤會安靜通過。
  SELECT count(*) INTO v_old
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'customers'
     AND policyname IN ('customers_select_own', 'customers_update_own',
                        'customers_insert_service_role', 'customers_delete_service_role');
  IF v_old <> 4 THEN
    RAISE EXCEPTION 'Q15 斷言②失敗:customers 既有四條政策現在只剩 %(本檔不該動到它們)', v_old;
  END IF;

  -- 尺的自檢(射程照 codex R1 F5 收窄):它只證明「這把尺不會對不存在的東西回有」。
  -- 🔴 它【不是】本片的負對照 —— 在「本片完全沒生效」的世界它照樣回 0。不要那樣引用它。
  -- 📌 這個名字寫在檔案裡是安全的:它問的是 pg_policies 這個【活的資料庫】, 不是檔案樹
  --    ⇒ 寫下它不會讓它出現。grep 型的負對照相反, 一寫進檔就命中自己。
  SELECT count(*) INTO v_negctl
    FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'customers'
     AND policyname = 'customers_zzz_this_policy_does_not_exist';
  IF v_negctl <> 0 THEN
    RAISE EXCEPTION 'Q15 尺自檢失敗:pg_policies 對一個不存在的政策名回 % ⇒ 上面的斷言全部作廢', v_negctl;
  END IF;

  RAISE NOTICE 'Q15 段C 通過:定義四項全對 / 既有四條 4 / 尺自檢 0';
END $$;

COMMIT;

-- ============================================================
-- §R1 · codex 對抗審查 findings 逐條處置(2026-08-26, -s read-only)
--   F1 preflight 只是註解, 擋不住任何人          => 已改:段 A 是真的閘, RAISE 就整筆回滾
--   F2 依據寫錯 MEMBER, RLS 實走 has_privs_of_role => 已改:段 A 用 pg_has_role(..., 'USAGE')
--                                                     並改成枚舉全體角色, 不是只列直接 member
--   F3 COMMENT 寫死「不擴權」與檔頭「未驗」矛盾   => 已改:COMMENT 與檔頭都改成分角色寫,
--                                                     且明說段 A 驗的是【apply 那一刻】不是永久保證
--   F4 斷言①在本檔裡是不可到達紅燈, 且只驗名稱   => 已改:改驗 cmd/permissive/roles/qual 四項, 逐項單獨報
--   F5 斷言③不能證明前兩發不是恆真               => 已改:射程收窄成「尺不會亂報有」, 並明寫它不是本片的負對照
--   F6 scope 檔「40 是下界穩」不成立               => 已改於 docs/specs/2026-08-25-q15-service-role-select-scope.md
--   nit 「零新物件」可由本檔直接推翻              => 已改:寫成「零表 / 零欄位 / 零資料異動」
--
-- ── 七個世界都讓它表演過(拋棄式 PG 17.10, 2026-08-26)────────────────
--   🔴 codex R2-F6 訂正:~~原本寫「每一格印的東西不一樣」~~ —— **那句是假的**,
--      W1 與 W5 是【同一種情境】(乾淨 apply), 只是跑在兩個 database 上。
--      ⇒ 正確講法:**六種不同情境, 七次執行**。W5 的用途是「W2 清掉污染後的乾淨重跑」,
--        不是第七種世界。
--     W1/W5 乾淨 apply(同一種情境)  => rc=0  段A NOTICE + 段C NOTICE  政策 4 -> 5
--     W2   多一個 INHERIT 的角色   => rc=3  段A 擋下, 訊息指名 [sneaky]      政策未增
--     W3   段B 被改成 TO authenticated
--                                  => rc=3  「斷言①-roles 失敗:應恰為 {service_role}, 實為 {authenticated}」
--                                           整筆回滾, 政策仍 4
--     W4   既有政策被刪掉一條      => rc=3  「斷言②失敗:…現在只剩 3」整筆回滾
--     W6   同一支再 apply 一次     => rc=3  policy already exists, 政策仍 5 不是 6(fail-closed, 不是缺陷)
--     W7   把段A 的正對照改成 false=> rc=3  「正對照失敗:…下面的枚舉作廢」⇒ 那道自檢自己會叫
--
-- ── 🔴🔴 而【拿掉 authenticator 豁免】這件事, 我不是用推的, 是量到的 ──────────
--   codex R2 說「NOINHERIT 的成員 pg_has_role(...,'USAGE') 會回 false」⇒ **那句在 PG 16+ 是錯的。**
--   實測(PG 17.10):`ALTER ROLE authenticator NOINHERIT` 之後
--     pg_auth_members.inherit_option => t(**每一筆 grant 各自記, 改 rolinherit 不會回頭改它**)
--     rolinherit                     => f
--     pg_has_role(authenticator, service_role, 'USAGE') => **t**
--   ⇒ **「這個角色是 NOINHERIT」與「這筆 membership 會繼承」是兩件事。**
--
--   而真正決定性的一發是【數列數】, 不是問屬性 ——
--   同一份資料 2 列, service_role 拿掉 BYPASSRLS(= Q15 的觸發情境),
--   `customers_select_own` 用貼近正式庫的 `user_id = <某 uuid>` 而不是 `true`:
--
--     角色              沒有本片的政策    有本片的政策
--     service_role            0               2      <- 本片的目的, 達成
--     authenticator           0               2      <- 🔴 **真的擴權, 從看不到變成全看得到**
--     authenticated           0               0      <- 零影響 ✅
--     postgres(負對照)        2               2      <- 尺是活的, 資料真的有 2 列
--
--   ⇒ **舊版把 authenticator 寫成豁免, 正好在【唯一會出事的那一格】放行。**
--     codex R2-F1 判對了, 而它給的理由(NOINHERIT ⇒ USAGE false)在 PG 16+ 不成立。
--   📌 **findings 對而理由錯, 照樣要修 —— 而要修對, 得自己去量。**
--   ⚠️ 效度限制(codex R3-F5 逼出來的, 逐格標, 不要整張當正式行為矩陣):
--     · `service_role 0->2` —— **這一格穩**, 它直接證明本政策的機制。
--     · `authenticator 0->2` —— **取決於那筆 membership 的 `inherit_option`**,
--       而**正式庫那一筆是什麼, 沒有人查過** ⇒ 這一格是「會發生的一種世界」, 不是「正式庫會這樣」。
--     · `authenticated 0->0` —— own-policy 我寫的是固定 uuid 不是 `auth.uid()`
--       ⇒ **真會員在正式庫是 1->1(看得到自己那筆), 不是 0->0**。
--       兩者都代表「本片沒有給 authenticated 新東西」, 而**數字本身不可外推**。
--
--   🔴 而做這一輪時我自己踩了一次, 值得寫在這裡:
--     W3/W4 第一次跑 rc 都是 3, 而我差一點就寫下「斷言擋下了」——
--     **實際上兩發都紅在段A**(W2 建的 `sneaky` 角色是 cluster 層級, 沒清掉)。
--     ⇒ **rc 非 0 只說明「有東西紅了」, 不說明【是我要測的那一格紅了】。**
--       分得開它們的是**讀那行錯誤訊息**, 不是看 rc。
--
-- 🔴 而本檔【還沒做到】的, 照實寫(不是免責, 是礦區):
--   1. 上面那七個世界是在**本機拋棄式 PG** 上跑的, 不是正式庫。
--      bootstrap 的 customers 只有骨架欄位, 政策的 USING 也簡化過
--      ⇒ 它證的是【本檔的閘與斷言會不會動】, **不證正式庫上的行為**。
--   2. 段 A 排除 `authenticator` 是照 Supabase 預設寫的, 而**那個預設我沒有在正式庫上驗過**。
--      若正式庫的 authenticator 不是那樣, 段 A 會誤擋(fail-closed, 方向安全)。
--   3. `service_role` 到底有沒有 BYPASSRLS —— **本檔從頭到尾沒有斷言它**, 也沒查過正式庫。
-- ============================================================
