-- 20260906190000 · M-4b ⟦b4-BANKNOEMAIL⟧ 片④(貼板 45f):讓【被我們自己跳過】的那些列可以重排。
--
-- 🛑🛑 **草稿。未 apply。** 🔴 **必須排在 45e(`20260906180000`)之後。**
--
-- ══════════════════════════════════════════════════════════════════
-- 問題(codex R1-#4/#5/#7 是同一個機制)
-- ══════════════════════════════════════════════════════════════════
-- 掃描面的 anti-join 逐字是「這張單有沒有 `bank_order_created` 的列」——
-- 🔴 **它 status-agnostic, 而且鍵在 `order_id + event_type`**
--    ⇒ 一列 `skipped_*` 落下去, **那張單再也排不進來**:
-- ```
-- 金額暫時錯 ⇒ 寄前重驗擋下 ⇒ 標終態 ⇒ 後台修回正數 ⇒ 🛑 仍被擋
-- 退版 ⇒ 舊碼撞 default ⇒ 燒完 attempts ⇒ 🛑 同上
-- ```
-- ⛔ **而「`dedup_key` 帶 version/hash」救不了它** —— 📌 **anti-join 根本不看 `dedup_key`。**
--    (主視窗 2026-09-06 原本給的方向, 它自己已經收回並記帳。)
--
-- ✅ **修法:anti-join 只排除【不是我們自己跳過的】那些列。**
--    · `pending` / `sending` / `sent` / `failed` 的列 ⇒ **仍然擋**(不重寄、不重排)
--    · `bank_order_not_mailable_at_send` / `bank_order_snapshot_stale` 的列 ⇒ **不擋**
--
-- 🔵 **為什麼「不擋」對這兩個碼是安全的, 而不是打開一個無限迴圈**:
--    本 view 讀的是 `pcm_bank_order_still_mailable` —— 那七條述詞**本身就是閘**。
--    · 被判 `not_mailable` 的單(已付款 / 已取消 / 餘額不再是正數)⇒ **它根本不在 still_mailable 裡**
--      ⇒ 📌 **不擋它也不會回來** —— 除非它**真的又變成該寄的**, 而那時重排正是我們要的。
--    · 被判 `snapshot_stale` 的單 ⇒ 它**仍在** still_mailable 裡 ⇒ 重排一封**帶新快照**的
--      ⇒ 而唯一鍵那一側由 `dedup_key` 帶快照指紋解(**那一半是碼, 不是本支**)。
--    ⚠️ **代價明寫**:後台若持續改金額, 每一輪會多一列 `snapshot_stale`。
--      🔵 有界 —— 它跟著「有人在改」而不是跟著時間長;而**一旦寄出去(`sent`), anti-join 就永久擋住**。
--
-- 🛑 **本支【不動】那七條述詞** —— 它們住在 `pcm_bank_order_still_mailable`。
--    📌 本 view 若再出現任何 payment_ / balance_ / order_source 條件, 就代表規則又變兩份了。

BEGIN;

DO $precondition$
DECLARE
  v_cols text;
  v_cnt  int;
BEGIN
  -- 前置閘①:45e 要先在(本支從它讀)
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'pcm_bank_order_still_mailable' AND c.relkind = 'v';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '前置閘①:pcm_bank_order_still_mailable 不在 ⇒ 45e(20260906180000)還沒貼';
  END IF;

  -- 前置閘②:🔴 線上【實際】欄名清單(42P16)
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_bank_order_created_email_pending'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols <> 'order_id,display_id,created_at,total,balance_due,notification_email,customer_email,order_source' THEN
    RAISE EXCEPTION '前置閘②:pending view 線上欄位是 [%], 與預期不符 ⇒ 新體會撞 42P16', v_cols;
  END IF;

  -- 前置閘③:forward-only —— 已經改過就拒重跑
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_views
   WHERE schemaname = 'public' AND viewname = 'pcm_bank_order_created_email_pending'
     AND pg_catalog.strpos(definition, 'bank_order_snapshot_stale') > 0;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '前置閘③:pending view 已經帶著那兩個 skip 碼了 ⇒ forward-only,拒重跑';
  END IF;
END
$precondition$;

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
           AND e.event_type = 'bank_order_created'
           -- 🔴🔴 **只有【不是我們自己跳過的】列才擋。**
           --    `COALESCE` 不可省:`last_error_code` 可以是 NULL(pending / sent 的列就是)
           --    ⇒ 少了它, `NULL NOT IN (…)` 回 NULL ⇒ WHERE 當假 ⇒ 🛑 **那些列就不擋了**
           --    ⇒ 📌 **每一輪重寄同一封**, 而那與本支要修的方向【相反】。
           AND COALESCE(e.last_error_code, '') NOT IN (
                 'bank_order_not_mailable_at_send',
                 'bank_order_snapshot_stale'
               ));

COMMENT ON VIEW public.pcm_bank_order_created_email_pending IS
  '⟦b4-BANKNOEMAIL⟧ 排信用的掃描面 = `pcm_bank_order_still_mailable` **加上** outbox anti-join。
🔴 **2026-09-06 45f 起, anti-join 只擋【不是我們自己跳過的】列**:
pending / sending / sent / failed 仍擋;而 `bank_order_not_mailable_at_send` 與
`bank_order_snapshot_stale` 兩個碼**不擋** —— 讓修正之後的新快照可以重排一封。
🔵 為什麼安全:七條述詞本身就是閘(住在 still_mailable)——
被判 not_mailable 的單根本不在那支 view 裡, 不擋它也不會回來;
被判 snapshot_stale 的單仍在, 而那正是我們要它重排的世界。
🛑 唯一鍵那一側由 `dedup_key` 帶快照指紋解(碼那一半, `bankOrderCreatedDedupKey`)——
少了它, 第二次 INSERT 會撞 UNIQUE(event_type, dedup_key) ⇒ 那張單仍然排不進來。
⚠️ 代價:後台持續改金額時每輪會多一列 snapshot_stale;有界(跟著「有人在改」而不是跟著時間),
而一旦寄出去(sent)anti-join 就永久擋住。
⚠️ 本 view 含 PII(兩個 email 欄)⇒ 僅 service_role 可讀。';

REVOKE ALL ON public.pcm_bank_order_created_email_pending FROM PUBLIC;
REVOKE ALL ON public.pcm_bank_order_created_email_pending FROM anon, authenticated, service_role;
-- ACL-GATE-EXEMPT: public.pcm_bank_order_created_email_pending -- 重述 20260906170000 既有授權, 寄信端要用(貼板 45f, 2026-09-06)
GRANT SELECT ON public.pcm_bank_order_created_email_pending TO service_role;

DO $postcheck$
DECLARE
  v_relations text[] := ARRAY['public.pcm_bank_order_created_email_pending']::text[];
  v_i    integer;
  v_def  text;
  v_cols text;
BEGIN
  SELECT definition INTO v_def FROM pg_catalog.pg_views
   WHERE schemaname = 'public' AND viewname = 'pcm_bank_order_created_email_pending';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '事後閘①:改完找不到 pending view';
  END IF;

  -- 事後閘②:兩個 skip 碼都在(少一個 ⇒ 那一種跳過仍然永久擋住)
  IF pg_catalog.strpos(v_def, 'bank_order_not_mailable_at_send') = 0
     OR pg_catalog.strpos(v_def, 'bank_order_snapshot_stale') = 0 THEN
    RAISE EXCEPTION '事後閘②:兩個 skip 碼沒有同時出現在 anti-join 裡(實得 %)', v_def;
  END IF;

  -- 🔴 事後閘③:**anti-join 還在** —— 拿掉它 ⇒ 每輪重寄同一封
  IF pg_catalog.strpos(v_def, 'email_outbox') = 0 THEN
    RAISE EXCEPTION '事後閘③:anti-join 不見了 ⇒ 每一輪都會重寄同一封';
  END IF;

  -- 🔴 事後閘④:**COALESCE 還在** —— 少了它 NULL 那些列會變成不擋(方向相反)
  IF pg_catalog.strpos(v_def, 'COALESCE') = 0 AND pg_catalog.strpos(v_def, 'coalesce') = 0 THEN
    RAISE EXCEPTION '事後閘④:anti-join 裡沒有 COALESCE ⇒ last_error_code 為 NULL 的列會停止擋住';
  END IF;

  -- 🔴 事後閘⑤:**述詞沒有留下第二份**
  IF pg_catalog.strpos(v_def, 'bank_transfer') > 0
     OR pg_catalog.strpos(v_def, 'manual_request_id') > 0 THEN
    RAISE EXCEPTION '事後閘⑤:pending view 裡又看得到述詞原料 ⇒ 規則變成兩份了';
  END IF;

  -- 🔵 事後閘⑥:上面幾道要有判別力
  IF pg_catalog.strpos(v_def, 'zzz_never_a_feature') > 0 THEN
    RAISE EXCEPTION '事後閘⑥:現造字面命中 ⇒ 這把尺壞了';
  END IF;

  -- 事後閘⑦:欄名/欄序逐字不變(42P16)
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_bank_order_created_email_pending'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols <> 'order_id,display_id,created_at,total,balance_due,notification_email,customer_email,order_source' THEN
    RAISE EXCEPTION '事後閘⑦:欄位變成 [%] ⇒ adapter 會壞', v_cols;
  END IF;

  -- 🔵 收權斷言清單要真的被讀到
  FOREACH v_i IN ARRAY ARRAY[1] LOOP
    IF v_relations[v_i] IS NULL OR pg_catalog.to_regclass(v_relations[v_i]) IS NULL THEN
      RAISE EXCEPTION '事後閘⑧:收權斷言清單第 % 項不成立', v_i;
    END IF;
  END LOOP;
END
$postcheck$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════
-- 回退(可執行)
-- ══════════════════════════════════════════════════════════════════
-- 🔵 把 anti-join 換回**不看 `last_error_code`** 的那一版(逐字抄 `20260906180000` 的那一段),
--    其餘一個字不動。⚠️ 而退回去之後, 被跳過的那些單**又會變成永久排不進來**。
-- 🛑 **不要憑記憶重寫那段 SELECT。**
