-- 20260915150000_m4b_partially_cancelled_email_pending.sql
-- M-4b · 部分取消補寄信 —— DB 那半:event_type 加 `order_partially_cancelled` + 掃描面 view。
-- Sean 2026-09-14 拍甲甲甲(主視窗轉):每一次取消各寄一封 / 券金額變高照寄、信裡寫清楚新金額 / 文案先給他看。
-- 文案草稿 `~/pcm-mailbox/0914-部分取消信-文案草稿.md`;TS 那半同顆 commit(enqueue use-case + composeEvent + 文案模板)。
--
-- ══ 為什麼 ═════════════════════════════════════════════════
-- 員工在後台取消【部分】品項(admin_cancel_order p_items, 第 9 代 20260914050000:295)之後, 今天只有一種客人會收到信:
-- 「匯款 + 未付款 + 網站單」走 20260913010000 的 bank_order_amount_changed。其餘(已付 / 部分付 / 刷卡 / 手動單有信箱)
-- 一封都收不到 ⇒ 客人手上那封付款信的金額是取消前的;多付的要不要退、還差多少, 他不知道。
--
-- ══ 做什麼 ═════════════════════════════════════════════════
-- ① `email_outbox_event_type_check` 第 8 代:8 值 → 9 值, 加 `order_partially_cancelled`(NOT VALID → VALIDATE → 換名, 同 20260913010000 形狀)。
-- ④ view `pcm_partially_cancelled_email_current_v`:寄出當下重讀金額(信裡印這一刻的真值, 不印排信時的舊值)。
-- ② `pcm_partially_cancelled_email_dedup_key(uuid,uuid)`:cancellation_id:order_id —— 🔴 鍵綁【那一次取消】不綁單 ⇒ 每次取消各寄一封(Q1 甲)。
-- ③ view `pcm_partially_cancelled_email_pending`:每一列 = 一次部分取消(order_cancellations 有 items 的那些)——
--    帶取消品項 jsonb、取消後剩餘應收(`pcm_order_remaining_receivable`, 稅算不出 ⇒ NULL ⇒ TS 端 unusableAmount 不寄, 不猜)、
--    已收(`order_paid_totals_v.paid_total`)、payment_status / payment_channel;
--    WHERE:單還沒整單取消(整單走既有取消信)· 排除 bank_order_amount_changed 那族(匯款 + 未付款 + web + 非手動)· 手動單要有通知信箱(20260907230000 那句)
--    · anti-join 同鍵 outbox 列。
-- 🔴 零 trigger、零改既有物件的行為;view security_invoker = false(以 owner 讀 orders / customers, 同族七張都這樣)。
--
-- ══ 回滾 ═══════════════════════════════════════════════════
-- `supabase/rollbacks/20260915150000-rollback.sql`:DROP view + DROP dedup 函式 + CHECK 縮回 8 值(表裡有新 event_type 的列 ⇒ 拒退)。

-- ══ 🔴🔴 第 22 件(2026-09-15, 主視窗跨片 workflow 找到、作者逐行證過)════════════════
-- ① 排信之後管理者核准改價(M-4b-03)⇒ 寄出前現值閘判 stale ⇒ 【終態跳過而鍵不退休】
--    ⇒ 掃描面 anti-join 不看 status + UNIQUE(event_type, dedup_key)⇒ 那次取消再也排不回來 ⇒ 客人永遠不知道。
--    ③ 期間收款 / 退款同一條路。✅ 修在 TS:金額漂了而那一列【確定沒交給 provider】⇒ skip + 退休鍵
--    (`markSkippedPartiallyCancelledSnapshotStale`, 形狀照 bank_order_amount_changed 那支)⇒ 下一輪帶新金額重排。
--    ⚠️ 已交給過 provider 的那一列仍不退休(可能已經寄到了):少寄一封 < 同一個人收到兩個金額(本族一貫方向)。
-- ② 讓路給匯款金額變更信的條件原本是抄四條的靜態 SQL, 而那條線還看 env + 地板 + 餘額三條 ⇒ 抄不齊的格子兩封都不寄。
--    ✅ 改成:讓路 = 「這次取消在那條線的掃描面上」(view 欄 bank_line_eligible)且「那條線已上膛」(TS);
--       那條線的掃描面對本信已排的列加對稱 anti-join(下面 ②b)⇒ 本信先寄了, 那條線之後上膛也不會再寄。
-- ④ 本檔依賴 20260915110000(service_role 對 bank_amount_changed 兩支函式的 EXECUTE)而版本號比它小
--    ⇒ 改號 20260915150000;前置閘六驗 EXECUTE, 講清楚先貼哪一支。

-- ══ 🔴🔴 共享邊界:本檔算「錢已經真的出去多少」那兩處, 與 `pcm_order_money_moved` 是【同一份邏輯的第二份抄本】
--    (2026-09-14 A 窗在改退款那條線時比對出來的, 轉給我;我逐段核過, 逐字吻合)═══════════
-- 本檔兩處(`pcm_partially_cancelled_email_pending` 的 `paid_total`、與送信面 `…_current_v` 的同一格)寫的是:
--   `pcm_order_card_refunded(o.id)` + `SUM(order_manual_refunds WHERE voided_at IS NULL)`
-- 而 `pcm_order_money_moved(uuid)`(`20260911170000:109-124`)寫的是三段相加:
--   ① order_refunds status='confirmed'  ② order_manual_refunds voided_at IS NULL
--   ③ failed/manual_failed 而被 order_refund_effective_verdict 更正成 money_moved
-- 而 `pcm_order_card_refunded`(`20260905310000:108-127`)本體逐字 = ① + ③
-- ⇒ 📌 **本檔那兩處 = ①+③+② = `pcm_order_money_moved` 的逐段等價物。**
--
-- 🛑 **為什麼沒有直接呼它(而這不是偷懶)**:`pcm_order_money_moved` 的 EXECUTE 被收起來了 ——
--    它的 COMMENT 逐字「**只給 owner 的兩支 SECURITY DEFINER 呼, 不開成 RPC**」,
--    而本檔是 view, service_role 讀它時**以查詢者身分檢查函式 EXECUTE**
--    (那不是理論:`docs/patterns/revoking-function-execute-in-supabase.md` §3.1, 2026-09-13/14 連撞兩支)
--    ⇒ 直接呼會當場 42501。
--
-- 🔴 **⇒ 所以這是一條【沒有機器在守】的線**:`pcm_order_money_moved` 那三段哪天改了
--    (多一段帳本、或某一段的述詞變了), **本檔這兩處不會跟著變, 也不會有任何東西叫。**
--    ⇒ **動那支函式的人要同時動這裡**;A 窗已把同一句話寫進 refund allowlist 的 why, 兩邊互指。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_def text;
  v_fn  text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass AND c.conname = 'email_outbox_event_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '前置閘一:email_outbox_event_type_check 不在';
  END IF;
  IF v_def LIKE '%order_partially_cancelled%' THEN
    RAISE EXCEPTION '前置閘二:order_partially_cancelled 已在 CHECK 裡 ⇒ 貼過了, 拒重貼';
  END IF;
  -- 釘上一代 8 值都在(20260913010000 那一代);少一個 = 有人動過, 本檔的 IN(...) 會砍掉它
  IF v_def NOT LIKE '%bank_order_amount_changed%' OR v_def NOT LIKE '%order_partially_refunded%'
     OR v_def NOT LIKE '%order_unpaid_cancelled%' OR v_def NOT LIKE '%shipment_tracking_corrected%'
     OR v_def NOT LIKE '%bank_order_created%' OR v_def NOT LIKE '%order_cancelled%'
     OR v_def NOT LIKE '%order_shipped%' OR v_def NOT LIKE '%order_created%' THEN
    RAISE EXCEPTION USING MESSAGE = '前置閘三:CHECK 不是 20260913010000 那 8 值(實得 ' || v_def || ')⇒ 停下人工對齊';
  END IF;
  IF pg_catalog.to_regclass('public.pcm_partially_cancelled_email_pending') IS NOT NULL
     OR pg_catalog.to_regclass('public.pcm_partially_cancelled_email_current_v') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.pcm_partially_cancelled_email_dedup_key(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘四:view 或 dedup 函式已在 ⇒ 貼過了, 拒重貼';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_order_card_refunded(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.pcm_bank_amount_changed_email_dedup_key(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION '前置閘五b:pcm_order_card_refunded / pcm_bank_amount_changed_email_dedup_key 不在 ⇒ 20260912020000 或 20260913010000 還沒貼';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_order_remaining_receivable(uuid)') IS NULL
     OR pg_catalog.to_regclass('public.order_paid_totals_v') IS NULL
     OR pg_catalog.to_regclass('public.order_cancellation_items') IS NULL
     OR pg_catalog.to_regprocedure('public.pcm_js_trim_whitespace()') IS NULL THEN
    RAISE EXCEPTION '前置閘五:pcm_order_remaining_receivable / order_paid_totals_v / order_cancellation_items / pcm_js_trim_whitespace 不齊 ⇒ 20260914070000 還沒貼';
  END IF;
  -- 🔴 第 22 件 ④:函式【在】不夠 —— 本檔的 view 被 service_role 讀時, view 裡呼的每一支函式都以
  --    【service_role 身分】查 EXECUTE(security_invoker = false 只管表, 不管函式;patterns §3.1)。
  --    ⛔ 上一版只驗 to_regprocedure ⇒ 20260915110000 沒貼的庫會一路綠到後置閘那發 SET ROLE 才 42501,
  --      錯誤訊息講的是權限不是「先貼哪一支」。⇒ 在這裡講清楚。
  --    🔵 本檔版本號也因此從 20260915080000 改成 20260915150000:依賴(110000)要排在它【前面】,
  --      從零重放時才不會先撞到它。
  FOREACH v_fn IN ARRAY ARRAY[
    'public.pcm_order_card_refunded(uuid)',
    'public.pcm_order_remaining_receivable(uuid)',
    'public.pcm_js_trim_whitespace()',
    'public.pcm_bank_amount_changed_email_floor()',
    'public.pcm_bank_amount_changed_email_dedup_key(uuid,uuid)'
  ]::text[] LOOP
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION USING MESSAGE =
        '前置閘六:service_role 對 ' || v_fn || ' 沒有 EXECUTE ⇒ 本檔的 view 讀起來會 42501'
        || '(bank_amount_changed 那兩支由 20260915110000 補 —— 那支還沒貼就先貼它)';
    END IF;
  END LOOP;
END
$pre$;

-- ── ① event_type CHECK 第 8 代(9 值)────────────────────────────
ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_event_type_check_v8
  CHECK (event_type IN (
    'order_created', 'order_shipped', 'order_cancelled', 'order_unpaid_cancelled',
    'shipment_tracking_corrected', 'bank_order_created',
    'order_partially_refunded',
    'bank_order_amount_changed',
    'order_partially_cancelled'
  )) NOT VALID;
ALTER TABLE public.email_outbox VALIDATE CONSTRAINT email_outbox_event_type_check_v8;
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check;
ALTER TABLE public.email_outbox
  RENAME CONSTRAINT email_outbox_event_type_check_v8 TO email_outbox_event_type_check;

-- ── ② dedup 鍵(新物件 ⇒ 裸 CREATE)──────────────────────────────
CREATE FUNCTION public.pcm_partially_cancelled_email_dedup_key(
  p_cancellation_id uuid,
  p_order_id        uuid
) RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT p_cancellation_id::text || ':' || p_order_id::text;
$fn$;
COMMENT ON FUNCTION public.pcm_partially_cancelled_email_dedup_key(uuid, uuid) IS
  '部分取消信的 dedup_key = cancellation_id:order_id(20260915150000)。🔴 綁那一次取消不綁單 ⇒ 同一張單取消兩次各寄一封(Sean 09-14 甲)。TS 端 composeEvent 同一個算式, 改一邊要改兩邊。';
REVOKE ALL ON FUNCTION public.pcm_partially_cancelled_email_dedup_key(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_partially_cancelled_email_dedup_key(uuid, uuid)
  FROM anon, authenticated, payment_confirmer;
-- 🔴 service_role 要 EXECUTE:security_invoker = false 只讓【表】以 owner 身分讀, view 裡呼叫的【函式】仍以呼叫者身分查 EXECUTE
--    (PostgreSQL 語意;拋棄式 PG 2026-09-14 實測:不給就 42501 permission denied for function)。
--    ⇒ 20260913010000:271 那句「以 owner 身分呼、不需要 GRANT」在 PG 上不成立 —— 那支在正式庫能跑是因為 service_role 對它的函式實際有 EXECUTE。
GRANT EXECUTE ON FUNCTION public.pcm_partially_cancelled_email_dedup_key(uuid, uuid) TO service_role;

-- ── ②b 匯款金額變更信的掃描面:讓路給部分取消信(第 22 件 ②)──────────────
CREATE OR REPLACE VIEW public.pcm_bank_order_amount_changed_email_pending
  WITH (security_invoker = false, security_barrier = true) AS
SELECT
  m.order_id           AS order_id,
  oc.id                AS cancellation_id,
  m.display_id         AS display_id,
  m.created_at         AS created_at,
  m.total              AS total,
  m.balance_due        AS balance_due,
  m.notification_email AS notification_email,
  m.customer_email     AS customer_email,
  m.order_source       AS order_source
-- 🔴 七條合格性述詞全部**繼承**這一支(bank_transfer / unpaid / cancelled_at IS NULL /
--    order_source='web' / manual_request_id IS NULL / effective_balance_due 非 NULL 且 > 0
--    且 <= effective_total / 兩個信箱至少一個非空)。
--    🛑 **在這裡重寫一份 = 同一條錢的規則兩份, 而兩份會漂**(那正是 20260907220000 檔頭在講的事)。
FROM public.pcm_bank_order_still_mailable m
JOIN public.order_cancellations oc ON oc.order_id = m.order_id
WHERE
  -- 🔴 時間地板(不變式;理由見檔頭)。**不是「今天剛好是 0」。**
  oc.created_at >= public.pcm_bank_amount_changed_email_floor()
  -- 🔵 這一次取消真的有明細。
  --    ⚠️ 誠實標:`20260730140000` 那兩支 DEFERRED CONSTRAINT TRIGGER 已經擋掉「有 header、零明細」
  --      ⇒ 📌 **今天這一條恆為真, 它是第二道, 不是第一道。**
  --      留著的理由:那兩支 trigger 哪天被放寬 ⇒ 這裡讓一筆沒有明細的取消**不寄**, 而不是寄一封
  --      金額與取消前相同的信(客人會以為我們搞錯了)。
  AND EXISTS (
        SELECT 1 FROM public.order_cancellation_items ci
         WHERE ci.cancellation_id = oc.id
      )
  -- 🔴🔴 **anti-join 要帶 dedup_key, 不能只比 order_id + event_type。**
  --    只比那兩樣 ⇒ 第一次取消寄出去的那一列會把**第二次取消**一起擋掉
  --    ⇒ 📌 那就是 plan §3-bis-4 明文禁止的「用 order_id 當鍵」, 換一個地方發作。
  --    🔵 鍵的組法與 TS 那側 `composeEvent` 必須同一份字面 —— 兩邊漂掉時
  --      症狀是「每一輪重排同一封而永遠撞唯一鍵」或「同一次取消寄兩封」, 兩者都不會讓三綠紅。
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = m.order_id
           AND e.event_type = 'bank_order_amount_changed'
           AND e.dedup_key = public.pcm_bank_amount_changed_email_dedup_key(oc.id, m.order_id)
           -- 🔴🔴 **這裡【刻意沒有任何 last_error_code 的條件】, 而那是本 anti-join 最容易被
           --    「順手加回來」的一格 ⇒ 下面事後閘⑤e 釘死它。**
           --
           -- 🔬 **歷史(留痕, 兩次都錯過一輪)**:
           --   ⛔ 第一版:逐字抄 `20260907230000` 鄰居那份【五碼】可退休清單。
           --      🔴 Fable 5.1 F2 擊破:那份清單放行 `bank_order_snapshot_stale` /
           --        `bank_order_not_mailable_at_send` 的理由, 建立在**鄰居的鍵含三值指紋**
           --        (total / balanceDue / recipientEmail 的 sha256,`SupabaseEmailOutboxAdapter.ts:309-314`)
           --        ⇒ 快照一變就是另一把鑰匙 ⇒ 放行才插得進去。
           --        而**本型別的鍵沒有指紋**(plan §3-bis-4 明文禁止把金額放進鍵)⇒ 放行它們
           --        = 那一列回到掃描面而 INSERT 撞唯一鍵 ⇒ **每輪重撈、永遠插不進去**(⟦mail-SKIPKEYNORETIRE⟧)。
           --   ⛔ 第二版:拿掉那兩碼、留下三碼(主視窗 2026-09-13 第一次裁)。
           --      🔴🔴 Fable 5.1 第二輪 F1 擊破 ——**而它打掉的是那次裁示的【前提】**:
           --        留下那三碼的 writer **全都換鑰匙**
           --        (`SupabaseEmailOutboxAdapter.ts:1025` `:superseded:` / `:1045` `:recipientstale:`
           --         / `:1144` `:voided:`)
           --        ⇒ 📌 **它們的 dedup_key 永遠不等於上一行算出來的鍵 ⇒ 永遠不滿足上一行
           --          ⇒ 那段 `NOT IN` 根本讀不到。** 三碼是**死字面**。
           --      🎯 **而死碼不是中性的**:清單存在的唯一可能效果, 是哪天有人用那三碼之一 skip
           --        而**忘了換鑰匙** ⇒ 鍵相等、碼在清單裡 ⇒ 被放行回掃描面 ⇒ 每輪重撈。
           --        ⇒ 🛑 **那正是第一版在修的那個病, 換一個碼再犯一次。**
           --      📌 主視窗 2026-09-13 第二次裁【甲】並更正自己上一輪的裁示, 逐字:
           --        「**一道只有在被誤用時才會生效、而生效方向是壞的閘, 比沒有閘糟。**」
           --   ✅ 第三版(本版):**整段拿掉。** anti-join 只剩 event_type + dedup_key。
           --      🔬 行為零改變 —— 逐種列推過:碼為 NULL 的(pending / sending / sent)照樣擋;
           --        `failed` 照樣擋;**換過鑰匙的** skip 列鍵不同、本來就不被擋;
           --        **沒換鑰匙的** skip 列(`order_ineligible` / `before_send_cutoff`)兩版都被擋。
           --        ⇒ 對今天每一種真的會出現的列, 拿掉前後答案**完全相同**。
           --      🔵 順手消掉另一個壞世界(Fable F3):清單還在的話, 有人刪掉 `COALESCE`
           --        ⇒ `NULL NOT IN (…)` 回 NULL ⇒ WHERE 當假 ⇒ **連已 sent / pending 的列都不擋**
           --        ⇒ 每輪重撈;或 `NOT IN` 被誤改 `IN`。兩者舊閘全綠。
           --        ⇒ 📌 **沒有清單 ⇒ 沒有「清單被改壞」這個世界。**
           --
           -- 🛑🛑 **甲的代價, 寫成規則(主視窗 2026-09-13 指定留這句)**:
           --    **未來要讓某個 skip 碼的列能重排, 去那支 writer 加退休鍵(機制),
           --      不准回來在這裡開一個洞(約定)。**
           --    📌 這是甲唯一需要留下的字 —— 它留的是**方向**, 不是清單。
      )
  -- 🔴🔴 第 22 件 ②(20260915150000 加;以上逐字照 20260913010000:296-373, 只把 CREATE 換成 CREATE OR REPLACE):
  --    同一次取消若【部分取消信】已經講過、或還可能會講 ⇒ 本信讓路。
  --    為什麼要這一條:部分取消信那一側在「本線沒上膛」或「本線的七條述詞 / 地板不收這次取消」時會自己寄
  --    ⇒ 少了這一條, 本線之後上膛 / 那張單之後落回七條述詞裡, 同一次取消會再寄一封講同一件事的信。
  --    🔵 status 條件與部分取消信那一側那條 anti-join 逐字對稱:只有「確定沒交給 provider 的 skipped 列」不擋。
  --    🛑 刻意【不】帶 last_error_code(20260913010000 事後閘⑤e 那條規則照舊;本檔後置閘八b 再釘一次)。
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = m.order_id
           AND e.event_type = 'order_partially_cancelled'
           AND e.dedup_key = public.pcm_partially_cancelled_email_dedup_key(oc.id, m.order_id)
           AND NOT (e.status LIKE 'skipped\_%' AND e.handed_to_provider_at IS NULL)
      );

-- ── ③ 掃描面 ────────────────────────────────────────────────────
CREATE VIEW public.pcm_partially_cancelled_email_pending
  WITH (security_invoker = false, security_barrier = true) AS
SELECT
  o.id                       AS order_id,
  oc.id                      AS cancellation_id,
  o.display_id,
  oc.created_at              AS cancelled_at,
  items.items                AS cancelled_items,
  items.cancelled_count      AS cancelled_count,
  eff.effective_subtotal,
  eff.effective_shipping_fee,
  public.pcm_order_remaining_receivable(o.id) AS remaining_receivable,
  -- 🔴 codex R1 must-fix ②:已【收】不等於已收未退 —— 收 10,000 退 2,000 而剩餘應收 8,000 時,
  --    用毛額會算出「多付 2,000 再退你」⇒ 退兩次。這裡逐字用退款信那張 view 的同一組來源
  --    (`pcm_order_card_refunded` + `order_manual_refunds` 未作廢加總, 20260912020000:100-104)。
  -- 🔴 **共享邊界**:這兩項相加 = `pcm_order_money_moved` 的三段(見檔頭那段);那支改了, 這裡要一起改, 而沒有閘會叫。
  GREATEST(COALESCE(p.paid_total, 0) - refunded.card_refunded - refunded.manual_refunded, 0)::bigint AS paid_total,
  o.payment_status::text     AS payment_status,
  o.payment_channel,
  o.notification_email,
  c.email                    AS customer_email,
  o.order_source,
  -- 🔴🔴 第 22 件 ②:這次取消匯款金額變更信那條線【接得住】嗎(= 在它的掃描面上)。
  --    true 且那條線已上膛 ⇒ TS 讓路(那封信講同一件事而且帶匯款資訊);其餘 ⇒ 本信照寄,
  --    而那條線的掃描面對本信已排的列有對稱的 anti-join(上面 ②b)⇒ 之後上膛也不會再寄一封。
  EXISTS (SELECT 1 FROM public.pcm_bank_order_amount_changed_email_pending bp
           WHERE bp.cancellation_id = oc.id) AS bank_line_eligible
FROM public.order_cancellations oc
JOIN public.orders o ON o.id = oc.order_id
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
LEFT JOIN public.pcm_order_effective_amounts_v eff ON eff.order_id = o.id
LEFT JOIN public.order_paid_totals_v p ON p.order_id = o.id
CROSS JOIN LATERAL (
  SELECT
    public.pcm_order_card_refunded(o.id) AS card_refunded,
    COALESCE((SELECT pg_catalog.sum(m.refund_amount) FROM public.order_manual_refunds m
               WHERE m.order_id = o.id AND m.voided_at IS NULL), 0)::bigint AS manual_refunded
) refunded
CROSS JOIN LATERAL (
  SELECT
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'title', NULLIF(pg_catalog.btrim(oi.product_snapshot ->> 'title'), ''),
        'quantity', ci.cancelled_quantity
      ) ORDER BY oi.id
    ) AS items,
    pg_catalog.count(*)::integer AS cancelled_count
  FROM public.order_cancellation_items ci
  JOIN public.order_items oi ON oi.id = ci.order_item_id
  WHERE ci.cancellation_id = oc.id
) items
WHERE items.cancelled_count > 0                       -- 沒有品項明細的取消(p_items NULL)零列;🔵 整單取消【也會】寫明細, 擋它的是下一行(codex R1 nit)
  AND o.cancelled_at IS NULL                          -- 整單取消走既有取消信 / 未付款取消信
  -- ⛔ ~~AND NOT (匯款 AND 未付款 AND 網站單 AND 非手動)~~ —— 第 22 件 ② 拿掉。
  --    那是把匯款金額變更信那條線的條件【抄了四條】過來, 而那條線真正寄不寄還看
  --    env 上膛 + 時間地板 + 餘額三條述詞 ⇒ 抄不齊的那幾格(沒上膛 / 地板之前 / 餘額不是可信正數)兩封都不寄。
  --    ✅ 改成:下面輸出欄 `bank_line_eligible` = 這次取消【在那條線的掃描面上】(地板與七條述詞都由那支 view 自己算,
  --      不在這裡抄), 而「那條線有沒有上膛」只有 TS 知道 ⇒ 由 enqueue 那一側一起判。
  -- 手動單:通知信箱空 = 不寄(Sean 09-10 拍甲;20260907230000 那句逐字)
  AND (o.order_source IS NULL
       OR o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
       OR NULLIF(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL)
  AND (NULLIF(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
       OR NULLIF(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL)
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_partially_cancelled'
           AND e.dedup_key = public.pcm_partially_cancelled_email_dedup_key(oc.id, o.id)
      )
  -- 🔴 codex R1 must-fix ③:讓路只成立於【當下】—— 未付款時已寄過 bank_order_amount_changed,
  --    客人付款後這次取消就不再在那條線的掃描面上 ⇒ 同一次取消會再寄一封講同一件事的信。
  --    ⇒ 同一次取消只要【任一封】講過金額改了, 本信就不寄(兩支 dedup 函式的鍵同形 cancellation:order)。
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'bank_order_amount_changed'
           AND e.dedup_key = public.pcm_bank_amount_changed_email_dedup_key(oc.id, o.id)
           -- 🔴 codex R2 must-fix ①:那一列若是【終態跳過而且從沒交給 provider】(客人付清後銀行信
           --    走 not_mailable 跳過)⇒ 那封信其實【沒寄】⇒ 再擋本信 = 兩封都沒寄、永久漏。
           --    ⇒ 只有「寄過 / 還可能會寄」的列才擋。`handed_to_provider_at IS NULL` 是「確定沒交出去」的那一半。
           AND NOT (e.status LIKE 'skipped\_%' AND e.handed_to_provider_at IS NULL)
      );

COMMENT ON VIEW public.pcm_partially_cancelled_email_pending IS
  '部分取消補寄信的掃描面(20260915150000;Sean 09-14 甲甲甲)。一列 = 一次部分取消(order_cancellations 有 items)。'
  'remaining_receivable = pcm_order_remaining_receivable(含稅單稅算不出 ⇒ NULL ⇒ TS 端不寄, 不猜);paid_total = order_paid_totals_v。'
  '排除:已整單取消(走取消信)/ 手動單無通知信箱。'
  'bank_line_eligible = 這次取消在 pcm_bank_order_amount_changed_email_pending 上;那條線已上膛時 TS 讓路給它(20260915150000 第 22 件 ②), 兩條線的 anti-join 對稱。'
  'anti-join 兩支:同鍵的 order_partially_cancelled 與 bank_order_amount_changed(同一次取消只講一次金額);不分 status(同族既有語意)。'
  'paid_total 是【已收未退】(毛額扣 pcm_order_card_refunded 與未作廢人工退款)—— 用毛額會承諾退第二次。';

REVOKE ALL ON public.pcm_partially_cancelled_email_pending FROM PUBLIC;
REVOKE ALL ON public.pcm_partially_cancelled_email_pending FROM anon, authenticated, service_role;
GRANT SELECT ON public.pcm_partially_cancelled_email_pending TO service_role;

-- ── ④ 寄出當下的現值(codex R1 must-fix ④)────────────────────────────────
-- 🔴 排信與寄出之間會過幾秒到幾小時(重試):客人這中間付清了、或我們退了款 ⇒ 信裡那幾個數字就變成假的
--    (「請補付」給一個已經付清的人、「會退你 X」而 X 已經退過)。既有的 order_ineligible 閘只擋【整單取消 / 全退】。
-- ⛔ ~~修法不是「比對後放棄」而是【寄出當下重讀】—— 信裡印的永遠是這一刻的真值~~(codex R2 ② 推翻:同冪等鍵換內文 ⇒ Resend 409)。
-- ✅ 現況:內文永遠是排信那一刻凍進 payload 的那份;這張 view 的現值【只當閘】——
--    整單取消 ⇒ 終態;金額漂了 ⇒ 沒交給過 provider 才退休鍵重排(20260915150000 第 22 件)。
-- 🔵 一列一張單;`still_partial` = 這張單仍是「部分取消而沒整單取消」的狀態(整單取消了 ⇒ 該走取消信, 本信不寄)。
CREATE VIEW public.pcm_partially_cancelled_email_current_v
  WITH (security_invoker = false, security_barrier = true) AS
SELECT
  o.id AS order_id,
  (o.cancelled_at IS NULL) AS still_partial,
  eff.effective_subtotal,
  eff.effective_shipping_fee,
  public.pcm_order_remaining_receivable(o.id) AS remaining_receivable,
  -- 🔴 **共享邊界**(同檔頭):下面兩項相加 = `pcm_order_money_moved` 的三段。那支改了這裡要一起改, 沒有閘會叫。
  GREATEST(COALESCE(p.paid_total, 0)
           - public.pcm_order_card_refunded(o.id)
           - COALESCE((SELECT pg_catalog.sum(m.refund_amount) FROM public.order_manual_refunds m
                        WHERE m.order_id = o.id AND m.voided_at IS NULL), 0), 0)::bigint AS paid_total
FROM public.orders o
LEFT JOIN public.pcm_order_effective_amounts_v eff ON eff.order_id = o.id
LEFT JOIN public.order_paid_totals_v p ON p.order_id = o.id;

COMMENT ON VIEW public.pcm_partially_cancelled_email_current_v IS
  '部分取消信【寄出當下】重讀的現值(20260915150000;codex R1 must-fix ④)。'
  '金額口徑與掃描面那張逐字相同(remaining_receivable 含稅、paid_total 是已收未退);'
  'still_partial = false ⇒ 這張單已整單取消, 本信不該寄(走取消信)。零寫入、零 trigger。';

REVOKE ALL ON public.pcm_partially_cancelled_email_current_v FROM PUBLIC;
REVOKE ALL ON public.pcm_partially_cancelled_email_current_v FROM anon, authenticated, service_role;
GRANT SELECT ON public.pcm_partially_cancelled_email_current_v TO service_role;

-- ── 後置閘 ────────────────────────────────────────────────────
DO $post$
DECLARE
  -- 收權斷言清單(靜態閘 ③ 數這兩個陣列;可授權物件 4 = 1 函式 + 2 新 view + 1 CREATE OR REPLACE 的 view)
  v_functions text[] := ARRAY[
    'public.pcm_partially_cancelled_email_dedup_key(uuid,uuid)'
  ]::text[];
  v_relations text[] := ARRAY[
    'public.pcm_partially_cancelled_email_pending',
    'public.pcm_partially_cancelled_email_current_v',
    'public.pcm_bank_order_amount_changed_email_pending'
  ]::text[];
  r text; v_def text; v_cols text; v_n integer; v_bank integer;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass AND c.conname = 'email_outbox_event_type_check';
  IF v_def IS NULL OR v_def NOT LIKE '%order_partially_cancelled%' THEN
    RAISE EXCEPTION '後置閘一:CHECK 換名後不含 order_partially_cancelled';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.email_outbox'::regclass AND conname = 'email_outbox_event_type_check_v8') THEN
    RAISE EXCEPTION '後置閘二:v8 暫名還在 ⇒ 換名沒成功';
  END IF;
  FOREACH r IN ARRAY v_functions LOOP
    IF pg_catalog.to_regprocedure(r) IS NULL THEN RAISE EXCEPTION '後置閘三:% 不存在', r; END IF;
    IF pg_catalog.has_function_privilege('anon', r, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘四:% 對 anon/authenticated 開著 EXECUTE', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', r, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘四b:% service_role 不能 EXECUTE ⇒ view 對 service_role 會 42501', r;
    END IF;
  END LOOP;
  FOREACH r IN ARRAY v_relations LOOP
    IF pg_catalog.to_regclass(r) IS NULL THEN RAISE EXCEPTION '後置閘五:% 不存在', r; END IF;
    IF pg_catalog.has_table_privilege('anon', r, 'SELECT') OR pg_catalog.has_table_privilege('authenticated', r, 'SELECT') THEN
      RAISE EXCEPTION '後置閘六:% 對 anon/authenticated 開著 SELECT', r;
    END IF;
    IF NOT pg_catalog.has_table_privilege('service_role', r, 'SELECT') THEN
      RAISE EXCEPTION '後置閘七:% service_role 讀不到 ⇒ sweeper 掃不到', r;
    END IF;
  END LOOP;
  -- 🔴 第 22 件 ②:兩條線互讓 —— 兩個方向都要真的接上(只接一邊 ⇒ 另一邊雙寄或兩封都不寄, 而全綠)。
  SELECT pg_catalog.pg_get_viewdef('public.pcm_bank_order_amount_changed_email_pending'::regclass, true) INTO v_def;
  IF pg_catalog.strpos(v_def, 'order_partially_cancelled') = 0
     OR pg_catalog.strpos(v_def, 'pcm_partially_cancelled_email_dedup_key') = 0 THEN
    RAISE EXCEPTION '後置閘八:匯款金額變更信的掃描面沒有讓路給部分取消信 ⇒ 本信先寄了之後, 那條線上膛時會再寄一封';
  END IF;
  IF pg_catalog.strpos(v_def, 'last_error_code') <> 0 THEN
    RAISE EXCEPTION '後置閘八b:匯款金額變更信的掃描面出現 last_error_code ⇒ 違反 20260913010000 事後閘⑤e 的規則';
  END IF;
  IF pg_catalog.strpos(v_def, 'pcm_bank_order_still_mailable') = 0
     OR pg_catalog.strpos(v_def, 'pcm_bank_amount_changed_email_floor') = 0
     OR pg_catalog.strpos(v_def, 'pcm_bank_amount_changed_email_dedup_key') = 0 THEN
    RAISE EXCEPTION '後置閘八c:匯款金額變更信的掃描面掉了原本的述詞(still_mailable / 地板 / 自己的 dedup 鍵)';
  END IF;
  SELECT pg_catalog.string_agg(a.attname::text, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_bank_order_amount_changed_email_pending'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM 'order_id,cancellation_id,display_id,created_at,total,balance_due,notification_email,customer_email,order_source' THEN
    RAISE EXCEPTION '後置閘八d:匯款金額變更信的掃描面欄位形狀變了(實得 %)⇒ 那條線的 adapter 會讀錯', v_cols;
  END IF;
  SELECT pg_catalog.pg_get_viewdef('public.pcm_partially_cancelled_email_pending'::regclass, true) INTO v_def;
  IF pg_catalog.strpos(v_def, 'pcm_bank_order_amount_changed_email_pending') = 0
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                     WHERE a.attrelid = 'public.pcm_partially_cancelled_email_pending'::regclass
                       AND a.attname = 'bank_line_eligible' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION '後置閘九:部分取消信掃描面沒有 bank_line_eligible ⇒ TS 那一側判不出要不要讓路';
  END IF;
  IF pg_catalog.strpos(v_def, 'bank_transfer') <> 0 THEN
    RAISE EXCEPTION '後置閘九b:部分取消信掃描面還留著抄過來的靜態互斥 ⇒ 抄不齊的那幾格兩封都不寄';
  END IF;
  -- 尺是活的:view 以【service_role 身分】跑得動(0 列也算;抓得到 42501 / 42703 / 42883 那種)—— sweeper 就是這個身分。
  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT pg_catalog.count(*) INTO v_n FROM public.pcm_partially_cancelled_email_pending;
  SELECT pg_catalog.count(*) INTO v_bank FROM public.pcm_bank_order_amount_changed_email_pending;
  EXECUTE 'RESET ROLE';
  RAISE NOTICE '[20260915150000] 後置閘全過;部分取消信掃描面 % 列、匯款金額變更信掃描面 % 列', v_n, v_bank;
END
$post$;

COMMIT;
