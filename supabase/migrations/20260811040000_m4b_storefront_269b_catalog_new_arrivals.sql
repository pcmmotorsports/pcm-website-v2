-- ============================================================
-- #269-b 段一：「新品」真篩選 + 「最新上架」真排序（DB 側）
-- ============================================================
-- 真權威 plan：mailbox `S-023-PLAN.md`（S 窗 2026-08-11 送批）。
-- 🔴 mailbox 在 repo 外、外人無法複驗 ⇒ **本檔頭 + `docs/phase-1-backlog.md` #269-b
--    才是留在 repo 裡的權威副本**，下面每個數字都附了取得方式，不必回頭找 mailbox。
-- Sean 2026-08-11 晨批：
--   Q15  = C  排除供應商批次（同一日進太多件 = 我們在搬目錄，不是「新品」），
--             門檻 **N = 500 起手、明文「N 可調、Sean 委任」**（拍板字面是「超過 N」，
--             本檔實作為「達到 N」＝ `>=`，邊界差一件；理由見下，已在回報中逐字告知）。
--             ⚠️ 本檔實際落 **N = 100**，理由見下方「N 為什麼不是 500」——這是委任範圍內的調整，
--                不是擅自改拍板；已在收工回報逐字告知。
--   Q15b = rolling 近 7 天（不是自然週；避免「週一早上新品頁空的」）。
-- 片型：高風險片（鐵則 12③ DB 結構）。鐵則 8 plan 已批。對抗審查 = codex R2（8 MF + 4 NIT，本檔已逐條處理）。
--
-- 本檔只動 DB（段一）。app 接線是段二，硬前置 =「apply 後用**真 PostgREST anon**
-- 量過這支 RPC」——#277 剛被 anon 的 3s 門打過一次，不接受「應該不會慢」。
--
-- ── 🔴 本檔自包交易（BEGIN … COMMIT），三個理由，缺一不可 ──
--   ① `SET LOCAL lock_timeout` **只有在交易塊內才生效**；不自包交易時 `supabase db push`
--      會吐 `WARNING 25P01` 而該行變 no-op ＝ 假保護（2026-07-18 apply 實測；
--      2026-08-06 正反面實測補正：決定因素是「檔案有沒有自包 BEGIN」，不是 db push 本身）。
--      沿用同 repo 已驗過的寫法：`20260803140000:132/707`、`20260805170000:31/453`。
--   ② DROP + CREATE 之間若不是同一交易，正式站會有一段「函式不存在」的空窗 ⇒ 型錄全頁掛掉。
--   ③ 檔尾的收尾斷言用 `RAISE EXCEPTION`；**沒有交易包住的話，前面的 DDL 已各自 commit、
--      RAISE 只會噴訊息而擋不住任何東西**（同族教訓：守門的效力取決於它會被怎麼跑）。
--   ⚠️ lock_timeout 保護的是「等鎖」那一段：`CREATE OR REPLACE VIEW` 要 ACCESS EXCLUSIVE，
--      被長查詢卡住時後面所有新請求都會排在它後面 ⇒ 寧可 5s 失敗重來，不要拖垮正式站。
--
-- 三動作：
--   1. products_list_public 末欄 append `created_at`（第 16 欄）。
--      ⚠️ 這推翻了該 view 原本 COMMENT 裡「excludes … timestamps」那句 —— COMMENT 同步改。
--      🔴 不是新的資料曝光面：`products_public`（detail 投影）**早就有 created_at**
--         （20260719150000:223）。created_at = 這一列進我們 DB 的時間，無 PII、無成本來源。
--      ✅ 已實查（非推測）：anon / authenticated 對 `products.created_at` **本來就有欄級 SELECT**
--         （`has_column_privilege` = true；同查 `price_by_tier` = false，經銷防護未動）
--         ⇒ security_invoker view 不會在 apply 後對客人回 permission denied。
--   2. search_catalog_by_vehicle **加第 11 個參數** `p_new_since timestamptz DEFAULT NULL`
--      + `p_sort = 'new'`（依 created_at DESC）。
--      🔴 加參數 ⇒ **不能用 CREATE OR REPLACE**：那會產生 overload，10 參數的既有呼叫
--         變成 42725 ambiguous。必須 DROP 舊簽章再 CREATE。
--      🔴 **DROP 刻意不帶 `IF EXISTS`**：帶了就是 fail-open —— 正式庫簽章若已漂移，
--         DROP 靜默不做事、CREATE 生出 overload、migration 照樣成功，
--         然後正式站每一次型錄呼叫都 42725。寧可在這裡整支 migration 失敗。
--         DROP 會連 grant 一起掉 ⇒ 下方重下 GRANT（不是冗餘），並由檔尾斷言釘住。
--      ✅ 新參數有預設值 ⇒ **現行 10 具名參數的呼叫端零改動照跑**
--         （apps/storefront/src/lib/products.ts:370、lib/vehicle-facet-counts.ts:197）。
--         這是段一可以先於段二上庫的理由（跨 apply 停點紀律）。
--   3. NOTIFY pgrst 'reload schema'（改了 view 欄位與函式簽章，缺此步 Data API 看不到新參數）。
--
-- ── 供應商批次排除怎麼算（Q15=C 的實作）──
--   在「新品視窗」內，先算每個**台灣日**進了幾件（客人看得到的那個宇宙：
--   products_list_public = RLS 濾掉下架 + INNER JOIN brands/categories），
--   **達到** N 的整天視為供應商目錄搬遷，那天的商品**整天不算新品**（`>=`，恰好 N 件也算）。
--
--   🔴 **N 為什麼不是 500，以及為什麼是 `>=` 不是 `>`**（codex R1 MF-5 起頭、R2 再修正）：
--      原本寫 `count(*) > 500` 的直接問題：匯入器 `scripts/rpm-load.ts:15` 是
--      `const BATCH_SIZE = 500;`，於是「剛好一批 500 列」永遠不會被判為批次日（500 > 500 為假）。
--      ⇒ 比較改成 `>=`，門檻也拉離 500 這個數字。
--
--      ⚠️ **我第二版在這裡寫過一個錯的證明，codex R2 抓掉了，留著當記錄**：
--      我寫「門檻嚴格小於 BATCH_SIZE ⇒ 第一批一 commit 就跨過門檻 ⇒ 不會有半個批次露出來」。
--      **不成立** —— `upsertBatched`（`scripts/rpm-load.ts:139-150`）的 500 是**每批送出的列數**，
--      不是**新建的列數**；那批 500 列若只有 99 筆是新商品，那天就只增加 99 列、不到門檻。
--      ⇒ 「N < BATCH_SIZE」推不出「不會露半批」，那個不變量與它的守門提議一併撤回。
--
--      🔴 **誠實的殘留風險（沒有修，因為日計數判準本身推不掉）**：供應商匯入進行中，
--      在該台灣日累計列數跨過 N 之前，已經寫進去的那些會**短暫出現在「新品」頁**，
--      跨過門檻後整天一起消失。N 越小、這個曝光窗越短（100 比 500 短五倍），但不是零。
--      要真正消掉它得換判準（例如爆量指紋、或匯入期間掛旗標），**那是要問 Sean 的題**，見下。
--
--   N = 100 的正當性（2026-08-11 實查 products **全歷史**，台灣日，**只數 visible**）：
--     🔴 母體必須是 visible（`delisted_at IS NULL`）——因為函式裡的批次日 CTE 讀的是
--        `products_list_public`，那是 security_invoker view、RLS 已經濾掉下架列。
--        拿「含下架的總列數」去談門檻就是在對另一個母體講話（我犯過，見下）。
--     全站有商品進來的日子共 **22 天**，分佈如下 ——
--       < 30 件   ：16 天（人工上架的日常；其中最大 = 2026-07-21 的 **18 件**）
--       30–185 件 ：**0 天**  ← 中間是完全空的
--       ≥ 186 件  ：6 天（6/03=186、7/19=648、6/01=916、7/05=1,392、7/24=6,188、7/11=9,579）
--   ⇒ 真正的空隙是 **18 → 186**，N=100 坐在這個空隙正中央。
--
--   🔴 **這個數字我前後錯了三次，錯法各不相同，留著當對照**：
--      ① N=500：「正常日最大 29」只掃了**近 60 天**卻寫成全域事實 ⇒ 時間軸作用域錯。
--      ② N=200：全歷史一撈冒出 2026-06-03 的 **186 件**（實查 = 2 個時戳、同一個 supplier(rpm)、
--         前後差 0.44 秒 = 機器批次無疑），200 會讓它整批漏進「新品」⇒ 門檻訂在證據之上。
--      ③ 「正常日天花板 29」：29 是**含下架**的計數，而判準只數 visible ⇒ **母體錯**，
--         正確的天花板是 **18**。同一個數字連續兩版都沒被質疑，因為我一直沒問「這是誰的計數」。
--      ⇒ 共同根：**引用一個統計之前要先答「這是哪個母體、哪段時間」**，兩個都答得出來才准當判準地基。
--
--   兩個條件同時滿足：100 > 正常日天花板 **18**（5.6 倍）；100 ≤ 最小批次日 **186**。
--   （原本還寫了第三個條件「100 < BATCH_SIZE 500」，那個推論已被 R2 推翻並撤回，見上。）
--
--   ⚠️ 判準的形狀是 Sean 拍的「**同一天進超過 N 件**」＝日計數。實測顯示更強的訊號其實是
--      「同一秒內湧入、同一個 supplier」（爆量指紋），但那是**換一種判準**、不是調 N
--      ⇒ 不在委任範圍內，沒有自行改。若日計數之後被證明不夠用，那是要回去問 Sean 的題。
--
--   🔴 下界對齊「p_new_since 所在台灣日的 00:00」，而不是 p_new_since 本身。
--      rolling 7 天的起點落在某天的半途；若只數窗內那半天，跨時段的批次日會數不到 N。
--      **這條有實測的判別力，不是防禦性註解**（2026-08-11 正式庫，突變對照）：
--        窗起點 = 2026-07-05 01:04:40.646478+00（落在該日 1,392 件批次的尾段內）
--          下界對齊台灣日 00:00（本檔作法）→ 該日整日 1,392 → 判為批次日 →  **0 件**存活
--          下界就用 p_new_since 本身（突變）→ 窗內只數到 99 < 100 → 不判批次 → **99 件**存活
--        ⇒ 拿掉這個 date_trunc，客人的「新品」頁會混進 99 件目錄搬遷品。
--      🔴 **這組數字是 N=100 專用的，重跑要連窗起點一起換**（codex R2 抓到的實錯）：
--         我第二版把 N 從 500 改成 100，卻沿用了舊 N 的突變證據（窗起點 7/11、167 件存活）。
--         **167 >= 100 ⇒ 在新門檻下突變版也會判成批次日、也回 0**，那組對照當場失去判別力。
--         改門檻＝突變證據作廢，要重找「窗內殘量 < N」的切點重量（查詢見 `scripts/269b-evidence.sql` §2b）。
--
--   用台灣日不用 UTC 日：UTC 換日在台灣時間 08:00，切在上班時段中間。
--      ⚠️ **誠實標註：這條在目前的 N 下不是 load-bearing。** 實測 7/11 那批用 UTC 日切開是
--         7,791 + 1,788，兩半都仍遠大於門檻、照樣被抓。選台灣日的理由是語意正確
--         （「同一天」對台灣員工＝台灣日）+ N 調大時才不會被切穿 + 避免 UTC 日的區間
--         橫跨兩個台灣日、誤殺隔天早上的真新品。
--
--   ⚠️ 已知且接受的副作用：批次日當天若有人手工上了幾件真新品，也會被一起排除。
--
--   🔴🔴 **這個機制的先天不穩定（codex R3 換角度後才浮出來，前兩輪逐行審 SQL 審不到）**：
--      批次日是**每次查詢當下即時算出來的**，而且數的是「**當下仍可見**的列數」
--      （`products_list_public` 已被 RLS 濾掉 `delisted_at` 非 NULL 的列）。三個直接後果：
--        ⓐ 某天累積到 99 件 → 全部當新品顯示；第 100 件一進來 → **那 99 件同時消失**。
--        ⓑ 接著有人把那天其中一件下架 → 剩 99 → **那 99 件又全部跑回來**。
--        ⓒ 客人看到的是「同一批商品在新品頁反覆翻面」，而且我們沒有任何地方會記錄它翻過。
--      ⇒ **這不是實作 bug，是「用讀取時的日計數去猜寫入意圖」這個形狀本身的性質。**
--         真正治本要在**寫入端記錄意圖**（例如 import run 標 `is_catalog_backfill`，
--         或商品加 `new_arrival_eligible_at`），RPC 只讀那個穩定欄位。
--      🔴 但那是**換一種判準**，不是調 N —— Sean 的 Q15=C 拍的是「同一天進超過 N 件」這個形狀
--         ⇒ **不在 S 窗委任範圍內,已整理成決策題回報,不自行改設計。**
--      ⚠️ 在 Sean 另行拍板之前，本檔就是照 Q15=C 的字面實作，上述不穩定性**明列為已知缺陷**，
--         不宣稱它不存在、也不自宣「可以接受」。
--
-- ── 效能（本檔落筆前實測，非推測）──
--   等價查詢形狀 EXPLAIN(ANALYZE) 於正式庫：**48.053 ms**（25 列命中、shared hit 8,874、零 read）。
--   兩趟 products seq scan（各 4,389 buffers）—— products.created_at **無索引**（實查 pg_indexes = 0 支）。
--   48ms vs anon 的 statement_timeout **3s**（🔴 是 3s 不是 8s，8s 是 authenticated/authenticator）
--   ⇒ 目前不加索引。索引留給「真 anon 量測若不過」時再開一支 migration。
--
--   p_new_since IS NULL（=所有一般型錄請求）時，`new_batch_days` 掛在
--   `p_new_since IS NULL OR (...)` 的右側，預期該 CTE 節點不被執行。
--   ⚠️ **這條目前只有間接證據，不得當成已驗**（codex R2 MF-3 指出，接受）：
--      我量的是**等價形狀**（PREPARE + force_generic_plan + EXPLAIN ANALYZE 傳 NULL），
--      兩種計畫形狀都逐字印 `(never executed)`；但那**不是這支函式本體**，
--      而且 SQL 本體也沒有「NULL 走獨立分支」那種結構性保證，只有執行期短路。
--      ⇒ 真憑據 = 下方閘的第 ① ④ 格（apply 後的真 anon 回歸量測）。沒量到之前，
--        本段落一律讀成「預期」而非「已驗」。
--
-- ── 🔴 段二解鎖閘（apply 後必跑，沒過就不接 app 層）──
--   用**真 PostgREST + publishable(anon) key** 打 /rest/v1/rpc/search_catalog_by_vehicle，
--   量 `-w "%{http_code} %{time_total}"`，五格全部 < 3s 且 HTTP 200：
--     ① 不帶 p_new_since、p_sort=recommend            ← 今天正式站的主要型錄路徑（回歸）
--     ② 不帶 p_new_since、p_sort=recommend、**帶 p_brand/p_model**
--        ← 🔴 codex R2 MF-4：**這格才是今天流量最大、也最可能被新 CTE 放大的路徑**。
--          `vehicle-facet-counts.ts:197` 一次請求會 fan-out **最多 108 次**這支 RPC
--          ⇒ 單次多 10ms 在這裡會被乘以 108。**這格沒量＝等於沒驗回歸。**
--     ③ 不帶 p_new_since、p_sort=new                  ← 全目錄 19,017 列依 created_at 排序（無索引）
--     ④ 帶 p_new_since=now()-7d                       ← 新品頁本身
--     ⑤ 帶 p_new_since + p_brand/p_model              ← 新品 × 車輛（麵包屑的 withVehicle 會產生）
--   ⚠️ 逾時的樣子是 HTTP 500 + `57014 canceling statement due to statement timeout`，不是慢而已。
--   不過 ⇒ 開一支索引 migration，不是把 app 層先接上去（跨 apply 停點紀律）。
--   🔴 **那支索引 migration 不能用 `CREATE INDEX CONCURRENTLY`**（codex R2 MF-6）：
--      本 repo 的 migration 以交易執行，CONCURRENTLY 在交易塊內會直接失敗
--      （`CREATE INDEX CONCURRENTLY cannot run inside a transaction block`）。
--      要嘛用普通 `CREATE INDEX`（products 會被短暫鎖住、19k 列可接受），
--      要嘛由 Sean 在交易外手動下 CONCURRENTLY —— 兩條路都要先講清楚再做。
--
-- ── ⚠️ 本片**沒有**修、但要知道的既有限制（codex R2 MF-7 / NIT-1；兩條都先於本片存在）──
--   ① `OFFSET` 分頁沒有跨請求快照：翻頁期間有新列進來（或某天跨過批次門檻），
--      後面幾頁會重複、漏列或整頁位移。`created_at DESC, id ASC` 只保證**單一快照內**穩定。
--      本片沒有引入它（recommend / price-* 一樣有），但 `new` 讓它更容易被看到
--      ⇒ 已立 **backlog #393**、不在本片改分頁機制（那是換 keyset 分頁的獨立片）。
--   ② `total` 只搭在回傳列上：OFFSET 超過最後一頁時回 0 列，呼叫端
--      （products.ts:386 `rows.length > 0 ? … : 0`）會把「其實還有商品」讀成總數 0。
--      同樣先於本片存在，同 **backlog #393**。
--
-- ── Rollback（forward-only；只在 incident response 用）──
--   🔴 **順序是硬的，反了就是自己製造事故**（codex R2 MF-8 / NIT-3）：
--     (0) **先確認 app 層沒有人還在傳 `p_new_since`。** 段二上線後才回捲的話，
--         必須**先把 app 退回不傳該參數的版本並部署完成**，再動 DB。
--         先砍 DB 的話，正式站每一次帶 p_new_since 的呼叫立刻失敗。
--     (1) 新開時戳 migration，同樣自包 BEGIN…COMMIT：
--         DROP 11 參數版 → 重貼 `20260719150000` 的 10 參數版本體 → 重下 GRANT → NOTIFY。
--         🔴 **不要在事故當下才寫這段 SQL**（codex R3）：可直接貼上執行的完整 rollback 本體
--            已預先備好在 `docs/reviews/2026-08-11-269b-rollback.sql`，複製成新時戳檔即可 push。
--     (2) view 要不要跟著退是**獨立決定**：`created_at` 是末欄 append，留著對任何人無害。
--         真要退：PG 不允許 CREATE OR REPLACE VIEW 減欄 ⇒ 必走 DROP VIEW + 重建。
--         🔴 而 RPC 的函式本體會參照這個 view ⇒ **必須先 (1) 把 RPC 換成不吃 created_at 的
--            10 參數版、再 DROP VIEW**。（前一版註解把這段寫成互相矛盾的順序，已更正。）
--     ⇒ 結論：view 那一欄**建議不要退**，退 RPC 就足以恢復行為。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';


-- ── 1. products_list_public 末欄 append created_at（第 16 欄）──
-- 基準 = 正式庫 pg_get_viewdef 實查（2026-08-11），前 15 欄逐字不動。
CREATE OR REPLACE VIEW public.products_list_public WITH (security_invoker = true) AS
SELECT
  p.id,
  p.title,
  p.subtitle,
  p.handle,
  p.brand_id,
  p.category_id,
  p.availability,
  p.fitments,
  p.price_general,
  p.supplier_slug,
  p.images ->> 0 AS card_image,
  COALESCE(
    NULLIF(
      concat_ws(' ', p.fitments -> 0 ->> 'motoBrand', p.fitments -> 0 ->> 'modelCode'),
      ''
    ),
    '通用款'
  ) AS fits,
  b.name AS brand_name,
  b.slug AS brand_slug,
  c.raw_path AS category_raw,
  p.created_at
FROM public.products p
JOIN public.brands b ON b.id = p.brand_id
JOIN public.categories c ON c.id = p.category_id;

GRANT SELECT ON public.products_list_public TO anon, authenticated;

COMMENT ON VIEW public.products_list_public IS
  'P4 list projection: card-only public fields + brand/category display keys + created_at (16 cols). security_invoker=true; excludes price_store, price_by_tier, metadata, detail content and delisted_at. created_at added 2026-08-11 (#269-b) for the new-arrivals filter/sort; it is the row insert time, already exposed by products_public.';


-- ── 2. RPC：DROP 舊 10 參數簽章 → CREATE 11 參數版 ──
-- 🔴 不帶 IF EXISTS：見檔頭。簽章漂移要在這裡整支失敗，不要靜默生出 overload。
-- 用 DO 包起來的唯一理由 = **把三種失敗講清楚**（codex R2：COMMIT 成功但 migration history
-- 那筆 INSERT 沒寫進去時，重跑會撞到「10 參數版已經不在了」而失敗，訊息卻完全看不出原因）。
DO $drop$
DECLARE
  v_old int;   -- 10 參數（本檔要換掉的）
  v_new int;   -- 11 參數（本檔要建的）
BEGIN
  SELECT count(*) FILTER (WHERE p.pronargs = 10),
         count(*) FILTER (WHERE p.pronargs = 11)
    INTO v_old, v_new
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle';

  IF v_old = 1 AND v_new = 0 THEN
    -- 正常路徑
    DROP FUNCTION public.search_catalog_by_vehicle(
      text, text, int, int, int, text, text, text[], int, int
    );
  ELSIF v_old = 0 AND v_new = 1 THEN
    RAISE EXCEPTION
      '#269-b:這支 migration 的 DDL **已經生效過了**(11 參數版在、10 參數版已不在),但你又跑了一次。'
      '最可能的原因=上次 COMMIT 成功、但 migration history 那筆沒登記(中途斷線)。'
      '不要改這個檔、也不要手動補 DDL ⇒ 正確動作是把它標記成已套用:'
      '`supabase migration repair --status applied 20260811040000`,然後重新 db push。';
  ELSE
    RAISE EXCEPTION
      '#269-b:public.search_catalog_by_vehicle 的簽章狀態不是預期的(10 參數 % 支、11 參數 % 支)。'
      '本檔預期「恰好一支 10 參數版、沒有 11 參數版」。停下來人工確認,不要硬套。', v_old, v_new;
  END IF;
END
$drop$;

CREATE FUNCTION public.search_catalog_by_vehicle(
  p_brand text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_year int DEFAULT NULL,
  p_offset int DEFAULT 0,
  p_limit int DEFAULT 25,
  p_sort text DEFAULT 'recommend',
  p_category text DEFAULT NULL,
  p_brand_slugs text[] DEFAULT NULL,
  p_price_min int DEFAULT NULL,
  p_price_max int DEFAULT NULL,
  p_new_since timestamptz DEFAULT NULL
)
RETURNS TABLE (item jsonb, total bigint)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  -- 供應商批次門檻 N（Sean 2026-08-11 Q15=C 定 500 起手、明文委任 S 窗可調 → 本檔落 100）。
  -- 判準是「單一台灣日新增**達到** N 件」（>=，不是 >）；正當性與殘留風險見檔頭。
  -- 🔴 改這個數字要開**新的 migration** 重貼整支函式 —— 本檔一旦 apply 就不該再編輯，
  --    改舊檔 `db push` 不會重跑、正式庫的門檻不會變(codex R3)。
  -- 🔴 而且改 N ＝ 檔頭那組突變證據作廢，必須用 `scripts/269b-evidence.sql` §2b 重找切點重量。
  -- 單一定義點：下面兩個分支都讀這一個，不得各寫一個數字。
  c_batch_day_threshold constant int := 100;
BEGIN
  IF p_brand IS NULL THEN
    RETURN QUERY
    WITH new_batch_days AS (
      -- 只在 p_new_since 有值時才會被執行（見 filtered 的 OR 短路）。
      -- 下界 = p_new_since 所在台灣日的 00:00（不是 p_new_since 本身）：整日量才判得準。
      SELECT (pb.created_at AT TIME ZONE 'Asia/Taipei')::date AS day
      FROM public.products_list_public pb
      WHERE pb.created_at >= timezone('Asia/Taipei', date_trunc('day', timezone('Asia/Taipei', p_new_since)))
        -- 未來時戳不得參與批次日計數（codex R2）：那種列自己不會被回傳（filtered 有 <= now()），
        -- 但若同一天累積到 N，會把當天**真正的**新品整天一起誤殺。
        AND pb.created_at <= now()
      GROUP BY 1
      HAVING count(*) >= c_batch_day_threshold
    ), filtered AS (
      SELECT p.*
      FROM public.products_list_public p
      WHERE (p_category IS NULL OR p.category_raw = p_category OR p.category_raw LIKE p_category || ' · %')
        AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0 OR p.brand_slug = ANY(p_brand_slugs))
        AND (p_price_min IS NULL OR p.price_general >= p_price_min)
        AND (p_price_max IS NULL OR p.price_general <= p_price_max)
        AND (p_new_since IS NULL OR (
              p.created_at >= p_new_since
              -- 上界（codex R2 NIT-2）：未來時戳的列不算新品，否則它會永遠釘在「新品」第一位。
              -- 只夾窗、不夾 new_batch_days：批次日要用「整日實際有幾列」判斷。
              AND p.created_at <= now()
              AND NOT EXISTS (
                SELECT 1 FROM new_batch_days nbd
                WHERE nbd.day = (p.created_at AT TIME ZONE 'Asia/Taipei')::date
              )
            ))
    ), paged AS (
      -- count/排序/分頁先收斂到 ≤100 列，trim JOIN 只對當頁做（20260719150000 MF-4）
      SELECT f.*, count(*) OVER () AS total_rows
      FROM filtered f
      ORDER BY
        CASE WHEN p_sort = 'price-asc' THEN f.price_general END ASC NULLS LAST,
        CASE WHEN p_sort = 'price-desc' THEN f.price_general END DESC NULLS LAST,
        CASE WHEN p_sort = 'new' THEN f.created_at END DESC NULLS LAST,
        f.id ASC
      OFFSET GREATEST(p_offset, 0)
      LIMIT LEAST(GREATEST(p_limit, 1), 100)
    )
    SELECT
      jsonb_build_object(
        'id', pg.id,
        'title', pg.title,
        'subtitle', pg.subtitle,
        'handle', pg.handle,
        'availability', pg.availability,
        'price_general', pg.price_general,
        'card_image', pg.card_image,
        'fits', pg.fits,
        'brand_name', pg.brand_name,
        'brand_slug', pg.brand_slug,
        'category_raw', pg.category_raw,
        'fitments', pg.fitments,
        'card_image_trim', CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
          'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
          'nw', t.natural_width, 'nh', t.natural_height) END
      ),
      pg.total_rows
    FROM paged pg
    LEFT JOIN public.product_image_trim t ON t.url = pg.card_image AND t.status = 'ok'
    ORDER BY
      CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
      pg.id ASC;
    RETURN;
  END IF;

  RETURN QUERY
  WITH new_batch_days AS (
    SELECT (pb.created_at AT TIME ZONE 'Asia/Taipei')::date AS day
    FROM public.products_list_public pb
    WHERE pb.created_at >= timezone('Asia/Taipei', date_trunc('day', timezone('Asia/Taipei', p_new_since)))
      AND pb.created_at <= now()                       -- 同上：未來時戳不參與批次日計數
    GROUP BY 1
    HAVING count(*) >= c_batch_day_threshold
  ), matched AS (
    SELECT product_id
    FROM public.product_fitments
    WHERE moto_brand = p_brand
      AND (p_model IS NULL OR model_code = p_model)
      AND (p_year IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                          AND (year_end IS NULL OR year_end >= p_year)))
    UNION
    SELECT product_id
    FROM public.product_fitments_effective
    WHERE moto_brand = p_brand
      AND (p_model IS NULL OR model_code = p_model)
      AND (p_year IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                          AND (year_end IS NULL OR year_end >= p_year)))
  ), filtered AS (
    SELECT p.*
    FROM public.products_list_public p
    JOIN matched m ON m.product_id = p.id
    WHERE (p_category IS NULL OR p.category_raw = p_category OR p.category_raw LIKE p_category || ' · %')
      AND (p_brand_slugs IS NULL OR cardinality(p_brand_slugs) = 0 OR p.brand_slug = ANY(p_brand_slugs))
      AND (p_price_min IS NULL OR p.price_general >= p_price_min)
      AND (p_price_max IS NULL OR p.price_general <= p_price_max)
      AND (p_new_since IS NULL OR (
            p.created_at >= p_new_since
            AND p.created_at <= now()
            AND NOT EXISTS (
              SELECT 1 FROM new_batch_days nbd
              WHERE nbd.day = (p.created_at AT TIME ZONE 'Asia/Taipei')::date
            )
          ))
  ), paged AS (
    SELECT f.*, count(*) OVER () AS total_rows
    FROM filtered f
    ORDER BY
      CASE WHEN p_sort = 'price-asc' THEN f.price_general END ASC NULLS LAST,
      CASE WHEN p_sort = 'price-desc' THEN f.price_general END DESC NULLS LAST,
      CASE WHEN p_sort = 'new' THEN f.created_at END DESC NULLS LAST,
      f.id ASC
    OFFSET GREATEST(p_offset, 0)
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  )
  SELECT
    jsonb_build_object(
      'id', pg.id,
      'title', pg.title,
      'subtitle', pg.subtitle,
      'handle', pg.handle,
      'availability', pg.availability,
      'price_general', pg.price_general,
      'card_image', pg.card_image,
      'fits', pg.fits,
      'brand_name', pg.brand_name,
      'brand_slug', pg.brand_slug,
      'category_raw', pg.category_raw,
      'fitments', pg.fitments,
      'card_image_trim', CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
        'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
        'nw', t.natural_width, 'nh', t.natural_height) END
    ),
    pg.total_rows
  FROM paged pg
  LEFT JOIN public.product_image_trim t ON t.url = pg.card_image AND t.status = 'ok'
  ORDER BY
    CASE WHEN p_sort = 'price-asc' THEN pg.price_general END ASC NULLS LAST,
    CASE WHEN p_sort = 'price-desc' THEN pg.price_general END DESC NULLS LAST,
    CASE WHEN p_sort = 'new' THEN pg.created_at END DESC NULLS LAST,
    pg.id ASC;
END;
$fn$;

-- DROP 掉的 grant 必須重下（不是冗餘重申）。
REVOKE ALL ON FUNCTION public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int, timestamptz) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int, timestamptz) IS
  '型錄分頁 RPC。p_new_since 非 NULL = 只回該時間點之後、now() 之前新增，且排除「單一台灣日新增達到 100 件(>=)」的供應商批次日(#269-b、Sean 2026-08-11 Q15=C；N 委任 S 窗)。🔴 要改 N 必須開一支新的 migration 重貼整支函式——本檔已 apply、改它不會重跑。🔴 已知不穩定性:批次日判定用的是「當下仍可見的列數」，同一天在 99/100 件邊界上下跳動時，同一批商品會在新品頁反覆出現與消失(見本檔檔頭「這個機制的先天不穩定」)。p_sort 支援 recommend / price-asc / price-desc / new(created_at DESC)。';


-- ── 3. 收尾斷言（fail-closed；靠上面的 BEGIN 才有效力）──
-- 🔴 **每條斷言的判別力先講清楚**（codex R2 抓到我上一版有一條是恆真的）：
--   ① overload 恰 1 支 —— **有判別力**。DROP 沒生效／簽章漂移都會讓它 <> 1。
--   ② PUBLIC 不得有 EXECUTE —— **有判別力**。有人補了顯式 `GRANT ... TO PUBLIC` 就會紅。
--   ③ 三個 role 都有 EXECUTE —— ⚠️ **今天沒有判別力，明說**：實查 `pg_default_acl`
--      （schema public、objtype='f'）是 `{postgres=X, anon=X, authenticated=X, service_role=X}`
--      ⇒ **新函式自動就有這三個 grant**，把下面那行 GRANT 整段刪掉這條斷言仍然會綠。
--      留著的理由是 Supabase 已公告要停掉這種自動曝光；那天到了它就會開始有作用。
--      **不得因為它綠就宣稱「grant 已驗」。**
--   ④ view 有 created_at —— 有判別力（plpgsql 建立時不解析內部查詢欄位，漏欄要靠這條攔）。
--   ⑤ anon 對底表 products.created_at 的**欄級** SELECT —— 有判別力，而且是這片唯一
--      擋得住「security_invoker view 建得起來、真呼叫卻 permission denied」的那道。
DO $assert$
DECLARE
  v_overloads int;
  v_public_exec boolean;
  v_missing_roles text;
  v_has_created_at boolean;
  v_col_ok boolean;
  c_sig constant text :=
    'public.search_catalog_by_vehicle(text, text, int, int, int, text, text, text[], int, int, timestamptz)';
BEGIN
  -- ① 同名函式恰 1 支
  SELECT count(*) INTO v_overloads
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'search_catalog_by_vehicle';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION '#269-b 斷言①失敗:public.search_catalog_by_vehicle 應恰 1 支、實得 % 支。overload 存活 ⇒ 正式站現行 10 具名參數呼叫會 42725 ambiguous、型錄全頁掛掉。', v_overloads;
  END IF;

  -- ② PUBLIC 不得握有 EXECUTE（金流以外的 RPC 也一樣不開全世界）
  SELECT has_function_privilege('public', c_sig, 'EXECUTE') INTO v_public_exec;
  IF v_public_exec THEN
    RAISE EXCEPTION '#269-b 斷言②失敗:PUBLIC 對 % 有 EXECUTE。REVOKE 沒生效或有人補了顯式 GRANT TO PUBLIC。', c_sig;
  END IF;

  -- ③ 三個 role 都要有（今天由 pg_default_acl 保證、故無判別力；見上方說明）
  SELECT string_agg(r, ', ') INTO v_missing_roles
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r
  WHERE NOT has_function_privilege(r, c_sig, 'EXECUTE');
  IF v_missing_roles IS NOT NULL THEN
    RAISE EXCEPTION '#269-b 斷言③失敗:這些 role 對新簽章沒有 EXECUTE ⇒ %。DROP 會連 grant 一起帶走。', v_missing_roles;
  END IF;

  -- ④ view 真的長出 created_at
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products_list_public' AND column_name = 'created_at'
  ) INTO v_has_created_at;
  IF NOT v_has_created_at THEN
    RAISE EXCEPTION '#269-b 斷言④失敗:products_list_public 沒有 created_at 欄,p_sort=new 與 p_new_since 兩條路都會炸。';
  END IF;

  -- ⑤ security_invoker 的底表欄級權限（view 建得起來 ≠ 客人讀得到）
  SELECT has_column_privilege('anon', 'public.products', 'created_at', 'SELECT')
     AND has_column_privilege('authenticated', 'public.products', 'created_at', 'SELECT')
  INTO v_col_ok;
  IF NOT v_col_ok THEN
    RAISE EXCEPTION '#269-b 斷言⑤失敗:anon/authenticated 對 products.created_at 沒有欄級 SELECT。products_list_public 是 security_invoker view ⇒ 客人打型錄會 permission denied,而 view 本身建得起來、前四條斷言全綠。';
  END IF;
END
$assert$;


-- ── 4. PostgREST schema cache reload（view 加欄 + 函式簽章換 ⇒ 缺此步新參數看不到）──
NOTIFY pgrst, 'reload schema';

COMMIT;
