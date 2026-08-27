-- ════════════════════════════════════════════════════════════════════════════
-- M-4b #347-fuzzy · 後台訂單搜尋:pg_trgm + 統一容錯 + UNION 12 分支
--
-- 真權威 = docs/specs/2026-08-11-347-fuzzy-search-plan.md(§4 規範表 + UNION 骨架)。
-- 本檔照 §4 逐字實作;任何與 §4 不一致的地方以 §4 為準、回頭改本檔,不要就地改規格。
--
-- Sean 拍板(plan §8 / §16c):Q1=A 分類不變 / Q2=A 品牌用現行資料 / Q3=A 正規化三巨集 /
--   Q4=B 舊搜尋欄同批收掉 / Q-347-B1=B 不做單號形狀偵測、查無時給提示 /
--   Q-347-B2=C + Q-347-B3=B 供應商三能力:①②在片 B-2 重建、③截斷維持既有 fail-soft。
--
-- ── 🔴 本檔動到什麼(逐項,審查請對照)──────────────────────────────────
--   1. `CREATE EXTENSION pg_trgm`(鐵則 12④ 平台設定)
--   2. 新函式 `public.pcm_spec_text(jsonb)`(#9 規格文字攤平)
--   3. `CREATE OR REPLACE` 既有 `public.admin_search_orders(text,integer,timestamptz,timestamptz)`
--      —— **簽章不變**(PostgREST 靠具名參數,改簽章 = a9h 那種 PGRST202 事故)
--   4. **11 支** GIN trigram 索引(**#10 品牌刻意不建**、有實測數字;#9 規格**要建**,
--      2026-08-12 A0-E 量測後線裁補上 —— 理由與數字寫在該段)
--   5. 兩支函式的 ACL:先 `REVOKE … CASCADE` 再 `GRANT` 給 service_role
--      (`CREATE OR REPLACE` 會原封保留既有 ACL ⇒ 不重設就只是在斷言別人以前有沒有做對)
--   6. 更新該 RPC 的 COMMENT
--   7. 斷言區 **19 條**(逐條標籤:A / B / C / C-0 / C-2 / C-3 / C-4 / D / D2 / E / E-4 /
--      E2 / E3 / F / G / H / I / I-2 / I-3),外加 1 道無標籤前置閘(函式體正規化後長度
--      < 500 字元就停 —— 剝壞了的話 E 族會變成「掃空字串 ⇒ 全綠」的恆真格)。
--      🔴 **這個數字是數出來的,不是抄的**(2026-08-12,三趟法):
--        `grep -cE '^  -- [A-Z][0-9A-Za-z-]*[.(]'` = 19 個標籤;
--        `grep -c '^    RAISE EXCEPTION'` = 22 個失敗出口(19 標籤 + I 與 I-2 各多一條 + 前置閘 1)。
--        改斷言區的人請重跑這兩條、同批改本行與收尾 NOTICE 的字面。
--      ⚠️ **行首那四個空格不是排版潔癖,是必要的**:註解裡逐字引用了要數的字串,
--        不帶錨點就會把**本段說明文字自己**算進去。行首錨能擋掉,是因為註解一律以 `--` 開頭。
--        🔴 **寫下數法的那一行,永遠是那條數法的第一個嫌疑命中** —— 本檔第五次
--        「偵測器命中自己的輸入」(前四次:E2 掃到自己的註解 / H 被索引名裡的 `name`
--        命中 / 突變輪被 `IF NOT EXISTS` 假綠 / RAISE 數法自命中,2026-08-12 主視窗複掃)。
--      ⚠️ 同理數 REVOKE 用 `grep -cE '^  EXECUTE .*REVOKE ALL ON FUNCTION'` = 6
--        (`pcm_spec_text(jsonb)` 三支 + `admin_search_orders(text,integer,…)` 三支;
--        **這裡刻意不寫行號** —— 本段註解每改一次長度就把下面所有行號推掉一次,實測
--        改兩輪推了兩次,行號註定追不上。要位置就現跑上面那條 `grep -nE`。)
--        **刻意不寫 `$x$`**:本機 grep 是 ugrep,
--        BRE 下會把 `$x$` 的 `$` 當錨點 ⇒ `grep -c 'EXECUTE $x$REVOKE ALL'` 實跑回 **0**,
--        照抄的人會以為 REVOKE 全掉了(數字錯不可怕,數法**不可執行**才可怕)。
--      ⚠️ 這裡刻意**不記錄「不帶錨點會回幾」** —— 那個數字取決於本段註解自己有幾行引用了
--        該字串,改一次註解就過期一次(本檔已經因此錯過兩次)。要驗就跑上面帶錨點的三條。
--      🔴 **更正紀錄(兩次)**:
--        · 第一版寫「承接 A-F 逐條保留」是**假字面** —— 實際掉了 C-0(owner)/
--          C-2(GRANT OPTION)/C-3(角色繼承)/F(FORCE RLS)四條,由 code-reviewer
--          (2026-08-12)抓出。四條已補回,那行才從宣稱變成事實。
--        · 第二版寫「13 條」也是**假字面**(codex K2 2026-08-12 must-fix 4):
--          當時實際已有 17 個守點、檔頭清單還漏掉 C。現在改成上面這份數出來的清單。
--
-- ── 🔴 寫這支之前踩到、留給下一代的三個地雷 ────────────────────────────
--   ① **函式體(含註解)不得出現 R-A-I-S-E 那個字** —— 斷言 E 是對 `prosrc` 的
--      文字掃描(`~* '\mRAISE\M'`,`20260810120000:354`),連註解都算。
--      本檔函式體內一律寫「擲例外」。這道守門的理由是:搜尋詞本身是客人的
--      姓名/電話/地址,寫進 server log 就是外洩。
--   ② `search_path = ''` ⇒ **所有東西都要 schema 限定**,包含運算子:
--      `OPERATOR(extensions.<%)`、opclass `extensions.gin_trgm_ops`。
--   ③ 全形空白 U+3000 / NBSP 在 C locale 下**不保證**被 `[[:space:]]` 涵蓋
--      ⇒ **識別碼類與數字類**的正規化字元類顯式列出這些碼位,欄值與 needle 兩側都套。
--      🔴 **文字類不是這樣**,見下面誠實邊界第一條 —— 不要照這行的字面推廣到全部。
--
-- ── ⚠️ 誠實邊界(不要讀成保證)────────────────────────────────────────
--   · 🔴 **全形空白只在識別碼/數字類被正規化,文字類沒有**(codex K2 2026-08-12 must-fix 5)。
--     文字類(姓名/收件人/地址/品名/規格/品牌)兩側走的是**裸 `btrim()`**,而 `btrim()`
--     在 C locale 下**不吃** U+3000 / NBSP / U+202F / U+200B / BOM。
--     ⇒ 使用者貼進來的姓名若前後帶全形空白,文字類可能比不中。
--     **本片刻意不改這個行為**(reviewer m14 已裁=plan 級已知邊界,改它會動到既有比對語意)——
--     但檔頭原本寫「欄值與 needle 雙向都套」是**宣稱大於事實**,已改成上面那句。
--   · #12 `legacy_display_id` 的 partial 索引是**依 partial 規則推的設計、未量測** ——
--     A0 探針的拋棄式庫沒造這欄的資料(plan §4.4 尾段逐字)。驗收第 10 條的
--     EXPLAIN 會證實或推翻;走不到就照實寫成缺口,不硬凹。
--   · 模糊閾值 0.4 是**起始值**,由 A0 探針與驗收 12 的邊界對調整;調它要連驗收一起改。
--   · 🔴 **斷言區是結構層,不是行為層**(2026-08-12 線裁,承 codex K2 ⑤ 的觀察):
--     把主函式改成「固定回空清單」時,除了 I-2 之外的斷言**全部照樣綠** ——
--     它們驗的是 catalog 形狀、ACL、索引定義,不是查詢結果對不對。
--     行為層的證據鏈在**別的地方**:拋棄式庫的突變輪 + apply 後煙測(CJK + EXPLAIN)。
--     apply 當下正式庫沒有測資,做不了行為探針 ⇒ **這是刻意接受的結構層固有邊界**。
--     (唯一例外是 I-2/I-3:`pcm_spec_text` 是純函式,餵 literal 就能驗,不需要測資。)
--   · 🔴 **斷言順序會互相遮蔽**:19 條是**逐條循序執行、第一條紅就停**。
--     實務影響最大的是 H(索引)排在 C 族後面、E-4 排在 E2 前面 ——
--     真的踩到多個問題時,你**一次只會看到最前面那一條**的訊息,修完要再跑一次才看得到下一條。
--     ⇒ 修 apply 失敗時不要假設「只有這一個問題」;逐輪顯露是預期行為,不是守門壞掉。
--   · 🔴 **索引與 `CONCURRENTLY` 互斥**:11 支 GIN 都在單一交易內建 ⇒ apply 期間會鎖住
--     orders / order_items / customers / order_item_procurement 的寫入(前台結帳與後台寫單會卡)。
--     這不是本檔能修的(要 CONCURRENTLY 就得放棄原子性)⇒ apply 檢查表必須列鎖窗口 + 低流量時段。
--   · 🔴 **#9 的索引建在 `pcm_spec_text()` 的回傳值上** ⇒ 那支函式被改過而沒有
--     `REINDEX INDEX public.idx_order_items_spec_trgm` 時,索引會**靜默過期**(PG 不擋、不報錯,
--     查詢照回答案、只是少回訂單)。斷言 I-3 用定義指紋擋「重放時已被改過」這條路;
--     **擋不住「本片 apply 之後,未來某支 migration 改了函式卻沒 REINDEX」** ——
--     那條路沒有 DB 層 hook 可畫,是**誠實缺口**,由 I-3 的錯誤訊息與索引旁的硬警告承載。
--   · 🔴 **中文模糊比對在本機量不到**:macOS libc 對 CJK 抽零 trigram
--     (memory `reference_pg-trgm-cjk-zero-on-macos-libc`)⇒ 本機所有 CJK 模糊格都是恆真假綠。
--     正式站(Linux/glibc)實測抽得到 trigram,但**短的中文 needle 走不走得到 gin_trgm 未量測**
--     ⇒ 列進 apply 後煙測。本檔的效能數字全部只證了拉丁 corpus。
--   · 本檔**不動** 100 筆上限、日期預設窗、POST-only + httpOnly cookie 那條 PII 紅線
--     (都是 #347-2b/-3a/-3c 的既有合約,plan §0 明列)。
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. 擴充 ─────────────────────────────────────────────────────────────────
-- 🔴 裝在 `extensions` schema:Supabase 慣例,且 `search_path=''` 下本來就要限定。
--    驗收 1 fail-closed:裝不上就整片停(下面斷言 G 會擋)。

-- ── 🔴🔴 交易語意(code-reviewer 2026-08-12 must-fix 1/2;判例=`20260811120000:45-57`)──
--   **整支是單一 `DO` 區塊 = 單一語句** ⇒ 任何一條斷言不符時,擴充、兩支函式、10 支索引、
--   COMMENT **全部一起回滾**,不留半套用狀態。
--   🔴 **為什麼非這樣不可**:repo 的重放 harness 是 `psql -f`、**沒有 `-1`**
--   (`scripts/d1t2-rehearsal.sh:79` 逐字)= **逐句 autocommit** ⇒ 若寫成裸敘述,
--   斷言擲例外時前面那些物件**早就提交了**,「不符就整片停」會是**假字面**。
--   ⚠️ 也**不能**改用 `BEGIN; … COMMIT;`:Supabase `db push` 自己會包一層交易,
--   檔內的 `COMMIT` 會把**工具那層**提早提交掉 —— 比原本的問題更糟。
--   (前一天 `20260811120000` 立這條判例時是**兩種執行方式各實跑一次、退出碼逐格相同**
--    才敢寫下來的;本檔照抄那個形狀,並照樣兩種方式都跑。)
--
-- ── ⚠️ 誠實邊界追加(code-reviewer Imp 8)────────────────────────────────
--   10 支 GIN 索引**不是** `CONCURRENTLY`(單交易與 CONCURRENTLY 互斥,兩者只能挑一個)
--   ⇒ **apply 期間會鎖住 orders / order_items / customers / order_item_procurement 的寫入**,
--   前台結帳與後台寫單在那段時間會卡。**這不是本檔能修的**(要 CONCURRENTLY 就得放棄原子性)
--   ⇒ 處置=**apply 檢查表必須列「鎖窗口預估 + 建議低流量時段」交 Sean 拍時間窗**。
DO $mig$
DECLARE
  v_args    text;
  v_missing text;
  v_role    text;
  v_src     text;  -- admin_search_orders 的函式體,**已剝註解 + 正規化**(見斷言 E 前那段)
  v_fp      text;  -- pcm_spec_text 的定義指紋(斷言 I-3)
BEGIN
  -- ── 1. 擴充 ───────────────────────────────────────────────────────────────
  EXECUTE $x$CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions$x$;

  -- ── 2. 規格文字攤平(#9)──────────────────────────────────────────────────
  EXECUTE $x$CREATE OR REPLACE FUNCTION public.pcm_spec_text(p jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
-- 🔴 **刻意不加 `SET search_path`**(code-reviewer 2026-08-12 Imp 7)。
--    ①**加了會讓 SQL 函式不能被 inline**(PG 官方文件字面:帶 SET 子句的 SQL 函式不 inline)
--      —— 而 #9 分支**每一列呼它兩次**,不 inline 的代價是逐列函式呼叫。
--      ⚠️ 兩件事都不要讀成實測:(a)inline 規則我是照官方文件寫的、沒有另外量;
--      (b)**本函式現在也未必真的被 inline** —— 官方的 inline 條件不只「沒有 SET」,
--      codex K2(2026-08-12)指出本函式體含子查詢聚合、本來就未必符合。
--      ⇒ 這條理由的正確讀法是「加了必定不 inline」,不是「不加就一定 inline」。
--    ②**不加也安全**,兩個理由缺一不可:本函式體內所有識別字都已 `pg_catalog.` 限定
--      (`string_agg` / `jsonb_each_text`;`COALESCE` 是語法不是函式)、**完全不碰任何表**、
--      且它是 SECURITY **INVOKER**(預設)⇒ 沒有提權面可被 search_path 影響。
--    🔴 **原本這裡還有第 ③ 條「唯一呼叫端 admin_search_orders 本身就 SET search_path=''」
--      —— 那不是事實,已刪**(codex K2 2026-08-12):`service_role` 拿得到本函式的
--      EXECUTE,可以直接呼叫,呼叫端的 search_path 不受控。安全性只由 ①② 撐著,
--      不要再把「呼叫端會幫我收拾」寫進理由清單。
--    ⇒ 同時修好與 plan §4.1 定義不一致的問題(§4.1 那份就沒有 SET)。
--
-- 🔴🔴 **`ORDER BY key` 不可拿掉**(codex K2 2026-08-12 must-fix 1;下面 #9 的表達式索引
--    整個建立在這條之上):`string_agg` 不加 ORDER BY 時,聚合的輸入順序**SQL 不保證**。
--    · 沒有索引時,這只是理論風險 —— 同一次查詢兩邊同時求值,分岔看不出來。
--    · **建了表達式索引之後就是會真的答錯**:索引裡存的是**建索引當下**算出的那份字串,
--      查詢時再算一次;順序若不同 ⇒ 索引比不中 ⇒ **靜默少回訂單**(不報錯、不會紅)。
--    · 而 `IMMUTABLE` 這個宣告本身也需要它:同一輸入必須永遠得到同一輸出,才准建索引。
--    ⚠️ **行為變更(不是默默改)**:改前攤平順序是 jsonb 的儲存鍵序(短鍵在前)
--      ⇒ `{"color":"黑","size":"M"}` 攤成 `M 黑`;改後照鍵名字典序 ⇒ `黑 M`。
--      單值子字串搜尋不受影響;**跨欄多詞 needle 的匹配位置會變**。已同步 plan §4.1。
AS $spec$
  SELECT COALESCE(
           (SELECT pg_catalog.string_agg(value, ' ' ORDER BY key)
              FROM pg_catalog.jsonb_each_text(p)),
           '')
$spec$$x$;
  -- 🔴 **REVOKE 要三行,不是一行**(2026-08-12 被本檔自己的斷言 I 擋下才發現):
  --    Supabase 的 **default privileges** 會自動把 public schema 新函式的 EXECUTE
  --    授給 `anon` / `authenticated` —— 那是**具名角色的授權**,
  --    `REVOKE ALL … FROM PUBLIC` **收不掉它**(PUBLIC 與具名角色是兩件事)。
  --    實測:只寫 PUBLIC 那行時,grantee 集合是 [anon, authenticated, service_role]。
  --    照既有慣例(`20260810120000:208-210`)三行一起收。
  -- 🔴 **`CASCADE` 不是裝飾**(codex K2 2026-08-12 must-fix 2a):若某個角色手上那份 EXECUTE
  --    是 `WITH GRANT OPTION`、而且它已經再轉發給第三個角色,裸 `REVOKE` 會因為
  --    「還有相依授權」而**整條失敗**(RESTRICT 是預設值)。在 `DO` 區塊裡失敗=整片回滾,
  --    安全但無法收斂 —— 每次 apply 都會撞同一面牆。`CASCADE` 讓它連同轉發出去的那些一起收,
  --    ACL 才真的回到「只有 service_role」這個閉世界(下面斷言 I 用完整 acl 形狀驗這件事)。
  EXECUTE $x$REVOKE ALL ON FUNCTION public.pcm_spec_text(jsonb) FROM PUBLIC CASCADE$x$;
  EXECUTE $x$REVOKE ALL ON FUNCTION public.pcm_spec_text(jsonb) FROM anon CASCADE$x$;
  EXECUTE $x$REVOKE ALL ON FUNCTION public.pcm_spec_text(jsonb) FROM authenticated CASCADE$x$;
  EXECUTE $x$GRANT EXECUTE ON FUNCTION public.pcm_spec_text(jsonb) TO service_role$x$;

  -- ── 3. 主體:admin_search_orders 改 UNION 12 分支 ────────────────────────
  EXECUTE $x$CREATE OR REPLACE FUNCTION public.admin_search_orders(
  p_query text,
  p_limit integer DEFAULT 100,
  p_from  timestamptz DEFAULT NULL,
  p_to    timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET pg_trgm.word_similarity_threshold = '0.4'
AS $fn$
DECLARE
  v_raw        text;
  v_limit      integer;
  v_ids        uuid[];
  v_found      integer;
  v_id_needle  text;
  v_num_needle text;
  v_txt_needle text;
  v_id_like    text;
  v_num_like   text;
  v_txt_like   text;
BEGIN
  -- ── 0. 空輸入短路(承 #347-1/-3a,逐字保留)────────────────────────────
  -- 🔴 全空白也算空。回空清單、**不發查詢**。
  --    `btrim(x)` 預設只清 ASCII 空格 ⇒ tab、全形空白 U+3000、NBSP、窄空格、
  --    零寬空格、BOM 全都會穿過去 ⇒ 修剪字元集必須顯式列出。
  v_raw := pg_catalog.lower(
    pg_catalog.btrim(COALESCE(p_query, ''), E' \t\r\n\u3000\u00a0\u202f\u200b\ufeff'));
  IF v_raw = '' THEN
    RETURN pg_catalog.jsonb_build_object('ids', '[]'::jsonb, 'truncated', false);
  END IF;

  -- 🔴 長度閘:超過 120 字元一律當作沒有結果。擋的是「超長輸入讓每一列的比對變貴」,
  --    **不是**整體執行時間(那個本片綁不住)。回空清單而不是擲例外:錯誤訊息不得含
  --    輸入原文,而「長度是 N」本身也是輸入的資訊。
  IF pg_catalog.length(v_raw) > 120 THEN
    RETURN pg_catalog.jsonb_build_object('ids', '[]'::jsonb, 'truncated', false);
  END IF;

  -- ── 1. 上限:NULL 或 <= 0 → 100;超過 100 一律夾到 100(既有合約,不動)────
  v_limit := CASE WHEN p_limit IS NULL OR p_limit <= 0 THEN 100 ELSE LEAST(p_limit, 100) END;

  -- ── 2. needle 三份(plan §4.2;每一類各自檢查非空)──────────────────────
  -- 🔴 **三類各自算、各自檢查空**,不是算一份共用:
  --    · 識別碼類 NORM_ID:忽略大小寫 + 忽略 - _ 空白(含 U+3000 / NBSP)
  --    · 數字類   NORM_NUM:只留數字
  --    · 文字類   NORM_TXT:lower + btrim
  --    搜 `-` 時 NORM_ID/NORM_NUM 會變空字串 ⇒ 那兩類整組跳過(否則 `LIKE '%%'` 撈全部);
  --    但**文字類不跳過** —— 資料裡真的可能有 `-`,搜得到才是對的(plan A2 逐字)。
  v_id_needle  := pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(p_query,'')), E'[-_[:space:]\u3000\u00A0]', '', 'g');
  v_num_needle := pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(p_query,'')), '[^0-9]', '', 'g');
  v_txt_needle := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_query,'')));

  -- LIKE 用的跳脫版:needle 內的 \ % _ 三個字元必須跳脫,否則搜一個 `%` 會撈出全部。
  -- 🔴 順序固定:先跳脫反斜線本身,再跳脫 % 與 _(反過來會把剛加的反斜線再跳脫一次)。
  v_id_like  := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_id_needle ,'\','\\'),'%','\%'),'_','\_');
  v_num_like := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_num_needle,'\','\\'),'%','\%'),'_','\_');
  v_txt_like := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_txt_needle,'\','\\'),'%','\%'),'_','\_');

  -- ── 3. 12 分支 UNION ────────────────────────────────────────────────────
  -- 🔴 每個分支**自己帶**日期範圍與非空閘 —— 不是在外層包一次:
  --    分支各自帶,規劃器才可能對每個分支各自挑索引(這正是 UNION 形狀的目的)。
  -- 🔴 模糊的運算元方向固定:`needle OPERATOR(extensions.<%) 目標表達式`(needle 在左)。
  --    寫反了語意顛倒(變成「整個地址有多少對得上 needle」)而且**照樣會編譯過**。
  WITH hits AS (
    -- #1 訂單編號(識別碼;不套模糊)
    SELECT o.id, o.created_at FROM public.orders o
     WHERE v_id_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(o.display_id,'')), E'[-_[:space:]\u3000\u00A0]', '', 'g')
           LIKE '%' || v_id_like || '%' ESCAPE '\'
    UNION
    -- #12 舊訂單編號 legacy_display_id(識別碼)
    -- 🔴 少這支 = 淨失能力:舊的專用單號欄是**兩欄對稱查**
    --    (adapter 裡一條 `display_id.eq.…,legacy_display_id.eq.…` 的 `.or()`),
    --    改過號的單、客人拿舊單號來問,新搜尋若只查 display_id 就查不到。
    -- ⚠️ **那條 `.or()` 與整個 `orderNumber` 專用軸已在應用層那顆退場**(Sean 拍板 Q-347-B1=B)
    --    ⇒ 本分支自此是舊單號**唯一**的查得到路徑,不再是「與 adapter 並存的第二條」。
    --    (原文此處寫 `SupabaseOrderAdapter.ts:762`,那個行號在同一批的應用層改動後
    --     指到無關的程式碼 —— 指向已刪實作的行號比沒有指標更糟,故改成描述它是什麼。)
    -- ⚠️ 下面那條 `IS NOT NULL` **語意上是恆等的**(NULL 經 COALESCE 變空字串,
    --    本來就不可能命中非空 needle)—— 它只為了讓規劃器對得上 partial 索引的述詞。
    SELECT o.id, o.created_at FROM public.orders o
     WHERE v_id_needle <> ''
       AND o.legacy_display_id IS NOT NULL
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(o.legacy_display_id,'')), E'[-_[:space:]\u3000\u00A0]', '', 'g')
           LIKE '%' || v_id_like || '%' ESCAPE '\'
    UNION
    -- #2 會員姓名(文字:子字串 OR 詞相似度)
    -- 🔴 join 欄是 `customers.user_id`,不是 `customers.id`(踩過)。
    SELECT o.id, o.created_at FROM public.orders o
      JOIN public.customers c ON c.user_id = o.customer_user_id
     WHERE v_txt_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND (pg_catalog.lower(pg_catalog.btrim(COALESCE(c.name,''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
         OR v_txt_needle OPERATOR(extensions.<%) pg_catalog.lower(pg_catalog.btrim(COALESCE(c.name,''))))
    UNION
    -- #3 會員電話(數字;不套模糊)
    SELECT o.id, o.created_at FROM public.orders o
      JOIN public.customers c ON c.user_id = o.customer_user_id
     WHERE v_num_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(c.phone,'')), '[^0-9]', '', 'g')
           LIKE '%' || v_num_like || '%' ESCAPE '\'
    UNION
    -- #4 收件人姓名(文字)
    -- 🔴 收件快照三個子鍵**分開比,不得先用 `||` 串起來** —— 串接會製造跨欄假命中
    --    (姓名結尾 + 電話開頭剛好拼出搜尋詞)。
    SELECT o.id, o.created_at FROM public.orders o
     WHERE v_txt_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND (pg_catalog.lower(pg_catalog.btrim(COALESCE(o.shipping_address_snapshot ->> 'name',''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
         OR v_txt_needle OPERATOR(extensions.<%) pg_catalog.lower(pg_catalog.btrim(COALESCE(o.shipping_address_snapshot ->> 'name',''))))
    UNION
    -- #5 收件電話(數字;不套模糊)
    SELECT o.id, o.created_at FROM public.orders o
     WHERE v_num_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(o.shipping_address_snapshot ->> 'phone','')), '[^0-9]', '', 'g')
           LIKE '%' || v_num_like || '%' ESCAPE '\'
    UNION
    -- #6 收件地址 line(文字)
    SELECT o.id, o.created_at FROM public.orders o
     WHERE v_txt_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND (pg_catalog.lower(pg_catalog.btrim(COALESCE(o.shipping_address_snapshot ->> 'line',''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
         OR v_txt_needle OPERATOR(extensions.<%) pg_catalog.lower(pg_catalog.btrim(COALESCE(o.shipping_address_snapshot ->> 'line',''))))
    UNION
    -- #7 料號(識別碼;讀 order_items 的**下單當下快照**,不經商品表)
    SELECT o.id, o.created_at FROM public.orders o
      JOIN public.order_items oi ON oi.order_id = o.id
     WHERE v_id_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(oi.variant_sku,'')), E'[-_[:space:]\u3000\u00A0]', '', 'g')
           LIKE '%' || v_id_like || '%' ESCAPE '\'
    UNION
    -- #8 品名(文字;同樣讀快照)
    SELECT o.id, o.created_at FROM public.orders o
      JOIN public.order_items oi ON oi.order_id = o.id
     WHERE v_txt_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND (pg_catalog.lower(pg_catalog.btrim(COALESCE(oi.product_snapshot ->> 'title',''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
         OR v_txt_needle OPERATOR(extensions.<%) pg_catalog.lower(pg_catalog.btrim(COALESCE(oi.product_snapshot ->> 'title',''))))
    UNION
    -- #9 規格(文字;本片新增。spec 是 jsonb 物件 ⇒ 走 pcm_spec_text 攤平)
    SELECT o.id, o.created_at FROM public.orders o
      JOIN public.order_items oi ON oi.order_id = o.id
     WHERE v_txt_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND (pg_catalog.lower(pg_catalog.btrim(COALESCE(public.pcm_spec_text(oi.product_snapshot -> 'spec'),''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
         OR v_txt_needle OPERATOR(extensions.<%) pg_catalog.lower(pg_catalog.btrim(COALESCE(public.pcm_spec_text(oi.product_snapshot -> 'spec'),''))))
    UNION
    -- #10 品牌(文字;**12 條裡唯一走活的商品表的分支** —— variant → product → brand 三跳)
    -- 🔴 Sean 拍 Q2=A:搜「**現在的**品牌」,不是下單當時的品牌;畫面要標明這件事(plan A5)。
    -- 🔴 資料源刻意用 base 表、**不是** `storefront_catalog_v`:那個 view 的條件是
    --    `is_listed AND NOT hidden_from_store` ⇒ 已下架商品的歷史訂單會整批搜不到。
    --    後台搜訂單歷史 vs 前台目錄 = 兩種答案(plan A4b)。
    SELECT o.id, o.created_at FROM public.orders o
      JOIN public.order_items    oi ON oi.order_id = o.id
      JOIN public.product_variants pv ON pv.id = oi.variant_id
      JOIN public.products         pr ON pr.id = pv.product_id
      JOIN public.brands           br ON br.id = pr.brand_id
     WHERE v_txt_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND (pg_catalog.lower(pg_catalog.btrim(COALESCE(br.name,''))) LIKE '%' || v_txt_like || '%' ESCAPE '\'
         OR v_txt_needle OPERATOR(extensions.<%) pg_catalog.lower(pg_catalog.btrim(COALESCE(br.name,''))))
    UNION
    -- #11 供應商單號(識別碼;不套模糊)
    -- ⚠️ 本片**只保留「查得到單」這一項**。舊兩段式路徑另外帶的「供應商名/多家去重」
    --    在片 B-2 重建(Sean Q-347-B2=C);「截斷擲例外」則照 Q-347-B3=B 退場,
    --    改由本函式既有的 `truncated` 旗標 + 畫面提示承載。
    SELECT o.id, o.created_at FROM public.orders o
      JOIN public.order_items             oi ON oi.order_id = o.id
      JOIN public.order_item_procurement  pc ON pc.order_item_id = oi.id
     WHERE v_id_needle <> ''
       AND (p_from IS NULL OR o.created_at >= p_from)
       AND (p_to IS NULL OR o.created_at < p_to)
       AND pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(pc.supplier_order_no,'')), E'[-_[:space:]\u3000\u00A0]', '', 'g')
           LIKE '%' || v_id_like || '%' ESCAPE '\'
  )
  SELECT pg_catalog.array_agg(h.id ORDER BY h.created_at DESC, h.id DESC)
    INTO v_ids
    FROM (SELECT DISTINCT id, created_at
            FROM hits
           ORDER BY created_at DESC, id DESC
           LIMIT v_limit + 1) h;

  -- ── 4. 組回傳(合約與 #347-3a 逐字相同)──────────────────────────────────
  -- 🔴 `array_length(NULL,1)` 與空陣列都回 NULL ⇒ 零命中走這一條。
  v_found := COALESCE(pg_catalog.array_length(v_ids, 1), 0);
  IF v_found = 0 THEN
    RETURN pg_catalog.jsonb_build_object('ids', '[]'::jsonb, 'truncated', false);
  END IF;

  -- 🔴 多撈的那一筆只用來證明「還有更多」,**不回給呼叫端**。
  --    這個 `+1` 的存在理由 = 分辨「剛好觸頂」與「超過」;UI 若改用
  --    `ids.length >= 上限` 的啟發式,就把它的價值整個抹掉(驗收有專屬邊界格)。
  IF v_found > v_limit THEN
    RETURN pg_catalog.jsonb_build_object(
      'ids', pg_catalog.to_jsonb(v_ids[1:v_limit]),
      'truncated', true);
  END IF;

  RETURN pg_catalog.jsonb_build_object('ids', pg_catalog.to_jsonb(v_ids), 'truncated', false);
END
$fn$$x$;

  -- ── 3b. admin_search_orders 的 ACL:**建立它,不要只斷言它** ──────────────
  -- 🔴 codex K2 2026-08-12 must-fix 2a:本片對這支函式用的是 `CREATE OR REPLACE`,
  --    而 **`CREATE OR REPLACE FUNCTION` 會原封保留既有 ACL** —— 它不會把權限重設成乾淨狀態。
  --    原本這裡一行 GRANT/REVOKE 都沒有,等於「舊庫的 ACL 長什麼樣就繼續是什麼樣」,
  --    只靠下面斷言 C 族去**發現**問題。發現 ≠ 修好:正式站若真有一個多餘 grantee,
  --    apply 會擋下來(fail-closed,這點是對的)但**永遠收斂不了**,每次都撞同一面牆。
  --    ⇒ 補成與 `pcm_spec_text` 同一形狀:先 REVOKE(含 CASCADE 處理轉發鏈)再 GRANT。
  --    這樣斷言 C 族才是在驗「我剛剛做的事成功了」,而不是在驗「別人以前有沒有做對」。
  EXECUTE $x$REVOKE ALL ON FUNCTION public.admin_search_orders(text, integer, timestamptz, timestamptz) FROM PUBLIC CASCADE$x$;
  EXECUTE $x$REVOKE ALL ON FUNCTION public.admin_search_orders(text, integer, timestamptz, timestamptz) FROM anon CASCADE$x$;
  EXECUTE $x$REVOKE ALL ON FUNCTION public.admin_search_orders(text, integer, timestamptz, timestamptz) FROM authenticated CASCADE$x$;
  EXECUTE $x$GRANT EXECUTE ON FUNCTION public.admin_search_orders(text, integer, timestamptz, timestamptz) TO service_role$x$;

  -- ── 4. 索引(表達式與查詢**逐字相同**,否則規劃器對不上)────────────────────
  -- 🔴 一旦改上面任何一條表達式,**這裡要同批改**;兩邊分岔的症狀是「功能正常但很慢」,
  --    沒有任何測試會紅。
  EXECUTE $x$CREATE INDEX IF NOT EXISTS idx_orders_display_id_trgm
  ON public.orders USING gin
  ((pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(display_id,'')), E'[-_[:space:]\u3000\u00A0]', '', 'g')) extensions.gin_trgm_ops)$x$;

  -- 🔴 #12 與 #1 **不同形,不可照抄**:`legacy_display_id` 只有改過號的單才有值,
  --    其餘為 NULL ⇒ 經 COALESCE 一律變空字串 ⇒ 整表建 gin 會把絕大多數列索成同一個 ''
  --    ⇒ 又肥又沒選擇性。建成 partial,查詢側同步帶 `IS NOT NULL` 才對得上述詞。
  EXECUTE $x$CREATE INDEX IF NOT EXISTS idx_orders_legacy_display_id_trgm
  ON public.orders USING gin
  ((pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(legacy_display_id,'')), E'[-_[:space:]\u3000\u00A0]', '', 'g')) extensions.gin_trgm_ops)
  WHERE legacy_display_id IS NOT NULL$x$;

  EXECUTE $x$CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON public.customers USING gin
  ((pg_catalog.lower(pg_catalog.btrim(COALESCE(name,'')))) extensions.gin_trgm_ops)$x$;

  EXECUTE $x$CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm
  ON public.customers USING gin
  ((pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(phone,'')), '[^0-9]', '', 'g')) extensions.gin_trgm_ops)$x$;

  EXECUTE $x$CREATE INDEX IF NOT EXISTS idx_orders_ship_name_trgm
  ON public.orders USING gin
  ((pg_catalog.lower(pg_catalog.btrim(COALESCE(shipping_address_snapshot ->> 'name','')))) extensions.gin_trgm_ops)$x$;

  EXECUTE $x$CREATE INDEX IF NOT EXISTS idx_orders_ship_phone_trgm
  ON public.orders USING gin
  ((pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(shipping_address_snapshot ->> 'phone','')), '[^0-9]', '', 'g')) extensions.gin_trgm_ops)$x$;

  EXECUTE $x$CREATE INDEX IF NOT EXISTS idx_orders_ship_line_trgm
  ON public.orders USING gin
  ((pg_catalog.lower(pg_catalog.btrim(COALESCE(shipping_address_snapshot ->> 'line','')))) extensions.gin_trgm_ops)$x$;

  EXECUTE $x$CREATE INDEX IF NOT EXISTS idx_order_items_variant_sku_trgm
  ON public.order_items USING gin
  ((pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(variant_sku,'')), E'[-_[:space:]\u3000\u00A0]', '', 'g')) extensions.gin_trgm_ops)$x$;

  EXECUTE $x$CREATE INDEX IF NOT EXISTS idx_order_items_title_trgm
  ON public.order_items USING gin
  ((pg_catalog.lower(pg_catalog.btrim(COALESCE(product_snapshot ->> 'title','')))) extensions.gin_trgm_ops)$x$;

  EXECUTE $x$CREATE INDEX IF NOT EXISTS idx_order_item_procurement_supplier_no_trgm
  ON public.order_item_procurement USING gin
  ((pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(supplier_order_no,'')), E'[-_[:space:]\u3000\u00A0]', '', 'g')) extensions.gin_trgm_ops)$x$;

  -- ── #9 規格:**要建**(2026-08-12 A0-E 量測後 Sean 線裁 Q1=A;原本寫「不建」是錯的)──
  -- 🔴🔴 **改這支索引之前先讀完這段,否則會靜默答錯**:它建在 `public.pcm_spec_text()` 的
  --    **回傳值**上,而不是建在某個欄位上。後果:
  --    ① 任何人 `CREATE OR REPLACE FUNCTION public.pcm_spec_text` 之後,**這支索引就過期了** ——
  --       索引裡存的是舊定義算出來的字串,查詢用新定義再算一次,比不中。
  --       **PostgreSQL 不會擋、不會警告、查詢不會報錯**,只會少回訂單。
  --       ⇒ 改那支函式的人**必須同批 `REINDEX INDEX public.idx_order_items_spec_trgm`**。
  --       下面斷言 I-3 用「函式定義指紋」擋這件事(指紋不符就整片停)。
  --    ② `pcm_spec_text` 裡的 `ORDER BY key` 同理不可拿掉(理由寫在該函式旁,斷言 I-2 守)。
  --
  -- 為什麼推翻「不建」:原本的理由是「spec 低基數 ⇒ 索引不划算」。低基數這個**事實沒錯**,
  -- 但推論錯 —— 它只涵蓋「使用者真的搜規格值」那幾次。實際上 **#9 是 UNION 的一支,
  -- 每一次搜尋都會完整跑它**,而 `pcm_spec_text()` 是逐列函式呼叫 ⇒ 這條的成本與
  -- 「有沒有人搜規格」無關。A0-E 50k 級實測(拋棄式庫、已 ANALYZE、終端逐字):
  --    · 搜**訂單編號** `PCM-2025-04321`(該分支本來就有索引):331.8 ms → **3.7 ms**
  --    · 搜完全查無的亂碼:329.8 / 349.8 ms → **6.8 / 2.1 ms**
  --    · 搜規格寬 needle(10,000 命中):342.2 / 292.5 ms → **73.9 / 71.3 ms**
  --    四格全部變快、**沒有一格變慢**(寬 needle 那格是特地量的 —— 只證「查無變快」
  --    會漏掉「拿寬 needle 的效能換來的」那種可能)。代價:索引 936 kB
  --    = order_items 現有索引合計的 +4%;建立 177 ms;寫入放大在每月 100-300 筆訂單量下看不到。
  -- ⚠️ 誠實邊界:以上全部量在 **macOS 本機 PG17、全暖快取、C locale、拉丁 corpus**。
  --    比值(330 vs 2)可搬,絕對毫秒數不可搬。**中文沒量到** —— 正式站 spec 值是中文,
  --    而本機 macOS libc 對 CJK 抽零 trigram;短的中文 needle 在正式站走不走得到 gin_trgm
  --    (trigram 數不足時會退回掃描)**未量測**,列進 apply 後煙測。
  EXECUTE $x$CREATE INDEX IF NOT EXISTS idx_order_items_spec_trgm
  ON public.order_items USING gin
  ((pg_catalog.lower(pg_catalog.btrim(COALESCE(public.pcm_spec_text(product_snapshot -> 'spec'),'')))) extensions.gin_trgm_ops)$x$;

  -- 🔴 **#10 品牌刻意不建索引**(plan §4.4「可選」欄;A0-E 實測支持這個取捨):
  --    `brands` 是小表(正式站量級數十列),規劃器就是先掃它再往下走三跳。
  --    A0-E 50k 級實測:窄 needle 18.0 ms / 寬 needle 18.2 ms / **零命中 0.127 ms**
  --    (零命中那格 products→variants→orders 三層全是 `never executed`)⇒ 補索引是純成本。
  --    ⚠️ 這是**當下的取捨,不是永久結論** —— 驗收第 10 條的 EXPLAIN 若顯示這條變成瓶頸,
  --    就照 #9 這次的形狀補一支上去(表達式與查詢述詞必須逐字相同),並把 H 的清單同批加一行。

  -- ── 5. COMMENT ───────────────────────────────────────────────────────────
  EXECUTE $x$COMMENT ON FUNCTION public.admin_search_orders(text, integer, timestamptz, timestamptz) IS
  'M-4b #347-fuzzy:後台訂單搜尋。**12 維度**(訂單編號 / 舊訂單編號 legacy_display_id / 會員姓名 / 會員電話 / 收件快照 name-phone-line / 料號 / 品名 / 規格 / 品牌 / 供應商單號),回 {"ids": uuid[], "truncated": bool}。🔴 只回 order id —— PII 只在 SQL 內比對,不進讀模型、不進 RSC payload(shipping_address_snapshot 在鐵則 12 的 forbidden 清單裡,擴投影等於拆守門)。🔴 **形狀是 UNION 不是一大坨 OR**:A0 實測 OR 形狀下品項側索引規劃器拿不到(127.5ms vs 1.4ms)。🔴 **UNION 非 UNION ALL + 外層 SELECT DISTINCT**:一張訂單掛 N 個命中商品必須只算 1 筆,否則吃掉 N 個名額、把別的單擠出上限之外 = 靜默少回訂單。🔴 三類比對:識別碼類(訂單編號/舊編號/料號/供應商單號)與數字類(兩支電話)= 正規化子字串、**不套模糊**;文字類(姓名/收件人/地址/品名/規格/品牌)= 子字串 OR 詞相似度 `needle <% 目標`(**needle 在左**,寫反了語意顛倒且照樣編譯過)。模糊閾值走 pg_trgm.word_similarity_threshold,函式層 SET 釘死 0.4(起始值,調它要連驗收一起改)。🔴 三類 needle **各自檢查非空**:搜 `-` 時識別碼/數字類變空字串 ⇒ 那兩類整組跳過(否則 LIKE %% 撈全部);文字類不跳過 —— 資料裡真的可能有 `-`。🔴 本函式無任何 RAISE —— 搜尋詞本身是 PII,不得落進 server log(斷言 E 對 prosrc 文字掃描,連註解都算)。空字串/全空白 → 回空清單、不發查詢;修剪字元集顯式含 tab/U+3000/NBSP/U+202F/U+200B/BOM。長度 >120 → 回空清單(不擲例外:錯誤訊息不得含輸入原文)。p_limit:NULL 或 <=0 → 100,硬夾上限 100(對齊下游 .in() 的 URL 長度上限 ADMIN_ORDER_ID_IN_CAP=100);命中超過上限時只回前 p_limit 筆並 truncated=true(UI 必須顯示「結果太多請更精確」——靜默截斷會讓員工以為就這幾筆;多撈那一筆的存在理由是分辨「剛好觸頂」與「超過」,UI 不得改用 ids.length >= 上限 的啟發式)。🔴 品牌走 base 表 products/brands、**不讀 storefront_catalog_v**:那個 view 條件是 is_listed AND NOT hidden_from_store ⇒ 已下架商品的歷史訂單會整批搜不到(後台搜訂單歷史 vs 前台目錄 = 兩種答案)。品牌語意 = 搜**現在的**品牌(Sean Q2=A),畫面須標明。join 欄名注意:orders.customer_user_id 參照的是 customers.user_id,不是 customers.id。p_from/p_to:**半開區間 [p_from, p_to)**、皆 timestamptz、皆可為 NULL(NULL=該側不限);日期述詞在 LIMIT 之前生效 ⇒ 取樣窗口是「這段期間內最新 p_limit 筆」。時區解釋權在呼叫端。p_from > p_to ⇒ 自然回零筆、不擲例外。🔴 **上限是「候選集」上限,不是畫面筆數**:本函式回的 ≤100 筆 id 之後還會被清單查詢的 server 端分頁 `.range(offset, offset+limit-1)` 再切一次(`packages/adapters/src/supabase/SupabaseOrderAdapter.ts:835`)⇒ 員工看到的是「候選集裡的某一頁」,truncated 講的是候選集有沒有被截掉、與翻到第幾頁無關。**前一版權威字面 = `20260810150000:77`(八維度、strpos 子字串版)**,本片把它擴成 12 維度 + 模糊;要對照舊行為請直接讀那支 migration,不要憑本字串推。除 owner(postgres)與 superuser 外,僅 service_role 可執行。';

-- ── 6. 斷言區(承接 20260810120000 的 A-F,逐條保留 + 本片新增面)──────────
-- 🔴 **為什麼 migration 自己要帶斷言**:這些是 apply 當下才驗得到的東西
--    (catalog 形狀、ACL、擴充位置)。harness 跑在拋棄式 vanilla PG,
--    驗不到正式站的最終權限;兩者互補、不互相取代。$x$;

  -- ── 6. 斷言區(承接 20260810120000 的 A-F **逐條**,加本片新增面)────────
  -- G(本片新增). 擴充必須裝在 extensions schema
  --   裝錯 schema 的症狀:`search_path=''` 下 `OPERATOR(extensions.<%)` 直接找不到運算子。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_extension e
      JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
     WHERE e.extname = 'pg_trgm' AND n.nspname = 'extensions'
  ) THEN
    RAISE EXCEPTION '#347-fuzzy:pg_trgm 不在 extensions schema;拒繼續';
  END IF;

  -- A. 不是恰好一支(overload?)
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'admin_search_orders') <> 1 THEN
    RAISE EXCEPTION '#347-fuzzy:admin_search_orders 不是恰好一支(overload?);拒繼續';
  END IF;

  -- B. 參數名逐字凍結 —— PostgREST 靠**名字**挑函式,改名 = 正式站 PGRST202
  --    (a9h 事故形狀:正式站壞約 8 小時)。
  SELECT pg_catalog.pg_get_function_arguments(p.oid) INTO v_args
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_search_orders';
  IF v_args <> 'p_query text, p_limit integer DEFAULT 100, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone' THEN
    RAISE EXCEPTION '#347-fuzzy:簽章漂了(PostgREST 會 404):[%];拒繼續', v_args;
  END IF;

  -- D. SECDEF + search_path='' + owner
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.admin_search_orders(text, integer, timestamptz, timestamptz)'::regprocedure
       AND p.prosecdef
       -- 🔴 字面注意:`SET search_path = ''` 在 proconfig 存成 `search_path=""`(含兩個雙引號)
       --    —— `20260810120000:266` 早就寫了這條警語,我第一版照直覺寫 `search_path=`
       --    當場被本斷言擋下(實測 exit=3)。字面以 `SELECT proconfig` 實查為準。
       AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION '#347-fuzzy:admin_search_orders 的 SECDEF/search_path 不符;拒繼續';
  END IF;

  -- D2(本片新增). 模糊閾值必須釘在函式層,不能靠呼叫端或 session 預設
  --    少了它:預設 0.6 之下「打錯一個字母」多半就不命中了 = 本片的招牌功能靜默失效,
  --    而所有結構斷言照樣全綠。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.admin_search_orders(text, integer, timestamptz, timestamptz)'::regprocedure
       AND p.proconfig @> ARRAY['pg_trgm.word_similarity_threshold=0.4']
  ) THEN
    RAISE EXCEPTION '#347-fuzzy:函式層沒釘 word_similarity_threshold=0.4;拒繼續';
  END IF;

  -- ══ E 族的共用前處理:把函式體剝成「可掃描的形狀」 ══════════════════════════
  -- 🔴 codex K2 2026-08-12 must-fix 3c:E2/E3 原本直接掃 `prosrc`,**兩種等價語法繞得過**:
  --    ① 註解 —— `FROM public./*x*/storefront_catalog_v` 把正規式的 `\s+` 拆開;
  --    ② 引號識別字 —— `FROM public."storefront_catalog_v"` 與加了空白的 `public . x`。
  --    ⇒ 先做一次正規化,E2/E3 之後都掃這份 `v_src`,不再各自掃 raw prosrc。
  -- ⚠️ 誠實邊界(三條,不要讀成「等價於語法解析」):
  --    · 剝註解用的是正規式,**不理解字串常值** —— 函式體裡若有字串常值內含 `--` 或 `/*`,
  --      會被誤剝。本函式體沒有這種常值(已逐一看過),但下一代加了就要重看這條。
  --    · 拿掉所有雙引號會讓守門**更嚴格**(可能誤擋),不會更鬆 —— 這個方向是故意選的。
  --    · 它仍然是**文字掃描**,不是語法樹。擋得住的是「照常規寫法繞過」,
  --      擋不住刻意的字串拼接動態 SQL(本函式沒有動態 SQL,那個面由 code review 守)。
  SELECT
    pg_catalog.regexp_replace(                                   -- 4) 點號兩側空白收掉
      pg_catalog.regexp_replace(                                 -- 3) 拿掉引號識別字的引號
        pg_catalog.regexp_replace(                               -- 2) 剝行註解
          pg_catalog.regexp_replace(p.prosrc, '/\*.*?\*/', ' ', 'gs'),  -- 1) 剝區塊註解
          '--[^' || pg_catalog.chr(10) || ']*', ' ', 'g'),
        '"', '', 'g'),
      '\s*\.\s*', '.', 'g')
    INTO v_src
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_search_orders(text, integer, timestamptz, timestamptz)'::regprocedure;
  IF v_src IS NULL OR pg_catalog.length(v_src) < 500 THEN
    -- 🔴 前置閘:剝完只剩不到 500 字元 = 剝壞了(或函式根本不是我想的那支)
    --    ⇒ 下面三條掃描全部會變成「掃空字串 ⇒ 什麼都掃不到 ⇒ 全綠」的恆真格。
    RAISE EXCEPTION '#347-fuzzy:函式體正規化後只剩 % 字元,E 族掃描會恆真;拒繼續', COALESCE(pg_catalog.length(v_src), -1);
  END IF;

  -- E. 搜尋詞不落 log:函式本體不得出現任何 RAISE
  --    🔴 這條**刻意掃 raw `prosrc`(連註解都算)**,不掃 v_src —— 與 E2/E3 相反。
  --    理由:E 防的是「有人寫了 RAISE」,而註解裡出現那個字代表下一代很可能正要加一行。
  --    寧可誤擋(改成寫「擲例外」很便宜),也不要漏掉。本檔函式體因此一律寫「擲例外」。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.admin_search_orders(text, integer, timestamptz, timestamptz)'::regprocedure
       AND p.prosrc ~* '\mRAISE\M'
  ) THEN
    RAISE EXCEPTION '#347-fuzzy:admin_search_orders 函式體出現 RAISE(搜尋詞可能落進 log);拒繼續';
  END IF;


  -- E2(本片新增). 品牌分支不得讀 storefront_catalog_v
  --    讀了的症狀:已下架商品的歷史訂單整批從搜尋結果消失,**零告警**(733 筆那個機制)。
  -- 🔴 掃 `v_src`(已剝註解、已拿掉引號、已收點號空白),不是 raw prosrc。演進史:
  --    ① 第一版寫成裸的 `~* 'storefront_catalog_v'`,當場被函式體裡那句
  --       「刻意**不是** storefront_catalog_v」的**註解**命中 = 偵測器命中自己的輸入、
  --       恆真擋自己(實測 exit=3)⇒ 改成只認 FROM/JOIN 後面那個位置。
  --    ② 但②仍被 `/*x*/` 與 `public."x"` 兩種寫法繞得過(codex K2)⇒ 改掃正規化後的 v_src。
  --    ⇒ 註解那條誤擋的老問題也一併消失了:v_src 裡根本沒有註解。
  --    🔴 **這條必須排在 E-4 前面**(2026-08-12 突變輪實測才發現)。
  --      任何 E2 抓得到的字串都含 `public.storefront_catalog_v` ⇒ E-4 的白名單一定也會紅
  --      ⇒ **E2 被 E-4 嚴格蘊含**。第一版把 E-4 排在前面時,兩發繞道突變(`/**/` 與引號)
  --      **全部紅在 E-4**、E2 從頭到尾沒被執行 —— 那時 E2 是一條「寫不出只紅它的負測」的死規則。
  --      調到 E-4 前面之後它才真的有判別力(突變輪 M05/M06 現在紅在這條),
  --      而 E-4 繼續守它自己那個更大的面。⇒ **不要為了「泛用的排前面」把順序調回去。**
  IF v_src ~* '(FROM|JOIN)\s+public\.storefront_catalog_v' THEN
    RAISE EXCEPTION '#347-fuzzy:函式體讀到 storefront_catalog_v(已下架商品的訂單會搜不到);拒繼續';
  END IF;

  -- E3(本片新增). 去重不得退化成 UNION ALL
  --    退化的症狀:一張掛 N 個命中商品的單吃掉 N 個名額、把別的單擠出上限外 = 靜默少回訂單。
  -- 🔴 同 E2 掃 v_src。**副作用是本檔函式體的註解不必再閃避「UNION ALL」四個字** ——
  --    但我沒有回頭去改那些註解的寫法(它們寫成「去重不得退化」也讀得通),
  --    留著只是歷史痕跡,不是還需要的閃避。
  -- ⚠️ 誠實邊界:它**擋不住**「用別的方式製造重複列」(例如把外層 DISTINCT 拿掉)——
  --    那個面由驗收那格的行為測試 + 突變守,不是這條。
  IF v_src ~* '\mUNION\s+ALL\M' THEN
    RAISE EXCEPTION '#347-fuzzy:函式體出現 UNION ALL(單張多商品訂單會被算成多筆);拒繼續';
  END IF;

  -- E-4(本片新增,codex K2 must-fix 3b + 3e 合成一條). 函式體只准碰白名單裡的 `public.*`。
  --   擋兩件事,一條解決:
  --   ① **間接外洩**:把搜尋詞交給另一支 public 函式,而那支函式裡有 RAISE/INSERT log ——
  --      E 只掃本函式體,對這種轉手完全盲。
  --   ② **F 的閉世界被綁上**:F 那條檢查「七張表沒開 FORCE RLS」,但七張表是**手打的清單** ——
  --      函式日後多讀第八張表,F 的清單不會自己長出來,那張表開了 FORCE RLS 就靜默漏單。
  --      這條讓「函式體出現清單外的 public.X」當場紅 ⇒ 逼下一代同批更新兩邊。
  --   ⚠️ 誠實邊界:白名單比對的是**識別字文字**,不是解析出來的相依。未加 `public.` 限定的
  --      呼叫抓不到 —— 但本函式 `search_path=''`,不限定根本跑不起來(D 那條守著),
  --      所以在這支函式上這個缺口是被別條堵住的,不是沒堵。
  SELECT pg_catalog.string_agg(DISTINCT m.parts[1], ',' ORDER BY m.parts[1])
    INTO v_missing
    FROM pg_catalog.regexp_matches(v_src, 'public\.([a-zA-Z_][a-zA-Z0-9_]*)', 'g') AS m(parts)
   WHERE m.parts[1] NOT IN (
     -- 七張表(與 F 的清單**必須逐字相同**;改一邊要改兩邊)
     'orders', 'customers', 'order_items', 'product_variants', 'products', 'brands',
     'order_item_procurement',
     -- 本片自建、唯一允許被呼叫的 public 函式
     'pcm_spec_text');
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '#347-fuzzy:函式體出現白名單外的 public 物件 [%] —— 若是新讀的表,F 的 FORCE RLS 清單要同批加;若是新呼叫的函式,先確認它不會把搜尋詞寫進 log;拒繼續', v_missing;
  END IF;

  -- C. ACL:除 owner 與 superuser 外,只有 service_role 可執行
  -- 🔴 **比的是完整 acl 形狀,不是 grantee 名單**(codex K2 2026-08-12 must-fix 2b)。
  --    原本只 `string_agg(DISTINCT grantee)` ⇒ 這三種變化它**全都看不到**:
  --      ① service_role 被多授了 EXECUTE 以外的權限(函式上還有 USAGE 這類形狀)
  --      ② service_role 那份帶了 `WITH GRANT OPTION`(可以再轉發給任何人)
  --      ③ 同一個 grantee 出現多列不同 privilege ⇒ DISTINCT 把它們摺成一個名字
  --    ⇒ 改成把「grantee : 權限 : 可否轉發」三個維度接成一條字串做**全等比對**,
  --    期望值逐字 `service_role:EXECUTE`(沒有 `*` 就是沒有 grant option)。
  --    這是閉世界:多一列、少一列、多一個星號都會紅。
  SELECT pg_catalog.string_agg(
           a.grantee::regrole::text || ':' || a.privilege_type
             || CASE WHEN a.is_grantable THEN '*' ELSE '' END,
           ',' ORDER BY a.grantee::regrole::text, a.privilege_type)
    INTO v_missing
    FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
   WHERE p.oid = 'public.admin_search_orders(text, integer, timestamptz, timestamptz)'::regprocedure
     AND a.grantee <> p.proowner;
  IF COALESCE(v_missing, '') <> 'service_role:EXECUTE' THEN
    RAISE EXCEPTION '#347-fuzzy:admin_search_orders 的非 owner acl 形狀是 [%],期望 service_role:EXECUTE;拒繼續', COALESCE(v_missing, '(空)');
  END IF;

  -- H(本片新增). 11 支 trigram 索引必須都在,且**逐支比四個維度**
  --    少一支的症狀:功能完全正常、只是慢 —— 沒有任何測試會紅。
  -- 🔴 演進史(codex K2 2026-08-12 must-fix 3d):
  --    ① 第一版只比**索引名存在** ⇒ 表達式改壞、名字留著,照樣綠(存在性守門的恆真形狀)。
  --    ② 第二版改比三個共用片段(`USING gin` / `gin_trgm_ops` / `regexp_replace|btrim`)——
  --       仍然漏三個維度:**建在哪張表**(同名索引建到別張表,三個片段全中)、
  --       **#12 的 partial 述詞**(掉了會變成又肥又沒選擇性,片段照樣全中)、
  --       以及**索到哪一欄**(把 `->> 'title'` 改成 `->> 'name'`,片段也全中)。
  --    ③ 現在:每支索引自帶「期望的表 + 期望的表達式關鍵片段」,四個維度逐支比。
  --
  -- ⚠️ **誠實邊界 —— 這不是 `indexdef` 全等比對**。我沒有把 PG 正規化後的完整定義字串
  --    釘進來(那要 11 條長 literal、且跨 PG 版本的 normalize 輸出會變、維護成本高於收益)。
  --    ⇒ **擋得住**:索引不見、建錯表、少了 gin/opclass/正規化函式、partial 述詞掉了或多了、
  --      索錯欄位或錯的 jsonb 鍵。**擋不住**:在同一欄上把表達式換成另一個仍含同樣關鍵片段
  --      的寫法(例如多包一層 `COALESCE`)—— 那種形狀由「索引走不走得到」的 EXPLAIN 驗收守,
  --      不是這條。**不要把這條讀成「索引定義沒被動過」的證明。**
  SELECT pg_catalog.string_agg(x.want || ' ⇒ ' || COALESCE(i.indexdef, '(不存在)'), E'\n')
    INTO v_missing
    FROM (VALUES
      -- 索引名                                         期望的表                  期望的表達式關鍵片段
      ('idx_orders_display_id_trgm',                   'orders',                 'display_id'),
      ('idx_orders_legacy_display_id_trgm',            'orders',                 'legacy_display_id'),
      ('idx_customers_name_trgm',                      'customers',              'name'),
      ('idx_customers_phone_trgm',                     'customers',              'phone'),
      ('idx_orders_ship_name_trgm',                    'orders',                 '''name'''),
      ('idx_orders_ship_phone_trgm',                   'orders',                 '''phone'''),
      ('idx_orders_ship_line_trgm',                    'orders',                 '''line'''),
      ('idx_order_items_variant_sku_trgm',             'order_items',            'variant_sku'),
      ('idx_order_items_title_trgm',                   'order_items',            '''title'''),
      ('idx_order_items_spec_trgm',                    'order_items',            'pcm_spec_text'),
      ('idx_order_item_procurement_supplier_no_trgm',  'order_item_procurement', 'supplier_order_no')
    ) AS x(want, want_table, want_expr)
    LEFT JOIN pg_catalog.pg_indexes i
      ON i.schemaname = 'public' AND i.indexname = x.want
   WHERE i.indexdef IS NULL
      -- 維度 1:建在哪張表。
      OR i.tablename <> x.want_table
      -- 維度 2:索到哪個欄位 / 哪個 jsonb 鍵。
      -- 🔴 **只在 `USING gin` 之後那一段找,不能在整串 indexdef 裡找** —— indexdef 的開頭是
      --    `CREATE INDEX idx_customers_name_trgm ON …`,**索引自己的名字就含著 `name`**
      --    ⇒ 在整串裡找會被自己的輸入命中、這一格恆真(十一支裡有六支會這樣)。
      --    這是本檔第三次踩「偵測器命中自己的輸入」(E2 的 storefront_catalog_v 是第一次)。
      -- (用 `strpos(串, 找什麼)` 而不是 `position(找什麼 IN 串)`:後者是特殊語法、
      --  **不能加 schema 限定**,寫成 `pg_catalog.position(a IN b)` 是語法錯誤、實測擋下。)
      OR pg_catalog.strpos(
           pg_catalog.substr(i.indexdef, pg_catalog.strpos(i.indexdef, 'USING gin')),
           x.want_expr) = 0
      -- 維度 3:真的是 gin + trigram opclass + 套了正規化函式。
      OR i.indexdef !~ 'USING gin'
      OR i.indexdef !~ 'gin_trgm_ops'
      OR i.indexdef !~ 'regexp_replace|btrim'
      -- 維度 4:partial 與否。#12 是**唯一**該有 WHERE 的;其餘十支多了 WHERE
      --         = 有一部分資料永遠搜不到(靜默漏單)。
      OR (x.want =  'idx_orders_legacy_display_id_trgm'
          AND i.indexdef !~ 'WHERE \(legacy_display_id IS NOT NULL\)')
      OR (x.want <> 'idx_orders_legacy_display_id_trgm' AND i.indexdef ~ ' WHERE ');
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION E'#347-fuzzy:trigram 索引缺漏或定義不符;拒繼續\n%', v_missing;
  END IF;

  -- ══ 以下五條是 code-reviewer(2026-08-12)抓到「宣稱承接 A-F 卻掉了」的部分 ══
  -- 🔴 我原本的檔頭寫「承接 120000 的 A-F **逐條保留**」,實查掉了四條:
  --    C-0(owner)/ C-2(GRANT OPTION)/ C-3(角色繼承)/ F(FORCE RLS)。
  --    對一支以 definer 身分掃 7 張表、且那些表含 PII 的函式,C-3 與 F 是安全與漏單的主防線。
  --    ⇒ 補回,並把檔頭那句從「宣稱」變成「事實」。

  -- C-0. owner 必須是 postgres(承 120000)
  --      owner 換人 = 這支 SECDEF 函式的執行身分換人,底下七張表的可見範圍跟著變。
  IF (SELECT r.rolname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
       WHERE p.oid = 'public.admin_search_orders(text, integer, timestamptz, timestamptz)'::regprocedure) <> 'postgres' THEN
    RAISE EXCEPTION '#347-fuzzy:admin_search_orders 的 owner 不是 postgres(SECDEF 執行身分變了);拒繼續';
  END IF;

  -- C-2. 🔴 **`WITH GRANT OPTION` 收不回來**(承 120000):拿到轉發權的角色可以再 GRANT 給別人,
  --      而上面的集合相等式**看不到 grantable 這個維度** —— acl 裡仍然只有 service_role 一列。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     WHERE p.oid = 'public.admin_search_orders(text, integer, timestamptz, timestamptz)'::regprocedure
       AND a.grantee <> p.proowner
       AND a.is_grantable
  ) THEN
    RAISE EXCEPTION '#347-fuzzy:admin_search_orders 有帶 GRANT OPTION 的 grantee(可再轉發);拒繼續';
  END IF;

  -- C-3. 🔴 **有效權限,不是 ACL 字面**(承 120000):`GRANT service_role TO anon` 這種**角色繼承**
  --      會讓 anon 拿到 service_role 的全部權限,而 proacl 裡**完全看不到**。
  --      不列舉角色名 —— 掃**所有**非 superuser、非 owner、非 service_role 的角色。
  SELECT r.rolname INTO v_role
    FROM pg_catalog.pg_roles r, pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_search_orders(text, integer, timestamptz, timestamptz)'::regprocedure
     AND NOT r.rolsuper
     AND r.oid <> p.proowner
     AND r.rolname <> 'service_role'
     AND has_function_privilege(r.oid, p.oid, 'EXECUTE')
   LIMIT 1;
  IF v_role IS NOT NULL THEN
    RAISE EXCEPTION '#347-fuzzy:角色 % 有效可執行 admin_search_orders(直接 GRANT 或角色繼承);拒繼續', v_role;
  END IF;

  -- C-4. 正向:service_role **必須**執行得了(承 120000 的 D)
  --      少了這條,把 GRANT 整行刪掉時上面三條全綠(零 grantee 更「安全」)而功能全死。
  IF NOT has_function_privilege('service_role',
        'public.admin_search_orders(text, integer, timestamptz, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '#347-fuzzy:service_role 執行不了 admin_search_orders(GRANT 漏了?);拒繼續';
  END IF;

  -- F. 🔴 **FORCE ROW LEVEL SECURITY 會把 SECDEF 自己擋死**(承 120000)。
  --    本函式以 definer 身分讀**七張表**;任何一張日後開了 FORCE,連 owner 都會被自己的 policy
  --    過濾 ⇒ **搜尋靜默漏單**,而且 **superuser 跑的 harness 永遠看不到**(superuser 不受 RLS 影響)
  --    ⇒ 只有這道斷言擋得住。
  -- 🔴 **這張清單是手打的,它的完整性由上面 E-4 綁著**(codex K2 must-fix 3e):
  --    函式日後多讀第八張表時,這裡不會自己長出來 —— 但 E-4 會因為「白名單外的 public 物件」
  --    當場紅,逼人同批更新兩處。⇒ **改這張清單時,E-4 那張要逐字一起改。**
  SELECT pg_catalog.string_agg(c.relname, ',') INTO v_missing
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('orders','customers','order_items','product_variants','products','brands','order_item_procurement')
     AND c.relforcerowsecurity;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '#347-fuzzy:表 [%] 開了 FORCE RLS ⇒ SECDEF 會被自己的 policy 擋、搜尋靜默漏單;拒繼續', v_missing;
  END IF;

  -- I(本片新增,code-reviewer minor 15). pcm_spec_text 自己也要有斷言 ——
  --   它是本片新建的物件,#9 分支每一列都會呼它;它不見了或 ACL 開了,上面的斷言一條都不會紅。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid = 'public.pcm_spec_text(jsonb)'::regprocedure
       AND p.provolatile = 'i'
  ) THEN
    RAISE EXCEPTION '#347-fuzzy:pcm_spec_text 不存在或不是 IMMUTABLE;拒繼續';
  END IF;
  -- 同 C:比完整 acl 形狀(grantee:權限:可否轉發),不是只比名字。
  SELECT pg_catalog.string_agg(
           a.grantee::regrole::text || ':' || a.privilege_type
             || CASE WHEN a.is_grantable THEN '*' ELSE '' END,
           ',' ORDER BY a.grantee::regrole::text, a.privilege_type)
    INTO v_missing
    FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
   WHERE p.oid = 'public.pcm_spec_text(jsonb)'::regprocedure
     AND a.grantee <> p.proowner;
  IF COALESCE(v_missing, '') <> 'service_role:EXECUTE' THEN
    RAISE EXCEPTION '#347-fuzzy:pcm_spec_text 的非 owner acl 形狀是 [%],期望 service_role:EXECUTE;拒繼續', COALESCE(v_missing, '(空)');
  END IF;

  -- I-2(本片新增,codex K2 must-fix 3a). `pcm_spec_text` 的**行為**微探針。
  --   🔴 為什麼這條可以在 apply 當下跑:它是純函式,**不需要任何測資** ——
  --      餵固定 literal 進去、比對期望字串出來。上面 I 只驗「存在且 IMMUTABLE」,
  --      把函式體改成 `SELECT ''` 那格照樣全綠(存在性守門的典型恆真形狀)。
  --   🔴 這條同時是 `ORDER BY key` 的守門:期望值 `black M` 是**鍵名字典序**的結果;
  --      拿掉 ORDER BY 會退回 jsonb 儲存鍵序(短鍵在前)= `M black` ⇒ 這格紅。
  --      #9 的表達式索引整個建立在這個順序上,所以它必須有人守。
  IF (SELECT public.pcm_spec_text('{"color":"black","size":"M"}'::jsonb)) <> 'black M' THEN
    RAISE EXCEPTION '#347-fuzzy:pcm_spec_text 行為不符 —— 餵 {color:black,size:M} 得到 [%],期望 [black M](鍵名字典序;順序變了 #9 的表達式索引就比不中);拒繼續',
      (SELECT public.pcm_spec_text('{"color":"black","size":"M"}'::jsonb));
  END IF;
  IF (SELECT public.pcm_spec_text('{}'::jsonb)) <> '' THEN
    RAISE EXCEPTION '#347-fuzzy:pcm_spec_text 對空物件應回空字串(COALESCE 那層);拒繼續';
  END IF;

  -- I-3(本片新增,Sean 線裁 2026-08-12 B-518-A ③). `pcm_spec_text` 的**定義指紋**。
  --   🔴 為什麼需要它,而 I-2 的行為探針不夠:`idx_order_items_spec_trgm` 是建在這支函式的
  --      **回傳值**上。函式被 `CREATE OR REPLACE` 之後,**索引不會自動重建** ——
  --      索引裡存的是舊定義算出的字串,查詢用新定義再算一次,比不中 ⇒ **靜默少回訂單**。
  --      PostgreSQL 對這件事不擋、不警告、查詢也不報錯。
  --      I-2 擋得住「改成別的順序/回空字串」這類**行為看得出來**的改法,但擋不住
  --      「行為在我這兩個探針上剛好一樣、對別的輸入不一樣」的改法 —— 而那正是索引會答錯的情形。
  --   ⇒ 指紋比對:定義變了就整片停,逼人自覺。
  --   ⚠️ 誠實邊界:這條擋的是「**這支 migration 被重放時**函式已經被別人改過」。
  --      它**擋不住**「本片 apply 完之後,未來某支 migration 改了函式卻沒 REINDEX」——
  --      那條路沒有 DB 層的守門可畫(PG 不提供這種 hook)⇒ 由這裡的錯誤訊息 +
  --      索引旁那段硬警告 + plan 的交接段承載。**這是誠實缺口,不是已守住。**
  --   期望值 `682398a8…` 的來源:**2026-08-12 在拋棄式庫實跑 `SELECT md5(prosrc)` 抄回來的**
  --   (不是我照著上面的函式體手算的 —— 手寫轉義重建一份函式體副本太容易差一個換行,
  --    而差一個字的後果是每次 apply 都假紅)。對應的 prosrc 逐字是:
  --       \n  SELECT COALESCE(\n           (SELECT pg_catalog.string_agg(value, ' ' ORDER BY key)\n              FROM pg_catalog.jsonb_each_text(p)),\n           '')\n
  --   改函式後重取指紋的方法:把新版套進拋棄式庫,跑
  --       SELECT md5(prosrc) FROM pg_proc WHERE oid='public.pcm_spec_text(jsonb)'::regprocedure;
  SELECT pg_catalog.md5(p.prosrc) INTO v_fp
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.pcm_spec_text(jsonb)'::regprocedure;
  IF v_fp <> '682398a85ddaf5c26994b67d08153362' THEN
    RAISE EXCEPTION '#347-fuzzy:pcm_spec_text 的定義指紋不符(實得 %)—— 有人改過這支函式。🔴 改它必須同批 `REINDEX INDEX public.idx_order_items_spec_trgm`(#9 的表達式索引建在它的回傳值上,PG 不會自動重建、也不會報錯,只會靜默少回訂單),並把本斷言的期望指紋一起更新;拒繼續', v_fp;
  END IF;

  -- 🔴 這行的兩個數字(19 / 11)與檔頭第 7 項**必須同時改**;它們是同一個事實的三個字面。
  RAISE NOTICE '#347-fuzzy OK(斷言 19 條 + 1 道前置閘全過):pg_trgm@extensions / 簽章凍結 / SECDEF+search_path / 閾值 0.4 / 零 RAISE / public 白名單 / 不讀 catalog_v / 無 UNION ALL / acl 形狀=service_role:EXECUTE / 11 支索引定義相符 / pcm_spec_text 行為+指紋';
END
$mig$;
