-- 20260916060000-rollback.sql
-- 退 P1-6(supabase/migrations/20260916060000_m4b_p16_settle_recompute_failure_visibility.sql)。plan §6。
--
-- 🔴 四支函式本體由程式從【正式庫 2026-09-15 prosrc】逐字產生(= 本片之前那一代);前置閘釘本片 md5,事後閘驗 md5 回到舊的。
--    CREATE OR REPLACE 保留 owner / ACL ⇒ 不重下 REVOKE / GRANT;事後閘逐角色核。
-- 🔴 順序:先鎖 pcm_incident(R2 N4;鎖級見下)⇒ 函式先退(新函式寫事故撞舊 CHECK 會被巢狀 handler 吞掉)⇒ DROP safe ⇒ 最後才看 CHECK。
-- 🔴 CHECK:已有 settle_recompute_failed / settle_retry_gave_up 列 ⇒ 保留八種(舊函式不會再寫新值;本片前置閘接受八種、可重貼), 印列數;
--    兩種都沒有才縮回六種。⚠️ CHECK 保留八種時, KNOWN_INCIDENT_KINDS 與後台標籤表的兩個字也不要退(兩把尺會紅)。
-- 🔴 不會被撤銷的事實:期間寫下的事故列(證據, 不刪)、pcm_settle_retry_attempts 的次數與章、期間被修好的訂單狀態。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- 一開始就拿 ACCESS EXCLUSIVE(R2 N4 的 SHARE ROW EXCLUSIVE 到 ALTER CHECK 時要升級 ⇒ 可能與寫事故的交易互等;adversarial-reviewer R1 N3)。
LOCK TABLE public.pcm_incident IN ACCESS EXCLUSIVE MODE;

DO $pre$
BEGIN
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_noncard_settle_recompute(uuid)')) IS DISTINCT FROM 'b9878df98a4000844024aedfb8b907c1'
     OR (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.pcm_settle_retry_sweep()')) IS DISTINCT FROM '92eb9d8c534804dc74776b9dbad5adb0'
     OR (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.get_stuck_bank_orders_health()')) IS DISTINCT FROM '6bdb0234558951d6886567553d2c758a'
     OR (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.get_settle_retry_gaveup_health()')) IS DISTINCT FROM '77690bb08e3aea51714ec53251ca296c' THEN
    RAISE EXCEPTION '前置閘:四支函式不全是 20260916060000 那一代(md5 對不上)⇒ 沒貼過、已退過、或有人改過, 停下';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_settle_verdict_safe(uuid)') IS NULL THEN
    RAISE EXCEPTION '前置閘:pcm_settle_verdict_safe(uuid) 不存在 ⇒ 沒貼過或已退過';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.pcm_noncard_settle_recompute(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $rb$
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
  END;
END
$rb$;

CREATE OR REPLACE FUNCTION public.pcm_settle_retry_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $rb$
DECLARE
  -- 🔴 **上限 5 次是【推的, 沒有人拍過】** —— 而它的理由要寫下來:
  --    重算失敗的成因若是暫時的(鎖競爭 / 逾時), 五次 × 10 分鐘 ≈ 50 分鐘內會好;
  --    若是資料本身的問題(例:金額對不起來), 試五萬次也一樣。
  --    ⇒ 五次之後停下來, 讓它變成一個【需要人】的東西, 而不是一個每天炸 144 次 log 的東西。
  --    ⚠️ 而「50 分鐘」這個數字沒有被驗過 —— 它是 5 × 排程週期, 排程週期改了它就變。
  c_max_attempts constant integer := 5;
  r              record;
  v_fixed        integer := 0;
  v_after        public.payment_status;
BEGIN
  FOR r IN
    -- 🔴 **`admin_compute_order_settlement` 一定要在【便宜條件收窄之後】才呼叫**(codex R2):
    --    把它寫在同一層 WHERE 裡, planner 可以先對【所有通過前四條件的候選】逐列呼叫它,
    --    然後才 LIMIT ⇒ backlog 一大就整輪逾時, **一張都進不了迴圈**。
    --    ✅ 改成兩層:內層只用便宜條件 + LIMIT, 外層才算 verdict。
    SELECT c.id
      FROM (
        SELECT o.id
          FROM public.orders o
          LEFT JOIN public.pcm_settle_retry_attempts a ON a.order_id = o.id
         WHERE o.payment_channel = 'bank_transfer'
       AND o.cancelled_at IS NULL
       -- 🔴🔴 **不是只有 `unpaid`**(codex R2 must-fix;而我 R1 時複驗錯了):
       --    我用 `git grep` 掃 **TS 檔**得到「值域只有 unpaid/paid/refunded」⇒ 判 codex 那條不成立。
       --    ✅ 而**對正式庫唯讀量一次** ⇒ `unpaid, paid, partiallyPaid, refunded, partiallyRefunded`(5 個)。
       --    📌 **我那把尺的分母裡沒有 SQL** —— enum 定義在 `20260604120000`, 不在任何 .ts 裡。
       --    🛑 而漏掉 `partiallyPaid` 的後果:第一次短匯 ⇒ 狀態變 partiallyPaid;
       --       客人補尾款時重算失敗 ⇒ **這支永遠撈不到它**, 而客人那一頁照樣印「請匯款」。
       AND o.payment_status IN ('unpaid'::public.payment_status,
                                'partiallyPaid'::public.payment_status)
       -- 收過錢(淨額 > 0)—— 沒收到錢的單「停在 unpaid」是【對的】, 不是缺陷。
       AND (SELECT coalesce(sum(p.amount), 0) FROM public.order_payments p
             WHERE p.order_id = o.id) > 0
       -- 🔴 **放棄不是永久的**(codex R2:我第一版把清除放在成功分支裡, 而那個分支要先被撈到
       --    才會執行 ⇒ **死結**, 實測確認撈不回來)。
       --    ✅ 改成【放棄 24 小時後再給一次機會】:成因若是暫時的(那支函式被修好了、
       --       鎖散了), 它會自己回來;而它仍然壞的話, 一天最多再吵 c_max_attempts 次。
       --    🛑 而這**不取代**那張「沒有人在看放棄清單」的板列 —— 它只是不把門焊死。
       AND (a.order_id IS NULL
            OR (a.gave_up_at IS NULL AND a.attempts < c_max_attempts)
            OR a.gave_up_at < pg_catalog.clock_timestamp() - interval '24 hours')
     ORDER BY o.created_at
     LIMIT 50
     -- 🔵 一輪最多 50 張:一支跑很久的 cron 會與下一輪自己重疊。
     -- 🔴 **而 `LIMIT 50` 不保證只呼叫 50 次 `admin_compute_order_settlement`**(codex R1):
     --    那支函式在 `WHERE` 裡, 而 planner 可能對【所有通過前四個條件的候選】逐列呼叫它,
     --    然後才取前 50 ⇒ backlog 很大時這一輪會很久, 而久到 statement_timeout 就整批回滾。
     --    ✅ 前四個條件把候選壓得很小(匯款 + 未取消 + unpaid + 收過錢), 而**那是今天的形狀**,
     --       不是保證。🛑 **沒有修** —— 要修得先量真實 backlog 有多大, 而那個數字今天量不到
     --       (`orders` 全表 1 張)。⇒ 上線後第一週要看的第二格就是這個。
      ) c
      -- 🔴 verdict 在【外層】:內層已經 LIMIT 過 ⇒ 這支昂貴的 SECURITY DEFINER 函式
      --    最多被呼叫 50 次, 而不是「所有候選都算一遍再取 50」。
      WHERE (public.admin_compute_order_settlement(c.id) ->> 'verdict')
            IN ('settled', 'underpaid')
  LOOP
    BEGIN
      PERFORM public.pcm_noncard_settle_recompute(r.id);

      -- 🔴🔴 **不能拿「沒有拋例外」當成功**(codex 2026-09-05 R1 must-fix, 我第一版就是這樣寫的):
      --    `pcm_noncard_settle_recompute` 自己有一段 `EXCEPTION WHEN OTHERS THEN RAISE LOG …`
      --    (`20260904230000:339-342`)⇒ **它失敗的時候【正常返回】**。
      --    ⇒ 我下面那個 EXCEPTION 幾乎永遠不會被觸發 ⇒ `v_fixed` 會把失敗算成成功、
      --      `last_error` 永遠是 NULL、而五次「成功」之後那張仍然壞掉的單被蓋上 gave_up。
      --    📌 **⇒ 量【結果】不量【有沒有例外】** —— 重算完再讀一次那張單的狀態。
      --    🛑 而這正是本片要修的那個病的形狀:一個被吞掉的例外, 讓下游以為事情做完了。
      SELECT o.payment_status INTO v_after FROM public.orders o WHERE o.id = r.id;
      -- 🔴 **只有【明確變成 paid】才算修好**(codex R2):
      --    第一版寫 `IS DISTINCT FROM 'unpaid'` ⇒ ① 單被刪掉 ⇒ `v_after` 是 NULL ⇒ **也算成功**
      --    ② 另一個交易同時把它改成 refunded ⇒ **也算成功**。
      --    📌 **「不是那個壞值」與「是那個好值」是兩個宣稱** —— 而前者把所有沒想到的世界都算成好的。
      IF v_after = 'paid'::public.payment_status THEN
        v_fixed := v_fixed + 1;
        INSERT INTO public.pcm_settle_retry_attempts AS t (order_id, attempts, last_attempt_at, last_error)
        VALUES (r.id, 1, pg_catalog.clock_timestamp(), NULL)
        ON CONFLICT (order_id) DO UPDATE
          SET attempts = t.attempts + 1,
              last_attempt_at = pg_catalog.clock_timestamp(),
              last_error = NULL,
              gave_up_at = NULL;   -- 🔵 修好了就把放棄章拿掉(它可能是上一輪蓋的)
      ELSE
        -- 🔵 沒拋例外而狀態沒動 ⇒ **那就是失敗**, 而錯誤內容在 Postgres log 裡(內層 RAISE LOG)。
        INSERT INTO public.pcm_settle_retry_attempts AS t (order_id, attempts, last_attempt_at, last_error)
        VALUES (r.id, 1, pg_catalog.clock_timestamp(),
                '重算後狀態仍是 unpaid(內層吞了例外, 詳情看 Postgres log 的 [pcm_noncard_settle])')
        ON CONFLICT (order_id) DO UPDATE
          SET attempts = t.attempts + 1,
              last_attempt_at = pg_catalog.clock_timestamp(),
              last_error = excluded.last_error,
              gave_up_at = CASE WHEN t.attempts + 1 >= c_max_attempts THEN pg_catalog.clock_timestamp() ELSE NULL END;
      END IF;
    -- 🔴 **`query_canceled`(57014)要【具名】接**(codex R2 打掉我 R1 那句「接不住」)——
    --    `WHEN OTHERS` 確實不含它, 而 `WHEN query_canceled` 含。
    --    ⛔ ~~我 R1 寫「要修它得每張單各自 commit / dblink」~~ —— **那句是錯的。**
    --    ✅ 接住它 ⇒ 記一次失敗 ⇒ **然後往上拋**:一輪逾時代表這一輪的預算用完了,
    --       繼續跑下去只會讓下一張也逾時。而 attempts 那一筆會跟著交易回捲 ——
    --       🛑 **那一格仍然沒解**(整輪回捲), 而現在至少 log 裡會有一行說「是逾時」。
    EXCEPTION WHEN query_canceled THEN
      RAISE LOG '[pcm_settle_retry_sweep] order=% 逾時(57014)⇒ 本輪中止', r.id;
      RAISE;
    WHEN OTHERS THEN
      -- 🔴 **一張單失敗不得讓整輪停下來** —— 否則第一張壞單會擋住它後面所有的單。
      --    而那正是本片要修的那個病的形狀:一個吞掉的例外, 讓後面的事再也不發生。
      INSERT INTO public.pcm_settle_retry_attempts AS t (order_id, attempts, last_attempt_at, last_error)
      VALUES (r.id, 1, pg_catalog.clock_timestamp(), left(SQLERRM, 500))
      ON CONFLICT (order_id) DO UPDATE
        SET attempts = t.attempts + 1,
            last_attempt_at = pg_catalog.clock_timestamp(),
            last_error = left(SQLERRM, 500),
            gave_up_at = CASE WHEN t.attempts + 1 >= c_max_attempts THEN pg_catalog.clock_timestamp() ELSE NULL END;
      RAISE LOG '[pcm_settle_retry_sweep] order=% 重算再次失敗:%', r.id, SQLERRM;
    END;
  END LOOP;

  -- ── 心跳 ──────────────────────────────────────────────────
  -- 🔴 **今天(2026-09-05)我因為漏了這一格弄紅過全隊一次** ——
  --    排了排程而沒有接上監控 ⇒ `cron-heartbeat-read` 那格會叫「有排程沒有人在看它」。
  --    而反過來(在白名單裡而從不寫心跳)⇒ 每天一封「它沒跳」的信。
  -- 🔴 `clock_timestamp()` 不用 `now()`(now() 是交易起始時間 ⇒ 心跳會倒退);
  --    `GREATEST` 擋晚到的舊值覆蓋新值。
  -- ⚠️ 而這個 EXCEPTION **接不住失敗那一側**:純 SQL 跑在 pg_cron 自己的交易裡,
  --    函式拋錯 ⇒ 同交易寫的東西一起回捲 ⇒ 它物理上寫不出失敗心跳
  --    ⇒ 所以 `pcm-settle-retry` 也要進 `FAILURE_COUNT_MEANINGLESS`。
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
$rb$;

CREATE OR REPLACE FUNCTION public.get_stuck_bank_orders_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $rb$
DECLARE
  v_cnt      integer := 0;     -- 世界 A:仍 unpaid(客人的訂單頁還在說「請匯款」)
  v_first    timestamptz;
  v_cnt_op   integer := 0;     -- 世界 B:已付款/部分付款而多收(畫面正常, 而錢多了)
  v_first_op timestamptz;
BEGIN
  -- 🔴 **分母先收窄, 再逐列算 verdict** —— OP6a 是 STABLE 呼叫得動, 而它不便宜。
  --    四個條件全部來自 `20260904230000` 那兩種 verdict 停下來的地方:
  --      ① ⛔ ~~非卡片軌~~ **只有 `bank_transfer`**(codex R1 ② 收窄;現金/none 見下方「證不到什麼」)
  --      ② 未取消
  --      ③ 狀態仍 unpaid —— overpaid / needs_human 就是【停在這裡】的那兩種
  --      ④ 已收淨額 > 0 —— 沒收到錢的單不是本片要找的東西
  --    ⇒ 📌 ④ 同時排掉「客人根本沒匯」那一大類, 那是逾期 cron 的事不是本片的。
  WITH candidate AS (
    SELECT o.id, o.created_at, o.payment_status, o.total,
           (SELECT coalesce(pg_catalog.sum(p.amount), 0)
              FROM public.order_payments p WHERE p.order_id = o.id) AS received
      FROM public.orders o
     -- 🔴 ⛔ ~~`payment_channel <> 'tappay'`~~ **作廢**(codex R1 must-fix ②):
     --    🔬 值域實測是四個:`('tappay', 'bank_transfer', 'cash', 'none')`
     --    ⇒ 那個否定式把 **`cash` 與 `none`** 也算進來,
     --      而**信裡的文案宣稱「那些客人的訂單頁仍然顯示【請匯款】+ 銀行帳號」**
     --      🔬 而顯示條件逐字是 `paymentChannel === 'bank_transfer'`
     --        (`OrderDetailView.tsx:598`)⇒ **`cash` / `none` 的客人看不到那個畫面。**
     --    ⇒ 🎯 **分母比文案寬 ⇒ 信會把不適用的單算進那個數字, 而客服照著去聯絡會撲空。**
     --    ✅ 收窄成**只有 `bank_transfer`** —— 那與文案、與客人看到的畫面**同一個集合**。
     --    ⚠️ **而 `cash` 那一類【也可能卡住】** —— 它只是不該用這封信的文案講。
     --      ⇒ 那是另一格, 已寫進本檔「這一版證不到什麼」。
     WHERE o.payment_channel = 'bank_transfer'
       AND o.cancelled_at IS NULL
       -- 🔴🔴 **三態, 不是一態**(主視窗 2026-09-05 `Q1-分母態=乙`;R4 F6 的板列
       --    ⟦b4-PAIDTHENOVERPAID⟧ 逐字寫著另外兩態被濾掉)。
       --    🔬 路徑:客人第一次匯剛好 ⇒ 翻 `paid`;**他再匯一次** ⇒ verdict `overpaid`
       --      ⇒ 而 230000 對 overpaid **刻意不翻狀態** ⇒ 停在 `paid` ⇒ 舊分母看不到。
       --      `partiallyPaid` 同型(先短匯 ⇒ 補匯補過頭)。
       --    ⚠️ `refunded` 【不在】三態裡 —— 那條路的錢已經退了, 不是本片要找的東西。
       AND o.payment_status = ANY (
             ARRAY['unpaid', 'paid', 'partiallyPaid']::public.payment_status[])
  ),
  -- 🔴🔴 **預篩分兩個世界, 而它是【效能】不是口味**(主視窗 2026-09-05 `Q2=甲`):
  --    🔬 舊分母只有 `unpaid` ⇒ 那個集合本來就小(卡住的才留在 unpaid)。
  --    🛑 而加上 `paid` 之後, 「淨額 > 0」對**每一張成功付款的匯款單**都成立
  --      ⇒ candidate = 史上所有已付款匯款單 ⇒ **每張叫一次 OP6a(七條前提的重函式)**
  --      ⇒ 📌 這支 RPC 的成本會從 O(卡住的單) 變成 O(所有訂單), 而它掛在每輪 cron 上。
  --    ✅ 所以已付款那半改用**純算術**預篩:`received > total`(overpaid 的定義就是收得比該收的多)。
  -- ⚠️⚠️ **這個預篩的代價, 逐字寫出來不藏**:
  --    它用的是 `orders.total`, 而 OP6a 算的是**它自己那一套**(含退款四面 / 帳本覆蓋 / 品項快照)
  --    ⇒ 🔴 **兩者可能不一致** ⇒ 會漏掉一種「`total` 對不上, 而 OP6a 判 overpaid」的單。
  --    ⇒ 📌 **那不是理論** —— 有退款的單 `total` 不會變, 而 OP6a 的應收會變。
  --    🔵 而主視窗裁的是:**先做甲, 量到漏的那種再改乙(不預篩)** ⇒ 板列 ⟦b4-PAIDTHENOVERPAID⟧ 留了那一句。
  prefiltered AS (
    SELECT c.* FROM candidate c
     WHERE (c.payment_status = 'unpaid'::public.payment_status AND c.received > 0)
        OR (c.payment_status <> 'unpaid'::public.payment_status AND c.received > c.total)
  ),
  judged AS (
    SELECT c.id, c.created_at, c.payment_status,
           public.admin_compute_order_settlement(c.id) ->> 'verdict' AS verdict
      FROM prefiltered c
  )
  -- 🔵 **兩個世界各自數, 因為信裡要各講各的話** ——
  --    A:客人的訂單頁還在說「請匯款」⇒ **他會再匯一次** ⇒ 急。
  --    B:畫面正常, 而錢多收了 ⇒ 不急, 而要退給他。
  --    📌 合成一個數字的話, 讀信的人分不出該打哪一種電話。
  SELECT
    count(*) FILTER (
      WHERE payment_status = 'unpaid'::public.payment_status)::integer,
    min(created_at) FILTER (
      WHERE payment_status = 'unpaid'::public.payment_status),
    count(*) FILTER (
      WHERE payment_status <> 'unpaid'::public.payment_status)::integer,
    min(created_at) FILTER (
      WHERE payment_status <> 'unpaid'::public.payment_status)
    INTO v_cnt, v_first, v_cnt_op, v_first_op
    FROM judged
   WHERE verdict IN ('overpaid', 'needs_human');

  RETURN pg_catalog.jsonb_build_object(
    'stuck_count',    v_cnt,
    -- 🔵 最早那一張的建立時刻 —— 讓讀信的人知道「這件事積了多久」, 而不只是「有幾張」。
    'oldest_created', v_first,
    -- 🔴 **第三鍵回 boolean 不回 NULL**(`-db` 2026-09-05 明示的那一格):
    --    NULL 會被下游讀成「沒問題」。⇒ 算得出來就是 true, 而算不出來的世界在上面已經 RAISE 了。
    -- 🔴 世界 B(已付款/部分付款而多收)—— **新鍵**(R4 F6 + 主視窗 2026-09-05)。
    --    🛑 鍵名不重用 `stuck_*` —— 兩個世界要打不同的電話, 合成一個數字就分不出來了。
    'overpaid_count',   v_cnt_op,
    'overpaid_oldest',  v_first_op,
    'measured',       true
  );
END
$rb$;

CREATE OR REPLACE FUNCTION public.get_settle_retry_gaveup_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $rb$
  SELECT pg_catalog.jsonb_build_object(
    -- 🔵 **每個 key 獨佔一行, 逗號結尾** —— 那不是排版偏好:
    --    `anomaly-alert-key-contract.test.ts` 那把尺用 `^\s*'key',\s*$` 抽 key
    --    ⇒ 寫成 `'key', (SELECT …)` 同一行, 它一個都抽不到 ⇒ 那道對帳閘變成恆綠。
    --    (2026-09-05 實測:第一版就是同一行 ⇒ 閘紅並說「SQL 側只抽到 0 個 key」。)
    'gave_up_count',
    -- 🔴 只數【目前】還掛著放棄章的:24 小時冷卻過了就不算(它會再被試一次)。
    (SELECT pg_catalog.count(*) FROM public.pcm_settle_retry_attempts
      WHERE gave_up_at IS NOT NULL),
    'oldest_gave_up',
    (SELECT pg_catalog.min(gave_up_at) FROM public.pcm_settle_retry_attempts
      WHERE gave_up_at IS NOT NULL),
    'sample_order_ids',
    -- 🔵 最多列 5 個 id 讓收信的人查得動;不列 last_error(可能很長, 而它在 log 裡)。
    (SELECT COALESCE(pg_catalog.jsonb_agg(x.order_id), '[]'::jsonb)
       FROM (SELECT order_id FROM public.pcm_settle_retry_attempts
              WHERE gave_up_at IS NOT NULL
              ORDER BY gave_up_at LIMIT 5) x),
    'tracked_total',
    -- 🔵 分母:一個「0 張放棄」在【表是空的】時沒有意義 ⇒ 把總列數也帶出去。
    (SELECT pg_catalog.count(*) FROM public.pcm_settle_retry_attempts)
  );
$rb$;

-- 呼叫端都退回舊版之後才 DROP。
DROP FUNCTION public.pcm_settle_verdict_safe(uuid);

DO $kind$
DECLARE
  v_n bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO v_n FROM public.pcm_incident
   WHERE kind IN ('settle_recompute_failed', 'settle_retry_gave_up');
  IF v_n > 0 THEN
    RAISE NOTICE 'pcm_incident 已有 % 列新 kind ⇒ CHECK 保留八種(不刪證據);KNOWN_INCIDENT_KINDS 與後台標籤表的兩個字也不要退', v_n;
  ELSE
    ALTER TABLE public.pcm_incident DROP CONSTRAINT pcm_incident_kind_check;
    ALTER TABLE public.pcm_incident ADD CONSTRAINT pcm_incident_kind_check
      CHECK (kind IN ('pending_refund_open_failed', 'refund_over_total', 'auto_cancel_skipped', 'auto_cancel_failed', 'line_forward_failed', 'auto_cancel_live_shipment'));
  END IF;
END
$kind$;

DO $post$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT * FROM (VALUES
      ('public.pcm_noncard_settle_recompute(uuid)', 'bc8d977dd098677dbba8a445a7ff6a56', '{postgres=X/postgres}'),
      ('public.pcm_settle_retry_sweep()',           'fe569ab55fc1e48d0cfcdec7733870b6', '{postgres=X/postgres}'),
      ('public.get_stuck_bank_orders_health()',     '8f7e158cd7196f32063b6e8eb28a7510', '{postgres=X/postgres,service_role=X/postgres,payment_confirmer=X/postgres}'),
      ('public.get_settle_retry_gaveup_health()',   '7725287b5dd063cab8d74cb853e8c2de', '{postgres=X/postgres,service_role=X/postgres,payment_confirmer=X/postgres}')
    ) AS t(sig, md5, acl)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure(f.sig)
         AND pg_catalog.md5(p.prosrc) = f.md5
         AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
         AND p.prosecdef
         AND p.proconfig = ARRAY['search_path=""']
         AND p.proacl::text = f.acl
    ) THEN
      RAISE EXCEPTION '事後閘:% 沒有回到本片之前那一代(md5 % / owner postgres / definer / search_path 空 / ACL %)', f.sig, f.md5, f.acl;
    END IF;
  END LOOP;
  IF pg_catalog.to_regprocedure('public.pcm_settle_verdict_safe(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '事後閘:pcm_settle_verdict_safe 還在';
  END IF;
END
$post$;

COMMIT;
