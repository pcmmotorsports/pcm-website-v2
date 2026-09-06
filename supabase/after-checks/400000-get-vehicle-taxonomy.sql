-- ══════════════════════════════════════════════════════════════════
-- 貼後對帳 · `20260906400000` get_vehicle_taxonomy() —— **唯讀, 零寫入**
-- ══════════════════════════════════════════════════════════════════
-- 🔴🔴 **這支檔存在的理由**:那支 migration 用 `RAISE NOTICE` 印列數,
--    而 **Sean 在 Supabase SQL Editor 【看不到 NOTICE】**
--    ⇒ 📌 一個寫得很清楚的數字, 對那個要看它的人等於不存在。
--    ⇒ ✅ 貼完之後由有唯讀連線的人跑這一支, 把數字撈回來。
--
-- 🛑 **它證得到什麼**:函式在不在 · 權限對不對 · 它回的列數與 view 合不合 · 形狀對不對。
-- 🛑 **它證不到什麼**:
--    · **顧客站那條路真的變快了** —— 那要從 Vercel 那端量牆鐘, 唯讀連線量不到。
--    · **anon 在正式站負載下跑不跑得完 3s** —— 這裡是 pcm_readonly 不是 anon,
--      而兩個角色的 `statement_timeout` 不同(anon 3s / 我們這條 readonly 不是 3s)
--      ⇒ 🔴 **這一支跑得完, 推不出 anon 跑得完。**
-- ══════════════════════════════════════════════════════════════════
\pset pager off
\pset format unaligned
\pset fieldsep ' | '

-- ── ① 存在性(新物件 ⇒ 存在性【有】判別力:貼之前它不存在)────────────
SELECT '① 函式存在(要 1)' AS "格",
       pg_catalog.count(*)::text AS "值"
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'get_vehicle_taxonomy'
UNION ALL
-- 🔵 負對照:同一把尺找一個現造函式名(要 0)。回非 0 ⇒ 這把尺沒接上, 上面那個 1 不算數。
SELECT '🔵 負對照 現造函式名(要 0)',
       pg_catalog.count(*)::text
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'zzq_get_vehicle_taxonomy_not_real_9f'
UNION ALL
-- ── ② 權限:該有的兩個要 t, 該收的兩個要 f ──────────────────────────
SELECT '② anon 可 EXECUTE(要 t)',
       pg_catalog.has_function_privilege('anon', 'public.get_vehicle_taxonomy()', 'EXECUTE')::text
UNION ALL
SELECT '② authenticated 可 EXECUTE(要 t)',
       pg_catalog.has_function_privilege('authenticated', 'public.get_vehicle_taxonomy()', 'EXECUTE')::text
UNION ALL
SELECT '② PUBLIC 不可 EXECUTE(要 f)',
       pg_catalog.has_function_privilege('public', 'public.get_vehicle_taxonomy()', 'EXECUTE')::text
UNION ALL
SELECT '② service_role 不可 EXECUTE(要 f)',
       pg_catalog.has_function_privilege('service_role', 'public.get_vehicle_taxonomy()', 'EXECUTE')::text
UNION ALL
-- ── ③ 屬性:STABLE 與 INVOKER ──────────────────────────────────────
--    🔵 `provolatile='s'` = STABLE;`prosecdef=false` = SECURITY INVOKER。
SELECT '③ 是 STABLE(要 s)',
       p.provolatile::text
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'get_vehicle_taxonomy'
UNION ALL
SELECT '③ 是 SECURITY INVOKER(要 f)',
       p.prosecdef::text
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'get_vehicle_taxonomy'
UNION ALL
-- ── ④ 真的呼叫一發, 而且比【兩個獨立來源】────────────────────────────
--    🔴 這一格是本檔的核心:`n` 是函式裡另一次獨立的 count(*),
--       而右邊是**我們在這裡自己數的** ⇒ 兩個來源。相等才有意義。
--    🛑 若把它寫成「函式的 n vs 函式的 rows 長度」, 那是同一次呼叫裡的兩個欄位 ——
--       仍然值得看(見 ⑤), 而它證不到「函式與 view 一致」。
SELECT '④ 函式說的 n vs view 的 count(*)(要 same)',
       CASE WHEN (public.get_vehicle_taxonomy() ->> 'n')::bigint
                 = (SELECT pg_catalog.count(*) FROM public.vehicle_taxonomy_public)
            THEN 'same' ELSE 'DIFF' END
UNION ALL
SELECT '④ 這兩個數各是多少(給人看)',
       (public.get_vehicle_taxonomy() ->> 'n')
       || ' vs ' || (SELECT pg_catalog.count(*) FROM public.vehicle_taxonomy_public)::text
UNION ALL
-- ── ⑤ 我拿到幾列 vs 它說幾列(鐵則 11 那第四個數)──────────────────────
SELECT '⑤ rows 長度 vs n(要 same)',
       CASE WHEN pg_catalog.jsonb_array_length(public.get_vehicle_taxonomy() -> 'rows')
                 = (public.get_vehicle_taxonomy() ->> 'n')::bigint
            THEN 'same' ELSE 'DIFF' END
UNION ALL
-- ── ⑥ 形狀:每一列恰四個元素(app 端的欄序假設)────────────────────────
SELECT '⑥ 不是四元素的列數(要 0)',
       (SELECT pg_catalog.count(*)::text
          FROM pg_catalog.jsonb_array_elements(public.get_vehicle_taxonomy() -> 'rows') AS e
         WHERE pg_catalog.jsonb_array_length(e) <> 4)
UNION ALL
-- 🔵 正對照:確定上面那把尺**看得到列**(否則「0 個壞列」與「一列都沒掃到」印同一個 0)
SELECT '🔵 正對照 掃到的列數(要 = n)',
       (SELECT pg_catalog.count(*)::text
          FROM pg_catalog.jsonb_array_elements(public.get_vehicle_taxonomy() -> 'rows') AS e)
UNION ALL
-- ── ⑦ 年份 null 還在(不是被寫成 0 或字串)────────────────────────────
--    🔵 `year_start` 714 列 / `year_end` 1,391 列是 NULL(2026-09-05 唯讀實查)
--       ⇒ 這裡不釘死那兩個數(資料會長), 只釘「它們是 JSON null 這個型別」。
SELECT '⑦ 第三欄是 json null 的列數(要 > 0)',
       (SELECT pg_catalog.count(*)::text
          FROM pg_catalog.jsonb_array_elements(public.get_vehicle_taxonomy() -> 'rows') AS e
         WHERE pg_catalog.jsonb_typeof(e -> 2) = 'null')
UNION ALL
SELECT '⑦ 第三欄被寫成 0 或字串的列數(要 0)',
       (SELECT pg_catalog.count(*)::text
          FROM pg_catalog.jsonb_array_elements(public.get_vehicle_taxonomy() -> 'rows') AS e
         WHERE pg_catalog.jsonb_typeof(e -> 2) NOT IN ('null','number'))
UNION ALL
-- ── ⑧ payload 大小(給人對照 490,120 那個估值)─────────────────────────
SELECT '⑧ jsonb::text 長度 bytes(對照估值 490120 + n 那格)',
       pg_catalog.length(public.get_vehicle_taxonomy()::text)::text;

-- ══════════════════════════════════════════════════════════════════
-- 判讀:①=1 且負對照=0 · ② t/t/f/f · ③ s/f · ④=same · ⑤=same · ⑥=0 且正對照=n
--       · ⑦ 第一格 >0、第二格 0 · ⑧ 只是給人看的數字, 沒有期望值
-- 🔴 任何一格是 DIFF / 方向反了 ⇒ **不要自己解釋**, 把整份輸出貼回線【DB】。
-- ══════════════════════════════════════════════════════════════════
