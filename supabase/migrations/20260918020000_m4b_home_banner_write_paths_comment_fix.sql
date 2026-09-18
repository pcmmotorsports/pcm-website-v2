-- 🔵 **本檔【刻意沒有】 `-- pcm:idempotent: yes`, 而這是判過的不是忘了寫。**
--    R1 審查(adversarial-reviewer, opus, 2026-09-18)指出那不是一個標籤, 是一張**通行證**:
--    `scripts/apply-paste-board.sh:386` 逐字 `if re.fullmatch(...pcm:idempotent...): sys.exit(0)`
--    ⇒ 命中就 `return 0`(`:390-391`), **而那在 DML 掃描【之前】**。
--    🔬 而本片**根本不需要它**:該腳本的 DML 樣式(`:441`)逐字是
--       `INSERT INTO|UPDATE |DELETE FROM|MERGE INTO|COPY |TRUNCATE |SELECT … INTO |CALL `
--       —— **裡面沒有 `COMMENT`** ⇒ 本片不加那一行, 那道閘一樣放行 0 hits。
--    🛑 ⇒ **那一行今天買到的是 0, 而它留下的是一張長期通行證**:這支檔在貼之前若被人補一句
--       真正的 DML(順手洗一欄), 那道會說「這支會在 apply 當下寫資料 ⇒ 停」的閘(`:506`)
--       **會靜默 exit 0**。📌 一行宣告換掉一道閘, 而換回來的是零。
--    ✅ **重跑仍然安全**(前置閘刻意收兩個 md5, 見下), 只是**不用那一行去宣告它**。
-- 20260918020000_m4b_home_banner_write_paths_comment_fix.sql
-- M-4b · 窗 B(後台, worktree pcm-ops)· 版本號由主視窗 pcm-website-v2-71 指定
-- Sean 2026-09-18 拍乙(「大圖復原成草稿」不做)⇒ 改做這一件:把那句今天就已經是假的表說明更正。
-- plan: docs/plans/2026-09-16-home-banner-restore-draft-plan.md §0(該片拍乙不做, 本片是它順手抓到的)
--
-- ══ 做什麼 ═══════════════════════════════════════════════════════════════════
-- 只改一個東西:`public.home_banners` 的【表 COMMENT】。
-- 🟢 **零行為改動** —— 不動資料、不動 CHECK、不動 trigger、不動權限、不動任何函式、不動任何欄。
--    `COMMENT ON TABLE` 只寫 `pg_description`。
--
-- ══ 為什麼:那句話【今天就是假的】, 不是等哪一片做完才變假 ══════════════════
-- 🔬 2026-09-18 唯讀正式庫實查(`obj_description`, 不是讀 repo):
--    現行字面 md5 = 2f46412fc1623b519089cff5e7e9f3a8 · 長度 426 ⇒ 與 repo `20260916180000:77` **逐字相同**(`:76` 是 `COMMENT ON TABLE … IS`, 字面在下一行)
--    (repo 端同法算 md5 也是 2f46412fc1623b519089cff5e7e9f3a8 ⇒ 兩邊沒有漂移, 我釘得住)。
--
-- **三處是假的。①是交辦的;②是我重量整句時撞到的;③是 R1 審查抓出來的。**
-- 🔵 **本檔頭的 ①②③ 與新字面 ⛔ 段裡的 ①②③ 是【同一組編號】**(R2 N-d:原本兩邊互換過,
--    日後有人寫「見②」會指到不同東西 ⇒ 對齊)。
--
-- ① 「寫入只走 admin_home_banner_save_draft / _publish / _archive」⇒ **少兩支**
--    🔴🔴 **而我第一版只補了一支, 因為我用錯了尺 —— 這一格比漏掉那支本身重要**(R1 MF1 抓到):
--       ⛔ ~~量法:`pg_proc` 查 `admin\_home\_banner%` ⇒ 4 支~~
--       📌 **那把尺量的是「名字長得像 admin 大圖函式的有幾支」, 而這句 COMMENT 宣稱的是
--          「會寫這張表的有幾支」—— 兩者不是同一個集合。**
--       🛑 而它的負對照(`admin\_home\_bannerZZQ%` ⇒ 0)**只證明尺會回 0, 不證明分母對** ——
--          對「有一支叫別的名字的在寫這張表」那個世界, 它**恆為綠**。
--    ✅ **換尺重量**(2026-09-18 唯讀正式庫, 問 body 不問名字):
--       `WHERE p.prosrc LIKE '%home_banners%'` ⇒ **5 支**, 名字前綴那把尺同時只數到 **4**。
--       第五支 = `system_supplier_mail_record`(`20260916170000`, **帳本有**, 貼於 2026-09-16),
--       `:144` `INSERT INTO public.home_banners`, 而 `packages/adapters/src/supplier-mail/
--       SupabaseSupplierNewProductStore.ts:57` 真的在 `.rpc(` 叫它。
--       🎯 **而它正是這句 COMMENT 自己在講的那個東西的產地** —— 同一句裡的
--          「信件來的草稿(source_email_id 非空)」那些列, 就是它插進來的。
--    ⚪ 負對照:同一把新尺問 `%home_bannersZZQ%` ⇒ 0 列 ⇒ 尺會動。
--
-- ③ 🔴🔴 **漏掉一整類【不是函式】的寫入路徑**(R1 MF2 抓到)
--    🔬 正式庫實查:`home_banners_source_email_id_fkey`
--       = `FOREIGN KEY (source_email_id) REFERENCES supplier_inbound_emails(id) **ON DELETE SET NULL**`
--       而 `supplier_inbound_emails_purge_expired()`(`20260916150000:535`)`:546` `DELETE FROM
--       public.supplier_inbound_emails` ⇒ **90 天清信一跑, 本表的欄位值就被改了**。
--       而 `20260916150000:545` 自己逐字寫著:「大圖的 source_email_id 由 FK 設 NULL
--       (**不寫稽核、不動 updated_at**)」。
--    📌 **舊字面說「寫入只走 N 支(各寫 admin_audit_log)」** ⇒ 有人去 `admin_audit_log` 對帳、
--       查不到那一次變更 ⇒ 會把「source_email_id 不見了」當成資料損毀或有人手動改庫去追。
--    🔵 **第三類是有的, 只是今天 0 筆**(R2 N-c):owner 或 migration **直貼 SQL**。
--       它不歸任何函式管、也不是 FK 連帶 ⇒ 兩個桶都蓋不到。刻意**不寫進 COMMENT**:
--       那是「誰都可以手動改庫」的普遍事實, 寫進每張表的說明只會變成噪音。
--    ⇒ 🎯 **只修 ① 的話, 那把尺(數函式)第二次還是量不到這一條** —— 所以新字面把「寫入」
--       明確分成【函式寫入】與【非函式寫入】兩類, 而不是只把數字從三改成五。
--
-- ② 🔴 「前台目前只顯示最近上架的一張, **多張輪播還沒做**」⇒ **做了, 而且已經在客人面前**
--    🔬 `git show origin/main:apps/storefront/src/lib/home-banners.ts`(**顧客站那條線, 不是 dev**):
--       `export async function fetchLiveHomeBanners(): Promise<LiveHomeBanner[]>` ⇒ 回**陣列**
--       `.order(starts_at DESC)` → `.order(id DESC)` → `.limit(HOME_BANNER_MAX_SLIDES)`,
--       而 `HOME_BANNER_MAX_SLIDES = 4`(`packages/domain/src/catalog/home-banner-rules.ts:28`)。
--       首頁真的在用它:`apps/storefront/src/app/page.tsx:172`。
--    📌 **這一句比 ① 嚴重** —— ① 錯的是「我們有幾支函式」(給工程師看的),
--       ② 錯的是「**客人現在看到幾張圖**」(給決策看的)。而它們住在同一句話裡。
--
-- ══ 🛑 而我**沒有**只量被交辦的那一句 —— 整句每個子句都量過 ══════════════════
-- 📌 理由是今天自己記下的那條:**「我這把尺量的是我列得出來的那些, 而我要防的是我列不出來的那些嗎?」**
--    只改 ① 的話, ② 會原封不動地留在一句我剛剛親手改過的話裡面。
-- ✅ **量完仍然成立、一個字都不動的子句(逐條實查, 不是假設)**:
--    · 「SECURITY DEFINER, EXECUTE 只給 service_role」⇒ 4 支**全部** `prosecdef=t`、
--      `proacl={postgres=X/postgres,service_role=X/postgres}`、`proconfig={search_path=""}`
--      🔴 **而這一格的證據面比新字面的宣稱【窄一格】, 講明不要讀寬**(R2 N-a 抓到):
--         09-18 那次實查只蓋到 4 支(那時我還在用錯的尺), 而新字面宣稱的是**五支**都這樣。
--         第五支 `system_supplier_mail_record` 的那三個屬性靠的是:它自己貼時的後置閘
--         (`20260916170000:199`)+ repo 源碼(`:67-68` DEFINER 與 search_path 空字串、
--         `:167` 寫 audit、`:176-177` REVOKE 後只給 service_role)。
--         📌 **結論是真的, 而它的來源與前四支不同** —— 本片整篇在講「不要讓字面比證據寬」,
--            那條尺要先量自己。
--    · 「anon / authenticated 零權限」⇒ `relacl={postgres=arwdDxtm,service_role=r,pcm_readonly=r}`
--      ⇒ 那兩個角色**不在裡面**;`relrowsecurity=t`
--    · 「前台讀 home_banners_live_v」⇒ 該 view 在(`relkind=v`)
--    · 「已發布的連結一定要站內 /products 或 /brands」⇒ `home_banners_published_link_scope` 在
--    · 「信件來的要配到商品且連結指到 /products」⇒ `home_banners_mail_published_needs_match` 在
--    · 「發布要帶預覽時的 updated_at」⇒ `_publish` 的簽章裡有 `p_expected_updated_at`
--    · 「要勾授權」⇒ `home_banners_published_shape_check` 裡有 `rights_confirmed`
--    · 「排序由前台決定」⇒ 成立, 而本片**把它寫得更死**(`starts_at DESC` 後 `id DESC`)
--      —— 那兩行就在上面那支檔裡, 而舊字面只說「由前台決定」, 沒說是哪個鍵。
--
-- ══ 🔵 `pcm_acl_approve_latest`:**本片不用跑, 而這是判過的不是漏掉的** ═══════
-- 房規要求「貼完同批跑」的理由是**那一批動過權限**, 每日摘要會叫「權限與昨天不一樣」。
-- 🔬 而本片**一個權限字都沒有**:整支檔零 `CREATE` / 零 `GRANT` / 零 `REVOKE` / 零 `ALTER … OWNER`,
--    唯一會改變資料庫的一句是 `COMMENT ON TABLE`, 它寫的是 `pg_description`, **不碰 `pg_proc.proacl`
--    也不碰 `pg_class.relacl`** ⇒ 摘要那把尺讀不到本片, 跑那道確認**量不到任何東西**。
-- 🛑 **而「不用跑」與「忘了寫」在檔頭上長得一模一樣** ⇒ 所以寫成這一整段, 不是留白。
--    📌 對照組:`20260916250000` 檔頭**有**那句 —— 它建了一支新函式(全新 ACL 列)⇒ 它需要, 本片不需要。
--
-- ══ 影響 / 錯了會怎樣 ════════════════════════════════════════════════════════
-- 改壞了最壞的情況 = 一句話寫錯, **沒有任何行為會變**;客人、員工、前台、後台都不會有差別。
-- 鎖:`COMMENT ON TABLE` 不拿 ACCESS EXCLUSIVE(本檔仍照慣例設 lock_timeout)。
-- 部署時序:🟢 **行為上無空窗** —— 沒有新物件、沒有簽章變動、**本片沒有任何碼**。
-- 🔴 **而「什麼時候貼」是另一件事, 房規有話**(R1 C3 抓到, 我原本只寫了行為那一半):
--    CLAUDE.md〈貼板與推的順序〉第二條逐字:**跟本次程式無關的板 ⇒ 等推 main 那一發跑完再貼**。
--    理由是帳本閘 —— `scripts/migration-ledger-divergence.sh:30` 的 ⑦「平台孤兒」是**擋**的。
--    ⇒ 📌 **本片是全 repo 最「與碼無關」的一片, 所以它也是最可能被順手先貼的一片。**
--    ✅ 貼法:**等推 main 那一發跑完再貼**;若走 MCP `apply_migration`, **先讓這支檔進 repo**。
--
-- ══ 還原 ═════════════════════════════════════════════════════════════════════
-- `supabase/rollbacks/20260918020000-rollback.sql`
-- 🔴 那支嵌的是【貼之前】從正式庫 `obj_description` 撈下來的原文(md5 對過 2f46412fc1623b519089cff5e7e9f3a8), **不是從 repo 抄的**。
-- 🔵 **不用先退碼** —— 本片**沒有任何碼**跟著它(整片只有一句 COMMENT)。
--    🔴 **我原本在這裡寫的證據是錯的**(R1 C2 抓到):舊字面叫人跑 `git log --oneline -1`,
--       而寫下那句話的當下**那一顆 commit 還不存在**(兩支 SQL 還在 index)⇒ 照著跑會拿到別的東西。
--       📌 **結論對而證據錯, 比兩個都錯更危險** —— 這句話住在半夜要退的人唯一會讀的地方。
--    ✅ **正確的證據**:`apps/` 與 `packages/` 對 `home_banners` 這一片的異動 **零筆**;
--       本片預定的那一顆 commit **只含這兩支 `supabase/` 檔**(hash 在 commit 之後補進 rollback 檔頭)。
--    ⚠️ **補 hash 要用 follow-up commit, 不要 `git commit --amend`**(R2 N-e):
--       amend 會當場換掉那顆的 hash ⇒ 檔裡釘的那一顆**不存在** = 原封不動重演 R1 C2 那個病。
--       📎 同一個坑的另一面:memory `reference_cat-file-e-cannot-detect-a-rebased-away-hash`。
--    ⚠️ 而那句「只含這兩支」**只在 index 真的只有這兩支時成立**(R2 N-f):
--       `docs/plans/2026-09-16-home-banner-restore-draft-plan.md` 目前是未 staged 的 `M`,
--       **它要另外一顆 commit**, 順手 `git add` 進來會讓這兩句當場變假。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 🔴 **`position(x IN y)` 不能加 schema 前綴** —— `pg_catalog.position('a' IN b)` 是【語法錯】,
--    因為那是 SQL 標準的語法糖不是一般函式呼叫。⇒ 本檔一律用 `pg_catalog.strpos(y, x)`(注意**引數順序相反**)。
--    🔬 2026-09-18 拋棄式 PG 17.10 實跑才紅的 —— 靜態閘、typecheck、lint **一個都沒叫**。
-- ── 1. 前置閘 ────────────────────────────────────────────────────────────────
DO $pre$
DECLARE v_md5 text; v_cur text;
BEGIN
  IF pg_catalog.to_regclass('public.home_banners') IS NULL THEN
    RAISE EXCEPTION '前置閘①:public.home_banners 不存在 ⇒ 這個庫不是我以為的那個 ⇒ 停下';
  END IF;

  v_cur := pg_catalog.obj_description('public.home_banners'::pg_catalog.regclass, 'pg_class');
  v_md5 := pg_catalog.md5(v_cur);

  -- 🔴 比【現值的 md5】, 不比「有沒有值」—— 後者對「別人已經改成另一句」恆真。
  -- 🔵 **刻意收兩個**:貼前那版 or 貼後那版(= 重跑)。第三種一律擋(見檔頭冪等那段)。
  IF v_md5 IS DISTINCT FROM '2f46412fc1623b519089cff5e7e9f3a8' AND v_md5 IS DISTINCT FROM 'dcfda5c8c15f666c930524db42c32684' THEN
    RAISE EXCEPTION '前置閘②:home_banners 現在的表 COMMENT md5 是 %, 既不是貼前的 2f46412fc1623b519089cff5e7e9f3a8 也不是本片要寫的 dcfda5c8c15f666c930524db42c32684 ⇒ 正式庫已經被改成第三種字面(有人先改過, 或我拿的是舊資訊)⇒ 拒繼續。',
                    COALESCE(v_md5, '(沒有 COMMENT)');
  END IF;

  IF v_md5 = 'dcfda5c8c15f666c930524db42c32684' THEN
    RAISE NOTICE '🔵 前置閘:本片【已經貼過】(md5 已是 dcfda5c8c15f666c930524db42c32684)⇒ 這是重跑, 下面那句會寫上逐字相同的內容。';
  ELSE
    -- 🔵 **這兩條是【可讀宣告】, 不是閘 —— R1 N1 說得對, 我原本把它們叫「正對照」是抬舉了。**
    --    📌 上面的前置閘② 已經釘死 `v_cur` 的 md5 ⇒ md5 相同即字面逐字相同
    --       ⇒ 這兩個子字串**必然在** ⇒ 它們**在數學上永遠不會叫**。
    --    ✅ 留著的理由只有一個:讓讀檔的人看見「我以為我要改的是這兩句」, 而**不是**「這裡有一道閘」。
    --    🛑 **本專案這週抓的就是「看起來在守而守不到的閘」** ⇒ 所以把它的名字改對, 而不是把它刪掉。
    --    🔬 而其中只有 ④ 那個字面在新舊之間**真的不同**(新版接的是 ` / _duplicate`), ③ 兩邊都有
    --       (⛔ 舊字面留刪除線的房規)⇒ **就算搬到無條件位置, ③ 也仍然是零判別力。**
    IF pg_catalog.strpos(v_cur, '多張輪播還沒做') = 0 THEN
      RAISE EXCEPTION '宣告③:貼前的字面裡找不到「多張輪播還沒做」⇒ 我要改的東西不在這裡 ⇒ 拒繼續';
    END IF;
    IF pg_catalog.strpos(v_cur, '寫入只走 admin_home_banner_save_draft / _publish / _archive(') = 0 THEN
      RAISE EXCEPTION '宣告④:貼前的字面裡找不到那句三支函式的清單 ⇒ 我要改的東西不在這裡 ⇒ 拒繼續';
    END IF;
    RAISE NOTICE '✅ 前置閘:表 COMMENT 就是我寫這一片時看到的那一句(md5 %), 兩句要改的都在裡面', v_md5;
  END IF;
END
$pre$;

-- ── 2. 動作(本片唯一會改變資料庫的一句) ───────────────────────────────────
COMMENT ON TABLE public.home_banners IS '首頁大圖(20260916150000;20260916180000 起 Sean 三題改乙;20260918020000 更正三處過期字面)。draft ⇒ published ⇒ archived(單列不回頭;要重做走 admin_home_banner_duplicate 開一張新草稿,舊那列原封不動)。【函式寫入】五支,各寫 admin_audit_log,都是 SECURITY DEFINER、search_path 空字串、EXECUTE 只給 service_role:admin_home_banner_save_draft / _publish / _archive / _duplicate,以及 system_supplier_mail_record(20260916170000;廠商新品信那條路,actor 固定 system:mail-draft、rights_confirmed 寫死 false)。🔴【非函式寫入】還有一條:home_banners_source_email_id_fkey 是 ON DELETE SET NULL ⇒ supplier_inbound_emails_purge_expired() 90 天清信時,本表的 source_email_id 會被設成 NULL,而且不寫稽核、不動 updated_at ⇒ 去 admin_audit_log 查不到那一次變更是正常的,不是資料損毀也不是有人手動改庫。發布與下架 / 封存都 = 所有在職員工;發布要帶預覽時的 updated_at、要勾授權、預設 14 天下架。已發布的連結一定要是站內 /products… 或 /brands…;信件來的草稿(source_email_id 非空)另外要配到商品且連結指到 /products…。首頁可以同時掛多張(排序由前台決定:starts_at DESC 後 id DESC;輪播最多 HOME_BANNER_MAX_SLIDES = 4 張,而那個上限只在碼裡、DB 端沒有任何閘)。anon / authenticated 零權限;前台讀 home_banners_live_v。⛔ 20260918020000 更正的三句舊字面(留著不刪):① 「寫入只走 admin_home_banner_save_draft / _publish / _archive」⇒ 漏了 _duplicate(20260916250000)與 system_supplier_mail_record(20260916170000)⇒ 函式是五支不是三支;② 「前台目前只顯示最近上架的一張,多張輪播還沒做」⇒ 輪播已經上線(顧客站 main 實查);③ 舊字面把「寫入」寫成只有函式一種 ⇒ 漏掉上面那條 FK 連帶,而那一條不寫稽核。';

-- ── 3. 後置斷言 + 負對照 ─────────────────────────────────────────────────────
DO $post$
DECLARE v_new text; v_md5 text;
BEGIN
  v_new := pg_catalog.obj_description('public.home_banners'::pg_catalog.regclass, 'pg_class');
  v_md5 := pg_catalog.md5(v_new);

  -- ① 精確變成我打算的那一句(釘 md5)。
  --    🔴 **不用子字串** —— 見前置閘③旁那段:新舊字面都含那兩句, 子字串在這裡零判別力。
  IF v_md5 IS DISTINCT FROM 'dcfda5c8c15f666c930524db42c32684' THEN
    RAISE EXCEPTION '後置閘①:換上去的表 COMMENT md5 是 %, 不是本片打算寫的 dcfda5c8c15f666c930524db42c32684 ⇒ 拒 COMMIT', v_md5;
  END IF;

  -- ② 🔵 有了①之後這條在數學上多餘, **刻意留著**:它是「我打算保留什麼」的可讀宣告。
  --    若哪天有人改了字面又順手改了①的 md5, 這條仍會叫。
  IF pg_catalog.strpos(v_new, '前台讀 home_banners_live_v') = 0 THEN
    RAISE EXCEPTION '後置閘②:新字面裡沒有「前台讀 home_banners_live_v」⇒ 弄丟了一句別人在靠的指路 ⇒ 拒 COMMIT';
  END IF;
  IF pg_catalog.strpos(v_new, 'system_supplier_mail_record') = 0 THEN
    RAISE EXCEPTION '後置閘③:新字面裡沒有第五支 system_supplier_mail_record ⇒ 本片的主要目的沒達成 ⇒ 拒 COMMIT';
  END IF;

  -- ③ 🔵 負對照:同一張表【兩個有 COMMENT 的欄】必須一個字都沒變。
  --    📌 少了這一條, 「把這張表的 COMMENT 全清掉再寫上這一句」也會讓①過 —— 而那正是改壞的樣子。
  --    ⚠️ 射程說清楚:這張表**只有這兩欄有 COMMENT**(2026-09-18 唯讀實查,
  --       其餘欄 `col_description` 皆為 NULL)⇒ 這個負對照的分母是 2, 不是「全部的欄」。
  IF pg_catalog.md5(pg_catalog.col_description('public.home_banners'::pg_catalog.regclass,
       (SELECT a.attnum FROM pg_catalog.pg_attribute a
         WHERE a.attrelid='public.home_banners'::pg_catalog.regclass AND a.attname='image_origin')))
     IS DISTINCT FROM '8c25cb94fe63918b7722bf1545390d81' THEN
    -- 🔵 R1 N2:欄被 drop / rename 時 attnum 子查詢回 NULL ⇒ col_description 回 NULL ⇒ 一樣會叫,
    --    而訊息說「COMMENT 也變了」是**誤導**(實情是欄不見了)⇒ 分流講。
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                    WHERE a.attrelid='public.home_banners'::pg_catalog.regclass
                      AND a.attname='image_origin' AND a.attnum > 0 AND NOT a.attisdropped) THEN
      RAISE EXCEPTION '🔴 負對照失敗:image_origin 這一【欄】不存在了(被 drop 或 rename)⇒ 這張表的形狀不是我以為的 ⇒ 拒 COMMIT';
    END IF;
    RAISE EXCEPTION '🔴 負對照失敗:同一張表的 % 欄 COMMENT 也變了 ⇒ 本片動到了不該動的東西(或有人同時在改這張表)⇒ 拒 COMMIT', 'image_origin';
  END IF;
  IF pg_catalog.md5(pg_catalog.col_description('public.home_banners'::pg_catalog.regclass,
       (SELECT a.attnum FROM pg_catalog.pg_attribute a
         WHERE a.attrelid='public.home_banners'::pg_catalog.regclass AND a.attname='image_kind')))
     IS DISTINCT FROM 'e56f2aa1d6704b0c1983729bfa531df3' THEN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                    WHERE a.attrelid='public.home_banners'::pg_catalog.regclass
                      AND a.attname='image_kind' AND a.attnum > 0 AND NOT a.attisdropped) THEN
      RAISE EXCEPTION '🔴 負對照失敗:image_kind 這一【欄】不存在了(被 drop 或 rename)⇒ 這張表的形狀不是我以為的 ⇒ 拒 COMMIT';
    END IF;
    RAISE EXCEPTION '🔴 負對照失敗:同一張表的 % 欄 COMMENT 也變了 ⇒ 本片動到了不該動的東西(或有人同時在改這張表)⇒ 拒 COMMIT', 'image_kind';
  END IF;

  RAISE NOTICE '✅ 後置閘 + 負對照全過(新字面 md5 %)', v_md5;
END
$post$;

COMMIT;
