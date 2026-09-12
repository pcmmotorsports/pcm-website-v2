-- 20260913010000 · M-4b 部分取消補寄信 片 ① :email_outbox 加第八個事件型別
--   `bank_order_amount_changed` + 建它的掃描面 view。
--
-- 🛑🛑 **未貼正式庫。** 貼板下一號 = **137**(135 / 136 已貼)。貼的人是 Sean 或他明文授權的那一次。
-- 🔴 **它自己是惰性的** —— 白名單放寬了而入列路徑沒接,這個值一列都不會出現。
--    ⇒ 📎 形狀逐格抄 `20260908070000`(`_v6`)、`20260906140000`(`_v5`)、`20260904220000`(`_v4`)。
--    🔴 **不用 `DROP` 再 `ADD`**:那會在驗證期間鎖表;先例走
--       `ADD _vN NOT VALID → VALIDATE → DROP 舊 → RENAME`。
--
-- ══ 🔴 這一支存在的理由 ═══════════════════════════════════════════════════════════
--   plan `docs/plans/2026-09-12-partcancel-storefront-balance-plan.md` §3-bis-0 逐字:
--   §3 甲 已經把顧客頁那個偏高的數字拿掉了(`19a5b622b` / `47494facf`),而客人因此
--   **手上沒有任何正確金額** —— 匯款成立信只在建單時寄一次
--   (排信面對 `email_outbox` anti-join、**不看 status**:`20260906180000:133-136`),
--   而部分取消**發生在建單之後** ⇒ 他那封是取消前的全額,而沒有任何路會重寄。
--   ⇒ 📌 本片 = 取消之後補一封,把新的應付金額寄給他。
--   Sean 2026-09-13 答 §3-bis-9 三題全【甲】(要做 / 兩次取消寄兩封 / 券作廢算原價照寄)。
--
-- ══ 🔴 為什麼是【新事件型別】而不是重寄 `bank_order_created` ═══════════════════════
--   ① 那封的主旨與文案是「訂單成立,請匯款」,而這一封要講的是「金額改了」。
--   ② `bank_order_created` 的 anti-join 是**按事件型別**做的(`20260907230000:400` 起那段)
--      ⇒ 塞進同一個型別 ⇒ 兩封信**互相吃掉對方的機會**,而症狀是「另一封永遠不寄」,
--        🛑 **且它與「沒有單要寄」印同一個東西** —— 零訊號。
--
-- ══ 🔴🔴 **`dedup_key` 綁【那一次取消】, 不綁【那張單】** ═══════════════════════════
--   唯一鍵是 `(event_type, dedup_key)`(`20260717020000:377`,**不含 order_id**)。
--   ⇒ 本片的鍵 = `{order_cancellations.id}:{order_id}`(plan §3-bis-4)。
--   🔬 **「一次部分取消寫幾列 `order_cancellations`」= 1 列, 而那是量過的**(2026-09-13):
--      · 正式庫唯讀對 `pg_get_functiondef(admin_cancel_order)` 數字串出現次數 ⇒
--        `INSERT INTO public.order_cancellations` **1 個點**(單列 `VALUES` + `RETURNING id`)
--      · 表上另有 `UNIQUE (order_id, idempotency_key)` ⇒ 同一把鍵重跑撞唯一鍵、生不出第二列
--      · repo 全 migrations 對該表的 INSERT 共 6 個真點, 6 個全是 `admin_cancel_order` 的歷代;
--        `admin_mark_order_cancelled` 不寫這表;逾時自動取消也不寫(`20260905030000:62` 逐字)
--      ⚠️ **而實資料沒有驗到部分取消** —— 正式庫該表 4 列, 4 列全是【整單取消】
--        ⇒ 📌 「1 列」的承重點是**函式本體 + 唯一鍵**, 實資料只是不反駁它, 不構成證明。
--   🛑 **改回綁 `order_id` 會【安靜地】變成「只寄第一次」** —— 而 Sean 2026-09-13 答 A1 甲 =
--      取消兩次要收兩封(理由逐字「第二次取消之後金額又變了, 不寄他會照第一封匯」)
--      ⇒ 綁 order_id 直接違反那條拍板, 而三綠與測試都不會紅。
--
-- ══ 🔴🔴 **時間地板:為什麼寫死在 view 裡, 而不是靠「今天剛好是 0」** ═══════════════
--   plan §3-bis-1 的正式庫唯讀讀數(2026-09-12):補寄候選 = **0**,而 ⚪ 尺是活的
--   (同一把尺量「任何管道、有取消件的單」⇒ 4 張)⇒ 那個 0 不是查不到東西。
--   🛑 **而我不把那個 0 當閘** —— 📌 **讀數會過期, 地板是不變式。**
--   ⇒ 述詞是 `oc.created_at >= public.pcm_bank_amount_changed_email_floor()`, 而**值**住在那支函式裡。
--      ⛔ ~~本行原本寫「`… >= '2026-09-13 00:00:00+08'::timestamptz` 寫死在述詞裡」~~ ——
--      那是**第一版的寫法**, 而它在下面那段〈🔴 時間地板做成一支【具名函式】, 而那不是裝飾〉
--      被換掉了(留痕不抹)。⛔ 本行原本把那個標題寫成〈時間地板做成具名函式〉—— grep 對不上(Fable N1)。
--   ⚠️ **這個地板的射程要說清楚**:它是【本 view 建立那一天的零點】,**不是「寄信真的上線那一刻」**。
--      兩者之間若隔了幾天而那幾天有部分取消 ⇒ 接上入列路徑的那一刻會一次寄出那幾筆。
--      ⇒ 🔵 本檔事後閘**⑦**(不是⑥ —— Fable N2 抓到我原本寫錯編號)會 `RAISE NOTICE`
--        印出**貼的當下這張 view 有幾列** ——
--        📌 那不是閘, 是**讓貼的人在接線之前看得到那個數字**;真正的閘是入列路徑還沒接(見下)。
--
-- ══ 🟢 貼了之後會寄幾封 ⇒ **0 封, 而那有三道獨立的鎖** ═════════════════════════════
--   ① **入列路徑不存在**:本片零 TS —— 沒有 scanner adapter、沒有 use-case、沒有 cron。
--      ⇒ 這張 view 上有幾列都不會變成 `email_outbox` 的列。
--   ② **入列那一側構造不出這個型別**:TS 的 `EmailOutboxEventType` union 裡**沒有這個值**
--      ⇒ 📌 帶這個 event_type 的物件在**編譯期**就過不去。
--      🔴 ⛔ ~~我第一版寫「`sweep-email-outbox.ts` 的 switch 對這個型別的 case 是 fail-closed throw」~~
--      —— **那句話是假的, 它描述的是【下一片要做的事】**(Fable 5.1 N1;
--      `grep bank_order_amount_changed packages apps` ⇒ **零命中**,
--      `packages/ports/src/IEmailOutbox.ts` 的 union 到 `order_partially_refunded` 為止)。
--      🛑 那個 **per-type** throw 佔位是下一片要加的(union 一加成員, `satisfies never` 會讓 switch
--         少 case 當場紅 ⇒ 兩者必須同一片落地)。主視窗 2026-09-13 已核准形狀, 本片沒動它。
--   ③ **寄送端對未知型別是 default fail-closed throw**(`sweep-email-outbox.ts` switch 末端)。
--      🔴🔴 **②③ 的射程不同, 兩道都要算**(Fable 5.1 第二輪 N2 —— ⛔ 我原本只算兩道、
--      把③併進②):CHECK 放行這個值之後, 一列**手動在 DB 裡插進去**的列**繞過②**
--      (它沒經過 TS 的入列路徑)⇒ 📌 **那時只有③擋著。**
--   🔴 文案草稿在 `docs/specs/2026-09-13-bank-order-amount-changed-email-copy.md`,
--      標題明寫「草稿, 尚未核可」—— Sean 答 A3 甲 = **他要先看過再上**。

BEGIN;
-- 🔴 **`lock_timeout` 是 forward 這一側也要有的**(Fable N6 提;先例 `20260908070000` 沒有, 而那不是理由)。
--   下面 `ALTER TABLE … ADD CONSTRAINT` 要 **ACCESS EXCLUSIVE** ⇒ 它在排隊等鎖的那段時間裡,
--   **後面每一個 email_outbox 的讀者都跟著卡住**(含排信那條路)。
--   ⇒ 📌 失敗方向要選「等不到就整筆回捲、Sean 重貼一次」, 而不是「把寄信線卡住不知道多久」。
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_def    text;
  v_others text;
BEGIN
  -- 前置閘①:那條 CHECK 要在(否則下面炸的訊息不會告訴你現況是什麼)
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.conname = 'email_outbox_event_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 email_outbox_event_type_check ⇒ 部署態與預期不符,停下人工確認';
  END IF;

  -- 前置閘②:forward-only,拒重跑
  IF pg_catalog.strpos(v_def, '''bank_order_amount_changed''') <> 0 THEN
    RAISE EXCEPTION '前置閘②:bank_order_amount_changed 已經在 CHECK 裡了 ⇒ forward-only,拒重跑';
  END IF;

  -- 前置閘③:🔴 前七個值都要在 —— 本片是【加一個】, 不是【重寫白名單】。
  --   少了任何一個 ⇒ 現況不是我以為的那一版 ⇒ 我這支的 IN(...) 會把它悄悄刪掉。
  --   🛑 一律【帶引號】比對(形狀照 20260908070000 前置閘③ 那段的理由:
  --      裸字串比對會讓「只剩 order_created_v2 這種值」的世界也通過)。
  IF pg_catalog.strpos(v_def, '''order_created''') = 0
     OR pg_catalog.strpos(v_def, '''order_shipped''') = 0
     OR pg_catalog.strpos(v_def, '''order_cancelled''') = 0
     OR pg_catalog.strpos(v_def, '''order_unpaid_cancelled''') = 0
     OR pg_catalog.strpos(v_def, '''shipment_tracking_corrected''') = 0
     OR pg_catalog.strpos(v_def, '''bank_order_created''') = 0
     OR pg_catalog.strpos(v_def, '''order_partially_refunded''') = 0 THEN
    RAISE EXCEPTION '前置閘③:現行 CHECK 不是預期的七值(實得 %)⇒ 本片會覆寫白名單,停下人工確認', v_def;
  END IF;

  -- 前置閘④:這一欄上不該掛著別的 CHECK / FK(含 whole-row 寫法)
  --   ⚠️ 刻意誤報大於漏報:別欄的 whole-row CHECK 也會命中(形狀抄 20260908070000 前置閘④)。
  SELECT string_agg(c.conname, ', ') INTO v_others
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = c.conrelid AND a.attname = 'event_type'
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.contype IN ('c', 'f')
     AND (0 = ANY (c.conkey) OR a.attnum = ANY (c.conkey))
     AND c.conname <> 'email_outbox_event_type_check';
  IF v_others IS NOT NULL THEN
    RAISE EXCEPTION '前置閘④:event_type 這一欄上還掛著別的 CHECK 或 FOREIGN KEY(%)⇒ 放寬了也可能被它擋', v_others;
  END IF;

  -- 前置閘⑤:🔴 本 view 靠它取得【已扣掉取消件】的金額與七條合格性述詞。它不在 ⇒ 停。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
                  WHERE oid = 'public.pcm_bank_order_still_mailable'::regclass) THEN
    RAISE EXCEPTION '前置閘⑤:找不到 pcm_bank_order_still_mailable ⇒ 本片的金額來源不存在,停下';
  END IF;

  -- 前置閘⑥:🔴🔴 **那支基底 view 的金額真的是 effective 嗎** —— 這一格是本片最承重的前置。
  --   🛑 只驗「view 還在」的話, **一個把輸出偷偷換回 `o.total` 的世界會印同一個綠**,
  --      而後果是這封信照樣叫客人匯【沒扣掉取消件】的原本金額 —— 正是本片要修的病。
  --   📌 判準照 `20260907220000` 事後閘③ 立的先例:**比【被選出來的那一欄】的來源, 不比整份定義裡有沒有那個字。**
  SELECT pg_catalog.pg_get_viewdef('public.pcm_bank_order_still_mailable'::regclass, true) INTO v_def;
  IF pg_catalog.strpos(v_def, 'eff.effective_total AS total') = 0
     OR pg_catalog.strpos(v_def, 'eff.effective_balance_due AS balance_due') = 0 THEN
    RAISE EXCEPTION '前置閘⑥:still_mailable 的 total / balance_due 不是取自 effective ⇒ 本片會寄出沒扣的金額,停下';
  END IF;

  -- 前置閘⑦b:🔵 那支地板函式不該已經存在 —— 下面用的是 `CREATE FUNCTION`(不是 OR REPLACE)
  --   ⇒ 撞名本來就會炸, 而**炸的訊息會是 Postgres 的通用句**, 讀不出「那是誰的」。
  --   ⇒ 📌 這一格只是把那句話換成看得懂的。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
              JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND p.proname IN ('pcm_bank_amount_changed_email_floor',
                                 'pcm_bank_amount_changed_email_dedup_key')) THEN
    RAISE EXCEPTION '前置閘⑦b:本片要建的兩支函式至少一支已經存在 ⇒ forward-only, 停下人工確認';
  END IF;

  -- 前置閘⑦:取消那兩張表要在(本 view 的分母與去重鑰匙都靠它們)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid = 'public.order_cancellations'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid = 'public.order_cancellation_items'::regclass) THEN
    RAISE EXCEPTION '前置閘⑦:order_cancellations / order_cancellation_items 至少一張不在,停下';
  END IF;
END
$$;

ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_event_type_check_v7
  CHECK (event_type IN (
    'order_created', 'order_shipped', 'order_cancelled', 'order_unpaid_cancelled',
    'shipment_tracking_corrected', 'bank_order_created',
    'order_partially_refunded',
    'bank_order_amount_changed'
  )) NOT VALID;
ALTER TABLE public.email_outbox VALIDATE CONSTRAINT email_outbox_event_type_check_v7;
ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check;
ALTER TABLE public.email_outbox
  RENAME CONSTRAINT email_outbox_event_type_check_v7 TO email_outbox_event_type_check;

COMMENT ON COLUMN public.email_outbox.event_type IS
$c$事件型別(CHECK 白名單;**新增事件 = 新 migration**)。8 值:
order_created(付款成功通知)/ order_shipped(出貨通知)/ order_cancelled(2026-09-02 新增:刷卡且已全額退款的取消)/
order_unpaid_cancelled(2026-09-03 新增:**未付款**的單被【員工】取消)/
shipment_tracking_corrected(2026-09-04 新增:已出貨的箱【更正貨運單號】之後的更正信。
   dedup_key = 箱 + 單號 ⇒ 同一個單號值只寄一次;連改兩次(A→B→C)只寄到 C)/
bank_order_created(2026-09-06 新增:匯款建單通知)/
order_partially_refunded(2026-09-08 新增:**真正的部分退款** —— 退了一部分、單子沒有全退。
   Sean 2026-09-08 QB-16 拍甲。dedup_key = order_refunds.id ⇒ 分批退每一筆各寄一封)/
🔴 bank_order_amount_changed(2026-09-13 新增:**未付款的匯款單被部分取消之後**, 補一封新的應付金額。
   Sean 2026-09-13 答 §3-bis-9 三題全甲。成因逐字:匯款成立信只在建單時寄一次
   (排信面 anti-join 不看 status, 20260906180000:133-136), 而部分取消在建單之後
   ⇒ 客人手上那封是取消前的全額, 沒有任何路會重寄。
   🔴 **dedup_key = `{order_cancellations.id}:{order_id}`(那一次取消), 不是 order_id**
      ⇒ **同一張單取消兩次各寄一封**(Sean A1 甲 逐字「第二次取消之後金額又變了, 不寄他會照第一封匯」)。
   🛑 改回綁 order_id 會【安靜地】變成「只寄第一次」, 而三綠與測試都不會紅。
   ⚠️ 金額來源 = pcm_order_effective_amounts_v, 而它含【券整張作廢算回原價】+ 運費照規則重算
      ⇒ 📌 **用過券的單, 這封信的金額可能比客人下單時看到的【高】**。
      Sean 2026-09-13 答 A2 甲 = 照寄(與 2026-09-07 Q82 同向)。)$c$;

-- ══ 🔴 時間地板做成一支【具名函式】, 而那不是裝飾 ═══════════════════════════════════
-- 🔬 **我第一版把地板寫成裸字面 `'2026-09-13 00:00:00+08'::timestamptz`, 而事後閘去 strpos 那串字。**
--    ⛔ 那道閘會在正式庫【當場炸】:`pg_get_viewdef` 把 timestamptz 常數用**伺服器的 TimeZone**
--       重新印一次 ⇒ Supabase 預設 UTC ⇒ 定義裡長的是 `'2026-09-12 16:00:00+00'`,
--       而我要找的字串一個字都對不上。
--    ⇒ 📌 **一道「證明地板還在」的閘, 會因為我沒想到 deparse 會改寫字面而把整支 migration 擋死。**
-- ✅ 修法照 repo 既有的形狀(`public.pcm_js_trim_whitespace()` 就住在 still_mailable 的述詞裡):
--    把那個值放進一支 IMMUTABLE 函式 ⇒ **定義裡出現的是【函式名】, 而函式名不會被 deparse 改寫。**
--    🔵 而它順手多給一件事:地板從此是**一個有名字的單一來源**, 改它要動一支函式,
--       不是在一段 WHERE 裡改一個看起來像雜訊的字面。
-- 🔴 用 `CREATE FUNCTION` 而【不是】`CREATE OR REPLACE` —— 撞名時要炸, 不要靜靜蓋掉別人的函式
--    (`20260901070000:34` 逐字記著那個坑)。
CREATE FUNCTION public.pcm_bank_amount_changed_email_floor()
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  -- 🔴 本 view 建立日的零點(台北)。plan §3-bis-5 逐字:**讀數會過期, 地板是不變式。**
  SELECT '2026-09-13 00:00:00+08'::timestamptz;
$fn$;

COMMENT ON FUNCTION public.pcm_bank_amount_changed_email_floor() IS
$c$部分取消補寄信的【時間地板】單一來源(2026-09-13)。

🔴 它答的是:**哪一天之後發生的取消才補寄信。** 早於它的取消一封都不寄。
🛑 **為什麼要有它**:plan §3-bis-1 的正式庫唯讀讀數說今天補寄候選 = 0,
   而 📌 **那是一個讀數, 讀數會過期**;地板是不變式 —— 上線那一刻不會對歷史訂單寄一疊。
🔵 **為什麼是函式而不是 WHERE 裡的字面**:pg_get_viewdef 會用伺服器 TimeZone 重印
   timestamptz 常數 ⇒ 拿字面當事後閘會對不上(2026-09-13 實撞, 見 migration 檔頭)。
   函式名不會被 deparse 改寫 ⇒ 閘釘得住。
⚠️ **射程**:這是【view 建立日】, 不是【寄信真的上線那一天】。兩者之間的取消
   會在接上入列路徑那一刻一起寄 —— migration 事後閘⑦ 會印出當下有幾列。$c$;

REVOKE ALL ON FUNCTION public.pcm_bank_amount_changed_email_floor() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_bank_amount_changed_email_floor()
  FROM anon, authenticated, service_role;
-- 🔵 唯一呼叫端是下面那張 `security_invoker = false` 的 view ⇒ 它以 owner 身分讀
--    ⇒ 本函式【不需要】授給 service_role(形狀與理由逐字照 `20260901070000:66-69`)。
--    ⚠️ 而那是一個【依賴】:哪天有 security_invoker = true 的呼叫端, 這裡要補 GRANT。
ALTER FUNCTION public.pcm_bank_amount_changed_email_floor() OWNER TO postgres;

-- ══ 🔴 `dedup_key` 做成具名函式 + 字面釘樁 ═══════════════════════════════════════
-- 🔬 **Fable 5.1 2026-09-13 F3**:我第一版把鍵寫成裸字面, 而事後閘⑤d 只 strpos `dedup_key` 這個**字**
--    ⇒ ⛔ 一個把分隔符改成 `-`、或把兩個 uuid 倒序、或少一個冒號的世界**照樣全綠**,
--      而症狀是 anti-join 對不上 ⇒ **同一次取消每一輪重排**(而唯一鍵擋住之後就是永久撞鍵噪音)。
-- ✅ 修法**不是新發明的** —— 出貨那族早就這樣做了:`20260822010000:173-213`
--    (函式 + 一道用固定 uuid 呼一次、比整串輸出字面的 apply 期釘樁)。逐格照抄。
-- 🔵 而它順手解掉第二件事:TS 落表端(`SupabaseEmailOutboxAdapter` 的 `composeEvent`)會有第二份實作,
--    而**兩份漂掉不會報錯、三綠不會紅** ⇒ 有了函式, 下一片的 TS 測試可以釘同一份輸出。
CREATE FUNCTION public.pcm_bank_amount_changed_email_dedup_key(
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

COMMENT ON FUNCTION public.pcm_bank_amount_changed_email_dedup_key(uuid, uuid) IS
  '🔴 bank_order_amount_changed 的 email_outbox.dedup_key。形狀 = "{cancellation_id}:{order_id}"。'
  '唯一鍵是 (event_type, dedup_key) 不含 order_id(20260717020000:377)⇒ 同 event_type 內必須全域唯一;'
  'order_cancellations.id 是 uuid PK(20260730130000:69)⇒ 滿足。'
  '🔴 綁【那一次取消】而不是【那張單】是 Sean 2026-09-13 A1 甲:同一張單取消兩次要收兩封 —— '
  '改回綁 order_id 會安靜地變成「只寄第一次」, 三綠與測試都不紅。'
  '⚠️ TS 落表端(SupabaseEmailOutboxAdapter 的 composeEvent)會有第二份實作 —— '
  '兩份漂掉的症狀是【同一次取消重複排入】或【anti-join 永遠對不上】, 不是報錯。改一邊之前先看另一邊。'
  '本檔下面有一道 apply 期的字面釘樁;TS 那半要在接線那一片一起釘。';

-- 🔴 兩道 REVOKE, 少一道都是開的(理由同 view 那一段, 見下面 F1 那塊註解)。
REVOKE ALL ON FUNCTION public.pcm_bank_amount_changed_email_dedup_key(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_bank_amount_changed_email_dedup_key(uuid, uuid)
  FROM anon, authenticated, service_role;
-- 🔵 唯一呼叫端是下面那張 `security_invoker = false` 的 view ⇒ 以 owner 身分呼
--    ⇒ 不需要授給 service_role。⚠️ 而那是一個【依賴】:哪天 TS 那側要直接呼它, 這裡要補 GRANT。
ALTER FUNCTION public.pcm_bank_amount_changed_email_dedup_key(uuid, uuid) OWNER TO postgres;

-- ── dedup_key 的字面釘樁 ──────────────────────────────────────────────────────
-- 🔴 這一道釘的是**輸出的字面**, 不是「函式存在」。
--    改成 `-` 分隔、改成 `{order}:{cancellation}` 倒序、少了冒號 —— 三種都會在這裡當場紅,
--    而**在此之前它們的症狀是 anti-join 對不上 ⇒ 同一次取消每輪重排**。
--    📎 形狀逐格照 `20260822010000:198-213`。
DO $$
DECLARE
  v_key text;
BEGIN
  v_key := public.pcm_bank_amount_changed_email_dedup_key(
    '00000000-0000-0000-0000-0000000000c1'::uuid,
    '00000000-0000-0000-0000-0000000000d2'::uuid
  );
  IF v_key <> '00000000-0000-0000-0000-0000000000c1:00000000-0000-0000-0000-0000000000d2' THEN
    RAISE EXCEPTION '補寄信:dedup_key 格式漂了(拿到 %)⇒ anti-join 會對不上 ⇒ 同一次取消每輪重排', v_key;
  END IF;
END $$;

-- ══ 掃描面 ═══════════════════════════════════════════════════════════════════════
-- 🔵 **一列 = 一次取消**(不是一列一張單)—— 去重鑰匙綁那一次取消 ⇒ 掃描面的粒度要跟它一致。
--    🛑 做成「一列一張單」⇒ 第二次取消撈不出來, 而那與「沒有單要寄」印同一個東西。
CREATE VIEW public.pcm_bank_order_amount_changed_email_pending
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
      );

COMMENT ON VIEW public.pcm_bank_order_amount_changed_email_pending IS
  '部分取消補寄信的掃描面(2026-09-13)。**一列 = 一次取消**, 不是一列一張單 —— '
  'dedup_key 綁 order_cancellations.id ⇒ 粒度要與鑰匙一致, 做成一列一張單會讓第二次取消撈不出來。'
  '🔴 七條合格性述詞與金額全部繼承 pcm_bank_order_still_mailable(那支 2026-09-07 起讀 '
  'pcm_order_effective_amounts_v = 已扣掉取消件)⇒ 本 view body 裡一個金額算式都沒有。'
  '🔴 時間地板:**值**住在 pcm_bank_amount_changed_email_floor()(單一來源), 述詞呼它 —— '
  '⛔ 本 COMMENT 原本寫「寫死在述詞裡」, 那不精確(Fable N3)。plan §3-bis-5 逐字:'
  '讀數會過期, 地板是不變式。⚠️ 而地板是【本 view 建立日】不是【寄信上線日】, 兩者之間的取消會在接線那一刻一起寄。'
  '🔴🔴 anti-join 只比 event_type + dedup_key, **刻意沒有任何 last_error_code 條件** '
  '(事後閘⑤e 釘死它)。鄰居 pcm_bank_order_created_email_pending 那份五碼「可退休碼」清單 '
  '**不要抄過來** —— 那份的放行理由建立在鄰居的鍵含三值指紋上, 而本型別的鍵沒有指紋 '
  '⇒ 抄過來會讓那些列回到掃描面而撞唯一鍵、每輪重撈(⟦mail-SKIPKEYNORETIRE⟧)。'
  '🛑🛑 **規則(主視窗 2026-09-13 裁):未來要讓某個 skip 碼的列能重排, 去那支 writer 加退休鍵 '
  '(把 dedup_key 改成 {舊鍵}:<後綴>:{id}, 形狀照 SupabaseEmailOutboxAdapter 的 markSkippedRecipientStale), '
  '【不准】回來在這個 anti-join 開一個碼的洞。** 前者是機制、後者是約定, 而約定會漂。'
  '🔵 退休鍵之所以夠:退休之後那一列的 dedup_key 與算出來的鍵不再相等 ⇒ 它根本不參與本 anti-join '
  '⇒ 那一次取消自然回到掃描面、算得出同一把乾淨的鍵、插得進去。'
  '🟢 貼了之後會寄 0 封, 三道獨立的鎖:① 入列路徑不存在(本片零 TS)'
  '② TS 的 EmailOutboxEventType union 裡沒有這個值 ⇒ 入列那一側連帶這個 event_type 的物件都構造不出來 '
  '③ sweep 的 switch 對未知 event_type 是 default fail-closed throw(sweep-email-outbox.ts 末端)。'
  '🔴 ②③ 射程不同, 兩句都要留(Fable N2):CHECK 放行這個值之後, 一列【手動在 DB 插進去】的列 '
  '繞過②(它沒經過 TS 的入列路徑)⇒ 那時只有③擋著。⛔ 本 COMMENT 原本只寫②、把③換掉了。';

-- 🔴🔴 **兩道 REVOKE, 少一道就是開的**(Fable 5.1 2026-09-13 F1 must-fix, 我開檔核過屬實)。
--   ⛔ ~~我第一版只有 `FROM PUBLIC` 一道, 而註解寫「與 pcm_bank_order_created_email_pending 同款」~~
--      🔴 **那句話是假的** —— 那支是**三行**(`20260906180000:147-150`:FROM PUBLIC / FROM 具名三角色 / GRANT)。
--   🔬 **少那一道的後果不是「權限鬆一點」, 是【這支 migration 貼不上去】**:
--      本專案的 `pg_default_acl` 對 public schema 的 `typ=r`(表**與 view**)有
--      `ALTER DEFAULT PRIVILEGES … anon=arwdDxtm, authenticated=arwdDxtm`
--      (`20260814140000:139-145` 逐字, 那支是實查 pg_default_acl 證實的)
--      ⇒ 新建的 view **一出生就被直接授予給 anon 與 authenticated**, 而那是**具名授權不是 PUBLIC**
--      ⇒ `REVOKE … FROM PUBLIC` 收不掉 ⇒ 下面事後閘⑥b 會 RAISE ⇒ **整筆回捲, 一樣東西都沒貼上。**
--   🎯🎯 **而我本機「apply 成功、事後閘全過」為什麼沒抓到它** ——
--      repo 426 支 migration 裡**沒有任何一支發 `ALTER DEFAULT PRIVILEGES`**
--      ⇒ 拋棄式 PG 從零重放是一個**沒有預設授權的世界** ⇒ 事後閘⑥b 在那裡**恆綠**。
--      ⇒ 📌 **我那發綠證明的是「vanilla PG 上會過」, 不是「Supabase 上會過」** —— 兩者不是同一句話。
--      (判準照 `docs/patterns/revoking-function-execute-in-supabase.md` §1/§2 那條:
--       只 FROM PUBLIC 收不到 ADP 的具名授權;只 FROM 具名收不到 Postgres 給 PUBLIC 的那份。)
-- 🔵 `security_invoker = false` ⇒ 以 owner 身分讀 ⇒ anon / authenticated 不需要也不該拿到。
REVOKE ALL ON public.pcm_bank_order_amount_changed_email_pending FROM PUBLIC;
REVOKE ALL ON public.pcm_bank_order_amount_changed_email_pending FROM anon, authenticated, service_role;
GRANT SELECT ON public.pcm_bank_order_amount_changed_email_pending TO service_role;

DO $postcheck$
DECLARE
  -- 🔴 **收權斷言的清單** —— 本片建了【兩個】可授權物件, 而兩個都要列。
  --    📌 `scripts/migration-static-checks.sh` 規則③ 逐字:收權斷言只檢查你列出來的物件,
  --       「它防【忘記收權】, 不防【忘記列】」⇒ 漏列一個, 那一個的權限就沒有任何東西在看。
  v_relations text[] := ARRAY[
    'public.pcm_bank_order_amount_changed_email_pending'
  ]::text[];
  v_functions text[] := ARRAY[
    'public.pcm_bank_amount_changed_email_floor()',
    'public.pcm_bank_amount_changed_email_dedup_key(uuid, uuid)'
  ]::text[];
  v_def   text;
  v_cols  text;
  v_cnt   bigint;
  v_rel   text;
  v_fn    text;
BEGIN
  -- 事後閘①:CHECK 改名之後找得到,而且新值在裡面
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.email_outbox'::regclass
     AND c.conname = 'email_outbox_event_type_check';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '事後閘①:改名後找不到 email_outbox_event_type_check';
  END IF;
  IF pg_catalog.strpos(v_def, '''bank_order_amount_changed''') = 0 THEN
    RAISE EXCEPTION '事後閘①b:新值不在 CHECK 裡(實得 %)', v_def;
  END IF;

  -- 事後閘②:🔴 舊七值一個都不能掉(本片是加一個, 不是重寫)
  IF pg_catalog.strpos(v_def, '''order_created''') = 0
     OR pg_catalog.strpos(v_def, '''order_shipped''') = 0
     OR pg_catalog.strpos(v_def, '''order_cancelled''') = 0
     OR pg_catalog.strpos(v_def, '''order_unpaid_cancelled''') = 0
     OR pg_catalog.strpos(v_def, '''shipment_tracking_corrected''') = 0
     OR pg_catalog.strpos(v_def, '''bank_order_created''') = 0
     OR pg_catalog.strpos(v_def, '''order_partially_refunded''') = 0 THEN
    RAISE EXCEPTION '事後閘②:舊值掉了(實得 %)', v_def;
  END IF;

  -- 事後閘③:🔴 **CHECK 真的還在生效**(NOT VALID 沒被 VALIDATE 的世界會通過①②)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
              WHERE c.conrelid = 'public.email_outbox'::regclass
                AND c.conname = 'email_outbox_event_type_check'
                AND NOT c.convalidated) THEN
    RAISE EXCEPTION '事後閘③:email_outbox_event_type_check 仍是 NOT VALID ⇒ 舊列沒被檢查過';
  END IF;

  -- 事後閘④:view 的欄形狀(入列那一側會靠它, 換了就是靜默破壞)
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO v_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.pcm_bank_order_amount_changed_email_pending'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols <> 'order_id,cancellation_id,display_id,created_at,total,balance_due,notification_email,customer_email,order_source' THEN
    RAISE EXCEPTION '事後閘④:view 欄位形狀不對(實得 %)', v_cols;
  END IF;

  -- 事後閘⑤:🔴🔴 **三件承重的東西真的在定義裡** —— 少一件就是靜默的錢錯 / 重寄。
  --   📌 判準照 20260907220000 事後閘③ 的先例:比【被選出來的那一欄】與述詞的字面,
  --      而不是「整份定義裡有沒有那個字」。
  SELECT pg_catalog.pg_get_viewdef('public.pcm_bank_order_amount_changed_email_pending'::regclass, true) INTO v_def;
  -- ⑤a 金額來自那支繼承的 view(不是自己算, 也不是回頭讀 orders.total)
  IF pg_catalog.strpos(v_def, 'pcm_bank_order_still_mailable') = 0 THEN
    RAISE EXCEPTION '事後閘⑤a:view 不再從 pcm_bank_order_still_mailable 衍生 ⇒ 金額可能不是 effective';
  END IF;
  IF pg_catalog.strpos(v_def, 'o.total') <> 0 OR pg_catalog.strpos(v_def, 'orders o') <> 0 THEN
    RAISE EXCEPTION '事後閘⑤b:view 直接讀了 orders ⇒ 那條路的金額沒扣掉取消件';
  END IF;
  -- ⑤c 時間地板還在 —— 而這一格要釘【兩件事】, 少一件都會放過一個壞世界:
  --   ⑤c-1 述詞真的呼了那支函式(被拿掉 ⇒ 接線那一刻對全部歷史單寄一疊)
  --   ⑤c-2 那支函式回的值真的是我以為的那一天
  --   📌 **只釘名字 ⇒ 一支回 `-infinity` 的同名函式會印同一個綠**, 而那等於沒有地板。
  --   🔵 值用【比較】不用字串比對 —— 理由就是上面 ⑤c 第一版踩的那個坑:
  --      字面會被 deparse 用伺服器 TimeZone 重印, 而 timestamptz 的【值】不會變。
  IF pg_catalog.strpos(v_def, 'pcm_bank_amount_changed_email_floor') = 0 THEN
    RAISE EXCEPTION '事後閘⑤c-1:述詞沒有呼時間地板函式 ⇒ 上線那一刻會對歷史訂單寄一疊';
  END IF;
  IF public.pcm_bank_amount_changed_email_floor() <> '2026-09-13 00:00:00+08'::timestamptz THEN
    RAISE EXCEPTION '事後閘⑤c-2:時間地板的值不是 2026-09-13 00:00+08(實得 %)',
      public.pcm_bank_amount_changed_email_floor();
  END IF;
  -- ⑤e 🔴🔴 **view 定義裡不得出現 `last_error_code` 的任何字面。**
  --   這一格取代了前兩版那種「清單裡該有哪幾碼」的閘 —— 📌 **因為正確答案是「一格都不該有」**
  --   (理由全文在上面 view body 那段〈歷史〉;主視窗 2026-09-13 裁甲)。
  --   🔵 **一格取代兩格, 而判別力更寬**:它不只擋「把那兩碼加回來」,
  --      也擋「加回三碼」、「加任何新碼」、「刪掉 COALESCE」、「NOT IN 誤改 IN」——
  --      那四種在前一版的兩格閘裡有三種是**全綠**的(Fable 5.1 F3)。
  --   🛑 **而它也是那條規則的執行者**:要讓某個 skip 碼的列能重排 ⇒ 去 writer 加退休鍵,
  --      不是回來這裡開洞。這一格讓「回來開洞」這條路**過不了 apply**。
  IF pg_catalog.strpos(v_def, 'last_error_code') <> 0 THEN
    RAISE EXCEPTION '事後閘⑤e:view 定義裡出現了 last_error_code ⇒ 有人在 anti-join 開了一個碼的洞;要讓某個 skip 碼的列能重排, 去那支 writer 加退休鍵, 不要在這裡加條件';
  END IF;

  -- ⑤d anti-join 真的比了那支**具名的**鍵函式。
  --   ⛔ ~~第一版只 strpos `dedup_key` 這個字~~ 🔴 **Fable F3 擊破**:那讓「改分隔符 / 倒序」
  --      的世界照樣全綠, 而症狀是 anti-join 對不上 ⇒ 同一次取消每輪重排。
  --   ✅ 改成釘函式名 —— 而**鍵的字面本身**由上面那道 apply 期釘樁顧(兩道各管一件事:
  --      這一道管「view 有沒有用那支函式」, 那一道管「那支函式吐出來的字對不對」)。
  IF pg_catalog.strpos(v_def, 'pcm_bank_amount_changed_email_dedup_key') = 0 THEN
    RAISE EXCEPTION '事後閘⑤d:anti-join 沒有呼 dedup_key 函式 ⇒ 同一張單的第二次取消可能永遠不寄';
  END IF;

  -- 事後閘⑥:🔴 權限**兩個方向都驗** —— 只驗一邊的話, 一個 anon 也讀得到的世界會印同一個綠。
  --   形狀逐字照 `20260907220000:120-128`(⛔ 原本寫 118-127, 差兩行 —— 118 是空行、119 是註解;Fable N4)。
  FOREACH v_rel IN ARRAY v_relations LOOP
    IF NOT pg_catalog.has_table_privilege('service_role', v_rel, 'SELECT') THEN
      RAISE EXCEPTION '事後閘⑥a:% 的 service_role 讀不到 ⇒ 入列那一側讀不到', v_rel;
    END IF;
    IF pg_catalog.has_table_privilege('anon', v_rel, 'SELECT')
       OR pg_catalog.has_table_privilege('authenticated', v_rel, 'SELECT') THEN
      RAISE EXCEPTION '事後閘⑥b:% 的 anon/authenticated 讀得到 ⇒ 收撤', v_rel;
    END IF;
  END LOOP;

  -- 事後閘⑥c:那支地板函式**誰都不該能執行** —— 唯一呼叫端是 security_invoker = false 的 view,
  --   它以 owner 身分呼叫 ⇒ 三個角色一個都不需要 EXECUTE。
  --   🛑 這裡**只驗「沒有」那一邊**, 而那是刻意的:沒有「該有 EXECUTE 的角色」可驗
  --      ⇒ 硬湊一格正向斷言只會是一句恆真的話。
  --   ⚠️ 而 owner 那一側由 `ALTER FUNCTION … OWNER TO postgres` 顧, 不在這一格。
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘⑥c:% 對 anon/authenticated/service_role 仍有 EXECUTE ⇒ 收撤', v_fn;
    END IF;
  END LOOP;

  -- 🔵 事後閘⑦:**這不是閘, 是給【貼的人】看的那個數字。**
  --   貼的當下這張 view 有幾列 ⇒ 接上入列路徑的那一刻會寄幾封。
  --   📌 今天它應該是 0(plan §3-bis-1 唯讀讀數), 而**時間地板之後的取消會讓它長大** ——
  --      所以這裡印出來, 不是斷言它是 0。
  SELECT count(*) INTO v_cnt FROM public.pcm_bank_order_amount_changed_email_pending;
  RAISE NOTICE '🔵 貼的當下 pcm_bank_order_amount_changed_email_pending 有 % 列 ⇒ 接上入列路徑那一刻會寄 % 封(本片零 TS ⇒ 現在 0 封)', v_cnt, v_cnt;

  RAISE NOTICE '事後閘通過(七格:①CHECK 有新值 ②舊七值沒掉 ③CHECK 生效 ④view 欄形狀 ⑤a-e 定義四件承重(⑤e = anti-join 零 last_error_code 條件)⑥a-c 權限三向 ⑦印出待寄列數)';
END
$postcheck$;

COMMIT;
