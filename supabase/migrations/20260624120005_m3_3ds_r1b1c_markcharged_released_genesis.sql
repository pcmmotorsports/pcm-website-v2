-- ============================================================
-- M-3 3DS 乙路 R1b1c:mark_charge_attempt_charged 放寬 released→charged + 同交易建 open anomaly(雙扣 genesis)
-- ============================================================
-- 真權威:docs/specs/2026-06-24-m3-3ds-anomaly-refund-PRD.md(過 prd_review、codex K1 round3 PASS)§5(genesis 合約)+ §8 R1b1c 驗收 + §2(主表欄位/NOT NULL/型別)
--          + docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md v9 §4 R1b1c(行 177-178、逐字)+ §2.6(late success 捕捉 + 雙扣明確化)+ §7 + §9 第 6 片 + §14 步 15。
-- canonical 經 Codex round4→11 共 8 輪、round11 PASS;PRD 經 codex K1 round1→3、round3 PASS;本片 = §14 唯一 45 步序之步 15(R1 migration bundle 第六片)。
-- 依賴:20260612150000(mark_charge_attempt_charged 基線本體 = 本片 CREATE OR REPLACE 改它)、
--       20260624120000 R1a1(payment_charge_attempts 加 'released' 狀態 + released_at 欄)、
--       20260624120003 R1b1a(payment_double_charge_anomalies 主表 = genesis 寫入目標、欄位/NOT NULL/4 態 CHECK/old_attempt_id UNIQUE)、
--       20260604120000(orders.total integer NOT NULL、orders.cart_session_id uuid)。
-- 鐵則 8(動既有 payment RPC)由 canonical/PRD 滿足、無需新 plan;鐵則 12(payment / 雙扣 / migration / genesis 稽核)→ codex K2 + Codex Packet。
-- L3(雙扣 / 退款營運資料)→ 過 prd_review 才實作(✅ 已過、R1b1c gate 解除)。
--
-- 🔴 設計(PRD §5 + canonical §4 R1b1c 行 177-178 + §2.6):
--   ① 轉移放寬:status IN ('pending','released') → charged(原僅 pending)。
--      - 'released' = R1a3 server-only CAS 從 pending 轉入(客人放棄付款、Record=4)、留對帳集;
--        late success 由 sweeper/S2b → settleCharge(舊單)→ Record 0/1 → 本 RPC markCharged(released→charged)捕捉(§2.6)。
--      - same-rec 冪等(charged 同 rec → no-op)/ 異 rec(charged 異 rec → RAISE)/ 跨單 rec 撞 rec_unique_idx → unique_violation 通用 RAISE:
--        既有區塊逐字不動、續守。
--   ② 🔴 genesis:v_row.status='released' 時(= late success 對帳收斂)→ **同交易**寫主表 anomaly:
--      - INSERT … ON CONFLICT (old_attempt_id) DO NOTHING(冪等、不重複建)、status='open'。
--      - 🔴 所有 NOT NULL 欄齊填,缺則 INSERT not_null_violation RAISE(不被下方 unique_violation handler 攔)→ 整交易回滾 →
--        markCharged 失敗、attempt 維持 released、anomaly 不建 → **寧可不收斂也不漏記雙扣(§7 主訊號失效是更大風險、PRD §1.3/§5)**。
--      - 欄來源(PRD §5 表):
--        old_attempt_id=v_row.id / old_order_id=v_row.order_id / user_id=v_row.customer_user_id /
--        cart_session_id=orders.cart_session_id(同交易讀)/ rec_trade_id+refund_target_rec_trade_id=p_rec_trade_id(本次 released→charged 寫入 old attempt 的 rec、絕不指向重刷新單;本 RPC 全程 targets old attempt/order)/
--        released_at=v_row.released_at(R1a3 COALESCE write-once)/ charged_at=now() / amount=orders.total(integer 快照、禁浮點)。
--
-- 🔴 零漂移(字面 vs 事實):除「① status 集合放寬 pending→{pending,released}」+「② genesis 區塊」+「SELECT 擴欄供 genesis(WHERE/FOR UPDATE 不變)」外,
--   基線 mark_charge_attempt_charged(20260612150000 L240-298)邏輯逐字不動:rec 形狀驗 / 雙鍵 + FOR UPDATE 序列化 /
--   charged 同 rec no-op·異 rec RAISE / GET DIAGNOSTICS rowcount<>1 RAISE / EXCEPTION unique_violation 通用 RAISE / PF-E 通用訊息 /
--   SECDEF + search_path='' 硬化 + 全識別子 schema-qualified 逐字保留。**ACL 不改**(沿用 20260612150000 既有 GRANT:payment_confirmer EXECUTE;
--   與 R1b1b owner-only RPC 不同 — markCharged 仍是 payment_confirmer 付款軌簿記、settleCharge 走此路收斂 released)。
--   genesis 經 SECDEF owner 身分對 anomaly 主表(RLS zero-policy / table ACL 5 角色全 REVOKE)寫入成立。
--
-- ⚠️ 守線:本片只 CREATE OR REPLACE 既有函式(無新表 / 無 ALTER 表 / 無 ACL 異動)+ MCP 模擬(零留痕);
--   不 db push(= §14 步 21 Sean、R1 bundle 連帶 S2b=live)、不 push / merge、不開 flag(TAPPAY_3DS_ENABLED false)。
--   begin / R1a1-a3 / R1b1a-b 既有物件本片不動。
--
-- 動手前真 DB 交易模擬(MCP execute_sql、project bmpnplmnldofgaohnaok PG17、2026-06-24;單一 atomic DO block:
--   先套 R1a1 DDL(released 狀態 + released_at 欄)+ R1b1a 兩表 DDL → 放基線 mark_charge_attempt_charged 本體 → CREATE OR REPLACE 本片函式 →
--   引用 prod 既有 order/attempt id 滿足 FK(唯讀引用、合成 attempt/anomaly 插入皆在 DO block 內 → 末端 RAISE 強制 rollback、零留痕)→ 行為測:
--   ① pending→charged 原行為不回歸(無 anomaly)② released→charged 成立 + 同交易建 open anomaly(amount=orders.total / refund_target=舊 rec / status=open)
--   ③ same-rec 二次呼叫 no-op 冪等(anomaly ON CONFLICT 不重複建、列數維持 1)④ 異 rec / 跨單 rec → RAISE
--   ⑤ NOT NULL 欄缺(cart_session_id NULL)→ INSERT not_null_violation RAISE 反證(漏記雙扣 fail-closed)
--   ⑥ genesis INSERT 經 SECDEF owner 對 RLS zero-policy / REVOKE-all 表寫入成立 ⑦ RACE-B/B2(§10.1 release CAS vs late success markCharged、FOR UPDATE 序列化)。
--   跑後 pg_proc / anomaly 兩表 catalog residue=0 複查(函式回基線定義、無殘留 anomaly 列)。
--   ✅ PASS(2026-06-24、單一 atomic DO block、SENTINEL_OK_R1B1C 末端 RAISE 強制 rollback):
--     T1 pending->charged 原行為不回歸、無 anomaly;
--     T2 released->charged 成立 + 同交易建 open anomaly(amount=22200=orders.total / refund_target=REC-R1 舊 rec / status=open / old_order_id / user_id / cart_session_id / released_at 逐欄對);
--     T3 same-rec 二次呼叫 no-op + ON CONFLICT(old_attempt_id) DO NOTHING → anomaly cnt 維持 1(冪等);
--     T4 跨單重複 rec(撞 rec_unique_idx)→ unique_violation 通用 RAISE、attempt 維持 released、anomaly=0;
--     T5 cart_session_id NULL → genesis INSERT not_null_violation RAISE(不被 unique handler 攔)、attempt 維持 released、anomaly=0 = 漏記雙扣 fail-closed 反證;
--     T6 anomaly 表 RLS enabled + zero-policy + ACL 5 角色全 REVOKE,owner SECDEF genesis 寫入仍成立(T2 已落地);
--     T7 RACE-B/B2 = FOR UPDATE 序列化(T1/T2 兩終態)+ T3 charged no-op/ON CONFLICT 冪等 serial 近似;真雙連線雙扣窗留執行 session 雙 psql(canonical §10.1/§12)。
--     residue 複查:status_check_has_released=0 / released_at_col=0 / anomaly_tbls=0 / markcharged_released_residue=0 / fn_cnt=1(函式回基線)= 零留痕。
--   結果回填 commit body / Codex Packet。
--
-- Rollback(Supabase forward-only、僅供參考):CREATE OR REPLACE 回 20260612150000 之 mark_charge_attempt_charged 基線本體(僅 pending→charged、無 genesis)。見檔尾。
-- ============================================================


-- ── mark_charge_attempt_charged(R1b1c:released→charged 放寬 + genesis;基線 20260612150000 §4)──
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
  v_row             record;
  v_n               integer;
  v_cart_session_id uuid;      -- 🔴 R1b1c genesis:取自 orders、anomaly.cart_session_id NOT NULL 來源
  v_amount          integer;   -- 🔴 R1b1c genesis:取 orders.total(integer 快照、禁浮點)
  v_generic_msg constant text := 'mark_charge_attempt_charged: 付款處理失敗';  -- PF-E
BEGIN
  -- rec 形狀驗(基線逐字不動;TapPay rec_trade_id 英數、上限 64)
  IF p_rec_trade_id IS NULL OR pg_catalog.btrim(p_rec_trade_id) = '' OR pg_catalog.length(p_rec_trade_id) > 64 THEN
    RAISE EXCEPTION '%', v_generic_msg;  -- 輸入驗同通用訊息(付款軌 RAISE 全收斂)
  END IF;

  -- 雙鍵驗(attempt_id + order_id 配對)+ FOR UPDATE 序列化雙軌並發重試(基線 WHERE/FOR UPDATE 逐字不動;
  -- 🔴 R1b1c 僅擴 SELECT 欄位〔order_id / customer_user_id / released_at〕供 genesis 取值,述詞與鎖不變)
  SELECT id, order_id, customer_user_id, status, rec_trade_id, released_at
    INTO v_row
    FROM public.payment_charge_attempts
   WHERE id = p_attempt_id AND order_id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 冪等:已 charged 且同 rec → no-op(基線逐字不動;雙軌×重試安全;不刷 updated_at;同 rec 不重建 anomaly)
  IF v_row.status = 'charged' THEN
    IF v_row.rec_trade_id IS NOT DISTINCT FROM p_rec_trade_id THEN
      RETURN;
    END IF;
    RAISE EXCEPTION '%', v_generic_msg;  -- charged 但異 rec = 異常(不覆寫)
  END IF;

  -- 🔴 R1b1c 轉移放寬:pending / released → charged(基線僅 pending;released = late success 對帳收斂)
  UPDATE public.payment_charge_attempts
     SET status       = 'charged',
         rec_trade_id = p_rec_trade_id,
         updated_at   = pg_catalog.now()
   WHERE id = p_attempt_id AND order_id = p_order_id AND status IN ('pending', 'released');

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 R1b1c genesis:released→charged = late success「雙扣明確化」→ 同交易建 open anomaly(§2.6 / §4 R1b1c / PRD §5)
  IF v_row.status = 'released' THEN
    -- cart_session_id + amount 同交易取自 order(orders.total integer 禁浮點;orders.cart_session_id 為主要來源)
    SELECT cart_session_id, total
      INTO v_cart_session_id, v_amount
      FROM public.orders
     WHERE id = p_order_id;

    -- 🔴 所有 NOT NULL 欄齊填;缺則 INSERT not_null_violation RAISE(不被下方 unique_violation handler 攔 → 整交易回滾)
    --    → markCharged 失敗、attempt 維持 released、anomaly 不建 → 寧可不收斂也不漏記雙扣(§7 主訊號、PRD §1.3/§5)。
    -- ON CONFLICT (old_attempt_id) DO NOTHING:冪等(same-rec 重呼 / 並發二次 markCharged 皆不重複建)。
    INSERT INTO public.payment_double_charge_anomalies (
      old_attempt_id,
      old_order_id,
      user_id,
      cart_session_id,
      rec_trade_id,
      refund_target_rec_trade_id,
      released_at,
      charged_at,
      amount,
      status
    )
    VALUES (
      v_row.id,                  -- old_attempt_id
      v_row.order_id,            -- old_order_id
      v_row.customer_user_id,    -- user_id
      v_cart_session_id,         -- cart_session_id(取自 order)
      p_rec_trade_id,            -- rec_trade_id = 本次 released→charged 寫入 old attempt 的 rec
      p_rec_trade_id,            -- refund_target_rec_trade_id = 同上(舊 attempt rec、絕不指向重刷新單)
      v_row.released_at,         -- released_at(R1a3 COALESCE write-once)
      pg_catalog.now(),          -- charged_at
      v_amount,                  -- amount = orders.total(integer 快照)
      'open'                     -- status genesis = open
    )
    ON CONFLICT (old_attempt_id) DO NOTHING;
  END IF;

EXCEPTION
  -- 跨單重複 rec 撞 rec_unique_idx → 通用訊息(PF-E、不洩約束名/rec;基線逐字不動)
  -- 🔴 注意:genesis 之 not_null_violation 非 unique_violation → 不被此攔、向上傳播 → fail-closed(漏記雙扣寧失敗)。
  WHEN unique_violation THEN
    RAISE EXCEPTION '%', v_generic_msg;
END;
$fn$;

COMMENT ON FUNCTION public.mark_charge_attempt_charged(uuid, uuid, text) IS
  'M-3 3DS R1b1c PF-X1 麵包屑主軌(released→charged 放寬 + 雙扣 genesis):status IN (pending,released)→charged + rec_trade_id。released = late success 對帳收斂(§2.6)→ 同交易建 open anomaly(payment_double_charge_anomalies、ON CONFLICT old_attempt_id DO NOTHING、所有 NOT NULL 欄齊填、缺則 RAISE fail-closed 寧不收斂不漏記;refund_target=舊 attempt rec 絕不指向新單、amount=orders.total integer)。基線雙鍵驗 + FOR UPDATE + charged 同 rec 冪等 no-op + 跨單重複 rec 通用 RAISE 逐字保留。只 payment_confirmer 可呼(ACL 沿用基線、不改)。';


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   CREATE OR REPLACE FUNCTION public.mark_charge_attempt_charged(uuid, uuid, text) … 回 20260612150000 基線本體
--   (僅 pending→charged、無 genesis 區塊、SELECT 回 id/status/rec_trade_id)。
--   ⚠️ rollback 前若已有 released→charged 產生的 anomaly 列,屬真錢稽核資料、不可隨函式 rollback 連帶刪除。
-- ============================================================
