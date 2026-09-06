-- 🔴🔴 這是【replay 失敗的補丁】, 不是 bootstrap;來源 = 正式庫唯讀 catalog 於 2026-09-07 06:20:44 CST
--    產生指令:bash scripts/replay-gap-fixture.sh <本檔> pcm_noncard_settle_recompute pcm_pending_refund_open_for pcm_pending_refund_amounts pcm_sync_order_refund_payment_status pcm_incident_log admin_compute_order_settlement
--    🛑 **不要把本檔的內容搬進 runbook §2 的 bootstrap** —— 這裡每一個物件都是
--      【某一支 migration 自己會建的】, 而它們不見是因為那支 migration replay 失敗了。
--    ⚠️ 它只含你點名的那幾個, **不知道還缺什麼**。

-- ── pcm_noncard_settle_recompute(逐字取自正式庫 pg_get_functiondef)──────────────────────
CREATE OR REPLACE FUNCTION public.pcm_noncard_settle_recompute(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

-- ── pcm_pending_refund_open_for(逐字取自正式庫 pg_get_functiondef)──────────────────────
CREATE OR REPLACE FUNCTION public.pcm_pending_refund_open_for(p_order_id uuid, p_overwrite_amount boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_cid          uuid;
  v_n            integer;
  v_cancelled_at timestamptz;
BEGIN
  -- 🔴🔴 ⛔ ~~**`FOR UPDATE` 是這一片的樞紐 —— 它不是防禦性裝飾, 拿掉它整個修法失效。**~~
  --    **[2026-09-05 訂正 —— 這句話在本檔【自己的後面幾段】就被推翻了, 而它沒有被劃掉。]**
  --    🔬 **當場量的**:本檔全文 `FOR UPDATE` 出現 **20 次**, 而**剝掉整行註解之後 = 0 次**
  --       (`grep -o 'FOR UPDATE' <檔> | wc -l` = 20;`grep -v '^[[:space:]]*--' | grep -o … | wc -l` = 0)
  --    🔴🔴 ⛔ ~~我第一版在這裡寫「12 次」~~ —— **那個數字是我【用眼睛數 grep 列表】數出來的, 數錯了。**
  --       `-8f` 自己重量了一次(20)才發現, 而**結論那一半我們一致(剝完是 0)**。
  --       📌 **一個對的結論會讓人不去查它旁邊那個錯的數字** —— 而我把那個 12
  --          同時寫進了 commit body 與兩個窗的訊息裡, 它已經被複誦過。
  --       🛑 判別句:**這個數字是我【跑出來的】還是我【看出來的】?** 看出來的要重跑一次。
  --       ⇒ 🛑 **這支檔的碼裡一個 `FOR UPDATE` 都沒有。**
  --    ✅ **活著的設計是下面那兩段**:
  --       ①「[R4-F3 之後回頭訂正這整段的【射程】]」—— 下面三個讀數量的是
  --          **取消側裸 UPDATE** 那個世界, 而**那個世界在正式碼裡不存在**。
  --       ②「⇒ 而我試了那個排法, 它【被實測推翻】」—— advisory + `FOR UPDATE` 在探針世界 E
  --          **真死結、只有一筆進得去、客人的錢掉了一筆** ⇒ **所以這裡不加 `FOR UPDATE`**。
  --    📌 **為什麼要留著這句錯的、只加刪除線**:它排在最前面,
  --       ⇒ **讀這支檔的人【先撞到它】** —— 而它讀起來像結論。刪掉的話,
  --         下一個從別處看到這句引文的人會以為自己找錯檔。
  --    ⚠️ **實錘**:2026-09-05 另一個窗(`-8f`)拿本檔的座標去開檔對帳,
  --       就是被這一句與下面那段的矛盾卡住 —— **它已經誤導過一個人了。**
  --   🔬 **隔離實驗(拋棄式 PG, 兩條連線)**:取消交易先鎖住 orders 那一列 2 秒 ⇒
  --     付款的 INSERT 因 FK 被擋 ⇒ 取消提交 ⇒ 付款繼續
  --     ⇒ 🔴 **付款的 AFTER trigger 當下讀到的 `cancelled_at` 仍是 NULL**,
  --       而同一張單交易結束後實際是有值的。
  --   🎯 **成因是【快照】不是鎖序**:AFTER trigger 跑在那個 INSERT 語句【裡面】,
  --     用的是那個語句在【被擋之前】取的快照。等鎖等再久, 它看到的還是舊世界。
  --     ⇒ 🛑 **所以「把 advisory 鎖上移到四支取消路徑」那個方案【修不掉它】**(2026-09-05 已證偽)。
  --   🔬 三種讀法各實測一次:
  --     ⛔ 一般 SELECT       ⇒ 看不到取消(= lost-wakeup 重現)
  --     ⛔ `FOR KEY SHARE`   ⇒ **還是看不到** —— 那筆付款【本來就持有 KEY SHARE】(FK 給的)
  --                            ⇒ 它不需要重讀 ⇒ 📌 **一把更嚴格的鎖, 因為你已經持有它而完全沒作用。**
  --     ✅ `FOR UPDATE`      ⇒ 看得到(EvalPlanQual 重讀最新已提交的那一版)
  --   🛑 **而 `20260904230000:198` 逐字警告過「FOR UPDATE 是鎖升級 ⇒ 會死結」—— 我沒有忽略它**:
  --     那句話講的是【用 FOR UPDATE 取代 advisory lock】;
  --     而這裡是【advisory lock 之後再 FOR UPDATE】⇒ 兩筆併發付款先在 advisory L 排隊,
  --     不會兩個同時想升級;而取消側【不拿 advisory L】⇒ 沒有環。
  -- 🔴🔴 **[2026-09-05 R4-F3 之後回頭訂正這整段的【射程】]**
  --   下面那三個讀數(一般 SELECT / FOR KEY SHARE / FOR UPDATE)**每一個都是真的**,
  --   🛑 **而它們量的世界是【取消側裸 UPDATE】—— 那個世界在正式碼裡不存在。**
  --     四支正式取消端全部先 `FOR UPDATE`(座標見檔頭)⇒ 付款的 INSERT 被擋得夠久,
  --     等它進得來時取消已經提交 ⇒ trigger 讀得到 ⇒ **那三個讀數描述的困境到不了線上。**
  --   ⇒ 📌 **一組正確的量測, 量的是一個不存在的世界** —— 而它讀起來與量對了完全一樣。
  --   🔵 **整段留著不刪**, 兩個理由:①它記錄了「advisory lock 來得太晚」那個機制, 那是真的
  --     ②下一個想用 `FOR UPDATE` 繞過的人, 會在這裡撞到那個死結實測。
  --
  --   🔴🔴 **⇒ 而我試了那個排法, 它【被實測推翻】。原作者那句警告是對的。**
  --     🔬 探針世界 E(兩筆併發付款打同一張已取消的單):**真的死結, 而且只有一筆進得去**
  --       ⇒ 🛑 **客人的錢掉了一筆** —— 比原本那個洞更糟。
  --     🎯 **我的論證錯在哪(寫下來, 免得下一個人再推一次)**:
  --       我以為「advisory L 會讓兩筆付款排隊 ⇒ 不會兩個同時想升級」。
  --       ⇒ 而 **FK 的 KEY SHARE 是那個 INSERT 自己拿的, 在【任何 trigger 跑之前】** ——
  --         兩筆付款【都已經】持有 KEY SHARE, 然後才輪到 advisory L。
  --       ⇒ 📌 **advisory lock 來得太晚, 它序列化不了一個比它更早被拿走的鎖。**
  --   ✅ **所以這裡【不加 FOR UPDATE】** —— 那個競態改由**事後掃描器**收(見板列)。
  --   🔴🔴 **而那支掃描器現在有名字了**:`20260905180000` 的
  --      `pcm_cron.late_payment_pending_refund_sweep`(排程 `pcm-late-payment-sweep`, `*/10`)。
  --      ⇒ 🛑 **這一句是雙向的**:那支檔的檔頭也指回這裡。
  --        **關掉它 = 關掉這一行交出去的那個世界的唯一接手者** —— 而它的檔頭寫著「只是兜底」,
  --        📌 **一個讀起來像可有可無的東西, 其實是這裡明文託付的。兩邊都指對方, 誰關掉都撞得到。**
  SELECT o.cancelled_at INTO v_cancelled_at
    FROM public.orders o WHERE o.id = p_order_id;

  -- 🔴 **沒取消 ⇒ 什麼都不做。** 這一格讓呼叫端不必自己判斷 ——
  --    而那是刻意的:呼叫端有兩個(取消 trigger 與收款重算), 判斷放在這裡只有一份。
  IF v_cancelled_at IS NULL THEN
    RETURN;
  END IF;

  -- 🔴🔴 **一次查詢拿【兩個值】—— codex 2026-09-05 R1 must-fix ②。**
  --    ⛔ ~~我第一版寫成「先 count, count=1 才 SELECT id」~~ **那與原 trigger 不等價,
  --      而且重新引入 TOCTOU**:Read Committed 下兩次 SELECT 看得到【不同快照】
  --      ⇒ count 讀到 1 之後才插入第二筆 ⇒ 第二發 `SELECT INTO` **沒有 STRICT**
  --      ⇒ PostgreSQL **任取一列、其餘丟棄** ⇒ 寫進一個【任意的】cancellation_id。
  --    🛑 而主視窗要我「修回原寫法」—— **我做得更強一格**:原寫法(先 SELECT 再 count)
  --      在那個時序會清成 NULL(所以它是安全的), **而它仍然是兩次讀**。
  --      ✅ 合成一句 ⇒ **兩個值來自同一個快照** ⇒ 那個時序窗口【結構上不存在】。
  --    🔵 `(array_agg(c.id))[1]` 只在 v_n = 1 時被採用 ⇒ 「任取一列」那個危險用不到。
  SELECT count(*), (array_agg(c.id))[1] INTO v_n, v_cid
    FROM public.order_cancellations c
   WHERE c.order_id = p_order_id AND c.created_at = v_cancelled_at;

  IF v_n <> 1 THEN
    -- 🔵 歸屬留白不猜(照 20260902030000 原本的判斷)。
    IF v_n > 1 THEN
      RAISE WARNING
        '待退款歸屬留白 — 訂單 % 在 cancelled_at=% 這個時刻有 % 筆取消單(期望 1)⇒ cancellation_id 留 NULL 不猜。',
        p_order_id, v_cancelled_at, v_n;
    END IF;
    v_cid := NULL;
  END IF;

  -- 🔴 收過非卡的錢而算出來不欠 ⇒ 出聲(照 20260902030000 R3 must-fix, 逐字搬)。
  IF EXISTS (SELECT 1 FROM public.order_payments p
              WHERE p.order_id = p_order_id AND p.rail IN ('bank_transfer', 'cash'))
     AND NOT EXISTS (SELECT 1 FROM public.pcm_pending_refund_amounts(p_order_id)) THEN
    RAISE WARNING
      '取消單 %:這張單【收過非卡的錢】, 而算出來一列待退款都不用開。'
      '🔴 最常見的成因是【人工退款登記打錯金額】(例如多一個 0)—— 那會讓帳面看起來不欠錢。'
      '⇒ 請對一次 order_manual_refunds 上那幾筆的金額。', p_order_id;
  END IF;

  INSERT INTO public.order_pending_refunds
    (order_id, cancellation_id, rail, amount_at_cancel)
  SELECT p_order_id, v_cid, a.rail, a.amount
    FROM public.pcm_pending_refund_amounts(p_order_id) AS a
  ON CONFLICT (order_id, rail) WHERE voided_at IS NULL AND settled_at IS NULL
  DO UPDATE SET amount_at_cancel = EXCLUDED.amount_at_cancel,
                cancellation_id  = EXCLUDED.cancellation_id
  -- 🔴 **收款重算那條路 `p_overwrite_amount = false` ⇒ 這個 DO UPDATE 整段不執行**
  --    ⇒ 既有那一列的快照【不被動到】(見本函式上方那段合約)。
  --    🔵 而「沒有列」那個世界不受影響 —— INSERT 照樣開一列, 那正是本片要補的洞。
   WHERE p_overwrite_amount;
END
$function$;

-- ── pcm_pending_refund_amounts(逐字取自正式庫 pg_get_functiondef)──────────────────────
CREATE OR REPLACE FUNCTION public.pcm_pending_refund_amounts(p_order_id uuid)
 RETURNS TABLE(rail text, amount bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH net AS (
    SELECT r.rail,
           COALESCE((SELECT SUM(p.amount) FROM public.order_payments p
                      WHERE p.order_id = p_order_id AND p.rail = r.rail), 0)::bigint
         - COALESCE((SELECT SUM(m.refund_amount) FROM public.order_manual_refunds m
                      WHERE m.order_id = p_order_id AND m.rail = r.rail
                        AND m.voided_at IS NULL), 0)::bigint AS net
      -- 🔴 這是 `order_payments.rail` 值域的【手抄副本】(主人 `20260810100000:189`, 三值含 card)
      --    —— 與 `20260901080000:441-442` 同一份, 而那個問題本支【沒有解決】:
      --    新增第 4 條非卡軌時, 這裡與那裡【都要】回來改。⇒ 已在該檔記過, 本支不重複開列。
      FROM (VALUES ('bank_transfer'), ('cash')) AS r(rail)
  ),
  -- 🔴 **只有【還有正餘額】的軌拿得到分配** —— 負的那幾軌已經在 `total` 裡被扣掉了
  pos AS (SELECT n.rail, n.net FROM net n WHERE n.net > 0),
  agg AS (
    SELECT (SELECT SUM(n.net) FROM net n)  AS total,      -- 真的還欠多少(可負)
           (SELECT SUM(p.net) FROM pos p)  AS pos_total   -- 分配的分母
  ),
  -- 🔴 **整數分配用【前綴和差分】** —— 兩件事要同時成立:
  --   ① 每一列都 > 0(它要能被直接照著付)
  --   ② Σ 每一列 **恰好等於** `total`(不能因為取整而多付或少付一塊錢)
  --      🔴 **而它【只有加上 `trunc()` 才成立】** —— 見下方那段(SUM(bigint) 回 numeric)。
  --   ⇒ 前綴和差分天生滿足 ②:相鄰兩個「已分配累計」相減, 誤差不會累積, 也不必事後補餘數。
  -- ⛔ ~~第一版用 `LEFT JOIN net n2 ON n2.rail <= n.rail` + `GROUP BY` 做同一件事~~
  -- 🔴 **那一版是錯的, 而【對照組抓到它】**:兩軌都有收款且沒有退款時, 它只吐 `bank_transfer=600`
  --    —— **`cash=400` 整列不見了** ⇒ 合計 600 而不是 1000 ⇒ **那是一個回歸, 不是新缺陷。**
  --    ⇒ 📌 而抓到它的是【無回歸】那一格, 不是缺陷本體那一格 ——
  --      缺陷本體(世界A)在錯的版本下**照樣過**, 因為那個世界只有一條正軌。
  --    ⇒ ⇒ **一個只有一條正軌的世界, 對「多條軌怎麼分」零判別力。**
  cum AS (
    SELECT p.rail,
           SUM(p.net) OVER (ORDER BY p.rail ROWS UNBOUNDED PRECEDING)          AS c,
           SUM(p.net) OVER (ORDER BY p.rail ROWS UNBOUNDED PRECEDING) - p.net  AS c_prev
      FROM pos p
  )
  -- 🔴🔴 **`trunc(...)` 不是保險, 它是這個算式成立的前提**(`-c7` 2026-09-02 複驗抓到, 本窗自己重量過)。
  --   🛑 **`SUM(bigint)` 在 Postgres 回的是 `numeric`, 不是 `bigint`** ⇒ 上面 `total` / `pos_total`
  --     都是 numeric ⇒ 那兩個 `/` **不是整數除法**, 而是精確有理數除法。
  --   ⇒ 而 `::bigint` 是**逐列四捨五入** ⇒ 📌 **前綴和差分的遞移抵銷【根本沒有發生】。**
  --
  --   實測(本窗拋棄式 PG 17.10, LC_ALL=C):
  --     pg_typeof(SUM(1::bigint))            ⇒ numeric
  --     ((7::numeric*9)/17)::bigint          ⇒ 4      而 (7::bigint*9)/17 ⇒ 3
  --     `total=2` · `pos_total=3` · 三條正軌各 1:
  --       現行(無 trunc)⇒ 逐列 1 | 1 | 1 = 3  🔴 **比 total 多付 1 元**
  --       trunc 版      ⇒ 逐列 0 | 1 | 1 = 2  ✅ 而那個 0 會被下面的 WHERE 濾掉
  --     ⚠️ **而這一組是【四軌】不是三軌**(codex 2026-09-02 must-fix 更正我原本的標籤):
  --       三條正軌各 1 ⇒ `pos_total = 3`, 而 `total = 2` **還需要第四條 `−1`**。
  --       ⇒ 📌 我寫「三軌」是因為我腦子裡只數了【正的那幾條】—— 而 `total` 是**全部**的和。
  --
  --   🛑 **而【零元列】不只是多一列, 它會炸掉整筆取消**:WHERE 比的是 numeric(0.333… > 0 為真)
  --     而 SELECT 的 `::bigint` 得 0 ⇒ 撞 `20260901080000` 的 `amount_at_cancel CHECK (> 0)`
  --     ⇒ INSERT 失敗 ⇒ **整筆取消回滾**。⇒ ✅ 兩處都套 trunc ⇒ WHERE 與 SELECT 算同一個值。
  --
  -- 🔵 **而今天(兩軌)【本來就是對的】, 這一改是行為中性的** —— `-c7` 窮舉 nets 各 -50..50
  --   ⇒ 10,201 個世界, 合計不符 0、零元列 0(正對照:多餵一條軌 ⇒ 不符 50 ⇒ 那把尺會動)。
  --   理由:一軌負 ⇒ `pos` 只剩一列 ⇒ 分配 = `total` 本身;兩軌都正 ⇒ `total = pos_total`
  --   ⇒ 各拿自己的數。
  --   ⛔ ~~⇒ 分數要【三條正軌】才生得出來。~~ 🔴 **假的**, 而它錯在【兩個方向】。
  --     🔵 **這句話的作者是 `-c7`, 不是本窗** —— 它在複驗那一則裡逐字寫了
  --       「⇒ 分數要三條正軌才生得出來」, 而我**照收進這段註解**。
  --       ⇒ 📌 標出處不是禮貌:**一條錯誤如果歸錯人, 下一個人會去查【錯的那個來源】。**
  --       ⇒ ⇒ 而真正該去查的是 `~/pcm-mailbox/量測-那支跨軌修法的分配算式-20260902.md`
  --          (檔尾有就地訂正, 零刪除)—— 那裡才有那 4,913 個世界的資料。
  --     · **講太窄**:`[1, 2, −2]` 只有**兩條**正軌(`total=1` / `pos_total=3`)⇒ 生出 `1/3`、`2/3`
  --       ⇒ 🛑 而舊版在這個世界會送出一個**零元列** ⇒ 撞 CHECK ⇒ 整筆取消回滾。
  --       ⇒ ⇒ 讀那句的人會以為「只有兩條正軌 ⇒ 安全」—— **而那正是會出事的那一種。**
  --     · **講太寬**:`[1,1,1]`(三條全正、沒有負軌 ⇒ `total = pos_total`)舊版**完全正確**
  --       ⇒ 那句話讓一個沒問題的世界看起來有問題。
  --     🎯 **而 `-c7` 自己講了它為什麼躲過自己那 4,913 個世界**:
  --       那些反例**就在裡面**(它撈到 126 多付 + 162 零元列)——
  --       ⇒ **而它看著正確的數字, 寫下了錯誤的解釋**:從「兩軌是安全的」直接外推,
  --         而**沒有回去問那 162 個零元列是什麼形狀**。
  --       ⇒ 📌 **窮舉驗了現象, 而沒有讓它去驗【我對現象的解釋】。**
  --       ⇒ ⇒ **而解釋才是下一個人會讀的 —— 數字他不會重跑。**
  --   ✅ **正確的條件是兩個【同時】成立**:`total ≠ pos_total`(⇒ 至少一條負軌)
  --     **而且** `pos` 有兩列以上(⇒ 至少兩條正軌)⇒ **合計至少【三條軌】, 不是三條正軌。**
  --   ⇒ 📌 而今天恰好兩軌 ⇒ 那兩個條件**不可能同時成立** ⇒ 這就是今天安全的完整理由。
  --
  -- 🛑🛑 **而這一格真正的教訓是【警告的方向】**:
  --   本檔已經警告了「新增第 4 條非卡軌時, rail 值域**兩處**都要回來改」——
  --   ⇒ 而**沒有警告【回來改算式】** ⇒ 📌 **而回來改值域的那個人, 會以為算式是安全的**
  --     ⇒ ⇒ **因為 COMMENT 是這樣告訴他的。**
  --   ⛔ ~~原 COMMENT 逐字:「⇒ Σ 每一列**恰好等於** total, 不會因取整多付或少付。」~~
  --     🔴 **那句話在三軌以上【不成立】, 而它是我寫的。留著加刪除線, 因為它正是那個誤導。**
  SELECT cu.rail,
         (trunc((a.total * cu.c) / a.pos_total)
        - trunc((a.total * cu.c_prev) / a.pos_total))::bigint AS amount
    FROM cum cu
    CROSS JOIN agg a
   WHERE a.total > 0
     AND (trunc((a.total * cu.c) / a.pos_total)
        - trunc((a.total * cu.c_prev) / a.pos_total)) > 0;
$function$;

-- ── pcm_sync_order_refund_payment_status(逐字取自正式庫 pg_get_functiondef)──────────────────────
CREATE OR REPLACE FUNCTION public.pcm_sync_order_refund_payment_status(p_order_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

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
$function$;

-- ── pcm_incident_log(逐字取自正式庫 pg_get_functiondef)──────────────────────
CREATE OR REPLACE FUNCTION public.pcm_incident_log(p_kind text, p_subject_id uuid, p_detail text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- 🔴 `detail` 截斷:SQLERRM 可能很長, 而這張表是給人看的不是存 log 的。
  --    ⚠️ 截斷會**丟掉尾巴**, 而錯誤訊息的關鍵字常在尾巴 ⇒ 2000 是妥協不是安全值。
  INSERT INTO public.pcm_incident (kind, subject_id, detail)
  VALUES (p_kind, p_subject_id, pg_catalog.left(COALESCE(p_detail, '(無)'), 2000));
END;
$function$;

-- ── admin_compute_order_settlement(逐字取自正式庫 pg_get_functiondef)──────────────────────
CREATE OR REPLACE FUNCTION public.admin_compute_order_settlement(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
WITH o AS (
  SELECT ord.id,
         ord.total,
         ord.subtotal,
         ord.payment_status::text AS ps,
         ord.cancelled_at,
         ord.cancelled_reason
    FROM public.orders ord
   WHERE ord.id = p_order_id
),
-- ── 收款面 ────────────────────────────────────────────────────────────────
pay AS (
  SELECT pg_catalog.count(*)                                        AS rows_n,
         -- 🔴 關卡2:不要 ::integer。sum() 回 bigint,硬轉會在溢位時**噴錯**而不是落 needs_human。
         coalesce(pg_catalog.sum(op.amount), 0)::bigint AS gross,
         pg_catalog.count(*) FILTER (
           WHERE op.received_at > pg_catalog.now())                 AS future_n
    FROM public.order_payments op
   WHERE op.order_id = p_order_id
),
-- 沖銷形狀:①指向同單既有列且金額為反號 ②同一列至多被沖一次
rev_bad AS (
  SELECT pg_catalog.count(*) AS n
    FROM public.order_payments r
   WHERE r.order_id = p_order_id
     AND r.reverses_payment_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.order_payments t
                      WHERE t.id = r.reverses_payment_id
                        AND t.order_id = r.order_id
                        AND t.amount = -r.amount)
),
rev_dup AS (
  SELECT pg_catalog.count(*) AS n
    FROM (SELECT r.reverses_payment_id
            FROM public.order_payments r
           WHERE r.order_id = p_order_id
             AND r.reverses_payment_id IS NOT NULL
           GROUP BY r.reverses_payment_id
          HAVING pg_catalog.count(*) > 1) d
),
-- ── 品項快照 ──────────────────────────────────────────────────────────────
-- 🔴 比的是 `subtotal` 不是 `total`:`20260604120000:112` 已有 DDL CHECK
--    `total = subtotal + shipping_fee - discount_total` ⇒ 再驗那條是恆真守門。
--    items 住在另一張表、**跨表這一段沒有 DDL 在守**,那才是會漂的地方。
items AS (
  SELECT pg_catalog.count(*)                                          AS n,
         coalesce(pg_catalog.sum(oi.line_total), 0)::bigint AS sum_line
    FROM public.order_items oi
   WHERE oi.order_id = p_order_id
),
-- ── 取消面(三處都看;Fable F11 核可 AND-of-negatives 的 fail-closed 方向)──
canc AS (
  SELECT (SELECT pg_catalog.count(*) FROM public.order_cancellations c
            WHERE c.order_id = p_order_id)
       + (SELECT pg_catalog.count(*) FROM public.order_cancellation_items ci
            WHERE ci.order_id = p_order_id) AS n
),
-- ── attempts 覆蓋(前提 5)─────────────────────────────────────────────────
-- 🔴 Fable F3:`order_payments` **無 attempt_id 欄**,唯一可行 join 鍵是 rec_trade_id;
--    但卡腿唯一鍵是 (order_id, rec_trade_id) 而 attempts 側 rec **全域唯一**
--    ⇒ 裸 rec join 會被「**別張單**的同 rec 卡腿」滿足。兩個鍵都要比。
att AS (
  SELECT pg_catalog.count(*) FILTER (WHERE a.status = 'charged') AS charged_n,
         pg_catalog.count(*) FILTER (
           WHERE a.status = 'charged'
             AND NOT EXISTS (SELECT 1 FROM public.order_payments op
                              WHERE op.order_id     = a.order_id
                                AND op.rail         = 'card'
                                AND op.rec_trade_id = a.rec_trade_id)) AS uncovered_n
    FROM public.payment_charge_attempts a
   WHERE a.order_id = p_order_id
),
-- ── 退款面:**四個**來源(Fable F4)────────────────────────────────────────
ref AS (
  SELECT
    -- ① 訂單級舊帳本:只有 status='failed' 除外;`processing` 恆為跡象。
    --    🔴 **擋不掉什麼**(reviewer I3):四面裡只有這一面的除外值**沒有結構撐腰** ——
    --    ③ 的 failed 有 `orj_shape_failed` 保證 `refund_call_attempted_at IS NULL`、
    --    ② 的 failed 是 terminal 事件、④ 的 dismissed 有 status 一致性 CHECK;
    --    而 `order_refunds.status='failed'` **只有值域 CHECK**,沒有任何約束保證「外呼沒發生過」。
    --    ⇒ 若某天有人把已送出的退款標成 failed,這一面就會漏掉它。這是已知缺口,不是被守住的面。
    (SELECT pg_catalog.count(*) FROM public.order_refunds orf
      WHERE orf.order_id = p_order_id AND orf.status <> 'failed')                    AS old_n,
    -- ② L5b attempt 級 —— 🔴 **沖銷片改寫**:改吃 canonical view,不再自己問「有沒有 manual」。
    --    形狀刻意**維持原本的雙重否定**(plan §11-3):
    --      除外(不算跡象) ⇔ EXISTS(有效終局) AND NOT EXISTS(有效終局 且 indicates_refund)
    --    · **左半不能省**(Fable F5 原意):少了它,「零有效終局」(只有 `sent` 或只有
    --      `result_unknown` —— 兩個最危險的未知態)會被空集合當成「全 failed」而除外。
    --    · **不得簡化成單一 EXISTS(有效終局 AND NOT indicates_refund)**:那在 trigger 被繞過、
    --      同時存在兩筆有效終局(一 true 一 false)時會翻成 **fail-open**;現寫法仍 fail-closed。
    --    · 舊字面認 `result_success` 為終局,那是 2d 之前的殘留(plan §11-1 的既存 drift);
    --      新語意由 view 單一權威定義(`result_confirmed`/`result_failed`/`manual`)。
    (SELECT pg_catalog.count(*)
       FROM public.payment_refunds pr
       JOIN public.payment_charge_attempts a2 ON a2.id = pr.attempt_id
      WHERE a2.order_id = p_order_id
        AND NOT (
              EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et
                       WHERE et.refund_id = pr.id)
          AND NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et
                           WHERE et.refund_id = pr.id
                             AND et.indicates_refund)
        ))                                                                            AS l5b_n,
    -- ③ 在途退款工單:🔴 `failed` 態由 `orj_shape_failed`(20260731120000:395-400)硬性要求
    --    `refund_call_attempted_at IS NULL` ⇒ **DDL 保證外呼從未發生 = 錢確定沒動**,除外它安全。
    --    其餘六值(queued/processing/submitted/reconciling/completed/dead)全算跡象。
    (SELECT pg_catalog.count(*) FROM public.order_refund_jobs j
      WHERE j.order_id = p_order_id AND j.status <> 'failed')                        AS job_n,
    -- ④ 雙扣異常:走 Dashboard 退款、**不經 ①②** ⇒ 任何非 dismissed 列都算跡象
    (SELECT pg_catalog.count(*) FROM public.payment_double_charge_anomalies dc
      WHERE dc.old_order_id = p_order_id AND dc.status <> 'dismissed')               AS anom_n
),
-- ── 七條前提 P1-P7(每條以 IS TRUE 收斂;NULL 一律當 false)────────────────────────
prem AS (
  SELECT
    -- P1 訂單存在 + 狀態在**可判定集**內。
    --    🔴 五值(20260604120000:50 四值 + 20260725130000:45 partiallyRefunded),
    --    `refunded` / `partiallyRefunded` **排除**:退款帳本 2026-07-25 才建,更早的退款
    --    在庫內零跡象 ⇒ 「refunded + 四面皆空」會湊出「全 true 但錢已退」(Fable F1)。
    (o.ps IN ('unpaid','paid','partiallyPaid')) IS TRUE                    AS p1,
    -- P2 完全沒有取消痕跡(四處)
    (o.cancelled_at IS NULL
     AND o.cancelled_reason IS NULL
     AND canc.n = 0)                                    IS TRUE            AS p2,
    -- P3 品項快照完整
    (items.n > 0 AND items.sum_line = o.subtotal::bigint) IS TRUE          AS p3,
    -- P4 收款列形狀乾淨
    (pay.future_n = 0 AND rev_bad.n = 0 AND rev_dup.n = 0) IS TRUE         AS p4,
    -- P5 帳本覆蓋可信。🔴 branch 1 必須連 charged attempt 一起看(Fable F2):
    --    「unpaid + 零卡腿 + 有 charged attempt」= mark 半途死 / OP3 寫腿失敗,
    --    DB 裡明擺著錢動過(charged ⇒ rec_trade_id 非空,20260612150000:98),
    --    少了這一句會判 underpaid。
    (((o.ps = 'unpaid' AND pay.rows_n = 0 AND att.charged_n = 0))
      OR (pay.rows_n > 0 AND att.uncovered_n = 0))      IS TRUE            AS p5,
    -- P6 四個退款面全空
    (ref.old_n = 0 AND ref.l5b_n = 0 AND ref.job_n = 0 AND ref.anom_n = 0) IS TRUE AS p6,
    -- P7 金額落在 int4 範圍內(溢位 ⇒ 不可判定,而不是噴錯)
    -- 🔴 關卡2 R2:**溢位守門自己不能溢位**。第一版用 `abs(bigint)`:①`bigint` 最小值取 abs 會拋錯
    --    ②`gross - total` 可能**先溢位**才輪到 abs,而 SQL 的 AND **不保證求值順序**、擋不住。
    --    ⇒ 一律先轉 `numeric`(任意精度、不會溢位)再比範圍,且用 BETWEEN 不用 abs。
    (pay.gross::numeric BETWEEN -2147483648 AND 2147483647
     AND (pay.gross::numeric - o.total::numeric) BETWEEN -2147483648 AND 2147483647)
                                                        IS TRUE                   AS p7
    FROM o, pay, rev_bad, rev_dup, items, canc, att, ref
),
calc AS (
  SELECT o.total                                   AS receivable,
         pay.gross                                 AS gross,
         (pay.gross - o.total::bigint)             AS net,   -- R=0 才會用到(P6 為真時)
         prem.p1, prem.p2, prem.p3, prem.p4, prem.p5, prem.p6, prem.p7,
         (prem.p1 AND prem.p2 AND prem.p3 AND prem.p4 AND prem.p5 AND prem.p6
          AND prem.p7) AS all_ok,
         o.ps, pay.rows_n, att.charged_n, att.uncovered_n,
         items.n AS items_n, canc.n AS canc_n
    FROM o, pay, prem, att, items, canc
)
SELECT pg_catalog.jsonb_build_object(
  'scope',      'db_internal_only',
  'gross',      c.gross,
  -- 🔴 關卡2:**輸出數字的條件必須與 verdict 降級的條件是同一個**。
  --    第一版 refunded 只看 p6 ⇒ 歷史 payment_status='refunded' 且四本帳皆空時,
  --    verdict 是 needs_human 卻同時宣稱 `refunded: 0` —— 那正是本片存在的理由(假信心)。
  'refunded',   CASE WHEN c.all_ok THEN 0 ELSE NULL END,
  'receivable', CASE WHEN c.all_ok THEN c.receivable ELSE NULL END,
  'net',        CASE WHEN c.all_ok THEN c.net ELSE NULL END,
  'verdict',    CASE
                  WHEN NOT c.all_ok  THEN 'needs_human'
                  WHEN c.net = 0     THEN 'settled'
                  WHEN c.net < 0     THEN 'underpaid'
                  WHEN c.net > 0     THEN 'overpaid'
                  ELSE 'needs_human'          -- 🔴 NULL 兜底(Fable F6),不是裝飾
                END,
  -- 🔴 reasons **累積全部命中**,不是第一個 CASE 就短路:一張舊 paid 單可能同時零收款、
  --    有退款、有取消,值班要看到三個。
  'reasons',
    pg_catalog.to_jsonb(pg_catalog.array_remove(ARRAY[
      CASE WHEN NOT c.p1 THEN 'STATUS_NOT_DECIDABLE'        END,
      CASE WHEN NOT c.p2 THEN 'D_HAS_CANCELLATION'          END,
      CASE WHEN NOT c.p3 THEN 'D_NO_SNAPSHOT'               END,
      CASE WHEN NOT c.p4 THEN 'PAYMENT_ROW_SHAPE_ANOMALY'   END,
      -- P5 拆三碼:處置完全不同(前者=OP4 餵料、中者=線上寫入故障、後者=錢動過但單還 unpaid)
      CASE WHEN NOT c.p5 AND c.ps <> 'unpaid' AND c.rows_n = 0
             THEN 'G_LEDGER_NOT_BACKFILLED'                 END,
      CASE WHEN NOT c.p5 AND c.rows_n > 0 AND c.uncovered_n > 0
             THEN 'G_LEDGER_WRITE_GAP'                      END,
      CASE WHEN NOT c.p5 AND c.ps = 'unpaid' AND c.charged_n > 0
             THEN 'G_UNPAID_WITH_CHARGED_ATTEMPT'           END,
      CASE WHEN NOT c.p6 THEN 'R_REFUND_TRACE_PRESENT'      END,
      CASE WHEN NOT c.p7 THEN 'AMOUNT_OUT_OF_RANGE'           END
    ], NULL))
) FROM calc c
$function$;

