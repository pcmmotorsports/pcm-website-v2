-- ⟦b4-CANCELMAILMIXEDRAIL⟧ 片 B 的【撤銷登錄】—— 把誤按救回來。
--
-- ══ 為什麼需要它 ═══════════════════════════════════════════════════════════
-- 「登錄我已人工寄出取消通知」那顆鈕**按下去不可撤銷**:它插的那一列會**永久吃掉**
-- `email_outbox` 上 `(event_type='order_cancelled', dedup_key=<orderId>)` 那個唯一鍵,
-- 而掃描 view 的 anti-join **只問 `event_type`**(`20260905310000:197-200`)
-- ⇒ 🛑 **誤按一次 = 那張單從「要人工寄」的提醒裡消失, 而沒有人會知道。**
--    ⛔ ~~而後台沒有入口救得回來~~ 🔵 **本支就是那個入口** —— 這句話在這支檔存在的當下就過期了。
-- 🔵 主視窗 2026-09-06 裁 `Q-誤按取消通知登錄怎麼救 = 乙`, 形狀逐字:
--   「稽核先寫(誰、何時、撤哪列)→ **硬刪**那一列 outbox → 計數自己回來;
--    只准撤『payload 標 manual 的列』(系統寄的不准撤), 同一級授權, 確認對話框兩顆鈕都要。」
--
-- ══ 🔴 為什麼是【硬刪】而不是軟刪或改 status ══════════════════════════════
-- 這一格是主視窗裁示裡逐字寫過的,而理由是我自己列的那兩個世界:
--   · **軟刪 / 加一個 `deleted_at`** ⇒ 那一列還在 ⇒ 掃描 view 的 anti-join **仍然看得到它**
--     ⇒ 📌 計數不會回來, 撤銷等於沒撤。
--   · **改 `status`** ⇒ 那一列變成 `pending` 之類 ⇒ 🛑 **sweeper 會把它撿去真的寄出去**
--     ⇒ 客人收到一封**系統寄的、金額可能寫錯**的取消信 —— 那正是這整條線一開始要避免的事。
-- ⇒ ⇒ **只有硬刪同時滿足「計數回來」與「不會被寄出去」。**
--
-- ══ 🔴 為什麼是一支函式而不是後台直接 `.delete()` ═════════════════════════
-- 述詞「只准撤 payload 標 manual 的列」如果走 PostgREST 的 jsonb 路徑過濾, 而**那個過濾
-- 沒有綁上**(打錯、版本不認、語法差一個字), 那句 DELETE 就會**刪掉不該刪的列**。
-- 🔬 量過(2026-09-06):`git grep "payload->>" -- apps packages` ⇒ **命中 1**,
--    而那一筆是**我自己寫的一句註解**, 不是呼叫。🟢 正對照:`.eq(` 在 `apps/admin/src` ⇒ **38 檔**。
-- ⇒ 📌 **這個 repo 對 jsonb 路徑過濾【零先例】** —— 而這是一個**硬刪**。
--   ⇒ 把述詞寫在 SQL 裡, 它就綁在 DELETE 那一句上, 而且我還數得到「到底刪了幾列」。
--
-- ══ 🛑 三件這一支【證不到】的事 ═══════════════════════════════════════════
-- ① **它救不回那封信** —— 撤銷只是讓那張單**重新出現在【人工】提醒裡**。
--    ⛔ ~~撤銷之後系統會再寄一次~~ 🔴 **那句話錯了**(code-reviewer 2026-09-06 抓到, 我開檔核過):
--       自動寄的掃描面是 `pcm_cancelled_email_pending`
--       (`SupabaseCancelledOrderScannerAdapter.ts:165` 逐字 `const PENDING_VIEW = …`),
--       而那支 view 帶 `NOT EXISTS (order_manual_refunds WHERE voided_at IS NULL)`
--       (`20260905310000:193-196`)⇒ 🛑 **混合退款的單被【永久排除】**
--       ⇒ 📌 刪掉這一列**不會**讓它回到自動寄的隊列。
--    ✅ 正確的說法:**再寄的是【人】, 不是系統** —— 它只是回到那張人工待辦清單上。
--    ⇒ 若員工當初其實**真的寄了**, 撤銷之後**會有人再寄一次** ⇒ 客人收到兩封。
--    ⇒ 那一格屬流程(SOP 要寫「只有按錯才撤」), 不屬碼。
-- ② **收權斷言看不到 role membership**(整族的已知天花板)。
-- ③ **它不檢查「這一列是不是【這個人】登錄的」** —— 任何 manager 都撤得掉任何人的登錄。
--    ⇒ 那是刻意的(值班換人時要撤得掉), 而**誰撤的**由稽核那一列記住。

BEGIN;

-- ── 前置閘:登錄那一支在不在(撤銷是它的反面, 沒有它就不該有這一支)──────────
DO $$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.record_manual_cancel_notice(uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION '前置閘:找不到 record_manual_cancel_notice ⇒ 20260906920000(貼板 57)還沒貼';
  END IF;
END
$$;

CREATE FUNCTION public.revoke_manual_cancel_notice(
  p_order_id   uuid,
  p_actor      text,
  p_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  -- 🔴 型別一律帶 `pg_catalog.` 前綴 —— `SET search_path = ''` **不排除 `pg_temp`**,
  --    而暫存 schema 對型別名是隱含且優先搜尋(codex 2026-09-06 對姊妹支的 must-fix)。
  v_row_id   pg_catalog.uuid;
  v_manual   pg_catalog.text;
  v_deleted  pg_catalog.int4;
BEGIN
  IF p_order_id IS NULL OR pg_catalog.btrim(COALESCE(p_actor, '')) = '' THEN
    RETURN pg_catalog.jsonb_build_object('result', 'invalid_args');
  END IF;

  -- 🔴🔴 **鎖那一列再看它是什麼** —— 順序不可換。
  --    先看再刪的話, 兩個人同時撤時第二個人會刪到**已經不存在**的列(或別人剛插的新列)。
  SELECT e.id, e.payload->>'manual'
    INTO v_row_id, v_manual
    FROM public.email_outbox e
   WHERE e.order_id = p_order_id
     AND e.event_type = 'order_cancelled'
   FOR UPDATE;

  IF NOT FOUND THEN
    -- 🔵 沒有那一列 ⇒ 不是錯誤:可能已經被撤掉了, 也可能從來沒登錄過。
    --    兩者對「下一步」是同一件事(那張單現在就在提醒裡), 所以不細分。
    RETURN pg_catalog.jsonb_build_object('result', 'not_found');
  END IF;

  -- 🔴🔴 **只准撤【人工登錄】的列。**
  --    ⛔ ~~系統寄的那一列撤掉 = 系統會再寄一次給客人~~
  --    🔵 **精確版**(code-reviewer 2026-09-06):那句話對**非混合單**成立(它們在自動寄的
  --       掃描面裡, 刪了 outbox 列確實會被重寄);而對**混合單**不成立(view 永久排除它們)。
  --    ⇒ 📌 **兩種單都不准撤系統寄的那一列, 而理由不同** —— 前者會重寄, 後者是「那不是你登錄的」。
  --    🛑 用 `IS DISTINCT FROM` 不是 `<>` —— `payload` 沒有 `manual` 這個鍵時
  --      `->>` 回 **NULL**, 而 `NULL <> 'true'` 是 **UNKNOWN**(不是真)⇒ IF 不成立
  --      ⇒ 📌 **系統寄的那一列會被放行刪掉。** 那正是這道閘要擋的東西。
  IF v_manual IS DISTINCT FROM 'true' THEN
    RETURN pg_catalog.jsonb_build_object('result', 'not_manual');
  END IF;

  DELETE FROM public.email_outbox WHERE id = v_row_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- 🔴 **數一次刪了幾列** —— 一句 DELETE 回報「成功」而刪了 0 列, 在 rc 上與刪了 1 列一樣。
  --    ⇒ 這一格把它分開。刪不到 1 列就丟, 讓整個交易回滾(稽核那一筆由呼叫端負責)。
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION '撤銷登錄:預期刪 1 列而實際刪了 % 列(order_id=%)⇒ 拒繼續', v_deleted, p_order_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object('result', 'ok', 'deleted_id', v_row_id);
END
$fn$;

ALTER FUNCTION public.revoke_manual_cancel_notice(uuid, text, text) OWNER TO postgres;

COMMENT ON FUNCTION public.revoke_manual_cancel_notice(uuid, text, text) IS
$c$撤銷「人工寄出取消通知」的登錄(⟦b4-CANCELMAILMIXEDRAIL⟧ 片 B;主視窗 2026-09-06 裁乙)。
🔴 **硬刪**那一列 —— 軟刪或改 status 都不行:軟刪 ⇒ anti-join 仍看得到 ⇒ 計數不會回來;
   改 status ⇒ sweeper 會把它撿去**真的寄出去**, 而那正是這條線要避免的事。
🛑 只准撤 payload 標 manual 的列。判斷用 IS DISTINCT FROM:`payload` 沒有 manual 鍵時
   `->>` 回 NULL, 而 `NULL <> 'true'` 是 UNKNOWN 不是真 ⇒ 用 `<>` 會把系統寄的那一列放行。
🔵 先 FOR UPDATE 鎖那一列再判再刪, 順序不可換;刪完數 ROW_COUNT, 不是 1 就丟並回滾。
🔵 回 jsonb{result}: ok(附 deleted_id) / not_found / not_manual / invalid_args。
🛑 它證不到:那封信到底寄了沒。⚠️ 而撤銷**不會**讓系統自己再寄 —— 混合退款單被自動寄的
   掃描面(pcm_cancelled_email_pending)永久排除 ⇒ 它只是回到【人工】提醒裡, 再寄的是人。
   ⇒ 只有【按錯、其實沒寄】才該撤, 那是 SOP 的事。
🛑 它不問「是不是同一個人登錄的」—— 任何 manager 都撤得掉任何人的, 這是刻意的(值班會換人),
   而**誰撤的**由稽核那一列記住。$c$;

REVOKE ALL ON FUNCTION public.revoke_manual_cancel_notice(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_manual_cancel_notice(uuid, text, text)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_manual_cancel_notice(uuid, text, text) TO service_role;

-- ── 收權斷言 + 形狀斷言 ────────────────────────────────────────
DO $assert$
DECLARE
  v_functions text[] := ARRAY['public.revoke_manual_cancel_notice(uuid,text,text)']::text[];
  r           text;
  v_oid       oid;
  v_acl       text;
  v_extra     text;
  v_shape     jsonb;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    SELECT p.oid, pg_catalog.array_to_string(p.proacl, ',')
      INTO v_oid, v_acl
      FROM pg_catalog.pg_proc p
     WHERE p.oid = pg_catalog.to_regprocedure(r);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '撤銷登錄 收權斷言失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;
    IF v_acl IS NULL THEN
      RAISE EXCEPTION '撤銷登錄 收權斷言失敗:% 的 proacl 是 NULL(= 套用預設 ⇒ PUBLIC 可執行)⇒ 拒繼續', r;
    END IF;
    SELECT pg_catalog.string_agg(g.grantee, ', ')
      INTO v_extra
      FROM (
        SELECT pg_catalog.pg_get_userbyid((aclexplode(p.proacl)).grantee) AS grantee
          FROM pg_catalog.pg_proc p
         WHERE p.oid = v_oid
      ) g
     WHERE g.grantee NOT IN ('service_role', CURRENT_USER);
    IF v_extra IS NOT NULL THEN
      RAISE EXCEPTION '撤銷登錄 收權斷言失敗:% 的 EXECUTE 清單多出非預期角色(%)—— 只應有 service_role;拒繼續', r, v_extra;
    END IF;
    IF v_acl NOT LIKE '%service_role=%' THEN
      RAISE EXCEPTION '撤銷登錄 收權斷言失敗:% 對 service_role 沒有 EXECUTE(收到 %)⇒ 後台叫不動', r, v_acl;
    END IF;
  END LOOP;

  -- 🔴 形狀斷言:餵一個一定不存在的訂單 ⇒ not_found, 而不是丟例外。
  v_shape := public.revoke_manual_cancel_notice(
    '00000000-0000-0000-0000-000000000000'::uuid, 'assert', 'assert');
  IF v_shape IS NULL
     OR pg_catalog.jsonb_typeof(v_shape) <> 'object'
     OR (v_shape->>'result') <> 'not_found' THEN
    RAISE EXCEPTION '撤銷登錄 形狀斷言失敗:餵不存在的單應回 not_found, 收到 %', v_shape;
  END IF;

  -- 🔵 負對照:空 actor 要回 invalid_args(證明那道空值閘不是恆真)。
  v_shape := public.revoke_manual_cancel_notice(
    '00000000-0000-0000-0000-000000000000'::uuid, '  ', 'assert');
  IF (v_shape->>'result') <> 'invalid_args' THEN
    RAISE EXCEPTION '撤銷登錄 負對照失敗:空 actor 應回 invalid_args, 收到 %', v_shape;
  END IF;
END
$assert$;

COMMIT;
