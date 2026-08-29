-- M-4b E10 · 取消原因兩格遮罩改中性句(Sean 2026-08-30 04:2x 拍「2 乙」+ 逐字「寫很官方就好」)
--
-- 拍板出處(逐字,抄他選的那個選項的字面、不重擬):
--   ~/pcm-mailbox/R3-題-甲後三題選項-20260829.md:36
--   乙=遮罩改中性句「訂單已取消,詳情請洽客服」(不說是你要求的 — 不對客人說不實的話)
--
-- 改什麼:七值映射表裡兩格【我方原因卻寫成客人要求】的遮罩
--   price_change   (我們調整價格)  '依您要求取消' ⇒ '訂單已取消,詳情請洽客服'
--   internal_error (我們系統出錯)  '依您要求取消' ⇒ '訂單已取消,詳情請洽客服'
-- 不動:customer_request(說「依您要求」是對的)、out_of_stock、long_leadtime、
--       duplicate_order(三句都已說出真實原因)、other(寫員工手打原文)。
--       ⇒ 這五句我【看過而不動】,不是沒看。他只拍了那兩格,動別的就是替他決定。
--
-- 🔴 為什麼函式本體整段都在:PostgreSQL 沒有「只改函式裡一行」的語法,
--    forward-only 只能 CREATE OR REPLACE 一份完整定義。
--    本檔函式本體【是程式從 20260820030000(A8a3)抽出來的】,四處替換在產生時
--    各自 assert「恰命中 1 次」,命中 0 或 >1 即中止 ⇒ **沒有手抄面**。
--    產生器 /tmp/gen_cancel_neutral.py(形狀同 A8a3 自己 :250-252 註解寫的做法)。
--
-- 🔴 來源必須是 A8a3,不是 A8a1 —— 這一格差點錯:
--    admin_cancel_order 被重新定義過三代 A8a1(20260804180000)→ A8a2(20260805100000,
--    5 參數 DROP 掉換 6 參數)→ A8a3(20260820030000,已 apply,APPLIED.tsv:275)。
--    a8a1 函式本體 182 行 / a8a3 445 行 / diff 377 行 ⇒ 從 a8a1 抄一份出來 REPLACE,
--    會把 A8a2 的部分取消與 A8a3 的非卡片閘【整個回捲】,而三綠不會紅、diff 上長得像一支正常的新 migration。
--    ⚠️ 而 `git grep 'CREATE OR REPLACE FUNCTION public.admin_cancel_order'` 只回 2 支 ——
--       它看不到 A8a2(那支是 DROP + CREATE,不含 OR REPLACE),而 A8a2 正是唯一改過簽章的那一代。
--       ⇒ 要數代數請用 `git grep -ln 'FUNCTION public.admin_cancel_order' -- supabase/migrations`(⇒ 3 支)。
--
-- 🔴 那張 CASE 表在函式裡有【兩份】,本檔兩份同時改(四處替換):
--    ①寫入端     步2 輸入驗   `v_reason_txt := CASE p_reason_code`
--    ②冪等回放端 步4 冪等格   `IF v_order.cancelled_reason IS DISTINCT FROM (SELECT CASE c.reason_code`
--    ⇒ 只改①的話,冪等重入時「重算的字」與「庫裡的字」對不上 ⇒ 走 RAISE。
--       那不是「少改一半文案」,是製造一個會爆的不一致。
--
-- 🛑🛑 本檔【已知殘餘風險,未解,不自宣接受】—— 舊單的冪等重入
--    ②那份是把 orders.cancelled_reason 拿去跟【重算的映射】比。
--    本檔 apply 之後,以 price_change / internal_error 取消於【apply 之前】的單,
--    庫裡存的仍是舊字面「依您要求取消」,而重算出來是新字面 ⇒ IS DISTINCT FROM 成立 ⇒ RAISE。
--    觸發條件很窄:必須有人拿【同一把 idempotency_key】對【同一張舊單】重放一次。
--    而爆出來的是通用訊息「admin_cancel_order: 取消失敗」⇒ 查起來會很難。
--    ⇒ 這一格由【要不要回頭改既有那幾張單的 cancelled_reason】那個決定一併解決,
--       而那是改歷史對客資料 ⇒ 是 Sean 的板,不是本片能拍的。
--    ✅ **題目已寫進等待表**:`~/pcm-mailbox/等Sean決策-20260829.md`,錨 `Q-舊取消單改字`
--       (2026-08-30 02:4x 由線D 寫入;在那之前本行寫的是「已列進待決」而**那是假的** ——
--        R3 對抗審查 grep 該表零命中抓到。📌 「已列進待決」這種句子的作用不是記錄,
--        是**關掉下一個人的尋找動作** ⇒ 寫它之前必須先真的寫進去。)
--    ⇒ 📌 在他答之前,本檔【不做任何 backfill】、也不加「容忍舊字面」的旁路 ——
--       加旁路等於我替他決定「舊單就讓它繼續說謊」,而那條旁路日後沒有人會回來拆。
--
-- 射程(本檔證不到什麼):
--   ❌ 沒證:正式庫今天有幾張單是用那兩個 code 取消的(需 DB access;那個數字決定上面那格多嚴重)
--   ❌ 沒證:改完客人會看到不一樣的字 —— 今天【看不到】。沒有取消通知信
--      (packages/ports/src/IEmailOutbox.ts:30 值域只有 order_created | order_shipped),
--      顧客站刻意不渲染 cancelledReason(OrderDetailView.tsx:246,codex must-fix 2026-08-24,型別閘)。
--      ⇒ 今天只有後台員工看得到(order-detail-header.tsx:264-265)。
--      ⇒ 而它仍然要做:OrderDetailView.tsx:255 逐字寫著「要接回來的正確做法是從七值枚舉欄
--         映一張固定文案表,而那張表的字要 Sean 定」⇒ 這一板就是那一片在等的輸入。
--   ⚠️ 鐵則 12⑤(對外不可回收/寄信)【今天不成立】,因為今天沒有那封信。
--      ⇒ 把這張表接到客人端的那一片會命中它,那一片要另外過 12⑤。兩片的審查不要混成一個。
--
-- 前一份 plan:~/pcm-mailbox/線C-plan-取消理由改中性句-20260830.md(線C 寫,§③ 三句草稿已作廢)

BEGIN;

-- ── 0. 前置閘(forward-only;狀態不符就停,不硬套)────────────────────────
-- 🔴 codex 關卡2 R1 must-fix(1/7):**只釘「同名恰一 + 六參簽章」是不夠的**。
--    A8a2、已套過本片、或未來某支仍是六參但本體已經變了的世界,全部都會通過這道閘,
--    然後被本檔那份【從 A8a3 抽出來的】本體無聲覆寫回去。
--    ⇒ 所以下面第三格改成釘【內容】:現行定義裡那兩句舊字面必須各出現恰 2 次
--      (兩份 CASE 各一)。那正是本檔要換掉的東西 —— 換不到就代表我對錯了版本。
DO $$
DECLARE
  n int;
  src text;
  cnt_price int;
  cnt_internal int;
BEGIN
  SELECT count(*) INTO n FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'admin_cancel_order';
  IF n <> 1 THEN
    RAISE EXCEPTION '前置閘①:admin_cancel_order overload 數=%(預期恰 1);停下人工對齊', n;
  END IF;
  IF to_regprocedure('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION '前置閘②:admin_cancel_order 非 6 參數版(A8a2 之後的簽章)⇒ 部署態與預期不符,停下';
  END IF;

  src := pg_get_functiondef('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure);
  cnt_price := (length(src) - length(replace(src, 'WHEN ''price_change''     THEN ''依您要求取消''', '')))
               / length('WHEN ''price_change''     THEN ''依您要求取消''');
  cnt_internal := (length(src) - length(replace(src, 'WHEN ''internal_error''   THEN ''依您要求取消''', '')))
               / length('WHEN ''internal_error''   THEN ''依您要求取消''');
  IF cnt_price <> 2 OR cnt_internal <> 2 THEN
    -- 🔴 R3(Fable)換角度抓到的災難日劇本:套用成功之後【再貼一次】(SQL Editor 最常見的手誤)
    --    ⇒ 第一個炸的是這一格,兩數都是 0,而原訊息會說「你的版本不對」= **診斷錯誤**;
    --    而收訊者(Sean)正是唯一無法自己核的人。真正會說「拒重跑」的 COMMENT 閘在下面,到不了。
    --    ⇒ 訊息裡直接寫出「兩數皆 0 ⇒ 很可能是已經套過了」與他可以自己查的那一格。
    RAISE EXCEPTION '前置閘③:現行定義裡舊字面 price_change=% / internal_error=%(兩者都預期 2 = 兩份 CASE 各一)。若兩數【都是 0】⇒ 很可能本片已經套過了(不是版本不對):查函式 COMMENT 裡有沒有 20260830020000,有就代表已套、不用再貼。若不是 0 也不是 2 ⇒ 我手上這份本體不是從你這個版本抽的,停下人工對齊', cnt_price, cnt_internal;
  END IF;
  -- 🔴 codex R2 must-fix(1/4):③那一格【分不出 A8a2 與 A8a3】——
  --    A8a2 同樣是六參、同樣兩句舊映射各 2 次、負對照同樣 0 ⇒ 前置閘全過,
  --    然後被本檔那份 A8a3 本體無聲【升版】。而升版不是本片該做的事。
  --    ⇒ 加一格釘 A8a3 獨有的內容:非卡片閘的 `op.rail = 'card'`
  --      (實量:a8a1 = 0 / a8a2 = 0 / a8a3 = 2 / 本檔產物 = 2)。
  IF (length(src) - length(replace(src, 'op.rail = ''card''', ''))) / length('op.rail = ''card''') <> 2 THEN
    RAISE EXCEPTION '前置閘④:現行定義裡找不到 A8a3 的非卡片閘(op.rail = ''card'' 預期 2 次)⇒ 你這個庫上的版本不是 A8a3,套本檔會把它【升版】而不是只改文案。停下人工對齊';
  END IF;
  -- 正對照:這把尺不是恆回 2 —— 一個現造字面必須數到 0
  IF (length(src) - length(replace(src, 'zzq6641', ''))) / length('zzq6641') <> 0 THEN
    RAISE EXCEPTION '前置閘自檢:負對照字面竟然命中 ⇒ 上面幾個數字不可信';
  END IF;
END
$$;

-- ── 1. 換函式(CREATE OR REPLACE;簽名相同 ⇒ 不產生第二 overload、ACL 與 COMMENT 保留)──
CREATE OR REPLACE FUNCTION public.admin_cancel_order(
  p_order_id        uuid,
  p_idempotency_key uuid,
  p_actor           text,
  p_reason_code     text,
  p_reason_detail   text,
  p_items           jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_order       record;
  v_existing    record;
  v_audit       record;
  v_detail      text;
  v_hash        text;
  v_reason_txt  text;
  v_canon       text;
  v_cid         uuid;
  v_bad         bigint;
  v_cnt         integer;
  v_expect      integer;
  v_partial     boolean;
  v_closed      boolean;
  v_generic_msg constant text := 'admin_cancel_order: 取消失敗';
BEGIN
  -- 步1 隔離閘(A8c 家族同款;RR 等鎖醒來舊快照會漏看真相表)
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_cancel_order: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  -- 步2 輸入驗(輸入類=具體訊息;§5.1d 七值映射=可測合約)
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'admin_cancel_order: 冪等鍵缺失';
  END IF;
  v_reason_txt := CASE p_reason_code
    WHEN 'customer_request' THEN '依您要求取消'
    WHEN 'out_of_stock'     THEN '商品供貨中斷,已為您取消'
    WHEN 'long_leadtime'    THEN '交期無法配合,已為您取消'
    WHEN 'price_change'     THEN '訂單已取消,詳情請洽客服'
    WHEN 'duplicate_order'  THEN '重複訂單,已為您取消'
    WHEN 'internal_error'   THEN '訂單已取消,詳情請洽客服'
    WHEN 'other'            THEN NULL
    ELSE NULL END;
  IF v_reason_txt IS NULL AND p_reason_code IS DISTINCT FROM 'other' THEN
    RAISE EXCEPTION 'admin_cancel_order: 未知取消原因碼';
  END IF;
  v_detail := pg_catalog.btrim(p_reason_detail);
  IF v_detail = '' THEN v_detail := NULL; END IF;
  IF p_reason_code = 'other' THEN
    -- 判空白=A7 CHECK 同款明列碼位(僅判定;入庫/hash/對客=btrim 原文,不剝內部字元)
    IF v_detail IS NULL OR pg_catalog.translate(v_detail,
         U&'\0009\000A\000B\000C\000D\0020\0085\00A0\00AD\1680\180E\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\200B\200C\200D\2028\2029\202F\205F\2060\2800\3000\3164\FEFF',
         '') = '' THEN
      RAISE EXCEPTION 'admin_cancel_order: other 需填取消說明';
    END IF;
    v_reason_txt := v_detail;
  ELSIF v_detail IS NOT NULL THEN
    RAISE EXCEPTION 'admin_cancel_order: 非 other 不得填說明';
  END IF;
  -- Δ p_items 具名矩陣驗(v2b;jsonb 同 object 重複 key=last-key-wins、收到前已丟失=誠實邊界)
  v_partial := p_items IS NOT NULL;
  IF v_partial THEN
    IF pg_catalog.jsonb_typeof(p_items) IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項清單需為非空陣列';
    END IF;
    -- 先判 typeof 再數鍵(兩段式;SQL OR 不保證短路,scalar 元素碰 jsonb_object_keys 會 22023 訊息失控)
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE pg_catalog.jsonb_typeof(el) <> 'object') THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項元素需恰含 order_item_id 與 quantity';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE (SELECT count(*) FROM pg_catalog.jsonb_object_keys(el)) <> 2
                   OR NOT (el ? 'order_item_id') OR NOT (el ? 'quantity')) THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項元素需恰含 order_item_id 與 quantity';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE pg_catalog.jsonb_typeof(el->'order_item_id') <> 'string'
                   OR (el->>'order_item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項識別碼格式錯誤';
    END IF;
    -- 數量:jsonb number 且十進位整數字面(1.0/字串/boolean/null 全拒=canonical 單一產生式)
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE pg_catalog.jsonb_typeof(el->'quantity') <> 'number'
                   OR (el->>'quantity') !~ '^[0-9]+$') THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項數量需為正整數';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE (el->>'quantity')::numeric < 1 OR (el->>'quantity')::numeric > 2147483647) THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項數量超出範圍';
    END IF;
    IF (SELECT count(*) FROM pg_catalog.jsonb_array_elements(p_items) e(el))
       <> (SELECT count(DISTINCT (el->>'order_item_id')::uuid) FROM pg_catalog.jsonb_array_elements(p_items) e(el)) THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項重複';
    END IF;
    -- canonical 串:uuid 正規化後文字升冪、qty=驗證後 int 的 ::text(零雙 hash 面——
    -- 生 JSON 文字排序/去重會讓大寫 uuid 變體產生第二 hash 並繞過重複檢查,關卡2 抓)
    SELECT pg_catalog.string_agg(((el->>'order_item_id')::uuid)::text || '=' || ((el->>'quantity')::integer)::text,
                                 ',' ORDER BY ((el->>'order_item_id')::uuid)::text)
      INTO v_canon
      FROM pg_catalog.jsonb_array_elements(p_items) e(el);
  END IF;

  -- 步3 orders FOR UPDATE(第一觸表動作;§5.0 鎖序合約)
  SELECT id, payment_status, cancelled_at, cancelled_reason INTO v_order
    FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'a8a1:v1:' || p_order_id::text || ':' || p_reason_code || ':' || coalesce(v_detail,'')
      || CASE WHEN v_partial THEN ':partial:' || v_canon ELSE ':full' END,
    'UTF8')), 'hex');

  -- 步4 冪等格(驗全產物集+硬不變式;任一不符=fail-loud;plan v2c §3.2-4)
  SELECT id, payload_hash, actor, reason_code, reason_detail INTO v_existing
    FROM public.order_cancellations
   WHERE order_id = p_order_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    -- hash 欄自身竄改由這裡抓(hash=輸入導出;header 欄位竄改由下方不變式抓)
    IF v_existing.payload_hash IS DISTINCT FROM v_hash
       OR v_existing.actor IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- ①header reason 欄位對輸入
    IF v_existing.reason_code IS DISTINCT FROM p_reason_code
       OR v_existing.reason_detail IS DISTINCT FROM (CASE WHEN p_reason_code = 'other' THEN v_detail ELSE NULL END) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- ②逐品項硬不變式 0 ≤ Σci ≤ quantity(bigint)
    IF EXISTS (SELECT 1 FROM public.order_items oi
                WHERE oi.order_id = p_order_id
                  AND coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                                 WHERE ci.order_item_id = oi.id), 0) > oi.quantity::bigint) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- ③關單等價 + closing audit 判形 + reason 恰=closing header 映射
    IF (v_order.cancelled_at IS NOT NULL) <> (NOT EXISTS (
          SELECT 1 FROM public.order_items oi
           WHERE oi.order_id = p_order_id
             AND coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                            WHERE ci.order_item_id = oi.id), 0) < oi.quantity::bigint)) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    IF v_order.cancelled_at IS NULL THEN
      IF v_order.cancelled_reason IS NOT NULL THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
    ELSE
      -- 恰一筆 closing audit(after.closed=true 或 A8a1 三鍵關單形)且對客文字=其 header 映射
      IF (SELECT count(*) FROM public.admin_audit_log g
           WHERE g.target = 'order:' || p_order_id::text AND g.action = 'order.cancel'
             AND ((g.after ? 'closed' AND (g.after->>'closed')::boolean)
                  OR (NOT (g.after ? 'closed')
                      AND (SELECT count(*) FROM pg_catalog.jsonb_object_keys(g.after)) = 3
                      AND (g.after->>'cancelled_at') IS NOT NULL))) <> 1 THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
      IF v_order.cancelled_reason IS DISTINCT FROM (
           SELECT CASE c.reason_code
                    WHEN 'customer_request' THEN '依您要求取消'
                    WHEN 'out_of_stock'     THEN '商品供貨中斷,已為您取消'
                    WHEN 'long_leadtime'    THEN '交期無法配合,已為您取消'
                    WHEN 'price_change'     THEN '訂單已取消,詳情請洽客服'
                    WHEN 'duplicate_order'  THEN '重複訂單,已為您取消'
                    WHEN 'internal_error'   THEN '訂單已取消,詳情請洽客服'
                    WHEN 'other'            THEN c.reason_detail
                    ELSE NULL END
             FROM public.admin_audit_log g
             JOIN public.order_cancellations c ON c.id = (g.after->>'cancellation_id')::uuid
            WHERE g.target = 'order:' || p_order_id::text AND g.action = 'order.cancel'
              AND ((g.after ? 'closed' AND (g.after->>'closed')::boolean)
                   OR (NOT (g.after ? 'closed')
                       AND (SELECT count(*) FROM pg_catalog.jsonb_object_keys(g.after)) = 3
                       AND (g.after->>'cancelled_at') IS NOT NULL))) THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
    END IF;
    -- ④本 header 集合等式(雙向;整單=存在性條件化)
    IF v_partial THEN
      IF (SELECT count(*) FROM public.order_cancellation_items ci WHERE ci.cancellation_id = v_existing.id)
         <> pg_catalog.jsonb_array_length(p_items)
         OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                     WHERE NOT EXISTS (SELECT 1 FROM public.order_cancellation_items ci
                                        WHERE ci.cancellation_id = v_existing.id
                                          AND ci.order_item_id = (el->>'order_item_id')::uuid
                                          AND ci.cancelled_quantity = (el->>'quantity')::integer)) THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.order_items oi
        LEFT JOIN public.order_cancellation_items hc
               ON hc.cancellation_id = v_existing.id AND hc.order_item_id = oi.id
        CROSS JOIN LATERAL (SELECT oi.quantity::bigint
                 - coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                              WHERE ci.order_item_id = oi.id AND ci.cancellation_id <> v_existing.id), 0) AS rem) r
        WHERE oi.order_id = p_order_id
          AND ((r.rem > 0 AND hc.cancelled_quantity::bigint IS DISTINCT FROM r.rem)
               OR (r.rem <= 0 AND hc.order_item_id IS NOT NULL))) THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
    END IF;
    -- ⑤payment 允許集合(A8a3:與步7 **同一條述詞**)+ 零在途 attempts
    -- 🔴 這裡不同步改的話:現金單第一次取消得了,而重送同一顆冪等鍵會在這裡被擋
    --    ⇒ 外觀是「隨機失敗」。三處述詞(步7 / 本處 / audit 快照)必須一起改。
    IF (v_order.payment_status <> 'unpaid'::public.payment_status
         AND NOT (v_order.payment_status = 'paid'::public.payment_status
                  AND EXISTS (SELECT 1 FROM public.order_payments op
                               WHERE op.order_id = p_order_id)
                  AND NOT EXISTS (SELECT 1 FROM public.order_payments op
                                   WHERE op.order_id = p_order_id AND op.rail = 'card')))
       OR EXISTS (SELECT 1 FROM public.payment_charge_attempts pa
                   WHERE pa.order_id = p_order_id AND pa.status <> 'failed') THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- ⑥audit 恰一列且全欄相符(request_id 非 UNIQUE ⇒ 必數恰 1;closed 鍵條件比)
    SELECT g.* INTO v_audit FROM public.admin_audit_log g
     WHERE g.request_id = p_idempotency_key::text
       AND g.action = 'order.cancel' AND g.target = 'order:' || p_order_id::text;
    IF (SELECT count(*) FROM public.admin_audit_log g
         WHERE g.request_id = p_idempotency_key::text
           AND g.action = 'order.cancel' AND g.target = 'order:' || p_order_id::text) <> 1
       OR v_audit.actor IS DISTINCT FROM p_actor
       OR v_audit.reason IS DISTINCT FROM p_reason_code
       OR v_audit.source_app IS DISTINCT FROM 'admin'
       OR (v_audit.after->>'cancellation_id')::uuid IS DISTINCT FROM v_existing.id
       -- 快照比對(A8a1/a8a2 原為「before 整顆等值 + after 恆 unpaid」)。
       -- 🔴 **A8a3 把上面那句換掉,因為它已經不成立**:payment_status 的值域從單值 'unpaid'
       --    放寬成 {'unpaid','paid'} ⇒ 「整顆等值」寫不出來了。改成五道:鍵在 + 鍵數 + 型別 + 值域 + 前後一致。
       -- 🔴 **鍵在**與**型別**缺一不可:`->>` 對【缺鍵】與【JSON null】都回 NULL
       --    ⇒ 只驗取值的話,把鍵刪掉再塞一個別的鍵會整組穿過去(codex 關卡1 R2 的 C-1)。
       -- 🔴 **本段守的是「鍵形 + 值域 + 前後一致」,不守「值被整組替換」**:
       --    把 before 與 after 同時從 paid 改成 unpaid,本段抓不到 —— 逐字寫在這裡,不藏。
       --    擋它的在別層:admin_audit_log 對 service_role **只有 INSERT**
       --    (20260712210000:110-115 兩道 apply 期 ACL 斷言)且該表零 trigger(:161)
       --    ⇒ 要改那兩個值得有表 owner 權限,已不在本函式的射程內。
       OR NOT (v_audit.before ? 'payment_status')
       OR NOT (v_audit.before ? 'cancelled_at')
       OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_audit.before)) <> 2
       OR pg_catalog.jsonb_typeof(v_audit.before->'cancelled_at') <> 'null'
       OR pg_catalog.jsonb_typeof(v_audit.before->'payment_status') <> 'string'
       OR v_audit.before->>'payment_status' NOT IN ('unpaid', 'paid')
       OR v_audit.after->>'payment_status' IS DISTINCT FROM (v_audit.before->>'payment_status') THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- closed 權威值=本 op audit;缺鍵=判形 fallback(v2c:唯 A8a1 三鍵關單形 → true,其餘病理 RAISE)
    IF v_audit.after ? 'closed' THEN
      -- 鍵在:恰 4 鍵+值必 boolean(加鍵/JSON null/字串竄改=病理;codex R2 MF2)
      IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_audit.after)) <> 4
         OR pg_catalog.jsonb_typeof(v_audit.after->'closed') <> 'boolean' THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
      v_closed := (v_audit.after->>'closed')::boolean;
    ELSIF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_audit.after)) = 3
          AND (v_audit.after->>'cancelled_at') IS NOT NULL THEN
      v_closed := true;
    ELSE
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- after.cancelled_at 與 closed 同形(codex R2 MF2:部分 audit 被塞非 NULL cancelled_at=病理)
    IF v_closed <> ((v_audit.after->>'cancelled_at') IS NOT NULL) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- closed 值交叉核對(關卡2 折入):audit 宣稱已關 ⇒ orders 必已關(反向=部分 op 的 false
    -- 在單子後來被關掉=合法,不設反向)
    IF v_closed AND v_order.cancelled_at IS NULL THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    RETURN pg_catalog.jsonb_build_object('cancelled', true,
      'cancellation_id', v_existing.id, 'idempotent', true, 'closed', v_closed);
  END IF;

  -- 步5 已取消守門+帳本健康閘(v2:新鍵也驗;PS4 的 header-only 病理由③擋)
  IF v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  IF v_order.cancelled_reason IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_items oi
                 WHERE oi.order_id = p_order_id
                   AND coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                                  WHERE ci.order_item_id = oi.id), 0) > oi.quantity::bigint)
     OR EXISTS (SELECT 1 FROM public.order_cancellations c
                 WHERE c.order_id = p_order_id
                   AND NOT EXISTS (SELECT 1 FROM public.order_cancellation_items ci
                                    WHERE ci.cancellation_id = c.id)) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步6 actor 存在且啟用(FK 只擋不存在;A7 債⑥)
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步7 允許集合(A8a3 放寬:unpaid **或** 非卡已付款;attempts 那一半逐字不動)
  -- 🔴 判準讀 public.order_payments.rail 的集合,**不讀 orders.payment_channel**
  --    (該欄 DEFAULT 就是 'tappay'、正式庫 19/19 都是它 ⇒ 它是常數不是資料;W2 2026-08-19 實量)。
  -- 🔴 零收款列 ⇒ 不放行(態 C fail-closed):正式庫有一張 refunded 而收款帳本零列的舊單。
  -- 🔴 **刻意不看淨額**(不加 SUM(amount) > 0):那道條件在並行下會翻面 ——
  --    並行插入一筆人工正額會把「不可取消」變「可取消」(codex 關卡1 R2 的 E-1)。
  --    殘餘風險與落地必驗寫在 backlog #764,不留在 commit body。
  -- 🔴 attempts 那一半**一個字不動** ⇒ 20260809160000 L3a COMMENT 的跨檔不變式
  --    「cancelled ⇒ 無 active attempt」不受影響;而刷卡單照樣被它擋住,不必為它另寫一道閘。
  IF (v_order.payment_status <> 'unpaid'::public.payment_status
       AND NOT (v_order.payment_status = 'paid'::public.payment_status
                AND EXISTS (SELECT 1 FROM public.order_payments op
                             WHERE op.order_id = p_order_id)
                AND NOT EXISTS (SELECT 1 FROM public.order_payments op
                                 WHERE op.order_id = p_order_id AND op.rail = 'card')))
     OR EXISTS (SELECT 1 FROM public.payment_charge_attempts a
                 WHERE a.order_id = p_order_id AND a.status <> 'failed') THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步8 品項守門(鎖 items NKU 按 id 序=排序契約;額度只由真相算;摘要只驗在場不讀值)
  PERFORM 1 FROM public.order_items oi
   WHERE oi.order_id = p_order_id
   ORDER BY oi.id
   FOR NO KEY UPDATE;
  SELECT count(*) INTO v_cnt FROM public.order_items x WHERE x.order_id = p_order_id;
  -- 零品項單 fail-closed(row 36「零明細 header」;A7-t presence 是 DEFERRED 且訊息非通用,不倚賴)
  IF v_cnt = 0 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  -- 摘要在場一致閘(row 37 fail-closed 正解):真相非零的品項必有 summary 列,缺列=毀損 RAISE
  IF EXISTS (
    SELECT 1 FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND (coalesce((SELECT sum(r.quantity)::bigint FROM public.order_item_procurement p
                       JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                      WHERE p.order_item_id = oi.id AND r.quantity > 0), 0) > 0
           OR coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                         WHERE ci.order_item_id = oi.id), 0) > 0)
      AND NOT EXISTS (SELECT 1 FROM public.order_item_quantity_summary s WHERE s.order_item_id = oi.id)) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  IF v_partial THEN
    -- 請求品項必屬本單
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE NOT EXISTS (SELECT 1 FROM public.order_items oi
                                   WHERE oi.id = (el->>'order_item_id')::uuid AND oi.order_id = p_order_id)) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- 可取消量守門:增量 ≤ quantity − instock − cancelled(bigint;Q17=B;shipped 退化式)
    IF EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
      JOIN public.order_items oi ON oi.id = (el->>'order_item_id')::uuid
      WHERE (el->>'quantity')::bigint > oi.quantity::bigint
            - coalesce((SELECT sum(r.quantity)::bigint FROM public.order_item_procurement p
                          JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                         WHERE p.order_item_id = oi.id AND r.quantity > 0), 0)
            - coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                         WHERE ci.order_item_id = oi.id), 0)) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    v_expect := pg_catalog.jsonb_array_length(p_items);
  ELSE
    -- 整單(含部分歷史收尾):任一品項有到貨 ⇒ 拒(Q17=B);全增量=0 ⇒ 拒(殘態重呼)
    IF EXISTS (SELECT 1 FROM public.order_items oi
                WHERE oi.order_id = p_order_id
                  AND coalesce((SELECT sum(r.quantity)::bigint FROM public.order_item_procurement p
                                  JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                                 WHERE p.order_item_id = oi.id AND r.quantity > 0), 0) > 0) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    SELECT count(*) INTO v_expect FROM public.order_items oi
     WHERE oi.order_id = p_order_id
       AND oi.quantity::bigint > coalesce((SELECT sum(ci.cancelled_quantity)::bigint
                                             FROM public.order_cancellation_items ci
                                            WHERE ci.order_item_id = oi.id), 0);
    IF v_expect = 0 THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
  END IF;

  -- 步9 寫入(同交易;items 按 order_item_id 序=排序契約;append-only)
  INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, reason_detail, payload_hash)
  VALUES (p_order_id, p_actor, p_idempotency_key, p_reason_code,
          CASE WHEN p_reason_code = 'other' THEN v_detail ELSE NULL END, v_hash)
  RETURNING id INTO v_cid;
  IF v_partial THEN
    INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
    SELECT v_cid, p_order_id, (el->>'order_item_id')::uuid, (el->>'quantity')::integer
      FROM pg_catalog.jsonb_array_elements(p_items) e(el)
     ORDER BY ((el->>'order_item_id')::uuid)::text;
  ELSE
    INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
    SELECT v_cid, p_order_id, oi.id,
           (oi.quantity::bigint - coalesce((SELECT sum(ci.cancelled_quantity)::bigint
                                              FROM public.order_cancellation_items ci
                                             WHERE ci.order_item_id = oi.id AND ci.cancellation_id <> v_cid), 0))::integer
      FROM public.order_items oi
     WHERE oi.order_id = p_order_id
       AND oi.quantity::bigint > coalesce((SELECT sum(ci.cancelled_quantity)::bigint
                                             FROM public.order_cancellation_items ci
                                            WHERE ci.order_item_id = oi.id AND ci.cancellation_id <> v_cid), 0)
     ORDER BY oi.id;
  END IF;
  -- items 筆數守:BEFORE trigger 抑制單列 ⇒ 部分取消冒充請求集;必=預期筆數
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> v_expect THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  -- 關單判定:寫後全域重算(此值=audit.closed=重放權威)
  v_closed := NOT EXISTS (
    SELECT 1 FROM public.order_items oi
     WHERE oi.order_id = p_order_id
       AND oi.quantity::bigint > coalesce((SELECT sum(ci.cancelled_quantity)::bigint
                                             FROM public.order_cancellation_items ci
                                            WHERE ci.order_item_id = oi.id), 0));
  IF v_closed THEN
    UPDATE public.orders
       SET cancelled_at = pg_catalog.now(),
           cancelled_reason = v_reason_txt,
           updated_at = pg_catalog.now()
     WHERE id = p_order_id;
    -- row_count 守(PF-C 同款):trigger 抑制/FORCE RLS ⇒ 對客欄靜默漏寫=產物集不一致,必炸全回滾
    GET DIAGNOSTICS v_bad = ROW_COUNT;
    IF v_bad <> 1 THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
  END IF;
  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (p_actor, 'order.cancel', 'order:' || p_order_id::text, p_idempotency_key,
          pg_catalog.jsonb_build_object('payment_status', v_order.payment_status, 'cancelled_at', NULL),
          pg_catalog.jsonb_build_object('payment_status', v_order.payment_status,
            'cancelled_at', CASE WHEN v_closed THEN pg_catalog.now() ELSE NULL END,
            'cancellation_id', v_cid, 'closed', v_closed),
          p_reason_code, 'admin');
  -- audit 筆數守:trigger 抑制 ⇒ 零稽核的成功取消;必恰 1
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  RETURN pg_catalog.jsonb_build_object('cancelled', true, 'cancellation_id', v_cid,
    'idempotent', false, 'closed', v_closed);
END;
$fn$;

-- ── 2. 契約副本:欄位 COMMENT 與函式 COMMENT ─────────────────────────────
-- 🔴 codex 關卡2 R1 must-fix(3/7):CREATE OR REPLACE 保留 COMMENT ⇒ 這是好事(ACL 也保留),
--    **而副作用是它把一句過期的話原封留在原地**:
--    `order_cancellations.reason_code` 的 COMMENT 逐字寫著
--      「internal_error 對客刻意映射成「依您要求取消」= 不揭露我方疏失(Sean 知情核准)」
--    ⇒ 那句話 2026-08-30 已被 Sean 本人推翻(他選「乙 不對客人說不實的話」)。
--    📌 而 COMMENT 是這個 repo 存契約的地方(`information_schema` 查不到這些話)
--       ⇒ 下一個人照它施工,會合理地把本片改回去。**改碼而不改契約 = 埋一顆回捲。**
COMMENT ON COLUMN public.order_cancellations.reason_code IS
  '內部取消原因,§5.1d 七值 allowlist(Sean 2026-07-28 拍 Q18)。🔴 對客文字由 admin_cancel_order 依映射表產出、寫進 orders.cancelled_reason;未知 code 一律 RAISE fail-closed。🔴🔴 **2026-08-30 更新(Sean 拍「2 乙」+ 逐字「寫很官方就好」)**:`price_change` 與 `internal_error` 兩格的對客文字**已從「依您要求取消」改成「訂單已取消,詳情請洽客服」**。~~原句「internal_error 對客刻意映射成『依您要求取消』= 不揭露我方疏失(Sean 知情核准)」~~ **作廢,不要照著做** —— 他 2026-08-30 選的選項逐字是「不說是你要求的 — 不對客人說不實的話」。⚠️ **而「Sean 知情核准」那五個字本身未確認**(R3 對抗審查 2026-08-30 抓):2026-08-30 那題的題目【自己】逐字寫著「那張表的字**沒被你看過**」,而本欄原句說 07-28 Q18 他核准過 —— **兩份文件各自為真,何者是史實沒有人量過**。⇒ 所以這裡寫的是「作廢」不是「他推翻了自己」;現行指示明確,而那段歷史不明確,兩件事分開。舊句留著不刪,是為了讓搜舊字面的人也撞得到這則更正。落點 20260830020000。';

-- 函式 COMMENT:**附加**不重寫(重寫 = 把 A8a1/A8a2/A8a3 三代累積的契約洗掉)。
DO $$
DECLARE v_old text;
BEGIN
  v_old := obj_description('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure, 'pg_proc');
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'COMMENT 附加:讀不到既有 COMMENT ⇒ 停下(不要用一句新的蓋掉三代契約)';
  END IF;
  -- codex R2 nit:用整個日期判「已附加」會把同日其他合法 COMMENT 誤判成重跑(fail-closed 假紅)
  --   ⇒ 改釘本片的落點編號,那個字串只會由本片寫進去。
  IF position('20260830020000' in v_old) > 0 THEN
    RAISE EXCEPTION 'COMMENT 附加:看起來已經附加過 ⇒ forward-only,拒重跑';
  END IF;
  EXECUTE format(
    'COMMENT ON FUNCTION public.admin_cancel_order(uuid,uuid,text,text,text,jsonb) IS %L',
    v_old || ' 🔴 2026-08-30(Sean 拍「2 乙」):price_change 與 internal_error 的對客文字改為「訂單已取消,詳情請洽客服」,不再遮罩成「依您要求取消」。那張 CASE 表在本函式裡有兩份(步2 寫入端 / 步4 冪等回放端),兩份必須同字面,只改一份會讓冪等重入 RAISE。落點 20260830020000。');
END
$$;

-- ── 3. 事後閘 ──────────────────────────────────────────────────────────
-- 🔴 codex 關卡2 R1 must-fix(4/7):**只數總量的閘是弱判準**。
--    它證出來的假綠世界:把 internal_error 改成 NULL、再把新句搬去兩個 other 分支
--    ⇒ 新句仍 4 次、舊句仍 2 次、負對照仍 0 ⇒ **全綠而行為已壞**。
--    ⇒ 所以下面數的是【每一個 code 各自那一行的完整形狀】,不是總量。
DO $$
DECLARE
  src text;
  -- 每一格:要數的字面 + 預期次數(2 = 兩份 CASE 各一;1 = 兩份形狀本來就不同)
  spec text[][] := ARRAY[
    ['WHEN ''customer_request'' THEN ''依您要求取消''',                 '2'],
    ['WHEN ''out_of_stock''     THEN ''商品供貨中斷,已為您取消''',      '2'],
    ['WHEN ''long_leadtime''    THEN ''交期無法配合,已為您取消''',      '2'],
    ['WHEN ''price_change''     THEN ''訂單已取消,詳情請洽客服''',      '2'],
    ['WHEN ''duplicate_order''  THEN ''重複訂單,已為您取消''',          '2'],
    ['WHEN ''internal_error''   THEN ''訂單已取消,詳情請洽客服''',      '2'],
    ['WHEN ''other''            THEN NULL',                             '1'],
    ['WHEN ''other''            THEN c.reason_detail',                  '1'],
    ['WHEN ''price_change''     THEN ''依您要求取消''',                 '0'],
    ['WHEN ''internal_error''   THEN ''依您要求取消''',                 '0'],
    ['zzq6641',                                                         '0']
  ];
  i int;
  needle text;
  want int;
  got int;
BEGIN
  -- 🔴 codex R2 must-fix(3/4):`pg_get_functiondef` **含函式內註解** ⇒ 把兩條正確形狀
  --    搬進註解、實際分支改成 NULL,11 格照樣全過(它已構造出 dbGateFalseGreen=true)。
  --    ⇒ 先剝【行註解 `--` 到行尾】與【區塊註解 `/* ... */`】,再數。
  --    ⚠️ 過度剝除只會讓閘【更容易紅】⇒ 失敗方向是安全的。
  --    (同一步驟在 scripts/cancel-reason-neutral-contract.test.ts 那一側也做,兩層各自獨立。)
  src := pg_get_functiondef('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure);
  src := regexp_replace(src, '/\*.*?\*/', '', 'gs');
  src := regexp_replace(src, '--[^' || chr(10) || ']*', '', 'g');
  FOR i IN 1 .. array_length(spec, 1) LOOP
    needle := spec[i][1];
    want   := spec[i][2]::int;
    got    := (length(src) - length(replace(src, needle, ''))) / length(needle);
    IF got <> want THEN
      RAISE EXCEPTION '事後閘:「%」出現 % 次(預期 %)', needle, got, want;
    END IF;
  END LOOP;
  -- 🔴 自檢:上面有三格預期 0(兩句舊字面 + 一個現造字面)。
  --    它們證的是「這把尺不是恆回 want」—— 而【該是 2 的那六格】證的是它真的數得到東西。
  --    兩個方向都在,少任何一邊都會讓另一邊變成一句沒有分母的話。

  RAISE NOTICE '事後閘①通過:11 格字面(已剝註解)';
END
$$;

-- ── 4. ACL:service_role only(逐字沿用 A8a3 :719-725 的三行與它的理由)──────
-- 🔴 codex R2 must-fix(2/4):我 R1 寫的「量 anon/authenticated/service_role 三個角色」
--    **是一道比 A8a3 原本更弱的東西** —— 它漏掉任何其他自建角色的 EXECUTE,
--    也漏掉 `WITH GRANT OPTION`。⇒ 正解不是把檢查寫得更長,是**照 A8a3 自己那三行再做一次**:
--    A8a3 檔頭逐字「成本為零,而『靠上一支做對了』不是一道防線」。
-- 🔴 `CREATE OR REPLACE` 且參數型別未變 ⇒ proacl 本來就保留;這三行是**縱深**不是修補。
REVOKE ALL ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) TO service_role;

DO $$
DECLARE
  v_oid oid := 'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure;
  v_owner oid;
  v_acl aclitem[];
  v_bad text;
BEGIN
  SELECT proowner, proacl INTO v_owner, v_acl FROM pg_proc WHERE oid = v_oid;
  -- 🔴 `proacl IS NULL` = 從未被 GRANT/REVOKE 過 = **預設 PUBLIC 可執行**。
  --    上面三行跑完不可能是 NULL ⇒ 是 NULL 就代表這段沒生效,不是「乾淨」。
  IF v_acl IS NULL THEN
    RAISE EXCEPTION 'ACL 閘:proacl 是 NULL ⇒ PUBLIC 預設可執行,而上面三行應該已經寫過它 ⇒ 停下';
  END IF;
  -- 全稱斷言:除了 owner 與 service_role,不准有任何 grantee;也不准 WITH GRANT OPTION。
  SELECT string_agg(format('%s:%s%s',
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,
           a.privilege_type, CASE WHEN a.is_grantable THEN '(WITH GRANT OPTION)' ELSE '' END), ', ')
    INTO v_bad
    FROM aclexplode(v_acl) a
   WHERE a.is_grantable
      OR a.grantee = 0
      OR (a.grantee <> v_owner AND a.grantee <> 'service_role'::regrole);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ACL 閘:admin_cancel_order(SECURITY DEFINER、動錢)有不該有的授權 ⇒ %', v_bad;
  END IF;
  -- 正對照:service_role 必須真的在裡面 —— 否則上面那個「沒有壞的」也相容於「一個都沒有」
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL 閘正對照:service_role 呼不到 ⇒ 上面那個乾淨的結論作廢';
  END IF;
  RAISE NOTICE '事後閘②通過:ACL 只有 owner + service_role、零 PUBLIC、零 WITH GRANT OPTION';
END
$$;

COMMIT;
