-- ═══════════════════════════════════════════════════════════════════════════
-- `pcm_readonly` 的角色與 GRANT 進版控
--   (2026-09-05 主視窗 -f8 派;號碼 20260905160000 由 -f8 掃全部本地+遠端分支後指定
--    —— 我的配額 270000/290000/350000 全部 > 230000, 而本片【必須排在 230000 之前】才有用)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 🎯 **它要解的是一件具體的事**:`scripts/migrations-replay-from-zero.sh` 從零重播時,
--    `20260905230000_m4b_admin_order_list_v_tax_total.sql:261` 逐字紅在
--        ERROR:  role "pcm_readonly" does not exist
--    那支檔 :256-258 的斷言④ 呼叫 `has_table_privilege('pcm_readonly', v_oid, 'SELECT')`,
--    🔴 而 `has_table_privilege` 對**不存在的角色會 throw**(不是回 f)⇒ 整支炸掉。
--    📌 本片與那個消費者之間只隔 **5 支** migration(170000/180000/190000/210000/220000),
--       230000 是**第 6 支**。(⚠️ 舊字面「70 支之後」是我寫錯的, codex 2026-09-05 抓到;留此訂正。)
--
-- 🔴🔴 **根因不只一層, 兩層都寫在這裡, 不要只讀第一層**:
--   【第一層】版控裡**沒有任何一支** migration 把 `admin_order_list_v` 的 SELECT 給 `pcm_readonly`。
--      量法(⚠️ **必須排除本檔自己**, 否則會撈到本片新加的那條 ⇒ 量法自我污染, codex 抓到):
--        grep -rn 'admin_order_list_v' supabase/migrations/*.sql | grep -v 20260905160000 | grep -ci grant
--      ⇒ **3**(全部是給 `service_role`);不排除本檔則是 15, 那個數字沒有意義。
--      ⇒ 📌 **正式庫那個 `t` 是版控外發生的**(有人手動給的)⇒ 斷言④ 在版控這條路上**本來就不可能成立**。
--   【第二層】`20260902210000_m4b_pfeddl2_staging_and_sync_log.sql` **確實會建這個角色**(:250-251),
--      而它在重播裡**整支 ROLLBACK 了** —— `BEGIN;`(:54) … `COMMIT;`(:569) 是一個交易,
--      而 :568 的事後閘⑦ 因為**本機 PG 17.10 有 `MAINTAIN` 而正式庫 PG 17.6 沒有**而 RAISE。
--      ⇒ 它的 `CREATE ROLE` 跑過了(NOTICE 在 log 裡), 而回捲把它抹掉了。
--      ⇒ 🛑 **那是另一支檔的事, 本片不修它。** 機制寫在
--         `docs/runbooks/throwaway-postgres-for-migration-verification.md` §5b。
--
-- ⚠️⚠️ **它讓兩邊一致的是【授權形狀】, 不是【看得到的資料】**(codex 2026-09-05 must-fix, 訂正舊字面)
--   ⛔ ~~「讓從零重建的庫走得到同一個終態」~~ —— **那句話太滿。**
--   🔬 空庫上本片建出來的是一個 `NOLOGIN` 空殼, **它沒有 `BYPASSRLS`**;
--      而正式庫那顆 `rolbypassrls = t`(實測)。
--      ⇒ 同樣一句 `SELECT * FROM public.order_pending_refunds`:
--          正式庫那顆 ⇒ **讀到全部的列**(RLS 被繞過)
--          空殼那顆   ⇒ ACL 是 t 而 RLS 把它擋成 **0 列**
--      ⇒ 📌 **「有授權」與「讀得到資料」是兩件事, 本片只對齊前者。**
--   🔴 同理:`admin_order_list_v` 是 `security_invoker = true` 的 view ——
--      空殼角色對 view 有 SELECT 而對底下的 `orders` 沒有 ⇒ **實際查詢會 `permission denied for table orders`**。
--      ⇒ 本片的事後閘② 問的是**授權**, 不是**查得動**;那一格的射程寫在它自己那一段。
--      ⇒ 而那正好也是 `20260905230000:257` 問的同一句 ⇒ 對「讓 230000 過」這個目的是**足夠且對等**的。
--
-- 🛑 **守衛的射程(只擋一種, 明寫它放行什麼)**
--   本片只在「角色已存在 **且** `rolsuper`」時拒絕。
--   ⇒ 🔴 **它【放行】一個同名而 `LOGIN + BYPASSRLS + CREATEROLE + REPLICATION` 的非 superuser 角色**,
--     而那種角色會拿到本片給的每一格。**這是刻意的, 因為正式庫那顆就是 `LOGIN + BYPASSRLS`** ——
--     擋掉它等於擋掉正式庫本身(`20260902210000:246-249` 那道守衛就是這樣寫的, 而它因此貼不進正式庫)。
--   ⇒ 補償:角色已存在時本片會把它**當下的屬性逐格印進 NOTICE**, 讓 log 上看得到「授權給了誰」。
--
-- ⚠️⚠️ **貼進正式庫會發生什麼**(2026-09-05 唯讀實測, `scripts/readonly-prod-sql.sh`, 帶正負對照)
--     角色 pcm_readonly 存在 ................... t  ⇒ CREATE ROLE 分支 **no-op**
--     schema public 的 USAGE ................... **直接 ACL 條目**(逐筆 aclexplode 量到 `pcm_readonly | USAGE | f`)
--       ⇒ 本片那句 `GRANT USAGE ON SCHEMA public` 在正式庫是**真 no-op**, 不是「靠 PUBLIC 蓋著」。
--       (codex 提的「可能只靠 PUBLIC ⇒ 日後 REVOKE FROM PUBLIC 會留下副作用」——**在正式庫上不成立, 量過了**;
--        在**空庫**上它確實是新增一條直接 ACL, 而那正是空庫需要的。)
--     public.admin_order_list_v SELECT ......... t  ⇒ **no-op**
--     public.search_queries SELECT ............. f  ⇒ 由**貼板 33** 授權, **不由本片**(見下)
--     public.order_pending_refunds SELECT ...... f  ⇒ 同上
--     正對照 public.orders SELECT .............. t  · 負對照 public.orders INSERT .. f(尺是活的)
--   ⚠️ **誤套時的失敗形狀**(codex must-fix):`GRANT` **即使目標已經有那個權限, 仍會重新檢查執行者的 grant option**
--     ⇒ 用一個不是 owner 也沒有轉授權的角色去跑本片, 會在那一行報錯並**整個交易回滾**。
--     ⇒ 那是「安全地失敗」, 而不是「安靜地成功」—— 寫出來是因為下一個人會問。
--
-- 🛑 **`cron` 那三條【不在本片】** —— 2026-09-05 codex 對抗審查 must-fix, 我採納並搬走。
--   理由:修 230000 的斷言**完全不需要 cron**;而本片若在一個**有 pg_cron 的新庫**上跑,
--   它會把 `cron.job` 開給一個空殼角色, 而 🔴 **`cron.job.command` 那一欄可能含 `Authorization` 標頭或金鑰**。
--   ⇒ 📌 **一個為了修斷言而存在的檔, 不應該順手打開一條憑證的路。**
--   ✅ 正本改放 `supabase/after-checks/grant-readonly-cron.sql`(與
--      `grant-readonly-select-search-refunds.sql` 同一個慣例:**那裡放的是「給人貼的授權」, 不進自動重播**)。
--   🔵 而正式庫上那三格 2026-09-05 實測**已經全 t** ⇒ 那支檔是**紀錄**, 不是待辦。
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 **本片【刻意不 apply 到正式庫】· 刻意不記帳本** —— 2026-09-05 主視窗 -f8 裁
-- ═══════════════════════════════════════════════════════════════════════════
--   ✅ **Sean 2026-09-05 拍板(逐字, 不是我的轉述)**:
--      「Q-唯讀兩表: 查證用的唯讀帳號能不能讀「客人搜尋字」「待退款」兩張表的內容
--        (它已經讀得到訂單表)。 甲 = 能(貼 33) / 乙 = 不能 / A: 甲|」
--   ⇒ 貼板 **33**(= `supabase/after-checks/grant-readonly-select-search-refunds.sql` 的複本)
--     已排給 Sean 貼。**那兩張表的授權由 33 落地, 不由本片落地。**
--   ⇒ 📌 **33 貼完之後, 本片對正式庫【每一格都是 no-op】。**
--   ⇒ 🛑 **不排給 Sean 貼、不記 `supabase/APPLIED.tsv`。**
--     零 app 碼依賴它, 部署時序閘不會問它。它存在的**唯一**理由是讓「從零重播」拿得到那個角色與授權。
--
--   ⚠️⚠️ **而「刻意不 apply」這個態, 帳本裡沒有** ——
--     `supabase/APPLIED.tsv` 只有「已 apply」四欄;`scripts/migration-ledger-divergence.sh`
--     會把本片判成 ④ `R H̄ P̄` =「**待套 PENDING(正常, 還沒 apply)**」⇒ ok, **不擋任何人**。
--     🔴 **那個態的名字自己在說它以後會被套 —— 而本片永遠不會。**
--     ⇒ 記在板列 **⟦b4-LEDGERNOAPPLY1⟧**(`docs/launch-todo.md:777`), 本片是**該態的第一個實例**。
--
-- 🔁 **冪等**:全部是 `GRANT`(重下等冪)+ 存在性守衛;**零 `REVOKE`**、零 `ALTER ROLE`。
-- ↩️ Rollback:`supabase/rollbacks/20260905160000-rollback.sql`(§R 全註解, **不可整段跑**, 理由在該檔)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- ── ① 角色:不存在才建 ───────────────────────────────────────────────────
DO $$
DECLARE r pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname = 'pcm_readonly';

  IF FOUND AND r.rolsuper THEN
    RAISE EXCEPTION '角色 pcm_readonly 已存在而它是 SUPERUSER ⇒ 那不是唯讀角色, 拒絕對它 GRANT';
  END IF;

  IF NOT FOUND THEN
    CREATE ROLE pcm_readonly NOLOGIN;
    RAISE NOTICE 'pcm_readonly 不存在 ⇒ 已建一個 NOLOGIN 空殼(無密碼 · 無 BYPASSRLS)。正式庫上它早就存在 ⇒ 那裡這一段是 no-op。';
  ELSE
    -- 🔴 守衛只擋 rolsuper(理由見檔頭)⇒ 把【放行了什麼】逐格印出來, 讓 log 答得出「授權給了誰」。
    RAISE NOTICE 'pcm_readonly 已存在 ⇒ 本片不動它任何屬性。當下屬性:rolsuper=% rolbypassrls=% rolcanlogin=% rolcreaterole=% rolreplication=% rolinherit=%',
      r.rolsuper, r.rolbypassrls, r.rolcanlogin, r.rolcreaterole, r.rolreplication, r.rolinherit;
  END IF;
END $$;

-- schema 的 USAGE:沒有它, 下面每一條 GRANT 都給得出來而角色一張表都讀不到。
-- 🔵 正式庫上這是真 no-op(逐筆 aclexplode 量到 pcm_readonly 已有直接條目, 不是靠 PUBLIC)。
GRANT USAGE ON SCHEMA public TO pcm_readonly;

-- ── ② 版控裡缺的那一支:斷言④ 依賴的 view ────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.admin_order_list_v') IS NULL THEN
    RAISE EXCEPTION '前置閘①:public.admin_order_list_v 不存在 ⇒ 本片排錯位置了(它應在 20260816050000 之後)';
  END IF;
  GRANT SELECT ON TABLE public.admin_order_list_v TO pcm_readonly;
END $$;

-- ── ③ 兩張表 ────────────────────────────────────────────────────────────
--    🔴 codex must-fix:原版「不存在就 NOTICE 略過」⇒ 一個排序錯誤會【安靜地】少給兩格,
--       而事後閘不查它 ⇒ 那個缺口永遠不會被補(後建的物件不會回頭拿授權)。
--       ⇒ 改成 EXCEPTION:這兩張表在本片的位置上**保證已存在**(20260904200000 / 20260901080000),
--         不存在就是排序出事了, 那要停下來而不是略過。
--    ⚠️ 正式庫上這兩條由**貼板 33** 落地(Sean 拍甲);本片跑到這裡時它們已是 t ⇒ no-op。
DO $$
BEGIN
  IF to_regclass('public.search_queries') IS NULL THEN
    RAISE EXCEPTION '前置閘②:public.search_queries 不存在 ⇒ 排序不對(它應在 20260904200000 之後)';
  END IF;
  IF to_regclass('public.order_pending_refunds') IS NULL THEN
    RAISE EXCEPTION '前置閘③:public.order_pending_refunds 不存在 ⇒ 排序不對(它應在 20260901080000 之後)';
  END IF;
  GRANT SELECT ON TABLE public.search_queries        TO pcm_readonly;
  GRANT SELECT ON TABLE public.order_pending_refunds TO pcm_readonly;
END $$;

-- ── ④ 事後閘 ────────────────────────────────────────────────────────────
--   🛑 **這一段量的是【授權】, 不是【查得動】**(codex must-fix 訂正)——
--      `admin_order_list_v` 是 security_invoker view, 空殼角色對底下的 `orders` 沒有權限
--      ⇒ 授權為 t 而真查會 `permission denied for table orders`。
--      ⇒ 那**不是**本片的缺陷:`20260905230000:257` 問的正是同一句「有沒有 SELECT 授權」,
--        本片先自己問一次, 讓「排在它前面有沒有用」在**本片**就有答案, 不必等 5 支之後。
DO $$
BEGIN
  IF to_regrole('pcm_readonly') IS NULL THEN
    RAISE EXCEPTION '事後閘①:角色 pcm_readonly 仍不存在 ⇒ 本片沒有達成它唯一的目的';
  END IF;

  IF NOT pg_catalog.has_table_privilege('pcm_readonly', 'public.admin_order_list_v', 'SELECT') THEN
    RAISE EXCEPTION '事後閘②:pcm_readonly 對 public.admin_order_list_v 沒有 SELECT 授權 ⇒ 20260905230000 的斷言④ 還是會紅';
  END IF;

  IF NOT pg_catalog.has_table_privilege('pcm_readonly', 'public.search_queries', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('pcm_readonly', 'public.order_pending_refunds', 'SELECT') THEN
    RAISE EXCEPTION '事後閘③:兩張表的 SELECT 沒有全給到 ⇒ 授權形狀與正式庫(貼板 33 後)不一致';
  END IF;

  -- 負對照:本片不給寫入。這一格若為 t, 是別處給的, 停下來查。
  IF pg_catalog.has_table_privilege('pcm_readonly', 'public.admin_order_list_v', 'INSERT') THEN
    RAISE EXCEPTION '事後閘④(負對照):pcm_readonly 竟然有 INSERT ⇒ 這不是本片給的, 停下來查';
  END IF;

  RAISE NOTICE '事後閘全過:角色在 · 三個物件都有 SELECT 授權 · 寫入沒給。(量的是授權, 不是查得動 —— 射程見本段註解)';
END $$;

COMMIT;
