-- ============================================================
-- M-4b · E10 訂單閉環第 2 批 · B2-S2a:摘要表加 shipped_quantity 欄 + 三條 CHECK
-- ============================================================
-- 片級 plan = docs/specs/2026-08-06-e10-b2-s2a-summary-columns-plan.md(**v2、已凍結**)
--   🔴 該 plan 關卡1 兩輪 FAIL 用盡、R2 的 16 條刻意未折入。Sean 2026-08-06 拍 **Q1=A**:
--      plan 當「意圖文件」用,**§0.6 的四處已知壞點與 R2 findings 一律在本 diff 修**。
--      逐條落點見下方「plan 已知壞點的 diff 修法」。
-- 真權威 = docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md §5.1c
--        + memory project_m4b-b2-shipments-db-decisions(2026-08-05 Q1=A)
-- 片型 = 高風險片(鐵則 12 ③ DB 結構)。
--
-- ── 這片在做什麼 ────────────────────────────────────────────
-- 摘要表(A1)本來只有三個數量軸:ordered / instock / cancelled。
-- 第 2 批做了包裹模型(S1a/S1b)之後多出第四軸「已出貨」,本片把格子挖出來:
--   shipped_quantity   已出貨幾件   ← shipment_items JOIN shipments(有效已寄出)
-- 並補上三條不變式:
--   C8  oiqs_shipped_nonneg                 shipped >= 0
--   C9  oiqs_shipped_le_instock             shipped <= instock      ← Sean 08-05 Q1=A 的**強制點**
--   C6' oiqs_cancelled_shipped_le_quantity  cancelled + shipped <= quantity
--
-- 🔴 **本片只挖格子、不接線**:欄加完一律是欄預設 0 —— A4a 重算不算第四軸、repo 內沒有任何路徑會寫它。
--    (**這不是 DB 強制恆 0**:CHECK 對被寫的值評估,owner/SECDEF 寫非 0 當下就受約束。見下方誠實邊界。)
--    真值填入 = 大線 B2-S2b(helper 四軸化 + shipments 重算 trigger + 真值 backfill)。
--    本片零 trigger、零函式、零 RPC 改動。
--
-- ── 🔴 Sean 2026-08-05 Q1=A:完整式**不減 shipped** ────────────
-- A1 的契約債 ① 逐字要求「完整式 cancelled <= quantity - shipped」。**那個字面已被推翻。**
-- 理由:第 2 批**無直送**,出貨必先到貨 ⇒ shipped ⊆ instock。
-- 既有 C7 已經是 instock + cancelled <= quantity,若再從 C6/C7 減掉 shipped,
-- 等於把同一批貨扣兩次(shipped 本來就被 instock 算過)。
-- ⇒ 正解 = **C7 原封不動**,另加一條 C6'(cancelled + shipped <= quantity)當冗餘字面。
--
-- ── A1 契約債 ① 清償聲明(三項缺一不可)──────────────────────
--   ① 加 shipped_quantity 欄                                    ✅ 本片 §2
--   ② 納入 **C6'(C7 不動)**                                    ✅ 本片 §2
--   ③ 🔴 **刻意不做**:不把 shipped 從 C6/C7 減去 ——
--      Sean 08-05「無直送」⇒ shipped ⊆ instock,減了是**重複扣**。
--      A8a1/A8a2 可取消量守門同理不改(它們比的是 instock,已含 shipped)。
--   🔴 只寫「已清償」而不寫第三項刻意不做 = 把推翻過的字面留給下一個人重犯。
--
-- ── apply 前置判準(Fable R3 F1;取代 plan §3.4 的鎖窗折衝)──────
-- plan §3.4 為了 gate 與 ALTER 之間的 race,寫了 LOCK TABLE ... IN SHARE MODE。
-- 🔴 **本片不採用**,兩個理由:
--   (a) 那個鎖序與合法 writer **相反**(writer 先 INSERT shipment_items 再 UPDATE shipments;
--       plan 先持有 shipments 再等 shipment_items)⇒ 真 40P01 死結面(plan §0.6 第一條)。
--   (b) 正式站三張出貨表**實查 0 列**(plan §0.3),空表上的鎖窗設計是過度工程。
-- ⇒ 改成**一條事前判準 + 一道 fail-closed 閘**:
--   · harness 前置閘 = Fable F1 原句 —— 🔴 **落點 `scripts/b2s2a-verify.sh` 由後續片 S2a-2 交付,現在還不存在**;
--     在它交付之前,這條判準的唯一執行者是 apply 當下的人(⛔ 手動停點)。
--     「**apply 當下任一出貨表非 0 → 停、問人**」(保守、大聲、交人決定)。
--   · 本檔 §1 的閘 = **有效已寄出量必須為 0**(精確、fail-closed)。
--     兩者刻意不同:草稿箱有品項但未寄出時真值仍為 0,不該被裸列數擋下來,
--     但那種狀態值得一個人看一眼 ⇒ 保守判準放 harness、精確判準放 DB。
-- 🔴 **殘餘 race(誠實邊界;codex 關卡2 更正了我原本的錯誤描述)**:
--    §1 的閘是一個**快照**,§2 的 `ALTER` 取的是 `order_item_quantity_summary` 的 ACCESS EXCLUSIVE ——
--    **那把鎖與出貨兩表無關**,所以出貨交易既不會被它擋、`ALTER` 也不會等它。
--    ⇒ 閘通過之後、COMMIT 之前寄出的包裹,新欄照樣是 DEFAULT 0(=錯的真值),而且不會有任何告警。
--    本片**不用鎖去消除它**(見上 (a));承受的理由 = 兩張出貨表對 service_role 只有 SELECT、
--    repo 內無 writer 路徑、apply 是手動停點;且真值由大線 backfill 重算覆蓋。
--
-- ── plan 已知壞點的 diff 修法(plan §0.6 四條 + R2 #13/#15/#16)──
--   §0.6-1 LOCK TABLE 死結面      → 不採用鎖(見上)
--   §0.6-2 lock_timeout 語意錯    → 隨鎖一起移除;本檔不設 lock_timeout
--   §0.6-3 apply 說明 oracle 恆綠 → 文字錨改用本檔尾 apply 說明區塊的專屬 ID(全檔**只出現一次**,
--                                    在這裡刻意不重複寫出那個字串,否則 presence oracle 又會恆綠)
--   §0.6-4 鐵則 11 預先允許紅燈   → commit 前三綠實跑輸出入 commit body,不預先宣稱
--   R2 #13 C7 是 catalog COMMENT  → §3 用 COMMENT ON CONSTRAINT 覆寫,不只寫原始碼註解
--   R2 #15 down 沒有唯一合法狀態  → 回滾段的 preflight 改直接查 helper 定義是否含 shipped_quantity
--   R2 #16 COMMENT 回滾字面未定義 → 回滾段逐字寫死還原文字,**明令不得還原成 S1b 的矛盾舊句**
--
-- ── 🔴 **刻意不做**:plan §3.5 的 quarantine 目錄機制(Sean 2026-08-06 拍 Q3=C)────
-- plan 把 supabase/migrations-quarantine/ 訂為本片的開工硬前置。**整節作廢、不實作。**
-- 理由(Fable R3 F3):**那是在重新發明 git** —— migration 只要不 commit 進 dev 就物理上 push 不到,
--   而施工粒度不等於 apply 粒度。R2 的 #5/#6/#7/#8 四條全在打這個機制,連同機制一起消失。
-- ⇒ 本檔**直接落在 supabase/migrations/**(provision 與 db push 都會掃到)。代償:
--   ① 本片 commit **只停在 a4a-chain 分支、不併 dev**,主視窗負責押住;
--   ② 小線大線全齊後才 merge + 同批 apply(= S1 三支同批的既有慣例);
--   ③ ⛔ **apply 是 Sean 的手動停點**,不由任何腳本自動觸發。
-- 🔴 誠實邊界:代償 ①②③ 全是**流程性**的,沒有機制強制力 —— 有人現在跑 db push 就會套進去。
--
-- ── 🔴 誠實邊界 ──────────────────────────────────────────────
-- · 本片落地後 shipped_quantity 實務上會全 0,但**不是 DB 強制它恆 0**:
--   owner / break-glass / 任何 SECURITY DEFINER 路徑寫入非 0 時,C8/C9/C6' 當下就有效力。
--   正確說法是「**沒有 writer 會去觸發它,不是它擋不住**」。
-- · 🔴 那個「沒有 writer」的**理由要講對**(codex 關卡2 R2):是**摘要表的唯一 writer A4a 不算第四軸**,
--   **不是**「出貨兩表對 service_role 只有 SELECT」—— 出貨表的 ACL 與誰能寫摘要表這一欄無關。
-- · 🔴 **A4a 不是「把它寫回 0」,是「根本不碰它」**(親查 `20260803140000_m4b_e10_a4a_quantity_summary_recompute.sql:183-187`:
--   `ON CONFLICT (order_item_id) DO UPDATE SET` 只列 quantity/ordered/instock/cancelled 四欄)⇒
--   ①新建列取欄預設 0 ②**既有列若被 owner/SECDEF 寫成非 0,會一直留著、不會被重算清掉**
--   ③🔴 而且此後每次 A4a 重算都要一併通過 C9 —— **instock 一旦下降到殘留值以下,
--     合法的重算會紅在 `23514 / oiqs_shipped_le_instock`**。這是 C9 帶進來的新營運面,
--     在大線 S2b 讓本欄有真正的 writer 之前,任何手寫非 0 都是埋雷。
-- · C6' 是**代數冗餘**(C9 ∧ C7 在非負整數上逐點蘊含 C6'),保留理由 = 字面完整與可讀性,
--   與 A1 對 C1/C6 的處置一致;**不宣稱它有行為獨立性、不要求獨立負測**。
-- ============================================================

BEGIN;

-- ══ 1. apply gate:有效已寄出量必須為 0(fail-closed)══════════════════════════
-- 🔴 判準是「**有效已寄出**」而非裸列數:草稿箱(未寄出)或已作廢的包裹不影響真值。
--    非 0 ⇒ DEFAULT 0 會寫下錯誤的真值 ⇒ 整片回滾,交由大線的真值 backfill 處理。
DO $$
DECLARE
  v_cnt bigint;
BEGIN
  -- 🔴 用**列數**不用 sum(codex 關卡2):sum 會被正負互抵成 0
  --    ⇒ 上游數量 CHECK 一旦漂移,逐品項明明已出貨卻能通過閘。列數沒有互抵面。
  SELECT count(*) INTO v_cnt
    FROM public.shipment_items si
    JOIN public.shipments s ON s.id = si.shipment_id
   WHERE s.deleted_at IS NULL
     AND s.shipped_at IS NOT NULL;

  IF v_cnt <> 0 THEN
    RAISE EXCEPTION
      'S2A-GATE-SHIPPED-NONZERO:有效已寄出的品項列數 = %,DEFAULT 0 會寫下錯值 — 停,改走大線的真值 backfill', v_cnt;
  END IF;
END
$$;


-- ══ 2. 加欄 + 三條 CHECK ══════════════════════════════════════════════════════
-- NOT NULL DEFAULT 0 在 PG11+ 不重寫表;三條 CHECK 各一次全表掃描;
-- ACCESS EXCLUSIVE 持有到 COMMIT(正式站 0 列 ⇒ 掃描成本可忽略)。
--
-- 🔴 ::bigint 沿用 A1 C7 的理由(該檔文字錨「**::bigint 不是裝飾**」):
--    兩個 integer 相加會先溢位成 SQLSTATE 22003,根本到不了具名 CHECK
--    ⇒ 負向測試會「紅在錯的地方」而被誤判成通過。
--    C9 是單欄比較、不會相加 ⇒ **刻意不加轉型**。
ALTER TABLE public.order_item_quantity_summary
  ADD COLUMN shipped_quantity integer NOT NULL DEFAULT 0,

  -- C8:非負。
  ADD CONSTRAINT oiqs_shipped_nonneg CHECK (shipped_quantity >= 0),

  -- C9 ✅:出貨數不超過到貨數 —— 語意 = **沒到貨就不可能出貨**(第 2 批無直送)。
  -- 🔴 這條就是 Sean 2026-08-05 Q1=A 拍的**強制點**:S1b 的 shipment_items 刻意不擋,
  --    唯一擋點在這裡。若日後開放直送,正解是**連同來源模型一起改不變式**,不是放寬這條。
  -- 🔴 **這個定位的代價(Fable R3 F1;交棒給大線 S2b)**:C9 比的是同一列上**兩個衍生快取值**
  --    (instock 由 A4a 維護、shipped 將由 S2b 維護)⇒ 它的強度 = min(A4a 正確性, S2b 正確性)。
  --    壞法不是「當場擋下」而是**紅在無辜交易**:若某列 instock 偏高,超額出貨會零違規提交,
  --    要等下一筆 A4a 把 instock 修正下來時才 23514 —— 紅的是那筆到貨更正,離真凶任意遠。
  --    ⇒ **S2b 的 plan 必須把「stale-high instock 讓超出貨靜默提交、事後紅在誰身上」列為負測情境。**
  ADD CONSTRAINT oiqs_shipped_le_instock CHECK (shipped_quantity <= instock_quantity),

  -- C6' 🟡 冗餘:被 C9 ∧ C7 代數蘊含(shipped <= instock,instock + cancelled <= quantity)。
  -- 保留理由 = master plan §5.1c 的字面完整 + 可讀性,同 A1 對 C1/C6 的處置。
  ADD CONSTRAINT oiqs_cancelled_shipped_le_quantity
    CHECK (cancelled_quantity::bigint + shipped_quantity::bigint <= quantity::bigint);


-- ══ 3. 註解 ══════════════════════════════════════════════════════════════════
-- 🔴 COMMENT 沒有強制力,它是留言不是機制(A1 §3 的教訓)。這一段的作用是
--    讓下一個人讀 catalog 就看得到第四軸與拍板,不是拿它當守門。

COMMENT ON COLUMN public.order_item_quantity_summary.shipped_quantity IS
  '已出貨的件數(第四軸)。來源 = shipment_items JOIN shipments,過濾 deleted_at IS NULL AND shipped_at IS NOT NULL;維護者 = A4a 四軸重算(**大線 B2-S2b,尚未施工**),任何人不得手填。🔴 本片落地後這一欄實務上會是 0,理由是**摘要表的唯一 writer(A4a 重算函式)目前不算第四軸** —— 它的 `ON CONFLICT DO UPDATE` 只更新 quantity/ordered/instock/cancelled 四欄,**完全不碰本欄**:新建列取欄預設 0,既有列的值**原樣保留**。⇒ **不是 DB 強制它恆 0**,也**不是**因為出貨兩表的 ACL(那兩張表不是本表的 writer,ACL 管不到這件事);而且 A4a **不會把非 0 值清回 0**,見表註解與檔頭誠實邊界:owner / SECURITY DEFINER 路徑寫入非 0 時,C8/C9/C6′ 當下就有效力。';

-- 表 COMMENT:A1 原文 + 第四軸。🔴 「無列 = 三個 0」必須同步改成四個,
-- 否則讀取端的 LEFT JOIN + COALESCE 會漏掉新欄。
COMMENT ON TABLE public.order_item_quantity_summary IS
  'E10 A1:訂單品項的數量摘要(衍生值,非真相)。真相在 A2 採購表、A7 取消明細與 B2 包裹表;本表存在的理由是「列 300 筆訂單時不要每次重算」(master plan Q9=B)。🔴 員工專用:anon/authenticated 零權限 + RLS zero-policy —— Sean 2026-07-31 拍板「不讓客人知道進度、只有狀態顯示」。🔴 任何人不得手填,唯一 writer = A4a 重算 trigger。🔴 惰性建列:無列 = **四個 0**,讀取端必須 LEFT JOIN + COALESCE(此約定無 DB 強制力,見欄註解的契約債)。🔴 2026-08-06 B2-S2a 追加第四軸 shipped_quantity(來源 = shipment_items JOIN shipments);該軸的重算接線在大線 B2-S2b,本片只挖格子。';

-- quantity 欄:A1 原文的「讓四條「跟 quantity 比」」把 C5 也算了進去(間接比)。
-- 🔴 本片改成只數**直接比**的四條(C4/C6/C7/C6′),分類標準一致;間接比的 C5/C9 明寫不計入。
COMMENT ON COLUMN public.order_item_quantity_summary.quantity IS
  '🔴 去正規化自 order_items.quantity,由複合 FK (order_item_id, quantity) → order_items(id, quantity) 物理釘死。存在的唯一理由 = 讓**四條直接跟 quantity 比**的不變式成為同表 CHECK(C4/C6/C7/C6′;C5 經 ordered、C9 經 instock **間接**比,不計入本數;否則跨表、只能用 trigger 補、繼承 #307 併發債)。不得單獨更新。';

-- 複合 FK:A1 原文的「三個數量皆 0」已過期。
COMMENT ON CONSTRAINT order_item_quantity_summary_item_fk ON public.order_item_quantity_summary IS
  '釘死 quantity 與品項歸屬。🔴 契約債:本表惰性建列,「order_item 沒有對應列 = **四個數量**皆 0」這個約定**沒有 DB 強制力** ⇒ A4a 負責建列、A9c/A11a-c 等讀取端一律 LEFT JOIN + COALESCE(…, 0),不得假設列必然存在。';

-- 🔴 C7 的 COMMENT 是 catalog 註解(不是 migration 檔內的 -- 註解),契約債 ① 就寫在這裡
--    ⇒ 清償必須覆寫它,否則 catalog 永遠留著一條已被推翻的指令。
COMMENT ON CONSTRAINT oiqs_instock_cancelled_le_quantity ON public.order_item_quantity_summary IS
  '§5.1c 第四條。🔴 **契約債 ① 已清償**(B2-S2a,2026-08-06):① shipped_quantity 欄已加 ② 已納入新增的 C6′(oiqs_cancelled_shipped_le_quantity)③ 🔴 **刻意不做**:本條與 oiqs_cancelled_le_quantity **不從 quantity 減去 shipped** —— Sean 2026-08-05 Q1=A,第 2 批無直送 ⇒ shipped ⊆ instock,減了是重複扣;A8a1/A8a2 可取消量守門同理不改。原契約債要求的「cancelled <= quantity - shipped」字面**已作廢,不得照做**。';

COMMENT ON CONSTRAINT oiqs_cancelled_shipped_le_quantity ON public.order_item_quantity_summary IS
  '§5.1c 第四條的出貨面對照(B2-S2a)。🟡 **代數冗餘**:C9(shipped <= instock)∧ C7(instock + cancelled <= quantity)在非負整數上逐點蘊含本條 ⇒ 本條**物理上無法單獨觸發**,不宣稱行為獨立性、不要求獨立負測。保留理由 = 字面完整與可讀性,同 A1 對 C1/C6 的處置。🔴 若日後開放直送(shipped ⊄ instock),本條會**升級成承重約束**,屆時必須補獨立負測。';

-- ── 3b. forward-override:修正 S1b 已 apply 的一句自相矛盾註解 ────────────────
-- 🔴 20260805170200(S1b)的 shipment_items.shipped_quantity 欄註解逐字同時寫著
--    「強制點未定案」與「已拍 Q1=A 走摘要表 CHECK(C9)」—— 同一句自我矛盾,且已在正式站。
--    歷史 migration 是已 apply 的紀錄、**不修改**;由本片覆寫 catalog(樣板 = A1 §4b 對 A2 的做法)。
-- 🔴 我當初全樹對帳為什麼漏掉它:變體只用了「尚未定案」,而這裡是「強制點未定案」**沒有「尚」字**。
--    ⇒ 教訓 = 變體清單要含**詞幹**(定案)而非完整詞。已寫進 memory
--       feedback_claimed-sync-but-only-patched-touched-lines。
COMMENT ON COLUMN public.shipment_items.shipped_quantity IS
  '本箱出貨數量。🔴 **強制點 = 摘要表 CHECK oiqs_shipped_le_instock(C9)**,約束本體由 B2-S2a(20260806100000)落地 —— Sean 2026-08-05 Q1=A。🔴 **強制鏈要 S2b 上線才閉合**:C9 對摘要表**當下的欄值**永遠有效力(CHECK 對被寫的值評估),但在 S2b 把本欄聚合進第四軸之前,**沒有任何 writer 會把真實出貨量搬過去** ⇒ C9 攔不到「出貨超過到貨」這件事。不是 C9 沒生效,是它看不到那個數字。本表**刻意不擋 shipped <= instock**:擋點只有一個,在摘要表。真值重算(把本欄聚合進摘要表第四軸)在大線 B2-S2b。🔴 本註解是對 20260805170200 該欄舊註解的 forward-override(舊註解同句自我矛盾);歷史 migration 不修改。';


-- ══ 4. 結構驗收(fail-closed;任一條不成立 = 整片回滾)═════════════════════════
-- 🔴 每條斷言帶機器可辨識 ID(S2A-xxx),突變測試據此判定「紅在指定的那條」。
-- 🔴 本段只驗結構/定義字面/註解字面 —— 這些在任何環境都成立,**無條件略過分支 = fail-open 假綠來源**。
--    需要真實資料的行為驗證(C8/C9 負測、邊界正測)全在 scripts/b2s2a-verify.sh。
-- 🔴 註解斷言刻意驗**兩件事**:新錨在 + 舊的過期字面**不在**。
--    只驗「新字面在」抓不到「覆寫沒生效但別處剛好也有這幾個字」。
DO $$
DECLARE
  v_cnt  integer;
  v_txt  text;
  v_name text;
  v_def  text;
BEGIN
  -- ── 4a. 新欄形狀逐字 ──
  SELECT format_type(a.atttypid, a.atttypmod)
         || CASE WHEN a.attnotnull THEN '/NOT NULL' ELSE '/NULL' END
         || '/DEFAULT ' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '(none)')
    INTO v_txt
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.order_item_quantity_summary'::regclass
     AND a.attname = 'shipped_quantity' AND a.attnum > 0 AND NOT a.attisdropped;
  IF COALESCE(v_txt, '') <> 'integer/NOT NULL/DEFAULT 0' THEN
    RAISE EXCEPTION 'S2A-COL:shipped_quantity 應為 integer/NOT NULL/DEFAULT 0,實為 %',
      COALESCE(v_txt, '(欄不存在)');
  END IF;

  -- ── 4b. 欄集合 = 逐字比對**名稱集合**,不是只數個數 ──
  -- 🔴 codex 關卡2:只數 6 抓不到「改名但仍是六欄」。
  SELECT string_agg(attname, ',' ORDER BY attname) INTO v_txt FROM pg_attribute
   WHERE attrelid = 'public.order_item_quantity_summary'::regclass
     AND attnum > 0 AND NOT attisdropped;
  IF v_txt <> 'cancelled_quantity,instock_quantity,order_item_id,ordered_quantity,quantity,shipped_quantity' THEN
    RAISE EXCEPTION 'S2A-COL-SET:欄名集合不符(A1 五 + 本片一)— 實為「%」', v_txt;
  END IF;

  -- ── 4c. 三條新 CHECK:存在 + 已 validated + 定義逐字比對 ──
  -- 🔴 只驗「名字在」抓不到「保留關鍵字但邏輯反了」(A7 關卡2 教訓)。
  FOR v_name, v_def IN
    SELECT * FROM (VALUES
      ('oiqs_shipped_nonneg',     'CHECK ((shipped_quantity >= 0))'),
      ('oiqs_shipped_le_instock', 'CHECK ((shipped_quantity <= instock_quantity))'),
      ('oiqs_cancelled_shipped_le_quantity',
       'CHECK ((((cancelled_quantity)::bigint + (shipped_quantity)::bigint) <= (quantity)::bigint))')
    ) AS t(name, def)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO v_txt
      FROM pg_constraint c
     WHERE c.conrelid = 'public.order_item_quantity_summary'::regclass
       AND c.conname = v_name AND c.contype = 'c' AND c.convalidated;
    IF v_txt IS NULL THEN
      RAISE EXCEPTION 'S2A-C-MISSING:%(缺漏或未 validated)', v_name;
    END IF;
    IF v_txt <> v_def THEN
      RAISE EXCEPTION 'S2A-C-DEF-MISMATCH:% 定義不符 — 期望「%」實為「%」', v_name, v_def, v_txt;
    END IF;
  END LOOP;

  -- ── 4d. CHECK 集合恰十條(A1 七 + 本片三);偷加第十一條或砍掉一條都要紅 ──
  -- 🔴 NOT NULL 在 PG17 不列入 pg_constraint 的 contype='c',故此處恰為十。
  SELECT count(*) INTO v_cnt FROM pg_constraint
   WHERE conrelid = 'public.order_item_quantity_summary'::regclass AND contype = 'c';
  IF v_cnt <> 10 THEN
    RAISE EXCEPTION 'S2A-C-EXTRA:本表 CHECK 應恰為 10 條,實查 %', v_cnt;
  END IF;

  -- ── 4e. A1 的七條原封不動:**逐條定義字面 + convalidated**,不是只數名字 ──
  -- 🔴 codex 關卡2:原版只數名稱在不在 + 只比 C7 定義
  --    ⇒ 另外六條被改寫定義、或七條任一被 NOT VALID 化,全都會靜默通過。
  v_cnt := 0;
  FOR v_name, v_def IN
    SELECT * FROM (VALUES
      ('oiqs_ordered_nonneg',        'CHECK ((ordered_quantity >= 0))'),
      ('oiqs_instock_nonneg',        'CHECK ((instock_quantity >= 0))'),
      ('oiqs_cancelled_nonneg',      'CHECK ((cancelled_quantity >= 0))'),
      ('oiqs_ordered_le_quantity',   'CHECK ((ordered_quantity <= quantity))'),
      ('oiqs_instock_le_ordered',    'CHECK ((instock_quantity <= ordered_quantity))'),
      ('oiqs_cancelled_le_quantity', 'CHECK ((cancelled_quantity <= quantity))'),
      -- 🔴 C7:Sean 2026-08-05 Q1=A 的具體內容就是「這一條一個字都不動」。
      ('oiqs_instock_cancelled_le_quantity',
       'CHECK ((((instock_quantity)::bigint + (cancelled_quantity)::bigint) <= (quantity)::bigint))')
    ) AS t(name, def)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO v_txt
      FROM pg_constraint c
     WHERE c.conrelid = 'public.order_item_quantity_summary'::regclass
       AND c.conname = v_name AND c.contype = 'c' AND c.convalidated;
    IF v_txt IS NULL THEN
      RAISE EXCEPTION 'S2A-C-A1-MISSING:A1 的 %(缺漏或被 NOT VALID 化)', v_name;
    END IF;
    IF v_txt <> v_def THEN
      RAISE EXCEPTION 'S2A-C-A1-CHANGED:A1 的 % 定義被動過 — 期望「%」實為「%」', v_name, v_def, v_txt;
    END IF;
    v_cnt := v_cnt + 1;
  END LOOP;
  IF v_cnt <> 7 THEN
    RAISE EXCEPTION 'S2A-C-A1-COUNT:A1 清單應恰七條,實跑 % 圈(清單自己被改短了)', v_cnt;
  END IF;

  -- ── 4f. 七個物件的 COMMENT:新錨在 + 舊的過期字面不在 ──
  -- 🔴 兩份清單各自**自斷言圈數**(codex 關卡2):否則漏掉一個物件時,
  --    迴圈少跑一圈、底下那句寫死「7 註解物件」的 NOTICE 照樣印出來。
  v_cnt := 0;
  FOR v_name, v_def IN
    SELECT * FROM (VALUES
      ('COL:summary.shipped_quantity', '大線 B2-S2b'),
      ('TABLE:summary',                '四個 0'),
      ('COL:summary.quantity',         '**四條直接跟 quantity 比**'),
      ('FK:summary.item_fk',           '**四個數量**'),
      ('C:oiqs_instock_cancelled_le_quantity', '契約債 ① 已清償'),
      ('C:oiqs_cancelled_shipped_le_quantity', '代數冗餘'),
      ('COL:shipment_items.shipped_quantity',  'oiqs_shipped_le_instock')
    ) AS t(obj, must_have)
  LOOP
    SELECT CASE v_name
      WHEN 'COL:summary.shipped_quantity' THEN
        col_description('public.order_item_quantity_summary'::regclass,
          (SELECT attnum FROM pg_attribute
            WHERE attrelid = 'public.order_item_quantity_summary'::regclass
              AND attname = 'shipped_quantity'))
      WHEN 'TABLE:summary' THEN
        obj_description('public.order_item_quantity_summary'::regclass, 'pg_class')
      WHEN 'COL:summary.quantity' THEN
        col_description('public.order_item_quantity_summary'::regclass,
          (SELECT attnum FROM pg_attribute
            WHERE attrelid = 'public.order_item_quantity_summary'::regclass
              AND attname = 'quantity'))
      WHEN 'FK:summary.item_fk' THEN
        (SELECT obj_description(oid, 'pg_constraint') FROM pg_constraint
          WHERE conrelid = 'public.order_item_quantity_summary'::regclass
            AND conname = 'order_item_quantity_summary_item_fk')
      WHEN 'C:oiqs_instock_cancelled_le_quantity' THEN
        (SELECT obj_description(oid, 'pg_constraint') FROM pg_constraint
          WHERE conrelid = 'public.order_item_quantity_summary'::regclass
            AND conname = 'oiqs_instock_cancelled_le_quantity')
      WHEN 'C:oiqs_cancelled_shipped_le_quantity' THEN
        (SELECT obj_description(oid, 'pg_constraint') FROM pg_constraint
          WHERE conrelid = 'public.order_item_quantity_summary'::regclass
            AND conname = 'oiqs_cancelled_shipped_le_quantity')
      WHEN 'COL:shipment_items.shipped_quantity' THEN
        col_description('public.shipment_items'::regclass,
          (SELECT attnum FROM pg_attribute
            WHERE attrelid = 'public.shipment_items'::regclass
              AND attname = 'shipped_quantity'))
      -- 🔴 CASE 是**運算式**、ELSE 只能放值(RAISE 是敘述,放這裡是語法錯,實跑撞過)。
      --    ⇒ 用一個不可能是真註解的哨兵,取出後立刻擋掉:新增列忘了加 WHEN 不會靜默變綠。
      ELSE '((S2A-UNMAPPED))'
    END INTO v_txt;

    IF v_txt = '((S2A-UNMAPPED))' THEN
      RAISE EXCEPTION 'S2A-COMMENT-UNMAPPED:% 沒有對應的取值分支(新增列時忘了加 WHEN)', v_name;
    END IF;

    IF v_txt IS NULL THEN
      RAISE EXCEPTION 'S2A-COMMENT-MISSING:% 沒有註解', v_name;
    END IF;
    IF position(v_def IN v_txt) = 0 THEN
      RAISE EXCEPTION 'S2A-COMMENT-ANCHOR:% 的註解缺少錨「%」', v_name, v_def;
    END IF;
    v_cnt := v_cnt + 1;
  END LOOP;
  IF v_cnt <> 7 THEN
    RAISE EXCEPTION 'S2A-COMMENT-COUNT:必含清單應恰七個物件,實跑 % 圈', v_cnt;
  END IF;

  v_cnt := 0;
  -- 「必須不含」單獨一輪(上一輪的 v_txt 已被註解內容覆蓋,不能共用迴圈變數)。
  FOR v_name, v_def IN
    SELECT * FROM (VALUES
      -- 🔴 shipped_quantity 是新欄、A1 時代不存在 ⇒ **沒有舊字面可排除**,本欄不進本迴圈。
      --    (曾寫過排除錨「零效力」,但那是 plan v1 的措辭、從未進過 DB ⇒ 恆綠、零判別力,已刪。)
      ('TABLE:summary',                '三個 0'),
      ('COL:summary.quantity',         '讓四條「跟 quantity 比」'),
      ('FK:summary.item_fk',           '三個數量'),
      ('COL:shipment_items.shipped_quantity', '強制點未定案')
    ) AS t(obj, must_not_have)
  LOOP
    SELECT CASE v_name
      WHEN 'COL:summary.shipped_quantity' THEN
        col_description('public.order_item_quantity_summary'::regclass,
          (SELECT attnum FROM pg_attribute
            WHERE attrelid = 'public.order_item_quantity_summary'::regclass
              AND attname = 'shipped_quantity'))
      WHEN 'TABLE:summary' THEN
        obj_description('public.order_item_quantity_summary'::regclass, 'pg_class')
      WHEN 'COL:summary.quantity' THEN
        col_description('public.order_item_quantity_summary'::regclass,
          (SELECT attnum FROM pg_attribute
            WHERE attrelid = 'public.order_item_quantity_summary'::regclass
              AND attname = 'quantity'))
      WHEN 'FK:summary.item_fk' THEN
        (SELECT obj_description(oid, 'pg_constraint') FROM pg_constraint
          WHERE conrelid = 'public.order_item_quantity_summary'::regclass
            AND conname = 'order_item_quantity_summary_item_fk')
      WHEN 'COL:shipment_items.shipped_quantity' THEN
        col_description('public.shipment_items'::regclass,
          (SELECT attnum FROM pg_attribute
            WHERE attrelid = 'public.shipment_items'::regclass
              AND attname = 'shipped_quantity'))
      -- 🔴 CASE 是**運算式**、ELSE 只能放值(RAISE 是敘述,放這裡是語法錯,實跑撞過)。
      --    ⇒ 用一個不可能是真註解的哨兵,取出後立刻擋掉:新增列忘了加 WHEN 不會靜默變綠。
      ELSE '((S2A-UNMAPPED))'
    END INTO v_txt;

    IF v_txt = '((S2A-UNMAPPED))' THEN
      RAISE EXCEPTION 'S2A-COMMENT-UNMAPPED:% 沒有對應的取值分支(新增列時忘了加 WHEN)', v_name;
    END IF;

    -- 🔴 fail-open 防線(code-reviewer R1 must-fix):v_txt 為 NULL 時
    --    position(x IN NULL) 也是 NULL ⇒ IF 不觸發、整條靜默變綠。必須先擋 NULL。
    IF v_txt IS NULL THEN
      RAISE EXCEPTION 'S2A-COMMENT-MISSING:% 沒有註解(排除面)', v_name;
    END IF;
    IF position(v_def IN v_txt) <> 0 THEN
      RAISE EXCEPTION 'S2A-COMMENT-STALE:% 的註解仍含過期字面「%」', v_name, v_def;
    END IF;
    v_cnt := v_cnt + 1;
  END LOOP;
  IF v_cnt <> 4 THEN
    RAISE EXCEPTION 'S2A-COMMENT-STALE-COUNT:排除清單應恰四個物件,實跑 % 圈', v_cnt;
  END IF;

  -- ── 4g. **摘要表**零 trigger:加欄不得順手在這張表上接線 ──
  -- 🔴 誠實範圍(codex 關卡2):本斷言只看摘要表。「本片零函式、零 RPC、出貨兩表零新 trigger」
  --    是**diff 層**的宣稱,由 code review 與關卡2 負責,不是這條 SQL 能證明的。
  SELECT count(*) INTO v_cnt FROM pg_trigger
   WHERE tgrelid = 'public.order_item_quantity_summary'::regclass AND NOT tgisinternal;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'S2A-TRIGGER:摘要表上應仍為零 trigger,實查 %(接線是大線 B2-S2b)', v_cnt;
  END IF;

  RAISE NOTICE 'S2A 結構驗收全數通過(6 欄 / 10 CHECK / 7 註解物件)';
END
$$;

COMMIT;

-- ============================================================
-- S2A-APPLY-NOTE:apply 說明(本 ID 是唯一文字錨,harness 與 handoff 對它)
-- ------------------------------------------------------------
-- 前置(Fable R3 F1;落點 = 後續片 S2a-2 交付的 harness 第一格,**該檔目前尚未存在**
--       ⇒ 在它交付前,執行者是 apply 當下的人):
--   🔴 **apply 當下任一出貨表(shipments / shipment_items)非 0 列 → 停、問人。**
--      不是技術限制,是「有真實資料時本片的 DEFAULT 0 語意要重新確認」的人工決定點。
-- DB 層 fail-closed:上面 §1 的閘(**有效已寄出的品項列數**必須為 0),非 0 直接整片回滾。
-- 鎖:只有 §2 ALTER 對**摘要表**的 ACCESS EXCLUSIVE(正式站 0 列 ⇒ 掃描可忽略);**本片刻意不用 LOCK TABLE**。
-- 🔴 那把鎖**擋不到出貨兩表** ⇒ 閘與 COMMIT 之間寄出的包裹不會被反映(檔頭「殘餘 race」)。
-- 落地後的事實:shipped_quantity 實務上全 0(因為 A4a 還不算第四軸),但 DB 未強制它恆 0(見檔頭誠實邊界)。
-- ============================================================

-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行)
-- 🔴 **只允許在大線 B2-S2b 之前使用。**
--    PG **不追蹤 PL/pgSQL 內的欄依賴** ⇒ 四軸 helper 在位時 DROP COLUMN **不會被擋**,
--    要等下一筆 A4a 重算才 42703 ⇒ 回滾必須自己 fail-closed。
--
-- 🔴 preflight(唯一合法狀態的判準;R2 #15:不要用「helper + trigger 集合」那種可被繞過的組合):
--    直接查 helper 本體是否還提到本欄 —— 有就拒跑,連孤兒函式一起擋。
--    🔴 **必須是會 RAISE 的 DO block、且與下面的 DROP 放在同一個交易**(codex 關卡2):
--       只印出命中列的 SELECT 擋不住任何人 —— 災難當下沒人會停下來讀輸出。
--      DO $ck$
--      DECLARE v_txt text;
--      BEGIN
--        SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_txt
--          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--         WHERE n.nspname = 'public' AND p.prokind = 'f'
--           AND pg_get_functiondef(p.oid) LIKE '%shipped_quantity%';
--        IF v_txt IS NOT NULL THEN
--          RAISE EXCEPTION 'S2A-DOWN-BLOCKED:仍有函式引用 shipped_quantity(%) — 先退大線', v_txt;
--        END IF;
--      END $ck$;
--    🔴 prokind='f' 不可省:pg_get_functiondef 對 aggregate/window 直接 ERROR,
--       整條查詢掛掉會長得跟「查無」一模一樣 ⇒ 放行本不該放行的回滾。
--    🔴 **誠實邊界(codex 關卡2 R2)**:同交易也**擋不住並行**的 S2b ——
--       別的連線在 preflight 之後才 CREATE 四軸 helper 並提交,本交易的 DROP 照樣成功,
--       留下引用已刪欄位的孤兒函式。SQL 層沒有便宜的擋法(CREATE FUNCTION 不碰本表的鎖)。
--       ⇒ **操作前提(人來保證)**:回滾期間**不得有任何 migration / 部署 / S2b 施工在跑**;
--       回滾完成後**必須重跑一次上面那段 preflight 查詢確認仍為空**。
--
-- 🔴 COMMENT 還原字面(R2 #16:回滾要還原成什麼,必須寫死):
--    · 表 COMMENT / FK COMMENT → 還原成 A1(20260730150000)的原文(那兩處 A1 原文本來就對)。
--    · 🔴 **`quantity` 欄與 C7 兩處不得還原成 A1 原文**(codex 關卡2):
--      A1 的 `quantity` 原文把 C5 也算進「跟 quantity 比」而寫成四條,本片已判定那個計數法不一致;
--      A1 的 C7 原文帶著**已被 Sean 2026-08-05 Q1=A 推翻**的契約債指令(cancelled <= quantity - shipped)。
--      還原它們 = 把兩個已修好的錯誤放回 catalog。回滾時改寫成:
--        quantity 欄:沿用本片字面,但把「C4/C6/C7/C6′」改成「C4/C6/C7」、四條改三條。
--        C7:'§5.1c 第四條。🔴 契約債 ① 的原始字面(cancelled <= quantity - shipped)已於 2026-08-05 被 Sean Q1=A 推翻,'
--            '不得照做;shipped 欄與 C6′ 隨 B2-S2a 回滾一併移除,重新落地時照 Q1=A 的形狀(C7 不動、另加 C6′)。'
--    · shipment_items.shipped_quantity → 🔴 **不得還原成 S1b(20260805170200)的舊句** ——
--      那句本身自相矛盾(「強制點未定案」+「已拍 Q1=A」),還原等於把 bug 放回去。
--      回滾時改寫成下面這句(拍板保留、落地點回到未定):
--        '本箱出貨數量。🔴 強制點 = 摘要表 CHECK oiqs_shipped_le_instock(C9),Sean 2026-08-05 Q1=A 已拍;'
--        '落地片 B2-S2a 已回滾 ⇒ **目前 DB 無強制點**,重新落地前不得放行 shipped > instock。'
-- ------------------------------------------------------------
-- 🔴 **可直接貼的完整回滾交易**(preflight 必須在同一個 BEGIN 內;分開跑 = 檢查與 DROP 之間有窗)
-- BEGIN;
--   DO $ck$
--   DECLARE v_txt text;
--   BEGIN
--     SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_txt
--       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public' AND p.prokind = 'f'
--        AND pg_get_functiondef(p.oid) LIKE '%shipped_quantity%';   -- 🔴 shipment_items 同名欄會一起命中
--     IF v_txt IS NOT NULL THEN
--       RAISE EXCEPTION 'S2A-DOWN-BLOCKED:仍有函式引用 shipped_quantity(%) — 先退大線;\n--         🔴 注意 shipment_items 也有同名欄,命中者可能只是合法讀那一欄,逐支人工判讀後才可繼續', v_txt;
--     END IF;
--   END $ck$;
--   ALTER TABLE public.order_item_quantity_summary
--     DROP CONSTRAINT IF EXISTS oiqs_cancelled_shipped_le_quantity,
--     DROP CONSTRAINT IF EXISTS oiqs_shipped_le_instock,
--     DROP CONSTRAINT IF EXISTS oiqs_shipped_nonneg,
--     DROP COLUMN IF EXISTS shipped_quantity;   -- 🔴 不加 CASCADE
--   -- ── COMMENT 還原五句(逐字,不是 placeholder)──
--   COMMENT ON TABLE public.order_item_quantity_summary IS
--     'E10 A1:訂單品項的數量摘要(衍生值,非真相)。真相在 A2 採購表與 A7 取消明細;本表存在的理由是「列 300 筆訂單時不要每次重算」(master plan Q9=B)。🔴 員工專用:anon/authenticated 零權限 + RLS zero-policy —— Sean 2026-07-31 拍板「不讓客人知道進度、只有狀態顯示」。🔴 任何人不得手填,唯一 writer = A4a 重算 trigger。🔴 惰性建列:無列 = 三個 0,讀取端必須 LEFT JOIN + COALESCE(此約定無 DB 強制力,見欄註解的契約債)。';
--   COMMENT ON COLUMN public.order_item_quantity_summary.quantity IS
--     '🔴 去正規化自 order_items.quantity,由複合 FK (order_item_id, quantity) → order_items(id, quantity) 物理釘死。存在的唯一理由 = 讓**三條直接跟 quantity 比**的不變式成為同表 CHECK(C4/C6/C7;C5 經 ordered 間接比,不計入本數;否則跨表、只能用 trigger 補、繼承 #307 併發債)。不得單獨更新。';
--   COMMENT ON CONSTRAINT order_item_quantity_summary_item_fk ON public.order_item_quantity_summary IS
--     '釘死 quantity 與品項歸屬。🔴 契約債:本表惰性建列,「order_item 沒有對應列 = 三個數量皆 0」這個約定**沒有 DB 強制力** ⇒ A4a 負責建列、A9c/A11a-c 等讀取端一律 LEFT JOIN + COALESCE(…, 0),不得假設列必然存在。';
--   COMMENT ON CONSTRAINT oiqs_instock_cancelled_le_quantity ON public.order_item_quantity_summary IS
--     '§5.1c 第四條。🔴 契約債 ① 的原始字面(cancelled <= quantity - shipped)已於 2026-08-05 被 Sean Q1=A 推翻,不得照做;shipped 欄與 C6′ 隨 B2-S2a 回滾一併移除,重新落地時照 Q1=A 的形狀(C7 不動、另加 C6′)。';
--   COMMENT ON COLUMN public.shipment_items.shipped_quantity IS
--     '本箱出貨數量。🔴 強制點 = 摘要表 CHECK oiqs_shipped_le_instock(C9),Sean 2026-08-05 Q1=A 已拍;落地片 B2-S2a 已回滾 ⇒ **目前 DB 無強制點**,重新落地前不得放行 shipped > instock。';
-- COMMIT;
-- ============================================================
