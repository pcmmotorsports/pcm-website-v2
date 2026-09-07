-- 20260908080000 · M-4b QB-16 片 ② :真正的部分退款通知信的【掃描面】。
--
-- 🛑🛑 **草稿。未 apply。**
-- 🔴 **它與片 ①(`20260908070000` 放寬 event_type 白名單)是一對** ——
--    白名單沒放寬就掃得到而寫不進去。前置閘②在下面擋這件事。
--
-- ══ 🔴🔴 **一個【被取代的拍板】, 這裡再寫一份** ═══════════════════════════════════
--   `20260905310000_m4b_cancelled_email_pending_view.sql:214` 註明 **Sean 2026-09-02 拍甲**,
--   `:217` 逐字「⇒ **不涵蓋匯款/現金的單, 也不涵蓋 `partiallyRefunded`(部分退款)。**」
--   ⛔ ~~「不涵蓋 `partiallyRefunded`」那半~~ 🔴 **2026-09-08 被 Sean 的 QB-16【甲】取代**
--      —— 逐字「要寄的是**真正的部分退款**(退了一部分、單子沒有全退)—— 今天完全沒有信的那一群」。
--   🛑 **那句舊字面刻意不刪** —— 它是那支 view 為什麼長那樣的紀錄;而**它不會自己過期**
--      ⇒ 📌 不寫訂正的話, 下一個讀到它的人會以為排除仍然成立。
--   ⚠️ **射程**:「不涵蓋匯款/現金」那半 **仍然成立**(本支同樣只做 `payment_method = 'tappay'`)。
--
-- ══ 🔴🔴 **本支的【粒度是一筆退款】, 不是一張單 —— 而那是整支檔最承重的一個決定** ══
--   姊妹那五張 pending view 都是【一列一張單】;**本支是一列一筆 `order_refunds`**。
--   ✅ 理由(量到的, 不是推的):`20260812170000_..._2f_initiate_advisory.sql:598` 逐字
--      `IF v_ps NOT IN ('paid', 'partiallyRefunded') THEN ... ORDER_NOT_REFUNDABLE`
--      ⇒ **一張已經 `partiallyRefunded` 的單還可以再退一次**;
--      🟢 正對照:`:594` 只有 `payment_status = 'refunded'` 才回 `REFUND_LEDGER_FULL` 硬擋
--      ⇒ 尺分得出「還能退」與「不能退」兩個世界 ⇒ 📌 **分批退不是假想。**
--   ⇒ 主視窗 A **2026-09-08 裁【甲 = 每次都寄】**:唯一鍵是 `(event_type, dedup_key)`
--     (`20260717020000:377`, **不含 order_id**)⇒ `dedup_key = order_refunds.id`
--     ⇒ **每一筆退款各自有一列, 各自寄一封。**
--   🛑 **把 `dedup_key` 改回 `order_id` 會【安靜地】變成「只寄第一次」** ——
--      第二筆錢默默進客人帳戶而他零通知, 而**三綠不紅、測試不紅、畫面上沒有形狀**。
--      ⇒ 要改它, 先拿 Sean 新的一次拍板。
--   🔵 Q2 已進 Sean 佇列(A 端);他若改答「只寄第一次」再改, **不預先留切換點**
--      —— 兩種寫法的 view 不一樣, 留切換點等於寫兩套。
--
-- ══ 🔴 **三處我【刻意不照抄】姊妹 view, 逐條寫理由(不寫的話會被讀成漏抄)** ═══════
--   ① **不要求 `cancelled_at IS NOT NULL`, 而【要求它 IS NULL】** —— 兩件事, 不要讀成同一件。
--      姊妹那張是「取消信」所以要求它非空;本支是「你的錢退了一部分」——
--      **那張單還活著**, 要求它非空等於掃描面幾乎恆空。
--      🟢 而**不會與取消信重複寄**:`pcm_cancelled_email_pending` 要求
--      `payment_status = 'refunded'`, 本支要求 `'partiallyRefunded'` ⇒ **兩者互斥。**
--      ⛔ ~~本支第一版【完全不看 `cancelled_at`】~~ 🔴 **2026-09-08 改**, 而抓到它的是 typecheck:
--        `SUPPRESS_WHEN_ORDER_INELIGIBLE`(`IEmailOutbox.ts`)是 `Record<union, boolean>`
--        ⇒ 加新事件型別而沒標那一格 ⇒ **編不過** ⇒ 逼我去讀那道寄送前的閘,
--        而它的判準是 `payment_status='refunded' OR cancelled_at IS NOT NULL`
--        (`SupabaseIneligibleOrderEmailScannerAdapter.ts:54` 逐字
--         `'payment_status.eq.refunded,cancelled_at.not.is.null'`)。
--      🛑 **具體失敗情境**:一張**已取消而只退了一部分**的單會進第一版的掃描面
--        ⇒ 信裡逐字「未退款的部分仍會照常出貨」⇒ **那句話對一張取消掉的單是假的。**
--      ✅ ⇒ 排除已取消的單。而那**正好落在 Sean 自己的拍板上**:他 QB-16 選的是
--        「真正的部分退款(退了一部分、**單子沒有全退**)」, 而**取消 + 沒退滿 = 帳對不上**
--        ⇒ 他對那一群的處置逐字是「**那是帳對不上, 去告警不去客人信箱**」。
--      🔴 **而代價要明寫, 不要藏**:**取消 + 只退了一部分**的單 ⇒ **兩條線都不寄**
--        (取消信那張要 `'refunded'`, 本支要 `cancelled_at IS NULL`)
--        ⇒ 📌 **那是一個【今天就存在】的缺口, 不是本片造成的** —— 而本片讓它變得可指名。
--        ⇒ **已回報主視窗開列**(去告警, 不去客人信箱)。
--   ② **不排除有 `order_manual_refunds` 的單**(姊妹那張整張不寄, 主視窗 2026-09-05 裁 Q2 乙)。
--      🔴 姊妹那個排除的**病因是「把和拿來當宣稱」**:卡退 4000 + 現金退 1000 = 總額
--      ⇒ 狀態機說 full 而卡上沒退滿 ⇒ 信會說一句謊。
--      ✅ **本支一列講的是【那一筆卡退的金額】**(`order_refunds.refund_amount`, 單一列的值,
--         不是任何和)⇒ **它在混合軌的世界裡仍然逐字為真。**
--      ⚠️ **代價明寫**:混合軌的單, 現金那筆**不會有信**(那條軌沒有掃描面)
--      ⇒ 客人收到的是**不完整**而**不是錯的**。📌 這與姊妹那張的 fail 方向一致:不說謊。
--   ③ **cutoff 掛在 `confirmed_at`(退款發生的時點), 不掛 `orders.created_at`**。
--      🔴 姊妹那條線的 port 自己寫著這是個病(`ICancelledOrderScanner.ts` 那段
--      「真正在決定收件範圍的是 `created_at`, 而契約寫的是 `cancelled_at`」)
--      ⇒ **一張上線前建立、上線後才退款的單, 用 `created_at` 當閘會讓那位客人收不到信。**
--      ✅ 本支的收件範圍 = 「**這個時點之後退的款**」—— 契約與實作是同一句。
--
-- ══ 🔴 **只認 `status = 'confirmed'`(比 `pcm_order_card_refunded` 窄), 而那是刻意的** ══
--   那支函式另外把「標成 `failed/manual_failed` 而被更正成 `money_moved`」的也算進去。
--   🛑 **本支不算它們** —— 那些列 `confirmed_at IS NULL`(建表 CHECK `order_refunds_confirmed_consistency`
--      逐字 `(status = 'confirmed') = (confirmed_at IS NOT NULL)`)
--      ⇒ **算不出「什麼時候退的」** ⇒ 而那正是這封信要講的事之一。
--   ✅ 方向與片 ④ 一致(A 2026-09-08 收):**金額/時點讀不到就不寄**, 不寄一封「你有一筆退款,
--      而細節我們不告訴你」的信 —— 那比不寄糟。
--   ⚠️ **代價明寫**:那一族(人工更正的)**不會有信**, 要人工處理。

BEGIN;

DO $precondition$
DECLARE v_cnt int;
BEGIN
  -- 前置閘①:底表要在
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'order_refunds' AND c.relkind = 'r';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '前置閘①:找不到 public.order_refunds ⇒ 部署態與預期不符';
  END IF;

  -- 前置閘②:🔴 event_type 白名單要已經放寬 —— 否則掃得到而寫不進去
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.conname = 'email_outbox_event_type_check'
     AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid), '''order_partially_refunded''') > 0;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '前置閘②:order_partially_refunded 不在 event_type 白名單裡 ⇒ 20260908070000 還沒貼 ⇒ 掃得到而寫不進去';
  END IF;

  -- 前置閘③:空白定義那支單一來源要在(收件人述詞用它)
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_js_trim_whitespace';
  IF v_cnt < 1 THEN
    RAISE EXCEPTION '前置閘③:找不到 pcm_js_trim_whitespace ⇒ 空白定義沒有單一來源';
  END IF;

  -- 前置閘④:forward-only
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'pcm_partial_refund_email_pending';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '前置閘④:pcm_partial_refund_email_pending 已存在 ⇒ forward-only,拒重跑';
  END IF;
END
$precondition$;

CREATE VIEW public.pcm_partial_refund_email_pending
  WITH (security_invoker = false, security_barrier = true) AS
SELECT
  o.id                 AS order_id,
  o.display_id         AS display_id,
  -- 🔴 **這一筆退款的身分** —— 它就是 `dedup_key`(見檔頭「粒度」那段)。
  r.id                 AS refund_id,
  -- 🔴 **這一筆**退回那張卡的錢。⛔ 不是任何和 —— 和會在混合軌的世界裡說謊(檔頭 ②)。
  r.refund_amount      AS refunded_amount,
  -- 🔴 什麼時候退的。CHECK `order_refunds_confirmed_consistency` 保證 confirmed ⇒ 它非 NULL。
  r.confirmed_at       AS refunded_at,
  o.notification_email AS notification_email,
  c.email              AS customer_email,
  o.order_source       AS order_source
FROM public.order_refunds r
JOIN public.orders o ON o.id = r.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
-- 🔴🔴 `payment_method` 不是 `payment_channel` —— 而這是 DB 自己的 COMMENT 講的:
--   `20260712203000:87` 的 `COMMENT ON COLUMN public.orders.payment_channel` 逐字
--   「管理/預期收款管道(建單時定、admin 可改);算實收金額用 payment_method+payment_status, **勿用本欄**」
--   ⇒ `payment_channel` 是【打算怎麼收】, `payment_method` 是【實際怎麼收的】。
--   ⚠️ 反向代價明寫:`payment_method` 可為 NULL(`20260604120000:109` nullable)
--     ⇒ 欄沒寫到的舊單掉出掃描面 = 不寄信 —— 那是 fail-closed 的方向, 與本片其餘每一格一致。
WHERE o.payment_method = 'tappay'
  -- 🔴 **真正的部分退款** —— 而它與姊妹那張取消信 view(要求 `'refunded'`)**互斥**
  --   ⇒ 同一張單不會同時進兩個掃描面。
  AND o.payment_status = 'partiallyRefunded'
  -- 🔴🔴 **這張單還活著** —— 取消掉的單走別條路(檔頭 ① 那段有失敗情境與代價)。
  --   🛑 它同時擋住寄送前那道 ineligible 閘的一半, 而**那道閘擋不到掃描這一層**:
  --     閘在 send 之前跑, 而 enqueue 之後才被取消的單要靠它;
  --     ⇒ 📌 **兩道都要**, 不是重複。
  AND o.cancelled_at IS NULL
  -- 🔴 只認已確認到帳的卡退(檔頭「只認 confirmed」那段講了為什麼比函式窄)
  AND r.status = 'confirmed'
  -- 🔴🔴 **排除【事後補登】的退款(codex 2026-09-08 must-fix 5)** —— 而這一條是我漏掉的:
  --   我讀的是 `20260725130100` 的**原始建表**, 而 `backfilled_source` 那四欄是
  --   `20260907020000_m4b_tappaydirect_a1_backfill_columns.sql:112-115` **前一天**才加的。
  --   ⇒ 📌 **讀「這張表長什麼樣」要用 `scripts/latest-definition-of.sh`, 建表那一支不是全部。**
  -- 🛑 **失敗情境是具體的**:三個月前在 TapPay 後台退的錢, 員工今天才補登
  --   ⇒ 那一列的 `confirmed_at` 是**今天**(該欄 COMMENT 逐字「由 DB 給, 會被 now() 覆寫」)
  --   ⇒ 它**穿得過 cutoff** ⇒ 📌 **客人收到一封通知他三個月前那筆退款的信**,
  --     而 cutoff 存在的整個理由就是不要對一批早就忘了這件事的人寄信。
  -- ⛔ **不改用 `backfill_occurred_at` 當 cutoff** —— 該欄 COMMENT 逐字「**員工的說法**,
  --   而那正是這一片裡最可能被填錯的一格」⇒ 拿一個未經查證的時刻決定誰收信 = 用別人的猜當閘。
  -- ✅ 方向與本片其餘每一格一致:**寧可不寄。**
  -- 🔴 **代價明寫**:補登的那一群**不會有信**, 要人工處理 —— 而它同時擋掉另一個風險:
  --   `confirmed` 是終態(所有轉移都要求 `status = 'processing'`, `20260803150000:726` 起)
  --   ⇒ **補登金額填錯了沒有更正路徑** ⇒ 那封信會說一個永遠改不掉的數字。
  AND r.backfilled_source IS NULL
  -- 🔴🔴 anti-join 綁 **`dedup_key = 這一筆退款`**, 不綁訂單(檔頭「粒度」那段)。
  --   🛑 唯一鍵 `(event_type, dedup_key)` **不含 order_id**(`20260717020000:377`)
  --     ⇒ 這裡也只比這兩個, 比 order_id 是多的、而且會與唯一鍵說不同的話。
  --   🔵 放行清單與另外五張 **逐字相同** —— 語意不因為它是新加的就寬一點。
  --     `COALESCE` 不可省:`last_error_code` 可以是 NULL(pending / sent 的列就是)
  --     ⇒ 少了它 `NULL NOT IN (…)` 回 NULL ⇒ WHERE 當假 ⇒ 那些列就不擋了 ⇒ 每一輪重寄同一封。
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.event_type = 'order_partially_refunded'
           AND e.dedup_key = r.id::text
           AND COALESCE(e.last_error_code, '') NOT IN (
                 'shipment_voided',
                 'tracking_superseded',
                 'bank_order_not_mailable_at_send',
                 'bank_order_snapshot_stale',
                 'recipient_stale_at_send'
               ))
  -- 收件人:兩個來源至少一個非空(與姊妹五張逐字相同)
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

COMMENT ON VIEW public.pcm_partial_refund_email_pending IS
$c$**真正的部分退款**通知信(`order_partially_refunded`)的掃描面 —— Sean 2026-09-08 QB-16 拍甲。
🔴 **一列 = 一筆 `order_refunds`, 不是一張單**(姊妹那五張都是一列一張單)。
   `dedup_key = order_refunds.id` ⇒ **分批退每一筆各寄一封**(主視窗 A 2026-09-08 裁甲)。
   理由是量到的:`20260812170000:598` 逐字 `IF v_ps NOT IN ('paid','partiallyRefunded')`
   ⇒ 部分退款的單還能再退;正對照 `:594` 只有 'refunded' 才硬擋 ⇒ 分批退不是假想。
   🛑 改回綁 order_id 會安靜變成「只寄第一次」, 三綠與測試都不紅。
🔴 射程**精確**:`payment_method = 'tappay'` + `payment_status = 'partiallyRefunded'`
   + `order_refunds.status = 'confirmed'`。
   ⛔ ~~`20260905310000:217`「不涵蓋 partiallyRefunded」~~ 那半被本支取代;
   而同句「不涵蓋匯款/現金的單」那半 **仍然成立**。
🛑 **要求 `cancelled_at IS NULL`** —— 這封信逐字說「未退款的部分仍會照常出貨」,
   而那句話對一張取消掉的單是假的。與取消信 view 互斥(那張要 `payment_status='refunded'`)。
   🔴 代價明寫:**取消 + 只退了一部分**的單兩條線都不寄 —— 那是【今天就存在】的缺口,
   而 Sean QB-16 對那一群的處置逐字是「帳對不上, 去告警不去客人信箱」。已開列。
🛑 **不排除混合軌**(姊妹那張排除)—— 本支一列講的是【那一筆卡退的金額】不是任何和,
   在混合軌的世界裡仍然逐字為真。代價:現金那筆沒有信 ⇒ 客人收到的是不完整, 不是錯的。
🛑 **排除【事後補登】的列**(`backfilled_source IS NULL`)—— 補登列的 `confirmed_at` 是
   「我們記帳的時刻」不是「錢動的時刻」⇒ 三個月前的退款今天補登會穿過 cutoff。
   不改用 `backfill_occurred_at`:該欄 COMMENT 逐字是「員工的說法」, 未經查證。
🛑 **比 `pcm_order_card_refunded` 窄**:不含被更正成 money_moved 的 failed 列 ——
   那些列 `confirmed_at IS NULL` ⇒ 算不出「什麼時候退的」⇒ 金額/時點讀不到就不寄。
🔵 cutoff 由呼叫端掛在 `refunded_at`(= `confirmed_at`), **不是** `orders.created_at`
   —— 上線前建立、上線後才退款的單必須收得到信。$c$;

-- 🔴 兩道 REVOKE:少一道都是開的。
REVOKE ALL ON public.pcm_partial_refund_email_pending FROM PUBLIC;
REVOKE ALL ON public.pcm_partial_refund_email_pending FROM anon, authenticated, service_role;
GRANT SELECT ON public.pcm_partial_refund_email_pending TO service_role;

DO $postcondition$
DECLARE
  -- 🔴 收權斷言**只檢查你列出來的物件**:它防「忘記收權」, 不防「忘記列」
  --   ⇒ `migration-new-file-static-checks.sh` ③ 補的正是後者。
  v_relations text[] := ARRAY[
    'public.pcm_partial_refund_email_pending'
  ]::text[];
  v_i    integer;
  v_def  text;
  v_cols text;
  v_cnt  int;
BEGIN
  SELECT definition INTO v_def FROM pg_catalog.pg_views
   WHERE schemaname = 'public' AND viewname = 'pcm_partial_refund_email_pending';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '事後閘①:建完找不到本 view';
  END IF;

  -- 事後閘②:述詞的語意特徵都在(不比整段 —— pg_get_viewdef 會重寫 NOT IN 之類的寫法)
  IF pg_catalog.strpos(v_def, 'partiallyRefunded') = 0
     OR pg_catalog.strpos(v_def, 'cancelled_at') = 0
     OR pg_catalog.strpos(v_def, 'backfilled_source') = 0
     OR pg_catalog.strpos(v_def, 'tappay') = 0
     OR pg_catalog.strpos(v_def, 'confirmed') = 0
     OR pg_catalog.strpos(v_def, 'order_partially_refunded') = 0
     OR pg_catalog.strpos(v_def, 'dedup_key') = 0
     OR pg_catalog.strpos(v_def, 'pcm_js_trim_whitespace') = 0 THEN
    RAISE EXCEPTION '事後閘②:述詞的語意特徵沒有全部命中 ⇒ 我漏了一條(實得 %)', v_def;
  END IF;

  -- 🔵 事後閘③:上面那道要有判別力
  IF pg_catalog.strpos(v_def, 'zzz_never_a_feature') > 0 THEN
    RAISE EXCEPTION '事後閘③:現造字面命中 ⇒ 這把尺壞了';
  END IF;

  -- 🔴🔴 事後閘④:**anti-join 真的綁在 `r.id` 上, 不是綁在訂單上**。
  --   這是本支最容易被下一個人安靜改掉的一格 —— 它一改, 行為變成「只寄第一次」而沒有東西會叫。
  IF pg_catalog.strpos(v_def, 'e.dedup_key = (r.id)::text') = 0
     AND pg_catalog.strpos(v_def, 'e.dedup_key = r.id::text') = 0 THEN
    RAISE EXCEPTION '事後閘④:anti-join 沒有綁在 order_refunds.id 上 ⇒ 分批退會變成只寄第一次(實得 %)', v_def;
  END IF;

  -- 事後閘⑤:欄位就這八個(多帶一欄 = 多曝一份 PII)
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_partial_refund_email_pending'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols <> 'order_id,display_id,refund_id,refunded_amount,refunded_at,notification_email,customer_email,order_source' THEN
    RAISE EXCEPTION '事後閘⑤:欄位不是預期的八欄(實得 %)', v_cols;
  END IF;

  -- 事後閘⑥:ACL 白名單 —— 只有 service_role
  SELECT count(*) INTO v_cnt FROM (
    SELECT (pg_catalog.aclexplode(cl.relacl)).grantee AS g
      FROM pg_catalog.pg_class cl
      JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
     WHERE n.nspname = 'public' AND cl.relname = 'pcm_partial_refund_email_pending'
  ) t
  WHERE t.g <> 0
    AND pg_catalog.pg_get_userbyid(t.g) NOT IN ('service_role', current_user);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '事後閘⑥:ACL 上有 service_role 與 owner 以外的角色(% 個)', v_cnt;
  END IF;
  -- 🔴 relacl 是 NULL 時 aclexplode 回零列 ⇒ 上面那個 0 是假的 ⇒ 另外問一次
  IF (SELECT cl.relacl IS NULL FROM pg_catalog.pg_class cl
        JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
       WHERE n.nspname = 'public' AND cl.relname = 'pcm_partial_refund_email_pending') THEN
    RAISE EXCEPTION '事後閘⑥b:relacl 是 NULL ⇒ 兩道 REVOKE 沒留下痕跡, 閘⑥的 0 是假的';
  END IF;

  -- 🔵 而那張清單要**真的被讀到** —— 否則它只是一段給守門看的裝飾。
  FOREACH v_i IN ARRAY ARRAY[1] LOOP
    IF v_relations[v_i] IS NULL THEN
      RAISE EXCEPTION '事後閘⑦:收權斷言清單少了第 % 項', v_i;
    END IF;
    IF pg_catalog.to_regclass(v_relations[v_i]) IS NULL THEN
      RAISE EXCEPTION '事後閘⑦:收權斷言清單第 % 項指到不存在的物件(%)', v_i, v_relations[v_i];
    END IF;
  END LOOP;
END
$postcondition$;

COMMIT;
