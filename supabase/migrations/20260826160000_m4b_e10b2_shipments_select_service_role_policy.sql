-- ============================================================================
-- 🟢 **2026-08-27 · 那個「apply 不進正式庫」的 BLOCKER【已折】。而下面整段留著, 不要刪。**
--    留它的理由:**它記的是「怎麼發現的」, 而那比「發現了什麼」更難重建。**
--
-- 起 pgcluster 各給一個全新 DB, 只換【角色拓撲】一個變數, 其餘一字未動:
--   玩具拓撲(先前那批世界用的:只有 service_role / anon / authenticated)   ⇒ rc=0 PASS
--   真實 Supabase 拓撲(多一個 `authenticator LOGIN NOINHERIT`
--     + `GRANT service_role TO authenticator`)                              ⇒ 🔴 rc=3 段A 擋下
--   它印的逐字:`這些角色拿得到 service_role 的東西:[authenticator (USAGE=false SET=true ...)]`
--
-- 🔴 **片2(`20260826150000`)與片3a(`20260826160000`)兩支都是。** 片2 已 commit 且已過
--    codex 7 條 + cf 6 條兩輪 —— **而那兩輪都沒有人拿真實拓撲餵過它。**
--
-- ⚠️ 而段A 把 authenticator 分類進「其餘 = 🔴 真的多一個看得到的人」—— **那個分類是錯的**:
--    `USAGE=false` 表示它【不繼承】service_role 的權限, 必須明確 `SET ROLE` 才變成 service_role,
--    而那正是 PostgREST 的標準路徑。它不是多出來的一個讀者, 它是平台自己的門。
--
-- ⚠️ **射程(這一格不要讀寬)**:我證到的是「**repo 內兩支 probe 腳本這樣建模**」——
--    `docs/probes/order-list-select-probe.sh:60` / `docs/probes/customer-list-select-probe.sh:53`
--    數法 `grep -rn "GRANT service_role TO authenticator" --include='*.sh' --include='*.sql' .` ⇒ 2;負對照 ⇒ 0。
--    🔴 **「兩支腳本這樣寫」與「正式庫真的這樣」是兩個宣稱, 而我只有前者。**
--    正式庫那一格由 cf 出唯讀探針、**Sean 貼 SQL Editor 跑**才算數。未跑之前這裡標【高度可能, 未證實】。
--
-- ── 🔴 這一格是【第五輪】才抓到的, 而前四輪都是誠實的 ────────────────────────
--   R0 codex 3 條 / R0 cf 0 條 / R1 code-reviewer 2 條 / R2 codex 5 條
--   ⇒ 四輪都在問「**這個斷言寫對了嗎**」。R3(換模型 Fable, 被明確叫去質疑框架而非內容)
--     問的是「**它會在哪個世界跑**」—— 一問就中。
--   📌 **那 16 個世界全綠, 而它們共用同一個玩具拓撲 ⇒ 世界【數量】增加不會發現這件事,**
--      **它們是同一份假設的 16 個副本。**
--
-- ── ✅ Sean 2026-08-27 拍【乙】—— 逐字:「還是把它們撈出來【印在畫面上】」──────────
--   段A 的判準拆成兩半, 而**兩半的意思不一樣**:
--     · `USAGE=true`(會自動繼承)  ⇒ 政策真的多給了他, 他不用做任何動作就吃得到 ⇒ 🔴 **擋**
--     · `USAGE=false AND SET=true`(只能明確 SET ROLE 切過去)⇒ 他切過去就是 service_role 本人,
--       今天就已經做得到 service_role 做得到的每一件事 ⇒ 🟡 **RAISE NOTICE 印出名單, 放行**
--   🔴 **而「不擋」那句話有時態, 這一格是 cf 的 code-reviewer 2026-08-27 實跑抓到的**:
--     它量到 —— 目標角色 **NOBYPASSRLS** 時, 一個 SET-only 的 LOGIN 角色 SET ROLE 過去讀 RLS 表:
--     無政策 ⇒ **0 列**;有 `TO service_role` 政策 ⇒ **3 列**。而帶 BYPASSRLS 時有無政策都是 2 列。
--     ⇒ **「本片對它們零增量」只在 service_role 仍持 BYPASSRLS 時成立;Q15 之後翻面** ——
--       那時本片【就是】它們讀得到這張表的理由。
--     ⚠️ 而那**不是本閘的漏洞, 是 `SET ROLE` 的定義**:
--       **無法只給 service_role 而不給能變成它的人。** 唯一的替代是「不給 service_role」, 那等於本片不做。
--     ⇒ 所以 NOTICE 的文字**帶著時態寫**, 不寫成一句永遠成立的話。
--   ⚠️ **接受的代價明寫**:惡意的 NOINHERIT 成員不會被本閘擋, 只會被印出來。
--     **那條線的防禦不在這裡** —— 在「誰能建角色 / 誰能 GRANT service_role」那一層(grantor 欄看得到)。
--     📌 **本閘問的是「這條政策有沒有多給人東西」, 不是「有沒有壞人」。兩件事要兩道防線。**
--
-- ── 折完之後實跑:7 個世界 × 2 支檔, **7/7 與期望值逐格相符**(比對是腳本做的)────
--     世界                              片3a            片2
--     ① 玩具(零成員)                  rc=0 NOTICE 0   rc=0 NOTICE 0
--     ② SET-only 一個(authenticator)   rc=0 NOTICE 2   rc=0 NOTICE 1   ← 放行 + 印名單
--     ③ 🔴 有人【自動繼承】(sneak)     rc=3 段A 擋下   rc=3 段A 擋下   ← 真的該擋的還是擋
--     ④ 惡意 SET-only(evil NOINHERIT)  rc=0 NOTICE 2   rc=0 NOTICE 1   ← 代價, 而它看得見
--     ⑤ NOBYPASSRLS 且非 owner          rc=3 段A 擋下   rc=3 段A 擋下   ← 前提斷言(片2 本次新增)
--     ⑥ NOBYPASSRLS 但是 owner          rc=3 段C ⑦0    rc=0            ← 片3a 宣稱較強所以閘較多
--     ⑦ 🔴 **照正式庫量到的五角色形狀** rc=0 NOTICE 2   rc=0 NOTICE 1
--        NOTICE 名單逐字 `[authenticator, cli_login_postgres, supabase_storage_admin]`
--        而 `postgres`(rolbypassrls)與 `supabase_admin`(rolsuper)**被正確排除** ⇒ 與正式庫區 2 對得上
--   🔴 **世界⑦ 是照量到的形狀重建的, 不是照「像不像」** —— 先前那個只放了 `authenticator` 一個,
--     而正式庫是三個。**「夠像了」正是 R3 抓到的那個病, 這次不再犯。**
--   ⚠️ 而造世界⑦ 的時候我的 harness 清理迴圈掛了一次:它寫 `WHERE NOT rolsuper`
--     ⇒ **清不掉 superuser** ⇒ 上一輪的 `supabase_admin` 留著, 下一輪 `CREATE ROLE` 直接 already exists。
--     📌 **清理工具排除掉的那一類, 正好是下一個世界需要重建的那一類。**
-- ============================================================================
-- 🟡 **本片狀態:五輪審查的 findings 全折(codex ×2 / cf / code-reviewer ×2 / Fable),
--    而【最新這一輪(段A 判準改動)的 codex 那一關還沒跑】。**
--    ~~原句「還沒有過第二輪審查」~~ 作廢 —— 它寫於 2026-08-27 清晨, 而同一天又跑了三輪。
--    📌 **一句描述「跑到第幾輪」的狀態句, 每跑一輪就過期一次, 而它自己不會知道。**
--
-- 時序(不要壓成一句):
--   2026-08-26  8d 寫完 ⇒ codex 判 FAIL 3 條 ⇒ Sean 收工 ⇒ 帶著未折的 findings 進版控(`04c9fb5a`)
--   2026-08-27  下手窗 de 折完 3 條 + 2 nit, 並造出 codex 指的那三個世界實跑
-- 🔴 **所以「不要 apply」那句話已經不是現在的狀態, 而【可以 apply】也還不是。**
--    差的是複審那一輪 —— 折 findings 的人不驗自己的產出。
--
-- ── 已折的 3 條(codex 2026-08-26 的字面在下面, 我沒有轉述;修法與證據是我補的)──
--  M1 段C 的 RESTRICTIVE 檢查漏掉「service_role 繼承其他角色」
--     反例:`GRANT rls_guard TO service_role;`
--           `CREATE POLICY x ON public.shipments AS RESTRICTIVE FOR SELECT TO rls_guard USING (false);`
--     ⇒ 那條會套到 service_role, 而原版只比 `roles` 裡有沒有【字面】service_role/public
--     ⇒ `n_restr = 0` ⇒ **整片 PASS, 而實際 SELECT 回零列。**
--     ⚠️ 段A 查的是**反方向**(誰繼承 service_role), 也抓不到。
--     ✅ **已折**:段C ⑥ 改用 `pg_has_role('service_role', <政策角色>, 'USAGE')` 展開成員關係。
--        並在段C 開頭補了**那個方向自己的正負對照** —— 段A 那兩個對照保證不了這一把。
--
--  M2 「apply 當下不擴權」沒有被證明, 而且構造得出反例
--     ① apply 前 service_role 已被改成 NOBYPASSRLS ② 兩表零 permissive policy ⇒ 它讀不到列
--     ③ 段A 不檢查 service_role 自己還有沒有 BYPASSRLS ⇒ 通過
--     ④ 段B 建 USING(true) ⇒ **它立刻從零列變成全部列**
--     ⇒ 那**可能**正是本片要恢復的能力, **而它仍然是「apply 當下擴權」。**
--     ✅ **已折**:段A 新增 `rolbypassrls = true` 的前提斷言(fail-closed)。
--        🔴 **選的是「斷言前提」不是「改窄宣稱」** —— 理由:改窄宣稱只是把話說小,
--        而那句話在 Q15 拿掉 BYPASSRLS 之後**仍然會被讀成不擴權**。斷言會擋下來讓人知情地決定。
--        ⚠️ **代價寫明(兩段, 2026-08-27 code-reviewer F5 補了第二段)**:
--          ① **還沒送出去時**:Q15 落地之後這一格會擋住本片, 那時要連同宣稱一起改寫成「恢復讀取」再送。
--          ② 🔴 **已經 apply 過之後**:Q15 落地後, 任何【重放】這支檔的場景(重建庫 / preview branch /
--             還原後重放)都會炸在段A、斷掉整條鏈。原本只寫了 ① ⇒ 那等於假設它永遠不會被重放。
--          射程(reviewer 當場量的):`.github/workflows` 底下 **零個檔**命中 "supabase"
--          ⇒ 目前沒有自動重放路徑;**preview branch 會不會重放, 沒有人驗過。**
--
--  M3 「政策面 = GRANT 面 = 實際動作面」的自證不完整
--     段C 只證了 SELECT 有效權限【存在】, 沒有證:
--       · INSERT/UPDATE/DELETE 的有效權限【不存在】
--       · `relrowsecurity` 仍為 true
--       · 實際動作面仍只有「SELECT 直接讀、寫入走 RPC」
--     反例:apply 前有人 `GRANT INSERT ON shipments TO service_role` ⇒ **本片仍完整 PASS**,
--           而「GRANT 面只有 SELECT、三者對齊」已是假話。
--     ✅ **已折**(後續兩輪審查各把它擴了一次, 現在是五格):
--        ⑦0 service_role 不是這張表的 owner(owner 天生有全部權限含轉授)
--        ⑦a SELECT 不帶 GRANT OPTION(表級 + 欄級)
--        ⑦b 表級全集扣掉 SELECT + 欄級 INSERT/UPDATE/REFERENCES 的有效權限都不存在
--        ⑦b-2 **service_role 可以 SET ROLE 過去的每一個角色**, 同樣逐個問寫入權限
--        ⑦c 兩表 `relrowsecurity` 仍為 true(RLS 沒開的話政策一條都不生效, 而上面照樣全過)
--     🔴 **第三格【證不到, 所以改成不宣稱】**:「實際動作面」是 code 層的事, SQL 問不到它。
--        ⇒ 本片在 DB 裡證的是「**政策面 = GRANT 面**」兩面, 不是三面;
--          第三面的出處是 grep 出來的 `檔案:行號`(見下方「為什麼只補 SELECT」那節), **等級不同, 分開寫。**
--
-- ── 已折的 nit ──────────────────────────────────────────────────────────────
--  N1 檔頭原寫「本片不看 USING 內容」而段C 明確驗 `qual='true'` ⇒ 字面直接矛盾。✅ 已改(見射程那節)。
--  N2 檔頭原說「五支皆 SECURITY DEFINER」而只引用 skeleton 的前兩支行號。
--     ✅ codex 實查五支最終版本**確實全部是** SECURITY DEFINER
--        (`20260807170000:83-92` / `20260807230000:294-301` / `20260808100000:177-184 :308-315 :413-419`)
--     ✅ 已把引用換成那五支最終定義(結論本來就成立, 換的是證據)。
--
-- ── 🔴 cf 那一輪【跑完了, 而它全綠】—— 這一格比「沒跑完」更該小心, 留著 ─────────
--   cf 把 8d 指派的四個方向(只補 SELECT 對不對 / trigger 與 guard 的互動 / 迴圈殘留 / 檔頭射程)
--   **全部打完, 結論 0 must-fix / 3 nit。而 codex 同一支檔判 FAIL 3 條 must-fix。**
--   cf 收工時還沒拿到那三條、不知道它們是什麼, 並自己逐字寫進 checkpoint:
--     「**接手的人:先去拿 codex 那三條, 不要從我的『0 must-fix』起跳。**」
--   📌 **因為那四個方向全綠, 而【全綠】正是最容易被下一個人讀成「過了」的形狀。**
--   ⇒ **兩輪都跑了, 而兩輪的結論相反, 且它們打的不是同一批方向。**
--     「兩輪審查都跑過」這句話是真的, 而它**不代表這支檔過了**。
--   🔴 **而 2026-08-27 的實跑證明 cf 沒有錯、codex 也沒有錯** —— 見下方新舊並排表:
--     codex 那三條的反例, **舊版全部 rc=0 靜靜通過**, 而它們**一條都不在 cf 打的那四個方向上**。
--     📌 **兩個誠實的審查者可以各自把自己那一半打完, 而合起來仍然有洞。**
--
--   ✅ 而 cf 在方向1 給的理由**比原檔頭寫的更硬**, 收下:
--      只補 SELECT 對, **不是因為「寫都走 RPC」, 是因為 GRANT 面本來就只有 SELECT**
--      (`20260805170000:277` / `20260805170200:254`)⇒ **寫入在 GRANT 層就被擋,
--      連 RLS 政策與 trigger 都碰不到。** cf 實測 `sr_nobypass` 的 INSERT/UPDATE/DELETE
--      三個都 `permission denied`。
--      ⇒ 原本的理由(走 RPC)是**應用層的**, 而這個是**資料庫層的** —— 後者不會因為有人改 code 而失效。
--
-- ── ✅ 那個「擋在所有折法前面」的版本題:**已解, 不要再拿去問 Sean** ─────────────
--   本片**段A 開頭那道** `server_version_num < 160000 THEN RAISE` 要求 PG >= 16(它用了 `pg_has_role(..., 'SET')`)。
--   ⚠️ **這裡刻意不寫行號** —— 同一支檔裡的自我引用會隨每次編輯漂掉(本次折 findings 就漂了兩次:
--     227 ⇒ 230), 而漂掉的時候**沒有任何機械訊號**。⇒ 用錨字串, 不用行號。
--   🔴 **正式庫 `server_version = 17.6`** ⇒ `server_version_num` = 170600 ≥ 160000 ⇒ **這一行通過。**
--     來源**三處**, 互相獨立(2026-08-27 當場查;~~原寫「兩處」~~, 第三處是 reviewer 補的):
--       `20260811060000_m4b_lifecycle_l5b2_2a_claim_returns_superseded_at.sql:30`
--         「**正式庫** server_version **17.6**(2026-08-11, 主視窗當場量)」
--       `docs/handoff/2026-08-12-2f-r1-fold-handover.md:46`
--         「**Sean 於正式庫 SQL Editor 親跑**, `server_version = 17.6`」
--       `supabase/.temp/postgres-version` ⇒ 檔案內容就是 `17.6.1.111`(CLI 自己寫下的, 不是人抄的)
--       📌 **前兩處是人寫進文件的, 第三處是工具寫的** ⇒ 它們不會用同一種方式一起錯。
--   ⚠️ **射程**:這是**讀來的**(2026-08-11 別人量的), 不是 2026-08-27 當場量的。
--     下限只要 16 而 Supabase 不會降 major ⇒ 判它穩;要更硬就 `SELECT current_setting('server_version_num');`
--   🔴 **順帶訂正原檔頭一句假話**:原寫本片是「**全 repo 第一支對 PG 版本設下限的 migration**」——
--     **不是。** 早 16 天的 `20260810010000_m4b_lifecycle_l5a1_supersede_charge_attempt.sql:395`
--     就有同一個 `< 160000` 的檢查;全 repo 用 `server_version_num` 的 migration 共 **5 支**,
--     🔴 **4 支早於本片**(~~原寫 3 支~~ —— b4 2026-08-27 複驗抓到:**片2 `20260826150000` 也早於本片**,
--     而我當時心裡問的是「還有誰也這樣做」, 而片2 不是「別人」)。
--     📌 **同一組的東西最容易被漏數 —— 因為數的時候問的是「還有誰」, 而它不在「誰」裡面。**
--     ⚠️ `4b0c47cc` 的 commit body 裡那句仍寫著 3 支, **那顆已推、改不了** ⇒ 以本行為準。
--     (數法:`grep -rlF "server_version_num" supabase/migrations | grep -c .` ⇒ 5)。
--     📌 **「第一支」這種話是拿來提高警覺的, 而它一旦是假的, 提高的是【錯的那一格】的警覺。**
--
-- ── 🔴 2026-08-27 實跑:七個世界 × 新舊兩版並排(本機拋棄式 PG 17.10, 每發全新 DB)──
--   🔴 **並排才證得出「是這次的修法抓到的」** —— 只跑新版的話, 每一格紅都可能本來就會紅。
--     世界                            新版(折完)        舊版(未折)
--     甲 全對(該綠)                  rc=0  PASS         rc=0  PASS
--     辛 M1 反例:繼承來的 RESTRICTIVE  rc=3  段C ⑥       🔴 rc=0  靜靜通過
--     壬 M2 反例:service_role NOBYPASSRLS rc=3 段A 擋下   🔴 rc=0  靜靜通過
--     癸 M3 反例:多一個 GRANT INSERT   rc=3  段C ⑦b      🔴 rc=0  靜靜通過
--     子 M3 反例:RLS 被關掉            rc=3  段C ⑦c      🔴 rc=0  靜靜通過
--     戊 舊世界:字面 TO service_role   rc=3  段C ⑥         rc=3  段C ⑥      ← 零退步
--     庚 舊世界:有人繼承 service_role  rc=3  段A 擋下       rc=3  段A 擋下    ← 零退步
--   ── R1(code-reviewer)擊破後補的五個世界, 同樣新舊並排 ────────────────────
--     丑 F2 反例:GRANT UPDATE(note) 欄級  rc=3  段C ⑦b     🔴 rc=0  靜靜通過
--     寅 F2 反例:GRANT TRIGGER,REFERENCES rc=3  段C ⑦b     🔴 rc=0  靜靜通過
--     卯 F2 反例:GRANT MAINTAIN           rc=3  段C ⑦b     🔴 rc=0  靜靜通過
--     辰 F1 反例:良性 GRANT + NOINHERIT   rc=0  PASS(該綠) rc=0  PASS
--     巳 F1 對照:良性 GRANT + INHERIT     rc=0  PASS(該綠) rc=0  PASS
--   ── R2(codex 第二輪)擊破後補的四個世界 ──────────────────────────────────
--     午 R2#1:SELECT WITH GRANT OPTION     rc=3  段C ⑦a     🔴 rc=0  靜靜通過
--     未 R2#2:SET-only 寫入路(INHERIT FALSE, SET TRUE) rc=3 段C ⑦b-2  🔴 rc=0  靜靜通過
--     申 R2#3:service_role 是表 owner      rc=3  段C ⑦0     🔴 rc=0  靜靜通過
--     酉 R2#3:NOBYPASSRLS 且非 owner       rc=3  段A 擋下    🔴 rc=0  靜靜通過
--   ⇒ **16 個世界 × 新舊兩版, 16/16 與期望值逐格相符**(比對是腳本做的)。
--
--   🔴 **而這一輪的中途有一發【13 個世界一起變 rc=3】** —— 我新加的查詢把資料表別名取成 `r`,
--     而段C 宣告了一個 PL/pgSQL record 變數也叫 `r` ⇒ `record "r" is not assigned yet`。
--     📌 **一個編譯期的錯讓 16 格裡 13 格變紅, 而它們紅的是【同一句話】。**
--       只看 rc 的話這一發會被讀成「修法把一堆世界弄壞了」;
--       **分得開它們的是「紅的那一格是不是我要測的那一格」, 不是 rc。**(本檔早就寫過這句, 這次是它自己救了自己)
--   🔴 **世界申的期望值是我【猜錯】的**:我預期 owner + 未 FORCE 會綠, 實跑紅在 ⑦a。
--     查下去才發現**它紅得對** —— owner 天生擁有全部權限含轉授 ⇒「GRANT 面只有 SELECT」在那個世界本來就是假的。
--     ⇒ 但 ⑦a 說的是【症狀】。補了 ⑦0 讓那一格說得出【病】(它是 owner), 而不是叫人去補 REVOKE。
--     📌 **期望值對不上時, 先問「是碼錯了還是我的期望錯了」—— 這一次是後者, 而它指出了一格缺的斷言。**
--   ⇒ **12 個世界 × 新舊兩版, 12/12 與期望值逐格相符**(比對是腳本做的, 不是我看的)。
--
--   🔴 **突變測試:證 F1 的修法是【承重的】, 不是順手改的**
--     做法:複製一份到 scratchpad, **只把那一處 `MEMBER` 退回 `USAGE`**, 真檔不動。
--       世界辰(良性 GRANT + NOINHERIT)  突變版 **rc=3 假紅** / 修好版 rc=0
--       世界巳(良性 GRANT + INHERIT)    突變版 rc=0        / 修好版 rc=0  ← 證明軸就是 NOINHERIT
--       世界辛(M1 反例)                 突變版 rc=3 段C ⑥ / 修好版 rc=3 段C ⑥ ← 修法沒換掉偵測力
--     ⚠️ **第一次做這發突變時它【沒有突變成功】而我差點採信它的輸出** ——
--       `bash -c '...'` 外層單引號被 python 裡的 `'service_role'` 提前關掉 ⇒ 送進去的字串不是我寫的那個
--       ⇒ `assert` 開了 0 次命中, **而腳本繼續跑完, 印出一張「突變版與修好版一樣」的表。**
--       📌 **一個沒突變成功的突變測試, 印出來的正好是「這個修法不重要」** —— 而那是最容易被接受的結論。
--       ⇒ 擋住它的是 `assert` 的 rc, 不是那張表。**突變測試自己也要有正對照(diff 出來看它真的變了)。**
--   ⇒ **codex 那 3 條是真的**(舊版四個反例全部放行), **而新版四個都紅、且紅在對的那一格**,
--     兩個舊世界零退步, 世界甲仍然綠(**沒有把東西全部改紅來換綠**)。
--
-- ── 🔴 地面真相(cf 的手法:不問斷言, 建一個真的角色去讀、數回幾列)───────────
--   建 `sr_nobypass`(`INHERIT service_role` 但 **NOBYPASSRLS**), fixture 兩張表各 2 列:
--     甲 × 新版   shipments=2  shipment_items=2     ← 正對照:政策真的生效
--     甲 × 舊版   shipments=2  shipment_items=2
--     🔴 辛 × 舊版 shipments=**0**  shipment_items=2  ← **migration rc=0 全綠, 而實讀零列**
--     負對照:一張 RLS 開、零政策的表 ⇒ 0(⇒ 這把尺分得開「0」與「2」, 不是恆回 0)
--   📌 **codex M1 那句「整片 PASS, 而實際 SELECT 回零列」不是推論, 是這一格量到的。**
--   ⚠️ 而 `shipment_items=2` 這一格不可省 —— 沒有它, 那個 `0` 與「這把尺對誰都回 0」長得一樣。
--
-- ── ⚠️ 效度限制(這些【沒有】被上面的實跑蓋掉)──────────────────────────────
--   · 本機 **PG 17.10** ≠ 正式庫 17.6(次版本差;`pg_has_role` / `has_table_privilege` 語意未見差異, 未逐項比對)
--   · fixture 是兩張**空殼表**, 不是真的 shipments —— 證的是斷言的判別力, 不是線上資料
--   · **沒有測 pooled 連線**;多條 permissive 政策疊加沒測
--   · 世界甲~庚 的前四個仍是**改段B 才造得出來** ⇒ 它們證「斷言有判別力」, 不證「這支檔有七種失效模式」
--   · 🔴🔴 **`service_role` 的 `rolinherit` 是【未確認】的, 而它決定上面那張表一半的答案。**
--     (2026-08-27 code-reviewer F3 量到:只把 bootstrap 的 service_role 從 INHERIT 換成 NOINHERIT、
--      其餘一字未動, 判定就翻面 —— codex M1 反例在 INHERIT 之下紅在 ⑥, 在 NOINHERIT 之下不紅;
--      而**那不是漏報**:PG 的 `check_role_for_policy()` 走 `has_privs_of_role` = USAGE 語意
--      ⇒ NOINHERIT 之下那條 RESTRICTIVE 政策本來就套不到 service_role, **不紅才是對的**。)
--     🔴 正式庫 service_role 的 `rolinherit` **全 repo 查無字面**(reviewer grep 過 supabase/migrations + docs;
--        只找到 `authenticator` / `payment_confirmer` 是 NOINHERIT)⇒ **標未確認, 不是「應該是 INHERIT」。**
--     ⇒ 那張並排表的「紅在對的那一格」**射程要收窄成:在 INHERIT 的 fixture 之下。**
--   · 🔴 **三個負對照從來沒有被構造成【該紅】過**
--     ⚠️ ~~原文寫「段A 的 pg_signal_backend」~~ **那個負對照已經不存在了**(codex R2 #4 折掉,
--     改成「不對全部角色恆真」)。b4 2026-08-27 複驗抓到這句過期;數法
--     `grep -v '^ *--' <本檔> | grep -c 'pg_signal_backend'` ⇒ **0**(只剩兩處註解提到它)。
--     📌 **一句描述「我有哪幾道檢查」的話, 在那道檢查被換掉的時候不會自己更新。**
--     ⇒ 它們是**未經雙向表演的量具**, 恆綠格的形狀。段A 的 `v_members` 正對照在 fixture 裡 v_members=0
--     ⇒ 恆等、證不到東西(檔內本來就標了, 而那張並排表沒有把這件事算進「證了什麼」)。
--   · 🔴 **競態:斷言與 COMMIT 之間有窗**(codex R2 #5, **本片選擇不修碼, 只寫明**)。
--     段C 檢查完到 COMMIT 之間, 另一個 session 若執行 `GRANT rls_guard TO service_role`
--     (而 rls_guard 有適用的 RESTRICTIVE SELECT 政策)⇒ 本片仍印 PASS 並提交, 而「RESTRICTIVE 0 條」已不成立。
--     READ COMMITTED 之下讀 catalog 不會鎖住後續的 membership 變更。
--     ⇒ **為什麼不修**:codex 給的修法是「所有 ACL 變更流程共用一把 advisory lock」——
--       **這個 repo 沒有那個約定**, 而只在本片單方面加鎖擋不住沒加鎖的那一邊(那會是一句假的安全感)。
--       ⇒ 記成已知限制, 不假裝關掉了它。本片的斷言是**交易內某一時點的快照**, 不是持續保證。
--   · 🔴 **段C 開頭那三格自檢是【有限的 sanity check】, 不是「涵蓋這把尺會壞的所有方式」**
--     (codex R2 #6)。它們只驗:直接 membership 的 MEMBER 恆等 / USAGE 模式不恆假 / USAGE 模式不恆真。
--     **不驗**兩層以上的繼承路徑、不驗 `inherit_option` 的各種組合。那幾種留在隔離測試(16 世界)裡。
--   · 🔴 **本片折完之後的審查狀態** ⇒ 見下方「審查紀錄」節。
--
-- ── ⚠️ `4b0c47cc` commit body 的兩處訂正(那顆已推、改不了 ⇒ 以本檔為準)──────
--   b4 2026-08-27 逐條拿 body 去對實物, 抓到兩句:
--   ① 「3 支早於本片」⇒ 實為 **4**(見上方版本那節)
--   ② 「R2 #4 打的是 R1 F1 折出來的負對照」⇒ **錯**。
--      `git show 04c9fb5a:<本檔> | grep -n pg_signal_backend` ⇒ `:170` **8d 的原碼就有那個負對照**,
--      不是 R1 折出來的。⇒ 那句「折 finding 會產生新 finding」的四個例子裡, **這一個舉錯了**
--      (其餘三個 b4 複驗成立)。📌 **一個舉例錯了不會讓結論垮, 而它會讓下一個人照著錯的因果去找。**
--   ③ 那條數法 `grep -cE "RAISE EXCEPTION '片3a 段C "` **印 19 不是 16** ——
--      多的三行是**沒帶格號的對照句**(它們也以同樣字串開頭)。值 16 是對的, **而那條命令數不出它**。
--      要數得出來:`grep -oE "RAISE EXCEPTION '片3a 段C [①-⑧]" <本檔> | grep -c .` ⇒ 16(我當場複驗)。
--      📌 **「值對」與「數法數得出這個值」是兩個宣稱, 而我把後者當成了前者的證據。**
--
-- ── 🔴 獨立複量(9e 複量窗, 2026-08-27, **它自己的尺、不用我的 harness**)──────────
--   結論:**9 世界 × 2 支 = 18/18**, rc 與「紅在哪一格」**全部相同**。
--   它的尺比我的硬:**每個世界一個全新叢集**(initdb→跑→stop→rm)⇒ 角色不可能跨世界殘留
--   ⇒ 我那個「清理迴圈漏掉 superuser」的坑**在它的尺上不存在**(不是「沒踩到」, 是構造上沒有那一格)。
--   它自帶對照:刪掉片2 檔尾那個 SELECT 的突變版 ⇒ 結果集 0(原檔 1);
--   世界③ 不帶 `ON_ERROR_STOP` ⇒ **rc=0 而畫面有 ERROR、尾行 ROLLBACK**(本檔早就寫過這一格, 它複現了)。
--
--   🔴 **而它訂正了我報數的兩處(值相同, 數法不準)**:
--     ① 「NOTICE 次數」我數的是 🟡 那一種。**數所有 `NOTICE:` 行的話, 每個綠世界要多 1**(段C 的 PASS)。
--        ⇒ 世界① 不是「NOTICE 0」, 是「**🟡 0、PASS 1**」。
--     ② 🔴 **「結果列 1」對片3a 是錯的** —— 片3a 是 **1 個結果集、2 列**(shipments / shipment_items 各一列);
--        片2 才是 1 列。**我的計數器數的是那行表頭出現幾次, 不是資料列有幾列。**
--        📌 **我拿「那個字串出現幾次」當「有幾列」用, 而它們在片2 恰好相等 —— 所以錯了也對得起來。**
--   ✅ 它多跑的:世界⑦b(把 cli/storage 建成間接成員而非直接 GRANT)⇒ **名單逐字相同**
--      ⇒ 這把尺**對直接/間接成員關係不敏感**, 那是好事(語意本來就該一樣)。
--      我沒跑的 ⑧/⑨ 對片3a:rc=3(⑦0 / 段A), **而兩則 🟡 都先印出來才擋** ⇒ 被擋的世界也看得到名單。
--   ⚠️ **它量不到的那一格, 照抄不改寫**:
--      「SQL Editor / `db push` 會不會吞掉 NOTICE ⇒ **我量不到**。唯一線索:探針結果檔說值是
--       『逐格抄自他貼回的結果表』⇒ **SQL Editor 顯示 SELECT 結果集有先例;NOTICE 零證據。**」
--      ⇒ 這正是本片檔尾那條**結果列**存在的理由 —— 有先例的那個載體, 才是拍板真正靠得住的地方。
--
-- ── ⚠️ 一格【已知行為, 不是 bug】:被擋的時候只看得到第一張表的 🟡 名單 ──────────
--   本片段A 是逐表迴圈 ⇒ 第一張表就 RAISE 的話, **第二張表的 🟡 NOTICE 不會印**。
--   2026-08-27 實跑世界⑨(同時有 INHERIT 成員與 SET-only 成員)⇒ 🟡 只印 `shipments` 一則, 然後擋在同一張表。
--   ⇒ 讀錯誤訊息的人**看不到 `shipment_items` 那半的名單**。
--   **不修的理由**:被擋 = 整筆回滾 = 什麼都沒 apply, 他本來就要去查;而訊息有寫是哪一張表。
--   重構迴圈(先全部算完再決定擋不擋)風險大於價值。**記下來, 不假裝它不存在。**
--   📌 而這一格是**我的期望值錯**抓到的 —— 我以為會印 2 則。**期望值對不上時先問「是碼錯還是我錯」,
--      2026-08-27 這個問題問了兩次, 兩次都是我錯, 而兩次都因此多知道一件事。**
--
-- ── 審查紀錄(誰打過、打了什麼、結論)────────────────────────────────────
--   R0 codex(2026-08-26, 8d 跑)          FAIL 3 must-fix + 2 nit  ⇒ 2026-08-27 全折
--   R0 cf  (2026-08-26, 四個指派方向)     0 must-fix / 3 nit       ⇒ 與 codex 不重疊
--   R1 code-reviewer(2026-08-27, opus, 13 個世界)  **FAIL 2 must-fix + 5 nit** ⇒ 本次全折
--      F1 段C 正對照抄 USAGE 而非 MEMBER ⇒ NOINHERIT 之下良性世界假紅
--      F2 ⑦b 四動詞列舉擋不住欄級授權與 REFERENCES/TRIGGER/MAINTAIN
--      F3/F5/F6/F7 見上文各處;F4 見段A 那段
--   R2 codex(2026-08-27, gpt-5.x, 窄化 prompt + diff 直接餵入)  **FAIL 5 must-fix + 1 nit** ⇒ 本次全折
--      #1 `has_table_privilege(SELECT)` 不區分 grant option        ⇒ 折碼:新增 ⑦a
--      #2 只算立即可用權限, 不涵蓋 SET ROLE 路徑                   ⇒ 折碼:新增 ⑦b-2(**沒有選它給的「改窄宣稱」那條**)
--      #3 段A 的 bypass 斷言會誤擋 owner / 既有政策的世界, 且訊息宣稱未查證 ⇒ 折碼:改成「證不出才擋」+ 加 owner 充分條件
--      #4 拿 `pg_signal_backend` 當負對照會永久假紅且無合法出路     ⇒ 折碼:改成「不對全部角色恆真」, 不綁固定角色
--      #5 斷言與 COMMIT 之間的競態                                  ⇒ **不修碼, 寫進效度限制**(理由在那節)
--      #6 三格自檢的宣稱過寬(nit)                                  ⇒ 改寫成「有限 sanity check」
--      ✅ codex 明說打不破的:⑥ 的謂詞與 `USAGE` 模式選擇 / v_verbs 的 PG16 相容 / 例外與 n_hit 與迴圈位置
--   R3 code-reviewer(2026-08-27, opus, 審段A 判準改動)  **FAIL 5 must-fix + 4 nit** ⇒ 全折
--      F2 NOTICE 到不到得了畫面(拍板的載體)/ F3 片2 負對照沒跟著同步 / F4 NOTICE 那句無條件斷言
--      F5 檔頭三處新產生的矛盾 / F6 片2 擋下訊息過期;nit:述詞複製四份 ⇒ 改成一次掃描兩個 FILTER
--   R4 codex(2026-08-27, cf 代跑, -s read-only, 窄化 prompt)  **FAIL 1 must-fix + 3 nit**
--      must-fix = 與 R3 的 F2 **同一條**(兩把不同的腦獨立指到同一格 ⇒ 那一格是真的)
--      三個 nit(檔頭 `USAGE OR SET` / 片2 前提斷言那段 / 片2 擋下訊息)**在它派出之後就已經折掉了**
--      ⚠️ cf 轉述 codex 時明說:「你方向 1(互斥窮盡)與 3(抄片2 漏搬)codex **沒列 finding** ——
--        是【沒找到】不是【證明沒有】, 它沒寫 OK 條目。」**照收, 不升級成背書。**
--   R5 9e 複量窗(2026-08-27, 它自己的尺)  **18/18 相同 + 訂正我報數兩處**(見上一節)
--   🔴 **五輪之後仍然沒關掉的那一格:NOTICE 在真正 apply 通道看不看得見。**
--      它不擋(本片改走結果列), 而它是**唯一一條由 Sean 本人才做得完的**。已進等待表。
--      而 2026-07-29 Sean 的紀律:**第 3 輪起要換角度換模型** —— R0/R2 是 codex, R1 是 Claude
--      ⇒ 下一輪建議換 Fable 或換一個明確不同的角度(假設審查 / 災難當天可用性 / 測試假綠)。
--   📌 **四輪審查, 四輪都抓到真 finding, 而每一輪打的都不是上一輪打的那批方向。**
--      ⇒ 「已經審過 N 輪」不是一個可以拿來放行的數字。
-- ============================================================================

-- ============================================================================
-- M-4b · 片 3a · shipments / shipment_items 補 service_role 的 SELECT 政策
--
-- ══ 這是「補那 42 張」的第二片 ═══════════════════════════════════════════════
-- Sean 2026-08-26 拍【乙】:先裝守門擋住第 43 張, 再補既有那 42 張。
--   守門  `d00c8523`  片2(email_outbox 三條)`dc6d1961`  ⇒ 本片是第三顆。
-- 本片補 2 張 ⇒ **補到 3 張, 還剩 39 張。**
--
-- ══ 為什麼這兩張是【一組】而 orders / customers 不在裡面 ═══════════════════
-- b4 2026-08-26 把 P1 那批四張放在一起, 而 2026-08-26 逐張量 GRANT 面之後, 它們裂成兩堆:
--   ✅ 本片這兩張:**GRANT 面完整寫在版控裡, 一行一行看得到**
--        `20260805170000_m4b_e10_b2_s1a1_shipments.sql:274` REVOKE ALL FROM PUBLIC, anon, authenticated, service_role
--        同檔 `:277` GRANT SELECT ON TABLE public.shipments TO service_role
--        `20260805170200_m4b_e10_b2_s1b_shipment_items.sql:253` REVOKE ALL …
--        同檔 `:254` GRANT SELECT ON TABLE public.shipment_items TO service_role
--   🔴 orders / customers:**它們的 service_role GRANT 不在任何一支 migration 裡**
--        而 `20260611120000:239` `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.orders FROM se…`
--        **證明它本來有** ⇒ 授出那一次不在版控裡 ⇒ **那正是 Q15 的母題本身。**
--        ⇒ 它們另外一片, 已派人查來源。**不要為了「一次做完四張」把它們併進來。**
--
-- ══ 為什麼只補 SELECT(這次有證據, 不是圖省事)═══════════════════════════════
-- 片2 的教訓:只補 SELECT 而 adapter 還會 insert/update ⇒ 救不了它宣稱要救的東西。
-- ⇒ 本片當場數過這兩張表的所有觸點:
--   `apps/admin/src/lib/shipping/shipment-repository.ts`
--     **寫全部走 RPC**(`:101 :123 :143 :158 :172` admin_create_shipment / add_items /
--     mark_shipped / void / unvoid, 皆 `SECURITY DEFINER` ⇒ **五支最終定義逐支**(codex 2026-08-26 實查,
--     原本只引用 skeleton 的前兩支 = N2):`20260807170000:83-92` / `20260807230000:294-301` /
--     `20260808100000:177-184 :308-315 :413-419`)
--     **讀直接 `.from()`**(`:281 :303 :427 :586`)
--   `packages/adapters/src/email/SupabaseShippedEmailContextAdapter.ts:100 :126` 只 `.from()`, 零寫入動詞
--   🔴 而 `shipment-repository.ts:180-182` **它自己就寫著這件事**, 逐字:
--      「讀**不走 RPC**:`shipments` / `shipment_items` 都有 `GRANT SELECT … TO service_role`
--        (s1a1:277 / s1b:254)⇒ 直接 SELECT。不為了對稱而多包一層沒有的 RPC。」
-- ⇒ **政策面 = GRANT 面**(這兩面本片在 DB 裡當場斷言:段C ⑦ 證 SELECT 在、⑦b 證寫入不在)
--   **+ 實際動作面**(這一面 SQL 問不到, 靠的是上面那幾個 `檔案:行號`)。
--   🔴 ~~原本這裡收尾寫「⇒ 三者對齊」~~ **刪掉了**(2026-08-27 code-reviewer F6):
--     那句話把剛拆開的三面又壓回同一個等級 —— **而拆開它們正是 M3 要求的那件事。**
--   🔴 **codex must-fix 3 的折法就在這個分界上**:原檔頭把三面寫成同一個等級的宣稱,
--     而其中兩面證得到、一面證不到。⇒ **證得到的去斷言, 證不到的標出處並說明它是 code 層的。**
--   加 INSERT/UPDATE 政策會是憑空擴權(GRANT 沒給, 政策給了 ⇒ 兩面對不齊, 而下一個人會以為 GRANT 漏了)。
--
-- ══ 今天為什麼不爆 ═════════════════════════════════════════════════════════
-- 兩張都 `ENABLE ROW LEVEL SECURITY`(`s1a1:268` / `s1b:252`)而**現有政策各為零條**
-- (數法:對每一支含 `create policy` 的 migration 問「有沒有 `on (public.)?<表>`」,
--  解析器用 `scripts/rls-service-role-policy-gate.py` 的同一組;負對照餵不存在的表名 ⇒ 零命中)。
-- ⇒ 它們今天讀得到, 靠的是 `service_role` 帶 **BYPASSRLS** —— 平台角色屬性, repo 內零行宣告。
--
-- ══ 壞掉那天畫面長怎樣(這一格決定它排在哪)═══════════════════════════════════
-- 這兩張**後台畫面在讀** ⇒ 拿掉 BYPASSRLS 那天, **出貨頁面會空掉, 員工當天就會叫。**
-- ⇒ 與片2 的 `email_outbox`(零頁在讀, 信不寄而每頁都綠)**不是同一種急**。
--   📌 b4 2026-08-26 那句:**同時被畫面用到反而是保護 —— 一個只有背景在用的表, 沒有人替它叫。**
--
-- ══ 「不擴權」這句話的【時態】(片2 兩輪審查都命中的那一格)══════════════════
-- 🔴 **對 apply 當下存在的角色不擴權;之後被授予 `service_role` 的角色, 會直接取得這兩張表的讀取。**
--    段A 只在 apply 當下量一次, 之後不會再跑、零訊號。
--    📌 **一句沒有時態的安全宣稱, 會在它不再成立的那天, 還印著同一行字。**
--
-- ══ 🔴 本片【沒有】關掉什麼 ═════════════════════════════════════════════════
--   · 補到 3 張, **還剩 39 張**。· orders / customers 不在射程(見上)。
--   · 兩張野生表(`product_fitments_effective_staging` / `_sync_log`)沒有建表 migration, 不在射程。
--   · 那 10 張金流表走 `PAYMENT_CONFIRMER_DB_URL` 不是 service_role ⇒ Q15 對它們無效。
--   · 本片**只驗自己這兩條政策的 `USING` 恰為 `true`**(段C ⑤), **不看別條政策的 `USING` 內容**
--     —— 段C ⑥ 撈到 RESTRICTIVE 也只報數、不判它的 qual。(N1 已折:原寫「本片不看 USING 內容」
--     而段C ⑤ 明確驗 `qual='true'` ⇒ 字面直接矛盾。**修的是那句話, 不是那個行為。**)
--   · 不處理 SECURITY DEFINER、只碰 `public` schema。
--
-- ══ 【第一批】七個世界(2026-08-26, 8d 造, 本機拋棄式 PostgreSQL 17.10, 每發全新 DB)══════
-- 🔴 **這一批【不涵蓋】codex 那 3 條** —— 8d 自己標過:「那三個我一個都沒造過」。
--    codex 三條的反例 = 【第二批】辛/壬/癸/子, 在檔頭「2026-08-27 實跑」那張表, 兩批要一起看。
--   世界                              rc  紅在        怎麼造出來的
--   甲 兩條政策都對                    0  —           原檔
--   乙 shipments 那條給錯角色          3  段C ④       改段B
--   丙 shipments 那條 USING (false)    3  段C ⑤       改段B
--   丁 少建 shipment_items 那條        3  段C ①       改段B
--   戊 有 RESTRICTIVE 也套到           3  段C ⑥       改前置 SQL
--   己 GRANT 被拿掉                    3  段C ⑦       改前置 SQL
--   庚 有人 INHERIT 繼承 service_role   3  段A         改前置 SQL
-- 🔴 **「怎麼造出來的」那一欄不可省**(片2 cf 的 F3):前四個要改段B 才造得出來
--    ⇒ **它們證的是「斷言有判別力」, 不是「這支檔有七種失效模式」。**
--    後三個是真的可達的。📌 一張只列「世界 ⇒ rc」的表, 讀起來像後者。
-- 🔴 **比的是【哪一格紅】, 不只是 rc** —— 片2 那一輪這一格救了三次
--    (一次語法錯讓六個「紅」全是同一個錯 / 兩次死在 COMMENT ON POLICY 沒跑到斷言)。
--    **第一批七格一次全對, 而那是因為前一片先踩過。**
-- 判別力:把段C 整段拔掉再餵該紅的世界己 ⇒ **rc=0 靜靜通過**(有段C 是 3)⇒ 段C 不是裝飾。
-- ⚠️ 效度限制:本機 17.10 ≠ 正式庫 **17.6**(2026-08-27 已查到來源, 見檔頭;~~原寫「未確認」~~)
--    · fixture 不是真表 · **沒有測 pooled 連線**
--    · 收攤已驗:pgrep 0 / 目錄與 socket 皆已刪(正對照 pgrep node ⇒ 123)
--
-- ══ rollback ═══════════════════════════════════════════════════════════════
--   DROP POLICY IF EXISTS shipment_items_select_service_role ON public.shipment_items;
--   DROP POLICY IF EXISTS shipments_select_service_role      ON public.shipments;
--   零資料異動、零欄位異動;`DROP POLICY` 一併移除它的 COMMENT。
--   ⚠️ **回滾 = 退回「靠平台特權」那個狀態, 不是退回更安全的狀態。**
--
-- ══ 🔴🔴 跑本片的斷言時一定要帶 `-v ON_ERROR_STOP=1` ═══════════════════════════
--   b4 2026-08-26 警告, 片2 當場複現:同一個該紅的世界, 不加 ⇒ **rc=0 全綠**,
--   而畫面上明明有 1 行 ERROR;加了 ⇒ rc=3。
--   📌 **psql 預設吞掉 SQL 錯誤的 rc ⇒ 看畫面的人會發現, 看 rc 的不會。**
-- ============================================================================

BEGIN;

-- 🔴 **client_min_messages —— 沒有它, 下面所有 RAISE NOTICE 可能【一個字都不會送出】。**
--    本 repo 早就撞過這一格:`docs/specs/2026-08-08-e10-b2-w7d1-ship-deadlock-and-translator-direction-plan.md:228`
--    逐字要求「連線顯式帶 `-c client_min_messages=notice`, 把 NOTICE 計數格的環境前提釘死」。
SET LOCAL client_min_messages = notice;

-- 🔴🔴 **而【伺服器有送】與【Sean 看得到】仍然是兩件事**(code-reviewer 2026-08-27 F2):
--    Supabase SQL Editor / `supabase db push` / MCP `apply_migration` 各自會不會把 NoticeResponse
--    渲染出來 —— **沒有人量過**(repo 內兩條 apply 路徑都真的被用過:
--    `docs/phase-1-backlog.md:7766` 逐字「一律走 supabase db push, 不要貼 SQL Editor」,
--    而 `supabase/APPLIED.tsv` 有備註逐字「Sean(SQL Editor 本人貼)」的列)。
--    ⚠️ **Sean 2026-08-27 拍【乙】的載體就是「印在畫面上」** ⇒ 那個前提沒被建立之前, 它是推的不是量到的。
--    ⇒ 所以本片**不只靠 NOTICE**:段A 把算出來的東西寫進下面這張暫存表, 檔尾用一個
--      **結果列** SELECT 交出來。**結果列是每一種 client 都會顯示的載體, NOTICE 不是。**
--    📌 **7 個世界全在 psql 量, 而 psql 是最會顯示 notice 的那一種 client**
--       ⇒ 我量到的是「訊息被 raise 了」, 不是「他看得到」。**那兩件事在 psql 底下印同一個結果。**
CREATE TEMP TABLE _p3a_gate_report (
  表                text,
  service_role帶BYPASSRLS boolean,
  是這張表的owner    boolean,
  FORCE_RLS         boolean,
  可SET_ROLE切過去   text
) ON COMMIT DROP;


-- ── 段A · fail-closed 角色閘 ───────────────────────────────────────────────
-- 🔴 ~~原寫「形狀與片2 同款」~~ **折完 M2 之後這句不再成立**(2026-08-27 code-reviewer F4):
--    片2 `20260826150000` 段A **沒有** `rolbypassrls` 的前提斷言。
-- ✅ **2026-08-27 更新:那題 Sean 拍了【甲】(`Q-27c`)⇒ 片2 已經補上同一道前提斷言。**
--    ~~原文:「片2 有同一個洞, 而它已經 commit 了, 本片不擅自去改片2, 已列成決策題」~~
--    **那是端出去【之前】的狀態。** 現在片2 的段A 有 `rolbypassrls` 前提斷言(與本片同一個形狀,
--    含 codex R2 #3 的訂正:寫「證不出」而不是「它一定擴權」)。
--    🔴 **這一格是 code-reviewer 2026-08-27 抓到的**:那段舊文字留著會讓下一個人
--      「照它去補一個已經存在的東西, 或以為 Sean 還沒回」。**答案回來的那一刻, 問題的敘述就過期了。**
--    📌 **兩輪審查都跑過的檔, 一樣可以有洞 —— 因為兩輪打的不是同一批方向。**(本片自己就是實例)
-- ~~判準 = `USAGE OR SET`~~ **2026-08-27 Sean 拍【乙】之後已作廢**, 逐字:「還是把它們撈出來【印在畫面上】」。
--   現行:`USAGE` ⇒ 擋;`NOT USAGE AND SET` ⇒ `RAISE NOTICE` 印名單、放行。
--   (codex 2026-08-26 原本的理由仍然成立:`MEMBER` 只代表是成員、兩件事都不保證 ⇒ MEMBER 不進判準。)
--   改的理由是量到的:正式庫三個平台角色全是 `USAGE=false SET=true` ⇒ 舊判準之下本片【永遠】apply 不進去
--   (`docs/probes/2026-08-27-production-topology-and-acl-results.md`)。
-- owner 只有在 `relforcerowsecurity=false` 時才排除得起(FORCE 之下 owner 也受 RLS 管)。
-- 正對照走真實 membership(cf 2026-08-26:`pg_has_role(自己,自己)` 恆為 true, 它什麼都證不到)。
DO $$
DECLARE
  v_extra   text;
  v_setonly text;
  v_members int;
  v_seen    int;
  t         text;
  v_owner   oid;
  v_force   boolean;
  v_bypass  boolean;
  v_sr_oid  oid;
  v_neg_yes int;
  v_roles_total int;
BEGIN
  IF current_setting('server_version_num')::int < 160000 THEN
    RAISE EXCEPTION '片3a 段A:server_version_num = % < 160000 ⇒ pg_has_role 沒有 SET 模式 ⇒ 本閘對「可否 SET ROLE」沒有判斷力, 擋下(fail-closed)', current_setting('server_version_num');
  END IF;

  SELECT count(*) INTO v_members
    FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles gr ON gr.oid = m.roleid
   WHERE gr.rolname = 'service_role';
  SELECT count(*) INTO v_seen
    FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles gr ON gr.oid = m.roleid
    JOIN pg_catalog.pg_roles mr ON mr.oid = m.member
   WHERE gr.rolname = 'service_role'
     AND pg_catalog.pg_has_role(mr.rolname, 'service_role', 'MEMBER');
  IF v_members <> v_seen THEN
    RAISE EXCEPTION '片3a 段A 正對照失敗:pg_auth_members 記 % 個 service_role 的成員, 而 pg_has_role 只認得 % 個 ⇒ 兩張表對不起來, 這把尺不可信', v_members, v_seen;
  END IF;
  -- ⚠️ v_members = 0 時上面那格恆等, 它證不到東西。而那時「枚舉回空」本來就是正確答案。

  -- 🔴 負對照:擋【恆真】。**不拿固定的內建角色當對照**(codex R2 #4:平台可能為了正當維運授予它
  --    ⇒ 那會讓本片【永久假紅】而錯誤訊息給不出合法出路)。
  --    改成問「它是不是對【全部】角色都回 true」—— 這個問法不綁任何特定角色, 而且永遠有判別力。
  --    ⚠️ 真的等於全部時, 那也是一個【該擋】的世界(service_role 的成員涵蓋全庫), 不是假紅。
  SELECT count(*) FILTER (WHERE pg_catalog.pg_has_role(r.rolname, 'service_role', 'USAGE')), count(*)
    INTO v_neg_yes, v_roles_total
    FROM pg_catalog.pg_roles r;
  IF v_roles_total = 0 OR v_neg_yes >= v_roles_total THEN
    RAISE EXCEPTION '片3a 段A 負對照失敗:pg_roles 共 % 個角色, 而「是 service_role 成員」對其中 % 個回 true ⇒ 這把尺恆真(或角色表是空的), 段A 的枚舉結果作廢', v_roles_total, v_neg_yes;
  END IF;

  -- 🔴 codex must-fix 2(2026-08-26)·「apply 當下不擴權」這句話【有前提】, 而前提要當場驗。
  SELECT r.rolbypassrls, r.oid INTO v_bypass, v_sr_oid
    FROM pg_catalog.pg_roles r WHERE r.rolname = 'service_role';
  IF v_sr_oid IS NULL THEN
    RAISE EXCEPTION '片3a 段A:pg_roles 裡沒有 service_role ⇒ 這個庫不在本片射程, 擋下(fail-closed)';
  END IF;

  FOREACH t IN ARRAY ARRAY['shipments', 'shipment_items'] LOOP
    SELECT c.relowner, c.relforcerowsecurity INTO v_owner, v_force
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = t;
    IF v_owner IS NULL THEN
      RAISE EXCEPTION '片3a 段A:找不到 public.% ⇒ 本片對這個庫沒有判斷力, 擋下', t;
    END IF;

    -- 🔴 「apply 當下不擴權」的前提斷言(codex must-fix 2 立, **codex R2 #3 訂正過措辭與位置**)。
    --    ~~第一版寫「rolbypassrls=false ⇒ 它實讀零列 ⇒ 本片會從零列變成全部列」~~ **那句話沒有被查證。**
    --    codex R2 反例:service_role 若已有另一條 `USING(true)` 的 permissive SELECT 政策,
    --    或它是這張表的 owner 而該表 **未** FORCE RLS ⇒ **它本來就讀得到全部列, 本片沒有擴權**, 而第一版照樣擋。
    --    ⇒ 改成只斷言【本片證得出來的那件事】:
    --      「不擴權」的**充分條件**有兩個, 任一成立即通過:① service_role 持有 BYPASSRLS
    --      ② service_role 是這張表的 owner 且該表未 FORCE RLS。
    --      兩個都不成立 ⇒ **本片證不出不擴權** ⇒ 擋(fail-closed), 而**不宣稱它一定擴權**。
    --    📌 **「我證不出來」與「它是假的」是兩個宣稱, 而第一版把前者印成了後者。**
    IF v_bypass IS DISTINCT FROM true
       AND NOT (v_owner = v_sr_oid AND NOT v_force) THEN
      RAISE EXCEPTION E'片3a 段A 擋下(表 %):本片【證不出】「apply 當下不擴權」。\n'
        'service_role 的 rolbypassrls = %;它是不是這張表的 owner = %;該表 FORCE ROW LEVEL SECURITY = %。\n'
        '⇒ 本片認得的兩個充分條件(持有 BYPASSRLS / 是 owner 且未 FORCE)都不成立。\n'
        '⚠️ **這【不是】說本片一定擴權** —— 若 service_role 早已透過【別條 permissive SELECT 政策】讀得到全部列,\n'
        '   那本片確實不擴權, 只是本格沒有去評估那些政策的 USING(它們可以是任意運算式, 靜態評估不了)。\n'
        '⇒ 兩條出路, 都需要人知情地決定:\n'
        '   (a) 這是 Q15 拿掉 BYPASSRLS 之後的補救 ⇒ 把檔頭宣稱改寫成「恢復讀取」再送;\n'
        '   (b) 你查證了既有政策已給全讀 ⇒ 把那個條件補進本格的充分條件再送。',
        t, v_bypass, (v_owner = v_sr_oid), v_force;
    END IF;

    -- 🔴🔴 **Sean 2026-08-27 拍【乙】** —— 逐字:「還是把它們撈出來【印在畫面上】」。
    --    ~~舊版:USAGE OR SET 一律擋~~ **那在正式庫是誤擋, 而且是【永久】誤擋。**
    --    正式庫親測(`docs/probes/2026-08-27-production-topology-and-acl-results.md`)量到三個角色
    --    `authenticator` / `cli_login_postgres` / `supabase_storage_admin` 全部是 `USAGE=false SET=true`,
    --    而三個都是 Supabase **平台自己的**角色 ⇒ **它們永遠都會在** ⇒ 舊版之下本片永遠 apply 不進去。
    --
    --    ⇒ 判準拆成兩半, 而**兩半的意思不一樣**:
    --      · `USAGE=true`(**會自動繼承**)⇒ 本片的政策**真的多給了他** ⇒ 🔴 **擋。**
    --      · `USAGE=false AND SET=true`(**只能明確 SET ROLE 切過去**)⇒ 他切過去之後**就是 service_role 本人**
    --        ⇒ 他今天就已經做得到 service_role 做得到的每一件事, **本片一條都沒有多給他** ⇒ 🟡 **印出來, 不擋。**
    --
    --    ⚠️ **這個決定接受了一個代價, 明寫不藏**:如果有人建一個【惡意的】NOINHERIT 成員,
    --      本片不會擋它, 只會把它印在 NOTICE 裡。**那條線的防禦不在這裡** ——
    --      在「誰能建角色 / 誰能 GRANT service_role」那一層(`grantor` 欄看得到, 見拓撲探針區 2)。
    --      📌 **本閘問的是「這條政策有沒有多給人東西」, 不是「有沒有壞人」。** 兩件事要用兩道防線。
    -- 🔴 **一次掃描、兩個 FILTER** —— 排除述詞只寫一次(code-reviewer 2026-08-27 nit:
    --    ~~兩次掃描各抄一份述詞~~ **沒有任何東西保證那兩份保持一致**;現在沒有 bug, 這條防的是下一次改)。
    --    · `USAGE=true`  ⇒ 政策真的多給了他(不用做任何動作就吃得到)⇒ v_extra ⇒ 擋
    --    · `NOT USAGE AND SET` ⇒ 只能明確 SET ROLE 切過去 ⇒ v_setonly ⇒ 印, 不擋(Sean 2026-08-27 拍乙)
    --    · 兩邊都不在的只有 `USAGE=f SET=f`(它拿不到任何東西)⇒ 這個分割互斥且窮盡。
    SELECT coalesce(pg_catalog.string_agg(r.rolname, ', ' ORDER BY r.rolname)
             FILTER (WHERE pg_catalog.pg_has_role(r.rolname, 'service_role', 'USAGE')), ''),
           coalesce(pg_catalog.string_agg(r.rolname, ', ' ORDER BY r.rolname)
             FILTER (WHERE NOT pg_catalog.pg_has_role(r.rolname, 'service_role', 'USAGE')
                       AND pg_catalog.pg_has_role(r.rolname, 'service_role', 'SET')), '')
      INTO v_extra, v_setonly
      FROM pg_catalog.pg_roles r
     WHERE r.rolname <> 'service_role'
       AND NOT r.rolsuper
       AND NOT r.rolbypassrls
       AND NOT (r.oid = v_owner AND NOT v_force);

    IF v_setonly <> '' THEN
      RAISE NOTICE E'片3a 段A 🟡 表 % —— 這些角色【可以 SET ROLE 成 service_role】(但不繼承):[%]\n'
        '  它們切過去之後【就是 service_role 本人】⇒ 本片給 service_role 的, 它們一樣拿得到, 不多也不少。\n'
        '  ⇒ 本片沒有給它們任何 service_role 沒有的東西 ⇒ **不擋**。\n'
        '  🔴 「本片對它們零增量」這句話【有前提】, 而前提是這一刻量到的三個值, 不是一句斷言:\n'
        '       service_role.rolbypassrls = %  · service_role 是不是這張表的 owner = %  · 該表 FORCE RLS = %\n'
        '     · rolbypassrls = true  ⇒ service_role 本來就讀得到全部列 ⇒ 本片對它們確實【零增量】。\n'
        '     · rolbypassrls = false ⇒ **零增量那句不成立** ⇒ 本片就是它們讀得到這張表的【那個理由】。\n'
        '       (Q15 拿掉 BYPASSRLS 之後是這個世界;走 owner 那條充分條件時也是。)\n'
        '     ⚠️ 那不是本閘的漏洞, 是 SET ROLE 的定義 —— **無法只給 service_role 而不給能變成它的人。**\n'
        '  🔴 名單變長【不一定】是多了一個身分 —— 也可能是某角色被拿掉 BYPASSRLS, 或某筆 membership 的\n'
        '     INHERIT 由 true 翻 false(**那是從擋列搬到本列, 它的權限其實變小了**)。\n'
        '     ⇒ 名單變了要查, 而不要預設方向。防線在「誰能建角色 / 誰能 GRANT service_role」那一層。',
        t, v_setonly, v_bypass, (v_owner = v_sr_oid), v_force;
    END IF;

    IF v_extra <> '' THEN
      RAISE EXCEPTION E'片3a 段A 擋下(表 %), 本片沒有 apply(整筆已回滾, 資料庫沒有任何改變)。\n'
        '這些角色【會自動繼承】service_role 的權限:[%]\n'
        '(該表的 FORCE ROW LEVEL SECURITY = % ⇒ 它決定 table owner 算不算在裡面)\n'
        '⇒ 本片的政策會一起套到它們, 而它們【不需要做任何動作】就吃得到 ⇒ 這是真的多給了人東西。\n'
        '⇒ 只能 SET ROLE 切過去的那一種不在這個名單裡(它們在上面的 🟡 NOTICE)。\n'
        '⇒ 逐角色分得開的查詢, 見片2 那支 migration 的段A 錯誤訊息(同一段, 把表名換掉即可)。',
        t, v_extra, v_force;
    END IF;

    -- 把段A 算出來的那份交給結果列(見檔頭那段:NOTICE 不保證到得了畫面)
    INSERT INTO _p3a_gate_report VALUES (t, v_bypass, (v_owner = v_sr_oid), v_force, v_setonly);
  END LOOP;
END $$;

-- ── 段B · 政策本體(各一條 SELECT)──────────────────────────────────────────
-- 命名對齊 `email_outbox_select_service_role`(片2)與 `customers_insert_service_role`(既有)。
CREATE POLICY shipments_select_service_role ON public.shipments
  FOR SELECT TO service_role
  USING (true);

CREATE POLICY shipment_items_select_service_role ON public.shipment_items
  FOR SELECT TO service_role
  USING (true);

COMMENT ON POLICY shipments_select_service_role ON public.shipments IS
  'M-4b 片3a(Sean 2026-08-26 拍乙):把後台對 shipments 的讀取寫成顯性政策。'
  '在此之前靠 service_role 的 BYPASSRLS —— 平台角色屬性、repo 內無法驗證。'
  '🔴 只有 SELECT 是刻意的:寫全部走 SECURITY DEFINER 的 RPC(shipment-repository.ts:101 :123 :143 :158 :172),'
  '而 GRANT 面也只有 SELECT(20260805170000:277)⇒ 政策面 = GRANT 面。加寫入政策是憑空擴權。'
  '(第三面「實際動作面」是 code 層的宣稱, SQL 證不到 ⇒ 出處在 migration 檔頭, 等級不同。)'
  '🔴 【apply 當下】不擴權, 而**那句話有前提**:service_role 此刻仍持有 BYPASSRLS(apply 時已斷言)。'
  '🔴 而它不是永久保證 —— 之後被授予 service_role 的角色會一起套到。'
  '🔴 沒有關掉同族問題:補到 3 張, 還剩 39 張。';

COMMENT ON POLICY shipment_items_select_service_role ON public.shipment_items IS
  'M-4b 片3a:與 shipments 那條同一組、同一個理由(GRANT 面 20260805170200:254 也只有 SELECT)。';

-- ── 段C · 逐條逐項驗 ────────────────────────────────────────────────────────
-- 形狀照片2(codex 2026-08-26 must-fix 5):不是問「有沒有一條 permissive SELECT」——
-- 那樣的話把 `USING (false)` 寫進去五格會全過而實讀永遠零列。⇒ 對具名政策逐項驗。
DO $$
DECLARE
  r          record;
  n_restr    int;
  n_hit      int := 0;
  v_grp      int;
  v_grp_seen int;
  v_dir_neg  boolean;
  v_w        text;
  v_verbs    text[] := ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  v_dir_yes  int;
  v_roles_total int;
  r_set      record;
  v_sr_oid_c oid;
  v_tbl_owner oid;
  expect  text[][] := ARRAY[
    ARRAY['shipments',      'shipments_select_service_role'],
    ARRAY['shipment_items', 'shipment_items_select_service_role']
  ];
  i int;
BEGIN
  -- 🔴 `MAINTAIN` 是 **PG17 新增**的權限名;PG16 以下 has_table_privilege 餵它會【報錯】不是回 false
  --    (`20260817080000:28` 早就寫過這件事)⇒ 依版本動態加, 不寫死。
  IF current_setting('server_version_num')::int >= 170000 THEN
    v_verbs := v_verbs || 'MAINTAIN'::text;
  END IF;

  SELECT pr3.oid INTO v_sr_oid_c FROM pg_catalog.pg_roles pr3 WHERE pr3.rolname = 'service_role';
  IF v_sr_oid_c IS NULL THEN
    RAISE EXCEPTION '片3a 段C:pg_roles 裡沒有 service_role ⇒ 本片對這個庫沒有判斷力, 擋下';
  END IF;

  -- 🔴 codex must-fix 1 的尺自檢 —— **這是段A 沒有的那個方向。**
  --    段A 問「誰繼承 service_role」;⑥ 要問的是反過來:「service_role 繼承了誰」——
  --    因為一條 `TO rls_guard` 的 RESTRICTIVE 政策, 只要 service_role 是 rls_guard 的成員就會套到它。
  --    📌 **兩個方向是兩把尺, 段A 那兩個對照保證不了這一把。**
  SELECT count(*) INTO v_grp
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles mr ON mr.oid = m.member
   WHERE mr.rolname = 'service_role';
  SELECT count(*) INTO v_grp_seen
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles mr ON mr.oid = m.member
    JOIN pg_catalog.pg_roles gr ON gr.oid = m.roleid
   WHERE mr.rolname = 'service_role'
     AND pg_catalog.pg_has_role('service_role', gr.rolname, 'MEMBER');
  IF v_grp <> v_grp_seen THEN
    RAISE EXCEPTION '片3a 段C 正對照失敗(⑥ 的方向, MEMBER 模式):pg_auth_members 記 service_role 屬於 % 個群組, 而 pg_has_role 只認得 % 個 ⇒ 兩張表對不起來, 這把尺不可信, ⑥ 的結果作廢', v_grp, v_grp_seen;
  END IF;
  -- 🔴 上面用 `MEMBER` 而不是 `USAGE`(2026-08-27 code-reviewer F1 擊破第一版):
  --    `USAGE` 吃 `inherit_option` ⇒ service_role 若是 **NOINHERIT**, 一個【完全良性】的
  --    `GRANT g TO service_role`(零政策)就會讓 v_grp=1 / v_grp_seen=0 ⇒ **rc=3 假紅**,
  --    而錯誤訊息還說「兩張表對不起來、這把尺不可信」—— **catalog 沒壞, 是我把恆等式寫成了非恆等式。**
  --    `MEMBER` 與 inherit 無關 ⇒ 它才是真恆等式。(段A 那格本來就是 MEMBER, 我抄過來時改成了 USAGE。)
  --    📌 **一個判準抄到另一個位置時, 它的【恆等性】不會自動跟著搬。**
  -- ⚠️ v_grp = 0 時上面那格恆等、證不到東西(與段A 同一個限制)。
  --    ⇒ 所以下面兩格都不可省, 而它們擋的是【相反的兩種壞法】:

  -- 🔴 擋【恆假】(該紅而不紅)—— ⑥ 危險的正是這個方向, 而上一版對它零控制。
  --    自比必為 true, 且**在 v_grp = 0 時仍然有判別力**。
  --    ⚠️ cf 2026-08-26 反對的是拿自比當「枚舉正確」的證據 —— 這裡不是那個用途,
  --      這裡只擋「`USAGE` 這個模式整個回不了 true」。用途不同, 效力也不同。
  IF pg_catalog.pg_has_role('service_role', 'service_role', 'USAGE') IS DISTINCT FROM true THEN
    RAISE EXCEPTION '片3a 段C 正對照失敗(⑥ 的 USAGE 模式):service_role 對自己的 USAGE 不是 true ⇒ 這個模式恆回不了 true ⇒ ⑥ 會【該紅而不紅】, 結果作廢';
  END IF;

  -- 🔴 擋【恆真】(無中生有)。同段A:不綁固定角色(codex R2 #4)。
  -- ⚠️ 別名用 `pr2` 不用 `r` —— 本 DO 區塊宣告了一個 PL/pgSQL record 變數 `r`,
  --    別名撞上它時 `r.rolname` 會被解析成【那個還沒指派的 record】⇒ `record "r" is not assigned yet`。
  --    (2026-08-27 實際踩到:16 個世界裡 13 個一起變 rc=3, 而紅的是同一句話、不是我要測的那一格。)
  SELECT count(*) FILTER (WHERE pg_catalog.pg_has_role('service_role', pr2.rolname, 'USAGE')), count(*)
    INTO v_dir_yes, v_roles_total
    FROM pg_catalog.pg_roles pr2;
  IF v_roles_total = 0 OR v_dir_yes >= v_roles_total THEN
    RAISE EXCEPTION '片3a 段C 負對照失敗(⑥ 的方向):pg_roles 共 % 個角色, 而 service_role 對其中 % 個的 USAGE 回 true ⇒ 這把尺恆真(或角色表是空的), ⑥ 的結果作廢', v_roles_total, v_dir_yes;
  END IF;

  FOR i IN 1 .. array_length(expect, 1) LOOP
    SELECT p.cmd AS cmd, p.permissive AS permissive, p.roles AS roles,
           coalesce(p.qual, '') AS qual, coalesce(p.with_check, '') AS with_check
      INTO r
      FROM pg_catalog.pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = expect[i][1]
       AND p.policyname = expect[i][2];
    IF NOT FOUND THEN
      RAISE EXCEPTION '片3a 段C ①:查不到政策 % ⇒ CREATE 成功了而 catalog 撈不到, 兩者不一致', expect[i][2];
    END IF;
    IF r.permissive <> 'PERMISSIVE' THEN
      RAISE EXCEPTION '片3a 段C ②:% 是 % 不是 PERMISSIVE ⇒ 它不給權, 只會再收緊', expect[i][2], r.permissive;
    END IF;
    IF r.cmd <> 'SELECT' THEN
      RAISE EXCEPTION '片3a 段C ③:% 的 cmd 是 % 而不是 SELECT ⇒ 哪一項不對 = FOR 子句', expect[i][2], r.cmd;
    END IF;
    IF r.roles <> ARRAY['service_role']::name[] THEN
      RAISE EXCEPTION '片3a 段C ④:% 的 roles 是 [%] 而不是恰好 {service_role} ⇒ 哪一項不對 = TO 子句',
        expect[i][2], array_to_string(r.roles, ',');
    END IF;
    IF r.qual <> 'true' THEN
      RAISE EXCEPTION '片3a 段C ⑤:% 的 USING 是 [%] 而不是 true ⇒ 政策在、角色對, 而它【看不到任何一列】',
        expect[i][2], coalesce(nullif(r.qual, ''), '(無)');
    END IF;

    -- ⑥ 有沒有 RESTRICTIVE 也套到 service_role(訊息不下結論:本片沒有檢查它們的 qual)
    -- 🔴 codex 2026-08-26 must-fix 1 已折:原版只比 p.roles 裡有沒有【字面】service_role / public。
    --    反例:`GRANT rls_guard TO service_role;`
    --          `CREATE POLICY x ON public.shipments AS RESTRICTIVE FOR SELECT TO rls_guard USING (false);`
    --    ⇒ 那條會套到 service_role, 而 p.roles = {rls_guard} 兩個字面都不是
    --    ⇒ 原版 n_restr = 0 ⇒ **整片 PASS, 而實際 SELECT 回零列。**
    -- ⇒ 改用 pg_has_role 展開成員關係, 不比字面。對照在本 DO 區塊開頭(段A 沒有那個方向)。
    SELECT count(*) INTO n_restr
      FROM pg_catalog.pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = expect[i][1]
       AND p.permissive = 'RESTRICTIVE' AND p.cmd IN ('SELECT', 'ALL')
       AND ( 'public' = ANY (p.roles)
          OR EXISTS (SELECT 1
                       FROM unnest(p.roles) AS pr(rolname)
                      WHERE pr.rolname <> 'public'
                        AND pg_catalog.pg_has_role('service_role', pr.rolname, 'USAGE')) );
    IF n_restr > 0 THEN
      RAISE EXCEPTION '片3a 段C ⑥:% 有 % 條 RESTRICTIVE 政策也套到 service_role(含【繼承來的】, 不只字面 TO service_role)⇒ 本片的 permissive 那條是對的, 而它【可能】被縮限。本片沒有檢查那幾條的 qual ⇒ 請人工看一眼',
        expect[i][1], n_restr;
    END IF;

    -- ⑦ GRANT 那一層 —— 它塌掉的長相是【報錯】不是【空的】
    -- codex 2026-08-26 must-fix 6:不用 information_schema(它依執行者的 enabled role 過濾 ⇒ 誤擋)。
    IF NOT pg_catalog.has_table_privilege('service_role', 'public.' || expect[i][1], 'SELECT') THEN
      RAISE EXCEPTION '片3a 段C ⑦:service_role 對 % 沒有 SELECT 的有效權限 ⇒ GRANT 層塌, 線上長相是【報錯】不是【空的】', expect[i][1];
    END IF;

    -- ⑦0 🔴 **service_role 是不是這張表的 owner** —— 2026-08-27 實跑撞到的:
    --     owner 天生擁有這張表的全部權限(含轉授)⇒ ⑦a 與 ⑦b 都會紅,
    --     **而它們紅的是【症狀】(有 GRANT OPTION / 有寫入權限), 不是【病】(它是 owner)。**
    --     📌 本檔自己的紀律是「比的是哪一格紅」⇒ 那就得有一格說得出真正的原因。
    SELECT c.relowner INTO v_tbl_owner
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = expect[i][1];
    IF v_tbl_owner = v_sr_oid_c THEN
      RAISE EXCEPTION '片3a 段C ⑦0:service_role 是 public.% 的 **owner** ⇒ 它天生擁有這張表的全部權限(含轉授)⇒ 檔頭「GRANT 面只有 SELECT ⇒ 政策面 = GRANT 面」在這個庫不成立, 擋下。⚠️ 這與某一次 GRANT 無關, 要改的是 owner, 不是去補 REVOKE', expect[i][1];
    END IF;

    -- ⑦a 🔴 codex R2 #1(2026-08-27):`has_table_privilege(..., 'SELECT')` **不區分 grant option**。
    --     反例:`GRANT SELECT ON public.shipments TO service_role WITH GRANT OPTION;` ⇒ 上面那格照樣 PASS,
    --     而 service_role 已經**可以把讀取轉授給別的角色** ⇒ 段A 那道「誰看得到」的守門可以被繞過。
    --     ⇒ 表級與欄級都要問一次「帶不帶 grant option」。
    IF pg_catalog.has_table_privilege('service_role', 'public.' || expect[i][1], 'SELECT WITH GRANT OPTION') THEN
      RAISE EXCEPTION '片3a 段C ⑦a:service_role 對 % 的【表級】SELECT 帶 GRANT OPTION ⇒ 它可以把讀取轉授出去, 段A 的枚舉守不住, 擋下(⑦0 已排除 owner 這個成因 ⇒ 這裡是真的有人加了 WITH GRANT OPTION)', expect[i][1];
    END IF;
    IF pg_catalog.has_any_column_privilege('service_role', 'public.' || expect[i][1], 'SELECT WITH GRANT OPTION') THEN
      RAISE EXCEPTION '片3a 段C ⑦a:service_role 對 % 的【欄級】SELECT 帶 GRANT OPTION(表級沒有 ⇒ 只查表級看不到它)⇒ 擋下', expect[i][1];
    END IF;

    -- ⑦b 🔴 codex must-fix 3 已折:⑦ 只證了 SELECT 的有效權限【存在】, 沒證寫入的【不存在】。
    --     反例:apply 前有人 `GRANT INSERT ON public.shipments TO service_role;`
    --     ⇒ 原版仍完整 PASS, 而檔頭「GRANT 面只有 SELECT ⇒ 政策面 = GRANT 面」已經是假話。
    --     has_table_privilege 算的是【有效】權限(含繼承來的), 正是這句宣稱要的那一面。
    -- 🔴 2026-08-27 code-reviewer F2 擊破了第一版:它只列四個【表級】動詞 ⇒ 兩種東西溜過去,
    --    而**兩種都讓整片 rc=0 PASS**(reviewer 在拋棄式 PG 17.10 實測):
    --      · `GRANT UPDATE (note) ON public.shipments TO service_role`(**欄級**)
    --        ⇒ has_table_privilege(UPDATE) = f, 而 has_any_column_privilege(UPDATE) = t
    --      · `GRANT TRIGGER, REFERENCES, MAINTAIN`(**表級但不在那四個裡**)
    --    📌 **列舉法本身就是這個病的根** ⇒ 改成「表級全集扣掉 SELECT」+ 有欄級變體的那三種。
    FOREACH v_w IN ARRAY v_verbs LOOP
      IF pg_catalog.has_table_privilege('service_role', 'public.' || expect[i][1], v_w) THEN
        RAISE EXCEPTION '片3a 段C ⑦b:service_role 對 % 有【表級】% 的有效權限 ⇒ GRANT 面【不是】只有 SELECT ⇒ 檔頭「政策面 = GRANT 面」那句在這個庫不成立, 擋下', expect[i][1], v_w;
      END IF;
      -- 欄級變體只存在於 SELECT / INSERT / UPDATE / REFERENCES 四種;SELECT 本來就該有 ⇒ 剩三種。
      -- (2026-08-27 本機 PG 17.10 實測:has_any_column_privilege 餵 `DELETE` ⇒ ERROR unrecognized privilege type
      --  ⇒ **不能對整個 v_verbs 無差別呼叫它**。)
      IF v_w IN ('INSERT', 'UPDATE', 'REFERENCES')
         AND pg_catalog.has_any_column_privilege('service_role', 'public.' || expect[i][1], v_w) THEN
        RAISE EXCEPTION '片3a 段C ⑦b:service_role 對 % 有【欄級】% 的有效權限(表級是 false ⇒ 只查表級看不到它)⇒ GRANT 面【不是】只有 SELECT, 擋下', expect[i][1], v_w;
      END IF;
    END LOOP;

    -- ⑦b-2 🔴 codex R2 #2(2026-08-27)· **SET ROLE 這條路**。
    --     `has_table_privilege('service_role', ...)` 算的是【立即可用】的權限(自己的 + INHERIT 來的),
    --     **不含「SET ROLE 過去之後才拿得到」的那些**。反例(codex 逐字):
    --       CREATE ROLE shipment_writer NOLOGIN;
    --       GRANT INSERT ON public.shipments TO shipment_writer;
    --       GRANT shipment_writer TO service_role WITH INHERIT FALSE, SET TRUE;
    --     ⇒ has_table_privilege(service_role, INSERT) = false ⇒ ⑦b 全過, 而 service_role
    --       `SET ROLE shipment_writer` 之後就寫得進去。
    --     📌 **「它現在拿不到」與「它拿不到」是兩個宣稱** —— 第一版量的是前者, 而檔頭寫的是後者。
    --     ⇒ 這裡不改窄宣稱, 直接把那條路也量了:枚舉 service_role 可以 SET 過去的角色, 逐個問寫入權限。
    FOR r_set IN
      SELECT rr.rolname
        FROM pg_catalog.pg_roles rr
       WHERE rr.rolname <> 'service_role'
         AND pg_catalog.pg_has_role('service_role', rr.rolname, 'SET')
    LOOP
      FOREACH v_w IN ARRAY v_verbs LOOP
        IF pg_catalog.has_table_privilege(r_set.rolname, 'public.' || expect[i][1], v_w) THEN
          RAISE EXCEPTION '片3a 段C ⑦b-2:service_role 可以 SET ROLE 到 [%], 而該角色對 % 有【表級】% 權限 ⇒ 寫入【不是】在 GRANT 層就被擋, 只是不在 service_role 自己名下, 擋下', r_set.rolname, expect[i][1], v_w;
        END IF;
        IF v_w IN ('INSERT', 'UPDATE', 'REFERENCES')
           AND pg_catalog.has_any_column_privilege(r_set.rolname, 'public.' || expect[i][1], v_w) THEN
          RAISE EXCEPTION '片3a 段C ⑦b-2:service_role 可以 SET ROLE 到 [%], 而該角色對 % 有【欄級】% 權限 ⇒ 擋下', r_set.rolname, expect[i][1], v_w;
        END IF;
      END LOOP;
    END LOOP;

    -- ⑦c 🔴 同一條 must-fix:RLS 沒開的話, 本片建的政策一條都不生效,
    --     而 ①-⑦b **每一格照樣全過** —— 政策存在 ≠ 政策生效。
    IF NOT (SELECT c.relrowsecurity
              FROM pg_catalog.pg_class c
              JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = expect[i][1]) THEN
      RAISE EXCEPTION '片3a 段C ⑦c:% 的 relrowsecurity = false ⇒ RLS 沒開, 本片建的政策一條都不生效, 而 ①-⑦b 全部照樣通過', expect[i][1];
    END IF;

    n_hit := n_hit + 1;
  END LOOP;
  IF n_hit <> 2 THEN
    RAISE EXCEPTION '片3a 段C:只驗到 % 條而不是 2 條 ⇒ 迴圈本身壞了', n_hit;
  END IF;

  -- ⑧ 尺自檢:負對照。少了這一格, 一把【接錯表、對任何東西都回空】的尺會讓上面全部「通過」。
  IF (SELECT count(*) FROM pg_catalog.pg_policies
       WHERE schemaname = 'public' AND tablename IN ('shipments', 'shipment_items')
         AND policyname = 'zzz_no_such_policy_20260826') <> 0 THEN
    RAISE EXCEPTION '片3a 段C ⑧ 負對照失敗:查一條不存在的政策名而回了非 0 ⇒ 這把尺會無中生有, 上面全部作廢';
  END IF;

  RAISE NOTICE '片3a PASS:兩條政策逐項驗過(cmd / permissive / roles 恰為 {service_role} / qual=true);RESTRICTIVE 0 條(⑥ 已展開成員關係, 不只比字面);service_role 的 SELECT 有效權限都在, 且不帶 GRANT OPTION(⑦a), 而【表級全集扣掉 SELECT】與【欄級 INSERT/UPDATE/REFERENCES】的有效權限都不在 —— service_role 自己(⑦b)與它 SET ROLE 得到的每一個角色(⑦b-2)都問過了;兩表 relrowsecurity = true(⑦c)。⚠️ 本片證的是「政策面 = GRANT 面」;「實際動作面」那一半是 code 層的宣稱, SQL 證不到, 出處見檔頭';
END $$;

-- ── 🔴 結果列(不是裝飾)—— 而「保證」這兩個字要收窄 ───────────────────────────
-- 事實分三層, 不要壓成一句:
--   ① **通訊協定層**:結果集是 query 的回傳值, 每一種 client 都得處理它;NOTICE 是旁路訊息, client 可以丟掉。
--   ② **有先例**:Sean 2026-08-27 把一整張 SELECT 結果表從 SQL Editor 貼回來過
--      (`docs/probes/2026-08-27-production-topology-and-acl-results.md` 就是那份)⇒ **那條路顯示結果集, 量到的。**
--   ③ 🔴 **NOTICE 在那條路上顯不顯示 —— 零證據。**
--      · code-reviewer 2026-08-27 判 must-fix:「拍板的載體是 NOTICE, 而沒有任何一格斷言它到得了畫面」
--      · codex 2026-08-27 同一條 must-fix:「未確認實際 apply 通道會顯示 NOTICE ⇒ 可能 rc=0 而名單無人看見」
--      · 9e 複量窗:「**我量不到**」
--      · ⚠️ 主視窗 2026-08-27 一度對 Sean 說「SQL Editor 不顯示 NOTICE」—— **那是推的, 它已當場更正。**
--        📌 **一個「未確認」被講成「不顯示」, 與被講成「顯示」一樣糟 —— 兩邊都關掉了下一個人的查證。**
--   ⇒ 所以本片**不把拍板押在 NOTICE 上**:NOTICE 照印(psql 那條路已量到會顯示), 而**同一份東西也走結果列**。
--      codex 給的修法逐字:「用含唯一字串的 sentinel 在真正 apply 通道逐一驗證;**若不可見, 改用該通道保證呈現的
--      警示或明確結果集**」⇒ 本片走的是後半, 而前半(sentinel)**已排進等待表, 要 Sean 醒來貼一次**:
--        `DO $$ BEGIN RAISE NOTICE 'de-sentinel-notice-20260827'; END $$;`
--        `SELECT 'de-sentinel-row-20260827' AS 這一列看得到嗎;`
--
--   🔴🔴 **2026-08-27 深夜:sentinel 跑了, 而它是【Sean 本人在 Supabase SQL Editor 貼的】。**
--   他貼進去的逐字:
--     `DO $$ BEGIN RAISE NOTICE 'de-sentinel-notice-20260827'; END $$;`
--     `SELECT 'de-sentinel-row-20260827' AS 這一列看得到嗎;`
--   他貼回來的逐字, **全部**:
--     | 這一列看得到嗎           |
--     | de-sentinel-row-20260827 |
--   ⇒ ✅ **結果列到得了他眼前 —— 量到的。**
--   ⇒ 🔴 **而那行 NOTICE 不在他貼回來的內容裡。**
--
--   ⚠️ **這一格的射程要寫準, 不要多講一個字**:
--     我量到的是「**他貼回來的東西裡沒有 NOTICE**」, 不是「**他螢幕上沒有 NOTICE**」。
--     那兩件事在我這端印同一個東西:**一段他複製給我的文字。**
--     ⇒ 誠實的結論:**SQL Editor 這條路上, 結果列【可複製、可轉述】而 NOTICE 至少【不在可複製的那半】。**
--       而「可複製」正是這個團隊實際使用它的方式 —— 今天整份拓撲探針結果就是這樣傳過來的。
--     ⇒ **對本片的決策而言, 這已經足夠**:拍板「印在畫面上」若只押 NOTICE, 它到不了他手上。
--
--   📌 **而這一發最該記的不是結果, 是它有多便宜**:兩行 SQL、三十秒。
--      🔴 **而在它跑之前, 這一格擋著兩支 migration, 經過了五輪審查、三個模型、九個世界。**
--      **沒有任何一輪審查能回答它 —— 因為答案不在 repo 裡, 在他的瀏覽器裡。**
--      ⇒ 判別句:**這個問題的答案住在哪裡?住在我構造得出來的世界裡, 還是住在一個我碰不到的地方?**
--        後者不要再審一輪, 要去問那個碰得到的人。
--
--   ⚠️ 順帶訂正一格:主視窗 2026-08-27 一度對 Sean 說「SQL Editor 不顯示 NOTICE」並自行撤回(標明那是推的)。
--      **這一發之後看起來它推對了** —— 而**推對了不等於量過了**。撤回仍然是對的動作:
--      📌 **一個沒有量過的斷言, 它碰巧為真的時候, 危險不會比較小 —— 只是這一次沒有人被它害到。**
-- 這張表的每一格都是**段A 當場算出來的那份**, 不是重算的 ⇒ 不會與閘的判斷漂開。
SELECT 表, service_role帶BYPASSRLS, 是這張表的owner, "force_rls" AS FORCE_RLS,
       coalesce(nullif(可SET_ROLE切過去, ''), '(無)') AS "🟡可SET_ROLE切成service_role_本片放行"
  FROM _p3a_gate_report ORDER BY 表;

COMMIT;
