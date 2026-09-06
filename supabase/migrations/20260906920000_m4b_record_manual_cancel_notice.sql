-- ⟦b4-CANCELMAILMIXEDRAIL⟧ 片 B 的【原子寫入】—— 把資格檢查與寫入關進同一個交易。
--
-- ══ 這一支為什麼存在(它不是新功能, 是把一個窗口關掉)══════════════════════
-- 片 B ①②③(`193b6a8e5`)的 server action 是**先讀資格、再 insert**, 而兩步之間
-- **沒有共同交易也沒有鎖**。codex `gpt-6-astra` R3 must-fix ① 給的反例(我核過):
--   總額 5000、卡退 4000、**人工退款兩筆各 500**。
--   我讀完資格(合格)之後, 另一個人**作廢其中一筆** ⇒ `20260905440000` 把已退金額
--   算成 4500 < 5000 ⇒ `payment_status` 降成 `partiallyRefunded`
--   ⇒ 🛑 **我仍然無條件插入那一列** ⇒ 寫入的當下它**已經不合格**了
--   ⇒ 📌 而日後卡上補退滿、狀態回到 `refunded` 時, 這一列會讓它被 anti-join 排除
--     ⇒ ⇒ **那位客人的系統取消信【永久關閉】, 而沒有人會知道。**
-- 🔵 主視窗 2026-09-06 裁 `Q-片B的TOCTOU = 乙`, 理由逐字:
--   **「這片的價值就是不讓那位客人的信永久關掉, 而甲留下的正是那個後果。」**
--
-- ══ 🔴 現成的對照:這個形狀 repo 裡已經有人做過 ══════════════════════════════
-- `apps/admin/src/lib/mail/dead-letter-actions.ts:64-67` 逐字:
--   「前置判斷與 RPC 的白名單**刻意同義而不是取代**;這裡先判是為了給員工一句看得懂的話
--    (而不是一個 500);而真正的防線仍是 RPC 裡的 `FOR UPDATE` + 白名單 —— 兩個人同時按時,
--    **只有那一側擋得住**(這裡讀完到那裡鎖住之間, 狀態仍可能變)。」
-- ⇒ 📌 **本支就是片 B 缺的那一側。** TS 那邊的資格檢查**不拿掉** —— 它負責訊息, 本支負責正確性。
--
-- ══ 🛑 述詞是怎麼來的:與另外兩份【刻意同源】═══════════════════════════════
-- 這是本片的第三份字面(TS 的 `manual-cancel-notice-read.ts` · SQL 的 `20260906620000` · 本支),
-- 而**沒有任何東西會在它們分岔時叫**。三份都鏡像同一個權威:
-- `20260905310000_m4b_cancelled_email_pending_view.sql` 的 `:178` `:179` `:180`
-- 與 outbox anti-join, **只把人工退款那一條 `NOT EXISTS` 翻成 `EXISTS`**。
-- ⚠️ **改任一份要三份一起改。** 這句話在三支檔裡各寫一次, 是刻意的重複。
--
-- ══ 🔴 為什麼是 SECURITY DEFINER 而不是靠 RLS ═════════════════════════════
-- 呼叫端是後台的 server action(service_role), 而**授權已經在 TS 那一側做完**
-- (`authorizeManagerMutation` —— session 自驗 + Origin fail-closed + 具名 actor)。
-- 本支要的是**交易內的述詞重檢**, 不是第二套身分系統。
-- 🛑 而**收權照 `docs/patterns/revoking-function-execute-in-supabase.md` 兩道 REVOKE**:
--   新物件出生就自帶 `PUBLIC` 的 EXECUTE, 而 `proacl IS NULL` 時 `has_function_privilege`
--   **看不出來** —— 那正是那份 pattern 存在的理由。
--
-- ══ 🛑 三件這一支【證不到】的事 ═══════════════════════════════════════════
-- ① **收權斷言看不到 role membership**(整族的已知天花板, 逐字抄自 `20260904280000` ①)。
-- ② **它擋不住「兩個人各自寄了一封信」** —— 本支保證的是**只有一列寫得進去**,
--    而**兩個人真的各寄了一封給客人**這件事, DB 管不到。那一格屬流程不屬碼。
-- ③ **它不保證那封信真的寄到了** —— 這一列只是「有人宣稱他寄了」。
--    (SOP 逐字寫過同一句:「那一列只證明有人按了那顆鈕, 不證明信到了他信箱」。)

BEGIN;

-- ── 前置閘:本支依賴的東西在不在 ──────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.order_manual_refunds'::regclass
       AND a.attname = 'voided_at' AND a.attnum > 0 AND NOT a.attisdropped)
  THEN
    RAISE EXCEPTION '前置閘:order_manual_refunds 沒有 voided_at ⇒ 20260820090000 還沒貼';
  END IF;
  IF pg_catalog.to_regprocedure('public.get_cancelled_mixed_rail_gap_counts()') IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 get_cancelled_mixed_rail_gap_counts ⇒ 20260906620000(貼板 55)還沒貼';
  END IF;
END
$$;

CREATE FUNCTION public.record_manual_cancel_notice(
  p_order_id        uuid,
  p_recipient_email text,
  p_actor           text,
  p_request_id      text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  -- 🔴🔴 **每個型別都帶 `pg_catalog.` 前綴**(codex 2026-09-06 must-fix)——
  --    `SET search_path = ''` **不排除 `pg_temp`**, 而暫存 schema 對【型別名】是隱含且優先搜尋的
  --    ⇒ 有建暫存物件能力的呼叫端可以先建一個帶 CHECK 的 `pg_temp.uuid`,
  --      而那個 CHECK 會在**本函式 owner(postgres)的權限下**執行。
  --    ⚠️ **那條攻擊路徑是靜態推導、我沒有實測** —— 而加前綴的成本是幾個字 ⇒ 照做, 不爭論機率。
  --    🔵 同族先例:`20260906620000` 的 `v_result pg_catalog.jsonb`(同一輪 codex 提的)。
  v_locked  pg_catalog.uuid;
  v_ok      pg_catalog.bool;
  v_now     pg_catalog.timestamptz := pg_catalog.now();
  v_constraint pg_catalog.text;
BEGIN
  -- 🔴 空值先擋。⛔ ~~這四個參數**沒有一個可以是空的**~~
  --    🔵 **codex nit 訂正:那句話與實作不符** —— 下面只擋 `p_order_id` / `p_recipient_email`
  --    / `p_actor` **三個**;`p_request_id` **可以是空的**, 它只是 correlation id,
  --    空了會讓 log 難追而**不會讓這一列變成假的**(建表 `20260717020000` 那一欄本來就 nullable,
  --    逐字「nullable=sweeper 補寄路徑無來源 request」)。
  --    ⇒ 📌 **擋的範圍要與說的範圍一樣大** —— 而讓 NULL 走下去會得到
  --    一個「述詞不成立」的假答案(NULL 比較 = UNKNOWN ⇒ WHERE 當假)。
  --    ⇒ 那會把**參數傳錯**偽裝成**這張單不合格**, 而兩者的下一步完全不同。
  IF p_order_id IS NULL
     OR pg_catalog.btrim(COALESCE(p_recipient_email, '')) = ''
     OR pg_catalog.btrim(COALESCE(p_actor, '')) = '' THEN
    RETURN pg_catalog.jsonb_build_object('result', 'invalid_args');
  END IF;

  -- 🔴🔴 **鎖那張單** —— 這就是本支存在的全部理由。
  --    `FOR NO KEY UPDATE`(不是 `FOR UPDATE`):我們**不改那一列**, 只要它在本交易期間
  --    不被別人改狀態;用較弱的那一種可以少擋住別的寫入者。
  --    🔵 形狀照 `20260823020000:258-260`(`pcm_sync_order_refund_payment_status` 也是這樣鎖)。
  SELECT o.id INTO v_locked
    FROM public.orders o
   WHERE o.id = p_order_id
   FOR NO KEY UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('result', 'not_found');
  END IF;

  -- 🛑 **述詞在鎖【之後】重算** —— 這一段與 `20260906620000` 的
  --    `pending_manual_send_count` 逐條同義(見檔頭)。
  SELECT TRUE INTO v_ok
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.payment_method = 'tappay'
     AND o.payment_status = 'refunded'
     AND o.cancelled_at IS NOT NULL
     AND EXISTS (
           SELECT 1 FROM public.order_manual_refunds m
            WHERE m.order_id = o.id
              AND m.voided_at IS NULL)
     AND NOT EXISTS (
           SELECT 1 FROM public.email_outbox e
            WHERE e.order_id = o.id
              AND e.event_type = 'order_cancelled');

  IF NOT FOUND THEN
    -- 🔵 **這裡刻意【不細分】為什麼不合格** —— 細分是 TS 那一側的工作(它要給人一句話),
    --    而本支的職責只有一個:**在鎖住的狀態下決定寫不寫**。
    --    ⇒ 📌 兩邊各做各的, 不要讓本支變成第二套訊息系統(那就是第四份字面了)。
    RETURN pg_catalog.jsonb_build_object('result', 'not_eligible');
  END IF;

  -- 🔴 `dedup_key` 用 `p_order_id::text` —— **從 uuid 轉出來的那一份**, 不是呼叫端給的字串。
  --    codex R3 must-fix ②:`dedup_key` 是 `text` 而 `orders.id` 是 `uuid`
  --    ⇒ 大小寫不同的 UUID 字串會變成兩個 dedup_key ⇒ 唯一鍵繞得過去。
  --    ✅ 在這裡轉一次, 呼叫端就**不可能**傳一個奇怪的形狀進來(它連傳的機會都沒有)。
  INSERT INTO public.email_outbox (
    event_type, order_id, dedup_key, recipient_email, subject, payload, status, sent_at
  ) VALUES (
    'order_cancelled',
    p_order_id,
    p_order_id::text,
    pg_catalog.btrim(p_recipient_email),
    '訂單取消通知(人工寄出)',
    pg_catalog.jsonb_build_object(
      'manual', TRUE,
      'recorded_by', p_actor,
      'recorded_at', v_now,
      'request_id', p_request_id,
      'note', '這一列不是系統寄的:員工自己寄了信之後在後台登錄。沒有 provider_message_id 是正常的。'
    ),
    'sent',
    v_now
  );

  RETURN pg_catalog.jsonb_build_object('result', 'ok');

EXCEPTION
  -- 🔴 撞唯一鍵 ⇒ **不是成功**。回一個自己的碼, 讓 TS 那側說「別人剛登錄了」。
  --    ⚠️ 而這一格在**鎖之後**幾乎不該發生(同一張單會被鎖序列化)——
  --    留著是因為 `(event_type, dedup_key)` 這道鍵**不只本支在寫**。
  WHEN unique_violation THEN
    -- 🔴 **只認那一道鍵**(codex nit):裸接 `unique_violation` 會把**別的**唯一鍵
    --    (例如 `email_outbox_pkey`)也報成「別人剛登錄了」
    --    ⇒ 📌 **真正的錯誤來源被吞掉**, 而畫面給的下一步是錯的(叫他重新整理看紀錄)。
    --    ✅ 比 `CONSTRAINT_NAME` —— 不是它就**往上丟**, 讓 TS 那側走 `write_failed` 並留下 log。
    -- ⚠️ **這一段【沒有被實測過】, 照實寫**(2026-09-06):`raced` 這條路在**單一連線**裡
    --    造不出來 —— 述詞的 anti-join 會**先**攔下已存在的 `order_cancelled` 列並回 `not_eligible`
    --    ⇒ 拋棄式 PG 上我試了, 拿到的是 `not_eligible`(那是對的)。
    --    ⇒ 📌 要走到這裡, 必須有**另一個交易**在我算完述詞之後、寫進去之前搶先插入
    --      ⇒ 那需要兩個連線的交錯, 不在本片的驗證範圍。**它是第二層保險, 而我沒有量到它。**
    -- 🔵 關鍵字是 `CONSTRAINT_NAME`(**不是** `PG_CONSTRAINT_NAME`)——
    --    我第一版寫錯, 拋棄式 PG 當場回 `unrecognized GET DIAGNOSTICS item`。
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    IF v_constraint IS DISTINCT FROM 'email_outbox_event_uniq' THEN
      RAISE;
    END IF;
    RETURN pg_catalog.jsonb_build_object('result', 'raced');
END
$fn$;

ALTER FUNCTION public.record_manual_cancel_notice(uuid, text, text, text) OWNER TO postgres;

COMMENT ON FUNCTION public.record_manual_cancel_notice(uuid, text, text, text) IS
$c$登錄「人工寄出取消通知」—— 把資格重檢與寫入關進同一個交易(⟦b4-CANCELMAILMIXEDRAIL⟧ 片 B)。
🔴 存在理由 = 關掉 TS 那側「先讀資格、再 insert」之間的窗口(codex R3 must-fix ①):
   讀完之後別人作廢一筆人工退款 ⇒ payment_status 降成 partiallyRefunded ⇒ 寫入當下已不合格,
   而那一列會讓這張單日後被 anti-join 永久排除 ⇒ 客人的取消信永久關閉。
🛑 先 FOR NO KEY UPDATE 鎖那張單, 再算述詞, 再寫 —— 順序不可換。
🔵 回 jsonb{result}: ok / not_found / not_eligible / raced / invalid_args。
   不細分「為什麼不合格」是刻意的:那是 TS 那側的職責(它要給人一句話), 本支只決定寫不寫。
🛑 述詞與 20260906620000 的 pending_manual_send_count、與 TS 的 manual-cancel-notice-read.ts
   是【三份字面】, 而沒有任何東西會在它們分岔時叫 ⇒ 改任一份要三份一起改。
   三份都鏡像 20260905310000 那支 view 的 :178/:179/:180 與 outbox anti-join,
   只把人工退款那一條 NOT EXISTS 翻成 EXISTS。
🛑 它證不到:兩個人各自真的寄了一封信(DB 管不到)· 那封信有沒有寄到(這一列只是「有人宣稱他寄了」)。$c$;

REVOKE ALL ON FUNCTION public.record_manual_cancel_notice(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_manual_cancel_notice(uuid, text, text, text)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_manual_cancel_notice(uuid, text, text, text) TO service_role;

-- ── 收權斷言 + 形狀斷言 ────────────────────────────────────────
DO $assert$
DECLARE
  v_functions text[] := ARRAY['public.record_manual_cancel_notice(uuid,text,text,text)']::text[];
  r           text;
  v_oid       oid;
  v_acl       text;
  v_extra     text;
  v_shape     jsonb;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    SELECT p.oid, pg_catalog.array_to_string(p.proacl, ',')
      INTO v_oid, v_acl
      FROM pg_catalog.pg_proc p
     WHERE p.oid = pg_catalog.to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '人工取消通知登錄 收權斷言失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;
    IF v_acl IS NULL THEN
      RAISE EXCEPTION '人工取消通知登錄 收權斷言失敗:% 的 proacl 是 NULL(= 套用預設 ⇒ PUBLIC 可執行)⇒ 拒繼續', r;
    END IF;
    SELECT pg_catalog.string_agg(g.grantee, ', ')
      INTO v_extra
      FROM (
        SELECT pg_catalog.pg_get_userbyid((aclexplode(p.proacl)).grantee) AS grantee
          FROM pg_catalog.pg_proc p
         WHERE p.oid = v_oid
      ) g
     WHERE g.grantee NOT IN ('service_role', CURRENT_USER);
    IF v_extra IS NOT NULL THEN
      RAISE EXCEPTION '人工取消通知登錄 收權斷言失敗:% 的 EXECUTE 清單多出非預期角色(%)—— 只應有 service_role;拒繼續', r, v_extra;
    END IF;
    IF v_acl NOT LIKE '%service_role=%' THEN
      RAISE EXCEPTION '人工取消通知登錄 收權斷言失敗:% 對 service_role 沒有 EXECUTE(收到 %)⇒ 後台叫不動', r, v_acl;
    END IF;
  END LOOP;

  -- 🔴 形狀斷言:餵一個**一定不存在**的訂單 id, 要拿到 `not_found` 而不是丟例外。
  --    ⚠️ 它證的是「回傳形狀對」, **證不到述詞對** —— 述詞要在拋棄式 PG 上造資料驗
  --    (apply 當下庫裡沒有可以分辨的資料;這句與 20260906620000 檔頭 ② 同一個限定)。
  v_shape := public.record_manual_cancel_notice(
    '00000000-0000-0000-0000-000000000000'::uuid, 'x@example.com', 'assert', 'assert');
  IF v_shape IS NULL
     OR pg_catalog.jsonb_typeof(v_shape) <> 'object'
     OR NOT (v_shape ? 'result')
     OR (v_shape->>'result') <> 'not_found' THEN
    RAISE EXCEPTION '人工取消通知登錄 形狀斷言失敗:餵不存在的 id 應回 not_found, 收到 %', v_shape;
  END IF;

  -- 🔵 負對照:空信箱要回 invalid_args(證明那道空值閘不是恆真)。
  v_shape := public.record_manual_cancel_notice(
    '00000000-0000-0000-0000-000000000000'::uuid, '   ', 'assert', 'assert');
  IF (v_shape->>'result') <> 'invalid_args' THEN
    RAISE EXCEPTION '人工取消通知登錄 負對照失敗:空信箱應回 invalid_args, 收到 %', v_shape;
  END IF;
END
$assert$;

COMMIT;
