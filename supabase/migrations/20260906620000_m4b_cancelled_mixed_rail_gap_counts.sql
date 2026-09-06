-- ⟦b4-CANCELMAILMIXEDRAIL⟧ 的【提醒那半】—— **鏡像 `20260904280000`, 不是新設計。**
--
-- ══ 這一支為什麼存在 ══════════════════════════════════════════════════════
-- 板 `⟦b4-CANCELMAILMIXEDRAIL⟧` 那一列把兩半寫在同一格裡, 而它們的狀態不一樣:
--   ✅ **排除閘那半做完了**:`20260905310000_m4b_cancelled_email_pending_view.sql:193-196`
--      逐字 `AND NOT EXISTS (SELECT 1 FROM public.order_manual_refunds m
--      WHERE m.order_id = o.id AND m.voided_at IS NULL)`
--      ⇒ 卡 + 現金混合退款的取消單**整張不寄**(主視窗 2026-09-05 裁 Q2 乙)。
--   🔴 **而【提醒人工去寄】那半空著。** 2026-09-06 `-mail` 複驗逐字寫在板上:
--      `check-anomaly-alerts.ts` 全檔 `mixed` / `混合` 命中 1, 而開檔一看那一處在講別的事
--      (正對照同檔 `cancelled` ⇒ 9 · 負對照現造字面 ⇒ 0)⇒ **零計數、零告警。**
-- ⇒ 📌 **這一支就是那半。照抄現成的儀器, 不發明。**
--
-- ══ 🔴 為什麼【不寄】不等於【處理完了】 ═══════════════════════════════════
-- 排除閘讓我們**不會寄一封說錯錢的信** —— 那是對的, 而它把問題換了一個形狀:
--   **那位客人仍然需要一封信, 只是要人工寄。**
-- 而 outbox 的 anti-join 讓這件事**不會自己好**:日後卡上補退滿, 也不會再寄
--   (`20260905310000:187` 逐字)。⇒ 沒有人去寄的話, 它就永遠沒有被寄。
-- 🛑 **而「沒有人會知道」與「沒有這種單」在儀表上印同一個東西** —— 這一支就是去分開那兩個。
--
-- ══ 🛑 述詞是怎麼來的:逐字對過那支 view, 只翻一個字 ═══════════════════════
-- 對照對象 `supabase/migrations/20260905310000_m4b_cancelled_email_pending_view.sql`
-- (2026-09-06 開檔逐行核, 行號是那一版的):
--   `:178`  WHERE o.payment_method = 'tappay'          ← 逐字保留
--   `:179`    AND o.payment_status = 'refunded'        ← 逐字保留
--   `:180`    AND o.cancelled_at IS NOT NULL           ← 逐字保留
--   `:193-196` AND NOT EXISTS (order_manual_refunds … voided_at IS NULL)
--                                                     ← 🔴 **只有這一條翻成 EXISTS**
--   `:197-200` AND NOT EXISTS (email_outbox … 'order_cancelled')
--                                                     ← 逐字保留(**還沒入列**的才算)
--   🔴 **2026-09-06 codex R1 nit:那個 anti-join 證的是【沒有被排進 outbox】, 不是【沒有寄出去】。**
--      ⇒ 一張混合單若有一列 `order_cancelled` 而狀態是 `failed`(`sent_at IS NULL`), 本支仍回 0
--        ⇒ 📌 **那位客人一樣沒收到信, 而本支不會叫。** 那一格由 outbox 自己的死信告警承接
--        (`get_email_outbox_deadman_counts`)—— ⚠️ **而「它真的承接得到這一列」我沒有量,
--        且 codex R2 指出它有【已知不算數】的狀態**:`failed` 而重試次數還沒用完、還沒到下次
--        重試時間、錯誤碼是一般錯誤的那些列, 死信告警當下也不計。⇒ 📌 **標「未量」不等於「有人接」。**
-- ⛔ ~~本支與那支 view 是互補的兩半, 加起來 = 「該通知而還沒通知」的全部。~~
-- 🔴 **2026-09-06 codex R1 must-fix:那句【錯了】, 而它錯在「全部」那兩個字。**
--    反例(它給的, 我開檔核過):**純卡全退的取消單, 沒有有效人工退款, 兩個信箱都空, 無 outbox**
--    ⇒ view 因為 `:201-204`(信箱)排除它 · 本支因為缺人工退款排除它 ⇒ **兩邊都不管。**
--    ⇒ 📌 正確的說法是:**兩者互斥(不會重複數同一張), 而【聯集不等於全部】。**
--      那個缺口是真的, 它屬於 `⟦b4-NORECIPIENTWINDOW⟧` 那一族(沒有收件人的單), 不在本片。
--
-- ══ ⚠️ 而有兩條 view 的述詞我【刻意不帶】, 這是設計不是漏掉 ═══════════════
-- `:201-204`(至少一個信箱非空)與 `:205-211`(手動建單留白那條)——
--   🔴 **理由是 fail 方向相反**:那支 view 是**自動寄信**的掃描面 ⇒ 它 fail-closed 才對
--      (`:176-177` 逐字「寧可不寄, 不寄一封說錯錢的信」)。
--   🔵 **本支是【看門狗】** ⇒ 它**在這兩條上**要 fail-**open**:一張沒有信箱的單, 人還是要知道
--      (他打得了電話), 而帶上那兩條會讓它**安靜地從提醒裡消失**。
--   ⇒ 📌 **同一組條件在「要不要自動做」與「要不要告訴人」兩個問題上, 答案本來就不同。**
-- 🔴🔴 **而【不要把上面那句讀成「本支整體 fail-open」】**(2026-09-06 codex R1 must-fix)——
--    我保留的那三條(`:178` `:179` `:180`)**每一條都是 fail-closed 的, 而我把它們一起繼承了**:
--    🔬 反例(codex 給、我核過):舊單 `payment_method IS NULL`(建表 `20260604120000:109` 逐字
--      `payment_method text, -- D6 nullable;階段② 寫`)、卡上退了 4000、有效人工退款 1000、
--      總額 5000、已取消且 `refunded`、無 outbox ⇒ 🛑 **本支與那支 view 【都】漏掉它。**
--    ⇒ 📌 **精確的說法是:我只在【那兩條】上翻成 fail-open, 其餘三條照抄 ⇒ 本支是【部分】fail-open。**
--      要連 NULL 那一類也接住, 得動那三條 —— 而那會讓本支與 view 不再對得起來, 是另一片的題。
--
-- ══ 🛑 三件這一支【證不到】的事(照姊妹支的規矩寫在這裡, 不修掉)═══════════
-- ① **收權斷言看不到 role membership。** 下面那段只讀 `proacl` ⇒ 有人把 `payment_confirmer`
--    **授予**另一個角色之後, 斷言仍然全綠而那個角色執行得了這支 SECURITY DEFINER。
--    🔵 這是整族的已知天花板(逐字抄自 `20260904280000` ①), **不是本支的退步。**
-- ② **apply 期的形狀斷言只驗三個 key 在不在。** 把 `pending_manual_send_count` 那個查詢
--    整段換成常數 `0`, 本檔**照樣全綠** —— apply 當下庫裡沒有資料可以分辨。
--    🔴 **缺的那道檢查 = 在拋棄式 PG 上造一筆會落進那個桶的資料再呼叫它。**
--    ✅ **本片有做**(與 `20260904280000` ② 不同, 那一支當時做不到):**十格雙向**
--       —— 空庫 0 · 混合軌單 1 · 人工退款作廢 0 · 補一列 outbox 0 · outbox 換別的事件回 1 ·
--       純卡軌單 pending 不動而分母 +1 · 三條保留述詞各改一字各 0 · 全還原回 1。
--       落點寫在本片的 commit body。
--    ⚠️ **而 codex R1 指出這個 fixture 的天花板, 照實抄**:真 schema 上人工退款 `refund_amount > 0`、
--       作廢是三欄配對、outbox 有狀態集與 `(event_type, dedup_key)` 唯一鍵
--       ⇒ 📌 **我「只改 voided_at」那一格, 不等於走過真正的作廢流程。**
-- ③ **前置閘只驗「同名的 relation / column 在不在」, 不驗那個 view 的定義。**
--    有人先貼了一個同名而內容不同的 view ⇒ 閘照過, 而**本支與它的互斥關係就不成立了**
--    (⚠️ 是「互斥」不是「互補」—— 見上面那條 codex R1 訂正)。
--
-- ══ 🔴🔴 一件本支【解不掉】的事, 而下一個人一定會撞到 ══════════════════════
-- ⛔ ~~這個計數沒有人有辦法讓它歸零。~~ ~~它只會往上長。~~
-- 🔴 **2026-09-06 codex R1 must-fix:那兩句都太強, 而它給了一條我沒想到的歸零路徑** ——
--    **把那張單最後一筆有效的人工退款【作廢】**(`20260820100000` 的 void RPC)
--    ⇒ 本支的 `EXISTS` 立刻不成立 ⇒ 計數 1→0, 而**根本不需要有人去寄那封信**。
--    ✅ **而那個行為是【對的】**:退款被作廢 ⇒ 這張單本來就不是混合軌了 ⇒ 它該掉出提醒。
--      (🔬 我的拋棄式 PG 格2 量到的正是這一格:作廢 ⇒ pending 0 · 分母不動。
--       ⇒ 📌 **我量到了它, 而我在檔頭寫了一句與那格讀數相反的話** —— 這才是這條 must-fix 的價值。)
-- ⛔ ~~一張【始終是混合軌】的單, 在人工寄完信之後, 沒有任何辦法讓它掉出這個計數。~~
-- 🔴 **codex R2 又打掉一次 —— 那句還是太寬。** 反例:總額 5000、卡退 4000、人工退款**兩筆各 500**,
--    作廢其中一筆 ⇒ **仍然是混合軌**(還有一筆未作廢 ⇒ 我的 `EXISTS` 仍成立), 而
--    `20260905440000` 把已退金額算成 4500 < 5000 ⇒ `payment_status` 降成 `partiallyRefunded`
--    ⇒ 🛑 **我的 `:179` 不成立 ⇒ 它照樣掉出計數。**
-- ✅ **收窄到這裡才是真的**(這才是缺口):
--    **這個數字不會因為【有人去把信寄了】而下降。** 它會下降的每一條路, 都不是「寄了」。
-- 🔬 2026-09-06 `-mail` 量:`git grep -rn "人工寄\|manually_sent\|manual_send" -- apps packages
--    supabase/migrations` ⇒ **命中 2**, 而**兩筆都是 `20260905310000` 裡的註解**
--    (`:188` `:227`)⇒ 📌 **今天沒有任何路徑可以把「我人工寄過了」記進系統。**
--    (🟢 正對照 `git grep -rln "email_outbox" -- apps packages supabase/migrations` ⇒ **71 檔**
--     ⇒ 這把尺是接上的, 那個 2 不是尺壞掉。)
-- ⇒ 🛑 **後果寫明**:一張**始終是混合軌**的單被人工寄過信之後, 這個數字**不會因此下降**
--    ⇒ 一個每天都在叫的告警, 而**規律誤報會訓練人略過整封信**
--    (`packages/adapters/src/payment/anomaly-alert-key-contract.test.ts:26` 逐字記過同一個病)。
-- ✅ **本支【不預設答案】**:述詞裡的 `NOT EXISTS (email_outbox … 'order_cancelled')`
--    在兩種答案下都成立 —— 若日後決定「人工寄完補一列 outbox」, 這個數字**自己就會歸零**,
--    本支一個字都不用改。⇒ 那一題是【接告警那一片】的題, 已端給主視窗。
--
-- ⚠️ **前置:`20260820090000` 與 `20260905310000` 必須先貼**
--    (前者建 `order_manual_refunds.voided_at`, 後者是我對過的那支 view)。
--    下面有前置閘擋順序反了的情況 —— 🔴 **一個查不到欄位的函式不會安靜地回 0, 它會 42703**
--    ⇒ 而那是在**告警要用它的時候**才炸。
-- 🔴🔴 **而還有【第三支】前置, 我的閘【擋不到它】**(2026-09-06 codex R1 must-fix, 照實寫):
--    `20260905010000_m4b_manual_refund_syncs_payment_status.sql`(人工退款要同步 `payment_status`)。
--    🔬 失敗情境:總額 5000、卡退 4000、人工退 1000。**那一支沒貼**的話, 舊的同步器把這張單
--      算成 `partiallyRefunded` 而不是 `refunded` ⇒ 🛑 **本支的 `:179` 那一條不成立 ⇒ 回 0**,
--      而**兩道前置閘與形狀斷言全部照過**。
--    ⇒ 📌 **症狀就是這一支存在的理由本身:一個安靜的 0。**
--    ⚠️ **為什麼不加閘 —— 這是量到的, 不是我的偏好**(codex R2 must-fix 逼出來的):
--      🔬 `grep -nE '^CREATE (OR REPLACE )?(FUNCTION|TRIGGER)' 20260905010000_*.sql` ⇒ **命中 1 行**,
--        而那一行是 `:244 CREATE OR REPLACE FUNCTION public.pcm_sync_order_refund_payment_status`
--        —— **一個【本來就存在】的函式**。⇒ 📌 **那支 migration 沒有建任何新的具名物件**
--        ⇒ **沒有東西可以掛存在性閘**;唯一的路是比對函式**內容**, 而那種閘會被任何一次
--        無害的改寫弄紅 ⇒ 那不是一道能長久活著的閘。
--      🛑 **⇒ 所以這一格【誠實地是敞開的】, 不是被我處理掉了。**
--        可查的替代:`bash scripts/is-migration-applied.sh 20260905010000`(要人去跑, 不會自己叫)。
--    🔬 **而我的拋棄式 PG fixture 看不到這一格** —— 我是直接把 `payment_status` 填成 `'refunded'`
--      ⇒ **我的 fixture 從來沒有讓那個同步器跑過。** 這是 codex 抓到而我沒量到的。

BEGIN;

-- ── 前置閘:我依賴的那兩樣東西在不在 ──────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
     WHERE a.attrelid = 'public.order_manual_refunds'::regclass
       AND a.attname = 'voided_at' AND a.attnum > 0 AND NOT a.attisdropped)
  THEN
    RAISE EXCEPTION '前置閘:order_manual_refunds 沒有 voided_at ⇒ 20260820090000 還沒貼, 先貼那一支';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'pcm_cancelled_email_pending')
  THEN
    RAISE EXCEPTION '前置閘:找不到 pcm_cancelled_email_pending ⇒ 20260905310000 還沒貼, 先貼那一支';
  END IF;
END
$$;

CREATE FUNCTION public.get_cancelled_mixed_rail_gap_counts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  -- 🔴 `pg_catalog.jsonb` 而不是裸的 `jsonb`(2026-09-06 codex R1 must-fix):
  --    `search_path = ''` **不涵蓋 `pg_temp`** —— 暫存 schema 對【型別名】是隱含且優先搜尋的
  --    ⇒ 有 TEMP 權限的呼叫端先建一個同名暫存型別, 就能左右這一行解析到什麼。
  --    ⚠️ **那條反例我【沒有實測】**(codex 自己也標了未實測), 而加上前綴的成本是一個字
  --    ⇒ 照做, 不去爭論它有多可能。🔵 姊妹支 `20260904280000:73` 同樣是裸的 —— **那是整族的,
  --      不是我這一支的退步**;要不要一起收由主視窗排, 本片不動別人的檔。
  v_result pg_catalog.jsonb;
BEGIN
  -- 🔴 **本支【沒有 cutoff 參數】, 而那與部分姊妹線不同 —— 不是漏了。**
  --    要落進這個桶必須 `cancelled_at IS NOT NULL` 且 `payment_status = 'refunded'`
  --    且**有一筆未作廢的人工退款** —— 而人工退款那張表是 `20260820010000` 才建的
  --    ⇒ 母體天生從空的開始長, 沒有「上線第一秒等於歷史全部」那個病。
  SELECT pg_catalog.jsonb_build_object(
    -- 🔴🔴 **告警的主詞。** 刷卡取消單、錢已退、而它走過**混合軌**(有未作廢的人工退款)
    --    ⇒ 系統**刻意不寄**取消信 ⇒ 這封信**只能人工寄**, 而今天沒有人會被告知。
    -- 🛑 條件逐字鏡像掃描 view(行號在檔頭), **只把人工退款那一條翻過來**。
    'pending_manual_send_count',
      (SELECT pg_catalog.count(*)
         FROM public.orders o
        WHERE o.payment_method = 'tappay'
          AND o.payment_status = 'refunded'
          AND o.cancelled_at IS NOT NULL
          AND EXISTS (
                SELECT 1 FROM public.order_manual_refunds m
                 WHERE m.order_id = o.id
                   AND m.voided_at IS NULL)
          AND NOT EXISTS (
                SELECT 1 FROM public.email_outbox e
                 WHERE e.order_id = o.id
                   AND e.event_type = 'order_cancelled')),

    -- 🔵 **等了多久。** 一個不會因為「寄好了」而下降的數字, 沒有這一格就答不出「這是今天的新單,
    --    還是三個星期沒有人管」—— 而那兩件事在告警信上要讀成不同的緊急程度。
    'oldest_pending_cancelled_at',
      (SELECT pg_catalog.min(o.cancelled_at)
         FROM public.orders o
        WHERE o.payment_method = 'tappay'
          AND o.payment_status = 'refunded'
          AND o.cancelled_at IS NOT NULL
          AND EXISTS (
                SELECT 1 FROM public.order_manual_refunds m
                 WHERE m.order_id = o.id
                   AND m.voided_at IS NULL)
          AND NOT EXISTS (
                SELECT 1 FROM public.email_outbox e
                 WHERE e.order_id = o.id
                   AND e.event_type = 'order_cancelled')),

    -- 🔵 分母。**一個計數沒有分母, 讀的人會自己補一個**(而他補的那個多半是全部)。
    -- 🔴 **它數的是【全部】已取消且已退款的刷卡單 —— 含混合軌那些, 不是「純卡軌有幾張」**
    --    (2026-09-06 codex R1 nit 訂正我原本寫錯的那句)。
    --    ⇒ 讀法:`pending / total` = **這批單裡有多少比例需要人工去寄**。
    'cancelled_refunded_total_count',
      (SELECT pg_catalog.count(*)
         FROM public.orders o
        WHERE o.payment_method = 'tappay'
          AND o.payment_status = 'refunded'
          AND o.cancelled_at IS NOT NULL)
  )
  INTO v_result;
  RETURN v_result;
END
$fn$;

ALTER FUNCTION public.get_cancelled_mixed_rail_gap_counts() OWNER TO postgres;

COMMENT ON FUNCTION public.get_cancelled_mixed_rail_gap_counts() IS
$c$回 jsonb{pending_manual_send_count, oldest_pending_cancelled_at, cancelled_refunded_total_count}。
🔴 告警的主詞是 pending_manual_send_count:刷卡取消單、錢已退、走過混合軌(有未作廢的人工退款)
   ⇒ 系統刻意不寄取消信(20260905310000:193-196 那道排除閘), 而那位客人仍然需要一封信。
🛑 述詞逐字鏡像 public.pcm_cancelled_email_pending 的 :178/:179/:180 與 outbox anti-join,
   只把 order_manual_refunds 那一條 NOT EXISTS 翻成 EXISTS。
   ⛔ ~~兩者互補~~ 🔴 codex R2 must-fix:是【互斥】(不會重複數同一張), 而**聯集不等於全部** ——
   純卡全退、兩個信箱都空、無 outbox 的取消單, view 因信箱條件排除、本支因缺人工退款排除
   ⇒ 兩邊都不管。那個缺口屬 ⟦b4-NORECIPIENTWINDOW⟧ 族, 不在本支。
🔵 而 view 的「至少一個信箱非空」與「手動建單留白」兩條【刻意不帶】:那支 view 是自動寄信的
   掃描面(fail-closed 才對), 本支是看門狗 ⇒ **只在那兩條上** fail-open —— 沒有信箱的單, 人還是要知道。
   ⛔ ~~本支是看門狗(要 fail-open)~~ 🔴 codex R2 must-fix:那句沒有射程會被讀成整體 fail-open。
   保留的三條(:178/:179/:180)每一條都是 fail-closed 而本支一起繼承了 ⇒ 例如
   payment_method IS NULL 的舊混合單, 本支與 view **都**漏掉。⇒ 本支是【部分】fail-open。
🔴🔴 今天沒有任何路徑可以記下「我人工寄過了」(2026-09-06 量:全 repo
   人工寄/manually_sent/manual_send 命中 2, 兩筆都是註解;正對照 email_outbox 71 檔)
   ⛔ ~~⇒ 第一張這種單出現後這個數字永遠 >0~~ 🔴 codex R1+R2 各打掉一次, 收窄到這裡:
   **這個數字不會因為「人工寄好了」而下降** —— 而它會因為別的事下降, 那些下降都是對的:
   ① 人工退款全部作廢 ⇒ 不再是混合軌 ② 作廢其中一筆讓已退金額 < 總額 ⇒ 20260905440000 把
   payment_status 降成 partiallyRefunded ⇒ :179 不成立。**兩種都不是「有人去寄了」。**
   若日後決定「人工寄完補一列 outbox」(Sean 2026-09-06 拍甲), 本支不用改一個字就會自己歸零
   —— 述詞裡的 anti-join 在兩種答案下都成立。
🛑 它答的是【現況】不是【歷史】, 也答不出「那封人工的信實際上寄出去了沒」。$c$;

REVOKE ALL ON FUNCTION public.get_cancelled_mixed_rail_gap_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cancelled_mixed_rail_gap_counts()
  FROM anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_cancelled_mixed_rail_gap_counts() TO payment_confirmer;

-- ── 收權斷言 + 形狀斷言(逐字鏡像 20260904280000)────────────────
DO $assert$
DECLARE
  v_functions text[] := ARRAY['public.get_cancelled_mixed_rail_gap_counts()']::text[];
  r           text;
  v_oid       oid;
  v_acl       text;
  v_extra     text;
  v_shape     jsonb;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    SELECT p.oid, pg_catalog.array_to_string(p.proacl, ',')
      INTO v_oid, v_acl
      FROM pg_catalog.pg_proc p
     WHERE p.oid = pg_catalog.to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '混合軌取消信提醒 收權斷言失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;
    IF v_acl IS NULL THEN
      RAISE EXCEPTION '混合軌取消信提醒 收權斷言失敗:% 的 proacl 是 NULL(= 套用預設 ⇒ PUBLIC 可執行)⇒ 拒繼續', r;
    END IF;
    SELECT pg_catalog.string_agg(g.grantee, ', ')
      INTO v_extra
      FROM (
        SELECT pg_catalog.pg_get_userbyid((aclexplode(p.proacl)).grantee) AS grantee
          FROM pg_catalog.pg_proc p
         WHERE p.oid = v_oid
      ) g
     WHERE g.grantee NOT IN ('payment_confirmer', CURRENT_USER);
    IF v_extra IS NOT NULL THEN
      RAISE EXCEPTION '混合軌取消信提醒 收權斷言失敗:% 的 EXECUTE 清單多出非預期角色(%)—— 只應有 payment_confirmer;拒繼續', r, v_extra;
    END IF;
    IF v_acl NOT LIKE '%payment_confirmer=%' THEN
      RAISE EXCEPTION '混合軌取消信提醒 收權斷言失敗:% 對 payment_confirmer 沒有 EXECUTE(收到 %)⇒ 告警讀不到', r, v_acl;
    END IF;
  END LOOP;

  -- 🔴 形狀斷言:三個鍵一個都不能少 —— 少一個, TS 那側讀到 undefined
  --    ⇒ `?? null` 之後**告警恆不叫**, 而那正是這一支要防的東西。
  v_shape := public.get_cancelled_mixed_rail_gap_counts();
  -- 🔴 **先驗它是不是 object**(2026-09-06 codex R1 nit):`?` 運算子對 jsonb **陣列**是
  --    「元素裡有沒有這個字串」⇒ 回傳被突變成 `["pending_manual_send_count", …]` 這種字串陣列時,
  --    下面三個 `?` **全部成立而斷言照樣過**。⇒ 📌 一道只問「鍵在不在」的閘, 對「它還是不是物件」失明。
  IF v_shape IS NULL
     OR pg_catalog.jsonb_typeof(v_shape) <> 'object'
     OR NOT (v_shape ? 'pending_manual_send_count')
     OR NOT (v_shape ? 'oldest_pending_cancelled_at')
     OR NOT (v_shape ? 'cancelled_refunded_total_count') THEN
    RAISE EXCEPTION '混合軌取消信提醒 形狀斷言失敗:回傳缺鍵(收到 %)⇒ 告警那側會讀到 undefined 而恆不叫', v_shape;
  END IF;
END
$assert$;

COMMIT;
