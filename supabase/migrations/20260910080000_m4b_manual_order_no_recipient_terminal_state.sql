-- ⟦auth-MANUALORDERLIMITBURN⟧ 片 1/2 —— 手動單「看過而不寄」需要一個落得下去的終態。
--
-- ══ 病灶 ═══════════════════════════════════════════════════════════════════
-- Sean 拍板「手動建單可以不填 email = 不寄」(`packages/domain/src/order/notification-fallback.ts`
-- 檔頭逐字)。而**不寄這件事今天沒有留下任何一列** ——
-- 七支 enqueue 都在 use-case 層 `noRecipient += 1; continue;`,不呼叫 `enqueue()` ⇒ **不留痕**。
--
-- ⛔ ~~原句:「掃描面下一輪再撈到同一張單, **永遠**, 而它佔著每輪的名額。」~~
-- 🔴🔴 **那句話 2026-09-10 被 codex R1 推翻, 而我去正式庫問過 `pg_get_viewdef` 之後承認它是錯的。**
--    七張排信掃描面裡, **六張已經自己排除了「手動單 + 通知信箱空」**:
--      pcm_order_created / shipped / cancelled / unpaid_cancelled / tracking_corrected
--        ⇒ 述詞逐字 `order_source IS NULL OR order_source NOT IN (manual_*) OR notification_email 非空`
--          (`20260907230000` 加的)
--      pcm_bank_order_created ⇒ 底層 `pcm_bank_order_still_mailable` 是 **web-only**, 手動單根本進不來
--      🔴 **只有 `pcm_partial_refund_email_pending` 還沒有那道排除。**
--    🟢 正對照:同一發問「有沒有提到 notification_email」⇒ **七張全 t**(尺讀得到述詞)
--    🔵 負對照:問一個現造字面 ⇒ **七張全 f**(尺不是恆真)
-- ⇒ ✅ **精確版:今天真正還在每輪重撈的是【部分退款信】那一條,不是七條。**
-- ⇒ 📌 **而本片仍然要做** —— 那條線是真的, 而且六張 view 用的是「把判準抄進 SQL」那條路
--    (正是 `@pcm/domain` 註解警告的乙), 本片給的是不用抄判準的那條。**但急迫性不是七倍。**
--
-- 🔬 **正式庫實測(2026-09-10 唯讀)**:
--    手動單 3 張 ⇒ `notification_email` 空 **3/3**;網路單 3 張 ⇒ 空 **0/3**
--    逐張比對 outbox:零信的三張**正好就是三張手動單**。
--    🟢 而最強的對照是 09-06 那張 **web + unpaid 有 1 封信** ——
--       同樣付款狀態、不同來源、相反結果 ⇒ **「沒付錢所以不寄」被排除掉了。**
--    📎 讀數與量法 `docs/reviews/2026-09-10-mail-three-rows-verification.md` §4 §5。
--
-- ══ 🔴 而有一道牆,它解釋了「為什麼當初的人選擇什麼都不寫」 ══════════════════
--    `email_outbox_recipient_nonempty  CHECK (recipient_email <> '')` + `NOT NULL`
--    ⇒ **「這張單沒有收件人」這件事,今天寫不進那張表。** 不是疏忽,是牆。
--
-- ══ 🔵 Sean 拍板【甲】(2026-09-10)═══════════════════════════════════════════
--    借 `customers.email` 當 `recipient_email`(那一欄 NOT NULL,本來就有值)
--    + **新增一個終態**,而那一列**不寄**。
--    📎 plan `docs/plans/2026-09-10-manual-order-recipient-plan.md`
--    🛑 **不走乙(放寬 `recipient_nonempty`)** —— 那道 CHECK 守的是「排了一封寄不出去的信」,
--       放寬它的代價落在另外六種事件型別身上,而今天沒有任何一格在守那件事。
--
-- ══ 🔴🔴 為什麼「新增一個終態」是安全的 —— 兩道現有的閘會自動擋住它 ════════════
--  ① `admin_requeue_dead_email`(2026-09-10 唯讀讀它的定義)逐字**只認 `pending` / `failed`**,
--     其餘一律 `RAISE EXCEPTION` ⇒ **人工救援按不動它。**
--     🔵 而那支函式自己的註解逐字寫著:「**新增第八態的人:預設落在【不可重排】那一側,
--        要進來請在這裡具名。**」⇒ 📌 本支就是那個第八態,而它**刻意不去那裡具名**。
--  ② 掃描面的 anti-join 條件是 `COALESCE(e.last_error_code,'') NOT IN (放行碼)`。
--     🔴 **放行碼今天是【五個】不是四個**(`recipient_stale_at_send` 是 `20260907230000` 加的;
--        2026-09-10 讀正式庫 `pg_get_viewdef` 確認)—— ⛔ ~~原句寫「四個」~~。
--     ⇒ 本片寫下的 `last_error_code = 'manual_no_recipient'` **不在那五個裡**
--     ⛔ ~~原句:「那一列會讓 `NOT EXISTS` 成立」~~ ⇒ 🔴 **寫反了**(codex R1 nit):
--        有這麼一列 ⇒ 內層 `EXISTS` 為 **true** ⇒ `NOT EXISTS` 為 **false** ⇒ WHERE 不成立
--        ⇒ ✅ **那張單被排除在掃描面之外。結論一樣,而機制那句話當初寫錯了。**
--     🔵 放行判準逐字是「這個碼寫下去之後,下一輪重排算得出【不同的】dedup_key 嗎?」
--        ⇒ 本碼算不出(手動單留白這件事不會變)⇒ **不放行是對的,不是漏掉。**
-- ⇒ 🎯 **兩道閘都是【既有的、預設拒絕】** —— 不用任何人記得回來加東西。
--
-- ══ ⚠️ 部署順序(這一支必須先貼)═══════════════════════════════════════════
-- 片 2 的碼會 insert 這個 status。**本支沒貼上去之前,那個 insert 會被 CHECK 擋掉。**
-- ⇒ 🔴 **本支先貼 → 才推片 2 的碼。** 反過來 = 手動單那條路整條 throw。
-- 🔵 而**先貼本支、片 2 還沒上**是安全的:沒有人寫那個值,CHECK 多一個選項不影響任何現有列。
--
-- ══ 🔵 為什麼是 DROP + ADD 而不是 ALTER ════════════════════════════════════
-- Postgres 沒有「改一個 CHECK 的運算式」的語法。⇒ 只能換掉。
-- 🛑 **風險:換的時候少打一個舊值。**
-- ⛔ ~~原句:「而【已經存在的列不會叫】—— CHECK 只在寫入時驗。」~~
-- 🔴 **那句是錯的**(codex R1 nit,PostgreSQL 官方文件):本支的 `ADD CONSTRAINT` **沒有 `NOT VALID`**
--    ⇒ 它會**掃全表驗證既有列** ⇒ 少打一個【目前有資料在用】的舊值 ⇒ **ADD 當場失敗、交易回捲**,
--    不會靜默留下孤兒。
-- ✅ **所以下面那八格斷言真正補到的是另一種**:少打一個**目前沒有資料在用**的舊值
--    —— 那一種 ADD 會過,而它要等到將來第一次寫那個狀態時才炸。**今天七個舊值裡有六個是 0 列。**
-- ⇒ ✅ 逐個八個值都對一次,不是只對新的那一個。

-- 🔴 **這裡刻意【沒有】 `\set ON_ERROR_STOP on`**(2026-09-10 codex R1 must-fix)——
--    那是 psql 的反斜線指令,不是 SQL。貼板工具 `scripts/apply-paste-board.sh:530` **白名單式全拒**
--    所有 `\` 指令(理由:`\!` 能跑 shell、`\c` 能換庫而 A/B 驗證看不到、`\quit` 能提早成功離開)。
--    🟢 而我是**自己數過才承認的**:repo 409 支 migration 裡有這一行的 = **1 支,就是我這支**
--       ⇒ 我抄錯了地方(抄的是 `supabase/rollbacks/` 那邊的少數寫法,而那些不走貼板工具)。
--    ✅ 錯誤中止由執行端給:`psql -v ON_ERROR_STOP=1`(貼板工具本來就有傳)。
BEGIN;

-- 🔵 ADD CONSTRAINT 會取 ACCESS EXCLUSIVE 並掃全表驗證(今天 6 列 ⇒ 瞬間)。
--    lock_timeout 是給「將來表大了、而有人在寫」那一天的:等不到就退,不要卡住寄信。
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.email_outbox
  DROP CONSTRAINT email_outbox_status_check;

ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_status_check CHECK (
    status = ANY (ARRAY[
      'pending'::text,
      'sending'::text,
      'sent'::text,
      'failed'::text,
      'skipped_no_real_email'::text,
      'skipped_order_ineligible'::text,
      'skipped_shipment_voided'::text,
      -- 🆕 手動單留白 = 不寄(Sean 拍板)。**終態,不可重排。**
      'skipped_manual_no_recipient'::text
    ])
  );

-- ══ 斷言 ═══════════════════════════════════════════════════════════════════
DO $assert$
DECLARE
  v_def  text;
  v_want text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(con.oid) INTO v_def
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'email_outbox'
     AND con.conname = 'email_outbox_status_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '狀態約束 斷言失敗:email_outbox_status_check 不見了 ⇒ DROP 成功而 ADD 沒成功';
  END IF;

  -- 🔴 **八個值逐個對** —— 只對新的那一個,會漏掉「換的時候少打一個舊值」那一種,
  --    而那一種【已經存在的列不會叫】(CHECK 只在寫入時驗)。
  FOREACH v_want IN ARRAY ARRAY[
    'pending', 'sending', 'sent', 'failed',
    'skipped_no_real_email', 'skipped_order_ineligible', 'skipped_shipment_voided',
    'skipped_manual_no_recipient'
  ] LOOP
    IF pg_catalog.strpos(v_def, '''' || v_want || '''') = 0 THEN
      RAISE EXCEPTION '狀態約束 斷言失敗:新的 CHECK 裡找不到 % ⇒ 那個狀態的列從此寫不進去', v_want;
    END IF;
  END LOOP;

  -- ⚪ **負對照:這把尺不是恆真** —— 一個現造字面必須找不到。
  --    少了它,上面那八個 t 只證明「strpos 會回非零」,不證明它真的在讀那個約束。
  IF pg_catalog.strpos(v_def, '''zzz_never_a_status_20260910''') <> 0 THEN
    RAISE EXCEPTION '狀態約束 斷言失敗(負對照):現造字面竟然命中 ⇒ 這把尺壞了, 上面八格不算數';
  END IF;

  -- 🟢 正對照:那道**別的** CHECK 還在 —— 證明我沒有手滑動到隔壁。
  --    (`recipient_email <> ''` 正是本片繞開的那道牆;它要留著。)
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'email_outbox'
       AND con.conname = 'email_outbox_recipient_nonempty'
  ) THEN
    RAISE EXCEPTION '狀態約束 斷言失敗:email_outbox_recipient_nonempty 不見了 ⇒ 本支動到隔壁的約束了';
  END IF;
END
$assert$;

COMMIT;
