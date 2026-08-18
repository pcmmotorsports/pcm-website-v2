-- ═══════════════════════════════════════════════════════════════════════════
--  B1-b · admin_user_staff_map  —— 真登入線的身分映射表
--
--  🔴🔴 這是【草稿】,不是可以直接 apply 的東西。位置也是暫時的。
--     · 規格:docs/specs/2026-08-16-m4b-e8b-b1-spec.md(三輪關卡1 審查後定稿)
--     · 最終落點:報價單 repo(~/API大量上架/PCM報價單-V2)的 supabase/migrations/
--     · apply 管道:MCP apply_migration,【需要 Sean 在場】
--       (報價單 repo 明文禁 supabase db push,docs/ops/MULTI_WINDOW_WORKFLOW.md:165)
--     · 放在本 repo 的理由:讓它先被拋棄式 PG 驗過、被人讀過,再搬過去。
--       搬過去時要重新命名成該 repo 的時間戳慣例。
--
--  🔴 本檔遵守的硬規則(規格 §4,每一條都有實測支撐):
--     1. 檔頭 BEGIN、檔尾 COMMIT，中間不得有 commit/end/rollback
--        (規格 §4.4 六臂實測:原子性取決於客戶端怎麼送,明文包起來才三種送法都原子)
--     2. 禁用 IF NOT EXISTS / OR REPLACE
--        (撞名要當場紅;靜靜跳過之後,下面的 REVOKE 與斷言會對著別人的物件跑而且很可能通過)
--     3. 開頭帶前提斷言、尾端帶收權斷言,兩邊都 fail-closed
--
--  ⚠️ 前提:所有語句在同一個 session。statement-mode pooler 下 BEGIN 無效且零警告。
--
--  ── 🔴 出事怎麼退(寫在檔頭,不是只寫在操作文件裡)──────────────────────
--  本支全退(照順序,反向):
--  🔴🔴 2026-08-18 更正(codex 關卡1 R3,角度=災難當天可用性):
--     ⛔ ~~原本這裡只列了 no_delete 一支~~ —— **本檔實際建了三支函式 + 三支 trigger**
--        (`:153` no_delete / `:173` no_truncate / `:201` no_rebind)。
--     ⇒ 照原文退完,`no_truncate` 與 `no_rebind` **兩支函式會殘留**,
--        而本檔明文禁用 `OR REPLACE`(檔頭硬規則 2)⇒ **下一次重跑會在 `CREATE FUNCTION` 當場撞名**。
--        (那是「當場紅」不是靜默,但**紅在錯的地方**:訊息會說「函式已存在」,
--         讀的人要自己想到「上一次沒退乾淨」。)
--      DROP TRIGGER  admin_user_staff_map_no_rebind_trg   ON public.admin_user_staff_map;
--      DROP TRIGGER  admin_user_staff_map_no_truncate_trg ON public.admin_user_staff_map;
--      DROP TRIGGER  admin_user_staff_map_no_delete_trg   ON public.admin_user_staff_map;
--      DROP TABLE    public.admin_user_staff_map;
--      DROP FUNCTION public.admin_user_staff_map_no_rebind();
--      DROP FUNCTION public.admin_user_staff_map_no_truncate();
--      DROP FUNCTION public.admin_user_staff_map_no_delete();
--  ⚠️ `DROP TABLE` 會連帶把三支 trigger 一起帶走 ⇒ 三行 DROP TRIGGER 其實是**冗餘**的;
--     留著是為了「只想退 trigger 不想退表」的那種半退場,**照順序跑不會出錯**。
--  🔴🔴 **B2(seeding)已經跑過的話,要退【必須先 DROP TRIGGER】** ——
--     否則 `DELETE` 會被【本檔自己建的那道保護】擋住。
--     **那是作者刻意造出來的退場成本,不是意外。** 半年後要退的人會先撞到它。
--  ⚠️ 本支與 B2 **不是同一個交易**:B1-b 成功、B2 失敗 ⇒ 正式庫留下
--     空表 + 函式 + trigger + RLS + grants,而 Auth 三個帳號可能已經開好卻沒有映射。
--     **那個中間態是安全的**(表空著沒有人綁得上,登入切換尚未開啟),**但要認得出來**。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 🔴 固定 search_path(關卡2 [中] finding):正式連線若把可寫 schema 排在 pg_catalog 前,
--    未限定的 has_*/format 等名稱可能解析到同名物件。拋棄式空庫的 search_path 正常,測不到這個。
SET LOCAL search_path = pg_catalog, public, auth;

-- ───────────────────────────────────────────────────────────────────────────
--  0. 前提斷言 —— 世界跟規格假設的不一樣就停,不要繼續建東西
-- ───────────────────────────────────────────────────────────────────────────
DO $precheck$
DECLARE
  v_require_2fa   boolean;
  v_totp          bigint;
  v_recovery      bigint;
  v_auth_users_id text;
  v_state_rows    bigint;
BEGIN
  -- 0.0 🔴 **PG 版本前提:本檔的收權斷言列舉【表權限的完整集合】,而 `MAINTAIN` 是 PG 17 才有的。**
  --     不加這道的話,在 PG 16 apply 會炸在 `has_table_privilege(…,'MAINTAIN')` 這種
  --     **看不出所以然的地方**(它會說 privilege type "MAINTAIN" 不存在)。
  --     ⇒ 讓它炸在這裡,並且說得出為什麼。
  --     來源(2026-08-17 當場查官方,非記憶):
  --       https://www.postgresql.org/docs/17/ddl-priv.html
  --       Table 5.2 表物件的權限字串 = `arwdDxtm`(8 項),其中 `m` = MAINTAIN
  --       逐字:「MAINTAIN — Allows VACUUM, ANALYZE, CLUSTER, REFRESH MATERIALIZED VIEW,
  --              REINDEX, and LOCK TABLE on a relation.」
  IF current_setting('server_version_num')::int < 170000 THEN
    RAISE EXCEPTION E'B1-b 前提斷言:需要 PostgreSQL 17 以上,實際 %。\n'
      '   ⇒ 本檔的收權斷言列舉表權限的完整集合(arwdDxtm 共 8 項),而 MAINTAIN 是 17 才有的。\n'
      '   ⇒ 在舊版上跑,那個斷言會少查一項【而且不會有人發現】。',
      current_setting('server_version');
  END IF;

  -- 0.1 2FA 必須是休眠狀態 —— 這是整條線「7 片、不碰 TOTP」那個拆法的前提。
  --     🔴 2026-08-16 Sean 實查為 false/0/0，而【查到的事實會過期，斷言不會】。
  --        這一段的存在就是為了讓那次查詢在每次 apply 時被重新問一次。
  IF to_regclass('public.auth_state') IS NULL THEN
    RAISE EXCEPTION E'B1-b 前提斷言:找不到 public.auth_state。\n'
      '   ⇒ 你可能連到了錯的資料庫(本檔屬【報價單庫】,不是 A 庫)。';
  END IF;
  -- 🔴 先斷言它恰好一列(關卡2 [中] finding):
  --    多列時 `SELECT … INTO` 任取一列,**可能剛好取到 false 而掩蓋另一列的 true**。
  --    這個表在 repo 裡是 CHECK(id) 鎖死的單列表,但那是 repo 說的,不是正式庫說的。
  SELECT count(*) INTO v_state_rows FROM public.auth_state;
  IF v_state_rows <> 1 THEN
    RAISE EXCEPTION 'B1-b 前提斷言:auth_state 有 % 列,預期恰好 1。多列時取值不可信。拒繼續。', v_state_rows;
  END IF;

  SELECT require_2fa INTO v_require_2fa FROM public.auth_state;
  SELECT count(*) INTO v_totp     FROM public.totp_devices;
  SELECT count(*) INTO v_recovery FROM public.recovery_codes;

  IF v_require_2fa IS DISTINCT FROM false OR v_totp <> 0 OR v_recovery <> 0 THEN
    RAISE EXCEPTION E'B1-b 前提斷言失敗:2FA 不再是休眠狀態'
      '(require_2fa=%, totp_devices=% 列, recovery_codes=% 列)。\n'
      '   🔴 本線的 7 片拆法建立在「第一期不碰 TOTP」之上。\n'
      '   ⇒ 停下,照 plan §7-3:本線範圍必須當場擴張,不得照原 plan 往下做。\n'
      '   ⇒ 原因:TOTP 裝置池是【全公司共用】(totp_devices 無 user_id),\n'
      '      一旦有了個人帳號,任何人的 TOTP 可以搭配另一人的密碼。',
      v_require_2fa, v_totp, v_recovery;
  END IF;

  -- 0.2 auth.users 必須存在且 id 是 uuid —— 下面的 FK 靠它
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_auth_users_id
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('auth.users') AND a.attname = 'id' AND a.attnum > 0;
  IF v_auth_users_id IS NULL THEN
    RAISE EXCEPTION E'B1-b 前提斷言:找不到 auth.users.id。\n'
      '   ⇒ 這個專案的 Supabase Auth 可能沒開,或這不是報價單庫。';
  END IF;
  IF v_auth_users_id <> 'uuid' THEN
    RAISE EXCEPTION 'B1-b 前提斷言:auth.users.id 型別是 %,預期 uuid。拒繼續。', v_auth_users_id;
  END IF;

  RAISE NOTICE 'B1-b 前提斷言通過:2FA 休眠(false/0/0)、auth.users.id 為 uuid。';
END
$precheck$;

-- ───────────────────────────────────────────────────────────────────────────
--  1. 映射表
--     🔴 裸 CREATE，不加 IF NOT EXISTS —— 撞名要當場紅(規格 §4.1)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE public.admin_user_staff_map (
  auth_user_id uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  staff_id     text        NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- 🔴 白名單:跨庫建不了 FK(staff 表在 A 庫),所以用 CHECK 當參照完整性的替代。
  --    · 名單只增不減。加新員工 = 一支 ALTER migration = 一次 review。
  --      那是本方案【刻意付出的代價】,不是遺漏(規格 §2)。
  --    · 系統帳號(op4_backfill / payment_confirmer)與 test_01 【不在名單裡】
  --      ⇒ 它們在型別層就綁不了帳號,不靠人記得。
  --    · Sean 2026-08-16 拍板:代號永不重用。新人拿新代號(staff_3…),不撿空出來的。
  CONSTRAINT admin_user_staff_map_staff_whitelist
    CHECK (staff_id IN ('sean', 'staff_1', 'staff_2'))
);

COMMENT ON TABLE public.admin_user_staff_map IS
  '真登入線(M-4b E8-B):Supabase Auth 使用者 → A 庫 staff.id 的映射。'
  '只描述【會登入的人】;系統帳號不進本表(它們是 admin_audit_log.actor 的字串,不經登入路徑)。'
  'staff_id 為永久識別碼、永不重用(Sean 2026-08-16 拍板)。'
  '🔴 本表【刻意不曝露 Data API】(PostgREST / supabase-js .from()):anon 與 authenticated 兩道 REVOKE 都下了,'
  '只有 service_role 拿到 SELECT/INSERT,讀取一律走 server 端。'
  '⇒ 這不是漏了 GRANT。2026-08-17 實測:apps/ 與 packages/ 共 1477 個追蹤檔內,'
  'admin_user_staff_map 零命中(同一把量具在同一範圍找得到 admin_audit_log / customers 等 .from() 呼叫,量具是活的)。'
  '⚠️ Sean 2026-08-17 已把 Supabase 的 Automatically expose new tables 關閉;本表不依賴那個開關,'
  '因為它自己下了兩道 REVOKE 再明文 GRANT。';

COMMENT ON COLUMN public.admin_user_staff_map.staff_id IS
  '對應 A 庫 public.staff.id。🔴 跨庫無 FK,以 CHECK 白名單替代;'
  '⚠️ 白名單擋不住「在名單內、而 A 庫已停用那個人」⇒ B5 必須在【每次登入】重新確認 staff.is_active。';

-- ───────────────────────────────────────────────────────────────────────────
--  2. 禁 DELETE
--     🔴 UNIQUE 只擋「同時綁兩個」，擋不住「DELETE 舊列再 INSERT 新的」。
--        後者會把 staff_2 重綁到另一個人身上，而【歷史稽核的解讀跟著翻轉、零訊號】。
--     ⚠️ 誠實邊界:這道 trigger 擋【誤刪】，擋不住有意的人(他可以先 DROP TRIGGER)。
--        它的目的是讓「重綁」變成一個需要刻意繞過的動作，不是變成不可能。
-- ───────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.admin_user_staff_map_no_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $nodelete$
BEGIN
  RAISE EXCEPTION E'admin_user_staff_map 的列不得刪除。\n'
    '   代號永不重用(Sean 2026-08-16 拍板):刪掉這列再新增,會把 % 重綁到另一個人,\n'
    '   而過去的稽核紀錄會跟著改變解讀。\n'
    '   ⇒ 員工離職請走 Supabase Auth 側 disable,不要動這張表。', OLD.staff_id;
END
$nodelete$;

CREATE TRIGGER admin_user_staff_map_no_delete_trg
  BEFORE DELETE ON public.admin_user_staff_map
  FOR EACH ROW EXECUTE FUNCTION public.admin_user_staff_map_no_delete();

-- 🔴🔴 `TRUNCATE` **不會觸發 BEFORE DELETE trigger**,而且 **不受 RLS 管**
--    ⇒ 上面那道保護對 `TRUNCATE` 完全無效(關卡2 R2 實跑:整表被清空、trigger 沒響)。
--    主防線是「REVOKE 掉 TRUNCATE 權限」,而**這一道是第二層** ——
--    因為權限可能被別人改回來,而那時不會有任何東西提醒你。
CREATE FUNCTION public.admin_user_staff_map_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $notruncate$
BEGIN
  RAISE EXCEPTION E'admin_user_staff_map 不得 TRUNCATE。\n'
    '   TRUNCATE 會清掉全部映射 ⇒ 稽核軌從此對不到人,而且它不受 RLS 也不觸發 DELETE trigger。\n'
    '   ⇒ 要清空請說明理由並走人工程序,不要用 TRUNCATE。';
END
$notruncate$;

CREATE TRIGGER admin_user_staff_map_no_truncate_trg
  BEFORE TRUNCATE ON public.admin_user_staff_map
  FOR EACH STATEMENT EXECUTE FUNCTION public.admin_user_staff_map_no_truncate();

-- 🔴🔴 **兩個識別欄不可改**(關卡2 R3 `F-R3-1`,兩顆腦獨立命中)
--
--    我給 DELETE 與 TRUNCATE 各加了一道 trigger,理由逐字是
--    「**權限可能被別人改回來,而那時不會有任何東西提醒你**」。
--    ⇒ **那個理由【同樣適用 UPDATE】,而我沒有套。**
--    日後若有人誤授 `UPDATE` 給 service_role(或任何角色),就能把
--    `auth_user_id` / `staff_id` 換掉 = **與 DELETE+INSERT 完全相同的重綁效果**,
--    而 no_delete / no_truncate **都不會觸發**、apply 當下那一次性的收權斷言**也不會重跑**。
--
--    📎 這是我自己邏輯的不一致,不是新知識 —— **同一個理由,我只套了兩個動詞。**
--
--    ⚠️ 只擋【識別欄】不擋整個 UPDATE:日後若要加 `revoked_at` 之類的欄位還改得動。
--       **擋的是「這一列指向誰」,不是「這一列的任何欄位」。**
CREATE FUNCTION public.admin_user_staff_map_no_rebind()
RETURNS trigger
LANGUAGE plpgsql
AS $norebind$
BEGIN
  IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
     OR NEW.staff_id  IS DISTINCT FROM OLD.staff_id THEN
    RAISE EXCEPTION E'admin_user_staff_map 的 auth_user_id / staff_id 不可修改。\n'
      '   改它 = 把歷史稽核紀錄重新指向另一個人,而【零訊號】。\n'
      '   ⇒ 要換綁定:走 Auth 側停用舊帳號 + 新增一列新代號(代號永不重用,Sean 2026-08-16 拍板)。';
  END IF;
  RETURN NEW;
END
$norebind$;

CREATE TRIGGER admin_user_staff_map_no_rebind_trg
  BEFORE UPDATE ON public.admin_user_staff_map
  FOR EACH ROW EXECUTE FUNCTION public.admin_user_staff_map_no_rebind();

-- ───────────────────────────────────────────────────────────────────────────
--  3. 收權
--     🔴 兩道都要下(規格 §2 / docs/patterns/revoking-function-execute-in-supabase.md):
--        FROM PUBLIC 收不到具名授權；FROM 具名 收不到 PUBLIC 授權。少一道 anon 都碰得到。
--     🔴 新物件【出生那一刻】就自帶 anon/authenticated 權限(Supabase 的 ALTER DEFAULT PRIVILEGES),
--        而那個授權在 repo 裡沒有 GRANT 語句可以被掃到 ⇒ grep 型守門看不到、三綠不紅。
-- ───────────────────────────────────────────────────────────────────────────
-- 🔴🔴🔴 **第三個 grantee:`service_role`**(關卡2 R2 [must-fix],2026-08-16 實跑重現)
--    Supabase 的 ADP 是 `GRANT ALL … TO anon, authenticated, **service_role**`。
--    我上面 :150-152 記下了前兩個,**漏掉同機制的第三個** ——
--    而我對 service_role **只有 GRANT(加法)、從來沒有 REVOKE**
--    ⇒ 這張表【出生就帶】 UPDATE / DELETE / TRUNCATE 給 service_role
--    ⇒ **R1 高1「不給 UPDATE」那個修法被原封打開,append-only 的宣稱在正式庫是假的。**
--    實跑重現:`set role service_role; UPDATE … set auth_user_id=…` 成功重綁;
--             `set role service_role; TRUNCATE` 成功清空,而 no_delete trigger **不觸發**。
--    📎 **這是同一個形狀第三次:鎖了前門開了後門,而我每次都以為關完了。**
--       前兩次是 DELETE→UPDATE、UPDATE→ADP。**先 REVOKE ALL 再 GRANT 需要的,才是正確順序。**
REVOKE ALL ON TABLE    public.admin_user_staff_map FROM PUBLIC;
REVOKE ALL ON TABLE    public.admin_user_staff_map FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_user_staff_map_no_delete()   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_user_staff_map_no_delete()   FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_user_staff_map_no_truncate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_user_staff_map_no_truncate() FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_user_staff_map_no_rebind()   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_user_staff_map_no_rebind()   FROM anon, authenticated, service_role;

-- 🔴🔴 **不給 UPDATE**(關卡2 [高] finding,2026-08-16)。
--    原版給了 `UPDATE`,而 `UPDATE` 可以直接把 auth_user_id 或 staff_id 換掉
--    ⇒ **與 DELETE+INSERT 完全相同的重綁效果**,歷史稽核的解讀一樣會翻轉。
--    禁了 DELETE 卻留 UPDATE = 鎖了前門開了後門。
--    ⚠️ 而作者自己的 A9 驗收格【把 UPDATE 驗成綠色】—— 那一格在驗證這個漏洞是好的。
--    ⇒ 本表的兩個識別欄是 append-only:要換人綁定,走 Auth 側 disable + 新增一列新代號。
-- 🔴🔴 2026-08-18 更正(codex 關卡1 R3,角度=回歸與權限面):
--    ⛔ ~~`GRANT SELECT, INSERT … TO service_role;`~~ ⇒ **INSERT 拿掉,只留 SELECT。**
--    codex 逐字:「規格稱寫入唯一入口是 migration,卻永久授予共用 `service_role` INSERT;
--    所有既有 fetcher／server service key 都同步取得新增身分映射的能力。」—— **屬實**。
--    · **誰需要 SELECT**:報價單登入流程要用已驗證的 `auth_user_id` 查出 `staff_id`,
--      那條路走 `supabaseServer`(= service_role)⇒ SELECT **必須留**。
--    · **誰需要 INSERT**:只有 B2-seed 那支 migration,而它是**以 migration 角色(表的 owner)跑的**
--      ⇒ 不需要 service_role 的 INSERT。
--    · ⇒ 拿掉之後,「寫入端唯一入口 = migration」**從一句散文變成一道權限**。
--
--  🔴 **而這一改帶著一個【我沒查證的前提】,不要當它已驗**:
--     `apply_migration` 究竟以哪個角色連線 —— 若它走的是 `service_role`(不是 owner),
--     **B2-seed 會在 INSERT 那一步被權限擋下**。
--     ⇒ 緩解已經下在 B2-seed 的前提斷言裡(它會印出當下角色與缺哪個權限,不會只回一句 permission denied)。
--     ⇒ **這是「把未知變成一個會自己說明的失敗」,不是「查過了」。**
GRANT SELECT ON TABLE public.admin_user_staff_map TO service_role;

-- 🔴 落地斷言:service_role **不得**有任何寫入權(把上面那段散文變成機械檢查)。
DO $no_write_for_service_role$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(p, ', ') INTO v_bad
    FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) AS p
   WHERE has_table_privilege('service_role', to_regclass('public.admin_user_staff_map'), p);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION E'B1-b 落地斷言:service_role 仍持有寫入權(%)。\n'
      '   ⇒ 「寫入端唯一入口 = migration」在權限層不成立;有 service key 的任何程序都能新增身分映射。', v_bad;
  END IF;
  -- 🔴 對照組:SELECT 必須【有】。少了它,上面那道會在「什麼權限都沒有」的世界裡也綠,
  --    而那個世界裡報價單登入查不到 staff_id ⇒ 全公司登入失敗。
  IF NOT has_table_privilege('service_role', to_regclass('public.admin_user_staff_map'), 'SELECT') THEN
    RAISE EXCEPTION 'B1-b 落地斷言:service_role 沒有 SELECT —— 報價單登入將查不到 staff_id。';
  END IF;
END
$no_write_for_service_role$;

ALTER TABLE public.admin_user_staff_map ENABLE ROW LEVEL SECURITY;
-- 零 policy = default deny。
-- 🔴🔴 **原註解寫「service_role 走 BYPASSRLS,不需要 policy」—— 那是我沒驗過的假設。**
--    2026-08-16 拋棄式實測:一個沒有 BYPASSRLS 的 service_role,
--    `INSERT` 會被擋(`new row violates row-level security policy`)。
--    ⇒ **這張表會建得起來、而且完全沒有人寫得進去,直到有人真的去寫才發現。**
--    ⇒ 下面那道斷言把這個假設變成【apply 當下就會紅】的東西。

DO $rls_premise$
DECLARE v_bypass boolean;
BEGIN
  SELECT rolbypassrls INTO v_bypass FROM pg_roles WHERE rolname = 'service_role';
  IF v_bypass IS NULL THEN
    RAISE EXCEPTION 'B1-b:找不到角色 service_role。拒繼續。';
  END IF;
  IF NOT v_bypass THEN
    RAISE EXCEPTION E'B1-b:service_role 沒有 BYPASSRLS,而本表是「RLS 開 + 零 policy」。\n'
      '   ⇒ 這張表會建起來但 service_role 【一列都讀不到】,而且要到有人真的讀才會發現。\n'
      '      (🔴 2026-08-18 更正主詞:原文寫「沒有人寫得進去」—— 那是 service_role 還有 INSERT 那個版本的話。\n'
      '       現在 service_role 只有 SELECT,壞掉的面是【報價單登入查不到 staff_id】,不是寫不進去。)\n'
      '   ⇒ 兩條路擇一,不要硬跑:\n'
      '      (a) 確認正式庫的 service_role 確實有 BYPASSRLS(Supabase 預設有,但【要看過才算】)\n'
      '      (b) 改成明文開一條給 service_role 的 policy,不依賴 BYPASSRLS';
  END IF;
  -- 🔴 落地斷言:RLS 真的開起來了。**保護與它的斷言放在同一層**,不要隔一支檔。
  --    (2026-08-17 B 窗補,主視窗已批;鐵則 12②③ 全套跑過。)
  --
  -- ⚠️🔴 **這一道【不】關掉「apply 之後有人 DISABLE RLS 沒人發現」那個缺口 ——
  --    講清楚它守什麼、不守什麼,因為它很容易被讀成守了那個。**
  --      · **守得到**:有人把上面那行 `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` 從本檔刪掉
  --        / 改壞 ⇒ **apply 當場紅在這裡**,而不是等到下游 B2 才紅在「RLS 沒開」。
  --        (在此之前唯一會叫的是 B2 的前提斷言 —— **隔一支檔、訊息指向 seeding**,
  --         讀的人要翻三層才知道真因。)
  --      · **守不到**:apply 之後任何時點的 `ALTER TABLE … DISABLE ROW LEVEL SECURITY`。
  --        **這支 migration 只跑一次、不會重跑** ⇒ 事後的狀態它一概看不到。
  --        那個缺口仍然開著,記在 `docs/specs/2026-08-17-b1-apply-preflight.md` §`#7`。
  --
  -- 📌 為什麼仍值得加(而不是「反正 B2 會擋」):失敗的**位置**決定下一個人會去改什麼。
  --    紅在 B2 ⇒ 最可能的錯修是「把 B2 的前提斷言放寬」;紅在這裡 ⇒ 指向真正的那一行。
  DECLARE v_rls boolean;
  BEGIN
    SELECT relrowsecurity INTO v_rls
      FROM pg_class WHERE oid = to_regclass('public.admin_user_staff_map');
    IF v_rls IS DISTINCT FROM true THEN
      RAISE EXCEPTION E'B1-b 落地斷言:admin_user_staff_map 的 RLS 沒有開起來(relrowsecurity=%)。\n'
        '   ⇒ 本表的設計是「RLS 開 + 零 policy = default deny」,RLS 沒開等於**整張表對所有角色敞開**。\n'
        '   ⇒ 檢查本檔的 `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` 那一行是不是被刪掉或改壞了。', v_rls;
    END IF;
  END;
  -- 🔴 `IS DISTINCT FROM true` 不是 `= false`:`to_regclass` 回 NULL(表不存在)時
  --    `relrowsecurity` 是 NULL ⇒ `NULL = false` 為 NULL ⇒ `IF` 走 false 分支 ⇒ **斷言不會叫**。
  --    (今天 B1-a 就是栽在這個形狀上,同一顆 commit 之前才修完。)

  RAISE NOTICE 'B1-b:service_role 具 BYPASSRLS、RLS 已開,零 policy 的前提成立。';
END
$rls_premise$;

-- ───────────────────────────────────────────────────────────────────────────
--  4. 收權 fail-closed 斷言(樣板出自 ~/pcm-mailbox/E-684-新物件收權斷言樣板.md)
--     ⚠️ 清單只列【本檔新建的】物件。既有物件不列 —— house 對型錄表有刻意的欄級授權,
--        列進來會紅而那是誤報。
--     ⚠️ 它只檢查你列出來的東西 ⇒ 防「忘記收權」，不防「忘記列」。
-- ───────────────────────────────────────────────────────────────────────────
DO $newobj_guard$
DECLARE
  v_relations text[] := ARRAY['public.admin_user_staff_map']::text[];
  v_functions text[] := ARRAY['public.admin_user_staff_map_no_delete()',
                              'public.admin_user_staff_map_no_truncate()',
                              'public.admin_user_staff_map_no_rebind()']::text[];
  r         text;
  v_oid     oid;
  v_bad     int := 0;
  v_first   text;
  v_checked int := 0;
  v_priv    text;
  v_col     text;
BEGIN
  FOREACH r IN ARRAY v_relations LOOP
    v_oid := to_regclass(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到關聯 % —— 名字打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    -- 🔴 **清單由伺服器推導,不手寫**(丙案 MA-1)。2026-08-17 由手寫 8 項改成推導。
    --    ⚠️ 為什麼要改:adversarial-reviewer 2026-08-17 實測 —— 把這裡從 8 項縮成
    --       `ARRAY['SELECT']` ⇒ **37 格全綠**。⇒ 這份手寫清單**零覆蓋**,
    --       而同一支檔的 `v_reach` 段立了「不准手寫」的原則。**原則只被執行了三分之一。**
    --    ⇒ PG 18 若新增第 9 種表權限,推導那臂自動入列,這裡不會 —— 正是本片在修的
    --       「枚舉的集合比世界窄」。改成推導 = 把這個債關掉,不是記錄它。
    -- 🔴 `DISTINCT` 在**這裡**是承重的(與 `v_reach` 那邊不同,見該段):
    --    這是個**迴圈**,同一個權限型別出現兩次會讓 `v_bad` 多加一次 ⇒ 計數失真。
    FOR v_priv IN
      SELECT DISTINCT d.privilege_type
        FROM aclexplode(acldefault('r', (SELECT relowner FROM pg_class WHERE oid = v_oid))) d
    LOOP
      -- 🔴 2026-08-18 codex 關卡1 R3 [不確定] D3:`has_table_privilege` 走的是【繼承後】的權限,
      --    而 `NOINHERIT` 成員可以先 `SET ROLE` 再取得目標角色的權限 ⇒ 這一問可能綠、路仍可達。
      --    **本檔【不】在這裡加那道檢查**,理由:Supabase 的切換者是 `authenticator`(它才是 anon /
      --    authenticated / service_role 的成員),而 `anon` 本身**不是** service_role 的成員 ——
      --    ⚠️ **而上面這句是我從架構推的,不是查到的。**
      --    ⇒ **缺的那一道檢查(apply 當天貼上去跑,一行)**:
      --         SELECT r.rolname AS member, g.rolname AS can_set_role_to, r.rolinherit
      --           FROM pg_auth_members m
      --           JOIN pg_roles r ON r.oid = m.member
      --           JOIN pg_roles g ON g.oid = m.roleid
      --          WHERE g.rolname IN ('service_role','postgres') ORDER BY 1,2;
      --    ⇒ 若結果裡出現 `anon` 或 `authenticated` 當 member ⇒ **停下來回報**,本表的收權斷言射程不足。
      IF has_table_privilege('anon', v_oid, v_priv)
         OR has_table_privilege('authenticated', v_oid, v_priv) THEN
        v_bad := v_bad + 1;
        IF v_first IS NULL THEN v_first := format('%s 上仍有 %s', r, v_priv); END IF;
      END IF;
    END LOOP;
    -- ══════════════════════════════════════════════════════════════════
    -- 🔴 第 1 層(丙案):**`attacl` sweep —— 非空即紅**,不枚舉角色、不枚舉權限型別
    -- ══════════════════════════════════════════════════════════════════
    -- **舊版是**:對每個欄位跑 `has_column_privilege(anon|authenticated, …, 'SELECT')`。
    -- 它有兩個病,而且兩個都是靜默的:
    --   ① **只查 `SELECT`** ⇒ 欄級 INSERT / UPDATE / REFERENCES **全部放行**(codex R2 `b1b:309`)
    --   ② **只查兩個角色** ⇒ 任何第三個角色的欄級授權看不見(codex R2 `b1b:476`)
    --   📎 ①② 是同一個病的兩面:**枚舉的集合比世界窄。**
    --
    -- **新版直讀儲存層**:欄級授權**一定**寫進 `pg_attribute.attacl`
    --   ⇒ 一道查詢涵蓋 **所有欄 × 所有權限型別(含 PG 日後新增)× 所有角色**,而且**不會過期**。
    --   實測背書(V 窗 S0-S2,拋棄式 PG 17.10):
    --     S0 新表 ⇒ attacl 非空欄數 **0**
    --     S1 `grant update (a)` + 表級 MAINTAIN ⇒ 非空**恰 1 欄**(**表級授權不污染 attacl**)
    --     S2 revoke 欄級 ⇒ 歸 **0**、無空陣列殘留 ⇒ **零誤報**
    --
    -- ⚠️ **本表【不該有任何欄級授權】** —— 落筆當下實查:本檔的欄級 `GRANT` 數 = **0**
    --    (`grep -cE 'GRANT +[A-Z]+ *\('` 回 1,而那 1 個是**註解行** ——
    --     即下面寫「`GRANT UPDATE(auth_user_id)` 住在 `pg_attribute.attacl`」的那一行;
    --     正向對照:表級 `^GRANT ` = 1 ⇒ 那支 grep 是活的)
    --    ⚠️🔴 **這裡原本寫死行號 `:345`,而實際在 `:370`**(code-reviewer 2026-08-17 抓)。
    --       ⇒ 改成**用內容指路**:行號會隨每次編輯漂,而漂掉之後它仍然「讀起來像個證據」。
    --    ⇒ 所以「非空即紅」不會誤報**現行**設計。日後若真要授欄級,**改這裡並在本檔寫明理由**。
    --
    -- 📌 `cardinality(…) > 0` 那半:S2 實測 revoke 後是 NULL 不是空陣列,
    --    這一條是**便宜的保險**(別的路徑若留下 `{}`,不該被讀成「有授權」)。
    FOR v_col IN
      SELECT format('%I ⇒ %s', attname, attacl::text)
        FROM pg_attribute
       WHERE attrelid = v_oid AND attnum > 0 AND NOT attisdropped
         AND attacl IS NOT NULL AND cardinality(attacl) > 0
    LOOP
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN
        v_first := format('%s 上有【欄級授權】(第 1 層 attacl sweep):%s', r, v_col);
      END IF;
    END LOOP;
  END LOOP;

  FOREACH r IN ARRAY v_functions LOOP
    v_oid := to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '新物件收權斷言:找不到函式 % —— 簽名打錯或沒建成。拒繼續。', r;
    END IF;
    v_checked := v_checked + 1;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      v_bad := v_bad + 1;
      IF v_first IS NULL THEN v_first := format('%s 上仍有 EXECUTE', r); END IF;
    END IF;
  END LOOP;

  -- 🔴🔴 白名單斷言(關卡2 [高] finding):只檢查 anon/authenticated **不夠**。
  --    正式庫有其他角色,而 ALTER DEFAULT PRIVILEGES 可能對自訂角色也給了 GRANT。
  --    ⇒ 改成 allow-list:除了 owner 與 service_role,**任何角色**對本表有權限都要紅。
  --    ⚠️ 拋棄式空庫只有我建的三個角色 ⇒ 這一條在樁上幾乎恆綠,它是為【正式庫】寫的。
  DECLARE v_extra text;
  BEGIN
    -- 🔴🔴 **service_role 不再被豁免**(關卡2 R2 [must-fix])。
    --    原版寫 `NOT IN ('service_role', current_user)` ⇒ **即使它握有 UPDATE/DELETE/TRUNCATE 也恆綠**
    --    ⇒ 這個守門在設計上看不到上面那個洞。**豁免誰,就對誰盲。**
    --    改成:service_role 的權限必須【恰好】是 SELECT+INSERT,多一項就紅。
    -- 🔴🔴 **改用【有效權限】,不用 ACL 字面**(關卡2 R3 `F-R3-2`)
    --
    --    原版用 `aclexplode(relacl)` ⇒ **只看直接的 table ACL**,對兩件事盲:
    --      ① **角色繼承** —— service_role 若繼承了某個持有 UPDATE 的角色,relacl 上看不到
    --      ② **欄級授權** —— `GRANT UPDATE(auth_user_id)` 住在 `pg_attribute.attacl`,不在 relacl
    --    ⇒ **斷言綠,而有效權限含 UPDATE。**
    --
    --    📎 這條打的是【我用來證明安全的那道斷言本身】,不是被它保護的東西。
    --    🔴 而欄級那一半我今天才寫進 `docs/patterns/…` ——
    --       我在那裡記下「`has_table_privilege` 看不到欄級授權」,
    --       **然後在這裡用了有【鏡像問題】的 `relacl`。知道一條規則不等於用得上它。**
    DECLARE
      v_bad   text;
      v_priv  text;
      v_col   text;
      v_reach text;
    BEGIN
      -- 表級:**推導出來的每一種**權限逐一問【有效權限】,預期只有 SELECT 與 INSERT 為真。
      -- 🔴 清單同樣由伺服器推導(丙案 MA-1),2026-08-17 由手寫 8 項改成推導 ——
      --    理由與上面 anon/authenticated 那圈相同:手寫版**零覆蓋**
      --    (adversarial-reviewer 實測把它縮成一項仍 37 格全綠),而原則就寫在同一支檔裡。
      -- ⚠️🔴 這一段的註解原本寫「**七種**」而陣列是 8 項(code-reviewer 2026-08-17 抓)。
      --    **「清單漏一項而沒人發現」正是本片在修的那個病,同一段又復發一次。**
      --    ⇒ 改成推導之後這個數字**不再需要寫在註解裡** —— 沒有數字就沒有會漂的數字。
      -- 📌 `<> (v_priv IN ('SELECT'))` 這半是【可接受的集合】,**刻意手寫**:
      --    它是白名單、是business 決定,不是「世界有哪些權限型別」。兩者不混在一起。
      -- 🔴 2026-08-18 隨 codex R3 D1 一起改:⛔ ~~`IN ('SELECT','INSERT')`~~ ⇒ **只剩 SELECT**。
      --    **這一處是拋棄式 PG 實跑抓到的,不是我改 GRANT 時想到的** ——
      --    改完 GRANT 直接跑,這道斷言當場紅在「表級 INSERT 不符」。
      --    📎 形狀:**可接受集合寫在兩個地方(GRANT 一份、斷言一份),改一份不會有東西提醒你改另一份**
      --    —— 而它剛好是這支檔在防的同一個病(清單漏一項而沒人發現),只是這次是我漏。
      FOR v_priv IN
        SELECT DISTINCT d.privilege_type
          FROM pg_class oc
          CROSS JOIN LATERAL aclexplode(acldefault('r', oc.relowner)) d
         WHERE oc.oid = to_regclass('public.admin_user_staff_map')
      LOOP
        IF has_table_privilege('service_role', to_regclass('public.admin_user_staff_map'), v_priv)
           <> (v_priv IN ('SELECT')) THEN
          v_bad := coalesce(v_bad || ', ', '') || format('表級 %s', v_priv);
        END IF;
      END LOOP;

      -- 欄級:逐欄問可欄級授權的四種。任何一欄多出 INSERT / UPDATE / REFERENCES 都要紅。
      -- 🔴 SELECT 在表級已為真 ⇒ 欄級必然為真,不重複判;這裡只抓【多出來的】。
      -- 🔴🔴 2026-08-18 隨 D1 一起改:⛔ ~~陣列是 `['UPDATE','REFERENCES']`~~ ⇒ **加回 `INSERT`**。
      --    原本不判欄級 INSERT 的理由是「表級 INSERT 已為真」;**那個前提剛剛被我自己拿掉了**
      --    ⇒ 不加回去的話,`GRANT INSERT (staff_id) ON … TO service_role` 這種欄級授權
      --      **表級那圈看不到、欄級這圈也不看** = 從兩道之間漏過去。
      --    📎 這是「拿掉一個授權」的連帶效應,而它**不在 codex 的 finding 裡** ——
      --      折 finding 的動作本身會製造新的面,折完要重走一次自己的檢查清單。
      FOR v_col IN
        SELECT attname FROM pg_attribute
         WHERE attrelid = to_regclass('public.admin_user_staff_map') AND attnum > 0 AND NOT attisdropped
      LOOP
        FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','REFERENCES'] LOOP
          IF has_column_privilege('service_role', to_regclass('public.admin_user_staff_map'), v_col, v_priv) THEN
            v_bad := coalesce(v_bad || ', ', '') || format('欄級 %s.%s', v_col, v_priv);
          END IF;
        END LOOP;
      END LOOP;

      -- 🔴🔴🔴 第三道:**`SET ROLE` 可達的權限**(2026-08-16 實測,關卡2 R3 的修法【還不夠】)
      --
      --    R3 建議用 `has_table_privilege` 取代 `relacl`。**那只關掉欄級與【已繼承】那半。**
      --    實測(拋棄式 PG 17.10):
      --      service_role 是 NOINHERIT、且是某個持有 UPDATE 的角色的成員時 ——
      --        has_table_privilege('service_role', …, 'UPDATE')  ⇒ **f**
      --        set role service_role; set role <那個角色>; UPDATE ⇒ **UPDATE 1(真的改得動)**
      --    ⇒ **那個權限【是可達的】,而 has_table_privilege 說它不存在。**
      --
      --    📎 這與本 repo `docs/patterns/revoking-function-execute-in-supabase.md` §3.5
      --       記的是同一件事(函式版):`has_function_privilege` 回 f 而 `pg_has_role(…,'SET')` 回 t。
      --       🔴 **我在那份檔裡寫過這條,然後在這裡漏用了它。**
      --
      --    ⚠️ 另一個實測到的坑:`GRANT <role> TO <role>` 的繼承旗標是【授與當下】決定的
      --       ⇒ 事後 `ALTER ROLE … INHERIT` **不會**讓既有 membership 變成繼承。
      -- ══════════════════════════════════════════════════════════════════
      -- 🔴 第 2 層(丙案 MA-1):權限清單【由伺服器自己推導】,不手寫
      -- ══════════════════════════════════════════════════════════════════
      -- `acldefault('r', …)` 展開 = **這台伺服器上表物件的完整權限集**
      -- ⇒ PG 日後新增權限型別**自動入列**,不必有人記得回來加。
      -- 實測(B 窗獨立複驗,拋棄式 PG 17.10;V 窗 E6 亦同):
      --   ⇒ DELETE INSERT MAINTAIN REFERENCES SELECT TRIGGER TRUNCATE UPDATE 共 **8** 項
      --   雙向對照(重點不是那個 8):MAINTAIN 在裡面=t / SELECT 在裡面=t / 'NOTAPRIV' 在裡面=**f**
      --   ⇒ **這把量具分得出「有」與「沒有」。**
      -- ⚠️🔴 **這裡原本寫「`DISTINCT` 是承重的」,對本段而言那是錯的,已更正**
      --    (adversarial-reviewer 2026-08-17:拿掉 `DISTINCT` ⇒ **37 格全綠**;
      --     結構上也不可能有差 —— `v_reach` 的推導集住在 `EXISTS` 子查詢裡,
      --     只影響「有沒有任一列」,**不進外層列集** ⇒ 重複與否對結果無影響。)
      --    它引的理由(`acldefault('f',…)` 回兩筆 EXECUTE,owner + PUBLIC,實測確認 = 2)
      --    **只對已經不存在的 `CROSS JOIN LATERAL` 版本成立**。
      --    📎 這正是本檔 `v_reach` 段自己寫的病的反面:過期註解不只會叫人刪掉有用的 code,
      --       也會叫人**保留一個 no-op 並以為它在做事**。
      --    ✅ `DISTINCT` 真正承重的地方是上面兩個 **FOR 迴圈**(重複一項 ⇒ 多算一次),
      --       理由寫在那兩處。這裡的 `EXISTS` 沒有用 `DISTINCT`,也不需要。
      --
      -- ⚠️🔴 **這裡從【手寫四臂】換成【完整 8 項】,是語意變更,理由寫在這裡好被反駁:**
      --    舊版查 DELETE / TRUNCATE / 欄級 UPDATE / 欄級 REFERENCES —— **刻意不含 SELECT 與 INSERT**,
      --    **而那個「刻意」的理由沒有落檔**(我追 git log 也只追到自己補欄級的那幾顆)。
      --    V 窗 2026-08-17 實測後給出的答案是:**漏 INSERT 是【真洞】,不是嚴格度風格題** ——
      --      · 本表的白名單有一個**沒綁的空位**(`staff_1` 刻意不綁,見規格 §3)
      --      · 可達角色只要持有 **INSERT**,就能把**任意 `auth_user` 綁上 `staff_1`**
      --        ⇒ **憑空造出一個員工身分**
      --      · 而 `no_rebind` trigger **只攔 UPDATE**,`no_delete`/`no_truncate` 攔不到 INSERT
      --    ⇒ 這不是「比原意嚴」,是**把原意沒寫下來所以沒人發現的洞關掉**。
      --    📎 結構理由(丙案已裁的原則):**「查的集合」與「可接受的集合」不要混在同一個地方。**
      --       查的集合 = 完整 8 項(恆等於世界);可接受的 = 交給白名單表達。
      --    📎 V 窗同世界對照實測:乾淨世界(service_role 只有直授 SELECT,INSERT、**無可達角色**)
      --       四臂與完整 8 項【都是空的】。
      --    ⚠️🔴 **這句原本接「⇒ 換法不會憑空多出原版沒有的紅」,那半句已刪 —— 它被實測推翻**
      --       (code-reviewer 2026-08-17,獨立構造):造一個**只持有表級 SELECT 的可達角色**
      --         現行 guard ⇒ `rc=3`,報「可 SET ROLE 到的角色持有本表權限:sel_only」
      --         同一世界的舊四臂謂詞 ⇒ **回空**
      --       ⇒ **換法【確實】會多出原版沒有的紅**,而且那正是它該做的事(SELECT 也能讀走綁定關係)。
      --       📎 病的形狀:**量到的是「乾淨樁」那一個世界,寫出來的是全稱句。**
      --         上一行「無可達角色」這個前提就寫在同一段,而結論句把它丟了。
      -- 🔴🔴🔴 **表級與欄級【餵不同的集合】,這是承重的分家,不是風格**
      --    (2026-08-17 B 窗接手第一件;來源 = code-reviewer Critical,B 窗本機 PG 17.10 獨立複驗)
      --
      --    **病**:上一版把機械推導的完整 8 項【同時】餵給兩個 `has_*`。
      --    而 `has_any_column_privilege` **只吃四種**,其餘四種直接丟 ERROR。
      --    B 窗實測(PG 17.10 Homebrew,逐一單問,每種各一次):
      --      SELECT / INSERT / UPDATE / REFERENCES ⇒ 回 f(正常作答)
      --      DELETE / TRUNCATE / TRIGGER / MAINTAIN ⇒ `ERROR: unrecognized privilege type`
      --    對照組(同一庫、同一角色、同一張表):`has_table_privilege` **八種全部正常回 f**
      --    ⇒ **量具分得出兩個世界,不是「都壞掉」。**
      --
      --    **它為什麼在樁上看不出來**(B 窗雙世界實測,同一支檔、同一顆叢集):
      --      零可達角色           ⇒ rc=0            ← WHERE 根本沒對任何一列求值
      --      一個【零權限】可達角色 ⇒ rc=3,`ERROR: unrecognized privilege type: "TRUNCATE"`
      --    ⇒ **正式庫只要存在任何一個 service_role 可 SET ROLE 到的角色(哪怕它對本表零權限),
      --      整支 apply 當場死。** 而那個角色有沒有權限完全不影響 —— 死的是【問問題這個動作】本身。
      --    📎 形狀:守門自己炸掉,而它在開發樁上是綠的。
      --
      -- ⚠️🔴 **上面那句是【條件句】,而那個條件今天不成立 —— 這行必須跟它一起讀**
      --    (2026-08-17 05:12 UTC,E 窗以 `pcm_audit_ro` 唯讀量於**報價單庫**=本檔落點):
      --      `select rolname from pg_roles
      --         where pg_has_role('service_role', oid, 'SET') and rolname <> 'service_role'`  ⇒ **0 列**
      --      正向對照:`authenticator` 可 SET 到 anon / authenticated / service_role(非零)
      --      ⇒ 那個 0 是**量出來的**,不是憑證被鎖住而看不到。
      --    ⇒ **所以這個 Critical 在正式庫上【不會發作】,而第 2 層在正式庫上判別力為零。**
      --    🔴 **不要把修掉它讀成「避免了一次正式庫事故」** —— 以此時點,它本來就不會炸。
      --      修它的理由是:**角色是後台點一下就能加的,而這支 migration 只跑一次、不會重跑**
      --      ⇒ 危險窗口正好落在 apply 那一刻。**今天的 0 只保證今天。**
      --    ⇒ **apply 之前必須當場重跑那支查詢**(步驟寫在
      --      `docs/specs/2026-08-17-b1-apply-preflight.md` §`#8`,那是步驟不是註腳)。
      --
      --    **為什麼欄級這半只能【具名硬寫】**:`acldefault('c', …)` 實測回 `{}`
      --    ⇒ **沒有機械來源可用**。MA-1「不准手寫」的方向對,但它管的是【表級推導集】;
      --    欄級這四種是 PG 語法層面的封閉集合(GRANT 的 column_privilege 文法只有這四個),
      --    不是「我懶得推導」。日後 PG 若新增可欄級授權的權限型別,這裡要有人回來加 ——
      --    ⚠️ **這是一筆已知的、有主人的債,不是漏掉。**
      --
      --    **為什麼用 `EXISTS` 兩段而不是 `p.privilege_type IN (…) AND has_any_column_privilege(…)`**:
      --    PostgreSQL **不保證** WHERE 裡 AND/OR 子運算式的求值順序
      --    (官方 Expression Evaluation Rules 逐字:"the order of evaluation of subexpressions is not defined")
      --    ⇒ 靠短路擋掉四種非法值的寫法,**能不能活取決於 planner 當天怎麼排** = 又一個間歇性的死法。
      --    `EXISTS` 兩段的作法是**根本不把非法值餵進去**,與求值順序無關。
      SELECT string_agg(DISTINCT r.rolname, ', ' ORDER BY r.rolname) INTO v_reach
        FROM pg_roles r
       WHERE pg_has_role('service_role', r.oid, 'SET')
         AND r.rolname <> 'service_role'
         AND (
              -- 表級:走機械推導(丙案 MA-1)。完整 8 項,PG 日後新增權限型別自動入列。
              -- 🔴 owner 取**本表真正的 `relowner`**,不寫死 `'postgres'::regrole`
              --    (2026-08-17 B 窗實測後改;下面 `v_extra` 段本來就是這樣寫的,這裡對齊它)。
              --    ① 寫死的那版在**沒有 `postgres` 這個角色**的叢集上直接
              --       `ERROR: role "postgres" does not exist` ⇒ 整支 apply 死。
              --       (實測:`initdb -U bossman` 的叢集上 `pg_roles` 內 `postgres` 計數 **0**、
              --        `bossman` 計數 **1**(正向對照)⇒ 該版當場報上面那個 ERROR。)
              --    ② 而寫死**換不到任何東西**:owner 只決定「誰」拿到預設權限,
              --       **不決定權限型別的集合**。同一顆叢集實測兩個不同 owner,
              --       展開都是 `DELETE INSERT MAINTAIN REFERENCES SELECT TRIGGER TRUNCATE UPDATE`(8 項)。
              --    ⚠️ 正式 Supabase **確實有** `postgres` 角色 ⇒ 舊寫法在那裡不會炸。
              --       改它不是因為今天會壞,是因為它是一個**換不到好處的未驗證依賴**。
              EXISTS (
                SELECT 1
                  FROM pg_class oc
                  CROSS JOIN LATERAL aclexplode(acldefault('r', oc.relowner)) d
                 WHERE oc.oid = to_regclass('public.admin_user_staff_map')
                   AND has_table_privilege(r.oid, oc.oid, d.privilege_type)
              )
              -- 欄級:PG 只允許這四種欄級授權(見上面實測),**故意具名**。
           OR EXISTS (
                SELECT 1
                  FROM unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS c(privilege_type)
                 WHERE has_any_column_privilege(r.oid, to_regclass('public.admin_user_staff_map'),
                                                c.privilege_type)
              )
         );
        -- 🔴🔴 **上面兩段【不是】重複,前一版的註解說反了,已更正**:
        --    舊註解寫「`has_any_column_privilege` 嚴格蘊含 `has_table_privilege` ⇒ 前者是便宜的防禦深度」。
        --    那句話**只對那四種成立**。分家之後:
        --      DELETE / TRUNCATE / TRIGGER / MAINTAIN **只有表級那段查得到**
        --    ⇒ **表級那段是承重的,刪掉它會靜默漏掉四種權限**(其中 TRUNCATE 能清空整表、
        --      不受 RLS 管、也不觸發 DELETE trigger)。
        --    ⚠️ 保留這行是因為**過期的註解會叫下一個人去刪一段有用的 code**,而它讀起來很有道理。
        --
        -- 📎 欄級那段的來歷(保留,因為它擋掉的洞還在):
        --    可 SET ROLE 過去的角色若只被授**欄級** `UPDATE(auth_user_id)`,表級查法看不到它
        --    —— 而那正是最要命的一欄:改它就等於**把某人的登入帳號重綁到別人的員工身分上**。
        --    這裡曾經寫成 `unnest(ARRAY['auth_user_id','staff_id'])` 兩欄枚舉 ⇒ **對枚舉外的欄盲**
        --    (本表第三欄 `created_at` 就在枚舉之外)。`has_any_column_privilege` 涵蓋所有欄含未來新欄。
        -- ⚠️🔴 **這裡原本寫「負測 = harness `A13c`(退回兩欄枚舉即變綠)」,已作廢**
        --    (code-reviewer 2026-08-17:同一顆 commit 的 `harness` 覆蓋表明文宣告那句不成立,
        --     **而兩檔對同一件事講反,apply 當天被讀的是 .sql 這一份**)。
        --    實測:把第 2 層整段停用,`A13c` **照樣紅** ⇒ 它不是第 2 層的負測,
        --    它被第 1 層 `attacl` sweep 與 `v_reach` **雙重覆蓋**、隔離不出任何一段。
        --    ⇒ **欄級這半目前沒有專屬負測**(第 2 層的專屬負測是 `MA-2b`)。不要在這裡假裝有。
        --    ⚠️ V 窗 `V-020 F-V20-1` 當初給的失敗情境是「角色只被授 `UPDATE(label)`」——
        --       **本表沒有 `label` 欄**(它住在 A 庫的 `staff` 表)。**結論對而理由錯**,
        --       照那個理由寫負測會靜默失敗(`run_sql` 吞 stderr)⇒ 格子變綠 ⇒ 看起來像「修法沒生效」。
      IF v_reach IS NOT NULL THEN
        -- 🔴 訊息寫「持有**本表權限**」不是「持有寫權」(code-reviewer 2026-08-17 抓):
        --    上面的謂詞含 SELECT / REFERENCES / TRIGGER / MAINTAIN 與四種欄級 ——
        --    一個**只有 SELECT** 的可達角色也會走到這裡,而舊訊息會叫 apply 當天的操作者
        --    **去找一個不存在的「寫權授與」**。訊息比謂詞窄 ⇒ 把人指向錯的地方。
        v_bad := coalesce(v_bad || ', ', '') || format('可 SET ROLE 到的角色持有本表權限:%s', v_reach);
      END IF;

      -- ═══════════════════════════════════════════════════════════════════
      -- 🔴 本斷言的【已知殘留】—— 寫在這裡,因為讀這支 SQL 的人才是會被它影響的人
      -- ═══════════════════════════════════════════════════════════════════
      -- 上面三道只在【apply 的這一刻】成立。日後有人下
      --     GRANT <某個持有本表寫權的角色> TO service_role;
      -- 這支 migration **不會重跑** ⇒ 權限被重新打開,而沒有任何東西會叫。
      --
      -- 🔴🔴 **這道殘留不能用 event trigger 關。** 不是「效果差一點」,是**根本不觸發**:
      --    PostgreSQL 17 官方文件 Event Trigger Definition 逐字
      --    (2026-08-16 由 V 窗查證、本窗當場再讀一次原文確認;正式庫 17.6 / 拋棄式 17.10 同 major):
      --      "As an exception, however, this event does not occur for DDL commands
      --       targeting shared objects — databases, roles, and tablespaces —
      --       or for commands targeting event triggers themselves."
      --      https://www.postgresql.org/docs/17/event-trigger-definition.html
      --      https://www.postgresql.org/docs/17/event-trigger-matrix.html
      --        (Firing Matrix:GRANT / REVOKE 的 ddl_command_end 欄是 X,註「Only for local objects」)
      --    ⇒ `GRANT <role> TO <role>` targets **roles = shared object** ⇒ **不觸發**。
      --    ⚠️ **而它會失敗得非常安靜**:event trigger 建得起來、掃描掃得到它、測試也綠,
      --       **它只是永遠不會被呼叫。機制存在本身會讓下一個人停止追問。**
      --       ⇒ **不要伸手拿 event trigger 來關這道。**
      --
      -- 🔴🔴 **而「這道」只指【role membership 的 GRANT】—— 不要把它讀成「event trigger 沒用」。**
      --    界線是官方那句例外的字面:**shared objects(databases / roles / tablespaces)不觸發**。
      --    ⇒ 目標是**表**的 DDL 是 local object,**照樣觸發**。
      --    B 窗 2026-08-17 實測(PG 17.10,`ddl_command_end`,附雙向對照):
      --      ① `ALTER TABLE … DISABLE ROW LEVEL SECURITY` ⇒ **觸發**(命中 1)
      --      ② 正向對照 `ALTER TABLE … ADD COLUMN`        ⇒ 觸發(命中 1)← 量具是活的
      --      ③ 反向對照 `CREATE ROLE`                     ⇒ **不觸發**(命中 0)← 與本段一致
      --    ⇒ **同一個機制,對 RLS 有用、對 role 沒用。結論相反,不可互相套用。**
      --    📌 要不要真的建一個來守「apply 後 RLS 被關」= 新機制、新常駐物件(鐵則 8 + 12),
      --      **本窗不自己建**,已列為給 Sean 的選項,連同它的真成本一起寫在
      --      `docs/specs/2026-08-17-b1-apply-preflight.md` §`#7`:
      --      **event trigger 只在 DDL 當下叫,叫完要有人看得到** ——
      --      沒有「人會讀到的警報去處」之前,它和 `pg_cron` 是同一族。
      --
      -- 唯一能關的做法 = `pg_cron` 週期重跑本段斷言。
      -- 🔴 **而本窗 2026-08-16 判「不現在建」**,理由寫在這裡好被反駁:
      --    ① 能下那個 GRANT 的人本來就有 DB 管理權 ⇒ 他也刪得掉 cron job
      --       ⇒ 它防的是**意外**不是攻擊,而防意外的價值取決於「有沒有人看得到警報」。
      --    ② `pg_cron` 失敗只寫進 `cron.job_run_details` —— **那張表沒有人在讀**
      --       ⇒ 建了它就是又一個「裝上去、看得到、沒人會發現它在叫」的機制,
      --         和上面那個被標為無效解的 event trigger **是同一族**,只是失敗得大聲一點點。
      --    ⇒ **處置:改 backlog,前置條件 = 先有一個【人會真的讀到】的警報去處。**
      --       那一格填得出來就建;填不出來之前建它,是拿機制的份量換一個心安。
      --    ⚠️ 這是判斷、可被推翻。要現在建的話請直接指定警報去哪裡。

      IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION E'新物件收權斷言:service_role 的【有效 + 可達權限】不符,預期恰好 {SELECT}。\n'
          '   不符處:%\n'
          '   🔴 來源有三種,修法不同:\n'
          '      ① 直接授權(含 ADP)⇒ `REVOKE ALL ON TABLE … FROM service_role;` 放在 GRANT 之前\n'
          '      ② 欄級授權        ⇒ `REVOKE … (欄名) ON TABLE … FROM service_role;`\n'
          '      ③ **可 SET ROLE 過去的角色持有** ⇒ **REVOKE 收不掉** —— 要拆 role membership\n'
          '   ⚠️ UPDATE 能重綁身分、TRUNCATE 能清空整表且不受 RLS 也不觸發 DELETE trigger。', v_bad;
      END IF;
    END;

    SELECT string_agg(DISTINCT a.grantee::regrole::text, ', ')
      INTO v_extra
      FROM pg_class c
           CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     WHERE c.oid = to_regclass('public.admin_user_staff_map')
       AND a.grantee <> 0                                   -- 0 = PUBLIC,下面單獨判
       AND a.grantee::regrole::text NOT IN ('service_role', current_user)
       AND a.grantee <> c.relowner;
    IF v_extra IS NOT NULL THEN
      RAISE EXCEPTION E'新物件收權斷言:除了 owner 與 service_role,還有這些角色持有權限:%\n'
        '   ⇒ 逐一確認它們該不該有。要放行請在本檔明列理由,不要擴大 allow-list 了事。', v_extra;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c
                    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                   WHERE c.oid = to_regclass('public.admin_user_staff_map') AND a.grantee = 0) THEN
      RAISE EXCEPTION '新物件收權斷言:PUBLIC 仍持有本表權限。';
    END IF;
  END;

  IF v_checked = 0 THEN
    RAISE EXCEPTION '新物件收權斷言:檢查數為 0 —— 這個斷言沒有分母,不算通過。';
  END IF;

  IF v_bad > 0 THEN
    RAISE EXCEPTION E'❌ 新物件收權斷言失敗:anon/authenticated 仍持有 % 項權限(第一個:%)。檢查了 % 個物件。\n'
      '   ⇒ 補上:REVOKE ALL ON <物件> FROM PUBLIC, anon, authenticated;\n'
      '   🔴 兩道都要下:FROM PUBLIC 收不到具名授權，FROM 具名 收不到 PUBLIC 授權。',
      v_bad, v_first, v_checked;
  END IF;

  RAISE NOTICE '✅ 新物件收權斷言通過:檢查 % 個物件,anon/authenticated 權限 0 項。', v_checked;
END
$newobj_guard$;

COMMIT;
