-- ⟦b9-RLSHARDEN⟧ 第 0 步:補上三張表缺的 service_role 寫入 policy
--
-- 🛑🛑 **本檔是【草稿】。動 RLS = PCM 鐵則 12②(權限)⇒ 要 Sean 拍板 + codex 對抗審查才貼。**
-- 🟢 **它是【純加 policy】** —— 零 `GRANT`、零 `REVOKE`、零 `ALTER ROLE`、不建任何新物件。
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
-- 事後斷言 —— 🔴 **雙向:該有的要有(正向), 而【不該被順手放寬的】要仍然關著(反向)**
--   只寫正向的話, 一支「把三張表對所有人開放」的 migration 也會全過。
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  n int;
BEGIN
  -- ① 正向:四條 policy 都在, 而且都只給 service_role
  SELECT count(*) INTO n
    FROM pg_catalog.pg_policy p
    JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public'
     AND p.polname IN ('admin_audit_log_insert_service_role',
                       'admin_sso_login_events_insert_service_role',
                       'staff_insert_service_role',
                       'staff_update_service_role')
     AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
                  WHERE r.oid = ANY(p.polroles) AND r.rolname = 'service_role');
  IF n <> 4 THEN
    RAISE EXCEPTION '本檔要建的四條 policy 只認到 % 條(期望 4)', n;
  END IF;

  -- ② 反向:這四條【不得】對 PUBLIC / anon / authenticated 開
  --    🔴 `polroles = '{0}'` 就是 PUBLIC, 而 pg_roles 裡沒有 oid 0
  --       ⇒ 用 JOIN 去找會【靜靜漏掉 PUBLIC 那一種】, 所以這裡直接比陣列。
  SELECT count(*) INTO n
    FROM pg_catalog.pg_policy p
   WHERE p.polname IN ('admin_audit_log_insert_service_role',
                       'admin_sso_login_events_insert_service_role',
                       'staff_insert_service_role',
                       'staff_update_service_role')
     AND (p.polroles = '{0}'::oid[]
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
                      WHERE r.oid = ANY(p.polroles)
                        AND r.rolname IN ('anon','authenticated')));
  IF n <> 0 THEN
    RAISE EXCEPTION '有 % 條 policy 開給了 PUBLIC/anon/authenticated —— 本檔只該開給 service_role', n;
  END IF;

  -- ③ 🟢 正對照:證明上面那把尺【會動】—— 它在同一組條件下數得到既有的那些
  --    少了這一格, 一個永遠回 0 的查詢也會讓 ② 過。
  SELECT count(*) INTO n
    FROM pg_catalog.pg_policy p
   WHERE p.polname = 'email_outbox_select_service_role';
  IF n <> 1 THEN
    RAISE EXCEPTION '正對照失敗:既有的 email_outbox_select_service_role 數到 % 條(期望 1)⇒ 上面那些 0 沒有判別力', n;
  END IF;

  -- ④ 🔴 本檔【不得】動 GRANT ⇒ 那三張表的表級 UPDATE 應該仍然【不是】表級授權
  --    (staff 的 UPDATE 是欄級的 ⇒ has_table_privilege 本來就回 false;
  --     若這裡變 true, 表示有人順手加了一道表級 GRANT)
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
