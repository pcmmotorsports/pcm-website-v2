-- 20260913040000 · M-4b 發票金額月統計 **P1a**:`orders` 加一欄 `invoice_issued_at`(**只加欄, 不加 CHECK**)。
--
-- 🛑🛑 **未貼。** 貼的人是 Sean(或他明文授權的那一個編號)。
--
-- ══════════════════════════════════════════════════════════════════
-- 🔴🔴 為什麼是 P1a —— **CHECK 被拆出去了, 而那是 codex 一條 must-fix 換來的**
-- ══════════════════════════════════════════════════════════════════
-- ⛔ ~~我第一版把欄與 CHECK(`issued ⇒ 一定要有日期`)放同一支, 檔頭寫「貼了而 P2 還沒上 ⇒ 零影響」~~
-- 🔴 **那句是假的**(codex `gpt-6-astra` 2026-09-13 must-fix 1, 我開檔核過):
--    既有 RPC `admin_update_order_workflow` 的白名單只有四欄、**不寫日期**
--    (`20260716130000:232` 白名單 / `:335` 起 UPDATE 逐字)
--    ⇒ 貼了 CHECK 而 P2 還沒上 ⇒ 員工把一張單標成「已開立」⇒ **必定撞 CHECK ⇒ 登記功能整個壞掉**。
--    退回舊碼而留著 CHECK 也一樣壞。📌 **中間狀態不是零影響, 是【既有功能停擺】。**
-- ✅ **拆成兩支, 順序不能反**:
-- ```
-- P1a(本支)     加欄。nullable、無 DEFAULT ⇒ 舊 RPC 照舊能寫 issued(日期留 NULL)⇒ 【真的】零影響
-- P2             RPC 改成「issued 一定要帶日期」(SQL migration)+ 表單多一格(TS)—— 一起上
-- P1b(另一支)   加 CHECK。前置閘:issued 而無日期 = 0 —— 這時 P2 已經在寫日期, 那個 0 才守得住
-- ```
-- 🛑 **P1b 不可以早於 P2 貼**, 理由就是上面那條。
--
-- ══════════════════════════════════════════════════════════════════
-- 🔴 型別:`date`, 不是 `timestamptz` —— **偏離 plan 字面, 而理由是技術事實不是偏好**
-- ══════════════════════════════════════════════════════════════════
-- plan / 規格寫 `timestamptz NULL`。codex must-fix 4 指出兩個可重現的錯月:
--   ① 員工填 10/1 ⇒ 存成 `2026-10-01 00:00+08` = UTC `9/30 16:00` ⇒ 若用 UTC 分月 ⇒ **算進 9 月**
--   ② 訂單台北 10/1 上午 10 點建立, 同日開票轉成零時 ⇒ 直接比 `< created_at` ⇒ **錯擋合法登記**
-- ⇒ 用 `timestamptz` 的話, P2 的範圍檢查、P3 的分月、每一個讀它的地方**都要各自記得 `Asia/Taipei`**,
--    而那正是「三份規則各自漂」的形狀。
-- ✅ **`date` 沒有時區** —— 員工填的本來就是一個日曆日(他手上那張紙上的日期),
--    `date_trunc('month', d)` 直接對、`d < (created_at AT TIME ZONE 'Asia/Taipei')::date` 只有一處要轉。
-- ⚠️ **這是一個偏離已批 plan 字面的決定** ⇒ 已回報主視窗;他若裁回 `timestamptz`, 改這一行 + 事後閘①d 即可。
-- 🔵 欄名照 plan 留 `invoice_issued_at`(規格、plan、討論全用這個名字;改名的漣漪比一個 `_at` 尾綴大)。
--
-- ══════════════════════════════════════════════════════════════════
-- 為什麼要這一欄(plan `docs/plans/2026-09-13-invoice-issued-at-monthly-stats-plan.md`, Sean 2026-09-13 批)
-- ══════════════════════════════════════════════════════════════════
-- Sean 逐字「Q3: 乙 = 按【發票開立】的月份 ⇒ 要加一個欄位(碰資料庫、要先寫計畫)」。
-- 他要看「我這個月開了多少發票金額」, 而系統今天**記不到發票是哪一天開的**
-- (`invoice_status` 三值有狀態沒時間, `20260714120000:108`)。
-- 🛑 **前提**:發票是**手寫紙本**(二聯 / 三聯), **不串任何外部系統**。Sean 逐字「我們目前是手開發票」。
--    號碼與金額是**開完之後回到後台登記** ⇒ 本欄記的是**那個登記動作裡員工手填的日期**。
--
-- ══════════════════════════════════════════════════════════════════
-- 🔴 這一欄什麼時候被寫、被誰寫 —— **這才是內容, ADD COLUMN 只是結果**
-- ══════════════════════════════════════════════════════════════════
-- ① **員工手填(Sean Q1 乙)。🛑 不可以 `DEFAULT`、不可以由 trigger 蓋。**
--    他是**事後補登記**的 ⇒ 自動蓋蓋到的是【按鍵那天】不是【開票那天】
--    ⇒ 一張 9/28 開、10/2 才登記的發票會算進 10 月。⇒ 本欄**無 DEFAULT**, 事後閘①c 釘它。
-- ② **必填(Sean Q5 甲)擋三層**:表單 · RPC · DB CHECK(**P1b**)。三層不是重複 ——
--    少了 DB 那層, 一個未來的 writer 或一次手動 SQL 就能造出「已開立而沒日期」的列, 而統計會安靜地少算它。
-- ③ **「必填」≠「不能改」**(Q6 甲 = 每次覆蓋)。📌 下一個人會把「必填」讀成「寫死不准動」而去加鎖 ——
--    本支**沒有**任何擋 UPDATE 的東西, 而那是刻意的。舊值走 `admin_audit_log`。
-- ④ 🔴 **P2 的 RPC 必須要求「每一次變成 issued 都【明確】帶日期」, 不能拿列上既有的非 NULL 代替**
--    (codex must-fix 3):9/28 開 → 作廢而日期留著 → 10/5 重開只改狀態號碼金額 ⇒ 日期仍是 9/28
--    ⇒ CHECK 放行 ⇒ **重開的金額回到 9 月**。CHECK 擋不到這一格, 只有 RPC 擋得到。
--    ⚠️ 而**不應要求新舊日期不同** —— 同日重開仍合法。
-- ⑤ **作廢重開會讓過去月份的數字變動** ⇒ 對的(Q2 甲), 而統計頁要常駐一行灰字講它(P3)。
-- ⑥ 🛑 **紙本作廢的實務是收回整份蓋作廢章, 而系統只有一個狀態值** ⇒ 記不到那張紙收回來了沒。
--    不設計假的追蹤(一個「已收回」的勾只證明有人勾了它)。寫進 COMMENT。
--
-- ══════════════════════════════════════════════════════════════════
-- 🔬 讀數 —— 2026-09-13 19:xx B 窗自己對正式庫唯讀跑的(不是抄規格)
-- ══════════════════════════════════════════════════════════════════
-- ```
-- issued_total                                     ⇒ 0   ← P1b 的前置閘;本支不需要它
-- inclusive_with_tax(inclusive AND tax_total<>0)   ⇒ 0   ← P3 算式的假設;不是本支的閘
-- 🔬 正對照 inclusive AND tax_total=0               ⇒ 8 · 全庫 9 · not_issued 9 / issued 0 / voided 0
--          欄 invoice_issued_at 存在                 ⇒ 0(前置閘②的前提)
-- ```
--
-- ══════════════════════════════════════════════════════════════════
-- 🔬 ACL(2026-09-13 唯讀實查 `orders`)—— **新欄要與姊妹欄 `invoice_status` 對等**
-- ══════════════════════════════════════════════════════════════════
-- ```
-- role           SELECT(invoice_status)  UPDATE(invoice_status)
-- anon           f                       f
-- authenticated  t                       f     ← 客人看自己的單(RLS 管列), 看得到欄
-- service_role   t                       f     ← 🔴 連 service_role 都【沒有】直接 UPDATE ⇒ 寫入只能走 RPC
-- ```
-- ⇒ 事後閘② 問的是**對等**, 不是「anon 讀不到」那種絕對句(那會擋住 authenticated 這個合法狀態)。
--
-- ══════════════════════════════════════════════════════════════════
-- 冪等:本支【沒有頂層 DML】⇒ 貼板那道冪等宣告閘不會叫 ⇒ 本支不宣告 `pcm:idempotent`。
-- 重跑 ⇒ **兩道, 按撞到的順序**:① 前置閘②(欄已在 ⇒ RAISE)② ADD COLUMN 撞 42701。
-- 兩道都在同一個 BEGIN…COMMIT 裡 ⇒ 任一道炸 ⇒ 整包回滾。
-- 🛑 兩道全拆(刪前置閘② + ADD COLUMN IF NOT EXISTS)⇒ 第二次跑會【成功而什麼都不做】——
--    本支刻意不做成那樣:帳本(`schema_migrations`)只記一次, 一支安靜成功的重跑會讓「貼過了沒」失去證據。
--
-- ══════════════════════════════════════════════════════════════════
-- 部署順序:P1a(本支)→ P2(RPC migration + TS 一起)→ P1b(CHECK)。**本支貼了、P2 還沒上 ⇒ 真的零影響**:
-- 舊 RPC 不碰這一欄, 它留 NULL;沒有任何 CHECK 讀它。
--
-- ══════════════════════════════════════════════════════════════════
-- 回退(可執行)
-- ══════════════════════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
-- ALTER TABLE public.orders DROP COLUMN invoice_issued_at;   -- ⛔ 會丟員工填過的開票日
-- 🔴 那一行 `lock_timeout` 不是樣板:回退是【人貼進 psql】跑的, psql 預設**無限等鎖**。
-- ✅ 正確的回退單位是【碼】(P2 / P3):讓畫面與 RPC 不再碰它, 欄留著。
-- 🔴 P1b 貼了之後要退本支 ⇒ **先退 P1b 的 CHECK 再退欄**(依賴順序)。

BEGIN;

-- 🔴 等鎖最多 5 秒 —— `ADD COLUMN` 取 `ACCESS EXCLUSIVE` 並持有到 COMMIT;不重寫整張表 ⇒ 瞬間,
--    而等待期仍可能排在別的交易後面。
SET LOCAL lock_timeout = '5s';

DO $precondition$
DECLARE
  v_cnt   int;
  v_check text;
BEGIN
  -- 前置閘①:那張表要在
  IF pg_catalog.to_regclass('public.orders') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.orders';
  END IF;

  -- 前置閘②:forward-only —— 欄已存在就拒重跑
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.orders'::regclass
     AND a.attname = 'invoice_issued_at'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '前置閘②:invoice_issued_at 已存在 ⇒ forward-only,拒重跑';
  END IF;

  -- 🔴 前置閘③:姊妹欄 `invoice_status` 與它的三值 CHECK 要在, 而且 `'issued'` 在值域裡 ——
  --    本欄的整個語意綁著「issued 才需要日期」;那個狀態不存在, 本欄就沒有意義。
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_check
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.orders'::regclass
     AND c.conname = 'orders_invoice_status_check';
  IF v_check IS NULL THEN
    RAISE EXCEPTION '前置閘③:找不到 orders_invoice_status_check(20260714120000:116)⇒ 值域不明,停';
  END IF;
  IF pg_catalog.strpos(v_check, '''issued''') = 0 THEN
    RAISE EXCEPTION '前置閘③:orders_invoice_status_check 的值域裡沒有 issued [%]', v_check;
  END IF;
END
$precondition$;

-- 🔴 **`date`、NULL-able、無 DEFAULT**(型別的理由見檔頭;無 DEFAULT 的理由見檔頭 ①)。
ALTER TABLE public.orders
  ADD COLUMN invoice_issued_at date;

-- 🔴 本文用 dollar-quoted 而不是單引號 —— 單引號字串裡若有【行尾的 ASCII 分號】,
--    Supabase SQL Editor 會在字串中間切一刀 ⇒ 貼下去 42601, 而本機與拋棄式 PG 全綠。
COMMENT ON COLUMN public.orders.invoice_issued_at IS
  $c$發票【開立日】—— 員工在後台登記發票時**手填**的日曆日(2026-09-13, Sean Q1 乙)。
🔴 它**不是**登記時間:他是開完發票之後回來補登記的, 自動蓋時間戳蓋到的是按鍵那天不是開票那天
⇒ 一張 9/28 開、10/2 登記的發票會被算進 10 月。**所以本欄無 DEFAULT、無 trigger, 永遠由人填。**
🔴 型別是 `date` 不是 `timestamptz`:他填的是紙上那個日曆日, 沒有時區;用 timestamptz 會讓
分月與範圍檢查每一處都要各自記得 Asia/Taipei, 而三份規則會各自漂。
🔴 **必填(Q5 甲)而可改(Q6 甲)**:`invoice_status = 'issued'` 時本欄不得為 NULL ——
表單與 RPC(P2)擋, DB CHECK 由 P1b 加(它必須在 P2 之後貼, 否則舊 RPC 每一次登記都會撞它)。
之後仍可覆蓋成新的日期, 舊值在 admin_audit_log。🛑 下一個人不要把「必填」讀成「寫死不准動」而去加鎖。
🔴 **每一次變成 issued 都要【明確】帶日期, RPC 不能拿列上既有的值代替** —— 作廢而日期留著、
10 月重開沒填新日期 ⇒ 重開的金額會回到 9 月。同日重開合法, 不要求新舊不同。
🔴 **作廢重開會覆蓋本欄 ⇒ 過去月份的統計會跟著變**(Q2 甲:作廢不算、重開才算), 統計頁常駐一行灰字講它。
🛑 **紀錄範圍的邊界**:紙本作廢的實務是收回整份、蓋作廢章, 而系統只有一個狀態值 `voided`
⇒ **本表記不到那張紙有沒有真的收回來。** 不要用一個勾選框假裝解決它。
🔵 發票是手寫紙本, 不串任何外部系統;本欄只記【登記動作裡員工手填的那個日期】。$c$;

DO $postcheck$
DECLARE
  v_notnull boolean;
  v_default text;
  v_type    text;
  r         text;
  v_sib     boolean;
  v_new     boolean;
BEGIN
  -- 事後閘①:欄在, 而且是 nullable、無 DEFAULT、型別是 date
  SELECT a.attnotnull,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid),
         pg_catalog.format_type(a.atttypid, a.atttypmod)
    INTO v_notnull, v_default, v_type
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.orders'::regclass
     AND a.attname = 'invoice_issued_at'
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_notnull IS NULL THEN
    RAISE EXCEPTION '事後閘①:加完找不到 invoice_issued_at';
  END IF;
  IF v_notnull THEN
    RAISE EXCEPTION '事後閘①b:它是 NOT NULL ⇒ 9 張 not_issued 的單會被擋, 而它們本來就沒有日期';
  END IF;
  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION '事後閘①c:它有 DEFAULT [%] ⇒ 自動蓋的是按鍵那天不是開票那天, 那正是 Sean Q1 乙 不要的', v_default;
  END IF;
  IF v_type <> 'date' THEN
    RAISE EXCEPTION '事後閘①d:型別是 [%] 而不是 date(理由見檔頭:日曆日沒有時區)', v_type;
  END IF;

  -- 🔴🔴 事後閘②:**ACL 對等** —— 新欄對三個角色的答案要與姊妹欄 `invoice_status` 完全相同。
  --    ⛔ 不寫「anon 讀不到」那種絕對句:authenticated **本來就讀得到** orders(客人看自己的單)。
  --    🔴 用 `has_column_privilege`(`has_table_privilege` 對欄級授權會少報, 2026-09-05 實錘)。
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    v_sib := pg_catalog.has_column_privilege(r, 'public.orders', 'invoice_status', 'SELECT');
    v_new := pg_catalog.has_column_privilege(r, 'public.orders', 'invoice_issued_at', 'SELECT');
    IF v_sib IS DISTINCT FROM v_new THEN
      RAISE EXCEPTION '事後閘②a:% 對 SELECT 的答案不對等(invoice_status=% / invoice_issued_at=%)', r, v_sib, v_new;
    END IF;
    v_sib := pg_catalog.has_column_privilege(r, 'public.orders', 'invoice_status', 'UPDATE');
    v_new := pg_catalog.has_column_privilege(r, 'public.orders', 'invoice_issued_at', 'UPDATE');
    IF v_sib IS DISTINCT FROM v_new THEN
      RAISE EXCEPTION '事後閘②b:% 對 UPDATE 的答案不對等(invoice_status=% / invoice_issued_at=%)', r, v_sib, v_new;
    END IF;
  END LOOP;
  -- 🟢 事後閘②c(**正對照**):這把尺對 anon 要答 false、對 authenticated 要答 true(2026-09-13 讀數)
  --    —— 📌 少了這一格, 「對等」在「兩邊都壞掉」的世界裡也會過。
  IF pg_catalog.has_column_privilege('anon', 'public.orders', 'invoice_issued_at', 'SELECT') THEN
    RAISE EXCEPTION '事後閘②c(正對照):anon 讀得到 invoice_issued_at ⇒ 與 2026-09-13 的讀數不符, 停下人工確認';
  END IF;
  IF NOT pg_catalog.has_column_privilege('authenticated', 'public.orders', 'invoice_issued_at', 'SELECT') THEN
    RAISE EXCEPTION '事後閘②c(正對照):authenticated 讀不到 invoice_issued_at ⇒ 客人的訂單頁會少一欄, 停下人工確認';
  END IF;
  -- 🔵 事後閘②d(**負對照**):同一把尺問一個現造的欄名 —— 它必須炸。
  BEGIN
    IF pg_catalog.has_column_privilege('service_role', 'public.orders', 'zzz_never_a_column', 'SELECT') THEN
      RAISE EXCEPTION '事後閘②d(負對照):現造的欄名居然回 true ⇒ 這把尺壞了, 上面的對等不可信';
    END IF;
  EXCEPTION WHEN undefined_column THEN
    NULL; -- ✅ 預期
  END;

  -- 🔴 事後閘③:**本支【不准】帶 CHECK** —— 那是 P1b 的事, 而它必須在 P2 之後。
  --    📌 有人「順手」把 CHECK 加回本支 ⇒ 這一格叫 ⇒ 檔頭那條 must-fix 的病就不會回來。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
              WHERE conrelid = 'public.orders'::regclass
                AND conname = 'orders_invoice_issued_at_required') THEN
    RAISE EXCEPTION '事後閘③:本支不該帶 orders_invoice_issued_at_required ⇒ 那是 P1b, 必須在 P2 之後貼, 否則舊 RPC 每一次登記都撞它';
  END IF;

  -- 🔵 事後閘④:只打算加這一欄 —— 黑名單擋幾個最可能的同義欄(誠實標:不是白名單, 換個名字擋不到)。
  IF EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = 'public.orders'::regclass
          AND a.attnum > 0 AND NOT a.attisdropped
          AND a.attname IN ('invoice_date', 'invoiced_at', 'invoice_issue_date', 'invoice_issued_on')
     ) THEN
    RAISE EXCEPTION '事後閘④:出現了不該有的同義欄 ⇒ 一個事實兩個欄位, 兩份會漂';
  END IF;

  RAISE NOTICE '20260913040000(P1a)落地:invoice_issued_at date, nullable, 無 DEFAULT;ACL 與 invoice_status 對等;CHECK 留給 P1b';
END
$postcheck$;

COMMIT;
