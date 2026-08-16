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
--      DROP TRIGGER  admin_user_staff_map_no_delete_trg ON public.admin_user_staff_map;
--      DROP TABLE    public.admin_user_staff_map;
--      DROP FUNCTION public.admin_user_staff_map_no_delete();
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
  'staff_id 為永久識別碼、永不重用(Sean 2026-08-16 拍板)。';

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

-- ───────────────────────────────────────────────────────────────────────────
--  3. 收權
--     🔴 兩道都要下(規格 §2 / docs/patterns/revoking-function-execute-in-supabase.md):
--        FROM PUBLIC 收不到具名授權；FROM 具名 收不到 PUBLIC 授權。少一道 anon 都碰得到。
--     🔴 新物件【出生那一刻】就自帶 anon/authenticated 權限(Supabase 的 ALTER DEFAULT PRIVILEGES),
--        而那個授權在 repo 裡沒有 GRANT 語句可以被掃到 ⇒ grep 型守門看不到、三綠不紅。
-- ───────────────────────────────────────────────────────────────────────────
REVOKE ALL ON TABLE    public.admin_user_staff_map FROM PUBLIC;
REVOKE ALL ON TABLE    public.admin_user_staff_map FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_user_staff_map_no_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_user_staff_map_no_delete() FROM anon, authenticated;

-- 🔴🔴 **不給 UPDATE**(關卡2 [高] finding,2026-08-16)。
--    原版給了 `UPDATE`,而 `UPDATE` 可以直接把 auth_user_id 或 staff_id 換掉
--    ⇒ **與 DELETE+INSERT 完全相同的重綁效果**,歷史稽核的解讀一樣會翻轉。
--    禁了 DELETE 卻留 UPDATE = 鎖了前門開了後門。
--    ⚠️ 而作者自己的 A9 驗收格【把 UPDATE 驗成綠色】—— 那一格在驗證這個漏洞是好的。
--    ⇒ 本表的兩個識別欄是 append-only:要換人綁定,走 Auth 側 disable + 新增一列新代號。
GRANT SELECT, INSERT ON TABLE public.admin_user_staff_map TO service_role;

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
      '   ⇒ 這張表會建起來但【沒有人寫得進去】,而且要到有人真的寫才會發現。\n'
      '   ⇒ 兩條路擇一,不要硬跑:\n'
      '      (a) 確認正式庫的 service_role 確實有 BYPASSRLS(Supabase 預設有,但【要看過才算】)\n'
      '      (b) 改成明文開一條給 service_role 的 policy,不依賴 BYPASSRLS';
  END IF;
  RAISE NOTICE 'B1-b:service_role 具 BYPASSRLS,RLS 零 policy 的前提成立。';
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
  v_functions text[] := ARRAY['public.admin_user_staff_map_no_delete()']::text[];
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
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('anon', v_oid, v_priv)
         OR has_table_privilege('authenticated', v_oid, v_priv) THEN
        v_bad := v_bad + 1;
        IF v_first IS NULL THEN v_first := format('%s 上仍有 %s', r, v_priv); END IF;
      END IF;
    END LOOP;
    -- 🔴 欄級那圈:has_table_privilege 對【只有欄級授權】回 false
    --    (2026-08-16 實測:表級說沒有、而該角色實際讀得到那幾欄)
    FOR v_col IN SELECT attname FROM pg_attribute WHERE attrelid = v_oid AND attnum > 0 AND NOT attisdropped LOOP
      IF has_column_privilege('anon', v_oid, v_col, 'SELECT')
         OR has_column_privilege('authenticated', v_oid, v_col, 'SELECT') THEN
        v_bad := v_bad + 1;
        IF v_first IS NULL THEN v_first := format('%s.%s 上仍有【欄級】SELECT', r, v_col); END IF;
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
