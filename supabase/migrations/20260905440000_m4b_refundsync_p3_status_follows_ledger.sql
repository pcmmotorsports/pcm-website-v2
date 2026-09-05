-- ══════════════════════════════════════════════════════════════════
-- M-4b · 片③ ⟦b4-REFUNDSYNCP3⟧ 退款狀態【照事實走】—— 作廢之後降得回去
-- ══════════════════════════════════════════════════════════════════
-- 真權威 plan:`docs/plans/2026-09-05-refund-sync-p3-status-follows-ledger-plan.md`
-- 方向 Sean 2026-08-22 `Q-B=甲` 已拍(允許回 `paid`);
-- 三題(D1 fail-loud / D2 寫小事故表 / D3 封口擴大)由主視窗 `-f8` 2026-09-05 裁, 工程題。
-- 關卡 1 codex 兩輪:R1 8 條 + R2 9 條 must-fix, 全折。**上限 2 輪已到。**
-- ⛔ **本檔不由施工窗 apply。**
--
-- 🔴🔴 **依賴:貼板 41(`20260905420000`, 線 `-db`)要【先貼】。**
--    它把 `pcm_incident` 的 `kind` 封閉集加上 `'refund_over_total'`。
--    🛑 **沒先貼會怎樣**:本檔的超退留痕會丟 `check_violation`,
--       而那個例外**會被內層 handler 吞掉** ⇒ 📌 **超退零留痕, 而且沒有人會知道。**
--    ⇒ 下面前置閘④ 就是在擋這件事 —— 它讓「順序貼錯」變成一個**會叫的錯**。
--
-- ── 這一支修什麼(一條鏈)──────────────────────────────────
--   ① `admin_void_manual_refund` 剝掉行註解後 `public.orders` **零命中**
--      ⇒ 作廢一筆退款之後, **沒有任何人去改 `payment_status`**
--   ② 而同步器 `v_moved <= 0` 就早退 ⇒ **就算叫了也不會動**
--   ⇒ 🔴 **兩道各自獨立的擋 —— 只修一道, 行為零改變, 而三綠會全綠。**
--
-- ── 本檔的四件事 ──────────────────────────────────────────
--   ⓪-a 封口:`refunded` 且 outbox 無 `order_created` 列 ⇒ 補一列**看起來就是沒寄**的記號
--   ⓪-b 封口:`refunded` 且有 pending/failed 列 ⇒ 那些列一併壓成 `skipped_no_real_email`
--   ①   同步器:拿掉早退 · 補第三段帳本 · 開 `paid` 那一態 · 超退留痕
--   ②③  兩支呼叫端:鎖序三步 + 呼叫同步器
--
-- 🔴🔴 **順序不可倒** —— 封口必須在改同步器【之前】。
--    先改同步器 ⇒ 狀態當場降回 `paid` ⇒ **那一瞬間它就合格了**,
--    而封口若排在後面, 中間那個窗口有多寬**沒有人量得到**。
--
-- ── Rollback ──────────────────────────────────────────────
--   ① 三支函式各自的上一代原樣再貼(全是 `CREATE OR REPLACE`):
--      `20260905010000:244` · `20260820100000:292` · `20260814190000:191`
--   ② 🔴 **⓪ 那批列也要處理**:⓪-a 補出來的**刪掉**;⓪-b 壓下去的**改回原本的態**
--      ⛔ ~~原態寫在 `payload->>'p3_prev_status'`~~ 🔴 **關卡2 R2 抓到:那是我改鍵【之前】的寫法。**
--      ✅ 真正的落點 = `payload->'p3_seal'->>'prev_status'`(⓪-a 補的那些該欄是 `null`, 照它分辨)。
--      🎯 **又是「碼改了而說明沒跟上」—— 今晚第四次同族。**
--   ③ 🔴 **兩支新 COMMENT 也要還原** —— 本檔用 `obj_description` 取舊值再 append,
--      回滾時要把 append 上去的那幾行拿掉(它們以「🔴🔴 2026-09-05 片③」開頭, 好認)。
--      🛑 **不處理的話, 那些信【被永久抑制】** —— 回滾了規則, 而信仍然寄不出去。
--   ③ 🛑 **回滾【不會】把已經被降回 `paid` 的單改回 `refunded`** ——
--      那些是**照事實**改的, 而回滾的是規則不是資料。
--      ⇒ 📌 **「回滾」在這一片是不對稱的, 不要寫成「回到原狀」。**
--
-- ── 🔬 三支本體都是【程式抽出】, 零手抄 ────────────────────
--    產生器 `/tmp/claude-502/gen-p3.py` 先驗每一支的 `md5(prosrc)` 與正式庫相同才動:
--      `pcm_sync_order_refund_payment_status`  753f36b4dc0c86caf5ca72566e4767a6  (2417)
--      `admin_void_manual_refund`              574ad75c7774d9054bf216a566e1bab9  (3433)
--      `admin_correct_order_refund_verdict`    4736b4a5cb177998623432c33b1ddda7  (7804)
--    🟢 2026-09-05 唯讀量到:repo 那三份與正式庫**逐位元相同**。
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ══ 前置閘 ════════════════════════════════════════════════════════════
DO $pre$
DECLARE v_md5 text; v_n integer;
BEGIN
  -- ① 三支都在, 而且各只有一支(不是多載)
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN ('pcm_sync_order_refund_payment_status',
                                              'admin_void_manual_refund','admin_correct_order_refund_verdict');
  IF v_n <> 3 THEN
    RAISE EXCEPTION '前置閘①:那三支函式現在共 % 支(期望恰 3)⇒ 有人多載或刪掉了, 停下', v_n;
  END IF;

  -- ② forward-only:本檔的判準字面還沒進去
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='pcm_sync_order_refund_payment_status'
                AND pg_catalog.strpos(p.prosrc, 'refund_over_total') > 0) THEN
    RAISE EXCEPTION '前置閘②:本檔已經套用過 ⇒ forward-only 拒重跑';
  END IF;

  -- ③ 釘住【我要覆蓋的是哪三版】。單一特徵字串不夠(關卡1 R2), 釘整份 md5。
  --    🛑 fail-closed:對不上就停, **不要 force**;訊息會把實得的 md5 印出來。
  --    ⚠️ 代價寫明:任何一次合法的上游改動都會讓這裡紅。**那時候的紅是對的** ——
  --       它要的是一個人回來看一眼, 而不是讓三支錢路徑的函式被無聲覆蓋。
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='pcm_sync_order_refund_payment_status';
  IF v_md5 IS DISTINCT FROM '753f36b4dc0c86caf5ca72566e4767a6' THEN
    RAISE EXCEPTION '前置閘③:pcm_sync_order_refund_payment_status 不是我預期的基線。期望 753f36b4dc0c86caf5ca72566e4767a6, 實得 %。⇒ 停下不要蓋, 把這個 md5 貼回來', COALESCE(v_md5,'(讀不到)');
  END IF;
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_void_manual_refund';
  IF v_md5 IS DISTINCT FROM '574ad75c7774d9054bf216a566e1bab9' THEN
    RAISE EXCEPTION '前置閘③:admin_void_manual_refund 不是我預期的基線。期望 574ad75c7774d9054bf216a566e1bab9, 實得 %', COALESCE(v_md5,'(讀不到)');
  END IF;
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_correct_order_refund_verdict';
  IF v_md5 IS DISTINCT FROM '4736b4a5cb177998623432c33b1ddda7' THEN
    RAISE EXCEPTION '前置閘③:admin_correct_order_refund_verdict 不是我預期的基線。期望 4736b4a5cb177998623432c33b1ddda7, 實得 %', COALESCE(v_md5,'(讀不到)');
  END IF;

  -- ④b 🔴🔴 **[R3 F5 consider]** `pcm_incident_log` **叫得動嗎** —— 做成前置閘, 不靠一次量測。
  --    它零 GRANT、`pcm_incident` 零 policy + RLS ⇒ **只有 owner 進得去**;
  --    而「三支都是 owner=postgres」我只在 2026-09-05 量過**一次**。
  --    🛑 漂移之後的症狀是:**員工作廢不了退款**, 而錯誤是 `permission denied for function pcm_incident_log`
  --    ⇒ 📌 那個訊息看起來像「小事故表壞了」, 而真正壞的是**退款作廢這條路**。
  IF NOT pg_catalog.has_function_privilege(current_user, 'public.pcm_incident_log(text,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '前置閘④b:現在這個身分(%)叫不動 public.pcm_incident_log(text,uuid,text) ⇒ 超退留痕會炸在退款作廢那條路上, 停下', current_user;
  END IF;

  -- ④ 🔴🔴 依賴貼板 41:`kind` 的封閉集必須已經收得下 'refund_over_total'。
  --    🛑 **不能只問「函式在不在」** —— `pcm_incident_log` 本來就在, 而 CHECK 沒放寬時
  --       那一發 INSERT 會丟 check_violation, **被內層 handler 吞掉 ⇒ 超退零留痕**。
  --    ✅ 所以這裡問的是【CHECK 述詞收不收得下那個值】, 不是函式在不在。
  IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint c
         WHERE c.conrelid = pg_catalog.to_regclass('public.pcm_incident')
           AND c.contype = 'c'
           AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid), 'refund_over_total') > 0) THEN
    RAISE EXCEPTION '前置閘④:pcm_incident 的 kind 還收不下 refund_over_total ⇒ 請先貼【貼板 41 / 20260905420000】(線 -db)。🛑 硬貼下去的話, 超退那一發 INSERT 會被 CHECK 擋掉而例外被內層吞掉 ⇒ 零留痕, 沒有人會知道。';
  END IF;
END
$pre$;

-- ══ ⓪ 封口(必須在改同步器【之前】)══════════════════════════════════════
-- 🔴🔴 **為什麼要封口**:片③ 把 `refunded` 降回 `paid`, 而有兩條寄信的路會因此醒過來 ——
--   ① `pcm_order_created_email_pending` 的述詞是 `payment_status = 'paid' AND cancelled_at IS NULL`
--      ⇒ 一張**沒取消、outbox 沒有 order_created 列**的舊單會**新進佇列** ⇒ 客人收到「您的訂單成立」。
--   ② `SupabaseIneligibleOrderEmailScannerAdapter.ts:54` 逐字
--      `payment_status.eq.refunded,cancelled_at.not.is.null` —— 那是 **OR** ⇒ `refunded` 讓整張單的信被**抑制**
--      ⇒ 降回 `paid` 之後不再被抑制 ⇒ **既有的 pending/failed 列變成可寄** ⇒ sweeper 會寄出去。
-- 🔵 cutoff 那一層擋得住【時間上舊】的, 封口擋的是【時間上新而漏寄】的 ⇒ **兩層互補。**
--
-- 🔴 **狀態刻意用 `skipped_no_real_email`, 不是 `sent`** ——
--    `apps/admin/src/lib/orders/email-log-view.ts:71` 逐字 `case 'sent': return '已寄出'`
--    ⇒ 標 `sent` 會讓**後台對員工說「已寄出」+ 一個時間, 而那封信從來沒寄過**。
--
-- 🔴🔴 **[關卡2 R1 must-fix ×4 —— 而第一條打掉了我一個宣稱]**
--   ⛔ 我第一版的 ⓪-a **漏填 `dedup_key` / `recipient_email` / `subject` 三個 NOT NULL 欄**。
--   🛑 **而它在拋棄式 PG 上 `COMMIT rc=0`** —— 因為那台庫上**候選是 0 張**
--      ⇒ 📌 **那發 INSERT 一列都沒有跑過, 而我把那個綠讀成「封口可用」。**
--      ⇒ 🎯 **「整支跑到 COMMIT」與「那段碰到了真實資料」是兩個宣稱。**
--   ⛔ selector 少了 plan 要求的 `v_moved = 0` 與收件人條件 ⇒ **會多抓**(永遠維持 `refunded` 的、
--      或根本沒有真信箱的單)⇒ 製造假紀錄, 並壓掉不該壓的信。
--   ⛔ `payload || jsonb_build_object(...)` **會蓋掉既有的鍵** ⇒ 那不是保留原 payload。
--      ✅ 改成把我的東西**收進單一命名空間鍵 `p3_seal`** ⇒ 只可能蓋掉那一個鍵, 而它我另外斷言不存在。
--   ⛔ `v_b < 0` 對 `ROW_COUNT` **永遠不成立** ⇒ 那半斷言恆綠, 驗不到 ⓪-b 有沒有多抓漏抓。
DO $seal$
DECLARE v_a integer; v_b integer; v_cand integer; v_dirty integer;
        v_expect_a integer; v_expect_b integer;
BEGIN
  -- 🔴 候選 = plan 說的那個【收窄後】的集合, 不是「全部 refunded」:
  --    ①會被降回 paid(實際退款額 = 0, 三段帳本合計)②沒取消 ③至少一個信箱非空。
  CREATE TEMP TABLE p3_seal_target ON COMMIT DROP AS
  SELECT o.id AS order_id,
         COALESCE(NULLIF(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), ''),
                  NULLIF(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '')) AS recipient
    FROM public.orders o
    LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
   WHERE o.payment_status = 'refunded'::public.payment_status
     AND o.cancelled_at IS NULL
     AND COALESCE(NULLIF(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), ''),
                  NULLIF(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '')) IS NOT NULL
     -- 🔴🔴 **[R3 F3 must-fix]** ⛔ ~~三段帳本合計 = 0(會降回 `paid` 的那些)~~ —— **那個集合太小。**
     --   抑制述詞是 `payment_status.eq.refunded`(`IneligibleOrderEmailScannerAdapter.ts:54`)
     --   ⇒ 🛑 **帳本 `0 < 合計 < total` 的舊 `refunded` 單會降成 `partiallyRefunded`,
     --      而那【一樣脫離抑制】** —— 它只是沒有變成 `paid` 而已。
     --   ⇒ 📌 **我挑的是「會變成 paid 的」, 而該挑的是「會不再是 refunded 的」。**
     --   ✅ 判準改成:**用同一支目標算式算一次, 目標 <> 'refunded' 的每一張**。
     --      🔵 刻意**不另寫一份口徑** —— 另寫一份就會與同步器分岔, 而分岔時沒有東西會叫。
     AND 'refunded' <> (
           SELECT CASE WHEN x.moved > 0 AND x.moved >= o.total THEN 'refunded'
                       WHEN x.moved > 0                        THEN 'partiallyRefunded'
                       ELSE                                         'paid' END
             FROM (SELECT COALESCE((SELECT pg_catalog.sum(r.refund_amount) FROM public.order_refunds r
                                     WHERE r.order_id = o.id AND r.status = 'confirmed'), 0)
                        + COALESCE((SELECT pg_catalog.sum(m.refund_amount) FROM public.order_manual_refunds m
                                     WHERE m.order_id = o.id AND m.voided_at IS NULL), 0)
                        + COALESCE((SELECT pg_catalog.sum(r2.refund_amount) FROM public.order_refunds r2
                                      JOIN public.order_refund_effective_verdict v ON v.refund_id = r2.id
                                     WHERE r2.order_id = o.id AND r2.status = 'failed'
                                       AND r2.failed_reason = 'manual_failed'
                                       AND v.corrected_to = 'money_moved'), 0) AS moved) x);
  SELECT count(*) INTO v_cand FROM p3_seal_target;
  RAISE NOTICE '片③ 封口候選(會被降回 paid + 沒取消 + 有信箱)= % 張', v_cand;

  -- 🔴🔴 **關卡2 R2:`v_a > v_cand` 仍然恆綠** —— ⓪-a 本來就是候選的子集, 不可能超過。
  --    📌 **我把一個恆假的比較換成了另一個恆假的比較。**
  --    ✅ 改成:**INSERT 之前先算出【預期補幾列】**, 事後**比相等**。
  SELECT count(*) INTO v_expect_a FROM p3_seal_target t
   WHERE NOT EXISTS (SELECT 1 FROM public.email_outbox e
                      WHERE e.order_id = t.order_id AND e.event_type = 'order_created');
  SELECT count(*) INTO v_expect_b FROM p3_seal_target t
    JOIN public.email_outbox e ON e.order_id = t.order_id
   WHERE e.event_type = 'order_created' AND e.status IN ('pending', 'failed');

  -- 🔴 **關卡2 R2 ③:空白字集要用【同一把尺】** —— 那幾支 view 用 `pcm_js_trim_whitespace()`,
  --    而我原本用單參數 `btrim`(只吃空格)⇒ 只有 tab 的信箱**我判有效而 view 判無效** ⇒ 兩邊不互補。
  --    🔬 唯讀量到正式庫 ACL = `postgres=X/postgres , service_role=X/postgres`, 而 SQL Editor 以 postgres 跑 ⇒ 叫得動。
  --    🛑 而**仍然要斷言** —— 那支曾經被收過權, 而「叫不動」的失敗長得像本片寫壞了。
  IF NOT pg_catalog.has_function_privilege(current_user, 'public.pcm_js_trim_whitespace()', 'EXECUTE') THEN
    RAISE EXCEPTION '片③ 封口:現在這個身分(%)叫不動 public.pcm_js_trim_whitespace() ⇒ 收件人判準會與那幾支 view 分岔, 停下', current_user;
  END IF;

  -- 🔴 命名空間鍵不可以已經有人用 —— 有的話我的合併就會蓋掉別人的東西。
  SELECT count(*) INTO v_dirty FROM public.email_outbox e WHERE e.payload ? 'p3_seal';
  IF v_dirty <> 0 THEN
    RAISE EXCEPTION '片③ 封口:已經有 % 列的 payload 帶 p3_seal 鍵 ⇒ 本檔可能已套用過, 或有人用了同一個鍵。停下', v_dirty;
  END IF;

  -- ⓪-a 沒有 order_created 列的 ⇒ 補一列(三個 NOT NULL 欄都要填)
  INSERT INTO public.email_outbox (order_id, event_type, dedup_key, recipient_email, subject, status, payload)
  SELECT t.order_id, 'order_created',
         t.order_id::text,   -- 🔴 照既有合約(SupabaseEmailOutboxAdapter.test.ts:145 逐字 dedup_key=orderId)
         t.recipient,
         '(片③ 封口, 非真寄)',
         'skipped_no_real_email',
         pg_catalog.jsonb_build_object('p3_seal',
           pg_catalog.jsonb_build_object('sealed', true, 'prev_status', NULL::text,
             'note', '片③ 封口, 非真寄 —— 這一列是為了不讓一封舊信在狀態降回 paid 之後被補寄出去'))
    FROM p3_seal_target t
   WHERE NOT EXISTS (SELECT 1 FROM public.email_outbox e
                      WHERE e.order_id = t.order_id AND e.event_type = 'order_created');
  GET DIAGNOSTICS v_a = ROW_COUNT;

  -- ⓪-b 已經有 pending/failed 列的 ⇒ 壓下去, 而【把原本的態留在命名空間鍵裡】供回滾
  UPDATE public.email_outbox e
     SET status = 'skipped_no_real_email',
         payload = COALESCE(e.payload, '{}'::jsonb)
                   || pg_catalog.jsonb_build_object('p3_seal',
                        pg_catalog.jsonb_build_object('sealed', true, 'prev_status', e.status,
                          'note', '片③ 封口, 非真寄 —— 原本的態記在 prev_status, 回滾時照它還原'))
    FROM p3_seal_target t
   WHERE t.order_id = e.order_id
     -- 🔴🔴 **[R3 F2 must-fix;主視窗裁]** 只壓 `order_created` 那一條路。
     --   ⛔ ~~不篩 `event_type`~~ ⇒ 會把 `order_shipped` / `shipment_tracking_corrected` 的
     --      **死信**(`attempts >= max_attempts`)一併壓掉
     --      ⇒ 🛑 **客人的出貨通知永久消失, 而 dead-letter 告警同時被靜音。**
     --   ✅ 而 `order_created` 是【降回之後唯一會【新寄】的那一種】—— 其他事件型別本來就不會因為
     --      狀態降回而多寄一封, 它們只是**被抑制擋著**;抑制解除之後它們該不該寄是**另一題**。
     AND e.event_type = 'order_created'
     AND e.status IN ('pending', 'failed');
  GET DIAGNOSTICS v_b = ROW_COUNT;

  -- 🔴 四個數【各印各的】—— 關卡1 R2:要求它們相等會誤紅(不是同一個集合)。
  RAISE NOTICE '片③ 封口:候選 % 張 / ⓪-a 補 % 列 / ⓪-b 壓 % 列', v_cand, v_a, v_b;
  -- 🔴 關卡2:`v_b < 0` 對 ROW_COUNT 恆假 ⇒ 那半是恆綠。改成有判別力的【包含關係】:
  --    ⓪-a 補的列數不可能超過候選張數(一張單最多補一列)。
  IF v_a <> v_expect_a THEN
    RAISE EXCEPTION '片③ 封口:⓪-a 預期補 % 列而實際補了 % 列 ⇒ selector 與 INSERT 的述詞不一致, 停下', v_expect_a, v_a;
  END IF;
  IF v_b <> v_expect_b THEN
    -- 🔵 **[R3 F4 consider]** 這裡不一定是「我的述詞寫錯」—— READ COMMITTED 下
    --   `v_expect_b` 與 UPDATE 是**兩個快照**, 而貼片當下 `email-sweep` / ineligible-gate 的 cron
    --   可能剛好把一列 `pending → sending/skipped` ⇒ 兩個數就差一。
    --   ⇒ 📌 **訊息要讓貼的人知道「重貼一次很可能就過」**, 而不是去找一個不存在的 bug。
    RAISE EXCEPTION '片③ 封口:⓪-b 預期壓 % 列而實際壓了 % 列。⇒ 最常見的成因是【貼的當下剛好有排程動到那幾列】(整支已回滾, 零副作用)⇒ 請隔一分鐘【重貼一次】;若連兩次都不一致, 那才是述詞寫錯, 貼回來給線 -account。', v_expect_b, v_b;
  END IF;
  -- 🔵 這兩格【有判別力】:把 INSERT/UPDATE 的 WHERE 改寬或改窄, 實際列數就會與預期不同 ⇒ 當場紅。
END
$seal$;

-- == (1) 同步器 ==
CREATE OR REPLACE FUNCTION public.pcm_sync_order_refund_payment_status(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
-- 🔴🔴 **[2026-09-05]`search_path` 從 `public, pg_temp` 改成 `''`**(線【資料】`-db` 的閘抓的)。
--    ⛔ ~~原版(`20260823020000:243`)是 `public, pg_temp`~~ —— 本片是 `CREATE OR REPLACE`,
--      而**那道閘只看檔面, 新檔一律要求 `''`**。
--    🔵 `''` = 不信任任何 schema ⇒ body 裡的物件必須帶全名, 攻擊者無法用同名物件劫持。
-- 🛑 **而「body 裡一律加 `pg_catalog.`」這句話是【錯的】, 我逐個實測過**:
--      🔬 `SELECT pg_catalog.sum(1)`                    ⇒ 1              ✅ 可以加
--      🔬 `SELECT pg_catalog.current_setting('transaction_isolation')` ⇒ read committed  ✅ 可以加
--      🔬 `SELECT pg_catalog.coalesce(1,2)` ⇒ **ERROR: function pg_catalog.coalesce(integer, integer) does not exist**
--      ⇒ 🔴 `COALESCE` / `NULLIF` / `GREATEST` / `LEAST` 是 **SQL 特殊語法, 不是可加 schema 的函式**。
--    🔵 樣板 `20260904200000` 自己 body 裡用的也是**裸 `coalesce`** ⇒ 這不是我的例外, 是慣例。
--    🎯 **⇒ 一句「一律加全名」照字面執行會讓整支貼不下去** —— 而它讀起來完全合理。
--      (今晚 `20260904230000` 已經被同一件事咬過一次, R2 抓到 3 處。)
SET search_path = ''
AS $fn$

DECLARE
  v_ps     text;
  v_total  integer;
  v_moved  bigint;
  v_target text;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 缺 order_id';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 需在 READ COMMITTED 下執行(現為 %;RR 下鎖後 SUM 讀不到並行提交)', pg_catalog.current_setting('transaction_isolation');
  END IF;

  SELECT o.payment_status::text, o.total INTO v_ps, v_total
    FROM public.orders o WHERE o.id = p_order_id
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 訂單 % 不存在(FK 應擋住;資料異常)。🔴 本函式由多個呼叫端共用 —— 看呼叫堆疊, 錯不一定在卡片那條路', p_order_id;
  END IF;

  -- 🔴🔴 **[2026-09-05 ⟦b4-MANREFUNDNOOWNER2⟧]本片唯一的行為改動:把人工退款也算進來。**
  --    ⛔ ~~原本只加總 `order_refunds`(卡片軌)~~ —— 而 `admin_record_manual_refund` 寫的是
  --      **另一張表** `order_manual_refunds`, 然後呼叫本函式 ⇒ 本函式算到 0 ⇒ 提早 return
  --      ⇒ 🎯 **客人的人工退款登記進去之後, `payment_status` 從來沒有被改過。**
  --    🔬 掃描實測(2026-09-04, 分母 2,320 支檔):全 repo 六支活的 payment_status 寫入端,
  --      `order_manual_refunds` **全部 0 次**;而 `admin_record_manual_refund` **只呼叫本函式**
  --      ⇒ **人工退款那條路唯一到得了的寫入端, 就是這一支。** ⇒ 沒有別人在管。
  --    🔵 述詞用 `voided_at IS NULL` 而**不是** `status = 'confirmed'` ——
  --      🔬 `order_manual_refunds` 建表(`20260820010000`)**沒有 status 欄**;
  --      作廢走 `voided_at`(`20260820090000` 後補)。
  --      ⇒ 📌 這與 `20260904230000:239` 用的述詞**逐字相同** ⇒ 兩邊對齊, 不是各寫各的。
  SELECT COALESCE(pg_catalog.sum(refund_amount), 0) INTO v_moved
    FROM public.order_refunds
   WHERE order_id = p_order_id AND status = 'confirmed';

  SELECT v_moved + COALESCE(pg_catalog.sum(refund_amount), 0) INTO v_moved
    FROM public.order_manual_refunds
   WHERE order_id = p_order_id AND voided_at IS NULL;

  -- 🔴🔴 **第三段帳本(片③ 新增;關卡1 R1 must-fix)** —— 「先判失敗、後來更正為錢有動」的卡退。
  --    座標:`20260814190000:417-423` **自己就在扣這一段** ⇒ 少了它, 那筆錢會被算成 0
  --    ⇒ 狀態錯降回 `paid`, 而**錢其實出去了**。
  --    📌 同一個問題在兩支函式各有一份答案 ⇒ **口徑分岔在這裡特別致命。**
  SELECT v_moved + COALESCE(pg_catalog.sum(r.refund_amount), 0) INTO v_moved
    FROM public.order_refunds r
    JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
   WHERE r.order_id = p_order_id
     AND r.status = 'failed'
     AND r.failed_reason = 'manual_failed'
     AND v.corrected_to = 'money_moved';

  -- ⛔ ~~IF v_moved <= 0 THEN RETURN v_ps; END IF;~~ **片③ 拿掉這道早退。**
  --    🔴 留著它 ⇒ 全部退款被作廢時 `v_moved = 0` ⇒ 早退 ⇒ **永遠走不到 `paid` 那一支**
  --      ⇒ `payment_status` 卡死在 `refunded`, 而 Sean 2026-08-22 `Q-B=甲` 拍的「作廢後照事實降回」
  --        **靜靜地不存在**(本函式自己的 COMMENT 逐字記過這件事)。
  --    🛑 **而拿掉它會讓一批本來走不到下面那道 domain 閘的單開始撞它** —— 那是刻意的, 見下。

  IF v_ps NOT IN ('paid', 'partiallyRefunded', 'refunded') THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 訂單 % 的 payment_status=% 不允許進入退款轉移(domain 轉移表);拒繼續。🔴 本函式由多個呼叫端共用(卡片結案 / 非卡登記 / …)—— **錯不一定在卡片那條路**, 看呼叫堆疊', p_order_id, v_ps;
  END IF;

  -- 🔴 **`v_moved > 0` 那一半非有不可**(關卡1 R1 must-fix):`v_moved >= v_total` 在
  --    `0 >= 0` 時**成立** ⇒ 一張 `total = 0` 的單、零退款, 會被算成「已全額退款」。
  v_target := CASE WHEN v_moved > 0 AND v_moved >= v_total THEN 'refunded'
                   WHEN v_moved > 0                        THEN 'partiallyRefunded'
                   ELSE                                         'paid' END;

  -- 🔴🔴 **超退留痕(片③;`-f8` 2026-09-05 裁【丙】)** —— 卡退金額**明訂無上界**
  --    (`20260801120000:200-201`)⇒ 總額 1,000 而帳本 1,200 時上面算出 `refunded`
  --    ⇒ 📌 **看起來完全正常, 而 200 元的異常沒有任何人會知道。**
  --    ⛔ ~~用 `RAISE WARNING` + 標紅~~ —— `20260902020000:1-15,211-229` **逐字**說
  --      `WARNING` **員工看不到**、**不得與 UI／等價告警分開上線** ⇒ 那個先例**否定**那個做法。
  --    ✅ 改寫進小事故表, 那就是它要的「等價告警」⇒ 零 UI 工作、不算分開上線。
  --    🛑 **不擋** —— 擋了會讓一筆已經發生的事無法登記, 那正是 `⟦PCM01⟧` 否決的方向。
  -- 🔴 **去重(關卡2 R1 must-fix)**:`pcm_incident_log` 是**無去重的 INSERT**, 而本函式
  --    **有多個呼叫端**、每次退款動作都會被叫 ⇒ 一個持續存在的超退會**累積成一堆事故列**
  --    ⇒ 📌 **而告警是「事故 > 0 就叫」** ⇒ 那會變成同一件事叫很多次。
  --    🔵 本函式是 SECURITY DEFINER / owner=postgres, 而 `pcm_incident` 也是 postgres 的
  --      ⇒ 表主人預設 bypass RLS ⇒ 這個 NOT EXISTS 讀得到(拋棄式 PG 已驗)。
  IF v_moved > v_total
     AND NOT EXISTS (SELECT 1 FROM public.pcm_incident i
                      WHERE i.kind = 'refund_over_total' AND i.subject_id = p_order_id) THEN
    PERFORM public.pcm_incident_log(
      'refund_over_total', p_order_id,
      pg_catalog.format('退款總額 %s 超過訂單總額 %s(差 %s)—— 由 pcm_sync_order_refund_payment_status 記下, 未擋',
                        v_moved, v_total, v_moved - v_total));
  END IF;

  -- 🔴 **`v_ps <> 'refunded'` 那一半拿掉了** —— 它就是「只升不降」。
  IF v_ps <> v_target THEN
    UPDATE public.orders SET payment_status = v_target::public.payment_status
     WHERE id = p_order_id;
    v_ps := v_target;
  END IF;

  RETURN v_ps;
END;
$fn$;

-- == (2) 作廢端 ==
CREATE OR REPLACE FUNCTION public.admin_void_manual_refund(
  p_refund_id   uuid,
  p_void_reason text,
  p_actor       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''   -- 🔴 片③ 對齊正式庫(M1a/M1b 已收緊;repo 那支舊檔還寫著 public, pg_temp)
AS $fn$

DECLARE
  v_ws     CONSTANT text := E' \t\r\n';
  v_reason text;
  v_actor  text;
  v_row    public.order_manual_refunds%ROWTYPE;
  v_hit    integer;
  v_oid    uuid;    -- 片③:鎖序用的路由鍵(無鎖預讀)
BEGIN
  -- 步 1. 參數形狀。btrim 顯式給字集(理由同建表 20260820010000:170:預設字集只有一般空格)。
  IF p_refund_id IS NULL THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 缺 refund_id ⇒ 不知道要作廢哪一筆';
  END IF;
  v_reason := pg_catalog.btrim(coalesce(p_void_reason, ''), v_ws);
  v_actor  := pg_catalog.btrim(coalesce(p_actor,  ''), v_ws);
  -- 🔴 用 pcm_b2_is_blank 不用 `<> ''`:它多擋 NBSP 與全形空格(20260805170000:56-68)。
  --    而配對 CHECK 也用它 ⇒ 這裡先擋,是為了給人話,不是為了防漏(DB 那道才是防漏)。
  IF public.pcm_b2_is_blank(v_reason) THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 作廢理由不能是空白。'
                    '🔴 這一欄是「為什麼當初記錯了」的唯一紀錄 —— 沒有它,作廢與誤刪事後看起來一模一樣';
  END IF;
  IF public.pcm_b2_is_blank(v_actor) THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 缺經手人 ⇒ 現金退款的失敗模式是【人】,這一欄不是裝飾';
  END IF;
  -- 🔴🔴 **比照 D1 驗 active staff**(codex R1 must-fix:舊版只擋空白 ⇒ actor 可由呼叫端隨便填)。
  --    形狀逐字同 D1(`20260820021000:199`)。
  -- ⇒ **而這一道是本 RPC「不需要 request_id」那個裁定的【前提】**:
  --    主視窗 2026-08-20 裁定拿掉 request_id,理由是「不同的人 = 不同的 payload ⇒ 會 RAISE」——
  --    🔴 **而那個推論只有在 actor 不能被冒填時才成立。** 沒有這一道,那句話只是呼叫端的自律。
  --    ⇒ **拿掉這一道 = 推翻那個裁定的前提,不是省一道檢查。**
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = v_actor AND s.is_active) THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 經手人「%」不是啟用中的 staff ⇒ 拒絕。'
                    '🔴 這一道同時是「本 RPC 不需要冪等鍵」那個設計的前提', v_actor;
  END IF;

  -- 步 2. 鎖住那一列再讀。**那一列自己就是鎖** —— 這也是本 RPC 不需要冪等鍵的原因。
  -- 🔴🔴 **片③ 鎖序三步** —— 本函式原本**先鎖子表**, 而 `admin_record_manual_refund`
  --    先鎖 `orders` ⇒ 兩者相反 ⇒ 接上同步器(它會鎖 `orders`)之後就成環 ⇒ 40P01。
  --    ⛔ ~~「先鎖 orders」~~ **那句話不可施工** —— `order_id` 在子列裡, 要先讀子列才知道鎖哪張單。
  --    ✅ 可施工的形狀 = 無鎖預讀路由鍵 → 鎖 orders → 鎖後重讀子列 → 兩次不一致就叫。
  SELECT m.order_id INTO v_oid FROM public.order_manual_refunds m WHERE m.id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 找不到退款 %', p_refund_id;
  END IF;
  PERFORM 1 FROM public.orders o WHERE o.id = v_oid FOR NO KEY UPDATE;

  SELECT * INTO v_row FROM public.order_manual_refunds WHERE id = p_refund_id FOR UPDATE;
  -- 🔴 兩次讀值不一致 ⇒ 有人把這筆退款搬到別張單上 ——
  --    **那不是併發, 那是資料異常** ⇒ RAISE, 不要自己修正、也不要重試
  --    (重試只會讓它安靜地成功)。
  -- 🔵 關卡2 nit:加 `FOUND` —— 子列在兩次讀取之間【消失】時, `v_row` 全是 NULL,
  --    而那會被誤報成「order_id 漂移」。真正的「查無」由下面既有那道 IF NOT FOUND 負責。
  IF FOUND AND v_row.order_id IS DISTINCT FROM v_oid THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 退款 % 的 order_id 在鎖前後不一致(% ⇒ %)⇒ 資料異常, 停下', p_refund_id, v_oid, v_row.order_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_void_manual_refund: 找不到退款登記 % ⇒ 它不存在,或已被實體刪除', p_refund_id;
  END IF;

  -- 步 3. 已經作廢過了?
  IF v_row.voided_at IS NOT NULL THEN
    IF v_row.void_reason IS NOT DISTINCT FROM v_reason
       AND v_row.voided_by IS NOT DISTINCT FROM v_actor THEN
      -- 同一人、同一理由 ⇒ 就是同一個操作。
      -- 🔴🔴 **片③(關卡2 R1 must-fix):冪等重放這條路【也要同步】。**
      --    這一版之前作廢過的單, 當時沒有人去改 payment_status ⇒ 它卡在 refunded。
      --    ⇒ 📌 **重放時若直接 RETURN, 那些單【永遠】不會被帶回正軌** —— 而重放正是唯一還會碰到它們的動作。
      PERFORM public.pcm_sync_order_refund_payment_status(v_row.order_id);
      RETURN pg_catalog.jsonb_build_object(
        'voided', true, 'idempotent', true, 'refund_id', v_row.id);
    END IF;
    -- 🔴 訊息要寫出**現況**,不是只寫「衝突」——
    --    看到這句話的是員工,他要的是「已經有人做過了、是誰、什麼時候、理由是什麼」,不是錯誤碼。
    RAISE EXCEPTION 'admin_void_manual_refund: 這筆退款已於 % 由「%」以理由「%」作廢。'
                    '你這次送的是經手人「%」、理由「%」⇒ 兩者不同,本 RPC 不覆蓋既有的作廢紀錄。'
                    '⇒ 若你認為既有那筆記錯了,那是另一件事(要改作廢紀錄本身),本 RPC 做不到',
                    v_row.voided_at, v_row.voided_by, v_row.void_reason, v_actor, v_reason;
  END IF;

  -- 步 4. 寫入。`AND voided_at IS NULL` 是防 TOCTOU 的那一半 ——
  --   🔴 **對照組實測**:拿掉它,兩個併發 session 的第二發會 `UPDATE 1` 蓋掉第一發(W1-085 附錄世界③)。
  UPDATE public.order_manual_refunds
     SET voided_at   = now(),
         void_reason = v_reason,
         voided_by   = v_actor
   WHERE id = p_refund_id
     AND voided_at IS NULL;
  GET DIAGNOSTICS v_hit = ROW_COUNT;

  IF v_hit <> 1 THEN
    -- ⚠️ **誠實邊界:這一格我構造不出來。**
    --   步 2 的 `FOR UPDATE` 在 READ COMMITTED 之下會在鎖釋放後**重讀**那一列
    --   ⇒ 併發的第二發會在步 3 就看到 `voided_at` 非 NULL,走不到這裡。
    --   ⇒ 依本 repo 紀律,我**不宣稱它是縱深** —— 它是 fail-closed 的兜底,而**沒有測試證得了它**。
    --   ⇒ 什麼會讓它變成活的:有人把步 2 的 `FOR UPDATE` 拿掉、或把隔離等級調成 REPEATABLE READ
    --      (RR 之下第二發拿到的是序列化失敗,整筆交易中止 —— 也走不到這裡)。
    RAISE EXCEPTION 'admin_void_manual_refund: 寫入影響 % 列(預期 1)⇒ 在讀到它與寫入它之間有人動了那一列;'
                    'fail-closed 拒絕。請重新讀取那筆退款的現況再決定', v_hit;
  END IF;

  -- 🔴🔴 **片③:作廢完要把狀態同步回去。**
  --    在此之前本函式**剝掉行註解後 `public.orders` 零命中** ⇒ 作廢一筆退款之後
  --    **沒有任何人去改 `payment_status`** ⇒ 它卡在 `refunded`。
  --    🔵 位置刻意在**本函式自己的 DML 完成之後**、以獨立語句呼叫(同步器 COMMENT `:357-358` 的規格)。
  --    🔵 鎖序已由上面三步拉成 `orders → 子表` ⇒ 同步器再取 `orders` 是同交易重複鎖 = no-op。
  PERFORM public.pcm_sync_order_refund_payment_status(v_oid);

  RETURN pg_catalog.jsonb_build_object(
    'voided', true, 'idempotent', false, 'refund_id', p_refund_id);
END
$fn$;

-- == (3) 更正端 ==
CREATE OR REPLACE FUNCTION public.admin_correct_order_refund_verdict(
  p_refund_id              uuid,
  p_expected_correction_id uuid,
  p_actor                  text,
  p_reason                 text,
  p_corrected_to           text,
  p_request_id             text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $rmc$

DECLARE
  v_actor   text;
  v_reason  text;
  v_req     text;
  v_locked  uuid;
  v_status  text;
  v_freason text;
  v_order   uuid;
  v_cur_id  uuid;
  v_seq     integer;
  v_new_id  uuid;
  v_dup     uuid;
  v_dup_refund uuid;
  v_pre_order  uuid;   -- 片③:鎖序用的路由鍵(無鎖預讀;刻意與 v_order 分開, 否則一致性檢查恆真)
  v_n       integer;
BEGIN
  -- ── G1 隔離閘(排最前)──────────────────────────────────────────────────
  -- 本支的「最新一筆說了算 + CAS」靠的是「父列鎖 + 鎖後重讀看得到兄弟已提交的列」。
  -- REPEATABLE READ 下取得鎖之後快照**仍看不到**兄弟剛提交的更正 ⇒ CAS 拿舊值比對而放行
  -- ⇒ 兩筆更正互相沖掉。本 repo 對這個形狀有實測案底(A2b1 的 P2B02)。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:必須在 read committed 下呼叫(實際=%)⇒ '
                    'RR 快照看不到兄弟已提交的更正,CAS 會失效',
                    pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P8C01', CONSTRAINT = 'pcm_rmc_isolation';
  END IF;

  -- ── G2 actor:排在**任何資料讀取之前**(身分錯的呼叫拿不到任何帳本資訊)──────
  v_actor := pg_catalog.btrim(coalesce(p_actor, ''));
  IF v_actor !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:經手人代號格式不符(需 ^[a-z0-9_]{1,64}$)'
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_rmc_actor_invalid';
  END IF;

  -- ── G3 輸入驗 ────────────────────────────────────────────────────────────
  IF p_refund_id IS NULL THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:退款識別碼必填'
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_rmc_identity_missing';
  END IF;
  -- 🔴 值域在這裡具名拒一次(CHECK 也會擋,但那是縱深;這裡才講得清楚是哪個參數錯)。
  IF p_corrected_to IS NULL OR p_corrected_to NOT IN ('money_moved', 'no_money_moved') THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:新判定必須是 money_moved 或 no_money_moved(收到 [%])',
                    coalesce(p_corrected_to, '(NULL)')
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_rmc_verdict_invalid';
  END IF;
  -- 🔴 字集必須明列(codex 關卡2):`btrim(x)` 只剝一般空格 ⇒ 只送換行/Tab 會被當成有效理由。
  v_reason := pg_catalog.btrim(coalesce(p_reason, ''), E' \t\r\n');
  IF v_reason = '' THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:修改理由必填'
                    '(錢帳上「為什麼把判定改掉」是稽核第一個問題)'
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_rmc_reason_required';
  END IF;
  v_req := pg_catalog.btrim(coalesce(p_request_id, ''), E' \t\r\n');
  IF v_req = '' THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:request_id 必填(手滑連按兩次的冪等鍵)'
      USING ERRCODE = 'P2B42', CONSTRAINT = 'pcm_rmc_request_id_required';
  END IF;

  -- ── G4 鎖父列(序列化點)──────────────────────────────────────────────────
  -- 🔴 **必須 FOR NO KEY UPDATE**:本表對 order_refunds 有 FK ⇒ 下面的 INSERT 會取父列
  --    KEY SHARE;FOR UPDATE 與 KEY SHARE 是 A2b1 已實測過的 40P01 死結形狀
  --    (memory `project_m4b-a2b1-guard-decisions`)。
  -- 🔴🔴 **片③ 鎖序三步**(理由同 admin_void_manual_refund;本函式原本也先鎖子表)。
  --    ⚠️ 預讀刻意用**另一個變數** `v_pre_order` —— 兩邊都用 `v_order` 的話,
  --      下面那道一致性檢查會**恆真**(第二次讀把第一次的值蓋掉了)。
  SELECT r.order_id INTO v_pre_order FROM public.order_refunds r WHERE r.id = p_refund_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:找不到退款(%)', p_refund_id;
  END IF;
  PERFORM 1 FROM public.orders o WHERE o.id = v_pre_order FOR NO KEY UPDATE;

  SELECT r.id, r.status, r.failed_reason, r.order_id
    INTO v_locked, v_status, v_freason, v_order
    FROM public.order_refunds r
   WHERE r.id = p_refund_id
     FOR NO KEY UPDATE;
  IF FOUND AND v_order IS DISTINCT FROM v_pre_order THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:退款 % 的 order_id 在鎖前後不一致(% ⇒ %)⇒ 資料異常, 停下', p_refund_id, v_pre_order, v_order;
  END IF;

  IF v_locked IS NULL THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:找不到退款(%)⇒ 取不到序列化點,拒絕寫入',
                    p_refund_id
      USING ERRCODE = 'P8C03', CONSTRAINT = 'pcm_rmc_parent_row_required';
  END IF;

  -- ── G5 鎖後重讀:只有「卡住的人工判定列」可以被更正 ─────────────────────────
  -- 值域權威 = `20260803150000:760`(RW4 出口 `SET status='failed', failed_reason='manual_failed'`)。
  IF v_status <> 'failed' OR v_freason IS DISTINCT FROM 'manual_failed' THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:退款 % 現況 status=% / failed_reason=% ⇒ '
                    '本支只更正人工判定(failed + manual_failed);其他狀態要改請走對帳流程',
                    p_refund_id, v_status, coalesce(v_freason, '(NULL)')
      USING ERRCODE = 'P2B44', CONSTRAINT = 'pcm_rmc_target_not_manual_failed';
  END IF;

  -- ── G6a 冪等:同一 request_id 已寫過 ⇒ 回 DUPLICATE,不當成錯誤 ──────────────
  -- 已持父列鎖 ⇒ 這個讀取看得到兄弟已提交的列(G1 保證 read committed)。
  -- UNIQUE(request_id) 是後盾;這裡先答是為了讓「手滑連按兩次」拿到人話而不是 23505。
  -- 🔴 **必須連 refund_id 一起核**(codex 關卡2 must-fix,我認同):`request_id` 是**全域唯一**,
  --    只比對 token 的話,同一個 token 被誤用在**另一筆退款**上時,本支會回一個
  --    「DUPLICATE_REQUEST + 別筆退款的 correction_id」—— 呼叫端會把它讀成「這筆已經更正成功了」,
  --    而事實是這筆**一個字都沒寫**。那是靜默的假成功,比報錯嚴重。
  SELECT c.id, c.refund_id INTO v_dup, v_dup_refund
    FROM public.order_refund_manual_corrections c
   WHERE c.request_id = v_req;

  IF v_dup IS NOT NULL AND v_dup_refund = p_refund_id THEN
    -- 真的是同一筆的重播 ⇒ 冪等回應
    -- 🔴 **片③(關卡2 R1):重放這條路【也要同步】** —— 舊版做完而沒同步的更正,
    --    重放時若直接 RETURN, 那張單的 payment_status 永遠停在 stale。
    PERFORM public.pcm_sync_order_refund_payment_status(v_order);
    RETURN pg_catalog.jsonb_build_object(
      'result', 'DUPLICATE_REQUEST', 'refund_id', p_refund_id, 'correction_id', v_dup);
  END IF;
  IF v_dup IS NOT NULL THEN
    -- token 撞到別筆退款 ⇒ **拒絕**,不假裝成功(fail-closed)
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:request_id [%] 已被退款 % 用過,'
                    '不能再用於退款 % ⇒ 拒絕(冪等鍵全域唯一;請換一把新的)',
                    v_req, v_dup_refund, p_refund_id
      USING ERRCODE = 'P2B44', CONSTRAINT = 'pcm_rmc_request_id_reused';
  END IF;
  -- ⚠️ **誠實邊界**:本檢查在父列鎖之下,但 `request_id` 的唯一性是**全域**的、不受該鎖序列化。
  --    兩個交易對**不同** refund 同時用同一把 token 時,兩邊都查無重複 ⇒ 後到者撞 UNIQUE 得 23505。
  --    方向是 fail-closed(不會寫壞、不會假成功),呼叫端把 23505 +
  --    `order_refund_manual_corrections_request_id_key` 當成「換一把 token 重試」處理。

  -- ── G6b CAS:現行有效更正 ≠ 呼叫端看到的那筆 ⇒ 拒(併發正確性的本體)────────
  -- 🔴 `p_expected_correction_id` **可為 NULL**,語意 = 「我看到的是尚未被更正過」。
  --    ⇒ 必須用 IS DISTINCT FROM;用 <> 的話 NULL 比較回 NULL、整個 IF 不成立 = 這道閘失效。
  SELECT v.correction_id INTO v_cur_id
    FROM public.order_refund_effective_verdict v
   WHERE v.refund_id = p_refund_id;

  IF v_cur_id IS DISTINCT FROM p_expected_correction_id THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:你看到的更正(%)已經不是現行更正(%)⇒ '
                    '期間有人改過,請重新讀取後再送出',
                    coalesce(p_expected_correction_id::text, '(尚未更正)'),
                    coalesce(v_cur_id::text, '(尚未更正)')
      USING ERRCODE = 'P2B44', CONSTRAINT = 'pcm_rmc_cas_mismatch';
  END IF;

  -- ── G7 寫入一列 + row_count 守 ────────────────────────────────────────────
  -- 姊妹線寫兩列(沖銷 + 新判定)是因為它的舊列會擋唯一索引;本片舊列本來就不動,
  -- **一列就夠**,不為了對稱而多寫一列。
  SELECT coalesce(pg_catalog.max(c.seq), 0) INTO v_seq
    FROM public.order_refund_manual_corrections c
   WHERE c.refund_id = p_refund_id;

  INSERT INTO public.order_refund_manual_corrections
         (refund_id, seq, corrected_to, reason, actor, request_id)
  VALUES (p_refund_id, v_seq + 1, p_corrected_to, v_reason, v_actor, v_req)
  RETURNING id INTO v_new_id;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:更正列落 % 列(期望恰 1)⇒ '
                    '可能有 BEFORE INSERT trigger 把它吃掉了', v_n
      USING ERRCODE = 'P2B43', CONSTRAINT = 'pcm_rmc_row_count';
  END IF;

  -- ── G8 同交易稽核(after 取自實際寫入值,不是參數)──────────────────────────
  INSERT INTO public.admin_audit_log
         (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (v_actor, 'order_refund.correct_verdict', 'order:' || v_order::text,
          pg_catalog.jsonb_build_object('effective_correction_id', v_cur_id),
          pg_catalog.jsonb_build_object('refund_id', p_refund_id,
                                        'correction_id', v_new_id,
                                        'seq', v_seq + 1,
                                        'corrected_to', p_corrected_to),
          v_reason, v_req, 'admin');

  -- 🔴 稽核也要 row_count 守(codex 關卡2 must-fix;G7 有、G8 漏了就是不對稱):
  --    `admin_audit_log` 上若有 BEFORE INSERT trigger 把列吃掉,更正照樣提交而**稽核憑空消失** ——
  --    金流帳上「誰改的」不見了,而畫面完全正常。
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_correct_order_refund_verdict:稽核列落 % 列(期望恰 1)⇒ '
                    '更正不得在沒有稽核的情況下成立,整筆回滾', v_n
      USING ERRCODE = 'P2B43', CONSTRAINT = 'pcm_rmc_row_count_audit';
  END IF;

  -- 🔴🔴 **片③:更正判定會改變「錢有沒有動」⇒ 狀態要跟著重算。**
  --    `corrected_to='money_moved'` 讓一筆 failed 的卡退變成「錢出去了」,
  --    而反向的更正讓它變回「沒出去」⇒ **兩個方向都要同步**, 不是只有一邊。
  PERFORM public.pcm_sync_order_refund_payment_status(v_order);

  RETURN pg_catalog.jsonb_build_object(
    'result',        'CORRECTED',
    'refund_id',     p_refund_id,
    'correction_id', v_new_id,
    'seq',           v_seq + 1,
    'corrected_to',  p_corrected_to);
END
$rmc$;

-- ══ 兩支 catalog COMMENT 也要改(關卡2 R1 must-fix)══════════════════════
-- 🔴 `CREATE OR REPLACE` 保留 oid ⇒ COMMENT 原封不動 ——
--    不改它, `\df+` 上永遠寫著舊語意, 而**那是 repo 之外的人唯一讀得到的說明**。
DO $cmt$
DECLARE v_old text;
BEGIN
  v_old := pg_catalog.obj_description('public.pcm_sync_order_refund_payment_status(uuid)'::regprocedure, 'pg_proc');
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'COMMENT 附加:同步器讀不到既有 COMMENT ⇒ 停下';
  END IF;
  EXECUTE pg_catalog.format(
    'COMMENT ON FUNCTION public.pcm_sync_order_refund_payment_status(uuid) IS %L',
    v_old || E'

'
    || '🔴🔴 2026-09-05 片③(migration 20260905440000)改了三件事, 上面任何一句與它衝突的字面【已不成立】:'
    || E'
' || '① 拿掉了 v_moved <= 0 的早退 ⇒ 全部退款被作廢時走得到 paid 那一支。'
    || E'
' || '② 拿掉了「只升不降」那半 ⇒ ⛔ ~~兩態、單調不降級~~ ⇒ 三態(paid / partiallyRefunded / refunded), 允許降回。依據 Sean 2026-08-22 Q-B=甲。'
    || E'
' || '③ 加總多了第三段帳本:order_refunds 中 status=failed 且 failed_reason=manual_failed 而 effective_verdict.corrected_to=money_moved 的那些。'
    || E'
' || '🔴 超退(v_moved > v_total)不擋, 寫進 pcm_incident(kind=refund_over_total, 同一張單只記一次)。');

  v_old := pg_catalog.obj_description('public.admin_correct_order_refund_verdict(uuid,uuid,text,text,text,text)'::regprocedure, 'pg_proc');
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'COMMENT 附加:更正端讀不到既有 COMMENT ⇒ 停下';
  END IF;
  EXECUTE pg_catalog.format(
    'COMMENT ON FUNCTION public.admin_correct_order_refund_verdict(uuid,uuid,text,text,text,text) IS %L',
    v_old || E'

'
    || '🔴🔴 2026-09-05 片③:⛔ ~~本函式對 orders.payment_status 不受影響~~ 【已不成立】——'
    || E'
' || '本函式現在會呼叫 pcm_sync_order_refund_payment_status, 而更正判定會改變「錢有沒有動」⇒ 狀態跟著重算。'
    || E'
' || '🔵 並且鎖序改成三步(無鎖預讀 order_id → 鎖 orders FOR NO KEY UPDATE → 鎖後重讀子列 → 不一致就 RAISE), 理由是 40P01。');

  -- 🔴 **[R3 F9 nit + 主視窗裁甲]** 作廢端的 COMMENT 也要 append。
  --    🔬 我量過它(1509 字元):`payment_status` 零命中、「鎖」零命中
  --    ⇒ 📌 **它沒有任何一句被本片弄成假的**(這一點與更正端不同)——
  --      **而它現在【不完整】**:那支從今天起會同步狀態、而且重排了鎖序,
  --      而這段是 repo 之外的人**唯一讀得到的說明**。
  --    🎯 下一個改它的人會讀這段決定「動這支要注意什麼」, 而**鎖序正是不知道就會弄壞的那種**。
  v_old := pg_catalog.obj_description('public.admin_void_manual_refund(uuid,text,text)'::regprocedure, 'pg_proc');
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'COMMENT 附加:作廢端讀不到既有 COMMENT ⇒ 停下';
  END IF;
  EXECUTE pg_catalog.format(
    'COMMENT ON FUNCTION public.admin_void_manual_refund(uuid,text,text) IS %L',
    v_old || E'\n\n'
    || '🔴🔴 2026-09-05 片③(migration 20260905440000)本函式多了兩件事:'
    || E'\n' || '① 作廢完(以及【冪等重放】那條路)會呼叫 pcm_sync_order_refund_payment_status ⇒ payment_status 照事實降回。在此之前本函式對 orders 零命中 ⇒ 作廢一筆退款之後沒有任何人去改狀態, 它卡在 refunded。'
    || E'\n' || '② 🔴 鎖序改成三步:無鎖預讀 order_id → 鎖 orders FOR NO KEY UPDATE → 鎖後重讀子列 FOR UPDATE → 兩次不一致就 RAISE。理由是 40P01:admin_record_manual_refund 先鎖 orders 而本函式原本先鎖子表 ⇒ 接上同步器之後就成環。'
    || E'\n' || '   🛑 改本函式時【不要把那三步的順序動掉】—— 拋棄式 PG 實測:舊順序 1 次死結, 新順序 0 次。');
END
$cmt$;

-- ══ 事後斷言 ══════════════════════════════════════════════════════════
DO $post$
DECLARE v_n integer; v_src text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN ('pcm_sync_order_refund_payment_status',
                                              'admin_void_manual_refund','admin_correct_order_refund_verdict');
  IF v_n <> 3 THEN
    RAISE EXCEPTION '斷言①:改完之後共 % 支(期望 3)⇒ 多載了', v_n;
  END IF;

  -- ② 早退真的不在了(剝行註解後找可執行形狀, 不是找註解)
  SELECT pg_catalog.regexp_replace(p.prosrc, '--[^' || chr(10) || ']*', '', 'g') INTO v_src
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='pcm_sync_order_refund_payment_status';
  IF pg_catalog.strpos(v_src, 'IF v_moved <= 0 THEN') > 0 THEN
    RAISE EXCEPTION '斷言②:那道早退還在函式體裡 ⇒ 只改到註解';
  END IF;
  IF pg_catalog.strpos(v_src, 'AND v_ps <> v_target') > 0 THEN
    RAISE EXCEPTION '斷言②b:只升不降那道守門還在(v_ps <> refunded AND ...)';
  END IF;
  -- 🔵 關卡2 nit:原本綁死空白數量 ⇒ 純格式改動會誤紅。改成綁【語意上非有不可】的兩段。
  -- 🔵 關卡2 R2 nit:上一版仍以【含空白的整段】比對 ⇒ 純格式改動會誤紅。
  --    改成把空白壓成單一空格之後再比 —— 語意綁住、格式放開。
  v_src := pg_catalog.regexp_replace(v_src, '[ ' || chr(9) || ']+', ' ', 'g');
  IF pg_catalog.strpos(v_src, 'v_moved > 0 AND v_moved >= v_total') = 0 THEN
    RAISE EXCEPTION '斷言②c:三態 CASE 的第一格(v_moved > 0 AND v_moved >= v_total)不在 ⇒ total=0 的單會被算成全退';
  END IF;
  IF pg_catalog.regexp_count(v_src, 'v_moved > 0') < 2 THEN
    RAISE EXCEPTION '斷言②c2:三態 CASE 少了一格(v_moved > 0 只出現一次)';
  END IF;
  -- 🔵 關卡2 nit:只找 money_moved 的話, 把比較反轉或破壞 JOIN 仍然恆綠。三段一起綁。
  -- 🔵 關卡2 R2 nit:三個分離字串證不到【它們在同一個述詞裡】⇒ 綁整段(空白已壓平)。
  IF pg_catalog.strpos(v_src, 'v.corrected_to = ''money_moved''') = 0
     OR pg_catalog.strpos(v_src, 'order_refund_effective_verdict') = 0 THEN
    RAISE EXCEPTION '斷言②d:第三段帳本不完整(要有 order_refund_effective_verdict 的 JOIN、corrected_to 的比較、以及 money_moved 這個值)';
  END IF;
  IF pg_catalog.strpos(v_src, 'refund_over_total') = 0 THEN
    RAISE EXCEPTION '斷言②e:超退留痕不在';
  END IF;

  -- 🔴🔴 **[R3 F7 consider]** 前置閘只釘 `md5(prosrc)`, 而 **`prosrc` 不含頭** ——
  --    `proconfig` / `prosecdef` / volatility / owner / ACL 都不在裡面, 而
  --    `CREATE OR REPLACE` 是**用檔面的屬性整組覆蓋** ⇒ 📌 **body 對過 ≠ 頭對過。**
  --    🔬 而今天就有一個實例:`admin_void_manual_refund` 的 `search_path` 在正式庫是空字串,
  --       而我抽的 repo 舊檔寫 `public, pg_temp` ⇒ 差一點把一道上線的收緊退回去。
  --    ⇒ ✅ 事後把**五格屬性**驗回來(上一代同支有這五格, 本檔一格都沒留)。
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('pcm_sync_order_refund_payment_status','admin_void_manual_refund','admin_correct_order_refund_verdict')
     AND p.prosecdef
     AND p.provolatile = 'v'
     AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
     -- 🔴 **存的字面是 `search_path=""`(空字串會被引號包起來), 不是 `search_path=`** ——
     --    我第一版寫錯, 而它讓這一格印 0/3。📌 **屬性的【儲存形式】要量, 不能從我寫的 SQL 反推。**
     AND p.proconfig = ARRAY['search_path=""']::text[]
     AND p.proacl IS NOT NULL;
  IF v_n <> 3 THEN
    RAISE EXCEPTION '斷言④:三支的頭只有 % 支符合期望(期望 3:DEFINER / VOLATILE / owner=postgres / proconfig 恰好只有 search_path= / ACL 非 NULL)⇒ 有一支的屬性被這一貼改掉了, 停下', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
   WHERE n.nspname='public'
     AND p.proname IN ('pcm_sync_order_refund_payment_status','admin_void_manual_refund','admin_correct_order_refund_verdict')
     AND (a.grantee = 0 OR a.is_grantable
          OR (a.grantee <> p.proowner AND pg_catalog.pg_get_userbyid(a.grantee) <> 'service_role'));
  IF v_n <> 0 THEN
    RAISE EXCEPTION '斷言④b:三支上有 % 筆沒預期的授權(PUBLIC / 可轉授 / owner 與 service_role 以外)⇒ 停下人工看過', v_n;
  END IF;

  -- ③ 兩支呼叫端真的接上同步器了(剝註解後)
  SELECT pg_catalog.regexp_replace(p.prosrc, '--[^' || chr(10) || ']*', '', 'g') INTO v_src
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_void_manual_refund';
  -- 🔴 關卡2 R2 nit:只要求「至少一發」⇒ **刪掉冪等重放那一條的同步器仍全綠**。
  --    本函式有【兩條】路要同步:冪等重放 + 真的作廢 ⇒ 綁「恰好 2 發」。
  IF pg_catalog.regexp_count(v_src, 'PERFORM public.pcm_sync_order_refund_payment_status') <> 2 THEN
    RAISE EXCEPTION '斷言③:admin_void_manual_refund 裡同步器的呼叫數是 %(期望恰 2:冪等重放 + 真的作廢)',
      pg_catalog.regexp_count(v_src, 'PERFORM public.pcm_sync_order_refund_payment_status');
  END IF;
  IF pg_catalog.strpos(v_src, 'FOR NO KEY UPDATE') = 0 THEN
    RAISE EXCEPTION '斷言③b:admin_void_manual_refund 的鎖序三步不在 ⇒ 反向鎖序仍在';
  END IF;
  SELECT pg_catalog.regexp_replace(p.prosrc, '--[^' || chr(10) || ']*', '', 'g') INTO v_src
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_correct_order_refund_verdict';
  IF pg_catalog.regexp_count(v_src, 'PERFORM public.pcm_sync_order_refund_payment_status') <> 2 THEN
    RAISE EXCEPTION '斷言③c:admin_correct_order_refund_verdict 裡同步器的呼叫數是 %(期望恰 2)',
      pg_catalog.regexp_count(v_src, 'PERFORM public.pcm_sync_order_refund_payment_status');
  END IF;
  -- 🔴 **關卡2 R1 must-fix:只找 v_pre_order 不夠** —— 把真正那發 orders 的鎖刪掉,
  --    這格照樣過 ⇒ 它守不住本片宣稱修掉的 40P01。
  --    ✅ 改成同時要求【那發鎖】的可執行形狀在。
  IF pg_catalog.strpos(v_src, 'v_pre_order') = 0 THEN
    RAISE EXCEPTION '斷言③d:admin_correct_order_refund_verdict 的預讀路由鍵不在';
  END IF;
  IF pg_catalog.strpos(v_src, 'FROM public.orders o WHERE o.id = v_pre_order FOR NO KEY UPDATE') = 0 THEN
    RAISE EXCEPTION '斷言③e:admin_correct_order_refund_verdict 沒有【先鎖 orders】那一發 ⇒ 反向鎖序仍在, 40P01 沒修掉';
  END IF;
  IF pg_catalog.strpos(v_src, 'FROM public.orders o WHERE o.id = v_oid FOR NO KEY UPDATE') > 0 THEN
    RAISE EXCEPTION '斷言③f:更正端不該用 v_oid(那是作廢端的變數)';
  END IF;
END
$post$;

-- 🔵 簽名一個字未動 ⇒ PostgREST schema cache 不需要重載。仍然送一次, 成本為零而漏掉的代價不對稱。
NOTIFY pgrst, 'reload schema';

COMMIT;
