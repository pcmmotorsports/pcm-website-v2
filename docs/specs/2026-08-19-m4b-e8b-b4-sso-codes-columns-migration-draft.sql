-- ═══════════════════════════════════════════════════════════════════════════
--  B4 · sso_codes 加身分欄 sub_kind / sub_staff_id(報價單庫 dllwkkfanaebrsuyuedy)
--
--  🔴 這是【草稿】。落檔 2026-08-19 · 作者 W5
--  規格:docs/specs/2026-08-18-m4b-e8b-b4-spec.md §B4(DDL 原文在 :70-71)
--  母 plan:docs/specs/2026-08-16-m4b-e8b-real-auth-line-plan-v4.md:214
--  批准:Sean 2026-08-19「那就批吧」(逐字出處 ~/pcm-mailbox/MAIN-056-…:176)
--        ⚠️ 他批的是【那份 plan】,不是本檔;**apply 仍需他在場**
--
--  ╔═══════════════════════════════════════════════════════════════════════╗
--  ║ 🔴🔴 這支檔【不得搬進任何 supabase/migrations/ 目錄】                   ║
--  ╚═══════════════════════════════════════════════════════════════════════╝
--  理由與 B1/B5 草稿同一條:檔一進那個目錄,下一發 push 就連它一起走,
--  而推的人可能正在推別的東西、根本不知道多了一支。
--
--  apply 管道:MCP `apply_migration`,【需要 Sean 在場】
--    · 報價單 repo 明文禁 `supabase db push`
--      (理由的數字見 memory `reference_quote-repo-migration-ledger-desync`;
--       🔴 該檔 07-27 那組「146/160/零重疊」已被 2026-07-29 帳本重建作廢,
--       2026-08-19 實測為 本機 16 檔 / ledger 16 筆 / 交集 12)
--    · 前置正本:docs/specs/2026-08-17-b1-apply-preflight.md:9
--
--  🔴 順序是硬的:**本支要在 B3 上線【之後】才 apply。**
--     顛倒的話,那兩欄會是一整片 NULL,而 NULL 在本設計裡代表
--     「B3 之前簽的碼」⇒ 「還沒開始寫」與「舊碼」會混在一起分不出來。
--
-- ───────────────────────────────────────────────────────────────────────────
--  🔴 為什麼三個動作寫成【一句 ALTER TABLE】,而不是三句
--
--  spec:59 的 must-fix 要求兩段 DDL 在同一個明文交易裡,理由是
--    「不倚賴『Postgres 的 DDL 是交易性的』這個直覺 ——
--      apply_migration 有沒有自己包一層【至今未確認】」
--  ⇒ 本檔保留 BEGIN;/COMMIT;(不擅自拿掉那條 must-fix),
--    **並且把三個動作併成一句** ——
--    單一語句的原子性【不取決於任何外層】,要嘛整句成功、要嘛整句失敗。
--  ⇒ ⇒ 它把「apply_migration 是不是交易式的」這個【未量的依賴】直接消掉,
--       而不是繞過它。那個問題**維持未量,而它已不再承重**。
--  ⇒ ⇒ docs/runbooks/2026-08-19-b4-sso-codes-recovery.md 因此
--       從【主要路徑】降級為【純保險】。
--
--  ✅ 2026-08-19 W5 本機實測(拋棄式 PG 17.10,同形狀表 7 欄 + 1 列既有資料):
--     · 成功路徑:一句三動作 ⇒ ALTER TABLE ⇒ 兩欄 + 約束都在,欄數 7→9
--     · 🔴 失敗路徑(故意讓既有列違反 CHECK)⇒ ERROR
--            ⇒ 查欄位得「(兩欄都不存在)」、欄數仍 7
--            ⇒ **ADD COLUMN 跟著整句回滾,不可能停在半套**
--     · CHECK 值域 9/9 全對(含 spec 2026-08-18 那條「單一空白」nit:
--       原 `<> ''` 擋不掉 `' '`,改用 `btrim()` 後實測擋下)
--     ⚠️ 效度限制:測的是【同形狀表】不是正式庫真實 schema(無 RLS/GRANT/索引/外鍵)
--        ⇒ 本測證明的是【ALTER 的原子性與 CHECK 的值域】,
--          **不是「本支套到報價單庫會成功」** —— 那兩件事不同。
--        報價單庫版本 **17.6**(2026-08-19 實測),本機測的是 17.10
--        ⇒ 同 major、差 patch。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 前置斷言:確認我們在【對的庫、對的表】 ────────────────────────────────
-- 🔴 這道擋的是:**這支 SQL 被 apply 到【錯的資料庫】**
--    —— 錯庫會【當場 RAISE】,而不是安靜地在別的地方長出兩個欄位。
--
-- ⚠️ **它擋不到的那一類(2026-08-19 W6 關卡2 M1;本行不可省)**:
--    同日的 storefront 事故(`~/pcm-mailbox/W5-storefront金鑰事故-20260819.md`)
--    是【環境變數貼錯 Vercel 專案】—— **那起事故裡沒有任何一句 SQL**。
--    🔴 **「貼錯 Vercel 專案」那一類,本檔一格守門都沒有,也擋不到。**
--    (草稿曾把兩者寫成同一件事 ⇒ 會讓一個沒被守住的類別看起來被守住了。已更正。)
DO $$
DECLARE
  n_cols     int;
  n_identity int;
BEGIN
  -- (a) 🔴 庫【身分】:這兩張表是報價單庫獨有的(2026-08-19 實測 A庫 bmpnplmnldofgaohnaok 皆 0 張)
  --     ⇒ 沒有它們 = 這不是報價單庫。**形狀對不代表身分對** —— 第三個庫也可能剛好有一張
  --     七欄的 sso_codes,而它會通過 (b) 卻通不過 (a)。(2026-08-19 W6 關卡2 nit)
  SELECT count(*) INTO n_identity
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename IN ('dictionary_write_leases','supplier_freeze_manifest');

  IF n_identity <> 2 THEN
    RAISE EXCEPTION
      'B4 身分斷言失敗:找不到報價單庫獨有的基準表(預期 2 張,實得 %)。'
      '本支只屬報價單庫 dllwkkfanaebrsuyuedy。已中止,未做任何改動。', n_identity;
  END IF;

  -- (b) 表【形狀】
  SELECT count(*) INTO n_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name   = 'sso_codes'
    AND column_name IN ('code_hash','state_hash','amr','auth_time',
                        'expires_at','used_at','created_at');

  IF n_cols <> 7 THEN
    RAISE EXCEPTION
      'B4 前置斷言失敗:public.sso_codes 的預期 7 個基準欄只找到 % 個。'
      '這通常代表 apply 到了【錯的資料庫】(本支只屬報價單庫 dllwkkfanaebrsuyuedy),'
      '或 B3 之前的 schema 與預期不符。已中止,未做任何改動。', n_cols;
  END IF;
END $$;

-- ── 🔴 既有列為什麼不會讓 ADD CONSTRAINT 失敗(2026-08-19 W6 關卡1:原本沒說出口)──
-- 兩個新欄皆 nullable、無 DEFAULT ⇒ **既有列一律取得 (NULL, NULL)**,
-- 而 CHECK 的第一分支正是 `(sub_kind IS NULL AND sub_staff_id IS NULL)`
-- ⇒ 既有列全部落在合法分支 ⇒ **ADD CONSTRAINT 不會因既有資料而失敗。**
--
-- 🔴 **這個論證【不取決於既有幾列】** —— 不論 0 列還是一百萬列,
--    它們拿到的都是 (NULL, NULL),都合法。所以下面那個數字是【佐證,不是前提】:
--      · 2026-08-19 11:36:53 UTC 實測 public.sso_codes = **120 列**(其中【還有效的 0 列】)
--      · 量法:SELECT count(*) FROM public.sso_codes;
--        還有效的:count(*) FILTER (WHERE used_at IS NULL AND expires_at > now())
--    ⚠️ **這是活表,數字會變** ⇒ 引用前重量,而**不論它變成多少,上面的結論不變**。
--    📎 11:39:15 UTC 再量一次 = 120 列(已使用 112、已過期 120)。
--    ⚠️ 🔴 backlog `#669` 寫的「8 列」**不是總列數**,是「過期【且】未使用」那一小撮 ——
--       2026-08-19 11:39:15 UTC 實測仍為 **8**,**`#669` 沒有過期**。
--       🔴 兩個數字量的是不同的東西,不要互相取代(本行是 W5 自我更正:
--          初稿曾誤寫「#669 已過期」,那是拿總列數去比一個子集)。
-- ⇒ 因此本支【不需要】NOT VALID + 事後 VALIDATE,也不需要任何 backfill。

-- ── 主體:三個動作【一句】完成 ────────────────────────────────────────────
ALTER TABLE public.sso_codes
  ADD COLUMN sub_kind     text,   -- 'user' | 'fallback' | 'bootstrap' | NULL(NULL = B3 之前簽的碼)
  ADD COLUMN sub_staff_id text,   -- 只有 kind='user' 才有值
  ADD CONSTRAINT sso_codes_sub_shape CHECK (
       (sub_kind IS NULL       AND sub_staff_id IS NULL)
    OR (sub_kind = 'fallback'  AND sub_staff_id IS NULL)
    OR (sub_kind = 'bootstrap' AND sub_staff_id IS NULL)
    OR (sub_kind = 'user'      AND sub_staff_id IS NOT NULL AND btrim(sub_staff_id) <> '')
    --  🔴 btrim 不可改回 `<> ''` —— 那擋不掉【單一空白】(spec 2026-08-18 nit,今日實測確認)
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
--  apply 之後請跑這一句驗收(spec:64 要求)
--
--    SELECT
--      (SELECT count(*) FROM information_schema.columns
--        WHERE table_name='sso_codes' AND column_name IN ('sub_kind','sub_staff_id')) AS 新欄數,
--      (SELECT count(*) FROM pg_constraint WHERE conname='sso_codes_sub_shape')        AS 約束數;
--
--  預期:新欄數 = 2、約束數 = 1。
--  ⚠️ 而「欄位在、約束不在」這個半套狀態在本設計下【構造不出來】(見檔頭實測);
--     真的看到它 ⇒ 代表 apply 管道做了預期外的事 ⇒ 停下回報,**不要補跑一次 ADD CONSTRAINT**
--     (那會讓半套狀態多活一段時間);走 docs/runbooks/2026-08-19-b4-sso-codes-recovery.md。
-- ═══════════════════════════════════════════════════════════════════════════
