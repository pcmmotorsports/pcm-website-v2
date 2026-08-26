-- ============================================================================
-- 🟡 **本片狀態:codex 那 3 條 must-fix【已折並實跑驗過】, 而它【還沒有過第二輪審查】。**
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
--     就有同一個 `< 160000` 的檢查;全 repo 用 `server_version_num` 的 migration 共 **5 支**, 3 支早於本片
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
--   · 🔴 **三個負對照(段A 的 pg_signal_backend、段C 的同名格、段C ⑧)從來沒有被構造成【該紅】過**
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
--   🔴 **R2 也是 FAIL ⇒ 這支檔【還欠一輪確認】。**
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

-- ── 段A · fail-closed 角色閘 ───────────────────────────────────────────────
-- 🔴 ~~原寫「形狀與片2 同款」~~ **折完 M2 之後這句不再成立**(2026-08-27 code-reviewer F4):
--    片2 `20260826150000` 段A **沒有** `rolbypassrls` 的前提斷言。
-- 🔴🔴 **而這是一件比字面矛盾更大的事**:如果 M2 的理由成立, **片2 有同一個洞, 而它已經 commit 了**
--    (`dc6d1961`, 且已過 codex 7 條 + cf 6 條兩輪)。
--    ⇒ **本片不擅自去改片2**(那是範圍擴張, 鐵則 8)。已列成決策題端給 Sean / 主視窗。
--    📌 **兩輪審查都跑過的檔, 一樣可以有洞 —— 因為兩輪打的不是同一批方向。**(本片自己就是實例)
-- 判準 = `USAGE OR SET`(codex 2026-08-26:`MEMBER` 只代表是成員, 兩件事都不保證 ⇒ 會誤擋)。
-- owner 只有在 `relforcerowsecurity=false` 時才排除得起(FORCE 之下 owner 也受 RLS 管)。
-- 正對照走真實 membership(cf 2026-08-26:`pg_has_role(自己,自己)` 恆為 true, 它什麼都證不到)。
DO $$
DECLARE
  v_extra   text;
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

    SELECT coalesce(pg_catalog.string_agg(
             r.rolname || ' (USAGE=' || pg_catalog.pg_has_role(r.rolname, 'service_role', 'USAGE')::text
                       || ' SET='    || pg_catalog.pg_has_role(r.rolname, 'service_role', 'SET')::text || ')',
             ', ' ORDER BY r.rolname), '')
      INTO v_extra
      FROM pg_catalog.pg_roles r
     WHERE r.rolname <> 'service_role'
       AND NOT r.rolsuper
       AND NOT r.rolbypassrls
       AND NOT (r.oid = v_owner AND NOT v_force)
       AND (pg_catalog.pg_has_role(r.rolname, 'service_role', 'USAGE')
         OR pg_catalog.pg_has_role(r.rolname, 'service_role', 'SET'));

    IF v_extra <> '' THEN
      RAISE EXCEPTION E'片3a 段A 擋下(表 %), 本片沒有 apply(整筆已回滾, 資料庫沒有任何改變)。\n'
        '這些角色拿得到 service_role 的東西:[%]\n'
        '(該表的 FORCE ROW LEVEL SECURITY = % ⇒ 它決定 table owner 算不算在裡面)\n'
        '⇒ 本片的政策會一起套到它們。這【可能】是真暴露, 也【可能】是假紅。\n'
        '⇒ rolbypassrls=true 是假紅;是該表 owner 而 FORCE=false 也是假紅。其餘 = 🔴 真的多一個看得到的人。\n'
        '⇒ 逐角色分得開的查詢, 見片2 那支 migration 的段A 錯誤訊息(同一段, 把表名換掉即可)。',
        t, v_extra, v_force;
    END IF;
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

COMMIT;
