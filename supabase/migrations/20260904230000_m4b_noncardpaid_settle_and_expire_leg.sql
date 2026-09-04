-- M-4b · ⟦b4-NONCARDPAID1⟧ 非卡片收款要能把訂單結清, 而逾期 cron 不得殺掉已收錢的單
-- ==========================================================================
-- 🔴🔴 **本片【涵蓋】20260903080000_m4b_expire_unpaid_by_payment_channel.sql** ——
--    那支(匯款/現金 5 天, Sean 2026-09-03 逐字「乙 5天」「甲 跟匯款一樣 5 天」)**不必另貼**。
--    本片第 4 節整支逐字含它, 再多一條腿。
--    ⇒ 📌 為什麼合成一支:那支**未經 codex**(當晚 codex 404, 改用 adversarial-reviewer),
--       而它動的是錢那條路 ⇒ 主視窗 2026-09-04 判「不單獨貼, 併進本片一起過 codex」。
--
-- ── 這一片在補什麼洞 ──────────────────────────────────────────────────────
--   客人匯款進來 ⇒ 員工在後台記一筆 `order_payments` ⇒ 🔴 **訂單的 payment_status
--   一個字都不會動, 它還是 `unpaid`** ⇒ 隔天(或 5 天後)逾期 cron 把它取消。
--   ⇒ 🎯 **錢收了, 單被系統自己殺掉。**
--
-- ── 形狀:一個掛點, 不是兩個(Sean 2026-09-01 拍「甲 只交一個」)────────────
--   > 你說「加兩個觸發器」, 而我交【一個】。不是做不到 —— 是查下去發現第二個早就有人做好了。
--   > 那另一半誰在管:`admin_record_manual_refund` 自 2026-08-23 起會呼叫
--   > `pcm_sync_order_refund_payment_status`
--   > (`20260823020000_m4b_refund_notify_p2a_record_calls_sync.sql`, 檔名逐字
--   >  `record_calls_sync`;該檔 :17 逐字「只加這一行, 其餘一字未改」)。
--   > 我再加一個會變成第二個寫入端, 而兩邊用不同的算法 ⇒ 訂單會永遠停在「部分退款」。
--   > **⇒ 所以少的那一個不是漏掉, 是【不該加】。**
--
--   🔴🔴 **[2026-09-04 訂正 · 上面那句「早就有人做好了」【疑似不成立】]**
--   🔬 `docs/specs/2026-09-01-m4b-noncardpaid-settle-v3.sql:1-11` 逐字:
--      「`pcm_sync_order_refund_payment_status` 只加總 `order_refunds` 且 `status='confirmed'`,
--        **它提到 `order_manual_refunds` 0 次**」
--      ⇒ `admin_record_manual_refund` 寫 A 表、然後呼叫一支只讀 B 表的同步器
--      ⇒ 它算到 0 ⇒ 提早 return ⇒ **狀態從來沒有被改過。**
--   ✅ **我當場複量, 而 v3 是對的**(只量那支函式體 `20260823020000:239-286`):
--        `order_manual_refunds` = **0** · 🟢 正對照 `order_refunds` = 1 / `payment_status` = 9
--        ⚪ 負對照 = 0
--      ⚠️ **而第一發我量整支檔 ⇒ 命中 3, 看起來 v3 錯了** —— 開檔看那 3 處(`:395`/`:447`/`:526`)
--        **全部在那支同步器【之外】**, 屬於別的函式。
--        ⇒ 📌 **差一步就把「整支檔的計數」讀成「那支函式的行為」。**
--   🛑 **⇒ 本片的【動作】不受影響**(有退款活動一律 RETURN、一個字都不寫 —— 那是安全的);
--      **變假的是【理由】**:我說「交還給有人管的管線」, 而**可能根本沒有人在管**。
--      ⇒ 🎯 **一個正確的動作配一個錯的理由 —— 而下一個人會照那個理由去做決定。**
--   ⚠️ **寫成「疑似」是刻意的**:我只複量了**一支**函式;全 repo 還有沒有別人在翻它, **我還沒掃**。
--      ⇒ 板列 `⟦b4-MANREFUNDNOOWNER2⟧`(本 commit 開);掃全 repo 那半是**下一件**, 尚未做。
--   🔵 **舊字面全部留著不刪** —— 讓下一個讀到「早就有人做好了」的人, 同一發撞到這段訂正。

--   🔵 檔名與行號寫在這裡, 是因為**下一個懷疑這件事的人**會開這支檔。
--   📎 拍板原話 `~/pcm-mailbox/存檔-主視窗-0a-20260901-2235.md:33`;plan = v4。
--
-- ── 節次 ⛔ ~~原標題「四節」而底下列了六項~~ **作廢**(交件前逐句核檔頭時自己抓到)──────
--   ⚠️ 而它不是筆誤:折 codex 那 9 條時我**加了 4b / 4c / 4d 三節**, 而標題與清單都沒跟著動。
--   🎯 📌 **一個數字寫在它所數的東西旁邊, 而那個東西會長 —— 而數字不會跟著長。**
--   1.  前置閘 ×3(心跳表在 / 線上那代含心跳 / 我是 OP6a 的 owner)
--   2.  `pcm_noncard_settle_recompute(uuid)` 重算函式(advisory xact lock + 樂觀鎖 + 整段 EXCEPTION)
--   3.  掛點 `order_payments` AFTER INSERT ×1(`order_manual_refunds` 上刻意不掛第二個)
--   4.  `pcm_cron.expire_unpaid_orders` = 0903:107-232 逐字 + 淨額腿
--   4b. 搬 0903:243 的 `COMMENT ON FUNCTION`(訂正它那句「本片不修 NONCARDPAID」)
--   4c. 搬 0903:265-285 的 cron 權限零漂移斷言
--   4d. 訂正被本片弄假的三處既有 catalog COMMENT
--   5.  事後斷言(⚠️ **條數不寫死** —— 數法:`grep -c '事後.*失敗' <本檔>` 當場跑。
--       含**兩條負斷言**:掛點不得出現在別的表上 · 不得有別的函式呼叫重算)
--   6.  還原(⚠️ **是註解** —— 要用請自己拿掉 `-- `;⛔ ~~舊字面「可直接貼的 SQL, 不是註解」~~ 作廢, 見該節)
--
-- ── 🔴 codex R1 判 FAIL(11 must-fix), 折了 9 條, 剩 2 條【沒修, 開了板列】────────
--   ⟦b4-NCPCRONRACE⟧      逾期 cron 先鎖住那張單, 收款才落帳 ⇒「已取消而錢在裡面」
--     🔬 codex 逐字(本檔 :294 那一帶):「cron 先取得 FOR UPDATE 時, 收款 INSERT 會在
--        FK KEY SHARE 等待;cron 先取消後, 收款才落帳, 最終可形成【已取消但淨收款 > 0】。」
--     🔵 既有安全網:`20260901080000_m4b_autorefund_pending_refunds.sql`(帳本已 apply)
--        在整單取消那一刻逐軌開一筆待退款 ⇒ **錢落到 order_pending_refunds, 不是消失。**
--     🛑 而「有網接住」不等於「沒事」—— 客人的單被取消了, 而他的錢要走人工退款 ⇒ **他會打電話來。**
--   ⟦b4-NCPCANCELROLLBACK⟧ `WHEN OTHERS` 不接 query_canceled ⇒ 撞 statement timeout 時
--        客人那筆收款仍會回滾, **而那正是本檔宣稱不會發生的事**(見上面那段誠實邊界)。
--     🔬 而它不是本片獨有:`20260903080000` 的心跳段是**同一個形狀**, 且該檔自陳是已知殘留風險
--        ⇒ 📌 **單獨為本片解它, 會變成只有這一片特別。**
--   🔴 **這兩條的「先不修」是線【信】`-mail` 2026-09-04 判的, 未經 Sean** —— 引用時不要當成他的話。
--   ⚠️ 而**我沒有量過這兩條的觸發頻率** ⇒ 「很少發生」這句話沒有來源, 本檔任何地方都不得這樣寫。
--
-- ── 🔬 要驗這支檔的人先讀:它有【三個】獨立的檢查區塊, 不是一個 ────────────
--   (fresh-context 驗證者 2026-09-04 交的地圖 —— 而它是**撞出來的**:
--    三發突變第一次**全部印綠**, 成因是插在檢查點後面。)
--   A `$pre$`      前置閘①②③ —— 問的是【貼之前】那個世界, 不是突變靶
--   B `$post0903$` 4c:cron 的 owner / SECDEF / search_path / ACL 漂移(繼承自 0903:265-285)
--   C `$post$`     事後①-⑤:本片 trigger 唯一性 / ACL / cron 的心跳·5天·分流·淨額腿字面
--   🔴 **突變要插在【它要測的那個區塊之前】** —— B 插在「── 4c.」標題前, C 插在「── 5.」標題前。
--   🛑 統一插在檔尾(COMMIT 之前)**會錯過全部三個, 而它印綠。**
--   ⇒ 📌 **一發突變全綠有兩種原因:斷言太弱, 或【那個突變根本沒落在目標上】** —— 而兩者印同一個綠。
--   ⚠️ 行號會漂, 用**標題字面**當錨(`── 4c.` / `── 5.`), 不要用行號。
--   🔬 **而它【當場漂給我看】**:同一輪驗證裡兩次量到不同座標 ——
--      `$pre$` :72 ⇒ :83 · `── 4c.` :492 ⇒ :511 · `── 5.` :590 ⇒ :609(三個都動了)。
--      ⇒ 📌 **上面那句「行號會漂」不是保守起見, 是量到的。**
--   🔴 **還原步驟(本片【不冪等】, 下一個要複驗的人必讀)**:裸 `CREATE` ⇒ 重貼會 rc≠0
--      ⇒ 要再跑一次完整 apply, 得先手動退回:
--        `DROP TRIGGER pcm_noncard_settle_after_payment_ai ON public.order_payments;`
--        `DROP FUNCTION public.pcm_noncard_settle_after_payment();`
--        `DROP FUNCTION public.pcm_noncard_settle_recompute(uuid);`
--        再把 `20260903080000:107-232` 抽出來重貼一次(把 cron 退回沒有淨額腿的那一版)。
--      🔵 這一段是驗證者交的, 寫在這裡是**讓下一個人不必重新摸索** —— 而他不會知道要去問誰。
--
-- ── 🛑 這一版證不到什麼 ──────────────────────────────────────────────────
--   · 正式庫**現在**跑的是哪一代 expire_unpaid_orders —— 帳本說 20260809160000,
--     而 20260903080000:26 說作者 dump 過、活的是 20260828060000 ⇒ **帳本落後現實**
--     ⇒ 所以第 1 節那道閘問的是正式庫本人, 不是帳本。
--   · 今天有沒有真的踩到 —— 顧客站匯款結帳的 flag(`BANK_TRANSFER_CHECKOUT_ENABLED`)是關的,
--     🔴 **今天沒有人受害的理由是還沒有人走那條路, 不是有東西擋著。**
--   · 那支 cron 現在有沒有真的在跑 —— 本機是 fake cron, 本片驗不到。
-- ==========================================================================

-- 🔴🔴 **整支包進一個交易** —— 而這一行是 fresh-context 驗證者實測逼出來的:
--    檔頭原本宣稱「任何一條不成立就整個交易回滾」, 而**檔裡 11 個頂層陳述式、0 個 `BEGIN;`**
--    ⇒ 每一句各自 autocommit ⇒ 事後斷言炸掉時, **壞版本的函式【已經是活的】**。
--    🔬 實測(C2 突變):刪掉淨額腿 ⇒ 事後⑤a 抓到、rc=3, 而那一版函式留在庫裡、真的誤取消訂單。
--    🎯 ⇒ **一句『失敗會回滾』的宣稱, 讓失敗看起來是安全的 —— 而它是這份檔裡最貴的一句話。**
-- 🔵 Supabase SQL Editor 本身也會包交易 ⇒ 這裡的 BEGIN 會是 no-op 警告, 而 COMMIT 是最後一句
--    ⇒ 兩種貼法都安全(psql -f 也對)。
BEGIN;

-- ══ 1. 前置閘(貼下去之前它自己去讀正式庫, 不合就拒繼續)══════════════════
DO $pre$
DECLARE
  v_src   text;
  v_owner name;
BEGIN
  -- ① 心跳表在(第 4 節那段逐字要寫它)
  IF to_regclass('public.sweeper_heartbeat') IS NULL THEN
    RAISE EXCEPTION '前置閘①失敗:public.sweeper_heartbeat 不存在 ⇒ 第 4 節會炸。先貼 20260817070000。';
  END IF;

  -- ② 我要 CREATE OR REPLACE 的那支 cron 函式**必須已經含心跳** ——
  --    不含 ⇒ 線上跑的是 20260809160000 那一代, 而那代與本片的假設不同 ⇒ 停下來讓人看。
  -- 🔴 主視窗 2026-09-04 判:**接受 0828 或 0903 任一代** —— 帳本說 0828 沒貼, 而
  --    20260903080000:26 逐字「我 dump 正式庫 ⇒ 含 heartbeat 3 處 ⇒ 活的是 20260828060000」
  --    ⇒ 📌 **帳本落後現實 ⇒ 這道閘問的是【正式庫本人】, 不是帳本。**
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pcm_cron' AND p.proname = 'expire_unpaid_orders';

  IF v_src IS NULL THEN
    RAISE EXCEPTION '前置閘②失敗:pcm_cron.expire_unpaid_orders 不存在。';
  END IF;

  -- 🔴🔴 **先剝註解再 strpos** —— 今天已經有四次假綠是這麼來的:
  --    `prosrc` 含註解, 而註解裡最會出現你正要斷言的那個字面。
  --    ⇒ 把述詞整行刪掉、註解留著, 這道閘照樣印綠。
  v_src := pg_catalog.regexp_replace(v_src, '--[^' || chr(10) || ']*', '', 'g');

  IF pg_catalog.strpos(v_src, 'sweeper_heartbeat') = 0 THEN
    RAISE EXCEPTION '前置閘②失敗:線上那代 expire_unpaid_orders **不含心跳**(剝註解後仍 0 命中)⇒ 是 20260809160000 那一代。停下來讓人看, 不要讓本片把它換掉。';
  END IF;

  -- ③ 我必須是 OP6a 的 owner —— 不是的話 CREATE OR REPLACE 會失敗在半路,
  --    而前面兩件已經做完 ⇒ 寧可一開始就拒絕。
  SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO v_owner
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_compute_order_settlement';

  IF v_owner IS NULL THEN
    RAISE EXCEPTION '前置閘③失敗:public.admin_compute_order_settlement 不存在 ⇒ 本片的重算沒有計算器可呼叫。';
  END IF;
  IF v_owner <> current_user THEN
    RAISE EXCEPTION '前置閘③失敗:目前身分 % 不是 OP6a 的 owner(%)⇒ 換 owner 身分再貼。', current_user, v_owner;
  END IF;
END
$pre$;
-- 🔴🔴 **本片兩支【新】函式用裸 `CREATE`, 不是 `CREATE OR REPLACE`**
--    (`.husky` 的 `migration-new-file-static-checks` 規則①擋下來的, 而它擋得對):
--    新物件用 OR REPLACE ⇒ **撞名會被靜靜蓋掉**, 而 REVOKE 與斷言照樣全綠
--    ⇒ 拿到綠燈, 卻蓋掉了一個你不知道存在的東西。
-- ⚠️ **代價明寫**:本片因此**不是冪等的** —— 同一支貼第二次會在這裡 `ERROR: function already exists`。
--    ⛔ ~~早期版本宣稱「冪等:貼兩次 rc=0」~~ **作廢** —— 那是 OR REPLACE 版的性質。
--    🔵 而**那正是要的行為**:重貼一支已經貼過的 migration 應該出聲, 不該安靜地成功。
--    (第 4 節那支 cron 是**重定義既有物件** ⇒ 它照舊 `CREATE OR REPLACE`, 閘也判它合法。)
-- ══ 2. 重算函式 ═══════════════════════════════════════════════════════════
CREATE FUNCTION public.pcm_noncard_settle_recompute(p_order_id uuid)
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
  v_manual   bigint;
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
    --    完整因果與複量見檔頭那段訂正(該支同步器只讀 `order_refunds`, 不讀 `order_manual_refunds`)。
    --    🛑 **本片的動作不變**(一律 RETURN, 那是安全的);**變假的是理由。**
    --    ⇒ 板列 `⟦b4-MANREFUNDNOOWNER2⟧`。舊字面留著不刪。
    -- 🎯 codex 演出的後果:total=1000, 先人工退 400(v2 寫 partiallyRefunded), 之後卡片再退 600
    --    ⇒ 兩本退款帳合計已達 1000, 而卡片 helper 只看自己的 600
    --    ⇒ **狀態永久停在 partiallyRefunded, 不會成為 refunded。而它不報錯。**
    -- 🔵 voided_at 非空 = 那筆退款被作廢 ⇒ 錢沒有真的離開 ⇒ 不算退款活動。
    SELECT coalesce(pg_catalog.sum(m.refund_amount), 0) INTO v_manual
      FROM public.order_manual_refunds m
     WHERE m.order_id = p_order_id
       AND m.voided_at IS NULL;

    IF v_manual > 0 THEN
      RAISE LOG '[pcm_noncard_settle] order=% 有退款活動(manual=%) ⇒ 交還退款管線, 本片不寫',
                p_order_id, v_manual;
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
      -- 🛑 而「不翻是安全的」這句話**依賴本檔第 4 節那條 cron 腿** —— 沒有它, 這兩種單
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
$fn$;

-- 🔴 **列舉角色是黑名單, 它跟下一個沒想到的角色賽跑**(codex R1 must-fix, :227)——
--    原本只撤五個具名角色, 而 `payment_confirmer` / default ACL 的其他 grantee 不在名單裡。
--    ⇒ ✅ `FROM PUBLIC` + 逐名撤仍留著(它們是明示意圖), 而**真正的閘在事後斷言**:
--       那裡用 `aclexplode` 問「有沒有 owner 以外的 grantee」= 白名單, 不需要知道誰存在。
REVOKE ALL ON FUNCTION public.pcm_noncard_settle_recompute(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_noncard_settle_recompute(uuid) FROM anon, authenticated, authenticator, service_role;

-- ══ 3. 掛點:【一個】, 不是兩個 ═══════════════════════════════════════════
-- 🔴 為什麼是 AFTER INSERT 而不是 AFTER INSERT OR UPDATE OR DELETE:
--    `order_payments` 是 append-only —— `order_payments_immutable_bu` 擋 UPDATE、
--    `order_payments_no_delete_bd` 擋 DELETE ⇒ 沖銷是【插一列反號】, 不是改舊列
--    ⇒ AFTER INSERT 就涵蓋了三條路裡的兩條。
--    ⇒ 📌 寫 UPDATE/DELETE 進去不會更安全, 只會是兩段永遠不執行的碼 —— 而死碼會被
--       後人讀成「這裡有處理」。
-- 🛑🛑 **第二個掛點(order_manual_refunds)刻意【不做】** —— v4 §4 / Sean 2026-09-01 拍「甲 只交一個」
--    (`~/pcm-mailbox/存檔-主視窗-0a-20260901-2235.md:33` 逐字「匯款片從兩個 trigger 變一個」)。
--    ⇒ **少的那一個不是漏掉, 是【不該加】** —— 理由見上面 v_manual 那段。
--    🔵 這句寫在碼裡, 是因為【下一個懷疑「怎麼只有一個」的人】會開這支檔, 不會去翻 mailbox。
CREATE FUNCTION public.pcm_noncard_settle_after_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $tg$
BEGIN
  PERFORM public.pcm_noncard_settle_recompute(NEW.order_id);
  RETURN NULL;   -- AFTER trigger 的回傳值被忽略
END
$tg$;

-- 🔴 **列舉角色是黑名單, 它跟下一個沒想到的角色賽跑**(codex R1 must-fix, :227)——
--    原本只撤五個具名角色, 而 `payment_confirmer` / default ACL 的其他 grantee 不在名單裡。
--    ⇒ ✅ `FROM PUBLIC` + 逐名撤仍留著(它們是明示意圖), 而**真正的閘在事後斷言**:
--       那裡用 `aclexplode` 問「有沒有 owner 以外的 grantee」= 白名單, 不需要知道誰存在。
REVOKE ALL ON FUNCTION public.pcm_noncard_settle_after_payment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_noncard_settle_after_payment() FROM anon, authenticated, authenticator, service_role;

DROP TRIGGER IF EXISTS pcm_noncard_settle_after_payment_ai ON public.order_payments;
CREATE TRIGGER pcm_noncard_settle_after_payment_ai
  AFTER INSERT ON public.order_payments
  FOR EACH ROW EXECUTE FUNCTION public.pcm_noncard_settle_after_payment();

-- ══ 4. 逾期 cron:補上匯款那條腿 ══════════════════════════════════════════
-- 🔴🔴 **本節整支逐字取自 `20260903080000_m4b_expire_unpaid_by_payment_channel.sql:107-232`**
--    (該支尚未進帳本;本片是它的**超集** ⇒ 檔頭已寫明「該支不必另貼」)。
--    抽法 = `sed -n '107,232p'`, 未重打;插入後與原文 diff ⇒ **除新增那 17 行外零改動**。
-- 🛑 **而 v4 §4 逐字寫的是「從 `20260828060000:189` 抄」—— 那條指令是錯的。**
--    v4 寫於 2026-09-01, 而 09-03 又長出一代(Sean 逐字「乙 5天」/「甲 跟匯款一樣 5 天」)。
--    照 v4 抄 ⇒ `CREATE OR REPLACE` 會把那三行**整段蓋掉** ⇒ 匯款單回到 1 天就被取消,
--    而三綠全綠、審查看到的是「只改了一行」。
-- 🎯 而 `20260903080000:52` 逐字**預言了這一片**:
--    「那條待貼的錢守門**不含 payment_channel 字面** ⇒ 它若先上, 我四道閘全過、把它靜靜刪掉。」
-- 📌 ⇒ **一份 plan 寫下的「來源是哪一代」是個會過期的座標, 而它讀起來像事實。**
--    判別句:plan 裡任何「從 X 抄」都要**在動手當天重跑一次** `scripts/latest-definition-of.sh`,
--    不是照著抄。本片動手當天實測 ⇒ `newest = 20260903080000`。
CREATE OR REPLACE FUNCTION pcm_cron.expire_unpaid_orders(p_limit integer DEFAULT 500)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- 🔴 誠實邊界(codex 關卡2):本函式**完全信任 `orders.created_at`**,而那一欄沒有不可變守門 ——
  --    owner / migration 把它回填成舊日期,新單會提早被取消;改成未來,則永遠掃不到。
  --    不加守門的理由:owner 本來就能繞過任何 DB 層防線,為此加欄位級 trigger 的代價大於收益。
  -- p_limit fail-safe:NULL / <=0 一律退回 1(不接受「無上限」;0-worker 會靜默不處理)。
  -- ⚠️ 誠實邊界(codex 關卡2 nit):`LIMIT` 限的是**改幾列**,不是**掃幾列** —— 歷史 paid/failed 單一多,
  --    找候選的掃描成本仍會長,且本函式沒有 statement_timeout。現況存量 0、每小時一次 ⇒ 可接受;
  --    真的長起來時的修法 = 對 (payment_status, cancelled_at, created_at) 加部分索引 + 設 statement_timeout。
  IF p_limit IS NULL OR p_limit <= 0 THEN
    p_limit := 1;
  END IF;

  WITH target AS (
    SELECT o.id
      FROM public.orders o
     WHERE o.payment_status = 'unpaid'::public.payment_status
       AND o.cancelled_at IS NULL                                    -- 已取消/已失效 → 不重複寫(冪等)
       -- 🔴🔴 **2026-09-03 依 payment_channel 分流**(Sean 本人逐字回「乙 5天」)。
       --    ⛔ ~~原本是無條件 `interval '1 day'`~~ —— 而那一行**沒有濾 payment_channel**
       --      ⇒ 員工手動建的匯款單(`admin_create_manual_order` 只收 bank_transfer/cash)
       --        1 天後就被殺掉, 而**匯款常要 1-3 天**。
       --    📌 **而這不是有人忘了改** —— `20260809160000:66-69` 那一節標題逐字
       --      「重估觸發(Sean 拍板時逐字要求寫死在規格裡)」, 內容逐字
       --      「開放匯款付款時『1 天』**必須重看** … **1 天會把正常等匯款的單殺掉**」
       --      ⇒ 🎯 **那是一個【自己寫下失效條件】的數字, 而今天正是那個條件。**
       -- 🛑 **白名單, 不是黑名單** —— 只有【明列的三種】會被自動失效。
       --    ⇒ `none` 與**任何未來新增的 channel** 一律【不失效】。
       -- 🔴🔴 ⛔ ~~原本這兩行寫「只有這兩種」「`cash` / `none` 一律不失效」~~ **作廢** ——
       --    那是 Sean 補拍 cash 之前的殘留, 而我改了碼沒改它(code-reviewer C1 抓)。
       --    ⇒ 📌 **它會被寫進正式庫的 `prosrc`** ⇒ 下一個 `\df+` 開這支函式的人讀到的是假的。
       --    🎯 而那正是本檔自己在講的病:**一句話在兩個世界是同一個字串。**
       --    🔴 理由是不對稱的:**不失效是可逆的**(人可以手動取消),
       --      **失效是不可逆的**(那張單就沒了, 而客人今天連取消信都收不到)。
       --    🔴 `cash` = **5 天**(Sean 2026-09-03 逐字「甲 跟匯款一樣 5 天」)——
       --      ⚠️ 我原本刻意留白不敢比照, 而他自己答了。**現在它是拍板不是推論。**
       --    🛑🛑 **`none` 【明列排除】, 而它不是漏掉的** —— 那個值在 CHECK 裡合法
       --      (`20260712203000:51`)、而**今天沒有任何寫入端會寫它**, 也沒有人談過它該怎樣。
       --      ⇒ 🔴 **若寫成「其餘 ⇒ 5 天」, `none` 會靜靜地拿到一個沒有人決定過的行為。**
       --      ⇒ ✅ 所以這裡是**白名單明列三種**;`none` 與任何未來新 channel ⇒ **不失效**
       --        (不失效可逆 · 失效不可逆 ⇒ 不對稱)。`none` 要怎樣**待拍板**。
       --    🔴 **而「有人開始寫它的那天要回來看」不是一句提醒, 它有一個可機械跑的訊號**:
       --      `SELECT count(*) FROM public.orders WHERE payment_channel = 'none'` **> 0**
       --      ⇒ 📌 今天它是 0(零寫入端)⇒ **那個 0 就是「這條規則還沒承重」的意思**;
       --        它變成非 0 的那一天, 這一格的「不失效」才第一次真的擋到東西。
       --    🔵 `payment_channel` 是 `NOT NULL DEFAULT 'tappay'` ⇒ 沒有 NULL 那一格要處理。
       AND o.payment_channel IN ('tappay', 'bank_transfer', 'cash')
       AND o.created_at < pg_catalog.now() - CASE o.payment_channel
             WHEN 'tappay'        THEN interval '1 day'    -- 🔵 逐字不動(Sean 2026-08-09「1天」)
             WHEN 'bank_transfer' THEN interval '5 days'   -- 🔴 Sean 2026-09-03 逐字「乙 5天」
             WHEN 'cash'          THEN interval '5 days'   -- 🔴 Sean 2026-09-03 逐字「甲 跟匯款一樣 5 天」
           END        -- 🔴 1 天 = Sean 2026-08-09 逐字「1天」(落 memory project_m4b-b2-shipments-db-decisions:79;
       --    ⚠️ 那份 memory 內部編號 Q2 指的是天數,與本 plan §6 的 Q2「失效單不復活」是**不同的兩題**,別混)。
       --    重估觸發見檔頭。
       -- 🔴 安全核心:有任何非終態 attempt = 錢可能在途 ⇒ 一律不碰(留給對帳/人工)。
       --    條件與 admin_cancel_order 步7 逐字相同 ⇒ 兩個寫入端維持同一條不變量。
       --    ⚠️ 代價(code-reviewer N7):`released` 也被這條擋住 ⇒ **帶 released attempt 的單永遠不會被失效**。
       --    這是保守的正確選擇(released = 鎖已釋、仍在低頻對帳到 terminal),但它意味著那類單
       --    **在本片之後仍然沒有終點** —— 那正是 Q7/L5 要處理的「放棄型」殭屍,不在件① 範圍。
       AND NOT EXISTS (
             SELECT 1 FROM public.payment_charge_attempts a
              WHERE a.order_id = o.id
                AND a.status <> 'failed'
           )
       -- 🔴🔴 ⟦b4-NONCARDPAID1⟧ 新增的那一句(本片對 20260903080000 的【唯一】行為差異)。
       --    已收淨額 > 0 的單不取消 —— 客人錢已經進來了, 而狀態沒翻上去。
       -- 🔵 為什麼 `SUM(amount)` 就是淨額, 不必外接「哪些被沖掉了」:
       --    `order_payments` 是 append-only, 沖銷 = 插一列**反號**
       --    (`20260810100000_m4b_e10_op1_order_payments_m.sql:199` 逐字
       --     `amount integer NOT NULL CHECK (amount <> 0)`, 檔內 A10 拍板段
       --     逐字「P(+500)+R1(-500)+R2(+500) = 500」)⇒ 沖銷回 0 的單**恢復可取消**。
       -- 🛑 而它與上面那道 trigger 是**兩層不同的保護, 不是重複**:
       --    trigger 讓收到錢的單自己離開 `unpaid` 集合 ⇒ 涵蓋 verdict = settled / underpaid;
       --    這一句涵蓋 trigger **刻意不翻**的那兩種(overpaid / needs_human)——
       --    那兩種的錢一樣進來了, 而它們仍然是 `unpaid`。
       --    ⇒ 📌 少了這一句, 「不翻是安全的」這句話**不成立**。
       AND (
             SELECT coalesce(pg_catalog.sum(p.amount), 0)
               FROM public.order_payments p
              WHERE p.order_id = o.id
           ) <= 0
     ORDER BY o.created_at                                            -- 最舊的先處理(可預期、便於分批)
     LIMIT p_limit
     -- 🔴 字面精確(codex 關卡2 nit):SKIP LOCKED 只保證**本函式**跳過已被別人鎖住的列;
     --    若本函式先拿到鎖,後來的 admin 仍會等。稱「互不阻塞」不實,實際是「本函式不等別人」。
     FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE public.orders o
     SET cancelled_at     = pg_catalog.now(),
         cancelled_reason = 'payment_expired',
         updated_at       = pg_catalog.now()
    FROM target t
   WHERE o.id = t.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  -- 🔴 觀測點(plan §4-6 驗收條件):每次執行都留一行,零 PII(只有筆數與上限)。
  --    沒有它的話,「掃到 0 筆」與「這支根本沒被呼叫」在 DB 側分不出來 ——
  --    而 cron.job_run_details 的 return_message 對 SELECT 只會記 command tag、不記筆數。
  RAISE LOG '[expire_unpaid_orders] expired=% limit=%', v_count, p_limit;

  -- ══ ⟦b4-CRON6⟧ 片2 新增:成功心跳 ═════════════════════════════════════════
  -- 🔴🔴 **那個 EXCEPTION 子區塊是本片的重點,不是防禦性裝飾。**
  --    沒有它:心跳表出任何問題(被鎖住 / 被 TRUNCATE / 欄位被改名)⇒ 整個函式拋錯
  --    ⇒ **那一小時的訂單不會被取消** ⇒ 監控把被監控的弄死。
  --    📌 而那正是本檔檔頭那段話要防的事 —— 它差一點由這片自己實現。
  -- ⚠️ 代價明寫:心跳寫失敗時**只留一行 WARNING**,而心跳會開始變舊 ⇒ 後台那一列會亮。
  --    那是**假陽性,而方向是對的**(叫比不叫好),**不得**被讀成「這裡不會出錯」。
  -- 🔴🔴 **而「心跳寫不出去不影響本輪取消」有一個【真的例外】**(codex R1 must-fix ②):
  --    這一列**被別人鎖住**時不會立刻拋錯,它會**等** —— 而此時 orders 那半已經改完。
  --    若這一等撞上 statement_timeout 或人工 cancel(SQLSTATE 57014),
  --    🔴 `EXCEPTION WHEN OTHERS` 依 PostgreSQL 定義**不接** query cancel
  --    ⇒ 例外冒出去 ⇒ **整輪取消一起 rollback**。
  --    ⇒ 正確字面:**心跳自己【出錯】不影響本輪;心跳【被卡住】+ 被取消,會拖垮本輪。**
  --    ⚠️ 本片**沒有修掉這條路**(要動 upsert 的鎖策略,那是另一片)。它是已知殘留風險。
  -- 🔴 只寫成功那三欄;**失敗那一欄一個字都不碰**(理由見檔頭:寫不出去,不是懶得寫)。
  --    ⚠️ 這句刻意不寫出那個欄名 —— 見檔頭「3d 這把尺分不出碼與註解」那段。
  -- 🔴 用 `clock_timestamp()` 不用 `now()`(codex R1 must-fix ③):

  --    `now()` 是**交易起始時間** ⇒ 一個 10:00 開始而跑很久的交易,會用 10:00 蓋掉
  --    另一個 10:05 已經寫好的心跳 ⇒ **`last_success_at` 會倒退**,而畫面上只是「比較舊」。
  --    心跳要的是**觀測時刻**,不是交易時刻。
  -- 🔴 而光換函式不夠,`GREATEST` 那半才是真正擋倒退的(晚到的舊值不得覆蓋新值)。
  BEGIN
    INSERT INTO public.sweeper_heartbeat (job_name, last_success_at, consecutive_failures, updated_at)
    VALUES ('pcm-expire-unpaid-orders', pg_catalog.clock_timestamp(), 0, pg_catalog.clock_timestamp())
    ON CONFLICT (job_name) DO UPDATE
      SET last_success_at      = GREATEST(public.sweeper_heartbeat.last_success_at, excluded.last_success_at),
          consecutive_failures = 0,
          updated_at           = GREATEST(public.sweeper_heartbeat.updated_at, excluded.updated_at);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[expire_unpaid_orders] 心跳寫入失敗(本輪取消不受影響):%', SQLERRM;
  END;

  RETURN v_count;
END;
$function$;

-- ── 4b. COMMENT 也要跟著搬 ────────────────────────────────────────────────
-- 🔴🔴 **我第 4 節只搬了 0903 的【函式本體 107-232】, 漏掉它 :243 的 `COMMENT ON FUNCTION`**
--    (codex R1 must-fix, :262)。而 `CREATE OR REPLACE` **保留 oid ⇒ catalog COMMENT 原封不動**。
-- 🛑 而本檔檔頭又叫人「0903 不必另貼」⇒ `\df+` 上會永遠寫著「一律 1 天、分流尚未完成、
--    NONCARDPAID 未修」—— **三句全假, 而它是 repo 之外的人唯一讀得到的那一份。**
-- 🎯 ⇒ 這與 0903 自己 :234-242 那段講的是同一個病, 而**我在搬它的時候把它漏掉了**。
-- ✅ 下面整段逐字取自 0903:243-252, **只改一句**:它原本寫「本片【不修】⟦b4-NONCARDPAID1⟧」——
--    而本片就是在修它 ⇒ 舊字面留刪除線, 讓 `\df+` 搜舊句的人同一發撞到訂正。
COMMENT ON FUNCTION pcm_cron.expire_unpaid_orders(integer) IS
  'M-4b 生命週期 L3(件①):unpaid + 未取消 + **依 payment_channel 分流的逾時** + **無任何非終態 attempt** 的訂單 → 寫 cancelled_at + cancelled_reason=''payment_expired''(不刪資料、不動 payment_status、不碰庫存)。回本次筆數。'
  '🔴 **逾時分流(2026-09-03 Sean 本人逐字拍板)**:tappay = 1 天(逐字不動)· bank_transfer = **5 天**(「乙 5天」)· cash = **5 天**(「甲 跟匯款一樣 5 天」)。'
  '⛔ ~~原本無條件「建立超過 1 天」~~ **作廢** —— 那會把正常等匯款的單殺掉(匯款常要 1-3 天)。'
  '⛔ ~~原本的「⚠️ 重估觸發:…屆時改為依 payment_channel 分流」~~ **已完成, 不要再照它去做**。'
  '🛑 **白名單明列三種**:`none` 與任何未來新增的 channel 一律**不失效**(不失效可逆 · 失效不可逆)。`none` 今天零寫入端;`SELECT count(*) FROM orders WHERE payment_channel=''none''` > 0 的那天要回來看。'
  '🔴 不變量:cancelled ⇒ 無 active attempt(與 admin_cancel_order 步7 同條件)——三處「擋重新結帳」的查詢都靠 active attempt 判定,放寬本條件的人必須同時回頭改那三處,否則「已取消但 charge 在途」會不再被擋 = 雙扣。'
  '⛔ ~~本片【不修】⟦b4-NONCARDPAID1⟧:登記匯款/現金收款不會把 payment_status 翻成 paid ⇒ 已收錢的單仍會被本函式取消~~ **2026-09-04 由 20260904230000 修掉了**'
  '🔴 現況:①`order_payments` AFTER INSERT 掛了 pcm_noncard_settle_recompute ⇒ 收到錢的單會自己離開 unpaid;'
  '②本函式另加一條腿:**已收淨額 SUM(order_payments.amount) > 0 的單一律不取消**(涵蓋 verdict = overpaid / needs_human 那兩種不翻狀態的單)。'
  '🔵 沖銷回 0 之後恢復可取消 —— 那條腿問的是淨額, 不是「有沒有收款列」。'
  '批次上限 p_limit(預設 500、NULL/<=0 退回 1)、FOR UPDATE SKIP LOCKED。只由 pg_cron job pcm-expire-unpaid-orders 呼叫;無任何 client role 可執行。';

-- ── 4c. cron 那支的權限零漂移(逐字取自 0903:265-285)──────────────────────
-- 🔴🔴 **我原本一條都沒帶過來**(codex R1 must-fix, :468)。
--    `CREATE OR REPLACE` 保留既有 ACL —— **包括漂移出來的那一份**
--    ⇒ 一個歷史上被 GRANT 給 anon 的 EXECUTE 會被本片原樣保留並提交, 而三綠全綠。
-- 🔵 這組是 0903 自己的 code-reviewer C4 逼出來的成例, 不是我新發明的形狀。
-- 🔴🔴 **而我第一版把這一段【重打了一遍】, 順手加上 `pg_catalog.` 前綴 —— 而 `coalesce` 是
--    SQL 特殊語法, 加了前綴就不存在**(實測 `SELECT pg_catalog.coalesce(1,2)` ⇒
--    `ERROR: function pg_catalog.coalesce(integer, integer) does not exist`;
--    同族 `nullif` / `greatest` / `least` 三個逐一實測**全部一樣**)。
-- 🎯 **⇒ 這是今晚同一種病的第三次, 而它最重**:前兩次是「檔頭宣稱與碼不符」,
--    這一次**宣稱本身就是那道防護** —— 我寫了「逐字取自 0903」, 而**逐字正是唯一能防止這個 bug 的動作**,
--    ⇒ 📌 **我用一句「我逐字抄了」取代了逐字抄那個動作。**
-- ✅ 現在這一行是用程式從 `20260903080000:281` 抽出來的, 一個字元都沒有重打。
DO $post0903$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure
       AND p.proowner = 'postgres'::regrole
       AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION '事後(0903繼承):cron 函式的 owner / SECURITY DEFINER / search_path 漂了;拒繼續';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p,
         LATERAL aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
     WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure
       AND a.grantee <> p.proowner
  ) THEN
    RAISE EXCEPTION '事後(0903繼承):cron 函式有 owner 以外的 grantee;拒繼續';
  END IF;
END
$post0903$;

-- ── 4d. 被本片弄假的三處 catalog COMMENT(codex R1 must-fix, :257)──────────
-- 🔴🔴 **本片讓三處既有 COMMENT 當場變假**, 而它們是 repo 之外的人唯一讀得到的說明:
--    ① `orders.payment_status` —— 逐字「人工匯款收款【不會】把這一欄變成 'paid'」
--       (`20260901050000:42`, 而那一段自稱是「**承重的那一句**」)
--    ② `admin_record_manual_payment` —— 逐字「🔴 **不碰 orders.payment_status**」
--    ③ `admin_reverse_manual_payment` —— 逐字「沖銷把該單淨額打到 0 時, payment_status 仍停在原值」
-- 🛑 `COMMENT ON` 是**覆寫不是追加** ⇒ 只能整段重出。下面三段的原文**是用程式從各自的
--    migration 抽出來的、一字未重打**, 只在結尾插入訂正句;舊字面全部留著加刪除線。
-- 🔵 ②③ 的訂正刻意分兩半:**「本支不碰」那半仍為真** —— 變的是「呼叫它的效果」。
--    ⇒ 📌 **把它整句劃掉會製造另一個假** , 而那比不改更難查。
COMMENT ON COLUMN public.orders.payment_status IS
$c$這一欄【不是】「錢收到了沒」的單一真相。要問錢, 去看 order_payments 帳本(或 v_order_paid_total 的 paid_total)。

🔴 承重的那一句(#841 就是這樣壞的):
   人工匯款收款【不會】把這一欄變成 'paid' —— 錢進 order_payments, 這一欄沒動。
   ⇒ 所以 payment_status <> 'unpaid' 不等於「這張單收到錢了」,
     而 payment_status = 'unpaid' 也不等於「沒收到錢」。
   ⇒ 實例:query.or('payment_channel.neq.tappay,payment_status.neq.unpaid')
     把已匯款的單整個濾掉(修在 0853bf2b)。

🛑 而【不要相信任何一份「誰會寫這一欄」的清單, 包括這一段】:
   2026-09-01 實量, 全 repo 有 11 支檔在 SET 這一欄 —— 卡片確認 / 退款同步 /
   取消守門 / 券 / 0 元結清 / 還有一支維護腳本直接 UPDATE。
   ⇒ 這個數字【會長】。而這段 COMMENT 寫的當下, 前兩輪對抗審查各找到一條
     它漏掉的路 —— 也就是說, 列舉這件事本身失敗了三次。
   ⇒ 要現值自己跑:grep -rn "SET payment_status" --include='*.sql' --include='*.ts'

📌 所以這一欄的正確用法是:當成【狀態機的狀態】, 不要當成【錢的事實】。
   要判斷錢, 一律回 order_payments / order_refunds 加總。

⛔ ~~上面那句「人工匯款收款【不會】把這一欄變成 'paid'」~~ **2026-09-04 起不再成立**(`20260904230000`)。
   `order_payments` 現在掛著 AFTER INSERT trigger `pcm_noncard_settle_after_payment_ai`
   ⇒ 登記匯款/現金收款【會】把這一欄翻成 paid / partiallyPaid(verdict = overpaid /
     needs_human 那兩種仍不翻), 沖銷回 0 則翻回 unpaid。
🔵 舊字面留著不刪 —— 讓搜「不會把這一欄變成 paid」的人同一發撞到訂正。
🎯 而本段自己早就寫了「不要相信任何一份『誰會寫這一欄』的清單, **包括這一段**」——
   ⇒ 📌 **那句話是對的, 而它防不了自己**:一個誠實的免責聲明, 擋不住底下那句承重的斷言變假。$c$;

COMMENT ON FUNCTION public.admin_record_manual_payment(uuid, uuid, text, text, integer, timestamptz, text, text) IS
  'M-4b E10-OP5 人工軌收款登錄(SECURITY DEFINER、search_path='''')。一支 RPC 管 bank_transfer + cash 兩軌(master-plan §5.3 項 1);card 軌具名拒。'
  '🔴 actor = p_actor 參數 + staff FK + is_active 守門,**不是 session_user**(那是 OP3 機器軌的形狀)。'
  '🔴 actor 的誠實邊界:cookie 承載、非授權邊界(apps/admin/src/lib/session/actor.ts:6-7)⇒ 不得單獨作為責任歸屬證據。'
  '十道守門:G1 隔離閘 P8C01 → G2 actor(排在任何訂單讀取前,擋守門序 oracle)P2B39 → G3 輸入驗(p_order_id/p_request_id/p_rail/p_amount/p_received_at 各自一道 NULL 守門 + rail 二值 + amount 正 + 軌別欄位形狀;bank_reference/payer_note 先 btrim 正規化)'
  ' → G4 未來時點 P2B38/pcm_op5_received_at_future(逐字 clock_timestamp;OP2a 的 A8 閘是 backstop)→ G5 orders FOR UPDATE(不存在=通用訊息)'
  ' → G6 整單取消拒(通用;**部分取消單放行**,§5.1b 契約)+ 退款兩態具名拒 P2B41 + allowlist 之外 fail-closed → G7 下限:匯款比台北曆日、現金比精確時點 P2B38/pcm_op5_received_at_before_order'
  ' → G8 冪等樹:六輸入逐欄 IS NOT DISTINCT FROM 全等才回 idempotent(NULL-safe;cash 兩欄為 NULL)→ G9 append 一列 → G10 row_count 守 P2B40。'
  '🔴 **不碰 orders.payment_status**(少收/溢收/結清判定=OP6)、不寫 reviewed_*(Q4=C 複核不強制)、零 UPDATE 零 DELETE(Q3=A 更正走沖銷)。'
  '🔴 received_at 逐軌(Sean 2026-08-10 拍板:「銀行入帳日」只適用匯款軌):bank_transfer=銀行入帳日(UI 傳 Asia/Taipei 當日 00:00)、cash=實際收現時點(UI 取 **server** 時間,不設容差)。'
  '🔴 **本片零 GRANT(分期開權)**:EXECUTE 由 OP-A12 與沖銷 RPC 一起開 ⇒ 物理上不存在「能登錄、不能更正」的窗口。這道 ACL 極性有到期日 = OP-A12。'
  '🔴 開權前置:OP-A12 沖銷入口 / OP-A13 退款態沖銷與重登 / OP-A14 已收款單的取消守門 / OP-A15 待認領款項暫存帳;錯誤碼分類(P2B38 一碼兩義、P2B39/40/41、42501)= backlog #371。'
  '零經銷價 / 零 cost。'
  '⛔ ~~上面「**不碰 orders.payment_status**」那句~~ —— **函式本體仍然一個字都不碰它, 那半仍為真**;'
  '🔴 而 **2026-09-04 起【呼叫它的效果】變了**(`20260904230000`):它寫進 `order_payments` 的那一列會觸發 '
  'AFTER INSERT trigger `pcm_noncard_settle_after_payment_ai`, 由 `pcm_noncard_settle_recompute` 改 payment_status。'
  '⇒ 📌 **「本支不碰」與「呼叫本支不會改到」是兩句話, 而讀的人要的是後者。**舊字面留著讓搜它的人撞到這裡。';

COMMENT ON FUNCTION public.admin_reverse_manual_payment(uuid, text, text) IS
  'M-4b E10-OP-A12 人工軌沖銷(SECURITY DEFINER、search_path='''')。沖銷=登錄錯誤的更正(同單同軌、金額為被沖列反號),**不是退款**。十一道:G1 隔離閘 P8C01 → G2 actor(排在任何資料讀取前)P2B42 → G3 輸入驗(reason 正規化成單一變數、必填)→ G4 不鎖讀只取 order_id → G5 鎖 orders FOR UPDATE(鎖序 orders→order_payments,與 OP5 同向)→ G6 **鎖後重讀** target(FOR NO KEY UPDATE;NKU 而非 FOR UPDATE 見 a2b1:20-24 的 40P01 契約) → G7 卡軌具名拒 P2B44/pcm_opa12_card_rail → G8 已被沖銷具名拒 P2B44/pcm_opa12_already_reversed(**無冪等**:沖銷列不得帶 request_id,同 actor+同 reason 分不出重送與誤按) → G9 append 沖銷列(識別欄與 reviewed_* 全 NULL、received_at 跟著被沖那筆)→ G10 row_count 守 P2B43。🔴 **刻意無 payment_status allowlist、不擋已取消單**(#372:沖銷是更正不是收錢);已知代價=A14 缺口下可把正確收款沖成淨零,見本片檔頭與 #372。🔴 反號由 OP2b 的 A9 保證(P2B33),本支不自己驗。零經銷價 / 零 cost。🔴 **不碰 orders.payment_status**(與 OP5 對稱:帳本只記事實,狀態判定歸 OP6)——沖銷把該單淨額打到 0 時,payment_status 仍停在原值,那是 OP6 的職責不是本支的漏做。 → G11 **同交易稽核**(#423,20260812150000):寫一列 admin_audit_log action=payment.reverse、target=payment:<沖銷列 id>、🔴 request_id=**沖銷列自己的 id**(本函式簽章無 p_request_id,而該欄 NOT NULL)、before=被沖那列 {payment_id,amount,rail}、after={reversal_id,amount,reverses_payment_id,**order_id**}(order_id 為 R3 C3 補,災難日免回頭 join)、reason=**v_reason**(= p_reason 去頭尾空白後的值,G3 正規化;不是 p_reason 原字面);筆數守 pcm_opa12_audit_row_count 恰 1,寫不進去整筆回滾。⚠️ 筆數守擋「寫不進去」、**擋不到「寫進去又被 AFTER INSERT trigger 刪掉」**(ROW_COUNT 仍為 1)——正確防線是 admin_audit_log 的表層 append-only trigger(該表現行 trigger 數=0、只靠 GRANT),見本片檔頭與 backlog。'
  '⛔ ~~上面「**不碰 orders.payment_status**」那句~~ —— **函式本體仍然一個字都不碰它, 那半仍為真**;'
  '🔴 而 **2026-09-04 起【呼叫它的效果】變了**(`20260904230000`):它寫進 `order_payments` 的那一列會觸發 '
  'AFTER INSERT trigger `pcm_noncard_settle_after_payment_ai`, 由 `pcm_noncard_settle_recompute` 改 payment_status。'
  '⇒ 📌 **「本支不碰」與「呼叫本支不會改到」是兩句話, 而讀的人要的是後者。**舊字面留著讓搜它的人撞到這裡。';

-- ══ 5. 事後斷言(貼完它自己驗;任何一條不成立就整個交易回滾)════════════
DO $post$
DECLARE
  v_src       text;
  v_n         integer;
  -- 🔵 清單寫在 DECLARE 同一行的 `:=` 上, 不是 BEGIN 裡再賦值 ——
  --    `migration-new-file-static-checks` 規則③ 認的是 `v_functions text[] :=` 這個字面,
  --    拆成兩行它撈到 0 個 ⇒ 判「有漏列」。🔴 **我第一版就是這樣紅的。**
  v_functions text[] := ARRAY[
    'public.pcm_noncard_settle_recompute(uuid)',
    'public.pcm_noncard_settle_after_payment()'
  ]::text[];
  v_fn        text;
BEGIN
  -- ① 掛點在, 而且**只有一個**
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_trigger t
   WHERE NOT t.tgisinternal
     AND t.tgname = 'pcm_noncard_settle_after_payment_ai'
     AND t.tgrelid = 'public.order_payments'::regclass;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '事後①失敗:order_payments 上的掛點應為 1, 實得 %', v_n;
  END IF;

  -- ② 🔴 **負斷言:第二個掛點【不得】存在。**
  --    這條在「Sean 拍甲 只交一個」與「有人日後手滑加回去」之間, 是唯一會叫的東西。
  -- 🔴🔴 **原版只認名稱前綴、又沒鎖 schema**(codex R1 must-fix, :436):
  --    ① 換個名字的第二寫入端 ⇒ **假綠** ② 別的 schema 有同名表 ⇒ **假紅**。
  -- ✅ 改成問【誰在呼叫本片的重算函式】—— 名字可以改, 呼叫關係不能。
  --    ⇒ 這把尺對「有人日後加了第二個掛點」是白名單:**唯一合法的呼叫者只有一個。**
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_trigger t
   WHERE NOT t.tgisinternal
     AND t.tgfoid = 'public.pcm_noncard_settle_after_payment()'::regprocedure
     AND t.tgrelid <> 'public.order_payments'::regclass;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '事後②a失敗:本片的 trigger 函式被掛在 % 張 order_payments 以外的表上 ⇒ 那是第二個 payment_status 寫入端, 見本檔第 3 節。', v_n;
  END IF;

  -- 🔵 第二把:除了 `pcm_noncard_settle_after_payment` 以外, 不得有別的函式體在呼叫重算。
  --    (改名字躲得過上面那把, 躲不過這把 —— 而兩把用不同的方式壞掉。)
  --    🔴 一樣先剝註解:本檔自己的註解裡就逐字寫著那個函式名。
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
   WHERE pg_catalog.strpos(
           pg_catalog.regexp_replace(p.prosrc, '--[^' || chr(10) || ']*', '', 'g'),
           'pcm_noncard_settle_recompute') > 0
     AND p.oid <> 'public.pcm_noncard_settle_after_payment()'::regprocedure;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '事後②b失敗:有 % 支 order_payments 掛點以外的函式在呼叫本片的重算 ⇒ 第二個寫入端。', v_n;
  END IF;

  -- ③ 重算函式的形狀:SECURITY DEFINER + search_path 為空字串
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'pcm_noncard_settle_recompute'
     AND p.prosecdef
     AND p.proconfig @> ARRAY['search_path=""'];
  IF v_n <> 1 THEN
    RAISE EXCEPTION '事後③失敗:pcm_noncard_settle_recompute 不是 SECURITY DEFINER + search_path='''' (符合的定義數 %)', v_n;
  END IF;

  -- ④ ACL:anon / authenticated 都**不得**執行本片兩支函式。
  -- 🔴 `has_function_privilege` 對「ACL 欄是 NULL」時會回 true(預設 PUBLIC 可執行)——
  --    而上面兩道 REVOKE 正是為了讓它非 NULL。所以這條要真的問。
  -- 🔴🔴 **只問 anon/authenticated 是黑名單**(codex R1 must-fix, :227)——
  --    `payment_confirmer`、`postgres` 以外的任何 grantee、以及 default ACL 帶進來的角色
  --    都在那兩個名字之外, 而它們一樣拿得到任意訂單的重算權。
  -- ✅ 改成 0903 那支既有的成例(`20260903080000:277-285`, 它自己的 code-reviewer C4 逼出來的):
  --    `aclexplode` 展開 ACL, 問「有沒有 **owner 以外**的 grantee」⇒ **白名單, 不需要知道誰存在。**
  -- 🔵 `coalesce(proacl, acldefault(...))`:ACL 欄是 NULL 時代表「預設」而不是「沒有人」——
  --    直接讀 proacl 會把預設那一群看成空的(memory: ACL 欄是 NULL 時 PUBLIC 看不見)。
  -- 🔵 清單驅動:物件名寫在一個地方, 斷言吃它。
  --    (`migration-new-file-static-checks` 規則③數的就是這個清單 ——
  --     它防的是「新建了物件而忘記把它列進收權斷言」, 不防「忘記收權」。)
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p,
           LATERAL aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
       WHERE p.oid = v_fn::regprocedure
         AND a.grantee <> p.proowner
    ) THEN
      RAISE EXCEPTION '事後④失敗:% 有 owner 以外的 grantee ⇒ REVOKE 沒生效或有 ACL 漂移。', v_fn;
    END IF;
  END LOOP;

  -- ⑤ cron 那支:新增的腿在, **而 09-03 那三行也還在**(這條才是防「我把別人的東西刪掉」)
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'pcm_cron' AND p.proname = 'expire_unpaid_orders';
  -- 🔴 一樣先剝註解 —— 本檔第 4 節的註解裡逐字寫著 `interval '5 days'`,
  --    不剝的話「把述詞刪掉、註解留著」照樣印綠。
  v_src := pg_catalog.regexp_replace(v_src, '--[^' || chr(10) || ']*', '', 'g');

  -- 🔴🔴 **只查獨立 token 是假綠**(codex R1 must-fix, :477)——
  --    把述詞的 `<= 0` 改成 `>= 0`, `order_payments` / `sum` / `amount` 四個 token **全都還在**
  --    ⇒ 斷言全綠, 而 cron 會**專挑已收款的單去取消** —— 缺陷從「不修」變成「反著做」。
  -- ✅ 改成問**那個比較符本人**:剝註解 + 壓掉空白之後, 必須逐字含 `)<=0`。
  --    🔵 壓空白是必要的 —— 原文跨行且有縮排, 不壓的話這道閘會恆假(而恆假的閘會被刪掉)。
  IF pg_catalog.strpos(v_src, 'order_payments') = 0 THEN
    RAISE EXCEPTION '事後⑤a失敗:cron 函式裡找不到新增的淨額腿(剝註解後)。';
  END IF;
  IF pg_catalog.strpos(
       pg_catalog.regexp_replace(v_src, '\s+', '', 'g'), ')<=0') = 0 THEN
    RAISE EXCEPTION '事後⑤a2失敗:淨額腿的比較符不是 `<= 0`(剝註解壓空白後找不到)⇒ 方向可能被改反了。';
  END IF;
  IF pg_catalog.strpos(v_src, 'sweeper_heartbeat') = 0 THEN
    RAISE EXCEPTION '事後⑤b失敗:cron 函式的心跳不見了 ⇒ 本片把它刪掉了。';
  END IF;
  IF pg_catalog.strpos(v_src, '5 days') = 0 THEN
    RAISE EXCEPTION '事後⑤c失敗:cron 函式裡找不到「匯款/現金 5 天」⇒ 本片把 Sean 2026-09-03 拍的東西刪掉了。';
  END IF;
  IF pg_catalog.strpos(v_src, 'payment_channel') = 0 THEN
    RAISE EXCEPTION '事後⑤d失敗:cron 函式裡找不到 payment_channel 分流。';
  END IF;

  RAISE NOTICE '[20260904230000] 五組事後斷言全數通過。';
END
$post$;

COMMIT;

-- ══ 6. 還原 ═══════════════════════════════════════════════════════════════
-- ⛔ ~~本節原本的標題與檔頭都寫「**可直接貼;不是註解**」~~ **作廢**(codex R1 must-fix, :31)——
--    🔬 而下面三行**逐字以 `--` 開頭** ⇒ 整段貼上去**什麼都不會做**。
-- 🎯 **這是今晚同一種病的第二次**:第一次是檔頭宣稱「失敗會整個回滾」而實際沒有 `BEGIN`。
--    ⇒ 📌 **兩次都不是碼寫錯, 是【我描述自己的碼】時寫錯** ——
--       而那一半**沒有任何東西在檢查**:三綠不看、拋棄式庫不看、突變測試更不看(行為零改動)。
--    ⇒ 🔴 **兩次抓到它的都是對抗審查, 而且都是它真的去讀了我宣稱的那個東西本人。**
-- ✅ 現在的字面 = 事實:**下面三行是註解, 要還原請自己把 `-- ` 拿掉再貼。**
--    刻意保持註解形態, 是因為它與本片同在一支檔 —— 可執行的 DROP 混在 apply 路徑裡太危險。
-- 🔴 貼下面這段會把本片的掛點與函式拿掉, 而**第 4 節那支 cron 不會回到舊版** ——
--    要回舊版請重貼 `20260903080000_m4b_expire_unpaid_by_payment_channel.sql`(它是完整定義)。
--    ⇒ 📌 這句寫出來, 是因為「還原」兩個字讀起來像會全部回去, 而它只回一半。
--
-- DROP TRIGGER IF EXISTS pcm_noncard_settle_after_payment_ai ON public.order_payments;
-- DROP FUNCTION IF EXISTS public.pcm_noncard_settle_after_payment();
-- DROP FUNCTION IF EXISTS public.pcm_noncard_settle_recompute(uuid);
