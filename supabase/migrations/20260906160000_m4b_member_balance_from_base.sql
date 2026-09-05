-- 20260906160000 · M-4b ⟦b4-BANKNOEMAIL⟧ 片②-b:member_order_balance_v 改成【從 base view 讀】。
--
-- 🛑🛑 **草稿。未 commit、未 apply。** 🔴 **貼板 45 第三支;它【必須】排在 20260906150000 之後。**
--
-- 🎯 **本支唯一的目的:讓那條錢的規則只剩一份。** 演算法一個字都不改, 只換來源。
--    ⇒ 📌 **前台 `OrderDetailView` 應該零改動** —— 而「應該」不算數, `⑤` 那兩發測試才算。
--
-- 🔴🔴 **輸出欄【名稱 / 順序 / 型別】逐字不變, 而那不是禮貌是硬約束**:
--    `CREATE OR REPLACE VIEW` 改到欄名或欄序 ⇒ **`42P16`**(貼板 39 踩過那個坑)。
--    ⇒ 前置閘②把**線上實際的欄名清單**撈出來比對, 而不是比我記得的。
--
-- ⚠️ **本支證不到什麼**:migration 裡跑不出「以 authenticated 身分讀得到自己那張單」——
--    那需要一個真的 JWT。⇒ 🔴 **own-only 的【列層】效力由探針證**
--    (`docs/probes/bank-order-created-event-probe.sh` 的 balance 段), 本支只證得到 **ACL 層**。
--    📌 **兩者不同**:ACL 說「你打得開這扇門」, `auth.uid()` 說「門裡只有你的東西」。

BEGIN;

DO $precondition$
DECLARE
  v_cols text;
  v_cnt  int;
BEGIN
  -- 前置閘①:base view 要在(本支要從它讀)
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'order_balance_base_v' AND c.relkind = 'v';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '前置閘①:order_balance_base_v 不在 ⇒ 20260906150000 還沒貼, 本支不可以先跑';
  END IF;

  -- 前置閘②:🔴 線上【實際】欄名清單 —— 不是我記得的那個
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.member_order_balance_v'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols <> 'order_id,balance_due' THEN
    RAISE EXCEPTION '前置閘②:member_order_balance_v 線上欄位是 [%], 不是 order_id,balance_due ⇒ 我的新體會撞 42P16', v_cols;
  END IF;

  -- 前置閘③:🔴 它是【我抄的那一代】—— 語意特徵, 不比整段(pg_get_viewdef 會重寫)
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_views
   WHERE schemaname = 'public' AND viewname = 'member_order_balance_v'
     AND pg_catalog.strpos(definition, 'order_manual_refunds') > 0
     AND pg_catalog.strpos(definition, 'voided_at') > 0
     AND pg_catalog.strpos(definition, 'order_paid_totals_v') > 0
     AND pg_catalog.strpos(definition, 'uid()') > 0;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '前置閘③:member_order_balance_v 不是 20260905330000 那一代(四個語意特徵沒有同時命中)⇒ 停下人工確認';
  END IF;
END
$precondition$;

-- 🔴 演算法一個字都不在這裡 —— 它住在 order_balance_base_v。
--    📌 **本支若出現任何 CASE / EXISTS / 減法, 就代表規則又變成兩份了。**
CREATE OR REPLACE VIEW public.member_order_balance_v
  WITH (security_invoker = false, security_barrier = true) AS
SELECT
  b.order_id   AS order_id,
  b.balance_due AS balance_due
FROM public.order_balance_base_v b
JOIN public.orders o ON o.id = b.order_id
WHERE o.customer_user_id = auth.uid();

COMMENT ON VIEW public.member_order_balance_v IS
  '⟦b4-PARTIALPAIDNOWHERE⟧:客人自己那張單的應付餘額。
🔴 **2026-09-06 起演算法【不在本 view】** —— 它住在 public.order_balance_base_v(⟦b4-BANKNOEMAIL⟧ 片②-a),
本 view 只負責 own-only 那一層(WHERE customer_user_id = auth.uid())。
🛑 **要改應付餘額的算法, 改 base view, 不要在這裡再寫一份。**
⚠️ 舊字面留著讓搜「total 減掉帳本已收淨額」的人撞到這裡:那段 CASE 已搬走, 邏輯逐字未改。
security_invoker=false 是刻意的 —— 底下的帳本對 authenticated 零 GRANT。只 GRANT SELECT 給 authenticated。';

-- 🔴 ACL 逐字照 20260905330000(兩道 REVOKE + 一道 GRANT)——
--    `CREATE OR REPLACE VIEW` **不會**重設 ACL, 而在這裡重下一次是冪等的,
--    📌 讓本支【自己站得住】, 不必依賴「330000 當初下對了」。
REVOKE ALL ON public.member_order_balance_v FROM PUBLIC;
REVOKE ALL ON public.member_order_balance_v FROM anon, authenticated, service_role;
-- 🔵 下面那一行【不是新開的權限】, 是逐字重述 20260905330000:126 —— `CREATE OR REPLACE VIEW` 不重設 ACL,
--    這裡重下一次是冪等的, 目的是讓本支自己站得住, 不必依賴「330000 當初下對了」。
--    誰要用:顧客站前台(客人看自己那張單的應付餘額);own-only 由 view 內的 auth.uid() 管, 不是 ACL 管。
--    🔴 為什麼不是 service_role:那是寄信端的角色, 它讀的是 order_balance_base_v(事後閘⑦d 在量那一格);
--    member view 給了 service_role 反而與 330000 的 ACL 不一致(事後閘⑦c 會紅)。
-- ACL-GATE-EXEMPT: public.member_order_balance_v -- 重述 20260905330000:126 既有授權, 顧客站前台要用(貼板 45, 2026-09-06)
GRANT SELECT ON public.member_order_balance_v TO authenticated;

DO $postcheck$
DECLARE
  v_def  text;
  v_cols text;
BEGIN
  SELECT definition INTO v_def FROM pg_catalog.pg_views
   WHERE schemaname = 'public' AND viewname = 'member_order_balance_v';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '事後閘①:改完找不到 member_order_balance_v';
  END IF;

  -- 事後閘②:欄名/欄序逐字不變(42P16 那個坑的正面驗收)
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.member_order_balance_v'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols <> 'order_id,balance_due' THEN
    RAISE EXCEPTION '事後閘②:欄位變成 [%] ⇒ 前台會壞', v_cols;
  END IF;

  -- 事後閘③:🔴 **它真的改成從 base 讀了**
  IF pg_catalog.strpos(v_def, 'order_balance_base_v') = 0 THEN
    RAISE EXCEPTION '事後閘③:新體裡看不到 order_balance_base_v ⇒ 這一支沒做到它宣稱的事';
  END IF;

  -- 事後閘④:🔴🔴 **規則沒有留下第二份** —— 新體裡不該再有那段 CASE 的特徵。
  --   📌 這一格才是本支存在的理由;少了它, 一個「兩邊都留著」的世界會通過 ③。
  IF pg_catalog.strpos(v_def, 'order_manual_refunds') > 0
     OR pg_catalog.strpos(v_def, 'order_paid_totals_v') > 0 THEN
    RAISE EXCEPTION '事後閘④:新體裡還看得到算式的原料 ⇒ 規則變成兩份了(實得 %)', v_def;
  END IF;

  -- 事後閘⑤:own-only 還在(拿掉它 ⇒ 每個客人看得到別人的餘額)
  IF pg_catalog.strpos(v_def, 'uid()') = 0 THEN
    RAISE EXCEPTION '事後閘⑤:新體裡沒有 uid() ⇒ own-only 不見了';
  END IF;

  -- 🔵 事後閘⑥:上面幾道要有判別力
  IF pg_catalog.strpos(v_def, 'zzz_never_a_feature') > 0 THEN
    RAISE EXCEPTION '事後閘⑥:現造字面命中 ⇒ 這把尺壞了';
  END IF;

  -- 事後閘⑦:ACL —— authenticated 讀得到, anon 與 service_role 讀不到
  IF NOT pg_catalog.has_table_privilege('authenticated', 'public.member_order_balance_v', 'SELECT') THEN
    RAISE EXCEPTION '事後閘⑦a:authenticated 讀不到 member view ⇒ 前台會壞';
  END IF;
  IF pg_catalog.has_table_privilege('anon', 'public.member_order_balance_v', 'SELECT') THEN
    RAISE EXCEPTION '事後閘⑦b:anon 讀得到 member view';
  END IF;
  IF pg_catalog.has_table_privilege('service_role', 'public.member_order_balance_v', 'SELECT') THEN
    RAISE EXCEPTION '事後閘⑦c:service_role 讀得到 member view ⇒ 與 330000 的 ACL 不一致';
  END IF;
  -- 🟢 正對照:同一把尺對 base view 要答【service_role 讀得到】—— 否則上面三個 false 可能只是尺壞了
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.order_balance_base_v', 'SELECT') THEN
    RAISE EXCEPTION '事後閘⑦d(正對照):service_role 讀不到 base view ⇒ 寄信端拿不到餘額, 而上面三格的 false 不可信';
  END IF;
END
$postcheck$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════
-- 回退(可執行 —— 逐字回到 20260905330000 那個體)
-- ══════════════════════════════════════════════════════════════════
-- 🔴 **回退本支【必須】在 DROP base view 之前** —— 反了就是前台 `42P01`。
-- 完整舊體在 `supabase/migrations/20260905330000_m4b_member_order_balance_v.sql:63-108`,
-- 🛑 **逐字抄那一段**(`CREATE OR REPLACE VIEW` + 同樣的 WITH 子句 + 那段 CASE + auth.uid() 過濾),
--    然後重下一次 ACL 三行。**不要憑記憶重寫那段 CASE。**
