-- 🛑🛑🛑 **這【不是】一支 migration。它住在 `docs/specs/`,不在 `supabase/migrations/`。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 為什麼它在這裡(2026-09-05;主視窗 `-f8` 裁「丙」)
-- ══════════════════════════════════════════════════════════════════════════
--   本檔要建的兩個角色,靠的是 `GRANT service_role TO <新角色>`(成員資格)。
--   而 `.husky` 的 `acl-drift-gate` 對那個形狀有一條 **R5**:
--     「成員關係複製一份權限 ⇒ apply 之後沒有任何東西會再量它」⇒ **紅。**
--   🔬 **而 R5 【不可豁免】** —— 我開檔看過 `scripts/acl-drift-gate.py:322`:
--     那一條直接 `out.append(('R5', …))`,**不像 R3/R4 會先問 `exempt_for`**
--     ⇒ 📌 寫 `-- ACL-GATE-EXEMPT:` 對它沒有用。
--
--   🎯 **而衝突是結構性的,不是寫法問題**:
--     閘給的出路是「改成對【單表】明文 GRANT」,而 plan §11b **實測證明那做不到** ——
--       `NOINHERIT` 成員讀到 **0 列** · `INHERIT` 成員讀到 **1 列** · 🟢 `service_role` 本人 **1 列**
--     ⇒ **要 policy 匹配就得成員資格, 而成員資格就是 R5。兩者綁死。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 什麼時候把它搬回去 —— 而【搬回去那一刻它仍然會被擋】
-- ══════════════════════════════════════════════════════════════════════════
--   ✅ 前置 = `⟦b9-ACLDRIFT5⟧` 那支執行期偵測器貼進正式庫
--      (`docs/plans/2026-09-05-acl-drift-runtime-detector-plan.md`;pg_cron 每日算 ACL 快照 hash)
--      —— 🔵 **因為 R5 的核心理由逐字是「apply 之後沒有東西會再量」,而那支偵測器正是在補這一格。**
--   ⇒ 搬回 `supabase/migrations/20260905150000_m4b_narrow_roles_for_email_and_cron.sql`
--   🛑 **而那時 R5 【還是會擋】** —— 閘不會因為偵測器上線就自己知道。
--      ⇒ 那時要**改閘**:給 R5 一條「偵測器已上線」的豁免路。
--      🔴 **而改閘 = 動驗證本身 ⇒ 那是【要主視窗裁】的事,不是實作窗自己能改的。**
--
-- ⚠️ **本檔的內容【已經過 codex 關卡2】**(FAIL ⇒ 3 must-fix + 1 nit 全折完),
--    三發突變各自被擋;紀錄在 commit body 與 plan §11。**搬回去時不必重審內容, 而要重跑閘。**
-- ══════════════════════════════════════════════════════════════════════════

-- 收窄第一步:建 email / cron 的專用角色(`Q-收窄萬用鑰匙` · Sean 2026-09-05 拍 `9.甲`)
--
-- 🛑🛑 **本檔是【草稿】。建角色 + 動成員資格 = PCM 鐵則 12②(權限)⇒ 要 codex 對抗審查才貼。**
-- 🟢 **它建兩個角色、給兩道成員資格。零表 GRANT、零 REVOKE、零 policy、不動任何既有角色。**
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 **先讀這段:本檔收窄的是【BYPASSRLS】,不是表權限**
-- ══════════════════════════════════════════════════════════════════════════
--   ⛔ ~~原本的 plan 說「建專用角色 + 給最小 GRANT」~~
--   🔬 **2026-09-05 動手前本機實測推翻了後半**(拋棄式 PG;正本 plan §11b):
--     表裡 1 列, policy 只寫 `TO service_role` ⇒ 讀得到幾列 = policy 有沒有匹配
--       `service_role` 本人   1 列   🟢 正對照(這把尺會動)
--       `INHERIT` 的成員      1 列   ✅ 匹配
--       `NOINHERIT` 的成員    0 列   🔴 **不**匹配
--     而 `INHERIT` 的成員**同時繼承 `service_role` 的全部表權限** ——
--     只給 `service_role` 的 `DELETE`, `INHERIT` 成員**真的刪得掉**(無錯誤);
--     `NOINHERIT` 成員 ⇒ `ERROR: permission denied`。
--   🎯 **⇒ 要 policy 匹配就得 `INHERIT`;而 `INHERIT` 就會把表權限一起帶過去。兩者綁死。**
--   ⇒ 📌 **所以本檔【不宣稱】最小 GRANT。新角色的表權限與 `service_role` 完全相同。**
--   ✅ **它拿掉的是 `BYPASSRLS`** —— 那是「無視所有 RLS」, 比多幾個表權限大一個量級。
--   🛑 主視窗 `-f8` 2026-09-05 裁「甲 = 接受只拿掉 BYPASSRLS」,並判定它仍在 Sean `9.甲` 的射程內。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 端到端實測(拋棄式 PG + PostgREST;正本 plan §11a)
-- ══════════════════════════════════════════════════════════════════════════
--   ① 無 token(anon)                 401   🔵 負對照
--   ② 專用角色讀 orders               200   ✅
--   ③ 專用角色寫 email_outbox         201   ✅
--   ④ 非成員角色帶 JWT 讀 orders      401   🔵 負對照
--   🔴 **而第一次那四發全是 503 —— 那是 PostgREST 還沒起來, 不是拒絕。**
--     就緒判準改成讀它 log 的 `Schema cache loaded` 才重量。
--
-- ══════════════════════════════════════════════════════════════════════════
-- 🛑 貼了本檔之後【什麼都不會改變】—— 這一句要先講
-- ══════════════════════════════════════════════════════════════════════════
--   本檔只是把兩個角色**擺好**。碼那一半(改用新角色的金鑰)**還沒做**
--   ⇒ 📌 **貼完之後 email / cron 照舊走 `service_role`, 一格行為都不變。**
--   ⇒ ✅ **那正是它安全的理由**:它不可能弄壞今天在跑的東西。
--   ⚠️ **而反過來也成立:貼了它【不會】讓任何東西變安全** —— 價值要等碼切過去才兌現。
--
-- ══════════════════════════════════════════════════════════════════════════
-- Rollback(兩行)
-- ══════════════════════════════════════════════════════════════════════════
--   🔴 **[codex must-fix ③] 先跑這一段, 不要直接 DROP** ——
--     ⛔ ~~原句「它們不擁有任何物件 ⇒ 直接 DROP 即可」~~ 只在【今天】成立:
--     日後只要有人給了它們**直接的 ACL / default privilege**, 或有 policy **引用**它們,
--     `DROP ROLE` 會失敗;而**反過來若碼已經切過去而依賴沒擋住, DROP 會成功並讓 email/cron 當場失去身分**。
--     ⇒ 📌 **那兩種都不是「退得乾淨」。**
--   ① 先確認碼還沒切(env 仍是 `SUPABASE_SERVICE_ROLE_KEY`)—— 這一步只有人做得到。
--   ② 再查有沒有東西依賴它們:
--        SELECT n.nspname, c.relname, p.polname FROM pg_policy p
--          JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
--         WHERE EXISTS (SELECT 1 FROM pg_roles r
--                        WHERE r.oid = ANY(p.polroles)
--                          AND r.rolname IN ('pcm_email_writer','pcm_cron_writer'));
--        -- 🔵 期望 0 列。非 0 ⇒ 先處理那些 policy, 不要 DROP。
--   ③ 兩行都要:
--        REVOKE pcm_email_writer FROM authenticator;  DROP ROLE IF EXISTS pcm_email_writer;
--        REVOKE pcm_cron_writer  FROM authenticator;  DROP ROLE IF EXISTS pcm_cron_writer;

BEGIN;

-- ── 前置閘:`service_role` 必須存在, 而且【現在還帶著 BYPASSRLS】────────
--    🔴 少了後半:若哪天 `⟦b9-RLSHARDEN⟧` 先跑了, 本檔的「零行為改變」就不成立
--       —— 那時新角色與 `service_role` 的差別消失, 而本檔的價值也一起消失。
--       ⇒ 停下來, 讓人重讀順序。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION '前置閘:service_role 不存在 ⇒ 拒繼續';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
                  WHERE rolname = 'service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION '前置閘:service_role 已經沒有 BYPASSRLS ⇒ 本檔的前提不成立。'
                    'RLSHARDEN 可能先跑了 —— 停下來重讀本檔開頭那段順序說明';
  END IF;
  -- 🔵 **[codex nit ④] 鎖住對 `20260904270000` 的依賴**:新角色能讀到東西, 靠的是
  --    那一支給 `service_role` 的 SELECT policy。它若沒 apply 或日後被 rollback,
  --    切過去之後會拿到 42501 或**靜靜的空資料** ⇒ 這裡先量一發, 讓那個依賴看得見。
  IF (SELECT count(*) FROM pg_catalog.pg_policy WHERE polname LIKE '%\_select\_service\_role') < 1 THEN
    RAISE EXCEPTION '前置閘:找不到任何 %%_select_service_role policy ⇒ 20260904270000 可能沒 apply。'
                    '新角色切過去之後會讀到空的而不報錯 ⇒ 拒繼續';
  END IF;

  -- 🛑 名字先擋:撞名時要紅, 不要靜靜接管一個別人建的角色
  --    (`CREATE ROLE IF NOT EXISTS` 在 PG 裡不存在, 而 DO 塊裡跳過會讓斷言對著別人的角色跑)
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles
              WHERE rolname IN ('pcm_email_writer', 'pcm_cron_writer')) THEN
    RAISE EXCEPTION '前置閘:pcm_email_writer / pcm_cron_writer 已經有人建了 ⇒ 拒繼續。'
                    '先查它是誰建的、屬性對不對, 再決定要不要接管';
  END IF;
END $$;

-- ── 建兩個專用角色 ────────────────────────────────────────────────────
--   `NOLOGIN`      它不直接連 DB;身分由 PostgREST 依 JWT 的 `role` claim `SET ROLE` 過來。
--   `NOBYPASSRLS`  🎯 **本檔的全部意義在這一格。**
--   `INHERIT`      🔴 **必須** —— `NOINHERIT` 的成員【不匹配】`TO service_role` 的 policy
--                  (實測 0 列 vs 1 列, 見檔頭)⇒ 那會讓兩條路當場讀不到任何東西。
CREATE ROLE pcm_email_writer NOLOGIN NOBYPASSRLS INHERIT;
CREATE ROLE pcm_cron_writer  NOLOGIN NOBYPASSRLS INHERIT;

-- ── 給成員資格(policy 匹配靠它)──────────────────────────────────────
GRANT service_role TO pcm_email_writer;
GRANT service_role TO pcm_cron_writer;

-- ══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 **[codex 關卡2 must-fix ①] 反方向的成員資格 —— 我原本【漏了它】**
-- ══════════════════════════════════════════════════════════════════════════
--   PostgREST 用 `authenticator` 連線, 再依 JWT 的 `role` claim 去 `SET ROLE`。
--   ⇒ 📌 **`authenticator` 必須是新角色的【成員】, 否則 `SET ROLE` 會被拒。**
--   🛑 **而我的端到端測試【會過】—— 因為那個 harness 自己補了這道 GRANT。**
--     ⇒ 🎯 **測試環境替 migration 補了它缺的東西, 而四格全綠。**
--       那正是「fixture 供給了真實世界不會給的東西」那一族。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticator') THEN
    RAISE EXCEPTION '前置閘:authenticator 不存在 ⇒ PostgREST 那條路組不起來, 拒繼續';
  END IF;
END $$;
GRANT pcm_email_writer TO authenticator;
GRANT pcm_cron_writer  TO authenticator;

-- ══════════════════════════════════════════════════════════════════════════
-- 事後斷言 —— 雙向:該有的要有, 而【最關鍵的那一格是「不該有的沒有」】
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  r record;
  v_n int;
BEGIN
  FOR r IN SELECT unnest(ARRAY['pcm_email_writer','pcm_cron_writer']) AS n LOOP
    -- ① 存在, 而且四個屬性逐格對(不是只問「在不在」)
    SELECT count(*) INTO v_n FROM pg_catalog.pg_roles
     WHERE rolname = r.n
       AND NOT rolbypassrls        -- 🎯 本檔的全部意義
       AND NOT rolcanlogin         -- 不得直接連 DB
       AND rolinherit              -- 沒有它 policy 不匹配
       AND NOT rolsuper
       AND NOT rolcreaterole
       AND NOT rolcreatedb;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '% 的屬性不符期望(NOBYPASSRLS/NOLOGIN/INHERIT/非 super/非 createrole/非 createdb)', r.n;
    END IF;

    -- ② 真的【用得到】service_role 的權限 —— 沒有它, 那條路會讀到 0 列而【不會報錯】
    --   🔴 **[codex must-fix ②]** ⛔ ~~原本問 `'MEMBER'`~~ —— PG16+ 可以
    --      `GRANT … WITH INHERIT FALSE`, 那時 `rolinherit=true` 且 `MEMBER=true` **全部過關**,
    --      而**權限與 policy 都不會自動繼承** ⇒ 📌 兩個世界印同一個 true。
    --   ✅ 改問 `'USAGE'` —— 它問的是「這個角色現在【用得到】那些權限嗎」。
    IF NOT pg_catalog.pg_has_role(r.n, 'service_role', 'USAGE') THEN
      RAISE EXCEPTION '% 用不到 service_role 的權限(成員邊可能是 INHERIT FALSE)'
                      ' ⇒ TO service_role 的 policy 對它不適用', r.n;
    END IF;

    -- ②b 反方向:authenticator 要能 SET ROLE 到它(codex must-fix ①)
    IF NOT pg_catalog.pg_has_role('authenticator', r.n, 'MEMBER') THEN
      RAISE EXCEPTION 'authenticator 不是 % 的成員 ⇒ PostgREST 無法 SET ROLE 過去', r.n;
    END IF;
  END LOOP;

  -- ③ 🟢 **正對照:證明上面那把尺會動。**
  --    同一組條件餵 `service_role` 自己 ⇒ 它【帶】BYPASSRLS ⇒ 必須【數不到】。
  --    🛑 少了這一格, 一個永遠回 1 的查詢也會讓 ① 全過。
  SELECT count(*) INTO v_n FROM pg_catalog.pg_roles
   WHERE rolname = 'service_role' AND NOT rolbypassrls;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '正對照失敗:service_role 竟然數得到「沒有 BYPASSRLS」⇒ 上面那三格沒有判別力';
  END IF;

  -- ④ 🔵 **本檔不得動到 `service_role` 自己** —— 它必須還帶著 BYPASSRLS。
  --    (與③是同一個查詢的兩半:③證明尺會動, ④證明世界沒被本檔改壞。)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
                  WHERE rolname = 'service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION '本檔不該動 service_role, 而它的 BYPASSRLS 不見了';
  END IF;
END $$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- 🛑 這一支【證不到什麼】
-- ══════════════════════════════════════════════════════════════════════════
-- · 它不證明「用新角色打 PostgREST 會成功」—— 那要簽一把 JWT 打一發,
--   而本檔只建角色。端到端那四格在拋棄式環境驗過(檔頭), **不是在正式庫**。
-- · 它不改任何 env、不改任何碼 ⇒ **貼完 email / cron 照舊走 `service_role`。**
-- · **新角色的表權限與 `service_role` 相同** —— 見檔頭, 那是設計不是遺漏。
-- · 🔴 **自簽 JWT 那條路騎在【legacy JWT secret】上**, 而 Supabase 官方正在勸退它
--   (`sb_secret_...` 不再基於 JWT signing key)⇒ 那是**技術債**, 正本 plan §3 有寫。
