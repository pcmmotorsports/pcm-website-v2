-- ⟦b4-MGR0⟧ is_manager 欄位註解:把 Sean 2026-08-29 的拍板寫進 schema
-- (COMMENT-only:無結構變更、無資料變更、無 GRANT、無 RLS 變更)
--
-- 🔴 訂正一句我原本寫錯的(codex 對抗審查 MF3 抓到,依 PostgreSQL 官方 COMMENT 文件):
--    我原本寫「無 DDL」——**那是錯的**。`COMMENT ON` 本身就是 DDL:它需要
--    【物件擁有者權限】,並取得 `SHARE UPDATE EXCLUSIVE` 鎖 ⇒ 它會與 VACUUM / 其他 DDL 互相等待。
--    📌 忙碌時段套用仍可能卡住 —— 「只是改一句說明」與「零副作用」不是同一件事。
--
-- 🔴 為什麼要這一支,而不是改 20260828070000 那支:
--    那支【可能已經 apply 了,而我答不出來】——`supabase/APPLIED.tsv` 對 08-28 那 11 支
--    只記到 1 支(當場量:`ls supabase/migrations/2026082[89]*.sql | wc -l` ⇒ 11、
--    `grep -c '2026082[89]' supabase/APPLIED.tsv` ⇒ 1;正對照 `20260824020000` ⇒ 1、
--    負對照 `29990101000000` ⇒ 0)。
--    📌 一本答不出「apply 了沒」的帳,與一本說「沒 apply」的帳,在這裡印同一個 0。
--    ⇒ 所以改既有檔不安全,新開一支覆寫才安全。
--
-- 🛑 **套用順序是硬的**(codex 對抗審查 MF2 抓到 —— 我原本寫「兩種順序結果相同」,**那是錯的**):
--    `COMMENT ON` 是【覆寫】不是【合併】⇒ **最後套用的那一支決定最終字面**。
--    ✅ 正確:20260828070000 先、本檔後  /  或【只套本檔】
--    🔴 錯誤:本檔先、20260828070000 後 ⇒ **舊字面覆蓋新字面, 而那句已被推翻的「還沒決定」會回來**
--    📌 而套錯順序【沒有任何訊號】—— 兩種順序都成功、都不報錯、三綠都綠。
--    ⇒ 給 Sean 的一句話:**這一支要排在 20260828070000 後面貼。**
--
-- ⇒ 這一支要修掉的,是【上一支自己留下的那個開放問題】:
--    20260828070000 逐字寫著「⚠️ 成本遮蔽片動工時必須先決定:沿用本欄, 還是拆成兩欄。」
--    而 Sean 2026-08-29 已經決定了 ⇒ 那句話現在會讓下一個人以為這題還沒答。
--    🔴 一句【曾經為真的待決事項】,在拍板之後就變成一個假的待辦 —— 而它沒有到期日。
--
-- 🔴 apply 是 Sean 的手(正式庫寫入),不是任何 AI 的。本檔零 apply。

COMMENT ON COLUMN public.staff.is_manager IS
  '本欄【刻意】同時承載兩個語意,而 Sean 已拍板【不拆】——
   (1) 成本遮蔽(建表時的原始設計;該片尚未實作)。
   (2) M-4b b4-MGR0 起(2026-08-28):員工管理的權限閘 ——
       只有 is_manager AND is_active 的 actor 才能新增 / 修改 / 停用員工與本欄。
       🔴 那道閘住在【兩層】, 兩層都要指名 —— 只指第一層會把人送到一支不出現本欄名的檔:
          第一層 apps/admin/src/lib/session/authorize.ts 的 authorizeManagerMutation(閘)
          第二層 apps/admin/src/lib/staff.ts 的 isActiveManager(**真正讀本欄的地方**)

   🔴 為什麼不拆成兩欄(2026-08-29 Sean 拍板 Q-COST,逐字「甲 就這樣, 不用改」):
      一個看得到成本的人, 就該能管設定 —— 這兩件事在 PCM 是同一種人。
      ⇒ 動本欄、或動任何「誰看得到成本」的設計之前, 先讀那個拍板,
        不要把它當成一個還沒有人決定的技術債。
      落檔 ~/pcm-mailbox/等Sean決策-20260829.md;守門
      apps/admin/src/lib/session/is-manager-cost-contract.test.ts。

   ⚠️ 那道閘住在【應用層】, 而它有兩條互相獨立的天花板(任一條成立就夠):
      路一 持 service_role 的程式仍可直接寫本欄。那不是技術限制:本表 GRANT 是【欄級】的
           (20260726120000_m4b_e8a1_staff_table.sql:72 逐字
            GRANT UPDATE (label, is_manager, is_active) ON TABLE public.staff TO service_role)
           ⇒ REVOKE 本欄的 UPDATE 權就關得掉。是 Sean 2026-08-28 讀過代價後【選擇不鎖】。
      路二 那道閘的效力綁在 ADMIN_REQUIRE_REAL_IDENTITY=1 上;旗標關掉時操作者身分是自選的。

   ⚠️ 而【不拆欄】這個決定本身帶著一個已知代價, Sean 讀過:
      讓某人看成本, 就等於給他鑄造管理者的權限。這不是疏漏, 是被選擇的。';
