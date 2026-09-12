-- 20260912050000_m4b_mgr0_staff_write_rpcs.sql
-- ⟦b4-MGR0-RPC⟧ 員工名單的三支寫入改走 SECURITY DEFINER RPC:**查核與寫入同一筆交易**,稽核同筆寫。
-- plan `docs/plans/2026-09-07-mgr0-rpc-toctou-plan.md`(§12 五格規格 + §13 2026-09-12 更新)。
-- Sean 2026-09-12 批准實作,並答:**Q1 甲**(EXECUTE 沿用現有的 `service_role`,不另開角色)、
--                                **Q2 甲**(稽核與寫入綁同一筆交易,沒稽核就不算改成功)。
-- 🔵 **不宣告 `pcm:idempotent`** —— 三支刻意用**裸 `CREATE`**(見下面那段), 重貼會當場紅。
--   那是 fail-closed 的預期行為, 不是缺陷;而本支**零頂層 DML** ⇒ 冪等宣告閘本來就不會叫它。
--   ⛔ ~~pcm:idempotent: yes / 三支都是 CREATE OR REPLACE~~ —— 我第一版這樣寫, **與碼相反**(Fable 審 nit 3)。
--
-- ── 本支解的是什麼(一句)────────────────────────────────────────────────────
--   今天 `staff-actions.ts` 是【先查核、後寫入】兩段(`.rpc(` 命中 0):
--   `authorizeManagerMutation()` 查完到 `insertStaffRow/updateStaffProfileRow/setStaffActiveRow`
--   寫下去之間,那個人可能已經被停用 ⇒ **停權的人仍改得動名單**,而稽核只會記「他做的」。
--   ⇒ 本支把查核與寫入包進同一支 RPC、同一筆交易、同一把鎖。
--
-- ── 🔴 對 plan §12-1 的一處【訂正】(不是實作細節, 是型別)──────────────────
--   plan 寫 `p_actor uuid` / `p_id uuid`。**錯的** —— 唯讀實查:`public.staff.id` 是 **text**
--   且帶 `staff_id_format CHECK (id ~ '^[a-z0-9_]{1,64}$')`(actor 實際值例:`sean`)。
--   ⇒ 三支一律用 `text`。照 plan 的 uuid 寫下去會**當場型別錯**(而那是好的失敗方向)。
--   🔵 **第二處訂正**:plan §12-1 的 `admin_staff_create` 列了 `p_is_active`, 本支**沒有收它** ——
--      新人一律吃 `staff.is_active DEFAULT true`, 與 app 今天的 `StaffInsert`(`staff-repository.ts:11-15`
--      只有 id / label / is_manager)一致。⇒ 要停用一個人請走 `admin_staff_set_active`, 不要在建立時就給。
--
-- ── 🔴 第三處訂正:`search_path` 是空字串, 不是 `public, pg_temp` ────────────
--   我第一版寫 `SET search_path = public, pg_temp`, 被 `.husky` 的
--   `scripts/definer-search-path-gate.py` 擋下來(三支全中)。它的理由逐字:
--   「把可寫的 schema 排在 pg_catalog 前面 = SECURITY DEFINER 提權的標準路徑
--     (repo 零處 REVOKE CREATE ON SCHEMA public ⇒ 任何人都建得出同名函式)」。
--   ⇒ 三支一律 `SET search_path = ''`, body 裡的物件全部帶 schema 全名
--     (`public.staff` / `public.admin_audit_log` / `pg_catalog.jsonb_build_object` / `pg_catalog.btrim`)。
--   🔵 型別名(text / boolean / jsonb / integer)不必帶 —— `pg_catalog` 永遠隱含在最前面。
--   ⚠️ 這一處 **Fable 與八道靜態檢查都沒抓到**, 抓到它的是那道 husky 閘;
--      而 `search_path=''` 是**執行期**才會炸的東西 ⇒ 改完整套功能情境重跑一次(全過)。
--
-- ── 規格逐條落點(plan §12-1 / §12-3 / §12-4)──────────────────────────────
--   ① 三支【各自】的 SET 欄位集合是規格:create=label/is_manager · update_profile=label/is_manager
--      · set_active=is_active。🛑 **不得併成一支萬用 update** —— 那會丟掉
--      `staff-repository.ts:83-84 / :103-104` 兩句註解守的東西(stale write 讓 is_active 自行復活 /
--      用舊表單值覆蓋 label)。
--   ② 身分閘只准 `SELECT … INTO` + `IF NOT FOUND` + `coalesce(…, false)`(§9-1 那個洞:
--      `IF NOT (SELECT …)` 在 actor 不存在時是 NULL ⇒ 不 RAISE ⇒ **不存在的 actor 反而過關**)。
--   ③ 鎖序寫死:**全域升冪** —— 一發 `WHERE id IN (p_actor, p_id) ORDER BY id FOR UPDATE`
--      (兩列同時拿、由 id 決定先後;actor = 目標時集合只有一個元素 ⇒ 自然只鎖一次)。
--      進 RPC 先 `SET LOCAL lock_timeout = '3s'`。
--      🔴 **訂正**:plan §12-1 與本檔第一版寫「先鎖 p_actor 再鎖 p_id」,那是**死結的配方**
--      (Fable 2026-09-12 審 consider-1)—— A 改 B 與 B 改 A 同時跑, 兩邊各自先鎖自己 ⇒ 互等。
--      實測(拋棄式 PG 17.10):**照 app 的真實形狀 —— 每發 RPC 各自一個交易** ——
--      A 改 B 與 B 改 A 各 60 發同時對跑:本支形狀 deadlock **0**、lock timeout **0**、
--      120 發全 ok、稽核 120 列;負對照換成舊形狀跑同一個迴圈 ⇒ `deadlock detected` 命中 1
--      ⇒ 這把尺讀得到死結, 所以上面那個 0 不是「沒量到」。
--      🔵 `ORDER BY id ... FOR UPDATE` 的鎖序是真的:`EXPLAIN` 印 `LockRows -> Sort`
--         (Sort 在 LockRows **底下** ⇒ 先排好才鎖)。
--
-- ── 🛑 鎖序護不到的那一格(實測出來的, 不是推的)──────────────────────────
--      **全域升冪只在【一個 statement 之內】成立。** 把**兩發 RPC 包進同一個交易**
--      (`BEGIN; 改自己; 改對方; COMMIT;`)⇒ 第一發先單獨鎖住自己那一列,
--      第二發才要對方 ⇒ 兩邊互等 ⇒ **實測真的死結了**(我第一版測法就是這個形狀,
--      而我一開始把它讀成「本支有病」—— 不是, 是那個測法不是 app 的形狀)。
--      ✅ 今天安全的理由是 **app 那半每發 `.rpc()` 各自一個交易**。
--      🔴 ⇒ **接線 `staff-actions.ts` 那一步不要把兩發 RPC 包進同一個交易 / 同一個 batch。**
--   ④ `DUPLICATE` / `NOT_FOUND` 保留成**可預期結果**(回 jsonb),不退化成 RAISE ——
--      呼叫端今天就是靠它給使用者訊息(`staff-repository.ts:71-72`)。
--   ⑤ 稽核與寫入同交易 + 筆數守(Sean Q2 甲);動作名**沿用今天 app 寫的那四個**
--      (`settings.staff.create` / `.update` / `.deactivate` / `.reactivate`)⇒ 歷史不斷代。
--   ⑥ `p_request_id` 空 ⇒ RAISE:`admin_audit_log.request_id` 是 NOT NULL + CHECK(<>'')
--      (`20260828090000:96-104` 那段逐字記著它躲過 codex 三輪的經過)。
--
-- ── 🛑 本支【解不掉】什麼(要跟著 plan §12-2 一起讀)──────────────────────
--   後台走 `service_role` 連線 ⇒ DB 看到的呼叫者永遠是 service_role ⇒ **`p_actor` 由應用層傳**。
--   本支解的是 TOCTOU 那一半,**解不掉「service_role 金鑰外流後有人自填 p_actor」**。
--   🔴 不得把「包進 RPC」寫成「順便修好了冒名」。那是兩件事。
--
-- ── EXECUTE(Sean Q1 甲)──────────────────────────────────────────────────
--   三道 REVOKE 一道都不省(`REVOKE … FROM PUBLIC` 收不掉具名角色的直接授權,
--   板列 ⟦auth-HALFREVOKEDTRIGGERS⟧ 末格 2026-09-09 訂正過),GRANT 只給 `service_role`。
--
-- ── ROLLBACK ═══════════════════════════════════════════════════════════════
--   `supabase/rollbacks/20260912050000-rollback.sql`:DROP 這三支。
--   🔵 forward-only 的意思是**應用層**:回退 = 把 `staff-actions.ts` 改回呼三支 repository 函式;
--     而三支 RPC 沒有呼叫端時留著是零風險 ⇒ **rollback 檔預設不跑**,只在確定沒有呼叫端時才 DROP。

BEGIN;

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.staff') IS NULL THEN
    RAISE EXCEPTION '前置閘①:找不到 public.staff';
  END IF;
  IF pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '前置閘②:找不到 public.admin_audit_log';
  END IF;
  -- 🔴 型別閘:本支三支的簽章吃 text。哪天 staff.id 換成 uuid,這裡要當場停,
  --    而不是讓三支用一個再也對不上的型別活著。
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name='staff' AND column_name='id') <> 'text' THEN
    RAISE EXCEPTION '前置閘③:public.staff.id 不是 text ⇒ 本支的簽章要重寫,停下';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid='public.admin_audit_log'::regclass
                    AND conname='admin_audit_log_request_id_nonempty') THEN
    RAISE EXCEPTION '前置閘④:admin_audit_log_request_id_nonempty 不見了 ⇒ 本支對 request_id 的假設要重讀';
  END IF;
END $$;

-- 🔴 **三支一律裸 `CREATE FUNCTION`(不是 OR REPLACE)** —— 它們是【新物件】,
--    撞名要當場紅。`OR REPLACE` 會把一個我不知道存在的同名函式靜靜蓋掉, 而 REVOKE 與斷言照樣綠。
--    (static-checks ① 擋過我一次, 這一句是它教的。)

-- ══ 共用形狀(三支逐字相同, 不抽 helper)═══════════════════════════════════
-- 🔴 **刻意不抽成一支共用的「查核 helper」**:抽掉之後三支各自的鎖序與 SET 欄位集合
--    會變成「helper 說了算」, 而本片最要緊的兩件事(鎖序寫死 / SET 欄位集合是規格)
--    正好是**每支不一樣**的那兩件。⇒ 重複三次是刻意的, 改一支不會靜默改到另外兩支。

-- ── RPC 一:新增員工 ────────────────────────────────────────────────────────
CREATE FUNCTION public.admin_staff_create(
  p_actor      text,
  p_id         text,
  p_label      text,
  p_is_manager boolean,
  p_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_is_manager boolean;
  v_row        public.staff%ROWTYPE;
  v_n          integer;
BEGIN
  SET LOCAL lock_timeout = '3s';
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_staff_create: p_request_id 不可為空(稽核那一欄 NOT NULL + CHECK)';
  END IF;

  -- 身分閘:鎖住 actor 自己那一列(§12-3 的形狀, 不可改寫成 IF NOT (SELECT …))
  -- 🔴🔴 **先把這一發要碰的每一列【依 id 升冪】一次鎖完**(Fable 審 consider 1;我第一版寫錯)。
  --    ⛔ ~~先鎖 actor、再鎖目標~~ —— 那**不是**全域鎖序, 它正是 plan §12-3 點名的
  --      「兩支各自先鎖自己」那個配方:A 改 B、B 改 A ⇒ 各自持 share(自己) 等 update(對方) ⇒ 循環;
  --      同一個人雙擊自改也一樣(兩筆都持 share(A) 再各自要 update(A))。
  --    ✅ 用**同一句** `IN (...) ORDER BY id ... FOR UPDATE`:全域升冪、兩列同級鎖 ⇒ 循環不成立。
  --    🔵 `p_actor = p_id` 時 `IN` 自然只有一列, 不必特別處理。
  PERFORM 1 FROM public.staff WHERE id IN (p_actor, p_id) ORDER BY id FOR UPDATE;

  SELECT s.is_manager INTO v_is_manager
    FROM public.staff s WHERE s.id = p_actor AND s.is_active
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  IF NOT coalesce(v_is_manager, false) THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  BEGIN
    INSERT INTO public.staff (id, label, is_manager)
    VALUES (p_id, p_label, coalesce(p_is_manager, false))
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    -- 🔵 可預期結果, 不是例外:呼叫端靠它給使用者「這個代號已經有人用了」。
    RETURN pg_catalog.jsonb_build_object('result', 'duplicate');
  END;

  INSERT INTO public.admin_audit_log
    (actor, action, target, request_id, before, after, reason, source_app)
  VALUES
    (p_actor, 'settings.staff.create', 'staff:' || v_row.id,
     p_request_id,
     NULL,
     pg_catalog.jsonb_build_object('id', v_row.id, 'label', v_row.label,
       'is_manager', v_row.is_manager, 'is_active', v_row.is_active),
     NULL, 'admin');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_staff_create: 稽核落 % 列(期望恰 1)⇒ 改名單與留紀錄必須同生共死', v_n;
  END IF;

  RETURN pg_catalog.jsonb_build_object('result', 'ok',
    'row', pg_catalog.jsonb_build_object('id', v_row.id, 'label', v_row.label,
      'is_manager', v_row.is_manager, 'is_active', v_row.is_active));
END;
$fn$;

-- 🔵 **`updated_at` 不由這三支寫** —— `staff_touch_updated_at` trigger(`20260726120000:57-60`)專屬;
--    寫了會讓「只碰 label/is_manager」「只碰 is_active」那兩句字面變成假的(Fable 審 nit 2)。

-- ── RPC 二:改顯示資料(只碰 label / is_manager)─────────────────────────────
CREATE FUNCTION public.admin_staff_update_profile(
  p_actor      text,
  p_id         text,
  p_label      text,
  p_is_manager boolean,
  p_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_is_manager boolean;
  v_before     public.staff%ROWTYPE;
  v_row        public.staff%ROWTYPE;
  v_n          integer;
BEGIN
  SET LOCAL lock_timeout = '3s';
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_staff_update_profile: p_request_id 不可為空';
  END IF;

  -- 🔴🔴 **先把這一發要碰的每一列【依 id 升冪】一次鎖完**(Fable 審 consider 1;我第一版寫錯)。
  --    ⛔ ~~先鎖 actor、再鎖目標~~ —— 那**不是**全域鎖序, 它正是 plan §12-3 點名的
  --      「兩支各自先鎖自己」那個配方:A 改 B、B 改 A ⇒ 各自持 share(自己) 等 update(對方) ⇒ 循環;
  --      同一個人雙擊自改也一樣(兩筆都持 share(A) 再各自要 update(A))。
  --    ✅ 用**同一句** `IN (...) ORDER BY id ... FOR UPDATE`:全域升冪、兩列同級鎖 ⇒ 循環不成立。
  --    🔵 `p_actor = p_id` 時 `IN` 自然只有一列, 不必特別處理。
  PERFORM 1 FROM public.staff WHERE id IN (p_actor, p_id) ORDER BY id FOR UPDATE;

  SELECT s.is_manager INTO v_is_manager
    FROM public.staff s WHERE s.id = p_actor AND s.is_active
     FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION '無權執行此操作'; END IF;
  IF NOT coalesce(v_is_manager, false) THEN RAISE EXCEPTION '無權執行此操作'; END IF;

  -- 🔴 鎖序:actor 先(上面那一發)、目標後;兩者相同時不重鎖(同交易重複鎖其實是 no-op,
  --    而寫成條件式是為了讓【順序】這件事在碼上看得見)。
  -- 🔵 目標列在上面那一句已經鎖住了(升冪一次鎖完)⇒ 這裡只是把它讀出來當 `before`。
  SELECT * INTO v_before FROM public.staff WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('result', 'not_found');
  END IF;

  UPDATE public.staff
     SET label = p_label, is_manager = coalesce(p_is_manager, false)
   WHERE id = p_id
  RETURNING * INTO v_row;

  INSERT INTO public.admin_audit_log
    (actor, action, target, request_id, before, after, reason, source_app)
  VALUES
    (p_actor, 'settings.staff.update', 'staff:' || v_row.id,
     p_request_id,
     pg_catalog.jsonb_build_object('id', v_before.id, 'label', v_before.label,
       'is_manager', v_before.is_manager, 'is_active', v_before.is_active),
     pg_catalog.jsonb_build_object('id', v_row.id, 'label', v_row.label,
       'is_manager', v_row.is_manager, 'is_active', v_row.is_active),
     NULL, 'admin');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_staff_update_profile: 稽核落 % 列(期望恰 1)', v_n;
  END IF;

  RETURN pg_catalog.jsonb_build_object('result', 'ok',
    'row', pg_catalog.jsonb_build_object('id', v_row.id, 'label', v_row.label,
      'is_manager', v_row.is_manager, 'is_active', v_row.is_active));
END;
$fn$;

-- ── RPC 三:停用 / 啟用(只碰 is_active)────────────────────────────────────
CREATE FUNCTION public.admin_staff_set_active(
  p_actor      text,
  p_id         text,
  p_is_active  boolean,
  p_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_is_manager boolean;
  v_before     public.staff%ROWTYPE;
  v_row        public.staff%ROWTYPE;
  v_n          integer;
BEGIN
  SET LOCAL lock_timeout = '3s';
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id) = '' THEN
    RAISE EXCEPTION 'admin_staff_set_active: p_request_id 不可為空';
  END IF;
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'admin_staff_set_active: p_is_active 不可為 NULL(這一支的全部意義就是那個值)';
  END IF;

  -- 🔴🔴 **先把這一發要碰的每一列【依 id 升冪】一次鎖完**(Fable 審 consider 1;我第一版寫錯)。
  --    ⛔ ~~先鎖 actor、再鎖目標~~ —— 那**不是**全域鎖序, 它正是 plan §12-3 點名的
  --      「兩支各自先鎖自己」那個配方:A 改 B、B 改 A ⇒ 各自持 share(自己) 等 update(對方) ⇒ 循環;
  --      同一個人雙擊自改也一樣(兩筆都持 share(A) 再各自要 update(A))。
  --    ✅ 用**同一句** `IN (...) ORDER BY id ... FOR UPDATE`:全域升冪、兩列同級鎖 ⇒ 循環不成立。
  --    🔵 `p_actor = p_id` 時 `IN` 自然只有一列, 不必特別處理。
  PERFORM 1 FROM public.staff WHERE id IN (p_actor, p_id) ORDER BY id FOR UPDATE;

  SELECT s.is_manager INTO v_is_manager
    FROM public.staff s WHERE s.id = p_actor AND s.is_active
     FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION '無權執行此操作'; END IF;
  IF NOT coalesce(v_is_manager, false) THEN RAISE EXCEPTION '無權執行此操作'; END IF;

  -- 🔵 目標列在上面那一句已經鎖住了(升冪一次鎖完)⇒ 這裡只是把它讀出來當 `before`。
  SELECT * INTO v_before FROM public.staff WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('result', 'not_found');
  END IF;

  UPDATE public.staff
     SET is_active = p_is_active
   WHERE id = p_id
  RETURNING * INTO v_row;

  INSERT INTO public.admin_audit_log
    (actor, action, target, request_id, before, after, reason, source_app)
  VALUES
    (p_actor,
     CASE WHEN p_is_active THEN 'settings.staff.reactivate' ELSE 'settings.staff.deactivate' END,
     'staff:' || v_row.id,
     p_request_id,
     pg_catalog.jsonb_build_object('id', v_before.id, 'label', v_before.label,
       'is_manager', v_before.is_manager, 'is_active', v_before.is_active),
     pg_catalog.jsonb_build_object('id', v_row.id, 'label', v_row.label,
       'is_manager', v_row.is_manager, 'is_active', v_row.is_active),
     NULL, 'admin');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_staff_set_active: 稽核落 % 列(期望恰 1)', v_n;
  END IF;

  RETURN pg_catalog.jsonb_build_object('result', 'ok',
    'row', pg_catalog.jsonb_build_object('id', v_row.id, 'label', v_row.label,
      'is_manager', v_row.is_manager, 'is_active', v_row.is_active));
END;
$fn$;

-- ══ 授權(Sean Q1 甲:沿用現有的 service_role, 不另開角色)══════════════════
REVOKE ALL ON FUNCTION public.admin_staff_create(text,text,text,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_staff_create(text,text,text,boolean,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_staff_create(text,text,text,boolean,text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_staff_update_profile(text,text,text,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_staff_update_profile(text,text,text,boolean,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_staff_update_profile(text,text,text,boolean,text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_staff_set_active(text,text,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_staff_set_active(text,text,boolean,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_staff_set_active(text,text,boolean,text) TO service_role;

-- ══ 事後閘:三支都在 · SECDEF · search_path · 授權恰如預期 ═══════════════════
DO $$
DECLARE
  -- 🔴 清單寫成陣列, 而 static-checks ③ 比的就是它的長度 —— 它防「忘記收權」, **不防「忘記列」**。
  v_functions text[] := ARRAY[
    'public.admin_staff_create(text,text,text,boolean,text)',
    'public.admin_staff_update_profile(text,text,text,boolean,text)',
    'public.admin_staff_set_active(text,text,boolean,text)'];
  v_fn  text;
  v_bad text;
BEGIN
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF pg_catalog.to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION '事後閘①:函式不在 ⇒ %', v_fn;
    END IF;
    -- ② SECURITY DEFINER
    IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure) THEN
      RAISE EXCEPTION '事後閘②:不是 SECURITY DEFINER ⇒ %', v_fn;
    END IF;
    -- ③ search_path 有被釘住(CREATE OR REPLACE 會整組換掉 ⇒ 下一個人改這支時這道會叫)
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = v_fn::regprocedure
                      AND p.proconfig IS NOT NULL
                      AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')) THEN
      RAISE EXCEPTION '事後閘③:沒有釘 search_path ⇒ %', v_fn;
    END IF;
    -- ④ 授權:service_role 叫得動;anon / authenticated 一律叫不動
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘④a:service_role 叫不動 ⇒ %(後台會整個壞掉)', v_fn;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn::regprocedure, 'EXECUTE') THEN
      v_bad := coalesce(v_bad || ', ', '') || v_fn;
    END IF;
  END LOOP;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '事後閘④b:anon / authenticated 竟然叫得動 ⇒ %', v_bad;
  END IF;
END $$;

COMMIT;
