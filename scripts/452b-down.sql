-- ============================================================
-- #452 片 2a-2「乙」· 回退腳本(forward-only 之下的手動 down)
-- ============================================================
-- 標的 = supabase/migrations/20260814180000_m4b_e10_452_2a2b_admin_void_item_procurement.sql
--
-- ── 用法 ────────────────────────────────────────────────
-- **主要路徑(Sean 自己就能做):把本檔【整份】貼進 Supabase Dashboard → SQL Editor 執行。**
--   不需要 psql、不需要任何連線字串。中途任何一行出錯 ⇒ **整個交易回滾,資料庫回到執行前**。
-- 備援路徑(工程端、手上有連線字串時):
--   `psql "<連線字串>" -v ON_ERROR_STOP=1 -f scripts/452b-down.sql`
--   ⚠️ **不要寫 `$DATABASE_URL`** —— `.env.local` 裡沒有這個名字(452a-down.sql 檔頭已數過:`grep -c '^DATABASE_URL=' .env.local` = 0)。
--
-- ── 🔴 為什麼「貼 Dashboard」這條路成立(數法附上,改過本檔就要重數)──
--   🔴 一律只數**可執行區間** = `^BEGIN;$` 那行到 `^COMMIT;$` 那行,不要數整個檔 ——
--      本註解區塊自己就含 psql 變數樣式字,數整檔會把註解當成自己的反例(452a-down.sql 檔頭有實例)。
--      取區間:`B=$(grep -n '^BEGIN;$' 檔|cut -d: -f1) && C=$(grep -n '^COMMIT;$' 檔|cut -d: -f1) && sed -n "$B,${C}p" 檔 | grep -c …`
--   ① 可執行區間內零 psql 變數(`:'name'` 形式)、全檔零反斜線指令(`^\[a-z]`)。
--   ② 頂層 `^BEGIN;$` 與 `^COMMIT;$` 各恰一行,兩行之外沒有非註解非空白的行。
--      (檔內其他 `BEGIN` 都是 plpgsql 區塊的 `BEGIN`,不是交易控制。)
--
-- ── 這支做什麼 / 不做什麼 ──────────────────────────────
--   做:① DROP 那支 void RPC ② DROP 冪等帳本表 ③ 後置斷言。
--   🔴 **不做:不還原 A5a / admin_record_item_receipt。**
--      plan §4.1 寫「還原兩支相鄰 writer」是寫在**甲乙尚未拆分之前**;
--      甲已獨立 apply 並自帶 `scripts/452a-down.sql`,那兩支是**它**的職責。
--      在這裡也做一次 = 兩份腳本互相覆蓋。
--   🔴 **逆序紀律**:要連甲一起退,**先跑本檔、再跑 452a-down.sql**。
--      不必記順序也不會錯 —— `452a-down.sql:80-82` 有一道閘:偵測到
--      `admin_void_item_procurement` 仍存在就 RAISE 拒絕(逐字理由:否則會留下
--      「會產生 voided 列、但相鄰 writer 不認得」的洞)。
--
-- ── 🔴🔴 本檔【刻意不設】「零筆被作廢」前置閘 ────────────
--   甲片的 P5 是那個形狀,但**兩片的回退代價相反**(plan §4.2 fail-DANGEROUS 段):
--     · 2a-1 的回退 = 刪欄 = **資料損失** ⇒「有作廢列就擋」是 fail-safe,對。
--     · 本片的回退 = DROP 一支 RPC + 一張只存冪等帳的表 = **零業務資料損失**
--       ⇒ 同一道閘會變成「**已經有一筆真實作廢之後,就再也關不掉那支會出事的 RPC**」。
--   🔴 **半夜出事時,那正是你最需要關掉它的時刻。**
--   ⇒ 改設**後置斷言**:DROP 之後已作廢的列**維持作廢、逐欄未變**,且沒有 writer 能再動它。
--   ⚠️ 後置斷言也**不得**寫成「voided 列數 = 0」—— 那等於把同一道閘從後門裝回來。
--
-- ── ⚠️ 回退的已知代價(必須寫進 runbook,不是隱藏成本)────
--   帳本表整張 DROP ⇒ **冪等歷史消失**。回退之後,同一個 `request_id` 會被當成**新請求**。
--   已經作廢的列不會因此被作廢第二次(步 6 的 `ALREADY_VOIDED` 接住),
--   但「這個請求做過了」這件事在系統裡查不到了 ⇒ 對帳只能靠 `admin_audit_log`
--   (`action = 'procurement.void'`,那一份不會被本檔刪)。
-- ============================================================

BEGIN;

DO $gate$
DECLARE
  v_cnt bigint;
BEGIN
  -- P1. 那支 RPC 存在(不存在 ⇒ 沒 apply 過或已退過 ⇒ 不要重跑)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_void_item_procurement';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '452b-down P1:admin_void_item_procurement 應恰 1 支,實 % 支 ⇒ 沒 apply 過、已退過、或有多載;拒繼續', v_cnt;
  END IF;

  -- P2. 帳本表存在(與 P1 成對:只剩一半代表有人手動動過,不要在這種狀態下自動修)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'order_item_procurement_void_requests' AND c.relkind = 'r';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '452b-down P2:order_item_procurement_void_requests 應恰 1 張,實 % ⇒ 與 P1 的狀態對不起來,請人工判斷;拒繼續', v_cnt;
  END IF;

  -- P3. 🔴 沒有別的 DB 物件還在引用這支 RPC(本片之後若有人加了東西呼叫它,DROP 會讓那個東西壞掉)
  --     數法 = 掃函式與 procedure 的定義字面,排除它自己。
  -- 🔴 `prokind IN ('f','p')` **不是保險絲,是必要條件**(2026-08-14 在拋棄式 PG 17.10 上實跑撞到):
  --    `pg_get_functiondef` 對**聚合函式**會直接 ERROR「"array_agg" is an aggregate function」
  --    ⇒ 不過濾的話,整個回退腳本在 P3 就炸掉、而且錯誤訊息完全指不到真正的原因。
  --    (a=aggregate / w=window 都要排除;procedure 'p' 有 functiondef,留著。)
  -- 🔴 codex 關卡2 F8:~~原本只掃 `nspname = 'public'`~~ ⇒ 別的 schema 裡的 wrapper 會漏掉。
  --    改掃**所有非系統 schema**。⚠️ 誠實邊界:**動態 SQL 組出來的呼叫仍然掃不到**
  --    (`EXECUTE 'select ' || fn` 這種),那是字面掃描的先天限制,不是這一行能補的。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND n.nspname NOT LIKE 'pg_toast%'
     AND n.nspname NOT LIKE 'pg_temp%'
     AND p.prokind IN ('f', 'p')
     AND p.proname <> 'admin_void_item_procurement'
     AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%admin_void_item_procurement%';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '452b-down P3:有 % 支其他函式的定義提到 admin_void_item_procurement ⇒ 2a-2 乙之後有新東西依賴它,DROP 會弄壞它們;停下人工判斷', v_cnt;
  END IF;

  RAISE NOTICE '452b-down 前置閘 P1-P3 全過(刻意無「零筆被作廢」閘,理由見檔頭)。';
END
$gate$;

-- ── 步 0. 先拍下已作廢列的快照(後置斷言要用)────────────
-- 🔴 用臨時表而不是變數:要比對的是**逐欄未變**,不是筆數。
-- 🔴 codex 關卡2 F9:~~原本只存 id / voided_at / void_reason~~ ⇒ 回退過程若動到
--    `allocated_quantity` / `received_quantity` / `supplier_id` / `order_item_id`,
--    A3/A3b 照樣全綠 = **只驗了「作廢欄」沒變,卻宣稱「業務資料沒被動」**。
--    ⇒ 存下這幾列的**全部業務欄**。(本檔理應一欄都不動,所以全欄比對零誤報成本。)
CREATE TEMP TABLE pcm_452b_voided_before ON COMMIT DROP AS
  SELECT id, order_item_id, supplier_id, allocated_quantity, received_quantity, voided_at, void_reason
    FROM public.order_item_procurement
   WHERE voided_at IS NOT NULL;

-- ── 步 1. DROP 那支 RPC(拿掉唯一的 voided writer)──────────
-- 🔴 先 DROP RPC 再 DROP 帳本表:反過來的話,DROP 表與 DROP 函式之間函式的定義會指向一張不存在的表。
--    整支包在單一交易裡 ⇒ 這個中間狀態外部 session 看不見,
--    但**交易內的後續語句與後置斷言會踩到它**,而且值班者的心智模型要能單向推(plan §4.1 R1 nit 折)。
DROP FUNCTION public.admin_void_item_procurement(uuid, text, text, text);

-- ── 步 2. DROP 冪等帳本表 ─────────────────────────────────
-- 它只存冪等帳、零業務資料(代價見檔頭「回退的已知代價」)。
DROP TABLE public.order_item_procurement_void_requests;

-- ── 步 3. 後置斷言 ────────────────────────────────────────
DO $post$
DECLARE
  v_cnt   bigint;
  v_diff  bigint;
BEGIN
  -- A1. RPC 已消失
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_void_item_procurement';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '452b-down 後置 A1:RPC 仍在(% 支)', v_cnt;
  END IF;

  -- A2. 帳本表已消失(回退後再前推時 CREATE TABLE 才不會撞既有物件)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'order_item_procurement_void_requests';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '452b-down 後置 A2:帳本表仍在';
  END IF;

  -- A3. 🔴🔴 **已作廢的列維持作廢,而且逐欄未變。**
  --     ⚠️ **這裡刻意【不】斷言「voided 列數 = 0」** —— 那會把 fail-DANGEROUS 的閘從後門裝回來,
  --        讓「第一筆真實作廢之後」的回退在這一行 RAISE,而那正是最需要關掉功能的時刻。
  SELECT count(*) INTO v_diff FROM (
    SELECT * FROM pcm_452b_voided_before
    EXCEPT
    SELECT id, order_item_id, supplier_id, allocated_quantity, received_quantity, voided_at, void_reason
      FROM public.order_item_procurement WHERE voided_at IS NOT NULL
  ) d;
  IF v_diff <> 0 THEN
    RAISE EXCEPTION '452b-down 後置 A3:有 % 列已作廢紀錄在回退過程中被改動或消失 ⇒ 本回退不該碰任何業務資料', v_diff;
  END IF;
  -- 反向也要比(EXCEPT 是單向的:只比一邊的話,回退中途「多長出一列作廢」看不出來)
  SELECT count(*) INTO v_diff FROM (
    SELECT id, order_item_id, supplier_id, allocated_quantity, received_quantity, voided_at, void_reason
      FROM public.order_item_procurement WHERE voided_at IS NOT NULL
    EXCEPT
    SELECT * FROM pcm_452b_voided_before
  ) d;
  IF v_diff <> 0 THEN
    RAISE EXCEPTION '452b-down 後置 A3b:回退過程中多出 % 列已作廢紀錄 ⇒ 不該發生', v_diff;
  END IF;

  -- A4. 🔴 沒有任何函式還會【寫】voided_at。
  -- 🔴🔴 codex 關卡2 F10 抓到:~~本格原本只有一段註解 + 一句「A1-A4 全過」的 NOTICE,
  --      **零查詢、零斷言**~~ ⇒ 那正是本 repo 今天的母題「什麼都沒有被讀成檢查過了」。
  --      我在同一個檔裡一邊寫「後置斷言」一邊宣稱一個沒有量過的東西。已補上真的查詢。
  -- 量法:掃所有非系統 schema 的函式/procedure 定義,找 **UPDATE 的賦值形式** `SET voided_at`。
  --   ⚠️ 誠實邊界:①只認這一種字面形式(`UPDATE … SET voided_at = …`);
  --     動態 SQL 組出來的、或走 `EXECUTE format(...)` 的寫入**掃不到** ②只看函式,
  --     直接下 SQL 的人本來就不受任何守門管。⇒ 這格證明的是「**沒有留下會寫它的函式**」,
  --     不是「這個欄位從此不可能被寫」。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND n.nspname NOT LIKE 'pg_toast%'
     AND n.nspname NOT LIKE 'pg_temp%'
     AND p.prokind IN ('f', 'p')
     AND pg_catalog.pg_get_functiondef(p.oid) ~ 'SET\s+voided_at';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '452b-down 後置 A4:仍有 % 支函式會寫 voided_at ⇒ 回退沒有真的拿掉 voided writer;停下人工判斷', v_cnt;
  END IF;

  RAISE NOTICE '452b-down 後置 A1-A4 全過(RPC 與帳本表已消失;已作廢列全業務欄未變,雙向 EXCEPT 皆 0;零函式會寫 voided_at)。';
END
$post$;

COMMIT;
