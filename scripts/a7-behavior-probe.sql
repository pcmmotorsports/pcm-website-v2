-- ============================================================
-- A7-2:order_cancellations / order_cancellation_items 的行為驗證(**36 條探針**)
-- ============================================================
-- 片級 plan:docs/specs/2026-07-30-e10-a7-order-cancellations-plan.md(v5)§7.2
-- 搭配:supabase/migrations/20260730130000_m4b_e10_a7_order_cancellations.sql(A7-1 = 結構驗收)
--
-- 🔴 為什麼行為探針**不在** migration 裡(codex 關卡1 R2):
--    ①探針需要真實 order / order_item 當 FK 目標 ⇒ 放在 migration 裡就會長出「資料不足就 NOTICE
--      並 exit 0」的分支 = **fail-open 假綠**(D0/A2/A3 都有這個分支,實測會印「已略過」)
--    ②探針會拉長 apply 交易的持鎖時間
--    ⇒ 拆開後:A7-1 的驗收**沒有任何略過分支**;行為證明由本檔負責,而本檔**自己造 fixture**、
--      不依賴目標環境剛好有幾張單。
--
-- 🔴 結構驗收與行為驗收的分工(缺一不可,不得只跑一邊就宣稱「取消真相已就緒」):
--    A7-1 證明「約束存在、形狀對、ACL 對」;本檔證明「它們真的擋得住 / 真的放得過」。
--    最典型的例子:reason_code 的 allowlist 若被寫成只允許 1 個值,A7-1 抓得到「定義裡少了值」,
--    但「七個值真的都寫得進去」只有本檔的探針 1-7 能證明。
--
-- ── 用法 ────────────────────────────────────────────────────
--   psql "$URL" -v ON_ERROR_STOP=1 \
--        -v a7_allow_dml=yes-throwaway-db \
--        -v a7_expect_cluster=<該庫的 system_identifier> \
--        -f scripts/a7-behavior-probe.sql
--
-- 取得 cluster id:psql "$URL" -qtA -c "SELECT system_identifier FROM pg_control_system()"
--
-- 🔴 **還要先在該庫建白名單標記**(關卡2 must-fix:黑名單只擋得住已知的正式站):
--   psql "$URL" -c "CREATE TABLE public.pcm_a7_probe_allowed (note text);
--                   COMMENT ON TABLE public.pcm_a7_probe_allowed IS '此庫允許 A7 探針寫入合成資料(拋棄式)';"
--   ⚠️ 對正式站建這張表本身就違反本線紅線(不對正式站跑 DDL)⇒ 這道閘不可能被「順手」通過。
--
-- 🔴 **本檔會對 orders / order_items 插入合成資料(DML,不是 DDL)** ⇒ 只准對拋棄式隔離庫跑。
--    整份包在一個交易裡、結尾 ROLLBACK ⇒ 零可見業務列殘留。
--    ⚠️ **本檔沒有 PC001 sentinel**(關卡2 nit 抓 plan 曾誤寫):A2 那種 `RAISE … ERRCODE='PC001'`
--       是「migration 內要保留後續語句」才需要的技巧;本檔整份就是要丟掉,直接 ROLLBACK 更簡單。
--       負向探針各自的 sub-block 用的是具名 exception handler,與 sentinel 無關。
--    ⚠️ 「零留痕」只能宣稱到「零可見業務列」—— WAL、dead tuple、server log 仍在(誠實邊界)。
-- ============================================================

\set ON_ERROR_STOP on

-- 🔀 codex 關卡2 K2-6:端點閘 —— 白名單標記表/cluster 檢查擋不住「被標記過的遠端 DB」;
-- 本檔只准打本機拋棄式 harness(port 543xx、loopback 或 unix socket)。
-- 🔴 2026-08-05:port 判準由單值 54329 放寬為 543xx 區段 —— 寫死單值讓第二個施工視窗
--    完全跑不了本 probe(B-211-STOP 實錘)。判別力未下降:Supabase direct 5432 /
--    pooler 6543 都不在 543xx,且 loopback 判準與下方 ownership marker 實檢原封不動。
--    ⚠️ 擋不住什麼:有人在本機 543xx 開一個非拋棄庫 —— 但那與硬編 54329 時完全相同。
DO $$
BEGIN
  IF current_setting('port')::int NOT BETWEEN 54300 AND 54399
     OR (inet_server_addr() IS NOT NULL AND host(inet_server_addr()) NOT IN ('127.0.0.1','::1')) THEN
    RAISE EXCEPTION '拒絕執行:僅允許本機拋棄庫 harness(port 543xx/loopback),實際 port=% addr=%',
      current_setting('port'), COALESCE(host(inet_server_addr()), 'unix-socket');
  END IF;
  -- 🔀 codex K2-R2-3:listener 位址證不了用戶端在本機(SSH tunnel 可繞)⇒ 加 server 端實檢:
  -- d1t2 provision 的 ownership marker(.d1t2-harness)就放在 pgdata 上一層,拿它當硬證據。
  -- 誠實界:tunnel 到「完整 d1t2 provision 的遠端複本」仍會過 —— 那本身就是 harness,可接受。
  BEGIN
    PERFORM pg_stat_file(current_setting('data_directory') || '/../.d1t2-harness');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '拒絕執行:data_directory 上層無 .d1t2-harness marker —— 這不是 d1t2 provision 的拋棄式庫';
  END;
END $$;

-- ══ 閘 -1:環境閘(fail-closed;Fable R3 F7 + R4 N4)═══════════════════════════
-- 🔴 閘必須在**本檔內**,不能只做在 shell wrapper —— 否則任何人 `psql -f` 直接跑就繞過了(R4 N4)。
-- 🔴 雙輸入(沿用 D1a0 的守門形狀):
--    ①呼叫端必須明示 `-v a7_allow_dml=yes-throwaway-db`(未傳 ⇒ psql 的 :'var' 會展開成
--      字面 `:a7_allow_dml`、與期望值不符 ⇒ 下面的斷言 RAISE)
--    ②呼叫端必須明示它**以為**自己連到哪個叢集,而 **DB 端自己回讀**實際 system_identifier 比對
--      —— 不信呼叫端轉述的環境(R4 N4 逐字)。不知道 cluster id 就跑不起來 ⇒ 不可能「順手對正式站跑」。
--    ③外加正式站叢集識別碼**黑名單**:那個值就算被當成 expect 傳進來也一律拒。
-- 🔴 psql **不在 dollar-quote($$…$$)內做變數替換** ⇒ :'var' 不能直接寫進 DO body
--    (實測:原樣送到 server、syntax error)。⇒ 先把兩個輸入放進 session GUC,DO block 再讀回。
--    ⚠️ 變數未傳時 psql 會把 :'a7_allow_dml' 原樣留下 ⇒ 此行 syntax error ⇒ 整檔中止 = fail-closed。
SELECT set_config('a7.allow_dml',      :'a7_allow_dml',      false) AS allow_dml,
       set_config('a7.expect_cluster', :'a7_expect_cluster', false) AS expect_cluster;

DO $$
DECLARE
  v_actual  text;
  v_flag    text := current_setting('a7.allow_dml', true);
  v_expect  text := current_setting('a7.expect_cluster', true);
  -- 🔴 正式站叢集識別碼(來源:D1a2 匯出 manifest 與 STATUS.md 逐字記載)。
  --    列黑名單而不是只比對 expect —— 就算有人把這個值當 expect 傳進來,也一律拒。
  v_prod    text := '7632885393857617092';
BEGIN
  SELECT system_identifier::text INTO v_actual FROM pg_control_system();

  IF v_flag IS DISTINCT FROM 'yes-throwaway-db' THEN
    RAISE EXCEPTION '閘 -1 失敗:缺 -v a7_allow_dml=yes-throwaway-db —— 本檔會對 orders / order_items 插入合成資料,拒絕在未明示的環境執行(實得 [%])', COALESCE(v_flag, '(未傳)');
  END IF;
  IF v_expect IS NULL OR v_expect = '' OR v_expect = ':a7_expect_cluster' THEN
    RAISE EXCEPTION '閘 -1 失敗:缺 -v a7_expect_cluster=<system_identifier>。查法:SELECT system_identifier FROM pg_control_system()';
  END IF;
  IF v_actual <> v_expect THEN
    RAISE EXCEPTION '閘 -1 失敗:呼叫端宣稱的叢集 [%] 與實際 [%] 不符 —— 連到的不是你以為的那個庫,拒絕執行',
      v_expect, v_actual;
  END IF;
  IF v_actual = v_prod THEN
    RAISE EXCEPTION '閘 -1 失敗:這是**正式站**叢集(%) —— 本檔會插入合成資料,絕對拒絕', v_actual;
  END IF;

  -- 🔴 **正向白名單(關卡2 must-fix)**:上面三道全是「呼叫端自證 + 正式站黑名單」——
  --    對 staging、邏輯還原庫或任何**共用** DB 傳入它自己的真實 cluster id 就過得去,
  --    然後就在那個庫裡產生 DML、鎖、WAL 與 dead tuple。黑名單只擋得住**我列得出來的**那一個庫。
  -- ⇒ 改成必須有一個**只有拋棄式庫才會有的實體標記**:目標庫裡必須存在 pcm_a7_probe_allowed 這張表。
  --    建它本身是一次刻意的 DDL 行為(而對正式站跑 DDL 本來就違反本線紅線)⇒ 不可能「順手」通過。
  --    建法(只在拋棄式庫執行):
  --      CREATE TABLE public.pcm_a7_probe_allowed (note text);
  --      COMMENT ON TABLE public.pcm_a7_probe_allowed IS '此庫允許 A7 探針寫入合成資料(拋棄式)';
  IF to_regclass('public.pcm_a7_probe_allowed') IS NULL THEN
    RAISE EXCEPTION '閘 -1 失敗:目標庫缺少白名單標記 public.pcm_a7_probe_allowed —— 本檔只准對**刻意標記過的拋棄式庫**執行。cluster=% 通過了黑名單,但沒有正向授權標記(黑名單只擋得住已知的正式站,擋不住 staging 或任何共用庫)', v_actual;
  END IF;

  RAISE NOTICE '閘 -1 通過:cluster=%(非正式站黑名單 + 有白名單標記 pcm_a7_probe_allowed)', v_actual;
END
$$;

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '300s';

DO $$
DECLARE
  v_cnt        integer;
  v_trg        text;
  v_cust       uuid;
  v_order_a    uuid;
  v_order_b    uuid;
  v_order_c    uuid;
  v_item_a1    uuid;
  v_item_a2    uuid;
  v_item_b1    uuid;
  v_canc_a     uuid;
  v_canc_a2    uuid;
  v_canc_b     uuid;
  v_canc_c     uuid;
  v_cname      text;
  v_code       text;
  v_qty        integer;
  v_detail     text;
  v_key        uuid := gen_random_uuid();
  v_hash       text := repeat('a', 64);
  v_pass       integer := 0;
BEGIN
  -- ══ 閘 0:trigger inventory(codex R2)═══════════════════════════════════════
  -- 本檔要合成 orders 列 ⇒ 必須先知道「插進去之後會有什麼東西自動動起來」。
  -- 現況親驗:orders 只有 RF2a-0 那一支 BEFORE INSERT(`20260725120000:104`,純複製 shipping_method
  -- 進快照欄、無其他副作用);order_items 零 trigger。多一支就停 —— 那支可能寫 outbox、可能改值。
  -- ⚠️ **這一閘在 harness 是套套邏輯**(harness 由 migrations 從零建成 ⇒ 永遠相符);
  --    真正的漂移核對是 apply 前對正式站的唯讀 diff(plan §8 步驟 5)。此處不假裝它有跨環境效力。
  SELECT string_agg(tgname, ',' ORDER BY tgname) INTO v_trg
    FROM pg_trigger WHERE tgrelid = 'public.orders'::regclass AND NOT tgisinternal;
  IF v_trg IS DISTINCT FROM 'orders_freeze_shipping_snapshot_bi' THEN
    RAISE EXCEPTION '閘 0 失敗:orders 的 user trigger 集合 = [%],預期恰為 orders_freeze_shipping_snapshot_bi。多出來的 trigger 可能有副作用,合成資料不安全',
      COALESCE(v_trg, '(無)');
  END IF;
  SELECT count(*) INTO v_cnt
    FROM pg_trigger WHERE tgrelid = 'public.order_items'::regclass AND NOT tgisinternal;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '閘 0 失敗:order_items 應零 user trigger,實 % 支', v_cnt;
  END IF;

  -- ══ fixture:3 張合成訂單 + 3 個品項 ═══════════════════════════════════════
  -- 🔴 customer_user_id → customers(user_id) → auth.users(id):**造不出合成客戶是物理限制**
  --    ⇒ 借用既有客戶列。這是本檔對環境的唯一依賴,且是可斷言的硬前提(不是「資料剛好夠」)。
  SELECT user_id INTO v_cust FROM public.customers ORDER BY user_id LIMIT 1;
  IF v_cust IS NULL THEN
    RAISE EXCEPTION 'fixture 失敗:customers 為空,無法合成訂單(customer_user_id 是 NOT NULL + FK 到 customers → auth.users)。這是唯一允許阻擋本檔的前提,**不是**可略過的分支';
  END IF;

  -- display_id:PCM-9999-000X。**不呼叫 nextval** ⇒ 不佔號、不推進 order_display_seq。
  -- 9999 年不可能被舊產號器產出(它用當年年份)、新產號器只產 6 碼 ⇒ 型式上不可能撞;仍當場斷言不存在。
  SELECT count(*) INTO v_cnt FROM public.orders
   WHERE display_id IN ('PCM-9999-0001', 'PCM-9999-0002', 'PCM-9999-0003');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'fixture 失敗:合成 display_id 已存在 % 筆(不該發生)', v_cnt;
  END IF;

  -- 🔴 shipping_method_at_checkout **刻意不列**:它是 NOT NULL 且無 default,由 RF2a-0 的
  --    BEFORE INSERT trigger 從 shipping_method 補上。插得進去就同時證明那支 trigger 活著。
  INSERT INTO public.orders
    (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
     subtotal, shipping_fee, total, shipping_method, invoice)
  VALUES
    ('PCM-9999-0001', v_cust,
     jsonb_build_object('name', 'A7 探針', 'phone', '0900000000', 'line', '測試地址'),
     'general'::public.member_tier, 3000, 100, 3100, 'home',
     jsonb_build_object('type', 'personal'))
  RETURNING id INTO v_order_a;

  INSERT INTO public.orders
    (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
     subtotal, shipping_fee, total, shipping_method, invoice)
  VALUES
    ('PCM-9999-0002', v_cust,
     jsonb_build_object('name', 'A7 探針', 'phone', '0900000000', 'line', '測試地址'),
     'general'::public.member_tier, 500, 100, 600, 'home',
     jsonb_build_object('type', 'personal'))
  RETURNING id INTO v_order_b;

  -- 🔴 C 單刻意**零 order_items**(Fable R3 F3):探針 29 要證明「header FK 擋得住刪單」,
  --    而 order_items.order_id → orders 是 **CASCADE**(`20260604120000:141`)
  --    ⇒ 若用有品項的 A 單,刪除會先級聯刪 items、再撞 items 側的 RESTRICT,
  --      先報哪一支 FK 由內部 trigger 的 OID 序決定 = 斷言變成不確定(假紅或被迫放寬)。
  --      C 單零品項 ⇒ 級聯無列可刪 ⇒ **唯一能觸發的就是 header 的 order_id FK**。
  INSERT INTO public.orders
    (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
     subtotal, shipping_fee, total, shipping_method, invoice)
  VALUES
    ('PCM-9999-0003', v_cust,
     jsonb_build_object('name', 'A7 探針', 'phone', '0900000000', 'line', '測試地址'),
     'general'::public.member_tier, 0, 0, 0, 'store',
     jsonb_build_object('type', 'personal'))
  RETURNING id INTO v_order_c;

  -- 驗 trigger 真的補上了快照欄(順手把「插得進去」升級成「補對了」)
  SELECT count(*) INTO v_cnt FROM public.orders
   WHERE id IN (v_order_a, v_order_b) AND shipping_method_at_checkout = 'home';
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'fixture 失敗:RF2a-0 trigger 未把 shipping_method 複製進快照欄(實 % / 2)', v_cnt;
  END IF;

  -- product_snapshot 必須是 exact {title,sku,spec}、spec 值全字串、且不含 price_store/price_by_tier/cost
  INSERT INTO public.order_items
    (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order_a, 'A7-SKU-1',
          jsonb_build_object('title', 'A7 探針商品 1', 'sku', 'A7-SKU-1',
                             'spec', jsonb_build_object('color', 'black')),
          2, 1000, 2000)
  RETURNING id INTO v_item_a1;

  -- 🔀 2026-08-03 A4a 修訂(Sean Q2=A):qty 1 → 1000001 —— A4a 通電 oiqs CHECK 網後,
  --    探針 25 的 1000000 必須落在品項數量之內(斷言原文不動、反 clamp 判別力保留);
  --    「超量取消被擋」的行為證明移到探針 32(真打);單價/金額歸零以滿足 line_balances CHECK。
  INSERT INTO public.order_items
    (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order_a, 'A7-SKU-2',
          jsonb_build_object('title', 'A7 探針商品 2', 'sku', 'A7-SKU-2',
                             'spec', jsonb_build_object('color', 'red')),
          1000001, 0, 0)
  RETURNING id INTO v_item_a2;

  INSERT INTO public.order_items
    (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order_b, 'A7-SKU-3',
          jsonb_build_object('title', 'A7 探針商品 3', 'sku', 'A7-SKU-3',
                             'spec', jsonb_build_object('color', 'blue')),
          1, 500, 500)
  RETURNING id INTO v_item_b1;

  RAISE NOTICE 'fixture 就緒:3 張合成單(A 2 品項 / B 1 品項 / C 0 品項)+ 借用客戶 %', v_cust;

  -- ══ 探針 1-7:七個 reason_code **逐值正向**(codex R1 #8)═════════════════════
  -- 🔴 這是 R1 最準的一擊:只測「非法值被擋」的話,一個只允許 customer_request 的 CHECK
  --    也會讓整組驗收通過。⇒ 七個值各寫一次,逐一 assert 真的寫進去了(不是「沒紅」)。
  FOREACH v_code IN ARRAY ARRAY['customer_request', 'out_of_stock', 'long_leadtime',
                                'price_change', 'duplicate_order', 'internal_error'] LOOP
    INSERT INTO public.order_cancellations
      (order_id, reason_code, idempotency_key, payload_hash, actor)
    VALUES (v_order_a, v_code, gen_random_uuid(), v_hash, 'sean');
    SELECT count(*) INTO v_cnt FROM public.order_cancellations
     WHERE order_id = v_order_a AND reason_code = v_code;
    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '探針 1-6 失敗:合法 reason_code [%] 寫不進去(讀回 % 列)', v_code, v_cnt;
    END IF;
    v_pass := v_pass + 1;
  END LOOP;

  -- 探針 7 + 8:other 必須配非空白 detail(§5.1d 手寫必填);逐一讀回確認值沒被改掉
  INSERT INTO public.order_cancellations
    (order_id, reason_code, reason_detail, idempotency_key, payload_hash, actor)
  VALUES (v_order_a, 'other', '客人來電說要改買別台車的件', gen_random_uuid(), v_hash, 'sean');
  SELECT reason_detail INTO v_detail FROM public.order_cancellations
   WHERE order_id = v_order_a AND reason_code = 'other';
  IF v_detail IS DISTINCT FROM '客人來電說要改買別台車的件' THEN
    RAISE EXCEPTION '探針 7-8 失敗:other + 非空白 detail 的正向路徑不成立(讀回 [%])', COALESCE(v_detail, '(NULL)');
  END IF;
  v_pass := v_pass + 2;

  -- ══ 探針 9-19:負向(每條各自精確比對 CONSTRAINT_NAME)═══════════════════════
  -- 探針 9:第 8 個 code
  BEGIN
    INSERT INTO public.order_cancellations
      (order_id, reason_code, idempotency_key, payload_hash, actor)
    VALUES (v_order_a, 'boss_changed_mind', gen_random_uuid(), v_hash, 'sean');
    RAISE EXCEPTION '探針 9 失敗:allowlist 外的 reason_code 竟被接受';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname <> 'order_cancellations_reason_code_check' THEN
      RAISE EXCEPTION '探針 9 失敗:被非預期約束擋下 [%]', v_cname;
    END IF;
    v_pass := v_pass + 1;
  END;

  -- 探針 10-12:other 但 detail 為 NULL / 純空白(含全形)/ 純零寬
  FOREACH v_detail IN ARRAY ARRAY[NULL, '　  ', U&'\200B\200C'] LOOP
    BEGIN
      INSERT INTO public.order_cancellations
        (order_id, reason_code, reason_detail, idempotency_key, payload_hash, actor)
      VALUES (v_order_a, 'other', v_detail, gen_random_uuid(), v_hash, 'sean');
      RAISE EXCEPTION '探針 10-12 失敗:other 竟可搭配空白/NULL 的 detail [%]', COALESCE(v_detail, '(NULL)');
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'order_cancellations_reason_detail_rule' THEN
        RAISE EXCEPTION '探針 10-12 失敗:被非預期約束擋下 [%]', v_cname;
      END IF;
      v_pass := v_pass + 1;
    END;
  END LOOP;

  -- 探針 13:非 other 卻帶 detail(雙向 CHECK 的另一半 —— 拆兩條 CHECK 就會漏掉這邊)
  BEGIN
    INSERT INTO public.order_cancellations
      (order_id, reason_code, reason_detail, idempotency_key, payload_hash, actor)
    VALUES (v_order_a, 'out_of_stock', '這段文字不該存在', gen_random_uuid(), v_hash, 'sean');
    RAISE EXCEPTION '探針 13 失敗:非 other 的 code 竟可帶 reason_detail';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname <> 'order_cancellations_reason_detail_rule' THEN
      RAISE EXCEPTION '探針 13 失敗:被非預期約束擋下 [%]', v_cname;
    END IF;
    v_pass := v_pass + 1;
  END;

  -- 探針 14-16:payload_hash 長度不足 / 大寫 hex / 非 hex
  FOREACH v_detail IN ARRAY ARRAY[repeat('a', 63), repeat('A', 64), repeat('g', 64)] LOOP
    BEGIN
      INSERT INTO public.order_cancellations
        (order_id, reason_code, idempotency_key, payload_hash, actor)
      VALUES (v_order_a, 'customer_request', gen_random_uuid(), v_detail, 'sean');
      RAISE EXCEPTION '探針 14-16 失敗:非法 payload_hash 竟被接受 [%]', left(v_detail, 8);
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'order_cancellations_payload_hash_shape' THEN
        RAISE EXCEPTION '探針 14-16 失敗:被非預期約束擋下 [%]', v_cname;
      END IF;
      v_pass := v_pass + 1;
    END;
  END LOOP;

  -- 探針 17:非 slug 形狀的 actor 被擋下。
  -- 🔴 **本探針的語意被自己的突變測試改寫過**:原本它斷言「被 actor 形狀 CHECK 擋下」,
  --    但突變(拿掉那條 CHECK)之後本探針**照樣綠** —— 因為任何非 slug 值必然也不在 staff 裡,
  --    FK 先擋下、拿到的是 foreign_key_violation。兩道約束互相遮蔽 ⇒ 那條 CHECK 的獨立效力
  --    原理上無法證明(FK 要求 actor ∈ staff.id,而 staff 自帶 staff_id_format)
  --    ⇒ **該 CHECK 已從 A7-1 移除**,本探針改為斷言真正在保護我們的那道 = actor FK。
  -- ⚠️ 本探針與探針 18 都打 actor FK,但角度不同(非 slug 形狀 vs slug 形狀但不存在)——
  --    這是刻意的:它明文記錄「兩種壞 actor 都靠 FK 擋」,而不是靠一條測不到的形狀 CHECK。
  BEGIN
    INSERT INTO public.order_cancellations
      (order_id, reason_code, idempotency_key, payload_hash, actor)
    VALUES (v_order_a, 'customer_request', gen_random_uuid(), v_hash, 'Sean Hung');
    RAISE EXCEPTION '探針 17 失敗:非 slug 形狀的 actor 竟被接受';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname <> 'order_cancellations_actor_fkey' THEN
      RAISE EXCEPTION '探針 17 失敗:被非預期約束擋下 [%]', v_cname;
    END IF;
    v_pass := v_pass + 1;
  END;

  -- 探針 18:形狀合法但不在 staff(FK 的責任)
  BEGIN
    INSERT INTO public.order_cancellations
      (order_id, reason_code, idempotency_key, payload_hash, actor)
    VALUES (v_order_a, 'customer_request', gen_random_uuid(), v_hash, 'ghost_staff');
    RAISE EXCEPTION '探針 18 失敗:不存在的 staff slug 竟被接受';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname <> 'order_cancellations_actor_fkey' THEN
      RAISE EXCEPTION '探針 18 失敗:被非預期約束擋下 [%]', v_cname;
    END IF;
    v_pass := v_pass + 1;
  END;

  -- 探針 19:同一張單同一個冪等鍵不得重複
  INSERT INTO public.order_cancellations
    (order_id, reason_code, idempotency_key, payload_hash, actor)
  VALUES (v_order_a, 'customer_request', v_key, v_hash, 'sean')
  RETURNING id INTO v_canc_a;
  BEGIN
    INSERT INTO public.order_cancellations
      (order_id, reason_code, idempotency_key, payload_hash, actor)
    VALUES (v_order_a, 'out_of_stock', v_key, v_hash, 'sean');
    RAISE EXCEPTION '探針 19 失敗:同單同冪等鍵竟可寫兩列(§5.1b 的防護等於沒有)';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname <> 'order_cancellations_idempotency_key' THEN
      RAISE EXCEPTION '探針 19 失敗:被非預期約束擋下 [%]', v_cname;
    END IF;
    v_pass := v_pass + 1;
  END;

  -- ══ 探針 20:冪等鍵的範圍是「單內」而非全域 ═══════════════════════════════
  -- 不同單共用同一個鍵必須合法 —— 否則兩個客人的取消畫面撞到同一個 uuid 就會有一個人取消不了。
  INSERT INTO public.order_cancellations
    (order_id, reason_code, idempotency_key, payload_hash, actor)
  VALUES (v_order_b, 'customer_request', v_key, v_hash, 'sean')
  RETURNING id INTO v_canc_b;
  IF v_canc_b IS NULL THEN
    RAISE EXCEPTION '探針 20 失敗:不同單共用同一冪等鍵竟被擋(冪等鍵被誤設成全域唯一)';
  END IF;
  v_pass := v_pass + 1;

  -- ══ 探針 21-25:items 的行為 ═══════════════════════════════════════════════
  -- 探針 21:同一次取消不得重複列同一品項
  INSERT INTO public.order_cancellation_items
    (cancellation_id, order_id, order_item_id, cancelled_quantity)
  VALUES (v_canc_a, v_order_a, v_item_a1, 1);
  BEGIN
    INSERT INTO public.order_cancellation_items
      (cancellation_id, order_id, order_item_id, cancelled_quantity)
    VALUES (v_canc_a, v_order_a, v_item_a1, 1);
    RAISE EXCEPTION '探針 21 失敗:同一次取消竟可重複列同一品項';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname <> 'order_cancellation_items_cancellation_item_key' THEN
      RAISE EXCEPTION '探針 21 失敗:被非預期約束擋下 [%]', v_cname;
    END IF;
    v_pass := v_pass + 1;
  END;

  -- 探針 22:同一張單第二個 header,**且重複列第一個 header 已列過的同一品項**(Fable R4 N6 寫死)
  -- 🔴 這才是「部分取消可分次」的行為證明 —— 若 UNIQUE 被誤寫成 (order_id, order_item_id),
  --    第二次取消同一品項就會被擋,而那個錯誤在結構字面比對之外看不出業務後果。
  INSERT INTO public.order_cancellations
    (order_id, reason_code, idempotency_key, payload_hash, actor)
  VALUES (v_order_a, 'customer_request', gen_random_uuid(), v_hash, 'staff_1')
  RETURNING id INTO v_canc_a2;
  INSERT INTO public.order_cancellation_items
    (cancellation_id, order_id, order_item_id, cancelled_quantity)
  VALUES (v_canc_a2, v_order_a, v_item_a1, 1);
  SELECT count(*) INTO v_cnt FROM public.order_cancellation_items
   WHERE order_item_id = v_item_a1;
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION '探針 22 失敗:同一品項跨兩次取消應有 2 列(部分取消分次),實 % 列', v_cnt;
  END IF;
  v_pass := v_pass + 1;

  -- 探針 23-24:數量 0 與負數
  FOREACH v_qty IN ARRAY ARRAY[0, -1] LOOP
    BEGIN
      INSERT INTO public.order_cancellation_items
        (cancellation_id, order_id, order_item_id, cancelled_quantity)
      VALUES (v_canc_a, v_order_a, v_item_a2, v_qty);
      RAISE EXCEPTION '探針 23-24 失敗:cancelled_quantity 竟可為 %', v_qty;
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'order_cancellation_items_quantity_positive' THEN
        RAISE EXCEPTION '探針 23-24 失敗:被非預期約束擋下 [%]', v_cname;
      END IF;
      v_pass := v_pass + 1;
    END;
  END LOOP;

  -- 🔴 探針 25:大數量正向(Fable R3 F2 —— 守護「刪掉上限」這條修法)
  --    照抄 A2 的 `BETWEEN 1 AND 100000` 會讓這條轉紅。
  --    🔴 **讀回寫入值**(Fable R4 N6):只 assert「沒紅」的話,一支 clamp trigger 把值改成 100000
  --    也會看起來綠 —— 必須證明存進去的就是我寫的那個數。
  INSERT INTO public.order_cancellation_items
    (cancellation_id, order_id, order_item_id, cancelled_quantity)
  VALUES (v_canc_a2, v_order_a, v_item_a2, 1000000);
  SELECT cancelled_quantity INTO v_qty FROM public.order_cancellation_items
   WHERE cancellation_id = v_canc_a2 AND order_item_id = v_item_a2;
  IF v_qty IS DISTINCT FROM 1000000 THEN
    RAISE EXCEPTION '探針 25 失敗:大數量取消寫不進去或被改值(讀回 [%];照抄 A2 的 100000 上限會讓本條轉紅)',
      COALESCE(v_qty::text, '(NULL)');
  END IF;
  v_pass := v_pass + 1;

  -- ══ 探針 26-29:跨單封鎖 —— 兩道複合 FK **各自**獨立證明 ═══════════════════
  -- 🔴 Fable R3 F3 / codex R2:單一「跨單」探針可能只觸發其中一道 FK,另一道等於沒被驗過。
  -- 探針 26:只觸發 cancellation 側 —— header 屬 A 單,卻宣稱 order_id = B
  BEGIN
    INSERT INTO public.order_cancellation_items
      (cancellation_id, order_id, order_item_id, cancelled_quantity)
    VALUES (v_canc_a, v_order_b, v_item_b1, 1);
    RAISE EXCEPTION '探針 26 失敗:A 單的 header 竟可掛到 B 單(跨單封鎖不成立)';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname <> 'order_cancellation_items_cancellation_fk' THEN
      RAISE EXCEPTION '探針 26 失敗:預期 cancellation 複合 FK 擋下,實際是 [%]', v_cname;
    END IF;
    v_pass := v_pass + 1;
  END;

  -- 探針 27:只觸發 order_item 側 —— header 與 order_id 皆 A,品項卻是 B 單的
  BEGIN
    INSERT INTO public.order_cancellation_items
      (cancellation_id, order_id, order_item_id, cancelled_quantity)
    VALUES (v_canc_a, v_order_a, v_item_b1, 1);
    RAISE EXCEPTION '探針 27 失敗:A 單的取消竟可掛 B 單的品項';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname <> 'order_cancellation_items_order_item_fk' THEN
      RAISE EXCEPTION '探針 27 失敗:預期 order_item 複合 FK 擋下,實際是 [%]', v_cname;
    END IF;
    v_pass := v_pass + 1;
  END;

  -- 探針 28:不存在的 order_id 進 header
  BEGIN
    INSERT INTO public.order_cancellations
      (order_id, reason_code, idempotency_key, payload_hash, actor)
    VALUES (gen_random_uuid(), 'customer_request', gen_random_uuid(), v_hash, 'sean');
    RAISE EXCEPTION '探針 28 失敗:不存在的 order_id 竟可建立取消紀錄';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname <> 'order_cancellations_order_id_fkey' THEN
      RAISE EXCEPTION '探針 28 失敗:被非預期約束擋下 [%]', v_cname;
    END IF;
    v_pass := v_pass + 1;
  END;

  -- 🔴 探針 29:有 header 的訂單刪不掉 —— **必須用零品項的 C 單**(Fable R3 F3)
  INSERT INTO public.order_cancellations
    (order_id, reason_code, idempotency_key, payload_hash, actor)
  VALUES (v_order_c, 'duplicate_order', gen_random_uuid(), v_hash, 'sean')
  RETURNING id INTO v_canc_c;
  SELECT count(*) INTO v_cnt FROM public.order_items WHERE order_id = v_order_c;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '探針 29 前提失敗:C 單應零品項(否則 CASCADE 到 order_items 會讓斷言取到不確定的 FK),實 % 列', v_cnt;
  END IF;
  BEGIN
    DELETE FROM public.orders WHERE id = v_order_c;
    RAISE EXCEPTION '探針 29 失敗:有取消紀錄的訂單竟可被刪(取消事實會無聲消失)';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname <> 'order_cancellations_order_id_fkey' THEN
      RAISE EXCEPTION '探針 29 失敗:預期 header 的 order_id FK 擋下,實際是 [%]', v_cname;
    END IF;
    v_pass := v_pass + 1;
  END;

  -- ══ 探針 30-31:子表的 RESTRICT 真的生效 ═══════════════════════════════════
  -- 探針 30:有明細的 header 刪不掉
  BEGIN
    DELETE FROM public.order_cancellations WHERE id = v_canc_a;
    RAISE EXCEPTION '探針 30 失敗:有明細的取消 header 竟可被刪';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname <> 'order_cancellation_items_cancellation_fk' THEN
      RAISE EXCEPTION '探針 30 失敗:被非預期約束擋下 [%]', v_cname;
    END IF;
    v_pass := v_pass + 1;
  END;

  -- 探針 31:被明細引用的 order_items 列刪不掉
  BEGIN
    DELETE FROM public.order_items WHERE id = v_item_a1;
    RAISE EXCEPTION '探針 31 失敗:被取消明細引用的品項竟可被刪';
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname <> 'order_cancellation_items_order_item_fk' THEN
      RAISE EXCEPTION '探針 31 失敗:被非預期約束擋下 [%]', v_cname;
    END IF;
    v_pass := v_pass + 1;
  END;

  -- ══ 探針 32:🔀 2026-08-03 依 A4a 重寫(本條自帶的預告兌現;Sean Q2=A + codex R2 加嚴)═══
  -- 原版證「超量取消寫得進去 = 本片未鎖跨列不變式」;A4a 通電 A1 CHECK 網後該狀態不可構造
  -- ⇒ 翻面成**真打**:超量取消必須被 23514/oiqs 精確擋下(只改敘述不算證明)。
  -- 前半(order_items 無 cancelled_quantity 欄)仍為真:A1 v2 落點是獨立摘要表、不是 order_items。
  SELECT count(*) INTO v_cnt FROM pg_attribute
   WHERE attrelid = 'public.order_items'::regclass
     AND attname = 'cancelled_quantity' AND attnum > 0 AND NOT attisdropped;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '探針 32 失敗:order_items.cancelled_quantity 竟存在(A1 v2 落點是 order_item_quantity_summary,不是 order_items)';
  END IF;
  -- 真打:a2 已累積 1000000,再取消 2 會跨過 quantity=1000001 ⇒ A4a 重算 → oiqs CHECK 擋
  BEGIN
    INSERT INTO public.order_cancellation_items
      (cancellation_id, order_id, order_item_id, cancelled_quantity)
    VALUES (v_canc_a, v_order_a, v_item_a2, 2);
    RAISE EXCEPTION '探針 32 失敗:超量取消竟放行(A4a 的上界沒通電?)';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname <> 'oiqs_cancelled_le_quantity' THEN
      RAISE EXCEPTION '探針 32 失敗:被非預期 CHECK 擋下 [%](預期 oiqs_cancelled_le_quantity)', v_cname;
    END IF;
    v_pass := v_pass + 1;
  END;

  -- ══ 探針 33:零殘留(交易外由 wrapper 再驗一次)══════════════════════════════
  -- 本探針在交易內只能驗「合成的東西都在預期的位置」;真正的零殘留由結尾 ROLLBACK 保證,
  -- 並由呼叫端在交易結束後重數(見檔尾)。
  SELECT count(*) INTO v_cnt FROM public.orders
   WHERE display_id IN ('PCM-9999-0001', 'PCM-9999-0002', 'PCM-9999-0003');
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION '探針 33 失敗:合成訂單應為 3 張,實 %', v_cnt;
  END IF;
  v_pass := v_pass + 1;

  -- ══ 探針 34-36:三個「渲染全白但不屬 POSIX 空白類」的碼位 ═══════════════════
  -- 🔴 這三條是**本片施工時實測發現 `[[:space:]]` 依 locale 而異**之後才加的(Fable R3 點名了它們,
  --    當時被我列成「不宣稱窮盡」的殘面;改成明列碼位之後它們就進得了清單 ⇒ 必須實際證明擋得住,
  --    不能只在註解裡宣稱已涵蓋)。
  -- 🔴 **刻意編在最後、不插進探針 10-12 那一組** —— 插進去會讓後面所有編號位移,
  --    而 plan §2 的突變預期紅名單是按編號寫的(Fable R4 N1 就是我上一次改編號沒同步引用它的那節)。
  FOREACH v_detail IN ARRAY ARRAY[U&'\00AD', U&'\2800', U&'\3164'] LOOP
    BEGIN
      INSERT INTO public.order_cancellations
        (order_id, reason_code, reason_detail, idempotency_key, payload_hash, actor)
      VALUES (v_order_a, 'other', v_detail, gen_random_uuid(), v_hash, 'sean');
      RAISE EXCEPTION '探針 34-36 失敗:渲染全白的碼位 U+% 竟被當成有效手寫文字',
        upper(to_hex(ascii(v_detail)));
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'order_cancellations_reason_detail_rule' THEN
        RAISE EXCEPTION '探針 34-36 失敗:被非預期約束擋下 [%]', v_cname;
      END IF;
      v_pass := v_pass + 1;
    END;
  END LOOP;

  IF v_pass <> 36 THEN
    RAISE EXCEPTION 'A7-2 失敗:通過的探針數 = %,預期 36(有探針被跳過 —— 這比任何一條紅更危險)', v_pass;
  END IF;

  RAISE NOTICE 'A7-2 行為驗收全數通過:36 / 36 條探針(含 7 個 reason_code 逐值正向、兩道複合 FK 各自獨立證明、大數量正向讀回、三個渲染全白碼位)';
END
$$;

-- 🔴 整份 rollback:本檔對 live 表插過合成資料,絕不留下。
ROLLBACK;

-- ══ 交易外的零殘留複驗(交易內驗不了自己的 rollback)═══════════════════════════
DO $$
DECLARE v_cnt integer;
BEGIN
  SELECT count(*) INTO v_cnt FROM public.orders
   WHERE display_id IN ('PCM-9999-0001', 'PCM-9999-0002', 'PCM-9999-0003');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7-2 零殘留失敗:合成訂單殘留 % 張(ROLLBACK 沒生效)', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.order_cancellations;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7-2 零殘留失敗:order_cancellations 殘留 % 列', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.order_cancellation_items;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A7-2 零殘留失敗:order_cancellation_items 殘留 % 列', v_cnt;
  END IF;
  RAISE NOTICE 'A7-2 零殘留複驗通過(合成訂單 0 / 兩張新表各 0);⚠️ 只宣稱「零可見業務列」—— WAL 與 dead tuple 仍在';
END
$$;
