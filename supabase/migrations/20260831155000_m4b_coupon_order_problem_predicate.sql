-- 20260831155000_m4b_coupon_order_problem_predicate.sql
-- 🔴 2026-09-01 改號 20260831150000 ⇒ 20260831155000。理由不是整理:
--    舊號與 20260831150000_m4b_handle_new_auth_user_gender.sql 【撞號】, 而兩支都已進 dev。
--    而 supabase/APPLIED.tsv 用【號】當鍵、整列不記檔名 ⇒ :339 那一列描述的是性別那支,
--    問「20260831150000 apply 了嗎」只有一個答案:是 ⇒ 本支【沒有 apply】卻繼承了一個「已 apply」。
--    主視窗 -24 唯讀正式庫量:public.coupon_redeem_order_problem ⇒ 0(本支不在)
--      🟢 正對照 public.handle_new_auth_user ⇒ 1(性別那支在, 尺會動)  🔵 負對照 public.zzq0901nosuch ⇒ 0
--    ⇒ 所以改號的是【本支】—— 改已 apply 的那支會讓帳本 :339 變孤兒。
-- 🔴 而【為什麼是 155000 不是 190000】(第一版發的號是 190000, 差點就這樣進去了):
--    本支的呼叫者是 20260831160000_m4b_coupon_p2_redeem_rpc.sql ⇒ 新號必須【小於】它。
--    🛑 而 190000 不會讓 apply 失敗 —— plpgsql 晚繫結, 函式本體不在 CREATE 時解析 ⇒ 兩支都 rc=0。
--       壞的是【中間那段時間】:160000 貼完、本支還沒貼, 這時呼叫 redeem_coupon ⇒ runtime 炸。
--       而 Sean 是一支一支貼的 ⇒ 那個窗口是真的。
--       ⚠️ 那個 runtime 錯誤【沒有實測】, 是從 3a 量過的晚繫結推的 —— 推出來的, 不是量到的。
--    📌 ⇒ 判別句:**空號與正確的號是兩個宣稱。**問「這個號有沒有被用過」答對了,
--       不代表問過「這個號排在誰前面」。而 155000 讓那個窗口根本不存在 ⇒ 不需要知道破洞多大。
--    📌 ⇒ 而替代方案(維持 190000 + 在交給 Sean 的貼單寫一行「本支要先貼」)壞在:
--       那行字寫給貼的人看, 而他貼到第三支時看的是檔名。**號是機制, 貼單上的一行字不是。**
-- 「這張單還算不算數」—— 一支 predicate, 六個真相落點, 一個答案。
--
-- ══ 🔴 為什麼需要它(這不是潔癖, 是量到的)═══════════════════════════════════
-- 2026-08-31 codex 對券兌換 RPC 審了五輪, 而 R3 / R4 / R5 **三輪落在同一層**:
--   R3 `admin_cancel_order`(`20260804180000:241-245`)寫 `cancelled_at`
--      **但那個 UPDATE 不動 `payment_status`** ⇒ 已取消的單看起來還是 `paid`
--   R4 **部分取消連 `cancelled_at` 都不寫**(`20260820030000:668` 的 UPDATE 只在
--      `v_closed` 為真時才跑)⇒ 真相只在 `order_cancellations`
--   R5 一次再抓三個:`order_refunds` · `order_manual_refunds` · `order_payments`(負數沖銷)
-- 📌 **⇒ 那不是五個 bug, 是一個結構。**
-- ⛔ ~~「**每一條**會讓訂單失效的路徑都不更新 `orders.payment_status`」~~
-- 🔴 **那句話過寬(codex R2 抓)** —— `pcm_sync_order_refund_payment_status`
--    (`20260823010000:167`)在退款 confirmed 時**會**更新它。
-- ✅ 正確字面:**有【好幾條】路徑不更新它, 而每一條都要自己被問到。**
-- 📌 **⇒ 一個「每一條都…」的全稱句, 最便宜的來源是拿自己看過的樣本當全部。**
--
-- 🔴 **而「一格一格補」是輸的做法**(2026-08-31 實測的數字):R3 抓 1 個、R4 抓 1 個、R5 一次 3 個
--    ⇒ **這條路上的數字在變大, 不是變小。** 每多一條退款/取消路徑就多一個落點,
--      而漏掉的那一次**不會有東西叫**。⇒ 收成一個地方, 讓下一個落點只要改這裡。
--
-- ══ 🟢 它的驗收條是【量到的】不是想像的 ════════════════════════════════════
-- 2026-08-31 拋棄式 PG 實測(證據檔 `~/pcm-mailbox/證據-客人帳戶區-券RPC對已失效訂單-20260831.md`):
--   A 已被卡片退款 · B 已被人工退款 · C 收款被負數沖銷(淨收款 0)
--   ⇒ **三個世界的訂單, `payment_status=paid` / `cancelled_at=NULL` / `order_cancellations=0`
--     三格全部正常** ⇒ 而券照樣兌得掉。
-- 🟢 而正對照(乾淨的已付款單)必須**收** —— 一個什麼都擋的 predicate 沒有價值。
--
-- ══ 🛑 它答不出什麼(具名, 不藏)══════════════════════════════════════════
-- ① **它是「有沒有異動」不是「淨額對不對」** —— 例如部分退款之後訂單其實還有效,
--    只是金額變小。本函式一律回問題碼 ⇒ **保守, 會誤擋那一種。**
--    ⇒ 那是刻意的:**在錢這一層, 誤擋的代價是客人再按一次;漏擋的代價是錢算錯。**
-- ② **`order_payments` 只看「有沒有沖銷列」, 不看淨額** —— 因為卡刷不一定在那張表留列
--    ⇒ `sum(amount)` 對那種單是 `NULL`, 而拿 NULL 去判「淨收款不足」**會擋掉每一張卡單**。
--    ⇒ 用 `reverses_payment_id IS NOT NULL` 精準指向 codex 具名的那個欄位。
-- ③ **它不看 `order_refund_jobs`** —— 那是排程狀態不是事實;真相在 `order_refunds`。
-- ④ 🔴 **本片只接上【券】一個呼叫端。**其餘五個地方是板子上一列, 不在本片。
--    ⇒ 理由:一次接六個 = 六條路徑各要一組測試, 而那三張表今天沒有現成的測試資料。

BEGIN;

-- ── 1. predicate ──────────────────────────────────────────────
-- 🔴 **回 `text` 不回 `boolean`**:呼叫端要能告訴人「為什麼不算數」。
--    `NULL` = 這張單還算數;非 NULL = 一個短碼, 指向是哪一個真相落點在反對。
CREATE FUNCTION public.coupon_redeem_order_problem(p_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id)
      THEN 'not_found'
    -- 🔴🔴 **順序:失效的理由排在「沒付款」之前**(codex must-fix④):
    --    `not_paid` 排最前面的話, 一張**未付款而且已取消**的單會回 `not_paid`
    --    ⇒ 短碼失真, 讀 log 的人會去查付款而不是查取消。
    --    ⇒ 而 `partiallyRefunded` 這種付款狀態也會遮掉真正的退款原因。
    WHEN (SELECT o.cancelled_at FROM public.orders o WHERE o.id = p_order_id) IS NOT NULL
      THEN 'cancelled'
    -- 部分取消:它連 `cancelled_at` 都不寫(`20260820030000:668` 只在全數取消時 UPDATE)。
    WHEN EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)
      THEN 'partially_cancelled'
    -- 🔴🔴 **卡片退款帳:黑名單不是白名單**(codex must-fix①)。
    --    ⛔ ~~原本寫 `status <> 'failed'`~~ —— 那把 **`deferred` 也當成動了錢**,
    --      而 `deferred` 逐字是「10024 = **還不能做**」(`20260803150000:23`)⇒ 沒扣到款。
    --    🛑 而那個 CHECK **已經被加寬過**:`:186` 把三值改成
    --      `('processing','confirmed','failed','deferred')` —— 我讀的是建表時那一版。
    --    📌 **⇒ 又一次「引用的射程比它實際涵蓋的窄/寬一格」** —— 今天第二次。
    -- 🔵 **選黑名單是刻意的**:未來加的新狀態會【擋】而不是【放行】。
    --    在錢這一層, 對未知保守 = 客人再按一次;對未知放行 = 錢算錯。
    -- 🔴🔴 **要看【有效終局】不是原始 status**(codex R2)——
    --    `order_refund_manual_corrections`(`20260814190000:69`)可以把一筆退款
    --    人工更正成 `money_moved` / `no_money_moved`, 而那張表的 `:101` 逐字寫著
    --    **「corrected_to=money_moved 不會讓該筆退款變成 confirmed」**
    --    ⇒ 一筆 `failed` 而被更正成「錢其實有動」的退款, 只看 `status` 會**放行**。
    -- 🔵 **而那個領域自己已經有一支 view**:`order_refund_effective_verdict`
    --    (同檔, 每筆 refund 取 `seq` 最大的那次更正)⇒ **用它, 不自己重推。**
    -- 📌 **⇒ 我原本在寫一個「單一真相」, 而那個領域【已經有】一支** ——
    --    差別是它只答退款那一段, 而我要的是整張單。**用它的答案, 不重造它。**
    WHEN EXISTS (
      SELECT 1 FROM public.order_refunds r
      LEFT JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
      WHERE r.order_id = p_order_id
        AND CASE
              WHEN v.corrected_to = 'money_moved'    THEN true
              WHEN v.corrected_to = 'no_money_moved' THEN false
              ELSE r.status NOT IN ('failed', 'deferred')
            END)
      THEN 'refunded'
    -- 人工退款帳。`voided_at` 有值 = 這筆退款被作廢 ⇒ 不算。
    WHEN EXISTS (SELECT 1 FROM public.order_manual_refunds m
                  WHERE m.order_id = p_order_id AND m.voided_at IS NULL)
      THEN 'manually_refunded'
    -- 🔴🔴 **第四本帳:`payment_refunds`**(codex must-fix②)——
    --    它**不直接連 orders**, 而是經 `payment_charge_attempts.order_id`
    --    (`20260810140000:75-77`)⇒ 只看那三張表會漏掉整條卡片退款鏈。
    -- 📌 **⇒ 這正是我在券那支檔頭寫的「打地鼠」的下一格**:我以為收成一個地方就收完了,
    --    而**收成一個地方只是讓下一格【改一個檔】, 不是讓它不存在。**
    -- 🔴🔴 **父列只代表【退款意圖】, 不代表錢動了**(codex R3 must-fix)。
    --    可執行的判準在 `payment_refund_effective_terminal.indicates_refund`
    --    (`20260812140000:308-341`)—— 而那支 view 自己就是 fail-closed 的
    --    (判不出來一律當「錢動過」;該檔 `:316-320` 逐字寫了為什麼不可以 COALESCE false)。
    WHEN EXISTS (
      SELECT 1 FROM public.payment_refunds pr
      JOIN public.payment_charge_attempts pa ON pa.id = pr.attempt_id
      JOIN public.payment_refund_effective_terminal et
        ON et.refund_id = pr.id AND et.indicates_refund IS TRUE
     WHERE pa.order_id = p_order_id)
      THEN 'payment_refunded'
    -- 🔴 **有父列而【沒有】有效終局 ⇒ 那是「不知道」, 不是「已退款」**(同上 must-fix)。
    --    ⇒ 擋, 而**短碼要說實話** —— 謊稱 `payment_refunded` 會讓讀 log 的人
    --      去查一筆不存在的退款。📌 **保守地擋, 與謊稱理由, 是兩件事。**
    -- 🔴🔴 **而「有終局且它說沒退錢」⇒ 那是【已判定】不是【不知道】⇒ 放行。**
    --    這一格是實測改的:我第一版寫成「有父列就回 unknown」⇒ 一筆人工判定
    --    `refunded=false` 的退款照樣被擋 ⇒ 與上面 `order_refunds` 那邊
    --    「更正成 `no_money_moved` ⇒ 放行」**兩套標準**。
    --    📌 **同一件事在兩張帳上要有同一個答案 —— 不然那不是保守, 是不一致。**
    WHEN EXISTS (
      SELECT 1 FROM public.payment_refunds pr
      JOIN public.payment_charge_attempts pa ON pa.id = pr.attempt_id
     WHERE pa.order_id = p_order_id
       AND NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et2
                        WHERE et2.refund_id = pr.id))
      THEN 'refund_unknown'
    -- 🔴🔴 **沖銷:比淨額, 不是「有沒有沖銷列」**(codex must-fix③)——
    --    ⛔ ~~原本只要有一列 `reverses_payment_id IS NOT NULL` 就永久擋~~
    --    ⇒ **沖銷之沖銷**(把錯誤的沖銷再沖回來)會讓收款恢復, 而那張單被永遠擋住。
    -- 🔵 而比淨額同時解掉原本那個 NULL 陷阱:卡刷不一定在這張表留列
    --    ⇒ 兩邊都是 NULL ⇒ `NULL < NULL` 是 NULL ⇒ **不成立 ⇒ 不誤擋**。
    WHEN (SELECT sum(amount) FROM public.order_payments WHERE order_id = p_order_id)
       < (SELECT sum(amount) FROM public.order_payments
           WHERE order_id = p_order_id AND reverses_payment_id IS NULL)
      THEN 'payment_reversed'
    -- 🔴🔴 **第五本帳:Dashboard 雙扣退款**(codex R2)——
    --    `payment_double_charge_anomalies`(`20260624120003`)有自己的 `old_order_id`
    --    ⇒ 一張因為雙扣而被退款的舊單, 前面四本帳可能一列都沒有。
    WHEN EXISTS (SELECT 1 FROM public.payment_double_charge_anomalies a
                  WHERE a.old_order_id = p_order_id)
      THEN 'double_charge_refunded'
    -- 付款軸放最後 —— 它是最常見而最不具體的理由。
    WHEN (SELECT o.payment_status::text FROM public.orders o WHERE o.id = p_order_id)
         IS DISTINCT FROM 'paid'
      THEN 'not_paid'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.coupon_redeem_order_problem(uuid) IS
  '🔴 **券兌換路徑專用**的保守快照 —— **它不是訂單領域的 canonical 單一真相**。'
  '(codex R3 must-fix:一個不完整卻被命名成 canonical 的單一真相, 比沒有更危險 —— '
  '別的呼叫端會信任它, 而拿到一致但不完整的錯答案。)'
  '⇒ 要當 canonical 用之前, 先由訂單/金流線接管, 並把落點分母重新掃一次。'
  '落點分母由 `scripts/order-invalidation-ledgers.test.ts` 那道閘守著(新表未分類 ⇒ 紅)。'
  'M-4b:「這張單還算不算數」。NULL = 還算數;非 NULL = 短碼指向哪一個落點在反對 '
  '(not_found / cancelled / partially_cancelled / refunded / manually_refunded / payment_refunded / refund_unknown / payment_reversed / double_charge_refunded / not_paid)。'
  '🔴 成因:**有好幾條**會讓訂單失效的路徑不更新 orders.payment_status(不是每一條 —— '
  'pcm_sync_order_refund_payment_status 在退款 confirmed 時會更新它)。codex 2026-08-31 多輪落在這一層。'
  '🛑 答不出:①「有沒有異動」不是「淨額對不對」⇒ 部分退款後仍回問題碼(刻意保守) '
  '②不看 order_refund_jobs(那是排程不是事實;而它每列被複合 FK 綁到既有 order_cancellations, '
  '前面那道取消檢查已涵蓋) ③間接關聯的落點不在那道閘的分母裡(payment_refunds 是今天的實例)。';

-- ── 2. 權限 ───────────────────────────────────────────────────
-- 🔴 新函式出生就帶 PUBLIC EXECUTE ⇒ REVOKE 是必要的, 不是保險。
REVOKE ALL ON FUNCTION public.coupon_redeem_order_problem(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coupon_redeem_order_problem(uuid) FROM anon, authenticated;
-- 🔴 具名角色不會被 `FROM PUBLIC` 收到 ⇒ 先收乾淨再重發, 免得留下 GRANT OPTION。
REVOKE ALL ON FUNCTION public.coupon_redeem_order_problem(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.coupon_redeem_order_problem(uuid) TO service_role;

-- ── 3. apply 當下的自檢(fail-closed)──────────────────────────
DO $$
DECLARE
  v_functions text[] := ARRAY['public.coupon_redeem_order_problem(uuid)'];
  v_fn text; v_oid oid; v_acl aclitem[]; v_grantees text[]; v_extra text[];
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
    v_oid := pg_catalog.to_regprocedure(v_fn);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'coupon_redeem_order_problem fail-closed:% 沒建成', v_fn;
    END IF;
    SELECT p.proacl INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
    IF v_acl IS NULL THEN
      RAISE EXCEPTION 'coupon_redeem_order_problem fail-closed:% 的 proacl 是 NULL(預設 ACL ⇒ PUBLIC 可執行)', v_fn;
    END IF;
    -- 🔴🔴 **`LEFT JOIN` 不是 `JOIN`**:`aclexplode` 給 PUBLIC 的 grantee 是 oid `0`,
    --    而 `pg_roles` 裡**沒有 0** ⇒ 內部 JOIN 會把 PUBLIC 那一列**靜靜丟掉**
    --    ⇒ 這把尺看不到它唯一要防的那一種(2026-08-31 在券那支上實測到的:
    --      把 REVOKE 整段拿掉再 apply ⇒ **自檢 rc=0、一句都沒叫**)。
    SELECT coalesce(array_agg(DISTINCT g), ARRAY[]::text[]) INTO v_grantees
      FROM (SELECT (aclexplode(v_acl)).grantee AS gid) x
      LEFT JOIN pg_catalog.pg_roles r ON r.oid = x.gid
      CROSS JOIN LATERAL (SELECT coalesce(r.rolname::text, 'PUBLIC') AS g) y;
    SELECT coalesce(array_agg(gr), ARRAY[]::text[]) INTO v_extra
      FROM unnest(v_grantees) AS gr
     WHERE gr NOT IN ('service_role', (SELECT r2.rolname::text FROM pg_catalog.pg_proc p2
                                         JOIN pg_catalog.pg_roles r2 ON r2.oid = p2.proowner
                                        WHERE p2.oid = v_oid));
    IF array_length(v_extra, 1) IS NOT NULL THEN
      RAISE EXCEPTION 'coupon_redeem_order_problem fail-closed:% 的 EXECUTE 還開給了預期外的角色:%', v_fn, v_extra;
    END IF;
    -- 帶 GRANT OPTION 的權限 = 持有者可以自己轉發出去 ⇒ 今天對而明天可以不經 migration 就變。
    IF EXISTS (SELECT 1 FROM (SELECT (aclexplode(v_acl)).* ) a WHERE a.is_grantable) THEN
      RAISE EXCEPTION 'coupon_redeem_order_problem fail-closed:% 有人拿到帶 GRANT OPTION 的權限', v_fn;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'coupon_redeem_order_problem fail-closed:service_role 拿不到 % 的 EXECUTE', v_fn;
    END IF;
    -- ACL 只答直接授權 ⇒ 角色繼承那條路要另外問。
    -- 🔴🔴 **`MEMBER` 不是 `USAGE`**(codex must-fix⑤):`USAGE` 只答「繼承得到」,
    --    而 **NOINHERIT 的成員仍然可以 `SET ROLE`** ⇒ `USAGE` 對那條路回 false。
    --    `MEMBER` 兩種都涵蓋。(片1 `:363-365` 早就具名過這個缺口, 而我第一版又寫成 USAGE。)
    IF pg_catalog.pg_has_role('anon', 'service_role', 'MEMBER')
       OR pg_catalog.pg_has_role('authenticated', 'service_role', 'MEMBER') THEN
      RAISE EXCEPTION 'coupon_redeem_order_problem fail-closed:anon/authenticated 繼承得到 service_role ⇒ 它們執行得了 %', v_fn;
    END IF;
  END LOOP;
  -- 🟢 負對照:上面那把尺若對任何東西都回同一個答案, 它就沒有判別力。
  IF pg_catalog.to_regprocedure('public.zzq_no_such_fn_8241(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'coupon_redeem_order_problem 自檢:負對照命中了一支不該存在的函式 ⇒ 量具可疑';
  END IF;
END $$;

COMMIT;
