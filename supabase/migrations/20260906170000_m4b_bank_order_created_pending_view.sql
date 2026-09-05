-- 20260906170000 · M-4b ⟦b4-BANKNOEMAIL⟧ 片②-c:匯款單成立信的掃描面。
--
-- 🛑🛑 **草稿。未 commit、未 apply。** 🔴 **貼板 45 第四支;必須排在 150000 與 160000 之後。**
-- 🔴 **它自己是惰性的** —— 沒有掃描器與模板就沒有人讀它。三件一起落(plan §5)。
--
-- ══════════════════════════════════════════════════════════════════
-- 述詞逐條, 每一條旁邊寫【少了它會怎樣】
-- ══════════════════════════════════════════════════════════════════
--  payment_channel = 'bank_transfer'  少了它 ⇒ 刷卡單也收到叫他匯錢的信
--    🟢 這一欄的白名單**是真的白名單**:`20260712203000:48` 逐字 `NOT NULL DEFAULT 'tappay'`
--       ⇒ 忘記寫會拿到 `tappay`, 不會拿到 `bank_transfer`。(R3 替我複驗過)
--    🛑 **而 `order_source` 那一欄【相反】, 見下** —— 同一份檔裡兩欄兩種答案, **不可以類推。**
--  payment_status  = 'unpaid'         少了它 ⇒ 已付款的客人收到催款信
--  cancelled_at IS NULL               少了它 ⇒ 已取消的單還在催款
--  balance_due > 0 AND <= total       🔴 R3-MF1/MF2:見下面那一大段
--  order_source = 'web'
--    AND manual_request_id IS NULL    🔴 兩條一起, 而**兩條都不是證明**, 見下
--  收件人至少一個非空                  🔴 R3-MF4:見下
--  outbox anti-join                    少了它 ⇒ 每輪重寄
--
-- ══════════════════════════════════════════════════════════════════
-- 🔴🔴 `balance_due` 那一格 —— **印不印由金額決定**(主視窗 2026-09-06 裁)
-- ══════════════════════════════════════════════════════════════════
-- 規則與**訂單頁那一塊逐字同一條**:`apps/storefront/src/components/account/OrderDetailView.tsx:620-641`
--   「只有在我們手上有一個**可信的正數**時才印帳號與金額;其餘一律叫他聯絡我們。」
-- ⇒ `balance_due` 為 `NULL`(有退款 ⇒ 算不出來)/ `<= 0`(付清或多付)/ `> total`(壞掉的狀態)
--   ⇒ 🛑 **這封信【不寄】**。
-- 📌 **一封印公司帳號的催款信, 只在「確定還要匯正數」的世界寄。**
-- 🔬 而 `NULL` 的成因之一逐字寫在 `20260905330000` 的註解裡:**有 confirmed 退款**
--    ⇒ 少了這一格 ⇒ **一個已經退完款的客人會收到一封叫他再匯一次全額的信。**
-- 🔵 `NULL > 0` 在 SQL 是 `NULL` ⇒ WHERE 當假 ⇒ NULL 自然被排除。**而我不靠這個默契**:
--    下面顯式寫 `IS NOT NULL`, 因為**讀的人要看得見它被處理過**。
--
-- ══════════════════════════════════════════════════════════════════
-- 🔴🔴 來源那兩條 —— **它們【不是】證明, 而我不假裝它們是**
-- ══════════════════════════════════════════════════════════════════
-- `20260712203000:40` 逐字 `ADD COLUMN order_source text NOT NULL DEFAULT 'web'`
--   ⇒ 🛑 **`'web'` 正是【忘記寫】會拿到的那個值** ⇒ `= 'web'` 在這一欄上**不是白名單**。
--   📌 而 `20260824020000:37` 逐字就寫著「吃 DEFAULT `'web'` ⇒ 手動單與客人自己下的單**分不出來**」。
-- ✅ 所以再加一條:`manual_request_id IS NULL`(後台建單**一定**寫它 ——
--    `20260905360000:188` 逐字 `IF p_manual_request_id IS NULL THEN` 直接拒絕)。
-- ⚠️ **兩條都是「忘記寫會通過」的方向** ⇒ 合起來把「**要同時忘記兩欄, 而且還顯式寫了
--    `bank_transfer`**」變成必要條件, **不是把漏洞關掉**。
-- 🔴 **真正的關法是【寫入端顯式標記來源】, 那不是本片** —— 板列要有落點。
--
-- ══════════════════════════════════════════════════════════════════
-- 🔴🔴 收件人那一條 —— **它是本 view 存在的理由之一**(R3-MF4)
-- ══════════════════════════════════════════════════════════════════
-- 少了它:enqueue 對「兩個信箱都空」是 `noRecipient++ ; continue`, **不寫任何 outbox 列**
-- ⇒ anti-join 看不到列 ⇒ 🛑 **每一輪重撈、永遠**, 把 `ENQUEUE_LIMIT` 佔滿,
--    **真的要寄的信被擠出去** —— 而它不報錯、不進死信、心跳照綠。
-- 📎 形狀與理由逐字對齊 `20260905030000:97-100`(該 view 的 COMMENT 稱之為「本 view 存在的理由」)。
-- 🔴 空白定義走 `pcm_js_trim_whitespace()` **單一來源**;⚠️ `nullif` **不加** `pg_catalog.` 前綴
--    —— 它是 SQL【語法】不是函式(這條線踩過兩次)。

BEGIN;

DO $precondition$
DECLARE v_cnt int;
BEGIN
  -- 前置閘①:base view 要在(餘額從它來)
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'order_balance_base_v' AND c.relkind = 'v';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '前置閘①:order_balance_base_v 不在 ⇒ 20260906150000 還沒貼';
  END IF;

  -- 前置閘②:🔴 event_type 白名單要已經放寬 —— 否則掃得到而寫不進去
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.conname = 'email_outbox_event_type_check'
     AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid), '''bank_order_created''') > 0;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '前置閘②:bank_order_created 不在 event_type 白名單裡 ⇒ 20260906140000 還沒貼 ⇒ 掃得到而寫不進去';
  END IF;

  -- 前置閘③:空白定義那支單一來源要在
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_js_trim_whitespace';
  IF v_cnt < 1 THEN
    RAISE EXCEPTION '前置閘③:找不到 pcm_js_trim_whitespace ⇒ 空白定義沒有單一來源';
  END IF;

  -- 前置閘④:forward-only
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'pcm_bank_order_created_email_pending';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '前置閘④:pcm_bank_order_created_email_pending 已存在 ⇒ forward-only,拒重跑';
  END IF;
END
$precondition$;

CREATE VIEW public.pcm_bank_order_created_email_pending
  WITH (security_invoker = false, security_barrier = true) AS
SELECT
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.created_at         AS created_at,
  o.total              AS total,
  bal.balance_due      AS balance_due,
  o.notification_email AS notification_email,
  c.email              AS customer_email,
  o.order_source       AS order_source
FROM public.orders o
JOIN public.order_balance_base_v bal ON bal.order_id = o.id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE o.payment_channel = 'bank_transfer'
  AND o.payment_status  = 'unpaid'
  AND o.cancelled_at IS NULL
  AND o.order_source = 'web'
  AND o.manual_request_id IS NULL
  AND bal.balance_due IS NOT NULL
  AND bal.balance_due > 0
  AND bal.balance_due <= o.total
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'bank_order_created')
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

COMMENT ON VIEW public.pcm_bank_order_created_email_pending IS
  '⟦b4-BANKNOEMAIL⟧:「顧客站建的、選匯款、尚未付款、未取消、還有【可信的正數】要匯、還沒排過 bank_order_created、而且至少一個信箱非空」的訂單。
🔴 balance_due 那三條(NOT NULL / > 0 / <= total)與訂單頁 OrderDetailView.tsx:620-641 是**同一條規則**:
   只有在我們手上有一個可信的正數時才印帳號與金額。有退款的單 base view 回 NULL ⇒ 本 view 收不到它
   ⇒ 📌 一個已經退完款的客人不會收到叫他再匯一次的信。
🔴 order_source = ''web'' **不是來源證明**(那一欄 DEFAULT 就是 ''web'' ⇒ 忘記寫會通過),
   所以配一條 manual_request_id IS NULL。**兩條合起來仍不是證明**, 只是把「要同時忘記兩欄」變成必要條件。
   真正的關法是寫入端顯式標記來源, 不在本片。
🔴 最後那個信箱條件是本 view 存在的理由之一:兩個信箱都空的單不會自己好, 留在掃描面上會被每一輪重撈,
   累積到上限就把名額佔滿, 讓真的要寄的信擠不進來 —— 而它不報錯、不進死信、心跳照綠。
🛑 本 view 不含 cutoff(參數, 留在 adapter);而那顆 env **必須是 cutoff 不是 on/off**,
   否則上膛第一輪會掃到所有歷史未付款匯款單、一次寄一疊, 而信收不回來。
⚠️ 本 view 含 PII(兩個 email 欄)⇒ 僅 service_role 可讀。
⚠️ 它證不到「寄出當下條件還成立」—— 掃描是快照, 寄送是後來;寄送前重驗在碼那一半。';

-- 🔴 兩道 REVOKE:少一道都是開的。
REVOKE ALL ON public.pcm_bank_order_created_email_pending FROM PUBLIC;
REVOKE ALL ON public.pcm_bank_order_created_email_pending FROM anon, authenticated, service_role;
GRANT SELECT ON public.pcm_bank_order_created_email_pending TO service_role;

DO $postcheck$
DECLARE
  -- 🔴🔴 **收權斷言清單 —— 本檔建的【每一個可授權物件】都要列進來。**
  --   `scripts/migration-new-file-static-checks.sh` ③ 當場擋下我(可授權物件 1, 清單 0)。
  --   ⇒ 📌 收權斷言**只檢查你列出來的物件**:它防「忘記收權」, **不防「忘記列」**
  --     ⇒ 那道靜態閘補的正是後者。
  v_relations text[] := ARRAY[
    'public.pcm_bank_order_created_email_pending'
  ]::text[];
  v_i integer;
  v_def  text;
  v_cols text;
  v_cnt  int;
BEGIN
  SELECT definition INTO v_def FROM pg_catalog.pg_views
   WHERE schemaname = 'public' AND viewname = 'pcm_bank_order_created_email_pending';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '事後閘①:建完找不到本 view';
  END IF;

  -- 事後閘②:八條述詞的語意特徵都在(不比整段 —— pg_get_viewdef 會重寫)
  IF pg_catalog.strpos(v_def, 'bank_transfer') = 0
     OR pg_catalog.strpos(v_def, 'unpaid') = 0
     OR pg_catalog.strpos(v_def, 'cancelled_at') = 0
     OR pg_catalog.strpos(v_def, 'manual_request_id') = 0
     OR pg_catalog.strpos(v_def, 'balance_due') = 0
     OR pg_catalog.strpos(v_def, 'bank_order_created') = 0
     OR pg_catalog.strpos(v_def, 'pcm_js_trim_whitespace') = 0 THEN
    RAISE EXCEPTION '事後閘②:述詞的語意特徵沒有全部命中 ⇒ 我漏了一條(實得 %)', v_def;
  END IF;

  -- 🔵 事後閘③:上面那道要有判別力
  IF pg_catalog.strpos(v_def, 'zzz_never_a_feature') > 0 THEN
    RAISE EXCEPTION '事後閘③:現造字面命中 ⇒ 這把尺壞了';
  END IF;

  -- 事後閘④:欄位就這八個(多帶一欄 = 多曝一份 PII)
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_bank_order_created_email_pending'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols <> 'order_id,display_id,created_at,total,balance_due,notification_email,customer_email,order_source' THEN
    RAISE EXCEPTION '事後閘④:欄位不是預期的八欄(實得 %)', v_cols;
  END IF;

  -- 事後閘⑤:ACL 白名單 —— 只有 service_role
  SELECT count(*) INTO v_cnt FROM (
    SELECT (pg_catalog.aclexplode(c.relacl)).grantee AS g
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'pcm_bank_order_created_email_pending'
  ) t
  WHERE t.g <> 0
    AND pg_catalog.pg_get_userbyid(t.g) NOT IN ('service_role', current_user);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '事後閘⑤:ACL 上有 service_role 與 owner 以外的角色(% 個)', v_cnt;
  END IF;
  -- 🔴 relacl 是 NULL 時 aclexplode 回零列 ⇒ 上面那個 0 是假的 ⇒ 另外問一次
  IF (SELECT c.relacl IS NULL FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'pcm_bank_order_created_email_pending') THEN
    RAISE EXCEPTION '事後閘⑤b:relacl 是 NULL ⇒ 兩道 REVOKE 沒留下痕跡, 閘⑤的 0 是假的';
  END IF;
  -- 🔵 而那張清單要**真的被讀到** —— 否則它只是一段給守門看的裝飾。
  FOREACH v_i IN ARRAY ARRAY[1] LOOP
    IF v_relations[v_i] IS NULL THEN
      RAISE EXCEPTION '事後閘⑥:收權斷言清單少了第 % 項', v_i;
    END IF;
    IF pg_catalog.to_regclass(v_relations[v_i]) IS NULL THEN
      RAISE EXCEPTION '事後閘⑥:清單裡的 % 不存在 ⇒ 清單與實際建的物件對不起來', v_relations[v_i];
    END IF;
  END LOOP;
END
$postcheck$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════
-- 回退(可執行 —— 而**要在退 base view 之前**)
-- ══════════════════════════════════════════════════════════════════
-- DROP VIEW IF EXISTS public.pcm_bank_order_created_email_pending;
-- 🔴 退掉本 view ⇒ 掃描端 42P01 ⇒ 整輪 sweep 回 503。**先關碼那一半, 再退它。**
-- 🛑 而已經落在 email_outbox 的 bank_order_created 列**不會**被本 DROP 清掉 ——
--    退版之後舊碼撞 buildEmailText 的 default ⇒ throw ⇒ 每 5 分鐘紅一次, 燒完 attempts 成終態,
--    而 anti-join 只看列在不在 ⇒ **那一批客人之後再也排不進信**(R3-C5)。
--    ⇒ 📌 **回退的代價不是「回到原狀」, 這一句要跟著這支檔走。**
