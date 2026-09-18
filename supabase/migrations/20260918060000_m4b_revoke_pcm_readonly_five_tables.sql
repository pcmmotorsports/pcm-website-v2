-- 20260918060000 · M-4b · 收掉 `pcm_readonly` 在【五張表】上的 SELECT
--
-- plan:`docs/plans/2026-09-18-revoke-pcm-readonly-on-saved-order-views-plan.md`
--   🛑 **Sean 逐字答過的是【三題】, 不是「我批准這份 plan」**(R1 N6 —— 不要把它寫成後者):
--     · Q「什麼時候貼」⇒ **甲:等推 main 那一發跑完再貼**
--     · Q「要不要先跑那三發 pg_stat_statements」⇒ **甲:先跑**
--     · Q「判準第三條沒過, 貼不貼」⇒ **乙:貼**(理由與代價見下面〈判準沒過〉那節)
--   🔴 **而上面那三句他答的是【一張表】的版本。範圍改成五張之後, 它們的射程要重讀** ——
--     見下面〈範圍變了〉那一節最後一格。
-- 前一片:`20260918050000`(把 65 條裡的 61 條唯讀授權寫進版控 —— **下面那四張刻意不在那 61 條裡**)
--
-- ════════════════════════════════════════════════════════════════════════════
-- ═══ 🔴🔴 範圍變了:2026-09-18 夜【從一張變五張】⇒ 這是一片【新的】片 ═══════
-- ════════════════════════════════════════════════════════════════════════════
-- ⛔ ~~舊範圍(R1→R4 審過的那一版):只收 `admin_saved_order_views` 一張。~~
--    **舊字面留著不刪** —— 下一個人要看得出這片被擴過, 而不是以為它生下來就是五張。
--
-- ✅ **新範圍(Sean 2026-09-18 夜 Q1 / Q2 拍甲), 五張**:
--
--   | 表 | 誰決定的 | 那條授權在 repo 裡有沒有出處 |
--   |---|---|---|
--   | `admin_saved_order_views`  | Sean 09-18 稍早拍甲 | 🔴 **沒有**(孤兒, 查不到誰加的) |
--   | `payment_charge_attempts`  | Sean 09-18 夜 Q1 甲 | 🔴 **沒有**(在那 65 條裡) |
--   | `order_cancellations`      | Sean 09-18 夜 Q1 甲 | 🔴 **沒有**(在那 65 條裡) |
--   | `order_cancellation_items` | Sean 09-18 夜 Q1 甲 | 🔴 **沒有**(在那 65 條裡) |
--   | `order_item_costs`         | Sean 09-18 夜 Q2 甲 | 🟢 **有** —— 見下面〈第五張不一樣〉 |
--
-- 🛑🛑 **範圍改了就是【新的一片】** ⇒ `20260918060000` 走過的 R1→R4 那四輪,
--    **不構成這一版的背書**。它們審的是「一句 REVOKE + 那些閘」,
--    而現在是「五句 REVOKE + 每張各自的閘 + 一個跨五張的分母」。
--    ⇒ ✅ **這一版要重審。**
-- 🔵 **而舊四輪抓到的東西【原字面留在檔裡】** —— 它們談的是**閘的形狀**
--    (`has_table_privilege` 沒判別力 / 編號與實體脫鉤 / 依賴要寫在被依賴那一端 / …),
--    那一層沒有因為範圍變了而失效。**留著, 不要當成舊版的殘骸清掉。**
--
-- 🔴 **Sean 那三句答覆的射程, 照實寫**:
--    · 「等推 main 那一發跑完再貼」⇒ **與張數無關**, 照樣適用。
--    · 「先跑那三發 `pg_stat_statements`」⇒ 🔴 **那三發是為【一張表】跑的。**
--      另外四張**沒有等價的讀數**, 而且**這個帳號量不到**(見〈用量:量不到〉那一節)。
--    · 「判準第三條沒過照樣貼」⇒ 🔴 **那是針對【那一張】的知情決定。**
--      **它有沒有涵蓋新加的四張, 本檔不替他回答。**⇒ 待他裁, 見檔尾〈端給 Sean 的〉。
--
-- ════════════════════════════════════════════════════════════════════════════
-- ═══ 🔴🔴 第五張不一樣:`order_item_costs` 是【推翻】, 不是【補洞】 ═══════════
-- ════════════════════════════════════════════════════════════════════════════
-- 另外四張的形狀是:**沒有人決定過, 而它在線上**(孤兒)。
-- 🟢 **`order_item_costs` 不是。** 它那條授權**寫在版控裡、有出處、有日期**:
--      `20260914010000_m4b_order_item_costs.sql:109` 逐字
--        `GRANT SELECT ON TABLE public.order_item_costs TO pcm_readonly;`
--      帳本 `supabase/APPLIED.tsv:644`(2026-09-14 已貼, sha `9ce4f5c3…`)
--   🔬 而 `grep` 全 `supabase/migrations/` ⇒ 提到 `order_item_costs` 的 `pcm_readonly`
--      GRANT **只有這一處**(主視窗 2026-09-18 夜獨立複核過, 結論相同)。
--
-- 🔴 **所以收掉它 = 推翻 2026-09-14 那一片的一個決定。**
--    ⚠️ 而那一片**沒有替這條授權寫理由** —— `:107-109` 只有三句 ACL, 檔頭零次提到
--       `pcm_readonly`(2026-09-18 夜實查:全檔命中 1 次, 就是 `:109` 那一句本身)。
--    ⇒ 📌 **它是「被寫下來了」, 而不是「被論證過」。** 兩者不一樣, 不要把前者讀成後者。
-- 🎯 **而 Sean 的 Q2 甲與他 09-14 的另一個拍板是【同一個方向】**:
--    那天他拍「老闆成本都做好(要 schema)」, 而成本欄在後台是 `is_manager` 才看得到
--    (`20260914010000:152-158` 的寫入閘、`apps/admin` 的 `canBoss`)。
--    ⇒ **一個查帳用的唯讀帳號讀得到進貨成本, 與「成本只給老闆看」是矛盾的。**
--    🛑 而上面這句是**我的推論**, 不是他說的話。他說的是「甲」。**照實分開寫。**
--
-- 🔵 **replay-from-zero 不會把它加回來 —— 查過才寫**:
--    `20260914010000` < `20260918060000` ⇒ 依序重放時 GRANT 先跑、本片的 REVOKE 後跑
--    ⇒ **終態是收掉的。** 順序站得住。
-- 🔴 **而另外四張在那個世界裡會讓本片【擋下來】**:重放時沒有任何一支 migration 給過
--    它們 `pcm_readonly` 的 SELECT ⇒ 本片前置閘③「那條現在還在嗎」會 RAISE。
--    ⚪ **而那不是本片新造成的阻塞** —— `scripts/migrations-replay-from-zero.sh` 在這棵樹上
--      **早就停在更上游**(`scripts/20260909010000-verify.sh:210` 逐字:
--      「而 `migrations-replay-from-zero.sh` 在這棵樹上停在前置閘②(上游先失敗了)」),
--      且 `package.json:161` 在 CI 只跑它的 `--selftest`, 不跑全量重放。
--    ⇒ 🛑 **照實寫:本片在「從零重放」那個世界裡會擋, 而今天沒有人走那條路。**
--      **哪天有人把重放修好, 這一格會是他撞到的東西。**
--
-- ════════════════════════════════════════════════════════════════════════════
-- ═══ 🔬 2026-09-18 夜 · 五張表的正式庫唯讀實查(`pcm_readonly` 帳號跑的)═══════
-- ════════════════════════════════════════════════════════════════════════════
-- 🟢 **五張的形狀【完全一樣】, 而那是量出來的不是猜的**:
--
--   relacl(逐字, 五張只有排序差異):
--     `admin_saved_order_views` : {postgres=arwdDxtm/postgres,pcm_readonly=r/postgres,service_role=r/postgres}
--     其餘四張                   : {postgres=arwdDxtm/postgres,service_role=r/postgres,pcm_readonly=r/postgres}
--   owner = `postgres`(五張)· `relrowsecurity = t`(五張)· `relkind = r`(五張)
--   `pcm_readonly` 的 SELECT:五張都在, `is_grantable = f`, `grantor = postgres`
--   `service_role` 的 SELECT:五張都在, `is_grantable = f`, `grantor = postgres`
--   policy:**五張各 1 條, 全部 `FOR SELECT TO service_role`**
--     ⇒ 🔴 **對 `pcm_readonly` 適用的 policy = 0 條(五張全部)**
--   欄級 `attacl`:**五張全部 0 欄**
--     ⚪ **判別力對照(同一把尺, 同一發)**:`pcm_settle_retry_attempts` = **4 欄** /
--        `supplier_sync_runs` = **5 欄** ⇒ 📌 **那把尺會動, 那五個 0 不是「我查錯地方」。**
--   `PUBLIC`(grantee = 0)的授權:**五張全部 0 條**
--     🛑 **而這一格【沒有正對照】** —— 我沒有在同一發裡找到一張確實對 PUBLIC 開著的表來燒。
--        ⇒ 照實標:**這個 0 的判別力未證**。下面前置閘⑤ 不靠它, 它自己會在貼板當下再問一次。
--   角色屬性:`pcm_readonly` `rolbypassrls = t` / `rolsuper = f` / `rolcanlogin = t`
--     ⚪ 對照:`anon` = f · `authenticated` = f · `service_role` = t · `postgres` = t
--   `pg_auth_members`:
--     · `pcm_readonly` **不是任何角色的成員**(0 筆)
--     · **是 `pcm_readonly` 成員的**只有 `postgres` 一個(grantor `supabase_admin`, admin_option t)
--       ⇒ 而 `postgres` 是這五張的 **owner** ⇒ `has_table_privilege` 對它五張全 `t`,
--         **收掉 `pcm_readonly` 那條它一點都不會少** ⇒ over-revoke 名單今天是 `{postgres}` 而恆綠。
--   `pg_default_acl`:**`pcm_readonly` 不在任何一筆預設權限裡**
--     ⇒ 📌 **這五條都不是自動發的, 是有人明確下的。**(其中四條查不到是誰。)
--   全域分母:`pcm_readonly` 的**表級 SELECT aclexplode 列數 = 81**
--     (同一發第二問「任何權限的列數」也是 81 ⇒ **它只有 SELECT, 沒有別的**)
--
-- 🔴🔴 **本片那個「零 policy」的讀數, 與板 050000 拿掉那三張是【同一件事的兩面】** ——
--    五張都是 RLS enable + 對 `pcm_readonly` **零 policy**
--    ⇒ 哪天拿掉 `pcm_readonly` 的 `BYPASSRLS`, 它當場**讀到空陣列且不報錯**(fail-open),
--      而「拿掉 BYPASSRLS」正是這條線在做的事(`20260904270000` 檔頭逐字)。
--    ⇒ 📌 **本片把那條路直接關掉:沒有表權限, 有沒有 BYPASSRLS 都讀不到。**
--      **BYPASSRLS 繞的是 RLS, 不是 GRANT。兩道串聯, 收哪一道都讀不到。**
--
-- ════════════════════════════════════════════════════════════════════════════
-- ═══ 🔴🔴 一個【已經走過 R1-R4 的檔頭】裡的假數字, 今夜量出來 ═════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- ⛔ ~~本檔舊版〈判準沒過〉那一節逐字:「⚪ 對照組 `orders` **97,869**」~~
-- 🔬 **2026-09-18 夜實查**(`pg_stat_user_tables`, schemaname='public'):
--      `orders` `n_live_tup` = **8** · `n_dead_tup` = 16 · `last_analyze` / `last_autoanalyze` 皆 **NULL**
--      而 `SELECT count(*) FROM public.orders` = **10**
--    ⇒ 🔴 **那個 97,869 今天量不出來。它不是「漂了一點」, 是差四個數量級。**
-- 🎯 **最可能的來源(吻合而未證實, 照工作守則標)**:同一列的 **`seq_scan`** ——
--    今夜 `orders` `seq_scan` = **100,463**, 而 97,869 → 100,463 的成長幅度
--    與「隔幾個小時」吻合。⇒ **我把一個【掃描次數】當成了【有幾列】, 並且拿它當對照組。**
--    🛑 **我證不到當時那一格讀的是哪一欄** ⇒ 標「吻合但未證實」, 不寫成「經查」。
-- 🔴🔴 **而這一格為什麼比那個數字本身重要**:
--    **那是【對照組】** —— 它存在的唯一理由, 就是讓「`admin_saved_order_views` = 0」
--    這個讀數有意義。⇒ 📌 **一個壞掉的對照組, 比沒有對照組更糟:它會讓一個沒判別力的讀數**
--    **看起來已經被驗證過。** 而它**走過了 R1、R2、R3、R4 四輪, 沒有一輪去量它。**
--    ⇒ 🛑 **四輪審查都不會替你重跑一個數字。** 審查看的是推理, 不是量測。
--
-- ✅ **今夜重量的五張真 `count(*)`(不是估計值)**:
--      `admin_saved_order_views`  = **0**
--      `order_item_costs`         = **0**
--      `payment_charge_attempts`  = **2**
--      `order_cancellations`      = **4**
--      `order_cancellation_items` = **4**
--    ⚪ 對照組(同一發, 同一把尺):`orders` = **10** ⇒ 尺會回不同的數, 不是恆 0。
-- 🛑 **而「表是空的」證不到「收掉它沒有代價」** —— 舊版已經寫過這句, 原字面留著:
--    壞法是 `permission denied` 不是回 0 列 ⇒ 一句 `UNION ALL` 跨 20 張表的稽核查詢會**整句失敗**,
--    跟那張表有幾列無關。**而現在是五張, 撞上的機率是五倍, 不是一倍。**
--
-- ════════════════════════════════════════════════════════════════════════════
-- ═══ 🔴 用量:另外四張【量不到】—— 而「量不到」不是「沒人用」═══════════════════
-- ════════════════════════════════════════════════════════════════════════════
-- 舊版對 `admin_saved_order_views` 有三發 `pg_stat_statements` 讀數(Sean 拍甲要求先跑的那三發)。
-- 🔬 **2026-09-18 夜我試著對另外四張跑同一把尺, 結果是**:
--      `public.pg_stat_statements` ⇒ `ERROR: relation ... does not exist`
--      實際位置 = **`extensions` schema**(`pg_extension` 實查:`pg_stat_statements` 裝在 `extensions`)
--      `extensions.pg_stat_statements` ⇒ **`ERROR: permission denied for schema extensions`**
--    ⇒ 🛑 **`pcm_readonly` 這個帳號讀不到那張表。**
-- 📌 **而這兩種錯誤【長得不一樣, 意思也不一樣】, 照實分開寫**:
--      · `does not exist` = 我查錯地方(我的錯)
--      · `permission denied` = **它在, 而我沒資格看** ⇒ 📌 **「沒有查」不是「查無」。**
--    ⇒ 🔴 **所以本檔【不宣稱】另外四張沒人在用。它宣稱的是:我沒有量到, 而且我這個身分量不到。**
--      要量它, 要一個讀得到 `extensions` 的身分 ⇒ 那是主視窗或 Sean 的 SQL Editor。
-- 🛑 **這一格是本片最該被 Sean 看到的東西之一** —— 他當時拍「先跑那三發」,
--    而**新加的四張沒有那三發**。⇒ 待他裁, 見檔尾。
--
-- ════════════════════════════════════════════════════════════════════════════
-- ═══ 🎯 為什麼五張用【一個迴圈】而不是五份複製 —— 先講, 免得被讀成偷懶 ═════════
-- ════════════════════════════════════════════════════════════════════════════
-- 要求逐字是「**每一張都要各自的前置閘 + 後置閘, 不要因為『同一片』就共用一組**」。
-- 🎯 **那個要求要防的病, 是【一道問整體的閘】** —— 例如
--      `count(*) … WHERE grantee = pcm_readonly AND relname IN (五張) ` = 0
--    ⇒ 它在「五張都收掉了」與「四張收掉、一張本來就沒有」兩個世界**印同一個東西**,
--      而且**答不出是哪一張**。
-- ✅ **本片的迴圈不是那種**:它對**每一張各問一次**、**各自 RAISE 並在訊息裡指名那一張**、
--    並且**數自己跑了幾圈**(`n_checked`), 最後用 `n_checked = 5` 把「有一張被跳過」擋掉。
--    ⇒ 📌 **每一張都有自己的判定與自己的錯誤訊息。少的只是【複製的字】, 不是【判定的格數】。**
-- 🛑 **而五份複製有一個具體的代價, 不是風格問題**:
--    這一整條線今天所有的病, 源頭都是**同一件事有兩份會各自漂移的副本**
--    (板 050000 檔頭逐字:「不要在治它的那一片裡再造一份」)。
--    五份 200 行的閘 = **五份會各自漂移的副本**, 而它們的差異**沒有任何尺看得見**。
-- ⚠️ **迴圈自己的代價, 一起寫**:一個寫錯的迴圈會**一次打壞五張的閘**, 而五份複製不會。
--    ⇒ ✅ **所以才有 `n_checked = 5` 那道恆等式, 以及下面那個【獨立分母】**
--      (全域 aclexplode 列數必須剛好少 5)—— **它們是專門用來抓「迴圈沒跑到」的。**
--    ⇒ 🛑 **要刪那兩格之前先讀這一段。它們是這個設計成立的條件, 不是裝飾。**
--
-- ════════════════════════════════════════════════════════════════════════════
-- ═══ 🔴 本片【不是 no-op】—— 它真的會改變正式庫的 ACL ════════════════════════
-- 前一片(050000)是 no-op(重複 GRANT 已有授權 ⇒ relacl 逐字不變)。
-- **本片不是。** 貼完之後**五張表**的 `relacl` 各會**少一列**。
-- ⇒ 📌 所以本片的前置閘問的是「**那條現在還在嗎**」, 後置閘問的是「**它不見了嗎**」——
--    與 050000 的方向**相反**, 不要照抄那一片的閘。
--
-- ════════════════════════════════════════════════════════════════════════════
-- ═══ 兩條破法不一樣(`admin_saved_order_views` 那一張的原始論證, 原字面留著)═══
-- 🔬 2026-09-18 正式庫唯讀實查, 那張表的 `relacl` 逐字:
--      `{postgres=arwdDxtm/postgres,pcm_readonly=r/postgres,service_role=r/postgres}`
--    對照 `20260828080000:189-191` 記的 2026-08-28 讀數 `postgres=arwdDxtm/postgres`
--    ⇒ 設計破了, 而**兩條破法不一樣**:
--
--  🔴 **`pcm_readonly=r` —— 孤兒, 本片要收的就是它**
--     · repo 全庫 **零** `GRANT … admin_saved_order_views … TO pcm_readonly`
--     · 2026-09-18 實查 `pg_default_acl`:**`pcm_readonly` 不在任何一筆預設權限裡**
--       ⇒ **不是自動發的, 是有人手動下的。**
--     · 🛑 **而【查不到】是誰、什麼時候。本檔照實寫「查不到」, 不寫「沒有」。**
--
--  🟢 **`service_role=r` —— 有出處、有拍板、在版控裡 ⇒ 不碰**
--     · `20260904270000_m4b_rls_service_role_select_36.sql:231` 把本表列進那份 40 張名單
--     · `:350` 逐字 `EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', r.relname)`
--     · 帳本 `supabase/APPLIED.tsv:515` ⇒ 已貼(2026-09-05 記帳)
--     · 該檔檔頭 `:7-9` 引 **Sean 2026-09-04 `Q-RLS` 拍甲**逐字:
--         「甲 = 收 (推薦) —— 先把 43 張表的後台讀取政策補完, 補完才收;現在開工」
--       `:9` 逐字:「⇒「收」= 拿掉 `service_role` 的 `BYPASSRLS`。**那是【另一支】migration, 不在本支**」
--     ⇒ 📌 **那條 GRANT 的用途, 白紙黑字就是「為了之後收掉特權」。**
--       它今天零呼叫是**預期的**, 不是它沒用 ⇒ **收掉它 = 把 09-04 拍甲做到一半的事推倒。**
-- 🔵 **而這件事對新加的四張【一模一樣】**:它們的 `service_role=r` 也是
--    `20260904270000` 那一輪給的(五張今天都各有一條 `FOR SELECT TO service_role` 的 policy,
--    2026-09-18 夜實查)⇒ 🛑 **本片五張都【只收 `pcm_readonly`】, `service_role` 一條都不碰。**
--
-- 🎯 **而這一格是本片最該被記住的東西**:
--    **「沒出處」與「沒查到出處」是兩件事, 而它們寫出來長得一模一樣。**
--    ⇒ 📌 **「查出處」不是行政手續 —— 它會【推翻題目本身】。**
--      2026-09-18 實例一:原本的拍板是「兩條都收」, 去查了「誰、什麼時候加的」之後**重拍**。
--      2026-09-18 實例二(今夜):Sean 說「四張」, 去查了出處之後發現
--        **板 050000 碰得到的只有三張**, 第四張要由本片收。**題目的形狀被查出來的東西改了。**
--
-- ════════════════════════════════════════════════════════════════════════════
-- ═══ 🔴🔴 本片是在【判準沒過】的情況下貼的 —— Sean 知情之後推翻(舊字面留著)═══
-- plan §3-2b 訂了「可以貼」的三個條件。**貼板當下第三個沒過**:
-- ```
-- ① 尺有在記這個角色                    ✅ pcm_readonly stmt_kinds 2,723 / calls 8,607
-- ② 扣掉我們自己的探測之後 = 0           ✅ 那 3 筆全是 count(*) 探測, 沒有一句在讀內容
-- ③ dealloc = 0 且 window_len ≥ 30 天    🔴 【沒過】
--      stats_reset = 2026-09-05 18:31 UTC ⇒ window_len = 12 天 17 小時(不到 30 天)
--      dealloc     = 10 ⇒ 有 10 筆被擠掉過
-- ```
-- ⇒ 🔴 **照 plan 寫死的保守線, 這裡的動作是【不貼】。而 Sean 知情之後拍【乙:貼】。**
-- 🔴🔴 **而上面那整格【只涵蓋 `admin_saved_order_views` 一張】** ——
--    新加的四張**連①②③ 都沒有讀數**(見上面〈用量:量不到〉)。
--    ⇒ 🛑 **不要把那個「乙」讀成「五張都批了」。**
--
-- **推翻的理由(逐字, 主視窗端給他的那四條)**:
--  🛑 · **甲那條路的真相**:
--      ⛔ ~~`dealloc` **只增不減**;那時 `dealloc` 只會更大~~
--      🔴 **更正(R2 MF-B / R1 N2):那句不成立** —— `pg_stat_statements_reset()` **會把 `dealloc` 歸零**
--        (那也正是 `stats_reset` 的來源)。✅ 照實寫:**在今天的設定下它實際上不會變綠**,
--        而讓它變綠的兩條路(**調大 `pg_stat_statements.max`** / **reset 之後重等 30 天**)
--        **都沒有被評估**。窗滿 30 天要等到 **2026-10-05**, 而在那之前 `dealloc` 只會更大。
--      ⇒ **甲的條件在「什麼都不改」的前提下很可能滿足不了。**
--      ⇒ 📌 **一個永遠不會變綠的閘, 實際效果是「這件事再也不做」。**
--  · 那張表**今天是空的** —— 🔴 **而這句有兩個讀數, 強弱不同(R2 MF-B / R1 N3)**:
--      · `pg_stat_user_tables`:`n_live_tup = 0` ⚠️ **這是估計值, 不是 `count(*)`**
--        (`seq_scan = 4` / `idx_scan = 2`)
--        ⛔ ~~⚪ 對照組 `orders` 97,869~~ 🔴 **那個對照組今夜量出來是假的, 見上面那一整節。**
--        ✅ **今夜補了真的 `count(*)`:該表 = 0, 對照組 `orders` = 10。**
--      · 🎯 手上其實有真的 `count(*)` 跑過(`calls = 1` / `rows = 1`)——
--        🛑 **而那個 `rows = 1` 【不是】表有 1 列**:`count(*)` 本來就只回一列, `rows` 恆為 1,
--        **真正的那個數字 `pg_stat_statements` 不存。**
--        ⇒ 📌 **量過卻沒記下來, 等於沒量**, 而重跑又會再污染一次那把尺。
--        ✅ **今夜直接重跑 `count(*)` 並把數字記下來了**(上面那五格)——
--          🔴 **而那一跑本身又污染了那把尺一次**(污染方向是**假陽性** ⇒ 它不會讓人誤貼,
--          會讓人**誤停**, 而誤停沒有東西會叫)。⇒ 判準要寫「**扣掉自己的探測之後**」。
--      🛑 **而就算真的 0 列, 它證的是【這條讀路今天沒有價值】, 證不到【收掉它今天沒有代價】**:
--        壞法是 `permission denied` 不是回 0 列 ⇒ 一句 `UNION ALL` 跨 20 張表的稽核查詢會**整句失敗**,
--        跟那張表有幾列無關。
--  · ⛔ ~~收掉之後壞掉是**大聲的**(權限錯誤), **不是安靜回空**。~~
--    🔴 **更正(R2 MF-B / R1 N4):講大了。**
--      ✅ 收掉之後壞掉**會有錯誤訊息**(`permission denied`), 而**有沒有人看見取決於呼叫端** ——
--        本 repo 自己的 `scripts/acl-snapshot.sh:31` 檔頭就有這道分野。
--        ⛔ ~~逐字「出口 2(ENV-FAIL)**這不是**『沒差』」~~
--        🔴 **那不是逐字(R1 N1), 是我改寫過的。該行【真正的逐字】是**:
--          `# 出口:0 沒差 / 1 有差 / 2 ENV-FAIL(這【不是】「沒差」)`
--        ⇒ 意思一致、字面不同。📌 **標了「逐字」就要一模一樣, 否則那兩個字自己就變成一句假話。**
--        那一格存在正是因為**有人把錯誤讀成沒差**。
--  · 還原 = 把那條加回去, 而 **re-GRANT 既有授權是真 no-op**(2026-09-18 拋棄式 PG 實測:relacl 逐字相同)。
--
-- 🔴 **代價, 一起寫**:萬一真有人在用, **他明天會撞到錯誤, 而不是先被通知。**
--    **而現在是五張。**
--
-- ═══ 🎯 而代價那一句要再分成兩半, 因為【我原本沒分開講】════════════════════
--   ✅ **仍然成立**:【**使用者那一端**】會看到權限錯誤, 不是安靜回空。
--   🔴 **不成立的是**:【**我們這一端**】會知道 —— **那半是假的。**
--     偵測手段在 R1 MF2 之後只剩**人工查 Postgres 日誌一道, 而那一道沒量過**
--     (plan §5-2;`pg_stat_statements` **不記失敗的語句**, 2026-09-18 **拋棄式 PG 17.10** 實測:
--      失敗 0 筆 / ⚪ 正對照成功 1 筆)。
--   ⇒ 📌 **「壞掉是大聲的」與「我們聽得到」是兩件事。**
--     而那句沒分開講的話, 源頭在本檔作者, 不是轉述時走樣的。
--
-- ⇒ 📌 **本檔【不】把判準改寫成「過了」。**
--    這一片以後被翻出來的時候, 重點是它**知道自己沒過、還是貼了**。
--
-- ════════════════════════════════════════════════════════════════════════════
-- ═══ 🔵 順帶更正 `20260828080000` 三處已經不成立的字面(原字面留著)═══════════
-- (**只在這裡指路, 不改那支已貼的檔** —— 已貼 migration 的內部註解是【凍結的歷史】。)
--
-- 【一】`20260828080000:194-197` 逐字:
--    「這裡【不 GRANT 任何表權限給任何角色】, 連 `service_role` 的 SELECT 都不給」
--    ⛔ ~~上面那句~~ **已被 Sean 2026-09-04 `Q-RLS` 拍甲推翻**, 出處 `20260904270000:350`,
--    而那條 GRANT 是「收掉 `service_role` 的 `BYPASSRLS`」的**前置工程**。
--
-- 【二】`20260828080000:155-156` 逐字:
--    「(拿掉 BYPASSRLS ⇒ **後台**讀到空的)在本表【構造不出來】——
--      因為**今天就沒有任何一條路是靠 BYPASSRLS 讀它的**」
--    🔬 2026-09-18 實查(夜間複量, 讀數不變):
--      | 角色           | rolbypassrls | 表級 SELECT      | 表上有沒有它的 policy |
--      | pcm_readonly   | t            | 有(本片要收)    | 無 |
--      | service_role   | t            | 有(09-04 給的)  | admin_saved_order_views_select_service_role |
--      那張表 `relrowsecurity = t` · policy 共 1 條。
--    ⏳ **【待驗】本片貼完之後那句會不會變回真。**
--      判(**是推理, 不是量測**):**會**。
--        · `pcm_readonly` 收掉 GRANT ⇒ 沒有表權限 ⇒ 有 BYPASSRLS 也讀不到。
--          📌 **BYPASSRLS 繞的是 RLS, 不是 GRANT。兩道串聯, 收哪一道都讀不到。**
--        · `service_role` **不靠** BYPASSRLS —— 09-04 給了它一條 `TO service_role` 的 SELECT policy
--          ⇒ 拿掉 BYPASSRLS 它照樣讀得到 ⇒「拿掉 BYPASSRLS ⇒ 後台讀到空的」在本表仍然構造不出來。
--      🛑 **驗法(貼完之後由主視窗跑, 不是本檔跑)**:`bash scripts/rls-service-role-select-verify.sh`
--        —— 它用 `pcm_verify_norls`(**NOBYPASSRLS**, 而是 `service_role` 的成員)去讀,
--        並帶兩發突變(`USING(false)` / `RESTRICTIVE`)證明它會翻面。
--        **它仍讀得到本表 ⇒ 上面那句判斷成立;那一發跑完之前, 這裡就寫【待驗】。**
--      🔵 **而那一發現在要看【五張】, 不是一張** —— 另外四張今天也各有一條
--        `FOR SELECT TO service_role` 的 policy(今夜實查), 形狀相同。
--
-- 【三】🔴🔴 `20260828080000:152-153` —— **第三處, 而它是【唯一被機器讀】的那一處(R2 C-i)**
--    逐字:
--      `-- RLS-GATE-EXEMPT: admin_saved_order_views -- service_role 對本表【零表權限】(下方 REVOKE ALL 且不 GRANT),`
--      `--   它連 SELECT 都叫不動 ⇒ 補一條 service_role 的 SELECT 政策沒有任何人會用到它。`
--    ⛔ ~~上面那兩句~~ **今天都是假的**:
--      · `service_role` **2026-09-04 拿到了表級 SELECT**(`20260904270000:350`)
--      · 那條 policy **存在**, 不是「沒有任何人會用到」——
--        `20260904270000:340-345` 動態建的 `admin_saved_order_views_select_service_role`
--        (`FOR SELECT TO service_role USING (true)`)。
--    🔴🔴 **而它為什麼比前兩處危險**:`RLS-GATE-EXEMPT` **會被機器解析** ——
--      `scripts/rls-service-role-policy-gate.py:105` 的 regex 在讀它(`:89` 是格式說明)
--      ⇒ **那張表現在被那道閘豁免中, 而豁免的理由是一句已經翻掉的話。**
--    ⇒ 📌 **一句被機器讀的假話, 比一百句被人讀的假話危險 —— 人會質疑, 機器不會。**
--    🛑 **本片只在這裡指路, 不改那支已貼的檔, 也【不動那個豁免的效力】。**
--      「理由翻掉了 ⇒ 這個豁免本身該不該重估」是**另一題**, 已寫進 plan §12 待 Sean 裁。
--    🔴 **那個豁免今天罩著什麼**:哪天有人刪掉 `admin_saved_order_views_select_service_role`,
--      那道閘**不會叫**(表在豁免名單裡)—— 而本檔上面【二】整段
--      「service_role 不靠 BYPASSRLS ⇒ 拿掉 BYPASSRLS 它照樣讀得到」的論證,
--      **正是靠那條 policy 撐的。**
--
-- ════════════════════════════════════════════════════════════════════════════
-- ═══ 🔴🔴 貼完【一定要跑】這三句 —— 漏跑是【靜音】的(R1 MF1)══════════════
-- `pcm_acl_digest()` 的 REL 族**逐字含 `pcm_readonly`**
--   (`20260909060000:119-134`:`CROSS JOIN (VALUES ('anon'),('authenticated'),
--    ('service_role'),('payment_confirmer'),('pcm_readonly'))` × `relkind IN ('r','v','m','p')`)
-- ⇒ 📌 **本片會把【五張表】× `pcm_readonly` 那五格由 `S------|RLS` 翻成 `-------|RLS`
--      ⇒ digest 必定改變。**
-- 🔴 而 `20260909060000` 檔頭〈本檔不涵蓋〉① 逐字:未批准的漂移訊號**【第三天會自己消失】**
--   (view 只取最新兩列)⇒ **訊號自己蒸發, 帳本從此顯示「沒漂移」, 而這筆真的變更永遠沒被批准過。**
--   (並且牴觸 Sean 2026-09-14 拍甲:貼完 migration 順手跑 `pcm_acl_approve_latest`, 理由寫版本號。)
-- 🛑 **順序不能反**(`approve_latest` 蓋的是 `max(taken_at)` 那一列,
--    先批准只會蓋到【貼之前】那一列, 下一發 cron 照樣是未批准漂移):
--      SELECT public.pcm_acl_digest_record();
--      SELECT public.pcm_acl_approve_latest('貼了 20260918060000:收掉 pcm_readonly 在五張表(admin_saved_order_views / payment_charge_attempts / order_cancellations / order_cancellation_items / order_item_costs)的表級 SELECT, REL 族那五格由 S------ 轉 -------');
--      SELECT * FROM public.pcm_acl_drift_status;
-- ✅ 三句都跑完、而 `pcm_acl_drift_status` 回【最新這列已被批准 = true】才算貼完。
-- ⚠️ **已知限制(R2 nit 4, 出處 `20260909060000:48`)**:`pcm_acl_approve_latest` 取的是
--    `max(taken_at)` 那一列 ⇒ **多窗同夜貼板時, 你的理由字串會蓋到【別人】那一列。**
--    ⇒ 本片要單獨貼, 而**貼之前先確認沒有別人正在貼**。
--
-- ════════════════════════════════════════════════════════════════════════════
-- ═══ ⚠️ 本檔必須【整支在同一個 transaction 裡】跑 ═══════════════════════════
-- 後置閘用 `current_setting(..., true)` 讀前置閘用 `set_config(..., true)` 存的值,
-- 而那個 `true` 是 **transaction-local**。
--
-- 🔬 **2026-09-18 拋棄式 PG 17.10 實測, 剝掉 BEGIN/COMMIT 之後到底怎麼壞(R1 C4)**:
--   ⛔ ~~「後置讀到 NULL ⇒ 誤擋」~~ —— **那句話兩半都不精確**:
--   · **讀到的不是 NULL, 是【空字串】**:`set_config(..., true)` 建立的 placeholder GUC
--     在**同一個 session** 裡交易結束後回到 `reset_val = ''`(不是消失)。
--     🔬 實測:同 session 交易A 設、交易B 讀 ⇒ 讀到 `[]`;`''::int` ⇒
--        `ERROR: invalid input syntax for type integer: ""`。
--     ⇒ 🔴 所以後置閘那些 `IS NULL` 的診斷訊息**在同 session 的世界裡是死碼**
--       —— 已全部改用 `NULLIF(..., '')`, 兩種都接得住。
--   · **狀態上不是 fail-closed**:那個世界裡 `REVOKE` 在它自己的隱式交易裡**已經提交**,
--     沒有 COMMIT 可以拒 ⇒ 是「**做了才叫**」⇒ 善後要跑還原檔, 不是「什麼都沒發生」。
--     🔴 **而現在是五句 REVOKE** ⇒ 那個世界裡可能**收了三張、第四張才叫** ⇒ 善後要看還原檔的斷言。
-- ⇒ ✅ 整檔貼進 SQL Editor(本 repo 的貼板方式)沒有這個問題。
--
-- 🛑 **而另一個方向也要知道(R1 C5, 出處 `20260917010000:149-150`)**:
--   本檔被**包在外層交易裡**跑時, 開頭 `BEGIN;` 只印 WARNING, 而檔尾 `COMMIT;` 會提交**外層**那個交易
--   ⇒ 本檔想要的原子性在那個模式下是假的, 而且會**順手提交同批裡別人的東西**。
--   ⇒ ✅ **本檔要單獨貼。**
--
-- ═══ 鎖 ═════════════════════════════════════════════════════════════════════
-- ⛔ ~~`REVOKE` 對目標表零筆鎖(2026-09-18 實測, **板 050000 那一輪量的**)~~
-- 🔴 **更正(R3 C2):那個引用是假的** —— 板 `20260918050000` 那一輪逐字量的是**四種動作**:
--    `GRANT` / `COMMENT ON` / `ALTER TABLE` / `SELECT` —— **`REVOKE` 不在裡面。**
--    ⇒ 📌 **我把一個【GRANT 的量測】掛在一句【講 REVOKE 的話】後面, 並且寫成「實測」。**
--
-- ✅ **2026-09-18 補量(拋棄式 PG 17.10, 同一支腳本、同一個交易內問 `pg_locks`,**
--    **尺 = `locktype='relation' AND relation = <目標表>::regclass AND pid = pg_backend_pid()`)**:
--      ① 基準(什麼都沒做)   = 0
--      ② `GRANT` 之後        = **0**   模式 <無>
--      ③ `REVOKE` 之後       = **0**   模式 <無>
--      ⚪ ④ `ALTER TABLE` 之後 = 1   `AccessExclusiveLock`
--      ⚪ ⑤ 純 `SELECT` 之後   = 1   `AccessShareLock`
--    🎯 **兩個對照組各印出一個【不同的】非 0** ⇒ 那把尺不只會動, 它**分得出粗細**
--      ⇒ ②③ 那兩個 0 站得住。
--    🛑 **而射程要講清楚(R4 C3)**:上面量的是 **`pg_locks` 這個目錄**, 不是**行為**。
--      姊妹片 `20260918050000` 自己立過更高的標準(對 GRANT 跑了雙連線行為測試),
--      **這一輪對 `REVOKE` 沒有補那一發。**
--      🔵 兩個對照組已經解掉「我查錯地方」那一半 ⇒ 這比裸的「沒看到」強很多,
--        **而結論仍比證據多一步。**
--    ⇒ ✅ **所以下面這句照實寫成推得, 不寫成行為量測**:
--      **依 `pg_locks` 證據推得 —— 不必避開客人多的時段。**(雙連線行為測試進待辦, plan §13-b。)
--    🔴 **而現在是五張表、五句 REVOKE** ⇒ 上面那一發量的是**一張**。
--      **「五張各零筆鎖」是從「一張零筆鎖」外推的** —— 五張的 `relkind` / owner / RLS 形狀
--      今夜實查完全相同 ⇒ 外推站得住, **而它仍然是外推, 標清楚。**
--
-- 🔴 **而這一發順帶翻掉了 repo 裡另一句話**:
--    `20260917010000:152-153` 逐字寫「`GRANT` **會**對目標表取鎖」+「⚠️ **我沒有實測**」。
--    ⇒ 🔴 **它底下那個斷言【今天量出來是假的】**(上面 ② = 0)。
--    🛑 **而那不是它的錯 —— 正好相反:因為它誠實標了, 今天才有人敢去量它。**
--    ⇒ 📌 **「未確認」不是欠債, 它是【下一個人可以動手的地方】。而假的「已實測」會把那個入口封起來。**
--      🎯 **而今夜那個 `orders` 97,869 就是後者的實例** —— 它寫成了讀數, 所以四輪審查沒有人去量它。
--    🛑 **本片不改那支已貼的檔** ⇒「要不要另開一片更正它」寫在 plan §12 當待決題, 由 Sean 裁。
-- 🔵 順帶:既然零鎖, 下面的 `SET LOCAL lock_timeout = '5s'` **不是保護, 是保險絲**。
--
-- 還原:`supabase/rollbacks/20260918060000-rollback.sql`(五句 GRANT + 每張各自的斷言)
--
-- ════════════════════════════════════════════════════════════════════════════
-- ═══ 🛑 端給 Sean 的(本檔不替他決定)═══════════════════════════════════════
--  ① 他 09-18 稍早答的那三句(何時貼 / 先跑三發 / 判準沒過照貼)是針對**一張表**。
--     **新加的四張要不要沿用同一個答案** —— 本檔不替他回答。
--  ② 新加的四張**沒有用量讀數**, 而 `pcm_readonly` 這個身分**量不到**
--     ⇒ 要不要先用讀得到 `extensions` 的身分補量那四張, 再貼。
--  ③ `order_item_costs` 那條**是有出處的**(09-14)⇒ 收它是**推翻**, 不是補洞。
--     本檔已照實寫成推翻;而**要不要另開一片去更正 `20260914010000` 的字面**, 待裁。
--
--  ④ 🔴🔴 **代價還有【第二半】, 而它在同一個 repo、同一週被量過(R1 MF5 補)**:
--     檔頭上面把代價只寫成「萬一真有人在用, 他明天會撞到錯誤」。
--     🔬 **而被量過的另一半是:收掉之後, 下次要查這五張的人會去拿【更大的鑰匙】。**
--     出處 `docs/plans/2026-09-17-pcm-readonly-seven-tables-grant-plan.md:29-31` **逐字**:
--       > 2026-09-17 我要驗一張大圖的文案,`scripts/readonly-prod-sql.sh` 直接 `permission denied`,
--       > 只好改走 Supabase MCP 的 SELECT(管理 API,權限比唯讀角色大很多)才拿得到那一列。
--       > 📌 **一件「只是要看一眼」的事,逼人去用一把更大的鑰匙。** 那個習慣本身是風險。
--     🎯 **那一份 plan 的方向與本片【相反】** —— 它是因為**少了** GRANT 才要**補**七張;
--       本片是**收掉**五張。⇒ 📌 **同一個病, 本片會在這五張上再造一次。**
--     🛑 **所以 Sean 要拍的那一題, 少了這半條證據就不完整。** 一併要答的是:
--       **日後要稽核這五張, 被批准的查法是什麼?**(而「就用 service_role / 管理 API」不是答案,
--       那正是上面那段話在指的風險。)
--     ⚪ 本檔**不替他選**, 也**不提供**替代路徑 —— 那會是另一片(而且可能是一片 GRANT, 不是 REVOKE)。
--  🛑 plan §12 那兩題(`RLS-GATE-EXEMPT` 豁免要不要重估 / `20260917010000` 的假話要不要另開一片)
--     **本檔不碰, 維持待裁。**
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ── 1. 前置閘 ───────────────────────────────────────────────────────────────
DO $pre$
DECLARE
  -- 🛑 這份名單是本片的**唯一真相源**。改它就是改本片的範圍 ⇒ 要回頭改檔頭那張表與 plan。
  v_tables  text[] := ARRAY[
    'admin_saved_order_views',
    'order_cancellation_items',
    'order_cancellations',
    'order_item_costs',
    'payment_charge_attempts'
  ];
  v_t        text;
  v_reg      oid;
  n_checked  int := 0;
  n_svc      int;
  n_col      int;
  n_col_ro   int;
  n_pub      int;
  n_mem      int;
  n_ro       int;
  v_grantors text;
  v_svc_pre  text := '';
  v_inh_pre  text := '';
  v_one      text;
  n_aclrows  int;
BEGIN
  -- ⓪ 🔴 名單自檢 —— **這一格是迴圈設計成立的條件之一**(檔頭〈為什麼用迴圈〉)。
  --    少一個名字 / 重複一個名字, 下面每一格都會靜靜少跑或多跑一圈而沒有東西會叫。
  IF pg_catalog.array_length(v_tables, 1) IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION '前置閘⓪:名單不是 5 個(現在 %)⇒ 本片的範圍被改過而檔頭沒跟著改 ⇒ 停下',
      pg_catalog.array_length(v_tables, 1);
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(v_tables) x) IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION '前置閘⓪:名單裡有重複的表名 ⇒ 下面的「少了 5 條」那道分母會對不上 ⇒ 停下';
  END IF;

  -- ① 角色在
  IF pg_catalog.to_regrole('pcm_readonly') IS NULL THEN
    RAISE EXCEPTION '前置閘①:角色 pcm_readonly 不存在 ⇒ 停下(本片的前提整個不成立)';
  END IF;
  -- ⚠️ R2 nit 5:先確認 service_role 在 —— 否則 to_regrole 回 NULL ⇒ 下面數到 0
  --    ⇒ 會印「20260904270000 被人動過」而真相是**那個角色不見了**(訊息誤導)。
  IF pg_catalog.to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION '前置閘①:角色 service_role 不存在 ⇒ 本片對「不碰它」的前提整個不成立 ⇒ 停下';
  END IF;

  -- ② 🔴 全域:pcm_readonly 不是任何角色的【直接】成員(R1 C1)。
  --    `aclexplode` 答的是「acl 裡有沒有那一列」, 它答不出「它讀不讀得到」——
  --    若 pcm_readonly 繼承得到 SELECT, REVOKE 之後所有閘照樣全綠而它仍讀得到
  --    ⇒ 📌 **我們會留下一筆「已收掉」的假紀錄。**
  --    🔬 2026-09-18 夜實查:0 筆。這道閘把那個讀數變成一個會擋的條件。
  --    🔵 這一格是**角色層級的**, 與表無關 ⇒ 問一次就夠, 不進迴圈。
  SELECT count(*) INTO n_mem
    FROM pg_catalog.pg_auth_members m
   WHERE m.member = pg_catalog.to_regrole('pcm_readonly');
  IF n_mem <> 0 THEN
    RAISE EXCEPTION '前置閘②:pcm_readonly 是 % 個角色的【直接】成員 ⇒ 收掉它自己那些表級 SELECT 之後, 它可能仍然繼承得到讀取權 ⇒ 本片的「收掉了」會變成一筆假紀錄 ⇒ 停下來看(2026-09-18 夜實查為 0)', n_mem;
  END IF;

  -- ③ 🔴 **獨立分母**:貼前 pcm_readonly 的表級 SELECT aclexplode 列數。
  --    後置要證明它**剛好少 5**。📌 這一格抓的是「迴圈跑漏了」與「REVOKE 誤傷了別張」
  --    —— 那是每一張自己的閘**看不到**的兩種壞法。
  SELECT count(*) INTO n_aclrows
    FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
   WHERE a.grantee = pg_catalog.to_regrole('pcm_readonly') AND a.privilege_type = 'SELECT';
  PERFORM pg_catalog.set_config('pcm.aclrows_pre', n_aclrows::text, true);

  -- ── ④ 🔴 逐表閘:五張各問一次, 各自 RAISE 並指名那一張 ──────────────────
  FOREACH v_t IN ARRAY v_tables LOOP
    -- ④-a 表在
    v_reg := pg_catalog.to_regclass('public.' || v_t);
    IF v_reg IS NULL THEN
      RAISE EXCEPTION '前置閘④-a[%]:public.% 不存在 ⇒ 停下', v_t, v_t;
    END IF;

    -- ④-b 🎯 **要收的那條【現在還在】, 而且【只有一列、由 owner 授的】** —— 本片對這張表的前提。
    --      不在 ⇒ 有人先收掉了(或本片貼過一次)⇒ **停下來看**, 不要靜靜跑完印「成功」。
    --      🛑 這裡問的是 `aclexplode(relacl)` 那一列本身, 不是 `has_table_privilege`。
    --         後者在 PUBLIC 授權或角色繼承下會回 true ⇒ 在這個問題上**沒有判別力**
    --         (板 050000 的 R2 MF1 就是栽在這把尺上)。
    --
    -- 🔴🔴 **R1 MF1 補的那一格:`grantor` —— 這是本片唯一「量過而沒做成閘」的前提。**
    --   ⛔ ~~原本這裡只問 `EXISTS`~~ ⇒ **一列跟兩列一樣綠。**
    --   🔬 **實燒(拋棄式 PG 17.10, R1 提出、我獨立複現過)**:
    --     讓另一個拿過 grant option 的角色也授一次 ⇒ acl 上變成**兩列**
    --       `pcm_readonly <- postgres` / `pcm_readonly <- second_granter`
    --     · 前置**照樣印 `✅ 前置閘④[order_cancellations]:要收的那條在`**(沒抓到)
    --     · 五句 REVOKE 跑完 —— **superuser 執行 REVOKE 視同 owner 執行, 只收得掉 `/postgres` 那一列,**
    --       **`/second_granter` 那列原封不動, 而且【連 WARNING 都不印】**
    --     · 要到**後置**①-a 才叫, 而那句訊息**一個字都沒提 grantor**
    --       ⇒ 重貼一次結果一模一樣, **操作的人從訊息裡看不到出路**(正解是用那個 grantor 的身分再 REVOKE 一次)
    --     · 此時 `has_table_privilege('pcm_readonly', …)` 仍是 **t**(我複量過)
    --   ⇒ 🛑 **那與本檔自己的標準直接牴觸**(下面 ④-e 逐字):
    --     「放在前置是為了**先擋、講清楚原因**, 而不是讓人去猜後置為什麼紅」。
    --   🔵 **壞的方向是 fail-closed**(整筆 ROLLBACK, 一列都沒少)⇒ 不是資料安全問題,
    --     是**診斷不出來**的問題。而診斷不出來的閘, 在止血的當下等於沒有。
    SELECT count(*), pg_catalog.string_agg(DISTINCT pg_catalog.pg_get_userbyid(a.grantor), ', ')
      INTO n_ro, v_grantors
      FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE c.oid = v_reg
       AND a.grantee = pg_catalog.to_regrole('pcm_readonly')
       AND a.privilege_type = 'SELECT';
    IF n_ro = 0 THEN
      RAISE EXCEPTION '前置閘④-b[%]:pcm_readonly 對 % 的 SELECT 【已經不在】⇒ 這一張沒有東西可收 ⇒ 停下來看是誰先動的(本片貼過一次也會走到這裡)', v_t, v_t;
    END IF;
    IF n_ro <> 1 THEN
      RAISE EXCEPTION '前置閘④-b[%]:% 的 acl 裡 pcm_readonly 的 SELECT 有 % 列, grantor 分別是【%】⇒ **不只一個人授過**。🔴 一句 REVOKE 只收得掉【執行者收得掉的那一列】, 其餘原封不動【且不印 WARNING】⇒ 本片會收一半 ⇒ 停下。要收乾淨, 得用每一個 grantor 的身分各跑一次 REVOKE。', v_t, v_t, n_ro, v_grantors;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
       WHERE c.oid = v_reg
         AND a.grantee = pg_catalog.to_regrole('pcm_readonly')
         AND a.privilege_type = 'SELECT'
         AND a.grantor = c.relowner) THEN
      RAISE EXCEPTION '前置閘④-b[%]:% 那唯一一列的 grantor 是【%】, 而不是本表 owner ⇒ 以 owner / superuser 身分跑的 REVOKE **收不掉它, 也不會報錯** ⇒ 停下(要用那個 grantor 的身分跑)。', v_t, v_t, v_grantors;
    END IF;

    -- ④-c 🔴 `service_role` 那條【在】, 而本片不准碰它 ⇒ 存基準給後置比。
    --      🔴 R1 C3:原本數的是【任何】privilege 而訊息說的是「那條 SELECT」
    --         ⇒ 一個「SELECT 被收掉、INSERT 還在」的庫會讓它綠 ⇒ 已收窄成 SELECT。
    SELECT count(*) INTO n_svc
      FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE c.oid = v_reg
       AND a.grantee = pg_catalog.to_regrole('service_role')
       AND a.privilege_type = 'SELECT';
    IF n_svc = 0 THEN
      RAISE EXCEPTION '前置閘④-c[%]:service_role 對 % 的【SELECT】不見了 ⇒ 那是 20260904270000 做的事被人動過 ⇒ 停下來看, 本片不在這種狀態下動手', v_t, v_t;
    END IF;
    v_svc_pre := v_svc_pre || CASE WHEN v_svc_pre = '' THEN '' ELSE ',' END || v_t || '|' || n_svc::text;

    -- ④-d 🔴 欄級:**表級 REVOKE 會連帶收掉欄級**(2026-09-18 拋棄式 PG 實測,
    --      連該角色從未有表級權限時也照收)⇒ 本表若有欄級授權, 本片會順手毀掉它而沒人會叫。
    --      🔬 2026-09-18 夜實查:五張 attacl 全部 0 欄。
    --        ⚪ 判別力對照:pcm_settle_retry_attempts 4 欄 / supplier_sync_runs 5 欄 ⇒ 尺會動。
    --      🔴 R1 C6:表級 REVOKE 連帶收欄級**只收同一個 grantee 的**
    --         ⇒ 兩個數都算, 訊息照實分開講, 而且**單位在訊息裡講明**(一個數【欄】一個數【aclitem 列】)。
    SELECT count(*) INTO n_col
      FROM pg_catalog.pg_attribute at
     WHERE at.attrelid = v_reg AND at.attnum > 0 AND NOT at.attisdropped
       AND at.attacl IS NOT NULL;
    SELECT count(*) INTO n_col_ro
      FROM pg_catalog.pg_attribute at, LATERAL pg_catalog.aclexplode(at.attacl) g
     WHERE at.attrelid = v_reg AND at.attnum > 0 AND NOT at.attisdropped
       AND g.grantee = pg_catalog.to_regrole('pcm_readonly')
       AND g.privilege_type = 'SELECT';
    IF n_col <> 0 THEN
      RAISE EXCEPTION '前置閘④-d[%]:% 有 % 個【欄】帶著欄級授權, 其中 % 條(aclitem 列)是 pcm_readonly 的 SELECT ⇒ 停下。本片的前提是「這五張沒有欄級授權」(2026-09-18 夜實查全 0)。🔴 表級 REVOKE SELECT 只連帶收【同一個 grantee 的同一種權限】⇒ 真正會被本片毀掉的就是那 % 條;其餘那些不會被毀, 但它們的出現本身就表示這張表的授權形狀變了 ⇒ 一樣停下來看。', v_t, v_t, n_col, n_col_ro, n_col_ro;
    END IF;

    -- ④-e 🔴 **PUBLIC 授權** —— 本片新加的一道(舊版沒有)。
    --      本表若對 PUBLIC 開著 SELECT, 收掉 pcm_readonly 那條之後**它照樣讀得到**
    --      ⇒ 📌 又是一筆「已收掉」的假紀錄, 而且是**後置閘②(有效權限)才會叫**的那一種。
    --      放在前置是為了**先擋、講清楚原因**, 而不是讓人去猜後置為什麼紅。
    --      🔬 2026-09-18 夜實查:五張 PUBLIC 授權皆 0 條。
    --      🛑 **而那個 0 的判別力我沒有燒過正對照**(檔頭已標)⇒ 這道閘的價值在「貼板當下現問」,
    --         不在那個讀數。
    SELECT count(*) INTO n_pub
      FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE c.oid = v_reg AND a.grantee = 0 AND a.privilege_type = 'SELECT';
    IF n_pub <> 0 THEN
      RAISE EXCEPTION '前置閘④-e[%]:% 對 PUBLIC 有 % 條 SELECT ⇒ 收掉 pcm_readonly 那條之後它照樣讀得到 ⇒ 本片的「收掉了」會是假紀錄 ⇒ 停下', v_t, v_t, n_pub;
    END IF;

    -- ④-f 🔴 **over-revoke 名單**(R2 C-a / R3 改成量損失, Sean 2026-09-18 拍甲):
    --      若有角色 X 是 pcm_readonly 的成員、X 今天靠繼承讀得到本表,
    --      而本片 REVOKE 之後 **X 也讀不到了** ⇒ 那是**本片沒打算做的事**, 而且它無聲。
    --      🔴🔴 **舊版量的是「有沒有人繼承」而不是「有沒有人會失去讀取權」** ——
    --        兩者在拋棄式 PG 上剛好一樣(那台沒人繼承), **在正式庫上不一樣**:
    --        實查 n_inh = 1, 而那 1 是 `postgres`, 它是 owner ⇒ 靠所有權讀,
    --        收掉 pcm_readonly 那條它一點都不會少 ⇒ **舊版會誤擋, 而理由是假的。**
    --      ✅ 改後:前置只**撈名單**不擋, 判斷交給後置閘(貼完再問一次)。
    --      🔵 **為什麼只撈【直接】成員就夠(R4 C6 證明, 留著)**:
    --        設 X 是 B 的成員、B 是 pcm_readonly 的直接成員。X 會因本片失去讀取權的前提,
    --        是它**所有**路徑都經過 pcm_readonly 那條 GRANT;而 B 今天必定也是 t(所以 B 在名單裡),
    --        且 B 也必定會一起失去 ⇒ **抓到 B 就等於抓到 X** ⇒ 完備, 不是窄化。
    --      🛑 **名單存【角色名】不存 OID(R4 N1, 不要「順手優化」掉)**:
    --        ⛔ ~~`has_table_privilege` 的 **oid 版對不存在的 OID 回 NULL 而不 raise**~~
    --        ⛔ ~~⇒ 交易中途有人 DROP ROLE ⇒ fail-open 靜靜放行。~~
    --        🔴🔴 **那句話是假的(R1 N2, 我獨立複量過)。** PG 17.10 實測:
    --          `has_table_privilege(999999::oid, 'public.orders'::regclass, 'SELECT')` ⇒ **`f`**, 不是 NULL。
    --          (回 NULL 的是**表** oid 那一版, 不是角色那一版。)
    --          ⇒ `NOT f` = true ⇒ 下面那道閘**照樣會 RAISE** ⇒ **它本來就不是 fail-open。**
    --        ✅ **存角色名這個【選擇】仍然留著**(name 版對不存在的角色會 ERROR, 更早叫、訊息更清楚),
    --          🛑 **而【被判死的是它的理由, 不是它本身】。**
    --          📌 一個寫成「實測」的假理由, 比沒有理由更糟:它讓下一個人**不會再去量一次**。
    --          (本片檔頭那個 `orders` 97,869 是同一個病的第二個實例。)
    --      ⚠️ 已知不可達:角色名或表名含逗號 / 直線會打爛下面這串。本 repo 的角色與表名都沒有。
    --        🔴 **而那個世界裡 `split_part` 不會 raise, 它會【靜靜切錯】⇒ fail-open**(R1 N5)
    --        ⇒ ✅ 後置解回來時加一道「這個名字真的是一個角色嗎」, 見後置閘②。
    --      🛑 **射程(R1 N3)**:`rolinherit = f` 的成員**進不了這份名單** ——
    --        🔬 實燒:一個 `NOINHERIT` 而是 `pcm_readonly` 成員的角色, 貼前貼後
    --        `has_table_privilege` **都是 f** ⇒ 永不入列;而它靠 `SET ROLE pcm_readonly` 的讀路
    --        **確實會被本片切斷**。⇒ 📌 **上面那句「完備, 不是窄化」只對 `rolinherit = t` 成立。**
    --        🔵 今天 prod 的成員只有 `postgres`(`rolinherit = t`)⇒ 構造不出來, **而射程要寫出來。**
    FOR v_one IN
      SELECT r.rolname
        FROM pg_catalog.pg_auth_members m
        JOIN pg_catalog.pg_roles r ON r.oid = m.member
       WHERE m.roleid = pg_catalog.to_regrole('pcm_readonly')
         AND pg_catalog.has_table_privilege(r.oid, v_reg, 'SELECT')
       ORDER BY r.rolname
    LOOP
      v_inh_pre := v_inh_pre || CASE WHEN v_inh_pre = '' THEN '' ELSE ',' END || v_one || '|' || v_t;
    END LOOP;

    n_checked := n_checked + 1;
    RAISE NOTICE '✅ 前置閘④[%]:要收的那條在 · service_role % 條 SELECT 沒被動過 · 零欄級 · 零 PUBLIC', v_t, n_svc;
  END LOOP;

  -- ⑤ 🔴 **恆等式** —— 迴圈真的跑了 5 圈。
  --    📌 這一格與 ⓪ 是一對:⓪ 管「名單長什麼樣」, 這裡管「它真的被走完了」。
  IF n_checked <> 5 THEN
    RAISE EXCEPTION '前置閘⑤:逐表閘只跑了 % 圈(應該是 5)⇒ 有表被跳過而沒有東西叫 ⇒ 停下', n_checked;
  END IF;

  PERFORM pg_catalog.set_config('pcm.svcsel_pre', v_svc_pre, true);
  PERFORM pg_catalog.set_config('pcm.inh_pre',    v_inh_pre, true);
  PERFORM pg_catalog.set_config('pcm.ntables',    n_checked::text, true);

  IF v_inh_pre = '' THEN
    RAISE NOTICE '🔵 前置閘④-f:沒有任何【pcm_readonly 的直接成員】今天讀得到這五張 ⇒ 後置那道 over-revoke 閘的名單是空的。';
  ELSE
    RAISE NOTICE '🔵 前置閘④-f:這些〈角色|表〉今天讀得到 ⇒ %  (貼完後置會逐一再問一次)', v_inh_pre;
  END IF;
  RAISE NOTICE '✅ 前置閘全過:5 張各自的閘都跑過 · pcm_readonly 不是任何角色的直接成員 · 貼前 pcm_readonly 表級 SELECT 共 % 列(後置要看到 %)', n_aclrows, n_aclrows - 5;
END $pre$;

-- ── 2. 動作 ─────────────────────────────────────────────────────────────────
-- 🔴 **五句, 寫死不用迴圈 EXECUTE** —— 動作要一眼看得到, 而且靜態閘掃得到字面。
-- 🛑 **`REVOKE` 本身【全靜音】**(R1 N6, 我複量過):PG 17.10 下它在「沒有東西可收」時
--    **連 WARNING 都不印**, 只回 `REVOKE`。⇒ 📌 **這五句自己不會告訴你任何事 ——**
--    **會叫的只有上下那兩組閘。** 不要把「跑完沒紅」讀成「收到了」。
--    `service_role` 不碰, `postgres`(owner)不碰。
REVOKE SELECT ON TABLE public.admin_saved_order_views  FROM pcm_readonly;
REVOKE SELECT ON TABLE public.order_cancellation_items FROM pcm_readonly;
REVOKE SELECT ON TABLE public.order_cancellations      FROM pcm_readonly;
REVOKE SELECT ON TABLE public.order_item_costs         FROM pcm_readonly;
REVOKE SELECT ON TABLE public.payment_charge_attempts  FROM pcm_readonly;

-- ── 3. 後置斷言 ─────────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_tables   text[] := ARRAY[
    'admin_saved_order_views',
    'order_cancellation_items',
    'order_cancellations',
    'order_item_costs',
    'payment_charge_attempts'
  ];
  v_t        text;
  v_reg      oid;
  n_checked  int := 0;
  n_svc_now  int;
  n_svc_pre  int;
  n_col      int;
  n_aclrows_pre  int;
  n_aclrows_now  int;
  v_svc_pre  text;
  v_inh_pre  text;
  v_pair     text;
  v_role     text;
  v_tbl      text;
  n_pairs    int := 0;
  v_acl      text;
BEGIN
  -- ⓪ 🔴 讀得到前置存的值 —— 讀不到 = 本檔沒跑在同一個 transaction 裡。
  --    🔴 R1 C4:交易結束後同一個 session 讀到的是**空字串**不是 NULL(2026-09-18 實測),
  --       而 `''::int` 會直接 ERROR ⇒ `IS NULL` 的診斷訊息會變成死碼。
  --       `NULLIF(..., '')` 把兩種世界都接住, 讓診斷訊息真的印得出來。
  --    🛑🛑 **這一格同時是【下面 over-revoke 閘的守護】(舊版 R4 C2 的教訓, 留著)**:
  --      那道閘**分不出「名單空」與「GUC 根本沒被寫進去」** —— 兩種都編碼成同一個空。
  --      而「GUC 沒被寫進去」= 前置整段沒跑。**是本格先叫, 才輪不到它靜靜跑零圈。**
  --      ⇒ 📌 **一個依賴要寫在【被依賴的那一端】—— 寫在依賴方, 刪的人看不到。**
  n_aclrows_pre := NULLIF(pg_catalog.current_setting('pcm.aclrows_pre', true), '')::int;
  IF n_aclrows_pre IS NULL THEN
    RAISE EXCEPTION '後置閘⓪:讀不到前置存的 aclexplode 分母 ⇒ 本檔沒有跑在同一個 transaction 裡 ⇒ 拒 COMMIT';
  END IF;
  IF NULLIF(pg_catalog.current_setting('pcm.ntables', true), '')::int IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION '後置閘⓪:前置存的張數不是 5 ⇒ 前置與後置對不上 ⇒ 拒 COMMIT';
  END IF;
  v_svc_pre := COALESCE(pg_catalog.current_setting('pcm.svcsel_pre', true), '');
  v_inh_pre := COALESCE(pg_catalog.current_setting('pcm.inh_pre', true), '');

  -- ── ① 逐表:【它真的被收掉了】與【別人沒被連累】兩組, 每一張各問一次 ──────
  FOREACH v_t IN ARRAY v_tables LOOP
    v_reg := pg_catalog.to_regclass('public.' || v_t);
    IF v_reg IS NULL THEN
      RAISE EXCEPTION '後置閘①[%]:public.% 在交易中途不見了 ⇒ 拒 COMMIT', v_t, v_t;
    END IF;

    -- 【收掉了 · 格1】acl 那一列不見了
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
       WHERE c.oid = v_reg
         AND a.grantee = pg_catalog.to_regrole('pcm_readonly')
         AND a.privilege_type = 'SELECT') THEN
      RAISE EXCEPTION '後置閘①-a[%]:REVOKE 跑完了, 而 pcm_readonly 對 % 的 SELECT 【還在 acl 裡】⇒ 拒 COMMIT', v_t, v_t;
    END IF;

    -- 【收掉了 · 格2】🔴 **acl 那一列不見了 ≠ 它讀不到了**(R1 C1 的後半)。
    --   這一格問的是【有效權限】—— `has_table_privilege` 會把**角色繼承與 PUBLIC 授權**
    --   一起算進去 ⇒ 它問的東西**原理上**比上一格那把 acl 尺寬。
    --
    -- 🔴🔴 **而今天它【不可能紅】—— 這句是 2026-09-18 夜補的更正, 舊字面在下面。**
    --   ⛔ ~~「它正是上一格那把 acl 尺看不見的那一半。兩把尺方向相反, 兩格都要。」~~
    --   🔬 **窮舉 `has_table_privilege` 對一個非 superuser 的角色會回 true 的全部來源**:
    --     ① 它自己的直接授權          ⇒ **格1 剛剛證過沒有**
    --     ② 它所屬角色的授權(繼承)  ⇒ **前置閘② 證過 `pcm_readonly` 不是任何角色的成員(0 筆)**
    --     ③ `PUBLIC` 的授權            ⇒ **前置閘④-e 逐表證過是 0 條**
    --     ④ `rolsuper`                  ⇒ 實查 `pcm_readonly` `rolsuper = f`
    --     ⑤ 欄級授權                    ⇒ 表級 `has_table_privilege` 本來就不看它;且前置④-d 證過 0
    --   ⇒ 📌 **在前置那幾道閘都過的世界裡, 格2 是【格1 的必然結果】, 不是一個獨立的量測。**
    --
    -- 🎯 **為什麼要把這句寫出來**(2026-09-18 夜, 窗A 同夜撞到同一族):
    --   窗A 追後台 cookie 那道牆, 前兩輪結論「好票與壞票失敗長得一模一樣」**是假的** ——
    --   因為**兩臂拿的是同一張已過期 32 小時的票**。
    --   📌 **一個對照組, 兩臂其實是同一個東西 ⇒ 它不可能分得出東西,**
    --     **而它印出來的樣子跟「真的相同」一模一樣。**
    --   ⇒ 🛑 我原本那句「兩把尺方向相反」正是這個形狀:**聽起來像兩格, 今天只有一格。**
    --
    -- ✅ **那它為什麼留著 —— 它是 tripwire, 不是證明**(與下面【沒連累·格1】同族):
    --   上面 ①⑥ 那五條路只要**有一條**被放寬(前置閘② 或 ④-e 被刪 / 被繞過 /
    --   哪天有人給 `pcm_readonly` 加了角色成員或對這五張開 PUBLIC), **這一格就是第一個叫的。**
    --   🛑 **所以刪它之前先讀前置閘② 與 ④-e —— 它守的是那兩道閘失效的那一天。**
    --   ⚠️ 射程(R4 Q2):它答的是**表級權限**, 不是「讀不讀得到列」(五張 relrowsecurity 都是 t)。
    --      🟢 而判準沒失效:本片同一交易**只動 ACL、沒動 RLS / policy**
    --      ⇒ RLS 造成的讀不到在前後是**常數**, 前後差只可能來自那五句 REVOKE。
    IF pg_catalog.has_table_privilege('pcm_readonly', v_reg, 'SELECT') THEN
      RAISE EXCEPTION '後置閘①-b[%]:acl 裡那一列不見了, 而 pcm_readonly 【仍然讀得到】% ⇒ 它從別的地方拿到了權限(角色繼承 / PUBLIC 授權)⇒ 本片的「收掉了」會是一筆假紀錄 ⇒ 拒 COMMIT', v_t, v_t;
    END IF;

    -- 【沒連累 · 格1】service_role 的 SELECT 條數與貼前相同
    --   🛑 **這一格是 tripwire 不是證明**(R1 C2, 留著):
    --     `REVOKE … FROM pcm_readonly` 在語意上**碰不到** grantee = service_role 的 aclitem
    --     ⇒ 它在今天這個世界裡**恆綠**。真正擋得住的是前置閘④-c。
    --     留著是為了萬一哪天 REVOKE 的語意或授權形狀變了, 這裡會是第一個叫的。
    SELECT count(*) INTO n_svc_now
      FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE c.oid = v_reg
       AND a.grantee = pg_catalog.to_regrole('service_role')
       AND a.privilege_type = 'SELECT';
    n_svc_pre := NULLIF(pg_catalog.split_part(
      (SELECT x FROM unnest(pg_catalog.string_to_array(v_svc_pre, ',')) x
        WHERE pg_catalog.split_part(x, '|', 1) = v_t), '|', 2), '')::int;
    IF n_svc_pre IS NULL THEN
      RAISE EXCEPTION '後置閘①-c[%]:前置沒有替 % 存下 service_role 的基準 ⇒ 兩邊的名單對不上 ⇒ 拒 COMMIT', v_t, v_t;
    END IF;
    IF n_svc_now <> n_svc_pre THEN
      RAISE EXCEPTION '後置閘①-c[%]:service_role 對 % 的 SELECT 從 % 變成 % ⇒ 本片誤傷了它 ⇒ 拒 COMMIT', v_t, v_t, n_svc_pre, n_svc_now;
    END IF;

    -- 【沒連累 · 格2】欄級仍然是 0 —— 本片沒有順手毀掉任何欄級授權。
    --   🔵 前置閘④-d 已經證過「貼前是 0」⇒ 這一格在今天是恆綠的 tripwire,
    --      它守的是「哪天前置那道閘被放寬 / 被繞過」。**恆綠 ≠ 沒用**(見檔頭同族那句)。
    SELECT count(*) INTO n_col
      FROM pg_catalog.pg_attribute at
     WHERE at.attrelid = v_reg AND at.attnum > 0 AND NOT at.attisdropped
       AND at.attacl IS NOT NULL;
    IF n_col <> 0 THEN
      RAISE EXCEPTION '後置閘①-d[%]:% 貼完之後冒出 % 個帶欄級授權的欄 ⇒ 貼前是 0 ⇒ 拒 COMMIT', v_t, v_t, n_col;
    END IF;

    n_checked := n_checked + 1;
  END LOOP;

  IF n_checked <> 5 THEN
    RAISE EXCEPTION '後置閘①:逐表閘只跑了 % 圈(應該是 5)⇒ 有表被跳過 ⇒ 拒 COMMIT', n_checked;
  END IF;

  -- ── ② 【沒連累 · 格3】over-revoke:名單裡有沒有人【失去】讀取權 ───────────
  --   🛑 **已知且可接受的恆綠 —— 有【兩種】(R4 C1, 留著)**:
  --     ① 名單是空的 ⇒ 零圈 ⇒ 必定通過(而「零圈」與「全部都還是 t」是同一個綠;
  --        名單空不空, 前置的 NOTICE 印了)。
  --     ② 🔴 名單裡只剩 owner / superuser ⇒ `has_table_privilege` 對他們**恆 t** ⇒ 不可能紅。
  --        而 2026-09-18 夜實查的名單就是五組 `postgres|<表>`(owner)
  --        ⇒ 📌 **這道閘在【今天的正式庫上】就是恆綠的。**
  --   🟢 **而「恆綠」不等於「沒用」**:名單是**貼板當下現撈**的(前置④-f), 不是吃那個讀數
  --     ⇒ 正式庫哪天漂了、真的多出一個會失去讀取權的角色, **這道閘會活過來、會擋。**
  --     ⇒ 🛑 **它是「在假設成立時恆綠」, 不是「永遠沒用」—— 下一輪不要把它當死碼刪掉。**
  IF v_inh_pre <> '' THEN
    FOREACH v_pair IN ARRAY pg_catalog.string_to_array(v_inh_pre, ',') LOOP
      v_role := pg_catalog.split_part(v_pair, '|', 1);
      v_tbl  := pg_catalog.split_part(v_pair, '|', 2);
      IF v_role = '' OR v_tbl = '' THEN
        RAISE EXCEPTION '後置閘②:名單這一筆解不開(%)⇒ 前置存的字串壞了 ⇒ 拒 COMMIT', v_pair;
      END IF;
      -- 🔴 R1 N5:名字含逗號 / 直線的世界裡 `split_part` **不會 raise, 會靜靜切錯** ⇒ fail-open。
      --    這兩行把它變成會叫的:切出來的東西必須真的是一個角色、一張表。
      --
      -- 🔴🔴 **R2 MF1:`quote_ident` 不可以拿掉 —— 沒有它, 這道守衛是【新迴歸】。**
      --   `to_regrole(text)` 把字串當 **SQL 識別字**剖析 ⇒ **會折大小寫**;
      --   而 `v_role` 是前置④-f 從 `pg_roles.rolname` **原樣**撈出來的(需要引號的名字撈出來不帶引號)。
      --   🔬 實燒(PG 17.10, R2 提出、我獨立複現):`CREATE ROLE "Audit_Bot" IN ROLE pcm_readonly;`
      --     `to_regrole('Audit_Bot')`              ⇒ **NULL**
      --     `to_regrole(quote_ident('Audit_Bot'))` ⇒ `"Audit_Bot"`
      --     `has_table_privilege('Audit_Bot', …)`  ⇒ **t**  ← 下一行真正要用的那支**本來就好好的**
      --       (它吃 `name` 型別, **不剖析識別字**)
      --   ⇒ 🔴 沒有 `quote_ident` 時, 整支跑下去會在**後置**炸成:
      --     「名單解出來的『Audit_Bot』不是一個角色 ⇒ 編碼被切錯了(角色名含逗號或直線?)」
      --     —— **而那個名字裡逗號跟直線兩樣都沒有。**
      --   🛑 **它比 R1 MF1 更糟:那一格只是【訊息沒提 grantor】, 這一格是【訊息指著錯的原因】。**
      --   ⚪ 今天 prod 的直接成員只有 `postgres`(小寫)⇒ **今天不會炸**;
      --     而這道閘存在的唯一理由就是「哪天 prod 漂了多出一個成員」—— **那一天它會用假理由把整發擋死。**
      IF pg_catalog.to_regrole(pg_catalog.quote_ident(v_role)) IS NULL THEN
        RAISE EXCEPTION '後置閘②:名單解出來的「%」不是一個角色(原字串 %)⇒ 編碼被切錯了(角色名含逗號或直線?)⇒ 拒 COMMIT', v_role, v_pair;
      END IF;
      -- ⚪ 表名同理加 `quote_ident`(今天那五張都是小寫 ⇒ 不可達, 而**兩邊要用同一把尺**,
      --    否則下一個人會以為角色那邊的 `quote_ident` 是手滑加上去的)。
      IF pg_catalog.to_regclass(pg_catalog.quote_ident('public') || '.' || pg_catalog.quote_ident(v_tbl)) IS NULL THEN
        RAISE EXCEPTION '後置閘②:名單解出來的「public.%」不是一張表(原字串 %)⇒ 編碼被切錯了 ⇒ 拒 COMMIT', v_tbl, v_pair;
      END IF;
      IF NOT pg_catalog.has_table_privilege(v_role, 'public.' || v_tbl, 'SELECT') THEN
        RAISE EXCEPTION '後置閘②:角色 % 在本片動手之前讀得到 public.%, 而現在【讀不到了】⇒ 這是 over-revoke, 本片沒打算做這件事 ⇒ 拒 COMMIT(名單:%)', v_role, v_tbl, v_inh_pre;
      END IF;
      n_pairs := n_pairs + 1;
    END LOOP;
    RAISE NOTICE '✅ 後置閘②:名單裡 %〈角色|表〉貼完之後都還讀得到(沒有人失去讀取權)。', n_pairs;
  ELSE
    RAISE NOTICE '🔵 後置閘②:名單是空的 ⇒ 這一發【零圈】, 它沒有守到任何東西(已知恆綠, 見上面註解)。';
  END IF;

  -- ── ③ 【沒連累 · 格4】🔴 **獨立分母:全域剛好少 5 條, 不多不少** ──────────
  --   📌 這是唯一一道**跨五張**的閘, 而它抓的是每一張自己的閘看不到的兩種壞法:
  --     · 迴圈漏跑了一張(它的 REVOKE 卻照跑)⇒ 少的不是 5
  --     · REVOKE 誤傷了名單以外的表(例如有人改動作那五句)⇒ 少的超過 5
  --   🛑 **這不是「共用一組閘」** —— 五張各自的閘在上面 ①, 這一格是**額外**的分母。
  --   🔴 **而它是【全域】的 ⇒ 它有一個前提:貼的當下沒有別人在動 `pcm_readonly` 的授權**(R1 N4)。
  --     · 別人同時收掉別張 ⇒ **假紅**(擋下來, 吵但安全)
  --     · 🔴 別人同時**給**一張、而本片少收一張 ⇒ **兩邊抵銷 ⇒ 假綠**
  --     ⇒ 📌 **所以「本片要單獨貼、貼之前先確認沒有別人正在貼」那句話, 不只是為了 ACL 摘要 ——**
  --       **它是【這道閘】成立的條件。** 檔頭把它掛在 digest 的理由上, 這裡補掛一次。
  --       🛑 **一個依賴要寫在【被依賴的那一端】—— 寫在依賴方, 刪的人看不到。**
  SELECT count(*) INTO n_aclrows_now
    FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
   WHERE a.grantee = pg_catalog.to_regrole('pcm_readonly') AND a.privilege_type = 'SELECT';
  IF n_aclrows_now <> n_aclrows_pre - 5 THEN
    RAISE EXCEPTION '後置閘③:pcm_readonly 的表級 SELECT 從 % 變成 %(應該是 %)⇒ 本片動到的不是剛好那五張 ⇒ 拒 COMMIT', n_aclrows_pre, n_aclrows_now, n_aclrows_pre - 5;
  END IF;

  -- ── ④ ⚪ 把五張貼完之後的 relacl 原樣印出來 —— 讓貼的人肉眼對一次 ─────────
  --   期望:每一張都剩 `{postgres=arwdDxtm/postgres,service_role=r/postgres}`(順序可能不同)。
  FOREACH v_t IN ARRAY v_tables LOOP
    SELECT COALESCE(c.relacl::text, '<NULL>') INTO v_acl
      FROM pg_catalog.pg_class c WHERE c.oid = pg_catalog.to_regclass('public.' || v_t);
    RAISE NOTICE '🔬 % 貼完之後的 relacl 逐字:%', v_t, v_acl;
  END LOOP;

  -- ═══ 🔴🔴 本片到底有幾格, 而今天【真的可能紅】的有幾格(R1 MF2 整段重寫)═══
  --
  -- ⛔ ~~舊字面:「逐表 6 格 × 5 張 + 跨表 2 格」, 並宣稱「今天真的會叫的只有兩格」。~~
  -- 🔴 **那段話【少算、也多算】, 兩個方向都錯。舊字面留著不刪。**
  --
  -- ① 🔬 **先把數字量出來, 不要用估的**
  --   尺 = `grep -nE "RAISE[[:space:]]+EXCEPT"` 之後逐句歸類迴圈內外。
  --   🔴🔴 **而這把尺的寫法本身是被一道閘教出來的 —— 寫下來**:
  --     我原本在這行註解裡直接寫了那兩個關鍵字相鄰的字面,
  --     而 `scripts/migration-static-checks.sh:945` 的規則⑥ 是拿
  --     `\bRAISE\s+(?:EXCEPTION|WARNING|NOTICE)\b` **掃整份檔案的原文, 連註解一起掃**
  --     ⇒ 🔴 **它把我那句「我是怎麼數的」的註解, 當成一句真的例外句來驗佔位符**,
  --       印出 `881:佔位0/參數1` 而擋下整發 commit。
  --   🎯 ⇒ 和 `scripts/readonly-prod-sql.sh` 檔頭記的是**同一族**:
  --     **一句「你要去量」的提醒, 自己變成了被量到的東西。**
  --   ✅ 改的是**我的字**, 不是那道閘 —— 它抱怨的那一種錯(42601)真的會讓整支貼板失敗。
  --      🛑 而它的射程要知道:**它不區分註解與碼** ⇒ 任何人在 .sql 註解裡提到那兩個字,
  --      都可能被它抱怨。**我不動那道閘**(今晚的邊界), 只把它的形狀記在這裡。
  --      原始碼裡的例外句 = **27 句**
  --      跑起來會被評估的次數        = **79 格**
  --        前置 迴圈外 6 · 前置 迴圈內 7 × 5 張 = 35
  --        後置 迴圈外 8 · 後置 迴圈內 6 × 5 張 = 30
  --   🛑 舊字面漏掉的至少有:後置⓪ 那兩道(讀不到前置的值 / 張數對不上)、
  --      後置迴圈後的 `n_checked <> 5`、①-c 的「前置沒替它存基準」、後置② 解名單那幾道。
  --   📌 **而「一格」本來就有兩種數法(原始碼一句 vs 跑起來一次)** ——
  --      **兩個數都寫出來, 並寫明尺是什麼**, 比挑一個「對的」數字誠實。
  --
  -- ② 🔴🔴 **而更重要的更正是這個:在本檔自己宣稱的那個世界裡, 【沒有任何一格會叫】。**
  --   舊字面說「🟢 會叫:① acl 那一列還在 ② 全域分母不是少 5」—— **那兩格也是恆綠的**:
  --     · 【收掉了·格1】唯一能紅的世界, 就是 R1 MF1 那個**多 grantor** 的世界
  --       —— 而那個世界**現在已經被前置④-b 擋在門外了**(本輪新加)。
  --     · 【沒連累·格4】只在「有人改了那五句 REVOKE 的字面」或
  --       「貼的當下別人正在動 `pcm_readonly` 的授權」時才紅。
  --
  -- ✅ **照實的版本**:
  --   **在 2026-09-18 夜那份讀數仍然成立、而且本檔單獨貼的前提下, 79 格【一格都不會叫】。**
  --   **每一格守的都是同一件事:那份讀數【從量完到貼下去之間漂掉了】。**
  --
  -- 🎯 ③ **所以真正的操作結論不是「有兩格在守」, 而是這一句**:
  --   🛑🛑 **貼之前, 現場重量一次那五張的 `relacl`(含 `grantor`)與全域那 81。**
  --     閘擋得住「漂掉了」, 而它**擋不住「我們是拿三天前的讀數在推理」** ——
  --     那一半只有**重量**能解決。
  --
  -- 🔵 **而恆綠不等於沒用, 這句連著讀**(檔頭同族那段):
  --   這 79 格守的是「前提哪天翻掉」—— **一道守著前提翻掉的閘, 在前提還成立時本來就該恆綠。**
  --   🔴 **而 R1 那一輪實際燒紅過其中 10 格**(9 發負對照 + 多 grantor 那一發)
  --   ⇒ 📌 **「今天不會叫」與「它永遠不會叫」是兩件事, 而前者是燒出來的, 不是推出來的。**
  RAISE NOTICE '✅ 後置閘全過(79 格中屬於後置的 38 格)。🛑 而在 09-18 夜那份讀數仍成立的前提下, 這 79 格【本來就一格都不會叫】—— 它們守的是「讀數從量完到貼下去之間漂掉了」。⇒ **貼之前請現場重量一次五張的 relacl(含 grantor)與全域那 81。**';
  RAISE NOTICE '✅ 全域表級 SELECT % ⇒ %(剛好少 5)', n_aclrows_pre, n_aclrows_now;
  RAISE NOTICE '⏳ 待驗:20260828080000:155-156 那句 —— 請跑 bash scripts/rls-service-role-select-verify.sh(現在要看五張, 不是一張)';
END $post$;

COMMIT;
