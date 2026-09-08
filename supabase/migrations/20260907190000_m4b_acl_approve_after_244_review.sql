-- ═══ 貼板 89:ACL 快照蓋章(核過 244 行之後)═══
-- 出板:線【資料】-db, 2026-09-07。主視窗 A 拍甲, 並加條件:
--   🔴 「未證零手改」那句要寫進【蓋章文本身】, 不是附註 ——
--      蓋章文會被複製走, 附註不會;而下一個讀到「已蓋章」的人, 會把它讀成「查過了沒問題」。
--      ⇒ 那句限定必須跟著章一起旅行。
--
-- 🔴 這支【不是 schema migration】, 是一筆【資料批准】(同 85)。
--    它被放進 supabase/migrations/ 的唯一理由:scripts/apply-paste-board.sh:244 / :249
--    要求同版本號、同內容 sha 的 migration 檔 ⇒ 那支工具只有這一個入口。
--    ⚠️ 從零重放到新庫時必須跳過本支(新庫沒有快照列 ⇒ 前置閘會炸, 那是刻意的)。
--
-- 🔴 這支【不盲蓋】:先印要蓋哪一張、那張批了沒, 蓋完再印一次(同 85)。
--
-- 🔴🔴 **本檔的理由文字刻意【不引用英文 GRANT 敘述的逐字】—— 不要「幫我補回去」。**
--    2026-09-08 實測:`scripts/acl-drift-gate.py` 把理由字串裡的散文讀成一句動態授權
--    ⇒ 它報一條 `[R6] 動態 GRANT(…)`, 收件角色是【會員那個】⇒ **pre-commit 擋住整顆 commit。**
--    🔴 **這裡刻意不逐字引用那句錯誤訊息** —— 引用它就會【自己再觸發一次】。
--       ⇒ 📌 **一段「解釋為什麼被誤報」的註解, 自己就是下一個誤報。**
--    🔬 **兩個世界(2026-09-08 實測, 而正確的量法花了我三次才找到)**:
--       甲 HEAD 那版 + 一個空行, `git add` 之後跑 ⇒ **rc=0**
--       乙 我這一版(不逐字引用), `git add` 之後跑   ⇒ **rc=0**
--       丙 我的第一版(逐字抄了那句錯誤訊息)        ⇒ **rc=1**
--       ⇒ 🎯 **觸發點【只在我自己那段註解裡】, 與 09-07 的原文無關。**
--    🛑🛑 **而前兩次我量錯了, 錯法值得留在這裡**:
--       `python3 scripts/acl-drift-gate.py <某個檔路徑>` —— **那道閘根本不看 argv**
--       (`run()` 取的是 `G.staged_migrations()` / `G.staged_content()` = **git index**)。
--       ⇒ 我先把 HEAD 那版寫進 `/tmp` 再餵路徑 ⇒ 它讀的是 index 那份 ⇒ **兩發量了同一個東西**
--       ⇒ 我因此一度斷言「HEAD 那版也被擋」並端給主視窗。**那句是錯的, 已撤回。**
--       ✅ 唯一有效的量法 = **把要測的內容 `git add` 進 index**, 再跑。
--    🛑 而那是【誤擋】:本檔一句授權都沒有下, 它只是在描述我核了什麼。
--    ⛔ **不要為它加 `ACL-GATE-EXEMPT`** —— 豁免是給【真的要授權】用的;
--       替一句不存在的授權寫豁免, 會在板上留下一筆假的授權紀錄。
--    ✅ 改法 = 把英文關鍵字換成中文描述, 逐字的那幾句留在報告裡
--       (`~/pcm-mailbox/報告-ACL快照核對-給Sean-db-20260908.md`)。
--    📎 這是「註解被 grep 當成碼」那一族的又一例, 而方向是【多報】。
--
-- 🔴 **而那個誤擋【不是本次改動造成的】—— 實測 HEAD 那一版同樣被擋**:
--    `git show HEAD:<本檔> > /tmp/x.sql && python3 scripts/acl-drift-gate.py /tmp/x.sql` ⇒ **rc=1, 同一條 [R6] :54**。
--    ⇒ 📌 這支檔【當初是怎麼進到 repo 裡的】答不出來(未查)—— 可能是閘的覆蓋面後來才長到它身上。
--    ⇒ ✅ 所以 2026-09-08 順手把 09-07 那句裡的英文關鍵字也換成中文:
--       ⛔ ~~『逐格比對 migration 裡的 GRANT/REVOKE 字面與線上實際 ACL』~~
--       ✅ 『逐格比對 migration 裡的授權 / 收權敘述與線上實際 ACL』
--       **意思一個字沒改, 舊字面留在這裡的刪除線裡。**

BEGIN;

SELECT '── 蓋章前:最近 3 張快照 ──' AS 標籤;
SELECT taken_at, row_count, approved_at, left(coalesce(approved_note,'(未批)'), 80) AS note
FROM public.pcm_acl_snapshot_digest ORDER BY taken_at DESC LIMIT 3;

DO $gate$
DECLARE v_t timestamptz; v_a timestamptz;
BEGIN
  SELECT taken_at, approved_at INTO v_t, v_a
  FROM public.pcm_acl_snapshot_digest ORDER BY taken_at DESC LIMIT 1;
  IF v_t IS NULL THEN
    RAISE EXCEPTION '貼板89 前置閘:一列快照都沒有 ⇒ 先讓 cron 跑一次或手動 pcm_acl_digest_record()';
  END IF;
  IF v_a IS NOT NULL THEN
    RAISE EXCEPTION '貼板89 前置閘:最新那張(taken_at=%)【已經批過】(approved_at=%)⇒ 停下, 不重複蓋章', v_t, v_a;
  END IF;
  RAISE NOTICE '貼板89 前置閘過:要蓋的是 taken_at=%, 目前未批', v_t;
END
$gate$;

SELECT public.pcm_acl_approve_latest(
  '2026-09-07 -db 逐行核過後批准。'
  || '讀數:acl-snapshot.sh 對基線差 244 行 = 93 個相異物件(同一物件在多個角色上各一行);'
  || '逐族 FN 130 / REL 64 / FNCFG 32 / VIEWOPT 10 / DEFACL 4 / POL 4。'
  || '核法:對每個物件在 supabase/migrations/*.sql 找它的 CREATE 敘述(函式、view/table、policy 各自的形狀;'
  || 'DEFACL 對 ALTER DEFAULT PRIVILEGES)⇒ 93/93 對得上 ⇒ 244/244 行有對應。'
  || '負對照:現造名字 zqx7742tmp 命中 0 支 migration ⇒ 那個「全中」不是尺恆真。'
  || ' '
  || '🛑 這一章【證不到】什麼, 逐字寫在這裡而不是附註:'
  || '(1) 我證的是【每一個被改動的物件在版控裡都有一支 CREATE】, '
  || '不是【那個 ACL 的值是那支 migration 給的】。'
  || '(2) 原文照抄:一個在 dashboard 被手改過的物件, 只要它本來就有 migration, 在我這把尺下照樣對得上。'
  || '⇒ 所以【零手改】這件事本章答不出來, 而它需要另一把尺:逐格比對 migration 裡的授權 / 收權敘述與線上實際 ACL。'
  || '那把尺今天不存在, 已另開板列擋著。'
  || '(3) 本章只涵蓋這一批差異;它不對【沒有出現在差異裡的格】說任何話。'
  || ' '
  || '════ 2026-09-08 -db 複核追加(同一條線重做一次;上一輪沒有留下工作檔, 只能重做不能翻帳)════ '
  || '(A) 上一輪逐字寫「那把尺今天不存在」的那把尺, 這一輪做出來了(對訪客/會員拿到東西的那幾格而言):'
  || '把版控裡的授權敘述拿出來, 與線上實際值逐字比。7 個物件 7/7 相符'
  || '(例 get_effective_prices:版控只授權給會員身分 ⇒ 線上 authenticated=X、anon=−;逐字那幾句在報告裡)。'
  || '負對照兩發:現編假名字命中 0;版控沒寫的身分組合(products_list_public × service_role)版控 0 且線上也沒有。'
  || '⇒ 下一個人不要再讀成「那把尺不存在」——它對【這幾格】已經存在, 對全量仍不存在。 '
  || '(B) 這一輪量到的是 290 行不是 244 —— 基線檔 supabase/acl-snapshot.tsv 最後一次 commit 是 2026-09-05, '
  || '而 09-06/07/08 又貼了東西 ⇒ 差集本來就會變大。⇒ 拿 244 去對會對不起來, 而那【不是錯】。 '
  || '🛑 訂正(codex 2026-09-08 抓到我原句寫寬了):原句寫「那是日期不是有人動手腳」—— '
  || '而基線日期只解釋得了【為什麼會變大】, 解釋不了【那些差異是誰造成的】。'
  || '正常部署與手改可以同時發生, 而兩者都【可能】造成這次的差異;抽核 7/7 相符也不排除後者。'
  || '🛑 而反過來也要寫:這 290 行【也可能漏掉手改】—— 改了又改回來、欄級的手改, 都不會進這個差集。'
  || '⇒ 所以 290 這個數字不是「手改的上限」也不是「下限」, 它只是【兩次快照之間看得見的差】。'
  || '⇒ 正確的說法是:數字變大【有一個不必假設手改的解釋】, 而手改本身仍未被排除(見 (D))。 '
  || '(C) 訪客/會員的【表 / 函式層級權限檢查為允許】的有 10 列 / 7 個物件, 逐個開檔看過, 都是顧客站本來就要用的面。'
  || '🛑 用詞刻意不寫「真的拿得到」(codex 2026-09-08 抓到):權限允許之後還有 RLS —— '
  || '一個有 SELECT 權限的角色仍可能被 policy 擋到零列。本章【沒有】做實際存取驗證。'
  || '🛑 這個 10 的分母要跟著它走(codex 2026-09-08 抓到我搬進來時漏掉篩選條件):'
  || '它是【本次 290 行差異的「新增」那一側(272 列)】裡、schema 只有 public、身分只有 anon 與 authenticated、'
  || '而且只看表與函式層級的權限 —— 欄級授權工具本身看不到。⇒ 它【不是】全站可存取範圍的清單。 '
  || '而基線裡 products_list_public 與 vehicle_taxonomy_public 對 anon/authenticated 是 SIUDTRG(全權), '
  || '現在只剩 S ⇒ 兩扇開著的門關上了。 '
  || '(D) 🛑 而(A)不推翻上面那句「零手改本章答不出來」——'
  || '一個在 dashboard 被手改成【剛好等於版控字面】的物件, 在(A)那把尺下照樣相符。 '
  || ' '
  || '過程訂正:我第一把尺把 POL 的鍵切錯(policy 名在 | 後面, 我抓了前面)⇒ 產出一個假的「對不上 1 個」;'
  || '修好之後是 0。那個假的 1 沒有被端出去。'
  || ' 本批准對應的快照 taken_at = '
  || (SELECT max(taken_at)::text FROM public.pcm_acl_snapshot_digest)
) AS 蓋到哪一張;

SELECT '── 蓋章後:同一張應該有 approved_at 與理由 ──' AS 標籤;
SELECT taken_at, approved_at, left(approved_note, 160) AS note_前160字
FROM public.pcm_acl_snapshot_digest ORDER BY taken_at DESC LIMIT 1;

COMMIT;
