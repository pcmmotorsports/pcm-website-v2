-- 20260918020000-rollback.sql —— 退回 20260918020000_m4b_home_banner_write_paths_comment_fix.sql
-- M-4b · 窗 B(後台, worktree pcm-ops)
--
-- ══ 退什麼 ═══════════════════════════════════════════════════════════════════
-- 把 `public.home_banners` 的表 COMMENT 寫回**貼之前那一句**。
-- 🔴 下面那段原文是【貼之前】的字面, **md5 由機器核過等於 2f46412fc1623b519089cff5e7e9f3a8**(不是手抄):
--    抽法 = 從 `20260916180000` 的 `COMMENT ON TABLE` 正規表達式取出, 算 md5 後與
--    2026-09-18 唯讀正式庫 `obj_description` 實查到的 md5 逐字比對 ⇒ 相同 ⇒ 兩邊沒有漂移。
--
-- 🔵 **不用先退碼, 而這句是判過的不是抄的**:本片**沒有任何碼**跟著它。
--    🔴 舊字面叫人跑 `git log --oneline -1` 去核 —— 而**寫下那句話的當下那一顆還不存在**
--       ⇒ 照著跑會拿到別的東西(R1 C2 抓到)。📌 **結論對而證據錯, 住在半夜要退的人唯一會讀的地方。**
--    ✅ 正確的證據:`apps/` 與 `packages/` 對 `home_banners` 這一片零異動;
--       本片那一顆 = `460fabc4a`(分支 `agent/ops-17-receipt`), 它的 diff **只含這兩支 `supabase/` 檔**。
--       🔬 自己核:`git show --stat 460fabc4a` ⇒ 2 files changed。
--       ⚠️ 這個 hash 是**用 follow-up commit 補上去的, 不是 `--amend`** —— amend 會當場換掉那顆的
--          hash ⇒ 檔裡釘的那一顆就不存在了(R2 N-e;同族的坑見 memory
--          `reference_cat-file-e-cannot-detect-a-rebased-away-hash`)。
--    ⇒ 退這一支**不需要**連碼一起退。
--    🛑 (對照:`20260917150000` 那支就**要**連碼一起退, 因為它改的函式有前端在讀它的回傳值。
--       兩者不同, 不要把這一句當成通則。)
--
-- 🔵 `pcm_acl_approve_latest`:**退完也不用跑** —— 理由與正片檔頭同一段:
--    整支檔零 `CREATE` / 零 `GRANT` / 零 `REVOKE` / 零 `ALTER … OWNER`,
--    `COMMENT ON TABLE` 只寫 `pg_description`, 不碰 `relacl` 也不碰 `proacl`。

-- 🛑🛑 **這支 rollback 幾乎不該被跑, 先讀這一段再決定**(R1 N4)。
--    退回去 = **把兩句【已知為假】的話寫回正式庫**, 其中
--    「前台目前只顯示最近上架的一張, 多張輪播還沒做」那句正在誤導看它的人
--    (輪播已經在客人面前, 最多 4 張)。
--    ⇒ ✅ 該跑它的世界只有兩種:**貼錯庫**, 或**新字面本身打錯字**。
--    ⇒ ❌ 「這片看起來沒必要所以退掉」**不是**理由 —— 退掉之後那張表會重新開始說謊。
--    🔵 **而上面那個列舉是【封閉】的, 補第三種**(R2 N-b):**新字面的事實本身被證明是錯的**
--       (不是打錯字, 是查錯 —— 例如日後真的冒出第六條寫入路徑)。
--       ⇒ 📌 **那一種多半應該【往前修】不是【往後退】** —— 寫新的一片蓋過去,
--          退回去只會把一句舊謊言換成另一句。先問人, 不要自己決定退。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 前置閘:現在真的是【本片貼上去】的那一句嗎 ────────────────────────────
DO $pre$
DECLARE v_md5 text;
BEGIN
  IF pg_catalog.to_regclass('public.home_banners') IS NULL THEN
    RAISE EXCEPTION '退回前置閘①:public.home_banners 不存在 ⇒ 停下';
  END IF;

  v_md5 := pg_catalog.md5(pg_catalog.obj_description('public.home_banners'::pg_catalog.regclass, 'pg_class'));

  -- 🔵 三個世界分開講, 而**只有第一個會繼續往下跑**。
  IF v_md5 = 'dcfda5c8c15f666c930524db42c32684' THEN
    RAISE NOTICE '✅ 退回前置閘:現值是 20260918020000 寫上去的那一句 ⇒ 可以退。';
  ELSIF v_md5 = '2f46412fc1623b519089cff5e7e9f3a8' THEN
    RAISE EXCEPTION '退回前置閘②:現值【已經是貼之前那一句】了(md5 2f46412fc1623b519089cff5e7e9f3a8)⇒ 這一片沒貼, 或已經被退過 ⇒ 不重複退, 停下。';
  ELSE
    RAISE EXCEPTION '退回前置閘③:現值 md5 是 %, 既不是本片寫的 dcfda5c8c15f666c930524db42c32684 也不是貼前的 2f46412fc1623b519089cff5e7e9f3a8 ⇒ 中間有人改成第三種字面 ⇒ 退下去會把【他的】東西蓋掉 ⇒ 拒退, 交給人判。',
                    COALESCE(v_md5, '(沒有 COMMENT)');
  END IF;
END
$pre$;

-- ── 2. 動作 ──────────────────────────────────────────────────────────────────
COMMENT ON TABLE public.home_banners IS '首頁大圖(20260916150000;20260916180000 起 Sean 三題改乙)。draft ⇒ published ⇒ archived。寫入只走 admin_home_banner_save_draft / _publish / _archive(SECURITY DEFINER,EXECUTE 只給 service_role,各寫 admin_audit_log)。發布與下架 / 封存都 = 所有在職員工;發布要帶預覽時的 updated_at、要勾授權、預設 14 天下架。已發布的連結一定要是站內 /products… 或 /brands…;信件來的草稿(source_email_id 非空)另外要配到商品且連結指到 /products…。首頁可以同時掛多張(排序由前台決定;前台目前只顯示最近上架的一張,多張輪播還沒做)。anon / authenticated 零權限;前台讀 home_banners_live_v。';

-- ── 3. 後置斷言 ──────────────────────────────────────────────────────────────
DO $post$
DECLARE v_md5 text;
BEGIN
  v_md5 := pg_catalog.md5(pg_catalog.obj_description('public.home_banners'::pg_catalog.regclass, 'pg_class'));
  IF v_md5 IS DISTINCT FROM '2f46412fc1623b519089cff5e7e9f3a8' THEN
    RAISE EXCEPTION '退回後置閘:退完之後 md5 是 %, 不是貼前的 2f46412fc1623b519089cff5e7e9f3a8 ⇒ 沒有退乾淨 ⇒ 拒 COMMIT', v_md5;
  END IF;
  RAISE NOTICE '✅ 退回後置閘:表 COMMENT 已逐字回到貼之前(md5 %)', v_md5;
END
$post$;

COMMIT;
