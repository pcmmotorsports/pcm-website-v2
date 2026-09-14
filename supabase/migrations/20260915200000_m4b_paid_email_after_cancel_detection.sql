-- ⟦f3-PAIDCANCELRACE1⟧ —— 「付款成功信在訂單【已經取消之後】才標記寄出」的事後偵測。
--
-- ══ 為什麼需要它 ═══════════════════════════════════════════════════════════
-- 🔵 Sean 2026-09-02 拍【乙 = 事後偵測】(`~/pcm-mailbox/拍板-20260902-06題.md:28-33`):
--    「寄出之後再對一次, 對不上就開一筆給員工去聯絡客人」;2026-09-15 主視窗端 Q9 = 批。
-- 🔬 那個競態【關不掉】:`sweep-email-outbox.ts` 逐封閘(:1968 `listIneligibleAmong`)與付款脈絡(:2105
--    `loadPaidContext`)都在 send(:2893)之前讀 `cancelled_at` ⇒ 讀完之後、送出之前被取消 ⇒ 信照寄。
--    ⇒ 再加一道事前檢查只是把窗口變窄 ⇒ 所以做的是【寄完之後再對一次】。
--
-- ══ 🔴 方向是 `sent_at > cancelled_at`(信標記寄出的時刻晚於取消)══════════════
-- ⛔ ~~`docs/plans/2026-09-10-…-plan.md` §4-1 寫的 `sent_at < cancelled_at`~~ —— 那是方向筆誤
--    (主視窗 2026-09-15 裁):`<` 數到的是「寄完信很久之後客人 / 員工才取消」= **正常的事後取消**
--    (同 plan §8 自己說「完全正常, 不是 bug」;09-14 刷卡全退自動取消也全落在那一邊)
--    ⇒ 上線就叫, 而真正的競態(取消 → 才寄出)反而一張都抓不到。
-- ✅ 形狀照 `docs/plans/2026-09-09-paidcancelrace-postsend-detection-plan.md`(codex R1 折過)。
--
-- ══ 🛑 它只證得到【疑似】══════════════════════════════════════════════════
-- `sent_at` 是 app 在 `sender.send()` 回來【之後】用 `new Date()` 寫的, 不是寄出那一刻的 DB 時間
-- ⇒ 10:00:00 真的寄出 → 10:00:01 被取消 → 10:00:02 才寫 sent_at ⇒ 這裡算成「取消後寄出」(誤報);
--   app 與 DB 時鐘偏差則可能漏報。⇒ 告警文字一律寫「疑似」、帶單號讓人去核時間。
--
-- ══ 受詞 ══════════════════════════════════════════════════════════════════
-- · 只算 `event_type = 'order_created'` 且 `status = 'sent'` —— 付款成功信掛在 order_created 上
--   (`sweep-email-outbox.ts:2092`);取消信 / 退款信本來就該在取消之後寄, 算進來每一封都是假警報。
-- · `email_outbox` 有 `channel`(email / LINE, 20260914040000)⇒ 同一張單可能兩列 ⇒ **一律數張數(DISTINCT 單)**。
-- · 分母 `total_count` = 已取消、而身上有一封已寄出的 order_created 的單 —— 與分子同一族。
--   🛑 分母 > 0 只證「這一族今天有資料」, 證不到述詞沒寫錯(那由 after-check 的突變格證)。
-- · 命中清單 ≤ 20 張(display_id + 最早寄出時刻 + 取消時刻)—— Sean「開一筆給員工去聯絡客人」要靠單號。
--
-- ══ 🛑 這一支【沒有】做的(寫明)═══════════════════════════════════════════
-- ponytail: 不排除「已核對」的單 —— 09-09 plan 的 `NOT EXISTS admin_audit_log(… reviewed)` 沒有接,
--    因為今天沒有任何東西寫那個 action(按鈕未做, 主視窗端 Sean)⇒ 接了是一道看起來在守而永遠不成立的條件。
--    ⇒ 代價:同一張疑似單每次告警都會再列一次。升級路 = 做「已核對」按鈕時在三處述詞加 anti-join。
-- · 不進 `shouldAlert`(use-case 那一側)⇒ 只在【有別的告警成立】那一天的信裡被看到 —— 要不要進響鈴, 主視窗端 Sean。

BEGIN;

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
BEGIN
  -- ① 述詞要讀的四欄 + 兩欄
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = 'public.email_outbox'::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND a.attname IN ('order_id', 'event_type', 'status', 'sent_at')) <> 4 THEN
    RAISE EXCEPTION '前置閘①:email_outbox 缺 order_id / event_type / status / sent_at 其中之一 ⇒ 述詞讀不到';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = 'public.orders'::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND a.attname IN ('cancelled_at', 'display_id')) <> 2 THEN
    RAISE EXCEPTION '前置閘①:orders 缺 cancelled_at / display_id ⇒ 述詞讀不到';
  END IF;

  -- ② 收權對象
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'payment_confirmer') THEN
    RAISE EXCEPTION '前置閘②:找不到角色 payment_confirmer ⇒ 收權那一段會建出一支沒有人讀得到的函式';
  END IF;

  -- ③ 防重貼 —— 本支是 CREATE FUNCTION(不是 OR REPLACE)
  IF pg_catalog.to_regprocedure('public.get_paid_email_after_cancel_counts()') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘③:get_paid_email_after_cancel_counts() 已經存在 ⇒ 這一支貼過了, 拒重貼';
  END IF;

  -- ④ 🔵 正對照:同一把尺要問得出一個【應該在】的東西
  IF pg_catalog.to_regprocedure('public.get_partial_refund_cancel_gap_counts()') IS NULL THEN
    RAISE EXCEPTION '前置閘④(正對照):連 get_partial_refund_cancel_gap_counts 都找不到 ⇒ 這把尺在錯的庫上';
  END IF;
END
$pre$;

-- 🔴 `CREATE FUNCTION` 不是 `CREATE OR REPLACE` —— 新物件。回退 = DROP(`supabase/rollbacks/20260915200000_down.sql`)。
--    ✅ drop 安全:呼叫端讀不到函式時走「函式不存在 ⇒ null(查不到)」, 不是回 0。
CREATE FUNCTION public.get_paid_email_after_cancel_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_result pg_catalog.jsonb;
BEGIN
  SELECT pg_catalog.jsonb_build_object(

    -- 🔴🔴 **告警的主詞(疑似)。** 已取消的單、身上有一封 order_created 已寄出、而標記寄出晚於取消。
    'suspect_count',
      (SELECT pg_catalog.count(DISTINCT o.id)
         FROM public.orders o
         JOIN public.email_outbox e ON e.order_id = o.id
        WHERE o.cancelled_at IS NOT NULL
          AND e.event_type = 'order_created'
          AND e.status = 'sent'
          AND e.sent_at IS NOT NULL
          AND e.sent_at > o.cancelled_at),

    -- 🔵 最早那一封疑似信的寄出時刻 —— 答得出「今天的新案, 還是三個星期沒有人管」。
    'oldest_suspect_sent_at',
      (SELECT pg_catalog.min(e.sent_at)
         FROM public.orders o
         JOIN public.email_outbox e ON e.order_id = o.id
        WHERE o.cancelled_at IS NOT NULL
          AND e.event_type = 'order_created'
          AND e.status = 'sent'
          AND e.sent_at IS NOT NULL
          AND e.sent_at > o.cancelled_at),

    -- 🔵 分母:已取消、而身上有一封已寄出的 order_created 的單(與分子同一族, 不帶時間比較)。
    'total_count',
      (SELECT pg_catalog.count(DISTINCT o.id)
         FROM public.orders o
         JOIN public.email_outbox e ON e.order_id = o.id
        WHERE o.cancelled_at IS NOT NULL
          AND e.event_type = 'order_created'
          AND e.status = 'sent'),

    -- 🔵 人要核得動就要有單號。上限 20 張, 告警信不是報表;依最早寄出時刻排。
    'suspect_orders',
      (SELECT COALESCE(
                pg_catalog.jsonb_agg(
                  pg_catalog.jsonb_build_object(
                    'display_id', s.display_id,
                    'sent_at', s.sent_at,
                    'cancelled_at', s.cancelled_at)
                  ORDER BY s.sent_at, s.display_id),
                '[]'::pg_catalog.jsonb)
         FROM (SELECT o.display_id,
                      pg_catalog.min(e.sent_at) AS sent_at,
                      o.cancelled_at
                 FROM public.orders o
                 JOIN public.email_outbox e ON e.order_id = o.id
                WHERE o.cancelled_at IS NOT NULL
                  AND e.event_type = 'order_created'
                  AND e.status = 'sent'
                  AND e.sent_at IS NOT NULL
                  AND e.sent_at > o.cancelled_at
                GROUP BY o.id, o.display_id, o.cancelled_at
                -- 🔵 codex R1 nit:同一時刻超過 20 張時要穩定 ⇒ 補唯一鍵
                ORDER BY pg_catalog.min(e.sent_at), o.display_id
                LIMIT 20) s)
  )
  INTO v_result;
  RETURN v_result;
END
$fn$;

COMMENT ON FUNCTION public.get_paid_email_after_cancel_counts() IS
$c$回 jsonb{suspect_count, oldest_suspect_sent_at, total_count, suspect_orders[≤20 {display_id, sent_at, cancelled_at}]}。
🔴 主詞 suspect_count(疑似):已取消的單、身上有 order_created 且 status='sent' 的信、而 sent_at > cancelled_at。
   ⇒ 付款成功信可能在取消之後才寄出(寄信掃描讀完取消狀態 → 被取消 → 才送出, 那個窗口關不掉)。
🛑 只證得到疑似:sent_at 是 app 在送出回來之後寫的 ⇒ 邊界上可能誤報 / 漏報 ⇒ 要人拿單號去核時間。
⛔ 方向不是 sent_at < cancelled_at —— 那是正常的事後取消(2026-09-10 plan §4-1 的筆誤, 2026-09-15 訂正)。
🔵 一律數張數(DISTINCT 單):email_outbox 有 channel(email / LINE)⇒ 同一張單可能兩列。
🛑 不排除已核對的單(按鈕未做);不進 shouldAlert(只在別的告警成立那天被看到)。$c$;

-- ── 收權:新函式出生自帶 PUBLIC ⇒ 這三行是必要的 ─────────────────
REVOKE ALL ON FUNCTION public.get_paid_email_after_cancel_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_paid_email_after_cancel_counts()
  FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_paid_email_after_cancel_counts() TO payment_confirmer;

-- ── 收權斷言 + 形狀斷言 + 接線斷言 ────────────────────────────
DO $assert$
DECLARE
  v_functions text[] := ARRAY['public.get_paid_email_after_cancel_counts()']::text[];
  r           text;
  v_oid       oid;
  v_acl       text;
  v_extra     text;
  v_shape     jsonb;
  v_src       text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    SELECT p.oid, pg_catalog.array_to_string(p.proacl, ',')
      INTO v_oid, v_acl
      FROM pg_catalog.pg_proc p
     WHERE p.oid = pg_catalog.to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '付款信取消偵測 收權斷言失敗:找不到函式 % ⇒ 拒繼續', r;
    END IF;
    IF v_acl IS NULL THEN
      RAISE EXCEPTION '付款信取消偵測 收權斷言失敗:% 的 proacl 是 NULL(= PUBLIC 可執行)⇒ 拒繼續', r;
    END IF;
    SELECT pg_catalog.string_agg(g.grantee, ', ')
      INTO v_extra
      FROM (
        SELECT pg_catalog.pg_get_userbyid((aclexplode(p.proacl)).grantee) AS grantee
          FROM pg_catalog.pg_proc p
         WHERE p.oid = v_oid
      ) g
     WHERE g.grantee NOT IN ('payment_confirmer', CURRENT_USER);
    IF v_extra IS NOT NULL THEN
      RAISE EXCEPTION '付款信取消偵測 收權斷言失敗:% 的 EXECUTE 多出非預期角色(%)⇒ 拒繼續', r, v_extra;
    END IF;
    IF v_acl NOT LIKE '%payment_confirmer=%' THEN
      RAISE EXCEPTION '付款信取消偵測 收權斷言失敗:% 對 payment_confirmer 沒有 EXECUTE(收到 %)⇒ 告警讀不到', r, v_acl;
    END IF;
  END LOOP;

  -- 🔴 codex R1 important:上面只查【直接】ACL ⇒ 再用有效權限(含角色繼承)查三個不該執行的角色。
  IF pg_catalog.has_function_privilege('anon', 'public.get_paid_email_after_cancel_counts()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.get_paid_email_after_cancel_counts()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.get_paid_email_after_cancel_counts()', 'EXECUTE') THEN
    RAISE EXCEPTION '付款信取消偵測 收權斷言失敗:anon / authenticated / service_role 其中之一有效可執行(含繼承)⇒ 跨訂單清單外露';
  END IF;
  -- 🔵 繼承 payment_confirmer 的角色(它們也能執行)—— 照 `20260831170000:323` 那一道:預期只有 `postgres`(Supabase 慣例)。
  --    ⛔ ~~要求零成員~~(codex R2 must-fix):正式庫 `postgres` 是成員 ⇒ 整包回滾貼不上。多出任何一個 ⇒ 停下人工看。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
              WHERE m.roleid = (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = 'payment_confirmer')
                AND pg_catalog.pg_get_userbyid(m.member) <> 'postgres') THEN
    RAISE EXCEPTION '付款信取消偵測 收權斷言失敗:payment_confirmer 有預期外的成員 [%] ⇒ 它們繼承得到本函式, 停下人工看',
      (SELECT pg_catalog.string_agg(pg_catalog.pg_get_userbyid(m.member), ',' ORDER BY 1)
         FROM pg_catalog.pg_auth_members m
        WHERE m.roleid = (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = 'payment_confirmer')
          AND pg_catalog.pg_get_userbyid(m.member) <> 'postgres');
  END IF;

  -- 🔴 形狀斷言:四個鍵一個都不能少, 清單必須是陣列(缺鍵的後果是安靜的:告警那側讀到 undefined ⇒ 恆不叫)。
  v_shape := public.get_paid_email_after_cancel_counts();
  IF v_shape IS NULL
     OR pg_catalog.jsonb_typeof(v_shape) <> 'object'
     OR NOT (v_shape ? 'suspect_count')
     OR NOT (v_shape ? 'oldest_suspect_sent_at')
     OR NOT (v_shape ? 'total_count')
     OR NOT (v_shape ? 'suspect_orders')
     OR pg_catalog.jsonb_typeof(v_shape->'suspect_orders') <> 'array' THEN
    RAISE EXCEPTION '付款信取消偵測 形狀斷言失敗:回傳缺鍵或清單不是陣列(收到 %)', v_shape;
  END IF;

  -- 🔵 接線斷言 —— 純字面(證的是字面寫進去了, 證不到述詞算得對;後者由拋棄式 PG after-check 證)。
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.get_paid_email_after_cancel_counts()');

  IF pg_catalog.strpos(v_src, 'e.sent_at > o.cancelled_at') = 0 THEN
    RAISE EXCEPTION '付款信取消偵測 接線斷言失敗:找不到 e.sent_at > o.cancelled_at ⇒ 方向沒接上';
  END IF;
  -- 🔴 方向閘:反方向那個字面【不得】出現 —— 2026-09-10 plan 的筆誤就是它。
  IF pg_catalog.strpos(v_src, 'e.sent_at < o.cancelled_at') <> 0 THEN
    RAISE EXCEPTION '付款信取消偵測 接線斷言失敗:函式體裡出現 e.sent_at < o.cancelled_at ⇒ 數到的是正常的事後取消';
  END IF;
  IF pg_catalog.strpos(v_src, '''order_created''') = 0 THEN
    RAISE EXCEPTION '付款信取消偵測 接線斷言失敗:函式體裡找不到 order_created ⇒ 取消信 / 退款信會被算成事故';
  END IF;
  -- ⚪ 負對照:這把尺不是恆真
  IF pg_catalog.strpos(v_src, 'zzz_never_a_literal') <> 0 THEN
    RAISE EXCEPTION '付款信取消偵測 接線斷言失敗(負對照):現造字面竟然命中 ⇒ 這把尺壞了, 上面幾格的 t 不算數';
  END IF;
END
$assert$;

COMMIT;
