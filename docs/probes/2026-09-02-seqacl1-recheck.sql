-- ci-self-contained: no — 對【正式庫】跑(讀 pg_class/pg_namespace 的實際 ACL), 不自己 initdb
--   ⇒ CI 的拋棄式叢集裡那些序列不存在 ⇒ 它的正對照(count>0)會失敗 ⇒ 那是【跑不起來】不是【不該跑】。
--   (2026-09-03 線 -auth 補:本檔缺這一行 ⇒ CI 的 self-contained 探針閘 rc=1 ⇒ 全隊 CI 紅。
--    判法 = 同目錄 9 支 .sql 全部是 no, 而本檔同樣需要一個被交到手上的資料庫。)
--   🛑 **而這個 `no` 是【我推的, 不是我試的】, 所以它可以被推翻**:我沒有在 CI 裡跑過本檔,
--      我是從「它讀 pg_class 的實際 ACL」推出「拋棄式叢集裡跑不起來」。
--      ⇒ 🎯 **原作者若知道它其實自給自足(例如它自己會建那些序列)⇒ 那就改成 `yes`, 不必問我。**
--      (⚠️ 這句話原本只寫在 commit body 裡 —— 而下一個動這支檔的人打開的是這支檔, 不是那顆 commit。
--       2026-09-03 主視窗指出後補進來。而 `⟦b4-SEQACL1⟧` 那條線的窗當天不在班上, 所以沒有收訊者。)
-- ⟦b4-SEQACL1⟧ 的【複查】—— 那支 migration 今天還需不需要貼?
--
-- ══ 這支檔存在的理由 ═══════════════════════════════════════════
-- `20260902180000_m4b_seqacl1_revoke_anon_sequence.sql` 被它自己的前置閘擋下,
-- 因為那四支序列**已經被【不知道是誰】收乾淨了**(板 `⟦b4-SEQACL1⟧` 逐字:
-- 「是誰收的證不出來, 而理由是結構性的 —— 正式庫的 ACL 沒有歷史」)。
-- 🔴 **而同一列也逐字寫著:根因【沒有被任何人修掉】⇒ 下一支新序列還是會漏。**
-- ⇒ 🎯 **所以它不是「已解決」, 是「目前不需要貼」—— 而那兩件事的差別只有【複查】看得出來。**
--
-- 🛑 **而這正是 `-- pcm:not-needed-now:` 那個標記存在的唯一理由**:
--    標記是【檔案裡的一個靜態字串】, 而會變的是【資料庫的狀態】
--    ⇒ 靜態標記答不出「它今天有沒有重新變成要貼」⇒ **所以它必須指向一發可以跑的檢查。**
--    ⇒ 📌 **沒有這支檔, 那個標記就只是一個比較好聽的分類。**
--
-- ══ 🔴 怎麼讀(讀法寫在欄位名裡, 因為表格會被複製走而前後文不會)══════
--   第一列「這個數字必須是0」⇒ **不是 0 ⇒ 那支 migration 重新變成【要貼】。**
--   第二列「這個數字必須大於0」= 正對照。
--   🔴🔴 **第二列是 0 ⇒ 第一列那個 0 【不算數】** —— 那代表這把尺什麼都沒讀到
--        (例如 `relacl` 全是 NULL、或連錯庫)⇒ **兩個世界會印同一個 0。**
--
-- ══ 🔵 它答不出什麼 ════════════════════════════════════════════
--   ① **它不說「是誰改的」** —— 正式庫的 ACL 沒有歷史。它只答「現在是什麼」。
--   ② 它掃的是 `public` schema **全部**的序列, 不只那四支 —— 那是刻意的:
--      根因沒修 ⇒ 新長出來的序列會用同一個方式漏, 而只盯那四支就看不到。
--   ③ 🔴 **它與 `scripts/public-sequence-acl.test.ts` 不是同一個問題。**
--      那支掃的是 `supabase/migrations/` 的**字面**, **它不連正式庫**
--      ⇒ 它答「下一張新表有沒有漏」, **答不出「那四支今天在正式庫上是什麼」。**
--      ⇒ 📌 兩支都叫「sequence ACL 守門」, 而它們的分母一個是 repo、一個是正式庫。
--
-- ══ 🟢 這把尺被兩個世界驗過(拋棄式 PG 17.10, 2026-09-02) ════════════
--   世界A 收乾淨      ⇒ 第一列 **0** · 正對照 **3**
--   世界B 重新給 anon ⇒ 第一列 **2** · 正對照 **3**   ⇒ 尺會動
--   世界C 連 service_role 也收掉 ⇒ 第一列 **0** · 正對照 **0**
--     ⇒ 🔴 **那一格就是「兩個世界印同一個 0」的長相 —— 所以正對照不可省。**
--
-- ══ ⚠️ 今天的正式庫讀數(不是本窗量的)═══════════════════════════
--   `-c7` 2026-09-02 20:0x 唯讀量:那四支只剩 `postgres` / `service_role`,
--   `anon` 與 `authenticated` 一列都不剩(存證:`~/pcm-mailbox/存證-SEQACL1那四支序列是誰收的-20260902.md`)。
--   🔴 **而那是【另一個窗、另一個指令形狀】(逐列印, 不是 count)⇒ 本檔沒有拿它當自己的讀數。**
--   ⇒ 本窗**沒有正式庫連線**(工作樹無 `.env.local`)⇒ **本檔今天的正式庫讀數 = 未取得。**
--   ⇒ 📌 **而那不影響這支檔可用** —— 它證的是「這發檢查跑得動而且有判別力」, 讀數是跑的人取的。

SELECT '這個數字必須是0(anon/authenticated/PUBLIC 對 public 底下任何序列的權限)' AS "問", count(*)::text AS "答"
FROM pg_catalog.pg_class c
CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
WHERE c.relkind = 'S' AND c.relnamespace = 'public'::regnamespace
  AND coalesce(r.rolname, 'PUBLIC') IN ('anon', 'authenticated', 'PUBLIC')
UNION ALL
SELECT '這個數字必須大於0(正對照:證明這把尺讀得到東西)', count(*)::text
FROM pg_catalog.pg_class c
CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
WHERE c.relkind = 'S' AND c.relnamespace = 'public'::regnamespace
  AND coalesce(r.rolname, 'PUBLIC') = 'service_role';
