-- 20260918060000 · M-4b · 收掉 `pcm_readonly` 在 `admin_saved_order_views` 上的 SELECT
--
-- plan:`docs/plans/2026-09-18-revoke-pcm-readonly-on-saved-order-views-plan.md`
--   🛑 **Sean 逐字答過的是【三題】, 不是「我批准這份 plan」**(R1 N6 —— 不要把它寫成後者):
--     · Q「什麼時候貼」⇒ **甲:等推 main 那一發跑完再貼**
--     · Q「要不要先跑那三發 pg_stat_statements」⇒ **甲:先跑**
--     · Q「判準第三條沒過, 貼不貼」⇒ **乙:貼**(理由與代價見下面〈判準沒過〉那節)
--   ⇒ 📌 本檔不宣稱「plan 已批」—— 只宣稱**上面那三句他答過**。
-- 前一片:`20260918050000`(把 65 條裡的 64 條唯讀授權寫進版控 —— **本表刻意不在那 64 條裡**)
--
-- ═══ 本片做什麼 ══════════════════════════════════════════════════════════════
-- **一句 REVOKE。** 收掉一條【沒人決定過、查不到誰加的】唯讀授權,
-- 把 `20260828080000` 那份「本表刻意零 GRANT」的設計修回來**一半**。
--
-- 🛑 **`service_role` 那條【不碰】,而那不是遺漏,是決定。** 見下面〈兩條破法不一樣〉。
--
-- ═══ 🔴🔴 本片【不是 no-op】—— 它真的會改變正式庫的 ACL ════════════════════
-- 前一片(050000)是 no-op(重複 GRANT 已有授權 ⇒ relacl 逐字不變)。
-- **本片不是。** 貼完之後 `admin_saved_order_views` 的 `relacl` 會**少一列**。
-- ⇒ 📌 所以本片的前置閘問的是「**那條現在還在嗎**」,後置閘問的是「**它不見了嗎**」——
--    與 050000 的方向**相反**,不要照抄那一片的閘。
--
-- ═══ 兩條破法不一樣 ═════════════════════════════════════════════════════════
-- 🔬 2026-09-18 正式庫唯讀實查,那張表的 `relacl` 逐字:
--      `{postgres=arwdDxtm/postgres,pcm_readonly=r/postgres,service_role=r/postgres}`
--    對照 `20260828080000:189-191` 記的 2026-08-28 讀數 `postgres=arwdDxtm/postgres`
--    ⇒ 設計破了,而**兩條破法不一樣**:
--
--  🔴 **`pcm_readonly=r` —— 孤兒,本片要收的就是它**
--     · repo 全庫 **零** `GRANT … admin_saved_order_views … TO pcm_readonly`
--     · 2026-09-18 實查 `pg_default_acl`:**`pcm_readonly` 不在任何一筆預設權限裡**
--       (`public` schema 的 `r` 型只有 `postgres` 與 `supabase_admin` 那兩列)
--       ⇒ **不是自動發的,是有人手動下的。**
--     · 🛑 **而【查不到】是誰、什麼時候。本檔照實寫「查不到」,不寫「沒有」。**
--
--  🟢 **`service_role=r` —— 有出處、有拍板、在版控裡 ⇒ 不碰**
--     · `20260904270000_m4b_rls_service_role_select_36.sql:231` 把本表列進那份 40 張名單
--     · `:350` 逐字 `EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', r.relname)`
--     · 帳本 `supabase/APPLIED.tsv:515` ⇒ 已貼(2026-09-05 記帳)
--     · 該檔檔頭 `:7-9` 引 **Sean 2026-09-04 `Q-RLS` 拍甲**逐字:
--         「甲 = 收 (推薦) —— 先把 43 張表的後台讀取政策補完,補完才收;現在開工」
--       `:9` 逐字:「⇒「收」= 拿掉 `service_role` 的 `BYPASSRLS`。**那是【另一支】migration, 不在本支**」
--     ⇒ 📌 **那條 GRANT 的用途,白紙黑字就是「為了之後收掉特權」。**
--       它今天零呼叫是**預期的**,不是它沒用 ⇒ **收掉它 = 把 09-04 拍甲做到一半的事推倒。**
--
-- 🎯 **而這一格是本片最該被記住的東西**:
--    **「沒出處」與「沒查到出處」是兩件事,而它們寫出來長得一模一樣。**
--    ⇒ 📌 **「查出處」不是行政手續 —— 它會【推翻題目本身】。**
--      2026-09-18 實例:原本的拍板是「兩條都收」,去查了「誰、什麼時候加的」之後**重拍**。
--
-- ═══ 🔴🔴 本片是在【判準沒過】的情況下貼的 —— Sean 知情之後推翻 ═════════════
-- plan §3-2b 訂了「可以貼」的三個條件。**貼板當下第三個沒過**:
-- ```
-- ① 尺有在記這個角色                    ✅ pcm_readonly stmt_kinds 2,723 / calls 8,607
-- ② 扣掉我們自己的探測之後 = 0           ✅ 那 3 筆全是 count(*) 探測, 沒有一句在讀內容
-- ③ dealloc = 0 且 window_len ≥ 30 天    🔴 【沒過】
--      stats_reset = 2026-09-05 18:31 UTC ⇒ window_len = 12 天 17 小時(不到 30 天)
--      dealloc     = 10 ⇒ 有 10 筆被擠掉過
-- ```
-- ⇒ 🔴 **照 plan 寫死的保守線,這裡的動作是【不貼】。而 Sean 知情之後拍【乙:貼】。**
--
-- **推翻的理由(逐字,主視窗端給他的那四條)**:
--  🛑 · **甲那條路的真相**:
--      ⛔ ~~`dealloc` **只增不減**;那時 `dealloc` 只會更大~~
--      🔴 **更正(R2 MF-B / R1 N2):那句不成立** —— `pg_stat_statements_reset()` **會把 `dealloc` 歸零**
--        (那也正是 `stats_reset` 的來源)。✅ 照實寫:**在今天的設定下它實際上不會變綠**,
--        而讓它變綠的兩條路(**調大 `pg_stat_statements.max`** / **reset 之後重等 30 天**)
--        **都沒有被評估**。窗滿 30 天要等到 **2026-10-05**,而在那之前 `dealloc` 只會更大。
--      ⇒ **甲的條件在「什麼都不改」的前提下很可能滿足不了。**
--      ⇒ 📌 **一個永遠不會變綠的閘,實際效果是「這件事再也不做」。**
--  · 那張表**今天是空的** —— 🔴 **而這句有兩個讀數,強弱不同(R2 MF-B / R1 N3)**:
--      · `pg_stat_user_tables`:`n_live_tup = 0` ⚠️ **這是估計值,不是 `count(*)`**
--        (`seq_scan = 4` / `idx_scan = 2`;⚪ 對照組 `orders` 97,869)
--      · 🎯 手上其實有真的 `count(*)` 跑過(`calls = 1` / `rows = 1`)——
--        🛑 **而那個 `rows = 1` 【不是】表有 1 列**:`count(*)` 本來就只回一列,`rows` 恆為 1,
--        **真正的那個數字 `pg_stat_statements` 不存。**
--        ⇒ 📌 **量過卻沒記下來,等於沒量**,而重跑又會再污染一次那把尺。
--      🛑 **而就算真的 0 列,它證的是【這條讀路今天沒有價值】,證不到【收掉它今天沒有代價】**:
--        壞法是 `permission denied` 不是回 0 列 ⇒ 一句 `UNION ALL` 跨 20 張表的稽核查詢會**整句失敗**,
--        跟那張表有幾列無關。
--  · ⛔ ~~收掉之後壞掉是**大聲的**(權限錯誤),**不是安靜回空**。~~
--    🔴 **更正(R2 MF-B / R1 N4):講大了。**
--      ✅ 收掉之後壞掉**會有錯誤訊息**(`permission denied`),而**有沒有人看見取決於呼叫端** ——
--        本 repo 自己的 `scripts/acl-snapshot.sh:31` 檔頭就寫著「出口 2(ENV-FAIL)**這不是**『沒差』」,
--        那一格存在正是因為**有人把錯誤讀成沒差**。
--  · 還原 = 把那條加回去,而 **re-GRANT 既有授權是真 no-op**(2026-09-18 拋棄式 PG 實測:relacl 逐字相同)。
--
-- 🔴 **代價,一起寫**:萬一真有人在用,**他明天會撞到錯誤,而不是先被通知。**
--
-- ═══ 🎯 而代價那一句要再分成兩半,因為【我原本沒分開講】════════════════════
--   ✅ **仍然成立**:【**使用者那一端**】會看到權限錯誤,不是安靜回空。
--   🔴 **不成立的是**:【**我們這一端**】會知道 —— **那半是假的。**
--     偵測手段在 R1 MF2 之後只剩**人工查 Postgres 日誌一道,而那一道沒量過**
--     (plan §5-2;`pg_stat_statements` **不記失敗的語句**,2026-09-18 **拋棄式 PG 17.10** 實測:
--      失敗 0 筆 / ⚪ 正對照成功 1 筆)。
--   ⇒ 📌 **「壞掉是大聲的」與「我們聽得到」是兩件事。**
--     而那句沒分開講的話,源頭在本檔作者,不是轉述時走樣的。
--
-- ⇒ 📌 **本檔【不】把判準改寫成「過了」。**
--    這一片以後被翻出來的時候,重點是它**知道自己沒過、還是貼了**。
--
-- ═══ 🔵 順帶更正 `20260828080000` 兩處已經不成立的字面 ════════════════════════
-- (**只在這裡指路,不改那支已貼的檔** —— 已貼 migration 的內部註解是【凍結的歷史】。)
--
-- 【一】`20260828080000:194-197` 逐字:
--    「這裡【不 GRANT 任何表權限給任何角色】,連 `service_role` 的 SELECT 都不給」
--    ⛔ ~~上面那句~~ **已被 Sean 2026-09-04 `Q-RLS` 拍甲推翻**,出處 `20260904270000:350`,
--    而那條 GRANT 是「收掉 `service_role` 的 `BYPASSRLS`」的**前置工程**。
--
-- 【二】`20260828080000:155-156` 逐字:
--    「(拿掉 BYPASSRLS ⇒ **後台**讀到空的)在本表【構造不出來】——
--      因為**今天就沒有任何一條路是靠 BYPASSRLS 讀它的**」
--    🔬 2026-09-18 實查:
--      | 角色           | rolbypassrls | 表級 SELECT      | 表上有沒有它的 policy |
--      | pcm_readonly   | t            | 有(本片要收)    | 無 |
--      | service_role   | t            | 有(09-04 給的)  | admin_saved_order_views_select_service_role |
--      那張表 `relrowsecurity = t` · policy 共 1 條(⚪ 對照組 orders 2 條 / admin_audit_log 2 條)。
--    ⏳ **【待驗】本片貼完之後那句會不會變回真。**
--      判(**是推理,不是量測**):**會**。
--        · `pcm_readonly` 收掉 GRANT ⇒ 沒有表權限 ⇒ 有 BYPASSRLS 也讀不到。
--          📌 **BYPASSRLS 繞的是 RLS,不是 GRANT。兩道串聯,收哪一道都讀不到。**
--        · `service_role` **不靠** BYPASSRLS —— 09-04 給了它一條 `TO service_role` 的 SELECT policy
--          ⇒ 拿掉 BYPASSRLS 它照樣讀得到 ⇒「拿掉 BYPASSRLS ⇒ 後台讀到空的」在本表仍然構造不出來。
--      🛑 **驗法(貼完之後由主視窗跑,不是本檔跑)**:`bash scripts/rls-service-role-select-verify.sh`
--        —— 它用 `pcm_verify_norls`(**NOBYPASSRLS**,而是 `service_role` 的成員)去讀,
--        並帶兩發突變(`USING(false)` / `RESTRICTIVE`)證明它會翻面。
--        **它仍讀得到本表 ⇒ 上面那句判斷成立;那一發跑完之前,這裡就寫【待驗】。**
--
-- 【三】🔴🔴 `20260828080000:152-153` —— **第三處, 而它是【唯一被機器讀】的那一處(R2 C-i)**
--    逐字:
--      `-- RLS-GATE-EXEMPT: admin_saved_order_views -- service_role 對本表【零表權限】(下方 REVOKE ALL 且不 GRANT),`
--      `--   它連 SELECT 都叫不動 ⇒ 補一條 service_role 的 SELECT 政策沒有任何人會用到它。`
--    ⛔ ~~上面那兩句~~ **今天都是假的**:
--      · `service_role` **2026-09-04 拿到了表級 SELECT**(`20260904270000:350`)
--      · 那條 policy **存在**,不是「沒有任何人會用到」——
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
-- ═══ 🔴🔴 貼完【一定要跑】這三句 —— 漏跑是【靜音】的(R1 MF1)══════════════
-- `pcm_acl_digest()` 的 REL 族**逐字含 `pcm_readonly`**
--   (`20260909060000:119-134`:`CROSS JOIN (VALUES ('anon'),('authenticated'),
--    ('service_role'),('payment_confirmer'),('pcm_readonly'))` × `relkind IN ('r','v','m','p')`)
-- ⇒ 📌 **本片會把 `public.admin_saved_order_views|r` × `pcm_readonly` 那一格
--      由 `S------|RLS` 翻成 `-------|RLS` ⇒ digest 必定改變。**
-- 🔴 而 `20260909060000` 檔頭〈本檔不涵蓋〉① 逐字:未批准的漂移訊號**【第三天會自己消失】**
--   (view 只取最新兩列)⇒ **訊號自己蒸發, 帳本從此顯示「沒漂移」, 而這筆真的變更永遠沒被批准過。**
--   (並且牴觸 Sean 2026-09-14 拍甲:貼完 migration 順手跑 `pcm_acl_approve_latest`, 理由寫版本號。)
-- 🛑 **順序不能反**(`approve_latest` 蓋的是 `max(taken_at)` 那一列,
--    先批准只會蓋到【貼之前】那一列, 下一發 cron 照樣是未批准漂移):
--      SELECT public.pcm_acl_digest_record();
--      SELECT public.pcm_acl_approve_latest('貼了 20260918060000:收掉 pcm_readonly 在 admin_saved_order_views 的表級 SELECT, REL 族該格由 S------ 轉 -------');
--      SELECT * FROM public.pcm_acl_drift_status;
-- ✅ 三句都跑完、而 `pcm_acl_drift_status` 回【最新這列已被批准 = true】才算貼完。
-- ⚠️ **已知限制(R2 nit 4, 出處 `20260909060000:48`)**:`pcm_acl_approve_latest` 取的是
--    `max(taken_at)` 那一列 ⇒ **多窗同夜貼板時, 你的理由字串會蓋到【別人】那一列。**
--    ⇒ 本片要單獨貼(見下面〈整支同一個 transaction〉那節), 而**貼之前先確認沒有別人正在貼**。
--
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
--     ⇒ 🔴 所以後置閘② 那句 `IF n_svc_pre IS NULL` 的診斷訊息**在同 session 的世界裡是死碼**
--       —— 已改用 `NULLIF(..., '')::int`, 兩種都接得住。
--   · **狀態上不是 fail-closed**:那個世界裡 `REVOKE` 在它自己的隱式交易裡**已經提交**,
--     沒有 COMMIT 可以拒 ⇒ 是「**做了才叫**」⇒ 善後要跑還原檔, 不是「什麼都沒發生」。
-- ⇒ ✅ 整檔貼進 SQL Editor(本 repo 的貼板方式)沒有這個問題。
--
-- 🛑 **而另一個方向也要知道(R1 C5, 出處 `20260917010000:149-150`)**:
--   本檔被**包在外層交易裡**跑時, 開頭 `BEGIN;` 只印 WARNING, 而檔尾 `COMMIT;` 會提交**外層**那個交易
--   ⇒ 本檔想要的原子性在那個模式下是假的, 而且會**順手提交同批裡別人的東西**。
--   ⇒ ✅ **本檔要單獨貼。**
--
-- ═══ 鎖 ═════════════════════════════════════════════════════════════════════
-- ⛔ ~~`REVOKE` 對目標表零筆鎖(2026-09-18 實測, **板 050000 那一輪量的**)~~
-- 🔴 **更正(R3 C2):那個引用是假的** —— 板 `20260918050000:31-42` 那一輪逐字量的是**四種動作**:
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
--    ⇒ ✅ **「`REVOKE` 對目標表零筆鎖」現在有【`pg_locks` 的直接證據】, 不再是從 GRANT 外推。**
--    🛑 **而射程要講清楚(R4 C3)**:上面量的是 **`pg_locks` 這個目錄**, 不是**行為**。
--      姊妹片 `20260918050000:36-38` 自己立過更高的標準, 逐字:
--        「**而我沒有停在「查 `pg_locks` 沒看到」** —— 那句話可能只是『我查錯地方』⇒ 行為測試」,
--      而那一輪對 **GRANT 真的跑了雙連線行為測試**(`:38-42`:一條 `BEGIN; GRANT …` 掛著,
--      另一條去讀去寫)。**這一輪對 `REVOKE` 沒有補那一發。**
--      🔵 兩個對照組(`ALTER TABLE`=AccessExclusive / `SELECT`=AccessShare)已經解掉
--        「我查錯地方」那一半 ⇒ 這比裸的「沒看到」強很多, **而結論仍比證據多一步**。
--    ⇒ ✅ **所以下面這句照實寫成推得, 不寫成行為量測**:
--      **依 `pg_locks` 證據推得 —— 不必避開客人多的時段。**(雙連線行為測試進待辦, plan §13-b。)
--
-- 🔴 **而這一發順帶翻掉了 repo 裡另一句話 —— 請讀到結論, 不要只讀到「這裡有爭議」**:
--    `20260917010000:152-153` 逐字寫「`GRANT` **會**對目標表取鎖,`lock_timeout='5s'` 期間
--    排在它後面的讀也會等」+「⚠️ **我沒有實測** PG 對 `GRANT` 取的鎖等級 ⇒ 標未確認」。
--    ⇒ 🔴 **它底下那個斷言【今天量出來是假的】**(上面 ② = 0)。
--    🛑 **而那不是它的錯, 也不表示「誠實標未實測」沒有用 —— 正好相反**:
--      **因為它誠實標了, 今天才有人敢去量它、也才量得出結論。**
--      一句寫成「實測」的假話, **沒有人會去量第二次。**
--    ⇒ 📌 **「未確認」不是欠債, 它是【下一個人可以動手的地方】。而假的「已實測」會把那個入口封起來。**
--    🛑 **本片不改那支已貼的檔**(它的註解是凍結的歷史)⇒「要不要另開一片更正它」
--      寫在 plan §12 當待決題, 由 Sean 裁。
--
-- 🎯 **而舊字面錯在【來源】不在結果**:結論(零筆鎖)碰巧是對的, 而我當時是**從 GRANT 外推的**。
--    ⇒ 📌 **一個碰巧對的結論, 下次不會再碰巧對** —— 所以照樣標紅。
-- 🔵 順帶:既然零鎖, 下面的 `SET LOCAL lock_timeout = '5s'` **不是保護, 是保險絲** ——
--    它守的是「哪天這個前提變了」, 不要把它讀成「我們已經處理好鎖的問題」。
--
-- 還原:`supabase/rollbacks/20260918060000-rollback.sql`

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ── 1. 前置閘 ───────────────────────────────────────────────────────────────
DO $pre$
DECLARE n_col int; n_col_ro int; n_svc int; n_mem int; v_inh text;
BEGIN
  -- ① 角色在
  IF pg_catalog.to_regrole('pcm_readonly') IS NULL THEN
    RAISE EXCEPTION '前置閘①:角色 pcm_readonly 不存在 ⇒ 停下(本片的前提整個不成立)';
  END IF;

  -- ② 表在
  IF pg_catalog.to_regclass('public.admin_saved_order_views') IS NULL THEN
    RAISE EXCEPTION '前置閘②:public.admin_saved_order_views 不存在 ⇒ 停下';
  END IF;

  -- ③ 🔴 那條授權【現在還在】—— 這一格是本片的前提
  --    不在 ⇒ 有人先收掉了(或本片貼過一次)⇒ **停下來看**, 不要靜靜跑完印「成功」。
  --    🛑 這裡問的是 `aclexplode(relacl)` 那一列本身,不是 `has_table_privilege`。
  --       後者在 PUBLIC 授權或角色繼承下會回 true ⇒ 在這個問題上**沒有判別力**
  --       (板 050000 的 R2 MF1 就是栽在這把尺上)。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE c.oid = 'public.admin_saved_order_views'::pg_catalog.regclass
       AND a.grantee = pg_catalog.to_regrole('pcm_readonly')
       AND a.privilege_type = 'SELECT') THEN
    RAISE EXCEPTION '前置閘③:pcm_readonly 對 admin_saved_order_views 的 SELECT 【已經不在】⇒ 本片沒有東西可收 ⇒ 停下來看是誰先動的(本片貼過一次也會走到這裡)';
  END IF;

  -- ④ 🔴 `service_role` 那條【在】, 而本片不准碰它
  --    存一份基準給後置比對 —— 後置要證明「本片沒有誤傷它」。
  -- 🔴 R1 C3:原本這裡數的是 service_role 的【任何】privilege, 而訊息說的是「那條 SELECT」
  --    ⇒ 一個「SELECT 已被收掉、而 INSERT 還在」的庫會讓 n_svc = 1 ⇒ 閘綠
  --    ⇒ 📌 **本片會在它自己宣稱要停下的狀態下照樣動手。** 已收窄成 SELECT。
  -- ⚠️ R2 nit 5:先確認角色本身在 —— 否則 `to_regrole` 回 NULL ⇒ n_svc = 0
  --    ⇒ 下面會印「20260904270000 被人動過」, 而真相是**那個角色不見了**(訊息誤導)。
  IF pg_catalog.to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION '前置閘④:角色 service_role 不存在 ⇒ 本片對「不碰它」的前提整個不成立 ⇒ 停下';
  END IF;
  SELECT count(*) INTO n_svc
    FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
   WHERE c.oid = 'public.admin_saved_order_views'::pg_catalog.regclass
     AND a.grantee = pg_catalog.to_regrole('service_role')
     AND a.privilege_type = 'SELECT';
  IF n_svc = 0 THEN
    RAISE EXCEPTION '前置閘④:service_role 對本表的【SELECT】不見了 ⇒ 那是 20260904270000 做的事被人動過 ⇒ 停下來看, 本片不在這種狀態下動手';
  END IF;
  PERFORM pg_catalog.set_config('pcm.svcacl_pre', n_svc::text, true);

  -- ⑤ 🔴 欄級:表級 REVOKE 【會連帶收掉欄級】(2026-09-18 拋棄式 PG 實測,
  --    連該角色從未有表級權限時也照收)⇒ 本表若有欄級授權, 本片會順手毀掉它而沒人會叫。
  --    🔬 2026-09-18 正式庫實查:本表 attacl = 0 列。這道閘把那個讀數變成一個會擋的條件。
  -- 🔴 R1 C6:表級 REVOKE 連帶收欄級, **只收同一個 grantee 的**
  --    ⇒ 原本數「任何 grantee 的 attacl」會在「只有 service_role 有欄級」時停下,
  --      而那時訊息說的「本片會順手毀掉它們」是**假的**。
  --    ✅ 改法:**兩個數都算**, 訊息照實分開講 —— 本片真正會毀的只有 pcm_readonly 那一種,
  --      而「冒出任何欄級授權」本身也值得停(本表 2026-09-18 實查 attacl = 0 列)。
  SELECT count(*) INTO n_col
    FROM pg_catalog.pg_attribute at
   WHERE at.attrelid = 'public.admin_saved_order_views'::pg_catalog.regclass
     AND at.attnum > 0 AND NOT at.attisdropped
     AND at.attacl IS NOT NULL;
  -- 🔴 R2 C-d:這一行原本**沒有** `privilege_type = 'SELECT'` ——
  --    📌 **那正是 C3 剛修掉的那個病, 我把它搬到了新的一行。**
  --    而且兩個數的**單位不一樣**:`n_col` 數的是【欄】, 這裡數的是【aclitem 列】
  --    ⇒ 某欄若同時有 SELECT+UPDATE, 會印出「出現 1 個, 其中 2 個是…」—— **兩個數字自相矛盾。**
  --    ✅ 收窄成「pcm_readonly 的 SELECT」, 而且**單位在訊息裡講明**。
  --    🔵 為什麼是 SELECT:表級 `REVOKE SELECT` 依 PG 語意只連帶收【同一種】權限
  --      ⇒ 真正會被本片毀掉的就是欄級的 SELECT, UPDATE 那種不會。
  SELECT count(*) INTO n_col_ro
    FROM pg_catalog.pg_attribute at, LATERAL pg_catalog.aclexplode(at.attacl) g
   WHERE at.attrelid = 'public.admin_saved_order_views'::pg_catalog.regclass
     AND at.attnum > 0 AND NOT at.attisdropped
     AND g.grantee = pg_catalog.to_regrole('pcm_readonly')
     AND g.privilege_type = 'SELECT';
  IF n_col <> 0 THEN
    RAISE EXCEPTION '前置閘⑤:本表有 % 個【欄】帶著欄級授權, 其中 % 條是 pcm_readonly 的 SELECT ⇒ 停下。本片的前提是「本表沒有欄級授權」(2026-09-18 實查 0 列)。🔴 表級 REVOKE SELECT 只連帶收【同一個 grantee 的同一種權限】⇒ 真正會被本片毀掉的就是那 % 條;其餘那些不會被毀, 但它們的出現本身就表示這張表的授權形狀變了 ⇒ 一樣停下來看。', n_col, n_col_ro, n_col_ro;
  END IF;

  -- ⑥ 🔴 R1 C1:**角色繼承會讓「收掉了」與「讀不到了」脫鉤。**
  --    `aclexplode` 答的是「acl 裡有沒有那一列」, 它答不出「它讀不讀得到」——
  --    若 `pcm_readonly` 是某個持有 SELECT 的角色的【成員】, 或本表對 PUBLIC 開著,
  --    REVOKE 之後**所有閘照樣全綠、NOTICE 照樣印「不見了」, 而它仍讀得到**
  --    ⇒ 📌 **我們會留下一筆「已收掉」的假紀錄。**
  --    🔬 2026-09-17 正式庫實查:`pcm_readonly` 不是任何角色的成員(`pg_auth_members` 0 筆)
  --      —— 而**那是一天前的一次讀數**, 本片原本把它當前提卻沒有釘住。這道閘把它變成條件。
  --    (姊妹片 `20260917010000:241` 有這道閘, 本片原本掉了。)
  SELECT count(*) INTO n_mem
    FROM pg_catalog.pg_auth_members m
   WHERE m.member = pg_catalog.to_regrole('pcm_readonly');
  IF n_mem <> 0 THEN
    RAISE EXCEPTION '前置閘⑥:pcm_readonly 是 % 個角色的【直接】成員 ⇒ 收掉它【自己】那條表級 SELECT 之後, 它可能仍然繼承得到讀取權 ⇒ 本片的「收掉了」會變成一筆假紀錄 ⇒ 停下來看(2026-09-17 實查為 0)', n_mem;
  END IF;

  -- ⑥b 🔴 R2 C-a:**另一個方向 —— 誰【繼承】pcm_readonly。**
  --    上面那一問答的是「別人的權限會不會流進 pcm_readonly」(假的「已收掉」)。
  --    這一問答的是反方向:**若有角色 X 是 pcm_readonly 的成員, X 今天靠繼承讀得到本表,
  --    而本片 REVOKE 之後【X 也讀不到了】** —— 那是**本片沒打算做的事**。
  --    🔴 而它無聲:六道前置閘全綠、後置閘①②③ 全綠(③ 問的是 pcm_readonly, 不是 X)、
  --      NOTICE 照樣印「未誤傷」⇒ 📌 **over-revoke, 而本片原本所有的尺都看不見它。**
  -- 🔴🔴 **本閘改過一次, 而【被改掉的那一版會誤擋正式庫】—— 這一格比閘本身重要。**
  --   ⛔ ~~舊版:`SELECT count(*) … WHERE m.roleid = pcm_readonly`, `n_inh <> 0` 就 RAISE。~~
  --   🔬 2026-09-18 正式庫唯讀實查:**`n_inh = 1`, 而那 1 是 `postgres`**
  --      (`grantor = supabase_admin`, `admin_option = t`);而 `postgres` **是本表的 owner**
  --      (`postgres=arwdDxtm/postgres`, acl 裡自己有一列)⇒ 它讀本表**靠的是所有權, 不是繼承**
  --      ⇒ 收掉 `pcm_readonly` 那條, **它一點都不會少**。
  --   ⇒ 🔴 **真實的 over-revoke 風險 = 0, 而舊版那道閘會在正式庫上擋下這一片, 理由是假的。**
  --   🎯 **病因**:舊版量的是「**有沒有人繼承**」, 而我要問的是「**有沒有人會因此失去讀取權**」——
  --     兩者在拋棄式 PG 上剛好一樣(那台沒人繼承), **在正式庫上不一樣。**
  --     ⇒ 📌 **同一族第二次:測試世界比真實世界【乾淨】, 所以兩個問法的差別在那裡消失。**
  --   ✅ **改後的判準:它直接問「有沒有人失去讀取權」, 不再用「有沒有人繼承」當代理。**
  --      前置只**撈名單**不擋(下面), 真正的判斷交給**後置閘⑤**(貼完再問一次)。
  -- 🔵 **為什麼只撈【直接】成員就夠 —— 證明寫在這裡, 不然下一輪一定有人再提一次(R4 C6)**:
  --   設 X 是 B 的成員、B 是 pcm_readonly 的直接成員。X 會因本片失去讀取權的前提,
  --   是它**所有**路徑都經過 pcm_readonly 那條 GRANT;而那條路上的 **B 今天必定也是 `t`**
  --   (所以 B 一定在名單裡), 且 **B 也必定會一起失去**(B 若另有來源, X 透過 B 也保得住)
  --   ⇒ 📌 **抓到 B 就等於抓到 X** ⇒ 「只撈直接成員」在這個問題上是**完備的, 不是窄化**。
  --
  -- 🛑 **名單存【角色名】不存 OID —— 這不是隨手寫的, 不要「順手優化」掉(R4 N1)**:
  --   `has_table_privilege` 的 **oid 版對不存在的 OID 回 NULL 而【不 raise】**
  --   ⇒ 交易中途有人 `DROP ROLE`, `IF NOT …` 不成立 ⇒ **fail-open, 靜靜放行**。
  --   **name 版會 ERROR ⇒ fail-closed, 整筆回滾。**
  --   ⇒ 📌 **一個沒寫理由的正確選擇, 下一個人會把它「優化」掉。**
  -- ⚠️ 已知不可達:角色名若含逗號(`CREATE ROLE "a,b"` 合法)會打爛下面的逗號串。
  --   本 repo 的角色集合(anon / authenticated / service_role / payment_confirmer /
  --   pcm_readonly / postgres / supabase_*)都沒有逗號 ⇒ 構造不出來, 記著就好。
  SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) INTO v_inh
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles r ON r.oid = m.member
   WHERE m.roleid = pg_catalog.to_regrole('pcm_readonly')
     AND pg_catalog.has_table_privilege(r.oid, 'public.admin_saved_order_views', 'SELECT');
  PERFORM pg_catalog.set_config('pcm.inh_pre', COALESCE(v_inh, ''), true);
  IF v_inh IS NULL THEN
    RAISE NOTICE '🔵 前置閘⑥b:沒有任何【pcm_readonly 的直接成員】今天讀得到本表 ⇒ 後置閘⑤ 的名單是空的。';
  ELSE
    RAISE NOTICE '🔵 前置閘⑥b:這些角色是 pcm_readonly 的【直接成員】而且今天讀得到本表 ⇒ %  (貼完後置閘⑤ 會逐一再問一次)', v_inh;
  END IF;

  RAISE NOTICE '✅ 前置閘全過:角色在 · 表在 · 要收的那條在 · service_role 的 % 條 SELECT 沒被動過 · 零欄級授權 · pcm_readonly 不是任何角色的直接成員 · over-revoke 名單已存(交後置閘⑤)', n_svc;
END $pre$;

-- ── 2. 動作 ─────────────────────────────────────────────────────────────────
-- 🔴 就這一句。`service_role` 不碰,`postgres`(owner)不碰。
REVOKE SELECT ON TABLE public.admin_saved_order_views FROM pcm_readonly;

-- ── 3. 後置斷言 ─────────────────────────────────────────────────────────────
DO $post$
DECLARE n_svc_now int; n_svc_pre int; v_acl text; v_inh_pre text; v_one text;
BEGIN
  -- ① 🎯 那條【真的不見了】—— 本片唯一要做的事
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
     WHERE c.oid = 'public.admin_saved_order_views'::pg_catalog.regclass
       AND a.grantee = pg_catalog.to_regrole('pcm_readonly')
       AND a.privilege_type = 'SELECT') THEN
    RAISE EXCEPTION '後置閘①:REVOKE 跑完了, 而 pcm_readonly 的 SELECT 【還在 acl 裡】⇒ 拒 COMMIT';
  END IF;

  -- ② 🔵 `service_role` 一條都沒少。
  --    🛑 **R1 C2:這一格【不是證明,是 tripwire】。**
  --      `REVOKE SELECT … FROM pcm_readonly` 在語意上**碰不到** grantee = service_role 的 aclitem
  --      ⇒ 它在今天這個世界裡**恆綠**。唯一會動到它的情況(service_role 那條由 pcm_readonly 轉授)
  --      在預設 RESTRICT 下會**先 ERROR**, 根本走不到這裡。
  --    ⇒ 📌 **它沒紅【不構成證據】。** 真正擋得住的是前置閘④(49 格測到的也是那一道)。
  --
  -- 🛑🛑 **刪我之前先看後置閘⑤(R4 C2)** —— 本閘看起來只是 tripwire, 而它今天在替⑤ 擋一件事:
  --   ⑤ **分不出「名單空」與「GUC 根本沒被寫進去」** —— 前置存的是 `COALESCE(v_inh, '')`,
  --   後置讀的是 `NULLIF(…, '')` ⇒ **兩種世界編碼成同一個空** ⇒ 都走「零圈」那條路。
  --   而「GUC 沒被寫進去」= **前置整段沒跑**(例如被剝掉 BEGIN/COMMIT 逐句 autocommit)。
  --   🔵 今天擋得住, 是因為**本閘**下面那句 `n_svc_pre IS NULL ⇒ RAISE` 先叫了。
  --   ⇒ 🔴 **所以本閘被刪掉 / 被「精簡」掉的那一天, ⑤ 會在「前置根本沒跑」的世界裡
  --      靜靜印出「名單是空的 ⇒ 零圈」, 而沒有任何東西會叫。**
  --   ⇒ 📌 **一個依賴要寫在【被依賴的那一端】, 不是只寫在依賴方 —— 寫在依賴方, 刪的人看不到。**
  --      留著它, 是為了萬一哪天 REVOKE 的語意或授權形狀變了, 這裡會是第一個叫的。
  SELECT count(*) INTO n_svc_now
    FROM pg_catalog.pg_class c, LATERAL pg_catalog.aclexplode(c.relacl) a
   WHERE c.oid = 'public.admin_saved_order_views'::pg_catalog.regclass
     AND a.grantee = pg_catalog.to_regrole('service_role')
     AND a.privilege_type = 'SELECT';
  -- 🔴 R1 C4:交易結束後同一個 session 讀到的是**空字串**不是 NULL(2026-09-18 實測),
  --    而 `''::int` 會直接 ERROR ⇒ 下面那句 `IS NULL` 的診斷訊息會變成死碼。
  --    `NULLIF(..., '')` 把兩種世界都接住, 讓診斷訊息真的印得出來。
  n_svc_pre := NULLIF(pg_catalog.current_setting('pcm.svcacl_pre', true), '')::int;
  IF n_svc_pre IS NULL THEN
    RAISE EXCEPTION '後置閘②:讀不到前置存的 service_role 基準 ⇒ 本檔沒有跑在同一個 transaction 裡 ⇒ 拒 COMMIT';
  END IF;
  IF n_svc_now <> n_svc_pre THEN
    RAISE EXCEPTION '後置閘②:service_role 的授權從 % 變成 % ⇒ 本片誤傷了它 ⇒ 拒 COMMIT', n_svc_pre, n_svc_now;
  END IF;

  -- ③ 🔴 R1 C1 的後半:**acl 那一列不見了 ≠ 它讀不到了。**
  --    這一格問的是【有效權限】—— 同一個交易裡看得到更新後的 ACL,
  --    而 `has_table_privilege` 會把**角色繼承與 PUBLIC 授權**一起算進去。
  --    ⇒ 📌 它正是後置閘① 那把 acl 尺**看不見**的那一半。兩把尺方向相反, 這裡要的就是它。
  IF pg_catalog.has_table_privilege('pcm_readonly', 'public.admin_saved_order_views', 'SELECT') THEN
    RAISE EXCEPTION '後置閘③:acl 裡那一列不見了, 而 pcm_readonly 【仍然讀得到】本表 ⇒ 它從別的地方拿到了權限(角色繼承 / PUBLIC 授權)⇒ 本片的「收掉了」會是一筆假紀錄 ⇒ 拒 COMMIT';
  END IF;

  -- 🔵 **這裡沒有「④」, 而那不是筆誤(R4 MF2)**:加入下面這道 over-revoke 閘時,
  --   原本的 ④ 被推成 ⑤, 舊號沒有補回來。**不要去找一道不存在的後置閘④。**
  --   📌 而真正要記的是那個病:**編號與實體脫鉤** ——
  --     本區塊有 ①②③⑤⑥ 五格, 而**會擋的只有 ①②③⑤ 四道**(⑥ 只把 relacl 印出來, 零斷言)。
  --     **一個把「印出來的」與「會擋的」算成同一種的數字, 本身就是這一片一直在抓的那個病。**
  --
  -- ⑤ 🔴🔴 **over-revoke:名單裡有沒有人【失去】讀取權**(R3 之後改成量損失, Sean 2026-09-18 拍甲)
  --    前置⑥b 存的是「本片動手之前讀得到本表的 pcm_readonly 直接成員」。
  --    這裡對每一個再問一次 —— 有任何一個從 t 變 f ⇒ 那是**本片沒打算做的事** ⇒ 拒 COMMIT。
  --    🔵 `postgres`(owner)前後都是 t ⇒ **不會誤擋**, 那正是舊版栽的地方。
  --    🛑 **已知且可接受的恆綠 —— 有【兩種】, 我原本只寫了第一種(R4 C1)**:
  --      ① **名單是空的** ⇒ 下面的迴圈跑**零圈** ⇒ 必定通過。
  --        📌 **「零圈」與「全部都還是 t」在結果上是同一個綠**(名單空不空, 前置⑥b 的 NOTICE 印了)。
  --      ② 🔴 **名單裡只剩 owner / superuser** ⇒ `has_table_privilege` 對他們**恆 `t`**
  --        ⇒ 那幾圈**不可能紅**。而 2026-09-18 正式庫實查的名單就是 `{postgres}`(owner)
  --        ⇒ 📌 **這道閘在【今天的正式庫上】就是恆綠的。**
  --    🟢 **而「恆綠」不等於「沒用」, 這一句請連著讀**:
  --      名單是**貼板當下現撈**的(前置⑥b), **不是吃 2026-09-18 那個讀數**
  --      ⇒ 正式庫哪天漂了、真的多出一個會失去讀取權的角色, **這道閘會活過來、會擋。**
  --      ⇒ 🛑 **它是「在假設成立時恆綠」, 不是「永遠沒用」—— 下一輪不要把它當死碼刪掉。**
  --      🔵 同族:下面 `SET LOCAL lock_timeout` 那個「保險絲」。
  --        📌 **一道守著「前提哪天翻掉」的閘, 在前提還成立的時候本來就該是恆綠的** ——
  --          那跟本檔抓過的那些「結構上恆綠」不同族:那些是**永遠不可能叫**, 這個是**現在不該叫**。
  --    ⚠️ **而下面那句 NOTICE 的措辭要照射程讀(R4 Q2)**:`has_table_privilege` 答的是
  --      **表級權限**, 不是「讀不讀得到列」(本表 `relrowsecurity = t`)。
  --      🟢 而判準沒失效:**本片同一交易只動 ACL、沒動 RLS / policy**
  --      ⇒ RLS 造成的讀不到在前後是**常數**, 前後差只可能來自那一句 REVOKE。
  --      🔵 另一個方向(只有欄級授權而無表級)進不了名單, 而那個世界已被**前置閘⑤**擋在門外
  --        ⇒ not-present-by-construction, 有出處。
  v_inh_pre := NULLIF(pg_catalog.current_setting('pcm.inh_pre', true), '');
  IF v_inh_pre IS NOT NULL THEN
    FOREACH v_one IN ARRAY pg_catalog.string_to_array(v_inh_pre, ',') LOOP
      IF NOT pg_catalog.has_table_privilege(v_one, 'public.admin_saved_order_views', 'SELECT') THEN
        RAISE EXCEPTION '後置閘⑤:角色 % 在本片動手之前讀得到本表, 而現在【讀不到了】⇒ 這是 over-revoke, 本片沒打算做這件事 ⇒ 拒 COMMIT(名單:%)', v_one, v_inh_pre;
      END IF;
    END LOOP;
    RAISE NOTICE '✅ 後置閘⑤:名單裡 % 個角色貼完之後都還讀得到本表(沒有人失去讀取權)。', pg_catalog.array_length(pg_catalog.string_to_array(v_inh_pre, ','), 1);
  ELSE
    RAISE NOTICE '🔵 後置閘⑤:名單是空的 ⇒ 這一發【零圈】, 它沒有守到任何東西(已知恆綠, 見上面註解)。';
  END IF;

  -- ⑥ ⚪ 把貼完之後的 relacl 原樣印出來 —— 讓貼的人肉眼對一次
  --    (期望:`{postgres=arwdDxtm/postgres,service_role=r/postgres}`)
  SELECT COALESCE(c.relacl::text, '<NULL>') INTO v_acl
    FROM pg_catalog.pg_class c
   WHERE c.oid = 'public.admin_saved_order_views'::pg_catalog.regclass;

  RAISE NOTICE '✅ 後置閘:pcm_readonly 那一列不見了 · service_role 仍是 % 條(未誤傷)', n_svc_now;
  RAISE NOTICE '🔬 貼完之後的 relacl 逐字:%', v_acl;
  RAISE NOTICE '⏳ 待驗:20260828080000:155-156 那句 —— 請跑 bash scripts/rls-service-role-select-verify.sh';
END $post$;

COMMIT;
