-- 後台刪除會員與停用會員(20260926100000–100200)行為測試。
-- 用法:拋棄式 PG(public 結構 = 正式庫唯讀 pg_dump;auth.users / identities / sessions / refresh_tokens 用替身,
--   外鍵照正式庫 2026-09-26 查證:identities、sessions → users CASCADE,refresh_tokens → sessions CASCADE)
--   依序套 20260926100000、100100、100200 之後跑本檔;全過印「✅ 刪除停用會員行為測試全部通過」,任一格不對會 RAISE「❌ …」停下。
--   並行的格子用 dblink 開另外兩個連線(連線字串用 \set conn 傳入,例:psql -v conn='dbname=t1 host=/tmp port=54391 user=postgres')。
--   負對照:在只套 20260926100000、沒套 100100 的庫上跑,「有儲值金流水時直接刪登入帳號被外鍵擋下」那一格會紅。
--   🔴 並行②③(修改申請 vs 核准)只證明兩個先後順序都不會被資料庫中止, **分辨不出鎖的順序**:
--      把核准換回「先鎖申請列、再鎖會員列」的舊順序再跑, 這兩格照樣過(2026-09-26 實測)——
--      死結要在核准的兩次上鎖之間插進另一筆交易, 而函式內部沒有停頓點可以製造那個交錯。
--      鎖的順序由 scripts/customer-disable-delete-migration.test.ts 檢查函式內語句的先後。
-- 絕不在正式庫跑(會建會員、訂單並提交)。
-- 🔵 刻意不叫 *.test.sql:同資料夾那幾支是 pgTAP,本檔是 psql 腳本。

\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
CREATE EXTENSION IF NOT EXISTS dblink;

CREATE FUNCTION pg_temp.eq(label text, got text, want text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN RAISE EXCEPTION '❌ % 得到 % 期望 %', label, got, want; END IF;
  RETURN '✓ ' || label || ' = ' || coalesce(got, 'NULL');
END $$;
CREATE FUNCTION pg_temp.eq(label text, got boolean, want text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.eq(label, got::text, want) $$;
-- 執行一段 SQL:成功回 'OK',失敗回錯誤訊息(子交易回滾 ⇒ 失敗時不留任何列)
CREATE FUNCTION pg_temp.try(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE q;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;
CREATE FUNCTION pg_temp.as_user(u text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false) $$;
CREATE FUNCTION pg_temp.n(t text, col text, u text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  EXECUTE format('SELECT count(*) FROM %s WHERE %I::text = $1', t, col) INTO v USING u;
  RETURN v::text;
END $$;

-- ── 虛構資料(提交,並行格的其他連線才看得到)──
INSERT INTO public.staff(id, label, is_manager, is_active) VALUES
  ('t_boss', '老闆', true, true), ('t_clerk', '店員', false, true), ('t_exboss', '離職老闆', true, false)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users(id, email) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'c1@x.tw'),  -- C1 乾淨, 可刪
  ('c0000000-0000-4000-8000-000000000002', 'c2@x.tw'),  -- C2 有儲值金流水
  ('c0000000-0000-4000-8000-000000000003', 'c3@x.tw'),  -- C3 經銷等級
  ('c0000000-0000-4000-8000-000000000004', 'c4@x.tw'),  -- C4 有經銷申請(審核中)
  ('c0000000-0000-4000-8000-000000000005', 'c5@x.tw'),  -- C5 停用 / 恢復
  ('c0000000-0000-4000-8000-000000000006', 'c6@x.tw'),  -- C6 並行:刪除 vs 儲值金
  ('c0000000-0000-4000-8000-000000000007', 'c7@x.tw'),  -- C7 並行:停用 vs 經銷申請
  ('c0000000-0000-4000-8000-000000000008', 'c8@x.tw'),  -- C8 並行:修改申請 vs 核准
  ('c0000000-0000-4000-8000-000000000009', 'c9@x.tw');  -- C9 手動建單 + 有訂單不能刪
INSERT INTO public.customers(user_id, email, name, tier) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'c1@x.tw', '測試一號', 'general'),
  ('c0000000-0000-4000-8000-000000000002', 'c2@x.tw', '測試二號', 'general'),
  ('c0000000-0000-4000-8000-000000000003', 'c3@x.tw', '測試三號', 'store'),
  ('c0000000-0000-4000-8000-000000000004', 'c4@x.tw', '測試四號', 'general'),
  ('c0000000-0000-4000-8000-000000000005', 'c5@x.tw', '停用測試', 'general'),
  ('c0000000-0000-4000-8000-000000000006', 'c6@x.tw', '測試六號', 'general'),
  ('c0000000-0000-4000-8000-000000000007', 'c7@x.tw', '測試七號', 'general'),
  ('c0000000-0000-4000-8000-000000000008', 'c8@x.tw', '測試八號', 'general'),
  ('c0000000-0000-4000-8000-000000000009', 'c9@x.tw', '測試九號', 'general');
INSERT INTO auth.identities(user_id, provider) VALUES ('c0000000-0000-4000-8000-000000000001', 'email');
INSERT INTO auth.sessions(id, user_id) VALUES
  ('50000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
  ('50000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000005'),
  ('50000000-0000-4000-8000-000000000055', 'c0000000-0000-4000-8000-000000000005');
INSERT INTO auth.refresh_tokens(token, user_id, session_id) VALUES
  ('r1', 'c0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001'),
  ('r5', 'c0000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000005'),
  ('r55', 'c0000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000055');
INSERT INTO public.customer_addresses(customer_user_id, name, line, phone) VALUES
  ('c0000000-0000-4000-8000-000000000001', '一號', '台北市', '0912345678');
INSERT INTO public.customer_wallet_ledger(customer_user_id, entry_type, amount) VALUES
  ('c0000000-0000-4000-8000-000000000002', 'deposit', 100);
SELECT pg_temp.as_user('c0000000-0000-4000-8000-000000000004');
SET ROLE authenticated;
SELECT public.dealer_application_submit('四號車業', '12345678', '', '臺北市', '四號', '0912345678', 'c4@x.tw', '') IS NOT NULL;
SELECT pg_temp.as_user('c0000000-0000-4000-8000-000000000008');
SELECT public.dealer_application_submit('八號車業', '12345678', '', '臺北市', '八號', '0912345678', 'c8@x.tw', '') IS NOT NULL;
RESET ROLE;

-- ── ① 可否刪除 ──
SELECT pg_temp.eq('C1 乾淨 ⇒ 可以刪', public.admin_customer_delete_eligibility('c0000000-0000-4000-8000-000000000001')::text,
  '{"found": true, "reasons": [], "deletable": true}');
SELECT pg_temp.eq('C2 有儲值金流水', public.admin_customer_delete_eligibility('c0000000-0000-4000-8000-000000000002') ->> 'reasons', '["wallet_ledger", "wallet_balance"]');  -- 寫流水時觸發器同步更新餘額
SELECT pg_temp.eq('C3 經銷等級', public.admin_customer_delete_eligibility('c0000000-0000-4000-8000-000000000003') ->> 'reasons', '["dealer_tier"]');
SELECT pg_temp.eq('C4 有經銷申請', public.admin_customer_delete_eligibility('c0000000-0000-4000-8000-000000000004') ->> 'reasons', '["dealer_applications"]');
SELECT pg_temp.eq('查無此會員', public.admin_customer_delete_eligibility('c0000000-0000-4000-8000-0000000000ff') ->> 'found', 'false');

-- ── ② 只有在職老闆 ──
SELECT pg_temp.eq('店員停用 ⇒ 擋下', pg_temp.try($q$SELECT public.admin_disable_customer('t_clerk', 'c0000000-0000-4000-8000-000000000005', 0, '測試', 'rq-x1')$q$) LIKE '%無權執行此操作%', 'true');
SELECT pg_temp.eq('離職老闆刪除 ⇒ 擋下', pg_temp.try($q$SELECT public.admin_delete_customer('t_exboss', 'c0000000-0000-4000-8000-000000000001', '測試', 'rq-x2')$q$) LIKE '%無權執行此操作%', 'true');
SELECT pg_temp.eq('原因空白 ⇒ 擋下', pg_temp.try($q$SELECT public.admin_disable_customer('t_boss', 'c0000000-0000-4000-8000-000000000005', 0, E' 　', 'rq-x3')$q$) LIKE '%原因必填%', 'true');
SELECT pg_temp.eq('被擋下的都沒有寫稽核', (SELECT count(*) FROM public.admin_audit_log WHERE request_id LIKE 'rq-x%')::text, '0');

-- ── ③ 停用 ──
SELECT pg_temp.eq('停用 C5', public.admin_disable_customer('t_boss', 'c0000000-0000-4000-8000-000000000005', 0, '客人要求', 'rq-d1'), 'OK');
SELECT pg_temp.eq('C5 已停用、版本 1、停用者 t_boss',
  (SELECT (disabled_at IS NOT NULL)::text || '/' || disabled_version || '/' || disabled_by || '/' || disabled_reason FROM public.customers WHERE user_id = 'c0000000-0000-4000-8000-000000000005'),
  'true/1/t_boss/客人要求');
SELECT pg_temp.eq('C5 登入工作階段清空', pg_temp.n('auth.sessions', 'user_id', 'c0000000-0000-4000-8000-000000000005'), '0');
SELECT pg_temp.eq('C5 刷新權杖清空', pg_temp.n('auth.refresh_tokens', 'user_id', 'c0000000-0000-4000-8000-000000000005'), '0');
SELECT pg_temp.eq('C1 的工作階段不受影響', pg_temp.n('auth.sessions', 'user_id', 'c0000000-0000-4000-8000-000000000001'), '1');
SELECT pg_temp.eq('稽核 customer.disable 一筆', (SELECT count(*) || '/' || max(after ->> 'disabled_version') FROM public.admin_audit_log WHERE request_id = 'rq-d1' AND action = 'customer.disable')::text, '1/1');
SELECT pg_temp.eq('同一個請求重送 ⇒ NO_CHANGE', public.admin_disable_customer('t_boss', 'c0000000-0000-4000-8000-000000000005', 0, '客人要求', 'rq-d1'), 'NO_CHANGE');
SELECT pg_temp.eq('舊版本號的新請求 ⇒ STALE', public.admin_disable_customer('t_boss', 'c0000000-0000-4000-8000-000000000005', 0, '客人要求', 'rq-d2'), 'STALE');
SELECT pg_temp.eq('已停用再停用 ⇒ NO_CHANGE', public.admin_disable_customer('t_boss', 'c0000000-0000-4000-8000-000000000005', 1, '客人要求', 'rq-d3'), 'NO_CHANGE');
SELECT pg_temp.eq('三次重送後版本仍是 1、稽核仍一筆',
  (SELECT disabled_version || '/' || (SELECT count(*) FROM public.admin_audit_log WHERE action = 'customer.disable' AND target = 'customer:c0000000-0000-4000-8000-000000000005') FROM public.customers WHERE user_id = 'c0000000-0000-4000-8000-000000000005'),
  '1/1');

-- ── ④ 停用的會員:網站讀得到自己的 disabled_at;資料庫函式擋下 ──
SELECT pg_temp.as_user('c0000000-0000-4000-8000-000000000005');
SET ROLE authenticated;
SELECT pg_temp.eq('會員讀得到自己的 disabled_at', (SELECT (disabled_at IS NOT NULL)::text FROM public.customers WHERE user_id = 'c0000000-0000-4000-8000-000000000005'), 'true');
SELECT pg_temp.eq('會員讀不到停用原因', pg_temp.try($q$SELECT disabled_reason FROM public.customers$q$) LIKE '42501%', 'true');
SELECT pg_temp.eq('建單 ⇒ pcm_customer_disabled', pg_temp.try($q$SELECT public.create_order('[]'::jsonb, NULL, 'home', '{"type":"personal"}'::jsonb, gen_random_uuid(), 't1', '127.0.0.1', 'probe', 'bank_transfer', NULL, NULL)$q$) LIKE '42501%pcm_customer_disabled%', 'true');
SELECT pg_temp.eq('申請經銷 ⇒ pcm_customer_disabled', pg_temp.try($q$SELECT public.dealer_application_submit('五號', '12345678', '', '臺北市', '五號', '0912345678', 'c5@x.tw', '')$q$) LIKE '42501%pcm_customer_disabled%', 'true');
SELECT pg_temp.as_user('c0000000-0000-4000-8000-000000000001');
SELECT pg_temp.eq('正常會員讀自己的 disabled_at 是空值', (SELECT coalesce(disabled_at::text, 'NULL') FROM public.customers WHERE user_id = 'c0000000-0000-4000-8000-000000000001'), 'NULL');
-- 正常會員走過停用檢查、停在下一道(地址)⇒ 只有停用檢查沒擋人時這一格才綠(Fable R1 nit)
SELECT pg_temp.eq('正常會員建單走過停用檢查、停在地址那一道', pg_temp.try($q$SELECT public.create_order('[]'::jsonb, NULL, 'home', '{"type":"personal"}'::jsonb, gen_random_uuid(), 't1', '127.0.0.1', 'probe', 'bank_transfer', NULL, NULL)$q$) LIKE '%地址非本人或不存在%', 'true');
SELECT pg_temp.eq('會員讀不到別人的列', (SELECT count(*) FROM public.customers WHERE user_id = 'c0000000-0000-4000-8000-000000000005')::text, '0');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false);

-- ── ⑤ 客戶列表與搜尋 ──
SET ROLE service_role;
SELECT pg_temp.eq('搜尋預設不含已停用', (public.admin_search_customers('停用測試') -> 'ids')::text, '[]');
SELECT pg_temp.eq('搜尋 disabled 只找到 C5', (public.admin_search_customers('停用測試', 100, 'disabled') -> 'ids')::text, '["c0000000-0000-4000-8000-000000000005"]');
SELECT pg_temp.eq('搜尋 all 找得到 C5', (public.admin_search_customers('停用測試', 100, 'all') -> 'ids')::text, '["c0000000-0000-4000-8000-000000000005"]');
SELECT pg_temp.eq('搜尋 active 找得到 C1', (public.admin_search_customers('測試一號', 100, 'active') -> 'ids')::text, '["c0000000-0000-4000-8000-000000000001"]');
SELECT pg_temp.eq('搜尋 disabled 找不到 C1', (public.admin_search_customers('測試一號', 100, 'disabled') -> 'ids')::text, '[]');
SELECT pg_temp.eq('不認得的狀態 ⇒ 空清單', (public.admin_search_customers('測試', 100, 'xyz') -> 'ids')::text, '[]');
SELECT pg_temp.eq('列表 view 看得到停用時間', (SELECT (disabled_at IS NOT NULL)::text FROM public.admin_customer_list_v WHERE user_id = 'c0000000-0000-4000-8000-000000000005'), 'true');
RESET ROLE;
SELECT pg_temp.eq('會員不能執行搜尋與四支新函式',
  (SELECT bool_or(has_function_privilege(r, f, 'EXECUTE'))::text FROM unnest(ARRAY['anon', 'authenticated']) r,
     unnest(ARRAY['public.admin_search_customers(text, integer, text)', 'public.admin_customer_delete_eligibility(uuid)',
                  'public.admin_disable_customer(text, uuid, integer, text, text)', 'public.admin_enable_customer(text, uuid, integer, text, text)',
                  'public.admin_delete_customer(text, uuid, text, text)']) f), 'false');

-- ── ⑥ 恢復,與「停用 → 恢復 → 舊停用請求重送」(Codex 加審的反例)──
SELECT pg_temp.eq('恢復帶舊版本號 ⇒ STALE', public.admin_enable_customer('t_boss', 'c0000000-0000-4000-8000-000000000005', 0, '誤停', 'rq-e0'), 'STALE');
SELECT pg_temp.eq('恢復 C5', public.admin_enable_customer('t_boss', 'c0000000-0000-4000-8000-000000000005', 1, '誤停', 'rq-e1'), 'OK');
SELECT pg_temp.eq('C5 恢復、版本 2、停用者與原因清空',
  (SELECT (disabled_at IS NULL)::text || '/' || disabled_version || '/' || coalesce(disabled_by, 'NULL') || '/' || coalesce(disabled_reason, 'NULL') FROM public.customers WHERE user_id = 'c0000000-0000-4000-8000-000000000005'),
  'true/2/NULL/NULL');
SELECT pg_temp.eq('恢復的稽核留下當初停用原因', (SELECT before ->> 'disabled_reason' FROM public.admin_audit_log WHERE request_id = 'rq-e1' AND action = 'customer.enable'), '客人要求');
SELECT pg_temp.eq('恢復的請求重送 ⇒ NO_CHANGE', public.admin_enable_customer('t_boss', 'c0000000-0000-4000-8000-000000000005', 1, '誤停', 'rq-e1'), 'NO_CHANGE');
SELECT pg_temp.eq('舊停用請求換新 request_id 重送(版本 0)⇒ STALE、不會再停用', public.admin_disable_customer('t_boss', 'c0000000-0000-4000-8000-000000000005', 0, '客人要求', 'rq-d9'), 'STALE');
SELECT pg_temp.eq('C5 仍是正常狀態', (SELECT (disabled_at IS NULL)::text || '/' || disabled_version FROM public.customers WHERE user_id = 'c0000000-0000-4000-8000-000000000005'), 'true/2');
SELECT pg_temp.eq('沒停用再恢復 ⇒ NO_CHANGE', public.admin_enable_customer('t_boss', 'c0000000-0000-4000-8000-000000000005', 2, '再恢復', 'rq-e2'), 'NO_CHANGE');

-- ── ⑦ 經銷審核:停用的會員不能核准,婉拒照常 ──
SELECT pg_temp.eq('停用 C4', public.admin_disable_customer('t_boss', 'c0000000-0000-4000-8000-000000000004', 0, '測試', 'rq-d4'), 'OK');
SELECT pg_temp.eq('核准已停用會員 ⇒ CUSTOMER_DISABLED', public.admin_dealer_application_decide(
  (SELECT id FROM public.dealer_applications WHERE user_id = 'c0000000-0000-4000-8000-000000000004'), 'approve', '', 't_boss', 'rq-a4', 'general',
  (SELECT updated_at FROM public.dealer_applications WHERE user_id = 'c0000000-0000-4000-8000-000000000004')), 'CUSTOMER_DISABLED');
SELECT pg_temp.eq('C4 等級沒變、申請仍審核中', (SELECT c.tier::text || '/' || a.status FROM public.customers c JOIN public.dealer_applications a ON a.user_id = c.user_id WHERE c.user_id = 'c0000000-0000-4000-8000-000000000004'), 'general/pending');
SELECT pg_temp.eq('婉拒已停用會員的申請照常', public.admin_dealer_application_decide(
  (SELECT id FROM public.dealer_applications WHERE user_id = 'c0000000-0000-4000-8000-000000000004'), 'reject', '資料不全', 't_boss', 'rq-r4', NULL,
  (SELECT updated_at FROM public.dealer_applications WHERE user_id = 'c0000000-0000-4000-8000-000000000004')), 'REJECTED');
SELECT pg_temp.eq('查無申請 ⇒ NOT_FOUND', public.admin_dealer_application_decide('c0000000-0000-4000-8000-0000000000ff', 'approve', '', 't_boss', 'rq-a0', 'general', now()), 'NOT_FOUND');

-- ── ⑧ 手動建單:停用的客人擋下;停用前建好的單重送仍回原單 ──
CREATE FUNCTION pg_temp.manual(cust text, rq text) RETURNS text LANGUAGE sql AS $$
  SELECT public.admin_create_manual_order(cust::uuid, rq::uuid, 't_clerk', 'manual_phone', 'bank_transfer', 'home',
    '{"name":"王小明","phone":"0912000111","line":"台北市測試路1號"}'::jsonb, '{"type":"personal","requested":false}'::jsonb, 100,
    '[{"sku":"T1","title":"測試品","qty":1,"unit_price":100,"spec":{}}]'::jsonb) ->> 'order_id' $$;
SELECT pg_temp.eq('手動建單給 C9', (pg_temp.manual('c0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000009') IS NOT NULL)::text, 'true');
SELECT pg_temp.eq('C9 有訂單 ⇒ 不能刪', public.admin_customer_delete_eligibility('c0000000-0000-4000-8000-000000000009') ->> 'reasons', '["orders"]');
SELECT pg_temp.eq('停用 C9', public.admin_disable_customer('t_boss', 'c0000000-0000-4000-8000-000000000009', 0, '測試', 'rq-d9b'), 'OK');
SELECT pg_temp.eq('停用後手動建單 ⇒ 擋下', pg_temp.try($q$SELECT pg_temp.manual('c0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000099')$q$) LIKE '42501%已停用%', 'true');
SELECT pg_temp.eq('停用前那張單同一把鍵重送 ⇒ 仍回原單', (pg_temp.manual('c0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000009') IS NOT NULL)::text, 'true');
SELECT pg_temp.eq('C9 仍只有一張單', pg_temp.n('public.orders', 'customer_user_id', 'c0000000-0000-4000-8000-000000000009'), '1');
SELECT pg_temp.eq('刪除有訂單的 C9 ⇒ HAS_RECORDS', public.admin_delete_customer('t_boss', 'c0000000-0000-4000-8000-000000000009', '測試', 'rq-x9'), 'HAS_RECORDS');

-- ── ⑨ 刪除 ──
SELECT pg_temp.eq('刪除 C2(有儲值金流水)⇒ HAS_RECORDS', public.admin_delete_customer('t_boss', 'c0000000-0000-4000-8000-000000000002', '測試', 'rq-x4'), 'HAS_RECORDS');
SELECT pg_temp.eq('HAS_RECORDS 沒寫稽核', (SELECT count(*) FROM public.admin_audit_log WHERE action = 'customer.delete' AND request_id IN ('rq-x4', 'rq-x9'))::text, '0');
SELECT pg_temp.eq('有儲值金流水時直接刪登入帳號 ⇒ 外鍵擋下', pg_temp.try($q$DELETE FROM auth.users WHERE id = 'c0000000-0000-4000-8000-000000000002'$q$) LIKE '23503%', 'true');
SELECT pg_temp.eq('C2 仍在', pg_temp.n('public.customers', 'user_id', 'c0000000-0000-4000-8000-000000000002'), '1');
SELECT pg_temp.eq('刪除 C1', public.admin_delete_customer('t_boss', 'c0000000-0000-4000-8000-000000000001', '重複註冊', 'rq-del1'), 'DELETED');
SELECT pg_temp.eq('C1 登入帳號 / 身分 / 工作階段 / 刷新權杖 / 會員 / 地址全清',
  pg_temp.n('auth.users', 'id', 'c0000000-0000-4000-8000-000000000001') || pg_temp.n('auth.identities', 'user_id', 'c0000000-0000-4000-8000-000000000001')
  || pg_temp.n('auth.sessions', 'user_id', 'c0000000-0000-4000-8000-000000000001') || pg_temp.n('auth.refresh_tokens', 'user_id', 'c0000000-0000-4000-8000-000000000001')
  || pg_temp.n('public.customers', 'user_id', 'c0000000-0000-4000-8000-000000000001') || pg_temp.n('public.customer_addresses', 'customer_user_id', 'c0000000-0000-4000-8000-000000000001'),
  '000000');
SELECT pg_temp.eq('稽核留 email 與姓名', (SELECT before ->> 'email' || '/' || (before ->> 'name') || '/' || reason FROM public.admin_audit_log WHERE request_id = 'rq-del1' AND action = 'customer.delete'), 'c1@x.tw/測試一號/重複註冊');
SELECT pg_temp.eq('刪除請求重送 ⇒ DELETED', public.admin_delete_customer('t_boss', 'c0000000-0000-4000-8000-000000000001', '重複註冊', 'rq-del1'), 'DELETED');
SELECT pg_temp.eq('另一個請求刪已不存在的 ⇒ NOT_FOUND', public.admin_delete_customer('t_boss', 'c0000000-0000-4000-8000-000000000001', '重複註冊', 'rq-del2'), 'NOT_FOUND');
SELECT pg_temp.eq('同一個 email 可以重新註冊', pg_temp.try($q$INSERT INTO auth.users(id, email) VALUES ('c0000000-0000-4000-8000-0000000000a1', 'c1@x.tw'); INSERT INTO public.customers(user_id, email) VALUES ('c0000000-0000-4000-8000-0000000000a1', 'c1@x.tw')$q$), 'OK');

-- ── ⑩ 並行(dblink 另開兩個連線;每個連線自己一筆交易)──
SELECT dblink_connect('a', :'conn');
SELECT dblink_connect('b', :'conn');
CREATE FUNCTION pg_temp.wait(c text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  WHILE dblink_is_busy(c) = 1 LOOP PERFORM pg_sleep(0.05); END LOOP;
  SELECT x INTO r FROM dblink_get_result(c, false) AS t(x text);
  PERFORM * FROM dblink_get_result(c, false) AS t(x text);  -- 收掉結尾
  RETURN coalesce(r, 'ERR ' || dblink_error_message(c));
END $$;

-- ⑩-1 停用與經銷申請同時:停用先拿到會員列 ⇒ 申請等它提交後被擋, 不會多出一筆申請
SELECT dblink_send_query('a', $q$SELECT r || '/' || pg_sleep(1.0)::text FROM (SELECT public.admin_disable_customer('t_boss', 'c0000000-0000-4000-8000-000000000007', 0, '並行', 'rq-p1') AS r OFFSET 0) s$q$);
SELECT pg_sleep(0.3);
SELECT dblink_exec('b', $q$SET request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-000000000007","role":"authenticated"}'$q$);
SELECT dblink_exec('b', 'SET ROLE authenticated');
SELECT dblink_send_query('b', $q$SELECT public.dealer_application_submit('七號', '12345678', '', '臺北市', '七號', '0912345678', 'c7@x.tw', '')::text$q$);
SELECT pg_temp.eq('並行①停用成功', pg_temp.wait('a'), 'OK/');
SELECT pg_temp.eq('並行①申請被擋', pg_temp.wait('b') LIKE '%pcm_customer_disabled%', 'true');
SELECT pg_temp.eq('並行① C7 沒有申請', pg_temp.n('public.dealer_applications', 'user_id', 'c0000000-0000-4000-8000-000000000007'), '0');
SELECT dblink_exec('b', 'RESET ROLE');

-- ⑩-2 會員修改申請先拿到鎖、老闆核准後到:沒有死結;核准因申請內容變了回 STALE
SELECT set_config('t.upd8', (SELECT updated_at::text FROM public.dealer_applications WHERE user_id = 'c0000000-0000-4000-8000-000000000008'), false) IS NOT NULL;
SELECT dblink_exec('a', $q$SET request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-000000000008","role":"authenticated"}'$q$);
SELECT dblink_exec('a', 'SET ROLE authenticated');
SELECT dblink_send_query('a', format($q$SELECT r || '/' || pg_sleep(1.0)::text FROM (SELECT public.dealer_application_update_mine('%s', '八號車業改', '12345678', '', '臺北市', '八號', '0912345678', 'c8@x.tw', '')::text AS r OFFSET 0) s$q$,
  (SELECT id FROM public.dealer_applications WHERE user_id = 'c0000000-0000-4000-8000-000000000008')));
SELECT pg_sleep(0.3);
SELECT dblink_send_query('b', format($q$SELECT public.admin_dealer_application_decide('%s', 'approve', '', 't_boss', 'rq-p2', 'general', '%s'::timestamptz)$q$,
  (SELECT id FROM public.dealer_applications WHERE user_id = 'c0000000-0000-4000-8000-000000000008'), current_setting('t.upd8')));
SELECT pg_temp.eq('並行②修改成功', pg_temp.wait('a'), 'true/');
SELECT pg_temp.eq('並行②核准回 STALE(沒有死結)', pg_temp.wait('b'), 'STALE');
SELECT dblink_exec('a', 'RESET ROLE');

-- ⑩-3 反過來:老闆核准先拿到鎖、會員修改後到:沒有死結;修改回 false(已審完)
SELECT dblink_send_query('a', format($q$SELECT r || '/' || pg_sleep(1.0)::text FROM (SELECT public.admin_dealer_application_decide('%s', 'approve', '', 't_boss', 'rq-p3', 'general', '%s'::timestamptz) AS r OFFSET 0) s$q$,
  (SELECT id FROM public.dealer_applications WHERE user_id = 'c0000000-0000-4000-8000-000000000008'),
  (SELECT updated_at FROM public.dealer_applications WHERE user_id = 'c0000000-0000-4000-8000-000000000008')));
SELECT pg_sleep(0.3);
SELECT dblink_exec('b', $q$SET request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-000000000008","role":"authenticated"}'$q$);
SELECT dblink_exec('b', 'SET ROLE authenticated');
SELECT dblink_send_query('b', format($q$SELECT public.dealer_application_update_mine('%s', '八號車業再改', '12345678', '', '臺北市', '八號', '0912345678', 'c8@x.tw', '')::text$q$,
  (SELECT id FROM public.dealer_applications WHERE user_id = 'c0000000-0000-4000-8000-000000000008')));
SELECT pg_temp.eq('並行③核准成功', pg_temp.wait('a'), 'APPROVED/');
SELECT pg_temp.eq('並行③修改回 false(沒有死結)', pg_temp.wait('b'), 'false');
SELECT dblink_exec('b', 'RESET ROLE');
SELECT pg_temp.eq('並行③ C8 變成經銷', (SELECT tier::text FROM public.customers WHERE user_id = 'c0000000-0000-4000-8000-000000000008'), 'store');

-- ⑩-4 刪除先拿到會員列、同時寫儲值金流水:流水等刪除提交後因會員不存在而失敗, 只有一邊成功
SELECT dblink_send_query('a', $q$SELECT r || '/' || pg_sleep(1.0)::text FROM (SELECT public.admin_delete_customer('t_boss', 'c0000000-0000-4000-8000-000000000006', '並行', 'rq-p4') AS r OFFSET 0) s$q$);
SELECT pg_sleep(0.3);
SELECT dblink_send_query('b', $q$INSERT INTO public.customer_wallet_ledger(customer_user_id, entry_type, amount) VALUES ('c0000000-0000-4000-8000-000000000006', 'deposit', 100) RETURNING 'INSERTED'$q$);
SELECT pg_temp.eq('並行④刪除成功', pg_temp.wait('a'), 'DELETED/');
SELECT pg_temp.eq('並行④流水被外鍵擋下', pg_temp.wait('b') LIKE '%foreign key%', 'true');

-- ⑩-5 反過來:流水先寫(未提交)、刪除後到:刪除等它提交後重新檢查 ⇒ HAS_RECORDS
INSERT INTO auth.users(id, email) VALUES ('c0000000-0000-4000-8000-0000000000b6', 'c6b@x.tw');
INSERT INTO public.customers(user_id, email) VALUES ('c0000000-0000-4000-8000-0000000000b6', 'c6b@x.tw');
-- 🔴 寫入與等待要分成兩句:外鍵檢查在【每一句結束時】才做, 寫在同一句裡會等到睡完才鎖會員列(刪除就先贏了)
SELECT dblink_send_query('a', $q$DO $d$ BEGIN
  INSERT INTO public.customer_wallet_ledger(customer_user_id, entry_type, amount) VALUES ('c0000000-0000-4000-8000-0000000000b6', 'deposit', 100);
  PERFORM pg_sleep(1.0);
END $d$$q$);
SELECT pg_sleep(0.3);
SELECT dblink_send_query('b', $q$SELECT public.admin_delete_customer('t_boss', 'c0000000-0000-4000-8000-0000000000b6', '並行', 'rq-p5')$q$);
SELECT pg_temp.eq('並行⑤流水成功', pg_temp.wait('a'), 'DO');
SELECT pg_temp.eq('並行⑤刪除回 HAS_RECORDS', pg_temp.wait('b'), 'HAS_RECORDS');

-- ⑩-6 停用與恢復同時(同一個版本號):後到的那一個看到版本變了 ⇒ STALE, 結果一致
SELECT dblink_send_query('a', $q$SELECT r || '/' || pg_sleep(1.0)::text FROM (SELECT public.admin_disable_customer('t_boss', 'c0000000-0000-4000-8000-000000000005', 2, '並行', 'rq-p6') AS r OFFSET 0) s$q$);
SELECT pg_sleep(0.3);
SELECT dblink_send_query('b', $q$SELECT public.admin_enable_customer('t_boss', 'c0000000-0000-4000-8000-000000000005', 2, '並行', 'rq-p7')$q$);
SELECT pg_temp.eq('並行⑥停用成功', pg_temp.wait('a'), 'OK/');
SELECT pg_temp.eq('並行⑥恢復回 STALE', pg_temp.wait('b'), 'STALE');
SELECT pg_temp.eq('並行⑥ C5 已停用、版本 3', (SELECT (disabled_at IS NOT NULL)::text || '/' || disabled_version FROM public.customers WHERE user_id = 'c0000000-0000-4000-8000-000000000005'), 'true/3');

SELECT dblink_disconnect('a');
SELECT dblink_disconnect('b');

SELECT '✅ 刪除停用會員行為測試全部通過';
