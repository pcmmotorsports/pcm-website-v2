-- ============================================================
-- M-4b E10 第 1 批 · A2b1:order_item_procurement 跨列總量守門 constraint trigger
-- ============================================================
-- 規格:docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md §5.1 row 28(:363-370,
--       含 2026-08-03 Q4=A 鎖字面修訂)、§5.1b:452(取消後採購事實不動,互為表裡)。
-- 片級 plan:docs/specs/2026-08-03-e10-a2b1-procurement-allocation-guard-plan.md(v5 現行)。
-- 關卡1:codex gpt-5.6-sol xhigh R1/R2 + Fable R3 共 40 條、駁回 0;
--       findings 逐字 = docs/reviews/2026-08-03-e10-a2b1-k1-codex.md。
-- 🔴 Sean 2026-08-03 拍板(「依照建議」):
--    Q1=A 隔離閘只允許 read committed(SERIALIZABLE 也拒、不信 SSI)
--    Q2=A DEFERRABLE INITIALLY IMMEDIATE(可顯式 defer「先超後補」;延後非繞過)
--    Q3=A gate-first(閘在 skip 之前;非 RC 下連調降也拒,行為統一)
--    Q4=A master plan row 28/A4a 鎖序字面同日修訂
--
-- 守門公式(row 28 R6 delta):對同一 order_item_id,
--   SUM(allocated_quantity) ≤ order_items.quantity − SUM(order_cancellation_items.cancelled_quantity)
-- 兩個 SUM 都直接打真相表;只在「INSERT / 調升 / 換 parent」時 assert;
-- 調降與持平不守(取消前已寫入的採購事實不動)。
--
-- 🔴 鎖原語 = FOR NO KEY UPDATE,不是 FOR UPDATE(本機 PG17.10 實測,2026-08-03):
--    FK RI 檢查在同一 statement 內先對 parent 取 FOR KEY SHARE;兩筆併發 INSERT
--    各持 KEY SHARE 再升 FOR UPDATE = 鎖升級死結(40P01 重現)。
--    NKU 與 KEY SHARE 相容、guard 彼此互斥 ⇒ 同實驗零死結。
--    🔴 契約:A4a / A8a2 之後鎖同一 parent 一律同用 FOR NO KEY UPDATE(master plan A4a row 已改)。
--
-- 🔴 隔離閘(P2B02)= 本守門的健全性前提,不是保險:
--    REPEATABLE READ 下等到列鎖之後,SUM 仍用交易快照 ⇒ 看不到兄弟交易已提交列
--    ⇒ 兩筆各 3 件對 quantity=3 的品項雙雙放行(實測 RR SUM=3 vs RC SUM=6)。
--    SERIALIZABLE 理論可靠 SSI 自保,但 Q1=A 選擇不信任、一律拒收(fail-closed;
--    今日零 writer、A5a 走 PostgREST 預設 RC,拒收零成本)。
--
-- 🔴 C2 鎖序實況(Q4=A):AFTER trigger 物理上先碰 procurement 列才鎖 parent。
--    守門互斥靠 parent 列鎖;跨物件取鎖紀律屬 writer。
--    死結面誠實列界:A5a 單列 upsert 交易無環;多列單交易 writer 必須按
--    完整 business key (order_item_id, supplier_id) 排序寫入(deferred 交易跨
--    statement 的 parent 觸達順序同受此約束),違約 = PG 偵測 40P01 abort(fail-closed 可重試)。
--
-- 🔴 COALESCE 辨析:本函式兩個 COALESCE 包「真相表 SUM」——零列 = 真的零,
--    不是 A1 row(:361)禁令所指的「摘要快取缺列翻成 0」。
--    order_item_quantity_summary 在本函式一個 byte 都不出現(結構驗收 3f 釘死)。
--
-- 🟡 契約債(對未來片有約束力,誠實列出):
--  ① 第 2 批 shipped_quantity 落地時必須重審本守門公式(master plan :452 只點名
--     A8a1/A8a2/A8b,本片主動登記)。
--  ② 第 3 批改單(order_items.quantity 調降)不觸發本守門重驗 —— 既有採購可能因此
--     超量(與「取消後不追溯」同語意);今日全 repo 零 quantity writer(2026-08-03 grep;
--     admin_update_order_item_workflow 只寫 workflow_status/version/updated_at,
--     20260716130000:138-142),改單片自己決定處置。
--  ③ 死配額列膨脹 SUM(Fable R3 F3):供應商回 out_of_stock 後改派第二家,原列
--     allocated_quantity ≥ 1 禁歸零、A5a 只 upsert 無 delete ⇒ 守門把死列照算、
--     誤攔改派(方向 = 過度攔截 fail-closed,非放行)。自然家 = 第 3 批採購退貨線
--     (master plan :452);在那之前 A10b/A12b 的 UI 文案要能解釋這種攔截。
--  ④ 減量方向(DELETE 採購列 / 調降)完全不守 —— 那是帳實不符問題,A4a 重算層的事。
--  ⑤ TRUNCATE 不攔(本表 ACL 無任何 role 有 TRUNCATE;owner 天花板同 A7-t)。
--  ⑥ 🔴 取消側寫入不受本守門序列化(關卡2 code-reviewer 抓):取消表零 trigger、
--     不取 order_items 鎖 ⇒「取消先 commit、採購後 commit 但檢查在取消 commit 前」的
--     交錯會滑過 delta 守門(終態 = 合法的「先採購後取消」形狀,但依 commit 序其實是
--     「先取消後採購」)。今日零實害:取消表對應用 role 零寫權(20260730130000:267-268)、
--     A8a1/A8a2 未建。⇒ A4a 對 order_cancellation_items 掛同一把 NKU 之前,此窗口存在;
--     A4a 的 DoD 必含把取消側寫入納入同一鎖(master plan A4a row 已要求鎖 parent)。
--
-- 🔴 break-glass(誤攔當天的合法出路;A7b D8 教訓 —— 程序寫死、不當天發明):
--    執行者 = owner(postgres;Sean 經 dashboard SQL editor)。
--    🔴 整段包在單一交易(codex 關卡2 MF6:分段執行時中途失敗 = trigger 永久停用):
--      BEGIN;
--      ALTER TABLE public.order_item_procurement
--        DISABLE TRIGGER order_item_procurement_allocation_guard_ac;
--      -- 修正資料(此處填當日的修復 SQL)
--      ALTER TABLE public.order_item_procurement
--        ENABLE TRIGGER order_item_procurement_allocation_guard_ac;
--      -- 對受影響品項以守門公式重驗(違反 = RAISE ⇒ 整段回滾、trigger 不會停著):
--      DO $bg$ DECLARE r record; BEGIN
--        FOR r IN SELECT p.order_item_id, sum(p.allocated_quantity) a,
--                        (SELECT oi.quantity FROM public.order_items oi WHERE oi.id = p.order_item_id) q,
--                        COALESCE((SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c
--                                   WHERE c.order_item_id = p.order_item_id),0) x
--                   FROM public.order_item_procurement p GROUP BY p.order_item_id
--        LOOP IF r.a > r.q - r.x THEN RAISE EXCEPTION 'break-glass 重驗失敗:% (%>%-%)', r.order_item_id, r.a, r.q, r.x; END IF; END LOOP;
--      END $bg$;
--      COMMIT;
--    交易失敗 = 全部回滾(含 DISABLE)⇒ 不存在「修一半、trigger 停著」的狀態。
--    事後:停用視窗內的寫入逐列列出、記入當日 handoff。
--    這不是繞過授權:能執行的人本來就在 trigger 天花板之上;寫死是為了災難日不拼 SQL。
--
-- 誠實邊界:tgenabled='O' ⇒ session_replication_role=replica 可跳過(A7-t 同天花板);
--    隔離閘只作用於有觸發 guard 的 row event(DELETE 未掛、零列 UPDATE 不觸發);
--    函式級 lock_timeout 只保護本函式內的顯式 NKU 等待(SQLSTATE 55P03),
--    保護不到進函式前的 DML tuple 鎖與 FK RI KEY SHARE 等待,且為每次取鎖各算。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 守門函式 ─────────────────────────────────────────────
-- 🔴 刻意用 CREATE 而非 CREATE OR REPLACE(A7-t 20260730140000:138-142 教訓):
--    OR REPLACE 保留既有同名函式的 owner 與 ACL ⇒「已存在」直接 fail-closed。
-- SECURITY DEFINER:本函式要 SELECT order_items / order_cancellation_items ——
--    後者對任何應用 role 零 SELECT(20260730130000:267-268)、且三表皆 zero-policy RLS;
--    definer(= 表 owner)讀取確定可行(同 A7-t 論證)。
CREATE FUNCTION public.pcm_a2b1_procurement_allocation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  v_qty       bigint;   -- 🔴 三個變數全 bigint:危險在變數宣告不在表達式
  v_alloc     bigint;   --    (SUM(integer) 本回 bigint;窄化任一個 = B10 紅在 22003)
  v_cancelled bigint;
BEGIN
  -- ① 隔離閘(Q1=A + Q3=A gate-first):非 read committed 一律拒收。
  --    RR 下等鎖後 SUM 用交易快照、看不到兄弟提交 ⇒ 守門會雙雙放行(實測);
  --    SERIALIZABLE 拍板不信任 SSI、一律拒。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'A2b1 隔離閘:守門僅在 read committed 下健全(目前 = %);拒收',
      pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'a2b1_isolation_read_committed_only';
  END IF;

  -- ② skip:同 parent 且未調升 ⇒ 不守(row 28 delta 語意:調降/持平放行;
  --    判定只用 OLD/NEW 實體值、不依賴快照)。
  IF TG_OP = 'UPDATE'
     AND NEW.order_item_id = OLD.order_item_id
     AND NEW.allocated_quantity <= OLD.allocated_quantity THEN
    RETURN NULL;
  END IF;

  -- ③ 鎖 parent(NKU;守門互斥的承重)。
  SELECT oi.quantity INTO v_qty
    FROM public.order_items oi
   WHERE oi.id = NEW.order_item_id
   FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    -- 防衛枝:FK RI trigger 依名序先發火(23503),本枝不可構造 ⇒ 不列守門計數、
    -- 無負測、無突變格(plan §3.6;A6 [38] 死守門教訓的誠實寫法)。
    RAISE EXCEPTION 'A2b1 防衛枝:order_items % 不存在(FK 應已先擋;此枝理論不可達)',
      NEW.order_item_id;
  END IF;

  -- ④ 真相表重算(AFTER ⇒ 採購 SUM 已含 NEW 列)。
  SELECT COALESCE(sum(p.allocated_quantity), 0) INTO v_alloc
    FROM public.order_item_procurement p
   WHERE p.order_item_id = NEW.order_item_id;

  SELECT COALESCE(sum(c.cancelled_quantity), 0) INTO v_cancelled
    FROM public.order_cancellation_items c
   WHERE c.order_item_id = NEW.order_item_id;

  -- ⑤ 總量守門:恰好用滿合法(>,不是 >=)。
  IF v_alloc > v_qty - v_cancelled THEN
    RAISE EXCEPTION 'A2b1 超量:品項 % 採購合計 % 超過可訂購 %(quantity=% − 已取消=%)',
      NEW.order_item_id, v_alloc, v_qty - v_cancelled, v_qty, v_cancelled
      USING ERRCODE = 'P2B01', CONSTRAINT = 'a2b1_allocation_within_orderable';
  END IF;

  RETURN NULL;
END
$$;

COMMENT ON FUNCTION public.pcm_a2b1_procurement_allocation_guard() IS
  'M-4b E10 A2b1:採購跨列總量守門。SUM(allocated) ≤ quantity − SUM(cancelled),兩個 SUM 直接打真相表(order_item_procurement / order_cancellation_items),絕不讀 order_item_quantity_summary 快取。只守 INSERT/調升/換 parent;調降持平放行。P2B01=超量、P2B02=隔離閘(僅 read committed)。鎖原語 FOR NO KEY UPDATE(FOR UPDATE 與 FK RI KEY SHARE 死結,2026-08-03 實測);A4a/A8a2 必須同原語。break-glass 程序見本 migration 檔頭。';

-- 新建 function 預設 GRANT EXECUTE TO PUBLIC ⇒ 全數 REVOKE;
-- trigger 由表擁有者觸發、不需要任何 role 的 EXECUTE(同 A7-t :208-212)。
REVOKE ALL ON FUNCTION public.pcm_a2b1_procurement_allocation_guard()
  FROM PUBLIC, anon, authenticated, service_role;

-- ── 2. constraint trigger ───────────────────────────────────
-- DEFERRABLE INITIALLY IMMEDIATE(Q2=A):預設逐 statement 發火(A5a 錯誤歸因);
-- 合法「先超後補」重平衡交易可顯式 SET CONSTRAINTS … DEFERRED(延後非繞過,
-- COMMIT 時同函式照跑;三態已實測)。
-- 不掛 DELETE(刪列只減總量);TRUNCATE 見檔頭契約債⑤。
CREATE CONSTRAINT TRIGGER order_item_procurement_allocation_guard_ac
  AFTER INSERT OR UPDATE ON public.order_item_procurement
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION public.pcm_a2b1_procurement_allocation_guard();

-- ── 3. 結構驗收(fail-closed;零條件略過分支 —— 行為探針全在 scripts/a2b1-verify.sh,
--       照 A7 20260730130000:271-272 的分工:探針資料前提不足時的 NOTICE+exit 0 = fail-open 假綠)──
DO $$
DECLARE
  v_cnt     integer;
  v_tg      pg_catalog.pg_trigger%ROWTYPE;
  v_def     text;
  v_config  text[];
  v_fnoid   oid;
  v_owner   oid;
BEGIN
  -- 3a. trigger 存在、掛對表、指對函式;同名 trigger 全庫唯一
  --     (SET CONSTRAINTS name 作用於「所有」同名 constraint trigger ⇒ 唯一性是行為契約)
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_trigger
   WHERE tgname = 'order_item_procurement_allocation_guard_ac' AND NOT tgisinternal;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'A2b1 驗收失敗 — 同名 trigger 應恰 1 支,實 % 支', v_cnt;
  END IF;
  SELECT * INTO v_tg FROM pg_catalog.pg_trigger
   WHERE tgname = 'order_item_procurement_allocation_guard_ac' AND NOT tgisinternal;
  IF v_tg.tgrelid <> 'public.order_item_procurement'::regclass THEN
    RAISE EXCEPTION 'A2b1 驗收失敗 — trigger 掛錯表:%', v_tg.tgrelid::regclass;
  END IF;
  v_fnoid := 'public.pcm_a2b1_procurement_allocation_guard()'::regprocedure;
  IF v_tg.tgfoid <> v_fnoid THEN
    RAISE EXCEPTION 'A2b1 驗收失敗 — trigger 指錯函式:%', v_tg.tgfoid::regproc;
  END IF;

  -- 3b. tgtype 位元:ROW(1)+INSERT(4)+UPDATE(16);AFTER(bit2=0);無 DELETE(8)/TRUNCATE(32)
  IF (v_tg.tgtype & 1) = 0 OR (v_tg.tgtype & 2) <> 0 OR (v_tg.tgtype & 4) = 0
     OR (v_tg.tgtype & 8) <> 0 OR (v_tg.tgtype & 16) = 0 OR (v_tg.tgtype & 32) <> 0 THEN
    RAISE EXCEPTION 'A2b1 驗收失敗 — tgtype=% 應為 AFTER ROW INSERT OR UPDATE(無 DELETE/TRUNCATE)', v_tg.tgtype;
  END IF;

  -- 3c. DEFERRABLE INITIALLY IMMEDIATE + enabled origin(Q2=A 的可驗形狀)
  IF NOT v_tg.tgdeferrable OR v_tg.tginitdeferred OR v_tg.tgenabled <> 'O' THEN
    RAISE EXCEPTION 'A2b1 驗收失敗 — 應 DEFERRABLE INITIALLY IMMEDIATE 且 tgenabled=O(實 def=% initdef=% enabled=%)',
      v_tg.tgdeferrable, v_tg.tginitdeferred, v_tg.tgenabled;
  END IF;
  -- constraint trigger 必有對應 pg_constraint 列(contype='t')
  IF v_tg.tgconstraint = 0 OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint WHERE oid = v_tg.tgconstraint AND contype = 't') THEN
    RAISE EXCEPTION 'A2b1 驗收失敗 — 不是 constraint trigger(tgconstraint=%)', v_tg.tgconstraint;
  END IF;

  -- 3d. 函式:SECURITY DEFINER + proconfig 釘 search_path 與 lock_timeout
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_fnoid) THEN
    RAISE EXCEPTION 'A2b1 驗收失敗 — 函式不是 SECURITY DEFINER';
  END IF;
  SELECT proconfig INTO v_config FROM pg_catalog.pg_proc WHERE oid = v_fnoid;
  IF v_config IS NULL OR NOT ('search_path=public, pg_temp' = ANY(v_config)) THEN
    RAISE EXCEPTION 'A2b1 驗收失敗 — search_path 未釘死(proconfig=%)', v_config;
  END IF;
  IF NOT ('lock_timeout=5s' = ANY(v_config)) THEN
    RAISE EXCEPTION 'A2b1 驗收失敗 — 函式級 lock_timeout 未釘(proconfig=%)', v_config;
  END IF;

  -- 3e. 函式 ACL:完整 allowlist(owner 以外零 grantee)+ 四 role 顯式否定(A7-t :388-404 兩層)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
   WHERE p.oid = v_fnoid AND a.grantee <> p.proowner;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A2b1 驗收失敗 — 函式 ACL 有 % 個 owner 以外的 grantee(新函式預設 GRANT PUBLIC,必須全 REVOKE)', v_cnt;
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fnoid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fnoid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_fnoid, 'EXECUTE') THEN
    RAISE EXCEPTION 'A2b1 驗收失敗 — anon/authenticated/service_role 對守門函式仍有 EXECUTE';
  END IF;

  -- 3f. 函式定義字面:NKU 恰一次、摘要表零出現、隔離閘存在
  v_def := pg_catalog.pg_get_functiondef(v_fnoid);
  IF (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, 'FOR NO KEY UPDATE', '')))
     / pg_catalog.length('FOR NO KEY UPDATE') <> 1 THEN
    RAISE EXCEPTION 'A2b1 驗收失敗 — FOR NO KEY UPDATE 應恰出現 1 次';
  END IF;
  IF pg_catalog.strpos(v_def, 'order_item_quantity_summary') <> 0 THEN
    RAISE EXCEPTION 'A2b1 驗收失敗 — 守門函式竟引用摘要快取表(C1 禁令)';
  END IF;
  -- 錨定可執行式(<> 'read committed'),不錨註解/訊息字面(那些也含 read committed,恆真)
  IF pg_catalog.strpos(v_def, '<> ''read committed''') = 0 THEN
    RAISE EXCEPTION 'A2b1 驗收失敗 — 隔離閘可執行式不存在';
  END IF;
  -- 全序位置斷言(codex 關卡2 N15):閘 → skip → 鎖 → 採購 SUM → 取消 SUM → 比較,
  -- 六個可執行錨在函式本體內嚴格遞增(字面錨在死分支/註解裡滿足不了順序)。
  -- ⚠️ 誠實邊界(K2 R2-5):這是文字比對不是控制流分析 —— 等價重構(改別名/等價比較式)
  --    會合法誤紅;錨「可執行」的真正證明在 harness 行為格(B9c/B5d/B12/B4/B1),此斷言只鎖順序。
  DECLARE
    p1 integer := pg_catalog.strpos(v_def, '<> ''read committed''');
    p2 integer := pg_catalog.strpos(v_def, 'NEW.allocated_quantity <= OLD.allocated_quantity');
    p3 integer := pg_catalog.strpos(v_def, 'FOR NO KEY UPDATE');
    p4 integer := pg_catalog.strpos(v_def, 'sum(p.allocated_quantity)');
    p5 integer := pg_catalog.strpos(v_def, 'sum(c.cancelled_quantity)');
    p6 integer := pg_catalog.strpos(v_def, 'v_alloc > v_qty - v_cancelled');
  BEGIN
    IF NOT (p1 > 0 AND p2 > p1 AND p3 > p2 AND p4 > p3 AND p5 > p4 AND p6 > p5) THEN
      RAISE EXCEPTION 'A2b1 驗收失敗 — 守門全序不符(%,%,%,%,%,%)', p1, p2, p3, p4, p5, p6;
    END IF;
  END;

  -- 3g. owner 對齊(A6 教訓:definer 讀 zero-policy RLS 表,owner 不對齊 = 上線首筆就死)
  --     + 三張讀取表不得 FORCE RLS(FORCE + 零 policy 連 owner 都擋)
  SELECT proowner INTO v_owner FROM pg_catalog.pg_proc WHERE oid = v_fnoid;
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_class
   WHERE oid IN ('public.order_items'::regclass,
                 'public.order_item_procurement'::regclass,
                 'public.order_cancellation_items'::regclass)
     AND relowner <> v_owner;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A2b1 驗收失敗 — 函式 owner 與 % 張讀取表 owner 不對齊', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_class
   WHERE oid IN ('public.order_items'::regclass,
                 'public.order_item_procurement'::regclass,
                 'public.order_cancellation_items'::regclass)
     AND relforcerowsecurity;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A2b1 驗收失敗 — % 張讀取表開了 FORCE ROW LEVEL SECURITY(definer 會被自己擋死)', v_cnt;
  END IF;

  RAISE NOTICE 'A2b1 結構驗收全數通過(trigger 形狀 + 函式安全面 + 字面錨 + owner 對齊)';
END
$$;

COMMIT;

-- ============================================================
-- 🔴 回滾:另立版本號更大的 down migration(Supabase forward-only):
--   DROP TRIGGER order_item_procurement_allocation_guard_ac ON public.order_item_procurement;
--   DROP FUNCTION public.pcm_a2b1_procurement_allocation_guard();
-- ⚠️ 下游(回滾前必先確認未上線/已回滾):A2b2 harness、A4a/A4b、A5a ——
--   A5a 依賴本守門不重複實作(master plan :379)⇒ A5a 上線後單獨回滾本片
--   = 採購寫入失去總量守門,必須同停 A5a。名單對齊 A2 20260729020000:670-675。
-- ============================================================
