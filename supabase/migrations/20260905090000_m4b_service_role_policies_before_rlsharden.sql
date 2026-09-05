-- ⟦b9-RLSHARDEN⟧ 第 0 步:補上三張表缺的 service_role 寫入 policy
--
-- 🟢🟢 **[2026-09-05 訂正 · 本檔【已經貼進正式庫了】]**
--    ⛔ ~~本檔是【草稿】。動 RLS = PCM 鐵則 12②(權限)⇒ 要 Sean 拍板 + codex 對抗審查才貼。~~
--    🔴 **那句在 Sean 貼下去的那一刻就過期了, 而它讀起來像現況** —— 下一個人會以為這還沒上。
--    🔬 **唯讀複驗(2026-09-05 16:0x, 正式庫)**:四條逐條在 ——
--       `admin_audit_log_insert_service_role`(a)· `admin_sso_login_events_insert_service_role`(a)
--       · `staff_insert_service_role`(a)· `staff_update_service_role`(w),count = **4**;
--       🔵 負對照:同一把尺問一個編造的 policy 名 ⇒ **0** ⇒ 那把尺會分辨。
--    ✅ 帳本也補了一列:`supabase/APPLIED.tsv`(貼之前 `grep -c` 是 **0**, 而板列寫著已貼
--       ⇒ **兩把尺打架**, 這是 R3 F4 抓到的)。
--    ⚠️ **而帳本那一列的 sha 對「內容一致」零判別力** —— 本支 05:31~06:56 改過五版,
--       而本檔 `[R4 B5]` 自己就寫著「手貼的人從 `dev` 拿到的會是舊的那一份」
--       ⇒ 📌 **沒有人留下貼進去的那一份。**
--    ⚠️ 板列的「03:1x 已貼」**那個時刻屬於 `20260904270000`, 不是本支**(本檔 05:31 才出生)。
--    🛑 **本檔現在起是【歷史】,不要重貼** —— 重貼會撞名而報錯(它刻意不用 `IF NOT EXISTS`)。
-- 🟢 **它是【純加 policy】** —— 零 `GRANT`、零 `REVOKE`、零 `ALTER ROLE`、**不建表 / 函式 / 角色**。
--
-- 🛑🛑 **而「零行為改變」有一個【例外】, 寫在這裡不藏**(codex R3 F4 抓到, 而歸屬後來換了):
--    兩支 migration 斷言那兩張表**應為零 policy**:
--      `20260815020000_m4b_e10_27_d1_admin_audit_log_grant_select.sql:129`
--      `20260726120000_m4b_e8a1_staff_table.sql:122-128`  🔴 **[R4 A6]** ⛔ ~~:60~~ 那是**區段註解**,
--        真正會 RAISE 的斷言在 `:122-128`(`pg_policies` count `<> 0` ⇒ 拒繼續)
--    ⇒ 本檔加 policy ⇒ **重跑那兩支會紅。**
--    🔴 **而【成因不是本檔】**:`admin_audit_log` 與 `staff` 都在**已貼的**
--      `20260904270000` 的期望名單裡, 那一支 `:345` 就已經各給了一條 SELECT policy
--      ⇒ 📌 **那兩個斷言在 Sean 2026-09-05 03:1x 貼它的那一刻就【已經】不成立。**
--    ⇒ ✅ **本檔只是讓那個接縫更明顯, 不是製造它** ⇒ 接縫另開一列 `⟦b9-ZEROPOLICYSEAM⟧`。
--    ⚠️ **⇒ 所以本檔【不宣稱】零行為改變** —— 它宣稱的是:
--      **對「今天在跑的那些寫入路徑」零行為改變**(BYPASSRLS 還在 ⇒ policy 不會被走到)。
--    ⛔ ~~原句寫「不建任何新物件」~~ —— **policy 自己就是新的 DB 物件**(codex R1 nit)。
--    ⇒ 貼上去**不會讓任何今天能做的事變成不能做**。
--    🛑 **[R2 nit :6 訂正]** ⛔ ~~原句寫「它把今天靠 BYPASSRLS 過的**改成**靠政策過的」~~ ——
--       **那句在今天是假的**:BYPASSRLS 還在的時候, PostgreSQL **根本不會去看 policy**。
--       ✅ 正確說法:**它先把政策【擺好】, 等 `⟦b9-RLSHARDEN⟧` 拿掉 BYPASSRLS 那一刻才開始被走到。**
--       ⇒ 📌 本檔今天的價值是【預先鋪路】, 不是【換了一條路】。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 為什麼要有它(來源:2026-09-05 線【身分】`-auth` 的兩份唯讀盤點)
-- ══════════════════════════════════════════════════════════════════════════
--   `docs/plans/2026-09-05-service-role-consumers-inventory.md` 掃了 `origin/dev` 的碼:
--   **23 個表/view + 26 支函式**由 `service_role` 碰到。
--   🔴 **[2026-09-05 訂正 · 來源換了]** ⛔ ~~其中 20 個已有涵蓋的 policy(我 09-05 那把尺算的)~~
--      —— **那把尺不看 `polqual`, 還把 PUBLIC 算成 service_role 的覆蓋** ⇒ 判準是錯的。
--   ✅ **現在的來源 = 窄判準 + `docs/plans/2026-09-05-service-role-consumers-inventory.md` §6a 那張表**;
--      判準**取自** `supabase/migrations/20260904270000…:292-302`, 而 🔴 **[R4 A3]** ⛔ ~~逐字抄~~ ——
--      **我【改了兩處】, 寫出來**:①拿掉 `polcmd IN ('r','*')`(它只算 SELECT, 而本案要看 I/U)
--      ②**保留了 `polroles = '{0}'`(PUBLIC 也算覆蓋)** —— 而那正是我上一版被判「尺太寬」的同一條。
--      ⇒ 🛑 **所以「不是我自己造的」只對【qual 那一半】成立;PUBLIC 那一半我原樣繼承了。**
--      ⚠️ 它今天不影響結論(三張表的 policy 都明確 `TO service_role`), 而**它是同一個已知的寬**。窄尺重算 23 個 ⇒ 與寬尺逐格相同,
--      🛑 **而那個「零差異」是因為 `270000` 已貼、把缺口關掉了, 不是我的尺夠好**(§6b)。
--   其餘 **20 個已有涵蓋的 policy(窄判準下)**、
--   26 支函式全是 `SECURITY DEFINER`(`prosecdef` 26/0/26)
--   ⚠️ **[R4 A8]** 那 26 個名字**全 doc 零處列出** ⇒ **這個數字下一個人重跑不了**;
--      而 `public` 有 54 支 invoker 函式 ⇒ **不能憑「都是 SECDEF」的類別推**。標【未可重跑】。
--   ⚠️ **[R2 must-fix :14]** ⛔ ~~原句寫「⇒ 免疫」~~ —— **那比事實樂觀**:
--      `SECURITY DEFINER` 以 **owner** 身分跑, 而 **owner 若不是 superuser / 沒有 BYPASSRLS,
--      且表開了 `FORCE ROW LEVEL SECURITY`, 函式【仍然】受 policy 限制。**
--      🔬 **本專案的實測(所以這次成立, 而理由要寫出來)**:那 26 支的 owner 全是 `postgres`,
--      而 `postgres` 的 `rolbypassrls = t`(2026-09-05 唯讀實查)。
--      🔴 **[R4 A4]** ⛔ ~~「且那 7 張表 `relforcerowsecurity` 全為 f」~~ —— **本檔零處定義那 7 張是哪 7 張**,
--        而唯一的「7」在另一片(`⟦b9-SRVMIN⟧` 的 email/cron 分母)⇒ **那是借來的數字。**
--      ✅ 改成一個**答得出分母**的說法(R4 實查):**`public` 底下 58 張表 `relforcerowsecurity = t` 的有 0 張**
--      ⇒ **兩個條件都不成立 ⇒ 今天確實免疫。**
--      🛑 **而這是【量出來的條件】不是【SECDEF 的性質】** —— 有人開了 FORCE RLS 就要重驗。
--   🔴 **[R4 A5 · 來源屬性]** 下面凡提到「`270000` 已貼」= **讀來的, 不是我量的**。
--      落點(我自己開檔驗過):`~/pcm-mailbox/端Sean-0905早上佇列.md:13` 逐字
--      「✅ **03:1x 已貼(回三欄回滾表 = 成功)**」· `~/pcm-mailbox/Sean拍板-20260905.md`
--      · `supabase/after-checks/270000-after.sql`(在 `origin/dev` 上)。
--      🔵 **而更強的一句是 R4 自己查的**:`grep -c '^20260904270000' supabase/APPLIED.tsv` ⇒ **0**
--      (帳本的 0 什麼都不代表), 而**正式庫實查 `%_select_service_role` 共 47 條、
--      `products_select_service_role` 1 條、負對照 0** ⇒ 📌 **該說的是「那些 policy 實查在庫裡」,
--      不是「他 03:1x 貼了」** —— 前者我驗得到, 後者我只讀得到。
--
--   而**這三張表的寫入路徑今天【只靠 `service_role` 的 `BYPASSRLS`】活著**:
--
--     admin_audit_log          碼要 INSERT   而 policy 只有 SELECT
--     admin_sso_login_events   碼要 INSERT   而 policy 【一條都沒有】
--     staff                    碼要 INSERT+UPDATE  而 policy 只有 SELECT
--
--   🎯 **三張表的共同形狀:全是「寫紀錄」那一族**(稽核 log / SSO 登入事件 / 員工異動)
--   ⇒ 📌 **它們壞掉的樣子不是畫面出錯, 是【紀錄靜靜地少一筆】** —— 最不會被發現的那一種。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴 GRANT 那一層【已經到位】—— 而我一開始讀錯了, 過程寫在這裡免得下一個人重踩
-- ══════════════════════════════════════════════════════════════════════════
--   ⛔ ~~我第一發用 `has_table_privilege('service_role','public.staff','UPDATE')` ⇒ 回 `f`~~
--      ⇒ 差點寫成「還要補一道 GRANT」。
--   🔴 **那個 `f` 是【少報】** —— `staff` 的 UPDATE 是**欄級授權**:
--      `UPDATE:is_active` / `UPDATE:is_manager` / `UPDATE:label`(`aclexplode(attacl)` 實查)
--      而 `has_table_privilege` **對欄級授權回 false**。
--   ✅ 逐欄對照碼:`staff-repository.ts:91-93` 改 `label`+`is_manager`、`:112` 改 `is_active`
--      ⇒ **與那三欄逐字對得上, 一欄不多。** ⇒ 📌 **GRANT 那半今天就已經是最小的了, 不要動它。**
--   🟢 而 `information_schema.column_privileges` 這條路**在唯讀帳號下回空**(實測 0 列)
--      ⇒ **要走 `pg_catalog` 的 `aclexplode`**;負對照:同一把尺問 `brands` ⇒ 印得出八個動詞。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🛑 順序:**本檔要在「拿掉 BYPASSRLS」之【前】貼**
-- ══════════════════════════════════════════════════════════════════════════
--   反過來的話那三處會**安靜地少寫紀錄** —— 而 RLS 擋掉的 INSERT
--   **不一定會噴 500**(可能只是回 0 列), 而**呼叫端有沒有檢查回傳, 沒有人逐支看過**。
--   ⇒ ✅ **驗收要用「那三張表的列數還會不會長」, 不是「畫面有沒有壞」。**
--
-- 🔵 **刻意【不用】`IF NOT EXISTS` / `DROP POLICY IF EXISTS`**:
--    `docs/patterns/revoking-function-execute-in-supabase.md` §3.2 逐字 ——
--    那是「把撞名從報錯變成靜靜跳過的那個開關」, 而**跳過之後斷言會對著
--    你沒看過的那個既有物件跑**。⇒ 撞名就讓它紅, 紅了人才會去看。

-- ══════════════════════════════════════════════════════════════════════════
-- 🔵 **[R4 B4 consider] 本檔【沒有】restrictive-policy 前置閘 —— 而 `20260904270000:136-140` 有**
-- ══════════════════════════════════════════════════════════════════════════
--   那一支逐字寫著:「RESTRICTIVE 會被 AND 起來 ⇒ 我的斷言全綠而收 BYPASSRLS 之後照樣少資料」。
--   🔬 今天 `public` 的 restrictive policy = **0**(R4 唯讀實查)⇒ **本檔今天不需要那道閘。**
--   🛑 **而本檔的價值要等 harden 那一天才兌現** ⇒ 📌 **中間任何人加一條 restrictive,
--      本檔仍然全綠,而寫入會在 harden 當天靜靜失敗。**
--   ⚠️ **這一格我【沒有】補閘,而是寫下來** —— 補它要複製 `270000` 那段的形狀,
--      而**那應該是 `⟦b9-RLSHARDEN⟧` 自己的前置閘,不是第 0 步的**(它才是真的會踩到的那一步)。
--
-- 🔴 **[R4 B5] 而有一條【貼錯版本】的路,寫在這裡**:
--   主樹 `/Users/sean_1/pcm-website-v2/supabase/migrations/20260905090000_…sql` 是**舊版**
--   (R4 量:256 行、無本段、仍宣稱「零行為改變」、引舊的 20 個來源);新版只在 `agent/line-auth`。
--   ⇒ 📌 **手貼的人從 `dev` 拿到的會是舊的那一份。** ⇒ 貼之前先確認拿到的是**含本段**的版本。

BEGIN;

-- ── ① admin_audit_log:碼在 apps/admin/src/lib/orders/order-repository.ts 寫稽核 ──
CREATE POLICY admin_audit_log_insert_service_role ON public.admin_audit_log
  FOR INSERT TO service_role
  WITH CHECK (true);

-- ── ② admin_sso_login_events:碼在 apps/admin/src/lib/sso/login-event.ts 寫登入事件 ──
--    🔴 這張表**今天一條 policy 都沒有** ⇒ 它是三張裡最脆的一張。
CREATE POLICY admin_sso_login_events_insert_service_role ON public.admin_sso_login_events
  FOR INSERT TO service_role
  WITH CHECK (true);

-- ── ③ staff:碼在 apps/admin/src/lib/staff-repository.ts 建員工 / 改 label·is_manager·is_active ──
CREATE POLICY staff_insert_service_role ON public.staff
  FOR INSERT TO service_role
  WITH CHECK (true);

-- 🔴 UPDATE 的 policy **`USING` 與 `WITH CHECK` 兩個都要**:
--    `USING` 決定「哪些既有列改得到」, `WITH CHECK` 決定「改完的樣子准不准」。
--    只寫 `USING` 的話, PostgreSQL 會**拿 `USING` 當 `WITH CHECK`** —— 這次剛好等價,
--    而**那是巧合不是設計** ⇒ 兩個都寫出來, 讓下一個改它的人看得到兩半各自的意思。
--    🔵 **欄的範圍不歸 policy 管, 歸 GRANT 管** —— 那三欄的欄級 UPDATE 已經在了(見上面),
--    所以這條 policy 寫 `true` **不會**讓 service_role 改得到第四欄。
CREATE POLICY staff_update_service_role ON public.staff
  FOR UPDATE TO service_role
  USING (true)
  WITH CHECK (true);

-- ══════════════════════════════════════════════════════════════════════════
-- 事後斷言 —— 🔴 **codex R1 FAIL 之後重寫的第二版**
--   R1 抓到的四個洞, 每一個都是「兩個世界印同一個東西」:
--     ① :85 原版只驗【名字 + 有 service_role】⇒ 動詞改錯 / `USING(false)` / 多掛一個角色, 照樣過
--     ② :101 原版用 `polroles = '{0}'` 比【相等】⇒ `TO PUBLIC, service_role` 的陣列是 `{0, oid}`
--            ⇒ **正反兩格都會過, 而 PUBLIC 世界與 service_role-only 世界印同一個結果**
--     ③ :118 原版的「正對照」驗的是**另一條 policy 的名字存在** ⇒ 它與上面兩格**不走同一條路**
--            ⇒ 📌 一個正對照若不與被驗對象共用程式路徑, 它證明不了那把尺會動
--     ④ :48 「零行為改變」**只在 `service_role` 帶 BYPASSRLS 時成立** ⇒ 而原版沒有斷言那個前提
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  n int;
  expected CONSTANT text[][] := ARRAY[
    ['admin_audit_log',        'admin_audit_log_insert_service_role',        'a'],
    ['admin_sso_login_events', 'admin_sso_login_events_insert_service_role', 'a'],
    ['staff',                  'staff_insert_service_role',                  'a'],
    ['staff',                  'staff_update_service_role',                  'w']
  ];
  i int;
BEGIN
  -- ④ 前提斷言(R1 must-fix ④):本檔宣稱「零行為改變」, 而**那句只在 BYPASSRLS 還在時成立**。
  --    若 apply 的環境已經收掉了 BYPASSRLS, 這四條 policy 會**當場把今天擋著的寫入放行**
  --    ⇒ 那就不是「零行為改變」, 而是一個沒有人審過的行為改變。⇒ 停下來, 讓人重讀順序。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
                  WHERE rolname = 'service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'service_role 已經沒有 BYPASSRLS ⇒ 本檔的「零行為改變」前提不成立。'
                    '這表示 ⟦b9-RLSHARDEN⟧ 已經先跑了 —— 順序反了, 停下來重讀本檔開頭那一段。';
  END IF;

  -- ⑥ 前提斷言(R2 must-fix `:99`):**目標表必須真的開著 RLS**。
  --    🔴 沒有這一格的話:某張表其實沒 ENABLE RLS ⇒ 四條 policy 與全部斷言【照樣全過】,
  --    而拿掉 BYPASSRLS 之後那張表**完全不受 policy 保護** ⇒ 📌 一個綠色的假保護。
  FOR i IN 1 .. array_length(expected, 1) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                     JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
                    WHERE ns.nspname='public' AND c.relname = expected[i][1]
                      AND c.relrowsecurity) THEN
      RAISE EXCEPTION '% 沒有啟用 RLS ⇒ 在它上面加 policy 是【看起來有保護】而實際沒有', expected[i][1];
    END IF;
  END LOOP;

  -- ⑦ 前提斷言(R2 must-fix `:171`):**ACL 那一層也要在**。
  --    🔴 RLS 與 GRANT 是兩道【各自獨立】的閘, 兩道都要過。
  --    只鎖 policy 而 ACL 少了 INSERT / 欄級 UPDATE / SELECT ⇒ 本檔仍全過,
  --    而拿掉 BYPASSRLS 之後**寫入或 `.select()` 回讀才失敗** ⇒ 那時沒有人會想到是這裡。
  IF NOT (has_table_privilege('service_role','public.admin_audit_log','INSERT')
      AND has_table_privilege('service_role','public.admin_sso_login_events','INSERT')
      AND has_table_privilege('service_role','public.staff','INSERT')
      AND has_table_privilege('service_role','public.admin_audit_log','SELECT')
      AND has_table_privilege('service_role','public.staff','SELECT')) THEN
    RAISE EXCEPTION 'ACL 前提不成立:三張表的 INSERT / 回讀用的 SELECT 沒有齊 ⇒ 只補 policy 不夠';
  END IF;
  -- 🔴 staff 的 UPDATE 是**欄級**的 ⇒ `has_table_privilege` 對它回 false(本檔開頭那段記過)
  --    ⇒ 這裡要走欄級問法, 而且**三欄逐欄問**(少一欄, 那個欄位的更新就會在 harden 後靜靜失敗)。
  IF NOT (has_column_privilege('service_role','public.staff','label','UPDATE')
      AND has_column_privilege('service_role','public.staff','is_manager','UPDATE')
      AND has_column_privilege('service_role','public.staff','is_active','UPDATE')) THEN
    RAISE EXCEPTION 'staff 的欄級 UPDATE 前提不成立(label/is_manager/is_active 要三欄都有)';
  END IF;

  -- ① 正向(R1 must-fix ①):逐條驗【表 + 名 + 動詞 + qual + permissive + 角色恰等於 service_role】
  FOR i IN 1 .. array_length(expected, 1) LOOP
    SELECT count(*) INTO n
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c  ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public'
       AND c.relname  = expected[i][1]
       AND p.polname  = expected[i][2]
       AND p.polcmd   = expected[i][3]::"char"      -- 動詞:'a'=INSERT 'w'=UPDATE
       AND p.polpermissive                           -- 必須是 permissive, 不是 restrictive
       -- 🔴 角色**恰等於** {service_role}:多一個少一個都不算
       AND p.polroles = ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='service_role')]::oid[]
       -- 🔴 qual 要真的是 true, 不是 false 也不是別的表達式
       AND coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), 'true') = 'true'
       AND coalesce(pg_catalog.pg_get_expr(p.polqual,      p.polrelid), 'true') = 'true';
    IF n <> 1 THEN
      RAISE EXCEPTION '% 上的 % 不符期望形狀(表/動詞/qual/permissive/角色恰等於 service_role)⇒ 數到 % 條',
        expected[i][1], expected[i][2], n;
    END IF;
  END LOOP;

  -- ② 反向(R1 must-fix ②):不得對 PUBLIC / anon / authenticated 開。
  --    🛑🛑 **誠實標記:這一格【被 ① 涵蓋了, 它不可能單獨叫】** ——
  --    ① 已經要求 `polroles` **恰等於** `{service_role}` ⇒ 0(PUBLIC)與 anon 都不可能在裡面。
  --    🔬 實測:突變「三條 INSERT 改成 `TO PUBLIC, service_role`」⇒ **被 ① 擋下**, ② 沒輪到。
  --    ⇒ 📌 **留著它不是因為它多擋了一個世界, 是因為它的錯誤訊息直接說出「開給了誰」**,
  --      而 ① 的訊息只說「形狀不符」。⇒ 兩個訊息各自把人送到不同的地方。
  --    🔴 **[R2 nit :130 補]** codex 指出 **③ 也一樣被 ① 推得出來** ⇒ 兩格都不增加阻擋力。
  --       ✅ 保留的理由同下, 而**兩格都明寫「不算獨立證據」**, 不讓下一個人把它們數成三道網。
  --    ⚠️ **而若哪天有人放寬了 ①(例如改成「含有 service_role 即可」), 這一格會【立刻變成唯一的網】**
  --      ⇒ 那正是留著它的理由;但**今天不要把它算成第二道獨立的證據。**
  --    🔴 改成問【成員資格】不是【陣列相等】—— `TO PUBLIC, service_role` 的 polroles 是
  --       `{0, <oid>}`, 而舊版的 `= '{0}'` 對它回 false ⇒ 那個世界會靜靜通過。
  SELECT count(*) INTO n
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c2 ON c2.oid = p.polrelid
     JOIN pg_catalog.pg_namespace ns2 ON ns2.oid = c2.relnamespace
   WHERE ns2.nspname = 'public'
     -- 🔴 **[R2 must-fix :140]** policy 名字**只在一張表內唯一** ⇒ 別的表可以合法重用同名
     --    ⇒ 舊版只比 `polname` ⇒ ②會把別表的同名 policy 誤報成公開、③會數成 >4。
     --    ✅ 綁上 (表, 名) 這一對。
     AND (c2.relname, p.polname) IN (
           ('admin_audit_log','admin_audit_log_insert_service_role'),
           ('admin_sso_login_events','admin_sso_login_events_insert_service_role'),
           ('staff','staff_insert_service_role'),
           ('staff','staff_update_service_role'))
     AND (0 = ANY (p.polroles)                       -- 0 = PUBLIC, 用成員資格問
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
                      WHERE r.oid = ANY (p.polroles)
                        AND r.rolname IN ('anon','authenticated')));
  IF n <> 0 THEN
    RAISE EXCEPTION '有 % 條 policy 開給了 PUBLIC/anon/authenticated —— 本檔只該開給 service_role', n;
  END IF;

  -- ③ 正對照(R1 must-fix ③):**與 ② 走同一條程式路徑**, 只是餵一個【已知會命中】的輸入。
  --    🔴 舊版驗的是「另一條 policy 的名字存在」⇒ 那與 ② 的查詢形狀不同 ⇒ 證明不了 ② 會動。
  --    ✅ 這一版把 ② 的條件原樣拿來, 只把「不該中的角色集合」換成【一定會中的】
  --       ⇒ 若這裡回 0, 表示 ② 那個 0 是【尺不會動】而不是【真的沒有】。
  SELECT count(*) INTO n
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c3 ON c3.oid = p.polrelid
     JOIN pg_catalog.pg_namespace ns3 ON ns3.oid = c3.relnamespace
   WHERE ns3.nspname = 'public'
     AND (c3.relname, p.polname) IN (
           ('admin_audit_log','admin_audit_log_insert_service_role'),
           ('admin_sso_login_events','admin_sso_login_events_insert_service_role'),
           ('staff','staff_insert_service_role'),
           ('staff','staff_update_service_role'))
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
                  WHERE r.oid = ANY (p.polroles)
                    AND r.rolname IN ('service_role'));   -- ← 唯一的差別:換成一定會中的角色
  IF n <> 4 THEN
    RAISE EXCEPTION '正對照失敗:同一個查詢形狀餵【一定會中】的角色只數到 % 條(期望 4)⇒ 上面那個 0 沒有判別力', n;
  END IF;

  -- ⑤ 本檔【不得】動 GRANT ⇒ staff 的表級 UPDATE 應仍【不是】表級授權
  --    (它是欄級的 ⇒ has_table_privilege 本來就回 false;變 true 表示有人加了表級 GRANT)
  IF has_table_privilege('service_role','public.staff','UPDATE') THEN
    RAISE EXCEPTION 'staff 的 UPDATE 變成【表級】授權了 —— 本檔不動 GRANT, 這表示有別的東西放寬了它';
  END IF;
END $$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- Rollback(單向門檢查:**本檔不是單向門** —— 四條 policy 都是新加的, 刪掉即回到今天)
-- ══════════════════════════════════════════════════════════════════════════
--   🔴 **[R2 must-fix :181]** 四句要**包在一個交易裡**, 而且**先擋一個世界**:
--      若 BYPASSRLS 已經被拿掉(= RLSHARDEN 跑過了), **這四個 DROP 會【當場切斷寫入】**。
--   BEGIN;
--     DO $r$ BEGIN
--       IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
--                       WHERE rolname='service_role' AND rolbypassrls) THEN
--         RAISE EXCEPTION 'BYPASSRLS 已經拿掉了 ⇒ 現在 DROP 這四條會切斷 admin 的寫入路徑';
--       END IF;
--     END $r$;
--     DROP POLICY staff_update_service_role ON public.staff;
--     DROP POLICY staff_insert_service_role ON public.staff;
--     DROP POLICY admin_sso_login_events_insert_service_role ON public.admin_sso_login_events;
--     DROP POLICY admin_audit_log_insert_service_role ON public.admin_audit_log;
--   COMMIT;
--
-- ⚠️ **[2026-09-05 訂正]** ⛔ ~~本檔在 BYPASSRLS 還在的世界裡是【零行為改變】~~
--    ⇒ 那句對**今天在跑的寫入路徑**成立, 而**對那兩支可重跑的零-policy 偵測器不成立**(見檔頭)。
-- 🔵 **[R4 A7 訂正]** 下面這句的射程 = **今天在跑的那些寫入路徑**, 不是全部 ——
--    那兩支零-policy 偵測器重跑仍會紅(檔頭已寫)。⇒ **rollback 之後, 那幾條路徑的行為與今天相同** —— 因為今天那三條路是靠 `BYPASSRLS` 過的,
--    而本檔沒有動 `BYPASSRLS`。⇒ 📌 **本檔在「BYPASSRLS 還在」的世界裡是【零行為改變】**;
--    它的價值要等 `⟦b9-RLSHARDEN⟧` 那一刀下去才兌現。
-- 🛑 **⇒ 所以貼了本檔之後【不會有任何東西變綠, 也不會有任何畫面變化】** ——
--    唯一的證據是 `docs/probes/2026-09-05-rlsharden-prereq.sh` 重跑, 那三列從「缺」變成「有」。
