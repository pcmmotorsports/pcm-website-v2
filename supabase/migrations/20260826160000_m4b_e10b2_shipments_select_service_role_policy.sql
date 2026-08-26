-- ============================================================================
-- 🛑🛑 **本片【未完成】, 而它已經被 commit 了 —— 這一段是它的狀態, 先讀完再動。**
--
-- 2026-08-26 Sean 拍板收工(逐字「算了, 先做到一個段落, 全部開新視窗」)。
-- 為了不把半成品留在多窗共用的工作樹上, 本片【帶著未折的 findings 進版控】。
--
-- 🔴🔴 **不要 apply。codex 對抗審查判 FAIL, 3 條 must-fix 一條都沒折。**
--
-- ── 沒折的 3 條(codex 2026-08-26, 逐條抄它的字面, 我沒有轉述)──────────────
--  M1 段C 的 RESTRICTIVE 檢查漏掉「service_role 繼承其他角色」          `:219-224 :249`
--     反例:`GRANT rls_guard TO service_role;`
--           `CREATE POLICY x ON public.shipments AS RESTRICTIVE FOR SELECT TO rls_guard USING (false);`
--     ⇒ 那條會套到 service_role, 而本片只比 `roles` 裡有沒有【字面】service_role/public
--     ⇒ `n_restr = 0` ⇒ **整片 PASS, 而實際 SELECT 回零列。**
--     ⚠️ 段A 查的是**反方向**(誰繼承 service_role), 也抓不到。
--     修法:用 `pg_has_role('service_role', <政策角色>, 'USAGE')` 展開, 不能只比字面。
--
--  M2 「apply 當下不擴權」沒有被證明, 而且構造得出反例                   `:46-49 :174`
--     ① apply 前 service_role 已被改成 NOBYPASSRLS ② 兩表零 permissive policy ⇒ 它讀不到列
--     ③ 段A 不檢查 service_role 自己還有沒有 BYPASSRLS ⇒ 通過
--     ④ 段B 建 USING(true) ⇒ **它立刻從零列變成全部列**
--     ⇒ 那**可能**正是本片要恢復的能力, **而它仍然是「apply 當下擴權」。**
--     修法:改窄宣稱, 或斷言 apply 當下 `service_role.rolbypassrls = true`。
--
--  M3 「政策面 = GRANT 面 = 實際動作面」的自證不完整                     `:32-33 :232-249`
--     段C 只證了 SELECT 有效權限【存在】, 沒有證:
--       · INSERT/UPDATE/DELETE 的有效權限【不存在】
--       · `relrowsecurity` 仍為 true
--       · 實際動作面仍只有「SELECT 直接讀、寫入走 RPC」
--     反例:apply 前有人 `GRANT INSERT ON shipments TO service_role` ⇒ **本片仍完整 PASS**,
--           而「GRANT 面只有 SELECT、三者對齊」已是假話。
--
-- ── 沒折的 nit ──────────────────────────────────────────────────────────────
--  N1 檔頭 `:55` 寫「本片不看 USING 內容」, 而段C `:214-217` 明確驗 `qual='true'` ⇒ **字面直接矛盾。**
--  N2 檔頭 `:25-26` 說「五支皆 SECURITY DEFINER」而只引用 skeleton 的前兩支行號。
--     ✅ codex 實查五支最終版本**確實全部是** SECURITY DEFINER
--        (`20260807170000:83-92` / `20260807230000:294-301` / `20260808100000:177-184 :308-315 :413-419`)
--     ⇒ **結論成立而證據引用要換成那五支最終定義。**
--
-- ── 🔴 cf 那一輪【跑完了, 而它全綠】—— 這一格比「沒跑完」更該小心 ─────────────
--   ~~原本這裡寫「它一格都沒回」~~ **那是我寫下時的狀態, 而它在我 commit 之後交件了。**
--   cf 把我指派的四個方向(只補 SELECT 對不對 / trigger 與 guard 的互動 / 迴圈殘留 / 檔頭射程)
--   **全部打完, 結論 0 must-fix / 3 nit。**
--   🔴 **而 codex 判 FAIL 3 條 must-fix, 而 cf 收工時還沒拿到那三條、不知道它們是什麼。**
--   ⇒ cf 自己逐字寫進它的 checkpoint:
--     「**接手的人:先去拿 codex 那三條, 不要從我的『0 must-fix』起跳。片3a = FAIL 且未折。**」
--   📌 **它自己指出這比「我沒打完」更該寫下來** ——
--      **因為那四個方向全綠, 而【全綠】正是最容易被下一個人讀成「過了」的形狀。**
--   ⇒ **兩輪都跑了, 而兩輪的結論相反, 且它們打的不是同一批方向。**
--     「兩輪審查都跑過」這句話是真的, 而它**不代表這支檔過了**。
--
--   ✅ 而 cf 在方向1 給的理由**比我檔頭原本寫的更硬**, 收下:
--      只補 SELECT 對, **不是因為「寫都走 RPC」, 是因為 GRANT 面本來就只有 SELECT**
--      (`20260805170000:277` / `20260805170200:254`)⇒ **寫入在 GRANT 層就被擋,
--      連 RLS 政策與 trigger 都碰不到。** cf 實測 `sr_nobypass` 的 INSERT/UPDATE/DELETE
--      三個都 `permission denied`。
--      ⇒ 我原本的理由(走 RPC)是**應用層的**, 而這個是**資料庫層的** —— 後者不會因為有人改 code 而失效。
--
-- ── ⚠️ 而有一格擋在所有折法前面, 它是 Sean 一個字回得完的題 ─────────────────
--   本片 `:104` 是**全 repo 第一支對 PG 版本設下限的 migration**(要求 `server_version_num >= 160000`,
--   因為段A 用了 `pg_has_role(..., 'SET')` 這個 PG 16 才有的模式)。
--   🔴 **而 Supabase 線上的 `server_version_num` 沒有人量過。**(cf 2026-08-26 指出)
--   ⇒ 折那三條之前先問掉這一格, 否則折完可能還是擋在版本那一行。
--     查法(貼進 SQL Editor 一行):`SELECT current_setting('server_version_num');`
--
-- ── 已經量過而【仍然成立】的(這些不用重做)───────────────────────────────
--   七個世界 rc 全對且每個紅都紅在對的那一格;判別力已驗(拔掉段C ⇒ 該紅的世界 rc=0)。
--   ⚠️ 而那七個世界**都在 codex 那 3 條的射程之外** —— 它們證的是「這套斷言分得開這七個世界」,
--     **不證 codex 指的那三個世界。那三個我一個都沒造過。**
-- ============================================================================

-- ============================================================================
-- M-4b · 片 3a · shipments / shipment_items 補 service_role 的 SELECT 政策
--
-- ══ 這是「補那 42 張」的第二片 ═══════════════════════════════════════════════
-- Sean 2026-08-26 拍【乙】:先裝守門擋住第 43 張, 再補既有那 42 張。
--   守門  `d00c8523`  片2(email_outbox 三條)`dc6d1961`  ⇒ 本片是第三顆。
-- 本片補 2 張 ⇒ **補到 3 張, 還剩 39 張。**
--
-- ══ 為什麼這兩張是【一組】而 orders / customers 不在裡面 ═══════════════════
-- b4 2026-08-26 把 P1 那批四張放在一起, 而 2026-08-26 逐張量 GRANT 面之後, 它們裂成兩堆:
--   ✅ 本片這兩張:**GRANT 面完整寫在版控裡, 一行一行看得到**
--        `20260805170000_m4b_e10_b2_s1a1_shipments.sql:274` REVOKE ALL FROM PUBLIC, anon, authenticated, service_role
--        同檔 `:277` GRANT SELECT ON TABLE public.shipments TO service_role
--        `20260805170200_m4b_e10_b2_s1b_shipment_items.sql:253` REVOKE ALL …
--        同檔 `:254` GRANT SELECT ON TABLE public.shipment_items TO service_role
--   🔴 orders / customers:**它們的 service_role GRANT 不在任何一支 migration 裡**
--        而 `20260611120000:239` `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.orders FROM se…`
--        **證明它本來有** ⇒ 授出那一次不在版控裡 ⇒ **那正是 Q15 的母題本身。**
--        ⇒ 它們另外一片, 已派人查來源。**不要為了「一次做完四張」把它們併進來。**
--
-- ══ 為什麼只補 SELECT(這次有證據, 不是圖省事)═══════════════════════════════
-- 片2 的教訓:只補 SELECT 而 adapter 還會 insert/update ⇒ 救不了它宣稱要救的東西。
-- ⇒ 本片當場數過這兩張表的所有觸點:
--   `apps/admin/src/lib/shipping/shipment-repository.ts`
--     **寫全部走 RPC**(`:101 :123 :143 :158 :172` admin_create_shipment / add_items /
--     mark_shipped / void / unvoid, 皆 `SECURITY DEFINER` ⇒ `20260807150000:105 :126`)
--     **讀直接 `.from()`**(`:281 :303 :427 :586`)
--   `packages/adapters/src/email/SupabaseShippedEmailContextAdapter.ts:100 :126` 只 `.from()`, 零寫入動詞
--   🔴 而 `shipment-repository.ts:180-182` **它自己就寫著這件事**, 逐字:
--      「讀**不走 RPC**:`shipments` / `shipment_items` 都有 `GRANT SELECT … TO service_role`
--        (s1a1:277 / s1b:254)⇒ 直接 SELECT。不為了對稱而多包一層沒有的 RPC。」
-- ⇒ **政策面 = GRANT 面 = 實際動作面, 三者對齊。加 INSERT/UPDATE 政策會是憑空擴權**
--   (GRANT 沒給, 政策給了 ⇒ 兩面對不齊, 而下一個人會以為 GRANT 漏了)。
--
-- ══ 今天為什麼不爆 ═════════════════════════════════════════════════════════
-- 兩張都 `ENABLE ROW LEVEL SECURITY`(`s1a1:268` / `s1b:252`)而**現有政策各為零條**
-- (數法:對每一支含 `create policy` 的 migration 問「有沒有 `on (public.)?<表>`」,
--  解析器用 `scripts/rls-service-role-policy-gate.py` 的同一組;負對照餵不存在的表名 ⇒ 零命中)。
-- ⇒ 它們今天讀得到, 靠的是 `service_role` 帶 **BYPASSRLS** —— 平台角色屬性, repo 內零行宣告。
--
-- ══ 壞掉那天畫面長怎樣(這一格決定它排在哪)═══════════════════════════════════
-- 這兩張**後台畫面在讀** ⇒ 拿掉 BYPASSRLS 那天, **出貨頁面會空掉, 員工當天就會叫。**
-- ⇒ 與片2 的 `email_outbox`(零頁在讀, 信不寄而每頁都綠)**不是同一種急**。
--   📌 b4 2026-08-26 那句:**同時被畫面用到反而是保護 —— 一個只有背景在用的表, 沒有人替它叫。**
--
-- ══ 「不擴權」這句話的【時態】(片2 兩輪審查都命中的那一格)══════════════════
-- 🔴 **對 apply 當下存在的角色不擴權;之後被授予 `service_role` 的角色, 會直接取得這兩張表的讀取。**
--    段A 只在 apply 當下量一次, 之後不會再跑、零訊號。
--    📌 **一句沒有時態的安全宣稱, 會在它不再成立的那天, 還印著同一行字。**
--
-- ══ 🔴 本片【沒有】關掉什麼 ═════════════════════════════════════════════════
--   · 補到 3 張, **還剩 39 張**。· orders / customers 不在射程(見上)。
--   · 兩張野生表(`product_fitments_effective_staging` / `_sync_log`)沒有建表 migration, 不在射程。
--   · 那 10 張金流表走 `PAYMENT_CONFIRMER_DB_URL` 不是 service_role ⇒ Q15 對它們無效。
--   · 本片不看 `USING` 內容、不處理 SECURITY DEFINER、只碰 `public` schema。
--
-- ══ 七個世界都表演過(2026-08-26, 本機拋棄式 PostgreSQL 17.10, 每發全新 DB)═══════
--   世界                              rc  紅在        怎麼造出來的
--   甲 兩條政策都對                    0  —           原檔
--   乙 shipments 那條給錯角色          3  段C ④       改段B
--   丙 shipments 那條 USING (false)    3  段C ⑤       改段B
--   丁 少建 shipment_items 那條        3  段C ①       改段B
--   戊 有 RESTRICTIVE 也套到           3  段C ⑥       改前置 SQL
--   己 GRANT 被拿掉                    3  段C ⑦       改前置 SQL
--   庚 有人 INHERIT 繼承 service_role   3  段A         改前置 SQL
-- 🔴 **「怎麼造出來的」那一欄不可省**(片2 cf 的 F3):前四個要改段B 才造得出來
--    ⇒ **它們證的是「斷言有判別力」, 不是「這支檔有七種失效模式」。**
--    後三個是真的可達的。📌 一張只列「世界 ⇒ rc」的表, 讀起來像後者。
-- 🔴 **比的是【哪一格紅】, 不只是 rc** —— 片2 那一輪這一格救了三次
--    (一次語法錯讓六個「紅」全是同一個錯 / 兩次死在 COMMENT ON POLICY 沒跑到斷言)。
--    **本片七格一次全對, 而那是因為前一片先踩過。**
-- 判別力:把段C 整段拔掉再餵該紅的世界己 ⇒ **rc=0 靜靜通過**(有段C 是 3)⇒ 段C 不是裝飾。
-- ⚠️ 效度限制:本機 17.10 ≠ 線上版本(未確認)· fixture 不是真表 · **沒有測 pooled 連線**
--    · 收攤已驗:pgrep 0 / 目錄與 socket 皆已刪(正對照 pgrep node ⇒ 123)
--
-- ══ rollback ═══════════════════════════════════════════════════════════════
--   DROP POLICY IF EXISTS shipment_items_select_service_role ON public.shipment_items;
--   DROP POLICY IF EXISTS shipments_select_service_role      ON public.shipments;
--   零資料異動、零欄位異動;`DROP POLICY` 一併移除它的 COMMENT。
--   ⚠️ **回滾 = 退回「靠平台特權」那個狀態, 不是退回更安全的狀態。**
--
-- ══ 🔴🔴 跑本片的斷言時一定要帶 `-v ON_ERROR_STOP=1` ═══════════════════════════
--   b4 2026-08-26 警告, 片2 當場複現:同一個該紅的世界, 不加 ⇒ **rc=0 全綠**,
--   而畫面上明明有 1 行 ERROR;加了 ⇒ rc=3。
--   📌 **psql 預設吞掉 SQL 錯誤的 rc ⇒ 看畫面的人會發現, 看 rc 的不會。**
-- ============================================================================

BEGIN;

-- ── 段A · fail-closed 角色閘(形狀與片2 同款, 理由見該檔)────────────────────
-- 判準 = `USAGE OR SET`(codex 2026-08-26:`MEMBER` 只代表是成員, 兩件事都不保證 ⇒ 會誤擋)。
-- owner 只有在 `relforcerowsecurity=false` 時才排除得起(FORCE 之下 owner 也受 RLS 管)。
-- 正對照走真實 membership(cf 2026-08-26:`pg_has_role(自己,自己)` 恆為 true, 它什麼都證不到)。
DO $$
DECLARE
  v_neg     boolean;
  v_extra   text;
  v_members int;
  v_seen    int;
  t         text;
  v_owner   oid;
  v_force   boolean;
BEGIN
  IF current_setting('server_version_num')::int < 160000 THEN
    RAISE EXCEPTION '片3a 段A:server_version_num = % < 160000 ⇒ pg_has_role 沒有 SET 模式 ⇒ 本閘對「可否 SET ROLE」沒有判斷力, 擋下(fail-closed)', current_setting('server_version_num');
  END IF;

  SELECT count(*) INTO v_members
    FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles gr ON gr.oid = m.roleid
   WHERE gr.rolname = 'service_role';
  SELECT count(*) INTO v_seen
    FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles gr ON gr.oid = m.roleid
    JOIN pg_catalog.pg_roles mr ON mr.oid = m.member
   WHERE gr.rolname = 'service_role'
     AND pg_catalog.pg_has_role(mr.rolname, 'service_role', 'MEMBER');
  IF v_members <> v_seen THEN
    RAISE EXCEPTION '片3a 段A 正對照失敗:pg_auth_members 記 % 個 service_role 的成員, 而 pg_has_role 只認得 % 個 ⇒ 兩張表對不起來, 這把尺不可信', v_members, v_seen;
  END IF;
  -- ⚠️ v_members = 0 時上面那格恆等, 它證不到東西。而那時「枚舉回空」本來就是正確答案。

  SELECT pg_catalog.pg_has_role('pg_signal_backend', 'service_role', 'USAGE') INTO v_neg;
  IF v_neg IS DISTINCT FROM false THEN
    RAISE EXCEPTION '片3a 段A 負對照失敗:pg_signal_backend 對 service_role 回 % ⇒ 這把尺會無中生有', v_neg;
  END IF;

  FOREACH t IN ARRAY ARRAY['shipments', 'shipment_items'] LOOP
    SELECT c.relowner, c.relforcerowsecurity INTO v_owner, v_force
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = t;
    IF v_owner IS NULL THEN
      RAISE EXCEPTION '片3a 段A:找不到 public.% ⇒ 本片對這個庫沒有判斷力, 擋下', t;
    END IF;

    SELECT coalesce(pg_catalog.string_agg(
             r.rolname || ' (USAGE=' || pg_catalog.pg_has_role(r.rolname, 'service_role', 'USAGE')::text
                       || ' SET='    || pg_catalog.pg_has_role(r.rolname, 'service_role', 'SET')::text || ')',
             ', ' ORDER BY r.rolname), '')
      INTO v_extra
      FROM pg_catalog.pg_roles r
     WHERE r.rolname <> 'service_role'
       AND NOT r.rolsuper
       AND NOT r.rolbypassrls
       AND NOT (r.oid = v_owner AND NOT v_force)
       AND (pg_catalog.pg_has_role(r.rolname, 'service_role', 'USAGE')
         OR pg_catalog.pg_has_role(r.rolname, 'service_role', 'SET'));

    IF v_extra <> '' THEN
      RAISE EXCEPTION E'片3a 段A 擋下(表 %), 本片沒有 apply(整筆已回滾, 資料庫沒有任何改變)。\n'
        '這些角色拿得到 service_role 的東西:[%]\n'
        '(該表的 FORCE ROW LEVEL SECURITY = % ⇒ 它決定 table owner 算不算在裡面)\n'
        '⇒ 本片的政策會一起套到它們。這【可能】是真暴露, 也【可能】是假紅。\n'
        '⇒ rolbypassrls=true 是假紅;是該表 owner 而 FORCE=false 也是假紅。其餘 = 🔴 真的多一個看得到的人。\n'
        '⇒ 逐角色分得開的查詢, 見片2 那支 migration 的段A 錯誤訊息(同一段, 把表名換掉即可)。',
        t, v_extra, v_force;
    END IF;
  END LOOP;
END $$;

-- ── 段B · 政策本體(各一條 SELECT)──────────────────────────────────────────
-- 命名對齊 `email_outbox_select_service_role`(片2)與 `customers_insert_service_role`(既有)。
CREATE POLICY shipments_select_service_role ON public.shipments
  FOR SELECT TO service_role
  USING (true);

CREATE POLICY shipment_items_select_service_role ON public.shipment_items
  FOR SELECT TO service_role
  USING (true);

COMMENT ON POLICY shipments_select_service_role ON public.shipments IS
  'M-4b 片3a(Sean 2026-08-26 拍乙):把後台對 shipments 的讀取寫成顯性政策。'
  '在此之前靠 service_role 的 BYPASSRLS —— 平台角色屬性、repo 內無法驗證。'
  '🔴 只有 SELECT 是刻意的:寫全部走 SECURITY DEFINER 的 RPC(shipment-repository.ts:101 :123 :143 :158 :172),'
  '而 GRANT 面也只有 SELECT(20260805170000:277)⇒ 政策面 = GRANT 面 = 實際動作面。加寫入政策是憑空擴權。'
  '🔴 【apply 當下】不擴權, 而那不是永久保證 —— 之後被授予 service_role 的角色會一起套到。'
  '🔴 沒有關掉同族問題:補到 3 張, 還剩 39 張。';

COMMENT ON POLICY shipment_items_select_service_role ON public.shipment_items IS
  'M-4b 片3a:與 shipments 那條同一組、同一個理由(GRANT 面 20260805170200:254 也只有 SELECT)。';

-- ── 段C · 逐條逐項驗 ────────────────────────────────────────────────────────
-- 形狀照片2(codex 2026-08-26 must-fix 5):不是問「有沒有一條 permissive SELECT」——
-- 那樣的話把 `USING (false)` 寫進去五格會全過而實讀永遠零列。⇒ 對具名政策逐項驗。
DO $$
DECLARE
  r       record;
  n_restr int;
  n_hit   int := 0;
  expect  text[][] := ARRAY[
    ARRAY['shipments',      'shipments_select_service_role'],
    ARRAY['shipment_items', 'shipment_items_select_service_role']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(expect, 1) LOOP
    SELECT p.cmd AS cmd, p.permissive AS permissive, p.roles AS roles,
           coalesce(p.qual, '') AS qual, coalesce(p.with_check, '') AS with_check
      INTO r
      FROM pg_catalog.pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = expect[i][1]
       AND p.policyname = expect[i][2];
    IF NOT FOUND THEN
      RAISE EXCEPTION '片3a 段C ①:查不到政策 % ⇒ CREATE 成功了而 catalog 撈不到, 兩者不一致', expect[i][2];
    END IF;
    IF r.permissive <> 'PERMISSIVE' THEN
      RAISE EXCEPTION '片3a 段C ②:% 是 % 不是 PERMISSIVE ⇒ 它不給權, 只會再收緊', expect[i][2], r.permissive;
    END IF;
    IF r.cmd <> 'SELECT' THEN
      RAISE EXCEPTION '片3a 段C ③:% 的 cmd 是 % 而不是 SELECT ⇒ 哪一項不對 = FOR 子句', expect[i][2], r.cmd;
    END IF;
    IF r.roles <> ARRAY['service_role']::name[] THEN
      RAISE EXCEPTION '片3a 段C ④:% 的 roles 是 [%] 而不是恰好 {service_role} ⇒ 哪一項不對 = TO 子句',
        expect[i][2], array_to_string(r.roles, ',');
    END IF;
    IF r.qual <> 'true' THEN
      RAISE EXCEPTION '片3a 段C ⑤:% 的 USING 是 [%] 而不是 true ⇒ 政策在、角色對, 而它【看不到任何一列】',
        expect[i][2], coalesce(nullif(r.qual, ''), '(無)');
    END IF;

    -- ⑥ 有沒有 RESTRICTIVE 也套到 service_role(訊息不下結論:本片沒有檢查它們的 qual)
    SELECT count(*) INTO n_restr
      FROM pg_catalog.pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = expect[i][1]
       AND p.permissive = 'RESTRICTIVE' AND p.cmd IN ('SELECT', 'ALL')
       AND ('service_role' = ANY (p.roles) OR 'public' = ANY (p.roles));
    IF n_restr > 0 THEN
      RAISE EXCEPTION '片3a 段C ⑥:% 有 % 條 RESTRICTIVE 政策也套到 service_role ⇒ 本片的 permissive 那條是對的, 而它【可能】被縮限。本片沒有檢查那幾條的 qual ⇒ 請人工看一眼',
        expect[i][1], n_restr;
    END IF;

    -- ⑦ GRANT 那一層 —— 它塌掉的長相是【報錯】不是【空的】
    -- codex 2026-08-26 must-fix 6:不用 information_schema(它依執行者的 enabled role 過濾 ⇒ 誤擋)。
    IF NOT pg_catalog.has_table_privilege('service_role', 'public.' || expect[i][1], 'SELECT') THEN
      RAISE EXCEPTION '片3a 段C ⑦:service_role 對 % 沒有 SELECT 的有效權限 ⇒ GRANT 層塌, 線上長相是【報錯】不是【空的】', expect[i][1];
    END IF;

    n_hit := n_hit + 1;
  END LOOP;
  IF n_hit <> 2 THEN
    RAISE EXCEPTION '片3a 段C:只驗到 % 條而不是 2 條 ⇒ 迴圈本身壞了', n_hit;
  END IF;

  -- ⑧ 尺自檢:負對照。少了這一格, 一把【接錯表、對任何東西都回空】的尺會讓上面全部「通過」。
  IF (SELECT count(*) FROM pg_catalog.pg_policies
       WHERE schemaname = 'public' AND tablename IN ('shipments', 'shipment_items')
         AND policyname = 'zzz_no_such_policy_20260826') <> 0 THEN
    RAISE EXCEPTION '片3a 段C ⑧ 負對照失敗:查一條不存在的政策名而回了非 0 ⇒ 這把尺會無中生有, 上面全部作廢';
  END IF;

  RAISE NOTICE '片3a PASS:兩條政策逐項驗過(cmd / permissive / roles 恰為 {service_role} / qual=true), RESTRICTIVE 0 條, service_role 的 SELECT 有效權限都在';
END $$;

COMMIT;
