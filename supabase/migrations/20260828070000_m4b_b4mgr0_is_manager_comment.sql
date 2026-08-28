-- ⟦b4-MGR0⟧ is_manager 欄位註解訂正(COMMENT-only,無 DDL、無資料變更、無 GRANT)
--
-- 為什麼要這一支:20260726120000_m4b_e8a1_staff_table.sql:28-29 那句 COMMENT 逐字寫著
--   「⚠️ 本欄目前無任何程式讀取、不強制任何權限;成本遮蔽於後續片才實作。看到此欄不代表權限已生效。」
-- 而 2026-08-28 起那句話是【假的】—— 本欄已經是員工管理的權限閘。
-- 🔴 它是維運者查 schema 時唯一看得到的說明 ⇒ 它變假的代價是【下一個查 DB 的人被誤導】,
--    而沒有任何三綠會發現這件事。
--
-- ⚠️ 順序是硬的(plan §3):**先出 code, 再 apply 本檔**。
--    反過來 ⇒ schema 提前宣稱「權限已生效」而碼還沒上 ⇒ 那句話當下就是假的。
--    退場:先 revert code, 再把 COMMENT 改回去。只 revert code ⇒ DB 繼續說它是權限而它已經不是。
--    ⇒ 對應的 code commit = d3ae02df(12 支檔)。
--
-- 🔴 apply 是 Sean 的手(正式庫寫入),不是任何 AI 的。

COMMENT ON COLUMN public.staff.is_manager IS
  '本欄目前【承載兩個語意】, 而它們尚未被拆開 ——
   (1) 原始用途:成本遮蔽(建表時的設計, 該片尚未實作)。
   (2) M-4b b4-MGR0 起(2026-08-28):員工管理的權限閘 ——
       只有 is_manager AND is_active 的 actor 才能新增 / 修改 / 停用員工與本欄
       (閘在 apps/admin/src/lib/session/authorize.ts 的 authorizeManagerMutation)。
   ⚠️ 成本遮蔽片動工時必須先決定:沿用本欄, 還是拆成兩欄。
      沿用 = 讓某人看成本就等於給他鑄造管理者的權限。
   ⚠️ 那道閘住在【應用層】, 而它有兩條互相獨立的天花板(任一條成立就夠):
      路一 持 service_role 的程式仍可直接寫本欄。那不是技術限制:本表 GRANT 是【欄級】的
           (20260726120000_m4b_e8a1_staff_table.sql:72 逐字
            GRANT UPDATE (label, is_manager, is_active) ON TABLE public.staff TO service_role)
           ⇒ REVOKE 本欄的 UPDATE 權就關得掉。是 Sean 2026-08-28 讀過代價後【選擇不鎖】。
      路二 那道閘的效力綁在 ADMIN_REQUIRE_REAL_IDENTITY=1 上;旗標關掉時操作者身分是自選的。';
