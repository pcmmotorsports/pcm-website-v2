-- 20260905310000_m4b_cancelled_email_pending_view.sql
-- ⟦b4-CANCELEMAIL⟧ 取消信(`order_cancelled`)的掃描面。
--
-- ══ 🔴 為什麼要有這一支 ══════════════════════════════════════════════════
-- Sean 2026-09-02 拍【甲 = 要寄】。而 opus R3 F7 量到:模板在(`20260903040000`)、
-- `sweep-email-outbox.ts` 的 `case 'order_cancelled'` 在、`IEmailOutbox` 的 union 也有它 ——
-- 🛑 **缺的是「找出誰該寄」那一半**:全 repo 只有四支 `*_email_pending`,而**沒有這一支**
--    (`pcm_order_created` / `pcm_shipped` / `pcm_tracking_corrected` / `pcm_unpaid_cancelled`)。
-- ⇒ 📌 **模板齊、出口齊, 而沒有任何一列進得了佇列。**
--
-- ══ 🔴🔴 射程 —— 比它窄一格都會漏, 寬一格就寄給不該收的人 ═══════════════
-- Sean 2026-09-02 拍板逐字(`20260903040000:96-98` 記著):
--   `order_cancelled` = **刷卡且已全額退款的整單取消**
-- ⇒ 逐條落成述詞:
--   刷卡        `payment_method = 'tappay'`       —— ⚠️ **不涵蓋匯款 / 現金**
--               🔴 是 `payment_method`(實際怎麼收的)**不是** `payment_channel`(打算怎麼收);理由見述詞那一段
--   已全額退款  `payment_status  = 'refunded'`    —— 🛑 **精確**, 不是「不等於 paid」
--                 ⇒ `'partiallyRefunded'` 是**另一個值**(`20260725130000` 加的第 5 值)
--                   ⇒ **部分退款不在射程內**, 而用否定式會把它掃進來
--   整單取消    `cancelled_at IS NOT NULL`
--   還沒寄過    `email_outbox` 沒有這張單的 `order_cancelled` 列
--
-- ══ 🔴 而它【刻意不看 `order_cancellations`】—— 這一格是線【身分】`-d8` 提醒的 ═══
-- `pcm_unpaid_cancelled_email_pending` 有一條 `EXISTS (SELECT 1 FROM order_cancellations …)`。
-- 🛑 **本支不抄它**, 因為 `admin_mark_order_cancelled`(`20260902140000`)**不寫那張表** ——
--    當場量:那支檔提到 `order_cancellations` **只在註解裡**(`:106` 逐字「不寫」),
--    **剝掉註解之後命中 0**;而它寫的是 `orders`(同檔 `UPDATE public.orders` × 1)。
-- ⇒ 📌 **抄了那一條 ⇒ 走 mark 那條路取消的單【零命中】, 而 `enqueued = 0` 與「沒有單要寄」印同一個數字。**
-- 🎯 ⇒ **掃 `orders` 本身, 不掃取消帳本** —— 這樣不論哪條路取消(mark RPC / admin_cancel_order /
--    未來新增的)都走**同一個出口**。(主視窗 2026-09-05 裁:呼叫端不接線, sweep 自己撈。)
--
-- ══ 🔴 手動建單留白那條規矩也要帶 ═══════════════════════════════════════
-- 四支 pending view 都有「手動 + 通知信箱留白 ⇒ 離開掃描面」那段(⟦f3-MAILFALLBACKVSRULING⟧)。
-- 🛑 **本支照帶** —— 少了它, 同一個客人在別四封信被排除、而在取消信被寄到
--    ⇒ 📌 **一條規矩在五個面裡有四個面成立, 那不是規矩是巧合。**
--
-- ══ ROLLBACK ═══════════════════════════════════════════════════════════
-- 本支建**兩個新物件**(都是裸 `CREATE`)⇒ 回退要**兩行, 而順序不能反**:
-- ```sql
-- DROP VIEW     IF EXISTS public.pcm_cancelled_email_pending;
-- DROP FUNCTION IF EXISTS public.pcm_order_card_refunded(uuid);
-- ```
-- 🔴 view 先退 —— 它依賴那支函式, 反過來 PostgreSQL 會擋(2BP01), 而**那個擋是對的**。
-- 🔵 零資料改動、零既有物件改動 ⇒ 退掉之後回到「取消信沒有掃描面」= 今天。
-- 🛑 而**退它之前先確認沒有人在讀它**(adapter / cron)—— 否則那條路會 42P01。

BEGIN;

-- ── 前置閘 ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF pg_catalog.to_regclass('public.orders') IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 public.orders';
  END IF;
  IF pg_catalog.to_regclass('public.email_outbox') IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 public.email_outbox ⇒ 先貼建它的那一支';
  END IF;
  IF pg_catalog.to_regclass('public.order_refunds') IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 public.order_refunds ⇒ 退款金額那一欄算不出來';
  END IF;
  IF pg_catalog.to_regclass('public.order_manual_refunds') IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 public.order_manual_refunds ⇒ 混合退款那道排除閘關不起來';
  END IF;
  -- 🔴 更正判定那張 view —— 少了它, 「標成 failed 之後被人更正成【錢真的動了】」那一筆會少算
  --    ⇒ 信裡印的數字比客人實際拿到的少。
  IF pg_catalog.to_regclass('public.order_refund_effective_verdict') IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 public.order_refund_effective_verdict ⇒ 被更正的退款會少算';
  END IF;
  -- 🔴 函式也是新物件 ⇒ 撞名當場停(裸 CREATE FUNCTION 會自己報, 而這裡先報得更清楚)
  IF pg_catalog.to_regprocedure('public.pcm_order_card_refunded(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘:public.pcm_order_card_refunded(uuid) 已經存在 ⇒ 本支貼過了, 或有人建了同名的東西';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_js_trim_whitespace()') IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 public.pcm_js_trim_whitespace()';
  END IF;
  -- 🔴 新物件用裸 CREATE ⇒ 撞名要當場停, 不可靜默覆蓋別人的東西。
  IF pg_catalog.to_regclass('public.pcm_cancelled_email_pending') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘:public.pcm_cancelled_email_pending 已經存在 ⇒ 本支貼過了, 或有人建了同名的東西';
  END IF;
END $$;

-- ══ 🔴🔴 卡片已退金額 = 【單一算式的家】═══════════════════════════════════════
-- 這封信的那句話逐字是「**全額退回原付款方式**」⇒ 它宣稱的是**那張卡**。
-- ⇒ 📌 所以要答的問題是「**回到那張卡多少錢**」, 不是「這張單總共退了多少」。
--
-- ⛔ ~~第一版在 view 裡自己 SUM 兩張表(order_refunds confirmed + order_manual_refunds)~~
-- 🛑 **那一版有兩個具體的錯**(codex R1 ③④ + 守門 `refund-remaining-single-source` 同時抓到):
--   ① 總額 5000、卡退 4000、人工現金退 1000 ⇒ 和 = 5000 ⇒ 被判成 `full`
--      ⇒ 信說「全額退回原付款方式」+「退款金額 NT$5,000」, 而**那張卡只回了 4000**。
--   ② 一筆卡退款曾標 `failed` / `manual_failed`, 之後被人更正成 `money_moved`(錢真的動了)
--      ⇒ 只數 `status='confirmed'` 會**少算** ⇒ 印給客人的數字比他實際拿到的少。
--
-- ✅ 本函式 = 那條算式的**單一來源**;view 只呼叫它、body 裡一個 `sum(` 都沒有(自證②b 釘這件事)。
-- 🔬 ①② 兩段**逐字取自** `public.pcm_order_refundable_remaining` 的現行定義
--    (`20260820100000:224-262` 的第①②段), 程式抽取非手抄。
--
-- ⚠️ **一處刻意偏離正牌, 寫在這裡而不是函式本體裡**(本體寫進 `prosrc` 會讓比對字面的斷言恆真):
--    正牌第①段是 `status IN ('processing', 'confirmed')`, 而**本函式只取 `confirmed`**。
--    🔴 理由:正牌答的是「**還能退多少**」⇒ 送出去還沒確認的那筆要先扣住, 不然會重複退。
--       本函式答的是「**已經回到卡上多少**」⇒ `processing` = 送出去了**還沒確認到帳**
--       ⇒ 把它算進「退款金額 NT$X」等於**替一筆還沒動的錢背書**。
--    ⇒ 📌 兩個問題的 fail-safe 方向相反, 所以它們不該是同一條算式 —— 而那也是本函式存在的理由。
-- 🛑 正牌的**第③段(`order_manual_refunds`)刻意不要** —— 那是別條軌的錢, 不會回到那張卡。
--
-- 🔵 **不是 `SECURITY DEFINER`** —— 呼叫它的 view 是 `security_invoker = true`,
--    兩者都用呼叫者的權限跑 ⇒ 權限面與「view 自己 SUM」那一版完全一樣, 沒有新開後門。
--    而每一個物件名都完整限定 ⇒ 配 `search_path = ''` 安全。
CREATE FUNCTION public.pcm_order_card_refunded(p_order_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT COALESCE(
           (SELECT pg_catalog.sum(r.refund_amount)
              FROM public.order_refunds r
             WHERE r.order_id = p_order_id
               AND r.status = 'confirmed'), 0)::bigint
       + COALESCE(
           (SELECT pg_catalog.sum(r.refund_amount)
              FROM public.order_refunds r
              JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
             WHERE r.order_id = p_order_id
               AND r.status = 'failed'
               AND r.failed_reason = 'manual_failed'
               AND v.corrected_to = 'money_moved'), 0)::bigint;
$fn$;

COMMENT ON FUNCTION public.pcm_order_card_refunded(uuid) IS
$c$**回到原本那張卡的錢**(取消信裡「退款金額」那一行的唯一來源)。
= `order_refunds` status='confirmed' 的和 + 標成 failed/manual_failed 而被更正成 money_moved 的和。
🛑 **不含 `order_manual_refunds`** —— 那是別條軌(現金/匯款)的錢, 不會回到卡上。
🛑 **不含 `status='processing'`** —— 送出去還沒確認到帳, 算它等於替沒動的錢背書。
🔴 與 `pcm_order_refundable_remaining`(還能退多少)**刻意不同**:兩者 fail-safe 方向相反。$c$;

-- 🔴 新物件出生就自帶 PUBLIC EXECUTE ⇒ 先收再給(`revoking-function-execute-in-supabase.md`)。
REVOKE ALL ON FUNCTION public.pcm_order_card_refunded(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_order_card_refunded(uuid) TO service_role;

CREATE VIEW public.pcm_cancelled_email_pending
  WITH (security_invoker = true) AS
SELECT
  o.id                 AS order_id,
  o.display_id         AS display_id,
  o.cancelled_at       AS cancelled_at,
  o.cancelled_reason   AS cancelled_reason,
  o.created_at         AS created_at,
  o.notification_email AS notification_email,
  c.email              AS customer_email,
  o.order_source       AS order_source,
  -- 🔴 退款金額 = **回到那張卡的錢**, 算式住在上面那支函式裡, 這裡只呼叫。
  --    ⛔ ~~原本這裡對齊狀態機的 `v_moved`(卡 + 人工)~~ ⇒ 主視窗 2026-09-05 **改裁甲**:
  --       信那句宣稱的是那張卡, 人工現金不算。理由全文在函式上面那段。
  r.card_refunded      AS refunded_amount,
  -- 🔴 `refund_kind` **算出來, 不寫死** —— 本 view 的射程已經是 `payment_status='refunded'`
  --    ⇒ 它「應該」恆為 'full';而**寫死等於讓兩把尺各說各的**。
  --    ⇒ ✅ 判準 = **卡上退滿了沒**(`card_refunded >= o.total`)⇒ 🛑 **卡上沒退滿就印 'partial',
  --       而模板對 'partial' 是【那句與那個數字都不印】** —— fail-closed, 不會說一句可能是謊的話。
  --    🔵 而 view 射程已是 `payment_status='refunded'` ⇒ 它「應該」恆為 'full';
  --       印出 'partial' 就是【狀態機說全額退了, 而卡上沒有】的訊號 —— 那正是要看見的東西。
  CASE WHEN r.card_refunded >= o.total THEN 'full' ELSE 'partial' END AS refund_kind
FROM public.orders o
LEFT JOIN public.customers c ON c.user_id = o.customer_user_id
-- 🔴 body 裡**一個 `sum(` 都沒有** —— 算式只有一份, 在那支函式裡(自證②b 釘這件事)。
CROSS JOIN LATERAL (SELECT public.pcm_order_card_refunded(o.id) AS card_refunded) r
-- 🔴🔴 **`payment_method` 不是 `payment_channel` —— 而這是 DB 自己的 COMMENT 講的。**
--   ⛔ ~~本支第一版寫 `payment_channel = 'tappay'`~~(codex R2 ④ 抓到, 開檔查證屬實)
--   🛑 `20260712203000:87` 的 `COMMENT ON COLUMN public.orders.payment_channel` **逐字**:
--      「管理/預期收款管道(建單時定、admin 可改);算實收金額用 payment_method+payment_status,
--       **勿用本欄**」
--   ⇒ 📌 `payment_channel` 是【打算怎麼收】, `payment_method` 是【實際怎麼收的】(付款成功時寫)。
--   ⇒ 而本 view 要答的是「**這筆錢會退回哪裡**」—— 那是事實軸, 不是預期軸。
--   🔴 具體失敗情境:建單時 channel 填 tappay、客人實際付現金 ⇒ 舊版會掃進來
--      ⇒ 信說「全額退回**原付款方式**」而那張卡從來沒被扣過。
--   ⚠️ **反向的代價明寫**:`payment_method` 可為 NULL(建表 `20260604120000:109` nullable)
--      ⇒ 欄沒寫到的舊單會**掉出掃描面 = 不寄信**。而那是 fail-closed 的方向,
--      與本片其餘每一格一致:**寧可不寄, 不寄一封說錯錢的信。**
WHERE o.payment_method = 'tappay'
  AND o.payment_status = 'refunded'
  AND o.cancelled_at IS NOT NULL
  -- ══ 🔴🔴 混合退款的單【整張不寄】(主視窗 2026-09-05 裁 Q2 乙;codex R2 ③)══════════
  --   失敗情境(量過, 探針格6f):總額 5000、卡退 4000、**現金退 1000**
  --   ⇒ 狀態機的 `v_moved`(卡 + 人工)= 5000 ⇒ 它把 `payment_status` 翻成 `'refunded'`
  --   ⇒ 這張單進得了掃描面, 而 `card_refunded` 只有 4000 ⇒ `kind = 'partial'`
  --   ⇒ 🛑 模板對 `'partial'` 是**那句與那個數字都不印**
  --     ⇒ 📌 **客人收到一封【完全沒提到退款】的取消信** —— 而他的錢確實退了。
  --   ⇒ ⇒ 而 outbox 的 anti-join ⇒ **日後卡上補退滿, 也不會再寄。**
  --   ✅ 裁示:這類單**整張不寄**, 等人工處理(板列寫著「這類單要人工寄」)。
  -- 🔵 判準用「有沒有未作廢的人工退款」, **不是**比金額 —— 比金額會把
  --    「人工退款 0 元」這種列當成沒有, 而它仍然代表**這張單走過別條軌**。
  -- ⚠️ 它與 `refund_kind` 是**兩道不同的閘**, 不是重複:
  --    這一條擋【混合軌】, `refund_kind` 擋【純卡而沒退滿】。兩者失敗情境不同, 都要留。
  AND NOT EXISTS (
        SELECT 1 FROM public.order_manual_refunds m
         WHERE m.order_id = o.id
           AND m.voided_at IS NULL)
  AND NOT EXISTS (
        SELECT 1 FROM public.email_outbox e
         WHERE e.order_id = o.id
           AND e.event_type = 'order_cancelled')
  AND (
        nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
     OR nullif(pg_catalog.btrim(c.email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      )
  AND (
        -- 🔴 `NULL NOT IN (…)` 回 NULL(不是 true)⇒ WHERE 當假 ⇒ 來源不明的單會被【排除】。
        --    而 TS 那半對 `null` 是【照舊寄】⇒ 兩層會給相反的答案 ⇒ 這一格對齊 TS 的 fail 方向。
        o.order_source IS NULL
     OR o.order_source NOT IN ('manual_phone', 'manual_line', 'manual_other')
     OR nullif(pg_catalog.btrim(o.notification_email, public.pcm_js_trim_whitespace()), '') IS NOT NULL
      );

COMMENT ON VIEW public.pcm_cancelled_email_pending IS
$c$取消信(`order_cancelled`)的掃描面 —— **刷卡且已全額退款的整單取消**(Sean 2026-09-02 拍甲)。
🔴 射程**精確**:`payment_method = 'tappay'` + `payment_status = 'refunded'`(不是「不等於 paid」)
🛑 是 `payment_method` **不是** `payment_channel` —— 後者的 COMMENT 逐字寫「算實收金額用 payment_method, 勿用本欄」。
⇒ **不涵蓋匯款/現金的單, 也不涵蓋 `partiallyRefunded`(部分退款)。**
🛑 它**刻意不看 `order_cancellations`** —— `admin_mark_order_cancelled` 不寫那張表
⇒ 看它的話, 走那條路取消的單零命中, 而「零」與「沒有單要寄」長得一樣。
🔵 手動建單留白那條規矩照帶(與另外四支 pending view 同形)。
🔴 `refunded_amount` = **回到那張卡的錢**, 唯一來源 `public.pcm_order_card_refunded(order_id)`
—— 本 view body 裡**一個 `sum(` 都沒有**(信那句宣稱的是那張卡;主視窗 2026-09-05 改裁甲)。
🛑 它**刻意不等於**「這張單總共退了多少」:人工/現金退款與 `processing` 都不算。理由在該函式的 COMMENT。
🔴 `refund_kind` **算出來不寫死**:`card_refunded >= total` 才是 'full';
卡上沒退滿 ⇒ 'partial' ⇒ 模板那句與那個數字**都不印**(fail-closed)。
🛑 **混合退款(卡 + 現金/匯款)的單【整張不寄】**(主視窗 2026-09-05 裁 Q2 乙)——
那類單要**人工寄**;述詞 = 有未作廢的 `order_manual_refunds` 就排除。
⚠️ **兩個已知缺口, 明寫不假裝沒有**:
① 一筆卡退款若**只因為被更正成 money_moved 才算數**, `payment_status` 不會被翻成 refunded
   ⇒ 這張單永遠進不了本掃描面 ⇒ **那位客人一封信都收不到**(主視窗裁 Q1 甲:本片不處理)。
   要修得動更正 RPC(`20260814190000`)那條線, 那是別片。
② **金額是【排信當下】的快照**:排進 outbox 之後、寄出之前若有人把更正改成「錢沒動」,
   信仍會印排信時那個數字(主視窗裁 Q3 甲:接受)。🔵 窗口 = 一輪 cron(5 分鐘)到下一次寄送,
   而更正是**人工動作** ⇒ 兩者同時發生的機率極低。要關它得在寄出前重讀真值, 那是 sweep 那一半。$c$;

REVOKE ALL ON public.pcm_cancelled_email_pending FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pcm_cancelled_email_pending TO service_role;

-- ── 貼上去當場自證 ──────────────────────────────────────────────
DO $$
DECLARE
  -- 🔴🔴 **收權斷言清單 —— 本檔建的【每一個可授權物件】都要列進來。**
  --   (`scripts/migration-new-file-static-checks.sh` ③ 當場擋下我:我原本只有下面那幾道
  --    `has_*_privilege`, 而**那是黑名單** —— 它只問我想得到的那幾個角色。)
  --   ⇒ 📌 收權斷言**只檢查你列出來的物件**:它防「忘記收權」, 不防「忘記列」。
  v_relations text[] := ARRAY[
    'public.pcm_cancelled_email_pending',
    'public.pcm_order_card_refunded(uuid)'
  ]::text[];
  v_leak text[];
  v_n integer;
BEGIN
  -- ① 它在, 而且是 invoker view
  IF pg_catalog.to_regclass('public.pcm_cancelled_email_pending') IS NULL THEN
    RAISE EXCEPTION '自證①:view 不存在';
  END IF;
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'pcm_cancelled_email_pending'
     AND c.reloptions @> ARRAY['security_invoker=true'];
  IF v_n <> 1 THEN
    RAISE EXCEPTION '自證①:不是 security_invoker = true';
  END IF;

  -- ② 🔴 射程那四條【逐條】都在定義裡 —— 少一條就是射程變寬或變窄
  -- 🔴🔴 **釘【整條述詞】不是那個字** —— ⛔ ~~原本比 `%refunded%`~~:
  --    我後來加了 `refunded_amount` 那一欄 ⇒ 🛑 **那個字在定義裡本來就有** ⇒ 這一格變成恆真。
  --    🔬 實測:把述詞換成 `<> 'paid'` 之後它**照樣通過**, 而探針那一格因此翻紅才抓到。
  --    📌 **一把找【單字】的尺, 在同一個字有第二個用途之後就失效了 —— 而它不會出聲。**
  IF pg_catalog.pg_get_viewdef('public.pcm_cancelled_email_pending'::regclass, true)
       NOT LIKE '%payment_status = ''refunded''%' THEN
    RAISE EXCEPTION '自證②:定義裡沒有【payment_status = refunded】那條述詞 ⇒ 射程不對';
  END IF;
  -- 🔴 釘【整條述詞】不是那個字 —— 而這一格 codex R2 ④ 之後又多守一件事:
  --    它同時證明用的是 `payment_method`(事實軸)而不是 `payment_channel`(預期軸)。
  IF pg_catalog.pg_get_viewdef('public.pcm_cancelled_email_pending'::regclass, true)
       NOT LIKE '%payment_method = ''tappay''%' THEN
    RAISE EXCEPTION '自證②:定義裡沒有【payment_method = tappay】⇒ 匯款/現金的單會被掃進來, 或用錯了欄';
  END IF;
  -- 🔴 反向:`payment_channel` **不得**出現 —— 它是預期軸, DB COMMENT 逐字寫「算錢勿用本欄」。
  IF pg_catalog.pg_get_viewdef('public.pcm_cancelled_email_pending'::regclass, true)
       LIKE '%payment_channel%' THEN
    RAISE EXCEPTION '自證②:定義裡有 payment_channel ⇒ 那是【打算怎麼收】不是【實際怎麼收】';
  END IF;
  -- 🔵 負對照:同一把尺餵一個一定不在的字面 ⇒ 上面兩格才不是恆真
  IF pg_catalog.pg_get_viewdef('public.pcm_cancelled_email_pending'::regclass, true)
       LIKE '%zzz_never_a_channel%' THEN
    RAISE EXCEPTION '負對照紅了:這把尺對任何字面都印命中 ⇒ ② 不算數';
  END IF;

  -- ②b 🔴🔴 金額只准有【一個來源】:呼叫那支函式, 而 view body 裡零 `sum(`。
  --    ⛔ ~~原本這一格釘「order_refunds 與 order_manual_refunds 兩張表都要在定義裡」~~
  --    🛑 那一版釘的是**自己算**的那個形狀 —— 而自己算正是 codex R1 ③④ 與守門
  --      `refund-remaining-single-source` 同時抓到的病。**兩個相反的東西不能用同一格釘。**
  IF pg_catalog.pg_get_viewdef('public.pcm_cancelled_email_pending'::regclass, true)
       NOT LIKE '%pcm_order_card_refunded%' THEN
    RAISE EXCEPTION '自證②b:定義裡沒有呼叫 public.pcm_order_card_refunded ⇒ 金額不知道從哪來的';
  END IF;
  -- 🔴 反向:body 裡出現 `sum(` = 有人又在這裡自己算一次 ⇒ 兩份會各自漂。
  IF pg_catalog.pg_get_viewdef('public.pcm_cancelled_email_pending'::regclass, true)
       LIKE '%sum(%' THEN
    RAISE EXCEPTION '自證②b:view body 裡有 sum( ⇒ 金額被重算了一次, 而算式只准有一份';
  END IF;
  -- 🔵 函式本身要在, 而且**回得出數字**(空單 = 0, 不是 NULL —— NULL 會讓 refund_kind 變 partial 而理由不明)
  IF pg_catalog.to_regprocedure('public.pcm_order_card_refunded(uuid)') IS NULL THEN
    RAISE EXCEPTION '自證②b:public.pcm_order_card_refunded(uuid) 不存在';
  END IF;
  IF public.pcm_order_card_refunded('00000000-0000-0000-0000-000000000000'::uuid) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '自證②b:函式對一張不存在的單沒有回 0 ⇒ COALESCE 那兩層有破口';
  END IF;

  -- ②c 🔴 混合退款排除閘要在(主視窗裁 Q2 乙)—— 少了它會寄出【沒提到退款】的取消信
  IF pg_catalog.pg_get_viewdef('public.pcm_cancelled_email_pending'::regclass, true)
       NOT LIKE '%order_manual_refunds%' THEN
    RAISE EXCEPTION '自證②c:定義裡沒有 order_manual_refunds ⇒ 混合退款的單會被寄一封沒提到退款的信';
  END IF;

  -- ③ 🔴 它【不得】看 order_cancellations(看了就掃不到 mark 那條路的單)
  IF pg_catalog.pg_get_viewdef('public.pcm_cancelled_email_pending'::regclass, true)
       LIKE '%order_cancellations%' THEN
    RAISE EXCEPTION '自證③:定義裡有 order_cancellations ⇒ 走 admin_mark_order_cancelled 取消的單會零命中';
  END IF;

  -- ④ ACL:含兩個 email 欄 ⇒ anon / authenticated 一格都不得可讀
  IF pg_catalog.has_any_column_privilege('anon', 'public.pcm_cancelled_email_pending', 'SELECT')
     OR pg_catalog.has_any_column_privilege('authenticated', 'public.pcm_cancelled_email_pending', 'SELECT') THEN
    RAISE EXCEPTION '自證④:對 anon/authenticated 開著, 而它含兩個 email 欄';
  END IF;
  IF NOT pg_catalog.has_any_column_privilege('service_role', 'public.pcm_cancelled_email_pending', 'SELECT') THEN
    RAISE EXCEPTION '自證④:service_role 讀不到 ⇒ 建了等於沒建';
  END IF;

  -- ④b 🔴🔴 **白名單:把 ACL 整個攤開, 只准【擁有者 + service_role】出現。**
  --    ⛔ ~~上面 ④ 那兩格只問 `anon` 與 `authenticated`~~ —— **那是黑名單**,
  --      它跟下一個沒想到的角色賽跑(`20260905220000:248` 為同一件事留過同一句話)。
  --    🔴 **`relacl IS NULL` 要單獨守**:`aclexplode(NULL)` 回**零列** ⇒ `array_agg` 得 NULL
  --      ⇒ 下面那道斷言**靜靜通過**。而 `relacl IS NULL` 的意思是【預設 ACL】,
  --      那正是「REVOKE / GRANT 兩行都沒生效」的樣子。
  IF (SELECT c.relacl IS NULL FROM pg_catalog.pg_class c
       WHERE c.oid = 'public.pcm_cancelled_email_pending'::regclass) THEN
    RAISE EXCEPTION '自證④b0:view 的 relacl 是 NULL ⇒ 那是【預設授權】, REVOKE/GRANT 沒生效';
  END IF;
  SELECT pg_catalog.array_agg(DISTINCT COALESCE(pg_catalog.pg_get_userbyid(a.grantee), 'PUBLIC'))
    INTO v_leak
    FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
   WHERE c.oid = 'public.pcm_cancelled_email_pending'::regclass
     AND COALESCE(pg_catalog.pg_get_userbyid(a.grantee), 'PUBLIC')
         NOT IN (pg_catalog.pg_get_userbyid(c.relowner), 'service_role');
  IF v_leak IS NOT NULL AND array_length(v_leak, 1) > 0 THEN
    RAISE EXCEPTION '自證④b:view 的 ACL 上有【擁有者與 service_role 以外】的人 ⇒ %', array_to_string(v_leak, ', ');
  END IF;
  -- 🔵 函式同樣走白名單。⚠️ `proacl` 為 NULL = 【預設】= PUBLIC 可執行 ⇒ 那要紅。
  IF (SELECT p.proacl IS NULL FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.pcm_order_card_refunded(uuid)'::regprocedure) THEN
    RAISE EXCEPTION '自證④b2:函式 proacl 是 NULL ⇒ 預設 PUBLIC 可執行, REVOKE/GRANT 沒生效';
  END IF;
  SELECT pg_catalog.array_agg(DISTINCT COALESCE(pg_catalog.pg_get_userbyid(a.grantee), 'PUBLIC'))
    INTO v_leak
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
   WHERE p.oid = 'public.pcm_order_card_refunded(uuid)'::regprocedure
     AND COALESCE(pg_catalog.pg_get_userbyid(a.grantee), 'PUBLIC')
         NOT IN (pg_catalog.pg_get_userbyid(p.proowner), 'service_role');
  IF v_leak IS NOT NULL AND array_length(v_leak, 1) > 0 THEN
    RAISE EXCEPTION '自證④b3:函式的 ACL 上有【擁有者與 service_role 以外】的人 ⇒ %', array_to_string(v_leak, ', ');
  END IF;
  -- 🔵 而那張清單要真的被讀到 —— 否則它只是一段給守門看的裝飾。
  FOREACH v_n IN ARRAY ARRAY[1, 2] LOOP
    IF v_relations[v_n] IS NULL THEN
      RAISE EXCEPTION '自證④b4:收權斷言清單少了第 % 項', v_n;
    END IF;
  END LOOP;

  -- ⑤ 🔴 invoker view ⇒ body 裡的函式用【呼叫者】的權限跑 ⇒ 要事後斷言不是 GRANT
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.pcm_js_trim_whitespace()', 'EXECUTE') THEN
    RAISE EXCEPTION '自證⑤:service_role 叫不動 public.pcm_js_trim_whitespace() ⇒ 這支 invoker view 會查一次錯一次';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.pcm_js_trim_whitespace()', 'EXECUTE') THEN
    RAISE EXCEPTION '自證⑤:anon 叫得動 public.pcm_js_trim_whitespace()';
  END IF;
  -- 🔴 同一件事對新那支函式再問一次 —— invoker view ⇒ 它也用呼叫者的權限跑。
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.pcm_order_card_refunded(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '自證⑤:service_role 叫不動 public.pcm_order_card_refunded(uuid) ⇒ 這支 view 會查一次錯一次';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.pcm_order_card_refunded(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '自證⑤:anon 叫得動 public.pcm_order_card_refunded(uuid)';
  END IF;
END $$;

COMMIT;
