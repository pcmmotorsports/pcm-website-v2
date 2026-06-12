-- ============================================================
-- M-3-S2-d:charge 簿記 + 防雙扣鎖 — payment_charge_attempts 表 + 4 RPC(3 主軌 + 1 備軌)
-- ============================================================
-- 真權威:docs/specs/2026-06-12-m3-stage2-3-charge-action-plan.md v6 §2/§3(codex 關卡1 六輪 24 條收斂 PASS)
--   + kickoff docs/handoff/2026-06-11-m3-stage2-tappay-kickoff.md §3.7 PF-X1/X2 + Sean 拍板 Q1=A/Q2=A + 「完整修好」指令。
-- 依賴:20260604120000(orders 表 + payment_status enum)、20260611120000(payment_confirmer 角色、S2-c)。
-- 鐵則 8(新表 + 新 RPC + GRANT)+ 鐵則 12(payment / 鎖 / 對帳)。
--
-- 🔴 設計(plan v6 §2/§3):
--   ① PF-X2 per-order 鎖:partial UNIQUE(order_id WHERE status IN pending,charged)= 每單至多一筆 active attempt;
--      佔鎖 = INSERT ON CONFLICT DO NOTHING(原子、跨請求);pending/charged 持鎖、failed 釋鎖可重試;
--      stale pending fail-closed 不自動釋鎖(寧卡單勿雙扣、②-⑥ webhook 主 + Record API 輔對帳解)。
--   ② PF-X2 per-user 閘(Q2=A):begin 內 advisory xact lock(序列化同會員並發)+「未解決付款」統一 predicate
--      (join orders:status IN pending,charged 且 orders.payment_status <> 'paid' 且 10 分鐘內 且 異單)→ user_in_flight。
--      涵蓋 charged-未-paid 視窗(round2 MF1)+ pending-但-已-paid 不誤卡(round3 MF)。
--   ③ PF-X1 紀錄:charge 前 begin 落 pending(order_id+customer_user_id+created_at);charge 成功 confirm 前
--      mark_charged 補 rec_trade_id(雙軌:主=payment_confirmer pg rail、備=authenticated PostgREST fallback RPC)。
--   ④ 備軌 fallback token(round4 MF2、Sean「完整修好」):begin 產生 gen_random_uuid token、DB 只存 sha256 hex hash
--      (helper 單一真相、round5 MF2)、明文只回 server 呼叫端記憶體;備軌 RPC 三重護欄 = token hash 比對 +
--      auth.uid() 歸屬 + 僅 pending→charged 緊縮轉移(永不釋鎖/標 failed)→ authenticated 偽造/誤鎖面關死。
--   ⑤ 權限軌(Q1=A):主軌 3 RPC 只 GRANT payment_confirmer(窄權演進:付款軌 = confirm + 3 簿記;仍零 table
--      權限、S2-c role-hygiene assert 不破、create_order 仍不可呼);備軌 1 RPC 只 GRANT authenticated;
--      表零直接權限(RLS enable 零 policy;寫入唯 SECURITY DEFINER owner);service_role 寫權 REVOKE 保 SELECT
--      (對齊 S2-c orders 紀律)+ 4 RPC EXECUTE 全 REVOKE;全矩陣 fail-closed assert。
--   ⑥ PF-E 拒絕訊息通用化(不洩 rec/狀態/token/約束名);unique_violation backstop 同通用訊息。
--   ⑦ 信任模型(誠實記):主軌 RPC 無 auth.uid()(payment_confirmer 直連)→ 歸屬 = 呼叫端持 PAYMENT_CONFIRMER_DB_URL
--      的 server code + p_order_id 為 server action 內 placeOrder 自產(永不收 client orderId);RPC 內仍驗 order
--      存在/unpaid + customer_user_id 從 orders 讀(零信任參數)+ mark 雙鍵驗(attempt_id+order_id、round6)。
--   ⑧ 冪等(雙軌重試安全):mark_charged charged+同 rec → no-op;mark_failed failed→failed → no-op;
--      (charged→failed 永遠 RAISE = 不可解鎖已扣款單)。
--
-- ⚠️ 誠實揭示:
--   - 主軌 happy-path literal「SET ROLE payment_confirmer 實呼」於 pooled MCP 必斷線(S2-c 已 4 次重現、環境限制)
--     → 等價證據 = has_function_privilege 矩陣 + owner 身分實跑行為矩陣 + search_path='' 函式屬性 caller 一致
--     + 全識別子 schema-qualified(同 S2-c PF-A 等價覆蓋先例);真連線 round-trip 由 ②-③b adapter 真連線實測補。
--   - 備軌 auth.uid() 模擬:交易內 set_config('request.jwt.claims', …) + SET ROLE authenticated 實呼驗證
--     (authenticated 為既有 NOLOGIN 角色、非 S2-c 觸發 pooled 斷線的新建 LOGIN 角色)。
--   - fallback token 明文絕不落 DB/log;DB 只存 hash;serverless 記憶體死 = 備軌對該 attempt 失效(等同雙軌
--     全死分支、②-⑥ webhook 確定性恢復;plan v6 §3)。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、BEGIN + 本 migration DDL + synthetic 資料 + DO 斷言 + ROLLBACK;
--   project bmpnplmnldofgaohnaok PG17、2026-06-12;斷言 = DO 內不符即 RAISE 炸整段交易、整段零錯跑完 = 全過;
--   每次跑後 pg_class/pg_proc/orders/auth.users 複查零留痕):
--   PASS(Call A:DDL+ACL assert;Call B:DDL+屬性探針+行為矩陣 ③-⑫ 全綠):
--   A:① DDL 套用無誤(表+3 index+helper+4 RPC);in-migration 表層 ACL assert + 函式權限矩陣 assert +
--        payment_confirmer role-hygiene assert 全靜默通過(= 終態自證:payment_confirmer EXECUTE 主軌 3 支
--        =true、fallback/create_order/helper=false、role_table_grants 仍 =0〔S2-c hygiene 不破〕;authenticated
--        僅 fallback=true、表全 false;anon 全 false;service_role 表 SELECT=true、INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER 全 false〔codex 關卡2 r1 收嚴 REVOKE ALL+GRANT SELECT、Call D 複驗〕、RPC 全 false)。
--        (Call A 首跑在「跑完全部 assert 後」的額外屬性探針炸掉 —— 探針字面誤寫 proconfig 空 search_path
--         儲存形式;實值 = search_path=""、Call B 以修正探針複驗 prosecdef + search_path="" 全 5 函式 ✓。)
--   B:③ begin happy(unpaid 單)→ acquired:true + attempt_id + fallback_token(uuid)+ row=pending +
--        fallback_token_hash = 64 lower-hex = helper(token) 且 ≠ token 明文(明文不落 DB);
--      ④ 同單再 begin → order_locked(per-order 鎖);
--      ⑤ 同會員異單 10 分鐘內 → user_in_flight;異會員異單 → acquired:true(閘 per-user);
--      ⑥ mark_charged happy pending→charged + rec 正確;同 rec 重呼 → no-op 冪等;異 rec → 通用 RAISE;
--        錯 order_id 配對 → 通用 RAISE(雙鍵驗);空白 rec → 通用 RAISE(原輸入驗具體訊息經 codex 關卡2 r1 收斂、Call D 複驗);
--        (updated_at 寫入字面存在;bump 無法交易內觀測 —— pg_catalog.now() 凍結於交易起點、誠實標記);
--      ⑦ mark_failed pending→failed(釋鎖);failed→failed → no-op 冪等;charged→failed → 通用 RAISE(不可解鎖);
--      ⑧ failed 後同單 begin 可重佔(partial unique 釋鎖語意);
--      ⑨ charged 永鎖:begin → order_locked;
--      ⑩ 閘行為矩陣:A 單 charged + orders 未 paid → B 單 begin 拒(round2 MF1);charged+paid → 放行;
--        A 單 pending + orders 已 paid → B 單 begin 放行(round3 MF 不誤卡);已 paid 單 begin → not_unpaid;
--        attempt 老化 >10 分鐘(模擬 UPDATE created_at)→ 放行(閘過期);
--      ⑪ fallback 矩陣(set_config('request.jwt.claims', …) + SET LOCAL ROLE authenticated **實呼**;
--        authenticated 為既有 NOLOGIN 角色、pooled MCP 未斷線 → 本備軌為 literal 實測非等價推論):
--        無 JWT → 通用 RAISE;他人 JWT+正 token → 通用 RAISE;本人 JWT+錯 token → 通用 RAISE;
--        本人 JWT+正 token+pending → charged ✓(owner 複查 rec 正確);charged+同 rec+正 token → no-op;
--        charged+異 rec → 通用 RAISE;fallback 無任何 →failed 路徑(程式字面不存在);
--      ⑫ 跨單重複 rec:mark_charged 異單同 rec → 撞 rec_unique_idx → 通用 RAISE(backstop、不洩約束名);
--      RAISE 訊息全程斷言等於通用字面常數(不含 rec/token/狀態/約束名);
--      ROLLBACK 後 residue_table=0 / residue_funcs=0 / residue_orders=0 / residue_users=0 = 零留痕。
--   ⚠️ 主軌 RPC 以 payment_confirmer 身分 literal 實呼仍受 pooled MCP 斷線限制(S2-c 4 次重現)→ 等價證據
--      = has_function_privilege 矩陣 + owner 實跑行為矩陣 + search_path 屬性 caller 一致;真連線 round-trip
--      由 ②-③b PgChargeAttemptAdapter 對 session pooler 真連線實測補。
--   ⚠️ code-reviewer 修補(模擬後、Call C 複驗):helper REVOKE 補 payment_confirmer / 表層 assert 擴
--      anon 四權+authenticated DELETE / begin 函式體補 race 註解 —— Call C(表+helper+begin+新 assert、
--      BEGIN…ROLLBACK)複驗套用無誤 + 零留痕(residue 全 0)。
--   ⚠️ codex 關卡2 r1 修補(Call D 複驗):service_role 改 REVOKE ALL+GRANT SELECT(REFERENCES/TRIGGER 全收、
--      assert 擴六權)/ mark_charged rec 輸入驗訊息收斂通用 —— Call D(表+ACL assert+mark_charged 空白 rec
--      行為、BEGIN…ROLLBACK)複驗套用無誤 + 空白 rec 回通用訊息 + 零留痕(residue 全 0)。
--
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):見檔尾。
-- ============================================================


-- ── 1. payment_charge_attempts 表(PF-X1 對帳簿 + PF-X2 鎖一體;plan v6 §2)──
CREATE TABLE public.payment_charge_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES public.orders(id),
  -- 自 orders 反正規化(per-user 閘查詢用;begin RPC 內從 orders 讀、非參數、零信任)
  customer_user_id    uuid NOT NULL,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'charged', 'failed')),
  rec_trade_id        text,
  -- sha256 hex(server-only 備軌 token);明文只在 server 記憶體、絕不落 DB/log(round4 MF2;規格 round5 MF2)
  fallback_token_hash text NOT NULL CHECK (fallback_token_hash ~ '^[0-9a-f]{64}$'),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'charged' OR rec_trade_id IS NOT NULL)
);

-- per-order 鎖:每單至多一筆 active(pending|charged)attempt;failed 釋鎖(可重試)
CREATE UNIQUE INDEX payment_charge_attempts_order_lock_idx
  ON public.payment_charge_attempts (order_id) WHERE status IN ('pending', 'charged');
-- per-user 閘查詢(10 分鐘窗、join orders 過濾已 paid)
CREATE INDEX payment_charge_attempts_user_active_idx
  ON public.payment_charge_attempts (customer_user_id, created_at) WHERE status IN ('pending', 'charged');
-- 對帳簿前哨:跨單重複 rec 早抓(orders.tappay_rec_trade_id UNIQUE 之前;round6 nit)
CREATE UNIQUE INDEX payment_charge_attempts_rec_unique_idx
  ON public.payment_charge_attempts (rec_trade_id) WHERE rec_trade_id IS NOT NULL;

COMMENT ON TABLE public.payment_charge_attempts IS
  'M-3-S2-d charge 簿記 + 防雙扣鎖(plan v6 §2、PF-X1/X2)。寫入唯 SECURITY DEFINER RPC(begin/mark×2 主軌 payment_confirmer、fallback 備軌 authenticated+token);表零直接權限(RLS 零 policy);pending/charged 持 per-order 鎖、failed 釋鎖;fallback_token_hash=sha256 hex(明文只在 server 記憶體);rec_trade_id 跨單唯一。stale pending 不自動釋鎖(fail-closed、②-⑥ 對帳解)。';

-- RLS enable、零 policy(= 任何非 owner 角色直查全拒;寫入唯 SECURITY DEFINER owner)
ALTER TABLE public.payment_charge_attempts ENABLE ROW LEVEL SECURITY;

-- 表層權限終態(plan v6 §2 ACL 矩陣):anon/authenticated 全零;service_role 寫權收、保 SELECT(對齊 S2-c orders 紀律)
REVOKE ALL ON TABLE public.payment_charge_attempts FROM PUBLIC, anon, authenticated;
-- service_role:REVOKE ALL 再精準 GRANT SELECT(codex 關卡2:含 REFERENCES/TRIGGER 全收、「唯 SELECT」字面成真)
REVOKE ALL ON TABLE public.payment_charge_attempts FROM service_role;
GRANT SELECT ON TABLE public.payment_charge_attempts TO service_role;

-- fail-closed assert:表層 ACL 終態(round5 MF4 逐角色;Supabase default-privilege re-grant 漂移防線)
DO $$
BEGIN
  -- 覆蓋 anon/authenticated 四權 + service_role 六權(INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER 全 false、
  -- 唯 SELECT true;codex 關卡2 r1 收嚴 — REVOKE ALL+GRANT SELECT 令「唯 SELECT」字面成真)
  IF has_table_privilege('anon',          'public.payment_charge_attempts', 'SELECT')
     OR has_table_privilege('anon',          'public.payment_charge_attempts', 'INSERT')
     OR has_table_privilege('anon',          'public.payment_charge_attempts', 'UPDATE')
     OR has_table_privilege('anon',          'public.payment_charge_attempts', 'DELETE')
     OR has_table_privilege('authenticated', 'public.payment_charge_attempts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.payment_charge_attempts', 'INSERT')
     OR has_table_privilege('authenticated', 'public.payment_charge_attempts', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.payment_charge_attempts', 'DELETE')
     OR has_table_privilege('service_role',  'public.payment_charge_attempts', 'INSERT')
     OR has_table_privilege('service_role',  'public.payment_charge_attempts', 'UPDATE')
     OR has_table_privilege('service_role',  'public.payment_charge_attempts', 'DELETE')
     OR has_table_privilege('service_role',  'public.payment_charge_attempts', 'TRUNCATE')
     OR has_table_privilege('service_role',  'public.payment_charge_attempts', 'REFERENCES')
     OR has_table_privilege('service_role',  'public.payment_charge_attempts', 'TRIGGER')
     OR NOT has_table_privilege('service_role', 'public.payment_charge_attempts', 'SELECT') THEN
    RAISE EXCEPTION 'payment_charge_attempts 表層 ACL 異常 — 應 anon/authenticated 全零、service_role 唯 SELECT;拒繼續';
  END IF;
END
$$;


-- ── 2. fallback token hash helper(算法單一真相;round5 MF2)──
-- uuid canonical text(小寫含連字號)→ UTF8 bytes → sha256 → lower hex 64 字;PG17 builtin、零 pgcrypto 依賴。
-- begin 與 fallback 同呼本 helper → 算法不可能不一致。零任何角色 EXECUTE(只 owner 經 SECURITY DEFINER 內部呼)。
CREATE OR REPLACE FUNCTION public.charge_attempt_token_hash(p_token uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token::text, 'UTF8')), 'hex');
$fn$;

COMMENT ON FUNCTION public.charge_attempt_token_hash(uuid) IS
  'M-3-S2-d 備軌 token hash 單一真相(round5 MF2):uuid canonical text → UTF8 → sha256 → lower hex。零角色 EXECUTE、只 owner 經 SECDEF RPC 內部呼。';

REVOKE ALL ON FUNCTION public.charge_attempt_token_hash(uuid) FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;


-- ── 3. begin_charge_attempt(主軌、佔鎖 + per-user 閘 + token 發放;plan v6 §2 RPC 1)──
CREATE OR REPLACE FUNCTION public.begin_charge_attempt(p_order_id uuid)
RETURNS jsonb  -- {acquired bool, attempt_id?, fallback_token?, reason?: user_in_flight|order_locked|not_unpaid}
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order       record;
  v_attempt_id  uuid;
  v_token       uuid;
  v_generic_msg constant text := 'begin_charge_attempt: 付款處理失敗';  -- PF-E 通用訊息
BEGIN
  -- 訂單存在 + 取歸屬(customer_user_id 從 orders 讀、零信任參數;不存在 → 通用 RAISE 不洩存在與否)
  SELECT id, customer_user_id, payment_status
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 已 paid / refunded / partiallyPaid → 不開新 charge(與撞鎖同層級回覆、不洩具體狀態)
  -- 此讀無 row lock:與並發 confirm 有理論 race(檢查後翻 paid → 為已 paid 單插 pending row),
  -- 後果僅該單持 per-order 鎖(fail-closed、②-⑥ 對帳可解)、閘 join orders 已 paid 放行不誤卡、
  -- 零雙扣路徑;②-③c 編排層知悉(code-reviewer 2026-06-12 觀察)。
  IF v_order.payment_status <> 'unpaid'::public.payment_status THEN
    RETURN pg_catalog.jsonb_build_object('acquired', false, 'reason', 'not_unpaid');
  END IF;

  -- 🔴 per-user 閘(Q2=A;round2 MF1 + round3 MF 統一 predicate):
  -- advisory xact lock 序列化同會員並發 begin(交易結束自動釋放、不跨外部 HTTP);
  -- 「未解決付款」= 10 分鐘內、異單、active(pending|charged)、且該單尚未 paid(join orders:
  --   charged-未-paid 也擋〔雙扣視窗〕;pending-但-已-paid 放行〔不誤卡〕)。
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order.customer_user_id::text, 0));
  IF EXISTS (
    SELECT 1
      FROM public.payment_charge_attempts a
      JOIN public.orders o ON o.id = a.order_id
     WHERE a.customer_user_id = v_order.customer_user_id
       AND a.order_id <> p_order_id
       AND a.status IN ('pending', 'charged')
       AND a.created_at > pg_catalog.now() - interval '10 minutes'
       AND o.payment_status <> 'paid'::public.payment_status
  ) THEN
    RETURN pg_catalog.jsonb_build_object('acquired', false, 'reason', 'user_in_flight');
  END IF;

  -- 🔴 per-order 佔鎖(原子;撞 active attempt → DO NOTHING → order_locked)+ 備軌 token 發放(round4 MF2)
  v_token := pg_catalog.gen_random_uuid();
  INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, fallback_token_hash)
  VALUES (p_order_id, v_order.customer_user_id, public.charge_attempt_token_hash(v_token))
  ON CONFLICT (order_id) WHERE status IN ('pending', 'charged') DO NOTHING
  RETURNING id INTO v_attempt_id;

  IF v_attempt_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('acquired', false, 'reason', 'order_locked');
  END IF;

  -- token 明文只在此回傳值(server 呼叫端記憶體);DB 只有 hash、絕不入 log
  RETURN pg_catalog.jsonb_build_object(
    'acquired', true,
    'attempt_id', v_attempt_id,
    'fallback_token', v_token
  );
END;
$fn$;

COMMENT ON FUNCTION public.begin_charge_attempt(uuid) IS
  'M-3-S2-d 佔 per-order charge 鎖 + per-user 10 分鐘閘(advisory xact 序列化 + join orders 未解決付款 predicate)+ 發備軌 token(DB 只存 hash)。只 payment_confirmer 可呼;p_order_id 為 server action 自產(信任模型見 migration 頭註解 ⑦)。';


-- ── 4. mark_charge_attempt_charged(主軌、PF-X1 麵包屑;plan v6 §2 RPC 2)──
CREATE OR REPLACE FUNCTION public.mark_charge_attempt_charged(
  p_attempt_id   uuid,
  p_order_id     uuid,
  p_rec_trade_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_row         record;
  v_n           integer;
  v_generic_msg constant text := 'mark_charge_attempt_charged: 付款處理失敗';  -- PF-E
BEGIN
  -- rec 形狀驗(server 自供參數、可具體;TapPay rec_trade_id 英數、上限 64)
  IF p_rec_trade_id IS NULL OR pg_catalog.btrim(p_rec_trade_id) = '' OR pg_catalog.length(p_rec_trade_id) > 64 THEN
    RAISE EXCEPTION '%', v_generic_msg;  -- 輸入驗同通用訊息(codex 關卡2 r1:付款軌 RAISE 全收斂、零例外)
  END IF;

  -- 雙鍵驗(round6:attempt_id + order_id 須配對、縮錯寫半徑)+ FOR UPDATE 序列化雙軌並發重試
  SELECT id, status, rec_trade_id
    INTO v_row
    FROM public.payment_charge_attempts
   WHERE id = p_attempt_id AND order_id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 冪等:已 charged 且同 rec → no-op(雙軌×重試安全;不刷 updated_at)
  IF v_row.status = 'charged' THEN
    IF v_row.rec_trade_id IS NOT DISTINCT FROM p_rec_trade_id THEN
      RETURN;
    END IF;
    RAISE EXCEPTION '%', v_generic_msg;  -- charged 但異 rec = 異常(不覆寫)
  END IF;

  -- 僅 pending→charged(failed/其餘 → 拒)
  UPDATE public.payment_charge_attempts
     SET status       = 'charged',
         rec_trade_id = p_rec_trade_id,
         updated_at   = pg_catalog.now()
   WHERE id = p_attempt_id AND order_id = p_order_id AND status = 'pending';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

EXCEPTION
  -- 跨單重複 rec 撞 rec_unique_idx → 通用訊息(PF-E、不洩約束名/rec)
  WHEN unique_violation THEN
    RAISE EXCEPTION '%', v_generic_msg;
END;
$fn$;

COMMENT ON FUNCTION public.mark_charge_attempt_charged(uuid, uuid, text) IS
  'M-3-S2-d PF-X1 麵包屑主軌:pending→charged + rec_trade_id(confirm 前落 DB)。雙鍵驗 + FOR UPDATE + charged 同 rec 冪等 no-op + 跨單重複 rec 通用 RAISE。只 payment_confirmer 可呼。';


-- ── 5. mark_charge_attempt_failed(主軌、卡拒釋鎖;plan v6 §2 RPC 3)──
CREATE OR REPLACE FUNCTION public.mark_charge_attempt_failed(
  p_attempt_id uuid,
  p_order_id   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_row         record;
  v_n           integer;
  v_generic_msg constant text := 'mark_charge_attempt_failed: 付款處理失敗';  -- PF-E
BEGIN
  -- 雙鍵驗 + FOR UPDATE(序列化重試)
  SELECT id, status
    INTO v_row
    FROM public.payment_charge_attempts
   WHERE id = p_attempt_id AND order_id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 冪等:failed→failed no-op(主軌 ×3 重試安全);🔴 charged→failed 永遠拒(不可解鎖已扣款單)
  IF v_row.status = 'failed' THEN
    RETURN;
  END IF;

  UPDATE public.payment_charge_attempts
     SET status     = 'failed',
         updated_at = pg_catalog.now()
   WHERE id = p_attempt_id AND order_id = p_order_id AND status = 'pending';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public.mark_charge_attempt_failed(uuid, uuid) IS
  'M-3-S2-d 卡拒(TapPay 明確未扣款)釋 per-order 鎖:pending→failed。雙鍵驗 + failed 冪等 no-op;charged→failed 永遠拒(不可解鎖已扣款單)。只 payment_confirmer 可呼。';


-- ── 6. mark_charge_attempt_charged_fallback(備軌、token 三重護欄;plan v6 §2 RPC 4、round4 MF1/MF2)──
-- 第二 transport(authenticated PostgREST HTTPS;主軌 pooler TCP 故障時麵包屑不丟)。
-- 三重護欄:① token hash 比對(明文只在 server 記憶體 → 會員無 token 全拒、偽造/誤鎖面關死)
--          ② auth.uid() 歸屬(anon/他人/無 cookie 拒)③ 僅 pending→charged 緊縮轉移(永不釋鎖)。
CREATE OR REPLACE FUNCTION public.mark_charge_attempt_charged_fallback(
  p_attempt_id     uuid,
  p_order_id       uuid,
  p_rec_trade_id   text,
  p_fallback_token uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_row         record;
  v_uid         uuid := (SELECT auth.uid());
  v_n           integer;
  v_generic_msg constant text := 'mark_charge_attempt_charged_fallback: 付款處理失敗';  -- PF-E(token 對錯不可區分)
BEGIN
  -- rec 形狀驗(同主軌)
  IF p_rec_trade_id IS NULL OR pg_catalog.btrim(p_rec_trade_id) = '' OR pg_catalog.length(p_rec_trade_id) > 64 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  -- 護欄②前置:未登入(無 JWT)直接拒
  IF v_uid IS NULL OR p_fallback_token IS NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 雙鍵驗 + FOR UPDATE
  SELECT id, status, rec_trade_id, customer_user_id, fallback_token_hash
    INTO v_row
    FROM public.payment_charge_attempts
   WHERE id = p_attempt_id AND order_id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 護欄①:token hash 比對(同 helper 單一真相;不符 = 非本 server 流程發出 → 拒)
  IF public.charge_attempt_token_hash(p_fallback_token) <> v_row.fallback_token_hash THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  -- 護欄②:本人歸屬(auth.uid() 對 attempt 反正規化 customer_user_id)
  IF v_uid <> v_row.customer_user_id THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 護欄③:僅 pending→charged;charged 同 rec 冪等 no-op;其餘(failed / charged 異 rec)拒
  IF v_row.status = 'charged' THEN
    IF v_row.rec_trade_id IS NOT DISTINCT FROM p_rec_trade_id THEN
      RETURN;
    END IF;
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  UPDATE public.payment_charge_attempts
     SET status       = 'charged',
         rec_trade_id = p_rec_trade_id,
         updated_at   = pg_catalog.now()
   WHERE id = p_attempt_id AND order_id = p_order_id AND status = 'pending';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION '%', v_generic_msg;
END;
$fn$;

COMMENT ON FUNCTION public.mark_charge_attempt_charged_fallback(uuid, uuid, text, uuid) IS
  'M-3-S2-d PF-X1 麵包屑備軌(第二 transport、authenticated PostgREST):token hash + auth.uid() + 僅 pending→charged 三重護欄;永不釋鎖/標 failed。token 明文只在 server 記憶體(round4 MF2)。';


-- ── 7. 權限終態(plan v6 §2 ACL 矩陣;round5 MF4 逐角色)──
-- 主軌 3 支:只 payment_confirmer(Q1=A 窄權演進:付款軌 = confirm + 3 簿記;create_order 仍不可呼)
REVOKE ALL ON FUNCTION public.begin_charge_attempt(uuid)                                  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_charge_attempt_charged(uuid, uuid, text)               FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_charge_attempt_failed(uuid, uuid)                      FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_charge_attempt(uuid)                    TO payment_confirmer;
GRANT EXECUTE ON FUNCTION public.mark_charge_attempt_charged(uuid, uuid, text) TO payment_confirmer;
GRANT EXECUTE ON FUNCTION public.mark_charge_attempt_failed(uuid, uuid)        TO payment_confirmer;

-- 備軌 1 支:只 authenticated(token 三重護欄;payment_confirmer 不需不授)
REVOKE ALL ON FUNCTION public.mark_charge_attempt_charged_fallback(uuid, uuid, text, uuid) FROM PUBLIC, anon, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.mark_charge_attempt_charged_fallback(uuid, uuid, text, uuid) TO authenticated;

-- 🔴 函式權限矩陣 fail-closed assert(has_function_privilege 涵蓋直接+繼承;任一不符 → 擋 db push)
DO $$
BEGIN
  IF -- 主軌 3 支:唯 payment_confirmer
     NOT has_function_privilege('payment_confirmer', 'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('payment_confirmer', 'public.mark_charge_attempt_charged(uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('payment_confirmer', 'public.mark_charge_attempt_failed(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.mark_charge_attempt_charged(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_charge_attempt_charged(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.mark_charge_attempt_charged(uuid,uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon',          'public.mark_charge_attempt_failed(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_charge_attempt_failed(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.mark_charge_attempt_failed(uuid,uuid)', 'EXECUTE')
     -- 備軌:唯 authenticated
     OR NOT has_function_privilege('authenticated', 'public.mark_charge_attempt_charged_fallback(uuid,uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon',              'public.mark_charge_attempt_charged_fallback(uuid,uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role',      'public.mark_charge_attempt_charged_fallback(uuid,uuid,text,uuid)', 'EXECUTE')
     OR has_function_privilege('payment_confirmer', 'public.mark_charge_attempt_charged_fallback(uuid,uuid,text,uuid)', 'EXECUTE')
     -- helper:零角色
     OR has_function_privilege('anon',          'public.charge_attempt_token_hash(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.charge_attempt_token_hash(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.charge_attempt_token_hash(uuid)', 'EXECUTE')
     OR has_function_privilege('payment_confirmer', 'public.charge_attempt_token_hash(uuid)', 'EXECUTE')
     -- 攻擊面收斂回歸:payment_confirmer 仍不可呼 create_order(S2-c §2e 不破)
     OR has_function_privilege('payment_confirmer', 'public.create_order(jsonb,uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'charge attempts RPC EXECUTE 權限矩陣異常(plan v6 §2 ACL);拒繼續';
  END IF;
END
$$;

-- 🔴 payment_confirmer role-hygiene 回歸 assert(Q1=A 演進後仍零 table/column 權限;S2-c 紀律不破)
DO $$
DECLARE
  v_tbl integer;
  v_col integer;
BEGIN
  SELECT count(*) INTO v_tbl FROM information_schema.role_table_grants  WHERE grantee = 'payment_confirmer';
  SELECT count(*) INTO v_col FROM information_schema.role_column_grants WHERE grantee = 'payment_confirmer';
  IF v_tbl <> 0 OR v_col <> 0 THEN
    RAISE EXCEPTION 'payment_confirmer 出現 table/column 權限(table=%, col=%)— Q1=A 演進僅允許函式 EXECUTE;拒繼續', v_tbl, v_col;
  END IF;
END
$$;


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   DROP FUNCTION IF EXISTS public.mark_charge_attempt_charged_fallback(uuid, uuid, text, uuid);
--   DROP FUNCTION IF EXISTS public.mark_charge_attempt_failed(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.mark_charge_attempt_charged(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.begin_charge_attempt(uuid);
--   DROP FUNCTION IF EXISTS public.charge_attempt_token_hash(uuid);
--   DROP TABLE IF EXISTS public.payment_charge_attempts;
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE ... (無 — 本 migration 未動其他表權限)
-- ============================================================
