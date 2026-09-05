-- 20260906180000 · M-4b ⟦b4-BANKNOEMAIL⟧ 片③:把「這張單還該不該收到匯款成立信」抽成一支 view。
--
-- 🛑🛑 **草稿。未 commit 時未 apply。** 🔴 **貼板 45e;它【必須】排在 20260906170000 之後。**
--
-- ══════════════════════════════════════════════════════════════════
-- 為什麼要抽 —— **與 20260906150000 那一次【同一個形狀】, 不是同一個理由的重複**
-- ══════════════════════════════════════════════════════════════════
-- 🔬 **問題**:寄送當下要重驗「這張單現在還該不該收到這封信」(R3-MF2/MF8)——
--    掃描是**快照**, 寄送是**後來**;客人可能已經匯完、已取消、或匯了一半。
-- 🛑 **而 `pcm_bank_order_created_email_pending` 重用不了**:它帶著 outbox anti-join,
--    而**寄送當下那一列已經存在** ⇒ 直接查它**一定回空** ⇒ 每一封都會被判成「不該寄」。
-- ⇒ 🔴 **兩條路**:①重驗自己寫一段判那七條 ⇒ **一條【錢的規則】變成兩份**
--    ②把七條抽出來, 兩邊都讀它 ⇒ **單一來源**。
-- ✅ **主視窗 2026-09-06 裁【乙】** —— 與它 03:0x 對 `order_balance_base_v` 那一裁**同一個判準**:
--    **錢的規則只准一份。**
--
-- 🔵 **本支【不改任何述詞】** —— 七條逐字從 `20260906170000` 搬過來(程式抄的),
--    `pcm_bank_order_created_email_pending` 改成 `本 view + anti-join`。
--    ⇒ 📌 **輸出欄名/欄序逐字不變** —— 那是 `42P16` 的坑, 前置閘會先撈線上欄名比對。
--
-- ⚠️ **本支證不到什麼**:它證得到「兩邊讀同一支」, **證不到「寄送當下真的會走這條路」**
--    —— 那是碼那一半, 由 use-case 的測試守。
--
-- ══════════════════════════════════════════════════════════════════
-- 🔴 貼板順序(中斷在哪一支就回報哪一支)
-- ══════════════════════════════════════════════════════════════════
--   45a-45d  2026-09-06 03:2x 已貼(帳本已記)
--   45e      ← 本支
-- 🛑 反序的症狀:本支先於 170000 ⇒ 前置閘①擋下(它會說 pending view 不在)。

BEGIN;

DO $precondition$
DECLARE
  v_cols text;
  v_cnt  int;
BEGIN
  -- 前置閘①:170000 那支要在(本支要改它)
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'pcm_bank_order_created_email_pending' AND c.relkind = 'v';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '前置閘①:pcm_bank_order_created_email_pending 不在 ⇒ 20260906170000 還沒貼, 本支不可以先跑';
  END IF;

  -- 前置閘②:🔴 線上【實際】欄名清單 —— 不是我記得的那個(42P16)
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_bank_order_created_email_pending'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols <> 'order_id,display_id,created_at,total,balance_due,notification_email,customer_email,order_source' THEN
    RAISE EXCEPTION '前置閘②:pending view 線上欄位是 [%], 與預期不符 ⇒ 我的新體會撞 42P16', v_cols;
  END IF;

  -- 前置閘③:base view 要在(七條述詞裡有一條讀它)
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'order_balance_base_v' AND c.relkind = 'v';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '前置閘③:order_balance_base_v 不在 ⇒ 20260906150000 還沒貼';
  END IF;

  -- 前置閘④:forward-only
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'pcm_bank_order_still_mailable';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '前置閘④:pcm_bank_order_still_mailable 已存在 ⇒ forward-only,拒重跑';
  END IF;
END
$precondition$;

-- ══════════════════════════════════════════════════════════════════
-- ① 七條述詞的唯一一份(**無 anti-join** —— 那正是它與 pending view 的差別)
-- ══════════════════════════════════════════════════════════════════
CREATE VIEW public.pcm_bank_order_still_mailable
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
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

COMMENT ON VIEW public.pcm_bank_order_still_mailable IS
  '⟦b4-BANKNOEMAIL⟧:「這張單【現在】還該不該收到匯款成立信」的**唯一一份**判準(七條, **不含** outbox anti-join)。
🔴 兩個消費端:①`pcm_bank_order_created_email_pending`(= 本 view + anti-join)⇒ 排信用;
②寄送前重驗 ⇒ 直接查本 view(那時 outbox 已經有列, 查 pending 一定回空)。
🛑 **要改「誰該收到這封信」, 改這裡** —— 在別處再寫一份, 兩份會漂,
而漂掉時客人拿到的是一封叫他匯錢而他其實不必匯的信。
⚠️ 本 view 含 PII(兩個 email 欄)⇒ 僅 service_role 可讀。
⚠️ 它答的是【現在】, 不是【寄出那一瞬間】—— 重驗與 send 之間仍有一段不可消除的 race(plan §7)。';

REVOKE ALL ON public.pcm_bank_order_still_mailable FROM PUBLIC;
REVOKE ALL ON public.pcm_bank_order_still_mailable FROM anon, authenticated, service_role;
GRANT SELECT ON public.pcm_bank_order_still_mailable TO service_role;

-- ══════════════════════════════════════════════════════════════════
-- ② pending view 改成「本 view + anti-join」—— **輸出欄逐字不變**
-- ══════════════════════════════════════════════════════════════════
-- 🔴 述詞一個字都不在這裡 —— 它們住在上面那支。
--    📌 **本 view 若再出現任何 payment_ / balance_ / order_source 條件, 就代表規則又變兩份了。**
CREATE OR REPLACE VIEW public.pcm_bank_order_created_email_pending
  WITH (security_invoker = false, security_barrier = true) AS
SELECT
  m.order_id           AS order_id,
  m.display_id         AS display_id,
  m.created_at         AS created_at,
  m.total              AS total,
  m.balance_due        AS balance_due,
  m.notification_email AS notification_email,
  m.customer_email     AS customer_email,
  m.order_source       AS order_source
FROM public.pcm_bank_order_still_mailable m
WHERE NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = m.order_id
           AND e.event_type = 'bank_order_created');

COMMENT ON VIEW public.pcm_bank_order_created_email_pending IS
  '⟦b4-BANKNOEMAIL⟧ 排信用的掃描面 = `pcm_bank_order_still_mailable` **加上** outbox anti-join。
🔴 **2026-09-06 起七條述詞【不在本 view】** —— 它們住在 pcm_bank_order_still_mailable(片③),
本 view 只負責「還沒排過信」那一條。
🛑 **要改「誰該收到這封信」, 改那一支, 不要在這裡再寫一份。**
🛑 本 view 不含 cutoff(參數, 留在 adapter);而那顆 env **必須是 cutoff 不是 on/off**。
⚠️ 本 view 含 PII(兩個 email 欄)⇒ 僅 service_role 可讀。';

-- 🔴 `CREATE OR REPLACE VIEW` **不重設 ACL**, 而在這裡重下一次是冪等的 ⇒ 讓本支自己站得住。
REVOKE ALL ON public.pcm_bank_order_created_email_pending FROM PUBLIC;
REVOKE ALL ON public.pcm_bank_order_created_email_pending FROM anon, authenticated, service_role;
-- ACL-GATE-EXEMPT: public.pcm_bank_order_created_email_pending -- 重述 20260906170000 既有授權, 寄信端要用(貼板 45e, 2026-09-06)
GRANT SELECT ON public.pcm_bank_order_created_email_pending TO service_role;

DO $postcheck$
DECLARE
  -- 🔴🔴 **收權斷言清單 —— 本檔建的【每一個可授權物件】都要列進來。**
  --   📌 收權斷言**只檢查你列出來的物件**:它防「忘記收權」, **不防「忘記列」**。
  v_relations text[] := ARRAY[
    'public.pcm_bank_order_still_mailable'
  ]::text[];
  v_i    integer;
  v_def  text;
  v_pend text;
  v_cols text;
  v_cnt  int;
BEGIN
  SELECT definition INTO v_def FROM pg_catalog.pg_views
   WHERE schemaname = 'public' AND viewname = 'pcm_bank_order_still_mailable';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '事後閘①:建完找不到 pcm_bank_order_still_mailable';
  END IF;

  -- 事後閘②:七條述詞的語意特徵都在(不比整段 —— pg_get_viewdef 會重寫)
  IF pg_catalog.strpos(v_def, 'bank_transfer') = 0
     OR pg_catalog.strpos(v_def, 'unpaid') = 0
     OR pg_catalog.strpos(v_def, 'cancelled_at') = 0
     OR pg_catalog.strpos(v_def, 'manual_request_id') = 0
     OR pg_catalog.strpos(v_def, 'balance_due') = 0
     OR pg_catalog.strpos(v_def, 'pcm_js_trim_whitespace') = 0 THEN
    RAISE EXCEPTION '事後閘②:述詞的語意特徵沒有全部命中 ⇒ 我漏了一條(實得 %)', v_def;
  END IF;

  -- 🔴🔴 事後閘③:**本 view 不可以有 anti-join** —— 有了它, 寄送前重驗會【每一封都判不該寄】,
  --   而症狀是「一封都沒寄出去」= 這一整片要修的那個病。
  IF pg_catalog.strpos(v_def, 'email_outbox') > 0 THEN
    RAISE EXCEPTION '事後閘③:still_mailable 裡出現 email_outbox ⇒ 重驗會每一封都判不該寄';
  END IF;

  -- 🔵 事後閘④:上面兩道要有判別力
  IF pg_catalog.strpos(v_def, 'zzz_never_a_feature') > 0 THEN
    RAISE EXCEPTION '事後閘④:現造字面命中 ⇒ 這把尺壞了';
  END IF;

  SELECT definition INTO v_pend FROM pg_catalog.pg_views
   WHERE schemaname = 'public' AND viewname = 'pcm_bank_order_created_email_pending';
  IF v_pend IS NULL THEN
    RAISE EXCEPTION '事後閘⑤:改完找不到 pending view';
  END IF;

  -- 事後閘⑥:pending view 真的改成從 still_mailable 讀了
  IF pg_catalog.strpos(v_pend, 'pcm_bank_order_still_mailable') = 0 THEN
    RAISE EXCEPTION '事後閘⑥:pending view 沒有讀 still_mailable ⇒ 這一支沒做到它宣稱的事';
  END IF;

  -- 🔴🔴 事後閘⑦:**規則沒有留下第二份** —— pending view 裡不該再有那七條的原料。
  --   📌 這一格才是本支存在的理由;少了它, 一個「兩邊都留著」的世界會通過閘⑥。
  IF pg_catalog.strpos(v_pend, 'bank_transfer') > 0
     OR pg_catalog.strpos(v_pend, 'manual_request_id') > 0
     OR pg_catalog.strpos(v_pend, 'pcm_js_trim_whitespace') > 0 THEN
    RAISE EXCEPTION '事後閘⑦:pending view 裡還看得到述詞原料 ⇒ 規則變成兩份了(實得 %)', v_pend;
  END IF;

  -- 事後閘⑧:pending view 的 anti-join 還在(拿掉它 ⇒ 每輪重寄)
  IF pg_catalog.strpos(v_pend, 'email_outbox') = 0 THEN
    RAISE EXCEPTION '事後閘⑧:pending view 沒有 anti-join ⇒ 每一輪都會重寄同一封';
  END IF;

  -- 事後閘⑨:pending view 欄名/欄序逐字不變(42P16 的正面驗收)
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_bank_order_created_email_pending'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols <> 'order_id,display_id,created_at,total,balance_due,notification_email,customer_email,order_source' THEN
    RAISE EXCEPTION '事後閘⑨:pending view 欄位變成 [%] ⇒ adapter 會壞', v_cols;
  END IF;

  -- 事後閘⑩:ACL 白名單 —— 兩支都只有 service_role
  SELECT count(*) INTO v_cnt FROM (
    SELECT (pg_catalog.aclexplode(c.relacl)).grantee AS g, c.relname
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('pcm_bank_order_still_mailable', 'pcm_bank_order_created_email_pending')
  ) t
  WHERE t.g <> 0
    AND pg_catalog.pg_get_userbyid(t.g) NOT IN ('service_role', current_user);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '事後閘⑩:ACL 上有 service_role 與 owner 以外的角色(% 個)', v_cnt;
  END IF;
  -- 🔴 relacl 是 NULL 時 aclexplode 回零列 ⇒ 上面那個 0 是假的 ⇒ 另外問一次
  IF (SELECT bool_or(c.relacl IS NULL) FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname IN ('pcm_bank_order_still_mailable', 'pcm_bank_order_created_email_pending')) THEN
    RAISE EXCEPTION '事後閘⑩b:有一支的 relacl 是 NULL ⇒ 兩道 REVOKE 沒留下痕跡, 閘⑩的 0 是假的';
  END IF;

  -- 🔵 而那張清單要**真的被讀到** —— 否則它只是一段給守門看的裝飾。
  FOREACH v_i IN ARRAY ARRAY[1] LOOP
    IF v_relations[v_i] IS NULL THEN
      RAISE EXCEPTION '事後閘⑪:收權斷言清單少了第 % 項', v_i;
    END IF;
    IF pg_catalog.to_regclass(v_relations[v_i]) IS NULL THEN
      RAISE EXCEPTION '事後閘⑪:清單裡的 % 不存在', v_relations[v_i];
    END IF;
  END LOOP;
END
$postcheck$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════
-- 回退(可執行 —— 而**有順序**)
-- ══════════════════════════════════════════════════════════════════
-- 🔴 **先把 pending view 換回自己帶述詞的舊體**(逐字抄 `20260906170000` 的 `CREATE VIEW` 那一段,
--    改成 `CREATE OR REPLACE`), **然後才** `DROP VIEW public.pcm_bank_order_still_mailable;`
--    —— 反了就是 `42P01`, 而症狀是掃描端每輪出錯 ⇒ 503。
-- 🛑 **不要憑記憶重寫那七條述詞。**
