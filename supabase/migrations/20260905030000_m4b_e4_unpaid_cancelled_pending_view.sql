-- ⟦b4-NORECIPIENTWINDOW⟧ 甲 · **第二條線(order_unpaid_cancelled)** ——
-- 與 `20260905020000` 同一個形狀:把「永遠不會好」的單移出掃描面。
--
-- ══ 🔴 為什麼是【另一支 migration】而不是折進 20260905020000 ═══════════════
-- 主視窗 2026-09-05 拍「拆兩片」, 而拆片的用意是 **「壞了分得出是哪一條」**
-- (今天 `orders` 只有 1 列 ⇒ 「改前改後逐筆相同」那個驗收幾乎沒有判別力)。
-- ⇒ 🛑 **折進同一支 ⇒ 兩條線【一起被貼】⇒ 那個分離在 DB 這一層就沒了。**
-- ⇒ ✅ 分開兩支, Sean 可以貼一支、看一天、再貼另一支。**分離留在它有用的那一層。**
--
-- ══ 這一條與第一條的【三個差異】(不是照抄, 逐條讀出來的)═════════════════
-- ① 身分判準是 **`order_cancellations` 那一列存不存在**, 不是任何欄位的值。
--    🔴 adapter 檔頭記著為什麼:員工選「其他」時 `cancelled_reason` **就是他打的字**
--    ⇒ 拿它當身分 = **讓打字的人決定誰收得到信**。
--    ✅ 判別句逐字搬過來:**「這個值有沒有任何一條路徑是【人】填得到的?」有 ⇒ 不能當身分。**
-- ② 它多讀一張表(`order_cancellations`)⇒ 🔴 **而本 view 是 `security_invoker`**
--    ⇒ **呼叫者要有那張表的 SELECT** —— 下面有一道事後閘在驗
--    (成因:`20260905020000` 就是栽在這個形狀上, codex 抓的)。
-- ③ `cancelled_reason` 要進 payload ⇒ 本 view 得把它 select 出來。
--
-- ══ ⚠️ 本 view 【原樣保留】一個已知會漏信的條件 ═══════════════════════════
-- adapter 逐字記著:`created_at >= cutoff` 這一道**會漏掉**
-- 「cutoff 之前建立、cutoff 之後被員工取消」的單 ⇒ **那些人收不到信**。
-- 🔵 今天無害 —— ⛔ ~~理由:「未付款單 1 天就被 expire ⇒ 窗口 ≤ 1 天」~~
--    🔴 **那個理由是【錯的】, 而我是從原檔搬過來、沒有自己驗**(codex 2026-09-05 must-fix):
--    ✅ **真正的理由是【那顆 cutoff 早就過去了】** ⇒ 今天不存在「建立於 cutoff 之前」的活單。
--    🛑 而 codex 給的反例正好打穿舊理由:**新 cutoff = T 時, T−1h 建單、T+1h 被員工取消**
--      ⇒ 它**還不滿一天**(所以沒被 expire), 而 `created_at >= T` 照樣把它排除掉。
--    ⇒ 📌 **結論對而理由錯 —— 而那比結論錯難發現, 因為沒有人會去查一個【對的結論】。**
-- 🛑 **而它會在【Sean 給這條線一顆新 cutoff 的那一天】開始靜靜漏信。**
-- ⇒ 📌 **本片不動它** —— 那兩個 cutoff 是**參數**、留在 adapter, 本 view 一個都不含。
--   ⇒ 🔴 **所以那個已知缺口【沒有被本片改變, 也沒有被本片解掉】。照實寫。**

BEGIN;

-- ── 前置閘 ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_js_trim_whitespace()') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.pcm_js_trim_whitespace() ⇒ 20260901070000 還沒貼';
  END IF;
  IF pg_catalog.to_regclass('public.order_cancellations') IS NULL THEN
    RAISE EXCEPTION '前置閘②:找不到 public.order_cancellations ⇒ 20260730130000 還沒貼';
  END IF;
END
$$;

CREATE VIEW public.pcm_unpaid_cancelled_email_pending
  WITH (security_invoker = true) AS
SELECT
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.cancelled_at       AS cancelled_at,
  o.cancelled_reason   AS cancelled_reason,
  o.created_at         AS created_at,
  o.notification_email AS notification_email,
  c.email              AS customer_email
FROM public.orders o
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
WHERE o.payment_status = 'unpaid'
  AND o.cancelled_at IS NOT NULL
  -- 🔴🔴 **身分判準 = 那一列存不存在, 而【不讀它任何欄位】。**
  --    員工取消會 INSERT 進 order_cancellations;逾時自動取消**不會**(該表命中 0)
  --    ⇒ 🎯 **它存不存在由【哪一支函式跑過】決定, 不由任何人填。**
  --    (原本 adapter 用 `!inner` join 達成同一件事, 這裡改寫成 EXISTS。)
  --    ⛔ ~~「語意相同而**不會讓父列重複**:`!inner` 對一對多會複製父列」~~
  --    🔴🔴 **那句話是【假的】, 而它是我編的**(codex 2026-09-05 對抗審查, 附 PostgREST 官方文件):
  --      PostgREST 的 to-many embed **回的是「父物件 + 子陣列」, 不會複製父列**;
  --      `!inner` 只是**篩掉沒有子列的頂層列**。⇒ 兩者納入的父列集合**本來就相同**。
  --    📌 **⇒ 我拿一個【SQL JOIN 的直覺】去描述一個【PostgREST 的行為】, 而它們不一樣。**
  --    ✅ **改寫成 EXISTS 仍然是對的**, 而理由要換成真的那個:
  --      **這個 view 是 SQL, 而 SQL 裡沒有「embed」這個東西** —— EXISTS 是它的自然寫法。
  --    ⚠️ 而「`order_cancellations` 對一張單是否可能多列」我**確實沒有查** ——
  --      ⇒ 🔵 EXISTS 讓那個問題不必回答, **這一半是真的**(它天生只問存不存在)。
  AND EXISTS (
        SELECT 1 FROM public.order_cancellations oc
         WHERE oc.order_id = o.id)
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_unpaid_cancelled')
  -- ⚠️ `nullif` 不加 `pg_catalog.` 前綴 —— 它是 SQL【語法】不是函式(第一片踩過兩次)。
  -- 🔴🔴 **本支唯一【新增】的條件, 而它就是這一片。**
  --    🛑 空白定義走 `pcm_js_trim_whitespace()` 單一來源 ——
  --    `get_order_unpaid_cancelled_gap_counts` 的 `no_recipient_count` 用的是同一支
  --    ⇒ 📌 **兩者是互補集, 而互補集的定義只能有一份。**
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

COMMENT ON VIEW public.pcm_unpaid_cancelled_email_pending IS
$c$「未付款、被【員工】取消、還沒排過 order_unpaid_cancelled 通知信、而且至少一個信箱非空」的訂單。
🔴 身分判準是 order_cancellations 那一列【存不存在】, 不讀它任何欄位 ——
員工選「其他」時 cancelled_reason 就是他打的字, 拿它當身分 = 讓打字的人決定誰收得到信。
🔴 最後那個信箱條件是本 view 存在的理由:兩個信箱都空的單不會自己好, 留在掃描面上會被每一輪重撈,
累積到上限就把名額佔滿, 讓真的要寄的信擠不進來 —— 而它不報錯、不進死信、心跳照綠。
🟢 被排除的單仍然看得見:get_order_unpaid_cancelled_gap_counts 的 no_recipient_count 在數它們,
而那個計數 2026-09-03 就接進每日告警了。
🛑 本 view 不含 cutoff(參數, 留在 adapter)。⚠️ 而 adapter 那道 created_at >= cutoff
是一個【已知會漏信】的條件(cutoff 之前建立、之後被取消的單收不到信);今天無害,
而它會在有人給這條線一顆新 cutoff 的那天開始靜靜漏 —— 本片沒有改變也沒有解掉它。
⚠️ 本 view 含 PII(兩個 email 欄)⇒ 僅 service_role 可讀。
⚠️ 它解不掉 ⟦b4-JSWSNARROWER⟧(U+202F / U+205F 兩個碼位 SQL 判非空而 JS 判空)。$c$;

REVOKE ALL ON public.pcm_unpaid_cancelled_email_pending FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pcm_unpaid_cancelled_email_pending TO service_role;

-- 🔴 **這一行【與 `20260905020000` 重複, 而重複是刻意的】**(2026-09-05 核 GRANT 對象時補)。
--    本 view 是 `security_invoker` ⇒ 呼叫者要有那支 helper 的 EXECUTE, 而那道 GRANT
--    是在 `20260905020000` 下的 ⇒ 🛑 **本支就對「那一支先貼」產生了一個順序相依。**
--    ✅ `GRANT` 是冪等的 ⇒ 這裡再下一次, 本支就**自己站得住**, 不必依賴貼的順序。
--    ⇒ 📌 **一個只有在【別人先做過】才成立的 migration, 它的正確性寫在別人的檔案裡。**
GRANT EXECUTE ON FUNCTION public.pcm_js_trim_whitespace() TO service_role;

-- ── 新物件收權斷言(整段照抄 `20260817070000` 的標準區塊, 只換清單)──
DO $newobj_guard$
DECLARE
  -- 🔴 結尾的 ::text[] 不能拿掉 —— 清單清空時 ARRAY[] 無法推斷型別。
  v_relations text[] := ARRAY[
    'public.pcm_unpaid_cancelled_email_pending'
  ]::text[];
  v_functions text[] := ARRAY[]::text[];
  v_declares_nothing boolean := false;

  r          text;
  v_oid      oid;
  v_bad      int := 0;
  v_first    text;
  v_checked  int := 0;
  v_priv     text;
  v_col      text;
BEGIN
  IF cardinality(v_relations) = 0 AND cardinality(v_functions) = 0 THEN
    IF NOT v_declares_nothing THEN
      RAISE EXCEPTION
        '新物件收權斷言:兩份清單都是空的。本檔若真的沒新建物件，請把 v_declares_nothing 設成 true（明示），不要留空。';
    END IF;
    RAISE NOTICE '新物件收權斷言:本檔明示未新建任何物件，略過（已留痕）。';
    RETURN;
  END IF;

  FOREACH r IN ARRAY v_relations LOOP
    v_oid := to_regclass(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到關聯 % —— 名字打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    -- 🔴🔴 **權限清單由伺服器推導,不手寫**(codex 2026-08-17 `must-fix`)。
    --    E-684 樣板手寫七種,而 **PG 17 有八種 —— 少了 `MAINTAIN`**。
    --    而本檔自己的病構造輸出就印著 `anon=MAINTAIN` ⇒ **樣板掃不到它自己舉的那個例子。**
    --    改成從 `acldefault('r', owner)` 推導:PG 之後再加第九種,這一臂自動入列。
    --    📎 同一個修法 B1-b 已經走過(`docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql:343-346`)。
    --    🔴 `DISTINCT` 在這裡是承重的:這是迴圈,同一權限型別出現兩次會讓 v_bad 多加一次。
    FOR v_priv IN
      SELECT DISTINCT d.privilege_type
        FROM aclexplode(acldefault('r', (SELECT relowner FROM pg_class WHERE oid = v_oid))) d
    LOOP
      IF has_table_privilege('anon', v_oid, v_priv)
         OR has_table_privilege('authenticated', v_oid, v_priv) THEN
        v_bad := v_bad + 1;
        IF v_first IS NULL THEN v_first := format('%s 上仍有 %s', r, v_priv); END IF;
      END IF;
    END LOOP;

    -- 🔴🔴 欄級授權必須另外問 —— `has_table_privilege` 對【只有欄級授權】的情況回 false。
    FOR v_col IN
      SELECT a.attname FROM pg_attribute a
       WHERE a.attrelid = v_oid AND a.attnum > 0 AND NOT a.attisdropped
    LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        IF has_column_privilege('anon', v_oid, v_col, v_priv)
           OR has_column_privilege('authenticated', v_oid, v_col, v_priv) THEN
          v_bad := v_bad + 1;
          IF v_first IS NULL THEN
            v_first := format('%s.%s 上仍有【欄級】%s', r, v_col, v_priv);
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOREACH r IN ARRAY v_functions LOOP
    v_oid := to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到函式 % —— 簽名打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN v_first := format('%s 上仍有 EXECUTE', r); END IF;
    END IF;
  END LOOP;

  IF v_checked = 0 THEN
    RAISE EXCEPTION '新物件收權斷言:檢查數為 0 —— 這個斷言沒有分母，不算通過。';
  END IF;

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      E'❌ 新物件收權斷言失敗:anon/authenticated 仍持有 % 項權限（第一個:%）。檢查了 % 個物件。\n'
      '   ⇒ 補上:REVOKE ALL ON <物件> FROM PUBLIC, anon, authenticated;\n'
      '   🔴 兩道都要下:FROM PUBLIC 收不到具名授權，FROM 具名 收不到 PUBLIC 授權。',
      v_bad, v_first, v_checked;
  END IF;

  RAISE NOTICE '✅ 新物件收權斷言通過:檢查 % 個物件，anon/authenticated 權限 0 項。', v_checked;
END
$newobj_guard$;

-- ── 字面釘樁 ──────────────────────────────────────────────────────
-- ⚠️ 射程與第一片同款:證的是**字面在 view 定義裡**, 不證它在真資料上篩對了;
--    `strpos` 擋不住 `OR TRUE`;而它**只在本檔 apply 那一刻成立**。
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_catalog.pg_get_viewdef('public.pcm_unpaid_cancelled_email_pending'::regclass, true);
  IF pg_catalog.strpos(v_def, 'pcm_js_trim_whitespace') = 0 THEN
    RAISE EXCEPTION '釘樁①:view 裡找不到 pcm_js_trim_whitespace ⇒ 收件人條件不見了 ⇒ 兩個信箱都空的單會回到掃描面';
  END IF;
  IF pg_catalog.strpos(v_def, 'order_cancellations') = 0 THEN
    RAISE EXCEPTION '釘樁②:view 裡找不到 order_cancellations ⇒ 身分判準不見了 ⇒ 【逾時自動取消】那批也會收到信(而 Sean 2026-09-03 拍過不寄)';
  END IF;
  -- 🟢 正對照:這把尺在該找到東西時真的找得到(否則上面兩格恆綠)。
  IF pg_catalog.strpos(v_def, 'order_unpaid_cancelled') = 0 THEN
    RAISE EXCEPTION '釘樁正對照:連 event_type 字面都找不到 ⇒ 這把尺沒接上, 上面兩格的通過不算數';
  END IF;
END
$$;

-- ── 事後閘 ────────────────────────────────────────────────────────
DO $$
BEGIN
  -- 🔴🔴 **`security_invoker` 的 view 用【呼叫者】的權限讀它裡面的每一張表與每一支函式。**
  --    `20260905020000` 就是栽在這個形狀上(codex 2026-09-05 抓到:helper 的 EXECUTE
  --    被 `20260901070000` 從所有人身上收掉了 ⇒ 每輪 503、零新信排入)。
  --    ⇒ 📌 **本片主動把那一課套上來:它多讀一張表, 那張表的 SELECT 也要驗。**
  IF NOT pg_catalog.has_function_privilege(
            'service_role', 'public.pcm_js_trim_whitespace()', 'EXECUTE')
  THEN
    RAISE EXCEPTION '事後閘:service_role 對 pcm_js_trim_whitespace() 沒有 EXECUTE ⇒ 這個 security_invoker view 查一次錯一次 ⇒ 取消信那條線每輪 503(而本支上面就有那道 GRANT ⇒ 走到這裡代表它被別的東西收回去了, 不是漏貼)';
  END IF;
  -- 🔴 **四張底表【全部】要驗, 不是只驗我新加的那一張**(codex 2026-09-05 must-fix):
  --    `security_invoker` 的 view 用呼叫者的權限讀它碰到的**每一張表**
  --    ⇒ 📌 我只驗新增的那張 = **拿「這一片改了什麼」當分母, 而那道閘的分母是「這個 view 讀什麼」。**
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.order_cancellations', 'SELECT')
  THEN
    RAISE EXCEPTION '事後閘:service_role 讀不到 order_cancellations ⇒ 同上, 查一次錯一次';
  END IF;
  -- 🔵 **那三張【既有】的底表用 NOTICE 不用 EXCEPTION, 而理由是量出來的**:
  --    ① **正式庫實測四張都是 true**(`-ship` 2026-09-05 唯讀自量, 不是轉述;
  --       `service_role` 的 `rolbypassrls` 也是 true)
  --    ② 而**拋棄式 PG 的 bootstrap 沒有複製 Supabase 的預設授權** ⇒ 硬 EXCEPTION 會讓
  --       `scripts/migrations-replay-from-zero.sh` **對全隊每一發都變紅** —— 而那是環境缺件, 不是缺陷。
  --    ③ 🔴 **而更重要的是:硬閘在這裡買到的東西很少** —— 它只在 apply 那一刻檢查,
  --       而「有人後來把權限收掉」發生在那之後。⇒ 📌 **那要一道排程檢查, 不是一道 apply 期的閘。**
  --    ⇒ 🛑 **所以這三格印警告、不擋** —— 而它們印出來的東西, 正是那道排程檢查該去看的。
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.orders', 'SELECT')
  THEN RAISE NOTICE '⚠️ service_role 讀不到 orders ⇒ 這個 view 在正式環境會查一次錯一次(本機拋棄式 PG 出現此訊息屬預期)'; END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.customers', 'SELECT')
  THEN RAISE NOTICE '⚠️ service_role 讀不到 customers ⇒ 同上'; END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.email_outbox', 'SELECT')
  THEN RAISE NOTICE '⚠️ service_role 讀不到 email_outbox ⇒ 同上(而它是 anti-join 那一半)'; END IF;
  -- ⚠️ **而這四道【證不到 RLS 可見性】**(codex 同一條的後半):`has_table_privilege` 答的是
  --    表級授權;**若哪天 service_role 的 BYPASSRLS 被收掉**, 這四格照樣綠而 view 會**靜靜回零**
  --    ⇒ 🛑 **而「零列」與「今天沒有信要寄」印同一個東西。** 本檔守不到, 留在這裡當已知邊界。
  IF pg_catalog.has_table_privilege('anon', 'public.pcm_unpaid_cancelled_email_pending', 'SELECT')
  THEN RAISE EXCEPTION '事後閘:anon 讀得到那個含 email 的 view'; END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'public.pcm_unpaid_cancelled_email_pending', 'SELECT')
  THEN RAISE EXCEPTION '事後閘:authenticated 讀得到那個含 email 的 view'; END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.pcm_unpaid_cancelled_email_pending', 'SELECT')
  THEN RAISE EXCEPTION '事後閘(正對照):service_role 讀不到 ⇒ 掃描器會拿到空集合, 而那長得像「沒有信要寄」'; END IF;
END
$$;

COMMIT;
