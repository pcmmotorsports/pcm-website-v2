-- ============================================================
-- M-4b E10 · N3a:共用產號 helper `public.pcm_generate_display_id()`
-- ============================================================
-- 規格:docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md §5.4a(產號合約,不得改寫)
--       docs/specs/2026-07-30-n3a-n3b-display-id-generator-plan.md §2(本片設計與探針定案)
-- 拍板:Sean 2026-07-30 Q1=A —— 只換產號器,既有舊格式訂單完全不動、兩格式永久並存。
-- 片型 T(建 DB 函式;無 schema 變更、無 trigger、無資料異動、零 app 行為)。
--
-- 本片只做一件事:建一支「回傳一個符合新格式的候選單號」的函式。
--   · **不查表、不保證唯一性** —— 唯一性由 `orders_display_id_key` + N3b 的重試迴圈負責。
--     (§5.4a 逐字:helper 只回候選值,不可能捕捉 INSERT 的 unique violation。)
--   · **本片零呼叫端** ⇒ 單獨套用完全安全、結帳行為零變化。N3b 才接上。
--     (刻意讓 helper 先於消費端存在:規格 R1/R2/R3/R5 四次點名;`shipment_reference` 之後也要用它。)
--
-- 🔴 依賴:pgcrypto 的 `extensions.gen_random_bytes()`。
--    正式站實查(2026-07-30)= pgcrypto 1.3 @ schema `extensions` ✅
--    但 `supabase/migrations/` 內**零 `CREATE EXTENSION`**(= #299 同一病灶)⇒
--    新環境不會自動有它。本片**不自行 CREATE EXTENSION**(那是平台層決定、且 postgres 非 superuser),
--    改為 apply-time **硬斷言 + fail-closed**:沒有它就當場吵、不靜默降級。
--    隔離演練環境由 `scripts/d1-supabase-shim.sql` 補建(已於 2026-07-30 實跑證實必要)。
--
-- ── 回滾 ──────────────────────────────────────────────────────
-- Supabase 是 forward-only,不要手動 DROP(否則 ledger 不同步、後續 db push 會跳過本片)。
-- 要回滾請新增版本號更大的 migration:
--   DO $$ BEGIN
--     -- 🔴 **n3(關卡2-B):不要用 pg_depend 當防呆** —— plpgsql 的函式體是純文字,
--     --    呼叫另一支函式**不會**建立 pg_depend 依賴 ⇒ 那種查詢對 create_order 恆為空、
--     --    等於給一個假保證(防護命名超過它的實際能力)。唯一可靠的是掃函式體字面:
--     IF EXISTS (SELECT 1 FROM pg_proc
--                 WHERE pronamespace = 'public'::regnamespace
--                   AND prosrc LIKE '%pcm_generate_display_id%'
--                   AND proname <> 'pcm_generate_display_id') THEN
--       RAISE EXCEPTION '仍有函式在呼叫 pcm_generate_display_id — 先處理呼叫端(至少含 create_order)';
--     END IF;
--   END $$;
--   DROP FUNCTION public.pcm_generate_display_id();
-- ⚠️ 但 N3b 上線後**沒有理由回滾本片** —— 它無呼叫端時完全無害,留著即可。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ── 0. 前置閘:pgcrypto 必須就位(破壞性動作之前,不是之後)────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    RAISE EXCEPTION 'N3a 前置閘失敗 — pgcrypto 未安裝。本片的產號依賴 extensions.gen_random_bytes();'
                    ' Supabase 平台請於 Dashboard 啟用,隔離演練環境見 scripts/d1-supabase-shim.sql';
  END IF;
  -- 只確認「裝了」不夠:必須確認它就在 `extensions` schema、函式解析得到。
  -- (本片全程 search_path='',所有引用都是 schema-qualified ⇒ 裝在別的 schema 一樣會失敗。)
  IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION 'N3a 前置閘失敗 — extensions.gen_random_bytes(integer) 解析不到。'
                    ' pgcrypto 可能裝在別的 schema(正式站實查為 extensions);請對齊後重跑';
  END IF;
END
$$;

-- ── 1. 產號函式 ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pcm_generate_display_id()
RETURNS text
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
  -- §5.4a 字母表:36 英數 −(0,O,1,I,L 易混淆)−(A,E,U 母音)= 28 字元、大寫 only。
  c_alphabet  constant text    := '23456789BCDFGHJKMNPQRSTVWXYZ';
  c_len       constant integer := 6;      -- §5.4a 固定 6 碼、無前綴
  -- rejection sampling 門檻:256 = 9×28 + 4 ⇒ byte 0..251 均勻對應 28 格(每格 9 個),
  -- byte 252..255 必須丟棄。🔴 寫成 253 只多收 byte 252(→ 字母表第 1 個字元),
  --    會讓 `2` 多 1/9 權重 —— 而 regex / 長度 / 不退化 / 函式自我驗證**全都抓不到**
  --    (產出的每個字元都合法、長度也對,只是分布偏了),
  --    只有本片的卡方探針(3.4 的探針 3)抓得到:隔離庫多次實跑 chi2 落在 **100 以上**(實測 101 / 129 / 149 / 161 / 181),門檻 82。
  --    ⚠️ 卡方是隨機量、每次不同 ⇒ 註解只記範圍,不記單次數字(記死了必然漂移)。
  c_reject_at constant integer := 252;
  -- 每批抽 16 bytes;每 byte 可用率 252/256 = 98.4% ⇒ 一批湊不滿 6 碼的機率極低。
  c_batch     constant integer := 16;
  -- 抽取批次上限:防「RNG 病態時無界迴圈掛住結帳連線」。正常路徑第 1 批就湊滿。
  c_max_draws constant integer := 16;
  v_out    text    := '';
  v_bytes  bytea;
  v_b      integer;
  v_i      integer;
  v_draws  integer := 0;
BEGIN
  WHILE pg_catalog.length(v_out) < c_len LOOP
    v_draws := v_draws + 1;
    IF v_draws > c_max_draws THEN
      -- 不靜默、不降級:寧可讓呼叫端看到明確錯誤,也不回一個短的/可預測的號碼。
      RAISE EXCEPTION 'pcm_generate_display_id: 亂數抽取批次用盡(% 批仍湊不滿 % 碼)'
                      ' (pcm_display_id_rng_exhausted)', c_max_draws, c_len
        USING ERRCODE = 'P0001';
    END IF;

    v_bytes := extensions.gen_random_bytes(c_batch);

    FOR v_i IN 0 .. c_batch - 1 LOOP
      EXIT WHEN pg_catalog.length(v_out) >= c_len;
      v_b := pg_catalog.get_byte(v_bytes, v_i);          -- get_byte 是 0-indexed
      CONTINUE WHEN v_b >= c_reject_at;                  -- rejection sampling(禁 % 28 直取)
      v_out := v_out || pg_catalog.substr(c_alphabet, (v_b % 28) + 1, 1);  -- substr 是 1-indexed
    END LOOP;
  END LOOP;

  -- 自我驗證:函式不該把不符合約的值交出去(下游 CHECK 是第二道防線、不是第一道)。
  IF v_out !~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$' THEN
    RAISE EXCEPTION 'pcm_generate_display_id: 產出不符 §5.4a 合約(%)', v_out
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_out;
END;
$fn$;

COMMENT ON FUNCTION public.pcm_generate_display_id() IS
  'E10 N3a:產一個符合 v2 §5.4a 合約的訂單編號候選值(28 字元字母表 23456789BCDFGHJKMNPQRSTVWXYZ、固定 6 碼、無前綴)。亂數源 = pgcrypto extensions.gen_random_bytes(禁 random(),否則客人可預測他人單號);取樣 = rejection sampling 丟棄 byte >= 252(禁對全 256 域 % 28,會偏向字母表前 4 個字元)。🔴 本函式不查表、不保證唯一性 —— 唯一性由 orders_display_id_key 與呼叫端的有界重試(N3b、上限 5)負責。消費端:create_order(N3b)、日後 shipment_reference。';

-- ── 2. ACL:一律收乾淨 ────────────────────────────────────────
-- 🔴 Supabase 對新函式預設 GRANT 給 PUBLIC + anon + authenticated + service_role
--    (20260719120000:511-513 實測記錄)⇒ 必須全部 REVOKE。
-- 呼叫端 create_order 是 SECURITY DEFINER、owner=postgres,本函式 owner 也是 postgres
-- ⇒ 執行身分即 owner、呼得到,**不需要任何 GRANT**。零 GRANT = 攻擊面最小。
REVOKE ALL ON FUNCTION public.pcm_generate_display_id() FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION public.pcm_generate_display_id() OWNER TO postgres;

-- ── 3. 收工驗收(fail-closed;任一條不成立 = 整片回滾)──────────
DO $$
DECLARE
  v_cnt      integer;
  v_txt      text;
  v_expected text;
  v_chi      numeric;
  v_total    integer;
  v_probe_n  constant integer := 50000;   -- 實測耗時 178ms;plan §2 定案
  v_chi_max  constant numeric := 82;      -- df=27 的 p≈1e-6;plan §2 有實測依據
BEGIN
  -- 3.1 函式屬性逐項精確斷言(不倚賴 CREATE 的預設值:預設值日後若變,這裡 fail-closed)
  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = 'public.pcm_generate_display_id()'::regprocedure
     AND p.prorettype = 'pg_catalog.text'::regtype
     AND p.proretset  = false
     AND l.lanname    = 'plpgsql'
     AND p.prosecdef  = true                      -- SECURITY DEFINER
     AND p.provolatile = 'v'                      -- VOLATILE
     AND p.proparallel = 'u'                      -- PARALLEL UNSAFE
     AND p.proisstrict = false                    -- CALLED ON NULL INPUT
     AND p.proleakproof = false                   -- NOT LEAKPROOF
     AND p.pronargs   = 0
     -- 🔴 字面取自實查、不憑直覺:`SET search_path = ''` 在 catalog 內存成 `search_path=""`
     --    (含引號)。首次實跑就是被這條 fail-closed 擋下並印出實際值才改對的;
     --    正式站 `create_order` 的 proconfig 實查為同一形狀。
     AND p.proconfig  = ARRAY['search_path=""']
     AND pg_get_userbyid(p.proowner) = 'postgres';
  IF v_cnt <> 1 THEN
    SELECT format('secdef=%s vol=%s par=%s strict=%s leak=%s nargs=%s config=%s owner=%s ret=%s',
             p.prosecdef, p.provolatile, p.proparallel, p.proisstrict, p.proleakproof,
             p.pronargs, coalesce(p.proconfig::text, '(null)'), pg_get_userbyid(p.proowner),
             p.prorettype::regtype::text)
      INTO v_txt FROM pg_proc p WHERE p.oid = 'public.pcm_generate_display_id()'::regprocedure;
    RAISE EXCEPTION 'N3a 驗收失敗 — 函式屬性不符預期;實際:%', coalesce(v_txt, '(函式不存在)');
  END IF;

  -- 3.2 ACL 矩陣:三個 Supabase 角色與 PUBLIC 一律不得有 EXECUTE
  SELECT count(*) INTO v_cnt
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(role_name)
   WHERE pg_catalog.has_function_privilege(
           r.role_name, 'public.pcm_generate_display_id()'::regprocedure, 'EXECUTE');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'N3a 驗收失敗 — 應為 0 個角色可 EXECUTE,實 % 個(產號函式不對外開放)', v_cnt;
  END IF;
  IF pg_catalog.has_function_privilege(
       'public', 'public.pcm_generate_display_id()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'N3a 驗收失敗 — PUBLIC 竟可 EXECUTE';
  END IF;

  -- 3.3 pgcrypto 依賴仍成立(套用後複驗一次,不只信前置閘)
  IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION 'N3a 驗收失敗 — extensions.gen_random_bytes(integer) 解析不到';
  END IF;

  -- ── 3.4 行為探針 ─────────────────────────────────────────────
  -- 🔴 **原設計 5 條,實跑後砍到 3 條** —— 砍掉的兩條是「無法單獨觸發」的裝飾:
  --   · 舊探針 3「零禁用字元 0O1IL/AEU」:禁用字元集**就是** regex 字元集的補集
  --     ⇒ 任何違反它的值必然同時違反探針 1 ⇒ 數學上被完全蘊含,不可能有只紅它的突變。
  --   · 舊探針 4「28 字元 one-hot 全覆蓋」:任何讓 one-hot 掉下來的字母表扭曲,
  --     都必然造成字元權重不均 ⇒ 必然同時觸發卡方,而卡方靈敏度高得多 ⇒ 被卡方支配。
  --   留著它們會讓「5 條探針」聽起來比實際強(= 防護命名超過它的實際能力)。
  --   保留的 3 條各自都有**只紅它**的突變,實跑證明見 scripts/n3-verify.sh n3a-mutations。
  CREATE TEMP TABLE n3a_probe AS
    SELECT public.pcm_generate_display_id() AS v FROM pg_catalog.generate_series(1, v_probe_n);

  -- 探針 1:全部符合合約 regex(抓長度錯、字母表誤植)
  --   突變證明:字母表插入 `0` **且**停用函式自我驗證 ⇒ 只有本條紅
  --   (單獨插 `0` 會先被函式自己的自我驗證擋下 —— 那是刻意的第一道,見下方 3.4b)
  SELECT count(*) INTO v_cnt FROM n3a_probe
   WHERE v !~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$';
  IF v_cnt <> 0 THEN
    SELECT v INTO v_txt FROM n3a_probe WHERE v !~ '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$' LIMIT 1;
    RAISE EXCEPTION 'N3a 探針 1 失敗 — % / % 筆不符合約 regex(例:%)', v_cnt, v_probe_n, v_txt;
  END IF;

  -- 探針 2:不得退化(抓「回傳常數」/「亂數源失效」/「熵大幅降低」)
  -- 🔴 **不能斷言「零重複」** —— 那是第一版寫錯、被本探針自己在隔離庫實跑當場打回的:
  --    生日悖論下,50,000 抽在 28^6 = 481,890,304 的空間裡
  --    期望重複 = C(50000,2) / 481890304 = 1,249,975,000 / 481,890,304 ≈ **2.59 對**
  --    ⇒ 期望相異值 ≈ 49,997.4。首次實跑實測 **49,997**,與期望值逐位吻合 =
  --    **產號器是對的、斷言是錯的**。若照原樣上線,正式站 apply 幾乎必然假紅。
  -- 容忍上限取 50 對:重複數 ~ Poisson(2.59),P(>50) = 0(P(>20) 已是 8e-13)
  -- ⇒ 對正確產號器不可能紅;退化成常數會掉到 1、字母表砍到 14 字元會到 166 對,照樣抓得到。
  --   突變證明:讓函式回傳固定合法值(自我驗證照過)⇒ 只有本條紅
  SELECT count(*) INTO v_cnt FROM (SELECT DISTINCT v FROM n3a_probe) d;
  IF v_cnt < v_probe_n - 50 THEN
    RAISE EXCEPTION 'N3a 探針 2 失敗 — % 抽只有 % 個相異值(重複 % 對,容忍上限 50)⇒'
                    ' 亂數源可能失效或熵不足', v_probe_n, v_cnt, v_probe_n - v_cnt;
  END IF;

  -- 探針 3:🔴 卡方均勻性 —— **唯一抓得到取樣偏差的一條**。
  --   實測依據(plan §2 + 本片突變實跑):
  --     正確版多次實跑 = 22-49(期望值 27;門檻 82 留了 ~1.7 倍裕度)
  --     門檻改 253(off-by-one)= **100 以上**(實測 101 / 129 / 149 / 161 / 181)
  --     拿掉 rejection 直接 %% 28 = **400 以上**(實測 415 / 459 / 483 / 511 / 517)
  --   ⚠️ 三組都是隨機量、每次不同 ⇒ **只記下界與實測樣本,不記單一值**
  --      (初版記死 166,下一次實跑就出現 180.8 ⇒ 註解當場過期。這類漂移必須從寫法上避免。)
  --   ⚠️ 這是統計檢定、有 p≈1e-6 的偽陽性率:
  --      **紅了請先原封重跑一次**;連續兩次紅才代表演算法真的偏了。
  -- 🔴 **N3(關卡2-A nit)**:原本只 GROUP BY 實際出現過的字元 ⇒ count=0 的格
  --    不進 Σ、連它自己的 e 項也少掉 —— 而「某個字元完全不出現」正是被砍掉的
  --    one-hot 探針要抓的形狀。改成對**字母表 28 個字元逐一 LEFT JOIN**,
  --    沒出現的格以 0 計入 ⇒ 少一個字元也會在卡方裡現形(缺 1 格 ⇒ 貢獻 +e)。
  SELECT count(*) INTO v_total
    FROM n3a_probe, pg_catalog.regexp_split_to_table(v, '') AS ch;
  SELECT sum((coalesce(o.c, 0) - (v_total / 28.0)) * (coalesce(o.c, 0) - (v_total / 28.0))
             / (v_total / 28.0)) INTO v_chi
    FROM (SELECT pg_catalog.substr('23456789BCDFGHJKMNPQRSTVWXYZ', g, 1) AS ch
            FROM pg_catalog.generate_series(1, 28) AS g) a
    LEFT JOIN (SELECT ch, count(*)::numeric AS c
                 FROM n3a_probe, pg_catalog.regexp_split_to_table(v, '') AS ch
                GROUP BY ch) o ON o.ch = a.ch;
  IF v_chi > v_chi_max THEN
    RAISE EXCEPTION 'N3a 探針 3 失敗 — 字元分布卡方 %(門檻 %、df=27)⇒ 取樣有偏差。'
                    ' 最可能原因:rejection 門檻寫錯(必須丟棄 byte >= 252)或改用了 %% 28 直取。'
                    ' ⚠️ 本條為統計檢定,請先原封重跑一次再懷疑程式', round(v_chi, 1), v_chi_max
      USING ERRCODE = 'P0001';
  END IF;

  -- 3.4b 誠實記錄:函式**自己**的回傳前自我驗證是第一道、也是實測最先觸發的那道。
  --   突變「字母表插入 0」實跑 ⇒ 死在 `pcm_generate_display_id: 產出不符 §5.4a 合約(74Q0KD)`,
  --   探針 1 根本來不及跑。⇒ 它不是冗餘,它是主守門;探針 1 是它壞掉時的第二道。
  DROP TABLE n3a_probe;

  -- ── 3.5 字母表合約(🔴 位置刻意排在行為探針【之後】)──────────────
  -- **F2(關卡2-B must-fix)**:本塊原本排在探針之前,結果四個突變全部改死在這裡 ——
  --   字母表插 `0` 本該死在「函式自我驗證」與「探針 1」,門檻 253 本該死在卡方。
  --   純字面斷言排在行為探針前面 = 用字面把行為證據遮蔽掉
  --   (`feedback_text-level-tests-cannot-catch-runtime-wiring` 同型)。
  --   ⇒ **行為先於字面**:探針全數通過之後,才輪到這條字面合約檢查。
  --
  -- **F1(關卡2-B BLOCKER,已修)**:本塊初版還有一條
  --   `strpos(v_txt, '(v_b %% 28) + 1')`。`%%` 的轉義**只在 RAISE / format 的格式字串裡成立**;
  --   在普通 SQL 字串字面量裡它就是兩個百分號,而 prosrc 裡是**一個**
  --   ⇒ strpos 恆回 0 ⇒ **N3a 每次 apply 必死**(含 production 的 db push)。
  --   隔離庫實測:`strpos(prosrc,'(v_b %% 28) + 1')` = 0、`strpos(prosrc,'(v_b % 28) + 1')` = 1553。
  --   ⇒ 那條檢查**整條刪除**,兩個理由:
  --     ① 它是這個 blocker 的來源;
  --     ② 它本來就被遮蔽 —— 改字母表會先被下面的逐字相等擋下;而只改取模數
  --        (例如 `% 28` → `% 26`)會讓 2 個字元永遠抽不到,
  --        卡方探針改成 28 格 LEFT JOIN 之後空格會貢獻 +e ⇒ 卡方抓得到。
  --   保留下來的只有「字母表字面與 §5.4a 逐字相等」這一條:便宜、確定、訊息清楚,
  --   且有專屬突變(字母表補成 30 個合法字元 ⇒ 三條探針全綠,只有它會紅)。
  SELECT prosrc INTO v_txt FROM pg_proc
   WHERE oid = 'public.pcm_generate_display_id()'::regprocedure;
  SELECT (pg_catalog.regexp_match(v_txt, 'c_alphabet[^:]*:=\s*''([^'']+)'''))[1] INTO v_expected;
  IF v_expected IS DISTINCT FROM '23456789BCDFGHJKMNPQRSTVWXYZ' THEN
    RAISE EXCEPTION 'N3a 驗收失敗 — 字母表與 §5.4a 合約不符(實際 [%])',
      coalesce(v_expected, '(解析不到 c_alphabet)');
  END IF;

  -- 3.6 COMMENT 已掛上且含關鍵合約字面(防日後被改成空泛描述)
  v_expected := '23456789BCDFGHJKMNPQRSTVWXYZ';
  SELECT obj_description('public.pcm_generate_display_id()'::regprocedure, 'pg_proc') INTO v_txt;
  IF v_txt IS NULL OR pg_catalog.strpos(v_txt, v_expected) = 0 THEN
    RAISE EXCEPTION 'N3a 驗收失敗 — COMMENT 未掛上或未載明字母表字面';
  END IF;
  IF pg_catalog.strpos(v_txt, '不保證唯一性') = 0 THEN
    RAISE EXCEPTION 'N3a 驗收失敗 — COMMENT 必須明載「不保證唯一性」(避免後人誤以為可省重試迴圈)';
  END IF;

  RAISE NOTICE 'N3a 驗收全數通過(屬性 + ACL + pgcrypto 依賴 + 3 條行為探針〔% 抽、卡方 %〕)',
    v_probe_n, round(v_chi, 1);
END
$$;

COMMIT;
