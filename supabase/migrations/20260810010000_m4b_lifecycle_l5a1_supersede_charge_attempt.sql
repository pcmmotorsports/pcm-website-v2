-- ============================================================
-- M-4b 生命週期 L5a-1:supersede_charge_attempt_for_user(L5 自動裁定「讓路」CAS RPC)+ ACL
-- ============================================================
-- 真權威:母 plan docs/specs/2026-08-09-l4-l5-settlement-compensation-plan.md §3.1(觸發 A/B)+ §3.2
--   + 片級 plan P-280-STOP §1/§2/§5 + 主視窗核准 P-282-A(片界照案 3 片)。
-- 依賴:20260809230000(L5a-M 的 superseded_at/reason/by_order_id 三欄與五條 CHECK)、
--       20260612150000(payment_charge_attempts)、20260615120001(settle_attempt_count/next_settle_at/
--       needs_manual_review)、20260624120000(released 狀態 + released_at)。
-- 鐵則 12①③(錢 + DB 結構);鐵則 8 由 P-280-STOP + P-282-A 滿足。
--
-- 🔴 這支在做什麼:客人重新結帳撞到 per-user 閘、且對那張在途單做過**新鮮 Record 觀察**之後,
--   觀察結果落在「查無 / 恆 4 PENDING」這一岔時,由本 RPC 原子地把舊 attempt 讓路:
--     pending → released(退出 per-user 閘與 cart dedup ⇒ 新單走得通)
--     + 蓋上 L5a-M 的 durable 標記(供 L5b 補償盯梢認人)
--     + 重置 sweeper 節奏(留在對帳集,它後來若轉 AUTH/已請款,L5b 看得到)
--   **零等待**:沒有任何年齡條件(Sean 逐字;母 plan §3.1)。客人關掉頁面 3 秒後回來重下單也走得通。
--
-- 🔴 為什麼觀察不在這支裡做:Record 觀察要打 TapPay HTTP,DB 做不到也不該做。
--   觀察由 app 層既有的 settleCharge 脊椎負責(L4b 已接),本 RPC 只收「觀察結論」並負責**原子落地**。
--   ⇒ 本支的職責邊界 = TOCTOU 重驗 + 歸屬四閘 + 標記寫入,**不是**裁決者。
--
-- 🔴 三岔對照 settleCharge outcome(偵察實查 packages/use-cases/src/settle-charge.ts:58-191,364-411):
--   | 觀察                                   | outcome                              | 動作 |
--   | Record -1/5                            | {kind:'failed'}                      | 放行(L4b 已有,不經本支)|
--   | Record 0/1(AUTH/已請款)               | {kind:'paid'} / paid_candidate       | **不放行**、顯既有單 |
--   | Record 查無                             | {kind:'pending', reason:'record_not_found'} | **讓路** → 本支,p_reason='record_not_found' |
--   | Record 4 PENDING                        | {kind:'pending', reason:'auth_or_pending'}  | **讓路** → 本支,p_reason='stuck_pending' |
--
-- 🔴 **母 plan 的「三岔」沒有列到、但實作上一定會遇到的第四類:觀察不到**(我在本片裁,寫下來供覆核):
--   `record_unverified` / `record_unreachable`(TapPay 打不通、回應驗不過)⇒ **一律不放行、不讓路**。
--   理由:讓路會產生一筆待補償的舊授權,那是有代價的動作;「我沒看清楚」不足以支付這個代價。
--   這與 L4b 既有紀律同向(charge-actions.ts:372-375「兩次觀察不一致 = 未知,未知不放行」)。
-- 🔴 同理 `{kind:'no_attempt'}` **不走本支**:它的意思是「DB 現在查無 active attempt」,
--   與「Record 查無」是兩件事(一個問 DB、一個問 TapPay)。混為一談會讓 race 被當成放棄型。
--   而且真是 no_attempt 的話,per-user 閘本來就不會再擋 ⇒ 不需要讓路。
--
-- 🔴 閘的全貌(codex 關卡2 R1/R2 之後;任一不符 ⇒ 回 {superseded:false},狀態一個字不動):
--   **鎖下前置**(先依 id 升序把「舊單 + 非 NULL successor」一次鎖齊,再驗;R2-MF2/MF3):
--     L1 舊單存在
--     L2 舊單 `orders.customer_user_id = p_user_id`   🔴 對**本尊**驗,不只信 attempt 的反正規化欄(R1-MF1)
--     L3 舊單仍 unpaid                                 🔴 **鎖下**才是真的 TOCTOU 關閉(R1-MF2)
--     L4 舊單未取消 —— `cancelled_at` **與** `order_cancellations` **兩張真相表**(R2-MF1;A8c1 逐字)
--     L5 successor(若非 NULL):非自己 / 同會員 / unpaid / 未取消(兩張真相表)—— 全在鎖下(R2-MF2)
--   **attempt 側**(單一 UPDATE 的 WHERE):
--     ① a.order_id = p_order_id
--     ② a.customer_user_id = p_user_id      反正規化欄自己也要對,擋「本尊與它不一致」那一種(R1-MF1)
--     ③ a.status = 'pending'                🔴 **charged 絕不讓路** —— 錢很可能已經動了,讓路=真雙扣
--     ⑥ a.superseded_at IS NULL             🔴 **真 write-once**(R1-MF5b:閘③ 保證不了)
--     ⑦ a.released_at IS NULL OR <= v_now   異常列擋成乾淨 false,不讓它撞 CHECK ⑤ 變 23514(R1-MF5a)
--
-- 🔴 write-once 靠**閘⑥ `superseded_at IS NULL`**(codex 關卡2 R1-MF5b 打掉了前一版的說法)。
--   前一版寫「閘③ status='pending' 就結構保證了 write-once」——**那是錯的**:
--   pending 列身上完全可以已經帶著一組合法的 superseded_*(L5a-M 五條 CHECK 全都允許),
--   那樣本支會靜靜**覆寫 durable 標記**,而覆寫掉的正是 L5b 判斷該不該退款的唯一依據。
--
-- 🔴 released_at 與 CHECK ⑤ 的相容性(L5a-M 的 superseded_after_release_chk):
--   本支同交易寫 released_at = COALESCE(released_at, v_now) 與 superseded_at = v_now(v_now=clock_timestamp() 取一次)。
--   · 舊值為 NULL ⇒ 兩者同為 v_now ⇒ `released_at <= superseded_at` 取等號、成立。
--   · 舊值非 NULL 且在過去 ⇒ 嚴格小於、成立。
--   · 🔴 舊值在**未來**(R1-MF5a):COALESCE 保留未來值 ⇒ `released_at > superseded_at` ⇒ 撞 23514。
--     ⇒ 加閘⑦ `released_at IS NULL OR released_at <= v_now` 把這種異常列擋成乾淨的 false,
--     不讓呼叫端收到約束例外(收到例外會被當成系統錯誤,而系統錯誤的處理路徑可能釋放按鈕)。
--   ⇒ **在閘⑥⑦ 都成立的前提下**,本支產生的列恆滿足 CHECK ⑤;harness 有正向格與兩個異常格釘住。
--
-- 🔴 `superseded_by_order_id` 的語意**降級**(codex 關卡2 R1-MF3,重要):
--   本支只能證明「那是一張同會員、未付款、未取消的訂單」,**證不到它就是實際被放行的那張新單**。
--   時序:本支讓路 → 客人的新單再去跑 begin_charge_attempt,而那一步是**另一次獨立競爭** ——
--   兩張新單同時撞同一張舊單時,提出讓路的是 O2、真正搶到 charge attempt 的可能是 O3。
--   ⇒ 本欄語意 = **「提出讓路要求的訂單」**,不是「受益訂單」。
--   🔴 對 L5b 的硬契約:**不得**把本欄當成實際受益單去做金額/歸屬推論;它只有稽核與追線用途。
--   要真的證明受益關係,得把「讓路 + 替指定 successor 建 attempt」併成同一支、持同一把 per-user
--   advisory lock 的 RPC —— 那會動到 begin_charge_attempt(鎖在別的線),不在本片範圍。
--
-- ⚠️ p_reason 值域錯誤走 **RAISE 不走 rowcount=0**:那是呼叫端的程式錯誤、不是競態,
--   靜靜回 false 會讓 bug 假裝成「剛好沒讓路」。競態回 false、程式錯誤要吵。
--
-- ⚠️ C5 窗口期代價:讓路同交易把 `needs_manual_review` 洗回 false、`released_manual_review_at` 清空。
--   在 L5a-2 上線之後、L5b 上線之前那段窗口,被讓路的舊授權**沒有任何人在看**
--   (它既不在人工 queue、L5b 也還沒接手)。⇒ 這是**發布序約束的一部分**:L5b 未上線前
--   值班要自己查 `WHERE superseded_at IS NOT NULL AND status='released'`。
--   (released 本來就會繞過 manual queue,見 20260624120009:78-80。)
--
-- ⚠️ C6 代價:客人若**自己**先按了重新付款,preflight release CAS 會搶先把 attempt 轉 released,
--   此後本支的閘③(status='pending')就不成立 ⇒ 那筆的讓路資格**靜靜降級**成 #349 那一桶
--   (preflight release 同型雙扣,本線不碰)。不是 bug,是範圍邊界 —— 但它會讓「為什麼這筆沒被補償」
--   在事後很難解釋,所以寫在這裡。
--
-- ⚠️ 口徑鐵線(harness 檔頭已有、本檔前一版漏寫,兩處必須一致):上面三岔表裡的 `Record -1/5`,
--   **`5 CANCEL` 是 sandbox 實測成立、`-1 ERROR` 至今未確認**(sandbox 構造不出該態);
--   兩者都只證 TapPay sandbox 狀態機,不等於真實發卡行。詳 settle-charge.ts classifyRecordStatus 檔頭 + backlog #353。
--
-- ⚠️ 本支**不碰** `confirm_order_payment`(鎖在 B 窗)、不寫 `order_payments`、不動錢。
--   它只釋鎖 + 蓋標記;真正的補償退款是 L5b(單獨對抗審查)。
--
-- 🔴🔴 **L5a-2(app 側接線)的硬前置:先解掉 D1 不一致終態**(主視窗裁 P-290 Q1=A)。
--   codex 關卡2 R2-MF4 推翻了本片作者原本的範圍判斷,理由成立:
--   同 `cart_session_id` 的 dedup **無時限**,舊 pending 會一直被攔住並進 L5 讓路;
--   但**異 cart** 走 per-user 閘,那條有 10 分鐘年齡條件 ⇒ 超過 10 分鐘的舊 pending 被**忽略**、
--   直接建新 attempt。舊的那筆後來若轉 charged,就是一條沒有任何人在看的雙扣路徑。
--   ⇒ 這不是「政策題可以排晨報」,是**發布序硬約束**(`feedback_app-layer-must-not-ship-before-migration-apply` 同族):
--     DB 側(本片)可以先上;**app 側接線(L5a-2)之前必須先有一片把兩條閘的政策統一**。
--   ⚠️ 那片裡若出現「cart dedup 要不要加期限」這種產品行為決策 ⇒ 落 Q 信排晨報,不自己拍。
--
-- 🔴 **provenance 宣稱縮窄**(主視窗裁 P-290 Q2=A):L5a-M 檔頭指名的 `SOLE-WRITER` 偵測器
--   只掃 `public.pg_proc.prosrc` ⇒ 它證的是「**public 函式這一面**沒有第二個寫入者」,
--   **不是**「全庫只有受控 RPC 寫得到」。跨 schema 函式、trigger、動態 SQL、migration 直接 UPDATE
--   都能寫標記而它全綠(codex 關卡2 R2-MF5)。
--   ⇒ 真正把 provenance 變成結構保證的做法(受限 owner 的 append-only 決策紀錄 / 明確 writer registry)
--     列為 **L5b 的前置設計題** —— L5b 本來就要單獨對抗審查,那裡才有完整 context 決定。
--     本片與 L5a-M 的「加欄」形狀不變(不推翻 §7-2 已核形狀)。
--
-- ⛔ apply 停點:本檔 commit 後**不 apply**(P-282-A 裁 4:L5a 全片=錢面,apply 排早上 Sean 批次)。
--   🔴 apply 順序硬約束:**必須在 20260809230000(L5a-M)之後** —— 本支寫的三欄由那支建立。
-- Rollback(Supabase forward-only;僅供參考):DROP FUNCTION IF EXISTS
--   public.supersede_charge_attempt_for_user(uuid, uuid, text, uuid);
--   ⚠️ 撤本支不會撤掉已經蓋上的標記(那是歷史事實)。L5b 若已上線,先撤 L5b 再撤本支。
-- ============================================================

BEGIN;

-- ── 0. 前置閘:L5a-M 三欄必須先在(fail-closed;plpgsql 不在 CREATE 時驗欄名)──
--    沒有這道閘,欄位不存在時本支會**建得起來**、要到第一次真的被呼叫(=真客人在結帳)才炸。
DO $$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(c, ',' ORDER BY c) INTO v_missing
    FROM unnest(ARRAY['superseded_at', 'superseded_reason', 'superseded_by_order_id']) c
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = 'public.payment_charge_attempts'::regclass
        AND a.attname = c AND a.attnum > 0 AND NOT a.attisdropped);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'L5a-1 前置閘:L5a-M 的欄位缺 [%] —— 先 apply 20260809230000 再套本檔', v_missing;
  END IF;
END
$$;


-- ── 1. supersede_charge_attempt_for_user(server-only 讓路 CAS)──
CREATE OR REPLACE FUNCTION public.supersede_charge_attempt_for_user(
  p_order_id           uuid,
  p_user_id            uuid,
  p_reason             text,
  p_successor_order_id uuid
)
RETURNS jsonb  -- {superseded: boolean}(true=CAS 成功 pending→released+標記 / false=任一閘否決)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order record;
  v_succ  record;
  v_now   timestamptz;
  v_n     integer;
BEGIN
  -- 🔴 R2-nit:時間一次取 clock_timestamp() 存起來、全支共用。
  --    用 now()(=交易起始時間)比對 released_at 會有一個真實的誤判:長交易在較晚的 statement
  --    讀到「本交易開始之後才提交」的 released_at 時,那個值會比 now() 大 ⇒ 被閘⑦ 誤判成「未來」
  --    ⇒ 合法路徑回 false。取一次 clock_timestamp 讓比較基準與寫入基準一致。
  -- 🔴 MF-A(code-reviewer 抓到,本輪最貴):本支抄了 A8c1 的**雙真相表取消檢查**,
  --    卻沒抄它配套的**隔離閘**。非 READ COMMITTED 下,`FOR UPDATE` 等鎖醒來後快照仍是舊的
  --    ⇒ 看不到「已提交的取消」⇒ 對一張已取消的單讓路並蓋標記
  --    ⇒ L5b 之後疊在取消線上**重複退款**。姊妹支 20260809210000:83-85 逐字有這道,
  --    它的註解寫的就是這個 race。fail-closed 放在**任何觸表動作之前**。
  --    正常呼叫端(單語句 autocommit)恆 RC、不受影響。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'supersede_charge_attempt_for_user: isolation guard' USING ERRCODE = 'P5A02';
  END IF;

  v_now := pg_catalog.clock_timestamp();
  -- 值域 fail-closed:呼叫端傳錯值 = 程式錯誤,要吵不要靜。
  -- 🔴 R1-MF6:用**專屬 SQLSTATE**,不用通用 P0001 —— 呼叫端必須分得出
  --    「不可重試的契約錯誤」與「一般系統錯誤」;分不出來就可能走進「釋放按鈕允許重試」那條路。
  IF p_reason IS NULL OR p_reason NOT IN ('record_not_found', 'stuck_pending') THEN
    RAISE EXCEPTION 'supersede_charge_attempt_for_user: p_reason 值域錯誤(%),只收 record_not_found|stuck_pending', p_reason
      USING ERRCODE = 'P5A01';
  END IF;

  -- 🔴 R1-MF2(本輪最貴的一條,錢面):`payment_status = 'unpaid'` 寫在 UPDATE 的 WHERE 裡
  --    只是 **MVCC 快照讀**,不是鎖。`confirm_order_payment` 可以已經鎖住這張 order、正要提交 paid,
  --    而本支在 READ COMMITTED 下仍看得到舊的 unpaid ⇒ 先把 attempt release + 蓋標記,
  --    confirm 隨後完成 ⇒ **L5b 會把一筆正常完成的付款當成被放棄的授權退掉**。
  --    修法 = 先對 order 取 FOR UPDATE、在鎖下重驗,再動 attempt。
  -- 🔴 鎖序不得反過來:orders → payment_charge_attempts,與 begin_charge_attempt(20260809210000:88-92)
  --    及 confirm 同序。先鎖 attempt 再補 order lock 會與 confirm 形成反向鎖序 ⇒ 40P01
  --    (本 repo 已有 A2b1/A8c1 兩次死結實錘,不重蹈)。
  -- 🔴 R2-MF3(交叉死結):寫 superseded_by_order_id 會因 FK 隱含鎖到 successor
  --    ⇒ 兩筆交叉呼叫(O1→O2 與 O2→O1)可以各自先鎖住自己那張、再互等對方 ⇒ 40P01。
  --    「orders→attempt」那條鎖序**沒有涵蓋第二張 order**。
  --    修法 = 一次把「舊單 + 非 NULL successor」依 **id 固定升序**鎖齊,消除交叉等待的可能。
  --    (本 repo 已有 A2b1/A8c1 兩次死結實錘,固定序是那兩次的既有結論。)
  PERFORM 1
     FROM public.orders o
    WHERE o.id = p_order_id
       OR (p_successor_order_id IS NOT NULL AND o.id = p_successor_order_id)
    ORDER BY o.id
      FOR UPDATE;

  SELECT o.customer_user_id, o.payment_status, o.cancelled_at
    INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id;
  -- 🔴 C4:七條否決路徑原本同回 {superseded:false} ⇒ 出事那天分不出是哪一條擋的。
  --    加 reason 鍵(**相加式**,不動既有 superseded 鍵 ⇒ 舊呼叫端不受影響)。
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('superseded', false, 'reason', 'order_not_found');
  END IF;

  -- 🔴 R1-MF1:歸屬要對**orders 本尊**驗,不能只信 attempt 上那個反正規化欄。
  --    `payment_charge_attempts.customer_user_id` 沒有複合 FK 保護(20260612150000:89-92),
  --    兩者一旦不一致,就能替別人的訂單蓋上我的讓路/退款標記。
  IF v_order.customer_user_id IS DISTINCT FROM p_user_id THEN
    RETURN pg_catalog.jsonb_build_object('superseded', false, 'reason', 'order_owner_mismatch');
  END IF;

  -- 鎖下重驗 unpaid(這才是真正的 TOCTOU 關閉點)
  IF v_order.payment_status <> 'unpaid'::public.payment_status THEN
    RETURN pg_catalog.jsonb_build_object('superseded', false, 'reason', 'order_not_unpaid');
  END IF;

  -- 🔴 舊單已取消 ⇒ 不由本支處理(fail-closed)。取消線(A8a 家族)有它自己的釋鎖與退款語意,
  --    在這裡蓋上「讓路」標記會讓 L5b 對一張已取消的單做補償判斷 —— 那不是本片的授權範圍。
  --    🔴 可用性代價(MF-B:前一版寫「per-user 閘只擋 10 分鐘,不會永久卡住」是**錯的**,
  --       它只對異 cart 成立):同 `cart_session_id` 的 cart dedup **無時限、且排在 per-user 閘之前**
  --       (20260809210000:120-158)⇒ **客人原地重試**(最常見的那條路)在 TapPay 打不通期間
  --       **沒有任何自動出口** —— 舊 attempt 出不去、新單也建不起來。
  --       ⚠️ 這條代價決定 L5a-2 要不要給人工出口;**「要不要開人工出口」是產品行為題 ⇒ 排 Sean**,
  --       不在本片拍。異 cart 才有 10 分鐘年齡條件那個出口。
  -- 🔴 R2-MF1:取消的真相是**兩張表**(A8c1 逐字:20260809210000:100-103)——
  --    `orders.cancelled_at` 與 `order_cancellations` 本表。前一版只查前者
  --    ⇒ 已有取消紀錄但 cancelled_at 還沒寫上去的那個中間態,會被讓路並蓋上退款標記。
  IF v_order.cancelled_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN
    RETURN pg_catalog.jsonb_build_object('superseded', false, 'reason', 'order_cancelled');
  END IF;

  -- 🔴 R2-MF2:successor 的三項檢查前一版寫在 UPDATE 的 EXISTS 裡 = **未鎖定的快照讀**。
  --    confirm / 取消 / 歸屬轉移只要在那個 EXISTS 之後提交,我們就會記下一張已付款、已取消
  --    或已換會員的訂單 —— 而檔頭正是拿這三項在對外宣稱保證。上面已用固定序鎖齊,這裡在鎖下重驗。
  IF p_successor_order_id IS NOT NULL THEN
    IF p_successor_order_id = p_order_id THEN
      RETURN pg_catalog.jsonb_build_object('superseded', false, 'reason', 'successor_is_self');
    END IF;
    SELECT s.customer_user_id, s.payment_status, s.cancelled_at
      INTO v_succ
      FROM public.orders s
     WHERE s.id = p_successor_order_id;
    IF NOT FOUND
       OR v_succ.customer_user_id IS DISTINCT FROM p_user_id
       OR v_succ.payment_status <> 'unpaid'::public.payment_status
       OR v_succ.cancelled_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_successor_order_id) THEN
      RETURN pg_catalog.jsonb_build_object('superseded', false, 'reason', 'successor_invalid');
    END IF;
  END IF;

  UPDATE public.payment_charge_attempts a
     SET status                    = 'released',
         released_at               = COALESCE(a.released_at, v_now),  -- write-once、不覆蓋
         superseded_at             = v_now,
         superseded_reason         = p_reason,
         superseded_by_order_id    = p_successor_order_id,
         settle_attempt_count      = 0,
         needs_manual_review       = false,
         released_manual_review_at = NULL,
         next_settle_at            = v_now + interval '5 minutes'   -- 低頻續對帳(L5b 盯梢靠它)
   WHERE a.order_id         = p_order_id                                        -- 閘①
     AND a.customer_user_id = p_user_id                                         -- 閘②(與上面 orders 本尊那道並存)
     AND a.status           = 'pending'                                         -- 閘③ charged 絕不讓路
     -- 🔴 R1-MF5b:write-once **不是**靠閘③ 保證的(檔頭前一版這句話是錯的)——
     --    pending 列身上完全可以已經帶著一組合法的 superseded_*(五條 CHECK 都允許),
     --    那樣本支會**覆寫 durable 標記**。要明文擋。
     AND a.superseded_at IS NULL                                                -- 閘⑥ 真 write-once
     -- 🔴 R1-MF5a:released_at 若是**未來**時間,COALESCE 會保留它,而 superseded_at=now()
     --    ⇒ 直接撞 L5a-M 的 after_release CHECK 變成 23514,而不是乾淨回 false。
     --    異常列要被閘擋成 false,不該讓呼叫端收到約束例外。
     AND (a.released_at IS NULL OR a.released_at <= v_now);                     -- 閘⑦
     -- 閘⑤(successor 非自己 / 同會員 / unpaid / 未取消)已在上面**鎖下**驗完,不再放這裡:
     -- 放在 UPDATE 的 EXISTS 裡等於未鎖快照讀,那正是 R2-MF2 打掉的形狀。

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN pg_catalog.jsonb_build_object(
    'superseded', v_n = 1,
    'reason', CASE WHEN v_n = 1 THEN 'ok' ELSE 'attempt_gate' END);
END;
$fn$;

-- 🔴 R1-MF3:把 L5a-M 那一欄的語意就地降級。原 COMMENT 說它是「因本 attempt 讓路而被放行的新單」,
--    但本支證不到「被放行」——那是之後 begin_charge_attempt 的另一次獨立競爭。留著會讓 L5b 誤信。
COMMENT ON COLUMN public.payment_charge_attempts.superseded_by_order_id IS
  'M-4b L5a-M(語意由 L5a-1 降級,codex 關卡2 R1-MF3):**提出讓路要求的訂單** order id —— 不是「實際受益/被放行的新單」。寫入端 supersede_charge_attempt_for_user 只保證它是一張同會員、未付款、未取消的訂單;真正拿到新 charge attempt 的可能是另一張(兩張新單同時撞同一張舊單時,讓路者與勝出者可以不同)。🔴 L5b 硬契約:本欄只供稽核與追線,**不得**用來做金額或歸屬推論。方向仍單向:非 NULL ⇒ 觸發 A;NULL 推不出觸發 B(觸發 A 漏寫也會落成 NULL)。CHECK 保證:非 NULL 蘊含 superseded_at 非 NULL、且不等於自己的 order_id。';

COMMENT ON FUNCTION public.supersede_charge_attempt_for_user(uuid, uuid, text, uuid) IS
  'M-4b L5a-1 server-only 讓路 CAS(payment_confirmer、SECDEF、search_path='''')。母 plan §3.1 觸發 A/B 共用:把「查無 / 恆 4 PENDING」的舊在途 attempt 由 pending→released,同交易蓋 L5a-M durable 標記(superseded_at/reason/by_order_id)供 L5b 補償盯梢認人,並重置 settle_attempt_count=0 / needs_manual_review=false / released_manual_review_at=NULL / next_settle_at=now()+5min(留在對帳集)。流程:一次依 id 升序鎖齊「舊單 + 非 NULL successor」(避免 O1→O2 與 O2→O1 交叉 40P01)→ 鎖下驗舊單(歸屬 / unpaid / 取消**兩張真相表** orders.cancelled_at 與 order_cancellations)→ 鎖下驗 successor(非自己 / 同會員 / unpaid / 未取消)→ 單一 UPDATE 動 attempt。attempt 側四閘:order_id + customer_user_id(反正規化欄與本尊各驗一次)+ status=pending(🔴 charged 絕不讓路=錢可能已動)+ superseded_at IS NULL(**真 write-once**:pending 列可能已帶合法標記,閘③ 保證不了)+ released_at 不在未來(否則撞 CHECK ⑤ 變 23514 而非乾淨 false)。任一不符 rowcount=0、狀態不動、回 {superseded:false}。p_reason 值域錯誤走 RAISE 且用**專屬 SQLSTATE P5A01**(呼叫端要分得出契約錯誤與系統錯誤)。時間一次取 clock_timestamp() 全支共用。🔴 零等待:無任何年齡條件(Sean 逐字)。不碰 confirm_order_payment、不寫 order_payments、不動錢。只 payment_confirmer 可呼。';


-- ── 2. ACL(對齊 R1a3 20260624120002:81-94:REVOKE 四方 + GRANT payment_confirmer + fail-closed assert)──
REVOKE ALL ON FUNCTION public.supersede_charge_attempt_for_user(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.supersede_charge_attempt_for_user(uuid, uuid, text, uuid) TO payment_confirmer;

DO $$
DECLARE v_grantees text;
BEGIN
  -- 🔴 窮舉而非抽查:抽查三個角色證不了「只有 payment_confirmer」(A8c1/L4a-1 同款理由);
  --    is_grantable 併進指紋,免得有人拿到 GRANT OPTION 再轉授。
  SELECT string_agg(g, ',' ORDER BY g)
    INTO v_grantees
    FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
                 || CASE WHEN a.is_grantable THEN '+GRANTOPT' ELSE '' END AS g
            FROM pg_proc p, aclexplode(p.proacl) a
           WHERE p.oid = 'public.supersede_charge_attempt_for_user(uuid,uuid,text,uuid)'::regprocedure
             AND a.privilege_type = 'EXECUTE') t;
  IF v_grantees IS DISTINCT FROM 'payment_confirmer,postgres' THEN
    RAISE EXCEPTION 'L5a-1 ACL 窮舉異常 — EXECUTE grantee 全集=[%],應恰 payment_confirmer,postgres 且零 GRANT OPTION;拒繼續', v_grantees;
  END IF;
END
$$;

-- 🔴 R1-MF7:可呼面 —— 直接 ACL 窮舉(上一段)只看得到 proacl 那一層,
--    「別的角色 GRANT payment_confirmer TO 它」造出的可呼身分完全看不到。
-- 🔴 重設計(2026-08-10,MAIN-005 apply 發火後,Sean 拍 A 交 P 窗):
--    前版斷「payment_confirmer 零直接成員」,在正式庫必炸 —— postgres 是本函式 owner、
--    又因 CREATEROLE 建角色時 PG 自動授予而成了 payment_confirmer 成員。那是**既有現實且不新增可呼面**
--    (owner 本來就呼得到、還能自己改 ACL),不是威脅 ⇒ 前版是**假警報**,不是「守太嚴」。
--    🔴 換面而非放寬(memory `feedback_guard-drawn-at-narrowest-surface-not-invariant`):
--    真正的不變量是「**誰呼得到這支 RPC**」,不是「誰是 payment_confirmer 的成員」。
--    🔴 判準=**非 inert 身分取得閉包**(codex R1 兩 must-fix + R3/Fable MF-A;PG17.10 本機實測釘死,非推理):
--      角色 r **以自己或取得得到的身分直接 EXECUTE 得到本 RPC**
--        ⟺ ∃ s ∈ 閉包(r):has_function_privilege(s, fn, 'EXECUTE')
--      閉包(r) = {r} ∪ 沿 pg_auth_members **任一非 inert 邊**反覆可達的角色(遞迴)。
--      🔴 「非 inert」= set_option OR inherit_option OR admin_option 三者任一為真(R3/Fable MF-A):
--        · set   ⇒ 可 SET ROLE 直接變成它;
--        · inherit ⇒ 自動就有它的權限(has_function_privilege 那層已看得到,列進來不新增誤判);
--        · admin ⇒ 🔴 **可以 `GRANT 該角色 TO 自己` 再變成它** —— 只走 set_option 會**靜默放過**這種角色,
--          而前版「零直接成員」斷言反而攔得住它 ⇒ 那是本次重設計自己造出來的**回歸**,不是既有缺口。
--        · 三者皆假(inert 成員)⇒ 這條邊什麼也做不到,不走(否則就是 R1-MF2 那種誤擋)。
--      has_function_privilege 自身已含 inherit_option 那一層 ⇒ 兩層合起來才是完整**直接**可呼面。
--      ⚠️ 逐字注意「直接」二字(codex R2-MF1):**間接入口不在本段射程**——見誠實邊界第 4 條。
--    ⚠️ 為什麼**不能**用 pg_has_role(...,'MEMBER') 當可達性(實測 PG 17.10,三個都是真值):
--      ① `GRANT pc TO r WITH INHERIT FALSE, SET FALSE`(inert)⇒ has_fn_priv=false 但 MEMBER=**true**
--         ⇒ 拿 MEMBER 當判準會**誤擋呼不到的角色**,重演 MAIN-005 那種假警報。
--      ② `GRANT owner TO r WITH INHERIT FALSE, SET TRUE` ⇒ has_fn_priv=false 且 MEMBER(pc)=**false**,
--         但 r 可 SET ROLE 成 owner 再呼 ⇒ 拿 MEMBER 當判準會**整個漏抓**這條。
--    白名單恰兩種,且**兩種都構造得出正測**(不用 rolname='postgres' 那種本地測不到的名字白名單:
--    bootstrap superuser 禁降級 ⇒ 那個分支永遠驗不了 = 測不到的層不能宣稱被守住):
--      ⓐ 超級角色 —— ACL 本來就攔不住它,對它斷言=零判別力(同 supabase_admin 不可 REVOKE 那條);
--      ⓑ 閉包裡含**本函式 owner** 的角色 —— 它取得得到 owner 身分後可自行改 ACL/改函式,
--         能力嚴格強於「呼這支」,對它斷言同樣零判別力(prod 的 postgres 與 cli_login_postgres 即此)。
--    🔴 用同一個「非 inert 閉包」同時算可呼面與白名單,換到一個**不依賴未知值**的性質(R3/Fable C-1):
--       `MAIN-007-A` 只給了 usage/member 兩欄,cli_login_postgres → postgres 那條邊的
--       set/inherit/admin 三個 option **我們並不知道**。但無論它是哪一種組合,結論都一樣:
--         · 邊非 inert ⇒ 閉包含 owner ⇒ 白名單ⓑ 放行;
--         · 邊 inert  ⇒ 那條邊什麼也做不到 ⇒ has_function_privilege 為假 ⇒ 根本不進候選。
--       ⇒ apply 放行預測**不再是條件式的**,不必等那發 prod 查詢才敢說(仍以 MAIN-007-A 的角色清單完整為前提)。
--    其餘任何可達角色 ⇒ RAISE(fail-closed),專屬 SQLSTATE P5A03。
--    ⚠️ 誠實邊界(七條,不擴張宣稱):
--      1. 本段只在 **apply 當下**跑一次,擋不住 apply 之後才被授出的權限(那要 CI/定期稽核,
--         掛帳同 SOLE-WRITER / ACL-UNIVERSAL 兩道偵測器);
--      2. 白名單ⓑ 是**明示放行**、不是「證明它們無害」—— 正式庫 `postgres` / `cli_login_postgres`
--         確實呼得到這支動錢的 RPC,只是守它零收益(它們本來就能做更多)。**殘餘風險已列給 Sean**;
--      3. 擋不住超級角色事後自己開後門,也擋不住 owner 自己改 ACL;
--      4. 🔴 **只證直接可呼面,間接入口證不到**(codex R2-MF1):若日後有人建一支
--         SECURITY DEFINER 的 wrapper 函式(或 trigger)去呼本 RPC,拿得到那支 wrapper EXECUTE 的角色
--         就繞過本段 —— 它對本 RPC 的 has_function_privilege 是 false、也沒有 SET ROLE 路徑,本段看不到。
--         要連間接入口一起守,得另做 wrapper/trigger 入口稽核(與 SOLE-WRITER 同一個掛帳桶);
--      5. 🔴 **守的是「任何角色身分持有可呼權」,不是「誰實際登得進來呼」**(codex R2-MF2):
--         枚舉以**所有** pg_roles 為根,所以連 NOLOGIN、且沒有任何非白名單角色能成為它的葉角色
--         也會被擋下。這是**刻意的 fail-closed 代價**(要精準判「誰進得來」得先定義 session/proxy 根,
--         而 rolcanlogin 隨時可被 ALTER ⇒ 那個前提本身不穩)。代價=apply 可能被這種無害構型擋下,
--         真的遇到就排 Sean 拍板,不在這裡自行放寬。
--      5b. 🔴 **反向的一類要講清楚,免得被誤讀成誤擋**(code-reviewer N3):以 `INHERIT TRUE, SET FALSE`
--         繼承到 payment_confirmer 的角色**會被擋,而那是對的** —— 它不需要 SET ROLE,登入當下就
--         自動帶著那份權限、真的呼得到。它與第 5 條那種「持有權限但沒人進得來」是**不同成因**:
--         第 5 條是保守誤擋(可惜但刻意),這一類是**真陽性**。
--      6. 🔴 **硬相依 PostgreSQL 16+**(code-reviewer MF1):判準用的 `pg_auth_members.set_option /
--         inherit_option / admin_option` 三欄 PG16 才有。DO 區塊開頭已加版本閘明話擋下 PG15 以下。
--         正式庫實查 `supabase/.temp/postgres-version` = **17.6.1.111** ⇒ 今天不觸發;閘是回歸網。
--      7. ⛔ **apply 前置(主視窗清單持有,不由本檔執行)**:apply 之前先在**正式庫唯讀**跑一次
--         本段的**原字面 SELECT**(不是 harness 重建的拓樸)、斷言回 NULL。理由=harness 那格
--         (`REACH-PROD-SHAPE`)是手搭拓樸重演,證的是「本拓樸下放行」,**證不到正式庫現況**
--         (code-reviewer MF2 + R3/Fable C-1 同根)。這步由主視窗排、Sean 或屆時可用的 psql 路徑跑。
-- L5A1-INHERIT-GUARD-BEGIN(harness 依此對錨點取整段,勿改字面)
DO $$
DECLARE
  v_fn    oid := 'public.supersede_charge_attempt_for_user(uuid,uuid,text,uuid)'::regprocedure;
  v_owner oid;
  v_bad   text;
BEGIN
  -- 🔴 版本閘(code-reviewer MF1):本段硬相依 PG16+ 才有的 pg_auth_members.set_option /
  --    inherit_option / admin_option 三欄。PG15 以下這三欄不存在 ⇒ 整段會炸在
  --    「column does not exist」,那種錯誤看不出根因、也分不清是守門真的發火還是環境不對。
  --    先明話擋掉。(正式庫實查 supabase/.temp/postgres-version = 17.6.1.111 ⇒ 今天不會觸發;
  --     這道是**回歸網**,防日後被搬到舊庫或降版重放。)
  IF pg_catalog.current_setting('server_version_num')::int < 160000 THEN
    RAISE EXCEPTION 'L5a-1 可呼面守門需要 PostgreSQL 16 以上(現為 %):判準相依 pg_auth_members 的 set_option/inherit_option/admin_option 三欄;拒繼續',
      pg_catalog.current_setting('server_version')
      USING ERRCODE = 'P5A03';
  END IF;

  SELECT p.proowner INTO v_owner FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;

  WITH RECURSIVE reach AS (
    -- 起點:每個角色以自己為根(閉包含自己)
    SELECT r.oid AS root, r.oid AS cur FROM pg_catalog.pg_roles r
    UNION
    -- 遞迴:沿任一**非 inert** 邊走(set=可變成它 / inherit=已經有它 / admin=可自授後變成它)。
    -- 🔴 admin_option 那項是 R3/Fable MF-A:漏掉它 ⇒ 持 ADMIN 的 inert 成員自授後即可呼、而守門看不到。
    SELECT k.root, m.roleid
      FROM reach k
      JOIN pg_catalog.pg_auth_members m
        ON m.member = k.cur
       AND (m.set_option OR m.inherit_option OR m.admin_option)
  )
  SELECT string_agg(DISTINCT rr.rolname, ',' ORDER BY rr.rolname)
    INTO v_bad
    FROM reach k
    JOIN pg_catalog.pg_roles rr ON rr.oid = k.root
   WHERE NOT rr.rolsuper
     AND rr.rolname <> 'payment_confirmer'
     AND pg_catalog.has_function_privilege(k.cur, v_fn, 'EXECUTE')
     AND NOT EXISTS (SELECT 1 FROM reach w WHERE w.root = k.root AND w.cur = v_owner);

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'L5a-1 可呼面異常 — [%] 以自己或取得得到的身分**直接** EXECUTE 得到本 RPC(直接授予 / 繼承 / SET ROLE / ADMIN 自授 任一);除 payment_confirmer 外只放行超級角色與可取得 owner 身分者,拒繼續。診斷:SELECT m.member::regrole, m.set_option, m.inherit_option, m.admin_option FROM pg_auth_members m WHERE m.member = ''<上列角色>''::regrole; ⚠️ 本判準不含間接入口(SECDEF wrapper/trigger),且以所有角色為根、NOLOGIN 葉角色也會被擋 —— 見本檔可呼面段誠實邊界 4/5 與 MAIN-005', v_bad
      USING ERRCODE = 'P5A03';
  END IF;
END
$$;
-- L5A1-INHERIT-GUARD-END

-- 🔴 R1-MF7:SECDEF fail-open 面(對齊 A8c1/L4a-1 20260809210000:291-300 的既有形狀,本片前一版漏了)。
--    本支是 SECURITY DEFINER 且讀 zero-policy 的表:owner 一旦漂移、或表被打開 FORCE RLS,
--    UPDATE 與 EXISTS 會**靜默看不到資料** ⇒ RPC 永遠回 false ⇒ 客人永久卡住,而且不會有錯誤訊息。
DO $$
DECLARE v_fn_owner oid; v_bad text;
BEGIN
  SELECT proowner INTO v_fn_owner FROM pg_proc
   WHERE oid = 'public.supersede_charge_attempt_for_user(uuid,uuid,text,uuid)'::regprocedure;
  SELECT string_agg(c.relname, ',') INTO v_bad
    FROM pg_class c
   WHERE c.oid IN ('public.orders'::regclass, 'public.payment_charge_attempts'::regclass,
                   'public.order_cancellations'::regclass)  -- R2-MF1:取消真相表也在 SECDEF 讀取面上
     AND (c.relowner <> v_fn_owner OR c.relforcerowsecurity);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'L5a-1 SECDEF fail-open 面 — [%] owner 不對齊或 FORCE RLS on ⇒ 本支會靜默讀空;拒繼續', v_bad;
  END IF;
END
$$;

COMMIT;
