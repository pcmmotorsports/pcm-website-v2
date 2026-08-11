-- ============================================================
-- 20260811120000_m4b_storefront_412_service_other_category — backlog #412
--   報價單側新增大分類「服務與其他 / 維修零件」,網站端補上對應的 categories 列。
--
-- Sean 2026-08-11 拍板(信箱 `S-062-A`,plan = `S-063-PLAN`,批准 = `S-067-A`):
--   Q1 = B:網站原有的內部分類「服務／其他」與新分類**合併成一顆**「服務與其他」(不隱藏、不另立)。
--   Q2 = A:首頁部品分類磚牆**排除**這一類(那是 app 層的事,見 `CategoryGrid.tsx`,不在本檔)。
--   Q3 = A:驗收用「供應商 + 料號」,不是只用料號。
--
-- 🔴 **為什麼分類列一定要由 migration 造**:`products.category_id` 是 NOT NULL + FK,匯入端靠
--   「來源分類名 → `categories.raw_path`」resolve(`20260703120000_p0b_seed_16_major_categories.sql:9-11`
--   逐字,含 backlog #261 的前車之鑑)⇒ **沒有這兩列,那批商品在網站這邊沒有合法歸屬**。
--
-- 🔴 **raw_path 必與來源逐字相同**(同上檔 `:19-20` 逐字:「否則 per-group resolve 對不上…原樣、不清洗」)。
--   來源字面 2026-08-11 唯讀查報價單 B 庫 `dllwkkfanaebrsuyuedy` 的 `storefront_catalog_v` 取得:
--     `major_category_v2_zh = 服務與其他`   `sub_category_v2_zh = 維修零件`(該大類下只有這一個子類)
--   當時該大類共 862 列、全部上架中,供應商 4 家(bonamici 733 / extreme 123 / evotech 5 / lightech 1)。
--   ⚠️ 件數**只是落筆當下的觀察、不是本檔的前提**:他們 08-09 的交接寫 739(= 733+5+1,當時 extreme 尚未進),
--     兩個數字都對、只是時間不同。本檔不對件數做任何斷言。
--
-- 🔴 **本檔不寫 products 一列**。合併的做法是**把原有那顆改名**,所以補差額商品(`manual` /
--   `manual-balance-payment` / 賣場 handle `pcm-balance-payment`)的 `category_id` 完全不動
--   ⇒ 結帳免運那條規則(`apps/storefront/src/lib/balance-payment.ts`,認 handle 不認分類)零觸碰。
--
-- 🔴 **客人看得到的變化(預期、不是意外)**:側欄那顆分類的顯示名會從「服務／其他」變成「服務與其他」。
--   它今天就有 1 件商品(補差額賣場)⇒ `apps/storefront/src/lib/category-taxonomy.ts:48` 的
--   `top.count > 0` 恆真 ⇒ 本來就一直顯示。**這正是 Q1=B 的本體**,列為預期可見變化。
--   新增的**子類**在那 862 件到達前是 0 件 ⇒ 被 `category-taxonomy.ts:41` 的
--   `.filter((s) => s.productCount > 0)` 濾掉 ⇒ 側欄不顯示。
--
-- 🔴 **本檔不保證那批商品會自動回來**,驗收也沒有這一條。實查:那批商品在網站上多數是
--   「2026-07-09 整批下架」的 bonamici 商品(798 件),抽驗 6 個 SKU(含 `AC_004`)在報價單側都是上架中。
--   造好分類之後它們會不會被重新上架,取決於**匯入/同步端**怎麼判 `delisted_at`,那條管線不在本 repo。
--   ⇒ 本檔同時是那個假設的實驗;apply 後看下一次同步的結果(plan §3、`S-064-A` §2 定案)。
--
-- ── 本機拋棄式叢集實測(2026-08-11;三個起始狀態 × 各跑兩次,用 `psql -1` 單一交易,
--    因為正式站 `supabase db push` 就是一支 migration 一個交易 —— 用不加 `-1` 的 `-f` 會讓
--    DO 區塊的 RAISE 只中止那一句、前面的寫入照樣留下,那與真實執行方式不同)────────────
--   | 起始狀態 | 退出碼 | 終態 |
--   | 舊名 + 掛著補差額商品 | 0 | 改名成功、**商品的 category_id 沒動**、子類建好 parent 正確 |
--   | 空庫(什麼都沒有)     | 0 | 直接建頂層 + 子類 |
--   | 新名已存在但 name/segments 是錯的 | 0 | 三個欄位被收斂回正確值(codex F1 修法的正向對照) |
--   | 舊名與新名**同時存在** | 3 | 斷言②開火、交易整個回滾(終態與跑之前逐字相同) |
--   四者重播第二次的退出碼與終態皆與第一次相同(冪等)。
--   🔴 **「整個回滾」這句在第一版是有條件的、我沒寫出條件**(R3 M2):它只在「整支跑在一個交易裡」
--     時成立,而 repo 的重放 harness 是逐句 autocommit ⇒ 當時那條路會留下部分套用。
--     現在整支是**單一 `DO` 區塊 = 單一語句**(見下方交易語意段)⇒ 這句話在**任何執行方式下都成立**,
--     修法不是把宣稱改小,是把宣稱變成真的。
--   **兩種執行方式各跑一次(上表四個起始狀態 × 各兩次),退出碼逐格相同**:
--     `psql -1 -f`(單交易)  → 0 / 0 / 0 / 3
--     `psql -f`(逐句 autocommit;= `scripts/d1t2-rehearsal.sh:79` 的跑法)→ 0 / 0 / 0 / 3
--     且 `both` 那格的終態在兩種方式下都與跑之前逐字相同(沒建子類、沒改名)= 真的整段不生效。
--   🔴 **原子性是怎麼被觀測到的(不是推論)**:`both` 那一格在 **autocommit 路徑**下退出碼 3,
--     而終態逐字等於跑之前(**沒改名、沒建子類**)—— 逐句 autocommit 之下還能整段不留痕,
--     只可能因為那整段是**一個語句**。這就是原子性的直接觀測。
--   🔴 **反面證據(同一條路上,舊形狀真的留下部分套用)**:第一版(裸敘述 + 暫存表)在同樣的
--     autocommit 路徑實跑,四格全變 3、錯誤 `42P01: relation "_m412_before" does not exist`,
--     而 `prod` 那格終態實查是「**改名已生效、子類已建好、商品跟著改名後的分類**」
--     ⇒ 部分套用 + 重放 harness 的 `|| die` 讓整支死掉。那正是 R3 M1 抓到的東西,
--     也是本檔為什麼長成一個 DO 區塊的原因。
--     ⚠️ 我**沒有**去做「把 DO 外殼拆掉」這個突變(拆掉後 `SELECT INTO`/`RAISE`/`IF` 都不是合法 SQL,
--     那不是同一支檔的變體、是另一支檔)⇒ 上面那對正反觀測就是這條的證據,不要當成有做過該突變。
--
-- ── 突變驗證(七靶;基準 = `prod=0 empty=0 wrongname=0 both=3`)────────────────────
--   M1 拿掉下方 UPDATE 的 `NOT EXISTS` 防撞守衛 → **退出碼一格都沒變**,
--      只是錯誤從 `P0001 #412 舊 raw_path 仍在` 變成 `23505 duplicate key … categories_raw_path_key`。
--      🔴 **誠實結論:那道守衛不影響「會不會失敗」,只影響「錯誤訊息看不看得懂」**。留著是為了讓
--      apply 的人一眼知道是合併狀態出問題,不是隨便一個唯一鍵撞了;**不要把它當成一道防線引用**。
--   M2 拿掉斷言②(舊名仍在)      → `both` 由 3 變 **0**(病態狀態會靜默通過、站上兩顆分類各有商品)
--   M3 raw_path 分隔符打錯        → prod/empty/wrongname 由 0 變 **3**(斷言③抓 segments 形狀)
--   M4 子類 INSERT 整段拿掉       → prod/empty/wrongname 由 0 變 **3**(斷言③抓「子類不存在」)
--   M5 頂層 INSERT 改回 DO NOTHING → `wrongname` 由 0 變 **3**(斷言①-b 抓 name 不對)= codex F1 的靶
--   M6 在本檔偷加一句**搬移** products → prod/wrongname 由 0 變 **3**(斷言④:md5 指紋變)= codex F2 的靶
--   M7 在本檔偷加一句**新增** products → prod/empty/wrongname 由 0 變 **3**(斷言④:count 與 md5 都變)
--      = codex R2 抓到「第一版只守搬走、不守新增」之後補的靶
--   ⚠️ 七靶在**改成單一 DO 區塊之後重跑一次**(快照由暫存表換成 plpgsql 變數 + 指紋),
--      紅的格號與基準逐格相同 ⇒ 換形狀沒有把任何一道守門的判別力弄丟(主視窗 `S-072-A` §2-2 的要求)。
--   ⚠️ M4 第一版是**壞掉的突變**(替換字串沒把整段 INSERT 換掉、原句還在跑)⇒ 當時顯示「無判別力」
--      是假訊號;修好替換範圍後才是上面這個結果。**負測 harness 自己也會假綠。**
--
-- ── codex 關卡2 F3(舊深連結)——**認列為已知邊界、不做相容映射**,理由與證據如下 ──────
--   findings 說得對:分類比對吃的是 `raw_path` / 分類名逐字,改名之後 `?category=服務／其他`
--   這種**舊網址**就不再命中。要不要為它做映射/redirect,取決於兩件事,兩件我都查了:
--   (a) **踩到會怎樣 = 0 筆,這是量出來的、不是推的**(R2 打掉我第一版的推論:我原本拿 client 端
--       `parseCategoryFromUrl` 回 null 去推「0 筆」,那是**錯的層** —— 回 null 只代表 client 不套篩選,
--       結果是 server 決定的)。改用正式庫直接呼叫 server 那支 RPC 量(2026-08-11 唯讀):
--         `search_catalog_by_vehicle(…, p_category := '這個分類不存在', …)`  → **0 列**
--         `search_catalog_by_vehicle(…, p_category := NULL, …)`             → 有列(全目錄路徑正常)
--       ⇒ 認不得的分類值走到 server 是 **0 筆**,不是「靜默顯示全站」。配上 #315(認不得的值原樣
--       留在網址上)⇒ 終態 = 0 筆 + 空狀態,看得見、可自我解釋。
--   (b) **誰手上會有那種網址 —— 這個我證不到全稱**(R2 更正):我只能證「**站內不再產生**」
--       (分類連結是從資料現算 `/products?category=<當下分類名>`,repo 內查無寫死的舊名連結);
--       **站外的書籤、聊天室分享、搜尋引擎索引無法排除**,所以不能寫成「沒人持有」。
--       那顆分類底下唯一的商品是內部補差額賣場 ⇒ 期望值低,但這是**判斷**,不是事實。
--   ⇒ 取捨:代價 = 少數持有舊網址的人看到一個**看得見的空清單**;收益 = 不必長期維護一張舊名映射表
--     (映射表本身就是下一個會漂的字面)。**若哪天真有客人回報從舊連結進來看不到東西,這個判斷要重估。**
--
-- 收斂式(不是差量式):不論起始狀態是「有舊名」「已改好」「兩者都沒有」(= 空庫重放),
--   跑完的終態都一樣 ⇒ 可重播、且**空叢集從零重放不會炸**(#401 族教訓:20260811100000 的
--   `v_rows = 0` 斷言曾把空庫誤判成壞掉、滅掉 25 支 harness)。
--   ⚠️ 舊那顆「服務／其他」與補差額商品**不在 `supabase/migrations` 歷史裡**(那半是真的),
--     ⇒ 空庫重放時走「兩者都沒有 → 直接建新的」那條路。
--     🔴 但**不是「全樹查無」**(R3 I1 打掉我原本的全稱句):`docs/specs/2026-07-24-m3-balance-payment-product-seed.sql:52-57`
--     就有一段建舊名分類的 INSERT,而它的冪等守衛是 `WHERE name = '服務／其他'` ——
--     本檔改名之後那個守衛**恆不成立** ⇒ 有人重建環境再跑那支 seed,會長出**第二顆舊名分類**
--     (正是斷言②要防的病態)。⇒ 本片**同時把那支 seed 的守衛與字面改成新名**,兩邊一起走。
--
-- ── 🔴 為什麼整支是**單一 `DO` 區塊**,而不是「檔內交易框」也不是「裸敘述」──────────
--   這一格繞了三圈才收斂,脈絡留給下一個人,免得再走一次:
--     · **第一版(裸敘述 + `TEMP TABLE … ON COMMIT DROP`)**:被 R3 M1 擊破 ——
--       repo 的重放 harness `scripts/d1t2-rehearsal.sh:79` 是 `psql … -f "$f"`、**沒有 `-1`**
--       ⇒ 逐句 autocommit ⇒ 暫存表跨句消失、斷言以 `42P01` 失敗,**而改名與子類早已提交**
--       ⇒ 部分套用 + 整支 harness `|| die`(#401 族:重放式 harness × 假設有交易的 migration)。
--     · **第二版(檔內顯式 `BEGIN;`/`COMMIT;`,主視窗 `S-070-A` 裁定)**:被 codex R4 擊破 ——
--       在 `psql -1 -f` 或任何「執行端自己包交易」的跑法下,檔內 `COMMIT` 會**提前提交外層交易**,
--       之後的 ledger 記帳不再與 schema 同生共死(`20260714120000_*.sql:41-46` 早就警告過這個形狀;
--       主視窗 `S-072-A` 自我更正:先前用「050000/060000 沒出事」去推翻它,是拿「沒出事」證「沒風險」)。
--     · **本版(單一 DO 區塊,主視窗 `S-072-A` 裁 B)**:一個 `DO` 區塊 = **一個語句**
--       ⇒ 不論執行端是逐句 autocommit、`-1`、還是自己包交易,**它都是原子的**;
--       失敗就整段不生效,而且**完全不干涉外層交易邊界**。
--   ⇒ 它把「這支檔到底跑在什麼交易語意下」這個假設**從根拿掉**,不是換一個依賴。
--   附帶好處:不需要暫存表 ⇒ `ON COMMIT DROP` 那一整族問題(跨句消失、fail-closed 宣稱過頭)一起消失,
--   快照改用 plpgsql 變數(全表指紋)。
--   ⚠️ 代價 = 可讀性:寫入與斷言混在同一個區塊裡。註解結構照原樣保留,分段標題不變。
--   ⚠️ 未收斂的上游議題(**不由本片發動**):`d1t2-rehearsal.sh` 該不該改成 `psql -1 -f`
--     = backlog **#424**(codex R4 C 案的那半;屬 #401 族共用 harness,掛 B 線)。
-- ============================================================

DO $mig$
DECLARE
  v_before_n     bigint;
  v_before_fp    text;
  v_after_n      bigint;
  v_after_fp     text;
  v_top_id       uuid;
  v_top_name     text;
  v_top_segments jsonb;
  v_sub_parent   uuid;
  v_sub_segments jsonb;
  v_old_left     bigint;
  v_top_count    bigint;
BEGIN

-- ── 0. 寫入前基準快照(給下方斷言④用)────────────────────────────
-- 🔴 codex 關卡2 F2 抓到的洞:原版斷言④只在跑完之後 `count(*)` 然後 `RAISE NOTICE` ——
--    **沒有失敗條件的東西不是斷言**,卻被我在註解裡寫成「本檔零 products 寫入的證據」。
--    印一個數字證明不了任何事(那正是「守門只印不擋 = 恆真」那條教訓)。
-- 🔴 R2 又抓到第二層:第一版只拍「這兩顆分類底下」的商品 ⇒ **新增商品、把別的分類的商品搬進來**
--    都照樣通過,宣稱仍然過頭。⇒ 改拍**全表**(id, category_id)的指紋,跑完再算一次比對。
-- ⚠️ **能證到什麼、證不到什麼(逐字寫清楚)**:這道斷言守的是
--    「**沒有任何商品的 `category_id` 被改、沒有商品被新增或刪除**」。
--    商品的**其他欄位**(價格、標題…)若被改,它抓不到 —— 那要靠讀這支檔案本身(全檔零 products 的
--    UPDATE/INSERT/DELETE 敘述)。不要把它引用成「零 products 寫入」的全稱證明。
-- 🔴 指紋取代原本的暫存表:同一個 DO 區塊內用變數存,**沒有跨語句的生命週期問題**,
--    也就沒有「執行端有沒有交易」這個前提。
-- 🔴 **存的是完整的 ordered serialization,不是它的 md5**(codex 窄確認 Q2):
--    md5 會碰撞 —— 兩組「筆數相同、內容不同」的映射可以有同一個 md5,那時商品歸屬已經變了、
--    斷言卻通過。機率極低但**是理論上必然存在的東西**,而且不用付代價就能避免:
--    `string_agg` 本來就要先組出完整字串才能餵給 md5 ⇒ 直接比完整字串**不多花聚合記憶體**。
--    md5 只留在錯誤訊息裡當人眼比對用的短碼。
SELECT count(*),
       coalesce(string_agg(p.id::text || ':' || p.category_id::text, ',' ORDER BY p.id), '')
  INTO v_before_n, v_before_fp
  FROM products p;

-- ── 1. 頂層:改名即合併;沒有舊的就直接建 ──────────────────────────
-- WHERE 條件裡的 NOT EXISTS 是必要的:`raw_path` 有 UNIQUE 約束,若新名字已經存在(重播、
-- 或有人先手動建了),無條件 UPDATE 會撞 23505。
UPDATE categories
   SET name       = '服務與其他',
       raw_path   = '服務與其他',
       segments   = to_jsonb(ARRAY['服務與其他']),
       updated_at = now()
 WHERE raw_path = '服務／其他'
   AND NOT EXISTS (SELECT 1 FROM categories c2 WHERE c2.raw_path = '服務與其他');

INSERT INTO categories (name, raw_path, parent_category_id, sort_order, segments)
VALUES ('服務與其他', '服務與其他', NULL, 1000, to_jsonb(ARRAY['服務與其他']))
ON CONFLICT (raw_path) DO UPDATE
   SET name               = EXCLUDED.name,
       parent_category_id = EXCLUDED.parent_category_id,
       segments           = EXCLUDED.segments,
       updated_at         = now();
-- sort_order 1000 = 沿用原有那顆的值(排在所有分類之後)。**刻意不往前排**:它不進磚牆(Q2=A),
-- 側欄排最後對客人最不打擾。要調順序是另一個決定,不在本片。
-- 🔴 `sort_order` **刻意不放進 DO UPDATE**:它是「別人可能調過」的欄位,本檔不該默默改回 1000。
-- 🔴 但 `name` / `parent_category_id` / `segments` **必須**收斂(codex 關卡2 F1):原版寫 DO NOTHING,
--    於是「那一列已存在但 name 或 segments 是錯的」這個起始狀態會**靜默通過** —— 而前端的磚牆排除
--    是拿 `name` 逐字比對的(`CategoryGrid.tsx` 的 `HOME_WALL_EXCLUDED`)⇒ name 一旦不對,
--    那顆分類就會重新爬上首頁磚牆,而 migration 顯示成功。
--    ⇒ 那時「收斂式」是**假的宣稱**:終態並不唯一。現在三個欄位都收斂,終態才真的只有一種。

-- ── 2. 子類:維修零件 ────────────────────────────────────────────
-- raw_path 慣例 = 「大類 · 子類」,分隔符 = 半形空格 + U+00B7 + 半形空格,必須與
-- `apps/storefront/src/components/products-filter-logic.ts:18` 的 `CATEGORY_PATH_SEP` 一致
-- (`20260712120000_seed_taxonomy_v2_categories.sql:9-10` 逐字);segments 由 raw_path 切出來、不手打。
INSERT INTO categories (name, raw_path, parent_category_id, sort_order, segments)
SELECT '維修零件',
       '服務與其他 · 維修零件',
       m.id,
       10,
       to_jsonb(string_to_array('服務與其他 · 維修零件', ' · '))
  FROM categories m
 WHERE m.raw_path = '服務與其他' AND m.parent_category_id IS NULL
ON CONFLICT (raw_path) DO UPDATE
   SET name               = EXCLUDED.name,
       parent_category_id = EXCLUDED.parent_category_id,
       segments           = EXCLUDED.segments,
       updated_at         = now();
-- 這裡用 DO UPDATE(對齊 20260712120000 的既有慣例):子類是本檔**新造**的,重播時把 parent 與
-- segments 收斂回正確值是我們要的;`sort_order` 刻意不寫進 DO UPDATE(同上,不覆寫別人調過的順序)。

-- ── 3. 斷言:全部與資料量無關 ⇒ 空庫重放照樣有效 ──────────────────
  -- ① 頂層存在、且真的是頂層
  SELECT id INTO v_top_id FROM categories
   WHERE raw_path = '服務與其他' AND parent_category_id IS NULL;
  IF v_top_id IS NULL THEN
    RAISE EXCEPTION '#412: 頂層分類「服務與其他」不存在或不是頂層 —— 改名/建立那段沒生效';
  END IF;

  -- ①-b 頂層的 name 與 segments 也要對(codex 關卡2 F1):`name` 是前端磚牆排除的比對鍵,
  --     錯了就是「migration 成功、分類卻爬回首頁」。存在性斷言對這種「還在但值不對」全盲。
  SELECT name, segments INTO v_top_name, v_top_segments FROM categories WHERE id = v_top_id;
  IF v_top_name <> '服務與其他' THEN
    RAISE EXCEPTION '#412: 頂層 name 是「%」不是「服務與其他」—— 前端排除清單比對的就是這個字面', v_top_name;
  END IF;
  IF jsonb_array_length(v_top_segments) <> 1 OR v_top_segments->>0 <> '服務與其他' THEN
    RAISE EXCEPTION '#412: 頂層 segments 不是 ["服務與其他"](實際 = %)', v_top_segments::text;
  END IF;

  -- ② 頂層只有一顆(改名不該產生第二顆;UNIQUE(raw_path) 已保證,這條擋的是「舊名沒被改到」)
  SELECT count(*) INTO v_old_left FROM categories WHERE raw_path = '服務／其他';
  IF v_old_left > 0 THEN
    RAISE EXCEPTION
      '#412: 舊 raw_path「服務／其他」仍在(% 列)—— 合併沒完成,會變成兩顆分類各自有商品', v_old_left;
  END IF;

  -- ③ 子類存在、parent 指向頂層、segments 是兩段(分隔符打錯的話這裡會炸)
  SELECT parent_category_id, segments INTO v_sub_parent, v_sub_segments
    FROM categories WHERE raw_path = '服務與其他 · 維修零件';
  IF v_sub_parent IS NULL OR v_sub_parent <> v_top_id THEN
    RAISE EXCEPTION '#412: 子類「維修零件」不存在或 parent 沒指向「服務與其他」';
  END IF;
  IF jsonb_array_length(v_sub_segments) <> 2
     OR v_sub_segments->>0 <> '服務與其他' OR v_sub_segments->>1 <> '維修零件' THEN
    RAISE EXCEPTION '#412: 子類 segments 不是 ["服務與其他","維修零件"](實際 = %)—— 分隔符可能打錯',
      v_sub_segments::text;
  END IF;

  -- ④ 🔴 **本檔沒有改動任何商品的分類歸屬**——真的斷言,不是 NOTICE(codex 關卡2 F2 + R2 修正)。
  --    **雙向**差集:跑前快照(全表)與跑後現況互相比,任一方向有差就炸 ⇒
  --    · `category_id` 被改 / 商品被刪 → 左差集非空
  --    · 商品被**新增** → 右差集非空(第一版漏掉這半,R2 抓到)
  --    改名之所以安全,正是因為動的是 `categories.raw_path`、不是 `products.category_id`。
  --    指紋 = `count(*)` + **完整的** `string_agg(id:category_id ORDER BY id)`:
  --    搬移(值變)、新增(多一筆)、刪除(少一筆)三種都會讓指紋或筆數對不上。
  --    比較用 `IS DISTINCT FROM`(兩邊都 NULL 不算差、單邊 NULL 算差)。
  SELECT count(*),
         coalesce(string_agg(p.id::text || ':' || p.category_id::text, ',' ORDER BY p.id), '')
    INTO v_after_n, v_after_fp
    FROM products p;
  IF v_after_n IS DISTINCT FROM v_before_n OR v_after_fp IS DISTINCT FROM v_before_fp THEN
    RAISE EXCEPTION
      '#412: 本檔動到了 products 的分類歸屬(跑前 % 筆/指紋 %,跑後 % 筆/指紋 %)—— 合併只該改分類名,不該碰商品',
      v_before_n, left(md5(v_before_fp), 8), v_after_n, left(md5(v_after_fp), 8);
  END IF;

  SELECT count(*) INTO v_top_count FROM products WHERE category_id = v_top_id;
  RAISE NOTICE '#412 OK: 頂層 id=% 底下 % 件(正式站預期 1 = 補差額賣場;空庫重放預期 0);products 全表 % 筆指紋未變',
    v_top_id, v_top_count, v_after_n;
END
$mig$;
