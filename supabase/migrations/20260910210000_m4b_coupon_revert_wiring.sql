-- ══════════════════════════════════════════════════════════════════════════════
-- ⟦b4-COUPONREVERT⟧ 券的退回 —— **接線**(前一支只建了函式, 這一支讓它真的被呼到)
-- ══════════════════════════════════════════════════════════════════════════════
--   前置:`public.coupon_revert_on_full_refund(uuid)` 已在正式庫上(貼板 125,
--         `20260901020500`)。**本支不建任何函式, 只在兩個落點各加一次呼叫。**
--
-- ── 授權鏈 ────────────────────────────────────────────────────────────────────
--   Sean 2026-09-11 逐字「依照建議」⇒ Q1-Q5 全部甲, 經主視窗 `pcm-website-v2-59` 轉述
--   (🛑 **不是我直接從 Sean 收到的**)。plan:`docs/plans/2026-09-11-coupon-revert-wiring-plan.md`
--     Q1 甲  落點掛 `pcm_pending_refund_on_cancel()` 那個路口, 不是兩支取消函式各掛一次
--     Q2 甲  匯流點本體【無條件】呼, 由退券函式自己判 —— 靠冪等, 不靠誰記得補呼
--     Q3 甲  版本號取 > `20260908060000` 的新號
--     Q4 甲  rollback = 反向 `CREATE OR REPLACE`, 而回捲檔【內含完整 body】
--     Q5 甲  那支 trigger 維持 `'O'` 不動, 而把限制寫進檔頭(見下)
--
-- ── 🔴 版本號:`20260910210000` —— 而這一格是上一支那道釘子的【鏡像】 ───────────
--   🔬 我要改的兩支, 最後一次被重新定義是在:
--        `pcm_sync_order_refund_payment_status` ⇒ `20260907140000`
--        `pcm_pending_refund_on_cancel`         ⇒ `20260905070000`
--      而 repo 目前最新是 `20260910200000`。
--   🛑 **版本號若比它們小 ⇒ `db push` 會在本支之後再跑它們的 `CREATE OR REPLACE`
--      ⇒ 把本支的接線【整段蓋掉】, 而 apply 全綠、沒有任何東西會叫。**
--
--   > ## 上一支(`20260901020500`)死在「我釘一個【未來才會出現】的東西」。
--   > ## 本支要避開的是「我改一個【未來會被覆寫】的東西」。
--   > ## 📌 **兩次都是版本號的時間軸在咬人, 而方向相反。**
--
--   ✅ **而也正因為本支在它們之後, 下面那道「對方是不是我要改的那一版」的 apply 期斷言
--      【這一次可行】** —— 那一刻它們一定已經是最新版。
--      📌 **同一個做法在上一支不可行、在本支可行, 差別只在版本號的先後。**
--
-- ── 🔴 Q5 的代價(寫死, 不要靠人記得)────────────────────────────────────────
--   落點② 掛的 trigger 是 `order_pending_refund_open_au`, 而它 `tgenabled = 'O'`(PG 預設)。
--   ⇒ 🛑 **在 `session_replication_role = replica`(還原 / 大量匯入)之下, 整支被跳過
--        ⇒ 那時候取消【不會】退券。** Sean Q5 甲 = 維持 `'O'` 不動。
--   🔴 **而「同一張表上兩套標準」要在這裡寫死**:`20260901021000` 的自檢**要求扣券那支
--      trigger 必須是 `'A'`**, 理由逐字「`O` 在 replica 之下整支被跳過, 而實測券沒被扣
--      而 UPDATE 照樣成功」⇒ 📌 **扣券要 `'A'`、退券這條是 `'O'` —— 兩邊對 replica 模式的
--      答案相反, 而今天沒有人裁過。** 分母:今天 replica 模式只有還原時才會用到 ⇒ 0。
--
-- ── 🔴 body 是【抽出來的】不是重打的 ─────────────────────────────────────────
--   形狀抄 `20260905070000` 那一支的做法(它檔內逐字「用 awk 抽的, 沒有重打」)。
--   🔬 本支的產生與驗證(2026-09-11):
--     ① 從 `20260907140000` / `20260905070000` 逐位元組抽出兩支的 body
--     ② 🟢 **抽出來的 body 與正式庫 `prosrc` 的 md5 逐支相同**:
--          `pcm_sync_order_refund_payment_status` ⇒ 38dc32ef2ad275588363db641f2019e3(4,770 bytes)
--          `pcm_pending_refund_on_cancel`         ⇒ 1dd4b13f79ae55be2e39e6fa7c4e9607(  175 bytes)
--        ⇒ 📌 **版控與正式庫在這兩支上逐位元組相同 ⇒ 抄 repo 是安全的。**
--     ③ diff 驗:匯流點 **+12 行 / −0 行**;取消那支 **+7 行 / −0 行**
--        ⇒ 🛑 **刪除 0 行 —— 其餘一個字都沒動。**
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. apply 前的硬前置(fail-closed)────────────────────────────────────────
DO $pre$
DECLARE
  v_sync text;
  v_canc text;
  v_code text;
BEGIN
  -- ① 退券函式必須已經在(本支只接線, 不建它)
  IF pg_catalog.to_regprocedure('public.coupon_revert_on_full_refund(pg_catalog.uuid)') IS NULL THEN
    RAISE EXCEPTION '接線 fail-closed:public.coupon_revert_on_full_refund(uuid) 不存在 ⇒ 先貼 20260901020500';
  END IF;

  SELECT p.prosrc INTO v_sync FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_sync_order_refund_payment_status(pg_catalog.uuid)');
  SELECT p.prosrc INTO v_canc FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_pending_refund_on_cancel()');
  IF v_sync IS NULL OR v_canc IS NULL THEN
    RAISE EXCEPTION '接線 fail-closed:要改的那兩支有一支查不到 ⇒ 拒繼續';
  END IF;

  -- ② 🔴 **它們必須是我抽 body 的那一版** —— 不是就拒絕, 因為我的 CREATE OR REPLACE
  --    會把它們換成【我手上那一版 + 一行呼叫】⇒ 若庫上已經比我新, 那就是把別人的改動蓋掉。
  IF pg_catalog.md5(v_sync) <> '38dc32ef2ad275588363db641f2019e3' THEN
    RAISE EXCEPTION '接線 fail-closed:pcm_sync_order_refund_payment_status 的 body 不是我抽的那一版(實得 md5=%)⇒ 有人改過它, 本支會蓋掉那個改動', pg_catalog.md5(v_sync);
  END IF;
  IF pg_catalog.md5(v_canc) <> '1dd4b13f79ae55be2e39e6fa7c4e9607' THEN
    RAISE EXCEPTION '接線 fail-closed:pcm_pending_refund_on_cancel 的 body 不是我抽的那一版(實得 md5=%)⇒ 有人改過它, 本支會蓋掉那個改動', pg_catalog.md5(v_canc);
  END IF;

  -- ③ 它們今天【還沒有】呼退券函式(本支不可重跑, 而這一格讓重跑大聲失敗而不是靜靜疊一行)
  -- 🔴 用 `pg_catalog.strpos(haystack, needle)`, **不要用 `position(x IN y)`** ——
  --    後者是 **SQL 特殊語法, 不是可加 schema 的函式** ⇒ 給它加 `pg_catalog.` 前綴直接語法錯。
  --    📌 而 `20260907140000` 的檔頭【就在警告這一族】(COALESCE / NULLIF / GREATEST / LEAST),
  --       我抄了它的 body, 而沒有讀它的警告 —— 2026-09-11 拋棄式 PG 第一發就死在這裡。
  IF pg_catalog.strpos(v_sync, 'coupon_revert_on_full_refund') <> 0
     OR pg_catalog.strpos(v_canc, 'coupon_revert_on_full_refund') <> 0 THEN
    RAISE EXCEPTION '接線 fail-closed:那兩支裡已經有 coupon_revert_on_full_refund ⇒ 本支貼過了, 拒重跑';
  END IF;

  -- 🟢 負對照:上面那把 md5 若對任何東西都相等, 它就沒有判別力。
  IF pg_catalog.md5('zzq_no_such_body_20260911') = '38dc32ef2ad275588363db641f2019e3' THEN
    RAISE EXCEPTION '接線 自檢:負對照命中 ⇒ md5 這把尺可疑';
  END IF;
END $pre$;

-- ── 1. 落點①(有錢動的)· 匯流點 ─────────────────────────────────────────────
-- 🔴 **除了下面那一段新增的呼叫, body 逐位元組取自 `20260907140000`, 一個字沒動。**
CREATE OR REPLACE FUNCTION public.pcm_sync_order_refund_payment_status(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
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
                      WHERE i.kind = 'refund_over_total' AND i.subject_id = p_order_id
                        AND i.resolved_at IS NULL) THEN
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

  -- ══ 🔴 [2026-09-11 · 接線] 券的退回 —— 唯一新增的一段 ═══════════════════════
  --   Sean 2026-09-11 Q2 甲:**無條件呼, 由退券函式自己判夠不夠格**(靠它的冪等,
  --   不靠誰記得補呼)⇒ 本處【不判】, 也不要在這裡加任何條件。
  --   🔴 **位置刻意在【那一行 RETURN 之前】** —— 形狀抄 `pcm_noncard_settle_recompute`
  --      逐字:「位置刻意在所有 RETURN 之前 —— 下面每一條 early-return 都會漏掉它」。
  --      🔬 而本函式今天**只有一個 RETURN**(其餘出口都是 RAISE ⇒ 整個交易 abort)
  --        ⇒ 放這裡就蓋得住每一條走得到底的路。⚠️ **日後有人加 early-return, 要放到它之前。**
  --   🛑 **unpaid 那條路到不了這裡** —— 上面那道 domain 閘會先 RAISE
  --      (`payment_status NOT IN (paid, partiallyRefunded, refunded)`)
  --      ⇒ 📌 **所以「取消而從來沒付過錢」那一類, 由取消那條路的落點負責, 不是這裡。**
  PERFORM public.coupon_revert_on_full_refund(p_order_id);

  RETURN v_ps;
END;
$fn$;

-- ── 2. 落點②(沒錢動的)· 取消那個路口 ──────────────────────────────────────
-- 🔴 **除了下面那一段新增的呼叫, body 逐位元組取自 `20260905070000`, 一個字沒動。**
CREATE OR REPLACE FUNCTION public.pcm_pending_refund_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF OLD.cancelled_at IS NOT NULL OR NEW.cancelled_at IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM public.pcm_pending_refund_open_for(NEW.id);
  -- ══ 🔴 [2026-09-11 · 接線] 券的退回 —— 唯一新增的一行 ═════════════════════
  --   Sean 2026-09-11 Q5 甲:**取消就退券**, 不管有沒有退過錢。
  --   Q1 甲:落點掛在【這個路口】而不是 admin_cancel_order / admin_mark_order_cancelled
  --   各掛一次 —— 因為本函式掛在 `AFTER UPDATE OF cancelled_at`,
  --   它蓋得住**每一條**把 cancelled_at 從 NULL 改成有值的路, **含還沒被寫出來的那一條**。
  --   🔴 **而退券函式自己會判夠不夠格** —— 本處無條件呼, 與匯流點那一側同形。
  PERFORM public.coupon_revert_on_full_refund(NEW.id);
  RETURN NULL;
END;
$fn$;

-- ── 3. apply 當下的事後斷言(問【它現在長什麼樣】, 不問 rc)──────────────────
DO $post$
DECLARE
  v_sync text;
  v_canc text;
BEGIN
  SELECT p.prosrc INTO v_sync FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_sync_order_refund_payment_status(pg_catalog.uuid)');
  SELECT p.prosrc INTO v_canc FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_pending_refund_on_cancel()');

  -- ① 兩個落點都真的接上了(剝行註解後再問 —— 🔴 不剝的話, 我寫的那一大段【註解】
  --    自己就含那個函式名 ⇒ 斷言會被自己的註解餵飽而恆綠。
  --    📌 那正是 2026-09-11「庚」那一類:尺跑對了, 而它掃的文本不是你以為的那個。)
  IF pg_catalog.strpos(
       (SELECT pg_catalog.string_agg(pg_catalog.regexp_replace(l.txt,'--.*$',''), E'\n' ORDER BY l.ln)
          FROM pg_catalog.regexp_split_to_table(v_sync, E'\n') WITH ORDINALITY AS l(txt,ln)),
       'coupon_revert_on_full_refund') = 0 THEN
    RAISE EXCEPTION '接線 fail-closed:匯流點的【碼】裡沒有那個呼叫(只有註解有)⇒ 接線沒成功';
  END IF;
  IF pg_catalog.strpos(
       (SELECT pg_catalog.string_agg(pg_catalog.regexp_replace(l.txt,'--.*$',''), E'\n' ORDER BY l.ln)
          FROM pg_catalog.regexp_split_to_table(v_canc, E'\n') WITH ORDINALITY AS l(txt,ln)),
       'coupon_revert_on_full_refund') = 0 THEN
    RAISE EXCEPTION '接線 fail-closed:取消那個路口的【碼】裡沒有那個呼叫 ⇒ 接線沒成功';
  END IF;

  -- ② owner 與權限沒有被 CREATE OR REPLACE 改掉(它保留既有 owner, 而這裡問一次不是信一次)
  IF (SELECT p.proowner::regrole::text FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_sync_order_refund_payment_status(pg_catalog.uuid)')) <> 'postgres' THEN
    RAISE EXCEPTION '接線 fail-closed:匯流點的 owner 不是 postgres';
  END IF;

  -- ③ 🔴 `SET search_path` 沒有被換掉 —— `CREATE OR REPLACE` 會把 SET 子句整組換掉,
  --    而我在上面兩支各自重寫了 `SET search_path = ''`。這裡問一次。
  -- 🔴 **字面是 `search_path=""`(帶雙引號)不是 `search_path=`** —— 2026-09-11 拋棄式 PG 實測:
  --    `SET search_path = ''` 存進 `proconfig` 之後逐字是 `search_path=""`。
  --    📌 我第一版寫 `'search_path='` ⇒ 本斷言【正確地紅了】, 而紅的是我的尺不是那支函式。
  --    ✅ 而它紅得對:一道 fail-closed 的斷言寧可誤擋, 不可誤放。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_sync_order_refund_payment_status(pg_catalog.uuid)')
       AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION '接線 fail-closed:匯流點的 search_path 不是空字串 ⇒ SECURITY DEFINER 提權面被打開了';
  END IF;
  -- 🔵 取消那個路口也要問一次 —— 第一版漏了它(兩支都是 SECURITY DEFINER)。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_pending_refund_on_cancel()')
       AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION '接線 fail-closed:取消那個路口的 search_path 不是空字串';
  END IF;

  -- 🟢 負對照:同一把尺問一支不存在的函式 ⇒ 必須查無
  IF pg_catalog.to_regprocedure('public.zzq_no_such_fn_20260911(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '接線 自檢:負對照命中 ⇒ 量具可疑';
  END IF;
END $post$;

COMMIT;
