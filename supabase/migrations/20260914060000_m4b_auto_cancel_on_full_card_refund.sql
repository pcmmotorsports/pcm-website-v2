-- 20260914060000_m4b_auto_cancel_on_full_card_refund.sql —— 刷卡全額退款成功 ⇒ 訂單自動標「已取消」
--
-- 🛑 未貼(寫好不貼;貼是 Sean 一次一個編號)。plan `docs/plans/2026-09-14-auto-cancel-on-full-card-refund-plan.md`。
--
-- ══ Sean 拍的 ══════════════════════════════════════════════
-- 09-12「刷卡全退自動取消」要有(memory project_0912-admin-order-ux-redesign);CURRENT.md 0913 記為已知缺口。
--
-- ══ 做什麼 ═════════════════════════════════════════════════
-- ① 新函式 `pcm_auto_cancel_on_full_card_refund(uuid)`:前提 = 刷卡 + refunded + 沒取消過 + 沒部分取消;actor = 最後一筆退款的經手人;
--    冪等鍵由單號決定;呼叫既有 `admin_mark_order_cancelled`(寫 cancelled_at / cancelled_reason / audit order.mark_cancelled);
--    失敗吞掉留痕 pcm_incident(query_canceled 不吞)。零 GRANT(只給 sync 函式在 definer 下呼叫)。
-- ② `pcm_sync_order_refund_payment_status` 第 9 代 = 第 8 代(`20260911170000:137-240`, 貼板 129)逐字 + 在券退回之後一行:
--    `IF v_ps = 'refunded' THEN PERFORM public.pcm_auto_cancel_on_full_card_refund(p_order_id); END IF;`
--    掛路口不掛門口:8 支呼叫端(卡片結案 / 非卡登記 / TapPay backfill / 作廢 …)全經過這裡。
-- ③ `pcm_incident_kind_check` 加 `auto_cancel_skipped` / `auto_cancel_failed`。
-- 客人通知零新接線:`pcm_cancelled_email_pending` 對「tappay + refunded + cancelled_at 非空」自動排 order_cancelled 信(0903 拍甲)。
-- 只影響刷卡全退;非卡 / 部分退款 / 舊單(不回填)不動。後台「標記已取消」鈕留著(補救 + 舊單)。
--
-- ══ 回滾 ═══════════════════════════════════════════════════
-- `supabase/rollbacks/20260914060000-rollback.sql`:第 8 代逐字貼回 + DROP 新函式 + CHECK 縮回(表裡有新 kind 的列 ⇒ 拒退)。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_src text; v_config text[]; v_secdef boolean;
BEGIN
  SELECT p.prosrc, p.proconfig, p.prosecdef INTO v_src, v_config, v_secdef
    FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_sync_order_refund_payment_status(uuid)');
  IF v_src IS NULL THEN
    RAISE EXCEPTION '前置閘一:找不到 pcm_sync_order_refund_payment_status(uuid)';
  END IF;
  -- 🔴 本體 = 第 8 代(20260911170000 後置閘那一版)才准貼:本檔的函式體是從那一版逐字抄的。
  IF pg_catalog.md5(v_src) <> '6ce1d4e2d1eead06c61a9b6726ea6f9e' THEN
    RAISE EXCEPTION USING MESSAGE =
      '前置閘二:匯流點本體 md5 不是第 8 代 6ce1d4e2d1eead06c61a9b6726ea6f9e(實得 ' || pg_catalog.md5(v_src) || ')⇒ 有人動過它, 本檔的抄本基準已失效, 停下人工對齊';
  END IF;
  -- CREATE OR REPLACE 會把 SET 子句整組換掉 ⇒ 屬性也要是第 8 代那一組(secdef + search_path 空), 本檔 header 逐字重貼同一組。
  IF NOT (v_secdef AND v_config IS NOT DISTINCT FROM ARRAY['search_path=""']::text[]) THEN
    RAISE EXCEPTION USING MESSAGE =
      '前置閘三:匯流點屬性不是第 8 代那一組(prosecdef=' || v_secdef::text || ' proconfig=' || COALESCE(v_config::text, 'NULL') || ')';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_auto_cancel_on_full_card_refund(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘四:pcm_auto_cancel_on_full_card_refund 已經在 ⇒ 這一片貼過了, 拒重貼';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_mark_order_cancelled(uuid,uuid,text,text,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.pcm_incident_log(text,uuid,text)') IS NULL THEN
    RAISE EXCEPTION '前置閘五:admin_mark_order_cancelled(uuid,uuid,text,text,text) 或 pcm_incident_log(text,uuid,text) 不在 ⇒ 本檔要呼叫的東西還沒貼';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.pcm_incident'::regclass AND conname = 'pcm_incident_kind_check') THEN
    RAISE EXCEPTION '前置閘六:pcm_incident_kind_check 不在 ⇒ 小事故表的形狀不是我以為的';
  END IF;
END
$pre$;

-- ── ① 小事故 kind 加兩種 ───────────────────────────────────────────
ALTER TABLE public.pcm_incident DROP CONSTRAINT pcm_incident_kind_check;
ALTER TABLE public.pcm_incident ADD CONSTRAINT pcm_incident_kind_check
  CHECK (kind IN ('pending_refund_open_failed', 'refund_over_total', 'auto_cancel_skipped', 'auto_cancel_failed'));

-- ── ② 自動取消那一支 ─────────────────────────────────────────────
CREATE FUNCTION public.pcm_auto_cancel_on_full_card_refund(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $auto$
DECLARE
  v_order  record;
  v_actor  text;
  v_key    uuid;
  v_result jsonb;
  v_state  text;
  v_msg    text;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN 'skipped:null_order';
  END IF;
  -- 呼叫端(pcm_sync_order_refund_payment_status)已對 orders 那一列 FOR NO KEY UPDATE;這裡再讀一次拿齊欄位。
  SELECT o.id, o.payment_method, o.payment_status::text AS payment_status, o.cancelled_at
    INTO v_order
    FROM public.orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RETURN 'skipped:not_found';
  END IF;
  -- 前提 = admin_mark_order_cancelled 的閘, 先判、不讓它 RAISE(這四種都不是錯, 是「不歸這條路管」)。
  IF v_order.payment_method IS DISTINCT FROM 'tappay' THEN
    RETURN 'skipped:not_card';
  END IF;
  IF v_order.payment_status IS DISTINCT FROM 'refunded' THEN
    RETURN 'skipped:not_fully_refunded';
  END IF;
  IF v_order.cancelled_at IS NOT NULL THEN
    RETURN 'skipped:already_cancelled';
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_cancellation_items ci
               JOIN public.order_items oi ON oi.id = ci.order_item_id
              WHERE oi.order_id = p_order_id) THEN
    RETURN 'skipped:partially_cancelled';
  END IF;
  -- 🔴 混合軌(有人工退款的刷卡單)不自動取消(codex R1 must-fix ④):取消信 view 對「有人工退款」的單不寄、逐筆退款信又要求
  --    已取消的單先有取消信 ⇒ 自動取消會讓那位客人兩封都收不到。混合軌本來就走人工寄信 SOP(每天告警 + `get_cancelled_mixed_rail_gap_counts`),
  --    這裡留給人按「標記已取消」。Sean 拍的字面是「刷卡全退」= 純卡片路。
  IF EXISTS (SELECT 1 FROM public.order_manual_refunds m WHERE m.order_id = p_order_id AND m.voided_at IS NULL) THEN
    RETURN 'skipped:mixed_rail';
  END IF;

  -- actor = 這張單【最後一筆算進 money_moved 的卡片退款】的經手人:confirmed 的 order_refunds, 或 failed/manual_failed 而被有效更正成
  --    money_moved 的那筆(更正人 = 經手人)—— 與 pcm_order_money_moved 同一組分母(codex R1 must-fix ③)。
  -- 🔴 先挑最後那一筆、再看那個人啟不啟用(must-fix ②):不可以「跳過停用的、拿更早那個人」—— 那是冒名。
  SELECT a.actor INTO v_actor
    FROM (
      SELECT r.actor, r.confirmed_at AS at, r.id
        FROM public.order_refunds r
       WHERE r.order_id = p_order_id AND r.status = 'confirmed'
      UNION ALL
      SELECT v.actor, v.created_at AS at, r.id
        FROM public.order_refunds r
        JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
       WHERE r.order_id = p_order_id AND r.status = 'failed' AND r.failed_reason = 'manual_failed'
         AND v.corrected_to = 'money_moved'
    ) a
   ORDER BY a.at DESC NULLS LAST, a.id DESC
   LIMIT 1;
  IF v_actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = v_actor AND s.is_active) THEN
    -- 留痕一次就好:同一張單同一種未解決事故不重複記(must-fix ⑤;同匯流點 refund_over_total 那條的去重形狀)。
    IF NOT EXISTS (SELECT 1 FROM public.pcm_incident i
                    WHERE i.kind = 'auto_cancel_skipped' AND i.subject_id = p_order_id AND i.resolved_at IS NULL) THEN
      PERFORM public.pcm_incident_log('auto_cancel_skipped', p_order_id,
        '刷卡全額退款但最後一筆退款的經手人不在 / 已停用 ⇒ 沒有自動標取消;請到後台按「標記已取消」');
    END IF;
    RETURN 'skipped:no_actor';
  END IF;

  -- 冪等鍵:由單號決定。成功之後重跑 sync 會先被上面 `cancelled_at IS NOT NULL` 擋掉(走不到這裡);這把鍵擋的是
  --    「mark RPC 寫了一半 / 同一交易內重入」那種世界 —— 同鍵同 actor ⇒ mark RPC 回 idempotent, 不落第二列 audit。
  v_key := pg_catalog.md5('pcm-auto-cancel:' || p_order_id::text)::uuid;

  BEGIN
    v_result := public.admin_mark_order_cancelled(p_order_id, v_key, v_actor, 'other', '刷卡已全額退款,系統自動取消');
  EXCEPTION
    WHEN query_canceled THEN RAISE;   -- 逾時/取消不吞, 原樣往外
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      -- 🔴 吞掉但留痕:退款在 TapPay 已經成立, 讓「標取消」失敗把整個結案交易退掉 = 帳面錢的狀態不更新, 比沒自動取消更糟。
      --    pcm_incident 進 Sean 的日報(shouldAlert), 後台那顆「標記已取消」鈕可以補按。同一張單未解決的只記一列。
      IF NOT EXISTS (SELECT 1 FROM public.pcm_incident i
                      WHERE i.kind = 'auto_cancel_failed' AND i.subject_id = p_order_id AND i.resolved_at IS NULL) THEN
        PERFORM public.pcm_incident_log('auto_cancel_failed', p_order_id,
          '自動標取消失敗 ' || v_state || ' ' || pg_catalog.left(v_msg, 200));
      END IF;
      RETURN 'skipped:error';
  END;
  RETURN CASE WHEN COALESCE((v_result ->> 'idempotent')::boolean, false) THEN 'already' ELSE 'marked' END;
END;
$auto$;
COMMENT ON FUNCTION public.pcm_auto_cancel_on_full_card_refund(uuid) IS
  '刷卡全額退款 ⇒ 自動標已取消(20260914060000;Sean 09-12 拍)。只由 pcm_sync_order_refund_payment_status 在 definer 下呼叫, 零 GRANT。前提 = admin_mark_order_cancelled 的閘(刷卡 / refunded / 沒取消過 / 沒部分取消);actor = 最後一筆退款的經手人;冪等鍵 md5(pcm-auto-cancel:<order_id>);失敗吞掉留痕 pcm_incident(auto_cancel_failed / auto_cancel_skipped), query_canceled 不吞。';
REVOKE ALL ON FUNCTION public.pcm_auto_cancel_on_full_card_refund(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_auto_cancel_on_full_card_refund(uuid) FROM anon, authenticated, service_role;

-- ── ③ 匯流點第 9 代(第 8 代逐字 + 一段 hook;header 逐字 = SECURITY DEFINER + SET search_path = '')──
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

  -- 第 9 代(20260914060000;Sean 09-12 拍「刷卡全退自動取消」):全額退到位 ⇒ 順手把單標成已取消。
  -- 🔴 掛在這個路口不掛門口(同上面那支券退回):8 支呼叫端都經過這裡, 少一條路就少一種「退了錢單還開著」。
  -- 🔴 那支自己判前提(只有刷卡 + refunded + 沒取消過 + 沒部分取消)、自己吞錯留痕 —— 這裡的錢狀態已經寫完, 不因為它退掉。
  IF v_ps = 'refunded' THEN
    PERFORM public.pcm_auto_cancel_on_full_card_refund(p_order_id);
  END IF;

  RETURN v_ps;
END;
$fn$;


-- ── 事後閘 ────────────────────────────────────────────────────
DO $post$
DECLARE
  v_src text; v_acl text; v_config text[];
  v_functions text[] := ARRAY['public.pcm_auto_cancel_on_full_card_refund(uuid)']::text[];
  r text; v_bad text := NULL;
BEGIN
  SELECT p.prosrc, pg_catalog.array_to_string(p.proacl, ','), p.proconfig INTO v_src, v_acl, v_config
    FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_sync_order_refund_payment_status(uuid)');
  IF pg_catalog.md5(v_src) <> '55d7bde11923bdd8ab0b4025617e3409' THEN
    RAISE EXCEPTION USING MESSAGE = '事後閘一:第 9 代本體 md5 是 ' || pg_catalog.md5(v_src) || ', 編檔時算的是 55d7bde11923bdd8ab0b4025617e3409';
  END IF;
  IF pg_catalog.strpos(v_src, 'PERFORM public.pcm_auto_cancel_on_full_card_refund(p_order_id)') = 0 THEN
    RAISE EXCEPTION '事後閘二:hook 不在 ⇒ 貼了等於沒貼';
  END IF;
  IF pg_catalog.strpos(v_src, 'PERFORM public.coupon_revert_on_full_refund(p_order_id)') = 0 THEN
    RAISE EXCEPTION '事後閘三:第 8 代的券退回不見了 ⇒ 動到不該動的';
  END IF;
  IF v_config IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION USING MESSAGE = '事後閘四:匯流點 search_path 不是空字串(' || COALESCE(v_config::text, 'NULL') || ')';
  END IF;
  -- 第 8 代事後斷言(20260911170000:409)明訂匯流點 proacl = 只有 owner(`postgres=X/postgres`):它只被別的 definer RPC 在內部呼叫。
  --    CREATE OR REPLACE 不動 ACL ⇒ 這裡斷言「沒有多出來」, 不要求 service_role(codex R1 must-fix ①)。
  IF pg_catalog.has_function_privilege('anon', 'public.pcm_sync_order_refund_payment_status(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.pcm_sync_order_refund_payment_status(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION USING MESSAGE = '事後閘五:匯流點對 anon / authenticated 開了 EXECUTE(收到 ' || COALESCE(v_acl, '<null>') || ')';
  END IF;
  FOREACH r IN ARRAY v_functions LOOP
    IF pg_catalog.has_function_privilege('anon', r, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', r, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', r, 'EXECUTE') THEN
      v_bad := pg_catalog.concat_ws(' | ', v_bad, r || ':不該有 EXECUTE(只給 definer 內部呼叫)');
    END IF;
  END LOOP;
  IF (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=""']::text[] FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_auto_cancel_on_full_card_refund(uuid)')) IS NOT TRUE THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'pcm_auto_cancel_on_full_card_refund 不是 SECURITY DEFINER + search_path 空');
  END IF;
  IF pg_catalog.pg_get_constraintdef((SELECT oid FROM pg_catalog.pg_constraint WHERE conrelid = 'public.pcm_incident'::regclass AND conname = 'pcm_incident_kind_check')) NOT LIKE '%auto_cancel_failed%' THEN
    v_bad := pg_catalog.concat_ws(' | ', v_bad, 'pcm_incident_kind_check 沒有新 kind');
  END IF;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '事後閘六:%', v_bad;
  END IF;
  RAISE NOTICE '第 9 代貼好了:刷卡全額退款 ⇒ 自動標已取消(掛在 pcm_sync_order_refund_payment_status)。';
END
$post$;

COMMIT;
