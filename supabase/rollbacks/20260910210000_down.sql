-- 回捲 · `20260910210000_m4b_coupon_revert_wiring.sql`(券的退回 · 接線)
--
-- 🔴🔴 **本檔【內含完整 body】, 不寫「請去某某檔複製」** —— Sean 2026-09-11 Q4 甲。
--    理由:回捲的人是在**出事的當下**讀它, 那時候他沒有心情去翻另一支檔。
--    🔬 下面兩支 body 逐位元組取自 `20260907140000` / `20260905070000`
--       (md5 分別 38dc32ef2ad275588363db641f2019e3 · 1dd4b13f79ae55be2e39e6fa7c4e9607)
--       ⇒ 它們是【接線之前】那一版, 不含那兩段呼叫。
--
-- 🔴🔴 **單向的那一格 —— 回捲【救不回】已經退掉的券**:
--    已經被寫上 `coupon_redemptions.reverted_at` 的那些列**不會跟著回來**。
--    回捲只拿掉「以後還會不會退」, 拿不掉「已經退過的那些」。
--    ⇒ 回捲前先量一次, 才知道這一發的代價有多大:
--      `SELECT count(*) FROM public.coupon_redemptions WHERE reverted_at IS NOT NULL;`
--    📌 而那個數字**不會因為回捲而變回 0**。
--
-- 🔵 `lock_timeout`:鎖等不到就放棄, 不要卡住別人。
SET lock_timeout = '3s';

BEGIN;

-- ── 1. 匯流點 ⇒ 換回【沒有那段呼叫】的那一版 ────────────────────────────────
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

  RETURN v_ps;
END;
$fn$;

-- ── 2. 取消那個路口 ⇒ 換回【沒有那一行】的那一版 ───────────────────────────
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
  RETURN NULL;
END;
$fn$;

-- ── 3. 事後斷言:問【它現在長什麼樣】, 不問 rc ──────────────────────────────
DO $rb$
DECLARE
  v_sync text;
  v_canc text;
BEGIN
  SELECT p.prosrc INTO v_sync FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_sync_order_refund_payment_status(pg_catalog.uuid)');
  SELECT p.prosrc INTO v_canc FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_pending_refund_on_cancel()');

  -- 🔴 回到【逐位元組相同】的那一版 —— 不是「大概回去了」。
  IF pg_catalog.md5(v_sync) <> '38dc32ef2ad275588363db641f2019e3' THEN
    RAISE EXCEPTION '回捲 fail-closed:匯流點沒有回到接線前那一版(實得 md5=%)', pg_catalog.md5(v_sync);
  END IF;
  IF pg_catalog.md5(v_canc) <> '1dd4b13f79ae55be2e39e6fa7c4e9607' THEN
    RAISE EXCEPTION '回捲 fail-closed:取消那個路口沒有回到接線前那一版(實得 md5=%)', pg_catalog.md5(v_canc);
  END IF;

  -- 🟢 負對照:退券函式【應該還在】—— 本檔不碰它(碰它會讓 021000/030000 的前置閘重新擋著)
  IF pg_catalog.to_regprocedure('public.coupon_revert_on_full_refund(pg_catalog.uuid)') IS NULL THEN
    RAISE EXCEPTION '回捲 自檢:退券函式不見了 ⇒ 本檔不該碰它, 有別的東西也在動';
  END IF;
END $rb$;

COMMIT;
