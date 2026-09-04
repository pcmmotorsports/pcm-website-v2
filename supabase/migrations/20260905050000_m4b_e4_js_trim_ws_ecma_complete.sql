-- ══════════════════════════════════════════════════════════════════════════════
-- ⟦b4-JSWSNARROWER⟧ `pcm_js_trim_whitespace()` 補上 U+202F / U+205F
--
-- 🛑 **病**:那支「單一來源」比 JS 的 `String.prototype.trim()` **窄兩個碼位**。
--    ⇒ 一個只含 **U+202F(窄式不斷行空格)** 或 **U+205F(中等數學空格)** 的信箱:
--      **JS 判它空**(所以永遠不會 enqueue), 而 **SQL 判它非空**(所以不被排除)
--    ⇒ 📌 **它會留在掃描面上被每一輪重撈, 而且永遠不會停** ——
--      `20260901070000` 的檔頭逐字算過這個帳:**那是「永久誤報」那一側,
--      而永久誤報比漏報難處理:它會訓練所有人忽略整個告警。**
--
-- ── 🔴 分母:ECMA-262 `String.prototype.trim` 剝掉的是 WhiteSpace ∪ LineTerminator ──
--    **逐字列出, 不寫「等等」** —— 一個沒有分母的字集, 下一個人無法判斷它完不完整。
--
--    WhiteSpace(ECMA-262 表「White Space Code Points」):
--      U+0009 TAB · U+000B VT · U+000C FF · U+FEFF ZWNBSP(BOM)
--      · **以及 Unicode 一般類別 `Space_Separator`(Zs)的全部成員**:
--          U+0020 SPACE
--          U+00A0 NO-BREAK SPACE
--          U+1680 OGHAM SPACE MARK
--          U+2000 … U+200A(EN QUAD / EM QUAD / EN / EM / THREE-PER-EM / FOUR-PER-EM /
--                          SIX-PER-EM / FIGURE / PUNCTUATION / THIN / HAIR)  ← 11 個
--          U+202F NARROW NO-BREAK SPACE      🔴 **本片補的第一個**
--          U+205F MEDIUM MATHEMATICAL SPACE  🔴 **本片補的第二個**
--          U+3000 IDEOGRAPHIC SPACE
--    LineTerminator:U+000A LF · U+000D CR · U+2028 LS · U+2029 PS
--    ⇒ **合計 25 個碼位**(補之前 23)。
--
-- ── 🛑 U+200B(ZERO WIDTH SPACE)【刻意不在裡面】, 而這一條要寫下來 ────────
--    它的一般類別是 `Cf`(Format), **不是 `Zs`** ⇒ **JS 的 `trim()` 不剝它**
--    (`'​'.trim().length === 1`)。
--    ⇒ 🔴 **把它加進來會讓 SQL 判空而 JS 判非空 —— 那正是【永久誤報】那個方向。**
--    ⇒ 📌 這一段存在的理由是:它看起來很像該加, 而加了會壞。
--    ⚠️ 別跟 `order_item_procurement_supplier_order_no_nonempty` 那個 `translate(...)` 混淆 ——
--      那一個問的是「這個料號是不是空白」, 是另一個問題, 它的字集可以更寬。
--
-- ── ⚠️ 加寬的後果, 兩支呼叫端方向相反(照 20260901070000 的帳算)────────
--    · `no_recipient_count` / `unsendable` ⇒ 判空的變多 ⇒ **多數到幾筆**(它們本來就寄不出去)
--    · 掃描面那幾支 view ⇒ 判空的變多 ⇒ **少撈幾筆** ⇒ 那正是要的
--    · `stuck_count` ⇒ 判空的變多 ⇒ **少叫** ⇒ 消滅的正是那個永久誤報
--    ⇒ 🔵 **三個方向都是往「與 TS 一致」走 —— 沒有一個會讓收得到信的人收不到。**
-- ══════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 前置閘:庫上那一版必須是我改的那一版 ──────────────────────────────
-- 🔴 md5 是【量的】不是算的:2026-09-05 在從零重放出來的庫上實測
--    `select md5(prosrc) from pg_proc where oid='public.pcm_js_trim_whitespace()'::regprocedure`
DO $$
DECLARE v_md5 text; v_len int;
BEGIN
  IF to_regprocedure('public.pcm_js_trim_whitespace()') IS NULL THEN
    RAISE EXCEPTION '前置閘:pcm_js_trim_whitespace() 不在 ⇒ 先貼 20260901070000';
  END IF;
  SELECT md5(prosrc) INTO v_md5
    FROM pg_catalog.pg_proc WHERE oid = 'public.pcm_js_trim_whitespace()'::regprocedure;
  IF v_md5 <> 'a9777652ab671384555117224fec8d73' THEN
    RAISE EXCEPTION '前置閘:庫上那一版的 prosrc md5 是 %, 而我改的是 a9777652ab671384555117224fec8d73 ⇒ 有人先改過它 ⇒ 停下, 不要把別人的修改蓋掉', v_md5;
  END IF;
  -- 🟢 正對照:md5 這把尺在該說「不一樣」時真的會說(否則上面那格只是在比兩個都算得出來的東西)。
  --    這裡改用一個**獨立的量**:碼位數。它與 md5 由不同的東西決定。
  v_len := pg_catalog.length(public.pcm_js_trim_whitespace());
  IF v_len <> 23 THEN
    RAISE EXCEPTION '前置閘(第二把尺):改之前應該是 23 個碼位, 實得 % ⇒ md5 那一格與這一格對不起來, 兩把都不信', v_len;
  END IF;
END
$$;

-- ── 換上完整版 ────────────────────────────────────────────────────────
-- 🔴 `CREATE OR REPLACE` 保留 ACL —— 而「保留」是宣稱不是量測, 下面事後閘會量。
CREATE OR REPLACE FUNCTION public.pcm_js_trim_whitespace()
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  -- 🔴 **`\v` 不在 PostgreSQL 文件列出的 escape 清單裡** —— codex 2026-09-05 據此判它是字母 `v`。
  --    🟢 **而實測不是**:`select ascii(E'\v')` 在 PG 17.10 回 **11**(= U+000B), length 1;
  --      補之前那一版的字集實際碼位也含 `b`(2026-09-05 從零重放的庫上量的)。
  --    ⇒ 📌 **所以那條 finding 的結論不成立** —— 而它指的那個字元仍然值得處理:
  --      **一個依賴「沒有寫進文件的行為」的字面, 換一個 PG 版本就可能改變, 而它不會出聲。**
  --    ⇒ ✅ 改成與這支函式其餘每一個碼位相同的寫法 —— 明寫, 不依賴 escape 表。
  SELECT E' \t\n\r\f'                                       -- U+0020 0009 000A 000D 000C
      || U&'\000b'                                          -- VT(原本寫 E'\v', 見上)
      || U&'\00a0'                                          -- NBSP
      || U&'\feff'                                          -- BOM / ZWNBSP
      || U&'\3000'                                          -- 全形空白
      || U&'\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a'  -- en/em/thin space 那一族
      || U&'\2028\2029'                                     -- line / paragraph separator
      || U&'\1680'                                          -- ogham space mark
      || U&'\202f'                                          -- NARROW NO-BREAK SPACE(2026-09-05 補)
      || U&'\205f';                                         -- MEDIUM MATHEMATICAL SPACE(2026-09-05 補)
$fn$;

COMMENT ON FUNCTION public.pcm_js_trim_whitespace() IS
$c$「什麼算空白」的【單一來源】—— 與 JS 的 String.prototype.trim() 對齊。

🟢 2026-09-05(⟦b4-JSWSNARROWER⟧)補上 U+202F / U+205F ⇒ **現在是 ECMA-262 的完整集合**:
WhiteSpace(U+0009 U+000B U+000C U+FEFF + Unicode Zs 全部成員)∪ LineTerminator(U+000A U+000D U+2028 U+2029)
= 25 個碼位。⇒ 從此不是「收窄」,而是與 TS 那一側逐碼位相同。

🛑 U+200B(ZERO WIDTH SPACE)【刻意不在裡面】:它的類別是 Cf 不是 Zs,JS 的 trim() 不剝它
('​'.trim().length === 1)⇒ 加進來會讓 SQL 判空而 JS 判非空 = 永久誤報那個方向。

🔴 為什麼要有它(單一來源):2026-09-01 之前有兩份各自寫的字集,
而同一個「窄」在兩支函式裡後果相反:一個少報(安全)、一個永久誤報。

🛑 要再改它之前先想:任何加寬都會讓「判為空」的東西變多
⇒ 對 no_recipient_count 是多叫、對 stuck_count 是少叫、對掃描面 view 是少撈。三邊一起看。$c$;

-- 🔵 `20260901070000` 當時把 EXECUTE 從所有人身上收掉, 理由逐字是
--    「兩支呼叫端都是 SECURITY DEFINER ⇒ 以 owner 身分呼叫 ⇒ 不需要」,
--    而它同一段就寫著「若將來有非 DEFINER 的呼叫端, 這裡要補 GRANT」。
--    ⇒ 🔴 **那個將來已經到了**:2026-09-05 起四支 `security_invoker` 的掃描 view 呼叫它。
--    ⇒ GRANT 冪等, 這裡再下一次, 本支不必依賴別的檔先貼。
GRANT EXECUTE ON FUNCTION public.pcm_js_trim_whitespace() TO service_role;

-- ── 事後閘 ────────────────────────────────────────────────────────────
DO $$
DECLARE v_got int[]; v_want int[]; v_missing int[]; v_extra int[]; v_md5 text;
BEGIN
  -- ① 逐碼位比對 —— 🔴 **比集合, 不比長度**:長度對而成員錯是同一個數。
  SELECT array_agg(cp ORDER BY cp) INTO v_got
    FROM (SELECT DISTINCT ascii(ch) AS cp
            FROM regexp_split_to_table(public.pcm_js_trim_whitespace(), '') AS ch) t;
  v_want := ARRAY[
    x'0009'::int, x'000a'::int, x'000b'::int, x'000c'::int, x'000d'::int,
    x'0020'::int, x'00a0'::int, x'1680'::int,
    x'2000'::int, x'2001'::int, x'2002'::int, x'2003'::int, x'2004'::int, x'2005'::int,
    x'2006'::int, x'2007'::int, x'2008'::int, x'2009'::int, x'200a'::int,
    x'2028'::int, x'2029'::int, x'202f'::int, x'205f'::int,
    x'3000'::int, x'feff'::int];
  SELECT array_agg(x ORDER BY x) INTO v_missing FROM unnest(v_want) x WHERE NOT x = ANY(v_got);
  SELECT array_agg(x ORDER BY x) INTO v_extra   FROM unnest(v_got)  x WHERE NOT x = ANY(v_want);
  IF v_missing IS NOT NULL OR v_extra IS NOT NULL THEN
    RAISE EXCEPTION '事後閘①:字集與 ECMA-262 的 WhiteSpace ∪ LineTerminator 不符 —— 少了 % / 多了 %(碼位以十進位印)',
      v_missing, v_extra;
  END IF;
  IF cardinality(v_want) <> 25 THEN
    RAISE EXCEPTION '事後閘①(自檢):期望清單自己只有 % 個, 而 ECMA-262 那張表算出來是 25 ⇒ 這份清單被改過', cardinality(v_want);
  END IF;

  -- ② 🔴 **U+200B 必須【不在】裡面** —— 它是「看起來該加而加了會壞」的那一個。
  IF pg_catalog.strpos(public.pcm_js_trim_whitespace(), U&'\200b') > 0 THEN
    RAISE EXCEPTION '事後閘②:U+200B(ZWSP)跑進字集了 ⇒ 它的類別是 Cf 不是 Zs, JS 的 trim() 不剝它 ⇒ SQL 判空而 JS 判非空 = 永久誤報';
  END IF;

  -- ③ 行為探針:三個字元各自被剝掉 / 不被剝掉(⇒ 這一格量的是【行為】不是字面)
  IF pg_catalog.btrim(U&'\202f' || 'a' || U&'\205f', public.pcm_js_trim_whitespace()) <> 'a' THEN
    RAISE EXCEPTION '事後閘③:U+202F / U+205F 沒有被剝掉 ⇒ 字集裡有它而 btrim 沒吃到, 那是兩件事';
  END IF;
  IF pg_catalog.btrim(U&'\200b' || 'a', public.pcm_js_trim_whitespace()) <> U&'\200b' || 'a' THEN
    RAISE EXCEPTION '事後閘③(負向):U+200B 被剝掉了 ⇒ 與 JS 不一致';
  END IF;

  -- ④ ACL:CREATE OR REPLACE 應保留, 而那是宣稱 ⇒ 量它。
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.pcm_js_trim_whitespace()', 'EXECUTE')
  THEN RAISE EXCEPTION '事後閘④:service_role 沒有 EXECUTE ⇒ 四支 security_invoker 掃描 view 會查一次錯一次'; END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.pcm_js_trim_whitespace()', 'EXECUTE')
  THEN RAISE EXCEPTION '事後閘④:anon 執行得到它(兩道 REVOKE 少了一道)'; END IF;
  IF pg_catalog.has_function_privilege('authenticated', 'public.pcm_js_trim_whitespace()', 'EXECUTE')
  THEN RAISE EXCEPTION '事後閘④:authenticated 執行得到它'; END IF;

  -- ⑤ 換完之後的 prosrc md5 事後閘。
  -- 🔴 值是【量的】:2026-09-05 先把本檔套進從零重放出來的庫, 讀 `md5(prosrc)` 抄回來。
  -- 🟢 **而這一格自己表演過一次**:2026-09-05 我把 `E'\v'` 改成 `U&'\000b'` 之後忘了改這個值
  --    ⇒ 它當場紅並把實際的 md5 印出來 ⇒ **連帶讓 fixture 的 U+202F 那四格也紅**
  --      (migration 回滾 ⇒ helper 還是 23 碼位)。⇒ 📌 **兩道閘各自從不同的方向指到同一件事。**
  --    ⚠️ **它會擋住「改了函式體卻忘記改這個值」** —— 而那正是它存在的理由:
  --      下一個要改它的人, 他的前置閘要拿這個值當基準, 而一個過期的基準會讓他停在錯的地方。
  -- 🛑 **而它擋不到什麼要寫出來**:md5 只答「這串文字有沒有變」——
  --    上面 ①②③ 才答「字集對不對 / 行為對不對」。**md5 變了不代表壞了, 沒變也不代表對。**
  SELECT md5(prosrc) INTO v_md5
    FROM pg_catalog.pg_proc WHERE oid = 'public.pcm_js_trim_whitespace()'::regprocedure;
  IF v_md5 <> '1786ba1b7ca382fe031d8c11664df4cd' THEN
    RAISE EXCEPTION '事後閘⑤:換完的 prosrc md5 是 %, 而本檔寫的是 1786ba1b7ca382fe031d8c11664df4cd ⇒ 函式體被改過而這個值沒跟著改', v_md5;
  END IF;
  RAISE NOTICE '✅ pcm_js_trim_whitespace() 換完:25 碼位, prosrc md5 = %', v_md5;
END
$$;

COMMIT;
