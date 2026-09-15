-- 20260916060000 · P1-6 非卡片結算重算失敗要看得見(稽核 P1-6)
-- plan:docs/plans/2026-09-15-noncard-settle-recompute-failure-visibility-plan.md(v3, 509cafe3b;主視窗核過開工)。
-- Sean 拍板:Q1 甲(全做)· Q2 甲(現金一起進重試與健康檢查)· Q-M2 乙(重試放棄也寫事故)· R2 MF1+S1–S7 甲。
-- 退回檔:supabase/rollbacks/20260916060000-rollback.sql(整支檔自帶 BEGIN / SET LOCAL lock_timeout / COMMIT)。
--
-- 做五件事(同一個交易):
--   4-0 新增 pcm_settle_verdict_safe(uuid):OP6a 丟錯時回 'error' 不往外丟。owner postgres、四道 REVOKE、零 GRANT。
--   4-A pcm_incident.kind 封閉集加 settle_recompute_failed / settle_retry_gave_up(TS 白名單同一顆 commit)。
--   4-B pcm_noncard_settle_recompute:逐字抄正式庫那一代(= 20260905290000:227),只改外層 handler ⇒ 吞錯照舊、另寫事故。
--   4-C pcm_settle_retry_sweep:現金一起救;候選只收「狀態真的該變」的單;verdict 搬進每張單的保護區;
--       成功 = 狀態等於期望;成功歸零、重開歸零;第一次蓋上放棄章那一刻寫事故。
--   4-D get_stuck_bank_orders_health 加 C 世界(錢收足、狀態未付,匯款 / 現金分開)+ judge_error_count;
--       get_settle_retry_gaveup_health 舊鍵只數匯款、新鍵數現金。
--
-- 🔴 前置閘釘四支函式的 md5 / owner / ACL(2026-09-15 對正式庫唯讀量;拋棄式 PG 從 11:58 dump 起、套完 178–185 後逐字相同)。
-- 🔴 事後閘只看 catalog,不在持有 pcm_incident ACCESS EXCLUSIVE 時呼叫排程或健康檢查(plan 4-A)。
-- ⚠️ WHEN OTHERS 不接 query_canceled(與 repo 慣例一致;逾時仍整筆回捲 = 既有 ⟦b4-NCPCANCELROLLBACK⟧,本片不修)。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.pcm_incident IN ACCESS EXCLUSIVE MODE;

DO $pre$
DECLARE
  v_def text;
  v_n   integer;
  f     record;
BEGIN
  -- 前置閘一:四支要改的函式 = 我抄的那一代(md5 / owner / definer / search_path / ACL 逐項)。
  FOR f IN
    SELECT * FROM (VALUES
      ('pcm_noncard_settle_recompute',   'public.pcm_noncard_settle_recompute(uuid)',  'bc8d977dd098677dbba8a445a7ff6a56', '{postgres=X/postgres}'),
      ('pcm_settle_retry_sweep',         'public.pcm_settle_retry_sweep()',            'fe569ab55fc1e48d0cfcdec7733870b6', '{postgres=X/postgres}'),
      ('get_stuck_bank_orders_health',   'public.get_stuck_bank_orders_health()',      '8f7e158cd7196f32063b6e8eb28a7510', '{postgres=X/postgres,service_role=X/postgres,payment_confirmer=X/postgres}'),
      ('get_settle_retry_gaveup_health', 'public.get_settle_retry_gaveup_health()',    '7725287b5dd063cab8d74cb853e8c2de', '{postgres=X/postgres,service_role=X/postgres,payment_confirmer=X/postgres}')
    ) AS t(name, sig, md5, acl)
  LOOP
    SELECT pg_catalog.count(*) INTO v_n
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f.name;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '前置閘一:% 有 % 支同名(期望 1)⇒ 出現 overload 或不存在, 停下', f.name, v_n;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure(f.sig)
         AND pg_catalog.md5(p.prosrc) = f.md5
         AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
         AND p.prosecdef
         AND p.proconfig = ARRAY['search_path=""']
         AND p.proacl::text = f.acl
    ) THEN
      RAISE EXCEPTION '前置閘一:% 不是 2026-09-15 量到的那一代(md5 %、owner postgres、definer、search_path 空、ACL %)⇒ 有人改過, 停下重抄',
        f.sig, f.md5, f.acl;
    END IF;
  END LOOP;

  -- 前置閘二:OP6a 是 STABLE(safe 標 STABLE 不衝突)、pcm_incident_log 在且 owner postgres。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = pg_catalog.to_regprocedure('public.admin_compute_order_settlement(uuid)')
                    AND p.provolatile = 's') THEN
    RAISE EXCEPTION '前置閘二:admin_compute_order_settlement(uuid) 不存在或不是 STABLE ⇒ pcm_settle_verdict_safe 的揮發性要重想, 停下';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_incident_log(text, uuid, text)')
                    AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres') THEN
    RAISE EXCEPTION '前置閘二:pcm_incident_log(text, uuid, text) 不存在或 owner 不是 postgres ⇒ 停下';
  END IF;

  -- 前置閘三:safe 還不存在(存在 = 貼過了、或 rollback 沒退乾淨)。
  IF pg_catalog.to_regprocedure('public.pcm_settle_verdict_safe(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘三:pcm_settle_verdict_safe(uuid) 已存在 ⇒ 這支貼過了, 不要重貼';
  END IF;

  -- 前置閘四(R2 S6-a):去重用 definer 讀 pcm_incident ⇒ owner 要是 postgres 且沒下 FORCE RLS,否則會安靜讀到 0 列。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                  WHERE c.oid = 'public.pcm_incident'::regclass
                    AND pg_catalog.pg_get_userbyid(c.relowner) = 'postgres'
                    AND NOT c.relforcerowsecurity) THEN
    RAISE EXCEPTION '前置閘四:pcm_incident owner 不是 postgres 或被下了 FORCE RLS ⇒ 事故去重會讀不到, 停下';
  END IF;

  -- 前置閘五:CHECK 只接受兩種逐字形狀 —— 現況 6 種(首次貼),或本片的 8 種(rollback 因有新 kind 列而保留 CHECK 之後重貼)。
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.pcm_incident'::regclass AND c.conname = 'pcm_incident_kind_check';
  IF v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''pending_refund_open_failed''::text, ''refund_over_total''::text, ''auto_cancel_skipped''::text, ''auto_cancel_failed''::text, ''line_forward_failed''::text, ''auto_cancel_live_shipment''::text])))'
     AND v_def IS DISTINCT FROM 'CHECK ((kind = ANY (ARRAY[''pending_refund_open_failed''::text, ''refund_over_total''::text, ''auto_cancel_skipped''::text, ''auto_cancel_failed''::text, ''line_forward_failed''::text, ''auto_cancel_live_shipment''::text, ''settle_recompute_failed''::text, ''settle_retry_gave_up''::text])))' THEN
    RAISE EXCEPTION USING MESSAGE = '前置閘五:CHECK 既不是 20260916010000 的六種、也不是本檔的八種逐字(實得 ' || coalesce(v_def, 'NULL') || ')⇒ 有人加了別種 kind, 停下人工對齊';
  END IF;

  -- 前置閘六(plan §7 開工第一步 / R2 S7):已經被蓋放棄章的訂金單(partiallyPaid 且淨額 < total)。
  --   2026-09-15 正式庫量到 pcm_settle_retry_attempts 0 列 ⇒ 本檔不帶清除碼;> 0 就停下,回 plan 決定清不清。
  SELECT pg_catalog.count(*) INTO v_n
    FROM public.pcm_settle_retry_attempts a
    JOIN public.orders o ON o.id = a.order_id
   WHERE a.gave_up_at IS NOT NULL
     AND o.payment_status = 'partiallyPaid'::public.payment_status
     AND (SELECT coalesce(pg_catalog.sum(p.amount), 0) FROM public.order_payments p WHERE p.order_id = o.id) < o.total;
  IF v_n > 0 THEN
    RAISE EXCEPTION '前置閘六:有 % 張訂金單被蓋了放棄章(開工時量到 0)⇒ 停下, 回 plan §7 決定要不要同檔清掉', v_n;
  END IF;
END
$pre$;

-- ── 4-A 事故種類加兩種 ─────────────────────────────────────────────
DO $kind$
BEGIN
  IF pg_catalog.strpos((SELECT pg_catalog.pg_get_constraintdef(c.oid) FROM pg_catalog.pg_constraint c
                         WHERE c.conrelid = 'public.pcm_incident'::regclass AND c.conname = 'pcm_incident_kind_check'),
                       'settle_retry_gave_up') = 0 THEN
    ALTER TABLE public.pcm_incident DROP CONSTRAINT pcm_incident_kind_check;
    ALTER TABLE public.pcm_incident ADD CONSTRAINT pcm_incident_kind_check
      CHECK (kind IN ('pending_refund_open_failed', 'refund_over_total', 'auto_cancel_skipped', 'auto_cancel_failed', 'line_forward_failed', 'auto_cancel_live_shipment', 'settle_recompute_failed', 'settle_retry_gave_up'));
  ELSE
    RAISE NOTICE 'CHECK 已是八種(上一次 rollback 因有新 kind 列而保留)⇒ 不重做';
  END IF;
END
$kind$;

-- ── 4-0 不會丟錯的 verdict ─────────────────────────────────────────
-- STABLE:唯一呼叫的 admin_compute_order_settlement 是 STABLE(前置閘二釘住);RAISE LOG 不寫資料。
-- BEGIN/EXCEPTION 是 savepoint ⇒ 吞掉的只退到這一點,呼叫端的交易不會變 aborted。
CREATE FUNCTION public.pcm_settle_verdict_safe(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $safe$
BEGIN
  RETURN public.admin_compute_order_settlement(p_order_id) ->> 'verdict';
EXCEPTION WHEN OTHERS THEN
  RAISE LOG '[pcm_settle_verdict_safe] order=% OP6a 丟錯(%)⇒ 回 error', p_order_id, SQLERRM;
  RETURN 'error';
END
$safe$;

-- 🔴 R2 MF1:房規新物件出生自帶 anon 權限(20260905290000:136)⇒ 四道 REVOKE、一個 GRANT 都不給。
--    兩個呼叫端(排程、健康檢查)都是 SECURITY DEFINER、owner postgres ⇒ 以 owner 身分叫得到。
ALTER FUNCTION public.pcm_settle_verdict_safe(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.pcm_settle_verdict_safe(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_settle_verdict_safe(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.pcm_settle_verdict_safe(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.pcm_settle_verdict_safe(uuid) FROM service_role, payment_confirmer;

-- ── 4-B 重算外層吞錯寫事故 ─────────────────────────────────────────
-- 🔴 本體逐字 = 正式庫 prosrc(md5 bc8d977d…),只換最後那個外層 handler。CREATE OR REPLACE 會重設 SET 子句 ⇒ search_path 照寫。
CREATE OR REPLACE FUNCTION public.pcm_noncard_settle_recompute(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_status   public.payment_status;
  v_res      jsonb;
  v_verdict  text;
  v_received bigint;
  v_new      public.payment_status;
  v_hit      integer;
BEGIN
  -- 🔴🔴 例外區塊【整段包住】, 不是只包 OP6a 那一發(v4 §4 對 v2 的更正)。
  --    Sean 拍的那一條:計算器跑不動**不得**讓收款那一列跟著回滾。
  --    而 v2 只包了 OP6a ⇒ 兩個 SUM、UPDATE、以及 UPDATE 觸發的下游 trigger
  --    全在保護之外 ⇒ 它們任何一個拋錯, 客人那筆收款就消失了。
  --    plpgsql 的 BEGIN…EXCEPTION 自帶 savepoint ⇒ 這裡吞掉的只有重算, 不含外面那筆 INSERT。
  -- ⚠️ 誠實邊界:`EXCEPTION WHEN OTHERS` 依 PostgreSQL 定義**不接** query cancel
  --    (SQLSTATE 57014)⇒ statement_timeout 或人工 cancel 仍會冒出去、連帶回滾那筆收款。
  --    本片**沒有修掉這條路**, 它是已知殘留風險(與 20260903080000 心跳那段同一種)。
  BEGIN
    -- 🔴🔴 **每張單一把 advisory lock**(codex R1 must-fix, :203)。
    --    沒有它:兩筆【各自不足、合計付清】的收款同時進來 ⇒ READ COMMITTED 下
    --    兩邊的 SUM 都看不到對方【尚未提交】的那一筆 ⇒ 兩邊都算出 underpaid
    --    ⇒ 兩邊都寫 partiallyPaid ⇒ 🛑 **訂單永久停在「部分付款」, 而錢已經收齊了。**
    --    ⚠️ 而樂觀鎖擋不住這個 —— 它擋的是「別人改過我就不覆蓋」, 而這裡**兩邊算的都是舊世界**。
    -- ✅ 用 advisory 而不是 `SELECT … FOR UPDATE`:後者是鎖升級(那筆 INSERT 的 FK
    --    已對同一列持有 KEY SHARE)⇒ 會死結。advisory 不碰 orders 那一列的鎖。
    -- 🔵 xact 版 ⇒ 交易結束自動釋放, 不需要(也不可能忘記)解鎖。
    PERFORM pg_catalog.pg_advisory_xact_lock(
              pg_catalog.hashtextextended(p_order_id::text, 0));

    -- 🔴🔴 **⟦b4-NCPCRONRACE⟧(20260905070000 新增的唯一一段)**:
    --    錢比取消【晚】到時, `orders` 的 AFTER UPDATE 那道網已經跑完了(當時 order_payments 零列)
    --    ⇒ **一列待退款都不會開**。這一行是那個世界唯一的補救。
    -- 🔵 **沒取消 ⇒ 它自己 RETURN**(判斷在 `pcm_pending_refund_open_for` 裡, 只有一份)
    --    ⇒ 正常路徑的成本 = 一次 by-id 的 SELECT。
    -- 🛑 **位置刻意在【所有 RETURN 之前】** —— 下面每一條 early-return(狀態值域 / 有人工退款 /
    --    verdict 不翻)在【已取消】那個世界裡都會被走到, 而錢已經在庫裡了。
    --    ⇒ 📌 放在任何一條 RETURN 後面, 就會有一條路漏掉它。
    -- ⚠️ **而它在這個 BEGIN…EXCEPTION 區塊【之內】** —— 它丟例外時吞在這裡,
    --    **不得回滾客人那筆收款**(那正是 20260904230000 檔頭那段誠實邊界在講的事)。
    -- 🔴 `false` = **不覆寫既有列的金額**(見該函式上方那段合約:那一欄是快照, 不會自己更新)。
    -- 🔴🔴 **自己包一層 nested BEGIN…EXCEPTION**(adversarial-reviewer R3 must-fix ⑤)——
    --   ⛔ ~~我第一版讓這一行與【狀態重算】共用外面那個 `EXCEPTION WHEN OTHERS`~~
    --   ⇒ 🛑 **open_for 丟例外 ⇒ 整段被吞 ⇒ 錢入帳而 payment_status 不翻、付款信永遠不寄。**
    --     📌 **我為了補一個洞而加的一行, 會讓主線靜靜地不執行。**
    --   ✅ 現在:它自己吞自己的例外, **不影響下面的狀態重算**。
    --   🔵 而 plpgsql 的 BEGIN…EXCEPTION 自帶 savepoint ⇒ 這裡吞掉的只有這一行, 不含外面那筆 INSERT。
    BEGIN
      PERFORM public.pcm_pending_refund_open_for(p_order_id, false);
    -- 🛑 **`WHEN OTHERS` 吞的是什麼, 寫清楚**(R4 nit ①):它涵蓋一般錯誤
    --    (`deadlock_detected` / `lock_timeout` / 約束違反 / 權限),
    --    **而依 PostgreSQL 定義【不接】`query_canceled`(57014)與 `assert_failure`**
    --    ⇒ statement_timeout 或人工 cancel 仍會穿透這裡、連帶回滾外面那筆收款
    --      (那是既有的 ⟦b4-NCPCANCELROLLBACK⟧, 本片沒有修掉它)。
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG '[pcm_noncard_settle] order=% 補開待退款失敗(%), 狀態重算照常進行',
                p_order_id, SQLERRM;
      -- 🔴🔴 **20260905290000 加的唯一一段** —— 讓上面那個吞掉【留下一個看得見的痕跡】。
      --   🛑 吞掉本身不動:不吞就會回滾客人那筆收款(理由在本區塊上方 :356-364)。
      --   🔴 **自己包一層 BEGIN…EXCEPTION** —— 我為了補一個洞而加的一行,
      --      若它自己丟例外, 會傳到【外面那個 handler】⇒ 主線的狀態重算靜靜地不執行。
      --      (那正是 adversarial-reviewer 對前一片打出來的 must-fix ⑤, 同一個形狀。)
      --   🔴 `v_err := SQLERRM` 要**先抓** —— 進到內層 handler 之後 `SQLERRM` 會變成
      --      【留痕自己的錯】, 原始錯誤就沒了。
      DECLARE
        v_err text := SQLERRM;
      BEGIN
        PERFORM public.pcm_incident_log('pending_refund_open_failed', p_order_id, v_err);
      EXCEPTION WHEN OTHERS THEN
        RAISE LOG '[pcm_incident] 連留痕都失敗 order=% 原錯=% 留痕錯=%',
                  p_order_id, v_err, SQLERRM;
      END;
    END;

    SELECT o.payment_status INTO v_status
      FROM public.orders o
     WHERE o.id = p_order_id;

    -- 🔵 單不見了(理論上不會 —— order_payments.order_id 是 FK)⇒ 不讓收款回滾。
    IF v_status IS NULL THEN
      RETURN;
    END IF;

    -- 🔴 可判定集:只有這三個值本片才動。
    --    (這三個值與 OP6a 的前提 P1 逐字相同 ⇒ 兩邊本來就對齊, 不是我另外挑的。)
    IF v_status NOT IN ('unpaid'::public.payment_status,
                        'paid'::public.payment_status,
                        'partiallyPaid'::public.payment_status) THEN
      RETURN;
    END IF;

    -- 🔴🔴 v4 的形狀:**有任何退款活動 ⇒ 交還退款管線, 本片一個字都不寫。**
    --    ⛔ ~~v2 在這裡自己算 refunded / partiallyRefunded~~ —— 那會是**第二個寫入端**。
    --    退款那半自 2026-08-23 起有人管:`admin_record_manual_refund` 會呼叫
    --    `pcm_sync_order_refund_payment_status`
    --    (`20260823020000_m4b_refund_notify_p2a_record_calls_sync.sql`, 檔名逐字
    --     `record_calls_sync`;該檔 :17 逐字「只加這一行, 其餘一字未改」)。
    -- 🔴🔴 **[2026-09-04 訂正]** 上面那句「退款那半自 2026-08-23 起有人管」**疑似不成立** ——
    --    完整因果與複量見檔頭那段訂正。
    --    ⛔ ~~「該支同步器只讀 `order_refunds`, 不讀 `order_manual_refunds`」~~
    --      ⚠️ **只在 `20260905010000` 【貼進正式庫之後】才不成立**(⟦b4-MANREFUNDNOOWNER2⟧)——
    --      🔴 **本句刻意不寫成「已經不成立」**(codex R2 must-fix):較早的 migration 不能替
    --        較晚那一支背書 —— **後片若失敗, 正式庫就留下一句假註解, 而沒有東西會叫。**
    --      ✅ 判法(不要問帳本):`SELECT position('order_manual_refunds' in prosrc) > 0
    --        FROM pg_proc WHERE proname = 'pcm_sync_order_refund_payment_status'`
    --    🔵 ⇒ **本片檔頭最早那句「退款那半有人管」現在【又成立了】** —— 而它繞了一圈:
    --      09-04 我寫它為真 ⇒ 同夜證實為假 ⇒ 09-05 把它做成真的。
    --      📌 三句都留著不刪, 因為**中間那句假的時候, 有人可能已經照它做過決定**。
    --    🛑 **本片的動作不變**(一律 RETURN, 那是安全的);**變假的是理由。**
    --    ⇒ 板列 `⟦b4-MANREFUNDNOOWNER2⟧`。舊字面留著不刪。
    -- 🎯 codex 演出的後果:total=1000, 先人工退 400(v2 寫 partiallyRefunded), 之後卡片再退 600
    --    ⇒ 兩本退款帳合計已達 1000, 而卡片 helper 只看自己的 600
    --    ⇒ **狀態永久停在 partiallyRefunded, 不會成為 refunded。而它不報錯。**
    -- 🔵 voided_at 非空 = 那筆退款被作廢 ⇒ 錢沒有真的離開 ⇒ 不算退款活動。
    -- 🔴🔴 **[2026-09-05 改成 EXISTS, 不再加總金額]**
    --    ⛔ ~~原本 `SELECT coalesce(sum(m.refund_amount), 0) INTO v_manual`~~ **作廢**。
    --    🔬 成因:`packages/domain/src/order/refund-remaining-single-source.test.ts`
    --      (⟦#473b-1⟧「已退/還能退」單一來源守門)判本檔紅 —— 逐字
    --      「如果它自己算『已退 / 還能退』, 那就是要防的繞路」。
    --    ✅ **而它抓對了一半:我確實在 SUM 退款金額** —— 🔵 **而那個和從來沒有被當成金額用**:
    --      剝註解後全檔 `v_manual` 只出現在 ①宣告 ②這一句 ③`> 0` ④一行 log。
    --    🎯 **⇒ 我要的一直是「有沒有」, 而我寫成了「多少」** ——
    --      ⇒ 📌 **多算出來的那個數字沒有用途, 而它讓一道正確的守門對我叫。**
    --      ⇒ ⇒ 🔴 **正確的修法不是去 allowlist 開一個例外, 是【不要算那個和】。**
    --        (開例外要寫 why 且要有人審 ⇒ 那是把一個我造出來的問題轉成別人的閱讀成本。)
    --    🔵 語意零改變:`sum(...) > 0` 與 `EXISTS` 在 `refund_amount > 0` 這個 CHECK 下等價
    --      —— 🔬 `20260820010000` 建表逐字 `refund_amount integer NOT NULL CHECK (refund_amount > 0)`
    --      ⇒ 不可能有 0 或負數列讓兩者分岔。
    IF EXISTS (
      SELECT 1 FROM public.order_manual_refunds m
       WHERE m.order_id = p_order_id
         AND m.voided_at IS NULL
    ) THEN
      RAISE LOG '[pcm_noncard_settle] order=% 有未作廢的人工退款 ⇒ 交還退款管線, 本片不寫',
                p_order_id;
      RETURN;
    END IF;

    v_res     := public.admin_compute_order_settlement(p_order_id);
    v_verdict := v_res ->> 'verdict';

    SELECT coalesce(pg_catalog.sum(p.amount), 0) INTO v_received
      FROM public.order_payments p
     WHERE p.order_id = p_order_id;

    -- 🔬 verdict 四個值域逐字取自 20260901030000_m4b_zero_total_settle.sql
    --    (該檔 OP6a 段 grep ⇒ settled 1 / underpaid 1 / overpaid 1 / needs_human 2;
    --     負對照一個不存在的 verdict ⇒ 0)。
    IF v_verdict = 'settled' THEN
      v_new := 'paid'::public.payment_status;

    ELSIF v_verdict = 'underpaid' THEN
      -- 收了一部分 ⇒ partiallyPaid;一毛都沒收(或被沖銷光)⇒ 回到 unpaid
      IF v_received > 0 THEN
        v_new := 'partiallyPaid'::public.payment_status;
      ELSE
        v_new := 'unpaid'::public.payment_status;
      END IF;

    ELSE
      -- 🔴 `overpaid` 與 `needs_human` 一律【不翻】。
      --    overpaid:payment_status 的值域裡**沒有**對應的值(unpaid / paid / partiallyPaid /
      --      refunded / partiallyRefunded 共 5 個)⇒ 開一列給人看, 不猜一個最接近的。
      --    needs_human:它自己宣告算不清 ⇒ 不該由它決定終態。
      -- 🛑 而「不翻是安全的」這句話**依賴 `20260904230000` 第 4 節那條 cron 腿**(R3 nit ②:
      --    這段是從那支檔【逐字搬過來】的, 而「本檔」兩個字跟著搬 ⇒ 在這裡指到了錯的檔。
      --    📌 **自指座標會在搬家的那一刻靜靜地指錯, 而它讀起來完全正常。**)—— 沒有它, 這兩種單
      --    仍然是 unpaid ⇒ 隔天照樣被取消 ⇒ 缺陷的形狀與今天一模一樣, 只是變窄。
      --    ⇒ 📌 **兩段必須同一支 migration**, 不可以拆開先上一半。
      RAISE LOG '[pcm_noncard_settle] order=% verdict=% ⇒ 不翻狀態(值域無對應值或算不清)',
                p_order_id, v_verdict;
      RETURN;
    END IF;

    -- 🔴🔴 條件式 UPDATE 取代 `SELECT … FOR UPDATE`(v4 §4 對 v2 的更正)。
    --    v2 一開頭就 `FOR UPDATE` 那一列, 而本函式是**在 order_payments 的 INSERT 之後**跑的
    --    ⇒ 那筆 INSERT 的 FK 已經在同一列上拿了 KEY SHARE ⇒ FOR UPDATE 是**鎖升級**
    --    ⇒ 兩筆收款同時進來時互等 ⇒ 死結。
    -- ✅ 改法:把「我讀到的狀態」寫進 WHERE ⇒ 別人先改過就 0 列, 我不覆蓋他。
    --    這是樂觀鎖, 不是少了一道保護 —— 而它會少寫的那一次, 正是該少寫的那一次。
    IF v_new IS DISTINCT FROM v_status THEN
      UPDATE public.orders o
         SET payment_status = v_new,
             -- 🔴🔴 **翻成 paid 必須同時填 `paid_at`**(codex R1 must-fix, :204)。
             --    🔬 全 repo 6 處 `paid_at = pg_catalog.now()` —— **全在卡片那條路**
             --      (最早 `20260611120000_m3_s2c_confirm_payment_rpc.sql:180`)。
             --    🔬 而 `20260831030000_m4b_e4_order_created_gap_counts.sql:134` 逐字:
             --      「述詞與 SupabasePaidOrderScannerAdapter 對齊:paid + cancelled_at IS NULL
             --       + **paid_at/created_at 皆 >= cutoff**」
             --    ⇒ 🎯 **只翻 payment_status 不填 paid_at ⇒ 匯款單結清成功, 而付款信永遠不寄**
             --       —— 它在掃描器眼裡不存在。而**沒有任何東西會叫**。
             --    🔵 `coalesce` 而非直接覆寫:同一張單若已經有付款時刻, 不得被後到的重算改掉
             --      (雙扣偵測 `20260701130000:98` 用 `paid_at IS NOT NULL` 配對, 時刻被動會誤判)。
             --    🔵 非 paid 的分支一個字都不碰它 —— 本片不負責把 paid_at 清掉。
             paid_at        = CASE WHEN v_new = 'paid'::public.payment_status
                                   THEN coalesce(o.paid_at, pg_catalog.now())
                                   ELSE o.paid_at END,
             updated_at     = pg_catalog.now()
       WHERE o.id             = p_order_id
         AND o.payment_status = v_status;   -- 🔴 樂觀鎖:狀態被別人改過就不寫
      GET DIAGNOSTICS v_hit = ROW_COUNT;

      IF v_hit = 0 THEN
        RAISE LOG '[pcm_noncard_settle] order=% 狀態在重算期間被別人改掉 ⇒ 本次不寫(讀到 %)',
                  p_order_id, v_status;
      ELSE
        RAISE LOG '[pcm_noncard_settle] order=% % -> % (verdict=% received=%)',
                  p_order_id, v_status, v_new, v_verdict, v_received;
      END IF;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    RAISE LOG '[pcm_noncard_settle] order=% 重算失敗(%), 收款事實保留、狀態不動',
              p_order_id, SQLERRM;
    -- 🔴🔴 **20260916060000(P1-6)加的唯一一段** —— 吞錯照舊(不吞就回滾客人那筆收款), 另寫一筆事故讓人看得見。
    --   形狀照上面 pending_refund_open_failed 那段:先抓 SQLERRM、自己包一層 BEGIN…EXCEPTION。
    --   去重:排程會對同一張單重算多次 ⇒ 同單同 kind 未解決就不再寫。
    --   ⚠️ resolved_at 全 repo 沒有寫入端 ⇒ 一張單這個 kind 永遠 1 列, 排程後來修好了事故仍掛著(plan 4-B, 寫明不修)。
    --   ⚠️ 兩個交易同時對同一張單吞錯 ⇒ 兩邊的 NOT EXISTS 都看不到對方 ⇒ 可能多寫 1 列(只多算, 不漏)。
    DECLARE
      v_err text := SQLERRM;
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.pcm_incident i
                      WHERE i.kind = 'settle_recompute_failed'
                        AND i.subject_id = p_order_id
                        AND i.resolved_at IS NULL) THEN
        PERFORM public.pcm_incident_log('settle_recompute_failed', p_order_id, v_err);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG '[pcm_incident] 連留痕都失敗 order=% 原錯=% 留痕錯=%',
                p_order_id, v_err, SQLERRM;
    END;
  END;
END
$fn$;

-- ── 4-C 重試排程 ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pcm_settle_retry_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $sweep$
DECLARE
  -- 🔴 上限 5 次是推的、沒有人拍過(理由見 20260905220000:79-84):暫時的成因 5 × 10 分鐘內會好,資料本身的問題試再多次也一樣。
  c_max_attempts constant integer := 5;
  r              record;
  v_fixed        integer := 0;
  v_after        public.payment_status;
  v_verdict      text;
  v_expect       public.payment_status;
  v_err          text;
  v_prev         timestamptz;
  v_new          timestamptz;
BEGIN
  FOR r IN
    -- 🔴 P1-6 ②:候選只收「狀態真的該變」的單,只用純算術 + 排除未作廢人工退款(重算對那種單直接 RETURN)。
    --    · unpaid 且淨額 > 0:OP6a 判 settled ⇒ 該變 paid;判 underpaid ⇒ 該變 partiallyPaid。
    --    · partiallyPaid 且淨額 >= total:可能已補足。
    --    ⇒ 正常訂金單(partiallyPaid 且淨額 < total)不進候選、不會被試、不會蓋章(舊版會, M1)。
    --    🔵 不會漏(R2 N1):OP6a gross = 收款加總、receivable = total、net = gross − total ⇒「淨額 >= total」恰等於 settled / overpaid。
    --    ⚠️ OP6a【不讀】order_manual_refunds(實測:有未作廢人工退款的單照判 settled)⇒ 人工退款單要在這裡另外排除(下面 NOT EXISTS)。
    -- 🔵 P1-6 ①:現金一起救(2026-09-15 拋棄式 PG 驗過 OP6a 對現金單判得對)。
    -- ponytail: 判 overpaid / needs_human 的單在迴圈裡跳過又不記次數,會一直佔 LIMIT 50 的名額(既有,R2 N5);
    --    同時卡住 > 50 張跳過單時後面的單要等人工處理。升級路徑:跳過單記一個 skipped_until 冷卻欄。
    -- 🔵 verdict 不在這裡算(舊版在外層 WHERE)⇒ 一張單讓 OP6a 丟錯不再拖垮整輪(M5)。
    SELECT o.id
      FROM public.orders o
      LEFT JOIN public.pcm_settle_retry_attempts a ON a.order_id = o.id
      CROSS JOIN LATERAL (
        SELECT coalesce(pg_catalog.sum(p.amount), 0) AS received
          FROM public.order_payments p WHERE p.order_id = o.id
      ) pay
     WHERE o.payment_channel IN ('bank_transfer', 'cash')
       AND o.cancelled_at IS NULL
       AND ((o.payment_status = 'unpaid'::public.payment_status AND pay.received > 0)
         OR (o.payment_status = 'partiallyPaid'::public.payment_status AND pay.received >= o.total))
       AND NOT EXISTS (SELECT 1 FROM public.order_manual_refunds m
                        WHERE m.order_id = o.id AND m.voided_at IS NULL)
       -- 放棄 24 小時後再給一次機會(20260905220000:113-117)。
       AND (a.order_id IS NULL
            OR (a.gave_up_at IS NULL AND a.attempts < c_max_attempts)
            OR a.gave_up_at < pg_catalog.clock_timestamp() - interval '24 hours')
     ORDER BY o.created_at
     LIMIT 50
  LOOP
    v_err  := NULL;
    v_prev := NULL;
    v_new  := NULL;
    BEGIN
      -- P1-6 ⑥:先記下「這次之前有沒有章」,upsert 後比對 ⇒ 只在蓋上新章那一刻寫事故。
      SELECT t.gave_up_at INTO v_prev
        FROM public.pcm_settle_retry_attempts t
       WHERE t.order_id = r.id
         FOR UPDATE;

      v_verdict := public.pcm_settle_verdict_safe(r.id);

      IF v_verdict = 'error' THEN
        v_err := 'verdict 計算失敗(詳情看 Postgres log 的 [pcm_settle_verdict_safe])';
      ELSIF v_verdict IN ('settled', 'underpaid') THEN
        -- underpaid 只會出現在 unpaid 且淨額 > 0 的候選 ⇒ 重算會寫 partiallyPaid。
        v_expect := CASE WHEN v_verdict = 'settled' THEN 'paid'::public.payment_status
                         ELSE 'partiallyPaid'::public.payment_status END;

        PERFORM public.pcm_noncard_settle_recompute(r.id);

        -- 🔴 量【結果】不量【有沒有例外】:重算自己吞錯、失敗時正常返回(20260905220000:134-141)。
        -- 🔴 P1-6 ④:成功 = 重算後狀態【等於期望】(舊版只認 paid ⇒ 訂金單被當成修不好)。
        SELECT o.payment_status INTO v_after FROM public.orders o WHERE o.id = r.id;
        IF v_after = v_expect THEN
          v_fixed := v_fixed + 1;
          -- 🔴 P1-6 ⑤ / R2 S1:成功歸零、拿掉章 ⇒ 之後補尾款再壞時要能重新被試。
          INSERT INTO public.pcm_settle_retry_attempts AS t (order_id, attempts, last_attempt_at, last_error)
          VALUES (r.id, 0, pg_catalog.clock_timestamp(), NULL)
          ON CONFLICT (order_id) DO UPDATE
            SET attempts        = 0,
                last_attempt_at = pg_catalog.clock_timestamp(),
                last_error      = NULL,
                gave_up_at      = NULL;
        ELSE
          v_err := '重算後狀態仍非期望(期望 ' || v_expect::text || '、實得 ' || coalesce(v_after::text, 'NULL')
                   || ';內層吞了例外, 詳情看 Postgres log 的 [pcm_noncard_settle])';
        END IF;
      END IF;
      -- 其他 verdict(overpaid / needs_human / NULL)⇒ 跳過、不記次數。
    -- 🔴 query_canceled 具名接:記 log 後往上拋(一輪逾時 = 預算用完;attempts 跟著整輪回捲,既有)。
    EXCEPTION WHEN query_canceled THEN
      RAISE LOG '[pcm_settle_retry_sweep] order=% 逾時(57014)⇒ 本輪中止', r.id;
      RAISE;
    WHEN OTHERS THEN
      -- 一張單失敗不得讓整輪停下來。
      v_err := '重算丟錯:' || left(SQLERRM, 480);
      RAISE LOG '[pcm_settle_retry_sweep] order=% 重算再次失敗:%', r.id, SQLERRM;
    END;

    IF v_err IS NOT NULL THEN
      -- 🔴 P1-6 ⑤ / R2 S2:三條失敗路徑同一個寫法。重開(舊列有章 ⇒ 候選條件已保證它 > 24 小時)從 1 重數;
      --    ON CONFLICT 的 SET 右邊讀的全是舊列 ⇒ attempts 與 gave_up_at 兩個式子用同一個判準。不另比 now()。
      INSERT INTO public.pcm_settle_retry_attempts AS t (order_id, attempts, last_attempt_at, last_error)
      VALUES (r.id, 1, pg_catalog.clock_timestamp(), v_err)
      ON CONFLICT (order_id) DO UPDATE
        SET attempts        = CASE WHEN t.gave_up_at IS NOT NULL THEN 1 ELSE t.attempts + 1 END,
            last_attempt_at = pg_catalog.clock_timestamp(),
            last_error      = excluded.last_error,
            gave_up_at      = CASE WHEN (CASE WHEN t.gave_up_at IS NOT NULL THEN 1 ELSE t.attempts + 1 END) >= c_max_attempts
                                   THEN pg_catalog.clock_timestamp() ELSE NULL END
      RETURNING gave_up_at INTO v_new;

      -- 🔴 P1-6 ⑥(Sean 拍乙):這一次 upsert 蓋了一個新章 ⇒ 寫事故。
      --    放棄數是【此刻】快照(24 小時重開會拿掉章);事故留下【曾經放棄過】的紀錄。
      --    同單未解決不重寫;resolved_at 沒有寫入端(plan 事實 #20)⇒ 實際一張單這個 kind 永遠 1 列。
      IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_prev THEN
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM public.pcm_incident i
                          WHERE i.kind = 'settle_retry_gave_up'
                            AND i.subject_id = r.id
                            AND i.resolved_at IS NULL) THEN
            PERFORM public.pcm_incident_log('settle_retry_gave_up', r.id, v_err);
          END IF;
        EXCEPTION WHEN OTHERS THEN
          -- 寫不進去只留 log,不影響排程本身。
          RAISE LOG '[pcm_incident] 連留痕都失敗 order=% 原錯=% 留痕錯=%', r.id, v_err, SQLERRM;
        END;
      END IF;
    END IF;
  END LOOP;

  -- ── 心跳(一字未改,理由見 20260905220000:189-198)──────────────────
  BEGIN
    INSERT INTO public.sweeper_heartbeat (job_name, last_success_at, consecutive_failures, updated_at)
    VALUES ('pcm-settle-retry', pg_catalog.clock_timestamp(), 0, pg_catalog.clock_timestamp())
    ON CONFLICT (job_name) DO UPDATE
      SET last_success_at      = GREATEST(public.sweeper_heartbeat.last_success_at, excluded.last_success_at),
          consecutive_failures = 0,
          updated_at           = GREATEST(public.sweeper_heartbeat.updated_at, excluded.updated_at);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[pcm_settle_retry_sweep] 心跳寫入失敗(本輪重算不受影響):%', SQLERRM;
  END;

  RETURN v_fixed;
END;
$sweep$;

-- ── 4-D 健康檢查 ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_stuck_bank_orders_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_cnt        integer := 0;     -- 世界 A:匯款、仍 unpaid、OP6a 判 overpaid / needs_human
  v_first      timestamptz;
  v_cnt_op     integer := 0;     -- 世界 B:匯款、已付款 / 部分付款而多收
  v_first_op   timestamptz;
  v_bank_c     integer := 0;     -- 世界 C(P1-6):錢收足、狀態未付 —— 匯款
  v_bank_c_1st timestamptz;
  v_cash_c     integer := 0;     -- 世界 C(P1-6):錢收足、狀態未付 —— 現金
  v_cash_c_1st timestamptz;
  v_err_cnt    integer := 0;     -- OP6a 丟錯的張數(舊版一張丟錯整支讀不到)
BEGIN
  -- 🔴 A / B 世界一字不改地只看 bank_transfer(20260905060000:95-107:信裡寫「請匯款 + 銀行帳號」,現金客人看不到)。
  --    C 世界匯款 / 現金分兩組鍵,文案由 TS 各寫各的。
  -- 🔵 A / B / C 共用同一個 judged(每張單最多算一次 OP6a),以旗標分世界,不重複數。
  WITH candidate AS (
    SELECT o.id, o.created_at, o.payment_status, o.total, o.payment_channel,
           (SELECT coalesce(pg_catalog.sum(p.amount), 0)
              FROM public.order_payments p WHERE p.order_id = o.id) AS received,
           EXISTS (SELECT 1 FROM public.order_manual_refunds m
                    WHERE m.order_id = o.id AND m.voided_at IS NULL) AS has_manual_refund
      FROM public.orders o
     WHERE o.payment_channel IN ('bank_transfer', 'cash')
       AND o.cancelled_at IS NULL
       AND o.payment_status = ANY (
             ARRAY['unpaid', 'paid', 'partiallyPaid']::public.payment_status[])
  ),
  prefiltered AS (
    SELECT c.*,
           -- A / B 預篩(20260905060000:111-114 原式,加上管道 = bank_transfer)
           (c.payment_channel = 'bank_transfer'
             AND ((c.payment_status = 'unpaid'::public.payment_status AND c.received > 0)
               OR (c.payment_status <> 'unpaid'::public.payment_status AND c.received > c.total))) AS in_ab,
           -- C 預篩:未付 / 部分付款、淨額 > 0(排除 0 元單)、淨額 >= total、無未作廢人工退款
           (c.payment_status = ANY (ARRAY['unpaid', 'partiallyPaid']::public.payment_status[])
             AND c.received > 0
             AND c.received >= c.total
             AND NOT c.has_manual_refund) AS in_c
      FROM candidate c
  ),
  judged AS (
    SELECT c.id, c.created_at, c.payment_status, c.payment_channel, c.in_ab, c.in_c,
           public.pcm_settle_verdict_safe(c.id) AS verdict
      FROM prefiltered c
     WHERE c.in_ab OR c.in_c
  )
  SELECT
    count(*) FILTER (
      WHERE in_ab AND verdict IN ('overpaid', 'needs_human')
        AND payment_status = 'unpaid'::public.payment_status)::integer,
    min(created_at) FILTER (
      WHERE in_ab AND verdict IN ('overpaid', 'needs_human')
        AND payment_status = 'unpaid'::public.payment_status),
    count(*) FILTER (
      WHERE in_ab AND verdict IN ('overpaid', 'needs_human')
        AND payment_status <> 'unpaid'::public.payment_status)::integer,
    min(created_at) FILTER (
      WHERE in_ab AND verdict IN ('overpaid', 'needs_human')
        AND payment_status <> 'unpaid'::public.payment_status),
    count(*) FILTER (WHERE in_c AND verdict = 'settled' AND payment_channel = 'bank_transfer')::integer,
    min(created_at) FILTER (WHERE in_c AND verdict = 'settled' AND payment_channel = 'bank_transfer'),
    count(*) FILTER (WHERE in_c AND verdict = 'settled' AND payment_channel = 'cash')::integer,
    min(created_at) FILTER (WHERE in_c AND verdict = 'settled' AND payment_channel = 'cash'),
    count(*) FILTER (WHERE verdict = 'error')::integer
    INTO v_cnt, v_first, v_cnt_op, v_first_op,
         v_bank_c, v_bank_c_1st, v_cash_c, v_cash_c_1st, v_err_cnt
    FROM judged;

  RETURN pg_catalog.jsonb_build_object(
    'stuck_count',    v_cnt,
    'oldest_created', v_first,
    'overpaid_count',   v_cnt_op,
    'overpaid_oldest',  v_first_op,
    -- P1-6 新鍵:TS 以選讀接(缺鍵 = 讀不到,不丟錯;R2 S5)。
    'unpaid_settled_bank_count',  v_bank_c,
    'unpaid_settled_bank_oldest', v_bank_c_1st,
    'unpaid_settled_cash_count',  v_cash_c,
    'unpaid_settled_cash_oldest', v_cash_c_1st,
    'judge_error_count',          v_err_cnt,
    'measured',       true
  );
END
$fn$;

CREATE OR REPLACE FUNCTION public.get_settle_retry_gaveup_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    -- 🔵 每個 key 獨佔一行、逗號結尾(anomaly-alert-key-contract.test.ts 用 ^\s*'key',\s*$ 抽 key)。
    -- 🔴 R2 S3:attempts 表沒有管道欄 ⇒ JOIN orders。舊三鍵只數匯款 ⇒ DB 先上、TS 還沒上的空窗裡,
    --    舊信件段「N 張匯款單…已經匯了錢」仍然正確,不會把現金單寫成匯款單。
    --    join 不到 orders 的列(訂單被刪)兩邊都不算(R2 N6)⇒ 匯款 + 現金可能 < 全部放棄列數。
    'gave_up_count',
    (SELECT pg_catalog.count(*) FROM public.pcm_settle_retry_attempts a
       JOIN public.orders o ON o.id = a.order_id
      WHERE a.gave_up_at IS NOT NULL AND o.payment_channel = 'bank_transfer'),
    'oldest_gave_up',
    (SELECT pg_catalog.min(a.gave_up_at) FROM public.pcm_settle_retry_attempts a
       JOIN public.orders o ON o.id = a.order_id
      WHERE a.gave_up_at IS NOT NULL AND o.payment_channel = 'bank_transfer'),
    'sample_order_ids',
    (SELECT COALESCE(pg_catalog.jsonb_agg(x.order_id), '[]'::jsonb)
       FROM (SELECT a.order_id FROM public.pcm_settle_retry_attempts a
               JOIN public.orders o ON o.id = a.order_id
              WHERE a.gave_up_at IS NOT NULL AND o.payment_channel = 'bank_transfer'
              ORDER BY a.gave_up_at LIMIT 5) x),
    'gave_up_cash_count',
    (SELECT pg_catalog.count(*) FROM public.pcm_settle_retry_attempts a
       JOIN public.orders o ON o.id = a.order_id
      WHERE a.gave_up_at IS NOT NULL AND o.payment_channel = 'cash'),
    'oldest_gave_up_cash',
    (SELECT pg_catalog.min(a.gave_up_at) FROM public.pcm_settle_retry_attempts a
       JOIN public.orders o ON o.id = a.order_id
      WHERE a.gave_up_at IS NOT NULL AND o.payment_channel = 'cash'),
    'sample_cash_order_ids',
    (SELECT COALESCE(pg_catalog.jsonb_agg(x.order_id), '[]'::jsonb)
       FROM (SELECT a.order_id FROM public.pcm_settle_retry_attempts a
               JOIN public.orders o ON o.id = a.order_id
              WHERE a.gave_up_at IS NOT NULL AND o.payment_channel = 'cash'
              ORDER BY a.gave_up_at LIMIT 5) x),
    'tracked_total',
    -- 分母:全表列數(語意不變)。
    (SELECT pg_catalog.count(*) FROM public.pcm_settle_retry_attempts)
  );
$fn$;

-- ── 事後閘(只看 catalog)────────────────────────────────────────────
DO $post$
DECLARE
  -- 收權斷言清單(靜態閘 ③ 數的就是這個陣列;可授權物件 1 = pcm_settle_verdict_safe,零 GRANT)
  v_functions text[] := ARRAY[
    'public.pcm_settle_verdict_safe(uuid)'
  ]::text[];
  r      text;
  v_oid  regprocedure;
  v_leak integer;
  f      record;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_oid := pg_catalog.to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '事後閘:% 不存在', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('payment_confirmer', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘:% 對 anon / authenticated / service_role / payment_confirmer 開著 EXECUTE(應零 GRANT)', r;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pcm_readonly')
       AND pg_catalog.has_function_privilege('pcm_readonly', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘:% 對 pcm_readonly 開著 EXECUTE', r;
    END IF;
    -- docs/patterns/revoking-function-execute-in-supabase.md §3.5:anon 切得過去、且可執行的角色要零列
    SELECT pg_catalog.count(*) INTO v_leak
      FROM pg_catalog.pg_roles ro
     WHERE pg_catalog.pg_has_role('anon', ro.oid, 'SET')
       AND pg_catalog.has_function_privilege(ro.oid, v_oid, 'EXECUTE');
    IF v_leak <> 0 THEN
      RAISE EXCEPTION '事後閘:% 有 % 個 anon 切得過去的角色可執行(SET ROLE 繞路)', r, v_leak;
    END IF;
  END LOOP;

  FOR f IN
    SELECT * FROM (VALUES
      ('public.pcm_settle_verdict_safe(uuid)',        '{postgres=X/postgres}',                                                    'error'),
      ('public.pcm_noncard_settle_recompute(uuid)',   '{postgres=X/postgres}',                                                    'settle_recompute_failed'),
      ('public.pcm_settle_retry_sweep()',             '{postgres=X/postgres}',                                                    'settle_retry_gave_up'),
      ('public.get_stuck_bank_orders_health()',       '{postgres=X/postgres,service_role=X/postgres,payment_confirmer=X/postgres}', 'unpaid_settled_cash_count'),
      ('public.get_settle_retry_gaveup_health()',     '{postgres=X/postgres,service_role=X/postgres,payment_confirmer=X/postgres}', 'gave_up_cash_count')
    ) AS t(sig, acl, marker)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure(f.sig)
         AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
         AND p.prosecdef
         AND p.proconfig = ARRAY['search_path=""']
         AND p.proacl::text = f.acl
         AND pg_catalog.strpos(p.prosrc, f.marker) > 0
    ) THEN
      RAISE EXCEPTION '事後閘:% 不符(owner postgres / definer / search_path 空 / ACL % / 本體含 %)', f.sig, f.acl, f.marker;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_settle_verdict_safe(uuid)')
                    AND p.provolatile = 's') THEN
    RAISE EXCEPTION '事後閘:pcm_settle_verdict_safe 不是 STABLE';
  END IF;

  IF pg_catalog.strpos((SELECT pg_catalog.pg_get_constraintdef(c.oid) FROM pg_catalog.pg_constraint c
                         WHERE c.conrelid = 'public.pcm_incident'::regclass AND c.conname = 'pcm_incident_kind_check'),
                       'settle_recompute_failed') = 0 THEN
    RAISE EXCEPTION '事後閘:CHECK 沒有 settle_recompute_failed';
  END IF;
END
$post$;

COMMIT;
