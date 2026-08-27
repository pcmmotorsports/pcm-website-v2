-- ============================================================
-- M-4b E10 第 1 批 · A4a:order_item_quantity_summary 重算 constraint trigger
-- ============================================================
-- 規格:docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md §5.1 row 30(:372-377)。
-- 片級 plan:docs/specs/2026-08-03-e10-a4a-summary-recompute-plan.md(v4 現行)。
-- 關卡1:codex gpt-5.6-sol xhigh R1(19)/R2(9)+ Fable adversarial-reviewer R3(7)
--       共 35 條、駁回 0;findings 逐字 = docs/reviews/2026-08-03-e10-a4a-k1-codex.md。
-- 🔴 Sean 2026-08-03 拍板:A4a plan §9 Q1-Q5=A(兄弟測法修訂 12 處/a7 探針 25+32 重寫/
--    隔離閘逐表具名延伸/a7-verify 既有壞損只記債/Q5 因 a7bt migration 已 git rm 而 moot)。
--
-- 職責(row 30 + A2 合約債③,20260729020000:129-136):
--   ① 三張真相表(order_item_procurement / order_item_procurement_receipts /
--      order_cancellation_items)的 AFTER I/U/D 同交易重算 order_item_quantity_summary
--      (惰性建列;「RPC 記得呼叫」= 第二真相,本片使其不存在)。
--   ② order_item_procurement.received_quantity = receipts SUM 的等式由本片維護;
--      直寫該欄(不論值對錯)被 BEFORE guard 以 P4A01 拒絕。
--   ③ 取消側掛同一把 parent NKU ⇒ 關閉 A2b1 契約債⑥的競態窗
--      (a2b2 S5 期望自本片起翻紅 = 內建提醒兌現)。
--
-- 🔴 鎖原語 = FOR NO KEY UPDATE(A2b1 同一把鎖;Q4=A 契約、40P01 實測依據見 a2b1 檔頭)。
--   取鎖序:orders(A8a 系,未來)→ order_item_procurement → order_items。
--
-- 🔴 隔離閘(P2B02;Q1=A 先例延伸,tag 逐表具名):
--   RR 下等到鎖後 SUM 用交易快照 ⇒ 重算會「靜默寫入過時摘要」(與 A2b1 同病根、
--   後果更糟:不是誤放行而是錯資料入庫)。三支 AFTER trigger 函式 gate-first,
--   tag = a4a_iso_rc_procurement / a4a_iso_rc_receipts / a4a_iso_rc_cancellation。
--
-- 🔴 CHECK 網自本片「通電」(對外行為變化,plan §3.5 全表):
--   超量取消 → 23514 oiqs_*(A7 的「刻意無上限」自始設計為由 A1 CHECK + 本片啟用上界,
--   20260730130000:260-262 逐字);超收 → 23514 received_range;直寫 received → P4A01;
--   非 RC 寫三表 → P2B02;quantity=INT_MAX 病理邊界 → 22003(指派溢位先於具名 CHECK,誠實列界)。
--
-- 🔴 GUC 旗標(pcm_a4a.received_sync,txn-local):
--   received_quantity 的合法寫入路徑 = 本片 sync/backfill 在自己的 UPDATE 前後設清旗標。
--   ⚠️ 這是「同權能行為者的路徑判別」不是不可偽造能力:能設旗標者(owner/SECDEF)
--   本在 trigger 天花板之上(A7-t 同級)。
--   ⚠️ 異常路徑依賴 PG「GUC 隨子交易回滾」語意(sync 的 UPDATE 中途 RAISE 且被
--   savepoint 接住 ⇒ 旗標一併回滾、零殘留;本機 PG17.10 實測 2026-08-03)。
--   ⚠️ 讀取判定必須 nullif(…,'') —— 同 session 設過再結束交易後,current_setting 回空字串非 NULL。
--
-- 🔴 級聯與遞迴終止(plan §3.3):receipts 事件 → 鎖 proc 列(NKU)→ 旗標 UPDATE
--   received_quantity(僅 IS DISTINCT 時)→ 該 UPDATE 觸發 ①BEFORE guard(旗標放行)
--   ②A2b1 guard(skip 枝:allocated 未升)③本片 proc trigger(重算摘要)。
--   proc trigger 自身不寫 procurement ⇒ 深度 2 終止。
--   摘要三軸一律真相直讀(instock = receipts JOIN,不經 received_quantity 累計欄
--   ⇒ 該欄有 bug 摘要仍對,C5 CHECK fail-closed 兜底)。
--
-- 🔴 名稱序契約(K10;本機 PG17.10 實測:同表同事件 constraint trigger 按名稱序發火,
--   deferred 佇列亦保序):a2b1 guard『order_item_procurement_allocation_guard_ac』
--   必須排序在本片『order_item_procurement_summary_recompute_zc』之前 ——
--   錯誤歸因(P2B01 先於 23514)與 a2b1-verify B10/M5 的可達性都押在這上面。
--   ⚠️ 契約債⑥:下方 DO 的名稱序斷言只在本片 apply 時跑一次,不是常駐守門;
--   未來任何在 procurement 表掛 trigger / 改名的片必須重跑此斷言(a7t「集合恰等」同型債)。
--
-- 🟡 契約債(對未來片有約束力,誠實列出):
--  ① 多列 writer 取鎖序:receipts 多列寫入按完整序 (order_item_id, procurement_id) 排;
--     cancellation 多列 writer(A8a1/A8a2)按 order_item_id 排(A2b1 債④同組)。
--  ② 「先超後補」交易自本片起必須同時 defer 兩名:
--     SET CONSTRAINTS order_item_procurement_allocation_guard_ac,
--                     order_item_procurement_summary_recompute_zc DEFERRED;
--     只 defer guard 一名 ⇒ 本片 immediate 重算先紅在 oiqs_ordered_le_quantity(23514)。
--  ③ TRUNCATE procurement/receipts 不觸發重算(row trigger 物理限制;兩表零寫 GRANT、
--     owner 天花板;cancellation 側 A7-t 已攔 TRUNCATE)。
--  ④ 第 2 批 shipped_quantity 落地時,重算函式與 CHECK 網必須同片擴充(A1 債承接)。
--  ⑤ 第 3 批改單片處理 quantity 縮小與死配額列(A2b1 債②③同組)。
--  ⑥ 名稱序一次性斷言債(見上)。
--  ⑦ A5a 上線片必須回寫 docs/runbooks/a4a-summary-rollback.md 的「停寫」步驟為具體 REVOKE SQL。
--
-- 🟡 已知死結環(全部 fail-closed 40P01 可重試、非資料錯;plan §3.4):
--  環① 併發反向 re-parent(owner-only 操作、零真 writer):a2b1 先鎖 NEW parent(不排序)
--     × 本片排序鎖雙 parent 交叉。不修:修法需動已 apply 的 a2b1,不成比例。
--  環② 多列 receipts 跨 parent 與反向 cancellation writer 互鎖 ⇒ 債① 的排序契約。
--  環③ 同 parent 雙 proc 列(T1 多列 receipts 觸 P1+P2 vs T2 單列觸 P2):排序關不掉
--     (per-row trigger 無法先知全集;parent-first 又與 DML tuple 鎖反向)⇒ 誠實列界;
--     writer 建議 = 同 parent 多筆到貨盡量單列 statement 或逐筆小交易。
--
-- 🔴 A2 誠實負測翻面(20260729020000:611-613 的指示):A2 檔內斷言「本片不該有任何
--   東西自動維護 received_quantity」—— 該檔已 apply 不得改(漂移守門),其「A4a 落地後
--   改成斷言會被擋」的意圖由本檔下方行為探針承接(receipt INSERT → received 被維護;
--   直寫 → P4A01)。from-zero 重放時 A2 的 DO 跑在本片之前,兩者永不同時為真。
--
-- 🔴 break-glass(誤攔/壞資料當天的合法出路;整段單一交易、不當天發明):
--      BEGIN;
--      ALTER TABLE public.order_item_procurement
--        DISABLE TRIGGER order_item_procurement_received_quantity_guard_bt;
--      ALTER TABLE public.order_item_procurement
--        DISABLE TRIGGER order_item_procurement_summary_recompute_zc;
--      ALTER TABLE public.order_item_procurement_receipts
--        DISABLE TRIGGER order_item_procurement_receipts_received_sync_ac;
--      ALTER TABLE public.order_cancellation_items
--        DISABLE TRIGGER order_cancellation_items_summary_recompute_ac;
--      -- 修正資料(此處填當日的修復 SQL;received_quantity 可直寫 —— guard 已停)
--      ALTER TABLE public.order_item_procurement
--        ENABLE TRIGGER order_item_procurement_received_quantity_guard_bt;
--      ALTER TABLE public.order_item_procurement
--        ENABLE TRIGGER order_item_procurement_summary_recompute_zc;
--      ALTER TABLE public.order_item_procurement_receipts
--        ENABLE TRIGGER order_item_procurement_receipts_received_sync_ac;
--      ALTER TABLE public.order_cancellation_items
--        ENABLE TRIGGER order_cancellation_items_summary_recompute_ac;
--      -- 重驗(漂移 oracle;違反 = RAISE ⇒ 整段回滾、trigger 不會停著):
--      DO $bg$ DECLARE v_bad integer; BEGIN
--        SELECT count(*) INTO v_bad FROM public.order_item_procurement p
--         WHERE p.received_quantity IS DISTINCT FROM COALESCE((
--               SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
--                WHERE r.procurement_id = p.id), 0);
--        IF v_bad <> 0 THEN RAISE EXCEPTION 'break-glass 重驗失敗:% 列 received 漂移', v_bad; END IF;
--        SELECT count(*) INTO v_bad FROM public.order_item_quantity_summary s
--         WHERE s.ordered_quantity   IS DISTINCT FROM COALESCE((SELECT sum(p.allocated_quantity)
--                 FROM public.order_item_procurement p WHERE p.order_item_id = s.order_item_id), 0)
--            OR s.instock_quantity   IS DISTINCT FROM COALESCE((SELECT sum(r.quantity)
--                 FROM public.order_item_procurement_receipts r
--                 JOIN public.order_item_procurement p2 ON p2.id = r.procurement_id
--                WHERE p2.order_item_id = s.order_item_id), 0)
--            OR s.cancelled_quantity IS DISTINCT FROM COALESCE((SELECT sum(c.cancelled_quantity)
--                 FROM public.order_cancellation_items c WHERE c.order_item_id = s.order_item_id), 0);
--        IF v_bad <> 0 THEN RAISE EXCEPTION 'break-glass 重驗失敗:% 列摘要漂移', v_bad; END IF;
--        SELECT count(*) INTO v_bad FROM (SELECT p.order_item_id FROM public.order_item_procurement p
--                UNION SELECT c.order_item_id FROM public.order_cancellation_items c) x
--         WHERE NOT EXISTS (SELECT 1 FROM public.order_item_quantity_summary s WHERE s.order_item_id = x.order_item_id);
--        IF v_bad <> 0 THEN RAISE EXCEPTION 'break-glass 重驗失敗:% 個活動品項缺摘要列', v_bad; END IF;
--      END $bg$;
--      COMMIT;
--    交易失敗 = 全部回滾(含 DISABLE)⇒ 不存在「修一半、trigger 停著」的狀態。
--    事後:停用視窗內寫入逐列列出、記入當日 handoff。
--
-- 誠實邊界:tgenabled='O' ⇒ replica mode / owner DISABLE 可繞(A7-t 同天花板);
--   摘要被 owner 直接竄改後、下一次來源表事件才自癒(顯示層天花板;守門不讀它,A1 row C1);
--   函式級 lock_timeout 只保護函式內顯式 NKU 等待(55P03)、每次取鎖各算。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 核心 helper:鎖 parent → 三軸真相重算 → upsert ────────
-- 裸 CREATE(禁 OR REPLACE,A7-t 教訓);SECURITY DEFINER(讀寫五張 zero-policy RLS 表,
-- definer = 表 owner;owner 對齊由下方 DO 釘死)。
CREATE FUNCTION public.pcm_a4a_recompute_order_item_summary(p_order_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  v_qty       bigint;   -- 🔴 全 bigint:危險在變數宣告(SUM(integer) 本回 bigint);
  v_ordered   bigint;   --    寫回 integer 欄的指派在 quantity=INT_MAX 病理邊界可 22003,
  v_instock   bigint;   --    誠實列界(plan §3.5/§3.7④、harness R15 釘形狀)。
  v_cancelled bigint;
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

  -- 惰性建列 + 冪等 upsert(quantity 由鎖下讀值寫入,複合 FK 物理釘死)。
  INSERT INTO public.order_item_quantity_summary
    (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity)
  VALUES (p_order_item_id, v_qty, v_ordered, v_instock, v_cancelled)
  ON CONFLICT (order_item_id) DO UPDATE
    SET quantity           = EXCLUDED.quantity,
        ordered_quantity   = EXCLUDED.ordered_quantity,
        instock_quantity   = EXCLUDED.instock_quantity,
        cancelled_quantity = EXCLUDED.cancelled_quantity;
END
$$;

COMMENT ON FUNCTION public.pcm_a4a_recompute_order_item_summary(uuid) IS
  'M-4b E10 A4a 核心:鎖 parent(FOR NO KEY UPDATE,A2b1 同原語)後由三張真相表重算 order_item_quantity_summary 並 upsert(惰性建列)。instock 直讀 receipts JOIN、不經 received_quantity 累計欄。只由本片四支 trigger 與 backfill 呼叫。';

-- ── 2. received_quantity 直寫守門(BEFORE;plain trigger)──────
CREATE FUNCTION public.pcm_a4a_received_quantity_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 旗標判定:nullif(…,'') 必要 —— txn 結束後 current_setting 回空字串非 NULL(實測)。
  -- ⚠️ NULLIF/COALESCE 是 SQL 語法構件非函式,不可加 pg_catalog 前綴(2026-08-03 實測 42883)。
  IF COALESCE(nullif(pg_catalog.current_setting('pcm_a4a.received_sync', true), ''), '0') <> '1' THEN
    IF (TG_OP = 'INSERT' AND NEW.received_quantity <> 0)
       OR (TG_OP = 'UPDATE' AND NEW.received_quantity IS DISTINCT FROM OLD.received_quantity) THEN
      RAISE EXCEPTION 'A4a:received_quantity 由重算 trigger 維護(真相 = receipts 明細 SUM),不得直寫(品項採購列 %)',
        NEW.id
        USING ERRCODE = 'P4A01', CONSTRAINT = 'a4a_received_quantity_machine_maintained';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.pcm_a4a_received_quantity_guard() IS
  'M-4b E10 A4a:received_quantity 直寫守門(A2 20260729020000:118-119 合約「不准直接寫本欄」的 DB 層兌現)。合法路徑 = 本片 sync/backfill 設 txn-local GUC pcm_a4a.received_sync=1。值寫對也擋(路徑判別,非值比對)。P4A01。';

-- ── 3. procurement 事件 → 摘要重算(唯一 DEFERRABLE,與 a2b1 guard 成對)──
CREATE FUNCTION public.pcm_a4a_procurement_summary_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  v_a uuid;
  v_b uuid;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'A4a 隔離閘:重算僅在 read committed 下健全(目前 = %);拒收',
      pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'a4a_iso_rc_procurement';
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.pcm_a4a_recompute_order_item_summary(NEW.order_item_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.pcm_a4a_recompute_order_item_summary(OLD.order_item_id);
  ELSIF NEW.order_item_id = OLD.order_item_id THEN
    PERFORM public.pcm_a4a_recompute_order_item_summary(NEW.order_item_id);
  ELSE
    -- 換 parent:兩側都要重算;uuid 排序取鎖(降低互鎖面;環① 誠實列界見檔頭)。
    v_a := LEAST(OLD.order_item_id, NEW.order_item_id);
    v_b := GREATEST(OLD.order_item_id, NEW.order_item_id);
    PERFORM public.pcm_a4a_recompute_order_item_summary(v_a);
    PERFORM public.pcm_a4a_recompute_order_item_summary(v_b);
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION public.pcm_a4a_procurement_summary_recompute() IS
  'M-4b E10 A4a:order_item_procurement AFTER I/U/D → 摘要重算入口。gate-first(P2B02/a4a_iso_rc_procurement);換 parent 時兩側 uuid 排序重算。';

-- ── 4. receipts 事件 → received_quantity 同步(級聯觸發 §3 完成摘要)──
CREATE FUNCTION public.pcm_a4a_receipts_received_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  v_procs uuid[];
  v_proc  uuid;
  v_dummy uuid;
  v_sum   bigint;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'A4a 隔離閘:重算僅在 read committed 下健全(目前 = %);拒收',
      pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'a4a_iso_rc_receipts';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_procs := ARRAY[NEW.procurement_id];
  ELSIF TG_OP = 'DELETE' THEN
    v_procs := ARRAY[OLD.procurement_id];
  ELSIF NEW.procurement_id = OLD.procurement_id THEN
    v_procs := ARRAY[NEW.procurement_id];
  ELSE
    v_procs := ARRAY[LEAST(OLD.procurement_id, NEW.procurement_id),
                     GREATEST(OLD.procurement_id, NEW.procurement_id)];
  END IF;

  FOREACH v_proc IN ARRAY v_procs LOOP
    -- 鎖 proc 列(NKU 直取:FOR SHARE 再升級 = 鎖升級死結,A2b1 R1-1 同型;
    -- 同時關掉「讀到過時 parent、重算漏單」的競態窗)。
    SELECT p.id INTO v_dummy
      FROM public.order_item_procurement p
     WHERE p.id = v_proc
     FOR NO KEY UPDATE;
    IF NOT FOUND THEN
      -- 防衛枝:receipts FK → procurement RESTRICT ⇒ 事件存在時 proc 列必在。
      RAISE EXCEPTION 'A4a 防衛枝:order_item_procurement % 不存在(FK 應已先擋)', v_proc;
    END IF;

    SELECT COALESCE(sum(r.quantity), 0) INTO v_sum
      FROM public.order_item_procurement_receipts r
     WHERE r.procurement_id = v_proc;

    -- 旗標路徑 UPDATE(僅 IS DISTINCT 時;received_range CHECK 在此當場擋超收 =
    -- A2 合約債③②「重算違反 CHECK 整筆 RAISE」)。UPDATE 級聯觸發 §3 完成摘要重算。
    -- 異常時旗標隨子交易回滾(檔頭 GUC 節;harness R16 釘住)。
    PERFORM pg_catalog.set_config('pcm_a4a.received_sync', '1', true);
    UPDATE public.order_item_procurement
       SET received_quantity = v_sum
     WHERE id = v_proc
       AND received_quantity IS DISTINCT FROM v_sum;
    PERFORM pg_catalog.set_config('pcm_a4a.received_sync', '', true);
  END LOOP;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION public.pcm_a4a_receipts_received_sync() IS
  'M-4b E10 A4a:receipts AFTER I/U/D → 鎖 proc 列(NKU)→ received_quantity = SUM(receipts)(旗標路徑、僅 IS DISTINCT 時 UPDATE)→ 級聯觸發 procurement trigger 完成摘要。超收在此紅在 received_range(23514)。';

-- ── 5. cancellation 事件 → 摘要重算(= 關閉 A2b1 契約債⑥的那把鎖)──
CREATE FUNCTION public.pcm_a4a_cancellation_summary_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  v_a uuid;
  v_b uuid;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'A4a 隔離閘:重算僅在 read committed 下健全(目前 = %);拒收',
      pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'a4a_iso_rc_cancellation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.pcm_a4a_recompute_order_item_summary(NEW.order_item_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.pcm_a4a_recompute_order_item_summary(OLD.order_item_id);
  ELSIF NEW.order_item_id = OLD.order_item_id THEN
    PERFORM public.pcm_a4a_recompute_order_item_summary(NEW.order_item_id);
  ELSE
    v_a := LEAST(OLD.order_item_id, NEW.order_item_id);
    v_b := GREATEST(OLD.order_item_id, NEW.order_item_id);
    PERFORM public.pcm_a4a_recompute_order_item_summary(v_a);
    PERFORM public.pcm_a4a_recompute_order_item_summary(v_b);
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION public.pcm_a4a_cancellation_summary_recompute() IS
  'M-4b E10 A4a:order_cancellation_items AFTER I/U/D → 摘要重算。取消寫入自此取 parent NKU ⇒ A2b1 契約債⑥(取消未提交+採購滿額滑過)的窗口關閉;a2b2 S5 期望自此翻紅。';

-- 新函式預設 GRANT EXECUTE TO PUBLIC ⇒ 全數 REVOKE(trigger 由表擁有者觸發,零 role 需要)。
REVOKE ALL ON FUNCTION public.pcm_a4a_recompute_order_item_summary(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_a4a_received_quantity_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_a4a_procurement_summary_recompute()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_a4a_receipts_received_sync()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pcm_a4a_cancellation_summary_recompute()
  FROM PUBLIC, anon, authenticated, service_role;

-- ── 6. 防禦性 backfill(trigger 建立前、同交易;正式站三表 0 列 = no-op)──
-- 先修 received_quantity drift(R1-6)再重算摘要 —— 「先有資料/先有 drift 再 apply」的世界也正確。
DO $$
DECLARE
  v_fixed integer;
  v_n     integer := 0;
  r       record;
BEGIN
  PERFORM pg_catalog.set_config('pcm_a4a.received_sync', '1', true);
  UPDATE public.order_item_procurement p
     SET received_quantity = t.s
    FROM (SELECT p2.id, COALESCE((SELECT sum(r2.quantity)
                                    FROM public.order_item_procurement_receipts r2
                                   WHERE r2.procurement_id = p2.id), 0) AS s
            FROM public.order_item_procurement p2) t
   WHERE t.id = p.id AND p.received_quantity IS DISTINCT FROM t.s;
  GET DIAGNOSTICS v_fixed = ROW_COUNT;
  PERFORM pg_catalog.set_config('pcm_a4a.received_sync', '', true);

  FOR r IN
    SELECT DISTINCT x.order_item_id FROM (
      SELECT p.order_item_id FROM public.order_item_procurement p
      UNION
      SELECT c.order_item_id FROM public.order_cancellation_items c
    ) x
  LOOP
    PERFORM public.pcm_a4a_recompute_order_item_summary(r.order_item_id);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'A4a backfill:received drift 修復 % 列、摘要重算 % 個品項(正式站預期 0/0)', v_fixed, v_n;
END
$$;

-- ── 7. triggers ─────────────────────────────────────────────
CREATE TRIGGER order_item_procurement_received_quantity_guard_bt
  BEFORE INSERT OR UPDATE ON public.order_item_procurement
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a4a_received_quantity_guard();

-- 唯一 DEFERRABLE(Q2=A 先例內、與 a2b1 guard 成對;名稱 zc 排序在 guard_ac 之後 = 名稱序契約)。
CREATE CONSTRAINT TRIGGER order_item_procurement_summary_recompute_zc
  AFTER INSERT OR UPDATE OR DELETE ON public.order_item_procurement
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a4a_procurement_summary_recompute();

-- NOT DEFERRABLE(R1-19:不新開交易契約)。
CREATE CONSTRAINT TRIGGER order_item_procurement_receipts_received_sync_ac
  AFTER INSERT OR UPDATE OR DELETE ON public.order_item_procurement_receipts
  NOT DEFERRABLE
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a4a_receipts_received_sync();

CREATE CONSTRAINT TRIGGER order_cancellation_items_summary_recompute_ac
  AFTER INSERT OR UPDATE OR DELETE ON public.order_cancellation_items
  NOT DEFERRABLE
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a4a_cancellation_summary_recompute();

-- ── 8. 結構驗收(fail-closed;行為探針見第 9 節與 scripts/a4a-verify.sh)──
DO $$
DECLARE
  v_cnt    integer;
  v_tg     pg_catalog.pg_trigger%ROWTYPE;
  v_def    text;
  v_config text[];
  v_owner  oid;
  v_fn     text;
  v_oid    oid;
  v_tgname text;
  v_relid  regclass;
  v_type   integer;
  v_defer  boolean;
BEGIN
  -- 8a. 四支 trigger 逐支:存在唯一、掛對表、指對函式、tgtype 位元、deferrability、enabled=O。
  --     tgtype:ROW=1 BEFORE=2 INSERT=4 DELETE=8 UPDATE=16 TRUNCATE=32。
  FOR v_tgname, v_relid, v_fn, v_type, v_defer IN
    SELECT * FROM (VALUES
      ('order_item_procurement_received_quantity_guard_bt',
       'public.order_item_procurement'::regclass,
       'public.pcm_a4a_received_quantity_guard()', 1|2|4|16, false),
      ('order_item_procurement_summary_recompute_zc',
       'public.order_item_procurement'::regclass,
       'public.pcm_a4a_procurement_summary_recompute()', 1|4|8|16, true),
      ('order_item_procurement_receipts_received_sync_ac',
       'public.order_item_procurement_receipts'::regclass,
       'public.pcm_a4a_receipts_received_sync()', 1|4|8|16, false),
      ('order_cancellation_items_summary_recompute_ac',
       'public.order_cancellation_items'::regclass,
       'public.pcm_a4a_cancellation_summary_recompute()', 1|4|8|16, false)
    ) AS t(n, rel, fn, typ, def)
  LOOP
    SELECT count(*) INTO v_cnt FROM pg_catalog.pg_trigger
     WHERE tgname = v_tgname AND NOT tgisinternal;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION 'A4a 驗收失敗 — trigger % 應恰 1 支,實 %(SET CONSTRAINTS 依名作用 ⇒ 唯一性是行為契約)', v_tgname, v_cnt;
    END IF;
    SELECT * INTO v_tg FROM pg_catalog.pg_trigger
     WHERE tgname = v_tgname AND NOT tgisinternal;
    IF v_tg.tgrelid <> v_relid THEN
      RAISE EXCEPTION 'A4a 驗收失敗 — % 掛錯表:%', v_tgname, v_tg.tgrelid::regclass;
    END IF;
    IF v_tg.tgfoid <> v_fn::regprocedure THEN
      RAISE EXCEPTION 'A4a 驗收失敗 — % 指錯函式:%', v_tgname, v_tg.tgfoid::regproc;
    END IF;
    IF v_tg.tgtype <> v_type THEN
      RAISE EXCEPTION 'A4a 驗收失敗 — % tgtype=% 預期 %', v_tgname, v_tg.tgtype, v_type;
    END IF;
    IF v_tg.tgenabled <> 'O' THEN
      RAISE EXCEPTION 'A4a 驗收失敗 — % tgenabled=%', v_tgname, v_tg.tgenabled;
    END IF;
    IF v_defer THEN
      IF NOT v_tg.tgdeferrable OR v_tg.tginitdeferred THEN
        RAISE EXCEPTION 'A4a 驗收失敗 — % 應 DEFERRABLE INITIALLY IMMEDIATE(def=% initdef=%)',
          v_tgname, v_tg.tgdeferrable, v_tg.tginitdeferred;
      END IF;
    ELSIF v_tgname LIKE '%_ac' THEN
      IF v_tg.tgdeferrable OR v_tg.tginitdeferred THEN
        RAISE EXCEPTION 'A4a 驗收失敗 — % 應 NOT DEFERRABLE(R1-19)', v_tgname;
      END IF;
    END IF;
    -- constraint trigger 必有 pg_constraint 列;BEFORE guard 必無
    IF v_tgname LIKE '%_bt' THEN
      IF v_tg.tgconstraint <> 0 THEN
        RAISE EXCEPTION 'A4a 驗收失敗 — % 不應是 constraint trigger', v_tgname;
      END IF;
    ELSIF v_tg.tgconstraint = 0 OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint WHERE oid = v_tg.tgconstraint AND contype = 't') THEN
      RAISE EXCEPTION 'A4a 驗收失敗 — % 不是 constraint trigger(tgconstraint=%)', v_tgname, v_tg.tgconstraint;
    END IF;
  END LOOP;

  -- 8b. 名稱序契約(K10;一次性斷言,契約債⑥):procurement 表上 a2b1 guard 名 < 本片 zc 名。
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger g, pg_catalog.pg_trigger z
     WHERE g.tgrelid = 'public.order_item_procurement'::regclass AND NOT g.tgisinternal
       AND z.tgrelid = 'public.order_item_procurement'::regclass AND NOT z.tgisinternal
       AND g.tgname = 'order_item_procurement_allocation_guard_ac'
       AND z.tgname = 'order_item_procurement_summary_recompute_zc'
       AND g.tgname < z.tgname) THEN
    RAISE EXCEPTION 'A4a 驗收失敗 — 名稱序契約破裂:guard 必須排序在重算之前(錯誤歸因 P2B01 先於 23514 押在這上面)';
  END IF;

  -- 8c. 五支函式逐支:SECURITY DEFINER、proconfig、ACL allowlist + 三 role 顯式否定。
  FOR v_fn IN
    SELECT unnest(ARRAY[
      'public.pcm_a4a_recompute_order_item_summary(uuid)',
      'public.pcm_a4a_received_quantity_guard()',
      'public.pcm_a4a_procurement_summary_recompute()',
      'public.pcm_a4a_receipts_received_sync()',
      'public.pcm_a4a_cancellation_summary_recompute()'])
  LOOP
    v_oid := v_fn::regprocedure;
    IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
      RAISE EXCEPTION 'A4a 驗收失敗 — % 不是 SECURITY DEFINER', v_fn;
    END IF;
    SELECT proconfig INTO v_config FROM pg_catalog.pg_proc WHERE oid = v_oid;
    IF v_config IS NULL OR NOT ('search_path=public, pg_temp' = ANY(v_config)) THEN
      RAISE EXCEPTION 'A4a 驗收失敗 — % search_path 未釘死(%)', v_fn, v_config;
    END IF;
    IF v_fn <> 'public.pcm_a4a_received_quantity_guard()'
       AND NOT ('lock_timeout=5s' = ANY(v_config)) THEN
      RAISE EXCEPTION 'A4a 驗收失敗 — % 函式級 lock_timeout 未釘(%)', v_fn, v_config;
    END IF;
    SELECT count(*) INTO v_cnt
      FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     WHERE p.oid = v_oid AND a.grantee <> p.proowner;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'A4a 驗收失敗 — % ACL 有 % 個 owner 以外 grantee', v_fn, v_cnt;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'A4a 驗收失敗 — % 對應用 role 仍有 EXECUTE', v_fn;
    END IF;
  END LOOP;

  -- 8d. owner 對齊(R2-8:五表 —— 核心函式實際讀寫 order_items + 三來源表 + 摘要表)
  --     + 五表不得 FORCE RLS(definer 會被自己擋死)。
  SELECT proowner INTO v_owner FROM pg_catalog.pg_proc
   WHERE oid = 'public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure;
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_class
   WHERE oid IN ('public.order_items'::regclass,
                 'public.order_item_procurement'::regclass,
                 'public.order_item_procurement_receipts'::regclass,
                 'public.order_cancellation_items'::regclass,
                 'public.order_item_quantity_summary'::regclass)
     AND relowner <> v_owner;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A4a 驗收失敗 — 函式 owner 與 % 張表 owner 不對齊', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_class
   WHERE oid IN ('public.order_items'::regclass,
                 'public.order_item_procurement'::regclass,
                 'public.order_item_procurement_receipts'::regclass,
                 'public.order_cancellation_items'::regclass,
                 'public.order_item_quantity_summary'::regclass)
     AND relforcerowsecurity;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A4a 驗收失敗 — % 張表開了 FORCE ROW LEVEL SECURITY', v_cnt;
  END IF;

  -- 8e. 字面錨:helper NKU 恰 1 次、instock 走 receipts JOIN;三支入口各自帶自己的 tag;
  --     guard 帶旗標判定與 nullif 防空字串。全序(鎖→三 SUM→upsert)錨於 helper。
  v_def := pg_catalog.pg_get_functiondef('public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure);
  IF (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, 'FOR NO KEY UPDATE', '')))
     / pg_catalog.length('FOR NO KEY UPDATE') <> 1 THEN
    RAISE EXCEPTION 'A4a 驗收失敗 — helper 的 FOR NO KEY UPDATE 應恰 1 次';
  END IF;
  DECLARE
    p1 integer := pg_catalog.strpos(v_def, 'FOR NO KEY UPDATE');
    p2 integer := pg_catalog.strpos(v_def, 'sum(p.allocated_quantity)');
    p3 integer := pg_catalog.strpos(v_def, 'JOIN public.order_item_procurement p2 ON p2.id = r.procurement_id');
    p4 integer := pg_catalog.strpos(v_def, 'sum(c.cancelled_quantity)');
    p5 integer := pg_catalog.strpos(v_def, 'ON CONFLICT (order_item_id) DO UPDATE');
  BEGIN
    IF NOT (p1 > 0 AND p2 > p1 AND p3 > p2 AND p4 > p3 AND p5 > p4) THEN
      RAISE EXCEPTION 'A4a 驗收失敗 — helper 全序不符(%,%,%,%,%)', p1, p2, p3, p4, p5;
    END IF;
  END;
  IF pg_catalog.strpos(v_def, 'received_quantity') <> 0 THEN
    RAISE EXCEPTION 'A4a 驗收失敗 — helper 竟讀 received_quantity 累計欄(instock 必須真相直讀 receipts)';
  END IF;
  FOR v_fn, v_tgname IN
    SELECT * FROM (VALUES
      ('public.pcm_a4a_procurement_summary_recompute()',  'a4a_iso_rc_procurement'),
      ('public.pcm_a4a_receipts_received_sync()',         'a4a_iso_rc_receipts'),
      ('public.pcm_a4a_cancellation_summary_recompute()', 'a4a_iso_rc_cancellation')
    ) AS t(fn, tag)
  LOOP
    v_def := pg_catalog.pg_get_functiondef(v_fn::regprocedure);
    IF pg_catalog.strpos(v_def, '<> ''read committed''') = 0
       OR pg_catalog.strpos(v_def, v_tgname) = 0 THEN
      RAISE EXCEPTION 'A4a 驗收失敗 — % 缺隔離閘可執行式或專屬 tag %', v_fn, v_tgname;
    END IF;
  END LOOP;
  v_def := pg_catalog.pg_get_functiondef('public.pcm_a4a_received_quantity_guard()'::regprocedure);
  IF pg_catalog.strpos(v_def, 'pcm_a4a.received_sync') = 0
     OR pg_catalog.strpos(v_def, 'nullif') = 0 THEN
    RAISE EXCEPTION 'A4a 驗收失敗 — guard 缺旗標判定或 nullif 防空字串';
  END IF;

  -- 8f. backfill 後漂移 oracle(獨立推導:逐軸 correlated subquery,不重用 helper JOIN 形狀)。
  SELECT count(*) INTO v_cnt FROM public.order_item_procurement p
   WHERE p.received_quantity IS DISTINCT FROM COALESCE((
         SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
          WHERE r.procurement_id = p.id), 0);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A4a 驗收失敗 — backfill 後仍有 % 列 received drift', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.order_item_quantity_summary s
   WHERE s.ordered_quantity IS DISTINCT FROM COALESCE((
           SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p
            WHERE p.order_item_id = s.order_item_id), 0)
      OR s.cancelled_quantity IS DISTINCT FROM COALESCE((
           SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c
            WHERE c.order_item_id = s.order_item_id), 0)
      OR s.instock_quantity IS DISTINCT FROM COALESCE((
           SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
            WHERE r.procurement_id IN (SELECT p2.id FROM public.order_item_procurement p2
                                        WHERE p2.order_item_id = s.order_item_id)), 0);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A4a 驗收失敗 — backfill 後 % 列摘要漂移', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM (
    SELECT p.order_item_id FROM public.order_item_procurement p
    UNION
    SELECT c.order_item_id FROM public.order_cancellation_items c) x
   WHERE NOT EXISTS (SELECT 1 FROM public.order_item_quantity_summary s
                      WHERE s.order_item_id = x.order_item_id);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A4a 驗收失敗 — % 個有活動的品項缺摘要列', v_cnt;
  END IF;

  RAISE NOTICE 'A4a 結構驗收全數通過(四 trigger 形狀 + 名稱序 + 五函式安全面 + 五表 owner/RLS + 字面錨 + backfill oracle)';
END
$$;

-- ── 9. 行為探針(條件式,照 A2/D0 慣例:無合適品項時 NOTICE 略過、不造假綠)──
-- ⚠️ 誠實口徑(codex 關卡2 nit):探針對真實品項 INSERT/DELETE 採購與到貨資料,
--    「零留痕」只宣稱零可見業務列 —— 鎖、WAL、dead tuple 仍會產生(A7-2 同口徑)。
-- 承接 A2 20260729020000:611-613 的翻面指示:receipt INSERT → received 被維護;直寫 → P4A01。
-- 探針資料全數當場刪除(摘要探針列一併刪 —— 摘要無 trigger,owner 可刪;零留痕)。
DO $$
DECLARE
  v_item uuid;
  v_sup  uuid;
  v_proc uuid;
  v_rq   integer;
  v_sum  record;
BEGIN
  SELECT oi.id INTO v_item
    FROM public.order_items oi
   WHERE oi.quantity >= 1
     AND NOT EXISTS (SELECT 1 FROM public.order_item_procurement p WHERE p.order_item_id = oi.id)
     AND NOT EXISTS (SELECT 1 FROM public.order_cancellation_items c WHERE c.order_item_id = oi.id)
     AND NOT EXISTS (SELECT 1 FROM public.order_item_quantity_summary s WHERE s.order_item_id = oi.id)
   LIMIT 1;
  SELECT s.id INTO v_sup FROM public.suppliers s LIMIT 1;
  IF v_item IS NULL OR v_sup IS NULL THEN
    RAISE NOTICE 'A4a 行為探針【略過】— 無零活動品項或無供應商(空庫 from-zero 屬預期;行為證據由 scripts/a4a-verify.sh 提供)';
    RETURN;
  END IF;

  INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity)
  VALUES (v_item, v_sup, 1)
  RETURNING id INTO v_proc;

  INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
  VALUES (v_proc, 1, pg_catalog.now(), 'a4a_probe');

  SELECT received_quantity INTO v_rq FROM public.order_item_procurement WHERE id = v_proc;
  IF v_rq IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'A4a 探針失敗 — receipt INSERT 後 received_quantity=%(應 1;A2 合約債③①未兌現)', v_rq;
  END IF;
  SELECT ordered_quantity, instock_quantity, cancelled_quantity INTO v_sum
    FROM public.order_item_quantity_summary WHERE order_item_id = v_item;
  IF v_sum IS NULL OR v_sum.ordered_quantity <> 1 OR v_sum.instock_quantity <> 1 OR v_sum.cancelled_quantity <> 0 THEN
    RAISE EXCEPTION 'A4a 探針失敗 — 摘要 =(%,%,%)應 (1,1,0)', v_sum.ordered_quantity, v_sum.instock_quantity, v_sum.cancelled_quantity;
  END IF;

  BEGIN
    -- 任何「改動」都被擋(此處 1→2;等值 no-op 寫入無語意效果、旗標制刻意放行 —— plan §3.5 誠實界)
    UPDATE public.order_item_procurement SET received_quantity = 2 WHERE id = v_proc;
    RAISE EXCEPTION 'A4A_PROBE_NOT_BLOCKED';
  EXCEPTION
    WHEN SQLSTATE 'P4A01' THEN NULL;
  END;

  DELETE FROM public.order_item_procurement_receipts WHERE procurement_id = v_proc;
  DELETE FROM public.order_item_procurement WHERE id = v_proc;
  DELETE FROM public.order_item_quantity_summary WHERE order_item_id = v_item;
  IF EXISTS (SELECT 1 FROM public.order_item_procurement WHERE id = v_proc)
     OR EXISTS (SELECT 1 FROM public.order_item_quantity_summary WHERE order_item_id = v_item) THEN
    RAISE EXCEPTION 'A4a 探針失敗 — 清理殘留';
  END IF;
  RAISE NOTICE 'A4a 行為探針通過(receipt 同步 + 摘要 (1,1,0) + 直寫 P4A01 + 零留痕)';
END
$$;

COMMIT;

-- ============================================================
-- 🔴 回滾:另立版本號更大的 down migration(Supabase forward-only);
--   完整程序(摘要表已有真實資料時)= docs/runbooks/a4a-summary-rollback.md,
--   六步含災難分支,演練 = scripts/a4a-rollback-rehearsal.sh(A4a DoD 硬前置)。
--   物件清單:
--   DROP TRIGGER order_item_procurement_received_quantity_guard_bt ON public.order_item_procurement;
--   DROP TRIGGER order_item_procurement_summary_recompute_zc       ON public.order_item_procurement;
--   DROP TRIGGER order_item_procurement_receipts_received_sync_ac  ON public.order_item_procurement_receipts;
--   DROP TRIGGER order_cancellation_items_summary_recompute_ac     ON public.order_cancellation_items;
--   DROP FUNCTION public.pcm_a4a_received_quantity_guard();
--   DROP FUNCTION public.pcm_a4a_procurement_summary_recompute();
--   DROP FUNCTION public.pcm_a4a_receipts_received_sync();
--   DROP FUNCTION public.pcm_a4a_cancellation_summary_recompute();
--   DROP FUNCTION public.pcm_a4a_recompute_order_item_summary(uuid);
-- ⚠️ 下游:A4b harness、A5a(依賴本片自動重算不重複實作,master plan :379)——
--   A5a 上線後單獨回滾本片 = 摘要與 received 凍結,必須同停 A5a;
--   回滾後摘要表 = stale(COMMENT 標記),A1 §9 全回滾另依 runbook 第⑥步。
-- ============================================================
