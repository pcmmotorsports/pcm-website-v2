-- ============================================================
-- M-4b E10 · `#27` 片 D0:`admin_audit_log` 開放 `SELECT`(稽核紀錄檢視的硬前置)
-- ============================================================
-- 片級 plan:docs/specs/2026-08-14-27-audit-log-viewer-plan.md
-- 建表 = 20260712210000_m4a_admin_audit_log.sql;本支**取代它 §4 的「最小權限」意圖**中
-- 「不給 SELECT」那一半,**其餘一律不動**(append-only 仍舊、client 仍全鎖)。
-- 🔴 建表當天就預告了這一片:`20260712210000:88` 逐字
--    「不給 SELECT(最小權限;**稽核 viewer slice 才顯式 GRANT SELECT TO service_role**)」。
--
-- ── 🔴🔴 外部前提(**不是本 migration 能證明的事實**)────────────────────
--   catalog 證明不了下面三段。寫在這裡是讓讀的人知道「這個 GRANT 為什麼被允許」,
--   **不得把它們當成本支驗證過的結論**:
--   [1 · Sean 2026-08-15 知情後拍板 `Q-D1b = A`]
--     正當性建立在「後台目前只有 Sean 一人測試、員工未上工」。
--     **員工真正上工之前,`#26` 真認證必須先落地** —— 否則自選身分的人讀得到經銷價 / 成本 / PII。
--     🔴 **不得轉述成「已評估安全」。它不是安全,它是「現在還沒有人會受害」。**
--     ⇒ 掛成 `#26` 的**下游相依**;前提失效 ⇒ **回頭重估,不是「寫完就算」**。
--   [2] 開 SELECT 後讀取邊界改由 **admin 登入閘**承擔;而 `apps/admin/src/lib/session/actor.ts:6-7`
--     **自陳登入身分非授權邊界**(`#26`)。
--   [3] 本表寫入端 = 18 支 SECURITY DEFINER RPC + app 層 1 處(plan §1 的數法)。
--     誤撤 INSERT 的後果落在應用層,**本支只能斷言 ACL 狀態、不能斷言那個後果**。
--
-- ── 為什麼只加 SELECT、一個字都不多 ────────────────────────
--   本表的 **append-only 由 GRANT 撐**。⇒ **ACL 在這裡是承重牆,不是配置。**
--   ⚠️ **本片不改變這件事** —— 開 SELECT 之後 append-only 仍然只靠 GRANT。
--   🔴 **「表上零 trigger」以前只是 repo 字面,現在由 §2i 當場驗**(codex R2 MF1)。
--
-- ── forward-only ────────────────────────────────────────
--   `20260712210000` 的 `DO $$` 是 **apply 那一刻**的檢查、只跑一次 ⇒ 新舊終態無執行期矛盾;
--   編輯已 apply 的 migration = 改歷史,明文禁止。本支寫**自己的**斷言陳述**新終態**。
--
-- ── 🔴 RAISE 訊息紀律(codex R2 MF3)──────────────────────
--   **每一句 RAISE 只能講「它自己那一格當下已經驗過的東西」。**
--   不得在訊息裡順帶宣稱一個**後面才驗**的狀態 —— 那是假字面,而**錯誤訊息也是載體**。
--   ⇒ 本版把 RLS/policy 的檢查**移到最前面(2a)**,後面的訊息才引用得起它。
--
-- ── codex 折法紀錄 ──────────────────────────────────────
--   [R1-f1] 補 BYPASSRLS 斷言(現 2b/2c)。[R1-f2] 原「GRANT 後 has_table_privilege(SELECT)」恆真格,已刪;
--   `service_role` 的 SELECT 由 **2g 攤平字串**釘住(R2 N1 更正:先前寫「併入 2a + 2e」是錯的)。
--   [R1-f3] 欄級改數**實際 privilege**(現 2h)。[R1-f4] 刪 `role_table_grants` 計數(與 2g 重複、受 grantor 可見性影響)。
--   [R1-f5] 因果宣稱移入「外部前提」。
--   [R2-MF1] **新增 2i:非內部 trigger 必須為 0** —— 實測:掛一支 `AFTER INSERT` trigger 後,
--     舊版八格**全部通過**(`COMMIT`),而檔頭卻宣稱「零 trigger」⇒ 宣稱無守門。
--   [R2-MF2] **新增 MAINTAIN 到 2e/2f,而且版本感知** —— 實測 PG 17.10:
--     `GRANT pg_maintain TO service_role` ⇒ `has_table_privilege(…,'MAINTAIN')` = **true**,
--     而 `relacl` 攤平字串**與期望值逐字相同**、2e 原本查的五種**全部 false**
--     ⇒ **兩層都看不到,「應只有 INSERT + SELECT」那句被擊破。**
--     ⚠️ **PG16 以下沒有這個權限名 —— 這句標『未確認』**(R3 N2,三來源律):
--        我**實測到的**只有「PG 17.10 對一個**不存在的權限名**回 `SQLSTATE 22023 unrecognized privilege type`」;
--        **PG16 本體我沒跑過**,「PG16 會對 `MAINTAIN` 回 22023」是**推論不是量測**。
--     ⇒ 硬加會讓本支在舊版 **apply 當下炸掉** ⇒ 用 `server_version_num >= 170000` 開關。
--     🔴 **這剛好把「repo 字面 vs 正式庫事實」從『我不知道』變成『機器自己會知道』。**
--   [R2-MF3] 見上面的 RAISE 訊息紀律。[R2-N1] 交叉引用改成 2g。
--
-- ── 🔴 全檔冪等:本支可以**對正式庫重跑當漂移探針**(R3 C1)───────────────
--   `GRANT SELECT` 對已有該權限的角色是 no-op;`DO $$` 區塊**全部是讀取**(catalog 查詢 + RAISE)。
--   ⇒ **整支重跑不改變任何狀態**,而它會把「apply 之後有人事後 GRANT / 掛 trigger」照樣抓出來。
--   ⇒ runbook 用法:**懷疑漂移時,對正式庫重跑這一支**。全綠 = 當下的 ACL/RLS/trigger 仍是預期終態。
--   ⚠️ **這解掉的是「事後漂移沒人守」,不是「守得住」** —— 它仍然要有人去跑。
--   **冪等性有負控**:`scripts/27-d0-verify.sh` 的**最後一個 case「冪等(連跑兩次)」**——
--   兩次都必須 COMMIT。🔴 **這裡刻意不寫 case 編號**:編號會隨插入 case 漂掉
--   (第一版寫「case 17-18」,補完正控後就變成 25 了)。**用名字指,不用號碼指。**
--
-- ⚠️ **誠實界**:本片作者不碰正式庫。**若正式庫與這裡的期望不一致,下面會 RAISE —— 那是 fail-closed,是對的。**
-- ============================================================

BEGIN;

-- ── 1. 唯一的授權變更 ────────────────────────────────────────
GRANT SELECT ON TABLE public.admin_audit_log TO service_role;

-- ── 2. fail-closed 斷言 ─────────────────────────────────────
DO $$
DECLARE
  v_role  text;
  v_priv  text;
  v_cnt   integer;
  v_txt   text;
  v_privs text[];
BEGIN
  -- 2-pre. 🔴🔴 **三個角色必須存在** —— 這一格是「`malformed array literal` 那個 bug 的同族排查」抓到的
  --   (主視窗 R3 題目之一:那是孤例還是通病?**答案:不是孤例。**)
  --   **實測**:`IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname='nosuchrole')` ——
  --   子查詢回 NULL ⇒ plpgsql 對 `IF NULL` 走 ELSE 分支 ⇒ **整格靜默放行(fail-open)**。
  --   ⇒ 2b/2c 若碰到「角色不存在」會**看起來過了**。`service_role` 有上面那道 GRANT 擋著(角色不存在會先炸),
  --      但 **`anon` / `authenticated` 在本支沒有任何 GRANT 引用它們** ⇒ 那兩格真的會 fail-open。
  --   🔴 **這一格把整族一次收掉**:先證存在,後面的 NULL 就不可能來自「查無此角色」。
  FOREACH v_role IN ARRAY ARRAY['service_role', 'anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      -- 🔴 訊息只講**這一格量到的事實**(角色不存在)。原字面「⋯本支的角色相關斷言會靜默放行」
      --    是在講**別格**的行為,那一格此時還沒跑 ⇒ 同一條 RAISE 訊息紀律(R3 N1 嚴讀,壓線)。
      --    那個 fail-open 的來由留在本格上方的註解裡,不進訊息。
      RAISE EXCEPTION 'D0 異常 — 角色 % 不存在;拒繼續', v_role;
    END IF;
  END LOOP;

  -- 2-obs. 🔴 **一次性觀測,不擋任何東西(主視窗 2026-08-15 裁「丙案」)**
  --   背景:本支用「**列舉權限名**」防繼承來的多餘權限(2e/2f),而那個做法有天花板 ——
  --   **PG18 若再多一個新權限,同一個洞會原樣打開**,症狀與 R2 的 `MAINTAIN` 一模一樣
  --   (兩層都看不到、負控全綠、`COMMIT`)。
  --   機制解 = **查角色成員資格**(不查權限名字)。**實測**:一個查詢同時抓到今晚那兩條繼承路
  --   (`GRANT pg_maintain` 與 `GRANT <owner>`),而且**不依賴任何權限名** ⇒ 新版本加權限也不重開洞。
  --   ⚠️ **但本片作者看不到正式庫,不知道正式庫的期望值該是什麼** ⇒ 寫死「必須零成員」= 拿看不到的東西當期望值,
  --      會在最糟的時刻(Sean 一個人 apply 時)擋住他。**所以這裡只觀測、不判定。**
  --   🔴 **這一格對「防護」的貢獻是零** —— 它的價值完全取決於有沒有人真的把輸出貼回來。
  --      ⇒ 配套:apply 指示逐字要求回報 + backlog **`#505`**(拿到實際拓樸後改成硬斷言)。
  --      **在 `#505` 做完之前,這個洞仍然開著,我們只是終於知道它現在的形狀。**
  FOR v_role, v_txt IN
    SELECT r.rolname,
           coalesce((SELECT string_agg(p.rolname, ', ' ORDER BY p.rolname)
                       FROM pg_catalog.pg_auth_members m
                       JOIN pg_catalog.pg_roles p ON p.oid = m.roleid
                      WHERE m.member = r.oid), '無')
      FROM pg_catalog.pg_roles r
     WHERE r.rolname IN ('service_role', 'anon', 'authenticated')
     ORDER BY r.rolname
  LOOP
    RAISE NOTICE '【要回報】% 目前繼承的角色 = %', v_role, v_txt;
  END LOOP;
  RAISE NOTICE '【要回報】以上三行請整段貼回給 Claude,這是這次 apply 唯一要收的東西。';

  -- 2a. 🔴 **RLS 縱深先驗** —— 排在最前面是刻意的(codex R2 MF3):
  --     後面 2b 的訊息要引用「RLS on + 零 policy」,那就必須**先驗過它**,否則是假字面。
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.admin_audit_log'::regclass) THEN
    RAISE EXCEPTION 'D0 異常 — admin_audit_log 的 RLS 未啟用(建表時的縱深);拒繼續';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_catalog.pg_policy WHERE polrelid = 'public.admin_audit_log'::regclass;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'D0 異常 — admin_audit_log 應為零 policy,實 % 條;拒繼續', v_cnt;
  END IF;

  -- 2b. 🔴🔴 **本片真正的承重前提**:`service_role` 必須有 BYPASSRLS。
  --     上一格已驗過本表是 **RLS on + 零 policy**(所以這句話在這裡是事實,不是宣稱)。
  --     **實測(丟棄庫 PG 17.10)**:有 SELECT 權但無 BYPASSRLS 的角色讀本表回 **0 列**,owner 讀得到 1 列。
  --     ⇒ 少了它,本 migration 會「成功」、所有斷言會過,**而檢視頁永遠是空清單** = 看起來合法的假象。
  IF NOT (SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'D0 異常 — service_role 無 BYPASSRLS,而本表已驗為 RLS 啟用 + 零 policy;拒繼續';
  END IF;

  -- 2c. client 角色**不得**有 BYPASSRLS —— 否則零 policy 的縱深不成立。
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF (SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      RAISE EXCEPTION 'D0 異常 — client 角色 % 有 BYPASSRLS,零 policy 的縱深不成立;拒繼續', v_role;
    END IF;
  END LOOP;

  -- ── 🔴 2d/2e/2f(有效權限層)與 2g(直接授權層)是**兩層不同的東西,不是重複** ──────
  --   · 2d/2e/2f 走 `has_table_privilege` = **有效權限**(**看得到角色繼承**)。
  --   · 2g 走 `pg_class.relacl + aclexplode` = **直接授權**,且明文排除 owner(`a.grantee <> c.relowner`)。
  --   ⇒ **實測兩個只有前者抓得到的例子**:
  --       ① 把 **owner 角色**授予 `service_role` ⇒ 繼承 UPDATE,但 relacl 不長出 `service_role` 列
  --          ⇒ 2g 字串與期望值**逐字相同、通過**,只有 2e 紅。
  --       ② `GRANT pg_maintain TO service_role` ⇒ MAINTAIN 有效權限成立,**relacl 完全看不到**。
  --   ⚠️ 反過來,「多一個 grantee」與「`WITH GRANT OPTION`」只有 2g 抓得到。
  --   🔴 **兩層都要留;而且 ② 證明了「兩層無盲路」是錯的說法** —— 正確說法是
  --      **「兩層互補,而覆蓋面取決於權限清單列得夠不夠全」**(codex R2 擊破的正是前一版那個過大的結論)。
  --   (為什麼寫在這裡:下一個人看到「同一件事查兩次」的第一反應是刪掉一個。**這段就是攔那一下的。**)

  -- 2d. 誤殺正控:INSERT 必須**仍然**在(後果見檔頭外部前提 3;本格只斷言 catalog 狀態)。
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.admin_audit_log', 'INSERT') THEN
    RAISE EXCEPTION 'D0 異常 — service_role 對 admin_audit_log 的 INSERT 不存在;拒繼續';
  END IF;

  -- 🔴 權限清單:PG17 起多一個 `MAINTAIN`(codex R2 MF2)。
  --    **版本感知,不硬加**(理由與其「未確認」界線見檔頭 R2-MF2 段;
  --     PG16 本體未實測,版本開關是**保守處置**不是已驗事實)。
  v_privs := ARRAY['UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  IF current_setting('server_version_num')::int >= 170000 THEN
    -- 🔴 用 `array_append`,不用 `||` —— plpgsql 會把 `v_privs || 'MAINTAIN'` 的右運算元
    --    當成**陣列字面**解析 ⇒ `malformed array literal: "MAINTAIN"`。
    --    (這個 bug 是本片自己的**正控**抓到的:負控全紅看起來很正常,正控該 COMMIT 卻紅了。)
    v_privs := array_append(v_privs, 'MAINTAIN');
  END IF;

  -- 2e. `service_role` 除了 INSERT + SELECT 之外**一律不得有**(含繼承來的)。
  FOREACH v_priv IN ARRAY v_privs LOOP
    IF pg_catalog.has_table_privilege('service_role', 'public.admin_audit_log', v_priv) THEN
      RAISE EXCEPTION 'D0 異常 — service_role 對 admin_audit_log 有 %(應只有 INSERT + SELECT);拒繼續', v_priv;
    END IF;
  END LOOP;

  -- 2f. client 角色**所有**權限全零(含繼承;含 PG17 的 MAINTAIN)。
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY (ARRAY['SELECT', 'INSERT'] || v_privs) LOOP
      IF pg_catalog.has_table_privilege(v_role, 'public.admin_audit_log', v_priv) THEN
        RAISE EXCEPTION 'D0 異常 — client 角色 % 有 % 權限(應全零);拒繼續', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- 2g. 🔴 攤平後的完整授權字串 —— 連 grantee、權限、可轉授三件都釘死;
  --     `service_role` 的 SELECT 就是由**這一格**釘住的(R2 N1)。形狀抄 20260807120000(A9v)。
  SELECT coalesce(pg_catalog.string_agg(g || ':' || p || ':' || gr, ', ' ORDER BY g, p), '<無>')
    INTO v_txt
    FROM (SELECT pg_catalog.pg_get_userbyid(a.grantee) AS g, a.privilege_type AS p,
                 a.is_grantable::text AS gr
            FROM pg_catalog.pg_class c
            CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
           WHERE c.oid = 'public.admin_audit_log'::regclass AND a.grantee <> c.relowner) x;
  IF v_txt <> 'service_role:INSERT:false, service_role:SELECT:false' THEN
    RAISE EXCEPTION 'D0 異常 — admin_audit_log 非 owner 授權應恰為 [service_role:INSERT:false, service_role:SELECT:false],實 [%];拒繼續', v_txt;
  END IF;

  -- 2h. 🔴 欄級 ACL 必須零**實際 privilege**(不用 `attacl IS NOT NULL`:非 NULL 但零 privilege 是合法終態)。
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_attribute a
    CROSS JOIN LATERAL pg_catalog.aclexplode(a.attacl) x
   WHERE a.attrelid = 'public.admin_audit_log'::regclass
     AND NOT a.attisdropped;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'D0 異常 — admin_audit_log 欄級 ACL 帶 % 筆實際授權(表級收斂擋不住欄級後門);拒繼續', v_cnt;
  END IF;

  -- 2i. 🔴🔴 **非內部 trigger 必須為 0**(codex R2 MF1)。
  --     檔頭逐字宣稱「append-only 由 GRANT 撐、表上零 trigger」——
  --     **實測:掛一支 AFTER INSERT trigger 後,本支舊版八格全部通過並 COMMIT** ⇒ 那句宣稱**沒有守門**。
  --     ⚠️ 而 SECURITY DEFINER trigger 可以在 INSERT 時改 / 刪舊資料 ⇒ **append-only 會被繞過而無人察覺**。
  --     (`NOT tgisinternal`:排除 FK/約束用的系統 trigger,只看人為掛的。)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.admin_audit_log'::regclass AND NOT tgisinternal;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'D0 異常 — admin_audit_log 掛了 % 支非內部 trigger,而本片檔頭宣稱零 trigger(append-only 只靠 GRANT);拒繼續', v_cnt;
  END IF;
END
$$;

COMMIT;
