-- ═══════════════════════════════════════════════════════════════════════════
--  B1-c(舊稱 B2-seed)· 把【兩個】真人塞進 admin_user_staff_map
--
--  🔴 檔名裡的 `b2-seed` 是舊稱,**不要據它推論這支屬於母 plan 的 B2** ——
--     母 plan 的 `B2` 是【登入認人】(`…-real-auth-line-plan-v4.md:187`),完全是另一件事。
--     本支是 B1 的第三步:B1-a 停用 test_01 / B1-b 建表 / **B1-c 塞人**。
--     檔名不改的理由:已被 commit body、triage、兩封信與規格多處指到,改名只換來好看。
--     (2026-08-18 codex 關卡1 R5 標【最貴】的那條:代號撞名 ⇒ 交接者可能把 seed 完成誤當登入認人完成。)
--  🔴 「三個」是舊字面:現實是**兩個**(sean / staff_2,都是 Sean 本人);`staff_1` 刻意不綁。
--
--  🔴🔴 這是【草稿】,而且它比 B1-b 那支更不能直接跑 ——
--     **2026-08-16 已填入真值(兩個,不是三個 —— 見 §0 DECLARE 那段的理由)。**
--     ⚠️ 下一次要加人時複製本檔,**記得換 uuid**;檔內有一道斷言會擋住忘記換的情況。
--     沒換就跑 = 前提斷言會擋下來(那正是它存在的目的)。
--
--  · 規格:docs/specs/2026-08-16-m4b-e8b-b1-spec.md §2「三列資料誰塞、什麼時候塞」
--  · 前置:B1-b 那支已 apply(表與 trigger 存在)
--  · 為什麼不能併進 B1-b:auth_user_id 要等 Sean 開完帳號才存在,
--    而 B1-b 是在那之前跑的 ⇒ 建表時那張表必然是空的。
--  · apply 管道:MCP apply_migration,【需要 Sean 在場】
--
--  🔴 這支是「寫入端唯一入口」(規格 §2 (c) 案)。
--     日後加人 = 再一支這種 migration + 一支 ALTER 改 CHECK 白名單,
--     **同一支檔、同一次 review** —— 那就是白名單方案的代價與價值。
--  🔴 Sean 2026-08-16 拍板:代號永不重用。新人拿新代號(staff_3…),不撿空出來的。
--
--  ── 🔴🔴 出事怎麼退 —— **這支的退場被【B1-b 自己建的保護】擋著** ──────────
--     `DELETE` 會被 `admin_user_staff_map_no_delete_trg` 擋下,而 service_role 也沒有 DELETE 權。
--     ⛔ ~~要退 seed,照這個順序(每一步都要有人看著):三步 DISABLE → DELETE → ENABLE~~
--     🔴🔴 **2026-08-18 改寫(codex 關卡1 R3,角度=災難當天可用性,兩條 must-fix)**:
--        原本那三步 **①沒有交易包覆 ②沒有預期列數 ③沒有驗 trigger 有沒有回來**。
--        codex 逐字:「DELETE 後若斷線或 ENABLE 失敗,資料已刪且 trigger 永久停用」、
--        「刪到 0／1 列或忘做第三步,都沒有成功條件會紅」。**兩條都屬實。**
--        ⇒ 原本靠「每一步都要有人看著」+ 一句「第 3 步不可省」在守 ——
--          **那是把機制寫成提醒,而提醒在半夜退場的時候最不管用。**
--        ⇒ 改成一整段 **交易 + 列數斷言 + trigger 狀態斷言**,整段貼上去跑:
--
--        BEGIN;
--        ALTER TABLE public.admin_user_staff_map DISABLE TRIGGER admin_user_staff_map_no_delete_trg;
--        WITH d AS (
--          DELETE FROM public.admin_user_staff_map WHERE staff_id IN ('sean','staff_2') RETURNING 1
--        )
--        SELECT CASE WHEN count(*) = 2 THEN true
--                    ELSE (SELECT 1/0 > 0) END AS ok_two_rows FROM d;
--        -- ⬆ 刪到的不是 2 列就當場 division_by_zero 中止(**不要改成 RAISE NOTICE**:
--        --   通知不會擋住 COMMIT,而這一步錯了就是刪錯東西)
--        ALTER TABLE public.admin_user_staff_map ENABLE  TRIGGER admin_user_staff_map_no_delete_trg;
--        DO $$
--        BEGIN
--          IF NOT EXISTS (
--            SELECT 1 FROM pg_trigger
--             WHERE tgrelid = to_regclass('public.admin_user_staff_map')
--               AND tgname  = 'admin_user_staff_map_no_delete_trg'
--               AND tgenabled = 'O'
--          -- 🔴 2026-08-18(codex R4):⛔ ~~`tgenabled <> 'D'`~~ —— `'R'`(replica)在**一般連線下等同停用**,
--          --    而 `<> 'D'` 會放它過。要的是 `'O'`(origin,預設啟用)。
--          --    📎 形狀:**用「不是壞的那個值」判,會漏掉你沒想到的壞值;用「就是好的那個值」判才封閉。**
--          ) THEN
--            RAISE EXCEPTION '退 seed:no_delete_trg 沒有回到啟用狀態,拒 COMMIT。';
--          END IF;
--        END $$;
--        COMMIT;
--
--     🔴 **交易包覆才是那條「第 3 步不可省」的機制版**:中途斷線 ⇒ 整段回滾 ⇒
--        列還在、trigger 也還在,**回到一個一致的狀態**,而不是「刪了一半、保護關著」。
--     ⚠️ 誠實邊界:`ALTER TABLE … DISABLE TRIGGER` 在 PG 裡**是交易性的**(可回滾),
--        本段的正確性依賴這一點 —— **這句是我從 PG 的 DDL 交易性推的,不是實測的**;
--        退場當天請先在拋棄式庫跑一次同一段(它不需要真資料,建兩列假的即可)。
--     ⚠️ 這個退場成本是作者刻意造的(禁 DELETE 是為了擋重綁),**不是意外**。
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
--  殘餘風險 R3-A2 · 「這顆 uuid 屬於這個 email」證不到「這個 email 屬於誰」
--  (2026-08-18 折入,codex 關卡1 R3 角度=假設審查;**不改行為,寫下來**)
--
--  codex 逐字:「規格防止刪除 Auth user,卻沒防 email、密碼或帳號持有人被換掉;
--  UUID 不變時稽核身分可靜默換人。」
--
--  · 0.3 那道(uuid ↔ email 成對)擋住的是【貼錯 uuid】。
--  · 它擋不住的是:有人到 Supabase Auth 後台把 `shopee1@partscheaper.net` 這個帳號的
--    email 改掉、或把密碼改掉交給另一個人 ⇒ **uuid 沒變 ⇒ 這裡的每一道斷言都還是綠的**,
--    而 `admin_audit_log.actor` 從此把新的人記成 `staff_2`。
--  · 🔴 **它不是這支 migration 修得掉的東西** —— 修法住在「誰能進 Supabase Auth 後台」,
--    而那是 Sean 一個人。⇒ 現階段的緩解 = **開帳號 / 改帳號一律由 Sean 本人做**(現況就是如此)。
--  · ⚠️ 未來若有第二個人拿得到 Auth 後台權限,**這條就從殘餘風險變成真缺口**,
--    那時要補的是「auth.users 變更的稽核」,不是這裡再加一道斷言。
--  📎 判別句:**我的斷言綁在一個【識別碼】上,而那個識別碼背後的【人】可以被換掉嗎?**
-- ═══════════════════════════════════════════════════════════════════════════

-- 🔴 位置說明:本段原本寫在檔尾 `COMMIT;` 之後,而 `scripts/migration-static-checks.sh`
--    的第 ② 道要求「結束交易恰好 1 次且在最後一行」⇒ 當場紅。
--    註解確實不會被執行,**而那道守門分不出註解與語句 —— 它也不該分**(要分就得剖析 SQL)。
--    ⇒ 搬到這裡,不去動守門。📎 想改守門讓自己變綠 = `~/.claude/rules/00-work-rules.md` R4 的立即停止訊號。

BEGIN;

-- 🔴 固定 search_path(同 B1-b)
SET LOCAL search_path = pg_catalog, public, auth;

-- ───────────────────────────────────────────────────────────────────────────
--  0. 前提斷言
-- ───────────────────────────────────────────────────────────────────────────
DO $seed_precheck$
DECLARE
  -- ✅ 2026-08-16 已填入真值(Sean 貼回 auth.users 的 id)。
  --    🔴 **兩列不是三列** —— 現實只有兩個帳號,而它們都是 Sean 本人:
  --       sean@pcmmotorsports.com  → 'sean'    (管理者身分)
  --       shopee1@partscheaper.net → 'staff_2' (一般員工權限測試,label 已在 B1-a 更正)
  --    ⚠️ `staff_1` **不綁** —— 它有 17 筆舊紀錄,而那些紀錄產生於「操作者可自選」的時代
  --       (見 A 庫 staff 表的 COMMENT)。選一個零紀錄的代號,不需要靠任何人的記憶。
  --    ⚠️ 真的有第二個員工進來時,他拿【新代號 staff_3】,那時再補一支這種 migration。
  v_sean    uuid := 'f5fb22ee-29f8-4af9-83b8-7fc9121eb533';  -- sean@pcmmotorsports.com
  v_staff_2 uuid := '63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f';  -- shopee1@partscheaper.net
  v_missing text;
  v_acl_bad text;
  v_acl_col_bad text;
  v_existing bigint;
BEGIN
  -- 0.1 B1-b 必須已經跑過,**而且那張表還是 B1-b 建出來的那個版本**
  --     🔴 關卡2 [中] finding:只驗「同名 relation 存在」不夠 ——
  --        兩支之間若有人改了 CHECK / trigger / RLS,B2 仍會成功寫入,而 S1-S4 看不到那個漂移。
  IF to_regclass('public.admin_user_staff_map') IS NULL THEN
    RAISE EXCEPTION E'B2-seed 前提斷言:找不到 public.admin_user_staff_map。\n'
      '   ⇒ B1-b 那支還沒 apply,或你連到了錯的資料庫。';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = to_regclass('public.admin_user_staff_map')
                    AND conname  = 'admin_user_staff_map_staff_whitelist') THEN
    RAISE EXCEPTION 'B2-seed 前提斷言:CHECK 白名單約束不見了。表被改過,拒繼續。';
  END IF;

  -- 🔴🔴 2026-08-18 補(codex 關卡1 R3,角度=回歸與權限面)。codex 逐字:
  --    「B2 自稱確認『仍是 B1-b 的版本』,但沒重驗 ACL 與零 policy;兩支之間若重開 anon 權限
  --      並加 permissive policy,真人映射會被塞進已外露的表。」**屬實。**
  --    ⇒ B1-b 的收權斷言只在【它 apply 的那一刻】成立;B1-b 與 B2 之間隔著人與時間。
  --      **而 B2 才是把【真人身分】放進去的那一支** —— 表外露的代價在 B2 之後才變成真的。
  --    📎 這條與本檔既有的「0.1 只驗同名 relation 存在不夠」是同一個病的兩半:
  --      前者問「還是不是那張表」,這裡問「它的門還關著嗎」。
  IF NOT EXISTS (SELECT 1 FROM pg_class
                  WHERE oid = to_regclass('public.admin_user_staff_map') AND relrowsecurity) THEN
    RAISE EXCEPTION E'B2-seed 前提斷言:admin_user_staff_map 的 RLS 沒有開著。\n'
      '   ⇒ 「RLS 開 + 零 policy = default deny」是這張表唯一的門。拒把真人身分放進一張敞開的表。';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'admin_user_staff_map') THEN
    RAISE EXCEPTION E'B2-seed 前提斷言:這張表上出現了 policy(B1-b apply 時是零 policy)。\n'
      '   ⇒ 有人在兩支之間開了一條路。先看那條 policy 讓誰讀得到什麼,再決定要不要 seed。';
  END IF;

  -- 🔴🔴 2026-08-18 改寫(codex 關卡1 R4,角度=折入自己製造的新面)。codex 逐字:
  --    「R3 新增的 ACL 陣列只列七項、漏掉 PG17 的 `MAINTAIN`;授給 anon 後 B2 仍綠。」**屬實。**
  --    ⇒ 我昨天才在 B1-b 那支檔裡讀過「**枚舉的集合比世界窄**」這句話,然後在這裡手寫了一份七項清單。
  --    ⇒ 改成**從 acldefault() 推導**(與 B1-b 同一個做法)—— 世界有哪些權限型別由 PG 自己說,
  --      **沒有數字寫在註解裡,就沒有會漂的數字**。
  SELECT string_agg(format('%s:%s', r, d.privilege_type), ', ') INTO v_acl_bad
    FROM unnest(ARRAY['anon','authenticated']) AS r
    CROSS JOIN LATERAL (
      SELECT DISTINCT a.privilege_type
        FROM pg_class oc
        CROSS JOIN LATERAL aclexplode(acldefault('r', oc.relowner)) a
       WHERE oc.oid = to_regclass('public.admin_user_staff_map')
    ) d
   WHERE has_table_privilege(r, to_regclass('public.admin_user_staff_map'), d.privilege_type);

  -- 🔴🔴 2026-08-18 codex R5 標【折錯】:上一輪我把「權限型別」改成推導了,
  --    **而問法還是只有 `has_table_privilege`** —— 欄級授權(`GRANT SELECT (staff_id) …`)
  --    在表級那一問回 `f` ⇒ **B2 假綠,而 anon 讀得到那一欄**。
  --    📎 B1-b 那支檔早就分成【表級一圈 + 欄級一圈】兩段,而我抄了它的「推導」沒抄它的「兩圈」。
  --    ⇒ 補上欄級這一圈。PG 只允許四種欄級授權,**故意具名**(與 B1-b 同一個理由:
  --       DELETE/TRUNCATE/TRIGGER/MAINTAIN 沒有欄級形式,寫進來反而會誤紅)。
  SELECT string_agg(format('%s:欄級 %s', r, c), ', ') INTO v_acl_col_bad
    FROM unnest(ARRAY['anon','authenticated']) AS r
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS c
   WHERE has_any_column_privilege(r, to_regclass('public.admin_user_staff_map'), c);

  IF v_acl_bad IS NOT NULL OR v_acl_col_bad IS NOT NULL THEN
    RAISE EXCEPTION E'B2-seed 前提斷言:anon / authenticated 對這張表仍有權限(表級:% / 欄級:%)。\n'
      '   ⇒ anon 是 storefront 印在訪客瀏覽器裡的公開角色。拒繼續。',
      COALESCE(v_acl_bad, '無'), COALESCE(v_acl_col_bad, '無');
  END IF;

  -- 🔴 對照組:service_role 必須【有 SELECT】。三道全紅的世界(整張表誰都碰不到)
  --    會讓上面三道一起變成恆真 —— 那時 seed 進去也沒有人讀得到,報價單登入照樣壞。
  -- 🔴 2026-08-18 補(codex R4):B1-b 的設計【承重在 service_role 有 BYPASSRLS】
  --    (RLS 開 + 零 policy ⇒ 沒有 BYPASSRLS 的 service_role 一列都讀不到)。
  --    兩支之間若有人撤掉它,**B2 照樣 seed 成功、而登入永遠讀不到映射** —— 那是「事後才發現」的形狀。
  -- 🔴🔴 2026-08-18 補(codex 關卡1 R5,角度=本機綠正式庫不綠):
  --    B1-b 檔內寫著「緩解已經下在 B2-seed 的前提斷言裡(它會印出當下角色與缺哪個權限)」
  --    —— codex 逐字:「實檔沒有」。**屬實:那是一句【我宣稱有、而實際沒寫】的話。**
  --    ⇒ 現在真的加上去。失敗世界:`apply_migration` 若不是以表 owner 連線,
  --      下面的 INSERT 會回一句乾巴巴的 permission denied,而讀的人不會知道那是【管道問題】。
  IF NOT pg_catalog.has_table_privilege(current_user, to_regclass('public.admin_user_staff_map'), 'INSERT') THEN
    RAISE EXCEPTION E'B1-c 前提斷言:目前角色(current_user = %)對 admin_user_staff_map 沒有 INSERT 權。\n'
      '   ⇒ 這不是資料問題,是【誰在跑這支】的問題。\n'
      '   ⇒ B1-b 刻意只給 service_role SELECT(寫入端唯一入口 = migration 本身,以表 owner 執行)。\n'
      '   ⇒ 正常管道 = MCP apply_migration 走 postgres(= 本表 owner)。走到這裡代表管道不同,\n'
      '      請改回正常管道;若確定要改管道,那要先改 B1-b 的授權設計,不是在這裡放寬。', current_user;
  END IF;

  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION E'B2-seed 前提斷言:service_role 沒有 BYPASSRLS(B1-b apply 當時是有的)。\n'
      '   ⇒ 本表是「RLS 開 + 零 policy」,沒有 BYPASSRLS ⇒ 報價單登入查映射會回 0 列,而不是報錯。\n'
      '   ⇒ 先確認是誰改的,再決定要不要改走明文 policy。拒繼續。';
  END IF;

  -- 🔴 2026-08-18 補(codex R5 角度 4·下游繼承):B1-b 的「service_role 沒有任何寫入權」
  --    只在 B1-b apply 那一刻成立,而**下游(B2 登入認人 / B5)會把「migration 是唯一寫入端」當成既成事實**。
  --    ⇒ 在真人身分放進去之前,再問一次。
  SELECT string_agg(p, ', ') INTO v_acl_bad
    FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) AS p
   WHERE has_table_privilege('service_role', to_regclass('public.admin_user_staff_map'), p);
  IF v_acl_bad IS NOT NULL THEN
    RAISE EXCEPTION E'B2-seed 前提斷言:service_role 又拿到寫入權了(%)。\n'
      '   ⇒ B1-b 之後有人加了 GRANT。「寫入端唯一入口 = migration」在權限層已經不成立,\n'
      '      而下游會把它當成既成事實。拒把真人身分放進去。', v_acl_bad;
  END IF;

  IF NOT has_table_privilege('service_role', to_regclass('public.admin_user_staff_map'), 'SELECT') THEN
    RAISE EXCEPTION E'B2-seed 前提斷言:service_role 連 SELECT 都沒有 —— 上面三道權限斷言在這種世界裡是恆真的。\n'
      '   ⇒ 先確認 B1-b 的 GRANT SELECT 真的下去了。';
  END IF;
  -- 📌 codex 第四輪 [nit]「這道被 0.6 蓋掉了、可刪」—— **不採納,理由記在這裡**:
  --    0.6 確實也會紅,但它紅出來的話是「擋不住 test_01」⇒ 讀的人會去找【約束的內容】被改了什麼。
  --    而真相是【整個約束不見了】,該做的是把它加回來。**兩種紅指向不同的修法**,
  --    而這條線的原則就是「失敗的位置決定下一個人會去改什麼」⇒ 留著它換一句精準的診斷。
  -- 🔴 2026-08-17 B 窗審 B2 抓到:上面那句註解寫「有人改了 CHECK / trigger / RLS」,
  --    而原版**三道 trigger 只檢查了 no_delete 一道** —— no_truncate / no_rebind 零檢查。
  --    ⇒ 有人把「禁 TRUNCATE」或「禁重綁」拆掉,B2 照樣成功寫入,而沒有任何東西會說。
  --    📎 這是 B1-b 檔內 :191 那句「**同一個理由,我只套了兩個動詞**」的第三次 ——
  --       那次是 DELETE/TRUNCATE 有 trigger 而 UPDATE 沒有,這次是斷言只驗了三道裡的一道。
  --    ⇒ 逐一列名檢查,不用 count(*) —— count 對得上不代表**是這三道**。
  --
  -- 🔴🔴 codex 對抗審查 2026-08-17 [must-fix]:上一版只驗【名字在不在】。
  --    · `tgenabled = 'D'`(被停用)⇒ pg_trigger 那一列**還在**,而 trigger **不會跑**。
  --      🔴 這不是假想的路徑 —— **本檔檔頭 :23-26 的退場程序第 1 步就是 `DISABLE TRIGGER`**,
  --        而第 3 步(重新 ENABLE)那裡自己寫著「忘了它,那張表從此沒有保護,
  --        而【沒有任何東西會提醒你】」。⇒ 這道斷言本來正是那個「提醒你」的東西,而它看不見。
  --    · 綁到別的函式 ⇒ 名字對、行為換掉。⇒ 一起驗 tgfoid。
  --
  -- 🔴🔴 codex 對抗審查【第二輪】2026-08-17 [must-fix] —— 我上一版的修法是**半套的**:
  --    · 我寫 `tgenabled <> 'D'`,而 `tgenabled` 有四個值:
  --      `O`=正常 / `D`=停用 / `R`=**只在 replica 模式下觸發** / `A`=一律觸發。
  --      ⇒ `ALTER TABLE … ENABLE REPLICA TRIGGER x` 把它設成 `R`,
  --        **正常操作下它跟停用一模一樣不會跑**,而我的 `<> 'D'` 讓它過。
  --      📎 形狀:我窮舉了「開 / 關」兩個狀態,而這個欄位有四個。**又一次「只想到自己想得到的維度」。**
  --      ⇒ 改成白名單 `IN ('O','A')` —— 列出【可接受的】,而不是排除【想得到的壞的】。
  --    · 事件型別(tgtype)上一版我標成「誠實邊界不補」,codex 判 must-fix 而它是對的:
  --      同一個函式改掛成 `BEFORE INSERT`,名字與函式都對得上,而禁刪根本沒在守。
  --      成本是一欄比對,不是「構造不出來」⇒ 我原本的成本理由不成立。
  --      🔴 tgtype 的值是**當場量的**(拋棄式 PG 17.10 跑完 B1-b 後查 pg_trigger),不是我算的:
  --         no_delete=11(ROW|BEFORE|DELETE) / no_rebind=19(ROW|BEFORE|UPDATE) / no_truncate=34(BEFORE|TRUNCATE)
  DECLARE
    v_trg text;
  BEGIN
    SELECT string_agg(t.want, ', ') INTO v_trg
      FROM (VALUES ('admin_user_staff_map_no_delete_trg',   'public.admin_user_staff_map_no_delete',   11::smallint),
                   ('admin_user_staff_map_no_truncate_trg', 'public.admin_user_staff_map_no_truncate', 34::smallint),
                   ('admin_user_staff_map_no_rebind_trg',   'public.admin_user_staff_map_no_rebind',   19::smallint))
             AS t(want, fn, ttype)
     WHERE NOT EXISTS (SELECT 1 FROM pg_trigger g
                        WHERE g.tgrelid   = to_regclass('public.admin_user_staff_map')
                          AND g.tgname    = t.want
                          AND NOT g.tgisinternal
                          AND g.tgenabled IN ('O', 'A')
                          AND g.tgtype    = t.ttype
                          AND g.tgfoid    = to_regproc(t.fn));
    IF v_trg IS NOT NULL THEN
      RAISE EXCEPTION E'B2-seed 前提斷言:這些保護 trigger 不見了、被停用、或綁到別的函式:%\n'
        '   ⇒ 表被改過(no_delete=禁刪 / no_truncate=禁清空 / no_rebind=禁改識別欄),拒繼續。\n'
        '   ⚠️ 「不見了」與「還在但 tgenabled=D」是兩件事,這句話涵蓋兩者 —— 去查 pg_trigger 看是哪一種。', v_trg;
    END IF;
  END;
  -- ⛔ 2026-08-18 移除(codex 關卡1 R4 nit,角度=斷言之間的相依):
  --    ~~IF NOT (SELECT relrowsecurity …) THEN RAISE '前提斷言:RLS 沒開'~~
  --    我在 R3 折 D2 的時候,在**同一個 DO 區塊的更前面**已經加了一道 RLS 斷言,
  --    而兩者之間沒有任何會改變 RLS 的語句 ⇒ **這一道永遠到不了失敗分支 = 恆真。**
  --    📎 恆真的斷言比沒有斷言更糟:它讓人以為那一面有守。留這段字說明它去哪了,不留那行 code。

  -- 0.2 🔴 佔位符沒換就停 —— 這一道的存在就是為了擋「照抄草稿直接跑」
  --     ⚠️ 這道現在【應該不會觸發】(2026-08-16 已填真值),但**不移除** ——
  --        它是給「下一次要加人時複製這支檔」的人的,而那個人最可能忘記換。
  IF v_sean::text    LIKE '00000000-0000-0000-0000-%'
  OR v_staff_2::text LIKE '00000000-0000-0000-0000-%' THEN
    RAISE EXCEPTION E'B2-seed:uuid 還是草稿裡的佔位符,沒有換成真值。\n'
      '   ⇒ 先在 Supabase 後台開帳號,把 auth.users.id 貼回來,再改這支檔。';
  END IF;

  -- 0.3 兩個 uuid 都必須真的存在於 auth.users,**而且屬於指定的那個 email**
  --     🔴 不靠 FK 報錯 —— FK 的訊息不會告訴你「是哪一個人的帳號沒開」
  --
  --  🔴🔴 2026-08-18 更正(codex 關卡1 R3,角度=假設審查)。codex 逐字:
  --     「UUID 只驗『存在』,沒驗屬於指定 email;貼到另一個既有帳號時,所有斷言仍綠並綁錯人。」
  --     **屬實,而且這正是這支檔最貴的失敗**:綁錯人不會有任何東西紅,
  --     它會安靜地讓 `admin_audit_log.actor` 從此指向錯的人 —— 而這條線的全部目的就是那一欄。
  --     ⇒ 改成【uuid 與 email 成對比對】。email 是人看得懂的那半,uuid 是機器用的那半,
  --        **貼錯的時候兩者會對不起來**,而只驗 uuid 的世界裡它們永遠對得起來。
  --     ⚠️ 射程限定:這道證的是「這顆 uuid 今天屬於這個 email」。
  --        **它證不到「這個 email 今天屬於誰」** —— 見檔尾殘餘風險 R3-A2。
  SELECT string_agg(format('%s (預期 email=%s)', x.id::text, x.email), E'\n     ') INTO v_missing
    FROM (VALUES (v_sean, 'sean@pcmmotorsports.com'), (v_staff_2, 'shopee1@partscheaper.net')) AS x(id, email)
   WHERE NOT EXISTS (
           SELECT 1 FROM auth.users u
            WHERE u.id = x.id AND lower(u.email) = lower(x.email)
         );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION E'B2-seed:下列 uuid 在 auth.users 裡【找不到,或它的 email 不是預期的那個】:\n     %\n'
      '   ⇒ 三種可能:①帳號還沒開 ②uuid 貼錯(貼到另一個真的存在的帳號)③那個帳號的 email 被改過。\n'
      '   ⇒ 三種都不可以繼續 —— 綁錯人之後【沒有任何東西會紅】。', v_missing;
  END IF;

  -- 0.4 兩個必須互不相同(貼錯時最容易發生的錯:同一個 uuid 貼了兩次)
  --     ⚠️ 這兩個帳號【是同一個人的兩個信箱】,但 uuid 必須不同 ——
  --        它們是兩個不同的 auth user,只是背後是同一個人。
  IF v_sean = v_staff_2 THEN
    RAISE EXCEPTION 'B2-seed:兩個 uuid 相同 —— 貼的時候複製到同一個了。拒繼續。';
  END IF;

  -- 0.5 🔴 這張表必須是空的。非空 = 有人已經塞過,而本支是「唯一入口」
  --     ⇒ 重跑會撞 PK/UNIQUE,但那個錯訊不會說明「你在重複做一件只該做一次的事」
  SELECT count(*) INTO v_existing FROM public.admin_user_staff_map;
  IF v_existing <> 0 THEN
    RAISE EXCEPTION E'B2-seed:admin_user_staff_map 已經有 % 列,不是空的。\n'
      '   ⇒ 本支是【只該跑一次】的 seeding。\n'
      '   🔴 先分清楚你在哪一種情況(codex R4:原訊息只寫「要加人請另寫一支」,\n'
      '      而【上一次 apply 成功但台帳沒登、你正在重跑】的人照著它做會建出一支錯的 migration):\n'
      '      (a) 台帳【沒有】這支、而表已經有這兩列 ⇒ 上次其實成功了,只是沒登記\n'
      '          ⇒ 正解是【補登台帳】,不是另寫 migration,也不是重跑。\n'
      '      (b) 台帳【有】這支、你只是想加人 ⇒ 另寫一支新的 seeding + 一支 ALTER 改白名單。\n'
      '      ⇒ 分辨法:去看台帳裡有沒有這支的版本號。', v_existing;
  END IF;

  -- 0.6 🔴🔴 CHECK 白名單要【真的擋得住】,不是【名字還在】
  --     codex 對抗審查 2026-08-17 [must-fix]:0.1 那道只比對 conname。
  --     ⇒ 有人把它 DROP 掉再用**同一個名字**加回 `CHECK (true)`,0.1 完全看不見,
  --       而白名單是「誰這輩子綁得了帳號」的那道線 —— 它形同虛設而全綠。
  --     ⚠️ 為什麼不用 `pg_get_constraintdef` 掃字面:`CHECK (staff_id IN (…) OR true)`
  --        字面上三個名字都在、掃得到,而它照樣恆真。**字面檢查在這裡有洞,行為檢查沒有。**
  --     ⇒ 拿 `test_01`(明確不該能登入的那個)當探針,插進去【必須被擋】。
  --        探針跑在 0.5 之後 ⇒ 表保證是空的 ⇒ 不會撞 PK,也不會留下任何一列。
  --     🔴🔴 codex 對抗審查【第二輪】[must-fix]:光看「有沒有 check_violation」會被【遮蔽】——
  --        白名單被掏空之後,只要表上**任何另一道 CHECK** 也擋下這一列,探針就看到 check_violation
  --        而下結論「白名單還好好的」。⇒ 必須問【是哪一道約束擋的】,不是【有沒有被擋】。
  --        📎 母題:錯的那次和對的那次長得一樣(`docs/patterns/guard-and-instrument-traps.md`)。
  --
  -- 🔴🔴 codex【第四輪】[must-fix]:上一版只拿 `test_01` 一個代號當探針。
  --    ⇒ 同名的 `CHECK (staff_id <> 'test_01')` **通得過探針**,而它放行【其他任意代號】。
  --      「擋得住 test_01」比「白名單完好」**寬得多**,而我把前者寫成了後者。
  --    ⇒ 兩道一起下:①定義裡三個名字都要在 ②兩個非白名單代號都要被【白名單本人】擋下。
  --
  -- ⚠️🔴 **誠實邊界(這三道加起來仍證不到的事)**:證不了白名單是【恰好】那三個。
  --    例:`IN ('sean','staff_1','staff_2','x9')` 三道全過,而 `x9` 綁得了帳號。
  --    我窮舉過的維度:①單一 session 邏輯 ②時間/並發 ③突變改檔 ④權限/角色 ⑤schema 漂移
  --    ⇒ 在 ③ 之下它**構造得出來**,所以這是【判別力上限】不是【構造不出來】。
  --    要證「恰好」得比對 `pg_get_constraintdef` 全等字面,而那會隨 PG 版本的排版變動誤紅
  --    ⇒ **選擇不做**,理由是誤紅會在 apply 當天把 Sean 擋在門外(見 0.7 同一個取捨)。
  DECLARE
    v_leaked boolean := false;
    v_cname  text;
    v_def    text;
    v_probe  text;
  BEGIN
    SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
     WHERE conrelid = to_regclass('public.admin_user_staff_map')
       AND conname  = 'admin_user_staff_map_staff_whitelist';
    IF v_def IS NULL
       OR position('''sean'''    in v_def) = 0
       OR position('''staff_1''' in v_def) = 0
       OR position('''staff_2''' in v_def) = 0 THEN
      RAISE EXCEPTION E'B2-seed 前提斷言:白名單的定義裡少了 sean / staff_1 / staff_2 其中之一。\n'
        '   實際定義:%\n   ⇒ 名單被縮掉了。拒繼續。', COALESCE(v_def, '(查無此約束)');
    END IF;

    -- 🔴🔴 2026-08-18 補(codex 關卡1 R3,角度=測試假綠)。
    --    上面三道證「這三個名字在裡面」,**證不到「只有這三個」** ——
    --    本檔 :171 附近的誠實邊界自己也寫了:`IN ('sean','staff_1','staff_2','x9')` 三道全過。
    --    codex R3 逐字把它從「已知邊界」升成 must-fix:**「白名單恰好三人」目前沒有斷言保護。**
    --    ⇒ 補一道**數【被單引號括起來的字面有幾個】**的檢查。
    --    ✅ 為什麼這道不會像「全等字面比對」那樣誤紅:它不看排版、不看 `::text`、不看 `ANY(ARRAY[…])`
    --       還是 `IN (…)`,只數引號 —— **PG 版本改排版不會改變字面的顆數**。
    --    ⚠️ 仍然證不到的:名字被換掉(例 'sean','staff_1','x9' 也是三顆)。
    --       那一半由上面三道 position() 蓋住 ⇒ **兩道加起來才是「恰好這三個」**,
    --       單獨任何一道都不是。
    IF (length(v_def) - length(replace(v_def, '''', ''))) / 2 <> 3 THEN
      RAISE EXCEPTION E'B2-seed 前提斷言:白名單裡的字面有 % 個,預期恰好 3。\n'
        '   實際定義:%\n'
        '   ⇒ 有人往名單裡加了東西(或 PG 把定義印成了我沒預期的形狀)。兩種都停下來看。',
        (length(v_def) - length(replace(v_def, '''', ''))) / 2, v_def;
    END IF;

    FOREACH v_probe IN ARRAY ARRAY['test_01', 'b2_probe_not_whitelisted'] LOOP
      v_leaked := false;
      BEGIN
        INSERT INTO public.admin_user_staff_map (auth_user_id, staff_id) VALUES (v_sean, v_probe);
        v_leaked := true;   -- 插得進去 = 白名單沒在擋
      EXCEPTION
        WHEN check_violation THEN
          GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
          IF v_cname IS DISTINCT FROM 'admin_user_staff_map_staff_whitelist' THEN
            RAISE EXCEPTION E'B2-seed 前提斷言:擋下 % 的是【%】,不是白名單。\n'
              '   ⇒ 白名單可能已被掏空,而另一道約束剛好也擋下這一列 ⇒ 探針被【遮蔽】了。\n'
              '   ⇒ 這種情況下不可以 seed:白名單是「誰綁得了帳號」那道線,它的狀態現在是未知的。',
              v_probe, COALESCE(v_cname, '(約束名為空)');
          END IF;
          -- ✅ 走到這裡才是預期:被【白名單本人】擋下
        WHEN OTHERS THEN
          RAISE EXCEPTION E'B2-seed 前提斷言:白名單探針(%)出現【非預期】錯誤(% / %)。\n'
            '   ⇒ 預期是 check_violation。紅在別的地方 = 這道探針測到的不是白名單,拒繼續。',
            v_probe, SQLSTATE, SQLERRM;
      END;
      IF v_leaked THEN
        RAISE EXCEPTION E'B2-seed 前提斷言:CHECK 白名單擋不住 % —— 它已經形同虛設。\n'
          '   ⇒ 約束名字還在,但內容被改過(例如換成 CHECK (true),或只擋了 test_01 一個)。\n'
          '   ⇒ 白名單是「誰綁得了帳號」的那道線,它壞掉時不可以 seed。拒繼續。', v_probe;
      END IF;
    END LOOP;
  END;

  -- 0.7 🔴🔴 codex 對抗審查【第三輪 · 換模型 gpt-5.6-sol · 換角度「沒說出口的前提」】[must-fix]
  --     上面 0.1 驗了 tgname / tgenabled / tgtype / tgfoid 四樣,而它們**全都是綁定的元資料**。
  --     🔴 `CREATE OR REPLACE FUNCTION` **不換 OID** ⇒ 有人把函式本體換成 `BEGIN RETURN NEW; END`,
  --        `tgfoid` 一個位元都沒變、四道檢查全綠,而三道保護**全部形同虛設**。
  --     ⇒ 唯一測得出來的方法是**真的去做那個動作,看它擋不擋**。
  --     · TRUNCATE 是 statement-level ⇒ 空表也會觸發 ⇒ 這一道現在就能測。
  --     · DELETE / UPDATE 是 row-level ⇒ 空表不觸發 ⇒ **那兩道搬到 §2、INSERT 之後測**。
  --     ⚠️ 一樣要問【是誰擋的】不是【有沒有被擋】(第二輪的遮蔽教訓):比對錯誤訊息的特徵字。
  --     ⚠️🔴 **這道探針要求跑它的角色是表的 owner**(code-reviewer 2026-08-17 [nit]):
  --        `TRUNCATE` 不是 B1-b 授出去的權限(那裡只 GRANT SELECT, INSERT 給 service_role)
  --        ⇒ 非 owner 角色會拿到 42501 insufficient_privilege ⇒ 掉進下面的 `WHEN OTHERS` ⇒ **誤紅**。
  --        今天不發作的理由:apply 管道 = MCP `apply_migration`,它走 `postgres`(=本表 owner)。
  --        ⇒ **換管道跑這支之前先確認角色是 owner**,否則一切正常的世界也裝不上去。
  --
  -- 🔴🔴 codex【第四輪 · 換角度「質疑框架本身」】[must-fix]:上一版用**錯誤訊息的字**認人。
  --    ⇒ 有人只改了 trigger 的文案(保護完全正常),**apply 當天三個探針全部誤紅、Sean 裝不上去**。
  --    📎 這是第二輪修法的反作用:為了關「遮蔽」而把診斷字串變成 apply 的前提。
  --    ⇒ 改用 `PG_EXCEPTION_CONTEXT` 認【是哪個函式丟的】—— 認身分,不認措辭。
  DECLARE
    v_leaked boolean := false;
    v_ctx    text;
  BEGIN
    BEGIN
      TRUNCATE public.admin_user_staff_map;
      v_leaked := true;
    EXCEPTION
      WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS v_ctx = PG_EXCEPTION_CONTEXT;
        IF position('admin_user_staff_map_no_truncate()' in COALESCE(v_ctx, '')) = 0 THEN
          RAISE EXCEPTION E'B2-seed 前提斷言:TRUNCATE 被擋下了,但丟例外的不是 no_truncate。\n'
            '   呼叫堆疊:%\n   ⇒ 保護的狀態是未知的,拒繼續。', COALESCE(v_ctx, '(無 context)');
        END IF;
      WHEN insufficient_privilege THEN
        -- 🔴 2026-08-18 補(codex R5 `[不確定]`,角度=本機綠正式庫不綠):
        --    上面那段註解已經寫了「非 owner ⇒ 42501 ⇒ 掉進 WHEN OTHERS ⇒ 誤紅」,
        --    **而它只寫在註解裡** —— 真的發生時,Sean 看到的是一句「非預期錯誤」。
        --    ⇒ 明捕它,並把【它不是保護失效】與【該怎麼辦】寫進訊息本身。
        --    ⚠️ 這裡仍然是紅的:探針測不到 ≠ 保護還在。**不放行,但要讓人知道往哪走。**
        RAISE EXCEPTION E'B2-seed 前提斷言:TRUNCATE 探針【權限不足】(42501),不是保護失效。\n'
          '   ⇒ 跑這支的角色(current_user = %)不是本表的 owner,而 TRUNCATE 不在 B1-b 授出去的權限裡。\n'
          '   ⇒ 這代表【這道探針測不到 no_truncate】,不代表 no_truncate 壞了 —— 兩者不可混為一談。\n'
          '   ⇒ 正常管道(MCP apply_migration 走 postgres = 本表 owner)不會走到這裡;\n'
          '      走到了 = 你換了管道。請改回正常管道,或先確認角色是 owner。', current_user;
      WHEN OTHERS THEN
        RAISE EXCEPTION E'B2-seed 前提斷言:TRUNCATE 探針出現【非預期】錯誤(% / % / current_user=%)。拒繼續。',
          SQLSTATE, SQLERRM, current_user;
    END;
    IF v_leaked THEN
      RAISE EXCEPTION E'B2-seed 前提斷言:TRUNCATE 沒有被擋下 —— no_truncate 的【函式本體】已被掏空。\n'
        '   ⇒ trigger 還掛著、OID 也沒變(CREATE OR REPLACE 不換 OID),所以元資料檢查看不見。\n'
        '   ⇒ 這張表現在可以被一句話清空,而清空之後稽核軌對不到任何人。拒繼續。';
    END IF;
  END;

  RAISE NOTICE 'B2-seed 前提斷言通過:表在且形狀正確、三道 trigger 都活著、白名單與禁 TRUNCATE 實測擋得住、兩個 uuid 存在且互異、表為空。';
END
$seed_precheck$;

-- ───────────────────────────────────────────────────────────────────────────
--  1. 兩列
--     🔴 uuid 在本檔出現【三段各兩處,共六處】,改的時候六處都要改:
--        ① §0 DECLARE(斷言用)② 下面 INSERT(真的寫入)③ 落地斷言的精確配對字串
--        量法(🔴 必須剝註解,否則【這一行自己會被數進去】—— 偵測字串自命中):
--          sed 's/--.*$//' <本檔> | grep -c '<其中一個 uuid>'   ⇒ 每個 uuid 各 3 次
--        ⚠️ 漏改③ ⇒ 拿真 uuid 比舊字面 ⇒ **會紅**,方向是安全的,
--           但你會看到一個看起來像「配對錯了」的錯誤,而真因是你漏改了斷言。
--     📎 這個重複是刻意的:斷言若與 INSERT 共用同一個變數,它就變成「驗自己」。
--     ⚠️ 這個重複是刻意的:斷言若共用同一個變數,它就變成「驗自己」。
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO public.admin_user_staff_map (auth_user_id, staff_id) VALUES
  ('f5fb22ee-29f8-4af9-83b8-7fc9121eb533', 'sean'),      -- sean@pcmmotorsports.com
  ('63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f', 'staff_2');   -- shopee1@partscheaper.net

-- ───────────────────────────────────────────────────────────────────────────
--  2. 落地斷言 —— 驗【結果】不是驗「INSERT 執行了」
-- ───────────────────────────────────────────────────────────────────────────
DO $seed_verify$
DECLARE
  v_n bigint;
  v_ids text;
BEGIN
  SELECT count(*) INTO v_n FROM public.admin_user_staff_map;
  IF v_n <> 2 THEN
    RAISE EXCEPTION E'B2-seed 落地斷言:預期 2 列,實際 % 列。\n'
      '   ⚠️ 是 2 不是 3 —— 現實只有兩個 Auth 帳號,而 staff_1 刻意不綁(見檔頭)。', v_n;
  END IF;

  -- 🔴🔴 關卡2 [高] finding:只驗 staff_id 的【集合】不夠 ——
  --    兩個 uuid 對調之後,集合一樣是 sean,staff_2,**驗收仍全綠**,
  --    而每個人拿到的是【別人的身分】。⇒ 必須驗【精確配對】。
  --    ⚠️ 本例兩個帳號都是 Sean 本人 ⇒ 對調的後果是「管理者與一般員工權限對調」,
  --       那正好會讓他測不出他想測的東西,而且不會有任何東西紅。
  SELECT string_agg(auth_user_id::text || '=' || staff_id, ',' ORDER BY staff_id) INTO v_ids
    FROM public.admin_user_staff_map;
  -- 🔴 `IS DISTINCT FROM` 不是 `<>`(2026-08-17 B 窗審 B2):
  --    v_ids 若為 NULL,`NULL <> '…'` 得 NULL ⇒ IF 走 false ⇒ **這道斷言不會叫**。
  --    今天靠上面 v_n<>2 先擋住所以觸發不到,但那是「另一道斷言剛好在前面」,不是本道自己安全。
  --    📎 同形狀已在 B1-a 上真的發生過(SELECT…INTO 無 STRICT ⇒ 綠著漏掉 staff_2 的指派)。
  IF v_ids IS DISTINCT FROM ('f5fb22ee-29f8-4af9-83b8-7fc9121eb533=sean,'
                           ||'63f0e9c6-d8c1-4f0d-ad8a-d924f0da0e2f=staff_2') THEN
    RAISE EXCEPTION E'B2-seed 落地斷言:配對不符。\n   實際:%\n'
      '   🔴 有【兩種】成因,不要只往第一種找(codex R4:原訊息只寫「對調」,\n'
      '      而照它去把兩個其實正確的帳號交換,會製造出真正的綁錯):\n'
      '      (a) 兩個 uuid 貼的順序跟人對不起來(對調)\n'
      '      (b) 本檔有【三份】硬編碼的期望值(§0 DECLARE / INSERT / 本斷言字串),\n'
      '          換人時只改了其中兩份 ⇒ 表裡是對的,而【這道斷言的期望值是舊的】\n'
      '      ⇒ 分辨法:先拿實際值去對 auth.users 的 email,再決定要改表還是改本檔。\n'
      '   🔴 這一條驗的是【誰對到誰】,不是【有哪幾個人】—— 後者對調之後仍然會過。', v_ids;
  END IF;

  -- ⛔ 2026-08-17 刪掉的斷言(codex 第四輪 [nit],成立):
  --    原本這裡有一道「表裡不可以出現 op4_backfill / payment_confirmer / test_01」。
  --    它**永遠走不到** —— 上面那道精確配對已經把表的內容釘死成【恰好那兩列、恰好那兩個 uuid】,
  --    任何第三列都會先讓 v_n<>2 或配對字串不符而紅。
  --    🔴 保留一個永遠不會叫的斷言,下一個人會把它讀成「這件事有人在守」,而其實守它的是別人。
  --    ⇒ 刪掉;真正在守「系統帳號綁不了」的是 **0.6 的白名單行為探針**(那道會叫、也有負測 S15/S18)。

  -- 🔴🔴 codex 第三輪 [must-fix] 的另外兩半 —— 見 §0.7 的說明,同一個病:
  --    `CREATE OR REPLACE FUNCTION` 不換 OID ⇒ no_delete / no_rebind 被掏空時元資料全綠。
  --    這兩道是 row-level,空表不觸發 ⇒ 只能在【有列之後】測,所以放在這裡。
  --    ⚠️ 兩個探針都跑在子交易裡:被擋下 ⇒ 子交易回滾、什麼都沒變;
  --       沒被擋下 ⇒ 設旗標後 RAISE ⇒ 整支 migration 回滾,那兩列也不會留下。**方向是安全的。**
  --    ⚠️ 「整支回滾」這句的承重前提是本檔自己的 `BEGIN;`(檔首)與 `COMMIT;`(檔尾),
  --       **那兩行不在任何一次 diff 裡,所以很容易被當成環境給的**(code-reviewer 2026-08-17 [nit])。
  --       而檔頭寫的 apply 管道 MCP `apply_migration` 自己也會開交易 ⇒ 檔尾的 `COMMIT;` 會先關掉外層。
  --       今天結果仍是全有全無(COMMIT 之後這支檔沒有東西了),但**換管道時要重新確認這一點**。
  --    🔴 codex【第四輪】[must-fix]:認人一律用 `PG_EXCEPTION_CONTEXT`(函式身分),
  --       **不用 SQLERRM 的字** —— 只改文案而保護正常的世界,不可以讓 apply 失敗。
  DECLARE
    v_del_ok boolean := false;
    v_upd_ok boolean := false;
    v_ctx    text;
    v_who    text;
  BEGIN
    -- 🔴🔴 2026-08-18 重寫(codex 關卡1 R3 C3/C4;**而重寫的形狀是【拋棄式 PG 突變實測】決定的**)
    --
    --  原版:DELETE 只打 `sean`、UPDATE 只改 `staff_id` ⇒ 一支只保護一半的函式照樣全綠。
    --  我的第一版修法:DELETE 改成不帶 WHERE 打全表 —— **那個修法是錯的,而且錯得很像對的**:
    --     `BEFORE DELETE FOR EACH ROW` 只要有【任何一列】被擋,整句就中止
    --     ⇒ 一支「只保護 sean」的函式,打全表照樣被擋 ⇒ **探針還是綠的**。
    --     📌 我是在拋棄式 PG 上跑突變才看到這件事的,**讀 SQL 讀不出來** ——
    --        「整句中止」與「每列都被擋」在探針眼裡是同一個結果。
    --  ⇒ 正解:**每一列、每一個識別欄,各打一次**。分母寫在迴圈裡,不寫在註解裡。
    --  ⛔ ~~⚠️ 分母限定:這裡列的是本支 seed 的兩個代號。日後加人 ⇒ 這個陣列要跟著加~~
    --  🔴🔴 2026-08-18 再改(codex 關卡1 R4,角度=折入自己製造的新面):
    --     我把「只打一列」修成「打兩列」,而修法是**寫死一份兩個名字的陣列** ——
    --     codex 逐字:「新迴圈把涵蓋列寫成另一份手工陣列;複製本檔新增員工時若忘記同步,
    --     新增列的 DELETE／兩種 UPDATE 保護完全沒被探測且全綠。」**屬實。**
    --     ⇒ 我在修「清單比世界窄」的時候,造了一份新的清單。⇒ 改成**從表自己撈**。
    --     ✅ 這樣「涵蓋率」永遠等於「表裡有幾列」,加人不必記得改這裡。
    --     ⚠️ 仍然的射程上限:表是空的時候這個迴圈跑 0 次(而 0.5/v_n<>2 已經先擋住空表)。
    FOR v_who IN SELECT staff_id FROM public.admin_user_staff_map ORDER BY staff_id LOOP

      -- ① 這一列刪得掉嗎(no_delete)
      v_del_ok := false;
      BEGIN
        DELETE FROM public.admin_user_staff_map WHERE staff_id = v_who;
        v_del_ok := true;
      EXCEPTION
        WHEN raise_exception THEN
          GET STACKED DIAGNOSTICS v_ctx = PG_EXCEPTION_CONTEXT;
          IF position('admin_user_staff_map_no_delete()' in COALESCE(v_ctx, '')) = 0 THEN
            RAISE EXCEPTION E'B2-seed 落地斷言:DELETE(%)被擋下了,但丟例外的不是 no_delete。\n   呼叫堆疊:%\n   ⇒ 拒繼續。',
              v_who, COALESCE(v_ctx, '(無 context)');
          END IF;
        WHEN foreign_key_violation THEN
          -- 🔴 2026-08-18 補(codex R4 `[不確定]`,與 UPDATE 那半同形):
          --    `BEFORE DELETE` 的 trigger 比 FK 檢查早跑 ⇒ 走到 FK 才被擋 = **no_delete 已經放行**。
          --    今天沒有任何外鍵參照本表 ⇒ 這條走不到;而**「今天走不到」不是「以後走不到」**,
          --    寫在這裡的成本是三行,漏寫的代價是一句誤導的診斷。
          RAISE EXCEPTION E'B2-seed 落地斷言:DELETE(%)是被【外鍵】擋下的,不是 no_delete。\n'
            '   ⇒ BEFORE trigger 比 FK 早跑 ⇒ no_delete 對這一列已經失效,只是剛好有別的東西接住。拒繼續。', v_who;
        WHEN OTHERS THEN
          RAISE EXCEPTION E'B2-seed 落地斷言:DELETE(%)探針出現【非預期】錯誤(% / %)。拒繼續。', v_who, SQLSTATE, SQLERRM;
      END;
      IF v_del_ok THEN
        RAISE EXCEPTION E'B2-seed 落地斷言:DELETE(%)沒有被擋下 —— no_delete 對這一列失效。\n'
          '   ⇒ 代號可以被刪掉再重綁到另一個人,而歷史稽核的解讀會跟著翻轉、零訊號。拒繼續。', v_who;
      END IF;

      -- ② 這一列的 staff_id 改得掉嗎(no_rebind 的第一個條件)
      v_upd_ok := false;
      BEGIN
        UPDATE public.admin_user_staff_map SET staff_id = staff_id || '_x' WHERE staff_id = v_who;
        v_upd_ok := true;
      EXCEPTION
        WHEN raise_exception THEN
          GET STACKED DIAGNOSTICS v_ctx = PG_EXCEPTION_CONTEXT;
          IF position('admin_user_staff_map_no_rebind()' in COALESCE(v_ctx, '')) = 0 THEN
            RAISE EXCEPTION E'B2-seed 落地斷言:UPDATE(%.staff_id)被擋下了,但丟例外的不是 no_rebind。\n   呼叫堆疊:%\n   ⇒ 拒繼續。',
              v_who, COALESCE(v_ctx, '(無 context)');
          END IF;
        WHEN OTHERS THEN
          -- ⚠️ 這裡【刻意】不把 check_violation 當成「有擋到」——
          --    白名單擋下 'sean_x' 的話,no_rebind 有沒有失效仍然未知,而那正是本探針要問的事。
          RAISE EXCEPTION E'B2-seed 落地斷言:UPDATE(%.staff_id)探針出現【非預期】錯誤(% / %)。\n'
            '   ⇒ 預期是 no_rebind 丟的 raise_exception。紅在別的地方 = 這道探針測到的不是 no_rebind,拒繼續。',
            v_who, SQLSTATE, SQLERRM;
      END;
      IF v_upd_ok THEN
        RAISE EXCEPTION E'B2-seed 落地斷言:UPDATE(%.staff_id)沒有被擋下 —— no_rebind 對這一列失效。\n'
          '   ⇒ 識別欄可以直接改掉 = 與「刪掉再新增」完全相同的重綁效果。拒繼續。', v_who;
      END IF;

      -- ③ 這一列的 auth_user_id 改得掉嗎(no_rebind 的第二個條件)
      --    🔴 codex R3 C4 逐字:「函式若仍擋 staff_id、但放行 auth_user_id 重綁,
      --       元資料與行為探針都會綠。」**只餵一個條件的探針,只證得到一個條件。**
      v_upd_ok := false;
      BEGIN
        UPDATE public.admin_user_staff_map
           SET auth_user_id = '00000000-0000-0000-0000-000000000001'
         WHERE staff_id = v_who;
        v_upd_ok := true;
      EXCEPTION
        WHEN raise_exception THEN
          GET STACKED DIAGNOSTICS v_ctx = PG_EXCEPTION_CONTEXT;
          IF position('admin_user_staff_map_no_rebind()' in COALESCE(v_ctx, '')) = 0 THEN
            RAISE EXCEPTION E'B2-seed 落地斷言:UPDATE(%.auth_user_id)被擋下了,但丟例外的不是 no_rebind。\n   呼叫堆疊:%\n   ⇒ 拒繼續。',
              v_who, COALESCE(v_ctx, '(無 context)');
          END IF;
        WHEN foreign_key_violation THEN
          -- 🔴 2026-08-18 突變實測後改寫(原本這條走 WHEN OTHERS,紅得對、**訊息卻在誤導**)。
          --    `BEFORE UPDATE` 的 trigger **比 FK 檢查早跑** ⇒ 走到 FK 才被擋,
          --    代表 **no_rebind 那一關已經放行了** —— 這不是「未知」,這是【確定失效】。
          --    ⚠️ 實測形狀:把 no_rebind 改成只看 staff_id,這一格原本印「探針出現非預期錯誤」,
          --       讀的人會去查探針,而真正壞掉的是那支函式。**紅在對的地方,說錯了原因。**
          RAISE EXCEPTION E'B2-seed 落地斷言:UPDATE(%.auth_user_id)是被【外鍵】擋下的,不是 no_rebind。\n'
            '   ⇒ BEFORE trigger 比 FK 早跑 ⇒ no_rebind 已經放行了這次重綁,只是剛好撞到不存在的 uuid。\n'
            '   ⇒ no_rebind 對 auth_user_id 這一半【失效】。拒繼續。', v_who;
        WHEN OTHERS THEN
          RAISE EXCEPTION E'B2-seed 落地斷言:UPDATE(%.auth_user_id)探針出現【非預期】錯誤(% / %)。\n'
            '   ⇒ 預期是 no_rebind 丟的 raise_exception。拒繼續。', v_who, SQLSTATE, SQLERRM;
      END;
      IF v_upd_ok THEN
        RAISE EXCEPTION E'B2-seed 落地斷言:UPDATE(%.auth_user_id)沒有被擋下 —— no_rebind 只守住了一半。\n'
          '   ⇒ 代號不動、而它背後的人被換掉 = 歷史稽核全部重新指向另一個人,且【零訊號】。拒繼續。', v_who;
      END IF;

    END LOOP;
  END;

  -- ⛔ 2026-08-17 B 窗審 B2 改掉的過期字面:原句寫「**3 列**、集合正確」——
  --    ① 列數是 **2** 不是 3(檔頭與上面 v_n<>2 都寫 2,只有這句沒跟著改)
  --    ② 驗的是【精確配對】不是【集合】—— 集合正確是舊版的說法,而舊版正是關卡2 [高] finding 打掉的那個
  --    🔴 這一行是 **apply 當天 Sean 在 log 裡會親眼看到的那句**,寫錯等於當場給他一個假的驗收結論。
  RAISE NOTICE '✅ B2-seed 落地斷言通過:2 列、每個 uuid 精確配對到人、無不該登入的帳號。';
END
$seed_verify$;

COMMIT;
