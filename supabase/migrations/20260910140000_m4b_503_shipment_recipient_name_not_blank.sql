-- `#503` 甲(丙層)—— 出貨包裹的收件人姓名不得是空白。
--
-- 🔵 **今天 0 列被擋。** 2026-09-10 唯讀正式庫逐箱量過(4 箱,含 3 個作廢):
--    `empty_name 0 · empty_phone 0 · empty_line 0 · any_empty 0`
--    🟢 正對照 同尺放寬成「name 長度 > 0」⇒ **4 = 總箱數** ⇒ 尺讀得到東西
--    ⚪ 負對照 現造的鍵 `zzq8NotAKey` ⇒ **0** ⇒ 尺不亂命中
--    ⇒ 📌 **這一支是【不痛的】** —— 既有列全過,而正常路徑上任何人都不會看到它噴。
--    📎 讀數與量法 `docs/plans/2026-09-10-503-收件快照收嚴-續-plan.md` §2。
--
-- ══ 為什麼還要這一層(應用層明明已經擋了)═══════════════════════════════════
-- 擋姓名的今天有**兩處,都在應用層**:
--   `apps/admin/src/components/orders/shipment-dialog.tsx:267`(按鈕不給按)
--   `apps/admin/src/lib/shipping/shipment-actions.ts:164`(server 端再擋一次)
-- 兩處叫的是**同一支** `apps/admin/src/lib/shipping/recipient.ts`(`#503` 甲的單一真相源)。
-- 🔴 **而繞過應用層的寫入路徑不會有任何東西紅** —— 未來的 RPC、手動 SQL、別的窗。
--    建箱 RPC `20260807170000:143-150` 只驗「恰好三鍵的 object」;
--    表上的 `shipments_recipient_snapshot_shape` 走 `m3_jsonb_values_all_string`,
--    而那支(`20260604120000:73-87`)**只看型別、不看長度** ⇒ `''` 是合法 string ⇒ 過關。
--    ⇒ 📌 **DB 是最後一道,而今天那一道是開的。**
--
-- ══ 🛑 射程:這一支擋的是【空】,不是【錯】—— 兩件事不要讀成同一句 ═══════════
--    正式庫箱 `dae5fa20` 的地址逐字是 **`123`** —— **非空,而寄不到任何地方。**
--    ⇒ 🔴 **本約束抓不到它,而我【刻意不去猜地址格式】** —— 那又會是一個「我列的分母」,
--      下一種寫法出現時它不會紅。📌 **「不含 X」有無限多種綠法,而肯定式的只有一種。**
--
-- ══ 🛑 硬順序:只收嚴 `name`,不碰 `phone` / `line` ═════════════════════════
--    · `phone` 空是**業務允許**的值 —— `create_order` RPC `20260604130000:98` 逐字
--      「空電話業務允許」;`customer_addresses.phone DEFAULT ''`。
--      ⇒ 收嚴它會**退掉沒有電話的既有客人**(`recipient.ts` 檔頭明文警告過)。
--    · `line`(地址)⇒ **在 `#39`(客人自取)落地之前不得收嚴**。
--      舊 plan `docs/specs/2026-08-18-m4b-503-shipment-recipient-blank-plan.md` §4-b 逐字:
--      「在有正式的『自取』模式之前,**任何對【地址】收嚴的規則都會把自取單擋死**」。
--      🔴 那一段刻意寫進 plan 而不是只寫在信裡,理由逐字:「下一個做丙的人不會讀今天的信,
--         而『順手把三個鍵一起收嚴』是這一片從第一天就有人想做的事。」⇒ **我照做,不推翻。**
--
-- ══ 🔵 用既有的 `pcm_b2_is_blank`,不自己發明一套 ═══════════════════════════
--    同一張表已經有 **5 條** CHECK 在用它(`carrier_note` / `hct_request_id` /
--    `tracking_number` / `void_reason` / `shipped_needs_tracking`)。
--    🔬 那支的本體我唯讀讀出來了(讀 `pg_proc.prosrc`,**沒有呼叫它** ——
--       `pcm_readonly` 對它沒有 EXECUTE,呼叫會噴 `permission denied`):
--       `btrim(translate(COALESCE(t,''), E'\t\n\r\v\f' || U&'\00A0' || U&'\3000', '       ')) = ''`
--       ⇒ **NULL 與 7 種空白字元都算空**(含 NBSP `U+00A0` 與全形空格 `U+3000`)。
--       🟢 正式庫本體與 repo `20260805170000:56-70` **逐字相同** ⇒ 兩邊沒有漂移。
--    🛑 而那支的 COMMENT 自己警告:「改這支等於同時改那四條守門的語意」
--       ⇒ 📌 **本片【只新增第 5 個消費端,一個字都不改那支函式】。**
--
-- ══ ⚠️ 天花板(寫出來,不假裝沒有)═══════════════════════════════════════════
--    `ADD CONSTRAINT`(不帶 `NOT VALID`)會取 ACCESS EXCLUSIVE 並**當場重驗全表**。
--    今天 4 列 ⇒ 瞬間。🔴 **而這張表大了以後不是** —— 那一天要改走
--    `ADD ... NOT VALID` + 另一支 `VALIDATE CONSTRAINT`。
--    ⇒ 本片不預先那樣寫:兩段式在 4 列上只是多一支檔,而它自己也要被驗。
--
-- Rollback:`supabase/rollbacks/20260910140000_down.sql`(**整支跑那個檔,不要從這裡複製**)
--   -- SET LOCAL lock_timeout = '5s';   ← 那支檔自己第一行就設了(照 repo 慣例的 5s)
--   🔵 這一行寫在這裡是給 `scripts/rollback-locktimeout-gate.py` 看的,而它的理由是對的:
--      rollback 常常是【人把註解貼進 psql】跑的,而 psql 預設沒有 lock_timeout ⇒ 會無限等,
--      📌 而「很慢」與「卡在鎖上」在那個畫面上是同一件事 —— 兩者都是一個不動的游標。
-- ============================================================

BEGIN;

-- 🔵 lock_timeout 是給「將來表大了、而有人正在建箱」那一天的:等不到就退,不要卡住出貨。
SET LOCAL lock_timeout = '5s';

-- ══ 🔴 前置閘:貼板當下再量一次,不用 plan 那天的數字 ═══════════════════════
--    📌 **資料會動。** plan 是 2026-09-10 量的,而這一支可能明天才貼。
--    ⇒ 若這中間有人建了一個姓名空白的箱,`ADD CONSTRAINT` 會噴 raw 23514,
--      而那個訊息讀起來像「這支 migration 壞了」,不像「有一列不合格」。
DO $gate$
DECLARE
  v_bad integer;
  v_all integer;
BEGIN
  SELECT pg_catalog.count(*) FILTER (
           WHERE public.pcm_b2_is_blank(recipient_snapshot ->> 'name')
         ),
         pg_catalog.count(*)
    INTO v_bad, v_all
    FROM public.shipments;

  -- 🟢 正對照:這張表要讀得到東西。0 列時本閘無判別力,而那不是「通過」。
  IF v_all = 0 THEN
    RAISE EXCEPTION '前置閘⓪:shipments 一列都沒有 ⇒ 本閘【零判別力】, 不是通過。先確認你連對庫了。';
  END IF;

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      '前置閘①:有 % 列(共 % 列)的收件人姓名是空白 ⇒ 加了這條約束它們【連 UPDATE 都做不了】。'
      ' 先決定那些列怎麼辦(補資料 / 放行既有列 / 不做這一片)—— 那是業務決定, 不是這支檔能決定的。',
      v_bad, v_all;
  END IF;
END
$gate$;

-- ══ 本體 ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.shipments
  ADD CONSTRAINT shipments_recipient_name_not_blank
  CHECK (NOT public.pcm_b2_is_blank(recipient_snapshot ->> 'name'));

COMMENT ON CONSTRAINT shipments_recipient_name_not_blank ON public.shipments IS
  '`#503` 丙:收件人姓名不得空白。🛑 只守 name —— phone 空是業務允許的值, '
  'line(地址)在 #39(客人自取)落地之前不得收嚴(舊 plan §4-b 硬順序)。'
  '⚠️ 它擋的是【空】不是【錯】:一個寄不到的地址(例:`123`)照樣過。';

-- ══ 斷言 ═══════════════════════════════════════════════════════════════════
DO $assert$
DECLARE
  v_def text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(con.oid) INTO v_def
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'shipments'
     AND con.conname = 'shipments_recipient_name_not_blank';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '斷言①失敗:約束 shipments_recipient_name_not_blank 沒有建起來。';
  END IF;

  -- 🔴🔴 **肯定式全等,不是「含某些字串」**(2026-09-10 codex 唯讀審 must-fix)。
  --    ⛔ ~~第一版:strpos 查有沒有 'name' / 'pcm_b2_is_blank', 再查有沒有 'phone' / 'line'~~
  --    🔴 codex 的反例逐字:定義若是
  --         `CHECK (NOT pcm_b2_is_blank(...->>'name') AND char_length(...->>'name') >= 2)`
  --       ⇒ **四個 strpos 全部放行**;連 `... OR TRUE` 都過得了。
  --    📌 **而我自己在 plan 裡寫了那句話,然後用了子字串比對** ——
  --       「**『不含 X』有無限多種綠法, 而肯定式的只有一種。**」
  --    ✅ 全等之後,「多做了」與「少做了」被同一格問掉,不必再分兩問。
  --    ⚠️ 天花板:PG 的正規化文字若隨版本改變, 這一格會紅。**那是刻意的** ——
  --       紅了要人來看一眼, 比靜悄悄放行安全。下面把實際文字印出來給那個人。
  IF v_def <> 'CHECK ((NOT pcm_b2_is_blank((recipient_snapshot ->> ''name''::text))))' THEN
    RAISE EXCEPTION
      '斷言②失敗:約束建起來了, 而它的定義【不是】本片要的那一條(逐字全等比對)。'
      ' 實際:%  ⇒ 若只是 PG 正規化文字改版, 更新本斷言的期望字串;'
      ' 若是別人換掉了它, 先查清楚 —— 特別是有沒有順手碰到 phone / line(舊 plan §4-b 禁止)。',
      v_def;
  END IF;
END
$assert$;

COMMIT;
