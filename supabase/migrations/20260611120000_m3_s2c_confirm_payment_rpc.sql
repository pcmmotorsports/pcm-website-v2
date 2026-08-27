-- ============================================================
-- M-3-S2-c:付款確認窄權 — payment_confirmer 角色 + confirm_order_payment RPC(unpaid→paid)
-- ============================================================
-- 真權威:master plan docs/specs/2026-06-04-m3-checkout-plan.md v6 §3.1 L70(付款確認窄權)+ §5 紅線 + §7 階段②。
-- 交辦:docs/handoff/2026-06-11-m3-stage2-tappay-kickoff.md §6(第一片六件套、含 PF-A~G + PF-F 審查側 pre-flight)。
-- 依賴:20260604120000_m3_s2a_orders_order_items.sql(orders 表 + payment_status enum + tappay_rec_trade_id UNIQUE / paid_at / payment_method 三付款欄〔D6=A nullable、本片寫值〕+ total integer + fulfillment_status enum)。
-- 鐵則 8 重大改動(新 DB 角色 + 新 SECURITY DEFINER RPC + GRANT)+ 鐵則 12(payment / RPC / 金額 / 越權)。
--
-- 🔴 安全模型(plan §5 + handoff §3 + PF-A~G):
--   ① 零 service_role:confirm 走 payment_confirmer 窄權 DB 角色(PF-F:NOINHERIT LOGIN、零 table 權限、從不 GRANT 任何 role 給它〔never-GRANT-role〕、直接 LOGIN〔非 authenticator+SET ROLE〕、statement_timeout 8s + lock_timeout 5s + CONNECTION LIMIT 10);非 service_role、非 authenticated client。confirm 為付款確認的安全 backstop、先於任何 charge code。
--   ② PF-A schema 限定全覆蓋:SECURITY DEFINER + SET search_path='';函式體每個識別子皆 pg_catalog.*(btrim/now/jsonb_build_object)/ public.orders / ::public.payment_status。search_path='' 為函式屬性、對任何 caller 一律生效(無 rolconfig 的 payment_confirmer 與 postgres 行為一致、無遮蔽);鏡像 create_order schema-qualify 紀律。
--   ③ PF-B FOR UPDATE 臨界區:SELECT ... FOR UPDATE 鎖 row 後在持鎖狀態完成「讀狀態→判冪等→UPDATE」(序列化並發 confirm、防 TOCTOU 雙翻/lost update)。
--   ④ PF-C row_count 守:UPDATE 後 GET DIAGNOSTICS row_count;<>1 → RAISE(防未來開 orders FORCE RLS 時 SECURITY DEFINER UPDATE 靜默匹配 0 列=收錢卻沒翻單)。UPDATE WHERE 帶 payment_status='unpaid' 條件式(狀態-race 偵測 + 縱深)。
--   ⑤ PF-D 冪等判斷樹釘死順序(正向白名單、非 <>'paid'):(1) 不存在→拒 (2) FOR UPDATE 鎖 (3) paid 且 rec_trade_id+amount 雙等 → no-op 回成功(真 RETURN、不 UPDATE、不刷 paid_at/updated_at) (4) paid/refunded/partiallyPaid 且 rec 或 amount 任一不等 → 拒(refunded/partiallyPaid 即使同 rec 也拒、不復活) (5) unpaid 且 amount=total 且 rec 非空 → 翻 paid (6) 其餘→拒。
--   ⑥ PF-E 拒絕路徑訊息收斂:所有業務拒絕(含 unique_violation backstop)走單一通用訊息 'confirm_order_payment: 付款確認失敗'、不洩 total/payment_status/order 存在與否/rec_trade_id/約束名(#219 harden + 防 rec_trade_id 消耗 oracle)。輸入驗(rec_trade_id 缺失)為 server 自供參數、非訂單內部狀態、訊息可具體。
--   ⑦ PF-G:翻 paid 的 UPDATE 僅 5 欄(payment_status / tappay_rec_trade_id / paid_at / payment_method / updated_at)、零 fulfillment_status(出貨軸不被付款確認擾動);return DTO 只 {confirmed,idempotent}、不洩 total/價結構。
--   ⑧ 金額不可竄改(雙 server 權威縱深):charge 金額由 server 從 order.total 讀(charge code 階段②-③),confirm RPC 內再驗 p_amount=orders.total(整數比對、禁浮點)。零經銷價/cost 觸及。
--   ⑨ service_role table 層收斂(§4、審查側 codex r1 抓 + Sean 拍 A):函式層 REVOKE service_role EXECUTE 不足 —— service_role(god-mode+BYPASSRLS)對 orders/order_items 有直接寫權、可繞過 confirm/create_order 直接 UPDATE/INSERT。§4 REVOKE INSERT/UPDATE/DELETE/TRUNCATE FROM service_role(保留 SELECT)+ fail-closed assert,令「連 service_role 也不得確認付款/建單」table 層也成真。⚠️ 為「最敏感表縱深」非全庫 service_role 圍堵(別表仍 god-mode)→ 「service_role 全庫權限收斂」獨立 backlog(待 Sean 編號)。
--
-- 🔴 charge 編排層(階段②-③)責任 — 本片純 DB RPC 無法獨力解(誠實標記、PF-X1/X2/X3、見 handoff §3.7 + §7 L120):
--   PF-X1 孤兒單:charge 成功(已扣款、rec_trade_id 已生)但 confirm 那跳失敗 → 錢扣了訂單永停 unpaid、無 webhook(plan §3.2)。階段②-③ 須 charge 前寫 charge-attempt 紀錄供對帳 + 失敗禁誘導重刷 + 重試走「重呼 confirm 冪等」非「重呼 charge」。
--   PF-X2 雙重扣款:同單先後兩次成功 charge(不同 prime→不同 rec_trade_id)→ 本 RPC per-charge 鍵防不了 per-order(第二筆 confirm 會被拒〔PF-D step 4〕但第一筆錢已扣)。階段②-③ 須 per-order charge 鎖。
--   PF-X3 TapPay 實扣金額未驗:本 RPC 只比 server 自報 p_amount=orders.total、零處驗 TapPay 真扣了 total。階段②-③ 須 charge amount=confirm p_amount=server read-back orders.total 單一來源(禁 JS 浮點/禁從 client/TapPay result 直取)+ charge 後比對 result.amount==total 不符不 confirm。
--   → 已記入 handoff §7 階段②-③/②-⑥(落地)+ plan §3.2 斷線對帳 backlog。
--
-- ⚠️ 誠實揭示:
--   - payment_confirmer 密碼不寫死(CREATE ROLE 無 PASSWORD、DO IF NOT EXISTS 冪等);Sean db push 後另設密碼(ALTER ROLE payment_confirmer WITH PASSWORD '…' 或 dashboard)+ 設 server-only 連線字串(handoff §4)。
--   - GRANT USAGE ON SCHEMA public 為 EXECUTE 函式所需(非 table 權限;雖 PUBLIC 既有 USAGE、顯式 grant 防未來 PUBLIC 被收回 + 自我文件化)。
--   - confirm 以 owner 身分執行(SECURITY DEFINER)→ 不受 orders RLS / authenticated 僅 SELECT 限制;payment_confirmer 自身零 table 權限、且非任何 role 之成員(never-GRANT-role)。
--   - 🔴 PF-A literal「SET ROLE payment_confirmer 在交易內實跑 happy-path」**無法於本機 Supabase 連線池(pooled MCP)完成** —— payment_confirmer 呼叫此 SECURITY DEFINER 函式時 pooled 連線必被終止(已 4 次重現:純角色切換存活、加函式呼叫即斷;環境限制、非 migration 缺陷)。PF-A 意圖以下列等價證據覆蓋:has_function_privilege('payment_confirmer')=true(可呼)+ SET ROLE 角色切換本身可行(probe 證)+ happy-path 邏輯以 owner 身分實跑翻轉正確(模擬 #3/3b)+ search_path='' 為函式屬性對所有 caller 一致(無 postgres 遮蔽)+ 全識別子 schema-qualified。literal 端到端角色 round-trip 延 Sean 真 payment_confirmer LOGIN 連線於階段②-③ / 肉眼驗實跑。
--
-- 動手前真 DB 交易模擬(MCP execute_sql 交易內 BEGIN + 套本 migration DDL + synthetic orders + DO 斷言 + ROLLBACK;
--   project bmpnplmnldofgaohnaok pcm-website-v2 PG17、2026-06-11;SQL 字面不自證、以唯讀查為憑;每次 ROLLBACK 後 pg_roles/pg_proc/orders 複查零留痕;因 pooled 連線於 payment_confirmer 呼叫時斷,模擬拆 Call A〔角色/權限/DDL〕+ Call C〔行為矩陣 as owner〕):
--   PASS(Call A 12/12 + Call C 17/17 = 全綠):
--   ① DDL 套用無誤(A:1a 角色建成 / 1d 函式 prosecdef + proconfig search_path="");
--   PF-F 角色:A:1b LOGIN+NOINHERIT+NOSUPER+NOBYPASSRLS / 1b2 CONNECTION LIMIT=10 / 1b3 statement_timeout=8s+lock_timeout=5s / 1c 零 table 權限(role_table_grants=0)/ 1f 非任何 role 之成員(never-GRANT-role);
--   ② 權限矩陣:A:2a payment_confirmer EXECUTE=true / 2b anon=false / 2c authenticated=false / 2d SET ROLE anon 實呼 → denied / 2e payment_confirmer 無 create_order EXECUTE(攻擊面收斂);
--      🔴 codex 關卡2 round1 抓 + 修證:service_role EXECUTE=false(加 service_role 進 REVOKE 後;修前 has_function_privilege('service_role')=true 為真實漏洞、已閉);
--      🔴 codex 關卡2 round2 抓 + 修證(滴水不漏 hardening):① role-hygiene assert 補 column grants(role_column_grants)+ 全 7 窄權屬性(含 superuser-gated);② §3 末新增函式權限矩陣 assert(has_function_privilege 涵蓋 inherit、同守 service_role 回歸 + reverse-membership 繼承威脅);③ 強制 ALTER 窄權屬性(可改者)+ REVOKE ALL TABLES/SEQUENCES;
--      🔴 codex 關卡2 round3 抓 + 修證:① forward member-of=0(payment_confirmer 不得是任何 role 成員、否則直接 LOGIN 可 SET ROLE 逃逸窄權 escalation;NOINHERIT 不擋 SET ROLE)② reverse 改 pg_has_role(threat,'payment_confirmer','MEMBER') 遞迴(涵蓋間接 SET ROLE 鏈、非僅 direct);MCP 實測 fresh 通過、taint{forward member-of/reverse direct/reverse 遞迴}各被偵測;③ 全 migration end-to-end apply 一次過(兩 assert fresh 通過、confirmer_exec=true/service_role_exec=false)、查後零留痕。⚠️ forward 用 member-of=0 無 PG16 creator false-positive(creator 是 reverse 方向);reverse 查具體威脅角色遞迴、避免良性 creator 成員誤擋 fresh db push;
--   ③ happy unpaid→paid(C:3 {confirmed:true,idempotent:false})+ 5 欄正確(C:3b payment_status=paid/rec_A/tappay/paid_at/updated_at);
--   ④ 重放冪等(C:4a {confirmed:true,idempotent:true})+ paid_at/updated_at 不被刷(C:4b 前後相等、PF-D no-op);
--   ⑤ 同 order 異 rec_trade_id(paid)→ 拒(C:5);⑥ 同 rec_trade_id 異 amount(paid)→ 拒(C:6、PF-D);
--   ⑦ p_amount≠total → 拒(C:7a)+ NULL amount 拒(C:7b)+ 空白 rec_trade_id 拒(C:7c)+ 訂單不存在 拒(C:7d);
--   ⑧ refunded + 同 rec → 拒(C:8a 不復活)+ partiallyPaid + 同 rec → 拒(C:8b);
--   ⑨ cross-order rec_trade_id 重用 → 拒(C:9a)+ 訊息通用不洩 rec/tappay/total(C:9b)+ 被拒單仍 unpaid 無副作用(C:9c);
--   ⑩ confirm 前後 fulfillment_status 不變(C:10a/10b notOrdered→notOrdered、PF-G);
--   ⑪ ROLLBACK 後 pg_roles 無 payment_confirmer / pg_proc 無 confirm_order_payment / orders count 仍 0 = 零留痕。
--   (模擬以 SIM-ONLY 暫態 GRANT payment_confirmer TO current_user WITH SET TRUE 啟用 SET ROLE 測試、已隨 ROLLBACK 回收、本 migration 無此 GRANT。)
--   ⑫ §4 table 層 service_role 收斂(審查側 codex r1 + Sean 拍 A):修前 has_table_privilege('service_role','public.orders','UPDATE'/'INSERT')=true(漏洞)→ REVOKE 後 orders/order_items 之 INSERT/UPDATE/DELETE 全 false、SELECT 保留 true;fail-closed assert 靜默通過;零回歸(authenticated 仍 SELECT、authenticated UPDATE=false、owner postgres UPDATE=true → SECURITY DEFINER create_order/confirm 不受影響);查後 ROLLBACK 零留痕。
--
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):見檔尾。
-- ============================================================


-- ── 1. payment_confirmer 窄權角色(PF-F + codex 關卡2 round2 滴水不漏 hardening)──
-- 設計:新建時 CREATE 設全部窄權屬性;既有角色 → 「能 FIX 的強制 ALTER + REVOKE、不能 FIX 的(superuser-gated)
--   靠下方 fail-closed assert 偵測擋」。付款角色不容降權漂移。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'payment_confirmer') THEN
    CREATE ROLE payment_confirmer WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
END
$$;

-- 強制可改窄權屬性(idempotent、不論新建/既有 tainted;postgres 可改 inherit/createdb/createrole/login)。
-- ⚠️ NOSUPERUSER/NOBYPASSRLS/NOREPLICATION 為 superuser-gated、非 superuser 的 migration 角色無法 ALTER → 靠 CREATE 設 + 下方 assert 偵測擋(MCP 實測)。
ALTER ROLE payment_confirmer NOINHERIT NOCREATEDB NOCREATEROLE LOGIN;

-- PF-F 連線資源護欄(idempotent):限連線數防 server-only 連線池耗盡;限語句/鎖等待防 FOR UPDATE 卡鎖。
ALTER ROLE payment_confirmer CONNECTION LIMIT 10;
ALTER ROLE payment_confirmer SET statement_timeout = '8s';
ALTER ROLE payment_confirmer SET lock_timeout = '5s';

-- 強制零物件權限(idempotent、含 column-level;清既有 tainted 角色被授的 table/sequence 權限)。
REVOKE ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public FROM payment_confirmer;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM payment_confirmer;

COMMENT ON ROLE payment_confirmer IS 'M-3-S2-c 付款確認窄權角色(plan §3.1 L70、安全鑰匙=丙、PF-F)。LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION、零 table/column 權限、非任何 role 之成員(雙向 never-GRANT-role)、只 EXECUTE confirm_order_payment;直接 LOGIN(非 authenticator+SET ROLE);statement_timeout 8s / lock_timeout 5s / CONNECTION LIMIT 10。非 service_role、非 authenticated。密碼由 Sean db push 後另設(migration 不寫死)。';

-- EXECUTE 函式需 schema USAGE(非 table 權限;顯式 grant 防 PUBLIC 既有 USAGE 未來被收回)
GRANT USAGE ON SCHEMA public TO payment_confirmer;

-- 🔴 PF-F fail-closed role-hygiene 守(codex 關卡2 round1+2+3):上面已 FIX「能改的」;此 assert 複核角色窄權,任一不符 → RAISE 擋 db push。
--    查:① 零 table 權限 ② 零 column-level 權限(codex r2:role_table_grants 漏 column grant)③ 全部窄權屬性(含 superuser-gated SUPERUSER/BYPASSRLS/REPLICATION,ALTER 改不掉、只能偵測擋)
--    ④ forward member-of=0(codex r3:payment_confirmer 不得是任何 role 之成員、否則直接 LOGIN 可 SET ROLE 逃逸窄權 escalation;NOINHERIT 不擋 SET ROLE)
--    ⑤ reverse 遞迴(codex r2+r3):威脅角色 anon/authenticated/service_role 不得(直接或間接)成為 payment_confirmer 成員 → 用 pg_has_role(...,'MEMBER') 涵蓋 SET ROLE/inherit 全鏈。
--    ⚠️ forward 用「member-of=0」(無 PG16 creator false-positive、creator 是 reverse 方向);reverse 不查「任意成員=0」:PG16 建 role 時 creator(postgres)自動成為新 role 成員=良性 → 改查具體威脅角色遞迴,避免誤擋 fresh db push(MCP 實測)。inherit 有效權限另由 §3 末函式權限矩陣 assert 直接守(雙保險)。
DO $$
DECLARE
  v_tbl       integer;
  v_col       integer;
  v_memberof  integer;  -- forward:payment_confirmer 是別 role 之成員(>0 → SET ROLE escalation)
  v_ok_attr   boolean;
  v_threat_in boolean;  -- reverse 遞迴:威脅角色能否(直接/間接)成為 payment_confirmer 成員
BEGIN
  SELECT count(*) INTO v_tbl FROM information_schema.role_table_grants  WHERE grantee = 'payment_confirmer';
  SELECT count(*) INTO v_col FROM information_schema.role_column_grants WHERE grantee = 'payment_confirmer';
  SELECT count(*) INTO v_memberof
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles r ON r.oid = m.member
   WHERE r.rolname = 'payment_confirmer';
  v_threat_in := pg_catalog.pg_has_role('anon',          'payment_confirmer', 'MEMBER')
              OR pg_catalog.pg_has_role('authenticated', 'payment_confirmer', 'MEMBER')
              OR pg_catalog.pg_has_role('service_role',  'payment_confirmer', 'MEMBER');
  SELECT (rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)
    INTO v_ok_attr FROM pg_catalog.pg_roles WHERE rolname = 'payment_confirmer';
  IF v_tbl <> 0 OR v_col <> 0 OR v_memberof <> 0 OR NOT v_ok_attr OR v_threat_in THEN
    RAISE EXCEPTION 'payment_confirmer 非窄權(table_grants=%, col_grants=%, member_of=%, attrs_ok=%, 威脅角色可成成員=%);拒繼續 — 疑既有 tainted 角色,須人工清權/改屬性後再 db push', v_tbl, v_col, v_memberof, v_ok_attr, v_threat_in;
  END IF;
END
$$;


-- ── 2. confirm_order_payment RPC(SECURITY DEFINER 受控提權;PF-A~G)──
CREATE OR REPLACE FUNCTION public.confirm_order_payment(
  p_order_id     uuid,
  p_amount       integer,
  p_rec_trade_id text
)
RETURNS jsonb                 -- {confirmed boolean, idempotent boolean};禁回 total/價結構(PF-G)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order       record;
  v_n           integer;
  v_generic_msg constant text := 'confirm_order_payment: 付款確認失敗';  -- 🔴 PF-E:業務拒絕單一通用訊息、不洩內部狀態
BEGIN
  -- ── 輸入驗:rec_trade_id 非空(server 自供參數、非訂單內部狀態 → 可具體)──
  IF p_rec_trade_id IS NULL OR pg_catalog.btrim(p_rec_trade_id) = '' THEN
    RAISE EXCEPTION 'confirm_order_payment: 交易識別碼缺失';
  END IF;

  -- ── PF-B:FOR UPDATE 鎖臨界區 ──
  SELECT id, total, payment_status, tappay_rec_trade_id
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;

  -- ── PF-D(1):訂單不存在 → 拒(通用、不洩存在與否)──
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-D(3):paid 且 rec_trade_id+amount 雙等 → no-op 冪等成功(真 RETURN、不 UPDATE、不刷時間戳)──
  IF v_order.payment_status = 'paid'::public.payment_status THEN
    IF v_order.tappay_rec_trade_id IS NOT DISTINCT FROM p_rec_trade_id
       AND p_amount IS NOT NULL AND v_order.total = p_amount THEN
      RETURN pg_catalog.jsonb_build_object('confirmed', true, 'idempotent', true);
    END IF;
    -- PF-D(4):paid 但 rec 或 amount 任一不等(疑重複扣款/竄改)→ 拒
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-D(4):refunded / partiallyPaid(非 unpaid)→ 拒(同 rec 也不復活成 paid)──
  IF v_order.payment_status <> 'unpaid'::public.payment_status THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-D(5):unpaid 且金額相符 → 翻 paid;金額不符/NULL → 拒(整數比對、不洩 total)──
  IF p_amount IS NULL OR p_amount <> v_order.total THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── cross-order rec_trade_id 重用序列 pre-check(優雅通用訊息;UNIQUE 並發 backstop 見 EXCEPTION)──
  PERFORM 1 FROM public.orders
   WHERE tappay_rec_trade_id = p_rec_trade_id AND id <> p_order_id;
  IF FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-G:翻 paid、僅 5 欄、零 fulfillment_status;WHERE 帶 payment_status='unpaid' 條件式 ──
  UPDATE public.orders
     SET payment_status      = 'paid'::public.payment_status,
         tappay_rec_trade_id = p_rec_trade_id,
         paid_at             = pg_catalog.now(),
         payment_method      = 'tappay',
         updated_at          = pg_catalog.now()
   WHERE id = p_order_id
     AND payment_status = 'unpaid'::public.payment_status;

  -- ── PF-C:row_count 守(防 FORCE RLS 靜默 0 列=收錢沒翻單)──
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  RETURN pg_catalog.jsonb_build_object('confirmed', true, 'idempotent', false);

EXCEPTION
  -- 🔴 PF-E:cross-order rec_trade_id 真並發撞 orders.tappay_rec_trade_id UNIQUE → 通用訊息(不洩 raw 23505/約束名)
  WHEN unique_violation THEN
    RAISE EXCEPTION '%', v_generic_msg;
END;
$fn$;

COMMENT ON FUNCTION public.confirm_order_payment(uuid, integer, text) IS
  'M-3-S2-c 付款確認(SECURITY DEFINER 零 service_role、search_path='''')。只 payment_confirmer 可呼;PF-D 冪等樹:unpaid + p_amount=orders.total + rec_trade_id 非空且未用於別單 → 翻 paid 寫 5 欄(零 fulfillment、PF-G);paid+同 rec+同 amount 重放冪等 no-op(不刷時間戳);refunded/partiallyPaid 即使同 rec 也拒。PF-B FOR UPDATE + PF-C row_count 守 + PF-E 業務拒絕單一通用訊息(#219 harden)+ UNIQUE 並發 backstop。零經銷價/cost。';


-- ── 3. 權限:REVOKE EXECUTE FROM PUBLIC, anon, authenticated, service_role → 只 GRANT payment_confirmer ──
-- 🔴 codex 關卡2 實證:Supabase `ALTER DEFAULT PRIVILEGES` 對新函式**直接** GRANT EXECUTE TO service_role(非經 PUBLIC)
--    → 只 REVOKE FROM PUBLIC 不夠、service_role 仍可呼(MCP 實測 has_function_privilege('service_role')=true)。
--    安全鑰匙=丙 的核心 = 連 service_role 也不得確認付款 → 必顯式 REVOKE service_role。先 REVOKE(含 anon/authenticated/service_role)、再精準 GRANT payment_confirmer only。
REVOKE ALL ON FUNCTION public.confirm_order_payment(uuid, integer, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_order_payment(uuid, integer, text) TO payment_confirmer;

-- 🔴 函式權限矩陣 fail-closed assert(codex 關卡2 末守、直接驗終態):只 payment_confirmer 可 EXECUTE。
--    has_function_privilege 涵蓋「直接 + 經 role membership 繼承(inherit)」→ 同時守 round1 service_role 漏洞回歸
--    + reverse-membership 繼承 EXECUTE 威脅。任一威脅角色可呼 / payment_confirmer 不可呼 → RAISE 擋 db push。
DO $$
BEGIN
  IF has_function_privilege('anon',          'public.confirm_order_payment(uuid,integer,text)', 'EXECUTE')
     OR has_function_privilege('authenticated','public.confirm_order_payment(uuid,integer,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.confirm_order_payment(uuid,integer,text)', 'EXECUTE')
     OR NOT has_function_privilege('payment_confirmer', 'public.confirm_order_payment(uuid,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'confirm_order_payment EXECUTE 權限矩陣異常 — 應只 payment_confirmer 可呼(anon/authenticated/service_role 皆不可);拒繼續';
  END IF;
END
$$;


-- ── 4. 訂單表 service_role 直接寫權收斂(table 層縱深、令安全鑰匙=丙 table 層也成真)──
-- 🔴 審查側 codex 關卡2 round1 抓 + Sean 拍 A 補成真:函式層已 REVOKE service_role EXECUTE(§3),
--    但 service_role(Supabase god-mode + BYPASSRLS)對 orders/order_items 有完整直接寫權(INSERT/UPDATE/DELETE)
--    → 可繞過 confirm_order_payment 直接 UPDATE orders SET payment_status='paid'、也能繞過 create_order 直接 INSERT。
--    收掉訂單表直接寫權,令「連 service_role 也不得確認付款 / 建單」在 table 層也成真。
--    MCP 實證(2026-06-11、project bmpnplmnldofgaohnaok):修前 has_table_privilege('service_role','public.orders','UPDATE'/'INSERT')=true(漏洞)
--    → REVOKE 後 service_role 對 orders/order_items 之 INSERT/UPDATE/DELETE 全 false、SELECT 保留 true;
--    create_order/confirm 走 SECURITY DEFINER(owner=postgres、postgres orders UPDATE 仍 true)零回歸;authenticated 仍只 SELECT、payment_confirmer 零 table 權。
--    ⚠️ 誠實標記:本段為「最敏感表(orders/order_items)縱深」、**非全庫 service_role 圍堵** —— service_role 對其他表仍 god-mode + 全域 BYPASSRLS;
--       「service_role 全庫權限收斂」為獨立評估(backlog、待 Sean 編號)。
--    ⚠️ Supabase 對「新建物件」ALTER DEFAULT PRIVILEGES 會 re-grant service_role → orders/order_items 既存、本次一次 REVOKE 即生效;
--       未來若 DROP+重建 orders/order_items,須回看本段補 REVOKE(否則 re-grant 漂移、丙 table 層失真)。
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.orders      FROM service_role;  -- 保留 SELECT(admin 唯讀;orders 無經銷價/cost 欄、讀安全)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.order_items FROM service_role;  -- 保留 SELECT

-- fail-closed assert(防 Supabase re-grant 漂移、apply 時驗 table 層丙模型成真):service_role 對訂單表零直接寫權,否則 RAISE 擋 db push。
-- (驗 INSERT/UPDATE/DELETE 三寫權;TRUNCATE 無 has_table_privilege 探針、僅由上方 REVOKE 收、不納 assert — 偽造付款攻擊面在 INSERT/UPDATE。)
DO $$
BEGIN
  IF has_table_privilege('service_role', 'public.orders',      'INSERT')
     OR has_table_privilege('service_role', 'public.orders',      'UPDATE')
     OR has_table_privilege('service_role', 'public.orders',      'DELETE')
     OR has_table_privilege('service_role', 'public.order_items', 'INSERT')
     OR has_table_privilege('service_role', 'public.order_items', 'UPDATE')
     OR has_table_privilege('service_role', 'public.order_items', 'DELETE') THEN
    RAISE EXCEPTION 'service_role 仍有 orders/order_items 直接寫權 — 安全鑰匙=丙 table 層未成真,拒繼續';
  END IF;
END
$$;


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.orders      TO service_role;  -- 還原 §4 service_role 訂單表直接寫權
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.order_items TO service_role;
--   DROP FUNCTION IF EXISTS public.confirm_order_payment(uuid, integer, text);
--   REVOKE USAGE ON SCHEMA public FROM payment_confirmer;
--   ALTER ROLE payment_confirmer RESET statement_timeout;
--   ALTER ROLE payment_confirmer RESET lock_timeout;
--   ALTER ROLE payment_confirmer CONNECTION LIMIT -1;
--   DROP ROLE IF EXISTS payment_confirmer;   -- 須先確認無物件依賴此角色
-- ============================================================
