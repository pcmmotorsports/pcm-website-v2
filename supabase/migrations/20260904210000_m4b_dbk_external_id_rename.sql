-- 20260904210000_m4b_dbk_external_id_rename.sql
-- DBK 63 件商品的 `products.external_id` 跟著官網改成新料號(**改名, 不是搬家**)。
--
-- ══ 🔴 誰拍的 · 誰貼 ═══════════════════════════════════════════════════════
-- Sean 2026-09-04 拍板, 原話逐字「那....我要換成新料號才對」。
-- 交辦原文(逐字轉錄, 由 Sean 本人貼進主視窗):
--   `~/pcm-mailbox/交辦-DBK63件external_id改名-20260904.md`
-- 🔴 **這支由 Sean 本人在 Supabase SQL Editor 貼** —— 本窗只有唯讀權限,
--    而**唯讀與 apply 是兩個授權, 他只給了前一個**。
--
-- ══ 🛑🛑 順序(這一段最重要, 錯了會把 63 件的車款資料算錯)═════════════════
--   1. **先貼這一支**(顧客站改)
--   2. 改完告訴 Sean ⇒ 他叫報價單那邊跑 fetcher(那一刻報價單的 `main_sku` 才會變)
--   3. **兩邊都改完之後**才跑 `sync_storefront_fitments.py`
--   ⚠️ **中間不要跑它** —— 那段時間兩邊的鍵對不上。
--   (對應鍵的依據:`PCM報價單-V2/scripts/sync_storefront_fitments.py:10` 逐字
--    「對應鍵: view.main_sku ↔ 網站 products.external_id(同 supplier_slug)」)
--
-- ══ 🔴 Sean 要知道的一件事(改完之後會發生, 而它是那個決定的一部分)═════════
--   **客人打【舊料號】搜尋會搜不到。**
--   `external_id` 就是客人在商品頁上看到的那個料號, 而搜尋拿它比對
--   (`packages/adapters/src/supabase/helpers/product-query-support.ts` 錨
--    「`external_id` 就是客人在商品頁上看到的那個料號」;
--    `20260904030000` / `20260904180000` 兩支搜尋 migration 也拿它比對料號)。
--   ⇒ 官網已經沒有舊料號了, 所以這是「跟著官網改」的一部分, **不是這支的缺陷**。
--
-- ══ 🔴 數字是本窗【自己重驗】的, 不是照收交辦單 ═════════════════════════════
--   唯讀正式庫 2026-09-04 19:26:
--     對照筆數 63 · 舊值找得到 **62** · 舊值找不到 **1** · 新值已被佔用 0 · dbk 母體 1508
--   🔴 **交辦單寫「找得到 63 / 找不到 0」—— 那一格不符。**
--   找不到的是 `CFD105/D29`(新值 `CFD105/D29E`):不限 supplier 查 ⇒ 不存在,
--   不是掛在別的供應商;它的**新值也不存在**。
--   而 `CFD105` 這一族顧客站有 24 筆、**每一筆都以 `E` 結尾** ⇒ 那一列與其說是改名,
--   不如說是補上這一族本來就有的 `E`, 而顧客站根本沒有那一件。
--   ⇒ 📌 **所以這支要改的是 62 列, 不是 63。**
--
-- ══ 🛑 前置閘擋下來的時候, 下一步是什麼 ═════════════════════════════════════
--   下面的斷言把「62」與「唯一缺的那個是 `CFD105/D29`」都釘死了。
--   🔴 **而那是【2026-09-04 19:26 量到的世界】** —— 若貼的時候有人把那件補進來了,
--      或又有別的舊值消失了, **這支會整支擋下、什麼都不做**。
--   ✅ **那是對的行為。** 被擋的時候要做的是**重量一次、改那個數字並說明為什麼變**,
--      **不是把斷言拿掉**。
--
-- ══ 天花板:這支【證不到】什麼 ═══════════════════════════════════════════════
--   · 它不驗「新料號是對的」—— 對照表來自報價單那邊, 本支只負責照它改。
--   · 它不碰 `product_variants.sku`、不碰 `handle`(網址用 handle, 與本支無關;
--     實測 repo 內 `handle` 與 `external_id` **零推導關係**)。
--   · 它不重建 sitemap、不重新部署 —— 那是貼完之後的事。

-- ══ codex 對抗審查 R1(2026-09-04, 鐵則 12③ 不降級):3 must-fix 全折, 6 nit 折 2 ═══
--
-- **折了的**
--   must-fix ① 隔離級別 ⇒ REPEATABLE READ + lock_timeout + 那 62 列 FOR UPDATE(見下)
--   must-fix ② 收權斷言只驗 anon/authenticated ⇒ 補 service_role / PUBLIC / 欄級 / RLS / 零 policy
--     🟢 突變證過:拿掉 `REVOKE … FROM service_role` ⇒ 斷言紅;拿掉 `ENABLE ROW LEVEL SECURITY` ⇒ 斷言紅
--     🔴 而**要在 fixture 上加 `ALTER DEFAULT PRIVILEGES … GRANT ALL … TO anon, authenticated, service_role`
--        那兩發突變才殺得掉斷言** —— 少了它, fixture 上刪掉 REVOKE 也全綠, 而那會讓我以為斷言是好的。
--   must-fix ③ 回滾 SQL 會覆蓋後續合法改動 ⇒ 回滾條件加上「現值仍是當初改成的那個值」(見表註解)
--   nit lock_timeout ⇒ 已加(15s);statement_timeout 60s
--
-- **【沒折】的, 明寫**
--   nit 閘⑤(舊值對到多列):真 schema 已有 `(supplier_slug, external_id)` UNIQUE
--     ⇒ 在正式庫上**零額外判別力**。留著的理由是它在**沒有那個 UNIQUE 的世界**(例如本片的
--     fixture、或未來有人拿掉那個索引)仍會叫 ⇒ 便宜的縱深, 而**不要把它讀成「這一格驗過了」**。
--   nit 事後④(母體前後相同):對純 UPDATE **近乎恆真** —— 把 UPDATE 擴成改更多列也殺不掉它。
--     它擋的是「同一刻有人新增/刪除 dbk 列」, 而那正是它可能**假紅**的來源。**兩邊都寫在這裡。**
--   nit fixture 的天花板:最小 fixture **沒有**正式 schema 的複合 UNIQUE、`external_id` 的 trigram
--     GIN 索引、以及全列 BEFORE UPDATE trigger ⇒ **正式庫上會多出索引維護、唯一鍵等待與 trigger 成本**,
--     而本片**沒有量過那個成本**。
--   nit「部分成功後仍 COMMIT」:codex 查無這種路徑(DDL/快照/UPDATE 都在同一交易);
--     剩下的只有 **COMMIT 當下斷線 ⇒ 結果未知** ⇒ 那時**先 read-back 再決定要不要重跑**, 不要直接重貼。
--
BEGIN;

-- ══ 🔴 must-fix ①(codex 2026-09-04):前置閘與 UPDATE 之間有一個【別人可以插隊】的窗 ══
--   預設 READ COMMITTED 下, 每一句 SQL 看到不同快照 ⇒ 閘量到 62、UPDATE 執行時可能已經不是那 62 列
--   (報價單那邊的 fetcher、或任何人的手動改動)。
--   ✅ 兩道一起下:
--     · REPEATABLE READ ⇒ 整個交易一個快照;真的撞到並發寫入會【報序列化錯誤而整支退回】,
--       不會靜靜地改到別的東西。
--     · lock_timeout ⇒ 等鎖等不到就失敗, 不要無限期卡住線上流量。
--   🛑 而**光靠隔離級別不夠** —— 下面閘③之後還會把那 62 列 FOR UPDATE 鎖住,
--      理由:REPEATABLE READ 讓我【看見】衝突, 而 FOR UPDATE 讓我【先佔住】。
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '60s';

-- ── 0. 對照表(63 列;第 63 列是那個顧客站沒有的, **刻意留著讓斷言看得到它**)───
CREATE TEMP TABLE _dbk_rename(old_id text PRIMARY KEY, new_id text NOT NULL) ON COMMIT DROP;

INSERT INTO _dbk_rename(old_id, new_id) VALUES
    ('BM21K', 'BM21'),
    ('BRM07K', 'BRM07'),
    ('CC1990102GE', 'CC119902GE'),
    ('CCDV14DD', 'CCDV14'),
    ('CFD105/D29', 'CFD105/D29E'),
    ('CM13A', 'CM13'),
    ('CSSF01DA', 'CSSF01'),
    ('CUP27DK', 'CUP27'),
    ('CUP28DK', 'CUP28'),
    ('CVS03A', 'CVS03'),
    ('D205KIT', 'D20509469I'),
    ('DA04D', 'DA04'),
    ('GR25K', 'GR25'),
    ('KAPM05', 'KAPM05D'),
    ('KRND02K', 'KRND02'),
    ('KVT71K', 'KVT71'),
    ('KVT72D', 'KVT72'),
    ('KVT73K', 'KVT73'),
    ('KVT74K', 'KVT74'),
    ('KVT75K', 'KVT75'),
    ('KVT76K', 'KVT76'),
    ('KVT77K', 'KVT77'),
    ('KVT91K', 'KVT91'),
    ('L11 ULTIMATE', 'L11'),
    ('L12 ULTIMATE', 'L12'),
    ('L13 ULTIMATE', 'L13'),
    ('L14 EVO', 'L14'),
    ('L15 EVO', 'L15'),
    ('L15V-BRAKE', 'L15-BRAKE'),
    ('L16 EVO', 'L16'),
    ('L17 ULTIMATE', 'L17'),
    ('L18 EVO', 'L18'),
    ('L19 ULTIMATE', 'L19'),
    ('L20 EVO', 'L20'),
    ('L21 ULTIMATE', 'L21'),
    ('L22 EVO', 'L22'),
    ('L23 ULTIMATE', 'L23'),
    ('L24 EVO', 'L24'),
    ('L25 ULTIMATE', 'L25'),
    ('L26 EVO', 'L26'),
    ('L27 ULTIMATE', 'L27'),
    ('L28 EVO', 'L28'),
    ('L29 ULTIMATE', 'L29'),
    ('L30 EVO', 'L30'),
    ('L31 ULTIMATE', 'L31'),
    ('L32 ULTIMATE', 'L32'),
    ('L33 ULTIMATE', 'L33'),
    ('L34 EVO', 'L34'),
    ('L35 ULTIMATE', 'L35'),
    ('L36 EVO', 'L36'),
    ('LE16A', 'LE16'),
    ('LEA16A', 'LEA16'),
    ('PAP02D', 'PAP02'),
    ('PFAN10K', 'PFAN10'),
    ('PSA06D', 'PSA06'),
    ('PT13OP', 'PT13-OP'),
    ('PTKTM01K', 'PTKTM01'),
    ('ROND13K', 'ROND13'),
    ('RPRC07', 'RPRC07D'),
    ('SM06D', 'SM06'),
    ('TOO05K', 'TOO05'),
    ('TOO07K', 'TOO07'),
    ('TTKTM01K', 'TTKTM01');

-- ── 1. 前置閘 ────────────────────────────────────────────────────────────────
DO $gate$
DECLARE
  v_rows       int;
  v_hit        int;
  v_collide    int;
  v_pop        int;
  v_missing    text[];
BEGIN
  SELECT count(*) INTO v_rows FROM _dbk_rename;
  IF v_rows <> 63 THEN
    RAISE EXCEPTION 'dbk-rename 閘①:對照表應為 63 列, 實得 %', v_rows;
  END IF;

  -- 🟢 正對照:母體非空。母體是 0 的話下面每一格都會「通過」, 而那是尺沒接上。
  SELECT count(*) INTO v_pop FROM public.products WHERE supplier_slug = 'dbk';
  IF v_pop < 1 THEN
    RAISE EXCEPTION 'dbk-rename 閘②:supplier_slug=dbk 的母體是 0 ⇒ 尺沒接上, 不是沒事做';
  END IF;
  -- 🔴 把【改之前】的母體數存起來, 給事後④用。
  --    ⛔ ~~原本事後④寫死 1508~~ —— 那是 2026-09-04 19:26 的快照, 而 dbk 的商品會增減
  --    ⇒ 它會在某一天【擋下一支完全正確的改名】, 而擋的理由與這支要防的東西無關。
  --    ✅ 真正的不變式是「**改名不動列數**」⇒ 同一個交易裡前後比, 那個不會過期。
  CREATE TEMP TABLE _dbk_pop(before_n int NOT NULL) ON COMMIT DROP;
  INSERT INTO _dbk_pop(before_n) VALUES (v_pop);

  SELECT count(*) INTO v_hit
    FROM _dbk_rename m
    JOIN public.products p ON p.external_id = m.old_id AND p.supplier_slug = 'dbk';
  IF v_hit <> 62 THEN
    RAISE EXCEPTION 'dbk-rename 閘③:舊值命中應為 62(2026-09-04 19:26 量), 實得 % '
      '⇒ 世界變了。重量一次、改這個數字並說明為什麼變, 不要把這道閘拿掉。', v_hit;
  END IF;

  -- 🔴 must-fix ①(續):把那 62 列【先鎖住】, 之後的斷言與 UPDATE 才是對著同一批列說話。
  --    ⚠️ 這一句本身也可能等鎖 —— 上面的 lock_timeout 讓它等不到就整支失敗, 而不是卡住。
  PERFORM 1 FROM public.products p
    JOIN _dbk_rename m ON p.external_id = m.old_id
   WHERE p.supplier_slug = 'dbk'
     FOR UPDATE;

  -- 🔴 只釘數字不夠 —— 少了一個 A 而多了一個 B, 總數一樣。把【缺的是誰】也釘死。
  SELECT array_agg(m.old_id ORDER BY m.old_id) INTO v_missing
    FROM _dbk_rename m
   WHERE NOT EXISTS (SELECT 1 FROM public.products p
                      WHERE p.external_id = m.old_id AND p.supplier_slug = 'dbk');
  IF v_missing IS DISTINCT FROM ARRAY['CFD105/D29']::text[] THEN
    RAISE EXCEPTION 'dbk-rename 閘④:顧客站缺的舊值應為 {CFD105/D29}, 實得 %', v_missing;
  END IF;

  -- 每個舊值恰好一列(改名的前提)
  IF EXISTS (SELECT 1 FROM public.products p JOIN _dbk_rename m ON p.external_id = m.old_id
              WHERE p.supplier_slug = 'dbk'
              GROUP BY p.external_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'dbk-rename 閘⑤:有舊值對到多列 ⇒ 這不是改名, 停';
  END IF;

  SELECT count(*) INTO v_collide
    FROM _dbk_rename m
    JOIN public.products p ON p.external_id = m.new_id AND p.supplier_slug = 'dbk';
  IF v_collide <> 0 THEN
    RAISE EXCEPTION 'dbk-rename 閘⑥:新值已被佔用 % 筆 ⇒ 改下去會撞號, 停', v_collide;
  END IF;
END
$gate$;

-- ── 2. 回滾快照(一張【真的表】, 不是註解)────────────────────────────────────
-- 🔴 為什麼是表不是註解:回滾時要拿得到「這一列本來是什麼」, 而註解不會跟著資料走。
CREATE TABLE public.dbk_external_id_rename_20260904 (
  product_id      uuid        PRIMARY KEY,
  old_external_id text        NOT NULL,
  new_external_id text        NOT NULL,
  taken_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.dbk_external_id_rename_20260904 IS
  'DBK 63 件 external_id 改名(2026-09-04)的回滾快照。零 PII、零金額。'
  '🔴 回滾 SQL(must-fix, codex 2026-09-04):必須帶【現值仍是當初改成的那個值】這個條件 —— '
  '不然商品之後又被合法改過料號時, 照著回滾會【無條件覆蓋掉那次改動】。 '
  'UPDATE public.products p SET external_id = s.old_external_id '
  'FROM public.dbk_external_id_rename_20260904 s '
  'WHERE p.id = s.product_id AND p.external_id = s.new_external_id; '
  '⇒ 回完之後比一次:受影響列數應為 62;少於 62 表示有列已經被改過, 那幾列【不要硬回】, 去看它。';

-- 🔴 新表出生自帶 anon/authenticated/service_role 的預設授權(E683-1 那族)⇒ 當場收掉。
--    **兩道都要下**:FROM PUBLIC 收不到具名授權, FROM 具名 收不到 PUBLIC 授權。
-- static-checks:no-grant-needed 這張是【回滾快照】, 只有貼這支的人(postgres)需要讀它。
--   給 anon / authenticated / service_role 任何一格都是純粹的暴露面:
--   它逐列存著「哪一個商品的料號被改成什麼」, 而**沒有任何一支程式要讀它**。
--   ⇒ 回滾的人是 Sean 本人在 SQL Editor 裡跑, 那條連線是 postgres, 不受這幾道 REVOKE 影響。
--   🔴 而 RLS 開著而【零 policy】= 對非 owner 全擋 —— 那正是這張表要的形狀。
REVOKE ALL ON public.dbk_external_id_rename_20260904 FROM PUBLIC;
REVOKE ALL ON public.dbk_external_id_rename_20260904 FROM anon;
REVOKE ALL ON public.dbk_external_id_rename_20260904 FROM authenticated;
REVOKE ALL ON public.dbk_external_id_rename_20260904 FROM service_role;

-- RLS-GATE-EXEMPT: dbk_external_id_rename_20260904 -- 回滾快照, 【沒有任何程式要讀它】。
--   唯一會讀它的人是 Sean 本人在 Supabase SQL Editor 跑回滾, 而那條連線是 postgres
--   ⇒ 不受 RLS 限制。給 service_role 一條 policy 等於為一個【不存在的讀取者】開門。
--   🔴 而本檔自己的收權斷言要求這張表【零 policy】⇒ 加一條 policy 會讓那個斷言當場紅。
ALTER TABLE public.dbk_external_id_rename_20260904 ENABLE ROW LEVEL SECURITY;

-- 新物件收權斷言(樣板逐字抄自 20260817070000_m4b_231_3_sweeper_heartbeat.sql, 只換關聯名)
--   它證的是【收乾淨了】, 不是【我寫了 REVOKE】:權限型別由伺服器 acldefault() 推導、
--   不手寫(PG 之後再加一種, 這一臂自動入列);而欄級授權另外問
--   (has_table_privilege 對只有欄級授權的情況回 false)。
DO $newobj_guard$
DECLARE
  -- 🔴 結尾的 ::text[] 不能拿掉 —— 清單清空時 ARRAY[] 無法推斷型別。
  v_relations text[] := ARRAY[
    'public.dbk_external_id_rename_20260904'
  ]::text[];
  v_functions text[] := ARRAY[]::text[];
  v_declares_nothing boolean := false;

  r          text;
  v_oid      oid;
  v_bad      int := 0;
  v_first    text;
  v_checked  int := 0;
  v_priv     text;
  v_col      text;
BEGIN
  IF cardinality(v_relations) = 0 AND cardinality(v_functions) = 0 THEN
    IF NOT v_declares_nothing THEN
      RAISE EXCEPTION
        '新物件收權斷言:兩份清單都是空的。本檔若真的沒新建物件，請把 v_declares_nothing 設成 true（明示），不要留空。';
    END IF;
    RAISE NOTICE '新物件收權斷言:本檔明示未新建任何物件，略過（已留痕）。';
    RETURN;
  END IF;

  FOREACH r IN ARRAY v_relations LOOP
    v_oid := to_regclass(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到關聯 % —— 名字打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    -- 🔴🔴 **權限清單由伺服器推導,不手寫**(codex 2026-08-17 `must-fix`)。
    --    E-684 樣板手寫七種,而 **PG 17 有八種 —— 少了 `MAINTAIN`**。
    --    而本檔自己的病構造輸出就印著 `anon=MAINTAIN` ⇒ **樣板掃不到它自己舉的那個例子。**
    --    改成從 `acldefault('r', owner)` 推導:PG 之後再加第九種,這一臂自動入列。
    --    📎 同一個修法 B1-b 已經走過(`docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql:343-346`)。
    --    🔴 `DISTINCT` 在這裡是承重的:這是迴圈,同一權限型別出現兩次會讓 v_bad 多加一次。
    FOR v_priv IN
      SELECT DISTINCT d.privilege_type
        FROM aclexplode(acldefault('r', (SELECT relowner FROM pg_class WHERE oid = v_oid))) d
    LOOP
      -- 🔴 must-fix ②(codex 2026-09-04):樣板只問 anon / authenticated
      --    ⇒ 把 service_role 那道 REVOKE 刪掉、或給 PUBLIC 任何一格, 這個斷言【照樣綠】。
      --    ⇒ 三個都問。(PUBLIC 用 has_table_privilege('public', …) 問得到。)
      IF has_table_privilege('anon', v_oid, v_priv)
         OR has_table_privilege('authenticated', v_oid, v_priv)
         OR has_table_privilege('service_role', v_oid, v_priv)
         OR has_table_privilege('public', v_oid, v_priv) THEN
        v_bad := v_bad + 1;
        IF v_first IS NULL THEN v_first := format('%s 上仍有 %s', r, v_priv); END IF;
      END IF;
    END LOOP;

    -- 🔴🔴 欄級授權必須另外問 —— `has_table_privilege` 對【只有欄級授權】的情況回 false。
    FOR v_col IN
      SELECT a.attname FROM pg_attribute a
       WHERE a.attrelid = v_oid AND a.attnum > 0 AND NOT a.attisdropped
    LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        IF has_column_privilege('anon', v_oid, v_col, v_priv)
           OR has_column_privilege('authenticated', v_oid, v_col, v_priv)
           OR has_column_privilege('service_role', v_oid, v_col, v_priv)
           OR has_column_privilege('public', v_oid, v_col, v_priv) THEN
          v_bad := v_bad + 1;
          IF v_first IS NULL THEN
            v_first := format('%s.%s 上仍有【欄級】%s', r, v_col, v_priv);
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOREACH r IN ARRAY v_functions LOOP
    v_oid := to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到函式 % —— 簽名打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN v_first := format('%s 上仍有 EXECUTE', r); END IF;
    END IF;
  END LOOP;

  IF v_checked = 0 THEN
    RAISE EXCEPTION '新物件收權斷言:檢查數為 0 —— 這個斷言沒有分母，不算通過。';
  END IF;

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      E'❌ 新物件收權斷言失敗:anon/authenticated/service_role/PUBLIC 仍持有 % 項權限（第一個:%）。檢查了 % 個物件。\n'
      '   ⇒ 補上:REVOKE ALL ON <物件> FROM PUBLIC, anon, authenticated;\n'
      '   🔴 兩道都要下:FROM PUBLIC 收不到具名授權，FROM 具名 收不到 PUBLIC 授權。',
      v_bad, v_first, v_checked;
  END IF;

  -- 🔴 must-fix ②(續):RLS 也要驗 —— 刪掉那一行 ENABLE ROW LEVEL SECURITY 的話,
  --    上面每一格【照樣綠】(REVOKE 與 RLS 是兩道獨立的門)。
  --    而這張表【零 policy】⇒ RLS 開著 = 對非 owner 全擋, 那正是它要的形狀。
  IF NOT EXISTS (SELECT 1 FROM pg_class
                  WHERE oid = to_regclass('public.dbk_external_id_rename_20260904')
                    AND relrowsecurity) THEN
    RAISE EXCEPTION '新物件收權斷言:快照表沒有開 RLS ⇒ REVOKE 過了不代表這張表擋得住';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public'
                AND tablename = 'dbk_external_id_rename_20260904') THEN
    RAISE EXCEPTION '新物件收權斷言:快照表【有 policy】⇒ 它應該零 policy(全擋)';
  END IF;

  RAISE NOTICE '✅ 新物件收權斷言通過:檢查 % 個物件，anon/authenticated/service_role/PUBLIC 權限 0 項，且 RLS 開著、零 policy。', v_checked;
END
$newobj_guard$;

INSERT INTO public.dbk_external_id_rename_20260904(product_id, old_external_id, new_external_id)
SELECT p.id, m.old_id, m.new_id
  FROM _dbk_rename m
  JOIN public.products p ON p.external_id = m.old_id AND p.supplier_slug = 'dbk';

-- ── 3. 改名(**只有 UPDATE**;沒有 INSERT、沒有 DELETE)──────────────────────
UPDATE public.products p
   SET external_id = m.new_id,
       updated_at  = now()
  FROM _dbk_rename m
 WHERE p.external_id = m.old_id
   AND p.supplier_slug = 'dbk';

-- ── 4. 事後對帳 ──────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_snap  int;
  v_new   int;
  v_old    int;
  v_pop    int;
  v_before int;
BEGIN
  SELECT count(*) INTO v_snap FROM public.dbk_external_id_rename_20260904;
  IF v_snap <> 62 THEN
    RAISE EXCEPTION 'dbk-rename 事後①:快照應為 62 列, 實得 %', v_snap;
  END IF;

  SELECT count(*) INTO v_new
    FROM public.dbk_external_id_rename_20260904 s
    JOIN public.products p ON p.id = s.product_id
   WHERE p.external_id = s.new_external_id;
  IF v_new <> 62 THEN
    RAISE EXCEPTION 'dbk-rename 事後②:改成新值的應為 62 列, 實得 %', v_new;
  END IF;

  -- 🔴 反向也要問:舊值必須一個都不剩(只問「新值有 62」的話, 沒改到的那些不會叫)
  SELECT count(*) INTO v_old
    FROM public.dbk_external_id_rename_20260904 s
    JOIN public.products p ON p.external_id = s.old_external_id
   WHERE p.supplier_slug = 'dbk';
  IF v_old <> 0 THEN
    RAISE EXCEPTION 'dbk-rename 事後③:還有 % 列停在舊值', v_old;
  END IF;

  -- 🔴 母體不得變(改名不是搬家:沒有新增、沒有刪除)。
  --    比的是【同一個交易裡改之前那個數】, 不是寫死的 1508 —— 寫死的數字會過期,
  --    而「改名前後列數相同」這個不變式不會。
  SELECT count(*) INTO v_pop FROM public.products WHERE supplier_slug = 'dbk';
  SELECT before_n INTO v_before FROM _dbk_pop;
  IF v_pop IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'dbk-rename 事後④:dbk 母體從 % 變成 %(改名不該動列數)'
      ' ⇒ 有人在同一刻新增或刪除了列, 停下來看。', v_before, v_pop;
  END IF;
END
$verify$;

COMMIT;
