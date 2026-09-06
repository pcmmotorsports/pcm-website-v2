-- ══════════════════════════════════════════════════════════════════
-- 貼後對帳 · `20260906400000` get_vehicle_taxonomy() —— **唯讀, 零寫入**
-- ══════════════════════════════════════════════════════════════════
-- 🔴🔴 **這支檔存在的理由**:那支 migration 用 `RAISE NOTICE` 印列數,
--    而 **Sean 在 Supabase SQL Editor 【看不到 NOTICE】**
--    ⇒ 📌 一個寫得很清楚的數字, 對那個要看它的人等於不存在。
--
-- ── 🔴🔴 **一句 SQL 裡只准呼叫它【一次】**(opus 2026-09-06 R1 MF1)────────────
--    ⛔ 我第一版在同一句 UNION ALL 裡呼叫 `get_vehicle_taxonomy()` **14 次**
--      ⇒ 每次是 **2 次全掃**(`n` 一次 + `rows` 一次)⇒ ~28 次全掃 + 14 份 490KB jsonb。
--    🛑 **而這支檔存在的理由就是把數字印給 Sean 看** —— 逾時的話**八格一格都印不出來**
--      ⇒ 📌 **一份為了「讓人看得到」而寫的檔, 因為寫法而讓人什麼都看不到。**
--    ✅ 收成一次:`WITH t AS MATERIALIZED (…)`, 各格從 `t` 讀。
--      🔴 `MATERIALIZED` 是必要的 —— 少了它 PG 可能把 CTE inline 回去, 又變成 N 次。
--    🔵 **判讀不變**:同一句 SQL = 同一個快照 ⇒ 原本那 14 次回傳本來就保證相同。
--
-- 🛑 **它證得到什麼**:函式在不在 · 兩種權限對不對 · 它回的列數與 view 合不合 · 形狀對不對。
-- 🛑 **它證不到什麼**:
--    · **顧客站那條路真的變快了** —— 那要從 Vercel 那端量牆鐘, 唯讀連線量不到。
--    · **anon 在正式站負載下跑不跑得完 3s** —— 這裡是 pcm_readonly 不是 anon,
--      兩個角色的 `statement_timeout` 不同 ⇒ 🔴 **這一支跑得完, 推不出 anon 跑得完。**
-- ══════════════════════════════════════════════════════════════════
\pset pager off
\pset format unaligned
\pset fieldsep ' | '

WITH t AS MATERIALIZED (SELECT public.get_vehicle_taxonomy() AS j),
     v AS MATERIALIZED (SELECT count(*) AS n FROM public.vehicle_taxonomy_public)

-- ── ① 存在性(新物件 ⇒ 存在性【有】判別力:貼之前它不存在)────────────
SELECT '① 函式存在(要 1)' AS "格",
       (SELECT count(*)::text
          FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'get_vehicle_taxonomy') AS "值"
UNION ALL
-- 🔵 負對照:同一把尺找一個現造函式名(要 0)。回非 0 ⇒ 這把尺沒接上, 上面那個 1 不算數。
SELECT '🔵 負對照 現造函式名(要 0)',
       (SELECT count(*)::text
          FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'zzq_get_vehicle_taxonomy_not_real_9f')
UNION ALL
-- ── ② 權限之一:對【函式】的 EXECUTE ──────────────────────────────
SELECT '② anon 可 EXECUTE 函式(要 t)',
       pg_catalog.has_function_privilege('anon', 'public.get_vehicle_taxonomy()', 'EXECUTE')::text
UNION ALL
SELECT '② authenticated 可 EXECUTE 函式(要 t)',
       pg_catalog.has_function_privilege('authenticated', 'public.get_vehicle_taxonomy()', 'EXECUTE')::text
UNION ALL
SELECT '② PUBLIC 不可 EXECUTE 函式(要 f)',
       pg_catalog.has_function_privilege('public', 'public.get_vehicle_taxonomy()', 'EXECUTE')::text
UNION ALL
SELECT '② service_role 不可 EXECUTE 函式(要 f)',
       pg_catalog.has_function_privilege('service_role', 'public.get_vehicle_taxonomy()', 'EXECUTE')::text
UNION ALL
-- 🔵 **正對照:`'public'` 這個角色參數接得上嗎**(opus 2026-09-06 R1 C4)——
--    上面兩個 `f` 若是因為**角色參數解析不到**而來的, 它與「PUBLIC 真的被收乾淨了」
--    **印同一個字**。⇒ 拿一個 PUBLIC **一定有**的權限問同一把尺, 必須回 t。
--    📌 這支檔在 ①(負對照)與 ⑥(正對照)都已經用了這個 doctrine —— **就這一格漏掉,
--      而它正好是安全那一格。**
SELECT '🔵 正對照 public 角色參數接得上(要 t)',
       pg_catalog.has_function_privilege('public', 'pg_catalog.now()', 'EXECUTE')::text
UNION ALL
-- ── ②b 權限之二:對【view】的 SELECT(opus R1 MF2)──────────────────
-- 🔴🔴 **`SECURITY INVOKER` 要通, 需要【兩個】權限, 而我第一版只斷言了 EXECUTE。**
--    執行時的角色是 anon ⇒ 它還必須對 `public.vehicle_taxonomy_public` 有 **SELECT**。
--    🛑 **而那個 SELECT 不是天生的、也不是穩定的**:`20260905260000:207` 逐字
--      `REVOKE ALL ON TABLE public.vehicle_taxonomy_public FROM anon, authenticated;`
--      然後 `:223` 才 `GRANT SELECT … TO anon, authenticated;` —— **昨天真的被收掉再裝回去過。**
--    ⇒ 📌 只斷言 EXECUTE 的話, 「函式權限對」與「顧客站叫得動」是兩件事而我只驗了前者。
SELECT '②b anon 可 SELECT view(要 t;INVOKER 的另一半)',
       pg_catalog.has_table_privilege('anon', 'public.vehicle_taxonomy_public', 'SELECT')::text
UNION ALL
SELECT '②b authenticated 可 SELECT view(要 t)',
       pg_catalog.has_table_privilege('authenticated', 'public.vehicle_taxonomy_public', 'SELECT')::text
UNION ALL
-- 🔵 負對照:同一把尺問一個**該是 f** 的權限 ⇒ 回 t 表示這把尺恆真、上面兩個 t 不算數。
SELECT '🔵 負對照 anon 不可 INSERT view(要 f)',
       pg_catalog.has_table_privilege('anon', 'public.vehicle_taxonomy_public', 'INSERT')::text
UNION ALL
-- ── ③ 屬性:STABLE 與 INVOKER ──────────────────────────────────────
--    🔵 `provolatile='s'` = STABLE;`prosecdef=false` = SECURITY INVOKER。
SELECT '③ 是 STABLE(要 s)',
       (SELECT p.provolatile::text
          FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'get_vehicle_taxonomy')
UNION ALL
SELECT '③ 是 SECURITY INVOKER(要 f)',
       (SELECT p.prosecdef::text
          FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'get_vehicle_taxonomy')
UNION ALL
-- ── ④ 真的呼叫一發, 而且比【兩個獨立來源】────────────────────────────
--    🔴 左邊是函式回的 `n`, 右邊是**我們在這裡自己數的** ⇒ 兩個來源。
SELECT '④ 函式說的 n vs view 的 count(*)(要 same)',
       CASE WHEN (SELECT (j ->> 'n')::bigint FROM t) = (SELECT n FROM v)
            THEN 'same' ELSE 'DIFF' END
UNION ALL
SELECT '④ 這兩個數各是多少(給人看)',
       (SELECT (j ->> 'n') FROM t) || ' vs ' || (SELECT n::text FROM v)
UNION ALL
-- ── ⑤ 我拿到幾列 vs 它說幾列 ──────────────────────────────────────
SELECT '⑤ rows 長度 vs n(要 same)',
       CASE WHEN (SELECT pg_catalog.jsonb_array_length(j -> 'rows') FROM t)
                 = (SELECT (j ->> 'n')::bigint FROM t)
            THEN 'same' ELSE 'DIFF' END
UNION ALL
-- ── ⑥ 形狀:每一列恰四個元素(app 端的欄序假設)────────────────────────
SELECT '⑥ 不是四元素的列數(要 0)',
       (SELECT count(*)::text
          FROM t, pg_catalog.jsonb_array_elements(t.j -> 'rows') AS e
         WHERE pg_catalog.jsonb_array_length(e) <> 4)
UNION ALL
-- 🔵 正對照:確定上面那把尺**看得到列**(否則「0 個壞列」與「一列都沒掃到」印同一個 0)
SELECT '🔵 正對照 掃到的列數(要 = n)',
       (SELECT count(*)::text FROM t, pg_catalog.jsonb_array_elements(t.j -> 'rows') AS e)
UNION ALL
-- ── ⑦ 年份 null 還在(不是被寫成 0 或字串)────────────────────────────
SELECT '⑦ 第三欄是 json null 的列數(要 > 0)',
       (SELECT count(*)::text
          FROM t, pg_catalog.jsonb_array_elements(t.j -> 'rows') AS e
         WHERE pg_catalog.jsonb_typeof(e -> 2) = 'null')
UNION ALL
SELECT '⑦ 第三欄被寫成 0 或字串的列數(要 0)',
       (SELECT count(*)::text
          FROM t, pg_catalog.jsonb_array_elements(t.j -> 'rows') AS e
         WHERE pg_catalog.jsonb_typeof(e -> 2) NOT IN ('null','number'))
UNION ALL
-- ── ⑦b 年份的【值域】—— 而這一格刻意放在【這裡】不是 app 端(線【前台】-36 2026-09-06 提)
-- 🔴 **失敗代價不對稱, 而那決定了它該住哪一側**:
--    · app 端擋錯 ⇒ `tryVehicleTaxonomy` catch ⇒ 回空陣列 ⇒ **PDP 車款整區空掉而頁面回 200**
--      (板列 ⟦front-PDPTAXONOMYEMPTY⟧, 正式站量到 **6 小時 / 31 個網址**)
--      ⇒ 一個猜出來的年份下界只要猜錯一次, 就是**所有客人**的車款下拉一起消失。
--    · 這裡擋錯 ⇒ **一次 apply 失敗**, 而且是在有真資料、有人看著的當下。
--    ⇒ 📌 **「值域合不合理」該在貼的那一側判, 不在每個客人的請求上。**
-- 🔵 而 `0` 的後果不是 1970(那是 epoch 的直覺)—— app 直接顯示年份數字 ⇒ 它是**西元 0 年**
--    (`-36` 訂正我的;它那邊已有一格測試在守「`year_start = null` 不可當 0」)。
SELECT '⑦b 年份是 0 或負數的列數(要 0)',
       (SELECT count(*)::text
          FROM t, pg_catalog.jsonb_array_elements(t.j -> 'rows') AS e
         WHERE (pg_catalog.jsonb_typeof(e -> 2) = 'number' AND (e ->> 2)::int <= 0)
            OR (pg_catalog.jsonb_typeof(e -> 3) = 'number' AND (e ->> 3)::int <= 0))
UNION ALL
-- 🔵 正對照:上面那把尺**看得到 number 型的年份嗎**(否則「0 個壞值」與「一個數字都沒掃到」同一個 0)
SELECT '🔵 正對照 年份是 number 的列數(要 > 0)',
       (SELECT count(*)::text
          FROM t, pg_catalog.jsonb_array_elements(t.j -> 'rows') AS e
         WHERE pg_catalog.jsonb_typeof(e -> 2) = 'number')
UNION ALL
-- ── ⑧ payload 大小(給人對照 490,120 那個估值)─────────────────────────
SELECT '⑧ jsonb::text 長度 bytes(對照估值 490120 + n 那格)',
       (SELECT pg_catalog.length(j::text)::text FROM t);

-- ══════════════════════════════════════════════════════════════════
-- 判讀:①=1 且負對照=0 · ② t/t/f/f 且【public 角色參數正對照=t】· ②b t/t 且負對照=f · ③ s/f
--       · ④=same · ⑤=same · ⑥=0 且正對照=n · ⑦ 第一格 >0、第二格 0 · ⑦b 第一格 0 且正對照 >0
--       · ⑧ 只是給人看的數字, 沒有期望值
-- 🔴 任何一格是 DIFF / 方向反了 ⇒ **不要自己解釋**, 把整份輸出貼回線【DB】。
-- ══════════════════════════════════════════════════════════════════
