-- 貼後對帳 · `20260905130000`(片 D)—— **Supabase SQL Editor 版**
--
-- 🔴🔴 **這支檔存在的理由**:同目錄的 `130000-after.sql` 是 **psql 版**,
--    它用 `\pset` / `\set ON_ERROR_STOP on` / `\echo` —— **那些是 psql 的東西,SQL Editor 不認得**
--    ⇒ 貼進 SQL Editor 會在**第一行**就報錯。
--    ⇒ 📌 而那正是本片一路撞的同一個病:**一個寫得很清楚的驗收條件, 沒有人能執行。**
--       (R3 2026-09-05 判 must-fix;主視窗 §A 13 寫「Sean 在 SQL Editor 跑」⇒ 本檔補上那條路。)
--
-- ═══ 怎麼用(給 Sean)═══
--   1. 把**整支檔一次貼進 SQL Editor**, 按一次 Run。
--   2. 🔴 **它【一定會以一個紅色錯誤結束】—— 那是刻意的, 不是壞掉。**
--      那個錯誤訊息裡就是答案。**把整段訊息複製貼回來就好。**
--   3. 🛑 **它不會留下任何一列資料**:整段包在一個交易裡, 而最後那一發 `RAISE` 讓它全部回滾。
--      (⇒ 這也是為什麼答案要走「錯誤訊息」而不是結果表格 —— 回滾之後表格就沒了。)
--
-- ═══ 要看什麼(四個字串, 逐字對)═══
--   `建得出來=t`        ⇒ 函式跑得動(這一格若不是 t, 下面都不用看)
--   `trim後=a@b.co`     ⇒ 前後空白與尾端換行有被剝掉
--   `留白進NULL=t`      ⇒ 留白存成 NULL 而不是空字串(空字串會被 CHECK 擋、整張單建不出來)
--   `同鍵改email被擋=t` ⇒ 第 11 參有進冪等指紋(員工改好 email 重送不會被靜靜吞掉)
--   🔴 **四個裡任何一個不是那個值 ⇒ 不要放行, 貼回來給我判。**
--
-- ═══ 🔴🔴 這支檔【驗到哪、沒驗到哪】(照實寫, 不要讀成「已經跑通了」)═══
--   ✅ **驗到的**(拋棄式 PG 17.10, 線 `-account` 2026-09-05):
--      · 結構跑得動:`BEGIN` → `DO` → 最後那發 `RAISE` → `ROLLBACK` 這條路會走完並回滾
--      · 🔬 **而它在那台機器上抓到了【我自己寫錯的兩個輸入】** —— 這兩個若沒抓到, Sean 會白跑兩趟:
--        ⛔ `invoice.type` 我原本寫 `'none'` ⇒ G5 只收 `personal/company/donate` ⇒ 在 email 那行之前就 RAISE
--        ⛔ 品項數量我原本寫 `"quantity"` ⇒ 函式讀的是 **`"qty"`** ⇒ 「數量要是正整數」
--   ⛔ **【沒有】驗到的 —— 而這一格要說清楚**:
--      我那台拋棄式 PG **schema 不全**(缺 `public.m3_jsonb_values_all_string` 等 helper 與 orders/order_items 全表)
--      ⇒ 🔴 **我沒有讓它從頭跑到最後那發 RAISE。**
--      ⇒ 📌 **所以「它會跑完」是【推論】, 不是量到的。** 正式庫上那些東西都在, 所以它應該會過 ——
--        **而「應該」不是證據。**
--   ⇒ ✅ **因此第 2 步那句「把整段訊息貼回來」對【兩種結果都成立】**:
--      看到「片D 對帳結果」= 跑完了, 四個值就是答案;
--      看到別的錯 = **還有一個我沒抓到的輸入形狀**, 貼回來我改, 不是片 D 壞了。

BEGIN;

DO $probe$
DECLARE
  v_cust   uuid;
  v_staff  text;
  v_oid    uuid;
  v_mail   text;
  v_blank  boolean;
  v_key    uuid := pg_catalog.gen_random_uuid();
  v_guard  text := 'f';
  v_ship   jsonb := '{"name":"對帳用","phone":"0900000000","line":"對帳用地址"}'::jsonb;
  -- 🔴 `personal` 不是 `none` —— G5 只收 personal / company / donate,
  --    送 `none` 會在**還沒走到 email 那一行之前**就 RAISE(那個坑 codex R1 沒抓到、R3 才抓到)。
  v_inv    jsonb := '{"type":"personal"}'::jsonb;
  v_line   jsonb := '[{"variant_id":null,"title":"對帳用","sku":"AFTERCHK","unit_price":1,"qty":1,"spec":{}}]'::jsonb;
BEGIN
  SELECT c.user_id INTO v_cust FROM public.customers c LIMIT 1;
  SELECT s.id      INTO v_staff FROM public.staff s WHERE s.is_active LIMIT 1;
  IF v_cust IS NULL OR v_staff IS NULL THEN
    RAISE EXCEPTION '對帳無法進行:這台庫上沒有客人或沒有啟用中的員工 ⇒ 這【不是】片D 的問題, 貼回來說一聲就好';
  END IF;

  -- ④ 真的呼叫一次(帶前後空白 + 尾端換行)
  v_oid := (public.admin_create_manual_order(
              v_cust, pg_catalog.gen_random_uuid(), v_staff,
              'manual_phone', 'bank_transfer', 'home',
              v_ship, v_inv, 0, v_line, E'  a@b.co\n') ->> 'order_id')::uuid;
  -- 🔴 綁函式回傳的 id, **不是**撈「最新一張」—— 並行建單時那會讀到別人的單。
  SELECT o.notification_email INTO v_mail FROM public.orders o WHERE o.id = v_oid;

  -- ⑤ 留白那一發
  SELECT (o.notification_email IS NULL) INTO v_blank
    FROM public.orders o
   WHERE o.id = (public.admin_create_manual_order(
                   v_cust, pg_catalog.gen_random_uuid(), v_staff,
                   'manual_phone', 'bank_transfer', 'home',
                   v_ship, v_inv, 0,
                   '[{"variant_id":null,"title":"對帳用","sku":"AFTERCHK2","unit_price":1,"qty":1,"spec":{}}]'::jsonb,
                   '   ') ->> 'order_id')::uuid;

  -- ⑥ 同一把冪等鍵、只改 email ⇒ 必須被擋(第 11 參有沒有進指紋)
  PERFORM public.admin_create_manual_order(
            v_cust, v_key, v_staff, 'manual_phone', 'bank_transfer', 'home',
            v_ship, v_inv, 0,
            '[{"variant_id":null,"title":"對帳用","sku":"AFTERCHK3","unit_price":1,"qty":1,"spec":{}}]'::jsonb,
            'first@b.co');
  BEGIN
    PERFORM public.admin_create_manual_order(
              v_cust, v_key, v_staff, 'manual_phone', 'bank_transfer', 'home',
              v_ship, v_inv, 0,
              '[{"variant_id":null,"title":"對帳用","sku":"AFTERCHK3","unit_price":1,"qty":1,"spec":{}}]'::jsonb,
              'second@b.co');
    -- 🔴 走到這裡 = 它【沒有】被擋 ⇒ 指紋那一行掉了。
    v_guard := 'f';
  EXCEPTION WHEN SQLSTATE 'P858B' THEN
    v_guard := 't';
  END;

  -- 🔴🔴 **這一發 RAISE 是【出口】不是失敗** —— 它同時做兩件事:
  --    ① 把四個答案帶出去(回滾之後結果表格就沒了, 只有錯誤訊息活得下來)
  --    ② 讓整個交易回滾 ⇒ **零留痕**
  RAISE EXCEPTION E'片D 對帳結果(這個紅色是刻意的, 把這段整個貼回來)\n  建得出來=%\n  trim後=%\n  留白進NULL=%\n  同鍵改email被擋=%',
        (v_oid IS NOT NULL), v_mail, v_blank, v_guard;
END
$probe$;

ROLLBACK;

-- 🛑 **這份對帳【證不到】什麼**(照實寫, 不要讀成「全都驗過了」):
--   · 它走 `RAISE` + 回滾 ⇒ 證得到函式跑得動, **證不到 trigger 與下游收得到**
--   · 它**不驗 PostgREST 快取重載了沒** —— 那一格 SQL 這一側看不到, 要打真的 API 才知道
--   · 它答不出片 E 送過來的形狀對不對 —— 那要等 E 上線後另外量
--   · `同鍵改email被擋` 認的是**錯誤碼 `P858B`**, 不是文案;訊息換字它照樣過(刻意的)
