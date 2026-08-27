-- ============================================================
-- `#473b-1` · 回退腳本(forward-only 之下的手動 down)
-- ============================================================
-- 標的 = supabase/migrations/20260814190000_m4b_e10_473b1_refund_manual_corrections.sql
--
-- ── 用法 ────────────────────────────────────────────────
-- **主要路徑(Sean 自己就能做):把本檔【整份】貼進 Supabase Dashboard → SQL Editor 執行。**
--   不需要 psql、不需要任何連線字串。中途任何一行出錯 ⇒ **整個交易回滾,資料庫回到執行前**。
-- 備援路徑(工程端、手上有連線字串時):
--   `psql "<連線字串>" -v ON_ERROR_STOP=1 -f scripts/473b1-down.sql`
--   ⚠️ 不要寫成 `psql "$DATABASE_URL"` —— `.env.local` 裡沒有這個名字(452a-down.sql 已量過)。
--
-- ── 🔴🔴 執行前必做一件事:先把更正紀錄撈出來存檔 ────────────────────────
-- 本腳本會 `DROP TABLE`,**已經寫進去的每一筆更正都會跟著消失**
-- ——那些是「我們曾經判錯、後來改了、誰改的」的唯一紀錄,砍掉沒有第二份。
-- **先單獨跑下面這一句,把結果另存,再往下貼:**
--
--   SELECT c.*, r.order_id, r.refund_amount
--     FROM public.order_refund_manual_corrections c
--     JOIN public.order_refunds r ON r.id = c.refund_id
--    ORDER BY c.refund_id, c.seq;
--
-- 🔴 **本腳本刻意不自動備份**:自動備份要決定「備份到哪張表」,那又是一個 schema 決定,
--    而回退當下不是做 schema 決定的時機。存檔這一步交給人,並且寫在這裡讓人看見。
--
-- ── 🔴 為什麼「貼 Dashboard」這條路成立(可重數;數法連同陷阱一起寫)──────
--   🔴 **一律只數「可執行區間」= `^BEGIN;$` 那行到 `^COMMIT;$` 那行**,不要數整個檔 ——
--      本註解區塊自己就含 `psql`、`-v` 這些樣式字,數整檔會把它們一起數進去。
--      取區間:`B=$(grep -n '^BEGIN;$' 檔) ; C=$(grep -n '^COMMIT;$' 檔) ; sed -n "$B,$Cp" 檔 | …`
--   ① 可執行區間內沒有任何 psql 變數(`:'name'` / `:name` / `\set` 等反斜線指令)⇒ 貼進 Dashboard 語意不變。
--   ② 整檔包在單一交易裡 ⇒ Dashboard 沒有 `ON_ERROR_STOP` 也不會半套用。
--      (檔內其他 `BEGIN` 都是 plpgsql 區塊的 `BEGIN`,不是交易控制。)
--   ⚠️ 兩條都是 **2026-08-14 對本檔當下內容**數的。**改過本檔就要重數**,不要沿用。
--
-- ── 🔴 順序不可調換(這是本腳本唯一容易做錯的地方)────────────────────────
-- `pcm_order_refundable_remaining` **參照了** `order_refund_effective_verdict`。
-- 先 DROP view 會讓那支函式指向不存在的物件 ⇒ 下一次有人呼叫它就爆,
-- 而**呼叫它的是訂單頁與異常清單**(反向盤點 R4/R5/R9)⇒ 後台當場壞。
-- ⇒ **必須先把函式還原成不參照 view 的舊定義**,才能往下砍。
--
-- ── 這支不動什麼 ────────────────────────────────────────
-- `order_refunds` **一個字都沒被本片改過** ⇒ **沒有資料要回填**。
-- 這正是 Q-473-2 選 A 案(新開表)而不是 B 案(金流表加欄)的主要理由。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ══ 步 0:先鎖死更正表,再往下做任何事(codex 關卡2 must-fix)═══════════════
-- 🔴 沒有這道鎖,「先 SELECT 存檔」與「DROP TABLE」之間是**開著的窗** ——
--    期間提交的新更正會被 DROP 掉、而且不在你剛存的那份備份裡 ⇒ 稽核資料永久消失且無人察覺。
-- 🔴 用 DO 包起來(換模型審查 consider 9,屬實):`LOCK TABLE` 沒有 `IF EXISTS`。
--    半套狀態(表已砍、但函式還指著 view)下,裸 LOCK 會**在第一行就爆、整個交易回滾** ——
--    連步 1 那句「把函式還原成不參照 view」的救命動作也一起沒了,而那正是後台會壞的那一段。
DO $lock$
BEGIN
  IF to_regclass('public.order_refund_manual_corrections') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.order_refund_manual_corrections IN ACCESS EXCLUSIVE MODE';
  ELSE
    RAISE NOTICE '#473b-1 回退:更正表已不存在(半套狀態)⇒ 跳過鎖,繼續往下把函式還原';
  END IF;
END
$lock$;

-- ⚠️ **誠實邊界(這道鎖沒有完全關上那個窗)**:它只涵蓋「本腳本開始之後」。
--    你跑備份 SELECT 到你按下本腳本之間,仍可能有人寫入。
--    要完全關上得把備份寫進另一張永久表 —— 那是一個**新的 schema 決定**,而回退當下
--    不是做 schema 決定的時機 ⇒ 刻意不做。
--    ⇒ 實務作法:**備份 SELECT 與本腳本連續執行、中間不要離開座位**;
--      若對此不放心,先把後台停掉再回退。

-- ══ 步 1(順序關鍵):把 remaining 還原成 #473b-1 之前的定義 ═══════════════
-- 逐字取自 supabase/migrations/20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:394-408
-- (RW1a 版本;本片之前的最後一版)。簽章一個字不動 —— 還原之後既有讀取點照樣指到這裡。
CREATE OR REPLACE FUNCTION public.pcm_order_refundable_remaining(p_order_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.total::bigint - COALESCE(
           (SELECT SUM(r.refund_amount)
              FROM public.order_refunds r
             WHERE r.order_id = o.id
               AND r.status IN ('processing', 'confirmed')), 0)
    FROM public.orders o
   WHERE o.id = p_order_id;
$$;

-- COMMENT 也要還原,否則回退後留著一段講「會扣掉更正」的說明,而程式已經不扣了
-- (= 假字面留在正式庫裡;本 repo 對這個形狀有案底)。
COMMENT ON FUNCTION public.pcm_order_refundable_remaining(uuid) IS
  'A7c 顯示用(RW1a 改版):orders.total 減去本帳本已登記(processing + confirmed)的退款金額。deferred 與 failed 不佔額度(deferred=10024 已證零動錢;failed 沿舊語意 —— 轉 failed 前必先 Record 對帳的營運鐵律不變)。🔴 RW1a 起本式為 allowlist:**未來新增任何 status 值預設不佔額度(顯示面 fail-open 方向,與舊 <> failed 寫法相反)—— 新增狀態時必須回訪本函式**。🔴 不是守門、沒有 trigger 讀它(拍板⑤);只反映本帳本,Portal 場外退款不在其中 ⇒ 真實剩餘額 ≤ 本值;UI 措辭必須是「帳本未登記額」不得寫「還能退多少」。查無訂單回 NULL。';

-- ══ 步 2:更正 RPC ═════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.admin_correct_order_refund_verdict(uuid, uuid, text, text, text, text);

-- ══ 步 3:有效更正 view ════════════════════════════════════════════════════
DROP VIEW IF EXISTS public.order_refund_effective_verdict;

-- ══ 步 4:更正表(🔴 資料在這一步永久消失,前面那句 SELECT 存檔了嗎)════════
DROP TABLE IF EXISTS public.order_refund_manual_corrections;

-- ══ 步 5:回退後的斷言(不驗就不知道到底退乾淨沒有)═══════════════════════
DO $assert$
DECLARE
  v_cnt integer;
  v_def text;
BEGIN
  -- 5a 三個物件都不在了
  IF to_regclass('public.order_refund_manual_corrections') IS NOT NULL
     OR to_regclass('public.order_refund_effective_verdict') IS NOT NULL THEN
    RAISE EXCEPTION '#473b-1 回退斷言失敗 — 更正表或 view 仍在;拒繼續';
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_correct_order_refund_verdict';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '#473b-1 回退斷言失敗 — 更正 RPC 仍在(% 支);拒繼續', v_cnt;
  END IF;

  -- 5b 🔴 remaining 已經**不再參照** view(這是本腳本最重要的一格:
  --     步 1 忘了跑、或跑了但沒生效,後台會在下一次開訂單頁時當場壞)
  SELECT pg_get_functiondef('public.pcm_order_refundable_remaining(uuid)'::regprocedure) INTO v_def;
  IF v_def LIKE '%order_refund_effective_verdict%' THEN
    RAISE EXCEPTION '#473b-1 回退斷言失敗 — remaining 仍參照已被刪除的 view ⇒ '
                    '訂單頁與異常清單下次呼叫就會爆;拒繼續';
  END IF;

  -- 5b-2 🔴 只驗「不再提 view」不夠(codex 關卡2 nit,我認同):還原成**另一個**不含 view、
  --      但算式或 status 集合寫錯的版本,照樣會通過上面那格。⇒ 連算式一起釘。
  IF v_def NOT LIKE '%r.status IN (''processing'', ''confirmed'')%' THEN
    RAISE EXCEPTION '#473b-1 回退斷言失敗 — 還原後的 remaining 缺 RW1a 的 allowlist 述詞 '
                    '(processing + confirmed)⇒ 還原成了別的版本,「還能退多少」會算錯錢;拒繼續';
  END IF;
  IF v_def NOT LIKE '%o.total::bigint%' THEN
    RAISE EXCEPTION '#473b-1 回退斷言失敗 — 還原後的 remaining 缺 o.total::bigint 起算式;拒繼續';
  END IF;
  -- 🔴 方向:RW1a 版恰有**一段** `- COALESCE(`;本片版有兩段。還原後仍是兩段 = 沒真的還原。
  -- 🔴 大小寫與空白不綁死(codex R2 nit):本檔自己寫回的定義是固定形狀,但 `pg_get_functiondef`
  --    未來若正規化成小寫,綁死大寫會**誤紅**(fail-closed 方向但會擋住正當回退)。改比對正規化後的字。
  IF (length(upper(v_def)) - length(replace(upper(v_def), '- COALESCE(', ''))) / length('- COALESCE(') <> 1 THEN
    RAISE EXCEPTION '#473b-1 回退斷言失敗 — 還原後的 remaining 不是恰一段扣減(RW1a 版應為 1 段);拒繼續';
  END IF;

  -- 5c remaining 的 ACL 沒被 CREATE OR REPLACE 洗掉(正負各一)
  IF NOT has_function_privilege('service_role', 'public.pcm_order_refundable_remaining(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '#473b-1 回退斷言失敗 — service_role 失去 remaining 的 EXECUTE;拒繼續';
  END IF;
  SELECT count(*) INTO v_cnt
    FROM (VALUES ('anon'), ('authenticated'), ('public')) AS x(r)
   WHERE has_function_privilege(x.r, 'public.pcm_order_refundable_remaining(uuid)', 'EXECUTE');
  IF v_cnt > 0 THEN
    RAISE EXCEPTION '#473b-1 回退斷言失敗 — remaining 的 ACL 被洗開了(% 個角色可執行);拒繼續', v_cnt;
  END IF;

  -- 5d order_refunds 從頭到尾沒被本片碰過 ⇒ 這裡只確認它還在、欄位還在
  IF to_regclass('public.order_refunds') IS NULL THEN
    RAISE EXCEPTION '#473b-1 回退斷言失敗 — order_refunds 不見了(本片從未動它,出現此錯代表退錯東西);拒繼續';
  END IF;
END
$assert$;

COMMIT;
