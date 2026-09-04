-- ============================================================
-- M-4b `⟦b4-INVOICE5PCT⟧` Q3(重問後的版本):
--   **`orders.invoice_requested` 一旦是 `false`(決定不開發票), 不得再改回 `true`。**
-- ============================================================
-- 🔴 **拍板**(逐字落檔 `~/pcm-mailbox/Sean拍板-20260904-七題.md`):
--   · 第十八題(重問)Sean 拍 **甲 = 「用現在就有的那一欄『這張單要不要開發票』」**。
--   · 第十六題 Sean 拍 **甲 = 「任何改動都擋(要改 ⇒ 作廢重開)」**
--     (推薦理由「乙可以分兩步繞過, 等於沒鎖」是**主視窗 `-94` 擬的**, 他選了甲 —— **不要寫成「Sean 說」**)。
--   ⇒ 兩題合起來 = **本檔**:鎖套在 `invoice_requested` 上, 方向是 **`false` ⇒ `true` 擋下**。
--
-- 🔬 **語意權威是那一欄自己的 `COMMENT`**(`20260828100000:258` 起, 逐字):
--   「這張單【要不要】開發票 —— 下單當下的決定。」`true` = 要開(DEFAULT)· `false` = 不開。
--
-- 🔵 **為什麼是這一欄, 而不是我先前那支(`invoice_status` 加第四值 `not_required`)**:
--   🔴 **那支【作廢了】** —— 第三輪換角度審查抓到:**這件事這張表上已經有一欄了, 而且 Sean 2026-09-03 本人貼過。**
--   ⇒ 📌 **而我寫給他的選項表把「加一欄」寫成假想方案、取了另一個名字, 全篇沒說那一欄已經存在**
--      ⇒ **他第一次批的「好」, 是對一份前提錯的選項表說的。** 重問之後他改選這一案。
--   ⚠️ **成因寫在這裡, 因為它會再發生**:我掃了 `invoice.type`(68 處)與 `invoice_status`(43 處)
--      ⇒ 🎯 **我掃了兩個【我自己挑的名字】, 而沒有問「這張表上還有哪些 `invoice` 開頭的欄」。**
--
-- 🔵 **而這一案結構上比前一案安全一格, 而那一格沒有人講過**:
--   `invoice_requested` 是**布林** ⇒ **沒有中間值** ⇒ 🎯 **第十六題那個「分兩步繞過」在本案【不存在】**
--   (前一案的 `not_required → not_issued → issued` 兩步都合法;這裡 `false → true` 是唯一的出口)。
--
-- ⚠️ **今天的觸發條件是零** —— 正式庫實查:那一欄 **1 列, 全部是 `true`**;
--    而**沒有任何一條路寫 `false`**(那要等本片第 2 步:手動建單的勾選)。
--    🛑 **而那不是「先不做」的理由**:鎖要先在, 第一個 `false` 才有東西守。
--
-- 🔴 **鐵則 12③**(DB 結構)⇒ codex 對抗審查。**鐵則 8** ⇒ 本案由 Sean 本人拍。
-- 📎 兩道 REVOKE 的基線照 `docs/patterns/revoking-function-execute-in-supabase.md`。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- 🔴 **先取鎖, 再檢查** —— 中間有窗口的話, 我會對著一個沒檢查過的狀態動手。
LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE;

-- ── 前置閘 ──────────────────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_type    text;
  v_notnull boolean;
  v_default text;
BEGIN
  SELECT a.atttypid::regtype::text, a.attnotnull, pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    INTO v_type, v_notnull, v_default
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.orders'::regclass
     AND a.attname  = 'invoice_requested'
     AND NOT a.attisdropped;

  IF v_type IS NULL THEN
    RAISE EXCEPTION
      '前置閘:public.orders 上沒有 invoice_requested 這一欄 ⇒ 本檔要鎖的東西不存在, 停。'
      '(它應該由 20260828100000 建立;那一支沒貼的話, 先貼它。)';
  END IF;
  -- 🔴 逐格比對, 不用子字串 —— `issued` 曾經被 `not_issued` 吃掉過(同片前一支的 must-fix)。
  IF v_type <> 'boolean' OR v_notnull IS NOT TRUE OR v_default IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION
      '前置閘:invoice_requested 的定義不是本檔預期的那一版 ⇒ 實際 型別=% / NOT NULL=% / DEFAULT=% ⇒ 停。',
      v_type, v_notnull, v_default;
  END IF;

  -- 🔴🔴 **撞名要報錯, 不要靜靜覆寫**(`revoking-function-execute-in-supabase.md` §3.2)
  --
  -- 🔴🔴 **而「已經貼過了」與「守門【壞掉了】」不可以印同一句**(codex 對抗審查 must-fix, 它是對的):
  --    ⛔ ~~我上一版一看到函式存在就印「本檔已經貼過一次了, 你不用做任何事」~~
  --    ⇒ 🎯 **函式在、而 trigger 被刪掉 / 停用 / 綁錯的那個世界, 也會印那句話**
  --    ⇒ 🔴 **Sean 會把紅字讀成「正常, 重貼而已」, 而實際上守門已經不存在。**
  --    📌 **⇒ 這個洞是我【修上一個 finding 的時候造出來的】** —— 上一輪 codex 說「訊息要讓不寫程式的人讀得懂」,
  --       我把它改得友善, 而**友善的那句話同時覆蓋了一個災難的世界**。
  --    ✅ ⇒ 先分辨兩個世界, 再決定印哪一句。
  IF pg_catalog.to_regprocedure('public.pcm_invoice_requested_false_is_final()') IS NOT NULL THEN
    -- 函式在 ⇒ 那 trigger 呢?整組都在而且完好 ⇒ 才是「貼過了」。
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
       WHERE t.tgrelid  = 'public.orders'::regclass
         AND t.tgname   = 'zzz_pcm_invoice_requested_false_is_final'
         AND NOT t.tgisinternal
         AND t.tgfoid   = 'public.pcm_invoice_requested_false_is_final()'::regprocedure
         AND t.tgtype   = 17          -- AFTER + ROW + UPDATE
         AND t.tgqual   IS NULL
         AND t.tgattr::text = ''
         AND t.tgenabled = 'A'
    ) THEN
      RAISE EXCEPTION
        '前置閘:本檔【已經貼過一次了, 而且守門是完好的】。'
        '⇒ 🔵 **這是正常的, 你不用做任何事。**';
    ELSE
      -- 🔴 函式在、而 trigger 不在或不對 ⇒ **這是壞掉, 不是重貼。**
      RAISE EXCEPTION
        '🔴🔴 前置閘:函式在, 而【那道守門不見了或被改壞了】—— 這【不是】正常的重貼。'
        '⇒ 可能是 trigger 被刪掉 / 被停用(DISABLE)/ 綁到別的函式 / 被改成別的事件。'
        '⇒ 🛑 **請找人來看, 不要重貼本檔**(重貼會卡在這裡, 因為函式已經存在)。';
    END IF;
  END IF;
END
$pre$;

-- ── 守門 ────────────────────────────────────────────────────────────────────
-- 🔴 **`AFTER UPDATE` 不是 `BEFORE`**:`BEFORE` 依名字順序跑
--    ⇒ 一支名字排在後面的 `BEFORE` trigger 可以在我檢查【之後】把值改回 `true`。
--    `AFTER` 看到的是**最後要落地的那一列**。而名字的 `zzz_` 前綴是**第二道獨立防線**。
CREATE FUNCTION public.pcm_invoice_requested_false_is_final()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
  IF OLD.invoice_requested IS FALSE AND NEW.invoice_requested IS TRUE THEN
    RAISE EXCEPTION
      '這張單建單時決定不開發票, 要改請作廢重開。(訂單 %)', OLD.display_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;  -- AFTER trigger 的回傳值被忽略
END
$fn$;

-- 🔴 **兩道 REVOKE, 少一道都是開的**
REVOKE ALL ON FUNCTION public.pcm_invoice_requested_false_is_final() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_invoice_requested_false_is_final() FROM anon, authenticated;
-- ⚠️ **不 GRANT 給任何人** —— trigger 函式由 PG 以 owner 身分呼叫, 沒有人需要直接執行它。

COMMENT ON FUNCTION public.pcm_invoice_requested_false_is_final() IS
  'orders.invoice_requested 的終局守門:false ⇒ true 擋下(Sean 2026-09-04 第十六題拍甲「任何改動都擋, 要改就作廢重開」;推薦理由由主視窗 -94 擬)。🔵 布林沒有中間值 ⇒ 沒有「分兩步繞過」那條路。🔴 AFTER 不是 BEFORE:BEFORE 依名字順序跑,排在後面的 trigger 可以在檢查之後改掉那個值。';

CREATE TRIGGER zzz_pcm_invoice_requested_false_is_final
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.pcm_invoice_requested_false_is_final();

-- 🔴 **`ENABLE ALWAYS`**:預設 `tgenabled='O'` ⇒ `SET session_replication_role='replica'` 就繞過去。
-- ⚠️ **它不是防攻擊的門** —— owner 仍然 `DISABLE` / `DROP` 得掉;它防的是**一個開了 replica 模式而不自知的批次腳本**。
-- ⚠️ **運維註記**:`ALWAYS` 在 logical replication subscriber 上也會執行(違規資料可能讓 apply 停住);
--    **data-only restore** 也會觸發, 而 `--disable-triggers` 之後要回頭確認它仍是 `A`。
ALTER TABLE public.orders ENABLE ALWAYS TRIGGER zzz_pcm_invoice_requested_false_is_final;

-- ── 落地斷言 ───────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_t   pg_catalog.pg_trigger%ROWTYPE;
BEGIN
  SELECT * INTO v_t FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.orders'::regclass
     AND t.tgname  = 'zzz_pcm_invoice_requested_false_is_final'
     AND NOT t.tgisinternal;
  IF v_t.tgname IS NULL THEN
    RAISE EXCEPTION '落地斷言失敗:trigger 不在 orders 上';
  END IF;
  IF v_t.tgfoid <> 'public.pcm_invoice_requested_false_is_final()'::regprocedure THEN
    RAISE EXCEPTION '落地斷言失敗:trigger 綁的不是本檔那支函式 ⇒ 實際 %', v_t.tgfoid::regprocedure;
  END IF;
  -- tgtype:bit0=ROW · bit4=UPDATE ⇒ AFTER+ROW+UPDATE = 1 + 16 = 17
  IF v_t.tgtype <> 17 THEN
    RAISE EXCEPTION '落地斷言失敗:不是 AFTER UPDATE FOR EACH ROW ⇒ tgtype=%', v_t.tgtype;
  END IF;
  IF v_t.tgqual IS NOT NULL THEN
    RAISE EXCEPTION '落地斷言失敗:帶了 WHEN 條件 ⇒ 一個永假的 WHEN 等於沒有守門';
  END IF;
  IF v_t.tgattr::text <> '' THEN
    RAISE EXCEPTION '落地斷言失敗:帶了欄位限定(UPDATE OF …)⇒ 前面的 trigger 改掉該欄時它不會觸發';
  END IF;
  IF v_t.tgenabled <> 'A' THEN
    RAISE EXCEPTION '落地斷言失敗:不是 ENABLE ALWAYS ⇒ session_replication_role=replica 繞得過去';
  END IF;

  -- 收權那半改用 repo 的具名清單形狀 —— 見本檔下方 $newobj_guard$。
  --    🔴 **而那不是風格問題**:`scripts/migration-static-checks.sh:573` 那道閘**數的是【那份清單】**,
  --    不是我寫了幾行斷言 ⇒ 📌 **它防的是「忘記【列】」, 而不是「忘記【收】」** ——
  --    我第一版把 ACL 檢查寫成內聯, 收權其實做對了, **而閘照樣紅, 且它紅得對**:
  --    **一份沒有清單的斷言, 下一個人加了第二個物件時不會有東西提醒他。**

  -- ⚠️⚠️ **本檔【沒有】寫入探針, 而那是刻意的**(同片前一支的 codex must-fix):
  --   ① 它會改到**真的訂單** ② 回滾撤不回外部副作用
  --   ③ 🔴 一個吞「任何 `check_violation`」的正對照, **會替它要驗的東西背書**
  --      (別的 CHECK 擋下時, 本守門失效也印綠)。
  --   ✅ 行為的證明放在**拋棄式 PG**, 而**那份 fixture 的射程**要一起讀:
  --      它沒有正式表的其他 CHECK / trigger / RLS / 權限
  --      ⇒ **證得到「這道 trigger 自己會動」, 證不到「在正式庫那一堆東西之間它仍然會動」。**
END
$post$;

-- ── 新物件收權斷言(repo 標準形狀;`migration-static-checks.sh` ③ 數的就是這份清單)──
DO $newobj_guard$
DECLARE
  -- 🔴 結尾的 ::text[] 不能拿掉 —— 清單清空時 ARRAY[] 無法推斷型別。
  v_relations text[] := ARRAY[]::text[];
  v_functions text[] := ARRAY[
    'public.pcm_invoice_requested_false_is_final()'
  ]::text[];
  r         text;
  v_oid     oid;
  v_bad     int := 0;
  v_first   text;
  v_checked int := 0;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_oid := to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到函式 % —— 簽名打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN v_first := format('%s 上仍有 EXECUTE', r); END IF;
    END IF;
    -- 🔴 `has_function_privilege` 對 PUBLIC 那一半答不出來 ⇒ 直接讀 ACL(grantee = 0 就是 PUBLIC)。
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc pr, aclexplode(pr.proacl) a
       WHERE pr.oid = v_oid AND a.grantee = 0
    ) THEN
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN v_first := format('%s 上 PUBLIC 仍有授權', r); END IF;
    END IF;
    -- 🔴 而 ACL 是 NULL ⇒ 「沒有明寫收權」的形狀 ⇒ PUBLIC 看不見, 而那不是我下的 REVOKE 造成的
    --    ⇒ 本檔明寫了兩道 REVOKE ⇒ 這裡必須非 NULL, 否則那兩行沒生效。
    IF (SELECT pr.proacl FROM pg_catalog.pg_proc pr WHERE pr.oid = v_oid) IS NULL THEN
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN v_first := format('%s 的 ACL 是 NULL ⇒ 那兩道 REVOKE 沒生效', r); END IF;
    END IF;
  END LOOP;

  IF v_checked = 0 THEN
    RAISE EXCEPTION '新物件收權斷言:檢查數為 0 —— 這個斷言沒有分母, 不算通過。';
  END IF;
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      E'❌ 新物件收權斷言失敗:仍持有 % 項權限(第一個:%)。檢查了 % 個物件。\n'
      '   ⇒ 補上:REVOKE ALL ON FUNCTION <簽名> FROM PUBLIC, anon, authenticated;\n'
      '   🔴 兩道都要下:FROM PUBLIC 收不到具名授權, FROM 具名 收不到 PUBLIC 授權。',
      v_bad, v_first, v_checked;
  END IF;
END
$newobj_guard$;

COMMIT;

-- ============================================================
-- 🔙 **回退 —— 這一段【可以整段貼】, 因為它不動任何資料**
--   (⚠️ 而那正是本案比前一案乾淨的地方:前一案要收回 CHECK, 而那要先做一個不可逆的資料決定。)
--   BEGIN;
--     DROP TRIGGER IF EXISTS zzz_pcm_invoice_requested_false_is_final ON public.orders;
--     DROP FUNCTION IF EXISTS public.pcm_invoice_requested_false_is_final();
--   COMMIT;
-- 🛑 **而拆掉它之後, 「決定不開發票」就沒有東西在守** —— 那一刻起, 任何一次 UPDATE 都改得回 `true`。
-- ============================================================
