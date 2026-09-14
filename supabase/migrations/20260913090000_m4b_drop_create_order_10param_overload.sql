-- 20260913090000 · M-4b DROP 掉 `public.create_order` 的 **10 參數多載**(段 1-C, 三步部署的最後一步)。
--
-- 🛑🛑 **未貼。** 貼的人是 Sean(或他明文授權的那一個編號)。
-- 🔴 **2026-09-14 訂正(板 154 正式庫貼失敗 rc=3 回滾的成因)**:前置閘③ / 事後閘② 原本釘 11 參 md5 `42a9132a…`
--    (20260907040000 那一代), 而板 162 = 20260915060000(#953 P2)已把 11 參換成 `2e642c48…`(只改 v_total 那一段呼叫 pcm_order_total)。
--    設計窗 2026-09-14 唯讀查正式庫:10 參仍在(md5 d17be799… / secdef t / search_path 空, 與 v_md10 同)、11 參 = 2e642c48…
--    ⇒ 兩個 pin 改成現行值, 其餘一字不動。📌 這支 pin 的是「顧客站那條路的現行版」, 誰再換 11 參一代, 這裡就要跟著改。
-- plan:`docs/plans/2026-09-13-drop-create-order-10param-overload-plan.md`(Sean 批的第 5 條)。
-- 前身:`PENDING-C-drop-create-order-10arg.sql.txt`(2026-09-07 草稿, 本支落地後刪掉, 不留兩份)。
--
-- ══════════════════════════════════════════════════════════════════
-- 為什麼
-- ══════════════════════════════════════════════════════════════════
-- 正式庫 `create_order` 有兩個活的多載, 都 GRANT 給 `authenticated`:
--   · 11 參(帶 `p_payment_channel`):依 `price_tax_mode` + 付款方式算稅 —— **顧客站現在唯一在走的那支**
--   · 10 參(沒有 `p_payment_channel`):算不出經銷單的稅(稅由付款方式決定, 而它不知道付款方式)。
-- ⛔ ~~plan §2 / memory 0909 第 5 點寫的「10 參那支稅恆 0、不寫 `price_tax_mode`」~~ —— **那是 `20260907040000` 之前的樣子,
--    今天不成立**(codex 2026-09-13 nit ①, B 窗開檔核過):現行 10 參 body `:1044-1052` 在 `price_tax_mode = 'exclusive'`
--    時直接 RAISE「經銷單需要付款方式才能算稅 ⇒ 請走 11 參那支」, 而且 INSERT 有寫 `price_tax_mode`(`:433/:440`)。
--    ⇒ 📌 **09-07 那道 RAISE 是止血, 本支才是把那條路收掉**:一支沒有呼叫端、卻對所有登入客人開著 EXECUTE 的
--       SECURITY DEFINER 金流 RPC, 留著只多一個要被守的面。今天經銷會員 0 人 ⇒ 零影響的時機就是現在。
--
-- 🔴 只 DROP 10 參那個簽章(逐字從 pg_proc 抽, 見前置閘①);11 參那支**一個字不碰**(事後閘②③ 釘住)。
--
-- ══════════════════════════════════════════════════════════════════
-- 呼叫端(2026-09-13 B 窗重掃, 不信 plan)
-- ══════════════════════════════════════════════════════════════════
-- `git grep -n "rpc('create_order'" -- apps packages` ⇒ 唯一呼叫點 `SupabaseOrderAdapter.placeOrder`(:704 附近),
-- 其 args 型別 `CreateOrderRpcArgs.p_payment_channel` **必填**(`mappers/order.ts:84`)⇒ TS 組不出 10 個名字。
-- 後台手動建單走 `admin_create_manual_order`, 不呼本支。報價單 repo `grep -rn create_order` 零命中。
-- PostgREST 以**參數名字集合**分辨多載(`20260904020000` 檔頭實測)⇒ DROP 之後仍送 10 個名字的人
-- 會拿到 `PGRST202`(fail-loud, 結帳當場報錯), 不會靜靜落到別支。
-- 🟡 「正式庫最近一筆 10 名呼叫是什麼時候」**沒量**(plan §3-c);間接證據 = B(前端**一定帶 `p_payment_channel`**;
--    鍵的個數可以是 10 或 11 —— 省略券碼就是 10 個鍵 —— 而分辨器是名字集合, 有那個名字就命中 11 參)
--    2026-09-07 前已上線, 到今天 6 天。夠不夠長 Sean 裁, 本支不裁。
--
-- ══════════════════════════════════════════════════════════════════
-- 正式庫現值(2026-09-13 `scripts/readonly-prod-sql.sh` 唯讀實查;前置閘②③ 照這組比)
-- ══════════════════════════════════════════════════════════════════
--   10 參 oid 79004  md5(prosrc) d17be799fa2e1b33581312b5509fe8b1  proacl {postgres=X/postgres,authenticated=X/postgres}
--        prosecdef t  md5(COMMENT) 8e715a57fe626bcf04e02bdd5bb28a00(983 字元)
--   11 參 oid 79002  md5(prosrc) 42a9132a887b1e39995452009dd7cb47  proacl 同上;proconfig 皆 {"search_path=\"\""}
-- ✅ 兩個 md5 與 repo `20260907040000_m4b_m208_b2c_create_order_dealer_untaxed.sql` 的兩段函式體
--    (11 參 :145-666、10 參 :668-1164, `$fn$` 之間)逐 byte 相同(B 窗自算)⇒ **那支檔可以當回退底稿**。
--
-- ══════════════════════════════════════════════════════════════════
-- 實測(2026-09-13 拋棄式 PG 17.10;整條鏈從零重播到 create_order 那幾支會紅在它們自己的 md5 前置閘,
-- 所以是用 `20260907040000:145-1164` + 同檔 REVOKE/GRANT 直接建出兩支 ⇒ md5 / proacl / proconfig 與正式庫逐字相同)
-- ══════════════════════════════════════════════════════════════════
--   ✅ 套本支 ⇒ 過;剩 11 參 1 列、md5 42a9…、ACL 不動
--   ✅ 回退段逐字貼回(含 COMMENT)⇒ 10 參回來、md5 d17b…、prosecdef t、search_path ''、ACL {postgres,authenticated}、
--      COMMENT md5 8e71… —— 與 DROP 前五項逐字相同
--   🔴 負對照七發, 每發都在 DO 閘 RAISE、整包回滾、兩支原地不動:
--      再跑一次 ⇒ 前置閘①(找到 0 支)· 10 參 body 換掉 ⇒ ②(md5)· ALTER 成 SECURITY INVOKER ⇒ ②(secdef)·
--      COMMENT 改掉 ⇒ ②(cmt)· RESET search_path ⇒ ②(proconfig)· GRANT anon ⇒ ④(ACL 漂)·
--      11 參改名不在 ⇒ ③(10 參仍在, count=1)
--   🛑 **仍不證**:正式庫貼的那一刻兩支還是這個樣子 —— 那就是前置閘①-④ 存在的理由, 貼的時候它們自己會叫。
--   `subtotal-writers-allowlist.test.ts` 帶本支在 repo 裡實跑 ⇒ 綠(本支零 INSERT/UPDATE, 不是寫入者;
--   09-04 那段「C 不改這裡會紅」的預告不成立, 已在該檔 :527 留痕)。
--
-- 冪等:無頂層 DML ⇒ 冪等宣告閘不叫。重跑 ⇒ 前置閘①(10 參已不在 ⇒ RAISE)。forward-only。
-- 同一個 BEGIN…COMMIT ⇒ 任一道炸 ⇒ 整包回滾, 兩支都原地不動。
--
-- ══════════════════════════════════════════════════════════════════
-- 回退(人現場貼;**回退不對稱**:要退 app 回送 10 名之前, 必須先把這支救回來)
-- ══════════════════════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
-- 🔴 底稿 = `supabase/migrations/20260907040000_m4b_m208_b2c_create_order_dealer_untaxed.sql:668-1164`
--    (`CREATE FUNCTION public.create_order(` 10 參那段, 到 `$fn$;` 為止, **一字不改**;md5 已對過, 見上)。
--    貼完再補 ACL(同檔 :1166 起那三句的 10 參版):
--      ALTER FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text) OWNER TO postgres;
--      REVOKE ALL ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text) FROM PUBLIC, anon, service_role;
--      GRANT EXECUTE ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text) TO authenticated;
--    再貼 COMMENT(正式庫 2026-09-13 唯讀抽出、983 字元、md5 8e715a57fe626bcf04e02bdd5bb28a00;它是四代 migration 累加的,
--    repo 裡沒有單一一支能還原, 所以逐字存在這裡;codex nit ③):
--      COMMENT ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text) IS
--      'M-4b 券片3(2026-09-01):在 20260825130000 之上【只加一個】p_coupon_code text DEFAULT NULL。⇒ 帶券碼時本函式呼 public.redeem_coupon 的【試算路徑】算出折扣, 再 total = subtotal + shipping_fee − 折扣。🔴 **金額不是呼叫端送的** —— 前一版收 p_discount_total(金額), 而 create_order 是 SECURITY DEFINER 且 GRANT TO authenticated + PostgREST 自動暴露 ⇒ 任何登入的客人可以自己填那個金額。已刪。🛑 券的【規則】(低消/上限/有效期/誰能用)一格都不在這裡 —— 本函式只做一次呼叫去問那個權威。🔴 fail-closed:券無效 ⇒ RAISE(不靜靜地不折);算出來的折扣為負或超過小計 ⇒ RAISE。⚠️ 上限基準(小計 vs 小計+運費)未定案 —— 稿 CheckoutPage.jsx:95 折的是小計+運費, 本函式照小計。Sean 2026-09-01 待拍。🔴 而 :374 那道「total <= 0 ⇒ RAISE」留著不動;一張把小計折光的券 + 門市取貨(運費 0)會撞到它 —— 具名未解。其餘 executable 逐字同 20260825130000。 🔴 2026-09-06 ⟦b4-BANKCARDRACE⟧:本函式現在會先拿【客人層 advisory lock】(與 begin_charge_attempt 同一把), 再擋掉「同一個 cart_session 已經有一張活著且已付成功(payment_status=paid 或 charge attempt=charged)的單」的第二次建單, 錯誤碼 P0002、字面 pcm_cart_already_paid。 🛑 刻意【不】擋 pending / failed —— cart_session_id 只在 paid 分支才 regenerate, 擋了會讓刷卡失敗想重試的客人結不了帳。 ⚠️ 而 3DS 進行中(pending → 建匯款單 → charged)那段窗口【本片關不掉】, 見板列 ⟦b4-CARDPENDINGWINDOW⟧。';
--    貼完用事後閘①的查詢反著看:count = 2、10 參 md5 回到 d17be799fa2e1b33581312b5509fe8b1、
--    `md5(obj_description(oid,'pg_proc'))` = 8e715a…、prosecdef = t、proconfig = {"search_path=\"\""}。
-- 🔴 貼回去的前提是 `20260907040000` 之後沒有人再改過 10 參那支 —— 前置閘② 保證 DROP 當下是那一版;
--    若回退時 repo 那支檔已被後人改動, 用 `git log --oneline -- supabase/migrations/20260907040000_*.sql` 找本支 commit 當時
--    的那一版 `git show "<sha>:supabase/migrations/20260907040000_m4b_m208_b2c_create_order_dealer_untaxed.sql"` 再貼。

BEGIN;

-- DROP FUNCTION 取 ACCESS EXCLUSIVE(對函式物件);結帳交易若正持有它會排隊 ⇒ 夾 5s 不卡別人。
SET LOCAL lock_timeout = '5s';

DO $precondition$
DECLARE
  v_sig10 constant text := 'p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb, p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text, p_notification_email text, p_coupon_code text';
  v_sig11 constant text := 'p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb, p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text, p_payment_channel text, p_notification_email text, p_coupon_code text';
  v_md10  constant text := 'd17be799fa2e1b33581312b5509fe8b1';
  v_md11  constant text := '2e642c484389ea58e6ab150c8e130675';  -- 20260915060000(#953 P2, 板 162)那一代;⛔ ~~42a9132a…~~ 見檔頭 2026-09-14 訂正
  v_cmt10 constant text := '8e715a57fe626bcf04e02bdd5bb28a00';
  v_acl   constant text := '{postgres=X/postgres,authenticated=X/postgres}';
  v_cnt   int;
  v_got   text;
BEGIN
  -- 前置閘①:10 參那個簽章**存在**才 DROP(不在 = 已被別人處理過 ⇒ 停下查為什麼, 不靜靜跳過)
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_order'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) = v_sig10;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '前置閘①:10 參 create_order 簽章找到 % 支(要 1)⇒ 前提不成立, 停', v_cnt;
  END IF;

  -- 前置閘②:10 參 body 指紋 + SECURITY DEFINER + search_path + COMMENT = plan 記錄的那一版
  --   (不符 = 有人在 plan 之後改過它 ⇒ 回退底稿還原出來的會是【另一個東西】⇒ 停)。
  --   🔴 body/簽章/ACL 不變、只被 ALTER 成 SECURITY INVOKER 的話, 前一版閘全放行、回退卻會把 DEFINER 放回去
  --      (codex 2026-09-13 must-fix ②)⇒ prosecdef / proconfig / COMMENT 一起比。
  SELECT md5(p.prosrc) || '|' || p.prosecdef::text || '|' || coalesce(p.proconfig::text, 'NULL')
         || '|' || coalesce(md5(pg_catalog.obj_description(p.oid, 'pg_proc')), 'NULLCMT') INTO v_got
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_order'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) = v_sig10;
  IF v_got IS DISTINCT FROM (v_md10 || '|true|{"search_path=\"\""}|' || v_cmt10) THEN
    RAISE EXCEPTION '前置閘②:10 參 create_order 的 md5|secdef|proconfig|cmt 是 %, 不是 %|true|{"search_path=\"\""}|% ⇒ 這不是 plan 看過的那一版, 停', v_got, v_md10, v_cmt10;
  END IF;

  -- 前置閘③:11 參那支**活著、而且是現行那一版**(DROP 前確認另一條路在, 不靠印象)
  SELECT md5(p.prosrc) INTO v_got
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_order'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) = v_sig11;
  IF v_got IS DISTINCT FROM v_md11 THEN
    RAISE EXCEPTION '前置閘③:11 參 create_order 不在或 md5 是 %(要 %)⇒ 顧客站那條路不確定, 停', v_got, v_md11;
  END IF;

  -- 前置閘④:兩支 ACL 都還是 {postgres, authenticated}(中間沒人加寬, 例如加了 anon)
  SELECT string_agg(p.proacl::text, ' | ' ORDER BY p.pronargs) INTO v_got
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_order';
  IF v_got IS DISTINCT FROM (v_acl || ' | ' || v_acl) THEN
    RAISE EXCEPTION '前置閘④:create_order 兩支 proacl 是 %(要兩支都 %)⇒ ACL 漂了, 停', v_got, v_acl;
  END IF;
END
$precondition$;

DROP FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text);

DO $postcondition$
DECLARE
  v_sig11 constant text := 'p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb, p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text, p_payment_channel text, p_notification_email text, p_coupon_code text';
  v_md11  constant text := '2e642c484389ea58e6ab150c8e130675';  -- 20260915060000(#953 P2, 板 162)那一代;⛔ ~~42a9132a…~~ 見檔頭 2026-09-14 訂正
  v_acl   constant text := '{postgres=X/postgres,authenticated=X/postgres}';
  v_cnt   int;
  v_got   text;
BEGIN
  -- 事後閘①:只剩 1 列
  SELECT count(*) INTO v_cnt
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_order';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '事後閘①:create_order 剩 % 支(要 1)', v_cnt;
  END IF;

  -- 事後閘②:剩的那一支是 11 參、body 沒被動到
  SELECT md5(p.prosrc) INTO v_got
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_order'
     AND p.pronargs = 11
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) = v_sig11;
  IF v_got IS DISTINCT FROM v_md11 THEN
    RAISE EXCEPTION '事後閘②:剩下那支不是 11 參現行版(md5 %, 要 %)', v_got, v_md11;
  END IF;

  -- 事後閘③:11 參的 ACL / search_path 原地不動(DROP 只帶走 10 參那組 ACL)
  SELECT p.proacl::text || ' ' || p.proconfig::text INTO v_got
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_order';
  IF v_got IS DISTINCT FROM (v_acl || ' {"search_path=\"\""}') THEN
    RAISE EXCEPTION '事後閘③:11 參 proacl/proconfig 變成 %', v_got;
  END IF;
END
$postcondition$;

COMMIT;
