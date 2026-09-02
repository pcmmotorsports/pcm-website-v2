-- ⟦b4-RAILCAPAUDIENCE⟧ · 那個紅要有【觀眾】—— 數出「現在有幾張單是紅的」
--
-- ══ 為什麼要它(而它不是「順手加個 view」)═══════════════════════════════════════
--   `20260902020000` 把人工退款上限閘從【擋住】改成【記下來 + 警告】(Sean 拍板)。
--   🔴 而 `-5b` 的 codex R3 問了兩題, 兩題的答案是這一支存在的理由:
--     **①「紅【沒有出口】:`cap < 0` 是永久衍生態」**
--     **②「沒有任何機制會把它送到人面前:全 repo 零 cron / 零對帳 / 零報表讀 `rail_cap`**
--        **⇒ 唯一觀眾是『有人主動打開那張單的退款面板』, 而超收單的下一個動作就是關掉它」**
--   ⇒ 📌 **事前閘的觀眾【一定在現場】(他被擋了);事後紅的觀眾【可能永遠不來】。**
--
-- ══ ✅ Sean 2026-09-02 01:2x 拍【甲】 ═════════════════════════════════════════════
--   題目:那個紅要不要有【出口】與【觀眾】
--   甲(他選)= **加一個地方讓他看得到「現在有幾張單是紅的」**
--   乙        = 先上, 那一格單獨開一列
--   🔵 而他的字面是「讓【你】看得到」⇒ 那個「你」是他 ⇒ 落點是**他會打開的畫面**,
--     不是一個沒有人讀的 view。本支只做【數字】那一半;畫面那一半在 app 層。
--
-- ══ 🛑🛑 為什麼只有【一欄】—— 而我原本寫了兩欄 ═══════════════════════════════════
--   ⛔ ~~`over_cap`(超額 ⇒ 確認金額)與 `cap_unknown`(算不出上限 ⇒ 找工程)兩欄~~
--   🔴 **【codex 2026-09-02 must-fix】那第二欄【結構上恆為 0】** ——
--     `pcm_manual_refund_rail_cap`(`20260824010000:123-133`)是
--     `COALESCE(SUM,0)::bigint - COALESCE(SUM,0)::bigint` ⇒ **它正常回傳不可能是 NULL**;
--     而它出錯時整支查詢會失敗, 也不會變成一個「0 或 1」的計數。
--     ⇒ 📌 **`cap IS NULL` 那個 CASE 永遠走不到** ⇒ 那一欄是一個【恆綠格】,
--        而它在畫面上長得像「有在數」。
--   ⇒ ⇒ **移除。** 先例在同一族:`amountsTruncated`(`today-summary.tsx` 的墓碑段)逐字
--     「留著會是一個沒有任何路徑能讓它變 true 的旗標 = 恆綠格,而 UI 上長得像【有在防】」。
--
--   🔴🔴 **而這個錯最刺的一格:我【自己 40 分鐘前寫下過這個事實】** ——
--     `manual-refund-ledger-section.tsx` 那段(codex R2③ 逼我寫的)逐字:
--     「兩段都 COALESCE(...,0) ⇒ 它正常回傳【不可能是 NULL】
--       ⇒ 畫面這一側的 null 一格都不是來自 DB 說【算不出來】」。
--     ⇒ ⇒ **我把那句話寫進一支檔, 然後在另一支檔裡building 它的反面。**
--     ⇒ ⇒ ⇒ 📌 **一個被寫下來的事實, 不會自己去找它的其他消費端。**
--
--   🛑 **⇒ 而「算不出上限」那種紅【現在沒有觀眾】, 那是一個真的缺口, 不是被解掉了**:
--     它在畫面上只在【當下】看得到(訂單頁那條紅), 重新整理就可能消失, 而沒有地方記得。
--     ⇒ ✅ 已開列 `⟦5b-CAPUNKNOWNSTATE⟧`(**而它真的在信箱裡**:
--        `~/pcm-mailbox/交給f3上板-20260902-5b-四列漏交.md` 第 ③ 節)。
--
-- ══ 🔵 分母為什麼可以這樣收窄(不是為了快, 是為了它答得準)═══════════════════════
--   `pcm_manual_refund_rail_cap` = 兩軌淨實收 − 未作廢的人工退款。
--   ⇒ **一張沒有任何未作廢人工退款的單, 它的 cap 不可能是負的**(被減數是 0)。
--   ⇒ 所以只掃「有未作廢人工退款」的那些單就夠了 —— 而那是【等價】不是【抽樣】。
--   ⛔ ~~而 `cap IS NULL` 那一半不吃這個推論…所以 cap_unknown 只涵蓋有退款的那些單~~
--   🔵 **那一整段隨第二欄一起作廢**(見上方那個 codex must-fix):那一欄根本走不到。
--     留著這幾行加刪除線, 是因為**它的推理是對的** —— 錯的是它在替一個不存在的世界擔心。

-- 🔴 **裸 `CREATE`, 不是 `OR REPLACE`**(`migration-new-file-static-checks` ①)——
--   這是一個【新物件】⇒ 撞名要當場紅。
--   `OR REPLACE` 會把撞名**靜靜蓋掉**, 而 REVOKE 與後置斷言【照樣綠】
--   ⇒ 📌 拿到綠燈, 卻蓋掉了一個你不知道存在的東西。
CREATE FUNCTION public.pcm_manual_refund_red_counts()
RETURNS TABLE (over_cap bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- 🔴 `''` 而不是 `public, pg_temp`(2026-09-02 補;codex R3 對【隔壁那支】點名的同一格)。
--    本函式是 `SECURITY DEFINER` 且回財務數字 ⇒ 可被污染的 search_path 是這個 repo 記過的那一類。
--    ✅ 安全的理由是**本體全部限定**:`public.order_manual_refunds` /
--       `public.pcm_manual_refund_rail_cap`,其餘是內建(`SUM` / `COALESCE` / `::bigint`)。
--
-- 🛑🛑 **而這一行【為什麼是補的】要寫下來 —— 它是同一夜第三次同型**:
--    codex R3 點名的是 `20260902030000`, 而它逐字給了我一個對照:「隔壁那支用的就是 `''`」。
--    ⇒ 而我用那個對照**修了被點名的那一處**, 沒有拿它去找【還有誰長一樣】。
--    ⇒ 📌 **一個 finding 附的對照組, 同時也是一份「還有誰」的清單 —— 而我只把它當證據。**
--    ⇒ ⇒ **修一個被點名的實例, 不等於修那個類別。而三綠、diff、審查三個都不會叫。**
--
-- ⚠️ **而這一改【不會讓這條鏈變安全】, 不要讀成堵洞**:本函式呼叫的
--    `public.pcm_manual_refund_rail_cap` 自己就是 `SET search_path = public, pg_temp`
--    (`20260824010000:122`, 而**那支早就在正式庫上**)⇒ 這裡改的是【不要再擴散舊慣例】。
--    🔵 全 repo 現況(2026-09-02 當場數):`''` **191** 處 / `public, pg_temp` **72** 處。
--       ⚠️ ~~190~~ —— 我第一次數是**改這一行之前**數的, 而**改完之後我自己就是第 191 個**。
--       📌 一個把自己算進去的計數, 在寫下的那一刻就過期了。⇒ 引用前自己重跑那兩發 `grep -c`。
SET search_path = ''
AS $fn$
  WITH candidate AS (
    SELECT DISTINCT m.order_id
      FROM public.order_manual_refunds m
     WHERE m.voided_at IS NULL
  ),
  capped AS (
    SELECT c.order_id, public.pcm_manual_refund_rail_cap(c.order_id) AS cap
      FROM candidate c
  )
  SELECT
    COALESCE(SUM(CASE WHEN k.cap < 0 THEN 1 ELSE 0 END), 0)::bigint AS over_cap
    FROM capped k;
$fn$;

COMMENT ON FUNCTION public.pcm_manual_refund_red_counts() IS
  '⟦b4-RAILCAPAUDIENCE⟧「現在有幾張單是紅的」——後台首頁用(Sean 2026-09-02 拍甲:要有觀眾)。'
  '🔴 只有【一欄】:over_cap(超額 ⇒ 員工的下一步是確認金額)。'
  '⛔ 原本還有一欄 cap_unknown(算不出上限 ⇒ 找工程),而它【結構上恆為 0】——'
  'pcm_manual_refund_rail_cap 兩段都 COALESCE(...,0) ⇒ 正常回傳不可能是 NULL ⇒ 那個 CASE 走不到。'
  '⇒ 那種紅目前【沒有觀眾】,已開列 ⟦5b-CAPUNKNOWNSTATE⟧。'
  '兩者的下一步相反,合成一個數字就是 ⟦b4-PCM05SPLIT⟧ 那個病。'
  '🔵 分母 = 有【未作廢人工退款】的單。cap = 兩軌淨實收 − 未作廢退款 ⇒ 沒有退款的單不可能為負,'
  '所以那個收窄對 over_cap 是【等價】不是抽樣。'
  '⇒ **這個數字只涵蓋有退款的那些單,它不是全站的**。'
  '⚠️ 它是即時算的(STABLE,無快取):單數變多時要回來看它的成本。';

-- 🔵 權限:與 `pcm_manual_refund_rail_cap`(`20260824010000:149-151`)同一個形狀 ——
--    先 REVOKE 乾淨, 再只開給 `service_role`。
--    🔴 新物件**出生就自帶 PUBLIC/anon 的 EXECUTE**, 而 repo 內零 GRANT 字面可掃、三綠不紅。
REVOKE ALL ON FUNCTION public.pcm_manual_refund_red_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_manual_refund_red_counts() FROM anon;
REVOKE ALL ON FUNCTION public.pcm_manual_refund_red_counts() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_manual_refund_red_counts() TO service_role;
-- ── 新物件收權斷言(`scripts/migration-new-file-static-checks.sh` ③ 要這份清單可被數)──
-- 🔴 **它防的不是「忘記收權」, 是「忘記列」** —— 下面那個迴圈只檢查你列出來的物件。
--   ⇒ 📌 `REVOKE` 是【我做的動作】;這份清單是【下一個在這支檔加新物件的人會撞到的東西】。
-- 🔴 簽章逐字從上面的 `CREATE FUNCTION` 抄 —— `to_regprocedure` 對參數型別逐字比對,
--   打錯會**回 NULL**, 而第一道 IF 就是讓那件事 fail-loud、不靜默通過。
-- 🔴 結尾的 `::text[]` 不能拿掉(清單清空時 `ARRAY[]` 無法推斷型別)。
DO $grant_assert$
DECLARE
  v_functions text[] := ARRAY[
    'public.pcm_manual_refund_red_counts()'
  ]::text[];
  v_fn oid;
  r    text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(r);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION '收權斷言失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 對 anon/authenticated 開著 EXECUTE(三道 REVOKE 少了一道?)', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 對 service_role 沒有 EXECUTE(收太多)⇒ 呼叫端會被 42501 擋掉', r;
    END IF;
  END LOOP;
  RAISE NOTICE '✅ 收權斷言過:% 支函式 —— anon/authenticated 零 EXECUTE、service_role 有',
    cardinality(v_functions);
END
$grant_assert$;


-- ══ 🪦 這裡曾經有一段【後置斷言】(三個世界), 而它於 2026-09-02 整段拿掉 ═══════
--
-- 🔴 **為什麼拿掉 —— 與 `20260902030000` 同一刀、同一個理由**
--    Sean 2026-09-02 拍板(逐字「依照推薦」)⇒ 那一族的後置斷言在【正式庫】上跑不起來。
--
--    這一段做的是:造兩張假訂單 → 灌收款與人工退款 → 跑那支計數函式 → 用一發刻意的
--    `RAISE EXCEPTION` 回滾。而它踩得到的至少三格(codex 2026-09-02 對姊妹檔抓到的同一組):
--      🔴 `INSERT INTO public.orders(id) VALUES (…)` ——
--         `orders` 有 **NOT NULL 而無 default 共 10 欄**(`-0e` 唯讀正式庫量), 外加三條 CHECK,
--         而 `customer_user_id` 的外鍵一路指到 `auth.users` ⇒ **補值補不出來**
--      🔴 `UPDATE public.order_manual_refunds SET voided_at = …` 只填一欄 ⇒
--         違反 `order_manual_refunds_void_trio`(作廢三欄同生同滅;
--         而 `20260824010000:86` 有一道前置閘專門在驗那個約束在不在)
--      🔴 `INSERT INTO public.order_payments(order_id, rail, amount)` 漏 `received_at` / `actor`
--
--    🔵 **而它與姊妹檔差一格, 而那一格【推翻了姊妹檔那段墓碑的理由】**:
--       這一段【沒有 DELETE】—— 它靠 `EXCEPTION` 子交易回滾清場。
--       ⇒ 🔴 而那正好證明:**「schema 不准刪」不是這一族失敗的原因**
--         (codex 2026-09-02 nit;姊妹檔那段墓碑已一併更正)。
--       ✅ **⇒ 真正的失敗點是【造不出一列合法的測試資料】** —— 見上面那三格。
--       🛑 **而上面那三格已經足以讓它在【貼下去的那一刻】失敗。**
--
--    🎯 **⇒ 而順序讓它更糟**:Sean 是照 `030000 → 040000 → 020000` 貼的
--       ⇒ 第一支過了會建立「這批沒問題」的信心, 然後在**第二支**撞牆。
--
-- ══ 🛑 而【這一刀的代價】—— 必須寫在紙上 ══════════════════════════════════════
--
-- 🔴 **貼下去的那一刻, 沒有任何東西在驗 `pcm_manual_refund_red_counts()` 數得對。**
--    本檔現在只驗:①函式建起來了 ②`anon` / `authenticated` 零 EXECUTE、`service_role` 有。
--    ⇒ **它不驗行為。**
--
-- 🔵 **而那三個世界原本要證什麼, 以及那個證據現在住在哪**:
--    原本的三個世界 = 超額 1 張 · 沒超額的那張不被數進去 · 作廢後 0 張
--    ⛔ ~~而收權極性是那三個世界之一~~ 🔴 **不是**(codex nit):收權是**獨立的**
--       `$grant_assert$` 段, 它從來就不在那三個世界裡。
--    ✅ 而那一段**留下來了**(它零寫入 ⇒ 跑得起來)⇒ 所以「權限收好了」仍然有人驗。
--    ⇒ 🔴 **而「數得對不對」那兩格沒有替代品** —— 與姊妹檔不同:
--       `20260902030000` 的行為有兩份拋棄式窮舉背書(本窗 9 世界 + `-c7` 10,201 + 4,913),
--       **而本檔這支計數函式【沒有人在拋棄式 PG 上跑過】。**
--    ⇒ ⇒ 📌 **所以本檔的代價比姊妹檔【重一格】, 而我把它寫出來而不是抹平。**
--
-- 🎯 **⇒ 而它今天可以接受的理由是【射程小】, 不是【驗過了】**:
--    這支函式**預定**由首頁那一格讀(`today-read.ts`), 而它讀不到時畫面顯示「讀取失敗」——
--    ⛔ ~~原本寫「只被首頁那一格讀」~~ 🔴 **現在式是錯的**(codex nit):片A 的 app 半
--       於 `3ce5f73d` 被按下來了 ⇒ **今天沒有任何 `.rpc()` 在呼叫它。**
--    ⚠️ **而數法要寫精確, 否則下一個人 grep 會以為這句錯了**(本窗當場踩到):
--       `grep -rl 'pcm_manual_refund_red_counts' apps packages` ⇒ **1 支檔**
--       而那 1 支是 `manual-refund-ledger-section.tsx` 的**兩行註解**(`:84` / `:116`), 不是呼叫。
--       ⇒ 📌 **「零呼叫」與「零命中」是兩個數字, 而只有前者是真的。**
--    ⇒ 一個**數錯的計數**與一個**讀不到**在畫面上分得出來, 而前者不動錢。
--    🛑 **⇒ 但那是「錯了也不會賠錢」, 不是「它是對的」。⇒ 兩者不要合成一句。**
--
-- ⚠️ **下一個人要補這一格的話**:去拋棄式 PG 上跑, 不要放回 migration 裡 ——
--    理由與姊妹檔同一段:**這個 schema 刻意不讓你刪掉造出來的資料。**
