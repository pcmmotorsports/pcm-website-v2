-- M-4b E10 `#13` 片1a:改金額的寫入面(`admin_update_order_item_amount` + 跨列不變式 constraint trigger)。
--
-- 版本號 `20260815040000` 由主視窗 2026-08-15 核發(兩人各自跑過「五棵樹最大號 + 信箱佔位掃描」)。
-- plan = `docs/specs/2026-08-15-e10-13-slice1-edit-amount-plan.md`
-- 🔴 **plan 的狀態是「審查預算用完」不是「通過」**:codex R1 FAIL 6 條、R2 FAIL 5 條,兩輪都抓到真東西;
--    不跑 R3 的理由是「再審散文的邊際低於審 code」——**配置決定,不是品質宣稱**。
--
-- ══ §0 🔴🔴 本片讓一個寫在 DDL 裡的前提失效 —— 這是第一段,不是風險章節 ═══════════
-- `20260604120000_m3_s2a_orders_order_items.sql:172-174` 逐字:
--   「跨表不變式 orders.subtotal = Σ(order_items.line_total) 為 DB CHECK 無法表達(跨 row);
--    由 create_order RPC **單一寫入者**保證…**不加 deferrable trigger**(RPC 權威已足、避免複雜度)。」
--
-- **那個「已足」是帶前提的結論,前提 = 只有一個寫入者。**
-- 前提現在成立(實查):`grep line_total × UPDATE/INSERT` 命中 4 行全在 `20260716130000`,
-- 而那 4 行都是**明文排除**的措辭(「絕不含 quantity/unit_price/line_total」)+ 交易模擬斷言「byte 不變」;
-- 取消線 `20260805100000` 掃金額欄**零非註解命中**(取消走 `cancelled_quantity` 那一軸)。
-- ⇒ **`create_order` 是金額欄有史以來唯一的寫入者,而本檔加入第二個。**
--
-- 🔴 **前提消失,而條文字面一個字沒變、DB 也不會有任何反應**:
--    兩條列內 CHECK 照樣過(它們只看同一列):
--      `20260604120000:149` order_items_line_balances CHECK (line_total = unit_price * quantity)
--      `20260604120000:112` orders_total_balances     CHECK (total = subtotal + shipping_fee - discount_total)
--    **而 `orders.subtotal` 與 `Σ(order_items.line_total)` 可以差任意金額,不會有任何東西叫。**
-- ⇒ 本檔第二段(constraint trigger)就是為了那件事。
--
-- ══ §1 constraint trigger:定位是**縱深防禦**,不是「唯一讓它變成保證的東西」════════
-- ⚠️ **我原本寫「人數變多不會讓約定變成保證」—— 那句太強,codex R1 #4 打掉,而它的反例在本 repo 成立**:
--    `20260611120000:239` `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.orders FROM service_role;`
--    ⇒ **service_role 根本改不了 `orders`,寫入只能經 owner 的 SECDEF RPC**
--    ⇒ 「兩支 RPC」不等於「兩個能亂寫的人」,它們仍在同一道權限閘後面。
-- ⇒ **正確講法**:第一層(RPC 內重算)保證「**所有已知寫入路徑**都會算對」;
--    它不保證「**未來新增的**寫入路徑也會算對」—— 而 `#13` 後面還有片2(改品項)、片3(改數量)。
--    **⇒ trigger 的價值不是取代第一層,是讓【下一個寫入者】不必記得。**
--
-- 🔴 **監看三欄,而第三欄是 codex R2 #1 抓到的、三個人都漏了的**:
--    · `orders.subtotal`            等式左邊
--    · `order_items.line_total`     等式右邊
--    · `order_items.order_id`       🔴 **決定「Σ 要加哪些列」——它本來就在等式裡,而我把等式讀成「兩個數字」
--                                      而沒讀成「一個【分組】加總」。**
--    ⚠️ 改掛會讓**兩張單**同時失衡 ⇒ `OLD.order_id` 與 `NEW.order_id` **各檢查一次**。
--    ✅ 可達性:今天零路徑(`grep UPDATE public.order_items … SET order_id` = 0,app 層也 0),
--       **但 memory `project_0812-sean-order-ui-workflow-and-undo-needs:27` 逐字**
--       「這批貨其實該給另一張單 ⇒ **跨訂單調撥**的需求雛形(尚未成題、待 Sean 拍)」
--       ⇒ **不是假想災難,是已經被要求、還沒排期的功能。**
--
-- ⚠️ **不監看 `total` / `discount_total` / `shipping_fee`**:它們**不在那條跨列等式裡**,
--    而且由 `orders_total_balances` 這條**列內 CHECK 即時**守著。多守不是免費的(多一條誤報判斷路徑)。
--    🔴 **反駁條款(主視窗要求保留原樣)**:**若有人舉得出「改 `discount_total` 會讓跨列等式失效」的路徑,
--       這個縮法就錯了。我認錯只證明我舉不出來,不證明不存在。**
--
-- 🔴 **`FOR EACH ROW` 是語法約束、不是取捨**(關卡1 R2 #3):
--    · `CREATE CONSTRAINT TRIGGER` 語法**只支援 `FOR EACH ROW`** ⇒ transition table 那案**不可用**
--      (要 transition table 就得放棄 `DEFERRABLE`,而 DEFERRED 是本方案的必要條件)。
--    · 「**跨 statement 的**交易內已檢查標記」有漏檢風險(標記後同交易再改同一單 ⇒ 可能被跳過)
--      ⇒ **它把「多算幾次」的成本問題換成「可能漏檢」的正確性問題。那個交換不划算。**
--
-- ⚠️ **本段原本寫「且【不去重】」—— 那句已經不對了,關卡2 之後改成【同一個 row-event 內去重】。**
--    留這行是因為兩者長得像而性質相反,**下一個讀的人最可能在這裡誤讀**:
--    · ❌ 否決的那案 = **跨 statement 記憶**(標記某單「這交易已驗過」)⇒ 之後再改同一單會被跳過 ⇒ **漏檢**。
--    · ✅ 採用的這案 = **同一個 row-event 內**把 `v_old` 與 `v_new` 當場比一次;
--      跨單調撥時兩者不等 ⇒ **兩張單照樣各檢查一次,零漏檢**。
--    效果:RPC 一次改單原本對同一張單做 4 次相同 `sum`(items trigger 2 次 + orders trigger 2 次),現在 2 次。
--    · 成本:走 `order_items_order_idx`(`20260604120000:179`)撈該單十幾列做 `sum`;
--      **本片一次只改一列 ⇒ N=1**。批次那片再評估,**而那時要重估的是它不是本片**。
--      ⚠️ 我原文寫「主鍵索引」是錯的 —— `order_id` **不是**主鍵,主鍵是 `id`。
--
-- 🔴 **`DEFERRABLE INITIALLY DEFERRED` 是【本方案】的必要條件,不是【這個問題】的必要解**(codex R1 #1)。
--    三案並列:①RPC 結尾自驗(=第一層,對未來 writer 零覆蓋)②trigger 代算(兩邊都在算、且錯誤被靜默修正、不會紅)
--    ③**本案:只檢查不代算,在 COMMIT 那一刻判定** ⇒ 允許交易中途不一致(改 item 與改 order 之間必然有一瞬)。
--
-- ══ §2 金額閘:**不用任何金額口徑**(codex R2 #5 換掉了原設計)══════════════════════
-- 原設計是「已收 > 改後應收 ⇒ 擋」,而它依賴 `#16` 的直接 SUM 口徑 —— **那個口徑我自己標過「未重新驗證」。**
-- 🔴 **而方向我原本想反了**:`#16` 的 SUM **不扣退款 ⇒ 高估已收 ⇒「已收 > 應收」過度成立 ⇒ 錯擋正當調價**。
-- ⇒ **新設計:`order_payments` 有【任何一列】就拒絕改金額。**
--    ✅ **「有沒有收款列」是存在性檢查,不是金額語意** —— 不需要知道沖銷怎麼算、退款算不算、淨額多少。
--    ⚠️ 比原案嚴格(收過款但改金額其實無害的單也被擋)。**選這個方向的理由**:
--       **過度限制會被員工回報(他會來問為什麼不能改);錯擋與漏擋之間,漏擋不會有人回報。**
--       ⇒ 那是「**哪一種錯誤有回饋迴路**」的判斷,不是「哪一種比較嚴重」。
--    🔴 放寬的觸發條件(plan §6a L5)= **退款/沖銷的「淨已收」口徑定案**(Sean 已拍「今日退款做正確版」,RPC 未做)。
--
-- ══ §3 零元防呆:RPC 這層守的是 **API 契約**,不是員工手滑 ═══════════════════════════
-- 🔴 codex R2 #2 + 主視窗:**這道判斷發生在 RPC,而 RPC 的呼叫者是我們自己的 app**
--    ⇒ **前端可以遇到 0 就自動填「贈品」⇒ 意圖退化回注意力,而且連手滑的痕跡都被抹掉。**
-- ⇒ **本層只保證 API 契約**:`0` 必帶原因、`>0` 不得帶原因(後者防它退化成恆填樣板)。
--    **員工手滑要在 UI 層擋(二次確認 + 源碼契約測試釘住原因欄不得預填常數)—— 那是片 1c 的事。**
-- ⚠️ 兩層各守各的;**本檔不宣稱守住了 UI 那層的事。**
--
-- ══ §4 誠實邊界 ═════════════════════════════════════════════════════════════════
-- ⚠️ **本段原本寫「✅ 已在丟棄式 PG 實跑」—— 那句是在跑之前寫的,寫下當時是假的。**
--    現在改成實際跑出來的數字。留這行是因為「宣稱先於事實」正是本片要防的病。
--
-- ✅ **2026-08-15 丟棄式 PG 17.10 叢集實跑**(vanilla PG + `scripts/d1-supabase-shim.sql`,
--    172 支既有 migration 全套用後才套本片;每格用 `CREATE DATABASE … TEMPLATE` 從同一基準複製)。
--    量法可重跑:`WIDE=1 bash scripts/e13-slice1a-verify.sh`。
--      · 步驟 0 環境健檢(**不套本片**)= 失衡 UPDATE **靜靜 commit 成功**(subtotal 1000 vs Σlines 2)
--        ⇒ 病確實存在、格有判別力。(⚠️ 本行原本寫「1200 vs 2」—— 那是手跑時多做一格的殘值,
--          落成腳本後由腳本自己抓到。可重跑的證據會修正不可重跑的記憶。)
--        🔴 **這一格只證【跨列不變式】那一件事**,不是整套功能的負向對照(codex 關卡2)。
--      · 套用本片後 **31 格全綠**(正向 7 / RPC 閘 10 / 跨列不變式 8 / **既有生產路徑 3** / 結構複驗 3)
--        🔴 **「既有生產路徑」那三格是關卡2 之後補的,而它補的是一個【零覆蓋】**:
--           本片的 items trigger `AFTER INSERT` **沒有欄位清單**
--           ⇒ **`create_order` 每建一張新單都會觸發它** ⇒ 客人結帳那條路穿過這道新守門,
--           而原本 28 格**全是手寫 INSERT、一次都沒跑過 `create_order`**。
--           ⚠️ 後果等級差很多:新功能被擋可以等(沒人在用);**結帳被擋 = 客人下不了單。**
--           · CO1  真的呼叫 `create_order` ⇒ 建單成功
--           · CO1b 建單後 `subtotal(1000) = Σ line_total(1000)`,而 `total(1100)` 另含運費 100
--             🔴 **守門釘的是【小計】不是【總額】** —— 有運費的單 total 本來就比 subtotal 多,那不是壞掉。
--           · CO2  把 `create_order` 的小計累加改成 `+1` ⇒ **建單當場被本片守門擋下**
--             (證明 CO1 紅得起來;沒有這一發,「跑了而且過了」與「跑了一個不可能失敗的東西」長得一樣)
--        🔴 **限度**:harness 是 `superuser=postgres` 且**覆寫了 `auth.uid()`**
--           ⇒ **那三格證的是【邏輯】,不是權限、不是 RLS、不是真實 auth 流程。**
--      · **突變 8 發,每發都由腳本【逐格機器判定】**(hold = 全部格 − flip − 已宣告連鎖,窮舉不手列)(flip 必須轉紅 / hold 必須維持綠,兩者任一不符即失敗):
--          M1 `NOT DEFERRABLE`(檔尾閘 ⑥ 原樣)  ⇒ apply 失敗且訊息含 `pcm_e13_triggers_deferred`
--          M2 M1 + 拿掉閘 ⑥ 的 DEFERRABLE 斷言   ⇒ flip 正向那格 + S1;hold 兩個負測(= 沒打錯地方)
--          M3 拿掉 OLD 那側                       ⇒ flip N1/N2/N4;hold N3(跨單走 NEW 那側,仍活)
--          M4 監看欄漏掉 `order_id`               ⇒ flip 跨單調撥;其餘五格 hold
--          M5 檔尾閘 ④ 拿掉兩個 `::text`          ⇒ apply 失敗且訊息含 `operator is not unique`
--          M6 items 分支讀錯欄(`OLD.id`)         ⇒ flip 跨單調撥 + 刪品項
--          M7 `IF` 的表名打錯 ⇒ 落到 `ELSE`       ⇒ flip 正向那格 + N2(證 fail-closed 是活的)
--          M8 拿掉 NEW 那側                       ⇒ flip 新增品項那格 + **CO2**(去重後只有 INSERT 靠它,
--                                                    而 `create_order` 建單走的就是 INSERT ——
--                                                    **這條是窮舉 hold 當場抓出來的,不是我事先想到的**)
--        🔴 **M5-M8 是 codex 關卡2 要求補的** —— 在那之前,檔尾閘 ④ 的修法、取值方式本身、
--           `ELSE` fail-closed、NEW 半邊,**四者都零突變覆蓋**(只有 baseline 綠,沒有「抓得回來」的證明)。
--      · 🔴 **「機器判定」本身有判別力的證據**:同一支腳本在修好裁判後的第一輪,
--        **當場讓 M1 與 M3 判定失敗、整體 exit=1**(M1 是 psql 沒開 verbose 比不到約束名;
--        M3 是**我的期望值寫錯**)。⇒ 它不是恆綠的裝飾。
--      · 突變還原一律 `cp` 基準檔 + sha256 逐字比對(**本檔 untracked ⇒ `git checkout` 是 no-op**),
--        還原後複跑 = 28 綠、與突變前數字相同。
--      · `scripts/20260815040000-down.sql` 實跑 exit 0、殘留 0 函式 0 trigger、**二次跑仍 exit 0**;
--        退後同一格失衡又寫得進去(800 vs 14)= 功能真的不在了,不是「看起來退了」;
--        且**不帶 `pcm_app_layer_retracted=1` 時那道硬 checkpoint 會擋下**(物件 3/2 全留)= 閘不是裝飾。
--
-- ⚠️ **哪些東西只有 baseline 覆蓋、沒有突變覆蓋**(明寫免得被讀成「八發都驗過」):
--    RPC 的參數閘 / 付款閘 / 折扣閘 / 溢位 / 重算 / 稽核 / ACL / **結構閘 ①②③⑤** —— 不在八發範圍。
--    它們各自有 baseline 格(G1-G9、P1c、S2、S3),**但沒有「改壞了會不會被抓到」的證明**。
--    ⚠️ 本行原本寫「結構閘 ①-⑤」,**而那是錯的:閘 ④ 有 M5、閘 ⑥ 有 M1**(codex 關卡2 R2 nit 13)。
--    🔴 **一句宣稱自己涵蓋範圍的話,自己也要對** —— 寫「①-⑤」比寫「①②③⑤」省力,而它把 M5 講不見了。
--    分母(採 codex 的算法):可獨立改壞的行為群 19 個,**具突變覆蓋 8、零突變覆蓋 11**。
--
-- 🔴🔴 **那次實跑抓到兩個結構閘與兩輪 codex 散文審查都看不到的真缺陷,兩個都會讓本片在正式庫當場失敗:**
--    ① 檔尾閘 ④ 自己是壞的:`|| p.provolatile` 沒轉型 ⇒ `operator is not unique: text || "char"`,**apply 直接炸**。
--    ② trigger 函式用 `CASE … THEN OLD.id ELSE OLD.order_id END` ⇒ plpgsql 會把**運算式裡所有** record
--       欄位一起解析(不是只解析走得到的分支)⇒ 掛在 `orders` 上那支一觸發就 `record "old" has no field "order_id"`,
--       而 `orders.subtotal` 是 RPC 每次都改的欄 ⇒ **整個功能一次都跑不起來。**
--    ⇒ 兩者都屬「跑起來才發生」,而結構閘只驗物件長什麼樣、`.sql` 對三綠恆綠 ⇒ **沒有實跑就沒有任何東西會攔。**
--
-- 🔴🔴 **而②的第一版修法(`to_jsonb(OLD) ->> 動態欄位名`)又被 codex 關卡2 判 must-fix —— 這條要一起記:**
--    那個修法把「會炸」換成了「**缺 key 回 NULL ⇒ assert 靜默 RETURN ⇒ fail-open**」,**而後者更糟**。
--    ✅ 正解是 repo 早就有的 `IF/ELSIF` 形狀,**兩支前例,而它們狀態不同**:
--       · `20260730140000:157-164` `pcm_assert_cancellation_has_items` —— **活的**(全樹無 DROP)。
--       · `20260725130100:202-210` `pcm_assert_refund_ledger_consistent` —— **歷史的**:
--         `20260801120000:162` 已 `DROP FUNCTION`(不是形狀有問題,是它守的不變式整條消失
--         —— 退款帳本從記品項改成記金額)。**要照抄請照第一支;第二支線上查無。**
--    🔴 **⇒ 這條不是「想不到」,是「沒去找前例」** —— 而我同一天稍早才做過反向的事
--       (寫 `scripts/20260815040000-down.sql` 時有去找 `scripts/20260815030000-down.sql` 當命名前例)。
--       **同一個動作,同一天,一次做了一次沒做。**
--
-- 🔴 **仍不證(不要讀成已驗)**:
--    · 正式庫的 owner / 既有 ACL / 149k 量級既有資料下也過 —— 本機是 superuser=postgres 的乾淨叢集。
--    · 效能:`sum` 走 `order_items_order_idx`,本機 N=1 的十幾列;正式庫大單未量。
--    · 併發:兩個 session 同時改同一單未測(`FOR NO KEY UPDATE` 的行為只有推理、沒有實測)。
--    · 本機 PG 非 Supabase(`pg_cron` / `vault` 兩支 migration 在 rehearsal 被跳過)。
-- ⚠️ 檔尾各閘只在 **apply 當下**跑;事後才被改動的情況它看不到。
-- 🔴 **apply 前置(硬)**:`having o.subtotal <> sum(i.line_total)` 必須零列。
--    2026-08-15 主視窗實跑 = 零列,**但 apply 當天要重跑 —— 不能拿那天的結果當這天的證據。**
--
-- ══ 為什麼本檔【沒有】顯式 BEGIN/COMMIT ═══════════════════════════════════════
-- 🔴 **本檔無顯式 `BEGIN;`/`COMMIT;`。依據 = 實況,不是拍板字面。**
--    · 最近前例 `20260815010000`(`#16`,同一個作者、同一週)**同樣沒有,而它已經 apply 上線**
--      (`supabase/APPLIED.tsv` 最近三列實查:`…010000` BEGIN=0 / `…020000` BEGIN=1 / `…030000` BEGIN=1
--       ⇒ **同一條 `supabase db push` 路徑,兩種寫法都成功過**)。
--    · **失敗保護不靠顯式 BEGIN**:檔尾六道 `DO $gate$` 任何一道 `RAISE` 就整片回滾。
--
-- ⚠️ **而 2026-07-29 Sean 拍板 `D0-1=A` 字面要求「全 repo migration 一律顯式 BEGIN/COMMIT」**
--    (逐字見 `docs/specs/2026-08-01-e10-a5b-supplier-canonical-key-plan.md:86`)。
--    **實測分母:全 repo 有顯式 `BEGIN;` 的 = 86 / 175 支;最近 10 支 6 有 4 沒有。**
--    ⇒ **拍板字面與實際做法長期不一致。本檔照【實際做法】,不照【拍板字面】。**
--
-- 🔴🔴 **而那個不一致本身是一道待解的題,不是本片能解的** ——
--    它影響 175 支檔,而本片只是其中一支。主視窗 2026-08-15 裁定:
--    **單獨開 backlog 送 Sean(拍板還算不算數 / 還是實際做法才是現行事實),不綁在本片。**
--    ⇒ **下一個人不用重新發現這個矛盾,也不要拿本檔當「可以不加」的判例** ——
--      本檔只是在矛盾沒解之前,選了那個【已經被實測過的】那一邊。
--
-- ══ rollback ═══════════════════════════════════════════════════════════════════
-- `scripts/20260815040000-down.sql`(**同片交出,不是下一片**)。
-- 🔴 **先退應用層再跑 down** —— 呼叫端一旦改走 `.rpc(...)`,先 DROP 會讓改金額變 42883。
--    本片交件時應用層尚未接線(片 1b/1c 才接)⇒ **此刻 down 可單獨跑,零應用層依賴。**

-- ── 1. 跨列不變式的檢查函式(給 constraint trigger 用)────────────────────────────
CREATE FUNCTION public.pcm_e13_assert_order_subtotal_matches(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_subtotal  integer;
  v_sum_lines bigint;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;  -- 沒有單可查(例如 OLD/NEW 其中一邊不存在)⇒ 不是違規
  END IF;

  SELECT o.subtotal INTO v_subtotal
    FROM public.orders o WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RETURN;  -- 🔴 單已被刪(ON DELETE CASCADE 會把 items 一起帶走)⇒ 不變式對不存在的單無意義
  END IF;

  SELECT COALESCE(SUM(i.line_total), 0) INTO v_sum_lines
    FROM public.order_items i WHERE i.order_id = p_order_id;

  IF v_subtotal <> v_sum_lines THEN
    RAISE EXCEPTION
      '#13 跨列不變式違反:orders.subtotal(%) <> Σ order_items.line_total(%) — order_id=%',
      v_subtotal, v_sum_lines, p_order_id
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_subtotal_matches_lines';
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public.pcm_e13_assert_order_subtotal_matches(uuid) IS
  'M-4b E10 #13 片1a:跨列不變式 orders.subtotal = Σ(order_items.line_total) 的檢查點。'
  '🔴 存在理由:該不變式 DB CHECK 表達不了(跨 row),而 20260604120000:172-174 原本靠「create_order 單一寫入者」保證;'
  '#13 加入第二個寫入者 ⇒ 那個前提消失。本函式是縱深防禦,讓【下一個寫入者】不必記得。'
  '🔴 p_order_id 為 NULL 或該單已不存在 ⇒ 直接 RETURN(不是違規):前者發生在 OLD/NEW 其中一邊不存在時,'
  '後者發生在整單被刪(ON DELETE CASCADE 連 items 一起帶走)—— 對不存在的單談不變式沒有意義。';

-- ── 2. trigger 函式:對 OLD 與 NEW 兩邊的 order_id 各檢查一次 ────────────────────
CREATE FUNCTION public.pcm_e13_subtotal_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_old uuid;
  v_new uuid;
BEGIN
  -- ══ 為什麼是 `IF/ELSIF` 各分支獨立指派,不是一條運算式 ═══════════════════════════
  -- 🔴🔴 **不能寫 `CASE WHEN TG_TABLE_NAME='orders' THEN OLD.id ELSE OLD.order_id END`**:
  --    plpgsql 準備**一條**運算式時會把裡面**所有** record 欄位一起解析,不是只解析會走到的分支
  --    ⇒ 掛在 `orders` 上的那支一觸發就炸 `record "old" has no field "order_id"`,
  --      而 `orders.subtotal` 正是 RPC 每次都會改的欄 ⇒ **整個功能一次都跑不起來。**
  --    (2026-08-15 丟棄式 PG 實跑抓到;檔尾六道結構閘全過、三綠恆綠、兩輪 codex 散文審查都沒看到。)
  --
  -- ⚠️ **我第一次的修法是 `to_jsonb(OLD) ->> 動態欄位名`,而那個修法被 codex 關卡2 判 must-fix:**
  --    · **缺 key 會回 NULL ⇒ 被 assert 靜默 `RETURN` ⇒ fail-open。**
  --      欄位名打錯、或未來多掛一張表,**不會炸、不會紅、什麼都不會發生。**
  --    · 每次 UPDATE 序列化整列、取 text 再轉 uuid,成本也比較高。
  --    🔴 **⇒ 那是把「會炸」換成「靜默通過」,而後者更糟。**
  --
  -- ✅ **repo 裡本來就有兩支同款前例,兩次都用 `IF/ELSIF` 解掉,而我沒去找**:
  --      `20260730140000:157-164` `pcm_assert_cancellation_has_items`(order_cancellations + …_items)
  --        ✅ **活的** —— 全樹無 DROP。要照抄請照這一支。
  --      `20260725130100:202-210` `pcm_assert_refund_ledger_consistent`(order_refunds + order_refund_items)
  --        🔴 **歷史的** —— `20260801120000:162` 已 `DROP FUNCTION`(退款帳本從記品項改成記金額,
  --           那條不變式整條消失)。**形狀仍可讀,但線上查無 —— 別拿它去對線上。**
  --      ⚠️ **這兩支我原本寫成同一種狀態**(E 查線上 `pg_trigger` 才發現)。
  --         **`supabase/migrations/` 是【歷史】不是【現況】** —— 檔在,不代表那個物件還在。
  --    ⇒ **本函式改抄它們的形狀,不發明第三種。** 欄位名回到**編譯期**檢查:打錯 = 那個分支一執行就炸。
  IF TG_TABLE_NAME = 'orders' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := OLD.id;       END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := NEW.id;       END IF;
  ELSIF TG_TABLE_NAME = 'order_items' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN v_old := OLD.order_id; END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN v_new := NEW.order_id; END IF;
  ELSE
    -- 🔴 fail-closed:掛到沒登記的表 ⇒ **停下來**,不是靜默放行。
    --    這道是上面那條 fail-open 教訓的直接對策 —— 未知情況要出聲,不要回 NULL。
    RAISE EXCEPTION
      '#13 subtotal guard 被掛到未登記的表(%);本函式只認 orders / order_items', TG_TABLE_NAME
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_guard_unknown_table';
  END IF;

  -- 🔴 兩邊都要檢查:品項改掛另一張單 ⇒ 舊單少一列、新單多一列 ⇒ 兩張同時失衡。
  --    (codex 關卡1 R2 #1;三個人都只在「哪些欄」這個維度找,漏了「列的歸屬被改了」。)
  IF v_old IS NOT NULL THEN
    PERFORM public.pcm_e13_assert_order_subtotal_matches(v_old);
  END IF;

  -- 🔴 **單一 row-event 內去重**(codex 關卡2):`order_id` 沒變時第二次 SUM 是同一張單、同一個答案。
  --    ⚠️ **這與檔頭否決的「交易內已檢查標記」不同,不要混為一談**:
  --      那個是**跨 statement** 記憶體 ⇒ 標記後同交易再改同一單可能被跳過 ⇒ 漏檢(正確性問題)。
  --      這個是**同一個 row-event 內**,兩個值當場比對 ⇒ 跨單調撥時 v_new ≠ v_old,兩張單照樣各檢查一次。
  --    效果:RPC 一次改單原本會對同一張單做 4 次相同 SUM(items 2 次 + orders 2 次),現在 2 次。
  IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
    PERFORM public.pcm_e13_assert_order_subtotal_matches(v_new);
  END IF;

  RETURN NULL;  -- AFTER trigger 的回傳值被忽略
END;
$fn$;

COMMENT ON FUNCTION public.pcm_e13_subtotal_guard() IS
  'M-4b E10 #13 片1a 的 constraint trigger 函式。🔴 對 OLD 與 NEW 的 order_id 各檢查一次 —— '
  '品項改掛另一張訂單時 line_total 一個字沒變,而舊單新單同時失衡(關卡1 R2 #1 抓到;'
  '該情境今天零路徑,但 Sean 2026-08-12 講過「這批貨其實該給另一張單」的跨訂單調撥需求)。'
  '🔴 寫法必須是 IF/ELSIF 各分支獨立指派,不得寫成一條 CASE 運算式 —— plpgsql 準備一條運算式時會解析'
  '裡面所有 record 欄位、不是只解析走得到的分支 ⇒ 掛在 orders 上那支一觸發就炸(2026-08-15 實跑抓到)。'
  '形狀抄 20260730140000:157-164(活的)與 20260725130100:202-210(歷史的;20260801120000:162 已 DROP)'
  '兩支前例;ELSE 對未知表 fail-closed。'
  '🔴 去重只在【同一個 row-event 內】(v_new 與 v_old 相同才跳過第二次),'
  '**不是**檔頭否決的「跨 statement 的交易內已檢查標記」—— 後者會漏檢,前者不會:'
  '跨單調撥時 v_new <> v_old,兩張單照樣各檢查一次。'
  '🔴 FOR EACH ROW 是語法約束不是選擇:CREATE CONSTRAINT TRIGGER 只支援 FOR EACH ROW ⇒ transition table 不可用。';

-- ── 3. 掛 trigger:三欄的兩張表 ──────────────────────────────────────────────────
-- 🔴 DEFERRABLE INITIALLY DEFERRED:一次改單中途必然有短暫不一致(先改 item 再改 order),
--    立即檢查會誤報。⚠️ 但這是【本方案】的必要條件,不是【這個問題】的必要解(見檔頭 §1)。
CREATE CONSTRAINT TRIGGER pcm_e13_items_subtotal_guard
  AFTER INSERT OR DELETE OR UPDATE OF line_total, order_id ON public.order_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.pcm_e13_subtotal_guard();

CREATE CONSTRAINT TRIGGER pcm_e13_orders_subtotal_guard
  AFTER UPDATE OF subtotal ON public.orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.pcm_e13_subtotal_guard();

-- ── 4. 改金額 RPC ───────────────────────────────────────────────────────────────
CREATE FUNCTION public.admin_update_order_item_amount(
  p_order_id          uuid,
  p_order_item_id     uuid,
  p_unit_price        integer,
  p_expected_version  integer,
  p_actor             text,
  p_request_id        text,
  p_zero_price_reason text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_ord        public.orders%ROWTYPE;
  v_item       public.order_items%ROWTYPE;
  v_line_total bigint;
  v_subtotal   bigint;
  v_total      bigint;
  v_payments   integer;
  v_rows       integer;
BEGIN
  -- 4a. server 供參數 fail-closed(形狀抄 20260714130000:84-96)。
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 缺 request_id';
  END IF;
  IF p_order_id IS NULL OR p_order_item_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 缺 order_id / order_item_id / expected_version';
  END IF;
  IF p_expected_version < 1 OR p_expected_version > 2147483646 THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: expected_version 越界';
  END IF;
  IF p_unit_price IS NULL OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: unit_price 必須是非負整數';
  END IF;

  -- 4b. 🔴 零元防呆(本層只保證 API 契約,不保證員工沒手滑 —— 見檔頭 §3)。
  IF p_unit_price = 0 AND (p_zero_price_reason IS NULL OR pg_catalog.btrim(p_zero_price_reason) = '') THEN
    RAISE EXCEPTION '單價改為 0 需要填原因(例:贈品 / 換貨補寄)'
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_zero_price_needs_reason';
  END IF;
  -- 🔴 反向:>0 卻帶原因 ⇒ 拒。防它退化成「前端恆填一個樣板字」。
  IF p_unit_price > 0 AND p_zero_price_reason IS NOT NULL THEN
    RAISE EXCEPTION '單價不是 0 時不得帶「零元原因」(收到:%)', p_zero_price_reason
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_reason_only_for_zero';
  END IF;

  -- 4c. 鎖父列。🔴 FOR NO KEY UPDATE(不是 FOR UPDATE)——
  --     FOR UPDATE 與 order_items 的 FK RI 取的 KEY SHARE 會死結(40P01,2026-08-03 A2b1 實測)。
  SELECT * INTO v_ord FROM public.orders WHERE id = p_order_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 訂單不存在';
  END IF;
  IF v_ord.version <> p_expected_version THEN
    RETURN 'CONFLICT';
  END IF;

  -- 4d. 🔴 金額閘:這張單有【任何一列】收款 ⇒ 拒(見檔頭 §2;不使用任何金額口徑)。
  SELECT count(*) INTO v_payments FROM public.order_payments p WHERE p.order_id = p_order_id;
  IF v_payments > 0 THEN
    RAISE EXCEPTION
      '這張單已經有收款紀錄(% 筆),目前不開放改金額 —— 因為「已收多少」的算法還沒定案。需要調整請走退款流程,或告知系統維護。',
      v_payments
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_no_edit_after_payment';
  END IF;

  -- 4e. 🔴 折扣閘(plan §6a L2 的「會自己響」那半):本片未處理折扣單的改價。
  --     若 subtotal 被改小而 discount_total > subtotal + shipping_fee ⇒ total 算成負數 ⇒ 撞 CHECK (total >= 0),
  --     而員工會看到 23514 技術碼。⇒ 折扣一上線,第一張折扣單改價就會撞到這裡,訊息說得出為什麼。
  IF v_ord.discount_total <> 0 THEN
    RAISE EXCEPTION
      '這張單有折扣(%),而本功能尚未處理折扣單的改價(#13 片1 已知限制 L2)。請告知系統維護。',
      v_ord.discount_total
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_discount_not_supported';
  END IF;

  -- 4f. 取品項,並確認它屬於這張單(防跨單誤改)。
  SELECT * INTO v_item FROM public.order_items WHERE id = p_order_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 品項不存在';
  END IF;
  IF v_item.order_id <> p_order_id THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 品項不屬於這張訂單';
  END IF;

  -- 4g. no-op 拒(不 bump version、不寫稽核;形狀抄 20260714130000:196-203)。
  IF v_item.unit_price = p_unit_price THEN
    RETURN 'NOOP';
  END IF;

  -- 4h. 🔴 同交易改兩處:line_total 必須跟著 unit_price 走,否則撞 order_items_line_balances。
  --     ⚠️ 我們是【設計上】同時改,不是靠撞 CHECK 才發現 —— 驗收要有一格證明這件事。
  v_line_total := p_unit_price::bigint * v_item.quantity::bigint;
  IF v_line_total > 2147483647 THEN
    RAISE EXCEPTION '改後的 line_total(%)超出 integer 上限', v_line_total
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_line_total_overflow';
  END IF;

  UPDATE public.order_items
     SET unit_price = p_unit_price,
         line_total = v_line_total::integer
   WHERE id = p_order_item_id;

  -- 4i. 重算訂單層。subtotal = Σ line_total;total 依 orders_total_balances 的等式。
  SELECT COALESCE(SUM(i.line_total), 0) INTO v_subtotal
    FROM public.order_items i WHERE i.order_id = p_order_id;
  v_total := v_subtotal + v_ord.shipping_fee::bigint - v_ord.discount_total::bigint;
  IF v_total < 0 THEN
    RAISE EXCEPTION '改後的訂單總額會變成負數(%),本功能不處理', v_total
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_total_negative';
  END IF;
  IF v_subtotal > 2147483647 OR v_total > 2147483647 THEN
    RAISE EXCEPTION '改後的 subtotal/total 超出 integer 上限'
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_order_amount_overflow';
  END IF;

  UPDATE public.orders
     SET subtotal   = v_subtotal::integer,
         total      = v_total::integer,
         version    = v_ord.version + 1,
         updated_at = pg_catalog.now()
   WHERE id = p_order_id AND version = p_expected_version;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'admin_update_order_item_amount: 更新列數異常(%)', v_rows;
  END IF;

  -- 4j. 同交易寫稽核。🔴 逐欄列舉 —— 新增可編欄位時**必須**同時加在這裡,
  --     否則它不會進操作紀錄,而且不會有任何東西紅(#13 片0a §4 的 must)。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id, source_app)
  VALUES (
    p_actor,
    'order.item.amount.update',
    'order_item:' || p_order_item_id::text,
    pg_catalog.jsonb_build_object(
      'order_id',   p_order_id,
      'unit_price', v_item.unit_price,
      'line_total', v_item.line_total,
      'subtotal',   v_ord.subtotal,
      'total',      v_ord.total
    ),
    pg_catalog.jsonb_build_object(
      'order_id',          p_order_id,
      'unit_price',        p_unit_price,
      'line_total',        v_line_total::integer,
      'subtotal',          v_subtotal::integer,
      'total',             v_total::integer,
      'zero_price_reason', p_zero_price_reason
    ),
    p_request_id,
    'admin'
  );

  RETURN 'OK';
END;
$fn$;

COMMENT ON FUNCTION public.admin_update_order_item_amount(uuid, uuid, integer, integer, text, text, text) IS
  'M-4b E10 #13 片1:改逐品項單價。🔴 同交易改 order_items.unit_price + line_total,並重算 orders.subtotal/total。'
  '🔴 金額閘不使用任何金額口徑:order_payments 有任何一列即拒(存在性檢查)—— 因為「已收多少」的口徑未定案;'
  '放寬的觸發條件 = 退款/沖銷淨額口徑定案(plan §6a L5)。'
  '🔴 零元:0 必帶原因、>0 不得帶原因(後者防前端恆填樣板)。本層只保證 API 契約,員工手滑要在 UI 層擋。'
  '🔴 折扣單一律拒(L2):subtotal 改小可能讓 total 算成負數並撞 CHECK,員工會看到 23514。'
  '🔴 稽核 before/after 逐欄列舉 ⇒ 新增可編欄位必須同時加在那兩個 jsonb_build_object,否則靜默漏記。';

-- ── 5. ACL:逐個點名 REVOKE(PUBLIC 收不掉 anon;見 20260811090000:17-24 的 default_acl 實查)──
REVOKE ALL ON FUNCTION public.admin_update_order_item_amount(uuid, uuid, integer, integer, text, text, text)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION public.admin_update_order_item_amount(uuid, uuid, integer, integer, text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.pcm_e13_assert_order_subtotal_matches(uuid) FROM PUBLIC, anon, authenticated, authenticator, service_role;
REVOKE ALL ON FUNCTION public.pcm_e13_subtotal_guard() FROM PUBLIC, anon, authenticated, authenticator, service_role;

-- ── 6. 檔尾結構斷言(同交易;任一紅 = 整片回滾)────────────────────────────────────
-- 🔴🔴 **不得整組照抄 `#16`**:`#16` 是 LANGUAGE sql + STABLE,本片是 plpgsql + VOLATILE
--    ⇒ 照抄 `lanname='sql'` / `provolatile='s'` 會讓正確的實作驗收失敗(codex R1 #6)。
DO $gate$
DECLARE
  v_fn   oid := 'public.admin_update_order_item_amount(uuid, uuid, integer, integer, text, text, text)'::regprocedure;
  v_bad  text;
  v_n    integer;
BEGIN
  -- ① proacl 不得是 NULL(REVOKE 沒執行過時 proacl 是 NULL,而 aclexplode(NULL) 回零列
  --    ⇒ 下面 ② 會恆真通過。照抄 20260811090000:142-149 的理由)。
  IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) IS NULL THEN
    RAISE EXCEPTION '#13:proacl 是 NULL ⇒ REVOKE 沒執行過,函式預設 PUBLIC 可 EXECUTE'
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_proacl_null';
  END IF;

  -- ② EXECUTE 閉世界:只准 {owner, service_role},且不得帶 WITH GRANT OPTION。
  SELECT pg_catalog.string_agg(y.grantee, ', ' ORDER BY y.grantee) INTO v_bad
    FROM (
      SELECT CASE WHEN g.grantee = 0 THEN 'PUBLIC'
                  ELSE pg_catalog.pg_get_userbyid(g.grantee) END AS grantee
        FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) g
       WHERE p.oid = v_fn
         AND g.privilege_type = 'EXECUTE'
         AND (g.grantee = 0
              OR pg_catalog.pg_get_userbyid(g.grantee)
                 NOT IN ('service_role', pg_catalog.pg_get_userbyid(p.proowner))
              OR g.is_grantable)
    ) y;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#13 EXECUTE 閉世界被打破(%)', v_bad
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_acl_extra_grantee';
  END IF;

  -- ③ service_role 拿得到 EXECUTE(拿不到 = 呼叫端整條死路)。
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '#13:service_role 拿不到 EXECUTE ⇒ 呼叫端整條死路'
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_service_role_no_execute';
  END IF;

  -- ④ 函式屬性。🔴 本片是 plpgsql + VOLATILE,與 #16 相反 —— 這裡不得照抄它的斷言。
  -- 🔴 `provolatile` 是 `"char"`(不是 text)、`lanname` 是 `name` ⇒ `||` 兩個運算元都要顯式轉。
  --    不轉會炸 `operator is not unique: text || "char"`,而那是 **apply 當下**才發生的錯
  --    ⇒ 三綠恆綠、審查散文也看不出來。2026-08-15 丟棄式 PG 實跑抓到(這格原本會讓整片 apply 失敗)。
  SELECT p.prosecdef::text || '/' || l.lanname::text || '/' || p.provolatile::text
    INTO v_bad
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
   WHERE p.oid = v_fn;
  IF v_bad <> 'true/plpgsql/v' THEN
    RAISE EXCEPTION '#13 函式屬性不符,期望 true/plpgsql/v,實得 %', v_bad
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_function_shape';
  END IF;

  -- ⑤ search_path 逐字(SET search_path = '' 存成 search_path="")。
  SELECT pg_catalog.array_to_string(p.proconfig, ',') INTO v_bad
    FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
  IF v_bad IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION '#13 proconfig 是 [%],期望逐字 [search_path=""]', COALESCE(v_bad, '(NULL)')
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_search_path';
  END IF;

  -- ⑥ 🔴 兩支 constraint trigger 都在,而且都是 DEFERRABLE INITIALLY DEFERRED。
  --    (tgdeferrable / tginitdeferred 都要 true —— 只驗存在會讓「改成 NOT DEFERRABLE」靜默通過。)
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_trigger t
   WHERE t.tgname IN ('pcm_e13_items_subtotal_guard', 'pcm_e13_orders_subtotal_guard')
     AND t.tgdeferrable AND t.tginitdeferred AND NOT t.tgisinternal;
  IF v_n <> 2 THEN
    RAISE EXCEPTION '#13:期望兩支 DEFERRABLE INITIALLY DEFERRED 的 constraint trigger,實得 %', v_n
      USING ERRCODE = 'P2C13', CONSTRAINT = 'pcm_e13_triggers_deferred';
  END IF;

  -- 🔴 **成功時要出聲**(2026-08-15 主視窗問「他按下去會看到什麼」才發現的缺口):
  --    上面六道閘**只在失敗時 RAISE**,成功時**一個字都不印**
  --    ⇒ apply 成功與「根本沒跑到這一段」在畫面上**長得一模一樣**,而按按鈕的人看不懂 SQL。
  -- ⚠️ 這是本檔自己犯的「什麼都沒有被讀成檢查過了」—— 而 house 前例都會印
  --    (`20260813120000` 5 條 / `20260815020000` 2 條 RAISE NOTICE)。
  RAISE NOTICE '#13 片1a 後置斷言六道全過:proacl 非 NULL / EXECUTE 閉世界 / service_role 可 EXECUTE / 屬性=true-plpgsql-v / search_path="" / 兩支 constraint trigger 皆 DEFERRABLE INITIALLY DEFERRED';
  RAISE NOTICE '#13 片1a 已就緒:admin_update_order_item_amount + pcm_e13_items_subtotal_guard + pcm_e13_orders_subtotal_guard';
  RAISE NOTICE '#13 片1a ⚠️ 看到上面兩行 = apply 成功。沒看到 = 有問題,不要當成功。';
END;
$gate$;
