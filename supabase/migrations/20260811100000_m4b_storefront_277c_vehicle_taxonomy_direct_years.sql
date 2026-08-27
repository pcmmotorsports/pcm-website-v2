-- 20260811100000_m4b_storefront_277c_vehicle_taxonomy_direct_years.sql
-- backlog #277 C 案:車輛下拉的「車型」取兩表聯集,「年份」只取 direct
--
-- Sean 2026-08-11 拍 C(S-031-A)。plan 與完整量測 = docs/specs/2026-08-11-277-c-plan.md
-- 本檔取代 20260811020000 建立的 view 定義(同名 view、CREATE OR REPLACE、GRANT 沿用)。
--
-- ══ 1. 為什麼要改(一句話)═══════════════════════════════════════════════════
--
-- 20260811020000 的 view 只讀 product_fitments_effective。那讓 198 組純推導子款
-- 出現在下拉(好),但**同時把年份維度換到一個已知會放大的來源**(壞),而且
-- 弄丟了 Ducati Panigale 959(effective 查無、direct 有 18 列)。
--
-- 🔴 年份那條的證據(2026-08-11 唯讀實查,母體 = 兩表都有的 123,920 列):
--      年份不一致 36,062 列(29.1%);effective 起始更早 19,689、結束更晚 14,205;
--      另有 1,187 列 direct 有明確結束年、effective 卻是 NULL(封閉區間被同步成開放式)。
--
-- ⚠️⚠️ **2026-08-11 稍晚:上面這三個數字的口徑被報價單側挑戰,重量中,引用前先看這段。**
--   (a) 我的比對是 `JOIN ON (product_id, moto_brand, model_code)`。若同一組有**多個年段列**
--       (報價單側說那是設計),join 會產生年段的**交叉積**、逐列比對到不同年段
--       ⇒ **36,062 很可能是我的查詢自己造出來的**,不是真的不一致數。要改「年段集合 vs 年段集合」重量。
--   (b) 報價單側裁定真機制是「**子車款原樣繼承父年段**」(52,836 列),**不是**我寫的 min/max 聯集
--       ⇒ 檔頭原本那句機制描述**不成立**,以本段為準。
--   (c) `2025+` → `year_end = NULL` 是**刻意的開放式語意、不是 bug** ⇒ 那 1,187 列不算問題;
--       網站端應把 NULL 當 `COALESCE(year_end, 9999)` 用(本 view 的下半硬寫 NULL 是另一回事,
--       那是「這台車沒有年份資訊」,語意不同,別混)。
--   🔴 **C 案本身不受影響**:年份只取 direct 的裁定照舊 —— 換源的理由不依賴那個百分比,
--       而是「effective 的年份不是該車款自己的年份」這件事本身,那一點雙方沒有爭議。
--    根因在報價單側 view storefront_fitments_v(投影商品群 min/max 聯集年份),
--    2026-07-14 已確認為 production bug:
--    docs/archive/2026-07-20-git-cleanup/handoffs/2026-07-14-quote-fitment-year-bug-verification.md:9-11
--    該檔並明載 product_fitments(direct)**不受影響** ⇒ 年份改只取 direct。
--    報價單修好後,下一次每日 16:10 同步會自動更正,屆時可回頭讓下半也帶年份。
--
-- ══ 2. 形狀與兩個刻意的取捨 ═════════════════════════════════════════════════
--
-- 上半 = 年份的唯一來源(direct)。下半 = 只補「direct 完全沒有的車型」、年份硬寫 NULL
-- ⇒ 那些車在下拉是「不限年份」(VehicleSelect.tsx:418-419 既有狀態,不必新做 UI)。
--
-- 🔴 取捨一:anti-join 用**原字面等值**,不做 lower/btrim。
--    代價:兩表有 3 組同一台車兩種字面(Ducati "Panigale V4"/"panigale v4"、
--    Honda "Forza 250 "(尾端空格)/"Forza 250")⇒ 下半會多補 1 列別名。
--    為什麼還是這樣選:改成 lower(btrim(...)) 實測 413ms → 1,170ms(2.8 倍),
--    且兩側 sort 都 external merge Disk(溢出磁碟)⇒ anon 3s 的餘裕從 7 倍掉到 2.6 倍。
--    那多出來的 1 列由 app 端吸收:buildVehicleTaxonomy 以 NFKC+trim+lower 當節點鍵去重
--    ⇒ 兩個字面併成同一個車型節點、年份取聯集。
--    ⚠️ **這是對 app 行為的依賴**,守門在 apps/storefront/src/lib/products-vehicle-taxonomy.test.ts
--    (「字面變體必須併成同一節點」那格,配突變:拿掉 normalize 的 trim 必須紅)。
--    ⇒ 誰要改那支 normalize,先回來讀這段。
--
-- 🔴 取捨二:security_invoker = false(definer)。理由同 20260811020000 §2:
--    invoker 版會把底表 RLS 的下架 join 套進來 ⇒ 實測 3,047ms,而 anon 的
--    statement_timeout 是 **3s**(不是 8s;8s 是 authenticated/authenticator)⇒ 必定逾時。
--    本 view 仍只投影四個車輛欄位、**零 product_id / 零價格 / 零供應商**。
--    ⛔ 不得加 product_id 或任何商品欄 —— 那會讓它變成繞過 RLS 的商品查詢路徑。
--
-- UNION ALL 而非 UNION:兩半依建構互斥(下半的 NOT EXISTS 保證該 brand/model 不在上半)。
-- 這不是推論:實測兩種寫法列數都是 8,390。
--
-- ══ 3. 效能(2026-08-11 實測)════════════════════════════════════════════════
--
--   裸 UNION 全量                                    413 ms
--   **實際分頁形狀**(ORDER BY 四欄 + LIMIT 1000 OFFSET 8000 = 末頁)   **637 ms**
--   總列數 8,390 ⇒ PostgREST max rows 1000 ⇒ **9 頁**
--   兩側都 Index Only Scan(ix_pf_lookup / ix_pfe_lookup)
--
-- 🔴 每頁都重算整個 UNION(無跨頁快照)⇒ 一次 cache miss 總成本 ≈ 9 × 0.6s ≈ 5.4s,循序。
--    account/vehicle/actions.ts:41-53 的 validateDictPair 會 await 這整段。
--    **但這是改善不是退步**:今天那條路(products_public 全 fitments)是 20 頁 × 約 0.85s ≈ 17s。
--    絕對值仍難看,正解 = 寫入路徑不該撈整份 taxonomy(驗一組只需 limit 1)⇒ 另立 backlog。
-- ⚠️ 以上皆為單次、暖態、單一 instance 觀察;冷 cache / p95 / 並行多 instance **都沒量**。
--
-- ══ 4. 行為變化(全部量過)═════════════════════════════════════════════════
--
--   相對今天多出來:四欄組合 234 / 車型 201(字面)、**200**(normalize 後,與 app 節點鍵同口徑)
--   相對今天少掉:四欄組合 1(= "Forza 250 " vs "Forza 250" 的空白字面差,非真損失)
--   **整台消失的車型(normalize 後)= 0**
--   Panigale 959:3 列,回來了
--
-- ══ 5. 已知殘留(列出來,不自宣接受)═══════════════════════════════════════
--
-- (a) 🔴 底表 product_fitments_effective **整張表不在 migration 歷史裡**(backlog #299,
--     2026-07-29 演練撞到)⇒ 本 view 在全新 preview / 災難重建時**建不起來**。
--     非本片造成(20260811020000 已經吃這條依賴)。正式庫跑得動 ≠ repo 可重建。
-- (b) 幽靈車款:product_fitments 含已下架商品的列 ⇒「選得到但 0 結果」仍在。
--     🔴 代價比表面大一級:actions.ts:41-53 拿這份 taxonomy 當**寫入路徑的 fail-closed 字典**
--     ⇒ 只靠下架商品撐著的車型也會變成合法字典值、存得進客人的愛車。正解 = #389。
-- (c) 年份的表示損失仍在:20260708130000:91 的 CASE 要求 yearStart 與 yearEnd **都**是四位數字
--     才留 year_end ⇒「省略 yearEnd(單年)」與「開放式」壓成同一個 NULL,app 讀成開放式。
--     今天來源 jsonb 裡「省略 yearEnd」= 0 個(2026-08-11 實查未下架 87,427 個元素)⇒ 現在不會發生。
--     **失效條件**:匯入端哪天送單年 {yearStart: 2024},下拉會變成 2024..資料上界。
-- (d) 🔴 跨頁沒有快照:每日 16:10 sync 整表換掉 effective,若換發生在翻頁之間,OFFSET 位移
--     ⇒ **某車型可能被整個跳過並進 900s 快取**,那 15 分鐘內它在下拉消失、且寫入被拒。
--     沒有測試會紅、沒人會叫。本片不改分頁(屬 #393 同族);正解 = #389 matview 單一物件一次讀完。
-- (e) MF-5 的 6 筆字面/slug 撞號(今天就存在、非本片造成)的贏家由**資料排序**決定
--     ⇒ 每日同步後新增一個排序更前的別名,**不需 deploy 就會翻面**。
--     翻面後果分兩種:slug 撞號那 5 筆 = 既有 URL 靜默指向另一台(name 都還在、寫入不受影響);
--     同 key 多字面那 1 筆 = 輸家字面撞 actions.ts:47 嚴格比對 ⇒ **寫入被拒**。
--
-- ══ 6. rollback ═════════════════════════════════════════════════════════════
--
-- 純 view 定義變更、零資料面。回捲 = 把 20260811020000 的 CREATE OR REPLACE VIEW 整段重跑,
-- **並且把 COMMENT 也一起換回去** —— 只重跑 CREATE OR REPLACE VIEW 的話,view 會變回舊定義
-- 但本檔這段說 C 案的 COMMENT 會留在上面說謊(它會宣稱年份只取 direct,而實際已不是)。
-- ⚠️ 回捲會讓 Panigale 959 再次消失、年份再次換到壞掉的來源 —— 回捲前先確認那是你要的。
--
-- ══ 7. apply 時的鎖(實測)══════════════════════════════════════════════════
--
-- `CREATE OR REPLACE VIEW` 取 AccessExclusiveLock,**持有到 COMMIT** ⇒ 中間跑的 assert
-- 全程壓著鎖,期間 anon 對本 view 的 SELECT 會被擋(擋超過 3s 就是客人端逾時)。
-- 實測 assert 裡最重的三條合計 **218ms**(對現行 view 量的代理值)⇒ 鎖約為
-- 「DDL + 不到 1 秒」,距離 anon 的 3s 有餘裕。
-- 取捨:**assert 留在同一個交易裡**(換 RAISE 時整包自動回滾、db push 不會登記成功),
-- 代價就是那不到 1 秒的鎖。apply 排在離峰(停點=Sean)。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE OR REPLACE VIEW public.vehicle_taxonomy_public
  WITH (security_invoker = false) AS
SELECT DISTINCT moto_brand, model_code, year_start, year_end
FROM public.product_fitments
UNION ALL
SELECT DISTINCT e.moto_brand, e.model_code, NULL::int AS year_start, NULL::int AS year_end
FROM public.product_fitments_effective e
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_fitments d
  WHERE d.moto_brand = e.moto_brand
    AND d.model_code = e.model_code
);

GRANT SELECT ON public.vehicle_taxonomy_public TO anon, authenticated;

COMMENT ON VIEW public.vehicle_taxonomy_public IS
  '車輛下拉用的四欄投影(#277 C 案,2026-08-11 Sean 拍板):車型取 product_fitments '
  '與 product_fitments_effective 的聯集,**年份只取 product_fitments(direct)**。'
  '🔴 年份不取 effective 的理由:effective 的年份來自報價單 storefront_fitments_v,'
  '一律投影商品群 min/max 聯集年份 = 2026-07-14 已確認的 production bug;'
  '2026-08-11 實測兩表都有的 123,920 列中 36,062 列(29.1%)年份不一致。報價單修好後可回頭讓下半帶年份。'
  '🔴 下半(純 effective 的車型)年份硬寫 NULL ⇒ 下拉顯示「不限年份」;2026-08-11 為 198 列。'
  '🔴 security_invoker=false 是刻意的:invoker 版會套底表 RLS 的下架 join ⇒ 實測 3,047ms,'
  'anon 的 statement_timeout 只有 3s。⛔ 不得加 product_id 或任何商品欄。'
  '🔴 anti-join 用原字面等值(不 lower/btrim):正規化版實測 413ms→1,170ms 且排序溢出磁碟。'
  '代價 = 少數同一台車的別名字面會多一列,由 app 的 NFKC+trim+lower 節點去重吸收 '
  '(守門在 products-vehicle-taxonomy.test.ts;要改那支 normalize 先讀本註解)。'
  '⚠️ 失效條件:(1) 幽靈車款仍在,且會成為寫入路徑 fail-closed 字典的合法值(actions.ts:41-53);'
  '(2) 每日 16:10 sync 整表換 effective,翻頁之間發生會讓某車型被跳過並進 900s 快取,無告警;'
  '(3) 單年 fitment 若省略 yearEnd 會被讀成開放式(今天 0 筆,非結構保證);'
  '(4) 別名字面的 first-seen 贏家由資料排序決定,新增排序更前的別名不需 deploy 就會翻面。'
  '完整量測與取捨 = docs/specs/2026-08-11-277-c-plan.md;正解 = #389(matview)。'
  '底表 product_fitments_effective 不在 migration 歷史裡 = backlog #299。';

DO $assert$
DECLARE
  v_rows            bigint;
  v_missing_direct  bigint;
  v_missing_eff     bigint;
  v_lower_with_year bigint;
  v_direct_4col     bigint;
  v_lower_expected  bigint;
  v_lower_actual    bigint;
  v_959             bigint;
  v_public_select   boolean;
BEGIN
  -- 🔴 **空庫重放讓路**(2026-08-11 事後修補;#401 族:重放式 harness vs 假設有資料的斷言)。
  --    原版是無條件 `IF v_rows = 0 THEN RAISE` ⇒ 空的拋棄式叢集從零重放 migrations 時,
  --    底表 0 列 ⇒ view 0 列 ⇒ 這條把「空庫」誤判成「壞掉」,**炸掉全部 25 支 record harness**。
  --
  -- 🔴 讓路條件寫得很窄,**不是「view 空就放行」**:
  --      view 空 + 底表也空 → 正確行為(沒東西可投影)⇒ 跳過
  --      view 空 + 底表**有資料** → 真的壞了(anti-join 或 UNION 出事)⇒ **照樣炸**
  --
  -- 🔴🔴 **不要把上面誤讀成「判別力完全保留」——我原本就是這樣寫的,codex 窄審擊破了**:
  --    在**空庫那條路**上,所有資料面斷言(①②③④⑤)都是「空集合減空集合 = 0」⇒ 全數通過。
  --    也就是說**空庫重放時,把任一 UNION 分支刪掉、或讓 anti-join 恆不成立,都不會被抓到**。
  --    ⇒ 為了把那條路的判別力補回來一些,下面加了一條**與資料量無關的結構檢查**
  --      (view 定義必須同時引用兩張底表)。它擋得住「整個分支消失」,
  --      但**擋不住語意寫錯**(例如 anti-join 條件寫反)—— 這是誠實的缺口,不是宣稱的覆蓋。
  --    ⚠️ 真正要驗投影語意就得在空庫裡塞 fixture 再驗,那等於讓 migration 寫入底表,
  --      風險與範圍都超出「修 harness」這件事 ⇒ **沒做,列為決策題交主視窗**。
  --
  -- ⚠️ **另一個被放掉的情境(codex 窄審點名,承認)**:非 harness 環境的底表若在 apply 前被誤清空,
  --    也會走進「正常空庫」這條。要分辨得靠明確的 replay 訊號或 fixture,**光看資料為空推不出來**。
  --    本檔不攔它:一支 migration 的檔尾斷言本來就不是持續監控,清空事故該由別的機制發現。
  SELECT count(*) INTO v_rows FROM public.vehicle_taxonomy_public;
  IF v_rows = 0 THEN
    IF EXISTS (SELECT 1 FROM public.product_fitments)
       OR EXISTS (SELECT 1 FROM public.product_fitments_effective) THEN
      RAISE EXCEPTION '#277c: view 是空的、但底表有資料 —— 底表或 anti-join 出事了';
    END IF;
    RAISE NOTICE '#277c: 底表為空(空庫重放)⇒ 跳過資料量斷言,結構性斷言照跑';
  END IF;

  -- 🔴 結構檢查:view 定義必須**同時引用兩張底表**。
  --    這條與資料量無關 ⇒ **空庫重放時照樣有效**,補回上面說的那半判別力:
  --    誰把 UNION 的任一半刪掉(codex 窄審舉的例子),這條會炸。
  --    ⚠️ 它證的是「兩張表都還在定義裡」,**不是**「投影語意正確」。
  IF pg_get_viewdef('public.vehicle_taxonomy_public'::regclass, true) NOT LIKE '%product_fitments_effective%'
     OR pg_get_viewdef('public.vehicle_taxonomy_public'::regclass, true) NOT LIKE '%UNION ALL%' THEN
    RAISE EXCEPTION
      '#277c: view 定義少了 effective 那半或 UNION ALL —— 車型聯集沒了,純推導子款會整批消失。現行定義=%',
      pg_get_viewdef('public.vehicle_taxonomy_public'::regclass, true);
  END IF;

  -- ① 車型集合必須是兩張表的超集(這條才真的守住「車型不會不見」;
  --    只釘幾台樣本車的話,少掉數十個車型也會全過)
  SELECT count(*) INTO v_missing_direct FROM (
    SELECT DISTINCT moto_brand, model_code FROM public.product_fitments
    EXCEPT
    SELECT DISTINCT moto_brand, model_code FROM public.vehicle_taxonomy_public) x;
  IF v_missing_direct <> 0 THEN
    RAISE EXCEPTION '#277c: direct 有 % 組 (廠牌,車型) 不在 view 裡', v_missing_direct;
  END IF;

  SELECT count(*) INTO v_missing_eff FROM (
    SELECT DISTINCT moto_brand, model_code FROM public.product_fitments_effective
    EXCEPT
    SELECT DISTINCT moto_brand, model_code FROM public.vehicle_taxonomy_public) x;
  IF v_missing_eff <> 0 THEN
    RAISE EXCEPTION '#277c: effective 有 % 組 (廠牌,車型) 不在 view 裡', v_missing_eff;
  END IF;

  -- ② direct 的四欄組合必須逐列都在(年份不能在路上被改掉)
  SELECT count(*) INTO v_direct_4col FROM (
    SELECT DISTINCT moto_brand, model_code, year_start, year_end FROM public.product_fitments
    EXCEPT
    SELECT moto_brand, model_code, year_start, year_end FROM public.vehicle_taxonomy_public) x;
  IF v_direct_4col <> 0 THEN
    RAISE EXCEPTION '#277c: direct 有 % 組四欄組合不在 view 裡(年份被弄丟了)', v_direct_4col;
  END IF;

  -- ③ 🔴 **每一列都必須有正當來源**:不是 direct 的四欄組合,就是「純 effective 車型 + 空年份」。
  --    這條是本片的全部重點,寫成「全稱」而不是只看下半 ——
  --    只檢查下半的話,**重疊車型混進 effective 年份時 ①②④⑥ 會全綠**(關卡2 抓到的洞:
  --    那些車型在 direct 裡有,所以「下半」的條件根本不涵蓋它們)。
  SELECT count(*) INTO v_lower_with_year FROM (
    SELECT moto_brand, model_code, year_start, year_end FROM public.vehicle_taxonomy_public
    EXCEPT ALL
    (
      SELECT DISTINCT moto_brand, model_code, year_start, year_end FROM public.product_fitments
      UNION ALL
      SELECT DISTINCT e.moto_brand, e.model_code, NULL::int, NULL::int
      FROM public.product_fitments_effective e
      WHERE NOT EXISTS (SELECT 1 FROM public.product_fitments d
                        WHERE d.moto_brand = e.moto_brand AND d.model_code = e.model_code)
    )
  ) x;
  IF v_lower_with_year <> 0 THEN
    RAISE EXCEPTION
      '#277c: 有 % 列不屬於「direct 四欄」也不屬於「純 effective 車型+空年份」—— 有東西滲進來了(很可能是 effective 的年份)',
      v_lower_with_year;
  END IF;

  -- ④ 下半列數 = effective 中不在 direct 的 (廠牌,車型) 數(兩邊各自算再比,不是同一句話講兩次)
  SELECT count(*) INTO v_lower_expected FROM (
    SELECT DISTINCT e.moto_brand, e.model_code FROM public.product_fitments_effective e
    WHERE NOT EXISTS (SELECT 1 FROM public.product_fitments d
                      WHERE d.moto_brand = e.moto_brand AND d.model_code = e.model_code)) x;
  SELECT count(*) INTO v_lower_actual
  FROM public.vehicle_taxonomy_public v
  WHERE NOT EXISTS (SELECT 1 FROM public.product_fitments d
                    WHERE d.moto_brand = v.moto_brand AND d.model_code = v.model_code);
  IF v_lower_expected <> v_lower_actual THEN
    RAISE EXCEPTION '#277c: 下半列數對不上(預期 % / 實得 %)', v_lower_expected, v_lower_actual;
  END IF;

  -- ⑤ 本片存在的具體理由:B 案會弄丟的那台車必須在。
  --    🔴 **寫成條件式,不是時點事實**(關卡2 抓到):直接斷言「959 必須存在」的話,
  --    哪天它合法下架或被刪,一支正確的 migration 會被自己的斷言擋下來。
  --    真正的不變式是「direct 有的,view 就要有」—— 那已由 ① 全稱守住;
  --    這裡只在它還在 direct 時額外點名,當作這個 bug 的回歸錨點。
  IF EXISTS (SELECT 1 FROM public.product_fitments
              WHERE moto_brand = 'Ducati' AND model_code = 'Panigale 959') THEN
    SELECT count(*) INTO v_959 FROM public.vehicle_taxonomy_public
     WHERE moto_brand = 'Ducati' AND model_code = 'Panigale 959';
    IF v_959 = 0 THEN
      RAISE EXCEPTION '#277c: Ducati Panigale 959 在 direct 裡卻不在 view 裡 —— 這正是本片要修的那個 bug';
    END IF;
  ELSE
    v_959 := -1;  -- 已不在 direct(下架/刪除)⇒ 本錨點失效,不當成失敗
    RAISE NOTICE '#277c: Panigale 959 已不在 product_fitments,回歸錨點跳過';
  END IF;

  -- ⑥a 🔴 security_invoker 必須是 false —— 沒這條的話,改成 true 仍然全綠(關卡2 抓到),
  --     而後果是 anon 開始套底表 RLS 的下架 join ⇒ 實測 3,047ms ⇒ 撞 3s 逾時。
  --     這是本 view 唯一一個「改一個字就爆、但所有資料面斷言都看不出來」的地方。
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid = 'public.vehicle_taxonomy_public'::regclass
      AND c.reloptions @> ARRAY['security_invoker=false']
  ) THEN
    RAISE EXCEPTION '#277c: view 的 security_invoker 不是 false(現值 reloptions = %),anon 會逾時',
      (SELECT reloptions FROM pg_class WHERE oid = 'public.vehicle_taxonomy_public'::regclass);
  END IF;

  -- ⑥ 權限:anon/authenticated 要有、PUBLIC 不能有
  IF NOT has_table_privilege('anon', 'public.vehicle_taxonomy_public', 'SELECT') THEN
    RAISE EXCEPTION '#277c: anon 沒有 SELECT';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.vehicle_taxonomy_public', 'SELECT') THEN
    RAISE EXCEPTION '#277c: authenticated 沒有 SELECT';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM aclexplode((SELECT relacl FROM pg_class
                              WHERE oid = 'public.vehicle_taxonomy_public'::regclass)) a
    WHERE a.grantee = 0 AND a.privilege_type = 'SELECT') INTO v_public_select;
  IF v_public_select THEN
    RAISE EXCEPTION '#277c: PUBLIC 拿到 SELECT 了(不該有)';
  END IF;

  RAISE NOTICE '#277c OK: view % 列、下半 % 列(皆無年份)、959 % 列', v_rows, v_lower_actual, v_959;
END
$assert$;

COMMIT;
