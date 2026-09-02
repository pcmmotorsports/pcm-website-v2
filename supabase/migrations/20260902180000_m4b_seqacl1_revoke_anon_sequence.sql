-- ⟦b4-SEQACL1⟧ 收掉「沒登入的陌生人推得動 ID」—— public schema 的 4 支 IDENTITY 序列。
--
-- ══ 🔴 一句 Sean 讀得懂的話 ═══════════════════════════════════════════════════
--   顧客站的商品規格目錄是開放給任何人讀的(那是刻意的,見下方「不動什麼」)。
--   **而那幾張表的「流水號產生器」也一起開放了 —— 而它不只可以讀,還可以【改】。**
--   ⇒ 一個沒登入的陌生人,可以把下一筆資料的編號推走、或重設它。
--   🔵 **不是資料外洩**(他讀不到也寫不到表裡的資料,RLS 與表 ACL 都還在)。
--   🔴 **是編號跳掉 / 用完 / 下一筆存檔撞號。**
--
-- ══ 🔴🔴 為什麼收兩個角色, 而板上那一列只寫 anon(逐字寫在這裡, 免得下一個人以為我們多做了)══
--   板上 `⟦b4-SEQACL1⟧` 那一列寫的是 `anon` —— **而那是【量測產物】不是範圍決定**
--   (當時只問了 anon)。2026-09-02 實查:`authenticated` 對那四支**逐字相同**
--   (`SELECT+UPDATE+USAGE`,四支全部)。
--   ⇒ ⇒ **而只收 anon 會讓那一列被劃掉而洞還在一半 —— 而那一半沒有任何載體記得它。**
--   📌 而 Sean 2026-09-01 裁的「戊」是【動 GRANT = 獨立安全片】⇒ 那是**怎麼做**不是**做多少**
--      ⇒ 同一個根、同四支序列、同一支 migration、同一發斷言 ⇒ **那是同一片, 不是兩片。**
--
-- ══ 🔴 根因:`IDENTITY` 在旁邊另外生了一個物件 ═══════════════════════════════
--   四支**全部是 `IDENTITY ALWAYS` 自動建的**(`pg_depend.deptype='i'`)。
--   `GRANT`/`REVOKE` 我們寫在【表】上,而那個物件**不在任何人的視線裡**。
--   🔵 分母:`public` 的 IDENTITY 序列共 **6** 支 ⇒ anon 可用 **4**、乾淨 **2**
--      ⇒ 🎯 **不是「IDENTITY 一定會漏」, 是【有人明寫過那一支就乾淨】**
--      ⇒ ⇒ **所以修法是一道會叫的, 不是一條規則**(規則寫過而復發 —— 板上有紀錄)。
--   ✅ 而那道會叫的有兩半:**本支尾端的 catalog 全掃**(擋這一次)
--      + `scripts/public-sequence-acl.test.ts`(擋**下一張新表**)。
--      🛑 **而它【不是】每次三綠都跑**(codex must-fix 訂正):`greenlight.sh` 預設是
--         typecheck / lint / build 三項, **測試那一項要加 `--tests` 才跑**(不加時印 `tests=skip`,
--         而那是「沒跑」不是「綠」)⇒ 真正每次都跑它的是 **CI**。照實寫, 不要讓人以為它天天在守。
--
-- ══ 🛑 不動什麼(而這是量到的, 不是保守)═════════════════════════════════════
--   `anon` 對 `product_fitments` / `product_fitments_effective` 的 **SELECT ⇒ 保留, 一個字不動**。
--   `packages/adapters/src/supabase/helpers/fitment-queries.ts:154` 逐字寫著
--   「讀 `product_fitments_effective` 的 inherited 列(**anon SELECT + RLS 濾下架**)」;
--   而 `product_fitments` 沒有直讀,它是被 `search_products_by_vehicle` /
--   `search_catalog_by_vehicle` 讀的 —— **而那兩支 `prosecdef = f`(SECURITY INVOKER)**
--   ⇒ 函式本體用【呼叫者】的身分跑 ⇒ **anon 必須自己有那兩張表的 SELECT。**
--   🎯 ⇒ 而 sequence 的 `UPDATE`+`USAGE` **不在那條路上** —— 讀資料不需要序列權限。
--
-- ══ 🔴🔴 一個【本來會在 Sean 面前炸掉】的 bug, 是從零 replay 抓到的 ═══════════
--   第一版所有 `has_sequence_privilege()` 都寫成
--     `FROM pg_class c WHERE c.relkind='S' AND c.relname LIKE 'product_fitments%' AND has_...(c.oid, …)`
--   ⇒ 而 `product_fitments` **那張表**也命中那個 LIKE ⇒ planner 可能在套 `relkind='S'` 之前
--     就把表的 oid 餵進去 ⇒ `ERROR: "product_fitments" is not a sequence`。
--   🔴 **而正式庫上那張表也在** ⇒ **這一發本來會在他貼下去的當場炸掉。**
--   🛑 **而最毒的是它【時好時壞】**:同一支檔裡前置閘那一發**過了**(印了 NOTICE),
--      而驗證①炸了 —— **同一個寫法、同一顆庫、兩個結果** ⇒ 那是求值順序, 不是邏輯。
--   ✅ 修法:`WITH seqs AS MATERIALIZED (…relkind='S'…)` **先把序列篩出來再問權限**,
--      不靠 `WHERE` 的求值順序。📌 **⇒ 一個「看起來已經濾掉了」的條件, 不保證它先被求值。**
--
-- ══ 🔴🔴 根因【沒有被這一支修掉】—— 而它是量到的, 不是理論 ═══════════════════
--   2026-09-02 唯讀查 `pg_default_acl`(`defaclobjtype='S'`), `public` schema 有兩筆預設:
--     `postgres`       的預設 ⇒ `anon=w` · `authenticated=w` · `service_role=w`   (`w` = UPDATE)
--     `supabase_admin` 的預設 ⇒ `anon=rwU` · `authenticated=rwU` · `service_role=rwU`(全給)
--   🎯 **⇒ 下一支在 `public` 建起來的序列, 出生就會再給 anon 權限 —— 而這一支收不掉那個。**
--   ✅ **而不改它是【已經拍過的板】**(`20260828090000:606-612` 逐字):
--      「codex 要的根治是 `ALTER DEFAULT PRIVILEGES … ON SEQUENCES` —— 而那會影響 public
--        底下**所有人之後建的東西** ⇒ 跨線、跨窗 ⇒ **不是這一片能拍的**。
--        ✅ 裁決:**不改 schema 預設, 改裝一道會叫的尺。**」
--   🛑 **⇒ 所以本支的定位要寫死:它收掉【今天這四支】, 而根因仍在。**
--      **不得把 `⟦b4-SEQACL1⟧` 標成「已解決」** —— 它變成「不再安靜」, 不是「不會再發生」。
--
-- 🛑 **本支【不 apply】,走 Sean 手貼。** 命中鐵則 12 ②權限。

BEGIN;

SET LOCAL search_path = public, pg_catalog;

-- ── 0. 前置閘 ────────────────────────────────────────────────────────────────
DO $pre$
DECLARE
  r     record;
  v_cnt int;
BEGIN
  -- 角色都要在, 否則下面每一道 has_*_privilege 都會炸或失去意義
  FOR r IN SELECT unnest(ARRAY['anon', 'authenticated', 'service_role']) AS rolname LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.rolname) THEN
      RAISE EXCEPTION '前置閘:角色 % 不存在 ⇒ 本支的每一道斷言都失去意義', r.rolname;
    END IF;
  END LOOP;

  -- 四支都要在(名字寫死 ⇒ 少一支就停, 不要安靜地收三支)
  SELECT count(*) INTO v_cnt
    FROM pg_class c
   WHERE c.relkind = 'S' AND c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('product_fitments_id_seq',
                       'product_fitments_effective_id_seq',
                       'product_fitments_effective_staging_id_seq',
                       'product_fitments_effective_sync_log_id_seq');
  IF v_cnt <> 4 THEN
    RAISE EXCEPTION '前置閘:預期 4 支序列, 實得 % ⇒ 現況不是我以為的那一版', v_cnt;
  END IF;

  -- 🟢 正對照:**現在真的有東西可以收**(否則本支等於沒做, 而它會印一樣的綠)
  -- 🔴 **先把序列篩出來再問權限 —— 不要靠 WHERE 的求值順序。**
  --    `has_sequence_privilege()` 餵到一張【表】的 oid 會直接炸
  --    (`ERROR: "product_fitments" is not a sequence`), 而 `relname LIKE 'product_fitments%'`
  --    同時命中那張表。⇒ 用 `MATERIALIZED` CTE 釘住順序, **並且改用明列四個名字**
--    (`ESCAPE` 那條路第一版寫成兩個字元 ⇒ `ERROR: invalid escape string` —— 明列沒有那個問題)。
  WITH seqs AS MATERIALIZED (
    SELECT c.oid FROM pg_class c
     WHERE c.relkind = 'S' AND c.relnamespace = 'public'::regnamespace
       AND c.relname = ANY (ARRAY['product_fitments_id_seq',
                                  'product_fitments_effective_id_seq',
                                  'product_fitments_effective_staging_id_seq',
                                  'product_fitments_effective_sync_log_id_seq'])
  )
  -- 🔴 **三種權限都要問, 與驗證①一致**(code-reviewer nit):前一版只問 `USAGE`
  --    ⇒ 某支只剩 `SELECT`/`UPDATE` 時, 這道閘會判「已經收過了」而中止
  --    ⇒ ⇒ **洞還開著, 而訊息說它關了。**
  SELECT count(*) INTO v_cnt FROM seqs
   CROSS JOIN (VALUES ('anon'), ('authenticated')) AS g(rolname)
   CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS pr(priv)
   WHERE has_sequence_privilege(g.rolname, seqs.oid, pr.priv);
  IF v_cnt = 0 THEN
    RAISE EXCEPTION
      '前置閘:那四支現在對 anon/authenticated 都已經沒有 USAGE ⇒ 看起來已經收過了, 不重複執行';
  END IF;
  RAISE NOTICE '前置閘:收之前有 % 筆(序列×角色×權限)對 anon/authenticated 開著', v_cnt;
END $pre$;

-- ── 1. 收 ────────────────────────────────────────────────────────────────────
--   🔴 **逐支具名, 不用 `EXECUTE format()`**:板上三個實例都指同一件事 ——
--      **按名字判的尺, 對動態組出來的名字恆印 0**(`acl-drift-gate` 的 R6 · `static-checks` 規則④
--      · 以及查它的那一發 grep 本身)。寫成字面, 那三道都看得到。
--
--   🛑🛑 **而寫死名字有一個【已知的坑】, 我知道它而仍然寫死 —— 理由與安全網寫在這裡:**
--     `20260828080000:172-178` 逐字記著:schema 裡若已有【同名的孤兒 sequence】,
--     PG 會給 identity 那支一個**帶尾碼的新名字** ⇒ 寫死的 `REVOKE` 會去撤那個舊的、
--     而舊的本來就沒權限 ⇒ **全綠, 而真正掛在欄上的那支保留預設 ACL。**
--     ⇒ 📌 **那不是「名字打錯」(會大聲報錯), 是「名字沒錯而指到別的東西」。**
--   ✅ **為什麼這裡仍然安全 —— 而理由是量到的不是推的**:
--     這四個名字**不是我從表名組出來的**, 是 2026-09-02 唯讀查
--     `pg_class` JOIN `pg_depend`(`deptype='i'`)**當場列出來的那四支**
--     ⇒ **它們就是掛在欄上的那一支, 不是同名的別人。**
--   ✅ **而安全網是驗證④**:它掃的是 **catalog 底下 `public` 的每一支序列**, 不看名字
--     ⇒ 🎯 **就算上面四行有一行撤錯了物件, ④ 也會看到那支真的還開著 ⇒ RAISE。**
--     ⇒ ⇒ **所以「寫死」在這裡只是可讀性的選擇, 不是正確性的依賴。**
--
--   🔵 **`FROM` 那一串含 `PUBLIC`, 而 repo 三發前例全含**(`20260604120000:61` ·
--     `20260828080000:186` · `20260830130000:211`)。2026-09-02 唯讀實測:`public` 底下
--     **沒有任何一支序列授權給 `PUBLIC`**(`aclexplode` 的 `grantee = 0` ⇒ 0 列)
--     ⇒ 所以它今天是**零效果的一個字**;而少了它, 哪天 PUBLIC 真的拿到權限時
--     驗證① 會 `RAISE` ⇒ **在 Sean 貼下去的當場整支 abort**(fail-closed 不會假綠, 但那是
--     一個字就能消掉的 abort 路徑)。
REVOKE ALL PRIVILEGES ON SEQUENCE public.product_fitments_id_seq                    FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.product_fitments_effective_id_seq          FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.product_fitments_effective_staging_id_seq  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON SEQUENCE public.product_fitments_effective_sync_log_id_seq FROM PUBLIC, anon, authenticated;

-- ── 2. 事後斷言 ──────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  r      record;
  v_cnt  int;
  v_list text;
BEGIN
  -- ① 🔴 那四支對 anon / authenticated 的三種權限全部不能有
  WITH seqs AS MATERIALIZED (
    SELECT c.oid, c.relname FROM pg_class c
     WHERE c.relkind = 'S' AND c.relnamespace = 'public'::regnamespace
       AND c.relname = ANY (ARRAY['product_fitments_id_seq',
                                  'product_fitments_effective_id_seq',
                                  'product_fitments_effective_staging_id_seq',
                                  'product_fitments_effective_sync_log_id_seq'])
  )
  SELECT count(*), coalesce(string_agg(DISTINCT seqs.relname, ', '), '(無)')
    INTO v_cnt, v_list
    FROM seqs
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS g(rolname)
    CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS p(priv)
   WHERE has_sequence_privilege(g.rolname, seqs.oid, p.priv);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '驗證①:收完之後還有 % 筆殘留(%)⇒ REVOKE 沒有全中', v_cnt, v_list;
  END IF;

  -- ② 🟢 **正對照 A —— 而它守的是【客人看得到的東西】, 不是測試的完整性。**
  --    沒有這一格, 一發「把 anon 全收乾淨」的 migration 也會通過 ——
  --    而那會讓顧客站的商品規格目錄**當場空掉**。
  FOR r IN SELECT unnest(ARRAY['product_fitments', 'product_fitments_effective']) AS tbl LOOP
    IF NOT has_table_privilege('anon', 'public.' || r.tbl, 'SELECT') THEN
      RAISE EXCEPTION
        '驗證②:anon 對 % 的 SELECT 不見了 ⇒ 顧客站的商品規格目錄會空掉。本支不該碰它。', r.tbl;
    END IF;
  END LOOP;

  -- ③ 🟢 **正對照 B —— 它只證【service_role 的 USAGE 還在】。**
  --    🛑 **不得讀成「同步安全」**(codex must-fix):我**沒有量到**那個同步實際用哪個角色跑。
  --       若真正的寫入端靠 `authenticated` 而不是 `service_role` ⇒ 這一格全綠而同步已經壞了。
  --    ⇒ 📌 **它守的是「我沒有把 service_role 一起收掉」, 不是「寫入端還活著」。**
  --    🔵 我證得出的只有:應用層(apps/ + packages/)對那幾張表的 insert/upsert ⇒ **0 命中**。
  WITH seqs AS MATERIALIZED (
    SELECT c.oid FROM pg_class c
     WHERE c.relkind = 'S' AND c.relnamespace = 'public'::regnamespace
       AND c.relname = ANY (ARRAY['product_fitments_id_seq',
                                  'product_fitments_effective_id_seq',
                                  'product_fitments_effective_staging_id_seq',
                                  'product_fitments_effective_sync_log_id_seq'])
  )
  SELECT count(*) INTO v_cnt FROM seqs
   WHERE has_sequence_privilege('service_role', seqs.oid, 'USAGE');
  IF v_cnt <> 4 THEN
    RAISE EXCEPTION
      '驗證③:service_role 對那四支的 USAGE 只剩 % 支 ⇒ 我把寫入端一起收掉了', v_cnt;
  END IF;

  -- ④ 🔴 **全掃**:`public` 底下【任何一支】序列都不准對 anon / authenticated 開著。
  --    ⇒ 這一格比①寬:①守這四支, ④守**這個 schema**(含以後新長出來的)。
  --    🔵 掃的是 catalog 不是名字 —— 名字可以是動態組的、可以叫任何東西。
  --    ✅ **貼之前量過整個分母**(2026-09-02 唯讀):`public` 的序列共 **7** 支,
  --       而對 anon / authenticated 有任一權限的**恰好是這 4 支** ⇒ 收完之後 ④ 會是 0。
  --       📌 那一發是為了不讓 ④ 抱著一支【沒量過的序列】在 Sean 面前 abort。
  WITH seqs AS MATERIALIZED (
    SELECT c.oid, c.relname FROM pg_class c
     WHERE c.relkind = 'S' AND c.relnamespace = 'public'::regnamespace
  )
  SELECT count(*), coalesce(string_agg(DISTINCT seqs.relname, ', '), '(無)')
    INTO v_cnt, v_list
    FROM seqs
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS g(rolname)
    CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS p(priv)
   WHERE has_sequence_privilege(g.rolname, seqs.oid, p.priv);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION
      '驗證④:public 底下還有 % 筆序列權限對 anon/authenticated 開著(%)'
      ' ⇒ 那不是這四支, 是別的東西 ⇒ 停下來人工看', v_cnt, v_list;
  END IF;

  -- ⑤ 🔵 負對照 —— 🛑 **而它【不是】④ 那把尺的自檢**(codex nit, 照實降級):
  --    它只證「一個現造的名字現在不存在」, **完全沒走 ④ 的權限 / 角色 / CTE 那條路**
  --    ⇒ ④ 若壞成恆零, 這一格照樣綠。⇒ 它擋的是「`relname` 比對整個壞掉」那一種, 分母就這麼窄。
  SELECT count(*) INTO v_cnt
    FROM pg_class c
   WHERE c.relkind = 'S' AND c.relnamespace = 'public'::regnamespace
     AND c.relname = 'zzq_no_such_sequence_0902';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '驗證⑤自檢:負對照命中一個不存在的序列 ⇒ 量具可疑';
  END IF;

  RAISE NOTICE '✅ 20260902180000:四支序列已對 anon+authenticated 收乾淨;'
               'public 全掃 0 筆殘留;顧客站 SELECT 與 service_role 寫入權限都還在';
END $verify$;

COMMIT;

-- ══ 🛑 這一支證不到什麼 ═══════════════════════════════════════════════════════
--   · 它驗的是**這一瞬間**的 catalog。migration 從不 replay ⇒ apply 之後沒有東西會再量。
--     ⇒ 🔵 **會再量的那一半在 `scripts/public-sequence-acl.test.ts`** —— 而它跑在 CI 與
--       `greenlight.sh --tests`, **不是每次三綠**(不加 `--tests` 時那一項印 `skip` = 沒跑)。
--   · 🔴 **我沒有驗「收完之後顧客站那條路還走得通」** —— 我只論證了「讀資料不需要序列權限」,
--     而那是**從 PG 的語意推的**, 不是跑過那條路量的。
--     ⇒ 驗證②守住「表的 SELECT 還在」, 而**真正走一遍**由 Sean 貼完看畫面承擔。
--   · 🔴 **不驗「anon 真的能 nextval」** —— 那要 `SET ROLE`, 而那是**會改變序號的破壞性動作**。
--     ⇒ **不論誰批准都不做。**我證的是【權限在】, 不是【他試過而且成功】—— 那是兩個宣稱。
--   · 範圍**只有 `public`**(主視窗 2026-09-02 裁)。`net` / `storage` / `cron` / `vault` 那幾個
--     我們**結構上收不掉**(grantor 不是我們)⇒ 閘掛在那裡叫出來也沒有人能修
--     ⇒ ⇒ **它會變成一道恆紅的閘, 而恆紅的閘會被關掉。**
--     📌 **判準:一道閘的射程, 由【它叫的時候有沒有人能修】決定, 不由【那裡有沒有問題】決定。**
