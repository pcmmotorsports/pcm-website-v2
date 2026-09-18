-- 20260918030000_m4b_home_banner_orphaned_mail_draft_guard.sql
-- M-4b · 窗 B(後台, worktree pcm-ops)· 版本號由主視窗 pcm-website-v2-71 指定
-- plan: docs/plans/2026-09-18-home-banner-orphaned-mail-draft-plan.md
--
-- ══ ✅ Sean 2026-09-18 拍【甲+】, 而他是【知情】的 ═══════════════════════════
-- 逐字:「甲+ 不刪那一列,改成就地清空內容(推薦,窗B 跟我都建議)」
-- 🔴 **他拍板時看得到那句代價** —— 端上去的題目裡逐字帶著:
--    「⚠️ 寄件者與收信時間清不掉(欄位 NOT NULL), 會留著」
-- ⇒ 📌 **「他拍了甲+」與「他拍板時知不知道代價」是兩件事, 而動手的人需要後者。**
--
-- ══ 病:一張【信件來的】草稿, 放過 90 天會變成【看起來像手動建的】 ═════════
-- 三步, 每一步都是設計好的, 錯在它們串起來:
--   ① `supplier_inbound_emails_purge_expired()` 90 天清一次信
--   ② FK `home_banners_source_email_id_fkey` 是 **ON DELETE SET NULL**
--      ⇒ 大圖的 `source_email_id` 被連帶清空(`20260916150000:545` 逐字「不寫稽核、不動 updated_at」)
--   ③ **兩道閘同時失效** —— 它們都以「那一欄非空」為前提:
--      A 表上 CHECK `home_banners_mail_published_needs_match`(`20260916180000:68`)
--      B `admin_home_banner_publish` 函式內(`20260916180000:241`)
--   ⇒ 員工勾個授權就發得上首頁, **而全程沒有人做錯事**。
--
-- 🛑 **而那個 `source_email_id IS NULL` 就放行的分支【不是 bug】** ——
--    `20260916180000:14` 逐字:「**手動新增的大圖不受「要配到商品」這條管**」
--    (Sean 自己建的季節性大圖本來就沒有來源信)。
--    ⇒ 📌 **病不在「沒來源就放行」, 病在【一張本來是信件來的圖, 會被系統改成看起來不是】。**
--    ⇒ 🔴 **拿掉那個分支 = Sean 的季節大圖全部發不出去。** 本片一個字都不碰它。
--
-- 🔬 **病是【複現過】的, 不是推論**(2026-09-18 拋棄式 PG 17.10, fixture 的舊 prosrc md5
--    與正式庫實查逐字相同 `dc395ba506b330616a03fb4e43de0e6a`):
--      清理前 ⇒ B 閘「擋:這張還沒配到商品」· A 閘算出 f(會被擋)
--      跑舊版清理 ⇒ 刪 2 封
--      清理後 ⇒ 來源欄「被清成 NULL」· B 閘「放行」· A 閘算出 t
--               · `UPDATE … SET status='published'` ⇒ **UPDATE 1(真的發出去了)**
--
-- ══ 做什麼(甲+):不刪那一列, 改【就地清空內容】════════════════════════════
-- · **沒有任何大圖指著的** ⇒ 照舊**整列刪掉**(90 天那件事沒有被關掉)
-- · **還有大圖指著的**     ⇒ **不刪那一列**(留住來歷), 但把**清得掉的內容清掉**
-- ⇒ 🎯 **兩道閘一個字都不用改** —— 因為它們的輸入(`source_email_id`)根本不會再變成 NULL。
--    📌 **這比「改那兩道閘」安全**:改閘就有可能改錯那個「手動建的不受管」分支。
--
-- 🔴 **清得掉的只有四欄, 講明白不要讀寬**:`subject` / `extracted` / `gmail_thread_id` / `error_code`。
--    **清不掉**的是 `sender` / `gmail_message_id` / `received_at` / `status` / `auth_passed`
--    —— 它們是 `NOT NULL`(`sender` 還有 CHECK `<> ''` 且 `= lower(btrim(...))`)。
--    ⇒ 📌 **所以甲+ 是「清得掉的清掉」, 不是「全部清光」。寄件者與收信時間會留著。**(Sean 知情, 見上)
-- 🔵 而清掉那四欄**不會弄壞任何畫面**:全樹 `apps/` `packages/` 對這四欄**只有寫入、沒有讀取**
--    (命中全是**寫入端**:`SupabaseSupplierNewProductStore.ts` 的 `.rpc(` 送出參數,
--     ⛔ ~~原本寫「7 個命中全在那支 .ts 的 .rpc( 裡」~~ ⇒ **其中 3 個在它的 `.test.ts` fixture 裡**
--     (R1 nit 3 抓到;結論不變, 而數字的出處要說對)。
--     🟢 正對照:`supplier_inbound_emails` 全樹唯一的 SELECT 是同檔 `:46-48` 的
--     `.select('gmail_message_id, status')` ⇒ **那四欄一個都沒被讀**。)
--
-- ══ 🧭 共同判準:**來歷跟著內容走** ═════════════════════════════════════════
-- 這是**第二扇門**。第一扇門是 `20260916250000`(`_duplicate` 把來歷洗成 NULL), 它的原則
-- `20260916250000:38-49` 逐字:
--   「那句話聽起來很對, 而它把一個【來歷】的問題講成一個【出身】的問題。
--     複製品的**內容**就是那封信來的;把來歷丟掉 = **把那個內容該受的管一起丟掉**。
--     ✅ 現在的規則:**來歷跟著內容走** —— 與 rights_note 跟著圖走是同一條。」
--
-- 🛑 **而第二扇門沿用不了第一扇門的【形式】, 這一格要寫清楚**:
--    · 第一扇門:來源那一列**還在** ⇒ 把 id 抄過去就保住了來歷
--    · 第二扇門:來源那一列**正在被刪** ⇒ **id 本身保不住, 抄無可抄**
--    ⇒ 🎯 **形式沿用不了, 原則沿用得了。** 本片的做法(不讓那一列死)是同一條原則的另一個形式。
--    ⇒ 🔴 **第三扇門出現時, 要照的是【來歷跟著內容走】這條原則, 不是「複製那個欄位」那個動作。**
--       📌 只寫結論的話, 下一個人還是會照著抄動作。
--
-- 🛑 **為什麼原則只寫在這裡, 沒有寫進第一扇門的檔頭**(主視窗交辦要寫兩邊, 我沒照做, 已回報):
--    `20260916250000` **已經貼了**(帳本 2026-09-17), 而我當場實比過
--    **帳本第 2 欄就是那支檔的 sha256**, 一字不差:
--      `APPLIED.tsv` ⇒ fa25944f70a3924dad45d81448b924137b13315a313b9bf4b3da0754a7f8430f
--      `shasum -a 256` ⇒ 同上
--    ⇒ 📌 **貼板之後, 那支 migration 檔就是唯讀的** —— 動它一個字, 帳本那一列當場對不上。
--    ⇒ ✅ 所以本檔**點名**第一扇門是誰、原則逐字在它的哪幾行 ⇒ 下一個人從這裡找得到它。
--
-- ══ ⏰ 死線:本片要在【開旗標那天】之前落地 ═══════════════════════════════
-- 🔬 2026-09-18 唯讀正式庫 `cron.job`:全部 **10** 支 job 名字都印得出來
--    (🟢 正對照 ⇒ 尺看得到, 不是權限問題), 而 `command LIKE '%purge%'` ⇒ **0 支**
--    (⚪ 負對照 `'%purgeZZQ%'` ⇒ 0)。
--    repo 對得上:`20260916170000:32-37` 那兩句 `cron.schedule` 是**註解掉的**, 逐字
--    「(以下是註解, 不會被執行)」「開旗標那天:下面兩句 + 白名單兩列 + 心跳, **同一顆 commit、同一次貼板**」。
-- ⇒ 📌 **這個洞現在是【雙重休眠】**:沒有信件來的草稿, 而且沒有任何東西會去跑那支清理
--    ⇒ 🎯 **現在是修它成本最低的一刻:改一支【今天完全不會執行】的函式, live 行為零風險。**
-- ⇒ 🔴 **而開旗標那一發會把那兩句 cron 一起打開** ⇒ **本片必須在那天之前落地**,
--    否則那一發等於親手把帶著這個 bug 的清理排程開起來。
--    ✅ 建議把本片寫進「開旗標那天」的前置清單(那件事目前只住在 `20260916170000` 的檔頭)。
--    🔴 **而那一行要【連著寫】另一件**(R1 consider 2):**心跳要把 `v_cleared` 一起吐出來。**
--       理由:pg_cron 成功那一發的 `cron.job_run_details.return_message` **不帶 NOTICE**
--       (NOTICE 只進 postgres log)⇒ 看板上的「刪了 0 封」**分不出**
--       「沒東西過期」與「該過期的全部被留下來只清內容」。
--       ⇒ 📌 **本片新加的那一段行為, 上線之後【沒有任何機械訊號證明它跑過】。**
--
-- ══ 🔴 MF1(R1 抓到):`CREATE OR REPLACE` 保住 ACL, **也保住了 COMMENT** ═════════
-- 那個機制同時保留 `pg_description` ⇒ **本片會把【三則】活在正式庫裡的說明變成假話**(⛔ 第一版這裡寫「兩則」, 而那正是 R2 抓到的必修)。
-- ⛔ ~~所以本片同一個交易內一併更正那【兩】則~~ ⇒ **三則**(R2 抓到第一版漏了第三則, 見下)(三則都釘 md5, 前後各一道):
--
-- (a) **那支函式自己的 COMMENT**(`20260916150000:574-575`, 已貼)逐字
--     「刪掉 90 天前讀過的廠商信紀錄…**大圖的 source_email_id 由 FK 設成 NULL**。」
--     ⇒ ①「刪掉 90 天前的紀錄」不再無條件成立;②「由 FK 設成 NULL」**正是本片親手關掉的那件事**。
--
-- (b) 🔴🔴 **`home_banners` 的表 COMMENT**(`20260918020000:175`, **2026-09-18 已貼**)——
--     **這一則不只是過期, 它的假法【方向是反的】, 而那正是最貴的一種。**
--     舊字面逐字:「90 天清信時, 本表的 source_email_id 會被設成 NULL…去 admin_audit_log
--     查不到那一次變更**是正常的, 不是資料損毀也不是有人手動改庫**」。
--     🎯 本片落地之後, 一張**信件來的**大圖的 `source_email_id` 變 NULL **只剩一種可能:有人直接下 SQL 改**
--        ⇒ 那句話會叫下一個查的人**把唯一真正的警訊讀成「正常的」**。
--     ⇒ 📌 **一句原本正確的說明, 會因為別人修好了一個 bug 而變成危險的。**
--
-- 🛑 **而 (b) 讓本片多碰一張表, plan 沒寫到這件事 —— 我把它寫在這裡, 不靜靜做掉。**
--    判斷:**那句話是本片親手弄假的 ⇒ 修它不是範圍擴張, 是把自己弄倒的東西扶回去。**
--    成本:同交易一句 `COMMENT ON TABLE`(只拿 ShareUpdateExclusive, 本檔已有 lock_timeout 5s),
--    **不動 prosrc ⇒ 函式 md5 一個字不變**。已回報主視窗。
--
-- ══ 🔴🔴 R2 must-fix:MF1 那個病有【三則】, 我第一輪只修了兩則 ═══════════════
-- 漏掉的是 **`supplier_inbound_emails` 自己的表 COMMENT**(`20260916150000:106-107`, 已貼),逐字
--   「只存必要欄位、不存信件內文;**90 天後由 supplier_inbound_emails_purge_expired() 刪**。」
-- ⇒ 本片之後, 那句話對**本功能主要產出的那一群列**就是假的(有大圖指著的那幾封不會被刪)。
-- 🔴 **而假的方向是【多承諾】, 這一格比「過期」嚴重**:有人問「廠商信留多久」,
--    庫裡那張表自己回答「90 天刪」, 而實際是**只要那張大圖活著, 寄件者的 email 位址就永久留著**。
-- 🔵 **而「Sean 知情同意寄件者會留著」與「庫裡的說明還在講相反的話」是兩件事** ——
--    他拍甲+ 時題目逐字帶著那句代價 ⇒ 實質他同意了;而**這張表的說明沒有跟著改** ⇒ 仍要改。
--    📌 寫在這裡, 免得下一個人以為「既然拍板了就不用改」。
--
-- ══ 🎯 而這一條真正的教訓不是那則 COMMENT, 是我用錯了方法 ═══════════════════
-- 🔴 **我修 MF1 的方式, 自己犯了 MF1 警告的那件事。** 而方向很諷刺:
--    我細心更正了**這支函式根本不寫**的 `home_banners` 的說明,
--    卻放著**它真正在寫**的 `supplier_inbound_emails` 的說明。
--    ⇒ 📌 **我那把尺量的是「我剛剛想到的那幾則」, 不是「這片會弄假的全部」。**
--
-- ✅ **所以第二輪不靠想的, 先把全集查出來再逐個判**(主視窗 2026-09-18 要求):
--    🔬 掃正式庫 `pg_description` **全表**, 命中 `purge_expired` / `source_email_id` /
--       `supplier_inbound_emails` / `90 天` 任一者就列出來 ⇒ **8 則**
--       (🟢 正對照:同一把尺看得到全庫 **5873** 則 ⇒ 它不是只會回這幾列 ·
--        ⚪ 負對照:`purge_expiredZZQ` ⇒ 0)
--    逐則判「本片之後它還成立嗎」:
--      ① `admin_home_banner_duplicate`        ✅ 成立(講它自己照帶來歷, 本片沒動它)
--      ② `admin_home_banner_save_draft`       ✅ 成立(講「不傳就別動」, 本片沒動它)
--      ③ `admin_sso_login_events` 表           ✅ 無關(SSO 的 90 天, 另一支函式)
--      ④ `admin_sso_login_events.ip` 欄        ✅ 無關(同上)
--      ⑤ `home_banners` 表                     ❌ 本片更正(第一輪已做)
--      ⑥ `purge_admin_sso_login_events`       ✅ 無關(另一支 90 天函式)
--      ⑦ `supplier_inbound_emails` 表          ❌ **本片更正(第一輪漏掉的就是這則)**
--      ⑧ `supplier_inbound_emails_purge_expired` ❌ 本片更正(第一輪已做)
--    ⇒ 🎯 **受影響 = 3 則。**
--    🔴🔴 **而「這份清單證明沒有第 4 則」這句話我說得太滿, 收回來**(R1 Q2 打法一實際打中):
--       那把尺量的是「**提到這四個識別字**」, 不是「**描述這個行為**」—— 兩者不是同一個集合。
--       🔬 反例是找得到的:`admin_home_banner_publish` 自己那則 COMMENT(`20260916180000:277`)
--          逐字有「信件來的草稿還要有配到的商品且連結指到 /products」, 而四個關鍵字**一個都不命中**。
--          ⚪ 這次沒咬人是運氣:那一則在**舊**行為下才是假的(90 天後那道要求會自己蒸發),
--             本片反而把它修回真的。
--    ⇒ ✅ **這份清單真正證到的是**:「提到那四個識別字的說明」已經被逐則判過, 沒有漏。
--       **它證不到**「描述這個行為而換了說法的說明」。後者今天由人再看一遍, 沒有機械保證。
--    ⇒ 📌 **而這比第一輪好**:第一輪連前者都沒有。**把尺的射程寫下來, 比假裝它是全稱的有用。**
--    ⇒ 📌 **把方法從「想到哪幾則」換成「先列全集再逐個判」, 第四次才不會發生。**
--
-- ══ 🔵 R1 consider 1:DELETE / UPDATE 的順序, 我【考慮過而刻意不動】═══════════
-- 把 UPDATE 移到 DELETE 之前, 可以讓「兩句之間有人新增一張指著那封信的大圖」那個 interleaving
-- 的最壞結果從「列被刪掉 + 閘永久失效」降成「這輪沒清乾淨, 下一輪自己補」。
-- 🔬 **而 R1 自己把那條路的三個入口逐條證死**:`system_supplier_mail_record` 指的是當下那封信
--    ⛔ ~~(不可能 >90 天)~~ 🔴 **那個理由是錯的, 訂正**(R1 C4):`20260916170000:104-110` 的
--       **failed 重跑**分支 `SELECT … FOR UPDATE` 抓的是**既有那一列**, 而 `:109` 逐字
--       「**created_at 不動(90 天從第一次看到算)**」⇒ 這支函式**真的做得出**
--       「新大圖指著一列 >90 天的信」。
--    ✅ **真正擋住它的是另一個界, 而那個界【住在 TS 常數裡】**:
--       `packages/use-cases/src/draft-supplier-newproduct-banners.ts:26`
--       `SUPPLIER_MAIL_QUERY = 'label:PCM新品 newer_than:3d'`(同檔 `:39` 逐字「三天後撈不到」)
--       ⇒ failed 的列只可能在 **3 天內**被重跑, 永遠碰不到 90 天。
--       🔴 **所以那不是「結構性的 0」, 是「被一個 TS 常數擋住的 0」** ——
--          哪天有人為了補跑把 `newer_than` 放寬, 這一格就活過來了。
--    · `_duplicate` 抄的是既有那張(那封信本來就有人指著 ⇒ 不在 DELETE 集合裡)·
--    `save_draft` 的 INSERT 吃 `p_source_email_id`, 而**全樹唯一呼叫端寫死 null**
--    (`apps/admin/src/lib/home-banners/home-banner-repository.ts:109`)。
-- ⇒ 📌 **可達性是 0, 而它【不是結構性的】**(訂正見上)—— 三個入口裡有兩個是結構性的,
--    第三個靠的是 `newer_than:3d` 那個 TS 常數。⇒ 今天仍不值得重算全部 md5 + 重跑那批突變,
--    而**放寬 `newer_than` 的那一天要回頭看這一段**。
-- ⇒ ⚠️ **而這條記在這裡**:哪天本檔因為別的原因要再動, **順手把兩句對調**。
--
-- ══ 影響 ═══════════════════════════════════════════════════════════════════
-- · **客人:完全不會有差別。** 草稿與信件表都不見客;本片不碰前台、不碰 home_banners_live_v。
-- · **員工:平常完全不會有差別。** 唯一的差別在那個本來就不該發生的情境 ——
--   一張超過 90 天的信件草稿按發布 ⇒ **照樣被擋**, 而那正是今天該有的行為。
-- · **回傳值語意不變**:仍然是「**刪掉幾封**」(`RETURNS integer`)。
--   🔴 **刻意不把清空的封數加進去** —— `packages/adapters/src/supabase/database.types.ts:9595`
--      逐字 `supplier_inbound_emails_purge_expired: { Args: never; Returns: number }`,
--      而「刪掉幾封」是那個數字今天的意思。**偷偷換掉一個數字的意思, 比換掉型別更難發現。**
--      清空的封數走 `RAISE NOTICE`。
-- · 鎖:⛔ ~~`CREATE OR REPLACE FUNCTION` 不碰資料表~~ ⇒ **那句話現在是假的**(R2 C3)——
--   本片有三句 `COMMENT ON`, 其中兩句碰資料表(`home_banners` / `supplier_inbound_emails`),
--   各拿 **ShareUpdateExclusive 並持有到 COMMIT**。
--   🔵 風險實際接近 0:SUE **不與 ROW EXCLUSIVE 衝突** ⇒ `_publish` / `_save_draft` / `_archive`
--      的 DML **不會被擋**;只與 vacuum / ALTER / 另一句 COMMENT 衝突, 最壞是 `lock_timeout 5s`
--      當場 abort(fail-closed, 整筆回滾)。
--   🛑 **而這一行是【貼板的人決定什麼時候貼】時會讀的那一行, 不是註腳** ⇒ 所以更正它, 不是加註。
-- · 部署時序:🟢 **無空窗** —— 沒有新物件、**簽章一個字沒變**、本片沒有任何碼。
--   🔴 而**什麼時候貼**照 CLAUDE.md〈貼板與推的順序〉第二條:跟本次程式無關的板 ⇒
--      **等推 main 那一發跑完再貼**(帳本閘 ⑦ 平台孤兒會擋)。
--
-- ══ 🔵 pcm_acl_approve_latest:**本片不用跑, 這是判過的不是漏掉的** ═════════
-- `CREATE OR REPLACE FUNCTION` **保留既有 ACL**(不新增權限列), 而本檔零 `GRANT` / 零 `REVOKE` /
-- 零 `ALTER … OWNER` / 零新物件 ⇒ 每日摘要那把尺讀不到本片。
-- 🔬 而本檔**後置斷言有把 proacl 釘住**(見下), 所以「ACL 沒變」不是我用講的。
-- 📌 對照組:`20260916250000` 檔頭**有**那句 —— 它建了一支新函式(全新 ACL 列)⇒ 它需要, 本片不需要。
--
-- ══ 還原 ═══════════════════════════════════════════════════════════════════
-- `supabase/rollbacks/20260918030000-rollback.sql`
-- 🔴 那支嵌的是【貼之前】從正式庫 `pg_get_functiondef` 撈下來的本體, md5 釘死, **不是從 repo 抄的**。
-- 🔵 **不用先退碼** —— 本片**沒有任何碼**跟著它(整片只有一支函式, 簽章與回傳值都沒變)。
--    hash 在 commit 之後用 **follow-up commit** 補進 rollback 檔頭 —— ⚠️ **不要 `--amend`**
--    (amend 會當場換掉 hash ⇒ 檔裡釘的那顆不存在)。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 前置閘 ────────────────────────────────────────────────────────────────
-- 🔴 `position(x IN y)` **不能加 schema 前綴**(那是 SQL 語法糖不是函式呼叫)
--    ⇒ 本檔一律用 `pg_catalog.strpos(y, x)`(**引數順序相反**)。
--    🔬 2026-09-18 板 20260918020000 在拋棄式 PG 上真跑才紅的, 靜態閘 / typecheck / lint 全沒叫。
DO $pre$
DECLARE v_md5 text; v_fk text; v_chk text; v_pub text;
BEGIN
  -- ① 那支函式在, 而且簽章就是我以為的那一個
  IF pg_catalog.to_regprocedure('public.supplier_inbound_emails_purge_expired()') IS NULL THEN
    RAISE EXCEPTION '前置閘①:public.supplier_inbound_emails_purge_expired() 不存在 ⇒ 這個庫不是我以為的那個 ⇒ 停下';
  END IF;

  -- ② 它的本體就是我寫這片時看到的那一版(或已經是本片換上去的 ⇒ 重跑)
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.supplier_inbound_emails_purge_expired()'::pg_catalog.regprocedure;
  IF v_md5 IS DISTINCT FROM 'dc395ba506b330616a03fb4e43de0e6a'
     AND v_md5 IS DISTINCT FROM '5f4d90bcfc0f73cce65ac141a87fa11b' THEN
    RAISE EXCEPTION '前置閘②:purge_expired 的本體 md5 是 %, 既不是貼前的 dc395ba506b330616a03fb4e43de0e6a 也不是本片要寫的 5f4d90bcfc0f73cce65ac141a87fa11b ⇒ 有人先改過(或我拿的是舊資訊)⇒ 拒繼續。', COALESCE(v_md5, '(查不到)');
  END IF;

  -- ③ 🔴 **FK 還是 ON DELETE SET NULL** —— 那是本片整個前提。
  --    它若已經被改成別的, 本片解的病可能已經不存在, 或換了形狀 ⇒ 停下讓人看。
  SELECT pg_catalog.pg_get_constraintdef(con.oid) INTO v_fk
    FROM pg_catalog.pg_constraint con
   WHERE con.conname = 'home_banners_source_email_id_fkey'
     AND con.conrelid = 'public.home_banners'::pg_catalog.regclass;
  IF v_fk IS NULL OR pg_catalog.strpos(v_fk, 'ON DELETE SET NULL') = 0 THEN
    RAISE EXCEPTION '前置閘③:home_banners_source_email_id_fkey 不是 ON DELETE SET NULL(實際:%)⇒ 本片的前提不成立 ⇒ 拒繼續', COALESCE(v_fk, '(不存在)');
  END IF;

  -- ④ 🔴 **我要保護的 A 閘還在, 而且還長成我以為的樣子**
  SELECT pg_catalog.pg_get_constraintdef(con.oid) INTO v_chk
    FROM pg_catalog.pg_constraint con
   WHERE con.conname = 'home_banners_mail_published_needs_match'
     AND con.conrelid = 'public.home_banners'::pg_catalog.regclass;
  IF v_chk IS NULL OR pg_catalog.strpos(v_chk, 'source_email_id IS NULL') = 0 THEN
    RAISE EXCEPTION '前置閘④:CHECK home_banners_mail_published_needs_match 不存在或不再以 source_email_id IS NULL 為前提 ⇒ 我要保護的東西不是這個 ⇒ 拒繼續';
  END IF;

  -- ⑤ 🔴 **B 閘還在** —— 釘 **md5**, 不用子字串(R1 consider 3)。
  --    ⛔ ~~原本用 `strpos(prosrc, 'v_before.source_email_id IS NOT NULL')`~~
  --    🔴 **那道守不到「有人把那一段【註解掉】」** —— 字面還在 prosrc 裡, 閘照過, 而閘已經死了。
  --       📌 A 閘我用 md5 釘(後置⑤), 而 B 閘當時只用子字串 ——
  --          **同一個理由對兩道一字不差地成立, 而我只做了一道。**
  SELECT pg_catalog.md5(p.prosrc) INTO v_pub FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.admin_home_banner_publish(uuid,timestamptz,timestamptz,timestamptz,text,text)');
  IF v_pub IS DISTINCT FROM '79ff217852f3ac82a9ba34ffde8d5599' THEN
    RAISE EXCEPTION '前置閘⑤:admin_home_banner_publish 的本體 md5 是 %, 不是我寫這片時看到的 79ff217852f3ac82a9ba34ffde8d5599 ⇒ 我要保護的那兩道閘, 其中 B 那道已經不是我以為的樣子 ⇒ 拒繼續(這不是本片改的, 是你開始之前它就不一樣)。', COALESCE(v_pub, '(查不到那支函式)');
  END IF;

  -- ⑥ 🔵 A 閘的 md5 也放進**前置**一份(R1 nit 2)。
  --    📌 理由是**訊息會指錯人**:後置那一道叫的時候寫「被動過 ⇒ 本片不該碰它」,
  --       而本片根本沒有任何碰 A 閘的語句 ⇒ 它**永遠只可能因為【別人】改過而叫**,
  --       在後置叫會把人導來查本片。放前置一份, 話就說得對。
  --    ⚠️ 已知誤擋:`pg_get_constraintdef` 是 PG 的正規化輸出, **跨大版本可能換排版** ⇒
  --       升版之後同一條 CHECK 會算出不同 md5 ⇒ 本片會貼不上去(fail-closed, 不是貼壞)。
  IF (SELECT pg_catalog.md5(pg_catalog.pg_get_constraintdef(con.oid))
        FROM pg_catalog.pg_constraint con
       WHERE con.conname = 'home_banners_mail_published_needs_match'
         AND con.conrelid = 'public.home_banners'::pg_catalog.regclass)
     IS DISTINCT FROM 'e1c1612a397e804272091c4de98227ac' THEN
    RAISE EXCEPTION '前置閘⑥:A 閘(CHECK home_banners_mail_published_needs_match)的定義不是我寫這片時看到的那一條 ⇒ 這不是本片改的, 是你開始之前它就不一樣 ⇒ 停下讓人看';
  END IF;

  -- ⑦ 🔵 三則要更正的 COMMENT, 現在就是我以為的那三則(釘 md5;收兩個值 ⇒ 重跑安全)
  -- 🔴 **一律用 `IS DISTINCT FROM`, 不用 `NOT IN`**(R2 C1):
  --    `obj_description` 在**說明被刪掉**時回 NULL ⇒ `md5(NULL)` = NULL
  --    ⇒ `NULL NOT IN ('a','b')` = **NULL** ⇒ `IF` 不成立 ⇒ **閘不叫、照放行**。
  --    📌 而這一格真正的訊號是:**同一支檔裡五道用一種寫法、第六道換另一種 ⇒ 那本身就該停下來看。**
  --       換寫法要有理由, 沒理由就是手滑 —— 而它偏偏是唯一有 NULL 面的那一道。
  DECLARE v_c1 text; v_c2 text; v_c3 text;
  BEGIN
    v_c1 := pg_catalog.md5(pg_catalog.obj_description('public.supplier_inbound_emails_purge_expired()'::pg_catalog.regprocedure,'pg_proc'));
    v_c2 := pg_catalog.md5(pg_catalog.obj_description('public.home_banners'::pg_catalog.regclass,'pg_class'));
    v_c3 := pg_catalog.md5(pg_catalog.obj_description('public.supplier_inbound_emails'::pg_catalog.regclass,'pg_class'));
    IF v_c1 IS DISTINCT FROM 'd41b4be6913cd333418168740b9e2f2b'
       AND v_c1 IS DISTINCT FROM '843626564416935d388d17af3e2e6fea' THEN
      RAISE EXCEPTION '前置閘⑦a:那支函式的 COMMENT(%)既不是貼前那一則也不是本片要寫的 ⇒ 有人先改過(或它被刪掉了)⇒ 拒繼續', COALESCE(v_c1,'(沒有 COMMENT)');
    END IF;
    IF v_c2 IS DISTINCT FROM 'dcfda5c8c15f666c930524db42c32684'
       AND v_c2 IS DISTINCT FROM '671129a8fa196bc6bb2b1e29c63fdeed' THEN
      RAISE EXCEPTION '前置閘⑦b:home_banners 的表 COMMENT(%)既不是 20260918020000 寫上去的那一則也不是本片要寫的 ⇒ 拒繼續', COALESCE(v_c2,'(沒有 COMMENT)');
    END IF;
    IF v_c3 IS DISTINCT FROM '1436fe0fb622744f718be6c0ed84946b'
       AND v_c3 IS DISTINCT FROM '36db3a9ee2e8df8d12ac16b68bf23098' THEN
      RAISE EXCEPTION '前置閘⑦c:supplier_inbound_emails 的表 COMMENT(%)既不是 20260916150000 那一則也不是本片要寫的 ⇒ 拒繼續', COALESCE(v_c3,'(沒有 COMMENT)');
    END IF;
  END;

  IF v_md5 = '5f4d90bcfc0f73cce65ac141a87fa11b' THEN
    RAISE NOTICE '🔵 前置閘:本片【已經貼過】⇒ 這是重跑, 下面那句會換上逐字相同的本體。';
  ELSE
    RAISE NOTICE '✅ 前置閘全過:舊本體 md5 % · FK 是 SET NULL · A 閘在 · B 閘在', v_md5;
  END IF;
END
$pre$;

-- ── 2. 動作(本片唯一會改變資料庫的一句) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.supplier_inbound_emails_purge_expired()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_count   integer;
  v_cleared integer;
  v_cut     timestamptz := pg_catalog.now() - interval '90 days';
BEGIN
  -- 🔴 天數寫死 90,不收參數:呼叫端傳錯一個數字就會多刪
  --
  -- 🔴🔴 **20260918030000 起分兩段。為什麼:**
  --   舊版無條件整列刪 ⇒ FK(ON DELETE SET NULL)把大圖的 source_email_id 連帶清空
  --   ⇒ 一張【信件來的】草稿變成【看起來像手動建的】
  --   ⇒ `home_banners_mail_published_needs_match` 與 admin_home_banner_publish 裡
  --      那兩道以「該欄非空」為前提的閘**同時失效** ⇒ 勾個授權就發得上首頁。
  --   🛑 而那個「沒來源就放行」的分支**不是 bug**(手動建的大圖本來就沒有來源信)
  --      ⇒ 本片**不碰那兩道閘**, 改成不讓它們的輸入被洗掉。
  --   📌 共同判準:**來歷跟著內容走**(第一扇門 20260916250000:38-49 逐字)。

  -- ① 沒有任何大圖指著的 ⇒ 照舊【整列刪掉】(90 天那件事沒有被關掉)
  DELETE FROM public.supplier_inbound_emails e
   WHERE e.created_at < v_cut
     AND NOT EXISTS (SELECT 1 FROM public.home_banners b WHERE b.source_email_id = e.id);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- ② 還有大圖指著的 ⇒ 不刪那一列(留住來歷), 但把【清得掉的】內容清掉。
  --    🔴 清不掉的是 sender / gmail_message_id / received_at / status / auth_passed(NOT NULL)
  --       ⇒ 寄件者與收信時間會留著。**Sean 2026-09-18 拍甲+ 時知情。**
  --    🔵 最後那個 OR 串是【冪等護欄】:已經清乾淨的列不再被 UPDATE 到
  --       ⇒ 每晚重跑不會一直翻同幾列(也讓 v_cleared 說的是真的有清到幾封)。
  UPDATE public.supplier_inbound_emails e
     SET subject = NULL, extracted = NULL, gmail_thread_id = NULL, error_code = NULL
   WHERE e.created_at < v_cut
     AND EXISTS (SELECT 1 FROM public.home_banners b WHERE b.source_email_id = e.id)
     AND (e.subject IS NOT NULL OR e.extracted IS NOT NULL
          OR e.gmail_thread_id IS NOT NULL OR e.error_code IS NOT NULL);
  GET DIAGNOSTICS v_cleared = ROW_COUNT;
  IF v_cleared > 0 THEN
    RAISE NOTICE '另有 % 封過期信【沒有刪列, 只清內容】—— 那幾封還有大圖指著, 留列是為了保住來歷。', v_cleared;
  END IF;

  -- 🔴 回傳值語意**一個字都沒變** = 【刪掉幾封】。清空的封數刻意不加進來:
  --    database.types.ts 逐字 `Returns: number`, 而「刪掉幾封」是它今天的意思。
  --    📌 **偷偷換掉一個數字的意思, 比換掉型別更難發現。**
  RETURN v_count;
END
$function$;

-- ── 2b. 一併更正三則會被本片弄假的說明(見檔頭 MF1)───────────────────────
-- 🔵 這三句**不動 prosrc** ⇒ 函式 md5 一個字不變 ⇒ 行為那幾發突變的結論不受影響。
-- 🔬 三則是**查出來的全集**, 不是想出來的(見檔頭「先列全集再逐個判」那節)。
COMMENT ON FUNCTION public.supplier_inbound_emails_purge_expired() IS '90 天清理過期的廠商信紀錄(20260916150000;Sean Q8 甲;20260918030000 起分兩段)。① 沒有大圖指著的 ⇒ 整列刪掉。② 還有大圖指著的 ⇒ **不刪列**(留住來歷),只清 subject / extracted / gmail_thread_id / error_code;sender / gmail_message_id / received_at / status / auth_passed 是 NOT NULL,清不掉、會留著(Sean 2026-09-18 拍甲+ 時知情)。🔴 回傳值仍然只是【刪掉幾封】,**不含清空的封數**(那個數走 RAISE NOTICE)。📌 為什麼分兩段:整列刪會讓 FK(ON DELETE SET NULL)把大圖的 source_email_id 洗掉,而 home_banners_mail_published_needs_match 與 admin_home_banner_publish 兩道閘都以那一欄非空為前提 ⇒ 會同時失效。EXECUTE 只給 service_role。';

COMMENT ON TABLE public.home_banners IS '首頁大圖(20260916150000;20260916180000 起 Sean 三題改乙;20260918020000 更正三處過期字面;20260918030000 更正 FK 連帶那一段)。draft ⇒ published ⇒ archived(單列不回頭;要重做走 admin_home_banner_duplicate 開一張新草稿,舊那列原封不動)。【函式寫入】五支,各寫 admin_audit_log,都是 SECURITY DEFINER、search_path 空字串、EXECUTE 只給 service_role:admin_home_banner_save_draft / _publish / _archive / _duplicate,以及 system_supplier_mail_record(20260916170000;廠商新品信那條路,actor 固定 system:mail-draft、rights_confirmed 寫死 false)。🔴【非函式寫入】有一條 FK:home_banners_source_email_id_fkey 是 ON DELETE SET NULL ⇒ 刪掉來源信會把本表的 source_email_id 連帶設成 NULL,而且不寫稽核、不動 updated_at。⛔ 而舊字面「90 天清信時…去 admin_audit_log 查不到那一次變更是正常的,不是資料損毀也不是有人手動改庫」**自 20260918030000 起過期**:那一片讓 supplier_inbound_emails_purge_expired() 對【還有大圖指著的】信不刪列、只清內容 ⇒ 這條 FK 連帶**不會再由清理排程觸發**。🔴 所以今天若看到一張【本來是信件來的】大圖 source_email_id 變成 NULL,那**不是**排程做的 —— 排程以外唯一的路是有人直接下 SQL 改。**那是要查的,不是正常的。**🔵 而這句話的**保鮮期寫在這裡**:它成立是因為今天沒有任何程式路徑產得出那種 NULL(save_draft 對該欄是「不傳就別動」且唯一呼叫端寫死 null、_duplicate 照帶、_publish / _archive 不碰)—— **哪天 save_draft 真的開始送 p_source_email_id,這一句要重看。**發布與下架 / 封存都 = 所有在職員工;發布要帶預覽時的 updated_at、要勾授權、預設 14 天下架。已發布的連結一定要是站內 /products… 或 /brands…;信件來的草稿(source_email_id 非空)另外要配到商品且連結指到 /products…。首頁可以同時掛多張(排序由前台決定:starts_at DESC 後 id DESC;輪播最多 HOME_BANNER_MAX_SLIDES = 4 張,而那個上限只在碼裡、DB 端沒有任何閘)。anon / authenticated 零權限;前台讀 home_banners_live_v。⛔ 20260918020000 更正的三句舊字面(留著不刪):① 「寫入只走 admin_home_banner_save_draft / _publish / _archive」⇒ 漏了 _duplicate(20260916250000)與 system_supplier_mail_record(20260916170000)⇒ 函式是五支不是三支;② 「前台目前只顯示最近上架的一張,多張輪播還沒做」⇒ 輪播已經上線(顧客站 main 實查);③ 舊字面把「寫入」寫成只有函式一種 ⇒ 漏掉上面那條 FK 連帶,而那一條不寫稽核。';

COMMENT ON TABLE public.supplier_inbound_emails IS '讀過的廠商新品信(20260916150000;PRD §3.3,Sean Q8 甲;20260918030000 更正保留期那一句)。只存必要欄位、不存信件內文。90 天後由 supplier_inbound_emails_purge_expired() 處理,而 20260918030000 起【分兩段】:① 沒有首頁大圖指著的 ⇒ 整列刪掉;② 還有大圖指著的 ⇒ **不刪列**,只清 subject / extracted / gmail_thread_id / error_code。⛔ 舊字面「90 天後由 … 刪」對 ② 那一群**不成立**,而它錯的方向是【多承諾】:② 那幾列等於**永久保留** sender(一個 email 位址)/ received_at / gmail_message_id / status / auth_passed,只要那張首頁大圖還在。🔵 Sean 2026-09-18 拍甲+ 時知情(端上去的題目逐字帶著「寄件者與收信時間清不掉,會留著」)—— 而**他同意那件事**與**這張表的說明還在講相反的話**是兩件事,所以這一句要改。📌 留列的理由:整列刪會讓 FK(ON DELETE SET NULL)把大圖的 source_email_id 洗掉,而 home_banners_mail_published_needs_match 與 admin_home_banner_publish 兩道以那一欄非空為前提的閘會同時失效。🔵 副作用(好的):② 那幾列的 gmail_message_id 永久留著 ⇒ 去重(knownMessageIds)對那幾封永遠有效,同一封信再被投遞不會生出第二張草稿;舊行為 90 天後整列消失, 會。anon / authenticated 零權限;service_role 讀 + 新增。';

-- ── 3. 後置斷言 + 負對照 ─────────────────────────────────────────────────────
DO $post$
DECLARE v_md5 text; v_cfg text; v_acl text; v_ret text; v_secdef boolean;
BEGIN
  SELECT pg_catalog.md5(p.prosrc), p.proconfig::text, p.proacl::text,
         pg_catalog.pg_get_function_result(p.oid), p.prosecdef
    INTO v_md5, v_cfg, v_acl, v_ret, v_secdef
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.supplier_inbound_emails_purge_expired()'::pg_catalog.regprocedure;

  -- ① 換上去的就是我打算的那一份(釘 md5)
  IF v_md5 IS DISTINCT FROM '5f4d90bcfc0f73cce65ac141a87fa11b' THEN
    RAISE EXCEPTION '後置閘①:換上去的本體 md5 是 %, 不是本片打算寫的 5f4d90bcfc0f73cce65ac141a87fa11b ⇒ 拒 COMMIT', v_md5;
  END IF;

  -- ② 🔴 CREATE OR REPLACE 會把 SET 子句整組換掉 ⇒ 明確再驗一次
  IF v_cfg IS DISTINCT FROM '{"search_path=\"\""}' THEN
    RAISE EXCEPTION '後置閘②:proconfig 變成 % ⇒ search_path 沒保住 ⇒ 拒 COMMIT', COALESCE(v_cfg, '(NULL)');
  END IF;

  -- ③ 簽章面:回傳型別與 SECURITY DEFINER 都沒變(呼叫端與 database.types.ts 靠這個)
  IF v_ret IS DISTINCT FROM 'integer' THEN
    RAISE EXCEPTION '後置閘③a:回傳型別變成 % ⇒ 拒 COMMIT', v_ret;
  END IF;
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION '後置閘③b:不再是 SECURITY DEFINER ⇒ 拒 COMMIT';
  END IF;

  -- ④ 🔵 ACL 沒變 —— 檔頭說「不用跑 pcm_acl_approve_latest」靠的就是這一格, 不是用講的。
  --    🔴 當【集合】比, 不當字串比:proacl 的順序不保證。
  IF NOT (v_acl IS NOT NULL
          AND (SELECT count(*) FROM unnest(v_acl::text[]) a) = 2
          AND v_acl::text[] @> ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]) THEN
    RAISE EXCEPTION '後置閘④:proacl 變成 % ⇒ 本片不該動到權限 ⇒ 拒 COMMIT', COALESCE(v_acl, '(NULL)');
  END IF;

  -- ⑤ 🔵 負對照:我要保護的那兩道閘, 本片**一個字都不該碰**。
  --    📌 少了這一條, 「順手把閘改寬再說函式修好了」也會讓①②③④ 全過 —— 而那正是改壞的樣子。
  IF (SELECT pg_catalog.md5(pg_catalog.pg_get_constraintdef(con.oid))
        FROM pg_catalog.pg_constraint con
       WHERE con.conname = 'home_banners_mail_published_needs_match'
         AND con.conrelid = 'public.home_banners'::pg_catalog.regclass)
     IS DISTINCT FROM 'e1c1612a397e804272091c4de98227ac' THEN
    RAISE EXCEPTION '🔴 負對照失敗:CHECK home_banners_mail_published_needs_match 被動過 ⇒ 本片不該碰它 ⇒ 拒 COMMIT';
  END IF;

  -- ⑥ 🔵 負對照:B 閘(publish)本片也**一個字都不該碰** —— A 閘有這一條, B 閘當時沒有(R1 consider 3)。
  IF (SELECT pg_catalog.md5(p.prosrc) FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.admin_home_banner_publish(uuid,timestamptz,timestamptz,timestamptz,text,text)'))
     IS DISTINCT FROM '79ff217852f3ac82a9ba34ffde8d5599' THEN
    RAISE EXCEPTION '🔴 負對照失敗:admin_home_banner_publish 被動過 ⇒ 本片不該碰它 ⇒ 拒 COMMIT';
  END IF;

  -- ⑦ 三則更正過的 COMMENT 精確是我打算的那三則(釘 md5)
  IF (SELECT pg_catalog.md5(pg_catalog.obj_description('public.supplier_inbound_emails_purge_expired()'::pg_catalog.regprocedure,'pg_proc')))
     IS DISTINCT FROM '843626564416935d388d17af3e2e6fea' THEN
    RAISE EXCEPTION '後置閘⑦a:函式 COMMENT 換上去的不是本片打算寫的 ⇒ 拒 COMMIT';
  END IF;
  IF (SELECT pg_catalog.md5(pg_catalog.obj_description('public.home_banners'::pg_catalog.regclass,'pg_class')))
     IS DISTINCT FROM '671129a8fa196bc6bb2b1e29c63fdeed' THEN
    RAISE EXCEPTION '後置閘⑦b:home_banners 表 COMMENT 換上去的不是本片打算寫的 ⇒ 拒 COMMIT';
  END IF;
  IF (SELECT pg_catalog.md5(pg_catalog.obj_description('public.supplier_inbound_emails'::pg_catalog.regclass,'pg_class')))
     IS DISTINCT FROM '36db3a9ee2e8df8d12ac16b68bf23098' THEN
    RAISE EXCEPTION '後置閘⑦c:supplier_inbound_emails 表 COMMENT 換上去的不是本片打算寫的 ⇒ 拒 COMMIT';
  END IF;

  RAISE NOTICE '✅ 後置閘 + 負對照全過(新本體 md5 %)', v_md5;
END
$post$;

COMMIT;
