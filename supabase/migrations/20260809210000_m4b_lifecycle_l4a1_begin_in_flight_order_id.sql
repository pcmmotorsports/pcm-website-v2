-- ============================================================
-- M-4b 生命週期 L4a-1:begin_charge_attempt 的 user_in_flight 帶回在途單 order id
-- ============================================================
-- 真權威:docs/specs/2026-08-09-l4-slice-plan.md(v3;codex 關卡1 兩輪 R1/R2 各 7 must-fix 全處理)
--   + 母 plan docs/specs/2026-08-09-l4-l5-settlement-compensation-plan.md §2
--   + 主視窗 P-257-A 核准(Q1=A 值層守門 / Q2=A 前兩片先 commit)。
-- 依賴:20260804120000(A8c1,本函式的 live 定義)。鐵則 12①③。
-- ✅ 已 apply 正式站 2026-08-10 上午(Sean 拍 Q16=A;NOTICE 結構驗收全過)。P-282-A 裁 1 補記(主視窗代筆)。
--
-- 🔴 為什麼要改這支:action 層撞到 per-user 閘時,現行回傳**只有** {acquired:false, reason:'user_in_flight'}
--   —— 沒有 order id ⇒ action 層無從得知「要對哪一張在途單跑 settleCharge」⇒ 母 plan §2 的即時對帳
--   在現行契約下做不到。本片把那張在途單的 order id 帶回來(**server-only**,不得流到 UI:
--   charge-actions.ts:362 逐字「無 displayId(round3 C)」—— 此請求零扣款、不得讓客人以為有單)。
--
-- 🔴 相對 A8c1 恰 **兩處**改動(其餘逐字相同;做法=sed 抽 live 函式體 → 機械改兩處 → diff 核對,不手抄):
--   ① DECLARE 加 v_inflight_order_id uuid
--   ② per-user 閘 EXISTS(...) → 同述詞 SELECT ... INTO,IF FOUND 時多回 in_flight_order_id
--   ⚠️ diff 會顯示 **3 個 hunk**:②那處被中間「未改動的述詞行」切成兩段。改動點是 2、hunk 是 3。
--
-- 🔴 述詞一字未改 ⇒ 「擋 / 不擋」的判斷與 A8c1 完全相同;SELECT INTO 後的 FOUND ⇔ 舊 EXISTS 為真。
--   新增的 ORDER BY 只決定「回哪一張」,不參與閘的判斷;a.id DESC 是 tie-breaker。
--   🔴 排序第一鍵 = (a.status = 'charged') DESC(R3 換模型審查 F4,主視窗直接裁):
--      同一會員同時有 charged-未-paid(錢很可能已經動了)與較新的 pending 時,
--      回較新的 pending = 把對帳目標指向**證據弱**的那張。charged 優先才是對帳該看的那張。
--      這個取捨不是本片發明的 —— 逐字比照 cart dedup 那段已被 codex 硬化過的 ORDER BY 前例。
--   (同 created_at 時不得任選 —— 否則「拿掉 tie-breaker」這個突變會存活)。
--
-- 🔴 不回 attempt_id、不回 rec_trade_id、不回 display_id(plan §2 逐條理由):
--   · attempt_id:閘的真相由「重試那一次 begin」重新認定,不由我們手上的識別碼認定 ⇒ pin 一個會過期的
--     識別碼不增加安全性(codex 關卡1 R2 逐字背書:「作者對…找不到可重現的雙扣時序」)。
--   · rec_trade_id:settleCharge 以 orderId 重查 attempt、自取強鍵(settle-charge.ts:74,77)⇒ 多餘。
--   · display_id:對客不得帶單號。**沒帶進來的東西洩不出去**,這比事後守門強。
--
-- 🔴 payload 是加欄、不是改欄:舊 app 的 parseBeginResult 不讀未知 key ⇒ DB 新 × app 舊安全;
--   新 app 拿不到該欄時即時對帳整段 skip ⇒ app 新 × DB 舊安全。
--   ⚠️ 但**本片沒有任何一格測到這兩個方向** —— 6a/6b/6c 是 L4a-2 / L4b 的測試(plan §5-6),
--      本片已驗的只有 DB 側 9 格矩陣 + 8 發突變(scripts/l4a1-verify.sh)。上面兩句是**設計論證**,不是實測。
--   ⚠️ 但不得說成「零行為」:payload 確實變了,不變的是 **app 可觀察行為**。
--
-- ⛔ apply 停點:本檔 commit 後不 apply。動 begin_charge_attempt = 錢的面 ⇒ 主視窗照 Q10 例外停下問 Sean。
-- Rollback(forward-only;plan §2):CREATE OR REPLACE 回 A8c1 逐字(20260804120000:71-202)+ 還原 COMMENT。
--   L4b 若已上線,兩種順序都安全(app 新 × DB 舊 = 安全 skip);建議先撤 app 純為觀測性。
--   read-back:撤 app 後驗撞窗回舊文案且零 settleCharge;回 SQL 後驗 md5(functiondef) = f621a56231e20f7f0b2618b40ac1276d。
-- ============================================================

BEGIN;

-- ── 0. 前置閘:begin 現定義必為 A8c1(2026-08-09 於本片自己的拋棄庫實測,PORT=54372)──
--    只釘 begin 一支:A8c1 另釘 mark 家族三支是為了防 #321 倒寫**它們**;本片不碰那三支
--    ⇒ 多釘 = 與本片無關的假前置條件(前置閘該擋的是「我要改的那支不是我以為的版本」)。
DO $$
DECLARE v text;
BEGIN
  v := md5(pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure));
  IF v <> 'f621a56231e20f7f0b2618b40ac1276d' THEN
    RAISE EXCEPTION 'L4a-1 前置閘:begin_charge_attempt 現定義非 A8c1(md5=%);疑非預期版本,停下人工對齊', v;
  END IF;
END
$$;


-- ── 1. begin_charge_attempt CREATE OR REPLACE(A8c1 + 兩處;plan §2)──
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
  v_inflight_order_id uuid;  -- 🔴 L4 新增:per-user 閘擋下時、那張在途單的 order id(server-only)
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
  SELECT a.order_id
    INTO v_inflight_order_id
      FROM public.payment_charge_attempts a
      JOIN public.orders o ON o.id = a.order_id
     WHERE a.customer_user_id = v_order.customer_user_id
       AND a.order_id <> p_order_id
       AND a.status IN ('pending', 'charged')
       AND a.created_at > pg_catalog.now() - interval '10 minutes'
       AND o.payment_status <> 'paid'::public.payment_status
     ORDER BY (a.status = 'charged') DESC, a.created_at DESC, a.id DESC
     LIMIT 1;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'acquired', false, 'reason', 'user_in_flight',
      'in_flight_order_id', v_inflight_order_id
    );
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
  'M-3-S2-d 佔 per-order charge 鎖 + per-user 10 分鐘閘 + 發備軌 token + 3DS-0b cart dedup(D4)+ 3DS-0c needs_settle 帶 existing_bank_transaction_id + E10-A8c1 取消守門(master plan row 34;R8 守門先於取消)+ 🔴 M-4b L4a-1 user_in_flight 帶 in_flight_order_id。begin 序:隔離閘(非 READ COMMITTED 一律 P8C01 —— RR 等鎖醒來舊快照會漏看已 commit 取消)→ FOR UPDATE 讀 order(orders 列鎖=第一個觸表動作,§5.0 鎖序合約;關掉舊「檢查後翻 paid」race)→ 取消守門(cancelled_at 非空或 order_cancellations 任一列 ⇒ 通用 RAISE;真相表直讀、不讀摘要)→ cart_session_id null fail-closed → not_unpaid → advisory xact lock → cart dedup(paid:duplicate / 其餘扣款跡象:needs_settle)→ user_in_flight → 佔鎖/order_locked。🔴 L4a-1:per-user 閘由 EXISTS 改為同述詞 SELECT INTO(述詞一字未改、擋/不擋判斷不變;ORDER BY created_at DESC, id DESC 只決定回哪一張),擋下時回 in_flight_order_id 供 action 層對那張在途單跑一次 settleCharge。該欄 **server-only**:對客不得帶單號(此請求零扣款),刻意不回 display_id/attempt_id/rec_trade_id。已知可用性面=與 released→charged genesis 的 40P01 單方 victim(Sean 2026-08-04 拍板接受;倖存 begin 必 order_locked、零新增收款路徑;根治=backlog #321)。只 payment_confirmer 可呼。';

-- ── 2. 結構 assert:L4 新錨 + A8c1 五錨逐字保留 + ACL 窮舉 + SECDEF fail-open 面 ──
DO $$
DECLARE v_def text; v_anchor text; v_hits int;
BEGIN
  v_def := pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure);

  -- 🔴 L4 新錨:per-user 閘**整段連續字串**當一條錨,不拆成五條 position()。
  --    理由(codex 關卡1 R2 抓到、本片最重要的一條):cart dedup 區(A8c1 :138,145)本來就有
  --    a.status IN ('pending', 'charged') 與 o.payment_status = 'paid'::public.payment_status
  --    這些字串 ⇒ 拆成五條各搜整支函式時,**刪掉 per-user 閘那一條述詞,dedup 區照樣供得出同一個字串
  --    ⇒ assert 假綠**(memory feedback_negative-test-observation-supplied-by-another-mechanism 逐字重現)。
  --    整段錨 ⇒ 刪任一條述詞、改任一個運算子、動 ORDER BY,整段都不再命中 ⇒ 紅。
  --    🔴 錨的範圍必須含到 END IF(codex 關卡2 R1 抓到,原本只錨到 LIMIT 1):
  --    把 `IF FOUND` 改成 `IF NOT FOUND` —— 述詞一字沒動、in_flight_order_id 也還在
  --    ⇒ 舊版錨與「回傳含該欄」那條錨**全綠**,但閘的行為已經整個反轉
  --    (有在途單反而放行、沒有反而擋)。⇒ 錨要同時涵蓋 **述詞 + 控制流 + 回傳** 三者。
  --    (原本另一條獨立的「回傳含 in_flight_order_id」position() 錨已被本錨完全涵蓋 ⇒ 刪掉;
  --     留著只會讓人以為那裡還有第二道獨立防線。)
  v_anchor := $anchor$  SELECT a.order_id
    INTO v_inflight_order_id
      FROM public.payment_charge_attempts a
      JOIN public.orders o ON o.id = a.order_id
     WHERE a.customer_user_id = v_order.customer_user_id
       AND a.order_id <> p_order_id
       AND a.status IN ('pending', 'charged')
       AND a.created_at > pg_catalog.now() - interval '10 minutes'
       AND o.payment_status <> 'paid'::public.payment_status
     ORDER BY (a.status = 'charged') DESC, a.created_at DESC, a.id DESC
     LIMIT 1;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'acquired', false, 'reason', 'user_in_flight',
      'in_flight_order_id', v_inflight_order_id
    );
  END IF;$anchor$;
  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'L4a-1 結構 assert:per-user 閘整段錨出現 % 次(應恰 1);述詞/控制流/回傳被動過或閘被複製;拒繼續', v_hits;
  END IF;

  -- 🔴 A8c1 五錨逐字保留 —— 本片是 CREATE OR REPLACE 整支函式,
  --    抄錯一行就會把 A8c1 的取消守門弄不見,這五條是唯一會喊的人。
  IF position(E'USING ERRCODE = \'P8C01\'' in v_def) = 0 THEN
    RAISE EXCEPTION 'L4a-1 結構 assert:A8c1 隔離閘碼錨缺失;拒繼續';
  END IF;
  IF position(E'WHERE id = p_order_id\n     FOR UPDATE;' in v_def) = 0 THEN
    RAISE EXCEPTION 'L4a-1 結構 assert:A8c1 FOR UPDATE 碼錨缺失;拒繼續';
  END IF;
  IF position('IF v_order.cancelled_at IS NOT NULL' in v_def) = 0
     OR position('OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)' in v_def) = 0 THEN
    RAISE EXCEPTION 'L4a-1 結構 assert:A8c1 取消守門碼錨缺失;拒繼續';
  END IF;
  IF position('ORDER BY (o.payment_status = ''paid''::public.payment_status) DESC, (a.status = ''charged'') DESC, o.created_at DESC' in v_def) = 0 THEN
    RAISE EXCEPTION 'L4a-1 結構 assert:0c dedup ORDER BY 逐字錨缺失(zero-regression 破);拒繼續';
  END IF;
  IF position('ON CONFLICT (order_id) WHERE status IN (''pending'', ''charged'') DO NOTHING' in v_def) = 0 THEN
    RAISE EXCEPTION 'L4a-1 結構 assert:0c 佔鎖 INSERT 逐字錨缺失(zero-regression 破);拒繼續';
  END IF;

  -- 🔴 R3 換模型審查 F5 補三錨:這三段同屬「抄掉了也沒有人會喊」那一族。
  --    A8c1 的五錨守的是取消守門與 dedup;per-user 閘之前還有三道各自獨立的安全面,
  --    本片既然是 CREATE OR REPLACE 整支函式,它們一樣在「抄錯一行就不見」的射程內。
  IF position('PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order.customer_user_id::text, 0));' in v_def) = 0 THEN
    RAISE EXCEPTION 'L4a-1 結構 assert:per-user advisory xact lock 碼錨缺失(閘失去序列化);拒繼續';
  END IF;
  IF position('IF v_order.cart_session_id IS NULL THEN' in v_def) = 0 THEN
    RAISE EXCEPTION 'L4a-1 結構 assert:cart_session_id null fail-closed 碼錨缺失;拒繼續';
  END IF;
  IF position('''acquired'', false, ''reason'', ''not_unpaid''' in v_def) = 0 THEN
    RAISE EXCEPTION 'L4a-1 結構 assert:not_unpaid 出口碼錨缺失;拒繼續';
  END IF;

  -- ACL 窮舉(沿用 A8c1:抽查三角色證不了「只 payment_confirmer」;is_grantable 併入指紋)
  DECLARE v_grantees text;
  BEGIN
    SELECT string_agg(g, ',' ORDER BY g)
      INTO v_grantees
      FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
                   || CASE WHEN a.is_grantable THEN '+GRANTOPT' ELSE '' END AS g
              FROM pg_proc p, aclexplode(p.proacl) a
             WHERE p.oid = 'public.begin_charge_attempt(uuid)'::regprocedure
               AND a.privilege_type = 'EXECUTE') t;
    IF v_grantees IS DISTINCT FROM 'payment_confirmer,postgres' THEN
      RAISE EXCEPTION 'L4a-1 ACL 窮舉異常 — EXECUTE grantee 全集=[%],應恰 payment_confirmer,postgres 且零 GRANT OPTION;拒繼續', v_grantees;
    END IF;
  END;

  -- SECDEF fail-open 面(沿用 A8c1:守門讀 zero-policy 表,依賴 owner 讀取不受 RLS 攔)
  DECLARE v_fn_owner oid; v_bad text;
  BEGIN
    SELECT proowner INTO v_fn_owner FROM pg_proc WHERE oid='public.begin_charge_attempt(uuid)'::regprocedure;
    SELECT string_agg(c.relname, ',') INTO v_bad
      FROM pg_class c
     WHERE c.oid IN ('public.orders'::regclass, 'public.order_cancellations'::regclass, 'public.payment_charge_attempts'::regclass)
       AND (c.relowner <> v_fn_owner OR c.relforcerowsecurity);
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'L4a-1 SECDEF fail-open 面 — [%] owner 不對齊或 FORCE RLS on ⇒ 守門可讀空;拒繼續', v_bad;
    END IF;
  END;

  RAISE NOTICE 'L4a-1 結構驗收全數通過(per-user 整段錨恰 1 次 / in_flight_order_id 回傳 / A8c1 五錨 / ACL 窮舉 / SECDEF fail-open 面)';
END
$$;

COMMIT;
