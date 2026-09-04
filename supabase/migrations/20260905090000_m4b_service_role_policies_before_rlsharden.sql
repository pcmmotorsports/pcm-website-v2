-- ⟦b9-RLSHARDEN⟧ 第 0 步:補上三張表缺的 service_role 寫入 policy
--
-- 🛑🛑 **本檔是【草稿】。動 RLS = PCM 鐵則 12②(權限)⇒ 要 Sean 拍板 + codex 對抗審查才貼。**
-- 🟢 **它是【純加 policy】** —— 零 `GRANT`、零 `REVOKE`、零 `ALTER ROLE`、**不建表 / 函式 / 角色**。
--    ⛔ ~~原句寫「不建任何新物件」~~ —— **policy 自己就是新的 DB 物件**(codex R1 nit)。
--    ⇒ 貼上去**不會讓任何今天能做的事變成不能做**;它只是把「今天靠 BYPASSRLS 過的」
--      改成「靠一條寫明的政策過的」。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 為什麼要有它(來源:2026-09-05 線【身分】`-auth` 的兩份唯讀盤點)
-- ══════════════════════════════════════════════════════════════════════════
--   `docs/plans/2026-09-05-service-role-consumers-inventory.md` 掃了 `origin/dev` 的碼:
--   **23 個表/view + 26 支函式**由 `service_role` 碰到。其中 **20 個已有涵蓋的 policy**、
--   26 支函式全是 `SECURITY DEFINER`(`prosecdef` 26/0/26 ⇒ 免疫),
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
  --    ⚠️ **而若哪天有人放寬了 ①(例如改成「含有 service_role 即可」), 這一格會【立刻變成唯一的網】**
  --      ⇒ 那正是留著它的理由;但**今天不要把它算成第二道獨立的證據。**
  --    🔴 改成問【成員資格】不是【陣列相等】—— `TO PUBLIC, service_role` 的 polroles 是
  --       `{0, <oid>}`, 而舊版的 `= '{0}'` 對它回 false ⇒ 那個世界會靜靜通過。
  SELECT count(*) INTO n
    FROM pg_catalog.pg_policy p
   WHERE p.polname = ANY (ARRAY['admin_audit_log_insert_service_role',
                                'admin_sso_login_events_insert_service_role',
                                'staff_insert_service_role',
                                'staff_update_service_role'])
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
   WHERE p.polname = ANY (ARRAY['admin_audit_log_insert_service_role',
                                'admin_sso_login_events_insert_service_role',
                                'staff_insert_service_role',
                                'staff_update_service_role'])
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
--   DROP POLICY staff_update_service_role ON public.staff;
--   DROP POLICY staff_insert_service_role ON public.staff;
--   DROP POLICY admin_sso_login_events_insert_service_role ON public.admin_sso_login_events;
--   DROP POLICY admin_audit_log_insert_service_role ON public.admin_audit_log;
--
-- 🔵 **rollback 之後行為與今天完全相同** —— 因為今天那三條路是靠 `BYPASSRLS` 過的,
--    而本檔沒有動 `BYPASSRLS`。⇒ 📌 **本檔在「BYPASSRLS 還在」的世界裡是【零行為改變】**;
--    它的價值要等 `⟦b9-RLSHARDEN⟧` 那一刀下去才兌現。
-- 🛑 **⇒ 所以貼了本檔之後【不會有任何東西變綠, 也不會有任何畫面變化】** ——
--    唯一的證據是 `docs/probes/2026-09-05-rlsharden-prereq.sh` 重跑, 那三列從「缺」變成「有」。
