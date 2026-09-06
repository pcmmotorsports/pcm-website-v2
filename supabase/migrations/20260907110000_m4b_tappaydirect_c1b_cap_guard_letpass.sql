-- ⟦b4-TAPPAYDIRECT⟧ 片 C-1b:退款上限守門的**窄讓路** —— 補登列超額時【記下來, 不擋】
--
-- ══ 🔴🔴 Sean 2026-09-07 00:17 `q33` 甲逐字 ═══════════════════════════════════
--   「補登金額超過我們帳上可退餘額時, **記下來並標異常, 而不是擋**
--     (錢外面已經動了, 擋 = 從帳上消失)」
--   ⇒ 📌 這一句的重點在括號裡:**擋一筆【已經發生的事】, 不會讓它沒發生 ——
--     只會讓我們的帳少記一筆。** 而少記的那一筆, 沒有任何東西會再提醒任何人。
--
-- ══ 🛑 而讓路要多窄 ═══════════════════════════════════════════════════════════
--   **只對 `backfilled_source IS NOT NULL` 的列, 只換掉超額那一支 `RAISE`。**
--   · 一般退款(我們自己要發起的)⇒ **照舊擋** —— 那筆錢還沒動, 擋得住就該擋。
--   · 其餘每一道(算不出上限 `PCM05` / 找不到訂單 `PCM07` / 隔離級別 `PCM06`)⇒ **原封不動**。
--   🔴 **不得提前 `RETURN` 跳過鎖**(plan v3 §3.7 / codex R2 #6):
--     那把 `FOR NO KEY UPDATE` 是本守門的本體(兩個 session 各自算 cap 會兩筆都進去),
--     ⇒ 讓路只改「算完之後怎麼處置」, **不改「算之前要不要鎖」**。
--
-- ══ 🎯 而 incident 【不是我開的】—— 現成的那個已經在跑 ═════════════════════════
--   plan v3 §6b② 量到的:`pcm_sync_order_refund_payment_status` 的 `:82-89` 已經在做
--   「超額就開 `refund_over_total` 的 incident 而不擋」, **而且帶 `NOT EXISTS` 去重**。
--   ⇒ 📌 我自己在這裡再寫一份 ⇒ **同一件事會開兩列**。
--   ⇒ ✅ 所以本片**只做一件事:不 RAISE**。那一列落地之後, 補登 RPC 的 G10 會呼叫同步器,
--     由它開單。**我原本要蓋一個平行機制, 而現成的那個已經在正式庫上跑。**
--
-- ══ 貼序:A → B → C(本支排在貼板 79 之後)═══════════════════════════════════
--   前置:69(`20260907020000` A1 七欄)· 79(`20260907100000` C-1a 補登 RPC)
--   🛑 **79 沒貼就不要貼本支** —— 沒有補登 RPC 的話, 這個讓路**沒有任何一列走得到它**,
--     而它會安靜地待在那裡(那是「開了一道沒有人用的門」, 不是「沒作用」)。
--   貼板 **80**(`20260907110000`)。

BEGIN;

-- ══ 1. 前置閘 ═════════════════════════════════════════════════════════════════
DO $pre$
DECLARE v_src text; v_cnt integer;
BEGIN
  -- P1. 那支守門在(本片改的就是它)
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='pcm_order_refund_cap_guard';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'C-1b 前置閘 P1:找不到 pcm_order_refund_cap_guard ⇒ 拒繼續';
  END IF;

  -- 🔴 P2. **我要改的那一句逐字還在** —— 少了這一格, 我可能在一個我沒讀過的版本上疊東西
  IF pg_catalog.strpos(v_src, 'IF NEW.refund_amount > v_cap THEN') = 0 THEN
    RAISE EXCEPTION 'C-1b 前置閘 P2:那支守門裡沒有「IF NEW.refund_amount > v_cap THEN」'
                    '⇒ 它不是我抄的那一代, 停下來比對';
  END IF;

  -- 🔴 P3. **它現在【還沒有】讓路** —— 本支不冪等
  IF pg_catalog.strpos(v_src, 'backfilled_source') > 0 THEN
    RAISE EXCEPTION 'C-1b 前置閘 P3:那支守門已經提到 backfilled_source ⇒ 本支已 apply 過;拒繼續';
  END IF;

  -- P4. 補登 RPC 在(沒有它, 這個讓路沒有任何一列走得到)
  IF to_regprocedure(
       'public.admin_backfill_tappay_console_refund(uuid,integer,text,timestamptz,boolean,text,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'C-1b 前置閘 P4:找不到補登 RPC ⇒ 先貼 20260907100000(貼板 79);拒繼續';
  END IF;

  -- 🔴 P5. **同步器裡那段 incident 邏輯還在** —— 本片把開單的責任交給它, 它不在就沒有人記
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='pcm_sync_order_refund_payment_status'
     AND p.prosrc LIKE '%refund_over_total%';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'C-1b 前置閘 P5:同步器裡找不到 refund_over_total 的開單邏輯(命中 %)'
                    '⇒ 讓路之後【沒有人會記下這件事】⇒ 拒繼續', v_cnt;
  END IF;

  -- 🔵 P6. 正向對照
  IF pg_catalog.strpos(v_src, 'PCM04') = 0 OR pg_catalog.strpos(v_src, 'PCM05') = 0 THEN
    RAISE EXCEPTION 'C-1b 前置閘 P6(正向對照):守門裡連 PCM04/PCM05 都找不到 ⇒ 我的量法壞了';
  END IF;

  RAISE NOTICE 'C-1b 前置閘 P1-P6 全過。';
END
$pre$;

-- ══ 2. 窄讓路 ═════════════════════════════════════════════════════════════════
-- 🔴🔴 **做法:不重寫整支, 只把那一句 `IF` 的條件改窄** ——
--   用 `pg_get_functiondef` 取現行定義, 對**那一行**做逐字取代, 再原樣 CREATE OR REPLACE。
--   🛑 **為什麼不手抄整支**:那支守門有 100+ 行, 裡面每一段都記著別人踩過的坑
--     (鎖強度 `FOR NO KEY UPDATE`、隔離級別斷言、`PCM05`/`PCM07` 分家的理由)。
--     ⇒ 📌 **手抄 = 我在賭我抄得完整**, 而抄漏的那一段在 diff 上看不出來。
--   ✅ 逐字取代 + 事後比對「除了那一行以外一個字都沒變」⇒ 那個賭注不存在。
DO $patch$
DECLARE
  v_def text;
  v_old text := 'IF NEW.refund_amount > v_cap THEN';
  v_new text :=
    -- 🔴 讓路寫在條件裡, 不是在 body 裡提前 RETURN ⇒ 鎖與前面每一道檢查照走。
    'IF NEW.refund_amount > v_cap AND NEW.backfilled_source IS NULL THEN';
  v_hits integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='pcm_order_refund_cap_guard';

  -- 🔴 **先數命中幾次** —— 恰一次才動手。0 次 = 抄錯代;2 次以上 = 我不知道會改到哪一個。
  v_hits := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_old, '')))
            / pg_catalog.length(v_old);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'C-1b:那一句在定義裡命中 % 次(期望恰 1)⇒ 拒改', v_hits;
  END IF;

  EXECUTE pg_catalog.replace(v_def, v_old, v_new);
END
$patch$;

COMMENT ON FUNCTION public.pcm_order_refund_cap_guard() IS
  '#445b 退款上限併發守門(BEFORE INSERT ON order_refunds)。先鎖父列再算 cap ⇒ 兩個 session 不會各自判「還夠」。'
  '🔴 **2026-09-07 ⟦b4-TAPPAYDIRECT⟧ C-1b 窄讓路**:`backfilled_source IS NOT NULL` 的列(= TapPay 後台補登)'
  '超額時**不再 RAISE PCM04** —— Sean 2026-09-07 q33 甲逐字「錢外面已經動了, 擋 = 從帳上消失」。'
  '🛑 讓路只改那一句 `IF` 的條件:**鎖照取、其餘每一道檢查照走、一般退款照舊擋**。'
  '🎯 而異常**不是這裡記的** —— 那一列落地後由 `pcm_sync_order_refund_payment_status` 開 '
  '`refund_over_total` 的 incident(它自帶 `NOT EXISTS` 去重;本函式若自己再寫一份會開兩列)。';

-- ══ 3. 事後斷言 ═══════════════════════════════════════════════════════════════
DO $post$
DECLARE v_src text; v_cnt integer;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='pcm_order_refund_cap_guard';

  -- ① 讓路在了
  IF pg_catalog.strpos(v_src, 'NEW.backfilled_source IS NULL') = 0 THEN
    RAISE EXCEPTION 'C-1b 事後閘①:讓路那一句沒進去';
  END IF;

  -- 🔴 ② **其餘每一道還在** —— 這一格擋的是「我不小心改多了」
  --    (逐字取代理論上只動一行, 而「理論上」不是證據)
  SELECT count(*) INTO v_cnt FROM unnest(ARRAY['PCM04','PCM05','PCM06','PCM07',
                                               'FOR NO KEY UPDATE','transaction_isolation']) AS c
   WHERE pg_catalog.strpos(v_src, c) > 0;
  IF v_cnt <> 6 THEN
    RAISE EXCEPTION 'C-1b 事後閘②:守門原本的六個特徵只剩 % 個 ⇒ 我改多了', v_cnt;
  END IF;

  -- 🔴 ③ **本片不得自己寫 incident** —— 寫了會與同步器重複開單
  IF pg_catalog.strpos(v_src, 'refund_over_total') > 0 THEN
    RAISE EXCEPTION 'C-1b 事後閘③:守門自己提到 refund_over_total ⇒ 那會與同步器開兩列';
  END IF;

  -- ④ trigger 還掛著, 而且仍是第一個 BEFORE INSERT(名字排序承重, 見 20260830210000 檔頭)
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_trigger t
   WHERE NOT t.tgisinternal AND t.tgfoid = 'public.pcm_order_refund_cap_guard'::regproc;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'C-1b 事後閘④:掛那支守門的 trigger 有 % 個(期望 1)', v_cnt;
  END IF;

  -- 🔵 ⑤ 正向對照:同一把尺去找一個【一定不在】的字面 ⇒ 必須是 0
  IF pg_catalog.strpos(v_src, 'zz_c1b_never_exists') > 0 THEN
    RAISE EXCEPTION 'C-1b 事後閘⑤(正向對照):現造的字面竟然命中 ⇒ 我的量法壞了';
  END IF;

  RAISE NOTICE 'C-1b 事後閘①-⑤ 全過(② 六個特徵全在)。';
END
$post$;

COMMIT;
