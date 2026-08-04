-- ============================================================
-- M-4b E10 第 1 批 · A8c1:begin_charge_attempt 金流 begin 側取消守門
-- ============================================================
-- 真權威:docs/specs/2026-08-04-e10-a8c1-begin-cancel-guard-plan.md(v6;關卡1 六輪 R1-R5 FAIL→R6 PASS)
--   + master plan row 34(2026-07-28-e10-order-closure-master-plan-v2.md:381)+ §5.0 :258-261(R8 部署序)
--   + Sean 2026-08-04 拍板 Q1=A(pcm-mailbox A-09-A:genesis 死結列已知可用性面、COMMENT 更正、backlog #319)。
-- 依賴:20260613140000(0c 基底)、20260730130000(A7 order_cancellations)、20260712203000(orders.cancelled_at)。
-- 鐵則 12①(動既有金流函式)。
--
-- 🔴 設計(plan §3.2,相對 0c 恰五處):
--   ① 隔離閘:非 READ COMMITTED ⇒ RAISE P8C01(RR 下等鎖醒來舊快照、部分取消不動 orders 列
--      不觸發序列化錯誤 ⇒ EXISTS 看不到已 commit 取消;A2b1 同款教訓)。
--   ② 初始 SELECT 加 cancelled_at 欄 + FOR UPDATE(§5.0 鎖序合約:orders 列鎖=第一個觸表動作;
--      附帶關掉 0c :104-107 自陳的「檢查後翻 paid」理論 race)。
--   ③ NOT FOUND 後取消守門塊:cancelled_at 非空或 order_cancellations 任一列 ⇒ RAISE 通用訊息
--      (真相表直讀、零摘要表;PF-E 不洩取消狀態)。
--   ④ 0c 過時註解更正(原「此讀無 row lock…理論 race」在新本體為假話 ⇒ 改述 race 已關;
--      註解也是本體、假話不留)。
--   ⑤ COMMENT 更新(本檔另帶三支 mark 家族 COMMENT 字面更正,零行為)。
--   其餘(dedup 三態、ORDER BY、null fail-closed、五 outcome、advisory、佔鎖 INSERT、ACL)一字不動;
--   零 TS 改動(呼叫端 PgChargeAttemptAdapter.ts:66 RAISE→throw 既有路徑)。
--
-- 🔴 已知可用性面(Sean 2026-08-04 拍板 Q1=A 接受;實測=scripts/a8c1-verify.sh L4):
--   begin(orders-first)× mark_charge_attempt_charged released→charged genesis(attempt-first)
--   = 40P01 單方 victim;倖存 begin 必 order_locked(order_lock_idx 述詞含 released,pg_indexes 親驗)
--   ⇒ 兩向零新增收款路徑。根治=mark 家族三支統一 orders-first(backlog #319)。
--   mark_failed / close_released_attempt × begin=只阻塞不死結(實測;其 UPDATE 在 orders 鎖後)。
--   新失敗面:等鎖 >5s = 55P03(payment_confirmer lock_timeout,20260611120000:74)。
--
-- 🔴 前置閘(plan §3.8;防 #319 先落地被本檔倒寫):四支 functiondef md5 必=已知值,
--   不符=RAISE 停下人工對齊。COMMENT 不入 pg_get_functiondef ⇒ harness §5.3「先回 0c 再重放」
--   流程冪等;🔴 直接二次 apply 會紅在 begin=0c 閘(forward-only、預期行為、非 bug)。
--   🔴 md5 pin=同 PG17 版本內的漂移偵測;pg_get_functiondef 跨版本不保證 byte-identical,
--   不符時安全 false-stop 人工對齊,非可攜語意證明。
--
-- ⛔ apply 停點:本檔 commit 後不 apply;apply 前唯讀檢查七條=plan §7(含 orders.cancelled_at
--   非空名單、隔離預設三層、order_lock_idx 述詞 pin);apply 後驗證+rollback 決策樹同節。
-- 動手前模擬:剝殼(去 BEGIN/COMMIT)後於拋棄庫「BEGIN→全文→斷言→ROLLBACK」通過(見 plan §6-9)。
-- Rollback(forward-only、僅供參考):plan §7 決策樹逐字 —— 取消資料存在或 writer 活著時
--   禁止單獨回 0c;分支1=單一交易 LOCK orders EXCLUSIVE→LOCK cancellations ACCESS EXCLUSIVE
--   →三 assert→REPLACE 回 0c(20260613140000:73-192 逐字)+還原四 COMMENT→COMMIT。
-- ============================================================

BEGIN;

-- ── 0. 前置閘:四支 functiondef md5(拋棄庫 2026-08-04 量定;§7 於 prod apply 前重驗同值)──
DO $$
DECLARE v text;
BEGIN
  v := md5(pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure));
  IF v <> '55e32431df7af3ab6eefa18555af9e6b' THEN
    RAISE EXCEPTION 'A8c1 前置閘:begin_charge_attempt 現定義非 0c(md5=%);疑非預期版本,停下人工對齊', v;
  END IF;
  v := md5(pg_get_functiondef('public.mark_charge_attempt_failed(uuid,uuid)'::regprocedure));
  IF v <> 'fd87db5732a12c4688babc6a46c1e508' THEN
    RAISE EXCEPTION 'A8c1 前置閘:mark_charge_attempt_failed 定義漂移(md5=%);#319 已動它?停下人工對齊', v;
  END IF;
  v := md5(pg_get_functiondef('public.mark_charge_attempt_charged(uuid,uuid,text)'::regprocedure));
  IF v <> '7334ef0e2ee7f89a093bd8a7bda98828' THEN
    RAISE EXCEPTION 'A8c1 前置閘:mark_charge_attempt_charged 定義漂移(md5=%);#319 已動它?停下人工對齊', v;
  END IF;
  v := md5(pg_get_functiondef('public.close_released_attempt(uuid,text)'::regprocedure));
  IF v <> '717bcf80e4d913f1fd047ea2d7c1a667' THEN
    RAISE EXCEPTION 'A8c1 前置閘:close_released_attempt 定義漂移(md5=%);#319 已動它?停下人工對齊', v;
  END IF;
END
$$;


-- ── 1. begin_charge_attempt CREATE OR REPLACE(0c + 五處;plan §3.2)──
CREATE OR REPLACE FUNCTION public.begin_charge_attempt(p_order_id uuid)
RETURNS jsonb  -- {acquired bool, attempt_id?, fallback_token?, reason?: user_in_flight|order_locked|not_unpaid|duplicate|needs_settle, existing_*?}
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order        record;
  v_attempt_id   uuid;
  v_token        uuid;
  v_dup_order_id uuid;
  v_dup_display  text;
  v_dup_paid     boolean;
  v_dup_rec      text;
  v_dup_bank     text;  -- 🔴 3DS-0c 新增(needs_settle 帶 existing_bank_transaction_id)
  v_generic_msg constant text := 'begin_charge_attempt: 付款處理失敗';  -- PF-E 通用訊息
BEGIN
  -- 🔴 A8c1 隔離閘(fail-closed;A2b1 同款教訓):非 READ COMMITTED 下,FOR UPDATE 等鎖醒來後
  --    快照仍舊、部分取消不動 orders 列不觸發 RR 序列化錯誤 ⇒ EXISTS 看不到已 commit 取消。
  --    正常呼叫端(PgChargeAttemptAdapter 單語句 autocommit)恆 RC、不受影響。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'begin_charge_attempt: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  -- 訂單存在 + 取歸屬 + cart_session_id(customer_user_id/cart_session_id 從 orders 讀、零信任參數)
  SELECT id, customer_user_id, payment_status, cart_session_id, cancelled_at
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 A8c1 取消守門(master plan row 34;R8 部署序=守門先於取消):存在任何取消紀錄 ⇒ 拒開卡。
  --    真相=orders.cancelled_at + order_cancellations 本表(A1 契約:守門不讀摘要表);
  --    互斥保證=上方 FOR UPDATE 與取消 RPC(A8a1/A8a2 依 §5.0 合約)同鎖;通用訊息=PF-E。
  IF v_order.cancelled_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 3DS-0b fail-closed:cart_session_id 必有(5-param create_order 入口強制寫;舊 4-param 已 DROP → 無無 key 單)
  IF v_order.cart_session_id IS NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 已 paid / refunded / partiallyPaid → 不開新 charge(與撞鎖同層級回覆、不洩具體狀態)
  -- 🔴 A8c1 起本讀持 FOR UPDATE 列鎖:0c 自陳的「檢查後翻 paid」理論 race 已被鎖關閉
  --    (與 confirm 的 PF-B 同鎖全序列化;舊註解「此讀無 row lock」自本片起不再為真)。
  IF v_order.payment_status <> 'unpaid'::public.payment_status THEN
    RETURN pg_catalog.jsonb_build_object('acquired', false, 'reason', 'not_unpaid');
  END IF;

  -- 🔴 per-user 序列化(Q2=A):advisory xact lock(交易結束自動釋放、不跨外部 HTTP)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order.customer_user_id::text, 0));

  -- 🔴 3DS-0b cart-instance dedup(D4 override;關卡1 fix-1:移到 user_in_flight 閘「前」)──
  -- 同 user + 同 cart_session_id + 異單,三態已扣款/扣款中證據(無時間窗、advisory lock 內 race-safe):
  --   支1 a.status='charged'(已實扣、rec 必存)/ 支2 o.payment_status='paid'(已 confirm、attempt 可能 pending)
  --   / 支3 a.status='pending' AND o 未 paid(orphan、錢可能扣)。
  -- LEFT JOIN 僅 active(pending|charged)attempt(per-order unique 保證至多一筆);ORDER BY paid 優先 → 已 paid sibling
  --   先被選為 duplicate、否則取最近 orphan 為 needs_settle。
  SELECT o.id, o.display_id, (o.payment_status = 'paid'::public.payment_status), a.rec_trade_id, a.bank_transaction_id
    INTO v_dup_order_id, v_dup_display, v_dup_paid, v_dup_rec, v_dup_bank
    FROM public.orders o
    LEFT JOIN public.payment_charge_attempts a
      ON a.order_id = o.id AND a.status IN ('pending', 'charged')
   WHERE o.customer_user_id = v_order.customer_user_id
     AND o.id              <> p_order_id
     AND o.cart_session_id  = v_order.cart_session_id
     AND (
          a.status = 'charged'
       OR o.payment_status = 'paid'::public.payment_status
       OR (a.status = 'pending' AND o.payment_status <> 'paid'::public.payment_status)
     )
   -- 排序:paid sibling 優先(→duplicate);非 paid 間 charged(已實扣、最強證據)優先於 pending,再最近(codex 關卡2 #3)
   ORDER BY (o.payment_status = 'paid'::public.payment_status) DESC, (a.status = 'charged') DESC, o.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    IF v_dup_paid THEN
      -- sibling 已 paid = DB 確定完成 → 照實顯既有單(D2)
      RETURN pg_catalog.jsonb_build_object(
        'acquired', false, 'reason', 'duplicate',
        'existing_display_id', v_dup_display, 'existing_paid', true
      );
    END IF;
    -- charged-未-paid / pending-未-paid = DB 無法確定扣款與否 → 交上層 settleCharge〔3DS-1b〕Record 即時裁決(D4)
    RETURN pg_catalog.jsonb_build_object(
      'acquired', false, 'reason', 'needs_settle',
      'existing_order_id', v_dup_order_id,
      'existing_display_id', v_dup_display,
      'existing_rec_trade_id', v_dup_rec,
      'existing_bank_transaction_id', v_dup_bank  -- 🔴 3DS-0c 新增(codex #1;settleCharge Record 查詢鍵之一)
    );
  END IF;

  -- 🔴 per-user 閘(Q2=A;round2 MF1 + round3 MF 統一 predicate;原封不動、僅移到 dedup 後 → 硬約束② 守):
  -- 「未解決付款」= 10 分鐘內、異單、active(pending|charged)、且該單尚未 paid(join orders:
  --   charged-未-paid 也擋〔雙扣視窗〕;pending-但-已-paid 放行〔不誤卡〕)。異 cart 走此擋(同 cart 已被 dedup 攔)。
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
  'M-3-S2-d 佔 per-order charge 鎖 + per-user 10 分鐘閘 + 發備軌 token + 3DS-0b cart dedup(D4)+ 3DS-0c needs_settle 帶 existing_bank_transaction_id + 🔴 E10-A8c1 取消守門(master plan row 34;R8 守門先於取消)。begin 序:隔離閘(非 READ COMMITTED 一律 P8C01 —— RR 等鎖醒來舊快照會漏看已 commit 取消)→ FOR UPDATE 讀 order(orders 列鎖=第一個觸表動作,§5.0 鎖序合約;關掉舊「檢查後翻 paid」race)→ 取消守門(cancelled_at 非空或 order_cancellations 任一列 ⇒ 通用 RAISE;真相表直讀、不讀摘要)→ cart_session_id null fail-closed → not_unpaid → advisory xact lock → cart dedup(paid:duplicate / 其餘扣款跡象:needs_settle)→ user_in_flight → 佔鎖/order_locked。已知可用性面=與 released→charged genesis 的 40P01 單方 victim(Sean 2026-08-04 拍板接受;倖存 begin 必 order_locked、零新增收款路徑;根治=backlog #319)。只 payment_confirmer 可呼。';


-- ── 2. mark 家族三支 COMMENT 字面更正(零行為;A8c1 打破「無 order→attempt 反向鎖序」不變式)──
COMMENT ON FUNCTION public.mark_charge_attempt_failed(uuid, uuid) IS
  'M-3 3DS R1b2 卡拒(TapPay 明確未扣款)釋 per-order 鎖:pending→failed + 🔴 order-paid guard(同交易鎖 order、payment_status<>unpaid → RAISE,杜絕已付款單被標 failed=late success 退出對帳;FOR UPDATE 序列化對 confirm 防 TOCTOU)。🔴 鎖序 attempt→order;E10-A8c1(2026-08-04)起 begin 持 orders 先鎖 ⇒「無反向鎖序」舊字面失效——本函式對 begin 只阻塞不死結(實測:其 order 鎖在 begin 持鎖期不可達、begin 的 arbiter 對 lock-only pending 列不等待;scripts/a8c1-verify.sh L3a)。雙鍵驗 + failed 冪等 no-op(guard 前、不受 order 狀態影響)+ charged→failed 永拒 + released→failed 隨 status=pending 述詞排除(走 R1c3 close/§2.5 policy)。只 payment_confirmer 可呼(ACL 沿用基線、不改)。';

COMMENT ON FUNCTION public.mark_charge_attempt_charged(uuid, uuid, text) IS
  'M-3 3DS R1b1c PF-X1 麵包屑主軌(released→charged 放寬 + 雙扣 genesis):status IN (pending,released)→charged + rec_trade_id。released = late success 對帳收斂(§2.6)→ 同交易建 open anomaly(payment_double_charge_anomalies、ON CONFLICT old_attempt_id DO NOTHING、所有 NOT NULL 欄齊填、缺則 RAISE fail-closed 寧不收斂不漏記;refund_target=舊 attempt rec 絕不指向新單、amount=orders.total integer)。🔴 已知死結面(E10-A8c1 2026-08-04,Sean 拍板接受、backlog #319):genesis 路徑(鎖 attempt→UPDATE charged→anomaly FK 等 orders KEY SHARE)× begin(orders-first)= 40P01 單方 victim;倖存 begin 必 order_locked(order_lock_idx 述詞含 released)⇒ 零新增收款路徑;victim=本函式時 late-success 收斂延後重試。基線雙鍵驗 + FOR UPDATE + charged 同 rec 冪等 no-op + 跨單重複 rec 通用 RAISE 逐字保留。只 payment_confirmer 可呼(ACL 沿用基線、不改)。';

COMMENT ON FUNCTION public.close_released_attempt(uuid, text) IS
  'M-3 3DS R1c3 owner-only 人工結案(SECDEF、search_path='''')。Sean 取得 TapPay 明確終局(未扣款)後收尾 released attempt:released→failed + 寫 released_closed_at=now()/released_closed_by=session_user/released_close_resolution=p_resolution(三欄成組、滿足 R1a1 group_chk)。order-paid guard fail-closed(order 非 unpaid → RAISE,潛在雙扣走 W1 退款)+ charged/pending/plain-failed 拒(僅 released 可 close)+ 重複 close 冪等(failed+closed_at 非 NULL → no-op、保留首次三欄、{idempotent:true})。🔴 鎖序 attempt→order;E10-A8c1(2026-08-04)起 begin 持 orders 先鎖 ⇒「無反向鎖序 ⇒ 無死結」舊字面(本檔源 migration 檔頭 :24-27)失效——本函式對 begin 只阻塞不死結(同構 mark_failed;實測 scripts/a8c1-verify.sh L3b)。p_resolution 自由文字(非 enum、btrim 非空)。REVOKE 5 角色含 payment_confirmer、無 GRANT = owner/postgres only(Phase 1 受控人工流程)。';


-- ── 3. 結構 assert:新版四錨 + ACL 回歸(0c 慣例)──
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure);
  -- 🔴 錨=可執行碼逐字(含換行),不用會被註解誤中的裸關鍵字(codex 關卡2 抓)
  IF position(E'USING ERRCODE = \'P8C01\'' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8c1 結構 assert:隔離閘碼錨缺失;拒繼續';
  END IF;
  IF position(E'WHERE id = p_order_id\n     FOR UPDATE;' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8c1 結構 assert:FOR UPDATE 碼錨缺失;拒繼續';
  END IF;
  IF position('IF v_order.cancelled_at IS NOT NULL' in v_def) = 0
     OR position('OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8c1 結構 assert:取消守門碼錨缺失;拒繼續';
  END IF;
  IF position('ORDER BY (o.payment_status = ''paid''::public.payment_status) DESC, (a.status = ''charged'') DESC, o.created_at DESC' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8c1 結構 assert:0c dedup ORDER BY 逐字錨缺失(zero-regression 破);拒繼續';
  END IF;
  IF position('ON CONFLICT (order_id) WHERE status IN (''pending'', ''charged'') DO NOTHING' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8c1 結構 assert:0c 佔鎖 INSERT 逐字錨缺失(zero-regression 破);拒繼續';
  END IF;
  IF has_function_privilege('anon',          'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.begin_charge_attempt(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('payment_confirmer', 'public.begin_charge_attempt(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A8c1 ACL 回歸異常 — begin 應只 payment_confirmer 可呼;拒繼續';
  END IF;
  -- 🔴 窮舉 ACL(codex 關卡2:抽查三角色證不了「只 payment_confirmer」):
  --    EXECUTE grantee 全集必恰 = {owner, payment_confirmer}(proacl NULL=PUBLIC 預設,一樣紅)
  DECLARE v_grantees text;
  BEGIN
    SELECT string_agg(g, ',' ORDER BY g)
      INTO v_grantees
      FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
                   || CASE WHEN a.is_grantable THEN '+GRANTOPT' ELSE '' END AS g
              FROM pg_proc p, aclexplode(p.proacl) a
             WHERE p.oid = 'public.begin_charge_attempt(uuid)'::regprocedure
               AND a.privilege_type = 'EXECUTE') t;
    -- 🔴 is_grantable 併入指紋(codex 關卡2 R2:WITH GRANT OPTION 不得靜默通過)
    IF v_grantees IS DISTINCT FROM 'payment_confirmer,postgres' THEN
      RAISE EXCEPTION 'A8c1 ACL 窮舉異常 — EXECUTE grantee 全集=[%],應恰 payment_confirmer,postgres 且零 GRANT OPTION;拒繼續', v_grantees;
    END IF;
  END;
  -- 🔴 SECDEF fail-open 面(codex 關卡2):守門 EXISTS 讀 zero-policy 表,依賴
  --    「owner 讀取不受 RLS 攔」⇒ 必 assert owner 對齊 + FORCE RLS off,否則守門讀空=放行
  DECLARE v_fn_owner oid; v_bad text;
  BEGIN
    SELECT proowner INTO v_fn_owner FROM pg_proc WHERE oid='public.begin_charge_attempt(uuid)'::regprocedure;
    SELECT string_agg(c.relname, ',') INTO v_bad
      FROM pg_class c
     WHERE c.oid IN ('public.orders'::regclass, 'public.order_cancellations'::regclass, 'public.payment_charge_attempts'::regclass)
       AND (c.relowner <> v_fn_owner OR c.relforcerowsecurity);
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'A8c1 SECDEF fail-open 面 — [%] owner 不對齊或 FORCE RLS on ⇒ 守門可讀空;拒繼續', v_bad;
    END IF;
  END;
END
$$;

COMMIT;
