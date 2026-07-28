-- ============================================================
-- M-4b E10 第 1 批 · A2:order_item_procurement(採購真相表)
-- ============================================================
-- 規格:docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md §5.1 表第 22 列(A2)、
--       §1 原則 2(模型先於欄位)、§1 原則 3(客人讀得到的表不放內部資料)、
--       §4 折入表 UX §2 #5 / #7 / #9、U6(缺貨只做告知義務)。
-- 片型 M(純 schema;**零 trigger、零 DB 函式** —— 那些是 T 型,見 §1 原則 1 的 R6 修正)。
--
-- 這張表是「向供應商採購」這件事的**真相**。在它存在之前,order_items 不准長出
-- ordered_quantity / instock_quantity 這兩個計數器(§1 原則 2:欄位不得早於它的模型)。
-- ⇒ 本片**必須排在 A1 之前**,§5.0 DAG 已定序。
--
-- 🔴 為什麼一個 order_item 可以有多列(1:N):同一個品項可能拆給兩家供應商各出幾件
--    (v1 就是因為把供應商塞在品項層,表達不了這件事 —— §0 的三個結構性錯誤之二)。
--
-- 🔴 原則 3:供應商名稱、供應商單號、異常原因**一個 byte 都不能進 orders / order_items**,
--    那兩張表對登入客人整表開放 SELECT(`20260604120000_m3_s2a_orders_order_items.sql:190-191`)。
--    對代購生意而言,洩漏上游 = 客人可以直接繞過 PCM。⇒ 本表 service_role only + RLS zero-policy。
--
-- 🔴 寫入一律走 owner RPC(A5a),本表不對任何 role 開放寫權。
--    `supplier_canonical_key` 由 A5b 的 SQL 函式在 DB 內算(本片只建欄,函式在 A5b 才存在)。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.order_item_procurement (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 🔴 ON DELETE RESTRICT(不是 CASCADE):採購事實是真相,不得因為刪一張單就無聲消失。
  --    CASCADE 會讓供應商單號、到貨數量、異常原因一起蒸發 —— 那正是半年後翻帳要看的東西。
  --    D1c 刪 26 張假單排在本片【之前】(§5.0 DAG),所以不需要靠 CASCADE 幫忙清。
  --    未來若第 3 批的改單流程要刪品項,必須先明確處理採購紀錄,不能靜默帶走。
  order_item_id           uuid        NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,

  -- 供應商:顯示值原樣保存,比對一律用 canonical key(A5b 的 SQL 函式產;UX §2 #9 正規化)
  supplier_name           text        NOT NULL,
  supplier_canonical_key  text        NOT NULL,

  -- 🔴 兩個數量欄缺一不可(R3/R4 兩次抓):
  --    只有 allocated 的話,instock_quantity 沒有任何來源可以推導。
  allocated_quantity      integer     NOT NULL,
  received_quantity       integer     NOT NULL DEFAULT 0,

  -- 採購事實(UX §2 #5)
  contact_channel         text,
  submitted_at            timestamptz,
  supplier_order_no       text,
  reply_status            text        NOT NULL DEFAULT 'no_reply',
  exception_reason        text,
  expected_arrival_date   date,

  -- 時間軸:first_ordered_at 僅首寫、status_changed_at 每次更新(合約在 A5a)
  first_ordered_at        timestamptz,
  status_changed_at       timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),

  -- ── 約束 ────────────────────────────────────────────────
  -- 🔴 upsert 業務鍵:同一品項同一家供應商只有一列(A5a 的冪等重放靠它)
  CONSTRAINT order_item_procurement_business_key
    UNIQUE (order_item_id, supplier_canonical_key),

  -- 數量上下界(R6 補負值與上限):allocated 至少 1(建了卻負責 0 件沒有意義)
  CONSTRAINT order_item_procurement_allocated_range
    CHECK (allocated_quantity BETWEEN 1 AND 100000),
  -- 到貨數不可超過這筆採購負責的件數
  CONSTRAINT order_item_procurement_received_range
    CHECK (received_quantity BETWEEN 0 AND allocated_quantity),

  -- 供應商欄非空白(空白名稱會變成「看起來有供應商、其實沒有」的假資料)
  CONSTRAINT order_item_procurement_supplier_name_nonempty
    CHECK (pg_catalog.btrim(supplier_name) <> ''),
  CONSTRAINT order_item_procurement_canonical_key_nonempty
    CHECK (pg_catalog.btrim(supplier_canonical_key) <> ''),

  -- 回覆狀態 allowlist(UX §2 #5 逐字:未回 / 已確認 / 改價 / 缺貨 / 部分出貨)
  CONSTRAINT order_item_procurement_reply_status_check
    CHECK (reply_status IN ('no_reply', 'confirmed', 'price_changed', 'out_of_stock', 'partial')),

  -- 供應商單號非空白且前後無空白(NULL 可以 = 還沒拿到單號;空字串不行 = 假裝有)。
  -- 🔴 存 ' SO-123 ' 進來,用 'SO-123' 等值搜尋就會漏單(A9b2 的跨單搜尋靠等值)。
  -- 🔴 用 [[:space:]] 而不是 btrim:btrim 預設只剝 U+0020,**剝不掉全形空白 U+3000 與 tab**,
  --    而中文輸入法打出全形空白極常見 —— 那正是本條要防的病灶(Fable 復審 F1)。
  CONSTRAINT order_item_procurement_supplier_order_no_nonempty
    CHECK (
      supplier_order_no IS NULL
      OR supplier_order_no ~ '^[^[:space:]]([^[:space:]]|.*[^[:space:]])?$'
    ),

  -- 異常原因非空白(同上;U6 的缺貨告知靠這欄記「為什麼要等」)
  CONSTRAINT order_item_procurement_exception_reason_nonempty
    CHECK (exception_reason IS NULL OR pg_catalog.btrim(exception_reason) <> ''),

  -- 聯絡管道非空白
  CONSTRAINT order_item_procurement_contact_channel_nonempty
    CHECK (contact_channel IS NULL OR pg_catalog.btrim(contact_channel) <> '')
);

COMMENT ON TABLE public.order_item_procurement IS
  'M-4b E10 A2:向供應商採購的真相表(每個 order_item 可有多列 = 同一品項拆給多家供應商)。order_items 的 ordered_quantity / instock_quantity 由本表明細推導(A4a trigger),不得手填。🔴 service_role only:供應商名稱與單號絕不進 orders / order_items(那兩張表對登入客人整表開放 SELECT,洩漏上游等於讓客人繞過 PCM)。';

COMMENT ON COLUMN public.order_item_procurement.allocated_quantity IS
  '這筆採購負責幾件。同一 order_item 的各列合計不得超過「品項數量 − 已取消數量」—— 跨列總量守門是 A2b1 的 constraint trigger(單列 CHECK 看不到別列)。';
COMMENT ON COLUMN public.order_item_procurement.received_quantity IS
  '這筆採購實際到貨幾件。order_items.instock_quantity 的唯一來源;少了這一欄,到貨數就無從推導(R3/R4 兩次抓到的漏)。';
COMMENT ON COLUMN public.order_item_procurement.supplier_canonical_key IS
  '供應商比對鍵,由 A5b 的 SQL 函式 pcm_supplier_canonical_key() 在 DB 內產(trim / 全半形歸一 / 大小寫歸一 / 連續空白收斂)。顯示一律用 supplier_name 原值,比對一律用本欄。呼叫端不得自算。';
-- ── 🟡 已知合約債(codex 關卡2 R1 提出,刻意不在本片解)────────────────
-- ① DB 尚未強制 supplier_canonical_key = A5b 函式對 supplier_name 的輸出。
--    A5b(SQL 函式)排在本片之後,現在寫不了那條 CHECK。⇒ 唯一 writer A5a 必須
--    「只收顯示值、key 由 SQL 內呼叫 A5b 產」,呼叫端不得自帶 key(A5a 片的驗收條件)。
--    未來若改了正規化算法,舊列的 key 要一起重算,否則同一家供應商會出現兩列。
-- ② 本表只記到貨【累計數】,沒有 received_at / received_by 也沒有逐批到貨明細。
--    同一筆採購分兩批到貨時,回答不了「哪一批、什麼時候、誰登錄的」。
--    規格 §5.1 A2 的欄位清單本來就沒有這兩欄 ⇒ 不在本片自行擴充範圍,列為決策題交 Sean。

COMMENT ON COLUMN public.order_item_procurement.reply_status IS
  '供應商回覆狀態:no_reply 未回 / confirmed 已確認 / price_changed 改價 / out_of_stock 缺貨 / partial 部分出貨(UX §2 #5)。';
COMMENT ON COLUMN public.order_item_procurement.exception_reason IS
  '採購異常原因(U6 缺貨告知義務的「為什麼要等」)。🔴 內部資料,絕不對客;告知客人的紀錄另走 order_notes。';

-- 依供應商單號跨單搜尋(A9b2 的讀取路徑;UX §2 #7 到貨登錄要靠它找單)。
-- 🔴 A9b2 的搜尋語意在此定死:**對 upper(trim(輸入)) 做等值比對**。
--    供應商單號常被抄成大小寫不一(有人打 so-123、有人打 SO-123),只做原值等值會漏單;
--    改用 ILIKE/contains 又會全表掃。⇒ 建 upper() 函式索引,搜尋端照同一個表達式查。
CREATE INDEX order_item_procurement_supplier_order_no_upper_idx
  ON public.order_item_procurement (pg_catalog.upper(supplier_order_no))
  WHERE supplier_order_no IS NOT NULL;

-- 依供應商彙總(到貨登錄畫面依供應商分組)
CREATE INDEX order_item_procurement_canonical_key_idx
  ON public.order_item_procurement (supplier_canonical_key);

-- ── ACL:service_role only + RLS zero-policy ────────────────
-- 樣板 = 20260725130100 order_refunds(RLS 縱深 + 全 REVOKE + 精準 GRANT)。
-- 寫入一律走 owner RPC(A5a,SECURITY DEFINER 由表擁有者執行、不需要 role 權限)。
ALTER TABLE public.order_item_procurement ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.order_item_procurement FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.order_item_procurement TO service_role;

-- ── 收工驗收(fail-closed;任一條不成立 = 整片回滾)──────────────
DO $$
DECLARE
  v_cnt        integer;
  v_def        text;
  v_cname      text;
  v_probe_item uuid;
  v_probe_id   uuid;
BEGIN
  -- 1. RLS 已開且為 zero-policy。
  --    🔴 誠實說明:service_role 具 BYPASSRLS,policy 對它根本不執行 ⇒ RLS 在這張表
  --    **擋不住 service_role**,真正的防線是 ACL(它只有 SELECT)與金鑰保密。
  --    RLS 的價值是縱深:日後有人誤 GRANT 給 anon/authenticated 時,zero-policy 仍然全拒。
  --    ⚠️ table owner 同樣不受 RLS 擋(本表刻意不加 FORCE ROW LEVEL SECURITY ——
  --       加了會把 A5a 這支 owner RPC 自己弄斷)。
  --    ⚠️ 本斷言的天花板:role 繼承(某 role 被加進 service_role)與 pg_read_all_data
  --       這類叢集層授權**不在 relacl 裡**,表層斷言物理上看不到,不要誤以為這是完備證明。
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.order_item_procurement'::regclass) THEN
    RAISE EXCEPTION 'A2 驗收失敗 — RLS 未啟用';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'order_item_procurement';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A2 驗收失敗 — 應為 zero-policy,實 % 條', v_cnt;
  END IF;

  -- 2. ACL:三個 role 一律無寫權;只有 service_role 有 SELECT
  SELECT count(*) INTO v_cnt
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(role_name)
   CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(priv)
   WHERE pg_catalog.has_table_privilege(r.role_name, 'public.order_item_procurement', p.priv);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A2 驗收失敗 — 表級寫權應為 0 個組合,實 %(寫入一律走 owner RPC)', v_cnt;
  END IF;
  IF pg_catalog.has_table_privilege('anon', 'public.order_item_procurement', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.order_item_procurement', 'SELECT') THEN
    RAISE EXCEPTION 'A2 驗收失敗 — 客人可讀到供應商資料(原則 3 破口)';
  END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.order_item_procurement', 'SELECT') THEN
    RAISE EXCEPTION 'A2 驗收失敗 — service_role 讀不到本表';
  END IF;
  -- 🔴 只點名三個已知 role 是不夠的(codex R1):production 的 default privileges 可能把權限
  --    授給我們沒想到的 custom role,而 REVOKE 只收回我們寫出來的那幾個。
  --    ⇒ 改成【allowlist】:整張表的 grantee 只准出現 owner 與 service_role,其餘一律擋。
  SELECT count(*) INTO v_cnt
    FROM pg_class c
   CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS a
   WHERE c.oid = 'public.order_item_procurement'::regclass
     AND a.grantee <> 0                                    -- 0 = PUBLIC(下面另外擋)
     AND a.grantee <> c.relowner
     AND pg_catalog.pg_get_userbyid(a.grantee) <> 'service_role';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A2 驗收失敗 — 表上有 % 筆非預期 grantee 的授權(只准 owner 與 service_role)', v_cnt;
  END IF;
  -- PUBLIC 一個權限都不准有
  SELECT count(*) INTO v_cnt
    FROM pg_class c
   CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS a
   WHERE c.oid = 'public.order_item_procurement'::regclass AND a.grantee = 0;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A2 驗收失敗 — PUBLIC 竟有 % 筆授權', v_cnt;
  END IF;
  -- 欄級 ACL 必須完全不存在(has_table_privilege 抓不到只授到單欄的 grant)
  SELECT count(*) INTO v_cnt
    FROM pg_attribute
   WHERE attrelid = 'public.order_item_procurement'::regclass
     AND attnum > 0 AND NOT attisdropped AND attacl IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'A2 驗收失敗 — 有 % 個欄位帶欄級 ACL(本表不該有任何欄級授權)', v_cnt;
  END IF;

  -- 3. 業務唯一鍵存在且是 UNIQUE(A5a 的冪等重放靠它;建錯欄 = 重放會長出重複列)
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_item_procurement'::regclass
     AND conname  = 'order_item_procurement_business_key'
     AND contype  = 'u' AND convalidated;
  IF v_def IS DISTINCT FROM 'UNIQUE (order_item_id, supplier_canonical_key)' THEN
    RAISE EXCEPTION 'A2 驗收失敗 — 業務唯一鍵定義不符,實 [%]', COALESCE(v_def, '(不存在)');
  END IF;

  -- 4. FK 是 RESTRICT(採購事實不得因為刪單而無聲消失)
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.order_item_procurement'::regclass AND contype = 'f';
  IF v_def IS NULL OR pg_catalog.strpos(v_def, 'ON DELETE RESTRICT') = 0 THEN
    RAISE EXCEPTION 'A2 驗收失敗 — order_item_id FK 非 ON DELETE RESTRICT(採購事實不得被靜默 CASCADE 掉),實 [%]', COALESCE(v_def, '(不存在)');
  END IF;

  -- 5. 行為探針:CHECK 真的擋得住(不是定義長得對而已)。
  --    需要一個真實 order_item 當 FK 目標;空表環境(全新本機 DB)自動略過。
  SELECT id INTO v_probe_item FROM public.order_items ORDER BY id LIMIT 1;
  IF v_probe_item IS NOT NULL THEN
    -- 正向:合法列可寫
    BEGIN
      INSERT INTO public.order_item_procurement
        (order_item_id, supplier_name, supplier_canonical_key, allocated_quantity, received_quantity)
      VALUES (v_probe_item, '  Ducati Taiwan  ', 'DUCATI TAIWAN', 3, 1)
      RETURNING id INTO v_probe_id;
      IF v_probe_id IS NULL THEN RAISE EXCEPTION 'A2 驗收失敗 — 合法列寫不進去'; END IF;
      RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'PC001';
    EXCEPTION
      WHEN check_violation OR foreign_key_violation OR not_null_violation THEN
        RAISE EXCEPTION 'A2 驗收失敗 — 合法列竟被拒(%)', SQLERRM;
      WHEN SQLSTATE 'PC001' THEN NULL;
    END;

    -- 負向:received > allocated 必被擋(到貨數超過採購數 = 帳一定錯)
    BEGIN
      INSERT INTO public.order_item_procurement
        (order_item_id, supplier_name, supplier_canonical_key, allocated_quantity, received_quantity)
      VALUES (v_probe_item, 'X', 'X', 2, 3);
      RAISE EXCEPTION 'A2 驗收失敗 — received_quantity 竟可超過 allocated_quantity';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'order_item_procurement_received_range' THEN
        RAISE EXCEPTION 'A2 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;

    -- 負向:allocated_quantity = 0 必被擋
    BEGIN
      INSERT INTO public.order_item_procurement
        (order_item_id, supplier_name, supplier_canonical_key, allocated_quantity)
      VALUES (v_probe_item, 'X', 'X', 0);
      RAISE EXCEPTION 'A2 驗收失敗 — allocated_quantity 竟可為 0';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'order_item_procurement_allocated_range' THEN
        RAISE EXCEPTION 'A2 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;

    -- 負向:負數必被擋
    BEGIN
      INSERT INTO public.order_item_procurement
        (order_item_id, supplier_name, supplier_canonical_key, allocated_quantity, received_quantity)
      VALUES (v_probe_item, 'X', 'X', 3, -1);
      RAISE EXCEPTION 'A2 驗收失敗 — received_quantity 竟可為負';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'order_item_procurement_received_range' THEN
        RAISE EXCEPTION 'A2 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;

    -- 負向:空白供應商名必被擋
    BEGIN
      INSERT INTO public.order_item_procurement
        (order_item_id, supplier_name, supplier_canonical_key, allocated_quantity)
      VALUES (v_probe_item, '   ', 'X', 1);
      RAISE EXCEPTION 'A2 驗收失敗 — 空白供應商名竟被接受';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'order_item_procurement_supplier_name_nonempty' THEN
        RAISE EXCEPTION 'A2 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;

    -- 負向:非 allowlist 的 reply_status 必被擋
    BEGIN
      INSERT INTO public.order_item_procurement
        (order_item_id, supplier_name, supplier_canonical_key, allocated_quantity, reply_status)
      VALUES (v_probe_item, 'X', 'X', 1, 'bogus');
      RAISE EXCEPTION 'A2 驗收失敗 — 非法 reply_status 竟被接受';
    EXCEPTION WHEN check_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname <> 'order_item_procurement_reply_status_check' THEN
        RAISE EXCEPTION 'A2 驗收失敗 — 被非預期約束擋下:%', v_cname;
      END IF;
    END;

    -- 負向:業務唯一鍵重複必被擋(A5a 的冪等重放依賴這條)
    BEGIN
      INSERT INTO public.order_item_procurement
        (order_item_id, supplier_name, supplier_canonical_key, allocated_quantity)
      VALUES (v_probe_item, 'A', 'SAME KEY', 1);
      INSERT INTO public.order_item_procurement
        (order_item_id, supplier_name, supplier_canonical_key, allocated_quantity)
      VALUES (v_probe_item, 'B', 'SAME KEY', 2);
      RAISE EXCEPTION 'A2 驗收失敗 — 同品項同供應商竟可寫入兩列';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;

    -- 正向:同品項不同供應商可以並存(1:N 的重點,拆單給兩家)
    BEGIN
      INSERT INTO public.order_item_procurement
        (order_item_id, supplier_name, supplier_canonical_key, allocated_quantity)
      VALUES (v_probe_item, 'A', 'KEY A', 1);
      INSERT INTO public.order_item_procurement
        (order_item_id, supplier_name, supplier_canonical_key, allocated_quantity)
      VALUES (v_probe_item, 'B', 'KEY B', 2);
      RAISE EXCEPTION 'probe rollback' USING ERRCODE = 'PC001';
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'A2 驗收失敗 — 同品項拆給兩家供應商竟被擋(1:N 不成立)';
      WHEN SQLSTATE 'PC001' THEN NULL;
    END;

    -- 探針零殘留
    SELECT count(*) INTO v_cnt FROM public.order_item_procurement;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'A2 驗收失敗 — 探針殘留 % 列', v_cnt;
    END IF;
  END IF;

  IF v_probe_item IS NOT NULL THEN
    RAISE NOTICE 'A2 驗收全數通過(約束定義 + 行為探針 + ACL/RLS)';
  ELSE
    RAISE NOTICE 'A2 驗收通過(約束定義 + ACL/RLS);⚠️ order_items 為空表,行為探針已略過';
  END IF;
END
$$;

COMMIT;

-- ============================================================
-- 🔴 回滾:另立版本號更大的 down migration(Supabase forward-only)
--
-- ⚠️ 依賴本表的東西會隨施工逐步變多。DROP 之前必須先確認【全部】已回滾:
--   DB 層:A1(order_items 的 ordered/instock 計數器)、A2b1(跨列總量守門 trigger)、
--          A2b2(其負測)、A4a(重算 trigger)、A4b(其負測)、A5a(upsert owner RPC)
--   應用層:A9a(明細投影)、A9b2(依供應商單號跨單搜尋)、A5c(相似候選)、
--          A9d1(server actions)、A9h(批次 coordinator)、A10b / A10c2(UI)
--   漏一個就會留下「查一張不存在的表」的 RPC / trigger function / adapter。
--
--   前置守門(破壞性指令之前,不是之後):
--     DO $$ BEGIN
--       IF EXISTS (SELECT 1 FROM public.order_item_procurement) THEN
--         RAISE EXCEPTION '已有採購紀錄,DROP 會永久遺失向供應商下單的事實 — 拒絕執行';
--       END IF;
--     END $$;
--     DROP TABLE public.order_item_procurement;
-- ============================================================
