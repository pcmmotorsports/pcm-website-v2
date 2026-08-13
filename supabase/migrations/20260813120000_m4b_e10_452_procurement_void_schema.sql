-- ============================================================
-- M-4b E10 · 採購「改軟」線 片 2a-1:採購列作廢欄 + 兩處守門述詞
-- ============================================================
--
-- ══════════════════════════════════════════════════════════════════════════
-- 📖 給 Sean 看的三句話(apply 停點的決策依據;不寫術語)
-- ══════════════════════════════════════════════════════════════════════════
--
-- ① **這支 apply 之後,系統的行為不會變。**
--    它只是幫「採購」這張表準備好兩個新欄位(作廢時間、作廢理由),
--    而**目前沒有任何一支程式會去填那兩個欄位** —— 撤銷的按鈕與後端在下一片(2a-2)才做。
--    🔴 **除非有人拿最高權限直接下 SQL**(例如你自己開 Supabase 後台的 SQL 編輯器)。
--    那條路**一直都在**(不是本片開的),本片也**沒有改變它**。
--    ⇒ 對你的意思是:**不會有東西自己跑出來填它**;但**你自己從資料庫後台手動改,還是改得進去**。
--    ⇒ 你現在要判的是「**結構對不對**」,不是「採購撤銷這個功能可不可以上線」。
--    ⇒ 只要沒有人手動去填,全表的作廢欄就恆為空 ⇒ 本片新加的兩個計算條件**恆真**
--      ⇒ 算出來的數字與現在逐字相同。(apply 前會再查一次現況確實是零筆,見「怎麼退」上方的 preflight 那條。)
--
-- ② **出事會怎樣**:apply 的過程若有任何一項驗收不過,整支**當場全部回滾**(不會留半套)。
--    apply 成功之後若要反悔,回退 = 把兩個欄位刪掉、把索引改回原樣(見檔尾「怎麼退」)。
--    🔴 **同一個前提**:只要沒有人手動填過那兩欄,回退時**不會有資料要處理**;
--    但**若有人手動填過**,回退就會遇到資料 —— 而且把索引改回「不分作廢與否」的唯一鍵時,
--    那些列還可能**撞重複鍵**而讓回退失敗。⇒ 回退前要先查一次有沒有人填過(語法見檔尾)。
--
-- ③ **這支動到兩個已經在線上跑的計算**(採購數量的加總),但只加一個條件
--    「**沒有被作廢的才算**」。今天沒有任何一列是作廢的 ⇒ 加了等於沒加。
--    這正是它可以安全先上的原因,也是它必須跟撤銷按鈕分開兩片的原因。
--
-- ══════════════════════════════════════════════════════════════════════════
--
-- 規格:docs/specs/2026-08-13-procurement-undo-plan.md v5(Sean 2026-08-13 拍板 Q1=E)
-- 拍板逐字:`q1: a` / `q2: a, 但是不要增加太多欄位` / `q3: A, 但是到貨的商品要可以轉去庫存那邊`
-- 片型:🔴 高風險片(鐵則 12③ DB 結構)。關卡2 對抗審查不降級。
-- backlog:#462(Q3 附加條件「轉庫存」= 本片不做的下游缺口)
--
-- ── 為什麼是「作廢」而不是「刪除」或「件數歸零」(三選一的結論)──────────────
--   plan v1-v3 先後推薦過硬刪(A)與件數歸零(C′),兩次都被對抗審查打掉:
--   · 硬刪會廢掉 A5a 自己的並發證明(`20260806200000:432-433` 逐字「本表無 DELETE writer
--     ⇒ 不會再空手」;`:450-451` 防衛枝逐字「例如有人加了 DELETE writer」)。
--   · 件數歸零會把「原本訂幾件」抹掉,且把狀態隱式編碼進數量欄。
--   ⇒ 定案 = **照本 repo 既有的 shipments 作廢樣板**(`20260805170000:89-90,149-151`
--     + `20260807200000` void RPC + `20260807210000` unvoid RPC),不重新發明。
--
-- 🔴 **樣板作者自己劃的界,逐字沿用、不改寫**:
--   · `20260805170000:205`:「🔴 **可 unvoid**(清回 NULL,**需同時清 `void_reason`**)。」
--   · `20260805170000:207`:「`void_reason` + 稽核是唯一事後追溯手段。**不得宣稱「作廢有防呆」。**」
--     ⇒ 本片任何一句暗示「作廢比硬刪安全」的話都要配這句讀:安全的是**可追溯**,不是**不會出錯**。
-- ⚠️ 有一條理由**不轉移**:`20260805170000:243`「包裹編號的『永不重用』保證」——
--     採購列沒有對外編號 ⇒ 那個理由對本表不成立。**理由不轉移、實作轉移**,兩件事分開。
--
-- ── 🔴 半個月前的人對今天這一片下的交辦(照做,不只依賴 harness)────────────────
--   `20260809020000_…w7d3_recompute_structural_anchors.sql` 檔頭逐字:
--     「未來任何 `CREATE OR REPLACE` helper 的片(TS > 020000)**不會重新觸發本檔**
--       ⇒ 對『最可能發生的那條路徑』,本檔本身零守門……
--       **未來改 helper 的片,請把本檔的錨複製一份到你自己的檔案裡**,別只依賴 harness。」
--   ⇒ 本片改的正是那支 helper ⇒ **w7d3 的六條錨已逐條複製進本檔步 6**(A1/A2/A4/A5/A6;
--     A3 已被 w7d3 自己刪除,理由是「被 A1 嚴格蘊含 ⇒ 寫不出只紅它的負測」,本片照樣不補)。
--
-- ── 🔴 為什麼用 CREATE OR REPLACE(而 A2b1 檔頭說過「刻意用 CREATE」)──────────────
--   `20260803130000:97-98` 那句的對象是**首建**(防「已存在」時靜默接管別人的 owner 與 ACL)。
--   本片是**蓄意替換既有函式**,而兩支函式都被 trigger 依賴 ⇒ `DROP FUNCTION` 會被依賴擋住、
--   `CASCADE` 會把 trigger 一起刪掉。⇒ 只能 OR REPLACE。先例:`20260806180000:177-178` 逐字
--   「A4a 原檔『禁 OR REPLACE』的紀律對象是**新建**,本片是蓄意替換」。
--   🔴 **判斷可能錯,所以不停在判斷上**:步 6 有一格逐字比對兩支函式的
--   **owner / prosecdef / proconfig 在替換前後未變**(OR REPLACE 保留它們是文件行為,本片當場驗)。
--
-- ── 🔴 前置指紋閘的來源與量法(「hash 落筆必附算法與量法」)──────────────────────
--   **量法逐字** = `md5(pg_get_functiondef('public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure))`
--   —— 是**函式定義**的 md5,不是檔案的 md5,也不是 `prosrc` 的 md5
--   (s2b `:151-152` 逐字說明過為何不用 prosrc:那樣 `search_path` / `lock_timeout` / SECURITY DEFINER 的漂移會隱形)。
--
--   🔴🔴 **本片首版在這裡犯過一次錯,而且是本片自己的閘當場抓到的 —— 留著當紀錄:**
--   首版把 `20260806180000:155` 的 `875af6a6eb091487d519daa9d70b6eab` 直接搬來當前置值。
--   **那個值是 s2b 的【前置】閘,釘的是 s2b 替換【之前】的版本** ——
--   同檔 `:156` 的錯誤訊息裡就寫著「helper 的**三軸**指紋不符」,而現行版是 s2b 加上第四軸(shipped)之後的**四軸**版。
--   ⇒ 我抄了數字、沒讀它旁邊那兩個字。**病根同族:引用一個值之前要先讀它是什麼的值。**
--   本片步 1b 的閘因此當場紅在 `4ac2989…`,錯誤沒有進到 Sean 面前。
--
--   **現行(四軸)指紋 = `4ac2989a58985beae91a491a816086f7`**
--   🔴 **這顆有更強的出處**:s2b 自己在 apply 時就公告過它 —— 重放時的 NOTICE 逐字
--   「S2b 四軸指紋公告(**下一片替換 helper 時 pin 這個**):4ac2989a58985beae91a491a816086f7」。
--   ⇒ 它不只是我量到的,是**上一個改這支函式的人留給下一個人的交接值**,而我量到的與它一致。
--   量法與來源:2026-08-13 於**本機拋棄式 PG 17.10** 依 `scripts/d1t2-rehearsal.sh provision` 的配方
--   (initdb → `scripts/d1-supabase-shim.sql` → 依檔名序套用全部 migration,跳過兩支 pg_cron)
--   重放到本片之前那一刻量得。
--   ⚠️ **誠實邊界(兩條,都不藏)**:
--     ① 這是**本機重放**的值,**不是我連上正式庫量到的**(我沒有正式庫連線)。
--     ② `pg_get_functiondef` 的輸出格式**理論上可能隨 PG 版本而異**;本機是 17.10。
--     ⇒ 若此閘在正式庫 apply 時紅了,**先對帳、不要直接改這個值** ——
--        要先分辨是「真的有人改過函式」還是「格式差異」,兩者的處置完全相反。
--   **本片替換後的新指紋 = `aea744ffb81be829627c978a72d494c3`**(同配方於本機重放實測;
--   步 6g 也會在 apply 當下 RAISE NOTICE 印出來,兩者應一致 —— 不一致就是環境差異的訊號)。
--   ⇒ **下一個要改這支 helper 的人,前置閘請釘 `aea744ffb81be829627c978a72d494c3`**,
--     並且請先讀清楚它是「#452 之後」的版本(這正是本片首版踩過的那個坑)。
--
-- ── 🔴 一條由「推論」升級成「觀察」的事(本片最關鍵的一個假設)────────────────
--   步 3 把業務鍵從 UNIQUE 表約束換成同名 partial unique index,而 A5a 的 unique_violation
--   處理是**比對約束名字**(`20260806200000:435`)。「唯一索引違反時 CONSTRAINT_NAME 會回索引名」
--   原本是我的推論。2026-08-13 於同一個拋棄式庫實測:
--     · 建 `CREATE UNIQUE INDEX z_business_key ON z(a,b) WHERE voided_at IS NULL`
--     · 撞第二筆 → `GET STACKED DIAGNOSTICS CONSTRAINT_NAME` = **`z_business_key`**(索引名)✅
--     · 把第一筆的 voided_at 填上之後,同一組鍵**可以再插一次** ✅(partial 述詞的重點)
--   ⇒ A5a 的重試圈認得出這個名字。**harness 另有一格走真的 A5a 呼叫再驗一次**(型別層與行為層各一)。
--
-- ── 誠實邊界(逐條,不藏)──────────────────────────────────────────────────
--   · `pcm_b2_is_blank` 對三個應用 role **零 EXECUTE**(`20260805170000:77`),
--     而 **CHECK 約束在 DML 當下會檢查函式的 EXECUTE 權限**(2026-08-13 拋棄式庫三發實測)。
--     🔴 本表對應用 role 零寫權、所有寫入走 owner SECDEF RPC ⇒ 今天無害。
--     **但日後若有人給這張表直接寫權,員工會看到的錯誤字串是:**
--         `permission denied for function pcm_b2_is_blank`
--     那是**縱深防禦的副作用、不是 bug**,而它看起來與作廢完全無關 ⇒ 這行字面寫在這裡讓人 grep 得到。
--   · 本片**不建立任何 writer** ⇒ `voided_at` 恆為 NULL。所有「作廢之後會怎樣」的行為
--     **本片一格都沒驗**(物理上構造不出來,那是 2a-2 的驗收範圍)。
--   · `session_replication_role = replica` 仍可跳過 trigger(A2b1 `:85` 同天花板)。
--   · owner / SECURITY DEFINER / 持 owner 憑證者仍可直寫本表(A5a `:90-91` 同界)。
--
-- ── 怎麼退(down;先讀完再動)────────────────────────────────────────────────
--   BEGIN;
--     -- ① 索引改回表約束(本片沒有 writer ⇒ 不會有 voided_at 非 NULL 的列擋著)
--     DROP INDEX public.order_item_procurement_business_key;
--     ALTER TABLE public.order_item_procurement
--       ADD CONSTRAINT order_item_procurement_business_key UNIQUE (order_item_id, supplier_id);
--     -- ② 兩支函式還原成本片之前的版本(逐字取自 20260803130000:102-161 與 20260806180000:180-242)
--     --    🔴 不可只把述詞刪掉了事 —— 還原後要重跑步 6 的錨與指紋閘確認回到原狀。
--     -- ③ 欄位與 CHECK
--     ALTER TABLE public.order_item_procurement DROP CONSTRAINT order_item_procurement_void_pair;
--     ALTER TABLE public.order_item_procurement DROP COLUMN void_reason, DROP COLUMN voided_at;
--   COMMIT;
--
--   🔴 **回退前先跑這一句**(關卡2 M2:若有人手動填過,回退會遇到資料、還可能撞重複鍵):
--     SELECT count(*) FROM public.order_item_procurement WHERE voided_at IS NOT NULL;   -- 必須 = 0
--     -- >0 ⇒ **停**。要先決定那幾列怎麼處置(它們在回退後會變成「作廢資訊消失但列還在」),
--     --      而且同 (order_item_id, supplier_id) 若有兩列,①的 ADD CONSTRAINT 會直接失敗。
--   🔴 ①之後要把約束註解一併還原(關卡2 nit:照原指引退回,catalog 不是原樣):
--     COMMENT ON CONSTRAINT order_item_procurement_business_key ON public.order_item_procurement IS
--       (原文逐字取自 20260801150000:173-183,退回時照抄回去)
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ── 步 1. 前置閘(fail-closed;任一條不成立 = 整支回滾)────────────────────────
DO $gate$
DECLARE
  v_md5    text;
  v_owner  text;
  v_secdef boolean;
  v_cfg    text;
  v_def    text;
  v_cnt    integer;
BEGIN
  -- 1a. 兩支被替換的函式各自 overload 恰 1(打在不存在或多載的東西上 ⇒ 後面全部恆真)
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname = 'pcm_a4a_recompute_order_item_summary';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '452 前置閘 1a:pcm_a4a_recompute_order_item_summary 的 overload 數 = %(需恰 1)', v_cnt
      USING ERRCODE = 'P2B10';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname = 'pcm_a2b1_procurement_allocation_guard';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '452 前置閘 1a:pcm_a2b1_procurement_allocation_guard 的 overload 數 = %(需恰 1)', v_cnt
      USING ERRCODE = 'P2B10';
  END IF;

  -- 1b. A4a helper 指紋(值與量法的來源見檔頭)
  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(
           'public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure)) INTO v_md5;
  IF v_md5 <> '4ac2989a58985beae91a491a816086f7' THEN
    RAISE EXCEPTION '452 前置閘 1b:A4a helper 指紋不符(實得 %,預期 4ac2989a58985beae91a491a816086f7 = s2b 之後的四軸版)。'
                    '它已被別的片改過 ⇒ 本片的 CREATE OR REPLACE 會蓋掉那些改動。停下來對帳,不要直接改這個值。', v_md5
      USING ERRCODE = 'P2B10';
  END IF;

  -- 1c. 🔴 A2b1 的**替換前整支指紋**(關卡2 M1;本片首版的洞就在這裡)
  --
  --   首版只用「三行 SUM 的結構錨」,理由寫的是「沒有現成的釘值 md5 可引」。
  --   🔴 **那個理由是錯的,而且錯法值得留著**:s2b 那顆 md5 也是有人第一次量出來釘上去的
  --   ——「這裡沒有現成的可以引」不是不做的理由,**所有現成的都是有人第一次做的**。
  --   那句話長得像謹慎(不亂發明),實際是**降級**(退到一個更弱的守門)。
  --   後果很具體:三行 SUM 以外的任何改動它都看不到,而本片是**整支 269 行 OR REPLACE**
  --   ⇒ 正式庫若在別處長出新守門,會被本片**靜默覆蓋**。
  --
  --   量法逐字 = `md5(pg_get_functiondef('public.pcm_a2b1_procurement_allocation_guard()'::regprocedure))`
  --   值的來源 = 2026-08-13 本機拋棄式 PG 17.10,依 d1t2-rehearsal 配方重放**到本片之前那一刻**量得。
  --   ⚠️ 同 1b 的兩條誠實邊界:①本機重放值、**不是正式庫量得** ②`pg_get_functiondef` 格式
  --      理論上可能隨 PG 版本異。🔴 **此閘若在正式庫紅了:先對帳、不要直接改這個值** ——
  --      要先分辨「真的有人改過函式」與「格式差異」,兩者處置完全相反。
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(
       'public.pcm_a2b1_procurement_allocation_guard()'::regprocedure))
     <> '39b9c3a446ad043c9681b0317f3e1961' THEN
    RAISE EXCEPTION '452 前置閘 1c:A2b1 守門的**整支**指紋不符(實得 %,預期 39b9c3a446ad043c9681b0317f3e1961)。'
                    '本片是整支 OR REPLACE ⇒ 繼續下去會把它現在的樣子覆蓋掉。停下來對帳,不要直接改這個值。',
      pg_catalog.md5(pg_catalog.pg_get_functiondef(
        'public.pcm_a2b1_procurement_allocation_guard()'::regprocedure))
      USING ERRCODE = 'P2B10';
  END IF;

  -- 1c-2. 三行 SUM 的結構錨**保留但降級**:它不再是守門,是**錯誤訊息的線索**
  --      (指紋紅的時候,這條能多告訴你一句「連我要改的那一句都不見了」)。
  v_def := pg_catalog.pg_get_functiondef(
             'public.pcm_a2b1_procurement_allocation_guard()'::regprocedure);
  IF pg_catalog.strpos(v_def,
       E'SELECT COALESCE(sum(p.allocated_quantity), 0) INTO v_alloc\n    FROM public.order_item_procurement p\n   WHERE p.order_item_id = NEW.order_item_id;') = 0 THEN
    RAISE EXCEPTION '452 前置閘 1c:A2b1 守門裡找不到我要改的那一整句採購 SUM(三行相連)⇒ 它的形狀已經變了,拒繼續'
      USING ERRCODE = 'P2B10';
  END IF;

  -- 1d. 兩支函式的 owner / secdef / proconfig(替換後要逐字比對「沒被改掉」)
  SELECT pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef,
         COALESCE(pg_catalog.array_to_string(p.proconfig, ','), '<null>')
    INTO v_owner, v_secdef, v_cfg
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure;
  IF v_owner <> 'postgres' OR NOT v_secdef
     OR v_cfg <> 'search_path=public, pg_temp,lock_timeout=5s' THEN
    RAISE EXCEPTION '452 前置閘 1d:A4a helper 的 owner/secdef/proconfig 不符(% / % / %)', v_owner, v_secdef, v_cfg
      USING ERRCODE = 'P2B10';
  END IF;

  -- 1e. 業務鍵目前是**表約束**(本片要把它換成 partial unique index;若它已經是索引 = 有人先做過)
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_procurement'::regclass
     AND conname = 'order_item_procurement_business_key' AND contype = 'u';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '452 前置閘 1e:order_item_procurement_business_key 不是唯一表約束(找到 % 筆)⇒ 有人先動過,拒繼續', v_cnt
      USING ERRCODE = 'P2B10';
  END IF;

  -- 1f. 作廢欄尚不存在(重複 apply 的防呆)
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_attribute
   WHERE attrelid = 'public.order_item_procurement'::regclass
     AND attname IN ('voided_at', 'void_reason') AND NOT attisdropped;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '452 前置閘 1f:作廢欄已存在(% 個)⇒ 本片可能已 apply 過,拒重複', v_cnt
      USING ERRCODE = 'P2B10';
  END IF;

  -- 1g. 配對 CHECK 要用的 helper 存在且簽章唯一
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'pcm_b2_is_blank';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '452 前置閘 1g:public.pcm_b2_is_blank 的 overload 數 = %(需恰 1)', v_cnt
      USING ERRCODE = 'P2B10';
  END IF;

  RAISE NOTICE '452 前置閘全數通過(A4a 指紋 % / A2b1 結構錨 / 業務鍵仍是表約束 / 作廢欄尚不存在 / b2_is_blank 就位)', v_md5;
END
$gate$;

-- ── 步 2. 兩個作廢欄 + 配對 CHECK ────────────────────────────────────────────
-- 🔴 **只加兩欄**(Sean 2026-08-13 明文約束「不要增加太多欄位」)。
--    ~~voided_by~~ **刻意不加**:shipments 樣板同樣只有兩欄(`20260805170000:89-90`,
--    全檔 `voided_by` / `deleted_by` 零命中)。「誰撤的」走 admin_audit_log,由 2a-2 的 RPC 同交易寫。
ALTER TABLE public.order_item_procurement
  ADD COLUMN voided_at   timestamptz,
  ADD COLUMN void_reason text;

-- 配對 CHECK:形狀**逐字照抄** `shipments_void_pair`(`20260805170000:149-151`)。
-- 一條 CHECK 兩件事:①兩欄同進同出 ②理由不得是純空白(含全形空白與零寬 —— 那是 pcm_b2_is_blank 的職責)。
ALTER TABLE public.order_item_procurement
  ADD CONSTRAINT order_item_procurement_void_pair
    CHECK ((voided_at IS NULL) = (void_reason IS NULL)
           AND (void_reason IS NULL OR NOT public.pcm_b2_is_blank(void_reason)));

COMMENT ON COLUMN public.order_item_procurement.voided_at IS
  '這筆採購被作廢的時間(NULL = 還在生效)。🔴 可 unvoid(清回 NULL,**需同時清 void_reason** —— '
  '語意逐字沿用 shipments 樣板 20260805170000:205,本片不自己發明)。'
  '🔴 作廢的採購列**不算進任何額度**:A2b1 跨列總量守門與 A4a 三軸重算都只 SUM voided_at IS NULL 的列。'
  '⚠️ void_reason + 稽核是唯一事後追溯手段;**不得宣稱「作廢有防呆」**(樣板 20260805170000:207 逐字)。';
COMMENT ON COLUMN public.order_item_procurement.void_reason IS
  '作廢理由(與 voided_at 由 order_item_procurement_void_pair 雙向配對;不得純空白)。'
  '「誰撤的」不在本表 —— 走 admin_audit_log(Sean 2026-08-13「不要增加太多欄位」⇒ 只加兩欄)。';
COMMENT ON CONSTRAINT order_item_procurement_void_pair ON public.order_item_procurement IS
  '形狀逐字照抄 shipments_void_pair(20260805170000:149-151)。'
  '🔴 它會呼叫 public.pcm_b2_is_blank,而該函式對三個應用 role 零 EXECUTE(20260805170000:77);'
  'CHECK 在 DML 當下會檢查 EXECUTE 權限 ⇒ 若日後有人給本表直接寫權,寫入會噴 '
  '「permission denied for function pcm_b2_is_blank」這個看似與作廢無關的錯。'
  '那是縱深防禦的副作用、不是 bug(本表所有寫入本應走 owner SECDEF RPC)。';

-- ── 步 3. 業務鍵:表約束 → **同名** partial unique index ──────────────────────
-- 🔴 為什麼一定要換:作廢後對同一家供應商重下單會撞舊的 UNIQUE(order_item_id, supplier_id)。
-- 🔴 為什麼是 index 不是 constraint:PG 的 UNIQUE **表約束不支援 WHERE**。
-- 🔴🔴 **名字必須一模一樣**:A5a 的 unique_violation 處理是**比對約束名字**
--    (`20260806200000:435` 逐字 `IF v_con IS DISTINCT FROM 'order_item_procurement_business_key' THEN RAISE;`)
--    —— 唯一索引違反時 `GET STACKED DIAGNOSTICS CONSTRAINT_NAME` 回的是**索引名**,
--    所以沿用同名可讓 A5a 的重試圈繼續認得它。
--    ⚠️ **這一段是推論,不是我在這裡驗到的** —— 它由 harness 的「真的撞一次」那格負責變成觀察。
--    本步只保證名字一致;**行為等價由 harness 頂著**。
ALTER TABLE public.order_item_procurement
  DROP CONSTRAINT order_item_procurement_business_key;

CREATE UNIQUE INDEX order_item_procurement_business_key
  ON public.order_item_procurement (order_item_id, supplier_id)
  WHERE voided_at IS NULL;

COMMENT ON INDEX public.order_item_procurement_business_key IS
  'A5a 的 upsert 業務鍵。🔴 2026-08-13(#452)起由 UNIQUE 表約束改為 **partial unique index**'
  '(WHERE voided_at IS NULL)—— 作廢後對同一家供應商重下單不得撞鍵。'
  '🔴 **名字不可更改**:A5a 的 unique_violation 處理比對的就是這個名字(20260806200000:435)。'
  '⚠️ 換成索引之後 pg_constraint 不再有這一列;任何靠 pg_constraint 找它的斷言都要改看 pg_index。';

-- ── 步 4. A2b1 跨列總量守門:SUM 只算未作廢的列 ──────────────────────────────
-- 🔴 逐字取自 `20260803130000:102-161`,**只改一行**(採購 SUM 加 `AND p.voided_at IS NULL`)。
--    其餘一個字都沒動 —— 步 6 的 owner/secdef/proconfig 比對頂著這句話。
CREATE OR REPLACE FUNCTION public.pcm_a2b1_procurement_allocation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  v_qty       bigint;   -- 🔴 三個變數全 bigint:危險在變數宣告不在表達式
  v_alloc     bigint;   --    (SUM(integer) 本回 bigint;窄化任一個 = B10 紅在 22003)
  v_cancelled bigint;
BEGIN
  -- ① 隔離閘(Q1=A + Q3=A gate-first):非 read committed 一律拒收。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'A2b1 隔離閘:守門僅在 read committed 下健全(目前 = %);拒收',
      pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'a2b1_isolation_read_committed_only';
  END IF;

  -- ② skip:同 parent 且未調升 ⇒ 不守(row 28 delta 語意:調降/持平放行)。
  IF TG_OP = 'UPDATE'
     AND NEW.order_item_id = OLD.order_item_id
     AND NEW.allocated_quantity <= OLD.allocated_quantity THEN
    RETURN NULL;
  END IF;

  -- ③ 鎖 parent(NKU;守門互斥的承重)。
  SELECT oi.quantity INTO v_qty
    FROM public.order_items oi
   WHERE oi.id = NEW.order_item_id
   FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A2b1 防衛枝:order_items % 不存在(FK 應已先擋;此枝理論不可達)',
      NEW.order_item_id;
  END IF;

  -- ④ 真相表重算(AFTER ⇒ 採購 SUM 已含 NEW 列)。
  -- 🔴 #452 起加 `AND p.voided_at IS NULL`:作廢的採購列不佔額度。
  --    今天沒有任何 writer 能把 voided_at 寫成非 NULL ⇒ 本述詞恆真 ⇒ 與改動前逐字等價。
  SELECT COALESCE(sum(p.allocated_quantity), 0) INTO v_alloc
    FROM public.order_item_procurement p
   WHERE p.order_item_id = NEW.order_item_id
     AND p.voided_at IS NULL;

  SELECT COALESCE(sum(c.cancelled_quantity), 0) INTO v_cancelled
    FROM public.order_cancellation_items c
   WHERE c.order_item_id = NEW.order_item_id;

  -- ⑤ 總量守門:恰好用滿合法(>,不是 >=)。
  IF v_alloc > v_qty - v_cancelled THEN
    RAISE EXCEPTION 'A2b1 超量:品項 % 採購合計 % 超過可訂購 %(quantity=% − 已取消=%)',
      NEW.order_item_id, v_alloc, v_qty - v_cancelled, v_qty, v_cancelled
      USING ERRCODE = 'P2B01', CONSTRAINT = 'a2b1_allocation_within_orderable';
  END IF;

  RETURN NULL;
END
$$;

-- ── 步 5. A4a 三軸重算 helper:ordered 軸只算未作廢的列 ───────────────────────
-- 🔴 逐字取自 `20260806180000:180-242`,**只改一行**(ordered 軸 SUM 加 `AND p.voided_at IS NULL`)。
-- 🔴 `SHIPPED-TRUTH-BEGIN/END` 標記與其內容**一個字都沒動**(s2b `:220-229` 的五處同步守門靠它)。
CREATE OR REPLACE FUNCTION public.pcm_a4a_recompute_order_item_summary(p_order_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '5s'
AS $$
DECLARE
  v_qty       bigint;
  v_ordered   bigint;
  v_instock   bigint;
  v_cancelled bigint;
  v_shipped   bigint;
BEGIN
  SELECT oi.quantity INTO v_qty
    FROM public.order_items oi
   WHERE oi.id = p_order_item_id
   FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A4a 防衛枝:order_items % 不存在(FK 應已先擋;此枝理論不可達)',
      p_order_item_id;
  END IF;

  -- 🔴 #452 起加 `AND p.voided_at IS NULL`:作廢的採購列不算進 ordered 軸。
  --    今天沒有 writer 能寫 voided_at ⇒ 本述詞恆真 ⇒ 與改動前逐字等價。
  SELECT COALESCE(sum(p.allocated_quantity), 0) INTO v_ordered
    FROM public.order_item_procurement p
   WHERE p.order_item_id = p_order_item_id
     AND p.voided_at IS NULL;

  SELECT COALESCE(sum(r.quantity), 0) INTO v_instock
    FROM public.order_item_procurement_receipts r
    JOIN public.order_item_procurement p2 ON p2.id = r.procurement_id
   WHERE p2.order_item_id = p_order_item_id;

  SELECT COALESCE(sum(c.cancelled_quantity), 0) INTO v_cancelled
    FROM public.order_cancellation_items c
   WHERE c.order_item_id = p_order_item_id;

  -- SHIPPED-TRUTH-BEGIN
  SELECT COALESCE(sum(si.shipped_quantity), 0) INTO v_shipped
    FROM public.shipment_items si
    JOIN public.shipments s ON s.id = si.shipment_id
   WHERE si.order_item_id = p_order_item_id
     AND s.deleted_at IS NULL
     AND s.shipped_at IS NOT NULL;
  -- SHIPPED-TRUTH-END

  INSERT INTO public.order_item_quantity_summary
    (order_item_id, quantity, ordered_quantity, instock_quantity, cancelled_quantity, shipped_quantity)
  VALUES (p_order_item_id, v_qty, v_ordered, v_instock, v_cancelled, v_shipped)
  ON CONFLICT (order_item_id) DO UPDATE
    SET quantity           = EXCLUDED.quantity,
        ordered_quantity   = EXCLUDED.ordered_quantity,
        instock_quantity   = EXCLUDED.instock_quantity,
        cancelled_quantity = EXCLUDED.cancelled_quantity,
        shipped_quantity   = EXCLUDED.shipped_quantity;
END
$$;

-- ── 步 6. 收工驗收(fail-closed;含 w7d3 六條錨的複製本)──────────────────────
DO $verify$
DECLARE
  v_raw   text;
  v_def   text;
  v_lock  int;
  v_ups   int;
  v_cnt   integer;
  v_owner text;
  v_sec   boolean;
  v_cfg   text;
  v_md5   text;
  v_pred  text;
BEGIN
  -- ══ 6a. 兩支函式的 owner / secdef / proconfig 未被 OR REPLACE 改掉 ══════════
  --    (檔頭那個「OR REPLACE 對後續 patch 適用」的判斷,由這一格頂著)
  FOR v_owner, v_sec, v_cfg IN
    SELECT pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef,
           COALESCE(pg_catalog.array_to_string(p.proconfig, ','), '<null>')
      FROM pg_catalog.pg_proc p
     WHERE p.oid IN ('public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure,
                     'public.pcm_a2b1_procurement_allocation_guard()'::regprocedure)
  LOOP
    IF v_owner <> 'postgres' OR NOT v_sec
       OR v_cfg <> 'search_path=public, pg_temp,lock_timeout=5s' THEN
      RAISE EXCEPTION '452 驗收 6a:替換後 owner/secdef/proconfig 被改掉(% / % / %)', v_owner, v_sec, v_cfg;
    END IF;
  END LOOP;
  -- 🔴 6a-2(關卡2 important):首版沒讀 `proacl` ⇒ 「OR REPLACE 保留 ACL」只是引官方文件,**沒有當場驗**。
  --    官方保證的是「保留」,不保證「保留的是對的」—— 若替換前就已經有 PUBLIC EXECUTE,兩支都會綠。
  --    ⇒ 直接釘終態:兩支的 proacl 都必須恰為 owner 自己的 EXECUTE、零外部 grantee。
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_proc p
   WHERE p.oid IN ('public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure,
                   'public.pcm_a2b1_procurement_allocation_guard()'::regprocedure)
     AND COALESCE(pg_catalog.array_to_string(p.proacl, ','), '<null>') = 'postgres=X/postgres';
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION '452 驗收 6a-2:兩支函式的 proacl 不是「只有 owner 的 EXECUTE」(符合的只有 % 支)', v_cnt;
  END IF;

  -- ══ 6b. 兩處新述詞真的在函式體裡(不是我以為有加)═══════════════════════════
  v_def := pg_catalog.pg_get_functiondef('public.pcm_a2b1_procurement_allocation_guard()'::regprocedure);
  IF pg_catalog.strpos(v_def, 'AND p.voided_at IS NULL') = 0 THEN
    RAISE EXCEPTION '452 驗收 6b:A2b1 守門的採購 SUM 沒有 voided_at 述詞';
  END IF;

  v_raw := pg_catalog.pg_get_functiondef('public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure);
  v_def := pg_catalog.regexp_replace(v_raw, '/\*.*?\*/', '', 'gs');
  v_def := pg_catalog.regexp_replace(v_def, '--[^\n]*',   '', 'g');
  IF pg_catalog.length(v_def) < pg_catalog.length(v_raw) / 2 THEN
    RAISE EXCEPTION '452 驗收:剝註解後長度剩 %/%(不到一半)⇒ 剝法可能有錯,拒繼續',
      pg_catalog.length(v_def), pg_catalog.length(v_raw);
  END IF;
  IF pg_catalog.strpos(v_def, 'AND p.voided_at IS NULL') = 0 THEN
    RAISE EXCEPTION '452 驗收 6b:A4a helper 的 ordered 軸沒有 voided_at 述詞(且不在註解裡)';
  END IF;
  -- 🔴 述詞恰一次:多一份(例如順手也加到 instock 軸)語意就變了,要有人看
  IF (pg_catalog.length(v_def)
      - pg_catalog.length(pg_catalog.replace(v_def, 'voided_at IS NULL', '')))
     / pg_catalog.length('voided_at IS NULL') <> 1 THEN
    RAISE EXCEPTION '452 驗收 6b:A4a helper 裡 voided_at IS NULL 出現 % 次(需恰 1;instock 軸刻意不加)',
      (pg_catalog.length(v_def)
       - pg_catalog.length(pg_catalog.replace(v_def, 'voided_at IS NULL', '')))
      / pg_catalog.length('voided_at IS NULL');
  END IF;

  -- ══ 6c. 🔴 w7d3 六條錨的複製本(逐條照抄 20260809020000;交辦逐字見檔頭)═════
  --    A1 鎖序不變式
  v_lock := pg_catalog.strpos(
              v_def,
              E'FROM public.order_items oi\n   WHERE oi.id = p_order_item_id\n   FOR NO KEY UPDATE;');
  v_ups  := pg_catalog.strpos(v_def, 'INSERT INTO public.order_item_quantity_summary');
  IF v_lock = 0 THEN
    RAISE EXCEPTION '452/w7d3 錨 A1:找不到「鎖 order_items 的那一整句」⇒ 重算不再互斥,W7d-2 撤片理由失效'
      USING ERRCODE = 'P2B12';
  END IF;
  IF (pg_catalog.length(v_def)
      - pg_catalog.length(pg_catalog.replace(v_def, 'FOR NO KEY UPDATE', '')))
     / pg_catalog.length('FOR NO KEY UPDATE') <> 1 THEN
    RAISE EXCEPTION '452/w7d3 錨 A1:FOR NO KEY UPDATE 出現次數不是 1' USING ERRCODE = 'P2B12';
  END IF;
  IF (pg_catalog.length(v_def)
      - pg_catalog.length(pg_catalog.replace(v_def, 'order_item_quantity_summary', '')))
     / pg_catalog.length('order_item_quantity_summary') <> 1 THEN
    RAISE EXCEPTION '452/w7d3 錨 A1:order_item_quantity_summary 出現次數不是 1' USING ERRCODE = 'P2B12';
  END IF;
  IF v_ups = 0 THEN
    RAISE EXCEPTION '452/w7d3 錨 A1:找不到 oiqs 的 upsert ⇒ 錨打空' USING ERRCODE = 'P2B12';
  END IF;
  IF v_lock >= v_ups THEN
    RAISE EXCEPTION '452/w7d3 錨 A1:鎖序反了(鎖 % / upsert %)', v_lock, v_ups USING ERRCODE = 'P2B12';
  END IF;
  --    A2 鎖原語不得退回 FOR UPDATE
  IF pg_catalog.strpos(v_def, 'FOR UPDATE') <> 0 THEN
    RAISE EXCEPTION '452/w7d3 錨 A2:helper 出現 FOR UPDATE(應一律 FOR NO KEY UPDATE)' USING ERRCODE = 'P2B12';
  END IF;
  --    A3 已被 w7d3 自己刪除(被 A1 嚴格蘊含 ⇒ 寫不出只紅它的負測)⇒ 本片照樣不補
  --    A4 第四軸兩個述詞
  IF pg_catalog.strpos(v_def, 's.deleted_at IS NULL') = 0 THEN
    RAISE EXCEPTION '452/w7d3 錨 A4:第四軸少了 s.deleted_at IS NULL' USING ERRCODE = 'P2B12';
  END IF;
  IF pg_catalog.strpos(v_def, 's.shipped_at IS NOT NULL') = 0 THEN
    RAISE EXCEPTION '452/w7d3 錨 A4:第四軸少了 s.shipped_at IS NOT NULL' USING ERRCODE = 'P2B12';
  END IF;
  --    A5 instock 走 receipts 直讀、不吃累計欄
  IF pg_catalog.strpos(v_def, 'FROM public.order_item_procurement_receipts r') = 0 THEN
    RAISE EXCEPTION '452/w7d3 錨 A5:instock 不再走 receipts 直讀' USING ERRCODE = 'P2B12';
  END IF;
  IF pg_catalog.strpos(v_def, 'received_quantity') <> 0 THEN
    RAISE EXCEPTION '452/w7d3 錨 A5:helper 出現 received_quantity ⇒ 摘要改吃累計欄' USING ERRCODE = 'P2B12';
  END IF;
  --    A6 冪等 upsert
  IF pg_catalog.strpos(v_def, 'ON CONFLICT (order_item_id) DO UPDATE') = 0 THEN
    RAISE EXCEPTION '452/w7d3 錨 A6:oiqs 寫入不是冪等 upsert' USING ERRCODE = 'P2B12';
  END IF;

  -- ══ 6d. 業務鍵:表約束已消失、同名 partial unique index 已就位 ═══════════════
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_procurement'::regclass
     AND conname = 'order_item_procurement_business_key';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '452 驗收 6d:pg_constraint 仍有 order_item_procurement_business_key(% 筆)', v_cnt;
  END IF;
  SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO v_pred
    FROM pg_catalog.pg_index i
   WHERE i.indrelid = 'public.order_item_procurement'::regclass
     AND i.indexrelid = 'public.order_item_procurement_business_key'::regclass;
  -- 🔴 逐字比對整條 indexdef,不是只看「有沒有 WHERE」——
  --    欄序寫反、少了 UNIQUE、述詞寫成 `IS NOT NULL` 都要當場紅。
  IF v_pred IS DISTINCT FROM
     'CREATE UNIQUE INDEX order_item_procurement_business_key ON public.order_item_procurement USING btree (order_item_id, supplier_id) WHERE (voided_at IS NULL)' THEN
    RAISE EXCEPTION '452 驗收 6d:業務鍵索引定義不符,實得 [%]', COALESCE(v_pred, '(不存在)');
  END IF;

  -- ══ 6e. 「恆真」要被證明,不是被宣稱(主視窗指定的兩格之一)═════════════════
  SELECT count(*) INTO v_cnt FROM public.order_item_procurement WHERE voided_at IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '452 驗收 6e:竟有 % 列 voided_at 非 NULL —— 本片不建立任何 writer,這不該發生', v_cnt;
  END IF;
  -- 沒有 writer:三個應用 role 對本表零寫權(本片沒有動 ACL,這格證明它沒被順手動到)
  SELECT count(*) INTO v_cnt
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rn)
   CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(pv)
   WHERE pg_catalog.has_table_privilege(r.rn, 'public.order_item_procurement', p.pv);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '452 驗收 6e:三個應用 role 對本表有 % 個寫權組合(需 0)⇒「沒有 writer」的前提不成立', v_cnt;
  END IF;

  -- ══ 6f. 配對 CHECK 的定義逐字 ═══════════════════════════════════════════════
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_pred FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.order_item_procurement'::regclass
     AND conname = 'order_item_procurement_void_pair';
  IF v_pred IS NULL
     OR pg_catalog.strpos(v_pred, 'voided_at IS NULL') = 0
     OR pg_catalog.strpos(v_pred, 'void_reason IS NULL') = 0
     OR pg_catalog.strpos(v_pred, 'pcm_b2_is_blank') = 0 THEN
    RAISE EXCEPTION '452 驗收 6f:配對 CHECK 定義不符,實得 [%]', COALESCE(v_pred, '(不存在)');
  END IF;

  -- ══ 6g. 新指紋(給下一個改 helper 的人當前置值;量法 = md5(pg_get_functiondef))═
  SELECT pg_catalog.md5(pg_catalog.pg_get_functiondef(
           'public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure)) INTO v_md5;
  RAISE NOTICE '452 收工:A4a helper 的**新**指紋 = %(量法 = md5(pg_get_functiondef(…::regprocedure)),不是檔案 md5)', v_md5;
  RAISE NOTICE '452 收工驗收全過:兩欄+配對 CHECK / 業務鍵已換同名 partial unique index / 兩處述詞各恰一次 / w7d3 六條錨全綠 / voided_at 非 NULL 列數 = 0';
END
$verify$;

COMMIT;
