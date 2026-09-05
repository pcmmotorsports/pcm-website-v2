-- sent-tracking-three-worlds.sql —— ⟦5b-SHIPPEDNUMNOTRECORDED1⟧ 片 A 的行為探針
--
-- 🔴 **它是唯一一個把那個 view 的 SQL 拿去【碰真資料】的東西。** 靜態守門(釘樁)只證字面在,
--    不證那個條件在真資料上篩對了 —— 那句話是 20260904220000:441 自己寫的。
--
-- 用法(拋棄式 PG, 見 docs/runbooks/throwaway-postgres-for-migration-verification.md):
--   psql -h /tmp -p <port> -U postgres -d postgres -v ON_ERROR_STOP=1 -f scripts/sent-tracking-three-worlds.sql
--
-- 🛑 **它答不出什麼**:①本機 PG ≠ Supabase(角色/RLS/授權那一層在這裡是假的)
--   ②它只驗 view 的篩選, **不驗 sweeper 有沒有真的寫那一欄**(那是片 B)
--   ③ROLLBACK 收尾 ⇒ 零留痕, 而**也代表它不驗任何跨交易的東西**。

BEGIN;

-- ══ 0. 前置閘:少了任何一格, 下面每一格都會【零列 = 全綠】═══════════════
DO $$
DECLARE v_def text; v_n int;
BEGIN
  IF pg_catalog.to_regclass('public.pcm_tracking_corrected_email_pending') IS NULL THEN
    RAISE EXCEPTION '前置閘①:view 不在 ⇒ 下面全部會是零列全綠';
  END IF;
  v_def := pg_catalog.pg_get_viewdef('public.pcm_tracking_corrected_email_pending'::regclass, true);
  IF pg_catalog.strpos(v_def, 'sent_tracking_number') = 0 THEN
    RAISE EXCEPTION '前置閘②:view 是第一代 ⇒ 20260905200000 沒貼, 本探針測的不是我以為的東西';
  END IF;
  SELECT pg_catalog.count(*) INTO v_n FROM public.orders;
  IF v_n <> 0 THEN RAISE EXCEPTION '前置閘③:orders 不是空的(% 列)⇒ 本探針只在乾淨庫跑', v_n; END IF;
END $$;

CREATE SCHEMA w3;

-- ══ 0-b. 共用資料 ═══════════════════════════════════════════════════════
-- 🔴 **不直接 INSERT customers** —— `auth.users` 上的 `handle_new_auth_user()` 會自己建那一列
--    (直接插會撞 PK)。⇒ 走真的那條路建人。
INSERT INTO auth.users(id, email)
VALUES ('11111111-1111-1111-1111-111111111111', 'real@example.com');
INSERT INTO public.staff(id, label) VALUES ('w3staff', '測試員');
INSERT INTO public.suppliers(id, label)
VALUES ('99999999-9999-9999-9999-999999999999', '測試供應商');
DO $w3$
DECLARE n int;
BEGIN
  SELECT pg_catalog.count(*) INTO n FROM public.customers;
  IF n <> 1 THEN RAISE EXCEPTION '前置④:期望 1 個客人, 實得 % ⇒ handle_new_auth_user 沒跑', n; END IF;
END $w3$;

-- ══ 1. fixture helper ═══════════════════════════════════════════════════
-- 🔴 刻意不 import `fx.*`(那支檔以 ROLLBACK 收尾, 它的 schema 不會留下)。
--    這裡只造本探針要的最小集, 而每一步都走真的守門(不用任何旁路旗標)。
CREATE FUNCTION w3.mk_order(p_label text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_proc uuid;
BEGIN
  INSERT INTO public.orders(
    display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
    payment_status, subtotal, shipping_fee, total, shipping_method, invoice,
    shipping_method_at_checkout, notification_email, paid_at)
  VALUES (p_label, '11111111-1111-1111-1111-111111111111',
    '{"name":"甲","phone":"0900000000","line":"台北"}'::jsonb, 'general',
    'paid'::payment_status, 1000, 0, 1000, 'home', '{"type":"personal"}'::jsonb,
    'home', 'a@example.com', pg_catalog.now() - interval '3 day')
  RETURNING id INTO v_id;
  INSERT INTO public.order_items(order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_id, 'SKU-'||p_label,
          pg_catalog.jsonb_build_object('title','測試品','sku','SKU-'||p_label,
                             'spec', pg_catalog.jsonb_build_object('尺寸','標準')), 1, 1000, 1000);
  INSERT INTO public.order_item_quantity_summary(order_item_id, quantity, ordered_quantity)
  SELECT id, 1, 1 FROM public.order_items WHERE order_id = v_id;
  INSERT INTO public.order_item_procurement(order_item_id, supplier_id, allocated_quantity)
  SELECT id, '99999999-9999-9999-9999-999999999999', 1
    FROM public.order_items WHERE order_id = v_id RETURNING id INTO v_proc;
  INSERT INTO public.order_item_procurement_receipts(procurement_id, quantity, received_at, received_by)
  VALUES (v_proc, 1, pg_catalog.now() - interval '2 day', 'w3staff');
  RETURN v_id;
END $$;

-- 🔴 順序承重:先建【未出貨】的箱 → 掛品項 → 才 UPDATE 成已出貨
--    (`shipment_items_parent_guard_ac` 擋「已寄出不可再加品項」)。
CREATE FUNCTION w3.mk_shipment(p_order uuid, p_ref text, p_tracking text, p_corrected timestamptz)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_cust uuid;
BEGIN
  SELECT customer_user_id INTO v_cust FROM public.orders WHERE id = p_order;
  INSERT INTO public.shipments(shipment_reference, customer_user_id, recipient_snapshot, carrier_code)
  VALUES (p_ref, v_cust, '{"name":"甲","phone":"0900000000","line":"台北"}'::jsonb, 'hct')
  RETURNING id INTO v_id;
  INSERT INTO public.shipment_items(shipment_id, order_item_id, shipped_quantity)
  SELECT v_id, id, 1 FROM public.order_items WHERE order_id = p_order LIMIT 1;
  UPDATE public.shipments
     SET shipped_at = pg_catalog.now() - interval '2 day',
         tracking_number = p_tracking,
         tracking_corrected_at = p_corrected
   WHERE id = v_id;
  RETURN v_id;
END $$;

-- 🔴 **一箱裝兩張訂單的品項** —— 而它必須在【標成已出貨之前】把兩邊都放進去。
--    直接對已出貨的箱 INSERT 會撞到真的業務規則:
--    逐字「包裹已寄出或已作廢,不可再加品項」(2026-09-05 實測撞到)。
--    ⇒ 📌 **那道 trigger 是對的** —— 造 fixture 要走真流程, 不是繞過它。
CREATE FUNCTION w3.mk_shipment2(p_order1 uuid, p_order2 uuid, p_ref text,
                                p_tracking text, p_corrected timestamptz)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_cust uuid;
BEGIN
  SELECT customer_user_id INTO v_cust FROM public.orders WHERE id = p_order1;
  INSERT INTO public.shipments(shipment_reference, customer_user_id, recipient_snapshot, carrier_code)
  VALUES (p_ref, v_cust, '{"name":"甲","phone":"0900000000","line":"台北"}'::jsonb, 'hct')
  RETURNING id INTO v_id;
  INSERT INTO public.shipment_items(shipment_id, order_item_id, shipped_quantity)
  SELECT v_id, id, 1 FROM public.order_items WHERE order_id = p_order1 LIMIT 1;
  INSERT INTO public.shipment_items(shipment_id, order_item_id, shipped_quantity)
  SELECT v_id, id, 1 FROM public.order_items WHERE order_id = p_order2 LIMIT 1;
  UPDATE public.shipments
     SET shipped_at = pg_catalog.now() - interval '2 day',
         tracking_number = p_tracking,
         tracking_corrected_at = p_corrected
   WHERE id = v_id;
  RETURN v_id;
END $$;

-- 一封【已寄出】的信。`p_num` = 出門紀錄(NULL 代表片 B 上線前的舊列)。
-- 🔵 `p_seq` 不給就自動取號 —— **片 B 寫的列一定有序號**;
--    要造「片 B 之前的舊列」就顯式傳 NULL(世界⑦ 用它)。
-- 🔴 `p_ship_raw` 讓呼叫端塞【壞掉的 shipment_id】(世界⑧ 用它)——
--    預設為 NULL 時取 `p_ship::text`, 也就是正常的那一種。
CREATE FUNCTION w3.mk_sent(p_order uuid, p_ship uuid, p_event text, p_dedup text,
                           p_sent timestamptz, p_num text,
-- 🔴🔴 **`p_seq` 的預設值是 `-1` 不是 `NULL` —— 而這一格是 fixture 當場抓到的。**
--    ⛔ ~~第一版 `p_seq bigint DEFAULT NULL` + `coalesce(p_seq, nextval())`~~
--    🛑 那讓【顯式傳 NULL】與【沒傳】變成同一件事 ⇒ **我造不出「片 B 之前的舊列」**,
--      而世界⑥(本來該落回落分支)靜靜跑進逐字比對 ⇒ 集合多了一個 WRD777。
--    ⇒ 📌 **一個「沒給就自動」的預設值, 讓「我就是要給空的」這個意思消失了。**
--    ✅ `-1` = 沒給(自動取號);`NULL` = **就是要空的**(片 B 之前的舊列)。
                           p_seq bigint DEFAULT -1, p_ship_raw text DEFAULT NULL,
                           p_id uuid DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.email_outbox(id, event_type, order_id, dedup_key, recipient_email,
                                  subject, payload, status, sent_at, sent_tracking_number, sent_seq)
  VALUES (coalesce(p_id, pg_catalog.gen_random_uuid()),
          p_event, p_order, p_dedup, 'a@example.com', '測試',
          pg_catalog.jsonb_build_object('shipment_id',
            coalesce(p_ship_raw, p_ship::text)),
          'sent', p_sent, p_num,
          CASE WHEN p_seq = -1 THEN pg_catalog.nextval('public.pcm_email_outbox_sent_seq')
               ELSE p_seq END);
$$;

-- ══ 2. 六個世界 ═════════════════════════════════════════════════════════
DO $$
DECLARE o uuid; o2 uuid; s uuid; t0 timestamptz := pg_catalog.now() - interval '2 day';
BEGIN
  -- ① 寄 A、改成 B ⇒ 最後告訴他的是 A, 現在是 B ⇒ 【該寄】
  o := w3.mk_order('WRD222'); s := w3.mk_shipment(o, 'SHP222', 'B', t0 + interval '1 hour');
  PERFORM w3.mk_sent(o, s, 'order_shipped', public.pcm_shipped_email_dedup_key(s, o), t0, 'A');

  -- ② 寄 A、改 B、更正信說 B、【又改回 A】⇒ 最後告訴他的是 B, 現在是 A ⇒ 【該寄】
  --    🔴 這一格就是板列給的修法【漏掉】的那個世界。
  o := w3.mk_order('WRD333'); s := w3.mk_shipment(o, 'SHP333', 'A', t0 + interval '3 hour');
  PERFORM w3.mk_sent(o, s, 'order_shipped', public.pcm_shipped_email_dedup_key(s, o), t0, 'A');
  PERFORM w3.mk_sent(o, s, 'shipment_tracking_corrected',
                     public.pcm_tracking_corrected_dedup_key(s, o, t0 + interval '1 hour'),
                     t0 + interval '2 hour', 'B');

  -- ③ 改過, 而最後告訴他的就是現在這個 ⇒ 【不該寄】(新判準的負對照)
  o := w3.mk_order('WRD444'); s := w3.mk_shipment(o, 'SHP444', 'B', t0 + interval '1 hour');
  PERFORM w3.mk_sent(o, s, 'order_shipped', public.pcm_shipped_email_dedup_key(s, o), t0, 'B');

  -- ④ 從沒改過(corrected_at IS NULL)⇒ 【不該寄】(釘樁①那條述詞的負對照)
  o := w3.mk_order('WRD555'); s := w3.mk_shipment(o, 'SHP555', 'A', NULL);
  PERFORM w3.mk_sent(o, s, 'order_shipped', public.pcm_shipped_email_dedup_key(s, o), t0, 'A');

  -- ⑤ 過渡期(出門紀錄 NULL)· 寄在更正【之前】⇒ 回落到時間比較 ⇒ 【該寄】
  o := w3.mk_order('WRD666'); s := w3.mk_shipment(o, 'SHP666', 'B', t0 + interval '1 hour');
  -- 🔴 第 7 個參數【顯式 NULL】= 片 B 之前的舊列(沒有序號)。少了它就不是過渡期。
  PERFORM w3.mk_sent(o, s, 'order_shipped', public.pcm_shipped_email_dedup_key(s, o), t0, NULL, NULL);

  -- ⑥ 過渡期 · 寄在更正【之後】⇒ 回落 ⇒ 【不該寄】
  --    🛑 這一格【就是本片要修的那個 bug】, 而過渡期刻意保留它 —— 行為與今天完全相同。
  o := w3.mk_order('WRD777'); s := w3.mk_shipment(o, 'SHP777', 'B', t0 + interval '1 hour');
  PERFORM w3.mk_sent(o, s, 'order_shipped', public.pcm_shipped_email_dedup_key(s, o),
                     t0 + interval '2 hour', NULL, NULL);

  -- ══ 🔴 以下四個世界是【為了讓四格突變有東西可以打】而加的(codex R2 第 15 條)══
  --    上面六個世界證的是「判準會不會抓到號碼不一致」;
  --    而承重點有四個, 而它們**在上面六個世界裡全部不動作** ——
  --    📌 **一個突變若沒有一個世界會因它而改變答案, 那個突變證不到任何事。**

  -- ⑦ **承重點:order 關聯**。一箱兩單, 而兩單被告知的號碼不同。
  --    O1 最後收到 B(= 現在的號碼)⇒ 不該寄;O2 最後收到 A ⇒ 該寄。
  --    ⇒ 拿掉 `last.order_id = o.id` ⇒ 兩單共用「最後一封」⇒ 兩邊都判錯。
  o  := w3.mk_order('WRD888');
  o2 := w3.mk_order('WRD999');
  s  := w3.mk_shipment2(o, o2, 'SHP888', 'B', t0 + interval '1 hour');
  PERFORM w3.mk_sent(o,  s, 'order_shipped', public.pcm_shipped_email_dedup_key(s, o),  t0, 'B');
  PERFORM w3.mk_sent(o2, s, 'order_shipped', public.pcm_shipped_email_dedup_key(s, o2), t0, 'A');

  -- ⑧ **承重點:UUID 格式守門**。payload 的 shipment_id 是 'bad'。
  --    ⇒ 拿掉 `pcm_is_uuid_text` ⇒ `::uuid` 會 raise ⇒ **整張 view 炸掉**(不是少一列)。
  o := w3.mk_order('WRDB22'); s := w3.mk_shipment(o, 'SHPB22', 'B', t0 + interval '1 hour');
  PERFORM w3.mk_sent(o, s, 'order_shipped', public.pcm_shipped_email_dedup_key(s, o),
                     t0, 'A', NULL, 'bad');

  -- ⑨ **承重點:ORDER BY sent_seq**。同一毫秒兩封, 而 seq 決得出先後。
  --    先寄 A(seq 小)、後寄更正說 B(seq 大);現在是 B ⇒ 最後告知 = B ⇒ 不該寄。
  --    ⇒ 排序改用 `sent_at` 以外的任何非單調鍵 ⇒ 可能挑到 A ⇒ 誤寄。
  -- 🔴 兩顆 id 【寫死】—— 讓「用 id 決勝」那個突變【確定】選錯, 不靠運氣。
  --    說 A 的排最前(ffff…)、說 B 的排最後(0000…)⇒ `id DESC` 必挑到 A。
  o := w3.mk_order('WRDC33'); s := w3.mk_shipment(o, 'SHPC33', 'B', t0 + interval '1 hour');
  PERFORM w3.mk_sent(o, s, 'order_shipped', public.pcm_shipped_email_dedup_key(s, o),
                     t0 + interval '5 hour', 'A', 900001, NULL,
                     'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid);
  PERFORM w3.mk_sent(o, s, 'shipment_tracking_corrected',
                     public.pcm_tracking_corrected_dedup_key(s, o, t0 + interval '9 hour'),
                     t0 + interval '5 hour', 'B', 900002, NULL,
                     '00000000-0000-4000-8000-000000000000'::uuid);

  -- ⑩ **承重點:用 sent_seq 分辨兩種 NULL**(主視窗裁定③)。
  --    片 B 寫的列(有 seq)而【那封信本來就沒帶號碼】⇒ 我們沒告訴過他任何號碼
  --    ⇒ 現在有號碼 B ⇒ **該寄(而它是首次告知)**。
  --    ⇒ 判斷式改回問 `sent_tracking_number` ⇒ 這一列被當成「片 B 之前的舊列」
  --      ⇒ 落到時間比較 ⇒ 寄在更正之後 ⇒ **不寄** ⇒ 裁定③ 靜靜失效。
  o := w3.mk_order('WRDD44'); s := w3.mk_shipment(o, 'SHPD44', 'B', t0 + interval '1 hour');
  PERFORM w3.mk_sent(o, s, 'order_shipped', public.pcm_shipped_email_dedup_key(s, o),
                     t0 + interval '2 hour', NULL, 900003);
END $$;

-- ══ 3. 集合比對(雙向:該進的都在 + 不該進的都不在)══════════════════════
CREATE FUNCTION w3.assert_set(p_expect text[], p_why text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_got text[]; v_missing text[]; v_extra text[];
BEGIN
  SELECT coalesce(pg_catalog.array_agg(display_id ORDER BY display_id), '{}')
    INTO v_got FROM public.pcm_tracking_corrected_email_pending;
  SELECT coalesce(pg_catalog.array_agg(x), '{}') INTO v_missing
    FROM pg_catalog.unnest(p_expect) x WHERE NOT (x = ANY(v_got));
  SELECT coalesce(pg_catalog.array_agg(x), '{}') INTO v_extra
    FROM pg_catalog.unnest(v_got) x WHERE NOT (x = ANY(p_expect));
  IF pg_catalog.array_length(v_missing,1) IS NOT NULL OR pg_catalog.array_length(v_extra,1) IS NOT NULL THEN
    RAISE EXCEPTION '% —— 期望 % / 實得 % / 少了 % / 多了 %',
      p_why, p_expect, v_got, v_missing, v_extra;
  END IF;
  RAISE NOTICE '✅ % —— 集合相符 %', p_why, v_got;
END $$;

-- 🔴 **預測寫在跑之前, 不是抄觀察值**(否則這一格從出生起就不可能抓到缺陷):
--   WRD888 一箱兩單之一, 最後告知 B = 現在 B ⇒ 不在
--   WRD999 同箱另一單, 最後告知 A         ⇒ 在
--   WRDB22 髒 payload ⇒ 略過 ⇒ 回落 ⇒ 寄在更正前 ⇒ 在
--   WRDC33 同毫秒兩封, seq 決出最後是 B    ⇒ 不在
--   WRDD44 片 B 寫的而沒帶號碼(裁定③)    ⇒ 在(首次告知)
SELECT w3.assert_set(
  ARRAY['WRD222','WRD333','WRD666','WRD999','WRDB22','WRDD44'], '第二代判準');

-- ══ 4. 🔴 突變:把判準換回【板列給的那句】⇒ ② 必須消失 ════════════════════
--    板列逐字:「判準改成逐字比對(寄出去的號碼 <> 現在的號碼)」——
--    也就是只比【出貨信】那一封, 不看後來的更正信。
CREATE OR REPLACE VIEW public.pcm_tracking_corrected_email_pending
  WITH (security_invoker = true) AS
SELECT DISTINCT
  s.id AS shipment_id, s.shipment_reference, s.tracking_number, s.carrier_code,
  s.tracking_corrected_at,
  public.pcm_tracking_corrected_at_key(s.tracking_corrected_at) AS corrected_at_key,
  o.id AS order_id, o.display_id, o.notification_email, c.email AS customer_email
FROM public.shipments s
JOIN public.shipment_items si ON si.shipment_id = s.id
JOIN public.order_items   oi ON oi.id = si.order_item_id
JOIN public.orders         o ON o.id = oi.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE s.shipped_at IS NOT NULL
  AND s.deleted_at IS NULL
  AND s.tracking_corrected_at IS NOT NULL
  AND nullif(pg_catalog.btrim(s.tracking_number, public.pcm_js_trim_whitespace()), '') IS NOT NULL
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  AND CASE
        WHEN (SELECT e.sent_tracking_number FROM public.email_outbox e
               WHERE e.event_type = 'order_shipped'
                 AND e.dedup_key  = public.pcm_shipped_email_dedup_key(s.id, o.id)
                 AND e.status = 'sent' LIMIT 1) IS NOT NULL
        THEN (SELECT e.sent_tracking_number FROM public.email_outbox e
               WHERE e.event_type = 'order_shipped'
                 AND e.dedup_key  = public.pcm_shipped_email_dedup_key(s.id, o.id)
                 AND e.status = 'sent' LIMIT 1)
             IS DISTINCT FROM nullif(pg_catalog.btrim(s.tracking_number, public.pcm_js_trim_whitespace()), '')
        ELSE EXISTS (
          SELECT 1 FROM public.email_outbox e0
           WHERE e0.event_type = 'order_shipped'
             AND e0.dedup_key  = public.pcm_shipped_email_dedup_key(s.id, o.id)
             AND e0.status = 'sent' AND e0.sent_at IS NOT NULL
             AND e0.sent_at < s.tracking_corrected_at)
      END
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.event_type = 'shipment_tracking_corrected'
           AND e.dedup_key  = public.pcm_tracking_corrected_dedup_key(s.id, o.id, s.tracking_corrected_at));

-- 🔴 突變後的期望:② 出局(它是新判準【獨有】的收穫), ①③④⑤⑥ 不變。
-- 🔴 **逐格對機制推一遍, 不是抄觀察值**(抄觀察值 = 讓實作自己出考題):
--   這個突變只比【出貨信那一封】的號碼, 而保留原本的時間閘。
--   WRD222 出貨信說 A · 現在 B ⇒ 不同 ⇒ 在
--   WRD333 出貨信說 A · 現在 A ⇒ 相同 ⇒ **出局** ← 這就是本突變要證的那一格
--   WRD666 出貨信沒帶號碼 · 現在 B ⇒ IS DISTINCT ⇒ 在(且寄在更正之前, 過時間閘)
--   WRD777 同上而寄在更正【之後】⇒ 時間閘擋掉 ⇒ 不在
--   WRD999 一箱兩單的另一單, 出貨信說 A · 現在 B ⇒ 在
--   WRDB22 髒 payload —— 🔵 **這個突變不看 payload(它走 dedup_key)** ⇒ 照樣在
--   WRDC33 同毫秒兩封:出貨信說 A · 現在 B ⇒ 在
--          🔴🔴 **而第二代判準說【不在】**(最後告知是更正信的 B)⇒ **這一格就是「排序」那個承重點的證人**
--   WRDD44 沒帶號碼而寄在更正之後 ⇒ 時間閘擋掉 ⇒ 不在
SELECT w3.assert_set(ARRAY['WRD222','WRD666','WRD999','WRDB22','WRDC33'],
  '突變(板列那句:只比出貨信那一封)⇒ WRD333(世界②)必須消失, 而 WRDC33 必須【多出來】');

-- 🟢 而「W2 消失」要是【判準造成的】不是「它整列不見了」——
--    負對照:WRD333(世界②)的箱還在, 只是被那個判準篩掉。
DO $$
DECLARE v int;
BEGIN
  SELECT pg_catalog.count(*) INTO v FROM public.shipments WHERE shipment_reference = 'SHP333'
    AND tracking_corrected_at IS NOT NULL AND shipped_at IS NOT NULL;
  IF v <> 1 THEN RAISE EXCEPTION '突變負對照:WRD333(世界②)的箱不見了(%)⇒ 上面那個「消失」不是判準造成的', v; END IF;
  RAISE NOTICE '✅ 突變負對照 —— WRD333(世界②)的箱還在, 它是被判準篩掉的';
END $$;

ROLLBACK;
