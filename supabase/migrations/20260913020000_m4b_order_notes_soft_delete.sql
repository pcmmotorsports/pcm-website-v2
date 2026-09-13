-- 20260913020000_m4b_order_notes_soft_delete.sql
-- 訂單備註「刪除」:**軟刪除**(三欄 + 一支 owner RPC)。不真的 DELETE、不 UPDATE body。
-- plan `docs/plans/2026-09-13-order-notes-edit-delete-plan.md` §3.2 / §4.2 / §7.2。
-- Sean 2026-09-13 批准該 plan 實作。交辦逐字 `~/pcm-mailbox/0912-後台UX/交辦-會員等級字面統一.md` ④。
--
-- 🔵 **不宣告 `pcm:idempotent`** —— 本支用裸 `CREATE FUNCTION`(不是 OR REPLACE)、
--    `ADD COLUMN` 也不帶 IF NOT EXISTS ⇒ **重貼會當場紅**。那是 fail-closed 的預期行為,不是缺陷。
--    形狀抄 `20260912050000_m4b_mgr0_staff_write_rpcs.sql`(它的檔頭逐字說明為什麼裸 CREATE)。
--
-- ── 本支解的是什麼(一句)────────────────────────────────────────────────────
--   備註今天**只能新增**:`admin_append_order_note`(`20260802150000:14` 逐字「不做 UPDATE / DELETE」)
--   是唯一一支 note RPC,而 `order_notes` 對 service_role **只有 SELECT**
--   (A3 `20260729030000:205-206` 逐字 `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role;`
--    然後只 `GRANT SELECT … TO service_role` —— 寫入是 owner RPC 用 DEFINER 身分做的,
--    ⛔ ~~我第一版寫「SELECT + INSERT」~~ = 假,Fable 2026-09-13 審 nit 1 抓到並經我親查)
--   ⇒ **員工打錯了一則備註,今天沒有任何辦法讓它從時間軸上消失。**
--   本支給它一條路,而且是**軟的** —— 列不會消失、body 不會被改,只是多三欄說「誰在何時為什麼把它收起來」。
--
-- ── 🔴 為什麼是軟刪除,不是 DELETE(plan §4.2,兩個理由缺一不可)────────────
--   ① 交辦檔逐字:「備註是對客人的承諾紀錄,真刪掉之後對帳與客訴就查不到了」。
--   ② **而還有一個交辦檔沒寫的技術後果**:`corrects_note_id` 指向被刪的列 ⇒ 顯示層的
--      `walkCorrectionChain()`(`apps/admin/src/lib/orders/note-timeline.ts:197-241`)會回
--      `stop: 'missing'`,而 `missing` 在現行語意裡是**「指向不在已載入範圍」= 資料截斷訊號**。
--      📌 **硬刪會讓「正常的刪除」與「資料載入不全」印同一個狀態。** 軟刪不製造這個歧義。
--
-- ── 🔴 `deleted_reason` 為什麼是**必填**(而 Sean 還沒答)─────────────────────
--   plan §6.4 把「理由必填與否」列為待答,理由逐字是「必填 ⇒ 是 DB CHECK,事後補約束會撞既有列」。
--   ⇒ 而 `order_notes` 正式庫**今天 0 列**(2026-09-13 唯讀實查)⇒ **那個擋路理由的前提不成立**。
--   ⇒ 主視窗 2026-09-13 裁:先做必填。放寬 = `DROP CONSTRAINT` + `ADD CONSTRAINT` 兩句
--      (⛔ ~~我第一版三處都寫「一句」~~ —— 只 DROP 會讓 `(deleted_at, NULL, NULL)` 合法,
--       那正是本檔 `order_notes_deleted_triple_together` 要擋的「查不到責任的刪除」。Fable 審 nit 2);
--      收緊則要先確認既有列合規 ⇒ **不對稱仍然成立**。
--   🔴 **而必填有一個副作用,寫在這裡免得它安靜上線**:
--      **必填會製造假理由** —— 想不出理由的員工會打「.」或「刪除」,
--      而**一個被亂填的必填欄,比一個空的選填欄更糟:它看起來像個理由。**
--      ⇒ 那是產品面取捨,已請主視窗端給 Sean。他若改選填 ⇒ 見 rollback 檔的 §B(DROP + ADD 兩句)。
--   ⚠️ 刻意**不加**「最少幾個字」那種長度門檻 —— 那只會把「.」變成「....」,擋不住而且多一條規則。
--
-- ── 🔴 授權:manager 那道閘在 **app 層**,不在本 RPC 裡(刻意,理由要讀完)──
--   plan §3.2 / §4.3:刪除限 manager,走既有 `authorizeManagerMutation()`
--   (先例兩支:`apps/admin/src/lib/mail/dead-letter-actions.ts:46`、
--    `apps/admin/src/lib/orders/manual-cancel-notice-actions.ts:70,211,356`)。
--   ⚠️ **而昨天才落地的 `20260912050000` 正是為了把同型的閘從 app 層搬進 RPC**(TOCTOU:
--      查核到寫入之間那個人可能已被停用)⇒ **為什麼本支不跟進,要說得出來:**
--        · 員工名單那支的最壞情況是**被停權的人把自己改回啟用** = 提權、永久、且下一次查核就過關。
--        · 本支的最壞情況是**剛被停權的人把一則備註收起來** = 軟的、留全稽核、可一句 SQL 還原。
--      ⇒ 嚴重度不同一個量級 ⇒ 照 plan 與主視窗的明文「抄既有兩個先例、不要自創」。
--   📌 **而這個判斷要能被推翻**:哪天 `order_notes` 上長出不可逆的動作,這一段就要重讀。
--   🛑 本支**不查 `public.staff`** ⇒ 它**不宣稱**自己擋得住非 manager。擋得住的是 app 層那道。
--
-- ── 回傳固定碼 8 碼(呼叫端必須斷言 ∈ 全集,未知碼 = 呼叫端 bug;形狀照 A6)────
--   'DELETED' / 'ORDER_NOT_FOUND' / 'NOTE_NOT_FOUND' / 'INVALID_INPUT' /
--   'INVALID_REASON' / 'REASON_TOO_LONG' / 'ALREADY_DELETED' / 'DUPLICATE_REQUEST'
--   🔴 `DUPLICATE_REQUEST` 與 `ALREADY_DELETED` **不是同一件事,不要合併**:
--      · DUPLICATE_REQUEST = **同一個 request 重送**(同 request_id 且指向同一則)⇒ 呼叫端按**成功**處理。
--      · ALREADY_DELETED   = **別人先刪過了**(不同 request)⇒ 呼叫端要告訴使用者「已經被刪過」。
--      合併的話,第二個人會看到「刪除成功」而**他其實什麼都沒做**,`deleted_by` 也不是他。
--   🔴 已經是刪除狀態再刪 ⇒ **不覆寫** `deleted_at` / `deleted_by` / `deleted_reason`
--      (否則「誰刪的」會被第二個人蓋掉 —— plan §3.2)。
--
-- ── 檢查順序(先命中先回傳;順序即合約)────────────────────────────────────
--   1 actor / request_id(RAISE 面,照 A6 步 1 的形狀:剝空白 → 非空 → ≤200 → 零控制字元 → slug regex)
--   2 id 參數 NULL → 3 reason 正規化後為空 → 4 reason 過長
--   5 鎖單 FOR UPDATE + 存在性 → 6 note 存在且在本單(FOR UPDATE)→ 7 重複 request → 8 已刪 → 9 UPDATE + 同交易稽核
--   🔴 **步 6 排在步 7 前面是刻意的**(Fable 2026-09-13 審 consider 1 換來的;⛔ ~~我第一版反過來~~):
--      重複 request 的判準**必須看得到那一列現在的狀態** —— 只比對稽核列的文字,
--      在「刪了之後被 owner 還原」的世界裡會回 DUPLICATE_REQUEST 而**那一則其實活著**,
--      呼叫端依合約按成功處理 ⇒ **畫面說刪掉了,而它在時間軸上。**
--      📌 那正是 A6 步 11 做對的事(它 JOIN `order_notes` 驗「那則活著且在本單」);
--      我第一版的註解寫「判準照 A6 步 11」而**碼沒有照** —— 字面與事實不符,一併訂正。
--
-- ── 🔴 `search_path = ''`(不是 `public, pg_temp`)──────────────────────────
--   `.husky` 的 `scripts/definer-search-path-gate.py` 擋新 migration:
--   可寫的 schema 排在 pg_catalog 前面 = SECURITY DEFINER 提權的標準路徑。
--   ⇒ body 裡的物件全部帶 schema 全名。型別名不必帶(pg_catalog 永遠隱含在最前面)。
--   ⚠️ **A6 那支是 `public, pg_temp`** —— 它是 2026-08-02 的歷史、不可變,那道閘只擋下一個人。
--      ⇒ 本支與 A6 的 header **刻意不一致**,那不是抄漏。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ══ 前置閘:我以為的世界還在不在(缺了就整筆不貼)═══════════════════════════
DO $$
BEGIN
  IF pg_catalog.to_regclass('public.order_notes') IS NULL THEN
    RAISE EXCEPTION '前置閘①:public.order_notes 不在 ⇒ 停下';
  END IF;
  -- ② 三欄都還沒有(裸 ADD COLUMN 會自己紅, 這一句是為了印得出人話)
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='order_notes'
                AND column_name IN ('deleted_at','deleted_by','deleted_reason')) THEN
    RAISE EXCEPTION '前置閘②:deleted_* 已經有了 ⇒ 本支貼過了, 不要重貼';
  END IF;
  -- ③ A6 那支還在(本支的稽核形狀、slug regex 都是照它抄的)
  IF pg_catalog.to_regprocedure(
       'public.admin_append_order_note(uuid,text,text,text,timestamptz,uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION '前置閘③:admin_append_order_note 不在 ⇒ 我對備註線的假設要重讀, 停下';
  END IF;
  -- ④ 稽核表那條 request_id 約束還在(本支對 request_id 非空的假設靠它)
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid='public.admin_audit_log'::regclass
                    AND conname='admin_audit_log_request_id_nonempty') THEN
    RAISE EXCEPTION '前置閘④:admin_audit_log_request_id_nonempty 不見了 ⇒ 停下';
  END IF;
END $$;

-- ══ 1. 三欄 ════════════════════════════════════════════════════════════════
-- 🔵 三欄都可 NULL = 「沒被刪」。**不用 boolean `is_deleted`** ——
--    一個 boolean 答得出「刪了沒」,答不出「誰刪的 / 何時 / 為什麼」,而那三件正是軟刪除存在的理由。
ALTER TABLE public.order_notes
  ADD COLUMN deleted_at     timestamptz,
  ADD COLUMN deleted_by     text,
  ADD COLUMN deleted_reason text;

-- 🔴 **三欄同生同滅** —— 只有 `deleted_at` 而沒有 `deleted_by` 的列 = 一筆查不到責任的刪除。
--    (必填理由的那一格也在這裡:見檔頭「為什麼是必填」。)
ALTER TABLE public.order_notes
  ADD CONSTRAINT order_notes_deleted_triple_together CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL AND deleted_reason IS NULL)
    OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND deleted_reason IS NOT NULL)
  );

-- 🔴 `deleted_by` 鏡像 `author` 的 staff slug(`20260729030000` 的 order_notes_author_nonempty)——
--    不鏡像的話,大寫或 200 字的 actor 會在這一欄活下來,而 `author` 那一欄不會 ⇒ 同一張表兩套規則。
ALTER TABLE public.order_notes
  ADD CONSTRAINT order_notes_deleted_by_slug CHECK (
    deleted_by IS NULL OR deleted_by ~ '^[a-z0-9_]{1,64}$'
  );

-- 🔴 理由非空 + 長度上限。上限 500:它是**一句話**,不是第二則備註
--    (備註本文的上限是 4000,那是 `admin_append_order_note` 的 v_body_max)。
ALTER TABLE public.order_notes
  ADD CONSTRAINT order_notes_deleted_reason_shape CHECK (
    deleted_reason IS NULL
    OR (pg_catalog.btrim(deleted_reason) <> '' AND pg_catalog.char_length(deleted_reason) <= 500)
  );

COMMENT ON COLUMN public.order_notes.deleted_at IS
  '軟刪除時刻。NULL = 沒被刪。🔴 列與 body 永遠不會消失 —— 刪除只是把它從時間軸的日常視野收起來。';
COMMENT ON COLUMN public.order_notes.deleted_by IS
  '按下刪除的員工(staff slug,鏡像 author)。與 deleted_at / deleted_reason 同生同滅。';
COMMENT ON COLUMN public.order_notes.deleted_reason IS
  '刪除理由。**必填**(Sean 尚未親答,主視窗 2026-09-13 裁先做必填;0 列 ⇒ 之後放寬 = rollback 檔 §B 的 DROP + ADD 兩句)。';

-- ══ 2. RPC:軟刪除 ═════════════════════════════════════════════════════════
-- 🔴 **裸 `CREATE FUNCTION`** —— 新物件,撞名要當場紅。
--    `OR REPLACE` 會把一個我不知道存在的同名函式靜靜蓋掉,而 REVOKE 與事後閘照樣綠。
CREATE FUNCTION public.admin_soft_delete_order_note(
  p_order_id   uuid,
  p_note_id    uuid,
  p_reason     text,
  p_actor      text,
  p_request_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  -- 🔴 空白字集逐字沿用 A6 的 `v_ws`(31 字元),**不自己列一份** ——
  --    兩份會漂移,而漂移的方向是「這一支收得比那一支寬」,沒有任何東西會叫。
  v_ws constant text := E' \t\r\n\f\013'
    || U&'\0085' || U&'\00A0' || U&'\1680' || U&'\180E'
    || U&'\2000' || U&'\2001' || U&'\2002' || U&'\2003' || U&'\2004'
    || U&'\2005' || U&'\2006' || U&'\2007' || U&'\2008' || U&'\2009'
    || U&'\200A' || U&'\200B' || U&'\200C' || U&'\200D'
    || U&'\2028' || U&'\2029' || U&'\202F' || U&'\205F' || U&'\2060'
    || U&'\3000' || U&'\FEFF';

  -- 判空用的零寬字集,同樣逐字沿用 A6 的 `v_body_zw`(7 字元)。
  v_zw constant text := U&'\200B' || U&'\200C' || U&'\200D' || U&'\FEFF'
    || U&'\2800' || U&'\3164' || U&'\00AD';

  -- 理由上限 500 **碼位**(char_length 語意,非 byte)。與上面那條 CHECK 同值 ——
  -- 🔴 兩處同值是刻意的重複:CHECK 是最後一道,這裡是為了回**固定碼**而不是 raw 23514。
  -- ⚠️ 而「CHECK 擋得住 owner 直寫」只對一半(Fable 審 nit 3):CHECK 裡的 `btrim` 是單參數版,
  --    只剝 ASCII 空白 ⇒ owner 直寫一個全形空白當理由,CHECK 照樣放行。RPC 這條路不受影響。
  v_reason_max constant integer := 500;

  v_actor  text;
  v_req    text;
  v_reason text;
  v_row    public.order_notes%ROWTYPE;
  v_n      integer;
BEGIN
  -- 🔴 **執行期 lock_timeout**(Fable 審 consider 2)—— 檔頭那句 `SET LOCAL lock_timeout` 只護
  --    貼這支 migration 的那個交易,**不護它日後每一次被呼叫**。沒有它:有人開著
  --    `BEGIN; SELECT … FROM orders WHERE id=O FOR UPDATE;` 不 commit ⇒ 員工按一次刪除就掛住一條連線、無限等。
  --    3s 抄 `20260912050000` 三支的家規(`:132,207,278`),不自己訂一個數。
  SET LOCAL lock_timeout = '3s';

  -- 0. 常數自檢(字集漂移 ⇒ 全函式拒用、fail-loud;照 A6)
  IF pg_catalog.char_length(v_ws) <> 31 THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: v_ws 字元集長度異常(預期 31)';
  END IF;
  IF pg_catalog.char_length(v_zw) <> 7 THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: v_zw 字元集長度異常(預期 7)';
  END IF;

  -- 步 1. actor / request_id(RAISE 面 = caller bug,非固定碼;先剝、後驗,逐字照 A6 步 1)
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: 缺 actor';
  END IF;
  v_actor := pg_catalog.btrim(p_actor, v_ws);
  IF v_actor = '' THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: 缺 actor';
  END IF;
  IF pg_catalog.char_length(v_actor) > 200 OR v_actor ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: actor 非法';
  END IF;
  IF v_actor !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: actor 非法(須為 staff slug,鏡像 order_notes_deleted_by_slug)';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: 缺 request_id';
  END IF;
  v_req := pg_catalog.btrim(p_request_id, v_ws);
  IF v_req = '' THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: 缺 request_id';
  END IF;
  IF pg_catalog.char_length(v_req) > 200 OR v_req ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: request_id 非法';
  END IF;

  -- 步 2-8:固定碼面。
  IF p_order_id IS NULL OR p_note_id IS NULL THEN RETURN 'INVALID_INPUT'; END IF;

  -- 🔴 判空用正規化後的值,**入庫存原文**(與 A6 的 body 同一條規矩:顯示保真)。
  IF p_reason IS NULL
     OR pg_catalog.regexp_replace(pg_catalog.translate(p_reason, v_zw, ''), '[[:space:]]', '', 'g') = ''
  THEN RETURN 'INVALID_REASON'; END IF;
  IF pg_catalog.char_length(p_reason) > v_reason_max THEN RETURN 'REASON_TOO_LONG'; END IF;
  v_reason := p_reason;

  -- 步 5. 鎖序 = orders 單列 FOR UPDATE → note 列(**與 A6 同向**)。
  -- 🔴 同向這件事是規格不是巧合:A6 與本支若一支先鎖 note、一支先鎖 order,兩支同時跑就會互等。
  -- ⚠️ **射程照抄 A6 `:52-54` 的限定,不要讀寬**:無死結只限「每筆交易單次呼叫」。
  --    同一筆交易內跨多張單、反序呼叫仍然互鎖得起來(PG 會殺掉一邊)。(Fable 審 nit 9)
  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'ORDER_NOT_FOUND'; END IF;

  -- 步 6. note 存在且在本單(複合條件一次問完 ⇒ 拿 B 單的 note id 來刪 A 單,查無)。
  -- 🔴 **排在重複 request 之前** —— 見檔頭「檢查順序」那段:步 7 要看得到這一列現在的狀態。
  SELECT * INTO v_row FROM public.order_notes
   WHERE id = p_note_id AND order_id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOTE_NOT_FOUND'; END IF;

  -- 步 7. 重複 request。判準**真的**照 A6 步 11:不是「audit 有同鍵列就算成功」,
  -- 而是「同鍵 + 指向本則 + 同一個人 + **而且那一則現在確實是刪除狀態**」才算真的重送。
  IF EXISTS (SELECT 1 FROM public.admin_audit_log al
              WHERE al.action = 'order_note.soft_delete' AND al.request_id = v_req) THEN
    IF EXISTS (SELECT 1 FROM public.admin_audit_log al
                WHERE al.action = 'order_note.soft_delete' AND al.request_id = v_req
                  AND al.after->>'note_id' = p_note_id::text
                  AND al.target = 'order:' || p_order_id::text
                  -- 🔴 比對 actor(Fable 審 nit 5):同一個 token 換一個人送過來,
                  --    舊版會回「成功」而 `deleted_by` 記的是**別人**。
                  AND al.actor = v_actor) THEN
      -- 🔴🔴 效果驗證(Fable 審 consider 1)。稽核說刪過、而這一列活著 ⇒ 有人把它還原了
      --    (本檔檔頭自己宣傳過「可一句 SQL 還原」⇒ 這條路**不需要攻擊者**)。
      --    此時回 DUPLICATE_REQUEST = 告訴呼叫端「成功」而**備註還在時間軸上**。⇒ fail-loud。
      IF v_row.deleted_at IS NULL THEN
        RAISE EXCEPTION 'admin_soft_delete_order_note: 稽核說這則刪過而它現在是活的(被還原或稽核遭偽造)⇒ 不謊報成功';
      END IF;
      RETURN 'DUPLICATE_REQUEST';
    END IF;
    -- 同 request_id 但指向別則 / 別人 = request_id 被重用,或稽核遭偽造(service_role 對 audit 有 INSERT)
    -- ⇒ RAISE fail-loud,**絕不謊報成功**。
    RAISE EXCEPTION 'admin_soft_delete_order_note: request_id 已被使用但指向別的備註或別的人(重用或稽核遭偽造)';
  END IF;

  -- 步 8. 已刪 ⇒ 不覆寫(「誰刪的」不可被第二個人蓋掉)
  IF v_row.deleted_at IS NOT NULL THEN RETURN 'ALREADY_DELETED'; END IF;

  -- 步 9. 單列 UPDATE(本體唯一一句寫 order_notes;**不碰 body、不碰 corrects_note_id**)
  --       + 同交易稽核(Q1=A 的形狀,照 A6)。
  UPDATE public.order_notes
     SET deleted_at     = pg_catalog.clock_timestamp(),
         deleted_by     = v_actor,
         deleted_reason = v_reason
   WHERE id = p_note_id
  RETURNING * INTO v_row;
  -- 🔴 UPDATE 也要數(Fable 審 nit 6;`20260912050000` 家規兩邊都數,我第一版只數了稽核那邊)。
  --    今天不可達(持 FOR UPDATE、零 trigger),而哪天掛上 BEFORE UPDATE trigger 回 NULL ⇒
  --    `v_row` 被 RETURNING 清空 ⇒ **稽核落一列 `note_id: null` 而備註沒被收起來** = 我守的那件事的反面。
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: UPDATE 落 % 列(期望恰 1)', v_n;
  END IF;

  -- 🔴 audit INSERT **不包任何 EXCEPTION handler**(照 A6):失敗必往上拋 ⇒ 整筆 rollback、刪除不落地。
  --    吞掉它 = 備註被收起來而稽核靜默漏筆。
  -- 🔴 `after` **不含 body 全文**(PII 最小化,照 A6 只放 sha256 與長度)。
  INSERT INTO public.admin_audit_log
    (actor, action, target, before, after, reason, request_id, source_app)
  VALUES
    (v_actor, 'order_note.soft_delete', 'order:' || p_order_id::text,
     pg_catalog.jsonb_build_object('note_id', v_row.id, 'deleted_at', NULL),
     pg_catalog.jsonb_build_object(
       'note_id', v_row.id,
       'note_type', v_row.note_type,
       'deleted_at', v_row.deleted_at,
       'body_sha256', pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_row.body, 'UTF8')), 'hex'),
       'body_length', pg_catalog.char_length(v_row.body)),
     v_reason, v_req, 'admin');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_soft_delete_order_note: 稽核落 % 列(期望恰 1)⇒ 收起備註與留紀錄必須同生共死', v_n;
  END IF;

  RETURN 'DELETED';
END;
$fn$;

COMMENT ON FUNCTION public.admin_soft_delete_order_note(uuid, uuid, text, text, text) IS
  '訂單備註軟刪除 RPC(plan docs/plans/2026-09-13-order-notes-edit-delete-plan.md;Sean 2026-09-13 批)。'
  '唯一動作 = 單列 UPDATE 三個 deleted_* 欄(**不碰 body、不碰 corrects_note_id、不 DELETE 任何列**);'
  '同交易寫 admin_audit_log(action=order_note.soft_delete;after 含 note_id / body_sha256 / body_length,不含 body 全文 = PII 最小化)。'
  '回傳 8 固定碼:DELETED / ORDER_NOT_FOUND / NOTE_NOT_FOUND / INVALID_INPUT / INVALID_REASON / REASON_TOO_LONG / ALREADY_DELETED / DUPLICATE_REQUEST。'
  '🔴 DUPLICATE_REQUEST(同一發重送, 呼叫端按成功處理)與 ALREADY_DELETED(別人先刪過, 要告訴使用者)**不可合併**。'
  '🔴 已刪不覆寫 deleted_at / deleted_by / deleted_reason ⇒ 誰刪的不會被第二個人蓋掉。'
  '🛑 **本函式不查 staff、不宣稱擋得住非 manager** —— 那道閘在 app 層 authorizeManagerMutation();理由見 migration 檔頭。'
  '鎖序 = orders 單列 FOR UPDATE → note 列(與 admin_append_order_note 同向, 無反向持有者)。EXECUTE 僅 service_role。';

-- ══ 3. EXECUTE 權限:REVOKE 全 client → 只 GRANT service_role ════════════════
REVOKE ALL ON FUNCTION public.admin_soft_delete_order_note(uuid,uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_soft_delete_order_note(uuid,uuid,text,text,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_soft_delete_order_note(uuid,uuid,text,text,text) TO service_role;

-- 🛑 **order_notes 的表級授權一個字都不動** —— service_role 仍然只有 SELECT + INSERT。
--    開 UPDATE 就等於讓應用層繞得過本 RPC 的稽核(那正是 A3 建表檔 `:19,22` 的設計前提)。

-- ══ 4. 事後閘 ══════════════════════════════════════════════════════════════
DO $$
DECLARE
  -- 🔴 清單寫成陣列、而且**自己一行** —— `scripts/migration-static-checks.sh` 規則③ 的 awk 只認
  --    `^[[:space:]]*v_(relations|functions)` 開頭的那一行(它的自檢逐字記著:寫在 DECLARE 同一行
  --    ⇒ awk 看不到 ⇒ 那一格自己先紅)。我第一版寫成 `v_fn constant text := …` ⇒ 規則③ 判「列了 0 個」。
  --    ⚠️ 而那一格防的是「忘記收權」,**不防「忘記列」** —— 陣列裡少一支它一樣綠。
  v_functions text[] := ARRAY['public.admin_soft_delete_order_note(uuid,uuid,text,text,text)'];
  v_fn        text;
  c           text;
BEGIN
  v_fn := v_functions[1];
  -- ① 三欄在
  FOREACH c IN ARRAY ARRAY['deleted_at','deleted_by','deleted_reason'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='order_notes' AND column_name=c) THEN
      RAISE EXCEPTION '事後閘①:欄位沒加上去 ⇒ %', c;
    END IF;
  END LOOP;

  -- ② 三條 CHECK 都在
  FOREACH c IN ARRAY ARRAY['order_notes_deleted_triple_together',
                           'order_notes_deleted_by_slug',
                           'order_notes_deleted_reason_shape'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                    WHERE conrelid='public.order_notes'::regclass AND conname=c) THEN
      RAISE EXCEPTION '事後閘②:約束沒加上去 ⇒ %', c;
    END IF;
  END LOOP;

  -- ③ 函式在 · SECDEF · search_path 有釘住
  IF pg_catalog.to_regprocedure(v_fn) IS NULL THEN
    RAISE EXCEPTION '事後閘③a:函式不在 ⇒ %', v_fn;
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure) THEN
    RAISE EXCEPTION '事後閘③b:不是 SECURITY DEFINER ⇒ %', v_fn;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = v_fn::regprocedure
                    AND p.proconfig IS NOT NULL
                    AND EXISTS (SELECT 1 FROM unnest(p.proconfig) x WHERE x LIKE 'search_path=%')) THEN
    RAISE EXCEPTION '事後閘③c:沒有釘 search_path ⇒ %', v_fn;
  END IF;

  -- ④ 授權:service_role 叫得動;anon / authenticated 一律叫不動
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘④a:service_role 叫不動 ⇒ 後台會壞掉';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION '事後閘④b:anon / authenticated 竟然叫得動';
  END IF;

  -- ⑤ 🔴 **order_notes 對 service_role 仍然沒有 UPDATE / DELETE**
  --    —— 本支最容易被下一個人順手破壞的就是這一條(「不是要能刪嗎,那開個 UPDATE 吧」)。
  -- 🔴 **INSERT 也要斷言**(Fable 審 nit 1 換來的):A3 `:205-206` 只 GRANT SELECT,
  --    A6 `:296` 的事後閘逐字斷言「應仍恰為 service_role:SELECT:false」⇒ 三個寫入動詞一個都不該有。
  IF pg_catalog.has_table_privilege('service_role', 'public.order_notes', 'UPDATE')
     OR pg_catalog.has_table_privilege('service_role', 'public.order_notes', 'DELETE')
     OR pg_catalog.has_table_privilege('service_role', 'public.order_notes', 'INSERT') THEN
    RAISE EXCEPTION '事後閘⑤:service_role 竟然對 order_notes 有 INSERT / UPDATE / DELETE ⇒ 本 RPC 就繞得過去了';
  END IF;

  -- 🔴 正對照:上面那把尺要讀得到「有權限」這個世界, 否則 ④a⑤ 的綠是零判別力。
  IF NOT pg_catalog.has_table_privilege('service_role', 'public.order_notes', 'SELECT') THEN
    RAISE EXCEPTION '事後閘⑥(正對照):service_role 連 SELECT 都沒有 ⇒ 這把尺量不到東西, 上面那幾格不算數';
  END IF;
END $$;

COMMIT;
