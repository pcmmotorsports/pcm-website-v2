-- 🛑🛑🛑 **codex R2 判 FAIL(12 must-fix + 3 nit)· 不得貼、不得 apply、不得當交件。** 🛑🛑🛑
--    2026-09-02 01:0x。而【第一條就推翻了本檔存在的前提, 而我獨立複查過它是對的】:
--    本檔檔頭寫「人工退款那半有既有管線在管」—— **那句話不成立。**
--    `pcm_sync_order_refund_payment_status`(`20260823020000:265`)只加總
--    `order_refunds` 且 `status='confirmed'`,**它提到 `order_manual_refunds` 0 次**
--    (🟢 正對照:同一份函式體提到 `order_refunds` 1 次 ⇒ 那個 0 不是尺沒動)。
--    ⇒ `admin_record_manual_refund` 寫 A 表、然後呼叫一支只讀 B 表的同步器
--      ⇒ 它算到 0 ⇒ 提早 return ⇒ **狀態從來沒有被改過。**
--    ⇒ 📌 **人工退款 → payment_status 是一個【沒有主人】的缺口, 而我把它讀成「別人的」。**
--    🔴 而這是本片核心前提第【三】次被推翻:
--      v2「OP6a 看不到 ⇒ 我來補」⇒ v4「別人在管 ⇒ 我交還」⇒ 現在「沒有人在管」。
--    其餘 11 條 must-fix 見 plan(並發 stale-write / overpaid 留錯狀態 /
--      負淨額 cron 誤取消 / 還原閘沒剝註解 / ACL 斷言不含 PUBLIC / 沒有修復路徑 …)。
-- ════════════════════════════════════════════════════════════════════════
-- ⟦b4-NONCARDPAID1⟧ 交件版 —— 匯款/現金收款會翻狀態了, 而逾期 cron 不再取消【手上還有錢】的單
--
-- ✅ **Sean 2026-09-02 已重批:「兩個 trigger 變一個」⇒ 逐字答【甲 只交一個】。**
--    (形狀第二次變更 ⇒ 鐵則 8 重批, 主視窗 `-0a` 端他、他答甲。)
-- 🛑 **本檔在 `docs/specs/`, 不在 `supabase/migrations/`** —— provision 會 apply 那個目錄底下每一支,
--    而檔頭寫「不要 apply」是給人看的, **跑它的是迴圈**。

--
-- 🛑 **本檔在 `docs/specs/`, 不在 `supabase/migrations/`** —— provision 會 apply 那個目錄底下每一支,
--    而檔頭寫「不要 apply」是給人看的, **跑它的是迴圈**。
--
-- ══ 給 Sean 的白話(貼之前先讀這一段)══════════════════════════════════════
--
-- 【它修什麼】客人匯款或付現, 後台登記了收款 —— 而那張單的狀態【沒有跟著變】, 一直停在
--   「未付款」。隔天逾期程式看到「未付款」就把它取消掉。**錢在我們這裡, 而單被系統自己取消了。**
--
-- 【貼了會看到什麼】兩件事:
--   ① 登記匯款/現金收款之後, 那張單會自己變成「已付款」(**剛好收足**)或「部分付款」(收不夠)。
--      🔴 **而【收超過】不會變** —— 它停在「未付款」, 刻意的:
--        狀態欄只有五個值, 沒有一個是「收太多」⇒ 我不猜一個最接近的, 開一列給人看。
--        ⚠️ 而 codex R2 打的正是這一格:那張單**手上明明有足額以上的錢, 而畫面寫未付款**。
--        ⇒ 這一版**沒有解決它**, 只擋掉了「被隔天的程式自動取消」。
--   ② 逾期程式從今以後【不碰手上還有錢的單】。卡片那條路本來就有這個保護, 匯款這條沒有 ——
--      這一片是把那個對稱補齊, 不是加一個新規則。
--
-- 🛑🛑 **【2026-09-02 01:1x 更正:下面這一整段【不成立】,而我留著不刪】**
--   codex R2 逐字打掉它:`pcm_sync_order_refund_payment_status`(`20260823020000:265`)
--   只加總 **`order_refunds`** 且 `status='confirmed'` —— 它提到 `order_manual_refunds` **0 次**
--   (🟢 正對照:同一份函式體提到 `order_refunds` **1 次** ⇒ 那個 0 不是尺沒動)。
--   ⇒ `admin_record_manual_refund` 寫【A 表】,然後呼叫一支只讀【B 表】的同步器
--     ⇒ 它算到 0 ⇒ 提早 return ⇒ **狀態從來沒有被改過。**
--   ⇒ 📌 **人工退款 → `payment_status` 是一個【沒有主人】的缺口,而我把它讀成「別人的」。**
--   ⇒ 🔴 而我讀錯的機制:檔名逐字寫著 `record_calls_sync` ⇒ 我把「它呼叫了同步器」
--     讀成「它同步了」。**「A 呼叫了 B」與「B 做了那件事」是兩個宣稱,而檔名只答得出前一個。**
--   ✅ 那個缺口已另開一列 `⟦b4-MANREFUNDNOOWNER⟧`,**不屬於本片**。
--   ⚠️ 舊字面留著不刪 —— 搜「第二個早就有人做好了」的人要在同一發撞到這段更正。
-- ⛔ ~~【一件要跟你講清楚的:你說「加兩個觸發器」, 而我交【一個】】~~
--   ~~不是做不到 —— 是查下去發現**第二個早就有人做好了**~~:
--   `admin_record_manual_refund`(登記人工退款那支)自 2026-08-23 起就會呼叫
--   `pcm_sync_order_refund_payment_status` 把退款狀態同步好(`20260823020000`, 檔名逐字
--   `record_calls_sync`, 它 :17 寫「只加這一行, 其餘一字未改」)。
--   ⇒ 我再加一個, 會變成**第二個寫入端**, 而它用不同的算法 ——
--     實例:收 1000、人工退 400、卡片再退 600, 兩本帳合計已經退完,
--     而兩個寫入端各自只看自己那半 ⇒ 那張單會**永遠停在「部分退款」**。
--   ⇒ 📌 **所以少的那一個不是漏掉, 是【不該加】。**
--
-- 【貼錯了怎麼還原】第 6 節是**可以直接貼的 SQL**(不是註解)。
--   🔴 它會把逾期程式改回沒有保護的樣子 ⇒ 還原之後原本的缺陷會回來。
--   🔴 它【不會】把已經被改過的訂單狀態改回去 —— 那些是真實的收款事實。
--
-- 【今天有沒有真的踩到】🔴 **未知。**訂單表今早被清空過 ⇒「查到 0 筆」沒有判別力:
--   那個 0 在「從來沒發生過」與「發生過而資料被清掉了」上是同一個數字。
--
-- ⚠️ 【測試綠 ≠ 正式站一定對】驗證是在拋棄式測試庫上跑的, 而那個庫**套了所有還沒貼的 migration**
--   ⇒ 它上面會改 payment_status 的函式有 4 支, 而正式庫今天是 2 支。**兩個不同的世界。**
--
-- ══ 給下一個維護者 ════════════════════════════════════════════════════════
--
-- 本檔是 v2 被 codex 對抗審查判 **FAIL(20 must-fix)** 之後重寫的。三條最重要的:
--   🔴 ① v2 把 `expire_unpaid_orders` 的**成功心跳整段刪掉**了, 而它自稱「只加一句」。
--        成因:我從拋棄式庫抄函式體, 而**那個庫刻意跳過了 `20260828060000`(心跳那一代)**
--        ⇒ 抄到的是 `20260809160000` 的舊身體。
--        ⇒ 📌 **本檔改從 `20260828060000:189` 抄。動 DB 函式之前跑 `scripts/latest-definition-of.sh`。**
--   🔴 ② v2 的第二個 trigger 是第二個寫入端(見上面給 Sean 那段)⇒ **拿掉**。
--   🔴 ③ v2 的 cron 腿寫成「有沒有收款列」⇒ 收 1000 再全額沖銷(淨額 0)的單會被**永久擋住**,
--        它再也不會被取消。⇒ 本檔改成**淨額 > 0**。
--
-- 🔴 **本檔【不寫】任何退款狀態**(`refunded` / `partiallyRefunded`)——
--    那兩個值屬於退款管線(`pcm_sync_order_refund_payment_status`)。
--    而只要那張單有任何退款活動, 本檔的重算器**直接交還**、一個字都不碰。
--    ⇒ 這條是「只有一個寫入端負責一個值域」的具體形狀, 不要為了「順手也處理一下」而放寬。
--
-- 驗收:`PORT=<port> bash scripts/noncardpaid-verify.sh all /tmp/nc`

BEGIN;

-- ── 0. 前置閘(fail-closed)────────────────────────────────────────────────
-- 🔴 codex A:59:貼檔身分若不是 owner, 三支 SECURITY DEFINER 會以錯的身分建立,
--    而它們要呼叫的 OP6a 是零 GRANT ⇒ 呼叫失敗被 EXCEPTION 吞掉
--    ⇒ **表面收款成功, 而狀態功能整片是 no-op** —— 那正是本片最怕的形狀。
DO $pre$
DECLARE v_owner text;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO v_owner
    FROM pg_catalog.pg_proc p WHERE p.oid = 'public.admin_compute_order_settlement(uuid)'::regprocedure;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION '前置:找不到 admin_compute_order_settlement(uuid)(OP6a 還沒 apply)⇒ 拒繼續';
  END IF;
  IF current_user::text <> v_owner THEN
    RAISE EXCEPTION '前置:本檔要以 % 的身分貼(現在是 %)。'
                    '理由:本檔三支 SECURITY DEFINER 要呼叫零 GRANT 的 OP6a —— '
                    '身分不對時它們建得起來、跑起來會被例外吞掉 ⇒ 表面成功而整片 no-op。拒繼續',
                    v_owner, current_user;
  END IF;
  IF to_regclass('public.sweeper_heartbeat') IS NULL THEN
    RAISE EXCEPTION '前置:public.sweeper_heartbeat 不在 ⇒ 本檔重建的 cron 會寫不了心跳。'
                    '先套 20260817070000 與 20260828060000。拒繼續';
  END IF;
  IF pg_catalog.strpos(
       (SELECT p.prosrc FROM pg_catalog.pg_proc p
         WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure),
       'sweeper_heartbeat') = 0 THEN
    RAISE EXCEPTION '前置:正式庫的 expire_unpaid_orders【還沒接心跳】⇒ 它不是 20260828060000 那一代。'
                    '本檔重建的版本含心跳 ⇒ 貼下去等於順便把那一片也上了, 而那不是本片的授權範圍。'
                    '先確認要對哪一代下手(scripts/latest-definition-of.sh expire_unpaid_orders)。拒繼續';
  END IF;

  -- 🔴🔴 **2026-09-04 線【信】加的一道前置閘 —— 本檔的業務邏輯一個字都沒動。**
  --   成因:本檔 `CREATE OR REPLACE` 的 `expire_unpaid_orders` 是**依 `payment_channel` 分流【之前】**
  --   的那一代(它的 WHERE 寫死 `interval '1 day'`、全檔 `payment_channel` 命中 0),
  --   而它對這支函式的既有前置閘**只問「有沒有心跳」** ⇒ 分流版身上也有心跳 ⇒ **那道閘會放行**。
  --   ⇒ 🛑 **貼下去會把 Sean 2026-09-03 的拍板(匯款/現金 5 天)靜靜還原成一律 1 天**,
  --     而本檔既有的四道事後 `strpos` 閘**一道都不會叫**(它們檢的字面在兩版都在)。
  --   🎯 **⇒ 而那個洞是【分流那一片】的作者(線信)自己漏的**:他用 `md5(prosrc)` 守住了
  --     「別人先上、我後上」那個方向, **而沒有守「我先上、別人後上」** ——
  --     📌 **一個不變式有兩個方向, 而他只想到會傷害自己的那一個。**
  --   ⚠️ **本閘只擋、不修** —— 要不要分流、天數多少, 那是 ⟦b4-NONCARDPAID1⟧ 與 Sean 的事。
  IF pg_catalog.strpos(
       (SELECT p.prosrc FROM pg_catalog.pg_proc p
         WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure),
       'payment_channel') > 0 THEN
    RAISE EXCEPTION '前置:正式庫的 expire_unpaid_orders 已經【依 payment_channel 分流】'
                    '(supabase/migrations/20260903080000_m4b_expire_unpaid_by_payment_channel.sql:'
                    ' tappay 1 天 / bank_transfer 與 cash 5 天, Sean 2026-09-03 逐字拍板)。'
                    '而本檔重建的是分流【之前】那一版 ⇒ 貼下去會把那個拍板靜靜還原成一律 1 天, '
                    '而本檔的四道事後 strpos 閘不會叫。'
                    '出路二選一:①把 20260903080000 的那段 CASE 分流合進本檔的函式體 '
                    '②先貼本檔、再貼 20260903080000(它自己的 md5 前置閘會擋住順序錯誤)。拒繼續';
  END IF;
END
$pre$;

-- ── 1. 重算器 ────────────────────────────────────────────────────────────
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
BEGIN
  -- 🔴🔴 codex A:88 —— **整段包在一個 EXCEPTION 裡, 不是只包 OP6a 那一發。**
  --    v2 只包了 OP6a ⇒ 之後的 SUM / UPDATE / 下游 trigger 任一拋錯, 例外都在保護區外面
  --    ⇒ AFTER trigger 冒錯 ⇒ **外層那筆真實收款 INSERT 一起 rollback**。
  --    ⇒ 📌 那不符合 Sean 那句「錢收了就要記, 不該取決於另一支計算程式跑不跑得動」——
  --      而 v2 的碼看起來完全像在遵守它。
  BEGIN
    SELECT o.payment_status INTO v_status FROM public.orders o WHERE o.id = p_order_id;
    IF v_status IS NULL THEN RETURN; END IF;

    -- 🔴 可判定集:只有這三個值本片才動。(與 OP6a 的前提 P1 逐字相同, 不是我另外挑的。)
    IF v_status NOT IN ('unpaid'::public.payment_status,
                        'paid'::public.payment_status,
                        'partiallyPaid'::public.payment_status) THEN
      RETURN;
    END IF;

    -- 🔴🔴 **有任何退款活動 ⇒ 交還給退款管線, 本片一個字都不碰。**
    --    理由不是保守, 是【一個值域只能有一個寫入端】:
    --    `pcm_sync_order_refund_payment_status` 已經是退款狀態的寫入端,
    --    而 `admin_record_manual_refund` 自 20260823020000 起就會呼叫它。
    --    本片若也寫, 兩邊會用不同的分母 ⇒ codex 演過:收 1000、人工退 400、卡片退 600,
    --    兩本帳合計退完而狀態永遠停在 partiallyRefunded。
    IF EXISTS (SELECT 1 FROM public.order_manual_refunds m
                WHERE m.order_id = p_order_id AND m.voided_at IS NULL)
       OR EXISTS (SELECT 1 FROM public.order_refunds r WHERE r.order_id = p_order_id) THEN
      RAISE LOG '[pcm_noncard_settle] order=% 有退款活動 ⇒ 交還退款管線, 本片不動', p_order_id;
      RETURN;
    END IF;

    v_res := public.admin_compute_order_settlement(p_order_id);
    v_verdict := v_res ->> 'verdict';

    SELECT coalesce(pg_catalog.sum(p.amount), 0) INTO v_received
      FROM public.order_payments p WHERE p.order_id = p_order_id;

    IF v_verdict = 'settled' THEN
      v_new := 'paid'::public.payment_status;
    ELSIF v_verdict = 'underpaid' THEN
      IF v_received > 0 THEN
        v_new := 'partiallyPaid'::public.payment_status;
      ELSE
        v_new := 'unpaid'::public.payment_status;   -- 收款被沖銷光 ⇒ 回到原點
      END IF;
    ELSE
      -- `overpaid`:payment_status 值域裡沒有對應的值(恰 5 個)⇒ 開一列給人看, 不猜。
      -- 其餘(needs_human 等):它自己宣告算不清 ⇒ 不該由它決定終態。
      -- 🛑 而「不翻是安全的」依賴第 2 節那條 cron 腿 —— 沒有它, 這種單隔天照樣被取消。
      RAISE LOG '[pcm_noncard_settle] order=% verdict=% ⇒ 不翻狀態', p_order_id, v_verdict;
      RETURN;
    END IF;

    -- 🛑🛑 **本函式【不】序列化同一張單的並行收款 —— 而這一段寫的是它【不做什麼】。**
    --    兩筆收款同時進來 ⇒ 兩個 AFTER trigger 各自在自己的快照裡算,
    --    **誰都看不到對方尚未提交的那一列** ⇒ 兩邊都算 partiallyPaid;
    --    兩個 UPDATE 在 orders 列上排隊, 而等待者醒來後沿用它早就算好的值
    --    ⇒ **最終狀態偏低, 而且是【安靜的】:沒有錯誤、沒有告警、單子看起來完全正常。**
    --    ⇒ 📌 後果不是技術債:員工會以為客人還欠錢 ⇒ 那是會產生一通電話的錯。
    --    🔵 **修法已知** = pg_advisory_xact_lock(訂單 id) 序列化重算那一段
    --      —— 🛑 ~~而它【未實跑驗過】, 那句話是讀文件推出來的, 不是背書。~~ 已開列 b4-PAYCONCUR1。
    --      ✅ **2026-09-02 02:0x 就地訂正:那一格【已經被實跑驗過了】, 舊字面留著劃掉。**
    --         線 `-15` 拋棄式 PG 17.10, 三個世界各跑 3 發, **三發完全一致**:
    --           none      ⇒ partiallyPaid | 實收 1000 | 死結 0   ← 缺陷本體
    --           forupdate ⇒ partiallyPaid | 實收  500 | 死結 1   ← 見下面那一格
    --           advisory  ⇒ **paid**      | 實收 1000 | 死結 0   ← ✅ 兩邊都關掉了
    --         📎 `~/pcm-mailbox/量測-advisory-lock-真的兩邊都關得掉嗎-20260902.md`
    --      🔴 **而【我這一句下面那句】(codex A:73「其中一筆真實收款被 abort」)講得太輕**:
    --         實測最終狀態是 `partiallyPaid | 500` ⇒ **那筆錢在資料庫裡不存在了**, 不只是「被 abort」
    --         ⇒ 客人匯 1000 而系統只看得到 500 ⇒ 員工去要一筆已收到的錢, **而金額還是錯的**。
    --      🛑 **而 `-15` 那一發最該記的不是結論, 是它第一次【沒有重現死結】**:
    --         交錯 0.4 秒 ⇒ forupdate 印 `paid|1000 · 死結 0` ⇒ 那會讓人回報「FOR UPDATE 沒問題」。
    --         成因:AFTER ROW trigger 在同一句裡跑 ⇒ s1 INSERT 後立刻升級而 s2 還沒 INSERT
    --         ⇒ 沒有互等 ⇒ **那只是排隊, 不是死結**。要在拿鎖前塞 `pg_sleep(0.8)` 才到得了那個世界。
    --         📌 **⇒ 「我跑了那個 harness」與「那個 harness 到得了那個世界」是兩個宣稱。**
    --      ⚠️ 射程(`-15` 自標, 原封):那是【最小重現】不是本檔真碼 ⇒ 它證的是【機制】不是
    --         【本檔改完會不會對】;本機 PG 17.10 vs Supabase 17.6;鎖鍵用 `hashtext(uuid::text)`
    --         ⇒ 真碼要用什麼鍵是另一個決定, 而 `hashtext` 會碰撞(只影響效能不影響正確性)。
    --    🔴 **而前一版的 FOR UPDATE 是【刻意拿掉】的, 不要加回去** —— 理由在下一行。
    -- 🔴 codex A:73 —— **不用 `SELECT … FOR UPDATE`。**
    --    子表 INSERT 會因 FK 先持有父列 KEY SHARE;AFTER trigger 再升成 FOR UPDATE
    --    ⇒ 兩個 session 同時進來可形成鎖升級死結 ⇒ 其中一筆真實收款被 abort。
    --    ⇒ 改成【條件式 UPDATE】:不先讀後寫, 由 WHERE 自己守住可判定集。
    --    ⚠️ 代價明寫:兩發並行時是「後寫的贏」, 而兩發都讀完整的 SUM ⇒ 最後一發是對的。
    --      這不是序列化保證, 是收斂性 —— 不要把它讀成前者。
    UPDATE public.orders o
       SET payment_status = v_new, updated_at = pg_catalog.now()
     WHERE o.id = p_order_id
       AND o.payment_status IN ('unpaid'::public.payment_status,
                                'paid'::public.payment_status,
                                'partiallyPaid'::public.payment_status)
       AND o.payment_status IS DISTINCT FROM v_new;
  EXCEPTION WHEN OTHERS THEN
    -- 🎯 Sean 拍的那一條落在這裡:任何一步炸掉 ⇒ 收款那一列照樣留下, 狀態不動。
    RAISE LOG '[pcm_noncard_settle] order=% 重算整段失敗(%), 收款事實保留、狀態不動', p_order_id, SQLERRM;
    RETURN;
  END;
END
$fn$;

REVOKE ALL ON FUNCTION public.pcm_noncard_settle_recompute(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_noncard_settle_recompute(uuid) FROM anon, authenticated, authenticator, service_role;

-- 🔴 只有一個掛點(理由見檔頭給 Sean 那段)。
-- 🔵 為什麼是 AFTER INSERT 而不是 INSERT OR UPDATE OR DELETE:`order_payments` 是 append-only
--    (`order_payments_immutable_bu` 擋 UPDATE、`order_payments_no_delete_bd` 擋 DELETE)
--    ⇒ 沖銷是插一列負數。寫 UPDATE/DELETE 進去只會是死碼, **而死碼會被後人讀成「這裡有處理」**。
CREATE OR REPLACE FUNCTION public.pcm_noncard_settle_after_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $tg$
BEGIN
  PERFORM public.pcm_noncard_settle_recompute(NEW.order_id);
  RETURN NULL;
END
$tg$;

REVOKE ALL ON FUNCTION public.pcm_noncard_settle_after_payment() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_noncard_settle_after_payment() FROM anon, authenticated, authenticator, service_role;

DROP TRIGGER IF EXISTS pcm_noncard_settle_after_payment_ai ON public.order_payments;
CREATE TRIGGER pcm_noncard_settle_after_payment_ai
  AFTER INSERT ON public.order_payments
  FOR EACH ROW EXECUTE FUNCTION public.pcm_noncard_settle_after_payment();

-- ── 2. 逾期 cron:補上「手上還有錢」那條腿 ────────────────────────────────
-- 🔴🔴 **本節的函式體逐字取自 `20260828060000_m4b_b4cron6_expire_unpaid_orders_heartbeat.sql:189`**
--    —— **含成功心跳那一整段**。
--    ⚠️ v2 是從拋棄式測試庫 `pg_get_functiondef` 抄的, 而那個庫**刻意跳過了 20260828060000**
--      (它讀 `cron.job`, 本機沒有 pg_cron)⇒ 抄到的是 `20260809160000` 的舊身體
--      ⇒ **心跳整段被刪掉, 而檔案自稱「只加一句」。** codex 對抗審查抓到(must-fix A:195)。
--    ⇒ 📌 **要抄一支既有的 DB 函式來改 ⇒ 先跑 `bash scripts/latest-definition-of.sh <名字>`。**
--      那條規矩就寫在 CLAUDE.md 路由表裡, 而它的觸發情境逐字就是這件事 —— 而我沒跑。
--
-- 🔴 而新增的那條腿是 **「淨額 > 0」不是「有沒有收款列」**(codex must-fix A:241):
--    收 1000 再全額沖銷 ⇒ 淨實收 0, 而歷史上那兩列還在
--    ⇒ 寫成「有沒有列」的話, 那張單會被**永久擋住**, 它再也不會被取消 ⇒ 變成沒有終點的殭屍。
--    ⇒ 而「淨額 > 0」讓沖銷回 0 的單**恢復可取消**, 那才是對的。
CREATE OR REPLACE FUNCTION pcm_cron.expire_unpaid_orders(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''  -- 防 SECURITY DEFINER search_path 劫持;下方全 schema-qualify。
AS $fn$
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
       AND o.created_at < pg_catalog.now() - interval '1 day'        -- 🔴 1 天 = Sean 2026-08-09 逐字「1天」(落 memory project_m4b-b2-shipments-db-decisions:79;
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
       -- 🔴🔴 ⟦b4-NONCARDPAID1⟧ 新增:**匯款/現金那條腿**。
       --    上面那一句是卡片那條路的保護, 而匯款這條路一直沒有對應的那一句
       --    ⇒ 客人匯了款、後台登記了, 而這支函式看不到那筆錢 ⇒ 隔天把單取消掉。
       --    ⇒ 📌 本片不是「加一個新保護」, 是【補齊一個已經存在的對稱】。
       --    🔴 判準是**淨額**不是**有沒有列**:沖銷是插一列負數 ⇒ 收 1000 再沖 -1000 的單
       --      淨實收回到 0 ⇒ 我們手上【沒有錢】⇒ 它該恢復可取消。
       --      (寫成「有沒有列」會讓它永久擋住 —— codex must-fix A:241。)
       --    ⚠️ 這裡刻意**不篩 rail**:任何軌別的錢都是錢。
       AND coalesce(
             (SELECT pg_catalog.sum(np.amount) FROM public.order_payments np
               WHERE np.order_id = o.id), 0) <= 0
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

  -- ══ ⟦b4-CRON6⟧ 片2:成功心跳(**逐字保留, 一個字都沒動**)═══════════════════
  -- 🔴🔴 **那個 EXCEPTION 子區塊是那一片的重點,不是防禦性裝飾。**
  --    沒有它:心跳表出任何問題 ⇒ 整個函式拋錯 ⇒ **那一小時的訂單不會被取消**
  --    ⇒ 監控把被監控的弄死。
  -- ⚠️ 代價明寫:心跳寫失敗時**只留一行 WARNING**,而心跳會開始變舊 ⇒ 後台那一列會亮。
  --    那是**假陽性,而方向是對的**(叫比不叫好),**不得**被讀成「這裡不會出錯」。
  -- 🔴🔴 **而「心跳寫不出去不影響本輪取消」有一個【真的例外】**(codex R1 must-fix ②):
  --    這一列**被別人鎖住**時不會立刻拋錯,它會**等** —— 而此時 orders 那半已經改完。
  --    若這一等撞上 statement_timeout 或人工 cancel(SQLSTATE 57014),
  --    🔴 `EXCEPTION WHEN OTHERS` 依 PostgreSQL 定義**不接** query cancel
  --    ⇒ 例外冒出去 ⇒ **整輪取消一起 rollback**。⚠️ 那一片沒有修掉這條路, 本片也沒有。
  -- 🔴 用 `clock_timestamp()` 不用 `now()`:`now()` 是**交易起始時間**
  --    ⇒ 一個跑很久的交易會用舊時刻蓋掉一個比它新的成功心跳 ⇒ `last_success_at` 會倒退。
  --    而 `GREATEST` 那半才是真正擋倒退的(晚到的舊值不得覆蓋新值)。
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
$fn$;

REVOKE ALL ON FUNCTION pcm_cron.expire_unpaid_orders(integer)
  FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;

-- ── 3. 後置斷言(貼完看到最後那兩行 NOTICE 才算成功)──────────────────────
-- 🔴 codex must-fix A:290 / B:217:v2 的斷言是在【含註解的 prosrc】裡搜字串
--    ⇒ 把真正的述詞整段刪掉、只留下解釋它的那段註解, 它照樣通過。
--    ✅ 本節**先把 `--` 註解剝掉再比對** ⇒ 那個字出現在註解裡不算數。
--    ⚠️ 而這仍然是【文字層】的判定, 不是行為判定 —— 行為那一層在
--      `scripts/noncardpaid-verify.sh`(兩個世界 + 突變證人 + 同一發 cron 裡的對照組)。
--      ⇒ 📌 **兩層都要:這一層答「貼下去有沒有生效」, 那一層答「它做的事對不對」。**
DO $post$
DECLARE v_src text; v_bare text; v_n integer;
BEGIN
  -- 3a. trigger 恰一支, 在該在的表上, 且啟用中
  SELECT pg_catalog.count(*)::integer INTO v_n FROM pg_catalog.pg_trigger t
   WHERE NOT t.tgisinternal AND t.tgname LIKE 'pcm_noncard%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '後置 3a:本片 trigger 共 % 支(預期恰 1 —— Sean 2026-09-02 拍【甲 只交一個】)', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = 'public.order_payments'::regclass
                    AND t.tgname = 'pcm_noncard_settle_after_payment_ai'
                    AND NOT t.tgisinternal AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION '後置 3a:order_payments 上那支 trigger 不在或未啟用';
  END IF;

  -- 3b. cron:剝掉註解之後, 兩條腿的述詞都還在
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure;
  v_bare := pg_catalog.regexp_replace(v_src, '--[^' || pg_catalog.chr(10) || ']*', '', 'g');

  IF pg_catalog.strpos(v_bare, 'payment_charge_attempts') = 0 THEN
    RAISE EXCEPTION '後置 3b:卡片那條腿不見了(剝註解後查無)⇒ 本片把既有保護弄掉了, 拒繼續';
  END IF;
  IF pg_catalog.strpos(v_bare, 'np.order_id = o.id') = 0 THEN
    RAISE EXCEPTION '後置 3b:匯款那條腿不在(剝註解後查無)⇒ 這一片最重要的那一半沒有落地';
  END IF;
  -- 🔴 而這一格是 v2 沒有的:**心跳那一段必須還在**。v2 就是在這裡把它整段刪掉的。
  IF pg_catalog.strpos(v_bare, 'sweeper_heartbeat') = 0 THEN
    RAISE EXCEPTION '後置 3b:成功心跳整段不見了 ⇒ 後台會把這支排程顯示成【失聯】, 而它其實在跑。'
                    '(這正是 v2 的 must-fix A:195 —— 從錯的一代抄函式體。)拒繼續';
  END IF;
  IF pg_catalog.strpos(v_bare, 'clock_timestamp') = 0 THEN
    RAISE EXCEPTION '後置 3b:心跳的 clock_timestamp 不見了 ⇒ last_success_at 會被慢交易倒退, 拒繼續';
  END IF;

  -- 3c. 重算器:整段包在 EXCEPTION 裡(Sean「錢收了就要記」那一條的形狀)
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.pcm_noncard_settle_recompute(uuid)'::regprocedure;
  v_bare := pg_catalog.regexp_replace(v_src, '--[^' || pg_catalog.chr(10) || ']*', '', 'g');
  IF pg_catalog.strpos(v_bare, 'order_manual_refunds') = 0
     OR pg_catalog.strpos(v_bare, 'order_refunds') = 0 THEN
    RAISE EXCEPTION '後置 3c:重算器少了「有退款活動就交還」那道閘 ⇒ 它會變成第二個退款狀態寫入端, 拒繼續';
  END IF;
  IF pg_catalog.strpos(v_bare, 'FOR UPDATE') > 0 THEN
    RAISE EXCEPTION '後置 3c:重算器裡出現 FOR UPDATE ⇒ 子表 INSERT 已持父列 KEY SHARE, 再升級會死結'
                    '(codex must-fix A:73)。拒繼續';
  END IF;

  -- 3d. ACL 閉世界:兩支新函式對四個具名角色都應為零
  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM pg_catalog.pg_proc p,
         pg_catalog.unnest(ARRAY['anon','authenticated','authenticator','service_role']) r
   WHERE p.proname IN ('pcm_noncard_settle_recompute','pcm_noncard_settle_after_payment')
     AND pg_catalog.has_function_privilege(r, p.oid, 'EXECUTE');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '後置 3d:本片兩支函式仍有 % 項具名 EXECUTE ⇒ 兩道 REVOKE 沒收乾淨', v_n;
  END IF;

  RAISE NOTICE '⟦b4-NONCARDPAID1⟧ 後置斷言全過:trigger 恰 1 支且啟用 / cron 兩條腿 + 心跳都在(剝註解後查) / 重算器有退款交還閘且無 FOR UPDATE / 兩支函式零具名 EXECUTE';
  RAISE NOTICE '⟦b4-NONCARDPAID1⟧ ⚠️ 看到上面那一行 = 貼成功。沒看到 = 有問題, 不要當成功。';
END
$post$;

COMMIT;

-- ══ 4. 還原(貼錯了就【直接貼下面這一段】,它是可以執行的 SQL)═══════════════
--
-- 🔴 它【不】把已經被改過的訂單狀態改回去 —— 那些是真實的收款事實。
-- 🛑 而它會把逾期程式改回【沒有匯款那條腿】的樣子 ⇒ 還原之後, 原本的缺陷會回來:
--    客人匯款、後台登記了, 而那張單隔天仍然會被自動取消。
-- ✅ 而它**保留心跳**(它重貼的是 20260828060000 那一代的完整身體, 只是拿掉本片那一條腿)。
--    ⇒ 這一點與 v2 不同:v2 的還原段是【註解】, 而且它指向的做法(重貼那支 migration)
--      會被那支自己的 md5 前置閘擋下來 —— 因為本片已經產生了「第三種函式體」。
--      (codex must-fix A:320。)
--
-- ⚠️ 貼還原段之前先確認你要還原的是本片, 不是別人後來又改過的版本:
--    `SELECT prosrc FROM pg_proc WHERE oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure;`
--    裡面若出現 `np.order_id = o.id` 以外你不認得的東西 ⇒ 停下來問, 不要貼。
--
-- 🎯 **還原 SQL 在【另一支檔】,不在本檔裡。**
--    `docs/specs/2026-09-01-m4b-noncardpaid-settle-ROLLBACK.sql`
--    (交件時是桌面上的 `還原-匯款收款翻狀態-20260902.sql`)
--
-- 🔴 **為什麼是另一支檔, 而這一格是 codex 逼出來的**:
--    還原 SQL 若寫在本檔裡, 它只有兩種形狀 ——
--      ① 它是【活的 SQL】⇒ 貼本檔的人會把剛裝好的東西當場拆掉
--      ② 它是【註解】⇒ 而那就不是「直接貼那一段」, 而 v2 檔頭就是這樣寫的(must-fix A:320)
--    ⇒ 📌 **兩種都不對, 而它們的共同成因是【想把兩個用途塞進同一支檔】。**
--    ⇒ ⇒ 拆成兩支 ⇒ 每一支都是「整支貼下去就對」, 而那是唯一不會被貼錯的形狀。
--
-- — END —
