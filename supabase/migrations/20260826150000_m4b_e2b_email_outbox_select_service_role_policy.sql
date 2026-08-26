-- ============================================================================
-- M-4b · 片 2 · email_outbox 補一條 service_role 讀得到的 SELECT 政策
--
-- ══ 為什麼是這一張表先做(排序依據是量出來的, 不是直覺)═══════════════════════
-- Sean 2026-08-26 拍【乙】(逐字「依照推薦」):先裝守門擋住第 43 張, 再補既有那 42 張。
-- 守門已落地 `d00c8523`(`.husky/rls-service-role-policy-gate.sh`)。本片是【補】的第一片。
--
-- 而 42 張裡先做這一張, 理由是 b4 2026-08-26 量到的一格, 它與直覺【相反】:
--   `email_outbox`  後台【零支檔】在讀它 ⇒ 拿掉 BYPASSRLS 那天, **信不寄, 而每一頁都是綠的**
--     🔴 這句話 cf 2026-08-26 獨立重數過, 而**它順便量到產這句話的尺比這句話窄**:
--        `apps/admin` 掃 `email_outbox`(蛇底線)⇒ 0 支;`EmailOutbox`(駝峰)⇒ 1 支;
--        `outbox`(不分大小寫)⇒ 2 支 ⇒ **逐行開出來看, 那 2 支都是註解、零讀取。**
--        (正對照 `createSupabaseServiceClient` ⇒ 28 支;負對照 ⇒ 0)
--        ⇒ 結論成立, **而只用蛇底線那把尺會印 0, 而那個 0 有兩支檔它看不見。
--          這次是註解, 下次未必。**
--   orders / customers / shipments / shipment_items  後台畫面也直讀
--     ⇒ 員工會叫 ⇒ 有人修 ⇒ 信跟著好了
-- 📌 **同時被畫面用到反而是保護 —— 一個只有背景在用的表, 沒有人替它叫。**
--
-- ⇒ 那四張併片 3。本片**只做 email_outbox 一張**。
--
-- ══ 今天為什麼不爆 ═════════════════════════════════════════════════════════
-- `20260717020000_m4a_email_outbox.sql:388` 開了 RLS, `:391` REVOKE、`:396` GRANT,
-- 而**全 `supabase/migrations/` 對這張表的 `CREATE POLICY` 命中 = 0**
-- (數法:對每一支含 `create policy` 的檔問「有沒有 `on (public.)?email_outbox`」;負對照餵
--  `zzz_nosuch_tbl` ⇒ 零命中)。
-- ⇒ 它今天讀得到, 靠的是 `service_role` 帶 **BYPASSRLS** —— 那是【平台角色屬性】,
--   repo 內零行宣告、零行檢查。**這張表是「靠平台特權活著」, 不是「被政策允許」。**
--
-- 讀它的是誰(當場查, 不是憑印象):
--   `apps/storefront/src/lib/email/composition.ts:100 :120`
--     `new SupabaseEmailOutboxAdapter(createSupabaseServiceClient(), …)`
--   同檔 `:9` 逐字:「注入 service_role client(email_outbox 表含 recipient_email=PII、
--                    anon/authenticated 零權限)」
--   入口 = pg_cron `pcm-email-sweep`(`*/5`)⇒ `/api/cron/email-sweep`
--   ⇒ 拿掉 BYPASSRLS ⇒ sweeper 讀回 0 列 ⇒ 信停在 outbox 裡。
--   ⚠️ codex nit 8:~~「而 route 照樣回 200」~~ **那不是全稱。** enqueue 的 INSERT 被 RLS 擋掉時
--     `errors>0` ⇒ `route.ts:320-332` 會回 **503**。只有「enqueue 被跳過或沒有候選, 而 sweeper
--     單純讀回零列」那一支才會 200。**兩個世界都存在, 不要只寫一個。**
--
-- 🔴 而【只補 SELECT 救不了它】(codex must-fix 4, 我當場數過 adapter):
--   `.insert(` × 1(`:273` enqueue)· `.update(` × 3(`:384` CAS 認領 / `:453` / `:487` 回收)
--   ⇒ 只補 SELECT ⇒ 讀得到、**認領不了、也寫不進去** ⇒ **信照樣寄不出去。**
--   ⇒ 本片補【三條】(select / insert / update), 與 `20260717020000:396` 的 GRANT 面對齊。
--    🔴 **沒有 DELETE, 而那是刻意的不是漏的** —— `20260717020000:394` 逐字:
--      「不給 DELETE(清理 job = backlog `#281`, 走 owner);TRUNCATE/REFERENCES/TRIGGER 亦零。」
--      `:396` 的 GRANT 面正是 `INSERT, SELECT, UPDATE` ⇒ **三條政策與 GRANT 面完全對齊, 不多不少。**
--      ⇒ **加第四條會是憑空擴權**(GRANT 沒給 DELETE 而政策卻允許)。
--      這一句寫在這裡, 是因為**下一個人會覺得少了一條**。
--      分母:cf 2026-08-26 另掃三支 scanner adapter, `insert/update/upsert/delete` 全部 0
--            ⇒ **寫入面只有 SupabaseEmailOutboxAdapter 這一支。**
--
-- ══ 「不擴權」這句話的【時態】════════════════════════════════════════════════
-- 🔴 **codex 與 cf 兩輪獨立審查都命中同一格 ⇒ 它是真的:**
--    ~~「本政策不擴權」~~ **那句話沒有時態, 而它只對【apply 當下存在的角色】成立。**
--    cf 實測:一個在本片 apply 【之後】才被 `GRANT service_role` 的角色 ——
--      有這條政策 ⇒ **實讀 1 列, 含 `recipient_email`(PII)**
--      砍掉這條政策 ⇒ **0 列**
--    ⇒ **那條政策就是它看得到的原因。而段A 只在 apply 當下量一次, 之後不會再跑、零訊號。**
--    📌 **一句沒有時態的安全宣稱, 會在它不再成立的那天, 還印著同一行字。**
-- ⇒ 正確的字面:**對 apply 當下存在的角色不擴權;之後被授予 `service_role` 的角色,
--   會直接取得這張表的全表讀寫, 含 `recipient_email`。**
-- `service_role` 今天已經看得到這張表的全部 row。本片把「靠平台特權拿到的可見範圍」
-- 原樣寫成顯性政策。它擋的是**未來有人拿掉 BYPASSRLS** 那一發。
-- 外溢面(2026-08-26 正式庫實測, Sean 本人在 SQL Editor 跑):
--   誰有效繼承 `service_role` ⇒ **只有 `postgres`, 而它自己也帶 BYPASSRLS** ⇒ 零外溢路徑。
--   ⚠️ 那是**當天的**量測。段A 會在 apply 的當下【重新量一次】, 不吃這句轉述。
--
-- ══ 🔴 本片【沒有】關掉什麼(不要讀成 Q15 解決了)═══════════════════════════
--   · 正式庫 50 張開了 RLS 的表裡 42 張缺這條政策。**本片補 1 張, 還剩 41 張。**
--   · 兩張 repo 完全不認識的野生表(`product_fitments_effective_staging` / `_sync_log`)
--     不在本片射程, 它們沒有建表 migration(來源 = 2026-07-12 那份手貼 SQL, b4 2026-08-26 定位)
--   · 那 10 張金流表走 `PAYMENT_CONFIRMER_DB_URL` 不是 service_role
--     ⇒ **Q15 拿掉 BYPASSRLS 對它們完全無效**, 它們不屬於這條線(cf 逐張核 5/9 成立、4 張未證)
--   · 本片不看 `USING` 內容、不處理 SECURITY DEFINER、只碰 `public` schema
--
-- ══ 八個世界都表演過(2026-08-26, 本機拋棄式 PostgreSQL 17.10 Homebrew, 每發全新 DB)═══
--   世界                                    rc  紅在      怎麼造出來的
--   甲 三條政策都對                          0  —         原檔
--   乙 SELECT 那條給錯角色                   3  段C ④     改段B
--   丙 SELECT 那條 USING (false)             3  段C ⑤     改段B
--   丁 少建 INSERT 那條                      3  段C ①     改段B
--   戊 UPDATE 那條 WITH CHECK (false)        3  段C ⑥     改段B
--   己 有 RESTRICTIVE 也套到 service_role     3  段C ⑦     改前置 SQL
--   庚 GRANT 被拿掉                          3  段C ⑧     改前置 SQL
--   辛 有人 INHERIT 繼承 service_role         3  段A       改前置 SQL
-- 🔴 **「怎麼造出來的」那一欄是 cf 逼出來的**(它的 F3):前五個世界要【改段B 才造得出來】
--    ⇒ **它們證的是「斷言有判別力」, 不是「這支檔有八種失效模式」。**
--    後三個是真的可達的(別人建 restrictive / 有人 REVOKE / 有人 GRANT service_role)。
--    📌 一張只列「世界 ⇒ rc」的表, 讀起來像後者。**那一欄不加, 這張表就是一句誇大。**
--
-- 🔴 **比的是【哪一格紅】, 不只是 rc** —— 而這一輪它救了我三次:
--   ① 第一發八個世界:甲該綠而 rc=3 ⇒ 查下去是 `record "r" has no field "qual"`
--      (`SELECT … coalesce(p.qual,'') INTO r` 沒給欄位別名)
--      ⇒ **其餘六個「紅」全是同一個語法錯, 一個都不是我要測的那格。**
--        **只看 rc 的話, 那一發會被判成 7/8 通過。**
--   ② 世界丁第一發 rc=3 而它死在 `COMMENT ON POLICY`(政策被我刪了而註解還在)⇒ 沒跑到斷言
--   ③ 上一版世界零同款;而第二次還踩到【角色是叢集層級的, 換 DB 不會消失】
--   📌 **三次都是「rc 對而理由錯」。rc 非 0 只說明有東西紅了, 不說明是我要測的那一格紅了。**
--
-- 判別力(把段C 整段拔掉, 再餵該紅的世界庚)
--   有段C ⇒ rc=3    無段C ⇒ **rc=0 靜靜通過** ⇒ 段C 不是裝飾。
--
-- 🔴🔴 **跑這套一定要帶 `-v ON_ERROR_STOP=1`**(b4 2026-08-26 警告, 我當場複現):
--      同一個該紅的世界, 不加 ⇒ **rc=0 全綠**, 而畫面上明明有 1 行 ERROR;加了 ⇒ rc=3。
--      📌 **psql 預設吞掉 SQL 錯誤的 rc ⇒ 看畫面的人會發現, 看 rc 的不會。**
--
-- ══ rollback ═══════════════════════════════════════════════════════════════
--   DROP POLICY IF EXISTS email_outbox_update_service_role ON public.email_outbox;
--   DROP POLICY IF EXISTS email_outbox_insert_service_role ON public.email_outbox;
--   DROP POLICY IF EXISTS email_outbox_select_service_role ON public.email_outbox;
--   零資料異動、零欄位異動;`DROP POLICY` 一併移除它的 COMMENT。
--   ⚠️ **回滾 = 退回「靠平台特權」那個狀態, 不是退回更安全的狀態。**
--   🔴 **三條要一起回滾** —— 留一條 SELECT 而沒有 UPDATE, 就是「讀得到而認領不了」那個世界。
--
-- ⚠️ 效度限制(不放寬)
--   · 本機 PG 17.10 ≠ Supabase 線上版本(**未確認**)
--   · fixture 的 email_outbox 只有三欄, 不是真表 ⇒ 它證的是【這套斷言分不分得開八個世界】,
--     不證正式庫的行為
--   · **沒有測 pooled 連線**(memory 記著 pooled `SET ROLE` 另有坑)
--   · 收攤已驗:pgrep 0 / 資料目錄與 socket 皆已刪(正對照 pgrep node ⇒ 127 ⇒ 尺是活的)
--
-- ══ 兩輪獨立對抗審查(2026-08-26)══════════════════════════════════════════════
--   codex(`-s read-only`)  FAIL · 7 must-fix / 2 nit
--   cf(`pcm-website-v2-d8`)1 must-fix / 5 nit, **零筆假放行**, 全部用本機拋棄式 PG 實測
-- 🔴 **兩輪各自都抓到對方沒抓到的, 而重疊只有一條**(「不擴權」沒有時態)——
--    **那一條兩輪都命中 ⇒ 它是真的。**
--   codex 抓到而 cf 沒有:**只補 SELECT 救不了它宣稱要救的東西**(最重的一條)
--   cf 抓到而 codex 沒有:**段A 的正對照恆為 true, 沒有走到它要保護的那條路**
-- 📌 cf 自己的檢討逐字:「我五個方向都在打【這條政策對不對】,
--    沒有一個方向去問【該補的是不是只有一條】—— 派工單問的是前者,
--    而**射程是我可以自己擴的, 我沒擴**。」
--    ⇒ 交辦的軸不是邊界。這一格對下一個派工的人比對審查的人更有用。
-- ⚠️ 兩輪都**沒有在正式庫跑過任何東西**;cf 的地面真相是本機 PG, 與線上版本未覆核。
-- ⚠️ 也都**沒有測 pooled 連線**(memory 記著 pooled `SET ROLE` 另有坑)。
--
BEGIN;

-- ── 段A · fail-closed 角色閘 ────────────────────────────────────────────────
-- 在 apply 的當下重新量一次「還有誰拿得到 service_role 的東西」。
-- 🔴 codex 2026-08-26 must-fix 2:**`MEMBER` 不是暴露判準。** PG 16+ 有三種問法:
--      USAGE  = 有效繼承(吃每一筆 membership 的 inherit_option)
--      SET    = 可不可以 `SET ROLE service_role`
--      MEMBER = 只代表是成員, **兩件事都不保證**
--    `INHERIT FALSE, SET FALSE` 的成員 ⇒ USAGE=f / SET=f / MEMBER=t
--    ⇒ 它其實【拿不到任何東西】, 而舊版用 MEMBER 當判準會擋下它 ⇒ **誤擋。**
--    ⇒ 判準 = `USAGE OR SET`;MEMBER 只印出來當診斷欄。
-- 🔴 而 cf F-B3-2 當初指出「只問 USAGE 會漏掉 NOINHERIT 成員」也是對的 ——
--    **它漏的那一格正是 `SET`, 不是 `MEMBER`。兩個 finding 指向同一個洞, 而只有一個給對了名字。**
-- 🔴 codex must-fix 3:~~無條件排除 table owner~~ **那在 FORCE ROW LEVEL SECURITY 之下是漏擋** ——
--    owner 平常繞得過 RLS(所以排除它站得住), 而 `relforcerowsecurity=true` 時 owner 也受 RLS 管
--    ⇒ 那時本片的政策會讓 owner 從看不到變成看得到全部。⇒ 只有 FORCE 關著時才排除 owner。
DO $$
DECLARE
  v_pos     boolean;
  v_neg     boolean;
  v_extra   text;
  v_owner   oid;
  v_force   boolean;
  v_has_set boolean := current_setting('server_version_num')::int >= 160000;
  v_members int;
  v_seen    int;
BEGIN
  -- 🔴 cf 2026-08-26 F2:~~正對照用 `pg_has_role('service_role','service_role','USAGE')`~~
  --    **那個恆為 true, 它沒有走到它要保護的那條路。**
  --    cf 實測:把 service_role 的 `pg_auth_members` 列數【從 5 清成 0】, 它仍回 `t`
  --    ⇒ 一把「membership 查詢整個壞掉」的尺, 這個正對照照樣放行,
  --      而底下的枚舉回空 ⇒ 印成「✅ 零個」。
  --    📌 **正對照必須用到與正題【同一批機制】** —— 正題問的是 membership, 那正對照也要問 membership。
  --    ⇒ 改成:pg_auth_members 裡每一個 service_role 的成員, pg_has_role 都要認得它。
  --      認不得 ⇒ 兩張表對不起來 ⇒ 尺壞了。
  --      而 pg_auth_members 真的零列時, 「零個成員」本來就是對的答案 ⇒ 那不是尺壞。
  SELECT count(*) INTO v_members
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles gr ON gr.oid = m.roleid
   WHERE gr.rolname = 'service_role';
  SELECT count(*) INTO v_seen
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles gr ON gr.oid = m.roleid
    JOIN pg_catalog.pg_roles mr ON mr.oid = m.member
   WHERE gr.rolname = 'service_role'
     AND pg_catalog.pg_has_role(mr.rolname, 'service_role', 'MEMBER');
  IF v_members <> v_seen THEN
    RAISE EXCEPTION '片2 段A 正對照失敗:pg_auth_members 記 % 個 service_role 的成員, 而 pg_has_role 只認得 % 個 ⇒ 兩張表對不起來, 這把尺不可信, 底下的枚舉作廢', v_members, v_seen;
  END IF;
  -- ⚠️ 而 v_members = 0 時上面那格恆等 ⇒ 它證不到東西。那不是缺陷:
  --    真的零個成員時, 「枚舉回空」本來就是正確答案。**這一格的誠實射程要寫在這裡。**
  SELECT pg_catalog.pg_has_role('pg_signal_backend', 'service_role', 'USAGE') INTO v_neg;
  IF v_neg IS DISTINCT FROM false THEN
    RAISE EXCEPTION '片2 段A 負對照失敗:pg_signal_backend 對 service_role 回 % ⇒ 這把尺會無中生有', v_neg;
  END IF;
  IF NOT v_has_set THEN
    RAISE EXCEPTION '片2 段A:server_version_num = % < 160000 ⇒ pg_has_role 沒有 SET 模式 ⇒ 本閘對「可否 SET ROLE」沒有判斷力, 擋下(fail-closed)', current_setting('server_version_num');
  END IF;

  SELECT c.relowner, c.relforcerowsecurity INTO v_owner, v_force
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'email_outbox';
  IF v_owner IS NULL THEN
    RAISE EXCEPTION '片2 段A:找不到 public.email_outbox ⇒ 本片對這個庫沒有判斷力, 擋下';
  END IF;

  SELECT coalesce(pg_catalog.string_agg(
           r.rolname || ' (USAGE=' || pg_catalog.pg_has_role(r.rolname, 'service_role', 'USAGE')::text
                     || ' SET='    || pg_catalog.pg_has_role(r.rolname, 'service_role', 'SET')::text
                     || ' MEMBER=' || pg_catalog.pg_has_role(r.rolname, 'service_role', 'MEMBER')::text || ')',
           ', ' ORDER BY r.rolname), '')
    INTO v_extra
    FROM pg_catalog.pg_roles r
   WHERE r.rolname <> 'service_role'
     AND NOT r.rolsuper
     AND NOT r.rolbypassrls
     -- 🔴 只有 FORCE 關著時, owner 才真的繞得過 RLS ⇒ 才排除得起
     AND NOT (r.oid = v_owner AND NOT v_force)
     AND (pg_catalog.pg_has_role(r.rolname, 'service_role', 'USAGE')
       OR pg_catalog.pg_has_role(r.rolname, 'service_role', 'SET'));

  IF v_extra <> '' THEN
    RAISE EXCEPTION E'片2 段A 擋下, 本片沒有 apply(整筆已回滾, 資料庫沒有任何改變)。\n'
      '這些角色拿得到 service_role 的東西:[%]\n'
      '(FORCE ROW LEVEL SECURITY = % ⇒ 它決定 table owner 算不算在裡面)\n'
      '⇒ 本片的政策會一起套到它們。這【可能】是真暴露, 也【可能】是假紅。\n'
      '⇒ 分得開的查詢, 直接複製這一段跑:\n'
      '     SELECT r.rolname, r.rolbypassrls AS 自己就繞得過RLS,\n'
      '            r.oid = c.relowner AS 是這張表的owner, c.relforcerowsecurity AS owner也受RLS管,\n'
      '            pg_catalog.pg_has_role(r.rolname,''service_role'',''USAGE'') AS 有效繼承,\n'
      '            pg_catalog.pg_has_role(r.rolname,''service_role'',''SET'')   AS 可切換過去\n'
      '       FROM pg_catalog.pg_roles r\n'
      '       CROSS JOIN (SELECT c2.relowner, c2.relforcerowsecurity FROM pg_catalog.pg_class c2\n'
      '                     JOIN pg_catalog.pg_namespace n2 ON n2.oid = c2.relnamespace\n'
      '                    WHERE n2.nspname=''public'' AND c2.relname=''email_outbox'') c\n'
      '      WHERE r.rolname <> ''service_role'';\n'
      '⇒ rolbypassrls=true 是假紅;是 owner 而 owner也受RLS管=false 也是假紅。\n'
      '  其餘 = 🔴 真的多一個看得到的人。',
      v_extra, v_force;
  END IF;
END $$;

-- ── 段B · 政策本體(三條, 不是一條)──────────────────────────────────────────
-- 🔴 codex must-fix 4:~~只補 SELECT~~ **那救不了它宣稱要救的東西。**
--    `SupabaseEmailOutboxAdapter` 實際做的動作(當場數的):
--      `.insert(` × 1(`:273` enqueue)· `.update(` × 3(`:384` CAS 認領 / `:453` / `:487` 回收)
--      `.select(` × 6
--    ⇒ 只補 SELECT ⇒ 拿掉 BYPASSRLS 之後:讀得到、**認領不了、也寫不進去**
--      ⇒ 信照樣寄不出去, 而我原本的檔頭宣稱它擋得住那一發 —— **那句是假的。**
--    ⇒ 三條都補。GRANT 那一側本來就是 INSERT/SELECT/UPDATE(`20260717020000:396`),
--      **政策面與 GRANT 面對齊**(理由見檔頭)。
CREATE POLICY email_outbox_select_service_role ON public.email_outbox
  FOR SELECT TO service_role
  USING (true);

CREATE POLICY email_outbox_insert_service_role ON public.email_outbox
  FOR INSERT TO service_role
  WITH CHECK (true);

CREATE POLICY email_outbox_update_service_role ON public.email_outbox
  FOR UPDATE TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON POLICY email_outbox_select_service_role ON public.email_outbox IS
  'M-4b 片2(Sean 2026-08-26 拍乙):把 sweeper 對 email_outbox 的讀取寫成顯性政策。'
  '在此之前這條路徑靠 service_role 的 BYPASSRLS —— 那是平台角色屬性、repo 內無法驗證。'
  '🔴 三條政策(select/insert/update)是一組, 缺一條就等於沒補:'
  'adapter 讀完要 CAS 認領(update)、enqueue 要 insert。只補 select ⇒ 讀得到而認領不了。'
  '🔴 【apply 當下】不擴權, 而那不是永久保證 —— 之後有人 GRANT service_role 給別人,'
  '這條政策會一起套到他, 而段A 不會重跑、沒有任何訊號。'
  '🔴 它沒有關掉同族問題:正式庫 42 張缺政策, 本片補 1 張。';

COMMENT ON POLICY email_outbox_insert_service_role ON public.email_outbox IS
  'M-4b 片2:enqueue 那一側(SupabaseEmailOutboxAdapter:273)。與 select/update 兩條是一組。';

COMMENT ON POLICY email_outbox_update_service_role ON public.email_outbox IS
  'M-4b 片2:CAS 認領與回收那一側(SupabaseEmailOutboxAdapter:384 :453 :487)。與 select/insert 兩條是一組。';

-- ── 段C · 逐條逐項驗 ────────────────────────────────────────────────────────
-- 🔴 codex must-fix 5:~~只問「有沒有一條 permissive SELECT 政策」~~
--    ⇒ 把本片的政策改成 `USING (false)` 時, 五格【全部通過】而實讀永遠零列。
--    ⇒ 改成【對具名的那三條逐項驗】:cmd / permissive / roles 恰為 {service_role} / qual 與 with_check。
--    而 `v_roles LIKE '%service_role%'` 也不是精確比對(`not_service_role` 會通過)⇒ 改成陣列相等。
DO $$
DECLARE
  r        record;
  n_restr  int;
  n_hit    int := 0;
  expect   text[][] := ARRAY[
    ARRAY['email_outbox_select_service_role', 'SELECT', 'true', ''],
    ARRAY['email_outbox_insert_service_role', 'INSERT', '',     'true'],
    ARRAY['email_outbox_update_service_role', 'UPDATE', 'true', 'true']
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(expect, 1) LOOP
    SELECT p.cmd AS cmd, p.permissive AS permissive, p.roles AS roles,
           coalesce(p.qual, '') AS qual, coalesce(p.with_check, '') AS with_check
      INTO r
      FROM pg_catalog.pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename = 'email_outbox'
       AND p.policyname = expect[i][1];
    IF NOT FOUND THEN
      RAISE EXCEPTION '片2 段C ①:查不到政策 % ⇒ CREATE 成功了而 catalog 撈不到, 兩者不一致', expect[i][1];
    END IF;
    IF r.permissive <> 'PERMISSIVE' THEN
      RAISE EXCEPTION '片2 段C ②:% 是 % 不是 PERMISSIVE ⇒ 它不給權, 只會再收緊', expect[i][1], r.permissive;
    END IF;
    IF r.cmd <> expect[i][2] THEN
      RAISE EXCEPTION '片2 段C ③:% 的 cmd 是 % 而不是 % ⇒ 哪一項不對 = FOR 子句', expect[i][1], r.cmd, expect[i][2];
    END IF;
    IF r.roles <> ARRAY['service_role']::name[] THEN
      RAISE EXCEPTION '片2 段C ④:% 的 roles 是 [%] 而不是恰好 {service_role} ⇒ 哪一項不對 = TO 子句',
        expect[i][1], array_to_string(r.roles, ',');
    END IF;
    -- 🔴 這一格是 codex must-fix 5 的核心:`USING (false)` 過得了前四格, 過不了這一格。
    IF coalesce(r.qual, '') <> expect[i][3] THEN
      RAISE EXCEPTION '片2 段C ⑤:% 的 USING 是 [%] 而不是 [%] ⇒ 政策在、角色對, 而它【看不到任何一列】',
        expect[i][1], coalesce(r.qual, '(無)'), coalesce(nullif(expect[i][3], ''), '(無)');
    END IF;
    IF coalesce(r.with_check, '') <> expect[i][4] THEN
      RAISE EXCEPTION '片2 段C ⑥:% 的 WITH CHECK 是 [%] 而不是 [%] ⇒ 讀得到而寫不進去',
        expect[i][1], coalesce(r.with_check, '(無)'), coalesce(nullif(expect[i][4], ''), '(無)');
    END IF;
    n_hit := n_hit + 1;
  END LOOP;
  IF n_hit <> 3 THEN
    RAISE EXCEPTION '片2 段C:只驗到 % 條而不是 3 條 ⇒ 迴圈本身壞了', n_hit;
  END IF;

  -- ⑦ 有沒有 RESTRICTIVE 也套到 service_role
  -- 🔴 codex nit 9:~~一律說「掐死」~~ —— `AS RESTRICTIVE USING (true)` 什麼都不擋。
  --    ⇒ 保守擋下, 而訊息改成「可能縮限, 本片沒有檢查它的 qual」, 不下結論。
  SELECT count(*) INTO n_restr
    FROM pg_catalog.pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename = 'email_outbox'
     AND p.permissive = 'RESTRICTIVE'
     AND p.cmd IN ('SELECT', 'INSERT', 'UPDATE', 'ALL')
     AND ('service_role' = ANY (p.roles) OR 'public' = ANY (p.roles));
  IF n_restr > 0 THEN
    RAISE EXCEPTION '片2 段C ⑦:有 % 條 RESTRICTIVE 政策也套到 service_role ⇒ 本片的 permissive 三條是對的, 而它們【可能】被縮限。本片沒有檢查那幾條的 qual ⇒ 請人工看一眼再決定', n_restr;
  END IF;

  -- ⑧ GRANT 那一層 —— 它塌掉的長相是【報錯】不是【空的】
  -- 🔴 codex must-fix 6:~~information_schema.role_table_grants~~ **它依執行者的 enabled role 過濾**
  --    ⇒ 有效 GRANT 還在而那一列被藏起來 ⇒ 誤擋。改用 has_table_privilege 直接問有效權限。
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.email_outbox', 'SELECT') THEN
    RAISE EXCEPTION '片2 段C ⑧:service_role 對 email_outbox 沒有 SELECT 的有效權限 ⇒ GRANT 層塌, 線上長相是【報錯】不是【空的】';
  END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.email_outbox', 'INSERT') THEN
    RAISE EXCEPTION '片2 段C ⑧:service_role 對 email_outbox 沒有 INSERT 的有效權限 ⇒ enqueue 會報錯';
  END IF;
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.email_outbox', 'UPDATE') THEN
    RAISE EXCEPTION '片2 段C ⑧:service_role 對 email_outbox 沒有 UPDATE 的有效權限 ⇒ CAS 認領會報錯';
  END IF;

  -- ⑨ 尺自檢:負對照。少了這一格, 一把【接錯表、對任何東西都回空】的尺會讓上面全部「通過」。
  IF (SELECT count(*) FROM pg_catalog.pg_policies
       WHERE schemaname = 'public' AND tablename = 'email_outbox'
         AND policyname = 'zzz_no_such_policy_20260826') <> 0 THEN
    RAISE EXCEPTION '片2 段C ⑨ 負對照失敗:查一條不存在的政策名而回了非 0 ⇒ 這把尺會無中生有, 上面全部作廢';
  END IF;

  RAISE NOTICE '片2 PASS:三條政策逐項驗過(cmd / permissive / roles 恰為 {service_role} / qual / with_check), RESTRICTIVE 0 條, service_role 的 SELECT+INSERT+UPDATE 有效權限都在';
END $$;

COMMIT;
