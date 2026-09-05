-- ⟦b4-NORECIPIENTWINDOW⟧ 乙半:`customers.email` 不准是空白。
-- 🔵 授權:Sean 2026-09-05 逐字「**Q-空信箱約束:A: 甲**」(要擋)。主視窗 `-f8` 指定版本號 380000。
--
-- ══ 這一支在解什麼 ═══════════════════════════════════════════════════════════
-- 四支寄信掃描面的收件人述詞是 `nullif(btrim(email, JS_WS), '') IS NULL` ⇒ **它把純空白也算空**。
-- 而 `customers.email` 今天只有 `NOT NULL`(`20260523034911:16` 逐字 `email text NOT NULL UNIQUE`)
-- ⇒ 🛑 **`NOT NULL` 擋得住 NULL, 擋不住 `''` 與 `'   '`。**
-- ⇒ 今天真正在擋的是**應用層的 zod**(`packages/schemas/src/index.ts` 的 `z.email(...)`
--    + `apps/storefront/src/lib/auth/field-validation.ts` 的空值擋)
-- ⇒ 📌 **任何一條不走註冊頁的寫入路(RPC / 後台 / 匯入 / 手動 SQL / 未來的第三方登入)都繞得過它。**
--
-- ══ 🔴 它【不是】什麼 —— 這一段不要刪 ════════════════════════════════════════
-- 本約束擋的是「**空與純空白**」, **不是**「這是不是一個真的信箱」。
-- ⇒ `'x'` / `'@'` / `'不是信箱'` 它**全部放行**。格式那一半是 zod 的事。
-- 🛑 **兩者不可互相頂替** —— 而最容易發生的誤讀是:有人看到 DB 有約束了, 就把 zod 那半拿掉。
--
-- ══ ⚠️ 它會改變什麼行為(明寫, 不藏)══════════════════════════════════════════
-- 註冊那條路是 `handle_new_auth_user` trigger 直接寫 `NEW.email`(`20260831150000:178-181`)。
-- ⛔ ~~若哪天有一條 auth 路徑產生【空字串】email(手機註冊 / 某些第三方登入),
--    今天它會安靜地建出一個空信箱的客戶列~~ ⇒ 🔴 **這句我寫寬了(codex nit)**:
--    GoTrue 那幾條路(手機註冊 / Google 缺 email)給的是 **SQL NULL 不是空字串**,
--    而 NULL **今天就已經被既有的 `NOT NULL` 擋住** ⇒ 那些路徑不會安靜地建出空信箱列。
-- ✅ **本約束真正新增的射程, 是【空字串與純空白】那一段** —— 而會產生那一段的是
--    **繞過註冊頁的寫入路**(後台 / RPC / 匯入 / 手動 SQL), 不是 auth 本身。
-- ⚠️ **而行為改變那一句仍然成立**:哪天真有一條路送進空字串, 今天是安靜地寫進去,
--    貼了本支之後是**當場失敗** ⇒ 📌 **把一個安靜的壞資料, 換成一個吵的失敗。**
-- 🔵 codex 同一輪核過現行四條註冊路(Email / Google / LINE / 後台散客)**都給非空信箱**
--    ⇒ **沒有現行路徑會被這道約束打壞。**
--
-- ══ 🔵 為什麼字集用【內嵌字面】而不是呼叫 `public.pcm_js_trim_whitespace()` ═══════
-- 那支函式**只 GRANT 給 `service_role`**(`20260905050000:115`,同檔 `:159` 還有一道
-- 「anon 執行得到它就報錯」的事後閘)⇒ 🛑 **把它寫進 CHECK, 任何沒有 EXECUTE 的角色做 INSERT
--    都會被 permission denied 擋下** —— 那是一個比原問題更大的洞。
-- ⇒ ✅ 內嵌字面, 而**漂移由【貼上去那一刻的自證】綁**(⛔ ~~由 TS 側 parity 測試綁住~~ —— 那支測試
--    在同一個 diff 裡被刪了, 理由見下一段;R3 抓到這句與 COMMENT 那句都還留著舊字面)—— 見下方自證①:
--    它逐字元取自 `public.pcm_js_trim_whitespace()` 的**回傳值**, 拿真的那道約束跑一遍。
--
-- 🔴🔴 **而那支 TS parity 測試【已刪除】, 這一段寫下為什麼** ——
--    ⛔ ~~`packages/domain/src/order/customers-email-check-ws-parity.test.ts`(讀本檔字面去比函式字面)~~
--    🛑 codex 兩輪一共五條 finding 全部打穿它, 而**五條打的是同一件事:它在用文字解析 SQL**
--      (`-- );` 讓解析器提早截斷 · 大寫識別字讓比對失明 · 把字元藏進註解讓字集尺數到它)。
--    ⇒ 📌 **再補三個格子, 第四輪還會有第四種寫法。** 而自證①**結構上**碰不到那些花招:它不讀檔。
--    ⚠️ **代價明寫, 而我第一版把它寫得太絕**(R3 nit):
--      ⛔ ~~漂移現在不在 CI 紅~~ ⇒ 🔵 **本支的探針帶 `# ci-self-contained: yes`,
--        而 `.github/workflows/ci.yml` 會自動認領並跑它** ⇒ **CI 會紅。**
--      🛑 **真正的代價要講精確**:CI 跑的是探針**自己 fixture 裡那一份**函式抄本
--        ⇒ 它證得到「機制會動」, **證不到「正式庫那支函式與這道約束一致」**
--        ⇒ 📌 **那一格只有 apply 那一刻量得到** —— 而它在那一刻是 fail-closed(紅了就貼不進去)。
--      ⇒ 動那支函式的人:改完請把本支在拋棄式 PG 上重跑一次(`docs/probes/customers-email-not-blank-probe.sh`),
--        並記得 CI 那一發**不會**替你檢查正式庫那一份。
--
-- ══ ROLLBACK ═══════════════════════════════════════════════════════════════
-- `ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_email_not_blank;`
-- 🔵 零資料改動 ⇒ 退掉之後回到「只有 NOT NULL」= 今天。
--
-- ══ 貼之前的前置(已由 `-mail` 2026-09-05 深夜唯讀量過)═══════════════════════
-- `customers` 15 列 · email 為 NULL **0** · 空字串 **0** · **空白或純空白 0**;
-- 🔵 正對照:有真值的 **15** · 含 `@` 的 **15** ⇒ 尺會動 ⇒ **那個 0 算數**。
-- 🛑 而下面的前置閘會**自己再量一次** —— 因為那是量測時刻的讀數, 而貼的是另一刻。

-- 🔴 **`NULLIF` 是【語法】不是函式 ⇒ 不可寫 `pg_catalog.nullif`**(本檔第一版寫了, 探針當場紅:
--    `function pg_catalog.nullif(text, unknown) does not exist`)。`COALESCE` / `CASE` 同族。
--    ⇒ 📌 它們不吃 search_path, 所以**不加限定才是對的**, 不是偷懶。
BEGIN;

-- 🔴🔴 **`lock_timeout` 不是保險, 是這一支能不能安全貼的前提**(codex must-fix ②)。
--   `ADD CONSTRAINT` 拿 **ACCESS EXCLUSIVE** 並掃描既有列 ⇒ 只要有**任何一個長交易**
--   正握著 `customers` 的衝突鎖, 這一句會**無限等待**, 而排在它後面的每一個查詢一起卡住
--   ⇒ 📌 **一支「只是加個約束」的 migration, 可以把整站的登入卡死。**
--   ✅ 5 秒拿不到就放棄整支(它是 `SET LOCAL` ⇒ 只活在本交易, 不影響別人)。
--   ⚠️ **超時的錯誤訊息是 `lock_not_available`** —— 撞到它**不是這支寫錯**, 是當下有人佔著鎖:
--     等那個交易結束再貼一次即可,**不要為了貼進去把這一行拿掉**。
SET LOCAL lock_timeout = '5s';
-- 🔵 **拿到鎖之後的掃描也要有上界**(R3 nit)—— `lock_timeout` 只管**等鎖**那一段。
--    今天 `customers` 15 列, 掃描是瞬間的 ⇒ 這一行**今天沒有作用**;
--    而它在「這張表長到幾十萬列」的那天才有用, 那時沒有人會回來加它。
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  v_all integer;
  v_bad integer;
BEGIN
  IF pg_catalog.to_regclass('public.customers') IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 public.customers';
  END IF;
  -- 🔴 自證那一段【逐字元】的分母來自這支函式的回傳值 ⇒ 它不在就沒有分母。
  --    ⚠️ 而本約束的**本體**不呼叫它(理由見檔頭:它只 GRANT service_role)——
  --    📌 **依賴只在【驗證】這一層, 不在【執行】那一層。兩者不要合起來讀。**
  IF pg_catalog.to_regprocedure('public.pcm_js_trim_whitespace()') IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 public.pcm_js_trim_whitespace() ⇒ 自證的逐字元分母取不到, 先貼 20260905050000';
  END IF;
  -- 🔴 **「它在」不等於「它是新的那一版」**(R3 nit):`20260905050000` 之前那一版的字集是 **23** 個碼位,
  --    在它之前貼本支 ⇒ 逐字元自證的**分母少兩個**, 而每一格照樣綠。
  --    ⇒ 📌 **一個分母變窄的驗證, 印的是同一個綠。** ⇒ 釘住長度。
  --    🔵 25 這個數字的來源:`20260905050000` 自己的事後閘①逐字「ECMA-262 那張表算出來是 25」。
  IF pg_catalog.length(public.pcm_js_trim_whitespace()) <> 25 THEN
    RAISE EXCEPTION '前置閘:pcm_js_trim_whitespace() 回 % 個字元, 而本支的自證分母預期 25(ECMA-262)⇒ 先確認貼的是 20260905050000 那一版',
      pg_catalog.length(public.pcm_js_trim_whitespace());
  END IF;
  -- 🔴 撞名要當場停(不可靜默覆蓋別人的約束)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
              WHERE conrelid = 'public.customers'::regclass
                AND conname  = 'customers_email_not_blank') THEN
    RAISE EXCEPTION '前置閘:customers_email_not_blank 已經存在 ⇒ 本支貼過了';
  END IF;

  -- 🔴🔴 **貼的當下自己量一次** —— 而不是相信檔頭那段量測。
  --    有既存空值 ⇒ `ADD CONSTRAINT` 本來就會失敗, 而它的錯誤訊息**不會告訴你有幾列**。
  --    ⇒ 這一格的用途是把那個數字印出來, 讓收拾的人知道要清幾列。
  SELECT pg_catalog.count(*),
         pg_catalog.count(*) FILTER (
           WHERE nullif(pg_catalog.btrim(c.email,
                 E' \t\n\r\f' || U&'\000b' || U&'\00a0' || U&'\feff' || U&'\3000'
              || U&'\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a'
              || U&'\2028\2029' || U&'\1680' || U&'\202f' || U&'\205f'), '') IS NULL)
    INTO v_all, v_bad
    FROM public.customers c;

  -- 🔴🔴 **三個世界要分得開, 而我第一版把其中兩個混在一起**(codex must-fix ①):
  --    ```
  --    A 空表(0 列)          ⇒ 沒有東西會違反 ⇒ 【放行】, 而要出聲(它也代表這一發沒有判別力)
  --    B 有列而全部是空白      ⇒ v_bad = 全部 ⇒ 【擋】, 訊息帶列數
  --    C 有列而有好有壞        ⇒ v_bad > 0   ⇒ 【擋】, 訊息帶列數
  --    ```
  --    ⛔ ~~第一版寫「有真值的 = 0 ⇒ 報『空表或尺沒接上』」~~
  --    🛑 那一句把 **A 與 B 講成同一件事**:一個全新的、還沒有客戶的庫**貼不進去**(而它該放行),
  --      而一個「全部都空白」的庫拿到的錯誤訊息說的是「空表」——**兩個世界各拿到對方的答案。**
  --    ⇒ ✅ 改成先分 `v_all = 0`,再由 `v_bad` 決定擋不擋。**判別依據是列數,不是「有沒有好的」。**
  IF v_all = 0 THEN
    RAISE NOTICE '前置閘:customers 是空的(0 列)⇒ 沒有東西會違反這道約束, 放行。⚠️ 而這也代表本次前置量測【沒有判別力】。';
  ELSIF v_bad > 0 THEN
    RAISE EXCEPTION '前置閘:% 位客戶的 email 是空白(全表 % 列)⇒ 先清乾淨再貼(本支不替你改資料)', v_bad, v_all;
  END IF;
  RAISE NOTICE '前置閘過:全表 % 列, 空白 % 列。', v_all, v_bad;
END $$;

-- ══ 本體 ═══════════════════════════════════════════════════════════════════
-- 🔵 `btrim(text, text)` 是 IMMUTABLE ⇒ 可以放進 CHECK。
-- 🔴 字集逐字對齊 `public.pcm_js_trim_whitespace()`(`20260905050000`), 由 parity 測試綁住。
ALTER TABLE public.customers
  ADD CONSTRAINT customers_email_not_blank
  CHECK (
    pg_catalog.btrim(email,
         E' \t\n\r\f' || U&'\000b' || U&'\00a0' || U&'\feff' || U&'\3000'
      || U&'\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a'
      || U&'\2028\2029' || U&'\1680' || U&'\202f' || U&'\205f') <> ''
  );

COMMENT ON CONSTRAINT customers_email_not_blank ON public.customers IS
$c$email 不得是空字串或純空白(Sean 2026-09-05 拍甲)。
🛑 它擋的是【空】,**不是【格式對不對】** —— 'x' / '@' 它放行,格式那半是應用層 zod 的事,兩者不可互相頂替。
🔴 存在理由:四支寄信掃描面的收件人述詞把純空白算成空;而 NOT NULL 擋不住 '' 與 '   '
⇒ 沒有這道約束時,任何不走註冊頁的寫入路都塞得進一個永遠收不到信的客戶。
🔵 字集與 public.pcm_js_trim_whitespace() 逐字相同(內嵌而非呼叫:那支函式只 GRANT service_role,
寫進 CHECK 會讓別的角色 INSERT 被 permission denied)。
🔴 漂移由**貼上去那一刻的自證**綁:它逐字元取自那支函式的回傳值, 拿這道約束跑一遍
(見 migration 20260905380000 的自證①/⑥)。**不是**由任何 CI 測試綁 —— 那條路試過而被三輪審查打穿。$c$;

-- ══ 貼上去當場自證 ═════════════════════════════════════════════════════════
-- 🔴🔴 **這一段的尺【不讀檔、不比字面】—— 它把真的那道約束【跑一遍】。**
--
-- ⛔ ~~前兩版:①catalog 定義裡有沒有 `btrim` ②有沒有 `OR` / `TRUE` ③另外寫一段運算式試兩個值~~
-- 🛑 codex 兩輪各打穿一次, 而**五條 finding 打的是同一件事**:
--    `CHECK (btrim(email,ws) = btrim(email,ws))` 恆真而三格全綠 · 在檔裡放 `-- );` 讓解析器提早截斷 ·
--    大寫 `PUBLIC.PCM_JS_TRIM_WHITESPACE()` 讓大小寫敏感的比對失明 · 把字元藏進註解 ⇒ 字集尺照樣數到它。
--    ⇒ 📌 **`not.toContain(X)` 的分母是我列得出來的 X, 而審查者永遠比我多想到一個。**
-- ✅ **換角度**:用 `pg_get_constraintdef` 取回**真的那一式**, 在一張 `TEMP TABLE` 上重建它,
--    然後**餵值進去**。⇒ 🎯 它跑的是**正式庫裡那一式本身**,而不是我對它的描述。
--    ⇒ 恆真式當場露餡;註解 / 大小寫 / 括號 / 截斷這些「檔案層的花招」**它碰不到**, 因為它不讀檔。
-- 🔵 **為什麼不是「釘住 deparse 的全字面」**(R3 nit:我原本的理由寫「跨版本可能不同」——
--    那句會讓下一個人去查證, 查完發現這個運算式的 deparse 很穩定, 然後「訂正」成釘字面)。
--    ✅ **真正的理由是結構性的**:本段在**同一個交易**裡把定義取出來、重建、餵值 ——
--    ⇒ 📌 **它跑的就是這個資料庫此刻那一式**, 根本沒有「我這邊的期望字串」這個東西可以跟版本打架。
--    ⇒ 釘字面則相反:那是把**我寫的一個字串**當權威, 而它會因為任何無害的 deparse 差異而誤紅。
-- 🔵 **而分母不是我列的** —— 逐字元取自 `public.pcm_js_trim_whitespace()` 的**回傳值**
--    ⇒ 那支函式與這道約束**在 apply 的當下被綁在一起**, 而不是靠一個 CI 測試比字面。
-- ⚠️ **它證不到什麼**:①只證這一式對**單一字元組成的值**與幾個代表值的行為, 不是全稱
--    ②TEMP TABLE 沒有那道 FK 與 UNIQUE ⇒ 它只演 CHECK 這一層 ③`ON COMMIT DROP` ⇒ 零殘留。
DO $$
DECLARE
  v_def  text;
  v_ws   text;
  v_ch   text;
  v_i    integer;
  v_bad  integer := 0;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(oid) INTO v_def
    FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public.customers'::regclass
     AND conname  = 'customers_email_not_blank';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '自證:約束不見了';
  END IF;

  CREATE TEMP TABLE pcm_email_chk_probe (email text) ON COMMIT DROP;
  EXECUTE 'ALTER TABLE pcm_email_chk_probe ADD CONSTRAINT c_probe ' || v_def;

  -- ① 🔴 **逐字元**:字集裡的每一個字元, 單獨組成的值都必須【被擋】。
  --    分母來自那支函式的回傳值 ⇒ 它多一個字元, 這裡就多演一發。
  v_ws := public.pcm_js_trim_whitespace();
  FOR v_i IN 1 .. pg_catalog.length(v_ws) LOOP
    v_ch := pg_catalog.substr(v_ws, v_i, 1);
    BEGIN
      EXECUTE 'INSERT INTO pcm_email_chk_probe VALUES ($1)' USING v_ch;
      v_bad := v_bad + 1;
      RAISE WARNING '自證①:第 % 個空白字元(U+%)竟然塞得進去', v_i,
        pg_catalog.upper(pg_catalog.to_hex(pg_catalog.ascii(v_ch)));
    EXCEPTION WHEN check_violation THEN NULL;  -- ✅ 這才是對的
    END;
  END LOOP;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '自證①:% 個空白字元沒被擋 ⇒ 這道約束與 pcm_js_trim_whitespace() 漂開了', v_bad;
  END IF;

  -- ①b 🔴🔴 **整串空白也要被擋 —— 而少了這一格, 擋下側的分母【全部是長度 ≤ 1】。**
  --    🛑 R3(opus 換模型)抓到的反例是具體的:CHECK 漂成
  --      `btrim(email, ws) <> '' OR length(email) > 2`
  --      ⇒ 上面那 25 發單字元**全部照樣被擋**(長度 1, 走不到那個 OR)、空字串也被擋
  --      ⇒ **五格全過, 而 `'   '`(三個空格)放行** —— 那正是本檔開頭說要擋的東西。
  --    ⇒ 📌 **一個只用單字元組成的分母, 對「長度相關的漂移」結構上失明。**
  --    ✅ 零新分母:把 `v_ws` **整串**(25 個字元的純空白)當一發餵進去。
  BEGIN
    EXECUTE 'INSERT INTO pcm_email_chk_probe VALUES ($1)' USING v_ws;
    RAISE EXCEPTION '自證①b:整串空白(% 個字元)塞得進去 ⇒ 這道約束對多字元的空白失明', pg_catalog.length(v_ws);
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ② 🔴 空字串也要被擋(它不在上面那個迴圈的分母裡)
  BEGIN
    EXECUTE 'INSERT INTO pcm_email_chk_probe VALUES ($1)' USING '';
    RAISE EXCEPTION '自證②:空字串塞得進去';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- ③ 🔵 **正對照 —— 少了它, 一個「什麼都擋」的恆假約束也會讓①② 全綠。**
  BEGIN
    EXECUTE 'INSERT INTO pcm_email_chk_probe VALUES ($1)' USING 'probe@example.test';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION '自證③:一個正常的 email 也被擋 ⇒ 這道約束恆假';
  END;

  -- ④ 🔴🔴 **U+200B(ZWSP)必須【放行】** —— 它是刻意排除的那一個
  --    (`20260905050000` 事後閘② 逐字:類別是 Cf 不是 Zs, JS 的 trim() 不剝它
  --     ⇒ 加進字集會變成「SQL 判空而 JS 判非空」= 永久誤報)。
  --    ⇒ 🎯 這一格同時擋掉「有人看到不一致就把它加回去」那個修法方向。
  BEGIN
    EXECUTE 'INSERT INTO pcm_email_chk_probe VALUES ($1)' USING U&'\200b';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION '自證④:U+200B 被當成空白擋掉了 ⇒ 與 JS 的 trim() 不一致, 會永久誤報';
  END;

  -- ⑤ 🔵 混合:空白包著一個真字元 ⇒ 要放行(證明它剝的是【頭尾】不是整串)
  BEGIN
    EXECUTE 'INSERT INTO pcm_email_chk_probe VALUES ($1)' USING '  a@b.test  ';
  EXCEPTION WHEN check_violation THEN
    RAISE EXCEPTION '自證⑤:前後有空白的正常 email 被擋 ⇒ 它擋到不該擋的';
  END;

  RAISE NOTICE '自證全過:逐字元 % 發 + 空字串 + 正常值 + U+200B 放行 + 混合值放行。',
    pg_catalog.length(v_ws);
END $$;

COMMIT;
