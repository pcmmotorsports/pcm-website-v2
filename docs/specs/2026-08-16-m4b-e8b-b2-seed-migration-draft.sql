-- ═══════════════════════════════════════════════════════════════════════════
--  B2-seed · 把三個真人塞進 admin_user_staff_map
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
--     要退 seed,照這個順序(每一步都要有人看著):
--       1. ALTER TABLE public.admin_user_staff_map DISABLE TRIGGER admin_user_staff_map_no_delete_trg;
--       2. DELETE FROM public.admin_user_staff_map WHERE staff_id IN ('sean','staff_2');
--       3. ALTER TABLE public.admin_user_staff_map ENABLE  TRIGGER admin_user_staff_map_no_delete_trg;
--     🔴 **第 3 步不可省** —— 忘了它,那張表從此沒有保護,而【沒有任何東西會提醒你】。
--     ⚠️ 這個退場成本是作者刻意造的(禁 DELETE 是為了擋重綁),**不是意外**。
-- ═══════════════════════════════════════════════════════════════════════════

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
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.admin_user_staff_map')) THEN
    RAISE EXCEPTION 'B2-seed 前提斷言:RLS 沒開。表被改過,拒繼續。';
  END IF;

  -- 0.2 🔴 佔位符沒換就停 —— 這一道的存在就是為了擋「照抄草稿直接跑」
  --     ⚠️ 這道現在【應該不會觸發】(2026-08-16 已填真值),但**不移除** ——
  --        它是給「下一次要加人時複製這支檔」的人的,而那個人最可能忘記換。
  IF v_sean::text    LIKE '00000000-0000-0000-0000-%'
  OR v_staff_2::text LIKE '00000000-0000-0000-0000-%' THEN
    RAISE EXCEPTION E'B2-seed:uuid 還是草稿裡的佔位符,沒有換成真值。\n'
      '   ⇒ 先在 Supabase 後台開帳號,把 auth.users.id 貼回來,再改這支檔。';
  END IF;

  -- 0.3 兩個 uuid 都必須真的存在於 auth.users
  --     🔴 不靠 FK 報錯 —— FK 的訊息不會告訴你「是哪一個人的帳號沒開」
  SELECT string_agg(x.id::text, ', ') INTO v_missing
    FROM (VALUES (v_sean), (v_staff_2)) AS x(id)
   WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x.id);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION E'B2-seed:這些 uuid 在 auth.users 裡找不到:%\n'
      '   ⇒ 那個帳號可能還沒開,或 uuid 貼錯了。', v_missing;
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
      '   ⇒ 本支是【只該跑一次】的 seeding。要加人請另寫一支,不要重跑這支。', v_existing;
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
      WHEN OTHERS THEN
        RAISE EXCEPTION E'B2-seed 前提斷言:TRUNCATE 探針出現【非預期】錯誤(% / %)。拒繼續。', SQLSTATE, SQLERRM;
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
      '   ⇒ 最可能的原因是兩個 uuid 貼的順序跟人對不起來(對調)。\n'
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
  BEGIN
    BEGIN
      DELETE FROM public.admin_user_staff_map WHERE staff_id = 'sean';
      v_del_ok := true;
    EXCEPTION
      WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS v_ctx = PG_EXCEPTION_CONTEXT;
        IF position('admin_user_staff_map_no_delete()' in COALESCE(v_ctx, '')) = 0 THEN
          RAISE EXCEPTION E'B2-seed 落地斷言:DELETE 被擋下了,但丟例外的不是 no_delete。\n   呼叫堆疊:%\n   ⇒ 拒繼續。',
            COALESCE(v_ctx, '(無 context)');
        END IF;
      WHEN OTHERS THEN
        RAISE EXCEPTION E'B2-seed 落地斷言:DELETE 探針出現【非預期】錯誤(% / %)。拒繼續。', SQLSTATE, SQLERRM;
    END;
    IF v_del_ok THEN
      RAISE EXCEPTION E'B2-seed 落地斷言:DELETE 沒有被擋下 —— no_delete 的【函式本體】已被掏空。\n'
        '   ⇒ 代號可以被刪掉再重綁到另一個人,而歷史稽核的解讀會跟著翻轉、零訊號。拒繼續。';
    END IF;

    BEGIN
      UPDATE public.admin_user_staff_map SET staff_id = 'staff_1' WHERE staff_id = 'sean';
      v_upd_ok := true;
    EXCEPTION
      WHEN raise_exception THEN
        GET STACKED DIAGNOSTICS v_ctx = PG_EXCEPTION_CONTEXT;
        IF position('admin_user_staff_map_no_rebind()' in COALESCE(v_ctx, '')) = 0 THEN
          RAISE EXCEPTION E'B2-seed 落地斷言:UPDATE 被擋下了,但丟例外的不是 no_rebind。\n   呼叫堆疊:%\n   ⇒ 拒繼續。',
            COALESCE(v_ctx, '(無 context)');
        END IF;
      WHEN OTHERS THEN
        RAISE EXCEPTION E'B2-seed 落地斷言:UPDATE 探針出現【非預期】錯誤(% / %)。拒繼續。', SQLSTATE, SQLERRM;
    END;
    IF v_upd_ok THEN
      RAISE EXCEPTION E'B2-seed 落地斷言:UPDATE 沒有被擋下 —— no_rebind 的【函式本體】已被掏空。\n'
        '   ⇒ 識別欄可以直接改掉 = 與「刪掉再新增」完全相同的重綁效果。拒繼續。';
    END IF;
  END;

  -- ⛔ 2026-08-17 B 窗審 B2 改掉的過期字面:原句寫「**3 列**、集合正確」——
  --    ① 列數是 **2** 不是 3(檔頭與上面 v_n<>2 都寫 2,只有這句沒跟著改)
  --    ② 驗的是【精確配對】不是【集合】—— 集合正確是舊版的說法,而舊版正是關卡2 [高] finding 打掉的那個
  --    🔴 這一行是 **apply 當天 Sean 在 log 裡會親眼看到的那句**,寫錯等於當場給他一個假的驗收結論。
  RAISE NOTICE '✅ B2-seed 落地斷言通過:2 列、每個 uuid 精確配對到人、無不該登入的帳號。';
END
$seed_verify$;

COMMIT;
