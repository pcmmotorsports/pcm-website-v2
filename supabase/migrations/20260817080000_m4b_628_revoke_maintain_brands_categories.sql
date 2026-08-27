-- ============================================================
-- M-4b `#628` · 收回 `anon` / `authenticated` 對 `brands` / `categories` 的 `MAINTAIN`
-- ============================================================
-- 來源 = E 窗資安稽核;證實依據 = Sean 2026-08-17 貼回的實測輸出(照抄,未重打):
--     | brands_maintain | categories_maintain |
--     | true            | true                |
--   ⇒ `anon` 確實仍持有這兩張表的 `MAINTAIN`。**這不是推論,是量到的。**
--   ⚠️ 但它只證明【那一刻的正式庫】。本支對正式庫重跑仍會重驗一次(見「冪等」段)。
--
-- ── 🔴 影響範圍:**不要放大** ──────────────────────────────────
--   `MAINTAIN` **不讀、不寫任何一列資料**。它給的是 VACUUM / ANALYZE / REINDEX /
--   CLUSTER / REFRESH MATVIEW / 部分 LOCK 模式。
--   ⇒ **這不是資料外洩,是資源面**(未授權者可對這兩張表發起吃 I/O 與拿重鎖的維運動作)。
--   ⇒ 嚴重度照 E 窗原判,**不因為「已證實」就升級**。
--
-- ── 🔴🔴 已寫未 apply 的東西現在有三支,apply 那天不要只跑一支 ────────
--   本支落地時,同狀態(code 已進 git、正式庫未生效)的還有 B 窗兩支:
--     supabase/migrations/20260817060000_e683_1_public_default_privileges_revoke.sql
--     supabase/migrations/20260817070000_m4b_231_3_sweeper_heartbeat.sql
--   ⚠️ 上面兩條路徑取自 `dev` 分支 `8cb69570`(commit 標題自述「兩支 migration 未 apply」);
--      **本分支 `customers` 裡沒有這兩個檔**(`ls supabase/migrations/ | grep '^202608170'` ⇒ 只有本支)
--      ⇒ 引用前請在 `dev` 上自己確認,不要拿本行當它們存在的唯一證據。
--   🔴 `20260817060000`(E683-1 預設授權收權)與本支是**同一個病的兩半**:
--      那支管【未來新建的物件不要自帶 anon 權限】,本支管【已經長出來的那兩張表】。
--      **只跑一支 = 只修一半。**
--
-- ── 為什麼是版本感知,不直接寫 REVOKE ────────────────────────────
--   `MAINTAIN` 是 **PG17 新增**的權限名。PG16 以下對這個名字回
--   `SQLSTATE 22023 unrecognized privilege type` ⇒ **apply 當下整支炸掉**。
--   ⚠️ 「PG16 會回 22023」照 `20260815020000:48-50` 的口徑,仍是**推論不是實測**
--      (本片作者也沒跑過 PG16)⇒ 版本開關是**保守處置**,不是已驗事實。
--   實測到的是:**PG 17.10 有這個權限名且 REVOKE 生效**(見下方負測與 `scripts/628-verify.sh`)。
--
-- ── 🔴🔴 本支【兩層都有】,而且兩層互相補不到對方 ────────────────────
--   ⚠️ **本檔第一版寫「負測是行為不是元資料」,那個講法已作廢**(codex R2 nit):
--   重排之後 `M1` 明確是**元資料層先紅**,再說「不是元資料」就與實作矛盾。
--   現行分工:
--     §2 元資料 —— 抓得到「能力經由 SET ROLE 存在但當下不生效」(行為層看不到),
--                  且排在前面可避免真的去跑 REINDEX。**列舉式:只擋想得到的來源。**
--     §3 行為   —— 抓得到「我們沒列舉到的授權途徑」(PG18 再加一種也照樣紅)。
--   仍然成立的那半:**元資料說得出「保護在」,說不出「保護還在」**
--   (2026-08-17 B 窗當天證過)⇒ **所以不能只留 §2。**
--   ⇒ §2 真的用 `anon` / `authenticated` 的身分去做一件**只有 MAINTAIN 才做得到的事**,
--      然後要求它**失敗**,而且**認 SQLSTATE 不認錯誤訊息措辭**
--      (認措辭的話,PG 改一次文案就會讓 apply 全數誤紅)。
--
-- ── 🔴 為什麼是 REINDEX,而不是更直覺的 ANALYZE(**這格是量到的,不是選的**)──
--   2026-08-17 本機 PG 17.10 拋棄式叢集實測,同一個動作在兩個世界各跑一次:
--     動作                 有 MAINTAIN      無 MAINTAIN     能不能當量具
--     REINDEX TABLE        OK               42501           ✅ 兩個世界不同
--     LOCK ... SHARE MODE  OK               42501           ✅（但依賴 anon 無 UPDATE/DELETE/TRUNCATE）
--     CLUSTER              42704            42501           ⚠️ 兩個世界【都炸】，只是碼不同
--     ANALYZE              OK               OK（只有 WARNING）❌ 兩個世界相同，零判別力
--   🔴 **`ANALYZE` 對沒權限的表是「WARNING + 跳過」,不是錯誤。**
--      ⚠️ 而它造成的症狀**與直覺相反**:本格的判定是「動作成功 ⇒ 還做得到 ⇒ RAISE」,
--      所以拿 ANALYZE 當動作會讓這一格 **恆紅**(連收乾淨的世界都 apply 不了),**不是恆綠**。
--      🔴 我對這一格猜錯過兩次(先猜恆綠、再猜啞掉),**兩次都被實跑打回** ——
--      恆綠與恆紅都是「沒有判別力」,但症狀相反。突變 M3 把這件事釘死。
--   🔴 **`CLUSTER` 在有權限的世界也會炸**(42704 無既有 clustered index)⇒ 只看「有沒有炸」會假綠。
--   ⇒ 選 `REINDEX`:語意無歧義(**owner 或 MAINTAIN**,無第三種來源),且兩個世界印不同的東西。
--   重現 = `scripts/628-verify.sh probe`。
--
-- ── ⚠️ 本支【單獨 apply 一次】證不了斷言有判別力 ────────────────────
--   §2 / §3 都只在 REVOKE **之後**跑 ⇒ 只看得到「無 MAINTAIN」那個世界。
--   **「該紅的會紅」在這裡沒有被表演。** 表演在 `scripts/628-verify.sh`(突變)。
--   🔴 **沒跑過那支之前,不要說「負測配好了」** —— 那只是「寫了一格」。
--   ✅ **已實跑(2026-08-18,本機 PG 17.10 拋棄式叢集):`PASS=32 FAIL=0`**,6 發突變:
--     M1 拿掉 REVOKE              ⇒ 紅在 §2c 元資料層 brands
--     M2 只收 brands 漏 categories ⇒ 紅的是 categories,且 brands 那半未誤報
--     M3 動作換成 ANALYZE(REVOKE 保留)⇒ **連正確的世界都紅** ⇒ 那個動作沒有判別力
--     M4 角色不存在                ⇒ 紅在「角色不存在」,不是別的原因
--     M5 抽掉 schema USAGE         ⇒ 紅在 §3b 歸因正控
--     M6 `pg_maintain` 成員資格     ⇒ 紅在 §2a;**並當場演出攻擊鏈成立**
--   🔴 **M6 是唯一直接證明「前兩層都綠而能力還在」的一格**:
--     元資料 false / 直接 REINDEX 42501 / **而 SET ROLE 之後 REINDEX 真的成功**。
--
-- ── 鎖與副作用 ──────────────────────────────────────────
--   §2(元資料)排在 §3(行為)**前面**是刻意的:權限還在的世界會**先在 §2 擋下**
--   ⇒ §3 的 `REINDEX` 只在「元資料說已收乾淨」時才跑 ⇒ 預期被拒 ⇒ 零副作用。
--   ⚠️ 「預期」不是保證 ⇒ §3 另加 `lock_timeout=2s` / `statement_timeout=15s`
--      界定萬一它真的開始跑的損害(codex R1-MF3:標準 REINDEX 會擋寫入)。
--
-- ── 🔴🔴 冪等與漂移:**本檔第一版在這裡寫了一句假的,已撤** ─────────────
--   ❌ 原文:「重跑不改變狀態,而『事後有人又 GRANT 回去』會被 §2 當場抓到。」
--   **那句不成立**(codex R1-MF2 擊破):`REVOKE` 排在斷言**前面**
--   ⇒ 重跑時漂移**會先被它自己修掉**,後面的斷言必然綠
--   ⇒ 🔴 **它不但抓不到漂移,還會【無聲地把漂移吃掉】** —— 比抓不到更糟,
--      因為跑完的人會覺得「全綠 = 一直都很乾淨」。
--   ⚠️ **而第二版的修法也只對了一半**(codex R3 換模型換角度擊破):
--   ❌ 我原本寫「之後任何一次重跑再印出來 = 有人把權限加回去了」——
--      **`supabase db push` 只跑【還沒套用】的 migration。這支成功之後就【不會再被執行】。**
--      ⇒ 🔴 **那個「之後重跑」在正常流程裡【根本不會發生】** ⇒ §0 偵測不到任何日後漂移。
--   ✅ **現在的正確講法(射程收到最小)**:
--      §0 的作用**只有一次**,就是 apply 當下把「修之前長什麼樣」印出來存證。
--      **它不是漂移偵測,一次也不是。** 漂移要靠**外部、可重跑**的東西:
--        · `./scripts/628-verify.sh drift`(對任一連線跑,不改狀態,只回報)
--        · 長期解 ⇒ 需要獨立的權限稽核排程,**本片不提供,已標為缺口**
--   ⇒ 冪等性本身仍然成立(REVOKE 對已無權限者是 no-op、其餘皆讀取),
--      **重跑安全,但正常流程不會重跑** —— 兩件事都要講,只講前者會誤導。
--
-- ── codex 對抗審查折法(2026-08-18 R1,`-s read-only`,結論 FAIL / 5 must-fix)──
--   [MF1] `INHERIT FALSE, SET TRUE` 加入 `pg_maintain` ⇒ 有效權限 false、REINDEX 也真的
--         回 42501,**而該角色仍可 `SET ROLE pg_maintain` 照做** ⇒ 前兩層都綠、能力還在。
--         ⇒ 新增 §2a/§2b,用 `pg_has_role(...,'MEMBER')`(**不是 `'USAGE'`** ——
--            USAGE 只看自動繼承,會漏掉整個 INHERIT FALSE 的世界)。
--   [MF2] 漂移探針宣稱不成立 ⇒ 見上一段,新增 §0 並撤回原句。
--   [MF3] REINDEX 無 timeout、且元資料守門排在後面 ⇒ 重排 §2/§3 + 加兩個 timeout。
--   [MF4] verify 的 M4(角色不存在)是**恆紅**:REVOKE 自己就先炸了,
--         原本的 `2-pre` 角色存在檢查**是死碼** ⇒ **已刪除**,M4 改驗它紅在哪。
--   [MF5] verify 的 `as_role` 把每個動作**跑了兩次**(前一次結果被丟棄)
--         ⇒ probe 表量到的是第二次 ⇒ 已修成單次。
--   🔴 MF1/MF2 兩條都是「**兩個世界印一樣的東西**」那一族,而**我自己跑的 22 格全綠**
--      —— 全綠只證明我想得到的那些情境都對,**證不到我沒想到的那一類**。
--
-- ── codex R2 折法(2026-08-18,同樣 FAIL / 5 must-fix + 3 nit)───────────
--   🔴🔴 [R2-MF1] **我對 MF1 的「已重現」是假證據。** 我用
--         `SET LOCAL ROLE anon` 之後再 `SET ROLE pg_maintain` ——
--         而 `SET ROLE` 的授權是拿 **session_user** 驗的,那時 session_user 仍是
--         **postgres(superuser)** ⇒ **不管 anon 有沒有權限都會成功。**
--         ⇒ 改用 `SET SESSION AUTHORIZATION`(psql 敘述層,DO 裡不能跑)重量,
--            **攻擊鏈確認成立**:REINDEX 真的做得動。**結論不變,而證據換過。**
--   [R2-MF2] `'MEMBER'` ≠ 可 SET ROLE。`SET FALSE` 的無害成員會被**恆紅**擋掉
--            ⇒ §2a/§2b 全改用 `pg_has_role(...,'SET')`。
--   [R2-MF3] §2b 只掃 `relacl` 的 MAINTAIN grantee ⇒ **漏掉 owner 這條路**
--            (owner 天生 REINDEX 得動,而 owner 不出現在 ACL 裡)⇒ 新增 §2b-1。
--   [R2-MF4] `statement_timeout` 寫在 DO **裡面**管不到正在執行的那個 DO
--            (它從命令抵達開始算)⇒ 兩個 timeout 移到 DO **外面**(§3-pre)。
--   [R2-MF5] verify 的 M4 分不出是 §0 還是 REVOKE 先炸 ⇒ 改成只宣稱它證得到的:
--            「死在原生 SQL、沒走到 #628 自訂斷言」。
--   nit:①檔頭「ANALYZE 永遠綠」與實測的**恆紅**矛盾 ②「4 個突變」實為 6
--        ③「負測是行為不是元資料」與重排後的實作矛盾 —— 三條皆為假字面,已改。
--   🔴 **兩輪的共同形狀**:我每一輪都「跑完全綠才交出去」,而兩輪都被抓到
--      **量具本身量錯東西**。**全綠是我的檢查通過了,不是世界是對的。**
--
-- ── 🔴🔴 apply 那天它紅了怎麼辦(**寫給非工程師的 Sean**;codex R3-MF2)────────
--   背景:Sean 貼回的那次輸出**只證明了一件事** —— `anon` 對這兩張表 MAINTAIN=true。
--   而本支斷言的東西比那多很多(authenticated、SELECT 還在、owner 拓樸、可 SET 的角色)。
--   ⇒ **任何一項與正式庫不符 ⇒ 整支 rollback**,而 Sean 拿到的只是一句技術錯誤。
--   ⇒ 所以先把分流寫在這裡。**整支是一個交易,紅了就是【什麼都沒改】,可以安全重跑。**
--
--   錯誤訊息裡有            意思                              下一步
--   ─────────────────────────────────────────────────────────────────
--   「角色 ... 不存在 /      正式庫沒有 anon 或 authenticated   停,把訊息貼回來。
--     does not exist」       (與我們的假設不同)                不要自己造角色。
--   「可 SET 成 ... owner」  某個 client 角色 SET 得成表 owner   停,貼回來。
--                            ⇒ 收 MAINTAIN 沒有用               這是拓樸問題,要重想。
--   「是 pg_maintain 的成員」同上,經由預定義角色              停,貼回來。
--   「SELECT ... 不見了」    本支誤殺了公開讀取                 停,貼回來。這是 bug。
--   「仍能對 ... 執行        元資料說收乾淨了,行為卻還做得到    停,貼回來。
--     REINDEX」              ⇒ 有我們沒想到的授權途徑
--   「歸因不到 MAINTAIN」    那個角色連 SELECT 都做不到          停,貼回來。
--                            ⇒ 正式庫權限與假設差很多
--   ─────────────────────────────────────────────────────────────────
--   🔴 **每一格的下一步都是「停下來貼回來」,沒有一格是「再試一次」。**
--      本支沒有任何「可以忽略」的紅。
--   ✅ **成功時**要回報的:`§0` 印的那行 `【要回報】... REVOKE 前仍有 MAINTAIN: ...`
--      —— 那是「修之前長什麼樣」的唯一存證,**而它只會出現這一次**。
--
-- ── 順序相依(與另外兩支未 apply 的 migration)────────────────────
--   `20260817060000`(E683-1 預設授權)/ `20260817070000`(sweeper 心跳表)/ 本支
--   ⇒ **三支之間沒有 SQL 順序相依**(codex R3 核過),各自獨立成交易。
--   ⚠️ 但**前面已成功的那幾支不會因為本支失敗而回滾** —— 別把三支想成一個交易。
--
-- ⚠️ **誠實界**:本片作者不碰正式庫。所有實測皆在本機拋棄式 PG 17.10。
--   🔴 **`PASS=32 FAIL=0` 不等於「正式 apply 已證」**(codex R3 明白指出):
--   本機基線是照 repo DDL 重建的**三欄節錄版**,它驗得了 REVOKE / REINDEX 的語意,
--   **驗不到**正式庫的 owner、grantor、完整索引、RLS、default ACL 與 Supabase 角色拓樸。
--   正式庫與這裡的期望不一致 ⇒ 上面會 RAISE,那是 fail-closed,是對的。
-- ============================================================

BEGIN;

-- ── 0. 🔴 漂移偵測(**必須排在 REVOKE 之前**;codex R1-MF2)────────────
--   ⚠️ 本檔第一版宣稱「重跑本支可當漂移探針」。**那句是假的,已撤。**
--   真因:REVOKE 排在斷言前面 ⇒ **重跑時漂移會先被它修掉**,後面的斷言必然綠
--        ⇒ 它**永遠不會回報**「有人事後又 GRANT 回去」。
--   🔴 這正是「一個檢查在【該紅】與【不該紅】兩個世界印一樣的東西」那一族。
--   ⇒ 修法:**在動手之前先看一眼並印出來**。
--   ⚠️ 這裡**只能 NOTICE 不能 EXCEPTION** —— 第一次 apply 時「還在」是正常的。
--      ⇒ **判別責任在讀的人身上**:第一次 apply 看到它=預期;
--        **之後任何一次重跑再看到它 = 有人把權限加回去了。**
--   🔴 **這一格對「自動防護」的貢獻是零**,它的價值完全取決於有沒有人讀那行輸出。
DO $$
DECLARE
  v_found text;
BEGIN
  IF current_setting('server_version_num')::int < 170000 THEN
    RETURN;
  END IF;
  SELECT string_agg(r || '@' || t, ', ' ORDER BY r, t) INTO v_found
    FROM (SELECT r, t FROM unnest(ARRAY['anon','authenticated']) r
            CROSS JOIN unnest(ARRAY['public.brands','public.categories']) t
           WHERE pg_catalog.has_table_privilege(r, t, 'MAINTAIN')) x;
  IF v_found IS NULL THEN
    RAISE NOTICE '#628 漂移偵測 — REVOKE 前已無 MAINTAIN(重跑時這是預期的乾淨狀態)';
  ELSE
    RAISE NOTICE '【要回報】#628 漂移偵測 — REVOKE 前仍有 MAINTAIN:%', v_found;
    RAISE NOTICE '【要回報】第一次 apply 看到這行=預期;重跑還看到=有人把權限加回去了。';
  END IF;
END
$$;

-- ── 1. 唯一的授權變更(版本感知)────────────────────────────────
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 170000 THEN
    EXECUTE 'REVOKE MAINTAIN ON TABLE public.brands, public.categories FROM anon, authenticated';
  ELSE
    RAISE NOTICE '#628 — server_version_num < 170000,無 MAINTAIN 權限名,本支整支 no-op';
  END IF;
END
$$;

-- ── 2. 元資料層(**排在行為層前面是刻意的**;codex R1-MF3)──────────
--   理由不是它比較重要,是**安全**:行為層會真的去跑 `REINDEX`。
--   若這裡就發現權限還在(＝那個 REINDEX 會【成功】的世界),
--   **先在這裡 fail-closed,就不必真的去重建一次索引、也不必拿 ACCESS EXCLUSIVE 鎖。**
--   ⇒ 排這個順序之後,行為層的 REINDEX **只在「元資料說已經收乾淨」時才跑**
--      ⇒ 預期它被拒 ⇒ 零副作用。
DO $$
DECLARE
  v_role text;
  v_tbl  text;
  v_via  text;
BEGIN
  IF current_setting('server_version_num')::int < 170000 THEN
    RETURN;
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP

    -- 2a. 🔴🔴 **可 SET 過去的角色成員資格**(codex R1-MF1)
    --   `has_table_privilege` 走的是**有效權限**,而 PG16+ 的成員資格可以是
    --   `INHERIT FALSE, SET TRUE` ⇒ **有效權限是 false、`REINDEX` 也真的回 42501**,
    --   但那個角色**仍然可以 `SET ROLE pg_maintain` 然後照做**。
    --   ⇒ 🔴 **前兩層(元資料 + 行為)在這個世界【都會綠】,而能力還在。**
    --   🔴 **用 `'SET'` 不用 `'MEMBER'`**(codex R2 擊破):`MEMBER` 只說「是成員」,
    --      而 PG16+ 的成員資格可以是 `SET FALSE` ⇒ 那種成員**SET 不過去、是無害的**,
    --      拿 MEMBER 當判準會把它**恆紅**擋掉。`'SET'` 才是「可不可以 SET 過去」。
    --      (`'USAGE'` 是第三個東西:只涵蓋自動繼承,那一半由 2c 的有效權限接。)
    IF pg_catalog.pg_has_role(v_role, 'pg_maintain', 'SET') THEN
      RAISE EXCEPTION
        '#628 異常 — % 是 pg_maintain 的成員(可 SET ROLE 過去),收表級 MAINTAIN 擋不住它;拒繼續',
        v_role;
    END IF;

    -- 2b. 同一個病的一般化:表上任何**還持有 MAINTAIN 的 grantee**,
    --     只要 client 角色 SET 得過去,收權就是白收。
    FOREACH v_tbl IN ARRAY ARRAY['public.brands', 'public.categories'] LOOP

      -- 2b-1. 🔴🔴 **owner 這條路 ACL 裡看不到**(codex R2 擊破)。
      --   `REINDEX` 的條件是「**owner 或 MAINTAIN**」,而 owner 的權力
      --   **不會出現在 `relacl` 裡** ⇒ 只掃 ACL 的 grantee 會整條漏掉。
      --   ⇒ 若 client 角色 SET 得成 owner,前面每一層都綠而它照樣 REINDEX 得動。
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                  WHERE c.oid = v_tbl::regclass
                    AND pg_catalog.pg_has_role(v_role, c.relowner, 'SET')) THEN
        RAISE EXCEPTION
          '#628 異常 — % 可 SET 成 % 的 owner(owner 天生就 REINDEX 得動,收 MAINTAIN 擋不住);拒繼續',
          v_role, v_tbl;
      END IF;

      SELECT string_agg(g, ', ' ORDER BY g) INTO v_via
        FROM (SELECT pg_catalog.pg_get_userbyid(a.grantee) AS g
                FROM pg_catalog.pg_class c
                CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
               WHERE c.oid = v_tbl::regclass
                 AND a.privilege_type = 'MAINTAIN'
                 -- 🔴 排除自己:每個角色都 SET 得成自己 ⇒ 不排掉的話,
                 --    「anon 自己有直接 MAINTAIN」會在這裡以「可 SET 成 [anon]」的
                 --    迂迴措辭報出來,而那是 2c 的職責、訊息也會誤導讀的人。
                 AND pg_catalog.pg_get_userbyid(a.grantee) <> v_role
                 AND pg_catalog.pg_has_role(v_role, a.grantee, 'SET')) y;
      IF v_via IS NOT NULL THEN
        RAISE EXCEPTION
          '#628 異常 — % 可 SET 成 [%],而它們對 % 仍持有 MAINTAIN;拒繼續',
          v_role, v_via, v_tbl;
      END IF;

      -- 2c. 有效權限(含自動繼承)必須為 false。
      IF pg_catalog.has_table_privilege(v_role, v_tbl, 'MAINTAIN') THEN
        RAISE EXCEPTION
          '#628 異常 — % 對 % 的有效 MAINTAIN 仍為 true;拒繼續', v_role, v_tbl;
      END IF;
    END LOOP;
  END LOOP;
END
$$;

-- ── 3-pre. 🔴 界定損害:timeout **必須設在 DO 外面**(codex R2 擊破)────────
--   `statement_timeout` 是**從命令抵達那一刻**開始算的 ⇒ 寫在 `DO` **裡面**
--   管不到**正在執行的那個 DO** ⇒ 第一版等於只設了 `lock_timeout`。
--   ⇒ 移到這裡當獨立敘述,下面那個 DO 才受它管。
--   ⚠️ `SET LOCAL` ⇒ 交易結束自動還原,不影響同一連線後續。
--   走到 §3 代表 §2 認為權限已收乾淨 ⇒ 下面的 REINDEX **預期會被拒、不會真的跑**;
--   但「預期」不是保證,不可以讓它無限等鎖或重建到天亮。
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

-- ── 3. 🔴 行為層(元資料看不到的那一半)────────────────────────
--   §2 是**列舉**式的:它只擋得住我們想得到的來源。
--   **PG18 若再多一種授權途徑,§2 會原樣放行,而 §3 不會** —— 它問的是
--   「**這個角色現在還做不做得到**」,不問「經由什麼」。
--   ⚠️ 反過來 §2 抓得到「能力經由 SET ROLE 存在但當下不生效」⇒ **兩層互補,不是重複。**
DO $$
DECLARE
  v_role     text;
  v_tbl      text;
  v_sqlstate text;
  v_ok       boolean;
BEGIN
  IF current_setting('server_version_num')::int < 170000 THEN
    RAISE NOTICE '#628 — PG < 17,行為層跳過(這個世界裡沒有 MAINTAIN 這個權限)';
    RETURN;
  END IF;

  -- 🔴 timeout 已在本 DO **外面**設好(見 §3-pre)—— 不要搬回這裡,搬回來就失效。
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_tbl IN ARRAY ARRAY['public.brands', 'public.categories'] LOOP

      EXECUTE format('SET LOCAL ROLE %I', v_role);

      -- 3a. 🔴 量具活性:身分真的換過去了嗎?
      --   若沒換成功,下面就是以 owner/superuser 身分在跑 ——
      --   **那個「失敗」會是假的,而它長得跟真的一模一樣。**
      IF current_user <> v_role THEN
        RESET ROLE;
        RAISE EXCEPTION
          '#628 異常 — SET LOCAL ROLE % 未生效(current_user=%);本格的成敗都不可信,拒繼續',
          v_role, current_user;
      END IF;

      -- 3b. 🔴🔴 **可歸因性正控** —— 2026-08-17 被自己的 harness 打臉補上的。
      --   病徵:M1(把 REVOKE 拿掉)本該讓下一格轉紅,**而它照樣綠**。
      --   真因:拋棄式庫裡 `anon` 連 schema `public` 的 `USAGE` 都沒有
      --         ⇒ `REINDEX` 回的 42501 是**「碰不到這個 schema」**,不是「沒有 MAINTAIN」。
      --   🔴 **同一個 SQLSTATE,不同的原因** ⇒ 那時它在兩個世界印一樣的東西 ⇒ **不是量具。**
      --   ⇒ 先證這個角色**現在碰得到這張表**,下一格的 42501 才歸因得到 MAINTAIN。
      --   ⚠️ 這一格也順便涵蓋 schema USAGE —— `has_table_privilege` **看不到 schema 層**。
      BEGIN
        EXECUTE format('SELECT 1 FROM %s LIMIT 1', v_tbl);
      EXCEPTION WHEN OTHERS THEN
        DECLARE v_s text := SQLSTATE; BEGIN
          RESET ROLE;
          RAISE EXCEPTION
            '#628 異常 — % 連 SELECT % 都做不到(SQLSTATE %);'
            '此時 REINDEX 的失敗【歸因不到 MAINTAIN】,負測失去判別力,拒繼續',
            v_role, v_tbl, v_s;
        END;
      END;

      -- 3c. 真的去做一件【只有 owner 或 MAINTAIN 才做得到】的事,要求它被拒。
      --   認 SQLSTATE 42501(insufficient_privilege),**不認訊息措辭**
      --   —— 認措辭的話,PG 改一次文案就會讓 apply 全數誤紅。
      --   ⚠️ 42501 本身**不足以歸因**,3b 才是讓它歸因得到 MAINTAIN 的那一格。
      v_ok := false;
      BEGIN
        EXECUTE format('REINDEX TABLE %s', v_tbl);
        v_ok := true;                       -- 沒炸 = 這個角色還做得到
      EXCEPTION WHEN OTHERS THEN
        v_sqlstate := SQLSTATE;
      END;

      RESET ROLE;

      IF v_ok THEN
        RAISE EXCEPTION
          '#628 異常 — % 仍能對 % 執行 REINDEX(元資料說已收乾淨,行為卻做得到);拒繼續',
          v_role, v_tbl;
      END IF;

      IF v_sqlstate <> '42501' THEN
        -- 🔴 炸了 ≠ 炸對地方。CLUSTER 那格的 42704 就是這個形狀:
        --    在【有權限】的世界也會炸,只看「有沒有炸」會假綠。
        --    ⚠️ 也涵蓋 55P03 lock_not_available —— 那代表它【真的開始跑了】,本身就是異常。
        --    🔴 但**不涵蓋 57014 statement_timeout**(codex R2 nit):
        --       `WHEN OTHERS` **抓不到 query_canceled** ⇒ 逾時會直接往上炸掉整支
        --       (fail-closed,是對的),不會走到這一格。**不要在註解裡宣稱它會。**
        RAISE EXCEPTION
          '#628 異常 — % 對 % 的 REINDEX 失敗於 SQLSTATE %(期望 42501 權限不足);'
          '這代表擋住它的不是權限,本格失去判別力,拒繼續',
          v_role, v_tbl, v_sqlstate;
      END IF;

    END LOOP;
  END LOOP;
END
$$;

-- ── 4. 誤殺正控:`SELECT` 必須【仍然】在 ────────────────────────
--   `brands` / `categories` 是公開型錄(建表 `20260505130758` 的 RLS 就是
--   「全 SELECT 公開 / 寫入 service_role only」)。
--   🔴 收 MAINTAIN 不該動到讀取;這一格是本支的**誤殺偵測**。
--   ⚠️ 它走 `has_table_privilege` ⇒ **看不到 schema USAGE 層**;
--      真正把「碰得到這張表」證掉的是 3b,不是這一格。
DO $$
DECLARE
  v_role text;
  v_tbl  text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_tbl IN ARRAY ARRAY['public.brands', 'public.categories'] LOOP
      IF NOT pg_catalog.has_table_privilege(v_role, v_tbl, 'SELECT') THEN
        RAISE EXCEPTION
          '#628 異常 — % 對 % 的 SELECT 不見了(本支只該收 MAINTAIN,這是誤殺);拒繼續',
          v_role, v_tbl;
      END IF;
    END LOOP;
  END LOOP;
END
$$;

COMMIT;
