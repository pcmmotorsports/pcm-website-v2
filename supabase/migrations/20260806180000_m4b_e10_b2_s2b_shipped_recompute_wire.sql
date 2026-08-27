-- ============================================================
-- M-4b · E10 訂單閉環第 2 批 · B2-S2b-1:shipped 第四軸重算接線(helper 四軸化 + shipments 重算 trigger + 真值 backfill)
-- ============================================================
-- 片級 plan = docs/specs/2026-08-06-e10-b2-s2b-recompute-wire-plan.md v2
--   關卡1 五輪(codex ×2、Fable ×3)共 56 must-fix + 15 nit 全折入;主視窗 B-141-A / B-143-A / B-145-A 放行。
--   本片認領 = §4.99 認領表的 6 / 6b / 7 / 8 / 9 / 9b / 17 + 小線過期註解同批改寫
--            + 23b 的「第 6 支函式 / 第 5 支 trigger 登記進 a4a-verify.sh」(該登記在 scripts/,不在本檔)。
-- 姊妹片 = 小線 20260806100000(挖格子:加欄 + C8/C9/C6′)。**本片是它的接線。**
-- 片型 = 高風險片(鐵則 12 ③ DB 結構與不可逆寫入)⇒ commit 前 codex 關卡2 不降級。
--
-- ── 這片在做什麼 ────────────────────────────────────────────
-- 小線把 shipped_quantity 這個格子挖出來了,但**沒有任何路徑會寫它** —— A4a 重算只算三軸。
-- 本片把第四軸接上:
--   ① helper 四軸化      pcm_a4a_recompute_order_item_summary 多算 shipped 並寫進 upsert
--   ② 真值 backfill      建 trigger 之前,把既有候選品項的四軸重算一次(否則舊列永遠停在 0)
--   ③ shipments 重算     UPDATE shipments 的 shipped_at / deleted_at ⇒ 重算受影響品項
-- 真相式(§1,五處字面必須一致)= shipment_items JOIN shipments,過濾 deleted_at IS NULL AND shipped_at IS NOT NULL。
--
-- ── 🔴 timeout 的有效性條件(Sean 2026-08-06 Q1′=A;信 B-145-A)────
-- 下面的 SET LOCAL **只有在「本檔自包 BEGIN; … COMMIT;」時才生效** —— 本檔自包,所以有效。
-- 若有人把本檔拆開逐句跑(psql autocommit),SET LOCAL 會退化成 no-op 並吐 WARNING 25P01。
-- 同日正反面實測(本機 PG17):交易塊內 SHOW lock_timeout = 5s;不包 BEGIN 則 WARNING + 回 0。
-- 依據 = memory reference_supabase-migration-set-local-is-noop(該條標題原為無條件命題,已就地補上條件)。
-- 🔴 語義別誤讀(plan §3.1a,該段分析完整保留):
--   · lock_timeout 限制的是「**本交易等別人多久**」,**不限制**「本交易拿到鎖之後別人被擋多久」。
--   · 「別人被擋多久」= 本交易持鎖到 COMMIT 的**總時長**,受 statement_timeout 與 backfill 迴圈長度支配。
--   ⇒ **承重的是 statement_timeout 與交易總時長,不是 lock_timeout。**
--      正式站候選集合今日為 0 列 ⇒ backfill 是 no-op;非 0 時必須先量。
--
-- ── 🔴 誠實邊界 ────────────────────────────────────────────
-- · 本片**不**新增任何出貨真值表;shipped 的真相仍只在 shipment_items × shipments。
-- · 本片**不**碰 A8a1/A8a2 的可取消量守門(它們比 instock,已含 shipped;見小線檔頭 Q1=A)。
-- · X1(shipments_items_presence_ac)是 DEFERRED、本片重算 trigger 是 NOT DEFERRABLE
--   ⇒ 重算排在 X1 之前。前提 = 重算讀 shipment_items 時品項已在(由 X3 保證)。
--   🔴 **這是前提不是觀察**,plan §4 項 18 由 harness 片(S2b-2a)真的去構造它,本檔不宣稱已驗。
-- · 鎖序:沒有任何路徑先取 order_items 再取 shipments ⇒ 這對表之間無環(plan §3.1b 實查表)。
--   🟡 A8a2 多品項取消的取鎖順序**本片未驗**;若它不是升序,P2×P3 仍可能 40P01 ⇒ plan §9 交棒 6。
-- · 新 trigger 函式用 SET search_path = '' + 全限定名;helper 維持 public, pg_temp(既有函式只加軸、
--   不趁機改執行環境)。**兩種慣例並存是刻意的**,見下方 COMMENT。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ══ 1. 前置閘(plan §3.2;驗收項 6 / 6b / 7)══════════════════════════════════
-- 🔴 片序不可倒的**物理**保證。三段任一不符即 RAISE、整檔回滾。
-- 🔴 項 7 的形狀要求:小線未套時必須**RAISE 自己的訊息**,不是讓後面的 SQL 撞 42703
--    ⇒ 所有檢查一律走 catalog,**本閘之前不得出現任何直接引用 shipped_quantity 的語句**。
DO $gate$
DECLARE
  v_md5      text;
  v_owner    text;
  v_secdef   boolean;
  v_cfg      text;
  v_type     text;
  v_notnull  boolean;
  v_default  text;
  v_n        integer;
  v_def      text;
  v_missing  text;
BEGIN
  -- ── ③-a 小線產物:欄本身(先驗這個,否則後面的 CHECK 檢查會給出誤導的訊息)──
  SELECT a.atttypid::regtype::text, a.attnotnull,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    INTO v_type, v_notnull, v_default
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.order_item_quantity_summary'::regclass
     AND a.attname  = 'shipped_quantity'
     AND NOT a.attisdropped;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'S2b 前置閘①:小線(20260806100000)未套 —— order_item_quantity_summary 沒有 shipped_quantity 欄。先套小線再套本片。'
      USING ERRCODE = 'P2B10';
  END IF;
  IF v_type <> 'integer' OR NOT v_notnull OR v_default IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'S2b 前置閘①:shipped_quantity 欄契約不符(型別=% / notnull=% / default=%;應 integer / true / 0)',
      v_type, v_notnull, v_default USING ERRCODE = 'P2B10';
  END IF;

  -- ── ③-b 小線產物:三條 CHECK 具名 + 定義逐字 + convalidated ──
  -- 🔴 只驗「欄 + 三條 CHECK 存在」不夠(codex 關卡1):部分套用或舊版 S2a 也能過閘。
  --    定義逐字比對才擋得住「名字在、內容被改過」。
  FOR v_missing, v_def IN
    SELECT * FROM (VALUES
      ('oiqs_shipped_nonneg',                'CHECK ((shipped_quantity >= 0))'),
      ('oiqs_shipped_le_instock',            'CHECK ((shipped_quantity <= instock_quantity))'),
      ('oiqs_cancelled_shipped_le_quantity', 'CHECK ((((cancelled_quantity)::bigint + (shipped_quantity)::bigint) <= (quantity)::bigint))')
    ) AS t(nm, def)
  LOOP
    SELECT pg_catalog.pg_get_constraintdef(c.oid), c.convalidated
      INTO v_type, v_notnull
      FROM pg_catalog.pg_constraint c
     WHERE c.conrelid = 'public.order_item_quantity_summary'::regclass
       AND c.contype  = 'c'
       AND c.conname  = v_missing;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'S2b 前置閘②:小線的 CHECK % 不存在', v_missing USING ERRCODE = 'P2B10';
    END IF;
    IF v_type <> v_def THEN
      RAISE EXCEPTION 'S2b 前置閘②:CHECK % 定義不符凍結字面(實得 %)', v_missing, v_type
        USING ERRCODE = 'P2B10';
    END IF;
    IF NOT v_notnull THEN
      RAISE EXCEPTION 'S2b 前置閘②:CHECK % 是 NOT VALID(convalidated=false)', v_missing USING ERRCODE = 'P2B10';
    END IF;
  END LOOP;

  -- 摘要表 CHECK 的**具名集合**(A1 七條 + 小線三條 = 10)。
  -- 🔴 只數總數不夠(codex 關卡2 nit):數量只擋得住「多一條 / 少一條」,
  --    A1 舊七條若被**等量替換**(換名或換內容但總數仍 10),計數式照樣放行。
  --    ⇒ 改比對排序後的具名集合;三條小線的**定義**已在上面逐字比過,A1 七條在此至少釘住名字。
  SELECT pg_catalog.string_agg(conname, ',' ORDER BY conname) INTO v_missing
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_quantity_summary'::regclass AND contype = 'c';
  IF v_missing IS DISTINCT FROM
     'oiqs_cancelled_le_quantity,oiqs_cancelled_nonneg,oiqs_cancelled_shipped_le_quantity,'
     'oiqs_instock_cancelled_le_quantity,oiqs_instock_le_ordered,oiqs_instock_nonneg,'
     'oiqs_ordered_le_quantity,oiqs_ordered_nonneg,oiqs_shipped_le_instock,oiqs_shipped_nonneg' THEN
    RAISE EXCEPTION 'S2b 前置閘②:摘要表 CHECK 具名集合不符凍結值(實得 %);有人動過不變式集合,停下來看清楚再繼續', v_missing
      USING ERRCODE = 'P2B10';
  END IF;

  -- ── ③-c 小線的七個具名 COMMENT 物件都在(缺一代表小線只套了一半)──
  SELECT count(*) INTO v_n FROM (
    SELECT pg_catalog.col_description('public.order_item_quantity_summary'::regclass, a.attnum) AS d
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.order_item_quantity_summary'::regclass
       AND a.attname IN ('shipped_quantity','quantity')
    UNION ALL
    SELECT pg_catalog.obj_description('public.order_item_quantity_summary'::regclass, 'pg_class')
    UNION ALL
    SELECT pg_catalog.obj_description(c.oid, 'pg_constraint')
      FROM pg_catalog.pg_constraint c
     WHERE c.conrelid = 'public.order_item_quantity_summary'::regclass
       AND c.conname IN ('order_item_quantity_summary_item_fk',
                         'oiqs_instock_cancelled_le_quantity',
                         'oiqs_cancelled_shipped_le_quantity')
    UNION ALL
    SELECT pg_catalog.col_description('public.shipment_items'::regclass, a.attnum)
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.shipment_items'::regclass
       AND a.attname  = 'shipped_quantity'
  ) x WHERE x.d IS NOT NULL AND x.d <> '';
  IF v_n <> 7 THEN
    RAISE EXCEPTION 'S2b 前置閘③:小線的七個具名 COMMENT 物件只找到 %(應 7)', v_n USING ERRCODE = 'P2B10';
  END IF;

  -- ── ① helper 三軸指紋(pin pg_get_functiondef 的 md5,不是 prosrc)──
  -- 🔴 為什麼不是 prosrc:prosrc 不含 search_path / lock_timeout / SECURITY DEFINER
  --    ⇒ 只 hash prosrc 的話,那些漂移全部隱形(驗收項 6b:改 SET lock_timeout 也要紅)。
  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(
           'public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure)) INTO v_md5;
  IF v_md5 <> '875af6a6eb091487d519daa9d70b6eab' THEN
    RAISE EXCEPTION 'S2b 前置閘④:helper 的三軸指紋不符(實得 %);它已被別的片改過,本片的 CREATE OR REPLACE 會蓋掉那些改動。停下來對帳。', v_md5
      USING ERRCODE = 'P2B10';
  END IF;

  -- ── ② owner / secdef / proconfig(pg_get_functiondef 不含 owner)──
  SELECT pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef,
         COALESCE(pg_catalog.array_to_string(p.proconfig, ','), '<null>')
    INTO v_owner, v_secdef, v_cfg
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure;
  IF v_owner <> 'postgres' OR NOT v_secdef
     OR v_cfg <> 'search_path=public, pg_temp,lock_timeout=5s' THEN
    RAISE EXCEPTION 'S2b 前置閘⑤:helper 的 owner/secdef/proconfig 不符(% / % / %)', v_owner, v_secdef, v_cfg
      USING ERRCODE = 'P2B10';
  END IF;

  RAISE NOTICE 'S2b 前置閘全數通過(小線欄+3 CHECK 定義逐字+10 CHECK 具名集合+7 COMMENT / helper 三軸指紋 %)', v_md5;
END
$gate$;

-- ══ 2. helper 四軸化(plan §3.1;驗收項 9)═════════════════════════════════════
-- 🔴 用 CREATE OR REPLACE:A4a 原檔「禁 OR REPLACE」的紀律對象是**新建**,本片是蓄意替換,
--    而且上面的指紋閘已經證明被替換的就是我們以為的那一版。
-- 🔴 search_path 維持 public, pg_temp、**不回改成 ''**:helper 是既有函式,本片只加軸。
CREATE OR REPLACE FUNCTION public.pcm_a4a_recompute_order_item_summary(p_order_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  v_qty       bigint;   -- 🔴 全 bigint:危險在變數宣告(SUM(integer) 本回 bigint);
  v_ordered   bigint;   --    寫回 integer 欄的指派在 quantity=INT_MAX 病理邊界可 22003,
  v_instock   bigint;   --    誠實列界(harness R15 釘形狀)。
  v_cancelled bigint;
  v_shipped   bigint;   -- 🔴 B2-S2b 第四軸
BEGIN
  -- 鎖 parent(NKU;與 A2b1 同一把 ⇒ 重算彼此互斥、也與守門互斥)。
  SELECT oi.quantity INTO v_qty
    FROM public.order_items oi
   WHERE oi.id = p_order_item_id
   FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    -- 防衛枝:三張來源表對 order_items 全 FK RESTRICT ⇒ 事件存在時 parent 必在;
    -- 不列守門計數、無負測、無突變格(A2b1 §3.6 同紀律)。
    RAISE EXCEPTION 'A4a 防衛枝:order_items % 不存在(FK 應已先擋;此枝理論不可達)',
      p_order_item_id;
  END IF;

  -- 三軸真相直讀(instock 走 receipts JOIN,不經累計欄 —— 該欄有 bug 摘要仍對)。
  SELECT COALESCE(sum(p.allocated_quantity), 0) INTO v_ordered
    FROM public.order_item_procurement p
   WHERE p.order_item_id = p_order_item_id;

  SELECT COALESCE(sum(r.quantity), 0) INTO v_instock
    FROM public.order_item_procurement_receipts r
    JOIN public.order_item_procurement p2 ON p2.id = r.procurement_id
   WHERE p2.order_item_id = p_order_item_id;

  SELECT COALESCE(sum(c.cancelled_quantity), 0) INTO v_cancelled
    FROM public.order_cancellation_items c
   WHERE c.order_item_id = p_order_item_id;

  -- 🔴 第四軸真相式(plan §1)。本區塊是**五處同步守門**的第 1 處(唯一 writer)。
  -- 標記區內含關聯述詞那一行;本體 md5 比對時才把述詞行扣掉(plan §1.1,守門由 S2b-3a 建)。
  -- SHIPPED-TRUTH-BEGIN
  SELECT COALESCE(sum(si.shipped_quantity), 0) INTO v_shipped
    FROM public.shipment_items si
    JOIN public.shipments s ON s.id = si.shipment_id
   WHERE si.order_item_id = p_order_item_id
     AND s.deleted_at IS NULL          -- Q3=A:作廢即退量
     AND s.shipped_at IS NOT NULL;     -- 未寄出的草稿箱不算
  -- SHIPPED-TRUTH-END

  -- 惰性建列 + 冪等 upsert(quantity 由鎖下讀值寫入,複合 FK 物理釘死)。
  INSERT INTO public.order_item_quantity_summary
    (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity, shipped_quantity)
  VALUES (p_order_item_id, v_qty, v_ordered, v_instock, v_cancelled, v_shipped)
  ON CONFLICT (order_item_id) DO UPDATE
    SET quantity           = EXCLUDED.quantity,
        ordered_quantity   = EXCLUDED.ordered_quantity,
        instock_quantity   = EXCLUDED.instock_quantity,
        cancelled_quantity = EXCLUDED.cancelled_quantity,
        shipped_quantity   = EXCLUDED.shipped_quantity;
END
$$;

-- ══ 3. 真值 backfill(plan §3.4;驗收項 17)════════════════════════════════════
-- 🔴 **必須排在建 trigger 之前、同交易**:trigger 只在未來的 UPDATE 上發火,
--    既有的 shipments 列不會再被 UPDATE 一次 ⇒ 不 backfill 的話舊列永遠停在 0。
-- 🔴 候選全集必須含 **shipment-only 品項**(有出貨但從沒進過採購/取消/摘要的品項)
--    與 **summary-only 品項**(真相活動已全刪、摘要殘留非 0 的列 —— 不重算就不會被發現)。
DO $backfill$
DECLARE
  r          record;
  v_n        integer := 0;
  v_bad      integer;
  v_missing  integer;
BEGIN
  FOR r IN
    SELECT x.order_item_id FROM (
      SELECT p.order_item_id  FROM public.order_item_procurement p
      UNION SELECT c.order_item_id FROM public.order_cancellation_items c
      UNION SELECT s.order_item_id FROM public.order_item_quantity_summary s
      UNION SELECT si.order_item_id FROM public.shipment_items si
    ) x
    ORDER BY x.order_item_id          -- 🔴 升序:與 helper 的取鎖順序一致,不製造新的鎖序
  LOOP
    PERFORM public.pcm_a4a_recompute_order_item_summary(r.order_item_id);
    v_n := v_n + 1;
  END LOOP;

  -- ── oracle ①:值漂移。用**獨立**的四軸公式重算,與摘要列逐欄比對。
  -- 🔴 這裡刻意不呼叫 helper —— 呼叫它就變成「拿它自己的輸出跟自己比」= 恆綠。
  -- 🔴 第四軸的字面必須在本檔寫死(plan §1.1 第 5 處),不得執行期自讀檔案再跟自己比。
  SELECT count(*) INTO v_bad
    FROM public.order_item_quantity_summary s
    JOIN public.order_items oi ON oi.id = s.order_item_id
   WHERE s.quantity IS DISTINCT FROM oi.quantity
      OR s.ordered_quantity IS DISTINCT FROM
         COALESCE((SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p
                    WHERE p.order_item_id = s.order_item_id), 0)
      OR s.instock_quantity IS DISTINCT FROM
         COALESCE((SELECT sum(rc.quantity) FROM public.order_item_procurement_receipts rc
                    JOIN public.order_item_procurement p2 ON p2.id = rc.procurement_id
                   WHERE p2.order_item_id = s.order_item_id), 0)
      OR s.cancelled_quantity IS DISTINCT FROM
         COALESCE((SELECT sum(cc.cancelled_quantity) FROM public.order_cancellation_items cc
                    WHERE cc.order_item_id = s.order_item_id), 0)
      OR s.shipped_quantity IS DISTINCT FROM
-- SHIPPED-TRUTH-BEGIN
COALESCE((SELECT sum(si.shipped_quantity)
FROM public.shipment_items si
JOIN public.shipments sh ON sh.id = si.shipment_id
WHERE si.order_item_id = s.order_item_id
AND sh.deleted_at IS NULL
AND sh.shipped_at IS NOT NULL), 0)
-- SHIPPED-TRUTH-END
         ;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'S2b backfill oracle①:重算後仍有 % 列與獨立四軸公式不符', v_bad USING ERRCODE = 'P2B11';
  END IF;

  -- ── oracle ②:缺列。有出貨品項的 order_item_id 全集 ⊆ 摘要表全集。
  SELECT count(*) INTO v_missing
    FROM (SELECT DISTINCT si.order_item_id FROM public.shipment_items si) y
   WHERE NOT EXISTS (SELECT 1 FROM public.order_item_quantity_summary s
                      WHERE s.order_item_id = y.order_item_id);
  IF v_missing <> 0 THEN
    RAISE EXCEPTION 'S2b backfill oracle②:有出貨但無摘要列的品項 % 個', v_missing USING ERRCODE = 'P2B11';
  END IF;

  RAISE NOTICE 'S2b backfill 完成:重算 % 個候選品項,兩段 oracle 全過(漂移 0 / 缺列 0)', v_n;
END
$backfill$;

-- ══ 4. shipments 重算 trigger(plan §3.3;驗收項 8 / 9b)═══════════════════════
-- 🔴 **只有這一支**(Sean 08-05 Q1=A)。shipment_items 上刻意不掛 —— 出貨真值的變動一律經
--    UPDATE shipments(shipped_at / deleted_at);append-only 三支擋住了「改/刪已寄出箱品項」。
--    ⇒ 那三支若被未來哪一片放寬,本 trigger 就不發火、摘要靜默漂移(plan §9 交棒 3)。
-- 🔴 函式名沿用 **pcm_a4a** 前綴(主視窗 B-143-A 條件 2):a4a-verify.sh 的 trigger 集合守門
--    用 `proname LIKE 'pcm_a4a%'` 取集合,換前綴會讓這支對那道守門隱形。
CREATE FUNCTION public.pcm_a4a_shipments_summary_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''          -- 🔴 新建函式一律 ''(memory 拍板);helper 是既有函式故維持舊慣例,兩者並存是刻意的
SET lock_timeout = '5s'
AS $$
DECLARE
  r record;
BEGIN
  -- 隔離閘(照 A4a 四支同款):RR/SSI 下鎖後 SUM 看不到兄弟提交 ⇒ 重算只在 read committed 下健全。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'A4a 隔離閘:重算僅在 read committed 下健全(目前 = %);拒收',
      pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'a4a_iso_rc_shipments';
  END IF;

  -- 🔴 ORDER BY 不是裝飾(plan §3.3 / R1 #8):未排序的 DISTINCT 迭代,
  --    兩張含重疊品項的包裹併發出貨會反序取鎖 ⇒ 真 40P01。
  FOR r IN
    SELECT DISTINCT si.order_item_id
      FROM public.shipment_items si
     WHERE si.shipment_id = NEW.id
     ORDER BY si.order_item_id
  LOOP
    PERFORM public.pcm_a4a_recompute_order_item_summary(r.order_item_id);
  END LOOP;

  RETURN NULL;
END
$$;

-- 🔴 零 grantee:新函式的 EXECUTE 預設對 PUBLIC 開,不顯式 REVOKE 就是後門。
--    REVOKE 之後 proacl 由 NULL 變成非 NULL —— 驗收項 9b 認的是 `proacl IS NOT NULL`,
--    因為 aclexplode(NULL) 回零列會讓「零 grantee」的斷言恆綠(codex R2 #7)。
-- 🔴 只 REVOKE PUBLIC **不夠**:第一版就這樣寫,本檔驗收②b 當場抓到 `anon` 仍有 EXECUTE
--    (2026-08-06 實跑)。Supabase 環境對新函式有角色層的預設授與,PUBLIC 那道收不到它們。
--    ⇒ 照姊妹片 S1b(`20260805170200:113/186/242`)的寫法明列角色。
--    這正是 memory reference_supabase-service-role-execute-default-grant 記的那一族。
REVOKE ALL ON FUNCTION public.pcm_a4a_shipments_summary_recompute()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE CONSTRAINT TRIGGER shipments_summary_recompute_ac
  AFTER UPDATE OF shipped_at, deleted_at ON public.shipments
  NOT DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_a4a_shipments_summary_recompute();

-- ══ 5. 檔內結構驗收(本檔做得到的那些;行為格在 scripts/b2s2b-verify.sh)══════════
DO $verify$
DECLARE
  v_n       integer;
  v_owner   text;
  v_secdef  boolean;
  v_cfg     text;
  v_acl     boolean;
  v_md5     text;
  v_role    text;
BEGIN
  -- ① helper 已四軸化(prosrc 必須看得到第四軸的寫入)
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc
   WHERE oid = 'public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure
     AND prosrc LIKE '%shipped_quantity   = EXCLUDED.shipped_quantity%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'S2b 驗收①:helper 的 upsert 沒有寫 shipped_quantity';
  END IF;

  -- ② 新 trigger 函式的安全面(驗收項 9b)
  SELECT pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef,
         COALESCE(pg_catalog.array_to_string(p.proconfig, ','), '<null>'),
         (p.proacl IS NOT NULL)
    INTO v_owner, v_secdef, v_cfg, v_acl
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.pcm_a4a_shipments_summary_recompute()'::regprocedure;
  -- 🔴 `search_path=""` 的雙引號是實測字面,不是筆誤:proconfig 存的是 GUC 的字串表示,
  --    空字串會被引號括起來。我第一版憑印象寫 `search_path=` ⇒ 本閘當場擋下(2026-08-06 實跑)。
  IF v_owner <> 'postgres' OR NOT v_secdef
     OR v_cfg <> 'search_path="",lock_timeout=5s' OR NOT v_acl THEN
    RAISE EXCEPTION 'S2b 驗收②:新 trigger 函式安全面不符(owner=% secdef=% cfg=% acl_not_null=%)',
      v_owner, v_secdef, v_cfg, v_acl;
  END IF;

  -- ②b 🔴 **零 grantee 的正面證明**(codex 關卡2 must-fix):只抽四個角色是**取樣**不是證明 ——
  --    `payment_confirmer` 或任何自訂角色若持有 EXECUTE,`proacl IS NOT NULL` + 四角色迴圈**照樣全綠**。
  --    正解 = 展開 ACL、斷言「owner 以外的 grantee 恰 0 個」。
  --    🔴 它必須與上面的 `proacl IS NOT NULL` 併用:`aclexplode(NULL)` 回零列 ⇒ 單看本式會恆綠。
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
   WHERE p.oid = 'public.pcm_a4a_shipments_summary_recompute()'::regprocedure
     AND a.grantee <> p.proowner;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'S2b 驗收②b:新 trigger 函式有 % 個 owner 以外的 grantee(應 0);實際 ACL = %',
      v_n, (SELECT proacl::text FROM pg_catalog.pg_proc
             WHERE oid = 'public.pcm_a4a_shipments_summary_recompute()'::regprocedure);
  END IF;

  -- ②c 四個常見角色再逐一點名(可讀性用;真正的證明是上面那條零 grantee)
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role','authenticator'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role)
       AND pg_catalog.has_function_privilege(v_role,
             'public.pcm_a4a_shipments_summary_recompute()'::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'S2b 驗收②b:角色 % 竟然有新 trigger 函式的 EXECUTE', v_role;
    END IF;
  END LOOP;

  -- ③ trigger 結構逐字(驗收項 8)
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_trigger t
   WHERE t.tgname = 'shipments_summary_recompute_ac'
     AND NOT t.tgisinternal
     AND t.tgrelid = 'public.shipments'::regclass
     AND t.tgfoid  = 'public.pcm_a4a_shipments_summary_recompute()'::regprocedure
     AND t.tgenabled = 'O'
     AND t.tgconstraint <> 0        -- 是 constraint trigger
     AND NOT t.tgdeferrable
     AND NOT t.tginitdeferred
     AND pg_catalog.pg_get_triggerdef(t.oid) =
         'CREATE CONSTRAINT TRIGGER shipments_summary_recompute_ac AFTER UPDATE OF shipped_at, deleted_at ON public.shipments NOT DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION pcm_a4a_shipments_summary_recompute()';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'S2b 驗收③:shipments_summary_recompute_ac 結構不符(實得定義 = %)',
      (SELECT pg_catalog.pg_get_triggerdef(oid) FROM pg_catalog.pg_trigger
        WHERE tgname = 'shipments_summary_recompute_ac' AND NOT tgisinternal);
  END IF;

  -- ④ shipment_items 上**沒有**重算 trigger(Q1=A 的負向釘死;plan 項 25c 的檔內版)
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = 'public.shipment_items'::regclass
     AND NOT t.tgisinternal
     AND p.proname LIKE 'pcm_a4a%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'S2b 驗收④:shipment_items 上出現 % 支 a4a 重算 trigger(本線刻意不掛)', v_n;
  END IF;

  -- ⑤ a4a 家族總數:5 trigger / 6 函式(plan 項 21b 的數字,本片 +1/+1)
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc WHERE proname LIKE 'pcm_a4a%';
  IF v_n <> 6 THEN RAISE EXCEPTION 'S2b 驗收⑤:pcm_a4a 函式數 = %(應 6)', v_n; END IF;
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
   WHERE p.proname LIKE 'pcm_a4a%' AND NOT t.tgisinternal;
  IF v_n <> 5 THEN RAISE EXCEPTION 'S2b 驗收⑤:掛 pcm_a4a 函式的 trigger 數 = %(應 5)', v_n; END IF;

  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(
           'public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure)) INTO v_md5;
  RAISE NOTICE 'S2b 結構驗收全數通過(helper 四軸 / 新函式安全面 零 grantee(非取樣)+4 角色點名 / trigger 定義逐字 / shipment_items 零掛載 / 6 函式 5 trigger)';
  RAISE NOTICE 'S2b 四軸指紋公告(下一片替換 helper 時 pin 這個):%', v_md5;
END
$verify$;

-- ══ 6. 註解 ══════════════════════════════════════════════════════════════════
-- 🔴 COMMENT 沒有強制力,它是留言不是機制。這一段的作用是讓下一個人讀 catalog 就看得到接線已完成。

COMMENT ON FUNCTION public.pcm_a4a_recompute_order_item_summary(uuid) IS
  'M-4b E10 A4a 核心:鎖 parent(FOR NO KEY UPDATE,A2b1 同原語)後由**四張**真相表重算 order_item_quantity_summary 並 upsert(惰性建列)。instock 直讀 receipts JOIN、不經 received_quantity 累計欄;shipped 直讀 shipment_items JOIN shipments(deleted_at IS NULL AND shipped_at IS NOT NULL)。🔴 2026-08-06 B2-S2b 四軸化:呼叫者 = A4a 四支 trigger + 本線新增的 shipments_summary_recompute_ac + 兩片的 backfill。🔴 本函式維持 search_path = public, pg_temp(既有函式只加軸、不趁機改執行環境);B2-S2b 新建的 trigger 函式用 search_path = '' —— 兩種慣例並存是刻意的。';

COMMENT ON FUNCTION public.pcm_a4a_shipments_summary_recompute() IS
  'M-4b E10 B2-S2b:shipments AFTER UPDATE OF shipped_at, deleted_at → 重算該包裹所有品項的摘要(四軸)。🔴 全線只有這一支重算 trigger 掛在出貨側(Sean 2026-08-05 Q1=A);shipment_items 上刻意不掛,因為 append-only 三支(shipment_items_block_delete_bd / _block_update_bu / _block_truncate_bt)擋住了「改/刪已寄出箱品項」⇒ 出貨真值的變動一律經 UPDATE shipments。🔴 那三支若被未來哪一片放寬,本 trigger 不發火、摘要靜默漂移且無告警。🔴 迴圈的 ORDER BY si.order_item_id 不是裝飾:未排序的併發出貨會反序取鎖 ⇒ 40P01。🔴 函式名沿用 pcm_a4a 前綴是契約:scripts/a4a-verify.sh 的 trigger 集合守門用 proname LIKE ''pcm_a4a%'' 取集合。';

-- 🔴 小線那兩句已過期的註解同批改寫(plan §2 S2b-1 範圍;不留活字)——
--    小線寫於本片施工之前,逐字說「大線 B2-S2b,尚未施工」「完全不碰本欄」,現在兩句都不成立了。
COMMENT ON COLUMN public.order_item_quantity_summary.shipped_quantity IS
  '已出貨的件數(第四軸)。來源 = shipment_items JOIN shipments,過濾 deleted_at IS NULL AND shipped_at IS NOT NULL;維護者 = A4a 四軸重算,任何人不得手填。🔴 2026-08-06 B2-S2b 已接線(本欄的敘述於該日改寫):唯一 writer(pcm_a4a_recompute_order_item_summary)**已經算第四軸**,其 ON CONFLICT DO UPDATE 五欄全更新;寫入路徑 = A4a 四支 trigger + shipments_summary_recompute_ac + backfill。⇒ 小線時期「本欄實務上恆 0 / A4a 完全不碰本欄」的敘述**已作廢**。🔴 仍然不是 DB 強制任何值:C8/C9/C6′ 只對被寫的值評估,owner / SECURITY DEFINER 路徑直寫非法值時由那三條 CHECK 當場擋下。';

COMMENT ON TABLE public.order_item_quantity_summary IS
  'E10 A1:訂單品項的數量摘要(衍生值,非真相)。真相在 A2 採購表、A7 取消明細與 B2 包裹表;本表存在的理由是「列 300 筆訂單時不要每次重算」(master plan Q9=B)。🔴 員工專用:anon/authenticated 零權限 + RLS zero-policy —— Sean 2026-07-31 拍板「不讓客人知道進度、只有狀態顯示」。🔴 任何人不得手填,唯一 writer = A4a 重算 trigger。🔴 惰性建列:無列 = **四個 0**,讀取端必須 LEFT JOIN + COALESCE(此約定無 DB 強制力,見欄註解的契約債)。🔴 2026-08-06 B2-S2a 追加第四軸 shipped_quantity;**同日 B2-S2b 完成接線**(helper 四軸化 + shipments 重算 trigger + 真值 backfill)—— 小線時期「該軸的重算接線在大線 B2-S2b,本片只挖格子」的敘述已作廢。';

COMMIT;

-- ============================================================
-- 🔴 本檔未涵蓋(交棒;不要以為套完就沒事了)
--   · 行為格(正測/退量/unvoid/草稿箱/X1 COMMIT 失敗回滾/barrier 併發)= S2b-2a / 2b 的 harness
--   · 五處真相式同步守門 + runbook 兩段四軸化 + a4a-verify 的 ORACLE_SQL 四軸化 = S2b-3a
--   · rollback 依賴清單 / DROP 序 / rehearsal / 契約債①②③④ = S2b-3b
--   · a4a-verify.sh 的「第 6 函式 / 第 5 trigger」登記 = 本片同批交付,但改的是 scripts/,不在本檔
--   · A8a2 多品項取消的取鎖順序未驗(plan §9 交棒 6)
-- ============================================================
