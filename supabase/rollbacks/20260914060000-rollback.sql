-- 20260914060000-rollback.sql —— 退回 20260914060000_m4b_auto_cancel_on_full_card_refund.sql(第 9 代 → 第 8 代)
--
-- 🔴 已被自動標成已取消的單, `cancelled_at` / audit 留著(那是發生過的事, 不是本檔的事);本檔零 DELETE。
-- 🔴 pcm_incident 若已有新 kind 的列 ⇒ CHECK 縮不回去 ⇒ 拒退(先處理那些列, 而那是另一次有人簽名的動作)。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_sync_order_refund_payment_status(uuid)');
  IF v_src IS NULL OR pg_catalog.md5(v_src) <> '55d7bde11923bdd8ab0b4025617e3409' THEN
    RAISE EXCEPTION USING MESSAGE = '退回前置閘一:匯流點本體不是第 9 代 55d7bde11923bdd8ab0b4025617e3409(實得 ' || COALESCE(pg_catalog.md5(v_src), '<null>') || ')⇒ 不是本檔知道怎麼退的版本';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pcm_incident WHERE kind IN ('auto_cancel_skipped', 'auto_cancel_failed')) THEN
    RAISE EXCEPTION '退回前置閘二:pcm_incident 已有 auto_cancel_* 的列 ⇒ CHECK 縮不回去, 先處理那些列';
  END IF;
END
$pre$;

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
  -- 🔴 [20260911170000 · 收成一份] 三段帳本改呼 public.pcm_order_money_moved ——
  --    述詞逐字搬過去(見那支 migration 檔頭)。退券函式呼的是【同一支】⇒ 兩邊不會再各寫一份。
  --    第三段(manual_failed 更正成 money_moved)為什麼要算:原文在 20260910210000:148-151。
  v_moved := public.pcm_order_money_moved(p_order_id);

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


DROP FUNCTION public.pcm_auto_cancel_on_full_card_refund(uuid);

ALTER TABLE public.pcm_incident DROP CONSTRAINT pcm_incident_kind_check;
ALTER TABLE public.pcm_incident ADD CONSTRAINT pcm_incident_kind_check
  CHECK (kind IN ('pending_refund_open_failed', 'refund_over_total'));

DO $post$
DECLARE v_src text; v_acl text;
BEGIN
  SELECT p.prosrc, pg_catalog.array_to_string(p.proacl, ',') INTO v_src, v_acl FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_sync_order_refund_payment_status(uuid)');
  IF pg_catalog.md5(v_src) <> '6ce1d4e2d1eead06c61a9b6726ea6f9e' THEN
    RAISE EXCEPTION USING MESSAGE = '退回後置閘一:本體 md5 不是第 8 代(實得 ' || pg_catalog.md5(v_src) || ')';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.pcm_sync_order_refund_payment_status(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.pcm_sync_order_refund_payment_status(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION USING MESSAGE = '退回後置閘二:匯流點對 anon / authenticated 開了 EXECUTE(' || COALESCE(v_acl, '<null>') || ')';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_auto_cancel_on_full_card_refund(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '退回後置閘三:新函式還在';
  END IF;
END
$post$;

COMMIT;
