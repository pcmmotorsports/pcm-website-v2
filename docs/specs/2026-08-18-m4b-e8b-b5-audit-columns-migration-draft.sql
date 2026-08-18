-- ═══════════════════════════════════════════════════════════════════════════
--  B5 稽核欄 · admin_sso_login_events 加 sub_kind / staff_id(A 庫 pcm-website-v2)
--
--  🔴 這是【草稿】。落檔 2026-08-19T00:34 CST(date 實跑) · 作者 G5
--  規格:docs/specs/2026-08-17-m4b-e8b-b5-spec.md §B5-4(5)
--  plan:docs/specs/2026-08-18-m4b-e8b-b5-c1c2-plan.md §3
--
--  ╔═══════════════════════════════════════════════════════════════════════╗
--  ║ 🔴🔴 這支檔【現在不得搬進 supabase/migrations/】                        ║
--  ╚═══════════════════════════════════════════════════════════════════════╝
--  理由與 B1-a 草稿檔頭同一條,不在此重複全文:
--    `supabase db push` 沒有子集旗標 ⇒ 檔一進那個目錄,下一發推就連它一起走,
--    而推的人可能正在推別的東西、根本不知道多了一支。
--  ⇒ 完整論證(含 --include-all 之後順序照發現順序、帳本永久錯位)見
--    docs/specs/2026-08-16-m4b-e8b-b1a-migration-draft.sql 檔頭。
--
--  ╔═══════════════════════════════════════════════════════════════════════╗
--  ║ ⚠️ apply 之前【必須】在目標庫跑一次下方 §3 那張表(不是可選)             ║
--  ╚═══════════════════════════════════════════════════════════════════════╝
--  本機已實測過(見 §3),而本機不等於正式庫:版本與 locale 都可能不同,
--  而其中一條斷言(btrim 的行為)是 locale 敏感的。
--
-- ═══════════════════════════════════════════════════════════════════════════
--  §1 這支檔要做什麼(一句)
-- ═══════════════════════════════════════════════════════════════════════════
--  登入事件表現在記得住「怎麼證明的」(amr),記不住「是誰」(sub)。
--  這支檔補兩欄,讓 SSO 登入那一刻的身分【留得住】。
--
--  🔴 而在 apply 之前,那個身分【只活一小時】——
--     apps/admin/src/lib/sso/login-event.ts 檔頭逐字:console 是「1 小時軌跡」、
--     DB 才是「留得住的那半」。⇒ 講「已經有稽核了」是假的,只有 console 那半。

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
--  §2 forward
-- ═══════════════════════════════════════════════════════════════════════════

-- 🔴 兩欄都必須 NULL-able,兩個理由(缺任一都會讓 apply 當場失敗或讓混版部署壞掉):
--    ① 既有列沒有值
--    ② 混版部署期(admin 新 / 報價單舊)本來就會插入沒有 sub 的列
ALTER TABLE public.admin_sso_login_events
  ADD COLUMN IF NOT EXISTS sub_kind text NULL,
  ADD COLUMN IF NOT EXISTS staff_id text NULL;

COMMENT ON COLUMN public.admin_sso_login_events.sub_kind IS
  '這一次登入的身分【種類】(M-4b E8-B B5)。user / fallback / bootstrap。'
  'NULL = 報價單那端還沒送 sub(混版部署的正常態,不是錯誤)。'
  '🔴 兩軸不要混:sub_kind = 【這是誰】;同表的 amr = 【他怎麼證明的】。'
  '''bootstrap'' 這個字面兩邊都有而是不同軸的值 ⇒ 查詢一律帶欄位名。';

COMMENT ON COLUMN public.admin_sso_login_events.staff_id IS
  '具名身分的員工識別碼,只有 sub_kind = ''user'' 時才有值(M-4b E8-B B5)。'
  '🔴 刻意【不加】報價單側 admin_user_staff_map 那個人員白名單 CHECK:'
  '那個白名單管【誰現在可以被綁定】,而本表記【當時發生過什麼】。'
  '套上去 ⇒ 某人日後被移出白名單的那一刻,寫入歷史本身開始 RAISE,'
  '而本表壞掉的方式會是【登入被稽核擋住】。'
  '⚠️ 代價知情接受:DB 不會擋 typo 與未知 ID ⇒ 報表可能因一個錯字分裂成兩個人。';

-- 值域:只認三個 kind,或 NULL
ALTER TABLE public.admin_sso_login_events
  ADD CONSTRAINT admin_sso_login_events_sub_kind_chk
  CHECK (sub_kind IS NULL OR sub_kind IN ('user', 'fallback', 'bootstrap'));

-- 🔴🔴 跨欄一致性 —— 這裡【必須用 CASE,不得用 OR 串】
--
--    ⛔ 曾經寫成(留訃聞,不要改回去):
--       CHECK ( (sub_kind = 'user' AND staff_id IS NOT NULL)
--            OR (sub_kind IN ('fallback','bootstrap') AND staff_id IS NULL)
--            OR (sub_kind IS NULL AND staff_id IS NULL) )
--
--    🔴 那個寫法【安靜放行】sub_kind IS NULL + staff_id 有值:
--       三段分別是 NULL / false / false ⇒ 整式 = NULL
--       ⇒ 而 Postgres 的 CHECK 對 NULL 是【通過】不是【擋】。
--    ⇒ 它漏掉的正是它要擋的那個狀態。實測見 §3(舊寫法五種非法漏三種)。
--
--    CASE 的每個分支都回真正的布林 ⇒ 沒有 NULL 出口。
ALTER TABLE public.admin_sso_login_events
  ADD CONSTRAINT admin_sso_login_events_sub_shape_chk
  CHECK (
    CASE
      WHEN sub_kind = 'user' THEN staff_id IS NOT NULL AND btrim(staff_id) <> ''
      WHEN sub_kind IS NULL  THEN staff_id IS NULL
      ELSE staff_id IS NULL          -- fallback / bootstrap:兩者都沒有 staff_id
    END
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
--  §3 🔴 apply 期斷言(必跑;雙向表演 —— 好世界要進得去,壞世界要被擋)
-- ═══════════════════════════════════════════════════════════════════════════
--  本機實測結果(拋棄式 PG 17.10、LC_ALL=C、2026-08-19 G5 跑、已收攤驗死):
--
--    sub_kind   staff_id  期望      舊 OR 串   新 CASE
--    user       'sean'    legal     ACCEPT     ACCEPT
--    fallback   NULL      legal     ACCEPT     ACCEPT
--    bootstrap  NULL      legal     ACCEPT     ACCEPT
--    NULL       NULL      legal     ACCEPT     ACCEPT
--    NULL       'x'       ILLEGAL   🔴 ACCEPT  ✅ REJECT
--    user       NULL      ILLEGAL   REJECT     REJECT
--    fallback   'x'       ILLEGAL   REJECT     REJECT
--    user       ''        ILLEGAL   🔴 ACCEPT  ✅ REJECT
--    user       '   '     ILLEGAL   🔴 ACCEPT  ✅ REJECT
--
--  🔴 四個 legal 世界【兩種寫法都 ACCEPT】= 正向對照,證明量具不是「什麼都拒」。
--  ⚠️ 效度限定:本機版本與 locale 與正式庫未核;btrim 是 locale 敏感的
--     ⇒ 下面這一段【要在目標庫真的跑一次】,不是照抄本機結果。
--
--  跑法(在目標庫,交易內,跑完 ROLLBACK ⇒ 零留痕):
/*
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.probe(k text, s text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.admin_sso_login_events (outcome, sub_kind, staff_id)
  VALUES ('success', k, s);
  RETURN 'ACCEPT';
EXCEPTION WHEN check_violation THEN RETURN 'REJECT';
END $$;

SELECT COALESCE(k, 'NULL')                AS sub_kind,
       COALESCE(quote_literal(s), 'NULL') AS staff_id,
       expect,
       pg_temp.probe(k, s)                AS got
FROM (VALUES
  ('user',      'sean', 'ACCEPT'),
  ('fallback',  NULL,   'ACCEPT'),
  ('bootstrap', NULL,   'ACCEPT'),
  (NULL,        NULL,   'ACCEPT'),
  (NULL,        'x',    'REJECT'),
  ('user',      NULL,   'REJECT'),
  ('fallback',  'x',    'REJECT'),
  ('user',      '',     'REJECT'),
  ('user',      '   ',  'REJECT')
) AS v(k, s, expect);

ROLLBACK;
*/
--  🔴 判讀:expect 與 got 必須【逐列相同】。
--     任一列不同 ⇒ 停,不要繼續 apply,回報。
--     🔴 而【全部 REJECT】也是失敗訊號(那表示連好世界都進不去 = 約束寫太緊或表壞了)。

-- ═══════════════════════════════════════════════════════════════════════════
--  §4 rollback
-- ═══════════════════════════════════════════════════════════════════════════
/*
BEGIN;
ALTER TABLE public.admin_sso_login_events
  DROP CONSTRAINT IF EXISTS admin_sso_login_events_sub_shape_chk,
  DROP CONSTRAINT IF EXISTS admin_sso_login_events_sub_kind_chk;
-- ⚠️ 兩個 DROP COLUMN 會【丟掉已經記下的稽核身分】。
--    只在「應用層還沒開始寫這兩欄」時才做;已經有資料 ⇒ 只退約束、留欄。
ALTER TABLE public.admin_sso_login_events
  DROP COLUMN IF EXISTS staff_id,
  DROP COLUMN IF EXISTS sub_kind;
COMMIT;
*/

-- ═══════════════════════════════════════════════════════════════════════════
--  §5 apply 之後【還沒做完】的兩件(不要讀成本檔 apply 完就結案)
-- ═══════════════════════════════════════════════════════════════════════════
--  ① 重新 gen types ⇒ packages/adapters/src/supabase/database.types.ts
--     沒做 ⇒ 應用層寫這兩欄會是型別錯,或被迫用窄 cast 而失去編譯期守門
--  ② login-event.ts 的 DB insert 要真的帶這兩欄
--     🔴 在 ① 與 ② 都做完之前,稽核【只有 console 那半、只活一小時】
