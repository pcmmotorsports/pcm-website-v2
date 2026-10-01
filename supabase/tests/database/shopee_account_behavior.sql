-- 蝦皮帳號(20261001160000, 貼板 261)行為測試。
-- 用法:拋棄式 PG(套完全部 migration, 例如 scripts/admin-probe/up.sh 起的那一台)上跑本檔;
--   全過印「✅ 蝦皮帳號行為測試全部通過」, 任一格不對會 RAISE「❌ …」停下。整支包在一個交易裡、最後 ROLLBACK, 不留資料。
--   負對照:把 migration 裡「客人身上還沒有這個帳號 ⇒ 補記」那段拿掉再跑, 第一個紅的是「第一次帶帳號 ⇒ 回傳已新增」(2026-10-01 實測)。
-- 絕不在正式庫跑。
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
BEGIN;
CREATE FUNCTION pg_temp.eq(label text, got text, want text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION '❌ % 得到 % 期望 %', label, got, want; END IF;
  RETURN '✓ ' || label || ' = ' || coalesce(got, 'NULL');
END $$;
CREATE FUNCTION pg_temp.try(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE q;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

INSERT INTO public.staff(id, label, is_manager, is_active) VALUES ('t_clerk', '店員', false, true) ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users(id, email) VALUES
  ('c0000000-0000-4000-8000-0000000005a1', 's1@x.tw'),
  ('c0000000-0000-4000-8000-0000000005a2', 's2@x.tw');
INSERT INTO public.customers(user_id, email, name, tier) VALUES
  ('c0000000-0000-4000-8000-0000000005a1', 's1@x.tw', '蝦皮一號', 'general'),
  ('c0000000-0000-4000-8000-0000000005a2', 's2@x.tw', '蝦皮二號', 'general')
ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name;  -- auth.users 的 trigger 可能已先建好客人列

-- 建單:來源、蝦皮帳號、蝦皮訂單編號可指定;回整包 jsonb。
CREATE FUNCTION pg_temp.mk(cust text, rq text, src text, acct text, ono text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.admin_create_manual_order(cust::uuid, rq::uuid, 't_clerk', src, 'bank_transfer', 'home',
    '{"name":"王小明","phone":"0912000111","line":"台北市測試路1號"}'::jsonb, '{"type":"personal","requested":false}'::jsonb, 100,
    '[{"sku":"T1","title":"測試品","qty":1,"unit_price":100,"spec":{}}]'::jsonb,
    p_shopee_username => acct, p_shopee_order_no => ono) $$;
CREATE FUNCTION pg_temp.accts(cust text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(account, ',' ORDER BY account), '')
    FROM public.customer_shopee_accounts WHERE customer_user_id = cust::uuid $$;

-- ① 建蝦皮單帶帳號:訂單記快照、帳號記到客人身上、回傳 shopee_account_added。
CREATE TEMP TABLE r1 AS SELECT pg_temp.mk('c0000000-0000-4000-8000-0000000005a1', 'a0000000-0000-4000-8000-0000000005b1', 'manual_shopee', ' Moto_Wang ', '240901ABCD') AS j;
SELECT pg_temp.eq('第一次帶帳號 ⇒ 回傳已新增', (SELECT j ->> 'shopee_account_added' FROM r1), 'true');
SELECT pg_temp.eq('建單後帳號記到客人身上(去頭尾空白)', pg_temp.accts('c0000000-0000-4000-8000-0000000005a1'), 'Moto_Wang');
SELECT pg_temp.eq('訂單記下當時的帳號與訂單編號',
  (SELECT shopee_username || '|' || shopee_order_no FROM public.orders WHERE id = (SELECT (j ->> 'order_id')::uuid FROM r1)), 'Moto_Wang|240901ABCD');
SELECT pg_temp.eq('操作紀錄有帳號與已新增',
  (SELECT (after ->> 'shopee_username') || '|' || (after ->> 'shopee_account_added') FROM public.admin_audit_log
    WHERE action = 'order.manual_create' AND target = 'order:' || (SELECT j ->> 'order_id' FROM r1)), 'Moto_Wang|true');

-- ② 同一張單原樣重送 ⇒ idempotent, 不重記帳號。
SELECT pg_temp.eq('原樣重送 ⇒ idempotent',
  pg_temp.mk('c0000000-0000-4000-8000-0000000005a1', 'a0000000-0000-4000-8000-0000000005b1', 'manual_shopee', ' Moto_Wang ', '240901ABCD') ->> 'idempotent', 'true');
SELECT pg_temp.eq('重送後客人仍只有一個帳號', pg_temp.accts('c0000000-0000-4000-8000-0000000005a1'), 'Moto_Wang');

-- ③ 同一位客人再用大小寫不同的同一帳號下單 ⇒ 視為同一個, 不新增;換新帳號 ⇒ 加上去(多帳號)。
SELECT pg_temp.eq('大小寫不同視為同一帳號 ⇒ 不新增',
  pg_temp.mk('c0000000-0000-4000-8000-0000000005a1', 'a0000000-0000-4000-8000-0000000005b2', 'manual_shopee', 'moto_wang', NULL) ->> 'shopee_account_added', 'false');
SELECT pg_temp.eq('新帳號 ⇒ 加上去',
  pg_temp.mk('c0000000-0000-4000-8000-0000000005a1', 'a0000000-0000-4000-8000-0000000005b3', 'manual_shopee', 'wang_mom', NULL) ->> 'shopee_account_added', 'true');
SELECT pg_temp.eq('客人有兩個帳號', pg_temp.accts('c0000000-0000-4000-8000-0000000005a1'), 'Moto_Wang,wang_mom');

-- ④ 帳號已記在另一位客人身上 ⇒ P2S01 擋, 整張單不建。
SELECT pg_temp.eq('別人的帳號 ⇒ P2S01',
  left(pg_temp.try($q$SELECT pg_temp.mk('c0000000-0000-4000-8000-0000000005a2', 'a0000000-0000-4000-8000-0000000005b4', 'manual_shopee', 'MOTO_WANG', NULL)$q$), 5), 'P2S01');
SELECT pg_temp.eq('被擋的客人沒有單', (SELECT count(*)::text FROM public.orders WHERE customer_user_id = 'c0000000-0000-4000-8000-0000000005a2'), '0');

-- ⑤ 非蝦皮單填蝦皮欄位 ⇒ P2S02;格式不對 ⇒ P2S03;沒填 ⇒ 照常建單、不記帳號。
SELECT pg_temp.eq('電話單填蝦皮帳號 ⇒ P2S02',
  left(pg_temp.try($q$SELECT pg_temp.mk('c0000000-0000-4000-8000-0000000005a2', 'a0000000-0000-4000-8000-0000000005b5', 'manual_phone', 'someone', NULL)$q$), 5), 'P2S02');
SELECT pg_temp.eq('電話單填蝦皮訂單編號 ⇒ P2S02',
  left(pg_temp.try($q$SELECT pg_temp.mk('c0000000-0000-4000-8000-0000000005a2', 'a0000000-0000-4000-8000-0000000005b5', 'manual_phone', NULL, 'X1')$q$), 5), 'P2S02');
SELECT pg_temp.eq('帳號中間有空白 ⇒ P2S03',
  left(pg_temp.try($q$SELECT pg_temp.mk('c0000000-0000-4000-8000-0000000005a2', 'a0000000-0000-4000-8000-0000000005b5', 'manual_shopee', 'a b', NULL)$q$), 5), 'P2S03');
SELECT pg_temp.eq('訂單編號有中文 ⇒ P2S03',
  left(pg_temp.try($q$SELECT pg_temp.mk('c0000000-0000-4000-8000-0000000005a2', 'a0000000-0000-4000-8000-0000000005b5', 'manual_shopee', NULL, '訂單1')$q$), 5), 'P2S03');
CREATE TEMP TABLE r6 AS SELECT pg_temp.mk('c0000000-0000-4000-8000-0000000005a2', 'a0000000-0000-4000-8000-0000000005b6', 'manual_shopee', '  ', NULL) AS j;
SELECT pg_temp.eq('蝦皮單不填帳號 ⇒ 回傳仍是原本三個鍵(舊後台照常)',
  (SELECT string_agg(k, ',' ORDER BY k) FROM r6, jsonb_object_keys(j) k), 'display_id,idempotent,order_id');
SELECT pg_temp.eq('沒填 ⇒ 客人沒有帳號', pg_temp.accts('c0000000-0000-4000-8000-0000000005a2'), '');

-- ⑥ 表與欄位的直接約束。
SELECT pg_temp.eq('表上大小寫重複被擋',
  left(pg_temp.try($q$INSERT INTO public.customer_shopee_accounts (customer_user_id, account, created_by) VALUES ('c0000000-0000-4000-8000-0000000005a2', 'WANG_MOM', 't')$q$), 5), '23505');
SELECT pg_temp.eq('網站單直接寫蝦皮欄位被擋',
  left(pg_temp.try($q$UPDATE public.orders SET order_source = 'manual_phone' WHERE id = (SELECT (j ->> 'order_id')::uuid FROM r1)$q$), 5), '23514');
SELECT pg_temp.eq('anon 讀不到帳號表', has_table_privilege('anon', 'public.customer_shopee_accounts', 'SELECT')::text, 'false');

SELECT '✅ 蝦皮帳號行為測試全部通過';
ROLLBACK;
