-- 20260901021000_m4b_coupon_p3b_create_order_redeem.sql
-- 🔵🔵 **券片 3b · 本片解除 3a 的封鎖。**
--
-- 3a(`20260901003000`)讓 `create_order` 收得下 `p_coupon_code`, 而帶券碼會被一道
-- `RAISE EXCEPTION '優惠券結帳尚未啟用(券片3b 未上線)…'` 擋掉。**那道 RAISE 是刻意留的門栓,
-- 本片把它換成那次試算呼叫。**⇒ 兩片的關係在碼上看得見:
--   · 本檔 `:437` 起那一段就是換上去的東西, 而 3a 的原句逐字留在註解裡。
--   · 檔尾自檢把 3a 的兩道斷言**反過來**釘(封鎖必須不在、呼叫必須在)
--     ⇒ 📌 **同一個函式體不可能同時通過 3a 與 3b 的斷言** ⇒ 誰被裝上去了, 問它自己就知道。
--
-- ══ 本片做什麼(四件, 不多不少)═════════════════════════════════════════════
--   ① 券碼有值 ⇒ 呼 `public.redeem_coupon(code, uid, subtotal, has_tier, NULL)` **試算**
--      (`p_order_id` 不傳 = 唯讀、不鎖列、不寫 redemption)
--   ② 試算結果的 `discount_applied` 進 `v_discount_total`、`coupon_id` 進 `v_coupon_id`
--   ③ INSERT 多寫一欄 `coupon_id`(那一欄 `20260901020000` 剛加)
--   ④ 🔴 **收款成功時扣券** —— 一支 trigger(檔尾第 2 節), 見下面「為什麼是四件不是三件」。
--   ⇒ **參數一個字都沒動**、`v_total` 的算式沒動、其餘一切照 3a。
--
-- ══ 🔴🔴 為什麼 ④ 在【同一支 migration】裡, 而不是原本規劃的 022000 ═══════════
--    codex R1 must-fix:**021000 單獨上線 = 把 3a 封住的那個洞原封不動打開。**
--      券結帳活了、單有折扣了、客人付了錢, 而 **redemption 沒有人寫** ⇒ 名額永遠不扣
--      ⇒ **同一張券可以無限次用**, 而沒有任何告警。
--    而 3a 的丁裁定判準是「忘記的時候會發生什麼」:封住忘了 = 惰性;開著忘了 = 洞。
--    🔴 **Sean 是【一支一支手貼】的** ⇒ 021000 貼完到 022000 貼完之間, 那個洞是真的開著。
--    ✅ ⇒ 主視窗 `-24` 2026-09-01 拍【乙:合成一支】——
--       **一個交易, 要嘛全進要嘛全回捲 ⇒ 半套在物理上不可能。**
--       📌 **不是靠人記得順序, 是讓錯的狀態不存在。**(`022000` 那個號已退回主視窗)
--
-- ══ 🔴🔴 為什麼 ④ 是 trigger, 而不是去改 `confirm_order_payment` ═══════════════
--    量到的(2026-09-01):`grep -rln "payment_status *= *'paid'" supabase/migrations/*.sql` ⇒ **23 支檔**,
--    其中真的是 `SET`(寫入)的分屬**不同函式**, 至少五處:
--      `20260611120000:178` / `20260804150000:127` / `20260810160000:448`
--      `20260810170000:436`(原本要補的那支) / `20260820020000:169` 與 `:560`
--      🔵 負對照 現造值 `zzqpaid901` ⇒ 0
--    ⇒ **只補 `confirm_order_payment` = 只補了刷卡那一條腿。**後台手動確認收款的單,
--      券永遠不會被扣 —— 那正是本片要關的洞, 只是換一條路進來。
--    📌 **我的分母由「Sean 說收款成功才寫」決定, 而 bug 的分母由「誰有能力把單翻成 paid」決定。**
--       ⇒ 這兩個分母沒有理由相等, 而它們讀起來一樣。
--       (主視窗指出:這與 `CLAUDE.md` 鐵則 11 那句【測試選檔】的話**是同一個形狀**,
--        只是從另一個方向走進來 ⇒ 一條規矩能在兩件不同的工作上長出同一句話, 那是形狀不是規矩。)
--    🔵 而**前人量過同一個分母**:`20260823030000:36` 逐字「那支函式全樹被 `CREATE OR REPLACE` **四次**,
--       四處都有那句 `SET payment_status = 'paid'`」⇒ 我又撞了一次。
--       **⇒ 那不是我沒讀, 是那個紀錄沒有站在我的路上。**所以本片把它引在 trigger 的 COMMENT 裡。
--    ✅ trigger 按【建構】涵蓋所有路徑 —— **新增第六條翻 paid 的路時, 不必有人記得回來改。**
--    ⚠️ **代價:trigger 是隱形的。**讀 `confirm_order_payment` 的人看不到券被扣了。
--       ⇒ 三處指路(主視窗要求的第三處是關鍵):
--         ① 本檔 trigger 自己的 COMMENT  ② `orders.coupon_id` 的 COMMENT
--         ③ 🔴 **`confirm_order_payment` 函式體內一句** —— 因為讀那支的人**正在找券去哪了**,
--            而他不會去讀 orders 的欄位註解。**「寫在正確的地方」與「寫在他會經過的地方」是兩件事。**
--         🛑 ③ 本片**沒有做**(要 `CREATE OR REPLACE` 抄那支 193 行的函式 ⇒ 抄錯一代整個回捲)。
--            ⇒ **已交回主視窗當已知缺口。**照實寫, 不假裝三處都有。
--    ⚠️ 「後台手動確認收款也會扣券」是**我判的, 不是 Sean 拍的**。
--       主視窗判它不是擴張:他拍的是「收款成功才寫」而**他沒有加限定詞** ——
--       只補刷卡那條 = 我們替他的拍板加了一個他沒說的限定。⇒ trigger 是忠實實作。
--       **而「我判的」這個標記保留。**
--
-- ⛔ **本片不做**:
--   · 不改券的規則。
--   ⛔ ~~「不動 `IF v_total <= 0` 那道閘 —— 那是另一片」~~(從 3b 抄來的)⇒ **本片就是那另一片。**
--     🔵 而 3b 那句話當時是對的:它是**本片的觸發條件**, 不是漏做。留著看得出兩片的接續。
--
-- ⚠️ 上游 `20260831160000`(`redeem_coupon`)本片有改它:成功時多回一格 `coupon_id`。
--    理由寫在那支檔的檔頭(不在這裡重抄)。**它未 apply ⇒ 就地改不會讓帳本變孤兒。**
--
-- ══ 以下自 3a 逐字保留(只改了上面列的三件事)════════════════════════════════
--
-- ⚠️ 3a 檔名裡的 `discount_param` 是第一版的名字。**留著不改** —— 版本號是 apply 的身分,
--    改檔名會讓帳本與交接訊息裡的引用全部斷掉。而它收的是券碼不是金額, 見下。
--
-- ══ 🔴 為什麼要動這支 ═══════════════════════════════════════════════════════
-- 客人在結帳頁輸入券碼 ⇒ 他要看到折後價、要付折後的錢
-- ⇒ `orders.discount_total` / `orders.total` 必須反映它
-- 🛑 而上一代那個欄位是**寫死的 `0`** ⇒ 沒有任何路徑寫得進去。
--
-- ══ 🔴🔴 收【券碼】不收【金額】—— 而那是被一個洞逼出來的 ═════════════════════
-- ⛔ ~~主視窗原裁:「多一個 `p_discount_total`, 它只是接受一個已經算好的金額」~~
-- 🔴 codex 抓到、主視窗自己去正式庫量過並重裁:
--    `create_order` 是 SECURITY DEFINER 且 `GRANT EXECUTE … TO authenticated`,
--    而 Supabase 把 public schema 的函式**全部開成 PostgREST RPC 端點**
--    ⇒ **任何登入的客人拿 anon key + 自己的 JWT 就叫得動它, 並自己填那個金額。**
--    🟢 正式庫實測:authenticated EXECUTE ⇒ true · anon ⇒ false · SECURITY DEFINER ⇒ true
--       ACL = `postgres=X/postgres , authenticated=X/postgres`
--       🟢 對照組 `admin_search_customers` 對 authenticated ⇒ **false**(那把尺會說「不」)
-- 🛑 而這條紅線寫在 `packages/adapters/src/supabase/mappers/order.ts` 上面幾行:
--    「**永不**夾帶 price / …;價 / 運費 / 歸屬 / tier **全 RPC server 權威算**」
--    ⇒ 而 `CLAUDE.md` Server 端鐵則逐字:「**不信任 client 送的欄位**」
-- 📌 **⇒ 判準(主視窗採用):職責分離是設計偏好, 客人填金額是漏洞 —— 兩者不同量級。**
-- 🔴 而**參數是【換掉】不是【加驗證】** —— 留著金額參數再加一道閘, 那個洞的形狀還在。
--
-- ══ 🔴🔴 而 3a 把券結帳【封住】(主視窗裁「丁」)═══════════════════════════════
--   本片:`p_coupon_code` 存在、管線接好, 而**任何非 null 值 ⇒ RAISE「優惠券結帳尚未啟用」**
--   3b :把那道 RAISE 換成 `public.redeem_coupon` 的試算呼叫
-- 🛑 為什麼:3a 若早於 3b(寫 redemption + 告警)上線, 帶券建單**扣不到券的三道上限**
--    ⇒ 同一張券可無限次用, 而沒有任何告警。
-- 📌 判準是【忘記的時候會發生什麼】:
--      寫進 apply 清單, 忘了 ⇒ 券可無限次用   🔴 洞
--      封住,           忘了 ⇒ 券結帳不啟用    ✅ 惰性
--    **⇒ 一個被遺忘的 3a 是【惰性的】, 不是【有洞的】。而它零新 DB 物件、零「要記得」。**
--
-- ══ 🔴 抄的是哪一代(抄錯一代 = 把後面幾代整個回捲, 而三綠不會紅)══════════
--   `bash scripts/latest-definition-of.sh create_order`:
--     newest = 20260825130000(repo 最後一代;共 9 代 / 14 個定義點)
--     live   = 20260825130000(帳本 APPLIED.tsv 最後一支已記的)⇒ ✅ 相同, 沒有漂
--   🛑 而工具自己印的射程照抄:**`live` 答的是【帳本】不是正式庫。**
--
-- ══ **函式本體**的 delta(而 DDL / ACL / 前置閘 / 自檢 另有實質差異)═══════════
--   ① 參數列 +1:`p_coupon_code text DEFAULT NULL`
--   ② 段 7:券碼有值 ⇒ RAISE(3a 封鎖);無值 ⇒ `v_discount_total := 0`;
--      `v_total := v_subtotal + v_shipping_fee - v_discount_total`
--   ③ INSERT 那個寫死的 `0` ⇒ `v_discount_total`
--
-- ══ 🔴🔴 apply 前的【硬前置條件】(codex R3 must-fix①)═══════════════════════
--   本檔 `DROP` + 重建 ⇒ **若正式庫那支身上有一個沒進 repo 的補丁, 它會被靜默覆蓋**,
--   而影響面是**每一張訂單**。
--   🛑 檔內那三格錨只證「我依賴的那三行沒漂」—— **證不了其餘 300 行沒漂。**
--   ✅ **2026-09-01 已比對過, 兩邊逐字相同 ⇒ 正式庫那支沒有沒進 repo 的補丁。**
--       正式庫(主視窗唯讀量, 只有它做得到):
--         md5 = `b0d1d644e370173d1de4c5b6c764c5a8` · 字元 14,337 · 行 337
--       repo 舊版 `20260825130000` 在乾淨 PG 上重建(本窗量):
--         md5 = `b0d1d644e370173d1de4c5b6c764c5a8` · 字元 14,337 · 行 337
--       🟢 各自重量一次皆同值 · 🟢 正對照 `admin_search_customers` ⇒ 不同 md5(尺會動)
--       🔵 負對照 現造函式名 ⇒ 查無(尺不亂報)
--   🔵 **而字元數/行數也帶著是刻意的** —— 它們給人眼一個粗篩:
--      若重建版差幾千字元, 不必比 md5 就知道有問題。
--   ⚠️ **而這個比對有一個前提, 明寫**:`pg_get_functiondef` 的輸出是**伺服器格式化過**的
--      ⇒ 兩邊 PG 版本不同時, md5 會因為排版而不同, 而那與「有沒有補丁」無關。
--      🔵 **本次【相同】⇒ 那個顧慮在這一發沒有咬到**(相同就是相同);
--         🛑 而**下一次重跑這個比對時, 若得到不同值, 第一件事是先問版本, 不是先假設有補丁。**
--   🛑 **而它是【2026-09-01 那一刻】的比對** —— apply 若拖到很久以後, 要重跑一次。
--   📌 這幾行寫在【檔案裡】而不是只寫在交接訊息裡 —— 因為 apply 的人會打開這支檔。
--
-- ══ 🔴 一格【到得了而本片沒解】的洞, 具名 ═══════════════════════════════════
--   上一代那道「整車 total <= 0 ⇒ RAISE」的閘**留著不動**, 而它的錯誤訊息逐字寫著:
--   「若這是合法的 0 元單(**全額折價券**/儲值金), **本閘需重議**」⇒ 它預告的正是這一片。
--   🔴 而它到得了(量到的):門市取貨 ⇒ 運費 0;或小計 ≥ 5000 ⇒ 運費 0
--     ⇒ 一張把小計折光的券 + 門市取貨 ⇒ `total = 0` ⇒ 建單直接 RAISE
--   🛑 而客人看到的是「付款失敗,請稍後再試」(`charge-actions.ts` 零原始 error 透傳)
--     ⇒ **而再試一次永遠不會成功。**
--   ⇒ **本片不改那道閘**(改它 = 允許 0 元單 = 另一片且是錢)。已交主視窗端 Sean。
--   🔵 而 3a 封住券結帳之後, 這一格**今天打不到** —— 它會隨 3b 一起到。
--
-- ══ rollback(forward-only)═════════════════════════════════════════════════
--   回捲 = 重新 apply `20260825130000` 那一版的函式本體(9 參數)。
--   ⛔ ~~`DEFAULT 0` 讓舊呼叫端不改也跑得動 ⇒ 回捲不必同時改 TS~~
--   🔴 **那句只有在「兩支並存」時成立, 而本檔 DROP 掉了舊簽名** ——
--      因為實測到並存會讓既有呼叫端拿到 `is not unique` 而**全部炸掉**(見自檢 ②)。
--   ✅ 正確的回捲 = **DROP 10 參數那支 + 重新 apply 20260825130000 的函式本體
--      + 重新 `GRANT EXECUTE … TO authenticated`**(DROP 會帶走 ACL)。
--   🔵 而 `DEFAULT 0` 仍然有用:它讓【還沒改的 TS 呼叫端】在新函式上跑得動 ⇒ **上線順序可以先 DB 後 TS。**
--   🛑 而回捲之後, **已經帶折扣建立的訂單不會被改回去** —— 那些單的 `discount_total` 留著。
--      那不是 bug, 是 forward-only 的代價。明寫。

BEGIN;

-- ══ 🔴🔴 前置閘 —— **逐字帶自上一代 `20260825130000`(它的段 1)** ═══════════════
--    ⛔ **本檔第一版【沒有】這段, 是 codex 抓到的。**
--    🛑 而那段的註解裡就寫著我今晚以為是自己發現的那句話 ——
--       「apply 成功」與「這支函式跑得動」是兩個宣稱, 而斷言只證明得了前者。
--    📌 **⇒ 我抄了函式本體, 而沒抄【它為什麼安全的那一半】。**
--       那 39 行距離我抄的第一行只有 39 行, 而我跳過了它們。

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
-- 🔴 **而上面兩個都管不到【貼到一半就斷了】那一種**(R3 nit;主視窗指定的角度之一)。
--    Sean 是在 SQL Editor 一支一支貼的。貼到 `CREATE TRIGGER` 之後、`COMMIT` 之前斷線
--    ⇒ 交易還開著、**已取得的鎖掛在上面** ⇒ `orders` 的寫入(結帳、收款)被擋住,
--      **一直到那個 session 死掉為止**。
--    ⚠️ `lock_timeout` 管的是【取鎖要等多久】, 不管【拿到之後抱多久】—— 兩件事。
--    ✅ 這一個管得到:閒置在交易中超過 120 秒 ⇒ PG 自己砍掉那個 session ⇒ 整包回捲。
SET LOCAL idle_in_transaction_session_timeout = '120s';

-- ── 段 1:前置閘 —— 🔴 這一段是【本檔實跑之後才補上的】, 而它的成因值得留著 ──────
--
--   本檔第一版**沒有**這段。在拋棄式庫上實跑時我量到:
--     `20260730120100`(N3b)自己 apply **失敗**(rc=3,因為 N3a 沒到位、產號器不存在),
--     🔴 **而本檔照樣 rc=0** —— 因為 plpgsql 是**晚綁定**的:函式體裡引用一支不存在的函式,
--        `CREATE OR REPLACE` 一樣會過, 我的字面斷言也一樣全綠(它們查的是 `prosrc` 文字)。
--   ⇒ **「apply 成功」與「這支函式跑得動」是兩個宣稱, 而本檔的斷言只證明得了前者。**
--   ⇒ 所以把 N3b 的前置閘逐字帶過來:本檔重下的是**整支 654 行**, 它繼承的依賴一個都沒少。
DO $$
BEGIN
  IF to_regprocedure('public.pcm_generate_display_id()') IS NULL THEN
    RAISE EXCEPTION '0 元閘前置失敗 — public.pcm_generate_display_id() 不存在。'
                    ' 請先套用 20260730120000(N3a);db push 應會自動依版本號排序';
  END IF;
  -- 🔴 `IS DISTINCT FROM true` 是承重的, 不是囉唆(codex R1 must-fix):
  --   產號器若回 `NULL`, `NULL !~ regex` 的結果是 **NULL 不是 true**
  --   ⇒ 寫成 `IF x !~ … THEN` 的話這個 IF **不成立 ⇒ 直接放行** ⇒ 前置閘假綠。
  --   ⚠️ 這個寫法是從 `20260730120100` 逐字抄來的 ⇒ **那一支也有同一個洞**(本片不改它)。
  IF (public.pcm_generate_display_id() ~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$') IS DISTINCT FROM true THEN
    RAISE EXCEPTION '0 元閘前置失敗 — pcm_generate_display_id() 的產出不符 §5.4a 合約(NULL 也算不符)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.orders'::regclass
       AND conname  = 'orders_display_id_format'
       AND pg_get_constraintdef(oid) LIKE '%[23456789BCDFGHJKMNPQRSTVWXYZ]{6}%'
  ) THEN
    RAISE EXCEPTION '0 元閘前置失敗 — orders_display_id_format 沒有接受新 6 碼格式的分支。'
                    ' 請先套用 20260729010000(D0);否則本片 apply 會全綠、'
                    ' 但第一筆真結帳會死在 check_violation(不重試、對客一般失敗)';
  END IF;
END
$$;


-- 🔵 **本片【沒有】redeem_coupon 的前置閘, 而那是刻意的** ——
--    3a 的券碼分支是一道 RAISE, 它不呼叫那支函式 ⇒ **斷言一個沒用到的相依 = 說謊**。
--    ⇒ 那兩道閘(存在 / owner 有 EXECUTE)寫在券碼分支的註解裡, 由 3b 帶回來。

-- ══ 前置閘結束 ═══════════════════════════════════════════════════════════

-- ── 🔴 先 DROP 舊簽名 ──────────────────────────────────────────
-- 為什麼:見下面自檢 ② 的那段實測 —— 兩支並存會讓既有呼叫端拿到 `is not unique` 而全部炸。
-- 🛑 而 DROP 會連它的 ACL 一起帶走 ⇒ 下面必須重新授權(那是本檔最容易漏的一格)。
-- 🔴 **本片【不 DROP】** —— 而 3a 那一支 DROP 了, 兩者的理由不同, 寫清楚:
--    3a 是在【加一個參數】⇒ `CREATE OR REPLACE` 加 DEFAULT 參數會建出**第二支 overload**
--      (3a 用拋棄式 PG 實測過:1 支 ⇒ 2 支, 而舊呼叫拿到 `function … is not unique`)
--      ⇒ 它非 DROP 不可, 而 DROP 會**帶走 ACL** ⇒ 3a 檔尾才要重新 REVOKE + GRANT。
--    本片**參數一個字都沒動**(仍是那 10 個)⇒ `CREATE OR REPLACE` 就地替換、**ACL 原封不動**
--      ⇒ 不 DROP、也就不必重新授權。
-- ⛔ ~~原句(從 3a 抄來的)`DROP FUNCTION IF EXISTS public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text);`~~
--    **拿掉** —— 那是【9 參數】的舊簽名, 3a 已經 DROP 過它了 ⇒ 在這裡是一句 no-op。
--    🔴 而一句 no-op 的 DROP 比沒有更糟:**它讀起來像「本片有處理簽名問題」**,
--       而下一個真的要改參數的人會以為照抄它就夠了。
-- 🛑 而【參數若有一天真的要動】:照 3a 那一套(DROP + CREATE + 三道 REVOKE + GRANT + ACL 斷言),
--    不要只把上面那行貼回來。

CREATE OR REPLACE FUNCTION public.create_order(
  p_lines              jsonb,
  p_address_id         uuid,
  p_shipping_method    text,
  p_invoice            jsonb,
  p_cart_session_id    uuid,
  p_terms_version      text,
  p_client_ip          text,
  p_client_ua          text,
  p_notification_email text DEFAULT NULL,  -- 🔴 B-2 過渡期 DEFAULT;B-6 移除
  -- ⛔ ~~`p_discount_total integer DEFAULT 0` —— 「它只是接受一個已經算好的金額」~~
  -- 🔴🔴 **那一版有一個洞, 而它是 codex 抓到、主視窗自己去正式庫量過的**:
  --    `create_order` 是 SECURITY DEFINER 且 `GRANT EXECUTE … TO authenticated`,
  --    而 Supabase 把 public schema 的函式**全部開成 PostgREST RPC 端點**
  --    ⇒ **任何登入的客人拿 anon key + 自己的 JWT 就叫得動它, 並自己填那個金額。**
  --    ⇒ 把 5000 的單折到 1 元, 不需要任何一張券。
  --    🟢 主視窗 2026-09-01 正式庫實測:`authenticated` 對它的 EXECUTE ⇒ **true**;
  --       anon ⇒ false;ACL = `postgres=X/postgres , authenticated=X/postgres`;
  --       🟢 對照組 `admin_search_customers` 對 authenticated ⇒ **false**(那把尺會說「不」)
  -- 🛑 **而這條紅線就寫在 `packages/adapters/src/supabase/mappers/order.ts:142-143`**:
  --    「**永不**夾帶 price / unitPrice / tier / …;價 / 運費 / 歸屬 / tier **全 RPC server 權威算**」
  --    ⇒ 📌 一個【客人送進來的金額】正是那條禁的東西。
  --
  -- ✅ **改成收【券碼】** —— 而這不是「把券的邏輯搬進來」, 是**不再相信呼叫端算的數**:
  --    本函式**不懂**低消 / 上限 / 有效期 / 誰能用 —— 它只做**一次呼叫**, 去問那個既有的權威。
  -- 🔴 **而參數是【換掉】不是【加驗證】** —— 留著金額參數再加一道閘, 那個洞的形狀還在。
  p_coupon_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
PARALLEL UNSAFE
CALLED ON NULL INPUT
NOT LEAKPROOF
COST 100
SET search_path = ''
AS $fn$
DECLARE
  v_uid            uuid := (select auth.uid());
  -- 🔴 券片3:折扣由 `redeem_coupon` 算, 這兩個只是接它的結果。
  v_coupon         jsonb;
  v_coupon_calc    jsonb;    -- 3b:`redeem_coupon` 試算的回傳 {valid, discount_applied, coupon_id}
  v_coupon_id      uuid;     -- 3b:寫進 orders.coupon_id 的那張券(NULL = 沒帶券)
  v_discount_total integer;
  v_addr           record;
  v_line           jsonb;
  v_variant        record;
  v_qty            integer;
  v_variant_id     uuid;
  v_supplier_slug  text;
  v_sku            text;
  v_unit_price     integer;
  v_line_total     bigint;
  v_subtotal       bigint := 0;
  v_shipping_fee   integer;
  v_total          bigint;
  v_seen_variants  uuid[] := '{}';
  v_items          jsonb := '[]'::jsonb;
  v_invoice        jsonb;
  v_addr_snapshot  jsonb;
  v_display_id     text;
  -- N3b delta:v_seq_text 移除(不再用序號產號);新增有界重試所需兩個變數。
  v_attempt        integer;
  v_cname          text;
  v_order_id       uuid;
  -- 🔴 V-3a delta:vehicle 白名單重組工作變數(其餘 DECLARE 逐字同 20260630120000)
  v_veh            jsonb;
  v_veh_ok         boolean;
  v_veh_year       integer;
  v_vehicle        jsonb;
BEGIN
  -- ── 0. 🔴 3DS-0b cart_session_id null fail-closed ──
  IF p_cart_session_id IS NULL THEN
    RAISE EXCEPTION 'create_order: 缺 cart_session_id(cross-tab idempotency key)';
  END IF;

  -- ── 0b. 🔴 #241 同意條款 guard(create_order 路徑「無 consent 不生 order」;codex H4 空字串、B2 限縮為本路徑)──
  IF p_terms_version IS NULL OR pg_catalog.btrim(p_terms_version) = '' THEN
    RAISE EXCEPTION 'create_order: 缺同意條款版本(consent)';
  END IF;

  -- ── 1. 身分 + customer profile(fail-closed)──
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'create_order: 未登入(auth.uid NULL)';
  END IF;
  PERFORM 1 FROM public.customers WHERE user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_order: 查無 customer profile(uid=%)', v_uid;
  END IF;

  -- ── 2. 地址歸屬(必為本人、否則 raise;快照凍結履約地址)──
  SELECT id, name, phone, line
    INTO v_addr
    FROM public.customer_addresses
   WHERE id = p_address_id AND customer_user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_order: 地址非本人或不存在(address_id=%)', p_address_id;
  END IF;
  v_addr_snapshot := pg_catalog.jsonb_build_object(
    'name', v_addr.name, 'phone', coalesce(v_addr.phone, ''), 'line', v_addr.line
  );

  -- ── 3. 配送方式白名單(home/store)──
  IF p_shipping_method IS NULL OR p_shipping_method NOT IN ('home', 'store') THEN
    RAISE EXCEPTION 'create_order: 配送方式非白名單(%);僅 home/store', p_shipping_method;
  END IF;

  -- ── 4. 發票類型 ──
  IF p_invoice IS NULL OR pg_catalog.jsonb_typeof(p_invoice) <> 'object'
     OR (p_invoice->>'type') IS NULL OR (p_invoice->>'type') NOT IN ('personal', 'company', 'donate') THEN
    RAISE EXCEPTION 'create_order: 發票類型非法或缺失(%)', p_invoice->>'type';
  END IF;
  v_invoice := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'type',       p_invoice->>'type',
    'carrier',    p_invoice->>'carrier',
    'title',      p_invoice->>'title',
    'taxId',      p_invoice->>'taxId',
    'donateCode', p_invoice->>'donateCode'
  ));

  -- ── 5. 購物車非空 + 品項數上限 ──
  IF p_lines IS NULL OR pg_catalog.jsonb_typeof(p_lines) <> 'array' OR pg_catalog.jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'create_order: 購物車為空';
  END IF;
  IF pg_catalog.jsonb_array_length(p_lines) > 200 THEN
    RAISE EXCEPTION 'create_order: 購物車品項超過上限(200)';
  END IF;

  -- ── 6. 逐 line ──
  FOR v_line IN SELECT e FROM pg_catalog.jsonb_array_elements(p_lines) AS e
  LOOP
    v_qty := (v_line->>'qty')::integer;
    IF v_qty IS NULL OR v_qty <= 0 OR v_qty > 10000 THEN
      RAISE EXCEPTION 'create_order: 數量非法或超過上限 1-10000(qty=%)', v_line->>'qty';
    END IF;

    v_variant_id    := nullif(v_line->>'variant_id', '')::uuid;
    v_supplier_slug := v_line->>'supplier_slug';
    v_sku           := v_line->>'sku';

    IF v_variant_id IS NOT NULL THEN
      SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.availability AS variant_availability,
             p.title, p.delisted_at, p.availability AS product_availability
        INTO v_variant
        FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
       WHERE pv.id = v_variant_id;
    ELSIF v_supplier_slug IS NOT NULL AND v_sku IS NOT NULL THEN
      SELECT pv.id, pv.sku, pv.spec, pv.price_general, pv.availability AS variant_availability,
             p.title, p.delisted_at, p.availability AS product_availability
        INTO v_variant
        FROM public.product_variants pv
        JOIN public.products p ON p.id = pv.product_id
       WHERE pv.supplier_slug = v_supplier_slug AND pv.sku = v_sku;
    ELSE
      RAISE EXCEPTION 'create_order: line 缺 variant_id 或 (supplier_slug,sku)';
    END IF;

    IF v_variant.id IS NULL THEN
      RAISE EXCEPTION 'create_order: 找不到 variant(variant_id=%, supplier_slug=%, sku=%)', v_variant_id, v_supplier_slug, v_sku;
    END IF;

    IF v_variant.id = ANY(v_seen_variants) THEN
      RAISE EXCEPTION 'create_order: 重複 variant(%);同變體應合併 qty', v_variant.id;
    END IF;
    v_seen_variants := v_seen_variants || v_variant.id;

    IF v_variant.delisted_at IS NOT NULL THEN
      RAISE EXCEPTION 'create_order: 商品已下架(variant=%)', v_variant.id;
    END IF;

    v_unit_price := v_variant.price_general;
    -- 🔴 2026-08-25:`<= 0` → `< 0`。Sean 拍板【0 元是合法價格】(贈品 / 買一送一的那個
    --   「送」/ 試用品)⇒ 這道閘原本把贈品判成「無有效價格」而擋在結帳。
    --   ⚠️ **`IS NULL` 那半一個字都沒動** —— 它擋的是「查不到價格」, 與「0 元」是兩件事。
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'create_order: 變體無有效 price_general(variant=%)', v_variant.id;
    END IF;

    IF pg_catalog.jsonb_typeof(v_variant.spec) <> 'object'
       OR NOT public.m3_jsonb_values_all_string(v_variant.spec)
       OR (v_variant.spec ?| array['price_store','price_by_tier','cost']) THEN
      RAISE EXCEPTION 'create_order: variant spec 非法(非 object/含非字串值/含敏感鍵)(variant=%)', v_variant.id;
    END IF;

    v_line_total := v_unit_price::bigint * v_qty;
    IF v_line_total > 2147483647 THEN
      RAISE EXCEPTION 'create_order: 單筆金額溢位(variant=%, line_total=%)', v_variant.id, v_line_total;
    END IF;
    v_subtotal := v_subtotal + v_line_total;
    IF v_subtotal > 2147483647 THEN
      RAISE EXCEPTION 'create_order: 訂單小計溢位(subtotal=%)', v_subtotal;
    END IF;

    -- ── 6v. 🔴 V-3a delta:optional vehicle 白名單重組(鏡像 §4 p_invoice 手法;禁 v_line->'vehicle' 直存)──
    --   逐 kind 隔離(verdict REQUIRED-3):dict 只收 brand/model/year/source(不收 raw)、
    --   free 只收 raw/year/source(不收 brand/model);非空 text ≤200;year=JSON number 4 位整數
    --   1900-2100(regex 先驗防 ::integer 溢位 RAISE)。任何不合 → 該 line v_vehicle=NULL、
    --   不 RAISE 不擋單(選填;與 @pcm/schemas .catch(undefined) 同構)。車種鐵律:零正規化、字面凍結。
    v_vehicle := NULL;
    v_veh := v_line->'vehicle';
    IF v_veh IS NOT NULL AND pg_catalog.jsonb_typeof(v_veh) = 'object' THEN
      v_veh_ok := true;
      v_veh_year := NULL;
      IF v_veh ? 'year' THEN
        -- 🔴 cast 與驗證分離(reviewer Important):::integer 只在 regex 4 位通過「之後」的獨立
        --   statement 執行=可證明無溢位 RAISE(不依賴 AND 短路順序=PG 官方不保證求值順序);
        --   typeof/regex 本身無異常面(->> 回 text/NULL、NULL~pattern=NULL)。
        IF pg_catalog.jsonb_typeof(v_veh->'year') = 'number'
           AND (v_veh->>'year') ~ '^[0-9]{4}$' THEN
          v_veh_year := (v_veh->>'year')::integer; -- regex 已限 4 位、cast 恆安全
          IF v_veh_year < 1900 OR v_veh_year > 2100 THEN
            v_veh_ok := false; -- 超界=整顆作廢(兩層同構;非法不擋單)
          END IF;
        ELSE
          v_veh_ok := false; -- year 形狀不合=整顆作廢(兩層同構;非法不擋單)
        END IF;
      END IF;
      IF v_veh_ok AND v_veh->>'kind' = 'dict' THEN
        IF pg_catalog.jsonb_typeof(v_veh->'brand') = 'string'
           AND pg_catalog.jsonb_typeof(v_veh->'model') = 'string'
           AND coalesce(pg_catalog.btrim(v_veh->>'brand'), '') <> '' AND pg_catalog.length(v_veh->>'brand') <= 200
           AND coalesce(pg_catalog.btrim(v_veh->>'model'), '') <> '' AND pg_catalog.length(v_veh->>'model') <= 200
           AND (v_veh->>'source') IN ('search', 'garage', 'picker') THEN
          v_vehicle := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'kind', 'dict', 'brand', v_veh->>'brand', 'model', v_veh->>'model',
            'year', v_veh_year, 'source', v_veh->>'source'
          ));
        END IF;
      ELSIF v_veh_ok AND v_veh->>'kind' = 'free' THEN
        IF pg_catalog.jsonb_typeof(v_veh->'raw') = 'string'
           AND coalesce(pg_catalog.btrim(v_veh->>'raw'), '') <> '' AND pg_catalog.length(v_veh->>'raw') <= 200
           AND (v_veh->>'source') IN ('garage', 'freetext') THEN
          v_vehicle := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
            'kind', 'free', 'raw', v_veh->>'raw',
            'year', v_veh_year, 'source', v_veh->>'source'
          ));
        END IF;
      END IF;
    END IF;

    v_items := v_items || pg_catalog.jsonb_build_object(
      'variant_id',       v_variant.id,
      'variant_sku',      v_variant.sku,
      'product_snapshot', pg_catalog.jsonb_build_object('title', v_variant.title, 'sku', v_variant.sku, 'spec', v_variant.spec),
      'quantity',         v_qty,
      'unit_price',       v_unit_price,
      'line_total',       v_line_total,
      'availability_at_checkout',
        CASE WHEN v_variant.variant_availability = 'in-stock'
              AND v_variant.product_availability = 'in-stock'
             THEN 'in-stock' ELSE 'out-of-stock' END,
      -- 🔴 V-3a delta:白名單重組後快照(NULL → JSON null → §9 NULLIF 轉回 SQL NULL)
      'vehicle',          v_vehicle
    );
  END LOOP;

  -- ── 7. 運費 ──
  IF p_shipping_method = 'store' THEN
    v_shipping_fee := 0;
  ELSE
    v_shipping_fee := CASE WHEN v_subtotal >= 5000 THEN 0 ELSE 100 END;
  END IF;
  -- 🔴🔴 **折扣在這裡算出來(券片3)** —— 而算它的是 `redeem_coupon`, 不是呼叫端。
  IF p_coupon_code IS NULL OR pg_catalog.btrim(p_coupon_code) = '' THEN
    v_discount_total := 0;   -- 沒帶券碼 ⇒ 零折扣, 其餘一切不變
  ELSE
    -- 🔴🔴🔴 **3a 刻意【封住】券結帳** —— 主視窗 2026-09-01 裁定「丁」。
    --
    -- ⛔ ~~這裡原本呼 `public.redeem_coupon(...)` 試算~~ ⇒ **3a 單獨上線時那是一個洞**:
    --    codex R2 逐字:3a 若早於 3b apply, `authenticated` 可以直接呼 RPC、帶一張有效券碼
    --    建折扣單、照既有付款路徑付折後價, **而 redemption 那一列不會被寫**(那在 3b)
    --    ⇒ 券的三道上限(總量 / 每人 / 已用)**永遠不會被扣** ⇒ **同一張券可以無限次用**,
    --      而沒有任何告警(告警也在 3b)。
    --
    -- 🔵 **為什麼是「封住」而不是「寫進 apply 清單」** —— 判準是【忘記的時候會發生什麼】:
    --      寫清單, 忘了 ⇒ **券可以無限次用**(洞)
    --      封住,   忘了 ⇒ **券結帳不會啟用**(惰性)
    --    📌 **⇒ 一個被遺忘的 3a 是【惰性的】, 不是【有洞的】。那就是全部。**
    --    📌 **⇒ 而這是「機制優先於規則」更省的一種:機制不必是新東西,
    --       它可以是【讓預設值變成安全的那一邊】。**(零新 DB 物件、零「要記得」)
    --
    -- 🛑🛑 **3b 的第一件事就是把這一段換成那次試算呼叫** ——
    --    而 3b 的 plan 要逐字寫「本片解除 3a 的封鎖」,
    --    ⇒ **那樣兩片的關係在碼上看得見, 不在任何人的記憶裡。**
    -- ⚠️ 換回去的時候, 這兩道前置閘要一起帶回來(它們現在不在本檔, 因為本檔不呼叫它):
    --      ① `public.redeem_coupon(text,uuid,integer,boolean,uuid)` 必須存在
    --      ② 本函式的 owner 對它必須有 EXECUTE
    --         (`create_order` 是 SECURITY DEFINER ⇒ 執行期 current_user = owner;
    --          而 `redeem_coupon` 被 REVOKE 到只剩 service_role ⇒ owner 不同就 permission denied)
    -- ══════════════════════════════════════════════════════════════════════
    -- 🔵🔵 **本片(3b)解除 3a 的封鎖 —— 上面那道 RAISE 就是被這一段換掉的。**
    --    3a `20260901003000:437-439` 逐字:
    --      'create_order: 優惠券結帳尚未啟用(券片3b 未上線)—— 本次請不要帶券碼(收到 %)'
    --    ⇒ 兩片的關係在碼上看得見, 不在任何人的記憶裡。
    -- ══════════════════════════════════════════════════════════════════════

    -- ── 🔴 前置閘① `redeem_coupon` 必須存在(3a 檔頭交代要一起帶回來的那兩道)────
    --    為什麼是閘不是註解:plpgsql **晚繫結** —— 函式本體不在 CREATE 時解析
    --    ⇒ 這支 migration 在 `redeem_coupon` 不存在時**照樣 apply 成功 rc=0**,
    --      而第一個帶券碼結帳的客人才會炸。⇒ **要在 apply 當下就叫。**
    --    (閘本身在檔尾的 DO 區塊, 不在這裡 —— 這裡是執行期, 那裡是 apply 期。)

    -- ── 試算(dry-run):`p_order_id` 不傳 ⇒ 唯讀、不鎖列、不寫 redemption ────────
    --    🔴 **兌換那一列不在這裡寫** —— Sean 拍的是「收款成功才寫」⇒ 那在 022000。
    --       這裡只問「這張券現在能折多少」, 而**券的三道上限還沒有被扣。**
    --    ⚠️ ⇒ 這中間有一個真實的窗口:下單到付款之間, 同一張限量券可以被多人試算成功。
    --       022000 那支在真的寫 redemption 時會 `FOR UPDATE` 鎖券再數一次 ⇒ **後到的那個會失敗**,
    --       而那時走丙(收款成功 + 告警 + 人工旗標)。**那是設計, 不是漏洞** —— 寫在這裡免得有人以為漏了。
    v_coupon_calc := public.redeem_coupon(
      pg_catalog.btrim(p_coupon_code),
      v_uid,
      v_subtotal::integer,
      -- 🔴 `p_has_tier_price`:**從寫進 `tier_at_checkout` 的那個值推**, 不另外寫一個字面。
      --    今天那一格是寫死的 `'general'`(下方 INSERT :509)⇒ 恆 false。
      --    📌 **為什麼不直接寫 `false`**:寫 false 的話, 經銷價那天有人改了 INSERT 那一格,
      --       這裡不會跟著動、也不會紅 ⇒ **兩個地方各自說同一件事而不一致。**
      --    ⇒ 綁在同一個來源上, 那天改一處就好。
      ('general'::public.member_tier) <> 'general'::public.member_tier
    );

    IF v_coupon_calc IS NULL OR NOT coalesce((v_coupon_calc->>'valid')::boolean, false) THEN
      -- 🔴 券不能用 ⇒ **擋下整張單**, 不是「忽略券照建單」。
      --    忽略的話客人會拿到一張沒有折扣的單而他以為有 ⇒ 錢的事不做「安靜降級」。
      RAISE EXCEPTION
        'create_order: 這張優惠券不能用(reason=%)—— 券碼 %',
        coalesce(v_coupon_calc->>'reason', 'unknown'),
        pg_catalog.btrim(p_coupon_code);
    END IF;

    v_discount_total := (v_coupon_calc->>'discount_applied')::integer;
    v_coupon_id      := (v_coupon_calc->>'coupon_id')::uuid;

    -- 🔴 **兩欄要一起有, 或一起沒有** —— `orders_discount_needs_coupon`(`20260901020000`)
    --    是雙向的 `(discount_total > 0) = (coupon_id IS NOT NULL)`。
    --    這裡先自己叫一次, 因為 **23514 的訊息說不出是哪一半漏了**。
    IF v_coupon_id IS NULL THEN
      RAISE EXCEPTION
        'create_order: redeem_coupon 說券有效卻沒回 coupon_id —— 契約破了(回傳 %)', v_coupon_calc;
    END IF;
    IF v_discount_total IS NULL OR v_discount_total <= 0 THEN
      RAISE EXCEPTION
        'create_order: redeem_coupon 說券有效卻折 %(Sean 2026-08-31 拍最低折 1 元)—— 契約破了', v_discount_total;
    END IF;
  END IF;

  -- 🛑 縱深:上面那支已經夾過上下限, 而**這裡再夾一次** ——
  --    它防的不是券的邏輯, 是「有一天有人改了那支而忘了這裡」。
  IF v_discount_total IS NULL OR v_discount_total < 0 THEN
    RAISE EXCEPTION 'create_order: 算出來的折扣不是非負整數(%)', v_discount_total;
  END IF;
  IF v_discount_total > v_subtotal THEN
    -- ✅ **上限基準【已定案】—— Sean 2026-09-01 拍【不可以】(券不吃運費)。**
    --    落檔逐字:「2026-09-01 Sean 拍【不可以】—— 券的上限 = 商品金額, 運費照付」
    --    為什麼(我提的理由, 現在是這條規則的為什麼):低消比的是小計、百分比乘的是小計
    --    ⇒ 讓它吃運費 = **同一張券兩個基準**, 而客人與員工算不出同一個數字。
    -- ⛔ ~~原句「上限基準未定案 —— Sean 2026-09-01 待拍」~~ **作廢**(答案來了)。
    --    ⚠️ 而**稿那一側仍然不同**:`design-reference/components/CheckoutPage.jsx:95` 逐字
    --      `Math.max(0, subtotal + shipping - couponDiscount)` ⇒ 折的是小計 + 運費。
    --    ⇒ **以拍板為準, 稿要跟著改**(鐵則 1 的例外:稿本身不知道自己過期了)。
    --      ⇒ 那是 3c(券的 UI 片)的事, 不是本片 —— **而它要有人去做, 已寫進 plan §6。**
    -- 🔵 而券 RPC `20260831160000` 的 `least(v_calc, p_subtotal)` **已經是這個行為** ⇒ 那支不用改。
    --    ⇒ 所以本行這道縱深閘理論上永遠不會叫 —— **而它留著, 因為它防的是「有人改了那支而忘了這裡」。**
    RAISE EXCEPTION
      'create_order: 算出來的折扣 % 超過小計 %(券不吃運費, Sean 2026-09-01 拍)', v_discount_total, v_subtotal;
  END IF;
  v_total := v_subtotal + v_shipping_fee - v_discount_total;
  IF v_total > 2147483647 THEN
    RAISE EXCEPTION 'create_order: 訂單總額溢位(total=%)', v_total;
  END IF;
  -- 🔴🔴 2026-08-25 新閘:整車金額為 0 ⇒ 擋在建單前(Sean 拍甲「順手加一道」)。
  --
  --   **這【不是】一條「訂單金額必須大於 0」的商業規則。** 它說的是一件工程事實:
  --   一張 total = 0 的單, **目前沒有一條路付得掉它** —— 刷卡腿與付款帳本都拒 0。
  --   ⚠️ **而「它們拒 0」是從那兩道的【定義】讀來的, 本片沒有實跑那兩道。** 這一格是推論。
  --
  --   為什麼它會發生:0 元贈品放行之後, 「只有贈品 + 門市取貨」⇒ subtotal 0 + 運費 0 ⇒ total 0。
  --   Sean 早先拍的「贈品永遠跟著別的商品一起買」是**業務假設, 不是一道閘** ——
  --   `create_order` 與購物車都沒有在強制它。本閘把那個假設變成一道真的閘。
  --
  --   🔴 **日後若出現【合法的 0 元單】, 這道閘要一起重議, 不是繞過它**:
  --     · 100% 折抵的優惠券(Sean 2026-08-24 已把優惠券從「零條目」拍成要做)
  --     · 全額儲值金付款
  --     · 全額折抵的退換貨補寄
  --   那時要問的是「這張 0 元單走哪一條付款路」, 而不是「怎麼讓它通過」。
  --
  --   ⚠️ 誤擋乾跑(2026-08-25 service_role 對正式站實測, 只取 count):
  --     orders 20 筆 · `total = 0` ⇒ **0 筆** · `total < 0` ⇒ 0 筆 · `subtotal = 0` ⇒ 0 筆
  --     order_items 23 筆 · `unit_price = 0` ⇒ 0 筆
  --     尺的證明:撈一筆真的 total(13050)回頭 `eq.` 它 ⇒ 命中 1(算子挑得出東西);
  --               負對照 `total = -987654321` ⇒ 0;正對照 `total > 0` ⇒ 20 = 全部(加法自洽)
  --   ⇒ **對現有資料誤擋 0 筆。**
  --
  --   📌 客人面看到的**不是**這句話:`charge-actions.ts:364` 零原始 error 透傳,
  --     一律回 `MSG.generic`(`:86` 逐字「付款失敗,請稍後再試或聯繫客服 LINE」)。
  --     ⚠️ 而那句對本情境**是誤導的** —— 再試一次永遠不會成功。客人面文案要另外處理(未做)。
  -- ══════════════════════════════════════════════════════════════════════════
  -- 🔴🔴 **本片(0 元單)重議這道閘 —— 而它底下疊著【兩個完全不同的規則】。**
  -- ══════════════════════════════════════════════════════════════════════════
  -- ⛔ ~~原版 `IF v_total <= 0 THEN RAISE`~~ —— 一個條件, 兩件事:
  --    ① **只有贈品的車**(subtotal 0 + 門市取貨運費 0)⇒ **仍然要擋。**
  --       上面那段註解逐字:「Sean 早先拍的『贈品永遠跟著別的商品一起買』是**業務假設,
  --       不是一道閘** —— `create_order` 與購物車都沒有在強制它。**本閘把那個假設變成一道真的閘。**」
  --       ⇒ 📌 **這道閘是那條業務規則【唯一的執行者】。**
  --    ② **全額券把它折到 0** ⇒ **要放行**(本片)。
  --
  -- 🛑 **⇒ 若照字面把 `<= 0` 整個拿掉, Sean 那條業務假設就沒有執行者了 —— 而不會有任何東西紅。**
  --    ⇒ 那會是「照著指示做」而靜靜拆掉另一條規則。**救我的是去讀了它的完整註解, 不是條件。**
  --    ⇒ 而寫那段註解的人**知道自己在承擔什麼, 而他寫下來了** —— 今晚它救了一次。
  --
  -- 🟢🟢 **而「我沒有拆掉贈品那條規則」不是宣稱, 是餵出來的**(拋棄式 PG, 2026-09-01):
--    把商品價設成 0 ⇒ 只有那一項 + 門市取貨 + **不帶券** ⇒ `create_order`
--    ⇒ `ERROR: create_order: 整車金額為 0 而這張單沒有帶券(subtotal=0, shipping_fee=0)—— 贈品需與正價商品同車`
--    ⇒ **贈品那條路一格都沒有被放寬。**
--    📌 沒有這一格, 上面那整段話只是我說的。
--
-- ✅ 而那段註解自己要求的是:「那時要問的是【這張 0 元單走哪一條付款路】,
  --    而不是【怎麼讓它通過】」⇒ 本片開了 `public.settle_zero_total_order()` 回答第一個問題。
  --    **這是重議, 不是繞過。**
  --
  -- 🔵 **而負數與 0 被 `<= 0` 壓成同一件事, 它們的成因完全不同** ⇒ 本片把它們拆開:
  IF v_total < 0 THEN
    -- **無條件擋。**這不是「沒有付款路徑」, 這是算錯了 —— 折扣的上下限、運費、小計有一個是壞的。
    -- ⇒ 它要吵, 而且訊息要與 0 元那一支分得開, 否則查的人會被帶去看券。
    RAISE EXCEPTION
      'create_order: 整車金額為負(subtotal=%, shipping_fee=%, discount=%, total=%)—— 這是算式壞了, 不是 0 元單',
      v_subtotal, v_shipping_fee, v_discount_total, v_total;
  END IF;
  IF v_total = 0 AND v_coupon_id IS NULL THEN
    -- ① 那條路**一格都沒有被放寬** —— 訊息逐字照舊(只補上「而它現在只擋沒有券的那一種」)。
    RAISE EXCEPTION
      'create_order: 整車金額為 0 而這張單沒有帶券(subtotal=%, shipping_fee=%)—— 贈品需與正價商品同車。'
      '(帶了全額折抵券的 0 元單走 settle_zero_total_order, 見 20260901030000)',
      v_subtotal, v_shipping_fee;
  END IF;
  -- ⇒ 走到這裡的 `v_total = 0` 一定帶著券 ⇒ 放行, 而它的付款路是 `settle_zero_total_order`。

  -- ── 8. 產號 + 寫 order(N3b:6 碼亂碼 + 有界重試)──
  -- 🔴 唯一 delta 就在這一段。重試迴圈**只包 orders 的 INSERT**:
  --    plpgsql 的 BEGIN…EXCEPTION 是子交易,捕捉後只回滾這一次 INSERT;
  --    8b 的 consent 與 9 的 items 都排在迴圈之後 ⇒ 不會被重複寫入。
  -- 🔴 重試迴圈刻意寫在這一層、不在 helper 裡(v2 §5.4a / R3):
  --    helper 只回候選值,它不可能捕捉 INSERT 的 unique violation。
  v_order_id := NULL;
  FOR v_attempt IN 1 .. 5 LOOP
    BEGIN
      v_display_id := public.pcm_generate_display_id();

      INSERT INTO public.orders (
        display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
        subtotal, shipping_fee, discount_total, total, shipping_method, invoice, cart_session_id,
        notification_email, coupon_id
      ) VALUES (
        v_display_id, v_uid, p_address_id, v_addr_snapshot, 'general'::public.member_tier,
        v_subtotal::integer, v_shipping_fee, v_discount_total, v_total::integer, p_shipping_method, v_invoice, p_cart_session_id,
        p_notification_email, v_coupon_id
      )
      RETURNING id INTO v_order_id;

      EXIT;   -- 成功寫入 ⇒ 離開重試迴圈
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      -- 🔴 只吞 display_id 的碰撞。其他 unique violation(例如 cart_session_id 去重、
      --    tappay_rec_trade_id)**原樣上拋** —— 那些是語意訊號,重試會把它們吃掉。
      IF v_cname IS DISTINCT FROM 'orders_display_id_key' THEN
        RAISE;
      END IF;
      v_order_id := NULL;
      IF v_attempt = 5 THEN
        -- 明確報錯、不靜默、不降級。token 供 app 層 catch 後告警(N3b-app、backlog #300)。
        RAISE EXCEPTION 'create_order: display_id 連續 5 次碰撞、已放棄'
                        ' (pcm_display_id_exhausted)'
          USING ERRCODE = 'P0001';
      END IF;
    END;
  END LOOP;

  -- 迴圈理論上不可能在未設值的情況下離開(成功才 EXIT、用盡必 RAISE),
  -- 但「理論上不可能」也是一條沒被測的斷言 ⇒ 明寫出來、fail-closed。
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'create_order: 重試迴圈結束但 v_order_id 未設值(不該發生)'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── 8b. 🔴 #241 同 transaction 原子寫同意紀錄(Gemini 否決拆 RPC 的幽靈訂單;create_order 路徑無 consent 不生 order)──
  --    IP/UA left() 截斷(codex M8;NULL 輸入 left 回 NULL、容忍 best-effort 缺值)。
  INSERT INTO public.order_legal_consents (order_id, terms_version, consented_at, client_ip, client_user_agent)
  VALUES (v_order_id, p_terms_version, pg_catalog.now(),
          pg_catalog.left(p_client_ip, 128), pg_catalog.left(p_client_ua, 1024));

  -- ── 9. 寫 items(V-3a delta:多寫 vehicle_snapshot;NULLIF 把 JSON null 轉回 SQL NULL)──
  FOR v_line IN SELECT e FROM pg_catalog.jsonb_array_elements(v_items) AS e
  LOOP
    INSERT INTO public.order_items (
      order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total, availability_at_checkout, vehicle_snapshot
    ) VALUES (
      v_order_id,
      (v_line->>'variant_id')::uuid,
      v_line->>'variant_sku',
      v_line->'product_snapshot',
      (v_line->>'quantity')::integer,
      (v_line->>'unit_price')::integer,
      (v_line->>'line_total')::integer,
      v_line->>'availability_at_checkout',
      NULLIF(v_line->'vehicle', 'null'::jsonb)
    );
  END LOOP;

  -- ── 10. return DTO ──
  RETURN pg_catalog.jsonb_build_object('order_id', v_order_id, 'display_id', v_display_id);
END;
$fn$;

-- ── 段 5:COMMENT ───────────────────────────────────────────────

-- ── 🔴🔴 權限:新簽名 = 【新物件】⇒ 它出生自帶 PUBLIC EXECUTE, 而舊那支的授權【不會跟過來】
-- 舊那支的授權(`20260719120000:514` 逐字):`GRANT EXECUTE … TO authenticated;`
-- ⇒ 不重新授權的話:客人結帳當場 permission denied, 而 **PUBLIC 反而執行得了**。
-- 📌 **一個「只是加一個參數」的改動, 把一支函式的權限整個重置了 —— 而 diff 上看不出來。**
REVOKE ALL ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text) FROM anon;
-- 🔴 具名角色不會被 `FROM PUBLIC` 收到 ⇒ 先收乾淨再重發, 免得留下 GRANT OPTION。
REVOKE ALL ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text) FROM authenticated;
-- ACL-GATE-EXEMPT: public.create_order -- 還原 20260719120000:514 既有授權;客人結帳唯一入口(2026-09-01)
-- 🔴 **為什麼不是 service_role**:結帳是【客人自己】按的, 身分由函式內 `auth.uid()` 重查
--    ⇒ 它必須以登入客人的 JWT 呼叫 ⇒ 只有 `authenticated` 拿得到。
--    改成 service_role = 要 server 代打, 而那會讓 `auth.uid()` 變成 server 的身分 ⇒ 歸屬全錯。
-- 🛑 **而這一行【不是新開】的權限** —— 上一代(9 參)本來就有, 而本檔的 `DROP` 把它帶走了
--    ⇒ 不還原的話:**客人結帳當場 permission denied, 而 PUBLIC 反而執行得了。**
-- ⚠️ 而本閘的理由成立:同檔那道 ACL 自檢**只在 apply 當下跑一次**, 正式庫不會 replay
--    ⇒ 這一行之後漂了, 沒有東西會再紅。**那個限制我不否認, 只是這一行必須存在。**
GRANT EXECUTE ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text) TO authenticated;

COMMENT ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text) IS
  'M-4b 券片3(2026-09-01):在 20260825130000 之上【只加一個】p_coupon_code text DEFAULT NULL。'
  '⇒ 帶券碼時本函式呼 public.redeem_coupon 的【試算路徑】算出折扣, 再 total = subtotal + shipping_fee − 折扣。'
  '🔴 **金額不是呼叫端送的** —— 前一版收 p_discount_total(金額), 而 create_order 是 SECURITY DEFINER '
  '且 GRANT TO authenticated + PostgREST 自動暴露 ⇒ 任何登入的客人可以自己填那個金額。已刪。'
  '🛑 券的【規則】(低消/上限/有效期/誰能用)一格都不在這裡 —— 本函式只做一次呼叫去問那個權威。'
  '🔴 fail-closed:券無效 ⇒ RAISE(不靜靜地不折);算出來的折扣為負或超過小計 ⇒ RAISE。'
  '✅ 折抵上限 = 小計(**券不吃運費**)—— Sean 2026-09-01 拍【不可以】, 逐字「券的上限 = 商品金額, 運費照付」。'
  '   理由:低消比小計、百分比乘小計 ⇒ 讓它吃運費 = 同一張券兩個基準。'
  '   ⚠️ 而稿 design-reference/components/CheckoutPage.jsx:95 仍是 subtotal+shipping ⇒ **稿要跟著改(3c 的事)**。'
  '🔴 而 :374 那道「total <= 0 ⇒ RAISE」留著不動;一張把小計折光的券 + 門市取貨(運費 0)會撞到它 —— 具名未解。'
  '其餘 executable 逐字同 20260825130000。';

-- ── 收工驗收(fail-closed;任一條不成立 = 整片回滾)──────────────
DO $$
DECLARE
  v_oid  oid;
  v_args text;
BEGIN
  -- ① 新一代真的建成了, 而且是 10 參數那一支
  v_oid := pg_catalog.to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION '片3 fail-closed:10 參數的 create_order 沒建成';
  END IF;

  -- ② 🔴🔴 【舊的 9 參數那一支必須不見了】—— 而**它的失敗形狀比我原本寫的更糟**。
  --    ⛔ ~~原本我寫「舊呼叫端仍打到舊那支 ⇒ 折扣寫不進去而一切看起來正常」~~
  --    🔴 **那是錯的, 實測推翻了它**(拋棄式 PG, 2026-09-01 00:4x, 現造一支 zzq_sig_test):
  --      建 `f(text)` ⇒ 1 支;再 `CREATE OR REPLACE f(text, integer DEFAULT 0)` ⇒ **2 支**
  --      而呼叫 `f('x')` ⇒ **`ERROR: function public.zzq_sig_test(unknown) is not unique`**
  --    ⇒ 📌 **兩支並存不是「安靜地打到舊的」, 是【每一個既有呼叫端當場全部炸掉】。**
  --    ⇒ 所以本檔 DROP 掉舊簽名, 而這一格是斷言不是註解。
  IF pg_catalog.to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION '片3 fail-closed:舊的 9 參數 create_order 還在 ⇒ 兩支並存 ⇒ 既有呼叫端會拿到 function is not unique 而全部炸掉(2026-09-01 實測)';
  END IF;

  -- ③ 函式本體真的帶了那個參數(防「抄了檔頭而忘了改本體」)
  -- 🔴🔴 **先剝掉函式體裡的 `--` 註解再比**(codex R2 must-fix③):
  --    `pg_get_functiondef` 把註解一起回來 ⇒ 把真正那一行【註解掉】而字面留在註解裡,
  --    下面三道字面斷言**照樣全綠**。
  -- 📌 今晚第四次同族:**一把讀原始碼字面的尺, 它的分母包含所有在講這件事的字。**
  SELECT pg_catalog.regexp_replace(
           pg_catalog.pg_get_functiondef(v_oid), '--[^\n]*', '', 'g')
    INTO v_args;
  -- 🟢 正對照:剝完之後函式本體還在(剝過頭的話下面每一格都恆綠)。
  IF v_args NOT LIKE '%INSERT INTO public.orders%' THEN
    RAISE EXCEPTION '片3 fail-closed:剝註解之後找不到 INSERT INTO public.orders ⇒ 剝過頭了';
  END IF;

  -- ══ 🔴🔴 前置閘(3a 檔頭 `:432-436` 逐字交代「換回去的時候這兩道要一起帶回來」)══
  --    **為什麼是 apply 期的閘, 不是註解**:plpgsql 晚繫結 —— 函式本體不在 CREATE 時解析
  --    ⇒ `redeem_coupon` 不存在時本檔**照樣 apply rc=0**, 而第一個帶券碼結帳的客人才會炸。
  --    📌 **「apply 成功」與「這支函式跑得動」是兩個宣稱。**
  -- ① `redeem_coupon` 必須存在, 而且是那個五參數的簽名
  -- ⛔ ~~原版比對 `pg_get_function_identity_arguments(p.oid) = 'text, uuid, integer, boolean, uuid'`~~
  --    **作廢 —— 那是一發【假紅】, 我實測撞到了。**
  --    那支函式明明就在, 而閘擋下了 apply。實得逐字:
  --      `[p_code text, p_user_id uuid, p_subtotal integer, p_has_tier_price boolean, p_order_id uuid]`
  --    ⇒ 🔴 **`pg_get_function_identity_arguments` 帶【參數名字】, 不是只有型別。**
  --    📌 而這一格的形狀值得記:**一道防「東西不在」的閘, 自己壞掉時印的是「東西不在」** ——
  --       它與真的不在**印同一句話**。要不是我剛裝過它、知道它在, 我會去 apply 160000 而不是修閘。
  --    ✅ 改用 `to_regprocedure` —— 它按【型別】解析, 查無回 NULL 而不是報錯。
  IF pg_catalog.to_regprocedure('public.redeem_coupon(text,uuid,integer,boolean,uuid)') IS NULL THEN
    RAISE EXCEPTION
      '片3b 前置閘①:public.redeem_coupon(text,uuid,integer,boolean,uuid) 不存在 ⇒ 先 apply 20260831160000';
  END IF;
  -- ② 本函式的 owner 對它必須有 EXECUTE
  --    `create_order` 是 SECURITY DEFINER ⇒ 執行期 current_user = owner;
  --    而 `redeem_coupon` 被 REVOKE 到只剩 service_role ⇒ **owner 不同就 permission denied**,
  --    而那個錯誤發生在客人結帳的當下, 不在這裡。
  -- ⛔ ~~原版 `WHERE p.proname = 'redeem_coupon' AND has_function_privilege(..., p.oid, ...)`~~
  --    **作廢**(codex R1 must-fix):那是 `EXISTS`,問的是「**有沒有任何一支**同名的
  --    `redeem_coupon` 是 owner 執行得動的」—— 而閘①釘的是**那個五參數版本**。
  --    ⇒ 失敗情境:另有一支 overload 可執行、而目標那支不可執行 ⇒ **本閘全綠**,
  --      第一筆券單才 permission denied。📌 **閘①與閘②問的不是同一個物件, 而它們讀起來像。**
  --    ✅ 改成直接用閘①拿到的那個 OID, 兩道釘同一支。
  IF NOT pg_catalog.has_function_privilege(
           (SELECT pr.proowner::regrole::text
              FROM pg_catalog.pg_proc pr
              JOIN pg_catalog.pg_namespace nn ON nn.oid = pr.pronamespace
             WHERE nn.nspname = 'public' AND pr.proname = 'create_order' LIMIT 1),
           pg_catalog.to_regprocedure('public.redeem_coupon(text,uuid,integer,boolean,uuid)')::oid,
           'EXECUTE') THEN
    RAISE EXCEPTION
      '片3b 前置閘②:create_order 的 owner 對 redeem_coupon 沒有 EXECUTE ⇒ 客人結帳時會 permission denied';
  END IF;
  -- ③ `orders.coupon_id` 必須存在(20260901020000 要排在本檔之前)
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'orders'
       AND a.attname = 'coupon_id' AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION
      '片3b 前置閘③:orders.coupon_id 不存在 ⇒ 先 apply 20260901020000';
  END IF;
  IF v_args NOT LIKE '%p_coupon_code%' THEN
    RAISE EXCEPTION '片3 fail-closed:函式本體裡找不到 p_coupon_code';
  END IF;
  -- 🔴🔴 **本片把 3a 那兩道斷言【反過來】—— 這是 3b 與 3a 在碼上唯一分得開的地方。**
  --    3a `:696-703` 釘的是「封鎖必須在、呼叫必須不在」;3b 釘的是相反的兩件事。
  --    📌 兩支檔的斷言互為負對照:**同一個函式體不可能同時通過兩邊。**
  --       ⇒ 誰被裝上去了, 用它自己的斷言就問得出來, 不必靠版本號記憶。
  IF v_args LIKE '%優惠券結帳尚未啟用%' THEN
    RAISE EXCEPTION '片3b fail-closed:3a 那道「尚未啟用」封鎖還在 ⇒ 本片沒有解除它, 兩者互相矛盾';
  END IF;
  -- 🔴 而【必須】真的呼叫那支函式 —— plan 的第一個驗收條(主視窗指定)。
  --    少了它:券碼收得下、不 RAISE、而折扣恆 0 ⇒ **客人以為用了券, 而他沒有。**
  --    ⇒ 那比 3a 的封鎖糟 —— 封鎖是吵的, 這個是安靜的。
  IF v_args NOT LIKE '%public.redeem_coupon(%' THEN
    RAISE EXCEPTION '片3b fail-closed:函式體沒有呼叫 redeem_coupon ⇒ 券碼收得下卻不會生效';
  END IF;
  -- 🔴 券的身分必須被寫進去 —— 只算折扣不記券 ⇒ 撞 orders_discount_needs_coupon(23514),
  --    而那道 CHECK 的訊息說不出是哪一半漏了 ⇒ 在這裡先釘。
  IF v_args NOT LIKE '%v_coupon_id%' THEN
    RAISE EXCEPTION '片3b fail-closed:函式體裡找不到 v_coupon_id ⇒ 券的身分沒有被寫進 orders';
  END IF;
  IF v_args NOT LIKE '%p_notification_email, v_coupon_id%' THEN
    RAISE EXCEPTION '片3b fail-closed:INSERT 沒有把 v_coupon_id 寫進 coupon_id 欄';
  END IF;
  -- 🛑 而【不准】再出現一個收金額的參數 —— 那個洞的形狀不可以回來。
  IF v_args LIKE '%p_discount_total%' THEN
    RAISE EXCEPTION '片3 fail-closed:函式體出現 p_discount_total ⇒ 又在收呼叫端算的金額';
  END IF;
  IF v_args NOT LIKE '%v_subtotal + v_shipping_fee - v_discount_total%' THEN
    RAISE EXCEPTION '片3 fail-closed:total 的算式沒有減掉 discount_total';
  END IF;
  -- 🔴 **INSERT 那一處也要釘**(codex must-fix):只釘參數與算式的話,
  --    第③處退回寫死 `0` ⇒ **訂單的 discount_total 永遠是 0, 而 total 卻已經減過**
  --    ⇒ 帳面自相矛盾, 而 migration 自檢仍然全綠。
  IF v_args NOT LIKE '%v_shipping_fee, v_discount_total, v_total::integer%' THEN
    RAISE EXCEPTION '片3 fail-closed:INSERT 沒有把 p_discount_total 寫進 discount_total 欄';
  END IF;

  -- ③b 🔴 **全名 overload 恰一支**(codex must-fix):`DROP IF EXISTS` 只點名了一個簽名,
  --    而一支【我不知道存在的】別的 overload 會留下 ⇒ 呼叫端拿到 `is not unique`
  --    (那個形狀今晚實測過)。⇒ 直接數 `pg_proc`, 不去猜有哪些簽名。
  IF (SELECT count(*) FROM pg_catalog.pg_proc pr
        JOIN pg_catalog.pg_namespace ns ON ns.oid = pr.pronamespace
       WHERE ns.nspname = 'public' AND pr.proname = 'create_order') <> 1 THEN
    RAISE EXCEPTION '片3 fail-closed:public.create_order 不是恰一支(現有 %)',
      (SELECT count(*) FROM pg_catalog.pg_proc pr
         JOIN pg_catalog.pg_namespace ns ON ns.oid = pr.pronamespace
        WHERE ns.nspname = 'public' AND pr.proname = 'create_order');
  END IF;

  -- ③c 🔴 **SECURITY DEFINER 要釘 owner**(codex must-fix):DEFINER 用的是 **owner 的權限**,
  --    ⇒ 由誰跑這支 migration, 就決定了這支函式**以誰的身分執行**。
  --    而下面那道 ACL 自檢**把 owner 排除在外** ⇒ owner 錯了它一句都不會說。
  -- 🛑 這裡只**斷言**不改:改 owner 要 superuser, 而那不是施工窗該做的。
  IF (SELECT r.rolname FROM pg_catalog.pg_proc pr
        JOIN pg_catalog.pg_roles r ON r.oid = pr.proowner WHERE pr.oid = v_oid)
     IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION '片3 fail-closed:create_order 的 owner 是 %, 不是 postgres —— SECURITY DEFINER 會以那個身分跑',
      (SELECT r.rolname FROM pg_catalog.pg_proc pr
         JOIN pg_catalog.pg_roles r ON r.oid = pr.proowner WHERE pr.oid = v_oid);
  END IF;

  -- ④ 🔴 ACL:新物件出生帶 PUBLIC ⇒ 沒收乾淨的話, 一支能建單的函式對匿名開著。
  DECLARE
    v_acl aclitem[];
    v_extra text[];
  BEGIN
    SELECT proacl INTO v_acl FROM pg_catalog.pg_proc WHERE oid = v_oid;
    IF v_acl IS NULL THEN
      RAISE EXCEPTION '片3 fail-closed:create_order 的 proacl 是 NULL(預設 ACL ⇒ PUBLIC 可執行)';
    END IF;
    -- 🔴 LEFT JOIN 不是 JOIN:aclexplode 給 PUBLIC 的 grantee 是 oid 0, 而 pg_roles 沒有 0
    --    ⇒ 內部 JOIN 會把 PUBLIC 那一列靜靜丟掉 ⇒ 這把尺看不到它唯一要防的那一種。
    SELECT coalesce(array_agg(gr), ARRAY[]::text[]) INTO v_extra
      FROM (SELECT coalesce(r.rolname::text, 'PUBLIC') AS gr
              FROM (SELECT (aclexplode(v_acl)).grantee AS gid) x
              LEFT JOIN pg_catalog.pg_roles r ON r.oid = x.gid) y
     WHERE gr NOT IN ('authenticated', (SELECT r2.rolname::text FROM pg_catalog.pg_proc p2
                                          JOIN pg_catalog.pg_roles r2 ON r2.oid = p2.proowner
                                         WHERE p2.oid = v_oid));
    IF array_length(v_extra, 1) IS NOT NULL THEN
      RAISE EXCEPTION '片3 fail-closed:create_order 的 EXECUTE 開給了預期外的角色:%', v_extra;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '片3 fail-closed:authenticated 拿不到 create_order 的 EXECUTE(客人結帳會被擋)';
    END IF;
  END;

  -- 🟢 負對照:上面那把 to_regprocedure 若對任何東西都回非 NULL, 它就沒有判別力。
  IF pg_catalog.to_regprocedure('public.zzq_no_such_create_order_7731(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION '片3 自檢:負對照命中了一支不該存在的函式 ⇒ 量具可疑';
  END IF;
END $$;

-- 🔴 **換簽之後要刷 PostgREST 的 schema cache**(codex must-fix):
--    不刷的話, 新參數的呼叫在 cache 過期前**打不中** ⇒ 而那段期間的失敗
--    看起來像「函式不存在」, 沒有人會想到是 cache。
NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 第 2 節:收款成功 ⇒ 扣券(原本規劃的 022000, 合併進本片)
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 為什麼在這一支檔裡、為什麼是 trigger:見檔頭那兩段。一句話:
--    **合成一支 ⇒ 半套在物理上不可能;trigger ⇒ 漏掉一條路在建構上不可能。**

-- 🔴🔴 **本檔用 `CREATE OR REPLACE`, 而 021000 用裸 `CREATE` —— 兩支不一樣, 而理由相反。**
--    021000 建它時它是**新物件** ⇒ 守門要求裸 `CREATE`(撞名要當場紅)。
--    本檔跑的時候它**已經存在**(021000 剛建的)⇒ 這是**重定義既有物件**, `OR REPLACE` 才對。
-- ⛔ ~~本檔第一版把 021000 那段整段抄過來, 連裸 `CREATE` 一起~~ **作廢**(codex R1 must-fix #1):
--    ⇒ **依序貼 021000 ⇒ 030000 會在這裡炸 `already exists`, 而整包回滾**
--      ⇒ 📌 **新的 RPC 根本不會被建出來, 而 Sean 看到的只有一句 already exists。**
--    ⇒ 🔴 而那是「拿一支檔當基底複製」這個做法的代價:**我抄了它的內容, 也抄了它的【前提】** ——
--      而那個前提(「這是新物件」)只在 021000 那一刻成立。
-- 🔵 **而本檔【真的要改它】**(見下方 `total = 0` 那個分支)⇒ 重定義不是順手, 是必要。
CREATE OR REPLACE FUNCTION public.coupon_redeem_on_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
-- 🔴 **函式範圍**的等鎖上限(不是 `SET LOCAL` —— 那是交易範圍, 會洩漏到呼叫端的其餘語句;
--    R3 抓到, 詳見下方函式體內那段作廢註解)。離開本函式自動還原。
SET lock_timeout = '3s'
AS $trg$
DECLARE
  v_res  jsonb;
  v_code text;   -- 那張券的碼。🔴 存起來是為了寫進人工旗標 —— 只給 uuid 的話,
                 --    員工查不出是哪張券(`coupons` 對 app 角色 REVOKE ALL, 而 3c 券 UI 還沒建)。
BEGIN
  -- 只在【unpaid → paid】那一次轉換、且這張單真的帶了券時做事。
  -- 🔴 條件寫在 WHEN 子句(見下方 CREATE TRIGGER)也寫在這裡:WHEN 省掉大部分的函式呼叫,
  --    而這裡是縱深 —— **有人改了 WHEN 而忘了這裡, 行為不會變。**
  IF NEW.coupon_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- ⛔ ~~原版 `OR OLD.payment_status = 'paid'`~~ ⇒ 與 WHEN 子句同一個病(碼比註解寬), 一起收緊。
  --    🔴 而**兩份條件必須逐字相同** —— 它們是同一件事的兩份拷貝, 不一致時沒有人在比。
  --      (今晚第三次同族:兩個地方各自說同一件事。⇒ 改一邊就要改另一邊, 而這行字是唯一的提醒。)
  IF NEW.payment_status <> 'paid'::public.payment_status
     OR OLD.payment_status <> 'unpaid'::public.payment_status THEN
    RETURN NULL;
  END IF;

  -- 🔴🔴 **等鎖要有上限, 而理由不是效能, 是【它決定那個失敗接不接得住】**(codex R2 must-fix):
  --    `redeem_coupon` 會 `FOR UPDATE` 鎖券那一列。兩個人同時買同一張券 ⇒ 後到的要等。
  --    等太久撞到外層的 `statement_timeout` ⇒ 丟的是 `query_canceled`,
  --    而 **plpgsql 的 `WHEN OTHERS` 【接不到】`query_canceled`**(它與 `assert_failure` 同屬
  --    不被 OTHERS 涵蓋的那一類)⇒ 例外穿出 trigger ⇒ **翻 paid 整筆回捲 ⇒ 客人付了錢而單沒付款。**
  --    ✅ 設一個【比外層短】的 `lock_timeout` ⇒ 等不到時丟的是 `lock_not_available`,
  --       **那一個 `WHEN OTHERS` 接得住** ⇒ 走丙(收款成功 + 人工旗標), 而不是回捲收款。
  --    📌 **把一個接不住的失敗, 換成一個接得住的失敗。**
  -- ⛔ ~~原版在這裡寫 `SET LOCAL lock_timeout = '3s';`~~ **作廢**(R3 換模型抓到, codex 兩輪都沒看到):
  -- 🔴🔴 **`SET LOCAL` 是【交易】範圍, 不是【函式】範圍。**
  --    AFTER ROW trigger 在那句 UPDATE 結束時跑, 而**收款交易還沒完** ——
  --    `confirm_order_payment`(`20260810170000`)翻 paid 之後還要寫 `order_payments` 帳本等好幾句,
  --    ⇒ 那些句子從此都被 3 秒上限管住 ⇒ 其中任何一句等鎖超過 3s
  --      ⇒ `lock_not_available` **丟在 trigger 的 EXCEPTION 之外** ⇒ **整筆收款回捲。**
  --    ⇒ 📌 **我為了防「券的問題把收款回捲」而加的東西, 自己從另一側把收款回捲了。**
  --      (與上面 `order_notes` 那一條同族 —— **安全網第二次差點殺死病人, 而這次是我加的上限。**)
  --    🛑 **而它是【替身綠、真表紅】的教科書例子**:我的測試是裸 `UPDATE … SET payment_status='paid'`,
  --      **那句 UPDATE 後面沒有下一句** ⇒ 洩漏出去的 3 秒上限沒有受害者 ⇒ 四格全綠。
  --    ✅ 改搬到函式 header 的 `SET lock_timeout = '3s'`(見上方 `CREATE FUNCTION` 那幾行)——
  --       那是**函式範圍**, 離開函式自動還原, 管不到呼叫端交易的其餘語句。
  -- 🟢🟢 **兩個世界各餵一發, 而它們印不同的東西**(2026-09-01, 拋棄式 PG):
  --    在同一個交易裡翻 paid, 然後問 `current_setting('lock_timeout')`:
  --      **舊版形狀**(現造一支 `zzq_leak_test()` 把 `SET LOCAL` 放函式體內)⇒ **`3s`** ← 洩漏了
  --      **本版**(函式 header 的 `SET lock_timeout`)              ⇒ **`0`**  ← 沒洩漏
  --      而同一發裡券仍然被扣(redemption 列數 = 1)⇒ **關掉洩漏沒有把功能一起關掉。**
  --    📌 **⇒ 「修好了」與「本來就不會發生」是兩個宣稱, 而那支現造的 `zzq_leak_test` 就是用來
  --       證明前者的。**(測完即 drop, 收攤後 `orders` 上只剩 `trg_coupon_redeem_on_paid`。)
  BEGIN
    -- 真的兌換:`p_order_id` 有值 ⇒ `FOR UPDATE` 鎖券那一列 + 寫一列 redemption。
    -- 🔴 券碼從 `coupons` 反查 —— 訂單上存的是 id, 而 `redeem_coupon` 收的是碼。
    --    本函式是 SECURITY DEFINER(owner = postgres)⇒ 讀得到 `coupons`(它對 app 角色是 REVOKE ALL)。
    SELECT c.code,
           public.redeem_coupon(
             c.code,
             NEW.customer_user_id,
             NEW.subtotal,
             -- 🔴 `has_tier_price` **綁到這張單自己的 tier**, 不寫死 `false`(R3 nit)。
             --    今天 `tier_at_checkout` 恆 `'general'`(create_order 寫死)⇒ 行為零改變。
             --    ⇒ 而經銷價那天改一處就好。**上面 create_order 那一格才剛為了同一個理由綁過來源,
             --      這裡若寫死就是又造一個孤本。**(今晚第四次同族:兩個地方各自說同一件事。)
             NEW.tier_at_checkout <> 'general'::public.member_tier,
             NEW.id
           )
      INTO v_code, v_res
      FROM public.coupons c
     WHERE c.id = NEW.coupon_id;

    IF v_res IS NULL OR NOT coalesce((v_res->>'valid')::boolean, false) THEN
      RAISE EXCEPTION 'coupon_redeem_on_paid: 兌換被拒(reason=%)', coalesce(v_res->>'reason', 'unknown');
    END IF;

    -- 🔴🔴 **對帳:兌換記下的金額必須等於這張單當初算的折扣**(R3 must-fix)。
    --    `redeem_coupon` **自己重算** —— 它不讀 `orders.discount_total`。
    --    ⇒ 下單到付款之間(`expire_unpaid_orders` 給約一天)若有人在 SQL Editor 改了那張券的
    --      `discount_value`(`coupons` 沒有凍結守門)⇒ 它按**新規則**算出**不同的金額**寫進
    --      `coupon_redemptions.discount_applied`, 而**客人付的是舊金額算出來的 total**。
    --    ⇒ 📌 **valid=false 那半會走丙、會叫;valid=true 而金額不同這半【不會叫】** ——
    --      兩本帳從此分岔, 而 3d 的上限統計會引用一個與錢不符的數。
    --    ✅ 對不上就當成兌換失敗 ⇒ 落進丙(收款仍成功 + 人工旗標), **而不是安靜接受。**
    IF (v_res->>'discount_applied')::integer IS DISTINCT FROM NEW.discount_total THEN
      RAISE EXCEPTION
        'coupon_redeem_on_paid: 兌換算出 % 元而這張單的折扣是 % 元 —— 兩本帳對不上(券可能在下單後被改過)',
        coalesce(v_res->>'discount_applied', 'NULL'), NEW.discount_total;
    END IF;

  -- 🔴 `query_canceled` **要明文列出來** —— `WHEN OTHERS` 涵蓋不到它(codex R2 must-fix)。
  --    上面那個 `lock_timeout` 把【等券鎖】那條路換成了 `lock_not_available`,
  --    ⚠️ 而它擋不到別的取消來源:外層 `statement_timeout` 打在別的地方、
  --      `pg_cancel_backend`、客戶端斷線。⇒ 那些仍然會丟 `query_canceled`。
  --    ⇒ 兩道一起才涵蓋得到:**改變失敗的形狀(lock_timeout)+ 明文接住剩下的。**
  EXCEPTION WHEN OTHERS OR query_canceled THEN
    -- ══════════════════════════════════════════════════════════════════════
    -- 🔴🔴 **0 元單走【相反的處置】—— 丙 在這個世界是錯的。**(codex R1 must-fix #2)
    -- ══════════════════════════════════════════════════════════════════════
    --    丙(收款仍成功 + 告警)的理由只有一句:**錢已經進來了**, 回捲會讓客人付了錢而單沒付款。
    --    🔴 **而 0 元單沒有錢進來。**
    --    ⇒ 券沒扣成卻還是 paid = **客人免費拿走東西, 而那張券還在**(還可以再用一次)。
    --    ⇒ 📌 **同一個處置, 在兩個世界有相反的正確性** —— 而分界線是【有沒有錢要保護】。
    --    ✅ 所以 0 元單:**讓例外穿出去** ⇒ 整筆回捲 ⇒ 那張單留在 `unpaid`
    --      ⇒ 客人會看到結帳失敗, 而**那是對的** —— 他的券真的不能用了。
    --    🛑 而它不會靜靜失敗:`settle_zero_total_order` 的呼叫端會拿到這個錯誤。
    IF NEW.total = 0 THEN
      -- ⛔ ~~原本是裸 `RAISE;`(原樣丟回)~~ **作廢**(codex R2 must-fix):
      --    原樣丟回的是 `P0001` + 一句中文字串 ⇒ 呼叫端**只能去 parse 那個字串**
      --    ⇒ 📌 而字串是會改的 —— 那不是契約, 那是巧合。
      --    ⇒ 客人那頭就答不出「該換一張券、還是等一下再試、還是找客服」。
      -- ✅ 改成**具名 SQLSTATE**:`P2C01` = 「0 元單的券在結清那一刻不能用了」。
      --    ⚠️ 而 `SQLERRM` 仍然帶著原因(reason=…)⇒ **診斷沒有變少, 只是多了一個機器讀得懂的鍵。**
      --    🔵 形狀照 `confirm_order_payment` 那支的 `USING ERRCODE = 'P2B36'`(既有慣例, 不自己發明)。
      RAISE EXCEPTION
        'settle_zero_total_order: 這張優惠券在結清的那一刻已經不能用了(%)', SQLERRM
        USING ERRCODE = 'P2C01';
    END IF;
    -- ══ 以下是【有金額】那條路:丙(Sean 拍)—— 收款照樣成功 + 告警 + 人工旗標 ══════
    -- 🔴 **錢已經進來了。** 因為券的問題把收款回捲, 會讓客人付了錢而單還是未付款 ——
    --    那比「券被多用一次」糟得多。⇒ 這裡吞掉例外, 但**留下一個人看得到的東西**。
    -- ⚠️ 而「吞掉例外」在 plpgsql 只回捲**這個 BEGIN 區塊**內的寫入(含 redeem_coupon 寫了一半的),
    --    外層那次翻 paid 不受影響 —— 這是 plpgsql 子交易的定義, **而我在拋棄式 PG 上實測過**(見檔尾)。
    -- 🔴🔴 **而這個 INSERT 自己也要被包住 —— 我實測踩到了。**
    --    第一版直接 INSERT。拋棄式 PG 上 `order_notes` 不存在 ⇒
    --      `ERROR: relation "public.order_notes" does not exist`
    --      ⇒ 例外從 EXCEPTION 區塊裡再丟出去 ⇒ **整個 UPDATE 回捲 ⇒ 那張單變回 `unpaid`。**
    --    ⇒ 📌 **我為了「不要因為券的問題把收款回捲」而寫的那段話, 自己把收款回捲了。**
    --       **安全網在接住東西的那一刻, 把病人殺了。**
    --    ⇒ 這不是「拋棄式 PG 沒有那張表」的問題 —— 正式庫上任何原因(RLS、權限、
    --      CHECK 擋掉某個字元、表被改名)都會走到同一條路, 而**後果是客人付了錢而單沒翻**。
    -- ✅ 所以再包一層。最後的退路是 `RAISE WARNING` —— 它進 server log, **而且不會中止交易。**
    -- 🟢🟢 **而這個修法【真的改變了行為】, 不是「本來就不會發生」**(同一發實測, 兩個世界):
    --    把 `order_notes` 改名藏起來 ⇒ 建一張帶券的單 ⇒ 停用那張券 ⇒ 翻 paid
    --      修好【前】 ⇒ `payment_status` = **unpaid**(收款被回捲)
    --      修好【後】 ⇒ `WARNING: coupon_redeem_on_paid: 兌換失敗【而且旗標也寫不進去】…
    --                    寫旗標的錯=relation "public.order_notes" does not exist`
    --                  + `UPDATE 1` + `payment_status` = **paid**
    --    ⇒ 錢留住了, 而失敗有聲音。
    BEGIN
    INSERT INTO public.order_notes (order_id, note_type, body, author)
    VALUES (
      NEW.id,
      'internal',
      '🔴 優惠券扣抵失敗, 而這張單【已經收到錢】—— 需要人工處理。'
        || E'\n券碼:' || coalesce(v_code, '(查不到 —— 這張券可能已被刪除)')
        || E'\n券 id:' || NEW.coupon_id::text
        || E'\n訂單折抵:' || NEW.discount_total::text || ' 元'
        || E'\n失敗原因:' || coalesce(SQLERRM, '(無)')
        || E'\nSQLSTATE:' || coalesce(SQLSTATE, '(無)')
        || E'\n\n要做什麼:確認這張券該不該算用掉。若該算, 手動補一列 coupon_redemptions;'
        || E'\n若不該算(例如券已用完而客人不該拿到折扣), 那是退款側的事 —— '
        || E'\n訂單側改不動:折抵歸零會撞 orders_discount_needs_coupon(要連 coupon_id 一起清 = 丟失線索),'
        || E'\n而改 total 等於改已經刷卡的金額。',
      'system_coupon'
    );
    EXCEPTION WHEN OTHERS THEN
      -- 連旗標都寫不進去。**收款仍然不准回捲** —— 這是本片唯一不可讓步的一格。
      -- ⚠️ 而這條路上這張單會【安靜地】少一個券的兌換紀錄, 只有 server log 有痕跡。
      --    ⇒ 那是最後的退路, 不是可接受的常態 ⇒ 出現這行 WARNING 就是一次要查的事故。
      RAISE WARNING
        'coupon_redeem_on_paid: 兌換失敗【而且旗標也寫不進去】order_id=% coupon_id=% 原因=% 寫旗標的錯=%',
        NEW.id, NEW.coupon_id, '(見上一層)', SQLERRM;
    END;
    RETURN NULL;
  END;

  RETURN NULL;
END;
$trg$;

COMMENT ON FUNCTION public.coupon_redeem_on_paid() IS
  'M-4b 券片3b:訂單從 unpaid 翻成 paid 且帶券 ⇒ 呼 redeem_coupon 真的扣一次名額。'
  '🔴 為什麼是 trigger 不是改 confirm_order_payment:全 repo 有【至少五處不同函式】會 SET payment_status=''paid'' '
  '(20260611120000:178 / 20260804150000:127 / 20260810160000:448 / 20260810170000:436 / 20260820020000:169 與 :560), '
  '而 20260823030000:36 早就記過同一件事(同一支函式被 CREATE OR REPLACE 四次)。'
  '⇒ 只補刷卡那一支 = 後台手動確認收款的單永遠不扣券。trigger 按建構涵蓋全部路徑。'
  '🛑 而它是【隱形】的:讀 confirm_order_payment 的人看不到券被扣了 —— 那支函式體內【還沒有】指回本函式的那一句, '
  '已交回主視窗當已知缺口(要 CREATE OR REPLACE 抄那支 193 行, 抄錯一代會整個回捲)。'
  '🔴 兌換失敗的處置【分兩個世界, 而分界線是有沒有錢要保護】:'
  '  · total > 0(刷卡)⇒ 丙(Sean 拍):收款仍成功 + 寫一筆 order_notes(internal, author=system_coupon)。'
  '    理由:錢已經進來了, 回捲會讓客人付了錢而單沒付款。'
  '  · total = 0(全額折抵券)⇒ **相反:例外原樣丟出, 整筆回捲, 那張單留 unpaid。**'
  '    理由:沒有錢進來 —— 券沒扣成卻還是 paid = 客人免費拿走東西而那張券還在。'
  '⛔ 而本 COMMENT 的前一版寫「兌換失敗 ⇒ 收款仍成功」是【一律】的口氣 ⇒ 對 0 元路徑是錯的(codex R2 nit)。';

-- 🔴🔴 **收權限**(codex R2 T3 點到:本函式是 SECURITY DEFINER 而沒有收斂 ACL)。
--    `docs/patterns/revoking-function-execute-in-supabase.md` 那條:**新物件出生就自帶 PUBLIC EXECUTE**,
--    而 repo 內零 `GRANT` 字面可掃、三綠不紅 ⇒ 不寫就是開著。
--    ⚠️ 它回 `trigger`, 直接呼叫本來就會 `ERROR: trigger functions can only be called as triggers`
--      ⇒ **今天的實際攻擊面接近零。**而仍然收, 理由有二:
--      ① 那個「呼叫會失敗」是 PG 的行為, 不是我們的守門 —— 我們不該把安全性掛在別人的實作細節上
--      ② 一支 SECURITY DEFINER 函式對 PUBLIC 開著, 會在稽核掃描上與真的洞長得一樣 ⇒ 製造雜訊
--    🛑 而**它不需要 GRANT 給任何人** —— trigger 是由表擁有者的身分觸發的, 不走 EXECUTE 檢查。
REVOKE ALL ON FUNCTION public.coupon_redeem_on_paid() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.coupon_redeem_on_paid() FROM anon;
REVOKE ALL ON FUNCTION public.coupon_redeem_on_paid() FROM authenticated;

-- 🔴 **收權【斷言】**(守門 `migration-new-file-static-checks.sh` 抓的:「可授權物件 1 個, 斷言清單列了 0 個」)。
--    那支守門自己說得很準:**收權斷言只檢查你列出來的物件 —— 它防「忘記收權」, 不防「忘記列」。**
--    ⇒ 而三句 `REVOKE` 跑完 rc=0 **證明不了它們生效了**:REVOKE 一個本來就沒有的權限也是 rc=0。
DO $acl$
DECLARE
  -- 🔴 **這個清單的形狀是守門 `scripts/migration-static-checks.sh:562-565` 認得的那一個**
  --    (從 `v_functions text[] :=` 一路吃到 `]::text[]`, 再數裡面有幾個 '…')
  --    ⇒ 用它自己的形狀寫, 而不是另外發明一個。**一把它讀不到的清單, 等於沒有清單** ——
  --      而我第一版就是這樣:斷言寫了、寫得比要求還細, 而守門印「斷言清單列了 0 個」。
  --    📌 **「我做了那件事」與「那道閘看得到我做了」是兩個宣稱。**
  v_functions text[] := ARRAY[
    'public.coupon_redeem_on_paid()'
  ]::text[];
  v_fn    text;
  v_oid   oid;
  v_acl   aclitem[];
  v_extra text[];
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
  v_oid := v_fn::regprocedure::oid;
  SELECT p.proacl INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  -- 🔴 `proacl` 是 NULL 時代表【預設 ACL】—— 而函式的預設是 `PUBLIC EXECUTE`
  --    ⇒ **NULL 不是「沒有人有權限」, 是「所有人都有」。**這一格搞反的話整道斷言恆綠。
  IF v_acl IS NULL THEN
    RAISE EXCEPTION '片3b fail-closed:% 的 proacl 是 NULL ⇒ 走預設 = PUBLIC 有 EXECUTE ⇒ REVOKE 沒生效', v_fn;
  END IF;
  -- 🔴 LEFT JOIN 不是 JOIN:aclexplode 給 PUBLIC 的 grantee 是 oid 0, 而 pg_roles 沒有 0
  --    ⇒ 內部 JOIN 會把 PUBLIC 那一列靜靜丟掉 ⇒ 這把尺看不到它唯一要防的那一種。
  SELECT coalesce(array_agg(gr), ARRAY[]::text[]) INTO v_extra
    FROM (SELECT coalesce(r.rolname::text, 'PUBLIC') AS gr
            FROM (SELECT (aclexplode(v_acl)).grantee AS gid) x
            LEFT JOIN pg_catalog.pg_roles r ON r.oid = x.gid) y
   WHERE gr <> (SELECT r2.rolname::text FROM pg_catalog.pg_proc p2
                  JOIN pg_catalog.pg_roles r2 ON r2.oid = p2.proowner
                 WHERE p2.oid = v_oid);
  -- 🛑 這一支**不 GRANT 給任何人** —— trigger 由表擁有者的身分觸發, 不走 EXECUTE 檢查。
  --    ⇒ 期望的 ACL 只剩 owner 自己。
  IF array_length(v_extra, 1) IS NOT NULL THEN
    RAISE EXCEPTION '片3b fail-closed:% 的 EXECUTE 開給了預期外的角色:%', v_fn, v_extra;
  END IF;
  END LOOP;
  -- 🟢 負對照:同一把 regprocedure 尺對一支現造的函式必須查不到(它若對什麼都成立就沒有判別力)
  IF pg_catalog.to_regprocedure('public.zzq_no_such_trg_fn_0901()') IS NOT NULL THEN
    RAISE EXCEPTION '片3b 自檢:負對照命中一支不該存在的函式 ⇒ 量具可疑';
  END IF;
END $acl$;

DROP TRIGGER IF EXISTS trg_coupon_redeem_on_paid ON public.orders;
CREATE TRIGGER trg_coupon_redeem_on_paid
  AFTER UPDATE OF payment_status ON public.orders
  FOR EACH ROW
  -- ⛔ ~~原版 `OLD.payment_status IS DISTINCT FROM 'paid'`~~ **作廢**(codex R2 must-fix):
  --    那是「**任何非 paid** ⇒ paid」, 而我的註解寫的是「unpaid ⇒ paid」——
  --    🔴 **碼比註解寬, 而寬出來的那一塊有一條真的壞路**:
  --      paid ⇒ refunded(redemption 被 revert)⇒ 再翻回 paid
  --      ⇒ trigger 觸發 ⇒ `coupon_redemptions` 的 `UNIQUE (order_id)` 擋住重建
  --      ⇒ 丙 吞掉那個錯 ⇒ **留下一張 paid 而沒有有效兌換的單**, 只有一筆 order_notes。
  --    ✅ 收緊成字面 `OLD.payment_status = 'unpaid'` ⇒ 碼與註解一致。
  --    🛑 **而「退款後再收款要不要重扣券」變成【明文不做】** —— 那不是漏掉:
  --      `UNIQUE (order_id)` 決定了一張單一輩子只有一列 redemption ⇒ 重扣在 schema 上就不成立。
  --      真的要做 ⇒ 那是 schema 決定, 要 Sean 拍, 不是在 WHEN 子句裡放寬一個字。
  --    📌 **一個比註解寬的條件, 寬出來的那一塊沒有人設計過。**
  -- 🛑 **而收緊之後【排除掉的不只那一族】**(R3 nit):`OLD = 'unpaid'` 也排除掉
  --    **`partiallyPaid` ⇒ `paid`**。今天安全 —— 全 migrations 掃 `SET payment_status='partiallyPaid'`
  --    ⇒ **零處**(而 enum 裡有這個值, 篩選 chip 的拍板把它當「還沒收錢」)。
  --    🔴 **部分收款那天上線 ⇒ 那種單的券【永不扣、不走丙、沒有聲音】。**
  --    ⇒ 那一天要回來改這裡。**寫在這裡, 因為做部分收款的人不會想到來讀券的 migration。**
  WHEN (
    NEW.coupon_id IS NOT NULL
    AND NEW.payment_status = 'paid'::public.payment_status
    AND OLD.payment_status = 'unpaid'::public.payment_status
  )
  EXECUTE FUNCTION public.coupon_redeem_on_paid();

-- 🔴🔴 **`ENABLE ALWAYS` —— 不寫的話預設是 `O`, 而 `O` 在 `session_replication_role = replica`
--    之下【整支被跳過】。**
--    量到的(2026-09-01, 拋棄式 PG;線 `-2d` 提出、我獨立驗):
--      預設(`tgenabled=O`)⇒ `SET session_replication_role = replica;` 之後 UPDATE 翻 paid
--        ⇒ `UPDATE 1` 而 `coupon_redemptions` 列數 = **0** ⇒ **券沒有被扣, 而沒有任何聲音。**
--    ⇒ 而 `replica` 正是**還原 / 大量匯入**會用的模式 —— 那不是假想情境。
--    ⚠️ 而 `ALTER TABLE … ENABLE TRIGGER` **一律把狀態設成 `O`** —— 它不是還原, 是覆寫。
--      ⇒ 有人 disable 再 enable 一次, 這支就從 `A` 掉回 `O` 而**沒有東西會紅**。
--      ⇒ 📌 所以下方那道自檢要問的是 `tgenabled = 'A'`, 不是「有沒有裝」。
--    🟢🟢 **而這一行【真的改變了行為】**(同一發測試, 兩個世界):
--      `tgenabled=O` ⇒ replica 模式翻 paid ⇒ `UPDATE 1` 而 redemption 列數 **0**
--      `tgenabled=A` ⇒ 同一發 ⇒ `UPDATE 1` 而 redemption 列數 **1**
--      ⇒ **加這一行不是保險, 是把一個實測到的繞過關掉。**
ALTER TABLE public.orders ENABLE ALWAYS TRIGGER trg_coupon_redeem_on_paid;

-- ── 🔴 自檢:trigger 真的【裝上而且是啟用的】────────────────────────────────
--    「函式建好了」與「trigger 接上了」是兩個宣稱, 而只有後者會讓券被扣。
--    ⚠️ `tgenabled` 要問值:`O` = 正常啟用;`D` = 停用。**只問「在不在」的話, 一支被
--       `DISABLE TRIGGER` 掉的 trigger 會通過** —— 而 `d1-restore.ts` 就會 disable 別支 trigger,
--       ⇒ 那個動作在這張表上是有前例的。
-- 🛑🛑 **這道自檢的【射程】要講清楚, 不然它會被讀成比實際寬**:
--    它跑在同一個交易裡、緊接在上面那句 `CREATE TRIGGER` 之後
--    ⇒ **本次 apply 它幾乎不可能紅** —— 我實測過:先 `DISABLE TRIGGER` 再重跑本檔 ⇒ rc=0,
--      因為本檔自己 `DROP + CREATE` 等於重裝了它。**那一發沒有判別力。**
--    ✅ **它真正防的是【未來有人編輯這支檔】** —— 拿掉 / 改名 / 挪走那句 CREATE TRIGGER
--      而自檢留著 ⇒ 下一次 apply 當場紅。
--    🟢 **而它真的會紅, 這是量到的**(2026-09-01 突變測試):
--      把 `CREATE TRIGGER trg_coupon_redeem_on_paid` 改名成 `zzq_mutated_trigger_name`
--      ⇒ `rc=3` + 逐字「片3b fail-closed:trg_coupon_redeem_on_paid 沒有裝在 public.orders 上 ⇒ 券永遠不會被扣」
--      ⇒ 還原後檔案 sha256 與突變前**逐字相同** `0ad0397a…07eeac`, 重跑 rc=0。
--    📌 **⇒ 一道跑在「剛做完那件事」之後的檢查, 它檢查的不是這一次, 是下一次。**
--       寫出來, 免得有人以為本次 apply 綠代表它驗過什麼。
DO $selfcheck$
DECLARE
  v_en "char";
BEGIN
  SELECT t.tgenabled INTO v_en
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'orders'
     AND t.tgname = 'trg_coupon_redeem_on_paid' AND NOT t.tgisinternal;
  IF v_en IS NULL THEN
    RAISE EXCEPTION '片3b fail-closed:trg_coupon_redeem_on_paid 沒有裝在 public.orders 上 ⇒ 券永遠不會被扣';
  END IF;
  -- 🔴 要的是 `A`(ALWAYS)不是 `O` —— 見上面那段:`O` 在 `session_replication_role=replica`
  --    之下整支被跳過, 而那是還原 / 大量匯入用的模式。**實測:`O` 之下券沒被扣而 UPDATE 照樣成功。**
  IF v_en <> 'A' THEN
    RAISE EXCEPTION
      '片3b fail-closed:trg_coupon_redeem_on_paid 的 tgenabled=% (要 A=ALWAYS)⇒ replica 模式下會被跳過, 券不會扣',
      v_en;
  END IF;
  -- 🔴🔴 **只驗名字與啟用狀態【不夠】**(codex R2 must-fix):
  --    未來有人把它改成綁錯函式、監看錯的欄位、或 `WHEN false` ——
  --    **只要名字一樣而且是 A, 上面兩格照樣全綠, 而券永遠不扣。**
  --    ⇒ 把【定義本身】釘住:綁的函式、時機(AFTER)、事件(UPDATE)、以及 WHEN 的字面。
  --    📌 一道只驗「它在不在」的閘, 擋不住「它變成了別的東西」。
  IF (SELECT t.tgfoid FROM pg_catalog.pg_trigger t
        JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'orders'
         AND t.tgname = 'trg_coupon_redeem_on_paid')
     IS DISTINCT FROM 'public.coupon_redeem_on_paid()'::regprocedure::oid THEN
    RAISE EXCEPTION '片3b fail-closed:trg_coupon_redeem_on_paid 綁的不是 public.coupon_redeem_on_paid()';
  END IF;
  -- 定義字面:`pg_get_triggerdef` 是反編譯結果, 所以**只釘幾個不會被等價改寫的關鍵字**,
  -- 不整串比(整串比會在 PG 升級或等價寫法時變成假紅 —— 那是 08-31 性別片 codex R3 推翻過的做法)。
  DECLARE
    v_def text := pg_catalog.pg_get_triggerdef(
      (SELECT t.oid FROM pg_catalog.pg_trigger t
         JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = 'orders' AND t.tgname = 'trg_coupon_redeem_on_paid'));
  BEGIN
    IF v_def NOT LIKE '%AFTER UPDATE OF payment_status%' THEN
      RAISE EXCEPTION '片3b fail-closed:trigger 不是 AFTER UPDATE OF payment_status ⇒ 實得 %', v_def;
    END IF;
    IF v_def NOT LIKE '%FOR EACH ROW%' THEN
      RAISE EXCEPTION '片3b fail-closed:trigger 不是 FOR EACH ROW ⇒ 實得 %', v_def;
    END IF;
    -- WHEN 的三個條件各釘一次:少一個就是行為變了
    IF v_def NOT LIKE '%coupon_id IS NOT NULL%' THEN
      RAISE EXCEPTION '片3b fail-closed:WHEN 少了「這張單有帶券」⇒ 實得 %', v_def;
    END IF;
    IF v_def NOT LIKE '%unpaid%' THEN
      RAISE EXCEPTION '片3b fail-closed:WHEN 少了 OLD=unpaid ⇒ 它會在退款後再收款時重觸發 ⇒ 實得 %', v_def;
    END IF;
  END;
  -- 🟢 正對照:同一把尺問一個現造的 trigger 名 ⇒ 必須查無(證明它不是恆真)
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'orders' AND t.tgname = 'zzq_no_such_trigger_0901'
  ) THEN
    RAISE EXCEPTION '片3b fail-closed:負對照命中 ⇒ 上面那把尺是恆真的, 它證明不了任何事';
  END IF;
END;
$selfcheck$;

-- 🔵 **`AFTER UPDATE OF payment_status`(不是 `AFTER INSERT OR UPDATE`)是刻意的**:
--    `scripts/d1-restore.ts:803` 是 `INSERT INTO public.orders SELECT *` ⇒ 還原不會誤觸發本 trigger。
--    (那支檔還會 `DISABLE TRIGGER` 掉快照 trigger, 而它點名的是那一支, 不是這一支。)

-- ════════════════════════════════════════════════════════════════════════════
-- 第 3 節:0 元單怎麼結清 —— `settle_zero_total_order()`
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 **為什麼不能沿用 `confirm_order_payment`**:它會寫一列 `order_payments`,
--    而 `order_payments.amount` 有 `CHECK (amount <> 0)`(`20260810100000:43`)
--    ⇒ **0 元的那一列物理上寫不進去。**
-- ✅ **而本函式【不寫任何 order_payments 列】。**
-- ⛔ ~~「而不變式仍然成立:『已收 = SUM(amount)』⇒ 0 列的 SUM 是 **0** ⇒ 等於 total 0 ✅
--    ⇒ 這不是繞過那個不變式, 是它本來就對 0 元單成立。」~~ **整段作廢**(codex R1 must-fix):
-- 🔴🔴 **PostgreSQL 零列的 `SUM()` 回 `NULL`, 不是 0。**(2026-09-01 實測, 含 coalesce 兩種寫法)
--    ⇒ 那個不變式**不會自己成立** ⇒ 而後果是真的:對帳的 P5 會把每一張 0 元單判成
--      `needs_human` / `G_LEDGER_NOT_BACKFILLED`。
--    ✅ **所以本檔第 4 節【明寫一支 P5 條件】去接住它** —— 那才是解法, 不是這段話。
--    📌 **而這段錯的話留著加刪除線, 因為它在【算術上】是對的**(0 個東西加起來是 0)——
--      **一個在日常直覺成立而在那個系統不成立的宣稱, 最容易被兩個人一起放過。**
--      (主視窗批 plan 時也讀過它, 而它核的是不變式的形狀, 不是那個 SQL 事實。)
-- 🛑 **而【不放寬那條 CHECK】是刻意的**(plan §1-乙):它撐著全站對帳,
--    為一個邊緣情境動它, 爆炸半徑遠大於本片。
--
-- 🔴 **而刷卡腿那兩道 `IF v_order.total <= 0` 一格都沒有動**
--    (`20260810160000:435` / `20260810170000:423`)—— 它們的註解逐字寫著它們在防什麼:
--      「total=0 且 p_amount=0 時上面的相等檢查**會過**, 然後 card 腿撞 `CHECK (amount <> 0)`
--       ⇒ 噴 **raw 23514**, PG 的 DETAIL 會把**整列值**帶出來(繞過 PF-E 的不洩內部狀態)」
--    ⇒ 📌 **它們防的是【洩漏】, 不是 0 元。**看起來像 0 元閘, 而理由完全是別的。
--    ⇒ **⇒ 動它們等於打開一條洩漏路徑。0 元單本來就不該走刷卡腿。**

CREATE FUNCTION public.settle_zero_total_order(p_order_id uuid)
RETURNS jsonb                 -- {confirmed boolean, idempotent boolean};形狀對齊 confirm_order_payment
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '3s'       -- 函式範圍(不是 SET LOCAL —— 那會洩漏到呼叫端交易, 3b R3 實測過)
AS $zt$
DECLARE
  v_order record;
  v_n     integer;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'settle_zero_total_order: p_order_id 不得為 NULL';
  END IF;

  -- 🔴 `FOR UPDATE`:與翻 paid 同一筆交易鎖住那一列, 防兩個請求同時結清同一張單。
  -- ══════════════════════════════════════════════════════════════════════════
  -- 🔴🔴 **歸屬寫進 `WHERE`, 不是寫成 SELECT 之後的一道檢查。**(codex R2 must-fix)
  -- ══════════════════════════════════════════════════════════════════════════
  -- ⛔ ~~R1 之後的版本:`WHERE id = p_order_id FOR UPDATE`, 然後在下面才比 `customer_user_id`~~
  --    **作廢** —— 我 R1 修的是【訊息】那一半, 而**鎖那一半沒有修到**:
  --    🔴 未授權的呼叫**仍然先拿到了別人那一列的 `FOR UPDATE` 鎖**, 然後才被通用訊息拒絕。
  --    ⇒ 拿一個已知的 order uuid 連續送 ⇒ **壓住別人的結帳**, 而每一發看起來都只是「結清失敗」。
  --    📌 **我以為那一條修好了 —— 而 codex 指的是同一行的另一半。**
  --      ⇒ 「訊息不洩漏」與「不碰到那一列」是兩個宣稱, 而它們住在同一句 SQL 裡。
  -- ✅ 把歸屬放進 `WHERE` ⇒ **不是你的單, 那一列從頭到尾沒有被選中, 也就沒有被鎖。**
  SELECT id, total, payment_status, cancelled_at, coupon_id, customer_user_id
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
     AND customer_user_id = (select auth.uid())
     FOR UPDATE;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 🔴🔴 **歸屬第一個驗, 而其餘的拒絕【一律同一句話】。**(codex R1 must-fix #3)
  -- ══════════════════════════════════════════════════════════════════════════
  -- ⛔ ~~第一版把歸屬放在「查無 / 非零 / 已取消」三道【之後】~~ **作廢**, 兩個問題:
  --    ① **它是一支探針**:拿別人的 uuid 餵進來, 從四種不同的錯誤訊息就分辨得出
  --       那張單存不存在、金額是不是 0、有沒有被取消 —— **而那些都是別人的訂單狀態。**
  --    ② **驗權之前就拿了那一列的 `FOR UPDATE` 鎖** ⇒ 未授權的呼叫可以壓住別人的結帳。
  -- ✅ 現在:`NOT FOUND` 與「不是你的單」印**同一句**, 而其餘檢查在歸屬過了之後才跑。
  --    📌 **一句誠實的錯誤訊息, 在錯的順序上就是一支查詢介面。**
  -- 🔵 而 R2 之後歸屬已經在上面那句 `WHERE` 裡了 ⇒ **不是你的單就直接 `NOT FOUND`**
  --    ⇒ 下面這個 `IS DISTINCT FROM` 是**縱深**:有人哪天把 `WHERE` 那一行拿掉時, 它還會擋。
  --    ⚠️ 而縱深不等於可以拿掉 `WHERE` 那半 —— **只有 `WHERE` 那半擋得住「拿到鎖」。**
  IF NOT FOUND OR v_order.customer_user_id IS DISTINCT FROM (select auth.uid()) THEN
    -- 🔵 形狀照 `confirm_order_payment` 的 PF-E:業務拒絕用單一通用訊息、不洩內部狀態。
    RAISE EXCEPTION 'settle_zero_total_order: 結清失敗';
  END IF;
  -- 🟢🟢 **這一道真的擋得住 —— 餵過, 不是推的**(拋棄式 PG, 2026-09-01):
  --    建一張屬於別人(`2222…`)的 total=0 unpaid 單, 而 `auth.uid()` 替身回 `1111…`
  --    ⇒ `ERROR: settle_zero_total_order: 結清失敗` + **那張單的 status 仍是 `unpaid`**
  --    ⚠️ 而第一次餵的時候它回的是「查無此單」—— **那張單根本沒建成**(display_id 格式不合)
  --      ⇒ 📌 **那一發沒有測到歸屬, 它測到的是「那一列不存在」** —— 而兩者都印一個 ERROR。
  --      ⇒ **所以要多看一格:那張單建成了沒。**修好之後才是真的測到。
  --    ⚠️ **而上面的順序調整之後那兩種【本來就印同一句了】** ⇒ 那一發要改成看
  --      「別人那張單的 status 有沒有被動到」, 不能再靠訊息分辨。

  -- 🔴🔴 **`total = 0` 而不是 `<= 0`** —— 負數不是「0 元單」, 是算式壞了。
  --    用 `<= 0` 的話, 一張 total = -100 的壞單會被**安靜地結清成已付款**。
  IF v_order.total <> 0 THEN
    RAISE EXCEPTION
      'settle_zero_total_order: 這張單的金額不是 0(total=%)—— 本函式只結清 0 元單, 有金額的走刷卡腿',
      v_order.total;
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 🔴🔴 **0 元單必須帶券 —— 與建單閘用同一個判準。**(codex R1 must-fix #4)
  -- ══════════════════════════════════════════════════════════════════════════
  --    `create_order` 那一頭已經擋掉「0 元而沒有券」(贈品-only 的車, Sean 的業務假設)。
  -- 🔴 **而 `admin_create_manual_order` 走的是另一條路** —— 它允許零單價、零運費、無券的單。
  --    ⇒ 那張單一旦存在, 客人**直接呼叫本 RPC 就能把它翻成 paid**
  --    ⇒ 📌 **一道新的入口, 重新開放了舊入口守住的東西 —— 而舊入口的守門完全沒有壞。**
  --    ⇒ 這是本片自己造出來的洞, 不是既有的。
  -- ✅ 所以這裡用**同一個判準**(0 元 ⇒ 必有券), 而不是各寫一次:
  --    兩處的規則若哪天要改, 它們必須一起改 —— 而這行字是唯一會提醒下一個人的東西。
  IF v_order.coupon_id IS NULL THEN
    RAISE EXCEPTION
      'settle_zero_total_order: 這張 0 元單沒有帶券(order_id=%)—— 只有全額折抵券的單走本函式;'
      '贈品需與正價商品同車(與 create_order 那道閘同一個判準)', p_order_id;
  END IF;

  IF v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'settle_zero_total_order: 這張單已取消, 不結清(order_id=%)', p_order_id;
  END IF;
  -- 🟢🟢 **這一道真的擋得住 —— 餵過, 不是推的**(拋棄式 PG, 2026-09-01):
  --    建一張屬於別人(`2222…`)的 total=0 unpaid 單, 而 `auth.uid()` 替身回 `1111…`
  --    ⇒ `ERROR: settle_zero_total_order: 結清失敗` + **那張單的 status 仍是 `unpaid`**
  --    ⚠️ 而第一次餵的時候它回的是「查無此單」—— **那張單根本沒建成**(display_id 格式不合)
  --      ⇒ 📌 **那一發沒有測到歸屬, 它測到的是「那一列不存在」** —— 而兩者都印一個 ERROR。
  --      ⇒ **所以要多看一格:那張單建成了沒。**修好之後才是真的測到。

  -- 冪等:已經 paid ⇒ 回上次的結果, 不重寫、不重觸發 trigger。
  -- 🔵 形狀照 `confirm_order_payment`(`20260810170000:72-75`), 不自己發明一個。
  IF v_order.payment_status = 'paid'::public.payment_status THEN
    RETURN pg_catalog.jsonb_build_object('confirmed', true, 'idempotent', true);
  END IF;

  IF v_order.payment_status <> 'unpaid'::public.payment_status THEN
    RAISE EXCEPTION
      'settle_zero_total_order: 這張單的付款狀態是 % —— 只有 unpaid 能被結清', v_order.payment_status;
  END IF;

  -- ── 翻 paid ──────────────────────────────────────────────────────────────
  -- 🔴 `payment_method = 'zero_total'`(英文代碼, 對齊既有的 `'tappay'`)。
  --    顯示層翻中文:`apps/storefront/src/lib/orders/order-display.ts` 的 `PAYMENT_METHOD_LABEL`。
  --    ⚠️ 而**後台沒有這一軸的對照表** ⇒ 員工會看到 `zero_total` 這個代碼。
  --      那不是本片造成的(`tappay` 今天也是這樣), 已交回主視窗。
  -- 🔴 `tappay_rec_trade_id` **不寫** —— 沒有交易, 而它是 UNIQUE;塞一個假值會佔掉別人的號。
  UPDATE public.orders
     SET payment_status = 'paid'::public.payment_status,
         paid_at        = pg_catalog.now(),
         payment_method = 'zero_total',
         updated_at     = pg_catalog.now()
   WHERE id = p_order_id
     AND payment_status = 'unpaid'::public.payment_status;

  -- 🔴 row_count 守(照 `confirm_order_payment` 的 PF-C):FORCE RLS 之下 UPDATE 可能**靜默 0 列**
  --    ⇒ 那會變成「結清成功了而單沒翻」。
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'settle_zero_total_order: 翻 paid 影響了 % 列(期望 1)', v_n;
  END IF;

  -- ✅ **不寫 order_payments** —— 見本節開頭。
  -- ✅ **券由 3b 那支 trigger 扣**:`trg_coupon_redeem_on_paid` 掛在 `unpaid⇒paid` 上
  --    ⇒ 上面那句 UPDATE 會觸發它。
  --    🛑 而「應該會觸發」不算 —— 驗收有一格是**餵一張全額券的 0 元單, 看 redemption 有沒有那一列**。

  RETURN pg_catalog.jsonb_build_object('confirmed', true, 'idempotent', false);
END;
$zt$;

COMMENT ON FUNCTION public.settle_zero_total_order(uuid) IS
  'M-4b:結清一張 total = 0 的訂單(全額折抵券;儲值金那天走同一支)。'
  '🔴 不寫任何 order_payments 列 —— 那張表的 amount 有 CHECK (amount <> 0), 0 元寫不進去;'
  '而不變式「已收 = SUM(amount)」對 0 列成立(SUM = 0 = total)。'
  '🔴 命名照【觸發條件】(total = 0)不照【今天的成因】(券)—— 成因會變, 條件不會。'
  '🛑 只吃 total = 0 且 unpaid 且未取消。total <> 0 一律拒(負數是算式壞了, 不是 0 元單)。'
  '✅ 券由 20260901021000 的 trigger coupon_redeem_on_paid() 在 unpaid⇒paid 那一刻扣, 不在本函式裡。'
  '⚠️ 0 元單【不能退款】(主視窗 2026-09-01 裁):退 0 元沒有金額可退 —— 那不是「退款失敗」, '
  '是「這個動作對這張單沒有意義」。而 UI 上要說得出來, 不是把鈕藏起來。';

-- 🔴 收權:新物件出生就自帶 PUBLIC EXECUTE(`docs/patterns/revoking-function-execute-in-supabase.md`)。
REVOKE ALL ON FUNCTION public.settle_zero_total_order(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_zero_total_order(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.settle_zero_total_order(uuid) FROM authenticated;
-- 🔴 **給 authenticated** —— 結帳是客人自己按的, 而身分在函式內由 `orders` 那一列的擁有者決定。
--    ⚠️ 而它 **SECURITY DEFINER + 只吃 order_id** ⇒ 客人可以拿別人的 order_id 來叫它。
--      ⇒ 那會怎樣:別人那張單若是 total=0 且 unpaid, 它會被結清成已付款。
--      🔴 **而那【不是】洩漏(它不回傳任何訂單資料), 但它是【替別人的單改狀態】。**
--      ⇒ 所以下面加一道歸屬檢查, 而不是靠「客人不知道別人的 uuid」。
-- ACL-GATE-EXEMPT: public.settle_zero_total_order -- 客人自己按的結帳最後一步(0 元單, 2026-09-01)
-- 🔴 **為什麼不是 `service_role`**(閘要求寫得出這一句):
--    結帳是**客人自己按的**, 而這支函式的歸屬是靠 `auth.uid()` 驗的
--    (`WHERE … AND customer_user_id = (select auth.uid())`)。
--    改成 `service_role` = 要 server 代打 ⇒ 那時 `auth.uid()` 變成 server 的身分
--    ⇒ **歸屬檢查整個失效**, 而它是本函式唯一擋住「結清別人的單」的東西。
--    🔵 形狀與 `create_order` 同一個理由(`20260719120000:514` 那條既有授權, 本檔上面也豁免了它)。
-- ⚠️ 而那道閘自己說的天花板要記著:**它對 dashboard / SQL Editor 手動 GRANT 是盲的** ——
--    這一行進得了 repo, 而有人在線上手動開的權限它一個字都看不到。
GRANT EXECUTE ON FUNCTION public.settle_zero_total_order(uuid) TO authenticated;

-- 🔴 收權【斷言】—— 三句 REVOKE 跑完 rc=0 **證明不了它們生效了**(REVOKE 一個本來就沒有的權限也是 rc=0)。
--    清單形狀照守門 `scripts/migration-static-checks.sh:562-565` 認得的那一個
--    (`v_functions text[] :=` 一路吃到 `]::text[]`)⇒ **一把它讀不到的清單等於沒有清單。**
DO $acl0$
DECLARE
  v_functions text[] := ARRAY[
    'public.settle_zero_total_order(uuid)'
  ]::text[];
  v_fn    text;
  v_oid   oid;
  v_acl   aclitem[];
  v_extra text[];
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
    v_oid := v_fn::regprocedure::oid;
    SELECT p.proacl INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
    -- 🔴 `proacl` 是 NULL = **走預設 = PUBLIC 有 EXECUTE**, 不是「沒有人有權限」。搞反的話整道恆綠。
    IF v_acl IS NULL THEN
      RAISE EXCEPTION '0 元片 fail-closed:% 的 proacl 是 NULL ⇒ 走預設 = PUBLIC 有 EXECUTE ⇒ REVOKE 沒生效', v_fn;
    END IF;
    -- 🔴 LEFT JOIN 不是 JOIN:aclexplode 給 PUBLIC 的 grantee 是 oid 0, 而 pg_roles 沒有 0
    --    ⇒ 內部 JOIN 會把 PUBLIC 那一列靜靜丟掉 ⇒ 這把尺看不到它唯一要防的那一種。
    SELECT coalesce(array_agg(gr), ARRAY[]::text[]) INTO v_extra
      FROM (SELECT coalesce(r.rolname::text, 'PUBLIC') AS gr
              FROM (SELECT (aclexplode(v_acl)).grantee AS gid) x
              LEFT JOIN pg_catalog.pg_roles r ON r.oid = x.gid) y
     WHERE gr NOT IN ('authenticated', (SELECT r2.rolname::text FROM pg_catalog.pg_proc p2
                                          JOIN pg_catalog.pg_roles r2 ON r2.oid = p2.proowner
                                         WHERE p2.oid = v_oid));
    IF array_length(v_extra, 1) IS NOT NULL THEN
      RAISE EXCEPTION '0 元片 fail-closed:% 的 EXECUTE 開給了預期外的角色:%', v_fn, v_extra;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '0 元片 fail-closed:authenticated 拿不到 % 的 EXECUTE(客人結不了 0 元單)', v_fn;
    END IF;
  END LOOP;
  -- 🟢 負對照:同一把尺對一支現造的函式必須查無(它若對什麼都成立就沒有判別力)
  IF pg_catalog.to_regprocedure('public.zzq_no_such_settle_0901(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '0 元片 自檢:負對照命中一支不該存在的函式 ⇒ 量具可疑';
  END IF;
END $acl0$;

-- 🔴 新函式要刷 PostgREST 的 schema cache, 不刷的話呼叫在 cache 過期前打不中,
--    而那個失敗看起來像「函式不存在」。
NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 第 4 節:對帳那一頭 —— `admin_compute_order_settlement` 新一代(P5 加一支)
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 **為什麼在同一支 migration 裡**:0 元單能結清了而對帳沒改 ⇒ **每一張 0 元單都變成一筆假異常**。
--    ⇒ 兩半必須一起生效 ⇒ 一個交易, 半套在物理上不可能(與 021000 合併那次同一個理由)。
--
-- 🛑 **而【不可以就地改 `20260812140000`】** —— 它已經 apply(`APPLIED.tsv` 命中 ^20260812140000 ⇒ 1;
--    🟢 正對照 ^20260829150000 ⇒ 1 · 🔵 負對照 ^20260901030000 ⇒ 0)。
--    ⇒ 改一支已 apply 的 migration = 帳本上那一列的雜湊與檔案內容對不上 ⇒ **帳本會說謊。**
--    📌 而那正是本線 `fd0036f5` 那一顆在修的病(「它偷了別人的帳本列」)——
--       **我四小時前才 commit 過它, 而知道那件事沒有讓我不去做它。停下我的是「先確認 apply 狀態」那個動作。**
--
-- ── 這一代抄自哪一代, 以及怎麼確認的 ────────────────────────────────────────
--    `bash scripts/latest-definition-of.sh admin_compute_order_settlement` ⇒
--      20260811030000  create  已記
--      20260812140000  cor     已記      ← newest = live = 這一支
--    ⇒ 從 `20260812140000:356-554`(199 行)**逐字**抄出, 只改 P5 那一支。
--    🟢 `diff 舊 新` ⇒ **只有一行被換掉**(其餘 13 行是新增的註解與那一支條件)。
--
-- ── 🔴 而「diff 只差 P5」不等於安全 —— 抄 200 行還要問另一件事 ──────────────
--    **這 199 行裡有沒有別的東西, 它的前提只在 `20260812140000` 那一刻成立?**
--    (那不是 diff 抓得到的 —— 它比的是兩份檔, 不是檔與世界。)
--    ⇒ 逐項查過:本函式引用 11 個 `public.*` 物件, 其中 **4 個在 20260812140000 之後被動過**:
--      · `order_payments`            ⇐ 20260823030000(只有 ENABLE ROW LEVEL SECURITY, 零欄位改動)
--      · `order_refunds`             ⇐ 20260830210000(該檔 `ALTER TABLE` 命中 **0** 處)
--      · `payment_charge_attempts`   ⇐ 20260820040000(ADD COLUMN capture_state + 兩條 CHECK)
--      · `orders`                    ⇐ 六支, 全是 ADD COLUMN(tax_total / invoice_requested /
--                                       manual_request_* / coupon_id …)
--    ✅ 而本函式從這四張表讀的欄逐一比對過:
--      order_payments  → amount, id, order_id, rail, rec_trade_id, received_at, reverses_payment_id
--      order_refunds   → order_id, status
--      orders          → cancelled_at, cancelled_reason, id, payment_status, subtotal, total
--      payment_charge_attempts → id, order_id, rec_trade_id, status
--    ⇒ **後續那四支對這些欄的 `DROP/ALTER/RENAME COLUMN` 命中 0 處**, 也沒動 `status` 的值域。
--    ⚠️ 而這是**靜態比對**:它答得出「欄還在、型別沒被改」, **答不出「語意有沒有漂」**。
--      ⇒ 主視窗會用唯讀正式庫比 `pg_proc.prosrc` —— **那才是「我抄的與正在跑的相同」的證據。**
--      📌 而那是「不自驗」的正確形狀:我寫, 它用一個**我碰不到的來源**比。
--
-- ── 🟢🟢 **兩個方向各餵一發**(主視窗指定, 而這一格不准省)────────────────────
--    ① **0 元單 + 零收款列** ⇒ 新行為要放行
--       那張單的事實:`total=0 status=paid 收款列=0`
--       實得:`{"verdict": "settled", "reasons": [], "net": 0, "gross": 0, "receivable": 0}`
--    ② 🔴 **有金額的單 + 零收款列** ⇒ **舊保護必須一格沒掉**
--       現造一張 `total=5000 status=paid 收款列=0` 的單 ⇒ 實得:
--       `{"verdict": "needs_human", "reasons": ["D_NO_SNAPSHOT", "G_LEDGER_NOT_BACKFILLED"], …}`
--    ⇒ 📌 **②那一發才是重點** —— 沒有它,「我放寬了 P5」與「我把 P5 弄壞了」**印同一個綠**。
--    ⚠️ 而這兩發跑在**替身**上:那 11 張表裡有 **2 張是我現造的**
--      (`order_cancellation_items` / `order_refund_jobs`), 另有多張缺欄是邊跑邊補的
--      ⇒ 它證得了**這一支條件的邏輯**, **證不了真表上其餘六個 P 值的行為**。

CREATE OR REPLACE FUNCTION public.admin_compute_order_settlement(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE                       -- 唯讀;STABLE 而非 IMMUTABLE(讀表)
SECURITY DEFINER
SET search_path = ''
AS $fn$
WITH o AS (
  SELECT ord.id,
         ord.total,
         ord.subtotal,
         ord.payment_status::text AS ps,
         ord.cancelled_at,
         ord.cancelled_reason,
         -- 🔴 2026-09-01 新增(0 元訂單片):P5 那一支要靠它才問得出
         --    「這張 0 元單**真的走過結清那條路**」, 而不只是「它的 total 現在是 0」。
         --    ⚠️ 這是本片對 `20260812140000` 那一代**除了 P5 之外唯一的改動**。
         ord.payment_method
    FROM public.orders ord
   WHERE ord.id = p_order_id
),
-- ── 收款面 ────────────────────────────────────────────────────────────────
pay AS (
  SELECT pg_catalog.count(*)                                        AS rows_n,
         -- 🔴 關卡2:不要 ::integer。sum() 回 bigint,硬轉會在溢位時**噴錯**而不是落 needs_human。
         coalesce(pg_catalog.sum(op.amount), 0)::bigint AS gross,
         pg_catalog.count(*) FILTER (
           WHERE op.received_at > pg_catalog.now())                 AS future_n
    FROM public.order_payments op
   WHERE op.order_id = p_order_id
),
-- 沖銷形狀:①指向同單既有列且金額為反號 ②同一列至多被沖一次
rev_bad AS (
  SELECT pg_catalog.count(*) AS n
    FROM public.order_payments r
   WHERE r.order_id = p_order_id
     AND r.reverses_payment_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.order_payments t
                      WHERE t.id = r.reverses_payment_id
                        AND t.order_id = r.order_id
                        AND t.amount = -r.amount)
),
rev_dup AS (
  SELECT pg_catalog.count(*) AS n
    FROM (SELECT r.reverses_payment_id
            FROM public.order_payments r
           WHERE r.order_id = p_order_id
             AND r.reverses_payment_id IS NOT NULL
           GROUP BY r.reverses_payment_id
          HAVING pg_catalog.count(*) > 1) d
),
-- ── 品項快照 ──────────────────────────────────────────────────────────────
-- 🔴 比的是 `subtotal` 不是 `total`:`20260604120000:112` 已有 DDL CHECK
--    `total = subtotal + shipping_fee - discount_total` ⇒ 再驗那條是恆真守門。
--    items 住在另一張表、**跨表這一段沒有 DDL 在守**,那才是會漂的地方。
items AS (
  SELECT pg_catalog.count(*)                                          AS n,
         coalesce(pg_catalog.sum(oi.line_total), 0)::bigint AS sum_line
    FROM public.order_items oi
   WHERE oi.order_id = p_order_id
),
-- ── 取消面(三處都看;Fable F11 核可 AND-of-negatives 的 fail-closed 方向)──
canc AS (
  SELECT (SELECT pg_catalog.count(*) FROM public.order_cancellations c
            WHERE c.order_id = p_order_id)
       + (SELECT pg_catalog.count(*) FROM public.order_cancellation_items ci
            WHERE ci.order_id = p_order_id) AS n
),
-- ── attempts 覆蓋(前提 5)─────────────────────────────────────────────────
-- 🔴 Fable F3:`order_payments` **無 attempt_id 欄**,唯一可行 join 鍵是 rec_trade_id;
--    但卡腿唯一鍵是 (order_id, rec_trade_id) 而 attempts 側 rec **全域唯一**
--    ⇒ 裸 rec join 會被「**別張單**的同 rec 卡腿」滿足。兩個鍵都要比。
att AS (
  SELECT pg_catalog.count(*) FILTER (WHERE a.status = 'charged') AS charged_n,
         pg_catalog.count(*) FILTER (
           WHERE a.status = 'charged'
             AND NOT EXISTS (SELECT 1 FROM public.order_payments op
                              WHERE op.order_id     = a.order_id
                                AND op.rail         = 'card'
                                AND op.rec_trade_id = a.rec_trade_id)) AS uncovered_n
    FROM public.payment_charge_attempts a
   WHERE a.order_id = p_order_id
),
-- ── 退款面:**四個**來源(Fable F4)────────────────────────────────────────
ref AS (
  SELECT
    -- ① 訂單級舊帳本:只有 status='failed' 除外;`processing` 恆為跡象。
    --    🔴 **擋不掉什麼**(reviewer I3):四面裡只有這一面的除外值**沒有結構撐腰** ——
    --    ③ 的 failed 有 `orj_shape_failed` 保證 `refund_call_attempted_at IS NULL`、
    --    ② 的 failed 是 terminal 事件、④ 的 dismissed 有 status 一致性 CHECK;
    --    而 `order_refunds.status='failed'` **只有值域 CHECK**,沒有任何約束保證「外呼沒發生過」。
    --    ⇒ 若某天有人把已送出的退款標成 failed,這一面就會漏掉它。這是已知缺口,不是被守住的面。
    (SELECT pg_catalog.count(*) FROM public.order_refunds orf
      WHERE orf.order_id = p_order_id AND orf.status <> 'failed')                    AS old_n,
    -- ② L5b attempt 級 —— 🔴 **沖銷片改寫**:改吃 canonical view,不再自己問「有沒有 manual」。
    --    形狀刻意**維持原本的雙重否定**(plan §11-3):
    --      除外(不算跡象) ⇔ EXISTS(有效終局) AND NOT EXISTS(有效終局 且 indicates_refund)
    --    · **左半不能省**(Fable F5 原意):少了它,「零有效終局」(只有 `sent` 或只有
    --      `result_unknown` —— 兩個最危險的未知態)會被空集合當成「全 failed」而除外。
    --    · **不得簡化成單一 EXISTS(有效終局 AND NOT indicates_refund)**:那在 trigger 被繞過、
    --      同時存在兩筆有效終局(一 true 一 false)時會翻成 **fail-open**;現寫法仍 fail-closed。
    --    · 舊字面認 `result_success` 為終局,那是 2d 之前的殘留(plan §11-1 的既存 drift);
    --      新語意由 view 單一權威定義(`result_confirmed`/`result_failed`/`manual`)。
    (SELECT pg_catalog.count(*)
       FROM public.payment_refunds pr
       JOIN public.payment_charge_attempts a2 ON a2.id = pr.attempt_id
      WHERE a2.order_id = p_order_id
        AND NOT (
              EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et
                       WHERE et.refund_id = pr.id)
          AND NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et
                           WHERE et.refund_id = pr.id
                             AND et.indicates_refund)
        ))                                                                            AS l5b_n,
    -- ③ 在途退款工單:🔴 `failed` 態由 `orj_shape_failed`(20260731120000:395-400)硬性要求
    --    `refund_call_attempted_at IS NULL` ⇒ **DDL 保證外呼從未發生 = 錢確定沒動**,除外它安全。
    --    其餘六值(queued/processing/submitted/reconciling/completed/dead)全算跡象。
    (SELECT pg_catalog.count(*) FROM public.order_refund_jobs j
      WHERE j.order_id = p_order_id AND j.status <> 'failed')                        AS job_n,
    -- ④ 雙扣異常:走 Dashboard 退款、**不經 ①②** ⇒ 任何非 dismissed 列都算跡象
    (SELECT pg_catalog.count(*) FROM public.payment_double_charge_anomalies dc
      WHERE dc.old_order_id = p_order_id AND dc.status <> 'dismissed')               AS anom_n
),
-- ── 七條前提 P1-P7(每條以 IS TRUE 收斂;NULL 一律當 false)────────────────────────
prem AS (
  SELECT
    -- P1 訂單存在 + 狀態在**可判定集**內。
    --    🔴 五值(20260604120000:50 四值 + 20260725130000:45 partiallyRefunded),
    --    `refunded` / `partiallyRefunded` **排除**:退款帳本 2026-07-25 才建,更早的退款
    --    在庫內零跡象 ⇒ 「refunded + 四面皆空」會湊出「全 true 但錢已退」(Fable F1)。
    (o.ps IN ('unpaid','paid','partiallyPaid')) IS TRUE                    AS p1,
    -- P2 完全沒有取消痕跡(四處)
    (o.cancelled_at IS NULL
     AND o.cancelled_reason IS NULL
     AND canc.n = 0)                                    IS TRUE            AS p2,
    -- P3 品項快照完整
    (items.n > 0 AND items.sum_line = o.subtotal::bigint) IS TRUE          AS p3,
    -- P4 收款列形狀乾淨
    (pay.future_n = 0 AND rev_bad.n = 0 AND rev_dup.n = 0) IS TRUE         AS p4,
    -- P5 帳本覆蓋可信。🔴 branch 1 必須連 charged attempt 一起看(Fable F2):
    --    「unpaid + 零卡腿 + 有 charged attempt」= mark 半途死 / OP3 寫腿失敗,
    --    DB 裡明擺著錢動過(charged ⇒ rec_trade_id 非空,20260612150000:98),
    --    少了這一句會判 underpaid。
    (((o.ps = 'unpaid' AND pay.rows_n = 0 AND att.charged_n = 0))
      OR (pay.rows_n > 0 AND att.uncovered_n = 0)
      -- 🔴🔴 **第三支(2026-09-01, 0 元訂單片):`total = 0` 的單本來就沒有收款列。**
      --    ⇒ 那**不是「帳本沒回填」** —— 它本來就沒有東西可以填。
      --    成因:`order_payments.amount` 有 `CHECK (amount <> 0)`(`20260810100000:43`)
      --      ⇒ **0 元的收款列物理上寫不進去** ⇒ 全額折抵券的單走
      --        `settle_zero_total_order()`(`20260901030000`), 它刻意不寫帳本列。
      --    🔴 少了這一支, **每一張 0 元單都會被判成 `needs_human` / `G_LEDGER_NOT_BACKFILLED`**
      --      (下方那一格 `NOT c.p5 AND c.ps <> 'unpaid' AND c.rows_n = 0`)—— 而它其實是正常的。
      --    🔴 **本支【只放行 total = 0】** —— 有金額而零收款列的單**仍然判 false**(舊保護一格沒動)。
      --    📌 而作者原本的論證是「0 列的 SUM 是 0 ⇒ 不變式自己成立」⇒ **那句話是錯的**:
      --      PostgreSQL 零列的 `SUM()` 回 **NULL**, 不是 0(2026-09-01 實測, 含 coalesce 兩種寫法)。
      --      ⇒ **所以不能靠不變式自己成立, 要在這裡明寫一支。**
      -- ⛔ ~~本支第一版寫 `OR (o.total = 0 AND pay.rows_n = 0)`~~ **太寬**(codex R2 must-fix):
      --    ① 一張**還沒結清**的 0 元單(`unpaid`)也會走進來 ⇒ 而它不是 settled, 它是還沒付。
      --    ② 一張本來有金額、後來 `total` 被改成 0 的舊單 ⇒ 會**掩蓋掉真的**
      --       `G_LEDGER_NOT_BACKFILLED`(它確實少了收款列, 而那是問題)。
      -- ✅ 收緊成「**真的走過結清那條路**」:paid + `payment_method = 'zero_total'` + 零收款列。
      --    📌 判別句:**問「它怎麼變成 0 的」, 不要只問「它現在是不是 0」。**
      OR (o.total = 0 AND pay.rows_n = 0
          AND o.ps = 'paid' AND o.payment_method = 'zero_total'))
                                                         IS TRUE            AS p5,
    -- P6 四個退款面全空
    (ref.old_n = 0 AND ref.l5b_n = 0 AND ref.job_n = 0 AND ref.anom_n = 0) IS TRUE AS p6,
    -- P7 金額落在 int4 範圍內(溢位 ⇒ 不可判定,而不是噴錯)
    -- 🔴 關卡2 R2:**溢位守門自己不能溢位**。第一版用 `abs(bigint)`:①`bigint` 最小值取 abs 會拋錯
    --    ②`gross - total` 可能**先溢位**才輪到 abs,而 SQL 的 AND **不保證求值順序**、擋不住。
    --    ⇒ 一律先轉 `numeric`(任意精度、不會溢位)再比範圍,且用 BETWEEN 不用 abs。
    (pay.gross::numeric BETWEEN -2147483648 AND 2147483647
     AND (pay.gross::numeric - o.total::numeric) BETWEEN -2147483648 AND 2147483647)
                                                        IS TRUE                   AS p7
    FROM o, pay, rev_bad, rev_dup, items, canc, att, ref
),
calc AS (
  SELECT o.total                                   AS receivable,
         pay.gross                                 AS gross,
         (pay.gross - o.total::bigint)             AS net,   -- R=0 才會用到(P6 為真時)
         prem.p1, prem.p2, prem.p3, prem.p4, prem.p5, prem.p6, prem.p7,
         (prem.p1 AND prem.p2 AND prem.p3 AND prem.p4 AND prem.p5 AND prem.p6
          AND prem.p7) AS all_ok,
         o.ps, pay.rows_n, att.charged_n, att.uncovered_n,
         items.n AS items_n, canc.n AS canc_n
    FROM o, pay, prem, att, items, canc
)
SELECT pg_catalog.jsonb_build_object(
  'scope',      'db_internal_only',
  'gross',      c.gross,
  -- 🔴 關卡2:**輸出數字的條件必須與 verdict 降級的條件是同一個**。
  --    第一版 refunded 只看 p6 ⇒ 歷史 payment_status='refunded' 且四本帳皆空時,
  --    verdict 是 needs_human 卻同時宣稱 `refunded: 0` —— 那正是本片存在的理由(假信心)。
  'refunded',   CASE WHEN c.all_ok THEN 0 ELSE NULL END,
  'receivable', CASE WHEN c.all_ok THEN c.receivable ELSE NULL END,
  'net',        CASE WHEN c.all_ok THEN c.net ELSE NULL END,
  'verdict',    CASE
                  WHEN NOT c.all_ok  THEN 'needs_human'
                  WHEN c.net = 0     THEN 'settled'
                  WHEN c.net < 0     THEN 'underpaid'
                  WHEN c.net > 0     THEN 'overpaid'
                  ELSE 'needs_human'          -- 🔴 NULL 兜底(Fable F6),不是裝飾
                END,
  -- 🔴 reasons **累積全部命中**,不是第一個 CASE 就短路:一張舊 paid 單可能同時零收款、
  --    有退款、有取消,值班要看到三個。
  'reasons',
    pg_catalog.to_jsonb(pg_catalog.array_remove(ARRAY[
      CASE WHEN NOT c.p1 THEN 'STATUS_NOT_DECIDABLE'        END,
      CASE WHEN NOT c.p2 THEN 'D_HAS_CANCELLATION'          END,
      CASE WHEN NOT c.p3 THEN 'D_NO_SNAPSHOT'               END,
      CASE WHEN NOT c.p4 THEN 'PAYMENT_ROW_SHAPE_ANOMALY'   END,
      -- P5 拆三碼:處置完全不同(前者=OP4 餵料、中者=線上寫入故障、後者=錢動過但單還 unpaid)
      CASE WHEN NOT c.p5 AND c.ps <> 'unpaid' AND c.rows_n = 0
             THEN 'G_LEDGER_NOT_BACKFILLED'                 END,
      CASE WHEN NOT c.p5 AND c.rows_n > 0 AND c.uncovered_n > 0
             THEN 'G_LEDGER_WRITE_GAP'                      END,
      CASE WHEN NOT c.p5 AND c.ps = 'unpaid' AND c.charged_n > 0
             THEN 'G_UNPAID_WITH_CHARGED_ATTEMPT'           END,
      CASE WHEN NOT c.p6 THEN 'R_REFUND_TRACE_PRESENT'      END,
      CASE WHEN NOT c.p7 THEN 'AMOUNT_OUT_OF_RANGE'           END
    ], NULL))
) FROM calc c
$fn$;

COMMIT;
