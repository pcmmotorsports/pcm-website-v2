-- ↩️ 復原:20260905260000 ⟦b9-PUBLICVIEWALL⟧
-- 🔴 **本檔【一半是註解、一半跑得動】—— 不要當成「整支貼下去就會還原」。**
--    ⛔ ~~本檔全段都是註解掉的~~ **[R5 N5 訂正]** —— §V 那一段(檔尾的量測 SELECT)**沒有註解掉**,
--       貼下去會真的跑(唯讀, 零寫入)。真正註解掉的只有 §R 那一段。
--    (R4 F10:更早那一版寫「整支跑會把寫權全部裝回」, 而 §R 全段註解 ⇒ 那句也不成立。)
--    ⇒ 📌 **這一格連錯兩版, 而兩版都是「檔頭那句話」與「檔案實際長相」對不起來** ——
--       檔頭是給人讀的, 而人不會逐行去數哪幾行前面有 `--`。
--
-- ══ 🔴 先讀這一段:症狀對不上就不要跑 ═══════════════════════════════════
--   **本片【沒有收掉 SELECT】** —— migration 把 REVOKE ALL 連帶收掉的 SELECT 原樣裝了回去,
--   而它的斷言②a 硬要求貼完之後那 8 格 SELECT 全在(不在就整筆回捲)。
--   ⇒ 🛑 **所以「顧客站讀不到 ⇒ 補 SELECT」這條處置【對本片無效】**
--      (R4 F5:前一版的 §1 是 no-op —— 跑完什麼都沒變, 而值班會以為處置過了)。
--
--   症狀 = 顧客站讀不到商品/車款
--     ⇒ 🔴 **先不要跑這裡的任何東西。** 本片若真的收掉了 SELECT, 它的斷言②a 會讓整筆交易回捲,
--        ⇒ 那個世界裡「貼成功了而 SELECT 沒了」不存在。
--     ⇒ ✅ 先跑 `supabase/after-checks/260000-after-sqleditor.sql` 看是哪一格紅:
--          ②a/②b 紅 ⇒ 真的是 SELECT 掉了(那不該發生, 停下叫人)
--          其他格紅 / 全綠 ⇒ **成因不在本片**, 去看 PostgREST / schema USAGE / RLS / 網路。
--
--   症狀 = 確定要放棄這一片
--     ⇒ 解註解跑 §R。⚠️ 它會把四支的寫權**全部裝回去**, 那正是本片要關的東西。
--
-- ══ 🛑 這不是「還原」, 是【裝回貼前那個確切狀態】═══════════════════════
--   ✅ 裝得回去:四支的表級 ACL 授權集合(2026-09-05 16:4x 唯讀逐支量過的那份)
--   ⛔ 裝不回去:① grantor 是誰 ② WITH GRANT OPTION ③ 欄級 ACL ④ PUBLIC 那份
--                ⑤ 原授權是哪一支 migration / 哪個平台動作下的
--      🔬 ①~④ 貼前實量【都是空的】(grantor 全 postgres · grant option 0 · 欄級 ACL 0 · PUBLIC 0)
--         ⇒ 今天跑它裝回去的與貼前【看起來一樣】。**⑤ 未知, 而它不影響權限。**
--      🛑 **退之前先重跑那四個量測**(§V), 任一項非零就不要跑, 停下問。
--
-- ⚠️ **[R4 F9]本檔住在 `scripts/` ⇒ `acl-drift-gate.py` 掃不到它**
--    (那支只掃 `supabase/migrations/*.sql`)⇒ 📌 **下面那幾行 `GRANT … TO anon` 沒有任何守門看過。**
--    ⇒ 解註解之前, 請當它是一次【沒有閘的開權】, 自己念一遍它給了誰什麼。
--
-- ══ §R 放棄本片(**這一段是註解掉的**;要跑請整段解註解)══════════════════════════════
-- BEGIN;
-- SET LOCAL lock_timeout = '5s';
--   -- 前兩支貼前是【八種全開】
--   GRANT ALL ON TABLE public.products_list_public    TO anon, authenticated;
--   GRANT ALL ON TABLE public.vehicle_taxonomy_public TO anon, authenticated;
--   -- 🔴 後兩支貼前【只有 SELECT + MAINTAIN】—— 不要給 ALL, 那會多給六種它們本來就沒有的
--   GRANT SELECT, MAINTAIN ON TABLE public.products_public         TO anon, authenticated;
--   GRANT SELECT, MAINTAIN ON TABLE public.product_variants_public TO anon, authenticated;
-- COMMIT;

-- ══ §V 量一下現況(🔵 **這一段【沒有註解掉】, 貼下去會真的跑** —— 唯讀、零寫入)══════════════════
-- 期望:migration 貼完 ⇒ write_cells = 0 · select_cells = 8
--       跑完 §R      ⇒ write_cells = 32(貼前那個值)
SELECT
  (SELECT pg_catalog.count(*) FROM (VALUES ('public.products_list_public'),('public.vehicle_taxonomy_public'),
                                ('public.products_public'),('public.product_variants_public')) t(rel)
     CROSS JOIN (VALUES ('anon'),('authenticated')) r(rolname)
     CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),
                        ('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(priv)
    WHERE pg_catalog.has_table_privilege(r.rolname, t.rel, p.priv))            AS write_cells,
  (SELECT pg_catalog.count(*) FROM (VALUES ('public.products_list_public'),('public.vehicle_taxonomy_public'),
                                ('public.products_public'),('public.product_variants_public')) t(rel)
     CROSS JOIN (VALUES ('anon'),('authenticated')) r(rolname)
    WHERE pg_catalog.has_table_privilege(r.rolname, t.rel, 'SELECT'))          AS select_cells,
  -- 🛑 退之前要看的四格(任一非零 ⇒ 不要跑 §R)
  (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    WHERE n.nspname='public' AND c.relname IN ('products_list_public','vehicle_taxonomy_public','products_public','product_variants_public')
      AND a.grantee = 0)                                                        AS public_rows_expect_0,
  (SELECT pg_catalog.count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
    WHERE n.nspname='public' AND c.relname IN ('products_list_public','vehicle_taxonomy_public','products_public','product_variants_public')
      AND a.is_grantable)                                                       AS grantable_rows_expect_0,
  (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute att
     JOIN pg_catalog.pg_class c ON c.oid=att.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('products_list_public','vehicle_taxonomy_public','products_public','product_variants_public')
      AND att.attacl IS NOT NULL)                                               AS col_acl_expect_0;
