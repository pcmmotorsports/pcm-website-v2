-- M-4b · `unknown` 的【原因】要寫得進庫 —— 一扇窄門, 而不是把安全線鬆開
-- ⟦ship-UNKNOWNREASONLOST⟧ · 2026-09-08 · 線【出貨·新竹】`-ship`
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 病:`unknown` 的原因永遠寫不進庫 —— 而它是【量到的】不是讀出來的
-- ══════════════════════════════════════════════════════════════════════════
--    🔬 2026-09-08 在拋棄式 PG 17.10 起最小 fixture 真的跑過(跑完已收攤):
--      [1] draft ⇒ 佔位 unknown              ⇒ 成功, raw = {"placeholder": true}
--      [2] 再寫 unknown 帶 {"flowReason":…}  ⇒ ERROR「這張單已經是 unknown」
--      [2後] 庫裡仍是 {"placeholder": true}  ⇒ 🎯 flowReason 一個字都沒進去
--      🟢 正對照 [3] unknown ⇒ submitted 兩發都成功且值真的變了(那道 RAISE 不是恆真)
--      ⚪ 負對照 [4] 現造狀態 zzqnope ⇒ 紅在【別的】訊息上(不是每發都印同一句)
--
--    三段機制各有座標:
--      apps/admin/src/lib/shipping/shipment-submit-hct-action.ts:176-184  佔位寫 unknown
--    → apps/admin/src/lib/shipping/hct-submit-flow.ts:152-160            raw:{flowReason}
--    → 20260904170000_m4b_hct_record_submit_result.sql:164-170           RAISE
--
--    🔴 **後果的第二層**:`shipment-submit-hct-action.ts` 的 catch 會把這個 DB 例外轉成
--      needs_human + **資料庫原始訊息** ⇒ 值班看到的**不是** `:222` 那句刻意寫的
--      「送出去了而不知道結果 —— 不要重按」, **而是一句 SQL 錯誤。**
--
--    ⛔ ~~**後果的第二層【比第一層嚴重】**~~ · ⛔ ~~值班會重按 ⇒ 可能變成兩張託運單~~
--    🔴🔴 **[2026-09-08 R3 換角度審查訂正 —— 我把它講得比事實嚴重]**
--      那條「看到 SQL 錯誤 ⇒ 重按 ⇒ 兩張託運單」的鏈, **三層都不成立**:
--        ① `hct-submit-flow.ts:53-54` —— `current` 是 `unknown` ⇒ 走 `query_first`, **永不 submit**
--        ② `20260904170000:163` —— DB 那道 RAISE 本來就擋 `unknown ⇒ unknown`
--        ③ `shipment-hct-submit-button.tsx:38-44` —— `LOCKED` 同時含 `unknown` **與** `needs_human`
--           ⇒ 📌 **舊 bug 回的正是 `needs_human`, 而那顆鈕【一樣是鎖的】。**
--      ⇒ 🎯 **所以那句安全提示的存活率, 不是「會不會出兩箱」的決定因素。**
--      ⇒ 📌 **本支真正的價值是【判別甲/乙型的字串終於落得了庫】**, 不是「提示存活」。
--    🛑 **為什麼留著這段刪除線**:那個誇大的說法已經寫進 `⟦ship-UNKNOWNREASONLOST⟧`、
--      `docs/runbooks/hct-first-shipment-activation.md:78` 與我給主視窗的兩則回報
--      ⇒ **搜到舊字面的人要在同一發撞到訂正。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🛑🛑 為什麼是【新開一支】而不是改 `admin_record_hct_submit`(plan §1a, 主視窗 A 批乙案)
-- ══════════════════════════════════════════════════════════════════════════
--    甲案 = 讓那支放行 `unknown ⇒ unknown`(只准更新 raw)。效果一樣, **而它動到那道安全線本身**,
--      且「放行」這個字在下一個人讀起來會像「可以重寫了」。
--    丙案 = 佔位不寫 `unknown` 改寫別的態 ⇒ **那不是修法, 是推翻 Sean 拍甲批的單向門設計。**
--    ✅ 乙案(本支)= 在旁邊開一扇**只寫 raw、不碰任何狀態欄**的窄門。
--    🎯 那道線的存在理由(`20260904170000` 註解逐字)是
--      「**在分不出來的時候重送, 等於用一個我們沒有的知識去做一個不可回收的動作**」——
--      ⇒ 📌 **而本支要的只是「把原因記下來」, 它不需要那道線讓步。**
--
--    🔴 **窄在哪裡, 逐條(這一段就是本支的安全論證)**:
--      · 只吃 `hct_status = 'unknown'` 的列 —— 其餘一律 RAISE(不是安靜跳過)
--      · **一個 UPDATE 只動 `hct_raw_response` 一欄** —— 狀態、貨號、作廢欄一個都不在 SET 裡
--      · 作廢的箱照樣拒(與 `admin_record_hct_submit` 同一條線, 不開後門)
--      · 不覆蓋整個 raw —— **合併**進去, 佔位那把鑰匙(`placeholder`)留著讓人看得到順序
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔵 前提(2026-09-08 唯讀實測, 不是「我記得」)
-- ══════════════════════════════════════════════════════════════════════════
--    正式庫的 `admin_record_hct_submit` 與 `20260904170000` **逐字相同**
--    (兩邊 body 都 1858 字元 · md5 都是 bb651a10c8af188550fb23a63a92cba0;
--     🟢 正對照 to_regprocedure 非空 · 同名多載 1 支;⚪ 負對照現造名 ⇒ 空、現造字面 ⇒ f)。
--    ⚠️ **而那一發答不出**「`shipments` 那張表的欄位/約束/觸發器在正式庫長什麼樣」—— 那沒量。
--    ⇒ 所以下面的前置閘**自己去確認**, 不靠這段話。

BEGIN;

-- ── 1. 前置閘 ────────────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_def text;
BEGIN
  -- ① 那張表要在(否則我在對一個我沒看過的世界動手)。
  IF pg_catalog.to_regclass('public.shipments') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.shipments ⇒ 這不是我以為的那個世界';
  END IF;

  -- ② `hct_status` 值域要有 unknown ——
  --    🔴 本支【只】處理 unknown 的列;值域裡沒有它 ⇒ 本支永遠零命中,
  --      而**零命中與「它在守著」印同一個東西** ⇒ 所以在這裡就擋掉。
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conname = 'shipments_hct_status_domain'
     AND conrelid = 'public.shipments'::regclass;
  IF v_def IS NULL OR pg_catalog.strpos(v_def, 'unknown') = 0 THEN
    RAISE EXCEPTION
      '前置閘②:hct_status 值域裡沒有 unknown ⇒ 20260904140000 還沒貼。現況 = %',
      COALESCE(v_def, '(找不到那條 CHECK)');
  END IF;

  -- ③ 那支 writer 要在 —— 本支是它的**配套**, 不是它的替代品。
  --    🛑 它不在的話, 佔位那一段根本不存在 ⇒ 本支在解一個還沒發生的病。
  IF pg_catalog.to_regprocedure(
       'public.admin_record_hct_submit(text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION '前置閘③:admin_record_hct_submit 不在 ⇒ 20260904170000 還沒貼, 本支沒有配套對象';
  END IF;

  -- ④ forward-only:本支已套過 ⇒ 拒重跑(訊息比 `already exists` 說得出為什麼)。
  IF pg_catalog.to_regprocedure(
       'public.admin_record_hct_unknown_reason(text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘④:admin_record_hct_unknown_reason 已經存在 ⇒ 本檔已套用過, forward-only 拒重跑';
  END IF;
END
$pre$;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. 窄門:只把原因合併進 `hct_raw_response`, 一個狀態欄都不碰
-- ══════════════════════════════════════════════════════════════════════════
CREATE FUNCTION public.admin_record_hct_unknown_reason(
  p_shipment_reference text,
  p_reason             jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_status  text;
  v_deleted timestamptz;
BEGIN
  SELECT hct_status, deleted_at INTO v_status, v_deleted
    FROM public.shipments
   WHERE shipment_reference = p_shipment_reference
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_record_hct_unknown_reason:查無這張出貨單(%)', p_shipment_reference;
  END IF;

  -- 🔴 作廢的箱照樣拒 —— 與 `admin_record_hct_submit` 同一條線。
  --    📌 **一扇窄門不可以比大門寬**, 否則它就是後門。
  IF v_deleted IS NOT NULL THEN
    RAISE EXCEPTION
      'admin_record_hct_unknown_reason:這張出貨單已作廢(%), 不得再寫新竹欄位', p_shipment_reference
      USING ERRCODE = 'P0001';
  END IF;

  -- 🔴🔴 **只吃 unknown。而這裡【RAISE 不是安靜跳過】** ——
  --    安靜跳過的話,「寫進去了」與「那列不是 unknown」印同一個東西(都是成功),
  --    ⇒ 📌 而呼叫端會以為原因記下來了。
  IF v_status IS DISTINCT FROM 'unknown' THEN
    RAISE EXCEPTION
      'admin_record_hct_unknown_reason:這張單現在是 %(不是 unknown), 本支只記 unknown 的原因。'
      ' 要寫狀態請走 admin_record_hct_submit —— 本支【刻意】不碰任何狀態欄。',
      COALESCE(v_status, '(null)')
      USING ERRCODE = 'P0001';
  END IF;

  -- 🛑🛑 **SET 裡只有一欄, 而寫進去的【頂層鍵只有一個】。這兩句是本支全部的安全論證。**
  --
  -- 🔴🔴 **[2026-09-08 codex `gpt-6-astra` R1 must-fix ① —— 我原本的寫法是【錯的】]**
  --    ⛔ ~~`SET hct_raw_response = COALESCE(hct_raw_response,'{}') || p_reason`~~
  --    ⇒ 那會把 `p_reason` 的鍵**攤在頂層**, 而頂層有兩把鑰匙**別人在讀**:
  --      `20260905320000_m4b_hct_reset_unknown_to_draft.sql:156` 閘② 讀 `raw -> 'placeholder'`
  --      同檔 `:161-162` 閘⑤ 讀 `raw ->> 'at'` 比「是不是 15 分鐘前寫的」
  --    ⇒ 🛑 **所以只改 raw 仍然【改變得了重送資格】** —— 餵
  --      `{"placeholder":true,"at":"2000-01-01T00:00:00Z"}` 就偽造得出一個「早就卡住的甲型」,
  --      配一句非空證詞即可放回 `draft` 重送。
  --    ⇒ 📌 **我原本寫的「本支不可能造成一次重送」是【假的】** ——
  --      而它假在一個我沒看的地方:**那兩把鑰匙的讀者不在這支檔裡。**
  --
  -- ✅ **修法不是把那兩個鍵列進黑名單** —— 黑名單在跟下一個「還沒有人想到會被讀的鍵」賽跑。
  --    ⇒ 改成**結構上不可能**:整包 `p_reason` 一律塞進**一把專屬鑰匙** `unknownReason` 底下。
  --    🎯 於是不論 `p_reason` 長什麼樣, **本支寫得到的頂層鍵永遠只有一個, 而那個鍵沒有人在讀**。
  --
  -- 🔵 **順帶解掉 codex must-fix ③(`p_reason` 沒限形狀)**:
  --    `jsonb_build_object` **一定回物件** ⇒ 餵陣列不會把 raw 變成陣列;
  --    餵 SQL NULL 也只會變成 `{"unknownReason": null}`, **不會像 `|| NULL` 那樣把整個 raw 清空**;
  --    而同一把鑰匙重複寫是**覆蓋不是追加** ⇒ 冪等成立、不會無限長大。
  -- 🔴🔴 **[codex R2 must-fix ⑥]** 我第一版只顧了**右邊**(`p_reason`), 沒顧**左邊**。
  --    `admin_record_hct_submit` 的 `p_raw jsonb` **不限形狀** ⇒ 既有的 `hct_raw_response`
  --    本來就可能是**陣列**(例:writer 被餵過 `[1]`)⇒ `陣列 || 物件` 在 Postgres 是**追加**
  --    ⇒ 📌 巢狀那個保證失效:鍵不在頂層物件裡、而且**每寫一次就多一份 ⇒ 冪等不成立**。
  --    ✅ 所以左邊也要**強制成物件**:不是物件就先把它包進一把自己的鑰匙(**不丟資料**)。
  --    ⇒ 🎯 於是 `物件 || 物件` 恆為物件, 而 `unknownReason` 恆在頂層、恆是覆蓋。
  UPDATE public.shipments
     SET hct_raw_response = CASE
           WHEN pg_catalog.jsonb_typeof(hct_raw_response) = 'object' THEN hct_raw_response
           WHEN hct_raw_response IS NULL THEN '{}'::jsonb
           ELSE pg_catalog.jsonb_build_object('rawWasNotAnObject', hct_raw_response)
         END
         || pg_catalog.jsonb_build_object('unknownReason', p_reason)
   WHERE shipment_reference = p_shipment_reference;
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_record_hct_unknown_reason(text,jsonb)
  FROM PUBLIC, anon, authenticated;
-- 🔴 **[codex R1 must-fix ⑥]** 我原本只抄了 `20260904170000` 的 REVOKE 而**漏了 GRANT** ——
--    而同一條線更新的那支 `20260905320000:200` 逐字有 `GRANT EXECUTE … TO service_role`。
--    ⇒ 📌 `REVOKE ALL … FROM PUBLIC` 會**連帶收掉 service_role 的預設 EXECUTE**
--      ⇒ 呼叫端(走 service client)會收到 permission denied, 而**後置閘只問 owner 叫不叫得動**
--      ⇒ 🛑 那道閘會綠, 而那顆鈕會死。⇒ 下面後置閘⑥ 補問真正的呼叫角色。
GRANT EXECUTE ON FUNCTION public.admin_record_hct_unknown_reason(text,jsonb)
  TO service_role;

COMMENT ON FUNCTION public.admin_record_hct_unknown_reason(text,jsonb) IS
  '把 unknown 的原因合併進 shipments.hct_raw_response。只吃 unknown 的列, 只動那一欄 ——'
  ' 狀態/貨號/作廢欄一個都不碰, 所以它不可能造成一次重送。'
  ' 它是 admin_record_hct_submit 的配套, 不是替代品:那支擋 unknown⇒unknown 是對的,'
  ' 而擋住之後原因就沒地方去了 —— 本支是原因的那個地方。';

-- ── 3. 後置閘 ────────────────────────────────────────────────────────────
DO $post$
DECLARE
  -- 🔴 **本支建的【每一個可授權物件】都要列在這裡, 一個都不能少。**
  --    📌 收權斷言**只檢查你列出來的物件** ⇒ 它防「忘記收權」, **不防「忘記列」**
  --    ⇒ 而漏列的症狀是這一段**安靜地通過** —— `scripts/migration-new-file-static-checks.sh`
  --      那道靜態閘正是為了這個而數兩邊, 🔵 **而它今天當場抓到我列了 0 個**
  --      (我照抄了 `20260904170000` 的形狀, 而那支比 `20260905320000` 舊、沒有這張清單)。
  --    🎯 **同一顆「抄了較舊的那一支」今晚出現第二次** —— 前一次是漏了 `GRANT service_role`
  --      (codex R1 must-fix ⑥)。⇒ 📌 **抄範本要抄【最新的那一支】, 而「最新」不等於「相鄰」。**
  v_functions text[] := ARRAY[
    'public.admin_record_hct_unknown_reason(text,jsonb)'
  ]::text[];
  v_fn   regprocedure := 'public.admin_record_hct_unknown_reason(text,jsonb)'::regprocedure;
  v_def  text;
  v_sig  text;
  v_set  text;
  v_rest text;
  v_cond text;
BEGIN
  -- ① 建起來了。
  IF v_fn IS NULL THEN
    RAISE EXCEPTION '後置閘①:函式沒建起來';
  END IF;

  v_def := NULL;
  SELECT pg_get_functiondef(v_fn) INTO v_def;
  -- 🔴🔴 **[codex R2 must-fix ⑤]** 下面每一道閘讀的都是【定義文字】,
  --    而**一段被 `/* */` 包起來的碼, 在文字上與活著的碼一模一樣**
  --    ⇒ 把整段安全判斷包進區塊註解 ⇒ 條文還在、執行時不再擋 ⇒ 舊寫法照樣綠。
  --    ✅ **所以先剝註解再抽** —— 這一改同時幫到 ②/②c/③/③b/④ 每一道, 不是只補一個洞。
  --    ⚠️ **射程要寫明**:這只讓閘不被【註解】騙, 它**仍然是文字閘** ——
  --      行為的真憑據在拋棄式 PG 那一輪的突變矩陣, 不在這裡。
  v_def := pg_catalog.regexp_replace(v_def, '/\*.*?\*/', ' ', 'gns');
  v_def := pg_catalog.regexp_replace(v_def, '--[^' || chr(10) || ']*', ' ', 'g');

  -- ② 🔴🔴 **SET 子句【整段抽出來比對】, 不用關鍵字掃描。**
  --    ⛔ ~~`v_def ~ 'SET\s+hct_status'`~~ —— **[codex R1 must-fix ④]** 那個寫法只抓得到
  --      **緊接在 `SET` 後面**的那一欄 ⇒ 🛑 `SET hct_raw_response = …, hct_status = 'failed'`
  --      **一路綠**, 而呼叫一次就能重新送單。
  --    📌 **而我的突變剛好把 `hct_status` 放在 `SET` 正後面 ⇒ 它紅了 ⇒ 我以為那道閘有用。**
  --      🎯 **一發打中的突變, 證明的是「這一發被擋住」, 不是「這一類被擋住」。**
  --    ✅ 改成:抽出 `SET` 到 `WHERE` 之間**整段**, 那一段裡**只准出現 `hct_raw_response` 這一個欄名**。
  -- 🔴🔴 **錨要從 `UPDATE public.shipments` 起算, 不可以只錨 `SET`。**
  --    🔬 **我第一版就是只錨 `SET` ⇒ 而【乾淨的那一發也紅了】** ——
  --      因為函式標頭自己有一行 `SET search_path TO ''`, 那個 `SET` 排在前面
  --      ⇒ `.*?` 從它起算, 一路吃到整個函式本體裡的第一個 `WHERE`
  --      ⇒ 📌 **那道閘變成【恆真】** —— 它對每一份輸入都紅。
  --    🎯 **抓到它的是【正對照(M0 乾淨的那一發)】, 不是任何一發突變** ——
  --      六發突變全紅, 而那個「全紅」讀起來像「守得很好」。
  --      ⇒ 🛑 **只跑突變不跑正對照, 恆真的閘與有效的閘印同一個東西。**
  v_set := (pg_catalog.regexp_match(
              v_def, 'UPDATE\s+public\.shipments\s+SET\s+(.*?)\s+WHERE'))[1];
  IF v_set IS NULL THEN
    RAISE EXCEPTION '後置閘②:抽不出 UPDATE 的 SET 子句 ⇒ 下面那些斷言沒有對象(不是「沒問題」)';
  END IF;
  -- 🔴🔴 **[codex R2 must-fix ②③]** 我第二版仍是【黑名單 + 區分大小寫】,而它兩邊都漏:
  --    · `HCT_STATUS = 'failed'`(大寫)⇒ SQL 認得(識別字不分大小寫), 而 `~ 'hct_status'` 認不得
  --    · 巢狀建構式留著、**後面再接一個 `|| p_reason`** ⇒ ②c 只問「那串出現過沒」⇒ 照樣綠,
  --      而頂層覆寫能力就回來了。
  --    📌 **兩次都是同一個病:我在列舉【不准的東西】,而不准的東西列不完。**
  --    ✅ 改成**白名單**:整段小寫化, 把**預期的那一段整個扣掉**, 剩下的必須是空的。
  --      ⇒ 🎯 那樣「多寫了任何東西」都會現形, 不必預先想得到它長什麼樣。
  v_set := pg_catalog.lower(pg_catalog.regexp_replace(v_set, '\s+', ' ', 'g'));
  v_rest := pg_catalog.replace(
    v_set,
    pg_catalog.lower(
      'hct_raw_response = CASE WHEN pg_catalog.jsonb_typeof(hct_raw_response) = ''object'''
      || ' THEN hct_raw_response WHEN hct_raw_response IS NULL THEN ''{}''::jsonb'
      || ' ELSE pg_catalog.jsonb_build_object(''rawWasNotAnObject'', hct_raw_response) END'
      || ' || pg_catalog.jsonb_build_object(''unknownReason'', p_reason)'),
    '');
  IF pg_catalog.btrim(v_rest, ' ,') <> '' THEN
    RAISE EXCEPTION
      '後置閘②:UPDATE 的 SET 子句不是【逐字】預期的那一段 —— 扣掉之後還剩:「%」。'
      ' 這扇門只准寫 hct_raw_response 的那一個運算式;多一個欄、多一個 `|| p_reason`、'
      ' 或把欄名寫成大寫, 都會停在這裡。要改重送規則請去 admin_record_hct_submit。', v_rest;
  END IF;

  -- ②c 🔴🔴 **[codex R1 must-fix ①]** 寫進 raw 的**頂層鍵只有一個, 而且是專屬的那一把**。
  --    別人在讀頂層的 `placeholder` 與 `at`(`20260905320000:156` 閘② / `:161-162` 閘⑤)
  --    ⇒ 攤在頂層寫 = 偽造得出「早就卡住的甲型」= **改變得了重送資格**。
  --    ✅ 所以這裡釘死那個結構本身, 不是釘死「不准寫那兩個鍵」(黑名單會跟下一個鍵賽跑)。
  -- ②c 🟢 **正對照:那一段【真的被扣掉了】** —— 少了這格, 上面的「剩下是空的」在
  --    「逐字相符」與「`replace` 一個字都沒扣到而原本就空」兩個世界印同一個綠。
  IF v_set !~ 'jsonb_build_object\(''unknownreason''' THEN
    RAISE EXCEPTION
      '後置閘②c:SET 子句裡根本沒有 `jsonb_build_object(''unknownReason'', …)` ⇒'
      ' 上一格的「剩下是空的」沒有判別力。頂層的 placeholder / at 有人在讀'
      '(reset RPC 的閘②與閘⑤)⇒ 攤在頂層寫 = 一條偽造重送資格的路。';
  END IF;

  -- ③ 只吃 unknown 那道判斷還在 —— 而且**條件逐字就是那一句**。
  --    ⛔ ~~`v_def !~ 'v_status IS DISTINCT FROM ''unknown'''`~~ —— **[codex R2 must-fix ④]**
  --      🛑 `IF false AND v_status IS DISTINCT FROM 'unknown' THEN` **字面全在而判斷已停用**
  --      ⇒ 舊寫法照樣綠, 而非 unknown 的列從此寫得進原因。
  --    📌 **這與閘④b 是【同一個病】, 而我上一輪只修了④b** ——
  --      🎯 **修一個位置的人不會自動回頭問「同一個形狀還在哪裡」。**
  v_cond := (pg_catalog.regexp_match(
               v_def,
               'IF\s+([^;]*?)\s+THEN\s*RAISE EXCEPTION\s*''admin_record_hct_unknown_reason:這張單現在是'))[1];
  IF v_cond IS DISTINCT FROM 'v_status IS DISTINCT FROM ''unknown''' THEN
    RAISE EXCEPTION
      '後置閘③:「只吃 unknown」那道判斷的條件不是逐字那一句(現在是 %) ⇒'
      ' 字面還在【不代表】它還會擋。', COALESCE(v_cond, '(抽不出來)');
  END IF;

  -- ③b 🔴 **作廢的箱那道拒絕還在** —— 「一扇窄門不可以比大門寬, 否則它就是後門」。
  --    🔬 **這一格是【突變逼出來的】**:M7(把那道拒絕換成 `IF false`)原本 **rc=0 貼得上**
  --      ⇒ 📌 行為測試那一發負對照會紅, 而**貼片這一層一個字都不會說**。
  --    🔴 而它同樣要**逐字比對條件**, 不是只問字面在不在(codex R2 must-fix ④ 的另一半)。
  v_cond := (pg_catalog.regexp_match(
               v_def,
               'IF\s+([^;]*?)\s+THEN\s*RAISE EXCEPTION\s*''admin_record_hct_unknown_reason:這張出貨單已作廢'))[1];
  IF v_cond IS DISTINCT FROM 'v_deleted IS NOT NULL' THEN
    RAISE EXCEPTION
      '後置閘③b:「作廢的箱不得再寫」那道拒絕的條件不是逐字那一句(現在是 %) ⇒'
      ' 這扇窄門變得比大門寬, 那就是後門。', COALESCE(v_cond, '(抽不出來)');
  END IF;


  -- ④ 🔴 **原本那道安全線【一個字都沒被動到】** —— 本支的整個立論是「不碰它」。
  --    ⛔ ~~只問那句 RAISE 的【文字】在不在~~ —— **[codex R1 must-fix ⑤]**
  --      🛑 `IF false AND v_old_status = 'unknown' AND …` **文字全在而判斷已停用** ⇒ 舊寫法照樣綠。
  --      📌 **而我的突變只演了「把文字刪掉」** ⇒ 它證不到「文字還在 = 線還活著」。
  --    ✅ 改成:把那句 RAISE 前面的 **IF 條件整段抽出來逐字比對**。
  SELECT pg_get_functiondef(
           'public.admin_record_hct_submit(text,text,text,jsonb)'::regprocedure) INTO v_def;
  -- 🔴🔴 **這裡【也要】剝一次註解 —— 而我上一版漏了。**
  --    📌 我在上面剝了一次(那一份是【本支】的定義), 而這一行**重新讀進另一支的定義**
  --      ⇒ 🛑 剝過的那份被蓋掉了, 而 codex R2 的繞法(把整段安全線包進 `/* */`)
  --        對這一份**照樣有效** ⇒ 實測 rc=0 貼得上。
  --    🎯 **形狀:清理做在【變數】上, 而那個變數後來被重新賦值。**
  --      ⇒ 一次清理的有效期, 只到下一次賦值為止 —— 而 diff 上看不到那個邊界。
  v_def := pg_catalog.regexp_replace(v_def, '/\*.*?\*/', ' ', 'gns');
  v_def := pg_catalog.regexp_replace(v_def, '--[^' || chr(10) || ']*', ' ', 'g');
  --    🔴 `[^;]` 不是 `.` —— **我第一版寫 `(.*?)`, 而【乾淨的那一發也紅了】**:
  --      非貪婪仍然是**最左匹配**, 它從函式裡的**第一個 `IF`** 起算(`IF p_status NOT IN …`),
  --      一路跨過 `END IF;` 吃到目標那個 `THEN` ⇒ 抓回來的是一大段, 當然對不上
  --      ⇒ 📌 **那道閘變成恆真**, 而**六發突變全紅讀起來像守得很好**。
  --      ✅ `[^;]` 讓它跨不過 `END IF;` ⇒ 只可能抓到目標那一道 `IF` 自己的條件。
  --    🎯 **這是同一夜第二次被【正對照】抓到恆真閘** —— 前一次是閘②(`SET search_path` 那個)。
  v_cond := (pg_catalog.regexp_match(
               v_def,
               'IF\s+([^;]*?)\s+THEN\s*RAISE EXCEPTION\s*''admin_record_hct_submit:這張單已經是 unknown'))[1];
  IF v_cond IS NULL THEN
    RAISE EXCEPTION
      '後置閘④:在 admin_record_hct_submit 裡找不到「已經是 unknown」那道 RAISE 的 IF 條件 ⇒'
      ' 有人把安全線拆了或改寫了, 而本支的立論(我不碰它)就不成立了';
  END IF;
  IF v_cond IS DISTINCT FROM 'v_old_status = ''unknown'' AND p_status = ''unknown''' THEN
    RAISE EXCEPTION
      '後置閘④b:那道安全線的 IF 條件被改過(現在是 %) ⇒ 訊息還在【不代表】它還會擋。'
      ' 本支的整個立論建在它會擋上面。', v_cond;
  END IF;

  -- ④c 🔴 **清單上的每一個物件都要真的收過權** —— 少了這圈, 上面那張陣列是裝飾品。
  --    ⚠️ **而這兩格在本機拋棄式 Postgres 上零判別力**(本機預設授權與 Supabase 不同)
  --      ⇒ 它要 Sean 貼進正式庫之後才算數。**留著, 因為那時候它才會叫。**
  FOREACH v_sig IN ARRAY v_functions LOOP
    IF pg_catalog.to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION '後置閘④c:% 沒有建起來 ⇒ 這一支沒有做到它宣稱的事', v_sig;
    END IF;
    IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘④c:anon 叫得動 % ⇒ REVOKE 沒生效', v_sig;
    END IF;
    IF has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘④c:authenticated 叫得動 % ⇒ REVOKE 沒生效', v_sig;
    END IF;
  END LOOP;

  -- ⑤ 🟢 owner 叫得動 —— 少了這格, 上面的 false 可能只是簽名打錯。
  IF NOT has_function_privilege(
       'postgres', 'public.admin_record_hct_unknown_reason(text,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '後置閘⑤:連 owner 都叫不動 ⇒ 上面那幾格沒有判別力(很可能簽名打錯)';
  END IF;

  -- ⑥ 🔴 **[codex R1 must-fix ⑥]** 真正的呼叫角色叫得動 ——
  --    owner 叫得動與 `service_role` 叫得動是**兩件事**, 而跑這支 RPC 的是後者。
  --    📌 少了這格:`REVOKE ALL … FROM PUBLIC` 收掉 service_role 的預設 EXECUTE ⇒
  --      閘⑤ 照綠(owner 當然叫得動), 而那顆鈕在正式站回 permission denied。
  IF NOT has_function_privilege(
       'service_role', 'public.admin_record_hct_unknown_reason(text,jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION
      '後置閘⑥:service_role 叫不動這支 ⇒ 呼叫端會收到 permission denied。'
      ' REVOKE ALL FROM PUBLIC 會連帶收掉它的預設 EXECUTE, 要明授。';
  END IF;
END
$post$;

COMMIT;
