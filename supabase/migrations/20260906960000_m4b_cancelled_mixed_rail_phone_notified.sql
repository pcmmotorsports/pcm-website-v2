-- ⟦mail-PHONEONLYNOTIFY⟧ —— 「已電話通知」也算處理完了。
--
-- ══ 為什麼需要它 ═══════════════════════════════════════════════════════════
-- 混合退款的取消單要**人工寄信**, 而有一種單**根本沒有信箱**(客人沒留、客服是打電話通知的)。
-- 🛑 那種單**按不下**「登錄我已人工寄出取消通知」那顆鈕 —— `email_outbox.recipient_email`
--    是 `NOT NULL`(`20260717020000:302`)**外加** `CHECK (recipient_email <> '')`(`:319`)
--    ⇒ 📌 **它天生塞不進一列「沒有收件人」的通知。**
-- ⇒ ⇒ 結果:客服打了電話、事情處理完了, 而**那張單永遠留在提醒裡**
--    ⇒ 🔴 **一個每天都在叫而沒有人能讓它停的告警, 會訓練人略過整封信。**
--
-- ══ 🔵 Sean 2026-09-06 拍甲:「已電話通知」鈕要做 ═════════════════════════
-- 而**怎麼記**由主視窗 `-f1` 裁 **甲**:
--   **只寫稽核, 計數這一支多一條「沒有那筆稽核」的述詞。**
--   ⇒ **完全不動 `email_outbox`** —— 那張表有六種事件、多個 writer,
--     而它那兩道約束正在擋一整族的錯(**沒有收件人的信被排進寄信佇列**)。
--   🛑 為了讓一張單在畫面上好看而鬆掉那道約束, 代價不對稱。
--
-- ══ 🛑 這個做法的三個代價(裁示時就寫明了, 不是事後才發現)══════════════════
-- ① **這個動作【沒有撤銷】** —— 稽核是 append-only。
--    主視窗裁「接受」:按錯的後果只是**那張單不再被提醒**(不是寄錯信給客人),
--    而**誰按的**稽核留著 ⇒ SOP 寫「按錯請主管在稽核裡看」。
--    ⚠️ **與登錄鈕不對稱, 而那是刻意的** —— 登錄鈕的誤按會讓客人收不到信, 這顆不會。
-- ② **本函式從此【要讀稽核表】** —— 多一個相依。
--    🔵 走 `admin_audit_log_target_idx`(`20260712210000:76`)⇒ 是索引查詢不是全表掃。
--    🔴 而相依的方向要看清楚:**計數變成「沒有人按過那顆鈕」而不是「事情沒做完」** ——
--      那兩件事在稽核被清掉 / 動作名改掉的時候會分家。動作名是**契約**, 不是自由字串。
-- ③ **那張單不會出現在後台的「通知信」那一區**(它根本沒有 outbox 列)
--    ⇒ 客服看不到「我通知過了」的痕跡。
--    ✅ 主視窗裁:鈕所在那一區**讀那筆稽核**, 有就把鈕換成一行「已電話通知 · 誰 · 何時」
--      (單張單一發查詢, **不進通知信區**)。那一半在 TS, 不在本檔。
--
-- ══ 🔴 動作名是契約 ═══════════════════════════════════════════════════════
-- `email.order_cancelled.phone_notified` —— **這個字面同時住在三個地方**:
--   ① 本函式的述詞 ② 後台 action 寫稽核那一句 ③ 讀回來顯示那一句
-- 🛑 **沒有任何東西會在它們分岔時叫。** 改任一處要三處一起改。
-- ⚠️ 而分岔的症狀是**安靜的**:計數不會歸零(述詞找不到那筆), 而畫面說「已電話通知」。

BEGIN;

-- ── 前置閘 ────────────────────────────────────────────────────
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.get_cancelled_mixed_rail_gap_counts()') IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 get_cancelled_mixed_rail_gap_counts ⇒ 20260906620000(貼板 55)還沒貼';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'admin_audit_log')
  THEN
    RAISE EXCEPTION '前置閘:找不到 admin_audit_log ⇒ 本支的述詞要讀它';
  END IF;
END
$$;

-- 🔴 **`CREATE OR REPLACE` —— 這是【重定義既有物件】**(靜態檢查規則① 的合法情形):
--    同名同簽章, 只換函式體。⚠️ 而那表示**貼上去之後舊定義就沒了** ——
--    要回頭只能重貼 `20260906620000`(那支還在版控裡)。
CREATE OR REPLACE FUNCTION public.get_cancelled_mixed_rail_gap_counts()
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
    -- 🔴🔴 **告警的主詞。** 刷卡取消單、錢已退、走過混合軌(有未作廢的人工退款)
    --    ⇒ 系統刻意不寄取消信 ⇒ 這封信只能人工處理, 而今天沒有人會被告知。
    -- 🛑 條件逐字鏡像掃描 view(`20260905310000` 的 `:178` `:179` `:180` 與 outbox anti-join),
    --    **只把人工退款那一條翻過來**;而 2026-09-06 起**多一條**:沒有人按過「已電話通知」。
    'pending_manual_send_count',
      (SELECT pg_catalog.count(*)
         FROM public.orders o
        WHERE o.payment_method = 'tappay'
          AND o.payment_status = 'refunded'
          AND o.cancelled_at IS NOT NULL
          AND EXISTS (
                SELECT 1 FROM public.order_manual_refunds m
                 WHERE m.order_id = o.id
                   AND m.voided_at IS NULL)
          AND NOT EXISTS (
                SELECT 1 FROM public.email_outbox e
                 WHERE e.order_id = o.id
                   AND e.event_type = 'order_cancelled')
          -- 🔵 **新增(⟦mail-PHONEONLYNOTIFY⟧)**:客服打電話通知過了 ⇒ 這張單處理完了。
          --    🔴 `target` 的字面是 `order:<uuid>` —— 與後台 action 寫進去的那一句**必須一樣**
          --      (`admin-audit` 家族的慣例;`20260712210000:47` 逐字舉的例子就是 `'order:<uuid>'`)。
          --    🛑 這裡打錯一個字 ⇒ **述詞永遠找不到那筆** ⇒ 計數不會歸零,
          --      而畫面那一半會說「已電話通知」⇒ 📌 **兩邊各自看起來都正常。**
          AND NOT EXISTS (
                SELECT 1 FROM public.admin_audit_log a
                 WHERE a.target = 'order:' || o.id::pg_catalog.text
                   AND a.action = 'email.order_cancelled.phone_notified')),

    -- 🔵 **等了多久。** 一個不會因為「寄好了」而下降的數字, 沒有這一格就答不出
    --    「這是今天的新單, 還是三個星期沒有人管」。
    'oldest_pending_cancelled_at',
      (SELECT pg_catalog.min(o.cancelled_at)
         FROM public.orders o
        WHERE o.payment_method = 'tappay'
          AND o.payment_status = 'refunded'
          AND o.cancelled_at IS NOT NULL
          AND EXISTS (
                SELECT 1 FROM public.order_manual_refunds m
                 WHERE m.order_id = o.id
                   AND m.voided_at IS NULL)
          AND NOT EXISTS (
                SELECT 1 FROM public.email_outbox e
                 WHERE e.order_id = o.id
                   AND e.event_type = 'order_cancelled')
          AND NOT EXISTS (
                SELECT 1 FROM public.admin_audit_log a
                 WHERE a.target = 'order:' || o.id::pg_catalog.text
                   AND a.action = 'email.order_cancelled.phone_notified')),

    -- 🔵 分母。**一個計數沒有分母, 讀的人會自己補一個**(而他補的那個多半是全部)。
    --    🔴 它數的是【全部】已取消且已退款的刷卡單 —— 含混合軌那些。
    --    ⇒ 讀法:`pending / total` = 這批單裡有多少比例還在等人處理。
    'cancelled_refunded_total_count',
      (SELECT pg_catalog.count(*)
         FROM public.orders o
        WHERE o.payment_method = 'tappay'
          AND o.payment_status = 'refunded'
          AND o.cancelled_at IS NOT NULL)
  )
  INTO v_result;
  RETURN v_result;
END
$fn$;

COMMENT ON FUNCTION public.get_cancelled_mixed_rail_gap_counts() IS
$c$回 jsonb{pending_manual_send_count, oldest_pending_cancelled_at, cancelled_refunded_total_count}。
🔴 告警的主詞是 pending_manual_send_count:刷卡取消單、錢已退、走過混合軌(有未作廢的人工退款)
   ⇒ 系統刻意不寄取消信(20260905310000:193-196 那道排除閘), 而那位客人仍然需要被通知。
🛑 述詞逐字鏡像 public.pcm_cancelled_email_pending 的 :178/:179/:180 與 outbox anti-join,
   只把 order_manual_refunds 那一條 NOT EXISTS 翻成 EXISTS。
🔵 而 view 的「至少一個信箱非空」與「手動建單留白」兩條【刻意不帶】:那支 view 是自動寄信的
   掃描面(fail-closed 才對), 本支是看門狗 ⇒ 只在那兩條上 fail-open。
   ⇒ 保留的三條(:178/:179/:180)每一條都是 fail-closed 而本支一起繼承了 ⇒ 本支是【部分】fail-open。
🔴🔴 **2026-09-06(⟦mail-PHONEONLYNOTIFY⟧, Sean 拍甲)多一條述詞**:
   沒有 admin_audit_log 上 action='email.order_cancelled.phone_notified' 且 target='order:<id>' 的那筆。
   ⇒ 「客服打電話通知過了」也算處理完 —— 那種單沒有信箱, 塞不進 email_outbox
     (recipient_email NOT NULL + CHECK <> '')。
   🛑 **代價②:本函式從此讀稽核表** ⇒ 計數變成「**沒有人按過那顆鈕**」而不是「事情沒做完」——
     那兩件事在**稽核被清掉 / 動作名被改掉**的時候會分家。動作名是契約, 不是自由字串;
     它同時住在本述詞、後台寫稽核那一句、與讀回來顯示那一句, 而**沒有東西會在它們分岔時叫**。
   🛑 **代價①:電話通知這個動作沒有撤銷**(稽核 append-only)。按錯的後果是那張單不再被提醒,
     而誰按的稽核留著 ⇒ 主管在稽核裡看。與登錄鈕不對稱, 而那是刻意的。
🛑 它答的是【現況】不是【歷史】, 也答不出「那通電話/那封信實際上有沒有到」。$c$;

-- 🔵 `CREATE OR REPLACE` 不會重置 ACL —— 但**明寫一次比假設安全**(新物件出生自帶 PUBLIC)。
REVOKE ALL ON FUNCTION public.get_cancelled_mixed_rail_gap_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cancelled_mixed_rail_gap_counts()
  FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_cancelled_mixed_rail_gap_counts() TO payment_confirmer;

-- ── 收權斷言 + 形狀斷言 ────────────────────────────────────────
DO $assert$
DECLARE
  v_functions text[] := ARRAY['public.get_cancelled_mixed_rail_gap_counts()']::text[];
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
      RAISE EXCEPTION '電話通知述詞 收權斷言失敗:找不到函式 % ⇒ 拒繼續', r;
    END IF;
    IF v_acl IS NULL THEN
      RAISE EXCEPTION '電話通知述詞 收權斷言失敗:% 的 proacl 是 NULL(= PUBLIC 可執行)⇒ 拒繼續', r;
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
      RAISE EXCEPTION '電話通知述詞 收權斷言失敗:% 的 EXECUTE 多出非預期角色(%)⇒ 拒繼續', r, v_extra;
    END IF;
    IF v_acl NOT LIKE '%payment_confirmer=%' THEN
      RAISE EXCEPTION '電話通知述詞 收權斷言失敗:% 對 payment_confirmer 沒有 EXECUTE(收到 %)⇒ 告警讀不到', r, v_acl;
    END IF;
  END LOOP;

  -- 🔴 形狀斷言:三個鍵一個都不能少(先驗它是不是 object —— `?` 對陣列也成立)。
  v_shape := public.get_cancelled_mixed_rail_gap_counts();
  IF v_shape IS NULL
     OR pg_catalog.jsonb_typeof(v_shape) <> 'object'
     OR NOT (v_shape ? 'pending_manual_send_count')
     OR NOT (v_shape ? 'oldest_pending_cancelled_at')
     OR NOT (v_shape ? 'cancelled_refunded_total_count') THEN
    RAISE EXCEPTION '電話通知述詞 形狀斷言失敗:回傳缺鍵(收到 %)⇒ 告警那側會讀到 undefined 而恆不叫', v_shape;
  END IF;

  -- 🔵 **新述詞真的接上了嗎** —— 純字面斷言, apply 當下庫裡沒有資料可以分辨行為。
  --    ⚠️ 它證的是「那個動作名寫進函式體了」, **證不到「述詞算得對」**
  --      —— 後者要在拋棄式 PG 上造資料驗(本片有做, 見 commit body)。
  -- 🔵 用 `strpos(haystack, needle)` 不用 `position(needle IN haystack)` ——
  --    後者是**特殊語法**, 加 `pg_catalog.` 前綴會被當成一般函式呼叫
  --    ⇒ 拋棄式 PG 當場回 `function pg_catalog.position(boolean) does not exist`
  --      (它把 `IN` 那一段當成布林運算式先算掉了)。我踩了才知道。
  IF pg_catalog.strpos(
       (SELECT p.prosrc FROM pg_catalog.pg_proc p
         WHERE p.oid = pg_catalog.to_regprocedure('public.get_cancelled_mixed_rail_gap_counts()')),
       'email.order_cancelled.phone_notified'
     ) = 0 THEN
    RAISE EXCEPTION '電話通知述詞 接線斷言失敗:函式體裡找不到那個動作名 ⇒ 這一支貼了等於沒貼';
  END IF;
END
$assert$;

COMMIT;
