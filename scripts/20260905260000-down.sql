-- ↩️ 復原:20260905260000 ⟦b9-PUBLICVIEWALL⟧(codex R3 MF③ 要的【可執行】復原檔)
--
-- 🔴🔴 **這不是「還原」, 是【裝回貼前那個確切狀態】。** 差別要先讀:
--   ✅ 裝得回去的:四支的表級 ACL 授權集合(2026-09-05 16:4x 唯讀逐支量過的那份)
--   ⛔ 裝不回去的:① grantor 是誰 ② WITH GRANT OPTION ③ 欄級 ACL ④ PUBLIC 那份
--                  ⑤ 原授權是哪一支 migration / 哪個平台動作下的
--      🔬 而 ①~④ 貼前實量【都是空的】(grantor 全是 postgres · grant option 0 · 欄級 ACL 0 · PUBLIC 0)
--         ⇒ 所以今天跑它裝回去的與貼前【看起來一樣】。**⑤ 未知, 而它不影響權限。**
--   🛑 **退之前先重跑那四個量測** —— 任一項非零就不要整支跑, 停下問。
--
-- 🔴 **不要用 `GRANT ALL` 給四支** —— 後兩支貼前【只有 SELECT + MAINTAIN】,
--    `GRANT ALL` 會多給它們六種它們本來就沒有的權限 ⇒ 那不是復原, 是把洞開得更大。
--
-- ══ 停損順序(出事的當下照這個判, 不要整支跑)═══════════════════════════
--   症狀 = 顧客站讀不到商品/車款  ⇒ **只跑 §1**(把 SELECT 補回去), 一行都不要多。
--   症狀 = 其他                    ⇒ 🛑 停下問。本檔只動 ACL;讀不到以外的症狀多半不是它造成的,
--                                     而整支跑會把剛收掉的寫權全部裝回去。
-- ══════════════════════════════════════════════════════════════════════

-- ══ §1 只把【讀】補回去(顧客站讀不到時跑這一段就好)═════════════════════
BEGIN;
GRANT SELECT ON TABLE public.products_list_public     TO anon, authenticated;
GRANT SELECT ON TABLE public.vehicle_taxonomy_public  TO anon, authenticated;
GRANT SELECT ON TABLE public.products_public          TO anon, authenticated;
GRANT SELECT ON TABLE public.product_variants_public  TO anon, authenticated;
COMMIT;

-- ══ §2 整個裝回貼前狀態(⚠️ 這會把本片收掉的寫權【全部裝回去】)═══════════
-- 🛑 只有在「確定要放棄這一片」時才跑。跑之前先讀上面的停損順序。
-- BEGIN;
--   -- 前兩支貼前是【八種全開】
--   GRANT ALL ON TABLE public.products_list_public    TO anon, authenticated;
--   GRANT ALL ON TABLE public.vehicle_taxonomy_public TO anon, authenticated;
--   -- 🔴 後兩支貼前【只有 SELECT + MAINTAIN】—— 不要給 ALL
--   GRANT SELECT, MAINTAIN ON TABLE public.products_public         TO anon, authenticated;
--   GRANT SELECT, MAINTAIN ON TABLE public.product_variants_public TO anon, authenticated;
-- COMMIT;

-- ══ §3 跑完之後自己核一次(唯讀, 貼哪裡都行)═════════════════════════════
-- 期望:跑完 §1 ⇒ select_cells = 8;跑完 §2 ⇒ write_cells 回到 32。
SELECT
  (SELECT count(*) FROM (VALUES ('public.products_list_public'),('public.vehicle_taxonomy_public'),
                                ('public.products_public'),('public.product_variants_public')) t(rel)
     CROSS JOIN (VALUES ('anon'),('authenticated')) r(rolname)
    WHERE pg_catalog.has_table_privilege(r.rolname, t.rel, 'SELECT')) AS select_cells_expect_8,
  (SELECT count(*) FROM (VALUES ('public.products_list_public'),('public.vehicle_taxonomy_public'),
                                ('public.products_public'),('public.product_variants_public')) t(rel)
     CROSS JOIN (VALUES ('anon'),('authenticated')) r(rolname)
     CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),
                        ('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(priv)
    WHERE pg_catalog.has_table_privilege(r.rolname, t.rel, p.priv)) AS write_cells_0_after_migration_32_after_S2;
